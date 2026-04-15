'use client';

import { useState } from 'react';
import ReactMarkdown from 'react-markdown';

const EMOJIS = ['🏆', '🥇', '🥈', '🥉', '⭐', '🔥', '💪', '🎮', '🎯', '🚀', '⚽', '🏎️', '🏁', '👑', '💎', '🛡️', '⚔️', '🎉', '📢', '💬', '✅', '❌', '🔵', '🟢', '🟡', '🔴', '⚡', '💥', '🌟', '🏅', '👊', '🤝', '📊', '📈', '🗓️', '🎪', '🏟️', '🎖️', '🧩', '🕹️'];

export default function MarkdownEditor({
  value, onChange, placeholder, maxLength, rows = 3, label, taRef,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  maxLength: number;
  rows?: number;
  label: string;
  taRef: React.RefObject<HTMLTextAreaElement | null>;
}) {
  const [showEmojis, setShowEmojis] = useState(false);

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

  return (
    <div>
      <label className="t-label block mb-2">{label}</label>
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

      {value.trim() && (
        <div className="mt-3 p-3" style={{ background: 'var(--s-elevated)', border: '1px solid var(--s-border)' }}>
          <span className="t-label block mb-2" style={{ fontSize: '12px', color: 'var(--s-text-muted)' }}>APERÇU</span>
          <div className="prose-springs text-xs">
            <ReactMarkdown>{value}</ReactMarkdown>
          </div>
        </div>
      )}
    </div>
  );
}
