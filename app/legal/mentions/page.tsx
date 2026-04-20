import Link from 'next/link';
import { Scale, Mail, Globe, Server } from 'lucide-react';
import { LEGAL_INFO } from '@/lib/legal-info';

export const metadata = {
  title: 'Mentions légales — Springs Hub',
  description: 'Mentions légales et informations sur l\'éditeur du site Springs Hub.',
};

export default function MentionsLegalesPage() {
  const i = LEGAL_INFO;

  return (
    <div className="min-h-screen px-6 md:px-8 py-8">
      <div className="max-w-3xl mx-auto space-y-6 animate-fade-in">

        <div className="flex items-center gap-3">
          <Scale size={20} style={{ color: 'var(--s-violet-light)' }} />
          <h1 className="font-display text-2xl" style={{ letterSpacing: '0.04em' }}>
            MENTIONS LÉGALES
          </h1>
        </div>

        <p className="text-xs" style={{ color: 'var(--s-text-muted)' }}>
          Dernière mise à jour : {i.lastUpdated}
        </p>

        {/* Éditeur */}
        <section className="panel p-5 space-y-3">
          <div className="flex items-center gap-2">
            <Scale size={14} style={{ color: 'var(--s-text-dim)' }} />
            <span className="t-label">Éditeur du site</span>
          </div>
          <dl className="text-sm space-y-1.5" style={{ color: 'var(--s-text)' }}>
            <LegalLine label="Dénomination" value={i.associationName} />
            <LegalLine label="Statut juridique" value={i.associationType} />
            <LegalLine label="Numéro RNA" value={i.associationRNA} />
            {i.associationSiren && <LegalLine label="SIREN" value={i.associationSiren} />}
            {i.associationSiret && <LegalLine label="SIRET" value={i.associationSiret} />}
            <LegalLine label="Déclarée le" value={`${i.associationDeclarationDate} — ${i.associationDeclarationPrefecture}`} />
            <LegalLine label="Siège social" value={i.associationAddress} />
            <LegalLine label="Représentant légal" value={`${i.representativeName} (${i.representativeRole})`} />
          </dl>
        </section>

        {/* Contact */}
        <section className="panel p-5 space-y-3">
          <div className="flex items-center gap-2">
            <Mail size={14} style={{ color: 'var(--s-text-dim)' }} />
            <span className="t-label">Contact</span>
          </div>
          <dl className="text-sm space-y-1.5" style={{ color: 'var(--s-text)' }}>
            <LegalLine label="Email" value={<a href={`mailto:${i.contactEmail}`} style={{ color: 'var(--s-violet-light)' }}>{i.contactEmail}</a>} />
            {i.contactPhone && <LegalLine label="Téléphone" value={i.contactPhone} />}
          </dl>
          <p className="text-xs" style={{ color: 'var(--s-text-muted)' }}>
            Pour toute demande RGPD (accès, rectification, suppression), contactez-nous à cette adresse — réponse sous 30 jours maximum.
          </p>
        </section>

        {/* Site */}
        <section className="panel p-5 space-y-3">
          <div className="flex items-center gap-2">
            <Globe size={14} style={{ color: 'var(--s-text-dim)' }} />
            <span className="t-label">Site internet</span>
          </div>
          <dl className="text-sm space-y-1.5" style={{ color: 'var(--s-text)' }}>
            <LegalLine label="URL" value={i.siteUrl} />
            <LegalLine label="Directeur de publication" value={i.representativeName} />
          </dl>
        </section>

        {/* Hébergeur */}
        <section className="panel p-5 space-y-3">
          <div className="flex items-center gap-2">
            <Server size={14} style={{ color: 'var(--s-text-dim)' }} />
            <span className="t-label">Hébergement</span>
          </div>
          <dl className="text-sm space-y-1.5" style={{ color: 'var(--s-text)' }}>
            <LegalLine label="Hébergeur" value={i.hosterName} />
            <LegalLine label="Adresse" value={i.hosterAddress} />
            <LegalLine label="Site" value={<a href={i.hosterUrl} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--s-violet-light)' }}>{i.hosterUrl}</a>} />
          </dl>

          <div className="divider" />

          <p className="text-xs" style={{ color: 'var(--s-text-dim)' }}>
            Le site s&apos;appuie également sur les services suivants pour le stockage, l&apos;authentification et la supervision technique :
          </p>
          <ul className="text-xs space-y-1 pl-4" style={{ color: 'var(--s-text-dim)', listStyle: 'disc' }}>
            {i.infraProviders.map(p => (
              <li key={p.name}>
                <span style={{ color: 'var(--s-text)' }}>{p.name}</span> — {p.purpose} ({p.location}).
              </li>
            ))}
          </ul>
        </section>

        {/* Propriété intellectuelle */}
        <section className="panel p-5 space-y-3">
          <span className="t-label">Propriété intellectuelle</span>
          <p className="text-sm" style={{ color: 'var(--s-text-dim)' }}>
            Le site, sa charte graphique, son code source et l&apos;ensemble de ses éléments distinctifs (logos, identités visuelles Springs E-Sport) sont la propriété de l&apos;association {i.associationName}.
          </p>
          <p className="text-sm" style={{ color: 'var(--s-text-dim)' }}>
            Les logos, marques et identités visuelles de Rocket League (Psyonix), Trackmania (Ubisoft/Nadeo), Discord, Epic Games et autres marques citées restent la propriété exclusive de leurs détenteurs respectifs. Leur usage sur le site relève du droit de citation et n&apos;implique aucun partenariat officiel.
          </p>
          <p className="text-sm" style={{ color: 'var(--s-text-dim)' }}>
            Les contenus postés par les utilisateurs (bios, descriptions de structures, documents) demeurent la propriété de leurs auteurs, qui concèdent à Springs E-Sport une licence non exclusive d&apos;affichage sur le site, strictement nécessaire au fonctionnement de la plateforme.
          </p>
        </section>

        {/* Signalement */}
        <section className="panel p-5 space-y-3">
          <span className="t-label">Signalement de contenu</span>
          <p className="text-sm" style={{ color: 'var(--s-text-dim)' }}>
            Conformément à la loi pour la confiance dans l&apos;économie numérique (LCEN), tout contenu manifestement illicite peut être signalé à l&apos;adresse <a href={`mailto:${i.contactEmail}`} style={{ color: 'var(--s-violet-light)' }}>{i.contactEmail}</a>. Les signalements sont traités dans les meilleurs délais et les contenus illicites retirés sans préavis.
          </p>
        </section>

        <div className="panel p-4 flex items-center justify-between flex-wrap gap-3">
          <span className="text-xs" style={{ color: 'var(--s-text-muted)' }}>
            Voir aussi notre politique de confidentialité.
          </span>
          <Link href="/legal/confidentialite" className="text-xs" style={{ color: 'var(--s-violet-light)' }}>
            Politique de confidentialité →
          </Link>
        </div>

      </div>
    </div>
  );
}

function LegalLine({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[140px_1fr] gap-3">
      <dt className="text-xs" style={{ color: 'var(--s-text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
        {label}
      </dt>
      <dd className="text-sm">{value}</dd>
    </div>
  );
}
