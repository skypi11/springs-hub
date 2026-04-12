'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import ReactMarkdown from 'react-markdown';
import { useAuth } from '@/context/AuthContext';
import { auth } from '@/lib/firebase';
import { countries } from '@/lib/countries';
import {
  Save, User, Gamepad2, Shield, Search, ChevronRight,
  Calendar, Globe, MessageSquare, Image as ImageIcon,
  AlertCircle, CheckCircle, Loader2
} from 'lucide-react';

const EMOJIS = ['🏆', '🥇', '🥈', '🥉', '⭐', '🔥', '💪', '🎮', '🎯', '🚀', '⚽', '🏎️', '🏁', '👑', '💎', '🛡️', '⚔️', '🎉', '📢', '💬', '✅', '❌', '🔵', '🟢', '🟡', '🔴', '⚡', '💥', '🌟', '🏅', '👊', '🤝', '📊', '📈', '🗓️', '🎪', '🏟️', '🎖️', '🧩', '🕹️'];

function MarkdownEditor({ value, onChange, placeholder, maxLength, rows = 3, label, taRef }: {
  value: string; onChange: (v: string) => void; placeholder: string; maxLength: number; rows?: number; label: string;
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

      {/* Toolbar : emojis + légende */}
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
        <div className="flex flex-wrap gap-x-3 gap-y-1" style={{ color: 'var(--s-text-muted)', fontSize: '9px' }}>
          <span><strong style={{ color: 'var(--s-text-dim)' }}>**gras**</strong></span>
          <span><em>*italique*</em></span>
          <span>## Titre</span>
          <span>- liste</span>
          <span>[lien](url)</span>
        </div>
      </div>

      {/* Preview */}
      {value.trim() && (
        <div className="mt-3 p-3" style={{ background: 'var(--s-elevated)', border: '1px solid var(--s-border)' }}>
          <span className="t-label block mb-2" style={{ fontSize: '8px', color: 'var(--s-text-muted)' }}>APERÇU</span>
          <div className="prose-springs text-xs">
            <ReactMarkdown>{value}</ReactMarkdown>
          </div>
        </div>
      )}
    </div>
  );
}

type FormData = {
  displayName: string;
  avatarUrl: string;
  bio: string;
  country: string;
  dateOfBirth: string;
  games: string[];
  epicAccountId: string;
  rlTrackerUrl: string;
  pseudoTM: string;
  loginTM: string;
  tmIoUrl: string;
  isAvailableForRecruitment: boolean;
  recruitmentRole: string;
  recruitmentMessage: string;
};

const defaultForm: FormData = {
  displayName: '',
  avatarUrl: '',
  bio: '',
  country: '',
  dateOfBirth: '',
  games: [],
  epicAccountId: '',
  rlTrackerUrl: '',
  pseudoTM: '',
  loginTM: '',
  tmIoUrl: '',
  isAvailableForRecruitment: false,
  recruitmentRole: '',
  recruitmentMessage: '',
};

export default function SettingsPage() {
  const { user, firebaseUser, loading: authLoading } = useAuth();
  const router = useRouter();
  const [form, setForm] = useState<FormData>(defaultForm);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const [loaded, setLoaded] = useState(false);
  const bioRef = useRef<HTMLTextAreaElement | null>(null);
  const recruitRef = useRef<HTMLTextAreaElement | null>(null);

  // Charger les données existantes via API serveur
  useEffect(() => {
    if (authLoading || !firebaseUser) return;

    async function loadProfile() {
      try {
        const res = await fetch(`/api/profile?uid=${encodeURIComponent(firebaseUser!.uid)}`);
        if (res.ok) {
          const data = await res.json();
          setForm({
            displayName: data.displayName ?? firebaseUser!.displayName ?? '',
            avatarUrl: data.avatarUrl ?? '',
            bio: data.bio ?? '',
            country: data.country ?? '',
            dateOfBirth: data.dateOfBirth ?? '',
            games: data.games ?? [],
            epicAccountId: data.epicDisplayName ?? data.epicAccountId ?? '',
            rlTrackerUrl: data.rlTrackerUrl ?? '',
            pseudoTM: data.pseudoTM ?? '',
            loginTM: data.loginTM ?? '',
            tmIoUrl: data.tmIoUrl ?? '',
            isAvailableForRecruitment: data.isAvailableForRecruitment ?? false,
            recruitmentRole: data.recruitmentRole ?? '',
            recruitmentMessage: data.recruitmentMessage ?? '',
          });
        } else {
          // Profil pas encore créé — pré-remplir avec les infos Discord
          setForm(prev => ({
            ...prev,
            displayName: firebaseUser!.displayName ?? '',
          }));
        }
      } catch (err) {
        console.error('[Settings] load error:', err);
      }
      setLoaded(true);
    }

    loadProfile();
  }, [authLoading, firebaseUser]);

  if (!authLoading && !firebaseUser) {
    return (
      <div className="min-h-screen px-8 py-8 flex items-center justify-center">
        <div className="panel p-10 text-center max-w-md">
          <AlertCircle size={32} className="mx-auto mb-4" style={{ color: 'var(--s-text-muted)' }} />
          <h2 className="font-display text-2xl mb-2">CONNEXION REQUISE</h2>
          <p className="t-body">Connecte-toi via Discord pour accéder à tes paramètres.</p>
        </div>
      </div>
    );
  }

  if (!loaded) {
    return (
      <div className="min-h-screen px-8 py-8 flex items-center justify-center">
        <Loader2 size={24} className="animate-spin" style={{ color: 'var(--s-text-dim)' }} />
      </div>
    );
  }

  function toggleGame(game: string) {
    setForm(prev => ({
      ...prev,
      games: prev.games.includes(game)
        ? prev.games.filter(g => g !== game)
        : [...prev.games, game],
    }));
  }

  function validate(): string | null {
    if (!form.displayName.trim()) return 'Le pseudo est obligatoire.';
    if (!form.country) return 'Le pays est obligatoire.';
    if (!form.dateOfBirth) return 'La date de naissance est obligatoire.';
    if (form.games.length === 0) return 'Sélectionne au moins un jeu.';
    if (form.games.includes('rocket_league') && !form.epicAccountId.trim()) {
      return 'Le pseudo Epic Games est obligatoire pour Rocket League.';
    }
    if (form.games.includes('trackmania') && !form.pseudoTM.trim()) {
      return 'Le pseudo Ubisoft/Nadeo est obligatoire pour Trackmania.';
    }
    if (form.dateOfBirth) {
      const birth = new Date(form.dateOfBirth);
      const age = Math.floor((Date.now() - birth.getTime()) / (365.25 * 24 * 60 * 60 * 1000));
      if (age < 13) return 'Tu dois avoir au moins 13 ans pour t\'inscrire.';
    }
    return null;
  }

  async function handleSave() {
    const err = validate();
    if (err) {
      setError(err);
      return;
    }

    setError('');
    setSaving(true);
    setSaved(false);

    try {
      const idToken = await auth.currentUser?.getIdToken();
      if (!idToken) {
        setError('Session expirée. Reconnecte-toi.');
        setSaving(false);
        return;
      }

      const res = await fetch('/api/profile', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${idToken}`,
        },
        body: JSON.stringify(form),
      });

      if (res.ok) {
        setSaved(true);
        setTimeout(() => setSaved(false), 3000);
      } else {
        const data = await res.json();
        setError(data.error || 'Erreur lors de la sauvegarde.');
      }
    } catch (err) {
      console.error('[Settings] save error:', err);
      setError('Erreur réseau. Réessaie.');
    }

    setSaving(false);
  }

  const avatarSrc = form.avatarUrl || user?.discordAvatar || '';

  return (
    <div className="min-h-screen hex-bg px-8 py-8 space-y-8">
      <div className="relative z-[1] space-y-8">

        {/* ─── HEADER ──────────────────────────────────────────────────────── */}
        <header className="bevel animate-fade-in relative overflow-hidden" style={{ background: 'var(--s-surface)', border: '1px solid var(--s-border)' }}>
          <div className="h-[3px]" style={{ background: 'linear-gradient(90deg, var(--s-gold), rgba(255,184,0,0.3), transparent 80%)' }} />
          <div className="absolute top-0 left-0 w-[500px] h-[400px] pointer-events-none opacity-[0.06]"
            style={{ background: 'radial-gradient(ellipse at top left, var(--s-gold), transparent 70%)' }} />

          <div className="relative z-[1] p-10 flex items-center gap-8">
            <div className="flex-shrink-0 w-24 h-24 relative overflow-hidden bevel-sm"
              style={{ background: 'var(--s-elevated)', border: '2px solid rgba(255,184,0,0.15)' }}>
              {avatarSrc ? (
                <Image src={avatarSrc} alt="Avatar" fill className="object-cover" unoptimized />
              ) : (
                <div className="w-full h-full flex items-center justify-center">
                  <User size={36} style={{ color: 'var(--s-text-muted)' }} />
                </div>
              )}
            </div>

            <div className="flex-1">
              <div className="flex items-center gap-2 mb-3">
                <span className="tag tag-gold">Paramètres</span>
                <span className="tag tag-neutral">Profil</span>
              </div>
              <h1 className="t-display mb-1">
                {form.displayName || 'MON PROFIL'}
              </h1>
              <p className="text-sm" style={{ color: 'var(--s-text-dim)' }}>Modifie tes informations, tes jeux et ta disponibilité.</p>
            </div>
          </div>
        </header>

        <div className="grid grid-cols-3 gap-6 animate-fade-in-d1">

          {/* ─── COLONNE GAUCHE ────────────────────────────────────────────── */}
          <div className="col-span-2 space-y-6">

            {/* Identité */}
            <div className="pillar-card panel relative group transition-all duration-200">
              <div className="h-[3px]" style={{ background: 'linear-gradient(90deg, var(--s-gold), rgba(255,184,0,0.3), transparent 70%)' }} />
              <div className="absolute top-0 right-0 w-[180px] h-[180px] pointer-events-none opacity-[0.05]"
                style={{ background: 'radial-gradient(circle at top right, var(--s-gold), transparent 70%)' }} />
              <div className="relative z-[1]">
                <div className="panel-header">
                  <div className="flex items-center gap-2">
                    <User size={13} style={{ color: 'var(--s-gold)' }} />
                    <span className="t-label" style={{ color: 'var(--s-text)' }}>IDENTITÉ</span>
                  </div>
                  <span className="tag tag-gold" style={{ fontSize: '8px' }}>OBLIGATOIRE</span>
                </div>
                <div className="p-5 space-y-5">
                  <div className="grid grid-cols-2 gap-5">
                    <div>
                      <label className="t-label block mb-2">Pseudo affiché *</label>
                      <input type="text" value={form.displayName}
                        onChange={e => setForm(prev => ({ ...prev, displayName: e.target.value }))}
                        className="settings-input w-full" placeholder="Ton pseudo Springs" maxLength={32} />
                    </div>
                    <div>
                      <label className="t-label block mb-2">Avatar (URL image)</label>
                      <input type="url" value={form.avatarUrl}
                        onChange={e => setForm(prev => ({ ...prev, avatarUrl: e.target.value }))}
                        className="settings-input w-full" placeholder="https://..." />
                      <p className="text-xs mt-1" style={{ color: 'var(--s-text-muted)' }}>Vide = photo Discord</p>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-5">
                    <div>
                      <label className="t-label block mb-2">Pays *</label>
                      <select value={form.country}
                        onChange={e => setForm(prev => ({ ...prev, country: e.target.value }))}
                        className="settings-input w-full">
                        <option value="">Sélectionner...</option>
                        {countries.map(c => (
                          <option key={c.code} value={c.code}>{c.flag} {c.name}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="t-label block mb-2">Date de naissance *</label>
                      <input type="date" value={form.dateOfBirth}
                        onChange={e => setForm(prev => ({ ...prev, dateOfBirth: e.target.value }))}
                        className="settings-input w-full" max={new Date().toISOString().split('T')[0]} />
                      <p className="text-xs mt-1" style={{ color: 'var(--s-text-muted)' }}>Seul ton âge sera visible</p>
                    </div>
                  </div>

                  <MarkdownEditor
                    label="Bio (optionnel)"
                    value={form.bio}
                    onChange={v => setForm(prev => ({ ...prev, bio: v }))}
                    placeholder="Quelques mots sur toi..."
                    maxLength={300}
                    rows={3}
                    taRef={bioRef}
                  />
                </div>
              </div>
            </div>

            {/* Jeux pratiqués */}
            <div className="pillar-card panel relative overflow-hidden group transition-all duration-200">
              <div className="h-[3px]" style={{ background: 'linear-gradient(90deg, rgba(255,255,255,0.2), transparent 60%)' }} />
              <div className="relative z-[1]">
                <div className="panel-header">
                  <div className="flex items-center gap-2">
                    <Gamepad2 size={13} style={{ color: 'var(--s-text-dim)' }} />
                    <span className="t-label" style={{ color: 'var(--s-text)' }}>JEUX PRATIQUÉS</span>
                  </div>
                  <span className="tag tag-neutral" style={{ fontSize: '8px' }}>MIN. 1</span>
                </div>
                <div className="p-5 space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <button type="button" onClick={() => toggleGame('rocket_league')}
                      className="p-4 text-left transition-all duration-150 relative overflow-hidden"
                      style={{
                        background: form.games.includes('rocket_league') ? 'rgba(0,129,255,0.08)' : 'var(--s-elevated)',
                        border: form.games.includes('rocket_league') ? '2px solid rgba(0,129,255,0.4)' : '2px solid var(--s-border)',
                        cursor: 'pointer',
                      }}>
                      {form.games.includes('rocket_league') && (
                        <div className="absolute top-0 right-0 w-24 h-24 pointer-events-none opacity-[0.08]"
                          style={{ background: 'radial-gradient(circle at top right, var(--s-blue), transparent 70%)' }} />
                      )}
                      <div className="relative z-[1] flex items-center gap-3">
                        <div className="w-8 h-8 flex items-center justify-center" style={{ background: 'rgba(0,129,255,0.1)', border: '1px solid rgba(0,129,255,0.2)' }}>
                          <Gamepad2 size={14} style={{ color: 'var(--s-blue)' }} />
                        </div>
                        <span className="text-sm font-semibold" style={{ color: form.games.includes('rocket_league') ? 'var(--s-blue)' : 'var(--s-text)' }}>Rocket League</span>
                        {form.games.includes('rocket_league') && <CheckCircle size={14} className="ml-auto" style={{ color: 'var(--s-blue)' }} />}
                      </div>
                    </button>

                    <button type="button" onClick={() => toggleGame('trackmania')}
                      className="p-4 text-left transition-all duration-150 relative overflow-hidden"
                      style={{
                        background: form.games.includes('trackmania') ? 'rgba(0,217,54,0.08)' : 'var(--s-elevated)',
                        border: form.games.includes('trackmania') ? '2px solid rgba(0,217,54,0.4)' : '2px solid var(--s-border)',
                        cursor: 'pointer',
                      }}>
                      {form.games.includes('trackmania') && (
                        <div className="absolute top-0 right-0 w-24 h-24 pointer-events-none opacity-[0.08]"
                          style={{ background: 'radial-gradient(circle at top right, var(--s-green), transparent 70%)' }} />
                      )}
                      <div className="relative z-[1] flex items-center gap-3">
                        <div className="w-8 h-8 flex items-center justify-center" style={{ background: 'rgba(0,217,54,0.1)', border: '1px solid rgba(0,217,54,0.2)' }}>
                          <Gamepad2 size={14} style={{ color: 'var(--s-green)' }} />
                        </div>
                        <span className="text-sm font-semibold" style={{ color: form.games.includes('trackmania') ? 'var(--s-green)' : 'var(--s-text)' }}>Trackmania</span>
                        {form.games.includes('trackmania') && <CheckCircle size={14} className="ml-auto" style={{ color: 'var(--s-green)' }} />}
                      </div>
                    </button>
                  </div>

                  {form.games.includes('rocket_league') && (
                    <div className="p-4 space-y-4 relative overflow-hidden" style={{ background: 'rgba(0,129,255,0.04)', border: '1px solid rgba(0,129,255,0.15)' }}>
                      <div className="h-[2px] -mt-4 -mx-4 mb-4" style={{ background: 'linear-gradient(90deg, var(--s-blue), transparent 60%)' }} />
                      <div className="flex items-center gap-2">
                        <span className="tag tag-blue" style={{ fontSize: '9px' }}>RL</span>
                        <span className="t-label" style={{ color: 'var(--s-blue)' }}>Config Rocket League</span>
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <label className="t-label block mb-2">Pseudo Epic Games *</label>
                          <input type="text" value={form.epicAccountId}
                            onChange={e => setForm(prev => ({ ...prev, epicAccountId: e.target.value }))}
                            className="settings-input w-full" placeholder="Ton pseudo Epic Games" />
                        </div>
                        <div>
                          <label className="t-label block mb-2">RL Tracker URL (optionnel)</label>
                          <input type="url" value={form.rlTrackerUrl}
                            onChange={e => setForm(prev => ({ ...prev, rlTrackerUrl: e.target.value }))}
                            className="settings-input w-full" placeholder="https://rocketleague.tracker.network/..." />
                        </div>
                      </div>
                    </div>
                  )}

                  {form.games.includes('trackmania') && (
                    <div className="p-4 space-y-4 relative overflow-hidden" style={{ background: 'rgba(0,217,54,0.04)', border: '1px solid rgba(0,217,54,0.15)' }}>
                      <div className="h-[2px] -mt-4 -mx-4 mb-4" style={{ background: 'linear-gradient(90deg, var(--s-green), transparent 60%)' }} />
                      <div className="flex items-center gap-2">
                        <span className="tag tag-green" style={{ fontSize: '9px' }}>TM</span>
                        <span className="t-label" style={{ color: 'var(--s-green)' }}>Config Trackmania</span>
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <label className="t-label block mb-2">Pseudo Ubisoft/Nadeo *</label>
                          <input type="text" value={form.pseudoTM}
                            onChange={e => setForm(prev => ({ ...prev, pseudoTM: e.target.value }))}
                            className="settings-input w-full" placeholder="Ton pseudo en jeu" />
                        </div>
                        <div>
                          <label className="t-label block mb-2">Login TM (optionnel)</label>
                          <input type="text" value={form.loginTM}
                            onChange={e => setForm(prev => ({ ...prev, loginTM: e.target.value }))}
                            className="settings-input w-full" placeholder="Identifiant Ubisoft/Nadeo" />
                        </div>
                      </div>
                      <div>
                        <label className="t-label block mb-2">URL Trackmania.io (optionnel)</label>
                        <input type="url" value={form.tmIoUrl}
                          onChange={e => setForm(prev => ({ ...prev, tmIoUrl: e.target.value }))}
                          className="settings-input w-full" placeholder="https://trackmania.io/#/player/..." />
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* ─── COLONNE DROITE ────────────────────────────────────────────── */}
          <div className="space-y-6">

            {/* Sauvegarder (en haut pour être visible) */}
            <div className="pillar-card panel relative overflow-hidden group transition-all duration-200">
              <div className="h-[3px]" style={{ background: 'linear-gradient(90deg, var(--s-gold), rgba(255,184,0,0.3), transparent 70%)' }} />
              <div className="absolute top-0 right-0 w-[150px] h-[150px] pointer-events-none opacity-[0.06]"
                style={{ background: 'radial-gradient(circle at top right, var(--s-gold), transparent 70%)' }} />
              <div className="relative z-[1] p-5 space-y-3">
                {error && (
                  <div className="p-3 flex items-start gap-2" style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)' }}>
                    <AlertCircle size={14} className="flex-shrink-0 mt-0.5" style={{ color: '#ef4444' }} />
                    <p className="text-xs" style={{ color: '#ef4444' }}>{error}</p>
                  </div>
                )}

                {saved && (
                  <div className="p-3 flex items-center gap-2" style={{ background: 'rgba(0,217,54,0.08)', border: '1px solid rgba(0,217,54,0.25)' }}>
                    <CheckCircle size={14} style={{ color: '#00D936' }} />
                    <p className="text-xs font-semibold" style={{ color: '#00D936' }}>Profil sauvegardé !</p>
                  </div>
                )}

                <button onClick={handleSave} disabled={saving}
                  className="btn-springs btn-primary bevel-sm w-full justify-center">
                  {saving ? (
                    <><Loader2 size={14} className="animate-spin" /> Sauvegarde...</>
                  ) : (
                    <><Save size={14} /> Sauvegarder</>
                  )}
                </button>

                <button onClick={() => router.push(`/profile/${firebaseUser?.uid}`)}
                  className="btn-springs btn-secondary bevel-sm w-full justify-center">
                  Voir mon profil <ChevronRight size={14} />
                </button>
              </div>
            </div>

            {/* Recrutement */}
            <div className="pillar-card panel relative group transition-all duration-200">
              <div className="h-[3px]" style={{ background: `linear-gradient(90deg, ${form.isAvailableForRecruitment ? 'var(--s-gold)' : 'rgba(255,255,255,0.15)'}, transparent 60%)` }} />
              {form.isAvailableForRecruitment && (
                <div className="absolute top-0 right-0 w-[150px] h-[150px] pointer-events-none opacity-[0.06]"
                  style={{ background: 'radial-gradient(circle at top right, var(--s-gold), transparent 70%)' }} />
              )}
              <div className="relative z-[1]">
                <div className="panel-header">
                  <div className="flex items-center gap-2">
                    <Search size={13} style={{ color: form.isAvailableForRecruitment ? 'var(--s-gold)' : 'var(--s-text-dim)' }} />
                    <span className="t-label" style={{ color: 'var(--s-text)' }}>RECRUTEMENT</span>
                  </div>
                </div>
                <div className="p-5 space-y-4">
                  <button type="button"
                    onClick={() => setForm(prev => ({ ...prev, isAvailableForRecruitment: !prev.isAvailableForRecruitment }))}
                    className="w-full p-3.5 flex items-center justify-between transition-all duration-150"
                    style={{
                      background: form.isAvailableForRecruitment ? 'rgba(255,184,0,0.08)' : 'var(--s-elevated)',
                      border: form.isAvailableForRecruitment ? '1px solid rgba(255,184,0,0.25)' : '1px solid var(--s-border)',
                      cursor: 'pointer',
                    }}>
                    <span className="text-xs font-semibold" style={{ color: form.isAvailableForRecruitment ? 'var(--s-gold)' : 'var(--s-text-dim)' }}>
                      Je suis disponible
                    </span>
                    <div className="w-9 h-[18px] relative" style={{
                      background: form.isAvailableForRecruitment ? 'var(--s-gold)' : 'var(--s-elevated)',
                      border: `1px solid ${form.isAvailableForRecruitment ? 'var(--s-gold)' : 'var(--s-border)'}`,
                    }}>
                      <div className="absolute top-[2px] w-3 h-[12px] transition-all duration-200"
                        style={{
                          background: form.isAvailableForRecruitment ? '#000' : 'var(--s-text-muted)',
                          left: form.isAvailableForRecruitment ? '18px' : '2px',
                        }} />
                    </div>
                  </button>

                  {form.isAvailableForRecruitment && (
                    <>
                      <div>
                        <label className="t-label block mb-2">Rôle recherché</label>
                        <div className="flex gap-2 flex-wrap">
                          {['joueur', 'coach', 'manager'].map(role => (
                            <button key={role} type="button"
                              onClick={() => setForm(prev => ({ ...prev, recruitmentRole: role }))}
                              className="tag transition-all duration-150"
                              style={{
                                background: form.recruitmentRole === role ? 'rgba(255,184,0,0.1)' : 'transparent',
                                color: form.recruitmentRole === role ? 'var(--s-gold)' : 'var(--s-text-dim)',
                                borderColor: form.recruitmentRole === role ? 'rgba(255,184,0,0.3)' : 'var(--s-border)',
                                padding: '5px 12px',
                                fontSize: '11px',
                                cursor: 'pointer',
                              }}>
                              {role.charAt(0).toUpperCase() + role.slice(1)}
                            </button>
                          ))}
                        </div>
                      </div>

                      <MarkdownEditor
                        label="Message"
                        value={form.recruitmentMessage}
                        onChange={v => setForm(prev => ({ ...prev, recruitmentMessage: v }))}
                        placeholder="Dispo le soir, je cherche une équipe RL compétitive..."
                        maxLength={500}
                        rows={3}
                        taRef={recruitRef}
                      />
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
