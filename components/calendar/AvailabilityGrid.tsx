'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Copy, Check, AlertTriangle, ChevronsUpDown, ChevronsDownUp, X } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/components/ui/Toast';
import { api } from '@/lib/api-client';
import {
  addDays,
  generateWeekGrid,
  slotsBetween,
  type DayGrid,
  type WeekGrid,
} from '@/lib/availability';

export const AVAILABILITY_QUERY_KEY = ['availability', 'me'] as const;

// Jours affichés en colonnes
const DAY_LABELS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];

const AUTOSAVE_DELAY_MS = 2000;

const WEEKS = ['current', 'next'] as const;
type Which = (typeof WEEKS)[number];

// pending = saisie locale pas encore partie · saving = requête en vol ·
// saved = confirmé par le serveur · error = rien n'a été écrit.
type SaveStatus = 'idle' | 'pending' | 'saving' | 'saved' | 'error';

// Plage horaire globale pour l'axe Y : 8h → 02h (18h × 2 = 36 slots).
// Tous les jours ont désormais le même horaire (cf. DAY_SCHEDULES).
function buildTimeAxis(): { hh: string; mm: string; label: string }[] {
  const out: { hh: string; mm: string; label: string }[] = [];
  // 08:00 → 23:30
  for (let h = 8; h < 24; h++) {
    for (const m of [0, 30]) {
      const hh = h < 10 ? `0${h}` : `${h}`;
      const mm = m === 0 ? '00' : '30';
      out.push({ hh, mm, label: `${hh}:${mm}` });
    }
  }
  // 00:00 → 01:30 (du lendemain)
  for (let h = 0; h < 2; h++) {
    for (const m of [0, 30]) {
      const hh = `0${h}`;
      const mm = m === 0 ? '00' : '30';
      out.push({ hh, mm, label: `${hh}:${mm}` });
    }
  }
  return out;
}

const TIME_AXIS = buildTimeAxis();

// Vue « soirée » par défaut : 16h → 00h (16 lignes) au lieu des 36 de la
// journée complète. La saisie de dispos amateur se fait le soir ; 36 lignes à
// taper sur mobile = pénible (retour Matt). Le bouton « Afficher toute la
// journée » révèle l'axe complet (08h → 01h30) pour les rares dispos de jour.
const EVENING_START_IDX = TIME_AXIS.findIndex(a => a.hh === '16' && a.mm === '00');
const EVENING_END_IDX = TIME_AXIS.findIndex(a => a.hh === '00' && a.mm === '00'); // exclusif → dernière ligne = 23:30
const TIME_AXIS_EVENING = TIME_AXIS.slice(EVENING_START_IDX, EVENING_END_IDX);

// Pour une journée donnée (gridYmd + sa plage horaire), retourne la chaîne de slot
// qui correspond à une heure de l'axe Y, ou null si ce créneau n'est pas valide ce jour-là.
function slotForCell(day: DayGrid, hh: string, mm: string): string | null {
  const timeStr = `${hh}:${mm}`;
  // Les heures après minuit appartiennent à "lendemain" mais sont rattachées visuellement au jour
  const hourNum = parseInt(hh, 10);
  const afterMidnight = hourNum < 6;
  const dateYmd = afterMidnight ? addDays(day.gridYmd, 1) : day.gridYmd;
  const candidate = `${dateYmd}T${timeStr}`;
  return day.slots.includes(candidate) ? candidate : null;
}

// Décale tous les slots d'une semaine de +7 jours (copie vers la semaine suivante).
function shiftSlots(slots: Set<string>, days: number): Set<string> {
  const out = new Set<string>();
  for (const s of slots) {
    const [datePart, timePart] = s.split('T');
    out.add(`${addDays(datePart, days)}T${timePart}`);
  }
  return out;
}

type WeekData = {
  mondayYmd: string;
  weekId: string;
  slots: string[];
};

export type ApiResponse = {
  today: string;
  previous: WeekData;
  current: WeekData;
  next: WeekData;
};

type SaveResponse = { weeks?: WeekData[] };

export default function AvailabilityGrid() {
  const { firebaseUser } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();

  // Query partagée avec AvailabilityCollapsible
  const { data, isPending: loading } = useQuery({
    queryKey: AVAILABILITY_QUERY_KEY,
    queryFn: () => api<ApiResponse>('/api/availability/me'),
    enabled: !!firebaseUser,
  });

  // État local des slots (Set de strings) par semaine, permet l'édition sans rerequests
  const [currentSet, setCurrentSet] = useState<Set<string>>(new Set());
  const [nextSet, setNextSet] = useState<Set<string>>(new Set());
  const [status, setStatus] = useState<Record<Which, SaveStatus>>({ current: 'idle', next: 'idle' });
  // Vue soirée (16h→00h) par défaut, partagée par les deux semaines. Toggle en tête.
  const [showFullDay, setShowFullDay] = useState(false);

  // Miroirs synchrones de la saisie : l'auto-save part d'un timer ou du démontage,
  // hors cycle de rendu, et doit lire le dernier état coché.
  const setsRef = useRef<Record<Which, Set<string>>>({ current: new Set(), next: new Set() });
  // dirty = modifié localement, pas encore envoyé · inFlight = envoyé, pas encore confirmé.
  // Tant que l'un des deux est levé sur une semaine, la resync serveur ne doit PAS y
  // toucher : réinjecter une valeur serveur périmée est ce qui effaçait la saisie.
  const dirtyRef = useRef<Record<Which, boolean>>({ current: false, next: false });
  const inFlightRef = useRef<Record<Which, boolean>>({ current: false, next: false });
  const mondaysRef = useRef<Record<Which, string>>({ current: '', next: '' });
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);
  const flushRef = useRef<() => void>(() => {});

  // Sync du state local d'édition avec les données serveur (initial + refetch)
  useEffect(() => {
    if (!data) return;
    for (const which of WEEKS) {
      // Une semaine avec de la saisie en attente garde aussi SA date : si les
      // semaines ont glissé (bascule du lundi pendant la saisie), un refus serveur
      // vaut mieux qu'une écriture de créneaux dans la mauvaise semaine.
      if (dirtyRef.current[which] || inFlightRef.current[which]) continue;
      mondaysRef.current[which] = data[which].mondayYmd;
      const slots = new Set(data[which].slots);
      setsRef.current[which] = slots;
      // eslint-disable-next-line react-hooks/set-state-in-effect -- resync volontaire du state local d'édition à chaque (re)fetch React Query ; le serveur reste la source de vérité pour les semaines sans saisie en attente
      if (which === 'current') setCurrentSet(slots); else setNextSet(slots);
    }
  }, [data]);

  function markStatus(list: Which[], value: SaveStatus) {
    if (!mountedRef.current || list.length === 0) return;
    setStatus(prev => {
      const out = { ...prev };
      for (const w of list) out[w] = value;
      return out;
    });
  }

  function schedule() {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      flushRef.current();
    }, AUTOSAVE_DELAY_MS);
  }

  // Recale le state local + le cache sur ce que le serveur a réellement écrit
  // (il refuse les slots invalides et réinjecte les jours passés figés).
  function applyServerWeeks(weeks: WeekData[]) {
    const fresh = qc.getQueryData<ApiResponse>(AVAILABILITY_QUERY_KEY);
    for (const w of weeks) {
      const which: Which | null = !fresh ? null
        : w.mondayYmd === fresh.current.mondayYmd ? 'current'
        : w.mondayYmd === fresh.next.mondayYmd ? 'next'
        : null;
      if (!which) continue;
      // Le joueur a re-coché pendant l'envoi : sa saisie est plus fraîche que la réponse.
      if (dirtyRef.current[which]) continue;
      const slots = new Set(w.slots);
      setsRef.current[which] = slots;
      if (mountedRef.current) {
        if (which === 'current') setCurrentSet(slots); else setNextSet(slots);
      }
    }
    // Le cache alimente le résumé de MES DISPOS, qui reste monté quand la grille est repliée.
    qc.setQueryData<ApiResponse>(AVAILABILITY_QUERY_KEY, (prev) => {
      if (!prev) return prev;
      let out = prev;
      for (const w of weeks) {
        if (w.mondayYmd === prev.current.mondayYmd) out = { ...out, current: { ...out.current, slots: w.slots } };
        else if (w.mondayYmd === prev.next.mondayYmd) out = { ...out, next: { ...out.next, slots: w.slots } };
      }
      return out;
    });
  }

  function flush() {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
    // Une semaine déjà en vol n'est pas renvoyée en parallèle : deux écritures
    // concurrentes sur le même doc peuvent atterrir dans le désordre. La fin du vol
    // réarme l'envoi si elle est encore dirty.
    const sending = WEEKS.filter(w => dirtyRef.current[w] && !inFlightRef.current[w] && mondaysRef.current[w]);
    if (sending.length === 0) return;

    for (const w of sending) {
      dirtyRef.current[w] = false;
      inFlightRef.current[w] = true;
    }
    markStatus(sending, 'saving');

    api<SaveResponse>('/api/availability/me', {
      method: 'PUT',
      body: {
        weeks: sending.map(w => ({
          mondayYmd: mondaysRef.current[w],
          slots: Array.from(setsRef.current[w]),
        })),
      },
    }).then(
      // Deux arguments plutôt qu'un .catch() : un throw du handler de succès ne doit
      // pas être rapporté comme un échec d'enregistrement.
      (res) => {
        for (const w of sending) inFlightRef.current[w] = false;
        applyServerWeeks(res.weeks ?? []);
        // Un 200 = la transaction serveur a écrit toutes les semaines envoyées.
        markStatus(sending.filter(w => !dirtyRef.current[w]), 'saved');
        if (WEEKS.some(w => dirtyRef.current[w])) {
          // Démonté : plus aucun rendu ne réarmera le timer, on renvoie tout de suite.
          if (mountedRef.current) schedule(); else flush();
        }
      },
      (err: Error) => {
        // Rien n'a été écrit : la saisie repasse "à envoyer" pour que la resync
        // serveur ne l'écrase pas, et on ne réarme pas de retry automatique
        // (un payload refusé boucherait la boucle toutes les 2 s).
        for (const w of sending) {
          inFlightRef.current[w] = false;
          dirtyRef.current[w] = true;
        }
        markStatus(sending, 'error');
        toast.error(err.message || "Tes dispos n'ont pas pu être enregistrées.");
      },
    );
  }

  useEffect(() => {
    flushRef.current = flush;
  });

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      // Replier MES DISPOS démonte la grille : sans ce flush, une saisie de moins
      // de 2 s partirait avec le composant.
      flushRef.current();
    };
  }, []);

  function commit(which: Which, slots: Set<string>) {
    setsRef.current[which] = slots;
    if (which === 'current') setCurrentSet(slots); else setNextSet(slots);
    dirtyRef.current[which] = true;
    markStatus([which], 'pending');
    schedule();
  }

  function toggle(which: Which, slot: string) {
    const slots = new Set(setsRef.current[which]);
    if (slots.has(slot)) slots.delete(slot);
    else slots.add(slot);
    commit(which, slots);
  }

  // Sélection par plage (tap mobile) : ajoute OU retire toute une plage d'un
  // coup, sans dépendre de l'état individuel de chaque case (≠ toggle).
  function setRange(which: Which, slotList: string[], selected: boolean) {
    if (slotList.length === 0) return;
    const slots = new Set(setsRef.current[which]);
    for (const s of slotList) { if (selected) slots.add(s); else slots.delete(s); }
    commit(which, slots);
  }

  function copyFromPrevious() {
    if (!data) return;
    // Décaler vers la semaine courante (+7 jours)
    const shifted = shiftSlots(new Set(data.previous.slots), 7);
    // Merger avec les slots past déjà figés (slots dont la date < today), on ne doit pas les écraser
    // (l'API les réinjecte de toute façon, mais visuellement on veut voir la fusion)
    const merged = new Set<string>();
    for (const s of setsRef.current.current) {
      if (data.today && s.slice(0, 10) < data.today) merged.add(s);
    }
    for (const s of shifted) merged.add(s);
    commit('current', merged);
  }

  function copyFromCurrent() {
    commit('next', shiftSlots(setsRef.current.current, 7));
  }

  if (loading || !data) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 size={20} className="animate-spin" style={{ color: 'var(--s-text-dim)' }} />
      </div>
    );
  }

  const currentGrid = generateWeekGrid(data.current.mondayYmd, data.today);
  const nextGrid = generateWeekGrid(data.next.mondayYmd, data.today);

  return (
    <div className="space-y-8">
      {/* Intro */}
      <div className="bevel p-5 animate-fade-in" style={{ background: 'var(--s-surface)', border: '1px solid var(--s-border)' }}>
        <p className="text-base" style={{ color: 'var(--s-text-dim)' }}>
          Indique quand tu es dispo pour jouer. Chaque case = 30 minutes. Le staff de ton équipe verra ces créneaux pour proposer des matchs et entraînements. Tes modifications sont enregistrées automatiquement, il n&apos;y a rien à valider.
        </p>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 mt-4 text-sm" style={{ color: 'var(--s-text-muted)' }}>
          <span className="flex items-center gap-2">
            <span className="inline-block" style={{ width: '16px', height: '14px', background: 'rgba(255,184,0,0.40)', border: '1px solid rgba(255,184,0,0.65)' }} />
            Dispo
          </span>
          <span className="flex items-center gap-2">
            <span className="inline-block" style={{ width: '16px', height: '14px', background: 'var(--s-elevated)', border: '1px solid var(--s-bg)' }} />
            Non dispo
          </span>
          <span style={{ color: 'var(--s-text-dim)' }}>
            · À la souris, <strong style={{ color: 'var(--s-text)' }}>clic maintenu + glissé</strong> coche plusieurs cases d&apos;un coup. Sur mobile, <strong style={{ color: 'var(--s-text)' }}>touche le début puis la fin</strong> d&apos;une plage.
          </span>
        </div>
      </div>

      {/* Bascule vue soirée (16h→00h) / journée complète, partagée par les deux
          semaines. Placée au-dessus des grilles, là où on décide de l'amplitude. */}
      <div className="flex justify-end -mb-2">
        <button type="button"
          onClick={() => setShowFullDay(v => !v)}
          className="btn-springs bevel-sm flex items-center gap-2 px-3 py-2"
          style={{
            fontSize: '13px',
            background: 'transparent',
            border: '1px solid var(--s-border)',
            color: 'var(--s-text-dim)',
            cursor: 'pointer',
          }}>
          {showFullDay ? <ChevronsDownUp size={14} /> : <ChevronsUpDown size={14} />}
          {showFullDay ? 'Réduire aux soirées (16h–00h)' : 'Afficher toute la journée'}
        </button>
      </div>

      {/* Stack par défaut, 2 colonnes côte à côte à partir de 1700px (au-dessous,
          la table interne minWidth:640px ne tient pas dans la moitié de l'espace
          avec la sidebar 260px et déclencherait un scroll horizontal interdit). */}
      <div className="grid grid-cols-1 gap-8 [@media(min-width:1700px)]:grid-cols-2 [@media(min-width:1700px)]:gap-6">
        <WeekPanel
          title="SEMAINE COURANTE"
          weekGrid={currentGrid}
          slots={currentSet}
          onToggle={(slot) => toggle('current', slot)}
          onSetRange={(list, selected) => setRange('current', list, selected)}
          showFullDay={showFullDay}
          status={status.current}
          onRetry={() => flushRef.current()}
          copyLabel={data.previous.slots.length > 0 ? 'Copier semaine précédente' : null}
          onCopy={copyFromPrevious}
          today={data.today}
        />

        <WeekPanel
          title="SEMAINE SUIVANTE"
          weekGrid={nextGrid}
          slots={nextSet}
          onToggle={(slot) => toggle('next', slot)}
          onSetRange={(list, selected) => setRange('next', list, selected)}
          showFullDay={showFullDay}
          status={status.next}
          onRetry={() => flushRef.current()}
          copyLabel={currentSet.size > 0 ? 'Copier semaine courante' : null}
          onCopy={copyFromCurrent}
          today={data.today}
        />
      </div>
    </div>
  );
}

// ─── Indicateur d'auto-save ──────────────────────────────────────────────────

function SaveIndicator({ status, onRetry }: { status: SaveStatus; onRetry: () => void }) {
  if (status === 'idle') return null;

  if (status === 'error') {
    return (
      <div className="flex items-center gap-2" style={{ fontSize: '13px' }}>
        <AlertTriangle size={14} style={{ color: '#ef4444' }} />
        <span style={{ color: 'var(--s-text)' }}>Enregistrement impossible</span>
        <button type="button" onClick={onRetry}
          className="btn-springs bevel-sm px-3 py-1"
          style={{
            fontSize: '13px',
            background: 'transparent',
            border: '1px solid var(--s-border)',
            color: 'var(--s-text-dim)',
            cursor: 'pointer',
          }}>
          Réessayer
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2" style={{ fontSize: '13px', color: 'var(--s-text-dim)' }}>
      {status === 'saving' && <Loader2 size={14} className="animate-spin" />}
      {status === 'saved' && <Check size={14} />}
      {status === 'pending' ? 'Modifications en attente' : status === 'saving' ? 'Enregistrement…' : 'Enregistré'}
    </div>
  );
}

// ─── Week panel ──────────────────────────────────────────────────────────────

function WeekPanel({
  title,
  weekGrid,
  slots,
  onToggle,
  onSetRange,
  showFullDay,
  status,
  onRetry,
  copyLabel,
  onCopy,
  today,
}: {
  title: string;
  weekGrid: WeekGrid;
  slots: Set<string>;
  onToggle: (slot: string) => void;
  onSetRange: (slotList: string[], selected: boolean) => void;
  showFullDay: boolean;
  status: SaveStatus;
  onRetry: () => void;
  copyLabel: string | null;
  onCopy: () => void;
  today: string;
}) {
  // Drag mode : true si on est en train de draguer, intent = add | remove selon premier clic
  const dragModeRef = useRef<'add' | 'remove' | null>(null);
  const [dragActive, setDragActive] = useState(false);

  // Mobile (< sm) : la grille passe en largeur fluide (colonnes réparties sur
  // 100%) au lieu de 640px fixe + scroll horizontal, interdit sur le site.
  const [isNarrow, setIsNarrow] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 639px)');
    const apply = () => setIsNarrow(mq.matches);
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, []);

  useEffect(() => {
    function onUp() {
      dragModeRef.current = null;
      setDragActive(false);
    }
    window.addEventListener('mouseup', onUp);
    window.addEventListener('touchend', onUp);
    return () => {
      window.removeEventListener('mouseup', onUp);
      window.removeEventListener('touchend', onUp);
    };
  }, []);

  // Axe Y visible : soirée (16h→00h) par défaut, journée complète si déplié.
  const visibleAxis = showFullDay ? TIME_AXIS : TIME_AXIS_EVENING;

  // Sélection par plage au tap (mobile) : ancre = 1er tap, la plage se confirme
  // au 2e tap dans la même colonne. On ne stocke QUE l'ancre ; l'intent (cocher
  // ou décocher) se déduit de l'état de la case ancre au moment de confirmer.
  const [anchor, setAnchor] = useState<{ gridYmd: string; slot: string } | null>(null);

  // Pour chaque jour, la colonne de slots SÉLECTIONNABLES (non passés) dans
  // l'ordre visible top→bottom : base de slotsBetween pour la plage.
  const orderedSlotsByDay = useMemo(() => {
    const map: Record<string, string[]> = {};
    for (const day of weekGrid.days) {
      const arr: string[] = [];
      for (const axis of visibleAxis) {
        const slot = slotForCell(day, axis.hh, axis.mm);
        if (!slot) continue;
        if (day.isPast || slot.slice(0, 10) < today) continue;
        arr.push(slot);
      }
      map[day.gridYmd] = arr;
    }
    return map;
  }, [weekGrid, visibleAxis, today]);

  function handleTap(gridYmd: string, slot: string) {
    // Pas d'ancre, ou ancre dans une autre colonne → (ré)arme sur cette case.
    if (!anchor || anchor.gridYmd !== gridYmd) { setAnchor({ gridYmd, slot }); return; }
    const range = slotsBetween(orderedSlotsByDay[gridYmd] ?? [], anchor.slot, slot);
    // Ancre devenue invisible (repli de la grille entre les deux taps) → ré-arme.
    if (range.length === 0) { setAnchor({ gridYmd, slot }); return; }
    // Intent : si la case ancre est déjà cochée, la plage se DÉcoche, sinon elle se coche.
    onSetRange(range, !slots.has(anchor.slot));
    setAnchor(null);
  }

  const monday = new Date(weekGrid.mondayYmd + 'T12:00:00');
  const sunday = new Date(addDays(weekGrid.mondayYmd, 6) + 'T12:00:00');
  const rangeLabel = `${monday.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' })}, ${sunday.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' })}`;

  const countSelected = useMemo(() => {
    let c = 0;
    for (const day of weekGrid.days) for (const s of day.slots) if (slots.has(s)) c++;
    return c;
  }, [slots, weekGrid]);

  const isEmpty = countSelected === 0;

  return (
    <div className="bevel animate-fade-in-d1 relative overflow-hidden" style={{
      background: 'var(--s-surface)',
      border: '1px solid var(--s-border)',
    }}>
      <div className="h-[3px]" style={{
        background: 'linear-gradient(90deg, var(--s-gold), rgba(255,184,0,0.4), transparent 70%)',
      }} />
      <div className="p-5">
        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-3 mb-5">
          <div>
            <h3 className="font-display text-2xl" style={{ letterSpacing: '0.03em' }}>
              {title}
            </h3>
            <p className="t-mono mt-1.5" style={{ fontSize: '13px', color: 'var(--s-text-dim)' }}>
              {rangeLabel} · {countSelected} créneaux sélectionnés
            </p>
          </div>
          <div className="flex items-center gap-4">
            {copyLabel && (
              <button type="button" onClick={onCopy}
                className="btn-springs bevel-sm flex items-center gap-2 px-4 py-2"
                style={{
                  fontSize: '13px',
                  background: isEmpty ? 'rgba(255,184,0,0.12)' : 'transparent',
                  border: isEmpty ? '1px solid rgba(255,184,0,0.4)' : '1px solid var(--s-border)',
                  color: isEmpty ? 'var(--s-gold)' : 'var(--s-text-dim)',
                  cursor: 'pointer',
                  fontWeight: isEmpty ? 600 : 400,
                }}>
                <Copy size={14} /> {copyLabel}
              </button>
            )}
          </div>
        </div>

        {/* État de sauvegarde. Hauteur RÉSERVÉE, et hors du header en flex-wrap :
            son apparition ne doit jamais décaler la grille. Sinon, un clic maintenu
            sur une case voit la grille glisser sous le curseur et peint la voisine
            (constaté au test : 1 clic → 2 créneaux). */}
        <div className="mb-3 flex items-center" style={{ minHeight: 22 }}>
          <SaveIndicator status={status} onRetry={onRetry} />
        </div>

        {/* Guide de sélection par plage (mobile). Les DEUX états ont une hauteur
            FIXE identique (40px) + nowrap : le texte ne peut jamais passer sur 2
            lignes selon la largeur du téléphone, donc le bloc ne change JAMAIS de
            hauteur entre le 1er et le 2e tap. Sinon la grille glisse sous le doigt
            et le 2e tap tombe sur la mauvaise case (bug remonté par Matt : un
            minHeight ne suffit pas, un écran étroit fait wrapper le texte idle). */}
        {isNarrow && (
          <div className="mb-3">
            {anchor ? (
              <div className="flex items-center justify-between gap-2 px-3 bevel-sm"
                style={{ height: 40, background: 'rgba(255,184,0,0.10)', border: '1px solid rgba(255,184,0,0.35)', fontSize: '13px', color: 'var(--s-gold)', whiteSpace: 'nowrap', overflow: 'hidden' }}>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>Touche la fin de la plage</span>
                <button type="button" onClick={() => setAnchor(null)}
                  className="flex items-center gap-1 flex-shrink-0"
                  style={{ color: 'var(--s-text-dim)', cursor: 'pointer' }}>
                  <X size={13} /> Annuler
                </button>
              </div>
            ) : (
              <div className="flex items-center px-3 bevel-sm"
                style={{ height: 40, background: 'var(--s-elevated)', border: '1px solid var(--s-border)', fontSize: '13px', color: 'var(--s-text-muted)', whiteSpace: 'nowrap', overflow: 'hidden' }}>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>Touche le début puis la fin d&apos;une plage.</span>
              </div>
            )}
          </div>
        )}

        {/* Grid */}
        <div className="overflow-x-auto">
          <table className="border-collapse" style={{
            minWidth: isNarrow ? 0 : '640px',
            width: isNarrow ? '100%' : 'auto',
            tableLayout: isNarrow ? 'fixed' : 'auto',
            userSelect: 'none',
          }}>
            <thead>
              <tr>
                <th style={{ width: isNarrow ? 44 : 64 }} />
                {weekGrid.days.map((day, i) => {
                  const date = new Date(day.gridYmd + 'T12:00:00');
                  const dayLabel = DAY_LABELS[i];
                  const dayNum = date.getDate();
                  return (
                    <th key={day.gridYmd} className="t-label pb-3" style={{
                      fontSize: '12px',
                      color: day.isPast ? 'var(--s-text-muted)' : 'var(--s-text-dim)',
                      fontWeight: 600,
                      width: isNarrow ? 'auto' : '76px',
                      opacity: day.isPast ? 0.5 : 1,
                    }}>
                      <div>{dayLabel}</div>
                      <div className="font-display text-xl" style={{ letterSpacing: '0.02em' }}>{dayNum}</div>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {visibleAxis.map((axis, rowIdx) => {
                const isHourStart = axis.mm === '00';
                const ROW_HEIGHT = 22;
                return (
                <tr key={rowIdx}>
                  {/* Colonne des heures : label "17:00" positionné au niveau du bord
                     supérieur de la case 17:00 → 17:30, avec un offset négatif pour
                     que le milieu du texte soit ALIGNÉ sur la ligne de séparation
                     horaire (visuellement « sur » la frontière entre deux heures). */}
                  <td className="t-mono text-right pr-3" style={{
                    fontSize: '12px',
                    color: 'var(--s-text-dim)',
                    verticalAlign: 'top',
                    lineHeight: 1,
                    fontWeight: 500,
                    position: 'relative',
                    height: `${ROW_HEIGHT}px`,
                  }}>
                    {isHourStart && (
                      <span style={{
                        position: 'absolute',
                        right: isNarrow ? '4px' : '12px',
                        top: 0,
                        transform: 'translateY(-50%)',
                        background: 'var(--s-surface)',
                        padding: isNarrow ? '0 2px' : '0 4px',
                        whiteSpace: 'nowrap',
                      }}>
                        {axis.label}
                      </span>
                    )}
                  </td>
                  {weekGrid.days.map((day) => {
                    const slot = slotForCell(day, axis.hh, axis.mm);
                    if (!slot) {
                      return <td key={day.gridYmd} style={{ width: isNarrow ? 'auto' : '76px', height: `${ROW_HEIGHT}px`, background: 'transparent' }} />;
                    }
                    const isSelected = slots.has(slot);
                    const slotDayYmd = slot.slice(0, 10);
                    const isPast = day.isPast || slotDayYmd < today;
                    // Case « armée » : 1er tap d'une plage (mobile). Look distinct
                    // (anneau or 2px, fond léger) pour marquer le changement de
                    // couleur entre le début et la confirmation de la plage.
                    const isArmed = isNarrow && !isPast
                      && anchor?.gridYmd === day.gridYmd && anchor.slot === slot;

                    const bg = isPast
                      ? (isSelected ? 'rgba(255,184,0,0.10)' : 'rgba(255,255,255,0.02)')
                      : isArmed
                        ? 'rgba(255,184,0,0.18)'
                        : isSelected
                          ? 'rgba(255,184,0,0.40)'
                          : 'var(--s-elevated)';
                    const shadow = isArmed
                      ? 'inset 0 0 0 2px var(--s-gold)'
                      : (!isPast && isSelected ? 'inset 0 0 0 1px rgba(255,184,0,0.55)' : 'none');

                    return (
                      <td key={day.gridYmd}
                        // Mobile : sélection par tap (ancre → confirmation de plage).
                        // Desktop : clic maintenu + glissé. Handlers exclusifs pour
                        // qu'un tap synthétique ne déclenche pas le drag.
                        onClick={isNarrow ? () => { if (!isPast) handleTap(day.gridYmd, slot); } : undefined}
                        onMouseDown={!isNarrow ? (e) => {
                          if (isPast) return;
                          e.preventDefault();
                          dragModeRef.current = isSelected ? 'remove' : 'add';
                          setDragActive(true);
                          onToggle(slot);
                        } : undefined}
                        onMouseEnter={!isNarrow ? () => {
                          if (isPast) return;
                          const mode = dragModeRef.current;
                          if (!mode) return;
                          const shouldAdd = mode === 'add';
                          if (shouldAdd && !isSelected) onToggle(slot);
                          else if (!shouldAdd && isSelected) onToggle(slot);
                        } : undefined}
                        style={{
                          width: isNarrow ? 'auto' : '76px',
                          height: `${ROW_HEIGHT}px`,
                          background: bg,
                          boxShadow: shadow,
                          borderLeft: '1px solid var(--s-bg)',
                          borderRight: '1px solid var(--s-bg)',
                          borderTop: isHourStart
                            ? '2px solid rgba(255,255,255,0.14)'
                            : '1px solid rgba(255,255,255,0.04)',
                          borderBottom: 'none',
                          cursor: isPast ? 'not-allowed' : dragActive ? 'grabbing' : 'pointer',
                          opacity: isPast ? 0.5 : 1,
                          transition: 'background-color 100ms, box-shadow 100ms',
                        }}
                      />
                    );
                  })}
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
