import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb, verifyAuth } from '@/lib/firebase-admin';
import { limiters, rateLimitKey, checkRateLimit } from '@/lib/rate-limit';
import { captureApiError } from '@/lib/sentry';
import { canViewHiddenCompetition } from '@/lib/competitions/visibility';
import { getManiaCupSettings } from '@/lib/mania-cup-settings';
import { lireAppartenancesTM } from '@/lib/mania-cup-server';
import {
  MANIA_CUP_REGISTRATIONS,
  isManiaCupPublic,
  type ManiaCupRegistration,
  type PublicRegistration,
} from '@/lib/mania-cup';

// GET /api/mania-cup/participants — liste publique des inscrits.
//
// Ce que cette route expose est délibérément court : pseudo Trackmania, pays,
// et si la place est acquise. RIEN d'autre ne sort — ni date de naissance, ni
// âge, ni identifiant Discord, ni code d'inscription, ni statut du dossier
// parental. La collection contient de la donnée personnelle, on ne sert donc
// pas les documents bruts mais une projection écrite à la main : un champ
// ajouté au modèle demain ne fuitera pas ici par inadvertance.
export async function GET(req: NextRequest) {
  const blocked = await checkRateLimit(limiters.read, rateLimitKey(req));
  if (blocked) return blocked;

  try {
    const db = getAdminDb();

    // Même porte que le reste : tant que l'événement n'est pas publié, la liste
    // n'existe pas pour le public.
    if (!isManiaCupPublic()) {
      const uid = await verifyAuth(req);
      if (!uid || !(await canViewHiddenCompetition(db, uid))) {
        return NextResponse.json({ error: 'not_found' }, { status: 404 });
      }
    }

    const settings = await getManiaCupSettings(db);
    const snap = await db
      .collection(MANIA_CUP_REGISTRATIONS)
      .where('status', 'in', ['pending_payment', 'confirmed'])
      .orderBy('createdAt', 'asc')
      .get();

    // Le drapeau vient du PROFIL, pas de l'inscription.
    //
    // L'inscription copie le pays au moment où elle est déposée. Un joueur qui
    // corrige son pays ensuite — ou l'organisation qui le corrige pour lui —
    // ne voyait rien changer ici : c'est arrivé le 7 août à un joueur suisse
    // affiché avec le drapeau français, et la console n'offrait aucun moyen de
    // le réparer. Une seule source, celle que le joueur entretient.
    //
    // La copie de l'inscription reste en repli : elle sert aux dossiers dont le
    // profil n'a pas de pays, et à l'accueil le jour J.
    const profils = snap.docs.length
      ? await db.getAll(...snap.docs.map((d) => db.collection('users').doc(d.id)))
      : [];
    const paysParUid = new Map(
      profils.map((p) => [p.id, (p.data()?.country as string) || ''])
    );

    // La structure du joueur, s'il en a une. Nom et logo sont déjà publics —
    // l'annuaire des structures les montre à tout le monde. Les équipes, elles,
    // n'ont rien à faire ici : on ne les lit même pas.
    const appartenances = await lireAppartenancesTM(db, profils, { avecEquipe: false });

    const participants: PublicRegistration[] = snap.docs.map((d) => {
      const r = d.data() as ManiaCupRegistration;
      const app = appartenances.get(d.id);
      return {
        tmDisplayName: r.tmDisplayName || '—',
        countryCode: paysParUid.get(d.id) || r.countryCode || 'OTHER',
        status: r.status,
        structure: app ? { name: app.structure, logoUrl: app.logoUrl } : null,
      };
    });

    const confirmed = participants.filter((p) => p.status === 'confirmed').length;

    return NextResponse.json({
      participants,
      counts: {
        confirmed,
        pending: participants.length - confirmed,
        max: settings.maxPlayers,
        // Seules les inscriptions réglées consomment une place : une inscription
        // jamais payée ne doit pas priver quelqu'un d'autre de venir.
        seatsLeft: Math.max(0, settings.maxPlayers - confirmed),
      },
    });
  } catch (err) {
    captureApiError('mania-cup/participants:GET', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
