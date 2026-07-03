import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb, verifyAuth, isCompetitionAdmin } from '@/lib/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { captureApiError } from '@/lib/sentry';
import { limiters, rateLimitKey, checkRateLimit } from '@/lib/rate-limit';
import { writeAdminAuditLog } from '@/lib/admin-audit-log';
import { clampString, LIMITS } from '@/lib/validation';
import { rulebookDocId, getRulebookByScope } from '@/lib/competitions/rulebooks';

// Règlement de compétition versionné (spec §13bis). Rédaction/édition par les
// admins de compétition (rôle scopé inclus — c'est leur périmètre). Chaque
// publication archive la version précédente dans /versions/{n} : traçabilité
// légale de la version acceptée par chaque équipe à l'inscription.

function parseScope(raw: { circuitId?: unknown; competitionId?: unknown }):
  | { circuitId: string }
  | { competitionId: string }
  | null {
  if (typeof raw.circuitId === 'string' && raw.circuitId.trim()) {
    return { circuitId: raw.circuitId.trim() };
  }
  if (typeof raw.competitionId === 'string' && raw.competitionId.trim()) {
    return { competitionId: raw.competitionId.trim() };
  }
  return null;
}

// GET /api/admin/rulebooks?circuitId=X | ?competitionId=Y
export async function GET(req: NextRequest) {
  try {
    const uid = await verifyAuth(req);
    if (!uid) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
    if (!(await isCompetitionAdmin(uid))) {
      return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });
    }

    const scope = parseScope({
      circuitId: req.nextUrl.searchParams.get('circuitId'),
      competitionId: req.nextUrl.searchParams.get('competitionId'),
    });
    if (!scope) return NextResponse.json({ error: 'Scope requis (circuitId ou competitionId).' }, { status: 400 });

    const rulebook = await getRulebookByScope(getAdminDb(), scope);
    return NextResponse.json({ rulebook });
  } catch (err) {
    captureApiError('API Admin/Rulebooks GET error', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}

// POST /api/admin/rulebooks — publier une nouvelle version
export async function POST(req: NextRequest) {
  try {
    const uid = await verifyAuth(req);
    if (!uid) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
    if (!(await isCompetitionAdmin(uid))) {
      return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });
    }

    const blocked = await checkRateLimit(limiters.admin, rateLimitKey(req, uid));
    if (blocked) return blocked;

    const body = await req.json();
    const scope = parseScope(body);
    if (!scope) return NextResponse.json({ error: 'Scope requis (circuitId ou competitionId).' }, { status: 400 });

    const markdown = clampString(body.markdown, LIMITS.rulebookMarkdown);
    if (!markdown.trim()) {
      return NextResponse.json({ error: 'Le règlement ne peut pas être vide.' }, { status: 400 });
    }

    const db = getAdminDb();

    // Le scope doit pointer sur un doc réel (pas de règlement orphelin)
    const targetCol = 'circuitId' in scope ? 'circuits' : 'competitions';
    const targetId = 'circuitId' in scope ? scope.circuitId : scope.competitionId;
    const targetSnap = await db.collection(targetCol).doc(targetId).get();
    if (!targetSnap.exists) {
      return NextResponse.json({ error: 'Circuit ou compétition introuvable.' }, { status: 404 });
    }

    const ref = db.collection('rulebooks').doc(rulebookDocId(scope));

    // Transaction : archive la version courante PUIS écrit la nouvelle — pas
    // de trou dans l'historique même si deux admins publient en même temps.
    const newVersion = await db.runTransaction(async tx => {
      const snap = await tx.get(ref);
      if (!snap.exists) {
        tx.set(ref, {
          scope,
          markdown,
          version: 1,
          updatedAt: FieldValue.serverTimestamp(),
          updatedBy: uid,
        });
        return 1;
      }
      const current = snap.data()!;
      const version = (current.version ?? 1) + 1;
      tx.set(ref.collection('versions').doc(String(current.version ?? 1)), {
        markdown: current.markdown ?? '',
        version: current.version ?? 1,
        updatedAt: current.updatedAt ?? null,
        updatedBy: current.updatedBy ?? null,
        archivedAt: FieldValue.serverTimestamp(),
      });
      tx.update(ref, {
        markdown,
        version,
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: uid,
      });
      return version;
    });

    await writeAdminAuditLog(db, {
      action: 'rulebook_published',
      adminUid: uid,
      targetType: 'circuitId' in scope ? 'circuit' : 'competition',
      targetId,
      targetLabel: (targetSnap.data()?.name as string) ?? null,
      metadata: { version: newVersion, length: markdown.length },
    });

    return NextResponse.json({ success: true, version: newVersion });
  } catch (err) {
    captureApiError('API Admin/Rulebooks POST error', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
