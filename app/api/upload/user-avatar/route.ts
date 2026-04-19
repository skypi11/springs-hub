import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb, verifyAuth } from '@/lib/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { captureApiError } from '@/lib/sentry';
import { limiters, rateLimitKey, checkRateLimit } from '@/lib/rate-limit';
import {
  StorageKeys,
  UploadLimits,
  isAllowedMime,
  uploadBuffer,
  getPublicUrl,
  extractR2Key,
  deleteFileSilent,
} from '@/lib/storage';
import { processSquareImage, probeImage } from '@/lib/image-processing';

export const runtime = 'nodejs';
export const maxDuration = 30;

// POST /api/upload/user-avatar — upload d'un avatar utilisateur (remplace l'avatar Discord).
// Auth : tout utilisateur connecté (met à jour son propre profil).
// Body : multipart/form-data avec `file`.
// Retour : { url } — URL publique, clé versionnée.
export async function POST(req: NextRequest) {
  try {
    const uid = await verifyAuth(req);
    if (!uid) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

    const blocked = await checkRateLimit(limiters.write, rateLimitKey(req, uid));
    if (blocked) return blocked;

    const form = await req.formData();
    const file = form.get('file');
    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'Fichier manquant' }, { status: 400 });
    }
    if (!isAllowedMime(file.type, 'IMAGES')) {
      return NextResponse.json(
        { error: 'Format non supporté (JPEG, PNG, WebP, GIF uniquement)' },
        { status: 415 }
      );
    }
    if (file.size > UploadLimits.USER_AVATAR_BYTES) {
      const mb = Math.round(UploadLimits.USER_AVATAR_BYTES / (1024 * 1024));
      return NextResponse.json({ error: `Fichier trop lourd — max ${mb} MB` }, { status: 413 });
    }

    const arrayBuf = await file.arrayBuffer();
    const inputBuf = Buffer.from(arrayBuf);
    const probe = await probeImage(inputBuf);
    if (!probe) {
      return NextResponse.json({ error: 'Fichier image invalide' }, { status: 400 });
    }

    const processedBuf = await processSquareImage(inputBuf, 512);

    const version = Date.now();
    const key = StorageKeys.userAvatar(uid, version);
    await uploadBuffer(key, processedBuf, 'image/webp');
    const newUrl = getPublicUrl(key);

    const db = getAdminDb();
    const ref = db.collection('users').doc(uid);
    const userSnap = await ref.get();
    const oldUrl = (userSnap.data()?.avatarUrl as string | undefined) ?? '';
    const oldKey = extractR2Key(oldUrl);
    if (oldKey && oldKey !== key) {
      await deleteFileSilent(oldKey);
    }

    await ref.update({
      avatarUrl: newUrl,
      updatedAt: FieldValue.serverTimestamp(),
    });

    return NextResponse.json({ url: newUrl });
  } catch (err) {
    captureApiError('API upload/user-avatar POST error', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
