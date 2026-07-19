import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb, verifyAuth } from '@/lib/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { captureApiError } from '@/lib/sentry';
import { limiters, rateLimitKey, checkRateLimit } from '@/lib/rate-limit';
import { resolveUserContext } from '@/lib/event-context';
import { resolveStructureId } from '@/lib/resolve-structure-id';
import { hasAnyStaffAccess } from '@/lib/event-permissions';
import { validateCreateTemplate, TEMPLATE_MAX_PER_SCOPE } from '@/lib/todo-templates';
import { checkSharedTemplateCap } from '@/lib/todo-templates-server';

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

    const { id: slugOrId } = await params;
    const db = getAdminDb();
    const structureId = await resolveStructureId(slugOrId, db);
    if (!structureId) {
      return NextResponse.json({ error: 'Structure introuvable' }, { status: 404 });
    }

    const resolved = await resolveUserContext(db, uid, structureId);
    if (!resolved) {
      return NextResponse.json({ error: 'Structure introuvable ou inaccessible' }, { status: 404 });
    }
    if (!hasAnyStaffAccess(resolved.context)) {
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
        // v3, passé tel quel (le client utilise getSteps en lecture défensive
        // si steps absent, applyTemplate dans NewTodoForm wrap legacy en 1 step).
        ...(Array.isArray(d.steps) ? { steps: d.steps } : {}),
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
// Hard cap : PERSO = TEMPLATE_MAX_PER_SCOPE par (owner, scope), anti-spam.
// STRUCTURE = cap freemium dérivé du plan (checkSharedTemplateCap, 15 free / 50 pro),
// MÊME helper que la promotion perso→structure (source unique, cf. §2.1).
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const uid = await verifyAuth(req);
    if (!uid) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

    const blocked = await checkRateLimit(limiters.write, rateLimitKey(req, uid));
    if (blocked) return blocked;

    const { id: slugOrId } = await params;
    const db = getAdminDb();
    const structureId = await resolveStructureId(slugOrId, db);
    if (!structureId) {
      return NextResponse.json({ error: 'Structure introuvable' }, { status: 404 });
    }

    const resolved = await resolveUserContext(db, uid, structureId);
    if (!resolved) {
      return NextResponse.json({ error: 'Structure introuvable ou inaccessible' }, { status: 404 });
    }
    if (!hasAnyStaffAccess(resolved.context)) {
      return NextResponse.json({ error: 'Accès réservé au staff.' }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const validation = validateCreateTemplate(body);
    if (!validation.ok) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }
    const { scope, name, type, titleTemplate, descriptionTemplate, config, steps } = validation.value;

    // Hard cap. Le cap STRUCTURE dépend du plan freemium (free vs pro) et passe
    // par le MÊME helper que la promotion perso→structure (source unique, cf.
    // bug §2.1). Le cap PERSO reste TEMPLATE_MAX_PER_SCOPE (anti-spam, pas freemium).
    if (scope === 'structure') {
      const capCheck = await checkSharedTemplateCap(db, structureId, resolved.structure as Record<string, unknown>);
      if (!capCheck.ok) {
        return NextResponse.json({ error: capCheck.error }, { status: 400 });
      }
    } else {
      const existing = await db.collection('structure_todo_templates')
        .where('structureId', '==', structureId)
        .where('ownerId', '==', uid)
        .where('scope', '==', 'personal')
        .limit(TEMPLATE_MAX_PER_SCOPE + 1)
        .get();
      if (existing.size >= TEMPLATE_MAX_PER_SCOPE) {
        return NextResponse.json({
          error: `Limite atteinte (${TEMPLATE_MAX_PER_SCOPE} templates personnels max).`,
        }, { status: 400 });
      }
    }

    const now = FieldValue.serverTimestamp();
    const ref = db.collection('structure_todo_templates').doc();
    await ref.set({
      structureId,
      ownerId: uid,
      scope,
      name,
      // legacy fields = type/config du 1er step (rétrocompat lecteurs pas encore migrés)
      type,
      titleTemplate,
      descriptionTemplate,
      config,
      // v3, source de vérité multi-step
      steps: steps.map(s => ({
        id: s.id,
        type: s.type,
        ...(s.label ? { label: s.label } : {}),
        config: s.config,
      })),
      createdAt: now,
      updatedAt: now,
    });

    return NextResponse.json({ success: true, id: ref.id });
  } catch (err) {
    captureApiError('API Structures/todo-templates POST error', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
