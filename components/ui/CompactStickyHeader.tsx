'use client';

import { useEffect, useState } from 'react';
import type { LucideIcon } from 'lucide-react';

export default function CompactStickyHeader({
  icon: Icon,
  title,
  accent = 'var(--s-violet-light)',
  threshold = 180,
  children,
}: {
  icon: LucideIcon;
  title: string;
  accent?: string;
  threshold?: number;
  children?: React.ReactNode;
}) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    function onScroll(e: Event) {
      const target = e.target as HTMLElement | Document | null;
      let scrollTop = 0;
      if (target && target !== document && (target as HTMLElement).scrollTop !== undefined) {
        scrollTop = (target as HTMLElement).scrollTop;
      } else {
        scrollTop = window.scrollY || document.documentElement.scrollTop;
      }
      setVisible(scrollTop > threshold);
    }
    document.addEventListener('scroll', onScroll, { capture: true, passive: true });
    return () => document.removeEventListener('scroll', onScroll, { capture: true });
  }, [threshold]);

  return (
    <div
      className="fixed top-0 right-0 z-40 transition-all duration-200"
      style={{
        left: '260px',
        transform: visible ? 'translateY(0)' : 'translateY(-100%)',
        opacity: visible ? 1 : 0,
        background: 'rgba(14,14,26,0.92)',
        backdropFilter: 'blur(14px)',
        WebkitBackdropFilter: 'blur(14px)',
        borderBottom: '1px solid var(--s-border)',
        pointerEvents: visible ? 'auto' : 'none',
        boxShadow: visible ? '0 8px 24px rgba(0,0,0,0.35)' : 'none',
      }}
    >
      <div
        className="h-[2px]"
        style={{ background: `linear-gradient(90deg, ${accent}, ${accent}66, transparent 70%)` }}
      />
      <div className="flex items-center gap-3 px-8 py-3">
        <div
          className="w-9 h-9 flex items-center justify-center bevel-sm flex-shrink-0"
          style={{ background: 'var(--s-elevated)', border: `1px solid ${accent}40` }}
        >
          <Icon size={16} style={{ color: accent }} />
        </div>
        <h2
          className="font-display text-xl truncate"
          style={{ letterSpacing: '0.04em', color: 'var(--s-text)' }}
          title={title}
        >
          {title}
        </h2>
        {children && <div className="flex-1 flex items-center justify-end gap-2">{children}</div>}
      </div>
    </div>
  );
}
