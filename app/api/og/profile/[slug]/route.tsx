import { ImageResponse } from 'next/og';
import { NextRequest } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { captureApiError } from '@/lib/sentry';
import { isLegacyUid } from '@/lib/user-slug';
import { getGameColor, getGameLogoUrl, getGameShortLabel, isGameLogoTransparent } from '@/lib/games-registry';
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
  loadUserStructureForOg,
  materializeOgResponse,
  pickHeroRanks,
  pickVisibleGames,
  type HeroRank,
} from '@/lib/og-helpers';
import type { OgDisplayPreferences } from '@/types';
import { canUserCustomizeOgDisplay } from '@/lib/plan-limits';

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

/** Chip jeu — 2 variants selon `logoIsTransparent` du jeu :
 *  - Transparent (RL, Valorant) → variant "logo seul" : icône XL + label texte,
 *    pas de fond plein (le logo se découpe directement sur le hex Aedral).
 *  - Opaque (TM) → variant "chip rempli" : icône posée sur un rectangle de
 *    la couleur du jeu pour cacher le carré opaque du PNG. */
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
    if (!iconDataUri) {
      return (
        <div
          style={{
            display: 'flex',
            fontSize: 24,
            letterSpacing: '4px',
            color: 'rgba(255,255,255,0.85)',
            fontFamily: ff,
          }}
        >
          {short}
        </div>
      );
    }
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={iconDataUri}
        width={90}
        height={90}
        alt={short}
        style={{ objectFit: 'contain', display: 'flex' }}
      />
    );
  }

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

// Logique pickHeroRank centralisée dans lib/og-helpers.ts (pickHeroRanks).
// Returns 0/1/2 rangs selon les préférences user (ogDisplay.ranks) ou fallback
// auto-detect si pas de préférences.

/** Drapeau dessiné en pur CSS (3 bandes verticales). Dupliqué de la route
 *  story pour cohérence visuelle cross-OG. Limité aux pays Aedral courants
 *  (FR, BE) pour l'instant. Retour null si pays sans drapeau dispo
 *  (CH croix, UK union jack, US étoiles, etc.). */
function CountryFlag({ code, width = 40 }: { code: string; width?: number }) {
  const c = code.toUpperCase().slice(0, 2);
  const height = Math.round(width * 0.66);
  const bandWidth = Math.round(width / 3);
  const bands: { stripes: [string, string, string] } | null =
    c === 'FR' ? { stripes: ['#002395', '#FFFFFF', '#ED2939'] }
    : c === 'BE' ? { stripes: ['#000000', '#FAE042', '#ED2939'] }
    : null;
  if (!bands) return null;
  return (
    <div
      style={{
        display: 'flex',
        width,
        height,
        border: '1px solid rgba(255,255,255,0.18)',
      }}
    >
      <div style={{ width: bandWidth, height: '100%', backgroundColor: bands.stripes[0] }} />
      <div style={{ width: bandWidth, height: '100%', backgroundColor: bands.stripes[1] }} />
      <div style={{ width: width - bandWidth * 2, height: '100%', backgroundColor: bands.stripes[2] }} />
    </div>
  );
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
    const avatarUrl = buildAvatarUrl(userData);
    // Préférences user (cap 2 rangs). Gate-friendly via canUserCustomizeOgDisplay.
    const canCustomize = canUserCustomizeOgDisplay(userData as { uid?: string });
    const heroRanks: HeroRank[] = pickHeroRanks(userData, { canCustomize });

    // Chips jeux : si ranks customs sélectionnés, n'afficher QUE ces logos
    // (retour Matt 30/05). Sinon : tous les jeux pratiqués (cap 3).
    const { games: visibleGames, extra: extraGames } = pickVisibleGames(userData, {
      canCustomize,
      capWhenAuto: 3,
    });

    // Préférences struct/team (default true si non défini). Gate par canCustomize.
    const ogPrefs: OgDisplayPreferences | null = canCustomize
      ? ((userData.ogDisplay && typeof userData.ogDisplay === 'object')
        ? userData.ogDisplay as OgDisplayPreferences
        : null)
      : null;
    const showStructure = ogPrefs?.showStructure !== false;
    const showTeam = ogPrefs?.showTeam !== false;

    // Tous les chargements lourds en parallèle (avatar Discord + icônes jeux
    // officielles + icônes rangs N + structure du user). Raccourcit le TTFB
    // de la route de ~3x quand toutes les requêtes sont indépendantes.
    const [avatarDataUri, gameIconDataUris, rankIconDataUris, userStruct] = await Promise.all([
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
      Promise.all(
        heroRanks.map(r => r.iconFile
          ? loadLocalIconAsPngDataUri(`${r.iconBasePath}/${r.iconFile}.png`)
          : Promise.resolve(null),
        ),
      ),
      showStructure ? loadUserStructureForOg(userData, db, ogPrefs) : Promise.resolve(null),
    ]);

    // Logo struct chargé séparément (URL externe → fetch async).
    const structLogoDataUri: string | null = userStruct?.structure.logoUrl
      ? await loadLogoAsPngDataUri(userStruct.structure.logoUrl)
      : null;

    const font = loadRajdhani();
    const hasFont = !!font;
    const ff = hasFont ? 'Rajdhani' : 'sans-serif';
    const hexUri = hexTextureDataUri(WIDTH, HEIGHT);

    const nameUpper = displayName.toUpperCase();
    const nameSize = heroNameFontSize(nameUpper.length);

    // materializeOgResponse : force le rendu satori DANS le try (sinon un
    // crash de rendu s'échappe pendant le streaming → 500 au lieu du fallback).
    return await materializeOgResponse(new ImageResponse(
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
              // paddingBottom 80 réserve la place pour le footer absolute
              // bottom (~60px slogan + ligne séparatrice). Sans ce padding,
              // le bloc struct/team se chevauche avec le footer slogan quand
              // l'user affiche 2 rangs + struct + équipe. Retour Matt 30/05 :
              // "quand je coche 2 jeux ca casse l'aperçu".
              paddingBottom: 80,
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

            {/* Nom + country sur la MÊME ligne (retour Matt 30/05 : "à côté
                du pseudo plutôt qu'en dessous"). Drapeau dessiné en CSS pur
                (FR, BE) + code 2 lettres, sans chip à fond moche. */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 24, flexWrap: 'wrap' }}>
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
              {country && (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    fontFamily: ff,
                  }}
                >
                  <CountryFlag code={country} width={40} />
                  <div
                    style={{
                      fontSize: 22,
                      letterSpacing: '5px',
                      color: 'rgba(255,255,255,0.85)',
                      display: 'flex',
                    }}
                  >
                    {country.toUpperCase().slice(0, 2)}
                  </div>
                </div>
              )}
            </div>

            {/* Chips jeux — gap large (28px) pour aérer la rangée (retour Matt 29/05). */}
            {visibleGames.length > 0 && (
              <div style={{ display: 'flex', gap: 28, alignItems: 'center', flexWrap: 'wrap' }}>
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

            {/* Rang(s) hero — nouveau layout (fix Matt 30/05) :
                LABEL au-dessus en pleine largeur, puis [icône] + VALUE en row
                inline alignés au centre vertical. Comme ça l'icône est
                visuellement alignée avec le nom du rang (pas avec label+nom),
                ce qui rend l'alignement vertical correct.
                - 1 rang : icône 96 + nom 48px
                - 2 rangs : 2 colonnes, icône 72 + nom 32px chaque
                Cap 2 customisable via Settings → Carte de partage. */}
            {heroRanks.length > 0 && (
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'row',
                  alignItems: 'flex-start',
                  gap: heroRanks.length === 2 ? 36 : 20,
                  fontFamily: ff,
                  flexWrap: 'wrap',
                }}
              >
                {heroRanks.map((rank, idx) => {
                  const isSingle = heroRanks.length === 1;
                  const iconSize = isSingle ? 96 : 72;
                  const nameSize = isSingle ? 48 : 32;
                  const labelSize = isSingle ? 16 : 14;
                  return (
                    <div
                      key={`${rank.gameId}-${idx}`}
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 8,
                      }}
                    >
                      {/* Label "RANG RL" en pleine largeur, puis row icône+nom */}
                      <div
                        style={{
                          fontSize: labelSize,
                          letterSpacing: '6px',
                          color: 'rgba(255,255,255,0.55)',
                          display: 'flex',
                        }}
                      >
                        {rank.label}
                      </div>
                      <div
                        style={{
                          display: 'flex',
                          flexDirection: 'row',
                          alignItems: 'center',
                          gap: isSingle ? 20 : 14,
                        }}
                      >
                        {/* Box icône avec placeholder pour les tiers sans PNG
                            (genre UNRANKED) → garde l'alignement entre 2 rangs.
                            ATTENTION satori : une clé style à `undefined` fait
                            crasher le rendu (`undefined.trim()` dans le parseur
                            CSS) → spread conditionnel, jamais `: undefined`.
                            C'était LE crash prod « failed to pipe response »
                            (profil avec rang Unranked = pas d'icône). */}
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            width: iconSize,
                            height: iconSize,
                            ...(rankIconDataUris[idx]
                              ? { backgroundImage: `radial-gradient(circle, ${rank.color}33 0%, transparent 70%)` }
                              : {}),
                          }}
                        >
                          {rankIconDataUris[idx] && (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={rankIconDataUris[idx]!}
                              width={iconSize}
                              height={iconSize}
                              alt=""
                              style={{ objectFit: 'contain' }}
                            />
                          )}
                        </div>
                        <div
                          style={{
                            fontSize: nameSize,
                            letterSpacing: isSingle ? '3px' : '2px',
                            color: rank.color,
                            lineHeight: 1,
                            display: 'flex',
                          }}
                        >
                          {rank.value.toUpperCase()}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Bloc structure + équipe (horizontal compact). Affiché si l'user
                a une structure ET showStructure !== false. Logo + tag + nom
                inline, équipe en dessous (plus petit) si showTeam true et team
                trouvée pour ce game. */}
            {userStruct && (
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  fontFamily: ff,
                  gap: 6,
                  marginTop: 4,
                }}
              >
                <div
                  style={{
                    fontSize: 12,
                    letterSpacing: '6px',
                    color: 'rgba(255,255,255,0.45)',
                    display: 'flex',
                  }}
                >
                  MEMBRE DE
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  {structLogoDataUri && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={structLogoDataUri}
                      width={32}
                      height={32}
                      alt=""
                      style={{ objectFit: 'contain', display: 'flex' }}
                    />
                  )}
                  <div
                    style={{
                      fontSize: 22,
                      letterSpacing: '2px',
                      color: AEDRAL_PALETTE.text,
                      display: 'flex',
                    }}
                  >
                    {userStruct.structure.name.toUpperCase()}
                  </div>
                </div>
                {showTeam && userStruct.team && (
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      fontSize: 14,
                      letterSpacing: '3px',
                      marginTop: 2,
                    }}
                  >
                    <span style={{ color: 'rgba(255,255,255,0.45)', display: 'flex' }}>ÉQUIPE</span>
                    <span style={{ display: 'flex', color: getGameColor(userStruct.team.game) }}>
                      {userStruct.team.name.toUpperCase()}
                    </span>
                  </div>
                )}
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
    ));
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
async function renderFallback(): Promise<Response> {
  try {
    const font = loadRajdhani();
    const ff = font ? 'Rajdhani' : 'sans-serif';
    const hexUri = hexTextureDataUri(WIDTH, HEIGHT);
    return await materializeOgResponse(new ImageResponse(
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
    ));
  } catch (fallbackErr) {
    captureApiError('API OG/profile fallback render error', fallbackErr);
    return new Response('Error', { status: 500 });
  }
}
