import { ImageResponse } from 'next/og';
import { NextRequest } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { captureApiError } from '@/lib/sentry';
import { isLegacyUid } from '@/lib/user-slug';
import { getGameColor, getGameLogoUrl, getGameShortLabel, isGameLogoTransparent } from '@/lib/games-registry';
import {
  AEDRAL_PALETTE,
  bestTextColor,
  hexTextureDataUri,
  initials,
  loadLocalIconAsPngDataUri,
  loadLogoAsPngDataUri,
  loadRajdhani,
  loadUserStructureForOg,
  pickHeroRanks,
  pickVisibleGames,
  type HeroRank,
  type UserOgStructureBlock,
} from '@/lib/og-helpers';
import type { OgDisplayPreferences } from '@/types';
import { canUserCustomizeOgDisplay } from '@/lib/plan-limits';

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

/** Chip jeu version story.
 *
 *  Deux variants selon `logoIsTransparent` du jeu :
 *  - Transparent (RL, Valorant) → variant "logo seul" : icône XL 96px + label
 *    texte à droite, pas de fond plein (le logo se découpe directement sur le
 *    hex Aedral). Bordure or subtile pour structurer.
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
    // Variant "logo nu" : juste l'image, pas de chip, pas de bordure, pas de
    // label texte. Le logo officiel est self-descriptif (gamers reconnaissent
    // RL/Valorant au premier coup d'œil). Retour Matt 29/05 : "juste le logo".
    // Fallback texte si l'image n'a pas pu être chargée.
    if (!iconDataUri) {
      return (
        <div
          style={{
            display: 'flex',
            fontSize: 36,
            letterSpacing: '6px',
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
        width={110}
        height={110}
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
        gap: 16,
        padding: '16px 30px 16px 22px',
        fontSize: 36,
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
          width={48}
          height={48}
          alt=""
          style={{ objectFit: 'contain', display: 'flex' }}
        />
      )}
      <div style={{ display: 'flex' }}>{short}</div>
    </div>
  );
}

/** Drapeau dessiné en pur CSS (3 bandes verticales). Limité aux pays
 *  Aedral-courants pour l'instant : FR, BE, LU. Pour les autres (CH avec
 *  croix, US étoiles, UK union jack…), on retombe sur le code seul.
 *  Retourne null si le pays n'a pas de drapeau dispo. */
function CountryFlag({ code, width = 56 }: { code: string; width?: number }) {
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

// Cf. doc dans l'endpoint horizontal — gère URL complète OU hash brut Discord
// (statique ou animé `a_…`, on force PNG côté CDN).
//
// IMPORTANT : on filtre EXPLICITEMENT les strings vides (`avatarUrl: ""`)
// car `??` ne tomberait pas sur le fallback `discordAvatar`. Cas observé en
// prod où avatarUrl est "" mais discordAvatar est une URL Discord valide.
function buildAvatarUrl(data: FirebaseFirestore.DocumentData): string | null {
  const candidates = [data.avatarUrl, data.discordAvatar];
  const raw = candidates.find(
    (v): v is string => typeof v === 'string' && v.trim().length > 0,
  );
  if (!raw) return null;

  if (raw.startsWith('http://') || raw.startsWith('https://')) return raw;
  const discordId = typeof data.discordId === 'string' ? data.discordId : null;
  if (discordId && /^a?_?[a-f0-9]+$/i.test(raw)) {
    return `https://cdn.discordapp.com/avatars/${discordId}/${raw}.png?size=512`;
  }
  return null;
}

// Logique pickHeroRank centralisée dans lib/og-helpers.ts (pickHeroRanks)
// Returns 0/1/2 rangs selon les préférences user (ogDisplay.ranks) ou fallback
// auto-detect si pas de préférences. Cf. mémoire project_og_customization.

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
    const avatarUrl = buildAvatarUrl(userData);
    // Préférences user (cap 2 rangs). Gate-friendly : si l'user n'a pas droit
    // de customiser (gate premium futur), retombe sur l'auto-detect historique.
    const canCustomize = canUserCustomizeOgDisplay(userData as { uid?: string });
    const heroRanks: HeroRank[] = pickHeroRanks(userData, { canCustomize });

    // Chips jeux : si l'user a choisi des rangs à afficher, on ne montre QUE
    // les logos correspondants (retour Matt 30/05). Sinon, tous les jeux
    // pratiqués (cap 3).
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
    const showStructure = ogPrefs?.showStructure !== false; // default true
    const showTeam = ogPrefs?.showTeam !== false; // default true

    // Tous les chargements en parallèle : avatar, icônes jeux, icônes rangs,
    // structure du user (struct + team via 2 reads Firestore).
    const [avatarDataUri, gameIconDataUris, rankIconDataUris, userStruct] = await Promise.all([
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
      Promise.all(
        heroRanks.map(r => r.iconFile
          ? loadLocalIconAsPngDataUri(`${r.iconBasePath}/${r.iconFile}.png`)
          : Promise.resolve(null),
        ),
      ),
      showStructure ? loadUserStructureForOg(userData, db, ogPrefs) : Promise.resolve(null),
    ]);

    // Charge le logo de structure si on en a une à afficher.
    const structLogoDataUri: string | null = userStruct?.structure.logoUrl
      ? await loadLogoAsPngDataUri(userStruct.structure.logoUrl)
      : null;

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

          {/* Country (si défini) : drapeau CSS pur (FR, BE) + code 2 lettres,
              SANS fond ni bordure. Retour Matt 29/05 : l'ancien chip à fond
              gris-blanc semi-transparent rendait mal sur l'image story.
              Pour les pays sans drapeau dispo (CH croix, UK union jack, …),
              on retombe sur le code seul. */}
          {country && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 18,
                fontFamily: ff,
                marginBottom: 30,
              }}
            >
              <CountryFlag code={country} width={56} />
              <div
                style={{
                  fontSize: 32,
                  letterSpacing: '8px',
                  color: 'rgba(255,255,255,0.9)',
                  display: 'flex',
                }}
              >
                {country.toUpperCase().slice(0, 2)}
              </div>
            </div>
          )}

          {/* Chips jeux centrées — gap large (40px) pour aérer la rangée de
              logos (retour Matt 29/05 : "plus d'espace entre les logos"). */}
          {visibleGames.length > 0 && (
            <div
              style={{
                display: 'flex',
                gap: 40,
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

          {/* Bloc rang(s) hero — 2 layouts :
              - 1 rang : stacked vertical centré (label, icône 180×180, nom 68px)
              - 2 rangs : 2 mini-blocs côte à côte (label, icône 130×130, nom 44px)
              Customisable via Settings → Affichage public (cap 2). Fallback
              auto-detect si pas de préférences. */}
          {heroRanks.length === 1 && (
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
                  marginBottom: 24,
                }}
              >
                {heroRanks[0].label}
              </div>
              {rankIconDataUris[0] && (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: 200,
                    height: 200,
                    backgroundImage: `radial-gradient(circle, ${heroRanks[0].color}40 0%, transparent 70%)`,
                    marginBottom: 22,
                  }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={rankIconDataUris[0]}
                    width={180}
                    height={180}
                    alt=""
                    style={{ objectFit: 'contain' }}
                  />
                </div>
              )}
              <div
                style={{
                  fontSize: 68,
                  letterSpacing: '5px',
                  color: heroRanks[0].color,
                  lineHeight: 1.1,
                  display: 'flex',
                  textAlign: 'center',
                  maxWidth: 960,
                  textShadow: `0 0 24px ${heroRanks[0].color}55`,
                }}
              >
                {heroRanks[0].value.toUpperCase()}
              </div>
            </div>
          )}
          {heroRanks.length === 2 && (
            <div
              style={{
                display: 'flex',
                flexDirection: 'row',
                alignItems: 'flex-start',
                justifyContent: 'center',
                gap: 60,
                fontFamily: ff,
                marginTop: 8,
                maxWidth: 960,
              }}
            >
              {heroRanks.map((rank, idx) => (
                <div
                  key={`${rank.gameId}-${idx}`}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    maxWidth: 430,
                  }}
                >
                  <div
                    style={{
                      fontSize: 18,
                      letterSpacing: '8px',
                      color: 'rgba(255,255,255,0.55)',
                      display: 'flex',
                      marginBottom: 18,
                    }}
                  >
                    {rank.label}
                  </div>
                  {/* Toujours réserver l'espace icône (placeholder vide si rang
                      sans icon, ex. UNRANKED) pour aligner les noms des 2 rangs
                      à la même hauteur. Retour Matt 30/05 : "le rank est pas
                      à la meme hauteur". */}
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      width: 150,
                      height: 150,
                      backgroundImage: rankIconDataUris[idx]
                        ? `radial-gradient(circle, ${rank.color}40 0%, transparent 70%)`
                        : undefined,
                      marginBottom: 16,
                    }}
                  >
                    {rankIconDataUris[idx] && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={rankIconDataUris[idx]!}
                        width={130}
                        height={130}
                        alt=""
                        style={{ objectFit: 'contain' }}
                      />
                    )}
                  </div>
                  <div
                    style={{
                      fontSize: 44,
                      letterSpacing: '3px',
                      color: rank.color,
                      lineHeight: 1.1,
                      display: 'flex',
                      textAlign: 'center',
                      textShadow: `0 0 18px ${rank.color}55`,
                    }}
                  >
                    {rank.value.toUpperCase()}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Bloc structure + équipe (toggle ogDisplay.showStructure/showTeam,
              default true si non défini). Affiché si le user a une structure
              active. Pas affiché si ogPrefs.showStructure === false. */}
          {userStruct && (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                fontFamily: ff,
                marginTop: 36,
                gap: 14,
              }}
            >
              <div
                style={{
                  fontSize: 16,
                  letterSpacing: '8px',
                  color: 'rgba(255,255,255,0.5)',
                  display: 'flex',
                }}
              >
                MEMBRE DE
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                {structLogoDataUri && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={structLogoDataUri}
                    width={64}
                    height={64}
                    alt=""
                    style={{ objectFit: 'contain', display: 'flex' }}
                  />
                )}
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
                  {userStruct.structure.tag && (
                    <div
                      style={{
                        fontSize: 18,
                        letterSpacing: '6px',
                        color: 'rgba(255,184,0,0.85)',
                        display: 'flex',
                      }}
                    >
                      [{userStruct.structure.tag.toUpperCase()}]
                    </div>
                  )}
                  <div
                    style={{
                      fontSize: 42,
                      letterSpacing: '3px',
                      color: AEDRAL_PALETTE.text,
                      lineHeight: 1.05,
                      display: 'flex',
                    }}
                  >
                    {userStruct.structure.name.toUpperCase()}
                  </div>
                </div>
              </div>
              {showTeam && userStruct.team && (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    marginTop: 4,
                    fontSize: 22,
                    letterSpacing: '4px',
                    color: 'rgba(255,255,255,0.75)',
                  }}
                >
                  <span style={{ color: 'rgba(255,255,255,0.5)', display: 'flex' }}>ÉQUIPE</span>
                  <span style={{ display: 'flex', color: getGameColor(userStruct.team.game) }}>
                    {userStruct.team.name.toUpperCase()}
                  </span>
                </div>
              )}
            </div>
          )}

          {/* WATERMARK AEDRAL.COM — moyen d'acquisition principal de la story.
              Bien visible, encadré entre les corner brackets bas. Fine
              séparatrice or dégradée au-dessus pour cohérence visuelle avec
              le footer des OG horizontaux (signature Aedral identitaire). */}
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
          // PAS de cache pour les stories : c'est un download manuel ponctuel
          // déclenché par le propriétaire qui veut toujours la version la plus
          // fraîche (rang à jour, nouvel avatar, etc.). Pas de bots Discord/
          // Twitter qui crawlent cette URL (eux utilisent l'OG horizontal).
          // Le coût de re-générer une image story (~500ms-1s) est acceptable
          // pour un download ponctuel — pas besoin d'optimiser via CDN.
          'Cache-Control': 'private, no-store, no-cache, must-revalidate',
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
