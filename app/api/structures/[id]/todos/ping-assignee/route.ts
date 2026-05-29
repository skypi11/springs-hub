import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb, verifyAuth } from '@/lib/firebase-admin';
import { captureApiError } from '@/lib/sentry';
import { limiters, rateLimitKey, checkRateLimit } from '@/lib/rate-limit';
import { resolveUserContext } from '@/lib/event-context';
import { resolveStructureId } from '@/lib/resolve-structure-id';
import { isStaffOfTeam, isDirigeant } from '@/lib/event-permissions';
import { endOfDayParisMs } from '@/lib/todos';
import { sendTodoDM } from '@/lib/discord-bot';

// POST /api/structures/[id]/todos/ping-assignee
// Body : { assigneeId }
//
// Envoie un DM Discord au joueur via le bot Aedral, listant ses exos en retard
// pour cette structure. Action déclenchée par un staff depuis le panel "À relancer".
//
// Permissions : staff de l'équipe d'au moins UN exo en retard du joueur OU dirigeant.
// (Sinon un coach d'une équipe X pourrait ping un joueur pour un exo d'une équipe Y).
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const uid = await verifyAuth(req);
    if (!uid) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

    const blocked = await checkRateLimit(limiters.write, rateLimitKey(req, uid));
    if (blocked) return blocked;

    const { id: slugOrId } = await params;
    const db = getAdminDb();
    const structureId = await resolveStructureId(slugOrId, db);
    if (!structureId) {
      return NextResponse.json({ error: 'Structure introuvable' }, { status: 404 });
    }

    const resolved = await resolveUserContext(db, uid, structureId);
    if (!resolved) {
      return NextResponse.json({ error: 'Structure introuvable ou inaccessible' }, { status: 404 });
    }

    const body = await req.json().catch(() => ({}));
    const assigneeId = typeof body?.assigneeId === 'string' ? body.assigneeId.trim() : '';
    if (!assigneeId) {
      return NextResponse.json({ error: 'assigneeId manquant.' }, { status: 400 });
    }
    if (!assigneeId.startsWith('discord_')) {
      return NextResponse.json({ error: 'Format assigneeId invalide.' }, { status: 400 });
    }
    const discordId = assigneeId.slice('discord_'.length);
    if (!/^\d{15,32}$/.test(discordId)) {
      return NextResponse.json({ error: 'Discord ID invalide.' }, { status: 400 });
    }

    // Récupère les exos en retard de cet assignee dans la structure
    const now = Date.now();
    const snap = await db.collection('structure_todos')
      .where('structureId', '==', structureId)
      .where('assigneeId', '==', assigneeId)
      .where('done', '==', false)
      .limit(50)
      .get();

    if (snap.empty) {
      return NextResponse.json({ error: 'Ce joueur n\'a aucun exercice en cours dans cette structure.' }, { status: 400 });
    }

    type OverdueItem = { todoId: string; subTeamId: string; title: string; deadlineAt: number; deadline: string | null };
    const overdue: OverdueItem[] = [];
    for (const doc of snap.docs) {
      const d = doc.data();
      const deadline = (d.deadline as string | null) ?? null;
      const deadlineAt = typeof d.deadlineAt === 'number'
        ? d.deadlineAt
        : (deadline ? endOfDayParisMs(deadline) : null);
      if (deadlineAt === null || deadlineAt >= now) continue;
      overdue.push({
        todoId: doc.id,
        subTeamId: d.subTeamId as string,
        title: (d.title as string | undefined) ?? '(sans titre)',
        deadlineAt,
        deadline,
      });
    }

    if (overdue.length === 0) {
      return NextResponse.json({ error: 'Ce joueur n\'a aucun exercice en retard.' }, { status: 400 });
    }

    // Permission : dirigeant OU staff d'au moins une équipe concernée
    const dirigeant = isDirigeant(resolved.context);
    if (!dirigeant) {
      const hasAccess = overdue.some(o => isStaffOfTeam(resolved.context, o.subTeamId));
      if (!hasAccess) {
        return NextResponse.json({ error: 'Permissions insuffisantes, tu n\'as pas accès à ces équipes.' }, { status: 403 });
      }
    }

    // Tri par retard décroissant (le plus vieux d'abord)
    overdue.sort((a, b) => a.deadlineAt - b.deadlineAt);

    // Récupère le pseudo du caller (pour le "Relancé par ...")
    let callerName: string | null = null;
    try {
      const callerSnap = await db.collection('users').doc(uid).get();
      const cu = callerSnap.data();
      if (cu) {
        callerName = (cu.displayName as string | undefined) ?? (cu.discordUsername as string | undefined) ?? null;
      }
    } catch { /* ignore */ }

    // Construit l'embed récap : "⏰ Rappel : tu as N exos en retard"
    // Réutilise sendTodoDM avec un TodoEmbedInput "synthétique"
    const lines = overdue.slice(0, 10).map((o, i) => {
      const days = Math.max(1, Math.round((now - o.deadlineAt) / 86400000));
      return `**${i + 1}.** ${o.title}, *en retard de ${days} j*`;
    });
    if (overdue.length > 10) {
      lines.push(`… et ${overdue.length - 10} autre${overdue.length - 10 > 1 ? 's' : ''}`);
    }

    const origin = req.nextUrl.origin;
    const siteUrl = `${origin}/calendar`;

    // Le bot a déjà une fonction sendTodoDM qui ouvre un DM et poste un embed
    // typé "todo". On la réutilise en faisant passer un "exo récap" synthétique.
    const res = await sendTodoDM(discordId, {
      title: `⏰ Tu as ${overdue.length} exercice${overdue.length > 1 ? 's' : ''} en retard`,
      type: 'free',
      description: lines.join('\n').slice(0, 1900),
      deadlineAtMs: null,
      deadlineYmd: null,
      teamName: null,
      structureName: null,
      createdByName: callerName ? `Relance de ${callerName}` : 'Relance staff',
      siteTodoUrl: siteUrl,
      thumbnailUrl: null,
      authorIconUrl: null,
      pingUserIds: [],
    });

    if (!res.ok) {
      // 403 = user a désactivé les DMs du bot
      const friendly = res.reason.includes('403') || res.reason.includes('dm_open')
        ? 'Le joueur a désactivé les DMs du bot Aedral (ou aucun serveur en commun).'
        : 'Discord a refusé l\'envoi.';
      return NextResponse.json({ error: friendly, debug: res.reason }, { status: 502 });
    }

    return NextResponse.json({
      success: true,
      overdueCount: overdue.length,
      messageId: res.messageId,
    });
  } catch (err) {
    captureApiError('API Structures/todos ping-assignee error', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
