import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth, isAdmin } from '@/lib/firebase-admin';
import { captureApiError } from '@/lib/sentry';
import { limiters, rateLimitKey, checkRateLimit } from '@/lib/rate-limit';
import { StorageKeys, UploadLimits, isAllowedMime, uploadBuffer, getPublicUrl } from '@/lib/storage';
import { processContainedLogo, probeImage } from '@/lib/image-processing';

export const runtime = 'nodejs';
export const maxDuration = 30;

// POST /api/admin/competitions/organizer-logo
// Upload d'un logo d'organisateur de compétition (admin Aedral uniquement).
// Découplé d'un circuit précis : l'upload peut précéder la création du circuit,
// la route ne fait que traiter + uploader et renvoyer l'URL publique. La
// persistance de `organizer.logoUrl` est faite par le save du CircuitForm.
// Body : multipart/form-data avec `file`. Retour : { url }.
//
// Le traitement CONSERVE le ratio et la transparence (processContainedLogo) :
// un logo d'organisateur est souvent un wordmark large qu'un crop carré
// rognerait (piège rencontré avec le logo Springs E-Sport).
export async function POST(req: NextRequest) {
  try {
    const uid = await verifyAuth(req);
    if (!uid) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
    if (!(await isAdmin(uid))) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });

    const blocked = await checkRateLimit(limiters.write, rateLimitKey(req, uid));
    if (blocked) return blocked;

    const form = await req.formData();
    const file = form.get('file');
    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'Fichier manquant' }, { status: 400 });
    }
    if (!isAllowedMime(file.type, 'IMAGES')) {
      return NextResponse.json({ error: 'Format non supporté (JPEG, PNG, WebP, GIF)' }, { status: 415 });
    }
    if (file.size > UploadLimits.STRUCTURE_LOGO_BYTES) {
      const mb = Math.round(UploadLimits.STRUCTURE_LOGO_BYTES / (1024 * 1024));
      return NextResponse.json({ error: `Fichier trop lourd, max ${mb} MB` }, { status: 413 });
    }

    const inputBuf = Buffer.from(await file.arrayBuffer());
    const probe = await probeImage(inputBuf);
    if (!probe) {
      return NextResponse.json({ error: 'Fichier image invalide' }, { status: 400 });
    }

    const processed = await processContainedLogo(inputBuf, 640);
    const version = Date.now();
    const key = StorageKeys.competitionOrganizerLogo(version);
    await uploadBuffer(key, processed, 'image/webp');
    const url = getPublicUrl(key);

    return NextResponse.json({ url });
  } catch (err) {
    captureApiError('API admin/competitions/organizer-logo POST error', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
