'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { api, apiForm, ApiError } from '@/lib/api-client';
import { track } from '@/lib/analytics';
import {
  Save, Shield, Gamepad2, Users, MessageSquare,
  AlertCircle, CheckCircle, Loader2, ExternalLink, Hash, Building2,
  ChevronRight
} from 'lucide-react';
import Breadcrumbs from '@/components/ui/Breadcrumbs';
import PendingImagePicker from '@/components/ui/PendingImagePicker';
import { UPLOAD_LIMITS } from '@/lib/upload-limits';
import DiscordIcon, { AEDRAL_DISCORD_INVITE_URL } from '@/components/icons/DiscordIcon';
import { ALL_GAME_DEFS } from '@/lib/games-registry';

const LEGAL_STATUSES = [
  { value: 'none', label: 'Aucune' },
  { value: 'asso_1901', label: 'Association loi 1901' },
  { value: 'auto_entreprise', label: 'Auto-entreprise' },
  { value: 'sas_sarl', label: 'SAS / SARL' },
  { value: 'other', label: 'Autre' },
];

type StructureFormData = {
  name: string;
  tag: string;
  description: string;
  games: string[];
  legalStatus: string;
  teamCount: string;
  staffCount: string;
  discordUrl: string;
  message: string;
};

const defaultForm: StructureFormData = {
  name: '',
  tag: '',
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
  const [form, setForm] = useState<StructureFormData>(defaultForm);
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [existingCount, setExistingCount] = useState(0);
  const [loadingExisting, setLoadingExisting] = useState(true);
  // État succès post-submit : on AFFICHE une page de confirmation avec le lien
  // Discord en évidence (au lieu de rediriger silencieusement) pour s'assurer
  // que le demandeur rejoint bien le serveur Discord (sinon Matt ne peut pas
  // le contacter pour l'entretien de validation).
  const [submitted, setSubmitted] = useState(false);

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
      const res = await api<{ id?: string }>('/api/structures/request', {
        method: 'POST',
        body: form,
      });
      // Upload du logo APRÈS création : /api/upload/structure-image exige un
      // structureId existant. Échec non bloquant, la demande est envoyée, le
      // logo pourra être ajouté ensuite via Ma structure → Général.
      if (logoFile && res?.id) {
        try {
          const fd = new FormData();
          fd.append('file', logoFile);
          fd.append('structureId', res.id);
          fd.append('type', 'logo');
          await apiForm('/api/upload/structure-image', fd);
        } catch {
          // logo optionnel et éditable plus tard, on n'interrompt pas le flux
        }
      }
      // Au lieu de rediriger silencieusement, on affiche une page de confirmation
      // qui pousse fortement à rejoindre le Discord Aedral (étape nécessaire
      // pour l'entretien de validation par Matt).
      track('structure_requested', {
        gamesCount: form.games?.length ?? 0,
        games: form.games?.join(',') ?? '',
      });
      setSubmitted(true);
      setSaving(false);
    } catch (err) {
      console.error('[CreateStructure] submit error:', err);
      setError(err instanceof ApiError ? err.message : 'Erreur réseau.');
      setSaving(false);
    }
  }

  if (authLoading || loadingExisting) {
    return (
      <div className="min-h-screen px-4 sm:px-6 lg:px-8 py-6 lg:py-8 flex items-center justify-center">
        <Loader2 size={24} className="animate-spin" style={{ color: 'var(--s-text-dim)' }} />
      </div>
    );
  }

  if (existingCount >= 2) {
    return (
      <div className="min-h-screen px-4 sm:px-6 lg:px-8 py-6 lg:py-8 flex items-center justify-center">
        <div className="panel p-10 text-center max-w-md">
          <AlertCircle size={32} className="mx-auto mb-4" style={{ color: 'var(--s-gold)' }} />
          <h2 className="font-display text-2xl mb-2">LIMITE ATTEINTE</h2>
          <p className="t-body">Tu as déjà 2 structures (en attente ou actives). Tu ne peux pas en créer davantage.</p>
        </div>
      </div>
    );
  }

  // ─── Page de confirmation post-submit ──────────────────────────────────
  // Affichée en plein écran après que la demande a été envoyée. Met le
  // Discord Aedral en avant car c'est par là que Matt prendra contact pour
  // l'entretien de validation (sinon il a aucun moyen fiable de joindre
  // le demandeur, Discord en ami est souvent refusé/ignoré).
  if (submitted) {
    return (
      <div className="min-h-screen px-4 sm:px-6 lg:px-8 py-6 lg:py-8 flex items-center justify-center">
        <div className="bevel max-w-xl w-full p-8 sm:p-10 relative overflow-hidden animate-fade-in"
          style={{ background: 'var(--s-surface)', border: '1px solid var(--s-border)' }}>
          <div className="h-[3px] -mx-8 sm:-mx-10 -mt-8 sm:-mt-10 mb-6"
            style={{ background: 'linear-gradient(90deg, var(--s-gold), var(--s-gold), transparent 80%)' }} />
          <div className="text-center mb-6">
            <div className="inline-flex items-center justify-center w-16 h-16 bevel-sm mb-4"
              style={{ background: 'rgba(47,196,107,0.10)', border: '1px solid rgba(47,196,107,0.30)' }}>
              <CheckCircle size={28} style={{ color: '#33ff66' }} />
            </div>
            <h1 className="font-display text-3xl mb-2" style={{ letterSpacing: '0.03em' }}>
              DEMANDE ENVOYÉE
            </h1>
            <p className="text-sm" style={{ color: 'var(--s-text-dim)' }}>
              Ta demande de création de structure a bien été reçue par l&apos;équipe Aedral.
            </p>
          </div>

          {/* CTA Discord, en évidence avec accent or */}
          <div className="bevel-sm p-5 mb-5 relative overflow-hidden"
            style={{ background: 'rgba(255,184,0,0.06)', border: '1px solid rgba(255,184,0,0.35)' }}>
            <div className="flex items-start gap-3 mb-4">
              <div className="flex-shrink-0 w-9 h-9 bevel-sm flex items-center justify-center"
                style={{ background: 'rgba(88,101,242,0.15)', border: '1px solid rgba(88,101,242,0.35)' }}>
                <DiscordIcon size={16} />
              </div>
              <div className="flex-1 min-w-0">
                <h2 className="font-display text-lg mb-1" style={{ color: 'var(--s-gold)', letterSpacing: '0.03em' }}>
                  ÉTAPE OBLIGATOIRE : REJOINS LE DISCORD AEDRAL
                </h2>
                <p className="text-sm" style={{ color: 'var(--s-text)' }}>
                  Un entretien vocal aura lieu avec l&apos;équipe Aedral avant validation. <strong>Sans Discord on ne peut pas te contacter</strong>, ta demande restera en attente.
                </p>
              </div>
            </div>
            <a
              href={AEDRAL_DISCORD_INVITE_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-springs btn-primary bevel-sm w-full flex items-center justify-center gap-2"
            >
              <DiscordIcon size={14} />
              <span>Rejoindre le Discord Aedral</span>
              <ExternalLink size={12} />
            </a>
          </div>

          <div className="text-xs space-y-2" style={{ color: 'var(--s-text-muted)' }}>
            <p>
              <strong style={{ color: 'var(--s-text-dim)' }}>Prochaines étapes :</strong>
            </p>
            <ol className="space-y-1 list-decimal list-inside pl-1">
              <li>Rejoins le serveur Discord ci-dessus (1 clic, 30 secondes)</li>
              <li>Présente-toi dans le salon <code className="t-mono px-1" style={{ background: 'var(--s-elevated)', color: 'var(--s-gold)' }}>#bienvenue</code></li>
              <li>Un dirigeant Aedral te contactera pour l&apos;entretien</li>
              <li>Une fois validée, ta structure deviendra active</li>
            </ol>
          </div>

          <div className="mt-6 flex items-center justify-center gap-3">
            <Link href="/community" className="text-xs" style={{ color: 'var(--s-text-dim)' }}>
              Retour à la communauté →
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen px-4 sm:px-6 lg:px-8 py-6 lg:py-8 space-y-8 max-w-3xl">

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
            Remplis ce formulaire pour soumettre ta demande. Un entretien vocal sur Discord sera organisé avec l&apos;équipe Aedral avant validation.
          </p>
        </div>
      </header>

      {/* Bannière Discord, obligatoire pour que Matt puisse contacter le demandeur.
          Mise en évidence forte (or + icône Discord) pour que personne ne loupe. */}
      <div className="bevel-sm p-4 flex items-start sm:items-center gap-3 flex-col sm:flex-row animate-fade-in"
        style={{ background: 'rgba(255,184,0,0.06)', border: '1px solid rgba(255,184,0,0.35)' }}>
        <div className="flex-shrink-0 w-10 h-10 bevel-sm flex items-center justify-center"
          style={{ background: 'var(--s-elevated)', border: '1px solid var(--s-border)' }}>
          <DiscordIcon size={16} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold" style={{ color: 'var(--s-text)' }}>
            Avant de soumettre : rejoins le Discord Aedral
          </p>
          <p className="text-xs mt-0.5" style={{ color: 'var(--s-text-dim)' }}>
            Un dirigeant te contactera pour l&apos;entretien de validation. <strong>Sans Discord, on ne peut pas te joindre</strong> et ta demande restera en attente.
          </p>
        </div>
        <a
          href={AEDRAL_DISCORD_INVITE_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="btn-springs btn-primary bevel-sm flex items-center gap-2 flex-shrink-0 w-full sm:w-auto justify-center"
          style={{ fontSize: '12px', padding: '8px 14px' }}
        >
          <DiscordIcon size={12} />
          <span>Rejoindre Discord</span>
          <ExternalLink size={11} />
        </a>
      </div>

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
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="sm:col-span-2">
                <label className="t-label block mb-2">Nom de la structure *</label>
                <input type="text" className="settings-input w-full" placeholder="Ex: Springs E-Sport"
                  value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
              </div>
              <div>
                <label className="t-label block mb-2">Tag *</label>
                <div className="relative">
                  <Hash size={12} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--s-text-muted)' }} />
                  <input type="text" className="settings-input has-icon w-full" placeholder="EXA" maxLength={5}
                    value={form.tag} onChange={e => setForm({ ...form, tag: e.target.value.toUpperCase() })}
                    style={{ textTransform: 'uppercase' }} />
                </div>
              </div>
            </div>

            {/* Logo */}
            <PendingImagePicker
              value={logoFile}
              onChange={setLogoFile}
              maxBytes={UPLOAD_LIMITS.STRUCTURE_LOGO_BYTES}
              label="Logo de la structure (optionnel)"
              hint="JPEG, PNG, WebP, GIF, max 2 MB. Format carré, fond transparent recommandé."
              aspect="square"
              disabled={saving}
            />

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
            <div className="flex gap-3 flex-wrap">
              {ALL_GAME_DEFS.map(g => {
                const active = form.games.includes(g.id);
                return (
                  <button
                    key={g.id}
                    type="button"
                    onClick={() => toggleGame(g.id)}
                    className="flex-1 p-4 text-center transition-all duration-150"
                    style={{
                      minWidth: '160px',
                      background: active ? `rgba(${g.colorRgb}, 0.1)` : 'var(--s-elevated)',
                      border: `1px solid ${active ? `rgba(${g.colorRgb}, 0.4)` : 'var(--s-border)'}`,
                    }}
                  >
                    <Gamepad2 size={20} className="mx-auto mb-2"
                      style={{ color: active ? g.colorLight : 'var(--s-text-muted)' }}
                    />
                    <p className="font-display text-sm"
                      style={{ color: active ? g.colorLight : 'var(--s-text-dim)' }}
                    >
                      {g.label.toUpperCase()}
                    </p>
                  </button>
                );
              })}
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
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="t-label block mb-2">Nombre d&apos;équipes actuelles</label>
                <input type="number" min="0" className="settings-input w-full" placeholder="0"
                  value={form.teamCount} onChange={e => setForm({ ...form, teamCount: e.target.value })} />
              </div>
              <div>
                <label className="t-label block mb-2">Nombre de staff</label>
                <input type="number" min="0" className="settings-input w-full" placeholder="0"
                  value={form.staffCount} onChange={e => setForm({ ...form, staffCount: e.target.value })} />
                <p className="t-mono mt-1" style={{ fontSize: '12px', color: 'var(--s-text-muted)' }}>
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
              placeholder="Un message pour l'équipe Aedral ? Motivation, projets, questions..."
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
