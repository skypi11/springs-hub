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
  achievements: { placement?: string; title?: string; competition?: string; game?: string; date?: string }[];
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
  const [editAchievements, setEditAchievements] = useState<{ placement: string; competition: string; game: string; date: string }[]>([]);
  // Teams state
  type TeamData = {
    id: string;
    name: string;
    game: string;
    players: { uid: string; displayName: string; avatarUrl: string; discordAvatar: string }[];
    subs: { uid: string; displayName: string; avatarUrl: string; discordAvatar: string }[];
    staff: { uid: string; displayName: string; avatarUrl: string; discordAvatar: string }[];
  };
  const [teams, setTeams] = useState<TeamData[]>([]);
  const [teamsLoading, setTeamsLoading] = useState(false);
  const [newTeamName, setNewTeamName] = useState('');
  const [newTeamGame, setNewTeamGame] = useState('');
  const [showNewTeam, setShowNewTeam] = useState(false);
  const [teamActionLoading, setTeamActionLoading] = useState<string | null>(null);

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

  async function loadTeams(structureId: string) {
    setTeamsLoading(true);
    try {
      const res = await fetch(`/api/structures/teams?structureId=${structureId}`);
      if (res.ok) {
        const data = await res.json();
        setTeams(data.teams ?? []);
      }
    } catch (err) {
      console.error('[MyStructure] load teams error:', err);
    }
    setTeamsLoading(false);
  }

  function selectStructure(s: MyStructure) {
    setActiveStructure(s);
    setEditDesc(s.description || '');
    setEditLogoUrl(s.logoUrl || '');
    setEditDiscordUrl(s.discordUrl || '');
    setEditSocials(s.socials || {});
    setEditRecruiting(s.recruiting || { active: false, positions: [] });
    setEditAchievements((s.achievements || []).map(a => ({
      placement: a.placement || a.title || '',
      competition: a.competition || '',
      game: a.game || s.games?.[0] || 'rocket_league',
      date: a.date || '',
    })));
    setSaved(false);
    setError('');
    setShowNewTeam(false);
    loadTeams(s.id);
  }

  async function handleCreateTeam() {
    if (!activeStructure || !firebaseUser || !newTeamName.trim() || !newTeamGame) return;
    setTeamActionLoading('create');
    try {
      const idToken = await firebaseUser.getIdToken();
      const res = await fetch('/api/structures/teams', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${idToken}` },
        body: JSON.stringify({
          action: 'create',
          structureId: activeStructure.id,
          name: newTeamName,
          game: newTeamGame,
          playerIds: [],
          subIds: [],
          staffIds: [],
        }),
      });
      if (res.ok) {
        setNewTeamName('');
        setShowNewTeam(false);
        await loadTeams(activeStructure.id);
      }
    } catch (err) {
      console.error('[MyStructure] create team error:', err);
    }
    setTeamActionLoading(null);
  }

  async function handleDeleteTeam(teamId: string, teamName: string) {
    if (!activeStructure || !firebaseUser) return;
    if (!confirm(`Supprimer l'équipe "${teamName}" ? Cette action est irréversible.`)) return;
    setTeamActionLoading(teamId);
    try {
      const idToken = await firebaseUser.getIdToken();
      await fetch('/api/structures/teams', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${idToken}` },
        body: JSON.stringify({ action: 'delete', structureId: activeStructure.id, teamId }),
      });
      await loadTeams(activeStructure.id);
    } catch (err) {
      console.error('[MyStructure] delete team error:', err);
    }
    setTeamActionLoading(null);
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
          achievements: editAchievements.filter(a => a.placement.trim() && a.competition.trim()),
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
              <div className="panel-body space-y-4">
                {editAchievements.map((a, i) => (
                  <div key={i} className="p-3 space-y-2" style={{ background: 'var(--s-elevated)', border: '1px solid var(--s-border)' }}>
                    <div className="flex items-center gap-2">
                      <div className="flex-1">
                        <label className="t-label block mb-1" style={{ fontSize: '9px' }}>Placement *</label>
                        <select className="settings-input w-full" value={a.placement}
                          onChange={e => {
                            const achs = [...editAchievements];
                            achs[i] = { ...a, placement: e.target.value };
                            setEditAchievements(achs);
                          }}>
                          <option value="">Choisir...</option>
                          <option value="1er">1er</option>
                          <option value="2e">2e</option>
                          <option value="3e">3e</option>
                          <option value="Top 4">Top 4</option>
                          <option value="Top 8">Top 8</option>
                          <option value="Top 16">Top 16</option>
                          <option value="Demi-finale">Demi-finale</option>
                          <option value="Quart de finale">Quart de finale</option>
                          <option value="Participant">Participant</option>
                        </select>
                      </div>
                      <button type="button" onClick={() => setEditAchievements(editAchievements.filter((_, j) => j !== i))}
                        className="mt-4" style={{ color: '#ff5555' }}>
                        <Trash2 size={14} />
                      </button>
                    </div>
                    <div>
                      <label className="t-label block mb-1" style={{ fontSize: '9px' }}>Compétition *</label>
                      <input type="text" className="settings-input w-full" placeholder="Ex: Springs Cup Saison 2"
                        value={a.competition} onChange={e => {
                          const achs = [...editAchievements];
                          achs[i] = { ...a, competition: e.target.value };
                          setEditAchievements(achs);
                        }} />
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="t-label block mb-1" style={{ fontSize: '9px' }}>Jeu</label>
                        <select className="settings-input w-full" value={a.game}
                          onChange={e => {
                            const achs = [...editAchievements];
                            achs[i] = { ...a, game: e.target.value };
                            setEditAchievements(achs);
                          }}>
                          <option value="rocket_league">Rocket League</option>
                          <option value="trackmania">Trackmania</option>
                        </select>
                      </div>
                      <div>
                        <label className="t-label block mb-1" style={{ fontSize: '9px' }}>Date (mois/année)</label>
                        <input type="month" className="settings-input w-full"
                          value={a.date} onChange={e => {
                            const achs = [...editAchievements];
                            achs[i] = { ...a, date: e.target.value };
                            setEditAchievements(achs);
                          }} />
                      </div>
                    </div>
                  </div>
                ))}
                <button type="button" onClick={() => setEditAchievements([...editAchievements, { placement: '', competition: '', game: s.games[0] || 'rocket_league', date: '' }])}
                  className="flex items-center gap-2 text-xs font-bold" style={{ color: 'var(--s-gold)' }}>
                  <Plus size={12} /> Ajouter un résultat
                </button>
              </div>
            </div>

            {/* Équipes */}
            <div className="panel">
              <div className="panel-header">
                <div className="flex items-center gap-2">
                  <Gamepad2 size={13} style={{ color: 'var(--s-blue)' }} />
                  <span className="t-label" style={{ color: 'var(--s-text)' }}>ÉQUIPES</span>
                </div>
                <button type="button" onClick={() => setShowNewTeam(!showNewTeam)}
                  className="flex items-center gap-1 text-xs font-bold" style={{ color: 'var(--s-blue)' }}>
                  {showNewTeam ? <ChevronUp size={12} /> : <Plus size={12} />}
                  {showNewTeam ? 'Annuler' : 'Nouvelle équipe'}
                </button>
              </div>
              <div className="panel-body space-y-4">

                {/* Formulaire nouvelle équipe */}
                {showNewTeam && (
                  <div className="p-3 space-y-3" style={{ background: 'var(--s-elevated)', border: '1px solid var(--s-border)' }}>
                    <div>
                      <label className="t-label block mb-1">Nom de l&apos;équipe *</label>
                      <input type="text" className="settings-input w-full" placeholder="Ex: Équipe principale"
                        value={newTeamName} onChange={e => setNewTeamName(e.target.value)} />
                    </div>
                    <div>
                      <label className="t-label block mb-1">Jeu *</label>
                      <select className="settings-input w-full" value={newTeamGame}
                        onChange={e => setNewTeamGame(e.target.value)}>
                        <option value="">Choisir un jeu...</option>
                        {s.games?.includes('rocket_league') && <option value="rocket_league">Rocket League</option>}
                        {s.games?.includes('trackmania') && <option value="trackmania">Trackmania</option>}
                      </select>
                    </div>
                    <button type="button" onClick={handleCreateTeam}
                      disabled={!newTeamName.trim() || !newTeamGame || teamActionLoading === 'create'}
                      className="btn-springs btn-primary bevel-sm flex items-center gap-2 text-xs"
                      style={{ opacity: (!newTeamName.trim() || !newTeamGame) ? 0.5 : 1 }}>
                      {teamActionLoading === 'create' ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
                      <span>Créer l&apos;équipe</span>
                    </button>
                  </div>
                )}

                {/* Liste des équipes */}
                {teamsLoading ? (
                  <div className="flex items-center justify-center py-6">
                    <Loader2 size={16} className="animate-spin" style={{ color: 'var(--s-text-dim)' }} />
                  </div>
                ) : teams.length === 0 ? (
                  <div className="text-center py-6">
                    <Gamepad2 size={24} className="mx-auto mb-2" style={{ color: 'var(--s-text-muted)' }} />
                    <p className="t-body" style={{ color: 'var(--s-text-muted)' }}>Aucune équipe créée.</p>
                    <p className="text-xs mt-1" style={{ color: 'var(--s-text-muted)' }}>Crée une équipe pour y ajouter des joueurs.</p>
                  </div>
                ) : (
                  teams.map(team => (
                    <div key={team.id} className="p-4 space-y-3" style={{ background: 'var(--s-elevated)', border: '1px solid var(--s-border)' }}>
                      {/* En-tête équipe */}
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className={`tag ${team.game === 'rocket_league' ? 'tag-blue' : 'tag-green'}`} style={{ fontSize: '9px', padding: '2px 6px' }}>
                            {team.game === 'rocket_league' ? 'RL' : 'TM'}
                          </span>
                          <span className="text-sm font-semibold" style={{ color: 'var(--s-text)' }}>{team.name}</span>
                        </div>
                        <button type="button" onClick={() => handleDeleteTeam(team.id, team.name)}
                          disabled={teamActionLoading === team.id}
                          style={{ color: '#ff5555', opacity: teamActionLoading === team.id ? 0.5 : 1 }}>
                          {teamActionLoading === team.id ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                        </button>
                      </div>

                      {/* Titulaires */}
                      <div>
                        <p className="t-label mb-1" style={{ fontSize: '9px' }}>
                          Titulaires {team.game === 'rocket_league' && <span style={{ color: 'var(--s-text-muted)' }}>(max 3)</span>}
                        </p>
                        {team.players.length === 0 ? (
                          <p className="text-xs" style={{ color: 'var(--s-text-muted)' }}>Aucun titulaire</p>
                        ) : (
                          <div className="flex flex-wrap gap-2">
                            {team.players.map(p => (
                              <div key={p.uid} className="flex items-center gap-1.5 px-2 py-1" style={{ background: 'var(--s-surface)', border: '1px solid var(--s-border)' }}>
                                {(p.avatarUrl || p.discordAvatar) ? (
                                  <Image src={p.avatarUrl || p.discordAvatar} alt={p.displayName} width={16} height={16} className="flex-shrink-0" unoptimized />
                                ) : (
                                  <User size={10} style={{ color: 'var(--s-text-muted)' }} />
                                )}
                                <span className="text-xs" style={{ color: 'var(--s-text)' }}>{p.displayName}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* Remplaçants */}
                      <div>
                        <p className="t-label mb-1" style={{ fontSize: '9px' }}>
                          Remplaçants {team.game === 'rocket_league' && <span style={{ color: 'var(--s-text-muted)' }}>(max 2)</span>}
                        </p>
                        {team.subs.length === 0 ? (
                          <p className="text-xs" style={{ color: 'var(--s-text-muted)' }}>Aucun remplaçant</p>
                        ) : (
                          <div className="flex flex-wrap gap-2">
                            {team.subs.map(p => (
                              <div key={p.uid} className="flex items-center gap-1.5 px-2 py-1" style={{ background: 'var(--s-surface)', border: '1px solid var(--s-border)' }}>
                                {(p.avatarUrl || p.discordAvatar) ? (
                                  <Image src={p.avatarUrl || p.discordAvatar} alt={p.displayName} width={16} height={16} className="flex-shrink-0" unoptimized />
                                ) : (
                                  <User size={10} style={{ color: 'var(--s-text-muted)' }} />
                                )}
                                <span className="text-xs" style={{ color: 'var(--s-text)' }}>{p.displayName}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* Staff */}
                      <div>
                        <p className="t-label mb-1" style={{ fontSize: '9px' }}>Staff</p>
                        {team.staff.length === 0 ? (
                          <p className="text-xs" style={{ color: 'var(--s-text-muted)' }}>Aucun staff assigné</p>
                        ) : (
                          <div className="flex flex-wrap gap-2">
                            {team.staff.map(p => (
                              <div key={p.uid} className="flex items-center gap-1.5 px-2 py-1" style={{ background: 'var(--s-surface)', border: '1px solid var(--s-border)' }}>
                                {(p.avatarUrl || p.discordAvatar) ? (
                                  <Image src={p.avatarUrl || p.discordAvatar} alt={p.displayName} width={16} height={16} className="flex-shrink-0" unoptimized />
                                ) : (
                                  <User size={10} style={{ color: 'var(--s-text-muted)' }} />
                                )}
                                <span className="text-xs" style={{ color: 'var(--s-text)' }}>{p.displayName}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* Note : gestion membres d'équipe via les membres de la structure */}
                      <p className="text-xs italic" style={{ color: 'var(--s-text-muted)' }}>
                        Pour ajouter/retirer des joueurs, utilise la gestion des membres.
                      </p>
                    </div>
                  ))
                )}
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
