import TiltImage from '@/components/ui/TiltImage';

/**
 * Capture du Guide : wrapper de layout (colonne droite ~460px, side-by-side
 * avec le texte) autour de TiltImage (tilt 3D souris + lightbox), la source de
 * vérité partagée avec la landing.
 */
export default function GuideImage({ src, alt, width, height }: {
  src: string;
  alt: string;
  width: number;
  height: number;
}) {
  return (
    <div className="w-full max-w-xl lg:w-[460px] lg:flex-shrink-0 self-start">
      <TiltImage
        src={src}
        alt={alt}
        width={width}
        height={height}
        sizes="(max-width: 1024px) 100vw, 460px"
      />
    </div>
  );
}
