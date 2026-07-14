import { NextRequest, NextResponse } from 'next/server';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { getAdminDb, verifyAuth } from '@/lib/firebase-admin';
import { captureApiError } from '@/lib/sentry';
import { limiters, rateLimitKey, checkRateLimit } from '@/lib/rate-limit';
import { isDirigeant, isResponsable, isResponsableForGame } from '@/lib/structure-permissions';
import { remindTeamAvailability, type ReminderTeam } from '@/lib/availability-reminder-server';
import { currentWeekTarget } from '@/lib/availability-reminder';
import { parisYmd } from '@/lib/availability';

// POST /api/structures/[id]/availability-reminder { teamId }
// Relance MANUELLE du staff : poste dans le salon d'équipe un rappel aux
// joueurs sans dispo pour la SEMAINE EN COURS (usage type : lundi/mardi, tout
// le monde n'a pas rempli). Gratuit pour toujours (≠ rappel auto gate-ready).
// Droits : dirigeant, responsable du jeu de l'équipe, ou manager de l'équipe.
// Cooldown 2 h par équipe pour éviter le ping-storm (double-clic, spam).

const COOLDOWN_MS = 2 * 60 * 60 * 1000;

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const uid = await verifyAuth(req);
    if (!uid) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
    const blocked = await checkRateLimit(limiters.write, rateLimitKey(req, uid));
    if (blocked) return blocked;

    const { id: structureId } = await params;
    const body = await req.json().catch(() => ({}));
    const teamId = typeof body.teamId === 'string' ? body.teamId : '';
    if (!teamId) return NextResponse.json({ error: 'Équipe manquante.' }, { status: 400 });

    const db = getAdminDb();
    const [structSnap, teamSnap] = await Promise.all([
      db.collection('structures').doc(structureId).get(),
      db.collection('sub_teams').doc(teamId).get(),
    ]);
    if (!structSnap.exists || !teamSnap.exists || teamSnap.data()!.structureId !== structureId) {
      return NextResponse.json({ error: 'Équipe introuvable.' }, { status: 404 });
    }
    const t = teamSnap.data()!;
    const structData = structSnap.data()!;
    // Structure suspendue / en suppression : aucune action de relance (cohérence
    // avec le reste du calendrier, review).
    if (['suspended', 'deletion_scheduled', 'pending_validation'].includes((structData.status as string) ?? '')) {
      return NextResponse.json({ error: 'Structure non active.' }, { status: 409 });
    }
    const ctx = { uid, structure: structData as never };

    // Droits : dirigeant OU responsable du jeu OU manager de cette équipe.
    let allowed = isDirigeant(ctx);
    if (!allowed && isResponsable(ctx) && isResponsableForGame(ctx, (t.game as string) ?? '')) allowed = true;
    if (!allowed) {
      allowed = Array.isArray(t.staffIds) && (t.staffIds as string[]).includes(uid)
        && ((t.staffRoles as Record<string, string> | undefined)?.[uid] ?? 'coach') === 'manager';
    }
    if (!allowed) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });

    if (!t.discordChannelId) {
      return NextResponse.json({ error: 'Cette équipe n\'a pas de salon Discord configuré.' }, { status: 409 });
    }

    // Cooldown anti-spam ATOMIQUE (review Lot dispos) : la réservation est posée
    // DANS une transaction AVANT le post — un double-clic ou deux membres du
    // staff simultanés ne peuvent pas passer le check tous les deux et
    // double-pinger le salon. La réservation est libérée plus bas si rien n'est
    // finalement envoyé (tout rempli / échec du post).
    let waitMin = 0;
    const claimed = await db.runTransaction(async tx => {
      const fresh = await tx.get(teamSnap.ref);
      const last = (fresh.data()?.lastAvailabilityReminderAt as Timestamp | undefined)?.toMillis?.() ?? 0;
      const elapsed = Date.now() - last;
      if (elapsed < COOLDOWN_MS) { waitMin = Math.ceil((COOLDOWN_MS - elapsed) / 60_000); return false; }
      tx.update(teamSnap.ref, { lastAvailabilityReminderAt: FieldValue.serverTimestamp() });
      return true;
    });
    if (!claimed) {
      return NextResponse.json({ error: `Relance déjà envoyée récemment — réessaie dans ${waitMin} min.` }, { status: 429 });
    }

    const target = currentWeekTarget(parisYmd(new Date()));
    const team: ReminderTeam = {
      id: teamId,
      structureId,
      name: (t.name as string) ?? 'Équipe',
      game: (t.game as string) ?? '',
      logoUrl: (t.logoUrl as string) ?? null,
      discordChannelId: t.discordChannelId as string,
      playerIds: Array.isArray(t.playerIds) ? (t.playerIds as string[]) : [],
      subIds: Array.isArray(t.subIds) ? (t.subIds as string[]) : [],
    };

    const res = await remindTeamAvailability(db, team, {
      weekId: target.weekId, weekLabel: target.weekLabel, origin: req.nextUrl.origin,
    });

    if (res.posted) {
      // La réservation du cooldown est déjà posée (transaction ci-dessus).
      return NextResponse.json({ ok: true, missingCount: res.missingCount });
    }
    // Rien envoyé (tout rempli / échec) → on LIBÈRE la réservation pour ne pas
    // bloquer inutilement le staff 2 h alors qu'aucun message n'est parti.
    await teamSnap.ref.update({ lastAvailabilityReminderAt: FieldValue.delete() }).catch(() => {});
    const messages: Record<string, string> = {
      all_filled: 'Tous les joueurs ont déjà rempli leurs dispos de la semaine — rien à envoyer.',
      empty_roster: 'Cette équipe n\'a pas encore de joueurs.',
      no_channel: 'Cette équipe n\'a pas de salon Discord configuré.',
      post_failed: 'Le message n\'a pas pu être posté (le bot est-il bien dans le salon ?).',
    };
    const status = res.reason === 'post_failed' ? 502 : 409;
    return NextResponse.json({ ok: false, reason: res.reason, error: messages[res.reason] }, { status });
  } catch (err) {
    captureApiError('API Structures/AvailabilityReminder POST error', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
