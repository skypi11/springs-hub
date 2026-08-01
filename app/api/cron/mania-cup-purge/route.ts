import { NextRequest, NextResponse } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { getAdminDb } from '@/lib/firebase-admin';
import { captureApiError } from '@/lib/sentry';
import { deleteFileSilent } from '@/lib/storage';
import {
  MANIA_CUP,
  MANIA_CUP_REGISTRATIONS,
  GUARDIAN_DOCS_RETENTION_DAYS,
  type ManiaCupRegistration,
} from '@/lib/mania-cup';

// GET /api/cron/mania-cup-purge
//
// Supprime les pièces des dossiers mineurs (autorisation parentale + pièce
// d'identité du représentant légal) une fois la LAN passée.
//
// Ce n'est pas du ménage optionnel : on annonce au joueur, au moment du dépôt,
// que ses documents seront supprimés après l'événement. Sans ce cron, la
// promesse ne tient pas et des copies de papiers d'identité s'accumulent sur
// le stockage sans que personne n'y repense.
//
// La route est inerte avant l'échéance : elle peut tourner tous les jours sans
// rien faire, et se déclenche d'elle-même le moment venu.

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get('authorization') || '';
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });
    }
  } else {
    return NextResponse.json({ error: 'CRON_SECRET non configuré' }, { status: 500 });
  }

  try {
    const purgeFrom = new Date(`${MANIA_CUP.endDate}T00:00:00Z`);
    purgeFrom.setUTCDate(purgeFrom.getUTCDate() + GUARDIAN_DOCS_RETENTION_DAYS);

    if (Date.now() < purgeFrom.getTime()) {
      return NextResponse.json({
        purged: 0,
        note: `Purge prévue à partir du ${purgeFrom.toISOString().slice(0, 10)}`,
      });
    }

    const db = getAdminDb();
    const snap = await db.collection(MANIA_CUP_REGISTRATIONS).get();

    let purged = 0;
    let files = 0;
    for (const doc of snap.docs) {
      const reg = doc.data() as ManiaCupRegistration;
      const docs = reg.guardianDocs ?? {};
      const keys = Object.values(docs)
        .map((d) => d?.key)
        .filter((k): k is string => Boolean(k));
      if (keys.length === 0) continue;

      // Suppression silencieuse : un fichier déjà absent ne doit pas empêcher
      // de nettoyer la fiche, sinon la purge se rejoue indéfiniment.
      for (const key of keys) {
        await deleteFileSilent(key);
        files++;
      }

      await doc.ref.update({
        guardianDocs: FieldValue.delete(),
        guardianDocsPurgedAt: FieldValue.serverTimestamp(),
      });
      purged++;
    }

    return NextResponse.json({ purged, files });
  } catch (err) {
    captureApiError('cron/mania-cup-purge', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
