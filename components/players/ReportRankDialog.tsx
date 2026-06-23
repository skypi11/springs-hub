// Modale de signalement de rang, Lot v2 (anti-mensonge + anti-smurf).
// Remplace l'enchaînement confirm() + window.prompt() précédent par un vrai
// formulaire intégré DA Aedral. Le joueur choisit le motif (faux rang / smurf)
// + éventuellement un message libre.

'use client';

import React, { useEffect, useState } from 'react';
import { Loader2, Flag, ShieldAlert, AlertCircle } from 'lucide-react';
import Portal from '@/components/ui/Portal';
import { api, ApiError } from '@/lib/api-client';
import { useToast } from '@/components/ui/Toast';

export type RankReportMotif = 'rank_lie' | 'smurf';

interface Props {
  open: boolean;
  onClose: () => void;
  targetUid: string;
  targetName?: string;
  /** Jeu dont on signale le rang ('rocket_league' | 'valorant'). Default RL. */
  game?: string;
  onSent?: () => void;
}

export default function ReportRankDialog({ open, onClose, targetUid, targetName, game = 'rocket_league', onSent }: Props) {
  const toast = useToast();
  // Valorant : le rang vient du sync auto (impossible de mentir), donc seul le
  // motif « smurf » a du sens (compte secondaire bas-elo lié au Discord). RL :
  // les deux motifs (rang déclaré faux + smurf).
  const valorantOnly = game === 'valorant';
  const defaultMotif: RankReportMotif = valorantOnly ? 'smurf' : 'rank_lie';
  const [visible, setVisible] = useState(false);
  const [motif, setMotif] = useState<RankReportMotif>(defaultMotif);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (open) {
      const t = setTimeout(() => setVisible(true), 10);
      return () => clearTimeout(t);
    }
    setVisible(false);
    // Reset à la fermeture pour ne pas pré-remplir au prochain ouvert
    const t = setTimeout(() => { setMotif(defaultMotif); setMessage(''); }, 220);
    return () => clearTimeout(t);
  }, [open, defaultMotif]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  if (!open) return null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      await api(`/api/profile/${targetUid}/rank-report`, {
        method: 'POST',
        body: { motif, message: message.trim(), game },
      });
      toast.success('Signalement envoyé. Merci.');
      onSent?.();
      onClose();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Erreur réseau.');
    } finally {
      setLoading(false);
    }
  }

  const ALL_MOTIFS: Array<{ value: RankReportMotif; label: string; help: string; icon: typeof Flag; color: string }> = [
    {
      value: 'rank_lie',
      label: 'Rang déclaré faux',
      help: 'Le rang affiché ne colle pas à son tracker (trop haut ou trop bas).',
      icon: AlertCircle,
      color: '#0081FF',
    },
    {
      value: 'smurf',
      label: 'Soupçon de smurf',
      help: 'Il joue clairement bien au-dessus du rang qu\'il affiche, compte secondaire suspecté.',
      icon: ShieldAlert,
      color: '#ef4444',
    },
  ];
  // Valorant : seul le motif smurf est proposé (rang auto-vérifié, pas de mensonge possible).
  const MOTIFS = valorantOnly ? ALL_MOTIFS.filter(m => m.value === 'smurf') : ALL_MOTIFS;

  return (
    <Portal>
      <div
        role="dialog"
        aria-modal="true"
        style={{
          position: 'fixed', inset: 0, zIndex: 10000,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: visible ? 'rgba(4,4,8,0.78)' : 'rgba(4,4,8,0)',
          transition: 'background 0.2s ease',
          padding: 24,
        }}
        onClick={() => !loading && onClose()}
      >
        <form
          onSubmit={handleSubmit}
          onClick={e => e.stopPropagation()}
          style={{
            maxWidth: 520, width: '100%',
            background: 'var(--s-surface)',
            border: '1px solid var(--s-border)',
            borderTop: '3px solid var(--s-gold)',
            clipPath: 'polygon(14px 0%, 100% 0%, 100% calc(100% - 14px), calc(100% - 14px) 100%, 0% 100%, 0% 14px)',
            padding: '24px 28px 22px',
            transform: visible ? 'scale(1)' : 'scale(0.96)',
            opacity: visible ? 1 : 0,
            transition: 'transform 0.2s ease, opacity 0.2s ease',
            boxShadow: '0 24px 64px rgba(0,0,0,0.6)',
          }}
        >
          <div className="flex items-center gap-2 mb-1">
            <Flag size={16} style={{ color: 'var(--s-gold)' }} />
            <h2
              style={{
                fontFamily: 'var(--font-bebas), system-ui, sans-serif',
                fontSize: 22, letterSpacing: '0.04em',
                textTransform: 'uppercase',
                color: 'var(--s-text)', margin: 0, lineHeight: 1.1,
              }}
            >
              {valorantOnly ? 'Signaler un smurf' : 'Signaler le rang'}
            </h2>
          </div>
          <p className="text-sm mb-4" style={{ color: 'var(--s-text-dim)' }}>
            {valorantOnly ? (
              <>Tu signales un <strong>soupçon de smurf</strong> sur <strong>{targetName ?? 'ce joueur'}</strong> : son compte Riot vérifié affiche un rang qui ne reflète pas son vrai niveau. L&apos;admin vérifiera via le tracker.</>
            ) : (
              <>Tu signales le rang de <strong>{targetName ?? 'ce joueur'}</strong>. L&apos;admin sera notifié et vérifiera via le lien tracker.</>
            )}
          </p>

          {/* Motifs, radio cards */}
          <div className="space-y-2 mb-4">
            <label className="t-label block mb-1">Motif</label>
            {MOTIFS.map(m => {
              const Icon = m.icon;
              const active = motif === m.value;
              return (
                <label
                  key={m.value}
                  className="block cursor-pointer transition-colors"
                  style={{
                    border: `1px solid ${active ? m.color : 'var(--s-border)'}`,
                    background: active ? `${m.color}10` : 'var(--s-elevated)',
                    padding: '10px 12px',
                  }}
                >
                  <div className="flex items-start gap-2.5">
                    <input
                      type="radio"
                      name="motif"
                      value={m.value}
                      checked={active}
                      onChange={() => setMotif(m.value)}
                      style={{ marginTop: 3, accentColor: m.color }}
                    />
                    <div className="flex-1">
                      <div className="flex items-center gap-1.5">
                        <Icon size={13} style={{ color: m.color }} />
                        <span className="text-sm font-semibold" style={{ color: active ? m.color : 'var(--s-text)' }}>
                          {m.label}
                        </span>
                      </div>
                      <p className="text-xs mt-0.5" style={{ color: 'var(--s-text-dim)' }}>{m.help}</p>
                    </div>
                  </div>
                </label>
              );
            })}
          </div>

          {/* Message libre */}
          <div className="mb-5">
            <label className="t-label block mb-1.5">Message (optionnel)</label>
            <textarea
              className="settings-input w-full"
              rows={3}
              maxLength={500}
              value={message}
              onChange={e => setMessage(e.target.value)}
              placeholder="Précise ce qui te paraît anormal (lien vers une preuve, comportement observé…)"
            />
            <p className="text-xs mt-1" style={{ color: 'var(--s-text-muted)' }}>
              {message.length}/500, les signalements abusifs sont visibles par l&apos;admin et peuvent te bloquer.
            </p>
          </div>

          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              className="btn-springs btn-secondary bevel-sm"
            >
              Annuler
            </button>
            <button
              type="submit"
              disabled={loading}
              className="btn-springs bevel-sm inline-flex items-center gap-1.5"
              style={{
                background: 'var(--s-gold)',
                color: '#0a0a0f',
                borderColor: 'var(--s-gold)',
              }}
            >
              {loading ? <Loader2 size={12} className="animate-spin" /> : <Flag size={12} />}
              Envoyer le signalement
            </button>
          </div>
        </form>
      </div>
    </Portal>
  );
}
