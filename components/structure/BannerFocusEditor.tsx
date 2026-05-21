'use client';

import { useRef } from 'react';
import type { BannerFocus } from '@/types';

interface BannerFocusEditorProps {
  imageUrl: string;
  value: BannerFocus | null;
  onChange: (focus: BannerFocus) => void;
  disabled?: boolean;
}

const clamp = (v: number) => Math.min(100, Math.max(0, v));

// Éditeur de point focal de bannière (modèle YouTube/Twitch). L'image entière
// est affichée ; l'utilisateur place/déplace un point = « le centre de ce qui
// doit rester visible ». Le point est stocké en % et appliqué tel quel en
// `background-position` — donc indépendant du ratio d'affichage de la bannière.
export default function BannerFocusEditor({ imageUrl, value, onChange, disabled }: BannerFocusEditorProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const focus = value ?? { x: 50, y: 50 };

  const setFromEvent = (clientX: number, clientY: number) => {
    const el = wrapRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return;
    onChange({
      x: Math.round(clamp(((clientX - r.left) / r.width) * 100)),
      y: Math.round(clamp(((clientY - r.top) / r.height) * 100)),
    });
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (disabled) return;
    dragging.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    setFromEvent(e.clientX, e.clientY);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragging.current) return;
    setFromEvent(e.clientX, e.clientY);
  };

  const onPointerUp = (e: React.PointerEvent) => {
    dragging.current = false;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  };

  return (
    <div className="space-y-2">
      <label className="t-label block">Point focal de la bannière</label>

      {/* Image entière + point focal déplaçable */}
      <div
        ref={wrapRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        className="relative w-full bevel-sm overflow-hidden select-none"
        style={{
          border: '1px solid var(--s-border)',
          background: 'var(--s-bg)',
          touchAction: 'none',
          cursor: disabled ? 'default' : 'crosshair',
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={imageUrl} alt="" className="w-full block" draggable={false} />
        <div
          className="absolute pointer-events-none"
          style={{
            left: `${focus.x}%`,
            top: `${focus.y}%`,
            width: 30,
            height: 30,
            transform: 'translate(-50%, -50%)',
            borderRadius: '50%',
            border: '2px solid var(--s-gold)',
            background: 'rgba(255,184,0,0.18)',
            boxShadow: '0 0 0 2px rgba(0,0,0,0.6), 0 0 14px rgba(0,0,0,0.55)',
          }}
        >
          <div
            className="absolute"
            style={{
              left: '50%', top: '50%', width: 5, height: 5,
              transform: 'translate(-50%, -50%)',
              borderRadius: '50%', background: 'var(--s-gold)',
            }}
          />
        </div>
      </div>

      {/* Aperçu du rendu réel de la bannière */}
      <div className="space-y-1">
        <span className="t-label" style={{ color: 'var(--s-text-muted)' }}>Aperçu</span>
        <div
          className="relative w-full bevel-sm overflow-hidden"
          style={{
            aspectRatio: '6 / 1',
            border: '1px solid var(--s-border)',
            backgroundImage: `url("${imageUrl}")`,
            backgroundSize: 'cover',
            backgroundPosition: `${focus.x}% ${focus.y}%`,
            backgroundRepeat: 'no-repeat',
          }}
        />
      </div>

      <p className="text-xs" style={{ color: 'var(--s-text-muted)' }}>
        Clique ou fais glisser le point sur la zone à garder visible — l&apos;aperçu montre le rendu réel. Pense à sauvegarder.
      </p>
    </div>
  );
}
