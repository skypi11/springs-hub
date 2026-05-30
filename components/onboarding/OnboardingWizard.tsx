'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  User, Globe, Gamepad2, Search, Loader2, ChevronLeft, ChevronRight,
  CheckCircle, X, Sparkles,
} from 'lucide-react';
import Portal from '@/components/ui/Portal';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/components/ui/Toast';
import { api, ApiError } from '@/lib/api-client';
import { track } from '@/lib/analytics';
import { countries } from '@/lib/countries';
import { RL_PLATFORMS, getRLPlatformMeta, type RLPlatform } from '@/lib/rl-platform';
import { VALORANT_RANKS } from '@/lib/valorant-ranks';
import { ALL_GAME_DEFS } from '@/lib/games-registry';
import type { SpringsUser } from '@/types';

// ─── Storage clés ─────────────────────────────────────────────────────────
const DRAFT_KEY = 'aedral_onboarding_draft';
const SKIPPED_KEY = 'aedral_onboarding_skipped';

// L'utilisateur peut skip l'onboarding et passer directement à /settings.
// On garde le flag en localStorage pour ne plus afficher le wizard à ses
// prochaines visites, le gate ProfileCompletionGate continuera quand même
// à le rediriger vers /settings tant que son profil n'est pas complet.
export function markOnboardingSkipped() {
  try { localStorage.setItem(SKIPPED_KEY, '1'); } catch { /* SSR / private mode */ }
}
export function isOnboardingSkipped(): boolean {
  try { return localStorage.getItem(SKIPPED_KEY) === '1'; } catch { return false; }
}
export function clearOnboardingSkip() {
  try { localStorage.removeItem(SKIPPED_KEY); } catch { /* noop */ }
}

// ─── State du wizard ──────────────────────────────────────────────────────
interface WizardData {
  displayName: string;
  dateOfBirth: string;
  country: string;
  games: string[];
  rlPlatform: RLPlatform | '';
  rlPlatformId: string;
  pseudoTM: string;
  tmIoUrl: string;
  valorantRank: string;
  isAvailableForRecruitment: boolean;
  recruitmentRole: string;
}

function initialData(user: SpringsUser | null): WizardData {
  // Pré-remplit depuis le profil existant + draft localStorage si présent
  let draft: Partial<WizardData> = {};
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (raw) draft = JSON.parse(raw) as Partial<WizardData>;
  } catch { /* noop */ }

  return {
    displayName: draft.displayName ?? user?.displayName ?? user?.discordUsername ?? '',
    dateOfBirth: draft.dateOfBirth ?? user?.dateOfBirth ?? '',
    country: draft.country ?? user?.country ?? '',
    games: draft.games ?? user?.games ?? [],
    rlPlatform: draft.rlPlatform ?? (user?.rlPlatform as RLPlatform | undefined) ?? '',
    rlPlatformId: draft.rlPlatformId ?? user?.rlPlatformId ?? '',
    pseudoTM: draft.pseudoTM ?? user?.pseudoTM ?? '',
    tmIoUrl: draft.tmIoUrl ?? user?.tmIoUrl ?? '',
    valorantRank: draft.valorantRank ?? user?.valorantRank ?? '',
    isAvailableForRecruitment: draft.isAvailableForRecruitment ?? user?.isAvailableForRecruitment ?? false,
    recruitmentRole: draft.recruitmentRole ?? user?.recruitmentRole ?? '',
  };
}

// ─── Wizard ────────────────────────────────────────────────────────────────
const TOTAL_STEPS = 4;

export default function OnboardingWizard({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const toast = useToast();
  const { user, refreshProfile } = useAuth();

  const [step, setStep] = useState(1);
  const [data, setData] = useState<WizardData>(() => initialData(user));
  const [saving, setSaving] = useState(false);
  const [stepError, setStepError] = useState('');

  // Persiste à chaque modif pour ne pas perdre si fermeture brutale
  useEffect(() => {
    try { localStorage.setItem(DRAFT_KEY, JSON.stringify(data)); } catch { /* noop */ }
  }, [data]);

  const update = (patch: Partial<WizardData>) => {
    setData(prev => ({ ...prev, ...patch }));
    if (stepError) setStepError('');
  };

  const validateStep = (s: number): string | null => {
    if (s === 1) {
      if (!data.displayName.trim()) return 'Choisis un pseudo.';
      if (!data.dateOfBirth) return 'Renseigne ta date de naissance.';
      const birth = new Date(data.dateOfBirth);
      const today = new Date();
      let age = today.getFullYear() - birth.getFullYear();
      const m = today.getMonth() - birth.getMonth();
      if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--;
      if (age < 13) return 'Tu dois avoir au moins 13 ans.';
    }
    if (s === 2) {
      if (!data.country) return 'Choisis ton pays.';
    }
    if (s === 3) {
      if (data.games.length === 0) return 'Choisis au moins un jeu.';
      // TODO (phase 3 multi-jeux) : déporter ces validators game-specific
      // dans la registry sous forme d'une fonction validateOnboarding(gameId, data)
      // par jeu, pour qu'ajouter Valorant ne demande pas de modifier ce switch.
      if (data.games.includes('rocket_league')) {
        if (!data.rlPlatform) return 'Choisis ta plateforme Rocket League.';
        if (!data.rlPlatformId.trim()) return `Renseigne ton ${getRLPlatformMeta(data.rlPlatform).idLabel}.`;
      }
      if (data.games.includes('trackmania')) {
        if (!data.pseudoTM.trim()) return 'Renseigne ton pseudo Ubisoft/Nadeo.';
        if (!data.tmIoUrl.trim()) return 'Renseigne l\'URL de ton profil Trackmania.io.';
      }
    }
    // Étape 4 : recrutement entièrement optionnel
    return null;
  };

  const goNext = async () => {
    const err = validateStep(step);
    if (err) { setStepError(err); return; }
    if (step < TOTAL_STEPS) {
      setStep(step + 1);
      return;
    }
    // Étape finale : save complet
    setSaving(true);
    setStepError('');
    try {
      await api('/api/profile', {
        method: 'POST',
        body: {
          ...data,
          // Le POST /api/profile attend ces 2 champs pour les autres jeux ,
          // on les passe explicitement vides s'ils ne sont pas remplis.
          loginTM: '',
          bio: '',
          avatarUrl: '',
          recruitmentMessage: '',
          rlRank: '',
          connectionVisibility: [],
        },
      });
      try { localStorage.removeItem(DRAFT_KEY); } catch { /* noop */ }
      track('onboarding_completed', {
        gamesCount: data.games?.length ?? 0,
        games: data.games?.join(',') ?? '',
        country: data.country ?? '',
        recruitmentOpen: !!data.isAvailableForRecruitment,
      });
      await refreshProfile();
      toast.success('Bienvenue sur Aedral !');
      onClose();
      router.push('/');
    } catch (err) {
      if (err instanceof ApiError) setStepError(err.message);
      else setStepError('Erreur réseau. Réessaie.');
    } finally {
      setSaving(false);
    }
  };

  const goBack = () => {
    if (step > 1) {
      setStep(step - 1);
      setStepError('');
    }
  };

  const handleSkip = () => {
    markOnboardingSkipped();
    onClose();
    router.push('/settings?complete=1');
  };

  return (
    <Portal>
      <div
        className="animate-overlay-in"
        style={{
          position: 'fixed', inset: 0,
          background: 'rgba(0,0,0,0.75)',
          zIndex: 9700,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 16,
        }}
      >
        <div
          className="bevel animate-fade-in"
          style={{
            background: 'var(--s-surface)',
            border: '1px solid var(--s-border)',
            width: '100%',
            maxWidth: 680,
            maxHeight: 'calc(100vh - 32px)',
            display: 'flex',
            flexDirection: 'column',
            boxShadow: '0 24px 64px rgba(0,0,0,0.6)',
          }}
        >
          {/* Header, accent bar + titre + progression */}
          <div className="h-[3px] flex-shrink-0" style={{ background: 'linear-gradient(90deg, var(--s-gold), rgba(255,184,0,0.3), transparent 70%)' }} />
          <header className="px-6 pt-5 pb-4 flex-shrink-0">
            <div className="flex items-center justify-between gap-3 mb-3">
              <div className="flex items-center gap-2">
                <Sparkles size={14} style={{ color: 'var(--s-gold)' }} />
                <span className="t-label" style={{ color: 'var(--s-gold)' }}>BIENVENUE SUR AEDRAL</span>
              </div>
              <button
                type="button"
                onClick={handleSkip}
                className="flex items-center gap-1 text-xs"
                style={{ color: 'var(--s-text-muted)' }}
                title="Passer cet onboarding et compléter manuellement"
              >
                Passer <X size={11} />
              </button>
            </div>
            <h2 className="font-display text-2xl sm:text-3xl mb-2" style={{ color: 'var(--s-text)' }}>
              {step === 1 ? 'COMMENÇONS PAR TOI' :
                step === 2 ? 'D\'OÙ JOUES-TU ?' :
                step === 3 ? 'TES JEUX' :
                'RECRUTEMENT'}
            </h2>
            {/* Barre de progression */}
            <div className="flex items-center gap-2 mt-3">
              {Array.from({ length: TOTAL_STEPS }, (_, i) => i + 1).map(n => (
                <div
                  key={n}
                  className="flex-1"
                  style={{
                    height: 4,
                    background: n <= step ? 'var(--s-gold)' : 'var(--s-elevated)',
                    transition: 'background 200ms ease',
                  }}
                />
              ))}
            </div>
            <p className="text-xs mt-2" style={{ color: 'var(--s-text-muted)' }}>
              Étape {step} sur {TOTAL_STEPS}
            </p>
          </header>

          {/* Body scroll */}
          <div className="flex-1 overflow-y-auto px-6 py-4">
            {step === 1 && <StepIdentity data={data} update={update} />}
            {step === 2 && <StepCountry data={data} update={update} />}
            {step === 3 && <StepGames data={data} update={update} />}
            {step === 4 && <StepRecruitment data={data} update={update} />}
          </div>

          {/* Footer, erreur + nav */}
          <footer className="px-6 py-4 flex-shrink-0" style={{ borderTop: '1px solid var(--s-border)', background: 'var(--s-elevated)' }}>
            {stepError && (
              <div className="mb-3 px-3 py-2 text-xs"
                style={{ background: 'rgba(239,68,68,0.10)', border: '1px solid rgba(239,68,68,0.30)', color: '#ef4444' }}>
                {stepError}
              </div>
            )}
            <div className="flex items-center justify-between gap-3">
              <button
                type="button"
                onClick={goBack}
                disabled={step === 1 || saving}
                className="btn-springs btn-secondary bevel-sm flex items-center gap-1.5 text-xs disabled:opacity-30 disabled:cursor-not-allowed"
              >
                <ChevronLeft size={12} /> Précédent
              </button>
              <button
                type="button"
                onClick={goNext}
                disabled={saving}
                className="btn-springs btn-primary bevel-sm flex items-center gap-1.5"
                style={{ padding: '10px 18px', fontSize: '13px' }}
              >
                {saving ? (
                  <><Loader2 size={13} className="animate-spin" /> Sauvegarde…</>
                ) : step < TOTAL_STEPS ? (
                  <>Suivant <ChevronRight size={13} /></>
                ) : (
                  <><CheckCircle size={13} /> Terminer</>
                )}
              </button>
            </div>
          </footer>
        </div>
      </div>
    </Portal>
  );
}

// ─── Steps ─────────────────────────────────────────────────────────────────
function StepIdentity({ data, update }: { data: WizardData; update: (p: Partial<WizardData>) => void }) {
  return (
    <div className="space-y-5">
      <p className="text-sm" style={{ color: 'var(--s-text-muted)' }}>
        Ces infos forment ton identité publique sur la plateforme. Tu pourras
        les modifier à tout moment depuis tes paramètres.
      </p>
      <div>
        <label className="t-label block mb-2"><User size={11} className="inline mr-1" /> Pseudo affiché *</label>
        <input
          type="text"
          value={data.displayName}
          onChange={e => update({ displayName: e.target.value })}
          className="settings-input w-full"
          placeholder="Ton pseudo Aedral"
          maxLength={32}
          autoFocus
        />
        <p className="text-xs mt-1" style={{ color: 'var(--s-text-muted)' }}>
          Pré-rempli depuis ton compte Discord, change-le si tu veux.
        </p>
      </div>
      <div>
        <label className="t-label block mb-2">Date de naissance *</label>
        <input
          type="date"
          value={data.dateOfBirth}
          onChange={e => update({ dateOfBirth: e.target.value })}
          className="settings-input w-full"
          max={new Date().toISOString().split('T')[0]}
        />
        <p className="text-xs mt-1" style={{ color: 'var(--s-text-muted)' }}>
          Seul ton âge sera visible publiquement. Tu dois avoir 13 ans minimum.
        </p>
      </div>
    </div>
  );
}

function StepCountry({ data, update }: { data: WizardData; update: (p: Partial<WizardData>) => void }) {
  return (
    <div className="space-y-5">
      <p className="text-sm" style={{ color: 'var(--s-text-muted)' }}>
        Permet aux structures de te repérer pour les équipes nationales ou les
        tournois géo-filtrés.
      </p>
      <div>
        <label className="t-label block mb-2"><Globe size={11} className="inline mr-1" /> Pays *</label>
        <select
          value={data.country}
          onChange={e => update({ country: e.target.value })}
          className="settings-input w-full"
          autoFocus
        >
          <option value="">Choisis ton pays</option>
          {countries.map(c => (
            <option key={c.code} value={c.code}>{c.flag} {c.name}</option>
          ))}
        </select>
      </div>
    </div>
  );
}

function StepGames({ data, update }: { data: WizardData; update: (p: Partial<WizardData>) => void }) {
  const toggleGame = (g: string) => {
    const cur = new Set(data.games);
    if (cur.has(g)) cur.delete(g);
    else cur.add(g);
    update({ games: Array.from(cur) });
  };
  const platformMeta = data.rlPlatform ? getRLPlatformMeta(data.rlPlatform) : null;

  return (
    <div className="space-y-5">
      <p className="text-sm" style={{ color: 'var(--s-text-muted)' }}>
        Coche les jeux que tu pratiques. Les options de vérification détaillées
        (Epic, Steam, rang…) se configurent ensuite dans tes paramètres.
      </p>
      {/* Choix jeux, boucle sur la registry pour scaler à N jeux */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {ALL_GAME_DEFS.map(g => (
          <GamePicker
            key={g.id}
            active={data.games.includes(g.id)}
            onClick={() => toggleGame(g.id)}
            label={g.label}
            accent={g.color}
          />
        ))}
      </div>
      {/* Config RL minimale */}
      {data.games.includes('rocket_league') && (
        <div className="p-4 space-y-3" style={{ background: 'rgba(0,129,255,0.04)', border: '1px solid rgba(0,129,255,0.15)' }}>
          <div className="flex items-center gap-2">
            <span className="tag tag-blue" style={{ fontSize: '12px' }}>RL</span>
            <span className="t-label" style={{ color: 'var(--s-blue)' }}>Configuration minimale</span>
          </div>
          <div>
            <label className="t-label block mb-2">Sur quelle plateforme ?</label>
            <select
              value={data.rlPlatform}
              onChange={e => update({ rlPlatform: e.target.value as RLPlatform | '' })}
              className="settings-input w-full"
            >
              <option value="">Choisis</option>
              {RL_PLATFORMS.map(p => (
                <option key={p.value} value={p.value}>{p.label}</option>
              ))}
            </select>
          </div>
          {data.rlPlatform && (
            <div>
              <label className="t-label block mb-2">
                {platformMeta?.idLabel ?? 'ID sur la plateforme'} *
              </label>
              <input
                type="text"
                value={data.rlPlatformId}
                onChange={e => update({ rlPlatformId: e.target.value })}
                className="settings-input w-full"
                placeholder={platformMeta?.idPlaceholder ?? ''}
              />
              {platformMeta && (
                <p className="text-xs mt-1" style={{ color: 'var(--s-text-muted)' }}>{platformMeta.idHelp}</p>
              )}
            </div>
          )}
        </div>
      )}
      {/* Config TM minimale */}
      {data.games.includes('trackmania') && (
        <div className="p-4 space-y-3" style={{ background: 'rgba(0,217,54,0.04)', border: '1px solid rgba(0,217,54,0.15)' }}>
          <div className="flex items-center gap-2">
            <span className="tag tag-green" style={{ fontSize: '12px' }}>TM</span>
            <span className="t-label" style={{ color: 'var(--s-green)' }}>Configuration minimale</span>
          </div>
          <div>
            <label className="t-label block mb-2">Pseudo Ubisoft/Nadeo *</label>
            <input
              type="text"
              value={data.pseudoTM}
              onChange={e => update({ pseudoTM: e.target.value })}
              className="settings-input w-full"
              placeholder="Ton pseudo en jeu"
            />
          </div>
          <div>
            <label className="t-label block mb-2">URL Trackmania.io *</label>
            <input
              type="url"
              value={data.tmIoUrl}
              onChange={e => update({ tmIoUrl: e.target.value })}
              className="settings-input w-full"
              placeholder="https://trackmania.io/#/player/..."
            />
          </div>
        </div>
      )}
      {/* Config Valorant minimale, rang optionnel (peut être laissé vide,
          tu pourras lier ton compte Riot dans Discord puis activer la sync
          auto plus tard, ou saisir manuellement dans Settings). */}
      {data.games.includes('valorant') && (
        <div className="p-4 space-y-3" style={{ background: 'rgba(255,70,85,0.04)', border: '1px solid rgba(255,70,85,0.15)' }}>
          <div className="flex items-center gap-2">
            <span className="tag" style={{ fontSize: '12px', background: 'rgba(255,70,85,0.10)', color: '#FF6B78', borderColor: 'rgba(255,70,85,0.25)' }}>VAL</span>
            <span className="t-label" style={{ color: '#FF6B78' }}>Configuration minimale</span>
          </div>
          <div>
            <label className="t-label block mb-2">Ton rang Valorant (optionnel)</label>
            <select
              value={data.valorantRank}
              onChange={e => update({ valorantRank: e.target.value })}
              className="settings-input w-full"
            >
              <option value="">Non renseigné</option>
              {VALORANT_RANKS.map(r => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
            <p className="text-xs mt-1.5" style={{ color: 'var(--s-text-muted)' }}>
              Tu peux le laisser vide et le saisir plus tard dans Settings. Si tu lies ton compte Riot dans ton Discord (Connexions → Riot Games), ton RiotID sera capturé automatiquement au prochain login.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

function StepRecruitment({ data, update }: { data: WizardData; update: (p: Partial<WizardData>) => void }) {
  return (
    <div className="space-y-5">
      <p className="text-sm" style={{ color: 'var(--s-text-muted)' }}>
        Indique si tu cherches une équipe ou un rôle dans une structure. Cette
        étape est <strong style={{ color: 'var(--s-text)' }}>optionnelle</strong> ,
        tu peux activer la dispo plus tard depuis tes paramètres.
      </p>
      <div className="flex items-center justify-between gap-4 p-4 bevel-sm"
        style={{ background: 'var(--s-elevated)', border: '1px solid var(--s-border)' }}>
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            <Search size={13} style={{ color: 'var(--s-gold)' }} />
            <span className="t-sub" style={{ color: 'var(--s-text)' }}>Je suis disponible pour rejoindre une structure</span>
          </div>
          <p className="text-xs" style={{ color: 'var(--s-text-muted)' }}>
            Les recruteurs verront un badge sur ton profil et te trouveront
            dans l&apos;annuaire « joueurs disponibles ».
          </p>
        </div>
        <button
          type="button"
          onClick={() => update({ isAvailableForRecruitment: !data.isAvailableForRecruitment })}
          aria-pressed={data.isAvailableForRecruitment}
          className="flex-shrink-0 relative transition-all"
          style={{
            width: 44, height: 24,
            background: data.isAvailableForRecruitment ? 'var(--s-gold)' : 'var(--s-surface)',
            border: `1px solid ${data.isAvailableForRecruitment ? 'var(--s-gold)' : 'var(--s-border)'}`,
            cursor: 'pointer',
          }}
        >
          <span
            className="absolute top-1/2 -translate-y-1/2 transition-all"
            style={{
              left: data.isAvailableForRecruitment ? 22 : 2,
              width: 18, height: 18,
              background: data.isAvailableForRecruitment ? '#000' : 'var(--s-text-dim)',
            }}
          />
        </button>
      </div>
      {data.isAvailableForRecruitment && (
        <div>
          <label className="t-label block mb-2">Rôle recherché</label>
          <select
            value={data.recruitmentRole}
            onChange={e => update({ recruitmentRole: e.target.value })}
            className="settings-input w-full"
          >
            <option value="">Choisis un rôle</option>
            <option value="joueur">Joueur</option>
            <option value="coach">Coach</option>
            <option value="manager">Manager</option>
          </select>
        </div>
      )}
    </div>
  );
}

function GamePicker({ active, onClick, label, accent }: { active: boolean; onClick: () => void; label: string; accent: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="p-4 text-left transition-all relative overflow-hidden"
      style={{
        background: active ? `${accent}14` : 'var(--s-elevated)',
        border: `2px solid ${active ? accent + '66' : 'var(--s-border)'}`,
        cursor: 'pointer',
      }}
    >
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 flex items-center justify-center" style={{ background: `${accent}1A`, border: `1px solid ${accent}33` }}>
          <Gamepad2 size={16} style={{ color: accent }} />
        </div>
        <span className="text-sm font-semibold" style={{ color: active ? accent : 'var(--s-text)' }}>{label}</span>
        {active && <CheckCircle size={14} className="ml-auto" style={{ color: accent }} />}
      </div>
    </button>
  );
}
