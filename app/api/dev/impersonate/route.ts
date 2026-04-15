import { NextRequest, NextResponse } from 'next/server';
import { getAdminAuth } from '@/lib/firebase-admin';

// POST /api/dev/impersonate — génère un custom token Firebase pour un uid dev.
// Dev-only : bloqué en production. L'uid cible doit commencer par `discord_dev_`
// pour éviter tout usage détourné (impossibilité de usurper un vrai user).

export async function POST(req: NextRequest) {
  if (process.env.NODE_ENV !== 'development') {
    return NextResponse.json({ error: 'Dev only' }, { status: 403 });
  }

  const { targetUid } = await req.json();
  if (typeof targetUid !== 'string' || !targetUid.startsWith('discord_dev_')) {
    return NextResponse.json({ error: 'Uid dev requis (discord_dev_*)' }, { status: 400 });
  }

  const auth = getAdminAuth();
  try {
    await auth.getUser(targetUid);
  } catch {
    return NextResponse.json({ error: 'Compte dev introuvable — lance /api/dev/seed d\'abord' }, { status: 404 });
  }

  const token = await auth.createCustomToken(targetUid);
  return NextResponse.json({ token });
}
