import { ImageResponse } from 'next/og';
import { NextRequest } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';

// Route publique : l'URL est intégrée dans les messages Discord, donc accessible
// par Discord pour générer sa preview. Pas d'info sensible, juste nom équipe/
// adversaire + logos (déjà publics). Cache long pour limiter les appels Firestore —
// une édition d'event régénère l'URL côté appelant via ?v=updatedAt si besoin.
export const runtime = 'nodejs';

const WIDTH = 1200;
const HEIGHT = 630;

function initials(name: string): string {
  return name.trim().slice(0, 3).toUpperCase() || '?';
}

function LogoBox({
  url,
  fallback,
  tint,
}: {
  url: string | null;
  fallback: string;
  tint: string;
}) {
  return (
    <div
      style={{
        width: 280,
        height: 280,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(255,255,255,0.03)',
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
            fontSize: 90,
            fontWeight: 800,
            color: 'rgba(255,255,255,0.85)',
            letterSpacing: '4px',
            display: 'flex',
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
    const teamIds = (ev.target?.teamIds as string[] | undefined) ?? [];
    if (ev.target?.scope === 'teams' && teamIds.length > 0) {
      const teamSnap = await db.collection('sub_teams').doc(teamIds[0]).get();
      const team = teamSnap.data();
      if (team) {
        teamName = (team.name as string | undefined) || structureName;
        teamLogoUrl = (team.logoUrl as string | undefined) || structureLogoUrl;
      }
    }

    const adversaire = (ev.adversaire as string | undefined) || 'Adversaire';
    const adversaryLogoUrl = (ev.adversaireLogoUrl as string | undefined) || null;

    const teamLabel = teamName.toUpperCase().slice(0, 22);
    const advLabel = adversaire.toUpperCase().slice(0, 22);

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
          <div
            style={{
              marginBottom: 32,
              padding: '8px 24px',
              fontSize: 22,
              fontWeight: 700,
              letterSpacing: '8px',
              color: '#FFB800',
              background: 'rgba(255,184,0,0.08)',
              border: '1px solid rgba(255,184,0,0.35)',
              display: 'flex',
            }}
          >
            ⚔ MATCH OFFICIEL
          </div>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <LogoBox
              url={teamLogoUrl}
              fallback={initials(teamName)}
              tint="rgba(255,255,255,0.25)"
            />
            <div
              style={{
                fontSize: 140,
                fontWeight: 900,
                color: '#FFB800',
                letterSpacing: '8px',
                padding: '0 60px',
                display: 'flex',
              }}
            >
              VS
            </div>
            <LogoBox
              url={adversaryLogoUrl}
              fallback={initials(adversaire)}
              tint="rgba(255,184,0,0.45)"
            />
          </div>
          <div
            style={{
              marginTop: 36,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: '100%',
              padding: '0 80px',
            }}
          >
            <div
              style={{
                width: 340,
                display: 'flex',
                justifyContent: 'center',
                fontSize: 44,
                fontWeight: 800,
                color: '#eaeaf0',
                letterSpacing: '2px',
              }}
            >
              {teamLabel}
            </div>
            <div style={{ width: 260, display: 'flex' }} />
            <div
              style={{
                width: 340,
                display: 'flex',
                justifyContent: 'center',
                fontSize: 44,
                fontWeight: 800,
                color: '#eaeaf0',
                letterSpacing: '2px',
              }}
            >
              {advLabel}
            </div>
          </div>
          <div
            style={{
              position: 'absolute',
              bottom: 24,
              fontSize: 18,
              color: 'rgba(255,255,255,0.4)',
              letterSpacing: '4px',
              display: 'flex',
            }}
          >
            SPRINGS HUB
          </div>
        </div>
      ),
      {
        width: WIDTH,
        height: HEIGHT,
        headers: {
          'Cache-Control': 'public, max-age=3600, s-maxage=86400, immutable',
        },
      },
    );
  } catch {
    return new Response('Error', { status: 500 });
  }
}
