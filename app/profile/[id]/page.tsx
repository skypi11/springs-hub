'use client';

import { useState, useEffect, use } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import ReactMarkdown from 'react-markdown';
import { useAuth } from '@/context/AuthContext';
import { countries } from '@/lib/countries';
import type { SpringsUser, RLStats } from '@/types';
import {
  User, Globe, Calendar, Gamepad2, Search, Shield,
  ExternalLink, Settings, Loader2, AlertCircle,
  Trophy, History, Sparkles,
} from 'lucide-react';
import Breadcrumbs from '@/components/ui/Breadcrumbs';
import CompactStickyHeader from '@/components/ui/CompactStickyHeader';
import { SkeletonPageHeader, SkeletonCard } from '@/components/ui/Skeleton';
import InviteToStructureButton from '@/components/community/InviteToStructureButton';

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
  const { firebaseUser } = useAuth();
  const [profile, setProfile] = useState<(SpringsUser & { age?: number | null }) | null>(null);
  const [rlStats, setRlStats] = useState<RLStats | null>(null);
  const [rlStatsLoaded, setRlStatsLoaded] = useState(false);
  const [rlTrackerUrl, setRlTrackerUrl] = useState('');
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

        // Fetch RL stats si le joueur joue à RL
        if (data.games?.includes('rocket_league')) {
          if (data.epicAccountId) {
            try {
              const rlRes = await fetch(`/api/rl-stats?epicId=${encodeURIComponent(data.epicAccountId)}`);
              if (rlRes.ok) {
                const stats = await rlRes.json();
                if (stats.rank) setRlStats(stats.rank);
                if (stats.trackerUrl) setRlTrackerUrl(stats.trackerUrl);
              }
            } catch (err) {
              console.error('[Profile] RL stats fetch error:', err);
            }
            if (data.rlTrackerUrl) setRlTrackerUrl(prev => prev || data.rlTrackerUrl || '');
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
      <div className="min-h-screen hex-bg px-8 py-8 space-y-8">
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
      <div className="min-h-screen px-8 py-8 flex items-center justify-center">
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

  return (
    <div className="min-h-screen hex-bg px-8 py-8 space-y-8">
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

        {/* ─── HERO HEADER ─────────────────────────────────────────────────── */}
        <header className="bevel animate-fade-in relative overflow-hidden" style={{ background: 'var(--s-surface)', border: '1px solid var(--s-border)' }}>
          <div className="h-[3px]" style={{ background: 'linear-gradient(90deg, var(--s-gold), rgba(255,184,0,0.3), transparent 80%)' }} />

          {/* Glows */}
          <div className="absolute top-0 left-0 w-[500px] h-[400px] pointer-events-none opacity-[0.06]"
            style={{ background: 'radial-gradient(ellipse at top left, var(--s-gold), transparent 70%)' }} />

          <div className="relative z-[1] p-10 flex items-start gap-8">
            {/* Avatar */}
            <div className="flex-shrink-0 w-28 h-28 relative overflow-hidden bevel-sm"
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
              <div className="flex items-center gap-2 mb-3 flex-wrap">
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
              <h1 className="t-display mb-3">
                {profile.displayName}
              </h1>

              {/* Infos sous le nom */}
              <div className="flex items-center gap-5">
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
                  <div className="flex items-center gap-1.5">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="var(--s-text-muted)">
                      <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057.1 18.079.11 18.1.128 18.114c2.052 1.5 4.044 2.414 5.993 3.016a.077.077 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028c1.961-.6 3.95-1.505 6.002-3.016a.077.077 0 0 0 .032-.027c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03z"/>
                    </svg>
                    <span className="text-sm" style={{ color: 'var(--s-text-dim)' }}>{profile.discordUsername}</span>
                  </div>
                )}
              </div>
            </div>

            {/* Actions */}
            {isOwner && (
              <Link href="/settings" className="btn-springs btn-secondary bevel-sm flex-shrink-0 flex items-center gap-2">
                <Settings size={13} /> Modifier
              </Link>
            )}
          </div>
        </header>

        {/* ─── BIO ───────────────────────────────────────────────────────── */}
        {profile.bio && (
          <div className="pillar-card panel relative overflow-hidden animate-fade-in-d1">
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
        <div className="grid grid-cols-2 gap-6 animate-fade-in-d1">

          {/* Stats RL */}
          {profile.games?.includes('rocket_league') && (
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
                  {(profile.epicDisplayName || profile.epicAccountId) && (
                    <span className="tag tag-blue" style={{ fontSize: '8px' }}>{profile.epicDisplayName || profile.epicAccountId}</span>
                  )}
                </div>
                <div className="p-5 flex-1 flex flex-col">
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
                  ) : rlStatsLoaded && !profile.epicAccountId ? (
                    <RLEmptyState isOwner={isOwner} />
                  ) : rlStatsLoaded ? (
                    <div className="text-center py-4">
                      <Gamepad2 size={24} className="mx-auto mb-2" style={{ color: 'var(--s-text-muted)' }} />
                      <p className="text-sm" style={{ color: 'var(--s-text-muted)' }}>Stats indisponibles</p>
                      <p className="text-xs mt-1" style={{ color: 'var(--s-text-muted)' }}>
                        L&apos;API Tracker.gg n&apos;a rien retourné pour ce compte.
                      </p>
                    </div>
                  ) : (
                    <div className="flex items-center gap-3">
                      <Loader2 size={16} className="animate-spin" style={{ color: 'var(--s-blue)' }} />
                      <span className="text-sm" style={{ color: 'var(--s-text-muted)' }}>Chargement des stats...</span>
                    </div>
                  )}

                  {(rlTrackerUrl || profile.rlTrackerUrl) && (
                    <div className="mt-auto pt-4">
                      <div className="divider mb-4" />
                      <a href={rlTrackerUrl || profile.rlTrackerUrl} target="_blank" rel="noopener noreferrer"
                        className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider transition-colors hover:text-white"
                        style={{ color: 'var(--s-blue)' }}>
                        Voir sur RL Tracker <ExternalLink size={11} />
                      </a>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

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
        <SpringsHistoryPanel
          history={history}
          games={profile.games ?? []}
          hasTmIdentity={Boolean((profile.pseudoTM || '').trim() || (profile.loginTM || '').trim())}
          isOwner={isOwner}
        />

        {/* ─── SIDEBAR INFO ──────────────────────────────────────────────── */}
        <div className="grid grid-cols-3 gap-6 animate-fade-in-d2">

          {/* Recrutement */}
          {profile.isAvailableForRecruitment && (
            <div className="pillar-card panel relative overflow-hidden group transition-all duration-200">
              <div className="h-[3px]" style={{ background: 'linear-gradient(90deg, var(--s-gold), rgba(255,184,0,0.3), transparent 70%)' }} />
              <div className="absolute top-0 right-0 w-[150px] h-[150px] pointer-events-none opacity-[0.06]"
                style={{ background: 'radial-gradient(circle at top right, var(--s-gold), transparent 70%)' }} />
              <div className="relative z-[1]">
                <div className="panel-header">
                  <div className="flex items-center gap-2">
                    <Search size={13} style={{ color: 'var(--s-gold)' }} />
                    <span className="t-label" style={{ color: 'var(--s-text)' }}>DISPONIBLE AU RECRUTEMENT</span>
                  </div>
                  <span className="tag tag-gold" style={{ fontSize: '9px' }}>OUVERT</span>
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

          {/* Structure(s) */}
          <div className="pillar-card panel relative overflow-hidden group transition-all duration-200">
            <div className="h-[3px]" style={{ background: 'linear-gradient(90deg, rgba(255,255,255,0.15), transparent 60%)' }} />
            <div className="relative z-[1]">
              <div className="panel-header">
                <div className="flex items-center gap-2">
                  <Shield size={13} style={{ color: 'var(--s-text-dim)' }} />
                  <span className="t-label" style={{ color: 'var(--s-text)' }}>STRUCTURE{(profile.structures?.length ?? 0) > 1 ? 'S' : ''}</span>
                </div>
              </div>
              <div className="p-5 space-y-3">
                {(!profile.structures || profile.structures.length === 0) ? (
                  <p className="text-xs" style={{ color: 'var(--s-text-muted)' }}>Aucune structure pour le moment.</p>
                ) : profile.structures.map(ps => {
                  const roleLabels: Record<string, string> = {
                    fondateur: 'Fondateur', co_fondateur: 'Co-fondateur',
                    responsable: 'Responsable', coach_structure: 'Coach structure',
                    manager_equipe: "Manager d'équipe", coach_equipe: 'Coach',
                    capitaine: 'Capitaine', joueur: 'Joueur', remplacant: 'Remplaçant', membre: 'Membre',
                  };
                  const teamRoleLabels: Record<string, string> = {
                    joueur: 'Joueur', remplacant: 'Remplaçant', coach: 'Coach', manager: 'Manager', capitaine: 'Capitaine',
                  };
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
                            {ps.tag && <span className="ml-1.5 t-mono" style={{ color: 'var(--s-text-muted)', fontSize: '10px' }}>[{ps.tag}]</span>}
                          </p>
                          <p className="t-mono" style={{ fontSize: '10px', color: 'var(--s-gold)' }}>{roleLabels[ps.role] ?? 'Membre'}</p>
                        </div>
                      </div>
                      {ps.teams.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {ps.teams.map(t => {
                            const gameClass = t.game === 'rocket_league' ? 'tag-blue' : t.game === 'trackmania' ? 'tag-green' : 'tag-neutral';
                            return (
                              <span key={t.id} className={`tag ${gameClass}`} style={{ fontSize: '9px', padding: '2px 7px' }}>
                                {teamRoleLabels[t.role]} · {t.name}
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

          {/* Infos rapides */}
          <div className="pillar-card panel relative overflow-hidden group transition-all duration-200">
            <div className="h-[3px]" style={{ background: 'linear-gradient(90deg, rgba(255,255,255,0.15), transparent 60%)' }} />
            <div className="relative z-[1]">
              <div className="panel-header">
                <div className="flex items-center gap-2">
                  <Globe size={13} style={{ color: 'var(--s-text-dim)' }} />
                  <span className="t-label" style={{ color: 'var(--s-text)' }}>INFORMATIONS</span>
                </div>
              </div>
              <div className="p-5 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs" style={{ color: 'var(--s-text-dim)' }}>Jeux</span>
                  <div className="flex gap-1.5">
                    {profile.games?.map(g => (
                      <span key={g} className={`tag ${g === 'rocket_league' ? 'tag-blue' : 'tag-green'}`}
                        style={{ fontSize: '9px', padding: '2px 6px' }}>
                        {g === 'rocket_league' ? 'RL' : 'TM'}
                      </span>
                    ))}
                  </div>
                </div>
                {country && (
                  <>
                    <div className="divider" />
                    <div className="flex items-center justify-between">
                      <span className="text-xs" style={{ color: 'var(--s-text-dim)' }}>Pays</span>
                      <span className="text-xs flex items-center gap-1.5" style={{ color: 'var(--s-text)' }}>
                        <CountryFlag code={country.code} size={14} /> {country.name}
                      </span>
                    </div>
                  </>
                )}
                {age !== null && (
                  <>
                    <div className="divider" />
                    <div className="flex items-center justify-between">
                      <span className="text-xs" style={{ color: 'var(--s-text-dim)' }}>Âge</span>
                      <span className="font-display text-sm">{age} ans</span>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>

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
