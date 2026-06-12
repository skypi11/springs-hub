'use client';

/**
 * ShareBannerButton — bouton de téléchargement d'une bannière OG 1200×630.
 *
 * Twin de ShareStoryButton (1080×1920 story) mais pour le format paysage,
 * pratique pour partager sur Twitter/X, Facebook, comme thumbnail YouTube,
 * en signature email, dans un Discord serveur communautaire, etc.
 *
 * Comportement identique à ShareStoryButton :
 * 1. Click → fetch de l'endpoint OG `/banner` avec cache-bust dynamique
 *    (`?_=<timestamp>`) pour bypass cache navigateur + CDN, et `cache: 'no-store'`.
 * 2. Réponse → Blob → URL.createObjectURL → invisible <a download> cliqué
 *    programmatiquement pour afficher un état loading et gérer les erreurs.
 * 3. Toast feedback "Bannière prête" ou "Impossible de générer".
 *
 * Fallback : navigation directe vers l'endpoint si fetch+blob échoue (le
 * serveur retourne Content-Disposition: attachment, le navigateur télécharge).
 *
 * À utiliser en duo avec ShareStoryButton sur les pages publiques (profil
 * joueur, page structure) pour proposer les 2 formats côte à côte.
 */

import { useCallback, useMemo, useState } from 'react';
import { Image as ImageIcon, Loader2 } from 'lucide-react';
import { useToast } from '@/components/ui/Toast';

type ShareSize = 'sm' | 'md' | 'lg';
type ShareVariant = 'primary' | 'ghost';

export interface ShareBannerButtonProps {
  /** URL relative ou absolue de l'endpoint OG banner (ex: /api/og/profile/noxx/banner). */
  bannerUrl: string;
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

export default function ShareBannerButton({
  bannerUrl,
  filename,
  size = 'md',
  variant = 'ghost',
  label = 'Bannière',
}: ShareBannerButtonProps) {
  const toast = useToast();
  const [loading, setLoading] = useState(false);

  const tokens = SIZE_TOKENS[size];

  const handleClick = useCallback(async () => {
    if (loading) return;
    setLoading(true);
    try {
      // Cache-bust dynamique pour bypass cache navigateur + CDN — voir
      // ShareStoryButton pour le rationale détaillé (en bref : un user qui
      // re-clique veut toujours la dernière version, et un correctif visuel
      // doit être visible immédiatement sans attendre l'expiration CDN).
      const cacheBust = Date.now();
      const sep = bannerUrl.includes('?') ? '&' : '?';
      const freshUrl = `${bannerUrl}${sep}_=${cacheBust}`;
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
        toast.success('Bannière prête');
      } finally {
        setTimeout(() => URL.revokeObjectURL(objectUrl), 1500);
      }
    } catch (err) {
      console.warn('[ShareBannerButton] fetch+blob failed, fallback navigation', err);
      try {
        window.location.href = bannerUrl;
        toast.info('Téléchargement en cours…');
      } catch {
        toast.error('Impossible de générer la bannière');
      }
    } finally {
      setLoading(false);
    }
  }, [bannerUrl, filename, loading, toast]);

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
      aria-label={loading ? 'Génération de la bannière en cours' : 'Télécharger une bannière 1200×630 pour Twitter/Facebook/YouTube'}
      title="Télécharger une bannière 1200×630 (Twitter, Facebook, YouTube thumbnail)"
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
        <ImageIcon size={tokens.iconSize} aria-hidden="true" />
      )}
      <span>{loading ? 'Génération…' : label}</span>
    </button>
  );
}
