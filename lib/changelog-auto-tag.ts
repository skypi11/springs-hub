// Parser auto pour les patch notes Discord/changelog.
//
// Convention de rédaction (déjà utilisée par Matt sur les templates existantes) :
//   **🎯 Titre de la section**
//   Body markdown libre…
//
//   **🐛 Bug fix**
//   - …
//
// Ce module détecte ces sections, les découpe en `ChangelogSection[]`, et
// classe chaque section par emoji → catégorie. Évite à Matt de devoir
// manuellement choisir une catégorie ou taguer chaque patch.

import type { ChangelogCategory } from './changelog-categories';

// Mapping emoji → catégorie. Emojis non listés → tombe sur 'feature' (default).
// Couvre les emojis les plus utilisés par Matt dans ses patch notes historiques.
const EMOJI_TO_CATEGORY: Record<string, ChangelogCategory> = {
  // 🎯 Nouveauté
  '🎯': 'feature', '🆕': 'feature', '🚀': 'feature', '🎮': 'feature',
  '🏆': 'feature', '⭐': 'feature', '🎊': 'feature', '🌟': 'feature',
  '📨': 'feature', '👤': 'feature', '🎬': 'feature', '📅': 'feature',
  '📢': 'feature', '🏟️': 'feature',
  // 🎨 UX / Design
  '🎨': 'ux', '✨': 'ux', '💎': 'ux', '🖼️': 'ux', '📐': 'ux', '🌈': 'ux',
  // ⚙️ Technique
  '⚙️': 'tech', '🔧': 'tech', '🏗️': 'tech', '🛠️': 'tech',
  '💻': 'tech', '📦': 'tech', '🤖': 'tech',
  // 🐛 Bug fix
  '🐛': 'fix', '🩹': 'fix', '🔨': 'fix',
  // 🛡️ Sécurité
  '🛡️': 'security', '🔒': 'security', '🔐': 'security', '⚠️': 'security',
};

export interface ChangelogSection {
  /** Emoji détecté en début de titre (utilisé pour mapping catégorie). Fallback : '' */
  emoji: string;
  /** Titre nettoyé (sans l'emoji + les `**`). Ex: "Valorant officiellement intégré, end-to-end" */
  title: string;
  /** Body markdown brut de la section (sans le titre, sans wrap). */
  body: string;
  /** Catégorie déduite de l'emoji (fallback 'feature'). */
  category: ChangelogCategory;
}

// Regex qui matche un titre de section Discord-style : ligne commençant
// par `**` puis un emoji optionnel, puis du texte, puis `**`. Le `\b` ne
// marche pas avec les emojis donc on cherche manuellement.
//
// Pattern : début de ligne (^ ou après \n), `**`, contenu (capture), `**`,
// fin de ligne. Multi-line donc on traite la string entière.
const SECTION_TITLE_RE = /^[ \t]*\*\*(.+?)\*\*[ \t]*$/gm;

// Extrait l'emoji (1-3 caractères Unicode) du début d'un titre nettoyé.
// Le ZWJ (U+200D) et les sélecteurs de variante (FE0F) sont gérés en
// laissant les chars suivants se concaténer naturellement.
function extractLeadingEmoji(title: string): { emoji: string; rest: string } {
  const trimmed = title.trim();
  if (!trimmed) return { emoji: '', rest: '' };
  // On utilise Intl.Segmenter pour découper proprement (grapheme cluster)
  // — gère les emoji composés (🏗️, 🛠️, etc.) correctement.
  try {
    const segmenter = new Intl.Segmenter('fr', { granularity: 'grapheme' });
    const segments = Array.from(segmenter.segment(trimmed));
    if (segments.length === 0) return { emoji: '', rest: trimmed };
    const first = segments[0].segment;
    // Considère comme emoji si pas une lettre/chiffre/ponctuation ASCII
    // (heuristique simple : codePoint > 127 ou char de présentation emoji)
    const cp = first.codePointAt(0) ?? 0;
    if (cp > 127) {
      const rest = segments.slice(1).map(s => s.segment).join('').trim();
      return { emoji: first, rest };
    }
    return { emoji: '', rest: trimmed };
  } catch {
    // Fallback navigateur sans Intl.Segmenter : on prend les 2 premiers chars
    // (large pour couvrir les emoji avec sélecteur de variante FE0F).
    return { emoji: trimmed.slice(0, 2), rest: trimmed.slice(2).trim() };
  }
}

/**
 * Découpe une description markdown en sections détectées via les titres
 * `**...**`. Chaque section a son emoji, titre, body et catégorie auto-classée.
 *
 * Si aucune section n'est détectée (ex: patch ultra court sans structure),
 * retourne 1 section unique avec tout le markdown comme body et category='feature'.
 */
export function parseChangelogSections(description: string): ChangelogSection[] {
  if (!description.trim()) return [];

  const text = description.trim();
  const sections: ChangelogSection[] = [];

  // Collecte les indices des titres de sections
  const matches: { fullMatch: string; titleRaw: string; start: number; end: number }[] = [];
  SECTION_TITLE_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = SECTION_TITLE_RE.exec(text)) !== null) {
    matches.push({
      fullMatch: m[0],
      titleRaw: m[1],
      start: m.index,
      end: m.index + m[0].length,
    });
  }

  // Aucun titre détecté → 1 section unique avec tout
  if (matches.length === 0) {
    return [{
      emoji: '',
      title: '',
      body: text,
      category: 'feature',
    }];
  }

  // Si le texte commence par autre chose qu'un titre, on a un préambule
  // (texte avant la 1re section). On l'ajoute en section "intro" sans titre.
  if (matches[0].start > 0) {
    const intro = text.slice(0, matches[0].start).trim();
    if (intro) {
      sections.push({
        emoji: '',
        title: '',
        body: intro,
        category: 'feature',
      });
    }
  }

  // Pour chaque section, body = texte entre la fin du titre courant et le
  // début du titre suivant (ou fin du texte).
  for (let i = 0; i < matches.length; i++) {
    const cur = matches[i];
    const nextStart = i + 1 < matches.length ? matches[i + 1].start : text.length;
    const body = text.slice(cur.end, nextStart).trim();
    const { emoji, rest } = extractLeadingEmoji(cur.titleRaw);
    const category = (emoji && EMOJI_TO_CATEGORY[emoji]) || 'feature';
    sections.push({
      emoji,
      title: rest || cur.titleRaw.trim(), // si pas d'emoji détecté, on garde le titre brut
      body,
      category,
    });
  }

  return sections;
}

/**
 * Renvoie le set unique des catégories présentes dans une liste de sections.
 * Utile pour les chips de catégorie sur la card timeline.
 */
export function categoriesInSections(sections: ChangelogSection[]): ChangelogCategory[] {
  const set = new Set<ChangelogCategory>();
  for (const s of sections) set.add(s.category);
  return Array.from(set);
}

/**
 * Détecte la catégorie dominante (la plus fréquente) — utile pour la couleur
 * principale de la card timeline.
 */
export function dominantCategory(sections: ChangelogSection[]): ChangelogCategory {
  if (sections.length === 0) return 'feature';
  const counts: Record<string, number> = {};
  for (const s of sections) counts[s.category] = (counts[s.category] ?? 0) + 1;
  let max = 0;
  let best: ChangelogCategory = 'feature';
  for (const [cat, n] of Object.entries(counts)) {
    if (n > max) {
      max = n;
      best = cat as ChangelogCategory;
    }
  }
  return best;
}
