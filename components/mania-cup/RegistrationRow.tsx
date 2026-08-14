'use client';

import { useState } from 'react';
import Link from 'next/link';
import {
  Check, X, Euro, ShieldCheck, FileText, ChevronDown, Monitor, MapPin,
  MessageSquare, UserCheck, Ban, Loader2, Copy,
} from 'lucide-react';
import CountryFlag from '@/components/ui/CountryFlag';
import CountrySelect from '@/components/ui/CountrySelect';
import CopyHandle from '@/components/ui/CopyHandle';
import { countries } from '@/lib/countries';
import { getProfileHref } from '@/lib/user-slug';
import { GUARDIAN_DOC_KINDS, GUARDIAN_DOC_LABELS } from '@/lib/mania-cup';

// Une inscription dans la console : une LIGNE dense, et son dossier complet
// déplié sur place.
//
// La version précédente empilait tout dans la première colonne — pseudo, nom,
// e-mail, téléphone, contact d'urgence, étiquettes — ce qui donnait des lignes
// de 130 px. À 64 inscrits, cela faisait un mur de six écrans à faire défiler
// pour répondre à « qui n'a pas payé ? ». Et les trois colonnes de droite
// flottaient dans le vide sur un écran large.
//
// Ici la ligne ne porte que ce qu'on lit en balayant du regard, et TOUT le
// reste — y compris quatre actions que le serveur savait déjà faire mais que
// rien n'appelait : l'arrivée, l'emplacement, le mot au joueur, le retrait —
// vit dans le dossier, à un clic.

export type Row = {
  uid: string;
  tmDisplayName: string;
  tmAccountId: string;
  discordId: string | null;
  /** Le pseudo sous lequel on lui parle sur le Discord — souvent sans aucun
   *  rapport avec son pseudo Trackmania. */
  discordUsername: string | null;
  /** Adresse publique de son profil Aedral. Null pour les comptes antérieurs
   *  aux slugs : on retombe alors sur l'uid, que la route sait résoudre. */
  profileSlug: string | null;
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  emergencyContact: { name: string; phone: string } | null;
  imageConsent: boolean | null;
  countryCode: string;
  ageAtEvent: number;
  status: 'pending_payment' | 'confirmed' | 'cancelled';
  guardianConsent: 'not_required' | 'missing' | 'pending_review' | 'approved' | 'rejected';
  guardianDocs: Partial<Record<'consent' | 'guardian_id', { name: string }>>;
  guardianRejectionReason: string | null;
  registrationCode: string;
  /** Écurie et équipe Trackmania du joueur sur Aedral, s'il en a une. */
  appartenance: {
    structure: string;
    tag: string | null;
    team: string | null;
    logoUrl: string | null;
  } | null;
  companions: {
    name: string;
    /** Le nom qui s'imprimera sur le badge, choisi par le joueur. */
    displayName?: string | null;
    role: string;
    ticketItemId?: number | null;
  }[];
  payment: {
    amountCents: number;
    payerName: string;
    /** Numéro de commande HelloAsso — celui qu'on saisit dans leur recherche
     *  pour retrouver un règlement ou lancer un remboursement. */
    orderId?: number | null;
    itemId?: number | null;
  } | null;
  /** `itemId` présent = location réglée à la billetterie, donc intouchable ici. */
  pcRental: {
    amountCents: number;
    label?: string;
    itemId?: number | null;
    orderId?: number | null;
  } | null;
  seat: string | null;
  checkedIn: boolean;
  /** Horodatages Firestore sérialisés. L'ordre d'arrivée décide de tout quand
   *  les places manquent : il n'était visible nulle part. */
  createdAt: { _seconds: number } | null;
  paidAt: { _seconds: number } | null;
  staffMessage: string | null;
};

export type ActionBody = {
  uid: string;
  action: string;
  reason?: string;
  countryCode?: string;
  pcRental?: boolean;
  /** Le matériel convenu, quand la location est notée à la main. */
  label?: string;
  /** Geste explicite exigé pour retirer une location réglée à la billetterie. */
  confirm?: boolean;
  seat?: string;
  message?: string;
};

/** Horodatage Firestore en date lisible. Le jour et l'heure suffisent : on
 *  compare des dossiers entre eux, on ne fait pas de comptabilité. */
export function dateCourte(t: { _seconds: number }): string {
  return new Date(t._seconds * 1000).toLocaleString('fr-FR', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  });
}

/**
 * L'article loué, en deux mots pour tenir dans une étiquette.
 *
 * Les intitulés de la boutique sont longs et criards — « LOCATION PC FIXE
 * (2 jours) ». On garde ce qui distingue les articles entre eux, le reste
 * s'affiche au survol.
 */
export function abregerLocation(label: string | undefined): string {
  if (!label) return 'poste';
  const l = label.toLowerCase();
  if (l.includes('portable')) return 'PC portable';
  if (l.includes('écran') || l.includes('ecran')) return 'écran seul';
  if (l.includes('fixe')) return 'PC fixe';
  return label.length > 18 ? `${label.slice(0, 17)}…` : label;
}

/** Ce dossier attend quelque chose de l'organisation. Sert à allumer le filet
 *  or en tête de ligne : une relance à passer ne doit pas se mériter au
 *  travers d'un filtre. */
export function needsAction(r: Row): boolean {
  if (r.status === 'cancelled') return false;
  return (
    r.status === 'pending_payment' ||
    r.guardianConsent === 'pending_review' ||
    r.guardianConsent === 'missing' ||
    !r.firstName ||
    !r.email
  );
}

/**
 * Ce dossier répond-il à la recherche ?
 *
 * On cherche quelqu'un par tout ce qui l'identifie dans la vraie vie : son
 * pseudo Trackmania, son pseudo Discord, son nom, son adresse, son code. Le
 * pseudo Discord manquait, alors que c'est justement le nom sous lequel arrive
 * un message quand quelqu'un vient de s'inscrire.
 *
 * `needle` est attendu déjà mis en minuscules et détouré par l'appelant.
 */
export function matchesSearch(r: Row, needle: string): boolean {
  if (!needle) return true;
  return [
    r.tmDisplayName,
    r.discordUsername,
    r.firstName,
    r.lastName,
    r.email,
    r.registrationCode,
    r.seat,
    r.appartenance?.structure,
    r.appartenance?.tag,
  ]
    .filter(Boolean)
    .some((v) => String(v).toLowerCase().includes(needle));
}

export default function RegistrationRow({
  row: r,
  rank,
  onAct,
  onOpenDocument,
  pending,
}: {
  row: Row;
  /** Rang d'arrivée, calculé sur la liste ENTIÈRE : il ne bouge pas quand on
   *  filtre, sinon le numéro ne veut plus rien dire. */
  rank: number;
  onAct: (b: ActionBody) => void;
  onOpenDocument: (uid: string, kind: string) => void;
  pending: boolean;
}) {
  const [open, setOpen] = useState(false);
  const pays = countries.find((c) => c.code === r.countryCode);
  const alerte = needsAction(r);
  const retiree = r.status === 'cancelled';

  return (
    <>
      <tr
        onClick={() => setOpen((o) => !o)}
        className="cursor-pointer border-b border-white/5 transition-colors hover:bg-white/[0.03]"
        style={{
          opacity: retiree ? 0.45 : undefined,
          background: open ? 'rgba(255,255,255,0.03)' : undefined,
        }}
      >
        <td
          className="py-3 pr-2 pl-3 align-middle text-xs tabular-nums"
          style={{
            color: 'var(--s-text-muted)',
            // Filet en tête de ligne plutôt qu'une étiquette de plus : on repère
            // les dossiers qui attendent en balayant la colonne de gauche.
            boxShadow: alerte ? 'inset 3px 0 0 var(--s-gold)' : undefined,
          }}
        >
          {rank}
        </td>

        <td className="py-3 pr-4 align-middle">
          {/* Le PSEUDO en premier : c'est par lui qu'on reconnaît un joueur,
              c'est lui qui figure sur la page publique et dans les
              conversations. L'identité civile suit, elle ne sert qu'une fois,
              au contrôle de la pièce d'identité à l'accueil.

              Et il mène au profil Aedral, dans un onglet à part : c'est là que
              vivent l'avatar, la structure et l'historique — de quoi mettre un
              visage sur un inscrit sans quitter la console. */}
          <Link
            href={getProfileHref({ slug: r.profileSlug, uid: r.uid })}
            target="_blank"
            onClick={(e) => e.stopPropagation()}
            title="Ouvrir son profil Aedral"
            className="block truncate leading-tight font-semibold hover:underline"
          >
            {r.tmDisplayName || '—'}
          </Link>
          {r.firstName || r.lastName ? (
            <div className="truncate text-xs leading-tight" style={{ color: 'var(--s-text-dim)' }}>
              {`${r.firstName} ${r.lastName}`.trim()}
            </div>
          ) : (
            <div className="text-xs leading-tight" style={{ color: 'var(--s-gold)' }}>
              fiche incomplète
            </div>
          )}
        </td>

        {/* Sous quel nom on lui parle sur le Discord.
            Un joueur s'inscrit sous son pseudo Trackmania, et les deux n'ont
            souvent rien à voir : sans cette colonne, reconnaître un nouvel
            inscrit demandait d'ouvrir son dossier, d'y lire un snowflake, et
            de le recopier dans la recherche de Discord. */}
        <td className="py-3 pr-4 align-middle">
          {r.discordUsername ? (
            <CopyHandle handle={r.discordUsername} />
          ) : (
            <span
              className="text-xs"
              style={{ color: 'var(--s-text-muted)' }}
              title="Ce compte n’a pas de pseudo Discord enregistré — il se remplit à sa prochaine connexion."
            >
              inconnu
            </span>
          )}
        </td>

        {/* La structure du joueur, quand il en a une sur Aedral. La plupart des
            inscrits viennent seuls : la colonne reste alors vide plutôt que de
            fabriquer une appartenance. */}
        <td className="py-3 pr-4 align-middle">
          {r.appartenance ? (
            <>
              <div className="flex items-center gap-1.5">
                {r.appartenance.tag && (
                  <span className="tag tag-green shrink-0">{r.appartenance.tag}</span>
                )}
                <span className="truncate text-sm" title={r.appartenance.structure}>
                  {r.appartenance.structure}
                </span>
              </div>
              {r.appartenance.team && (
                <div className="truncate text-xs" style={{ color: 'var(--s-text-muted)' }}>
                  {r.appartenance.team}
                </div>
              )}
            </>
          ) : (
            <span style={{ color: 'var(--s-text-muted)' }}>—</span>
          )}
        </td>

        {/* Joindre quelqu'un est la deuxième chose qu'on fait après l'avoir
            trouvé. L'adresse et le téléphone ne vivaient que dans l'export :
            il fallait ouvrir un tableur pour passer un appel. */}
        <td className="py-3 pr-4 align-middle">
          <div className="truncate text-xs" style={{ color: 'var(--s-text-dim)' }}>
            {r.email || <span style={{ color: 'var(--s-gold)' }}>aucune adresse</span>}
          </div>
          <div className="text-xs tabular-nums" style={{ color: 'var(--s-text-muted)' }}>
            {r.phone ?? '—'}
          </div>
        </td>

        <td className="py-3 pr-4 align-middle">
          <span className="inline-flex items-center gap-2">
            <CountryFlag code={r.countryCode} size={20} title={pays?.name} />
            <span className="text-sm" style={{ color: 'var(--s-text-dim)' }}>
              {pays?.name ?? '—'}
            </span>
          </span>
        </td>

        <td className="py-3 pr-4 align-middle tabular-nums">
          {r.ageAtEvent}
          {r.ageAtEvent < 18 && (
            <span className="ml-1.5 bg-[#FFB800]/20 px-1.5 py-0.5 text-xs text-[#FFB800]">
              mineur
            </span>
          )}
        </td>

        <td className="py-3 pr-4 align-middle">
          <div className="font-mono text-xs">{r.registrationCode}</div>
          {r.createdAt && (
            <div className="text-xs" style={{ color: 'var(--s-text-muted)' }}>
              {dateCourte(r.createdAt)}
            </div>
          )}
        </td>

        <td className="py-3 pr-4 align-middle">
          {retiree ? (
            <span style={{ color: 'var(--s-text-muted)' }}>—</span>
          ) : r.status === 'confirmed' ? (
            <>
              {/* Statique, plus un bouton : dans une liste dense, « Payé »
                  cliquable annulait un règlement au moindre faux clic. Le
                  dé-marquer se fait dans le dossier, en connaissance de cause. */}
              <span className="inline-flex items-center gap-1.5 text-[#22c55e]">
                <Check size={15} aria-hidden /> Payé
              </span>
              {r.payment && (
                <div className="text-xs" style={{ color: 'var(--s-text-muted)' }}>
                  {(r.payment.amountCents / 100).toFixed(2).replace('.', ',')} €
                  {r.payment.payerName ? ` · ${r.payment.payerName}` : ''}
                </div>
              )}
            </>
          ) : (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onAct({ uid: r.uid, action: 'mark_paid' });
              }}
              disabled={pending}
              className="bevel-sm inline-flex items-center gap-1.5 border border-[#FFB800]/50 px-2.5 py-1 text-xs text-[#FFB800] hover:bg-[#FFB800]/10 disabled:opacity-40"
            >
              <Euro size={13} aria-hidden /> Marquer payé
            </button>
          )}
        </td>

        <td className="py-3 pr-4 align-middle">
          <div className="flex flex-wrap items-center gap-1.5">
            {retiree && <span className="tag tag-neutral">retirée</span>}
            {r.checkedIn && (
              <span className="tag tag-green inline-flex items-center gap-1">
                <UserCheck size={11} aria-hidden /> arrivé
              </span>
            )}
            {r.seat && (
              <span className="tag tag-neutral inline-flex items-center gap-1">
                <MapPin size={11} aria-hidden /> {r.seat}
              </span>
            )}
            {r.pcRental && (
              <span
                className="tag tag-violet inline-flex items-center gap-1"
                title={r.pcRental.label ?? 'Location convenue avec l’organisation'}
              >
                <Monitor size={11} aria-hidden />
                {/* L'article, pas un « oui » : le jour J, c'est ce mot qui dit
                    quel matériel sortir du carton. */}
                {abregerLocation(r.pcRental.label)}
              </span>
            )}
            {r.companions.length > 0 && (
              <span className="tag tag-neutral">
                +{r.companions.length} accomp.
              </span>
            )}
            <GuardianBadge row={r} />
            {r.imageConsent === false && (
              <span
                className="tag"
                style={{ color: '#ef4444', borderColor: 'rgba(239,68,68,.4)' }}
              >
                image refusée
              </span>
            )}
            {r.staffMessage && (
              <span
                className="tag tag-neutral inline-flex items-center gap-1"
                title={r.staffMessage}
              >
                <MessageSquare size={11} aria-hidden /> mot
              </span>
            )}
          </div>
        </td>

        <td className="py-3 pr-3 text-right align-middle">
          <ChevronDown
            size={16}
            className={`inline-block transition-transform ${open ? 'rotate-180' : ''}`}
            style={{ color: 'var(--s-text-muted)' }}
            aria-hidden
          />
        </td>
      </tr>

      {open && (
        <tr className="border-b border-white/10">
          <td colSpan={11} className="p-0">
            <Dossier
              row={r}
              onAct={onAct}
              onOpenDocument={onOpenDocument}
              pending={pending}
            />
          </td>
        </tr>
      )}
    </>
  );
}

/** Résumé d'une pièce d'un mot dans la ligne ; le détail et les boutons sont
 *  dans le dossier. */
function GuardianBadge({ row }: { row: Row }) {
  switch (row.guardianConsent) {
    case 'not_required':
      return null;
    case 'approved':
      return (
        <span className="tag tag-green inline-flex items-center gap-1">
          <ShieldCheck size={11} aria-hidden /> autorisation OK
        </span>
      );
    case 'pending_review':
      return <span className="tag tag-gold">autorisation à relire</span>;
    case 'missing':
      return <span className="tag tag-gold">autorisation incomplète</span>;
    case 'rejected':
      return (
        <span className="tag" style={{ color: '#ef4444', borderColor: 'rgba(239,68,68,.4)' }}>
          autorisation refusée
        </span>
      );
  }
}

// ── Le dossier ───────────────────────────────────────────────────────────────

function Dossier({
  row: r,
  onAct,
  onOpenDocument,
  pending,
}: {
  row: Row;
  onAct: (b: ActionBody) => void;
  onOpenDocument: (uid: string, kind: string) => void;
  pending: boolean;
}) {
  return (
    <div
      className="grid gap-x-10 gap-y-8 border-l-2 border-[#00D936]/40 px-6 py-6 lg:grid-cols-3"
      style={{ background: 'rgba(255,255,255,0.02)' }}
    >
      <Colonne titre="Contact">
        <Champ label="E-mail">
          {r.email ? (
            <a href={`mailto:${r.email}`} className="hover:underline">{r.email}</a>
          ) : (
            <Manquant>non renseigné</Manquant>
          )}
        </Champ>
        <Champ label="Téléphone">
          {r.phone ? <a href={`tel:${r.phone}`} className="hover:underline">{r.phone}</a> : <Vide />}
        </Champ>
        <Champ label="Contact d’urgence">
          {r.emergencyContact ? (
            <>
              {r.emergencyContact.name}
              <span style={{ color: 'var(--s-text-dim)' }}> · {r.emergencyContact.phone}</span>
            </>
          ) : r.ageAtEvent < 18 ? (
            <Manquant>obligatoire pour un mineur</Manquant>
          ) : (
            <Vide />
          )}
        </Champ>
        <Champ label="Pays">
          {/* Corrigeable ici : le drapeau vient du profil, et l'organisation
              n'avait aucun moyen de le rectifier — un joueur suisse est resté
              sous drapeau français jusqu'à ce qu'on écrive en base. */}
          <div className="-ml-1.5 max-w-[240px]">
            <CountrySelect
              variant="inline"
              value={r.countryCode}
              onChange={(code) => onAct({ uid: r.uid, action: 'set_country', countryCode: code })}
            />
          </div>
        </Champ>
        <Champ label="Droit à l’image">
          {r.imageConsent === false ? (
            <span className="text-[#ef4444]">refusé — ne pas filmer ni diffuser</span>
          ) : (
            <span style={{ color: 'var(--s-text-dim)' }}>accordé</span>
          )}
        </Champ>
        {r.appartenance && (
          <Champ label="Structure">
            <div>
              {r.appartenance.tag ? `${r.appartenance.tag} · ` : ''}
              {r.appartenance.structure}
            </div>
            {r.appartenance.team && (
              <div className="text-xs" style={{ color: 'var(--s-text-muted)' }}>
                équipe {r.appartenance.team}
              </div>
            )}
          </Champ>
        )}
        {(r.discordUsername || r.discordId) && (
          <Champ label="Discord">
            {r.discordUsername && <CopyHandle handle={r.discordUsername} />}
            {/* Le snowflake reste : c'est lui qui sert à citer quelqu'un
                (`<@id>`) ou à le retrouver dans les réglages du serveur. */}
            {r.discordId && (
              <div className="font-mono text-xs" style={{ color: 'var(--s-text-muted)' }}>
                {r.discordId}
              </div>
            )}
          </Champ>
        )}
      </Colonne>

      <Colonne titre="Le jour J">
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => onAct({ uid: r.uid, action: r.checkedIn ? 'undo_check_in' : 'check_in' })}
            disabled={pending || r.status === 'cancelled'}
            className={`bevel-sm inline-flex items-center gap-2 border px-3 py-1.5 text-sm disabled:opacity-40 ${
              r.checkedIn
                ? 'border-white/20 hover:bg-white/10'
                : 'border-[#22c55e]/50 text-[#22c55e] hover:bg-[#22c55e]/10'
            }`}
          >
            <UserCheck size={14} aria-hidden />
            {r.checkedIn ? 'Annuler l’arrivée' : 'Noter son arrivée'}
          </button>

        </div>

        <Champ label="Matériel loué">
          <MaterielLoue row={r} onAct={onAct} pending={pending} />
        </Champ>

        <ChampEditable
          label="Emplacement dans la salle"
          hint="Imprimé sur le badge — dit au joueur où brancher son PC."
          value={r.seat ?? ''}
          placeholder="aucun emplacement attribué"
          maxLength={20}
          onSave={(seat) => onAct({ uid: r.uid, action: 'set_seat', seat })}
          pending={pending}
        />

        <Champ label="Accompagnants">
          {r.companions.length === 0 ? (
            <Vide />
          ) : (
            <ul className="space-y-1.5">
              {r.companions.map((c, i) => (
                <li key={`${c.name}-${i}`} className="flex flex-wrap items-baseline gap-x-2">
                  {/* Le badge portera le pseudo ; l'accueil, lui, contrôle le
                      nom du billet. Les deux doivent donc être lisibles ici. */}
                  <span>{c.displayName?.trim() || c.name}</span>
                  {c.displayName?.trim() && (
                    <span className="text-xs" style={{ color: 'var(--s-text-muted)' }}>
                      billet : {c.name}
                    </span>
                  )}
                  <span className="text-xs" style={{ color: 'var(--s-text-dim)' }}>{c.role}</span>
                  {/* Un billet accompagnant ouvre la zone joueurs : savoir s'il
                      est réglé décide de qui entre. */}
                  <span
                    className="text-xs"
                    style={{ color: c.ticketItemId != null ? 'var(--s-green)' : 'var(--s-gold)' }}
                  >
                    {c.ticketItemId != null ? 'billet réglé' : 'billet non réglé'}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Champ>
      </Colonne>

      <Colonne titre="Dossier">
        <Champ label="Règlement">
          {r.status === 'confirmed' ? (
            <div className="space-y-1.5">
              <div className="text-[#22c55e]">
                Réglé
                {r.paidAt && (
                  <span style={{ color: 'var(--s-text-dim)' }}> le {dateCourte(r.paidAt)}</span>
                )}
              </div>
              {r.payment && (
                <div className="text-xs" style={{ color: 'var(--s-text-muted)' }}>
                  {(r.payment.amountCents / 100).toFixed(2).replace('.', ',')} € ·{' '}
                  {r.payment.payerName || 'payeur inconnu'}
                </div>
              )}
              {/* LE numéro à saisir chez HelloAsso pour retrouver ce règlement
                  ou le rembourser. Il était en base depuis le début, mais
                  n'apparaissait nulle part : retrouver la bonne commande
                  demandait de fouiller la base à la main.

                  Et il faut la BONNE : un joueur qui a payé deux fois a deux
                  commandes, dont une seule tient sa place. Rembourser l'autre
                  la lui retirerait à la prochaine relecture. */}
              {r.payment?.orderId != null && (
                <NumeroCommande orderId={r.payment.orderId} />
              )}
              <button
                onClick={() => onAct({ uid: r.uid, action: 'mark_unpaid' })}
                disabled={pending}
                className="text-xs underline disabled:opacity-40"
                style={{ color: 'var(--s-text-dim)' }}
              >
                Retirer la confirmation de paiement
              </button>
            </div>
          ) : r.status === 'cancelled' ? (
            <span style={{ color: 'var(--s-text-muted)' }}>inscription retirée</span>
          ) : (
            <Manquant>en attente de règlement</Manquant>
          )}
        </Champ>

        {r.guardianConsent !== 'not_required' && (
          <Champ label="Autorisation parentale">
            <Guardian row={r} onOpen={onOpenDocument} onAct={onAct} pending={pending} />
          </Champ>
        )}

        <ChampEditable
          label="Mot au joueur"
          hint="Visible sur son espace d’inscription — évite les messages privés qui se perdent."
          value={r.staffMessage ?? ''}
          placeholder="aucun mot pour l’instant"
          maxLength={300}
          multiline
          onSave={(message) => onAct({ uid: r.uid, action: 'set_message', message })}
          pending={pending}
        />

        {r.status !== 'cancelled' && (
          <RetirerInscription row={r} onAct={onAct} pending={pending} />
        )}
      </Colonne>
    </div>
  );
}

function Colonne({ titre, children }: { titre: string; children: React.ReactNode }) {
  return (
    <section className="space-y-4">
      <h3 className="t-label" style={{ color: 'var(--s-text-muted)' }}>{titre}</h3>
      {children}
    </section>
  );
}

function Champ({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs" style={{ color: 'var(--s-text-muted)' }}>{label}</div>
      <div className="mt-0.5 text-sm">{children}</div>
    </div>
  );
}

function Vide() {
  return <span style={{ color: 'var(--s-text-muted)' }}>—</span>;
}

function Manquant({ children }: { children: React.ReactNode }) {
  return <span style={{ color: 'var(--s-gold)' }}>{children}</span>;
}

/** Champ qui s'enregistre à la validation, pas à la frappe : un emplacement ou
 *  un mot au joueur ne doit pas partir en base à chaque lettre. */
function ChampEditable({
  label,
  hint,
  value,
  placeholder,
  maxLength,
  multiline,
  onSave,
  pending,
}: {
  label: string;
  hint: string;
  value: string;
  placeholder: string;
  maxLength: number;
  multiline?: boolean;
  onSave: (v: string) => void;
  pending: boolean;
}) {
  const [draft, setDraft] = useState(value);
  const modifie = draft.trim() !== value.trim();

  const commun = {
    value: draft,
    maxLength,
    placeholder,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setDraft(e.target.value),
    // Le texte d'exemple doit se lire comme un vide, pas comme une valeur : un
    // « A12 » gris clair dans un champ d'emplacement se prend pour une place
    // déjà attribuée.
    className:
      'mc-champ w-full border border-white/15 bg-black/40 px-2.5 py-1.5 text-sm outline-none focus:border-[#00D936]',
  };

  return (
    <div>
      <div className="text-xs" style={{ color: 'var(--s-text-muted)' }}>{label}</div>
      <div className="mt-1">
        {multiline ? (
          <textarea {...commun} rows={3} aria-label={label} />
        ) : (
          <input {...commun} aria-label={label} />
        )}
      </div>
      <div className="mt-1.5 flex items-center gap-3">
        <button
          onClick={() => onSave(draft.trim())}
          disabled={!modifie || pending}
          className="bevel-sm border border-white/20 px-2.5 py-1 text-xs hover:bg-white/10 disabled:opacity-30"
        >
          Enregistrer
        </button>
        {modifie ? (
          <button
            onClick={() => setDraft(value)}
            className="text-xs underline"
            style={{ color: 'var(--s-text-dim)' }}
          >
            Annuler
          </button>
        ) : (
          <span className="text-xs" style={{ color: 'var(--s-text-muted)' }}>{hint}</span>
        )}
      </div>

      <style jsx global>{`
        .mc-champ::placeholder {
          color: var(--s-text-muted);
          font-style: italic;
          opacity: 0.7;
        }
      `}</style>
    </div>
  );
}

/** Retirer une inscription libère une place : jamais en un clic, et jamais
 *  sans motif — il part dans le journal d'administration. */
function RetirerInscription({
  row: r,
  onAct,
  pending,
}: {
  row: Row;
  onAct: (b: ActionBody) => void;
  pending: boolean;
}) {
  const [confirme, setConfirme] = useState(false);
  const [motif, setMotif] = useState('');

  if (!confirme) {
    return (
      <button
        onClick={() => setConfirme(true)}
        className="inline-flex items-center gap-1.5 text-xs underline"
        style={{ color: 'var(--s-text-dim)' }}
      >
        <Ban size={13} aria-hidden /> Retirer cette inscription
      </button>
    );
  }

  return (
    <div className="space-y-2 border border-red-500/30 bg-red-500/5 p-3">
      <p className="text-xs text-red-200">
        La place est libérée immédiatement.
        {r.status === 'confirmed' && ' Ce dossier est réglé : le remboursement se fait à part, sur HelloAsso.'}
      </p>
      <input
        autoFocus
        value={motif}
        onChange={(e) => setMotif(e.target.value)}
        placeholder="Motif (journalisé)"
        aria-label="Motif du retrait"
        className="w-full border border-white/20 bg-black/40 px-2 py-1 text-xs outline-none focus:border-[#ef4444]"
      />
      <div className="flex gap-2">
        <button
          disabled={!motif.trim() || pending}
          onClick={() => {
            onAct({ uid: r.uid, action: 'cancel', reason: motif.trim() });
            setConfirme(false);
            setMotif('');
          }}
          className="inline-flex items-center gap-1 border border-red-500/40 px-2 py-1 text-xs text-red-300 hover:bg-red-500/10 disabled:opacity-40"
        >
          {pending ? <Loader2 size={12} className="animate-spin" aria-hidden /> : null}
          Confirmer le retrait
        </button>
        <button
          onClick={() => setConfirme(false)}
          className="px-2 py-1 text-xs"
          style={{ color: 'var(--s-text-dim)' }}
        >
          Annuler
        </button>
      </div>
    </div>
  );
}

// ── Matériel loué ────────────────────────────────────────────────────────────

/**
 * Ce que le joueur a loué, et par quel chemin.
 *
 * Cet emplacement portait un bouton à deux états — « Louer un poste » /
 * « Poste loué ». Il avait l'apparence d'un badge et le comportement d'un
 * interrupteur : un clic destiné à savoir QUEL matériel avait été loué a effacé
 * une location réglée 90 €, et l'a remplacée par une location manuelle à 0 €.
 *
 * Deux règles en découlent. L'article s'écrit toujours en toutes lettres —
 * c'est la seule chose qui compte le jour J, savoir quoi sortir du carton. Et
 * une location réglée à la billetterie ne s'annule pas d'ici : elle représente
 * de l'argent encaissé, elle se défait chez HelloAsso.
 */
export function MaterielLoue({
  row: r,
  onAct,
  pending,
}: {
  row: Row;
  onAct: (b: ActionBody) => void;
  pending: boolean;
}) {
  const [saisie, setSaisie] = useState<string | null>(null);
  const [confirmeRetrait, setConfirmeRetrait] = useState(false);
  const rental = r.pcRental;
  const regle = rental?.itemId != null;

  if (rental) {
    return (
      <div className="space-y-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <Monitor size={15} className="shrink-0 text-[#a364d9]" aria-hidden />
          <span className="font-semibold">
            {rental.label ?? (
              <span style={{ color: 'var(--s-gold)' }}>matériel non précisé</span>
            )}
          </span>
          {rental.amountCents > 0 && (
            <span className="t-mono" style={{ color: 'var(--s-text-dim)' }}>
              {(rental.amountCents / 100).toFixed(2).replace('.', ',')} €
            </span>
          )}
        </div>

        {regle ? (
          <>
            <p className="text-xs" style={{ color: 'var(--s-text-muted)' }}>
              Réglé à la billetterie.
            </p>
            {rental.orderId != null && <NumeroCommande orderId={rental.orderId} />}
            {/* Retirer reste possible — le joueur peut être remboursé — mais
                jamais d'un clic : c'est ce clic-là qui a effacé une location de
                90 € le 12 août. Deux temps, et le motif est journalisé. */}
            {confirmeRetrait ? (
              <div className="space-y-2 border border-[#FFB800]/30 bg-[#FFB800]/5 p-2">
                <p className="text-xs" style={{ color: 'var(--s-gold)' }}>
                  Le poste repart au stock. Cela ne rembourse personne — à faire
                  seulement si le remboursement est fait ou convenu.
                </p>
                <div className="flex gap-2">
                  <button
                    disabled={pending}
                    onClick={() => {
                      onAct({ uid: r.uid, action: 'set_pc_rental', pcRental: false, confirm: true });
                      setConfirmeRetrait(false);
                    }}
                    className="inline-flex items-center gap-1 border border-[#FFB800]/40 px-2 py-1 text-xs text-[#FFB800] hover:bg-[#FFB800]/10 disabled:opacity-40"
                  >
                    {pending ? <Loader2 size={12} className="animate-spin" aria-hidden /> : null}
                    Confirmer le retrait
                  </button>
                  <button
                    onClick={() => setConfirmeRetrait(false)}
                    className="px-2 py-1 text-xs"
                    style={{ color: 'var(--s-text-dim)' }}
                  >
                    Annuler
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => setConfirmeRetrait(true)}
                className="text-xs underline"
                style={{ color: 'var(--s-text-dim)' }}
              >
                Retirer cette location
              </button>
            )}
          </>
        ) : (
          <>
            <p className="text-xs" style={{ color: 'var(--s-text-muted)' }}>
              Noté par l’organisation — aucun règlement encaissé.
            </p>
            <button
              onClick={() => onAct({ uid: r.uid, action: 'set_pc_rental', pcRental: false })}
              disabled={pending}
              className="text-xs underline disabled:opacity-40"
              style={{ color: 'var(--s-text-dim)' }}
            >
              Retirer cette location
            </button>
          </>
        )}
      </div>
    );
  }

  if (saisie === null) {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <Vide />
        <button
          onClick={() => setSaisie('')}
          disabled={pending}
          className="text-xs underline disabled:opacity-40"
          style={{ color: 'var(--s-text-dim)' }}
        >
          Noter une location
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <input
        autoFocus
        value={saisie}
        onChange={(e) => setSaisie(e.target.value)}
        placeholder="PC fixe, PC portable, écran…"
        aria-label="Matériel loué"
        maxLength={80}
        className="w-full border border-white/20 bg-black/40 px-2 py-1 text-sm outline-none focus:border-[#a364d9]"
      />
      <p className="text-xs" style={{ color: 'var(--s-text-muted)' }}>
        Pour une location convenue sur le Discord ou de vive voix. Une location
        payée à la billetterie arrive toute seule, avec son article.
      </p>
      <div className="flex gap-2">
        <button
          disabled={!saisie.trim() || pending}
          onClick={() => {
            onAct({
              uid: r.uid,
              action: 'set_pc_rental',
              pcRental: true,
              label: saisie.trim(),
            });
            setSaisie(null);
          }}
          className="inline-flex items-center gap-1 border border-[#a364d9]/40 px-2 py-1 text-xs text-[#a364d9] hover:bg-[#a364d9]/10 disabled:opacity-40"
        >
          {pending ? <Loader2 size={12} className="animate-spin" aria-hidden /> : null}
          Enregistrer
        </button>
        <button
          onClick={() => setSaisie(null)}
          className="px-2 py-1 text-xs"
          style={{ color: 'var(--s-text-dim)' }}
        >
          Annuler
        </button>
      </div>
    </div>
  );
}

// ── Autorisation parentale ───────────────────────────────────────────────────

function Guardian({
  row,
  onOpen,
  onAct,
  pending,
}: {
  row: Row;
  onOpen: (uid: string, kind: string) => void;
  onAct: (b: ActionBody) => void;
  pending: boolean;
}) {
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');

  if (row.guardianConsent === 'approved') {
    return (
      <span className="inline-flex items-center gap-1.5 text-[#22c55e]">
        <ShieldCheck size={15} aria-hidden /> Validée
      </span>
    );
  }
  if (row.guardianConsent === 'missing') {
    const done = GUARDIAN_DOC_KINDS.filter((k) => row.guardianDocs?.[k]).length;
    return (
      <span style={{ color: 'var(--s-gold)' }}>
        Dossier incomplet ({done}/{GUARDIAN_DOC_KINDS.length} pièces)
      </span>
    );
  }
  if (row.guardianConsent === 'rejected') {
    return (
      <div className="text-red-300">
        Refusée
        {row.guardianRejectionReason && (
          <div className="text-xs" style={{ color: 'var(--s-text-dim)' }}>
            {row.guardianRejectionReason}
          </div>
        )}
      </div>
    );
  }

  // pending_review
  return (
    <div className="space-y-2">
      <div className="space-y-1">
        {GUARDIAN_DOC_KINDS.map((kind) => (
          <button
            key={kind}
            onClick={() => onOpen(row.uid, kind)}
            disabled={!row.guardianDocs?.[kind]}
            className="flex w-full max-w-[260px] items-center gap-1.5 border border-white/20 px-2.5 py-1 text-left text-xs hover:bg-white/10 disabled:opacity-40"
          >
            <FileText size={13} className="shrink-0" aria-hidden />
            <span className="truncate">{GUARDIAN_DOC_LABELS[kind]}</span>
          </button>
        ))}
      </div>

      {rejecting ? (
        <div className="space-y-2">
          <input
            autoFocus
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Motif communiqué au joueur"
            aria-label="Motif du refus"
            className="w-full max-w-[260px] border border-white/20 bg-black/40 px-2 py-1 text-xs outline-none focus:border-[#FFB800]"
          />
          <div className="flex gap-2">
            <button
              disabled={!reason.trim() || pending}
              onClick={() => {
                onAct({ uid: row.uid, action: 'reject_guardian', reason });
                setRejecting(false);
                setReason('');
              }}
              className="border border-red-500/40 px-2 py-1 text-xs text-red-300 hover:bg-red-500/10 disabled:opacity-40"
            >
              Confirmer le refus
            </button>
            <button
              onClick={() => setRejecting(false)}
              className="px-2 py-1 text-xs"
              style={{ color: 'var(--s-text-dim)' }}
            >
              Annuler
            </button>
          </div>
        </div>
      ) : (
        <div className="flex gap-2">
          <button
            onClick={() => onAct({ uid: row.uid, action: 'approve_guardian' })}
            disabled={pending}
            className="inline-flex items-center gap-1 border border-[#22c55e]/40 px-2 py-1 text-xs text-[#22c55e] hover:bg-[#22c55e]/10 disabled:opacity-40"
          >
            <Check size={13} aria-hidden /> Valider
          </button>
          <button
            onClick={() => setRejecting(true)}
            className="inline-flex items-center gap-1 border border-red-500/40 px-2 py-1 text-xs text-red-300 hover:bg-red-500/10"
          >
            <X size={13} aria-hidden /> Refuser
          </button>
        </div>
      )}
    </div>
  );
}


/** Le numéro de commande HelloAsso, copiable d'un clic.
 *
 *  Copiable parce que l'usage est toujours le même : le coller dans la
 *  recherche de HelloAsso. Le relire à l'écran pour le retaper, à neuf
 *  chiffres, c'est une erreur de saisie qui attend. */
function NumeroCommande({ orderId }: { orderId: number }) {
  const [copie, setCopie] = useState(false);

  return (
    <div className="mt-1.5 flex items-center gap-2">
      <span className="text-xs" style={{ color: 'var(--s-text-muted)' }}>
        Commande HelloAsso
      </span>
      <button
        onClick={() => {
          void navigator.clipboard?.writeText(String(orderId));
          setCopie(true);
          window.setTimeout(() => setCopie(false), 1500);
        }}
        title="Copier le numéro de commande"
        className="inline-flex items-center gap-1.5 border border-white/15 px-2 py-0.5 font-mono text-xs transition-colors hover:bg-white/10"
      >
        {orderId}
        {copie ? (
          <Check size={11} style={{ color: 'var(--s-green)' }} aria-hidden />
        ) : (
          <Copy size={11} style={{ color: 'var(--s-text-muted)' }} aria-hidden />
        )}
      </button>
    </div>
  );
}
