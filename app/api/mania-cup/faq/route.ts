import { NextRequest, NextResponse } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { getAdminDb, verifyAuth, isCompetitionAdmin } from '@/lib/firebase-admin';
import { limiters, rateLimitKey, checkRateLimit } from '@/lib/rate-limit';
import { captureApiError } from '@/lib/sentry';
import { writeAdminAuditLog } from '@/lib/admin-audit-log';
import { clampString } from '@/lib/validation';
import {
  MANIA_CUP_FAQ_COLLECTION,
  MANIA_CUP_FAQ_DOC,
  FAQ_LIMITS,
  type FaqItem,
} from '@/lib/mania-cup-faq';

// FAQ de la Springs Mania Cup.
//
// GET — public, sans compte : c'est le premier endroit où va quelqu'un qui
//       hésite, il ne doit pas avoir à se connecter pour lire une réponse.
// PUT — remplace la liste entière (admins de compétition). Remplacer plutôt que
//       modifier item par item : l'éditeur travaille sur la liste complète, et
//       un enregistrement partiel laisserait la FAQ dans un état incohérent si
//       la connexion lâche en cours de route.

function docRef() {
  return getAdminDb().collection(MANIA_CUP_FAQ_COLLECTION).doc(MANIA_CUP_FAQ_DOC);
}

export async function GET(req: NextRequest) {
  const blocked = await checkRateLimit(limiters.read, rateLimitKey(req));
  if (blocked) return blocked;

  try {
    const snap = await docRef().get();
    const items = (snap.data()?.items ?? []) as FaqItem[];
    return NextResponse.json({ items, updatedAt: snap.data()?.updatedAt?.toDate?.()?.toISOString() ?? null });
  } catch (err) {
    captureApiError('mania-cup/faq:GET', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const uid = await verifyAuth(req);
    if (!uid || !(await isCompetitionAdmin(uid))) {
      return NextResponse.json({ error: 'Réservé aux administrateurs' }, { status: 403 });
    }

    const blocked = await checkRateLimit(limiters.admin, rateLimitKey(req, uid));
    if (blocked) return blocked;

    const body = (await req.json().catch(() => null)) as { items?: unknown } | null;
    if (!Array.isArray(body?.items)) {
      return NextResponse.json({ error: 'Requête invalide' }, { status: 400 });
    }
    if (body.items.length > FAQ_LIMITS.items) {
      return NextResponse.json(
        { error: `${FAQ_LIMITS.items} questions au maximum.` },
        { status: 400 }
      );
    }

    // Les entrées vides sont écartées silencieusement : un bloc laissé blanc
    // dans l'éditeur ne doit pas apparaître sur la page publique.
    const items: FaqItem[] = body.items
      .map((raw) => {
        const r = raw as { q?: unknown; a?: unknown };
        return {
          q: clampString(r.q, FAQ_LIMITS.question),
          a: clampString(r.a, FAQ_LIMITS.answer),
        };
      })
      .filter((it) => it.q && it.a);

    await docRef().set(
      {
        items,
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: uid,
      },
      { merge: true }
    );

    await writeAdminAuditLog(getAdminDb(), {
      action: 'rulebook_published',
      adminUid: uid,
      targetType: 'event',
      targetId: 'mania-cup-faq',
      targetLabel: 'FAQ Springs Mania Cup',
      metadata: { count: items.length },
    });

    return NextResponse.json({ items });
  } catch (err) {
    captureApiError('mania-cup/faq:PUT', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
