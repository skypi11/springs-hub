import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb, verifyAuth } from '@/lib/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { captureApiError } from '@/lib/sentry';
import { limiters, rateLimitKey, checkRateLimit } from '@/lib/rate-limit';
import { resolveUserContext } from '@/lib/event-context';
import { isStaff } from '@/lib/event-permissions';
import { validateCreateTemplate, TEMPLATE_MAX_PER_SCOPE } from '@/lib/todo-templates';

function tsMs(v: unknown): number | null {
  if (!v) return null;
  if (typeof v === 'object' && v !== null && 'toMillis' in v && typeof (v as { toMillis: unknown }).toMillis === 'function') {
    return (v as { toMillis: () => number }).toMillis();
  }
  if (v instanceof Date) return v.getTime();
  return null;
}

// GET /api/structures/[id]/todo-templates
// Liste les templates accessibles à l'utilisateur :
//   - ses templates personnels (scope=personal, ownerId=uid)
//   - tous les templates partagés de la structure (scope=structure)
// Accessible à tout staff de la structure (dirigeant, manager, coach).
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const uid = await verifyAuth(req);
    if (!uid) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

    const blocked = await checkRateLimit(limiters.read, rateLimitKey(req, uid));
    if (blocked) return blocked;

    const { id: structureId } = await params;
    const db = getAdminDb();

    const resolved = await resolveUserContext(db, uid, structureId);
    if (!resolved) {
      return NextResponse.json({ error: 'Structure introuvable ou inaccessible' }, { status: 404 });
    }
    if (!isStaff(resolved.context)) {
      return NextResponse.json({ error: 'Accès réservé au staff.' }, { status: 403 });
    }

    // Deux requêtes parallèles : perso + structure.
    const [personalSnap, structureSnap] = await Promise.all([
      db.collection('structure_todo_templates')
        .where('structureId', '==', structureId)
        .where('ownerId', '==', uid)
        .where('scope', '==', 'personal')
        .limit(TEMPLATE_MAX_PER_SCOPE)
        .get(),
      db.collection('structure_todo_templates')
        .where('structureId', '==', structureId)
        .where('scope', '==', 'structure')
        .limit(TEMPLATE_MAX_PER_SCOPE)
        .get(),
    ]);

    const mapDoc = (doc: FirebaseFirestore.QueryDocumentSnapshot) => {
      const d = doc.data();
      return {
        id: doc.id,
        structureId: d.structureId as string,
        ownerId: d.ownerId as string,
        scope: d.scope as 'personal' | 'structure',
        name: (d.name as string) ?? '',
        type: (typeof d.type === 'string' && d.type) ? d.type : 'free',
        titleTemplate: (d.titleTemplate as string) ?? '',
        descriptionTemplate: (d.descriptionTemplate as string) ?? '',
        config: (d.config && typeof d.config === 'object') ? d.config : {},
        createdAt: tsMs(d.createdAt) ?? 0,
        updatedAt: tsMs(d.updatedAt) ?? tsMs(d.createdAt) ?? 0,
      };
    };

    const templates = [
      ...personalSnap.docs.map(mapDoc),
      ...structureSnap.docs.map(mapDoc),
    ];

    return NextResponse.json({ templates });
  } catch (err) {
    captureApiError('API Structures/todo-templates GET error', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}

// POST /api/structures/[id]/todo-templates
// Crée un template (personal ou structure). Tout staff peut créer.
// Hard cap : TEMPLATE_MAX_PER_SCOPE templates par (owner, scope) pour les perso,
// TEMPLATE_MAX_PER_SCOPE pour toute la structure pour les structure.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const uid = await verifyAuth(req);
    if (!uid) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

    const blocked = await checkRateLimit(limiters.write, rateLimitKey(req, uid));
    if (blocked) return blocked;

    const { id: structureId } = await params;
    const db = getAdminDb();

    const resolved = await resolveUserContext(db, uid, structureId);
    if (!resolved) {
      return NextResponse.json({ error: 'Structure introuvable ou inaccessible' }, { status: 404 });
    }
    if (!isStaff(resolved.context)) {
      return NextResponse.json({ error: 'Accès réservé au staff.' }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const validation = validateCreateTemplate(body);
    if (!validation.ok) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }
    const { scope, name, type, titleTemplate, descriptionTemplate, config } = validation.value;

    // Hard cap : compte les templates existants du même scope/owner.
    const countQuery = scope === 'personal'
      ? db.collection('structure_todo_templates')
          .where('structureId', '==', structureId)
          .where('ownerId', '==', uid)
          .where('scope', '==', 'personal')
      : db.collection('structure_todo_templates')
          .where('structureId', '==', structureId)
          .where('scope', '==', 'structure');

    const existing = await countQuery.limit(TEMPLATE_MAX_PER_SCOPE + 1).get();
    if (existing.size >= TEMPLATE_MAX_PER_SCOPE) {
      return NextResponse.json({
        error: `Limite atteinte (${TEMPLATE_MAX_PER_SCOPE} templates max dans ce scope).`,
      }, { status: 400 });
    }

    const now = FieldValue.serverTimestamp();
    const ref = db.collection('structure_todo_templates').doc();
    await ref.set({
      structureId,
      ownerId: uid,
      scope,
      name,
      type,
      titleTemplate,
      descriptionTemplate,
      config,
      createdAt: now,
      updatedAt: now,
    });

    return NextResponse.json({ success: true, id: ref.id });
  } catch (err) {
    captureApiError('API Structures/todo-templates POST error', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
