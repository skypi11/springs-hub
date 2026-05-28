import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb, verifyAuth } from '@/lib/firebase-admin';
import { captureApiError } from '@/lib/sentry';
import { limiters, rateLimitKey, checkRateLimit } from '@/lib/rate-limit';
import { writeAuditLog } from '@/lib/audit-log';
import {
  StorageKeys,
  UploadLimits,
  isAllowedMime,
  uploadBuffer,
  getPublicUrl,
} from '@/lib/storage';
import { processSquareImage, probeImage } from '@/lib/image-processing';

export const runtime = 'nodejs';
export const maxDuration = 30;

// POST /api/upload/team-logo, upload du logo d'une sous-équipe (collection sub_teams).
// Auth : dirigeant/responsable de la structure, OU manager de cette équipe précise.
// Body : multipart/form-data avec champs `structureId`, `teamId`, `file`.
// Retour : { url }, URL publique du logo (clé R2 versionnée, cache immutable).
//
// La persistance du champ `logoUrl` ET la suppression de l'ancien fichier R2 sont
// gérées par l'action `update` de /api/structures/teams, déclenchée juste après
// côté client via handleUpdateTeamLogo. Cette route ne fait que l'upload R2.
export async function POST(req: NextRequest) {
  try {
    const uid = await verifyAuth(req);
    if (!uid) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

    const blocked = await checkRateLimit(limiters.write, rateLimitKey(req, uid));
    if (blocked) return blocked;

    const form = await req.formData();
    const structureId = String(form.get('structureId') ?? '').trim();
    const teamId = String(form.get('teamId') ?? '').trim();
    const file = form.get('file');

    if (!structureId || !teamId) {
      return NextResponse.json({ error: 'structureId et teamId requis' }, { status: 400 });
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

    // Validation taille, même limite que les logos de structure (2 MB)
    if (file.size > UploadLimits.STRUCTURE_LOGO_BYTES) {
      const mb = Math.round(UploadLimits.STRUCTURE_LOGO_BYTES / (1024 * 1024));
      return NextResponse.json({ error: `Fichier trop lourd, max ${mb} MB` }, { status: 413 });
    }

    const db = getAdminDb();

    // Structure : doit exister et ne pas être suspendue
    const structSnap = await db.collection('structures').doc(structureId).get();
    if (!structSnap.exists) {
      return NextResponse.json({ error: 'Structure introuvable' }, { status: 404 });
    }
    const structData = structSnap.data()!;
    if (structData.status === 'suspended') {
      return NextResponse.json({ error: 'Structure suspendue' }, { status: 403 });
    }

    // Équipe : doit exister et appartenir à la structure
    const teamSnap = await db.collection('sub_teams').doc(teamId).get();
    if (!teamSnap.exists) {
      return NextResponse.json({ error: 'Équipe introuvable' }, { status: 404 });
    }
    const teamData = teamSnap.data()!;
    if (teamData.structureId !== structureId) {
      return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });
    }

    // Auth métier : dirigeant/responsable structure OU manager de cette équipe.
    // Mêmes droits que l'action `update` de /api/structures/teams.
    const isFounder = structData.founderId === uid;
    const isCoFounder = (structData.coFounderIds ?? []).includes(uid);
    const isManager = (structData.managerIds ?? []).includes(uid);
    const isAdminOfStructure = isFounder || isCoFounder || isManager;
    const staffIds = (teamData.staffIds ?? []) as string[];
    const staffRoles = (teamData.staffRoles ?? {}) as Record<string, string>;
    const isTeamManager = staffIds.includes(uid) && staffRoles[uid] === 'manager';
    if (!isAdminOfStructure && !isTeamManager) {
      return NextResponse.json({ error: 'Accès refusé à cette équipe' }, { status: 403 });
    }

    // Lecture du buffer + probe (anti-upload non-image déguisé)
    const inputBuf = Buffer.from(await file.arrayBuffer());
    const probe = await probeImage(inputBuf);
    if (!probe) {
      return NextResponse.json({ error: 'Fichier image invalide' }, { status: 400 });
    }

    // Traitement sharp : carré 512×512 + conversion webp
    const processedBuf = await processSquareImage(inputBuf, 512);

    // Clé versionnée (timestamp), chaque upload change l'URL, contourne le cache CDN
    const version = Date.now();
    const key = StorageKeys.teamLogo(structureId, teamId, version);
    await uploadBuffer(key, processedBuf, 'image/webp');
    const url = getPublicUrl(key);

    // Audit log (la persistance logoUrl est faite par l'action update de /teams)
    await writeAuditLog(db, {
      structureId,
      action: 'structure_updated',
      actorUid: uid,
      targetId: teamId,
      metadata: { field: 'team_logo', teamId, via: 'upload' },
    });

    return NextResponse.json({ url });
  } catch (err) {
    captureApiError('API upload/team-logo POST error', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
