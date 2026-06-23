// Télécharge les 23 icônes officielles de rang Rocket League haute résolution
// (1280×1280 ou 1381×1381 PNG) depuis l'album Imgur g6TKVzw et les convertit
// en WebP optimisé pour public/rl-ranks/.
//
// Source : album partagé par "Emberwyn" sur Imgur (https://imgur.com/a/g6TKVzw)
// Nommage français cohérent avec lib/rl-ranks.ts.
//
// Run : node scripts/download-rl-rank-icons.mjs

import sharp from 'sharp';
import { mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';

const OUT_DIR = 'public/rl-ranks';

// Mapping : nom de fichier FR (en kebab-case) → hash Imgur (image PNG haute résolution)
const ICONS = {
  'bronze-i':         'XMnLeHG',
  'bronze-ii':        'CuAySq7',
  'bronze-iii':       'R2e2HRc',
  'argent-i':         'UZIBQ7g',  // Silver 1
  'argent-ii':        'xh4wh5Q',  // Silver 2
  'argent-iii':       'eRZ53HZ',  // Silver 3
  'or-i':             '4XdJeM0',  // Gold 1
  'or-ii':            'HKIvQuP',  // Gold 2
  'or-iii':           'LCpWXqK',  // Gold 3
  'platine-i':        'hnzGXlp',  // Platinum 1
  'platine-ii':       'aRFs2zJ',  // Platinum 2
  'platine-iii':      'qPHznjQ',  // Platinum 3
  'diamant-i':        'SGxMHal',  // Diamond 1
  'diamant-ii':       'rwLfyXA',  // Diamond 2
  'diamant-iii':      'YsjuKPA',  // Diamond 3
  'champion-i':       'pNVm08Q',
  'champion-ii':      '7uAJRd8',
  'champion-iii':     'sJj9dmE',
  'grand-champion-i': 'uFP4FdQ',
  'grand-champion-ii':'veNxXoZ',
  'grand-champion-iii':'cuUzGgf',
  'ssl':              'h5oscwB',  // Supersonic Legend
  'unranked':         'KVtr3Ma',
};

if (!existsSync(OUT_DIR)) {
  await mkdir(OUT_DIR, { recursive: true });
}

let total = 0;
for (const [name, hash] of Object.entries(ICONS)) {
  const url = `https://i.imgur.com/${hash}.png`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Aedral asset downloader)' },
  });
  if (!res.ok) {
    console.error(`✗ ${name} (${hash}) → HTTP ${res.status}`);
    continue;
  }
  const buf = Buffer.from(await res.arrayBuffer());
  // Resize 512×512 + WebP 90 quality (équilibre taille/qualité, lossless garderait
  // les bordures nettes mais alourdit ~4x). 512 suffit largement pour l'affichage
  // sur un profil joueur (taille rendu max ~80px → upscale OK).
  const out = `${OUT_DIR}/${name}.webp`;
  await sharp(buf)
    .resize(512, 512, { fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 92, alphaQuality: 100 })
    .toFile(out);
  // Aussi version PNG pour les outils qui veulent du PNG (rare mais utile)
  const outPng = `${OUT_DIR}/${name}.png`;
  await sharp(buf)
    .resize(512, 512, { fit: 'inside', withoutEnlargement: true })
    .png({ compressionLevel: 9 })
    .toFile(outPng);
  console.log(`  ${name.padEnd(20)} ← ${hash}.png`);
  total++;
}
console.log(`\n${total} icônes RL téléchargées dans ${OUT_DIR}/.`);
