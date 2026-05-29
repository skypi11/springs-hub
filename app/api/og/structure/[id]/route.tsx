import { ImageResponse } from 'next/og';
import { NextRequest } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { isLegacyStructureId } from '@/lib/structure-slug';
import { captureApiError } from '@/lib/sentry';
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

// GET /api/og/structure/[id]
// Génère la bannière Open Graph (1200×630) pour la page publique d'une
// structure. Embeds Discord/Twitter consomment cette URL via la balise
// `og:image` injectée dans `app/community/structure/[id]/layout.tsx`.
//
// Route publique : les structures sont déjà publiques côté UI ; la bannière
// n'expose ni founderId ni infos sensibles, juste nom/tag/logo/jeux/membres.
// Cache long (1h) pour limiter les appels Firestore quand un message Discord
// est ouvert par plusieurs personnes en rafale.
export const runtime = 'nodejs';

const WIDTH = OG_WIDTH;
const HEIGHT = OG_HEIGHT;

// Carte de jeu (chip colorée) pour la liste des jeux pratiqués par la structure.
// Couleur consommée depuis la registry (lib/games-registry.ts) → cohérent avec
// les pills `<GameTag>` du site.
function GameChip({ gameId, ff }: { gameId: string; ff: string }) {
  const color = getGameColor(gameId);
  const short = getGameShortLabel(gameId);
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        padding: '10px 22px',
        fontSize: 22,
        letterSpacing: '4px',
        color,
        // Background teinté ~10% opacité + border ~35% : même recette visuelle
        // que les `.tag-*` du design system côté site.
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
    // Le `docId` résolu sert à compter les `structure_members` qui sont indexés
    // par docId, jamais par slug.
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

    // Compteur de membres : préfère le counter dénormalisé (mis à jour par le
    // cron `backfill-counters`), sinon compte les `structure_members` à la volée.
    // Le compte à la volée n'est exécuté que comme fallback rare.
    let members: number = 0;
    const counters = data.counters && typeof data.counters === 'object' ? data.counters as Record<string, unknown> : null;
    if (counters && typeof counters.members === 'number') {
      members = counters.members;
    } else {
      try {
        // IMPORTANT : on compte sur `docId` résolu, jamais sur le param
        // d'entrée (qui peut être un slug et ne matcherait aucun
        // `structure_members.structureId`).
        const aggSnap = await db.collection('structure_members')
          .where('structureId', '==', docId)
          .count()
          .get();
        members = aggSnap.data().count ?? 0;
      } catch {
        members = 0;
      }
    }

    const logoDataUri = await loadLogoAsPngDataUri(logoUrl);

    const font = loadRajdhani();
    const hasFont = !!font;
    const ff = hasFont ? 'Rajdhani' : 'sans-serif';
    const hexUri = hexTextureDataUri(WIDTH, HEIGHT);

    const displayName = name.toUpperCase();
    const nameSize = heroNameFontSize(displayName.length);

    // On limite à 3 jeux dans la bannière pour éviter un retour à la ligne
    // disgracieux. Au-delà, on ajoute un "+N" discret.
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
              width: 360,
              height: 360,
              marginLeft: 100,
              marginRight: 60,
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
                width={280}
                height={280}
                style={{ objectFit: 'contain' }}
                alt=""
              />
            ) : (
              <div
                style={{
                  fontSize: 140,
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

          {/* Colonne droite : meta + nom + chips jeux + compteur membres */}
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'center',
              flex: 1,
              paddingRight: 80,
              gap: 20,
            }}
          >
            {/* Label STRUCTURE */}
            <div
              style={{
                fontSize: 22,
                letterSpacing: '10px',
                color: AEDRAL_PALETTE.gold,
                fontFamily: ff,
                display: 'flex',
              }}
            >
              STRUCTURE
            </div>

            {/* Nom + tag */}
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
              }}
            >
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
                    marginTop: 12,
                    fontSize: 26,
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

            {/* Chips jeux */}
            {visibleGames.length > 0 && (
              <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                {visibleGames.map(g => (
                  <GameChip key={g} gameId={g} ff={ff} />
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

            {/* Compteur de membres */}
            {members > 0 && (
              <div
                style={{
                  marginTop: 8,
                  display: 'flex',
                  alignItems: 'baseline',
                  gap: 14,
                  fontFamily: ff,
                }}
              >
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
                    fontSize: 22,
                    color: 'rgba(255,255,255,0.6)',
                    letterSpacing: '6px',
                    display: 'flex',
                  }}
                >
                  MEMBRE{members > 1 ? 'S' : ''}
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
