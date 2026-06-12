'use client';

import { useState, type RefObject, type ReactNode, type Dispatch, type SetStateAction } from 'react';
import Image from 'next/image';
import {
  Shield, Trophy, Loader2, AlertCircle,
  Save, Plus, Trash2, CheckCircle,
  Link2, MessageSquare, Settings, Check, X, BookOpen, Gamepad2, Users,
} from 'lucide-react';
import { api, ApiError } from '@/lib/api-client';
import { useToast } from '@/components/ui/Toast';
import ImageUploader from '@/components/ui/ImageUploader';
import BannerFocusEditor from '@/components/structure/BannerFocusEditor';
import StorageQuotaCard from '@/components/structure/StorageQuotaCard';
import { RolesHelpModal } from '@/components/structure/RoleInfoPanel';
import { UPLOAD_LIMITS } from '@/lib/upload-limits';
import type { MyStructure, TeamData } from '../types';
import type { BannerFocus } from '@/types';
import { SOCIAL_LABELS, STATUS_INFO } from '../constants';
import { SectionPanel } from '../components';
import GameTag from '@/components/games/GameTag';
import { ALL_GAME_DEFS, getGameColor } from '@/lib/games-registry';
import PublicPreviewFrame from '@/components/ui/PublicPreviewFrame';
import MarkdownEditor from '@/components/ui/MarkdownEditor';
import { getStructureHref } from '@/lib/structure-slug';

type Achievement = { placement: string; competition: string; game: string; date: string };

type DiscordConfigScope =
  | { scope: 'structure' | 'staff' }
  | { scope: 'game'; game: string };

type DiscordConfigBlockOpts = {
  key: string;
  scope: DiscordConfigScope;
  label: string;
  accentColor: string;
  currentChannelId: string | null;
  currentChannelName: string | null;
  currentRoleId: string | null;
  currentRoleName: string | null;
};

type GeneralTabProps = {
  s: MyStructure;
  activeStructure: MyStructure | null;
  setActiveStructure: (s: MyStructure | null) => void;
  loadStructures: () => Promise<void> | void;

  editDesc: string;
  setEditDesc: Dispatch<SetStateAction<string>>;
  descRef: RefObject<HTMLTextAreaElement | null>;
  editLogoUrl: string;
  setEditLogoUrl: Dispatch<SetStateAction<string>>;
  editCoverFocus: BannerFocus | null;
  setEditCoverFocus: Dispatch<SetStateAction<BannerFocus | null>>;
  editDiscordUrl: string;
  setEditDiscordUrl: Dispatch<SetStateAction<string>>;
  editSocials: Record<string, string>;
  setEditSocials: Dispatch<SetStateAction<Record<string, string>>>;
  editAchievements: Achievement[];
  setEditAchievements: Dispatch<SetStateAction<Achievement[]>>;

  discordLoading: boolean;
  handleConnectDiscord: () => void;
  handleDisconnectDiscord: () => void;
  renderDiscordConfigBlock: (opts: DiscordConfigBlockOpts) => ReactNode;

  handleSave: () => void;
  saving: boolean;
  saved: boolean;
  error: string | null;

  isDirigeantOfActive: boolean;
  collapsed: Record<string, boolean>;
  toggle: (key: string) => void;

  teams: TeamData[];
};

export function GeneralTab(props: GeneralTabProps) {
  const {
    s, activeStructure, setActiveStructure, loadStructures,
    editDesc, setEditDesc, descRef,
    editLogoUrl, setEditLogoUrl, editCoverFocus, setEditCoverFocus,
    editDiscordUrl, setEditDiscordUrl,
    editSocials, setEditSocials, editAchievements, setEditAchievements,
    discordLoading, handleConnectDiscord, handleDisconnectDiscord, renderDiscordConfigBlock,
    handleSave, saving, saved, error,
    isDirigeantOfActive, collapsed, toggle, teams,
  } = props;

  const statusInfo = STATUS_INFO[s.status] ?? STATUS_INFO.pending_validation;

  // Modal d'aide "Rôles & permissions", déclenchable depuis le bouton bas de
  // la sidebar droite. Permet aux dirigeants de consulter la matrice complète
  // sans devoir quitter la page.
  const [rolesHelpOpen, setRolesHelpOpen] = useState(false);

  // ─── JEUX PRATIQUÉS (édition dirigeant) ────────────────────────────────
  // State local + save dédié (act structural séparé du handleSave global).
  const toast = useToast();
  const [editGames, setEditGames] = useState<string[]>(() => s.games ?? []);
  const [savingGames, setSavingGames] = useState(false);
  const gamesDirty = (() => {
    const a = [...(s.games ?? [])].sort();
    const b = [...editGames].sort();
    if (a.length !== b.length) return true;
    return a.some((v, i) => v !== b[i]);
  })();
  function toggleGame(gameId: string) {
    setEditGames(prev =>
      prev.includes(gameId) ? prev.filter(g => g !== gameId) : [...prev, gameId]
    );
  }
  async function handleSaveGames() {
    if (!gamesDirty || editGames.length === 0) return;
    setSavingGames(true);
    try {
      await api('/api/structures/my', {
        method: 'PUT',
        body: { structureId: s.id, games: editGames },
      });
      toast.success('Jeux de la structure mis à jour');
      await loadStructures();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Erreur réseau');
    } finally {
      setSavingGames(false);
    }
  }

  return (
    <div className="grid gap-6 animate-fade-in grid-cols-1 lg:grid-cols-3">
      {/* ─── Colonne gauche ──────── */}
      <div className="lg:col-span-2 space-y-6">
        {/* DESCRIPTION */}
        <SectionPanel accent="var(--s-gold)" icon={MessageSquare} title="DESCRIPTION"
          collapsed={collapsed.desc} onToggle={() => toggle('desc')}>
          {/* Éditeur partagé (toggle Écrire | Aperçu) — remplace l'ancienne copie
              inline dont l'aperçu permanent doublait la hauteur du panneau.
              maxLength aligné sur LIMITS.structureDescription (serveur). */}
          <MarkdownEditor
            value={editDesc}
            onChange={setEditDesc}
            placeholder="Présente ta structure..."
            maxLength={5000}
            rows={5}
            taRef={descRef}
          />
        </SectionPanel>

        {/* JEUX PRATIQUÉS, act structural, save dédié.
            Visible et éditable par les dirigeants uniquement.
            Affiché en 2e position (après DESCRIPTION) car c'est ce qui
            détermine ce que la structure peut faire (équipes, recrutement…). */}
        <SectionPanel accent="var(--s-gold)" icon={Gamepad2} title="JEUX PRATIQUÉS"
          collapsed={collapsed.games} onToggle={() => toggle('games')}>
          <div className="space-y-4">
            <p className="text-sm" style={{ color: 'var(--s-text-dim)' }}>
              Active les jeux où ta structure est active. Cocher un jeu débloque
              la création d'équipes pour ce jeu, le recrutement et le calendrier
              dédié. Décocher un jeu est bloqué tant qu'il reste des équipes
              actives sur ce jeu.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {ALL_GAME_DEFS.map(g => {
                const active = editGames.includes(g.id);
                return (
                  <button
                    key={g.id}
                    type="button"
                    disabled={!isDirigeantOfActive}
                    onClick={() => toggleGame(g.id)}
                    className="p-4 text-left transition-all duration-150 relative overflow-hidden"
                    style={{
                      background: active ? `rgba(${g.colorRgb}, 0.10)` : 'var(--s-elevated)',
                      border: active
                        ? `2px solid rgba(${g.colorRgb}, 0.5)`
                        : '2px solid var(--s-border)',
                      cursor: isDirigeantOfActive ? 'pointer' : 'not-allowed',
                      opacity: isDirigeantOfActive ? 1 : 0.6,
                    }}
                  >
                    {active && (
                      <div
                        className="absolute top-0 right-0 w-24 h-24 pointer-events-none opacity-[0.10]"
                        style={{ background: `radial-gradient(circle at top right, ${g.color}, transparent 70%)` }}
                      />
                    )}
                    <div className="relative z-[1] flex items-center gap-3">
                      <div
                        className="w-9 h-9 flex items-center justify-center flex-shrink-0"
                        style={{
                          background: `rgba(${g.colorRgb}, 0.10)`,
                          border: `1px solid rgba(${g.colorRgb}, 0.25)`,
                        }}
                      >
                        <Gamepad2 size={16} style={{ color: g.color }} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p
                          className="text-sm font-semibold truncate"
                          style={{ color: active ? g.colorLight : 'var(--s-text)' }}
                        >
                          {g.label}
                        </p>
                        <p className="text-xs mt-0.5" style={{ color: 'var(--s-text-muted)' }}>
                          {g.shortLabel} · {g.roster.allowSolo ? 'Solo' : `${g.roster.titulaires}v${g.roster.titulaires}`}
                        </p>
                      </div>
                      {active && (
                        <CheckCircle size={16} className="flex-shrink-0" style={{ color: g.color }} />
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
            {isDirigeantOfActive && (
              <div className="flex items-center gap-3 pt-2">
                <button
                  type="button"
                  onClick={handleSaveGames}
                  disabled={!gamesDirty || savingGames || editGames.length === 0}
                  className="btn-springs btn-primary bevel-sm flex items-center gap-2 px-4 py-2"
                  style={{
                    fontSize: '13px',
                    opacity: !gamesDirty || editGames.length === 0 ? 0.5 : 1,
                    cursor: !gamesDirty || editGames.length === 0 ? 'not-allowed' : 'pointer',
                  }}
                >
                  {savingGames ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
                  {savingGames ? 'Enregistrement…' : 'Enregistrer les jeux'}
                </button>
                {gamesDirty && (
                  <span className="text-xs" style={{ color: 'var(--s-gold)' }}>
                    ⚠ Changement non enregistré
                  </span>
                )}
                {editGames.length === 0 && (
                  <span className="text-xs" style={{ color: '#ff8888' }}>
                    Au moins un jeu requis
                  </span>
                )}
              </div>
            )}
            {!isDirigeantOfActive && (
              <p className="text-xs italic" style={{ color: 'var(--s-text-muted)' }}>
                Seuls les dirigeants (fondateur + cofondateurs) peuvent modifier les jeux activés.
              </p>
            )}
          </div>
        </SectionPanel>

        {/* CONFIGURATION */}
        <SectionPanel accent="var(--s-gold)" icon={Settings} title="CONFIGURATION"
          collapsed={collapsed.config} onToggle={() => toggle('config')}>
          <div className="space-y-5">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              <ImageUploader
                label="Logo de la structure"
                hint="Carré, idéalement fond transparent. Max 2 MB."
                aspect="square"
                maxBytes={UPLOAD_LIMITS.STRUCTURE_LOGO_BYTES}
                currentUrl={activeStructure?.logoUrl || editLogoUrl || null}
                endpoint="/api/upload/structure-image"
                extraFields={{ structureId: activeStructure?.id || '', type: 'logo' }}
                disabled={!activeStructure}
                onUploaded={(url) => {
                  setEditLogoUrl(url);
                  if (activeStructure) setActiveStructure({ ...activeStructure, logoUrl: url });
                  void loadStructures();
                }}
              />
              <div>
                <label className="t-label block mb-2">Serveur Discord</label>
                <input type="url" className="settings-input w-full"
                  value={editDiscordUrl} onChange={e => setEditDiscordUrl(e.target.value)}
                  placeholder="https://discord.gg/..." />
              </div>
            </div>
            <ImageUploader
              label="Bannière de la page publique"
              hint="Format paysage large recommandé. Max 5 MB."
              aspect="banner"
              maxBytes={UPLOAD_LIMITS.STRUCTURE_BANNER_BYTES}
              currentUrl={activeStructure?.coverUrl || null}
              endpoint="/api/upload/structure-image"
              extraFields={{ structureId: activeStructure?.id || '', type: 'banner' }}
              disabled={!activeStructure}
              onUploaded={(url) => {
                if (activeStructure) setActiveStructure({ ...activeStructure, coverUrl: url });
                void loadStructures();
              }}
            />
            {/* Éditeur de point focal : image entière + point déplaçable.
                Le coverFocus est appliqué tel quel (background-position) à l'affichage. */}
            {activeStructure?.coverUrl && (
              <BannerFocusEditor
                imageUrl={activeStructure.coverUrl}
                value={editCoverFocus}
                onChange={setEditCoverFocus}
                disabled={!isDirigeantOfActive}
              />
            )}
          </div>
        </SectionPanel>

        {/* BOT DISCORD */}
        <SectionPanel accent="#5865F2" icon={MessageSquare} title="BOT DISCORD"
          collapsed={collapsed.discordBot} onToggle={() => toggle('discordBot')}>
          {activeStructure?.discordIntegration ? (
            <div className="space-y-4">
              <div className="flex items-center gap-3 p-3 bevel-sm"
                style={{ background: 'rgba(88,101,242,0.08)', border: '1px solid rgba(88,101,242,0.25)' }}>
                <div className="flex items-center justify-center w-10 h-10 bevel-sm"
                  style={{ background: 'rgba(88,101,242,0.2)', border: '1px solid rgba(88,101,242,0.4)' }}>
                  <Check size={18} style={{ color: '#5865F2' }} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="t-sub truncate">Connecté à {activeStructure.discordIntegration.guildName}</div>
                  <div className="text-xs" style={{ color: 'var(--s-text-muted)' }}>
                    Le bot peut poster les notifs d&apos;événements dans les salons d&apos;équipe.
                  </div>
                </div>
              </div>
              <div className="space-y-2">
                <div className="t-label flex items-center gap-2" style={{ color: 'var(--s-text-dim)' }}>
                  <Settings size={12} />
                  Salons & rôles par scope
                </div>
                <p className="text-xs" style={{ color: 'var(--s-text-muted)' }}>
                  Pour les events qui ciblent toute la structure, un jeu entier,
                  ou le staff : choisis le salon où poster et le rôle à ping.
                  Les salons par équipe se configurent directement sur la card
                  de chaque équipe.
                </p>
                {renderDiscordConfigBlock({
                  key: 'structure',
                  scope: { scope: 'structure' },
                  label: 'Toute la structure',
                  accentColor: '#FFB800',
                  currentChannelId: activeStructure.discordIntegration.structureChannelId ?? null,
                  currentChannelName: activeStructure.discordIntegration.structureChannelName ?? null,
                  currentRoleId: activeStructure.discordIntegration.structureRoleId ?? null,
                  currentRoleName: activeStructure.discordIntegration.structureRoleName ?? null,
                })}
                {/* Bloc Discord config par jeu, généré depuis la registry pour
                    chaque jeu pratiqué par la structure. Ajouter un jeu dans
                    la registry fait apparaître son bloc Discord auto. */}
                {ALL_GAME_DEFS.filter(g => activeStructure.games.includes(g.id)).map(g => {
                  const gameCh = (activeStructure.discordIntegration!.gameChannels as Record<string, { channelId?: string; channelName?: string; roleId?: string; roleName?: string } | undefined> | undefined)?.[g.id];
                  return renderDiscordConfigBlock({
                    key: `game:${g.id}`,
                    scope: { scope: 'game', game: g.id },
                    label: g.label,
                    accentColor: g.color,
                    currentChannelId: gameCh?.channelId ?? null,
                    currentChannelName: gameCh?.channelName ?? null,
                    currentRoleId: gameCh?.roleId ?? null,
                    currentRoleName: gameCh?.roleName ?? null,
                  });
                })}
                {renderDiscordConfigBlock({
                  key: 'staff',
                  scope: { scope: 'staff' },
                  label: 'Staff',
                  accentColor: 'var(--s-gold)',
                  currentChannelId: activeStructure.discordIntegration.staffChannelId ?? null,
                  currentChannelName: activeStructure.discordIntegration.staffChannelName ?? null,
                  currentRoleId: activeStructure.discordIntegration.staffRoleId ?? null,
                  currentRoleName: activeStructure.discordIntegration.staffRoleName ?? null,
                })}
              </div>
              <div className="flex justify-end pt-2 border-t" style={{ borderColor: 'var(--s-border)' }}>
                <button type="button"
                  className="btn-springs btn-secondary bevel-sm flex items-center gap-2"
                  disabled={discordLoading}
                  onClick={handleDisconnectDiscord}>
                  {discordLoading ? <Loader2 size={14} className="animate-spin" /> : <X size={14} />}
                  Déconnecter
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <p className="text-sm" style={{ color: 'var(--s-text-dim)' }}>
                Connecte le bot Aedral à ton serveur Discord pour recevoir
                automatiquement les notifications d&apos;événements dans le salon
                de chaque équipe. Tu pourras choisir le salon par équipe après la connexion.
              </p>
              <div className="p-3 bevel-sm text-xs space-y-1"
                style={{ background: 'rgba(255,184,0,0.05)', border: '1px solid rgba(255,184,0,0.2)', color: 'var(--s-text-dim)' }}>
                <div className="flex items-center gap-2 font-medium" style={{ color: 'var(--s-gold)' }}>
                  <AlertCircle size={12} />
                  Le bot demande la permission Administrator
                </div>
                <p>
                  C&apos;est nécessaire pour poster dans les salons privés des équipes
                  sans que tu doives ajouter le bot manuellement sur chaque salon. Le bot
                  ne fait rien d&apos;autre que poster des embeds d&apos;événements ,
                  tu peux révoquer son accès à tout moment en le retirant du serveur.
                </p>
              </div>
              <button type="button"
                className="btn-springs btn-primary bevel-sm flex items-center gap-2"
                disabled={discordLoading}
                onClick={handleConnectDiscord}>
                {discordLoading ? <Loader2 size={14} className="animate-spin" /> : <MessageSquare size={14} />}
                Connecter Discord
              </button>
            </div>
          )}
        </SectionPanel>

        {/* RÉSEAUX SOCIAUX */}
        <SectionPanel accent="#5865F2" icon={Link2} title="RÉSEAUX SOCIAUX"
          collapsed={collapsed.socials} onToggle={() => toggle('socials')}>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3">
            {Object.entries(SOCIAL_LABELS).map(([key, label]) => (
              <div key={key}>
                <label className="t-label block mb-1.5">{label}</label>
                <input type="url" className="settings-input w-full" placeholder="https://..."
                  value={editSocials[key] || ''}
                  onChange={e => setEditSocials({ ...editSocials, [key]: e.target.value })} />
              </div>
            ))}
          </div>
        </SectionPanel>

        {/* PALMARÈS */}
        <SectionPanel accent="var(--s-gold)" icon={Trophy} title="PALMARÈS"
          collapsed={collapsed.palmares} onToggle={() => toggle('palmares')}
          action={
            <button type="button" onClick={() => setEditAchievements([...editAchievements, { placement: '', competition: '', game: s.games[0] || ALL_GAME_DEFS[0]?.id, date: '' }])}
              className="flex items-center gap-1.5 text-xs font-bold transition-colors duration-150" style={{ color: 'var(--s-gold)' }}>
              <Plus size={11} /> Ajouter
            </button>
          }>
          {editAchievements.length === 0 ? (
            <div className="text-center py-4">
              <Trophy size={20} className="mx-auto mb-2" style={{ color: 'var(--s-text-muted)' }} />
              <p className="text-xs" style={{ color: 'var(--s-text-muted)' }}>Aucun résultat enregistré.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {editAchievements.map((a, i) => (
                <div key={i} className="p-3 space-y-2.5" style={{ background: 'var(--s-elevated)', border: '1px solid var(--s-border)' }}>
                  <div className="flex items-start gap-2">
                    <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <div>
                        <label className="t-label block mb-1">Placement *</label>
                        <select className="settings-input w-full" value={a.placement}
                          onChange={e => {
                            const achs = [...editAchievements];
                            achs[i] = { ...a, placement: e.target.value };
                            setEditAchievements(achs);
                          }}>
                          <option value="">Choisir...</option>
                          <option value="1er">1er</option>
                          <option value="2e">2e</option>
                          <option value="3e">3e</option>
                          <option value="Top 4">Top 4</option>
                          <option value="Top 8">Top 8</option>
                          <option value="Top 16">Top 16</option>
                          <option value="Demi-finale">Demi-finale</option>
                          <option value="Quart de finale">Quart de finale</option>
                          <option value="Participant">Participant</option>
                        </select>
                      </div>
                      <div>
                        <label className="t-label block mb-1">Compétition *</label>
                        <input type="text" className="settings-input w-full" placeholder="Springs Cup S2"
                          value={a.competition} onChange={e => {
                            const achs = [...editAchievements];
                            achs[i] = { ...a, competition: e.target.value };
                            setEditAchievements(achs);
                          }} />
                      </div>
                    </div>
                    <button type="button" onClick={() => setEditAchievements(editAchievements.filter((_, j) => j !== i))}
                      className="mt-3 p-1" style={{ color: '#ff5555' }}>
                      <Trash2 size={13} />
                    </button>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <div>
                      <label className="t-label block mb-1">Jeu</label>
                      <select className="settings-input w-full" value={a.game}
                        onChange={e => {
                          const achs = [...editAchievements];
                          achs[i] = { ...a, game: e.target.value };
                          setEditAchievements(achs);
                        }}>
                        {ALL_GAME_DEFS.map(g => (
                          <option key={g.id} value={g.id}>{g.label}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="t-label block mb-1">Date</label>
                      <input type="month" className="settings-input w-full"
                        value={a.date} onChange={e => {
                          const achs = [...editAchievements];
                          achs[i] = { ...a, date: e.target.value };
                          setEditAchievements(achs);
                        }} />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </SectionPanel>

        {/* SAVE */}
        {isDirigeantOfActive && (<>
          {error && (
            <div className="flex items-center gap-2 px-4 py-3 bevel-sm" style={{ background: 'rgba(255,50,50,0.08)', border: '1px solid rgba(255,50,50,0.25)' }}>
              <AlertCircle size={14} style={{ color: '#ff5555' }} />
              <span className="text-sm" style={{ color: '#ff5555' }}>{error}</span>
            </div>
          )}
          <button onClick={handleSave} disabled={saving}
            className="btn-springs btn-primary bevel-sm flex items-center gap-2 px-6 py-3">
            {saving ? <Loader2 size={15} className="animate-spin" /> : saved ? <CheckCircle size={15} /> : <Save size={15} />}
            <span className="font-display text-sm tracking-wider">
              {saving ? 'SAUVEGARDE...' : saved ? 'SAUVEGARDÉ !' : 'SAUVEGARDER'}
            </span>
          </button>
        </>)}
      </div>

      {/* ─── Colonne droite ──────── */}
      <div className="space-y-6 animate-fade-in-d2">
        {/* APERÇU PUBLIC — carte annuaire telle que les visiteurs la voient.
            Placée ICI (et plus au-dessus de la TabBar) pour ne pas faire sauter
            la nav entre les onglets ; elle reflète en direct les réglages
            édités dans cet onglet (logo, jeux, recrutement). */}
        {s.status === 'active' && (
          <PublicPreviewFrame
            href={getStructureHref(s)}
            helper="Ta carte telle qu'elle apparaît dans l'annuaire des structures et les feeds communauté."
          >
            <div
              className="panel bevel relative overflow-hidden"
              style={{ background: 'var(--s-surface)', border: '1px solid var(--s-border)' }}
            >
              <div
                className="h-[3px]"
                style={(() => {
                  // Couleur principale = 1er jeu de la registry présent dans la structure
                  const mainGame = ALL_GAME_DEFS.find(g => s.games.includes(g.id))?.id ?? s.games[0];
                  const color = getGameColor(mainGame);
                  return { background: `linear-gradient(90deg, ${color}, transparent 70%)` };
                })()}
              />
              <div className="p-5">
                <div className="flex items-center gap-4 mb-4">
                  <div
                    className="w-14 h-14 flex-shrink-0 relative overflow-hidden"
                    style={{ background: 'var(--s-elevated)', border: '1px solid var(--s-border)' }}
                  >
                    {s.logoUrl ? (
                      <Image src={s.logoUrl} alt={s.name} fill className="object-contain p-1" unoptimized />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <Shield size={20} style={{ color: 'var(--s-text-muted)' }} />
                      </div>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="font-display text-lg tracking-wider truncate">{s.name}</h3>
                      <span
                        className="tag tag-neutral"
                        style={{ fontSize: '12px', padding: '1px 5px', flexShrink: 0 }}
                      >
                        {s.tag}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      {s.games.map((g) => (
                        <GameTag key={g} gameId={g} style={{ padding: '1px 6px' }} />
                      ))}
                    </div>
                  </div>
                </div>
                <div
                  className="flex items-center justify-between pt-3"
                  style={{ borderTop: '1px dashed var(--s-border)' }}
                >
                  <div className="flex items-center gap-1.5">
                    <Users size={12} style={{ color: 'var(--s-text-muted)' }} />
                    <span className="t-mono text-xs" style={{ color: 'var(--s-text-dim)' }}>
                      {s.members.length} membre{s.members.length > 1 ? 's' : ''}
                    </span>
                  </div>
                  {s.recruiting?.active && (
                    <span className="tag tag-green" style={{ fontSize: '12px', padding: '2px 7px' }}>
                      RECRUTE
                    </span>
                  )}
                </div>
              </div>
            </div>
          </PublicPreviewFrame>
        )}

        {/* INFORMATIONS */}
        <div className="bevel relative overflow-hidden" style={{ background: 'var(--s-surface)', border: '1px solid var(--s-border)' }}>
          <div className="h-[3px]" style={{ background: 'linear-gradient(90deg, var(--s-gold), rgba(255,184,0,0.3), transparent 70%)' }} />
          <div className="relative z-[1] px-5 py-3.5" style={{ borderBottom: '1px solid var(--s-border)' }}>
            <div className="flex items-center gap-3">
              <div className="w-7 h-7 flex items-center justify-center" style={{ background: 'rgba(255,184,0,0.08)', border: '1px solid rgba(255,184,0,0.2)' }}>
                <Shield size={13} style={{ color: 'var(--s-gold)' }} />
              </div>
              <span className="font-display text-sm tracking-wider">INFORMATIONS</span>
            </div>
          </div>
          <div className="relative z-[1] p-5 space-y-3.5">
            <div className="flex items-center justify-between">
              <span className="text-xs" style={{ color: 'var(--s-text-dim)' }}>Statut</span>
              <span className="tag" style={{ background: `${statusInfo.color}12`, color: statusInfo.color, borderColor: `${statusInfo.color}35`, fontSize: '12px', padding: '2px 8px' }}>
                {statusInfo.label}
              </span>
            </div>
            <div className="divider" />
            <div className="flex items-center justify-between">
              <span className="text-xs" style={{ color: 'var(--s-text-dim)' }}>Jeux</span>
              <div className="flex gap-1.5">
                {s.games?.map(g => (
                  <GameTag key={g} gameId={g} style={{ padding: '2px 6px' }} />
                ))}
              </div>
            </div>
            <div className="divider" />
            <div className="flex items-center justify-between">
              <span className="text-xs" style={{ color: 'var(--s-text-dim)' }}>Équipes</span>
              <span className="font-display text-sm">{teams.length}</span>
            </div>
            {s.validatedAt && (
              <>
                <div className="divider" />
                <div className="flex items-center justify-between">
                  <span className="text-xs" style={{ color: 'var(--s-text-dim)' }}>Validée le</span>
                  <span className="t-mono text-xs">{new Date(s.validatedAt).toLocaleDateString('fr-FR')}</span>
                </div>
              </>
            )}
          </div>
        </div>

        {/* Quick stats, un compteur par jeu de la structure, depuis la registry.
            Grille adaptée au nombre de jeux (max 4 par ligne pour rester lisible). */}
        {(() => {
          const cards = ALL_GAME_DEFS
            .filter(g => s.games?.includes(g.id))
            .map(g => ({ def: g, count: teams.filter(t => t.game === g.id).length }));
          if (cards.length === 0) return null;
          const cols = cards.length === 1 ? 'grid-cols-1' : 'grid-cols-1 sm:grid-cols-2';
          return (
            <div className={`grid ${cols} gap-3`}>
              {cards.map(({ def, count }) => (
                <div
                  key={def.id}
                  className="bevel-sm p-4 text-center relative overflow-hidden"
                  style={{ background: 'var(--s-surface)', border: '1px solid var(--s-border)' }}
                >
                  <div
                    className="absolute inset-0 pointer-events-none"
                    style={{ background: `radial-gradient(circle at 50% 0%, rgba(${def.colorRgb}, 0.06), transparent 70%)` }}
                  />
                  <p className="font-display text-2xl relative z-[1]" style={{ color: def.color }}>{count}</p>
                  <p className="t-label mt-1 relative z-[1]">ÉQUIPES {def.shortLabel}</p>
                </div>
              ))}
            </div>
          );
        })()}

        {/* Quota de stockage (docs + replays unifiés) */}
        {activeStructure && (
          <StorageQuotaCard structureId={activeStructure.id} />
        )}

        {/* Aide rôles & permissions, accessible aux dirigeants pour comprendre
            ce qu'ils donnent quand ils promeuvent un membre. */}
        {isDirigeantOfActive && (
          <button type="button" onClick={() => setRolesHelpOpen(true)}
            className="w-full flex items-center justify-center gap-2 px-4 py-3 bevel-sm transition-colors duration-150"
            style={{
              background: 'rgba(255,184,0,0.06)',
              border: '1px solid rgba(255,184,0,0.25)',
              color: 'var(--s-gold)',
              cursor: 'pointer',
            }}
            onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,184,0,0.12)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'rgba(255,184,0,0.06)')}>
            <BookOpen size={13} />
            <span className="font-display text-sm tracking-wider">RÔLES & PERMISSIONS</span>
          </button>
        )}
      </div>

      {rolesHelpOpen && <RolesHelpModal onClose={() => setRolesHelpOpen(false)} />}
    </div>
  );
}
