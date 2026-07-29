'use client';

// Réglages Discord d'une compétition.
//
// Principe : on ne montre JAMAIS une permission Discord. Il y en a une
// quarantaine par salon — les exposer reviendrait à déplacer le travail sur
// l'organisateur au lieu de le lui épargner. Il choisit QUI a accès, le reste
// est un jeu de permissions sain, affiché en clair sous les réglages pour
// qu'il sache exactement ce que le bot fera sur son serveur.
//
// Le serveur se saisit par son identifiant et se VÉRIFIE : seul son
// propriétaire ou un administrateur peut le désigner (garde côté serveur,
// rejouée au provisioning). Rôles et salons ne se chargent qu'une fois cette
// vérification passée — pas question de servir la cartographie d'un serveur
// qu'on n'administre pas.

import { useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api-client';
import { Switch } from '@/components/ui/Switch';

export interface DiscordSettingsValue {
  guildId: string;
  teamChannels: boolean;
  teamVoiceChannels: boolean;
  categoryName: string;
  staffRoleIds: string[];
  participantRoleName: string;
  announceChannelId: string;
  createAnnounceChannel: boolean;
  announceChannelName: string;
  staffChannelId: string;
  createStaffChannel: boolean;
  staffChannelName: string;
}

interface GuildAccess {
  guildName: string | null;
  botPresent: boolean;
  userManages: boolean;
  problems: string[];
}

interface GuildData {
  access: GuildAccess;
  roles: Array<{ id: string; name: string }>;
  channels: Array<{ id: string; name: string; category: string }>;
}

export default function DiscordSettings({ value, competitionName, teamCount, onChange }: {
  value: DiscordSettingsValue;
  competitionName: string;
  /** Effectif nominal : sert à annoncer le nombre de salons créés. */
  teamCount: number;
  onChange: (next: DiscordSettingsValue) => void;
}) {
  const [checking, setChecking] = useState(false);
  const [data, setData] = useState<GuildData | null>(null);
  const [error, setError] = useState<string | null>(null);

  const patch = (values: Partial<DiscordSettingsValue>) => onChange({ ...value, ...values });
  const guildId = value.guildId.trim();

  // Serveurs proposables : ceux où le bot est présent et qu'on administre.
  // `null` = pas encore chargés ; `[]` = aucun (on retombe sur la saisie
  // manuelle plutôt que d'afficher une liste vide et bloquante).
  const [guilds, setGuilds] = useState<Array<{ id: string; name: string }> | null>(null);
  const [manualEntry, setManualEntry] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await api<{ guilds: Array<{ id: string; name: string }> }>('/api/admin/competitions/discord-guilds');
        if (!cancelled) setGuilds(r.guilds ?? []);
      } catch {
        // Discord injoignable : la saisie manuelle reste un chemin valable.
        if (!cancelled) { setGuilds([]); setManualEntry(true); }
      }
    })();
    return () => { cancelled = true; };
  }, []);

  /** Changer de serveur OUBLIE ses salons et ses rôles : ils appartiennent à
   *  l'ancien, et les garder faisait annoncer le bot au mauvais endroit (et
   *  échouer la création des salons, les rôles étant inconnus du nouveau). */
  function selectGuild(nextGuildId: string) {
    patch({
      guildId: nextGuildId,
      staffRoleIds: [],
      announceChannelId: '',
      createAnnounceChannel: false,
      staffChannelId: '',
      createStaffChannel: false,
    });
    setData(null);
    setError(null);
  }

  async function check() {
    setChecking(true);
    setError(null);
    try {
      setData(await api<GuildData>('/api/admin/competitions/discord-guild', {
        method: 'POST',
        body: { guildId },
      }));
    } catch (e) {
      setData(null);
      setError(e instanceof ApiError ? e.message : 'Vérification impossible.');
    } finally {
      setChecking(false);
    }
  }

  const ready = data?.access.userManages === true;
  const channelsPerTeam = value.teamChannels ? (value.teamVoiceChannels ? 2 : 1) : 0;
  const totalChannels = channelsPerTeam * Math.max(0, teamCount);

  return (
    <div>
      <label className="t-label-soft block mb-3">Discord</label>

      <div className="flex flex-wrap items-end gap-3">
        <div style={{ minWidth: 260 }}>
          <label className="block text-sm mb-1" style={{ color: 'var(--s-text-dim)' }}>Serveur</label>
          {guilds === null ? (
            <p className="text-sm" style={{ color: 'var(--s-text-muted)' }}>Chargement des serveurs…</p>
          ) : guilds.length > 0 && !manualEntry ? (
            <select className="settings-input w-full" value={value.guildId}
              onChange={e => selectGuild(e.target.value)}>
              <option value="">Aucun serveur</option>
              {guilds.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
              {/* Un serveur enregistré avant que le bot en soit retiré ne
                  figure plus dans la liste : sans cette option, le champ
                  paraîtrait vide et un enregistrement l'effacerait en silence. */}
              {value.guildId && !guilds.some(g => g.id === value.guildId) && (
                <option value={value.guildId}>Serveur enregistré ({value.guildId})</option>
              )}
            </select>
          ) : (
            <input className="settings-input w-full" value={value.guildId}
              placeholder="Identifiant du serveur"
              onChange={e => selectGuild(e.target.value)} />
          )}
        </div>
        <button type="button" className="btn-springs btn-secondary bevel-sm text-sm"
          disabled={checking || !/^\d{17,20}$/.test(guildId)}
          onClick={check}>
          {checking ? 'Vérification…' : 'Vérifier'}
        </button>
      </div>

      {/* La liste ne peut pas tout montrer, et son absence de serveur attendu
          s'explique de deux façons seulement — autant les donner ici plutôt que
          de laisser chercher. */}
      <p className="text-xs mt-2" style={{ color: 'var(--s-text-muted)' }}>
        Seuls apparaissent les serveurs où le bot Aedral est déjà installé et dont tu es
        propriétaire ou administrateur. Si le serveur voulu manque, invite d&apos;abord le bot
        dessus depuis Ma structure → Bot Discord → « Inviter sur un autre serveur », puis
        recharge cette page.
        {guilds !== null && guilds.length > 0 && (
          <>
            {' '}
            <button type="button" className="quiet-link"
              onClick={() => setManualEntry(m => !m)}>
              {manualEntry ? 'Revenir à la liste' : 'Saisir un identifiant à la main'}
            </button>
          </>
        )}
      </p>

      {error && <p className="text-sm mt-2" style={{ color: 'var(--s-text)' }}>{error}</p>}

      {data && (
        <div className="mt-3 p-3" style={{ border: '1px solid var(--s-border)' }}>
          <p className="text-sm" style={{ color: 'var(--s-text)' }}>
            {data.access.guildName ?? 'Serveur inconnu'}
          </p>
          {data.access.problems.length === 0 ? (
            <p className="text-sm mt-1" style={{ color: 'var(--s-text-dim)' }}>
              Tout est en ordre : le bot peut créer les rôles et les salons.
            </p>
          ) : (
            <ul className="mt-1 space-y-0.5">
              {data.access.problems.map((p, i) => (
                <li key={i} className="text-sm" style={{ color: 'var(--s-text-dim)' }}>· {p}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {ready && data && (
        <div className="mt-4 space-y-5">
          {/* Annonces */}
          <div>
            <p className="text-sm mb-2" style={{ color: 'var(--s-text)' }}>Annonces publiques</p>
            <div className="flex flex-wrap items-center gap-3">
              <select className="settings-input" style={{ maxWidth: 280 }}
                aria-label="Salon d’annonces"
                value={value.createAnnounceChannel ? '__create' : value.announceChannelId}
                onChange={e => {
                  const v = e.target.value;
                  patch(v === '__create'
                    ? { createAnnounceChannel: true, announceChannelId: '' }
                    : { createAnnounceChannel: false, announceChannelId: v });
                }}>
                <option value="">Aucune annonce</option>
                <option value="__create">Créer un salon</option>
                {data.channels.map(c => (
                  <option key={c.id} value={c.id}>#{c.name} — {c.category}</option>
                ))}
              </select>
              {value.createAnnounceChannel && (
                <input className="settings-input" style={{ maxWidth: 220 }}
                  aria-label="Nom du salon d’annonces"
                  value={value.announceChannelName}
                  placeholder="annonces"
                  onChange={e => patch({ announceChannelName: e.target.value })} />
              )}
            </div>
            <p className="text-xs mt-1" style={{ color: 'var(--s-text-muted)' }}>
              Bracket publié, informations à tout le monde. Visible de tout le serveur ;
              seul le staff peut y écrire.
            </p>
          </div>

          {/* Alertes staff */}
          <div>
            <p className="text-sm mb-2" style={{ color: 'var(--s-text)' }}>Alertes du staff</p>
            <div className="flex flex-wrap items-center gap-3">
              <select className="settings-input" style={{ maxWidth: 280 }}
                aria-label="Salon des alertes staff"
                value={value.createStaffChannel ? '__create' : value.staffChannelId}
                onChange={e => {
                  const v = e.target.value;
                  patch(v === '__create'
                    ? { createStaffChannel: true, staffChannelId: '' }
                    : { createStaffChannel: false, staffChannelId: v });
                }}>
                <option value="">Aucune alerte</option>
                <option value="__create">Créer un salon privé</option>
                {data.channels.map(c => (
                  <option key={c.id} value={c.id}>#{c.name} — {c.category}</option>
                ))}
              </select>
              {value.createStaffChannel && (
                <input className="settings-input" style={{ maxWidth: 220 }}
                  aria-label="Nom du salon staff"
                  value={value.staffChannelName}
                  placeholder="staff-tournoi"
                  onChange={e => patch({ staffChannelName: e.target.value })} />
              )}
            </div>
            <p className="text-xs mt-1" style={{ color: 'var(--s-text-muted)' }}>
              Litige ouvert, forfait à valider, équipe absente au check-in. Sans ce salon,
              ces alertes n&apos;existent que dans la console.
            </p>
          </div>

          {/* Salons d'équipe */}
          <div>
            <Switch label="Un salon par équipe" value={value.teamChannels}
              onChange={v => patch({ teamChannels: v })} />
            {value.teamChannels && (
              <div className="mt-3 pl-2 space-y-3">
                <div className="flex flex-wrap items-end gap-3">
                  <div style={{ minWidth: 240 }}>
                    <label className="block text-sm mb-1" style={{ color: 'var(--s-text-dim)' }}>Catégorie</label>
                    <input className="settings-input w-full" value={value.categoryName}
                      maxLength={90}
                      placeholder={competitionName || 'Nom du tournoi'}
                      onChange={e => patch({ categoryName: e.target.value })} />
                  </div>
                  <div className="pb-1">
                    <Switch label="Ajouter un salon vocal" value={value.teamVoiceChannels}
                      onChange={v => patch({ teamVoiceChannels: v })} />
                  </div>
                </div>
                <p className="text-xs" style={{ color: 'var(--s-text-muted)' }}>
                  {totalChannels} salons pour {teamCount} équipes.
                  {totalChannels > 50 && ' Au-delà de 50 salons, le bot ouvre une seconde catégorie (limite Discord).'}
                </p>
              </div>
            )}
          </div>

          {/* Staff */}
          <div>
            <p className="text-sm mb-1" style={{ color: 'var(--s-text)' }}>Rôles du staff</p>
            <p className="text-xs mb-2" style={{ color: 'var(--s-text-muted)' }}>
              Ces rôles voient et écrivent dans tous les salons du tournoi. Sans eux, seuls
              les administrateurs du serveur y ont accès.
            </p>
            <div className="flex flex-wrap gap-2">
              {data.roles.length === 0 && (
                <span className="text-sm" style={{ color: 'var(--s-text-muted)' }}>Aucun rôle sur ce serveur.</span>
              )}
              {data.roles.map(role => {
                const on = value.staffRoleIds.includes(role.id);
                return (
                  <button key={role.id} type="button"
                    className={`tag ${on ? 'tag-gold' : 'tag-neutral'}`}
                    style={{ cursor: 'pointer' }}
                    aria-pressed={on}
                    onClick={() => patch({
                      staffRoleIds: on
                        ? value.staffRoleIds.filter(id => id !== role.id)
                        : [...value.staffRoleIds, role.id].slice(0, 10),
                    })}>
                    {role.name}
                  </button>
                );
              })}
            </div>
          </div>

          <div style={{ maxWidth: 420 }}>
            <label className="block text-sm mb-1" style={{ color: 'var(--s-text-dim)' }}>Nom du rôle participant</label>
            <input className="settings-input w-full" value={value.participantRoleName}
              maxLength={90}
              placeholder={`Participant · ${competitionName || 'nom du tournoi'}`}
              onChange={e => patch({ participantRoleName: e.target.value })} />
          </div>

          <PermissionsRecap teamChannels={value.teamChannels} voice={value.teamVoiceChannels} />
        </div>
      )}
    </div>
  );
}

/** Ce que le bot accordera, en clair et avant de valider : l'organisateur doit
 *  savoir ce qui va se passer sur son serveur. Miroir de CHANNEL_GRANTS. */
function PermissionsRecap({ teamChannels, voice }: { teamChannels: boolean; voice: boolean }) {
  if (!teamChannels) return null;
  return (
    <div style={{ border: '1px solid var(--s-border)' }}>
      <p className="t-label-soft px-3 py-2" style={{ background: 'var(--s-elevated)' }}>
        Permissions posées sur les salons d’équipe
      </p>
      <Row who="Tout le serveur" what="ne voit pas les salons d’équipe" />
      <Row who="Les joueurs de l’équipe"
        what={`écrire, joindre des images, lire l’historique${voice ? ' · parler en vocal' : ''}`} />
      <Row who="Les rôles du staff"
        what={`écrire, joindre des images, supprimer des messages${voice ? ' · couper les micros' : ''}`} />
    </div>
  );
}

function Row({ who, what }: { who: string; what: string }) {
  return (
    <div className="flex flex-wrap items-baseline gap-2 px-3 py-1.5"
      style={{ borderTop: '1px solid var(--s-border)' }}>
      <span className="text-sm" style={{ minWidth: 180, color: 'var(--s-text-dim)' }}>{who}</span>
      <span className="text-sm" style={{ color: 'var(--s-text-muted)' }}>{what}</span>
    </div>
  );
}
