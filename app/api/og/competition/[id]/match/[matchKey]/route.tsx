import { ImageResponse } from 'next/og';
import { NextRequest } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { captureApiError } from '@/lib/sentry';
import { isCompetitionHidden } from '@/lib/competitions/visibility';
import { getGameColor, getGameLabel } from '@/lib/games-registry';
import {
  AEDRAL_PALETTE,
  hexTextureDataUri,
  initials,
  loadLogoAsPngDataUri,
  loadRajdhani,
  materializeOgResponse,
} from '@/lib/og-helpers';

// Affiche de RÉSULTAT d'un match de compétition — l'image que les équipes
// republient sur leurs réseaux. Même mécanique que l'affiche de rencontre d'un
// événement de structure (app/api/og/match) : une URL publique jointe au
// message Discord, que Discord charge lui-même.
//
// Deux formats, parce que les réseaux n'ont pas le même :
//   - par défaut 1200×630 (16:9), pour X et l'embed Discord ;
//   - ?format=square → 1080×1080, pour Instagram.
//
// Route PUBLIQUE mais gatée sur la visibilité de la compétition : une compét
// masquée (brouillon, bac à sable) ne doit pas laisser deviner ses résultats.
// Rien de sensible n'y figure de toute façon — noms, logos et score sont déjà
// publics sur la fiche du tournoi.

export const runtime = 'nodejs';

const WIDE = { w: 1200, h: 630 };
const SQUARE = { w: 1080, h: 1080 };

/** Manches gagnées par camp, depuis les manches finales du match. */
function gamesWon(scores: Array<{ a?: number; b?: number }> | null): { a: number; b: number } {
  if (!Array.isArray(scores)) return { a: 0, b: 0 };
  let a = 0, b = 0;
  for (const g of scores) {
    if ((g?.a ?? 0) > (g?.b ?? 0)) a += 1;
    else if ((g?.b ?? 0) > (g?.a ?? 0)) b += 1;
  }
  return { a, b };
}

function formatDate(ms: number): string {
  return new Date(ms).toLocaleDateString('fr-FR', {
    day: '2-digit', month: 'long', year: 'numeric', timeZone: 'Europe/Paris',
  }).toUpperCase();
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; matchKey: string }> },
) {
  try {
    const { id, matchKey } = await params;
    const square = req.nextUrl.searchParams.get('format') === 'square';
    const { w: WIDTH, h: HEIGHT } = square ? SQUARE : WIDE;

    const db = getAdminDb();
    const [compSnap, matchSnap] = await Promise.all([
      db.collection('competitions').doc(id).get(),
      db.collection('competition_matches').doc(`${id}__${matchKey}`).get(),
    ]);
    if (!compSnap.exists || !matchSnap.exists) {
      return new Response('Not found', { status: 404 });
    }
    const comp = compSnap.data()!;
    // Compétition masquée : pas d'oracle, même sur une image.
    if (isCompetitionHidden(comp)) return new Response('Not found', { status: 404 });

    const match = matchSnap.data()!;
    if (!match.teamA || !match.teamB) return new Response('Not found', { status: 404 });

    const [regA, regB] = await db.getAll(
      db.collection('competition_registrations').doc(match.teamA as string),
      db.collection('competition_registrations').doc(match.teamB as string),
    );
    const a = regA.data() ?? {};
    const b = regB.data() ?? {};
    const nameA = (a.name as string) || 'Équipe A';
    const nameB = (b.name as string) || 'Équipe B';

    const won = gamesWon((match.scores?.final as Array<{ a?: number; b?: number }>) ?? null);
    const winner = (match.winner as 'a' | 'b' | null) ?? null;
    const forfeit = (match.forfeit as 'a' | 'b' | 'both' | null) ?? null;

    const gameId = (comp.game as string) ?? 'rocket_league';
    const gameColor = getGameColor(gameId);
    const gameLabel = getGameLabel(gameId).toUpperCase();
    const organizer = (comp.organizerName as string)
      || ((comp.organizer as { name?: string } | null)?.name ?? null);

    const endedMs = match.updatedAt?.toMillis?.() ?? Date.now();
    const [logoA, logoB] = await Promise.all([
      loadLogoAsPngDataUri(a.logoUrl as string | null),
      loadLogoAsPngDataUri(b.logoUrl as string | null),
    ]);

    const font = loadRajdhani();
    const ff = font ? 'Rajdhani' : 'sans-serif';
    const hexUri = hexTextureDataUri(WIDTH, HEIGHT);

    // Le format carré est plus haut que large : on resserre pour que le
    // face-à-face garde la même respiration dans les deux.
    const logoSize = square ? 210 : 190;
    const nameSize = square ? 40 : 36;
    const scoreSize = square ? 150 : 140;

    const Side = ({ name, logo, isWinner }: { name: string; logo: string | null; isWinner: boolean }) => (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: square ? 380 : 400 }}>
        {/* `boxShadow: 'none'` est rendu par satori comme une ombre noire pleine,
            calée en haut à gauche de l'image : la propriété doit être ABSENTE
            quand il n'y a pas de glow, pas mise à « none ». */}
        <div style={{
          width: logoSize, height: logoSize, display: 'flex',
          alignItems: 'center', justifyContent: 'center',
          background: AEDRAL_PALETTE.surface,
          border: `2px solid ${isWinner ? AEDRAL_PALETTE.gold : 'rgba(255,255,255,0.10)'}`,
          ...(isWinner ? { boxShadow: '0 0 40px rgba(255,184,0,0.25)' } : {}),
        }}>
          {logo
            ? /* eslint-disable-next-line @next/next/no-img-element */
              <img src={logo} width={logoSize - 30} height={logoSize - 30} alt="" style={{ objectFit: 'contain' }} />
            : <div style={{ fontSize: 64, color: AEDRAL_PALETTE.textDim, fontFamily: ff, display: 'flex' }}>{initials(name)}</div>}
        </div>
        <div style={{
          marginTop: 22, fontSize: nameSize, fontFamily: ff, display: 'flex',
          color: isWinner ? AEDRAL_PALETTE.text : AEDRAL_PALETTE.textDim,
          letterSpacing: '2px', maxWidth: square ? 360 : 380,
          overflow: 'hidden', whiteSpace: 'nowrap',
        }}>
          {name.toUpperCase()}
        </div>
      </div>
    );

    const img = new ImageResponse(
      (
        <div style={{
          width: WIDTH, height: HEIGHT, display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center', position: 'relative',
          background: AEDRAL_PALETTE.backgroundGradient,
        }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={hexUri} width={WIDTH} height={HEIGHT} alt="" style={{ position: 'absolute', top: 0, left: 0 }} />
          <div style={{
            position: 'absolute', top: 0, left: 0, right: 0, height: 6,
            background: AEDRAL_PALETTE.goldBarGradient, display: 'flex',
          }} />
          {/* Coins HUD, signature des affiches Aedral */}
          <div style={{ position: 'absolute', top: 24, left: 24, width: 40, height: 40, borderTop: '2px solid rgba(255,184,0,0.65)', borderLeft: '2px solid rgba(255,184,0,0.65)', display: 'flex' }} />
          <div style={{ position: 'absolute', top: 24, right: 24, width: 40, height: 40, borderTop: '2px solid rgba(255,184,0,0.65)', borderRight: '2px solid rgba(255,184,0,0.65)', display: 'flex' }} />
          <div style={{ position: 'absolute', bottom: 24, left: 24, width: 40, height: 40, borderBottom: '2px solid rgba(255,184,0,0.65)', borderLeft: '2px solid rgba(255,184,0,0.65)', display: 'flex' }} />
          <div style={{ position: 'absolute', bottom: 24, right: 24, width: 40, height: 40, borderBottom: '2px solid rgba(255,184,0,0.65)', borderRight: '2px solid rgba(255,184,0,0.65)', display: 'flex' }} />

          {/* En-tête : la compétition, et qui l'organise */}
          <div style={{
            position: 'absolute', top: square ? 70 : 56, display: 'flex',
            flexDirection: 'column', alignItems: 'center', gap: 8,
          }}>
            <div style={{ fontSize: square ? 42 : 38, fontFamily: ff, color: AEDRAL_PALETTE.text, letterSpacing: '3px', display: 'flex' }}>
              {((comp.name as string) ?? '').toUpperCase()}
            </div>
            {organizer && (
              <div style={{ fontSize: 20, fontFamily: ff, color: AEDRAL_PALETTE.textDim, letterSpacing: '4px', display: 'flex' }}>
                PAR {organizer.toUpperCase()}
              </div>
            )}
          </div>

          {/* Face-à-face et score */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Side name={nameA} logo={logoA} isWinner={winner === 'a'} />
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: square ? '0 20px' : '0 30px' }}>
              <div style={{
                fontSize: scoreSize, fontFamily: ff, color: AEDRAL_PALETTE.gold,
                letterSpacing: '4px', lineHeight: 1, display: 'flex',
                textShadow: '0 0 30px rgba(255,184,0,0.55), 0 0 70px rgba(255,184,0,0.3)',
              }}>
                {won.a}–{won.b}
              </div>
              {forfeit && (
                <div style={{ marginTop: 12, fontSize: 22, fontFamily: ff, color: AEDRAL_PALETTE.textDim, letterSpacing: '3px', display: 'flex' }}>
                  {forfeit === 'both' ? 'DOUBLE FORFAIT' : 'FORFAIT'}
                </div>
              )}
            </div>
            <Side name={nameB} logo={logoB} isWinner={winner === 'b'} />
          </div>

          {/* Pied : date, jeu, marque */}
          <div style={{
            position: 'absolute', bottom: square ? 70 : 54, display: 'flex',
            alignItems: 'center', gap: 20, fontSize: 22, fontFamily: ff, letterSpacing: '3px',
          }}>
            <span style={{ color: AEDRAL_PALETTE.textDim, display: 'flex' }}>{formatDate(endedMs)}</span>
            <span style={{ color: 'rgba(255,255,255,0.15)', display: 'flex' }}>|</span>
            <span style={{ color: gameColor, display: 'flex' }}>{gameLabel}</span>
            <span style={{ color: 'rgba(255,255,255,0.15)', display: 'flex' }}>|</span>
            <span style={{ color: AEDRAL_PALETTE.gold, display: 'flex' }}>AEDRAL</span>
          </div>
        </div>
      ),
      {
        width: WIDTH,
        height: HEIGHT,
        ...(font ? { fonts: [{ name: 'Rajdhani', data: font, weight: 700 as const, style: 'normal' as const }] } : {}),
        headers: {
          // Un résultat ne change plus : cache long, et Discord ne rappelle
          // l'URL qu'une fois de toute façon.
          'Cache-Control': 'public, max-age=86400, s-maxage=86400, immutable',
        },
      },
    );
    return materializeOgResponse(img);
  } catch (err) {
    captureApiError('API og/competition-match error', err);
    return new Response('Erreur', { status: 500 });
  }
}
