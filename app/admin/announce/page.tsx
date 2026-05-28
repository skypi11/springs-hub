'use client';

// Page admin : Annonces Discord
//
// Permet à un admin de :
// 1. Charger une template existante (stockée en Firestore) OU partir de zéro
// 2. Choisir un channel texte du serveur Discord communautaire Aedral
// 3. Modifier le titre + description (markdown Discord supporté)
// 4. Voir une preview live de l'embed
// 5. Publier via le bot
// 6. Sauvegarder le brouillon comme nouvelle template (ou mettre à jour
//    l'existante, ou la supprimer), sans deploy
//
// Backend :
//   /api/admin/discord-broadcast        → liste channels (GET), publie (POST)
//   /api/admin/announce-templates       → liste/crée templates (GET, POST)
//   /api/admin/announce-templates/[id]  → édite/supprime (PATCH, DELETE)

import { useEffect, useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { api, ApiError } from '@/lib/api-client';
import { useToast } from '@/components/ui/Toast';
import { useConfirm } from '@/components/ui/ConfirmModal';
import {
  Megaphone, Loader2, Send, Eye, FileText, RefreshCw, AlertCircle,
  CheckCircle2, ExternalLink, Palette, Save, Trash2, Plus,
} from 'lucide-react';
import Breadcrumbs from '@/components/ui/Breadcrumbs';
import type { AnnounceTemplate } from '@/types';
import { ALL_CHANGELOG_CATEGORIES, getChangelogCategory } from '@/lib/changelog-categories';

interface BroadcastChannel {
  id: string;
  name: string;
  category: string;
}

interface SendResponse {
  ok: boolean;
  messageId: string;
  messageUrl: string;
  channelName: string;
}

const AEDRAL_OR = 0xFFB800;

// Template locale "Vide", pas stockée en Firestore, juste un reset rapide
const BLANK_TEMPLATE: Pick<AnnounceTemplate, 'title' | 'description' | 'color' | 'defaultChannelHint'> & {
  category: string;
  publishOnSite: boolean;
} = {
  title: '',
  description: '',
  color: AEDRAL_OR,
  category: 'feature',
  publishOnSite: true,
};

export default function AdminAnnouncePage() {
  const { firebaseUser, isAdmin, loading: authLoading } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();

  // ── Channels Discord ──────────────────────────────────────────────────
  const [channels, setChannels] = useState<BroadcastChannel[] | null>(null);
  const [channelsErr, setChannelsErr] = useState('');
  const [loadingChannels, setLoadingChannels] = useState(false);
  const [channelId, setChannelId] = useState('');

  // ── Templates Firestore ───────────────────────────────────────────────
  const [templates, setTemplates] = useState<AnnounceTemplate[]>([]);
  const [loadingTemplates, setLoadingTemplates] = useState(false);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>(''); // '' = nouveau / vide

  // ── Form ──────────────────────────────────────────────────────────────
  const [title, setTitle] = useState(BLANK_TEMPLATE.title);
  const [description, setDescription] = useState(BLANK_TEMPLATE.description);
  const [color, setColor] = useState(BLANK_TEMPLATE.color);
  const [category, setCategory] = useState<string>(BLANK_TEMPLATE.category);
  const [publishOnSite, setPublishOnSite] = useState<boolean>(BLANK_TEMPLATE.publishOnSite);
  const [sending, setSending] = useState(false);
  const [savingTpl, setSavingTpl] = useState(false);
  const [lastSent, setLastSent] = useState<SendResponse | null>(null);

  async function loadChannels() {
    if (!firebaseUser) return;
    setLoadingChannels(true);
    setChannelsErr('');
    try {
      const res = await api<{ channels: BroadcastChannel[] }>('/api/admin/discord-broadcast');
      setChannels(res.channels);
    } catch (err) {
      setChannelsErr(err instanceof ApiError ? err.message : 'Erreur réseau');
    } finally {
      setLoadingChannels(false);
    }
  }

  async function loadTemplates() {
    if (!firebaseUser) return;
    setLoadingTemplates(true);
    try {
      const res = await api<{ templates: AnnounceTemplate[] }>('/api/admin/announce-templates');
      setTemplates(res.templates);
    } catch (err) {
      console.error('[Announce] load templates error', err);
    } finally {
      setLoadingTemplates(false);
    }
  }

  useEffect(() => {
    if (firebaseUser && isAdmin) {
      loadChannels();
      loadTemplates();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firebaseUser, isAdmin]);

  // Auto-sélectionne #annonces une fois les channels chargés (si rien d'autre choisi)
  useEffect(() => {
    if (channels && !channelId) {
      const annonces = channels.find(c => /annonce/i.test(c.name));
      if (annonces) setChannelId(annonces.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channels]);

  function applyTemplate(tplId: string) {
    setSelectedTemplateId(tplId);
    if (!tplId) {
      setTitle(BLANK_TEMPLATE.title);
      setDescription(BLANK_TEMPLATE.description);
      setColor(BLANK_TEMPLATE.color);
      setCategory(BLANK_TEMPLATE.category);
      setPublishOnSite(BLANK_TEMPLATE.publishOnSite);
      return;
    }
    const tpl = templates.find(t => t.id === tplId);
    if (!tpl) return;
    setTitle(tpl.title);
    setDescription(tpl.description);
    setColor(tpl.color);
    setCategory(tpl.category ?? 'feature');
    setPublishOnSite(tpl.publishOnSite !== false);
    // Auto-sélectionne le channel suggéré si dispo
    if (tpl.defaultChannelHint && channels) {
      const hint = tpl.defaultChannelHint.toLowerCase();
      const match = channels.find(c => c.name.toLowerCase().includes(hint));
      if (match) setChannelId(match.id);
    }
  }

  async function handleSaveNewTemplate() {
    const label = window.prompt(
      'Nom de la nouvelle template (ex: "Patch notes, Juin 2026")',
      title.replace(/^📢\s*/, '').trim() || 'Sans titre',
    );
    if (!label?.trim()) return;

    // Demander le channel hint (suggéré au chargement de la template plus tard)
    const channelHint = window.prompt(
      'Nom partiel du channel cible suggéré (ex: "annonces"). Laisse vide si pas de suggestion.',
      'annonces',
    );

    setSavingTpl(true);
    try {
      const res = await api<{ ok: true; id: string }>('/api/admin/announce-templates', {
        method: 'POST',
        body: {
          label: label.trim(), title, description, color,
          defaultChannelHint: channelHint?.trim() ?? null,
          category, publishOnSite,
        },
      });
      toast.success(`Template "${label.trim()}" sauvegardée`);
      setSelectedTemplateId(res.id);
      await loadTemplates();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Erreur de sauvegarde');
    } finally {
      setSavingTpl(false);
    }
  }

  async function handleUpdateTemplate() {
    if (!selectedTemplateId) return;
    setSavingTpl(true);
    try {
      await api(`/api/admin/announce-templates/${selectedTemplateId}`, {
        method: 'PATCH',
        body: { title, description, color, category, publishOnSite },
      });
      toast.success('Template mise à jour');
      await loadTemplates();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Erreur de mise à jour');
    } finally {
      setSavingTpl(false);
    }
  }

  async function handleDeleteTemplate() {
    if (!selectedTemplateId) return;
    const tpl = templates.find(t => t.id === selectedTemplateId);
    const ok = await confirm({
      title: 'Supprimer cette template ?',
      message: `"${tpl?.label ?? 'Sans nom'}" sera définitivement supprimée.`,
      confirmLabel: 'Supprimer',
      variant: 'danger',
    });
    if (!ok) return;
    setSavingTpl(true);
    try {
      await api(`/api/admin/announce-templates/${selectedTemplateId}`, { method: 'DELETE' });
      toast.success('Template supprimée');
      setSelectedTemplateId('');
      setTitle(BLANK_TEMPLATE.title);
      setDescription(BLANK_TEMPLATE.description);
      setColor(BLANK_TEMPLATE.color);
      setCategory(BLANK_TEMPLATE.category);
      setPublishOnSite(BLANK_TEMPLATE.publishOnSite);
      await loadTemplates();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Erreur de suppression');
    } finally {
      setSavingTpl(false);
    }
  }

  async function handleSend() {
    if (!channelId) {
      toast.error('Sélectionne un channel.');
      return;
    }
    if (!description.trim()) {
      toast.error('La description ne peut pas être vide.');
      return;
    }
    setSending(true);
    try {
      const res = await api<SendResponse>('/api/admin/discord-broadcast', {
        method: 'POST',
        body: { channelId, title, description, color },
      });
      setLastSent(res);
      toast.success(`Message envoyé sur #${res.channelName}`);
      // Marque la template comme utilisée (pour future tri "récent")
      if (selectedTemplateId) {
        api(`/api/admin/announce-templates/${selectedTemplateId}`, {
          method: 'PATCH',
          body: { markUsed: true },
        }).catch(() => {});
      }
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Erreur lors de l\'envoi');
    } finally {
      setSending(false);
    }
  }

  // Détecte si le contenu actuel diffère de la template sélectionnée
  const selectedTpl = templates.find(t => t.id === selectedTemplateId);
  const isDirty = selectedTpl
    ? (
        selectedTpl.title !== title
        || selectedTpl.description !== description
        || selectedTpl.color !== color
        || (selectedTpl.category ?? 'feature') !== category
        || (selectedTpl.publishOnSite !== false) !== publishOnSite
      )
    : (
        title !== BLANK_TEMPLATE.title
        || description !== BLANK_TEMPLATE.description
        || color !== BLANK_TEMPLATE.color
        || category !== BLANK_TEMPLATE.category
        || publishOnSite !== BLANK_TEMPLATE.publishOnSite
      );

  // Grouper les channels par catégorie
  const channelsByCategory = (channels ?? []).reduce<Record<string, BroadcastChannel[]>>((acc, c) => {
    if (!acc[c.category]) acc[c.category] = [];
    acc[c.category].push(c);
    return acc;
  }, {});

  if (!authLoading && !isAdmin) {
    return (
      <div className="min-h-screen px-4 sm:px-6 lg:px-8 py-6 lg:py-8 flex items-center justify-center">
        <div className="panel p-10 text-center max-w-md">
          <AlertCircle size={32} className="mx-auto mb-4" style={{ color: 'var(--s-text-muted)' }} />
          <h2 className="font-display text-2xl mb-2">ACCÈS REFUSÉ</h2>
          <p className="t-body">Cette page est réservée aux admins.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen px-4 sm:px-6 lg:px-8 py-6 lg:py-8 space-y-6 hex-bg">
      <Breadcrumbs items={[{ label: 'Admin', href: '/admin' }, { label: 'Annonces Discord' }]} />

      <header className="flex items-center gap-3">
        <div
          className="p-2 bevel-sm"
          style={{ background: 'rgba(123,47,190,0.08)', border: '1px solid rgba(123,47,190,0.25)' }}
        >
          <Megaphone size={18} style={{ color: 'var(--s-violet)' }} />
        </div>
        <div>
          <h1 className="font-display text-2xl tracking-wider">ANNONCES DISCORD</h1>
          <p className="text-sm" style={{ color: 'var(--s-text-dim)' }}>
            Publie une annonce sur le serveur Discord communautaire officiel Aedral via le bot. Tes templates sont stockées en base, pas besoin de redéploy pour en ajouter.
          </p>
        </div>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* ── Rédaction ────────────────────────────────────────────────── */}
        <div className="pillar-card panel relative overflow-hidden">
          <div className="h-[3px]" style={{ background: 'linear-gradient(90deg, var(--s-violet), rgba(123,47,190,0.3), transparent 70%)' }} />
          <div className="panel-header">
            <div className="flex items-center gap-2">
              <FileText size={13} style={{ color: 'var(--s-violet)' }} />
              <span className="t-label" style={{ color: 'var(--s-text)' }}>RÉDACTION</span>
            </div>
          </div>
          <div className="p-5 space-y-5">
            {/* Template */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="t-label">Template</label>
                {loadingTemplates && <Loader2 size={11} className="animate-spin" style={{ color: 'var(--s-text-muted)' }} />}
              </div>
              <select
                value={selectedTemplateId}
                onChange={e => applyTemplate(e.target.value)}
                className="settings-input w-full"
              >
                <option value="">Vide (rédiger from scratch)</option>
                {templates.map(t => (
                  <option key={t.id} value={t.id}>{t.label}</option>
                ))}
              </select>
              <div className="flex flex-wrap gap-2 mt-2">
                <button
                  type="button"
                  onClick={handleSaveNewTemplate}
                  disabled={savingTpl || !description.trim()}
                  className="text-xs inline-flex items-center gap-1.5 px-3 py-1.5 bevel-sm disabled:opacity-50"
                  style={{
                    background: 'rgba(123,47,190,0.1)',
                    border: '1px solid rgba(123,47,190,0.3)',
                    color: 'var(--s-violet-light)',
                  }}
                >
                  <Plus size={11} /> Sauvegarder comme nouvelle template
                </button>
                {selectedTemplateId && (
                  <>
                    <button
                      type="button"
                      onClick={handleUpdateTemplate}
                      disabled={savingTpl || !isDirty}
                      className="text-xs inline-flex items-center gap-1.5 px-3 py-1.5 bevel-sm disabled:opacity-40"
                      style={{
                        background: isDirty ? 'rgba(255,184,0,0.1)' : 'transparent',
                        border: `1px solid ${isDirty ? 'rgba(255,184,0,0.35)' : 'var(--s-border)'}`,
                        color: isDirty ? 'var(--s-gold)' : 'var(--s-text-muted)',
                      }}
                    >
                      <Save size={11} /> Mettre à jour cette template
                    </button>
                    <button
                      type="button"
                      onClick={handleDeleteTemplate}
                      disabled={savingTpl}
                      className="text-xs inline-flex items-center gap-1.5 px-3 py-1.5 bevel-sm disabled:opacity-50"
                      style={{
                        background: 'transparent',
                        border: '1px solid rgba(255, 100, 100, 0.3)',
                        color: '#ff7878',
                      }}
                    >
                      <Trash2 size={11} /> Supprimer
                    </button>
                  </>
                )}
              </div>
            </div>

            {/* Channel */}
            <div>
              <label className="t-label block mb-2">Channel cible</label>
              {loadingChannels ? (
                <div className="flex items-center gap-2 text-sm" style={{ color: 'var(--s-text-muted)' }}>
                  <Loader2 size={14} className="animate-spin" /> Chargement des channels…
                </div>
              ) : channelsErr ? (
                <div className="flex items-center gap-2 text-sm" style={{ color: 'var(--s-text-muted)' }}>
                  <AlertCircle size={14} />
                  {channelsErr}
                  <button onClick={loadChannels} className="text-xs underline">Retry</button>
                </div>
              ) : (
                <>
                  <select
                    value={channelId}
                    onChange={e => setChannelId(e.target.value)}
                    className="settings-input w-full"
                  >
                    <option value="">Choisis un channel</option>
                    {Object.entries(channelsByCategory).map(([category, items]) => (
                      <optgroup key={category} label={category}>
                        {items.map(c => (
                          <option key={c.id} value={c.id}>#{c.name}</option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                  <button
                    onClick={loadChannels}
                    className="text-xs mt-1.5 inline-flex items-center gap-1"
                    style={{ color: 'var(--s-text-muted)' }}
                  >
                    <RefreshCw size={10} /> Recharger
                  </button>
                </>
              )}
            </div>

            {/* Titre */}
            <div>
              <label className="t-label block mb-2">Titre (optionnel)</label>
              <input
                type="text"
                value={title}
                onChange={e => setTitle(e.target.value)}
                className="settings-input w-full"
                placeholder="Ex: 📢 Nouveautés Aedral · Mai 2026"
                maxLength={256}
              />
            </div>

            {/* Description */}
            <div>
              <label className="t-label block mb-2">
                Description (markdown Discord supporté, **gras**, *italique*, [lien](url), \`code\`)
              </label>
              <textarea
                value={description}
                onChange={e => setDescription(e.target.value)}
                className="settings-input w-full font-mono"
                rows={16}
                maxLength={4000}
                placeholder="Le corps du message. Markdown Discord."
                style={{ fontSize: 13, lineHeight: 1.5 }}
              />
              <p className="text-xs mt-1.5" style={{ color: 'var(--s-text-muted)' }}>
                {description.length} / 4000 caractères
              </p>
            </div>

            {/* Couleur */}
            <div>
              <label className="t-label block mb-2 flex items-center gap-2">
                <Palette size={11} /> Couleur de la barre latérale
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={`#${color.toString(16).padStart(6, '0')}`}
                  onChange={e => setColor(parseInt(e.target.value.replace('#', ''), 16))}
                  className="h-9 w-12 cursor-pointer bevel-sm"
                  style={{ border: '1px solid var(--s-border)' }}
                />
                <input
                  type="text"
                  value={`#${color.toString(16).padStart(6, '0').toUpperCase()}`}
                  onChange={e => {
                    const hex = e.target.value.replace('#', '').slice(0, 6);
                    if (/^[0-9a-f]{0,6}$/i.test(hex)) {
                      setColor(parseInt(hex.padEnd(6, '0'), 16));
                    }
                  }}
                  className="settings-input flex-1 t-mono"
                  style={{ fontSize: 13 }}
                />
                <button
                  type="button"
                  onClick={() => setColor(AEDRAL_OR)}
                  className="text-xs px-3 py-2 bevel-sm"
                  style={{ background: 'var(--s-elevated)', border: '1px solid var(--s-border)', color: 'var(--s-text-dim)' }}
                >
                  Or Aedral
                </button>
              </div>
            </div>

            {/* Catégorie changelog, auto-détectée depuis les emojis du markdown,
                ce selector sert juste d'override "principal" (couleur de la card
                + emoji avatar) si tu veux forcer manuellement. Vide ou 'feature' =
                la dominante des sections est utilisée. */}
            <details className="bevel-sm" style={{ background: 'var(--s-elevated)', border: '1px solid var(--s-border)' }}>
              <summary className="px-3 py-2 text-xs cursor-pointer flex items-center gap-2" style={{ color: 'var(--s-text-muted)' }}>
                ⚙️ Avancé : override catégorie principale (sinon auto-détectée)
              </summary>
              <div className="p-3 space-y-2">
                <p className="text-xs" style={{ color: 'var(--s-text-muted)' }}>
                  Par défaut, la timeline /changelog détecte automatiquement les catégories à partir des emojis dans les titres de sections du markdown (**🎯 ...**, **🐛 ...**, etc.). Ce selector force la couleur principale de la card.
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {ALL_CHANGELOG_CATEGORIES.map(cat => {
                    const active = category === cat.id;
                    return (
                      <button
                        key={cat.id}
                        type="button"
                        onClick={() => setCategory(cat.id)}
                        className="tag flex items-center gap-1.5 transition-all duration-150"
                        style={{
                          background: active ? `rgba(${cat.colorRgb}, 0.15)` : 'transparent',
                          color: active ? cat.color : 'var(--s-text-muted)',
                          borderColor: active ? `rgba(${cat.colorRgb}, 0.4)` : 'var(--s-border)',
                          cursor: 'pointer',
                          padding: '4px 8px',
                          fontSize: '11px',
                        }}
                        title={cat.hint}
                      >
                        <span>{cat.emoji}</span> {cat.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            </details>

            {/* Toggle publication sur le site */}
            <div className="p-3 bevel-sm" style={{ background: publishOnSite ? 'rgba(255,184,0,0.05)' : 'var(--s-elevated)', border: `1px solid ${publishOnSite ? 'rgba(255,184,0,0.25)' : 'var(--s-border)'}` }}>
              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={publishOnSite}
                  onChange={e => setPublishOnSite(e.target.checked)}
                  className="w-4 h-4 cursor-pointer"
                  style={{ accentColor: 'var(--s-gold)' }}
                />
                <div className="flex-1">
                  <span className="text-sm font-semibold" style={{ color: publishOnSite ? 'var(--s-gold)' : 'var(--s-text)' }}>
                    Publier aussi sur le site (page /changelog)
                  </span>
                  <p className="text-xs mt-0.5" style={{ color: 'var(--s-text-muted)' }}>
                    {publishOnSite
                      ? '✓ Visible par tous les visiteurs du site dans la timeline Nouveautés. Décocher pour annonce Discord-only.'
                      : 'Annonce Discord-only. Cocher pour publier aussi sur /changelog (touche les 80 % d\'inscrits qui ne sont pas sur le Discord).'}
                  </p>
                </div>
              </label>
            </div>

            {/* Envoi */}
            <div className="pt-3" style={{ borderTop: '1px solid var(--s-border)' }}>
              <button
                onClick={handleSend}
                disabled={sending || !channelId || !description.trim()}
                className="btn-springs btn-primary bevel-sm inline-flex items-center gap-2 disabled:opacity-50"
              >
                {sending ? (
                  <>
                    <Loader2 size={14} className="animate-spin" /> Publication…
                  </>
                ) : (
                  <>
                    <Send size={14} /> Publier sur le Discord Aedral
                  </>
                )}
              </button>
              {lastSent && (
                <div
                  className="mt-3 p-3 flex items-center gap-2 text-sm"
                  style={{
                    background: 'rgba(0,217,54,0.06)',
                    border: '1px solid rgba(0,217,54,0.25)',
                    color: 'var(--s-text)',
                  }}
                >
                  <CheckCircle2 size={14} style={{ color: 'var(--s-green)' }} />
                  Envoyé sur <strong>#{lastSent.channelName}</strong>
                  <a
                    href={lastSent.messageUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="ml-auto inline-flex items-center gap-1 text-xs"
                    style={{ color: 'var(--s-blue)' }}
                  >
                    Ouvrir <ExternalLink size={10} />
                  </a>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ── Preview ─────────────────────────────────────────────────── */}
        <div className="pillar-card panel relative overflow-hidden">
          <div className="h-[3px]" style={{ background: 'linear-gradient(90deg, var(--s-blue), rgba(0,129,255,0.3), transparent 70%)' }} />
          <div className="panel-header">
            <div className="flex items-center gap-2">
              <Eye size={13} style={{ color: 'var(--s-blue)' }} />
              <span className="t-label" style={{ color: 'var(--s-text)' }}>PREVIEW</span>
            </div>
          </div>
          <div className="p-5">
            <p className="text-xs mb-3" style={{ color: 'var(--s-text-muted)' }}>
              Aperçu approximatif de l&apos;embed Discord. Le markdown sera rendu correctement côté Discord.
            </p>
            <div
              className="p-4 flex gap-3"
              style={{
                background: '#2b2d31',
                border: '1px solid #1e1f22',
                borderLeft: `4px solid #${color.toString(16).padStart(6, '0')}`,
                color: '#dbdee1',
                fontFamily: 'system-ui, -apple-system, sans-serif',
                fontSize: 14,
                lineHeight: 1.45,
              }}
            >
              <div className="flex-1 min-w-0">
                {title && (
                  <div className="font-semibold mb-2" style={{ color: '#f2f3f5', fontSize: 16 }}>
                    {title}
                  </div>
                )}
                <pre
                  className="whitespace-pre-wrap break-words"
                  style={{
                    fontFamily: 'inherit',
                    margin: 0,
                    color: '#dbdee1',
                  }}
                >
                  {description}
                </pre>
                <div className="mt-3 pt-2 text-xs" style={{ color: '#949ba4', borderTop: '1px solid #3f4147' }}>
                  Aedral · aedral.com · {new Date().toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
