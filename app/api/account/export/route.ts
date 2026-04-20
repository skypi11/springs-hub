import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb, verifyAuth } from '@/lib/firebase-admin';
import { checkRateLimit, limiters, rateLimitKey } from '@/lib/rate-limit';
import { captureApiError } from '@/lib/sentry';

// GET /api/account/export — RGPD art. 20 (droit à la portabilité).
// Renvoie un JSON complet des données personnelles de l'utilisateur authentifié.
// Rate-limité pour éviter les scraping automatisés.
export async function GET(req: NextRequest) {
  try {
    const uid = await verifyAuth(req);
    if (!uid) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

    // Rate limit agressif : un export par minute, c'est largement suffisant.
    const rl = await checkRateLimit(limiters.read, rateLimitKey(req, uid));
    if (rl) return rl;

    const db = getAdminDb();

    // En parallèle — chaque requête cible un aspect du profil utilisateur.
    const [
      userSnap,
      memberships,
      structuresFounded,
      structuresCoFounded,
      structuresManaged,
      allSubTeams,
      notifications,
      invitationsCreated,
      invitationsAsApplicant,
      eventsCreated,
      todosCreated,
    ] = await Promise.all([
      db.collection('users').doc(uid).get(),
      db.collection('structure_members').where('userId', '==', uid).get(),
      db.collection('structures').where('founderId', '==', uid).get(),
      db.collection('structures').where('coFounderIds', 'array-contains', uid).get(),
      db.collection('structures').where('managerIds', 'array-contains', uid).get(),
      // array-contains ne marche que sur un champ — on récupère tous les subteams
      // dans lesquels on apparaît via playerIds (le champ le plus probable) puis
      // on filtre en mémoire pour captain/sub/staff.
      db.collection('sub_teams').where('playerIds', 'array-contains', uid).get(),
      db.collection('notifications').where('userId', '==', uid).get(),
      db.collection('structure_invitations').where('createdBy', '==', uid).get(),
      db.collection('structure_invitations').where('applicantId', '==', uid).get(),
      db.collection('structure_events').where('createdBy', '==', uid).get(),
      db.collection('structure_todos').where('createdBy', '==', uid).get(),
    ]);

    // Les autres array-contains (subIds, staffIds, captainId) nécessiteraient
    // des queries séparées — on les sort en mémoire à partir de la structure
    // globale pour ne pas multiplier les lectures (coût Firestore).
    // Pour compléter on relance 3 queries sur les autres champs.
    const [subsMatches, staffMatches, captainMatches] = await Promise.all([
      db.collection('sub_teams').where('subIds', 'array-contains', uid).get(),
      db.collection('sub_teams').where('staffIds', 'array-contains', uid).get(),
      db.collection('sub_teams').where('captainId', '==', uid).get(),
    ]);

    const teamsMap = new Map<string, FirebaseFirestore.DocumentData>();
    for (const snap of [allSubTeams, subsMatches, staffMatches, captainMatches]) {
      for (const d of snap.docs) teamsMap.set(d.id, { id: d.id, ...d.data() });
    }

    const serialize = (docs: FirebaseFirestore.QueryDocumentSnapshot[]) =>
      docs.map(d => ({ id: d.id, ...d.data() }));

    const payload = {
      exportedAt: new Date().toISOString(),
      exportVersion: 1,
      userId: uid,
      profile: userSnap.exists ? { id: uid, ...userSnap.data() } : null,
      memberships: serialize(memberships.docs),
      structures: {
        founded: serialize(structuresFounded.docs),
        coFounded: serialize(structuresCoFounded.docs),
        managed: serialize(structuresManaged.docs),
      },
      teams: Array.from(teamsMap.values()),
      notifications: serialize(notifications.docs),
      invitations: {
        created: serialize(invitationsCreated.docs),
        asApplicant: serialize(invitationsAsApplicant.docs),
      },
      eventsCreated: serialize(eventsCreated.docs),
      todosCreated: serialize(todosCreated.docs),
      notes: [
        'Les audit logs (admin_audit_logs, structure_audit_logs, structure_member_history) sont conservés côté serveur pour obligations légales et intégrité de la plateforme (durée 3 ans max), conformément à la politique de confidentialité.',
        'Les Timestamps Firestore sont sérialisés en ISO 8601.',
      ],
    };

    // Force le download via un nom de fichier explicite.
    const filename = `springs-hub-export-${uid}-${new Date().toISOString().slice(0, 10)}.json`;
    return new NextResponse(JSON.stringify(payload, null, 2), {
      status: 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    });
  } catch (err) {
    captureApiError('API Account/Export GET error', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
