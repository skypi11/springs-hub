import { NextRequest, NextResponse } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { getAdminDb } from '@/lib/firebase-admin';
import { createNotifications, type NotificationPayload } from '@/lib/notifications';
import { sendTodoDM } from '@/lib/discord-bot';
import { TODO_TYPE_META, type TodoType } from '@/lib/todos';
import { captureApiError } from '@/lib/sentry';

// GET /api/cron/todos-reminders
// Vercel Cron 1x/jour (Hobby plan impose 1 run/jour max). Pour chaque devoir !done :
//   - entre ~12h et ~36h avant deadlineAt : envoie un rappel J-1 (notif in-app + DM Discord best-effort)
//     idempotent via reminder24hSentAt sur le doc.
//   - deadlineAt dépassé : envoie une alerte "retard" une seule fois (overdueAlertSentAt).
//
// Fenêtre 12-36h plutôt que 23-25h : comme on ne tourne qu'une fois par jour, il faut couvrir
// l'intervalle complet entre deux runs consécutifs, sinon on louperait les devoirs dont la deadline
// tombe en dehors d'une fenêtre étroite.
//
// Sécu : header `Authorization: Bearer $CRON_SECRET` attendu en prod ;
// en dev on laisse passer pour tester à la main.

const MS_HOUR = 60 * 60 * 1000;
const REMINDER_WINDOW_MIN_MS = 12 * MS_HOUR;
const REMINDER_WINDOW_MAX_MS = 36 * MS_HOUR;
// On ignore les devoirs dont la deadline est > 90 jours dans le futur ou > 90 jours dans le passé
// (évite de charger des docs "zombies" non nettoyés).
const SCAN_FUTURE_LIMIT_MS = 90 * 24 * MS_HOUR;
const SCAN_PAST_LIMIT_MS = 90 * 24 * MS_HOUR;

function toDiscordId(uid: string): string | null {
  if (!uid.startsWith('discord_')) return null;
  const id = uid.slice('discord_'.length);
  return /^\d{5,32}$/.test(id) ? id : null;
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
    const now = Date.now();

    // On scanne tous les devoirs !done avec une deadlineAt dans la fenêtre d'intérêt.
    // Sans index composite dédié, on balaye par `done=false` et on filtre en mémoire sur deadlineAt
    // (une limite défensive à 1000 docs protège contre un runaway). Si le volume explose plus tard,
    // on ajoutera un index structure_todos(done,deadlineAt) pour trier par deadlineAt croissant.
    const snap = await db.collection('structure_todos')
      .where('done', '==', false)
      .limit(1000)
      .get();

    const remindersToSend: Array<{ docId: string; data: FirebaseFirestore.DocumentData }> = [];
    const overdueToAlert: Array<{ docId: string; data: FirebaseFirestore.DocumentData }> = [];

    for (const doc of snap.docs) {
      const d = doc.data();
      const deadlineAt = typeof d.deadlineAt === 'number' ? d.deadlineAt : null;
      if (deadlineAt === null) continue;
      if (deadlineAt > now + SCAN_FUTURE_LIMIT_MS) continue;
      if (deadlineAt < now - SCAN_PAST_LIMIT_MS) continue;

      const delta = deadlineAt - now;

      // Rappel J-1 : 23h ≤ delta ≤ 25h et pas encore envoyé.
      if (delta >= REMINDER_WINDOW_MIN_MS && delta <= REMINDER_WINDOW_MAX_MS && !d.reminder24hSentAt) {
        remindersToSend.push({ docId: doc.id, data: d });
        continue;
      }
      // Alerte retard : deadlineAt dépassée et pas encore alerté.
      if (delta < 0 && !d.overdueAlertSentAt) {
        overdueToAlert.push({ docId: doc.id, data: d });
      }
    }

    const notifs: NotificationPayload[] = [];
    const batch = db.batch();
    let remindersCount = 0;
    let overdueCount = 0;
    const dmTasks: Array<Promise<unknown>> = [];

    // --- Rappels J-1 ---
    for (const { docId, data } of remindersToSend) {
      const assigneeId = data.assigneeId as string | undefined;
      if (!assigneeId) continue;

      const type = (data.type as TodoType | undefined) ?? 'free';
      const typeLabel = TODO_TYPE_META[type]?.short ?? 'Devoir';
      const title = (data.title as string | undefined) ?? 'Devoir';
      const deadline = (data.deadline as string | null) ?? null;
      const deadlineAtMs = (data.deadlineAt as number | undefined) ?? null;

      notifs.push({
        userId: assigneeId,
        type: 'todo_reminder',
        title: `Rappel : devoir à rendre bientôt (${typeLabel})`,
        message: `« ${title} » — deadline dans environ 24h${deadline ? ` (${deadline})` : ''}.`,
        link: '/calendar',
        metadata: { todoId: docId, deadline },
      });

      // DM Discord best-effort.
      const did = toDiscordId(assigneeId);
      if (did) {
        dmTasks.push(sendTodoDM(did, {
          title: `⏰ Rappel : ${title}`,
          type,
          description: 'À rendre dans environ 24h.',
          deadlineAtMs,
          deadlineYmd: deadline,
          siteTodoUrl: null,
          structureName: null,
          teamName: null,
          thumbnailUrl: null,
          authorIconUrl: null,
          pingUserIds: [],
        }).catch(() => null));
      }

      batch.update(db.collection('structure_todos').doc(docId), {
        reminder24hSentAt: FieldValue.serverTimestamp(),
      });
      remindersCount++;
    }

    // --- Alertes retard ---
    for (const { docId, data } of overdueToAlert) {
      const assigneeId = data.assigneeId as string | undefined;
      if (!assigneeId) continue;

      const type = (data.type as TodoType | undefined) ?? 'free';
      const typeLabel = TODO_TYPE_META[type]?.short ?? 'Devoir';
      const title = (data.title as string | undefined) ?? 'Devoir';
      const deadline = (data.deadline as string | null) ?? null;
      const deadlineAtMs = (data.deadlineAt as number | undefined) ?? null;

      notifs.push({
        userId: assigneeId,
        type: 'todo_overdue',
        title: `Devoir en retard (${typeLabel})`,
        message: `« ${title} » a dépassé sa deadline${deadline ? ` du ${deadline}` : ''}.`,
        link: '/calendar',
        metadata: { todoId: docId, deadline },
      });

      const did = toDiscordId(assigneeId);
      if (did) {
        dmTasks.push(sendTodoDM(did, {
          title: `🔴 En retard : ${title}`,
          type,
          description: 'La deadline est dépassée — merci de valider dès que possible.',
          deadlineAtMs,
          deadlineYmd: deadline,
          siteTodoUrl: null,
          structureName: null,
          teamName: null,
          thumbnailUrl: null,
          authorIconUrl: null,
          pingUserIds: [],
        }).catch(() => null));
      }

      batch.update(db.collection('structure_todos').doc(docId), {
        overdueAlertSentAt: FieldValue.serverTimestamp(),
      });
      overdueCount++;
    }

    // Commit tout d'un coup — idempotent : si le cron re-tourne 2x à la même heure,
    // la 2e passe trouve reminder24hSentAt déjà set et skip.
    if (remindersCount + overdueCount > 0) {
      await batch.commit();
      await createNotifications(db, notifs);
    }
    // Les DMs s'exécutent en parallèle — on les attend avant de renvoyer pour que Vercel
    // ne coupe pas la fonction trop tôt (Promise.all tolère les throws grâce au .catch).
    await Promise.all(dmTasks);

    return NextResponse.json({
      ok: true,
      scanned: snap.size,
      reminders: remindersCount,
      overdue: overdueCount,
    });
  } catch (err) {
    captureApiError('API cron todos-reminders error', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
