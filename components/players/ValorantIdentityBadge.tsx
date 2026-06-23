// Affiche le statut Valorant contextuel d'un joueur, pour les cartes / fiches.
// Miroir de RLIdentityBadge (voir docs/rl-rank-verification-plan.md + memory
// project_valorant_verification_plan). Trois états :
//   1. Compte Riot vérifié (PUUID stocké OU connection Discord riotgames liée)
//      → badge ✓ doré + lien tracker.gg cliquable + bouton signaler (si visiteur
//        connecté ≠ propriétaire et rang affiché).
//   2. Le joueur dit pratiquer Valorant (games contient 'valorant') mais aucun
//      compte Riot n'est lié → ⚠️ avertissement, dissuasif pour les recruteurs.
//   3. Joueur non-Valorant (ni Valorant ni équipe Valorant) → rien du tout.
//
// Note couleur : le rouge « non vérifié » reste le rouge sémantique d'alerte
// (rgba(255,85,85)) partagé par tous les jeux — PAS le rouge de marque Valorant
// (#FF4655) — pour ne pas confondre « identité du jeu » et « avertissement ».
// Le badge « vérifié » garde l'or Aedral (cohérence « vérifié = précieux »),
// le lien tracker prend la teinte Valorant claire (#FF6B78).

import { ExternalLink, ShieldCheck, ShieldAlert } from 'lucide-react';
import ReportRankButton from '@/components/players/ReportRankButton';

export interface ValorantIdentityBadgeProps {
  games: string[] | undefined;
  /** Dérivé serveur : PUUID stocké OU connection riotgames liée. */
  valorantAccountVerified: boolean;
  /** RiotID "Name#TAG" pour le lien tracker.gg, dérivé serveur. Peut être vide. */
  valorantRiotId?: string;
  valorantRank?: string;
  /** UID du joueur, requis pour afficher le bouton signaler. */
  targetUid?: string;
  /** Nom affiché dans la modale du signalement (fallback : « ce joueur »). */
  targetName?: string;
  /**
   * Permet d'afficher le bouton « Signaler le rang ». Mettre true quand le
   * visiteur est connecté ET n'est pas le propriétaire de la fiche.
   */
  canReport?: boolean;
  /**
   * Si on sait que le joueur est dans une équipe Valorant, alors il "joue à
   * Valorant" même si `games` n'inclut pas 'valorant'. Optionnel.
   */
  inValorantTeam?: boolean;
  /** `sm` = pill compact pour les cartes ; `md` = ligne pour les fiches. */
  size?: 'sm' | 'md';
  /**
   * Ton du badge "non vérifié" :
   * - `warning` (default) : rouge dissuasif, sur la fiche profil.
   * - `subtle` : gris neutre, dans les listes d'annuaire pour ne pas polluer
   *   visuellement quand la plupart des joueurs n'ont pas (encore) lié.
   */
  tone?: 'warning' | 'subtle';
}

export default function ValorantIdentityBadge({
  games,
  valorantAccountVerified,
  valorantRiotId,
  valorantRank,
  targetUid,
  targetName,
  canReport,
  inValorantTeam,
  size = 'sm',
  tone = 'warning',
}: ValorantIdentityBadgeProps) {
  const playsVal = (games ?? []).includes('valorant') || !!inValorantTeam;

  // Joueur non-Valorant → on n'affiche rien.
  if (!playsVal) return null;

  const trackerHref = valorantRiotId
    ? `https://tracker.gg/valorant/profile/riot/${encodeURIComponent(valorantRiotId)}/overview`
    : '';

  // ── État 2, Valorant sans compte vérifié ────────────────────────────────
  if (!valorantAccountVerified) {
    if (size === 'sm') {
      const subtle = tone === 'subtle';
      return (
        <span
          className="inline-flex items-center gap-1 tag"
          title={subtle
            ? "Compte Riot non lié, le rang Valorant affiché n'est pas vérifié."
            : "Ce joueur joue à Valorant mais n'a pas lié son compte Riot. Son rang n'est pas vérifiable."}
          style={{
            background: subtle ? 'transparent' : 'rgba(255,85,85,0.10)',
            color: subtle ? 'var(--s-text-muted)' : '#ff8a8a',
            borderColor: subtle ? 'var(--s-border)' : 'rgba(255,85,85,0.35)',
            fontSize: '12px',
            padding: '2px 7px',
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
          <strong>Compte Riot non lié.</strong>
          <br />
          Ce joueur dit pratiquer Valorant mais n&apos;a lié aucun compte Riot, son rang n&apos;est pas vérifiable. À considérer avec prudence pour le recrutement.
        </div>
      </div>
    );
  }

  // ── État 1, compte Riot lié, ✓ vérifié ──────────────────────────────────
  const showReport = !!canReport && !!targetUid && !!valorantRank;

  if (size === 'sm') {
    return (
      <span className="inline-flex items-center gap-1.5 flex-wrap">
        <span
          className="inline-flex items-center gap-1 tag"
          title={`Compte Riot vérifié${valorantRiotId ? ` : ${valorantRiotId}` : ''}${valorantRank ? ` (${valorantRank})` : ''}`}
          style={{
            background: 'rgba(255,184,0,0.10)',
            color: 'var(--s-gold)',
            borderColor: 'rgba(255,184,0,0.35)',
            fontSize: '12px',
            padding: '2px 7px',
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
            title={`Voir ${valorantRiotId} sur tracker.gg`}
            className="inline-flex items-center gap-1 tag transition-colors hover:bg-[var(--s-elevated)]"
            style={{
              background: 'transparent',
              color: '#FF6B78',
              borderColor: 'rgba(255,70,85,0.35)',
              fontSize: '12px',
              padding: '2px 7px',
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
            game="valorant"
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
        <span className="font-semibold">{valorantRiotId || 'Compte Riot vérifié'}</span>
      </span>
      {trackerHref && (
        <a
          href={trackerHref}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 hover:underline"
          style={{ color: '#FF6B78' }}
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
          game="valorant"
        />
      )}
    </div>
  );
}
