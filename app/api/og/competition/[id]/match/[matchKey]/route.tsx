import { ImageResponse } from 'next/og';
import { NextRequest } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { captureApiError } from '@/lib/sentry';
import { isCompetitionHidden } from '@/lib/competitions/visibility';
import { getGameColor, getGameLabel } from '@/lib/games-registry';
import { roundLabel } from '@/lib/competitions/round-labels';
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

    // L'organisateur vit sur la compétition quand elle est isolée, sur le
    // CIRCUIT quand elle en fait partie (une étape appartient à l'orga du
    // circuit). Sans ce repli, une Qualif de la Legends n'aurait affiché
    // aucun organisateur.
    let organizer = (comp.organizer as { name?: string } | null)?.name ?? null;
    let circuitName: string | null = null;
    if (comp.circuitId) {
      const circuit = (await db.collection('circuits').doc(comp.circuitId as string).get()).data();
      circuitName = (circuit?.name as string) ?? null;
      if (!organizer) organizer = (circuit?.organizer as { name?: string } | null)?.name ?? null;
    }

    // Nom du tour : « Quarts », « Finale »… Une affiche de résultat sans le
    // stade du tournoi ne dit pas grand-chose.
    const allMatches = await db.collection('competition_matches')
      .where('competitionId', '==', id).select('round', 'bracket').get();
    const totalRounds = allMatches.docs.reduce((max, d) => {
      const r = d.data().round;
      return d.data().bracket === 'winners' && typeof r === 'number' ? Math.max(max, r) : max;
    }, 0);
    const roundName = (match.bracket === 'winners' && typeof match.round === 'number' && totalRounds > 0)
      ? roundLabel(match.round as number, totalRounds)
      : null;

    const endedMs = match.updatedAt?.toMillis?.() ?? Date.now();
    const [logoA, logoB] = await Promise.all([
      loadLogoAsPngDataUri(a.logoUrl as string | null),
      loadLogoAsPngDataUri(b.logoUrl as string | null),
    ]);

    const font = loadRajdhani();
    const ff = font ? 'Rajdhani' : 'sans-serif';
    const hexUri = hexTextureDataUri(WIDTH, HEIGHT);

    // Le format carré est plus haut que large : mêmes proportions relatives,
    // valeurs resserrées pour garder la même respiration dans les deux.
    const logoSize = square ? 250 : 220;
    const nameSize = square ? 38 : 34;
    const scoreSize = square ? 170 : 155;
    const sideWidth = square ? 400 : 420;
    const games = (match.scores?.final as Array<{ a?: number; b?: number }>) ?? [];

    /** Un camp. Le perdant est atténué, pas effacé : on doit lire les deux. */
    const Side = ({ name, logo, isWinner }: { name: string; logo: string | null; isWinner: boolean }) => (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: sideWidth }}>
        {/* `boxShadow: 'none'` est rendu par satori comme une ombre noire pleine,
            calée en haut à gauche de l'image : la propriété doit être ABSENTE
            quand il n'y a pas de glow, pas mise à « none ». */}
        <div style={{
          width: logoSize, height: logoSize, display: 'flex',
          alignItems: 'center', justifyContent: 'center',
          background: isWinner ? 'rgba(255,184,0,0.05)' : AEDRAL_PALETTE.surface,
          border: `2px solid ${isWinner ? AEDRAL_PALETTE.gold : 'rgba(255,255,255,0.08)'}`,
          ...(isWinner ? { boxShadow: '0 0 60px rgba(255,184,0,0.22)' } : {}),
        }}>
          {logo
            ? /* eslint-disable-next-line @next/next/no-img-element */
              <img src={logo} width={logoSize - 40} height={logoSize - 40} alt="" style={{ objectFit: 'contain' }} />
            : <div style={{ fontSize: 72, color: isWinner ? AEDRAL_PALETTE.textDim : '#4a4a5e', fontFamily: ff, display: 'flex' }}>{initials(name)}</div>}
        </div>
        <div style={{
          marginTop: 20, fontSize: nameSize, fontFamily: ff, display: 'flex',
          color: isWinner ? AEDRAL_PALETTE.text : AEDRAL_PALETTE.textDim,
          letterSpacing: '2px', maxWidth: sideWidth - 20,
          overflow: 'hidden', whiteSpace: 'nowrap',
        }}>
          {name.toUpperCase()}
        </div>
        {/* Le vainqueur est NOMMÉ, pas seulement suggéré par une couleur.
            Hauteur réservée des deux côtés pour que les noms restent alignés. */}
        <div style={{
          marginTop: 10, height: 22, display: 'flex', alignItems: 'center',
          fontSize: 15, fontFamily: ff, letterSpacing: '4px',
          color: isWinner ? AEDRAL_PALETTE.gold : 'transparent',
        }}>
          {isWinner ? 'VAINQUEUR' : '·'}
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

          {/* Halo du côté vainqueur : c'est lui qui porte l'affiche, et ça
              évite une image symétrique où rien ne ressort. */}
          {winner && (
            <div style={{
              position: 'absolute', top: '50%',
              ...(winner === 'a' ? { left: square ? 40 : 70 } : { right: square ? 40 : 70 }),
              width: 540, height: 540, transform: 'translateY(-50%)',
              background: 'radial-gradient(circle, rgba(255,184,0,0.10) 0%, rgba(255,184,0,0.03) 45%, transparent 70%)',
              display: 'flex',
            }} />
          )}

          <div style={{
            position: 'absolute', top: 0, left: 0, right: 0, height: 6,
            background: AEDRAL_PALETTE.goldBarGradient, display: 'flex',
          }} />
          {/* Coins HUD, signature des affiches Aedral */}
          <div style={{ position: 'absolute', top: 24, left: 24, width: 40, height: 40, borderTop: '2px solid rgba(255,184,0,0.65)', borderLeft: '2px solid rgba(255,184,0,0.65)', display: 'flex' }} />
          <div style={{ position: 'absolute', top: 24, right: 24, width: 40, height: 40, borderTop: '2px solid rgba(255,184,0,0.65)', borderRight: '2px solid rgba(255,184,0,0.65)', display: 'flex' }} />
          <div style={{ position: 'absolute', bottom: 24, left: 24, width: 40, height: 40, borderBottom: '2px solid rgba(255,184,0,0.65)', borderLeft: '2px solid rgba(255,184,0,0.65)', display: 'flex' }} />
          <div style={{ position: 'absolute', bottom: 24, right: 24, width: 40, height: 40, borderBottom: '2px solid rgba(255,184,0,0.65)', borderRight: '2px solid rgba(255,184,0,0.65)', display: 'flex' }} />

          {/* En-tête : le TOUR d'abord (il situe le match dans le tournoi),
              puis la compétition. */}
          <div style={{
            position: 'absolute', top: square ? 64 : 50, display: 'flex',
            flexDirection: 'column', alignItems: 'center', gap: 10,
          }}>
            {circuitName && (
              <div style={{ fontSize: 20, fontFamily: ff, color: AEDRAL_PALETTE.gold, letterSpacing: '6px', display: 'flex' }}>
                {circuitName.toUpperCase()}
              </div>
            )}
            {roundName && (
              <div style={{ fontSize: 18, fontFamily: ff, color: gameColor, letterSpacing: '8px', display: 'flex' }}>
                {roundName.toUpperCase()}
              </div>
            )}
            <div style={{ fontSize: square ? 44 : 40, fontFamily: ff, color: AEDRAL_PALETTE.text, letterSpacing: '3px', display: 'flex' }}>
              {((comp.name as string) ?? '').toUpperCase()}
            </div>
          </div>

          {/* Face-à-face et score */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', marginTop: square ? 26 : 16 }}>
            <Side name={nameA} logo={logoA} isWinner={winner === 'a'} />
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '0 16px' }}>
              <div style={{
                fontSize: scoreSize, fontFamily: ff, color: AEDRAL_PALETTE.gold,
                letterSpacing: '2px', lineHeight: 1, display: 'flex', alignItems: 'center',
                textShadow: '0 0 35px rgba(255,184,0,0.6), 0 0 80px rgba(255,184,0,0.28)',
              }}>
                {won.a}
                <span style={{ color: 'rgba(255,255,255,0.20)', padding: '0 12px', display: 'flex' }}>–</span>
                {won.b}
              </div>
              {/* Le détail des manches sous le score : ce que le chiffre seul ne
                  dit pas, et ce qui rend l'affiche crédible pour un joueur. */}
              {games.length > 0 && !forfeit && (
                <div style={{ marginTop: 16, display: 'flex', gap: 8, alignItems: 'center' }}>
                  {games.slice(0, 7).map((g, i) => (
                    <div key={i} style={{
                      display: 'flex', padding: '5px 11px', fontSize: 18, fontFamily: ff,
                      color: AEDRAL_PALETTE.textDim, letterSpacing: '1px',
                      background: 'rgba(255,255,255,0.04)',
                      border: '1px solid rgba(255,255,255,0.07)',
                    }}>
                      {g?.a ?? 0}-{g?.b ?? 0}
                    </div>
                  ))}
                </div>
              )}
              {forfeit && (
                <div style={{ marginTop: 16, fontSize: 20, fontFamily: ff, color: AEDRAL_PALETTE.textDim, letterSpacing: '4px', display: 'flex' }}>
                  {forfeit === 'both' ? 'DOUBLE FORFAIT' : 'FORFAIT'}
                </div>
              )}
            </div>
            <Side name={nameB} logo={logoB} isWinner={winner === 'b'} />
          </div>

          {/* Pied. L'ORGANISATEUR en tête et en clair : la compétition lui
              appartient, Aedral n'est que l'hébergeur. */}
          <div style={{
            position: 'absolute', bottom: square ? 62 : 46, display: 'flex',
            alignItems: 'center', gap: 16, fontSize: 20, fontFamily: ff, letterSpacing: '3px',
          }}>
            {organizer && (
              <>
                <span style={{ color: AEDRAL_PALETTE.text, display: 'flex' }}>{organizer.toUpperCase()}</span>
                <span style={{ color: 'rgba(255,255,255,0.15)', display: 'flex' }}>|</span>
              </>
            )}
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
