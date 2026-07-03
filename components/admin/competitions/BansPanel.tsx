'use client';

// Registre des bans de compétition (spec Legends §5) — panel de la page
// /admin/competitions. Géré par les admins de compétition (rôle scopé inclus).
// Un ban actif = refus automatique à l'inscription, motif affiché à l'équipe.

import { useMemo, useState } from 'react';
import { api, ApiError } from '@/lib/api-client';
import { useToast } from '@/components/ui/Toast';
import { useConfirm } from '@/components/ui/ConfirmModal';
import { Ban } from 'lucide-react';

export interface CompetitionBanRow {
  id: string;
  targetType: 'user' | 'structure';
  targetId: string;
  targetLabel: string;
  reason: string;
  expiresAt: string | null;
  createdAt: string | null;
  revokedAt: string | null;
  active: boolean;
}

interface SearchResults {
  users: Array<{ uid: string; displayName: string; discordUsername: string }>;
  structures: Array<{ id: string; name: string; tag: string }>;
}

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  } catch { return '—'; }
}

export default function BansPanel({
  bans,
  onChanged,
}: {
  bans: CompetitionBanRow[];
  onChanged: () => Promise<void>;
}) {
  const toast = useToast();
  const confirm = useConfirm();

  const [showForm, setShowForm] = useState(false);
  const [targetType, setTargetType] = useState<'user' | 'structure'>('user');
  const [search, setSearch] = useState('');
  const [results, setResults] = useState<SearchResults | null>(null);
  const [selected, setSelected] = useState<{ id: string; label: string } | null>(null);
  const [reason, setReason] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [saving, setSaving] = useState(false);

  const activeCount = useMemo(() => bans.filter(b => b.active).length, [bans]);

  async function runSearch(q: string) {
    setSearch(q);
    setSelected(null);
    if (q.trim().length < 2) { setResults(null); return; }
    try {
      const data = await api<SearchResults>(`/api/admin/competition-bans?search=${encodeURIComponent(q.trim())}`);
      setResults(data);
    } catch { /* recherche best-effort, l'admin retape */ }
  }

  function resetForm() {
    setShowForm(false);
    setSearch('');
    setResults(null);
    setSelected(null);
    setReason('');
    setExpiresAt('');
  }

  async function submit() {
    if (!selected) { toast.error('Choisis une cible.'); return; }
    if (!reason.trim()) { toast.error('Le motif est obligatoire (affiché au refus d\'inscription).'); return; }
    setSaving(true);
    try {
      await api('/api/admin/competition-bans', {
        method: 'POST',
        body: {
          targetType,
          targetId: selected.id,
          reason: reason.trim(),
          expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
        },
      });
      toast.success(`${selected.label} banni des compétitions.`);
      resetForm();
      await onChanged();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Erreur réseau.');
    } finally {
      setSaving(false);
    }
  }

  async function revoke(ban: CompetitionBanRow) {
    const ok = await confirm({
      title: 'Révoquer le ban',
      message: `${ban.targetLabel} pourra de nouveau s'inscrire aux compétitions. Le ban reste dans l'historique.`,
      confirmLabel: 'Révoquer',
    });
    if (!ok) return;
    try {
      await api(`/api/admin/competition-bans/${ban.id}`, { method: 'PATCH', body: { action: 'revoke' } });
      toast.success('Ban révoqué.');
      await onChanged();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Erreur réseau.');
    }
  }

  const candidates = targetType === 'user'
    ? (results?.users ?? []).map(u => ({ id: u.uid, label: u.displayName, sub: `@${u.discordUsername}` }))
    : (results?.structures ?? []).map(s => ({ id: s.id, label: s.name, sub: s.tag ? `[${s.tag}]` : '' }));

  return (
    <div className="panel bevel">
      <div className="panel-header flex items-center justify-between">
        <span className="t-sub">Registre des bans ({activeCount} actif{activeCount > 1 ? 's' : ''})</span>
        {!showForm && (
          <button
            type="button"
            className="btn-springs btn-secondary bevel-sm text-sm flex items-center gap-1.5"
            onClick={() => setShowForm(true)}
          >
            <Ban size={14} /> Bannir
          </button>
        )}
      </div>
      <div className="panel-body space-y-4">
        <p className="text-sm" style={{ color: 'var(--s-text-dim)' }}>
          Joueur ou structure au registre = inscription refusée automatiquement,
          motif affiché à l&apos;équipe. Une révocation reste dans l&apos;historique.
        </p>

        {showForm && (
          <div className="space-y-3" style={{ border: '1px solid var(--s-border)', padding: '12px' }}>
            <div className="flex items-center gap-2">
              {(['user', 'structure'] as const).map(t => (
                <button
                  key={t}
                  type="button"
                  className="tag"
                  style={{
                    cursor: 'pointer',
                    background: targetType === t ? 'rgba(255,255,255,0.12)' : 'transparent',
                    borderColor: targetType === t ? 'rgba(255,255,255,0.35)' : 'var(--s-border)',
                    color: targetType === t ? 'var(--s-text)' : 'var(--s-text-dim)',
                  }}
                  onClick={() => { setTargetType(t); setResults(null); setSelected(null); setSearch(''); }}
                >
                  {t === 'user' ? 'Joueur' : 'Structure'}
                </button>
              ))}
            </div>

            <div className="max-w-md">
              <input
                className="settings-input w-full"
                placeholder={targetType === 'user' ? 'Chercher un joueur' : 'Chercher une structure'}
                value={selected ? selected.label : search}
                onChange={e => runSearch(e.target.value)}
              />
              {!selected && candidates.length > 0 && (
                <div className="mt-1" style={{ background: 'var(--s-elevated)', border: '1px solid var(--s-border)' }}>
                  {candidates.map(c => (
                    <button
                      key={c.id}
                      type="button"
                      className="w-full flex items-center justify-between px-3 py-2 text-left text-sm hover:bg-[var(--s-hover)]"
                      style={{ cursor: 'pointer' }}
                      onClick={() => { setSelected({ id: c.id, label: c.label }); setResults(null); }}
                    >
                      <span>{c.label}</span>
                      <span style={{ color: 'var(--s-text-muted)' }}>{c.sub}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="block text-sm mb-1" style={{ color: 'var(--s-text-dim)' }}>Motif</label>
                <input className="settings-input w-full" value={reason} maxLength={500}
                  onChange={e => setReason(e.target.value)}
                  placeholder="Triche, toxicité, no-show répété…" />
              </div>
              <div>
                <label className="block text-sm mb-1" style={{ color: 'var(--s-text-dim)' }}>Expire le</label>
                <input type="date" className="settings-input w-full" value={expiresAt}
                  onChange={e => setExpiresAt(e.target.value)} />
                <p className="text-xs mt-1" style={{ color: 'var(--s-text-muted)' }}>Vide = permanent.</p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <button type="button" className="btn-springs btn-primary bevel-sm text-sm" onClick={submit} disabled={saving}>
                {saving ? 'Enregistrement…' : 'Bannir'}
              </button>
              <button type="button" className="btn-springs btn-ghost text-sm" onClick={resetForm} disabled={saving}>
                Annuler
              </button>
            </div>
          </div>
        )}

        {bans.length === 0 ? (
          <p className="text-sm" style={{ color: 'var(--s-text-muted)' }}>Registre vide.</p>
        ) : (
          <div style={{ border: '1px solid var(--s-border)' }}>
            {bans.map((b, i) => (
              <div key={b.id} className="flex flex-wrap items-center gap-3 px-3 py-2"
                style={{ borderTop: i > 0 ? '1px solid var(--s-border)' : 'none', opacity: b.active ? 1 : 0.6 }}>
                <span className="tag tag-neutral">{b.targetType === 'user' ? 'Joueur' : 'Structure'}</span>
                <span className="text-sm font-semibold flex-1 min-w-0 truncate">{b.targetLabel}</span>
                <span className="text-sm min-w-0 truncate" style={{ color: 'var(--s-text-dim)', maxWidth: '30ch' }}>
                  {b.reason}
                </span>
                <span className="text-xs" style={{ color: 'var(--s-text-muted)' }}>
                  {b.revokedAt
                    ? `Révoqué le ${formatDate(b.revokedAt)}`
                    : b.expiresAt
                      ? (b.active ? `Expire le ${formatDate(b.expiresAt)}` : `Expiré le ${formatDate(b.expiresAt)}`)
                      : 'Permanent'}
                </span>
                {b.active && (
                  <button type="button" className="btn-springs btn-ghost text-sm" onClick={() => revoke(b)}>
                    Révoquer
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
