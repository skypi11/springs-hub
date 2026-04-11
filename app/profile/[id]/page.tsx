'use client';

import { useState, useEffect, use } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';
import { countries } from '@/lib/countries';
import type { SpringsUser, RLStats } from '@/types';
import {
  User, Globe, Calendar, Gamepad2, Search, Shield,
  ExternalLink, ChevronRight, Settings, Loader2, AlertCircle,
  Trophy, Target, Crosshair, Medal
} from 'lucide-react';

function getAge(dateStr: string): number {
  const birth = new Date(dateStr);
  const now = new Date();
  let age = now.getFullYear() - birth.getFullYear();
  const m = now.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < birth.getDate())) age--;
  return age;
}

export default function ProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { firebaseUser } = useAuth();
  const [profile, setProfile] = useState<SpringsUser | null>(null);
  const [rlStats, setRlStats] = useState<RLStats | null>(null);
  const [rlTrackerUrl, setRlTrackerUrl] = useState('');
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
        const data = { uid: id, ...await res.json() } as SpringsUser;
        setProfile(data);

        // Fetch RL stats si le joueur joue à RL
        if (data.games?.includes('rocket_league') && data.epicAccountId) {
          try {
            const res = await fetch(`/api/rl-stats?epicId=${encodeURIComponent(data.epicAccountId)}`);
            if (res.ok) {
              const stats = await res.json();
              if (stats.rank) setRlStats(stats.rank);
              if (stats.trackerUrl) setRlTrackerUrl(stats.trackerUrl);
            }
          } catch (err) {
            console.error('[Profile] RL stats fetch error:', err);
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
      <div className="min-h-screen px-8 py-8 flex items-center justify-center">
        <Loader2 size={24} className="animate-spin" style={{ color: 'var(--s-text-dim)' }} />
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
  const age = profile.dateOfBirth ? getAge(profile.dateOfBirth) : null;

  return (
    <div className="min-h-screen px-8 py-8 space-y-8">

      {/* ─── HEADER PROFIL ─────────────────────────────────────────────── */}
      <header className="bevel animate-fade-in relative overflow-hidden" style={{ background: 'var(--s-surface)', border: '1px solid var(--s-border)' }}>
        <div className="h-[3px]" style={{ background: 'linear-gradient(90deg, var(--s-violet), var(--s-violet-light), transparent 80%)' }} />

        <div className="absolute top-0 right-0 w-[400px] h-[300px] pointer-events-none opacity-[0.05]"
          style={{ background: 'radial-gradient(ellipse at top right, var(--s-violet), transparent 70%)' }} />

        <div className="relative z-[1] p-8 flex items-center gap-8">
          {/* Avatar */}
          <div className="flex-shrink-0 w-24 h-24 relative overflow-hidden"
            style={{ background: 'var(--s-elevated)', border: '2px solid var(--s-border)' }}>
            {avatarSrc ? (
              <Image src={avatarSrc} alt={profile.displayName} fill className="object-cover" unoptimized />
            ) : (
              <div className="w-full h-full flex items-center justify-center">
                <User size={40} style={{ color: 'var(--s-text-muted)' }} />
              </div>
            )}
          </div>

          <div className="flex-1">
            <div className="flex items-center gap-3 mb-2">
              {profile.games?.map(g => (
                <span key={g} className={`tag ${g === 'rocket_league' ? 'tag-blue' : 'tag-green'}`}>
                  {g === 'rocket_league' ? 'RL' : 'TM'}
                </span>
              ))}
              {profile.isAvailableForRecruitment && (
                <span className="tag" style={{ background: 'rgba(0,217,54,0.1)', color: '#33ff66', borderColor: 'rgba(0,217,54,0.25)' }}>
                  <Search size={9} /> Disponible
                </span>
              )}
            </div>

            <h1 className="font-display text-4xl mb-1" style={{ letterSpacing: '0.03em' }}>
              {profile.displayName}
            </h1>

            <div className="flex items-center gap-4 mt-2">
              {country && (
                <span className="t-mono flex items-center gap-1.5" style={{ color: 'var(--s-text-dim)' }}>
                  <Globe size={12} /> {country.flag} {country.name}
                </span>
              )}
              {age !== null && (
                <span className="t-mono flex items-center gap-1.5" style={{ color: 'var(--s-text-dim)' }}>
                  <Calendar size={12} /> {age} ans
                </span>
              )}
            </div>
          </div>

          {isOwner && (
            <Link href="/settings" className="btn-springs btn-secondary bevel-sm flex-shrink-0">
              <Settings size={14} /> Modifier
            </Link>
          )}
        </div>
      </header>

      <div className="grid grid-cols-3 gap-6 animate-fade-in-d1">

        {/* ─── COLONNE GAUCHE ──────────────────────────────────────────────── */}
        <div className="col-span-2 space-y-6">

          {/* Bio */}
          {profile.bio && (
            <div className="panel">
              <div className="panel-header">
                <span className="t-label" style={{ color: 'var(--s-text)' }}>À PROPOS</span>
              </div>
              <div className="panel-body">
                <p className="t-body" style={{ whiteSpace: 'pre-wrap' }}>{profile.bio}</p>
              </div>
            </div>
          )}

          {/* Stats RL */}
          {profile.games?.includes('rocket_league') && (
            <div className="panel">
              <div className="panel-header">
                <div className="flex items-center gap-2">
                  <Gamepad2 size={13} style={{ color: '#4da6ff' }} />
                  <span className="t-label" style={{ color: 'var(--s-text)' }}>ROCKET LEAGUE</span>
                </div>
                <span className="tag tag-blue">
                  {profile.epicAccountId}
                </span>
              </div>
              <div className="panel-body">
                {rlStats ? (
                  <div className="flex items-center gap-8">
                    {/* Rang icon + info */}
                    <div className="flex items-center gap-4">
                      {rlStats.iconUrl && (
                        <div className="w-16 h-16 flex-shrink-0">
                          <Image src={rlStats.iconUrl} alt={rlStats.rank ?? ''} width={64} height={64} unoptimized />
                        </div>
                      )}
                      <div>
                        <p className="font-display text-2xl" style={{ letterSpacing: '0.03em', color: 'var(--s-text)' }}>
                          {rlStats.rank}
                        </p>
                        {rlStats.division && (
                          <p className="t-mono" style={{ color: 'var(--s-text-dim)' }}>{rlStats.division}</p>
                        )}
                      </div>
                    </div>

                    {/* MMR */}
                    {rlStats.mmr && (
                      <div className="text-center">
                        <p className="font-display text-3xl" style={{ color: '#4da6ff', lineHeight: 1 }}>{rlStats.mmr}</p>
                        <p className="t-label" style={{ fontSize: '9px', color: 'var(--s-text-muted)' }}>MMR</p>
                      </div>
                    )}

                    {/* Playlist */}
                    {rlStats.playlist && (
                      <div>
                        <p className="t-label" style={{ fontSize: '9px', color: 'var(--s-text-muted)' }}>Playlist</p>
                        <p className="t-mono" style={{ color: 'var(--s-text-dim)' }}>{rlStats.playlist}</p>
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="t-body">Stats en cours de chargement ou indisponibles.</p>
                )}

                {/* Lien RL Tracker */}
                {rlTrackerUrl && (
                  <>
                    <div className="divider my-4" />
                    <a href={rlTrackerUrl} target="_blank" rel="noopener noreferrer"
                      className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider transition-colors hover:text-white"
                      style={{ color: '#4da6ff' }}>
                      Voir sur RL Tracker <ExternalLink size={11} />
                    </a>
                  </>
                )}
              </div>
            </div>
          )}

          {/* Stats TM */}
          {profile.games?.includes('trackmania') && (
            <div className="panel">
              <div className="panel-header">
                <div className="flex items-center gap-2">
                  <Gamepad2 size={13} style={{ color: '#33ff66' }} />
                  <span className="t-label" style={{ color: 'var(--s-text)' }}>TRACKMANIA</span>
                </div>
                <span className="tag tag-green">
                  {profile.pseudoTM}
                </span>
              </div>
              <div className="panel-body">
                <div className="flex items-center gap-6">
                  <div className="flex items-center gap-3">
                    <div className="p-2.5" style={{ background: 'rgba(0,217,54,0.08)', border: '1px solid rgba(0,217,54,0.2)' }}>
                      <Trophy size={20} style={{ color: '#33ff66' }} />
                    </div>
                    <div>
                      <p className="text-sm font-semibold" style={{ color: 'var(--s-text)' }}>{profile.pseudoTM}</p>
                      <p className="t-mono" style={{ color: 'var(--s-text-muted)' }}>Joueur Trackmania</p>
                    </div>
                  </div>
                </div>

                {profile.tmIoUrl && (
                  <>
                    <div className="divider my-4" />
                    <a href={profile.tmIoUrl} target="_blank" rel="noopener noreferrer"
                      className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider transition-colors hover:text-white"
                      style={{ color: '#33ff66' }}>
                      Voir sur Trackmania.io <ExternalLink size={11} />
                    </a>
                  </>
                )}
              </div>
            </div>
          )}
        </div>

        {/* ─── COLONNE DROITE ──────────────────────────────────────────────── */}
        <div className="space-y-6">

          {/* Recrutement */}
          {profile.isAvailableForRecruitment && (
            <div className="panel">
              <div className="panel-header">
                <div className="flex items-center gap-2">
                  <Search size={13} style={{ color: '#33ff66' }} />
                  <span className="t-label" style={{ color: 'var(--s-text)' }}>RECRUTEMENT</span>
                </div>
                <span className="status status-live" style={{ fontSize: '10px' }}>Disponible</span>
              </div>
              <div className="panel-body space-y-3">
                {profile.recruitmentRole && (
                  <div className="flex items-center gap-2">
                    <span className="t-label">Rôle :</span>
                    <span className="tag" style={{ background: 'rgba(0,217,54,0.1)', color: '#33ff66', borderColor: 'rgba(0,217,54,0.25)', padding: '4px 10px' }}>
                      {profile.recruitmentRole.charAt(0).toUpperCase() + profile.recruitmentRole.slice(1)}
                    </span>
                  </div>
                )}
                {profile.recruitmentMessage && (
                  <p className="t-body" style={{ whiteSpace: 'pre-wrap' }}>{profile.recruitmentMessage}</p>
                )}
              </div>
            </div>
          )}

          {/* Structure */}
          <div className="panel">
            <div className="panel-header">
              <div className="flex items-center gap-2">
                <Shield size={13} style={{ color: 'var(--s-gold)' }} />
                <span className="t-label" style={{ color: 'var(--s-text)' }}>STRUCTURE</span>
              </div>
            </div>
            <div className="panel-body">
              <p className="t-body" style={{ color: 'var(--s-text-muted)' }}>Aucune structure pour le moment.</p>
            </div>
          </div>

          {/* Infos rapides */}
          <div className="panel">
            <div className="panel-header">
              <span className="t-label" style={{ color: 'var(--s-text)' }}>INFORMATIONS</span>
            </div>
            <div className="panel-body space-y-3">
              <div className="flex items-center justify-between">
                <span className="t-body">Discord</span>
                <span className="t-mono" style={{ color: 'var(--s-text)' }}>{profile.discordUsername}</span>
              </div>
              <div className="divider" />
              <div className="flex items-center justify-between">
                <span className="t-body">Jeux</span>
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
                    <span className="t-body">Pays</span>
                    <span className="t-mono">{country.flag} {country.code}</span>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
