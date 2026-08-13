'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Loader2, Printer, ArrowLeft } from 'lucide-react';
import { api } from '@/lib/api-client';
import { isItemValid } from '@/lib/helloasso/reconcile';
import { companionBadgeName } from '@/lib/mania-cup';

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
  appartenance: {
    structure: string;
    tag: string | null;
    team: string | null;
    logoUrl: string | null;
  } | null;
  companions: {
    name: string;
    /** Ce qui s'imprime, si le joueur l'a renseigné. */
    displayName?: string | null;
    role: string;
    ticketItemId?: number | null;
  }[];
};

type Payment = {
  itemId: number;
  ticket: string | null;
  participantName: string;
  payerName: string;
  state: string;
  /** Motif en clair quand l'argent est reparti — un billet remboursé n'entre pas. */
  moneyBack?: string | null;
};

type Category = 'player' | 'companion' | 'spectator' | 'staff';

interface Badge {
  key: string;
  category: Category;
  /** Ce qu'on lit à trois mètres. */
  headline: string;
  /** Ce qui identifie la personne au-delà de son nom. */
  detail: string;
  /** L'écurie du joueur. Absente pour qui vient seul. */
  team?: string | null;
  /** Son logo, si la structure en a téléversé un. */
  teamLogo?: string | null;
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

/** Bornes de la taille du nom, en millimètres. */
const NOM_MAX_MM = 19.5;
const NOM_MIN_MM = 6.5;

/**
 * Le nom, ajusté pour tenir sur UNE SEULE LIGNE.
 *
 * La taille était auparavant DEVINÉE au nombre de caractères. Or les lettres
 * n'ont pas la même largeur : « G0LI0 » et « YannexTM » font tous deux huit
 * signes, mais le second porte un T et un M, les deux plus larges de l'alphabet.
 * Résultat imprimé : le « M » de YannexTM passait seul à la ligne suivante.
 *
 * On ne devine donc plus, on MESURE : le texte est posé sans césure possible
 * (`nowrap`), puis la taille est réduite par dichotomie jusqu'à ce qu'il tienne
 * dans la largeur du badge. Une dizaine d'essais suffit, et le résultat est
 * juste quelle que soit la police réellement chargée — c'est précisément ce
 * qu'une formule ne peut pas garantir.
 *
 * `document.fonts.ready` n'est pas un luxe : mesuré avant que Bebas soit
 * disponible, tout serait calculé sur la police de repli, plus étroite, et les
 * noms déborderaient à l'impression.
 */
function NomAjuste({ texte }: { texte: string }) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let annule = false;

    const ajuster = () => {
      if (annule) return;
      // On compare la largeur du TEXTE à celle de sa propre boîte, et non à
      // celle du parent : le parent compte son padding dans `clientWidth`, ce
      // qui laissait croire à huit millimètres de place en trop — assez pour
      // que « YannexTM » sorte du cadre et se fasse rogner par l'overflow.
      if (el.clientWidth <= 0) return;

      let bas = NOM_MIN_MM;
      let haut = NOM_MAX_MM;
      let retenu = NOM_MIN_MM;
      // Dichotomie : douze passes amènent à moins d'un centième de millimètre.
      for (let i = 0; i < 12; i++) {
        const essai = (bas + haut) / 2;
        el.style.fontSize = `${essai}mm`;
        if (el.scrollWidth <= el.clientWidth) {
          retenu = essai;
          bas = essai;
        } else {
          haut = essai;
        }
      }
      el.style.fontSize = `${retenu}mm`;
    };

    // Les polices d'abord, sinon la mesure porte sur la police de repli.
    if (typeof document !== 'undefined' && document.fonts?.ready) {
      void document.fonts.ready.then(ajuster);
    } else {
      ajuster();
    }
    return () => {
      annule = true;
    };
  }, [texte]);

  return (
    <div ref={ref} className="mc-name" style={{ fontSize: `${NOM_MAX_MM}mm` }}>
      {texte}
    </div>
  );
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
        // PAS d'identité civile ici. Un badge se porte toute la journée, passe
        // sur les photos et sur le stream : y imprimer le nom d'état civil
        // l'expose à des inconnus sans que cela serve à personne. Le contrôle
        // d'identité se fait une seule fois, à l'accueil, sur la liste
        // d'émargement — qui garde le nom complet. Et si un badge se perd, le
        // code d'inscription imprimé dessus suffit à retrouver son porteur.
        detail: '',
        // L'écurie seule : « Nyxar Esport · Nyxar Main » répétait le mot Nyxar,
        // et l'équipe ne dit rien à personne un jour de LAN en solo. Elle reste
        // dans la console et sur l'émargement, là où elle sert au placement.
        team: r.appartenance?.structure || null,
        teamLogo: r.appartenance?.logoUrl ?? null,
        seat: r.seat,
        code: r.registrationCode,
        noImage: r.imageConsent === false,
      });

      // Un badge par accompagnant dont le billet est réglé : chacun se présente
      // à l'entrée avec le sien. Le nom du BILLET reste ce qu'on contrôle ; ce
      // qui s'imprime, c'est le pseudo choisi par le joueur, ou à défaut le
      // prénom suivi de l'initiale.
      for (const [i, c] of (r.companions ?? []).entries()) {
        if (c.ticketItemId == null) continue;
        out.push({
          key: `c-${r.uid}-${i}`,
          category: 'companion',
          headline: companionBadgeName(c),
          detail: [`Accompagne ${r.tmDisplayName || civil}`, c.role]
            .filter(Boolean)
            .join(' · '),
          // L'accompagnant porte l'écurie du joueur qu'il accompagne : c'est
          // avec lui qu'il arrive et qu'il repart.
          team: r.appartenance?.structure || null,
          teamLogo: r.appartenance?.logoUrl ?? null,
          code: r.registrationCode,
        });
      }
    }

    if (showSpectators) {
      for (const p of payments.data?.payments ?? []) {
        if (p.ticket !== 'spectator') continue;
        // Même définition de « valide » que la caisse : recopier la liste ici
        // garantissait qu'un jour les deux divergent. Et un billet dont l'argent
        // est reparti ne donne pas de badge, même si sa ligne est restée valide.
        if (!isItemValid(p.state) || p.moneyBack) continue;
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
          {badges.length} badge{badges.length > 1 ? 's' : ''} · 4 par page A4 ·
          format 100 × 140 mm
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
          grid-template-columns: repeat(2, 100mm);
          gap: 8.14mm;
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
          width: 100mm;
          height: 140mm;
          display: flex;
          overflow: hidden;
          color: #fff;
          break-inside: avoid;
          -webkit-print-color-adjust: exact;
          print-color-adjust: exact;
        }

        .mc-spine {
          flex: 0 0 15.47mm;
          display: flex;
          align-items: center;
          justify-content: center;
          color: #08070c;
        }
        .mc-spine span {
          writing-mode: vertical-rl;
          transform: rotate(180deg);
          font-family: var(--font-display);
          font-size: 8.47mm;
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
          height: 4.23mm;
          background: rgba(0, 217, 54, 0.7);
          clip-path: polygon(38% 0, 62% 0, 50% 100%);
        }

        /* Le damier de l'affiche, réduit aux deux bordures : la signature sans
           l'envahissement. */
        .mc-checker {
          flex: 0 0 4.23mm;
          height: 4.23mm;
          background-color: #08070d;
          background-image:
            linear-gradient(45deg, #3b3b52 25%, transparent 25%, transparent 75%, #3b3b52 75%),
            linear-gradient(45deg, #3b3b52 25%, transparent 25%, transparent 75%, #3b3b52 75%);
          background-size: 4.23mm 4.23mm;
          background-position: 0 0, 2.12mm 2.12mm;
        }

        .mc-head {
          flex: 0 0 auto;
          padding: 3.91mm 4.88mm 3.58mm;
          text-align: center;
          border-bottom: 0.57mm solid rgba(0, 217, 54, 0.7);
          /* Fond propre : sans lui, le ciel clair du circuit remonte derrière
             la date et barre le titre d'une bande grise. */
          background: linear-gradient(180deg, rgba(31, 25, 60, 0.94) 0%, rgba(23, 19, 46, 0.88) 100%);
        }
        .mc-logo { height: 6.51mm; width: auto; display: block; margin: 0 auto; }
        .mc-lan {
          margin-top: 2.44mm;
          display: inline-flex;
          align-items: center;
          gap: 2.12mm;
          font-size: 3.26mm;
          letter-spacing: 0.26em;
          font-weight: 700;
        }
        .mc-lan b {
          background: #00d936;
          color: #08070c;
          padding: 0.81mm 2.12mm 0.49mm;
          letter-spacing: 0.14em;
        }
        .mc-lan span { color: #00d936; }
        /* Le nom de la compétition est SPRINGS MANIA CUP. Il se compose sur
           deux niveaux, comme dans le blason de l'affiche. */
        .mc-springs {
          font-family: var(--font-display);
          font-size: 5.53mm;
          line-height: 1;
          letter-spacing: 0.42em;
          text-indent: 0.42em;
          margin-top: 2.28mm;
          color: #d6d1e6;
        }
        .mc-event {
          font-family: var(--font-display);
          font-size: 11.4mm;
          line-height: 0.94;
          letter-spacing: 0.03em;
          margin-top: 0.33mm;
          background: linear-gradient(178deg, #ffffff 20%, #dfe3e9 48%, #8b929f 100%);
          -webkit-background-clip: text;
          background-clip: text;
          color: transparent;
        }
        .mc-when {
          font-size: 3.34mm;
          letter-spacing: 0.14em;
          color: #bdb7d2;
          text-transform: uppercase;
          font-weight: 600;
          margin-top: 0.81mm;
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
          gap: 2.93mm;
          /* Réserve en bas pour l'écurie, qui est en position absolue : sans
             elle, un nom long viendrait se poser dessus. */
          padding: 3.26mm 4.07mm 14mm;
          position: relative;
        }
        .mc-name {
          font-family: var(--font-display);
          line-height: 0.88;
          letter-spacing: 0.012em;
          width: 100%;
          text-align: center;
          /* UNE seule ligne, sans exception : un pseudo coupé en deux (« YannexT »
             puis « M » tout seul) est un badge raté, et il s'imprime tel quel.
             La taille est mesurée par NomAjuste jusqu'à ce que le nom tienne. */
          white-space: nowrap;
          text-shadow: 0 0.65mm 3.26mm rgba(0, 0, 0, 0.55);
        }
        .mc-detail {
          font-size: 4.72mm;
          color: #c3bed4;
          font-weight: 500;
          text-align: center;
        }
        /* L'écurie est posée AU PIED de la zone, le nom restant centré au-dessus.
           La réserve en bas de la zone garantit qu'un nom ne vient jamais
           mordre dessus. */
        .mc-club {
          position: absolute;
          left: 4mm;
          right: 4mm;
          bottom: 3.4mm;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 2.4mm;
        }
        .mc-club img {
          width: 10.5mm;
          height: 10.5mm;
          object-fit: contain;
          flex: 0 0 auto;
          padding: 0.5mm;
          /* CARRÉ à coins arrondis, et non rond : un cercle ampute les quatre
             coins d'un logo carré plein, et l'on ne choisit pas ce que les
             structures téléversent.
             Fond GRIS MOYEN, et non blanc : la moitié des logos esport sont
             blancs sur fond transparent — sur du blanc ils disparaissaient
             purement et simplement. Un gris moyen fait ressortir les deux
             extrêmes, le logo sombre comme le logo blanc. */
          background: #9a9aa8;
          border-radius: 1.4mm;
        }
        .mc-club span {
          font-size: 4.4mm;
          font-weight: 700;
          letter-spacing: 0.03em;
          color: #fff;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .mc-seat {
          border: 0.49mm solid rgba(0, 217, 54, 0.65);
          background: rgba(0, 217, 54, 0.12);
          padding: 1.47mm 4.88mm;
          display: inline-flex;
          align-items: baseline;
          gap: 2.6mm;
        }
        .mc-seat .k {
          font-size: 3.26mm;
          letter-spacing: 0.18em;
          color: #8fe3a5;
          text-transform: uppercase;
          font-weight: 700;
        }
        .mc-seat .v {
          font-family: var(--font-display);
          font-size: 8.79mm;
          line-height: 1;
          color: #00d936;
        }

        .mc-meta {
          flex: 0 0 auto;
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 2.6mm 4.88mm;
          font-size: 3.26mm;
          color: #9c97b4;
          letter-spacing: 0.04em;
        }
        .mc-meta .right { display: inline-flex; align-items: center; gap: 2.6mm; }
        .mc-code {
          font-family: var(--font-display);
          font-size: 4.72mm;
          letter-spacing: 0.1em;
          color: #aaa5c0;
        }
        .mc-noimg { display: inline-flex; align-items: center; color: #e5737f; }
        .mc-noimg svg { width: 4.23mm; height: 4.23mm; }

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
            margin: 4mm;
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
          <NomAjuste texte={badge.headline} />
          {badge.detail && <div className="mc-detail">{badge.detail}</div>}
          {/* L'écurie : à l'accueil, elle dit d'un coup d'œil que trois
              personnes arrivent ensemble, et à qui les asseoir côte à côte. */}
          {badge.team && (
            <div className="mc-club">
              {badge.teamLogo && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={badge.teamLogo} alt="" />
              )}
              <span>{badge.team}</span>
            </div>
          )}
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
