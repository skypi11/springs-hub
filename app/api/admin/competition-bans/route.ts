import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb, verifyAuth, isCompetitionAdmin } from '@/lib/firebase-admin';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { captureApiError } from '@/lib/sentry';
import { limiters, rateLimitKey, checkRateLimit } from '@/lib/rate-limit';
import { writeAdminAuditLog } from '@/lib/admin-audit-log';
import { clampString } from '@/lib/validation';
import { serializeBan } from '@/lib/competitions/bans';

// Registre des bans de compétition (spec Legends §5-6) : géré par les admins
// de compétition (rôle scopé — c'est DANS leur périmètre, contrairement à la
// config des compétitions). Jamais de delete : révocation horodatée.

// GET /api/admin/competition-bans — liste complète
// GET /api/admin/competition-bans?search=xxx — recherche de cibles (users +
// structures) pour le formulaire d'ajout. Endpoint dédié : les admins compét
// n'ont PAS accès à /api/admin/users (spec §6, aucun accès au reste de
// l'admin) et n'ont besoin ici que du strict minimum (pseudo + uid).
export async function GET(req: NextRequest) {
  try {
    const uid = await verifyAuth(req);
    if (!uid) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
    if (!(await isCompetitionAdmin(uid))) {
      return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });
    }

    const db = getAdminDb();
    const search = req.nextUrl.searchParams.get('search')?.trim().toLowerCase() || '';

    if (search) {
      if (search.length < 2) return NextResponse.json({ users: [], structures: [] });
      // Volumes actuels (150 users, ~10 structures) : scan en mémoire, comme
      // le picker admins de compétition. À indexer si la base grossit.
      const [usersSnap, structuresSnap] = await Promise.all([
        db.collection('users').limit(1000).get(),
        db.collection('structures').limit(200).get(),
      ]);
      const users = usersSnap.docs
        .map(d => ({
          uid: d.id,
          displayName: (d.data().displayName as string) || (d.data().discordUsername as string) || d.id,
          discordUsername: (d.data().discordUsername as string) || '',
        }))
        .filter(u =>
          u.displayName.toLowerCase().includes(search) ||
          u.discordUsername.toLowerCase().includes(search))
        .slice(0, 6);
      const structures = structuresSnap.docs
        .map(d => ({
          id: d.id,
          name: (d.data().name as string) || d.id,
          tag: (d.data().tag as string) || '',
        }))
        .filter(s => s.name.toLowerCase().includes(search) || s.tag.toLowerCase().includes(search))
        .slice(0, 6);
      return NextResponse.json({ users, structures });
    }

    const snap = await db.collection('competition_bans').get();
    const bans = snap.docs
      .map(d => serializeBan(d.id, d.data()))
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    return NextResponse.json({ bans });
  } catch (err) {
    captureApiError('API Admin/CompetitionBans GET error', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}

// POST /api/admin/competition-bans — créer un ban
export async function POST(req: NextRequest) {
  try {
    const uid = await verifyAuth(req);
    if (!uid) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
    if (!(await isCompetitionAdmin(uid))) {
      return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });
    }

    const blocked = await checkRateLimit(limiters.admin, rateLimitKey(req, uid));
    if (blocked) return blocked;

    const body = await req.json();
    const targetType = body.targetType === 'structure' ? 'structure' : body.targetType === 'user' ? 'user' : null;
    const targetId = typeof body.targetId === 'string' ? body.targetId.trim() : '';
    const reason = clampString(body.reason, 500);
    if (!targetType || !targetId) {
      return NextResponse.json({ error: 'Cible invalide.' }, { status: 400 });
    }
    if (!reason) {
      return NextResponse.json({ error: 'Le motif est obligatoire (il est affiché au refus d\'inscription).' }, { status: 400 });
    }

    // null = permanent ; sinon date future obligatoire
    let expiresAt: Timestamp | null = null;
    if (body.expiresAt) {
      const d = new Date(body.expiresAt);
      if (isNaN(d.getTime())) return NextResponse.json({ error: 'Date d\'expiration invalide.' }, { status: 400 });
      if (d <= new Date()) return NextResponse.json({ error: 'La date d\'expiration doit être dans le futur.' }, { status: 400 });
      expiresAt = Timestamp.fromDate(d);
    }

    const db = getAdminDb();

    // Cible réelle + label dénormalisé (lisible même si la cible disparaît)
    let targetLabel = '';
    if (targetType === 'user') {
      const userSnap = await db.collection('users').doc(targetId).get();
      if (!userSnap.exists) return NextResponse.json({ error: 'Joueur introuvable.' }, { status: 404 });
      targetLabel = (userSnap.data()?.displayName as string) || (userSnap.data()?.discordUsername as string) || targetId;
    } else {
      const structSnap = await db.collection('structures').doc(targetId).get();
      if (!structSnap.exists) return NextResponse.json({ error: 'Structure introuvable.' }, { status: 404 });
      targetLabel = (structSnap.data()?.name as string) || targetId;
    }

    // Anti-doublon : un ban ACTIF existe déjà sur cette cible → on refuse
    // (réviser l'existant plutôt qu'empiler).
    const existing = await db.collection('competition_bans')
      .where('targetType', '==', targetType)
      .where('targetId', '==', targetId)
      .get();
    const now = new Date();
    const hasActive = existing.docs.some(d => {
      const data = d.data();
      if (data.revokedAt) return false;
      const exp = data.expiresAt?.toDate?.() ?? null;
      return !exp || exp > now;
    });
    if (hasActive) {
      return NextResponse.json({ error: `${targetLabel} a déjà un ban actif. Révoque-le d'abord pour le remplacer.` }, { status: 409 });
    }

    const ref = await db.collection('competition_bans').add({
      targetType,
      targetId,
      targetLabel,
      reason,
      expiresAt,
      createdBy: uid,
      createdAt: FieldValue.serverTimestamp(),
      revokedAt: null,
      revokedBy: null,
    });

    await writeAdminAuditLog(db, {
      action: 'competition_ban_added',
      adminUid: uid,
      targetType: targetType === 'user' ? 'user' : 'structure',
      targetId,
      targetLabel,
      metadata: { banId: ref.id, reason, permanent: expiresAt === null },
    });

    return NextResponse.json({ success: true, id: ref.id });
  } catch (err) {
    captureApiError('API Admin/CompetitionBans POST error', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
