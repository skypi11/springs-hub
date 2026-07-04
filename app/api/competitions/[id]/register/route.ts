import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb, verifyAuth, isCompetitionAdmin } from '@/lib/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { captureApiError } from '@/lib/sentry';
import { limiters, rateLimitKey, checkRateLimit } from '@/lib/rate-limit';
import { clampString, LIMITS } from '@/lib/validation';
import { isDirigeant, isResponsableForGame } from '@/lib/structure-permissions';
import { computeAge } from '@/lib/age';
import { computeRefMmr, computeMmrFlags, analyzeLineups } from '@/lib/competitions/mmr';
import { isGuildMember } from '@/lib/discord-competition';
import { getActiveCompetitionBans } from '@/lib/competitions/bans';
import { getRulebookForCompetition } from '@/lib/competitions/rulebooks';
import { isCompetitionHidden } from '@/lib/competitions/visibility';
import { buildTrackerGgUrl, type RLPlatform } from '@/lib/rl-platform';
import type { RegistrationFlag } from '@/types/competitions';

// Inscription d'une équipe à une compétition (spec Legends §4, archi §2).
//
// GET  — contexte du wizard pour l'utilisateur connecté : ses structures où il
//        est dirigeant/responsable pour le jeu, leurs équipes non archivées et
//        leurs membres (pseudo, vérifié, rôle roster). Aucune donnée sensible
//        (ni âge ni MMR d'autrui).
// POST — soumission : SNAPSHOT complet du roster (identités vérifiées, tracker,
//        âge depuis user_secrets, MMR déclarés → référence + drapeaux), refus
//        automatique si ban actif, acceptation du règlement tracée. Le statut
//        naît `pending` : la validation reste humaine (admin-in-the-loop).
//
// Doc id DÉTERMINISTE `${competitionId}_${teamId}` : l'unicité « une
// inscription par équipe et par compétition » est atomique (pattern
// structures/join). Une inscription rejetée/retirée peut être re-soumise
// (le doc est réécrit, les décisions restent dans admin_audit_logs).

const MMR_MIN = 0;
const MMR_MAX = 5000;

type RegistrationWindowState = 'before' | 'open' | 'closed' | 'unavailable';

// Compte fictif du bac à sable de test (users.isDev, écrit uniquement par
// l'Admin SDK — un utilisateur réel ne peut pas se déclarer isDev) : autorisé
// à dérouler le wizard sur une compétition en DRAFT, comme un admin compét.
async function isSandboxUser(db: FirebaseFirestore.Firestore, uid: string): Promise<boolean> {
  const snap = await db.collection('users').doc(uid).get();
  return snap.data()?.isDev === true;
}

function windowState(comp: FirebaseFirestore.DocumentData, now: Date): RegistrationWindowState {
  const opensAt = comp.registration?.opensAt?.toDate?.() ?? null;
  const closesAt = comp.registration?.closesAt?.toDate?.() ?? null;
  if (comp.status !== 'registration' || !opensAt || !closesAt) return 'unavailable';
  if (now < opensAt) return 'before';
  if (now > closesAt) return 'closed';
  return 'open';
}

// ── GET : contexte du wizard ────────────────────────────────────────────────

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const uid = await verifyAuth(req);
    if (!uid) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

    const { id } = await params;
    const db = getAdminDb();

    const compSnap = await db.collection('competitions').doc(id).get();
    if (!compSnap.exists) return NextResponse.json({ error: 'not_found' }, { status: 404 });
    const comp = compSnap.data()!;
    const requesterIsCompAdmin = await isCompetitionAdmin(uid);
    // Droit de tester le wizard sur une compétition MASQUÉE (brouillon OU test
    // isDev, même publiée) : admins compét et comptes du bac à sable. Le flag
    // (`canTestDraft`) est renvoyé au client pour qu'il ne bloque pas sur la
    // fenêtre. Une compét masquée est un 404 pour tout le monde d'autre — sinon
    // un user lambda verrait/inscrirait dans une compét de test (revue Lot 2).
    const canTestDraft = requesterIsCompAdmin || (await isSandboxUser(db, uid));
    if (isCompetitionHidden(comp) && !canTestDraft) {
      return NextResponse.json({ error: 'not_found' }, { status: 404 });
    }

    // Structures où l'utilisateur peut inscrire une équipe pour CE jeu :
    // dirigeant (fondateur/co-fondateur) ou responsable scopé sur le jeu.
    const [foundedSnap, coFoundedSnap, managedSnap] = await Promise.all([
      db.collection('structures').where('founderId', '==', uid).get(),
      db.collection('structures').where('coFounderIds', 'array-contains', uid).get(),
      db.collection('structures').where('managerIds', 'array-contains', uid).get(),
    ]);
    const structuresById = new Map<string, FirebaseFirestore.DocumentData>();
    for (const snap of [foundedSnap, coFoundedSnap, managedSnap]) {
      for (const doc of snap.docs) structuresById.set(doc.id, doc.data());
    }

    const eligible: Array<{ id: string; data: FirebaseFirestore.DocumentData }> = [];
    for (const [sid, data] of structuresById) {
      if (data.status !== 'active') continue;
      const ctx = { uid, structure: data as never };
      if (isDirigeant(ctx) || isResponsableForGame(ctx, comp.game)) {
        eligible.push({ id: sid, data });
      }
    }

    // Équipes du jeu (non archivées) + inscriptions existantes de ces équipes
    const structures = await Promise.all(eligible.map(async ({ id: sid, data }) => {
      const teamsSnap = await db.collection('sub_teams')
        .where('structureId', '==', sid)
        .where('game', '==', comp.game)
        .get();
      const teams = teamsSnap.docs
        .filter(d => (d.data().status ?? 'active') !== 'archived')
        .map(d => ({
          id: d.id,
          name: (d.data().name as string) ?? '',
          playerIds: (d.data().playerIds as string[]) ?? [],
          subIds: (d.data().subIds as string[]) ?? [],
        }));

      // Membres enrichis (une passe, sans doublon). `ageStatus` prévient le
      // dirigeant AVANT la soumission qu'une dérogation sera demandée (mineur
      // ou âge non renseigné) — l'âge exact et la date ne sortent jamais ici.
      const memberIds = Array.from(new Set(teams.flatMap(t => [...t.playerIds, ...t.subIds])));
      const minAgeRule = (comp.eligibility?.minAge as number | undefined) ?? null;
      const [memberDocs, memberSecrets] = await Promise.all([
        Promise.all(memberIds.map(mid => db.collection('users').doc(mid).get())),
        minAgeRule !== null
          ? Promise.all(memberIds.map(mid => db.collection('user_secrets').doc(mid).get()))
          : Promise.resolve([] as FirebaseFirestore.DocumentSnapshot[]),
      ]);
      const members: Record<string, { displayName: string; verified: boolean; avatarUrl: string; ageStatus: 'ok' | 'under' | 'unknown' }> = {};
      memberDocs.forEach((m, i) => {
        if (!m.exists) return;
        const u = m.data()!;
        let ageStatus: 'ok' | 'under' | 'unknown' = 'ok';
        if (minAgeRule !== null) {
          const age = computeAge((memberSecrets[i]?.data()?.dateOfBirth as string | undefined) ?? '');
          ageStatus = age === null ? 'unknown' : age < minAgeRule ? 'under' : 'ok';
        }
        members[m.id] = {
          displayName: (u.displayName as string) || (u.discordUsername as string) || m.id,
          verified: !!u.rlEpicId || !!u.rlSteamId,
          avatarUrl: (u.avatarUrl as string) || (u.discordAvatar as string) || '',
          ageStatus,
        };
      });

      return {
        id: sid,
        name: (data.name as string) ?? '',
        tag: (data.tag as string) ?? '',
        logoUrl: (data.logoUrl as string) || null,
        teams,
        members,
      };
    }));

    // Inscriptions existantes de l'utilisateur sur cette compétition (pour
    // afficher l'état au lieu du wizard)
    const allTeamIds = structures.flatMap(s => s.teams.map(t => t.id));
    const existing: Array<{ teamId: string; status: string; name: string }> = [];
    for (const teamId of allTeamIds) {
      const regSnap = await db.collection('competition_registrations').doc(`${id}_${teamId}`).get();
      if (regSnap.exists) {
        const r = regSnap.data()!;
        if (r.status !== 'withdrawn' && r.status !== 'rejected') {
          existing.push({ teamId, status: r.status, name: r.name ?? '' });
        }
      }
    }

    const rulebook = await getRulebookForCompetition(db, {
      id,
      circuitId: (comp.circuitId as string | null) ?? null,
    });

    return NextResponse.json({
      competition: {
        id,
        name: comp.name ?? '',
        game: comp.game ?? '',
        status: comp.status ?? 'draft',
        roster: comp.roster ?? { starters: 3, subsMax: 2 },
        eligibility: comp.eligibility ?? null,
        registration: {
          opensAt: comp.registration?.opensAt?.toDate?.()?.toISOString() ?? null,
          closesAt: comp.registration?.closesAt?.toDate?.()?.toISOString() ?? null,
        },
        windowState: windowState(comp, new Date()),
      },
      structures,
      existingRegistrations: existing,
      rulebook: rulebook ? { version: rulebook.version, markdown: rulebook.markdown } : null,
      isCompetitionAdmin: requesterIsCompAdmin,
      canTestDraft,
    });
  } catch (err) {
    captureApiError('API Competitions/Register GET error', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}

// ── POST : soumission de l'inscription ──────────────────────────────────────

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const uid = await verifyAuth(req);
    if (!uid) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

    const blocked = await checkRateLimit(limiters.write, rateLimitKey(req, uid));
    if (blocked) return blocked;

    const { id } = await params;
    const body = await req.json();
    const db = getAdminDb();

    // ── Compétition + fenêtre ──
    const compSnap = await db.collection('competitions').doc(id).get();
    if (!compSnap.exists) return NextResponse.json({ error: 'Compétition introuvable.' }, { status: 404 });
    const comp = compSnap.data()!;

    const requesterIsCompAdmin = await isCompetitionAdmin(uid);
    const state = windowState(comp, new Date());
    const canTest = requesterIsCompAdmin || (await isSandboxUser(db, uid));
    // Compétition MASQUÉE (brouillon OU test isDev, même publiée) : seuls les
    // testeurs peuvent la voir ET s'y inscrire. Sinon un user lambda pourrait
    // injecter une VRAIE inscription (snapshot réel : âges, MMR, identités)
    // dans une compét de test publiée en 'registration' (revue Lot 2).
    if (isCompetitionHidden(comp) && !canTest) {
      return NextResponse.json({ error: 'Compétition introuvable.' }, { status: 404 });
    }
    // Les testeurs bypassent la fenêtre sur une compét masquée (previews,
    // tournoi fantôme, tests d'inscription impersonés).
    const adminTestBypass = isCompetitionHidden(comp) && canTest;
    if (!adminTestBypass && state !== 'open') {
      const msg = state === 'before'
        ? 'Les inscriptions ne sont pas encore ouvertes.'
        : state === 'closed'
          ? 'Les inscriptions sont fermées.'
          : 'Cette compétition ne prend pas d\'inscriptions.';
      return NextResponse.json({ error: msg }, { status: 409 });
    }

    // ── Structure + autorisation ──
    const structureId = typeof body.structureId === 'string' ? body.structureId : '';
    const teamId = typeof body.teamId === 'string' ? body.teamId : '';
    if (!structureId || !teamId) return NextResponse.json({ error: 'Équipe requise.' }, { status: 400 });

    const structSnap = await db.collection('structures').doc(structureId).get();
    if (!structSnap.exists || structSnap.data()?.status !== 'active') {
      return NextResponse.json({ error: 'Structure introuvable ou inactive.' }, { status: 404 });
    }
    const structure = structSnap.data()!;
    const ctx = { uid, structure: structure as never };
    if (!isDirigeant(ctx) && !isResponsableForGame(ctx, comp.game)) {
      return NextResponse.json({ error: 'Seul un dirigeant ou responsable de la structure peut inscrire une équipe.' }, { status: 403 });
    }

    // ── Équipe + roster sélectionné ──
    const teamSnap = await db.collection('sub_teams').doc(teamId).get();
    if (!teamSnap.exists) return NextResponse.json({ error: 'Équipe introuvable.' }, { status: 404 });
    const team = teamSnap.data()!;
    if (team.structureId !== structureId || team.game !== comp.game) {
      return NextResponse.json({ error: 'Cette équipe n\'appartient pas à la structure pour ce jeu.' }, { status: 400 });
    }
    if ((team.status ?? 'active') === 'archived') {
      return NextResponse.json({ error: 'Cette équipe est archivée.' }, { status: 400 });
    }

    const starters = comp.roster?.starters ?? 3;
    const subsMax = comp.roster?.subsMax ?? 2;
    const rawRoster = Array.isArray(body.roster) ? body.roster as Array<Record<string, unknown>> : [];
    const titulaires = rawRoster.filter(r => r.role === 'titulaire');
    const remplacants = rawRoster.filter(r => r.role === 'remplacant');
    if (titulaires.length !== starters) {
      return NextResponse.json({ error: `Il faut exactement ${starters} titulaires.` }, { status: 400 });
    }
    if (remplacants.length > subsMax) {
      return NextResponse.json({ error: `Au plus ${subsMax} remplaçants.` }, { status: 400 });
    }
    const rosterUids = rawRoster.map(r => String(r.uid ?? ''));
    if (rosterUids.some(u => !u) || new Set(rosterUids).size !== rosterUids.length) {
      return NextResponse.json({ error: 'Roster invalide (doublon ou joueur manquant).' }, { status: 400 });
    }
    // Le snapshot fige des joueurs du roster de l'ÉQUIPE (spec §4 : équipe
    // formée sur Aedral obligatoire).
    const teamMembers = new Set([...(team.playerIds ?? []), ...(team.subIds ?? [])]);
    const outsider = rosterUids.find(u => !teamMembers.has(u));
    if (outsider) {
      return NextResponse.json({ error: 'Tous les joueurs inscrits doivent faire partie de l\'équipe sur Aedral.' }, { status: 400 });
    }

    // ── MMR déclarés ──
    const mmrRules = comp.eligibility?.mmr ?? null;
    if (mmrRules) {
      for (const r of rawRoster) {
        const cur = r.declaredCurrentMmr;
        const peak = r.declaredPeakMmr;
        const valid = (v: unknown) => typeof v === 'number' && Number.isInteger(v) && v >= MMR_MIN && v <= MMR_MAX;
        if (!valid(cur) || !valid(peak)) {
          return NextResponse.json({ error: 'MMR déclaré invalide (entier 0-5000 attendu pour chaque joueur).' }, { status: 400 });
        }
        if ((peak as number) < (cur as number)) {
          return NextResponse.json({ error: 'Le peak MMR ne peut pas être inférieur au MMR actuel.' }, { status: 400 });
        }
      }
    }

    // ── Bans actifs : refus automatique avec motif (spec §5) ──
    const activeBans = await getActiveCompetitionBans(db, { uids: rosterUids, structureId });
    if (activeBans.length > 0) {
      const labels = activeBans.map(b => `${b.targetLabel} (${b.reason})`).join(' · ');
      return NextResponse.json(
        { error: `Inscription refusée — au registre des bans : ${labels}`, bans: activeBans.map(b => ({ label: b.targetLabel, reason: b.reason })) },
        { status: 403 },
      );
    }

    // ── Règlement : acceptation obligatoire, version courante uniquement ──
    const rulebook = await getRulebookForCompetition(db, { id, circuitId: (comp.circuitId as string | null) ?? null });
    let rulebookAccepted: { version: number; at: FieldValue; byUid: string } | null = null;
    if (rulebook) {
      if (body.rulebookAccepted !== true) {
        return NextResponse.json({ error: 'L\'acceptation du règlement est obligatoire.' }, { status: 400 });
      }
      if (body.rulebookVersion !== rulebook.version) {
        return NextResponse.json({ error: 'Le règlement a été mis à jour depuis ton chargement de la page. Relis-le avant d\'accepter.' }, { status: 409 });
      }
      rulebookAccepted = { version: rulebook.version, at: FieldValue.serverTimestamp(), byUid: uid };
    }

    // ── Snapshot par joueur (identités vérifiées, tracker, âge server-only) ──
    const [userSnaps, secretSnaps] = await Promise.all([
      Promise.all(rosterUids.map(u => db.collection('users').doc(u).get())),
      Promise.all(rosterUids.map(u => db.collection('user_secrets').doc(u).get())),
    ]);

    const flags = new Set<RegistrationFlag>();
    const refMmrs: number[] = [];
    const minAge = comp.eligibility?.minAge ?? null;
    const requireVerified = comp.eligibility?.requireVerifiedAccounts === true;

    const rosterSnapshot = rawRoster.map((r, i) => {
      const userSnap = userSnaps[i];
      if (!userSnap.exists) {
        throw new Error(`user_missing:${rosterUids[i]}`);
      }
      const u = userSnap.data()!;
      const dateOfBirth = (secretSnaps[i].data()?.dateOfBirth as string | undefined) ?? '';
      const age = computeAge(dateOfBirth);

      const epicId = (u.rlEpicId as string) || null;
      const steamId = (u.rlSteamId as string) || null;
      const verified = !!epicId || !!steamId;
      // Tracker : identité vérifiée d'abord (epic > steam), sinon plateforme déclarée
      let trackerUrl: string | null = null;
      if (epicId && u.rlEpicName) trackerUrl = buildTrackerGgUrl('epic', u.rlEpicName as string);
      else if (steamId) trackerUrl = buildTrackerGgUrl('steam', steamId);
      else if (u.rlPlatform && u.rlPlatformId) trackerUrl = buildTrackerGgUrl(u.rlPlatform as RLPlatform, u.rlPlatformId as string);

      const declaredCurrentMmr = mmrRules ? (r.declaredCurrentMmr as number) : 0;
      const declaredPeakMmr = mmrRules ? (r.declaredPeakMmr as number) : 0;
      const refMmr = mmrRules
        ? computeRefMmr(declaredCurrentMmr, declaredPeakMmr, mmrRules.weightCurrent ?? 0.7)
        : 0;
      if (mmrRules) refMmrs.push(refMmr);

      // Âge inconnu (pas de date de naissance) = à vérifier humainement, même
      // circuit que la dérogation mineur : jamais de refus automatique (spec §4).
      if (minAge !== null && (age === null || age < minAge)) flags.add('underage');

      return {
        uid: rosterUids[i],
        role: r.role === 'titulaire' ? 'titulaire' : 'remplacant',
        displayName: (u.displayName as string) || (u.discordUsername as string) || rosterUids[i],
        declaredCurrentMmr,
        declaredPeakMmr,
        refMmr,
        epicId,
        epicName: (u.rlEpicName as string) || null,
        steamId,
        trackerUrl,
        discordId: (u.discordId as string) || rosterUids[i].replace('discord_', ''),
        discordUsername: (u.discordUsername as string) || null,
        country: (u.country as string) || null,
        age,
        verified,
        onDiscordGuild: null as boolean | null,
      };
    });

    // ── Gate compét (spec §3) : comptes vérifiés OBLIGATOIRES — une équipe ne
    //    peut pas s'inscrire avec un joueur non vérifié. Refus net avec les
    //    noms, le wizard bloque déjà en amont (défense en profondeur ici).
    if (requireVerified) {
      const unverified = rosterSnapshot.filter(p => !p.verified);
      if (unverified.length > 0) {
        return NextResponse.json({
          error: `Compte non vérifié : ${unverified.map(p => p.displayName).join(', ')}. `
            + 'Chaque joueur inscrit doit lier son compte Epic ou Steam (Paramètres → Rocket League) avant l\'inscription.',
          unverifiedUids: unverified.map(p => p.uid),
        }, { status: 400 });
      }
    }

    // ── Adhésion au serveur Discord de la compétition, vérifiée par le bot à
    //    l'inscription (spec §7) : jamais bloquant (le joueur peut rejoindre
    //    ensuite), mais snapshoté par joueur + signalé aux admins. L'inscripteur
    //    est vérifié aussi. `null` = serveur non configuré ou API indisponible.
    let createdByOnGuild: boolean | null = null;
    const guildId = (comp.discord?.guildId as string | undefined) ?? null;
    if (guildId) {
      try {
        const checks = await Promise.all([
          ...rosterSnapshot.map(p => isGuildMember(guildId, p.discordId)),
          (async () => {
            const requesterSnap = await db.collection('users').doc(uid).get();
            const requesterDiscordId = (requesterSnap.data()?.discordId as string) || uid.replace('discord_', '');
            return isGuildMember(guildId, requesterDiscordId);
          })(),
        ]);
        rosterSnapshot.forEach((p, i) => { p.onDiscordGuild = checks[i]; });
        createdByOnGuild = checks[checks.length - 1];
        if (rosterSnapshot.some(p => p.onDiscordGuild === false) || createdByOnGuild === false) {
          flags.add('discord_guild_missing');
        }
      } catch (err) {
        console.error('[register] Discord guild check failed:', err);
      }
    }

    let worstLineupAvg: number | null = null;
    let worstLineupGap: number | null = null;
    if (mmrRules) {
      for (const f of computeMmrFlags(refMmrs, mmrRules, starters)) flags.add(f);
      const analysis = analyzeLineups(refMmrs, starters);
      worstLineupAvg = analysis.worstLineupAvg;
      worstLineupGap = analysis.worstLineupGap;
    }

    // ── Nom d'affichage de l'équipe (figé — la continuité de nom est la clé
    //    d'identité du circuit, spec §4) ──
    const displayName = clampString(body.name, LIMITS.structureName) || (structure.name as string);

    // ── Un joueur ne peut pas être dans deux inscriptions actives de la même
    //    compétition (query hors transaction : la validation humaine derrière
    //    couvre la course résiduelle) ──
    const overlapSnap = await db.collection('competition_registrations')
      .where('competitionId', '==', id)
      .where('rosterUids', 'array-contains-any', rosterUids.slice(0, 10))
      .get();
    const overlap = overlapSnap.docs.find(d => {
      const st = d.data().status;
      return d.id !== `${id}_${teamId}` && (st === 'pending' || st === 'approved' || st === 'waitlisted');
    });
    if (overlap) {
      return NextResponse.json(
        { error: 'Un des joueurs est déjà inscrit à cette compétition avec une autre équipe.' },
        { status: 409 },
      );
    }

    // ── Écriture atomique (unicité par équipe via doc id déterministe) ──
    const regRef = db.collection('competition_registrations').doc(`${id}_${teamId}`);
    await db.runTransaction(async tx => {
      const existing = await tx.get(regRef);
      // Ressources Discord d'un provisioning antérieur (équipe validée puis
      // rejetée dont le déprovisionnement a échoué) : préservées à la
      // réécriture, sinon rôles/salons deviennent orphelins et le prochain
      // provisioning en crée des doublons.
      let discordBlock = {
        provisioningStatus: 'none', roleId: null as string | null,
        textChannelId: null as string | null, voiceChannelId: null as string | null,
      };
      if (existing.exists) {
        const st = existing.data()?.status;
        if (st === 'pending' || st === 'approved' || st === 'waitlisted') {
          throw new Error('already_registered');
        }
        // rejected / withdrawn : re-soumission autorisée, le doc est réécrit
        // (les décisions passées restent dans admin_audit_logs).
        const prevDiscord = existing.data()?.discord;
        if (prevDiscord?.roleId || prevDiscord?.textChannelId || prevDiscord?.voiceChannelId) {
          discordBlock = {
            provisioningStatus: prevDiscord.provisioningStatus ?? 'none',
            roleId: prevDiscord.roleId ?? null,
            textChannelId: prevDiscord.textChannelId ?? null,
            voiceChannelId: prevDiscord.voiceChannelId ?? null,
          };
        }
      }
      tx.set(regRef, {
        competitionId: id,
        circuitTeamId: null,           // résolu à l'approbation (identité circuit)
        structureId,
        teamId,
        name: displayName,
        tag: (structure.tag as string) || '',
        logoUrl: (structure.logoUrl as string) || null,
        captainUid: uid,
        rosterUids,
        roster: rosterSnapshot,
        computed: {
          worstLineupAvg,
          worstLineupGap,
          flags: Array.from(flags),
        },
        status: 'pending',
        review: null,
        rulebookAccepted,
        generalCheckin: null,
        discord: discordBlock,
        createdByOnDiscordGuild: createdByOnGuild,
        seed: null,
        createdBy: uid,
        createdAt: FieldValue.serverTimestamp(),
      });
    });

    return NextResponse.json({ success: true, flags: Array.from(flags) });
  } catch (err) {
    if (err instanceof Error && err.message === 'already_registered') {
      return NextResponse.json({ error: 'Cette équipe est déjà inscrite à cette compétition.' }, { status: 409 });
    }
    if (err instanceof Error && err.message.startsWith('user_missing:')) {
      return NextResponse.json({ error: 'Un joueur du roster n\'existe plus.' }, { status: 400 });
    }
    captureApiError('API Competitions/Register POST error', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
