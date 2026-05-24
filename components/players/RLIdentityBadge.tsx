// Affiche le statut RL contextuel d'un joueur — pour les cartes / fiches.
// Trois états (voir docs/rl-rank-verification-plan.md) :
//   1. Compte RL lié (rlEpicId ou Steam OpenID)
//      → badge ✓ doré + pseudo Epic/Steam + lien tracker cliquable + bouton
//        signaler (si visiteur connecté ≠ propriétaire).
//   2. Le joueur dit pratiquer RL (games contient 'rocket_league') mais aucun
//      compte n'est lié → ⚠️ avertissement visible, dissuasif pour les
//      recruteurs.
//   3. Joueur non-RL (ni RL ni équipe RL) → rien du tout, on n'embête pas.

import { ExternalLink, ShieldCheck, ShieldAlert } from 'lucide-react';
import { buildTrackerGgUrl } from '@/lib/rl-platform';
import ReportRankButton from '@/components/players/ReportRankButton';

export interface RLIdentityBadgeProps {
  games: string[] | undefined;
  rlAccountVerified: boolean;
  rlAccountName?: string;
  rlAccountPlatform?: 'epic' | 'steam' | '' | null;
  rlSteamId64?: string;
  rlRank?: string;
  /**
   * UID du joueur — requis pour afficher le bouton signaler.
   */
  targetUid?: string;
  /**
   * Nom affiché dans la modale du signalement (fallback : « ce joueur »).
   */
  targetName?: string;
  /**
   * Permet d'afficher le bouton « Signaler le rang ». Mettre true quand le
   * visiteur est connecté ET n'est pas le propriétaire de la fiche.
   */
  canReport?: boolean;
  /**
   * Si on sait que le joueur est dans une équipe RL — alors il "joue à RL"
   * même si `games` n'inclut pas 'rocket_league'. Optionnel — par défaut on
   * se base uniquement sur `games`.
   */
  inRLTeam?: boolean;
  /** `sm` = pill compact pour les cartes ; `md` = ligne pour les fiches. */
  size?: 'sm' | 'md';
  /**
   * Ton du badge "non vérifié" :
   * - `warning` (default) : rouge dissuasif, utilisé sur la fiche profil pour
   *   alerter explicitement les recruteurs.
   * - `subtle` : gris neutre, utilisé dans les listes d'annuaire pour ne pas
   *   polluer visuellement quand 90% des joueurs n'ont pas (encore) lié leur
   *   compte. La fiche profil garde le ton dissuasif.
   */
  tone?: 'warning' | 'subtle';
}

export default function RLIdentityBadge({
  games,
  rlAccountVerified,
  rlAccountName,
  rlAccountPlatform,
  rlSteamId64,
  rlRank,
  targetUid,
  targetName,
  canReport,
  inRLTeam,
  size = 'sm',
  tone = 'warning',
}: RLIdentityBadgeProps) {
  const playsRL = (games ?? []).includes('rocket_league') || !!inRLTeam;

  // Joueur non-RL → on n'affiche rien, c'est légitime de n'avoir aucun compte RL
  if (!playsRL) return null;

  const trackerHref = (() => {
    if (rlAccountPlatform === 'epic' && rlAccountName) {
      return buildTrackerGgUrl('epic', rlAccountName);
    }
    if (rlAccountPlatform === 'steam' && rlSteamId64) {
      return buildTrackerGgUrl('steam', rlSteamId64);
    }
    return '';
  })();

  // ── État 2 — RL sans compte lié ──────────────────────────────────────────
  // tone='warning' (fiche profil) : rouge dissuasif.
  // tone='subtle' (annuaire) : gris neutre, on n'agresse pas — 90% des
  // joueurs n'ont pas encore lié, c'est la norme.
  if (!rlAccountVerified) {
    if (size === 'sm') {
      const subtle = tone === 'subtle';
      return (
        <span
          className="inline-flex items-center gap-1 tag"
          title={subtle
            ? "Compte de jeu non lié — le rang affiché n'est pas vérifié."
            : "Ce joueur joue à Rocket League mais n'a pas lié son compte de jeu. Son rang n'est pas vérifiable."}
          style={{
            background: subtle ? 'transparent' : 'rgba(255,85,85,0.10)',
            color: subtle ? 'var(--s-text-muted)' : '#ff8a8a',
            borderColor: subtle ? 'var(--s-border)' : 'rgba(255,85,85,0.35)',
            fontSize: '10px',
            padding: '2px 6px',
          }}
        >
          <ShieldAlert size={10} />
          Non vérifié
        </span>
      );
    }
    return (
      <div
        className="p-3 flex items-start gap-2"
        style={{
          background: 'rgba(255,85,85,0.08)',
          border: '1px solid rgba(255,85,85,0.3)',
        }}
      >
        <ShieldAlert size={16} style={{ color: '#ff8a8a', flexShrink: 0, marginTop: 2 }} />
        <div className="text-xs" style={{ color: '#ff8a8a' }}>
          <strong>Compte Rocket League non lié.</strong>
          <br />
          Ce joueur dit pratiquer RL mais n'a vérifié aucun compte de jeu — son rang n'est pas vérifiable. À considérer avec prudence pour le recrutement.
        </div>
      </div>
    );
  }

  // ── État 1 — compte lié, ✓ vérifié ────────────────────────────────────────
  const nameOrFallback = rlAccountName?.trim() || (rlAccountPlatform === 'steam' ? 'Compte Steam' : 'Compte Epic');
  const showReport = !!canReport && !!targetUid && !!rlRank;

  if (size === 'sm') {
    return (
      <span className="inline-flex items-center gap-1.5 flex-wrap">
        <span
          className="inline-flex items-center gap-1 tag"
          title={`Compte ${rlAccountPlatform === 'steam' ? 'Steam' : 'Epic'} vérifié : ${nameOrFallback}${rlRank ? ` (${rlRank})` : ''}`}
          style={{
            background: 'rgba(255,184,0,0.10)',
            color: 'var(--s-gold)',
            borderColor: 'rgba(255,184,0,0.35)',
            fontSize: '10px',
            padding: '2px 6px',
          }}
        >
          <ShieldCheck size={10} />
          Compte vérifié
        </span>
        {trackerHref && (
          <a
            href={trackerHref}
            target="_blank"
            rel="noopener noreferrer"
            onClick={e => e.stopPropagation()}
            title={`Voir ${nameOrFallback} sur tracker.gg`}
            className="inline-flex items-center gap-1 tag transition-colors hover:bg-[var(--s-elevated)]"
            style={{
              background: 'transparent',
              color: 'var(--s-blue)',
              borderColor: 'rgba(0,129,255,0.35)',
              fontSize: '10px',
              padding: '2px 6px',
              textDecoration: 'none',
            }}
          >
            tracker <ExternalLink size={9} />
          </a>
        )}
        {showReport && (
          <ReportRankButton
            targetUid={targetUid}
            targetName={targetName}
            enabled
            size="sm"
          />
        )}
      </span>
    );
  }

  return (
    <div className="flex items-center gap-2 flex-wrap text-xs">
      <span
        className="inline-flex items-center gap-1.5"
        style={{ color: 'var(--s-gold)' }}
      >
        <ShieldCheck size={13} />
        <span className="font-semibold">{nameOrFallback}</span>
      </span>
      {trackerHref && (
        <a
          href={trackerHref}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 hover:underline"
          style={{ color: 'var(--s-blue)' }}
        >
          Voir tracker.gg <ExternalLink size={10} />
        </a>
      )}
      {showReport && (
        <ReportRankButton
          targetUid={targetUid}
          targetName={targetName}
          enabled
          size="md"
        />
      )}
    </div>
  );
}
