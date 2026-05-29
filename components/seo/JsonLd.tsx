import type { JsonLdObject } from '@/lib/jsonld';

// Composant server qui injecte du JSON-LD schema.org dans le DOM.
//
// Accepte un ou plusieurs schemas (builders de lib/jsonld.ts). Si plusieurs,
// ils sont combinés dans un `@graph` (pattern officiel schema.org pour
// regrouper plusieurs entités dans un seul <script>).
//
// Render : un <script type="application/ld+json"> avec le JSON sérialisé.
// `dangerouslySetInnerHTML` est requis ici — c'est la pratique standard pour
// JSON-LD et le contenu est généré côté serveur à partir de builders typés.

interface JsonLdProps {
  schemas: JsonLdObject[];
}

export default function JsonLd({ schemas }: JsonLdProps) {
  if (!schemas || schemas.length === 0) return null;

  // 1 schema seul → on l'émet directement. Plusieurs → on les regroupe dans
  // un @graph en réutilisant le contexte commun.
  const payload: JsonLdObject =
    schemas.length === 1
      ? schemas[0]
      : {
          '@context': 'https://schema.org',
          '@graph': schemas.map(({ '@context': _ctx, ...rest }) => rest),
        };

  return (
    <script
      type="application/ld+json"
      // eslint-disable-next-line react/no-danger
      dangerouslySetInnerHTML={{ __html: JSON.stringify(payload) }}
    />
  );
}
