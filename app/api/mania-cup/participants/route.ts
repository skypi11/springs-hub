import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb, verifyAuth } from '@/lib/firebase-admin';
import { limiters, rateLimitKey, checkRateLimit } from '@/lib/rate-limit';
import { captureApiError } from '@/lib/sentry';
import { canViewHiddenCompetition } from '@/lib/competitions/visibility';
import {
  MANIA_CUP,
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

    const snap = await db
      .collection(MANIA_CUP_REGISTRATIONS)
      .where('status', 'in', ['pending_payment', 'confirmed'])
      .orderBy('createdAt', 'asc')
      .get();

    const participants: PublicRegistration[] = snap.docs.map((d) => {
      const r = d.data() as ManiaCupRegistration;
      return {
        tmDisplayName: r.tmDisplayName || '—',
        countryCode: r.countryCode || 'OTHER',
        status: r.status,
      };
    });

    const confirmed = participants.filter((p) => p.status === 'confirmed').length;

    return NextResponse.json({
      participants,
      counts: {
        confirmed,
        pending: participants.length - confirmed,
        max: MANIA_CUP.maxPlayers,
        // Seules les inscriptions réglées consomment une place : une inscription
        // jamais payée ne doit pas priver quelqu'un d'autre de venir.
        seatsLeft: Math.max(0, MANIA_CUP.maxPlayers - confirmed),
      },
    });
  } catch (err) {
    captureApiError('mania-cup/participants:GET', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
