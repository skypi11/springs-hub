import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb, getAdminAuth, verifyAuth, isAdmin } from '@/lib/firebase-admin';
import { captureApiError } from '@/lib/sentry';
import { limiters, rateLimitKey, checkRateLimit } from '@/lib/rate-limit';
import { writeAdminAuditLog } from '@/lib/admin-audit-log';
import {
  seedCompetitionSandbox,
  cleanupCompetitionSandbox,
  getSandboxState,
} from '@/lib/competitions/sandbox';

// Bac à sable de test du module compétitions — voir lib/competitions/sandbox.
//
// Contrairement au seed de démo local (/api/dev/seed, verrouillé machine
// locale), cette route fonctionne en preview/prod : Matt teste sur Vercel.
// Garde-fous : admins Aedral COMPLETS uniquement (création de comptes =
// pouvoir fort), aucune donnée réelle touchée (uids discord_dev_lgd_*, docs
// isDev filtrés des annuaires publics), audit log à chaque action, et le
// cleanup ne supprime une circuit_team que si elle ne porte aucune
// participation close.

export const maxDuration = 120;

export async function GET(req: NextRequest) {
  try {
    const uid = await verifyAuth(req);
    if (!uid) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
    if (!(await isAdmin(uid))) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });

    const state = await getSandboxState(getAdminDb());
    return NextResponse.json(state);
  } catch (err) {
    captureApiError('API Admin/Competitions/Sandbox GET error', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const uid = await verifyAuth(req);
    if (!uid) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
    if (!(await isAdmin(uid))) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });

    const blocked = await checkRateLimit(limiters.admin, rateLimitKey(req, uid));
    if (blocked) return blocked;

    const body = await req.json();
    const action = body.action as string;
    const db = getAdminDb();
    const adminAuth = getAdminAuth();

    if (action === 'seed') {
      const result = await seedCompetitionSandbox(db, adminAuth);
      await writeAdminAuditLog(db, {
        action: 'competition_sandbox_seeded',
        adminUid: uid,
        targetType: 'competition',
        targetId: 'sandbox',
        targetLabel: 'Bac à sable compétitions',
        metadata: result,
      });
      return NextResponse.json({ success: true, ...result });
    }

    if (action === 'cleanup') {
      const result = await cleanupCompetitionSandbox(db, adminAuth);
      await writeAdminAuditLog(db, {
        action: 'competition_sandbox_cleaned',
        adminUid: uid,
        targetType: 'competition',
        targetId: 'sandbox',
        targetLabel: 'Bac à sable compétitions',
        metadata: result,
      });
      return NextResponse.json({ success: true, ...result });
    }

    return NextResponse.json({ error: 'Action invalide.' }, { status: 400 });
  } catch (err) {
    captureApiError('API Admin/Competitions/Sandbox POST error', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
