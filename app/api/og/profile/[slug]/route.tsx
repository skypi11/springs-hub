import { ImageResponse } from 'next/og';
import { NextRequest } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { captureApiError } from '@/lib/sentry';
import { isLegacyUid } from '@/lib/user-slug';
import { getGameColor, getGameLogoUrl, getGameShortLabel } from '@/lib/games-registry';
import {
  AEDRAL_PALETTE,
  OG_HEIGHT,
  OG_WIDTH,
  bestTextColor,
  heroNameFontSize,
  hexTextureDataUri,
  initials,
  loadLocalIconAsPngDataUri,
  loadLogoAsPngDataUri,
  loadRajdhani,
} from '@/lib/og-helpers';
import { getRankIconFile, getRankTierConfig } from '@/lib/rl-ranks';
import { getValorantRankIconFile, getValorantTierConfig } from '@/lib/valorant-ranks';

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

/** Chip jeu remplie + icône officielle, alignée sur la version structure pour
 *  cohérence cross-OG (fond plein couleur jeu, label auto-contrasté, icône
 *  bitmap 40×40 lisible). */
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
        gap: 12,
        padding: '10px 22px 10px 14px',
        fontSize: 26,
        letterSpacing: '4px',
        color: textColor,
        backgroundColor: color,
        fontFamily: ff,
        clipPath:
          'polygon(10px 0, 100% 0, 100% calc(100% - 10px), calc(100% - 10px) 100%, 0 100%, 0 10px)',
      }}
    >
      {iconDataUri && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={iconDataUri}
          width={32}
          height={32}
          alt=""
          style={{ objectFit: 'contain', display: 'flex' }}
        />
      )}
      <div style={{ display: 'flex' }}>{short}</div>
    </div>
  );
}

// Reconstruit une URL d'avatar Discord à partir des champs Firestore.
// `discordAvatar` peut être stocké soit comme URL complète (cas habituel,
// défini par le callback OAuth), soit comme hash brut (legacy / certains
// chemins). On gère les deux pour rester défensif.
//
// Note avatars animés Discord : les hash commencent par `a_` (ex `a_abc123`)
// et le CDN les sert en .gif. On les accepte mais on force `.png` à la fin —
// Discord CDN sert le PNG d'un avatar animé sans souci (perte de l'anim mais
// OK pour un OG image statique).
function buildAvatarUrl(data: FirebaseFirestore.DocumentData): string | null {
  // ATTENTION : `??` (nullish coalescing) garde une string vide ("") au lieu
  // de tomber sur le fallback. Or on a vu en prod des users avec
  // `avatarUrl: ""` (chaîne vide) ET `discordAvatar: "https://..."` (URL valide).
  // Donc on filtre EXPLICITEMENT les strings vides avant de fallback.
  const candidates = [data.avatarUrl, data.discordAvatar];
  const raw = candidates.find(
    (v): v is string => typeof v === 'string' && v.trim().length > 0,
  );
  if (!raw) return null;

  if (raw.startsWith('http://') || raw.startsWith('https://')) return raw;

  // Hash brut → essayer de reconstruire l'URL Discord CDN
  const discordId = typeof data.discordId === 'string' ? data.discordId : null;
  // Accepte hash statique (hex pur) ET hash animé (préfixe `a_`).
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

/**
 * Choisit un rang à afficher en hero. Priorité au rang vérifié RL (via Epic
 * ou Steam), sinon premier rang déclaré dispo. Retourne `null` si aucun rang
 * exploitable.
 *
 * Couleur : on utilise la couleur OFFICIELLE du tier (Grand Champion = rouge,
 * Champion = violet, Diamant = bleu, etc.) via `getRankTierConfig`. Si le
 * rang n'est pas reconnu (legacy, typo), fallback sur la couleur du jeu.
 */
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

    const VISIBLE_GAMES = 3;
    const visibleGames = games.slice(0, VISIBLE_GAMES);
    const extraGames = Math.max(0, games.length - VISIBLE_GAMES);

    // Tous les chargements lourds en parallèle (avatar Discord + icônes jeux
    // officielles + icône rang). Raccourcit le TTFB de la route de ~3x quand
    // toutes les requêtes sont indépendantes.
    const [avatarDataUri, gameIconDataUris, rankIconDataUri] = await Promise.all([
      (async () => {
        try {
          const dataUri = await loadLogoAsPngDataUri(avatarUrl);
          if (avatarUrl && !dataUri) {
            console.warn('[OG/profile] avatar decode failed for', avatarUrl);
          }
          return dataUri;
        } catch (e) {
          console.warn('[OG/profile] avatar load threw', e);
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
    const nameSize = heroNameFontSize(nameUpper.length);

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

          {/* Corner brackets HUD esport top uniquement — les bottom sont
              retirés pour laisser place au footer horizontal "REJOINS-NOUS SUR
              · AEDRAL.COM" en bas centré. Cohérent avec OG structure horizontal. */}
          <div style={{ position: 'absolute', top: 24, left: 24, width: 40, height: 40, borderTop: '2px solid rgba(255,184,0,0.65)', borderLeft: '2px solid rgba(255,184,0,0.65)', display: 'flex' }} />
          <div style={{ position: 'absolute', top: 24, right: 24, width: 40, height: 40, borderTop: '2px solid rgba(255,184,0,0.65)', borderRight: '2px solid rgba(255,184,0,0.65)', display: 'flex' }} />

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

          {/* Colonne droite : meta + nom + country + chips + rang + slogan
              CTA.
              `justifyContent: 'center'` centre verticalement TOUT le bloc
              (vs `flex-start` qui tassait au top). Le slogan en bas-droite
              est positionné en absolute, donc il n'entre pas dans le calcul
              du centrage de la colonne droite. */}
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'center',
              flex: 1,
              paddingRight: 80,
              gap: 22,
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

            {/* Nom + country (sur la même ligne logique pour cohérence avec
                le bloc nom+tag de l'OG structure). */}
            <div style={{ display: 'flex', flexDirection: 'column' }}>
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

              {/* Country (si défini) — chip plus présente, fond or atténué
                  pour ressortir cohérent avec la palette Aedral. */}
              {country && (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    marginTop: 12,
                    fontFamily: ff,
                  }}
                >
                  <div
                    style={{
                      padding: '8px 20px',
                      fontSize: 24,
                      letterSpacing: '6px',
                      color: 'rgba(255,184,0,0.95)',
                      backgroundColor: 'rgba(255,184,0,0.10)',
                      border: '1px solid rgba(255,184,0,0.35)',
                      clipPath:
                        'polygon(8px 0, 100% 0, 100% calc(100% - 8px), calc(100% - 8px) 100%, 0 100%, 0 8px)',
                      display: 'flex',
                    }}
                  >
                    {country.toUpperCase().slice(0, 24)}
                  </div>
                </div>
              )}
            </div>

            {/* Chips jeux (fond plein + icône officielle, alignées avec OG structure) */}
            {visibleGames.length > 0 && (
              <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
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
                      fontSize: 22,
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

            {/* Rang hero (en gros, couleur officielle du tier si reconnu) */}
            {heroRank && (
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 20,
                  fontFamily: ff,
                }}
              >
                {/* Icône du rang (si dispo) — 96×96 pour visibilité,
                    glow subtil de la couleur du tier */}
                {rankIconDataUri && (
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      width: 96,
                      height: 96,
                      backgroundImage: `radial-gradient(circle, ${heroRank.color}33 0%, transparent 70%)`,
                    }}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={rankIconDataUri}
                      width={96}
                      height={96}
                      alt=""
                      style={{ objectFit: 'contain' }}
                    />
                  </div>
                )}
                {/* Label + nom du rang */}
                <div style={{ display: 'flex', flexDirection: 'column' }}>
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
                      marginTop: 6,
                      fontSize: 48,
                      letterSpacing: '3px',
                      color: heroRank.color,
                      lineHeight: 1,
                      display: 'flex',
                    }}
                  >
                    {heroRank.value.toUpperCase()}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Footer horizontal : fine séparatrice or dégradée + slogan inline
              "REJOINS-NOUS SUR · AEDRAL.COM" centré en bas. Aligné sur le
              footer de l'OG structure horizontal pour cohérence cross-OG
              (signature Aedral identitaire en bas, pleine largeur). */}
          <div
            style={{
              position: 'absolute',
              bottom: 0,
              left: 0,
              right: 0,
              display: 'flex',
              flexDirection: 'column',
              fontFamily: ff,
            }}
          >
            <div
              style={{
                width: '100%',
                height: 1,
                background:
                  'linear-gradient(90deg, transparent 0%, rgba(255,184,0,0.32) 30%, rgba(255,184,0,0.42) 50%, rgba(255,184,0,0.32) 70%, transparent 100%)',
                display: 'flex',
              }}
            />
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 18,
                padding: '14px 0 22px 0',
              }}
            >
              <div
                style={{
                  fontSize: 14,
                  letterSpacing: '6px',
                  color: 'rgba(255,255,255,0.5)',
                  display: 'flex',
                }}
              >
                REJOINS-NOUS SUR
              </div>
              <div style={{ color: 'rgba(255,184,0,0.55)', fontSize: 16, display: 'flex' }}>·</div>
              <div
                style={{
                  fontSize: 24,
                  letterSpacing: '8px',
                  color: AEDRAL_PALETTE.gold,
                  display: 'flex',
                  textShadow: '0 0 20px rgba(255,184,0,0.4)',
                }}
              >
                AEDRAL.COM
              </div>
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
