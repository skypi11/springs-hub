import Link from 'next/link';
import { Scale, Mail, Globe, Server } from 'lucide-react';
import { LEGAL_INFO } from '@/lib/legal-info';

export const metadata = {
  title: 'Mentions légales — Aedral',
  description: 'Mentions légales et informations sur l\'éditeur du site Aedral.',
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
            <LegalLine label="Éditeur" value={i.editorName} />
            <LegalLine label="Statut juridique" value={i.editorStatus} />
            <LegalLine label="Adresse" value={i.editorAddress} />
            {i.editorSiren && <LegalLine label="SIREN" value={i.editorSiren} />}
            {i.editorSiret && <LegalLine label="SIRET" value={i.editorSiret} />}
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
            Pour toute demande RGPD (accès, rectification, suppression), contactez l&apos;éditeur à cette adresse — réponse sous 30 jours maximum.
          </p>
        </section>

        {/* Site */}
        <section className="panel p-5 space-y-3">
          <div className="flex items-center gap-2">
            <Globe size={14} style={{ color: 'var(--s-text-dim)' }} />
            <span className="t-label">Site internet</span>
          </div>
          <dl className="text-sm space-y-1.5" style={{ color: 'var(--s-text)' }}>
            <LegalLine label="Nom du site" value={i.siteName} />
            <LegalLine label="URL" value={i.siteUrl} />
            <LegalLine label="Directeur de publication" value={i.editorName} />
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
            Le site Aedral, sa charte graphique, son code source et l&apos;ensemble de ses éléments distinctifs (logo, identité visuelle) sont la propriété exclusive de {i.editorName}.
          </p>
          <p className="text-sm" style={{ color: 'var(--s-text-dim)' }}>
            Les logos, marques et identités visuelles de Springs E-Sport (partenaire), Rocket League (Psyonix), Trackmania (Ubisoft/Nadeo), Discord, Epic Games et autres marques citées restent la propriété exclusive de leurs détenteurs respectifs. Leur usage sur le site relève du droit de citation et n&apos;implique aucun partenariat officiel hors mention explicite.
          </p>
          <p className="text-sm" style={{ color: 'var(--s-text-dim)' }}>
            Les contenus postés par les utilisateurs (bios, descriptions de structures, documents) demeurent la propriété de leurs auteurs, qui concèdent à l&apos;éditeur une licence non exclusive d&apos;affichage sur le site, strictement nécessaire au fonctionnement de la plateforme.
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
