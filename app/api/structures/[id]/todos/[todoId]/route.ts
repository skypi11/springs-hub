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
  TODO_TYPES_ALL,
  validateTodoConfig,
  validateTodoResponse,
  validateStepResponse,
  getSteps,
  TODO_TYPE_META,
  endOfDayParisMs,
  type TodoType,
  type ExerciseStep,
} from '@/lib/todos';

// PATCH /api/structures/[id]/todos/[todoId]
// Actions :
//  - toggle done       : { action: 'toggle' } — l'assignee ou un staff d'équipe (legacy single-step)
//  - toggleStep        : { action: 'toggleStep', stepId, completed, response? } — multi-steps v3
//  - editStepResponse  : { action: 'editStepResponse', stepId, response } — édite réponse step (avant verrouillage)
//  - lock              : { action: 'lock' } — verrouille l'exo (tous steps doivent être done). Assignee ou staff.
//  - unlock            : { action: 'unlock' } — déverrouille pour permettre modification. Staff uniquement.
//  - edit              : { action: 'edit', title?, description?, deadline? } — staff d'équipe uniquement
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
      return NextResponse.json({ error: 'Exercice introuvable.' }, { status: 404 });
    }
    const data = snap.data()!;
    if (data.structureId !== structureId) {
      return NextResponse.json({ error: 'Exercice hors de cette structure.' }, { status: 400 });
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
      const type: TodoType = (typeof data.type === 'string' && (TODO_TYPES_ALL as readonly string[]).includes(data.type))
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
        // (le staff peut forcer la clôture sans réponse — utile pour annuler un exercice abandonné)
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

    // Garde verrouillage : si l'exo est lockedAt set, plus aucune modif de step
    // (l'assignee a explicitement validé tout l'exo via 'lock'). Le staff peut
    // forcer la réouverture via 'unlock' avant de re-toggler.
    const isLocked = typeof data.lockedAt === 'number' && data.lockedAt > 0;

    // ── v3 : toggle d'un step individuel ────────────────────────────────────
    // L'assignee ou un staff peut cocher/décocher un step. Si needsResponse,
    // une réponse valide est requise pour passer le step à completed.
    // L'API recalcule le `done` top-level (= tous steps completed).
    if (action === 'toggleStep') {
      if (!isAssignee && !isStaff) {
        return NextResponse.json({ error: 'Permissions insuffisantes.' }, { status: 403 });
      }
      if (isLocked) {
        return NextResponse.json({ error: 'Exercice verrouillé. Demande au staff de le déverrouiller.' }, { status: 403 });
      }
      const stepId = typeof body?.stepId === 'string' ? body.stepId.trim() : '';
      if (!stepId) {
        return NextResponse.json({ error: 'stepId manquant.' }, { status: 400 });
      }
      const willBeCompleted = body?.completed === true;

      // Lecture défensive : si pas de steps[] en base, on wrap le doc en 1 step legacy.
      // Permet d'attaquer ce endpoint sur les anciens exos sans migration préalable.
      const currentSteps: ExerciseStep[] = getSteps(data);
      const idx = currentSteps.findIndex(s => s.id === stepId);
      if (idx === -1) {
        return NextResponse.json({ error: 'Step introuvable dans cet exercice.' }, { status: 404 });
      }

      const targetStep = currentSteps[idx];
      const needsResp = TODO_TYPE_META[targetStep.type].needsResponse;

      // Validation réponse si on coche un step needsResponse
      // (le staff peut forcer la clôture sans réponse — utile pour annulation)
      let nextResponse: Record<string, unknown> | null = targetStep.response ?? null;
      if (willBeCompleted && needsResp) {
        const requireResp = isAssignee && !isStaff;
        if (requireResp || body?.response !== undefined) {
          const resp = validateStepResponse(targetStep.type, body?.response);
          if (!resp.ok) {
            return NextResponse.json({ error: resp.error }, { status: 400 });
          }
          nextResponse = resp.value;
        }
      } else if (!willBeCompleted) {
        // Décocher → on garde la réponse (Matt préfère : éditable jusqu'à validation globale)
      }

      // Recompose le tableau steps avec le step modifié
      const nowMs = Date.now();
      const nextSteps: ExerciseStep[] = currentSteps.map((s, i) => {
        if (i !== idx) return s;
        return {
          ...s,
          response: nextResponse,
          completed: willBeCompleted,
          completedAt: willBeCompleted ? nowMs : null,
          completedBy: willBeCompleted ? uid : null,
        };
      });

      // Recalcule done global = tous les steps completed
      const allDone = nextSteps.every(s => s.completed === true);
      const updates: Record<string, unknown> = {
        steps: nextSteps,
        done: allDone,
        doneAt: allDone ? FieldValue.serverTimestamp() : null,
        doneBy: allDone ? uid : null,
        updatedAt: FieldValue.serverTimestamp(),
      };

      await ref.update(updates);
      return NextResponse.json({ success: true, completed: willBeCompleted, allDone });
    }

    // ── v3 : éditer la réponse d'un step déjà coché ─────────────────────────
    // Permet à l'assignee de modifier son texte sans changer l'état completed
    // (cohérent avec la décision : "réponse éditable jusqu'à validation globale").
    if (action === 'editStepResponse') {
      if (!isAssignee && !isStaff) {
        return NextResponse.json({ error: 'Permissions insuffisantes.' }, { status: 403 });
      }
      if (isLocked) {
        return NextResponse.json({ error: 'Exercice verrouillé. Demande au staff de le déverrouiller.' }, { status: 403 });
      }
      const stepId = typeof body?.stepId === 'string' ? body.stepId.trim() : '';
      if (!stepId) {
        return NextResponse.json({ error: 'stepId manquant.' }, { status: 400 });
      }

      const currentSteps: ExerciseStep[] = getSteps(data);
      const idx = currentSteps.findIndex(s => s.id === stepId);
      if (idx === -1) {
        return NextResponse.json({ error: 'Step introuvable dans cet exercice.' }, { status: 404 });
      }
      const targetStep = currentSteps[idx];
      if (!TODO_TYPE_META[targetStep.type].needsResponse) {
        return NextResponse.json({ error: 'Ce type de step n\'attend pas de réponse.' }, { status: 400 });
      }

      const resp = validateStepResponse(targetStep.type, body?.response);
      if (!resp.ok) {
        return NextResponse.json({ error: resp.error }, { status: 400 });
      }

      const nextSteps: ExerciseStep[] = currentSteps.map((s, i) =>
        i === idx ? { ...s, response: resp.value } : s
      );

      await ref.update({
        steps: nextSteps,
        updatedAt: FieldValue.serverTimestamp(),
      });
      return NextResponse.json({ success: true });
    }

    // ── v3 : verrouillage de l'exercice (validation globale) ────────────────
    // L'assignee ou un staff peut verrouiller, MAIS uniquement si tous les
    // steps sont déjà completed. Une fois locked, plus aucune modif n'est
    // possible (toggleStep/editStepResponse rejettent), sauf si un staff fait
    // 'unlock' pour réautoriser la modification.
    if (action === 'lock') {
      if (!isAssignee && !isStaff) {
        return NextResponse.json({ error: 'Permissions insuffisantes.' }, { status: 403 });
      }
      if (isLocked) {
        // idempotent : déjà verrouillé, pas d'erreur
        return NextResponse.json({ success: true, alreadyLocked: true });
      }
      const currentSteps: ExerciseStep[] = getSteps(data);
      const allDone = currentSteps.length > 0 && currentSteps.every(s => s.completed === true);
      if (!allDone) {
        return NextResponse.json({
          error: 'Toutes les étapes doivent être validées avant de verrouiller.',
        }, { status: 400 });
      }
      await ref.update({
        lockedAt: FieldValue.serverTimestamp(),
        lockedBy: uid,
        updatedAt: FieldValue.serverTimestamp(),
      });
      return NextResponse.json({ success: true });
    }

    // ── v3 : déverrouillage (staff uniquement) ──────────────────────────────
    // Permet de réautoriser la modification d'un exo déjà verrouillé. Action
    // réservée au staff pour éviter qu'un joueur unlock après s'être trompé.
    if (action === 'unlock') {
      if (!isStaff) {
        return NextResponse.json({ error: 'Seul le staff peut déverrouiller un exercice.' }, { status: 403 });
      }
      if (!isLocked) {
        return NextResponse.json({ success: true, alreadyUnlocked: true });
      }
      await ref.update({
        lockedAt: null,
        lockedBy: null,
        updatedAt: FieldValue.serverTimestamp(),
      });
      return NextResponse.json({ success: true });
    }

    if (action === 'edit') {
      if (!isStaff) {
        return NextResponse.json({ error: 'Seul le staff peut éditer ce exercice.' }, { status: 403 });
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
      const newType: TodoType | undefined = (typeof body.type === 'string' && (TODO_TYPES_ALL as readonly string[]).includes(body.type))
        ? (body.type as TodoType)
        : undefined;
      const currentType: TodoType = (typeof data.type === 'string' && (TODO_TYPES_ALL as readonly string[]).includes(data.type))
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
      return NextResponse.json({ error: 'Exercice introuvable.' }, { status: 404 });
    }
    const data = snap.data()!;
    if (data.structureId !== structureId) {
      return NextResponse.json({ error: 'Exercice hors de cette structure.' }, { status: 400 });
    }

    if (!isStaffOfTeam(resolved.context, data.subTeamId as string)) {
      return NextResponse.json({ error: 'Seul le staff peut supprimer ce exercice.' }, { status: 403 });
    }

    await ref.delete();
    return NextResponse.json({ success: true });
  } catch (err) {
    captureApiError('API Structures/todos DELETE error', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
