'use client';

// Page admin : Messages ciblés (annonces / relances)
//
// Permet à un admin de composer un message et de l'envoyer à un SEGMENT
// d'utilisateurs (ex: "compte de jeu non lié", "Valorant sans rang synchronisé"),
// via notification in-app (garanti) et/ou DM Discord (best-effort, respecte
// l'opt-out de l'utilisateur). Aperçu du nombre de destinataires avant envoi.
//
// Backend : /api/admin/messages/preview (count) + /api/admin/messages/send.

import AdminContentSkeleton from '@/components/admin/AdminContentSkeleton';
import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { api, ApiError } from '@/lib/api-client';
import { useToast } from '@/components/ui/Toast';
import { useConfirm } from '@/components/ui/ConfirmModal';
import { MessageSquare, Loader2, Send, Users, Bell, Hash, AlertCircle, CheckCircle2 } from 'lucide-react';
import { SEGMENTS, DM_CAP, type SegmentId } from '@/lib/admin-segments';
import { ALL_GAME_DEFS } from '@/lib/games-registry';

type Preview = { count: number; dmReachable: number; optedOut: number };
type SendResult = {
  ok: boolean; total: number; inAppSent: number; dmSent: number;
  dmFailed: number; dmSkippedOptOut: number; dmCapped: number;
};

export default function AdminMessagesPage() {
  const { firebaseUser, isAdmin, loading: authLoading } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();

  const [segment, setSegment] = useState<SegmentId>('game_account_unlinked');
  const [gameFilter, setGameFilter] = useState('');
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [link, setLink] = useState('');
  const [inApp, setInApp] = useState(true);
  const [dm, setDm] = useState(true);

  const [preview, setPreview] = useState<Preview | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<SendResult | null>(null);

  const segDef = useMemo(() => SEGMENTS.find(s => s.id === segment), [segment]);

  useEffect(() => {
    if (!firebaseUser || !isAdmin) return;
    let cancelled = false;
    setLoadingPreview(true);
    setPreview(null);
    const params = new URLSearchParams({ segment });
    if (gameFilter) params.set('game', gameFilter);
    api<Preview>(`/api/admin/messages/preview?${params.toString()}`)
      .then(d => { if (!cancelled) setPreview(d); })
      .catch(() => { if (!cancelled) setPreview(null); })
      .finally(() => { if (!cancelled) setLoadingPreview(false); });
    return () => { cancelled = true; };
  }, [segment, gameFilter, firebaseUser, isAdmin]);

  const linkInvalid = link.trim() !== '' && !/^\/(?![/\\])/.test(link.trim());

  async function handleSend() {
    if (!title.trim() || !message.trim()) {
      toast.error('Titre et message obligatoires.');
      return;
    }
    if (!inApp && !dm) {
      toast.error('Choisis au moins un canal.');
      return;
    }
    if (linkInvalid) {
      toast.error('Le lien doit être un chemin interne commençant par un seul / (ex : /settings).');
      return;
    }
    if (dm && !inApp && preview && preview.dmReachable === 0) {
      toast.error('Aucun destinataire joignable en DM pour ce segment (tous opt-out ou sans Discord). Active aussi la notif in-app.');
      return;
    }
    const dmLine = dm && preview
      ? `\n• DM Discord : ${Math.min(preview.dmReachable, DM_CAP)} (sur ${preview.dmReachable} joignables${preview.optedOut > 0 ? `, ${preview.optedOut} opt-out exclus` : ''})`
      : '';
    const ok = await confirm({
      title: 'Envoyer le message',
      message: `Segment « ${segDef?.label} »${gameFilter ? ` (jeu filtré)` : ''} : ${preview?.count ?? '?'} destinataire(s).\n`
        + `${inApp ? '• Notification in-app : tous\n' : ''}${dmLine}\n\nConfirmer l'envoi ?`,
      confirmLabel: 'Envoyer',
    });
    if (!ok) return;
    setSending(true);
    setResult(null);
    try {
      const res = await api<SendResult>('/api/admin/messages/send', {
        method: 'POST',
        body: { segment, game: gameFilter || undefined, title: title.trim(), message: message.trim(), link: link.trim() || undefined, channels: { inApp, dm } },
      });
      setResult(res);
      toast.success(`Envoyé — in-app ${res.inAppSent}, DM ${res.dmSent}.`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Erreur réseau.');
    } finally {
      setSending(false);
    }
  }

  if (authLoading) return <AdminContentSkeleton />;

  return (
    <>
      <div className="flex items-center gap-3">
        <MessageSquare size={18} style={{ color: 'var(--s-gold)' }} />
        <h2 className="font-display text-xl" style={{ letterSpacing: '0.04em' }}>
          MESSAGES CIBLÉS
        </h2>
      </div>
      <p className="t-body" style={{ color: 'var(--s-text-dim)' }}>
        Compose un message et envoie-le à un segment d&apos;utilisateurs (relances,
        annonces). La notification in-app est garantie ; le DM Discord est
        best-effort et respecte le refus des joueurs.
      </p>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* ── Colonne gauche : ciblage ── */}
        <div className="panel p-4 space-y-4">
          <div className="flex items-center gap-2">
            <Users size={14} style={{ color: 'var(--s-gold)' }} />
            <span className="t-label">Cible</span>
          </div>

          <div>
            <label className="t-label block mb-1.5">Segment</label>
            <select value={segment} onChange={e => setSegment(e.target.value as SegmentId)} className="settings-input w-full">
              {SEGMENTS.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
            {segDef && <p className="text-xs mt-1.5" style={{ color: 'var(--s-text-muted)' }}>{segDef.description}</p>}
          </div>

          <div>
            <label className="t-label block mb-1.5">Filtrer par jeu (optionnel)</label>
            <select value={gameFilter} onChange={e => setGameFilter(e.target.value)} className="settings-input w-full">
              <option value="">Tous les jeux</option>
              {ALL_GAME_DEFS.map(g => <option key={g.id} value={g.id}>{g.label}</option>)}
            </select>
          </div>

          {/* Aperçu destinataires */}
          <div className="p-3" style={{ background: 'var(--s-elevated)', border: '1px solid var(--s-border)' }}>
            {loadingPreview ? (
              <span className="text-xs inline-flex items-center gap-2" style={{ color: 'var(--s-text-dim)' }}>
                <Loader2 size={12} className="animate-spin" /> Calcul des destinataires…
              </span>
            ) : preview ? (
              <div className="text-xs space-y-1" style={{ color: 'var(--s-text-dim)' }}>
                <div><span className="font-display text-2xl mr-2" style={{ color: 'var(--s-gold)' }}>{preview.count}</span> destinataire(s)</div>
                <div style={{ color: 'var(--s-text-muted)' }}>
                  DM joignables : {preview.dmReachable}{preview.optedOut > 0 ? ` · ${preview.optedOut} ont refusé les DM` : ''}
                </div>
              </div>
            ) : (
              <span className="text-xs" style={{ color: 'var(--s-text-muted)' }}>—</span>
            )}
          </div>

          {/* Canaux */}
          <div className="space-y-2">
            <label className="t-label block">Canaux</label>
            <label className="flex items-center gap-2 text-sm cursor-pointer" style={{ color: 'var(--s-text)' }}>
              <input type="checkbox" checked={inApp} onChange={e => setInApp(e.target.checked)} style={{ accentColor: 'var(--s-gold)' }} />
              <Bell size={13} style={{ color: 'var(--s-gold)' }} /> Notification in-app <span className="text-xs" style={{ color: 'var(--s-text-muted)' }}>(garanti)</span>
            </label>
            <label className="flex items-center gap-2 text-sm cursor-pointer" style={{ color: 'var(--s-text)' }}>
              <input type="checkbox" checked={dm} onChange={e => setDm(e.target.checked)} style={{ accentColor: 'var(--s-gold)' }} />
              <Hash size={13} style={{ color: '#5865f2' }} /> DM Discord <span className="text-xs" style={{ color: 'var(--s-text-muted)' }}>(best-effort, ≤{DM_CAP}/envoi, respecte l&apos;opt-out)</span>
            </label>
          </div>
        </div>

        {/* ── Colonne droite : message ── */}
        <div className="panel p-4 space-y-4">
          <div className="flex items-center gap-2">
            <Send size={14} style={{ color: 'var(--s-gold)' }} />
            <span className="t-label">Message</span>
          </div>

          <div>
            <label className="t-label block mb-1.5">Titre</label>
            <input type="text" value={title} onChange={e => setTitle(e.target.value)} maxLength={200}
              className="settings-input w-full" placeholder="Ex : Lie ton compte de jeu pour vérifier ton rang" />
          </div>
          <div>
            <label className="t-label block mb-1.5">Message</label>
            <textarea value={message} onChange={e => setMessage(e.target.value)} rows={6} maxLength={2000}
              className="settings-input w-full" placeholder="Markdown supporté (Discord). Reste clair et court." />
            <p className="text-xs mt-1" style={{ color: 'var(--s-text-muted)' }}>{message.length}/2000</p>
          </div>
          <div>
            <label className="t-label block mb-1.5">Lien interne (optionnel)</label>
            <input type="text" value={link} onChange={e => setLink(e.target.value)} maxLength={300}
              className="settings-input w-full" placeholder="/settings"
              style={linkInvalid ? { borderColor: 'rgba(255,85,85,0.5)' } : undefined} />
            {linkInvalid ? (
              <p className="text-xs mt-1" style={{ color: '#ff8a8a' }}>
                Doit commencer par un seul « / » (chemin interne). Ex : /settings, /community/players.
              </p>
            ) : (
              <p className="text-xs mt-1" style={{ color: 'var(--s-text-muted)' }}>Chemin du site (commence par /). Cliquable dans la notif et le DM.</p>
            )}
          </div>

          <button type="button" onClick={handleSend}
            disabled={sending || !preview || preview.count === 0 || linkInvalid || (dm && !inApp && !!preview && preview.dmReachable === 0)}
            className="btn-springs btn-primary bevel-sm inline-flex items-center gap-2 disabled:opacity-50"
            style={{ padding: '10px 18px', fontSize: '13px' }}>
            {sending ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
            {sending ? 'Envoi…' : `Envoyer${preview ? ` à ${preview.count}` : ''}`}
          </button>

          {result && (
            <div className="p-3 text-xs space-y-1" style={{ background: 'rgba(0,217,54,0.08)', border: '1px solid rgba(0,217,54,0.25)', color: 'var(--s-text-dim)' }}>
              <div className="flex items-center gap-2" style={{ color: '#33ff66' }}>
                <CheckCircle2 size={13} /> <span className="font-semibold">Envoyé.</span>
              </div>
              <div>In-app : {result.inAppSent} · DM envoyés : {result.dmSent} · DM échoués : {result.dmFailed}</div>
              {result.dmSkippedOptOut > 0 && <div>{result.dmSkippedOptOut} exclus du DM (opt-out).</div>}
              {result.dmCapped > 0 && (
                <div className="flex items-start gap-1.5" style={{ color: '#ffb800' }}>
                  <AlertCircle size={12} style={{ marginTop: 1, flexShrink: 0 }} />
                  {result.dmCapped} destinataire(s) au-delà du cap DM ({DM_CAP}) n&apos;ont PAS reçu le DM (ils ont la notif in-app). Relance si besoin.
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
