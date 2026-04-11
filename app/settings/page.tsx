'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { useAuth } from '@/context/AuthContext';
import { auth } from '@/lib/firebase';
import { countries } from '@/lib/countries';
import {
  Save, User, Gamepad2, Shield, Search, ChevronRight,
  Calendar, Globe, MessageSquare, Image as ImageIcon,
  AlertCircle, CheckCircle, Loader2
} from 'lucide-react';

type FormData = {
  displayName: string;
  avatarUrl: string;
  bio: string;
  country: string;
  dateOfBirth: string;
  games: string[];
  epicAccountId: string;
  pseudoTM: string;
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
  pseudoTM: '',
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
            epicAccountId: data.epicAccountId ?? '',
            pseudoTM: data.pseudoTM ?? '',
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
    <div className="min-h-screen px-8 py-8 space-y-8">

      {/* ─── HEADER ───────────────────────────────────────────────────────── */}
      <header className="bevel animate-fade-in relative overflow-hidden" style={{ background: 'var(--s-surface)', border: '1px solid var(--s-border)' }}>
        <div className="h-[3px]" style={{ background: 'linear-gradient(90deg, var(--s-violet), var(--s-violet-light), transparent 80%)' }} />
        <div className="absolute top-0 left-0 w-[400px] h-[300px] pointer-events-none opacity-[0.05]"
          style={{ background: 'radial-gradient(ellipse at top left, var(--s-violet), transparent 70%)' }} />

        <div className="relative z-[1] p-8 flex items-center gap-6">
          <div className="flex-shrink-0 w-20 h-20 relative overflow-hidden"
            style={{ background: 'var(--s-elevated)', border: '2px solid var(--s-border)' }}>
            {avatarSrc ? (
              <Image src={avatarSrc} alt="Avatar" fill className="object-cover" unoptimized />
            ) : (
              <div className="w-full h-full flex items-center justify-center">
                <User size={32} style={{ color: 'var(--s-text-muted)' }} />
              </div>
            )}
          </div>

          <div>
            <div className="flex items-center gap-3 mb-2">
              <span className="tag tag-violet">Paramètres</span>
              <span className="tag tag-neutral">Profil</span>
            </div>
            <h1 className="font-display text-3xl" style={{ letterSpacing: '0.03em' }}>
              {form.displayName || 'MON PROFIL'}
            </h1>
            <p className="t-body mt-1">Modifie tes informations, tes jeux et ta disponibilité.</p>
          </div>
        </div>
      </header>

      <div className="grid grid-cols-3 gap-6 animate-fade-in-d1">

        {/* ─── COLONNE GAUCHE : Infos perso ────────────────────────────────── */}
        <div className="col-span-2 space-y-6">

          {/* Identité */}
          <div className="panel">
            <div className="panel-header">
              <div className="flex items-center gap-2">
                <User size={13} style={{ color: 'var(--s-violet-light)' }} />
                <span className="t-label" style={{ color: 'var(--s-text)' }}>IDENTITÉ</span>
              </div>
              <span className="tag tag-neutral">Obligatoire</span>
            </div>
            <div className="panel-body space-y-5">
              <div>
                <label className="t-label block mb-2">Pseudo affiché</label>
                <input type="text" value={form.displayName}
                  onChange={e => setForm(prev => ({ ...prev, displayName: e.target.value }))}
                  className="settings-input" placeholder="Ton pseudo Springs" maxLength={32} />
              </div>

              <div>
                <label className="t-label block mb-2">
                  <ImageIcon size={10} className="inline mr-1" />
                  Avatar (URL image) — laisse vide pour garder ta photo Discord
                </label>
                <input type="url" value={form.avatarUrl}
                  onChange={e => setForm(prev => ({ ...prev, avatarUrl: e.target.value }))}
                  className="settings-input" placeholder="https://exemple.com/mon-avatar.png" />
              </div>

              <div>
                <label className="t-label block mb-2">
                  <Globe size={10} className="inline mr-1" />
                  Pays
                </label>
                <select value={form.country}
                  onChange={e => setForm(prev => ({ ...prev, country: e.target.value }))}
                  className="settings-input">
                  <option value="">Sélectionner un pays</option>
                  {countries.map(c => (
                    <option key={c.code} value={c.code}>{c.flag} {c.name}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="t-label block mb-2">
                  <Calendar size={10} className="inline mr-1" />
                  Date de naissance
                </label>
                <input type="date" value={form.dateOfBirth}
                  onChange={e => setForm(prev => ({ ...prev, dateOfBirth: e.target.value }))}
                  className="settings-input" max={new Date().toISOString().split('T')[0]} />
                <p className="text-xs mt-1.5" style={{ color: 'var(--s-text-muted)' }}>
                  Jamais affichée publiquement — seul ton âge sera visible.
                </p>
              </div>

              <div>
                <label className="t-label block mb-2">
                  <MessageSquare size={10} className="inline mr-1" />
                  Bio (optionnel)
                </label>
                <textarea value={form.bio}
                  onChange={e => setForm(prev => ({ ...prev, bio: e.target.value }))}
                  className="settings-input" rows={3} placeholder="Quelques mots sur toi..." maxLength={300}
                  style={{ resize: 'vertical' }} />
              </div>
            </div>
          </div>

          {/* Jeux pratiqués */}
          <div className="panel">
            <div className="panel-header">
              <div className="flex items-center gap-2">
                <Gamepad2 size={13} style={{ color: 'var(--s-text-dim)' }} />
                <span className="t-label" style={{ color: 'var(--s-text)' }}>JEUX PRATIQUÉS</span>
              </div>
              <span className="tag tag-neutral">Min. 1</span>
            </div>
            <div className="panel-body space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <button type="button" onClick={() => toggleGame('rocket_league')}
                  className="p-4 text-left transition-all duration-150"
                  style={{
                    background: form.games.includes('rocket_league') ? 'rgba(0,129,255,0.08)' : 'var(--s-elevated)',
                    border: form.games.includes('rocket_league') ? '2px solid rgba(0,129,255,0.4)' : '2px solid var(--s-border)',
                  }}>
                  <div className="flex items-center gap-3">
                    <span className="tag tag-blue">RL</span>
                    <span className="text-sm font-semibold" style={{ color: 'var(--s-text)' }}>Rocket League</span>
                  </div>
                </button>

                <button type="button" onClick={() => toggleGame('trackmania')}
                  className="p-4 text-left transition-all duration-150"
                  style={{
                    background: form.games.includes('trackmania') ? 'rgba(0,217,54,0.08)' : 'var(--s-elevated)',
                    border: form.games.includes('trackmania') ? '2px solid rgba(0,217,54,0.4)' : '2px solid var(--s-border)',
                  }}>
                  <div className="flex items-center gap-3">
                    <span className="tag tag-green">TM</span>
                    <span className="text-sm font-semibold" style={{ color: 'var(--s-text)' }}>Trackmania</span>
                  </div>
                </button>
              </div>

              {form.games.includes('rocket_league') && (
                <div className="p-4 space-y-4" style={{ background: 'rgba(0,129,255,0.04)', border: '1px solid rgba(0,129,255,0.15)' }}>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="tag tag-blue" style={{ fontSize: '9px', padding: '2px 6px' }}>RL</span>
                    <span className="t-label" style={{ color: '#4da6ff' }}>Informations Rocket League</span>
                  </div>
                  <div>
                    <label className="t-label block mb-2">Pseudo Epic Games *</label>
                    <input type="text" value={form.epicAccountId}
                      onChange={e => setForm(prev => ({ ...prev, epicAccountId: e.target.value }))}
                      className="settings-input" placeholder="Ton pseudo Epic Games" />
                    <p className="text-xs mt-1.5" style={{ color: 'var(--s-text-muted)' }}>
                      Utilisé pour récupérer tes stats automatiquement via RL Tracker.
                    </p>
                  </div>
                </div>
              )}

              {form.games.includes('trackmania') && (
                <div className="p-4 space-y-4" style={{ background: 'rgba(0,217,54,0.04)', border: '1px solid rgba(0,217,54,0.15)' }}>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="tag tag-green" style={{ fontSize: '9px', padding: '2px 6px' }}>TM</span>
                    <span className="t-label" style={{ color: '#33ff66' }}>Informations Trackmania</span>
                  </div>
                  <div>
                    <label className="t-label block mb-2">Pseudo Ubisoft/Nadeo *</label>
                    <input type="text" value={form.pseudoTM}
                      onChange={e => setForm(prev => ({ ...prev, pseudoTM: e.target.value }))}
                      className="settings-input" placeholder="Ton pseudo en jeu" />
                  </div>
                  <div>
                    <label className="t-label block mb-2">URL Trackmania.io (optionnel)</label>
                    <input type="url" value={form.tmIoUrl}
                      onChange={e => setForm(prev => ({ ...prev, tmIoUrl: e.target.value }))}
                      className="settings-input" placeholder="https://trackmania.io/#/player/..." />
                    <p className="text-xs mt-1.5" style={{ color: 'var(--s-text-muted)' }}>
                      Pour afficher tes stats TM sur ton profil.
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ─── COLONNE DROITE : Recrutement + Actions ──────────────────────── */}
        <div className="space-y-6">

          {/* Recrutement */}
          <div className="panel">
            <div className="panel-header">
              <div className="flex items-center gap-2">
                <Search size={13} style={{ color: 'var(--s-text-dim)' }} />
                <span className="t-label" style={{ color: 'var(--s-text)' }}>RECRUTEMENT</span>
              </div>
            </div>
            <div className="panel-body space-y-4">
              <button type="button"
                onClick={() => setForm(prev => ({ ...prev, isAvailableForRecruitment: !prev.isAvailableForRecruitment }))}
                className="w-full p-4 flex items-center justify-between transition-all duration-150"
                style={{
                  background: form.isAvailableForRecruitment ? 'rgba(0,217,54,0.08)' : 'var(--s-elevated)',
                  border: form.isAvailableForRecruitment ? '1px solid rgba(0,217,54,0.3)' : '1px solid var(--s-border)',
                }}>
                <span className="text-sm font-semibold" style={{ color: 'var(--s-text)' }}>
                  Je suis disponible
                </span>
                <div className="w-10 h-5 relative" style={{
                  background: form.isAvailableForRecruitment ? '#00D936' : 'var(--s-elevated)',
                  border: `1px solid ${form.isAvailableForRecruitment ? '#00D936' : 'var(--s-border)'}`,
                  borderRadius: '2px',
                }}>
                  <div className="absolute top-[2px] w-4 h-3.5 transition-all duration-200"
                    style={{
                      background: form.isAvailableForRecruitment ? '#fff' : 'var(--s-text-muted)',
                      left: form.isAvailableForRecruitment ? '20px' : '2px',
                    }} />
                </div>
              </button>

              {form.isAvailableForRecruitment && (
                <>
                  <div>
                    <label className="t-label block mb-2">Rôle recherché</label>
                    <div className="flex gap-2">
                      {['joueur', 'coach', 'manager'].map(role => (
                        <button key={role} type="button"
                          onClick={() => setForm(prev => ({ ...prev, recruitmentRole: role }))}
                          className="tag transition-all duration-150 cursor-pointer"
                          style={{
                            background: form.recruitmentRole === role ? 'rgba(0,217,54,0.12)' : 'rgba(255,255,255,0.03)',
                            color: form.recruitmentRole === role ? '#33ff66' : 'var(--s-text-dim)',
                            borderColor: form.recruitmentRole === role ? 'rgba(0,217,54,0.3)' : 'var(--s-border)',
                            padding: '5px 12px',
                            fontSize: '11px',
                          }}>
                          {role.charAt(0).toUpperCase() + role.slice(1)}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <label className="t-label block mb-2">Message</label>
                    <textarea value={form.recruitmentMessage}
                      onChange={e => setForm(prev => ({ ...prev, recruitmentMessage: e.target.value }))}
                      className="settings-input" rows={3} maxLength={500}
                      placeholder="Dispo le soir, je cherche une équipe RL compétitive..."
                      style={{ resize: 'vertical' }} />
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Actions */}
          <div className="panel">
            <div className="panel-header">
              <div className="flex items-center gap-2">
                <Shield size={13} style={{ color: 'var(--s-text-dim)' }} />
                <span className="t-label" style={{ color: 'var(--s-text)' }}>ACTIONS</span>
              </div>
            </div>
            <div className="panel-body space-y-3">
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
                Voir mon profil public <ChevronRight size={14} />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
