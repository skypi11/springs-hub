// Publication du résultat d'un match dans le salon des résultats : l'affiche
// prête à republier, plus le détail des manches en texte.
//
// Appelée APRÈS la progression (jamais dedans : celle-ci est une transaction,
// et une transaction peut être rejouée — on y enverrait le message deux fois).
// Un verrou par match rend l'appel idempotent, ce qui compte parce que
// plusieurs chemins finalisent un résultat : accord des capitaines, échéance du
// tick, score forcé, forfait validé.

import type { Firestore } from 'firebase-admin/firestore';
import { Timestamp } from 'firebase-admin/firestore';
import { captureApiError } from '@/lib/sentry';
import { broadcast } from '@/lib/competitions/tournament-broadcast';
import { matchResultText } from '@/lib/competitions/broadcast-messages';

const SITE = 'https://aedral.com';

/**
 * Publie les résultats des matchs qui viennent d'être finalisés. `matchIds` est
 * ce que retourne la progression (`changedMatchIds`) : on ne garde que ceux qui
 * sont réellement terminés et opposaient deux équipes.
 *
 * Best-effort : ne throw jamais, une affiche perdue ne remet rien en cause.
 */
export async function publishMatchResults(
  db: Firestore,
  competitionId: string,
  matchIds: string[],
): Promise<void> {
  if (matchIds.length === 0) return;
  try {
    const compSnap = await db.collection('competitions').doc(competitionId).get();
    const comp = compSnap.data();
    if (!comp) return;
    // Pas de salon de résultats configuré : rien à faire, et surtout pas de
    // repli sur un autre salon — l'affiche est faite pour celui-là.
    if (!comp.discord?.options?.resultsChannelId) return;

    for (const matchId of matchIds) {
      const ref = db.collection('competition_matches').doc(`${competitionId}__${matchId}`);
      const snap = await ref.get();
      const m = snap.data();
      if (!m || m.status !== 'completed' || !m.teamA || !m.teamB) continue;

      // Verrou : plusieurs chemins peuvent finaliser le même match (accord,
      // échéance, arbitrage), et la progression peut renvoyer un match déjà
      // publié dans `changedMatchIds` d'une opération ultérieure.
      const claimed = await db.runTransaction(async tx => {
        const fresh = await tx.get(ref);
        if (fresh.data()?.resultPublishedAt) return false;
        tx.update(ref, { resultPublishedAt: Timestamp.now() });
        return true;
      });
      if (!claimed) continue;

      const [regA, regB] = await db.getAll(
        db.collection('competition_registrations').doc(m.teamA as string),
        db.collection('competition_registrations').doc(m.teamB as string),
      );
      const nameA = (regA.data()?.name as string) || 'Équipe A';
      const nameB = (regB.data()?.name as string) || 'Équipe B';
      const games = (m.scores?.final as Array<{ a?: number; b?: number }>) ?? [];

      await broadcast(db, competitionId, [{
        target: { kind: 'results', registrationIds: [m.teamA as string, m.teamB as string] },
        text: matchResultText({
          nameA, nameB, games,
          winner: (m.winner as 'a' | 'b' | null) ?? null,
          forfeit: (m.forfeit as 'a' | 'b' | 'both' | null) ?? null,
        }),
        // UNE SEULE image dans le salon : le 16:9, celui que Discord rend le
        // mieux. Envoyer les deux formats reviendrait à publier deux fois la
        // même affiche à chaque match. Le carré (Instagram) est un lien.
        imageUrl: `${SITE}/api/og/competition/${competitionId}/match/${matchId}`,
        link: `${SITE}/competitions/${competitionId}/match/${matchId}`,
        extraLinks: [{
          label: 'Affiche carrée',
          url: `${SITE}/api/og/competition/${competitionId}/match/${matchId}?format=square`,
        }],
      }], { competition: comp, deadlineMs: 10_000 });
    }
  } catch (err) {
    captureApiError(`Publication du résultat impossible (${competitionId})`, err);
  }
}
