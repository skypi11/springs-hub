import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth, isCompetitionAdmin } from '@/lib/firebase-admin';
import { captureApiError } from '@/lib/sentry';
import { limiters, rateLimitKey, checkRateLimit } from '@/lib/rate-limit';
import { describeGuildAccess } from '@/lib/discord-competition';
import { getGuildChannels, getGuildRoles } from '@/lib/discord-bot';

// Inspection d'un serveur Discord depuis le formulaire de compétition :
// « ce serveur est-il utilisable, et par toi ? », plus les rôles et salons à
// proposer dans les listes.
//
// GARDE-FOU CENTRAL : seul le propriétaire ou un administrateur DU SERVEUR
// peut le désigner. Sans cette vérification, n'importe quel identifiant de
// serveur où le bot est présent était acceptable — on pouvait faire créer des
// rôles et des salons sur le Discord d'une autre structure. La même
// vérification garde l'enregistrement et le provisioning : celle-ci ne sert
// qu'à l'affichage.

const SNOWFLAKE = /^\d{17,20}$/;

export async function POST(req: NextRequest) {
  try {
    const uid = await verifyAuth(req);
    if (!uid) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
    // Admins de compétition inclus : sans cette inspection, impossible pour eux
    // de choisir un salon d'annonces ou un rôle staff — la configuration Discord
    // d'un tournoi qu'ils viennent de créer serait inutilisable. La règle de
    // fond ne change pas d'un iota : `describeGuildAccess` exige toujours d'être
    // propriétaire ou administrateur DU SERVEUR désigné.
    if (!(await isCompetitionAdmin(uid))) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });

    const blocked = await checkRateLimit(limiters.admin, rateLimitKey(req, uid));
    if (blocked) return blocked;

    const body = await req.json();
    const guildId = typeof body.guildId === 'string' ? body.guildId.trim() : '';
    if (!SNOWFLAKE.test(guildId)) {
      return NextResponse.json({ error: 'Identifiant de serveur invalide.' }, { status: 400 });
    }

    // L'uid Aedral porte le snowflake Discord : `discord_<snowflake>`.
    const discordUserId = uid.startsWith('discord_') ? uid.slice('discord_'.length) : '';
    if (!SNOWFLAKE.test(discordUserId)) {
      return NextResponse.json(
        { error: 'Ton compte Aedral n’est pas lié à Discord : impossible de vérifier tes droits sur ce serveur.' },
        { status: 400 },
      );
    }

    const access = await describeGuildAccess(guildId, discordUserId);

    // Rôles et salons : seulement si l'accès est légitime — pas question de
    // servir la cartographie d'un serveur qu'on n'administre pas.
    let roles: Array<{ id: string; name: string }> = [];
    let channels: Array<{ id: string; name: string; category: string }> = [];
    if (access.userManages) {
      const [r, c] = await Promise.all([
        getGuildRoles(guildId).catch(() => []),
        getGuildChannels(guildId).catch(() => []),
      ]);
      roles = r.map(role => ({ id: role.id, name: role.name }));
      channels = c.map(ch => ({ id: ch.id, name: ch.name, category: ch.parentName ?? '—' }));
    }

    return NextResponse.json({ access, roles, channels });
  } catch (err) {
    captureApiError('API Admin/Competitions/DiscordGuild POST error', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
