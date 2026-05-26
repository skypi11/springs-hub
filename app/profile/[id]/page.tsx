'use client';

import { useState, useEffect, use } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import ReactMarkdown from 'react-markdown';
import { useAuth } from '@/context/AuthContext';
import { countries } from '@/lib/countries';
import type { SpringsUser, RLStats } from '@/types';
import {
  User, Calendar, Gamepad2, Search, Shield,
  ExternalLink, Settings, Loader2, AlertCircle,
  Trophy, History, Sparkles, ShieldAlert,
} from 'lucide-react';
import Breadcrumbs from '@/components/ui/Breadcrumbs';
import CompactStickyHeader from '@/components/ui/CompactStickyHeader';
import { SkeletonPageHeader, SkeletonCard } from '@/components/ui/Skeleton';
import InviteToStructureButton from '@/components/community/InviteToStructureButton';
import DiscordIcon from '@/components/icons/DiscordIcon';
import { getEffectiveRLPlatform, buildTrackerGgUrl, buildBallchasingUrl, getRLPlatformMeta } from '@/lib/rl-platform';
import RLIdentityBadge from '@/components/players/RLIdentityBadge';
// ReportRankButton est désormais embarqué dans RLIdentityBadge (via canReport)
import { getConnectionMeta, buildConnectionUrl } from '@/lib/discord-connections';
import { Link2 } from 'lucide-react';
import RankBadge, { getRankTierConfig } from '@/components/rl/RankBadge';

// Priorité hiérarchique des rôles structure — utilisée pour identifier le rôle principal
// d'un joueur dans le hero (ex : un fondateur ARAN qui est aussi joueur dans TTC affiche "Fondateur ARAN").
const ROLE_PRIORITY: Record<string, number> = {
  fondateur: 0, co_fondateur: 1, responsable: 2, coach_structure: 3,
  manager_equipe: 4, coach_equipe: 5, capitaine: 6, joueur: 7,
  remplacant: 8, membre: 9,
};
const ROLE_LABELS: Record<string, string> = {
  fondateur: 'Fondateur', co_fondateur: 'Co-fondateur',
  responsable: 'Responsable', coach_structure: 'Coach structure',
  manager_equipe: "Manager d'équipe", coach_equipe: 'Coach',
  capitaine: 'Capitaine', joueur: 'Joueur',
  remplacant: 'Remplaçant', membre: 'Membre',
};
const TEAM_ROLE_LABELS: Record<string, string> = {
  joueur: 'Joueur', remplacant: 'Remplaçant', coach: 'Coach', manager: 'Manager', capitaine: 'Capitaine',
};

function CountryFlag({ code, size = 16 }: { code: string; size?: number }) {
  if (!code || code === 'OTHER') return <span>🌍</span>;
  return (
    <img
      src={`https://flagcdn.com/w40/${code.toLowerCase()}.png`}
      alt={code}
      width={size}
      height={Math.round(size * 0.75)}
      style={{ display: 'inline-block', verticalAlign: 'middle' }}
    />
  );
}

export default function ProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { firebaseUser, isAdmin } = useAuth();
  const [profile, setProfile] = useState<(SpringsUser & { age?: number | null }) | null>(null);
  const [rlStats, setRlStats] = useState<RLStats | null>(null);
  const [rlStatsLoaded, setRlStatsLoaded] = useState(false);
  const [tmStats, setTmStats] = useState<{
    displayName: string | null;
    trophies: number | null; echelon: number | null;
    clubTag: string | null;
    trophyTiers: { tier: number; count: number }[];
    zoneRankings: { zone: string; rank: number }[];
    cotdBestRank: number | null; cotdBestDiv: number | null;
    cotdCount: number; cotdAvgRank: number | null;
    profileUrl: string | null;
  } | null>(null);
  const [history, setHistory] = useState<{
    tm: { editionsPlayed: number; finalesReached: number; bestFinalePosition: number | null } | null;
    rl: { competitions: { id: string; name: string; status: string }[] };
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  const isOwner = firebaseUser?.uid === id;

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch(`/api/profile?uid=${encodeURIComponent(id)}`);
        if (!res.ok) {
          setNotFound(true);
          setLoading(false);
          return;
        }
        const data = { uid: id, ...await res.json() } as SpringsUser & { age?: number | null };
        setProfile(data);

        // Fetch RL stats si le joueur joue à RL.
        // Tracker.gg API étant cassée en prod, ce fetch reste pour les seeds dev avec rangs hardcodés.
        // L'UI fallback affiche le rang auto-déclaré + boutons tracker.gg/Ballchasing cliquables.
        if (data.games?.includes('rocket_league')) {
          const effective = getEffectiveRLPlatform(data);
          if (effective && effective.platform === 'epic') {
            try {
              const rlRes = await fetch(`/api/rl-stats?epicId=${encodeURIComponent(effective.id)}`);
              if (rlRes.ok) {
                const stats = await rlRes.json();
                if (stats.rank) setRlStats(stats.rank);
              }
            } catch (err) {
              console.error('[Profile] RL stats fetch error:', err);
            }
          }
          setRlStatsLoaded(true);
        }

        // Historique Springs (Monthly Cup + League Series)
        try {
          const hRes = await fetch(`/api/profile/history?uid=${encodeURIComponent(id)}`);
          if (hRes.ok) setHistory(await hRes.json());
        } catch (err) {
          console.error('[Profile] history fetch error:', err);
        }

        // Fetch TM stats si le joueur joue à TM
        if (data.games?.includes('trackmania') && (data.tmIoUrl || data.pseudoTM)) {
          try {
            const params = new URLSearchParams();
            if (data.tmIoUrl) params.set('url', data.tmIoUrl);
            if (data.pseudoTM) params.set('pseudo', data.pseudoTM);
            const tmRes = await fetch(`/api/tm-stats?${params.toString()}`);
            if (tmRes.ok) {
              setTmStats(await tmRes.json());
            }
          } catch (err) {
            console.error('[Profile] TM stats fetch error:', err);
          }
        }
      } catch (err) {
        console.error('[Profile] load error:', err);
        setNotFound(true);
      }
      setLoading(false);
    }
    load();
  }, [id]);

  if (loading) {
    return (
      <div className="min-h-screen hex-bg px-4 sm:px-6 lg:px-8 py-6 lg:py-8 space-y-8">
        <div className="space-y-6 animate-fade-in">
          <SkeletonPageHeader accent="var(--s-gold)" />
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
            <div className="lg:col-span-2 space-y-5">
              <SkeletonCard height={240} accent="var(--s-blue)" />
              <SkeletonCard height={200} accent="var(--s-green)" />
            </div>
            <div className="space-y-5">
              <SkeletonCard height={180} accent="var(--s-gold)" />
              <SkeletonCard height={140} accent="var(--s-gold)" />
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (notFound || !profile) {
    return (
      <div className="min-h-screen px-4 sm:px-6 lg:px-8 py-6 lg:py-8 flex items-center justify-center">
        <div className="panel p-10 text-center max-w-md">
          <AlertCircle size={32} className="mx-auto mb-4" style={{ color: 'var(--s-text-muted)' }} />
          <h2 className="font-display text-2xl mb-2">PROFIL INTROUVABLE</h2>
          <p className="t-body">Ce joueur n&apos;existe pas ou n&apos;a pas encore créé son profil.</p>
        </div>
      </div>
    );
  }

  const country = countries.find(c => c.code === profile.country);
  const avatarSrc = profile.avatarUrl || profile.discordAvatar || '';
  const age = profile.age ?? null;

  // Structures triées par hiérarchie de rôle — la première = rôle "principal" affiché dans le hero.
  const sortedStructures = [...(profile.structures ?? [])].sort(
    (a, b) => (ROLE_PRIORITY[a.role] ?? 99) - (ROLE_PRIORITY[b.role] ?? 99),
  );
  const topStructure = sortedStructures[0] ?? null;
  const isLeader = topStructure?.role === 'fondateur' || topStructure?.role === 'co_fondateur';

  // Comptes Discord visibles publiquement (sidebar)
  const visibleConnections = (profile.discordConnections ?? []).filter(c => c.visibleOnProfile);

  // Historique Springs : on ne render la card QUE si données réelles présentes.
  // Phase 3 (compétitions natives) pas encore branchée → éviter le panel "Aucune participation" qui fait vide.
  const tmCount = history?.tm?.editionsPlayed ?? 0;
  const rlCount = history?.rl?.competitions.length ?? 0;
  const hasHistory = tmCount > 0 || rlCount > 0;

  const playsRL = profile.games?.includes('rocket_league') ?? false;
  const playsTM = profile.games?.includes('trackmania') ?? false;
  const gameCount = (playsRL ? 1 : 0) + (playsTM ? 1 : 0);

  return (
    <div className="min-h-screen hex-bg px-4 sm:px-6 lg:px-8 py-6 lg:py-8 space-y-8">
      <CompactStickyHeader
        icon={User}
        title={profile.displayName || 'Joueur'}
        accent="var(--s-gold)"
      />
      <div className="relative z-[1] space-y-8">

        <Breadcrumbs items={[
          { label: 'Communauté', href: '/community' },
          { label: 'Joueurs', href: '/community/players' },
          { label: profile.displayName || 'Joueur' },
        ]} />

        {/* ─── BANDEAU ADMIN-ONLY : compte suspecté smurf ──────────────────── */}
        {isAdmin && (() => {
          const flag = (profile as typeof profile & {
            suspectedSmurfFlag?: { flaggedAt: string | null; flaggedBy: string | null; reportId: string | null; note: string | null };
          }).suspectedSmurfFlag;
          if (!flag) return null;
          const dateStr = flag.flaggedAt
            ? new Date(flag.flaggedAt).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' })
            : '—';
          return (
            <div className="bevel-sm p-3 flex items-start gap-2.5 animate-fade-in"
              style={{ background: 'rgba(239,68,68,0.10)', border: '1px solid rgba(239,68,68,0.4)' }}>
              <ShieldAlert size={16} style={{ color: '#ef4444', flexShrink: 0, marginTop: 2 }} />
              <div className="text-xs flex-1 min-w-0" style={{ color: '#ff8a8a' }}>
                <strong>Compte suspecté smurf</strong> — flaggé le {dateStr}
                {flag.note && <span> · *{flag.note}*</span>}
                <span className="block mt-0.5" style={{ color: 'var(--s-text-muted)' }}>
                  Visible uniquement par les admins. Sert d'historique pour la modération et les futures inscriptions en compétition.
                </span>
              </div>
            </div>
          );
        })()}

        {/* ─── HERO HEADER ─────────────────────────────────────────────────── */}
        <header className="bevel animate-fade-in relative overflow-hidden" style={{ background: 'var(--s-surface)', border: '1px solid var(--s-border)' }}>
          <div className="h-[3px]" style={{ background: 'linear-gradient(90deg, var(--s-gold), rgba(255,184,0,0.3), transparent 80%)' }} />

          {/* Glows */}
          <div className="absolute top-0 left-0 w-[500px] h-[400px] pointer-events-none opacity-[0.06]"
            style={{ background: 'radial-gradient(ellipse at top left, var(--s-gold), transparent 70%)' }} />

          <div className="relative z-[1] p-4 sm:p-6 lg:p-10 flex flex-col sm:flex-row sm:items-start gap-4 sm:gap-6 lg:gap-8">
            <div className="flex items-start gap-4 sm:gap-6 lg:gap-8 min-w-0 flex-1">
              {/* Avatar */}
              <div className="flex-shrink-0 w-20 h-20 sm:w-28 sm:h-28 relative overflow-hidden bevel-sm"
                style={{ background: 'var(--s-elevated)', border: '2px solid rgba(255,184,0,0.15)' }}>
                {avatarSrc ? (
                  <Image src={avatarSrc} alt={profile.displayName} fill className="object-cover" unoptimized />
                ) : (
                  <div className="w-full h-full flex items-center justify-center">
                    <User size={44} style={{ color: 'var(--s-text-muted)' }} />
                  </div>
                )}
              </div>

              <div className="flex-1 min-w-0">
                {/* Tags */}
                <div className="flex items-center gap-2 mb-2.5 flex-wrap">
                  {profile.games?.map(g => (
                    <span key={g} className={`tag ${g === 'rocket_league' ? 'tag-blue' : 'tag-green'}`}>
                      {g === 'rocket_league' ? 'Rocket League' : 'Trackmania'}
                    </span>
                  ))}
                  {profile.isAvailableForRecruitment && (
                    <span className="tag tag-gold">
                      <Search size={9} /> Disponible
                    </span>
                  )}
                </div>

                {/* Nom */}
                <h1 className="font-display uppercase mb-1.5"
                  style={{ fontSize: 'clamp(28px, 7vw, 64px)', lineHeight: 0.95, letterSpacing: '0.04em' }}>
                  {profile.displayName}
                </h1>

                {/* Rôle principal (calculé sur la structure de plus haut rang) */}
                {topStructure && (
                  <Link
                    href={`/community/structure/${topStructure.id}`}
                    className="inline-flex items-center gap-2 mb-2.5 transition-opacity hover:opacity-80"
                  >
                    {topStructure.logoUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={topStructure.logoUrl}
                        alt={topStructure.name}
                        className="w-5 h-5 object-contain flex-shrink-0"
                      />
                    ) : (
                      <Shield size={14} style={{ color: isLeader ? 'var(--s-gold)' : 'var(--s-text-muted)' }} />
                    )}
                    <span
                      className="text-sm font-semibold"
                      style={{ color: isLeader ? 'var(--s-gold)' : 'var(--s-text)' }}
                    >
                      {ROLE_LABELS[topStructure.role] ?? 'Membre'}
                    </span>
                    <span className="text-sm" style={{ color: 'var(--s-text-dim)' }}>·</span>
                    <span className="text-sm" style={{ color: 'var(--s-text-dim)' }}>
                      {topStructure.name}
                      {topStructure.tag && (
                        <span className="t-mono ml-1.5" style={{ color: 'var(--s-text-muted)', fontSize: '12px' }}>
                          [{topStructure.tag}]
                        </span>
                      )}
                    </span>
                  </Link>
                )}

                {/* Infos sous le nom */}
                <div className="flex items-center gap-x-4 gap-y-1.5 flex-wrap">
                  {country && (
                    <div className="flex items-center gap-2">
                      <CountryFlag code={country.code} size={16} />
                      <span className="text-sm" style={{ color: 'var(--s-text-dim)' }}>{country.name}</span>
                    </div>
                  )}
                  {age !== null && (
                    <div className="flex items-center gap-1.5">
                      <Calendar size={12} style={{ color: 'var(--s-text-muted)' }} />
                      <span className="text-sm" style={{ color: 'var(--s-text-dim)' }}>{age} ans</span>
                    </div>
                  )}
                  {profile.discordUsername && (
                    <div className="flex items-center gap-1.5" style={{ color: 'var(--s-text-muted)' }}>
                      <DiscordIcon size={12} />
                      <span className="text-sm" style={{ color: 'var(--s-text-dim)' }}>{profile.discordUsername}</span>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Actions */}
            {isOwner && (
              <Link href="/settings" className="btn-springs btn-secondary bevel-sm flex-shrink-0 flex items-center justify-center gap-2">
                <Settings size={13} /> Modifier
              </Link>
            )}
          </div>
        </header>

        {/* ─── BODY : layout 2 colonnes (main 2/3 + sidebar 1/3 sticky) ──── */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 animate-fade-in-d1">
          {/* MAIN COLUMN (2/3) — Bio + Stats jeux + Historique */}
          <div className="lg:col-span-2 space-y-6 min-w-0">

        {/* ─── BIO ───────────────────────────────────────────────────────── */}
        {profile.bio && (
          <div className="pillar-card panel relative overflow-hidden">
            <div className="h-[3px]" style={{ background: 'linear-gradient(90deg, rgba(255,255,255,0.15), transparent 60%)' }} />
            <div className="relative z-[1]">
              <div className="panel-header">
                <div className="flex items-center gap-2">
                  <User size={13} style={{ color: 'var(--s-text-dim)' }} />
                  <span className="t-label" style={{ color: 'var(--s-text)' }}>À PROPOS</span>
                </div>
              </div>
              <div className="p-5">
                <div className="prose-springs text-sm">
                  <ReactMarkdown>{profile.bio}</ReactMarkdown>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ─── STATS JEUX ────────────────────────────────────────────────── */}
        <div className={`grid gap-6 ${gameCount === 2 ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-1'}`}>

          {/* Stats RL */}
          {profile.games?.includes('rocket_league') && (() => {
            // Champs calculés côté serveur par /api/profile (voir route.ts) —
            // ils sont déjà résolus avec la bonne priorité Epic > Steam et
            // survivent au filtrage `visibleOnProfile` des connexions Discord
            // pour les visiteurs non-owners.
            const p = profile as typeof profile & {
              rlAccountVerified?: boolean;
              rlAccountName?: string;
              rlAccountPlatform?: 'epic' | 'steam' | '';
              rlSteamId64?: string;
            };
            const rlAccountVerified = !!p.rlAccountVerified;
            const rlAccountName = p.rlAccountName || '';
            const rlAccountPlatform: 'epic' | 'steam' | '' = p.rlAccountPlatform || '';
            // ID utilisé pour construire les URLs : pseudo pour Epic, SteamID64 pour Steam
            const accountIdForUrl = rlAccountPlatform === 'steam'
              ? (p.rlSteamId64 || '')
              : rlAccountName;
            const trackerHref = rlAccountPlatform && accountIdForUrl
              ? buildTrackerGgUrl(rlAccountPlatform, accountIdForUrl)
              : '';
            const ballchasingHref = rlAccountPlatform && accountIdForUrl
              ? buildBallchasingUrl(rlAccountPlatform, accountIdForUrl)
              : '';
            const platformMeta = rlAccountPlatform
              ? getRLPlatformMeta(rlAccountPlatform)
              : null;
            // `effective` conservé pour l'historique de structure UI ci-dessous
            // (rlStatsLoaded / RLEmptyState font le check `!effective`).
            const effective = rlAccountPlatform && accountIdForUrl
              ? { platform: rlAccountPlatform, id: accountIdForUrl }
              : getEffectiveRLPlatform(profile);
            return (
              <div className="pillar-card panel relative overflow-hidden group transition-all duration-200 h-full flex flex-col">
                <div className="h-[3px]" style={{ background: 'linear-gradient(90deg, var(--s-blue), rgba(0,129,255,0.3), transparent 70%)' }} />
                <div className="absolute top-0 right-0 w-[200px] h-[200px] pointer-events-none opacity-[0.06]"
                  style={{ background: 'radial-gradient(circle at top right, var(--s-blue), transparent 70%)' }} />
                <div className="relative z-[1] flex-1 flex flex-col">
                  <div className="panel-header">
                    <div className="flex items-center gap-2">
                      <Gamepad2 size={13} style={{ color: 'var(--s-blue)' }} />
                      <span className="t-label" style={{ color: 'var(--s-text)' }}>ROCKET LEAGUE</span>
                    </div>
                    {effective && (
                      <span className="tag tag-blue" style={{ fontSize: '8px' }}>
                        {platformMeta?.label.replace(/ \(.+\)$/, '') ?? ''} · {effective.id}
                      </span>
                    )}
                  </div>
                  <div className="p-5 flex-1 flex flex-col gap-4">
                    {/* Statut RL officiel — ✓ vérifié + lien tracker + signaler ou ⚠️ non lié */}
                    <RLIdentityBadge
                      games={profile.games}
                      rlAccountVerified={rlAccountVerified}
                      rlAccountName={rlAccountName}
                      rlAccountPlatform={rlAccountPlatform}
                      rlSteamId64={profile.steamLinked?.steamId64 || ''}
                      rlRank={profile.rlRank}
                      targetUid={id}
                      targetName={profile.displayName}
                      canReport={!isOwner && !!firebaseUser}
                      size="md"
                    />
                    {rlStats ? (
                      <div className="space-y-5">
                        <div className="flex items-center gap-5">
                          {rlStats.iconUrl && (
                            <div className="w-16 h-16 flex-shrink-0 p-1" style={{ background: 'rgba(0,129,255,0.06)', border: '1px solid rgba(0,129,255,0.15)' }}>
                              <Image src={rlStats.iconUrl} alt={rlStats.rank ?? ''} width={56} height={56} unoptimized />
                            </div>
                          )}
                          <div className="flex-1">
                            <p className="font-display text-2xl" style={{ color: 'var(--s-text)' }}>{rlStats.rank}</p>
                            {rlStats.division && (
                              <p className="t-mono text-xs" style={{ color: 'var(--s-text-dim)' }}>{rlStats.division}</p>
                            )}
                          </div>
                          {rlStats.mmr && (
                            <div className="text-right">
                              <p
                                className="font-display text-3xl"
                                style={{ color: 'var(--s-blue)', lineHeight: 1 }}
                                title="Matchmaking Rating : score du classement compétitif"
                              >
                                {rlStats.mmr}
                              </p>
                              <p className="t-label">MMR</p>
                            </div>
                          )}
                        </div>

                        {rlStats.playlist && (
                          <div className="flex items-center gap-2 px-3 py-2" style={{ background: 'var(--s-elevated)', border: '1px solid var(--s-border)' }}>
                            <span className="t-label" style={{ color: 'var(--s-text-muted)' }}>PLAYLIST</span>
                            <span className="text-xs font-semibold ml-auto" style={{ color: 'var(--s-text)' }}>{rlStats.playlist}</span>
                          </div>
                        )}
                      </div>
                    ) : rlStatsLoaded && !effective ? (
                      <RLEmptyState isOwner={isOwner} />
                    ) : rlStatsLoaded ? (
                      /* Pas de stats auto mais on a une plateforme — rang déclaré + boutons cliquables */
                      <div className="space-y-4">
                        {profile.rlRank ? (() => {
                          const tierConfig = getRankTierConfig(profile.rlRank);
                          const accent = tierConfig?.color ?? '#0081FF';
                          return (
                            <div
                              className="flex items-center gap-4 p-4"
                              style={{
                                background: tierConfig?.bgColor ?? 'rgba(0,129,255,0.05)',
                                border: `1px solid ${tierConfig?.borderColor ?? 'rgba(0,129,255,0.15)'}`,
                              }}
                            >
                              <RankBadge rank={profile.rlRank} size={56} />
                              <div className="flex-1">
                                <p className="t-label" style={{ color: 'var(--s-text-muted)' }}>Rang déclaré</p>
                                <p className="font-display text-xl" style={{ color: accent }}>{profile.rlRank}</p>
                              </div>
                            </div>
                          );
                        })() : (
                          <div className="text-xs p-3" style={{ background: 'var(--s-elevated)', border: '1px solid var(--s-border)', color: 'var(--s-text-muted)' }}>
                            Aucun rang renseigné. Vérifie les stats via les liens ci-dessous.
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="flex items-center gap-3">
                        <Loader2 size={16} className="animate-spin" style={{ color: 'var(--s-blue)' }} />
                        <span className="text-sm" style={{ color: 'var(--s-text-muted)' }}>Chargement des stats...</span>
                      </div>
                    )}

                    {effective && (trackerHref || ballchasingHref) && (
                      <div className="mt-auto pt-4">
                        <div className="divider mb-4" />
                        <div className="space-y-2">
                          {trackerHref && (
                            <a href={trackerHref} target="_blank" rel="noopener noreferrer"
                              className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider transition-colors hover:text-white"
                              style={{ color: 'var(--s-blue)' }}>
                              Voir sur tracker.gg <ExternalLink size={11} />
                            </a>
                          )}
                          {ballchasingHref && (
                            <a href={ballchasingHref} target="_blank" rel="noopener noreferrer"
                              className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider transition-colors hover:text-white"
                              style={{ color: 'var(--s-blue)' }}
                              title="Ballchasing référence uniquement les replays uploadés (via BakkesMod ou upload manuel). Si vide, c'est que le joueur n'a pas encore eu de replay uploadé.">
                              Replays Ballchasing <ExternalLink size={11} />
                            </a>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })()}

          {/* Stats TM */}
          {profile.games?.includes('trackmania') && (
            <div className="pillar-card panel relative overflow-hidden group transition-all duration-200 h-full flex flex-col">
              <div className="h-[3px]" style={{ background: 'linear-gradient(90deg, var(--s-green), rgba(0,217,54,0.3), transparent 70%)' }} />
              <div className="absolute top-0 right-0 w-[200px] h-[200px] pointer-events-none opacity-[0.06]"
                style={{ background: 'radial-gradient(circle at top right, var(--s-green), transparent 70%)' }} />
              <div className="relative z-[1] flex-1 flex flex-col">
                <div className="panel-header">
                  <div className="flex items-center gap-2">
                    <Gamepad2 size={13} style={{ color: 'var(--s-green)' }} />
                    <span className="t-label" style={{ color: 'var(--s-text)' }}>TRACKMANIA</span>
                  </div>
                  <div className="flex items-center gap-2">
                    {tmStats?.clubTag && (
                      <span className="tag" style={{ background: 'rgba(0,217,54,0.1)', color: '#33ff66', borderColor: 'rgba(0,217,54,0.25)', fontSize: '8px' }}>
                        {tmStats.clubTag}
                      </span>
                    )}
                    <span className="tag tag-green" style={{ fontSize: '8px' }}>
                      {tmStats?.displayName || profile.pseudoTM}
                    </span>
                  </div>
                </div>
                <div className="p-5 flex-1 flex flex-col">
                  {tmStats && (tmStats.trophies !== null || tmStats.cotdBestRank !== null) ? (
                    <div className="space-y-5">
                      {/* Trophées + Niveau */}
                      <div className="flex items-center gap-8">
                        <div className="flex items-center gap-3">
                          <div className="p-2.5" style={{ background: 'rgba(0,217,54,0.08)', border: '1px solid rgba(0,217,54,0.15)' }}>
                            <Trophy size={20} style={{ color: '#33ff66' }} />
                          </div>
                          <div>
                            <p className="font-display text-2xl" style={{ color: '#33ff66', lineHeight: 1 }}>
                              {tmStats.trophies != null ? new Intl.NumberFormat('fr-FR').format(tmStats.trophies) : '—'}
                            </p>
                            <p className="t-label">TROPHÉES</p>
                          </div>
                        </div>
                        {tmStats.echelon !== null && tmStats.echelon > 0 && (
                          <div title="Échelon Trackmania : niveau global calculé à partir des trophées (1 à 9)">
                            <p className="font-display text-2xl" style={{ color: 'var(--s-text)', lineHeight: 1 }}>{tmStats.echelon}</p>
                            <p className="t-label">ÉCHELON</p>
                          </div>
                        )}
                      </div>

                      {/* Classements par zone */}
                      {tmStats.zoneRankings && tmStats.zoneRankings.length > 0 && (
                        <div>
                          <span className="t-label block mb-2">CLASSEMENT PAR ZONE</span>
                          <div className="space-y-1">
                            {tmStats.zoneRankings.map((zr) => (
                              <div key={zr.zone} className="flex items-center justify-between px-3 py-2"
                                style={{ background: 'var(--s-elevated)', border: '1px solid var(--s-border)' }}>
                                <span className="text-xs" style={{ color: 'var(--s-text-dim)' }}>{zr.zone}</span>
                                <span className="font-display text-sm" style={{ color: '#33ff66' }}>
                                  {new Intl.NumberFormat('fr-FR').format(zr.rank)}<span className="text-xs" style={{ color: 'var(--s-text-muted)' }}>{zr.rank === 1 ? 'er' : 'e'}</span>
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Trophées par tier */}
                      {tmStats.trophyTiers && tmStats.trophyTiers.length > 0 && (
                        <div>
                          <span
                            className="t-label block mb-2"
                            title="Les trophées sont classés en 9 tiers : T1-T3 bronze, T4-T6 argent, T7-T9 or"
                          >
                            TROPHÉES PAR TIER
                          </span>
                          <div className="flex gap-1.5 flex-wrap">
                            {tmStats.trophyTiers.sort((a, b) => b.tier - a.tier).map((t) => {
                              const tierGroup = t.tier <= 3 ? 'bronze' : t.tier <= 6 ? 'argent' : 'or';
                              const tierStyles = {
                                bronze: { color: '#cd7f32', bg: 'rgba(205,127,50,0.12)', border: 'rgba(205,127,50,0.3)' },
                                argent: { color: '#c0c0c0', bg: 'rgba(192,192,192,0.08)', border: 'rgba(192,192,192,0.25)' },
                                or:     { color: '#ffd700', bg: 'rgba(255,215,0,0.1)', border: 'rgba(255,215,0,0.3)' },
                              };
                              const td = tierStyles[tierGroup];
                              const tierLabel = tierGroup === 'bronze' ? 'Bronze' : tierGroup === 'argent' ? 'Argent' : 'Or';
                              return (
                                <div
                                  key={t.tier}
                                  className="text-center px-3 py-2"
                                  style={{ background: td.bg, border: `1px solid ${td.border}`, minWidth: '64px' }}
                                  title={`Tier ${t.tier} (${tierLabel}) — ${t.count} trophée${t.count > 1 ? 's' : ''}`}
                                >
                                  <p className="font-display text-base" style={{ color: td.color, lineHeight: 1 }}>
                                    {new Intl.NumberFormat('fr-FR').format(t.count)}
                                  </p>
                                  <p className="t-label mt-0.5" style={{ color: td.color, opacity: 0.85 }}>T{t.tier}</p>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      {/* COTD */}
                      {(tmStats.cotdBestRank !== null || tmStats.cotdCount > 0) && (
                        <div>
                          <span
                            className="t-label block mb-2"
                            title="Cup of the Day : compétition quotidienne Trackmania (qualifications puis bracket à élimination directe)"
                          >
                            CUP OF THE DAY
                          </span>
                          <div className="flex items-center gap-4 flex-wrap">
                            {tmStats.cotdBestRank !== null && (
                              <div
                                className="text-center px-3 py-2"
                                style={{ background: 'var(--s-elevated)', border: '1px solid var(--s-border)', minWidth: '78px' }}
                                title={`Meilleur classement en COTD${tmStats.cotdBestDiv ? ` — Division ${tmStats.cotdBestDiv}` : ''}`}
                              >
                                <p className="font-display text-lg" style={{ color: '#33ff66', lineHeight: 1 }}>#{tmStats.cotdBestRank}</p>
                                <p className="t-label mt-0.5">
                                  MEILLEUR{tmStats.cotdBestDiv ? ` (D${tmStats.cotdBestDiv})` : ''}
                                </p>
                              </div>
                            )}
                            {tmStats.cotdAvgRank !== null && (
                              <div
                                className="text-center px-3 py-2"
                                style={{ background: 'var(--s-elevated)', border: '1px solid var(--s-border)', minWidth: '78px' }}
                                title="Classement moyen sur toutes les COTD jouées"
                              >
                                <p className="font-display text-lg" style={{ color: 'var(--s-text)', lineHeight: 1 }}>#{tmStats.cotdAvgRank}</p>
                                <p className="t-label mt-0.5">MOYENNE</p>
                              </div>
                            )}
                            {tmStats.cotdCount > 0 && (
                              <div
                                className="text-center px-3 py-2"
                                style={{ background: 'var(--s-elevated)', border: '1px solid var(--s-border)', minWidth: '78px' }}
                                title="Nombre total de COTD jouées"
                              >
                                <p className="font-display text-lg" style={{ color: 'var(--s-text)', lineHeight: 1 }}>{tmStats.cotdCount}</p>
                                <p className="t-label mt-0.5">JOUÉES</p>
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="flex items-center gap-3">
                      <Loader2 size={16} className="animate-spin" style={{ color: 'var(--s-green)' }} />
                      <span className="text-xs" style={{ color: 'var(--s-text-muted)' }}>Chargement des stats...</span>
                    </div>
                  )}

                  {(tmStats?.profileUrl || profile.tmIoUrl) && (
                    <div className="mt-auto pt-4">
                      <div className="divider mb-4" />
                      <a href={tmStats?.profileUrl || profile.tmIoUrl} target="_blank" rel="noopener noreferrer"
                        className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider transition-colors hover:text-white"
                        style={{ color: 'var(--s-green)' }}>
                        Voir sur Trackmania.io <ExternalLink size={11} />
                      </a>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* ─── HISTORIQUE SPRINGS ────────────────────────────────────────── */}
        {/* Card masquée tant qu'il n'y a aucune participation enregistrée
            (Phase 3 compétitions natives Aedral pas encore branchée). */}
        {hasHistory && (
          <SpringsHistoryPanel
            history={history}
            games={profile.games ?? []}
            hasTmIdentity={Boolean((profile.pseudoTM || '').trim() || (profile.loginTM || '').trim())}
            isOwner={isOwner}
          />
        )}

          </div>
          {/* ── FIN MAIN COLUMN ── */}

          {/* SIDEBAR (1/3) — Recrutement + Structures + Comptes compacts */}
          <aside className="space-y-6 min-w-0">
            <div className="lg:sticky lg:top-[88px] space-y-6">

              {/* Recrutement (uniquement si dispo) */}
              {profile.isAvailableForRecruitment && (
                <div className="pillar-card panel relative overflow-hidden">
                  <div className="h-[3px]" style={{ background: 'linear-gradient(90deg, var(--s-gold), rgba(255,184,0,0.3), transparent 70%)' }} />
                  <div className="absolute top-0 right-0 w-[150px] h-[150px] pointer-events-none opacity-[0.06]"
                    style={{ background: 'radial-gradient(circle at top right, var(--s-gold), transparent 70%)' }} />
                  <div className="relative z-[1]">
                    <div className="panel-header">
                      <div className="flex items-center gap-2">
                        <Search size={13} style={{ color: 'var(--s-gold)' }} />
                        <span className="t-label" style={{ color: 'var(--s-text)' }}>RECRUTEMENT</span>
                      </div>
                      <span className="tag tag-gold" style={{ fontSize: '11px' }}>OUVERT</span>
                    </div>
                    <div className="p-5 space-y-3">
                      {profile.recruitmentRole && (
                        <div className="flex items-center gap-2 px-3 py-2" style={{ background: 'var(--s-elevated)', border: '1px solid var(--s-border)' }}>
                          <span className="t-label">RÔLE</span>
                          <span className="text-sm font-semibold ml-auto" style={{ color: 'var(--s-text)' }}>
                            {profile.recruitmentRole.charAt(0).toUpperCase() + profile.recruitmentRole.slice(1)}
                          </span>
                        </div>
                      )}
                      {profile.recruitmentMessage && (
                        <div className="prose-springs text-xs" style={{ color: 'var(--s-text-dim)' }}>
                          <ReactMarkdown>{profile.recruitmentMessage}</ReactMarkdown>
                        </div>
                      )}
                      <InviteToStructureButton
                        targetUserId={id}
                        targetDisplayName={profile.displayName || 'ce joueur'}
                        targetGames={profile.games ?? []}
                        isAvailableForRecruitment={profile.isAvailableForRecruitment}
                        className="w-full justify-center"
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* Structure(s) — utilise sortedStructures (triées par hiérarchie de rôle) */}
              {sortedStructures.length > 0 && (
                <div className="pillar-card panel relative overflow-hidden">
                  <div className="h-[3px]" style={{ background: 'linear-gradient(90deg, rgba(255,255,255,0.15), transparent 60%)' }} />
                  <div className="relative z-[1]">
                    <div className="panel-header">
                      <div className="flex items-center gap-2">
                        <Shield size={13} style={{ color: 'var(--s-text-dim)' }} />
                        <span className="t-label" style={{ color: 'var(--s-text)' }}>STRUCTURE{sortedStructures.length > 1 ? 'S' : ''}</span>
                      </div>
                    </div>
                    <div className="p-5 space-y-3">
                      {sortedStructures.map(ps => {
                        const psIsLeader = ps.role === 'fondateur' || ps.role === 'co_fondateur';
                        return (
                          <Link key={ps.id} href={`/community/structure/${ps.id}`}
                            className="block p-3 bevel-sm transition-colors duration-150"
                            style={{ background: 'var(--s-elevated)', border: '1px solid var(--s-border)' }}>
                            <div className="flex items-center gap-3">
                              {ps.logoUrl ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img src={ps.logoUrl} alt={ps.name} className="w-8 h-8 object-contain bevel-sm flex-shrink-0"
                                  style={{ background: 'var(--s-surface)', border: '1px solid var(--s-border)' }} />
                              ) : (
                                <div className="w-8 h-8 flex items-center justify-center bevel-sm flex-shrink-0"
                                  style={{ background: 'var(--s-surface)', border: '1px solid var(--s-border)' }}>
                                  <Shield size={13} style={{ color: 'var(--s-text-muted)' }} />
                                </div>
                              )}
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-semibold truncate" style={{ color: 'var(--s-text)' }}>
                                  {ps.name}
                                  {ps.tag && <span className="ml-1.5 t-mono" style={{ color: 'var(--s-text-muted)', fontSize: '12px' }}>[{ps.tag}]</span>}
                                </p>
                                <p className="t-mono" style={{ fontSize: '12px', color: psIsLeader ? 'var(--s-gold)' : 'var(--s-text-dim)' }}>
                                  {ROLE_LABELS[ps.role] ?? 'Membre'}
                                </p>
                              </div>
                            </div>
                            {ps.teams.length > 0 && (
                              <div className="mt-2 flex flex-wrap gap-1.5">
                                {ps.teams.map(t => {
                                  const gameClass = t.game === 'rocket_league' ? 'tag-blue' : t.game === 'trackmania' ? 'tag-green' : 'tag-neutral';
                                  return (
                                    <span key={t.id} className={`tag ${gameClass}`} style={{ fontSize: '12px', padding: '2px 7px' }}>
                                      {TEAM_ROLE_LABELS[t.role]} · {t.name}
                                    </span>
                                  );
                                })}
                              </div>
                            )}
                          </Link>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}

              {/* Comptes & liens — version compacte (chips inline) */}
              {visibleConnections.length > 0 && (
                <div className="pillar-card panel relative overflow-hidden">
                  <div className="h-[3px]" style={{ background: 'linear-gradient(90deg, var(--s-gold), rgba(255,184,0,0.3), transparent 70%)' }} />
                  <div className="relative z-[1]">
                    <div className="panel-header">
                      <div className="flex items-center gap-2">
                        <Link2 size={13} style={{ color: 'var(--s-gold)' }} />
                        <span className="t-label" style={{ color: 'var(--s-text)' }}>COMPTES & LIENS</span>
                      </div>
                    </div>
                    <div className="p-4">
                      <div className="flex flex-wrap gap-1.5">
                        {visibleConnections.map(conn => {
                          const meta = getConnectionMeta(conn.type);
                          const url = buildConnectionUrl(conn);
                          const label = meta?.label ?? conn.type;
                          const inner = (
                            <span
                              className="inline-flex items-center gap-1.5 px-2 py-1 transition-colors bevel-sm"
                              style={{
                                background: 'var(--s-elevated)',
                                border: '1px solid var(--s-border)',
                                color: 'var(--s-text-dim)',
                                fontSize: '12px',
                              }}
                            >
                              <span className="font-semibold" style={{ color: 'var(--s-text)' }}>{label}</span>
                              <span style={{ color: 'var(--s-text-muted)' }}>·</span>
                              <span className="truncate" style={{ maxWidth: '120px' }}>{conn.name}</span>
                              {url && <ExternalLink size={9} style={{ color: 'var(--s-text-muted)', flexShrink: 0 }} />}
                            </span>
                          );
                          return url ? (
                            <a key={conn.type} href={url} target="_blank" rel="noopener noreferrer">
                              {inner}
                            </a>
                          ) : (
                            <span key={conn.type}>{inner}</span>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                </div>
              )}

            </div>
          </aside>
          {/* ── FIN SIDEBAR ── */}
        </div>
        {/* ── FIN GRID 2 COLS ── */}

      </div>
    </div>
  );
}

function RLEmptyState({ isOwner }: { isOwner: boolean }) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-6 px-3">
      <div
        className="w-14 h-14 flex items-center justify-center mb-4"
        style={{ background: 'rgba(0,129,255,0.08)', border: '1px solid rgba(0,129,255,0.25)' }}
      >
        <Gamepad2 size={26} style={{ color: 'var(--s-blue)' }} />
      </div>
      <p className="text-sm font-semibold mb-2" style={{ color: 'var(--s-text)' }}>
        {isOwner ? 'Lie ton compte Epic' : 'Aucun tracker RL lié'}
      </p>
      <p className="text-xs mb-4 max-w-[220px]" style={{ color: 'var(--s-text-muted)' }}>
        {isOwner
          ? 'Ajoute ton pseudo Epic Games pour afficher ton rang et ton MMR en direct depuis Rocket League.'
          : 'Ce joueur n\'a pas encore renseigné son identifiant Epic Games.'}
      </p>
      {isOwner && (
        <Link href="/settings" className="btn-springs btn-secondary bevel-sm inline-flex items-center gap-2">
          <Settings size={12} /> Ajouter mon pseudo Epic
        </Link>
      )}
    </div>
  );
}

function SpringsHistoryPanel({
  history,
  games,
  hasTmIdentity,
  isOwner,
}: {
  history: {
    tm: { editionsPlayed: number; finalesReached: number; bestFinalePosition: number | null } | null;
    rl: { competitions: { id: string; name: string; status: string }[] };
  } | null;
  games: string[];
  hasTmIdentity: boolean;
  isOwner: boolean;
}) {
  const playsTM = games.includes('trackmania');
  const playsRL = games.includes('rocket_league');
  const tmCount = history?.tm?.editionsPlayed ?? 0;
  const rlCount = history?.rl?.competitions.length ?? 0;
  const loading = history === null;

  return (
    <div className="pillar-card panel bevel-sm relative overflow-hidden animate-fade-in-d2"
      style={{ background: 'var(--s-surface)', border: '1px solid var(--s-border)' }}>
      <div className="h-[3px]" style={{ background: 'linear-gradient(90deg, var(--s-gold), var(--s-gold), transparent 80%)' }} />
      <div className="absolute top-0 right-0 w-[200px] h-[200px] pointer-events-none opacity-[0.05]"
        style={{ background: 'radial-gradient(circle at top right, var(--s-gold), transparent 70%)' }} />
      <div className="relative z-[1]">
        <div className="panel-header">
          <div className="flex items-center gap-2">
            <History size={13} style={{ color: 'var(--s-gold)' }} />
            <span className="t-label" style={{ color: 'var(--s-text)' }}>HISTORIQUE SPRINGS</span>
          </div>
          <span className="t-label" style={{ color: 'var(--s-text-muted)' }}>Compétitions officielles</span>
        </div>
        <div className="p-5">
          {loading ? (
            <div className="flex items-center gap-3">
              <Loader2 size={14} className="animate-spin" style={{ color: 'var(--s-gold)' }} />
              <span className="text-sm" style={{ color: 'var(--s-text-muted)' }}>Chargement de l&apos;historique...</span>
            </div>
          ) : tmCount === 0 && rlCount === 0 ? (
            <HistoryEmpty
              playsTM={playsTM}
              playsRL={playsRL}
              hasTmIdentity={hasTmIdentity}
              isOwner={isOwner}
            />
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {playsTM && (
                <HistoryBlock
                  accent="var(--s-green)"
                  icon={<Trophy size={18} style={{ color: '#33ff66' }} />}
                  title="MONTHLY CUP"
                  subtitle="Trackmania"
                >
                  {history?.tm ? (
                    <div className="flex items-center gap-5 flex-wrap">
                      <HistoryStat
                        value={String(history.tm.editionsPlayed)}
                        label="ÉDITIONS JOUÉES"
                        tooltip="Nombre d'éditions Monthly Cup auxquelles ce joueur a participé"
                      />
                      <HistoryStat
                        value={String(history.tm.finalesReached)}
                        label="FINALES ATTEINTES"
                        tooltip="Nombre de fois qualifié en finale"
                      />
                      {history.tm.bestFinalePosition !== null && (
                        <HistoryStat
                          value={`#${history.tm.bestFinalePosition}`}
                          label="MEILLEURE PLACE"
                          tooltip="Meilleure position en phase finale"
                          highlight
                        />
                      )}
                    </div>
                  ) : (
                    <p className="text-sm" style={{ color: 'var(--s-text-muted)' }}>
                      {hasTmIdentity
                        ? 'Aucune participation enregistrée pour le pseudo TM actuel.'
                        : 'Pseudo Trackmania non renseigné — impossible de croiser les résultats.'}
                    </p>
                  )}
                </HistoryBlock>
              )}
              {playsRL && (
                <HistoryBlock
                  accent="var(--s-blue)"
                  icon={<Sparkles size={18} style={{ color: 'var(--s-blue)' }} />}
                  title="LEAGUE SERIES"
                  subtitle="Rocket League"
                >
                  {history?.rl.competitions.length ? (
                    <ul className="space-y-1.5">
                      {history.rl.competitions.slice(0, 5).map(c => (
                        <li key={c.id} className="flex items-center justify-between gap-3 px-3 py-2"
                          style={{ background: 'var(--s-elevated)', border: '1px solid var(--s-border)' }}>
                          <span className="text-sm truncate" style={{ color: 'var(--s-text)' }}>{c.name}</span>
                          <span className="t-label flex-shrink-0" style={{ color: 'var(--s-text-muted)' }}>{c.status}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-sm" style={{ color: 'var(--s-text-muted)' }}>
                      Aucune inscription à une compétition Springs pour l&apos;instant.
                    </p>
                  )}
                </HistoryBlock>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function HistoryBlock({
  accent, icon, title, subtitle, children,
}: {
  accent: string;
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <div className="p-4 relative overflow-hidden"
      style={{ background: 'var(--s-elevated)', border: `1px solid ${accent}25` }}>
      <div className="h-[2px] -mx-4 -mt-4 mb-3" style={{ background: `linear-gradient(90deg, ${accent}, ${accent}40, transparent 80%)` }} />
      <div className="flex items-center gap-2.5 mb-3">
        {icon}
        <div>
          <p className="font-display text-base" style={{ color: 'var(--s-text)', lineHeight: 1 }}>{title}</p>
          <p className="t-label mt-0.5" style={{ color: 'var(--s-text-muted)' }}>{subtitle}</p>
        </div>
      </div>
      {children}
    </div>
  );
}

function HistoryStat({
  value, label, tooltip, highlight = false,
}: {
  value: string;
  label: string;
  tooltip?: string;
  highlight?: boolean;
}) {
  return (
    <div title={tooltip}>
      <p className="font-display text-2xl" style={{ color: highlight ? 'var(--s-gold)' : 'var(--s-text)', lineHeight: 1 }}>{value}</p>
      <p className="t-label mt-1" style={{ color: 'var(--s-text-muted)' }}>{label}</p>
    </div>
  );
}

function HistoryEmpty({
  playsTM, playsRL, hasTmIdentity, isOwner,
}: {
  playsTM: boolean;
  playsRL: boolean;
  hasTmIdentity: boolean;
  isOwner: boolean;
}) {
  return (
    <div className="text-center py-2">
      <History size={22} className="mx-auto mb-3" style={{ color: 'var(--s-text-muted)' }} />
      <p className="text-sm mb-1" style={{ color: 'var(--s-text)' }}>Aucune participation enregistrée</p>
      <p className="text-xs max-w-md mx-auto" style={{ color: 'var(--s-text-muted)' }}>
        {playsTM && !hasTmIdentity && isOwner
          ? 'Renseigne ton pseudo Trackmania dans les paramètres pour croiser ton historique Monthly Cup.'
          : playsTM && playsRL
          ? 'Les participations aux compétitions Springs (Monthly Cup TM, League Series RL) apparaîtront ici.'
          : playsTM
          ? 'Les participations à la Monthly Cup Trackmania apparaîtront ici.'
          : playsRL
          ? 'Les participations aux Springs League Series RL apparaîtront ici.'
          : 'Les participations aux compétitions Springs apparaîtront ici.'}
      </p>
    </div>
  );
}
