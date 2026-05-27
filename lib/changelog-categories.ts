// Catégories pour la timeline du changelog public /changelog.
//
// Source de vérité unique : pour ajouter une catégorie, l'ajouter ici et
// elle apparaît automatiquement dans :
// - Le selector côté /admin/announce (création/édition de templates)
// - Les chips de filtre côté /changelog (timeline)
// - L'icône + couleur affichées sur chaque card de la timeline
//
// Sémantique :
// - feature  : nouvelle feature majeure, ajout de jeu, gros chantier
// - ux       : refonte design / UX / UI / accessibilité
// - tech     : refacto interne, perf, infra (peu user-facing mais montre que ça bouge)
// - fix      : bugs corrigés
// - security : privacy, sécurité, modération

export type ChangelogCategory = 'feature' | 'ux' | 'tech' | 'fix' | 'security';

export interface ChangelogCategoryDef {
  id: ChangelogCategory;
  label: string;
  /** Emoji affiché à côté du label (utilisé dans Discord embed + chips timeline) */
  emoji: string;
  /** Couleur principale (HEX) — détermine l'accent bar et tag */
  color: string;
  /** Variante RGB pour les rgba() (fonds, glows) */
  colorRgb: string;
  /** Description courte pour le selector admin */
  hint: string;
}

export const CHANGELOG_CATEGORIES: Record<ChangelogCategory, ChangelogCategoryDef> = {
  feature: {
    id: 'feature',
    label: 'Nouveauté',
    emoji: '🎯',
    color: '#FFB800', // or Aedral
    colorRgb: '255,184,0',
    hint: 'Ajout de jeu, nouvelle feature majeure, gros chantier visible',
  },
  ux: {
    id: 'ux',
    label: 'UX / Design',
    emoji: '🎨',
    color: '#a364d9', // violet (héritage)
    colorRgb: '163,100,217',
    hint: 'Refonte visuelle, amélioration UI/UX, accessibilité',
  },
  tech: {
    id: 'tech',
    label: 'Technique',
    emoji: '⚙️',
    color: '#7a7a95', // gris
    colorRgb: '122,122,149',
    hint: 'Refacto interne, perf, infra — peu user-facing mais bon à savoir',
  },
  fix: {
    id: 'fix',
    label: 'Bug fix',
    emoji: '🐛',
    color: '#33ff66', // vert
    colorRgb: '51,255,102',
    hint: 'Bugs corrigés',
  },
  security: {
    id: 'security',
    label: 'Sécurité',
    emoji: '🛡️',
    color: '#0081FF', // bleu
    colorRgb: '0,129,255',
    hint: 'Privacy, sécurité, modération',
  },
};

export const ALL_CHANGELOG_CATEGORIES: ChangelogCategoryDef[] = Object.values(CHANGELOG_CATEGORIES);

/** Vérifie si une string est une catégorie valide (type guard) */
export function isValidChangelogCategory(v: unknown): v is ChangelogCategory {
  return typeof v === 'string' && v in CHANGELOG_CATEGORIES;
}

/** Récupère la def d'une catégorie, fallback sur 'feature' si invalide (les vieux
 *  templates sans catégorie tombent en feature par défaut). */
export function getChangelogCategory(id: string | null | undefined): ChangelogCategoryDef {
  if (id && isValidChangelogCategory(id)) return CHANGELOG_CATEGORIES[id];
  return CHANGELOG_CATEGORIES.feature;
}
