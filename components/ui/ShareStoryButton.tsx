'use client';

/**
 * ShareStoryButton — bouton de téléchargement d'une image format story
 * (1080×1920) prête à uploader sur Instagram/TikTok/Snapchat.
 *
 * Comportement :
 * 1. Click → fetch de l'endpoint OG vertical (qui renvoie un PNG avec
 *    Content-Disposition: attachment + Cache-Control 1h).
 * 2. Réponse → Blob → URL.createObjectURL → invisible <a download> cliqué
 *    programmatiquement. Permet d'afficher un état loading pendant le fetch
 *    et de gérer les erreurs proprement (toast).
 * 3. Toast feedback : "Téléchargement…" → "Image prête à poster en story"
 *    ou "Impossible de générer l'image" en cas d'erreur.
 *
 * Fallback si fetch+blob échoue (CORS, navigateur ancien) :
 * window.location.href = storyUrl → le navigateur télécharge grâce au header
 * Content-Disposition côté serveur. Moins d'UX (pas de loading), mais ça marche.
 *
 * DA Aedral : bevel-sm, tokens couleurs, fontSize ≥ 12px, icône Instagram.
 */

import { useCallback, useMemo, useState } from 'react';
import { Smartphone, Loader2 } from 'lucide-react';
import { useToast } from '@/components/ui/Toast';

type ShareSize = 'sm' | 'md' | 'lg';
type ShareVariant = 'primary' | 'ghost';

export interface ShareStoryButtonProps {
  /** URL relative ou absolue de l'endpoint OG story (ex: /api/og/profile/noxx/story). */
  storyUrl: string;
  /** Nom de fichier suggéré au navigateur lors du download. */
  filename: string;
  size?: ShareSize;
  variant?: ShareVariant;
  label?: string;
}

interface SizeTokens {
  paddingY: number;
  paddingX: number;
  fontSize: number;
  iconSize: number;
  gap: number;
}

const SIZE_TOKENS: Record<ShareSize, SizeTokens> = {
  sm: { paddingY: 6, paddingX: 12, fontSize: 12, iconSize: 13, gap: 6 },
  md: { paddingY: 9, paddingX: 16, fontSize: 13, iconSize: 14, gap: 8 },
  lg: { paddingY: 12, paddingX: 22, fontSize: 14, iconSize: 16, gap: 10 },
};

export default function ShareStoryButton({
  storyUrl,
  filename,
  size = 'md',
  variant = 'ghost',
  label = 'Story',
}: ShareStoryButtonProps) {
  const toast = useToast();
  const [loading, setLoading] = useState(false);

  const tokens = SIZE_TOKENS[size];

  const handleClick = useCallback(async () => {
    if (loading) return;
    setLoading(true);
    try {
      // Fetch l'endpoint OG vertical. Le serveur renvoie un PNG avec
      // Content-Disposition: attachment ; on le récupère en blob pour pouvoir
      // déclencher un download nommé proprement côté client.
      //
      // IMPORTANT : on bypass TOUS les caches (browser + CDN Vercel) pour 2 raisons :
      //   1. Un user qui re-clique "Partager en Story" veut toujours la version
      //      la plus fraîche (rang à jour, nouveaux jeux, etc.) — pas la story
      //      qu'il avait téléchargée la semaine dernière.
      //   2. Quand on shippe un correctif visuel sur le rendu de la story (logo
      //      qui change, avatar fixé, etc.), le user doit le voir IMMÉDIATEMENT
      //      sans attendre que le cache CDN expire (1h).
      //
      // Cache-bust dynamique via `?_=<timestamp>` : URL différente à chaque
      // click → bypass cache CDN Vercel + cache navigateur sans casser le
      // cache CDN pour les vieilles URLs (qui n'ont pas le query param).
      const cacheBust = Date.now();
      const sep = storyUrl.includes('?') ? '&' : '?';
      const freshUrl = `${storyUrl}${sep}_=${cacheBust}`;
      const res = await fetch(freshUrl, { cache: 'no-store' });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      try {
        const a = document.createElement('a');
        a.href = objectUrl;
        a.download = filename;
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        toast.success('Image prête à poster en story');
      } finally {
        // Laisse un court délai pour que le navigateur ait amorcé le download
        // avant de révoquer l'URL (sinon Firefox annule parfois).
        setTimeout(() => URL.revokeObjectURL(objectUrl), 1500);
      }
    } catch (err) {
      // Fallback ultime : navigation directe vers l'endpoint, le navigateur
      // téléchargera grâce au header Content-Disposition serveur.
      console.warn('[ShareStoryButton] fetch+blob failed, fallback navigation', err);
      try {
        window.location.href = storyUrl;
        toast.info('Téléchargement en cours…');
      } catch {
        toast.error('Impossible de générer l\'image');
      }
    } finally {
      setLoading(false);
    }
  }, [storyUrl, filename, loading, toast]);

  const triggerStyle = useMemo<React.CSSProperties>(() => {
    const base: React.CSSProperties = {
      display: 'inline-flex',
      alignItems: 'center',
      gap: tokens.gap,
      padding: `${tokens.paddingY}px ${tokens.paddingX}px`,
      fontSize: tokens.fontSize,
      fontWeight: 600,
      lineHeight: 1.2,
      cursor: loading ? 'wait' : 'pointer',
      transition: 'background 0.15s, border-color 0.15s, color 0.15s, opacity 0.15s',
      userSelect: 'none',
      whiteSpace: 'nowrap',
      opacity: loading ? 0.7 : 1,
    };
    if (variant === 'primary') {
      return {
        ...base,
        background: 'var(--s-gold)',
        color: '#0a0a0f',
        border: '1px solid var(--s-gold)',
        textTransform: 'uppercase',
        letterSpacing: '0.04em',
        fontWeight: 700,
      };
    }
    return {
      ...base,
      background: 'transparent',
      color: 'var(--s-text)',
      border: '1px solid var(--s-border)',
    };
  }, [variant, tokens, loading]);

  const hoverHandlers = useMemo(() => {
    if (variant === 'primary') {
      return {
        onMouseEnter: (e: React.MouseEvent<HTMLButtonElement>) => {
          if (loading) return;
          (e.currentTarget as HTMLButtonElement).style.background = '#e6a600';
        },
        onMouseLeave: (e: React.MouseEvent<HTMLButtonElement>) => {
          (e.currentTarget as HTMLButtonElement).style.background = 'var(--s-gold)';
        },
      };
    }
    return {
      onMouseEnter: (e: React.MouseEvent<HTMLButtonElement>) => {
        if (loading) return;
        const el = e.currentTarget as HTMLButtonElement;
        el.style.background = 'rgba(255,255,255,0.04)';
        el.style.borderColor = 'rgba(255,255,255,0.15)';
      },
      onMouseLeave: (e: React.MouseEvent<HTMLButtonElement>) => {
        if (loading) return;
        const el = e.currentTarget as HTMLButtonElement;
        el.style.background = 'transparent';
        el.style.borderColor = 'var(--s-border)';
      },
    };
  }, [variant, loading]);

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={loading}
      aria-label={loading ? 'Génération de l\'image en cours' : 'Télécharger pour partager en story'}
      title="Télécharger une image format story (Instagram/TikTok/Snapchat)"
      className="bevel-sm"
      style={triggerStyle}
      {...hoverHandlers}
    >
      {loading ? (
        <Loader2
          size={tokens.iconSize}
          aria-hidden="true"
          className="animate-spin"
        />
      ) : (
        <Smartphone size={tokens.iconSize} aria-hidden="true" />
      )}
      <span>{loading ? 'Génération…' : label}</span>
    </button>
  );
}
