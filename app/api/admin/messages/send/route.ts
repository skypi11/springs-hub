// POST /api/admin/messages/send
// Envoie un message d'annonce/relance ciblé à un segment d'utilisateurs.
// Admin only. Body :
//   { segment, game?, title, message, link?, channels: { inApp, dm } }
//
// Canaux :
//  - inApp  : notification in-app pour TOUS les destinataires (rapide, garanti).
//  - dm     : DM Discord via le bot, UNIQUEMENT pour ceux qui n'ont pas opt-out
//             (dmAnnouncementsOptOut), throttlé + cappé pour ne pas se faire
//             flag par Discord. Best-effort (403 si DM bloqués = silencieux).
//
// Trace : un doc dans `admin_messages` (qui/quand/segment/stats).

import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb, verifyAuth, isAdmin } from '@/lib/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { captureApiError } from '@/lib/sentry';
import { limiters, rateLimitKey, checkRateLimit } from '@/lib/rate-limit';
import { clampString } from '@/lib/validation';
import { isSegmentId, DM_CAP } from '@/lib/admin-segments';
import { querySegmentUsers } from '@/lib/admin-segment-query';
import { createNotifications, type NotificationPayload } from '@/lib/notifications';
import { sendAnnouncementDM } from '@/lib/discord-bot';

export const maxDuration = 300;

// Garde-fous anti-spam Discord : on plafonne le nombre de DM par envoi (DM_CAP,
// importé de admin-segments) et on throttle entre chaque (ouverture de DM channel
// = action surveillée par Discord). HARD_DEADLINE_MS borne le temps total de la
// boucle DM pour ne JAMAIS dépasser maxDuration : on sort proprement et on
// comptabilise le reste dans dmCapped (pattern repris de admin/users/mass).
const DM_THROTTLE_MS = 250;
// maxDuration=300 (Fluid) → boucle bornée à 270s. Le throttle 250ms reste LA
// protection anti-rate-limit (envoi espacé, jamais en rafale), pas le cap.
const HARD_DEADLINE_MS = 270_000;
const NOTIF_BATCH = 400; // < limite 500 writes/batch Firestore

export async function POST(req: NextRequest) {
  try {
    const adminUid = await verifyAuth(req);
    if (!adminUid) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
    if (!(await isAdmin(adminUid))) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });

    const blocked = await checkRateLimit(limiters.write, rateLimitKey(req, adminUid));
    if (blocked) return blocked;

    const body = await req.json().catch(() => ({}));
    const segment = body?.segment;
    const game = typeof body?.game === 'string' && body.game ? body.game : null;
    const title = clampString(typeof body?.title === 'string' ? body.title : '', 200).trim();
    const message = clampString(typeof body?.message === 'string' ? body.message : '', 2000).trim();
    const rawLink = typeof body?.link === 'string' ? body.link.trim() : '';
    // Lien interne STRICT : un seul '/' en tête, pas '//host' ni '/\\host' qui
    // sont des URL protocol-relative (open-redirect via router.push côté in-app).
    const link = /^\/(?![/\\])/.test(rawLink) ? rawLink.slice(0, 300) : '';
    const wantInApp = body?.channels?.inApp !== false; // in-app par défaut
    const wantDM = body?.channels?.dm === true;

    if (!isSegmentId(segment)) return NextResponse.json({ error: 'Segment invalide' }, { status: 400 });
    if (!title || !message) return NextResponse.json({ error: 'Titre et message obligatoires.' }, { status: 400 });
    if (!wantInApp && !wantDM) return NextResponse.json({ error: 'Choisis au moins un canal.' }, { status: 400 });

    const db = getAdminDb();
    const users = await querySegmentUsers(db, segment, game);
    if (users.length === 0) {
      return NextResponse.json({ ok: true, total: 0, inAppSent: 0, dmSent: 0, dmFailed: 0, dmSkippedOptOut: 0, dmCapped: 0 });
    }

    // ── Canal 1 : notifications in-app (tous), par batches ────────────────
    let inAppSent = 0;
    if (wantInApp) {
      for (let i = 0; i < users.length; i += NOTIF_BATCH) {
        const slice = users.slice(i, i + NOTIF_BATCH);
        const payloads: NotificationPayload[] = slice.map(u => ({
          userId: u.uid, type: 'generic', title, message, link: link || undefined,
        }));
        await createNotifications(db, payloads);
        inAppSent += slice.length;
      }
    }

    // ── Trace écrite AVANT la boucle DM ───────────────────────────────────
    // Si la fonction est tuée pendant les DM (timeout), le doc existe quand même
    // (avec les stats in-app + DM à 0) ; on le met à jour après la boucle. Sans
    // ça, un envoi partiel ne laisserait AUCUNE trace.
    const reachable = wantDM ? users.filter(u => !u.optedOutDM && u.discordId) : [];
    const dmSkippedOptOut = users.filter(u => u.optedOutDM).length;
    const traceRef = db.collection('admin_messages').doc();
    await traceRef.set({
      adminUid,
      segment,
      game: game || null,
      title,
      message,
      link: link || null,
      channels: { inApp: wantInApp, dm: wantDM },
      total: users.length,
      inAppSent,
      dmSent: 0,
      dmFailed: 0,
      dmSkippedOptOut,
      dmCapped: 0,
      status: wantDM ? 'sending' : 'done',
      createdAt: FieldValue.serverTimestamp(),
    });

    // ── Canal 2 : DM Discord (hors opt-out), throttlé + cappé + borné en temps ─
    let dmSent = 0, dmFailed = 0;
    if (wantDM) {
      const toSend = reachable.slice(0, DM_CAP);
      const dmLink = link ? `https://aedral.com${link}` : null;
      const startedAt = Date.now();
      for (const u of toSend) {
        if (Date.now() - startedAt > HARD_DEADLINE_MS) break; // garde anti-timeout
        const r = await sendAnnouncementDM(u.discordId, { title, message, link: dmLink });
        if (r.ok) dmSent++; else dmFailed++;
        await new Promise(res => setTimeout(res, DM_THROTTLE_MS));
      }
    }
    // Tout joignable non tenté (cap DM OU sortie sur deadline) → comptabilisé.
    const dmCapped = Math.max(0, reachable.length - dmSent - dmFailed);

    // Mise à jour de la trace avec les stats DM finales.
    await traceRef.update({ dmSent, dmFailed, dmCapped, status: 'done' });

    return NextResponse.json({
      ok: true,
      total: users.length,
      inAppSent,
      dmSent,
      dmFailed,
      dmSkippedOptOut,
      dmCapped,
    });
  } catch (err) {
    captureApiError('API admin/messages/send POST error', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
