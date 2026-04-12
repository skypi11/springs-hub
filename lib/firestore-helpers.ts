import { Firestore, DocumentData } from 'firebase-admin/firestore';

// Charger plusieurs documents par ID en batch (Firestore 'in' max 30 par requête).
// Renvoie une Map id → data() (les IDs manquants sont absents de la Map).
export async function fetchDocsByIds(
  db: Firestore,
  collection: string,
  ids: string[]
): Promise<Map<string, DocumentData>> {
  const result = new Map<string, DocumentData>();
  if (ids.length === 0) return result;

  // Dédupe et chunks de 30
  const unique = Array.from(new Set(ids));
  for (let i = 0; i < unique.length; i += 30) {
    const chunk = unique.slice(i, i + 30);
    const snap = await db.collection(collection)
      .where('__name__', 'in', chunk)
      .get();
    for (const doc of snap.docs) {
      result.set(doc.id, doc.data());
    }
  }
  return result;
}
