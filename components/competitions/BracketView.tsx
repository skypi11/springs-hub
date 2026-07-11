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
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api, apiPublic } from '@/lib/api-client';
import { useAuth } from '@/context/AuthContext';
import TournamentBracket from '@/components/competitions/TournamentBracket';
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
  const { data, isError } = useQuery({
    queryKey: ['competition-bracket', competitionId, !!user],
    queryFn: () => (user ? api : apiPublic)<{ matches: PublicBracketMatch[] }>(`/api/competitions/${competitionId}/matches`),
    refetchInterval: concluded ? false : 15_000,   // rafraîchissement live le jour de match
    staleTime: 10_000,
    // Le flip anonyme→connecté change la queryKey (!!user) : on garde le
    // bracket affiché pendant le refetch au lieu de re-flasher « Chargement ».
    placeholderData: keepPreviousData,
  });
  // null = chargement ; [] = erreur ou vide.
  const matches = useMemo(
    () => data?.matches ?? (isError ? [] : null),
    [data, isError],
  );

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

  return <TournamentBracket matches={matches} gameColor={gameColor} onMatchClick={openMatch} />;
}
