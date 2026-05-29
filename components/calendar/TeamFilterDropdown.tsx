'use client';

/**
 * TeamFilterDropdown — Dropdown multi-select pour filtrer le calendar.
 *
 * Extrait de CalendarSection.tsx (Phase 2 refonte technique 29/05).
 * Permet de filtrer les événements par équipe (toutes ou sélection),
 * + audiences spéciales staff/structure-wide.
 *
 * Self-contained : reçoit teams + value + onChange.
 * Persistance gérée par le parent (pas de state local autre que UI : open + recherche).
 */

import { useState } from 'react';
import { Users, ChevronDown, Check } from 'lucide-react';
import { getGameColor } from '@/lib/games-registry';
import type { Team } from './CalendarSection';
import { FILTER_STAFF, FILTER_STRUCTURE } from './CalendarSection';

interface Props {
  teams: Team[];
  value: string[];
  onChange: (next: string[]) => void;
}

export default function TeamFilterDropdown({ teams, value, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');

  // Fermeture au clic dehors : on garde le listener mousedown (compat existante)
  // MAIS on ajoute aussi un overlay invisible plein écran (z lower que le panel)
  // qui intercepte les clics, plus fiable quand des handlers stoppent la
  // propagation (ex: bouton "Réinitialiser" en dehors du root).

  const query = q.trim().toLowerCase();
  // Même ordre que l'onglet Équipes : par groupe (groupOrder, label) puis order, nom.
  const filtered = (query
    ? teams.filter(t => t.name.toLowerCase().includes(query))
    : teams.slice()
  ).sort((a, b) => {
    const ga = a.groupOrder ?? 0, gb = b.groupOrder ?? 0;
    if (ga !== gb) return ga - gb;
    const lc = (a.label ?? '').localeCompare(b.label ?? '');
    if (lc !== 0) return lc;
    const oa = a.order ?? 0, ob = b.order ?? 0;
    if (oa !== ob) return oa - ob;
    return a.name.localeCompare(b.name);
  });

  // Audiences spéciales, au-dessus de la liste des équipes.
  const SPECIALS = [
    { id: FILTER_STRUCTURE, label: 'Toute la structure' },
    { id: FILTER_STAFF, label: 'Staff' },
  ];
  const nameOf = (id: string): string => {
    const sp = SPECIALS.find(s => s.id === id);
    if (sp) return sp.label;
    return teams.find(t => t.id === id)?.name ?? '?';
  };
  const label = value.length === 0
    ? 'Tous'
    : value.length === 1
      ? nameOf(value[0])
      : `${value.length} sélectionnés`;

  const toggle = (id: string) =>
    onChange(value.includes(id) ? value.filter(x => x !== id) : [...value, id]);

  return (
    <div className={`relative ${open ? 'z-40' : 'z-[1]'} px-5 pt-3 flex items-center gap-2`} data-team-filter-root>
      <span className="t-label" style={{ color: 'var(--s-text-muted)' }}>Afficher :</span>
      <button type="button" onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1.5 transition-all duration-150"
        style={{
          background: value.length > 0 ? 'rgba(255,184,0,0.12)' : 'transparent',
          color: value.length > 0 ? 'var(--s-gold)' : 'var(--s-text-dim)',
          border: `1px solid ${value.length > 0 ? 'rgba(255,184,0,0.35)' : 'var(--s-border)'}`,
          cursor: 'pointer', padding: '4px 10px', fontSize: '12px',
          textTransform: 'uppercase', letterSpacing: '0.04em',
        }}>
        <Users size={11} />
        <span>{label}</span>
        <ChevronDown size={11} style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }} />
      </button>
      {value.length > 0 && (
        <button type="button" onClick={() => onChange([])}
          className="text-xs transition-colors duration-150"
          style={{ color: 'var(--s-text-muted)', padding: '2px 6px' }}>
          Réinitialiser
        </button>
      )}
      {open && (
        <div className="fixed inset-0 z-[25]" onClick={() => setOpen(false)} />
      )}
      {open && (
        <div className="absolute left-5 top-full mt-1 z-30 w-[min(280px,calc(100vw-2.5rem))] max-h-[320px] overflow-hidden flex flex-col bevel-sm"
          style={{ background: 'var(--s-surface)', border: '1px solid var(--s-border)', boxShadow: '0 8px 24px rgba(0,0,0,0.4)' }}>
          {teams.length > 6 && (
            <div className="p-2" style={{ borderBottom: '1px solid var(--s-border)' }}>
              <input type="text" value={q} onChange={e => setQ(e.target.value)} autoFocus
                placeholder="Rechercher une équipe..."
                className="settings-input w-full text-xs" />
            </div>
          )}
          <div className="overflow-y-auto flex-1">
            {/* Audiences spéciales : staff, structure entière */}
            <div style={{ borderBottom: '1px solid var(--s-border)' }}>
              {SPECIALS.map(sp => {
                const selected = value.includes(sp.id);
                return (
                  <button key={sp.id} type="button" onClick={() => toggle(sp.id)}
                    className="w-full flex items-center gap-2 px-3 py-2 text-left transition-colors duration-150 hover:bg-[var(--s-hover)]">
                    <span className="w-4 h-4 flex items-center justify-center flex-shrink-0"
                      style={{ border: `1px solid ${selected ? 'var(--s-gold)' : 'var(--s-border)'}`, background: selected ? 'rgba(255,184,0,0.15)' : 'transparent' }}>
                      {selected && <Check size={10} style={{ color: 'var(--s-gold)' }} />}
                    </span>
                    <span className="w-1.5 h-1.5 flex-shrink-0" style={{ background: 'var(--s-gold)' }} />
                    <span className="text-xs flex-1 truncate" style={{ color: selected ? 'var(--s-text)' : 'var(--s-text-dim)' }}>{sp.label}</span>
                  </button>
                );
              })}
            </div>
            {/* Équipes */}
            {teams.length === 0 ? null : filtered.length === 0 ? (
              <div className="px-3 py-4 text-center">
                <span className="text-xs" style={{ color: 'var(--s-text-muted)' }}>Aucune équipe.</span>
              </div>
            ) : filtered.map(t => {
              const selected = value.includes(t.id);
              const color = getGameColor(t.game);
              return (
                <button key={t.id} type="button" onClick={() => toggle(t.id)}
                  className="w-full flex items-center gap-2 px-3 py-2 text-left transition-colors duration-150 hover:bg-[var(--s-hover)]">
                  <span className="w-4 h-4 flex items-center justify-center flex-shrink-0"
                    style={{ border: `1px solid ${selected ? 'var(--s-gold)' : 'var(--s-border)'}`, background: selected ? 'rgba(255,184,0,0.15)' : 'transparent' }}>
                    {selected && <Check size={10} style={{ color: 'var(--s-gold)' }} />}
                  </span>
                  <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: color }} />
                  <span className="text-xs flex-1 truncate" style={{ color: selected ? 'var(--s-text)' : 'var(--s-text-dim)' }}>{t.name}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
