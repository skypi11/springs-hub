import { NextRequest, NextResponse } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { getAdminDb, verifyAuth } from '@/lib/firebase-admin';
import { limiters, rateLimitKey, checkRateLimit } from '@/lib/rate-limit';
import { captureApiError } from '@/lib/sentry';
import { clampString } from '@/lib/validation';
import { MANIA_CUP_REGISTRATIONS, type ManiaCupRegistration } from '@/lib/mania-cup';

// Accompagnant d'un joueur (billet « staff » sur HelloAsso).
//
// Un billet staff donne accès à la ZONE JOUEURS, contrairement à un billet
// spectateur. Il ne peut donc pas circuler librement : il est rattaché à un
// joueur identifié, et l'accueil doit pouvoir dire qui accompagne qui.
//
// POST   — déclarer ou remplacer son accompagnant
// DELETE — le retirer
//
// Déclarable à tout moment après l'inscription : un joueur peut décider en
// septembre que son père l'accompagne, sans refaire son dossier.

export async function POST(req: NextRequest) {
  try {
    const uid = await verifyAuth(req);
    if (!uid) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

    const blocked = await checkRateLimit(limiters.write, rateLimitKey(req, uid));
    if (blocked) return blocked;

    const body = (await req.json().catch(() => null)) as { name?: unknown; role?: unknown } | null;
    const name = clampString(body?.name, 80);
    const role = clampString(body?.role, 60);
    if (!name) {
      return NextResponse.json(
        { error: 'Indique le nom et le prénom de ton accompagnant.' },
        { status: 400 }
      );
    }

    const db = getAdminDb();
    const docRef = db.collection(MANIA_CUP_REGISTRATIONS).doc(uid);
    const snap = await docRef.get();
    if (!snap.exists) {
      return NextResponse.json({ error: 'Inscris-toi d’abord.' }, { status: 404 });
    }
    if ((snap.data() as ManiaCupRegistration).status === 'cancelled') {
      return NextResponse.json({ error: 'Ton inscription a été retirée.' }, { status: 409 });
    }

    await docRef.update({
      companion: { name, role: role || 'Accompagnant', declaredAt: FieldValue.serverTimestamp() },
      updatedAt: FieldValue.serverTimestamp(),
    });

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

    await getAdminDb()
      .collection(MANIA_CUP_REGISTRATIONS)
      .doc(uid)
      .update({ companion: FieldValue.delete(), updatedAt: FieldValue.serverTimestamp() });

    return NextResponse.json({ ok: true });
  } catch (err) {
    captureApiError('mania-cup/companion:DELETE', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
