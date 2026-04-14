'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import {
  Users,
  Shield,
  ArrowRight,
  ChevronRight,
  Loader2,
  Star,
  Plus,
  Megaphone,
} from 'lucide-react';

type StructureSummary = {
  id: string;
  name: string;
  tag: string;
  logoUrl: string;
  games: string[];
  recruiting: { active: boolean; positions: { game: string; role: string }[] };
  memberCount: number;
  createdAt: string | null;
};

type PlayerSummary = {
  uid: string;
  displayName: string;
  discordAvatar: string;
  avatarUrl: string;
  country: string;
  games: string[];
  isAvailableForRecruitment: boolean;
  recruitmentRole: string;
  recruitmentMessage: string;
  rlRank: string;
  pseudoTM: string;
};

const ROLE_LABELS: Record<string, string> = {
  joueur: 'Joueur',
  coach: 'Coach',
  manager: 'Manager',
};

export default function CommunityPage() {
  const [structures, setStructures] = useState<StructureSummary[]>([]);
  const [availablePlayers, setAvailablePlayers] = useState<PlayerSummary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [sRes, pRes] = await Promise.all([
          fetch('/api/structures'),
          fetch('/api/players?recruiting=true'),
        ]);
        if (cancelled) return;
        if (sRes.ok) {
          const data = await sRes.json();
          setStructures(data.structures ?? []);
        }
        if (pRes.ok) {
          const data = await pRes.json();
          setAvailablePlayers(data.players ?? []);
        }
      } catch (err) {
        console.error('[Community] load error:', err);
      }
      if (!cancelled) setLoading(false);
    }
    load();
    return () => { cancelled = true; };
  }, []);

  const recentStructures = [...structures]
    .sort((a, b) => {
      const ad = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const bd = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return bd - ad;
    })
    .slice(0, 6);

  const recruitingStructures = structures.filter(s => s.recruiting?.active).slice(0, 6);
  const topPlayers = availablePlayers.slice(0, 8);

  return (
    <div className="min-h-screen hex-bg px-8 py-8 space-y-8">
      <div className="relative z-[1] space-y-8">

        {/* Header compact */}
        <header
          className="bevel relative overflow-hidden animate-fade-in"
          style={{ background: 'var(--s-surface)', border: '1px solid var(--s-border)' }}
        >
          <div className="h-[3px]" style={{ background: 'linear-gradient(90deg, var(--s-gold), rgba(255,184,0,0.3), transparent 70%)' }} />
          <div className="absolute top-0 left-0 w-[400px] h-[300px] pointer-events-none opacity-[0.05]"
            style={{ background: 'radial-gradient(ellipse at top left, var(--s-gold), transparent 70%)' }} />
          <div className="relative z-[1] px-8 py-6 flex items-center gap-5 flex-wrap">
            <div className="flex items-center gap-3 flex-shrink-0">
              <div className="w-12 h-12 flex items-center justify-center bevel-sm" style={{ background: 'rgba(255,184,0,0.08)', border: '1px solid rgba(255,184,0,0.2)' }}>
                <Users size={22} style={{ color: 'var(--s-gold)' }} />
              </div>
              <div>
                <p className="t-label mb-1" style={{ color: 'var(--s-text-muted)' }}>SPRINGS HUB</p>
                <h1 className="font-display text-2xl tracking-wider leading-none">COMMUNAUTÉ</h1>
                <p className="t-mono text-xs mt-1.5" style={{ color: 'var(--s-text-dim)' }}>
                  {loading
                    ? 'Chargement…'
                    : `${structures.length} structure${structures.length > 1 ? 's' : ''} · ${availablePlayers.length} joueur${availablePlayers.length > 1 ? 's' : ''} dispo au recrutement`}
                </p>
              </div>
            </div>
            <div className="flex-1" />
            <div className="flex items-center gap-2 flex-shrink-0 flex-wrap">
              <Link href="/community/structures" className="btn-springs btn-secondary bevel-sm">
                <Shield size={14} />
                Toutes les structures
              </Link>
              <Link href="/community/players" className="btn-springs btn-secondary bevel-sm">
                <Users size={14} />
                Tous les joueurs
              </Link>
              <Link href="/community/create-structure" className="btn-springs btn-primary bevel-sm">
                <Plus size={14} />
                Créer ma structure
              </Link>
            </div>
          </div>
        </header>

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 size={24} className="animate-spin" style={{ color: 'var(--s-text-dim)' }} />
          </div>
        ) : (
          <>
            {/* Section structures récentes */}
            <Section
              label="Structures récentes"
              accent="var(--s-gold)"
              href="/community/structures"
              linkLabel="Voir toutes"
              delay="d1"
            >
              {recentStructures.length === 0 ? (
                <CommunityEmpty
                  icon={<Shield size={28} style={{ color: 'var(--s-gold)' }} />}
                  title="Aucune structure validée"
                  desc="Sois le premier à créer une structure sur Springs Hub."
                  ctaHref="/community/create-structure"
                  ctaLabel="Créer ma structure"
                  ctaIcon={<Plus size={14} />}
                />
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {recentStructures.map(s => <StructureFeedCard key={s.id} s={s} />)}
                </div>
              )}
            </Section>

            {/* Section joueurs dispo au recrutement */}
            <Section
              label="Joueurs disponibles au recrutement"
              accent="var(--s-blue)"
              href="/community/players?recruiting=1"
              linkLabel="Voir tous"
              delay="d2"
            >
              {topPlayers.length === 0 ? (
                <CommunityEmpty
                  icon={<Star size={28} style={{ color: 'var(--s-blue)' }} />}
                  title="Aucun joueur disponible"
                  desc="Personne n'est actuellement marqué comme disponible au recrutement."
                  ctaHref="/settings"
                  ctaLabel="Marque-toi disponible"
                  ctaIcon={<Star size={14} />}
                />
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                  {topPlayers.map(p => <PlayerFeedCard key={p.uid} p={p} />)}
                </div>
              )}
            </Section>

            {/* Section structures qui recrutent */}
            <Section
              label="Structures qui recrutent"
              accent="var(--s-green)"
              href="/community/structures"
              linkLabel="Voir toutes"
              delay="d3"
            >
              {recruitingStructures.length === 0 ? (
                <CommunityEmpty
                  icon={<Megaphone size={28} style={{ color: 'var(--s-green)' }} />}
                  title="Aucune offre ouverte"
                  desc="Aucune structure n'est actuellement en phase de recrutement."
                  ctaHref="/community/structures"
                  ctaLabel="Voir toutes les structures"
                  ctaIcon={<ChevronRight size={14} />}
                />
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {recruitingStructures.map(s => <RecruitingStructureCard key={s.id} s={s} />)}
                </div>
              )}
            </Section>
          </>
        )}
      </div>
    </div>
  );
}

function Section({
  label,
  accent,
  href,
  linkLabel,
  delay,
  children,
}: {
  label: string;
  accent: string;
  href: string;
  linkLabel: string;
  delay: 'd1' | 'd2' | 'd3';
  children: React.ReactNode;
}) {
  return (
    <section className={`animate-fade-in-${delay}`}>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="w-1 h-5" style={{ background: accent }} />
          <span className="t-label" style={{ color: 'var(--s-text)' }}>{label}</span>
        </div>
        <Link href={href} className="flex items-center gap-1 text-xs font-bold uppercase tracking-wider transition-colors hover:text-white"
          style={{ color: accent }}>
          {linkLabel} <ArrowRight size={12} />
        </Link>
      </div>
      {children}
    </section>
  );
}

function StructureFeedCard({ s }: { s: StructureSummary }) {
  const primaryGame = s.games.includes('rocket_league') ? 'rocket_league' : 'trackmania';
  const accentColor = primaryGame === 'rocket_league' ? 'var(--s-blue)' : 'var(--s-green)';

  return (
    <Link href={`/community/structure/${s.id}`}
      className="pillar-card panel bevel-sm relative overflow-hidden group transition-all duration-200"
      style={{ background: 'var(--s-surface)', border: '1px solid var(--s-border)' }}>
      <div className="h-[3px]" style={{ background: `linear-gradient(90deg, ${accentColor}, transparent 70%)` }} />
      <div className="relative z-[1] p-4">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 flex-shrink-0 relative overflow-hidden"
            style={{ background: 'var(--s-elevated)', border: '1px solid var(--s-border)' }}>
            {s.logoUrl ? (
              <Image src={s.logoUrl} alt={s.name} fill className="object-contain p-1" unoptimized />
            ) : (
              <div className="w-full h-full flex items-center justify-center">
                <Shield size={18} style={{ color: 'var(--s-text-muted)' }} />
              </div>
            )}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <p className="font-display text-base tracking-wider truncate">{s.name}</p>
              <span className="tag tag-neutral" style={{ fontSize: '9px', padding: '1px 5px', flexShrink: 0 }}>{s.tag}</span>
            </div>
            <div className="flex items-center gap-1.5">
              {s.games.map(g => (
                <span key={g} className={`tag ${g === 'rocket_league' ? 'tag-blue' : 'tag-green'}`}
                  style={{ fontSize: '9px', padding: '1px 5px' }}>
                  {g === 'rocket_league' ? 'RL' : 'TM'}
                </span>
              ))}
              <span className="t-mono text-xs ml-1" style={{ color: 'var(--s-text-muted)' }}>
                · {s.memberCount} membre{s.memberCount > 1 ? 's' : ''}
              </span>
            </div>
          </div>
        </div>
      </div>
    </Link>
  );
}

function PlayerFeedCard({ p }: { p: PlayerSummary }) {
  const avatar = p.avatarUrl || p.discordAvatar;
  return (
    <Link href={`/profile/${p.uid}`}
      className="pillar-card panel bevel-sm relative overflow-hidden group transition-all duration-200"
      style={{ background: 'var(--s-surface)', border: '1px solid var(--s-border)' }}>
      <div className="h-[3px]" style={{ background: 'linear-gradient(90deg, var(--s-blue), transparent 70%)' }} />
      <div className="relative z-[1] p-4">
        <div className="flex items-center gap-3 mb-3">
          {avatar ? (
            <div className="w-11 h-11 relative flex-shrink-0 overflow-hidden"
              style={{ background: 'var(--s-elevated)', border: '1px solid var(--s-border)' }}>
              <Image src={avatar} alt={p.displayName} fill className="object-cover" unoptimized />
            </div>
          ) : (
            <div className="w-11 h-11 flex-shrink-0 flex items-center justify-center"
              style={{ background: 'var(--s-elevated)', border: '1px solid var(--s-border)' }}>
              <Users size={16} style={{ color: 'var(--s-text-muted)' }} />
            </div>
          )}
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold truncate" style={{ color: 'var(--s-text)' }}>{p.displayName}</p>
            <div className="flex items-center gap-1 mt-1">
              {p.games.map(g => (
                <span key={g} className={`tag ${g === 'rocket_league' ? 'tag-blue' : 'tag-green'}`}
                  style={{ fontSize: '9px', padding: '1px 5px' }}>
                  {g === 'rocket_league' ? 'RL' : 'TM'}
                </span>
              ))}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1.5 pt-2" style={{ borderTop: '1px dashed var(--s-border)' }}>
          <Star size={11} style={{ color: '#33ff66', fill: '#33ff66' }} />
          <span className="text-xs font-bold truncate" style={{ color: '#33ff66' }}>
            Cherche {ROLE_LABELS[p.recruitmentRole] || 'équipe'}
          </span>
        </div>
      </div>
    </Link>
  );
}

function RecruitingStructureCard({ s }: { s: StructureSummary }) {
  const positions = s.recruiting?.positions ?? [];
  return (
    <Link href={`/community/structure/${s.id}`}
      className="pillar-card panel bevel-sm relative overflow-hidden group transition-all duration-200"
      style={{ background: 'var(--s-surface)', border: '1px solid var(--s-border)' }}>
      <div className="h-[3px]" style={{ background: 'linear-gradient(90deg, var(--s-green), transparent 70%)' }} />
      <div className="relative z-[1] p-4">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-11 h-11 flex-shrink-0 relative overflow-hidden"
            style={{ background: 'var(--s-elevated)', border: '1px solid var(--s-border)' }}>
            {s.logoUrl ? (
              <Image src={s.logoUrl} alt={s.name} fill className="object-contain p-1" unoptimized />
            ) : (
              <div className="w-full h-full flex items-center justify-center">
                <Shield size={18} style={{ color: 'var(--s-text-muted)' }} />
              </div>
            )}
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-display text-base tracking-wider truncate">{s.name}</p>
            <p className="t-mono text-xs" style={{ color: 'var(--s-text-muted)' }}>
              [{s.tag}] · {s.memberCount} membre{s.memberCount > 1 ? 's' : ''}
            </p>
          </div>
          <span className="tag tag-green flex-shrink-0" style={{ fontSize: '9px', padding: '2px 6px' }}>RECRUTE</span>
        </div>
        {positions.length > 0 ? (
          <div className="flex flex-wrap gap-1.5 pt-2" style={{ borderTop: '1px dashed var(--s-border)' }}>
            {positions.slice(0, 3).map((pos, i) => (
              <span key={i} className="tag tag-neutral" style={{ fontSize: '9px', padding: '1px 6px' }}>
                {pos.game === 'rocket_league' ? 'RL' : 'TM'} · {ROLE_LABELS[pos.role] || pos.role}
              </span>
            ))}
            {positions.length > 3 && (
              <span className="t-mono text-xs" style={{ color: 'var(--s-text-muted)' }}>
                +{positions.length - 3}
              </span>
            )}
          </div>
        ) : (
          <p className="text-xs pt-2" style={{ borderTop: '1px dashed var(--s-border)', color: 'var(--s-text-dim)' }}>
            Postes ouverts
          </p>
        )}
      </div>
    </Link>
  );
}

function CommunityEmpty({
  icon,
  title,
  desc,
  ctaHref,
  ctaLabel,
  ctaIcon,
}: {
  icon: React.ReactNode;
  title: string;
  desc: string;
  ctaHref: string;
  ctaLabel: string;
  ctaIcon: React.ReactNode;
}) {
  return (
    <div className="bevel p-8 text-center relative overflow-hidden"
      style={{ background: 'var(--s-surface)', border: '1px solid var(--s-border)' }}>
      <div className="absolute inset-0 pointer-events-none" style={{ background: 'radial-gradient(circle at 50% 0%, rgba(255,255,255,0.02), transparent 60%)' }} />
      <div className="relative z-[1]">
        <div className="mx-auto mb-3 w-12 h-12 flex items-center justify-center">
          {icon}
        </div>
        <h3 className="font-display text-lg tracking-wider mb-2">{title}</h3>
        <p className="text-sm mb-4 max-w-md mx-auto" style={{ color: 'var(--s-text-dim)' }}>
          {desc}
        </p>
        <Link href={ctaHref} className="btn-springs btn-secondary bevel-sm inline-flex items-center gap-2">
          {ctaIcon}
          {ctaLabel}
        </Link>
      </div>
    </div>
  );
}
