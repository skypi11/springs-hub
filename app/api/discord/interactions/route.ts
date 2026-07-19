import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { captureApiError } from '@/lib/sentry';
import { limiters, checkRateLimit } from '@/lib/rate-limit';
import { verifyDiscordSignature } from '@/lib/discord-signature';
import { handleInteraction, type DiscordInteraction } from '@/lib/discord-interactions';
import { writePresence } from '@/lib/event-presence-server';

// node:crypto (Ed25519) + Firebase Admin SDK → runtime Node obligatoire.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// POST /api/discord/interactions
// Endpoint "Interactions Endpoint URL" de l'app Discord Aedral. Reçoit un POST
// par interaction (PING de validation + clics de boutons de présence). L'AUTH
// vient EXCLUSIVEMENT de la signature Ed25519 sur le corps brut — pas de cookie,
// pas de token Firebase. L'uid métier est dérivé du snowflake du cliqueur
// (discord_<id>), et l'écriture passe par writePresence (Admin SDK).
export async function POST(req: NextRequest) {
  // 1. Signature Ed25519 sur le CORPS BRUT (jamais req.json() avant vérif : une
  //    re-sérialisation changerait les octets et casserait la signature).
  const signature = req.headers.get('x-signature-ed25519');
  const timestamp = req.headers.get('x-signature-timestamp');
  const raw = await req.text();

  // .trim() : la Public Key est collée à la main dans Vercel — un \n/espace de
  // fin (fréquent au copier-coller) ferait échouer la regex hex ancrée et
  // renverrait 401 sur TOUTE requête (endpoint mort, panne difficile à diagnostiquer).
  if (!verifyDiscordSignature(process.env.DISCORD_PUBLIC_KEY?.trim(), signature, timestamp, raw)) {
    // 401 obligatoire : Discord teste l'URL avec des signatures invalides à
    // l'enregistrement ; sans 401 sur signature invalide, l'URL est refusée.
    return new NextResponse('invalid request signature', { status: 401 });
  }

  let interaction: DiscordInteraction;
  try {
    interaction = JSON.parse(raw);
  } catch {
    return new NextResponse('bad request', { status: 400 });
  }

  // PING → PONG AVANT toute I/O : la validation d'URL de Discord ne doit pas
  // dépendre de Firebase Admin (un SDK mal configuré casserait l'enregistrement).
  if (interaction.type === 1) return NextResponse.json({ type: 1 });

  try {
    const db = getAdminDb();
    const response = await handleInteraction(interaction, {
      recordPresence: (eventId, discordUserId, status) => {
        const uid = `discord_${discordUserId}`;
        return writePresence(db, {
          actorUid: uid,
          targetUserId: uid,     // un clic Discord = réponse pour soi
          eventId,
          status,
          rejectPast: true,      // aligne sur le site (boutons masqués pour events passés)
        });
      },
      checkRate: async (discordUserId) => {
        // Fail-open : une panne/latence Upstash ne doit pas empêcher un joueur
        // d'enregistrer sa présence (le rate-limit est une protection, pas un gate).
        try {
          const blocked = await checkRateLimit(limiters.write, `disc_int:${discordUserId}`);
          return !!blocked;
        } catch {
          return false;
        }
      },
    });
    return NextResponse.json(response);
  } catch (err) {
    captureApiError('API discord interactions', err);
    // Requête authentique (signature OK) mais erreur technique : réponse
    // éphémère gracieuse (200) plutôt qu'un 500 qui afficherait « interaction
    // failed » au joueur.
    return NextResponse.json({
      type: 4,
      data: { content: 'Une erreur est survenue. Réessaie dans un instant.', flags: 64 },
    });
  }
}
