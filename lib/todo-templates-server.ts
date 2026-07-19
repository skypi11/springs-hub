// Helpers I/O des templates d'exercices (Admin SDK). La logique PURE vit dans
// lib/todo-templates.ts ; ici uniquement ce qui touche Firestore.
import type { Firestore } from 'firebase-admin/firestore';
import { sharedTemplateCap } from '@/lib/todo-templates';

/**
 * Vérifie qu'une structure n'a pas atteint son cap de templates PARTAGÉS
 * (scope=structure), dérivé de son plan freemium. Appelé par les DEUX chemins
 * de partage (création directe ET promotion perso→structure) — c'est le point
 * unique qui empêche le contournement du cap free (bug §2.1).
 *
 * TOCTOU connu et ASSUMÉ (§2.11) : le comptage puis l'écriture ne sont pas
 * atomiques. Une transaction est impossible ici (pas de `.where` dans une
 * transaction Firestore) sans compteur dénormalisé, dont le risque de désync
 * dépasse celui de dépasser le cap d'une unité sur une course concurrente de
 * simples templates.
 */
export async function checkSharedTemplateCap(
  db: Firestore,
  structureId: string,
  structure: Record<string, unknown> | null | undefined,
): Promise<{ ok: true; cap: number } | { ok: false; cap: number; error: string }> {
  const cap = sharedTemplateCap(structure);
  const snap = await db.collection('structure_todo_templates')
    .where('structureId', '==', structureId)
    .where('scope', '==', 'structure')
    .limit(cap + 1)
    .get();
  if (snap.size >= cap) {
    return {
      ok: false,
      cap,
      // Mène par l'action GRATUITE et actionnable (retirer un template existant),
      // comme le message frère du stockage — pas un cul-de-sac « Pro » alors
      // qu'aucun parcours d'achat n'existe. Le Pro est mentionné au futur.
      error: `Limite atteinte : ${cap} templates partagés pour la structure. Retire un template partagé existant pour faire de la place. Une future version premium permettra d'en partager davantage.`,
    };
  }
  return { ok: true, cap };
}
