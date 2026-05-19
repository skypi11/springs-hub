# Aedral — Brand assets

Logo SVG officiel Aedral, version V5 FINAL peaufinée (2026-04-25).
Source de référence : `C:\Users\mattm\Desktop\aedral-logo-final.html`
Spec complète : `C:\Users\mattm\Desktop\aedral-logo-spec.md`

## Fichiers disponibles

### Mark seul (symbole carré 200×200)
Pour favicon, avatar Discord, app icon, contexte où seul le symbole suffit.

| Fichier | Usage |
|---------|-------|
| `mark-primary-dark.svg` | A blanc `#EAEAF0` + E or `#FFB800` — sur fond sombre (site web mode dark) |
| `mark-primary-light.svg` | A ink `#08080F` + E or foncé `#C8941D` — sur fond clair (print, web light) |
| `mark-mono-noir.svg` | Tout en `#08080F` — impression N&B, gravure, fax |
| `mark-mono-blanc.svg` | Tout en `#EAEAF0` — sur photos sombres, vidéo, watermark |

### Lockup horizontal (mark + wordmark AEDRAL côte à côte, 700×200)
Pour header site, signature email, en-tête documents.

| Fichier | Usage |
|---------|-------|
| `lockup-horizontal-dark.svg` | Version sur fond sombre |
| `lockup-horizontal-light.svg` | Version sur fond clair |

### Wordmark seul (texte AEDRAL uniquement, 480×120)
Pour watermark vidéo, pied de page discret, intégrations partenaires.

| Fichier | Usage |
|---------|-------|
| `wordmark-dark.svg` | "AEDRAL" — AE or, DRAL crème sur fond sombre |
| `wordmark-light.svg` | "AEDRAL" — AE or foncé, DRAL noir sur fond clair |

## Palette officielle

```
Or chaud         #FFB800   E du mark + AE du wordmark (sur dark)
Or foncé         #C8941D   Variante sur fond clair
Texte clair      #EAEAF0   A du mark + DRAL du wordmark (sur dark)
Ink (noir)       #08080F   A du mark + DRAL du wordmark (sur light)
```

## Typographie wordmark

- **Police** : Bebas Neue (Google Fonts, gratuite)
- **Font-size** : 100 (en user units SVG)
- **Letter-spacing** : 18 (≈0.18em à 100px)
- **Cas** : UPPERCASE uniquement

⚠️ Les SVG wordmark/lockup utilisent `<text>` avec font-family="Bebas Neue". Pour rendu fidèle, la font doit être disponible :
- **Côté site Aedral** : OK, Bebas Neue est déjà chargée via `app/globals.css`
- **Standalone (Figma, Illustrator, print)** : ouvrir le SVG dans Inkscape/Illustrator puis "Object → Convert to Path" pour figer le texte en outlines
- **Fallback** : `Impact` (similaire condensed sans-serif)

## Utilisation dans le code Next.js

```tsx
import Image from 'next/image';

// Sidebar — lockup horizontal
<Image
  src="/aedral/lockup-horizontal-dark.svg"
  alt="Aedral"
  width={140}
  height={40}
  priority
/>

// Favicon — mark mono
<link rel="icon" href="/aedral/mark-mono-blanc.svg" type="image/svg+xml" />
```

## Versions PNG à venir

Quand validé, on génèrera :
- Favicon multi-resolution `.ico` (16/32/48)
- Apple touch icon 180×180
- PWA icons 192×192 + 512×512
- Open Graph 1200×630

## Anti-patterns à refuser

- ❌ Modifier les couleurs hors palette officielle
- ❌ Ajouter du glow/drop-shadow dans le mark exporté (réservé aux contextes web spécifiques)
- ❌ Utiliser une autre fonte que Bebas Neue pour le wordmark
- ❌ Étirer le logo (toujours préserver le ratio)
- ❌ Mettre le logo sur un fond qui réduit son contraste sous 4.5:1
