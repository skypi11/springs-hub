'use client';

// Picker date + heure custom, remplace <input type="datetime-local">.
// Le natif est moche, dépend du navigateur, et ne permet pas de raccourcis.
// Ce composant garde le même contrat I/O (value/onChange en "YYYY-MM-DDTHH:mm"
// local) pour brancher sans toucher au reste du code.
//
// UX :
//   - Bouton affichant la valeur formatée (sam. 19 avr · 20:00)
//   - Dropdown (via Portal) avec : presets rapides, mini-calendrier, heure/minute
//   - Presets contextuels : "start" = ce soir / demain / samedi / dans 1h ;
//     "end" = +1h / +2h / +3h relatifs à anchorIso
//   - min="YYYY-MM-DDTHH:mm" grise les jours antérieurs
//
// Chaque choix est commité au parent immédiatement : ne PAS réintroduire un
// bouton "Valider" qui serait le seul chemin de commit. Un utilisateur qui
// ferme le popup en tapant à côté (geste courant au doigt) perdrait sa saisie
// sans le savoir, et la ré-ouverture ferait réapparaître l'ancienne valeur.

import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { Calendar as CalendarIcon, ChevronLeft, ChevronRight } from 'lucide-react';
import Portal from './Portal';

type Props = {
  value: string;
  onChange: (v: string) => void;
  min?: string;
  placeholder?: string;
  presetMode?: 'start' | 'end' | 'none';
  anchorIso?: string;
  disabled?: boolean;
};

// En dessous de cette largeur, un popup ancré au bouton sort de l'écran :
// les 2 pickers sont côte à côte, le bouton "Fin" démarre au-delà de la moitié
// du viewport → bottom-sheet. Le mode est décidé dans update() et n'agit que
// sur le style : basculer entre deux arbres JSX selon la taille remonterait le
// popup et jetterait la saisie en cours.
const SHEET_MAX_VIEWPORT = 640;
const POPUP_MIN_WIDTH = 300;
const POPUP_MAX_HEIGHT = 420;
const POPUP_MIN_HEIGHT = 200;
const VIEWPORT_MARGIN = 8;

type Pos =
  | { mode: 'sheet'; maxHeight: number }
  | { mode: 'popover'; top: number; left: number; width: number; maxHeight: number };

function pad(n: number): string { return n < 10 ? `0${n}` : `${n}`; }

function toLocalString(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromLocalString(s: string): Date | null {
  if (!s) return null;
  const [date, time] = s.split('T');
  if (!date || !time) return null;
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  if ([y, m, d, hh, mm].some(Number.isNaN)) return null;
  return new Date(y, m - 1, d, hh, mm);
}

function formatDisplay(s: string): string {
  const d = fromLocalString(s);
  if (!d) return '';
  const date = d.toLocaleDateString('fr-FR', { weekday: 'short', day: '2-digit', month: 'short' });
  const time = d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  return `${date} · ${time}`;
}

export default function DateTimePicker({
  value, onChange, min, placeholder, presetMode = 'start', anchorIso, disabled,
}: Props) {
  const [open, setOpen] = useState(false);
  /** Instant de la dernière ouverture : ancre des presets relatifs à « maintenant ». */
  const [openedAt, setOpenedAt] = useState(0);
  const [pos, setPos] = useState<Pos | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  const initial = fromLocalString(value) ?? new Date();
  const [viewYear, setViewYear] = useState<number>(initial.getFullYear());
  const [viewMonth, setViewMonth] = useState<number>(initial.getMonth());
  const [hour, setHour] = useState<number>(initial.getHours());
  const [minute, setMinute] = useState<number>(initial.getMinutes() - (initial.getMinutes() % 15));
  const [dayKey, setDayKey] = useState<string>(
    `${initial.getFullYear()}-${pad(initial.getMonth() + 1)}-${pad(initial.getDate())}`
  );

  // L'état interne est semé À L'OUVERTURE, ici et pas dans un effet : `value` ne doit
  // surtout pas être une dépendance (le commit étant en direct, une resync à chaque
  // frappe combattrait la saisie en cours). Le faire au clic est à la fois plus juste
  // et plus simple — l'ouverture est une action utilisateur, pas une synchronisation.
  function openPicker() {
    const d = fromLocalString(value) ?? new Date();
    setViewYear(d.getFullYear());
    setViewMonth(d.getMonth());
    setHour(d.getHours());
    setMinute(d.getMinutes() - (d.getMinutes() % 15));
    setDayKey(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`);
    setOpenedAt(Date.now());
    setOpen(true);
  }

  // Positionnement du popup, recalcule sur resize/scroll pour rester ancré.
  // Le popup est en position fixed : hors viewport = irrattrapable au scroll.
  useEffect(() => {
    if (!open || !btnRef.current) return;
    const update = () => {
      if (!btnRef.current) return;
      const vw = window.innerWidth;
      const vh = window.innerHeight;

      if (vw < SHEET_MAX_VIEWPORT) {
        setPos({ mode: 'sheet', maxHeight: Math.max(POPUP_MIN_HEIGHT, vh - VIEWPORT_MARGIN * 2) });
        return;
      }

      const r = btnRef.current.getBoundingClientRect();
      const width = Math.min(Math.max(r.width, POPUP_MIN_WIDTH), vw - VIEWPORT_MARGIN * 2);
      const spaceBelow = vh - r.bottom - 12;
      const spaceAbove = r.top - 12;
      const flip = spaceBelow < POPUP_MIN_HEIGHT && spaceAbove > spaceBelow;
      const maxHeight = Math.max(
        POPUP_MIN_HEIGHT,
        Math.min(POPUP_MAX_HEIGHT, flip ? spaceAbove : spaceBelow),
      );
      const rawTop = flip ? r.top - 4 - maxHeight : r.bottom + 4;
      setPos({
        mode: 'popover',
        top: Math.max(VIEWPORT_MARGIN, Math.min(rawTop, vh - maxHeight - VIEWPORT_MARGIN)),
        left: Math.max(VIEWPORT_MARGIN, Math.min(r.left, vw - width - VIEWPORT_MARGIN)),
        width,
        maxHeight,
      });
    };
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [open]);

  // Fermeture click-outside. Le choix est déjà commité, fermer ne perd rien.
  // Capture + stopPropagation : le geste qui congédie le popup est CONSOMMÉ par lui.
  // Sans ça, un tap sur la zone sombre d'une modale hôte ferme le popup ET est vu par
  // le backdrop, qui referme la modale entière (cf. ModalBackdrop). La phase de capture
  // garantit l'ordre quelle que soit l'imbrication des portails.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as HTMLElement | null;
      if (!t) return;
      if (t.closest('[data-dtp-popup]')) return;
      if (t.closest('[data-dtp-button]')) return;
      setOpen(false);
      e.stopPropagation();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setOpen(false);
      e.stopPropagation();
    };
    document.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  const presets = useMemo(() => {
    if (presetMode === 'none') return [];
    // Ancré sur l'instant d'ouverture : les presets sont relatifs à « maintenant », il
    // faut donc les recalculer à chaque ouverture — pas une fois pour la vie du champ.
    const now = openedAt > 0 ? new Date(openedAt) : new Date();

    if (presetMode === 'end') {
      const anchor = fromLocalString(anchorIso ?? '') ?? now;
      return [
        { label: '+1h', date: new Date(anchor.getTime() + 60 * 60 * 1000) },
        { label: '+2h', date: new Date(anchor.getTime() + 2 * 60 * 60 * 1000) },
        { label: '+3h', date: new Date(anchor.getTime() + 3 * 60 * 60 * 1000) },
      ];
    }

    const out: Array<{ label: string; date: Date }> = [];

    // "Ce soir 20h" si on est encore avant 20h, sinon "Demain 20h" avec label adapté.
    const tonight = new Date(now);
    tonight.setHours(20, 0, 0, 0);
    if (tonight.getTime() > now.getTime()) {
      out.push({ label: 'Ce soir 20h', date: tonight });
    } else {
      const tmr20 = new Date(tonight);
      tmr20.setDate(tmr20.getDate() + 1);
      out.push({ label: 'Demain 20h', date: tmr20 });
    }

    // "Demain 21h"
    const tmr21 = new Date(now);
    tmr21.setDate(tmr21.getDate() + 1);
    tmr21.setHours(21, 0, 0, 0);
    out.push({ label: 'Demain 21h', date: tmr21 });

    // "Samedi 20h", prochain samedi ; si on est samedi, samedi prochain.
    const sat = new Date(now);
    const dayIdx = sat.getDay(); // 0 = dim, 6 = sam
    const daysUntilSat = ((6 - dayIdx + 7) % 7) || 7;
    sat.setDate(sat.getDate() + daysUntilSat);
    sat.setHours(20, 0, 0, 0);
    out.push({ label: 'Samedi 20h', date: sat });

    // "Dans 1h" arrondi au quart d'heure supérieur.
    const in1h = new Date(now.getTime() + 60 * 60 * 1000);
    const rem = in1h.getMinutes() % 15;
    if (rem !== 0) in1h.setMinutes(in1h.getMinutes() + (15 - rem), 0, 0);
    else in1h.setSeconds(0, 0);
    out.push({ label: 'Dans 1h', date: in1h });

    return out;
  }, [presetMode, anchorIso, openedAt]);

  function selectPreset(d: Date) {
    onChange(toLocalString(d));
    setOpen(false);
  }

  // Grille du mois (semaine lundi-first)
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const firstDayJs = new Date(viewYear, viewMonth, 1).getDay();
  const offset = (firstDayJs + 6) % 7;
  const cells: Array<number | null> = [];
  for (let i = 0; i < offset; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);

  const todayKey = (() => {
    const n = new Date();
    return `${n.getFullYear()}-${pad(n.getMonth() + 1)}-${pad(n.getDate())}`;
  })();
  const monthLabel = new Date(viewYear, viewMonth, 1)
    .toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })
    .toUpperCase();

  const minDate = fromLocalString(min ?? '');
  function isDayDisabled(d: number): boolean {
    if (!minDate) return false;
    const end = new Date(viewYear, viewMonth, d, 23, 59);
    return end < minDate;
  }

  // Commit direct : appelé par chaque setter (jour / heure / minute).
  // N'émet jamais une valeur invalide : le parent fait `new Date(value)` et un
  // "NaN-NaN-NaNTNaN:NaN" lèverait un RangeError à la soumission.
  function commit(nextDayKey: string, nextHour: number, nextMinute: number) {
    const [y, m, d] = nextDayKey.split('-').map(Number);
    if (![y, m, d, nextHour, nextMinute].every(Number.isFinite)) return;
    const next = new Date(y, m - 1, d, nextHour, nextMinute);
    if (Number.isNaN(next.getTime())) return;
    onChange(toLocalString(next));
  }

  function selectDay(key: string) {
    setDayKey(key);
    commit(key, hour, minute);
  }

  function selectHour(h: number) {
    setHour(h);
    commit(dayKey, h, minute);
  }

  function selectMinute(m: number) {
    setMinute(m);
    commit(dayKey, hour, m);
  }

  const displayText = value ? formatDisplay(value) : '';

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        data-dtp-button
        disabled={disabled}
        onClick={() => { if (open) setOpen(false); else openPicker(); }}
        className="settings-input w-full flex items-center gap-2 text-left"
        style={{ cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.6 : 1 }}
      >
        <CalendarIcon size={12} style={{ color: 'var(--s-text-dim)' }} />
        <span
          className="flex-1 text-xs truncate"
          style={{ color: displayText ? 'var(--s-text)' : 'var(--s-text-muted)' }}
        >
          {displayText || (placeholder ?? 'Choisir date et heure')}
        </span>
      </button>

      {open && pos && (
        <Portal>
          <div
            data-dtp-popup
            className="fixed z-[70] bevel-sm flex flex-col"
            style={{
              ...(pos.mode === 'sheet'
                ? { left: VIEWPORT_MARGIN, right: VIEWPORT_MARGIN, bottom: VIEWPORT_MARGIN }
                : { top: pos.top, left: pos.left, width: pos.width }),
              maxHeight: pos.maxHeight,
              background: 'var(--s-surface)',
              border: '1px solid var(--s-border)',
              boxShadow: '0 12px 32px rgba(0,0,0,0.55)',
            } satisfies CSSProperties}
          >
            <div className="overflow-y-auto" style={{ padding: '14px' }}>
              {presets.length > 0 && (
                <div className="mb-3">
                  <p className="t-label mb-1.5" style={{ color: 'var(--s-text-muted)' }}>RACCOURCIS</p>
                  <div className="flex flex-wrap gap-1.5">
                    {presets.map(p => (
                      <button
                        key={p.label}
                        type="button"
                        onClick={() => selectPreset(p.date)}
                        className="tag tag-neutral"
                        style={{ cursor: 'pointer', padding: '4px 10px', fontSize: '12px' }}
                      >
                        {p.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex items-center justify-between mb-2">
                <button
                  type="button"
                  onClick={() => {
                    if (viewMonth === 0) { setViewMonth(11); setViewYear(y => y - 1); }
                    else { setViewMonth(m => m - 1); }
                  }}
                  className="p-1 hover:bg-[var(--s-hover)]"
                  style={{ cursor: 'pointer' }}
                >
                  <ChevronLeft size={13} style={{ color: 'var(--s-text-dim)' }} />
                </button>
                <span className="font-display text-xs tracking-wider">{monthLabel}</span>
                <button
                  type="button"
                  onClick={() => {
                    if (viewMonth === 11) { setViewMonth(0); setViewYear(y => y + 1); }
                    else { setViewMonth(m => m + 1); }
                  }}
                  className="p-1 hover:bg-[var(--s-hover)]"
                  style={{ cursor: 'pointer' }}
                >
                  <ChevronRight size={13} style={{ color: 'var(--s-text-dim)' }} />
                </button>
              </div>

              <div className="grid grid-cols-7 gap-0.5 mb-1">
                {['L', 'M', 'M', 'J', 'V', 'S', 'D'].map((dn, i) => (
                  <div
                    key={i}
                    className="text-center t-label"
                    style={{ color: 'var(--s-text-muted)', fontSize: '12px' }}
                  >
                    {dn}
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-7 gap-0.5 mb-3">
                {cells.map((d, i) => {
                  if (d === null) return <div key={i} />;
                  const key = `${viewYear}-${pad(viewMonth + 1)}-${pad(d)}`;
                  const isSelected = key === dayKey;
                  const isToday = key === todayKey;
                  const dis = isDayDisabled(d);
                  return (
                    <button
                      key={i}
                      type="button"
                      disabled={dis}
                      onClick={() => selectDay(key)}
                      className="text-center transition-colors duration-150"
                      style={{
                        padding: '6px 0',
                        fontSize: '12px',
                        cursor: dis ? 'not-allowed' : 'pointer',
                        background: isSelected ? 'rgba(255,184,0,0.2)' : 'transparent',
                        border: `1px solid ${
                          isSelected ? 'rgba(255,184,0,0.45)'
                            : isToday ? 'var(--s-border)'
                              : 'transparent'
                        }`,
                        color: dis ? 'var(--s-text-muted)'
                          : isSelected ? 'var(--s-gold)'
                            : isToday ? 'var(--s-text)'
                              : 'var(--s-text-dim)',
                        opacity: dis ? 0.35 : 1,
                        fontWeight: isSelected || isToday ? 600 : 400,
                      }}
                    >
                      {d}
                    </button>
                  );
                })}
              </div>

              <div
                className="flex items-center gap-2 pt-2"
                style={{ borderTop: '1px solid var(--s-border)' }}
              >
                <span className="t-label" style={{ color: 'var(--s-text-muted)' }}>HEURE</span>
                <select
                  value={hour}
                  onChange={e => selectHour(Number(e.target.value))}
                  className="settings-input"
                  style={{ padding: '4px 6px', fontSize: '12px', width: '58px', flex: 'none' }}
                >
                  {Array.from({ length: 24 }, (_, i) => (
                    <option key={i} value={i}>{pad(i)}</option>
                  ))}
                </select>
                <span style={{ color: 'var(--s-text-dim)' }}>:</span>
                <select
                  value={minute}
                  onChange={e => selectMinute(Number(e.target.value))}
                  className="settings-input"
                  style={{ padding: '4px 6px', fontSize: '12px', width: '58px', flex: 'none' }}
                >
                  {[0, 15, 30, 45].map(m => (
                    <option key={m} value={m}>{pad(m)}</option>
                  ))}
                </select>
              </div>
            </div>

            <div
              className="flex justify-end flex-shrink-0"
              style={{ padding: '10px 14px', borderTop: '1px solid var(--s-border)' }}
            >
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="tag tag-neutral"
                style={{ cursor: 'pointer', padding: '4px 12px', fontSize: '12px' }}
              >
                Fermer
              </button>
            </div>
          </div>
        </Portal>
      )}
    </>
  );
}
