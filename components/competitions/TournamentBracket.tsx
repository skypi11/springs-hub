'use client';

// Vue de tournoi Aedral — wrapper client de brackets-viewer (Drarig29), le
// viewer de référence de l'écosystème brackets-manager : multi-formats (round
// robin, simple et double élimination), agnostique du framework (compatible
// React 19 là où les libs React de bracket cassent), connecteurs natifs.
// La conversion moteur → format viewer vit dans l'adaptateur pur
// `lib/competitions/brackets-viewer-adapter` (testé Vitest) ; ici on ne fait
// que charger le bundle (client only — l'IIFE pose window.bracketsViewer),
// rendre, puis greffer les décorations Aedral (badges EN STREAM / EN COURS).
// Le thème vit dans design-system.css (section BRACKET), la couleur d'accent
// arrive par la variable CSS --bv-accent (couleur du jeu).

import 'brackets-viewer/dist/brackets-viewer.min.css';
import { useEffect, useId, useRef, useState } from 'react';
import type { Config, ParticipantImage } from 'brackets-viewer';
import {
  adaptBracketForViewer,
  type AdaptedBracket,
  type PublicBracketMatch,
} from '@/lib/competitions/brackets-viewer-adapter';

// Chaînes françaises appliquées par-dessus les bundles `en` ET `fr` du viewer
// (addLocale = merge profond i18next) : la détection de langue du navigateur
// devient sans effet, le bracket est en français pour tout le monde — comme le
// reste du produit. Les clés absentes gardent leur valeur d'origine.
const FR_STRINGS = {
  'origin-hint': {
    seed: 'Seed {{position}}',
    'winner-bracket': 'Perdant $t(abbreviations.winner-bracket) {{round}}.{{position}}',
    'winner-bracket-semi-final': 'Perdant demi $t(abbreviations.winner-bracket) {{position}}',
    'winner-bracket-final': 'Perdant finale $t(abbreviations.winner-bracket)',
    'grand-final': 'Vainqueur finale $t(abbreviations.loser-bracket)',
  },
  'match-label': {
    default: 'Match {{matchNumber}}',
    'double-elimination': '{{matchPrefix}} {{roundNumber}}.{{matchNumber}}',
    'double-elimination-semi-final': 'Demi {{matchPrefix}} {{matchNumber}}',
    'double-elimination-final': 'Finale {{matchPrefix}}',
    'grand-final-single': 'Grande finale',
    'grand-final': 'Grande finale {{roundNumber}}',
  },
  'match-status': {
    locked: 'Verrouillé',
    waiting: 'En attente',
    ready: 'Prêt',
    running: 'En cours',
    completed: 'Terminé',
    archived: 'Archivé',
  },
  abbreviations: {
    win: 'V',
    loss: 'D',
    forfeit: 'F',
    position: 'P',
    seed: '#',
    'winner-bracket': 'WB',
    'loser-bracket': 'LB',
    match: 'M',
    'grand-final': 'GF',
  },
  common: {
    bye: 'BYE',
    'best-of-x': 'BO{{x}}',
    'group-name-winner-bracket': 'Winners bracket',
    'group-name-loser-bracket': 'Losers bracket',
    'round-name': 'Tour {{roundNumber}}',
    'round-name-final': 'Finale',
    'round-name-winner-bracket': 'Tour {{roundNumber}}',
    'round-name-winner-bracket-final': 'Finale winners',
    'round-name-loser-bracket': 'Tour {{roundNumber}}',
    'round-name-loser-bracket-final': 'Finale losers',
  },
};

// En-têtes de rondes — mêmes libellés que l'ancienne vue (validés) : le
// contexte winners/losers est déjà porté par le titre de section.
const customRoundName: NonNullable<Config['customRoundName']> = info => {
  if (info.groupType === 'final-group') {
    return info.roundNumber === 2 ? 'Belle (reset)' : 'Grande finale';
  }
  const { roundNumber, roundCount } = info;
  if (info.groupType === 'winner-bracket') {
    if (roundNumber === roundCount) return 'Finale';
    if (roundNumber === roundCount - 1) return 'Demi-finales';
    if (roundNumber === roundCount - 2) return 'Quarts';
    if (roundNumber === roundCount - 3) return 'Huitièmes';
    if (roundNumber === roundCount - 4) return 'Seizièmes';
    return `Tour ${roundNumber}`;
  }
  if (info.groupType === 'loser-bracket') {
    if (roundNumber === roundCount) return 'Finale du losers';
    if (roundNumber === roundCount - 1) return 'Demi du losers';
    return `Tour ${roundNumber}`;
  }
  return `Tour ${roundNumber}`;
};

// Chargement unique du bundle (IIFE → window.bracketsViewer) + locale. Sur
// échec (chunk 404 après redéploiement, réseau), le cache est VIDÉ : la
// tentative suivante ré-importe vraiment — sinon une promesse rejetée
// condamnerait le bracket pour toute la session (review adversariale).
let viewerLoading: Promise<void> | null = null;
function ensureViewer(): Promise<void> {
  if (!viewerLoading) {
    viewerLoading = (async () => {
      await import('brackets-viewer/dist/brackets-viewer.min.js');
      await window.bracketsViewer.addLocale('fr', FR_STRINGS as never);
      await window.bracketsViewer.addLocale('en', FR_STRINGS as never);
    })();
    viewerLoading.catch(() => { viewerLoading = null; });
  }
  return viewerLoading;
}

// Badges hors modèle viewer, greffés sur le DOM rendu (data-match-id = clé
// moteur). Re-render → DOM neuf → re-greffe systématique.
function decorate(root: HTMLElement, decorations: AdaptedBracket['decorations']): void {
  for (const [matchId, deco] of Object.entries(decorations)) {
    const el = root.querySelector<HTMLElement>(`[data-match-id="${CSS.escape(matchId)}"]`);
    if (!el) continue;
    if (deco.live) el.classList.add('bv-live');
    if (deco.hints) {
      // Ordre DOM = opponent1 puis opponent2. On remplace les hints du viewer
      // (incomplets côté winners, faux sur la GF) et on remplit les slots
      // vides — jamais le nom d'une équipe réelle.
      const names = el.querySelectorAll<HTMLElement>('.participant .name');
      const apply = (name: HTMLElement | undefined, text: string | undefined) => {
        if (!name || !text) return;
        if (name.classList.contains('hint') || name.textContent?.trim() === '') {
          name.textContent = text;
          name.classList.add('hint');
        }
      };
      apply(names[0], deco.hints.side1);
      apply(names[1], deco.hints.side2);
    }
    // Badge uniquement pour un match réellement en cours ou casté (une
    // décoration peut ne porter que des hints). Lien seulement en http(s) —
    // jamais d'URL brute dans un href sans contrôle de schéma.
    if (deco.stream !== null || deco.live) {
      const streamHref = deco.stream && /^https?:\/\//i.test(deco.stream) ? deco.stream : null;
      const box = el.querySelector<HTMLElement>('.opponents') ?? el;
      const badge = document.createElement(streamHref ? 'a' : 'span');
      badge.className = deco.stream !== null ? 'bv-flag bv-flag-stream' : 'bv-flag';
      badge.textContent = deco.stream !== null ? 'EN STREAM' : 'EN COURS';
      if (streamHref && badge instanceof HTMLAnchorElement) {
        badge.href = streamHref;
        badge.target = '_blank';
        badge.rel = 'noopener noreferrer';
      }
      box.appendChild(badge);
    }
  }
}

export default function TournamentBracket({ matches, gameColor, onMatchClick }: {
  matches: PublicBracketMatch[];
  gameColor: string;
  /** Clic sur un match (id = clé moteur "W1-1") — ex. navigation vers sa page. */
  onMatchClick?: (matchId: string) => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const seqRef = useRef(0);
  const renderedRef = useRef<string>('');
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Ref : le viewer capture le callback au render DOM — la ref évite de
  // re-rendre le bracket quand seule l'identité du callback change (assignée
  // en effet, règle react-hooks/refs).
  const onMatchClickRef = useRef(onMatchClick);
  useEffect(() => { onMatchClickRef.current = onMatchClick; }, [onMatchClick]);
  const [failed, setFailed] = useState(false);
  // Un bracket statique garde la même ref React Query (structural sharing) :
  // sans ce tick, un échec transitoire ne serait jamais retenté.
  const [retryTick, setRetryTick] = useState(0);
  // window.bracketsViewer est un singleton à état partagé (images, stage) :
  // UNE seule instance rendue à la fois est supportée — le cas du site (un
  // bracket par fiche). La classe unique évite au moins de rendre dans le
  // mauvais conteneur si deux instances montent par erreur.
  const instanceClass = 'bv-' + useId().replace(/[^a-zA-Z0-9_-]/g, '');

  useEffect(() => {
    const root = rootRef.current;
    if (!root || matches.length === 0) return;

    const adapted = adaptBracketForViewer(matches);
    const payload = JSON.stringify(adapted);
    // Polling sans changement réel → pas de re-render (préserve le scroll et
    // évite le flash toutes les 15 s).
    if (payload === renderedRef.current) return;

    const seq = ++seqRef.current;
    let disposed = false;
    (async () => {
      await ensureViewer();
      if (disposed || seq !== seqRef.current || !rootRef.current) return;
      // ParticipantImage type participantId en number, mais le viewer associe
      // par === avec l'id du participant — nos ids string passent tels quels
      // (brackets-model Id = string | number).
      window.bracketsViewer.setParticipantImages(adapted.images as unknown as ParticipantImage[]);
      // Le re-render vide puis reconstruit le DOM : sans sauvegarde, le
      // navigateur clampe le scroll à 0 pendant le vide — précisément le jour
      // de match, quand l'admin regarde la droite du bracket.
      const scrollLeft = rootRef.current.scrollLeft;
      const scrollTop = rootRef.current.scrollTop;
      rootRef.current.replaceChildren();
      await window.bracketsViewer.render(adapted.data, {
        selector: `.${instanceClass}`,
        clear: true,
        customRoundName,
        onMatchClick: match => { onMatchClickRef.current?.(String(match.id)); },
        showSlotsOrigin: true,               // préfixes « #seed » du round 1 winners
        showLowerBracketSlotsOrigin: false,  // provenances servies par NOS hints (décorations)
        showPopoverOnMatchLabelClick: false,
        separatedChildCountLabel: true,
        highlightParticipantOnHover: true,
        participantOriginPlacement: 'before',
      });
      if (disposed || seq !== seqRef.current || !rootRef.current) return;
      decorate(rootRef.current, adapted.decorations);
      rootRef.current.scrollLeft = scrollLeft;
      rootRef.current.scrollTop = scrollTop;
      renderedRef.current = payload;
      setFailed(false);
    })().catch(() => {
      if (!disposed && seq === seqRef.current) {
        setFailed(true);
        retryTimerRef.current = setTimeout(() => setRetryTick(t => t + 1), 30_000);
      }
    });
    return () => {
      disposed = true;
      if (retryTimerRef.current) {
        clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
    };
  }, [matches, instanceClass, retryTick]);

  // Le conteneur reste TOUJOURS monté, même en échec : le poll suivant (ou le
  // retour du réseau) retente le rendu dans le même div — un échec transitoire
  // ne condamne pas le bracket jusqu'au reload (review adversariale).
  return (
    <div className={onMatchClick ? 'aedral-bracket bv-clickable' : 'aedral-bracket'}
      style={{ '--bv-accent': gameColor } as React.CSSProperties}>
      {failed && (
        <p className="text-sm mb-2" style={{ color: 'var(--s-text-dim)' }}>
          Le bracket n&apos;a pas pu être affiché. Nouvelle tentative au prochain rafraîchissement.
        </p>
      )}
      <div ref={rootRef} className={`brackets-viewer ${instanceClass}`} />
    </div>
  );
}
