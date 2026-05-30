'use client';

/**
 * ShareButton — composant universel de partage d'URL.
 *
 * Comportement hybride mobile / desktop :
 * - Mobile (UA tablet/phone + navigator.share) → menu natif OS direct au clic.
 *   Le sheet natif iOS/Android est meilleur que notre popover (partage direct
 *   vers les apps installées : Discord, WhatsApp, Messages, etc.). Fallback
 *   popover Aedral si navigator.share absent ou erreur non-AbortError.
 * - Desktop → popover Aedral d'abord (UX cohérente avec la DA), avec un bouton
 *   "Plus d'options…" en bas qui déclenche navigator.share() pour ceux qui
 *   préfèrent partager via leur Discord/Teams/etc. desktop installé.
 *
 * Popover :
 *   1. Copier le lien (clipboard)
 *   2. Copier pour Discord (message formaté copié, label + icône info pour
 *      expliquer pourquoi on copie au lieu de partager direct)
 *   3. Twitter/X, WhatsApp, Reddit (intent URLs ouvertes dans un nouvel onglet)
 *   4. (Desktop uniquement, si navigator.share dispo) "Plus d'options…"
 *
 * Accessibilité :
 * - aria-haspopup, aria-expanded sur le trigger
 * - role="dialog" + aria-modal sur le popover
 * - focus auto sur le 1er item à l'ouverture, Tab cycle (focus trap basique)
 * - Escape ferme, click outside ferme
 *
 * DA Aedral : bevel-sm, tokens couleurs, fontSize >= 12px, jamais d'arrondis.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Share2, Copy, Check, ExternalLink, X, MoreHorizontal, Info } from 'lucide-react';
import Portal from '@/components/ui/Portal';
import { useToast } from '@/components/ui/Toast';

type ShareSize = 'sm' | 'md' | 'lg';
type ShareVariant = 'primary' | 'ghost';

export interface ShareButtonProps {
  url: string;
  title: string;
  text?: string;
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

/** Navigator.userAgentData (Client Hints API moderne, Chromium uniquement). */
interface UserAgentData {
  mobile: boolean;
}
interface NavigatorWithUAData extends Navigator {
  userAgentData?: UserAgentData;
}

/** Détection runtime côté client uniquement — évite mismatch SSR. */
function hasNativeShare(): boolean {
  if (typeof navigator === 'undefined') return false;
  return typeof navigator.share === 'function';
}

/** Vérifie qu'on est sur le client + clipboard dispo (https/localhost requis). */
function hasClipboard(): boolean {
  if (typeof navigator === 'undefined') return false;
  return !!navigator.clipboard && typeof navigator.clipboard.writeText === 'function';
}

/**
 * Détecte si on est sur un device mobile (phone/tablet).
 * Priorité à userAgentData.mobile (Client Hints, plus fiable), fallback regex UA.
 * À appeler uniquement côté client (dans useEffect) pour éviter mismatch SSR.
 */
function detectIsMobile(): boolean {
  if (typeof navigator === 'undefined') return false;
  const nav = navigator as NavigatorWithUAData;
  if (nav.userAgentData && typeof nav.userAgentData.mobile === 'boolean') {
    return nav.userAgentData.mobile;
  }
  return /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
}

export default function ShareButton({
  url,
  title,
  text,
  size = 'md',
  variant = 'ghost',
  label = 'Partager',
}: ShareButtonProps) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [rect, setRect] = useState<{ top: number; right: number } | null>(null);
  const [copied, setCopied] = useState(false);

  // Détection device : false par défaut (SSR-safe), recalculé après mount.
  // On dérive aussi la dispo native share côté client.
  const [isMobile, setIsMobile] = useState(false);
  const [nativeShareAvailable, setNativeShareAvailable] = useState(false);

  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  const tokens = SIZE_TOKENS[size];

  useEffect(() => {
    setIsMobile(detectIsMobile());
    setNativeShareAvailable(hasNativeShare());
  }, []);

  /** Tente le partage natif. Retourne true si succès OU annulé silencieusement. */
  const tryNativeShare = useCallback(async (): Promise<boolean> => {
    if (!hasNativeShare()) return false;
    try {
      await navigator.share({ title, text, url });
      // Pas de toast "Partagé" : le sheet natif a déjà donné le feedback visuel,
      // et un toast au-dessus du sheet est redondant + parfois invisible.
      return true;
    } catch (err) {
      // AbortError = user a fermé le sheet natif → silent, ne pas fallback.
      if (err instanceof Error && err.name === 'AbortError') return true;
      // Autres erreurs (NotAllowedError, etc.) → on bascule sur le popover.
      return false;
    }
  }, [title, text, url]);

  /** Ouverture du popover positionné sous le trigger. */
  const openPopover = useCallback(() => {
    const btn = triggerRef.current;
    if (!btn) return;
    const r = btn.getBoundingClientRect();
    setRect({
      top: r.bottom + 6,
      right: Math.max(8, window.innerWidth - r.right),
    });
    setOpen(true);
  }, []);

  const closePopover = useCallback(() => {
    setOpen(false);
    setRect(null);
  }, []);

  const handleTriggerClick = useCallback(async () => {
    if (open) {
      closePopover();
      return;
    }
    // Mobile : on tente le sheet natif directement. Si échec (hors abort) → popover.
    if (isMobile) {
      const handled = await tryNativeShare();
      if (!handled) openPopover();
      return;
    }
    // Desktop : popover Aedral d'abord (DA cohérente), navigator.share réservé
    // au bouton "Plus d'options…" en bas du popover pour ceux qui le veulent.
    openPopover();
  }, [open, isMobile, tryNativeShare, openPopover, closePopover]);

  /** Bouton "Plus d'options…" desktop → ferme le popover et ouvre le sheet OS natif. */
  const handleMoreOptions = useCallback(async () => {
    closePopover();
    await tryNativeShare();
  }, [closePopover, tryNativeShare]);

  /** Copie une chaîne dans le presse-papier avec fallback execCommand. */
  const writeToClipboard = useCallback(async (value: string): Promise<boolean> => {
    if (hasClipboard()) {
      try {
        await navigator.clipboard.writeText(value);
        return true;
      } catch {
        // tombe sur le fallback
      }
    }
    // Fallback : textarea + execCommand (vieux navigateurs / contextes non-https)
    try {
      const ta = document.createElement('textarea');
      ta.value = value;
      ta.setAttribute('readonly', '');
      ta.style.position = 'absolute';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  }, []);

  const handleCopyLink = useCallback(async () => {
    const ok = await writeToClipboard(url);
    if (ok) {
      setCopied(true);
      toast.success('Lien copié');
      setTimeout(() => setCopied(false), 1500);
      // On ferme légèrement après pour laisser voir l'état "copié"
      setTimeout(closePopover, 600);
    } else {
      toast.error('Impossible de copier le lien');
    }
  }, [url, writeToClipboard, toast, closePopover]);

  const handleCopyDiscord = useCallback(async () => {
    const msg = `${title}\n${url}`;
    const ok = await writeToClipboard(msg);
    if (ok) {
      toast.success('Message Discord copié, colle-le dans ton serveur');
      setTimeout(closePopover, 600);
    } else {
      toast.error('Impossible de copier le message');
    }
  }, [title, url, writeToClipboard, toast, closePopover]);

  /** Construit les URLs d'intent réseaux sociaux. */
  const intentUrls = useMemo(() => {
    const encUrl = encodeURIComponent(url);
    const encTitle = encodeURIComponent(title);
    const tweetText = encodeURIComponent(text ? `${title} — ${text}` : title);
    const waText = encodeURIComponent(text ? `${title}\n${text}\n${url}` : `${title}\n${url}`);
    return {
      twitter: `https://twitter.com/intent/tweet?url=${encUrl}&text=${tweetText}`,
      whatsapp: `https://wa.me/?text=${waText}`,
      reddit: `https://www.reddit.com/submit?url=${encUrl}&title=${encTitle}`,
    };
  }, [url, title, text]);

  const openInNewTab = useCallback((href: string) => {
    window.open(href, '_blank', 'noopener,noreferrer');
    setTimeout(closePopover, 200);
  }, [closePopover]);

  // ── Effets : focus initial, escape, click outside, scroll/resize, focus trap ──
  useEffect(() => {
    if (!open) return;

    // Focus 1er item du popover (raf pour laisser le DOM mounted)
    const raf = requestAnimationFrame(() => {
      const first = popoverRef.current?.querySelector<HTMLElement>('[data-share-item]');
      first?.focus();
    });

    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        closePopover();
        triggerRef.current?.focus();
        return;
      }
      if (e.key === 'Tab') {
        // Focus trap basique : on cycle entre les items du popover
        const items = popoverRef.current?.querySelectorAll<HTMLElement>('[data-share-item]');
        if (!items || items.length === 0) return;
        const list = Array.from(items);
        const active = document.activeElement as HTMLElement | null;
        const idx = active ? list.indexOf(active) : -1;
        e.preventDefault();
        let next: number;
        if (e.shiftKey) {
          next = idx <= 0 ? list.length - 1 : idx - 1;
        } else {
          next = idx === -1 || idx === list.length - 1 ? 0 : idx + 1;
        }
        list[next]?.focus();
      }
    }

    function onScrollOrResize() {
      closePopover();
    }

    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onScrollOrResize, true);
    window.addEventListener('resize', onScrollOrResize);

    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onScrollOrResize, true);
      window.removeEventListener('resize', onScrollOrResize);
    };
  }, [open, closePopover]);

  // ── Styles du trigger selon variant/size ──
  const triggerStyle = useMemo<React.CSSProperties>(() => {
    const base: React.CSSProperties = {
      display: 'inline-flex',
      alignItems: 'center',
      gap: tokens.gap,
      padding: `${tokens.paddingY}px ${tokens.paddingX}px`,
      fontSize: tokens.fontSize,
      fontWeight: 600,
      lineHeight: 1.2,
      cursor: 'pointer',
      transition: 'background 0.15s, border-color 0.15s, color 0.15s',
      userSelect: 'none',
      whiteSpace: 'nowrap',
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
    // ghost
    return {
      ...base,
      background: open ? 'var(--s-hover)' : 'transparent',
      color: 'var(--s-text)',
      border: `1px solid ${open ? 'rgba(255,255,255,0.18)' : 'var(--s-border)'}`,
    };
  }, [variant, tokens, open]);

  const triggerHoverHandlers = useMemo(() => {
    if (variant === 'primary') {
      return {
        onMouseEnter: (e: React.MouseEvent<HTMLButtonElement>) => {
          (e.currentTarget as HTMLButtonElement).style.background = '#e6a600';
        },
        onMouseLeave: (e: React.MouseEvent<HTMLButtonElement>) => {
          (e.currentTarget as HTMLButtonElement).style.background = 'var(--s-gold)';
        },
      };
    }
    return {
      onMouseEnter: (e: React.MouseEvent<HTMLButtonElement>) => {
        if (open) return;
        const el = e.currentTarget as HTMLButtonElement;
        el.style.background = 'rgba(255,255,255,0.04)';
        el.style.borderColor = 'rgba(255,255,255,0.15)';
      },
      onMouseLeave: (e: React.MouseEvent<HTMLButtonElement>) => {
        if (open) return;
        const el = e.currentTarget as HTMLButtonElement;
        el.style.background = 'transparent';
        el.style.borderColor = 'var(--s-border)';
      },
    };
  }, [variant, open]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={handleTriggerClick}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={label}
        title={label}
        className="bevel-sm"
        style={triggerStyle}
        {...triggerHoverHandlers}
      >
        <Share2 size={tokens.iconSize} aria-hidden="true" />
        <span>{label}</span>
      </button>

      {open && rect && (
        <Portal>
          {/* Overlay click-outside */}
          <div
            className="fixed inset-0"
            style={{ zIndex: 70 }}
            onClick={closePopover}
            aria-hidden="true"
          />
          <div
            ref={popoverRef}
            role="dialog"
            aria-modal="true"
            aria-label={label}
            className="fixed animate-fade-in bevel-sm"
            style={{
              top: rect.top,
              right: rect.right,
              zIndex: 71,
              minWidth: 260,
              maxWidth: 'calc(100vw - 2rem)',
              background: 'var(--s-surface)',
              border: '1px solid var(--s-border)',
              boxShadow: '0 12px 32px rgba(0,0,0,0.45)',
              padding: 6,
            }}
          >
            {/* Header */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '6px 8px 8px 8px',
                borderBottom: '1px solid var(--s-border)',
                marginBottom: 6,
              }}
            >
              <span
                style={{
                  fontSize: 12,
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  letterSpacing: '0.08em',
                  color: 'var(--s-text-dim)',
                }}
              >
                Partager
              </span>
              <button
                type="button"
                onClick={closePopover}
                aria-label="Fermer"
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--s-text-muted)',
                  cursor: 'pointer',
                  padding: 2,
                  lineHeight: 0,
                }}
              >
                <X size={14} aria-hidden="true" />
              </button>
            </div>

            {/* Items */}
            <ShareItem
              icon={copied ? <Check size={14} style={{ color: 'var(--s-gold)' }} /> : <Copy size={14} />}
              label={copied ? 'Copié !' : 'Copier le lien'}
              onClick={handleCopyLink}
              accent={copied}
            />
            <ShareItem
              icon={<DiscordGlyph />}
              label="Copier pour Discord"
              sublabel="Discord n'a pas de partage direct — colle le message dans ton serveur"
              infoTooltip
              onClick={handleCopyDiscord}
            />

            <div
              style={{
                height: 1,
                background: 'var(--s-border)',
                margin: '6px 0',
              }}
            />

            <ShareItem
              icon={<XLogoGlyph />}
              label="Twitter / X"
              external
              onClick={() => openInNewTab(intentUrls.twitter)}
            />
            <ShareItem
              icon={<WhatsAppGlyph />}
              label="WhatsApp"
              external
              onClick={() => openInNewTab(intentUrls.whatsapp)}
            />
            <ShareItem
              icon={<RedditGlyph />}
              label="Reddit"
              external
              onClick={() => openInNewTab(intentUrls.reddit)}
            />

            {/* "Plus d'options…" desktop uniquement (mobile a déjà ouvert le sheet natif).
                Affiché si navigator.share est dispo (Chromium desktop récent, Safari, Edge). */}
            {!isMobile && nativeShareAvailable && (
              <>
                <div
                  style={{
                    height: 1,
                    background: 'var(--s-border)',
                    margin: '6px 0',
                  }}
                />
                <ShareItem
                  icon={<MoreHorizontal size={14} />}
                  label="Plus d'options…"
                  sublabel="Ouvrir le partage système (Discord installé, Teams…)"
                  onClick={handleMoreOptions}
                />
              </>
            )}
          </div>
        </Portal>
      )}
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────────────────

interface ShareItemProps {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  hint?: string;
  sublabel?: string;
  accent?: boolean;
  external?: boolean;
  infoTooltip?: boolean;
}

function ShareItem({ icon, label, onClick, hint, sublabel, accent, external, infoTooltip }: ShareItemProps) {
  return (
    <button
      type="button"
      data-share-item
      onClick={onClick}
      title={sublabel}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        width: '100%',
        padding: '9px 10px',
        background: 'transparent',
        border: 'none',
        cursor: 'pointer',
        textAlign: 'left',
        fontSize: 13,
        color: accent ? 'var(--s-gold)' : 'var(--s-text)',
        transition: 'background 0.15s',
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLButtonElement).style.background = 'var(--s-hover)';
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLButtonElement).style.background = 'transparent';
      }}
      onFocus={(e) => {
        (e.currentTarget as HTMLButtonElement).style.background = 'var(--s-hover)';
      }}
      onBlur={(e) => {
        (e.currentTarget as HTMLButtonElement).style.background = 'transparent';
      }}
    >
      <span
        style={{
          width: 22,
          height: 22,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
          color: accent ? 'var(--s-gold)' : 'var(--s-text-dim)',
        }}
      >
        {icon}
      </span>
      <span style={{ flex: 1, fontWeight: 500, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        {label}
        {infoTooltip && (
          <Info
            size={12}
            aria-hidden="true"
            style={{ color: 'var(--s-text-muted)', flexShrink: 0 }}
          />
        )}
      </span>
      {hint && (
        <span style={{ fontSize: 12, color: 'var(--s-text-muted)' }}>{hint}</span>
      )}
      {external && (
        <ExternalLink size={12} style={{ color: 'var(--s-text-muted)', flexShrink: 0 }} aria-hidden="true" />
      )}
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Brand glyphs (SVG inline, no external dep). Couleur via currentColor.
// ─────────────────────────────────────────────────────────────────────────────

function DiscordGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M20.317 4.369A19.79 19.79 0 0 0 16.558 3.2a.07.07 0 0 0-.073.035c-.211.375-.444.864-.608 1.249a18.27 18.27 0 0 0-5.487 0 12.51 12.51 0 0 0-.617-1.249.073.073 0 0 0-.073-.035c-1.276.222-2.51.614-3.76 1.169a.066.066 0 0 0-.03.027C2.39 8.045 1.733 11.63 2.056 15.17a.082.082 0 0 0 .031.056 19.9 19.9 0 0 0 5.993 3.03.073.073 0 0 0 .079-.026 14.2 14.2 0 0 0 1.226-1.994.072.072 0 0 0-.04-.1 13.1 13.1 0 0 1-1.873-.892.073.073 0 0 1-.008-.121c.126-.094.252-.192.372-.291a.07.07 0 0 1 .073-.01c3.928 1.793 8.18 1.793 12.061 0a.07.07 0 0 1 .074.009c.12.099.246.198.373.292a.073.073 0 0 1-.006.121c-.598.349-1.221.645-1.873.891a.073.073 0 0 0-.04.101c.36.698.772 1.362 1.225 1.993a.072.072 0 0 0 .079.027 19.84 19.84 0 0 0 6.002-3.03.073.073 0 0 0 .032-.054c.5-4.087-.838-7.643-3.548-10.775a.058.058 0 0 0-.03-.028zM8.02 13.04c-1.183 0-2.157-1.085-2.157-2.418 0-1.333.955-2.418 2.157-2.418 1.21 0 2.176 1.095 2.157 2.418 0 1.333-.955 2.418-2.157 2.418zm7.974 0c-1.183 0-2.157-1.085-2.157-2.418 0-1.333.955-2.418 2.157-2.418 1.21 0 2.176 1.095 2.157 2.418 0 1.333-.946 2.418-2.157 2.418z" />
    </svg>
  );
}

function XLogoGlyph() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}

function WhatsAppGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.83 9.83 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.81 11.81 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.88 11.88 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893A11.82 11.82 0 0 0 20.464 3.488" />
    </svg>
  );
}

function RedditGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.01 4.744c.688 0 1.25.561 1.25 1.249a1.25 1.25 0 0 1-2.498.056l-2.597-.547-.8 3.747c1.824.07 3.48.632 4.674 1.488.308-.309.73-.491 1.207-.491.968 0 1.754.786 1.754 1.754 0 .716-.435 1.333-1.01 1.614a3.111 3.111 0 0 1 .042.52c0 2.694-3.13 4.87-7.004 4.87-3.874 0-7.004-2.176-7.004-4.87 0-.183.015-.366.043-.534A1.748 1.748 0 0 1 4.028 12c0-.968.786-1.754 1.754-1.754.463 0 .898.196 1.207.49 1.207-.883 2.878-1.43 4.744-1.487l.885-4.182a.342.342 0 0 1 .14-.197.35.35 0 0 1 .238-.042l2.906.617a1.214 1.214 0 0 1 1.108-.701zM9.25 12C8.561 12 8 12.562 8 13.25c0 .687.561 1.248 1.25 1.248.687 0 1.248-.561 1.248-1.249 0-.688-.561-1.249-1.249-1.249zm5.5 0c-.687 0-1.248.561-1.248 1.25 0 .687.561 1.248 1.249 1.248.688 0 1.249-.561 1.249-1.249 0-.687-.562-1.249-1.25-1.249zm-5.466 3.99a.327.327 0 0 0-.231.094.33.33 0 0 0 0 .463c.842.842 2.484.913 2.961.913.477 0 2.105-.056 2.961-.913a.361.361 0 0 0 .029-.463.33.33 0 0 0-.464 0c-.547.533-1.684.73-2.512.73-.828 0-1.979-.196-2.512-.73a.326.326 0 0 0-.232-.095z" />
    </svg>
  );
}
