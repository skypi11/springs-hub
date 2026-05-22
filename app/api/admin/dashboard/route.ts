import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb, verifyAuth, isAdmin } from '@/lib/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { captureApiError } from '@/lib/sentry';

// Nouveautés remontées par catégorie. Au-delà, le front affiche "N+".
const SCAN_LIMIT = 60;
const STRUCTURES_SCAN = 1000;
// Défaut quand l'admin n'a jamais cliqué "marquer comme vu".
const DEFAULT_LOOKBACK_DAYS = 7;
// Taille du flux d'activité récente renvoyé.
const ACTIVITY_LIMIT = 25;

function toMillis(v: unknown): number | null {
  if (!v) return null;
  if (typeof v === 'object' && v !== null && 'toMillis' in v
    && typeof (v as { toMillis: unknown }).toMillis === 'function') {
    return (v as { toMillis: () => number }).toMillis();
  }
  if (v instanceof Date) return v.getTime();
  return null;
}

type ActivityItem = {
  type: 'user' | 'structure_request' | 'structure_validated' | 'team' | 'event';
  id: string;
  label: string;
  sublabel: string;
  ts: number;
  href: string;
};

// GET /api/admin/dashboard — radar de nouveauté depuis la dernière visite
// "marquée comme vue", cas à traiter, flux d'activité récente. Ne met PAS à jour
// la dernière visite (c'est le rôle du POST mark_seen, déclenché manuellement).
export async function GET(req: NextRequest) {
  try {
    const uid = await verifyAuth(req);
    if (!uid) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
    if (!(await isAdmin(uid))) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });

    const db = getAdminDb();

    const adminSnap = await db.collection('admins').doc(uid).get();
    const lastSeenMs = toMillis(adminSnap.data()?.lastDashboardSeenAt);
    const sinceMs = lastSeenMs ?? Date.now() - DEFAULT_LOOKBACK_DAYS * 86_400_000;

    const [structuresSnap, usersCount, usersSnap, teamsSnap, eventsSnap] = await Promise.all([
      db.collection('structures').limit(STRUCTURES_SCAN).get(),
      db.collection('users').count().get(),
      db.collection('users').orderBy('createdAt', 'desc').limit(SCAN_LIMIT).get(),
      db.collection('sub_teams').orderBy('createdAt', 'desc').limit(SCAN_LIMIT).get(),
      db.collection('structure_events').orderBy('createdAt', 'desc').limit(SCAN_LIMIT).get(),
    ]);

    // ── Structures : compteurs d'état + nouveautés (demandes / validations) ──
    const structureName = new Map<string, string>();
    let activeStructures = 0;
    let pendingStructures = 0;
    let suspendedStructures = 0;
    let deletionScheduledStructures = 0;
    let orphanedStructures = 0;
    const newRequests: ActivityItem[] = [];
    const newValidated: ActivityItem[] = [];

    for (const doc of structuresSnap.docs) {
      const d = doc.data();
      structureName.set(doc.id, (d.name as string) ?? '');
      const status = d.status as string | undefined;
      if (status === 'active') activeStructures++;
      else if (status === 'pending_validation') pendingStructures++;
      else if (status === 'suspended') suspendedStructures++;
      else if (status === 'deletion_scheduled') deletionScheduledStructures++;
      else if (status === 'orphaned') orphanedStructures++;

      const reqMs = toMillis(d.requestedAt);
      if (reqMs && reqMs >= sinceMs && status === 'pending_validation') {
        newRequests.push({
          type: 'structure_request',
          id: doc.id,
          label: (d.name as string) || 'Structure',
          sublabel: 'Demande de création',
          ts: reqMs,
          href: '/admin/structures',
        });
      }
      const valMs = toMillis(d.validatedAt);
      if (valMs && valMs >= sinceMs && status === 'active') {
        newValidated.push({
          type: 'structure_validated',
          id: doc.id,
          label: (d.name as string) || 'Structure',
          sublabel: 'Structure validée',
          ts: valMs,
          href: `/community/structure/${doc.id}`,
        });
      }
    }

    // ── Nouveaux inscrits ──
    const newUsers: ActivityItem[] = [];
    for (const doc of usersSnap.docs) {
      const d = doc.data();
      const ms = toMillis(d.createdAt);
      if (ms == null || ms < sinceMs) continue;
      newUsers.push({
        type: 'user',
        id: doc.id,
        label: (d.displayName as string) || (d.discordUsername as string) || 'Joueur',
        sublabel: 'Nouvelle inscription',
        ts: ms,
        href: `/profile/${doc.id}`,
      });
    }

    // ── Nouvelles équipes ──
    const newTeams: ActivityItem[] = [];
    for (const doc of teamsSnap.docs) {
      const d = doc.data();
      const ms = toMillis(d.createdAt);
      if (ms == null || ms < sinceMs) continue;
      const sName = structureName.get(d.structureId as string) ?? '';
      newTeams.push({
        type: 'team',
        id: doc.id,
        label: (d.name as string) || 'Équipe',
        sublabel: sName ? `Équipe créée · ${sName}` : 'Nouvelle équipe',
        ts: ms,
        href: '/admin/teams',
      });
    }

    // ── Nouveaux événements ──
    const newEvents: ActivityItem[] = [];
    for (const doc of eventsSnap.docs) {
      const d = doc.data();
      const ms = toMillis(d.createdAt);
      if (ms == null || ms < sinceMs) continue;
      const sName = structureName.get(d.structureId as string) ?? '';
      newEvents.push({
        type: 'event',
        id: doc.id,
        label: (d.title as string) || 'Événement',
        sublabel: sName ? `Événement créé · ${sName}` : 'Nouvel événement',
        ts: ms,
        href: '/admin/calendar',
      });
    }

    // ── Flux d'activité fusionné, du plus récent au plus ancien ──
    const activity = [...newUsers, ...newRequests, ...newValidated, ...newTeams, ...newEvents]
      .sort((a, b) => b.ts - a.ts)
      .slice(0, ACTIVITY_LIMIT);

    return NextResponse.json({
      lastSeenAt: lastSeenMs ? new Date(lastSeenMs).toISOString() : null,
      cappedAt: SCAN_LIMIT,
      radar: {
        newUsers: newUsers.length,
        newStructureRequests: newRequests.length,
        newValidatedStructures: newValidated.length,
        newTeams: newTeams.length,
        newEvents: newEvents.length,
      },
      toHandle: {
        pendingStructures,
        suspendedStructures,
        deletionScheduledStructures,
        orphanedStructures,
      },
      totals: {
        activeStructures,
        totalUsers: usersCount.data().count,
      },
      activity,
    });
  } catch (err) {
    captureApiError('API Admin/Dashboard GET error', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}

// POST /api/admin/dashboard { action: 'mark_seen' } — repositionne la "dernière
// visite" à maintenant. Volontairement manuel : ouvrir le panel pour un
// dépannage urgent ne doit pas vider le radar à l'insu de l'admin.
export async function POST(req: NextRequest) {
  try {
    const uid = await verifyAuth(req);
    if (!uid) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
    if (!(await isAdmin(uid))) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });

    const body = await req.json().catch(() => ({}));
    if (body?.action !== 'mark_seen') {
      return NextResponse.json({ error: 'Action invalide' }, { status: 400 });
    }

    await getAdminDb().collection('admins').doc(uid).set(
      { lastDashboardSeenAt: FieldValue.serverTimestamp() },
      { merge: true },
    );
    return NextResponse.json({ success: true });
  } catch (err) {
    captureApiError('API Admin/Dashboard POST error', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
