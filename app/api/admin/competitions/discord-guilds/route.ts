import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth, isCompetitionAdmin } from '@/lib/firebase-admin';
import { captureApiError } from '@/lib/sentry';
import { limiters, rateLimitKey, checkRateLimit } from '@/lib/rate-limit';
import { discordFetch } from '@/lib/discord-competition';
import { discordIdOfUid } from '@/lib/competitions/discord-guard';

// GET /api/admin/competitions/discord-guilds
// Les serveurs qu'on peut désigner pour une compétition : ceux où le bot est
// présent ET dont on est propriétaire ou administrateur.
//
// Sans cette liste, il fallait aller chercher l'identifiant du serveur dans
// Discord (mode développeur) et le recopier à la main — pour une information que
// le bot connaît déjà.
//
// La règle d'accès est la MÊME que partout ailleurs (guildBlocker, provisioning) :
// on ne peut pas faire créer des salons sur le Discord d'une autre structure.
// Ici elle sert à filtrer l'affichage ; l'enregistrement la rejoue.

// Pas de littéral BigInt : la cible de compilation est sous ES2020 (piège
// documenté du projet). ADMINISTRATOR = 1 << 3.
const PERM_ADMINISTRATOR = BigInt(1 << 3);
/** Le bot est sur une poignée de serveurs ; ce cap borne le coût de la page. */
const MAX_GUILDS = 50;

interface BotGuild { id: string; name: string; owner?: boolean; permissions?: string }

export async function GET(req: NextRequest) {
  try {
    const uid = await verifyAuth(req);
    if (!uid) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
    // Admins de compétition inclus : ce sont eux qui créent les tournois, donc
    // eux qui choisissent le serveur. Sans cette liste ils devaient recopier un
    // identifiant à la main — précisément la friction qu'elle supprime.
    if (!(await isCompetitionAdmin(uid))) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });

    const blocked = await checkRateLimit(limiters.admin, rateLimitKey(req, uid));
    if (blocked) return blocked;

    const discordUserId = discordIdOfUid(uid);
    if (!discordUserId) {
      return NextResponse.json({ error: 'Ton compte n\'est pas lié à Discord.' }, { status: 400 });
    }

    const res = await discordFetch(`/users/@me/guilds?limit=${MAX_GUILDS}`);
    if (!res.ok) {
      return NextResponse.json(
        { error: 'Discord est injoignable pour le moment — réessaie, ou saisis l\'identifiant du serveur.' },
        { status: 503 },
      );
    }
    const botGuilds = await res.json() as BotGuild[];

    // Pour chaque serveur du bot : suis-je propriétaire, ou porteur d'un rôle
    // Administrator ? Deux lectures par serveur, bornées par MAX_GUILDS.
    const guilds: Array<{ id: string; name: string }> = [];
    for (const g of botGuilds) {
      const detail = await discordFetch(`/guilds/${g.id}`);
      if (!detail.ok) continue;
      const full = await detail.json() as { name?: string; owner_id?: string };
      if (full.owner_id === discordUserId) {
        guilds.push({ id: g.id, name: full.name ?? g.name });
        continue;
      }
      const memberRes = await discordFetch(`/guilds/${g.id}/members/${discordUserId}`);
      if (!memberRes.ok) continue;                       // pas membre : suivant
      const member = await memberRes.json() as { roles?: string[] };
      const rolesRes = await discordFetch(`/guilds/${g.id}/roles`);
      if (!rolesRes.ok) continue;
      const roles = await rolesRes.json() as Array<{ id: string; permissions?: string }>;
      const byId = new Map(roles.map(r => [r.id, r.permissions]));
      const isAdministrator = (member.roles ?? []).some(rid => {
        try {
          return (BigInt(byId.get(rid) ?? '0') & PERM_ADMINISTRATOR) === PERM_ADMINISTRATOR;
        } catch { return false; }
      });
      if (isAdministrator) guilds.push({ id: g.id, name: full.name ?? g.name });
    }

    guilds.sort((a, b) => a.name.localeCompare(b.name, 'fr'));
    return NextResponse.json({ guilds });
  } catch (err) {
    captureApiError('API Admin/Competitions/DiscordGuilds GET error', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
