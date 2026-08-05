import { NextRequest, NextResponse } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { getAdminDb, verifyAuth } from '@/lib/firebase-admin';
import { limiters, rateLimitKey, checkRateLimit } from '@/lib/rate-limit';
import { captureApiError } from '@/lib/sentry';
import { clampString } from '@/lib/validation';
import {
  MANIA_CUP_REGISTRATIONS,
  MAX_COMPANIONS,
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
// POST   — déclarer un accompagnant de plus
// DELETE — en retirer un, par son rang dans la liste
//
// Déclarable à tout moment après l'inscription : un joueur peut décider en
// septembre que son père l'accompagne, sans refaire son dossier.
//
// Un accompagnant dont le billet est RÉGLÉ ne se retire plus depuis le site :
// il y aurait un remboursement à traiter, et une place en zone joueurs déjà
// payée ne disparaît pas d'un clic.

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
      name?: unknown;
      role?: unknown;
      index?: unknown;
    } | null;
    const name = clampString(body?.name, 80).trim();
    const role = clampString(body?.role, 60).trim();
    if (!name) {
      return NextResponse.json(
        { error: 'Indique le nom et le prénom de ton accompagnant.' },
        { status: 400 }
      );
    }

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
      const entry: ManiaCupCompanion = {
        name,
        role: role || 'Accompagnant',
        declaredAt: FieldValue.serverTimestamp(),
        ticketItemId: null,
      };

      // `index` fourni : c'est une modification. Absent : un ajout.
      const index = typeof body?.index === 'number' ? body.index : -1;
      let next: ManiaCupCompanion[];

      if (index >= 0) {
        if (index >= companions.length) {
          return { error: 'Cet accompagnant n’existe plus.', status: 404 };
        }
        // Le billet déjà réglé reste attaché à la personne : renommer ne doit
        // pas faire perdre la trace du paiement.
        const previous = companions[index];
        next = companions.map((c, i) =>
          i === index
            ? { ...entry, ticketItemId: previous.ticketItemId ?? null, ticketPaidAt: previous.ticketPaidAt }
            : c
        );
      } else {
        if (companions.length >= MAX_COMPANIONS) {
          return {
            error: `Tu peux déclarer ${MAX_COMPANIONS} accompagnants au maximum.`,
            status: 409,
          };
        }
        next = [...companions, entry];
      }

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

export async function DELETE(req: NextRequest) {
  try {
    const uid = await verifyAuth(req);
    if (!uid) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

    const blocked = await checkRateLimit(limiters.write, rateLimitKey(req, uid));
    if (blocked) return blocked;

    const index = Number(req.nextUrl.searchParams.get('index'));
    if (!Number.isInteger(index) || index < 0) {
      return NextResponse.json({ error: 'Requête invalide' }, { status: 400 });
    }

    const db = getAdminDb();
    const docRef = db.collection(MANIA_CUP_REGISTRATIONS).doc(uid);

    const result = await db.runTransaction(async (tx) => {
      const snap = await tx.get(docRef);
      if (!snap.exists) return { error: 'Aucune inscription.', status: 404 };

      const companions = readCompanions(snap.data() as ManiaCupRegistration);
      if (index >= companions.length) {
        return { error: 'Cet accompagnant n’existe plus.', status: 404 };
      }
      if (isCompanionPaid(companions[index])) {
        return {
          error:
            'Son billet est déjà réglé. Contacte l’organisation sur le Discord Springs pour l’annuler et demander un remboursement.',
          status: 409,
        };
      }

      tx.update(docRef, {
        companions: companions.filter((_, i) => i !== index),
        updatedAt: FieldValue.serverTimestamp(),
      });
      return { ok: true };
    });

    if ('error' in result) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    captureApiError('mania-cup/companion:DELETE', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
