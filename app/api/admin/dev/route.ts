import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb, verifyAuth, isAdmin } from '@/lib/firebase-admin';
import { captureApiError } from '@/lib/sentry';

// Collections principales à compter pour diagnostic santé.
const COUNT_COLLECTIONS = [
  'users',
  'admins',
  'structures',
  'structure_members',
  'sub_teams',
  'structure_events',
  'structure_todos',
  'structure_invitations',
  'structure_documents',
  'structure_replays',
  'notifications',
  'admin_audit_logs',
  'structure_audit_logs',
];

// Variables d'env sensibles à vérifier (on ne renvoie jamais les valeurs — juste
// la présence, pour diagnostiquer les "ça marche pas en prod" d'un coup d'œil).
const ENV_KEYS = [
  'FIREBASE_PROJECT_ID',
  'FIREBASE_CLIENT_EMAIL',
  'FIREBASE_PRIVATE_KEY',
  'DISCORD_CLIENT_ID',
  'DISCORD_CLIENT_SECRET',
  'R2_ENDPOINT',
  'R2_ACCESS_KEY_ID',
  'R2_SECRET_ACCESS_KEY',
  'R2_BUCKET_NAME',
  'R2_PUBLIC_URL',
  'UPSTASH_REDIS_REST_URL',
  'UPSTASH_REDIS_REST_TOKEN',
  'SENTRY_DSN',
  'NEXT_PUBLIC_SENTRY_DSN',
  'TRN_API_KEY',
];

// GET /api/admin/dev — diagnostics pour outils dev.
// Retourne : counts par collection, env vars présentes, infos runtime.
export async function GET(req: NextRequest) {
  try {
    const uid = await verifyAuth(req);
    if (!uid) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
    if (!(await isAdmin(uid))) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });

    const db = getAdminDb();

    // count() est un aggregation query — 1 lecture par requête peu importe la taille.
    const counts = await Promise.all(
      COUNT_COLLECTIONS.map(async name => {
        try {
          const snap = await db.collection(name).count().get();
          return { name, count: snap.data().count, error: null as string | null };
        } catch (err) {
          return { name, count: -1, error: err instanceof Error ? err.message : 'erreur' };
        }
      })
    );

    const env = ENV_KEYS.map(key => ({
      key,
      set: typeof process.env[key] === 'string' && process.env[key]!.length > 0,
    }));

    return NextResponse.json({
      counts,
      env,
      runtime: {
        nodeEnv: process.env.NODE_ENV ?? 'unknown',
        vercelEnv: process.env.VERCEL_ENV ?? null,
        vercelRegion: process.env.VERCEL_REGION ?? null,
        vercelGitCommit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? null,
        serverTime: new Date().toISOString(),
      },
      crons: [
        { path: '/api/cron/expire-invitations', schedule: '0 3 * * *' },
        { path: '/api/cron/todos-reminders',    schedule: '0 9 * * *' },
      ],
    });
  } catch (err) {
    captureApiError('API Admin/Dev GET error', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
