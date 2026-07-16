'use client';

// Registre unifié des sanctions de compétition (warn / exclusion / ban) — panel
// de /admin/competitions. Remplace l'ancien registre des bans. Géré par les
// admins de compétition. Un ban/exclusion actif = refus auto à l'inscription ;
// un warn est informatif (notif + DM). Révocation horodatée, jamais de delete.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, ApiError } from '@/lib/api-client';
import { useToast } from '@/components/ui/Toast';
import { useConfirm } from '@/components/ui/ConfirmModal';
import { ShieldAlert } from 'lucide-react';
import { SANCTION_REASON_CODES } from '@/lib/competitions/sanctions';

interface SanctionRow {
  id: string;
  type: 'warn' | 'exclusion' | 'ban';
  targetType: 'user' | 'structure' | 'team';
  targetId: string;
  targetLabel: string;
  reasonCode: string | null;
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

const TYPE_LABEL: Record<string, string> = { warn: 'Avertissement', exclusion: 'Exclusion', ban: 'Ban' };
const TYPE_STYLE: Record<string, React.CSSProperties> = {
  warn: { color: '#ffb46b', borderColor: 'rgba(255,180,107,0.4)' },
  exclusion: { color: '#ff8a8a', borderColor: 'rgba(255,138,138,0.4)' },
  ban: { color: '#ff8a8a', borderColor: 'rgba(255,138,138,0.4)' },
};
const TARGET_LABEL: Record<string, string> = { user: 'Joueur', structure: 'Structure', team: 'Équipe' };

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' }); }
  catch { return '—'; }
}

const chip = (active: boolean): React.CSSProperties => ({
  cursor: 'pointer',
  background: active ? 'rgba(255,255,255,0.12)' : 'transparent',
  borderColor: active ? 'rgba(255,255,255,0.35)' : 'var(--s-border)',
  color: active ? 'var(--s-text)' : 'var(--s-text-dim)',
});

export default function SanctionsPanel() {
  const toast = useToast();
  const confirm = useConfirm();

  // `useToast` renvoie une identité neuve à chaque rendu du provider (donc à
  // chaque toast affiché n'importe où dans l'app). La lire par ref garde `load`
  // stable : sans ça, l'effet de montage rechargerait tout le registre à chaque
  // toast. Jamais lue pendant le rendu — uniquement dans `load`.
  const toastRef = useRef(toast);
  useEffect(() => { toastRef.current = toast; }, [toast]);

  const [sanctions, setSanctions] = useState<SanctionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [type, setType] = useState<'warn' | 'ban'>('ban');
  const [targetType, setTargetType] = useState<'user' | 'structure'>('user');
  const [search, setSearch] = useState('');
  const [results, setResults] = useState<SearchResults | null>(null);
  const [selected, setSelected] = useState<{ id: string; label: string } | null>(null);
  const [reasonCode, setReasonCode] = useState('');
  const [reason, setReason] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const d = await api<{ sanctions: SanctionRow[] }>('/api/admin/competition-sanctions');
      setSanctions(d.sanctions ?? []);
    } catch (err) {
      toastRef.current.error(err instanceof ApiError ? err.message : 'Erreur de chargement.');
    }
    setLoading(false);
  }, []);
  // IIFE : un effet ne peut pas être `async`. Appelée telle quelle, `load` est
  // opaque pour le compilateur, qui suppose alors un setState synchrone en effet
  // (ils sont tous derrière l'`await`). Le timing est identique : `load()` part
  // au même instant, la promesse est ignorée comme avant.
  useEffect(() => { (async () => { await load(); })(); }, [load]);

  const activeCount = useMemo(() => sanctions.filter(s => s.active).length, [sanctions]);

  async function runSearch(q: string) {
    setSearch(q);
    setSelected(null);
    if (q.trim().length < 2) { setResults(null); return; }
    try {
      const data = await api<SearchResults>(`/api/admin/competition-sanctions?search=${encodeURIComponent(q.trim())}`);
      setResults(data);
    } catch { /* best-effort */ }
  }

  function resetForm() {
    setShowForm(false); setSearch(''); setResults(null); setSelected(null);
    setReason(''); setReasonCode(''); setExpiresAt('');
  }

  async function submit() {
    if (!selected) { toast.error('Choisis une cible.'); return; }
    if (reason.trim().length < 3) { toast.error('Le motif est obligatoire.'); return; }
    setSaving(true);
    try {
      await api('/api/admin/competition-sanctions', {
        method: 'POST',
        body: {
          type, targetType, targetId: selected.id,
          reasonCode: reasonCode || undefined, reason: reason.trim(),
          expiresAt: type === 'ban' && expiresAt ? new Date(expiresAt).toISOString() : undefined,
        },
      });
      toast.success(type === 'warn' ? `${selected.label} averti.` : `${selected.label} banni des compétitions.`);
      resetForm();
      await load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Erreur réseau.');
    }
    // Hors du `try` plutôt qu'en `finally` : le catch ne relance jamais, donc ce
    // point est atteint sur les deux chemins. Un `finally` fait silencieusement
    // sortir TOUT le composant du React Compiler (construction non supportée).
    setSaving(false);
  }

  async function revoke(s: SanctionRow) {
    const ok = await confirm({
      title: 'Révoquer la sanction',
      message: `${s.targetLabel} — la sanction reste dans l'historique mais n'est plus active.`,
      confirmLabel: 'Révoquer',
    });
    if (!ok) return;
    try {
      await api(`/api/admin/competition-sanctions/${s.id}`, { method: 'PATCH', body: { action: 'revoke' } });
      toast.success('Sanction révoquée.');
      await load();
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
        <span className="t-sub">Registre des sanctions ({activeCount} active{activeCount > 1 ? 's' : ''})</span>
        {!showForm && (
          <button type="button" className="btn-springs btn-secondary bevel-sm text-sm flex items-center gap-1.5"
            onClick={() => setShowForm(true)}>
            <ShieldAlert size={14} /> Sanctionner
          </button>
        )}
      </div>
      <div className="panel-body space-y-4">
        <p className="text-sm" style={{ color: 'var(--s-text-dim)' }}>
          Avertissement (informatif, notifié) · Ban (refus d&apos;inscription à toutes les compétitions).
          Les sanctions d&apos;équipe se posent depuis la file de validation. Une révocation reste dans l&apos;historique.
        </p>

        {showForm && (
          <div className="space-y-3" style={{ border: '1px solid var(--s-border)', padding: '12px' }}>
            <div className="flex items-center gap-2 flex-wrap">
              {(['warn', 'ban'] as const).map(t => (
                <button key={t} type="button" className="tag" style={chip(type === t)} onClick={() => setType(t)}>
                  {TYPE_LABEL[t]}
                </button>
              ))}
              <span className="mx-1" style={{ color: 'var(--s-text-muted)' }}>·</span>
              {(['user', 'structure'] as const).map(t => (
                <button key={t} type="button" className="tag" style={chip(targetType === t)}
                  onClick={() => { setTargetType(t); setResults(null); setSelected(null); setSearch(''); }}>
                  {t === 'user' ? 'Joueur' : 'Structure'}
                </button>
              ))}
            </div>

            <div className="max-w-md">
              <input className="settings-input w-full"
                placeholder={targetType === 'user' ? 'Chercher un joueur' : 'Chercher une structure'}
                value={selected ? selected.label : search}
                onChange={e => runSearch(e.target.value)} />
              {!selected && candidates.length > 0 && (
                <div className="mt-1" style={{ background: 'var(--s-elevated)', border: '1px solid var(--s-border)' }}>
                  {candidates.map(c => (
                    <button key={c.id} type="button"
                      className="w-full flex items-center justify-between px-3 py-2 text-left text-sm hover:bg-[var(--s-hover)]"
                      onClick={() => { setSelected({ id: c.id, label: c.label }); setResults(null); }}>
                      <span>{c.label}</span>
                      <span style={{ color: 'var(--s-text-muted)' }}>{c.sub}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              {SANCTION_REASON_CODES.map(rc => (
                <button key={rc.code} type="button" className="tag" style={chip(reasonCode === rc.code)}
                  onClick={() => setReasonCode(reasonCode === rc.code ? '' : rc.code)}>
                  {rc.label}
                </button>
              ))}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="block text-sm mb-1" style={{ color: 'var(--s-text-dim)' }}>Motif</label>
                <input className="settings-input w-full" value={reason} maxLength={500}
                  onChange={e => setReason(e.target.value)} placeholder="Détail transmis à l'équipe…" />
              </div>
              {type === 'ban' && (
                <div>
                  <label className="block text-sm mb-1" style={{ color: 'var(--s-text-dim)' }}>Expire le</label>
                  <input type="date" className="settings-input w-full" value={expiresAt}
                    onChange={e => setExpiresAt(e.target.value)} />
                  <p className="text-xs mt-1" style={{ color: 'var(--s-text-muted)' }}>Vide = permanent.</p>
                </div>
              )}
            </div>

            <div className="flex items-center gap-3">
              <button type="button" className="btn-springs btn-primary bevel-sm text-sm" onClick={submit} disabled={saving}>
                {saving ? 'Enregistrement…' : type === 'warn' ? 'Avertir' : 'Bannir'}
              </button>
              <button type="button" className="btn-springs btn-ghost text-sm" onClick={resetForm} disabled={saving}>
                Annuler
              </button>
            </div>
          </div>
        )}

        {loading ? (
          <p className="text-sm" style={{ color: 'var(--s-text-muted)' }}>Chargement…</p>
        ) : sanctions.length === 0 ? (
          <p className="text-sm" style={{ color: 'var(--s-text-muted)' }}>Aucune sanction.</p>
        ) : (
          <div style={{ border: '1px solid var(--s-border)' }}>
            {sanctions.map((s, i) => (
              <div key={s.id} className="flex flex-wrap items-center gap-3 px-3 py-2"
                style={{ borderTop: i > 0 ? '1px solid var(--s-border)' : 'none', opacity: s.active ? 1 : 0.55 }}>
                <span className="tag tag-neutral" style={TYPE_STYLE[s.type]}>{TYPE_LABEL[s.type]}</span>
                <span className="tag tag-neutral">{TARGET_LABEL[s.targetType]}</span>
                <span className="text-sm font-semibold min-w-0 truncate">{s.targetLabel}</span>
                <span className="text-sm min-w-0 truncate" style={{ color: 'var(--s-text-dim)', maxWidth: '30ch' }}>{s.reason}</span>
                <span className="text-xs ml-auto" style={{ color: 'var(--s-text-muted)' }}>
                  {s.revokedAt
                    ? `Révoquée le ${formatDate(s.revokedAt)}`
                    : s.expiresAt
                      ? (s.active ? `Expire le ${formatDate(s.expiresAt)}` : `Expirée le ${formatDate(s.expiresAt)}`)
                      : formatDate(s.createdAt)}
                </span>
                {s.active && (
                  <button type="button" className="btn-springs btn-ghost text-sm" onClick={() => revoke(s)}>
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
