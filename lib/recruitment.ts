import type { Firestore, QuerySnapshot } from 'firebase-admin/firestore';

// Source de vérité unique de l'invariant « un joueur rostered ne peut pas être
// LFT ». Un joueur est « rostered » s'il est titulaire ou remplaçant d'au moins
// une équipe NON archivée — aligné avec checkPlayerExclusivity (teams/route.ts)
// et fetchUserStructures, qui ignorent eux aussi les équipes archivées.
//
// Le staff (staffIds) N'EST PAS considéré rostered : un coach/manager peut être
// LFT en tant que joueur. Seuls playerIds/subIds comptent.
export async function isUserRostered(db: Firestore, uid: string): Promise<boolean> {
  const [players, subs] = await Promise.all([
    db.collection('sub_teams').where('playerIds', 'array-contains', uid).limit(10).get(),
    db.collection('sub_teams').where('subIds', 'array-contains', uid).limit(10).get(),
  ]);
  const hasActive = (snap: QuerySnapshot) => snap.docs.some(d => d.data().status !== 'archived');
  return hasActive(players) || hasActive(subs);
}
