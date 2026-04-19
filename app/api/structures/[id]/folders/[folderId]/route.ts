import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb, verifyAuth } from '@/lib/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { captureApiError } from '@/lib/sentry';
import { limiters, rateLimitKey, checkRateLimit } from '@/lib/rate-limit';
import { resolveUserContext } from '@/lib/event-context';
import { canAccessDocuments } from '@/lib/document-permissions';
import { writeAuditLog } from '@/lib/audit-log';

function normalizeFolderName(name: string): string {
  const cleaned = name.replace(/[\/\\]/g, '-').trim();
  return cleaned.slice(0, 80);
}

// Garde-fou anti-cycle : vérifie que `candidateParentId` n'est pas un descendant de `folderId`.
async function wouldCreateCycle(
  db: FirebaseFirestore.Firestore,
  structureId: string,
  folderId: string,
  candidateParentId: string | null
): Promise<boolean> {
  if (!candidateParentId) return false;
  if (candidateParentId === folderId) return true;
  // Remonte la chaîne des parents depuis candidateParentId
  let current: string | null = candidateParentId;
  const seen = new Set<string>();
  while (current) {
    if (current === folderId) return true;
    if (seen.has(current)) return true;      // cycle existant — paranoïa
    seen.add(current);
    const snap = await db.collection('structure_folders').doc(current).get();
    if (!snap.exists || snap.data()?.structureId !== structureId) return false;
    current = (snap.data()?.parentId as string | null) ?? null;
  }
  return false;
}

// PATCH /api/structures/[id]/folders/[folderId]
// Renomme ou déplace un dossier.
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; folderId: string }> }
) {
  try {
    const uid = await verifyAuth(req);
    if (!uid) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

    const blocked = await checkRateLimit(limiters.write, rateLimitKey(req, uid));
    if (blocked) return blocked;

    const { id: structureId, folderId } = await params;
    const body = await req.json().catch(() => ({}));

    const db = getAdminDb();
    const resolved = await resolveUserContext(db, uid, structureId);
    if (!resolved) return NextResponse.json({ error: 'Structure introuvable' }, { status: 404 });
    if (!canAccessDocuments(resolved.context)) {
      return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });
    }

    const ref = db.collection('structure_folders').doc(folderId);
    const snap = await ref.get();
    if (!snap.exists) return NextResponse.json({ error: 'Dossier introuvable' }, { status: 404 });
    const current = snap.data()!;
    if (current.structureId !== structureId) {
      return NextResponse.json({ error: 'Dossier hors structure' }, { status: 403 });
    }

    const update: Record<string, unknown> = { updatedAt: FieldValue.serverTimestamp() };
    let newName: string | undefined;
    let newParentId: string | null | undefined;

    if (typeof body.name === 'string') {
      const n = normalizeFolderName(body.name);
      if (!n) return NextResponse.json({ error: 'Nom invalide' }, { status: 400 });
      newName = n;
      update.name = n;
    }

    if ('parentId' in body) {
      const raw = body.parentId;
      newParentId = typeof raw === 'string' && raw ? raw : null;
      if (newParentId) {
        const parentSnap = await db.collection('structure_folders').doc(newParentId).get();
        if (!parentSnap.exists || parentSnap.data()?.structureId !== structureId) {
          return NextResponse.json({ error: 'Dossier parent introuvable' }, { status: 404 });
        }
        if (await wouldCreateCycle(db, structureId, folderId, newParentId)) {
          return NextResponse.json({ error: 'Déplacement impossible (cycle détecté)' }, { status: 400 });
        }
      }
      update.parentId = newParentId;
    }

    // Anti-doublon de nom dans le parent cible
    const effectiveName = newName ?? (current.name as string);
    const effectiveParent = newParentId !== undefined ? newParentId : (current.parentId as string | null);
    const dupSnap = await db.collection('structure_folders')
      .where('structureId', '==', structureId)
      .where('parentId', '==', effectiveParent)
      .get();
    const duplicate = dupSnap.docs.some(d => {
      if (d.id === folderId) return false;
      return ((d.data().name as string) || '').toLowerCase() === effectiveName.toLowerCase();
    });
    if (duplicate) {
      return NextResponse.json({ error: 'Un dossier de ce nom existe déjà ici' }, { status: 409 });
    }

    await ref.update(update);

    await writeAuditLog(db, {
      structureId,
      action: 'folder_updated',
      actorUid: uid,
      targetId: folderId,
      metadata: {
        ...(newName !== undefined ? { name: newName } : {}),
        ...(newParentId !== undefined ? { parentId: newParentId } : {}),
      },
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    captureApiError('API folders PATCH', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}

// DELETE /api/structures/[id]/folders/[folderId]
// Supprime un dossier — uniquement s'il est vide (pas de sous-dossier, pas de document).
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; folderId: string }> }
) {
  try {
    const uid = await verifyAuth(req);
    if (!uid) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

    const blocked = await checkRateLimit(limiters.write, rateLimitKey(req, uid));
    if (blocked) return blocked;

    const { id: structureId, folderId } = await params;
    const db = getAdminDb();
    const resolved = await resolveUserContext(db, uid, structureId);
    if (!resolved) return NextResponse.json({ error: 'Structure introuvable' }, { status: 404 });
    if (!canAccessDocuments(resolved.context)) {
      return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });
    }

    const ref = db.collection('structure_folders').doc(folderId);
    const snap = await ref.get();
    if (!snap.exists) return NextResponse.json({ error: 'Dossier introuvable' }, { status: 404 });
    const current = snap.data()!;
    if (current.structureId !== structureId) {
      return NextResponse.json({ error: 'Dossier hors structure' }, { status: 403 });
    }

    // Vérifie que le dossier est vide
    const [childFolders, childDocs] = await Promise.all([
      db.collection('structure_folders').where('structureId', '==', structureId).where('parentId', '==', folderId).limit(1).get(),
      db.collection('structure_documents').where('structureId', '==', structureId).where('folderId', '==', folderId).limit(1).get(),
    ]);
    if (!childFolders.empty || !childDocs.empty) {
      return NextResponse.json({ error: 'Le dossier doit être vide avant d\'être supprimé' }, { status: 409 });
    }

    await ref.delete();

    await writeAuditLog(db, {
      structureId,
      action: 'folder_deleted',
      actorUid: uid,
      targetId: folderId,
      metadata: { name: current.name },
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    captureApiError('API folders DELETE', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
