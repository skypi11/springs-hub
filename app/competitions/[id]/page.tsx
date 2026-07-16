'use client';

// Fiche publique d'une compétition (Lot 2) : hero + format + BRACKET LIVE
// (quand publié, onSnapshot) + équipes. Gating : brouillon ou compét de test
// (isDev) = 404 public, servie aux admins compét / comptes du bac à sable.

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { CalendarDays, Users2, ScrollText, ArrowRight, Trophy, EyeOff, ChevronLeft, ChevronDown, ExternalLink, ShieldCheck } from 'lucide-react';
import { api, apiPublic, ApiError } from '@/lib/api-client';
import { useAuth } from '@/context/AuthContext';
import GameTag from '@/components/games/GameTag';
import BracketView from '@/components/competitions/BracketView';
import TeamCrest from '@/components/competitions/TeamCrest';
import RegistrationStatusPill from '@/components/competitions/RegistrationStatusPill';
import OrganizerCredit from '@/components/competitions/OrganizerCredit';
import { Skeleton } from '@/components/ui/Skeleton';
import { getGameColor, getGameColorRgb, getGameBannerUrl } from '@/lib/games-registry';
import type { CompetitionEligibility, CompetitionFormat, CompetitionSchedule } from '@/types/competitions';

interface PublicCompetition {
  competition: {
    id: string;
    name: string;
    game: string;
    status: string;
    circuitId: string | null;
    circuitName: string | null;
    organizer: { name: string; logoUrl?: string | null } | null;
    format: CompetitionFormat | null;
    roster: { starters: number; subsMax: number } | null;
    eligibility: CompetitionEligibility | null;
    registration: { opensAt: string | null; closesAt: string | null; waitlist: boolean };
    schedule: CompetitionSchedule | null;
    bracketMaterializedAt: string | null;
    prizePool: { amount?: number; currency?: string } | number | null;
    isDev: boolean;
  };
  teams: Array<{
    teamId: string;
    name: string;
    tag: string;
    logoUrl: string | null;
    roster: Array<{ displayName: string; role: 'titulaire' | 'remplacant'; trackerUrl: string | null; verified: boolean }>;
    staff: Array<{ name: string; role: 'manager' | 'coach' }>;
  }>;
  waitlistedCount: number;
  myRegistrations: Array<{ teamName: string; tag: string; logoUrl: string | null; status: string }>;
}

// Contexte ajouté sous la pastille de statut : une info NON évidente (qui doit
// agir, conséquence, mécanique de la liste d'attente). Le LIBELLÉ du statut vit
// dans RegistrationStatusPill (source unique — jamais de vert brut, vert = TM).
const REG_CONTEXT: Record<string, string> = {
  pending: "l'organisateur doit valider ton roster",
  approved: 'ta place est confirmée',
  waitlisted: 'promue si une place se libère',
};

const STATUS_LABELS: Record<string, string> = {
  draft: 'Brouillon',
  registration: 'Inscriptions ouvertes',
  validation: 'Validation en cours',
  seeding: 'Seeding',
  live: 'En cours',
  finished: 'Terminé',
  archived: 'Archivé',
};

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' });
  } catch { return '—'; }
}

function fmtPrize(p: PublicCompetition['competition']['prizePool']): string | null {
  if (p == null) return null;
  if (typeof p === 'number') return p > 0 ? `${p} €` : null;
  if (typeof p.amount === 'number' && p.amount > 0) return `${p.amount} ${p.currency ?? '€'}`;
  return null;
}

// Ligne joueur du roster déplié. Le titulaire (starter) = pastille pleine couleur
// du jeu + nom plein ; le remplaçant = pastille creuse + nom atténué. Le lien
// tracker est aligné à droite (colonne), couleur du jeu.
function RosterRow({ player, color, starter }: {
  player: { displayName: string; trackerUrl: string | null; verified: boolean };
  color: string;
  starter?: boolean;
}) {
  return (
    <div className="flex items-center gap-2.5 text-sm">
      <span aria-hidden style={{
        width: 7, height: 7, flexShrink: 0,
        background: starter ? color : 'transparent',
        border: starter ? 'none' : '1px solid var(--s-text-muted)',
      }} />
      <span className="font-medium truncate" style={{ color: starter ? 'var(--s-text)' : 'var(--s-text-dim)' }}>{player.displayName}</span>
      {player.verified && <ShieldCheck size={12} style={{ color: 'var(--s-text-dim)', flexShrink: 0 }} aria-label="Compte vérifié" />}
      {player.trackerUrl && (
        <a href={player.trackerUrl} target="_blank" rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-xs hover:underline ml-auto flex-shrink-0" style={{ color }}>
          Tracker <ExternalLink size={11} />
        </a>
      )}
    </div>
  );
}

export default function CompetitionPage() {
  const params = useParams<{ id: string }>();
  const { user, loading: authLoading } = useAuth();
  const [data, setData] = useState<PublicCompetition | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [loading, setLoading] = useState(true);
  const [expandedTeam, setExpandedTeam] = useState<string | null>(null);

  useEffect(() => {
    // Fetch AUTHENTIFIÉ dès qu'un utilisateur est connecté : une compétition
    // masquée (brouillon ou test) n'est servie qu'aux admins compét et aux
    // comptes du bac à sable — sans le Bearer, le serveur renvoie 404 même aux
    // autorisés. On attend la fin du chargement auth pour ne pas figer un 404.
    if (authLoading) return;
    let cancelled = false;
    const fetcher = user
      ? api<PublicCompetition>(`/api/competitions/${params.id}`)
      : apiPublic<PublicCompetition>(`/api/competitions/${params.id}`);
    fetcher
      .then(res => { if (!cancelled) { setData(res); setNotFound(false); } })
      .catch(err => { if (!cancelled) setNotFound(err instanceof ApiError && err.status === 404); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [params.id, user, authLoading]);

  if (loading) {
    return (
      <div className="px-4 sm:px-6 lg:px-8 py-6 lg:py-8 space-y-4">
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  if (notFound || !data) {
    return (
      <div className="px-4 sm:px-6 lg:px-8 py-6 lg:py-8">
        <p className="t-body" style={{ color: 'var(--s-text-dim)' }}>Compétition introuvable.</p>
      </div>
    );
  }

  const { competition: comp, teams, waitlistedCount, myRegistrations } = data;
  const color = getGameColor(comp.game);
  const colorRgb = getGameColorRgb(comp.game);
  const banner = getGameBannerUrl(comp.game);
  const now = new Date();
  const opensAt = comp.registration.opensAt ? new Date(comp.registration.opensAt) : null;
  const closesAt = comp.registration.closesAt ? new Date(comp.registration.closesAt) : null;
  const registrationOpen = comp.status === 'registration' && opensAt && closesAt && now >= opensAt && now <= closesAt;
  const canRegister = registrationOpen || comp.status === 'draft';
  const maxTeams = comp.format?.maxTeams ?? null;
  const mmr = comp.eligibility?.mmr ?? null;
  const prize = fmtPrize(comp.prizePool);
  const bracketPublished = !!comp.bracketMaterializedAt;

  return (
    <div className="px-4 sm:px-6 lg:px-8 py-6 lg:py-8 space-y-6 animate-fade-in">
      {/* Retour au circuit — le contexte complet (parcours, qualif, classement)
          vit sur la page circuit ; cette fiche est centrée sur la Qualif. */}
      {comp.circuitId && comp.circuitName && (
        <Link href={`/competitions/circuit/${comp.circuitId}`}
          className="inline-flex items-center gap-1.5 text-sm" style={{ color: 'var(--s-text-dim)' }}>
          <ChevronLeft size={15} /> {comp.circuitName}
        </Link>
      )}

      {/* Hero — niveau 1 : image du jeu en fond, accent barre couleur jeu */}
      <div className="panel bevel relative overflow-hidden">
        {banner && (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element -- asset local /public, décoratif */}
            <img src={banner} alt="" aria-hidden className="absolute inset-0 w-full h-full object-cover"
              style={{ opacity: 0.14 }} />
            <div className="absolute inset-0" style={{
              background: `linear-gradient(90deg, var(--s-surface) 30%, rgba(${colorRgb},0.06) 100%)`,
            }} />
          </>
        )}
        <div className="h-[3px] relative" style={{ background: `linear-gradient(90deg, ${color}, rgba(${colorRgb},0.3), transparent 70%)` }} />
        <div className="relative p-6 space-y-3">
          {comp.organizer?.name && (
            <OrganizerCredit organizer={comp.organizer} height={30} />
          )}
          <div className="flex flex-wrap items-center gap-2">
            <GameTag gameId={comp.game} size="sm" />
            <span className="tag tag-neutral">{STATUS_LABELS[comp.status] ?? comp.status}</span>
            {comp.isDev && (
              <span className="tag tag-neutral flex items-center gap-1" style={{ color: 'var(--s-gold)', borderColor: 'rgba(255,184,0,0.4)' }}>
                <EyeOff size={11} /> Test · masquée du public
              </span>
            )}
          </div>
          <h1 className="font-display text-4xl" style={{ letterSpacing: '0.03em' }}>
            {comp.name.toUpperCase()}
          </h1>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-sm" style={{ color: 'var(--s-text-dim)' }}>
            {comp.schedule?.days?.length ? (
              <span className="flex items-center gap-1.5">
                <CalendarDays size={14} />
                {comp.schedule.days.map(d => fmtDate(d.date)).join(' · ')}
              </span>
            ) : null}
            <span className="flex items-center gap-1.5">
              <Users2 size={14} />
              {teams.length}{maxTeams ? ` / ${maxTeams}` : ''} équipes
              {waitlistedCount > 0 ? ` · ${waitlistedCount} en attente` : ''}
            </span>
            {prize && (
              <span className="flex items-center gap-1.5" style={{ color: 'var(--s-gold)' }}>
                <Trophy size={14} /> {prize}
              </span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-3 pt-1">
            {canRegister && user && (
              <Link href={`/competitions/${comp.id}/inscription`} className="btn-springs btn-primary bevel-sm flex items-center gap-1.5">
                Inscrire une équipe <ArrowRight size={14} />
              </Link>
            )}
            {registrationOpen && !user && (
              <span className="text-sm" style={{ color: 'var(--s-text-dim)' }}>
                Connecte-toi avec Discord pour inscrire ton équipe.
              </span>
            )}
            {!registrationOpen && comp.status === 'registration' && opensAt && now < opensAt && (
              <span className="text-sm" style={{ color: 'var(--s-text-dim)' }}>
                Inscriptions à partir du {fmtDate(comp.registration.opensAt)}.
              </span>
            )}
            <Link href={`/competitions/${comp.id}/reglement`} className="btn-springs btn-ghost text-sm flex items-center gap-1.5">
              <ScrollText size={14} /> Règlement
            </Link>
          </div>
        </div>
      </div>

      {/* Mon inscription — 2e héros : le bloc perso actionnable (dirigeant/manager
          qui a inscrit, ou joueur du roster). Crest + statut prominent + contexte.
          Le suivi complet vit dans Ma structure › Inscriptions. */}
      {myRegistrations.length > 0 && (
        <div className="panel bevel" style={{ background: 'var(--s-elevated)' }}>
          <div className="p-5 space-y-4">
            <p className="t-label" style={{ color: 'var(--s-text-muted)' }}>Mon inscription</p>
            <div className="space-y-3">
              {myRegistrations.map((reg, i) => (
                <div key={`${reg.teamName}-${i}`} className="flex items-center gap-3">
                  <TeamCrest url={reg.logoUrl} tag={reg.tag} name={reg.teamName} size={40} />
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold truncate">{reg.teamName}</p>
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-0.5">
                      <RegistrationStatusPill status={reg.status} />
                      {REG_CONTEXT[reg.status] && (
                        <span className="text-xs" style={{ color: 'var(--s-text-dim)' }}>· {REG_CONTEXT[reg.status]}</span>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <div className="divider" />
            <Link href="/community/my-structure?tab=inscriptions"
              className="group text-sm inline-flex items-center gap-1.5" style={{ color: 'var(--s-text-dim)' }}>
              Suivi dans Ma structure › Inscriptions
              <ArrowRight size={13} className="transition-transform group-hover:translate-x-0.5" />
            </Link>
          </div>
        </div>
      )}

      {/* Bracket — affiché dès qu'il est publié ; sinon, une fois la compétition
          en seeding/en cours, on indique qu'il arrive (jamais en phase d'inscription
          où ce serait prématuré). */}
      {bracketPublished ? (
        <div className="panel bevel">
          <div className="panel-header"><span className="t-sub">Bracket</span></div>
          <div className="panel-body">
            <BracketView competitionId={comp.id} gameColor={color} competitionStatus={comp.status} />
          </div>
        </div>
      ) : (comp.status === 'seeding' || comp.status === 'live') ? (
        <div className="panel bevel">
          <div className="panel-header"><span className="t-sub">Bracket</span></div>
          <div className="panel-body">
            <p className="text-sm" style={{ color: 'var(--s-text-dim)' }}>
              Le bracket est en cours de préparation. Il s&apos;affichera ici dès la publication du seeding.
            </p>
          </div>
        </div>
      ) : null}

      {/* Format */}
      <div className="panel bevel">
        <div className="panel-header"><span className="t-sub">Format</span></div>
        <div className="panel-body">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div>
              <p style={{ color: 'var(--s-text-muted)' }}>Bracket</p>
              <p className="font-semibold">
                {comp.format?.kind === 'single_elim' ? 'Simple élimination' : 'Double élimination'}
              </p>
            </div>
            <div>
              <p style={{ color: 'var(--s-text-muted)' }}>Matchs</p>
              <p className="font-semibold">
                BO{comp.format?.bo?.default ?? 5} · {comp.format?.kind === 'single_elim' ? 'finale' : 'finales'} BO{comp.format?.bo?.grandFinal ?? 7}
              </p>
            </div>
            <div>
              <p style={{ color: 'var(--s-text-muted)' }}>Roster</p>
              <p className="font-semibold">
                {comp.roster?.starters ?? 3} titulaires + {comp.roster?.subsMax ?? 2} subs max
              </p>
            </div>
            <div>
              <p style={{ color: 'var(--s-text-muted)' }}>Inscriptions</p>
              <p className="font-semibold">
                {fmtDate(comp.registration.opensAt)} → {fmtDate(comp.registration.closesAt)}
              </p>
            </div>
          </div>
          {(mmr || comp.eligibility?.requireVerifiedAccounts || comp.eligibility?.minAge != null) && (
            <>
              <div className="divider my-4" />
              <div className="flex flex-wrap gap-x-5 gap-y-1 text-sm" style={{ color: 'var(--s-text-dim)' }}>
                {comp.eligibility?.requireVerifiedAccounts && <span>Comptes vérifiés obligatoires</span>}
                {comp.eligibility?.minAge != null && <span>{comp.eligibility.minAge} ans minimum (dérogation possible)</span>}
                {mmr && (
                  <span>
                    MMR 2v2 : moyenne ≤ {mmr.maxAvg} · écart ≤ {mmr.maxGap} · plafond {mmr.maxPlayer}
                  </span>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Équipes validées */}
      <div className="panel bevel">
        <div className="panel-header"><span className="t-sub">Équipes ({teams.length}{maxTeams ? `/${maxTeams}` : ''})</span></div>
        <div className="panel-body p-0">
          {teams.length === 0 ? (
            <p className="text-sm px-4 py-6" style={{ color: 'var(--s-text-dim)' }}>
              Aucune équipe validée pour l&apos;instant.
            </p>
          ) : teams.map((t, i) => {
            const open = expandedTeam === t.teamId;
            const titulaires = t.roster.filter(p => p.role === 'titulaire');
            const remplacants = t.roster.filter(p => p.role === 'remplacant');
            const hasDetails = t.roster.length > 0 || t.staff.length > 0;
            return (
              <div key={t.teamId || `${t.name}-${i}`} style={{ borderTop: i > 0 ? '1px solid var(--s-border)' : 'none' }}>
                <button type="button"
                  onClick={() => hasDetails && setExpandedTeam(open ? null : t.teamId)}
                  className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${open ? 'bg-[var(--s-elevated)]' : hasDetails ? 'hover:bg-[var(--s-elevated)]' : ''}`}
                  style={{ cursor: hasDetails ? 'pointer' : 'default' }}>
                  <TeamCrest url={t.logoUrl} tag={t.tag} name={t.name} size={26} />
                  <span className="text-sm font-semibold flex-1 min-w-0 truncate">{t.name}</span>
                  {t.tag && <span className="text-xs flex-shrink-0" style={{ color: 'var(--s-text-muted)' }}>[{t.tag}]</span>}
                  {hasDetails && (
                    <ChevronDown size={15} style={{ color: open ? color : 'var(--s-text-muted)', flexShrink: 0, transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 150ms' }} />
                  )}
                </button>
                {open && (
                  <div className="px-4 pb-4 pt-1.5 space-y-3.5" style={{ background: 'var(--s-bg)' }}>
                    {titulaires.length > 0 && (
                      <div className="space-y-1.5">
                        <p className="t-label" style={{ color }}>Titulaires</p>
                        {titulaires.map((p, pi) => <RosterRow key={pi} player={p} color={color} starter />)}
                      </div>
                    )}
                    {remplacants.length > 0 && (
                      <div className="space-y-1.5">
                        <p className="t-label" style={{ color: 'var(--s-text-muted)' }}>Remplaçants</p>
                        {remplacants.map((p, pi) => <RosterRow key={pi} player={p} color={color} />)}
                      </div>
                    )}
                    {t.roster.length === 0 && (
                      <p className="text-xs" style={{ color: 'var(--s-text-muted)' }}>Roster non communiqué.</p>
                    )}
                    {t.staff.length > 0 && (
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs pt-2.5" style={{ borderTop: '1px solid var(--s-border)' }}>
                        <span className="t-label" style={{ color: 'var(--s-text-muted)' }}>Staff</span>
                        {t.staff.map((s, si) => (
                          <span key={si} style={{ color: 'var(--s-text-dim)' }}>{s.name} <span style={{ color: 'var(--s-text-muted)' }}>· {s.role === 'manager' ? 'Manager' : 'Coach'}</span></span>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
