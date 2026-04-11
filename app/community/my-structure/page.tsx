'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';
import { auth } from '@/lib/firebase';
import { countries } from '@/lib/countries';
import {
  Shield, Users, Gamepad2, ExternalLink, Trophy, Loader2, AlertCircle,
  User, Save, Plus, Trash2, Settings, Eye, Clock, Ban, CheckCircle,
  Search, Globe, MessageSquare, ChevronDown, ChevronUp
} from 'lucide-react';

type Member = {
  id: string;
  userId: string;
  game: string;
  role: string;
  displayName: string;
  discordUsername: string;
  discordAvatar: string;
  avatarUrl: string;
  country: string;
};

type MyStructure = {
  id: string;
  name: string;
  tag: string;
  logoUrl: string;
  description: string;
  games: string[];
  discordUrl: string;
  socials: Record<string, string>;
  recruiting: { active: boolean; positions: { game: string; role: string }[] };
  achievements: { title: string; date?: string; competition?: string }[];
  status: string;
  reviewComment?: string;
  founderId: string;
  members: Member[];
  requestedAt?: string;
  validatedAt?: string;
};

const STATUS_INFO: Record<string, { label: string; color: string; icon: typeof CheckCircle; desc: string }> = {
  pending_validation: { label: 'En attente de validation', color: '#FFB800', icon: Clock, desc: 'Ta demande est en cours de traitement. Un entretien vocal sera organisé.' },
  active: { label: 'Active', color: '#33ff66', icon: CheckCircle, desc: 'Ta structure est active et visible publiquement.' },
  suspended: { label: 'Suspendue', color: '#ff5555', icon: Ban, desc: 'Ta structure est suspendue. Contacte un admin Springs.' },
  rejected: { label: 'Refusée', color: '#ff5555', icon: AlertCircle, desc: 'Ta demande a été refusée.' },
};

const ROLE_LABELS: Record<string, string> = {
  fondateur: 'Fondateur',
  co_fondateur: 'Co-fondateur',
  manager: 'Manager',
  coach: 'Coach',
  joueur: 'Joueur',
};

export default function MyStructurePage() {
  const { firebaseUser, loading: authLoading } = useAuth();
  const router = useRouter();
  const [structures, setStructures] = useState<MyStructure[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeStructure, setActiveStructure] = useState<MyStructure | null>(null);

  // Editing state
  const [editDesc, setEditDesc] = useState('');
  const [editLogoUrl, setEditLogoUrl] = useState('');
  const [editDiscordUrl, setEditDiscordUrl] = useState('');
  const [editSocials, setEditSocials] = useState<Record<string, string>>({});
  const [editRecruiting, setEditRecruiting] = useState<{ active: boolean; positions: { game: string; role: string }[] }>({ active: false, positions: [] });
  const [editAchievements, setEditAchievements] = useState<{ title: string; date?: string; competition?: string }[]>([]);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  async function loadStructures() {
    if (!firebaseUser) return;
    try {
      const idToken = await firebaseUser.getIdToken();
      const res = await fetch('/api/structures/my', {
        headers: { 'Authorization': `Bearer ${idToken}` },
      });
      if (res.ok) {
        const data = await res.json();
        setStructures(data.structures ?? []);
        if (data.structures?.length > 0 && !activeStructure) {
          selectStructure(data.structures[0]);
        }
      }
    } catch (err) {
      console.error('[MyStructure] load error:', err);
    }
    setLoading(false);
  }

  function selectStructure(s: MyStructure) {
    setActiveStructure(s);
    setEditDesc(s.description || '');
    setEditLogoUrl(s.logoUrl || '');
    setEditDiscordUrl(s.discordUrl || '');
    setEditSocials(s.socials || {});
    setEditRecruiting(s.recruiting || { active: false, positions: [] });
    setEditAchievements(s.achievements || []);
    setSaved(false);
    setError('');
  }

  useEffect(() => {
    if (!authLoading && !firebaseUser) {
      router.push('/');
      return;
    }
    if (firebaseUser) loadStructures();
  }, [authLoading, firebaseUser]);

  async function handleSave() {
    if (!activeStructure || !firebaseUser) return;
    setSaving(true);
    setError('');
    setSaved(false);

    try {
      const idToken = await firebaseUser.getIdToken();
      const res = await fetch('/api/structures/my', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${idToken}`,
        },
        body: JSON.stringify({
          structureId: activeStructure.id,
          description: editDesc,
          logoUrl: editLogoUrl,
          discordUrl: editDiscordUrl,
          socials: editSocials,
          recruiting: editRecruiting,
          achievements: editAchievements.filter(a => a.title.trim()),
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error || 'Erreur lors de la sauvegarde.');
      } else {
        setSaved(true);
        await loadStructures();
      }
    } catch (err) {
      console.error('[MyStructure] save error:', err);
      setError('Erreur réseau.');
    }
    setSaving(false);
  }

  if (authLoading || loading) {
    return (
      <div className="min-h-screen px-8 py-8 flex items-center justify-center">
        <Loader2 size={24} className="animate-spin" style={{ color: 'var(--s-text-dim)' }} />
      </div>
    );
  }

  if (structures.length === 0) {
    return (
      <div className="min-h-screen px-8 py-8 flex items-center justify-center">
        <div className="panel p-10 text-center max-w-md">
          <Shield size={32} className="mx-auto mb-4" style={{ color: 'var(--s-text-muted)' }} />
          <h2 className="font-display text-2xl mb-2">AUCUNE STRUCTURE</h2>
          <p className="t-body mb-5">Tu n&apos;as pas encore créé de structure.</p>
          <Link href="/community/create-structure" className="btn-springs btn-primary bevel-sm">
            Créer une structure
          </Link>
        </div>
      </div>
    );
  }

  const s = activeStructure!;
  const statusInfo = STATUS_INFO[s.status] ?? STATUS_INFO.pending_validation;
  const StatusIcon = statusInfo.icon;
  const canEdit = s.status === 'active';

  return (
    <div className="min-h-screen px-8 py-8 space-y-8">

      {/* Sélecteur si plusieurs structures */}
      {structures.length > 1 && (
        <div className="flex gap-3">
          {structures.map(st => (
            <button key={st.id} onClick={() => selectStructure(st)}
              className="tag transition-all duration-150"
              style={{
                background: st.id === s.id ? 'rgba(255,184,0,0.15)' : 'transparent',
                color: st.id === s.id ? 'var(--s-gold)' : 'var(--s-text-dim)',
                borderColor: st.id === s.id ? 'rgba(255,184,0,0.4)' : 'var(--s-border)',
                cursor: 'pointer', padding: '8px 16px', fontSize: '12px',
              }}>
              {st.name}
            </button>
          ))}
        </div>
      )}

      {/* Header */}
      <header className="bevel animate-fade-in relative overflow-hidden" style={{ background: 'var(--s-surface)', border: '1px solid var(--s-border)' }}>
        <div className="h-[3px]" style={{ background: `linear-gradient(90deg, ${statusInfo.color}, ${statusInfo.color}50, transparent 80%)` }} />
        <div className="relative z-[1] p-8 flex items-center gap-6">
          <div className="flex-shrink-0 w-16 h-16 relative overflow-hidden" style={{ background: 'var(--s-elevated)', border: '2px solid var(--s-border)' }}>
            {s.logoUrl ? (
              <Image src={s.logoUrl} alt={s.name} fill className="object-contain p-1" unoptimized />
            ) : (
              <div className="w-full h-full flex items-center justify-center">
                <Shield size={28} style={{ color: 'var(--s-text-muted)' }} />
              </div>
            )}
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-3 mb-1">
              <h1 className="font-display text-3xl" style={{ letterSpacing: '0.03em' }}>{s.name}</h1>
              <span className="tag tag-neutral">{s.tag}</span>
            </div>
            <div className="flex items-center gap-2">
              <StatusIcon size={13} style={{ color: statusInfo.color }} />
              <span className="t-mono text-xs" style={{ color: statusInfo.color }}>{statusInfo.label}</span>
            </div>
          </div>
          <Link href={`/community/structure/${s.id}`} className="btn-springs btn-secondary bevel-sm-border flex-shrink-0">
            <span><Eye size={14} /></span> <span>Voir page publique</span>
          </Link>
        </div>
      </header>

      {/* Bandeau statut si pas active */}
      {s.status !== 'active' && (
        <div className="px-4 py-3 flex items-center gap-3" style={{ background: `${statusInfo.color}10`, border: `1px solid ${statusInfo.color}30` }}>
          <StatusIcon size={16} style={{ color: statusInfo.color }} />
          <div>
            <p className="text-sm font-semibold" style={{ color: statusInfo.color }}>{statusInfo.label}</p>
            <p className="t-body text-xs">{statusInfo.desc}</p>
            {s.reviewComment && <p className="t-mono text-xs mt-1" style={{ color: 'var(--s-text-dim)' }}>Admin : {s.reviewComment}</p>}
          </div>
        </div>
      )}

      {canEdit ? (
        <div className="grid grid-cols-3 gap-6 animate-fade-in-d1">

          {/* ─── Colonne gauche — édition ─────────────────────────────── */}
          <div className="col-span-2 space-y-6">

            {/* Description */}
            <div className="panel">
              <div className="panel-header">
                <span className="t-label" style={{ color: 'var(--s-text)' }}>DESCRIPTION</span>
              </div>
              <div className="panel-body">
                <textarea className="settings-input w-full" rows={4}
                  value={editDesc} onChange={e => setEditDesc(e.target.value)}
                  placeholder="Description de ta structure..." />
              </div>
            </div>

            {/* Logo + Discord */}
            <div className="panel">
              <div className="panel-header">
                <span className="t-label" style={{ color: 'var(--s-text)' }}>CONFIGURATION</span>
              </div>
              <div className="panel-body space-y-4">
                <div>
                  <label className="t-label block mb-2">Logo URL (carré, fond transparent)</label>
                  <input type="url" className="settings-input w-full"
                    value={editLogoUrl} onChange={e => setEditLogoUrl(e.target.value)}
                    placeholder="https://exemple.com/logo.png" />
                </div>
                <div>
                  <label className="t-label block mb-2">Serveur Discord</label>
                  <input type="url" className="settings-input w-full"
                    value={editDiscordUrl} onChange={e => setEditDiscordUrl(e.target.value)}
                    placeholder="https://discord.gg/..." />
                </div>
              </div>
            </div>

            {/* Réseaux sociaux */}
            <div className="panel">
              <div className="panel-header">
                <span className="t-label" style={{ color: 'var(--s-text)' }}>RÉSEAUX SOCIAUX</span>
              </div>
              <div className="panel-body space-y-3">
                {['twitter', 'youtube', 'twitch', 'instagram', 'tiktok', 'website'].map(key => (
                  <div key={key}>
                    <label className="t-label block mb-1" style={{ textTransform: 'capitalize' }}>
                      {key === 'twitter' ? 'Twitter / X' : key === 'website' ? 'Site web' : key}
                    </label>
                    <input type="url" className="settings-input w-full" placeholder={`https://...`}
                      value={editSocials[key] || ''}
                      onChange={e => setEditSocials({ ...editSocials, [key]: e.target.value })} />
                  </div>
                ))}
              </div>
            </div>

            {/* Recrutement */}
            <div className="panel">
              <div className="panel-header">
                <div className="flex items-center gap-2">
                  <Search size={13} style={{ color: '#33ff66' }} />
                  <span className="t-label" style={{ color: 'var(--s-text)' }}>RECRUTEMENT</span>
                </div>
              </div>
              <div className="panel-body space-y-4">
                <label className="flex items-center gap-3 cursor-pointer">
                  <input type="checkbox" checked={editRecruiting.active}
                    onChange={e => setEditRecruiting({ ...editRecruiting, active: e.target.checked })}
                    className="w-4 h-4" />
                  <span className="text-sm" style={{ color: 'var(--s-text)' }}>Nous recrutons actuellement</span>
                </label>

                {editRecruiting.active && (
                  <div className="space-y-2">
                    <p className="t-label">Postes recherchés</p>
                    {editRecruiting.positions.map((p, i) => (
                      <div key={i} className="flex items-center gap-2">
                        <select className="settings-input flex-1" value={p.game}
                          onChange={e => {
                            const positions = [...editRecruiting.positions];
                            positions[i] = { ...p, game: e.target.value };
                            setEditRecruiting({ ...editRecruiting, positions });
                          }}>
                          <option value="rocket_league">Rocket League</option>
                          <option value="trackmania">Trackmania</option>
                        </select>
                        <select className="settings-input flex-1" value={p.role}
                          onChange={e => {
                            const positions = [...editRecruiting.positions];
                            positions[i] = { ...p, role: e.target.value };
                            setEditRecruiting({ ...editRecruiting, positions });
                          }}>
                          <option value="joueur">Joueur</option>
                          <option value="coach">Coach</option>
                          <option value="manager">Manager</option>
                        </select>
                        <button type="button" onClick={() => {
                          const positions = editRecruiting.positions.filter((_, j) => j !== i);
                          setEditRecruiting({ ...editRecruiting, positions });
                        }} style={{ color: '#ff5555' }}>
                          <Trash2 size={14} />
                        </button>
                      </div>
                    ))}
                    <button type="button" onClick={() => {
                      setEditRecruiting({
                        ...editRecruiting,
                        positions: [...editRecruiting.positions, { game: s.games[0] || 'rocket_league', role: 'joueur' }],
                      });
                    }}
                      className="flex items-center gap-2 text-xs font-bold" style={{ color: '#33ff66' }}>
                      <Plus size={12} /> Ajouter un poste
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* Palmarès */}
            <div className="panel">
              <div className="panel-header">
                <div className="flex items-center gap-2">
                  <Trophy size={13} style={{ color: 'var(--s-gold)' }} />
                  <span className="t-label" style={{ color: 'var(--s-text)' }}>PALMARÈS</span>
                </div>
              </div>
              <div className="panel-body space-y-3">
                {editAchievements.map((a, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <input type="text" className="settings-input flex-1" placeholder="Titre (ex: 1er Springs Cup S2)"
                      value={a.title} onChange={e => {
                        const achs = [...editAchievements];
                        achs[i] = { ...a, title: e.target.value };
                        setEditAchievements(achs);
                      }} />
                    <input type="text" className="settings-input w-28" placeholder="Date"
                      value={a.date || ''} onChange={e => {
                        const achs = [...editAchievements];
                        achs[i] = { ...a, date: e.target.value };
                        setEditAchievements(achs);
                      }} />
                    <button type="button" onClick={() => setEditAchievements(editAchievements.filter((_, j) => j !== i))}
                      style={{ color: '#ff5555' }}>
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
                <button type="button" onClick={() => setEditAchievements([...editAchievements, { title: '', date: '' }])}
                  className="flex items-center gap-2 text-xs font-bold" style={{ color: 'var(--s-gold)' }}>
                  <Plus size={12} /> Ajouter un résultat
                </button>
              </div>
            </div>

            {/* Save */}
            {error && (
              <div className="flex items-center gap-2 px-4 py-3" style={{ background: 'rgba(255,50,50,0.1)', border: '1px solid rgba(255,50,50,0.3)' }}>
                <AlertCircle size={14} style={{ color: '#ff5555' }} />
                <span className="text-sm" style={{ color: '#ff5555' }}>{error}</span>
              </div>
            )}

            <button onClick={handleSave} disabled={saving}
              className="btn-springs btn-primary bevel-sm flex items-center gap-2">
              {saving ? <Loader2 size={14} className="animate-spin" /> : saved ? <CheckCircle size={14} /> : <Save size={14} />}
              <span>{saving ? 'Sauvegarde...' : saved ? 'Sauvegardé !' : 'Sauvegarder'}</span>
            </button>
          </div>

          {/* ─── Colonne droite — membres ─────────────────────────────── */}
          <div className="space-y-6">

            {/* Membres */}
            <div className="panel">
              <div className="panel-header">
                <div className="flex items-center gap-2">
                  <Users size={13} style={{ color: 'var(--s-gold)' }} />
                  <span className="t-label" style={{ color: 'var(--s-text)' }}>MEMBRES</span>
                </div>
                <span className="t-mono text-xs" style={{ color: 'var(--s-text-muted)' }}>{s.members.length}</span>
              </div>
              <div className="divide-y" style={{ borderColor: 'var(--s-border)' }}>
                {s.members.length === 0 ? (
                  <div className="p-5 text-center">
                    <p className="t-body" style={{ color: 'var(--s-text-muted)' }}>Aucun membre.</p>
                  </div>
                ) : (
                  s.members.map(m => {
                    const avatar = m.avatarUrl || m.discordAvatar;
                    return (
                      <Link key={m.id} href={`/profile/${m.userId}`}
                        className="flex items-center gap-3 px-4 py-2.5 transition-colors duration-150 hover:bg-[var(--s-elevated)]">
                        {avatar ? (
                          <div className="w-8 h-8 relative flex-shrink-0 overflow-hidden" style={{ background: 'var(--s-elevated)' }}>
                            <Image src={avatar} alt={m.displayName} fill className="object-cover" unoptimized />
                          </div>
                        ) : (
                          <div className="w-8 h-8 flex-shrink-0 flex items-center justify-center" style={{ background: 'var(--s-elevated)' }}>
                            <User size={12} style={{ color: 'var(--s-text-muted)' }} />
                          </div>
                        )}
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-semibold truncate" style={{ color: 'var(--s-text)' }}>{m.displayName}</p>
                          <p className="t-mono" style={{ fontSize: '10px', color: 'var(--s-text-muted)' }}>{ROLE_LABELS[m.role] ?? m.role}</p>
                        </div>
                      </Link>
                    );
                  })
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
                  <span className="t-body">Statut</span>
                  <span className="tag" style={{ background: `${statusInfo.color}15`, color: statusInfo.color, borderColor: `${statusInfo.color}40`, fontSize: '9px', padding: '2px 8px' }}>
                    {statusInfo.label}
                  </span>
                </div>
                <div className="divider" />
                <div className="flex items-center justify-between">
                  <span className="t-body">Jeux</span>
                  <div className="flex gap-1">
                    {s.games?.map(g => (
                      <span key={g} className={`tag ${g === 'rocket_league' ? 'tag-blue' : 'tag-green'}`}
                        style={{ fontSize: '9px', padding: '2px 6px' }}>
                        {g === 'rocket_league' ? 'RL' : 'TM'}
                      </span>
                    ))}
                  </div>
                </div>
                {s.validatedAt && (
                  <>
                    <div className="divider" />
                    <div className="flex items-center justify-between">
                      <span className="t-body">Validée le</span>
                      <span className="t-mono text-xs">{new Date(s.validatedAt).toLocaleDateString('fr-FR')}</span>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      ) : (
        /* Structure pas encore active — pas d'édition */
        <div className="panel p-8 text-center">
          <StatusIcon size={32} className="mx-auto mb-4" style={{ color: statusInfo.color }} />
          <h2 className="font-display text-2xl mb-2">{s.name}</h2>
          <p className="t-body">{statusInfo.desc}</p>
          {s.reviewComment && (
            <div className="mt-4 px-4 py-3 mx-auto max-w-md" style={{ background: 'var(--s-elevated)', border: '1px solid var(--s-border)' }}>
              <p className="t-label mb-1">Message admin</p>
              <p className="t-body">{s.reviewComment}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
