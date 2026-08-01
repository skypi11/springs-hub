import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import {
  Clock, MapPin, Monitor, Coffee, BedDouble, Trophy,
  Ticket, ArrowRight, Lock, EyeOff,
} from 'lucide-react';
import { isManiaCupPublic } from '@/lib/mania-cup';

// Page publique de la Springs Mania Cup — LAN Trackmania des 3 et 4 octobre 2026.
//
// Organisateur : SPRINGS E-SPORT. Aedral n'est que l'hébergeur : le crédit
// organisateur est affiché en tête, comme sur les compétitions Legends.
//
// RÈGLE ÉDITORIALE (demandée par Matt) : ne JAMAIS détailler les épreuves ni
// leurs modes de jeu. Deux d'entre elles se jouent en équipes/duos formés sur
// place et les joueurs ne doivent pas le savoir à l'avance. Les récompenses du
// samedi restent donc formulées sans jamais nommer qui les remporte.
// Le secret n'est pas un manque : c'est le concept « fast learn » lui-même.

const INSCRIPTION_URL = '/mania-cup/inscription';

// Métadonnées dynamiques : tant que l'événement n'est pas publié, la page est
// explicitement retirée des moteurs de recherche. Elle reste atteignable par
// son adresse directe — c'est ce qui permet de la faire relire avant l'annonce.
export async function generateMetadata(): Promise<Metadata> {
  const published = isManiaCupPublic();
  return {
    title: 'Springs Mania Cup — LAN Trackmania, 3 & 4 octobre 2026',
    description:
      "La première LAN Trackmania 100 % fast learn. 64 joueurs, plus de 40 maps inédites découvertes sur place, 8 épreuves, 1 200 € de cashprize. Les 3 et 4 octobre 2026 à Marzy (58).",
    robots: published ? undefined : { index: false, follow: false },
    openGraph: {
      title: 'Springs Mania Cup — LAN Trackmania',
      description:
        "64 joueurs, +40 maps inédites, 8 épreuves, 1 200 € de cashprize. Ton talent, pas ton grind.",
      images: ['/mania-cup/affiche.png'],
      type: 'website',
    },
  };
}

const STATS = [
  { value: '2', label: 'jours de LAN' },
  { value: '64', label: 'joueurs' },
  { value: '+40', label: 'maps inédites' },
  { value: '8', label: 'épreuves' },
];

const SAMEDI = [
  { h: '10h00', t: 'Ouverture de la salle', d: 'Installation, branchement des setups, essais libres.' },
  { h: '13h00', t: 'Émission d’ouverture', d: 'Une heure en direct avec les présentateurs et les casteurs.' },
  { h: '14h00', t: 'Début de la compétition', d: 'Première épreuve.' },
  { h: '21h30', t: 'Fin de la journée', d: null },
];

const DIMANCHE = [
  { h: '09h30', t: 'Reprise', d: 'La compétition repart, les places se jouent.' },
  { h: '16h30', t: 'Cérémonie de clôture', d: 'Podium et remise du cashprize.' },
  { h: '17h00', t: 'Fin de l’événement', d: null },
];

const PRATIQUE = [
  {
    icon: Monitor,
    title: 'Tu amènes ton setup',
    text: "La LAN se joue en BYOPC : chacun vient avec sa machine, son écran et ses périphériques. Quelques postes sont disponibles à la location sur place, en nombre très limité — la location se réserve et se règle sur HelloAsso, en même temps que ton inscription ou plus tard.",
  },
  {
    icon: Coffee,
    title: 'Buvette sur place',
    text: "Sandwichs, snacks, boissons fraîches et chaudes sont disponibles sur place pendant les deux jours. L’inscription ne comprend pas la restauration.",
  },
  {
    icon: BedDouble,
    title: 'Hébergement',
    text: "Un tarif préférentiel a été négocié avec ibis budget pour les joueurs qui viennent de loin. Le montant de la remise et les modalités de réservation seront communiqués ici avant l’événement.",
  },
  {
    icon: MapPin,
    title: 'Venir à Marzy',
    text: "19 rue des Charrons, 58180 Marzy — dans l’agglomération de Nevers. Les infos d’accès détaillées sont envoyées à tous les inscrits.",
  },
];

export default function ManiaCupPage() {
  const published = isManiaCupPublic();

  return (
    <main className="min-h-screen bg-[#07050b] text-[#eaeaf0]">

      {/* Visible tant que MANIA_CUP_PUBLIC n'est pas passé à true. */}
      {!published && (
        <div className="flex items-center justify-center gap-3 bg-[#FFB800] px-6 py-3 text-center text-sm font-semibold text-[#07050b]">
          <EyeOff size={16} aria-hidden />
          Page non publiée — accessible par lien direct, retirée des moteurs de
          recherche, inscriptions fermées au public.
        </div>
      )}

      {/* ---------------- HERO ---------------- */}
      <section className="relative overflow-hidden border-b border-white/10">
        <div
          aria-hidden
          className="pointer-events-none absolute -top-80 left-1/2 h-[900px] w-[1400px] -translate-x-1/2"
          style={{
            background:
              'radial-gradient(ellipse at center, rgba(123,47,190,.55) 0%, rgba(123,47,190,.14) 45%, rgba(7,5,11,0) 70%)',
          }}
        />

        <div className="relative mx-auto grid max-w-6xl items-center gap-12 px-6 py-16 lg:grid-cols-[1.15fr_1fr] lg:py-24">
          <div>
            {/* Crédit organisateur — Springs organise, Aedral héberge */}
            <div className="flex items-center gap-3">
              <Image
                src="/springs-logo.png"
                alt="Springs E-Sport"
                width={150}
                height={44}
                className="h-9 w-auto"
                priority
              />
              <span className="text-xs tracking-[0.28em] text-[#8d89a8] uppercase">
                présente
              </span>
            </div>

            <div className="mt-7 flex flex-wrap items-center gap-3">
              <span className="bg-[#00D936] px-3 py-1 text-sm font-bold tracking-[0.22em] text-[#07050b] uppercase">
                LAN
              </span>
              <span className="text-sm tracking-[0.28em] text-[#00D936] uppercase">
                Trackmania
              </span>
            </div>

            <h1 className="font-display mt-4 text-6xl leading-[0.92] sm:text-7xl lg:text-8xl">
              Springs<br />Mania Cup
            </h1>

            <p className="font-display mt-6 text-3xl leading-tight sm:text-4xl">
              Ton talent,{' '}
              <span className="text-[#00D936]">pas ton grind</span>
            </p>

            <div className="mt-8 flex flex-wrap items-center gap-x-8 gap-y-3 text-lg">
              <span className="font-semibold">3 &amp; 4 octobre 2026</span>
              <span className="flex items-center gap-2 text-[#a364d9]">
                <MapPin size={18} aria-hidden />
                Marzy&nbsp;(58)
              </span>
            </div>

            <div className="mt-10 flex flex-wrap items-center gap-5">
              <Link
                href={INSCRIPTION_URL}
                className="inline-flex items-center gap-2 bg-[#00D936] px-7 py-4 text-lg font-bold text-[#07050b] transition-transform hover:scale-[1.03]"
              >
                <Ticket size={20} aria-hidden />
                S’inscrire — 30 €
              </Link>
              <span className="text-sm text-[#8d89a8]">
                64 places · billetterie&nbsp;HelloAsso
              </span>
            </div>
          </div>

          <div className="relative mx-auto w-full max-w-sm lg:max-w-none">
            <Image
              src="/mania-cup/affiche.png"
              alt="Affiche de la Springs Mania Cup"
              width={1080}
              height={1527}
              className="h-auto w-full border border-white/10 shadow-2xl"
              priority
            />
          </div>
        </div>
      </section>

      {/* ---------------- CHIFFRES ---------------- */}
      <section className="border-b border-white/10 bg-black/30">
        <div className="mx-auto grid max-w-6xl grid-cols-2 px-6 lg:grid-cols-4">
          {STATS.map((s, i) => (
            <div
              key={s.label}
              className={`py-8 text-center ${i > 0 ? 'border-l border-white/10' : ''} ${
                i === 2 ? 'border-l-0 lg:border-l' : ''
              }`}
            >
              <div className="font-display text-5xl lg:text-6xl">{s.value}</div>
              <div className="mt-1 text-xs tracking-[0.18em] text-[#8d89a8] uppercase">
                {s.label}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ---------------- LE CONCEPT ---------------- */}
      <section className="mx-auto max-w-4xl px-6 py-20">
        <span className="inline-block bg-[#00D936] px-3 py-1 text-sm font-bold tracking-[0.18em] text-[#07050b] uppercase">
          Une première
        </span>
        <h2 className="font-display mt-5 text-4xl leading-tight sm:text-5xl">
          Une LAN 100 % fast learn
        </h2>

        <div className="mt-7 space-y-5 text-lg leading-relaxed text-[#c9c5d8]">
          <p>
            Sur une compétition Trackmania classique, la victoire revient souvent à
            celui qui a refait la même map cinq cents fois. Ici, personne ne part
            avec cette avance.
          </p>
          <p>
            Plus de <strong className="text-white">40 maps inédites</strong>, découvertes
            le jour même, réparties sur <strong className="text-white">8 épreuves</strong>{' '}
            aux règles différentes. Aucune ne peut être travaillée à l’avance. Ce qui
            départage les 64 joueurs, ce n’est pas le nombre d’heures accumulées avant
            l’événement : c’est la vitesse à laquelle on comprend une piste qu’on
            n’a jamais vue.
          </p>
        </div>

        <div className="mt-10 flex gap-4 border border-[#7B2FBE]/40 bg-[#7B2FBE]/10 p-6">
          <Lock size={22} className="mt-0.5 shrink-0 text-[#a364d9]" aria-hidden />
          <p className="text-[#c9c5d8]">
            <strong className="text-white">Le programme des épreuves reste secret</strong>{' '}
            jusqu’au jour J. Leurs règles, leurs modes de jeu et leurs maps ne seront
            dévoilés que sur place, au fur et à mesure. C’est la condition pour que
            tout le monde arrive à égalité — et c’est tout l’intérêt de l’événement.
          </p>
        </div>
      </section>

      {/* ---------------- DÉROULÉ ---------------- */}
      <section className="border-y border-white/10 bg-black/30">
        <div className="mx-auto max-w-6xl px-6 py-20">
          <h2 className="font-display text-4xl leading-tight sm:text-5xl">
            Le déroulé des deux jours
          </h2>
          <p className="mt-4 max-w-2xl text-[#8d89a8]">
            Les horaires d’ouverture et de fin sont fermes — ils te permettent
            d’organiser ta route et ton hébergement.
          </p>

          <div className="mt-12 grid gap-12 lg:grid-cols-2">
            <Day title="Samedi 3 octobre" items={SAMEDI} />
            <Day title="Dimanche 4 octobre" items={DIMANCHE} />
          </div>

          <div className="mt-12 flex gap-4 border-l-4 border-[#00D936] bg-white/[0.03] p-6">
            <Clock size={22} className="mt-0.5 shrink-0 text-[#00D936]" aria-hidden />
            <p className="text-[#c9c5d8]">
              <strong className="text-white">Arrive largement en avance le samedi.</strong>{' '}
              La salle t’accueille dès 10h pour que tu aies le temps d’installer ton
              matériel sans stress, et l’émission d’ouverture démarre à 13h — soit une
              heure avant le début de la compétition.
            </p>
          </div>
        </div>
      </section>

      {/* ---------------- RÉCOMPENSES ---------------- */}
      <section className="mx-auto max-w-4xl px-6 py-20">
        <div className="flex items-center gap-4">
          <Trophy size={30} className="text-[#00D936]" aria-hidden />
          <h2 className="font-display text-4xl leading-tight sm:text-5xl">
            1 200 € de cashprize
          </h2>
        </div>
        <div className="mt-7 space-y-5 text-lg leading-relaxed text-[#c9c5d8]">
          <p>
            Chaque épreuve du samedi a ses propres récompenses, remises le jour même.
          </p>
          <p>
            Le dimanche, la compétition se resserre épreuve après épreuve jusqu’au
            titre. La dotation principale est{' '}
            <strong className="text-white">répartie entre les trois premiers</strong>{' '}
            et remise lors de la cérémonie de clôture.
          </p>
        </div>
      </section>

      {/* ---------------- INFOS PRATIQUES ---------------- */}
      <section className="border-t border-white/10 bg-black/30">
        <div className="mx-auto max-w-6xl px-6 py-20">
          <h2 className="font-display text-4xl leading-tight sm:text-5xl">
            Infos pratiques
          </h2>

          <div className="mt-12 grid gap-8 sm:grid-cols-2">
            {PRATIQUE.map(({ icon: Icon, title, text }) => (
              <div key={title} className="border border-white/10 bg-white/[0.02] p-7">
                <Icon size={26} className="text-[#a364d9]" aria-hidden />
                <h3 className="font-display mt-4 text-2xl">{title}</h3>
                <p className="mt-3 leading-relaxed text-[#c9c5d8]">{text}</p>
              </div>
            ))}
          </div>

          <p className="mt-8 text-sm text-[#8d89a8]">
            L’inscription de 30 € couvre uniquement ta participation à la compétition.
            Restauration, boissons et hébergement restent à ta charge.
          </p>
        </div>
      </section>

      {/* ---------------- CTA FINAL ---------------- */}
      <section className="relative overflow-hidden">
        <div
          aria-hidden
          className="pointer-events-none absolute -bottom-72 left-1/2 h-[700px] w-[1200px] -translate-x-1/2"
          style={{
            background:
              'radial-gradient(ellipse at center, rgba(0,217,54,.20) 0%, rgba(0,217,54,.04) 45%, rgba(7,5,11,0) 72%)',
          }}
        />
        <div className="relative mx-auto max-w-3xl px-6 py-24 text-center">
          <h2 className="font-display text-5xl leading-tight sm:text-6xl">
            64 places, pas une de plus
          </h2>
          <p className="mt-5 text-lg text-[#c9c5d8]">
            L’inscription se fait ici, le paiement sur HelloAsso. Ta place n’est
            confirmée qu’une fois le règlement reçu.
          </p>
          <p className="mt-4">
            <Link href="/mania-cup/reglement" className="text-[#a364d9] underline">
              Lire le règlement de la compétition
            </Link>
          </p>
          <Link
            href={INSCRIPTION_URL}
            className="mt-10 inline-flex items-center gap-3 bg-[#00D936] px-9 py-5 text-xl font-bold text-[#07050b] transition-transform hover:scale-[1.03]"
          >
            S’inscrire — 30 €
            <ArrowRight size={22} aria-hidden />
          </Link>
        </div>
      </section>
    </main>
  );
}

function Day({
  title,
  items,
}: {
  title: string;
  items: { h: string; t: string; d: string | null }[];
}) {
  return (
    <div>
      <h3 className="font-display border-b border-white/10 pb-4 text-3xl">{title}</h3>
      <ol className="mt-7 space-y-7">
        {items.map((it) => (
          <li key={it.h} className="flex gap-5">
            <span className="font-display w-20 shrink-0 text-2xl text-[#00D936]">
              {it.h}
            </span>
            <div>
              <div className="text-lg font-semibold">{it.t}</div>
              {it.d && <div className="mt-1 text-[#8d89a8]">{it.d}</div>}
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
