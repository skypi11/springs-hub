'use client';

export function Skeleton({
  className = '',
  style,
}: {
  className?: string;
  style?: React.CSSProperties;
}) {
  return <div className={`skeleton bevel-sm ${className}`} style={style} />;
}

export function SkeletonText({
  width = '60%',
  height = 14,
  className = '',
}: {
  width?: string | number;
  height?: number;
  className?: string;
}) {
  return (
    <div
      className={`skeleton-flat ${className}`}
      style={{ width, height, borderRadius: 2 }}
    />
  );
}

export function SkeletonAvatar({ size = 40 }: { size?: number }) {
  return <div className="skeleton-flat bevel-sm" style={{ width: size, height: size }} />;
}

export function SkeletonCard({
  height = 180,
  accent = 'var(--s-gold)',
}: {
  height?: number;
  accent?: string;
}) {
  return (
    <div
      className="bevel relative overflow-hidden"
      style={{
        background: 'var(--s-surface)',
        border: '1px solid var(--s-border)',
        height,
      }}
    >
      <div
        className="h-[3px]"
        style={{ background: `linear-gradient(90deg, ${accent}, ${accent}55, transparent 70%)`, opacity: 0.4 }}
      />
      <div className="p-5 space-y-4">
        <div className="flex items-center gap-3">
          <SkeletonAvatar size={48} />
          <div className="flex-1 space-y-2">
            <SkeletonText width="70%" height={16} />
            <SkeletonText width="40%" height={11} />
          </div>
        </div>
        <div className="space-y-2">
          <SkeletonText width="90%" height={11} />
          <SkeletonText width="75%" height={11} />
        </div>
      </div>
    </div>
  );
}

export function SkeletonGrid({
  count = 6,
  cols = 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3',
  cardHeight = 180,
  accent = 'var(--s-gold)',
}: {
  count?: number;
  cols?: string;
  cardHeight?: number;
  accent?: string;
}) {
  return (
    <div className={`grid gap-5 ${cols}`}>
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonCard key={i} height={cardHeight} accent={accent} />
      ))}
    </div>
  );
}

export function SkeletonPageHeader({ accent = 'var(--s-violet)' }: { accent?: string }) {
  return (
    <div
      className="bevel relative overflow-hidden"
      style={{ background: 'var(--s-surface)', border: '1px solid var(--s-border)' }}
    >
      <div
        className="h-[3px]"
        style={{ background: `linear-gradient(90deg, ${accent}, ${accent}55, transparent 70%)`, opacity: 0.4 }}
      />
      <div className="px-6 py-5 flex items-center gap-4">
        <SkeletonAvatar size={40} />
        <div className="flex-1 space-y-2">
          <SkeletonText width={220} height={24} />
          <SkeletonText width={320} height={12} />
        </div>
      </div>
    </div>
  );
}
