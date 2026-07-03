'use client';

// Éditeur du règlement d'un circuit ou d'une compétition (spec §13bis).
// Chaque publication incrémente la version et archive la précédente —
// la version acceptée par une équipe à l'inscription reste opposable.

import { useEffect, useRef, useState } from 'react';
import { api, ApiError } from '@/lib/api-client';
import { useToast } from '@/components/ui/Toast';
import MarkdownEditor from '@/components/ui/MarkdownEditor';
import { LIMITS } from '@/lib/validation';
import { ExternalLink } from 'lucide-react';

export type RulebookScope = { circuitId: string } | { competitionId: string };

export default function RulebookEditor({
  scope,
  label,
  onClose,
}: {
  scope: RulebookScope;
  label: string;
  onClose: () => void;
}) {
  const toast = useToast();
  const taRef = useRef<HTMLTextAreaElement | null>(null);
  const [markdown, setMarkdown] = useState('');
  const [version, setVersion] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const scopeQuery = 'circuitId' in scope
    ? `circuitId=${encodeURIComponent(scope.circuitId)}`
    : `competitionId=${encodeURIComponent(scope.competitionId)}`;

  useEffect(() => {
    let cancelled = false;
    api<{ rulebook: { markdown: string; version: number } | null }>(`/api/admin/rulebooks?${scopeQuery}`)
      .then(res => {
        if (cancelled) return;
        if (res.rulebook) {
          setMarkdown(res.rulebook.markdown);
          setVersion(res.rulebook.version);
        }
      })
      .catch(err => toast.error(err instanceof ApiError ? err.message : 'Erreur de chargement.'))
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- chargement unique par scope
  }, [scopeQuery]);

  async function publish() {
    if (!markdown.trim()) {
      toast.error('Le règlement ne peut pas être vide.');
      return;
    }
    setSaving(true);
    try {
      const res = await api<{ version: number }>('/api/admin/rulebooks', {
        method: 'POST',
        body: { ...scope, markdown },
      });
      setVersion(res.version);
      toast.success(`Règlement publié (version ${res.version}).`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Erreur réseau.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="panel bevel">
      <div className="panel-header flex flex-wrap items-center justify-between gap-2">
        <span className="t-sub">Règlement — {label}</span>
        <div className="flex items-center gap-3 text-sm" style={{ color: 'var(--s-text-muted)' }}>
          {version !== null ? `Version ${version} publiée` : 'Jamais publié'}
          {'competitionId' in scope && version !== null && (
            <a
              href={`/competitions/${scope.competitionId}/reglement`}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1 underline"
              style={{ color: 'var(--s-text-dim)' }}
            >
              Page publique <ExternalLink size={12} />
            </a>
          )}
        </div>
      </div>
      <div className="panel-body space-y-4">
        {loading ? (
          <p className="text-sm" style={{ color: 'var(--s-text-dim)' }}>Chargement…</p>
        ) : (
          <>
            <MarkdownEditor
              value={markdown}
              onChange={setMarkdown}
              placeholder={'# Règlement\n\nFormat, code de conduite, litiges, cadre légal…'}
              maxLength={LIMITS.rulebookMarkdown}
              rows={24}
              taRef={taRef}
            />
            <p className="text-xs" style={{ color: 'var(--s-text-muted)' }}>
              Publier crée une nouvelle version et archive la précédente. Les
              équipes déjà inscrites gardent la version qu&apos;elles ont acceptée ;
              elles sont notifiées du changement, sans re-acceptation forcée.
            </p>
            <div className="flex items-center gap-3">
              <button type="button" className="btn-springs btn-primary bevel-sm" onClick={publish} disabled={saving}>
                {saving ? 'Publication…' : version !== null ? `Publier la version ${version + 1}` : 'Publier'}
              </button>
              <button type="button" className="btn-springs btn-ghost" onClick={onClose} disabled={saving}>
                Retour
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
