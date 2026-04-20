'use client';

import Link from 'next/link';
import Image from 'next/image';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, Send, Inbox, Shield, CheckCircle, XCircle, Trash2, AlertCircle, MessageSquare } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { api, ApiError } from '@/lib/api-client';
import { useToast } from '@/components/ui/Toast';
import Breadcrumbs from '@/components/ui/Breadcrumbs';
import CompactStickyHeader from '@/components/ui/CompactStickyHeader';

type StructureRef = {
  id: string;
  name: string;
  tag: string;
  logoUrl: string;
  games: string[];
};

type SentRequest = {
  id: string;
  type: 'join_request';
  game: string;
  role: string;
  message: string;
  createdAt: string | null;
  structure: StructureRef;
};

type ReceivedInvite = {
  id: string;
  type: 'direct_invite';
  game: string;
  role: string;
  message: string;
  createdAt: string | null;
  structure: StructureRef;
};

const GAME_LABELS: Record<string, { label: string; cls: string }> = {
  rocket_league: { label: 'Rocket League', cls: 'tag-blue' },
  trackmania: { label: 'Trackmania', cls: 'tag-green' },
};

const ROLE_LABELS: Record<string, string> = {
  joueur: 'Joueur',
  titulaire: 'Titulaire',
  sub: 'Remplaçant',
  coach: 'Coach',
  manager: 'Manager',
};

function formatDate(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
}

export default function MyApplicationsPage() {
  const { firebaseUser, loading: authLoading } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();

  const queryKey = ['me', 'applications'] as const;
  const { data, isPending } = useQuery({
    queryKey,
    queryFn: () => api<{ sentRequests: SentRequest[]; receivedInvites: ReceivedInvite[] }>('/api/me/applications'),
    enabled: !!firebaseUser && !authLoading,
  });
  const sentRequests = data?.sentRequests ?? [];
  const receivedInvites = data?.receivedInvites ?? [];
  const loading = isPending && !!firebaseUser;

  const actionMutation = useMutation({
    mutationFn: ({ action, invitationId }: { action: string; invitationId: string; successMsg: string }) =>
      api('/api/me/applications', { method: 'POST', body: { action, invitationId } }),
    onSuccess: (_data, vars) => {
      toast.success(vars.successMsg);
      qc.invalidateQueries({ queryKey });
    },
    onError: (err) => {
      toast.error(err instanceof ApiError ? err.message : 'Erreur réseau');
    },
  });
  const actionId = actionMutation.isPending ? actionMutation.variables?.invitationId ?? null : null;
  const doAction = (action: string, invitationId: string, successMsg: string) => {
    actionMutation.mutate({ action, invitationId, successMsg });
  };

  if (authLoading || loading) {
    return (
      <div className="min-h-screen hex-bg px-8 py-8 flex items-center justify-center">
        <Loader2 size={28} className="animate-spin" style={{ color: 'var(--s-gold)' }} />
      </div>
    );
  }

  if (!firebaseUser) {
    return (
      <div className="min-h-screen hex-bg px-8 py-8 flex items-center justify-center">
        <div className="panel p-10 text-center max-w-md">
          <AlertCircle size={32} className="mx-auto mb-4" style={{ color: 'var(--s-text-muted)' }} />
          <h2 className="font-display text-2xl mb-2">CONNEXION REQUISE</h2>
          <p className="t-body mb-4">Connecte-toi pour voir tes candidatures et invitations.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen hex-bg px-8 py-8 space-y-8">
      <CompactStickyHeader icon={Inbox} title="Mes candidatures" accent="var(--s-gold)" />
      <div className="relative z-[1] space-y-8">
        <Breadcrumbs items={[
          { label: 'Communauté', href: '/community' },
          { label: 'Mes candidatures' },
        ]} />

        <header className="panel bevel p-6 animate-fade-in">
          <div className="h-[3px] -mt-6 -mx-6 mb-5" style={{ background: 'linear-gradient(90deg, var(--s-gold), transparent 60%)' }} />
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 flex items-center justify-center bevel-sm" style={{ background: 'rgba(255,184,0,0.08)', border: '1px solid rgba(255,184,0,0.25)' }}>
              <Inbox size={16} style={{ color: 'var(--s-gold)' }} />
            </div>
            <div>
              <h1 className="t-display text-3xl tracking-wider">MES CANDIDATURES</h1>
              <p className="t-body" style={{ color: 'var(--s-text-dim)' }}>
                Suis tes demandes envoyées et les invitations reçues des structures.
              </p>
            </div>
          </div>
        </header>

        {/* ═══ INVITATIONS REÇUES ═══ */}
        <section className="space-y-4 animate-fade-in-d1">
          <div className="section-label">
            <span className="t-label">Invitations reçues</span>
            {receivedInvites.length > 0 && (
              <span className="tag tag-gold" style={{ fontSize: '9px' }}>{receivedInvites.length}</span>
            )}
          </div>

          {receivedInvites.length === 0 ? (
            <div className="panel bevel p-6 text-center">
              <Inbox size={24} className="mx-auto mb-3" style={{ color: 'var(--s-text-muted)' }} />
              <p className="text-sm" style={{ color: 'var(--s-text-dim)' }}>
                Aucune invitation en attente.
              </p>
              <p className="text-xs mt-1" style={{ color: 'var(--s-text-muted)' }}>
                Active l&apos;option &ldquo;Disponible au recrutement&rdquo; dans tes paramètres pour recevoir des invitations.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {receivedInvites.map(inv => {
                const gameConf = GAME_LABELS[inv.game] || { label: inv.game, cls: 'tag-neutral' };
                const roleLabel = ROLE_LABELS[inv.role] || inv.role;
                const isBusy = actionId === inv.id;
                return (
                  <div key={inv.id} className="panel bevel p-5 relative overflow-hidden">
                    <div className="h-[3px] -mt-5 -mx-5 mb-4" style={{ background: 'linear-gradient(90deg, var(--s-gold), transparent 70%)' }} />
                    <div className="flex items-start gap-4">
                      <Link href={`/community/structure/${inv.structure.id}`} className="flex-shrink-0 w-14 h-14 relative overflow-hidden bevel-sm"
                        style={{ background: 'var(--s-elevated)', border: '1px solid var(--s-border)' }}>
                        {inv.structure.logoUrl ? (
                          <Image src={inv.structure.logoUrl} alt={inv.structure.name} fill className="object-contain p-1" unoptimized />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center">
                            <Shield size={20} style={{ color: 'var(--s-text-muted)' }} />
                          </div>
                        )}
                      </Link>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap mb-1">
                          <Link href={`/community/structure/${inv.structure.id}`}
                            className="font-display text-xl tracking-wider hover:underline" style={{ color: 'var(--s-text)' }}>
                            {inv.structure.name}
                          </Link>
                          {inv.structure.tag && <span className="tag tag-gold" style={{ fontSize: '9px' }}>{inv.structure.tag}</span>}
                        </div>
                        <div className="flex items-center gap-2 flex-wrap mb-2">
                          <span className={`tag ${gameConf.cls}`} style={{ fontSize: '9px' }}>{gameConf.label}</span>
                          <span className="tag tag-neutral" style={{ fontSize: '9px' }}>{roleLabel}</span>
                          {inv.createdAt && (
                            <span className="text-xs" style={{ color: 'var(--s-text-muted)' }}>{formatDate(inv.createdAt)}</span>
                          )}
                        </div>
                        {inv.message && (
                          <div className="flex items-start gap-2 mt-3 p-3 bevel-sm" style={{ background: 'var(--s-elevated)', border: '1px solid var(--s-border)' }}>
                            <MessageSquare size={12} className="mt-0.5 flex-shrink-0" style={{ color: 'var(--s-text-muted)' }} />
                            <p className="text-sm italic" style={{ color: 'var(--s-text-dim)' }}>{inv.message}</p>
                          </div>
                        )}
                      </div>
                      <div className="flex flex-col gap-2 flex-shrink-0">
                        <button
                          onClick={() => doAction('accept_invite', inv.id, `Bienvenue dans ${inv.structure.name} !`)}
                          disabled={isBusy}
                          className="btn-springs btn-primary bevel-sm flex items-center gap-2 text-xs"
                        >
                          {isBusy ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle size={12} />}
                          Accepter
                        </button>
                        <button
                          onClick={() => doAction('decline_invite', inv.id, 'Invitation refusée')}
                          disabled={isBusy}
                          className="btn-springs btn-ghost flex items-center gap-2 text-xs"
                        >
                          <XCircle size={12} /> Refuser
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* ═══ DEMANDES ENVOYÉES ═══ */}
        <section className="space-y-4 animate-fade-in-d2">
          <div className="section-label">
            <span className="t-label">Mes demandes envoyées</span>
            {sentRequests.length > 0 && (
              <span className="tag tag-neutral" style={{ fontSize: '9px' }}>{sentRequests.length}</span>
            )}
          </div>

          {sentRequests.length === 0 ? (
            <div className="panel bevel p-6 text-center">
              <Send size={24} className="mx-auto mb-3" style={{ color: 'var(--s-text-muted)' }} />
              <p className="text-sm" style={{ color: 'var(--s-text-dim)' }}>
                Tu n&apos;as envoyé aucune candidature.
              </p>
              <Link href="/community/structures" className="btn-springs btn-secondary bevel-sm inline-flex items-center gap-2 text-xs mt-4">
                <Shield size={12} /> Parcourir les structures
              </Link>
            </div>
          ) : (
            <div className="space-y-3">
              {sentRequests.map(req => {
                const gameConf = GAME_LABELS[req.game] || { label: req.game || '—', cls: 'tag-neutral' };
                const roleLabel = ROLE_LABELS[req.role] || req.role;
                const isBusy = actionId === req.id;
                return (
                  <div key={req.id} className="panel bevel p-5 relative overflow-hidden">
                    <div className="h-[3px] -mt-5 -mx-5 mb-4" style={{ background: 'linear-gradient(90deg, var(--s-violet), transparent 70%)' }} />
                    <div className="flex items-start gap-4">
                      <Link href={`/community/structure/${req.structure.id}`} className="flex-shrink-0 w-14 h-14 relative overflow-hidden bevel-sm"
                        style={{ background: 'var(--s-elevated)', border: '1px solid var(--s-border)' }}>
                        {req.structure.logoUrl ? (
                          <Image src={req.structure.logoUrl} alt={req.structure.name} fill className="object-contain p-1" unoptimized />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center">
                            <Shield size={20} style={{ color: 'var(--s-text-muted)' }} />
                          </div>
                        )}
                      </Link>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap mb-1">
                          <Link href={`/community/structure/${req.structure.id}`}
                            className="font-display text-xl tracking-wider hover:underline" style={{ color: 'var(--s-text)' }}>
                            {req.structure.name}
                          </Link>
                          {req.structure.tag && <span className="tag tag-gold" style={{ fontSize: '9px' }}>{req.structure.tag}</span>}
                          <span className="tag" style={{ fontSize: '9px', background: 'rgba(255,184,0,0.1)', color: 'var(--s-gold)', borderColor: 'rgba(255,184,0,0.25)' }}>
                            En attente
                          </span>
                        </div>
                        <div className="flex items-center gap-2 flex-wrap mb-2">
                          <span className={`tag ${gameConf.cls}`} style={{ fontSize: '9px' }}>{gameConf.label}</span>
                          <span className="tag tag-neutral" style={{ fontSize: '9px' }}>{roleLabel}</span>
                          {req.createdAt && (
                            <span className="text-xs" style={{ color: 'var(--s-text-muted)' }}>{formatDate(req.createdAt)}</span>
                          )}
                        </div>
                        {req.message && (
                          <div className="flex items-start gap-2 mt-3 p-3 bevel-sm" style={{ background: 'var(--s-elevated)', border: '1px solid var(--s-border)' }}>
                            <MessageSquare size={12} className="mt-0.5 flex-shrink-0" style={{ color: 'var(--s-text-muted)' }} />
                            <p className="text-sm italic" style={{ color: 'var(--s-text-dim)' }}>{req.message}</p>
                          </div>
                        )}
                      </div>
                      <div className="flex-shrink-0">
                        <button
                          onClick={() => doAction('cancel_request', req.id, 'Demande annulée')}
                          disabled={isBusy}
                          className="btn-springs btn-ghost flex items-center gap-2 text-xs"
                        >
                          {isBusy ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                          Annuler
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
