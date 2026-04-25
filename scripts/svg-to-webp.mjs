import sharp from 'sharp';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join, basename } from 'node:path';

const SRC_DIR = 'public/aedral';

const files = (await readdir(SRC_DIR)).filter(f => f.endsWith('.svg'));

for (const file of files) {
  const svgBuf = await readFile(join(SRC_DIR, file));
  const svgText = svgBuf.toString();
  const viewBoxMatch = svgText.match(/viewBox="(\S+)\s+(\S+)\s+(\S+)\s+(\S+)"/);
  const [vbW, vbH] = viewBoxMatch ? [parseFloat(viewBoxMatch[3]), parseFloat(viewBoxMatch[4])] : [200, 200];

  const isHorizontal = vbW / vbH > 2;
  const targetW = isHorizontal ? 2048 : 1024;
  const targetH = Math.round(targetW * (vbH / vbW));

  const out = file.replace(/\.svg$/, '.webp');
  await sharp(svgBuf, { density: Math.round(300 * (targetW / vbW)) })
    .resize(targetW, targetH, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .webp({ quality: 95, lossless: false, alphaQuality: 100 })
    .toFile(join(SRC_DIR, out));

  console.log(`  ${file.padEnd(32)} → ${out.padEnd(32)} (${targetW}×${targetH})`);
}

console.log(`\n${files.length} fichiers convertis.`);
