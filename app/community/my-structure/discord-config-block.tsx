import { useState, useEffect } from 'react';
import { Loader2, Save, Hash, AtSign } from 'lucide-react';

// Presentational : affiche un bloc "salon + rôle à ping" pour un scope donné.
// Mode replié = résumé. Mode déplié = pickers + Save/Cancel. Le state draft
// (channel/role en cours d'édition) vit dans ce composant pour que chaque bloc
// ait ses propres brouillons indépendants.
export function DiscordConfigBlockRenderer(props: {
  opts: {
    label: string;
    accentColor: string;
    currentChannelId: string | null;
    currentChannelName: string | null;
    currentRoleId: string | null;
    currentRoleName: string | null;
  };
  expanded: boolean;
  saving: boolean;
  openPicker: () => void;
  closePicker: () => void;
  channels: Array<{ id: string; name: string; parentName: string | null }> | null;
  channelsLoading: boolean;
  channelsError: string | null;
  roles: Array<{ id: string; name: string; color: number; mentionable: boolean }> | null;
  rolesLoading: boolean;
  rolesError: string | null;
  onSave: (channelId: string | null, roleId: string | null) => void;
  onReloadChannels: () => void;
  onReloadRoles: () => void;
}) {
  const { opts, expanded, saving, openPicker, closePicker } = props;
  const [draftChannelId, setDraftChannelId] = useState<string>(opts.currentChannelId ?? '');
  const [draftRoleId, setDraftRoleId] = useState<string>(opts.currentRoleId ?? '');

  useEffect(() => {
    if (expanded) {
      setDraftChannelId(opts.currentChannelId ?? '');
      setDraftRoleId(opts.currentRoleId ?? '');
    }
  }, [expanded, opts.currentChannelId, opts.currentRoleId]);

  const channelsByCategory = new Map<string, typeof props.channels>();
  for (const c of props.channels ?? []) {
    const cat = c.parentName ?? 'Sans catégorie';
    if (!channelsByCategory.has(cat)) channelsByCategory.set(cat, []);
    channelsByCategory.get(cat)!.push(c);
  }

  return (
    <div className="bevel-sm"
      style={{ background: 'var(--s-elevated)', border: '1px solid var(--s-border)' }}>
      <div className="flex items-center gap-3 p-3">
        <div className="w-1.5 h-6 flex-shrink-0" style={{ background: opts.accentColor }} />
        <div className="flex-1 min-w-0">
          <div className="t-sub">{opts.label}</div>
          <div className="text-xs flex items-center gap-3 mt-0.5" style={{ color: 'var(--s-text-muted)' }}>
            <span className="flex items-center gap-1 truncate">
              <Hash size={10} />
              {opts.currentChannelName ? <span style={{ color: 'var(--s-text-dim)' }}>{opts.currentChannelName}</span> : <span>aucun salon</span>}
            </span>
            <span className="flex items-center gap-1 truncate">
              <AtSign size={10} />
              {opts.currentRoleName ? <span style={{ color: 'var(--s-text-dim)' }}>@{opts.currentRoleName}</span> : <span>aucun ping</span>}
            </span>
          </div>
        </div>
        {!expanded ? (
          <button type="button"
            className="btn-springs btn-secondary bevel-sm text-xs"
            style={{ padding: '4px 10px' }}
            onClick={openPicker}>
            Modifier
          </button>
        ) : (
          <button type="button"
            className="btn-springs btn-ghost bevel-sm text-xs"
            style={{ padding: '4px 10px' }}
            onClick={closePicker}>
            Fermer
          </button>
        )}
      </div>

      {expanded && (
        <div className="p-3 space-y-3 border-t" style={{ borderColor: 'var(--s-border)' }}>
          <div>
            <label className="t-label block mb-1.5">Salon Discord</label>
            {props.channelsLoading ? (
              <div className="text-xs flex items-center gap-2" style={{ color: 'var(--s-text-muted)' }}>
                <Loader2 size={12} className="animate-spin" />
                Chargement…
              </div>
            ) : props.channelsError ? (
              <div className="flex items-center gap-2">
                <p className="text-xs flex-1" style={{ color: '#ff5555' }}>{props.channelsError}</p>
                <button type="button" className="text-xs underline" style={{ color: 'var(--s-text-dim)' }}
                  onClick={props.onReloadChannels}>Réessayer</button>
              </div>
            ) : (
              <select className="settings-input w-full text-sm"
                value={draftChannelId}
                onChange={e => setDraftChannelId(e.target.value)}>
                <option value="">— Aucun salon (pas de post) —</option>
                {Array.from(channelsByCategory.entries()).map(([cat, chans]) => (
                  <optgroup key={cat} label={cat}>
                    {chans!.map(c => (
                      <option key={c.id} value={c.id}># {c.name}</option>
                    ))}
                  </optgroup>
                ))}
              </select>
            )}
          </div>
          <div>
            <label className="t-label block mb-1.5">Rôle à ping (optionnel)</label>
            {props.rolesLoading ? (
              <div className="text-xs flex items-center gap-2" style={{ color: 'var(--s-text-muted)' }}>
                <Loader2 size={12} className="animate-spin" />
                Chargement…
              </div>
            ) : props.rolesError ? (
              <div className="flex items-center gap-2">
                <p className="text-xs flex-1" style={{ color: '#ff5555' }}>{props.rolesError}</p>
                <button type="button" className="text-xs underline" style={{ color: 'var(--s-text-dim)' }}
                  onClick={props.onReloadRoles}>Réessayer</button>
              </div>
            ) : (
              <>
                <select className="settings-input w-full text-sm"
                  value={draftRoleId}
                  onChange={e => setDraftRoleId(e.target.value)}
                  disabled={!draftChannelId}>
                  <option value="">— Pas de ping —</option>
                  {(props.roles ?? []).map(r => (
                    <option key={r.id} value={r.id} disabled={!r.mentionable && r.id !== opts.currentRoleId}>
                      @{r.name}{!r.mentionable ? ' (non-mentionnable)' : ''}
                    </option>
                  ))}
                </select>
                {!draftChannelId && (
                  <p className="text-xs mt-1" style={{ color: 'var(--s-text-muted)' }}>
                    Choisis d&apos;abord un salon pour activer le ping.
                  </p>
                )}
                {draftRoleId && (props.roles ?? []).find(r => r.id === draftRoleId && !r.mentionable) && (
                  <p className="text-xs mt-1" style={{ color: 'var(--s-gold)' }}>
                    Ce rôle n&apos;est pas mentionnable côté Discord — le ping ne partira pas tant
                    que tu n&apos;actives pas &quot;Autoriser tout le monde à @mentionner ce rôle&quot;
                    dans les paramètres du rôle.
                  </p>
                )}
              </>
            )}
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={closePicker}
              className="btn-springs btn-ghost bevel-sm text-xs"
              style={{ padding: '6px 12px' }}>
              Annuler
            </button>
            <button type="button" disabled={saving}
              onClick={() => props.onSave(draftChannelId || null, draftRoleId || null)}
              className="btn-springs btn-primary bevel-sm text-xs flex items-center gap-1"
              style={{ padding: '6px 12px' }}>
              {saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
              Enregistrer
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
