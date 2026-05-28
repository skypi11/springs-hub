import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb, verifyAuth } from '@/lib/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { captureApiError } from '@/lib/sentry';
import { limiters, rateLimitKey, checkRateLimit } from '@/lib/rate-limit';
import { pickValorantRiotId, type DiscordConnection } from '@/lib/discord-connections';
import { fetchValorantMmr, fetchValorantAccountByPuuid } from '@/lib/valorant-henrikdev';

// Traduit un status HenrikDev en message user-friendly. Détecte 401/403
// (API key manquante/invalide) pour aider Matt à diagnostiquer la config env.
function errorMessageForHenrikStatus(status: number, context: string): string {
  if (status === 401 || status === 403) {
    return `Erreur HenrikDev (${status}) sur ${context}, l'API key est manquante ou invalide. Configurez HENRIKDEV_API_KEY en env Vercel (clé gratuite à demander sur le Discord HenrikDev).`;
  }
  if (status === 404) {
    return `Compte Riot introuvable sur HenrikDev (${context}). Joue au moins une game classée pour apparaître dans leur base.`;
  }
  if (status === 429) {
    return `Rate limit HenrikDev (${status}). Réessaie dans 1 minute.`;
  }
  if (status >= 500 || status === 0) {
    return `HenrikDev indisponible (${status || 'network'}). Réessaie dans quelques minutes.`;
  }
  return `Erreur HenrikDev (${status}) sur ${context}. Réessaie dans quelques minutes.`;
}

// POST /api/profile/sync-valorant-rank
//
// Trigger une sync immédiate du rang Valorant pour le user authentifié.
// Pas de body. Réponse : { ok, rank, rr, riotId } ou { error }.
//
// Le cron nocturne /api/cron/sync-valorant-ranks fait le boulot en batch,
// mais le user veut son rang TOUT DE SUITE après avoir lié son compte ,
// ce endpoint permet ça sans attendre la prochaine passe cron.
//
// Effets de bord :
// - Stocke valorantPuuid au premier link (immuable, anti-mensonge)
// - Détecte changement de PUUID et log (futur : alerter staff)

export async function POST(req: NextRequest) {
  try {
    const uid = await verifyAuth(req);
    if (!uid) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

    // Rate limit serré, empêcher un user de spammer HenrikDev via Aedral
    const blocked = await checkRateLimit(limiters.write, rateLimitKey(req, uid));
    if (blocked) return blocked;

    const db = getAdminDb();
    const userRef = db.collection('users').doc(uid);
    const userSnap = await userRef.get();
    if (!userSnap.exists) {
      return NextResponse.json({ error: 'Utilisateur introuvable' }, { status: 404 });
    }

    const data = userSnap.data()!;
    const connections = data.discordConnections as DiscordConnection[] | undefined;
    const riotId = pickValorantRiotId(connections);
    if (!riotId) {
      return NextResponse.json({
        error: 'Aucun compte Riot lié dans ton Discord. Va dans Discord → Paramètres → Connexions → Riot Games, lie ton compte, puis reconnecte-toi sur Aedral.',
      }, { status: 400 });
    }

    // Résolution name+tag via PUUID si Discord ne nous a pas donné le tag
    let resolvedName = riotId.name;
    let resolvedTag = riotId.tag;
    if (!resolvedTag) {
      const acc = await fetchValorantAccountByPuuid(riotId.puuid);
      if (!acc.ok) {
        return NextResponse.json({
          error: errorMessageForHenrikStatus(acc.status, 'résolution du RiotID'),
        }, { status: acc.status === 404 ? 404 : 502 });
      }
      resolvedName = acc.data.name;
      resolvedTag = acc.data.tag;
    }

    // Fetch rang actuel
    const res = await fetchValorantMmr({ name: resolvedName, tag: resolvedTag });
    if (!res.ok) {
      // 404 = joueur non classé (jamais joué de game classée). Cas légitime,
      // on stocke "Unranked" pour cohérence + traçabilité de la sync.
      if (res.status === 404) {
        const updates: Record<string, unknown> = {
          valorantRank: 'Unranked',
          valorantRR: 0,
          valorantRankSource: 'henrikdev',
          valorantRankSyncedAt: FieldValue.serverTimestamp(),
        };
        // Anti-mensonge : store PUUID au premier link / détecte changement
        const oldPuuid = (data.valorantPuuid as string) || '';
        if (!oldPuuid) {
          updates.valorantPuuid = riotId.puuid;
          updates.valorantPuuidLinkedAt = FieldValue.serverTimestamp();
        } else if (oldPuuid !== riotId.puuid) {
          // Changement de PUUID, flagger pour analyse (futur). Pour l'instant on
          // accepte le changement mais on log côté serveur.
          console.warn(`[valorant-sync] PUUID change detected for user ${uid}: ${oldPuuid} → ${riotId.puuid}`);
          updates.valorantPuuid = riotId.puuid;
          updates.valorantPuuidLinkedAt = FieldValue.serverTimestamp();
        }
        await userRef.update(updates);
        return NextResponse.json({
          ok: true,
          rank: 'Unranked',
          rr: 0,
          riotId: `${resolvedName}#${resolvedTag}`,
          notRanked: true,
        });
      }
      return NextResponse.json({
        error: errorMessageForHenrikStatus(res.status, 'récupération du rang'),
      }, { status: 502 });
    }

    // Sync réussie, update + storage PUUID
    const updates: Record<string, unknown> = {
      valorantRank: res.data.rank,
      valorantRR: res.data.rr,
      valorantRankSource: 'henrikdev',
      valorantRankSyncedAt: FieldValue.serverTimestamp(),
    };
    const oldPuuid = (data.valorantPuuid as string) || '';
    if (!oldPuuid) {
      updates.valorantPuuid = riotId.puuid;
      updates.valorantPuuidLinkedAt = FieldValue.serverTimestamp();
    } else if (oldPuuid !== riotId.puuid) {
      console.warn(`[valorant-sync] PUUID change detected for user ${uid}: ${oldPuuid} → ${riotId.puuid}`);
      updates.valorantPuuid = riotId.puuid;
      updates.valorantPuuidLinkedAt = FieldValue.serverTimestamp();
    }
    await userRef.update(updates);

    return NextResponse.json({
      ok: true,
      rank: res.data.rank,
      rr: res.data.rr,
      riotId: `${resolvedName}#${resolvedTag}`,
    });
  } catch (err) {
    captureApiError('API profile/sync-valorant-rank POST error', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
