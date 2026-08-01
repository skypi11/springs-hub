'use client';

import { useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { ScrollText, Loader2 } from 'lucide-react';
import { apiPublic } from '@/lib/api-client';
import { MANIA_CUP } from '@/lib/mania-cup';

// Règlement public de la Springs Mania Cup.
//
// Le texte vit en base (collection `rulebooks`, scope `event_mania-cup`) et
// s'édite depuis la console d'organisation : l'organisateur ne dépend d'aucun
// déploiement pour le corriger. Chaque publication archive la version
// précédente, et l'inscription enregistre la version acceptée.

type Rulebook = { markdown: string; version: number; updatedAt: string | null } | null;

export default function ReglementPage() {
  const [rulebook, setRulebook] = useState<Rulebook>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiPublic<{ rulebook: Rulebook }>('/api/mania-cup/rulebook')
      .then((d) => setRulebook(d.rulebook))
      .catch(() => setRulebook(null))
      .finally(() => setLoading(false));
  }, []);

  return (
    <main className="text-[#eaeaf0]">
      <div className="mx-auto max-w-3xl px-6 py-14">
        <div className="flex items-center gap-4">
          <ScrollText size={32} className="text-[#a364d9]" aria-hidden />
          <h1 className="font-display text-5xl leading-tight">Règlement</h1>
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
            Le règlement n’a pas encore été publié. Il le sera avant l’ouverture des
            inscriptions.
          </p>
        ) : (
          <>
            <p className="mt-8 text-sm text-[#8d89a8]">
              Version {rulebook.version}
              {rulebook.updatedAt && (
                <> · mise à jour le {new Date(rulebook.updatedAt).toLocaleDateString('fr-FR')}</>
              )}
            </p>
            <article className="mania-rules mt-8">
              <ReactMarkdown>{rulebook.markdown}</ReactMarkdown>
            </article>
          </>
        )}
      </div>

      {/* Mise en forme du markdown : les balises viennent de ReactMarkdown, on
          ne peut pas leur poser de classes une par une. */}
      <style>{`
        .mania-rules h2 {
          font-family: var(--font-bebas), system-ui, sans-serif;
          letter-spacing: .04em;
          font-size: 2rem;
          margin: 2.5rem 0 .75rem;
          color: #fff;
        }
        .mania-rules h3 {
          font-size: 1.15rem; font-weight: 600; margin: 1.75rem 0 .5rem; color: #fff;
        }
        .mania-rules p { margin: .85rem 0; line-height: 1.75; color: #c9c5d8; }
        .mania-rules ul { margin: .85rem 0; padding-left: 1.4rem; list-style: disc; }
        .mania-rules li { margin: .4rem 0; line-height: 1.7; color: #c9c5d8; }
        .mania-rules strong { color: #fff; }
        .mania-rules blockquote {
          border-left: 3px solid #FFB800;
          background: rgba(255,184,0,.08);
          padding: .75rem 1.25rem;
          margin: 1.25rem 0;
          color: #f2e6c8;
        }
        .mania-rules a { color: #00D936; text-decoration: underline; }
      `}</style>
    </main>
  );
}
