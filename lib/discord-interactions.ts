// Logique PURE des interactions Discord (boutons de présence) — sans I/O, sans
// crypto. Testable en isolation. La route /api/discord/interactions ne fait que :
// vérifier la signature (lib/discord-signature) puis déléguer ici via
// handleInteraction, en injectant les effets (écriture présence, rate-limit).

import type { WritePresenceResult } from '@/lib/event-presence-server';
import type { PresenceStatus } from '@/lib/event-permissions';

// ── Types d'interaction (sous-ensemble utile des payloads Discord v10) ──────
export interface DiscordInteraction {
  type: number; // 1 = PING, 3 = MESSAGE_COMPONENT
  data?: { custom_id?: string; component_type?: number };
  member?: { user?: { id?: string } }; // présent en guilde
  user?: { id?: string };              // présent en DM
}

export interface InteractionResponse {
  type: number; // 1 PONG, 4 message, 6 ack silencieux, 7 update
  data?: { content?: string; flags?: number };
}

// ── Boutons de présence ─────────────────────────────────────────────────────
// Statuts exposés par les boutons (pas 'pending' : c'est l'état initial).
export type PresenceButtonStatus = 'present' | 'maybe' | 'absent';

interface PresenceOption {
  status: PresenceButtonStatus;
  label: string;
  emoji: string;
  style: number; // 2 secondary, 3 success, 4 danger
}

// Ordre aligné sur les boutons du site (PlayerEventDrawer) : Présent, Peut-être, Absent.
export const PRESENCE_OPTIONS: PresenceOption[] = [
  { status: 'present', label: 'Présent', emoji: '✅', style: 3 },
  { status: 'maybe', label: 'Peut-être', emoji: '❔', style: 2 },
  { status: 'absent', label: 'Absent', emoji: '❌', style: 4 },
];

const STATUS_LABEL: Record<PresenceStatus, string> = {
  present: 'Présent',
  maybe: 'Peut-être',
  absent: 'Absent',
  pending: 'En attente',
};

// Namespace + version du custom_id : permet de faire évoluer le format sans
// casser les vieux messages (un ns inconnu est ignoré proprement).
const CUSTOM_ID_NS = 'pres.v1';
const BUTTON_STATUSES: PresenceButtonStatus[] = ['present', 'maybe', 'absent'];

export function buildPresenceCustomId(eventId: string, status: PresenceButtonStatus): string {
  return `${CUSTOM_ID_NS}:${eventId}:${status}`;
}

/**
 * Parse un custom_id de bouton de présence. Renvoie null si le namespace, la
 * forme ou le statut ne correspondent pas (custom_id d'une autre feature, vieux
 * format, ou forgé). Les IDs Firestore sont [A-Za-z0-9] → jamais de ':'.
 */
export function parsePresenceCustomId(
  customId: string | undefined | null,
): { eventId: string; status: PresenceButtonStatus } | null {
  if (!customId) return null;
  const parts = customId.split(':');
  if (parts.length !== 3) return null;
  const [ns, eventId, status] = parts;
  if (ns !== CUSTOM_ID_NS) return null;
  if (!eventId) return null;
  if (!BUTTON_STATUSES.includes(status as PresenceButtonStatus)) return null;
  return { eventId, status: status as PresenceButtonStatus };
}

/**
 * Action row de 3 boutons de présence pour un event donné. Structure Discord :
 * [{ type:1 (row), components: [{ type:2 (button), ... }] }].
 */
export function buildPresenceComponents(eventId: string): unknown[] {
  return [
    {
      type: 1,
      components: PRESENCE_OPTIONS.map(o => ({
        type: 2,
        style: o.style,
        label: o.label,
        custom_id: buildPresenceCustomId(eventId, o.status),
        emoji: { name: o.emoji },
      })),
    },
  ];
}

// ── Extraction / routage ────────────────────────────────────────────────────
export function extractDiscordUserId(interaction: DiscordInteraction): string | null {
  return interaction.member?.user?.id ?? interaction.user?.id ?? null;
}

const EPHEMERAL_FLAG = 64; // 1 << 6 : message visible seulement par le cliqueur

function ephemeral(content: string): InteractionResponse {
  return { type: 4, data: { content, flags: EPHEMERAL_FLAG } };
}
// Ack silencieux : on accuse réception sans rien afficher (custom_id inconnu, etc.).
const SILENT_ACK: InteractionResponse = { type: 6 };

function confirmMessage(result: WritePresenceResult, status: PresenceButtonStatus): string {
  if (result.ok) return `✅ Présence enregistrée : **${STATUS_LABEL[status]}**`;
  switch (result.code) {
    case 'not_invited':
      return 'Tu n\'es pas dans la liste des invités de cet événement.';
    case 'event_not_found':
      return 'Cet événement n\'existe plus.';
    case 'event_closed':
      return 'Cet événement est passé ou clôturé — réponse non enregistrée.';
    case 'structure_unavailable':
      return 'Structure indisponible pour le moment.';
    case 'forbidden':
      return 'Réponse impossible pour cet événement.';
    case 'invalid_status':
    default:
      return 'Réponse non enregistrée.';
  }
}

export interface HandleInteractionDeps {
  // Écrit la présence (chemin serveur writePresence) pour discord_<id>.
  recordPresence: (
    eventId: string,
    discordUserId: string,
    status: PresenceButtonStatus,
  ) => Promise<WritePresenceResult>;
  // true = requête bloquée (rate-limit) pour ce cliqueur.
  checkRate: (discordUserId: string) => Promise<boolean>;
}

/**
 * Route une interaction DÉJÀ authentifiée (signature vérifiée en amont) vers la
 * bonne réponse. Ne lève pas pour les cas métier ; les effets sont injectés.
 */
export async function handleInteraction(
  interaction: DiscordInteraction,
  deps: HandleInteractionDeps,
): Promise<InteractionResponse> {
  // PING → PONG (validation d'URL + health-check Discord)
  if (interaction.type === 1) return { type: 1 };

  // Clic de bouton (MESSAGE_COMPONENT + component_type button)
  if (interaction.type === 3 && interaction.data?.component_type === 2) {
    const discordUserId = extractDiscordUserId(interaction);
    if (!discordUserId) return SILENT_ACK;

    const parsed = parsePresenceCustomId(interaction.data.custom_id);
    if (!parsed) return SILENT_ACK; // pas un bouton de présence connu → ignore

    if (await deps.checkRate(discordUserId)) {
      return ephemeral('⏳ Trop de clics d\'affilée. Réessaie dans un instant.');
    }

    const result = await deps.recordPresence(parsed.eventId, discordUserId, parsed.status);
    return ephemeral(confirmMessage(result, parsed.status));
  }

  // Tout le reste (types non gérés) : ack silencieux.
  return SILENT_ACK;
}
