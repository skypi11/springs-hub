import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb, verifyAuth, isAdmin } from '@/lib/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { captureApiError } from '@/lib/sentry';

// Nouveautés remontées par catégorie. Au-delà, le front affiche "N+".
const SCAN_LIMIT = 60;
const STRUCTURES_SCAN = 1000;
// Défaut quand l'admin n'a jamais cliqué "marquer comme vu".
const DEFAULT_LOOKBACK_DAYS = 7;

function toMillis(v: unknown): number | null {
  if (!v) return null;
  if (typeof v === 'object' && v !== null && 'toMillis' in v
    && typeof (v as { toMillis: unknown }).toMillis === 'function') {
    return (v as { toMillis: () => number }).toMillis();
  }
  if (v instanceof Date) return v.getTime();
  return null;
}

type NewItem = {
  type: 'user' | 'structure_request' | 'structure_validated' | 'team' | 'event';
  id: string;
  label: string;
  sublabel: string;
  avatar: string;
  ts: number;
  href: string;
};

// GET /api/admin/dashboard, nouveautés DÉTAILLÉES depuis la dernière visite
// "marquée comme vue" (la liste exacte des joueurs/équipes/etc., pas juste un
// compteur), cas à traiter, totaux. Ne met PAS à jour la dernière visite.
export async function GET(req: NextRequest) {
  try {
    const uid = await verifyAuth(req);
    if (!uid) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
    if (!(await isAdmin(uid))) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });

    const db = getAdminDb();

    const adminSnap = await db.collection('aedral_admins').doc(uid).get();
    const lastSeenMs = toMillis(adminSnap.data()?.lastDashboardSeenAt);
    const sinceMs = lastSeenMs ?? Date.now() - DEFAULT_LOOKBACK_DAYS * 86_400_000;

    const [structuresSnap, usersCount, usersSnap, teamsSnap, eventsSnap, rankReportsSnap, linkChangeReqSnap] = await Promise.all([
      db.collection('structures').limit(STRUCTURES_SCAN).get(),
      db.collection('users').count().get(),
      db.collection('users').orderBy('createdAt', 'desc').limit(SCAN_LIMIT).get(),
      db.collection('sub_teams').orderBy('createdAt', 'desc').limit(SCAN_LIMIT).get(),
      db.collection('structure_events').orderBy('createdAt', 'desc').limit(SCAN_LIMIT).get(),
      // Signalements de rang & demandes de changement Epic (Lots 5+6), counts pour les pastilles sidebar
      db.collection('rank_reports').where('status', '==', 'pending').count().get(),
      db.collection('rl_link_change_requests').where('status', '==', 'pending').count().get(),
    ]);
    const pendingRankReports = rankReportsSnap.data().count;
    const pendingLinkChanges = linkChangeReqSnap.data().count;

    // ── Structures : compteurs d'état + nouveautés (demandes / validations) ──
    const structureName = new Map<string, string>();
    let activeStructures = 0;
    let pendingStructures = 0;
    let suspendedStructures = 0;
    let deletionScheduledStructures = 0;
    let orphanedStructures = 0;
    const structureRequests: NewItem[] = [];
    const validatedStructures: NewItem[] = [];

    for (const doc of structuresSnap.docs) {
      const d = doc.data();
      structureName.set(doc.id, (d.name as string) ?? '');
      const status = d.status as string | undefined;
      if (status === 'active') activeStructures++;
      else if (status === 'pending_validation') pendingStructures++;
      else if (status === 'suspended') suspendedStructures++;
      else if (status === 'deletion_scheduled') deletionScheduledStructures++;
      else if (status === 'orphaned') orphanedStructures++;

      const logo = (d.logoUrl as string) || '';
      const reqMs = toMillis(d.requestedAt);
      if (reqMs && reqMs >= sinceMs && status === 'pending_validation') {
        structureRequests.push({
          type: 'structure_request',
          id: doc.id,
          label: (d.name as string) || 'Structure',
          sublabel: d.tag ? `[${d.tag}] · demande de création` : 'Demande de création',
          avatar: logo,
          ts: reqMs,
          href: '/admin/structures',
        });
      }
      const valMs = toMillis(d.validatedAt);
      if (valMs && valMs >= sinceMs && status === 'active') {
        // Préfère le slug si dispo (URL propre /community/structure/timetoshine)
        // sinon fallback sur le docId Firestore — la route accepte les deux via
        // resolveStructureId() et redirige 301 vers la version slug.
        const slug = typeof d.slug === 'string' ? d.slug.trim() : '';
        validatedStructures.push({
          type: 'structure_validated',
          id: doc.id,
          label: (d.name as string) || 'Structure',
          sublabel: d.tag ? `[${d.tag}] · validée` : 'Structure validée',
          avatar: logo,
          ts: valMs,
          href: `/community/structure/${slug || doc.id}`,
        });
      }
    }

    // ── Nouveaux inscrits ──
    const users: NewItem[] = [];
    for (const doc of usersSnap.docs) {
      const d = doc.data();
      const ms = toMillis(d.createdAt);
      if (ms == null || ms < sinceMs) continue;
      users.push({
        type: 'user',
        id: doc.id,
        label: (d.displayName as string) || (d.discordUsername as string) || 'Joueur',
        sublabel: (d.discordUsername as string) ? `@${d.discordUsername}` : 'Nouvelle inscription',
        avatar: (d.avatarUrl as string) || (d.discordAvatar as string) || '',
        ts: ms,
        href: `/profile/${doc.id}`,
      });
    }

    // ── Nouvelles équipes ──
    const teams: NewItem[] = [];
    for (const doc of teamsSnap.docs) {
      const d = doc.data();
      const ms = toMillis(d.createdAt);
      if (ms == null || ms < sinceMs) continue;
      const sName = structureName.get(d.structureId as string) ?? '';
      teams.push({
        type: 'team',
        id: doc.id,
        label: (d.name as string) || 'Équipe',
        sublabel: sName || 'Nouvelle équipe',
        avatar: (d.logoUrl as string) || '',
        ts: ms,
        href: '/admin/teams',
      });
    }

    // ── Nouveaux événements ──
    const events: NewItem[] = [];
    for (const doc of eventsSnap.docs) {
      const d = doc.data();
      const ms = toMillis(d.createdAt);
      if (ms == null || ms < sinceMs) continue;
      const sName = structureName.get(d.structureId as string) ?? '';
      events.push({
        type: 'event',
        id: doc.id,
        label: (d.title as string) || 'Événement',
        sublabel: sName || 'Nouvel événement',
        avatar: '',
        ts: ms,
        href: '/admin/calendar',
      });
    }

    return NextResponse.json({
      lastSeenAt: lastSeenMs ? new Date(lastSeenMs).toISOString() : null,
      cappedAt: SCAN_LIMIT,
      groups: {
        structureRequests,
        users,
        teams,
        validatedStructures,
        events,
      },
      toHandle: {
        pendingStructures,
        suspendedStructures,
        deletionScheduledStructures,
        orphanedStructures,
        pendingRankReports,
        pendingLinkChanges,
      },
      totals: {
        activeStructures,
        totalUsers: usersCount.data().count,
      },
    });
  } catch (err) {
    captureApiError('API Admin/Dashboard GET error', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}

// POST /api/admin/dashboard { action: 'mark_seen' }, repositionne la "dernière
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

    await getAdminDb().collection('aedral_admins').doc(uid).set(
      { lastDashboardSeenAt: FieldValue.serverTimestamp() },
      { merge: true },
    );
    return NextResponse.json({ success: true });
  } catch (err) {
    captureApiError('API Admin/Dashboard POST error', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
