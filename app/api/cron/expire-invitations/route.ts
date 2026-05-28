import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import type { Firestore } from 'firebase-admin/firestore';
import { createNotifications } from '@/lib/notifications';
import { captureApiError } from '@/lib/sentry';
import { expiredDepartures } from '@/lib/structure-roles';
import { syncDiscordMember } from '@/lib/discord-role-sync';
import { fetchDiscordConnections, mergeConnections, type DiscordConnection } from '@/lib/discord-connections';
import { refreshDiscordAccessToken } from '@/lib/discord-refresh';
import { isValidEpicId } from '@/lib/rl-identity';
import { loadCronState, saveCronState } from '@/lib/cron-state';
import { syncValorantRanksBatch } from '@/lib/valorant-sync';

// GET /api/cron/expire-invitations
// Vercel Cron quotidien (3h), trois tâches refondues pour SCALER :
//
//  1. Expire les join_request / direct_invite pending > EXPIRY_DAYS.
//     AVANT : full scan structure_invitations sans limit (bombe à 10k+).
//     APRÈS : query indexée (status, createdAt) + limit 500/run.
//
//  2. Traite les préavis de départ de co-fondateurs expirés.
//     AVANT : full scan structures + N+1 query sub_teams.
//     APRÈS : pagination cursor avec état persisté (_cron_state/cofounder_departures),
//     limit 500/run, cycle complet en quelques jours (acceptable car
//     départs co-fondateurs rares, 15-20/mois max même à 5k structures).
//
//  3. Passe nocturne Discord (sync rôles + refresh connexions).
//     AVANT : full scan users + sleep 100ms par user (= 100s pour 1000 users).
//     APRÈS : pagination cursor avec état persisté, limit 200/run.
//     Cycle complet en quelques jours acceptable car cosmetic (pseudo Epic).
//
// Limites par run respectent le timeout Vercel Hobby (60s) avec marge.
// maxDuration=60 pour autoriser jusqu'à la limite Hobby.
//
// Sécurisation : Vercel Cron envoie `Authorization: Bearer <CRON_SECRET>`
// quand la variable d'env est définie. En dev, on autorise sans secret.

export const maxDuration = 60;

const EXPIRY_DAYS = 30;
// Limites par run (scalent indépendamment du nombre total de docs en base)
const INVITATIONS_LIMIT_PER_RUN = 500;
const DEPARTURES_LIMIT_PER_RUN = 500;
const DISCORD_SYNC_LIMIT_PER_RUN = 200;
// Délai entre 2 calls Discord pour rester en dessous du rate-limit (~30/s safe)
const DISCORD_USER_DELAY_MS = 100;

// ── Tâche 1, Expire les invitations pending dépassées ───────────────────
// Query indexée (status + createdAt) → ne lit QUE les docs concernés.
// Limit par run : 500. Si plus à traiter, ça passera au prochain run.
async function expireInvitations(db: Firestore): Promise<number> {
  const cutoff = Timestamp.fromMillis(Date.now() - EXPIRY_DAYS * 24 * 60 * 60 * 1000);
  const snap = await db
    .collection('structure_invitations')
    .where('status', '==', 'pending')
    .where('createdAt', '<=', cutoff)
    .limit(INVITATIONS_LIMIT_PER_RUN)
    .get();

  if (snap.empty) return 0;

  const batch = db.batch();
  const notifications: Parameters<typeof createNotifications>[1] = [];
  let expiredCount = 0;

  for (const doc of snap.docs) {
    const data = doc.data();
    const type = data.type;
    if (type === 'join_request') {
      const applicantId = data.applicantId;
      if (!applicantId) continue;
      batch.update(doc.ref, { status: 'expired', expiredAt: new Date() });
      notifications.push({
        userId: applicantId,
        type: 'invitation_expired',
        title: 'Demande expirée',
        message: `Ta demande auprès d'une structure est restée sans réponse plus de ${EXPIRY_DAYS} jours et a été automatiquement archivée.`,
        link: '/community/my-applications',
        metadata: { invitationId: doc.id, structureId: data.structureId || '' },
      });
      expiredCount++;
    } else if (type === 'direct_invite') {
      const targetUserId = data.targetUserId;
      if (!targetUserId) continue;
      batch.update(doc.ref, { status: 'expired', expiredAt: new Date() });
      notifications.push({
        userId: targetUserId,
        type: 'invitation_expired',
        title: 'Invitation expirée',
        message: `Une invitation à rejoindre une structure est restée sans réponse plus de ${EXPIRY_DAYS} jours et a été automatiquement archivée.`,
        link: '/community/my-applications',
        metadata: { invitationId: doc.id, structureId: data.structureId || '' },
      });
      expiredCount++;
    }
    // type 'invite_link' : pas d'user ciblé, skip (autre garbage collection si besoin)
  }

  if (expiredCount > 0) {
    await batch.commit();
    await createNotifications(db, notifications);
  }
  return expiredCount;
}

// ── Tâche 2, Préavis de départ de co-fondateurs expirés ────────────────
// Pagination cursor : on traite DEPARTURES_LIMIT_PER_RUN structures par run,
// on persiste le cursor dans _cron_state. Cycle complet en quelques jours
// pour les grosses bases, acceptable car les départs sont rares et le
// préavis 7j tolère bien un délai de quelques jours sur le traitement.
async function processExpiredDepartures(db: Firestore): Promise<{ processed: number; cycleReset: boolean }> {
  const stateKey = 'cofounder_departures';
  const state = await loadCronState(db, stateKey);

  // Reprise depuis le cursor du run précédent, ou début de cycle si null
  let query = db.collection('structures').orderBy('__name__').limit(DEPARTURES_LIMIT_PER_RUN);
  if (state?.lastCursor) {
    const cursorDoc = await db.collection('structures').doc(state.lastCursor).get();
    if (cursorDoc.exists) {
      query = query.startAfter(cursorDoc);
    }
  }

  const snap = await query.get();
  let processed = 0;

  for (const structDoc of snap.docs) {
    const data = structDoc.data();
    const departures = data.coFounderDepartures as Record<string, unknown> | undefined;
    if (!departures || Object.keys(departures).length === 0) continue;
    const expired = expiredDepartures(departures);
    if (expired.length === 0) continue;

    // Batch atomique : update structure + reset des structure_members.role
    const batch = db.batch();
    const updates: Record<string, unknown> = {
      coFounderIds: FieldValue.arrayRemove(...expired),
      updatedAt: FieldValue.serverTimestamp(),
    };
    for (const u of expired) updates[`coFounderDepartures.${u}`] = FieldValue.delete();
    batch.update(structDoc.ref, updates);

    // Le where().get() ici est partitionné par structure (≤2 co-fondateurs
    // max par structure typiquement), donc reste petit. Sequencement OK.
    for (const u of expired) {
      const mSnap = await db.collection('structure_members')
        .where('structureId', '==', structDoc.id)
        .where('userId', '==', u)
        .limit(1)
        .get();
      for (const mDoc of mSnap.docs) batch.update(mDoc.ref, { role: 'joueur' });
    }
    await batch.commit();
    processed += expired.length;
  }

  // Avance / reset du cursor
  const cycleComplete = snap.docs.length < DEPARTURES_LIMIT_PER_RUN;
  const newCursor = cycleComplete ? null : snap.docs[snap.docs.length - 1].id;
  await saveCronState(db, stateKey, {
    lastCursor: newCursor,
    lastRunAt: Date.now(),
    processed,
    cycleStartedAt: state?.lastCursor ? state.cycleStartedAt : Date.now(),
  });

  return { processed, cycleReset: cycleComplete };
}

// ── Tâche 3, Passe nocturne Discord ─────────────────────────────────────
// Pagination cursor : DISCORD_SYNC_LIMIT_PER_RUN users par run. Délai 100ms
// entre users pour le rate-limit Discord = ~20s pour 200 users (sous 60s).
// Cycle complet en quelques jours sur grosse base, acceptable car la sync
// est cosmétique (pseudo Discord + rafraîchissement rôles).
async function processNightlyDiscordSync(
  db: Firestore,
): Promise<{ rolesSynced: number; connectionsRefreshed: number; epicNamesUpdated: number; errors: number; cycleReset: boolean }> {
  const stateKey = 'discord_sync';
  const state = await loadCronState(db, stateKey);

  let query = db.collection('users').orderBy('__name__').limit(DISCORD_SYNC_LIMIT_PER_RUN);
  if (state?.lastCursor) {
    const cursorDoc = await db.collection('users').doc(state.lastCursor).get();
    if (cursorDoc.exists) {
      query = query.startAfter(cursorDoc);
    }
  }

  const usersSnap = await query.get();
  let rolesSynced = 0;
  let connectionsRefreshed = 0;
  let epicNamesUpdated = 0;
  let errors = 0;

  for (const userDoc of usersSnap.docs) {
    const uid = userDoc.id;
    try {
      const syncResult = await syncDiscordMember(db, uid);
      if (syncResult === 'synced') rolesSynced++;

      const refreshed = await refreshDiscordAccessToken(db, uid);
      if (refreshed) {
        const fresh = await fetchDiscordConnections(refreshed.accessToken);
        if (fresh.length > 0) {
          const existing = userDoc.data().discordConnections as DiscordConnection[] | undefined;
          const merged = mergeConnections(fresh, existing);
          const updates: Record<string, unknown> = { discordConnections: merged };

          const rlEpicId = userDoc.data().rlEpicId as string | undefined;
          if (isValidEpicId(rlEpicId)) {
            const matching = fresh.find(c => c.type === 'epicgames' && c.verified && c.id === rlEpicId);
            const currentName = userDoc.data().rlEpicName as string | undefined;
            if (matching?.name && matching.name !== currentName) {
              updates.rlEpicName = matching.name;
              updates.rlPlatformId = matching.name; // miroir URLs tracker
              epicNamesUpdated++;
            }
          }
          await userDoc.ref.update(updates);
          connectionsRefreshed++;
        }
      }
    } catch (err) {
      errors++;
      console.error(`[cron nightly-discord] uid=${uid}`, err);
    }
    await new Promise(r => setTimeout(r, DISCORD_USER_DELAY_MS));
  }

  const cycleComplete = usersSnap.docs.length < DISCORD_SYNC_LIMIT_PER_RUN;
  const newCursor = cycleComplete ? null : usersSnap.docs[usersSnap.docs.length - 1].id;
  await saveCronState(db, stateKey, {
    lastCursor: newCursor,
    lastRunAt: Date.now(),
    processed: usersSnap.size,
    cycleStartedAt: state?.lastCursor ? state.cycleStartedAt : Date.now(),
  });

  return { rolesSynced, connectionsRefreshed, epicNamesUpdated, errors, cycleReset: cycleComplete };
}

export async function GET(req: NextRequest) {
  try {
    const secret = process.env.CRON_SECRET;
    if (secret) {
      const auth = req.headers.get('authorization') || '';
      if (auth !== `Bearer ${secret}`) {
        return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });
      }
    } else if (process.env.NODE_ENV !== 'development') {
      return NextResponse.json({ error: 'CRON_SECRET non configuré' }, { status: 500 });
    }

    const db = getAdminDb();

    const expired = await expireInvitations(db);
    const departures = await processExpiredDepartures(db);
    const discordSync = await processNightlyDiscordSync(db);
    // Passe 4 (2026-05-27) : sync rang Valorant via HenrikDev pour les users
    // avec 'valorant' in games + Riot Discord connection. Cursor-paginé,
    // 50 users/run (rate limit HenrikDev). Voir lib/valorant-sync.ts.
    const valorantRankSync = await syncValorantRanksBatch(db);

    return NextResponse.json({
      ok: true,
      expired,
      cutoffDays: EXPIRY_DAYS,
      coFounderDepartures: departures,
      discordSync,
      valorantRankSync,
    });
  } catch (err) {
    captureApiError('API cron expire-invitations error', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
