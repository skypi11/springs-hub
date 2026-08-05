'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Loader2, Printer, ArrowLeft } from 'lucide-react';
import { api } from '@/lib/api-client';

// Planche de badges à imprimer.
//
// Un badge par personne qui entre : joueurs, accompagnants, spectateurs, staff.
// Les deux premières catégories viennent des inscriptions Aedral ; les
// spectateurs n'ont pas de compte chez nous et n'existent que dans la
// billetterie, d'où la lecture du journal des encaissements ; le staff se saisit
// à la main, il n'a de trace nulle part.
//
// Pas de génération de PDF : l'impression du navigateur suffit et évite une
// dépendance de plus. Tout est calé en millimètres pour entrer dans un
// porte-badge standard, et les hauteurs internes sont FIXES — c'est ce qui fait
// que les badges se superposent exactement quand on les découpe en pile.
//
// La direction artistique vient de l'affiche de l'événement : damier de course,
// violet profond, chrome et vert Trackmania.
//
// À quoi sert un badge, concrètement, le samedi matin :
//   — dire d'un coup d'œil qui a le droit d'être en zone joueurs ;
//   — donner sa place au joueur sans lui faire refaire le tour des tables ;
//   — signaler à l'équipe vidéo ceux qui ont refusé d'être filmés.

type Row = {
  uid: string;
  tmDisplayName: string;
  firstName: string;
  lastName: string;
  status: string;
  seat: string | null;
  imageConsent: boolean | null;
  registrationCode: string;
  companion: { name: string; role: string; ticketPaid?: boolean } | null;
};

type Payment = {
  itemId: number;
  ticket: string | null;
  participantName: string;
  payerName: string;
  state: string;
};

type Category = 'player' | 'companion' | 'spectator' | 'staff';

interface Badge {
  key: string;
  category: Category;
  /** Ce qu'on lit à trois mètres. */
  headline: string;
  /** Ce qui identifie la personne au-delà de son nom. */
  detail: string;
  seat?: string | null;
  code?: string | null;
  noImage?: boolean;
}

const CATEGORY: Record<Category, { label: string; color: string }> = {
  // Vert Trackmania pour ceux qui jouent, or pour ceux qui accèdent à la zone
  // joueurs sans y jouer, gris pour le public, violet pour l'organisation.
  player: { label: 'JOUEUR', color: '#00D936' },
  companion: { label: 'ACCOMPAGNANT', color: '#FFB800' },
  spectator: { label: 'SPECTATEUR', color: '#c6c6d2' },
  staff: { label: 'STAFF', color: '#A66BE8' },
};

/**
 * Taille du nom, dictée par le MOT LE PLUS LONG et non par la longueur totale.
 *
 * Un nom se coupe entre les mots : « Julien Marchand » et « Martine Dupont »
 * ont presque la même longueur, mais choisir la taille sur le total en mettait
 * un sur deux lignes et l'autre sur une seule. Sur une planche, cette
 * irrégularité saute aux yeux et fait bricolé.
 */
function nameSize(text: string): string {
  const words = text.split(/\s+/).filter(Boolean);
  const longest = words.reduce((m, w) => Math.max(m, w.length), 0);
  if (text.length <= 8 && longest <= 8) return '12mm';
  if (longest <= 10) return '9.5mm';
  if (longest <= 13) return '7.4mm';
  return '6mm';
}

export default function BadgesPage() {
  const [showSpectators, setShowSpectators] = useState(true);
  const [staffNames, setStaffNames] = useState('');

  const registrations = useQuery({
    queryKey: ['admin', 'mania-cup'] as const,
    queryFn: () => api<{ registrations: Row[] }>('/api/admin/mania-cup'),
  });

  const payments = useQuery({
    queryKey: ['admin', 'mania-cup', 'helloasso'] as const,
    queryFn: () => api<{ payments?: Payment[] }>('/api/admin/mania-cup/helloasso'),
    retry: false,
  });

  const badges = useMemo<Badge[]>(() => {
    const rows = registrations.data?.registrations ?? [];
    const out: Badge[] = [];

    for (const r of rows) {
      // Un badge se remet contre un règlement : une inscription non réglée ou
      // retirée n'en a pas.
      if (r.status !== 'confirmed') continue;

      const civil = `${r.firstName} ${r.lastName}`.trim();
      out.push({
        key: `p-${r.uid}`,
        category: 'player',
        headline: r.tmDisplayName || civil,
        detail: civil,
        seat: r.seat,
        code: r.registrationCode,
        noImage: r.imageConsent === false,
      });

      if (r.companion?.ticketPaid) {
        out.push({
          key: `c-${r.uid}`,
          category: 'companion',
          headline: r.companion.name,
          detail: [
            `Accompagne ${r.tmDisplayName || civil}`,
            r.companion.role,
          ].filter(Boolean).join(' · '),
          code: r.registrationCode,
        });
      }
    }

    if (showSpectators) {
      for (const p of payments.data?.payments ?? []) {
        if (p.ticket !== 'spectator') continue;
        if (p.state !== 'Processed' && p.state !== 'Registered') continue;
        out.push({
          key: `s-${p.itemId}`,
          category: 'spectator',
          headline: p.participantName || p.payerName || 'Spectateur',
          detail: 'Pass deux jours',
        });
      }
    }

    for (const [i, line] of staffNames.split('\n').entries()) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      // « Nom · Fonction » sur une ligne, la fonction est facultative.
      const [name, role] = trimmed.split(/\s*[·|]\s*/);
      out.push({
        key: `st-${i}`,
        category: 'staff',
        headline: name,
        detail: role || 'Organisation',
      });
    }

    return out;
  }, [registrations.data, payments.data, showSpectators, staffNames]);

  if (registrations.isLoading) {
    return (
      <div className="flex items-center gap-3 p-8" style={{ color: 'var(--s-text-dim)' }}>
        <Loader2 className="animate-spin" size={20} /> Chargement…
      </div>
    );
  }

  return (
    <div className="px-4 py-6 sm:px-6 lg:px-8">
      {/* Tout ce bloc disparaît à l'impression : seule la planche sort. */}
      <div className="no-print">
        <Link
          href="/admin/mania-cup"
          className="inline-flex items-center gap-2 text-sm"
          style={{ color: 'var(--s-text-dim)' }}
        >
          <ArrowLeft size={15} aria-hidden />
          Retour à la console
        </Link>

        <h1 className="font-display mt-4 text-4xl">Badges</h1>
        <p className="mt-2" style={{ color: 'var(--s-text-dim)' }}>
          {badges.length} badge{badges.length > 1 ? 's' : ''} · 9 par page A4 ·
          format 54 × 86 mm
        </p>

        <div className="mt-6 flex flex-wrap items-center gap-4">
          <button
            onClick={() => window.print()}
            className="btn-springs btn-primary bevel-sm inline-flex items-center gap-2"
          >
            <Printer size={16} aria-hidden />
            Imprimer
          </button>

          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={showSpectators}
              onChange={(e) => setShowSpectators(e.target.checked)}
            />
            Inclure les spectateurs
          </label>

          {payments.isError && (
            <span className="text-sm" style={{ color: 'var(--s-gold)' }}>
              Billetterie illisible — les badges spectateurs manquent à l’appel.
            </span>
          )}
        </div>

        <div className="mt-6 max-w-md">
          <label htmlFor="staff" className="block text-sm font-semibold">
            Badges staff
          </label>
          <textarea
            id="staff"
            rows={4}
            value={staffNames}
            onChange={(e) => setStaffNames(e.target.value)}
            placeholder={'Matt Molines · Direction\nTeitei · Arbitrage\nRiskone'}
            className="settings-input mt-2 w-full"
          />
          <p className="mt-1.5 text-xs" style={{ color: 'var(--s-text-muted)' }}>
            Un nom par ligne. Ajoute « · » suivi de la fonction pour la faire
            figurer sur le badge. Ton équipe n’est enregistrée nulle part, c’est
            donc ici qu’elle se saisit.
          </p>
        </div>

        <p className="mt-6 max-w-2xl text-sm" style={{ color: 'var(--s-text-muted)' }}>
          Un badge n’est édité que pour un billet réglé. Attribue les places depuis
          la console avant d’imprimer : elles figurent sur les badges joueurs.
          Pense à cocher « graphiques d’arrière-plan » dans la fenêtre
          d’impression, sinon les fonds sombres ne sortiront pas.
        </p>

        {badges.length === 0 && (
          <p className="mt-8" style={{ color: 'var(--s-text-dim)' }}>
            Aucun billet réglé pour le moment.
          </p>
        )}
      </div>

      <div className="badge-sheet mt-10">
        {badges.map((b) => (
          <BadgeCard key={b.key} badge={b} />
        ))}
      </div>

      <style jsx global>{`
        .badge-sheet {
          display: grid;
          grid-template-columns: repeat(3, 54mm);
          gap: 5mm;
        }

        /* ══════════════════════════ LE BADGE ══════════════════════════
           Structure volontairement INDÉFORMABLE :
             — la catégorie occupe toute la hauteur à gauche : aucune police,
               aucun zoom, aucun navigateur ne peut la rogner ;
             — dans la colonne de droite, les damiers et le pied ne se
               compriment jamais (flex: 0 0 auto) ;
             — seule la zone d'identité absorbe les écarts (flex: 1, min-height: 0).
           Une première version calait chaque bloc au millimètre : elle tombait
           juste sur ma machine et débordait ailleurs, dès que la police mettait
           un instant à se charger. */
        .mc-badge {
          width: 54mm;
          height: 86mm;
          display: flex;
          overflow: hidden;
          color: #fff;
          break-inside: avoid;
          -webkit-print-color-adjust: exact;
          print-color-adjust: exact;
        }

        .mc-spine {
          flex: 0 0 9.5mm;
          display: flex;
          align-items: center;
          justify-content: center;
          color: #08070c;
        }
        .mc-spine span {
          writing-mode: vertical-rl;
          transform: rotate(180deg);
          font-family: var(--font-display);
          font-size: 5.2mm;
          letter-spacing: 0.26em;
          line-height: 1;
          white-space: nowrap;
        }

        .mc-main {
          flex: 1;
          min-width: 0;
          position: relative;
          display: flex;
          flex-direction: column;
          overflow: hidden;
          background: #0f0d1c;
        }
        /* Un aplat dégradé faisait badge d'entreprise. Le circuit rend la carte
           vivante — cadré sur la piste et non sur le ciel, désaturé et sombre,
           il porte l'ambiance sans jamais disputer la lisibilité au nom. */
        .mc-main::before {
          content: '';
          position: absolute;
          inset: 0;
          background: url('/og-backgrounds/trackmania.webp') center 52% / 168% no-repeat;
          filter: saturate(0.5) contrast(1.12) brightness(0.8);
          opacity: 0.58;
        }
        /* Les couleurs de l'affiche par-dessus : violet en haut, vert au sol. */
        .mc-main::after {
          content: '';
          position: absolute;
          inset: 0;
          background:
            radial-gradient(100% 38% at 50% -4%, rgba(150, 72, 228, 0.72) 0%, rgba(150, 72, 228, 0) 64%),
            radial-gradient(120% 32% at 50% 104%, rgba(0, 217, 54, 0.34) 0%, rgba(0, 217, 54, 0) 60%),
            linear-gradient(180deg, rgba(24, 20, 48, 0.88) 0%, rgba(16, 13, 34, 0.58) 42%, rgba(9, 8, 17, 0.9) 100%);
        }
        .mc-main > * { position: relative; z-index: 1; }

        /* La pointe du blason de l'affiche : trois millimètres qui font le lien. */
        .mc-point {
          flex: 0 0 auto;
          height: 2.6mm;
          background: rgba(0, 217, 54, 0.7);
          clip-path: polygon(38% 0, 62% 0, 50% 100%);
        }

        /* Le damier de l'affiche, réduit aux deux bordures : la signature sans
           l'envahissement. */
        .mc-checker {
          flex: 0 0 2.6mm;
          height: 2.6mm;
          background-color: #08070d;
          background-image:
            linear-gradient(45deg, #3b3b52 25%, transparent 25%, transparent 75%, #3b3b52 75%),
            linear-gradient(45deg, #3b3b52 25%, transparent 25%, transparent 75%, #3b3b52 75%);
          background-size: 2.6mm 2.6mm;
          background-position: 0 0, 1.3mm 1.3mm;
        }

        .mc-head {
          flex: 0 0 auto;
          padding: 2.4mm 3mm 2.2mm;
          text-align: center;
          border-bottom: 0.35mm solid rgba(0, 217, 54, 0.7);
          /* Fond propre : sans lui, le ciel clair du circuit remonte derrière
             la date et barre le titre d'une bande grise. */
          background: linear-gradient(180deg, rgba(31, 25, 60, 0.94) 0%, rgba(23, 19, 46, 0.88) 100%);
        }
        .mc-logo { height: 4mm; width: auto; display: block; margin: 0 auto; }
        .mc-lan {
          margin-top: 1.5mm;
          display: inline-flex;
          align-items: center;
          gap: 1.3mm;
          font-size: 2mm;
          letter-spacing: 0.26em;
          font-weight: 700;
        }
        .mc-lan b {
          background: #00d936;
          color: #08070c;
          padding: 0.5mm 1.3mm 0.3mm;
          letter-spacing: 0.14em;
        }
        .mc-lan span { color: #00d936; }
        /* Le nom de la compétition est SPRINGS MANIA CUP. Il se compose sur
           deux niveaux, comme dans le blason de l'affiche. */
        .mc-springs {
          font-family: var(--font-display);
          font-size: 3.4mm;
          line-height: 1;
          letter-spacing: 0.42em;
          text-indent: 0.42em;
          margin-top: 1.4mm;
          color: #d6d1e6;
        }
        .mc-event {
          font-family: var(--font-display);
          font-size: 7mm;
          line-height: 0.94;
          letter-spacing: 0.03em;
          margin-top: 0.2mm;
          background: linear-gradient(178deg, #ffffff 20%, #dfe3e9 48%, #8b929f 100%);
          -webkit-background-clip: text;
          background-clip: text;
          color: transparent;
        }
        .mc-when {
          font-size: 2.05mm;
          letter-spacing: 0.14em;
          color: #bdb7d2;
          text-transform: uppercase;
          font-weight: 600;
          margin-top: 0.5mm;
        }

        /* La seule zone élastique. Sans cadre : une boîte à moitié remplie se
           lit comme un trou, le même espace sans bordure devient une marge. */
        .mc-who {
          flex: 1 1 auto;
          min-height: 0;
          overflow: hidden;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 1.8mm;
          padding: 2mm 2.5mm 3mm;
        }
        .mc-name {
          font-family: var(--font-display);
          line-height: 0.88;
          letter-spacing: 0.012em;
          width: 100%;
          text-align: center;
          word-break: break-word;
          text-shadow: 0 0.4mm 2mm rgba(0, 0, 0, 0.55);
        }
        .mc-detail {
          font-size: 2.9mm;
          color: #c3bed4;
          font-weight: 500;
          text-align: center;
        }
        .mc-seat {
          border: 0.3mm solid rgba(0, 217, 54, 0.65);
          background: rgba(0, 217, 54, 0.12);
          padding: 0.9mm 3mm;
          display: inline-flex;
          align-items: baseline;
          gap: 1.6mm;
        }
        .mc-seat .k {
          font-size: 2mm;
          letter-spacing: 0.18em;
          color: #8fe3a5;
          text-transform: uppercase;
          font-weight: 700;
        }
        .mc-seat .v {
          font-family: var(--font-display);
          font-size: 5.4mm;
          line-height: 1;
          color: #00d936;
        }

        .mc-meta {
          flex: 0 0 auto;
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 1.6mm 3mm;
          font-size: 2mm;
          color: #9c97b4;
          letter-spacing: 0.04em;
        }
        .mc-meta .right { display: inline-flex; align-items: center; gap: 1.6mm; }
        .mc-code {
          font-family: var(--font-display);
          font-size: 2.9mm;
          letter-spacing: 0.1em;
          color: #aaa5c0;
        }
        .mc-noimg { display: inline-flex; align-items: center; color: #e5737f; }
        .mc-noimg svg { width: 2.6mm; height: 2.6mm; }

        @media print {
          /* L'écran d'administration entier disparaît : navigation, en-têtes,
             boutons. Ne sort que la planche. */
          .no-print,
          nav,
          aside,
          header {
            display: none !important;
          }
          body { background: #fff; }
          .badge-sheet { gap: 0; margin: 0; }
          @page {
            size: A4 portrait;
            margin: 6mm;
          }
        }
      `}</style>
    </div>
  );
}

function BadgeCard({ badge }: { badge: Badge }) {
  const cat = CATEGORY[badge.category];

  return (
    <div className="mc-badge">
      {/* La catégorie occupe toute la hauteur : c'est ce qu'on lit à cinq
          mètres, et rien ne peut la rogner. */}
      <div className="mc-spine" style={{ background: cat.color }}>
        <span>{cat.label}</span>
      </div>

      <div className="mc-main">
        <div className="mc-checker" />

        <div className="mc-head">
          {/* Le logo de l'organisateur, pas celui d'Aedral : c'est SPRINGS
              E-SPORT qui accueille ces gens.
              next/image est écarté ici volontairement : il charge en différé et
              enveloppe l'image dans un conteneur dimensionné en pixels. Sur une
              page faite pour l'imprimante, cela donne des badges sans logo et
              une mise en page en millimètres cassée. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="mc-logo" src="/springs-esport.png" alt="" />
          <div className="mc-lan">
            <b>LAN</b>
            <span>TRACKMANIA</span>
          </div>
          <div className="mc-springs">SPRINGS</div>
          <div className="mc-event">MANIA CUP</div>
          <div className="mc-when">3–4 octobre 2026 · Marzy</div>
        </div>

        <div className="mc-point" />

        <div className="mc-who">
          <div className="mc-name" style={{ fontSize: nameSize(badge.headline) }}>
            {badge.headline}
          </div>
          {badge.detail && <div className="mc-detail">{badge.detail}</div>}
          {badge.seat && (
            <div className="mc-seat">
              <span className="k">Place</span>
              <span className="v">{badge.seat}</span>
            </div>
          )}
        </div>

        <div className="mc-meta">
          <span>aedral.com/mania-cup</span>
          <span className="right">
            {badge.noImage && (
              <span className="mc-noimg" title="N’accepte pas d’être filmé">
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.4"
                  strokeLinecap="round"
                  aria-hidden
                >
                  <path d="M2 2l20 20" />
                  <path d="M9 5h6l2 3h3v9" />
                  <path d="M4 8v11h13" />
                </svg>
              </span>
            )}
            {badge.code && <span className="mc-code">{badge.code}</span>}
          </span>
        </div>

        <div className="mc-checker" />
      </div>
    </div>
  );
}
