import { ImageResponse } from 'next/og';
import { NextRequest } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { isLegacyStructureId } from '@/lib/structure-slug';
import { captureApiError } from '@/lib/sentry';
import { getGameColor, getGameLogoUrl, getGameShortLabel, isGameLogoTransparent } from '@/lib/games-registry';
import {
  AEDRAL_PALETTE,
  bestTextColor,
  hexTextureDataUri,
  initials,
  loadLocalIconAsPngDataUri,
  loadLogoAsPngDataUri,
  loadRajdhani,
} from '@/lib/og-helpers';

// GET /api/og/structure/[id]/story
// Variante 1080×1920 (vertical) de la bannière OG structure pour stories
// Instagram/TikTok/Snapchat. Téléchargée à la demande via le bouton
// "Partager en Story" sur la page publique de la structure.
//
// Différences avec l'OG horizontal :
// - Format 1080×1920 (portrait story).
// - Logo XL en haut (400×400) avec glow doré.
// - Bloc compteurs (membres + équipes) bien gros, centré.
// - Liste dirigeants sous les compteurs.
// - Watermark AEDRAL.COM en bas.
// - Content-Disposition: attachment pour forcer le download.
// - 404 strict si structure non publique.
export const runtime = 'nodejs';

const WIDTH = 1080;
const HEIGHT = 1920;

function storyNameFontSize(len: number): number {
  if (len <= 6) return 130;
  if (len <= 10) return 110;
  if (len <= 14) return 90;
  if (len <= 20) return 72;
  if (len <= 28) return 56;
  return 46;
}

/** Chip jeu version story — 2 variants selon `logoIsTransparent` :
 *  - Transparent (RL, Valorant) → variant "logo seul" : icône XL 88px + label
 *    40px, pas de fond plein, juste bordure couleur du jeu. Le logo se
 *    découpe sur le hex Aedral.
 *  - Opaque (TM) → variant "chip rempli" historique : icône 56px sur fond
 *    plein couleur du jeu pour cacher le carré opaque du PNG. */
function GameChip({
  gameId,
  ff,
  iconDataUri,
}: {
  gameId: string;
  ff: string;
  iconDataUri: string | null;
}) {
  const color = getGameColor(gameId);
  const short = getGameShortLabel(gameId);
  const transparent = isGameLogoTransparent(gameId);

  if (transparent) {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 18,
          padding: '14px 30px 14px 22px',
          fontSize: 40,
          letterSpacing: '6px',
          color: 'rgba(255,255,255,0.92)',
          fontFamily: ff,
          backgroundColor: 'rgba(255,255,255,0.04)',
          border: `1px solid ${color}55`,
          clipPath:
            'polygon(14px 0, 100% 0, 100% calc(100% - 14px), calc(100% - 14px) 100%, 0 100%, 0 14px)',
        }}
      >
        {iconDataUri && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={iconDataUri}
            width={88}
            height={88}
            alt=""
            style={{ objectFit: 'contain', display: 'flex' }}
          />
        )}
        <div style={{ display: 'flex' }}>{short}</div>
      </div>
    );
  }

  const textColor = bestTextColor(color);
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 18,
        padding: '18px 32px 18px 24px',
        fontSize: 38,
        letterSpacing: '5px',
        color: textColor,
        backgroundColor: color,
        fontFamily: ff,
        clipPath:
          'polygon(14px 0, 100% 0, 100% calc(100% - 14px), calc(100% - 14px) 100%, 0 100%, 0 14px)',
      }}
    >
      {iconDataUri && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={iconDataUri}
          width={56}
          height={56}
          alt=""
          style={{ objectFit: 'contain', display: 'flex' }}
        />
      )}
      <div style={{ display: 'flex' }}>{short}</div>
    </div>
  );
}

async function loadDirectionNames(
  db: FirebaseFirestore.Firestore,
  founderId: string | null,
  coFounderIds: string[],
): Promise<{ visible: string[]; extra: number }> {
  const orderedIds: string[] = [];
  if (founderId) orderedIds.push(founderId);
  for (const id of coFounderIds) {
    if (id && !orderedIds.includes(id)) orderedIds.push(id);
  }
  if (orderedIds.length === 0) return { visible: [], extra: 0 };

  const snaps = await Promise.all(
    orderedIds.map(uid =>
      db.collection('users').doc(uid).get().catch(() => null),
    ),
  );

  const names: string[] = [];
  for (let i = 0; i < snaps.length; i++) {
    const snap = snaps[i];
    if (!snap || !snap.exists) continue;
    const data = snap.data();
    const raw = typeof data?.displayName === 'string' ? data.displayName.trim() : '';
    if (raw) names.push(raw);
  }
  const VISIBLE = 3;
  return { visible: names.slice(0, VISIBLE), extra: Math.max(0, names.length - VISIBLE) };
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const db = getAdminDb();

    let docId = '';
    let data: FirebaseFirestore.DocumentData | null = null;
    if (isLegacyStructureId(id)) {
      const snap = await db.collection('structures').doc(id).get();
      if (snap.exists) {
        docId = snap.id;
        data = snap.data() ?? null;
      }
    } else {
      const snap = await db.collection('structures')
        .where('slug', '==', id)
        .limit(1)
        .get();
      if (!snap.empty) {
        docId = snap.docs[0].id;
        data = snap.docs[0].data();
      }
    }

    // 404 strict pour les stories : l'utilisateur a explicitement demandé
    // CETTE structure, pas un fallback générique.
    if (!data) return new Response('Not found', { status: 404 });
    if (data.status !== 'active') return new Response('Not found', { status: 404 });

    const name = (typeof data.name === 'string' ? data.name : '').trim() || 'Structure';
    const tag = (typeof data.tag === 'string' ? data.tag : '').trim();
    const logoUrl = typeof data.logoUrl === 'string' ? data.logoUrl : null;
    const games: string[] = Array.isArray(data.games)
      ? data.games.filter((g): g is string => typeof g === 'string')
      : [];
    const founderId = typeof data.founderId === 'string' ? data.founderId : null;
    const coFounderIds: string[] = Array.isArray(data.coFounderIds)
      ? data.coFounderIds.filter((u): u is string => typeof u === 'string')
      : [];

    const counters = data.counters && typeof data.counters === 'object'
      ? data.counters as Record<string, unknown>
      : null;

    let members = 0;
    if (counters && typeof counters.members === 'number') {
      members = counters.members;
    } else {
      try {
        const aggSnap = await db.collection('structure_members')
          .where('structureId', '==', docId)
          .count()
          .get();
        members = aggSnap.data().count ?? 0;
      } catch {
        members = 0;
      }
    }

    let teams = 0;
    if (counters && typeof counters.teams === 'number') {
      teams = counters.teams;
    } else {
      try {
        const aggSnap = await db.collection('sub_teams')
          .where('structureId', '==', docId)
          .where('status', '==', 'active')
          .count()
          .get();
        teams = aggSnap.data().count ?? 0;
      } catch {
        teams = 0;
      }
    }

    const VISIBLE_GAMES = 3;
    const visibleGames = games.slice(0, VISIBLE_GAMES);
    const extraGames = Math.max(0, games.length - VISIBLE_GAMES);

    const [logoDataUri, gameIconDataUris, direction] = await Promise.all([
      loadLogoAsPngDataUri(logoUrl),
      Promise.all(
        visibleGames.map(g => loadLocalIconAsPngDataUri(getGameLogoUrl(g))),
      ),
      loadDirectionNames(db, founderId, coFounderIds),
    ]);

    const font = loadRajdhani();
    const hasFont = !!font;
    const ff = hasFont ? 'Rajdhani' : 'sans-serif';
    const hexUri = hexTextureDataUri(WIDTH, HEIGHT);

    const displayName = name.toUpperCase();
    const nameSize = storyNameFontSize(displayName.length);

    return new ImageResponse(
      (
        <div
          style={{
            width: WIDTH,
            height: HEIGHT,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            background: AEDRAL_PALETTE.backgroundGradient,
            position: 'relative',
            paddingTop: 200,
            paddingBottom: 80,
            paddingLeft: 60,
            paddingRight: 60,
          }}
        >
          {/* Texture hex */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={hexUri}
            width={WIDTH}
            height={HEIGHT}
            alt=""
            style={{ position: 'absolute', top: 0, left: 0 }}
          />

          {/* Accent bars dorées haut + bas */}
          <div
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              height: 10,
              background: AEDRAL_PALETTE.goldBarGradient,
              display: 'flex',
            }}
          />
          <div
            style={{
              position: 'absolute',
              bottom: 0,
              left: 0,
              right: 0,
              height: 10,
              background: AEDRAL_PALETTE.goldBarGradient,
              display: 'flex',
            }}
          />

          {/* Corner brackets HUD aux 4 coins */}
          <div style={{ position: 'absolute', top: 40, left: 40, width: 60, height: 60, borderTop: '3px solid rgba(255,184,0,0.65)', borderLeft: '3px solid rgba(255,184,0,0.65)', display: 'flex' }} />
          <div style={{ position: 'absolute', top: 40, right: 40, width: 60, height: 60, borderTop: '3px solid rgba(255,184,0,0.65)', borderRight: '3px solid rgba(255,184,0,0.65)', display: 'flex' }} />
          <div style={{ position: 'absolute', bottom: 40, left: 40, width: 60, height: 60, borderBottom: '3px solid rgba(255,184,0,0.65)', borderLeft: '3px solid rgba(255,184,0,0.65)', display: 'flex' }} />
          <div style={{ position: 'absolute', bottom: 40, right: 40, width: 60, height: 60, borderBottom: '3px solid rgba(255,184,0,0.65)', borderRight: '3px solid rgba(255,184,0,0.65)', display: 'flex' }} />

          {/* Glow doré derrière le logo */}
          <div
            style={{
              position: 'absolute',
              top: 360,
              left: '50%',
              width: 720,
              height: 720,
              transform: 'translateX(-50%)',
              background:
                'radial-gradient(circle, rgba(255,184,0,0.15) 0%, rgba(255,184,0,0.04) 45%, transparent 70%)',
              display: 'flex',
            }}
          />

          {/* Label STRUCTURE */}
          <div
            style={{
              fontSize: 30,
              letterSpacing: '14px',
              color: AEDRAL_PALETTE.gold,
              fontFamily: ff,
              display: 'flex',
              marginBottom: 40,
            }}
          >
            STRUCTURE
          </div>

          {/* Logo XL — bevel 24px, encadré or */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 460,
              height: 460,
              backgroundColor: '#0c0c18',
              backgroundImage:
                'radial-gradient(ellipse at center, rgba(255,184,0,0.10) 0%, transparent 70%)',
              border: '3px solid rgba(255,184,0,0.55)',
              clipPath:
                'polygon(24px 0, 100% 0, 100% calc(100% - 24px), calc(100% - 24px) 100%, 0 100%, 0 24px)',
              marginBottom: 50,
            }}
          >
            {logoDataUri ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={logoDataUri}
                width={380}
                height={380}
                style={{ objectFit: 'contain' }}
                alt=""
              />
            ) : (
              <div
                style={{
                  fontSize: 220,
                  color: 'rgba(255,255,255,0.85)',
                  letterSpacing: '10px',
                  display: 'flex',
                  fontFamily: ff,
                }}
              >
                {initials(name)}
              </div>
            )}
          </div>

          {/* Nom de la structure */}
          <div
            style={{
              fontSize: nameSize,
              letterSpacing: '5px',
              color: AEDRAL_PALETTE.text,
              fontFamily: ff,
              lineHeight: 1,
              display: 'flex',
              textAlign: 'center',
              marginBottom: tag ? 18 : 30,
              maxWidth: 960,
            }}
          >
            {displayName}
          </div>

          {/* Tag */}
          {tag && (
            <div
              style={{
                fontSize: 36,
                letterSpacing: '8px',
                color: 'rgba(255,184,0,0.85)',
                fontFamily: ff,
                display: 'flex',
                marginBottom: 30,
              }}
            >
              [{tag.toUpperCase()}]
            </div>
          )}

          {/* Chips jeux centrées */}
          {visibleGames.length > 0 && (
            <div
              style={{
                display: 'flex',
                gap: 14,
                alignItems: 'center',
                justifyContent: 'center',
                flexWrap: 'wrap',
                marginBottom: 32,
                maxWidth: 960,
              }}
            >
              {visibleGames.map((g, idx) => (
                <GameChip
                  key={g}
                  gameId={g}
                  ff={ff}
                  iconDataUri={gameIconDataUris[idx] ?? null}
                />
              ))}
              {extraGames > 0 && (
                <div
                  style={{
                    fontSize: 28,
                    letterSpacing: '3px',
                    color: 'rgba(255,255,255,0.5)',
                    fontFamily: ff,
                    display: 'flex',
                  }}
                >
                  +{extraGames}
                </div>
              )}
            </div>
          )}

          {/* Compteurs membres + équipes : chiffre or 88px + label 28px en
              colonne par stat, séparateur ligne verticale or au milieu.
              Cohérent avec la version horizontale (plus de middot flottant). */}
          {(members > 0 || teams > 0) && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 48,
                fontFamily: ff,
                marginBottom: direction.visible.length > 0 ? 36 : 0,
              }}
            >
              {members > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                  <div
                    style={{
                      fontSize: 88,
                      color: AEDRAL_PALETTE.gold,
                      letterSpacing: '3px',
                      lineHeight: 1,
                      display: 'flex',
                    }}
                  >
                    {members}
                  </div>
                  <div
                    style={{
                      marginTop: 10,
                      fontSize: 28,
                      color: 'rgba(255,255,255,0.6)',
                      letterSpacing: '6px',
                      display: 'flex',
                    }}
                  >
                    MEMBRE{members > 1 ? 'S' : ''}
                  </div>
                </div>
              )}
              {members > 0 && teams > 0 && (
                <div
                  style={{
                    width: 2,
                    height: 100,
                    backgroundColor: 'rgba(255,184,0,0.4)',
                    display: 'flex',
                  }}
                />
              )}
              {teams > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                  <div
                    style={{
                      fontSize: 88,
                      color: AEDRAL_PALETTE.gold,
                      letterSpacing: '3px',
                      lineHeight: 1,
                      display: 'flex',
                    }}
                  >
                    {teams}
                  </div>
                  <div
                    style={{
                      marginTop: 10,
                      fontSize: 28,
                      color: 'rgba(255,255,255,0.6)',
                      letterSpacing: '6px',
                      display: 'flex',
                    }}
                  >
                    ÉQUIPE{teams > 1 ? 'S' : ''}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Bloc DIRECTION */}
          {direction.visible.length > 0 && (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                fontFamily: ff,
                marginTop: 8,
                maxWidth: 960,
              }}
            >
              <div
                style={{
                  fontSize: 20,
                  letterSpacing: '10px',
                  color: 'rgba(255,255,255,0.5)',
                  display: 'flex',
                  marginBottom: 14,
                }}
              >
                DIRECTION
              </div>
              <div
                style={{
                  fontSize: 34,
                  letterSpacing: '3px',
                  color: AEDRAL_PALETTE.text,
                  lineHeight: 1.3,
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: 14,
                  justifyContent: 'center',
                  alignItems: 'baseline',
                }}
              >
                {direction.visible.map((n, idx) => (
                  <div key={`dir-${idx}`} style={{ display: 'flex', alignItems: 'baseline', gap: 14 }}>
                    <div style={{ display: 'flex' }}>{n}</div>
                    {idx < direction.visible.length - 1 && (
                      <div style={{ color: 'rgba(255,184,0,0.55)', display: 'flex' }}>·</div>
                    )}
                  </div>
                ))}
                {direction.extra > 0 && (
                  <div
                    style={{
                      fontSize: 28,
                      color: 'rgba(255,255,255,0.5)',
                      display: 'flex',
                      letterSpacing: '2px',
                    }}
                  >
                    +{direction.extra}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* WATERMARK AEDRAL.COM en bas — acquisition canal principal.
              Fine séparatrice or dégradée au-dessus pour cohérence visuelle
              avec le footer des OG horizontaux (signature Aedral identitaire). */}
          <div
            style={{
              position: 'absolute',
              bottom: 90,
              left: 0,
              right: 0,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              fontFamily: ff,
            }}
          >
            <div
              style={{
                width: 520,
                height: 1.5,
                background:
                  'linear-gradient(90deg, transparent 0%, rgba(255,184,0,0.4) 50%, transparent 100%)',
                display: 'flex',
                marginBottom: 26,
              }}
            />
            <div
              style={{
                fontSize: 18,
                letterSpacing: '10px',
                color: 'rgba(255,255,255,0.45)',
                display: 'flex',
                marginBottom: 12,
              }}
            >
              REJOINS-NOUS SUR
            </div>
            <div
              style={{
                fontSize: 56,
                letterSpacing: '12px',
                color: AEDRAL_PALETTE.gold,
                display: 'flex',
                textShadow: '0 0 32px rgba(255,184,0,0.45)',
              }}
            >
              AEDRAL.COM
            </div>
          </div>
        </div>
      ),
      {
        width: WIDTH,
        height: HEIGHT,
        fonts: font
          ? [{ name: 'Rajdhani', data: font, style: 'normal', weight: 700 }]
          : undefined,
        headers: {
          // PAS de cache : story = download manuel ponctuel par le propriétaire,
          // toujours version fraîche (cf. doc dans le endpoint profile story).
          'Cache-Control': 'private, no-store, no-cache, must-revalidate',
          // Force le téléchargement plutôt que l'affichage inline.
          'Content-Disposition': `attachment; filename="aedral-structure-${id}.png"`,
        },
      },
    );
  } catch (err) {
    captureApiError('API OG/structure/story GET error', err);
    return new Response('Error', { status: 500 });
  }
}
