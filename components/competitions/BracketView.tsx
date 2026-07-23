'use client';

// Bracket public d'une compétition. Servi par l'API
// (`/api/competitions/[id]/matches`, Admin SDK) et rafraîchi par POLLING : le
// SDK Firestore CLIENT est bloqué sur ce projet, et l'API applique surtout le
// même gate de visibilité que la fiche (une compét masquée n'expose pas son
// bracket — un onSnapshot public l'aurait contourné). Refetch 15 s : suffisant
// pour un bracket majoritairement statique hors jour de match (Lot 3).
//
// Ce composant ne gère QUE la donnée (fetch, polling, états vides) ; le rendu
// de l'arbre est délégué à TournamentBracket (brackets-viewer + adaptateur
// pur) — la vue de tournoi scalable multi-formats.

import { useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, apiPublic } from '@/lib/api-client';
import { useAuth } from '@/context/AuthContext';
import TournamentBracket from '@/components/competitions/TournamentBracket';
import StandingsTable, { type StandingsGroup } from '@/components/competitions/StandingsTable';
import { useWorkerInterval } from '@/components/competitions/useWorkerInterval';
import type { PublicBracketMatch } from '@/lib/competitions/brackets-viewer-adapter';

export default function BracketView({ competitionId, gameColor, competitionStatus }: {
  competitionId: string;
  gameColor: string;
  competitionStatus?: string;
}) {
  const { user } = useAuth();
  const router = useRouter();
  const openMatch = useCallback(
    (matchId: string) => router.push(`/competitions/${competitionId}/match/${matchId}`),
    [router, competitionId],
  );
  // Une compét terminée/archivée ne bouge plus → inutile de poller.
  const concluded = competitionStatus === 'finished' || competitionStatus === 'archived';
  const queryClient = useQueryClient();
  const { data, isError } = useQuery({
    queryKey: ['competition-bracket', competitionId, !!user],
    queryFn: () => (user ? api : apiPublic)<{ matches: PublicBracketMatch[] }>(`/api/competitions/${competitionId}/matches`),
    staleTime: 10_000,
    // Le flip anonyme→connecté change la queryKey (!!user) : on garde le
    // bracket affiché pendant le refetch au lieu de re-flasher « Chargement ».
    placeholderData: keepPreviousData,
  });
  // Rafraîchissement live cadencé par Web Worker (archi §5) : un spectateur
  // alt-tabbé le jour de match retrouve un bracket à jour — refetchInterval
  // se met en pause quand l'onglet passe en arrière-plan. L'API est cachée
  // CDN (s-maxage 10 s) : la cadence ne coûte pas de lectures Firestore.
  useWorkerInterval(() => {
    queryClient.invalidateQueries({ queryKey: ['competition-bracket', competitionId] });
    queryClient.invalidateQueries({ queryKey: ['competition-standings', competitionId] });
  }, 15_000, !concluded);
  // null = chargement ; [] = erreur ou vide.
  const matches = useMemo(
    () => data?.matches ?? (isError ? [] : null),
    [data, isError],
  );

  // Round robin / suisse : le CLASSEMENT accompagne la grille des matchs —
  // servi par l'API dédiée (fonctions pures du moteur, la table du viewer est
  // désactivée). Requête activée seulement quand les matchs le révèlent.
  const isGroupStage = useMemo(
    () => (matches ?? []).some(m => m.bracket === 'round_robin' || m.bracket === 'swiss'),
    [matches],
  );
  const { data: standings } = useQuery({
    queryKey: ['competition-standings', competitionId, !!user],
    queryFn: () => (user ? api : apiPublic)<{ kind: 'round_robin' | 'swiss'; concluded: boolean; groups: StandingsGroup[] }>(
      `/api/competitions/${competitionId}/standings`),
    staleTime: 10_000,
    enabled: isGroupStage,
    placeholderData: keepPreviousData,
  });

  // On ne blanke le bracket QUE si on n'a jamais rien reçu : un blip réseau
  // (refetch 15 s échoué) garde le dernier bracket affiché (React Query
  // conserve la dernière donnée réussie), au lieu d'effacer l'écran en plein
  // jour de match.
  if (isError && !data) {
    return <p className="text-sm" style={{ color: 'var(--s-text-dim)' }}>Le bracket n&apos;a pas pu être chargé.</p>;
  }
  if (!matches) {
    return <p className="text-sm" style={{ color: 'var(--s-text-dim)' }}>Chargement du bracket…</p>;
  }
  if (matches.length === 0) {
    return <p className="text-sm" style={{ color: 'var(--s-text-dim)' }}>Le bracket n&apos;est pas encore publié.</p>;
  }

  return (
    <div className="space-y-6">
      <TournamentBracket matches={matches} gameColor={gameColor} onMatchClick={openMatch} />
      {isGroupStage && standings && standings.groups.length > 0 && (
        <div>
          <p className="t-label mb-3" style={{ color: 'var(--s-text-dim)' }}>Classement</p>
          <StandingsTable kind={standings.kind} concluded={standings.concluded} groups={standings.groups} />
        </div>
      )}
    </div>
  );
}
