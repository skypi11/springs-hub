'use client';

import { useEffect, useRef, useState } from 'react';

// Reveal léger : opacity + 16px Y, transition 0.45s.
// IntersectionObserver single-shot pour éviter les flickers.
export default function ScrollReveal({
  children,
  delay = 0,
  className = '',
}: {
  children: React.ReactNode;
  delay?: number;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        // Petit délai pour le stagger
        if (delay > 0) {
          window.setTimeout(() => setVisible(true), delay);
        } else {
          setVisible(true);
        }
        observer.disconnect();
      }
    }, { threshold: 0.1, rootMargin: '0px 0px -40px 0px' });
    observer.observe(node);
    return () => observer.disconnect();
  }, [delay]);

  return (
    <div ref={ref} className={`scroll-reveal ${visible ? 'is-visible' : ''} ${className}`}>
      {children}
    </div>
  );
}
