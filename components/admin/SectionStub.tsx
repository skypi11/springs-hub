'use client';

import { type LucideIcon, Hammer } from 'lucide-react';

type Props = {
  title: string;
  icon: LucideIcon;
  accent: string;
  description: string;
  plannedFeatures: string[];
};

export default function SectionStub({ title, icon: Icon, accent, description, plannedFeatures }: Props) {
  return (
    <>
      <div className="flex items-center gap-3">
        <h2 className="font-display text-xl" style={{ letterSpacing: '0.04em' }}>
          {title.toUpperCase()}
        </h2>
        <span className="tag tag-neutral" style={{ fontSize: '9px' }}>BIENTÔT</span>
      </div>

      <div
        className="pillar-card panel relative overflow-hidden"
        style={{ background: 'var(--s-surface)', border: '1px solid var(--s-border)' }}
      >
        <div
          className="h-[3px]"
          style={{ background: `linear-gradient(90deg, ${accent}, ${accent}55, transparent 70%)` }}
        />
        <div
          className="absolute top-0 right-0 w-[200px] h-[200px] pointer-events-none opacity-[0.06]"
          style={{ background: `radial-gradient(circle at top right, ${accent}, transparent 70%)` }}
        />
        <div className="relative z-[1] p-6 space-y-5">
          <div className="flex items-center gap-3">
            <div
              className="p-2"
              style={{ background: accent + '15', border: `1px solid ${accent}35` }}
            >
              <Icon size={16} style={{ color: accent }} />
            </div>
            <p className="text-sm" style={{ color: 'var(--s-text-dim)' }}>
              {description}
            </p>
          </div>

          <div className="divider" />

          <div>
            <div className="flex items-center gap-2 mb-3">
              <Hammer size={13} style={{ color: 'var(--s-text-muted)' }} />
              <span className="t-label">Fonctionnalités prévues</span>
            </div>
            <ul className="space-y-2">
              {plannedFeatures.map((f, i) => (
                <li
                  key={i}
                  className="text-sm flex items-start gap-2"
                  style={{ color: 'var(--s-text-dim)' }}
                >
                  <span style={{ color: accent, marginTop: 2 }}>•</span>
                  <span>{f}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </>
  );
}
