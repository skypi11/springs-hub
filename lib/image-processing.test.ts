import { describe, it, expect, beforeAll } from 'vitest';
import sharp from 'sharp';
import { processSquareImage, processBanner, probeImage } from './image-processing';

// Génère une image PNG de test (rectangle rouge) avec dimensions configurables
async function makeTestPng(width: number, height: number): Promise<Buffer> {
  return await sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 200, g: 50, b: 50 },
    },
  })
    .png()
    .toBuffer();
}

describe('processSquareImage', () => {
  let sourcePng: Buffer;

  beforeAll(async () => {
    sourcePng = await makeTestPng(1024, 768);  // pas carré au départ
  });

  it('sort un webp carré à la taille demandée', async () => {
    const out = await processSquareImage(sourcePng, 512);
    const meta = await sharp(out).metadata();
    expect(meta.format).toBe('webp');
    expect(meta.width).toBe(512);
    expect(meta.height).toBe(512);
  });

  it('compresse effectivement (webp plus petit que png source)', async () => {
    const out = await processSquareImage(sourcePng, 512);
    expect(out.byteLength).toBeLessThan(sourcePng.byteLength);
  });

  it('accepte une taille custom', async () => {
    const out = await processSquareImage(sourcePng, 256);
    const meta = await sharp(out).metadata();
    expect(meta.width).toBe(256);
    expect(meta.height).toBe(256);
  });

  it('fonctionne sur une image source déjà petite (upscale accepté)', async () => {
    const small = await makeTestPng(200, 200);
    const out = await processSquareImage(small, 512);
    const meta = await sharp(out).metadata();
    expect(meta.width).toBe(512);
    expect(meta.height).toBe(512);
  });
});

describe('processBanner', () => {
  it('sort un webp au ratio 4:1 par défaut', async () => {
    const src = await makeTestPng(3000, 1500);
    const out = await processBanner(src);
    const meta = await sharp(out).metadata();
    expect(meta.format).toBe('webp');
    expect(meta.width).toBe(1920);
    expect(meta.height).toBe(480);
  });

  it('accepte des dimensions custom', async () => {
    const src = await makeTestPng(1000, 1000);
    const out = await processBanner(src, 800, 200);
    const meta = await sharp(out).metadata();
    expect(meta.width).toBe(800);
    expect(meta.height).toBe(200);
  });
});

describe('probeImage', () => {
  it('renvoie width/height/format pour une image valide', async () => {
    const src = await makeTestPng(640, 480);
    const probe = await probeImage(src);
    expect(probe).not.toBeNull();
    expect(probe!.width).toBe(640);
    expect(probe!.height).toBe(480);
    expect(probe!.format).toBe('png');
  });

  it('renvoie null pour un buffer qui n\'est pas une image', async () => {
    const garbage = Buffer.from('this is not an image, just random text data');
    const probe = await probeImage(garbage);
    expect(probe).toBeNull();
  });
});
