'use client';

import AdminContentSkeleton from '@/components/admin/AdminContentSkeleton';

import { useState, useEffect } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';
import { api, ApiError } from '@/lib/api-client';
import { countries } from '@/lib/countries';
import { useToast } from '@/components/ui/Toast';
import { useConfirm } from '@/components/ui/ConfirmModal';
import ImpersonateButton from '@/components/admin/ImpersonateButton';
import {
  Loader2, ChevronDown, ChevronUp, User, Search, Edit3, LogOut, Crown,
  Ban, RotateCcw, UserMinus, AlertTriangle, X, Save, Trash2, CheckCircle,
  RefreshCw, Zap, Trophy, ShieldCheck,
} from 'lucide-react';
import CountryFlag from '@/components/ui/CountryFlag';
import GameTag from '@/components/games/GameTag';
import { ALL_GAME_DEFS } from '@/lib/games-registry';

type UserMembership = {
  structureId: string;
  structureName: string;
  game: string;
  role: string;
};

type UserEntry = {
  uid: string;
  displayName: string;
  discordUsername: string;
  discordAvatar: string;
  avatarUrl: string;
  country: string;
  bio: string;
  games: string[];
  isAvailableForRecruitment: boolean;
  recruitmentRole: string;
  recruitmentMessage: string;
  isBanned: boolean;
  banReason: string;
  isAdmin: boolean;
  // RL, anti-mensonge & contexte recrutement
  rlPlatform?: string;
  rlPlatformId?: string;
  rlRank?: string;
  rlEpicId?: string;
  rlEpicName?: string;
  rlSteamId?: string;
  rlSteamName?: string;
  // Legacy
  epicAccountId: string;
  epicDisplayName: string;
  rlTrackerUrl: string;
  // TM
  pseudoTM: string;
  loginTM: string;
  tmIoUrl: string;
  memberships: UserMembership[];
  // Rôles dérivés (source de vérité pour les filtres) : fondateur, co_fondateur,
  // responsable (managerIds), coach (coachIds), joueur. Agrégé côté API depuis
  // structures + structure_members.
  derivedRoles?: string[];
  createdAt?: string;
};

export default function AdminUsersPage() {
  const { firebaseUser, isAdmin } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();

  const [users, setUsers] = useState<UserEntry[]>([]);
  const [usersLoading, setUsersLoading] = useState(true);
  const [userSearch, setUserSearch] = useState('');
  const [userFilter, setUserFilter] = useState<string>('all');
  const [expandedUser, setExpandedUser] = useState<string | null>(null);
  const [userActionLoading, setUserActionLoading] = useState<string | null>(null);
  const [banReasonMap, setBanReasonMap] = useState<Record<string, string>>({});
  const [editingUser, setEditingUser] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<{
    displayName: string; bio: string; country: string; games: string[];
    epicAccountId: string; rlTrackerUrl: string; pseudoTM: string; loginTM: string; tmIoUrl: string;
    isAvailableForRecruitment: boolean; recruitmentRole: string; recruitmentMessage: string;
  }>({
    displayName: '', bio: '', country: '', games: [],
    epicAccountId: '', rlTrackerUrl: '', pseudoTM: '', loginTM: '', tmIoUrl: '',
    isAvailableForRecruitment: false, recruitmentRole: '', recruitmentMessage: '',
  });
  const [confirmAction, setConfirmAction] = useState<{ userId: string; action: string; label: string } | null>(null);
  const [massLoading, setMassLoading] = useState<null | 'force_disconnect' | 'sync_discord'>(null);

  // ─── Actions de masse, toutes les sessions / sync de tout le serveur ───
  // Cf. docs/rl-rank-verification-plan.md (migration des refresh_token).
  async function handleMassForceDisconnect() {
    const ok = await confirm({
      title: 'Forcer la déconnexion de TOUS les joueurs',
      message: 'Toutes les sessions Firebase actives vont être révoquées (sauf la tienne). Chaque joueur devra recliquer « Connecter avec Discord » à sa prochaine visite, aucune donnée perdue, juste un re-login. Cette action est journalisée.\n\nUtile pour la migration du refresh_token Discord (sync auto du pseudo Epic).',
      variant: 'danger',
      confirmLabel: 'Continuer',
    });
    if (!ok) return;
    const typed = typeof window !== 'undefined'
      ? window.prompt('Pour confirmer, tape FORCER en majuscules :')
      : null;
    if (typed !== 'FORCER') {
      toast.info('Annulé (mot de confirmation incorrect).');
      return;
    }
    setMassLoading('force_disconnect');
    try {
      const data = await api<{ message?: string; revoked?: number; failed?: number }>(
        '/api/admin/users/mass',
        { method: 'POST', body: { action: 'force_disconnect_all', confirm: 'FORCER' } },
      );
      toast.success(data.message ?? 'Sessions révoquées.');
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Erreur serveur.');
    } finally {
      setMassLoading(null);
    }
  }

  async function handleMassSyncDiscord() {
    const ok = await confirm({
      title: 'Sync Discord pour tous',
      message: 'Met à jour le pseudo serveur ([TAG] Pseudo) et les rôles sur le serveur Discord Aedral pour tous les joueurs. Action non destructive. Peut prendre une minute.',
      confirmLabel: 'Lancer la sync',
    });
    if (!ok) return;
    setMassLoading('sync_discord');
    try {
      const data = await api<{ message?: string; synced?: number; partial?: boolean }>(
        '/api/admin/users/mass',
        { method: 'POST', body: { action: 'sync_discord_all' } },
      );
      const msg = data.message ?? 'Sync terminée.';
      if (data.partial) toast.info(msg); else toast.success(msg);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Erreur serveur.');
    } finally {
      setMassLoading(null);
    }
  }

  async function loadUsers() {
    if (!firebaseUser) return;
    setUsersLoading(true);
    try {
      const data = await api<{ users?: UserEntry[] }>('/api/admin/users');
      setUsers(data.users ?? []);
    } catch (err) {
      console.error('[Admin/Users] load error:', err);
    }
    setUsersLoading(false);
  }

  useEffect(() => {
    if (firebaseUser && isAdmin) loadUsers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firebaseUser, isAdmin]);

  async function handleUserAction(userId: string, action: string, extra?: Record<string, unknown>) {
    setUserActionLoading(`${userId}_${action}`);
    try {
      const data = await api<{ message?: string }>('/api/admin/users', {
        method: 'POST',
        body: { userId, action, ...extra },
      });
      await loadUsers();
      setConfirmAction(null);
      setEditingUser(null);
      toast.success(data.message || 'Action effectuée');
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Erreur réseau');
    }
    setUserActionLoading(null);
  }

  if (usersLoading) {
    return (
      <AdminContentSkeleton />
    );
  }

  const bannedCount = users.filter(u => u.isBanned).length;
  let filteredUsers = users;
  if (userSearch) {
    const q = userSearch.toLowerCase();
    filteredUsers = filteredUsers.filter(u =>
      u.displayName.toLowerCase().includes(q) ||
      u.discordUsername.toLowerCase().includes(q) ||
      u.uid.toLowerCase().includes(q)
    );
  }
  if (userFilter === 'admin') filteredUsers = filteredUsers.filter(u => u.isAdmin);
  if (userFilter === 'banned') filteredUsers = filteredUsers.filter(u => u.isBanned);
  if (userFilter === 'recruiting') filteredUsers = filteredUsers.filter(u => u.isAvailableForRecruitment);
  // Filtre par rôle : utilise derivedRoles (source de vérité, agrège memberships
  // + managerIds/coachIds des structures + sub_teams staff/captainId).
  if (userFilter === 'fondateur') filteredUsers = filteredUsers.filter(u =>
    (u.derivedRoles ?? []).some(r => r === 'fondateur' || r === 'co_fondateur'));
  if (userFilter === 'manager') filteredUsers = filteredUsers.filter(u =>
    (u.derivedRoles ?? []).includes('responsable'));
  if (userFilter === 'coach') filteredUsers = filteredUsers.filter(u =>
    (u.derivedRoles ?? []).includes('coach'));
  if (userFilter === 'manager_equipe') filteredUsers = filteredUsers.filter(u =>
    (u.derivedRoles ?? []).includes('manager_equipe'));
  if (userFilter === 'coach_equipe') filteredUsers = filteredUsers.filter(u =>
    (u.derivedRoles ?? []).includes('coach_equipe'));
  if (userFilter === 'capitaine') filteredUsers = filteredUsers.filter(u =>
    (u.derivedRoles ?? []).includes('capitaine'));
  if (userFilter === 'joueur') filteredUsers = filteredUsers.filter(u =>
    (u.derivedRoles ?? []).includes('joueur'));

  return (
    <>
      <div className="flex items-center gap-3">
        <h2 className="font-display text-xl" style={{ letterSpacing: '0.04em' }}>
          UTILISATEURS ({users.length})
        </h2>
        {bannedCount > 0 && (
          <span
            className="tag"
            style={{
              background: 'rgba(255,50,50,0.1)',
              color: '#ff5555',
              borderColor: 'rgba(255,50,50,0.3)',
            }}
          >
            {bannedCount} banni{bannedCount > 1 ? 's' : ''}
          </span>
        )}
      </div>

      {/* Actions de masse, boutons admin globaux */}
      <div className="panel p-3 flex flex-wrap items-center gap-3"
        style={{ borderColor: 'rgba(255,184,0,0.18)', background: 'rgba(255,184,0,0.03)' }}>
        <Zap size={14} style={{ color: 'var(--s-gold)' }} />
        <span className="t-label" style={{ color: 'var(--s-gold)' }}>Actions globales</span>
        <div className="flex-1" />
        <button type="button"
          onClick={handleMassSyncDiscord}
          disabled={!!massLoading}
          className="btn-springs bevel-sm flex items-center gap-2"
          style={{ background: 'rgba(88,101,242,0.1)', color: '#a9b2ff', borderColor: 'rgba(88,101,242,0.3)', fontSize: '12px', padding: '8px 16px' }}>
          {massLoading === 'sync_discord' ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
          <span>Sync Discord (tous)</span>
        </button>
        <button type="button"
          onClick={handleMassForceDisconnect}
          disabled={!!massLoading}
          className="btn-springs bevel-sm flex items-center gap-2"
          style={{ background: 'rgba(255,85,85,0.08)', color: '#ff8a8a', borderColor: 'rgba(255,85,85,0.3)', fontSize: '12px', padding: '8px 16px' }}>
          {massLoading === 'force_disconnect' ? <Loader2 size={12} className="animate-spin" /> : <LogOut size={12} />}
          <span>Forcer déco (tous)</span>
        </button>
      </div>

      {/* Barre de recherche + filtres */}
      <div className="flex gap-4 items-start flex-wrap">
        <div className="relative flex-1 min-w-[260px]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--s-text-muted)' }} />
          <input type="text" className="settings-input has-icon w-full"
            placeholder="Rechercher par pseudo, Discord ou UID..."
            value={userSearch} onChange={e => setUserSearch(e.target.value)} />
        </div>
        <div className="flex gap-1.5 flex-shrink-0 flex-wrap">
          {[
            { value: 'all', label: 'Tous' },
            { value: 'admin', label: 'Admins' },
            { value: 'fondateur', label: 'Fondateurs' },
            { value: 'manager', label: 'Responsables' },
            { value: 'coach', label: 'Coachs struct' },
            { value: 'manager_equipe', label: "Managers d'équipe" },
            { value: 'coach_equipe', label: "Coachs d'équipe" },
            { value: 'capitaine', label: 'Capitaines' },
            { value: 'joueur', label: 'Joueurs' },
            { value: 'banned', label: 'Bannis' },
            { value: 'recruiting', label: 'Dispo' },
          ].map(f => (
            <button key={f.value} onClick={() => setUserFilter(f.value)}
              className="tag transition-all duration-150"
              style={{
                background: userFilter === f.value ? 'rgba(255,184,0,0.15)' : 'transparent',
                color: userFilter === f.value ? 'var(--s-gold)' : 'var(--s-text-dim)',
                borderColor: userFilter === f.value ? 'rgba(255,184,0,0.4)' : 'var(--s-border)',
                cursor: 'pointer',
                padding: '6px 14px',
                fontSize: '12px',
              }}>
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between px-1 mb-2">
          <span className="t-label" style={{ color: 'var(--s-text-dim)' }}>
            {filteredUsers.length} UTILISATEUR{filteredUsers.length > 1 ? 'S' : ''}
          </span>
        </div>

        {filteredUsers.length === 0 && (
          <div className="panel p-8 text-center">
            <p className="t-body" style={{ color: 'var(--s-text-muted)' }}>Aucun utilisateur trouvé.</p>
          </div>
        )}

        {filteredUsers.map(u => {
          const avatar = u.avatarUrl || u.discordAvatar;
          const country = countries.find(c => c.code === u.country);
          const isExpanded = expandedUser === u.uid;
          const isEditing = editingUser === u.uid;

          return (
            <div key={u.uid} className="panel" style={{
              borderColor: u.isBanned ? 'rgba(255,50,50,0.25)' : u.isAdmin ? 'rgba(255,184,0,0.25)' : undefined,
            }}>
              <button
                type="button"
                onClick={() => {
                  setExpandedUser(isExpanded ? null : u.uid);
                  setEditingUser(null);
                }}
                className="w-full flex items-center gap-4 px-5 py-3 transition-colors duration-150 hover:bg-[var(--s-elevated)]"
                style={{ cursor: 'pointer', background: 'transparent', border: 'none', textAlign: 'left' }}>
                {avatar ? (
                  <div className="w-9 h-9 relative flex-shrink-0 overflow-hidden" style={{ background: 'var(--s-elevated)' }}>
                    <Image src={avatar} alt={u.displayName} fill className="object-cover" unoptimized />
                  </div>
                ) : (
                  <div className="w-9 h-9 flex-shrink-0 flex items-center justify-center" style={{ background: 'var(--s-elevated)' }}>
                    <User size={14} style={{ color: 'var(--s-text-muted)' }} />
                  </div>
                )}

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-sm" style={{ color: u.isBanned ? '#ff5555' : 'var(--s-text)' }}>
                      {u.displayName}
                    </span>
                    {u.isAdmin && (
                      <span className="tag tag-gold" style={{ fontSize: '10px', padding: '1px 6px' }}>ADMIN</span>
                    )}
                    {u.isBanned && (
                      <span className="tag" style={{ background: 'rgba(255,50,50,0.1)', color: '#ff5555', borderColor: 'rgba(255,50,50,0.3)', fontSize: '10px', padding: '1px 6px' }}>BANNI</span>
                    )}
                    {u.isAvailableForRecruitment && (
                      <span
                        title={u.recruitmentRole ? `Disponible : ${u.recruitmentRole}` : 'Disponible au recrutement'}
                        className="tag flex items-center gap-1"
                        style={{ background: 'rgba(0,217,54,0.10)', color: '#00D936', borderColor: 'rgba(0,217,54,0.30)', fontSize: '10px', padding: '1px 6px' }}>
                        <Search size={9} />
                        Recrute{u.recruitmentRole ? ` · ${u.recruitmentRole}` : ''}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                    <span className="t-mono text-xs truncate" style={{ color: 'var(--s-text-muted)' }}>
                      @{u.discordUsername}
                    </span>
                    {/* Méta RL, compte vérifié (anti-mensonge) + rang.
                        Si pas de rang ni de vérif : on n'affiche rien (silencieux). */}
                    {(u.rlEpicId || u.rlSteamId) && (
                      <span
                        title={u.rlEpicId
                          ? `Compte Epic vérifié : ${u.rlEpicName || u.rlEpicId}`
                          : `Compte Steam vérifié : ${u.rlSteamName || u.rlSteamId}`}
                        className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5"
                        style={{ background: 'rgba(255,184,0,0.10)', color: 'var(--s-gold)', border: '1px solid rgba(255,184,0,0.30)' }}>
                        <ShieldCheck size={9} />
                        {u.rlEpicId ? 'Epic' : 'Steam'} vérifié
                      </span>
                    )}
                    {u.rlRank && (
                      <span
                        title={
                          (u.rlEpicId || u.rlSteamId)
                            ? `Rang déclaré (compte vérifié)`
                            : `Rang auto-déclaré sans compte vérifié, à prendre avec précaution`
                        }
                        className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5"
                        style={{
                          background: 'rgba(0,129,255,0.08)',
                          color: 'var(--s-blue)',
                          border: '1px solid rgba(0,129,255,0.25)',
                        }}>
                        <Trophy size={9} />
                        {u.rlRank}
                        {!u.rlEpicId && !u.rlSteamId && (
                          <AlertTriangle size={9} style={{ color: 'var(--s-gold)', marginLeft: 2 }} />
                        )}
                      </span>
                    )}
                  </div>
                </div>

                <CountryFlag code={u.country} size={20} title={country?.name} />

                <div className="flex gap-1">
                  {u.games?.map(g => (
                    <GameTag key={g} gameId={g} style={{ padding: '1px 6px' }} />
                  ))}
                </div>

                {u.memberships.length > 0 && (
                  <span className="tag tag-gold" style={{ fontSize: '10px', padding: '1px 6px' }}>
                    {u.memberships.length} struct.
                  </span>
                )}

                {u.createdAt && (
                  <span className="t-mono text-xs" style={{ color: 'var(--s-text-muted)' }}>
                    {new Date(u.createdAt).toLocaleDateString('fr-FR')}
                  </span>
                )}

                {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              </button>

              {isExpanded && (
                <div className="px-5 pb-5 space-y-4">
                  <div className="divider" />

                  <div className="grid grid-cols-3 gap-4">
                    <div className="space-y-2">
                      <div>
                        <span className="t-label block mb-0.5">UID</span>
                        <span className="t-mono text-xs" style={{ color: 'var(--s-text-dim)', wordBreak: 'break-all' }}>{u.uid}</span>
                      </div>
                      <div>
                        <span className="t-label block mb-0.5">Discord</span>
                        <span className="t-mono text-xs" style={{ color: 'var(--s-text-dim)' }}>{u.discordUsername}</span>
                      </div>
                      <div>
                        <span className="t-label block mb-0.5">Pays</span>
                        <span className="text-xs flex items-center gap-1.5" style={{ color: 'var(--s-text-dim)' }}>
                          <CountryFlag code={u.country} size={16} title={country?.name} />
                          {country?.name ?? '—'}
                        </span>
                      </div>
                      <div>
                        <span className="t-label block mb-0.5">Inscrit le</span>
                        <span className="t-mono text-xs" style={{ color: 'var(--s-text-dim)' }}>
                          {u.createdAt ? new Date(u.createdAt).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }) : '—'}
                        </span>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <div>
                        <span className="t-label block mb-0.5">Jeux</span>
                        <div className="flex gap-1">
                          {u.games?.length > 0 ? u.games.map(g => (
                            <GameTag key={g} gameId={g} variant="full" style={{ padding: '1px 6px' }} />
                          )) : <span className="text-xs" style={{ color: 'var(--s-text-muted)' }}>,</span>}
                        </div>
                      </div>
                      <div>
                        <span className="t-label block mb-0.5">Recrutement</span>
                        <span className="text-xs" style={{ color: u.isAvailableForRecruitment ? 'var(--s-gold)' : 'var(--s-text-muted)' }}>
                          {u.isAvailableForRecruitment ? 'Disponible' : 'Non'}
                        </span>
                      </div>
                      {u.bio && (
                        <div>
                          <span className="t-label block mb-0.5">Bio</span>
                          <p className="text-xs" style={{ color: 'var(--s-text-dim)', whiteSpace: 'pre-wrap' }}>{u.bio}</p>
                        </div>
                      )}
                    </div>

                    <div>
                      <span className="t-label block mb-1.5">Structures</span>
                      {u.memberships.length === 0 ? (
                        <span className="text-xs" style={{ color: 'var(--s-text-muted)' }}>Aucune</span>
                      ) : (
                        <div className="space-y-1.5">
                          {u.memberships.map((m, i) => (
                            <div key={i} className="flex items-center justify-between px-3 py-2"
                              style={{ background: 'var(--s-elevated)', border: '1px solid var(--s-border)' }}>
                              <div className="flex-1 min-w-0">
                                <p className="text-xs font-semibold truncate" style={{ color: 'var(--s-text)' }}>{m.structureName}</p>
                                <div className="flex items-center gap-2 mt-0.5">
                                  <span className="text-xs" style={{ color: 'var(--s-text-muted)' }}>{m.role}</span>
                                  <GameTag gameId={m.game} style={{ fontSize: '8px', padding: '0px 4px' }} />
                                </div>
                              </div>
                              <button
                                type="button"
                                onClick={async () => {
                                  const ok = await confirm({
                                    title: 'Retirer de la structure',
                                    message: `Retirer ${u.displayName} de ${m.structureName} ?`,
                                    variant: 'danger',
                                    confirmLabel: 'Retirer',
                                  });
                                  if (ok) handleUserAction(u.uid, 'remove_from_structure', { membershipStructureId: m.structureId });
                                }}
                                disabled={!!userActionLoading}
                                className="flex-shrink-0 p-1.5 transition-colors duration-150 hover:bg-[var(--s-hover)]"
                                style={{ color: '#ff5555', background: 'transparent', border: 'none', cursor: 'pointer' }}
                                title="Retirer de la structure">
                                {userActionLoading === `${u.uid}_remove_from_structure` ? <Loader2 size={12} className="animate-spin" /> : <UserMinus size={12} />}
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Section Rocket League, affichée si l'user a déclaré jouer
                      à RL OU a un compte vérifié (cas legacy : Epic lié avant
                      qu'on coche RL dans games). Permet à l'admin de voir d'un
                      coup l'état de vérification anti-mensonge. */}
                  {(u.games?.includes('rocket_league') || u.rlEpicId || u.rlSteamId || u.epicAccountId) && (
                    <div className="px-3 py-3" style={{ background: 'rgba(0,129,255,0.04)', border: '1px solid rgba(0,129,255,0.15)' }}>
                      <div className="flex items-center gap-2 mb-2">
                        <span className="tag tag-blue" style={{ fontSize: '11px', padding: '1px 6px' }}>RL</span>
                        <span className="t-label" style={{ color: 'var(--s-blue)' }}>Rocket League</span>
                      </div>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                        <div>
                          <span className="t-label block mb-0.5" style={{ color: 'var(--s-text-muted)' }}>Plateforme déclarée</span>
                          <span style={{ color: 'var(--s-text)' }}>
                            {u.rlPlatform ? u.rlPlatform.toUpperCase() : <em style={{ color: 'var(--s-text-muted)' }}>,</em>}
                          </span>
                          {u.rlPlatformId && (
                            <span className="block t-mono mt-0.5" style={{ color: 'var(--s-text-dim)' }}>
                              {u.rlPlatformId}
                            </span>
                          )}
                        </div>
                        <div>
                          <span className="t-label block mb-0.5" style={{ color: 'var(--s-text-muted)' }}>Rang auto-déclaré</span>
                          {u.rlRank ? (
                            <span className="inline-flex items-center gap-1" style={{ color: 'var(--s-text)' }}>
                              <Trophy size={10} style={{ color: 'var(--s-blue)' }} />
                              {u.rlRank}
                              {!u.rlEpicId && !u.rlSteamId && (
                                <span title="Rang déclaré sans compte vérifié, méfiance">
                                  <AlertTriangle size={10} style={{ color: 'var(--s-gold)' }} />
                                </span>
                              )}
                            </span>
                          ) : <em style={{ color: 'var(--s-text-muted)' }}>,</em>}
                        </div>
                        <div>
                          <span className="t-label block mb-0.5" style={{ color: 'var(--s-text-muted)' }}>Epic vérifié</span>
                          {u.rlEpicId ? (
                            <span className="inline-flex items-center gap-1" style={{ color: 'var(--s-gold)' }}>
                              <ShieldCheck size={10} /> {u.rlEpicName || u.rlEpicId.slice(0, 10)}…
                            </span>
                          ) : <em style={{ color: 'var(--s-text-muted)' }}>,</em>}
                        </div>
                        <div>
                          <span className="t-label block mb-0.5" style={{ color: 'var(--s-text-muted)' }}>Steam vérifié</span>
                          {u.rlSteamId ? (
                            <span className="inline-flex items-center gap-1" style={{ color: 'var(--s-gold)' }}>
                              <ShieldCheck size={10} /> {u.rlSteamName || u.rlSteamId}
                            </span>
                          ) : <em style={{ color: 'var(--s-text-muted)' }}>,</em>}
                        </div>
                      </div>
                      {u.rlTrackerUrl && (
                        <div className="mt-2 pt-2" style={{ borderTop: '1px solid rgba(0,129,255,0.15)' }}>
                          <a href={u.rlTrackerUrl} target="_blank" rel="noopener noreferrer"
                            className="text-xs inline-flex items-center gap-1 hover:underline"
                            style={{ color: 'var(--s-blue)' }}>
                            Lien tracker.gg →
                          </a>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Section Trackmania */}
                  {u.games?.includes('trackmania') && (u.pseudoTM || u.loginTM || u.tmIoUrl) && (
                    <div className="px-3 py-3" style={{ background: 'rgba(0,217,54,0.04)', border: '1px solid rgba(0,217,54,0.15)' }}>
                      <div className="flex items-center gap-2 mb-2">
                        <span className="tag tag-green" style={{ fontSize: '11px', padding: '1px 6px' }}>TM</span>
                        <span className="t-label" style={{ color: 'var(--s-green)' }}>Trackmania</span>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                        <div>
                          <span className="t-label block mb-0.5" style={{ color: 'var(--s-text-muted)' }}>Pseudo</span>
                          <span style={{ color: 'var(--s-text)' }}>{u.pseudoTM || <em style={{ color: 'var(--s-text-muted)' }}>,</em>}</span>
                        </div>
                        <div>
                          <span className="t-label block mb-0.5" style={{ color: 'var(--s-text-muted)' }}>Login</span>
                          <span className="t-mono" style={{ color: 'var(--s-text)' }}>{u.loginTM || <em style={{ color: 'var(--s-text-muted)' }}>,</em>}</span>
                        </div>
                        <div>
                          <span className="t-label block mb-0.5" style={{ color: 'var(--s-text-muted)' }}>tm.io</span>
                          {u.tmIoUrl ? (
                            <a href={u.tmIoUrl} target="_blank" rel="noopener noreferrer"
                              className="hover:underline" style={{ color: 'var(--s-green)' }}>
                              Profil →
                            </a>
                          ) : <em style={{ color: 'var(--s-text-muted)' }}>,</em>}
                        </div>
                      </div>
                    </div>
                  )}

                  {u.isBanned && u.banReason && (
                    <div className="px-3 py-2" style={{ background: 'rgba(255,50,50,0.05)', border: '1px solid rgba(255,50,50,0.2)' }}>
                      <span className="t-label block mb-0.5" style={{ color: '#ff5555' }}>Raison du ban</span>
                      <p className="text-xs" style={{ color: 'var(--s-text-dim)' }}>{u.banReason}</p>
                    </div>
                  )}

                  {isEditing && (
                    <>
                      <div className="divider" />
                      <div className="p-4 space-y-4" style={{ background: 'rgba(255,184,0,0.03)', border: '1px solid rgba(255,184,0,0.15)' }}>
                        <div className="flex items-center justify-between mb-1">
                          <span className="t-label" style={{ color: 'var(--s-gold)' }}>MODIFIER LE PROFIL</span>
                          <button onClick={() => setEditingUser(null)} style={{ color: 'var(--s-text-muted)', background: 'transparent', border: 'none', cursor: 'pointer' }}>
                            <X size={14} />
                          </button>
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <label className="t-label block mb-1">Pseudo</label>
                            <input type="text" className="settings-input w-full" value={editForm.displayName}
                              onChange={e => setEditForm(p => ({ ...p, displayName: e.target.value }))} />
                          </div>
                          <div>
                            <label className="t-label block mb-1">Pays</label>
                            <select className="settings-input w-full" value={editForm.country}
                              onChange={e => setEditForm(p => ({ ...p, country: e.target.value }))}>
                              <option value="">,</option>
                              {countries.map(c => (
                                <option key={c.code} value={c.code}>{c.flag} {c.name}</option>
                              ))}
                            </select>
                          </div>
                        </div>

                        <div>
                          <label className="t-label block mb-1">Bio</label>
                          <textarea className="settings-input w-full" rows={2} value={editForm.bio}
                            onChange={e => setEditForm(p => ({ ...p, bio: e.target.value }))} />
                        </div>

                        <div>
                          <label className="t-label block mb-1.5">Jeux pratiqués</label>
                          <div className="flex gap-2 flex-wrap">
                            {ALL_GAME_DEFS.map(g => {
                              const active = editForm.games.includes(g.id);
                              return (
                                <button key={g.id} type="button"
                                  onClick={() => {
                                    setEditForm(p => ({
                                      ...p,
                                      games: active
                                        ? p.games.filter(x => x !== g.id)
                                        : [...p.games, g.id],
                                    }));
                                  }}
                                  className="tag transition-all duration-150"
                                  style={{
                                    padding: '5px 12px',
                                    fontSize: '12px',
                                    cursor: 'pointer',
                                    opacity: active ? 1 : 0.4,
                                    background: active ? `rgba(${g.colorRgb}, 0.1)` : 'transparent',
                                    color: active ? g.colorLight : 'var(--s-text-dim)',
                                    borderColor: active ? `rgba(${g.colorRgb}, 0.35)` : 'var(--s-border)',
                                  }}>
                                  {g.label}
                                </button>
                              );
                            })}
                          </div>
                        </div>

                        {editForm.games.includes('rocket_league') && (
                          <div className="p-3 space-y-3" style={{ background: 'rgba(0,129,255,0.04)', border: '1px solid rgba(0,129,255,0.15)' }}>
                            <span className="t-label" style={{ color: 'var(--s-blue)' }}>COMPTES ROCKET LEAGUE</span>
                            <div className="grid grid-cols-2 gap-3">
                              <div>
                                <label className="t-label block mb-1">Epic Account ID</label>
                                <input type="text" className="settings-input w-full" value={editForm.epicAccountId}
                                  placeholder="ID Epic permanent"
                                  onChange={e => setEditForm(p => ({ ...p, epicAccountId: e.target.value }))} />
                              </div>
                              <div>
                                <label className="t-label block mb-1">RL Tracker URL</label>
                                <input type="text" className="settings-input w-full" value={editForm.rlTrackerUrl}
                                  placeholder="https://rocketleague.tracker.network/..."
                                  onChange={e => setEditForm(p => ({ ...p, rlTrackerUrl: e.target.value }))} />
                              </div>
                            </div>
                          </div>
                        )}

                        {editForm.games.includes('trackmania') && (
                          <div className="p-3 space-y-3" style={{ background: 'rgba(0,217,54,0.04)', border: '1px solid rgba(0,217,54,0.15)' }}>
                            <span className="t-label" style={{ color: 'var(--s-green)' }}>COMPTES TRACKMANIA</span>
                            <div className="grid grid-cols-3 gap-3">
                              <div>
                                <label className="t-label block mb-1">Pseudo TM</label>
                                <input type="text" className="settings-input w-full" value={editForm.pseudoTM}
                                  placeholder="Pseudo en course"
                                  onChange={e => setEditForm(p => ({ ...p, pseudoTM: e.target.value }))} />
                              </div>
                              <div>
                                <label className="t-label block mb-1">Login TM</label>
                                <input type="text" className="settings-input w-full" value={editForm.loginTM}
                                  placeholder="Identifiant Ubisoft"
                                  onChange={e => setEditForm(p => ({ ...p, loginTM: e.target.value }))} />
                              </div>
                              <div>
                                <label className="t-label block mb-1">Trackmania.io URL</label>
                                <input type="text" className="settings-input w-full" value={editForm.tmIoUrl}
                                  placeholder="https://trackmania.io/..."
                                  onChange={e => setEditForm(p => ({ ...p, tmIoUrl: e.target.value }))} />
                              </div>
                            </div>
                          </div>
                        )}

                        {/* Recrutement */}
                        <div className="p-3 space-y-3" style={{ background: 'rgba(255,184,0,0.04)', border: '1px solid rgba(255,184,0,0.15)' }}>
                          <span className="t-label" style={{ color: 'var(--s-gold)' }}>RECRUTEMENT</span>
                          <button
                            type="button"
                            onClick={() => setEditForm(p => ({ ...p, isAvailableForRecruitment: !p.isAvailableForRecruitment }))}
                            className="flex items-center gap-2.5"
                            style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: 0 }}
                          >
                            <span
                              className="relative flex-shrink-0"
                              style={{
                                width: 36, height: 20,
                                background: editForm.isAvailableForRecruitment ? 'var(--s-gold)' : 'var(--s-elevated)',
                                border: `1px solid ${editForm.isAvailableForRecruitment ? 'var(--s-gold)' : 'var(--s-border)'}`,
                              }}
                            >
                              <span style={{
                                position: 'absolute', top: 2,
                                left: editForm.isAvailableForRecruitment ? 18 : 2,
                                width: 14, height: 14,
                                background: editForm.isAvailableForRecruitment ? '#000' : 'var(--s-text-muted)',
                                transition: 'left 0.15s',
                              }} />
                            </span>
                            <span className="text-xs" style={{ color: editForm.isAvailableForRecruitment ? 'var(--s-gold)' : 'var(--s-text-dim)' }}>
                              Disponible pour rejoindre une équipe
                            </span>
                          </button>
                          {editForm.isAvailableForRecruitment && (
                            <>
                              <div>
                                <label className="t-label block mb-1">Rôle recherché</label>
                                <div className="flex gap-2">
                                  {(['joueur', 'coach', 'manager'] as const).map(r => {
                                    const on = editForm.recruitmentRole === r;
                                    return (
                                      <button
                                        key={r}
                                        type="button"
                                        onClick={() => setEditForm(p => ({ ...p, recruitmentRole: on ? '' : r }))}
                                        className="tag transition-all duration-150"
                                        style={{
                                          background: on ? 'rgba(255,184,0,0.15)' : 'transparent',
                                          color: on ? 'var(--s-gold)' : 'var(--s-text-dim)',
                                          borderColor: on ? 'rgba(255,184,0,0.4)' : 'var(--s-border)',
                                          cursor: 'pointer', padding: '5px 12px', fontSize: '12px',
                                        }}
                                      >
                                        {r.charAt(0).toUpperCase() + r.slice(1)}
                                      </button>
                                    );
                                  })}
                                </div>
                              </div>
                              <div>
                                <label className="t-label block mb-1">Message</label>
                                <textarea
                                  className="settings-input w-full"
                                  rows={2}
                                  maxLength={500}
                                  value={editForm.recruitmentMessage}
                                  onChange={e => setEditForm(p => ({ ...p, recruitmentMessage: e.target.value }))}
                                />
                              </div>
                            </>
                          )}
                        </div>

                        <button
                          type="button"
                          onClick={() => handleUserAction(u.uid, 'edit', { editData: editForm })}
                          disabled={!!userActionLoading}
                          className="btn-springs bevel-sm flex items-center gap-2"
                          style={{ background: 'rgba(0,217,54,0.1)', color: '#33ff66', borderColor: 'rgba(0,217,54,0.3)', fontSize: '12px', padding: '8px 16px' }}>
                          {userActionLoading === `${u.uid}_edit` ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
                          <span>Sauvegarder</span>
                        </button>
                      </div>
                    </>
                  )}

                  {!u.isBanned && (
                    <div>
                      <label className="t-label block mb-1">Raison (pour ban)</label>
                      <input type="text" className="settings-input w-full" placeholder="Raison du bannissement..."
                        value={banReasonMap[u.uid] || ''}
                        onChange={e => setBanReasonMap(p => ({ ...p, [u.uid]: e.target.value }))} />
                    </div>
                  )}

                  <div className="divider" />

                  <div className="flex gap-2 flex-wrap">
                    <Link href={`/profile/${u.uid}`}
                      className="btn-springs bevel-sm flex items-center gap-2"
                      style={{ background: 'rgba(255,184,0,0.08)', color: 'var(--s-gold)', borderColor: 'rgba(255,184,0,0.25)', fontSize: '12px', padding: '8px 16px' }}>
                      <User size={12} />
                      <span>Voir profil</span>
                    </Link>

                    <button onClick={() => {
                      if (isEditing) {
                        setEditingUser(null);
                      } else {
                        setEditForm({
                          displayName: u.displayName, bio: u.bio, country: u.country, games: [...u.games],
                          epicAccountId: u.epicDisplayName || u.epicAccountId, rlTrackerUrl: u.rlTrackerUrl,
                          pseudoTM: u.pseudoTM, loginTM: u.loginTM, tmIoUrl: u.tmIoUrl,
                          isAvailableForRecruitment: u.isAvailableForRecruitment,
                          recruitmentRole: u.recruitmentRole,
                          recruitmentMessage: u.recruitmentMessage,
                        });
                        setEditingUser(u.uid);
                      }
                    }}
                      className="btn-springs bevel-sm flex items-center gap-2"
                      style={{ background: 'rgba(0,129,255,0.08)', color: '#4da6ff', borderColor: 'rgba(0,129,255,0.25)', fontSize: '12px', padding: '8px 16px' }}>
                      <Edit3 size={12} />
                      <span>{isEditing ? 'Annuler édition' : 'Modifier'}</span>
                    </button>

                    {u.isBanned ? (
                      <button onClick={() => handleUserAction(u.uid, 'unban')}
                        disabled={!!userActionLoading}
                        className="btn-springs bevel-sm flex items-center gap-2"
                        style={{ background: 'rgba(0,217,54,0.1)', color: '#33ff66', borderColor: 'rgba(0,217,54,0.3)', fontSize: '12px', padding: '8px 16px' }}>
                        {userActionLoading === `${u.uid}_unban` ? <Loader2 size={12} className="animate-spin" /> : <RotateCcw size={12} />}
                        <span>Débannir</span>
                      </button>
                    ) : (
                      <button onClick={() => setConfirmAction({ userId: u.uid, action: 'ban', label: `Bannir ${u.displayName} ?` })}
                        disabled={!!userActionLoading}
                        className="btn-springs bevel-sm flex items-center gap-2"
                        style={{ background: 'rgba(255,136,0,0.08)', color: '#ff8800', borderColor: 'rgba(255,136,0,0.25)', fontSize: '12px', padding: '8px 16px' }}>
                        <Ban size={12} />
                        <span>Bannir</span>
                      </button>
                    )}

                    {u.isAdmin ? (
                      <button onClick={() => setConfirmAction({ userId: u.uid, action: 'remove_admin', label: `Retirer les droits admin de ${u.displayName} ?` })}
                        disabled={!!userActionLoading}
                        className="btn-springs bevel-sm flex items-center gap-2"
                        style={{ background: 'rgba(255,184,0,0.08)', color: 'var(--s-gold)', borderColor: 'rgba(255,184,0,0.25)', fontSize: '12px', padding: '8px 16px' }}>
                        <Crown size={12} />
                        <span>Retirer admin</span>
                      </button>
                    ) : (
                      <button onClick={() => setConfirmAction({ userId: u.uid, action: 'add_admin', label: `Donner les droits admin à ${u.displayName} ?` })}
                        disabled={!!userActionLoading}
                        className="btn-springs bevel-sm flex items-center gap-2"
                        style={{ background: 'rgba(255,184,0,0.05)', color: 'var(--s-gold)', borderColor: 'rgba(255,184,0,0.15)', fontSize: '12px', padding: '8px 16px' }}>
                        <Crown size={12} />
                        <span>Promouvoir admin</span>
                      </button>
                    )}

                    {!u.isBanned && (
                      <ImpersonateButton targetUid={u.uid} targetName={u.displayName} />
                    )}

                    <button onClick={() => handleUserAction(u.uid, 'force_disconnect')}
                      disabled={!!userActionLoading}
                      className="btn-springs bevel-sm flex items-center gap-2"
                      style={{ background: 'rgba(255,255,255,0.03)', color: 'var(--s-text-dim)', borderColor: 'var(--s-border)', fontSize: '12px', padding: '8px 16px' }}>
                      {userActionLoading === `${u.uid}_force_disconnect` ? <Loader2 size={12} className="animate-spin" /> : <LogOut size={12} />}
                      <span>Forcer déco</span>
                    </button>

                    <button onClick={() => handleUserAction(u.uid, 'sync_discord')}
                      disabled={!!userActionLoading}
                      className="btn-springs bevel-sm flex items-center gap-2"
                      style={{ background: 'rgba(88,101,242,0.1)', color: '#a9b2ff', borderColor: 'rgba(88,101,242,0.3)', fontSize: '12px', padding: '8px 16px' }}>
                      {userActionLoading === `${u.uid}_sync_discord` ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
                      <span>Sync Discord</span>
                    </button>

                    <button onClick={() => setConfirmAction({ userId: u.uid, action: 'delete', label: `Supprimer définitivement le compte de ${u.displayName} ? Cette action est IRRÉVERSIBLE.` })}
                      disabled={!!userActionLoading}
                      className="btn-springs bevel-sm flex items-center gap-2"
                      style={{ background: 'rgba(255,50,50,0.05)', color: '#ff5555', borderColor: 'rgba(255,50,50,0.2)', fontSize: '12px', padding: '8px 16px' }}>
                      <Trash2 size={12} />
                      <span>Supprimer</span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {confirmAction && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.7)' }}>
          <div className="bevel p-6 max-w-md w-full mx-4 space-y-4" style={{ background: 'var(--s-surface)', border: '1px solid var(--s-border)' }}>
            <div className="flex items-center gap-3">
              <div className="p-2" style={{ background: 'rgba(255,50,50,0.1)', border: '1px solid rgba(255,50,50,0.25)' }}>
                <AlertTriangle size={18} style={{ color: '#ff5555' }} />
              </div>
              <span className="font-display text-base tracking-wider">CONFIRMATION</span>
            </div>

            <p className="text-sm" style={{ color: 'var(--s-text)' }}>{confirmAction.label}</p>

            <div className="flex gap-3 justify-end">
              <button type="button" onClick={() => setConfirmAction(null)}
                className="btn-springs btn-ghost text-xs">
                Annuler
              </button>
              <button
                type="button"
                onClick={() => {
                  const extra: Record<string, unknown> = {};
                  if (confirmAction.action === 'ban') {
                    extra.reason = banReasonMap[confirmAction.userId] || '';
                  }
                  handleUserAction(confirmAction.userId, confirmAction.action, extra);
                }}
                disabled={!!userActionLoading}
                className="btn-springs bevel-sm flex items-center gap-2"
                style={{ background: 'rgba(255,50,50,0.15)', color: '#ff5555', borderColor: 'rgba(255,50,50,0.3)', fontSize: '12px', padding: '8px 16px' }}>
                {userActionLoading ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle size={12} />}
                <span>Confirmer</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
