'use client';

/**
 * Settings — Section "Carte de partage" (Affichage public).
 *
 * Permet à un user de customiser le contenu de ses OG images (story 1080×1920
 * + bannière 1200×630 + embeds Discord/Twitter) :
 * - Quels rangs afficher (cap 2)
 *
 * Auto-save debounced 1s après chaque change → POST /api/profile/og-display.
 * Live preview de la story (img réelle, cache-bust à chaque save).
 *
 * Gate-friendly : si canUserCustomizeOgDisplay(user) retourne false (futur
 * gate Pro), l'API renvoie 402 et on affiche un bandeau "Réservé Aedral Pro".
 * Aujourd'hui jamais déclenché (gratuit pour tous). Cf. mémoire
 * feedback_freemium_reserve.
 *
 * Affichage struct/équipe (showStructure, showTeam) : pas encore shipped
 * côté rendu OG, l'UI les ajoutera quand le rendu sera prêt (TODO Phase 6+).
 */

import { useState, useRef, useCallback, useMemo, useEffect } from 'react';
import Image from 'next/image';
import { CheckCircle2, Loader2, Share2, Lock } from 'lucide-react';
import { api } from '@/lib/api-client';
import { useToast } from '@/components/ui/Toast';
import { ALL_GAME_DEFS, gameHasFeature } from '@/lib/games-registry';
import type { OgDisplayPreferences, SpringsUser } from '@/types';

const MAX_RANKS = 2;

interface Props {
  user: SpringsUser;
  /** Callback déclenché après chaque save réussie pour re-fetch le user
   *  dans le AuthContext (et propager les preferences à toute l'app). */
  onSaved?: () => void;
}

/** Vérifie qu'un user a un rang DÉFINI (non vide) pour un jeu donné. Sert à
 *  désactiver les checkboxes des jeux sans rang renseigné (sinon on cocherait
 *  un rang vide qui n'apparaîtrait pas sur l'OG). */
function hasRankForGame(user: SpringsUser, gameId: string): boolean {
  if (gameId === 'rocket_league') return !!user.rlRank?.trim();
  if (gameId === 'valorant') return !!user.valorantRank?.trim();
  return false;
}

export default function SharingSection({ user, onSaved }: Props) {
  const toast = useToast();
  const [prefs, setPrefs] = useState<OgDisplayPreferences>(user.ogDisplay ?? {});
  const [saving, setSaving] = useState(false);
  const [previewCacheBust, setPreviewCacheBust] = useState(() => Date.now());
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedRef = useRef<string>(JSON.stringify(user.ogDisplay ?? {}));

  // Cleanup timer au unmount
  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, []);

  // Jeux pour lesquels on supporte un rang (filtré sur la registry, pas hardcoded
  // → si on ajoute un nouveau jeu avec rang vérifié, il apparaît automatiquement).
  const rankableGames = useMemo(() => {
    return ALL_GAME_DEFS.filter(g => gameHasFeature(g.id, 'trackerProfile') || g.id === 'rocket_league' || g.id === 'valorant');
  }, []);

  // Sauvegarde debounced 1s. Si l'user enchaîne les clics, une seule requête
  // part au final (avec le state cumulé). Évite de spammer l'endpoint.
  const scheduleSave = useCallback((newPrefs: OgDisplayPreferences) => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      const payload = JSON.stringify(newPrefs);
      if (payload === lastSavedRef.current) return; // No-op si rien changé
      setSaving(true);
      try {
        await api('/api/profile/og-display', {
          method: 'POST',
          body: newPrefs,
        });
        lastSavedRef.current = payload;
        // Cache-bust pour forcer le navigateur à re-fetch la preview story
        setPreviewCacheBust(Date.now());
        onSaved?.();
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Erreur réseau';
        toast.error(`Sauvegarde échouée : ${message}`);
      } finally {
        setSaving(false);
      }
    }, 1000);
  }, [onSaved, toast]);

  function toggleRank(gameId: string) {
    const current = prefs.ranks ?? [];
    let next: string[];
    if (current.includes(gameId)) {
      next = current.filter(g => g !== gameId);
    } else {
      if (current.length >= MAX_RANKS) {
        toast.info(`Cap ${MAX_RANKS} rangs max. Décoche-en un d'abord.`);
        return;
      }
      next = [...current, gameId];
    }
    const newPrefs = { ...prefs, ranks: next };
    setPrefs(newPrefs);
    scheduleSave(newPrefs);
  }

  const ranksSelected = prefs.ranks ?? [];
  // URL de la preview story : utilise le slug si dispo, sinon uid legacy.
  // Cache-bust query param forcé à chaque save → le navigateur re-fetch.
  const previewSlug = user.slug || user.uid;
  const previewUrl = `/api/og/profile/${previewSlug}/story?_=${previewCacheBust}`;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div>
        <h2 className="t-heading" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Share2 size={20} className="text-[var(--s-gold)]" />
          <span>Carte de partage</span>
        </h2>
        <p className="t-body text-[var(--s-text-dim)]" style={{ marginTop: 6 }}>
          Personnalise ce qui apparait quand tu partages ton profil sur Discord, Twitter, Instagram (story), etc.
        </p>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1fr) 240px',
          gap: 32,
          alignItems: 'start',
        }}
        className="sharing-section-grid"
      >
        {/* Colonne formulaire */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
          <section className="panel bevel">
            <div className="panel-header">
              <div className="t-sub">Rangs à afficher (max {MAX_RANKS})</div>
              <div className="t-body text-[var(--s-text-dim)]" style={{ marginTop: 4 }}>
                Coche les rangs que tu veux voir sur ta carte de partage. Tu peux en choisir 0, 1 ou {MAX_RANKS}.
              </div>
            </div>
            <div className="panel-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {rankableGames.length === 0 && (
                <div className="t-body text-[var(--s-text-dim)]">
                  Aucun jeu avec rang supporté pour l'instant.
                </div>
              )}
              {rankableGames.map(game => {
                const checked = ranksSelected.includes(game.id);
                const hasRank = hasRankForGame(user, game.id);
                const disabled = !hasRank;
                return (
                  <label
                    key={game.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 14,
                      padding: '10px 14px',
                      background: checked ? 'rgba(255,184,0,0.06)' : 'var(--s-elevated)',
                      border: `1px solid ${checked ? 'rgba(255,184,0,0.35)' : 'var(--s-border)'}`,
                      cursor: disabled ? 'not-allowed' : 'pointer',
                      opacity: disabled ? 0.5 : 1,
                      transition: 'background .15s, border-color .15s',
                    }}
                    className="bevel-sm"
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={disabled}
                      onChange={() => toggleRank(game.id)}
                      style={{ accentColor: 'var(--s-gold)', width: 16, height: 16 }}
                    />
                    {game.logoUrl && (
                      <Image
                        src={game.logoUrl}
                        alt=""
                        width={28}
                        height={28}
                        style={{ objectFit: 'contain' }}
                      />
                    )}
                    <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
                      <div className="t-body" style={{ fontWeight: 600 }}>{game.label}</div>
                      {disabled && (
                        <div className="t-body text-[var(--s-text-dim)]" style={{ fontSize: 12 }}>
                          Pas de rang renseigné — va dans <strong>Mes jeux</strong> pour l'ajouter.
                        </div>
                      )}
                      {!disabled && checked && (
                        <div className="t-body" style={{ fontSize: 12, color: 'var(--s-gold)' }}>
                          Affiché sur la carte
                        </div>
                      )}
                    </div>
                  </label>
                );
              })}
            </div>
          </section>

          <section
            className="panel bevel"
            style={{ opacity: 0.5, pointerEvents: 'none' }}
            title="Bientôt disponible"
          >
            <div className="panel-header">
              <div className="t-sub" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Lock size={14} className="text-[var(--s-text-dim)]" />
                <span>Structure et équipe (bientôt)</span>
              </div>
              <div className="t-body text-[var(--s-text-dim)]" style={{ marginTop: 4 }}>
                Bientôt tu pourras choisir d'afficher ta structure et ton équipe sur ta carte de partage.
              </div>
            </div>
          </section>

          {saving && (
            <div className="t-body text-[var(--s-text-dim)]" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Loader2 size={14} className="animate-spin" />
              <span>Sauvegarde en cours…</span>
            </div>
          )}
          {!saving && lastSavedRef.current !== JSON.stringify({}) && (
            <div className="t-body text-[var(--s-text-dim)]" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <CheckCircle2 size={14} className="text-[var(--s-gold)]" />
              <span>Préférences enregistrées automatiquement</span>
            </div>
          )}
        </div>

        {/* Colonne preview */}
        <aside style={{ position: 'sticky', top: 80, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div className="t-label text-[var(--s-text-dim)]">Aperçu story</div>
          <div
            className="bevel-sm"
            style={{
              width: 240,
              aspectRatio: '9/16',
              background: 'var(--s-elevated)',
              border: '1px solid var(--s-border)',
              overflow: 'hidden',
              position: 'relative',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={previewUrl}
              alt="Aperçu de la carte de partage story"
              style={{ width: '100%', height: '100%', objectFit: 'contain' }}
              onLoad={() => {
                // l'img est chargée, on pourrait masquer un skeleton ici
              }}
            />
            {saving && (
              <div
                style={{
                  position: 'absolute',
                  inset: 0,
                  background: 'rgba(10,10,15,0.55)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'var(--s-text)',
                }}
              >
                <Loader2 size={24} className="animate-spin" />
              </div>
            )}
          </div>
          <a
            href={previewUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="t-body text-[var(--s-text-dim)] hover:text-[var(--s-gold)] transition-colors"
            style={{ fontSize: 12 }}
          >
            Voir en grand →
          </a>
        </aside>
      </div>

      <style jsx>{`
        @media (max-width: 720px) {
          :global(.sharing-section-grid) {
            grid-template-columns: 1fr !important;
          }
        }
      `}</style>
    </div>
  );
}
