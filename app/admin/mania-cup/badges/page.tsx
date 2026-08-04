'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Loader2, Printer, ArrowLeft, CameraOff } from 'lucide-react';
import { api } from '@/lib/api-client';
import { MANIA_CUP } from '@/lib/mania-cup';

// Planche de badges à imprimer.
//
// Un badge par personne qui entre : joueurs, accompagnants, spectateurs. Les
// deux premières catégories viennent des inscriptions Aedral ; les spectateurs
// n'ont pas de compte chez nous et n'existent que dans la billetterie, d'où la
// lecture du journal des encaissements.
//
// Pas de génération de PDF : l'impression du navigateur suffit et évite une
// dépendance de plus. La mise en page est calée en millimètres pour que ce qui
// sort de l'imprimante entre dans un porte-badge standard.
//
// À quoi sert un badge, concrètement, le samedi matin :
//   — dire d'un coup d'œil qui a le droit d'être en zone joueurs ;
//   — donner son emplacement au joueur sans refaire le tour des tables ;
//   — signaler à l'équipe vidéo les personnes qui ont refusé leur image.

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
  outcome: string;
  state: string;
};

type Category = 'player' | 'companion' | 'spectator';

interface Badge {
  key: string;
  category: Category;
  /** Ce qu'on lit à trois mètres. */
  headline: string;
  /** Ce qu'on lit à trente centimètres. */
  subline: string;
  seat?: string | null;
  noImage?: boolean;
}

const CATEGORY_STYLE: Record<Category, { label: string; color: string; ink: string }> = {
  // Vert Trackmania pour les joueurs, or pour ceux qui accèdent à la zone
  // joueurs sans y jouer, gris pour le public. Trois teintes qui se
  // distinguent d'un bout à l'autre d'une salle.
  player: { label: 'JOUEUR', color: '#00D936', ink: '#07050b' },
  companion: { label: 'ACCOMPAGNANT', color: '#FFB800', ink: '#07050b' },
  spectator: { label: 'SPECTATEUR', color: '#8d89a8', ink: '#07050b' },
};

export default function BadgesPage() {
  const [showSpectators, setShowSpectators] = useState(true);

  const registrations = useQuery({
    queryKey: ['admin', 'mania-cup'] as const,
    queryFn: () => api<{ registrations: Row[] }>('/api/admin/mania-cup'),
  });

  const payments = useQuery({
    queryKey: ['admin', 'mania-cup', 'helloasso'] as const,
    queryFn: () => api<{ payments?: Payment[] }>('/api/admin/mania-cup/helloasso'),
  });

  const badges = useMemo<Badge[]>(() => {
    const rows = registrations.data?.registrations ?? [];
    const out: Badge[] = [];

    for (const r of rows) {
      // Un badge se remet contre un règlement : une inscription non réglée ou
      // retirée n'en a pas.
      if (r.status !== 'confirmed') continue;

      out.push({
        key: `p-${r.uid}`,
        category: 'player',
        headline: r.tmDisplayName || `${r.firstName} ${r.lastName}`.trim(),
        subline: `${r.firstName} ${r.lastName}`.trim(),
        seat: r.seat,
        noImage: r.imageConsent === false,
      });

      if (r.companion?.ticketPaid) {
        out.push({
          key: `c-${r.uid}`,
          category: 'companion',
          headline: r.companion.name,
          subline: `${r.companion.role || 'Accompagnant'} · ${r.tmDisplayName}`,
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
          subline: p.ticket === 'spectator_2days' ? 'Pass 2 jours' : 'Samedi ou dimanche',
        });
      }
    }

    return out.sort((a, b) => a.headline.localeCompare(b.headline, 'fr'));
  }, [registrations.data, payments.data, showSpectators]);

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

        <p className="mt-4 max-w-2xl text-sm" style={{ color: 'var(--s-text-muted)' }}>
          Un badge n’est édité que pour un billet réglé. Attribue les emplacements
          depuis la console avant d’imprimer : ils figurent sur les badges joueurs et
          évitent de refaire le tour des tables le samedi matin.
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
          gap: 4mm;
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
          body {
            background: #fff;
          }
          .badge-sheet {
            gap: 0;
            margin: 0;
          }
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
  const style = CATEGORY_STYLE[badge.category];

  return (
    <div
      className="badge-card"
      style={{
        width: '54mm',
        height: '86mm',
        // Bordure grise plutôt que noire : elle sert de repère de découpe sans
        // dévorer l'encre ni salir le rendu.
        border: '0.2mm solid #c9c9c9',
        background: '#fff',
        color: '#07050b',
        display: 'flex',
        flexDirection: 'column',
        breakInside: 'avoid',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          background: style.color,
          color: style.ink,
          padding: '2.5mm 3mm',
          fontWeight: 800,
          fontSize: '3.6mm',
          letterSpacing: '0.08em',
          textAlign: 'center',
        }}
      >
        {style.label}
      </div>

      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          alignItems: 'center',
          padding: '3mm',
          textAlign: 'center',
        }}
      >
        <div
          style={{
            fontSize: badge.headline.length > 14 ? '5mm' : '6.5mm',
            fontWeight: 800,
            lineHeight: 1.1,
            wordBreak: 'break-word',
          }}
        >
          {badge.headline}
        </div>
        {badge.subline && (
          <div style={{ marginTop: '2mm', fontSize: '3.2mm', color: '#555' }}>
            {badge.subline}
          </div>
        )}

        {badge.seat && (
          <div
            style={{
              marginTop: '4mm',
              padding: '1.5mm 3mm',
              border: '0.3mm solid #07050b',
              fontSize: '4.5mm',
              fontWeight: 800,
            }}
          >
            {badge.seat}
          </div>
        )}

        {badge.noImage && (
          <div
            style={{
              marginTop: '3mm',
              display: 'flex',
              alignItems: 'center',
              gap: '1.5mm',
              fontSize: '3mm',
              fontWeight: 700,
              color: '#b00020',
            }}
          >
            <CameraOff size={12} aria-hidden />
            NE PAS FILMER
          </div>
        )}
      </div>

      <div
        style={{
          borderTop: '0.2mm solid #e3e3e3',
          padding: '2mm 3mm',
          fontSize: '2.6mm',
          color: '#777',
          textAlign: 'center',
        }}
      >
        {MANIA_CUP.name} · 3 &amp; 4 octobre 2026 · {MANIA_CUP.city}
      </div>
    </div>
  );
}
