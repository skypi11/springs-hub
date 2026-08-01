import { NextRequest, NextResponse } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { getAdminDb, verifyAuth, isCompetitionAdmin } from '@/lib/firebase-admin';
import { limiters, rateLimitKey, checkRateLimit } from '@/lib/rate-limit';
import { captureApiError } from '@/lib/sentry';
import { writeAdminAuditLog } from '@/lib/admin-audit-log';
import {
  uploadBuffer,
  downloadBuffer,
  isAllowedMime,
  extensionForStorage,
  StorageKeys,
} from '@/lib/storage';
import {
  encryptBuffer,
  decryptBuffer,
  isEncryptionAvailable,
} from '@/lib/document-crypto';
import {
  MANIA_CUP_REGISTRATIONS,
  type ManiaCupRegistration,
} from '@/lib/mania-cup';

// Autorisation parentale des joueurs de 16-17 ans.
//
// C'est une pièce d'identité familiale, souvent accompagnée d'une copie de
// papiers : elle est CHIFFRÉE (AES-256-GCM) avant d'atteindre R2 et n'est
// jamais exposée par URL publique. Elle ne se relit qu'à travers cette route,
// réservée aux administrateurs, qui la déchiffre à la volée.
//
// POST — le joueur dépose son document (multipart/form-data, champ `file`)
// GET  — un admin relit le document d'un joueur (?uid=…)

/** 10 Mo : une autorisation signée est un PDF ou une photo, pas une archive. */
const MAX_BYTES = 10 * 1024 * 1024;

export async function POST(req: NextRequest) {
  try {
    const uid = await verifyAuth(req);
    if (!uid) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

    const blocked = await checkRateLimit(limiters.write, rateLimitKey(req, uid));
    if (blocked) return blocked;

    if (!isEncryptionAvailable()) {
      return NextResponse.json(
        { error: 'Le dépôt de documents n’est pas configuré. Préviens l’organisation.' },
        { status: 503 }
      );
    }

    const db = getAdminDb();
    const docRef = db.collection(MANIA_CUP_REGISTRATIONS).doc(uid);
    const snap = await docRef.get();
    if (!snap.exists) {
      return NextResponse.json({ error: 'Inscris-toi d’abord.' }, { status: 404 });
    }

    const reg = snap.data() as ManiaCupRegistration;
    if (reg.guardianConsent === 'not_required') {
      return NextResponse.json(
        { error: 'Aucune autorisation parentale n’est requise pour toi.' },
        { status: 409 }
      );
    }
    if (reg.guardianConsent === 'approved') {
      return NextResponse.json(
        { error: 'Ton autorisation a déjà été validée.' },
        { status: 409 }
      );
    }

    const form = await req.formData();
    const file = form.get('file');
    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'Aucun fichier reçu.' }, { status: 400 });
    }
    if (file.size === 0) {
      return NextResponse.json({ error: 'Le fichier est vide.' }, { status: 400 });
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json(
        { error: 'Le fichier dépasse 10 Mo. Réduis la qualité du scan ou de la photo.' },
        { status: 413 }
      );
    }
    if (!isAllowedMime(file.type || 'application/octet-stream', 'DOCUMENTS')) {
      return NextResponse.json(
        { error: 'Format non accepté. Dépose un PDF ou une photo.' },
        { status: 415 }
      );
    }

    // Version incrémentale : un document refusé peut être redéposé sans écraser
    // la trace du précédent côté stockage.
    const version = Date.now();
    const ext = extensionForStorage(file.name || 'document', file.type || '');
    const key = StorageKeys.maniaCupGuardianConsent(uid, version, ext);

    const plain = Buffer.from(await file.arrayBuffer());
    await uploadBuffer(key, encryptBuffer(plain), 'application/octet-stream', 'private, no-store');

    await docRef.set(
      {
        guardianConsent: 'pending_review',
        guardianDocKey: key,
        guardianDocName: file.name || 'autorisation',
        guardianDocMime: file.type || 'application/octet-stream',
        guardianRejectionReason: null,
        guardianUploadedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    return NextResponse.json({ ok: true, status: 'pending_review' });
  } catch (err) {
    captureApiError('mania-cup/guardian-consent:POST', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}

// ── GET : relecture par un administrateur ────────────────────────────────────

export async function GET(req: NextRequest) {
  try {
    const uid = await verifyAuth(req);
    if (!uid || !(await isCompetitionAdmin(uid))) {
      return NextResponse.json({ error: 'Réservé aux administrateurs' }, { status: 403 });
    }

    const target = req.nextUrl.searchParams.get('uid');
    if (!target) return NextResponse.json({ error: 'uid manquant' }, { status: 400 });

    const db = getAdminDb();
    const snap = await db.collection(MANIA_CUP_REGISTRATIONS).doc(target).get();
    const reg = snap.data() as ManiaCupRegistration | undefined;
    if (!reg?.guardianDocKey) {
      return NextResponse.json({ error: 'Aucun document déposé' }, { status: 404 });
    }

    const clear = decryptBuffer(await downloadBuffer(reg.guardianDocKey));

    // Consulter une pièce d'identité familiale est une action tracée : on doit
    // pouvoir dire QUI a ouvert QUEL dossier, et quand.
    await writeAdminAuditLog(db, {
      action: 'mania_cup_guardian_consent_read',
      adminUid: uid,
      targetType: 'user',
      targetId: target,
      targetLabel: reg.tmDisplayName ?? null,
    });

    return new NextResponse(new Uint8Array(clear), {
      headers: {
        'Content-Type': reg.guardianDocMime || 'application/octet-stream',
        'Content-Disposition': `inline; filename="${encodeURIComponent(
          reg.guardianDocName || 'autorisation'
        )}"`,
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (err) {
    captureApiError('mania-cup/guardian-consent:GET', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
