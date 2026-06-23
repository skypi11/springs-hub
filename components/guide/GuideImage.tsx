'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import Image from 'next/image';
import { Maximize2, X } from 'lucide-react';
import Portal from '@/components/ui/Portal';

/**
 * Capture du Guide : tilt 3D au survol (perspective qui suit la souris) +
 * clic pour ouvrir en grand dans une lightbox plein écran. Composant client
 * isolé pour que la page Guide reste légère.
 */
export default function GuideImage({ src, alt, width, height }: {
  src: string;
  alt: string;
  width: number;
  height: number;
}) {
  const [open, setOpen] = useState(false);
  const [hover, setHover] = useState(false);
  const [tilt, setTilt] = useState({ rx: 0, ry: 0 });
  const ref = useRef<HTMLButtonElement>(null);

  const MAX_DEG = 7;

  const onMove = useCallback((e: React.MouseEvent) => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width; // 0..1
    const py = (e.clientY - r.top) / r.height; // 0..1
    setTilt({
      ry: (px - 0.5) * 2 * MAX_DEG,
      rx: -(py - 0.5) * 2 * MAX_DEG,
    });
  }, []);

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

  return (
    <>
      <div
        className="w-full max-w-xl lg:w-[460px] lg:flex-shrink-0 self-start"
        style={{ perspective: '1100px' }}
      >
        <button
          ref={ref}
          type="button"
          onClick={() => setOpen(true)}
          onMouseMove={onMove}
          onMouseEnter={() => setHover(true)}
          onMouseLeave={reset}
          aria-label={`Agrandir : ${alt}`}
          className="group relative block w-full bevel-sm overflow-hidden cursor-zoom-in"
          style={{
            border: '1px solid var(--s-border)',
            transform: `rotateX(${tilt.rx}deg) rotateY(${tilt.ry}deg) scale(${hover ? 1.02 : 1})`,
            transition: hover ? 'transform 0.08s ease-out, box-shadow 0.2s ease' : 'transform 0.45s ease, box-shadow 0.3s ease',
            transformStyle: 'preserve-3d',
            boxShadow: hover
              ? '0 24px 55px -14px rgba(0,0,0,0.65), 0 0 0 1px rgba(255,184,0,0.18)'
              : '0 0 0 0 rgba(0,0,0,0)',
            willChange: 'transform',
          }}
        >
          <Image
            src={src}
            alt={alt}
            width={width}
            height={height}
            sizes="(max-width: 1024px) 100vw, 460px"
            className="w-full h-auto block"
          />
          {/* Gloss diagonal au survol */}
          <span
            className="absolute inset-0 pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity duration-200"
            style={{ background: 'linear-gradient(120deg, rgba(255,255,255,0.10), transparent 42%)' }}
          />
          {/* Badge « agrandir » */}
          <span
            className="absolute top-2 right-2 flex items-center justify-center w-7 h-7 bevel-sm opacity-0 group-hover:opacity-100 transition-opacity duration-200"
            style={{ background: 'rgba(10,10,10,0.72)', border: '1px solid var(--s-border)', color: 'var(--s-gold)' }}
          >
            <Maximize2 size={13} />
          </span>
        </button>
      </div>

      {open && (
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
