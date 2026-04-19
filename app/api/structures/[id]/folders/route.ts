import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb, verifyAuth } from '@/lib/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { captureApiError } from '@/lib/sentry';
import { limiters, rateLimitKey, checkRateLimit } from '@/lib/rate-limit';
import { resolveUserContext } from '@/lib/event-context';
import { canAccessDocuments } from '@/lib/document-permissions';
import { writeAuditLog } from '@/lib/audit-log';

function ts(v: unknown): string | null {
  if (!v) return null;
  if (typeof v === 'object' && v !== null && 'toDate' in v && typeof (v as { toDate: unknown }).toDate === 'function') {
    return (v as { toDate: () => Date }).toDate().toISOString();
  }
  return null;
}

// Nettoie et contraint un nom de dossier (pas de barres obliques, pas d'espaces initiaux)
function normalizeFolderName(name: string): string {
  const cleaned = name.replace(/[\/\\]/g, '-').trim();
  return cleaned.slice(0, 80);
}

// GET /api/structures/[id]/folders
// Liste tous les dossiers de la structure (flat — le front construit l'arborescence).
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
    if (!resolved) return NextResponse.json({ error: 'Structure introuvable' }, { status: 404 });
    if (!canAccessDocuments(resolved.context)) {
      return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });
    }

    const snap = await db.collection('structure_folders')
      .where('structureId', '==', structureId)
      .get();

    const folders = snap.docs.map(d => {
      const data = d.data();
      return {
        id: d.id,
        ...data,
        createdAt: ts(data.createdAt),
        updatedAt: ts(data.updatedAt),
      } as Record<string, unknown>;
    });

    folders.sort((a, b) => String(a.name ?? '').localeCompare(String(b.name ?? ''), 'fr', { sensitivity: 'base' }));

    return NextResponse.json({ folders });
  } catch (err) {
    captureApiError('API folders GET', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}

// POST /api/structures/[id]/folders
// Crée un nouveau dossier sous parentId (null = racine).
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
    const body = await req.json().catch(() => ({}));
    const parentId: string | null = typeof body.parentId === 'string' && body.parentId ? body.parentId : null;
    const rawName = typeof body.name === 'string' ? body.name : '';
    const name = normalizeFolderName(rawName);
    if (!name) return NextResponse.json({ error: 'Nom de dossier requis' }, { status: 400 });

    const db = getAdminDb();
    const resolved = await resolveUserContext(db, uid, structureId);
    if (!resolved) return NextResponse.json({ error: 'Structure introuvable' }, { status: 404 });
    if (!canAccessDocuments(resolved.context)) {
      return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });
    }

    // Vérifie que le parent existe bien dans cette structure (si fourni)
    if (parentId) {
      const parentSnap = await db.collection('structure_folders').doc(parentId).get();
      if (!parentSnap.exists || parentSnap.data()?.structureId !== structureId) {
        return NextResponse.json({ error: 'Dossier parent introuvable' }, { status: 404 });
      }
    }

    // Anti-doublon : pas deux dossiers de même nom dans le même parent
    const dupSnap = await db.collection('structure_folders')
      .where('structureId', '==', structureId)
      .where('parentId', '==', parentId)
      .get();
    const exists = dupSnap.docs.some(d => {
      const n = (d.data().name as string) || '';
      return n.toLowerCase() === name.toLowerCase();
    });
    if (exists) {
      return NextResponse.json({ error: 'Un dossier de ce nom existe déjà ici' }, { status: 409 });
    }

    const ref = db.collection('structure_folders').doc();
    await ref.set({
      structureId,
      parentId,
      name,
      createdBy: uid,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    await writeAuditLog(db, {
      structureId,
      action: 'folder_created',
      actorUid: uid,
      targetId: ref.id,
      metadata: { name, parentId },
    });

    return NextResponse.json({ id: ref.id, name, parentId });
  } catch (err) {
    captureApiError('API folders POST', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
