'use client';

import { useEffect, useRef } from 'react';

/**
 * Zone sombre d'une modale : ferme au clic extérieur et à Escape.
 *
 * Pourquoi un composant plutôt que le div nu habituel : `stopPropagation` sur le
 * contenu NE protège PAS la modale. Quand `mousedown` et `mouseup` ont des cibles
 * différentes — presser sur le formulaire, relâcher sur la zone sombre, geste
 * courant au doigt — le `click` est dispatché sur l'ancêtre commun, donc sur le
 * backdrop, et la modale se ferme en jetant la saisie. D'où la garde de geste :
 * on ne ferme que si le geste a COMMENCÉ sur le backdrop.
 *
 * Ne porte pas de Portal : la composition reste explicite au call site.
 */
interface Props {
  /** Fermeture demandée par l'utilisateur (clic extérieur ou Escape). */
  onClose: () => void;
  children: React.ReactNode;
  /** Complète le layout du conteneur plein écran (alignement, padding...). */
  className?: string;
  /** Posé en inline pour ne pas dépendre de l'ordre des classes Tailwind z-*. */
  zIndex?: number;
}

export default function ModalBackdrop({ onClose, children, className = '', zIndex = 50 }: Props) {
  const startedOnBackdrop = useRef(false);

  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCloseRef.current();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  return (
    <div
      className={`fixed inset-0 flex items-center justify-center p-4 ${className}`}
      style={{ background: 'rgba(0,0,0,0.75)', zIndex }}
      onPointerDown={e => { startedOnBackdrop.current = e.target === e.currentTarget; }}
      onClick={e => {
        const fromBackdrop = startedOnBackdrop.current;
        startedOnBackdrop.current = false;
        if (fromBackdrop && e.target === e.currentTarget) onClose();
      }}
    >
      {children}
    </div>
  );
}
