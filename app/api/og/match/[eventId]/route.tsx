import { ImageResponse } from 'next/og';
import { NextRequest } from 'next/server';
import fs from 'node:fs';
import path from 'node:path';
import { getAdminDb } from '@/lib/firebase-admin';

// Route publique : l'URL est intégrée dans les messages Discord, donc accessible
// par Discord pour générer sa preview. Pas d'info sensible, juste nom équipe/
// adversaire + logos (déjà publics). Cache long pour limiter les appels Firestore.
export const runtime = 'nodejs';

const WIDTH = 1200;
const HEIGHT = 630;

// Rajdhani 700 : police esport/gaming angulaire qui rime avec les biseaux de la
// DA Springs. TTF bundlée dans /public/fonts (fetch Google Fonts au runtime était
// fragile). Lue une seule fois puis cachée module-level.
let RAJDHANI_CACHE: Buffer | null = null;
function loadRajdhani(): Buffer | null {
  if (RAJDHANI_CACHE) return RAJDHANI_CACHE;
  try {
    const p = path.join(process.cwd(), 'public', 'fonts', 'Rajdhani-Bold.ttf');
    RAJDHANI_CACHE = fs.readFileSync(p);
    return RAJDHANI_CACHE;
  } catch {
    return null;
  }
}

// Couleurs par jeu (alignées sur la DA Springs : bleu RL, vert TM).
const GAME_META: Record<string, { label: string; color: string }> = {
  rocket_league: { label: 'ROCKET LEAGUE', color: '#0081FF' },
  trackmania: { label: 'TRACKMANIA', color: '#00D936' },
};

// Génère une trame hexagonale (honeycomb) en SVG, taille exacte de la bannière.
// Rendue en absolute <img> par-dessus le fond — signature DA Springs.
function hexTextureDataUri(width: number, height: number): string {
  const r = 38; // rayon hexagone
  const stepX = r * Math.sqrt(3);
  const stepY = r * 1.5;
  const paths: string[] = [];
  for (let row = -1; row * stepY < height + r; row++) {
    const offsetX = row % 2 === 0 ? 0 : stepX / 2;
    for (let col = -1; col * stepX < width + stepX; col++) {
      const cx = col * stepX + offsetX;
      const cy = row * stepY;
      const w2 = stepX / 2;
      const r2 = r / 2;
      paths.push(
        `M${cx},${cy - r} L${cx + w2},${cy - r2} L${cx + w2},${cy + r2} L${cx},${cy + r} L${cx - w2},${cy + r2} L${cx - w2},${cy - r2}Z`,
      );
    }
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><g fill="none" stroke="rgba(255,255,255,0.055)" stroke-width="1">${paths.map(p => `<path d="${p}"/>`).join('')}</g></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

function nameFontSize(maxLen: number): number {
  if (maxLen <= 9) return 64;
  if (maxLen <= 13) return 52;
  if (maxLen <= 18) return 40;
  return 32;
}

function initials(name: string): string {
  return name.trim().slice(0, 3).toUpperCase() || '?';
}

// IMPORTANT : le runtime Vercel tourne en UTC. Sans timeZone explicite, une
// heure stockée en UTC s'affiche décalée de -2h (Paris en été) ou -1h (hiver).
// On force Europe/Paris pour que la bannière matche l'heure affichée sur le site.
function formatMatchDate(ms: number): string {
  const d = new Date(ms);
  const day = d.toLocaleDateString('fr-FR', {
    weekday: 'short', day: '2-digit', month: 'short',
    timeZone: 'Europe/Paris',
  }).toUpperCase().replace(/\./g, '');
  const time = d.toLocaleTimeString('fr-FR', {
    hour: '2-digit', minute: '2-digit',
    timeZone: 'Europe/Paris',
  });
  return `${day} · ${time}`;
}

function LogoBox({
  url,
  fallback,
  tint,
  glowColor,
  rajdhani,
}: {
  url: string | null;
  fallback: string;
  tint: string;
  glowColor: string;
  rajdhani: boolean;
}) {
  return (
    <div
      style={{
        width: 280,
        height: 280,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        // Gradient radial interne : donne du poids aux logos fins comme MZC,
        // sans toucher à l'aspect ratio.
        // Fond solide pour bloquer la trame hex derrière le logo + léger glow
        // interne tinté (blanc ou or) pour garder de la présence.
        backgroundColor: '#0c0c18',
        backgroundImage: `radial-gradient(ellipse at center, ${glowColor} 0%, transparent 70%)`,
        border: `2px solid ${tint}`,
        clipPath:
          'polygon(14px 0, 100% 0, 100% calc(100% - 14px), calc(100% - 14px) 100%, 0 100%, 0 14px)',
      }}
    >
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} width={220} height={220} style={{ objectFit: 'contain' }} alt="" />
      ) : (
        <div
          style={{
            fontSize: 110,
            color: 'rgba(255,255,255,0.85)',
            letterSpacing: '4px',
            display: 'flex',
            fontFamily: rajdhani ? 'Rajdhani' : 'sans-serif',
          }}
        >
          {fallback}
        </div>
      )}
    </div>
  );
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ eventId: string }> }
) {
  try {
    const { eventId } = await params;
    const db = getAdminDb();

    const evSnap = await db.collection('structure_events').doc(eventId).get();
    if (!evSnap.exists) return new Response('Not found', { status: 404 });
    const ev = evSnap.data()!;

    const structureSnap = await db.collection('structures').doc(ev.structureId).get();
    const structure = structureSnap.data() ?? {};
    const structureLogoUrl = (structure.logoUrl as string | undefined) || null;
    const structureName = (structure.name as string | undefined) || 'Équipe';

    let teamName = structureName;
    let teamLogoUrl = structureLogoUrl;
    let game: string | null = (ev.target?.game as string | undefined) ?? null;
    const teamIds = (ev.target?.teamIds as string[] | undefined) ?? [];
    if (ev.target?.scope === 'teams' && teamIds.length > 0) {
      const teamSnap = await db.collection('sub_teams').doc(teamIds[0]).get();
      const team = teamSnap.data();
      if (team) {
        teamName = (team.name as string | undefined) || structureName;
        teamLogoUrl = (team.logoUrl as string | undefined) || structureLogoUrl;
        game = game || ((team.game as string | undefined) ?? null);
      }
    }

    const adversaire = (ev.adversaire as string | undefined) || 'Adversaire';
    const adversaryLogoUrl = (ev.adversaireLogoUrl as string | undefined) || null;

    const teamLabel = teamName.toUpperCase().slice(0, 22);
    const advLabel = adversaire.toUpperCase().slice(0, 22);
    const namesSize = nameFontSize(Math.max(teamLabel.length, advLabel.length));

    const gameMeta = game && GAME_META[game] ? GAME_META[game] : null;

    const startMs = typeof ev.startsAt?.toMillis === 'function'
      ? ev.startsAt.toMillis()
      : (typeof ev.startsAt === 'number' ? ev.startsAt : 0);
    const dateStr = startMs > 0 ? formatMatchDate(startMs) : '';

    const font = loadRajdhani();
    const hasFont = !!font;
    const ff = hasFont ? 'Rajdhani' : 'sans-serif';

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
            background:
              'linear-gradient(135deg, #08080f 0%, #151525 50%, #0e0e1a 100%)',
            position: 'relative',
          }}
        >
          {/* Texture hexagonale — signature DA Springs */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={hexUri}
            width={WIDTH}
            height={HEIGHT}
            alt=""
            style={{ position: 'absolute', top: 0, left: 0 }}
          />

          {/* Glow or derrière VS — profondeur visuelle. Resserré pour rester
              concentré sur le VS sans déborder sur les logos. */}
          <div
            style={{
              position: 'absolute',
              top: '50%',
              left: '50%',
              width: 320,
              height: 320,
              transform: 'translate(-50%, -50%)',
              background:
                'radial-gradient(circle, rgba(255,184,0,0.12) 0%, rgba(255,184,0,0.03) 40%, transparent 65%)',
              display: 'flex',
            }}
          />

          {/* Accent bar top */}
          <div
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              height: 6,
              background:
                'linear-gradient(90deg, #FFB800 0%, #ff8800 50%, #FFB800 100%)',
              display: 'flex',
            }}
          />

          {/* Corner brackets façon HUD esport — coins or 40x40, trait 2px */}
          <div style={{ position: 'absolute', top: 24, left: 24, width: 40, height: 40, borderTop: '2px solid rgba(255,184,0,0.65)', borderLeft: '2px solid rgba(255,184,0,0.65)', display: 'flex' }} />
          <div style={{ position: 'absolute', top: 24, right: 24, width: 40, height: 40, borderTop: '2px solid rgba(255,184,0,0.65)', borderRight: '2px solid rgba(255,184,0,0.65)', display: 'flex' }} />
          <div style={{ position: 'absolute', bottom: 24, left: 24, width: 40, height: 40, borderBottom: '2px solid rgba(255,184,0,0.65)', borderLeft: '2px solid rgba(255,184,0,0.65)', display: 'flex' }} />
          <div style={{ position: 'absolute', bottom: 24, right: 24, width: 40, height: 40, borderBottom: '2px solid rgba(255,184,0,0.65)', borderRight: '2px solid rgba(255,184,0,0.65)', display: 'flex' }} />

          {/* Label MATCH OFFICIEL */}
          <div
            style={{
              marginBottom: 12,
              padding: '8px 24px',
              fontSize: 22,
              letterSpacing: '8px',
              color: '#FFB800',
              background: 'rgba(255,184,0,0.08)',
              border: '1px solid rgba(255,184,0,0.35)',
              display: 'flex',
              fontFamily: ff,
            }}
          >
            MATCH OFFICIEL
          </div>

          {/* Ligne meta : tag jeu + date */}
          {(gameMeta || dateStr) && (
            <div
              style={{
                marginBottom: 28,
                display: 'flex',
                alignItems: 'center',
                gap: 16,
              }}
            >
              {gameMeta && (
                <div
                  style={{
                    fontSize: 20,
                    color: gameMeta.color,
                    letterSpacing: '4px',
                    fontFamily: ff,
                    display: 'flex',
                  }}
                >
                  {gameMeta.label}
                </div>
              )}
              {gameMeta && dateStr && (
                <div
                  style={{
                    fontSize: 20,
                    color: 'rgba(255,255,255,0.35)',
                    display: 'flex',
                  }}
                >
                  ·
                </div>
              )}
              {dateStr && (
                <div
                  style={{
                    fontSize: 20,
                    color: 'rgba(255,255,255,0.7)',
                    letterSpacing: '3px',
                    fontFamily: ff,
                    display: 'flex',
                  }}
                >
                  {dateStr}
                </div>
              )}
            </div>
          )}

          {/* Rangée : colonne (logo + nom) — VS — colonne (logo + nom). */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                width: 340,
              }}
            >
              <LogoBox
                url={teamLogoUrl}
                fallback={initials(teamName)}
                tint="rgba(255,255,255,0.25)"
                glowColor="rgba(255,255,255,0.06)"
                rajdhani={hasFont}
              />
              <div
                style={{
                  marginTop: 24,
                  fontSize: namesSize,
                  color: '#eaeaf0',
                  letterSpacing: '3px',
                  fontFamily: ff,
                  whiteSpace: 'nowrap',
                  display: 'flex',
                }}
              >
                {teamLabel}
              </div>
            </div>

            <div
              style={{
                fontSize: 180,
                color: '#FFB800',
                letterSpacing: '6px',
                padding: '0 40px',
                marginBottom: 60,
                display: 'flex',
                fontFamily: ff,
                lineHeight: 1,
                // Glow or : double layer pour profondeur (proche + large halo)
                textShadow:
                  '0 0 30px rgba(255,184,0,0.7), 0 0 70px rgba(255,184,0,0.4)',
              }}
            >
              VS
            </div>

            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                width: 340,
              }}
            >
              <LogoBox
                url={adversaryLogoUrl}
                fallback={initials(adversaire)}
                tint="rgba(255,184,0,0.45)"
                glowColor="rgba(255,184,0,0.08)"
                rajdhani={hasFont}
              />
              <div
                style={{
                  marginTop: 24,
                  fontSize: namesSize,
                  color: '#eaeaf0',
                  letterSpacing: '3px',
                  fontFamily: ff,
                  whiteSpace: 'nowrap',
                  display: 'flex',
                }}
              >
                {advLabel}
              </div>
            </div>
          </div>

          {/* Footer */}
          <div
            style={{
              position: 'absolute',
              bottom: 24,
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
          'Cache-Control': 'public, max-age=3600, s-maxage=86400, immutable',
        },
      },
    );
  } catch {
    return new Response('Error', { status: 500 });
  }
}
