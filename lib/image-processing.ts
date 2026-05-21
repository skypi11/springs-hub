import sharp from 'sharp';

// Traite une image de profil / logo : carré 512×512, webp, qualité 85.
// Accepte jpeg/png/webp/gif en entrée, ressort webp ~50-200 KB.
export async function processSquareImage(
  input: Buffer,
  size = 512,
  quality = 85
): Promise<Buffer> {
  return await sharp(input, { failOn: 'error' })
    .rotate()  // applique l'orientation EXIF avant de stripper les metas
    .resize(size, size, {
      fit: 'cover',
      position: 'center',
      withoutEnlargement: false,
    })
    .webp({ quality, effort: 4 })
    .toBuffer();
}

// Traite une bannière : 1920×640 (ratio 3:1), webp, qualité 82.
// Volontairement plus haute que le cadre d'affichage (plus plat) : cette marge
// verticale permet de repositionner la bannière via `coverPositionY` sans
// re-uploader. Le "cover" recadre intelligemment si la source n'est pas au ratio.
export async function processBanner(
  input: Buffer,
  width = 1920,
  height = 640,
  quality = 82
): Promise<Buffer> {
  return await sharp(input, { failOn: 'error' })
    .rotate()
    .resize(width, height, {
      fit: 'cover',
      position: 'center',
      withoutEnlargement: false,
    })
    .webp({ quality, effort: 4 })
    .toBuffer();
}

// Vérifie qu'un buffer est bien une image valide décodable (anti-upload malveillant).
// Renvoie { width, height, format } si OK, null sinon.
export async function probeImage(
  input: Buffer
): Promise<{ width: number; height: number; format: string } | null> {
  try {
    const meta = await sharp(input).metadata();
    if (!meta.width || !meta.height || !meta.format) return null;
    return {
      width: meta.width,
      height: meta.height,
      format: meta.format,
    };
  } catch {
    return null;
  }
}
