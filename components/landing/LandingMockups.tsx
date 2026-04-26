'use client';

import { Trophy, Star, Check, MessageSquare, Bell, Users } from 'lucide-react';

// Mini-mockups CSS-built (pas de screenshots) pour les feature cards.
// Chaque mockup s'intègre dans un cadre 100% × 240px et représente
// fidèlement (en mini) une feature réelle de la plateforme.

// ─────────────────────────────────────────────────────────────────────────
// 1. PROFIL JOUEUR
// ─────────────────────────────────────────────────────────────────────────
export function PlayerProfileMockup() {
  return (
    <MockupFrame>
      <div className="w-full max-w-[280px] mx-auto"
        style={{ background: 'var(--s-surface)', border: '1px solid var(--s-border)', clipPath: 'polygon(8px 0, 100% 0, 100% calc(100% - 8px), calc(100% - 8px) 100%, 0 100%, 0 8px)' }}>
        {/* Bannière fine accent or */}
        <div className="h-[2px]" style={{ background: 'linear-gradient(90deg, var(--s-gold), transparent 80%)' }} />
        <div className="p-3 flex items-start gap-3">
          {/* Avatar */}
          <div className="w-12 h-12 flex-shrink-0 flex items-center justify-center"
            style={{ background: 'linear-gradient(135deg, #5865F2, #4752c4)', color: '#fff', fontWeight: 700, fontSize: 16, fontFamily: 'var(--font-bebas)' }}>
            T
          </div>
          <div className="flex-1 min-w-0">
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--s-text)', letterSpacing: '0.02em' }}>TYPHOON_RL</div>
            <div className="flex items-center gap-1 mt-0.5">
              <Star size={9} style={{ color: 'var(--s-gold)' }} fill="var(--s-gold)" />
              <span style={{ fontSize: 9, color: 'var(--s-text-dim)' }}>1 247 pts</span>
            </div>
            <div className="flex gap-1 mt-1.5">
              <span className="tag tag-blue" style={{ fontSize: 8, padding: '1px 5px' }}>RL</span>
              <span className="tag tag-green" style={{ fontSize: 8, padding: '1px 5px' }}>TM</span>
            </div>
          </div>
        </div>
        {/* Stats */}
        <div className="px-3 pb-3 space-y-1.5">
          <StatRow label="RL · Champion 2" value="↑ 47" valueColor="#22c55e" />
          <StatRow label="TM · Trackmaster" value="1487" />
        </div>
      </div>
    </MockupFrame>
  );
}

function StatRow({ label, value, valueColor }: { label: string; value: string; valueColor?: string }) {
  return (
    <div className="flex items-center justify-between px-2 py-1.5"
      style={{ background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.04)' }}>
      <span style={{ fontSize: 9, color: 'var(--s-text-dim)' }}>{label}</span>
      <span style={{ fontSize: 9, fontWeight: 700, color: valueColor ?? 'var(--s-text)', fontFamily: 'var(--font-bebas)', letterSpacing: '0.05em' }}>{value}</span>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// 2. ANNUAIRE STRUCTURES
// ─────────────────────────────────────────────────────────────────────────
export function StructuresListMockup() {
  const items = [
    { name: 'ALPHORIA ESPORT', tag: 'ALP', members: 7, color: '#FFB800', recruiting: false },
    { name: 'DELTA MYTHICS', tag: 'DM', members: 12, color: '#0081FF', recruiting: true },
    { name: 'NOVA ESPORT', tag: 'NOV', members: 5, color: '#a364d9', recruiting: false },
  ];
  return (
    <MockupFrame>
      <div className="w-full max-w-[300px] mx-auto space-y-1.5">
        {items.map((s, i) => (
          <div key={s.name} className="flex items-center gap-2.5 px-2.5 py-2"
            style={{
              background: 'var(--s-surface)',
              border: '1px solid var(--s-border)',
              opacity: i === 0 ? 1 : 0.85 - i * 0.15,
            }}>
            <div className="w-7 h-7 flex items-center justify-center flex-shrink-0"
              style={{ background: `${s.color}15`, border: `1px solid ${s.color}30`, color: s.color, fontFamily: 'var(--font-bebas)', fontSize: 10, fontWeight: 700 }}>
              {s.tag.slice(0, 2)}
            </div>
            <div className="flex-1 min-w-0">
              <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--s-text)' }}>{s.name}</div>
              <div className="flex items-center gap-1.5 mt-0.5">
                <span style={{ fontSize: 8, color: 'var(--s-text-muted)' }}>{s.members} membres</span>
              </div>
            </div>
            {s.recruiting && (
              <span className="tag" style={{ fontSize: 7, padding: '1px 5px', background: 'rgba(34,197,94,0.1)', color: '#22c55e', borderColor: 'rgba(34,197,94,0.25)' }}>RECRUTE</span>
            )}
          </div>
        ))}
      </div>
    </MockupFrame>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// 3. CALENDRIER ÉQUIPE
// ─────────────────────────────────────────────────────────────────────────
export function CalendarMockup() {
  const days = ['LUN', 'MAR', 'MER', 'JEU', 'VEN', 'SAM', 'DIM'];
  // Events: [day index 0-6, type, length-cells]
  const events = [
    { day: 0, type: 'training', label: 'Train', col: '#FFB800' },
    { day: 2, type: 'scrim', label: 'Scrim', col: '#0081FF' },
    { day: 4, type: 'match', label: 'Match', col: '#a364d9' },
    { day: 5, type: 'training', label: 'Train', col: '#FFB800' },
  ];
  return (
    <MockupFrame>
      <div className="w-full max-w-[320px] mx-auto"
        style={{ background: 'var(--s-surface)', border: '1px solid var(--s-border)' }}>
        <div className="p-2.5">
          {/* Header semaine */}
          <div className="flex items-center justify-between mb-2">
            <span style={{ fontSize: 9, fontWeight: 700, color: 'var(--s-text)', letterSpacing: '0.05em', fontFamily: 'var(--font-bebas)' }}>SEMAINE 17</span>
            <span style={{ fontSize: 8, color: 'var(--s-text-muted)' }}>5 events</span>
          </div>
          {/* Days header */}
          <div className="grid grid-cols-7 gap-0.5 mb-1">
            {days.map((d, i) => (
              <div key={d} className="text-center"
                style={{ fontSize: 7, color: i === 5 || i === 6 ? 'var(--s-gold)' : 'var(--s-text-muted)', fontWeight: 700, letterSpacing: '0.05em' }}>
                {d}
              </div>
            ))}
          </div>
          {/* Day cells */}
          <div className="grid grid-cols-7 gap-0.5">
            {Array.from({ length: 7 }).map((_, i) => {
              const ev = events.find(e => e.day === i);
              return (
                <div key={i} className="aspect-square flex items-center justify-center"
                  style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.04)' }}>
                  {ev && (
                    <div style={{ width: 6, height: 6, background: ev.col }} />
                  )}
                </div>
              );
            })}
          </div>
          {/* Légende events */}
          <div className="mt-2 space-y-1">
            {events.slice(0, 3).map((ev, i) => (
              <div key={i} className="flex items-center gap-1.5 px-1.5 py-1"
                style={{ background: `${ev.col}10`, borderLeft: `2px solid ${ev.col}` }}>
                <span style={{ fontSize: 7, color: 'var(--s-text-muted)' }}>{days[ev.day]}</span>
                <span style={{ fontSize: 8, color: 'var(--s-text)', fontWeight: 600 }}>{ev.label}</span>
                <span style={{ fontSize: 7, color: 'var(--s-text-muted)', marginLeft: 'auto' }}>20:30</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </MockupFrame>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// 4. RECRUTEMENT — POSTES OUVERTS
// ─────────────────────────────────────────────────────────────────────────
export function RecruitmentMockup() {
  const positions = [
    { role: 'Midfielder', game: 'RL', gameCol: '#0081FF', rank: 'Champion 2+', candidates: 4 },
    { role: 'Goalkeeper', game: 'RL', gameCol: '#0081FF', rank: 'Diamond 3+', candidates: 1 },
  ];
  return (
    <MockupFrame>
      <div className="w-full max-w-[300px] mx-auto space-y-2">
        {positions.map((p, i) => (
          <div key={i} className="px-3 py-2.5"
            style={{ background: 'var(--s-surface)', border: '1px solid var(--s-border)', position: 'relative' }}>
            <div className="absolute top-0 left-0 w-[2px] h-full" style={{ background: 'var(--s-gold)' }} />
            <div className="flex items-center justify-between mb-1.5">
              <div className="flex items-center gap-1.5">
                <span style={{ fontSize: 7, color: 'var(--s-gold)', fontWeight: 700, letterSpacing: '0.05em' }}>POSTE OUVERT</span>
                <span className="tag tag-blue" style={{ fontSize: 7, padding: '0 4px' }}>{p.game}</span>
              </div>
              <span style={{ fontSize: 8, color: 'var(--s-text-muted)' }}>{p.candidates} candidats</span>
            </div>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--s-text)' }}>{p.role}</div>
            <div style={{ fontSize: 8, color: 'var(--s-text-dim)', marginTop: 2 }}>Rang min : {p.rank}</div>
          </div>
        ))}
      </div>
    </MockupFrame>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// 5. ROSTER — SOUS-ÉQUIPES
// ─────────────────────────────────────────────────────────────────────────
export function RosterMockup() {
  const teams = [
    { name: 'ÉQUIPE PRINCIPALE', main: ['T', 'K', 'V'], subs: ['A', 'B'], color: '#FFB800' },
    { name: 'ÉQUIPE B', main: ['M', 'S', 'L'], subs: [], color: '#0081FF' },
  ];
  return (
    <MockupFrame>
      <div className="w-full max-w-[300px] mx-auto space-y-2">
        {teams.map((t) => (
          <div key={t.name} className="px-2.5 py-2"
            style={{ background: 'var(--s-surface)', border: '1px solid var(--s-border)' }}>
            <div className="flex items-center justify-between mb-1.5">
              <span style={{ fontSize: 8, color: t.color, fontWeight: 700, letterSpacing: '0.06em', fontFamily: 'var(--font-bebas)' }}>{t.name}</span>
              <span style={{ fontSize: 7, color: 'var(--s-text-muted)' }}>{t.main.length}+{t.subs.length}</span>
            </div>
            <div className="flex items-center gap-1">
              {t.main.map((avatar, i) => (
                <div key={i} className="w-6 h-6 flex items-center justify-center"
                  style={{ background: `${t.color}15`, border: `1px solid ${t.color}30`, color: t.color, fontWeight: 700, fontSize: 9, fontFamily: 'var(--font-bebas)' }}>
                  {avatar}
                </div>
              ))}
              {t.subs.length > 0 && (
                <>
                  <span style={{ fontSize: 8, color: 'var(--s-text-muted)', margin: '0 4px' }}>+</span>
                  {t.subs.map((avatar, i) => (
                    <div key={i} className="w-6 h-6 flex items-center justify-center"
                      style={{ background: 'rgba(255,255,255,0.02)', border: '1px dashed rgba(255,255,255,0.15)', color: 'var(--s-text-muted)', fontWeight: 700, fontSize: 9, fontFamily: 'var(--font-bebas)' }}>
                      {avatar}
                    </div>
                  ))}
                </>
              )}
            </div>
          </div>
        ))}
      </div>
    </MockupFrame>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// 6. PLANNING PARTAGÉ (multi-équipes)
// ─────────────────────────────────────────────────────────────────────────
export function PlanningMockup() {
  // Bars: [team, color, startCol(1-12), span]
  const teams = [
    { name: 'ÉQUIPE A', color: '#FFB800', bars: [{ start: 1, span: 3, label: 'Train' }, { start: 6, span: 2, label: 'Match' }] },
    { name: 'ÉQUIPE B', color: '#0081FF', bars: [{ start: 3, span: 2, label: 'Scrim' }, { start: 9, span: 3, label: 'Train' }] },
    { name: 'COACHS',   color: '#a364d9', bars: [{ start: 5, span: 4, label: 'Review' }] },
  ];
  return (
    <MockupFrame>
      <div className="w-full max-w-[320px] mx-auto"
        style={{ background: 'var(--s-surface)', border: '1px solid var(--s-border)' }}>
        <div className="p-2.5">
          {/* Header */}
          <div className="flex items-center justify-between mb-2">
            <span style={{ fontSize: 9, fontWeight: 700, color: 'var(--s-text)', letterSpacing: '0.05em', fontFamily: 'var(--font-bebas)' }}>VUE STRUCTURE</span>
            <span style={{ fontSize: 7, color: 'var(--s-text-muted)' }}>3 équipes</span>
          </div>
          {/* Rows */}
          <div className="space-y-1.5">
            {teams.map((t) => (
              <div key={t.name} className="flex items-center gap-2">
                <div style={{ fontSize: 7, color: t.color, fontWeight: 700, width: 56, letterSpacing: '0.04em' }}>{t.name}</div>
                <div className="flex-1 grid grid-cols-12 gap-px relative h-4">
                  {Array.from({ length: 12 }).map((_, i) => (
                    <div key={i} style={{ background: 'rgba(255,255,255,0.025)' }} />
                  ))}
                  {t.bars.map((b, i) => (
                    <div key={i} className="absolute top-0 bottom-0 flex items-center px-1"
                      style={{
                        left: `${((b.start - 1) / 12) * 100}%`,
                        width: `${(b.span / 12) * 100}%`,
                        background: `${t.color}30`,
                        borderLeft: `2px solid ${t.color}`,
                      }}>
                      <span style={{ fontSize: 7, color: 'var(--s-text)', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden' }}>{b.label}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </MockupFrame>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// 7. DISCORD WEBHOOK
// ─────────────────────────────────────────────────────────────────────────
export function DiscordMockup() {
  return (
    <MockupFrame>
      <div className="w-full max-w-[300px] mx-auto"
        style={{ background: '#2b2d31', border: '1px solid rgba(255,255,255,0.08)' }}>
        <div className="px-3 py-2" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
          <span style={{ fontSize: 8, color: '#80848e' }}># annonces-recrutement</span>
        </div>
        <div className="p-3 flex items-start gap-2">
          <div className="w-8 h-8 flex-shrink-0 flex items-center justify-center rounded-full"
            style={{ background: 'var(--s-gold)', color: '#000', fontWeight: 700, fontSize: 12, fontFamily: 'var(--font-bebas)' }}>
            Æ
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 mb-1">
              <span style={{ fontSize: 10, fontWeight: 700, color: '#fff' }}>Aedral Bot</span>
              <span className="px-1 py-px" style={{ fontSize: 6, fontWeight: 700, background: '#5865F2', color: '#fff', borderRadius: 2, letterSpacing: '0.05em' }}>APP</span>
              <span style={{ fontSize: 7, color: '#80848e' }}>aujourd&apos;hui</span>
            </div>
            <div className="border-l-[3px] pl-2 py-1.5"
              style={{ borderColor: 'var(--s-gold)', background: 'rgba(255,255,255,0.03)' }}>
              <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--s-gold)', marginBottom: 2 }}>Nouvelle candidature</div>
              <div style={{ fontSize: 8, color: '#dcddde' }}>TyphoonRL postule au poste Midfielder</div>
              <div className="flex items-center gap-1 mt-1.5">
                <span className="px-1.5 py-0.5" style={{ fontSize: 7, fontWeight: 700, background: '#22c55e', color: '#fff' }}><Check size={7} className="inline" /> Voir</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </MockupFrame>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// FRAME : conteneur uniforme pour tous les mockups
// ─────────────────────────────────────────────────────────────────────────
function MockupFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="mockup-frame relative w-full h-[240px] flex items-center justify-center overflow-hidden"
      style={{
        background: 'linear-gradient(180deg, #0c0c0c 0%, #060606 100%)',
        borderBottom: '1px solid var(--s-border)',
      }}>
      {/* Inner glow subtil */}
      <div className="absolute inset-0 pointer-events-none"
        style={{ boxShadow: 'inset 0 0 80px rgba(0,0,0,0.5)' }} />
      {/* Hex texture très discrète */}
      <div className="absolute inset-0 hex-bg pointer-events-none opacity-30" />
      {/* Content */}
      <div className="relative z-[1] w-full px-4">
        {children}
      </div>
    </div>
  );
}

// Helpers (for icons used inline)
export const _icons = { Trophy, MessageSquare, Bell, Users };
