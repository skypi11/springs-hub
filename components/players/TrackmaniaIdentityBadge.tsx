// Statut Trackmania d'un joueur, pour les cartes et les fiches.
//
// Miroir de RLIdentityBadge et ValorantIdentityBadge, avec une différence de
// fond : ici la preuve est la MEILLEURE des trois. Le joueur se connecte chez
// Ubisoft, Nadeo nous renvoie son identifiant de compte, et ce compte ne peut
// être lié qu'à un seul compte Aedral. Rocket League repose sur une connexion
// déclarée dans Discord, Valorant sur un identifiant résolu par un service
// tiers ; ici, c'est le propriétaire du compte en personne.
//
// D'où l'absence de bouton « signaler » : le pseudo affiché VIENT de Nadeo,
// personne ne peut mentir dessus. Rien à modérer, donc rien à signaler.
//
// Trois états :
//   1. Compte Ubisoft lié → ✓ or + pseudo officiel + lien trackmania.io.
//   2. Se déclare joueur Trackmania sans compte lié → avertissement.
//   3. Ne joue pas à Trackmania → rien du tout.

import { ExternalLink, ShieldCheck, ShieldAlert } from 'lucide-react';
import { tmIoUrlFromAccountId } from '@/lib/trackmania-identity';

export interface TrackmaniaIdentityBadgeProps {
  games: string[] | undefined;
  /** Dérivé serveur : la connexion Ubisoft/Nadeo est passée. */
  tmAccountVerified: boolean;
  /** Pseudo officiel renvoyé par Nadeo. */
  tmDisplayName?: string;
  /** Identifiant de compte — sert à bâtir le lien vers la fiche publique. */
  tmAccountId?: string;
  /** Le joueur est dans une équipe Trackmania : il y joue, même si `games` l'ignore. */
  inTrackmaniaTeam?: boolean;
  /** `sm` = pastille compacte pour les cartes ; `md` = ligne pour les fiches. */
  size?: 'sm' | 'md';
  /**
   * Ton du « non vérifié » :
   * - `warning` (défaut) : dissuasif, sur la fiche profil.
   * - `subtle` : neutre, dans les listes où la plupart n'ont pas encore lié.
   */
  tone?: 'warning' | 'subtle';
}

export default function TrackmaniaIdentityBadge({
  games,
  tmAccountVerified,
  tmDisplayName,
  tmAccountId,
  inTrackmaniaTeam,
  size = 'sm',
  tone = 'warning',
}: TrackmaniaIdentityBadgeProps) {
  const joueTM = (games ?? []).includes('trackmania') || !!inTrackmaniaTeam;
  if (!joueTM) return null;

  const ficheHref = tmIoUrlFromAccountId(tmAccountId) ?? '';

  // ── État 2 : pas de compte lié ────────────────────────────────────────────
  if (!tmAccountVerified) {
    // Le texte dit quoi FAIRE, pas seulement ce qui manque : contrairement à
    // Valorant, la vérification est disponible et prend un clic.
    const explication = 'Compte Ubisoft non lié — le pseudo affiché est déclaratif.';
    if (size === 'sm') {
      const discret = tone === 'subtle';
      return (
        <span
          className="tag inline-flex items-center gap-1"
          title={explication}
          style={{
            background: discret ? 'transparent' : 'rgba(255,85,85,0.10)',
            color: discret ? 'var(--s-text-muted)' : '#ff8a8a',
            borderColor: discret ? 'var(--s-border)' : 'rgba(255,85,85,0.35)',
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
        className="flex items-start gap-2 p-3"
        style={{ background: 'rgba(255,85,85,0.08)', border: '1px solid rgba(255,85,85,0.3)' }}
      >
        <ShieldAlert size={16} style={{ color: '#ff8a8a', flexShrink: 0, marginTop: 2 }} />
        <div className="text-xs" style={{ color: '#ff8a8a' }}>
          <strong>Compte Ubisoft non lié.</strong>
          <br />
          Le pseudo Trackmania affiché a été saisi à la main : rien ne prouve qu’il
          appartient à ce joueur. La connexion Ubisoft se fait en un clic depuis les
          paramètres.
        </div>
      </div>
    );
  }

  // ── État 1 : compte Ubisoft lié ───────────────────────────────────────────
  if (size === 'sm') {
    return (
      <span className="inline-flex flex-wrap items-center gap-1.5">
        <span
          className="tag inline-flex items-center gap-1"
          title={`Compte Ubisoft vérifié${tmDisplayName ? ` : ${tmDisplayName}` : ''}`}
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
        {ficheHref && (
          <a
            href={ficheHref}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            title={`Voir ${tmDisplayName || 'ce joueur'} sur trackmania.io`}
            className="tag inline-flex items-center gap-1 transition-colors hover:bg-[var(--s-elevated)]"
            style={{
              background: 'transparent',
              color: 'var(--s-green)',
              borderColor: 'rgba(0,217,54,0.35)',
              fontSize: '12px',
              padding: '2px 7px',
              textDecoration: 'none',
            }}
          >
            trackmania.io <ExternalLink size={9} />
          </a>
        )}
      </span>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <span className="inline-flex items-center gap-1.5" style={{ color: 'var(--s-gold)' }}>
        <ShieldCheck size={13} />
        <span className="font-semibold">{tmDisplayName || 'Compte Ubisoft vérifié'}</span>
      </span>
      {ficheHref && (
        <a
          href={ficheHref}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 hover:underline"
          style={{ color: 'var(--s-green)' }}
        >
          Voir trackmania.io <ExternalLink size={10} />
        </a>
      )}
    </div>
  );
}
