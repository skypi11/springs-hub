import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb, verifyAuth } from '@/lib/firebase-admin';
import { captureApiError } from '@/lib/sentry';
import { resolveUserContext } from '@/lib/event-context';
import { isStaffOfTeam } from '@/lib/event-permissions';

// GET /api/debug/todo-discord?todoId=XXX
// Route de diagnostic : prend un todoId, reproduit exactement la chaîne de décisions
// que fait le fan-out Discord à la création, et renvoie un rapport détaillé —
// SANS poster (on vérifie juste la joignabilité via des GET).
//
// Utile quand un devoir créé n'a déclenché ni embed channel ni DM : on sait
// précisément quelle étape a pété.
//
// Réservé au staff de l'équipe (même permission que voir le devoir).

const DISCORD_API = 'https://discord.com/api/v10';

interface DiagStep {
  step: string;
  ok: boolean;
  detail: string;
}

function toDiscordId(uid: string): string | null {
  if (!uid.startsWith('discord_')) return null;
  const id = uid.slice('discord_'.length);
  return /^\d{5,32}$/.test(id) ? id : null;
}

async function checkBotReachable(token: string): Promise<DiagStep> {
  try {
    const res = await fetch(`${DISCORD_API}/users/@me`, {
      headers: { Authorization: `Bot ${token}` },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      return { step: 'bot_auth', ok: false, detail: `HTTP ${res.status}: ${body.slice(0, 150)}` };
    }
    const data = await res.json();
    return { step: 'bot_auth', ok: true, detail: `Bot ${data.username ?? '?'}#${data.discriminator ?? '0000'} actif` };
  } catch (e) {
    return { step: 'bot_auth', ok: false, detail: e instanceof Error ? e.message : 'fetch failed' };
  }
}

async function checkChannelReachable(token: string, channelId: string): Promise<DiagStep> {
  try {
    const res = await fetch(`${DISCORD_API}/channels/${channelId}`, {
      headers: { Authorization: `Bot ${token}` },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      // 403 = pas les perms ; 404 = channel inconnu / bot pas dans le serveur
      return { step: 'channel_get', ok: false, detail: `HTTP ${res.status}: ${body.slice(0, 150)}` };
    }
    const data = await res.json();
    return { step: 'channel_get', ok: true, detail: `#${data.name ?? '?'} (type=${data.type})` };
  } catch (e) {
    return { step: 'channel_get', ok: false, detail: e instanceof Error ? e.message : 'fetch failed' };
  }
}

async function checkDmOpenable(token: string, discordId: string): Promise<DiagStep> {
  try {
    const res = await fetch(`${DISCORD_API}/users/@me/channels`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bot ${token}` },
      body: JSON.stringify({ recipient_id: discordId }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      return { step: `dm_open_${discordId}`, ok: false, detail: `HTTP ${res.status}: ${body.slice(0, 150)}` };
    }
    // L'endpoint renvoie un DM channel même si le user bloque les DMs —
    // le vrai blocage se produit au POST. On fait donc un 2e test : POST un message minimal… non,
    // ça enverrait réellement. On se contente du dm_open.
    return { step: `dm_open_${discordId}`, ok: true, detail: 'DM channel ouvrable (POST réel à tester via création de devoir)' };
  } catch (e) {
    return { step: `dm_open_${discordId}`, ok: false, detail: e instanceof Error ? e.message : 'fetch failed' };
  }
}

export async function GET(req: NextRequest) {
  try {
    const uid = await verifyAuth(req);
    if (!uid) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

    const todoId = req.nextUrl.searchParams.get('todoId');
    if (!todoId) return NextResponse.json({ error: 'todoId requis (?todoId=...)' }, { status: 400 });

    const db = getAdminDb();
    const todoSnap = await db.collection('structure_todos').doc(todoId).get();
    if (!todoSnap.exists) return NextResponse.json({ error: 'Devoir introuvable' }, { status: 404 });
    const todo = todoSnap.data()!;

    const structureId = todo.structureId as string;
    const subTeamId = todo.subTeamId as string;

    const resolved = await resolveUserContext(db, uid, structureId);
    if (!resolved) return NextResponse.json({ error: 'Structure inaccessible' }, { status: 403 });
    if (!isStaffOfTeam(resolved.context, subTeamId)) {
      return NextResponse.json({ error: 'Permissions insuffisantes (staff de l\'équipe requis)' }, { status: 403 });
    }

    const team = resolved.teams.find(t => t.id === subTeamId);
    const teamChannelId = team ? (team as { discordChannelId?: string }).discordChannelId : undefined;
    const assigneeId = todo.assigneeId as string;
    const assigneeDid = toDiscordId(assigneeId);

    const steps: DiagStep[] = [];
    const token = process.env.DISCORD_BOT_TOKEN;

    steps.push({
      step: 'env_DISCORD_BOT_TOKEN',
      ok: !!token,
      detail: token ? `présent (${token.length} chars)` : 'MANQUANT — à ajouter dans Vercel env vars',
    });

    steps.push({
      step: 'team_found',
      ok: !!team,
      detail: team ? `team ${team.id} (${(team as { name?: string }).name ?? '?'})` : `team ${subTeamId} introuvable dans resolved.teams`,
    });

    steps.push({
      step: 'team_discordChannelId',
      ok: !!teamChannelId,
      detail: teamChannelId ? `channel ${teamChannelId}` : 'aucun channel Discord lié à cette équipe — va dans les réglages team',
    });

    steps.push({
      step: 'assignee_discord_id',
      ok: !!assigneeDid,
      detail: assigneeDid
        ? `snowflake ${assigneeDid} extrait de ${assigneeId}`
        : `uid ${assigneeId} ne matche pas "discord_SNOWFLAKE"`,
    });

    if (token) {
      steps.push(await checkBotReachable(token));
      if (teamChannelId) {
        steps.push(await checkChannelReachable(token, teamChannelId));
      }
      if (assigneeDid) {
        steps.push(await checkDmOpenable(token, assigneeDid));
      }
    }

    // Conclusion : explique en clair ce qui se serait passé à la création.
    const hasToken = steps.find(s => s.step === 'env_DISCORD_BOT_TOKEN')?.ok;
    const hasChannel = steps.find(s => s.step === 'team_discordChannelId')?.ok;
    const channelOk = steps.find(s => s.step === 'channel_get')?.ok;
    const hasDid = steps.find(s => s.step === 'assignee_discord_id')?.ok;

    const expected: string[] = [];
    if (!hasToken) {
      expected.push('❌ Aucun envoi possible — DISCORD_BOT_TOKEN absent.');
    } else {
      if (hasChannel && channelOk) expected.push('✅ Embed dans le channel team aurait été posté.');
      else if (hasChannel && !channelOk) expected.push('❌ Channel configuré mais injoignable par le bot (pas ajouté au serveur ? perms manquantes ?).');
      else expected.push('⚠️ Pas de channel Discord sur l\'équipe — aucun embed posté (mais ce n\'est pas un bug, c\'est de la config).');

      if (hasDid) expected.push('✅ DM tenté à l\'assigné (réel résultat dépend des prefs DMs du user).');
      else expected.push('⚠️ Assignee sans discord_id — aucun DM.');
    }

    return NextResponse.json({
      todo: {
        id: todoId,
        structureId,
        subTeamId,
        assigneeId,
        title: todo.title,
        createdAt: todo.createdAt?.toMillis?.() ?? null,
      },
      steps,
      expected,
    });
  } catch (err) {
    captureApiError('API debug/todo-discord error', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
