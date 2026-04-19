import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb, verifyAuth } from '@/lib/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { captureApiError } from '@/lib/sentry';
import { limiters, rateLimitKey, checkRateLimit } from '@/lib/rate-limit';
import { resolveUserContext } from '@/lib/event-context';
import { isDirigeant, isStaff } from '@/lib/event-permissions';
import { validateUpdateTemplate, TEMPLATE_MAX_PER_SCOPE, TEMPLATE_SCOPES } from '@/lib/todo-templates';
import { TODO_TYPES, type TodoType } from '@/lib/todos';

// PATCH /api/structures/[id]/todo-templates/[templateId]
// Actions :
//  - edit  (par défaut) : { name?, titleTemplate?, descriptionTemplate?, config? }
//    → owner uniquement. Le type est immuable (changer de type = créer un nouveau template).
//  - share : { action: 'share', scope: 'structure'|'personal' }
//    → owner uniquement. Bascule scope perso ↔ structure.
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; templateId: string }> }
) {
  try {
    const uid = await verifyAuth(req);
    if (!uid) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

    const blocked = await checkRateLimit(limiters.write, rateLimitKey(req, uid));
    if (blocked) return blocked;

    const { id: structureId, templateId } = await params;
    const db = getAdminDb();

    const resolved = await resolveUserContext(db, uid, structureId);
    if (!resolved) {
      return NextResponse.json({ error: 'Structure introuvable ou inaccessible' }, { status: 404 });
    }
    if (!isStaff(resolved.context)) {
      return NextResponse.json({ error: 'Accès réservé au staff.' }, { status: 403 });
    }

    const ref = db.collection('structure_todo_templates').doc(templateId);
    const snap = await ref.get();
    if (!snap.exists) {
      return NextResponse.json({ error: 'Template introuvable.' }, { status: 404 });
    }
    const data = snap.data()!;
    if (data.structureId !== structureId) {
      return NextResponse.json({ error: 'Template hors de cette structure.' }, { status: 400 });
    }

    // Éditer un template = owner uniquement (décision UX : "le coach connaît mieux son template").
    if (data.ownerId !== uid) {
      return NextResponse.json({ error: 'Seul le créateur du template peut le modifier.' }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const action = (typeof body?.action === 'string' ? body.action : 'edit') as string;

    if (action === 'share') {
      const newScope = body?.scope;
      if (typeof newScope !== 'string' || !(TEMPLATE_SCOPES as readonly string[]).includes(newScope)) {
        return NextResponse.json({ error: 'Portée invalide.' }, { status: 400 });
      }
      if (newScope === data.scope) {
        // idempotent : pas d'erreur, mais rien à faire
        return NextResponse.json({ success: true, scope: newScope });
      }
      // Si on bascule → structure, vérifier le cap structure.
      if (newScope === 'structure') {
        const count = await db.collection('structure_todo_templates')
          .where('structureId', '==', structureId)
          .where('scope', '==', 'structure')
          .limit(TEMPLATE_MAX_PER_SCOPE + 1)
          .get();
        if (count.size >= TEMPLATE_MAX_PER_SCOPE) {
          return NextResponse.json({
            error: `Limite atteinte (${TEMPLATE_MAX_PER_SCOPE} templates structure max).`,
          }, { status: 400 });
        }
      }
      await ref.update({ scope: newScope, updatedAt: FieldValue.serverTimestamp() });
      return NextResponse.json({ success: true, scope: newScope });
    }

    // Edit par défaut
    const existingType: TodoType = (typeof data.type === 'string' && (TODO_TYPES as readonly string[]).includes(data.type))
      ? (data.type as TodoType)
      : 'free';
    const patchRes = validateUpdateTemplate(existingType, body);
    if (!patchRes.ok) {
      return NextResponse.json({ error: patchRes.error }, { status: 400 });
    }
    const patch = patchRes.value;
    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ success: true });
    }

    await ref.update({ ...patch, updatedAt: FieldValue.serverTimestamp() });
    return NextResponse.json({ success: true });
  } catch (err) {
    captureApiError('API Structures/todo-templates PATCH error', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}

// DELETE /api/structures/[id]/todo-templates/[templateId]
// Supprimer un template : owner OU dirigeant (ménage : un coach parti laisse ses templates).
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; templateId: string }> }
) {
  try {
    const uid = await verifyAuth(req);
    if (!uid) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

    const blocked = await checkRateLimit(limiters.write, rateLimitKey(req, uid));
    if (blocked) return blocked;

    const { id: structureId, templateId } = await params;
    const db = getAdminDb();

    const resolved = await resolveUserContext(db, uid, structureId);
    if (!resolved) {
      return NextResponse.json({ error: 'Structure introuvable ou inaccessible' }, { status: 404 });
    }
    if (!isStaff(resolved.context)) {
      return NextResponse.json({ error: 'Accès réservé au staff.' }, { status: 403 });
    }

    const ref = db.collection('structure_todo_templates').doc(templateId);
    const snap = await ref.get();
    if (!snap.exists) {
      return NextResponse.json({ error: 'Template introuvable.' }, { status: 404 });
    }
    const data = snap.data()!;
    if (data.structureId !== structureId) {
      return NextResponse.json({ error: 'Template hors de cette structure.' }, { status: 400 });
    }

    const isOwner = data.ownerId === uid;
    if (!isOwner && !isDirigeant(resolved.context)) {
      return NextResponse.json({ error: 'Seul le créateur ou un dirigeant peut supprimer ce template.' }, { status: 403 });
    }

    await ref.delete();
    return NextResponse.json({ success: true });
  } catch (err) {
    captureApiError('API Structures/todo-templates DELETE error', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
