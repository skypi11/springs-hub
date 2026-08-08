'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import Markdown from '@/components/ui/Markdown';
import { HelpCircle, Loader2, ChevronDown } from 'lucide-react';
import { apiPublic } from '@/lib/api-client';
import { MANIA_CUP, SPRINGS_DISCORD_INVITE } from '@/lib/mania-cup';
import type { FaqItem } from '@/lib/mania-cup-faq';

// FAQ publique, en accordéon.
//
// Les réponses sont repliées par défaut : une FAQ se parcourt en balayant les
// questions, pas en lisant un mur de texte. Construite sur <details>/<summary>
// natifs — ils fonctionnent au clavier, sont correctement annoncés par les
// lecteurs d'écran, et s'ouvrent même si le JavaScript n'a pas chargé.

export default function FaqPage() {
  const [items, setItems] = useState<FaqItem[] | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiPublic<{ items: FaqItem[] }>('/api/mania-cup/faq')
      .then((d) => setItems(d.items))
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  }, []);

  return (
    <main className="text-[#eaeaf0]">
      <div className="mx-auto max-w-3xl px-6 py-14">
        <div className="flex items-center gap-4">
          <HelpCircle size={32} className="text-[#a364d9]" aria-hidden />
          <h1 className="font-display text-[34px] sm:text-5xl leading-tight">Questions fréquentes</h1>
        </div>
        <p className="mt-3 text-base sm:text-lg text-[#c9c5d8]">
          {MANIA_CUP.name} · 3 &amp; 4 octobre 2026 · {MANIA_CUP.city}
        </p>

        {loading ? (
          <div className="mt-12 flex items-center gap-3 text-[#8d89a8]">
            <Loader2 className="animate-spin" size={20} aria-hidden />
            Chargement…
          </div>
        ) : !items || items.length === 0 ? (
          <p className="mt-12 text-[#8d89a8]">
            Aucune question publiée pour l’instant. Pose les tiennes sur le Discord
            Springs E-Sport, les réponses arriveront ici.
          </p>
        ) : (
          <div className="mt-10 space-y-3">
            {items.map((it, i) => (
              <details
                key={`${i}-${it.q}`}
                className="group border border-white/10 bg-white/[0.02] transition-colors open:border-[#00D936]/30 open:bg-[#00D936]/[0.04]"
              >
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-4 text-left">
                  <span className="font-display text-xl leading-snug tracking-wide text-white transition-colors group-open:text-[#00D936]">
                    {it.q}
                  </span>
                  <span className="flex size-7 shrink-0 items-center justify-center border border-white/15 transition-colors group-open:border-[#00D936]/50">
                    <ChevronDown
                      size={16}
                      className="text-[#8d89a8] transition-transform group-open:rotate-180 group-open:text-[#00D936]"
                      aria-hidden
                    />
                  </span>
                </summary>
                <div className="faq-answer mx-5 mb-5 border-l-2 border-[#a364d9]/50 pl-4">
                  <Markdown>{it.a}</Markdown>
                </div>
              </details>
            ))}
          </div>
        )}

        <div className="mt-14 border-t border-white/10 pt-8">
          <p className="text-[#c9c5d8]">
            Ta question n’y est pas ?{' '}
            <a
              href={SPRINGS_DISCORD_INVITE}
              target="_blank"
              rel="noreferrer"
              className="text-[#00D936] underline"
            >
              Pose-la sur le Discord Springs E-Sport
            </a>{' '}
            — si elle revient, elle atterrira ici.
          </p>
          <p className="mt-4 text-sm text-[#8d89a8]">
            Les conditions officielles de participation figurent dans le{' '}
            <Link href="/mania-cup/reglement" className="text-[#a364d9] underline">
              règlement
            </Link>
            .
          </p>
        </div>
      </div>

      {/* Le markdown des réponses vient de ReactMarkdown : impossible de poser
          des classes balise par balise. */}
      <style>{`
        .faq-answer p { margin: 0 0 .75rem; font-size: .95rem; line-height: 1.8; color: #a9a5be; }
        .faq-answer p:last-child { margin-bottom: 0; }
        .faq-answer strong { color: #fff; }
        .faq-answer ul { margin: .5rem 0; padding-left: 1.3rem; list-style: disc; }
        .faq-answer li { margin: .3rem 0; font-size: .95rem; line-height: 1.75; color: #a9a5be; }
        .faq-answer a { color: #00D936; text-decoration: underline; }
        details summary::-webkit-details-marker { display: none; }
      `}</style>
    </main>
  );
}
