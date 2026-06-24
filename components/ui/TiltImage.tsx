'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import Image from 'next/image';
import { Maximize2, X } from 'lucide-react';
import Portal from '@/components/ui/Portal';

/**
 * Image produit interactive : tilt 3D en perspective qui suit la souris +
 * clic pour ouvrir en grand (lightbox plein écran). Source de vérité unique
 * partagée par le Guide (GuideImage) et la landing (hero + rangées produit)
 * pour un comportement identique partout.
 *
 * Layout-agnostic : remplit la largeur de son parent (le parent contrôle la
 * taille via max-w / w-[…]).
 */
export default function TiltImage({
  src,
  alt,
  width,
  height,
  maxTilt = 7,
  lightbox = true,
  priority = false,
  sizes = '(max-width: 1024px) 100vw, 600px',
  accentBorder,
  restElevated = false,
}: {
  src: string;
  alt: string;
  width: number;
  height: number;
  /** Inclinaison max en degrés (rotateX/rotateY). */
  maxTilt?: number;
  /** Clic → lightbox plein écran. */
  lightbox?: boolean;
  priority?: boolean;
  sizes?: string;
  /** Couleur de bordure au repos (défaut neutre). */
  accentBorder?: string;
  /** Ombre portée même au repos (pour les éléments « hero »). */
  restElevated?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [hover, setHover] = useState(false);
  const [tilt, setTilt] = useState({ rx: 0, ry: 0 });
  const ref = useRef<HTMLButtonElement>(null);

  const onMove = useCallback((e: React.MouseEvent) => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width; // 0..1
    const py = (e.clientY - r.top) / r.height; // 0..1
    setTilt({
      ry: (px - 0.5) * 2 * maxTilt,
      rx: -(py - 0.5) * 2 * maxTilt,
    });
  }, [maxTilt]);

  const reset = useCallback(() => {
    setHover(false);
    setTilt({ rx: 0, ry: 0 });
  }, []);

  // Lightbox : fermeture Esc + lock du scroll body pendant l'ouverture.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open]);

  const restShadow = restElevated ? '0 40px 90px -35px rgba(0,0,0,0.8)' : '0 0 0 0 rgba(0,0,0,0)';

  const Tag = lightbox ? 'button' : 'div';

  return (
    <>
      <div className="w-full" style={{ perspective: '1400px' }}>
        <Tag
          ref={ref as React.Ref<HTMLButtonElement & HTMLDivElement>}
          {...(lightbox ? { type: 'button', onClick: () => setOpen(true), 'aria-label': `Agrandir : ${alt}` } : {})}
          onMouseMove={onMove}
          onMouseEnter={() => setHover(true)}
          onMouseLeave={reset}
          className={`group relative block w-full bevel-sm overflow-hidden ${lightbox ? 'cursor-zoom-in' : ''}`}
          style={{
            border: `1px solid ${accentBorder || 'var(--s-border)'}`,
            transform: `rotateX(${tilt.rx}deg) rotateY(${tilt.ry}deg) scale(${hover ? 1.02 : 1})`,
            transition: hover
              ? 'transform 0.08s ease-out, box-shadow 0.2s ease'
              : 'transform 0.45s ease, box-shadow 0.3s ease',
            transformStyle: 'preserve-3d',
            boxShadow: hover
              ? '0 28px 60px -16px rgba(0,0,0,0.7), 0 0 0 1px rgba(255,184,0,0.18)'
              : restShadow,
            willChange: 'transform',
          }}
        >
          <Image
            src={src}
            alt={alt}
            width={width}
            height={height}
            priority={priority}
            sizes={sizes}
            className="w-full h-auto block"
          />
          {/* Gloss diagonal au survol */}
          <span
            className="absolute inset-0 pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity duration-200"
            style={{ background: 'linear-gradient(120deg, rgba(255,255,255,0.10), transparent 42%)' }}
          />
          {/* Badge « agrandir » (seulement si lightbox) */}
          {lightbox && (
            <span
              className="absolute top-2 right-2 flex items-center justify-center w-7 h-7 bevel-sm opacity-0 group-hover:opacity-100 transition-opacity duration-200"
              style={{ background: 'rgba(10,10,10,0.72)', border: '1px solid var(--s-border)', color: 'var(--s-gold)' }}
            >
              <Maximize2 size={13} />
            </span>
          )}
        </Tag>
      </div>

      {lightbox && open && (
        <Portal>
          <div
            className="fixed inset-0 z-[9700] flex items-center justify-center p-4 sm:p-8 animate-fade-in"
            style={{ background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(4px)' }}
            onClick={() => setOpen(false)}
          >
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Fermer"
              className="absolute top-4 right-4 flex items-center justify-center w-10 h-10 bevel-sm transition-colors duration-150"
              style={{ background: 'var(--s-elevated)', border: '1px solid var(--s-border)', color: 'var(--s-text)' }}
            >
              <X size={18} />
            </button>
            <div
              className="bevel overflow-hidden"
              style={{ border: '1px solid var(--s-border)' }}
              onClick={(e) => e.stopPropagation()}
            >
              <Image
                src={src}
                alt={alt}
                width={width}
                height={height}
                sizes="95vw"
                className="block w-auto h-auto max-w-[95vw] max-h-[90vh]"
              />
            </div>
          </div>
        </Portal>
      )}
    </>
  );
}
