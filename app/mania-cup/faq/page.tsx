'use client';

import { useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { HelpCircle, Loader2 } from 'lucide-react';
import { apiPublic } from '@/lib/api-client';
import { MANIA_CUP } from '@/lib/mania-cup';

// FAQ publique de la Springs Mania Cup.
//
// Même mécanique que le règlement — texte en base, éditable depuis la console,
// versionné. Une FAQ vit précisément par ses corrections : chaque question
// posée deux fois sur le Discord doit pouvoir y atterrir le jour même.

type Rulebook = { markdown: string; version: number; updatedAt: string | null } | null;

export default function FaqPage() {
  const [rulebook, setRulebook] = useState<Rulebook>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiPublic<{ rulebook: Rulebook }>('/api/mania-cup/rulebook?doc=faq')
      .then((d) => setRulebook(d.rulebook))
      .catch(() => setRulebook(null))
      .finally(() => setLoading(false));
  }, []);

  return (
    <main className="text-[#eaeaf0]">
      <div className="mx-auto max-w-3xl px-6 py-14">
        <div className="flex items-center gap-4">
          <HelpCircle size={32} className="text-[#a364d9]" aria-hidden />
          <h1 className="font-display text-5xl leading-tight">Questions fréquentes</h1>
        </div>
        <p className="mt-3 text-lg text-[#c9c5d8]">
          {MANIA_CUP.name} · 3 &amp; 4 octobre 2026 · {MANIA_CUP.city}
        </p>

        {loading ? (
          <div className="mt-12 flex items-center gap-3 text-[#8d89a8]">
            <Loader2 className="animate-spin" size={20} aria-hidden />
            Chargement…
          </div>
        ) : !rulebook ? (
          <p className="mt-12 text-[#8d89a8]">
            Aucune question n’a encore été publiée. Pose les tiennes sur le Discord
            Springs E-Sport, les réponses arriveront ici.
          </p>
        ) : (
          <>
            <p className="mt-8 text-sm text-[#8d89a8]">
              Version {rulebook.version}
              {rulebook.updatedAt && (
                <> · mise à jour le {new Date(rulebook.updatedAt).toLocaleDateString('fr-FR')}</>
              )}
            </p>
            <article className="mania-faq mt-8">
              <ReactMarkdown>{rulebook.markdown}</ReactMarkdown>
            </article>
          </>
        )}
      </div>

      {/* Mise en forme du markdown : les balises viennent de ReactMarkdown, on
          ne peut pas leur poser de classes une par une. */}
      <style>{`
        .mania-faq h2 {
          font-family: var(--font-bebas), system-ui, sans-serif;
          letter-spacing: .04em;
          font-size: 2rem;
          margin: 2.5rem 0 .75rem;
          color: #fff;
        }
        .mania-faq h3 {
          font-size: 1.15rem; font-weight: 600; margin: 1.75rem 0 .5rem; color: #fff;
        }
        .mania-faq p { margin: .85rem 0; line-height: 1.75; color: #c9c5d8; }
        .mania-faq ul { margin: .85rem 0; padding-left: 1.4rem; list-style: disc; }
        .mania-faq li { margin: .4rem 0; line-height: 1.7; color: #c9c5d8; }
        .mania-faq strong { color: #fff; }
        .mania-faq blockquote {
          border-left: 3px solid #FFB800;
          background: rgba(255,184,0,.08);
          padding: .75rem 1.25rem;
          margin: 1.25rem 0;
          color: #f2e6c8;
        }
        .mania-faq a { color: #00D936; text-decoration: underline; }
      `}</style>
    </main>
  );
}
