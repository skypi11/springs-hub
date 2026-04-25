import Link from 'next/link';
import { Shield, Database, Clock, UserCheck, Download, Trash2, Mail, Globe } from 'lucide-react';
import { LEGAL_INFO } from '@/lib/legal-info';

export const metadata = {
  title: 'Politique de confidentialité — Aedral',
  description: 'Politique de confidentialité d\'Aedral : données collectées, durées de conservation, droits RGPD.',
};

export default function ConfidentialitePage() {
  const i = LEGAL_INFO;

  return (
    <div className="min-h-screen px-6 md:px-8 py-8">
      <div className="max-w-3xl mx-auto space-y-6 animate-fade-in">

        <div className="flex items-center gap-3">
          <Shield size={20} style={{ color: 'var(--s-violet-light)' }} />
          <h1 className="font-display text-2xl" style={{ letterSpacing: '0.04em' }}>
            POLITIQUE DE CONFIDENTIALITÉ
          </h1>
        </div>

        <p className="text-xs" style={{ color: 'var(--s-text-muted)' }}>
          Dernière mise à jour : {i.lastUpdated}
        </p>

        <div className="panel p-5">
          <p className="text-sm" style={{ color: 'var(--s-text-dim)' }}>
            Aedral est une plateforme communautaire esport éditée par <strong style={{ color: 'var(--s-text)' }}>{i.editorName}</strong> en nom propre. Cette page décrit <strong style={{ color: 'var(--s-text)' }}>quelles données nous collectons, pourquoi, combien de temps nous les gardons</strong>, et les droits dont vous disposez en tant qu&apos;utilisateur conformément au RGPD (Règlement européen 2016/679).
          </p>
        </div>

        {/* Responsable */}
        <Section icon={<UserCheck size={14} />} title="Responsable de traitement">
          <p className="text-sm" style={{ color: 'var(--s-text-dim)' }}>
            Le responsable de traitement des données collectées est <strong style={{ color: 'var(--s-text)' }}>{i.editorName}</strong> ({i.editorStatus}), éditeur du site Aedral.
          </p>
          <p className="text-sm" style={{ color: 'var(--s-text-dim)' }}>
            Pour toute demande liée à vos données personnelles, contactez : <a href={`mailto:${i.contactEmail}`} style={{ color: 'var(--s-violet-light)' }}>{i.contactEmail}</a>.
          </p>
        </Section>

        {/* Données collectées */}
        <Section icon={<Database size={14} />} title="Données collectées">
          <p className="text-sm" style={{ color: 'var(--s-text-dim)' }}>
            Nous collectons uniquement les données nécessaires au fonctionnement du site.
          </p>

          <SubBlock title="À la connexion via Discord">
            <ul className="text-sm space-y-1 pl-4" style={{ color: 'var(--s-text-dim)', listStyle: 'disc' }}>
              <li>Identifiant Discord (snowflake), pseudo Discord, avatar</li>
              <li>Scope demandé : <code className="t-mono" style={{ color: 'var(--s-text)' }}>identify</code> uniquement (aucun accès aux serveurs, messages privés ou email Discord)</li>
            </ul>
            <p className="text-xs mt-2" style={{ color: 'var(--s-text-muted)' }}>
              Votre mot de passe Discord et votre 2FA ne sont jamais vus par Aedral : la validation se fait sur <code className="t-mono">discord.com</code>.
            </p>
          </SubBlock>

          <SubBlock title="Profil utilisateur (renseigné librement)">
            <ul className="text-sm space-y-1 pl-4" style={{ color: 'var(--s-text-dim)', listStyle: 'disc' }}>
              <li>Pseudo affiché, pays, date de naissance (seul l&apos;âge calculé est public)</li>
              <li>Bio, jeux pratiqués, disponibilité pour recrutement</li>
              <li>Pseudos en jeu : Epic Games / Rocket League, Ubisoft/Nadeo / Trackmania</li>
              <li>Avatar et bannière (uploadés volontairement)</li>
            </ul>
          </SubBlock>

          <SubBlock title="Activité sur le site">
            <ul className="text-sm space-y-1 pl-4" style={{ color: 'var(--s-text-dim)', listStyle: 'disc' }}>
              <li>Appartenance à une structure et à une équipe, rôles attribués</li>
              <li>Événements créés (entraînements, scrims), devoirs, documents déposés</li>
              <li>Notifications reçues, invitations envoyées ou reçues</li>
              <li>Actions critiques tracées dans un journal d&apos;audit (invitations, transferts, modérations)</li>
            </ul>
          </SubBlock>

          <SubBlock title="Données techniques">
            <ul className="text-sm space-y-1 pl-4" style={{ color: 'var(--s-text-dim)', listStyle: 'disc' }}>
              <li>Adresse IP (utilisée uniquement pour le rate limiting anti-abus, jamais exposée publiquement)</li>
              <li>Informations d&apos;erreurs techniques (via Sentry) : navigateur, stack trace — <strong>pas d&apos;IP ni de contenu personnel</strong></li>
            </ul>
          </SubBlock>

          <div className="p-3 text-xs" style={{ background: 'rgba(0,217,54,0.06)', border: '1px solid rgba(0,217,54,0.25)' }}>
            <strong style={{ color: '#33ff66' }}>Pas de cookies publicitaires.</strong> Aucun tracker Google Analytics, Meta Pixel, ou équivalent. Seul un cookie de session strictement technique est utilisé pour maintenir votre connexion.
          </div>
        </Section>

        {/* Finalités */}
        <Section icon={<Globe size={14} />} title="Finalités du traitement">
          <ul className="text-sm space-y-2 pl-4" style={{ color: 'var(--s-text-dim)', listStyle: 'disc' }}>
            <li><strong style={{ color: 'var(--s-text)' }}>Fonctionnement du site</strong> : permettre la connexion, la gestion des structures, les inscriptions aux compétitions.</li>
            <li><strong style={{ color: 'var(--s-text)' }}>Sécurité</strong> : détecter les abus, bannir les comportements malveillants, auditer les actions sensibles.</li>
            <li><strong style={{ color: 'var(--s-text)' }}>Communication communautaire</strong> : afficher les profils publics, annuaires, classements.</li>
            <li><strong style={{ color: 'var(--s-text)' }}>Amélioration technique</strong> : monitoring d&apos;erreurs anonymisé via Sentry.</li>
          </ul>
          <p className="text-sm" style={{ color: 'var(--s-text-dim)' }}>
            <strong style={{ color: 'var(--s-text)' }}>Aucune donnée n&apos;est vendue ni partagée avec des tiers commerciaux.</strong>
          </p>
        </Section>

        {/* Base légale */}
        <Section icon={<Shield size={14} />} title="Base légale">
          <ul className="text-sm space-y-2 pl-4" style={{ color: 'var(--s-text-dim)', listStyle: 'disc' }}>
            <li><strong style={{ color: 'var(--s-text)' }}>Exécution du service</strong> (art. 6.1.b RGPD) : la majeure partie des données est nécessaire pour que le site fonctionne.</li>
            <li><strong style={{ color: 'var(--s-text)' }}>Intérêt légitime</strong> (art. 6.1.f RGPD) : logs techniques, rate limiting, audit de sécurité.</li>
            <li><strong style={{ color: 'var(--s-text)' }}>Consentement</strong> (art. 6.1.a RGPD) : champs optionnels du profil (bio, pays, pseudos jeux) que vous choisissez de remplir.</li>
          </ul>
        </Section>

        {/* Durées */}
        <Section icon={<Clock size={14} />} title="Durées de conservation">
          <dl className="text-sm space-y-2">
            <DurationLine label="Profil actif" value="Tant que votre compte existe." />
            <DurationLine label="Après suppression de compte" value="Profil effacé immédiatement ; retrait de toutes les équipes et structures." />
            <DurationLine label="Journaux d'audit" value="3 ans maximum (obligation légale d'intégrité + lutte contre la fraude)." />
            <DurationLine label="Logs techniques Sentry" value="90 jours maximum." />
            <DurationLine label="Sauvegardes Firestore" value="Rotations automatiques gérées par Google, durée maximale 30 jours." />
          </dl>
        </Section>

        {/* Sous-traitants */}
        <Section icon={<Database size={14} />} title="Sous-traitants et transferts hors UE">
          <p className="text-sm" style={{ color: 'var(--s-text-dim)' }}>
            Pour assurer le service, nous nous appuyons sur les prestataires suivants, dont certains hébergent des données aux États-Unis. Les transferts sont encadrés par les <strong style={{ color: 'var(--s-text)' }}>Clauses Contractuelles Types</strong> adoptées par la Commission européenne.
          </p>
          <ul className="text-sm space-y-2 pl-4" style={{ color: 'var(--s-text-dim)', listStyle: 'disc' }}>
            {i.infraProviders.map(p => (
              <li key={p.name}>
                <strong style={{ color: 'var(--s-text)' }}>{p.name}</strong> — {p.purpose}. ({p.location})
              </li>
            ))}
            <li>
              <strong style={{ color: 'var(--s-text)' }}>{i.hosterName}</strong> — hébergement du site. ({i.hosterAddress})
            </li>
          </ul>
        </Section>

        {/* Droits */}
        <Section icon={<UserCheck size={14} />} title="Vos droits RGPD">
          <p className="text-sm" style={{ color: 'var(--s-text-dim)' }}>
            Conformément au RGPD, vous disposez des droits suivants sur vos données :
          </p>
          <ul className="text-sm space-y-2 pl-4" style={{ color: 'var(--s-text-dim)', listStyle: 'disc' }}>
            <li><strong style={{ color: 'var(--s-text)' }}>Droit d&apos;accès</strong> — consulter la totalité de vos données.</li>
            <li><strong style={{ color: 'var(--s-text)' }}>Droit de rectification</strong> — modifier vos informations à tout moment depuis vos paramètres.</li>
            <li><strong style={{ color: 'var(--s-text)' }}>Droit à la portabilité</strong> (art. 20) — exporter vos données au format JSON.</li>
            <li><strong style={{ color: 'var(--s-text)' }}>Droit à l&apos;effacement</strong> (art. 17) — supprimer votre compte (exception : journaux d&apos;audit conservés 3 ans max au titre de l&apos;intérêt légitime).</li>
            <li><strong style={{ color: 'var(--s-text)' }}>Droit d&apos;opposition et de limitation</strong> — sur demande à l&apos;adresse de contact.</li>
          </ul>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
            <Link
              href="/settings"
              className="flex items-center gap-2 p-3 text-sm bevel-sm transition-colors duration-150"
              style={{ background: 'var(--s-elevated)', border: '1px solid var(--s-border)', color: 'var(--s-text)' }}
            >
              <Download size={14} style={{ color: 'var(--s-violet-light)' }} />
              Exporter mes données (paramètres)
            </Link>
            <Link
              href="/settings"
              className="flex items-center gap-2 p-3 text-sm bevel-sm transition-colors duration-150"
              style={{ background: 'var(--s-elevated)', border: '1px solid rgba(239,68,68,0.25)', color: '#ef4444' }}
            >
              <Trash2 size={14} />
              Supprimer mon compte (paramètres)
            </Link>
          </div>

          <p className="text-sm mt-2" style={{ color: 'var(--s-text-dim)' }}>
            Pour toute autre demande, contactez <a href={`mailto:${i.contactEmail}`} style={{ color: 'var(--s-violet-light)' }}>{i.contactEmail}</a>. Nous répondons sous 30 jours.
          </p>
          <p className="text-xs" style={{ color: 'var(--s-text-muted)' }}>
            En cas de désaccord persistant, vous pouvez déposer une réclamation auprès de la <a href="https://www.cnil.fr" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--s-violet-light)' }}>CNIL</a>.
          </p>
        </Section>

        {/* Sécurité */}
        <Section icon={<Shield size={14} />} title="Sécurité">
          <ul className="text-sm space-y-2 pl-4" style={{ color: 'var(--s-text-dim)', listStyle: 'disc' }}>
            <li>Communications chiffrées en HTTPS (certificats automatiques).</li>
            <li>Authentification déléguée à Discord — aucun mot de passe stocké côté Aedral.</li>
            <li>Règles d&apos;accès Firestore strictes : un utilisateur ne peut accéder qu&apos;aux données qui le concernent ou qui sont explicitement publiques.</li>
            <li>Documents privés stockés en bucket Cloudflare R2 privé, téléchargés via URL signée éphémère (60 secondes).</li>
            <li><strong style={{ color: 'var(--s-text)' }}>Documents marqués sensibles</strong> (pièces d&apos;identité, justificatifs, contrats, statuts…) : chiffrés avec l&apos;algorithme <strong style={{ color: 'var(--s-text)' }}>AES-256-GCM</strong> avant stockage. La clé de déchiffrement est conservée hors du stockage R2 — un accès non autorisé au bucket ne permet pas de lire ces fichiers.</li>
            <li>Rate limiting applicatif sur les routes sensibles, audit logs et monitoring Sentry.</li>
          </ul>
        </Section>

        {/* Mineurs */}
        <Section icon={<UserCheck size={14} />} title="Mineurs">
          <p className="text-sm" style={{ color: 'var(--s-text-dim)' }}>
            L&apos;inscription est réservée aux utilisateurs âgés de <strong style={{ color: 'var(--s-text)' }}>13 ans minimum</strong>, conformément aux conditions Discord. Les utilisateurs de moins de 15 ans en France doivent obtenir l&apos;accord de leur représentant légal pour l&apos;utilisation du site (art. 8 RGPD).
          </p>
        </Section>

        {/* Modifications */}
        <Section icon={<Clock size={14} />} title="Modifications">
          <p className="text-sm" style={{ color: 'var(--s-text-dim)' }}>
            Cette politique peut évoluer pour refléter des changements techniques ou légaux. La date de dernière mise à jour est indiquée en haut du document. En cas de changement majeur, les utilisateurs connectés seront informés via une notification in-app.
          </p>
        </Section>

        {/* Contact final */}
        <section className="panel p-5 flex items-center gap-3 flex-wrap">
          <Mail size={16} style={{ color: 'var(--s-violet-light)' }} />
          <span className="text-sm" style={{ color: 'var(--s-text-dim)' }}>
            Une question sur vos données ?
          </span>
          <a href={`mailto:${i.contactEmail}`} style={{ color: 'var(--s-violet-light)' }} className="text-sm">
            {i.contactEmail}
          </a>
        </section>

        <div className="panel p-4 flex items-center justify-between flex-wrap gap-3">
          <span className="text-xs" style={{ color: 'var(--s-text-muted)' }}>
            Voir aussi nos mentions légales.
          </span>
          <Link href="/legal/mentions" className="text-xs" style={{ color: 'var(--s-violet-light)' }}>
            Mentions légales →
          </Link>
        </div>

      </div>
    </div>
  );
}

function Section({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <section className="panel p-5 space-y-3">
      <div className="flex items-center gap-2">
        <span style={{ color: 'var(--s-text-dim)' }}>{icon}</span>
        <h2 className="t-label" style={{ color: 'var(--s-text)', fontSize: '11px' }}>{title}</h2>
      </div>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

function SubBlock({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="pl-3" style={{ borderLeft: '2px solid var(--s-border)' }}>
      <h3 className="text-xs font-semibold mb-1.5" style={{ color: 'var(--s-text)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
        {title}
      </h3>
      {children}
    </div>
  );
}

function DurationLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[160px_1fr] gap-3">
      <dt className="text-xs" style={{ color: 'var(--s-text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
        {label}
      </dt>
      <dd className="text-sm" style={{ color: 'var(--s-text-dim)' }}>{value}</dd>
    </div>
  );
}
