import { ImageResponse } from 'next/og';
import { NextRequest } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { captureApiError } from '@/lib/sentry';
import { isLegacyUid } from '@/lib/user-slug';
import { getGameColor, getGameShortLabel } from '@/lib/games-registry';
import {
  AEDRAL_PALETTE,
  OG_HEIGHT,
  OG_WIDTH,
  heroNameFontSize,
  hexTextureDataUri,
  initials,
  loadLogoAsPngDataUri,
  loadRajdhani,
} from '@/lib/og-helpers';

// GET /api/og/profile/[slug]
// Génère la bannière Open Graph (1200×630) pour la page publique d'un profil
// joueur. Embeds Discord/Twitter consomment cette URL via `og:image` dans
// `app/profile/[id]/layout.tsx`.
//
// Sécurité : le param [slug] peut être soit un slug public ("noxx"), soit un
// uid legacy ("discord_SNOWFLAKE") pour compatibilité avec les anciens liens.
// On accepte les 2 pour pouvoir générer une preview, MAIS la bannière elle-
// même n'affiche JAMAIS le snowflake Discord — uniquement le displayName.
// Cf. mémoire `project_profile_slugs` (raison sécu Discord ping).
//
// Route publique : les profils joueurs sont déjà publics côté UI. Cache 1h.
export const runtime = 'nodejs';

const WIDTH = OG_WIDTH;
const HEIGHT = OG_HEIGHT;

/** Petite chip jeu, alignée visuellement sur la version de l'endpoint structure. */
function GameChip({ gameId, ff }: { gameId: string; ff: string }) {
  const color = getGameColor(gameId);
  const short = getGameShortLabel(gameId);
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        padding: '8px 18px',
        fontSize: 20,
        letterSpacing: '4px',
        color,
        backgroundColor: `${color}1A`,
        border: `1px solid ${color}55`,
        fontFamily: ff,
        clipPath:
          'polygon(8px 0, 100% 0, 100% calc(100% - 8px), calc(100% - 8px) 100%, 0 100%, 0 8px)',
      }}
    >
      {short}
    </div>
  );
}

// Reconstruit une URL d'avatar Discord à partir des champs Firestore.
// `discordAvatar` peut être stocké soit comme URL complète (cas habituel,
// défini par le callback OAuth), soit comme hash brut (legacy / certains
// chemins). On gère les deux pour rester défensif.
function buildAvatarUrl(data: FirebaseFirestore.DocumentData): string | null {
  const raw = data.avatarUrl ?? data.discordAvatar;
  if (!raw || typeof raw !== 'string') return null;
  if (raw.startsWith('http://') || raw.startsWith('https://')) return raw;
  // Hash brut → essayer de reconstruire l'URL Discord CDN
  const discordId = typeof data.discordId === 'string' ? data.discordId : null;
  if (discordId && /^[a-f0-9]+$/i.test(raw)) {
    return `https://cdn.discordapp.com/avatars/${discordId}/${raw}.png?size=512`;
  }
  return null;
}

/**
 * Choisit un rang à afficher en hero. Priorité au rang vérifié RL (via Epic
 * ou Steam), sinon premier rang déclaré dispo. Retourne `null` si aucun rang
 * exploitable.
 */
function pickHeroRank(data: FirebaseFirestore.DocumentData): { label: string; value: string; color: string } | null {
  const rlVerified = typeof data.rlEpicId === 'string' || typeof data.rlSteamId === 'string';
  if (rlVerified && typeof data.rlRank === 'string' && data.rlRank.trim()) {
    return { label: 'RANG RL', value: data.rlRank.trim(), color: getGameColor('rocket_league') };
  }
  if (typeof data.valorantRank === 'string' && data.valorantRank.trim()) {
    return { label: 'RANG VAL', value: data.valorantRank.trim(), color: getGameColor('valorant') };
  }
  if (typeof data.rlRank === 'string' && data.rlRank.trim()) {
    return { label: 'RANG RL', value: data.rlRank.trim(), color: getGameColor('rocket_league') };
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
      // Accès via uid Discord legacy : on accepte pour les anciens liens mais
      // on n'affichera jamais le snowflake dans le rendu (Cf. consigne sécu).
      const snap = await db.collection('users').doc(slug).get();
      if (snap.exists) userData = snap.data() ?? null;
    } else {
      const snap = await db.collection('users')
        .where('slug', '==', slug)
        .limit(1)
        .get();
      if (!snap.empty) userData = snap.docs[0].data();
    }

    // Si user introuvable / banni → on tombe sur la bannière fallback générique
    // Aedral plutôt qu'un 404 (un 404 casse l'embed Discord). C'est volontaire.
    if (!userData || userData.isBanned === true) {
      return renderFallback();
    }

    const displayName = (typeof userData.displayName === 'string' ? userData.displayName : '').trim() || 'Joueur';
    const country = typeof userData.country === 'string' ? userData.country.trim() : '';
    const games: string[] = Array.isArray(userData.games)
      ? userData.games.filter((g): g is string => typeof g === 'string')
      : [];
    const avatarUrl = buildAvatarUrl(userData);
    const heroRank = pickHeroRank(userData);

    const avatarDataUri = await loadLogoAsPngDataUri(avatarUrl);

    const font = loadRajdhani();
    const hasFont = !!font;
    const ff = hasFont ? 'Rajdhani' : 'sans-serif';
    const hexUri = hexTextureDataUri(WIDTH, HEIGHT);

    const nameUpper = displayName.toUpperCase();
    const nameSize = heroNameFontSize(nameUpper.length);

    const VISIBLE_GAMES = 3;
    const visibleGames = games.slice(0, VISIBLE_GAMES);
    const extraGames = Math.max(0, games.length - VISIBLE_GAMES);

    return new ImageResponse(
      (
        <div
          style={{
            width: WIDTH,
            height: HEIGHT,
            display: 'flex',
            flexDirection: 'row',
            alignItems: 'center',
            background: AEDRAL_PALETTE.backgroundGradient,
            position: 'relative',
          }}
        >
          {/* Texture hex, signature DA */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={hexUri}
            width={WIDTH}
            height={HEIGHT}
            alt=""
            style={{ position: 'absolute', top: 0, left: 0 }}
          />

          {/* Accent bar dorée */}
          <div
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              height: 6,
              background: AEDRAL_PALETTE.goldBarGradient,
              display: 'flex',
            }}
          />

          {/* Corner brackets HUD esport */}
          <div style={{ position: 'absolute', top: 24, left: 24, width: 40, height: 40, borderTop: '2px solid rgba(255,184,0,0.65)', borderLeft: '2px solid rgba(255,184,0,0.65)', display: 'flex' }} />
          <div style={{ position: 'absolute', top: 24, right: 24, width: 40, height: 40, borderTop: '2px solid rgba(255,184,0,0.65)', borderRight: '2px solid rgba(255,184,0,0.65)', display: 'flex' }} />
          <div style={{ position: 'absolute', bottom: 24, left: 24, width: 40, height: 40, borderBottom: '2px solid rgba(255,184,0,0.65)', borderLeft: '2px solid rgba(255,184,0,0.65)', display: 'flex' }} />
          <div style={{ position: 'absolute', bottom: 24, right: 24, width: 40, height: 40, borderBottom: '2px solid rgba(255,184,0,0.65)', borderRight: '2px solid rgba(255,184,0,0.65)', display: 'flex' }} />

          {/* Glow doré derrière l'avatar */}
          <div
            style={{
              position: 'absolute',
              top: '50%',
              left: 220,
              width: 340,
              height: 340,
              transform: 'translate(-50%, -50%)',
              background:
                'radial-gradient(circle, rgba(255,184,0,0.12) 0%, rgba(255,184,0,0.03) 45%, transparent 70%)',
              display: 'flex',
            }}
          />

          {/* Colonne gauche : avatar circulaire 220 px, bordure or */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 260,
              height: 260,
              marginLeft: 100,
              marginRight: 60,
              backgroundColor: '#0c0c18',
              backgroundImage:
                'radial-gradient(ellipse at center, rgba(255,184,0,0.08) 0%, transparent 70%)',
              border: '3px solid rgba(255,184,0,0.55)',
              borderRadius: '50%',
            }}
          >
            {avatarDataUri ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={avatarDataUri}
                width={220}
                height={220}
                style={{
                  objectFit: 'cover',
                  borderRadius: '50%',
                }}
                alt=""
              />
            ) : (
              <div
                style={{
                  fontSize: 110,
                  color: 'rgba(255,255,255,0.85)',
                  letterSpacing: '4px',
                  display: 'flex',
                  fontFamily: ff,
                }}
              >
                {initials(displayName)}
              </div>
            )}
          </div>

          {/* Colonne droite : label JOUEUR + nom + country + chips + rang */}
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'center',
              flex: 1,
              paddingRight: 80,
              gap: 18,
            }}
          >
            {/* Label JOUEUR */}
            <div
              style={{
                fontSize: 22,
                letterSpacing: '10px',
                color: AEDRAL_PALETTE.gold,
                fontFamily: ff,
                display: 'flex',
              }}
            >
              JOUEUR
            </div>

            {/* Nom */}
            <div
              style={{
                fontSize: nameSize,
                letterSpacing: '4px',
                color: AEDRAL_PALETTE.text,
                fontFamily: ff,
                lineHeight: 1,
                display: 'flex',
              }}
            >
              {nameUpper}
            </div>

            {/* Country (si défini) — chip neutre sobre */}
            {country && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  fontFamily: ff,
                }}
              >
                <div
                  style={{
                    padding: '6px 16px',
                    fontSize: 20,
                    letterSpacing: '3px',
                    color: 'rgba(255,255,255,0.75)',
                    backgroundColor: 'rgba(255,255,255,0.06)',
                    border: '1px solid rgba(255,255,255,0.15)',
                    clipPath:
                      'polygon(6px 0, 100% 0, 100% calc(100% - 6px), calc(100% - 6px) 100%, 0 100%, 0 6px)',
                    display: 'flex',
                  }}
                >
                  {country.toUpperCase().slice(0, 24)}
                </div>
              </div>
            )}

            {/* Chips jeux */}
            {visibleGames.length > 0 && (
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                {visibleGames.map(g => (
                  <GameChip key={g} gameId={g} ff={ff} />
                ))}
                {extraGames > 0 && (
                  <div
                    style={{
                      fontSize: 20,
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

            {/* Rang hero (en gros, or si RL vérifié, sinon couleur du jeu) */}
            {heroRank && (
              <div
                style={{
                  marginTop: 8,
                  display: 'flex',
                  flexDirection: 'column',
                  fontFamily: ff,
                }}
              >
                <div
                  style={{
                    fontSize: 16,
                    letterSpacing: '6px',
                    color: 'rgba(255,255,255,0.55)',
                    display: 'flex',
                  }}
                >
                  {heroRank.label}
                </div>
                <div
                  style={{
                    marginTop: 4,
                    fontSize: 44,
                    letterSpacing: '3px',
                    color: heroRank.color,
                    lineHeight: 1,
                    display: 'flex',
                  }}
                >
                  {heroRank.value.toUpperCase()}
                </div>
              </div>
            )}
          </div>

          {/* Footer AEDRAL */}
          <div
            style={{
              position: 'absolute',
              bottom: 24,
              right: 80,
              fontSize: 18,
              color: 'rgba(255,255,255,0.4)',
              letterSpacing: '4px',
              display: 'flex',
              fontFamily: ff,
            }}
          >
            AEDRAL
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
        },
      },
    );
  } catch (err) {
    captureApiError('API OG/profile GET error', err);
    return renderFallback();
  }
}

/**
 * Bannière de fallback ultra-sobre : juste l'identité Aedral + tagline.
 * Utilisée quand le user est introuvable / banni OU quand le rendu principal
 * crashe. Volontairement minimaliste pour ne JAMAIS retourner 500 (Discord
 * ne réessaie pas une URL og:image qui répond 5xx).
 */
function renderFallback(): Response {
  try {
    const font = loadRajdhani();
    const ff = font ? 'Rajdhani' : 'sans-serif';
    const hexUri = hexTextureDataUri(WIDTH, HEIGHT);
    return new ImageResponse(
      (
        <div
          style={{
            width: WIDTH,
            height: HEIGHT,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            background: AEDRAL_PALETTE.backgroundGradient,
            position: 'relative',
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={hexUri}
            width={WIDTH}
            height={HEIGHT}
            alt=""
            style={{ position: 'absolute', top: 0, left: 0 }}
          />
          <div
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              height: 6,
              background: AEDRAL_PALETTE.goldBarGradient,
              display: 'flex',
            }}
          />
          <div
            style={{
              fontSize: 72,
              letterSpacing: '16px',
              color: AEDRAL_PALETTE.gold,
              fontFamily: ff,
              display: 'flex',
            }}
          >
            AEDRAL
          </div>
          <div
            style={{
              marginTop: 16,
              fontSize: 22,
              letterSpacing: '6px',
              color: 'rgba(255,255,255,0.55)',
              fontFamily: ff,
              display: 'flex',
            }}
          >
            COMMUNAUTÉ ESPORT
          </div>
        </div>
      ),
      {
        width: WIDTH,
        height: HEIGHT,
        fonts: font
          ? [{ name: 'Rajdhani', data: font, style: 'normal', weight: 700 }]
          : undefined,
        headers: { 'Cache-Control': 'public, max-age=60' },
      },
    );
  } catch (fallbackErr) {
    captureApiError('API OG/profile fallback render error', fallbackErr);
    return new Response('Error', { status: 500 });
  }
}
