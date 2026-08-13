import { NextRequest, NextResponse } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { getAdminDb, verifyAuth } from '@/lib/firebase-admin';
import { limiters, rateLimitKey, checkRateLimit } from '@/lib/rate-limit';
import { captureApiError } from '@/lib/sentry';
import { clampString } from '@/lib/validation';
import {
  MANIA_CUP_REGISTRATIONS,
  COMPANION_DISPLAY_NAME_MAX,
  isCompanionPaid,
  type ManiaCupCompanion,
  type ManiaCupRegistration,
} from '@/lib/mania-cup';

// Les accompagnants d'un joueur — trois au maximum.
//
// Un billet accompagnant donne accès à la ZONE JOUEURS, contrairement à un
// billet spectateur. Il ne peut donc pas circuler librement : il est rattaché à
// un joueur identifié, et l'accueil doit pouvoir dire qui accompagne qui.
//
// UN ACCOMPAGNANT NE SE DÉCLARE PLUS. Il apparaît quand son billet est payé,
// et pas avant. La déclaration préalable demandait au joueur de saisir un nom
// qui était de toute façon REMPLACÉ par celui du billet à l'encaissement — un
// travail pour rien —, laissait des lignes « à régler » qui n'ouvraient aucun
// droit, et permettait de renommer après coup la personne contrôlée à l'entrée.
// Le rattachement d'un billet sans déclaration correspondante était déjà géré :
// `assignCompanionTicket` crée l'entrée à partir du nom du billet.
//
// POST — changer ce qui s'IMPRIME sur le badge d'un accompagnant : son pseudo,
//        et le lien qui l'unit au joueur. Jamais son nom : c'est celui du
//        billet, et c'est lui qu'on contrôle à l'entrée.

/** Lecture tolérante : les tout premiers dossiers portaient un accompagnant
 *  unique, sous un autre nom de champ. */
function readCompanions(reg: ManiaCupRegistration): ManiaCupCompanion[] {
  if (Array.isArray(reg.companions)) return reg.companions;
  const legacy = (reg as { companion?: ManiaCupCompanion | null }).companion;
  return legacy?.name ? [legacy] : [];
}

export async function POST(req: NextRequest) {
  try {
    const uid = await verifyAuth(req);
    if (!uid) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

    const blocked = await checkRateLimit(limiters.write, rateLimitKey(req, uid));
    if (blocked) return blocked;

    const body = (await req.json().catch(() => null)) as {
      index?: unknown;
      displayName?: unknown;
      role?: unknown;
    } | null;

    const index = typeof body?.index === 'number' ? body.index : -1;
    if (!Number.isInteger(index) || index < 0) {
      return NextResponse.json({ error: 'Requête invalide' }, { status: 400 });
    }

    // Borné court : au-delà, le pseudo ne tient plus sur le badge — et la
    // planche s'imprime telle quelle.
    const displayName = clampString(body?.displayName, COMPANION_DISPLAY_NAME_MAX).trim();
    const role = clampString(body?.role, 60).trim();

    const db = getAdminDb();
    const docRef = db.collection(MANIA_CUP_REGISTRATIONS).doc(uid);

    const result = await db.runTransaction(async (tx) => {
      const snap = await tx.get(docRef);
      if (!snap.exists) return { error: 'Inscris-toi d’abord.', status: 404 };

      const reg = snap.data() as ManiaCupRegistration;
      if (reg.status === 'cancelled') {
        return { error: 'Ton inscription a été retirée.', status: 409 };
      }

      const companions = readCompanions(reg);
      if (index >= companions.length) {
        return { error: 'Cet accompagnant n’existe plus.', status: 404 };
      }

      const cible = companions[index];
      if (!isCompanionPaid(cible)) {
        return {
          error: 'Cet accompagnant n’a pas encore de billet réglé.',
          status: 409,
        };
      }

      // On repart de l'existant et on ne remplace QUE l'affichage : `name`,
      // `ticketItemId` et `ticketPaidAt` sont la trace du billet payé. Les
      // reconstruire à neuf, comme le faisait l'ancienne version, effaçait en
      // silence tout champ que le client n'avait pas renvoyé.
      const next = companions.map((c, i) =>
        i === index
          ? {
              ...c,
              displayName: displayName || null,
              ...(role ? { role } : {}),
            }
          : c
      );

      tx.update(docRef, { companions: next, updatedAt: FieldValue.serverTimestamp() });
      return { ok: true };
    });

    if ('error' in result) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    captureApiError('mania-cup/companion:POST', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
