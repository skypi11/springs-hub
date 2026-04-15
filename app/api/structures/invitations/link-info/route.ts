import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb, verifyAuth } from '@/lib/firebase-admin';
import { captureApiError } from '@/lib/sentry';

// GET /api/structures/invitations/link-info?token=xxx
// Retourne les infos d'un lien d'invitation (structure cible + jeu pré-rempli si fourni).
// Utilisé côté /community/join/[token] pour savoir si le picker de jeu est nécessaire.
export async function GET(req: NextRequest) {
  try {
    const uid = await verifyAuth(req);
    if (!uid) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

    const token = req.nextUrl.searchParams.get('token');
    if (!token) return NextResponse.json({ error: 'token requis' }, { status: 400 });

    const db = getAdminDb();

    const linksSnap = await db.collection('structure_invitations')
      .where('type', '==', 'invite_link')
      .where('token', '==', token)
      .where('status', '==', 'active')
      .get();

    if (linksSnap.empty) {
      return NextResponse.json({ error: 'Lien invalide ou expiré' }, { status: 404 });
    }

    const linkData = linksSnap.docs[0].data();

    // Lien ciblé : seul le joueur visé peut l'ouvrir
    if (linkData.targetUserId && linkData.targetUserId !== uid) {
      return NextResponse.json({ error: 'Ce lien d\'invitation n\'est pas pour toi.' }, { status: 403 });
    }

    const structSnap = await db.collection('structures').doc(linkData.structureId).get();
    if (!structSnap.exists || structSnap.data()!.status !== 'active') {
      return NextResponse.json({ error: 'Structure inactive' }, { status: 400 });
    }
    const structData = structSnap.data()!;

    return NextResponse.json({
      structureId: linkData.structureId,
      structureName: structData.name || '',
      structureTag: structData.tag || '',
      structureLogoUrl: structData.logoUrl || '',
      structureGames: structData.games || [],
      presetGame: linkData.game || null,
      targeted: !!linkData.targetUserId,
    });
  } catch (err) {
    captureApiError('API Invitations Link-Info GET error', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
