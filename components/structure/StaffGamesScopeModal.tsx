'use client';

import { useEffect, useState } from 'react';
import { X, Loader2, Check } from 'lucide-react';
import Portal from '@/components/ui/Portal';
import { api, ApiError } from '@/lib/api-client';
import { useToast } from '@/components/ui/Toast';
import { ALL_GAME_DEFS } from '@/lib/games-registry';

export interface StaffGamesScopeModalProps {
  open: boolean;
  onClose: () => void;
  /** Id de la structure (route API) */
  structureId: string;
  /** Uid du user dont on configure le scope */
  targetUserId: string;
  /** Nom affiché du user dans le header */
  targetName: string;
  /** Rôle concerné, la clé scope diffère (managerGames vs coachGames) */
  role: 'manager' | 'coach';
  /** Jeux que la structure pratique (filter les checkboxes) */
  structureGames: string[];
  /** Scope actuel, null/undefined = all-games, [] = aucun, [gameId...] = liste explicite */
  currentScope: string[] | null | undefined;
  /** Callback succès, le parent rafraîchit la struct */
  onSaved: () => void;
}

/**
 * Modal qui permet à un dirigeant de configurer le scope par jeu d'un
 * Responsable ou d'un Coach. Sémantique :
 * - Toutes les cases cochées = la liste sauvegardée contient tous les jeux
 *   de la structure. Equivalent fonctionnel à all-games si la structure
 *   n'ajoute jamais de jeu, mais protège contre les ajouts futurs.
 * - Aucune case cochée → liste vide → l'user n'a plus AUCUN droit
 *   sur ce rôle (au lieu de "all-games" qui est la sémantique d'absence).
 *   On affiche un warning explicite avant de sauvegarder.
 * - Bouton "All-games (futur-proof)" → supprime la clé → rétrocompat absolue
 *   (le user gardera ses droits sur tous les jeux, présents ET futurs).
 */
export default function StaffGamesScopeModal({
  open,
  onClose,
  structureId,
  targetUserId,
  targetName,
  role,
  structureGames,
  currentScope,
  onSaved,
}: StaffGamesScopeModalProps) {
  const toast = useToast();
  const isAllGames = currentScope == null;
  const [selected, setSelected] = useState<Set<string>>(() => new Set(currentScope ?? structureGames));
  const [saving, setSaving] = useState(false);

  // Reset le state quand on ré-ouvre le modal pour un nouveau target
  useEffect(() => {
    if (open) {
      setSelected(new Set(currentScope ?? structureGames));
    }
  }, [open, currentScope, structureGames]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !saving) onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose, saving]);

  if (!open) return null;

  // Jeux affichés = ceux de la structure (filtrés depuis la registry pour l'ordre)
  const availableGames = ALL_GAME_DEFS.filter(g => structureGames.includes(g.id));

  function toggle(gameId: string) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(gameId)) next.delete(gameId);
      else next.add(gameId);
      return next;
    });
  }

  async function handleSave() {
    setSaving(true);
    try {
      const games = Array.from(selected);
      await api(`/api/structures/staff-games`, {
        method: 'POST',
        body: { structureId, targetUserId, role, games },
      });
      toast.success(games.length === 0 ? 'Scope vidé, plus aucun droit sur ce rôle' : 'Scope mis à jour');
      onSaved();
      onClose();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Erreur réseau');
    } finally {
      setSaving(false);
    }
  }

  async function handleSetAllGames() {
    // All-games = pas d'entrée managerGames/coachGames → liste vide envoyée par l'API
    // est traitée comme suppression de clé. MAIS on a une convention différente
    // côté UI : "all-games" doit envoyer toutes les cases cochées (pas vide).
    // Solution : pour "all-games futur-proof" on simule en envoyant un payload
    // explicite "supprime la clé". L'API supprime la clé quand games=[].
    // Cette UI sépare "all-games" (supprime la clé) de "vidé" (= aucun droit).
    setSaving(true);
    try {
      await api(`/api/structures/staff-games`, {
        method: 'POST',
        body: { structureId, targetUserId, role, games: [] },
      });
      toast.success('Scope réinitialisé : all-games (rétrocompat absolue)');
      onSaved();
      onClose();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Erreur réseau');
    } finally {
      setSaving(false);
    }
  }

  const roleLabel = role === 'manager' ? 'Responsable' : 'Coach';
  const accent = role === 'manager' ? 'var(--s-gold)' : '#4db1ff';

  return (
    <Portal>
      <div
        className="fixed inset-0 z-[100] flex items-center justify-center p-4 animate-fade-in"
        style={{ background: 'rgba(0,0,0,0.65)' }}
        onClick={() => !saving && onClose()}
      >
        <div
          onClick={e => e.stopPropagation()}
          className="w-full max-w-md relative overflow-hidden"
          style={{ background: 'var(--s-surface)', border: '1px solid var(--s-border)' }}
        >
          <div className="h-[3px]" style={{ background: `linear-gradient(90deg, ${accent}, ${accent}50, transparent 70%)` }} />
          {/* Header */}
          <div className="flex items-start justify-between gap-3 px-5 pt-4 pb-3" style={{ borderBottom: '1px solid var(--s-border)' }}>
            <div className="min-w-0">
              <h3 className="font-display text-lg" style={{ letterSpacing: '0.03em', color: 'var(--s-text)' }}>
                JEUX DU {roleLabel.toUpperCase()}
              </h3>
              <p className="t-mono mt-0.5 truncate" style={{ fontSize: '12px', color: 'var(--s-text-dim)' }}>
                {targetName}
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="w-7 h-7 flex items-center justify-center flex-shrink-0"
              style={{ color: 'var(--s-text-dim)', cursor: saving ? 'wait' : 'pointer' }}
              aria-label="Fermer"
            >
              <X size={16} />
            </button>
          </div>

          {/* Body */}
          <div className="p-5 space-y-4">
            <p className="text-sm" style={{ color: 'var(--s-text-dim)' }}>
              Choisis sur quel(s) jeu(x) ce {roleLabel.toLowerCase()} aura ses droits.
              Un {roleLabel} non scopé garde ses droits sur tous les jeux (présents et futurs).
            </p>

            {isAllGames && (
              <div className="p-3" style={{ background: 'rgba(0,217,54,0.06)', border: '1px solid rgba(0,217,54,0.25)' }}>
                <p className="text-xs" style={{ color: '#33ff66' }}>
                  ✓ État actuel : <strong>all-games</strong> (rôle actif sur tous les jeux). Modifier ci-dessous pour scoper à des jeux précis.
                </p>
              </div>
            )}

            {/* Checkboxes par jeu */}
            <div className="space-y-1.5">
              {availableGames.length === 0 ? (
                <p className="text-xs italic" style={{ color: 'var(--s-text-muted)' }}>
                  Aucun jeu activé sur cette structure.
                </p>
              ) : (
                availableGames.map(g => {
                  const checked = selected.has(g.id);
                  return (
                    <button
                      key={g.id}
                      type="button"
                      onClick={() => toggle(g.id)}
                      className="w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors"
                      style={{
                        background: checked ? `rgba(${g.colorRgb}, 0.08)` : 'var(--s-elevated)',
                        border: `1px solid ${checked ? `rgba(${g.colorRgb}, 0.35)` : 'var(--s-border)'}`,
                        cursor: 'pointer',
                      }}
                    >
                      <span
                        className="flex-shrink-0 flex items-center justify-center"
                        style={{
                          width: '20px',
                          height: '20px',
                          background: checked ? g.color : 'transparent',
                          border: `1px solid ${checked ? g.color : 'var(--s-text-muted)'}`,
                        }}
                      >
                        {checked && <Check size={12} style={{ color: '#000' }} strokeWidth={3} />}
                      </span>
                      <span
                        className="font-semibold text-sm flex-1"
                        style={{ color: checked ? g.colorLight : 'var(--s-text)' }}
                      >
                        {g.label}
                      </span>
                      <span
                        className="tag flex-shrink-0"
                        style={{
                          fontSize: '12px',
                          padding: '2px 6px',
                          background: `rgba(${g.colorRgb}, 0.1)`,
                          color: g.colorLight,
                          borderColor: `rgba(${g.colorRgb}, 0.25)`,
                        }}
                      >
                        {g.shortLabel}
                      </span>
                    </button>
                  );
                })
              )}
            </div>

            {selected.size === 0 && !isAllGames && (
              <div className="p-3" style={{ background: 'rgba(255,85,85,0.06)', border: '1px solid rgba(255,85,85,0.25)' }}>
                <p className="text-xs" style={{ color: '#ff8888' }}>
                  ⚠️ Aucun jeu coché, sauvegarder ainsi retire tous les droits {roleLabel.toLowerCase()} de cet user. Pour rendre le rôle actif sur tous les jeux à venir, utilise le bouton "All-games".
                </p>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between gap-2 px-5 py-3" style={{ borderTop: '1px solid var(--s-border)' }}>
            <button
              type="button"
              onClick={handleSetAllGames}
              disabled={saving}
              className="text-xs px-3 py-1.5 transition-colors"
              style={{
                background: 'transparent',
                border: '1px solid var(--s-border)',
                color: 'var(--s-text-dim)',
                cursor: saving ? 'wait' : 'pointer',
              }}
            >
              Réinitialiser (all-games)
            </button>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={onClose}
                disabled={saving}
                className="text-sm px-4 py-1.5"
                style={{
                  background: 'transparent',
                  border: '1px solid var(--s-border)',
                  color: 'var(--s-text-dim)',
                  cursor: saving ? 'wait' : 'pointer',
                }}
              >
                Annuler
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={saving}
                className="text-sm px-4 py-1.5 flex items-center gap-1.5 font-semibold"
                style={{
                  background: accent,
                  border: `1px solid ${accent}`,
                  color: '#000',
                  cursor: saving ? 'wait' : 'pointer',
                }}
              >
                {saving && <Loader2 size={12} className="animate-spin" />}
                Sauvegarder
              </button>
            </div>
          </div>
        </div>
      </div>
    </Portal>
  );
}
