// Convertit "AE" + "DRAL" en path SVG via fontkit pour qu'on puisse
// embed la version path-only dans les SVG standalone du dossier
// public/aedral/. Comme ça plus de dépendance @import Bebas Neue qui
// ne marche pas dans Sharp (WebP gen) ou les viewers SVG offline.

import * as fontkit from 'fontkit';
import { writeFileSync } from 'node:fs';

const FONT_PATH = 'node_modules/@fontsource/bebas-neue/files/bebas-neue-latin-400-normal.woff2';
const font = fontkit.openSync(FONT_PATH);

console.log('Font loaded:', font.familyName, '·', font.subfamilyName);
console.log('UnitsPerEm:', font.unitsPerEm, '· ascent:', font.ascent, '· descent:', font.descent);

// On veut produire des paths pour 2 layouts :
//
//  1. Pour le lockup-horizontal (viewBox 820x200) :
//     - text x=270 y=100 font-size=110 letter-spacing=18 dominant-baseline=central
//     - "AE" en or (#FFB800 / #C8941D), "DRAL" en clair/sombre
//     - On veut paths absolus avec ces coordonnées finales
//
//  2. Pour le wordmark standalone (viewBox 480x120) :
//     - text x=240 y=92 font-size=100 letter-spacing=18 text-anchor=middle
//     - même split "AE" / "DRAL"

function layoutAedral(opts) {
  const { fontSize, letterSpacing, baselineY, startX } = opts;
  const scale = fontSize / font.unitsPerEm;

  let cursorX = startX;
  const result = [];

  for (const char of 'AEDRAL') {
    const glyph = font.glyphForCodePoint(char.charCodeAt(0));
    const advance = glyph.advanceWidth * scale;

    // Build glyph path with transform (translate + scale + flip Y)
    const path = glyph.path;
    // fontkit's path is in font units, Y up. We need Y down for SVG.
    // We translate to cursorX (left), scale by `scale`, flip Y, translate baseline.
    const transformed = path.scale(scale, -scale).translate(cursorX, baselineY);
    result.push({ char, pathData: transformed.toSVG(), advance });

    cursorX += advance + letterSpacing;
  }

  return result;
}

// Compute paths for lockup (820x200 viewBox)
const lockup = layoutAedral({
  fontSize: 110,
  letterSpacing: 18,
  baselineY: 138, // y=100 + cap-height/2 roughly (Bebas Neue cap-height ~71% of fontSize = 78)
  startX: 270,
});

// Compute paths for wordmark standalone (480x120 viewBox)
// text-anchor=middle x=240, so we need to compute total width first
const wmFontSize = 100;
const wmLetterSpacing = 18;
let totalWidth = 0;
for (const char of 'AEDRAL') {
  const glyph = font.glyphForCodePoint(char.charCodeAt(0));
  totalWidth += glyph.advanceWidth * (wmFontSize / font.unitsPerEm);
}
totalWidth += wmLetterSpacing * 5; // 5 gaps between 6 chars

const wmStartX = 240 - totalWidth / 2;
const wordmark = layoutAedral({
  fontSize: wmFontSize,
  letterSpacing: wmLetterSpacing,
  baselineY: 92,
  startX: wmStartX,
});

console.log('\n=== Lockup paths (820x200, baselineY=138) ===');
console.log('AE path:', lockup.slice(0, 2).map(g => g.pathData).join(' '));
console.log('DRAL path:', lockup.slice(2).map(g => g.pathData).join(' '));
console.log('Total advance:', lockup.reduce((s, g) => s + g.advance, 0) + 5 * 18);

console.log('\n=== Wordmark paths (480x120, baselineY=92, total width', totalWidth.toFixed(1), ') ===');
console.log('AE path:', wordmark.slice(0, 2).map(g => g.pathData).join(' '));
console.log('DRAL path:', wordmark.slice(2).map(g => g.pathData).join(' '));

// Save paths to JSON for the generator
const paths = {
  lockup: {
    ae: lockup.slice(0, 2).map(g => g.pathData).join(' '),
    dral: lockup.slice(2).map(g => g.pathData).join(' '),
  },
  wordmark: {
    ae: wordmark.slice(0, 2).map(g => g.pathData).join(' '),
    dral: wordmark.slice(2).map(g => g.pathData).join(' '),
  },
};

writeFileSync('scripts/aedral-paths.json', JSON.stringify(paths, null, 2), 'utf8');
console.log('\n→ scripts/aedral-paths.json écrit.');
