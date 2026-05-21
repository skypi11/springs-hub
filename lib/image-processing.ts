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

// Traite une bannière : conserve le ratio source (AUCUN recadrage imposé),
// borne juste la largeur à 2000px et convertit en webp. Le cadrage final
// (zone visible) est choisi par l'utilisateur via l'éditeur de cadrage et
// appliqué à l'affichage en CSS — l'image stockée reste la bannière complète.
export async function processBanner(
  input: Buffer,
  maxWidth = 2000,
  quality = 82
): Promise<Buffer> {
  return await sharp(input, { failOn: 'error' })
    .rotate()
    .resize(maxWidth, null, {
      fit: 'inside',
      withoutEnlargement: true,
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
