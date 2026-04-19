import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb, verifyAuth } from '@/lib/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { captureApiError } from '@/lib/sentry';
import { limiters, rateLimitKey, checkRateLimit } from '@/lib/rate-limit';
import { writeAuditLog } from '@/lib/audit-log';
import {
  StorageKeys,
  UploadLimits,
  isAllowedMime,
  uploadBuffer,
  getPublicUrl,
  extractR2Key,
  deleteFileSilent,
} from '@/lib/storage';
import { processSquareImage, processBanner, probeImage } from '@/lib/image-processing';

export const runtime = 'nodejs';
export const maxDuration = 30;

// POST /api/upload/structure-image — upload logo ou bannière d'une structure.
// Auth : fondateur ou co-fondateur uniquement.
// Body : multipart/form-data avec champs `structureId`, `type` ('logo' | 'banner'), `file`.
// Retour : { url } — URL publique du nouvel asset (clé versionnée, cache immutable).
export async function POST(req: NextRequest) {
  try {
    const uid = await verifyAuth(req);
    if (!uid) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

    const blocked = await checkRateLimit(limiters.write, rateLimitKey(req, uid));
    if (blocked) return blocked;

    const form = await req.formData();
    const structureId = String(form.get('structureId') ?? '').trim();
    const type = String(form.get('type') ?? '').trim();
    const file = form.get('file');

    if (!structureId) {
      return NextResponse.json({ error: 'structureId requis' }, { status: 400 });
    }
    if (type !== 'logo' && type !== 'banner') {
      return NextResponse.json({ error: 'type invalide (logo | banner)' }, { status: 400 });
    }
    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'Fichier manquant' }, { status: 400 });
    }

    // Validation MIME (avant de charger le buffer en mémoire)
    if (!isAllowedMime(file.type, 'IMAGES')) {
      return NextResponse.json(
        { error: 'Format non supporté (JPEG, PNG, WebP, GIF uniquement)' },
        { status: 415 }
      );
    }

    // Validation taille selon le type
    const maxBytes = type === 'logo'
      ? UploadLimits.STRUCTURE_LOGO_BYTES
      : UploadLimits.STRUCTURE_BANNER_BYTES;
    if (file.size > maxBytes) {
      const mb = Math.round(maxBytes / (1024 * 1024));
      return NextResponse.json(
        { error: `Fichier trop lourd — max ${mb} MB` },
        { status: 413 }
      );
    }

    const db = getAdminDb();
    const ref = db.collection('structures').doc(structureId);
    const snap = await ref.get();
    if (!snap.exists) {
      return NextResponse.json({ error: 'Structure introuvable' }, { status: 404 });
    }
    const data = snap.data()!;

    // Auth métier : fondateur ou co-fondateur
    const isFounder = data.founderId === uid;
    const isCoFounder = (data.coFounderIds ?? []).includes(uid);
    if (!isFounder && !isCoFounder) {
      return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });
    }
    if (data.status === 'suspended') {
      return NextResponse.json({ error: 'Structure suspendue' }, { status: 403 });
    }

    // Lecture du buffer + probe (anti-upload non-image)
    const arrayBuf = await file.arrayBuffer();
    const inputBuf = Buffer.from(arrayBuf);
    const probe = await probeImage(inputBuf);
    if (!probe) {
      return NextResponse.json({ error: 'Fichier image invalide' }, { status: 400 });
    }

    // Traitement sharp (resize + webp)
    const processedBuf = type === 'logo'
      ? await processSquareImage(inputBuf, 512)
      : await processBanner(inputBuf);

    // Clé versionnée (timestamp) — évite tout souci de cache CDN
    const version = Date.now();
    const key = type === 'logo'
      ? StorageKeys.structureLogo(structureId, version)
      : StorageKeys.structureBanner(structureId, version);

    await uploadBuffer(key, processedBuf, 'image/webp');
    const newUrl = getPublicUrl(key);

    // Supprime l'ancien asset (best-effort) — seulement si c'est une clé R2 à nous
    const oldField = type === 'logo' ? 'logoUrl' : 'coverUrl';
    const oldUrl = (data[oldField] as string | undefined) ?? '';
    const oldKey = extractR2Key(oldUrl);
    if (oldKey && oldKey !== key) {
      await deleteFileSilent(oldKey);
    }

    // Update Firestore
    await ref.update({
      [oldField]: newUrl,
      updatedAt: FieldValue.serverTimestamp(),
    });

    // Audit log (standalone, pas besoin d'atomicité avec le storage)
    await writeAuditLog(db, {
      structureId,
      action: 'structure_updated',
      actorUid: uid,
      metadata: { field: oldField, via: 'upload' },
    });

    return NextResponse.json({ url: newUrl });
  } catch (err) {
    captureApiError('API upload/structure-image POST error', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
