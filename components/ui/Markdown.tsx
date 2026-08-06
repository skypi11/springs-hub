'use client';

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

/**
 * Rendu markdown du site — le SEUL point d'entrée.
 *
 * `react-markdown` s'en tient au markdown d'origine : sans `remark-gfm`, ni les
 * tableaux, ni le texte barré, ni les liens automatiques ne sont interprétés.
 * Le règlement de la Mania Cup en a fait les frais : son registre RGPD, écrit
 * en tableau, s'affichait comme une longue ligne de barres verticales — dans la
 * section la plus juridique du document.
 *
 * Ce composant existe pour que la question ne se repose jamais : chaque endroit
 * qui rendait `<ReactMarkdown>` directement devait penser au plugin, et aucun
 * des six ne le faisait. L'aperçu de la console mentait donc lui aussi à
 * l'organisation pendant qu'elle rédigeait.
 */
export default function Markdown({ children }: { children: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        // Un tableau est le seul contenu qui peut être plus large que la
        // colonne de texte. Il défile dans son propre cadre : sans ça, c'est la
        // PAGE qui part en travers sur un téléphone, ce qu'on ne veut nulle part
        // sur le site.
        table: ({ children: cells }) => <div className="md-table">{<table>{cells}</table>}</div>,
      }}
    >
      {children}
    </ReactMarkdown>
  );
}
