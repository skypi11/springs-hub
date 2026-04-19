import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb, verifyAuth } from '@/lib/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { captureApiError } from '@/lib/sentry';
import { limiters, rateLimitKey, checkRateLimit } from '@/lib/rate-limit';
import { resolveUserContext } from '@/lib/event-context';
import { isStaffOfTeam } from '@/lib/event-permissions';
import {
  TODO_TITLE_MAX,
  TODO_DESCRIPTION_MAX,
  TODO_TYPES,
  validateTodoConfig,
  validateTodoResponse,
  TODO_TYPE_META,
  endOfDayParisMs,
  type TodoType,
} from '@/lib/todos';

// PATCH /api/structures/[id]/todos/[todoId]
// Actions :
//  - toggle done : { action: 'toggle' } — l'assignee ou un staff d'équipe
//  - edit        : { action: 'edit', title?, description?, deadline? } — staff d'équipe uniquement
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; todoId: string }> }
) {
  try {
    const uid = await verifyAuth(req);
    if (!uid) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

    const blocked = await checkRateLimit(limiters.write, rateLimitKey(req, uid));
    if (blocked) return blocked;

    const { id: structureId, todoId } = await params;
    const db = getAdminDb();

    const resolved = await resolveUserContext(db, uid, structureId);
    if (!resolved) {
      return NextResponse.json({ error: 'Structure introuvable ou inaccessible' }, { status: 404 });
    }

    const ref = db.collection('structure_todos').doc(todoId);
    const snap = await ref.get();
    if (!snap.exists) {
      return NextResponse.json({ error: 'Devoir introuvable.' }, { status: 404 });
    }
    const data = snap.data()!;
    if (data.structureId !== structureId) {
      return NextResponse.json({ error: 'Devoir hors de cette structure.' }, { status: 400 });
    }

    const body = await req.json().catch(() => ({}));
    const action = body?.action as string | undefined;

    const isStaff = isStaffOfTeam(resolved.context, data.subTeamId as string);
    const isAssignee = data.assigneeId === uid;

    if (action === 'toggle') {
      // L'assignee ou un staff de l'équipe peut toggle
      if (!isAssignee && !isStaff) {
        return NextResponse.json({ error: 'Permissions insuffisantes.' }, { status: 403 });
      }
      const willBeDone = !data.done;
      const type: TodoType = (typeof data.type === 'string' && (TODO_TYPES as readonly string[]).includes(data.type))
        ? (data.type as TodoType)
        : 'free';
      const needsResponse = TODO_TYPE_META[type].needsResponse;

      const updates: Record<string, unknown> = {
        done: willBeDone,
        doneAt: willBeDone ? FieldValue.serverTimestamp() : null,
        doneBy: willBeDone ? uid : null,
        updatedAt: FieldValue.serverTimestamp(),
      };

      if (willBeDone && needsResponse) {
        // Type avec réponse : l'assignee doit fournir une réponse valide
        // (le staff peut forcer la clôture sans réponse — utile pour annuler un devoir abandonné)
        if (isAssignee && !isStaff) {
          const resp = validateTodoResponse(type, body.response);
          if (!resp.ok) {
            return NextResponse.json({ error: resp.error }, { status: 400 });
          }
          updates.response = resp.value;
        } else if (body.response !== undefined) {
          // Staff qui fournit quand même une réponse (ex: forcer clôture avec note)
          const resp = validateTodoResponse(type, body.response);
          if (!resp.ok) {
            return NextResponse.json({ error: resp.error }, { status: 400 });
          }
          updates.response = resp.value;
        }
      } else if (!willBeDone) {
        // On repasse à pending → on remet la réponse à null
        updates.response = null;
      }

      await ref.update(updates);
      return NextResponse.json({ success: true, done: willBeDone });
    }

    if (action === 'edit') {
      if (!isStaff) {
        return NextResponse.json({ error: 'Seul le staff peut éditer ce devoir.' }, { status: 403 });
      }
      const patch: Record<string, unknown> = { updatedAt: FieldValue.serverTimestamp() };

      if (typeof body.title === 'string') {
        const trimmed = body.title.trim();
        if (!trimmed) {
          return NextResponse.json({ error: 'Le titre ne peut pas être vide.' }, { status: 400 });
        }
        patch.title = trimmed.slice(0, TODO_TITLE_MAX);
      }
      if (typeof body.description === 'string') {
        patch.description = body.description.trim().slice(0, TODO_DESCRIPTION_MAX);
      }

      // Changement de type + config ensemble : si type fourni, config doit être revalidée
      // (les clés d'un type ne correspondent pas à un autre type)
      const newType: TodoType | undefined = (typeof body.type === 'string' && (TODO_TYPES as readonly string[]).includes(body.type))
        ? (body.type as TodoType)
        : undefined;
      const currentType: TodoType = (typeof data.type === 'string' && (TODO_TYPES as readonly string[]).includes(data.type))
        ? (data.type as TodoType)
        : 'free';
      const effectiveType = newType ?? currentType;

      if (newType !== undefined || body.config !== undefined) {
        const rawConfig = body.config !== undefined ? body.config : (newType ? {} : data.config);
        const cfg = validateTodoConfig(effectiveType, rawConfig);
        if (!cfg.ok) return NextResponse.json({ error: cfg.error }, { status: 400 });
        patch.config = cfg.value;
        if (newType !== undefined) patch.type = newType;
      }

      // Édition manuelle = toujours mode absolute. On clear les champs relative pour éviter
      // un ré-écrasement par le recalc event PATCH.
      if (body.deadline === null || body.deadline === '') {
        patch.deadline = null;
        patch.deadlineAt = null;
        patch.deadlineMode = null;
        patch.deadlineOffsetDays = null;
      } else if (typeof body.deadline === 'string') {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(body.deadline)) {
          return NextResponse.json({ error: 'Deadline invalide.' }, { status: 400 });
        }
        const d = new Date(body.deadline + 'T12:00:00Z');
        if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== body.deadline) {
          return NextResponse.json({ error: 'Deadline invalide.' }, { status: 400 });
        }
        patch.deadline = body.deadline;
        patch.deadlineAt = endOfDayParisMs(body.deadline);
        patch.deadlineMode = 'absolute';
        patch.deadlineOffsetDays = null;
      }

      await ref.update(patch);
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: 'Action invalide.' }, { status: 400 });
  } catch (err) {
    captureApiError('API Structures/todos PATCH error', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}

// DELETE /api/structures/[id]/todos/[todoId] — staff d'équipe uniquement
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; todoId: string }> }
) {
  try {
    const uid = await verifyAuth(req);
    if (!uid) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

    const blocked = await checkRateLimit(limiters.write, rateLimitKey(req, uid));
    if (blocked) return blocked;

    const { id: structureId, todoId } = await params;
    const db = getAdminDb();

    const resolved = await resolveUserContext(db, uid, structureId);
    if (!resolved) {
      return NextResponse.json({ error: 'Structure introuvable ou inaccessible' }, { status: 404 });
    }

    const ref = db.collection('structure_todos').doc(todoId);
    const snap = await ref.get();
    if (!snap.exists) {
      return NextResponse.json({ error: 'Devoir introuvable.' }, { status: 404 });
    }
    const data = snap.data()!;
    if (data.structureId !== structureId) {
      return NextResponse.json({ error: 'Devoir hors de cette structure.' }, { status: 400 });
    }

    if (!isStaffOfTeam(resolved.context, data.subTeamId as string)) {
      return NextResponse.json({ error: 'Seul le staff peut supprimer ce devoir.' }, { status: 403 });
    }

    await ref.delete();
    return NextResponse.json({ success: true });
  } catch (err) {
    captureApiError('API Structures/todos DELETE error', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
