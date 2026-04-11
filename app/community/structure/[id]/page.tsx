'use client';

import { useState, useEffect, use } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import ReactMarkdown from 'react-markdown';
import { useAuth } from '@/context/AuthContext';
import {
  Shield, Users, Gamepad2, ExternalLink, Trophy, Loader2, AlertCircle,
  User, Globe, Search, MessageSquare, UserPlus, CheckCircle
} from 'lucide-react';
import { countries } from '@/lib/countries';

type Member = {
  id: string;
  userId: string;
  game: string;
  role: string;
  displayName: string;
  discordAvatar: string;
  avatarUrl: string;
  country: string;
};

type StructureData = {
  id: string;
  name: string;
  tag: string;
  logoUrl: string;
  description: string;
  games: string[];
  discordUrl: string;
  socials: Record<string, string>;
  recruiting: { active: boolean; positions: { game: string; role: string }[] };
  achievements: { placement?: string; title?: string; competition?: string; game?: string; date?: string }[];
  status: string;
  founderId: string;
  members: Member[];
};

const ROLE_LABELS: Record<string, { label: string; color: string }> = {
  fondateur: { label: 'Fondateur', color: 'var(--s-gold)' },
  co_fondateur: { label: 'Co-fondateur', color: 'var(--s-gold)' },
  manager: { label: 'Manager', color: 'var(--s-violet-light)' },
  coach: { label: 'Coach', color: '#4da6ff' },
  joueur: { label: 'Joueur', color: 'var(--s-text)' },
};

const SOCIAL_ICONS: Record<string, { label: string; color: string }> = {
  twitter: { label: 'Twitter / X', color: '#1da1f2' },
  youtube: { label: 'YouTube', color: '#ff0000' },
  twitch: { label: 'Twitch', color: '#9146ff' },
  instagram: { label: 'Instagram', color: '#e4405f' },
  tiktok: { label: 'TikTok', color: '#00f2ea' },
  website: { label: 'Site web', color: 'var(--s-text-dim)' },
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

export default function StructurePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { firebaseUser, loading: authLoading } = useAuth();
  const [structure, setStructure] = useState<StructureData | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  // Join request state — MUST be before any early returns (React hooks rules)
  const [joinGame, setJoinGame] = useState('');
  const [joinMessage, setJoinMessage] = useState('');
  const [joinLoading, setJoinLoading] = useState(false);
  const [joinSent, setJoinSent] = useState(false);
  const [joinError, setJoinError] = useState('');
  const [showJoinForm, setShowJoinForm] = useState(false);

  useEffect(() => {
    // Attendre que l'auth soit résolu avant de charger
    if (authLoading) return;

    async function load() {
      try {
        const res = await fetch(`/api/structures/${id}`);
        if (res.status === 403) {
          setNotFound(true);
          setLoading(false);
          return;
        }
        if (!res.ok) {
          setNotFound(true);
          setLoading(false);
          return;
        }
        const data = await res.json();
        setStructure(data);
      } catch (err) {
        console.error('[Structure] load error:', err);
        setNotFound(true);
      }
      setLoading(false);
    }
    load();
  }, [id, authLoading]);

  if (loading || authLoading) {
    return (
      <div className="min-h-screen px-8 py-8 flex items-center justify-center">
        <Loader2 size={24} className="animate-spin" style={{ color: 'var(--s-text-dim)' }} />
      </div>
    );
  }

  if (notFound || !structure) {
    return (
      <div className="min-h-screen px-8 py-8 flex items-center justify-center">
        <div className="panel p-10 text-center max-w-md">
          <AlertCircle size={32} className="mx-auto mb-4" style={{ color: 'var(--s-text-muted)' }} />
          <h2 className="font-display text-2xl mb-2">STRUCTURE INTROUVABLE</h2>
          <p className="t-body">Cette structure n&apos;existe pas ou n&apos;est pas accessible.</p>
        </div>
      </div>
    );
  }

  const isOwner = firebaseUser?.uid === structure.founderId;
  const isMember = structure.members.some(m => m.userId === firebaseUser?.uid);
  const socialEntries = Object.entries(structure.socials).filter(([, v]) => v);

  async function handleJoinRequest() {
    if (!firebaseUser || !joinGame || !structure) return;
    setJoinLoading(true);
    setJoinError('');
    try {
      const idToken = await firebaseUser.getIdToken();
      const res = await fetch('/api/structures/join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${idToken}` },
        body: JSON.stringify({ action: 'request_join', structureId: structure.id, game: joinGame, message: joinMessage }),
      });
      const data = await res.json();
      if (res.ok) {
        setJoinSent(true);
        setShowJoinForm(false);
      } else {
        setJoinError(data.error || 'Erreur');
      }
    } catch {
      setJoinError('Erreur réseau');
    }
    setJoinLoading(false);
  }

  return (
    <div className="min-h-screen px-8 py-8 space-y-8">

      {/* ─── HEADER ──────────────────────────────────────────────────────── */}
      <header className="bevel animate-fade-in relative overflow-hidden" style={{ background: 'var(--s-surface)', border: '1px solid var(--s-border)' }}>
        <div className="h-[3px]" style={{ background: 'linear-gradient(90deg, var(--s-gold), var(--s-gold), transparent 80%)' }} />
        <div className="absolute top-0 right-0 w-[400px] h-[300px] pointer-events-none opacity-[0.05]"
          style={{ background: 'radial-gradient(ellipse at top right, var(--s-gold), transparent 70%)' }} />

        <div className="relative z-[1] p-8 flex items-center gap-8">
          {/* Logo */}
          <div className="flex-shrink-0 w-24 h-24 relative overflow-hidden"
            style={{ background: 'var(--s-elevated)', border: '2px solid var(--s-border)' }}>
            {structure.logoUrl ? (
              <Image src={structure.logoUrl} alt={structure.name} fill className="object-contain p-1" unoptimized />
            ) : (
              <div className="w-full h-full flex items-center justify-center">
                <Shield size={40} style={{ color: 'var(--s-text-muted)' }} />
              </div>
            )}
          </div>

          <div className="flex-1">
            <div className="flex items-center gap-3 mb-2">
              <span className="tag tag-neutral">{structure.tag}</span>
              {structure.games?.map(g => (
                <span key={g} className={`tag ${g === 'rocket_league' ? 'tag-blue' : 'tag-green'}`}>
                  {g === 'rocket_league' ? 'RL' : 'TM'}
                </span>
              ))}
              {structure.recruiting?.active && (
                <span className="tag" style={{ background: 'rgba(0,217,54,0.1)', color: '#33ff66', borderColor: 'rgba(0,217,54,0.25)' }}>
                  <Search size={9} /> Recrute
                </span>
              )}
            </div>

            <h1 className="font-display text-4xl mb-2" style={{ letterSpacing: '0.03em' }}>
              {structure.name}
            </h1>

            <div className="flex items-center gap-4">
              <span className="t-mono flex items-center gap-1.5" style={{ color: 'var(--s-text-dim)' }}>
                <Users size={12} /> {structure.members.length} membre{structure.members.length > 1 ? 's' : ''}
              </span>
            </div>
          </div>

          {isOwner ? (
            <Link href="/community/my-structure" className="btn-springs btn-secondary bevel-sm-border flex-shrink-0">
              <span>Gérer</span>
            </Link>
          ) : firebaseUser && !isMember && !joinSent ? (
            <button onClick={() => setShowJoinForm(!showJoinForm)}
              className="btn-springs btn-primary bevel-sm flex-shrink-0 flex items-center gap-2">
              <UserPlus size={14} /> Rejoindre
            </button>
          ) : joinSent ? (
            <span className="flex items-center gap-2 text-xs font-bold" style={{ color: '#33ff66' }}>
              <CheckCircle size={14} /> Demande envoyée
            </span>
          ) : isMember ? (
            <span className="tag tag-gold" style={{ fontSize: '10px', padding: '3px 10px' }}>Membre</span>
          ) : null}
        </div>
      </header>

      {/* Formulaire de demande */}
      {showJoinForm && (
        <div className="bevel p-5 space-y-4 animate-fade-in" style={{ background: 'var(--s-surface)', border: '1px solid rgba(0,129,255,0.2)' }}>
          <div className="flex items-center gap-3 mb-1">
            <div className="w-7 h-7 flex items-center justify-center" style={{ background: 'rgba(0,129,255,0.08)', border: '1px solid rgba(0,129,255,0.2)' }}>
              <UserPlus size={13} style={{ color: 'var(--s-blue)' }} />
            </div>
            <span className="font-display text-sm tracking-wider">DEMANDE DE REJOINDRE</span>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="t-label block mb-1.5">Jeu *</label>
              <select className="settings-input w-full" value={joinGame} onChange={e => setJoinGame(e.target.value)}>
                <option value="">Choisir...</option>
                {structure.games?.includes('rocket_league') && <option value="rocket_league">Rocket League</option>}
                {structure.games?.includes('trackmania') && <option value="trackmania">Trackmania</option>}
              </select>
            </div>
            <div>
              <label className="t-label block mb-1.5">Message (optionnel)</label>
              <input type="text" className="settings-input w-full" placeholder="Pourquoi rejoindre..."
                value={joinMessage} onChange={e => setJoinMessage(e.target.value)} />
            </div>
          </div>
          {joinError && <p className="text-xs" style={{ color: '#ff5555' }}>{joinError}</p>}
          <div className="flex gap-3">
            <button onClick={handleJoinRequest} disabled={!joinGame || joinLoading}
              className="btn-springs btn-primary bevel-sm flex items-center gap-2 text-xs"
              style={{ opacity: joinGame ? 1 : 0.5 }}>
              {joinLoading ? <Loader2 size={12} className="animate-spin" /> : <UserPlus size={12} />}
              Envoyer la demande
            </button>
            <button onClick={() => setShowJoinForm(false)}
              className="btn-springs btn-ghost text-xs">
              Annuler
            </button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-3 gap-6 animate-fade-in-d1">

        {/* ─── COLONNE GAUCHE ─────────────────────────────────────────────── */}
        <div className="col-span-2 space-y-6">

          {/* Description */}
          {structure.description && (
            <div className="panel">
              <div className="panel-header">
                <span className="t-label" style={{ color: 'var(--s-text)' }}>À PROPOS</span>
              </div>
              <div className="panel-body">
                <div className="prose-springs text-sm">
                  <ReactMarkdown>{structure.description}</ReactMarkdown>
                </div>
              </div>
            </div>
          )}

          {/* Membres */}
          <div className="panel">
            <div className="panel-header">
              <div className="flex items-center gap-2">
                <Users size={13} style={{ color: 'var(--s-gold)' }} />
                <span className="t-label" style={{ color: 'var(--s-text)' }}>MEMBRES</span>
              </div>
              <span className="t-mono text-xs" style={{ color: 'var(--s-text-muted)' }}>{structure.members.length}</span>
            </div>
            <div className="divide-y" style={{ borderColor: 'var(--s-border)' }}>
              {structure.members.length === 0 ? (
                <div className="p-5 text-center">
                  <p className="t-body" style={{ color: 'var(--s-text-muted)' }}>Aucun membre pour le moment.</p>
                </div>
              ) : (
                structure.members.map(m => {
                  const roleConf = ROLE_LABELS[m.role] ?? { label: m.role, color: 'var(--s-text-dim)' };
                  const avatar = m.avatarUrl || m.discordAvatar;

                  return (
                    <Link key={m.id} href={`/profile/${m.userId}`}
                      className="flex items-center gap-4 px-5 py-3 transition-colors duration-150 hover:bg-[var(--s-elevated)]">
                      {avatar ? (
                        <div className="w-9 h-9 relative flex-shrink-0 overflow-hidden" style={{ background: 'var(--s-elevated)' }}>
                          <Image src={avatar} alt={m.displayName} fill className="object-cover" unoptimized />
                        </div>
                      ) : (
                        <div className="w-9 h-9 flex-shrink-0 flex items-center justify-center" style={{ background: 'var(--s-elevated)' }}>
                          <User size={14} style={{ color: 'var(--s-text-muted)' }} />
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold truncate" style={{ color: 'var(--s-text)' }}>{m.displayName}</p>
                        <p className="t-mono text-xs" style={{ color: roleConf.color }}>{roleConf.label}</p>
                      </div>
                      {m.country && <CountryFlag code={m.country} size={14} />}
                      <span className={`tag ${m.game === 'rocket_league' ? 'tag-blue' : 'tag-green'}`}
                        style={{ fontSize: '9px', padding: '1px 6px' }}>
                        {m.game === 'rocket_league' ? 'RL' : 'TM'}
                      </span>
                    </Link>
                  );
                })
              )}
            </div>
          </div>

          {/* Palmarès */}
          {structure.achievements && structure.achievements.length > 0 && (
            <div className="panel">
              <div className="panel-header">
                <div className="flex items-center gap-2">
                  <Trophy size={13} style={{ color: 'var(--s-gold)' }} />
                  <span className="t-label" style={{ color: 'var(--s-text)' }}>PALMARÈS</span>
                </div>
              </div>
              <div className="panel-body space-y-2">
                {structure.achievements.map((a, i) => {
                  const isFirst = a.placement === '1er';
                  const medalColor = isFirst ? 'var(--s-gold)' : a.placement === '2e' ? '#c0c0c0' : a.placement === '3e' ? '#cd7f32' : 'var(--s-text-dim)';
                  return (
                    <div key={i} className="flex items-center gap-3 px-3 py-2.5"
                      style={{ background: 'var(--s-elevated)', border: '1px solid var(--s-border)' }}>
                      <div className="flex-shrink-0 w-10 text-center">
                        <span className="font-display text-sm" style={{ color: medalColor }}>{a.placement}</span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold truncate" style={{ color: 'var(--s-text)' }}>{a.competition}</p>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className={`tag ${a.game === 'rocket_league' ? 'tag-blue' : 'tag-green'}`}
                            style={{ fontSize: '8px', padding: '0px 4px' }}>
                            {a.game === 'rocket_league' ? 'RL' : 'TM'}
                          </span>
                          {a.date && (
                            <span className="t-mono text-xs" style={{ color: 'var(--s-text-muted)' }}>
                              {new Date(a.date + '-01').toLocaleDateString('fr-FR', { month: 'short', year: 'numeric' })}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* ─── COLONNE DROITE ─────────────────────────────────────────────── */}
        <div className="space-y-6">

          {/* Recrutement */}
          {structure.recruiting?.active && structure.recruiting.positions.length > 0 && (
            <div className="panel">
              <div className="panel-header">
                <div className="flex items-center gap-2">
                  <Search size={13} style={{ color: '#33ff66' }} />
                  <span className="t-label" style={{ color: 'var(--s-text)' }}>RECRUTEMENT</span>
                </div>
                <span className="status status-live" style={{ fontSize: '10px' }}>Ouvert</span>
              </div>
              <div className="panel-body space-y-2">
                {structure.recruiting.positions.map((p, i) => (
                  <div key={i} className="flex items-center justify-between px-3 py-2"
                    style={{ background: 'var(--s-elevated)', border: '1px solid var(--s-border)' }}>
                    <span className="text-sm" style={{ color: 'var(--s-text)' }}>
                      {p.role.charAt(0).toUpperCase() + p.role.slice(1)}
                    </span>
                    <span className={`tag ${p.game === 'rocket_league' ? 'tag-blue' : 'tag-green'}`}
                      style={{ fontSize: '9px', padding: '1px 6px' }}>
                      {p.game === 'rocket_league' ? 'RL' : 'TM'}
                    </span>
                  </div>
                ))}
                <p className="t-mono text-xs mt-3" style={{ color: 'var(--s-text-muted)' }}>
                  Contactez la structure sur Discord pour postuler.
                </p>
              </div>
            </div>
          )}

          {/* Liens */}
          <div className="panel">
            <div className="panel-header">
              <span className="t-label" style={{ color: 'var(--s-text)' }}>LIENS</span>
            </div>
            <div className="panel-body space-y-2">
              {structure.discordUrl && (
                <a href={structure.discordUrl} target="_blank" rel="noopener noreferrer"
                  className="flex items-center gap-3 px-3 py-2 transition-colors duration-150 hover:bg-[var(--s-elevated)]"
                  style={{ border: '1px solid var(--s-border)' }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="#7289da">
                    <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057.1 18.079.11 18.1.128 18.114c2.052 1.5 4.044 2.414 5.993 3.016a.077.077 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028c1.961-.6 3.95-1.505 6.002-3.016a.077.077 0 0 0 .032-.027c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03z"/>
                  </svg>
                  <span className="text-sm" style={{ color: '#7289da' }}>Discord</span>
                  <ExternalLink size={10} className="ml-auto" style={{ color: 'var(--s-text-muted)' }} />
                </a>
              )}

              {socialEntries.map(([key, url]) => {
                const social = SOCIAL_ICONS[key];
                if (!social) return null;
                return (
                  <a key={key} href={url} target="_blank" rel="noopener noreferrer"
                    className="flex items-center gap-3 px-3 py-2 transition-colors duration-150 hover:bg-[var(--s-elevated)]"
                    style={{ border: '1px solid var(--s-border)' }}>
                    <Globe size={14} style={{ color: social.color }} />
                    <span className="text-sm" style={{ color: social.color }}>{social.label}</span>
                    <ExternalLink size={10} className="ml-auto" style={{ color: 'var(--s-text-muted)' }} />
                  </a>
                );
              })}

              {!structure.discordUrl && socialEntries.length === 0 && (
                <p className="t-body" style={{ color: 'var(--s-text-muted)' }}>Aucun lien pour le moment.</p>
              )}
            </div>
          </div>

          {/* Infos */}
          <div className="panel">
            <div className="panel-header">
              <span className="t-label" style={{ color: 'var(--s-text)' }}>INFORMATIONS</span>
            </div>
            <div className="panel-body space-y-3">
              <div className="flex items-center justify-between">
                <span className="t-body">Jeux</span>
                <div className="flex gap-1.5">
                  {structure.games?.map(g => (
                    <span key={g} className={`tag ${g === 'rocket_league' ? 'tag-blue' : 'tag-green'}`}
                      style={{ fontSize: '9px', padding: '2px 6px' }}>
                      {g === 'rocket_league' ? 'Rocket League' : 'Trackmania'}
                    </span>
                  ))}
                </div>
              </div>
              <div className="divider" />
              <div className="flex items-center justify-between">
                <span className="t-body">Membres</span>
                <span className="t-mono">{structure.members.length}</span>
              </div>
              <div className="divider" />
              <div className="flex items-center justify-between">
                <span className="t-body">Statut</span>
                <span className="tag tag-green" style={{ fontSize: '9px', padding: '2px 6px' }}>Active</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
