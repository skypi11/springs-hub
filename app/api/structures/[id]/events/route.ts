import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb, verifyAuth } from '@/lib/firebase-admin';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { captureApiError } from '@/lib/sentry';
import { limiters, rateLimitKey, checkRateLimit } from '@/lib/rate-limit';
import { resolveUserContext } from '@/lib/event-context';
import { postEventEmbed } from '@/lib/discord-bot';
import {
  canAccessCalendar,
  canCreateEvent,
  validateEventTarget,
  getInvitedUserIds,
  isStaff,
  EVENT_TYPES,
  type EventTarget,
  type EventType,
} from '@/lib/event-permissions';

// Sérialise un timestamp Firestore en ISO pour le client.
function ts(v: unknown): string | null {
  if (!v) return null;
  if (typeof v === 'object' && v !== null && 'toDate' in v && typeof (v as { toDate: unknown }).toDate === 'function') {
    return (v as { toDate: () => Date }).toDate().toISOString();
  }
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'string') return v;
  return null;
}

// GET /api/structures/[id]/events — liste des événements + présences
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const uid = await verifyAuth(req);
    if (!uid) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

    const blocked = await checkRateLimit(limiters.read, rateLimitKey(req, uid));
    if (blocked) return blocked;

    const { id: structureId } = await params;
    const db = getAdminDb();

    const resolved = await resolveUserContext(db, uid, structureId);
    if (!resolved) {
      return NextResponse.json({ error: 'Structure introuvable ou inaccessible' }, { status: 404 });
    }
    if (!canAccessCalendar(resolved.context) && !isStaff(resolved.context)) {
      // Membres simples : on renvoie 403 pour la liste complète.
      // Ils ont accès à leurs invitations via /api/calendar/me.
      return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });
    }

    const snap = await db.collection('structure_events')
      .where('structureId', '==', structureId)
      .orderBy('startsAt', 'desc')
      .limit(200)
      .get();

    const eventIds = snap.docs.map(d => d.id);

    // Présences — chunks de 30 pour 'in'
    const presencesByEvent = new Map<string, Array<Record<string, unknown>>>();
    for (let i = 0; i < eventIds.length; i += 30) {
      const chunk = eventIds.slice(i, i + 30);
      if (chunk.length === 0) break;
      const pSnap = await db.collection('event_presences')
        .where('eventId', 'in', chunk)
        .get();
      for (const pDoc of pSnap.docs) {
        const p = pDoc.data();
        const eid = p.eventId as string;
        if (!presencesByEvent.has(eid)) presencesByEvent.set(eid, []);
        presencesByEvent.get(eid)!.push({
          id: pDoc.id,
          userId: p.userId,
          status: p.status,
          wasStructureMember: p.wasStructureMember ?? true,
          respondedAt: ts(p.respondedAt),
          updatedBy: p.updatedBy ?? null,
        });
      }
    }

    const events = snap.docs.map(doc => {
      const d = doc.data();
      return {
        id: doc.id,
        structureId: d.structureId,
        createdBy: d.createdBy,
        createdAt: ts(d.createdAt),
        updatedAt: ts(d.updatedAt),
        title: d.title,
        type: d.type,
        description: d.description ?? '',
        location: d.location ?? '',
        startsAt: ts(d.startsAt),
        endsAt: ts(d.endsAt),
        target: d.target,
        status: d.status,
        completedAt: ts(d.completedAt),
        completedBy: d.completedBy ?? null,
        cancelledAt: ts(d.cancelledAt),
        cancelledBy: d.cancelledBy ?? null,
        cancelReason: d.cancelReason ?? null,
        compteRendu: d.compteRendu ?? '',
        aTravailler: d.aTravailler ?? '',
        adversaire: d.adversaire ?? null,
        resultat: d.resultat ?? null,
        presences: presencesByEvent.get(doc.id) ?? [],
      };
    });

    return NextResponse.json({ events });
  } catch (err) {
    captureApiError('API Structures/events GET error', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}

const MAX_TITLE = 120;
const MAX_DESC = 2000;
const MAX_LOCATION = 200;
const MAX_EVENT_DURATION_MS = 7 * 24 * 60 * 60 * 1000; // 7 jours

// POST /api/structures/[id]/events — créer un événement
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const uid = await verifyAuth(req);
    if (!uid) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

    const blocked = await checkRateLimit(limiters.write, rateLimitKey(req, uid));
    if (blocked) return blocked;

    const { id: structureId } = await params;
    const db = getAdminDb();

    const resolved = await resolveUserContext(db, uid, structureId);
    if (!resolved) {
      return NextResponse.json({ error: 'Structure introuvable ou inaccessible' }, { status: 404 });
    }

    const body = await req.json();
    const {
      title,
      type,
      description,
      location,
      startsAt,
      endsAt,
      target,
      adversaire,
      resultat,
      markDoneImmediately,
    } = body as {
      title?: string;
      type?: EventType;
      description?: string;
      location?: string;
      startsAt?: string;
      endsAt?: string;
      target?: EventTarget;
      adversaire?: string;
      resultat?: string;
      markDoneImmediately?: boolean;
    };

    // Validation
    if (!title?.trim()) {
      return NextResponse.json({ error: 'Titre obligatoire.' }, { status: 400 });
    }
    if (title.length > MAX_TITLE) {
      return NextResponse.json({ error: `Titre trop long (max ${MAX_TITLE}).` }, { status: 400 });
    }
    if (!type || !EVENT_TYPES.includes(type)) {
      return NextResponse.json({ error: 'Type invalide.' }, { status: 400 });
    }
    if (description && description.length > MAX_DESC) {
      return NextResponse.json({ error: 'Description trop longue.' }, { status: 400 });
    }
    if (location && location.length > MAX_LOCATION) {
      return NextResponse.json({ error: 'Lieu trop long.' }, { status: 400 });
    }
    if (!startsAt || !endsAt) {
      return NextResponse.json({ error: 'Dates obligatoires.' }, { status: 400 });
    }
    const startMs = Date.parse(startsAt);
    const endMs = Date.parse(endsAt);
    if (Number.isNaN(startMs) || Number.isNaN(endMs)) {
      return NextResponse.json({ error: 'Dates invalides.' }, { status: 400 });
    }
    if (endMs <= startMs) {
      return NextResponse.json({ error: "La date de fin doit être après le début." }, { status: 400 });
    }
    if (endMs - startMs > MAX_EVENT_DURATION_MS) {
      return NextResponse.json({ error: 'Durée maximale : 7 jours.' }, { status: 400 });
    }
    if (!target) {
      return NextResponse.json({ error: 'Cible obligatoire.' }, { status: 400 });
    }
    const targetValidation = validateEventTarget(target);
    if (!targetValidation.ok) {
      return NextResponse.json({ error: targetValidation.error }, { status: 400 });
    }

    // Permissions
    if (!canCreateEvent(resolved.context, target, type)) {
      return NextResponse.json({ error: 'Permissions insuffisantes pour cette cible.' }, { status: 403 });
    }

    // Calculer les invités
    const membersSnap = await db.collection('structure_members')
      .where('structureId', '==', structureId)
      .get();
    const allMembers = membersSnap.docs.map(d => ({
      userId: d.data().userId as string,
      game: d.data().game as string | undefined,
    }));

    // Si feuille de match (target.userIds fournie), vérifier que chaque uid
    // sélectionné appartient bien au roster de l'équipe ciblée. Sinon 400 :
    // on refuse d'inviter quelqu'un qui n'est pas dans l'équipe.
    if (Array.isArray(target.userIds) && target.userIds.length > 0) {
      const rosterSet = new Set(
        getInvitedUserIds({ ...target, userIds: undefined }, allMembers, resolved.teams)
      );
      const unknown = target.userIds.filter(id => !rosterSet.has(id));
      if (unknown.length > 0) {
        return NextResponse.json(
          { error: 'Certains joueurs sélectionnés ne font pas partie de l\u2019équipe ciblée.' },
          { status: 400 },
        );
      }
    }

    const invitedUserIds = getInvitedUserIds(target, allMembers, resolved.teams);
    if (invitedUserIds.length === 0) {
      return NextResponse.json({ error: 'Aucun membre correspondant à la cible.' }, { status: 400 });
    }

    // Création atomique : event doc + une présence par invité
    const batch = db.batch();
    const eventRef = db.collection('structure_events').doc();

    const now = FieldValue.serverTimestamp();
    const startsTs = Timestamp.fromMillis(startMs);
    const endsTs = Timestamp.fromMillis(endMs);

    const isMatch = type === 'match' || type === 'scrim';
    const status = markDoneImmediately ? 'done' : 'scheduled';

    batch.set(eventRef, {
      structureId,
      createdBy: uid,
      createdAt: now,
      updatedAt: now,
      title: title.trim(),
      type,
      description: description?.trim() ?? '',
      location: location?.trim() ?? '',
      startsAt: startsTs,
      endsAt: endsTs,
      target,
      status,
      completedAt: markDoneImmediately ? now : null,
      completedBy: markDoneImmediately ? uid : null,
      cancelledAt: null,
      cancelledBy: null,
      cancelReason: null,
      compteRendu: '',
      aTravailler: '',
      adversaire: isMatch ? (adversaire?.trim() ?? null) : null,
      resultat: isMatch ? (resultat?.trim() ?? null) : null,
    });

    for (const userId of invitedUserIds) {
      const pRef = db.collection('event_presences').doc();
      batch.set(pRef, {
        eventId: eventRef.id,
        structureId,
        userId,
        status: 'pending',
        wasStructureMember: true,
        respondedAt: null,
        updatedBy: null,
        history: [],
      });
    }

    await batch.commit();

    // Notif Discord (best-effort) — ne bloque jamais la création d'event.
    // Les erreurs sont capturées pour Sentry mais n'affectent pas la réponse.
    // Fan-out :
    //   - scope=teams  → post dans chaque salon d'équipe configuré (Livraison A)
    //   - scope=structure → post dans le salon structure + ping rôle (Livraison B)
    //   - scope=game   → post dans le salon du jeu + ping rôle (Livraison B)
    (async () => {
      try {
        // Récupérer le displayName du créateur pour le footer de l'embed.
        let createdByName: string | null = null;
        try {
          const uSnap = await db.collection('users').doc(uid).get();
          const u = uSnap.data();
          createdByName = (u?.displayName as string | undefined) || (u?.discordUsername as string | undefined) || null;
        } catch { /* best-effort */ }

        const siteEventUrl = `${req.nextUrl.origin}/community/my-structure?event=${encodeURIComponent(eventRef.id)}`;
        const structureName = (resolved.structure as { name?: string }).name ?? null;
        const structureLogoUrl = (resolved.structure as { logoUrl?: string }).logoUrl ?? null;
        const integration = (resolved.structure as { discordIntegration?: {
          structureChannelId?: string | null;
          structureRoleId?: string | null;
          structureRoleName?: string | null;
          gameChannels?: Record<string, {
            channelId?: string | null;
            roleId?: string | null;
            roleName?: string | null;
          }>;
          staffChannelId?: string | null;
          staffRoleId?: string | null;
        } }).discordIntegration;

        // Helper pour persister un post Discord (pour edit/delete futurs).
        const recordPost = async (
          channelId: string,
          messageId: string,
          meta: { teamId?: string; scope: string; game?: string },
        ) => {
          await eventRef.collection('discord_posts').add({
            ...(meta.teamId ? { teamId: meta.teamId } : {}),
            scope: meta.scope,
            ...(meta.game ? { game: meta.game } : {}),
            channelId,
            messageId,
            postedAt: FieldValue.serverTimestamp(),
          });
        };

        if (target.scope === 'teams' && Array.isArray(target.teamIds) && target.teamIds.length > 0) {
          const teamsToPost = resolved.teams.filter(
            t => target.teamIds!.includes(t.id) && typeof (t as { discordChannelId?: unknown }).discordChannelId === 'string',
          );
          if (teamsToPost.length === 0) return;

          const invitedSet = new Set(invitedUserIds);

          // Extrait le snowflake Discord depuis un uid Springs (format `discord_ID`).
          const toDiscordId = (u: string): string | null => {
            if (!u.startsWith('discord_')) return null;
            const id = u.slice('discord_'.length);
            return /^\d{5,32}$/.test(id) ? id : null;
          };

          await Promise.all(teamsToPost.map(async team => {
            const channelId = (team as { discordChannelId?: string }).discordChannelId;
            if (!channelId) return;
            try {
              // Ping uniquement les uids invités ET membres de cette équipe
              // (titulaires + remplaçants + staff), pour que chaque salon d'équipe
              // ne ping que ses propres joueurs.
              const teamRoster = [
                ...((team as { playerIds?: string[] }).playerIds ?? []),
                ...((team as { subIds?: string[] }).subIds ?? []),
                ...((team as { staffIds?: string[] }).staffIds ?? []),
              ];
              const seen = new Set<string>();
              const pingUserIds: string[] = [];
              for (const u of teamRoster) {
                if (!u || seen.has(u)) continue;
                seen.add(u);
                if (!invitedSet.has(u)) continue;
                const did = toDiscordId(u);
                if (did) pingUserIds.push(did);
              }

              const teamLogoUrl = (team as { logoUrl?: string }).logoUrl || null;
              const thumbnailUrl = teamLogoUrl || structureLogoUrl;

              const messageId = await postEventEmbed(channelId, {
                title: title.trim(),
                type,
                description: description?.trim() ?? '',
                location: location?.trim() ?? '',
                startsAtMs: startMs,
                endsAtMs: endMs,
                teamName: (team as { name?: string }).name ?? null,
                structureName,
                createdByName,
                adversaire: isMatch ? (adversaire?.trim() ?? null) : null,
                resultat: isMatch && markDoneImmediately ? (resultat?.trim() ?? null) : null,
                siteEventUrl,
                thumbnailUrl,
                pingUserIds,
              });
              await recordPost(channelId, messageId, { teamId: team.id, scope: 'teams' });
            } catch (e) {
              captureApiError(`Discord post event failed (team=${team.id})`, e);
            }
          }));
          return;
        }

        // scope=structure → salon structure + rôle structure
        if (target.scope === 'structure' && integration?.structureChannelId) {
          try {
            const messageId = await postEventEmbed(integration.structureChannelId, {
              title: title.trim(),
              type,
              description: description?.trim() ?? '',
              location: location?.trim() ?? '',
              startsAtMs: startMs,
              endsAtMs: endMs,
              teamName: null,
              structureName,
              createdByName,
              adversaire: isMatch ? (adversaire?.trim() ?? null) : null,
              resultat: isMatch && markDoneImmediately ? (resultat?.trim() ?? null) : null,
              siteEventUrl,
              thumbnailUrl: structureLogoUrl,
              pingRoleId: integration.structureRoleId ?? null,
            });
            await recordPost(integration.structureChannelId, messageId, { scope: 'structure' });
          } catch (e) {
            captureApiError('Discord post event failed (scope=structure)', e);
          }
          return;
        }

        // scope=game → salon du jeu + rôle du jeu
        if (target.scope === 'game' && target.game) {
          const cfg = integration?.gameChannels?.[target.game];
          if (cfg?.channelId) {
            try {
              const messageId = await postEventEmbed(cfg.channelId, {
                title: title.trim(),
                type,
                description: description?.trim() ?? '',
                location: location?.trim() ?? '',
                startsAtMs: startMs,
                endsAtMs: endMs,
                teamName: null,
                structureName,
                createdByName,
                adversaire: isMatch ? (adversaire?.trim() ?? null) : null,
                resultat: isMatch && markDoneImmediately ? (resultat?.trim() ?? null) : null,
                siteEventUrl,
                thumbnailUrl: structureLogoUrl,
                pingRoleId: cfg.roleId ?? null,
              });
              await recordPost(cfg.channelId, messageId, { scope: 'game', game: target.game });
            } catch (e) {
              captureApiError(`Discord post event failed (scope=game, game=${target.game})`, e);
            }
          }
          return;
        }
      } catch (e) {
        captureApiError('Discord fan-out failed', e);
      }
    })();

    return NextResponse.json({ success: true, id: eventRef.id });
  } catch (err) {
    captureApiError('API Structures/events POST error', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
