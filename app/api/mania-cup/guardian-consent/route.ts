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
import { encryptBuffer, decryptBuffer, isEncryptionAvailable } from '@/lib/document-crypto';
import {
  MANIA_CUP_REGISTRATIONS,
  GUARDIAN_DOC_KINDS,
  GUARDIAN_DOC_LABELS,
  isGuardianDossierComplete,
  type GuardianDocKind,
  type GuardianDoc,
  type ManiaCupRegistration,
} from '@/lib/mania-cup';

// Dossier des joueurs de 16-17 ans : autorisation parentale signée + pièce
// d'identité du représentant légal.
//
// Pourquoi les deux : une autorisation seule ne prouve rien, n'importe qui peut
// signer « le père de ». C'est la pièce du signataire qui la rend opposable.
// L'identité DU MINEUR, elle, se contrôle à l'accueil sur présentation — pas
// besoin d'en conserver une copie.
//
// Les fichiers sont chiffrés (AES-256-GCM) avant d'atteindre R2, ne sont jamais
// servis par URL publique, et sont purgés après l'événement (cron).
//
// POST — le joueur dépose une pièce (multipart : `file` + `kind`)
// GET  — un admin relit une pièce (?uid=…&kind=…)

/** 10 Mo : un scan ou une photo, pas une archive. */
const MAX_BYTES = 10 * 1024 * 1024;

function parseKind(raw: unknown): GuardianDocKind | null {
  return typeof raw === 'string' && (GUARDIAN_DOC_KINDS as readonly string[]).includes(raw)
    ? (raw as GuardianDocKind)
    : null;
}

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
    if (!snap.exists) return NextResponse.json({ error: 'Inscris-toi d’abord.' }, { status: 404 });

    const reg = snap.data() as ManiaCupRegistration;
    if (reg.guardianConsent === 'not_required') {
      return NextResponse.json(
        { error: 'Aucune pièce n’est requise pour toi.' },
        { status: 409 }
      );
    }
    if (reg.guardianConsent === 'approved') {
      return NextResponse.json({ error: 'Ton dossier a déjà été validé.' }, { status: 409 });
    }

    const form = await req.formData();
    const kind = parseKind(form.get('kind'));
    if (!kind) return NextResponse.json({ error: 'Type de pièce inconnu.' }, { status: 400 });

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

    const version = Date.now();
    const ext = extensionForStorage(file.name || 'document', file.type || '');
    const key = StorageKeys.maniaCupGuardianConsent(`${uid}-${kind}`, version, ext);

    const plain = Buffer.from(await file.arrayBuffer());
    await uploadBuffer(key, encryptBuffer(plain), 'application/octet-stream', 'private, no-store');

    const doc: GuardianDoc = {
      key,
      name: file.name || GUARDIAN_DOC_LABELS[kind],
      mime: file.type || 'application/octet-stream',
      uploadedAt: FieldValue.serverTimestamp(),
    };
    const docs = { ...(reg.guardianDocs ?? {}), [kind]: doc };

    // Le dossier ne part en relecture qu'une fois les DEUX pièces déposées :
    // relire une autorisation sans la pièce du signataire ne sert à rien.
    const complete = isGuardianDossierComplete(docs);

    await docRef.set(
      {
        guardianDocs: docs,
        guardianConsent: complete ? 'pending_review' : 'missing',
        guardianRejectionReason: null,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    return NextResponse.json({ ok: true, complete });
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
    const kind = parseKind(req.nextUrl.searchParams.get('kind'));
    if (!target || !kind) {
      return NextResponse.json({ error: 'Paramètres manquants' }, { status: 400 });
    }

    const db = getAdminDb();
    const snap = await db.collection(MANIA_CUP_REGISTRATIONS).doc(target).get();
    const reg = snap.data() as ManiaCupRegistration | undefined;
    const doc = reg?.guardianDocs?.[kind];
    if (!doc?.key) return NextResponse.json({ error: 'Pièce non déposée' }, { status: 404 });

    const clear = decryptBuffer(await downloadBuffer(doc.key));

    // Consulter une pièce d'identité est une action tracée : on doit pouvoir
    // dire qui a ouvert quel dossier, et quand.
    await writeAdminAuditLog(db, {
      action: 'mania_cup_guardian_consent_read',
      adminUid: uid,
      targetType: 'user',
      targetId: target,
      targetLabel: reg?.tmDisplayName ?? null,
      metadata: { kind },
    });

    return new NextResponse(new Uint8Array(clear), {
      headers: {
        'Content-Type': doc.mime || 'application/octet-stream',
        'Content-Disposition': `inline; filename="${encodeURIComponent(doc.name || kind)}"`,
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (err) {
    captureApiError('mania-cup/guardian-consent:GET', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
