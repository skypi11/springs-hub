import { NextRequest, NextResponse } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { getAdminDb, verifyAuth } from '@/lib/firebase-admin';
import { limiters, rateLimitKey, checkRateLimit } from '@/lib/rate-limit';
import { captureApiError } from '@/lib/sentry';
import { isGuildMember } from '@/lib/discord-competition';
import { canViewHiddenCompetition } from '@/lib/competitions/visibility';
import { countries } from '@/lib/countries';
import { deleteFileSilent } from '@/lib/storage';
import { clampString } from '@/lib/validation';
import { getRulebookByScope } from '@/lib/competitions/rulebooks';
import { getManiaCupSettings } from '@/lib/mania-cup-settings';
import { allocateRegistrationCode, releaseRegistrationCode } from '@/lib/mania-cup-server';
import {
  MANIA_CUP,
  MANIA_CUP_REGISTRATIONS,
  MANIA_CUP_IDENTITY,
  springsGuildId,
  isManiaCupPublic,
  MANIA_CUP_DOCS,
  ageAtEvent,
  needsGuardianConsent,
  discordIdFromUid,
  isPlausibleEmail,
  isPlausiblePhone,
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

/**
 * Places reellement prises = inscriptions REGLEES, et elles seules.
 *
 * Compter les inscriptions en attente de paiement bloquerait des places pour
 * des gens qui ne paieront peut-etre jamais : l'evenement afficherait complet
 * avec des sieges vides. Conforme au reglement, ou les places sont attribuees
 * par ordre de reglement. Tant qu'il reste des places, on accepte de nouvelles
 * inscriptions, meme si plus de 64 dossiers sont ouverts.
 */
async function countTakenSeats(db: FirebaseFirestore.Firestore): Promise<number> {
  const snap = await db
    .collection(MANIA_CUP_REGISTRATIONS)
    .where('status', '==', 'confirmed')
    .count()
    .get();
  return snap.data().count;
}

// ── GET : de quoi le joueur a-t-il encore besoin ? ───────────────────────────

export async function GET(req: NextRequest) {
  try {
    const db = getAdminDb();
    const [taken, settings] = await Promise.all([
      countTakenSeats(db),
      getManiaCupSettings(db),
    ]);
    const seats = {
      max: settings.maxPlayers,
      taken,
      remaining: Math.max(0, settings.maxPlayers - taken),
    };

    // Le règlement en vigueur voyage avec l'état : la case d'acceptation doit
    // porter le numéro de version que le joueur a réellement sous les yeux.
    const rulebookDoc = await getRulebookByScope(db, { eventSlug: MANIA_CUP_DOCS.rules });
    const rulebook = rulebookDoc ? { version: rulebookDoc.version } : null;

    const uid = await verifyAuth(req);
    if (!uid) {
      return NextResponse.json({
        authenticated: false,
        visible: isManiaCupPublic(),
        seats,
        rulebook,
      });
    }

    // Tant que l'événement n'est pas publié, seuls les admins et les comptes du
    // bac à sable voient l'inscription — même porte que les compétitions en
    // brouillon (canViewHiddenCompetition).
    const visible = isManiaCupPublic() || (await canViewHiddenCompetition(db, uid));

    const [userSnap, regSnap, secretSnap] = await Promise.all([
      db.collection('users').doc(uid).get(),
      db.collection(MANIA_CUP_REGISTRATIONS).doc(uid).get(),
      db.collection('user_secrets').doc(uid).get(),
    ]);

    const user = userSnap.data() ?? {};
    // ATTENTION : `tmAccountId` est aussi écrit par lib/trackmania-sync à partir
    // de l'API publique (trophées, COTD) — il ne prouve donc RIEN. Seul
    // `tmVerifiedAt`, posé par le callback OAuth Nadeo, atteste que le joueur
    // s'est authentifié chez Ubisoft.
    const trackmania = user.tmVerifiedAt
      ? {
          accountId: (user.tmAccountId as string) ?? '',
          displayName: ((user.pseudoTM ?? user.tmDisplayName) as string) ?? '',
        }
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

    // Ce que le profil sait déjà : inutile de le redemander à un joueur qui a
    // un compte depuis la Monthly Cup. La date de naissance vit dans
    // user_secrets (server-only), le pays sur le profil public.
    const prefill = {
      birthDate: (secretSnap.data()?.dateOfBirth as string) ?? '',
      countryCode: (userSnap.data()?.country as string) ?? '',
    };

    return NextResponse.json({
      authenticated: true,
      visible,
      seats,
      rulebook,
      prefill,
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
      firstName?: unknown;
      lastName?: unknown;
      email?: unknown;
      phone?: unknown;
      emergencyName?: unknown;
      emergencyPhone?: unknown;
      imageConsent?: unknown;
      birthDate?: unknown;
      countryCode?: unknown;
      rulebookAccepted?: unknown;
      rulebookVersion?: unknown;
    } | null;
    if (!body) return NextResponse.json({ error: 'Requête invalide' }, { status: 400 });

    const birthDate = typeof body.birthDate === 'string' ? body.birthDate : '';
    const countryCode = typeof body.countryCode === 'string' ? body.countryCode : '';

    if (!/^\d{4}-\d{2}-\d{2}$/.test(birthDate)) {
      return NextResponse.json({ error: 'Date de naissance invalide.' }, { status: 400 });
    }
    if (!countries.some((c) => c.code === countryCode)) {
      return NextResponse.json({ error: 'Pays invalide.' }, { status: 400 });
    }

    // Identité civile. Le pseudo Trackmania suffit au classement, pas à
    // l'accueil : le samedi matin on contrôle une pièce d'identité contre une
    // liste de noms, et un règlement arrivé sans son code ne se retrouve que
    // par le nom du payeur.
    const firstName = clampString(body.firstName, 60).trim();
    const lastName = clampString(body.lastName, 60).trim();
    const email = clampString(body.email, 254).trim();

    if (firstName.length < 2 || lastName.length < 2) {
      return NextResponse.json(
        { error: 'Indique ton prénom et ton nom — ils seront contrôlés à l’accueil.' },
        { status: 400 }
      );
    }
    if (!isPlausibleEmail(email)) {
      return NextResponse.json({ error: 'Adresse e-mail invalide.' }, { status: 400 });
    }

    const phone = clampString(body.phone, 30).trim();
    if (phone && !isPlausiblePhone(phone)) {
      return NextResponse.json({ error: 'Numéro de téléphone invalide.' }, { status: 400 });
    }

    const emergencyName = clampString(body.emergencyName, 80).trim();
    const emergencyPhone = clampString(body.emergencyPhone, 30).trim();
    if (emergencyPhone && !isPlausiblePhone(emergencyPhone)) {
      return NextResponse.json(
        { error: 'Numéro du contact d’urgence invalide.' },
        { status: 400 }
      );
    }

    // Acceptation du règlement. On vérifie la VERSION et pas seulement la case :
    // un joueur ayant laissé son onglet ouvert pendant une republication
    // accepterait sinon un texte qu'il n'a jamais lu.
    const rulebook = await getRulebookByScope(getAdminDb(), { eventSlug: MANIA_CUP_DOCS.rules });
    if (rulebook) {
      if (body.rulebookAccepted !== true) {
        return NextResponse.json(
          { error: 'Tu dois accepter le règlement pour t’inscrire.' },
          { status: 400 }
        );
      }
      if (body.rulebookVersion !== rulebook.version) {
        return NextResponse.json(
          { error: 'Le règlement a été mis à jour. Recharge la page et relis-le avant de valider.' },
          { status: 409 }
        );
      }
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
    if (!user.tmVerifiedAt || !tmAccountId) {
      return NextResponse.json(
        { error: 'Connecte d’abord ton compte Trackmania.' },
        { status: 409 }
      );
    }

    // Jauge : on ne refuse que les NOUVELLES inscriptions, jamais la mise à
    // jour d'un dossier déjà déposé (sinon un joueur inscrit ne pourrait plus
    // corriger sa date de naissance une fois les 64 places prises).
    if (!existing.exists) {
      const [taken, settings] = await Promise.all([
        countTakenSeats(db),
        getManiaCupSettings(db),
      ]);
      if (taken >= settings.maxPlayers) {
        return NextResponse.json(
          {
          error:
            `Les ${settings.maxPlayers} places sont réglées, l’événement est complet. Contacte l’organisation sur le Discord Springs pour la liste d’attente.`,
        },
          { status: 409 }
        );
      }
    }

    const prev = existing.exists ? (existing.data() as ManiaCupRegistration) : null;
    const guardianNeeded = needsGuardianConsent(age);

    // Un mineur reste deux jours dans une salle sans ses parents : l'accueil
    // doit pouvoir joindre quelqu'un qui n'est pas sur place.
    if (guardianNeeded && (!emergencyName || !emergencyPhone)) {
      return NextResponse.json(
        {
          error:
            'Indique un contact d’urgence (nom et téléphone) — il est obligatoire pour les moins de 18 ans.',
        },
        { status: 400 }
      );
    }

    // Le code d'inscription est réservé dans une collection dédiée : c'est ce
    // qui garantit qu'il est unique, et ce qui permettra au webhook HelloAsso
    // de retrouver le dossier en une seule lecture.
    const registrationCode = await allocateRegistrationCode(db, uid);

    const payload: Partial<ManiaCupRegistration> & { updatedAt: unknown } = {
      uid,
      discordId: discordIdFromUid(uid),
      tmAccountId,
      tmDisplayName: ((user.pseudoTM ?? user.tmDisplayName) as string) ?? '',
      firstName,
      lastName,
      email,
      phone: phone || null,
      emergencyContact: emergencyName && emergencyPhone
        ? { name: emergencyName, phone: emergencyPhone }
        : null,
      birthDate,
      ageAtEvent: age,
      countryCode,
      // Le statut est piloté par le paiement (webhook HelloAsso) et par la
      // relecture de l'autorisation parentale — jamais par le formulaire.
      // Une inscription retirée puis reprise repart à zéro : sans ça elle
      // resterait 'cancelled' et ne compterait jamais dans la jauge.
      status: prev?.status && prev.status !== 'cancelled' ? prev.status : 'pending_payment',
      guardianConsent: guardianNeeded
        ? prev?.guardianConsent && prev.guardianConsent !== 'not_required'
          ? prev.guardianConsent
          : 'missing'
        : 'not_required',
      registrationCode,
      updatedAt: FieldValue.serverTimestamp(),
    };
    if (!prev) payload.createdAt = FieldValue.serverTimestamp();

    // Le droit à l'image se donne et se retire : on enregistre la réponse
    // telle qu'elle est cochée, avec sa date. Un refus n'empêche pas de jouer,
    // il change le badge et la consigne donnée au cadreur.
    const imageConsent = body.imageConsent === true;
    if (imageConsent !== Boolean(prev?.imageConsent?.accepted) || !prev?.imageConsent) {
      payload.imageConsent = { accepted: imageConsent, at: FieldValue.serverTimestamp() };
    }

    // Trace opposable de l'acceptation du règlement : la version, la date et
    // l'auteur. Le modèle l'annonçait, mais rien ne l'écrivait — un litige sur
    // « je n'ai jamais accepté ça » n'aurait rien eu à opposer.
    if (rulebook && !prev?.rulebookAccepted) {
      payload.rulebookAccepted = {
        version: rulebook.version,
        at: FieldValue.serverTimestamp(),
        byUid: uid,
      };
    }

    await docRef.set(payload, { merge: true });

    const saved = await docRef.get();
    return NextResponse.json({ registration: saved.data() });
  } catch (err) {
    captureApiError('mania-cup/register:POST', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}

// ── DELETE : le joueur retire son inscription ────────────────────────────────
//
// Possible tant que le règlement n'est pas encaissé. Une fois payé, le retrait
// passe par l'organisation : il y a un remboursement à traiter, ce n'est plus
// une simple annulation.
//
// L'inscription n'est pas effacée mais passée en `cancelled` : la trace reste
// (utile en cas de litige sur un paiement), et la place est immédiatement
// rendue à la jauge, qui ne compte que `pending_payment` et `confirmed`.

export async function DELETE(req: NextRequest) {
  try {
    const uid = await verifyAuth(req);
    if (!uid) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

    const blocked = await checkRateLimit(limiters.write, rateLimitKey(req, uid));
    if (blocked) return blocked;

    const db = getAdminDb();
    const docRef = db.collection(MANIA_CUP_REGISTRATIONS).doc(uid);
    const snap = await docRef.get();
    if (!snap.exists) {
      return NextResponse.json({ error: 'Aucune inscription à retirer.' }, { status: 404 });
    }

    const reg = snap.data() as ManiaCupRegistration;
    if (reg.status === 'confirmed') {
      return NextResponse.json(
        {
          error:
            'Ton inscription est déjà réglée. Contacte l’organisation sur le Discord Springs pour l’annuler et demander un remboursement.',
        },
        { status: 409 }
      );
    }

    // Les pièces d'un dossier retiré n'ont plus de raison d'être conservées :
    // on ne garde pas les papiers d'identité de quelqu'un qui ne vient plus.
    // Les références des titres partent avec, pour la même raison — elles
    // n'ont d'intérêt que rattachées à une participation effective.
    const keys = Object.values(reg.guardianDocs ?? {})
      .map((d) => d?.key)
      .filter((k): k is string => Boolean(k));
    for (const key of keys) await deleteFileSilent(key);
    await db.collection(MANIA_CUP_IDENTITY).doc(uid).delete().catch(() => {});

    await docRef.update({
      status: 'cancelled',
      guardianDocs: FieldValue.delete(),
      guardianConsent: 'not_required',
      updatedAt: FieldValue.serverTimestamp(),
    });

    // Le code retourne au pot commun. Le garder réservé le retirerait du
    // tirage pour rien, et laisserait un règlement tardif se rattacher à un
    // dossier que le joueur a lui-même retiré.
    await releaseRegistrationCode(db, reg.registrationCode, uid);

    return NextResponse.json({ ok: true });
  } catch (err) {
    captureApiError('mania-cup/register:DELETE', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
