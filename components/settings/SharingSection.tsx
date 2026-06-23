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
import { CheckCircle2, Loader2, Share2, Shield, Users as UsersIcon } from 'lucide-react';
import { api } from '@/lib/api-client';
import { useToast } from '@/components/ui/Toast';
import { ALL_GAME_DEFS, gameHasFeature, getGame, getGameLabel } from '@/lib/games-registry';
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
  // Valorant : seul un rang vérifié (sync auto HenrikDev) compte, pas un rang
  // déclaré legacy — cohérent avec l'affichage OG (buildHeroRankForGame).
  if (gameId === 'valorant') return user.valorantRankSource === 'henrikdev' && !!user.valorantRank?.trim();
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
          // Cast vers Record<string,unknown> requis par la signature de api().
          // OgDisplayPreferences est une interface stricte sans index signature,
          // incompatible avec JsonBody = Record<string, unknown>. Le spread
          // dans un object literal serait aussi possible mais le cast est plus clair.
          body: newPrefs as unknown as Record<string, unknown>,
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

  function updatePref<K extends keyof OgDisplayPreferences>(key: K, value: OgDisplayPreferences[K]) {
    const newPrefs = { ...prefs, [key]: value };
    setPrefs(newPrefs);
    scheduleSave(newPrefs);
  }

  // Liste des jeux où l'user a une structure (pour le picker primaryGameForStructure).
  // Lit `structurePerGame` (format mixte string | string[]) et filtre les entrées vides.
  const gameIdsWithStructure = useMemo(() => {
    const struct = user.structurePerGame ?? {};
    return Object.keys(struct).filter(g => {
      const v = struct[g as keyof typeof struct];
      return Array.isArray(v) ? v.length > 0 : !!v;
    });
  }, [user.structurePerGame]);

  // Defaults pour les toggles : true si non défini (cohérent avec server-side).
  const showStructure = prefs.showStructure !== false;
  const showTeam = prefs.showTeam !== false;

  const ranksSelected = prefs.ranks ?? [];
  // URLs de preview : story (1080×1920) + bannière (1200×630). Slug si dispo,
  // sinon uid legacy. Cache-bust query param forcé à chaque save → re-fetch.
  // `preview=1` sur la story → bypass le Content-Disposition: attachment
  // côté server pour permettre l'affichage inline dans le navigateur (sinon
  // le clic "Voir en grand" déclenche un download au lieu d'ouvrir l'image).
  const previewSlug = user.slug || user.uid;
  const previewStoryUrl = `/api/og/profile/${previewSlug}/story?preview=1&_=${previewCacheBust}`;
  const previewBannerUrl = `/api/og/profile/${previewSlug}?_=${previewCacheBust}`;

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
                  Aucun jeu avec rang supporté pour l&apos;instant.
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
                          Pas de rang renseigné. Va dans <strong>Mes jeux</strong> pour l&apos;ajouter.
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

          {/* Section Structure + Équipe (shippée 30/05). Affichée seulement
              si l'user a au moins une structure. Sinon, on affiche un message
              d'explication (pas de structure → rien à toggler). */}
          <section className="panel bevel">
            <div className="panel-header">
              <div className="t-sub">Structure et équipe</div>
              <div className="t-body text-[var(--s-text-dim)]" style={{ marginTop: 4 }}>
                Affiche ta structure et ton équipe (selon le jeu choisi) sur ta carte de partage.
              </div>
            </div>
            <div className="panel-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {gameIdsWithStructure.length === 0 ? (
                <div className="t-body text-[var(--s-text-dim)]">
                  Tu n&apos;es membre d&apos;aucune structure pour l&apos;instant. Rien à afficher sur la carte.
                </div>
              ) : (
                <>
                  {/* Toggle structure */}
                  <label
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 14,
                      padding: '10px 14px',
                      background: showStructure ? 'rgba(255,184,0,0.06)' : 'var(--s-elevated)',
                      border: `1px solid ${showStructure ? 'rgba(255,184,0,0.35)' : 'var(--s-border)'}`,
                      cursor: 'pointer',
                      transition: 'background .15s, border-color .15s',
                    }}
                    className="bevel-sm"
                  >
                    <input
                      type="checkbox"
                      checked={showStructure}
                      onChange={e => updatePref('showStructure', e.target.checked)}
                      style={{ accentColor: 'var(--s-gold)', width: 16, height: 16 }}
                    />
                    <Shield size={18} className="text-[var(--s-gold)]" />
                    <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
                      <div className="t-body" style={{ fontWeight: 600 }}>Afficher ma structure</div>
                      <div className="t-body text-[var(--s-text-dim)]" style={{ fontSize: 12 }}>
                        Logo + tag + nom de la structure sur la carte
                      </div>
                    </div>
                  </label>

                  {/* Toggle équipe */}
                  <label
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 14,
                      padding: '10px 14px',
                      background: showTeam ? 'rgba(255,184,0,0.06)' : 'var(--s-elevated)',
                      border: `1px solid ${showTeam ? 'rgba(255,184,0,0.35)' : 'var(--s-border)'}`,
                      cursor: showStructure ? 'pointer' : 'not-allowed',
                      opacity: showStructure ? 1 : 0.5,
                      transition: 'background .15s, border-color .15s, opacity .15s',
                    }}
                    className="bevel-sm"
                  >
                    <input
                      type="checkbox"
                      checked={showTeam}
                      disabled={!showStructure}
                      onChange={e => updatePref('showTeam', e.target.checked)}
                      style={{ accentColor: 'var(--s-gold)', width: 16, height: 16 }}
                    />
                    <UsersIcon size={18} className="text-[var(--s-gold)]" />
                    <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
                      <div className="t-body" style={{ fontWeight: 600 }}>Afficher mon équipe</div>
                      <div className="t-body text-[var(--s-text-dim)]" style={{ fontSize: 12 }}>
                        Nom de ton équipe dans la structure (si tu es titulaire/remplaçant/staff)
                      </div>
                    </div>
                  </label>

                  {/* Picker jeu si l'user a des structures dans 2+ jeux différents.
                      Permet de choisir QUELLE structure afficher (sinon prend la première). */}
                  {gameIdsWithStructure.length >= 2 && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      <label className="t-label">Jeu principal (quelle structure afficher)</label>
                      <select
                        className="settings-input w-full"
                        value={prefs.primaryGameForStructure ?? ''}
                        onChange={e => updatePref(
                          'primaryGameForStructure',
                          e.target.value === '' ? null : e.target.value,
                        )}
                        style={{ fontSize: 13 }}
                      >
                        <option value="">Auto (premier jeu pratiqué)</option>
                        {gameIdsWithStructure.map(gid => (
                          <option key={gid} value={gid}>
                            {getGame(gid)?.label ?? getGameLabel(gid)}
                          </option>
                        ))}
                      </select>
                      <div className="t-body text-[var(--s-text-dim)]" style={{ fontSize: 12 }}>
                        Tu es dans plusieurs structures (1 par jeu max). Choisis laquelle apparait sur la carte.
                      </div>
                    </div>
                  )}
                </>
              )}
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

        {/* Colonne preview — 2 formats : story portrait + bannière paysage.
            Les 2 reflètent les mêmes préférences (rangs choisis appliqués
            aux 2 formats côté server). */}
        <aside style={{ position: 'sticky', top: 80, display: 'flex', flexDirection: 'column', gap: 20 }}>
          {/* Preview story 1080×1920 (9:16) */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div className="t-label text-[var(--s-text-dim)]">Aperçu story (9:16)</div>
            <div
              className="bevel-sm"
              style={{
                width: 220,
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
                src={previewStoryUrl}
                alt="Aperçu de la carte de partage story"
                style={{ width: '100%', height: '100%', objectFit: 'contain' }}
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
                  }}
                >
                  <Loader2 size={22} className="animate-spin text-[var(--s-text)]" />
                </div>
              )}
            </div>
            <a
              href={previewStoryUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[var(--s-text-dim)] hover:text-[var(--s-gold)] transition-colors"
              style={{ fontSize: 12 }}
            >
              Voir en grand →
            </a>
          </div>

          {/* Preview bannière 1200×630 (~1.9:1) */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div className="t-label text-[var(--s-text-dim)]">Aperçu bannière (1200×630)</div>
            <div
              className="bevel-sm"
              style={{
                width: 240,
                aspectRatio: '1200/630',
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
                src={previewBannerUrl}
                alt="Aperçu de la bannière paysage"
                style={{ width: '100%', height: '100%', objectFit: 'contain' }}
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
                  }}
                >
                  <Loader2 size={20} className="animate-spin text-[var(--s-text)]" />
                </div>
              )}
            </div>
            <a
              href={previewBannerUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[var(--s-text-dim)] hover:text-[var(--s-gold)] transition-colors"
              style={{ fontSize: 12 }}
            >
              Voir en grand →
            </a>
          </div>
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
