'use client';

import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import Portal from './Portal';

type ConfirmVariant = 'default' | 'danger';

interface ConfirmOptions {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: ConfirmVariant;
}

interface ConfirmContextValue {
  confirm: (options: ConfirmOptions) => Promise<boolean>;
}

const ConfirmContext = createContext<ConfirmContextValue | null>(null);

interface ActiveConfirm extends ConfirmOptions {
  resolve: (value: boolean) => void;
}

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [active, setActive] = useState<ActiveConfirm | null>(null);
  const [visible, setVisible] = useState(false);

  const confirm = useCallback((options: ConfirmOptions) => {
    return new Promise<boolean>(resolve => {
      setActive({ ...options, resolve });
    });
  }, []);

  useEffect(() => {
    if (active) {
      const t = setTimeout(() => setVisible(true), 10);
      return () => clearTimeout(t);
    }
    setVisible(false);
  }, [active]);

  // ESC pour annuler — ergonomie standard des modals
  useEffect(() => {
    if (!active) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleClose(false);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  function handleClose(result: boolean) {
    if (!active) return;
    active.resolve(result);
    setVisible(false);
    // Laisse l'animation jouer avant de retirer le DOM
    setTimeout(() => setActive(null), 200);
  }

  return (
    <ConfirmContext.Provider value={{ confirm }}>
      {children}
      {active && (
        <Portal>
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 10000,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: visible ? 'rgba(4,4,8,0.78)' : 'rgba(4,4,8,0)',
            transition: 'background 0.2s ease',
            padding: 24,
          }}
          onClick={() => handleClose(false)}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              maxWidth: 460,
              width: '100%',
              background: 'var(--s-surface)',
              border: `1px solid ${active.variant === 'danger' ? 'rgba(239,68,68,0.35)' : 'var(--s-border)'}`,
              borderTop: `3px solid ${active.variant === 'danger' ? '#ef4444' : 'var(--s-gold)'}`,
              clipPath: 'polygon(14px 0%, 100% 0%, 100% calc(100% - 14px), calc(100% - 14px) 100%, 0% 100%, 0% 14px)',
              padding: '24px 28px 22px',
              transform: visible ? 'scale(1)' : 'scale(0.96)',
              opacity: visible ? 1 : 0,
              transition: 'transform 0.2s ease, opacity 0.2s ease',
              boxShadow: '0 24px 64px rgba(0,0,0,0.6)',
            }}
          >
            <h2
              style={{
                fontFamily: 'var(--font-bebas), system-ui, sans-serif',
                fontSize: 24,
                letterSpacing: '0.04em',
                textTransform: 'uppercase',
                color: 'var(--s-text)',
                margin: 0,
                marginBottom: 12,
                lineHeight: 1.1,
              }}
            >
              {active.title}
            </h2>
            <p
              style={{
                fontSize: 14,
                color: 'var(--s-text-dim)',
                lineHeight: 1.55,
                margin: 0,
                marginBottom: 24,
                whiteSpace: 'pre-wrap',
              }}
            >
              {active.message}
            </p>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button
                type="button"
                onClick={() => handleClose(false)}
                className="btn-springs btn-secondary bevel-sm"
              >
                {active.cancelLabel || 'Annuler'}
              </button>
              <button
                type="button"
                onClick={() => handleClose(true)}
                className="btn-springs bevel-sm"
                style={{
                  background: active.variant === 'danger' ? '#ef4444' : 'var(--s-gold)',
                  color: active.variant === 'danger' ? '#fff' : '#0a0a0f',
                  borderColor: active.variant === 'danger' ? '#ef4444' : 'var(--s-gold)',
                }}
              >
                {active.confirmLabel || 'Confirmer'}
              </button>
            </div>
          </div>
        </div>
        </Portal>
      )}
    </ConfirmContext.Provider>
  );
}

export function useConfirm(): (options: ConfirmOptions) => Promise<boolean> {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error('useConfirm must be used within ConfirmProvider');
  return ctx.confirm;
}
