'use client';
import React from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical } from 'lucide-react';

// Wrapper sortable autour d'une carte d'équipe : applique le transform/transition
// fournis par useSortable, et expose une poignée drag (GripVertical) en haut-gauche
// quand `draggable` est true. Sans poignée, dragger la carte entière entrerait en
// conflit avec les boutons internes (chips, kebab, picker capitaine...).
export function SortableTeam({
  id, draggable, children,
}: {
  id: string;
  draggable: boolean;
  children: React.ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id, disabled: !draggable });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
    position: 'relative',
    zIndex: isDragging ? 10 : 'auto',
  };
  return (
    <div ref={setNodeRef} style={style}>
      {draggable && (
        <button
          type="button"
          aria-label="Réorganiser l'équipe"
          {...attributes}
          {...listeners}
          className="absolute top-2 left-2 z-[2] p-1 cursor-grab active:cursor-grabbing transition-opacity duration-150 hover:opacity-100"
          style={{
            color: 'var(--s-text-muted)',
            background: 'rgba(8,8,15,0.55)',
            border: '1px solid var(--s-border)',
            opacity: 0.45,
          }}
          onClick={e => e.stopPropagation()}
        >
          <GripVertical size={12} />
        </button>
      )}
      {children}
    </div>
  );
}

// Wrapper sortable autour d'un groupe (header + liste équipes) : utilise un render prop
// qui expose attributes/listeners/setActivatorNodeRef pour que le consumer place la
// poignée drag exactement où il veut dans son header (au début de la barre titre).
// Le wrapper enveloppe TOUT le bloc groupe : quand on drag, le header ET les équipes
// du groupe se déplacent visuellement ensemble.
export function SortableGroup({
  id, draggable, children,
}: {
  id: string;
  draggable: boolean;
  children: (handleProps: {
    attributes: ReturnType<typeof useSortable>['attributes'];
    listeners: ReturnType<typeof useSortable>['listeners'];
    setActivatorNodeRef: ReturnType<typeof useSortable>['setActivatorNodeRef'];
    isDragging: boolean;
  }) => React.ReactNode;
}) {
  const {
    attributes, listeners, setNodeRef, setActivatorNodeRef,
    transform, transition, isDragging,
  } = useSortable({ id, disabled: !draggable });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    position: 'relative',
    zIndex: isDragging ? 20 : 'auto',
  };
  return (
    <div ref={setNodeRef} style={style}>
      {children({ attributes, listeners, setActivatorNodeRef, isDragging })}
    </div>
  );
}
