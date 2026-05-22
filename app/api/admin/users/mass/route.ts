// POST /api/admin/users/mass
// Actions admin qui touchent tous les utilisateurs en batch :
//   - action='force_disconnect_all'  → revokeRefreshTokens Firebase pour tous
//     (sauf l'admin qui clique, pour éviter le suicide de session). Sert à
//     forcer une re-connexion Discord — typiquement pour la migration des
//     refresh_token (Lot 2 du rang RL).
//   - action='sync_discord_all'      → syncDiscordMember pour tous (pseudo
//     serveur + 7 rôles). Bonus : complète le cron nocturne à la demande.
//
// Confirmation server-side : `confirm: 'FORCER'` requis pour la déco (très
// destructive — toutes les sessions tombent). 'sync_discord_all' n'a pas
// besoin de confirm car réversible et bénin.
//
// Voir docs/rl-rank-verification-plan.md.

import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb, getAdminAuth, verifyAuth, isAdmin } from '@/lib/firebase-admin';
import { captureApiError } from '@/lib/sentry';
import { limiters, rateLimitKey, checkRateLimit } from '@/lib/rate-limit';
import { writeAdminAuditLog } from '@/lib/admin-audit-log';
import { syncDiscordMember } from '@/lib/discord-role-sync';

export async function POST(req: NextRequest) {
  try {
    const adminUid = await verifyAuth(req);
    if (!adminUid) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
    if (!(await isAdmin(adminUid))) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });

    const blocked = await checkRateLimit(limiters.write, rateLimitKey(req, adminUid));
    if (blocked) return blocked;

    const body = await req.json().catch(() => ({}));
    const action = typeof body?.action === 'string' ? body.action : '';

    const db = getAdminDb();
    const usersSnap = await db.collection('users').get();

    if (action === 'force_disconnect_all') {
      if (body?.confirm !== 'FORCER') {
        return NextResponse.json({
          error: "Confirmation requise : envoie { confirm: 'FORCER' }.",
        }, { status: 400 });
      }

      const adminAuth = getAdminAuth();
      const targets = usersSnap.docs.filter(d => d.id !== adminUid); // on s'épargne soi-même
      let revoked = 0;
      let failed = 0;
      const failedIds: string[] = [];

      for (const doc of targets) {
        try {
          await adminAuth.revokeRefreshTokens(doc.id);
          revoked++;
        } catch (err) {
          failed++;
          failedIds.push(doc.id);
          console.error(`[mass force_disconnect] ${doc.id}`, err);
        }
      }

      await writeAdminAuditLog(db, {
        action: 'user_force_disconnected',
        adminUid,
        targetType: 'user',
        targetId: 'mass',
        targetLabel: `Mass force-déco — ${revoked} déconnectés (${failed} échec)`,
      });

      return NextResponse.json({
        ok: true,
        message: `${revoked} session(s) révoquée(s). ${failed > 0 ? `${failed} échec(s).` : ''}`,
        revoked,
        failed,
        failedIds: failed > 0 ? failedIds : undefined,
        note: 'Toi-même n\'a PAS été déconnecté(e) — pour ne pas casser ta session admin.',
      });
    }

    if (action === 'sync_discord_all') {
      let synced = 0;
      let notOnServer = 0;
      let noDiscord = 0;
      let errored = 0;
      const startedAt = Date.now();
      const HARD_DEADLINE_MS = 50_000; // marge sous le timeout Vercel function (60s Hobby)

      for (const doc of usersSnap.docs) {
        if (Date.now() - startedAt > HARD_DEADLINE_MS) {
          // On préfère renvoyer un résultat partiel plutôt qu'un timeout opaque.
          return NextResponse.json({
            ok: true,
            partial: true,
            message: `Sync interrompue par sécurité (proche du timeout). ${synced} synchro(s). Relance pour finir.`,
            synced, notOnServer, noDiscord, errored,
          });
        }
        try {
          const r = await syncDiscordMember(db, doc.id);
          if (r === 'synced') synced++;
          else if (r === 'not_on_server') notOnServer++;
          else if (r === 'no_discord_id') noDiscord++;
          else errored++;
        } catch (err) {
          errored++;
          console.error(`[mass sync_discord] ${doc.id}`, err);
        }
        await new Promise(r => setTimeout(r, 80));
      }

      return NextResponse.json({
        ok: true,
        message: `${synced} joueur(s) synchronisé(s) sur Discord.`,
        synced, notOnServer, noDiscord, errored,
      });
    }

    return NextResponse.json({ error: 'Action inconnue' }, { status: 400 });
  } catch (err) {
    captureApiError('API admin/users/mass error', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
