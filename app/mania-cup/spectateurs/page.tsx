'use client';

import Link from 'next/link';
import { Users, Monitor, Radio, Coffee, MapPin, Baby, Ticket } from 'lucide-react';
import { MANIA_CUP } from '@/lib/mania-cup';
import TicketButton from '@/components/mania-cup/TicketButton';
import { useManiaCupSettings } from '@/components/mania-cup/useManiaCupSettings';

// Page spectateurs.
//
// Elle existe pour deux raisons. La première : l'onglet pointait vers une ancre
// de la page de présentation, qui ne défilait pas quand on y était déjà — un
// clic sans effet. La seconde, plus importante : un spectateur et un joueur
// n'ont pas le même besoin. Le joueur veut s'inscrire, le spectateur veut
// savoir ce qu'il va voir, combien ça coûte et où ça se passe. Mélanger les
// deux sur une même page ne servait ni l'un ni l'autre.

export default function SpectateursPage() {
  const settings = useManiaCupSettings();
  const TARIFS = [
    {
      price: `${settings.spectatorEuros} €`,
      title: 'Les deux jours',
      desc: 'Samedi et dimanche, un seul billet. Tu peux venir l’un, l’autre ou les deux.',
      highlight: true,
    },
    {
      price: 'Gratuit',
      title: 'Moins de 12 ans',
      desc: 'Accompagné d’un adulte muni de son billet.',
      free: true,
    },
  ];

  return (
    <main className="text-[#eaeaf0]">
      <div className="mx-auto max-w-4xl px-6 py-14">
        <div className="flex items-center gap-4">
          <Users size={32} className="text-[#a364d9]" aria-hidden />
          <h1 className="font-display text-5xl leading-tight">Venir en spectateur</h1>
        </div>

        <p className="mt-6 text-lg leading-relaxed text-[#c9c5d8]">
          La Springs Mania Cup est ouverte au public. Tu n’as ni compte à créer, ni
          inscription à remplir : un billet suffit, et tu entres.
        </p>

        {/* ---- Ce qu'on vient voir ---- */}
        <section className="mt-14">
          <h2 className="font-display text-3xl">Ce que tu viens voir</h2>
          <div className="mt-6 grid gap-5 sm:grid-cols-3">
            <Card icon={Radio} title="Un plateau commenté">
              Une scène, des présentateurs et des casteurs commentent la compétition
              en direct pendant les deux jours.
            </Card>
            <Card icon={Monitor} title="64 joueurs en salle">
              Les épreuves se jouent devant toi, sur écrans géants, avec le classement
              qui bouge en temps réel.
            </Card>
            <Card icon={Coffee} title="Une buvette">
              Sandwichs, snacks, boissons fraîches et chaudes sur place, les deux jours.
            </Card>
          </div>
        </section>

        {/* ---- Tarifs ---- */}
        <section className="mt-16">
          <h2 className="font-display text-3xl">Tarifs</h2>
          <div className="mt-6 grid gap-4 sm:grid-cols-3">
            {TARIFS.map((t) => (
              <div
                key={t.title}
                className={`border p-6 ${
                  t.highlight
                    ? 'border-[#a364d9]/50 bg-[#7B2FBE]/10'
                    : 'border-white/10 bg-white/[0.02]'
                }`}
              >
                <div
                  className={`font-display text-4xl ${t.free ? 'text-[#00D936]' : ''}`}
                >
                  {t.price}
                </div>
                <div className="mt-2 font-semibold">{t.title}</div>
                <p className="mt-2 text-sm leading-relaxed text-[#8d89a8]">{t.desc}</p>
              </div>
            ))}
          </div>

          <div className="mt-8">
            <TicketButton kind="ticketing" label="Prendre un billet spectateur" />
            <p className="mt-3 text-sm text-[#8d89a8]">
              Billetterie HelloAsso de Springs E-Sport. Aucun compte n’est nécessaire.
            </p>
          </div>
        </section>

        {/* ---- La limite à connaître avant d'acheter ---- */}
        <section className="mt-16">
          <div className="border-l-4 border-[#FFB800] bg-[#FFB800]/[0.08] p-6">
            <h2 className="font-display text-2xl">
              Un billet spectateur ne donne pas accès à la zone de jeu
            </h2>
            <p className="mt-3 leading-relaxed text-[#f2e6c8]">
              Tu assistes à la compétition depuis l’espace public : la scène, les écrans,
              l’ambiance. Mais tu ne peux pas t’installer derrière un joueur ni circuler
              entre les postes.
            </p>
            <p className="mt-3 leading-relaxed text-[#f2e6c8]">
              Pour accompagner un joueur précis dans la zone de jeu — coach, parent, ami
              — il faut un <strong className="text-white">billet accompagnant à{' '}
              {settings.companionEuros} €</strong>. C’est le joueur qui te déclare depuis
              son espace, puis tu prends ton billet en reportant son code d’inscription.
            </p>
            <div className="mt-5">
              <TicketButton
                kind="ticketing"
                variant="outline"
                label={`Billet accompagnant — ${settings.companionEuros} €`}
              />
            </div>
          </div>
        </section>

        {/* ---- Infos pratiques ---- */}
        <section className="mt-16">
          <h2 className="font-display text-3xl">Sur place</h2>
          <div className="mt-6 space-y-5">
            <Row icon={MapPin} title="Adresse">
              {MANIA_CUP.address}. Parking sur place.{' '}
              <Link href="/mania-cup" className="text-[#a364d9] underline">
                Plan et accès
              </Link>
            </Row>
            <Row icon={Radio} title="Horaires">
              Samedi 3 octobre : émission d’ouverture à 13h, compétition de 14h à 21h30.
              Dimanche 4 octobre : de 9h30 à 17h, cérémonie de clôture à 16h30.
              Heure de Paris (CEST, UTC+2).
            </Row>
            <Row icon={Baby} title="Enfants">
              L’entrée est gratuite pour les moins de 12 ans, accompagnés d’un adulte
              muni de son billet.
            </Row>
          </div>
        </section>

        <div className="mt-16 border-t border-white/10 pt-10 text-center">
          <p className="text-[#8d89a8]">Tu veux jouer plutôt que regarder ?</p>
          <Link
            href="/mania-cup/inscription"
            className="mt-4 inline-flex items-center gap-2 bg-[#00D936] px-7 py-4 text-lg font-bold text-[#07050b] transition-transform hover:scale-[1.03]"
          >
            <Ticket size={20} aria-hidden />
            S’inscrire comme joueur — {settings.priceEuros} €
          </Link>
        </div>
      </div>
    </main>
  );
}

function Card({
  icon: Icon,
  title,
  children,
}: {
  icon: React.ComponentType<{ size?: number; className?: string; 'aria-hidden'?: boolean }>;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="border border-white/10 bg-white/[0.02] p-6">
      <Icon size={24} className="text-[#a364d9]" aria-hidden />
      <h3 className="font-display mt-3 text-xl">{title}</h3>
      <p className="mt-2 text-sm leading-relaxed text-[#c9c5d8]">{children}</p>
    </div>
  );
}

function Row({
  icon: Icon,
  title,
  children,
}: {
  icon: React.ComponentType<{ size?: number; className?: string; 'aria-hidden'?: boolean }>;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex gap-4">
      <Icon size={22} className="mt-0.5 shrink-0 text-[#a364d9]" aria-hidden />
      <div>
        <div className="font-semibold">{title}</div>
        <p className="mt-1 leading-relaxed text-[#c9c5d8]">{children}</p>
      </div>
    </div>
  );
}
