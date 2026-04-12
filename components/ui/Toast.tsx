'use client';

import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';

type ToastVariant = 'success' | 'error' | 'info';
type Toast = { id: number; message: string; variant: ToastVariant };

interface ToastContextValue {
  show: (message: string, variant?: ToastVariant) => void;
  success: (message: string) => void;
  error: (message: string) => void;
  info: (message: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const VARIANT_STYLES: Record<ToastVariant, { accent: string; bg: string; icon: string }> = {
  success: { accent: 'var(--s-gold)', bg: 'rgba(255,184,0,0.08)', icon: '✓' },
  error: { accent: '#ef4444', bg: 'rgba(239,68,68,0.1)', icon: '!' },
  info: { accent: 'var(--s-violet-light)', bg: 'rgba(123,47,190,0.1)', icon: 'i' },
};

const TOAST_DURATION = 4500;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const remove = useCallback((id: number) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  const show = useCallback((message: string, variant: ToastVariant = 'info') => {
    const id = Date.now() + Math.random();
    setToasts(prev => [...prev, { id, message, variant }]);
    setTimeout(() => remove(id), TOAST_DURATION);
  }, [remove]);

  const value: ToastContextValue = {
    show,
    success: (m) => show(m, 'success'),
    error: (m) => show(m, 'error'),
    info: (m) => show(m, 'info'),
  };

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        style={{
          position: 'fixed',
          top: 24,
          right: 24,
          zIndex: 9999,
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
          pointerEvents: 'none',
          maxWidth: 'calc(100vw - 48px)',
        }}
      >
        {toasts.map(t => (
          <ToastItem key={t.id} toast={t} onClose={() => remove(t.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function ToastItem({ toast, onClose }: { toast: Toast; onClose: () => void }) {
  const [visible, setVisible] = useState(false);
  const styles = VARIANT_STYLES[toast.variant];

  useEffect(() => {
    // Slide-in après mount
    const t = setTimeout(() => setVisible(true), 10);
    return () => clearTimeout(t);
  }, []);

  return (
    <div
      role="status"
      style={{
        pointerEvents: 'auto',
        minWidth: 280,
        maxWidth: 420,
        background: 'var(--s-surface)',
        border: `1px solid ${styles.accent}40`,
        borderLeft: `3px solid ${styles.accent}`,
        clipPath: 'polygon(8px 0%, 100% 0%, 100% calc(100% - 8px), calc(100% - 8px) 100%, 0% 100%, 0% 8px)',
        padding: '12px 16px',
        display: 'flex',
        alignItems: 'flex-start',
        gap: 12,
        transform: visible ? 'translateX(0)' : 'translateX(20px)',
        opacity: visible ? 1 : 0,
        transition: 'transform 0.25s ease, opacity 0.25s ease',
        boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
      }}
    >
      <div
        style={{
          flexShrink: 0,
          width: 22,
          height: 22,
          borderRadius: '50%',
          background: styles.bg,
          border: `1px solid ${styles.accent}50`,
          color: styles.accent,
          fontSize: 12,
          fontWeight: 800,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {styles.icon}
      </div>
      <div style={{ flex: 1, fontSize: 13, color: 'var(--s-text)', lineHeight: 1.4, paddingTop: 2 }}>
        {toast.message}
      </div>
      <button
        onClick={onClose}
        aria-label="Fermer"
        style={{
          background: 'none',
          border: 'none',
          color: 'var(--s-text-muted)',
          cursor: 'pointer',
          fontSize: 16,
          lineHeight: 1,
          padding: 0,
          marginTop: 2,
        }}
      >
        ×
      </button>
    </div>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}
