// Génère les PNG dérivés depuis les SVG officiels Aedral :
//   - app/apple-icon.png         (180×180) iOS home screen
//   - app/opengraph-image.png    (1200×630) partages sociaux
//   - public/icon-192.png        (192×192) PWA Android
//   - public/icon-512.png        (512×512) PWA Android haute résolution
//
// Sources : app/icon.svg (favicon avec coins arrondis) + public/aedral/logo-horizontal.svg
// Run : node scripts/generate-png-derivatives.mjs

import sharp from 'sharp';
import { readFileSync } from 'node:fs';

const BG_DARK = { r: 8, g: 8, b: 15, alpha: 1 }; // #08080F (matche le site)

// ── App icons (avec coins arrondis, source app/icon.svg) ─────────────────
const iconSvg = readFileSync('app/icon.svg');

async function renderIcon(size, outputPath) {
  // density élevée pour rendu vectoriel propre
  await sharp(iconSvg, { density: Math.max(72, size * 8) })
    .resize(size, size, { fit: 'contain', background: BG_DARK })
    .png({ compressionLevel: 9 })
    .toFile(outputPath);
  console.log(`  ${outputPath.padEnd(35)} (${size}×${size})`);
}

await renderIcon(180, 'app/apple-icon.png');
await renderIcon(192, 'public/icon-192.png');
await renderIcon(512, 'public/icon-512.png');

// ── Open Graph image 1200×630 (dark bg + lockup centré) ──────────────────
const lockupSvg = readFileSync('public/aedral/logo-horizontal.svg');

// Lockup target : 800×195 (preserve ratio 820/200 = 4.1)
const LOCKUP_W = 800;
const LOCKUP_H = Math.round(LOCKUP_W * (200 / 820));

const lockupBuf = await sharp(lockupSvg, { density: 600 })
  .resize(LOCKUP_W, LOCKUP_H, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
  .png()
  .toBuffer();

const OG_W = 1200;
const OG_H = 630;

await sharp({
  create: {
    width: OG_W,
    height: OG_H,
    channels: 4,
    background: BG_DARK,
  },
})
  .composite([
    {
      input: lockupBuf,
      top: Math.round((OG_H - LOCKUP_H) / 2),
      left: Math.round((OG_W - LOCKUP_W) / 2),
    },
  ])
  .png({ compressionLevel: 9 })
  .toFile('app/opengraph-image.png');

console.log(`  app/opengraph-image.png             (${OG_W}×${OG_H})`);
console.log('\nDone.');
