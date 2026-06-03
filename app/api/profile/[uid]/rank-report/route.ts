// POST /api/profile/[uid]/rank-report
// Signaler le rang RL d'un joueur, n'importe quel user connecté peut le faire.
// Voir docs/rl-rank-verification-plan.md (Lot 5 v2).
//
// Body : { motif: 'rank_lie' | 'smurf', message?: string }
//
// Le signalement crée un doc dans `rank_reports` + ping Discord les admins.
//
// Garde-fous (anti-harassement, audit 30/05 🟡 5) :
//  - Auth requise + check target.exists (impossible de signaler un fantôme).
//  - Rate-limit global Upstash keyé par reporterUid (burst protection).
//  - Cooldown 24h par couple (reporter, target) via lookup Firestore,
//    RÉINITIALISÉ par tout changement de rang du target (target.rlRankChangedAt) :
//    si le joueur re-change son rang, on peut le re-signaler immédiatement,
//    même s'il a déjà été signalé < 24h plus tôt.
//  - Anti-abus : un reporter qui cumule 3 signalements `dismissed` (rejetés
//    par l'admin) en 30 jours est auto-bloqué de nouveaux signalements
//    pendant 30 jours (le compteur tourne en rolling window). Les résolus
//    ne comptent pas. Le blocage se lève tout seul.

import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb, verifyAuth } from '@/lib/firebase-admin';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { captureApiError } from '@/lib/sentry';
import { limiters, rateLimitKey, checkRateLimit } from '@/lib/rate-limit';
import { clampString } from '@/lib/validation';
import { sendAdminAlert } from '@/lib/admin-discord-alert';
import { getGameLabel, isKnownGame } from '@/lib/games-registry';

type RankReportMotif = 'rank_lie' | 'smurf';
const MOTIF_LABELS: Record<RankReportMotif, string> = {
  rank_lie: '🎯 Rang déclaré faux',
  smurf: '🥷 Soupçon de smurf',
};

// Jeux supportant le signalement de rang (= ceux qui ont rankVerification dans
// la registry). Le rang signalé est lu sur le champ adéquat du profil cible.
// `GAME_RANK_FIELD` est la source de vérité de la liste des jeux signalables.
type ReportableGame = 'rocket_league' | 'valorant';
// Champ profil portant le rang affiché + champ horodatant son dernier changement
// (sert à réinitialiser le cooldown anti-spam quand le joueur re-change son rang).
const GAME_RANK_FIELD: Record<ReportableGame, { rank: string; changedAt: string }> = {
  rocket_league: { rank: 'rlRank', changedAt: 'rlRankChangedAt' },
  // `valorantRankChangedAt` n'est volontairement écrit par AUCUN chemin : le rang
  // Valorant est auto-synchronisé (un changement n'est pas un mensonge), donc on
  // ne réinitialise jamais le cooldown anti-spam de signalement → toMillis(undefined)
  // = 0 = simple fenêtre 24h. Champ conservé pour la symétrie du mapping.
  valorant: { rank: 'valorantRank', changedAt: 'valorantRankChangedAt' },
};

const DAY_MS = 24 * 60 * 60 * 1000;
const DISMISSED_BLOCK_WINDOW_DAYS = 30;
const DISMISSED_BLOCK_THRESHOLD = 3;

function toMillis(v: unknown): number {
  if (!v) return 0;
  if (v instanceof Timestamp) return v.toMillis();
  if (typeof v === 'object' && v !== null && 'toMillis' in v && typeof (v as { toMillis: unknown }).toMillis === 'function') {
    return (v as { toMillis: () => number }).toMillis();
  }
  if (typeof v === 'string') return new Date(v).getTime() || 0;
  return 0;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ uid: string }> },
) {
  try {
    const reporterUid = await verifyAuth(req);
    if (!reporterUid) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

    const blocked = await checkRateLimit(limiters.write, rateLimitKey(req, reporterUid));
    if (blocked) return blocked;

    const { uid: targetUid } = await params;
    if (!targetUid || typeof targetUid !== 'string') {
      return NextResponse.json({ error: 'UID cible invalide' }, { status: 400 });
    }
    if (targetUid === reporterUid) {
      return NextResponse.json({ error: 'Tu ne peux pas te signaler toi-même.' }, { status: 400 });
    }

    const body = await req.json().catch(() => ({}));
    const motifRaw = typeof body?.motif === 'string' ? body.motif : '';
    if (motifRaw !== 'rank_lie' && motifRaw !== 'smurf') {
      return NextResponse.json({
        error: 'Motif invalide (rank_lie ou smurf attendu).',
      }, { status: 400 });
    }
    const motif: RankReportMotif = motifRaw;
    const message = clampString(typeof body?.message === 'string' ? body.message : '', 500);

    // Jeu signalé. Rétrocompat : les anciens clients n'envoient rien → RL.
    const gameRaw = typeof body?.game === 'string' ? body.game : 'rocket_league';
    if (!isKnownGame(gameRaw) || !(gameRaw in GAME_RANK_FIELD)) {
      return NextResponse.json({
        error: 'Jeu invalide pour un signalement de rang.',
      }, { status: 400 });
    }
    const game = gameRaw as ReportableGame;

    // Valorant : le rang vient du sync auto (impossible de mentir sur le rang
    // lui-même), donc seul le motif 'smurf' a du sens. On rejette 'rank_lie'
    // côté serveur pour aligner le contrat sur l'UI (ReportRankDialog).
    if (game === 'valorant' && motif === 'rank_lie') {
      return NextResponse.json({
        error: 'Pour Valorant, seul un soupçon de smurf est signalable (le rang est auto-vérifié).',
      }, { status: 400 });
    }

    const db = getAdminDb();
    const targetSnap = await db.collection('users').doc(targetUid).get();
    if (!targetSnap.exists) {
      return NextResponse.json({ error: 'Utilisateur introuvable' }, { status: 404 });
    }
    const target = targetSnap.data()!;

    // ── Anti-abus : 3 signalements `dismissed` en 30 jours → blocage 30j ─────
    const cutoffDismissedMs = Date.now() - DISMISSED_BLOCK_WINDOW_DAYS * DAY_MS;
    const recentDismissedSnap = await db.collection('rank_reports')
      .where('reporterUid', '==', reporterUid)
      .where('status', '==', 'dismissed')
      .get();
    const recentDismissed = recentDismissedSnap.docs.filter(d => {
      const ms = toMillis(d.data().resolvedAt) || toMillis(d.data().createdAt);
      return ms >= cutoffDismissedMs;
    });
    if (recentDismissed.length >= DISMISSED_BLOCK_THRESHOLD) {
      return NextResponse.json({
        error: `Tu es temporairement bloqué de nouveaux signalements (${recentDismissed.length} signalements rejetés par l'admin sur les ${DISMISSED_BLOCK_WINDOW_DAYS} derniers jours). Réessaie plus tard.`,
      }, { status: 429 });
    }

    // ── Cooldown 24h par (reporter, target), réinitialisé par tout changement
    //    de rang du target depuis le dernier signalement ────────────────────
    const cooldownCutoffMs = Date.now() - DAY_MS;
    const rankChangedAtMs = toMillis(target[GAME_RANK_FIELD[game].changedAt]);
    const effectiveCutoff = Math.max(cooldownCutoffMs, rankChangedAtMs);
    const recent = await db.collection('rank_reports')
      .where('targetUid', '==', targetUid)
      .where('reporterUid', '==', reporterUid)
      .get();
    for (const d of recent.docs) {
      const created = toMillis(d.data().createdAt);
      if (created > effectiveCutoff) {
        return NextResponse.json({
          error: 'Tu as déjà signalé ce joueur récemment. Attends 24h ou un changement de rang de sa part.',
        }, { status: 429 });
      }
    }

    const reporterSnap = await db.collection('users').doc(reporterUid).get();
    const reporterName = (reporterSnap.data()?.displayName as string) || 'Anonyme';

    // Rang affiché de la cible pour le jeu signalé. Pour Valorant, on ne retient
    // que le rang vérifié (sync HenrikDev) — un rang déclaré legacy ne doit pas
    // remonter dans le report ni l'alerte admin (cohérent avec l'affichage).
    let targetRank = (target[GAME_RANK_FIELD[game].rank] as string) || '';
    if (game === 'valorant' && target.valorantRankSource !== 'henrikdev') targetRank = '';
    const reportRef = db.collection('rank_reports').doc();
    await reportRef.set({
      targetUid,
      targetName: (target.displayName as string) || (target.discordUsername as string) || '',
      game,
      // `targetRank` = champ générique lu par l'admin (tous jeux). On garde
      // `targetRlRank` rempli en RL pour rétrocompat des docs historiques.
      targetRank,
      targetRlRank: game === 'rocket_league' ? targetRank : '',
      reporterUid,
      reporterName,
      motif,
      message: message || null,
      status: 'pending',
      createdAt: FieldValue.serverTimestamp(),
    });

    // Ping admin Discord (fire-and-forget)
    await sendAdminAlert(db, {
      title: `🚩 ${MOTIF_LABELS[motif]} · ${getGameLabel(game)}`,
      description: `**${reporterName}** signale **${(target.displayName as string) || targetUid}**\n`
        + `Rang ${getGameLabel(game)} affiché : \`${targetRank || '—'}\`\n`
        + (message ? `\nMessage : ${message}\n` : '')
        + `\n[Voir le profil](https://aedral.com/profile/${targetUid}) · [Admin → signalements](https://aedral.com/admin/rank-reports)`,
    });

    return NextResponse.json({ ok: true, reportId: reportRef.id });
  } catch (err) {
    captureApiError('API rank-report POST error', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
