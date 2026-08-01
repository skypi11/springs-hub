import { NextRequest, NextResponse } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { getAdminDb, verifyAuth } from '@/lib/firebase-admin';
import { limiters, rateLimitKey, checkRateLimit } from '@/lib/rate-limit';
import { captureApiError } from '@/lib/sentry';
import { isGuildMember } from '@/lib/discord-competition';
import { canViewHiddenCompetition } from '@/lib/competitions/visibility';
import { countries } from '@/lib/countries';
import {
  MANIA_CUP,
  MANIA_CUP_REGISTRATIONS,
  springsGuildId,
  isManiaCupPublic,
  ageAtEvent,
  needsGuardianConsent,
  generateRegistrationCode,
  discordIdFromUid,
  type ManiaCupRegistration,
} from '@/lib/mania-cup';

// Inscription individuelle à la Springs Mania Cup.
//
// Le moteur de compétitions d'Aedral est team-based (on y inscrit une ÉQUIPE
// avec son roster, via une structure). Ici les 64 joueurs s'inscrivent en solo
// et n'appartiennent à aucune structure : d'où ce parcours dédié, volontairement
// court — identité Trackmania vérifiée, appartenance au Discord Springs, âge,
// nationalité.
//
// GET  — état du dossier du visiteur + places restantes (sert à peindre la page)
// POST — dépôt ou mise à jour de l'inscription

async function countTakenSeats(db: FirebaseFirestore.Firestore): Promise<number> {
  const snap = await db
    .collection(MANIA_CUP_REGISTRATIONS)
    .where('status', 'in', ['pending_payment', 'confirmed'])
    .count()
    .get();
  return snap.data().count;
}

// ── GET : de quoi le joueur a-t-il encore besoin ? ───────────────────────────

export async function GET(req: NextRequest) {
  try {
    const db = getAdminDb();
    const taken = await countTakenSeats(db);
    const seats = {
      max: MANIA_CUP.maxPlayers,
      taken,
      remaining: Math.max(0, MANIA_CUP.maxPlayers - taken),
    };

    const uid = await verifyAuth(req);
    if (!uid) {
      return NextResponse.json({ authenticated: false, visible: isManiaCupPublic(), seats });
    }

    // Tant que l'événement n'est pas publié, seuls les admins et les comptes du
    // bac à sable voient l'inscription — même porte que les compétitions en
    // brouillon (canViewHiddenCompetition).
    const visible = isManiaCupPublic() || (await canViewHiddenCompetition(db, uid));

    const [userSnap, regSnap] = await Promise.all([
      db.collection('users').doc(uid).get(),
      db.collection(MANIA_CUP_REGISTRATIONS).doc(uid).get(),
    ]);

    const user = userSnap.data() ?? {};
    const trackmania = user.tmAccountId
      ? { accountId: user.tmAccountId as string, displayName: (user.pseudoTM as string) ?? '' }
      : null;

    // Appartenance au Discord Springs. `null` = indéterminé (bot absent du
    // serveur, token manquant, Discord en vrac) : on ne bloque pas le joueur
    // sur une panne qui n'est pas la sienne, l'organisation vérifiera.
    const gid = springsGuildId();
    const discordId = discordIdFromUid(uid);
    let inGuild: boolean | null = null;
    if (gid && discordId) {
      inGuild = await isGuildMember(gid, discordId).catch(() => null);
    }

    return NextResponse.json({
      authenticated: true,
      visible,
      seats,
      trackmania,
      discord: { id: discordId, inGuild },
      registration: regSnap.exists ? (regSnap.data() as ManiaCupRegistration) : null,
    });
  } catch (err) {
    captureApiError('mania-cup/register:GET', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}

// ── POST : dépôt de l'inscription ────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const uid = await verifyAuth(req);
    if (!uid) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

    const blocked = await checkRateLimit(limiters.write, rateLimitKey(req, uid));
    if (blocked) return blocked;

    const db = getAdminDb();
    if (!isManiaCupPublic() && !(await canViewHiddenCompetition(db, uid))) {
      return NextResponse.json({ error: 'Les inscriptions ne sont pas ouvertes.' }, { status: 404 });
    }

    const body = (await req.json().catch(() => null)) as {
      birthDate?: unknown;
      countryCode?: unknown;
      needsRentalSetup?: unknown;
    } | null;
    if (!body) return NextResponse.json({ error: 'Requête invalide' }, { status: 400 });

    const birthDate = typeof body.birthDate === 'string' ? body.birthDate : '';
    const countryCode = typeof body.countryCode === 'string' ? body.countryCode : '';
    const needsRentalSetup = body.needsRentalSetup === true;

    if (!/^\d{4}-\d{2}-\d{2}$/.test(birthDate)) {
      return NextResponse.json({ error: 'Date de naissance invalide.' }, { status: 400 });
    }
    if (!countries.some((c) => c.code === countryCode)) {
      return NextResponse.json({ error: 'Pays invalide.' }, { status: 400 });
    }

    const age = ageAtEvent(birthDate);
    if (age === null) {
      return NextResponse.json({ error: 'Date de naissance invalide.' }, { status: 400 });
    }
    if (age < MANIA_CUP.minAge) {
      return NextResponse.json(
        {
          error: `La LAN est accessible à partir de ${MANIA_CUP.minAge} ans le jour de l’événement.`,
        },
        { status: 422 }
      );
    }

    const docRef = db.collection(MANIA_CUP_REGISTRATIONS).doc(uid);
    const [userSnap, existing] = await Promise.all([
      db.collection('users').doc(uid).get(),
      docRef.get(),
    ]);

    // L'identité Trackmania vérifiée est le préalable : c'est elle qui reliera
    // le joueur à ses résultats remontés par le serveur de jeu.
    const user = userSnap.data() ?? {};
    const tmAccountId = user.tmAccountId as string | undefined;
    if (!tmAccountId) {
      return NextResponse.json(
        { error: 'Connecte d’abord ton compte Trackmania.' },
        { status: 409 }
      );
    }

    // Jauge : on ne refuse que les NOUVELLES inscriptions, jamais la mise à
    // jour d'un dossier déjà déposé (sinon un joueur inscrit ne pourrait plus
    // corriger sa date de naissance une fois les 64 places prises).
    if (!existing.exists) {
      const taken = await countTakenSeats(db);
      if (taken >= MANIA_CUP.maxPlayers) {
        return NextResponse.json(
          { error: 'Les 64 places sont prises. Contacte l’organisation pour la liste d’attente.' },
          { status: 409 }
        );
      }
    }

    const prev = existing.exists ? (existing.data() as ManiaCupRegistration) : null;
    const guardianNeeded = needsGuardianConsent(age);

    const payload: Partial<ManiaCupRegistration> & { updatedAt: unknown } = {
      uid,
      discordId: discordIdFromUid(uid),
      tmAccountId,
      tmDisplayName: (user.pseudoTM as string) ?? '',
      birthDate,
      ageAtEvent: age,
      countryCode,
      needsRentalSetup,
      // Le statut est piloté par le paiement (webhook HelloAsso) et par la
      // relecture de l'autorisation parentale — jamais par le formulaire.
      status: prev?.status ?? 'pending_payment',
      guardianConsent: guardianNeeded
        ? prev?.guardianConsent && prev.guardianConsent !== 'not_required'
          ? prev.guardianConsent
          : 'missing'
        : 'not_required',
      registrationCode: prev?.registrationCode ?? generateRegistrationCode(),
      updatedAt: FieldValue.serverTimestamp(),
    };
    if (!prev) payload.createdAt = FieldValue.serverTimestamp();

    await docRef.set(payload, { merge: true });

    const saved = await docRef.get();
    return NextResponse.json({ registration: saved.data() });
  } catch (err) {
    captureApiError('mania-cup/register:POST', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
