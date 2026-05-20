import { NextRequest, NextResponse } from 'next/server';

// GET /api/auth/discord/session
// Consomme le cookie httpOnly `aedral_auth` posé par le callback Discord :
// renvoie son contenu (custom token Firebase + infos Discord) UNE fois,
// puis supprime le cookie. Évite d'exposer le custom token dans l'URL
// (logs serveur, historique navigateur, header Referer).
export async function GET(req: NextRequest) {
  const raw = req.cookies.get('aedral_auth')?.value;
  if (!raw) {
    return NextResponse.json({ error: 'no_session' }, { status: 404 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    const bad = NextResponse.json({ error: 'invalid_session' }, { status: 400 });
    bad.cookies.delete('aedral_auth');
    return bad;
  }

  const res = NextResponse.json(payload);
  // Usage unique : on supprime le cookie immédiatement après lecture.
  res.cookies.delete('aedral_auth');
  return res;
}
