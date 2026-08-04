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

/** Le nom rétrécit par palier plutôt qu'au caractère près : trois tailles
 *  suffisent, et elles gardent les badges homogènes entre eux. */
function nameSize(text: string): string {
  if (text.length <= 8) return '12mm';
  if (text.length <= 12) return '9.4mm';
  return '7.2mm';
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
        if (p.ticket !== 'spectator_day' && p.ticket !== 'spectator_2days') continue;
        if (p.state !== 'Processed' && p.state !== 'Registered') continue;
        out.push({
          key: `s-${p.itemId}`,
          category: 'spectator',
          headline: p.participantName || p.payerName || 'Spectateur',
          detail: p.ticket === 'spectator_2days' ? 'Pass deux jours' : 'Une journée',
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

        /* ══ Le badge ══ */
        .mc-badge {
          width: 54mm;
          height: 86mm;
          display: flex;
          flex-direction: column;
          overflow: hidden;
          color: #fff;
          break-inside: avoid;
          /* Le fond de l'affiche : violet éclairé par le haut, halo vert au sol. */
          background:
            radial-gradient(88% 42% at 50% -6%, rgba(150, 72, 228, 0.62) 0%, rgba(150, 72, 228, 0) 64%),
            radial-gradient(96% 38% at 50% 106%, rgba(0, 217, 54, 0.3) 0%, rgba(0, 217, 54, 0) 62%),
            linear-gradient(180deg, #221d3c 0%, #16132a 44%, #0b0a13 100%);
          -webkit-print-color-adjust: exact;
          print-color-adjust: exact;
        }

        /* Damier de course : la signature de l'affiche. */
        .mc-checker {
          height: 3.2mm;
          flex: 0 0 3.2mm;
          background-color: #08070d;
          background-image:
            linear-gradient(45deg, #3b3b52 25%, transparent 25%, transparent 75%, #3b3b52 75%),
            linear-gradient(45deg, #3b3b52 25%, transparent 25%, transparent 75%, #3b3b52 75%);
          background-size: 3.2mm 3.2mm;
          background-position: 0 0, 1.6mm 1.6mm;
        }

        .mc-head { padding: 2.6mm 3.5mm 1.8mm; text-align: center; flex: 0 0 auto; }
        .mc-logo { height: 4.6mm; width: auto; display: block; margin: 0 auto; }
        .mc-lan {
          margin-top: 2mm;
          display: inline-flex;
          align-items: center;
          gap: 1.5mm;
          font-size: 2.15mm;
          letter-spacing: 0.3em;
          font-weight: 700;
        }
        .mc-lan b {
          background: #00d936;
          color: #08070c;
          padding: 0.55mm 1.5mm 0.35mm;
          letter-spacing: 0.16em;
        }
        .mc-lan span { color: #00d936; }
        .mc-event {
          font-family: var(--font-display);
          font-size: 7.4mm;
          line-height: 0.92;
          letter-spacing: 0.035em;
          margin-top: 1mm;
          background: linear-gradient(178deg, #ffffff 20%, #dfe3e9 48%, #8b929f 100%);
          -webkit-background-clip: text;
          background-clip: text;
          color: transparent;
        }
        .mc-when {
          font-size: 2.2mm;
          letter-spacing: 0.16em;
          color: #c0bad4;
          text-transform: uppercase;
          font-weight: 600;
          margin-top: 0.6mm;
        }

        /* Bandeau du nom : hauteur FIXE. C'est lui qui garantit qu'aucune zone
           ne reste morte, et que tous les badges se superposent au découpage. */
        .mc-banner {
          border-top: 0.4mm solid rgba(0, 217, 54, 0.75);
          border-bottom: 0.4mm solid rgba(0, 217, 54, 0.75);
          background-color: rgba(0, 0, 0, 0.34);
          background-image:
            linear-gradient(45deg, rgba(255, 255, 255, 0.05) 25%, transparent 25%, transparent 75%, rgba(255, 255, 255, 0.05) 75%),
            linear-gradient(45deg, rgba(255, 255, 255, 0.05) 25%, transparent 25%, transparent 75%, rgba(255, 255, 255, 0.05) 75%);
          background-size: 4mm 4mm;
          background-position: 0 0, 2mm 2mm;
          padding: 1.6mm 2.5mm;
          display: flex;
          align-items: center;
          justify-content: center;
          height: 18mm;
          flex: 0 0 18mm;
          overflow: hidden;
        }
        .mc-name {
          font-family: var(--font-display);
          line-height: 0.86;
          letter-spacing: 0.012em;
          width: 100%;
          word-break: break-word;
          text-align: center;
          text-shadow: 0 0.4mm 2mm rgba(0, 0, 0, 0.55);
        }

        .mc-info {
          flex: 1;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 2.2mm;
          padding: 1.6mm 3mm;
          min-height: 0;
          overflow: hidden;
        }
        .mc-detail {
          font-size: 3.05mm;
          color: #c3bed4;
          font-weight: 500;
          text-align: center;
        }
        .mc-seat {
          border: 0.3mm solid rgba(0, 217, 54, 0.65);
          background: rgba(0, 217, 54, 0.12);
          padding: 1.1mm 3.6mm;
          display: inline-flex;
          align-items: baseline;
          gap: 1.8mm;
        }
        .mc-seat .k {
          font-size: 2.1mm;
          letter-spacing: 0.2em;
          color: #8fe3a5;
          text-transform: uppercase;
          font-weight: 700;
        }
        .mc-seat .v {
          font-family: var(--font-display);
          font-size: 5.8mm;
          line-height: 1;
          color: #00d936;
        }

        /* Pied : la même ligne sur tous les badges. */
        .mc-meta {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 0 3.5mm 1.8mm;
          font-size: 2.15mm;
          color: #9c97b4;
          letter-spacing: 0.05em;
        }
        .mc-meta .right { display: inline-flex; align-items: center; gap: 2mm; }
        .mc-code {
          font-family: var(--font-display);
          font-size: 3.1mm;
          letter-spacing: 0.12em;
          color: #aaa5c0;
        }
        .mc-noimg { display: inline-flex; align-items: center; color: #e5737f; }
        .mc-noimg svg { width: 2.8mm; height: 2.8mm; }

        .mc-cat {
          font-family: var(--font-display);
          font-size: 5.2mm;
          letter-spacing: 0.3em;
          text-align: center;
          padding: 1.7mm 0 1.2mm 0.3em;
          color: #08070c;
        }

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
      <div className="mc-checker" />

      <div className="mc-head">
        {/* Le logo de l'organisateur, pas celui d'Aedral : c'est SPRINGS
            E-SPORT qui accueille ces gens.
            next/image est écarté ici volontairement : il charge en différé et
            enveloppe l'image dans un conteneur dimensionné en pixels. Sur une
            page faite pour l'imprimante, cela donne des badges sans logo et une
            mise en page en millimètres cassée. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="mc-logo" src="/springs-esport.png" alt="" />
        <div className="mc-lan">
          <b>LAN</b>
          <span>TRACKMANIA</span>
        </div>
        <div className="mc-event">MANIA CUP</div>
        <div className="mc-when">3–4 octobre 2026 · Marzy</div>
      </div>

      <div className="mc-banner">
        <div className="mc-name" style={{ fontSize: nameSize(badge.headline) }}>
          {badge.headline}
        </div>
      </div>

      <div className="mc-info">
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

      <div className="mc-cat" style={{ background: cat.color }}>
        {cat.label}
      </div>
      <div className="mc-checker" />
    </div>
  );
}
