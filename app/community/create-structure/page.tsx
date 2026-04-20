'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { useAuth } from '@/context/AuthContext';
import { api, ApiError } from '@/lib/api-client';
import {
  Save, Shield, Gamepad2, Users, MessageSquare, Image as ImageIcon,
  AlertCircle, CheckCircle, Loader2, ExternalLink, Hash, Building2,
  ChevronRight
} from 'lucide-react';
import Breadcrumbs from '@/components/ui/Breadcrumbs';

const LEGAL_STATUSES = [
  { value: 'none', label: 'Aucune' },
  { value: 'asso_1901', label: 'Association loi 1901' },
  { value: 'auto_entreprise', label: 'Auto-entreprise' },
  { value: 'sas_sarl', label: 'SAS / SARL' },
  { value: 'other', label: 'Autre' },
];

type FormData = {
  name: string;
  tag: string;
  logoUrl: string;
  description: string;
  games: string[];
  legalStatus: string;
  teamCount: string;
  staffCount: string;
  discordUrl: string;
  message: string;
};

const defaultForm: FormData = {
  name: '',
  tag: '',
  logoUrl: '',
  description: '',
  games: [],
  legalStatus: 'none',
  teamCount: '',
  staffCount: '',
  discordUrl: '',
  message: '',
};

export default function CreateStructurePage() {
  const { user, firebaseUser, loading: authLoading } = useAuth();
  const router = useRouter();
  const [form, setForm] = useState<FormData>(defaultForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [existingCount, setExistingCount] = useState(0);
  const [loadingExisting, setLoadingExisting] = useState(true);
  const [logoPreview, setLogoPreview] = useState(false);

  // Vérifier les structures existantes du fondateur
  useEffect(() => {
    if (!firebaseUser) return;
    async function checkExisting() {
      try {
        const data = await api<{ structures?: { status: string }[] }>('/api/structures/request');
        setExistingCount(data.structures?.filter(s =>
          s.status === 'pending_validation' || s.status === 'active'
        ).length ?? 0);
      } catch (err) {
        console.error('[CreateStructure] check existing error:', err);
      }
      setLoadingExisting(false);
    }
    checkExisting();
  }, [firebaseUser]);

  // Redirect si pas connecté
  useEffect(() => {
    if (!authLoading && !firebaseUser) {
      router.push('/');
    }
  }, [authLoading, firebaseUser, router]);

  function toggleGame(game: string) {
    setForm(prev => ({
      ...prev,
      games: prev.games.includes(game)
        ? prev.games.filter(g => g !== game)
        : [...prev.games, game]
    }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    // Validation client
    if (!form.name.trim()) return setError('Le nom de la structure est obligatoire.');
    if (!form.tag.trim()) return setError('Le tag est obligatoire.');
    if (form.tag.trim().length > 5) return setError('Le tag ne peut pas dépasser 5 caractères.');
    if (form.games.length === 0) return setError('Sélectionne au moins un jeu.');
    if (!form.description.trim()) return setError('La description est obligatoire.');

    setSaving(true);
    try {
      await api('/api/structures/request', {
        method: 'POST',
        body: form,
      });
      router.push('/community?structure_requested=1');
    } catch (err) {
      console.error('[CreateStructure] submit error:', err);
      setError(err instanceof ApiError ? err.message : 'Erreur réseau.');
      setSaving(false);
    }
  }

  if (authLoading || loadingExisting) {
    return (
      <div className="min-h-screen px-8 py-8 flex items-center justify-center">
        <Loader2 size={24} className="animate-spin" style={{ color: 'var(--s-text-dim)' }} />
      </div>
    );
  }

  if (existingCount >= 2) {
    return (
      <div className="min-h-screen px-8 py-8 flex items-center justify-center">
        <div className="panel p-10 text-center max-w-md">
          <AlertCircle size={32} className="mx-auto mb-4" style={{ color: 'var(--s-gold)' }} />
          <h2 className="font-display text-2xl mb-2">LIMITE ATTEINTE</h2>
          <p className="t-body">Tu as déjà 2 structures (en attente ou actives). Tu ne peux pas en créer davantage.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen px-8 py-8 space-y-8 max-w-3xl">

      <Breadcrumbs items={[
        { label: 'Communauté', href: '/community' },
        { label: 'Structures', href: '/community/structures' },
        { label: 'Créer une structure' },
      ]} />

      {/* Header */}
      <header className="bevel animate-fade-in relative overflow-hidden" style={{ background: 'var(--s-surface)', border: '1px solid var(--s-border)' }}>
        <div className="h-[3px]" style={{ background: 'linear-gradient(90deg, var(--s-gold), var(--s-gold), transparent 80%)' }} />
        <div className="absolute top-0 right-0 w-[300px] h-[200px] pointer-events-none opacity-[0.05]"
          style={{ background: 'radial-gradient(ellipse at top right, var(--s-gold), transparent 70%)' }} />
        <div className="relative z-[1] p-8">
          <div className="flex items-center gap-3 mb-2">
            <div className="p-2" style={{ background: 'rgba(255,184,0,0.1)', border: '1px solid rgba(255,184,0,0.25)' }}>
              <Building2 size={18} style={{ color: 'var(--s-gold)' }} />
            </div>
            <h1 className="font-display text-3xl" style={{ letterSpacing: '0.03em' }}>CRÉER UNE STRUCTURE</h1>
          </div>
          <p className="t-body mt-2" style={{ color: 'var(--s-text-dim)' }}>
            Remplis ce formulaire pour soumettre ta demande. Un entretien vocal sur Discord sera organisé avec l&apos;équipe Springs avant validation.
          </p>
        </div>
      </header>

      {/* Formulaire */}
      <form onSubmit={handleSubmit} className="space-y-6 animate-fade-in-d1">

        {/* ─── Identité ──────────────────────────────────────────── */}
        <div className="panel">
          <div className="panel-header">
            <div className="flex items-center gap-2">
              <Shield size={13} style={{ color: 'var(--s-gold)' }} />
              <span className="t-label" style={{ color: 'var(--s-text)' }}>IDENTITÉ</span>
            </div>
          </div>
          <div className="panel-body space-y-5">

            {/* Nom + Tag */}
            <div className="grid grid-cols-3 gap-4">
              <div className="col-span-2">
                <label className="t-label block mb-2">Nom de la structure *</label>
                <input type="text" className="settings-input w-full" placeholder="Ex: Springs E-Sport"
                  value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
              </div>
              <div>
                <label className="t-label block mb-2">Tag *</label>
                <div className="relative">
                  <Hash size={12} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--s-text-muted)' }} />
                  <input type="text" className="settings-input w-full pl-8" placeholder="EXA" maxLength={5}
                    value={form.tag} onChange={e => setForm({ ...form, tag: e.target.value.toUpperCase() })}
                    style={{ textTransform: 'uppercase' }} />
                </div>
              </div>
            </div>

            {/* Logo */}
            <div>
              <label className="t-label block mb-2">Logo (URL, format carré, fond transparent)</label>
              <div className="flex gap-3 items-start">
                <input type="url" className="settings-input flex-1" placeholder="https://exemple.com/logo.png"
                  value={form.logoUrl} onChange={e => { setForm({ ...form, logoUrl: e.target.value }); setLogoPreview(false); }} />
                {form.logoUrl && (
                  <button type="button" onClick={() => setLogoPreview(!logoPreview)}
                    className="btn-springs btn-secondary" style={{ padding: '8px 12px', fontSize: '11px' }}>
                    <ImageIcon size={12} /> {logoPreview ? 'Masquer' : 'Aperçu'}
                  </button>
                )}
              </div>
              {logoPreview && form.logoUrl && (
                <div className="mt-3 p-4 flex items-center gap-4" style={{ background: 'var(--s-elevated)', border: '1px solid var(--s-border)' }}>
                  <div className="w-16 h-16 relative flex-shrink-0 overflow-hidden"
                    style={{ background: 'repeating-conic-gradient(#333 0% 25%, #222 0% 50%) 50%/16px 16px' }}>
                    <Image src={form.logoUrl} alt="Logo preview" fill className="object-contain" unoptimized />
                  </div>
                  <p className="t-mono text-xs" style={{ color: 'var(--s-text-muted)' }}>
                    Fond en damier = zones transparentes
                  </p>
                </div>
              )}
            </div>

            {/* Description */}
            <div>
              <label className="t-label block mb-2">Description *</label>
              <textarea className="settings-input w-full" rows={4}
                placeholder="Décris ta structure en quelques lignes : objectifs, histoire, ambitions..."
                value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} />
            </div>
          </div>
        </div>

        {/* ─── Jeux ──────────────────────────────────────────── */}
        <div className="panel">
          <div className="panel-header">
            <div className="flex items-center gap-2">
              <Gamepad2 size={13} style={{ color: 'var(--s-text)' }} />
              <span className="t-label" style={{ color: 'var(--s-text)' }}>JEUX *</span>
            </div>
          </div>
          <div className="panel-body">
            <div className="flex gap-3">
              <button type="button" onClick={() => toggleGame('rocket_league')}
                className="flex-1 p-4 text-center transition-all duration-150"
                style={{
                  background: form.games.includes('rocket_league') ? 'rgba(0,129,255,0.1)' : 'var(--s-elevated)',
                  border: `1px solid ${form.games.includes('rocket_league') ? 'rgba(0,129,255,0.4)' : 'var(--s-border)'}`,
                }}>
                <Gamepad2 size={20} className="mx-auto mb-2" style={{ color: form.games.includes('rocket_league') ? '#4da6ff' : 'var(--s-text-muted)' }} />
                <p className="font-display text-sm" style={{ color: form.games.includes('rocket_league') ? '#4da6ff' : 'var(--s-text-dim)' }}>
                  ROCKET LEAGUE
                </p>
              </button>
              <button type="button" onClick={() => toggleGame('trackmania')}
                className="flex-1 p-4 text-center transition-all duration-150"
                style={{
                  background: form.games.includes('trackmania') ? 'rgba(0,217,54,0.1)' : 'var(--s-elevated)',
                  border: `1px solid ${form.games.includes('trackmania') ? 'rgba(0,217,54,0.4)' : 'var(--s-border)'}`,
                }}>
                <Gamepad2 size={20} className="mx-auto mb-2" style={{ color: form.games.includes('trackmania') ? '#33ff66' : 'var(--s-text-muted)' }} />
                <p className="font-display text-sm" style={{ color: form.games.includes('trackmania') ? '#33ff66' : 'var(--s-text-dim)' }}>
                  TRACKMANIA
                </p>
              </button>
            </div>
          </div>
        </div>

        {/* ─── Informations ──────────────────────────────────────────── */}
        <div className="panel">
          <div className="panel-header">
            <div className="flex items-center gap-2">
              <Users size={13} style={{ color: 'var(--s-text)' }} />
              <span className="t-label" style={{ color: 'var(--s-text)' }}>INFORMATIONS</span>
            </div>
          </div>
          <div className="panel-body space-y-5">

            {/* Forme juridique */}
            <div>
              <label className="t-label block mb-2">Forme juridique</label>
              <select className="settings-input w-full"
                value={form.legalStatus} onChange={e => setForm({ ...form, legalStatus: e.target.value })}>
                {LEGAL_STATUSES.map(s => (
                  <option key={s.value} value={s.value}>{s.label}</option>
                ))}
              </select>
            </div>

            {/* Nombre équipes + staff */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="t-label block mb-2">Nombre d&apos;équipes actuelles</label>
                <input type="number" min="0" className="settings-input w-full" placeholder="0"
                  value={form.teamCount} onChange={e => setForm({ ...form, teamCount: e.target.value })} />
              </div>
              <div>
                <label className="t-label block mb-2">Nombre de staff</label>
                <input type="number" min="0" className="settings-input w-full" placeholder="0"
                  value={form.staffCount} onChange={e => setForm({ ...form, staffCount: e.target.value })} />
                <p className="t-mono mt-1" style={{ fontSize: '10px', color: 'var(--s-text-muted)' }}>
                  Co-fondateurs, managers, coachs
                </p>
              </div>
            </div>

            {/* Discord */}
            <div>
              <label className="t-label block mb-2">Serveur Discord</label>
              <input type="url" className="settings-input w-full" placeholder="https://discord.gg/..."
                value={form.discordUrl} onChange={e => setForm({ ...form, discordUrl: e.target.value })} />
            </div>
          </div>
        </div>

        {/* ─── Message ──────────────────────────────────────────── */}
        <div className="panel">
          <div className="panel-header">
            <div className="flex items-center gap-2">
              <MessageSquare size={13} style={{ color: 'var(--s-text)' }} />
              <span className="t-label" style={{ color: 'var(--s-text)' }}>MESSAGE (OPTIONNEL)</span>
            </div>
          </div>
          <div className="panel-body">
            <textarea className="settings-input w-full" rows={3}
              placeholder="Un message pour l'équipe Springs ? Motivation, projets, questions..."
              value={form.message} onChange={e => setForm({ ...form, message: e.target.value })} />
          </div>
        </div>

        {/* ─── Erreur + Submit ──────────────────────────────────────────── */}
        {error && (
          <div className="flex items-center gap-2 px-4 py-3" style={{ background: 'rgba(255,50,50,0.1)', border: '1px solid rgba(255,50,50,0.3)' }}>
            <AlertCircle size={14} style={{ color: '#ff5555' }} />
            <span className="text-sm" style={{ color: '#ff5555' }}>{error}</span>
          </div>
        )}

        <div className="flex items-center gap-4">
          <button type="submit" disabled={saving}
            className="btn-springs btn-primary bevel-sm flex items-center gap-2">
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
            <span>{saving ? 'Envoi...' : 'Soumettre la demande'}</span>
          </button>
          <p className="t-mono text-xs" style={{ color: 'var(--s-text-muted)' }}>
            Un entretien vocal sera organisé avant validation.
          </p>
        </div>
      </form>
    </div>
  );
}
