// Synchronisation Discord ↔ site : pseudo serveur « [TAG] Pseudo » + rôles de
// fonction (Membre / Admin / Fondateur structure / Manager / Coach / Joueur en
// équipe / Joueur libre) sur le serveur communautaire Aedral.
//
// Le nombre de rôles est FIXE (7) → aucune limite de scaling, contrairement à
// « un rôle par structure ». L'appartenance à une structure passe par le tag
// du pseudo, qui scale à l'infini.
//
// Fonctions côté serveur uniquement (token bot). Ne throw jamais.

import type { Firestore } from 'firebase-admin/firestore';
import { captureApiError } from '@/lib/sentry';
import { AEDRAL_GUILD_ID } from '@/lib/admin-discord-alert';

const DISCORD_API = 'https://discord.com/api/v10';
const ROLES_CONFIG_DOC = 'app_config/discord_roles';
const NICK_MAX = 32; // limite Discord du pseudo serveur

type RoleKey =
  | 'membre' | 'admin' | 'fondateur' | 'manager' | 'coach'
  | 'joueur_equipe' | 'joueur_libre';

// Ordre = hiérarchie souhaitée (le 1er sera le plus « haut »). Le bot crée les
// rôles manquants ; l'admin peut ensuite ajuster couleurs/positions à la main.
const MANAGED_ROLES: { key: RoleKey; name: string; color: number }[] = [
  { key: 'admin', name: 'Admin Aedral', color: 0xffb800 },
  { key: 'fondateur', name: 'Fondateur structure', color: 0xe0a23c },
  { key: 'manager', name: 'Manager', color: 0x4da6ff },
  { key: 'coach', name: 'Coach', color: 0x33d17a },
  { key: 'joueur_equipe', name: 'Joueur en équipe', color: 0x9aa0b4 },
  { key: 'joueur_libre', name: 'Joueur libre', color: 0x00d9b5 },
  { key: 'membre', name: 'Membre Aedral', color: 0x6a6a8a },
];

export type SyncResult = 'synced' | 'not_on_server' | 'no_discord_id' | 'disabled' | 'error';

function botToken(): string | null {
  return process.env.DISCORD_BOT_TOKEN ?? null;
}

async function discord(path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${DISCORD_API}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bot ${botToken()}`,
      ...(init?.headers ?? {}),
    },
  });
}

// Crée les rôles gérés manquants sur le serveur Aedral, renvoie la map key→id.
async function ensureManagedRoles(db: Firestore): Promise<Partial<Record<RoleKey, string>>> {
  const ref = db.doc(ROLES_CONFIG_DOC);
  const snap = await ref.get();
  const stored = (snap.data()?.roleIds ?? {}) as Partial<Record<RoleKey, string>>;

  const rolesRes = await discord(`/guilds/${AEDRAL_GUILD_ID}/roles`);
  const guildRoles: { id: string; name: string }[] = rolesRes.ok ? await rolesRes.json() : [];

  const result: Partial<Record<RoleKey, string>> = {};
  let changed = false;

  for (const role of MANAGED_ROLES) {
    const known = stored[role.key];
    if (known && guildRoles.some(r => r.id === known)) {
      result[role.key] = known;
      continue;
    }
    // Rôle déjà présent par son nom (config perdue) — on le réutilise.
    const byName = guildRoles.find(r => r.name === role.name);
    if (byName) {
      result[role.key] = byName.id;
      changed = true;
      continue;
    }
    // Sinon : création.
    const createRes = await discord(`/guilds/${AEDRAL_GUILD_ID}/roles`, {
      method: 'POST',
      body: JSON.stringify({ name: role.name, color: role.color, mentionable: true, hoist: false }),
    });
    if (createRes.ok) {
      const created = await createRes.json();
      result[role.key] = created.id as string;
      changed = true;
    }
  }

  if (changed) {
    await ref.set({ roleIds: result, updatedAt: new Date().toISOString() }, { merge: true });
  }
  return result;
}

type UserProfile = { pseudo: string; tags: string[]; roleKeys: RoleKey[] };

// Calcule l'état « cible » d'un membre : pseudo, tags de structure, rôles.
async function computeUserProfile(db: Firestore, userId: string): Promise<UserProfile | null> {
  const userSnap = await db.collection('users').doc(userId).get();
  if (!userSnap.exists) return null;
  const u = userSnap.data()!;
  const pseudo = ((u.displayName as string) || (u.discordUsername as string) || 'Joueur').trim();

  const roleKeys = new Set<RoleKey>(['membre']);

  const adminSnap = await db.collection('aedral_admins').doc(userId).get();
  if (adminSnap.exists) roleKeys.add('admin');

  if (u.isAvailableForRecruitment === true) roleKeys.add('joueur_libre');

  // Structures du joueur via `structure_members` — source fiable qui couvre
  // TOUT le monde (fondateurs inclus). `structurePerGame` ne se remplit qu'à
  // l'adhésion à une structure, pas à sa création → un fondateur y serait absent.
  const membersSnap = await db.collection('structure_members')
    .where('userId', '==', userId)
    .get();
  const structureIds = [...new Set(
    membersSnap.docs.map(d => d.data().structureId as string).filter(Boolean),
  )];
  const tags: string[] = [];

  if (structureIds.length > 0) {
    const structSnaps = await db.getAll(
      ...structureIds.slice(0, 30).map(id => db.collection('structures').doc(id)),
    );
    for (const s of structSnaps) {
      if (!s.exists) continue;
      const sd = s.data()!;
      // On ne saute que les structures refusées : une structure en attente de
      // validation a quand même un vrai fondateur — il doit avoir son rôle.
      if (sd.status === 'rejected') continue;
      if (sd.tag) tags.push(String(sd.tag));
      if (sd.founderId === userId || (sd.coFounderIds ?? []).includes(userId)) roleKeys.add('fondateur');
      if ((sd.managerIds ?? []).includes(userId)) roleKeys.add('manager');
      if ((sd.coachIds ?? []).includes(userId)) roleKeys.add('coach');
    }
    // Joueur en équipe : présent dans le roster d'une sous-équipe.
    const teamsSnap = await db.collection('sub_teams')
      .where('structureId', 'in', structureIds.slice(0, 30))
      .get();
    for (const t of teamsSnap.docs) {
      const td = t.data();
      if ([...(td.playerIds ?? []), ...(td.subIds ?? [])].includes(userId)) {
        roleKeys.add('joueur_equipe');
        break;
      }
    }
  }

  return { pseudo, tags: [...new Set(tags)], roleKeys: [...roleKeys] };
}

// Construit le pseudo serveur « [TAG] Pseudo » (ou « [T1·T2] Pseudo »),
// tronqué à 32 caractères en gardant les tags prioritaires.
function buildNick(pseudo: string, tags: string[]): string {
  if (tags.length === 0) return pseudo.slice(0, NICK_MAX);
  const prefix = `[${tags.join('·')}] `;
  const room = NICK_MAX - prefix.length;
  if (room <= 0) return prefix.slice(0, NICK_MAX);
  return (prefix + pseudo.slice(0, room)).slice(0, NICK_MAX);
}

// Synchronise un membre du serveur Aedral. Ne throw jamais.
export async function syncDiscordMember(db: Firestore, userId: string): Promise<SyncResult> {
  try {
    if (!botToken()) return 'disabled';
    if (!userId.startsWith('discord_')) return 'no_discord_id';
    const discordId = userId.slice('discord_'.length);

    // Le bot ne peut agir que si le joueur a rejoint le serveur Aedral.
    const memberRes = await discord(`/guilds/${AEDRAL_GUILD_ID}/members/${discordId}`);
    if (memberRes.status === 404) return 'not_on_server';
    if (!memberRes.ok) throw new Error(`get member failed: ${memberRes.status}`);
    const member = await memberRes.json();
    const currentRoles: string[] = Array.isArray(member.roles) ? member.roles : [];

    const profile = await computeUserProfile(db, userId);
    if (!profile) return 'error';

    const roleIds = await ensureManagedRoles(db);
    const managedIds = new Set(Object.values(roleIds).filter(Boolean) as string[]);
    const targetIds = profile.roleKeys
      .map(k => roleIds[k])
      .filter((x): x is string => !!x);

    // Rôles finaux = rôles non gérés conservés + rôles cibles gérés.
    const finalRoles = [
      ...currentRoles.filter(r => !managedIds.has(r)),
      ...targetIds,
    ];
    const rolesChanged =
      finalRoles.length !== currentRoles.length
      || finalRoles.some(r => !currentRoles.includes(r));

    if (rolesChanged) {
      await discord(`/guilds/${AEDRAL_GUILD_ID}/members/${discordId}`, {
        method: 'PATCH',
        body: JSON.stringify({ roles: finalRoles }),
      });
    }

    // Pseudo serveur — appel séparé : échoue (sans bloquer les rôles) si le
    // membre est plus haut que le bot dans la hiérarchie (ex : propriétaire).
    const nick = buildNick(profile.pseudo, profile.tags);
    if ((member.nick ?? '') !== nick) {
      await discord(`/guilds/${AEDRAL_GUILD_ID}/members/${discordId}`, {
        method: 'PATCH',
        body: JSON.stringify({ nick }),
      });
    }

    return 'synced';
  } catch (err) {
    captureApiError('syncDiscordMember error', err);
    return 'error';
  }
}
