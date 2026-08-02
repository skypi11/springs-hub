import { ImageResponse } from 'next/og';
import { NextRequest } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { captureApiError } from '@/lib/sentry';
import { isCompetitionHidden } from '@/lib/competitions/visibility';
import { getGameColor, getGameLabel } from '@/lib/games-registry';
import { roundLabel } from '@/lib/competitions/round-labels';
import {
  initials,
  loadLocalBackgroundAsPngDataUri,
  loadLogoAsPngDataUri,
  loadRajdhani,
  materializeOgResponse,
} from '@/lib/og-helpers';

// Affiche de RÉSULTAT d'un match de compétition — l'image que les équipes
// republient sur leurs réseaux. Même mécanique que l'affiche de rencontre d'un
// événement de structure (app/api/og/match) : une URL publique jointe au
// message Discord, que Discord charge lui-même.
//
// Deux formats, parce que les réseaux n'ont pas le même — et deux COMPOSITIONS,
// pas une seule étirée :
//   - par défaut 1200×630 (16:9) en face-à-face horizontal, pour X et Discord ;
//   - ?format=square → 1080×1080 EMPILÉ (vainqueur au-dessus), pour Instagram.
// Un 16:9 recadré en carré laisse un tiers de vide en haut et en bas ; les deux
// mises en page se partagent les données, jamais la grille.
//
// Parti pris visuel : l'affiche appartient à l'ORGANISATEUR, pas à Aedral. Sa
// couleur, son logo, son nom priment ; « aedral.com » tient dans un coin. Et
// elle doit arrêter le scroll : visuel du jeu en fond, diagonale du côté du
// vainqueur, score qui domine — pas une fiche de score centrée et symétrique.
//
// Route PUBLIQUE mais gatée sur la visibilité de la compétition : une compét
// masquée (brouillon, bac à sable) ne doit pas laisser deviner ses résultats.
// Rien de sensible n'y figure de toute façon — noms, logos et score sont déjà
// publics sur la fiche du tournoi.

export const runtime = 'nodejs';

const WIDE = { w: 1200, h: 630 };
const SQUARE = { w: 1080, h: 1080 };

/** Visuel de fond par jeu, dans `public/og-backgrounds/` — un dossier à part
 *  des visuels du site (`rocket-league.webp`, `tm.webp`), qui servent les cards
 *  de compétition et n'ont pas les mêmes contraintes.
 *
 *  Ce que doit être un fond d'affiche, appris à l'usage :
 *   - du 1920×1080 au minimum (le carré 1080×1080 y découpe une fenêtre) ;
 *   - PAS de logo du jeu incrusté (celui de `tm.webp` traversait l'affiche) ;
 *   - une SCÈNE de jeu, pas une bannière de marque — l'ancien `valorant-banner.jpg`
 *     était un logo sur aplat, il aurait donné un fond rouge sans intérêt.
 *
 *  Sans entrée : fond sombre uni, jamais l'image d'un autre jeu. */
const GAME_ART: Record<string, string> = {
  rocket_league: 'og-backgrounds/rocket-league.webp',
  trackmania: 'og-backgrounds/trackmania.webp',
  valorant: 'og-backgrounds/valorant.webp',
};

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
    let orga = (comp.organizer as { name?: string; logoUrl?: string | null } | null) ?? null;
    let circuitName: string | null = null;
    let accent = (comp.accentColor as string | null) ?? null;
    if (comp.circuitId) {
      const circuit = (await db.collection('circuits').doc(comp.circuitId as string).get()).data();
      circuitName = (circuit?.name as string) ?? null;
      if (!orga) orga = (circuit?.organizer as { name?: string; logoUrl?: string | null } | null) ?? null;
      if (!accent) accent = (circuit?.accentColor as string | null) ?? null;
    }
    const organizer = orga?.name ?? null;
    // La couleur de l'affiche est celle de l'ORGANISATEUR, à défaut celle du
    // jeu. L'or d'Aedral n'apparaît plus : une affiche republiée par une équipe
    // doit porter les couleurs du tournoi, pas celles de son hébergeur.
    const ACCENT = accent || gameColor;
    const accentSoft = (alpha: number) => {
      const m = /^#(\w{2})(\w{2})(\w{2})$/.exec(ACCENT);
      if (!m) return `rgba(255,184,0,${alpha})`;
      const [r, g, bl] = [1, 2, 3].map(i => parseInt(m[i], 16));
      return `rgba(${r},${g},${bl},${alpha})`;
    };

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
    const bo = typeof match.bo === 'number' && match.bo > 0 ? `BO${match.bo}` : null;
    const stage = [roundName?.toUpperCase(), bo].filter(Boolean).join(' · ');

    const endedMs = match.updatedAt?.toMillis?.() ?? Date.now();
    const [logoA, logoB, orgaLogo, bgArt] = await Promise.all([
      loadLogoAsPngDataUri(a.logoUrl as string | null),
      loadLogoAsPngDataUri(b.logoUrl as string | null),
      loadLogoAsPngDataUri(orga?.logoUrl ?? null),
      GAME_ART[gameId]
        // Attention au cumul : la vignette posée par-dessus assombrit ENCORE,
        // les deux se multiplient. À 0.78 il ne restait que ~7 % de l'image et
        // à 0.55 environ 25 % — dans les deux cas on ne distinguait pas le jeu.
        // Mais éclaircir révèle le bruit de compression de la source : 0.45 est
        // le point où le jeu se voit sans que ses artefacts se voient aussi.
        ? loadLocalBackgroundAsPngDataUri(GAME_ART[gameId], WIDTH, HEIGHT, 0.45, 'bottom')
        : Promise.resolve(null),
    ]);

    const font = loadRajdhani();
    const ff = font ? 'Rajdhani' : 'sans-serif';
    const games = (match.scores?.final as Array<{ a?: number; b?: number }>) ?? [];

    // Le vainqueur écrase visuellement le perdant : logo plus grand, nom plus
    // grand, pleine lumière. C'est ce déséquilibre qui fait la différence entre
    // une affiche et un tableau de scores — mais l'ordre A/B du bracket est
    // conservé, on ne réordonne pas les camps pour mettre le gagnant à gauche.
    const S = square
      ? { logoWin: 175, logoLose: 135, nameWin: 50, nameLose: 36, score: 185 }
      : { logoWin: 210, logoLose: 165, nameWin: 46, nameLose: 34, score: 170 };

    /** Un camp : le logo (ou ses initiales en très grand) puis le nom. */
    const Side = ({ name, logo, isWinner }: { name: string; logo: string | null; isWinner: boolean }) => {
      const size = isWinner ? S.logoWin : S.logoLose;
      return (
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center',
          width: square ? 620 : 400, position: 'relative',
        }}>
          {/* Halo derrière le seul vainqueur — la lumière désigne le camp. */}
          {isWinner && (
            <div style={{
              position: 'absolute', top: size / 2 - 190, left: (square ? 620 : 400) / 2 - 190,
              width: 380, height: 380, display: 'flex',
              background: `radial-gradient(circle, ${accentSoft(0.30)} 0%, ${accentSoft(0.08)} 45%, transparent 70%)`,
            }} />
          )}
          {/* Hauteur réservée à la taille du VAINQUEUR en face-à-face, pour que
              les deux noms restent sur la même ligne. En pile (carré) cette
              réserve ne sert plus qu'à creuser un trou sous le perdant. */}
          <div style={{
            ...(square ? {} : { height: S.logoWin }),
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            {logo
              ? /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={logo} width={size} height={size} alt=""
                  style={{ objectFit: 'contain', ...(isWinner ? {} : { opacity: 0.5 }) }}
                />
              : <div style={{
                  fontSize: isWinner ? 120 : 92, fontFamily: ff, display: 'flex',
                  color: isWinner ? 'rgba(255,255,255,0.85)' : 'rgba(255,255,255,0.3)',
                  letterSpacing: '4px', textShadow: '0 2px 22px rgba(0,0,0,0.95)',
                }}>{initials(name)}</div>}
          </div>
          <div style={{
            marginTop: 22, fontSize: isWinner ? S.nameWin : S.nameLose, fontFamily: ff, display: 'flex',
            color: isWinner ? '#ffffff' : 'rgba(255,255,255,0.38)',
            letterSpacing: '2px', maxWidth: (square ? 620 : 400) - 20,
            overflow: 'hidden', whiteSpace: 'nowrap',
            // Ombre portée sur les DEUX camps : le fond est un visuel de jeu,
            // il peut être clair juste derrière un nom (une voiture orange
            // suffit à noyer le perdant). Le glow d'accent s'y ajoute pour le
            // seul vainqueur.
            textShadow: isWinner
              ? `0 2px 18px rgba(0,0,0,0.95), 0 0 40px ${accentSoft(0.5)}`
              : '0 2px 18px rgba(0,0,0,0.95)',
          }}>
            {name.toUpperCase()}
          </div>
          {/* Le vainqueur est NOMMÉ, pas seulement suggéré par une couleur. */}
          <div style={{
            marginTop: 12, display: 'flex', alignItems: 'center',
            ...(square && !isWinner ? { height: 0 } : { height: 26 }),
          }}>
            {isWinner && (
              <div style={{
                display: 'flex', alignItems: 'center', padding: '4px 16px',
                background: ACCENT, fontSize: 16, fontFamily: ff,
                color: '#0a0a0a', letterSpacing: '4px',
              }}>
                VAINQUEUR
              </div>
            )}
          </div>
        </div>
      );
    };

    /** Le stade du tournoi : « QUARTS · BO5 ». Au-dessus du score en 16:9 ; en
     *  carré il remonte sous l'en-tête, sinon trois badges s'empilent d'affilée
     *  (VAINQUEUR, le stade, le score) et la pile perd toute hiérarchie. */
    const StageBadge = () => (
      <div style={{
        display: 'flex', padding: '5px 18px',
        border: `1px solid ${accentSoft(0.45)}`, background: accentSoft(0.10),
        fontSize: 17, fontFamily: ff, color: ACCENT, letterSpacing: '5px',
      }}>
        {stage}
      </div>
    );

    /** Le score, et sous lui ce que le chiffre seul ne dit pas. */
    const Score = () => (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        {stage && !square && (
          <div style={{ display: 'flex', marginBottom: 12 }}><StageBadge /></div>
        )}
        <div style={{
          fontSize: S.score, fontFamily: ff, letterSpacing: '2px', lineHeight: 1,
          display: 'flex', alignItems: 'center', color: '#ffffff',
          textShadow: '0 6px 40px rgba(0,0,0,0.9)',
        }}>
          <span style={{ display: 'flex', color: winner === 'a' ? ACCENT : 'rgba(255,255,255,0.45)' }}>{won.a}</span>
          <span style={{ color: 'rgba(255,255,255,0.18)', padding: '0 14px', display: 'flex' }}>–</span>
          <span style={{ display: 'flex', color: winner === 'b' ? ACCENT : 'rgba(255,255,255,0.45)' }}>{won.b}</span>
        </div>
        {games.length > 0 && !forfeit && (
          <div style={{ marginTop: 14, display: 'flex', gap: 8, alignItems: 'center' }}>
            {games.slice(0, 7).map((g, i) => (
              <div key={i} style={{
                display: 'flex', padding: '5px 12px', fontSize: 18, fontFamily: ff,
                color: 'rgba(255,255,255,0.55)', letterSpacing: '1px',
                background: 'rgba(0,0,0,0.62)',
                border: '1px solid rgba(255,255,255,0.10)',
              }}>
                {g?.a ?? 0}-{g?.b ?? 0}
              </div>
            ))}
          </div>
        )}
        {forfeit && (
          <div style={{
            marginTop: 14, display: 'flex', padding: '6px 18px',
            border: '1px solid rgba(255,255,255,0.18)',
            fontSize: 20, fontFamily: ff, color: 'rgba(255,255,255,0.6)', letterSpacing: '4px',
          }}>
            {forfeit === 'both' ? 'DOUBLE FORFAIT' : 'FORFAIT'}
          </div>
        )}
      </div>
    );

    const img = new ImageResponse(
      (
        <div style={{
          width: WIDTH, height: HEIGHT, display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center', position: 'relative',
          background: '#07070b',
        }}>
          {/* Visuel du jeu en fond — c'est lui qui donne de la matière ; sans
              image, l'affiche reste un rectangle noir qu'on scrolle. */}
          {bgArt && (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img src={bgArt} width={WIDTH} height={HEIGHT} alt="" style={{ position: 'absolute', top: 0, left: 0 }} />
          )}
          {/* Vignette en deux couches. Le visuel doit se deviner, pas se lire :
              un fond trop présent fait passer le logo du jeu DEVANT celui des
              équipes, et le score cesse d'être lisible. */}
          <div style={{
            position: 'absolute', top: 0, left: 0, width: WIDTH, height: HEIGHT, display: 'flex',
            background: 'linear-gradient(180deg, rgba(5,5,9,0.93) 0%, rgba(5,5,9,0.22) 38%, rgba(5,5,9,0.30) 66%, rgba(5,5,9,0.94) 100%)',
          }} />
          <div style={{
            position: 'absolute', top: 0, left: 0, width: WIDTH, height: HEIGHT, display: 'flex',
            background: 'radial-gradient(ellipse at center, rgba(5,5,9,0.00) 0%, rgba(5,5,9,0.22) 58%, rgba(5,5,9,0.70) 100%)',
          }} />

          {/* Diagonale du côté du vainqueur : la seule chose qui casse la
              symétrie, et donc ce qui fait qu'on voit un camp avant l'autre. */}
          {winner && !square && (
            <div style={{
              position: 'absolute', top: -60, height: HEIGHT + 120, width: 620,
              ...(winner === 'a' ? { left: -190 } : { right: -190 }),
              transform: 'skewX(-11deg)', display: 'flex',
              background: winner === 'a'
                ? `linear-gradient(90deg, ${accentSoft(0.40)} 0%, ${accentSoft(0.08)} 62%, transparent 100%)`
                : `linear-gradient(270deg, ${accentSoft(0.40)} 0%, ${accentSoft(0.08)} 62%, transparent 100%)`,
            }} />
          )}
          {winner && square && (
            <div style={{
              position: 'absolute', left: -60, width: WIDTH + 120, height: 520,
              ...(winner === 'a' ? { top: -160 } : { bottom: -160 }),
              transform: 'skewY(-6deg)', display: 'flex',
              background: winner === 'a'
                ? `linear-gradient(180deg, ${accentSoft(0.28)} 0%, ${accentSoft(0.05)} 70%, transparent 100%)`
                : `linear-gradient(0deg, ${accentSoft(0.28)} 0%, ${accentSoft(0.05)} 70%, transparent 100%)`,
            }} />
          )}

          <div style={{
            position: 'absolute', top: 0, left: 0, right: 0, height: 7, display: 'flex',
            background: `linear-gradient(90deg, ${ACCENT} 0%, ${accentSoft(0.35)} 50%, ${ACCENT} 100%)`,
          }} />

          {/* En-tête : l'ORGANISATEUR à gauche avec son logo — c'est SON tournoi
              et c'est ce qu'une équipe republie —, le tournoi à droite. Deux
              ancrages aux extrémités valent mieux qu'une pile centrée qui pousse
              tout le reste vers le bas. */}
          <div style={{
            position: 'absolute', top: 7, left: 0, right: 0,
            height: square ? 108 : 92, padding: square ? '0 56px' : '0 52px',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            borderBottom: '1px solid rgba(255,255,255,0.09)',
            background: 'linear-gradient(180deg, rgba(0,0,0,0.55) 0%, transparent 100%)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              {orgaLogo && (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img src={orgaLogo} width={46} height={46} alt="" style={{ objectFit: 'contain' }} />
              )}
              {organizer && (
                <span style={{
                  fontSize: square ? 26 : 23, fontFamily: ff, color: '#ffffff',
                  letterSpacing: '5px', display: 'flex',
                }}>
                  {organizer.toUpperCase()}
                </span>
              )}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
              {circuitName && (
                <span style={{
                  fontSize: 17, fontFamily: ff, color: ACCENT, letterSpacing: '5px', display: 'flex',
                }}>
                  {circuitName.toUpperCase()}
                </span>
              )}
              <span style={{
                fontSize: square ? 32 : 28, fontFamily: ff, color: 'rgba(255,255,255,0.92)',
                letterSpacing: '3px', display: 'flex',
              }}>
                {(comp.name as string).toUpperCase()}
              </span>
            </div>
          </div>

          {/* Corps. En 16:9 le face-à-face est horizontal ; en carré il est
              EMPILÉ — un carré rempli, pas un 16:9 avec du vide au-dessus et
              en dessous. */}
          {square ? (
            <div style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center', marginTop: 56,
            }}>
              {stage && <div style={{ display: 'flex', marginBottom: 26 }}><StageBadge /></div>}
              <Side name={nameA} logo={logoA} isWinner={winner === 'a'} />
              <div style={{ margin: '10px 0 14px', display: 'flex' }}><Score /></div>
              <Side name={nameB} logo={logoB} isWinner={winner === 'b'} />
            </div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', marginTop: 24 }}>
              <Side name={nameA} logo={logoA} isWinner={winner === 'a'} />
              <div style={{ display: 'flex', padding: '0 10px' }}><Score /></div>
              <Side name={nameB} logo={logoB} isWinner={winner === 'b'} />
            </div>
          )}

          {/* Pied : le contexte du match à gauche, la plateforme à droite et en
              retrait. Aedral héberge, il n'organise pas — il n'a pas à peser
              autant que le tournoi sur une image republiée par une équipe. */}
          <div style={{
            position: 'absolute', bottom: 0, left: 0, right: 0,
            height: square ? 84 : 74, padding: square ? '0 56px' : '0 52px',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            borderTop: '1px solid rgba(255,255,255,0.09)',
            fontSize: 18, fontFamily: ff, letterSpacing: '3px',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              <span style={{ color: 'rgba(255,255,255,0.55)', display: 'flex' }}>{formatDate(endedMs)}</span>
              <span style={{ color: 'rgba(255,255,255,0.15)', display: 'flex' }}>|</span>
              <span style={{ color: gameColor, display: 'flex' }}>{gameLabel}</span>
            </div>
            <span style={{ color: 'rgba(255,255,255,0.26)', fontSize: 15, letterSpacing: '2px', display: 'flex' }}>
              aedral.com
            </span>
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
