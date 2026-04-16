'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';
import { countries } from '@/lib/countries';
import { useToast } from '@/components/ui/Toast';
import { useConfirm } from '@/components/ui/ConfirmModal';
import {
  Shield, Building2, CheckCircle, XCircle, Trash2,
  Loader2, ChevronDown, ChevronUp, ExternalLink, Users, Gamepad2,
  Ban, RotateCcw, User, Search, Edit3, LogOut, Crown,
  UserMinus, AlertTriangle, X, Save
} from 'lucide-react';

// ─── Types ──────────────────────────────────────────────────────────────────

type StructureRequest = {
  id: string;
  name: string;
  tag: string;
  logoUrl?: string;
  description?: string;
  games: string[];
  legalStatus?: string;
  teamCount?: number;
  staffCount?: number;
  discordUrl?: string;
  message?: string;
  founderId: string;
  founderName: string;
  status: string;
  reviewComment?: string;
  requestedAt?: string;
  validatedAt?: string;
  createdAt?: string;
};

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
  isBanned: boolean;
  banReason: string;
  isAdmin: boolean;
  epicAccountId: string;
  epicDisplayName: string;
  rlTrackerUrl: string;
  pseudoTM: string;
  loginTM: string;
  tmIoUrl: string;
  memberships: UserMembership[];
  createdAt?: string;
};

// ─── Constants ──────────────────────────────────────────────────────────────

const LEGAL_LABELS: Record<string, string> = {
  none: 'Aucune',
  asso_1901: 'Association loi 1901',
  auto_entreprise: 'Auto-entreprise',
  sas_sarl: 'SAS / SARL',
  other: 'Autre',
};

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  pending_validation: { label: 'En attente', color: '#FFB800', bg: 'rgba(255,184,0,0.1)' },
  active: { label: 'Active', color: '#33ff66', bg: 'rgba(0,217,54,0.1)' },
  suspended: { label: 'Suspendue', color: '#ff5555', bg: 'rgba(255,50,50,0.1)' },
  rejected: { label: 'Refusée', color: '#ff5555', bg: 'rgba(255,50,50,0.1)' },
  deletion_scheduled: { label: 'Suppression demandée', color: '#ff8800', bg: 'rgba(255,136,0,0.1)' },
};

// ─── Page ───────────────────────────────────────────────────────────────────

export default function AdminPage() {
  const { isAdmin, firebaseUser, loading: authLoading } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const router = useRouter();
  const [tab, setTab] = useState<'structures' | 'users'>('structures');

  // Structures state
  const [structures, setStructures] = useState<StructureRequest[]>([]);
  const [structuresLoading, setStructuresLoading] = useState(true);
  const [filter, setFilter] = useState<string>('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [commentMap, setCommentMap] = useState<Record<string, string>>({});

  // Users state
  const [users, setUsers] = useState<UserEntry[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [usersLoaded, setUsersLoaded] = useState(false);
  const [userSearch, setUserSearch] = useState('');
  const [userFilter, setUserFilter] = useState<string>('all');
  const [expandedUser, setExpandedUser] = useState<string | null>(null);
  const [userActionLoading, setUserActionLoading] = useState<string | null>(null);
  const [banReasonMap, setBanReasonMap] = useState<Record<string, string>>({});
  const [editingUser, setEditingUser] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<{
    displayName: string; bio: string; country: string; games: string[];
    epicAccountId: string; rlTrackerUrl: string; pseudoTM: string; loginTM: string; tmIoUrl: string;
  }>({ displayName: '', bio: '', country: '', games: [], epicAccountId: '', rlTrackerUrl: '', pseudoTM: '', loginTM: '', tmIoUrl: '' });
  const [confirmAction, setConfirmAction] = useState<{ userId: string; action: string; label: string } | null>(null);

  // ─── Load structures ─────────────────────────────────────────────────────

  async function loadStructures() {
    if (!firebaseUser) return;
    try {
      const idToken = await firebaseUser.getIdToken();
      const url = filter
        ? `/api/admin/structures?status=${filter}`
        : '/api/admin/structures';
      const res = await fetch(url, {
        headers: { 'Authorization': `Bearer ${idToken}` },
      });
      if (res.ok) {
        const data = await res.json();
        setStructures(data.structures ?? []);
      }
    } catch (err) {
      console.error('[Admin] load structures error:', err);
    }
    setStructuresLoading(false);
  }

  async function loadUsers() {
    if (!firebaseUser) return;
    setUsersLoading(true);
    try {
      const idToken = await firebaseUser.getIdToken();
      const res = await fetch('/api/admin/users', {
        headers: { 'Authorization': `Bearer ${idToken}` },
      });
      if (res.ok) {
        const data = await res.json();
        setUsers(data.users ?? []);
      }
    } catch (err) {
      console.error('[Admin] load users error:', err);
    }
    setUsersLoading(false);
    setUsersLoaded(true);
  }

  useEffect(() => {
    if (!authLoading && !isAdmin) {
      router.push('/');
      return;
    }
    if (firebaseUser && isAdmin) {
      loadStructures();
    }
  }, [authLoading, isAdmin, firebaseUser, filter]);

  useEffect(() => {
    if (tab === 'users' && firebaseUser && isAdmin && !usersLoaded) {
      loadUsers();
    }
  }, [tab, firebaseUser, isAdmin]);

  // ─── Structure actions ────────────────────────────────────────────────────

  async function handleAction(structureId: string, action: string) {
    setActionLoading(`${structureId}_${action}`);
    try {
      const idToken = await firebaseUser!.getIdToken();
      const res = await fetch('/api/admin/structures', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${idToken}`,
        },
        body: JSON.stringify({
          structureId,
          action,
          comment: commentMap[structureId] || '',
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        await loadStructures();
        setExpandedId(null);
        toast.success('Action effectuée');
      } else {
        toast.error(data.error || 'Erreur');
      }
    } catch (err) {
      console.error('[Admin] action error:', err);
      toast.error('Erreur réseau');
    }
    setActionLoading(null);
  }

  // ─── User actions ─────────────────────────────────────────────────────────

  async function handleUserAction(userId: string, action: string, extra?: Record<string, unknown>) {
    setUserActionLoading(`${userId}_${action}`);
    try {
      const idToken = await firebaseUser!.getIdToken();
      const res = await fetch('/api/admin/users', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${idToken}`,
        },
        body: JSON.stringify({ userId, action, ...extra }),
      });
      const data = await res.json();
      if (res.ok) {
        // Recharger les users pour refléter les changements
        await loadUsers();
        setConfirmAction(null);
        setEditingUser(null);
        toast.success(data.message || 'Action effectuée');
      } else {
        toast.error(data.error || 'Erreur');
      }
    } catch {
      toast.error('Erreur réseau');
    }
    setUserActionLoading(null);
  }

  // ─── Render ───────────────────────────────────────────────────────────────

  if (authLoading || structuresLoading) {
    return (
      <div className="min-h-screen px-8 py-8 flex items-center justify-center">
        <Loader2 size={24} className="animate-spin" style={{ color: 'var(--s-text-dim)' }} />
      </div>
    );
  }

  const pendingCount = structures.filter(s => s.status === 'pending_validation').length;
  const bannedCount = users.filter(u => u.isBanned).length;

  // User filtering
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
  if (userFilter === 'fondateur') filteredUsers = filteredUsers.filter(u => u.memberships.some(m => m.role === 'fondateur' || m.role === 'co_fondateur'));
  if (userFilter === 'manager') filteredUsers = filteredUsers.filter(u => u.memberships.some(m => m.role === 'manager'));
  if (userFilter === 'coach') filteredUsers = filteredUsers.filter(u => u.memberships.some(m => m.role === 'coach'));
  if (userFilter === 'joueur') filteredUsers = filteredUsers.filter(u => u.memberships.some(m => m.role === 'joueur'));

  return (
    <div className="min-h-screen px-8 py-8 space-y-8">

      {/* Header */}
      <header className="bevel animate-fade-in relative overflow-hidden" style={{ background: 'var(--s-surface)', border: '1px solid var(--s-border)' }}>
        <div className="h-[3px]" style={{ background: 'linear-gradient(90deg, var(--s-violet), var(--s-violet-light), transparent 80%)' }} />
        <div className="relative z-[1] p-8">
          <div className="flex items-center gap-3 mb-2">
            <div className="p-2" style={{ background: 'rgba(123,47,190,0.1)', border: '1px solid rgba(123,47,190,0.25)' }}>
              <Shield size={18} style={{ color: 'var(--s-violet)' }} />
            </div>
            <h1 className="font-display text-3xl" style={{ letterSpacing: '0.03em' }}>PANEL ADMIN</h1>
            {pendingCount > 0 && <span className="tag tag-gold">{pendingCount} en attente</span>}
            {bannedCount > 0 && <span className="tag" style={{ background: 'rgba(255,50,50,0.1)', color: '#ff5555', borderColor: 'rgba(255,50,50,0.3)' }}>{bannedCount} banni{bannedCount > 1 ? 's' : ''}</span>}
          </div>
        </div>
      </header>

      {/* Onglets */}
      <div className="flex gap-1 animate-fade-in-d1" style={{ borderBottom: '1px solid var(--s-border)' }}>
        <button onClick={() => setTab('structures')}
          className="px-5 py-3 font-display text-sm transition-all duration-150"
          style={{
            color: tab === 'structures' ? 'var(--s-text)' : 'var(--s-text-muted)',
            borderBottom: tab === 'structures' ? '2px solid var(--s-violet)' : '2px solid transparent',
            background: tab === 'structures' ? 'rgba(123,47,190,0.05)' : 'transparent',
          }}>
          <Building2 size={14} className="inline mr-2" style={{ verticalAlign: '-2px' }} />
          STRUCTURES ({structures.length})
        </button>
        <button onClick={() => setTab('users')}
          className="px-5 py-3 font-display text-sm transition-all duration-150"
          style={{
            color: tab === 'users' ? 'var(--s-text)' : 'var(--s-text-muted)',
            borderBottom: tab === 'users' ? '2px solid var(--s-violet)' : '2px solid transparent',
            background: tab === 'users' ? 'rgba(123,47,190,0.05)' : 'transparent',
          }}>
          <Users size={14} className="inline mr-2" style={{ verticalAlign: '-2px' }} />
          UTILISATEURS {usersLoaded ? `(${users.length})` : ''}
        </button>
      </div>

      {/* ═══ TAB STRUCTURES ══════════════════════════════════════════════════ */}
      {tab === 'structures' && (
        <>
          {/* Filtres */}
          <div className="flex gap-2">
            {[
              { value: '', label: 'Toutes' },
              { value: 'pending_validation', label: 'En attente' },
              { value: 'active', label: 'Actives' },
              { value: 'suspended', label: 'Suspendues' },
              { value: 'rejected', label: 'Refusées' },
            ].map(f => (
              <button key={f.value} onClick={() => setFilter(f.value)}
                className="tag transition-all duration-150"
                style={{
                  background: filter === f.value ? 'rgba(123,47,190,0.15)' : 'transparent',
                  color: filter === f.value ? 'var(--s-violet-light)' : 'var(--s-text-dim)',
                  borderColor: filter === f.value ? 'rgba(123,47,190,0.4)' : 'var(--s-border)',
                  cursor: 'pointer',
                  padding: '6px 14px',
                  fontSize: '11px',
                }}>
                {f.label}
              </button>
            ))}
          </div>

          {/* Liste structures */}
          <div className="space-y-3">
            {structures.length === 0 && (
              <div className="panel p-8 text-center">
                <p className="t-body" style={{ color: 'var(--s-text-muted)' }}>Aucune structure trouvée.</p>
              </div>
            )}

            {structures.map(s => {
              const isExpanded = expandedId === s.id;
              const statusConf = STATUS_CONFIG[s.status] ?? STATUS_CONFIG.pending_validation;

              return (
                <div key={s.id} className="panel">
                  <button
                    onClick={() => setExpandedId(isExpanded ? null : s.id)}
                    className="w-full panel-header"
                    style={{ cursor: 'pointer' }}>
                    <div className="flex items-center gap-3 flex-1">
                      {s.logoUrl ? (
                        <div className="w-10 h-10 relative flex-shrink-0 overflow-hidden" style={{ background: 'var(--s-elevated)' }}>
                          <Image src={s.logoUrl} alt={s.name} fill className="object-contain" unoptimized />
                        </div>
                      ) : (
                        <div className="w-10 h-10 flex-shrink-0 flex items-center justify-center" style={{ background: 'var(--s-elevated)' }}>
                          <Building2 size={16} style={{ color: 'var(--s-text-muted)' }} />
                        </div>
                      )}
                      <div className="text-left">
                        <div className="flex items-center gap-2">
                          <span className="font-display text-base">{s.name}</span>
                          <span className="tag tag-neutral" style={{ fontSize: '9px', padding: '1px 6px' }}>{s.tag}</span>
                        </div>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className="t-mono text-xs" style={{ color: 'var(--s-text-muted)' }}>par {s.founderName || s.founderId}</span>
                          {s.requestedAt && (
                            <span className="t-mono text-xs" style={{ color: 'var(--s-text-muted)' }}>
                              — {new Date(s.requestedAt).toLocaleDateString('fr-FR')}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="tag" style={{ background: statusConf.bg, color: statusConf.color, borderColor: statusConf.color + '40' }}>
                        {statusConf.label}
                      </span>
                      {s.games?.map(g => (
                        <span key={g} className={`tag ${g === 'rocket_league' ? 'tag-blue' : 'tag-green'}`}
                          style={{ fontSize: '9px', padding: '1px 6px' }}>
                          {g === 'rocket_league' ? 'RL' : 'TM'}
                        </span>
                      ))}
                      {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                    </div>
                  </button>

                  {isExpanded && (
                    <div className="panel-body space-y-4">
                      <div className="divider" />
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <p className="t-label mb-1">Description</p>
                          <p className="t-body" style={{ whiteSpace: 'pre-wrap' }}>{s.description || '—'}</p>
                        </div>
                        <div className="space-y-3">
                          <div className="flex justify-between">
                            <span className="t-label">Forme juridique</span>
                            <span className="t-mono text-xs">{LEGAL_LABELS[s.legalStatus ?? 'none'] ?? s.legalStatus}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="t-label">Équipes</span>
                            <span className="t-mono text-xs">{s.teamCount ?? 0}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="t-label">Staff</span>
                            <span className="t-mono text-xs">{s.staffCount ?? 0}</span>
                          </div>
                          {s.discordUrl && (
                            <div className="flex justify-between">
                              <span className="t-label">Discord</span>
                              <a href={s.discordUrl} target="_blank" rel="noopener noreferrer"
                                className="t-mono text-xs flex items-center gap-1" style={{ color: '#7289da' }}>
                                Ouvrir <ExternalLink size={10} />
                              </a>
                            </div>
                          )}
                        </div>
                      </div>

                      {s.logoUrl && (
                        <div>
                          <p className="t-label mb-2">Logo</p>
                          <a href={s.logoUrl} target="_blank" rel="noopener noreferrer"
                            className="inline-block p-3" style={{ background: 'repeating-conic-gradient(#333 0% 25%, #222 0% 50%) 50%/16px 16px' }}>
                            <div className="w-24 h-24 relative">
                              <Image src={s.logoUrl} alt={s.name} fill className="object-contain" unoptimized />
                            </div>
                          </a>
                        </div>
                      )}

                      {s.message && (
                        <div>
                          <p className="t-label mb-1">Message du fondateur</p>
                          <div className="px-3 py-2" style={{ background: 'var(--s-elevated)', border: '1px solid var(--s-border)' }}>
                            <p className="t-body" style={{ whiteSpace: 'pre-wrap', fontStyle: 'italic' }}>{s.message}</p>
                          </div>
                        </div>
                      )}

                      {s.reviewComment && (
                        <div>
                          <p className="t-label mb-1">Commentaire admin</p>
                          <div className="px-3 py-2" style={{ background: 'rgba(123,47,190,0.05)', border: '1px solid rgba(123,47,190,0.2)' }}>
                            <p className="t-body">{s.reviewComment}</p>
                          </div>
                        </div>
                      )}

                      <div className="divider" />

                      <div className="space-y-3">
                        <div>
                          <label className="t-label block mb-2">Commentaire admin</label>
                          <textarea className="settings-input w-full" rows={2}
                            placeholder="Raison de la décision (visible par le fondateur)..."
                            value={commentMap[s.id] || ''}
                            onChange={e => setCommentMap({ ...commentMap, [s.id]: e.target.value })} />
                        </div>

                        <div className="flex gap-2 flex-wrap">
                          {s.status === 'pending_validation' && (
                            <>
                              <button onClick={() => handleAction(s.id, 'approve')}
                                disabled={!!actionLoading}
                                className="btn-springs bevel-sm flex items-center gap-2"
                                style={{ background: 'rgba(0,217,54,0.15)', color: '#33ff66', borderColor: 'rgba(0,217,54,0.3)', fontSize: '12px', padding: '8px 16px' }}>
                                {actionLoading === `${s.id}_approve` ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle size={12} />}
                                <span>Approuver</span>
                              </button>
                              <button onClick={() => handleAction(s.id, 'reject')}
                                disabled={!!actionLoading}
                                className="btn-springs bevel-sm flex items-center gap-2"
                                style={{ background: 'rgba(255,50,50,0.1)', color: '#ff5555', borderColor: 'rgba(255,50,50,0.3)', fontSize: '12px', padding: '8px 16px' }}>
                                {actionLoading === `${s.id}_reject` ? <Loader2 size={12} className="animate-spin" /> : <XCircle size={12} />}
                                <span>Refuser</span>
                              </button>
                            </>
                          )}

                          {s.status === 'active' && (
                            <button onClick={() => handleAction(s.id, 'suspend')}
                              disabled={!!actionLoading}
                              className="btn-springs bevel-sm flex items-center gap-2"
                              style={{ background: 'rgba(255,136,0,0.1)', color: '#ff8800', borderColor: 'rgba(255,136,0,0.3)', fontSize: '12px', padding: '8px 16px' }}>
                              {actionLoading === `${s.id}_suspend` ? <Loader2 size={12} className="animate-spin" /> : <Ban size={12} />}
                              <span>Suspendre</span>
                            </button>
                          )}

                          {s.status === 'suspended' && (
                            <button onClick={() => handleAction(s.id, 'unsuspend')}
                              disabled={!!actionLoading}
                              className="btn-springs bevel-sm flex items-center gap-2"
                              style={{ background: 'rgba(0,217,54,0.1)', color: '#33ff66', borderColor: 'rgba(0,217,54,0.3)', fontSize: '12px', padding: '8px 16px' }}>
                              {actionLoading === `${s.id}_unsuspend` ? <Loader2 size={12} className="animate-spin" /> : <RotateCcw size={12} />}
                              <span>Réactiver</span>
                            </button>
                          )}

                          <button onClick={async () => {
                            const ok = await confirm({
                              title: 'Supprimer la structure',
                              message: `Supprimer définitivement "${s.name}" ? Cette action est irréversible.`,
                              variant: 'danger',
                              confirmLabel: 'Supprimer',
                            });
                            if (ok) handleAction(s.id, 'delete');
                          }}
                            disabled={!!actionLoading}
                            className="btn-springs bevel-sm flex items-center gap-2"
                            style={{ background: 'rgba(255,50,50,0.05)', color: '#ff5555', borderColor: 'rgba(255,50,50,0.2)', fontSize: '12px', padding: '8px 16px' }}>
                            {actionLoading === `${s.id}_delete` ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                            <span>Supprimer</span>
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* ═══ TAB UTILISATEURS ════════════════════════════════════════════════ */}
      {tab === 'users' && (
        <>
          {/* Barre de recherche + filtres */}
          <div className="flex gap-4 items-start">
            <div className="relative flex-1">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--s-text-muted)' }} />
              <input type="text" className="settings-input w-full pl-9"
                placeholder="Rechercher par pseudo, Discord ou UID..."
                value={userSearch} onChange={e => setUserSearch(e.target.value)} />
            </div>
            <div className="flex gap-1.5 flex-shrink-0 flex-wrap">
              {[
                { value: 'all', label: 'Tous' },
                { value: 'admin', label: 'Admins' },
                { value: 'fondateur', label: 'Fondateurs' },
                { value: 'manager', label: 'Managers' },
                { value: 'coach', label: 'Coachs' },
                { value: 'joueur', label: 'Joueurs' },
                { value: 'banned', label: 'Bannis' },
                { value: 'recruiting', label: 'Dispo' },
              ].map(f => (
                <button key={f.value} onClick={() => setUserFilter(f.value)}
                  className="tag transition-all duration-150"
                  style={{
                    background: userFilter === f.value ? 'rgba(123,47,190,0.15)' : 'transparent',
                    color: userFilter === f.value ? 'var(--s-violet-light)' : 'var(--s-text-dim)',
                    borderColor: userFilter === f.value ? 'rgba(123,47,190,0.4)' : 'var(--s-border)',
                    cursor: 'pointer',
                    padding: '6px 14px',
                    fontSize: '11px',
                  }}>
                  {f.label}
                </button>
              ))}
            </div>
          </div>

          {usersLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 size={24} className="animate-spin" style={{ color: 'var(--s-text-dim)' }} />
            </div>
          ) : (
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
                    borderColor: u.isBanned ? 'rgba(255,50,50,0.25)' : u.isAdmin ? 'rgba(123,47,190,0.25)' : undefined,
                  }}>
                    {/* Ligne résumé — cliquable */}
                    <button
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
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-sm" style={{ color: u.isBanned ? '#ff5555' : 'var(--s-text)' }}>
                            {u.displayName}
                          </span>
                          {u.isAdmin && (
                            <span className="tag tag-violet" style={{ fontSize: '8px', padding: '0px 5px' }}>ADMIN</span>
                          )}
                          {u.isBanned && (
                            <span className="tag" style={{ background: 'rgba(255,50,50,0.1)', color: '#ff5555', borderColor: 'rgba(255,50,50,0.3)', fontSize: '8px', padding: '0px 5px' }}>BANNI</span>
                          )}
                        </div>
                        <p className="t-mono text-xs truncate" style={{ color: 'var(--s-text-muted)' }}>
                          {u.discordUsername}
                        </p>
                      </div>

                      {country && (
                        <span className="t-mono text-xs" style={{ color: 'var(--s-text-dim)' }}>
                          {country.flag}
                        </span>
                      )}

                      <div className="flex gap-1">
                        {u.games?.map(g => (
                          <span key={g} className={`tag ${g === 'rocket_league' ? 'tag-blue' : 'tag-green'}`}
                            style={{ fontSize: '9px', padding: '1px 6px' }}>
                            {g === 'rocket_league' ? 'RL' : 'TM'}
                          </span>
                        ))}
                      </div>

                      {u.memberships.length > 0 && (
                        <span className="tag tag-gold" style={{ fontSize: '8px', padding: '0px 5px' }}>
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

                    {/* Détails expansibles */}
                    {isExpanded && (
                      <div className="px-5 pb-5 space-y-4">
                        <div className="divider" />

                        {/* Infos détaillées */}
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
                              <span className="text-xs" style={{ color: 'var(--s-text-dim)' }}>{country ? `${country.flag} ${country.name}` : '—'}</span>
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
                                  <span key={g} className={`tag ${g === 'rocket_league' ? 'tag-blue' : 'tag-green'}`}
                                    style={{ fontSize: '9px', padding: '1px 6px' }}>
                                    {g === 'rocket_league' ? 'Rocket League' : 'Trackmania'}
                                  </span>
                                )) : <span className="text-xs" style={{ color: 'var(--s-text-muted)' }}>—</span>}
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

                          {/* Structures */}
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
                                        <span className={`tag ${m.game === 'rocket_league' ? 'tag-blue' : 'tag-green'}`}
                                          style={{ fontSize: '8px', padding: '0px 4px' }}>
                                          {m.game === 'rocket_league' ? 'RL' : 'TM'}
                                        </span>
                                      </div>
                                    </div>
                                    <button
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

                        {/* Raison du ban (si banni) */}
                        {u.isBanned && u.banReason && (
                          <div className="px-3 py-2" style={{ background: 'rgba(255,50,50,0.05)', border: '1px solid rgba(255,50,50,0.2)' }}>
                            <span className="t-label block mb-0.5" style={{ color: '#ff5555' }}>Raison du ban</span>
                            <p className="text-xs" style={{ color: 'var(--s-text-dim)' }}>{u.banReason}</p>
                          </div>
                        )}

                        {/* Formulaire d'édition */}
                        {isEditing && (
                          <>
                            <div className="divider" />
                            <div className="p-4 space-y-4" style={{ background: 'rgba(123,47,190,0.03)', border: '1px solid rgba(123,47,190,0.15)' }}>
                              <div className="flex items-center justify-between mb-1">
                                <span className="t-label" style={{ color: 'var(--s-violet-light)' }}>MODIFIER LE PROFIL</span>
                                <button onClick={() => setEditingUser(null)} style={{ color: 'var(--s-text-muted)', background: 'transparent', border: 'none', cursor: 'pointer' }}>
                                  <X size={14} />
                                </button>
                              </div>

                              {/* Identité */}
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
                                    <option value="">—</option>
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

                              {/* Jeux pratiqués */}
                              <div>
                                <label className="t-label block mb-1.5">Jeux pratiqués</label>
                                <div className="flex gap-2">
                                  {[
                                    { value: 'rocket_league', label: 'Rocket League', tagClass: 'tag-blue' },
                                    { value: 'trackmania', label: 'Trackmania', tagClass: 'tag-green' },
                                  ].map(g => {
                                    const active = editForm.games.includes(g.value);
                                    return (
                                      <button key={g.value} type="button"
                                        onClick={() => {
                                          setEditForm(p => ({
                                            ...p,
                                            games: active
                                              ? p.games.filter(x => x !== g.value)
                                              : [...p.games, g.value],
                                          }));
                                        }}
                                        className={`tag ${active ? g.tagClass : ''} transition-all duration-150`}
                                        style={{
                                          padding: '5px 12px', fontSize: '11px', cursor: 'pointer',
                                          opacity: active ? 1 : 0.4,
                                        }}>
                                        {g.label}
                                      </button>
                                    );
                                  })}
                                </div>
                              </div>

                              {/* Comptes Rocket League */}
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

                              {/* Comptes Trackmania */}
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

                              <button
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

                        {/* Champ raison de ban (si pas encore banni) */}
                        {!u.isBanned && (
                          <div>
                            <label className="t-label block mb-1">Raison (pour ban)</label>
                            <input type="text" className="settings-input w-full" placeholder="Raison du bannissement..."
                              value={banReasonMap[u.uid] || ''}
                              onChange={e => setBanReasonMap(p => ({ ...p, [u.uid]: e.target.value }))} />
                          </div>
                        )}

                        <div className="divider" />

                        {/* Actions */}
                        <div className="flex gap-2 flex-wrap">
                          {/* Profil public */}
                          <Link href={`/profile/${u.uid}`}
                            className="btn-springs bevel-sm flex items-center gap-2"
                            style={{ background: 'rgba(123,47,190,0.08)', color: 'var(--s-violet-light)', borderColor: 'rgba(123,47,190,0.25)', fontSize: '12px', padding: '8px 16px' }}>
                            <User size={12} />
                            <span>Voir profil</span>
                          </Link>

                          {/* Modifier */}
                          <button onClick={() => {
                            if (isEditing) {
                              setEditingUser(null);
                            } else {
                              setEditForm({
                                displayName: u.displayName, bio: u.bio, country: u.country, games: [...u.games],
                                epicAccountId: u.epicDisplayName || u.epicAccountId, rlTrackerUrl: u.rlTrackerUrl,
                                pseudoTM: u.pseudoTM, loginTM: u.loginTM, tmIoUrl: u.tmIoUrl,
                              });
                              setEditingUser(u.uid);
                            }
                          }}
                            className="btn-springs bevel-sm flex items-center gap-2"
                            style={{ background: 'rgba(0,129,255,0.08)', color: '#4da6ff', borderColor: 'rgba(0,129,255,0.25)', fontSize: '12px', padding: '8px 16px' }}>
                            <Edit3 size={12} />
                            <span>{isEditing ? 'Annuler édition' : 'Modifier'}</span>
                          </button>

                          {/* Ban / Unban */}
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

                          {/* Admin toggle */}
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

                          {/* Force déconnexion */}
                          <button onClick={() => handleUserAction(u.uid, 'force_disconnect')}
                            disabled={!!userActionLoading}
                            className="btn-springs bevel-sm flex items-center gap-2"
                            style={{ background: 'rgba(255,255,255,0.03)', color: 'var(--s-text-dim)', borderColor: 'var(--s-border)', fontSize: '12px', padding: '8px 16px' }}>
                            {userActionLoading === `${u.uid}_force_disconnect` ? <Loader2 size={12} className="animate-spin" /> : <LogOut size={12} />}
                            <span>Forcer déco</span>
                          </button>

                          {/* Supprimer */}
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
          )}
        </>
      )}

      {/* ═══ MODALE DE CONFIRMATION ═════════════════════════════════════════ */}
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
              <button onClick={() => setConfirmAction(null)}
                className="btn-springs btn-ghost text-xs">
                Annuler
              </button>
              <button
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
    </div>
  );
}
