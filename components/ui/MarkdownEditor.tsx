'use client';

// Éditeur markdown partagé (description structure, message de recrutement…).
// Le rendu se consulte via un toggle Écrire | Aperçu (pattern GitHub/Discord) :
// l'ancien aperçu empilé en permanence sous le champ doublait la hauteur du
// panneau et poussait tout le contenu en dessous.

import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { Pencil, Eye } from 'lucide-react';

const EMOJIS = ['🏆', '🥇', '🥈', '🥉', '⭐', '🔥', '💪', '🎮', '🎯', '🚀', '⚽', '🏎️', '🏁', '👑', '💎', '🛡️', '⚔️', '🎉', '📢', '💬', '✅', '❌', '🔵', '🟢', '🟡', '🔴', '⚡', '💥', '🌟', '🏅', '👊', '🤝', '📊', '📈', '🗓️', '🎪', '🏟️', '🎖️', '🧩', '🕹️'];

export default function MarkdownEditor({
  value, onChange, placeholder, maxLength, rows = 3, label, taRef,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  maxLength: number;
  rows?: number;
  /** Optionnel : omis quand le panneau parent porte déjà un titre. */
  label?: string;
  taRef: React.RefObject<HTMLTextAreaElement | null>;
}) {
  const [showEmojis, setShowEmojis] = useState(false);
  const [mode, setMode] = useState<'write' | 'preview'>('write');

  function insertEmoji(emoji: string) {
    const ta = taRef.current;
    if (ta) {
      const start = ta.selectionStart;
      const end = ta.selectionEnd;
      const newVal = value.slice(0, start) + emoji + value.slice(end);
      onChange(newVal);
      setTimeout(() => { ta.focus(); ta.selectionStart = ta.selectionEnd = start + emoji.length; }, 0);
    } else {
      onChange(value + emoji);
    }
  }

  const TABS: Array<{ id: 'write' | 'preview'; label: string; icon: typeof Pencil }> = [
    { id: 'write', label: 'Écrire', icon: Pencil },
    { id: 'preview', label: 'Aperçu', icon: Eye },
  ];

  return (
    <div>
      {label && <label className="t-label block mb-2">{label}</label>}

      {/* Toggle Écrire | Aperçu */}
      <div className="flex items-center gap-1 mb-1.5">
        {TABS.map(t => {
          const Icon = t.icon;
          const active = mode === t.id;
          const disabled = t.id === 'preview' && !value.trim();
          return (
            <button key={t.id} type="button"
              onClick={() => !disabled && setMode(t.id)}
              disabled={disabled}
              className="text-xs flex items-center gap-1.5 px-2.5 py-1 transition-colors duration-150"
              style={{
                color: active ? 'var(--s-gold)' : 'var(--s-text-muted)',
                background: active ? 'rgba(255,184,0,0.08)' : 'transparent',
                border: `1px solid ${active ? 'rgba(255,184,0,0.2)' : 'var(--s-border)'}`,
                cursor: disabled ? 'not-allowed' : 'pointer',
                opacity: disabled ? 0.5 : 1,
              }}>
              <Icon size={11} /> {t.label}
            </button>
          );
        })}
      </div>

      {mode === 'write' ? (
        <>
          <textarea ref={taRef} value={value} onChange={e => onChange(e.target.value)}
            className="settings-input w-full" rows={rows} placeholder={placeholder} maxLength={maxLength}
            style={{ resize: 'vertical' }} />

          <div className="flex items-start gap-3 mt-1.5">
            <div className="relative">
              <button type="button" onClick={() => setShowEmojis(!showEmojis)}
                className="text-xs flex items-center gap-1.5 px-2 py-1 transition-colors duration-150"
                style={{ color: showEmojis ? 'var(--s-gold)' : 'var(--s-text-muted)', background: showEmojis ? 'rgba(255,184,0,0.08)' : 'transparent', border: `1px solid ${showEmojis ? 'rgba(255,184,0,0.2)' : 'var(--s-border)'}`, cursor: 'pointer' }}>
                <span style={{ fontSize: '14px' }}>😀</span> Emojis
              </button>
              {showEmojis && (
                <div className="absolute left-0 top-full mt-1 p-2 z-50 flex flex-wrap" style={{ width: '280px', background: 'var(--s-surface)', border: '1px solid var(--s-border)', boxShadow: '0 8px 24px rgba(0,0,0,0.5)' }}>
                  {EMOJIS.map(emoji => (
                    <button key={emoji} type="button"
                      className="hover:bg-[var(--s-hover)] transition-colors duration-100"
                      style={{ width: '28px', height: '28px', fontSize: '16px', lineHeight: '28px', textAlign: 'center', background: 'transparent', border: 'none', cursor: 'pointer', padding: 0, fontFamily: '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif' }}
                      onClick={() => insertEmoji(emoji)}>
                      {emoji}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="flex flex-wrap gap-x-3 gap-y-1" style={{ color: 'var(--s-text-muted)', fontSize: '12px' }}>
              <span><strong style={{ color: 'var(--s-text-dim)' }}>**gras**</strong></span>
              <span><em>*italique*</em></span>
              <span>## Titre</span>
              <span>- liste</span>
              <span>[lien](url)</span>
            </div>
          </div>
        </>
      ) : (
        <div className="p-3" style={{ background: 'var(--s-elevated)', border: '1px solid var(--s-border)', minHeight: `${rows * 24 + 20}px` }}>
          <div className="prose-springs text-sm">
            <ReactMarkdown>{value}</ReactMarkdown>
          </div>
        </div>
      )}
    </div>
  );
}
