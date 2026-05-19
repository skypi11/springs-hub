# Aedral — Brand assets

Logo SVG officiel Aedral, version V5 FINAL peaufinée (2026-04-25) avec
affinage des proportions du E (2026-05-19) pour mieux matcher Bebas Neue.

Source de référence : `C:\Users\mattm\Desktop\aedral-logo-final.html`
Spec complète : `C:\Users\mattm\Desktop\aedral-logo-spec.md`

## Fichiers disponibles

### Mark seul (symbole carré 200×200)
Pour favicon, avatar Discord, app icon, contexte où seul le symbole suffit.

| Fichier | Usage |
|---------|-------|
| `mark.svg` | A blanc `#EAEAF0` + E or `#FFB800` — sur fond sombre (site web mode dark) |
| `mark-light.svg` | A ink `#08080F` + E or foncé `#C8941D` — sur fond clair (print, web light) |
| `mark-mono-dark.svg` | Tout en `#08080F` — impression N&B, gravure, fax |
| `mark-mono-light.svg` | Tout en `#EAEAF0` — sur photos sombres, vidéo, watermark |

### Lockup horizontal (mark + wordmark AEDRAL côte à côte, 820×200)
Pour header site, signature email, en-tête documents.

| Fichier | Usage |
|---------|-------|
| `logo-horizontal.svg` | Version sur fond sombre |
| `logo-horizontal-light.svg` | Version sur fond clair |

### Wordmark seul (texte AEDRAL uniquement, 480×120)
Pour watermark vidéo, pied de page discret, intégrations partenaires.

| Fichier | Usage |
|---------|-------|
| `wordmark.svg` | "AEDRAL" — AE or, DRAL crème sur fond sombre |
| `wordmark-light.svg` | "AEDRAL" — AE or foncé, DRAL noir sur fond clair |

### Versions .webp
Les `.webp` sont générés automatiquement depuis les `.svg` par
`scripts/svg-to-webp.mjs` :
- Mark : 1024×1024
- Lockup horizontal : 2048×500
- Wordmark : 2048×512

Régénérer après update SVG : `node scripts/svg-to-webp.mjs`

## Composant React

Pour usage dans le code Next.js, **ne pas charger les SVGs en `<img>`** —
utiliser le composant inline `<AedralLogo>` dans `components/brand/AedralLogo.tsx` :

```tsx
import AedralLogo from '@/components/brand/AedralLogo';

// Lockup horizontal (défaut)
<AedralLogo variant="horizontal" theme="dark" height={48} />

// Mark seul
<AedralLogo variant="mark" theme="dark" height={40} />

// 4 thèmes disponibles : dark | light | mono-dark | mono-light
```

Le composant utilise les **mêmes coordonnées SVG** que les fichiers
standalone — source de vérité unique de la géométrie.

## Palette officielle

```
Or chaud         #FFB800   E du mark + AE du wordmark (sur dark)
Or foncé         #C8941D   Variante sur fond clair
Texte clair      #EAEAF0   A du mark + DRAL du wordmark (sur dark)
Ink (noir)       #08080F   A du mark + DRAL du wordmark (sur light)
```

## Géométrie du mark (viewBox 200×200)

- **A jambe gauche** : path triangulaire `M 98 10 L 30 190 L 16 190 Z`
- **A jambe droite** : path triangulaire `M 102 10 L 184 190 L 170 190 Z`
- **E** : path unifié 48×60, stem 7px, barres haut/bas 6px, barre milieu 5px
  - Path : `M 76 120 L 124 120 L 124 126 L 83 126 L 83 147 L 119 147 L 119 152 L 83 152 L 83 174 L 124 174 L 124 180 L 76 180 Z`
  - Unifié en un seul path (pas 4 rectangles) → pas de hairline antialiasing
  - Traits affinés pour matcher la légèreté typographique de Bebas Neue

## Typographie wordmark

- **Police** : Bebas Neue (Google Fonts, gratuite)
- **Font-size** : 110 dans le lockup, 100 dans le wordmark standalone
- **Letter-spacing** : 18 (≈0.18em à 100px)
- **Cas** : UPPERCASE uniquement

Les SVG lockup/wordmark embarquent un `@import url(...)` Google Fonts dans
un `<style>` interne pour que Bebas Neue charge même en standalone. Pour
print/Figma/Illustrator, ouvrir et convertir le texte en outlines.

## Anti-patterns à refuser

- ❌ Modifier les couleurs hors palette officielle
- ❌ Ajouter du glow/drop-shadow dans le mark exporté (réservé aux contextes web spécifiques)
- ❌ Utiliser une autre fonte que Bebas Neue pour le wordmark
- ❌ Étirer le logo (toujours préserver le ratio)
- ❌ Mettre le logo sur un fond qui réduit son contraste sous 4.5:1
- ❌ Charger les SVG via `<img>` dans le code site → utiliser `<AedralLogo>` (le composant React préserve la cohérence et permet le theming dynamique)
