import { ImageResponse } from 'next/og';
import { NextRequest } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { isLegacyStructureId } from '@/lib/structure-slug';
import { captureApiError } from '@/lib/sentry';
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

// GET /api/og/structure/[id]
// Génère la bannière Open Graph (1200×630) pour la page publique d'une
// structure. Embeds Discord/Twitter consomment cette URL via la balise
// `og:image` injectée dans `app/community/structure/[id]/layout.tsx`.
//
// Route publique : les structures sont déjà publiques côté UI ; la bannière
// n'expose ni founderId ni infos sensibles, juste nom/tag/logo/jeux/membres
// + dirigeants visibles publiquement (déjà listés sur la page structure).
// Cache long (1h) pour limiter les appels Firestore quand un message Discord
// est ouvert par plusieurs personnes en rafale.
export const runtime = 'nodejs';

const WIDTH = OG_WIDTH;
const HEIGHT = OG_HEIGHT;

// Chip jeu remplie + icône officielle + label court. Cohérent avec les pills
// `<GameTag>` côté site, version OG (background plein pour ressortir sur la
// bannière sombre, contrastée pour rester lisible quelle que soit la couleur
// du jeu).
//
// Refonte 28/05 : chips GROSSES (icône 40px, label 26px, padding généreux)
// pour ressortir visuellement sur la colonne droite, avec les vrais logos
// officiels de jeux désormais haute résolution dans /public/games/.
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
        padding: '12px 22px 12px 16px',
        fontSize: 26,
        letterSpacing: '4px',
        color: textColor,
        // Fond PLEIN à la couleur officielle du jeu (vs ancien fond `${color}1A`).
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
          width={40}
          height={40}
          alt=""
          style={{ objectFit: 'contain', display: 'flex' }}
        />
      )}
      <div style={{ display: 'flex' }}>{short}</div>
    </div>
  );
}

/**
 * Récupère les displayName des dirigeants (founder + co-founders) pour les
 * afficher sous la ligne membres/équipes. Limite à 3 noms visibles, le reste
 * compté en `+N`. Tous les lookups sont parallélisés et résilients : un user
 * supprimé est simplement omis (pas de `?` affiché à sa place).
 */
async function loadDirectionNames(
  db: FirebaseFirestore.Firestore,
  founderId: string | null,
  coFounderIds: string[],
): Promise<{ visible: string[]; extra: number }> {
  // Ordre = founder en premier, puis cofounders dans leur ordre stocké (dédup).
  const orderedIds: string[] = [];
  if (founderId) orderedIds.push(founderId);
  for (const id of coFounderIds) {
    if (id && !orderedIds.includes(id)) orderedIds.push(id);
  }
  if (orderedIds.length === 0) return { visible: [], extra: 0 };

  // Lookups parallèles. Toute erreur sur 1 user → on l'omet silencieusement.
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

    // Accepte slug ("timetoshine") OU docId Firestore legacy ("fjUNrMQfPwiEisZcVixX").
    // Discrimination via `isLegacyStructureId` (majuscule OU longueur 20 alphanum
    // → docId direct ; sinon → lookup `where('slug', '==', id)`).
    // Le `docId` résolu sert à compter les `structure_members` et `sub_teams`
    // qui sont indexés par docId, jamais par slug.
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

    // 404 propre si structure inconnue / pending / suspendue : on évite de
    // générer une bannière pour une structure non publique. Discord ignorera
    // l'og:image et tombera sur le fallback racine d'Aedral.
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

    // Compteurs membres + équipes : préfère le counter dénormalisé (mis à jour
    // par chaque write critique via `bumpStructureCounter`), sinon compte les
    // collections à la volée en fallback. Les COUNT queries sont rares et
    // ne coûtent qu'un read par doc compté (cf. quotas Firestore).
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
        // Compte uniquement les équipes ACTIVES (les archivées ne sont pas
        // visibles côté UI public, donc ne doivent pas grossir le compteur).
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

    // Tous les chargements lourds en parallèle : logo + icônes jeu + lookup
    // dirigeants. Le `Promise.all` raccourcit le TTFB de la route de ~3x
    // quand toutes les requêtes sont indépendantes.
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
    const nameSize = heroNameFontSize(displayName.length);

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
          {/* Texture hex, signature DA Aedral */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={hexUri}
            width={WIDTH}
            height={HEIGHT}
            alt=""
            style={{ position: 'absolute', top: 0, left: 0 }}
          />

          {/* Accent bar dorée tout en haut, cohérente avec og/match */}
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

          {/* Corner brackets HUD esport (or 40×40, trait 2px) */}
          <div style={{ position: 'absolute', top: 24, left: 24, width: 40, height: 40, borderTop: '2px solid rgba(255,184,0,0.65)', borderLeft: '2px solid rgba(255,184,0,0.65)', display: 'flex' }} />
          <div style={{ position: 'absolute', top: 24, right: 24, width: 40, height: 40, borderTop: '2px solid rgba(255,184,0,0.65)', borderRight: '2px solid rgba(255,184,0,0.65)', display: 'flex' }} />
          <div style={{ position: 'absolute', bottom: 24, left: 24, width: 40, height: 40, borderBottom: '2px solid rgba(255,184,0,0.65)', borderLeft: '2px solid rgba(255,184,0,0.65)', display: 'flex' }} />
          <div style={{ position: 'absolute', bottom: 24, right: 24, width: 40, height: 40, borderBottom: '2px solid rgba(255,184,0,0.65)', borderRight: '2px solid rgba(255,184,0,0.65)', display: 'flex' }} />

          {/* Glow doré centré gauche, derrière le logo. Atténué pour ne pas
              cannibaliser l'identité visuelle de chaque structure. */}
          <div
            style={{
              position: 'absolute',
              top: '50%',
              left: 220,
              width: 360,
              height: 360,
              transform: 'translate(-50%, -50%)',
              background:
                'radial-gradient(circle, rgba(255,184,0,0.10) 0%, rgba(255,184,0,0.03) 45%, transparent 70%)',
              display: 'flex',
            }}
          />

          {/* Colonne gauche : logo XL ou initiales en bevel */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 340,
              height: 340,
              marginLeft: 90,
              marginRight: 50,
              backgroundColor: '#0c0c18',
              backgroundImage:
                'radial-gradient(ellipse at center, rgba(255,184,0,0.08) 0%, transparent 70%)',
              border: '2px solid rgba(255,184,0,0.45)',
              clipPath:
                'polygon(18px 0, 100% 0, 100% calc(100% - 18px), calc(100% - 18px) 100%, 0 100%, 0 18px)',
            }}
          >
            {logoDataUri ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={logoDataUri}
                width={260}
                height={260}
                style={{ objectFit: 'contain' }}
                alt=""
              />
            ) : (
              <div
                style={{
                  fontSize: 130,
                  color: 'rgba(255,255,255,0.85)',
                  letterSpacing: '6px',
                  display: 'flex',
                  fontFamily: ff,
                }}
              >
                {initials(name)}
              </div>
            )}
          </div>

          {/* Colonne droite : meta + nom + chips jeux + counts + dirigeants
              + slogan acquisition. Centrée verticalement pour équilibrer
              la composition (vs avant : tassée en bas). */}
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'center',
              flex: 1,
              paddingRight: 80,
              paddingTop: 40,
              paddingBottom: 40,
              gap: 22,
            }}
          >
            {/* Label STRUCTURE */}
            <div
              style={{
                fontSize: 20,
                letterSpacing: '10px',
                color: AEDRAL_PALETTE.gold,
                fontFamily: ff,
                display: 'flex',
              }}
            >
              STRUCTURE
            </div>

            {/* Nom + tag */}
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
                {displayName}
              </div>
              {tag && (
                <div
                  style={{
                    marginTop: 10,
                    fontSize: 24,
                    letterSpacing: '6px',
                    color: 'rgba(255,184,0,0.85)',
                    fontFamily: ff,
                    display: 'flex',
                  }}
                >
                  [{tag.toUpperCase()}]
                </div>
              )}
            </div>

            {/* Chips jeux (fond plein + icône officielle 40px + label 26px) */}
            {visibleGames.length > 0 && (
              <div style={{ display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap' }}>
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
                      fontSize: 24,
                      letterSpacing: '3px',
                      color: 'rgba(255,255,255,0.55)',
                      fontFamily: ff,
                      display: 'flex',
                    }}
                  >
                    +{extraGames}
                  </div>
                )}
              </div>
            )}

            {/* Compteurs membres + équipes : chiffre or 56px + label 18px en
                colonne par stat, séparateur ligne verticale or au milieu.
                Plus de middot mal aligné. */}
            {(members > 0 || teams > 0) && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 28,
                  fontFamily: ff,
                  marginTop: 6,
                }}
              >
                {members > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
                    <div
                      style={{
                        fontSize: 56,
                        color: AEDRAL_PALETTE.gold,
                        letterSpacing: '2px',
                        lineHeight: 1,
                        display: 'flex',
                      }}
                    >
                      {members}
                    </div>
                    <div
                      style={{
                        marginTop: 6,
                        fontSize: 18,
                        color: 'rgba(255,255,255,0.6)',
                        letterSpacing: '5px',
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
                      width: 1.5,
                      height: 64,
                      backgroundColor: 'rgba(255,184,0,0.4)',
                      display: 'flex',
                    }}
                  />
                )}
                {teams > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
                    <div
                      style={{
                        fontSize: 56,
                        color: AEDRAL_PALETTE.gold,
                        letterSpacing: '2px',
                        lineHeight: 1,
                        display: 'flex',
                      }}
                    >
                      {teams}
                    </div>
                    <div
                      style={{
                        marginTop: 6,
                        fontSize: 18,
                        color: 'rgba(255,255,255,0.6)',
                        letterSpacing: '5px',
                        display: 'flex',
                      }}
                    >
                      ÉQUIPE{teams > 1 ? 'S' : ''}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Bloc DIRECTION : liste fondateur + co-fondateurs. Skippé entièrement
                si aucun nom récupérable (founder supprimé + pas de co-founders). */}
            {direction.visible.length > 0 && (
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  marginTop: 4,
                  fontFamily: ff,
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
                  DIRECTION
                </div>
                <div
                  style={{
                    marginTop: 6,
                    fontSize: 24,
                    letterSpacing: '2px',
                    color: AEDRAL_PALETTE.text,
                    lineHeight: 1.2,
                    display: 'flex',
                    flexWrap: 'wrap',
                    gap: 10,
                    alignItems: 'baseline',
                  }}
                >
                  {direction.visible.map((n, idx) => (
                    <div key={`dir-${idx}`} style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
                      <div style={{ display: 'flex' }}>{n}</div>
                      {idx < direction.visible.length - 1 && (
                        <div style={{ color: 'rgba(255,184,0,0.55)', display: 'flex' }}>·</div>
                      )}
                    </div>
                  ))}
                  {direction.extra > 0 && (
                    <div
                      style={{
                        fontSize: 20,
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

            {/* Slogan acquisition : "REJOINS-NOUS SUR AEDRAL.COM" en bas de
                la colonne droite. Cohérent avec le watermark des stories
                verticales. Remplace l'ancien footer "AEDRAL" pour éviter
                le doublon et donner un vrai CTA. */}
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                marginTop: 12,
                fontFamily: ff,
              }}
            >
              <div
                style={{
                  fontSize: 14,
                  letterSpacing: '5px',
                  color: 'rgba(255,255,255,0.45)',
                  display: 'flex',
                }}
              >
                REJOINS-NOUS SUR
              </div>
              <div
                style={{
                  marginTop: 6,
                  fontSize: 30,
                  letterSpacing: '6px',
                  color: AEDRAL_PALETTE.gold,
                  display: 'flex',
                  textShadow: '0 0 24px rgba(255,184,0,0.35)',
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
    // L'URL est intégrée dans un embed Discord, un 500 laisserait un trou
    // visuel. On logue pour Sentry puis on renvoie une bannière dégradée
    // mais valide (aucune dépendance Firestore) pour que l'embed reste propre.
    captureApiError('API OG/structure GET error', err);
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
                fontSize: 42,
                color: AEDRAL_PALETTE.gold,
                letterSpacing: '12px',
                fontFamily: ff,
                display: 'flex',
              }}
            >
              AEDRAL
            </div>
            <div
              style={{
                marginTop: 12,
                fontSize: 22,
                color: 'rgba(255,255,255,0.5)',
                letterSpacing: '4px',
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
          // Pas de cache long sur la version dégradée : un retry après
          // correction doit pouvoir resservir la vraie bannière.
          headers: { 'Cache-Control': 'public, max-age=60' },
        },
      );
    } catch (fallbackErr) {
      captureApiError('API OG/structure GET fallback render error', fallbackErr);
      return new Response('Error', { status: 500 });
    }
  }
}
