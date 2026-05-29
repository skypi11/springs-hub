import { ImageResponse } from 'next/og';
import { NextRequest } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { captureApiError } from '@/lib/sentry';
import { isLegacyUid } from '@/lib/user-slug';
import { getGameColor, getGameLogoUrl, getGameShortLabel } from '@/lib/games-registry';
import {
  AEDRAL_PALETTE,
  bestTextColor,
  hexTextureDataUri,
  initials,
  loadLocalIconAsPngDataUri,
  loadLogoAsPngDataUri,
  loadRajdhani,
} from '@/lib/og-helpers';
import { getRankIconFile, getRankTierConfig } from '@/lib/rl-ranks';
import { getValorantRankIconFile, getValorantTierConfig } from '@/lib/valorant-ranks';

// GET /api/og/profile/[slug]/story
// Variante 1080×1920 (vertical) de la bannière OG profile. Téléchargée à la
// demande depuis la page publique du profil via le bouton "Partager en Story",
// puis l'utilisateur l'upload manuellement sur Instagram/TikTok/Snapchat.
//
// Différences avec l'OG horizontal :
// - Format 1080×1920 (portrait story).
// - Avatar XL en haut (centré, 400×400) avec glow doré généreux.
// - Watermark AEDRAL.COM bien visible en bas (acquisition canal principal).
// - Headers Content-Disposition: attachment pour forcer le download navigateur.
// - 404 propre si user introuvable (pas de fallback générique : on est en
//   mode download explicite, l'utilisateur attend SA story spécifiquement).
export const runtime = 'nodejs';

const WIDTH = 1080;
const HEIGHT = 1920;

/** Variante "story" du heroNameFontSize, calibrée pour la largeur 1080 et le
 *  format vertical (le nom prend toute la largeur, on peut aller plus gros). */
function storyNameFontSize(len: number): number {
  if (len <= 6) return 140;
  if (len <= 10) return 120;
  if (len <= 14) return 100;
  if (len <= 20) return 80;
  if (len <= 28) return 64;
  return 52;
}

/** Chip jeu remplie + icône officielle, version story (plus grande). */
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
  const textColor = bestTextColor(color);
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        padding: '14px 26px 14px 20px',
        fontSize: 32,
        letterSpacing: '5px',
        color: textColor,
        backgroundColor: color,
        fontFamily: ff,
        clipPath:
          'polygon(12px 0, 100% 0, 100% calc(100% - 12px), calc(100% - 12px) 100%, 0 100%, 0 12px)',
      }}
    >
      {iconDataUri && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={iconDataUri}
          width={36}
          height={36}
          alt=""
          style={{ objectFit: 'contain', display: 'flex' }}
        />
      )}
      <div style={{ display: 'flex' }}>{short}</div>
    </div>
  );
}

// Cf. doc dans l'endpoint horizontal — gère URL complète OU hash brut Discord
// (statique ou animé `a_…`, on force PNG côté CDN).
function buildAvatarUrl(data: FirebaseFirestore.DocumentData): string | null {
  const raw = data.avatarUrl ?? data.discordAvatar;
  if (!raw || typeof raw !== 'string') return null;
  if (raw.startsWith('http://') || raw.startsWith('https://')) return raw;
  const discordId = typeof data.discordId === 'string' ? data.discordId : null;
  if (discordId && /^a?_?[a-f0-9]+$/i.test(raw)) {
    return `https://cdn.discordapp.com/avatars/${discordId}/${raw}.png?size=512`;
  }
  return null;
}

interface HeroRank {
  label: string;
  value: string;
  color: string;
  iconFile: string | null;
  iconBasePath: 'rl-ranks' | 'valorant-ranks';
}

function pickHeroRank(data: FirebaseFirestore.DocumentData): HeroRank | null {
  const rlVerified = typeof data.rlEpicId === 'string' || typeof data.rlSteamId === 'string';
  if (rlVerified && typeof data.rlRank === 'string' && data.rlRank.trim()) {
    const value = data.rlRank.trim();
    const tierConfig = getRankTierConfig(value);
    return {
      label: 'RANG RL',
      value,
      color: tierConfig?.color ?? getGameColor('rocket_league'),
      iconFile: getRankIconFile(value),
      iconBasePath: 'rl-ranks',
    };
  }
  if (typeof data.valorantRank === 'string' && data.valorantRank.trim()) {
    const value = data.valorantRank.trim();
    const tierConfig = getValorantTierConfig(value);
    return {
      label: 'RANG VAL',
      value,
      color: tierConfig?.color ?? getGameColor('valorant'),
      iconFile: getValorantRankIconFile(value),
      iconBasePath: 'valorant-ranks',
    };
  }
  if (typeof data.rlRank === 'string' && data.rlRank.trim()) {
    const value = data.rlRank.trim();
    const tierConfig = getRankTierConfig(value);
    return {
      label: 'RANG RL',
      value,
      color: tierConfig?.color ?? getGameColor('rocket_league'),
      iconFile: getRankIconFile(value),
      iconBasePath: 'rl-ranks',
    };
  }
  return null;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  try {
    const { slug } = await params;
    const db = getAdminDb();

    let userData: FirebaseFirestore.DocumentData | null = null;
    if (isLegacyUid(slug)) {
      const snap = await db.collection('users').doc(slug).get();
      if (snap.exists) userData = snap.data() ?? null;
    } else {
      const snap = await db.collection('users')
        .where('slug', '==', slug)
        .limit(1)
        .get();
      if (!snap.empty) userData = snap.docs[0].data();
    }

    // 404 strict : on est en mode download, pas de fallback générique.
    if (!userData || userData.isBanned === true) {
      return new Response('Not found', { status: 404 });
    }

    const displayName = (typeof userData.displayName === 'string' ? userData.displayName : '').trim() || 'Joueur';
    const country = typeof userData.country === 'string' ? userData.country.trim() : '';
    const games: string[] = Array.isArray(userData.games)
      ? userData.games.filter((g): g is string => typeof g === 'string')
      : [];
    const avatarUrl = buildAvatarUrl(userData);
    const heroRank = pickHeroRank(userData);

    // Tous les chargements en parallèle (avatar + icônes jeux + icône rang).
    const VISIBLE_GAMES = 3;
    const visibleGames = games.slice(0, VISIBLE_GAMES);
    const extraGames = Math.max(0, games.length - VISIBLE_GAMES);

    const [avatarDataUri, gameIconDataUris, rankIconDataUri] = await Promise.all([
      (async () => {
        try {
          return await loadLogoAsPngDataUri(avatarUrl);
        } catch {
          return null;
        }
      })(),
      Promise.all(
        visibleGames.map(g => loadLocalIconAsPngDataUri(getGameLogoUrl(g))),
      ),
      heroRank?.iconFile
        ? loadLocalIconAsPngDataUri(`${heroRank.iconBasePath}/${heroRank.iconFile}.png`)
        : Promise.resolve(null),
    ]);

    const font = loadRajdhani();
    const hasFont = !!font;
    const ff = hasFont ? 'Rajdhani' : 'sans-serif';
    const hexUri = hexTextureDataUri(WIDTH, HEIGHT);

    const nameUpper = displayName.toUpperCase();
    const nameSize = storyNameFontSize(nameUpper.length);

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

          {/* Accent bar dorée en haut */}
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
          {/* Accent bar dorée en bas (encadre le watermark) */}
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

          {/* Corner brackets HUD esport (or 60×60, trait 3px — adaptés au vertical) */}
          <div style={{ position: 'absolute', top: 40, left: 40, width: 60, height: 60, borderTop: '3px solid rgba(255,184,0,0.65)', borderLeft: '3px solid rgba(255,184,0,0.65)', display: 'flex' }} />
          <div style={{ position: 'absolute', top: 40, right: 40, width: 60, height: 60, borderTop: '3px solid rgba(255,184,0,0.65)', borderRight: '3px solid rgba(255,184,0,0.65)', display: 'flex' }} />
          <div style={{ position: 'absolute', bottom: 40, left: 40, width: 60, height: 60, borderBottom: '3px solid rgba(255,184,0,0.65)', borderLeft: '3px solid rgba(255,184,0,0.65)', display: 'flex' }} />
          <div style={{ position: 'absolute', bottom: 40, right: 40, width: 60, height: 60, borderBottom: '3px solid rgba(255,184,0,0.65)', borderRight: '3px solid rgba(255,184,0,0.65)', display: 'flex' }} />

          {/* Glow doré derrière l'avatar */}
          <div
            style={{
              position: 'absolute',
              top: 380,
              left: '50%',
              width: 700,
              height: 700,
              transform: 'translateX(-50%)',
              background:
                'radial-gradient(circle, rgba(255,184,0,0.18) 0%, rgba(255,184,0,0.05) 45%, transparent 70%)',
              display: 'flex',
            }}
          />

          {/* Label JOUEUR */}
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
            JOUEUR
          </div>

          {/* Avatar XL 400×400 circulaire */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 440,
              height: 440,
              backgroundColor: '#0c0c18',
              backgroundImage:
                'radial-gradient(ellipse at center, rgba(255,184,0,0.10) 0%, transparent 70%)',
              border: '4px solid rgba(255,184,0,0.65)',
              borderRadius: '50%',
              marginBottom: 50,
            }}
          >
            {avatarDataUri ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={avatarDataUri}
                width={400}
                height={400}
                style={{
                  objectFit: 'cover',
                  borderRadius: '50%',
                }}
                alt=""
              />
            ) : (
              <div
                style={{
                  fontSize: 200,
                  color: 'rgba(255,255,255,0.85)',
                  letterSpacing: '8px',
                  display: 'flex',
                  fontFamily: ff,
                }}
              >
                {initials(displayName)}
              </div>
            )}
          </div>

          {/* Nom du joueur — centré, taille adaptative */}
          <div
            style={{
              fontSize: nameSize,
              letterSpacing: '5px',
              color: AEDRAL_PALETTE.text,
              fontFamily: ff,
              lineHeight: 1,
              display: 'flex',
              textAlign: 'center',
              marginBottom: 30,
              maxWidth: 960,
            }}
          >
            {nameUpper}
          </div>

          {/* Country (si défini) */}
          {country && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                fontFamily: ff,
                marginBottom: 24,
              }}
            >
              <div
                style={{
                  padding: '10px 24px',
                  fontSize: 28,
                  letterSpacing: '5px',
                  color: 'rgba(255,255,255,0.75)',
                  backgroundColor: 'rgba(255,255,255,0.06)',
                  border: '1px solid rgba(255,255,255,0.18)',
                  clipPath:
                    'polygon(8px 0, 100% 0, 100% calc(100% - 8px), calc(100% - 8px) 100%, 0 100%, 0 8px)',
                  display: 'flex',
                }}
              >
                {country.toUpperCase().slice(0, 24)}
              </div>
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
                marginBottom: 36,
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

          {/* Bloc rang hero — icône + label + nom du rang en couleur officielle.
              Centré, gros, c'est le "trophée" de la story. */}
          {heroRank && (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                fontFamily: ff,
                marginTop: 8,
              }}
            >
              <div
                style={{
                  fontSize: 22,
                  letterSpacing: '10px',
                  color: 'rgba(255,255,255,0.55)',
                  display: 'flex',
                  marginBottom: 16,
                }}
              >
                {heroRank.label}
              </div>
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 26,
                }}
              >
                {rankIconDataUri && (
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      width: 130,
                      height: 130,
                      backgroundImage: `radial-gradient(circle, ${heroRank.color}40 0%, transparent 70%)`,
                    }}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={rankIconDataUri}
                      width={130}
                      height={130}
                      alt=""
                      style={{ objectFit: 'contain' }}
                    />
                  </div>
                )}
                <div
                  style={{
                    fontSize: 64,
                    letterSpacing: '4px',
                    color: heroRank.color,
                    lineHeight: 1,
                    display: 'flex',
                    maxWidth: 700,
                  }}
                >
                  {heroRank.value.toUpperCase()}
                </div>
              </div>
            </div>
          )}

          {/* WATERMARK AEDRAL.COM — moyen d'acquisition principal de la story.
              Bien visible, encadré entre les corner brackets bas. */}
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
                fontSize: 18,
                letterSpacing: '10px',
                color: 'rgba(255,255,255,0.45)',
                display: 'flex',
                marginBottom: 12,
              }}
            >
              REJOINS-MOI SUR
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
          'Cache-Control': 'public, max-age=3600, s-maxage=3600, immutable, no-transform',
          // Force le download navigateur au lieu de l'affichage inline.
          // Le fichier arrive avec un nom propre dans le dossier Téléchargements.
          'Content-Disposition': `attachment; filename="aedral-profil-${slug}.png"`,
        },
      },
    );
  } catch (err) {
    captureApiError('API OG/profile/story GET error', err);
    return new Response('Error', { status: 500 });
  }
}
