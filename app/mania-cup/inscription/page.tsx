'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import {
  CheckCircle2, Circle, Loader2, AlertTriangle, ExternalLink,
  ArrowLeft, ShieldCheck, Upload, FileCheck, UserPlus, Trash2, Hourglass,
} from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { api, apiPublic, apiForm, ApiError } from '@/lib/api-client';
import CountrySelect from '@/components/ui/CountrySelect';
import TicketButton from '@/components/mania-cup/TicketButton';
import { useManiaCupSettings } from '@/components/mania-cup/useManiaCupSettings';
import {
  MANIA_CUP,
  SPRINGS_DISCORD_INVITE,
  GUARDIAN_DOC_KINDS,
  GUARDIAN_DOC_LABELS,
  GUARDIAN_DOCS_RETENTION_DAYS,
  type GuardianDocKind,
  type ManiaCupRegistration,
} from '@/lib/mania-cup';

// Parcours d'inscription individuelle à la Springs Mania Cup.
//
// Trois préalables avant le formulaire, dans cet ordre : compte Aedral (Discord),
// appartenance au serveur Discord de Springs E-Sport, puis compte Trackmania
// vérifié via l'OAuth Nadeo. Le formulaire lui-même est volontairement court :
// date de naissance et nationalité, le reste vient des comptes liés.

type Ctx = {
  authenticated: boolean;
  /** Faux tant que l'événement n'est pas publié et que le visiteur n'est ni
   *  admin ni compte du bac à sable. */
  visible?: boolean;
  /** Ce que le profil sait déjà (date de naissance, pays) — pré-remplit le formulaire. */
  prefill?: { birthDate: string; countryCode: string };
  /** Règlement en vigueur. Sa version voyage avec l'acceptation. */
  rulebook?: { version: number } | null;
  seats: { max: number; taken: number; remaining: number };
  trackmania?: { accountId: string; displayName: string } | null;
  discord?: { id: string | null; inGuild: boolean | null };
  registration?: ManiaCupRegistration | null;
};

const TM_ERRORS: Record<string, string> = {
  refus: 'Tu as refusé l’autorisation côté Ubisoft. Ton compte n’a pas été lié.',
  session: 'La session de liaison a expiré. Relance la connexion Trackmania.',
  deja_lie: 'Ce compte Trackmania est déjà rattaché à un autre compte Aedral.',
  technique: 'La liaison a échoué pour une raison technique. Réessaie dans un instant.',
};

export default function InscriptionPage() {
  const { firebaseUser, loading: authLoading, signInWithDiscord } = useAuth();
  const params = useSearchParams();

  const [ctx, setCtx] = useState<Ctx | null>(null);
  const [loading, setLoading] = useState(true);
  const [linking, setLinking] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [birthDate, setBirthDate] = useState('');
  const [countryCode, setCountryCode] = useState('FR');
  const [rulesAccepted, setRulesAccepted] = useState(false);

  const tmError = params.get('tm_error');

  const load = useCallback(async () => {
    try {
      const data = await apiPublic<Ctx>('/api/mania-cup/register');
      setCtx(data);
      if (data.registration) {
        setBirthDate(data.registration.birthDate ?? '');
        setCountryCode(data.registration.countryCode ?? 'FR');
      } else if (data.prefill) {
        // Un joueur venu de la Monthly Cup a déjà renseigné tout ça sur Aedral.
        if (data.prefill.birthDate) setBirthDate(data.prefill.birthDate);
        if (data.prefill.countryCode) setCountryCode(data.prefill.countryCode);
      }
    } catch {
      setError('Impossible de charger l’état des inscriptions.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!authLoading) void load();
  }, [authLoading, firebaseUser, load]);

  async function linkTrackmania() {
    setLinking(true);
    setError(null);
    try {
      const { url } = await api<{ url: string }>('/api/auth/trackmania/start', { method: 'POST' });
      window.location.href = url;
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Connexion Trackmania indisponible.');
      setLinking(false);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await api<{ registration: ManiaCupRegistration }>('/api/mania-cup/register', {
        method: 'POST',
        body: {
          birthDate,
          countryCode,
          rulebookAccepted: rulesAccepted,
          rulebookVersion: ctx?.rulebook?.version,
        },
      });
      setCtx((c) => (c ? { ...c, registration: res.registration } : c));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'L’inscription a échoué.');
    } finally {
      setSubmitting(false);
    }
  }

  if (authLoading || loading) {
    return (
      <Shell>
        <div className="flex items-center gap-3 text-[#8d89a8]">
          <Loader2 className="animate-spin" size={20} aria-hidden />
          Chargement…
        </div>
      </Shell>
    );
  }

  // Inscriptions fermées au public : même porte que les compétitions en
  // brouillon. On l'annonce plutôt que de rendre un 404 sec — c'est une page
  // dont l'adresse circulera avant l'ouverture.
  if (ctx && ctx.visible === false) {
    return (
      <Shell>
        <Link
          href="/mania-cup"
          className="inline-flex items-center gap-2 text-sm text-[#8d89a8] hover:text-white"
        >
          <ArrowLeft size={16} aria-hidden />
          Retour à la présentation
        </Link>
        <h1 className="font-display mt-6 text-5xl leading-tight">
          Les inscriptions ne sont pas encore ouvertes
        </h1>
        <p className="mt-4 text-lg text-[#c9c5d8]">
          Elles ouvriront avec l’annonce officielle de la Springs Mania Cup.
          Rejoins le Discord Springs E-Sport pour être prévenu le jour même —
          il n’y aura que 64 places.
        </p>
        <a
          href={SPRINGS_DISCORD_INVITE}
          target="_blank"
          rel="noreferrer"
          className="mt-8 inline-flex items-center gap-2 bg-[#5865F2] px-6 py-3 font-semibold text-white transition-opacity hover:opacity-90"
        >
          Rejoindre le Discord Springs
          <ExternalLink size={16} aria-hidden />
        </a>
      </Shell>
    );
  }

  const seats = ctx?.seats;
  const reg = ctx?.registration ?? null;
  const tmLinked = Boolean(ctx?.trackmania?.accountId);
  const inGuild = ctx?.discord?.inGuild;
  const full = (seats?.remaining ?? 0) <= 0 && !reg;

  return (
    <Shell>
      <Link
        href="/mania-cup"
        className="inline-flex items-center gap-2 text-sm text-[#8d89a8] hover:text-white"
      >
        <ArrowLeft size={16} aria-hidden />
        Retour à la présentation
      </Link>

      <h1 className="font-display mt-6 text-5xl leading-tight sm:text-6xl">
        {reg ? 'Mon inscription' : 'Inscription'}
      </h1>
      <p className="mt-3 text-lg text-[#c9c5d8]">
        Springs Mania Cup · 3 &amp; 4 octobre 2026 · {MANIA_CUP.city}
      </p>

      {seats && (
        <p className="mt-2 text-[#8d89a8]">
          <strong className="text-[#00D936]">{seats.remaining}</strong> place
          {seats.remaining > 1 ? 's' : ''} restante{seats.remaining > 1 ? 's' : ''} sur{' '}
          {seats.max} ·{' '}
          <Link href="/mania-cup/inscrits" className="text-[#a364d9] underline">
            voir les inscrits
          </Link>
        </p>
      )}

      {tmError && TM_ERRORS[tmError] && <Banner tone="warn">{TM_ERRORS[tmError]}</Banner>}
      {error && <Banner tone="error">{error}</Banner>}

      {/* Dossier déjà déposé : on montre le récapitulatif, pas le formulaire. */}
      {reg ? (
        <Recap reg={reg} onReload={() => void load()} />
      ) : full ? (
        <Banner tone="warn">
          Les {seats?.max ?? MANIA_CUP.maxPlayers} places sont réglées. Contacte l’organisation sur le
          Discord Springs pour être placé sur la liste d’attente.
        </Banner>
      ) : (
        <div className="mt-12 space-y-6">
          {/* Étape 1 — compte Aedral */}
          <Step
            n={1}
            done={Boolean(firebaseUser)}
            title="Ton compte"
            desc="La connexion se fait avec Discord. Si tu as déjà joué une Monthly Cup, ton compte existe déjà."
          >
            {!firebaseUser && (
              <button
                onClick={() => signInWithDiscord()}
                className="bg-[#5865F2] px-5 py-3 font-semibold text-white transition-opacity hover:opacity-90"
              >
                Se connecter avec Discord
              </button>
            )}
          </Step>

          {/* Étape 2 — Discord Springs */}
          <Step
            n={2}
            done={inGuild === true}
            disabled={!firebaseUser}
            title="Rejoindre le Discord Springs E-Sport"
            desc="Toutes les infos de la LAN et les consignes du jour J y passent. C’est obligatoire pour participer."
          >
            {firebaseUser && inGuild === false && (
              <div className="space-y-3">
                <a
                  href={SPRINGS_DISCORD_INVITE}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-2 bg-[#5865F2] px-5 py-3 font-semibold text-white transition-opacity hover:opacity-90"
                >
                  Rejoindre le serveur
                  <ExternalLink size={16} aria-hidden />
                </a>
                <button
                  onClick={() => void load()}
                  className="block text-sm text-[#a364d9] underline"
                >
                  J’ai rejoint, revérifier
                </button>
              </div>
            )}
            {firebaseUser && inGuild === null && (
              <p className="text-[#8d89a8]">
                Vérification indisponible pour le moment — l’organisation contrôlera
                manuellement, tu peux continuer.
              </p>
            )}
          </Step>

          {/* Étape 3 — compte Trackmania */}
          <Step
            n={3}
            done={tmLinked}
            disabled={!firebaseUser}
            title="Connecter ton compte Trackmania"
            desc="Connexion officielle Ubisoft. Elle nous donne ton pseudo en jeu et permet de relier automatiquement tes résultats pendant la LAN."
          >
            {firebaseUser && !tmLinked && (
              <button
                onClick={() => void linkTrackmania()}
                disabled={linking}
                className="inline-flex items-center gap-2 bg-[#00D936] px-5 py-3 font-bold text-[#07050b] transition-transform hover:scale-[1.02] disabled:opacity-60"
              >
                {linking && <Loader2 className="animate-spin" size={18} aria-hidden />}
                Se connecter avec Ubisoft
              </button>
            )}
            {tmLinked && (
              <p className="flex items-center gap-2 text-[#c9c5d8]">
                <ShieldCheck size={18} className="text-[#00D936]" aria-hidden />
                <strong className="text-white">{ctx?.trackmania?.displayName}</strong>
                <span className="text-sm text-[#8d89a8]">— compte vérifié</span>
              </p>
            )}
          </Step>

          {/* Étape 4 — le peu qu'on demande */}
          <Step
            n={4}
            done={false}
            disabled={!firebaseUser || !tmLinked}
            title="Dernières informations"
            desc="C’est tout ce qu’il nous manque."
          >
            {firebaseUser && tmLinked && (
              <form onSubmit={submit} className="max-w-md space-y-5">
                <div>
                  <label htmlFor="birth" className="block text-sm text-[#c9c5d8]">
                    Date de naissance
                  </label>
                  <input
                    id="birth"
                    type="date"
                    required
                    value={birthDate}
                    onChange={(e) => setBirthDate(e.target.value)}
                    className="mt-2 w-full border border-white/15 bg-black/40 px-4 py-3 text-white outline-none focus:border-[#00D936]"
                  />
                  <p className="mt-2 text-xs text-[#8d89a8]">
                    La LAN est accessible à partir de {MANIA_CUP.minAge} ans le jour de
                    l’événement. Entre {MANIA_CUP.minAge} et 17 ans, une autorisation
                    parentale est demandée.
                  </p>
                </div>

                <div>
                  <label htmlFor="country" className="block text-sm text-[#c9c5d8]">
                    Nationalité
                  </label>
                  <div className="mt-2">
                    <CountrySelect id="country" value={countryCode} onChange={setCountryCode} />
                  </div>
                </div>

                {ctx?.rulebook && (
                  <label className="flex cursor-pointer items-start gap-3 text-[#c9c5d8]">
                    <input
                      type="checkbox"
                      checked={rulesAccepted}
                      onChange={(e) => setRulesAccepted(e.target.checked)}
                      className="mt-1 accent-[#00D936]"
                    />
                    <span>
                      J’ai lu et j’accepte le{' '}
                      <Link
                        href="/mania-cup/reglement"
                        target="_blank"
                        className="text-[#00D936] underline"
                      >
                        règlement de la Springs Mania Cup
                      </Link>
                      <span className="block text-xs text-[#8d89a8]">
                        Version {ctx.rulebook.version} — s’ouvre dans un nouvel onglet.
                      </span>
                    </span>
                  </label>
                )}

                <p className="border-l-2 border-[#a364d9] pl-4 text-sm text-[#8d89a8]">
                  Besoin d’un poste sur place ? La location se réserve et se règle
                  sur HelloAsso, en même temps que ton inscription ou plus tard.
                  Le stock est très limité.
                </p>

                <button
                  type="submit"
                  disabled={submitting || !birthDate || (Boolean(ctx?.rulebook) && !rulesAccepted)}
                  className="inline-flex items-center gap-2 bg-[#00D936] px-7 py-4 text-lg font-bold text-[#07050b] transition-transform hover:scale-[1.02] disabled:opacity-60"
                >
                  {submitting && <Loader2 className="animate-spin" size={18} aria-hidden />}
                  Valider mon inscription
                </button>
              </form>
            )}
          </Step>
        </div>
      )}
    </Shell>
  );
}

// ── Récapitulatif après dépôt ────────────────────────────────────────────────

function Recap({ reg, onReload }: { reg: ManiaCupRegistration; onReload: () => void }) {
  const settings = useManiaCupSettings();
  const minor = reg.guardianConsent !== 'not_required';
  return (
    <div className="mt-12 space-y-6">
      <Checklist reg={reg} />

      <div className="border border-[#00D936]/40 bg-[#00D936]/10 p-7">
        <h2 className="font-display text-3xl">Ton inscription est enregistrée</h2>
        <p className="mt-3 text-[#c9c5d8]">
          Elle sera définitive une fois le règlement de {settings.priceEuros} € reçu.
        </p>

        <div className="mt-6 border border-white/15 bg-black/40 p-5">
          <div className="text-xs tracking-[0.2em] text-[#8d89a8] uppercase">
            Ton code d’inscription
          </div>
          <div className="font-display mt-1 text-4xl text-[#00D936]">
            {reg.registrationCode}
          </div>
          <p className="mt-3 text-sm text-[#c9c5d8]">
            Reporte-le lors du paiement sur HelloAsso. C’est lui qui relie ton
            règlement à ton inscription.
          </p>
        </div>

        <div className="mt-6">
          {reg.status === 'confirmed' ? (
            <p className="flex items-center gap-2 text-[#00D936]">
              <ShieldCheck size={18} aria-hidden />
              Règlement reçu, ta place est acquise.
            </p>
          ) : (
            <TicketButton
              kind="player"
              label={`Payer mon inscription — ${settings.priceEuros} €`}
            />
          )}
        </div>
      </div>

      {minor && <GuardianConsent reg={reg} onDone={onReload} />}

      <Companion reg={reg} onDone={onReload} />

      <div className="flex flex-wrap items-center justify-between gap-4 border-t border-white/10 pt-6">
        <p className="text-sm text-[#8d89a8]">
          Pseudo Trackmania enregistré :{' '}
          <strong className="text-white">{reg.tmDisplayName}</strong>
        </p>
        <WithdrawButton onDone={onReload} />
      </div>
    </div>
  );
}

// ── Ce qu'il reste à faire ──────────────────────────────────────────────────
//
// Le récapitulatif présentait tout au même niveau : le code, le paiement, les
// pièces, l'accompagnant. Impossible de voir d'un coup d'œil ce qui bloque
// encore. Cette bande le dit en une ligne — c'est elle qui évite d'avoir à
// relancer les gens un par un.

// Trois états, pas deux : ce qui est fait, ce que le JOUEUR doit faire, et ce
// qui ne dépend plus de lui. Un dossier parental déposé et en attente de
// relecture n'est pas une tâche en retard — le compter comme telle laisserait
// croire au joueur qu'il traîne alors qu'il a tout fourni.
type ChecklistItem = { state: 'done' | 'todo' | 'waiting'; label: string };

function Checklist({ reg }: { reg: ManiaCupRegistration }) {
  const settings = useManiaCupSettings();
  const items: ChecklistItem[] = [
    { state: 'done', label: 'Inscription déposée' },
    {
      state: reg.status === 'confirmed' ? 'done' : 'todo',
      label: `Règlement de ${settings.priceEuros} €`,
    },
  ];
  if (reg.guardianConsent !== 'not_required') {
    items.push(
      reg.guardianConsent === 'approved'
        ? { state: 'done', label: 'Dossier parental validé' }
        : reg.guardianConsent === 'pending_review'
          ? {
              state: 'waiting',
              label: 'Dossier parental — en attente de validation par l’organisation',
            }
          : reg.guardianConsent === 'rejected'
            ? { state: 'todo', label: 'Dossier parental — à corriger' }
            : { state: 'todo', label: 'Dossier parental — pièces à déposer' }
    );
  }

  const left = items.filter((i) => i.state === 'todo').length;
  const allDone = items.every((i) => i.state === 'done');

  return (
    <div
      className={`border p-6 ${
        allDone
          ? 'border-[#00D936]/40 bg-[#00D936]/[0.08]'
          : left === 0
            ? 'border-[#a364d9]/40 bg-[#7B2FBE]/[0.10]'
            : 'border-[#FFB800]/40 bg-[#FFB800]/[0.08]'
      }`}
    >
      <h2 className="font-display text-2xl">
        {allDone
          ? 'Ta place est acquise'
          : left === 0
            ? 'Rien à faire de ton côté'
            : `Il te reste ${left} chose${left > 1 ? 's' : ''} à faire`}
      </h2>
      {left === 0 && !allDone && (
        <p className="mt-2 text-[#c9c5d8]">
          L’organisation traite ton dossier, tu seras prévenu.
        </p>
      )}
      <ul className="mt-4 space-y-2">
        {items.map((it) => (
          <li key={it.label} className="flex items-center gap-3">
            {it.state === 'done' ? (
              <CheckCircle2 size={18} className="shrink-0 text-[#00D936]" aria-hidden />
            ) : it.state === 'waiting' ? (
              <Hourglass size={18} className="shrink-0 text-[#a364d9]" aria-hidden />
            ) : (
              <Circle size={18} className="shrink-0 text-[#FFB800]" aria-hidden />
            )}
            <span
              className={
                it.state === 'done'
                  ? 'text-[#8d89a8] line-through'
                  : it.state === 'waiting'
                    ? 'text-[#c9c5d8]'
                    : 'text-white'
              }
            >
              {it.label}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ── Accompagnant (billet staff) ─────────────────────────────────────────────

function Companion({ reg, onDone }: { reg: ManiaCupRegistration; onDone: () => void }) {
  const settings = useManiaCupSettings();
  const existing = reg.companion ?? null;
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(existing?.name ?? '');
  const [role, setRole] = useState(existing?.role ?? '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setErr(null);
    try {
      await api('/api/mania-cup/companion', { method: 'POST', body: { name, role } });
      setEditing(false);
      onDone();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Enregistrement impossible.');
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    try {
      await api('/api/mania-cup/companion', { method: 'DELETE' });
      setName('');
      setRole('');
      onDone();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Suppression impossible.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="border border-white/15 bg-white/[0.02] p-6">
      <div className="flex items-start gap-3">
        <UserPlus size={22} className="mt-0.5 shrink-0 text-[#a364d9]" aria-hidden />
        <div className="min-w-0 flex-1">
          <h3 className="font-display text-2xl">Tu viens accompagné ?</h3>
          <p className="mt-2 text-[#c9c5d8]">
            Une personne peut t’accompagner dans la zone joueurs — coach, parent, ami.
            Elle doit être déclarée ici et prendre un{' '}
            <strong className="text-white">
              billet accompagnant à {settings.companionEuros} €
            </strong>{' '}
            sur HelloAsso : un billet spectateur ne donne pas accès à cette zone.
          </p>
          <p className="mt-3 border-l-2 border-[#FFB800] pl-4 text-sm text-[#f2e6c8]">
            Au moment de payer ce billet, <strong className="text-white">ton code
            d’inscription {reg.registrationCode} doit être reporté</strong> — c’est lui
            qui rattache l’accompagnant à toi. Peu importe qui règle : toi ou lui.
          </p>
          <div className="mt-4">
            <TicketButton
              kind="companion"
              variant="outline"
              label={`Billet accompagnant — ${settings.companionEuros} €`}
            />
          </div>

          {existing && !editing ? (
            <div className="mt-5 flex flex-wrap items-center justify-between gap-4 border border-white/15 bg-black/30 p-4">
              <div>
                <div className="font-semibold">{existing.name}</div>
                <div className="text-sm text-[#8d89a8]">{existing.role}</div>
              </div>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setEditing(true)}
                  className="text-sm text-[#a364d9] underline"
                >
                  Modifier
                </button>
                <button
                  disabled={busy}
                  onClick={() => void remove()}
                  className="inline-flex items-center gap-1.5 text-sm text-[#8d89a8] hover:text-red-300 disabled:opacity-50"
                >
                  <Trash2 size={14} aria-hidden /> Retirer
                </button>
              </div>
            </div>
          ) : editing ? (
            <div className="mt-5 max-w-md space-y-4">
              <div>
                <label htmlFor="comp-name" className="block text-sm text-[#c9c5d8]">
                  Nom et prénom
                </label>
                <input
                  id="comp-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="mt-2 w-full border border-white/15 bg-black/40 px-4 py-3 text-white outline-none focus:border-[#00D936]"
                />
              </div>
              <div>
                <label htmlFor="comp-role" className="block text-sm text-[#c9c5d8]">
                  En quelle qualité ? <span className="text-[#8d89a8]">(facultatif)</span>
                </label>
                <input
                  id="comp-role"
                  value={role}
                  onChange={(e) => setRole(e.target.value)}
                  placeholder="Coach, parent, ami…"
                  className="mt-2 w-full border border-white/15 bg-black/40 px-4 py-3 text-white outline-none focus:border-[#00D936]"
                />
              </div>
              <div className="flex items-center gap-3">
                <button
                  disabled={busy || !name.trim()}
                  onClick={() => void save()}
                  className="inline-flex items-center gap-2 bg-[#00D936] px-5 py-2.5 font-bold text-[#07050b] disabled:opacity-50"
                >
                  {busy && <Loader2 className="animate-spin" size={16} aria-hidden />}
                  Enregistrer
                </button>
                <button
                  onClick={() => setEditing(false)}
                  className="text-sm text-[#8d89a8] underline"
                >
                  Annuler
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setEditing(true)}
              className="mt-5 border border-white/20 px-5 py-2.5 hover:bg-white/10"
            >
              Déclarer un accompagnant
            </button>
          )}

          {err && <p className="mt-3 text-sm text-red-300">{err}</p>}
        </div>
      </div>
    </div>
  );
}

// ── Retrait d'inscription ───────────────────────────────────────────────────

function WithdrawButton({ onDone }: { onDone: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function withdraw() {
    setBusy(true);
    setErr(null);
    try {
      await api('/api/mania-cup/register', { method: 'DELETE' });
      onDone();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Le retrait a échoué.');
      setBusy(false);
    }
  }

  if (err) {
    return <p className="max-w-md text-sm text-red-300">{err}</p>;
  }

  if (!confirming) {
    return (
      <button
        onClick={() => setConfirming(true)}
        className="text-sm text-[#8d89a8] underline hover:text-red-300"
      >
        Retirer mon inscription
      </button>
    );
  }

  return (
    <div className="flex items-center gap-3">
      <span className="text-sm text-[#c9c5d8]">Libérer ta place ?</span>
      <button
        disabled={busy}
        onClick={() => void withdraw()}
        className="inline-flex items-center gap-1.5 border border-red-500/40 px-3 py-1.5 text-sm text-red-300 hover:bg-red-500/10 disabled:opacity-50"
      >
        {busy && <Loader2 className="animate-spin" size={14} aria-hidden />}
        Confirmer
      </button>
      <button
        onClick={() => setConfirming(false)}
        className="text-sm text-[#8d89a8] underline"
      >
        Annuler
      </button>
    </div>
  );
}

// ── Autorisation parentale (16-17 ans) ──────────────────────────────────────

function GuardianConsent({
  reg,
  onDone,
}: {
  reg: ManiaCupRegistration;
  onDone: () => void;
}) {
  const [busy, setBusy] = useState<GuardianDocKind | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function upload(kind: GuardianDocKind, file: File) {
    setBusy(kind);
    setErr(null);
    try {
      const form = new FormData();
      form.append('file', file);
      form.append('kind', kind);
      await apiForm('/api/mania-cup/guardian-consent', form);
      onDone();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Le dépôt a échoué.');
    } finally {
      setBusy(null);
    }
  }

  if (reg.guardianConsent === 'approved') {
    return (
      <div className="flex gap-3 border border-[#00D936]/40 bg-[#00D936]/10 p-6">
        <ShieldCheck size={22} className="mt-0.5 shrink-0 text-[#00D936]" aria-hidden />
        <p className="text-[#c9c5d8]">
          <strong className="text-white">Dossier validé.</strong> Tes pièces ont été
          acceptées, tu n’as plus rien à fournir.
        </p>
      </div>
    );
  }

  const rejected = reg.guardianConsent === 'rejected';
  const inReview = reg.guardianConsent === 'pending_review';

  return (
    <div
      className={`border p-6 ${
        rejected ? 'border-red-500/40 bg-red-500/10' : 'border-[#FFB800]/40 bg-[#FFB800]/10'
      }`}
    >
      <h3 className="font-display text-2xl">
        {rejected ? 'Dossier à corriger' : 'Tu as moins de 18 ans : deux pièces à fournir'}
      </h3>

      {rejected ? (
        <p className="mt-3 text-[#f0d7d7]">
          Ton dossier n’a pas pu être accepté.
          {reg.guardianRejectionReason && (
            <> Motif : <strong className="text-white">{reg.guardianRejectionReason}</strong></>
          )}{' '}
          Redépose la ou les pièces concernées.
        </p>
      ) : (
        <p className="mt-3 text-[#f2e6c8]">
          Une autorisation signée ne suffit pas à elle seule : il faut aussi la pièce
          d’identité de la personne qui signe, sans quoi rien n’atteste qu’elle est
          bien ton représentant légal.
        </p>
      )}

      <div className="mt-6 space-y-3">
        {GUARDIAN_DOC_KINDS.map((kind) => {
          const doc = reg.guardianDocs?.[kind];
          return (
            <div
              key={kind}
              className="flex flex-wrap items-center justify-between gap-3 border border-white/15 bg-black/30 p-4"
            >
              <div className="min-w-0">
                <div className="font-semibold">{GUARDIAN_DOC_LABELS[kind]}</div>
                {doc ? (
                  <div className="mt-1 flex items-center gap-2 text-sm text-[#00D936]">
                    <FileCheck size={15} aria-hidden />
                    <span className="truncate">{doc.name}</span>
                  </div>
                ) : (
                  <div className="mt-1 text-sm text-[#8d89a8]">Aucun fichier déposé</div>
                )}
              </div>

              <label className="inline-flex shrink-0 cursor-pointer items-center gap-2 bg-white px-4 py-2 text-sm font-bold text-[#07050b] transition-transform hover:scale-[1.02]">
                {busy === kind ? (
                  <Loader2 className="animate-spin" size={16} aria-hidden />
                ) : (
                  <Upload size={16} aria-hidden />
                )}
                {busy === kind ? 'Envoi…' : doc ? 'Remplacer' : 'Choisir un fichier'}
                <input
                  type="file"
                  className="hidden"
                  accept="image/*,application/pdf"
                  disabled={busy !== null}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void upload(kind, f);
                    e.target.value = '';
                  }}
                />
              </label>
            </div>
          );
        })}
      </div>

      {inReview && (
        <p className="mt-5 flex items-center gap-2 text-[#c9c5d8]">
          <FileCheck size={18} className="text-[#a364d9]" aria-hidden />
          Dossier complet, en cours de relecture par l’organisation.
        </p>
      )}

      <p className="mt-5 text-sm text-[#8d89a8]">
        PDF ou photo, 10 Mo maximum par pièce. Les documents sont chiffrés, lisibles
        par la seule organisation, et supprimés {GUARDIAN_DOCS_RETENTION_DAYS} jours
        après la LAN. Ta propre pièce d’identité n’est pas demandée ici : elle sera
        simplement contrôlée à l’accueil le samedi.
      </p>

      {err && <p className="mt-3 text-sm text-red-300">{err}</p>}
    </div>
  );
}

// ── Habillage ────────────────────────────────────────────────────────────────

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-[#07050b] text-[#eaeaf0]">
      <div className="mx-auto max-w-3xl px-6 py-16">{children}</div>
    </main>
  );
}

function Step({
  n, title, desc, done, disabled, children,
}: {
  n: number;
  title: string;
  desc: string;
  done: boolean;
  disabled?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <div
      className={`border p-7 transition-opacity ${
        done ? 'border-[#00D936]/40 bg-[#00D936]/[0.06]' : 'border-white/10 bg-white/[0.02]'
      } ${disabled ? 'opacity-45' : ''}`}
    >
      <div className="flex items-start gap-4">
        {done ? (
          <CheckCircle2 size={26} className="mt-0.5 shrink-0 text-[#00D936]" aria-hidden />
        ) : (
          <Circle size={26} className="mt-0.5 shrink-0 text-[#8d89a8]" aria-hidden />
        )}
        <div className="min-w-0 flex-1">
          <h2 className="font-display text-2xl">
            <span className="text-[#8d89a8]">{n}.</span> {title}
          </h2>
          <p className="mt-2 text-[#c9c5d8]">{desc}</p>
          {children && <div className="mt-5">{children}</div>}
        </div>
      </div>
    </div>
  );
}

function Banner({ tone, children }: { tone: 'warn' | 'error'; children: React.ReactNode }) {
  const styles =
    tone === 'error'
      ? 'border-red-500/40 bg-red-500/10 text-red-100'
      : 'border-[#FFB800]/40 bg-[#FFB800]/10 text-[#f2e6c8]';
  return (
    <div className={`mt-8 flex gap-3 border p-5 ${styles}`}>
      <AlertTriangle size={20} className="mt-0.5 shrink-0" aria-hidden />
      <div>{children}</div>
    </div>
  );
}
