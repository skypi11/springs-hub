'use client';
import React from 'react';
import Image from 'next/image';
import Link from 'next/link';
import {
  AlertCircle, Bookmark, Check, CheckCircle, Copy, Eye, Loader2,
  Plus, Save, Search, Trash2, User, UserPlus, X,
} from 'lucide-react';
import MarkdownEditor from '@/components/ui/MarkdownEditor';
import { LIMITS } from '@/lib/validation';
import { safeCopy } from '@/lib/clipboard';
import { SectionPanel } from '../components';
import type {
  MyStructure, InviteLink, JoinRequest, DirectInvite,
  Suggestion, ShortlistItem, EditRecruiting,
} from '../types';

// Tab Recrutement complet — extrait de page.tsx pour réduire la taille du fichier orchestrateur.
// Regroupe : settings recrutement (annonce + postes), liens d'invitation, demandes reçues,
// invitations envoyées, shortlist, candidats suggérés.
export interface RecruitmentTabProps {
  s: MyStructure;

  editRecruiting: EditRecruiting;
  setEditRecruiting: (v: EditRecruiting) => void;
  recruitMessageRef: React.RefObject<HTMLTextAreaElement | null>;

  handleSave: () => void;
  saving: boolean;
  saved: boolean;
  error: string;

  collapsed: Record<string, boolean>;
  toggle: (key: string) => void;

  isDirigeantOfActive: boolean;
  isManagerOfActive: boolean;

  newLinkGame: string;
  setNewLinkGame: (v: string) => void;
  inviteLinks: InviteLink[];
  copiedLink: string;
  setCopiedLink: (v: string) => void;
  handleCreateLink: () => void;
  handleRevokeLink: (id: string) => void;
  invActionLoading: string | null;
  invLoading: boolean;

  joinRequests: JoinRequest[];
  handleRequestAction: (id: string, accept: boolean) => void;

  directInvites: DirectInvite[];
  handleCancelDirectInvite: (id: string) => void;

  shortlist: ShortlistItem[];
  shortlistLoading: boolean;
  handleRemoveFromShortlist: (uid: string) => void;

  suggestions: Suggestion[];
  suggestionsLoading: boolean;

  toast: { error: (msg: string) => void };
}

export function RecruitmentTab(props: RecruitmentTabProps) {
  const {
    s, editRecruiting, setEditRecruiting, recruitMessageRef,
    handleSave, saving, saved, error,
    collapsed, toggle,
    isDirigeantOfActive, isManagerOfActive,
    newLinkGame, setNewLinkGame, inviteLinks, copiedLink, setCopiedLink,
    handleCreateLink, handleRevokeLink, invActionLoading, invLoading,
    joinRequests, handleRequestAction,
    directInvites, handleCancelDirectInvite,
    shortlist, shortlistLoading, handleRemoveFromShortlist,
    suggestions, suggestionsLoading,
    toast,
  } = props;

  const canManage = isDirigeantOfActive || isManagerOfActive;

  return (
    <>
      {/* ═══ RECRUTEMENT — Settings (dirigeants only) ═══ */}
      {isDirigeantOfActive && (
        <SectionPanel accent="#33ff66" icon={Search} title="RECRUTEMENT"
          collapsed={collapsed.recruit} onToggle={() => toggle('recruit')}>
          <div className="space-y-4">
            <label className="flex items-center gap-3 cursor-pointer select-none">
              <div className="relative w-10 h-5 transition-colors duration-200"
                style={{
                  background: editRecruiting.active ? 'rgba(0,217,54,0.3)' : 'var(--s-elevated)',
                  border: `1px solid ${editRecruiting.active ? 'rgba(0,217,54,0.5)' : 'var(--s-border)'}`,
                }}>
                <div className="absolute top-0.5 w-4 h-4 transition-all duration-200"
                  style={{
                    background: editRecruiting.active ? '#33ff66' : 'var(--s-text-muted)',
                    left: editRecruiting.active ? '20px' : '2px',
                  }} />
                <input type="checkbox" className="sr-only" checked={editRecruiting.active}
                  onChange={e => setEditRecruiting({ ...editRecruiting, active: e.target.checked })} />
              </div>
              <span className="text-sm font-medium" style={{ color: editRecruiting.active ? '#33ff66' : 'var(--s-text-dim)' }}>
                {editRecruiting.active ? 'Recrutement ouvert' : 'Recrutement fermé'}
              </span>
            </label>

            {editRecruiting.active && (
              <div className="space-y-4 pt-2" style={{ borderTop: '1px solid var(--s-border)' }}>
                <MarkdownEditor
                  label="Annonce de recrutement (optionnelle)"
                  value={editRecruiting.message}
                  onChange={v => setEditRecruiting({ ...editRecruiting, message: v })}
                  placeholder="Décris ton projet, l'ambiance, ce que tu cherches exactement… (markdown supporté)"
                  maxLength={LIMITS.structureRecruitmentMessage}
                  rows={5}
                  taRef={recruitMessageRef}
                />
                <p className="t-label" style={{ color: '#33ff66' }}>Postes recherchés</p>
                {editRecruiting.positions.map((p, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <select className="settings-input flex-1" value={p.game}
                      onChange={e => {
                        const positions = [...editRecruiting.positions];
                        positions[i] = { ...p, game: e.target.value };
                        setEditRecruiting({ ...editRecruiting, positions });
                      }}>
                      <option value="rocket_league">Rocket League</option>
                      <option value="trackmania">Trackmania</option>
                    </select>
                    <select className="settings-input flex-1" value={p.role}
                      onChange={e => {
                        const positions = [...editRecruiting.positions];
                        positions[i] = { ...p, role: e.target.value };
                        setEditRecruiting({ ...editRecruiting, positions });
                      }}>
                      <option value="joueur">Joueur</option>
                      <option value="coach">Coach</option>
                      <option value="manager">Manager</option>
                    </select>
                    <button type="button" onClick={() => {
                      const positions = editRecruiting.positions.filter((_, j) => j !== i);
                      setEditRecruiting({ ...editRecruiting, positions });
                    }} className="p-1.5 transition-colors duration-150" style={{ color: '#ff5555' }}>
                      <Trash2 size={13} />
                    </button>
                  </div>
                ))}
                <button type="button" onClick={() => {
                  setEditRecruiting({
                    ...editRecruiting,
                    positions: [...editRecruiting.positions, { game: s.games[0] || 'rocket_league', role: 'joueur' }],
                  });
                }}
                  className="flex items-center gap-2 text-xs font-bold transition-colors duration-150" style={{ color: '#33ff66' }}>
                  <Plus size={12} /> Ajouter un poste
                </button>
              </div>
            )}

            <div className="flex items-center gap-3 pt-4" style={{ borderTop: '1px solid var(--s-border)' }}>
              <button onClick={handleSave} disabled={saving}
                className="btn-springs btn-primary bevel-sm flex items-center gap-2 px-5 py-2.5">
                {saving ? <Loader2 size={14} className="animate-spin" /> : saved ? <CheckCircle size={14} /> : <Save size={14} />}
                <span className="font-display text-xs tracking-wider">
                  {saving ? 'SAUVEGARDE...' : saved ? 'SAUVEGARDÉ !' : 'SAUVEGARDER'}
                </span>
              </button>
              {error && (
                <div className="flex items-center gap-2 text-xs" style={{ color: '#ff5555' }}>
                  <AlertCircle size={12} />
                  <span>{error}</span>
                </div>
              )}
            </div>
          </div>
        </SectionPanel>
      )}

      {/* ═══ Liens d'invitation ═══ */}
      {canManage && (
        <SectionPanel accent="#33ff66" icon={UserPlus} title="LIENS D'INVITATION"
          collapsed={collapsed.inviteLinks} onToggle={() => toggle('inviteLinks')}>
          <div className="space-y-3">
            <div className="flex items-end gap-2">
              <div className="flex-1">
                <label className="t-label block mb-1">Jeu (optionnel — pré-rempli pour le joueur)</label>
                <select className="settings-input w-full" value={newLinkGame} onChange={e => setNewLinkGame(e.target.value)}>
                  <option value="">Tous les jeux</option>
                  {s.games?.includes('rocket_league') && <option value="rocket_league">Rocket League</option>}
                  {s.games?.includes('trackmania') && <option value="trackmania">Trackmania</option>}
                </select>
              </div>
              <button type="button" onClick={handleCreateLink} disabled={invActionLoading === 'create_link'}
                className="btn-springs btn-primary bevel-sm flex items-center gap-2 text-xs">
                {invActionLoading === 'create_link' ? <Loader2 size={11} className="animate-spin" /> : <Plus size={11} />}
                Créer
              </button>
            </div>
            {inviteLinks.length > 0 ? (
              <div className="space-y-2">
                {inviteLinks.map(link => (
                  <div key={link.id} className="flex items-center gap-2 p-2" style={{ background: 'var(--s-elevated)', border: '1px solid var(--s-border)' }}>
                    <div className="flex-1 min-w-0">
                      <p className="t-mono text-xs truncate" style={{ color: 'var(--s-text-dim)' }}>
                        /join/{link.token.slice(0, 8)}...
                      </p>
                      {link.game && (
                        <span className={`tag ${link.game === 'rocket_league' ? 'tag-blue' : 'tag-green'}`} style={{ fontSize: '9px', padding: '1px 5px' }}>
                          {link.game === 'rocket_league' ? 'RL' : 'TM'}
                        </span>
                      )}
                    </div>
                    <button type="button" onClick={async () => {
                      const ok = await safeCopy(`${window.location.origin}/community/join/${link.token}`);
                      if (ok) {
                        setCopiedLink(link.token);
                        setTimeout(() => setCopiedLink(''), 2000);
                      } else {
                        toast.error('Copie impossible — sélectionne le lien manuellement.');
                      }
                    }}
                      className="p-1" style={{ color: copiedLink === link.token ? '#33ff66' : 'var(--s-text-dim)' }}>
                      {copiedLink === link.token ? <Check size={12} /> : <Copy size={12} />}
                    </button>
                    <button type="button" onClick={() => handleRevokeLink(link.id)} disabled={invActionLoading === link.id}
                      className="p-1" style={{ color: '#ff5555' }}>
                      {invActionLoading === link.id ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-center py-2" style={{ color: 'var(--s-text-muted)' }}>
                Aucun lien actif. Crée-en un pour inviter des joueurs.
              </p>
            )}
          </div>
        </SectionPanel>
      )}

      {/* ═══ Demandes reçues ═══ */}
      {canManage && (
        <SectionPanel accent="var(--s-gold)" icon={UserPlus} title={`DEMANDES REÇUES${joinRequests.length > 0 ? ` (${joinRequests.length})` : ''}`}
          collapsed={collapsed.joinRequests} onToggle={() => toggle('joinRequests')}>
          {joinRequests.length === 0 ? (
            <p className="text-xs text-center py-3" style={{ color: 'var(--s-text-muted)' }}>
              {invLoading ? 'Chargement...' : 'Aucune demande en attente.'}
            </p>
          ) : (
            <div className="space-y-2">
              {joinRequests.map(jr => {
                const jrAvatar = jr.avatarUrl || jr.discordAvatar;
                return (
                  <div key={jr.id} className="p-3" style={{ background: 'var(--s-elevated)', border: '1px solid rgba(255,184,0,0.15)' }}>
                    <div className="flex items-start gap-3 mb-2">
                      {jrAvatar ? (
                        <div className="w-12 h-12 relative flex-shrink-0 overflow-hidden" style={{ background: 'var(--s-surface)', border: '1px solid var(--s-border)' }}>
                          <Image src={jrAvatar} alt={jr.displayName} fill className="object-cover" unoptimized />
                        </div>
                      ) : (
                        <div className="w-12 h-12 flex-shrink-0 flex items-center justify-center" style={{ background: 'var(--s-surface)', border: '1px solid var(--s-border)' }}>
                          <User size={16} style={{ color: 'var(--s-text-muted)' }} />
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <Link href={`/profile/${jr.applicantId}`} className="text-sm font-semibold truncate hover:underline">{jr.displayName}</Link>
                          {jr.country && (
                            <Image src={`https://flagcdn.com/16x12/${jr.country.toLowerCase()}.png`}
                              alt={jr.country} width={14} height={10} className="flex-shrink-0" unoptimized />
                          )}
                        </div>
                        <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                          {jr.game && (
                            <span className={`tag ${jr.game === 'rocket_league' ? 'tag-blue' : 'tag-green'}`} style={{ fontSize: '12px', padding: '1px 6px' }}>
                              {jr.game === 'rocket_league' ? 'RL' : 'TM'}
                            </span>
                          )}
                          {jr.role && jr.role !== 'joueur' && (
                            <span className="tag tag-neutral" style={{ fontSize: '12px', padding: '1px 6px' }}>{jr.role}</span>
                          )}
                          {jr.rlRank && (
                            <span className="text-xs" style={{ color: 'var(--s-text-dim)' }}>
                              {jr.rlRank}{jr.rlMmr ? ` · ${jr.rlMmr}` : ''}
                            </span>
                          )}
                          {jr.pseudoTM && <span className="text-xs" style={{ color: 'var(--s-text-dim)' }}>{jr.pseudoTM}</span>}
                        </div>
                      </div>
                      <Link href={`/profile/${jr.applicantId}`} target="_blank" rel="noopener"
                        className="p-1.5 flex-shrink-0 transition-colors duration-150 hover:bg-[var(--s-hover)]"
                        style={{ background: 'var(--s-surface)', border: '1px solid var(--s-border)' }}
                        title="Voir profil">
                        <Eye size={12} style={{ color: 'var(--s-text-dim)' }} />
                      </Link>
                    </div>
                    {jr.message && (
                      <p className="text-xs mb-2 italic p-2" style={{ background: 'var(--s-surface)', color: 'var(--s-text-dim)' }}>
                        « {jr.message} »
                      </p>
                    )}
                    <div className="flex gap-2">
                      <button type="button" onClick={() => handleRequestAction(jr.id, true)} disabled={invActionLoading === jr.id}
                        className="btn-springs btn-primary bevel-sm flex-1 justify-center text-xs py-1.5">
                        {invActionLoading === jr.id ? <Loader2 size={11} className="animate-spin" /> : <><Check size={11} /> Accepter</>}
                      </button>
                      <button type="button" onClick={() => handleRequestAction(jr.id, false)} disabled={invActionLoading === jr.id}
                        className="btn-springs btn-secondary bevel-sm-border flex-1 justify-center text-xs py-1.5"
                        style={{ color: '#ff5555', borderColor: 'rgba(255,85,85,0.3)' }}>
                        <Trash2 size={11} /> Refuser
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </SectionPanel>
      )}

      {/* ═══ Invitations envoyées ═══ */}
      {canManage && (
        <SectionPanel accent="var(--s-gold)" icon={UserPlus} title={`INVITATIONS ENVOYÉES${directInvites.length > 0 ? ` (${directInvites.length})` : ''}`}
          collapsed={collapsed.sentInvites} onToggle={() => toggle('sentInvites')}>
          {directInvites.length === 0 ? (
            <p className="text-xs text-center py-3" style={{ color: 'var(--s-text-muted)' }}>
              Aucune invitation envoyée en attente. Invite des joueurs depuis l&apos;annuaire ou leurs profils.
            </p>
          ) : (
            <div className="space-y-2">
              {directInvites.map(di => {
                const diAvatar = di.avatarUrl || di.discordAvatar;
                return (
                  <div key={di.id} className="p-3" style={{ background: 'var(--s-elevated)', border: '1px solid rgba(255,184,0,0.2)' }}>
                    <div className="flex items-start gap-3 mb-2">
                      {diAvatar ? (
                        <div className="w-12 h-12 relative flex-shrink-0 overflow-hidden" style={{ background: 'var(--s-surface)', border: '1px solid var(--s-border)' }}>
                          <Image src={diAvatar} alt={di.displayName} fill className="object-cover" unoptimized />
                        </div>
                      ) : (
                        <div className="w-12 h-12 flex-shrink-0 flex items-center justify-center" style={{ background: 'var(--s-surface)', border: '1px solid var(--s-border)' }}>
                          <User size={16} style={{ color: 'var(--s-text-muted)' }} />
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <Link href={`/profile/${di.targetUserId}`} className="text-sm font-semibold truncate hover:underline">{di.displayName}</Link>
                          {di.country && (
                            <Image src={`https://flagcdn.com/16x12/${di.country.toLowerCase()}.png`}
                              alt={di.country} width={14} height={10} className="flex-shrink-0" unoptimized />
                          )}
                        </div>
                        <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                          {di.game && (
                            <span className={`tag ${di.game === 'rocket_league' ? 'tag-blue' : 'tag-green'}`} style={{ fontSize: '12px', padding: '1px 6px' }}>
                              {di.game === 'rocket_league' ? 'RL' : 'TM'}
                            </span>
                          )}
                          {di.role && di.role !== 'joueur' && (
                            <span className="tag tag-neutral" style={{ fontSize: '12px', padding: '1px 6px' }}>{di.role}</span>
                          )}
                          {di.rlRank && (
                            <span className="text-xs" style={{ color: 'var(--s-text-dim)' }}>
                              {di.rlRank}{di.rlMmr ? ` · ${di.rlMmr}` : ''}
                            </span>
                          )}
                          {di.pseudoTM && <span className="text-xs" style={{ color: 'var(--s-text-dim)' }}>{di.pseudoTM}</span>}
                          <span className="text-xs italic" style={{ color: 'var(--s-text-muted)' }}>· En attente</span>
                        </div>
                      </div>
                      <div className="flex flex-col gap-1 flex-shrink-0">
                        <Link href={`/profile/${di.targetUserId}`} target="_blank" rel="noopener"
                          className="p-1.5 transition-colors duration-150 hover:bg-[var(--s-hover)]"
                          style={{ background: 'var(--s-surface)', border: '1px solid var(--s-border)' }}
                          title="Voir profil">
                          <Eye size={12} style={{ color: 'var(--s-text-dim)' }} />
                        </Link>
                        <button type="button" onClick={() => handleCancelDirectInvite(di.id)} disabled={invActionLoading === di.id}
                          className="p-1.5" style={{ color: '#ff5555', background: 'var(--s-surface)', border: '1px solid rgba(255,85,85,0.2)' }} title="Annuler">
                          {invActionLoading === di.id ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </SectionPanel>
      )}

      {/* ═══ Shortlist ═══ */}
      {canManage && (
        <SectionPanel accent="var(--s-gold)" icon={Bookmark} title="SHORTLIST"
          collapsed={collapsed.shortlist} onToggle={() => toggle('shortlist')}>
          {shortlistLoading ? (
            <p className="text-xs text-center py-3" style={{ color: 'var(--s-text-muted)' }}>Chargement...</p>
          ) : shortlist.length === 0 ? (
            <p className="text-xs text-center py-3" style={{ color: 'var(--s-text-muted)' }}>
              Aucun joueur en shortlist. Ajoute des favoris depuis l&apos;annuaire <Link href="/community/players" className="underline" style={{ color: 'var(--s-gold)' }}>joueurs</Link>.
            </p>
          ) : (
            <div className="space-y-2">
              {shortlist.map(sl => {
                const slAvatar = sl.avatarUrl || sl.discordAvatar;
                return (
                  <div key={sl.uid} className="flex items-start gap-3 p-2.5"
                    style={{ background: 'var(--s-elevated)', border: '1px solid var(--s-border)' }}>
                    {slAvatar ? (
                      <div className="w-12 h-12 relative flex-shrink-0 overflow-hidden" style={{ background: 'var(--s-surface)', border: '1px solid var(--s-border)' }}>
                        <Image src={slAvatar} alt={sl.displayName} fill className="object-cover" unoptimized />
                      </div>
                    ) : (
                      <div className="w-12 h-12 flex-shrink-0 flex items-center justify-center" style={{ background: 'var(--s-surface)', border: '1px solid var(--s-border)' }}>
                        <User size={14} style={{ color: 'var(--s-text-muted)' }} />
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-semibold truncate">{sl.displayName}</p>
                        {sl.country && (
                          <Image src={`https://flagcdn.com/16x12/${sl.country.toLowerCase()}.png`}
                            alt={sl.country} width={14} height={10} className="flex-shrink-0" unoptimized />
                        )}
                        {sl.isAvailableForRecruitment && (
                          <span className="tag tag-green" style={{ fontSize: '12px', padding: '1px 6px' }}>DISPO</span>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                        {sl.games.map(g => (
                          <span key={g} className={`tag ${g === 'rocket_league' ? 'tag-blue' : 'tag-green'}`} style={{ fontSize: '12px', padding: '1px 6px' }}>
                            {g === 'rocket_league' ? 'RL' : 'TM'}
                          </span>
                        ))}
                        {sl.rlRank && (
                          <span className="text-xs" style={{ color: 'var(--s-text-dim)' }}>
                            {sl.rlRank}{sl.rlMmr ? ` · ${sl.rlMmr}` : ''}
                          </span>
                        )}
                        {sl.pseudoTM && <span className="text-xs" style={{ color: 'var(--s-text-dim)' }}>{sl.pseudoTM}</span>}
                      </div>
                    </div>
                    <div className="flex flex-col gap-1 flex-shrink-0">
                      <Link
                        href={`/profile/${sl.uid}`}
                        target="_blank"
                        className="flex items-center justify-center w-7 h-7 transition-colors duration-150"
                        style={{ background: 'var(--s-surface)', border: '1px solid var(--s-border)', color: 'var(--s-text-dim)' }}
                        title="Voir profil"
                      >
                        <Eye size={13} />
                      </Link>
                      <button
                        type="button"
                        onClick={() => handleRemoveFromShortlist(sl.uid)}
                        className="flex items-center justify-center w-7 h-7 transition-colors duration-150"
                        style={{ background: 'var(--s-surface)', border: '1px solid var(--s-border)', color: '#ff5555' }}
                        title="Retirer de la shortlist"
                      >
                        <X size={13} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </SectionPanel>
      )}

      {/* ═══ Candidats suggérés ═══ */}
      {canManage && s.recruiting?.active && (
        <SectionPanel accent="var(--s-gold)" icon={Search} title="CANDIDATS SUGGÉRÉS"
          collapsed={collapsed.suggestions} onToggle={() => toggle('suggestions')}>
          {suggestionsLoading ? (
            <p className="text-xs text-center py-3" style={{ color: 'var(--s-text-muted)' }}>Chargement...</p>
          ) : suggestions.length === 0 ? (
            <p className="text-xs text-center py-3" style={{ color: 'var(--s-text-muted)' }}>
              Aucun candidat correspondant pour le moment. Les joueurs dispos au recrutement apparaîtront ici.
            </p>
          ) : (
            <div className="space-y-2">
              {suggestions.slice(0, 10).map(sg => {
                const sgAvatar = sg.avatarUrl || sg.discordAvatar;
                return (
                  <Link key={sg.uid} href={`/profile/${sg.uid}`} className="flex items-start gap-3 p-2.5 transition-colors duration-150 hover:bg-[var(--s-hover)]"
                    style={{ background: 'var(--s-elevated)', border: '1px solid var(--s-border)' }}>
                    {sgAvatar ? (
                      <div className="w-12 h-12 relative flex-shrink-0 overflow-hidden" style={{ background: 'var(--s-surface)', border: '1px solid var(--s-border)' }}>
                        <Image src={sgAvatar} alt={sg.displayName} fill className="object-cover" unoptimized />
                      </div>
                    ) : (
                      <div className="w-12 h-12 flex-shrink-0 flex items-center justify-center" style={{ background: 'var(--s-surface)', border: '1px solid var(--s-border)' }}>
                        <User size={14} style={{ color: 'var(--s-text-muted)' }} />
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-semibold truncate">{sg.displayName}</p>
                        {sg.country && (
                          <Image src={`https://flagcdn.com/16x12/${sg.country.toLowerCase()}.png`}
                            alt={sg.country} width={14} height={10} className="flex-shrink-0" unoptimized />
                        )}
                      </div>
                      <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                        {sg.matchingGames.map(g => (
                          <span key={g} className={`tag ${g === 'rocket_league' ? 'tag-blue' : 'tag-green'}`} style={{ fontSize: '12px', padding: '1px 6px' }}>
                            {g === 'rocket_league' ? 'RL' : 'TM'}
                          </span>
                        ))}
                        {sg.rlRank && (
                          <span className="text-xs" style={{ color: 'var(--s-text-dim)' }}>
                            {sg.rlRank}{sg.rlMmr ? ` · ${sg.rlMmr}` : ''}
                          </span>
                        )}
                        {sg.pseudoTM && <span className="text-xs" style={{ color: 'var(--s-text-dim)' }}>{sg.pseudoTM}</span>}
                      </div>
                    </div>
                    <Eye size={14} className="flex-shrink-0 mt-1" style={{ color: 'var(--s-text-muted)' }} />
                  </Link>
                );
              })}
            </div>
          )}
        </SectionPanel>
      )}
    </>
  );
}
