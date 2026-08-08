'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Loader2, Users, Ticket } from 'lucide-react';
import { apiPublic } from '@/lib/api-client';
import CountryFlag from '@/components/ui/CountryFlag';
import { countries } from '@/lib/countries';
import { useManiaCupSettings } from '@/components/mania-cup/useManiaCupSettings';

// Liste publique des inscrits à la Springs Mania Cup.
//
// Elle sert autant l'émulation que la transparence : on voit qui vient, d'où,
// et combien de places restent. La route ne renvoie que pseudo, pays et statut.

type Participant = {
  tmDisplayName: string;
  countryCode: string;
  status: 'pending_payment' | 'confirmed' | 'cancelled';
};

type Payload = {
  participants: Participant[];
  counts: { confirmed: number; pending: number; max: number; seatsLeft: number };
};

const countryName = (code: string) => countries.find((c) => c.code === code)?.name ?? code;

export default function InscritsPage() {
  const settings = useManiaCupSettings();
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [denied, setDenied] = useState(false);

  useEffect(() => {
    apiPublic<Payload>('/api/mania-cup/participants')
      .then(setData)
      .catch(() => setDenied(true))
      .finally(() => setLoading(false));
  }, []);

  return (
    <main className="text-[#eaeaf0]">
      <div className="mx-auto max-w-4xl px-6 py-14">
        <div className="flex items-center gap-4">
          <Users size={32} className="text-[#a364d9]" aria-hidden />
          <h1 className="font-display text-[34px] sm:text-5xl leading-tight">Les inscrits</h1>
        </div>

        {loading ? (
          <div className="mt-12 flex items-center gap-3 text-[#8d89a8]">
            <Loader2 className="animate-spin" size={20} aria-hidden />
            Chargement…
          </div>
        ) : denied || !data ? (
          <p className="mt-12 text-[#8d89a8]">
            Les inscriptions ne sont pas encore ouvertes.
          </p>
        ) : (
          <>
            <div className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-3">
              <Stat value={data.counts.confirmed} label="places acquises" tone="ok" />
              <Stat value={data.counts.pending} label="en attente de paiement" />
              <Stat value={data.counts.seatsLeft} label={`places libres sur ${data.counts.max}`} />
            </div>

            {data.participants.length === 0 ? (
              <p className="mt-12 text-[#c9c5d8]">
                Personne pour l’instant. Sois le premier.
              </p>
            ) : (
              <ul className="mt-10 divide-y divide-white/5 border-y border-white/10">
                {data.participants.map((p, i) => (
                  <li
                    key={`${p.tmDisplayName}-${i}`}
                    className="flex items-center gap-4 py-3.5"
                  >
                    <span className="w-8 shrink-0 text-right text-sm text-[#6a6a8a]">
                      {i + 1}
                    </span>
                    <CountryFlag code={p.countryCode} size={24} title={countryName(p.countryCode)} />
                    <span className="min-w-0 flex-1 truncate font-semibold">
                      {p.tmDisplayName}
                    </span>
                    {p.status === 'pending_payment' && (
                      <span className="shrink-0 border border-[#FFB800]/40 px-2 py-0.5 text-xs text-[#FFB800]">
                        en attente
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}

            {data.counts.seatsLeft > 0 && (
              <div className="mt-12 text-center">
                <Link
                  href="/mania-cup/inscription"
                  className="inline-flex items-center gap-2 bg-[#00D936] px-7 py-4 text-base sm:text-lg font-bold text-[#07050b] transition-transform hover:scale-[1.03]"
                >
                  <Ticket size={20} aria-hidden />
                  S’inscrire — {settings.priceEuros} €
                </Link>
              </div>
            )}
          </>
        )}
      </div>
    </main>
  );
}

function Stat({ value, label, tone }: { value: number; label: string; tone?: 'ok' }) {
  return (
    <div className="border border-white/10 bg-white/[0.02] p-5 text-center">
      <div className={`font-display text-[28px] sm:text-4xl ${tone === 'ok' ? 'text-[#00D936]' : ''}`}>
        {value}
      </div>
      <div className="mt-1 text-xs tracking-wide text-[#8d89a8]">{label}</div>
    </div>
  );
}
