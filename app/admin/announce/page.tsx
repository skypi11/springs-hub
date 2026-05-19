'use client';

// Page admin : Annonces Discord
//
// Permet à un admin de :
// 1. Choisir un channel texte du serveur Discord communautaire Aedral
// 2. Pré-remplir avec une template (patch notes, événement, etc.)
// 3. Modifier le titre + description (markdown Discord supporté)
// 4. Voir une preview live de l'embed
// 5. Publier via le bot
//
// Backend : /api/admin/discord-broadcast (GET liste channels, POST envoie)

import { useEffect, useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { api, ApiError } from '@/lib/api-client';
import { useToast } from '@/components/ui/Toast';
import {
  Megaphone, Loader2, Send, Eye, FileText, RefreshCw, AlertCircle,
  CheckCircle2, ExternalLink, Palette,
} from 'lucide-react';
import Breadcrumbs from '@/components/ui/Breadcrumbs';

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

// ── Templates pré-définies ─────────────────────────────────────────────────
// Ajoute ici les drafts pour faciliter les futures annonces. La sélection
// de la template ne fait que pré-remplir le formulaire — l'admin peut tout
// éditer avant de publier.
interface Template {
  key: string;
  label: string;
  title: string;
  description: string;
  color: number;
  defaultChannelHint?: string; // nom du channel suggéré, pour orienter le dropdown
}

const TEMPLATES: Template[] = [
  {
    key: 'patch-notes-mai-2026',
    label: 'Patch notes — Mai 2026',
    title: '📢 Nouveautés Aedral — Mai 2026',
    color: 0xFFB800,
    defaultChannelHint: 'annonces',
    description: `Récap des dernières mises à jour. Comme toujours, tout est gratuit.

**🎮 Profil Rocket League amélioré**
Ton profil affiche maintenant les **vraies icônes de rang officielles** (Bronze → SSL). Choisis ta plateforme (Epic, Steam, PSN, Xbox, Switch) et les liens **tracker.gg + Ballchasing** sont générés automatiquement.

**🔗 Lie tes comptes Twitch, YouTube, Spotify, Epic, Steam…**
Aedral récupère automatiquement tous les comptes que tu as liés à ton Discord. Va dans **Settings → Comptes liés** et toggle ceux que tu veux afficher sur ton profil public.

**🟢 Liaison Steam directe (recommandée pour les joueurs Steam)**
Nouveau bouton **« Lier mon Steam »** dans Settings → Jeux. Ton identifiant Steam permanent est récupéré une bonne fois pour toutes — ton lien tracker.gg ne cassera jamais, même si tu changes ton pseudo Steam.

**✨ Branding Aedral peaufiné**
Le logo a été refait avec une vraie typographie cohérente, et l'aperçu quand tu partages [aedral.com](https://aedral.com) (Discord, Twitter…) est maintenant beaucoup plus propre.

**📱 App icons mobile**
Tu peux ajouter **Aedral en raccourci** sur ton téléphone (iOS/Android) avec une vraie icône d'app.`,
  },
  {
    key: 'vide',
    label: '— Vide (à rédiger from scratch) —',
    title: '',
    description: '',
    color: 0xFFB800,
  },
];

const DEFAULT_TEMPLATE = TEMPLATES[0];

export default function AdminAnnouncePage() {
  const { firebaseUser, isAdmin, loading: authLoading } = useAuth();
  const toast = useToast();

  const [channels, setChannels] = useState<BroadcastChannel[] | null>(null);
  const [channelsErr, setChannelsErr] = useState('');
  const [loadingChannels, setLoadingChannels] = useState(false);

  const [channelId, setChannelId] = useState('');
  const [templateKey, setTemplateKey] = useState(DEFAULT_TEMPLATE.key);
  const [title, setTitle] = useState(DEFAULT_TEMPLATE.title);
  const [description, setDescription] = useState(DEFAULT_TEMPLATE.description);
  const [color, setColor] = useState(DEFAULT_TEMPLATE.color);

  const [sending, setSending] = useState(false);
  const [lastSent, setLastSent] = useState<SendResponse | null>(null);

  async function loadChannels() {
    if (!firebaseUser) return;
    setLoadingChannels(true);
    setChannelsErr('');
    try {
      const res = await api<{ channels: BroadcastChannel[] }>('/api/admin/discord-broadcast');
      setChannels(res.channels);
      // Auto-select le channel #annonces si présent (ou celui suggéré par la template)
      const hint = DEFAULT_TEMPLATE.defaultChannelHint?.toLowerCase();
      const suggested = hint
        ? res.channels.find(c => c.name.toLowerCase().includes(hint))
        : null;
      if (suggested) setChannelId(suggested.id);
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Erreur lors du chargement des channels';
      setChannelsErr(msg);
    } finally {
      setLoadingChannels(false);
    }
  }

  useEffect(() => {
    if (firebaseUser && isAdmin) loadChannels();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firebaseUser, isAdmin]);

  function applyTemplate(key: string) {
    const tpl = TEMPLATES.find(t => t.key === key) ?? DEFAULT_TEMPLATE;
    setTemplateKey(key);
    setTitle(tpl.title);
    setDescription(tpl.description);
    setColor(tpl.color);
    // Si une suggestion de channel existe et qu'on a la liste, la pré-sélectionner
    if (tpl.defaultChannelHint && channels) {
      const hint = tpl.defaultChannelHint.toLowerCase();
      const match = channels.find(c => c.name.toLowerCase().includes(hint));
      if (match) setChannelId(match.id);
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
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Erreur lors de l\'envoi';
      toast.error(msg);
    } finally {
      setSending(false);
    }
  }

  // Grouper les channels par catégorie pour le dropdown
  const channelsByCategory = (channels ?? []).reduce<Record<string, BroadcastChannel[]>>((acc, c) => {
    if (!acc[c.category]) acc[c.category] = [];
    acc[c.category].push(c);
    return acc;
  }, {});

  if (!authLoading && !isAdmin) {
    return (
      <div className="min-h-screen px-8 py-8 flex items-center justify-center">
        <div className="panel p-10 text-center max-w-md">
          <AlertCircle size={32} className="mx-auto mb-4" style={{ color: 'var(--s-text-muted)' }} />
          <h2 className="font-display text-2xl mb-2">ACCÈS REFUSÉ</h2>
          <p className="t-body">Cette page est réservée aux admins.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen px-8 py-8 space-y-6 hex-bg">
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
            Publie une annonce sur le serveur Discord communautaire officiel Aedral via le bot.
          </p>
        </div>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* ── Formulaire ─────────────────────────────────────────────── */}
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
              <label className="t-label block mb-2">Charger une template</label>
              <select
                value={templateKey}
                onChange={e => applyTemplate(e.target.value)}
                className="settings-input w-full"
              >
                {TEMPLATES.map(t => (
                  <option key={t.key} value={t.key}>{t.label}</option>
                ))}
              </select>
              <p className="text-xs mt-1.5" style={{ color: 'var(--s-text-muted)' }}>
                La template pré-remplit titre + description + couleur. Tu peux tout éditer avant de publier.
              </p>
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
                  <AlertCircle size={14} style={{ color: 'var(--s-text-muted)' }} />
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
                    <option value="">— Choisis un channel —</option>
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
                    <RefreshCw size={10} /> Recharger la liste
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
                placeholder="Ex: 📢 Nouveautés Aedral — Mai 2026"
                maxLength={256}
              />
            </div>

            {/* Description */}
            <div>
              <label className="t-label block mb-2">
                Description (markdown Discord supporté — **gras**, *italique*, [lien](url), \`code\`)
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
                <Palette size={11} /> Couleur de la barre latérale de l&apos;embed
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
                  onClick={() => setColor(0xFFB800)}
                  className="text-xs px-3 py-2 bevel-sm"
                  style={{ background: 'var(--s-elevated)', border: '1px solid var(--s-border)', color: 'var(--s-text-dim)' }}
                >
                  Or Aedral
                </button>
              </div>
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
              Aperçu approximatif de l&apos;embed Discord. Le markdown sera rendu côté Discord.
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
              <div className="flex-1">
                {title && (
                  <div className="font-semibold mb-2" style={{ color: '#f2f3f5', fontSize: 16 }}>
                    {title}
                  </div>
                )}
                <pre
                  className="whitespace-pre-wrap"
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
