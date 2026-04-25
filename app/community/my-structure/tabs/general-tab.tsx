'use client';

import { type RefObject, type ReactNode, type Dispatch, type SetStateAction } from 'react';
import ReactMarkdown from 'react-markdown';
import {
  Shield, Trophy, Loader2, AlertCircle,
  Save, Plus, Trash2, CheckCircle,
  Link2, MessageSquare, Settings, Check, X,
} from 'lucide-react';
import ImageUploader from '@/components/ui/ImageUploader';
import { UPLOAD_LIMITS } from '@/lib/upload-limits';
import type { MyStructure, TeamData } from '../types';
import { SOCIAL_LABELS, STATUS_INFO } from '../constants';
import { SectionPanel } from '../components';

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
  showEmojis: boolean;
  setShowEmojis: Dispatch<SetStateAction<boolean>>;
  editLogoUrl: string;
  setEditLogoUrl: Dispatch<SetStateAction<string>>;
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
    editDesc, setEditDesc, descRef, showEmojis, setShowEmojis,
    editLogoUrl, setEditLogoUrl, editDiscordUrl, setEditDiscordUrl,
    editSocials, setEditSocials, editAchievements, setEditAchievements,
    discordLoading, handleConnectDiscord, handleDisconnectDiscord, renderDiscordConfigBlock,
    handleSave, saving, saved, error,
    isDirigeantOfActive, collapsed, toggle, teams,
  } = props;

  const statusInfo = STATUS_INFO[s.status] ?? STATUS_INFO.pending_validation;

  return (
    <div className="grid gap-6 animate-fade-in grid-cols-3">
      {/* ─── Colonne gauche ──────── */}
      <div className="col-span-2 space-y-6">
        {/* DESCRIPTION */}
        <SectionPanel accent="var(--s-violet)" icon={MessageSquare} title="DESCRIPTION"
          collapsed={collapsed.desc} onToggle={() => toggle('desc')}>
          <div className="space-y-3">
            <div className="relative">
              <textarea ref={descRef} className="settings-input w-full" rows={5}
                value={editDesc} onChange={e => setEditDesc(e.target.value)}
                placeholder="Présente ta structure..." />
              <div className="relative inline-block">
                <button type="button" onClick={() => setShowEmojis(!showEmojis)}
                  className="mt-1.5 text-xs flex items-center gap-1.5 px-2 py-1 transition-colors duration-150"
                  style={{ color: showEmojis ? 'var(--s-gold)' : 'var(--s-text-muted)', background: showEmojis ? 'rgba(255,184,0,0.08)' : 'transparent', border: `1px solid ${showEmojis ? 'rgba(255,184,0,0.2)' : 'var(--s-border)'}` }}>
                  <span style={{ fontSize: '14px' }}>😀</span> Emojis
                </button>
                {showEmojis && (
                  <div className="absolute left-0 top-full mt-1 p-2 z-50 flex flex-wrap" style={{ width: '320px', background: 'var(--s-surface)', border: '1px solid var(--s-border)', boxShadow: '0 8px 24px rgba(0,0,0,0.5)' }}>
                    {['🏆', '🥇', '🥈', '🥉', '⭐', '🔥', '💪', '🎮', '🎯', '🚀', '⚽', '🏎️', '🏁', '👑', '💎', '🛡️', '⚔️', '🎉', '📢', '💬', '✅', '❌', '🔵', '🟢', '🟡', '🔴', '⚡', '💥', '🌟', '🏅', '👊', '🤝', '📊', '📈', '🗓️', '🎪', '🏟️', '🎖️', '🧩', '🕹️'].map(emoji => (
                      <button key={emoji} type="button"
                        className="hover:bg-[var(--s-hover)] transition-colors duration-100"
                        style={{ width: '30px', height: '30px', fontSize: '16px', lineHeight: '30px', textAlign: 'center', background: 'transparent', border: 'none', cursor: 'pointer', padding: 0, fontFamily: '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif' }}
                        onClick={() => {
                          const ta = descRef.current;
                          if (ta) {
                            const start = ta.selectionStart;
                            const end = ta.selectionEnd;
                            const newVal = editDesc.slice(0, start) + emoji + editDesc.slice(end);
                            setEditDesc(newVal);
                            setTimeout(() => { ta.focus(); ta.selectionStart = ta.selectionEnd = start + emoji.length; }, 0);
                          } else {
                            setEditDesc(editDesc + emoji);
                          }
                        }}>
                        {emoji}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1 px-1" style={{ color: 'var(--s-text-muted)', fontSize: '12px' }}>
              <span><strong style={{ color: 'var(--s-text-dim)' }}>**gras**</strong></span>
              <span><em>*italique*</em></span>
              <span># Titre</span>
              <span>- liste</span>
              <span>[lien](url)</span>
              <span>&gt; citation</span>
            </div>
            {editDesc.trim() && (
              <div>
                <p className="t-label mb-2" style={{ color: 'var(--s-text-muted)' }}>APERÇU</p>
                <div className="p-3 prose-springs text-sm" style={{ background: 'var(--s-elevated)', border: '1px solid var(--s-border)' }}>
                  <ReactMarkdown>{editDesc}</ReactMarkdown>
                </div>
              </div>
            )}
          </div>
        </SectionPanel>

        {/* CONFIGURATION */}
        <SectionPanel accent="var(--s-gold)" icon={Settings} title="CONFIGURATION"
          collapsed={collapsed.config} onToggle={() => toggle('config')}>
          <div className="space-y-5">
            <div className="grid grid-cols-2 gap-5">
              <ImageUploader
                label="Logo de la structure"
                hint="Carré — idéalement fond transparent. Max 2 MB."
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
              hint="Ratio 4:1 recommandé (1920×480). Max 5 MB."
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
                {activeStructure.games.includes('rocket_league') && renderDiscordConfigBlock({
                  key: 'game:rocket_league',
                  scope: { scope: 'game', game: 'rocket_league' },
                  label: 'Rocket League',
                  accentColor: '#0081FF',
                  currentChannelId: activeStructure.discordIntegration.gameChannels?.rocket_league?.channelId ?? null,
                  currentChannelName: activeStructure.discordIntegration.gameChannels?.rocket_league?.channelName ?? null,
                  currentRoleId: activeStructure.discordIntegration.gameChannels?.rocket_league?.roleId ?? null,
                  currentRoleName: activeStructure.discordIntegration.gameChannels?.rocket_league?.roleName ?? null,
                })}
                {activeStructure.games.includes('trackmania') && renderDiscordConfigBlock({
                  key: 'game:trackmania',
                  scope: { scope: 'game', game: 'trackmania' },
                  label: 'Trackmania',
                  accentColor: '#00D936',
                  currentChannelId: activeStructure.discordIntegration.gameChannels?.trackmania?.channelId ?? null,
                  currentChannelName: activeStructure.discordIntegration.gameChannels?.trackmania?.channelName ?? null,
                  currentRoleId: activeStructure.discordIntegration.gameChannels?.trackmania?.roleId ?? null,
                  currentRoleName: activeStructure.discordIntegration.gameChannels?.trackmania?.roleName ?? null,
                })}
                {renderDiscordConfigBlock({
                  key: 'staff',
                  scope: { scope: 'staff' },
                  label: 'Staff',
                  accentColor: 'var(--s-violet-light)',
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
                  ne fait rien d&apos;autre que poster des embeds d&apos;événements —
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
          <div className="grid grid-cols-2 gap-x-4 gap-y-3">
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
            <button type="button" onClick={() => setEditAchievements([...editAchievements, { placement: '', competition: '', game: s.games[0] || 'rocket_league', date: '' }])}
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
                    <div className="flex-1 grid grid-cols-2 gap-2">
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
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="t-label block mb-1">Jeu</label>
                      <select className="settings-input w-full" value={a.game}
                        onChange={e => {
                          const achs = [...editAchievements];
                          achs[i] = { ...a, game: e.target.value };
                          setEditAchievements(achs);
                        }}>
                        <option value="rocket_league">Rocket League</option>
                        <option value="trackmania">Trackmania</option>
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
        {/* INFORMATIONS */}
        <div className="bevel relative overflow-hidden" style={{ background: 'var(--s-surface)', border: '1px solid var(--s-border)' }}>
          <div className="h-[3px]" style={{ background: 'linear-gradient(90deg, var(--s-violet), rgba(123,47,190,0.3), transparent 70%)' }} />
          <div className="relative z-[1] px-5 py-3.5" style={{ borderBottom: '1px solid var(--s-border)' }}>
            <div className="flex items-center gap-3">
              <div className="w-7 h-7 flex items-center justify-center" style={{ background: 'rgba(123,47,190,0.08)', border: '1px solid rgba(123,47,190,0.2)' }}>
                <Shield size={13} style={{ color: 'var(--s-violet-light)' }} />
              </div>
              <span className="font-display text-sm tracking-wider">INFORMATIONS</span>
            </div>
          </div>
          <div className="relative z-[1] p-5 space-y-3.5">
            <div className="flex items-center justify-between">
              <span className="text-xs" style={{ color: 'var(--s-text-dim)' }}>Statut</span>
              <span className="tag" style={{ background: `${statusInfo.color}12`, color: statusInfo.color, borderColor: `${statusInfo.color}35`, fontSize: '9px', padding: '2px 8px' }}>
                {statusInfo.label}
              </span>
            </div>
            <div className="divider" />
            <div className="flex items-center justify-between">
              <span className="text-xs" style={{ color: 'var(--s-text-dim)' }}>Jeux</span>
              <div className="flex gap-1.5">
                {s.games?.map(g => (
                  <span key={g} className={`tag ${g === 'rocket_league' ? 'tag-blue' : 'tag-green'}`}
                    style={{ fontSize: '9px', padding: '2px 6px' }}>
                    {g === 'rocket_league' ? 'RL' : 'TM'}
                  </span>
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

        {/* Quick stats */}
        <div className="grid grid-cols-2 gap-3">
          <div className="bevel-sm p-4 text-center relative overflow-hidden" style={{ background: 'var(--s-surface)', border: '1px solid var(--s-border)' }}>
            <div className="absolute inset-0 pointer-events-none" style={{ background: 'radial-gradient(circle at 50% 0%, rgba(0,129,255,0.06), transparent 70%)' }} />
            <p className="font-display text-2xl relative z-[1]" style={{ color: 'var(--s-blue)' }}>{teams.filter(t => t.game === 'rocket_league').length}</p>
            <p className="t-label mt-1 relative z-[1]">ÉQUIPES RL</p>
          </div>
          <div className="bevel-sm p-4 text-center relative overflow-hidden" style={{ background: 'var(--s-surface)', border: '1px solid var(--s-border)' }}>
            <div className="absolute inset-0 pointer-events-none" style={{ background: 'radial-gradient(circle at 50% 0%, rgba(0,217,54,0.06), transparent 70%)' }} />
            <p className="font-display text-2xl relative z-[1]" style={{ color: 'var(--s-green)' }}>{teams.filter(t => t.game === 'trackmania').length}</p>
            <p className="t-label mt-1 relative z-[1]">ÉQUIPES TM</p>
          </div>
        </div>
      </div>
    </div>
  );
}
