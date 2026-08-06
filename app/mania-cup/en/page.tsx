import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import {
  CalendarDays, MapPin, Monitor, Trophy, Ticket, ArrowRight,
  Lock, Users, TrainFront, Languages,
} from 'lucide-react';
import { getAdminDb } from '@/lib/firebase-admin';
import { isManiaCupPublic, MANIA_CUP } from '@/lib/mania-cup';
import { getManiaCupSettings } from '@/lib/mania-cup-settings';

// Porte d'entrée anglaise de la Springs Mania Cup.
//
// L'événement est annoncé sur des serveurs Discord Trackmania européens, et
// l'organisateur veut faire venir des joueurs étrangers. Le reste du site
// demeure en français : traduire les 53 pages coûterait des semaines pour un
// événement qui dure deux jours, et les navigateurs traduisent déjà
// convenablement une page de prose.
//
// Cette page-ci ne s'en remet pas au traducteur automatique, parce qu'elle est
// la première impression : dates, prix, format, accès, et ce qui l'attend en
// français ensuite. Tout ce qu'il faut pour décider de traverser l'Europe.
//
// Ce qui reste NON traduit, et qu'on annonce plutôt que de le cacher : le
// parcours d'inscription, le paiement HelloAsso et le Discord d'accueil.

export const metadata: Metadata = {
  title: 'Springs Mania Cup — Trackmania LAN, October 3–4 2026, France',
  description:
    '64 players, 40+ brand new maps discovered on the day, 8 events, €1,200 prize pool. A 100 % fast learn Trackmania LAN in Marzy, France.',
  alternates: {
    canonical: 'https://aedral.com/mania-cup/en',
    languages: { fr: 'https://aedral.com/mania-cup', en: 'https://aedral.com/mania-cup/en' },
  },
  openGraph: {
    title: 'Springs Mania Cup — Trackmania LAN',
    description:
      '64 players, 40+ brand new maps, 8 events, €1,200 prize pool. October 3–4, 2026 — Marzy, France.',
    images: ['/mania-cup/affiche-en.png'],
    type: 'website',
    locale: 'en_GB',
  },
};

const SCHEDULE = [
  { d: 'Saturday, October 3', rows: [
    ['9:00 AM', 'Doors open — ID check, badge, set up your rig'],
    ['12:00 PM', 'All rigs must be set up. The next hour is for network and audio checks'],
    ['1:00 PM', 'Springs Show — the eight events are revealed, live'],
    ['2:00 PM', 'Competition starts'],
    ['9:30 PM', 'End of day one'],
  ] },
  { d: 'Sunday, October 4', rows: [
    ['9:30 AM', 'Day two — the field starts thinning out'],
    ['4:30 PM', 'Closing ceremony, podium and prize money'],
    ['5:00 PM', 'End of the event'],
  ] },
];

const FACTS = [
  { icon: Trophy, t: '€1,200 prize pool', d: 'Shared between the top finishers, paid by bank transfer within a month of the event.' },
  { icon: Users, t: '64 players', d: 'One venue, two days. Entry is €30.' },
  { icon: Monitor, t: 'BYOPC', d: 'Bring your own PC, screen, peripherals and a 10 m ethernet cable. There is no Wi-Fi for players. A few rigs are available to rent on site, in very limited numbers.' },
  { icon: Lock, t: 'Nothing can be practised', d: '40+ brand new maps across 8 events, all revealed on the day. What decides the winner is not how many hours you put in beforehand.' },
];

export const revalidate = 60;

export default async function ManiaCupEnglishPage() {
  const published = isManiaCupPublic();
  const settings = await getManiaCupSettings(getAdminDb());

  return (
    <main lang="en" className="min-h-screen bg-[#07050b] text-[#eaeaf0]">
      {!published && (
        <div className="bg-[#FFB800] px-6 py-3 text-center text-sm font-semibold text-[#07050b]">
          Not published yet — reachable by direct link, hidden from search engines.
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
        <div className="relative mx-auto grid max-w-6xl gap-12 px-6 py-16 lg:grid-cols-[1.1fr_.9fr] lg:py-20">
          <div>
            <span className="inline-block bg-[#00D936] px-3 py-1 text-sm font-bold tracking-[0.18em] text-[#07050b] uppercase">
              100 % fast learn
            </span>
            <h1 className="font-display mt-5 text-5xl leading-[0.95] sm:text-6xl">
              Springs <span className="text-[#00D936]">Mania Cup</span>
            </h1>
            <p className="mt-4 text-xl text-[#c9c5d8]">
              A Trackmania LAN where nobody gets to practise first.
            </p>

            <div className="mt-7 flex flex-wrap gap-x-8 gap-y-3 text-lg">
              <span className="inline-flex items-center gap-2">
                <CalendarDays size={18} className="text-[#00D936]" aria-hidden />
                October 3–4, 2026
              </span>
              <span className="inline-flex items-center gap-2">
                <MapPin size={18} className="text-[#00D936]" aria-hidden />
                Marzy, France
              </span>
            </div>

            <div className="mt-9 flex flex-wrap items-center gap-4">
              <Link
                href="/mania-cup/inscription"
                className="inline-flex items-center gap-2 bg-[#00D936] px-7 py-4 text-lg font-bold text-[#07050b] transition-transform hover:scale-[1.02]"
              >
                <Ticket size={20} aria-hidden />
                Register — €{settings.priceEuros}
              </Link>
              <span className="text-sm text-[#8d89a8]">
                {settings.maxPlayers} seats · registration in French
              </span>
            </div>
          </div>

          <div className="relative hidden lg:block">
            <Image
              src="/mania-cup/affiche-en.png"
              alt="Springs Mania Cup poster"
              width={1080}
              height={1527}
              className="w-full"
              priority
            />
          </div>
        </div>
      </section>

      {/* ---------------- LE FORMAT ---------------- */}
      <section className="mx-auto max-w-4xl px-6 py-20">
        <h2 className="font-display text-4xl leading-tight sm:text-5xl">
          Eight events. None of them plays like the last one.
        </h2>
        <div className="mt-7 space-y-5 text-lg leading-relaxed text-[#c9c5d8]">
          <p>
            More than 40 brand new maps, spread across eight events with nothing
            in common. The full programme drops at the Springs Show on Saturday
            at 1 PM, live in front of everyone. Until then nobody knows what is
            coming — not you, not the player sitting next to you.
          </p>
          <p>
            Saturday runs four events until 9:30 PM. On Sunday the field thins
            out event after event, all the way to the final. Podium at 4:30 PM.
          </p>
        </div>

        <div className="mt-12 grid gap-5 sm:grid-cols-2">
          {FACTS.map((f) => (
            <div key={f.t} className="panel bevel p-6">
              <f.icon size={22} className="text-[#00D936]" aria-hidden />
              <h3 className="mt-3 text-lg font-semibold">{f.t}</h3>
              <p className="mt-2 text-[#8d89a8]">{f.d}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ---------------- HORAIRES ---------------- */}
      <section className="border-y border-white/10 bg-black/30">
        <div className="mx-auto max-w-4xl px-6 py-20">
          <h2 className="font-display text-4xl leading-tight sm:text-5xl">Schedule</h2>
          <p className="mt-4 text-[#8d89a8]">
            All times are Paris time (CEST, UTC+2). Opening and closing times are
            firm — plan your travel and your hotel around them.
          </p>

          <div className="mt-10 grid gap-10 sm:grid-cols-2">
            {SCHEDULE.map((day) => (
              <div key={day.d}>
                <h3 className="font-display border-b border-white/10 pb-4 text-2xl">{day.d}</h3>
                <ol className="mt-6 space-y-5">
                  {day.rows.map(([time, what]) => (
                    <li key={time} className="flex gap-4">
                      <span className="font-display w-24 shrink-0 text-xl text-[#00D936]">{time}</span>
                      <span className="text-[#c9c5d8]">{what}</span>
                    </li>
                  ))}
                </ol>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ---------------- VENIR ---------------- */}
      <section className="mx-auto max-w-4xl px-6 py-20">
        <h2 className="font-display text-4xl leading-tight sm:text-5xl">Getting there</h2>
        <div className="mt-8 space-y-6 text-lg leading-relaxed text-[#c9c5d8]">
          <p>
            <strong className="text-white">{MANIA_CUP.address}</strong> — about
            two hours south of Paris. Free parking on site.
          </p>
          <p className="flex gap-3">
            <TrainFront size={22} className="mt-1 shrink-0 text-[#00D936]" aria-hidden />
            <span>
              By train: Nevers station is 5 km from the venue.{' '}
              <strong className="text-white">We will pick you up if you ask.</strong>{' '}
              Post your arrival time on the Springs Discord and someone from the
              team will be there. Please do not take a taxi without asking us first.
            </span>
          </p>
          <p>
            A discounted rate has been negotiated with ibis budget for players
            travelling from far away. Food and drinks are available on site
            throughout the weekend.
          </p>
        </div>
      </section>

      {/* ---------------- CE QUI RESTE EN FRANÇAIS ---------------- */}
      <section className="border-y border-white/10 bg-black/30">
        <div className="mx-auto max-w-4xl px-6 py-16">
          <div className="flex gap-4">
            <Languages size={24} className="mt-1 shrink-0 text-[#a364d9]" aria-hidden />
            <div>
              <h2 className="font-display text-2xl">Before you register</h2>
              <p className="mt-3 text-[#c9c5d8]">
                This page is in English. The registration flow, the ticketing
                (HelloAsso) and the Springs Discord are in French — your
                browser&apos;s built-in translation handles them well, and one of
                our casters is bilingual, so the event itself runs in both
                languages.
              </p>
              <p className="mt-4 text-[#c9c5d8]">
                Two things worth knowing: registration gives you a{' '}
                <strong className="text-white">registration code</strong> that you
                must copy into the ticketing form — that code is what links your
                payment to your entry. And the rules are available in English on
                the rulebook page, below the French text.
              </p>
              <p className="mt-4 text-sm text-[#8d89a8]">
                Anything unclear? Ask on the Springs Discord, we answer in English.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ---------------- CTA ---------------- */}
      <section className="mx-auto max-w-4xl px-6 py-20 text-center">
        <h2 className="font-display text-4xl leading-tight sm:text-5xl">
          {settings.maxPlayers} seats, not one more
        </h2>
        <p className="mt-4 text-lg text-[#c9c5d8]">
          Registration happens here, payment on HelloAsso. Your seat is confirmed
          once the payment goes through.
        </p>
        <div className="mt-9 flex flex-wrap items-center justify-center gap-4">
          <Link
            href="/mania-cup/inscription"
            className="inline-flex items-center gap-2 bg-[#00D936] px-7 py-4 text-lg font-bold text-[#07050b] transition-transform hover:scale-[1.02]"
          >
            Register — €{settings.priceEuros}
            <ArrowRight size={20} aria-hidden />
          </Link>
          <Link href="/mania-cup" className="text-[#a364d9] underline">
            Version française
          </Link>
        </div>
      </section>
    </main>
  );
}
