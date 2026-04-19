'use client';

import { useState, useCallback, useEffect } from 'react';
import { Loader2, X, Share2, Trash2, Edit2, Check, Users, User as UserIcon } from 'lucide-react';
import Portal from '@/components/ui/Portal';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/components/ui/Toast';
import { useConfirm } from '@/components/ui/ConfirmModal';
import {
  TODO_TITLE_MAX,
  TODO_DESCRIPTION_MAX,
  TODO_TYPE_META,
  type TodoType,
} from '@/lib/todos';
import { TEMPLATE_NAME_MAX } from '@/lib/todo-templates';
import { TodoConfigFields } from '@/components/calendar/TodoConfigFields';

export type TodoTemplateUi = {
  id: string;
  structureId: string;
  ownerId: string;
  scope: 'personal' | 'structure';
  name: string;
  type: TodoType;
  titleTemplate: string;
  descriptionTemplate: string;
  config: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
};

export default function TodoTemplatesManager({
  structureId,
  currentUid,
  templates,
  onClose,
  onChanged,
}: {
  structureId: string;
  currentUid: string;
  templates: TodoTemplateUi[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const personal = templates.filter(t => t.scope === 'personal');
  const structure = templates.filter(t => t.scope === 'structure');
  const [editingId, setEditingId] = useState<string | null>(null);

  return (
    <Portal>
      <div
        className="fixed inset-0 flex items-center justify-center p-4"
        style={{ background: 'rgba(0,0,0,0.72)', zIndex: 9700 }}
        onClick={onClose}
      >
        <div
          className="panel bevel w-full max-w-2xl max-h-[88vh] overflow-auto"
          style={{ background: 'var(--s-surface)' }}
          onClick={e => e.stopPropagation()}
        >
          <div className="panel-header flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="t-heading" style={{ fontSize: '18px' }}>Templates de devoirs</span>
              <span className="text-xs" style={{ color: 'var(--s-text-muted)' }}>
                ({templates.length})
              </span>
            </div>
            <button type="button" onClick={onClose}
              className="p-1 transition-colors"
              style={{ color: 'var(--s-text-dim)', cursor: 'pointer' }}
              aria-label="Fermer">
              <X size={16} />
            </button>
          </div>

          <div className="panel-body space-y-5">
            {/* Mes templates perso */}
            <TemplateGroup
              label="MES TEMPLATES (perso)"
              icon={<UserIcon size={12} style={{ color: 'var(--s-violet-light)' }} />}
              empty="Aucun template personnel. Enregistre un devoir existant comme template pour le réutiliser."
              templates={personal}
              structureId={structureId}
              currentUid={currentUid}
              editingId={editingId}
              setEditingId={setEditingId}
              onChanged={onChanged}
            />

            {/* Templates partagés */}
            <TemplateGroup
              label="PARTAGÉS DE LA STRUCTURE"
              icon={<Users size={12} style={{ color: 'var(--s-gold)' }} />}
              empty="Aucun template partagé. Partage tes recettes avec toute la structure pour que le staff en bénéficie."
              templates={structure}
              structureId={structureId}
              currentUid={currentUid}
              editingId={editingId}
              setEditingId={setEditingId}
              onChanged={onChanged}
            />
          </div>
        </div>
      </div>
    </Portal>
  );
}

function TemplateGroup({
  label,
  icon,
  empty,
  templates,
  structureId,
  currentUid,
  editingId,
  setEditingId,
  onChanged,
}: {
  label: string;
  icon: React.ReactNode;
  empty: string;
  templates: TodoTemplateUi[];
  structureId: string;
  currentUid: string;
  editingId: string | null;
  setEditingId: (id: string | null) => void;
  onChanged: () => void;
}) {
  return (
    <div>
      <div className="flex items-center gap-1.5 mb-2">
        {icon}
        <span className="t-label" style={{ fontSize: '12px', color: 'var(--s-text-dim)' }}>
          {label} ({templates.length})
        </span>
      </div>
      {templates.length === 0 ? (
        <p className="text-xs" style={{ color: 'var(--s-text-muted)' }}>{empty}</p>
      ) : (
        <div className="space-y-2">
          {templates.map(t => (
            <TemplateRow
              key={t.id}
              template={t}
              structureId={structureId}
              currentUid={currentUid}
              editing={editingId === t.id}
              onStartEdit={() => setEditingId(t.id)}
              onCancelEdit={() => setEditingId(null)}
              onChanged={() => { setEditingId(null); onChanged(); }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function TemplateRow({
  template,
  structureId,
  currentUid,
  editing,
  onStartEdit,
  onCancelEdit,
  onChanged,
}: {
  template: TodoTemplateUi;
  structureId: string;
  currentUid: string;
  editing: boolean;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onChanged: () => void;
}) {
  const { firebaseUser } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const [busy, setBusy] = useState<'share' | 'delete' | null>(null);
  const isOwner = template.ownerId === currentUid;

  async function toggleShare() {
    if (!firebaseUser || busy) return;
    const newScope = template.scope === 'personal' ? 'structure' : 'personal';
    const confirmLabel = newScope === 'structure' ? 'Partager' : 'Retirer le partage';
    const ok = await confirm({
      title: newScope === 'structure' ? 'Partager ce template ?' : 'Retirer du partage ?',
      message: newScope === 'structure'
        ? 'Ce template deviendra visible par tout le staff de la structure. Tu restes le propriétaire et seul toi peux l\u2019éditer.'
        : 'Ce template redeviendra visible uniquement par toi.',
      confirmLabel,
      variant: newScope === 'structure' ? 'default' : 'danger',
    });
    if (!ok) return;

    setBusy('share');
    try {
      const idToken = await firebaseUser.getIdToken();
      const res = await fetch(`/api/structures/${structureId}/todo-templates/${template.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
        body: JSON.stringify({ action: 'share', scope: newScope }),
      });
      if (res.ok) {
        toast.success(newScope === 'structure' ? 'Template partagé' : 'Partage retiré');
        onChanged();
      } else {
        const d = await res.json().catch(() => ({}));
        toast.error(d.error || 'Erreur');
      }
    } catch {
      toast.error('Erreur réseau');
    }
    setBusy(null);
  }

  async function remove() {
    if (!firebaseUser || busy) return;
    const ok = await confirm({
      title: 'Supprimer ce template ?',
      message: `« ${template.name} » — cette action est irréversible. Les devoirs déjà créés à partir de ce template restent intacts.`,
      confirmLabel: 'Supprimer',
      variant: 'danger',
    });
    if (!ok) return;

    setBusy('delete');
    try {
      const idToken = await firebaseUser.getIdToken();
      const res = await fetch(`/api/structures/${structureId}/todo-templates/${template.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${idToken}` },
      });
      if (res.ok) {
        toast.success('Template supprimé');
        onChanged();
      } else {
        const d = await res.json().catch(() => ({}));
        toast.error(d.error || 'Erreur');
      }
    } catch {
      toast.error('Erreur réseau');
    }
    setBusy(null);
  }

  if (editing) {
    return (
      <TemplateEditForm
        template={template}
        structureId={structureId}
        onCancel={onCancelEdit}
        onSaved={onChanged}
      />
    );
  }

  return (
    <div className="p-2.5" style={{ background: 'var(--s-elevated)', border: '1px solid var(--s-border)' }}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-bold" style={{ color: 'var(--s-text)' }}>
              {template.name}
            </span>
            <span className="px-1.5 py-0.5 text-xs font-bold tracking-wider"
              style={{
                fontSize: '10px',
                background: 'var(--s-surface)',
                border: '1px solid var(--s-border)',
                color: 'var(--s-text-dim)',
              }}>
              {TODO_TYPE_META[template.type].short.toUpperCase()}
            </span>
            {!isOwner && (
              <span className="text-xs" style={{ color: 'var(--s-text-muted)' }}>
                (pas propriétaire)
              </span>
            )}
          </div>
          {template.titleTemplate && (
            <p className="text-xs mt-1" style={{ color: 'var(--s-text-dim)' }}>
              Titre : {template.titleTemplate}
            </p>
          )}
          {template.descriptionTemplate && (
            <p className="text-xs mt-0.5 whitespace-pre-wrap truncate" style={{ color: 'var(--s-text-muted)' }}>
              {template.descriptionTemplate.slice(0, 160)}
            </p>
          )}
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          {isOwner && (
            <>
              <button type="button" onClick={onStartEdit}
                className="p-1.5 transition-colors"
                style={{ color: 'var(--s-text-dim)', cursor: 'pointer' }}
                aria-label="Éditer">
                <Edit2 size={12} />
              </button>
              <button type="button" onClick={toggleShare} disabled={!!busy}
                className="p-1.5 transition-colors"
                style={{
                  color: template.scope === 'structure' ? 'var(--s-gold)' : 'var(--s-text-dim)',
                  cursor: busy ? 'wait' : 'pointer',
                }}
                aria-label={template.scope === 'structure' ? 'Retirer du partage' : 'Partager'}
                title={template.scope === 'structure' ? 'Retirer du partage' : 'Partager avec la structure'}>
                {busy === 'share' ? <Loader2 size={12} className="animate-spin" /> : <Share2 size={12} />}
              </button>
            </>
          )}
          <button type="button" onClick={remove} disabled={!!busy}
            className="p-1.5 transition-colors"
            style={{ color: '#ff5555', opacity: 0.7, cursor: busy ? 'wait' : 'pointer' }}
            aria-label="Supprimer">
            {busy === 'delete' ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
          </button>
        </div>
      </div>
    </div>
  );
}

function TemplateEditForm({
  template,
  structureId,
  onCancel,
  onSaved,
}: {
  template: TodoTemplateUi;
  structureId: string;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const { firebaseUser } = useAuth();
  const toast = useToast();
  const [name, setName] = useState(template.name);
  const [titleTemplate, setTitleTemplate] = useState(template.titleTemplate);
  const [descriptionTemplate, setDescriptionTemplate] = useState(template.descriptionTemplate);
  const [config, setConfig] = useState<Record<string, unknown>>(template.config);
  const [saving, setSaving] = useState(false);

  const updateConfig = useCallback((patch: Record<string, unknown>) => {
    setConfig(prev => ({ ...prev, ...patch }));
  }, []);

  async function save() {
    if (!firebaseUser || saving) return;
    if (!name.trim()) { toast.error('Nom requis'); return; }
    setSaving(true);
    try {
      const idToken = await firebaseUser.getIdToken();
      const res = await fetch(`/api/structures/${structureId}/todo-templates/${template.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
        body: JSON.stringify({
          name: name.trim(),
          titleTemplate,
          descriptionTemplate,
          config,
        }),
      });
      if (res.ok) {
        toast.success('Template mis à jour');
        onSaved();
      } else {
        const d = await res.json().catch(() => ({}));
        toast.error(d.error || 'Erreur');
      }
    } catch {
      toast.error('Erreur réseau');
    }
    setSaving(false);
  }

  return (
    <div className="p-3 space-y-3" style={{ background: 'var(--s-elevated)', border: '1px solid var(--s-gold)' }}>
      <div className="flex items-center gap-2">
        <span className="t-label" style={{ fontSize: '11px', color: 'var(--s-gold)' }}>
          ÉDITION DU TEMPLATE — {TODO_TYPE_META[template.type].short.toUpperCase()}
        </span>
      </div>

      <div>
        <label className="t-label block mb-1" style={{ fontSize: '12px' }}>Nom du template *</label>
        <input type="text" className="settings-input w-full text-sm"
          placeholder="Scouting 3v3 — BO5"
          maxLength={TEMPLATE_NAME_MAX}
          value={name} onChange={e => setName(e.target.value)} />
      </div>

      <div>
        <label className="t-label block mb-1" style={{ fontSize: '12px' }}>Titre pré-rempli</label>
        <input type="text" className="settings-input w-full text-sm"
          placeholder="Laissé vide ? Tu le saisiras à chaque utilisation."
          maxLength={TODO_TITLE_MAX}
          value={titleTemplate} onChange={e => setTitleTemplate(e.target.value)} />
      </div>

      <div>
        <label className="t-label block mb-1" style={{ fontSize: '12px' }}>Description pré-remplie</label>
        <textarea rows={2} className="settings-input w-full text-sm"
          maxLength={TODO_DESCRIPTION_MAX}
          value={descriptionTemplate} onChange={e => setDescriptionTemplate(e.target.value)} />
      </div>

      <TodoConfigFields type={template.type} config={config} onChange={updateConfig} />

      <div className="flex items-center gap-2 pt-1">
        <button type="button" onClick={save} disabled={saving || !name.trim()}
          className="btn-springs btn-primary bevel-sm flex items-center gap-2 text-xs"
          style={{ opacity: !name.trim() ? 0.5 : 1 }}>
          {saving ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
          <span>Enregistrer</span>
        </button>
        <button type="button" onClick={onCancel}
          className="text-xs" style={{ color: 'var(--s-text-dim)', cursor: 'pointer' }}>
          Annuler
        </button>
      </div>
    </div>
  );
}

// Hook partagé : charge la liste des templates accessibles à l'utilisateur courant.
// Exposé ici pour être réutilisé par TeamTodosPanel et d'autres UI éventuelles.
export function useTodoTemplates(structureId: string) {
  const { firebaseUser } = useAuth();
  const [templates, setTemplates] = useState<TodoTemplateUi[]>([]);
  const [loading, setLoading] = useState(false);

  const reload = useCallback(async () => {
    if (!firebaseUser) return;
    setLoading(true);
    try {
      const idToken = await firebaseUser.getIdToken();
      const res = await fetch(`/api/structures/${structureId}/todo-templates`, {
        headers: { Authorization: `Bearer ${idToken}` },
      });
      if (res.ok) {
        const data = await res.json();
        const list = (data.templates ?? []) as TodoTemplateUi[];
        list.sort((a, b) => b.updatedAt - a.updatedAt);
        setTemplates(list);
      }
    } catch {
      // Silencieux — l'UI reste fonctionnelle sans templates.
    }
    setLoading(false);
  }, [firebaseUser, structureId]);

  useEffect(() => { reload(); }, [reload]);

  return { templates, loading, reload };
}
