import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb, verifyAuth } from '@/lib/firebase-admin';
import { captureApiError } from '@/lib/sentry';
import { limiters, rateLimitKey, checkRateLimit } from '@/lib/rate-limit';
import { resolveUserContext } from '@/lib/event-context';
import { isStaffOfTeam } from '@/lib/event-permissions';
import { uploadBuffer, getPublicUrl, StorageKeys, deleteFileSilent, extractR2Key, isAllowedMime } from '@/lib/storage';
import { processScreenshot, probeImage } from '@/lib/image-processing';

// Max payload pour une capture d'écran. Au-dessus, on rejette côté serveur
// (l'UI compresse déjà côté client mais on garde une borne dure).
const MAX_SCREENSHOT_BYTES = 5 * 1024 * 1024; // 5 MB en entrée (sera compressé à ~200-500 KB)

export const maxDuration = 30;

// POST /api/structures/[id]/todos/[todoId]/screenshot
// FormData : { file: File, stepId: string }
//
// L'assignee ou un staff de l'équipe peut uploader une capture pour un step.
// Le serveur compresse via sharp (max 1920px, webp q82) et stocke sur R2.
// Renvoie l'URL publique à inclure dans `step.response.attachmentUrl`.
//
// Note : on N'UPDATE PAS Firestore ici — le client appelle ensuite toggleStep
// avec attachmentUrl dans la response. Ça évite les states intermédiaires
// (screenshot uploadé mais step pas validé). Si l'user upload puis annule,
// le fichier R2 reste orphelin (acceptable, peu fréquent).
export async function POST(
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

    const isStaff = isStaffOfTeam(resolved.context, data.subTeamId as string);
    const isAssignee = data.assigneeId === uid;
    if (!isAssignee && !isStaff) {
      return NextResponse.json({ error: 'Permissions insuffisantes.' }, { status: 403 });
    }

    const formData = await req.formData();
    const file = formData.get('file');
    const stepId = formData.get('stepId');

    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'Fichier manquant.' }, { status: 400 });
    }
    if (typeof stepId !== 'string' || !stepId.trim()) {
      return NextResponse.json({ error: 'stepId manquant.' }, { status: 400 });
    }

    if (file.size > MAX_SCREENSHOT_BYTES) {
      return NextResponse.json({
        error: `Image trop lourde (${Math.round(file.size / 1024 / 1024 * 10) / 10} MB, max ${MAX_SCREENSHOT_BYTES / 1024 / 1024} MB).`,
      }, { status: 400 });
    }
    if (file.type && !isAllowedMime(file.type, 'IMAGES')) {
      return NextResponse.json({
        error: 'Format non supporté — utilise JPG, PNG, WebP ou GIF.',
      }, { status: 400 });
    }

    const input = Buffer.from(await file.arrayBuffer());
    const probe = await probeImage(input);
    if (!probe) {
      return NextResponse.json({ error: 'Fichier image invalide ou corrompu.' }, { status: 400 });
    }

    // Compression sharp → webp ~200-500 KB
    const processed = await processScreenshot(input);

    // Stockage R2 avec version timestamp (cache-bust + permet plusieurs uploads par step)
    const version = Date.now();
    const key = StorageKeys.todoStepScreenshot(structureId, todoId, stepId.trim(), version);
    await uploadBuffer(key, processed, 'image/webp', 'public, max-age=31536000, immutable');

    // Suppression de l'ancienne capture (si présente dans la step.response actuelle).
    // Lecture défensive : on lit les steps du doc et on cherche stepId.
    try {
      const steps = Array.isArray(data.steps) ? data.steps as Array<Record<string, unknown>> : [];
      const target = steps.find(s => (s as { id?: string }).id === stepId);
      const oldUrl = target && typeof (target as { response?: Record<string, unknown> }).response === 'object'
        ? ((target as { response: { attachmentUrl?: unknown } }).response.attachmentUrl as string | undefined)
        : undefined;
      const oldKey = extractR2Key(oldUrl);
      if (oldKey && oldKey !== key) {
        await deleteFileSilent(oldKey);
      }
    } catch {
      // best-effort — l'orphelin reste mais ne casse pas l'upload
    }

    return NextResponse.json({
      attachmentUrl: getPublicUrl(key),
      sizeBytes: processed.length,
    });
  } catch (err) {
    captureApiError('API Structures/todos screenshot POST error', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
