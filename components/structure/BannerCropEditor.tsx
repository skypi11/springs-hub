'use client';

import { useRef, useState, useCallback } from 'react';
import { Move } from 'lucide-react';
import type { BannerCrop } from '@/types';

// Ratio d'affichage de la bannière sur la page publique — doit rester aligné
// sur le cadre de app/community/structure/[id]/page.tsx (aspectRatio 6 / 1).
const BANNER_RATIO = 6;
const MAX_ZOOM = 3;

interface BannerCropEditorProps {
  imageUrl: string;
  value: BannerCrop | null;
  onChange: (crop: BannerCrop) => void;
  disabled?: boolean;
}

// Rectangle de cadrage exprimé en fractions de l'image (indépendant des pixels) :
//   fx, fy = coin haut-gauche ; fw = largeur. La hauteur est dérivée pour que le
//   rectangle conserve le ratio 4:1.
type RectFrac = { fx: number; fy: number; fw: number };

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

// Éditeur de cadrage de bannière : affiche l'image ENTIÈRE, avec par-dessus un
// cadre 4:1 déplaçable à la souris (la zone réellement visible sur la page
// publique) + un curseur de zoom. Produit un BannerCrop (background-size +
// background-position) directement applicable en CSS à l'affichage.
export default function BannerCropEditor({ imageUrl, value, onChange, disabled }: BannerCropEditorProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [imgRatio, setImgRatio] = useState<number | null>(null);
  const [rect, setRect] = useState<RectFrac | null>(null);
  const drag = useRef<{ pointerId: number; startX: number; startY: number; startFx: number; startFy: number } | null>(null);

  // Largeur max du rectangle (fraction de la largeur image) pour qu'un 4:1
  // tienne dans l'image ; le zoom resserre jusqu'à fwMax / MAX_ZOOM.
  const fwMax = imgRatio ? Math.min(1, BANNER_RATIO / imgRatio) : 1;
  const fwMin = fwMax / MAX_ZOOM;

  // Hauteur du rectangle (fraction de la hauteur image) pour une largeur fw.
  const fhFor = useCallback(
    (fw: number) => (imgRatio ? (fw * imgRatio) / BANNER_RATIO : fw),
    [imgRatio],
  );

  const toCrop = useCallback((r: RectFrac): BannerCrop => {
    const fh = fhFor(r.fw);
    return {
      sizePct: Math.round((100 / r.fw) * 10) / 10,
      posX: 1 - r.fw > 0.0001 ? clamp(Math.round((r.fx / (1 - r.fw)) * 100), 0, 100) : 50,
      posY: 1 - fh > 0.0001 ? clamp(Math.round((r.fy / (1 - fh)) * 100), 0, 100) : 50,
    };
  }, [fhFor]);

  const commit = useCallback((r: RectFrac) => {
    setRect(r);
    onChange(toCrop(r));
  }, [onChange, toCrop]);

  const onImgLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    if (!img.naturalWidth || !img.naturalHeight) return;
    const ratio = img.naturalWidth / img.naturalHeight;
    setImgRatio(ratio);
    const fwM = Math.min(1, BANNER_RATIO / ratio);
    if (value) {
      const fw = clamp(100 / value.sizePct, fwM / MAX_ZOOM, fwM);
      const fh = (fw * ratio) / BANNER_RATIO;
      setRect({
        fw,
        fx: (value.posX / 100) * Math.max(0, 1 - fw),
        fy: (value.posY / 100) * Math.max(0, 1 - fh),
      });
    } else {
      // Pas de cadrage encore défini : rectangle le plus large possible, centré.
      const fw = fwM;
      const fh = (fw * ratio) / BANNER_RATIO;
      setRect({ fw, fx: (1 - fw) / 2, fy: (1 - fh) / 2 });
    }
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (disabled || !rect) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      startFx: rect.fx,
      startFy: rect.fy,
    };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag.current || !rect || !wrapRef.current) return;
    const box = wrapRef.current.getBoundingClientRect();
    if (box.width === 0 || box.height === 0) return;
    const dfx = (e.clientX - drag.current.startX) / box.width;
    const dfy = (e.clientY - drag.current.startY) / box.height;
    const fh = fhFor(rect.fw);
    commit({
      fw: rect.fw,
      fx: clamp(drag.current.startFx + dfx, 0, 1 - rect.fw),
      fy: clamp(drag.current.startFy + dfy, 0, 1 - fh),
    });
  };

  const onPointerUp = (e: React.PointerEvent) => {
    if (drag.current?.pointerId === e.pointerId) drag.current = null;
  };

  const onZoom = (zoom: number) => {
    if (!rect || imgRatio === null) return;
    const fw = clamp(fwMax / zoom, fwMin, fwMax);
    const fh = (fw * imgRatio) / BANNER_RATIO;
    const oldFh = (rect.fw * imgRatio) / BANNER_RATIO;
    // On garde le centre du rectangle pendant le zoom.
    const cx = rect.fx + rect.fw / 2;
    const cy = rect.fy + oldFh / 2;
    commit({
      fw,
      fx: clamp(cx - fw / 2, 0, 1 - fw),
      fy: clamp(cy - fh / 2, 0, 1 - fh),
    });
  };

  const zoomNow = rect ? fwMax / rect.fw : 1;
  const fh = rect ? fhFor(rect.fw) : 0;

  return (
    <div className="space-y-2">
      <label className="t-label block">Cadrage de la bannière</label>

      <div
        ref={wrapRef}
        className="relative w-full bevel-sm overflow-hidden select-none"
        style={{ border: '1px solid var(--s-border)', background: 'var(--s-bg)', touchAction: 'none' }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={imageUrl}
          alt=""
          className="w-full block"
          draggable={false}
          onLoad={onImgLoad}
        />
        {rect && (
          <div
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            className="absolute"
            style={{
              left: `${rect.fx * 100}%`,
              top: `${rect.fy * 100}%`,
              width: `${rect.fw * 100}%`,
              height: `${fh * 100}%`,
              cursor: disabled ? 'default' : 'move',
              boxShadow: '0 0 0 9999px rgba(0,0,0,0.55)',
              border: '2px solid var(--s-gold)',
              touchAction: 'none',
            }}
          >
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <Move size={18} style={{ color: 'var(--s-gold)', opacity: 0.85 }} />
            </div>
          </div>
        )}
      </div>

      <div className="flex items-center gap-2">
        <span className="t-label flex-shrink-0" style={{ color: 'var(--s-text-muted)' }}>Zoom</span>
        <input
          type="range"
          min={1}
          max={MAX_ZOOM}
          step={0.02}
          value={zoomNow}
          onChange={e => onZoom(Number(e.target.value))}
          disabled={disabled || !rect}
          className="flex-1"
          style={{ accentColor: 'var(--s-gold)' }}
        />
      </div>

      <p className="text-xs" style={{ color: 'var(--s-text-muted)' }}>
        Déplace le cadre sur l&apos;image et ajuste le zoom — c&apos;est exactement ce qui s&apos;affichera
        sur la page publique. Pense à sauvegarder.
      </p>
    </div>
  );
}
