'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/context/AuthContext';
import { api, apiDownload, ApiError } from '@/lib/api-client';
import { track, getConsent, optIn, optOut } from '@/lib/analytics';
import { useToast } from '@/components/ui/Toast';
import { countries } from '@/lib/countries';
import {
  Save, User, Gamepad2, Search, ExternalLink,
  AlertCircle, CheckCircle, Loader2, UserCircle, LogOut, Star,
  Download, Trash2, Link2, RefreshCw, Share2, Bell, ChevronRight,
} from 'lucide-react';
import SharingSection from '@/components/settings/SharingSection';
import Breadcrumbs from '@/components/ui/Breadcrumbs';
import { checkProfileCompletion } from '@/lib/profile-completion';
import PublicPreviewFrame from '@/components/ui/PublicPreviewFrame';
import MarkdownEditor from '@/components/ui/MarkdownEditor';
import ImageUploader from '@/components/ui/ImageUploader';
import { UPLOAD_LIMITS } from '@/lib/upload-limits';
import { RL_RANKS } from '@/lib/rl-ranks';
import { ALL_GAME_DEFS } from '@/lib/games-registry';
import { RL_PLATFORMS, getRLPlatformMeta, buildTrackerGgUrl, buildBallchasingUrl, isValidRLPlatform, type RLPlatform } from '@/lib/rl-platform';
import { getConnectionMeta, buildConnectionUrl, pickBestRLConnection, type DiscordConnection } from '@/lib/discord-connections';
import { VALORANT_VERIFICATION_PAUSED } from '@/lib/account-verification';
import GameTag from '@/components/games/GameTag';

const RECRUIT_ROLE_LABEL: Record<string, string> = {
  joueur: 'Joueur',
  coach: 'Coach',
  manager: 'Manager',
};

type Section = 'profile' | 'sharing' | 'games' | 'account';

const SECTIONS: { key: Section; label: string; icon: typeof User; description: string }[] = [
  { key: 'profile', label: 'Profil public', icon: User, description: 'Ce que les autres voient' },
  { key: 'sharing', label: 'Carte de partage', icon: Share2, description: 'Personnalise ta story et ta bannière' },
  { key: 'games', label: 'Mes jeux', icon: Gamepad2, description: 'Tes jeux pratiqués + comptes' },
  { key: 'account', label: 'Mon compte', icon: UserCircle, description: 'Discord et session' },
];

type FormData = {
  displayName: string;
  avatarUrl: string;
  bio: string;
  country: string;
  dateOfBirth: string;
  games: string[];
  rlPlatform: RLPlatform | '';
  rlPlatformId: string;
  rlRank: string;
  pseudoTM: string;
  loginTM: string;
  tmIoUrl: string;
  valorantRank: string;
  isAvailableForRecruitment: boolean;
  recruitmentRole: string;
  recruitmentMessage: string;
  // Préférence : refuser les DM Discord d'annonces/relances Aedral (n'affecte pas
  // les DM fonctionnels : exercices, rang contesté, invitations).
  dmAnnouncementsOptOut: boolean;
  // Connexions Discord, affichage seul ici, mais la visibilité est éditable
  connections: DiscordConnection[];
};

const defaultForm: FormData = {
  displayName: '',
  avatarUrl: '',
  bio: '',
  country: '',
  dateOfBirth: '',
  games: [],
  rlPlatform: '',
  rlPlatformId: '',
  rlRank: '',
  pseudoTM: '',
  loginTM: '',
  tmIoUrl: '',
  valorantRank: '',
  isAvailableForRecruitment: false,
  recruitmentRole: '',
  recruitmentMessage: '',
  dmAnnouncementsOptOut: false,
  connections: [],
};

type SteamLinked = NonNullable<NonNullable<ReturnType<typeof useAuth>['user']>['steamLinked']>;

// Validation du formulaire. Fonction PURE de `form`, sortie du composant :
// son identité est stable, donc l'auto-save peut l'appeler sans avoir à la
// déclarer en dépendance (avant, `validate()` était recréée à chaque render,
// ce qui obligeait à désactiver exhaustive-deps sur l'effet d'auto-save).
function validateForm(form: FormData): string | null {
  if (!form.displayName.trim()) return 'Le pseudo est obligatoire.';
  if (!form.country) return 'Le pays est obligatoire.';
  if (!form.dateOfBirth) return 'La date de naissance est obligatoire.';
  if (form.games.length === 0) return 'Sélectionne au moins un jeu.';
  if (form.games.includes('rocket_league')) {
    if (!form.rlPlatform) {
      return 'Sélectionne ta plateforme principale pour Rocket League.';
    }
    // Epic & Steam passent par la liaison vérifiée (pas de saisie d'ID manuelle),
    // donc on n'exige l'ID que pour les plateformes à saisie libre (PSN/Xbox/Switch…).
    // Sans ce garde, un joueur Epic/Steam non encore vérifié aurait rlPlatformId=''
    // → save bloqué en boucle sur un champ qui n'existe plus dans l'UI.
    if (form.rlPlatform !== 'epic' && form.rlPlatform !== 'steam' && !form.rlPlatformId.trim()) {
      return `Ton ${getRLPlatformMeta(form.rlPlatform).idLabel} est obligatoire pour Rocket League.`;
    }
  }
  if (form.games.includes('trackmania') && !form.pseudoTM.trim()) {
    return 'Le pseudo Ubisoft/Nadeo est obligatoire pour Trackmania.';
  }
  if (form.dateOfBirth) {
    const birth = new Date(form.dateOfBirth);
    const age = Math.floor((Date.now() - birth.getTime()) / (365.25 * 24 * 60 * 60 * 1000));
    if (age < 13) return 'Tu dois avoir au moins 13 ans pour t\'inscrire.';
  }
  return null;
}

export default function SettingsPage() {
  const { user, firebaseUser, isAdmin, loading: authLoading, signOut, signInWithDiscord, refreshProfile } = useAuth();
  const router = useRouter();
  const toast = useToast();
  const qc = useQueryClient();
  const [mustComplete, setMustComplete] = useState(false);
  const [steamLinked, setSteamLinked] = useState<SteamLinked | null>(null);
  const [linkingSteam, setLinkingSteam] = useState(false);
  const [discordSyncing, setDiscordSyncing] = useState(false);
  const [discordSyncMsg, setDiscordSyncMsg] = useState('');
  // Comptes RL officiels (anti-mensonge / sticky), voir docs/rl-rank-verification-plan.md
  const [epicLinked, setEpicLinked] = useState<{ rlEpicId: string; rlEpicName: string } | null>(null);
  const [confirmingEpic, setConfirmingEpic] = useState(false);
  const [requestingChange, setRequestingChange] = useState(false);
  const [rlSteamLinked, setRlSteamLinked] = useState<{ rlSteamId: string; rlSteamName: string } | null>(null);
  const [confirmingSteam, setConfirmingSteam] = useState(false);
  const [requestingSteamChange, setRequestingSteamChange] = useState(false);
  // Compte Riot Valorant vérifié (verrouillé sur le PUUID, miroir Epic RL).
  const [valorantLinked, setValorantLinked] = useState<{ puuid: string; riotId: string } | null>(null);
  // useToast() renvoie un objet recréé à chaque render du ToastProvider (donc à
  // chaque toast affiché ailleurs sur la page). Le déclarer en dépendance de
  // l'effet de montage ci-dessous le ferait rejouer à chaque toast (re-parse de
  // l'URL, section réinitialisée). On le lit via une ref : l'effet ne tourne
  // qu'au montage, où la ref porte déjà le toast de ce render.
  const toastRef = useRef(toast);
  useEffect(() => { toastRef.current = toast; });
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    setMustComplete(params.get('complete') === '1');
    // Auto-switch sur la section demandée par la query string (utilisé par
    // le callback Steam pour atterrir directement sur la config jeux).
    // Compat : anciens deep-links 'connections' / 'recruitment' redirigent
    // vers 'profile' (depuis la refonte 5→3 sections).
    const SECTION_KEYS: Section[] = ['profile', 'games', 'account'];
    const LEGACY_REDIRECTS: Record<string, Section> = {
      connections: 'profile',
      recruitment: 'profile',
    };
    const sectionParam = params.get('section');
    if (sectionParam) {
      if ((SECTION_KEYS as string[]).includes(sectionParam)) {
        setSection(sectionParam as Section);
      } else if (sectionParam in LEGACY_REDIRECTS) {
        setSection(LEGACY_REDIRECTS[sectionParam]);
      }
    }
    // Toasts post-redirect Steam OpenID
    if (params.get('steam_linked') === '1') {
      toastRef.current.success('Compte Steam lié avec succès. Ton SteamID64 est maintenant utilisé pour tracker.gg.');
      // Nettoie l'URL
      const cleanUrl = window.location.pathname;
      window.history.replaceState({}, '', cleanUrl);
    }
    const steamErr = params.get('steam_error');
    if (steamErr) {
      const errLabel: Record<string, string> = {
        auth_required: 'Tu dois être connecté pour lier Steam.',
        invalid_state: 'Session OAuth invalide ou expirée. Réessaie.',
        verify_failed: 'Steam n\'a pas pu vérifier ton identité. Réessaie.',
        already_linked: 'Ce compte Steam est déjà lié à un autre profil Aedral.',
        server_error: 'Erreur serveur pendant la liaison Steam. Réessaie.',
      };
      toastRef.current.error(errLabel[steamErr] ?? `Erreur Steam : ${steamErr}`);
      const cleanUrl = window.location.pathname;
      window.history.replaceState({}, '', cleanUrl);
    }
  }, []);
  const completion = checkProfileCompletion(user);
  const [form, setForm] = useState<FormData>(defaultForm);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [section, setSection] = useState<Section>('profile');
  const [dirty, setDirty] = useState(false);
  const bioRef = useRef<HTMLTextAreaElement | null>(null);
  const recruitRef = useRef<HTMLTextAreaElement | null>(null);

  // Analytics consent (RGPD niveau 3, opt-out user). State local pour le toggle,
  // synchro initiale au mount via getConsent() (lit le localStorage).
  // Default true = on tracke par défaut (trust-by-default + page privacy claire),
  // false uniquement si l'user a explicitement opt-out (bandeau ou ce toggle).
  const [analyticsEnabled, setAnalyticsEnabled] = useState(true);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    setAnalyticsEnabled(getConsent() !== 'opted-out');
  }, []);
  function toggleAnalytics(next: boolean) {
    setAnalyticsEnabled(next);
    if (next) optIn();
    else optOut();
  }

  // Actions RGPD (export / suppression)
  const [exporting, setExporting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [deleteError, setDeleteError] = useState('');
  const [deleteBlockingStructures, setDeleteBlockingStructures] = useState<string[]>([]);

  async function handleLinkSteam() {
    if (!firebaseUser) return;
    setLinkingSteam(true);
    try {
      const idToken = await firebaseUser.getIdToken();
      const res = await fetch('/api/auth/steam/start', {
        method: 'POST',
        headers: { Authorization: `Bearer ${idToken}` },
      });
      if (!res.ok) {
        toast.error('Impossible de lancer la liaison Steam. Réessaie.');
        setLinkingSteam(false);
        return;
      }
      const data = (await res.json()) as { redirectUrl?: string };
      if (data.redirectUrl) {
        window.location.href = data.redirectUrl;
      } else {
        toast.error('Réponse Steam invalide.');
        setLinkingSteam(false);
      }
    } catch {
      toast.error('Erreur réseau pendant la liaison Steam.');
      setLinkingSteam(false);
    }
  }

  async function handleUnlinkSteam() {
    if (!firebaseUser) return;
    setLinkingSteam(true);
    try {
      const idToken = await firebaseUser.getIdToken();
      const res = await fetch('/api/auth/steam/start', {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${idToken}` },
      });
      if (res.ok) {
        setSteamLinked(null);
        toast.success('Compte Steam délié.');
      } else {
        toast.error('Impossible de délier Steam.');
      }
    } catch {
      toast.error('Erreur réseau.');
    } finally {
      setLinkingSteam(false);
    }
  }

  // Snapshot l'ID Epic depuis la connexion Discord vérifiée vers rlEpicId.
  // Premier lien : libre. Changements ultérieurs : passent par une demande
  // admin (Lot 6). Voir docs/rl-rank-verification-plan.md.
  async function handleConfirmEpicLink() {
    setConfirmingEpic(true);
    try {
      const r = await api<{ ok?: boolean; message?: string; rlEpicId?: string; rlEpicName?: string }>(
        '/api/profile/rl-epic-link',
        { method: 'POST', body: {} },
      );
      if (r.ok && r.rlEpicId) {
        setEpicLinked({ rlEpicId: r.rlEpicId, rlEpicName: r.rlEpicName ?? '' });
        // Miroir local du rlPlatform/rlPlatformId persistés serveur (rl-epic-link
        // pose rlPlatformId = nom Epic) : sans ça, le lien tracker.gg du badge
        // vérifié n'apparaît qu'au prochain reload. setForm direct (pas updateForm)
        // → on ne marque pas dirty, le serveur a déjà persisté.
        setForm(prev => ({ ...prev, rlPlatform: 'epic', rlPlatformId: r.rlEpicName ?? prev.rlPlatformId }));
        toast.success(r.message ?? 'Compte Epic lié.');
        // Recharge le profil pour propager rlPlatform/rlPlatformId (miroir)
        // + invalide profileQ pour que le 2e useEffect resync les états serveur.
        await Promise.all([
          refreshProfile?.(),
          qc.invalidateQueries({ queryKey: ['profile', firebaseUser?.uid ?? null] }),
        ]);
      } else {
        toast.error(r.message ?? "Échec de la liaison.");
      }
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Erreur réseau.';
      toast.error(msg);
    } finally {
      setConfirmingEpic(false);
    }
  }

  // Demande de changement de compte Epic officiel, Lot 6.
  // Pré-requis : le joueur a déjà lié son nouveau compte Epic à son Discord
  // (et s'est reconnecté à Aedral). L'API vérifie et crée une demande pour
  // l'admin.
  async function handleRequestEpicChange() {
    const reason = typeof window !== 'undefined'
      ? window.prompt(
          'Pour quelle raison veux-tu changer ton compte Epic officiel ?\n\n'
          + '(Ex : « compte précédent perdu / hacké », « mauvais compte lié par erreur », « j\'ai fusionné mes comptes »…)\n\n'
          + 'Précision : assure-toi d\'avoir déjà mis à jour ta connexion Epic sur Discord ET de t\'être reconnecté à Aedral. Sinon la demande sera refusée.',
        )
      : null;
    if (!reason || !reason.trim()) return;
    setRequestingChange(true);
    try {
      await api('/api/profile/rl-epic-link/change-request', {
        method: 'POST',
        body: { reason: reason.trim() },
      });
      toast.success('Demande envoyée. L\'admin va la traiter.');
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Erreur réseau.';
      toast.error(msg);
    } finally {
      setRequestingChange(false);
    }
  }

  // Snapshot le SteamID64 depuis steamLinked (Steam OpenID) vers rlSteamId.
  // Symétrique à handleConfirmEpicLink.
  async function handleConfirmSteamLink() {
    setConfirmingSteam(true);
    try {
      const r = await api<{ ok?: boolean; message?: string; rlSteamId?: string; rlSteamName?: string }>(
        '/api/profile/rl-steam-link',
        { method: 'POST', body: {} },
      );
      if (r.ok && r.rlSteamId) {
        setRlSteamLinked({ rlSteamId: r.rlSteamId, rlSteamName: r.rlSteamName ?? '' });
        // Miroir local : rl-steam-link pose rlPlatformId = SteamID64 → le lien
        // tracker.gg du badge apparaît immédiatement (cf. handleConfirmEpicLink).
        setForm(prev => ({ ...prev, rlPlatform: 'steam', rlPlatformId: r.rlSteamId ?? prev.rlPlatformId }));
        toast.success(r.message ?? 'Compte Steam RL lié.');
        await Promise.all([
          refreshProfile?.(),
          qc.invalidateQueries({ queryKey: ['profile', firebaseUser?.uid ?? null] }),
        ]);
      } else {
        toast.error(r.message ?? 'Échec de la liaison.');
      }
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Erreur réseau.';
      toast.error(msg);
    } finally {
      setConfirmingSteam(false);
    }
  }

  // Demande de changement de compte Steam RL officiel. Pré-requis : avoir
  // re-lié Steam OpenID vers le nouveau compte au préalable.
  async function handleRequestSteamChange() {
    const reason = typeof window !== 'undefined'
      ? window.prompt(
          'Pour quelle raison veux-tu changer ton compte Steam RL officiel ?\n\n'
          + '(Ex : « compte précédent perdu », « mauvais compte lié par erreur »…)\n\n'
          + 'Précision : assure-toi d\'avoir déjà délié Steam puis re-lié ton nouveau compte (Settings → « Lier mon Steam »). Sinon la demande sera refusée.',
        )
      : null;
    if (!reason || !reason.trim()) return;
    setRequestingSteamChange(true);
    try {
      await api('/api/profile/rl-steam-link/change-request', {
        method: 'POST',
        body: { reason: reason.trim() },
      });
      toast.success('Demande envoyée. L\'admin va la traiter.');
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Erreur réseau.';
      toast.error(msg);
    } finally {
      setRequestingSteamChange(false);
    }
  }

  async function handleDiscordSync() {
    if (!firebaseUser) return;
    setDiscordSyncing(true);
    setDiscordSyncMsg('');
    try {
      const r = await api<{ result: string }>('/api/discord/sync-me', { method: 'POST' });
      const messages: Record<string, string> = {
        synced: '✓ Pseudo et rôles synchronisés sur le serveur Discord Aedral.',
        not_on_server: "Tu n'as pas encore rejoint le serveur Discord Aedral. Rejoins-le, puis resynchronise.",
        no_discord_id: 'Ton compte n\'est pas lié à Discord.',
        disabled: 'La synchronisation Discord n\'est pas encore activée côté serveur.',
        error: 'Erreur pendant la synchronisation. Réessaie plus tard.',
      };
      setDiscordSyncMsg(messages[r.result] ?? 'Synchronisation terminée.');
    } catch {
      setDiscordSyncMsg('Erreur réseau. Réessaie plus tard.');
    }
    setDiscordSyncing(false);
  }

  async function handleExport() {
    if (!firebaseUser) return;
    setExporting(true);
    try {
      const result = await apiDownload('/api/account/export');
      const blob = result.kind === 'blob'
        ? result.blob
        : new Blob([JSON.stringify(result.data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `springs-hub-export-${firebaseUser.uid}-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('[Settings] export error:', err);
      setError('Export impossible, réessaie dans un instant.');
    }
    setExporting(false);
  }

  async function handleDelete() {
    if (!firebaseUser) return;
    setDeleting(true);
    setDeleteError('');
    setDeleteBlockingStructures([]);
    try {
      await api('/api/account/delete', { method: 'POST' });
      await signOut();
      router.push('/?deleted=1');
      return;
    } catch (err) {
      if (err instanceof ApiError) {
        const payload = err.payload as { structures?: string[] } | null;
        if (err.status === 409 && Array.isArray(payload?.structures)) {
          setDeleteBlockingStructures(payload.structures);
        }
        setDeleteError(err.message || 'Suppression impossible.');
      } else {
        console.error('[Settings] delete error:', err);
        setDeleteError('Erreur réseau. Réessaie.');
      }
    }
    setDeleting(false);
  }

  function updateForm(next: Partial<FormData>) {
    setForm(prev => ({ ...prev, ...next }));
    setDirty(true);
    if (saved) setSaved(false);
  }

  const profileQ = useQuery({
    queryKey: ['profile', firebaseUser?.uid ?? null] as const,
    queryFn: () => api<Record<string, unknown>>(`/api/profile?uid=${encodeURIComponent(firebaseUser!.uid)}`),
    enabled: !!firebaseUser && !authLoading,
  });

  // Lot B : un titulaire/remplaçant d'une équipe ne peut pas être LFT. Le serveur
  // l'impose (GET /api/profile renvoie isRostered) ; ici on grise le toggle.
  const isRostered = (profileQ.data as { isRostered?: boolean } | undefined)?.isRostered === true;

  useEffect(() => {
    if (loaded || !firebaseUser) return;
    if (profileQ.isPending) return;
    const data = (profileQ.data ?? {}) as Record<string, string | string[] | boolean | undefined>;
    // Pré-remplissage RL en cascade :
    //  1. Valeur déjà saisie par l'user (rlPlatform + rlPlatformId), priorité absolue
    //  2. Champs legacy (epicAccountId/epicDisplayName), migration douce
    //  3. Connexion Discord gaming (Steam > Epic > PSN > Xbox > Switch)
    //     → permet à l'user de bénéficier du sync auto sans rien faire
    const legacyEpicPseudo = (data.epicDisplayName as string) || (data.epicAccountId as string) || '';
    const savedPlatform = (data.rlPlatform as string) || '';
    const savedPlatformId = (data.rlPlatformId as string) || '';
    const connections = (data.discordConnections as DiscordConnection[] | undefined) ?? [];
    const fromDiscord = pickBestRLConnection(connections);
    // Post-F2P, Epic est l'identité RL canonique (ancre du rang vérifié). Si une
    // connexion Epic Discord vérifiée existe, on la propose par défaut même quand
    // pickBestRLConnection privilégierait Steam — c'est le 1-clic de vérification
    // qu'on veut surfacer en priorité (cf. mémoire project_rl_rank_strategy).
    // id laissé vide pré-confirmation : c'est handleConfirmEpicLink qui posera le
    // rlPlatformId canonique (nom Epic) — éviter un lien tracker.gg erroné/un 4e
    // bloc « liens auto-générés » pour un compte Epic pas encore vérifié.
    const epicDiscordConn = connections.find(c => c.type === 'epicgames' && c.verified);
    const preferredFromDiscord = epicDiscordConn
      ? { platform: 'epic' as RLPlatform, id: '' }
      : fromDiscord;

    const initialPlatform: RLPlatform | '' = isValidRLPlatform(savedPlatform)
      ? savedPlatform
      : (legacyEpicPseudo ? 'epic' : (preferredFromDiscord?.platform ?? ''));
    const initialPlatformId = savedPlatformId || legacyEpicPseudo || preferredFromDiscord?.id || '';
    setForm({
      displayName: (data.displayName as string) ?? firebaseUser.displayName ?? '',
      avatarUrl: (data.avatarUrl as string) ?? '',
      bio: (data.bio as string) ?? '',
      country: (data.country as string) ?? '',
      dateOfBirth: (data.dateOfBirth as string) ?? '',
      games: (data.games as string[]) ?? [],
      rlPlatform: initialPlatform,
      rlPlatformId: initialPlatformId,
      rlRank: (data.rlRank as string) ?? '',
      pseudoTM: (data.pseudoTM as string) ?? '',
      valorantRank: (data.valorantRank as string) ?? '',
      loginTM: (data.loginTM as string) ?? '',
      tmIoUrl: (data.tmIoUrl as string) ?? '',
      isAvailableForRecruitment: (data.isAvailableForRecruitment as boolean) ?? false,
      recruitmentRole: (data.recruitmentRole as string) ?? '',
      recruitmentMessage: (data.recruitmentMessage as string) ?? '',
      dmAnnouncementsOptOut: (data.dmAnnouncementsOptOut as boolean) ?? false,
      connections: (data.discordConnections as DiscordConnection[] | undefined) ?? [],
    });
    setLoaded(true);
  }, [profileQ.isPending, profileQ.data, firebaseUser, loaded]);

  // ── Sync PERMANENT des comptes RL "officiels" et de la connexion Steam OpenID ──
  // À chaque update de profileQ.data (refetch au focus de l'onglet, après
  // confirmation Epic, après callback Steam OpenID…), on resynchronise ces 3
  // états READ-ONLY côté serveur. Sans ce useEffect, le sélecteur de rang RL
  // restait disabled tant que l'user ne faisait pas un refresh complet, alors
  // qu'il venait de vérifier son compte. Cause du bug : l'autre useEffect est
  // verrouillé par `loaded` pour ne pas écraser les édits user du form.
  useEffect(() => {
    if (profileQ.isPending || !profileQ.data) return;
    const data = profileQ.data as Record<string, unknown>;

    const steamLinkedData = (data.steamLinked as SteamLinked | undefined) ?? null;
    setSteamLinked(steamLinkedData);

    const rlEpicId = (data.rlEpicId as string) || '';
    setEpicLinked(rlEpicId ? { rlEpicId, rlEpicName: (data.rlEpicName as string) || '' } : null);

    const rlSteamId = (data.rlSteamId as string) || '';
    setRlSteamLinked(rlSteamId ? { rlSteamId, rlSteamName: (data.rlSteamName as string) || '' } : null);

    // Compte Riot Valorant verrouillé (PUUID + RiotID résolu au sync).
    const valorantPuuid = (data.valorantPuuid as string) || '';
    const vName = (data.valorantRiotName as string) || '';
    const vTag = (data.valorantRiotTag as string) || '';
    setValorantLinked(valorantPuuid
      ? { puuid: valorantPuuid, riotId: vName && vTag ? `${vName}#${vTag}` : '' }
      : null);

    // Merge intelligent de form.connections :
    //   - Pour les nouvelles connexions Discord ajoutées hors site (Epic Games
    //     via Discord), on les ajoute pour qu'elles soient détectées comme
    //     vérifiées (déclenche le bouton "Confirme ton compte Epic").
    //   - Pour les connexions déjà présentes localement, on PRÉSERVE le toggle
    //     `visibleOnProfile` éventuellement modifié par l'user sans avoir
    //     sauvegardé, sinon on écraserait son édit en cours.
    const freshConnections = (data.discordConnections as DiscordConnection[] | undefined) ?? [];
    setForm(prev => {
      const localByKey = new Map(prev.connections.map(c => [`${c.type}:${c.id}`, c]));
      const merged = freshConnections.map(c => {
        const local = localByKey.get(`${c.type}:${c.id}`);
        return local ? { ...c, visibleOnProfile: local.visibleOnProfile } : c;
      });
      return { ...prev, connections: merged };
    });
  }, [profileQ.isPending, profileQ.data]);

  // ── Auto-save 2s après dernière modif ──
  // IMPORTANT : placé AVANT les early returns ci-dessous pour respecter la
  // règle des hooks (même nombre de hooks à chaque render). handleSave() est
  // une function declaration donc hoisted dans le scope du composant →
  // accessible dans ce closure.
  // handleSave est recréée à chaque render : la déclarer en dépendance
  // relancerait le timer 2s à chaque render (l'auto-save ne partirait jamais).
  // On la lit donc via une ref tenue à jour (cf. components/ui/ModalBackdrop),
  // ce qui rend les deps ci-dessous honnêtes.
  const handleSaveRef = useRef(handleSave);
  useEffect(() => { handleSaveRef.current = handleSave; });
  // Conditions pour auto-save :
  // - loaded : on n'essaie pas de save avant que le profil soit chargé
  // - dirty : il y a des modifs non sauvées
  // - !saving : pas déjà en cours
  // - validateForm(form) === null : pas d'erreur de validation (sinon on attend
  //   que l'user corrige ou clique manuellement sur Save pour voir l'erreur)
  useEffect(() => {
    if (!loaded || !dirty || saving) return;
    if (validateForm(form) !== null) return;
    const t = setTimeout(() => { handleSaveRef.current(); }, 2000);
    return () => clearTimeout(t);
  }, [loaded, dirty, form, saving]);

  if (!authLoading && !firebaseUser) {
    return (
      <div className="min-h-screen px-4 sm:px-6 lg:px-8 py-6 lg:py-8 flex items-center justify-center">
        <div className="panel p-10 text-center max-w-md">
          <AlertCircle size={32} className="mx-auto mb-4" style={{ color: 'var(--s-text-muted)' }} />
          <h2 className="font-display text-2xl mb-2">CONNEXION REQUISE</h2>
          <p className="t-body">Connecte-toi via Discord pour accéder à tes paramètres.</p>
        </div>
      </div>
    );
  }

  if (!loaded) {
    return (
      <div className="min-h-screen px-4 sm:px-6 lg:px-8 py-6 lg:py-8 flex items-center justify-center">
        <Loader2 size={24} className="animate-spin" style={{ color: 'var(--s-text-dim)' }} />
      </div>
    );
  }

  function toggleGame(game: string) {
    setForm(prev => ({
      ...prev,
      games: prev.games.includes(game)
        ? prev.games.filter(g => g !== game)
        : [...prev.games, game],
    }));
    setDirty(true);
    if (saved) setSaved(false);
  }

  async function handleSave() {
    const err = validateForm(form);
    if (err) {
      setError(err);
      return;
    }

    setError('');
    setSaving(true);
    setSaved(false);

    try {
      // On envoie tout le form + la map de visibilité des connexions Discord.
      // Le serveur applique connectionVisibility sur les connexions stockées
      // (sans permettre de modifier les autres champs des connexions).
      const connectionVisibility = form.connections.map(c => ({
        type: c.type,
        visible: c.visibleOnProfile ?? false,
      }));
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { connections: _connections, ...rest } = form;
      // Snapshot pré-save pour détecter la transition recrutement off → on
      // (= signal "user vient d'ouvrir son recrutement", high-value pour analytics).
      // On track UNIQUEMENT la transition, pas chaque sauvegarde où c'est ON.
      const wasRecruiting = !!user?.isAvailableForRecruitment;
      const willRecruit = !!form.isAvailableForRecruitment;
      await api('/api/profile', { method: 'POST', body: { ...rest, connectionVisibility } });
      if (!wasRecruiting && willRecruit) {
        track('recruitment_opened', { role: form.recruitmentRole ?? '' });
      }
      setSaved(true);
      setDirty(false);
      toast.success('Profil sauvegardé');
      // Rafraîchir le state global AuthContext pour que ProfileCompletionGate
      // voie le profil complété et n'essaie plus de rediriger vers /settings.
      await refreshProfile();
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message || 'Erreur lors de la sauvegarde.');
      } else {
        console.error('[Settings] save error:', err);
        setError('Erreur réseau. Réessaie.');
      }
    }

    setSaving(false);
  }

  // Auto-save : voir useEffect en haut du composant (avant les early returns
  // pour respecter la règle des hooks, react n'autorise pas un nombre de
  // hooks variable entre les renders).

  const avatarSrc = form.avatarUrl || user?.discordAvatar || '';

  return (
    <div className="min-h-screen hex-bg px-4 sm:px-6 lg:px-8 py-6 lg:py-8">
      <div className="relative z-[1] space-y-6">

        <Breadcrumbs items={[{ label: 'Mon profil' }]} />

        {mustComplete && !completion.complete && (
          <div
            className="bevel-sm animate-fade-in"
            style={{
              background: 'linear-gradient(135deg, rgba(255,184,0,0.12), rgba(255,184,0,0.04))',
              border: '1px solid rgba(255,184,0,0.35)',
              padding: '14px 18px',
            }}
          >
            <div className="flex items-start gap-3">
              <AlertCircle size={18} style={{ color: 'var(--s-gold)', flexShrink: 0, marginTop: 2 }} />
              <div className="text-sm" style={{ color: 'var(--s-text)' }}>
                <div className="font-semibold mb-1" style={{ color: 'var(--s-gold)' }}>
                  Complète ton profil pour accéder au Hub
                </div>
                <div style={{ color: 'var(--s-text-dim)' }}>
                  Champs manquants : {completion.missing.join(', ')}.
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Sticky top bar */}
        <div
          className="sticky top-4 z-40 bevel-sm animate-fade-in"
          style={{
            background: 'var(--s-surface)',
            border: '1px solid var(--s-border)',
            boxShadow: '0 12px 28px rgba(0,0,0,0.35)',
          }}
        >
          <div className="h-[3px]" style={{ background: 'linear-gradient(90deg, var(--s-gold), rgba(255,184,0,0.3), transparent 70%)' }} />
          <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4 px-4 sm:px-5 py-3">
            <div className="flex items-center gap-3 sm:gap-4 flex-1 min-w-0">
              <div className="w-10 h-10 relative overflow-hidden bevel-sm flex-shrink-0"
                style={{ background: 'var(--s-elevated)', border: '1px solid rgba(255,184,0,0.2)' }}>
                {avatarSrc ? (
                  <Image src={avatarSrc} alt="Avatar" fill className="object-cover" unoptimized />
                ) : (
                  <div className="w-full h-full flex items-center justify-center">
                    <User size={18} style={{ color: 'var(--s-text-muted)' }} />
                  </div>
                )}
              </div>
              <div className="flex-1 min-w-0">
                <h1 className="font-display text-xl truncate" style={{ letterSpacing: '0.04em' }}>
                  {form.displayName || 'MON PROFIL'}
                </h1>
                <p className="text-xs truncate" style={{ color: 'var(--s-text-dim)' }}>
                  {dirty ? (
                    <span style={{ color: 'var(--s-gold)' }}>• Modifications non sauvegardées</span>
                  ) : saved ? (
                    <span style={{ color: '#00D936' }}>✓ Profil sauvegardé</span>
                  ) : (
                    'Paramètres du compte Aedral'
                  )}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 sm:gap-3">
              <button
                type="button"
                onClick={() => router.push(`/profile/${firebaseUser?.uid}`)}
                className="btn-springs btn-secondary bevel-sm hidden md:inline-flex"
                style={{ padding: '8px 14px', fontSize: '12px' }}
              >
                Voir mon profil <ExternalLink size={12} />
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={saving || !dirty}
                className="btn-springs btn-primary bevel-sm flex-1 sm:flex-none justify-center"
                style={{
                  padding: '8px 16px',
                  fontSize: '12px',
                  opacity: !dirty && !saving ? 0.5 : 1,
                  cursor: !dirty && !saving ? 'default' : 'pointer',
                }}
              >
                {saving ? (
                  <><Loader2 size={13} className="animate-spin" /> Sauvegarde…</>
                ) : (
                  <><Save size={13} /> Sauvegarder</>
                )}
              </button>
            </div>
          </div>
          {error && (
            <div
              className="px-5 py-2 flex items-start gap-2"
              style={{ background: 'rgba(239,68,68,0.08)', borderTop: '1px solid rgba(239,68,68,0.25)' }}
            >
              <AlertCircle size={14} className="flex-shrink-0 mt-0.5" style={{ color: '#ef4444' }} />
              <p className="text-xs" style={{ color: '#ef4444' }}>{error}</p>
            </div>
          )}
        </div>

        {/* 2-col layout : sous-nav gauche + contenu droite */}
        <div className="grid grid-cols-1 lg:grid-cols-[220px_1fr] gap-6 animate-fade-in-d1">

          {/* Sous-nav mobile, onglets repliables (flex-wrap, zéro scroll horizontal) */}
          <div
            className="lg:hidden bevel-sm"
            style={{ background: 'var(--s-surface)', border: '1px solid var(--s-border)' }}
          >
            <div className="p-2 flex flex-wrap gap-1.5">
              {SECTIONS.map(({ key, label, icon: Icon }) => {
                const active = section === key;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setSection(key)}
                    className="flex items-center gap-2 px-3 py-2 transition-colors duration-150"
                    style={{
                      background: active ? 'rgba(255,184,0,0.12)' : 'var(--s-elevated)',
                      border: `1px solid ${active ? 'rgba(255,184,0,0.3)' : 'var(--s-border)'}`,
                      color: active ? 'var(--s-text)' : 'var(--s-text-dim)',
                      cursor: 'pointer',
                    }}
                  >
                    <Icon size={14} className="flex-shrink-0" style={{ color: active ? 'var(--s-gold)' : 'var(--s-text-muted)' }} />
                    <span className="text-sm font-semibold">{label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* ─── SOUS-NAV LATÉRALE (desktop) ─────────────────────────── */}
          <aside className="hidden lg:block">
            <div
              className="bevel-sm sticky top-[120px]"
              style={{ background: 'var(--s-surface)', border: '1px solid var(--s-border)' }}
            >
              <div className="p-2">
                <div className="px-3 py-2">
                  <span className="t-label">Sections</span>
                </div>
                {SECTIONS.map(({ key, label, icon: Icon, description }) => {
                  const active = section === key;
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setSection(key)}
                      className="w-full flex items-start gap-2.5 px-3 py-2.5 text-left transition-all duration-150 relative"
                      style={{
                        background: active ? 'rgba(255,184,0,0.12)' : 'transparent',
                        color: active ? 'var(--s-text)' : 'var(--s-text-dim)',
                        borderLeft: active ? '3px solid var(--s-gold)' : '3px solid transparent',
                        cursor: 'pointer',
                      }}
                      onMouseEnter={(e) => {
                        if (!active) e.currentTarget.style.background = 'var(--s-elevated)';
                      }}
                      onMouseLeave={(e) => {
                        if (!active) e.currentTarget.style.background = 'transparent';
                      }}
                    >
                      <Icon
                        size={15}
                        className="flex-shrink-0 mt-0.5"
                        style={{ color: active ? 'var(--s-gold)' : 'var(--s-text-muted)' }}
                      />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold">{label}</p>
                        <p className="text-xs mt-0.5" style={{ color: 'var(--s-text-muted)' }}>
                          {description}
                        </p>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          </aside>

          {/* ─── CONTENU SECTION ACTIVE ────────────────────────────── */}
          <div className="space-y-6 min-w-0">

            {/* CARTE DE PARTAGE — customisation OG (rangs, struct, équipe) */}
            {section === 'sharing' && user && (
              <SharingSection user={user} onSaved={refreshProfile} />
            )}

            {/* PROFIL — panel nu (audit 12/06) : formulaire statique, pas de
                hover-lift ni chrome décoratif ; l'astérisque dit déjà « obligatoire ». */}
            {section === 'profile' && (
              <div className="panel relative animate-fade-in">
                <div className="relative z-[1]">
                  <div className="panel-header">
                    <div className="flex items-center gap-2">
                      <User size={13} style={{ color: 'var(--s-gold)' }} />
                      <span className="t-label" style={{ color: 'var(--s-text)' }}>IDENTITÉ</span>
                    </div>
                  </div>
                  <div className="p-5 space-y-5">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                      <div>
                        <label className="t-label block mb-2">Pseudo affiché *</label>
                        <input type="text" value={form.displayName}
                          onChange={e => updateForm({ displayName: e.target.value })}
                          className="settings-input w-full" placeholder="Ton pseudo Aedral" maxLength={32} />
                      </div>
                      <ImageUploader
                        label="Avatar"
                        hint="Carré, max 2 MB. Vide = photo Discord."
                        aspect="square"
                        maxBytes={UPLOAD_LIMITS.USER_AVATAR_BYTES}
                        currentUrl={form.avatarUrl || null}
                        endpoint="/api/upload/user-avatar"
                        onUploaded={(url) => updateForm({ avatarUrl: url })}
                      />
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                      <div>
                        <label className="t-label block mb-2">Pays *</label>
                        <select value={form.country}
                          onChange={e => updateForm({ country: e.target.value })}
                          className="settings-input w-full">
                          <option value="">Sélectionner...</option>
                          {countries.map(c => (
                            <option key={c.code} value={c.code}>{c.flag} {c.name}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="t-label block mb-2">Date de naissance *</label>
                        <input type="date" value={form.dateOfBirth}
                          onChange={e => updateForm({ dateOfBirth: e.target.value })}
                          className="settings-input w-full" max={new Date().toISOString().split('T')[0]} />
                        <p className="text-xs mt-1" style={{ color: 'var(--s-text-muted)' }}>Seul ton âge sera visible</p>
                      </div>
                    </div>

                    <MarkdownEditor
                      label="Bio (optionnel)"
                      value={form.bio}
                      onChange={v => updateForm({ bio: v })}
                      placeholder="Quelques mots sur toi..."
                      maxLength={300}
                      rows={3}
                      taRef={bioRef}
                    />
                  </div>
                </div>
              </div>
            )}

            {/* JEUX — panel nu, la validation dit déjà « min. 1 » si besoin */}
            {section === 'games' && (
              <div className="panel relative overflow-hidden animate-fade-in">
                <div className="relative z-[1]">
                  <div className="panel-header">
                    <div className="flex items-center gap-2">
                      <Gamepad2 size={13} style={{ color: 'var(--s-text-dim)' }} />
                      <span className="t-label" style={{ color: 'var(--s-text)' }}>JEUX PRATIQUÉS</span>
                    </div>
                  </div>
                  <div className="p-5 space-y-4">
                    {/* Pickers générés depuis la registry, ajouter un jeu dans
                        lib/games-registry.ts fera apparaître son picker automatiquement. */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      {ALL_GAME_DEFS.map(g => {
                        const active = form.games.includes(g.id);
                        return (
                          <button
                            key={g.id}
                            type="button"
                            onClick={() => toggleGame(g.id)}
                            className="p-4 text-left transition-all duration-150 relative overflow-hidden"
                            style={{
                              background: active ? `rgba(${g.colorRgb}, 0.08)` : 'var(--s-elevated)',
                              border: active ? `2px solid rgba(${g.colorRgb}, 0.4)` : '2px solid var(--s-border)',
                              cursor: 'pointer',
                            }}
                          >
                            <div className="relative z-[1] flex items-center gap-3">
                              <Gamepad2 size={14} className="flex-shrink-0" style={{ color: g.color }} />
                              <span
                                className="text-sm font-semibold"
                                style={{ color: active ? g.colorLight : 'var(--s-text)' }}
                              >
                                {g.label}
                              </span>
                              {active && <CheckCircle size={14} className="ml-auto" style={{ color: g.color }} />}
                            </div>
                          </button>
                        );
                      })}
                    </div>

                    {form.games.includes('rocket_league') && (() => {
                      const platformMeta = form.rlPlatform ? getRLPlatformMeta(form.rlPlatform) : null;
                      const trackerPreview = form.rlPlatform && form.rlPlatformId.trim()
                        ? buildTrackerGgUrl(form.rlPlatform, form.rlPlatformId)
                        : '';
                      const ballchasingPreview = form.rlPlatform && form.rlPlatformId.trim()
                        ? buildBallchasingUrl(form.rlPlatform, form.rlPlatformId)
                        : '';
                      // Compte RL officiel vérifié (Epic prime, sinon Steam). C'est l'ancre
                      // anti-mensonge : tant qu'il existe, on n'affiche QUE le badge + le rang,
                      // tout le flow de liaison se masque (« un seul état visible à la fois »).
                      const epicConn = (form.connections ?? []).find(c => c.type === 'epicgames' && c.verified);
                      const epicMissingFromDiscord = !!epicLinked && (!epicConn || epicConn.id !== epicLinked.rlEpicId);
                      const verified = epicLinked
                        ? { kind: 'epic' as const, name: epicLinked.rlEpicName || `${epicLinked.rlEpicId.slice(0, 10)}…` }
                        : rlSteamLinked
                        ? { kind: 'steam' as const, name: rlSteamLinked.rlSteamName || rlSteamLinked.rlSteamId }
                        : null;
                      const hasLink = !!verified;
                      const requestingVerifiedChange = verified?.kind === 'epic' ? requestingChange : requestingSteamChange;
                      return (
                        <div className="p-4 space-y-4 relative overflow-hidden" style={{ background: 'rgba(0,129,255,0.04)', border: '1px solid rgba(0,129,255,0.15)' }}>
                          <div className="flex items-center gap-2">
                            <span className="tag tag-blue" style={{ fontSize: '12px' }}>RL</span>
                            <span className="t-label" style={{ color: 'var(--s-blue)' }}>Config Rocket League</span>
                          </div>

                          {/* ── ÉTAT VÉRIFIÉ : un seul bloc compact (badge + tracker + disclosure changement) ── */}
                          {hasLink && verified && (
                            <div className="flex items-start gap-3 p-3" style={{ background: 'rgba(255,184,0,0.06)', border: '1px solid rgba(255,184,0,0.25)' }}>
                              <CheckCircle size={16} className="flex-shrink-0 mt-0.5" style={{ color: 'var(--s-gold)' }} />
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className="text-sm font-semibold" style={{ color: 'var(--s-text)' }}>{verified.name}</span>
                                  <span className="text-xs" style={{ color: 'var(--s-text-muted)' }}>
                                    {verified.kind === 'epic' ? 'Epic' : 'Steam'} vérifié
                                  </span>
                                  {trackerPreview && (
                                    <a href={trackerPreview} target="_blank" rel="noopener noreferrer"
                                      className="text-xs inline-flex items-center gap-1 hover:underline" style={{ color: 'var(--s-blue)' }}>
                                      <ExternalLink size={11} /> tracker.gg
                                    </a>
                                  )}
                                </div>
                                {epicMissingFromDiscord && (
                                  <p className="text-xs mt-1.5" style={{ color: '#ff8a8a' }}>
                                    On ne retrouve plus ce compte Epic sur ton Discord. Relie-le (Paramètres Discord → Connexions → Epic Games) pour rafraîchir ton pseudo.
                                  </p>
                                )}
                                <details className="group/rlchg mt-2">
                                  <summary className="cursor-pointer list-none [&::-webkit-details-marker]:hidden text-xs inline-flex items-center gap-1" style={{ color: 'var(--s-text-muted)' }}>
                                    <ChevronRight size={12} aria-hidden="true" className="transition-transform group-open/rlchg:rotate-90" /> Changer de compte ?
                                  </summary>
                                  <div className="mt-2 space-y-2">
                                    <p className="text-xs" style={{ color: 'var(--s-text-muted)' }}>
                                      {verified.kind === 'epic'
                                        ? 'Mets à jour ta connexion Epic sur Discord, reconnecte-toi à Aedral, puis fais une demande à valider par un admin.'
                                        : 'Re-lie ton compte Steam vers le bon profil, puis fais une demande à valider par un admin.'}
                                    </p>
                                    <button type="button"
                                      onClick={verified.kind === 'epic' ? handleRequestEpicChange : handleRequestSteamChange}
                                      disabled={requestingVerifiedChange}
                                      className="btn-springs btn-secondary bevel-sm inline-flex items-center gap-2 disabled:opacity-50"
                                      style={{ fontSize: '12px', padding: '6px 12px' }}>
                                      {requestingVerifiedChange ? <Loader2 size={11} className="animate-spin" /> : null}
                                      Demander un changement
                                    </button>
                                  </div>
                                </details>
                              </div>
                            </div>
                          )}

                          {/* ── ÉTAT NON VÉRIFIÉ : sélecteur plateforme → 1 CTA contextuel en dessous ── */}
                          {!hasLink && (
                            <div className="p-3" style={{ background: 'var(--s-elevated)', border: '1px solid var(--s-border)' }}>
                              <label className="t-label block mb-2" style={{ color: 'var(--s-text)' }}>
                                Sur quelle plateforme joues-tu à Rocket League ?
                              </label>
                              <select
                                value={form.rlPlatform}
                                onChange={e => updateForm({ rlPlatform: (e.target.value as RLPlatform | '') })}
                                className="settings-input w-full"
                              >
                                <option value="">Choisis ta plateforme</option>
                                {RL_PLATFORMS.map(p => (
                                  <option key={p.value} value={p.value}>{p.label}</option>
                                ))}
                              </select>
                              {!form.rlPlatform && (
                                <p className="text-xs mt-1.5" style={{ color: 'var(--s-text-muted)' }}>
                                  Le rang n&apos;est affichable qu&apos;après liaison d&apos;un compte vérifié.
                                </p>
                              )}
                            </div>
                          )}

                          {/* ── Liaison Epic (anti-mensonge) : confirmation via la connexion Discord vérifiée ── */}
                          {!hasLink && form.rlPlatform === 'epic' && (
                            epicConn ? (
                              <div className="p-3 space-y-2" style={{ background: 'rgba(255,184,0,0.04)', border: '1px solid rgba(255,184,0,0.2)' }}>
                                <p className="text-sm font-semibold" style={{ color: 'var(--s-text)' }}>Confirme ton compte Rocket League</p>
                                <p className="text-xs" style={{ color: 'var(--s-text-dim)' }}>
                                  Compte Epic vu sur ton Discord : <span className="font-semibold" style={{ color: 'var(--s-text)' }}>{epicConn.name}</span>. Une fois lié, il est figé (changement futur = demande admin).
                                </p>
                                <button type="button"
                                  onClick={handleConfirmEpicLink}
                                  disabled={confirmingEpic}
                                  className="btn-springs btn-primary bevel-sm inline-flex items-center gap-2 disabled:opacity-50"
                                  style={{ fontSize: '12px', padding: '8px 14px' }}>
                                  {confirmingEpic ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle size={12} />}
                                  Oui, c&apos;est mon compte principal
                                </button>
                                <details className="group/rlepic">
                                  <summary className="cursor-pointer list-none [&::-webkit-details-marker]:hidden text-xs inline-flex items-center gap-1" style={{ color: 'var(--s-text-muted)' }}>
                                    <ChevronRight size={12} aria-hidden="true" className="transition-transform group-open/rlepic:rotate-90" /> Ce n&apos;est pas mon compte ?
                                  </summary>
                                  <p className="text-xs mt-2" style={{ color: 'var(--s-text-muted)' }}>
                                    Sur Discord → Paramètres → Connexions → retire cette connexion Epic, ajoute la bonne, puis reconnecte-toi à Aedral.
                                  </p>
                                </details>
                              </div>
                            ) : (
                              <div className="p-3" style={{ background: 'rgba(0,0,0,0.2)', border: '1px solid var(--s-border)' }}>
                                <p className="text-sm font-semibold" style={{ color: 'var(--s-text)' }}>Lie ton compte Epic</p>
                                <p className="text-xs mt-1" style={{ color: 'var(--s-text-dim)' }}>
                                  Ajoute Epic Games dans tes connexions Discord (Paramètres → Connexions), puis reconnecte-toi à Aedral : on pourra le confirmer ici.
                                </p>
                                <p className="text-xs mt-1.5" style={{ color: 'var(--s-text-muted)' }}>
                                  Tu joues sur une autre plateforme ? Change ta sélection ci-dessus.
                                </p>
                              </div>
                            )
                          )}

                          {/* ── Liaison Steam (OpenID) — uniquement si plateforme Steam ── */}
                          {!hasLink && form.rlPlatform === 'steam' && (
                            steamLinked ? (
                              <div className="p-3 flex items-center gap-3" style={{ background: 'rgba(34, 173, 67, 0.06)', border: '1px solid rgba(34, 173, 67, 0.25)' }}>
                                {steamLinked.avatarUrl ? (
                                  <Image src={steamLinked.avatarUrl} alt="Avatar Steam" width={40} height={40} className="flex-shrink-0" unoptimized />
                                ) : (
                                  <div className="w-10 h-10 flex-shrink-0 flex items-center justify-center font-display" style={{ background: 'rgba(34,173,67,0.15)', color: 'var(--s-green)', fontSize: 16 }}>S</div>
                                )}
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2">
                                    <CheckCircle size={12} style={{ color: 'var(--s-green)' }} />
                                    <span className="text-sm font-semibold" style={{ color: 'var(--s-text)' }}>Steam lié</span>
                                  </div>
                                  <div className="text-xs truncate" style={{ color: 'var(--s-text-dim)' }}>
                                    {steamLinked.personaName ? `${steamLinked.personaName} · ` : ''}
                                    <span className="t-mono">{steamLinked.steamId64}</span>
                                  </div>
                                </div>
                                <button type="button" onClick={handleUnlinkSteam} disabled={linkingSteam} className="btn-springs btn-secondary bevel-sm text-xs disabled:opacity-50">Délier</button>
                              </div>
                            ) : (
                              <div className="p-4 flex items-center justify-between gap-3 flex-wrap" style={{ background: 'rgba(27, 40, 56, 0.4)', border: '1px solid rgba(102, 192, 244, 0.25)' }}>
                                <div className="flex-1 min-w-[200px]">
                                  <p className="text-sm font-semibold" style={{ color: 'var(--s-text)' }}>Lier ton compte Steam</p>
                                  <p className="text-xs mt-1" style={{ color: 'var(--s-text-dim)' }}>
                                    Récupère ton SteamID64 permanent : le lien tracker.gg ne casse jamais, même si tu changes de pseudo.
                                  </p>
                                </div>
                                <button type="button" onClick={handleLinkSteam} disabled={linkingSteam} className="btn-springs btn-primary bevel-sm inline-flex items-center gap-2 flex-shrink-0 disabled:opacity-50">
                                  {linkingSteam ? (<><Loader2 size={12} className="animate-spin" /> En cours…</>) : (<><ExternalLink size={12} /> Lier mon Steam</>)}
                                </button>
                              </div>
                            )
                          )}

                          {/* ── Confirme que le Steam lié est bien le compte RL ──
                              N'apparaît qu'après liaison Steam, plateforme Steam, sans compte
                              vérifié. Une fois confirmé, hasLink passe true → on bascule sur le
                              badge compact ci-dessus. */}
                          {!hasLink && form.rlPlatform === 'steam' && steamLinked && (
                            <div className="p-3 space-y-2" style={{ background: 'rgba(255,184,0,0.04)', border: '1px solid rgba(255,184,0,0.2)' }}>
                              <p className="text-sm font-semibold" style={{ color: 'var(--s-text)' }}>Confirme que c&apos;est ton compte Rocket League</p>
                              <p className="text-xs" style={{ color: 'var(--s-text-dim)' }}>
                                <span className="font-semibold" style={{ color: 'var(--s-text)' }}>{steamLinked.personaName || steamLinked.steamId64}</span> — c&apos;est bien le compte sur lequel tu joues à RL ? Une fois confirmé, il est figé (changement futur = demande admin).
                              </p>
                              <button type="button"
                                onClick={handleConfirmSteamLink}
                                disabled={confirmingSteam}
                                className="btn-springs btn-primary bevel-sm inline-flex items-center gap-2 disabled:opacity-50"
                                style={{ fontSize: '12px', padding: '8px 14px' }}>
                                {confirmingSteam ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle size={12} />}
                                Oui, mon RL est sur Steam
                              </button>
                            </div>
                          )}

                          {/* ── Saisie ID / pseudo : plateformes sans vérification (PSN, Xbox, Switch…) ──
                              Epic & Steam passent par la liaison vérifiée ci-dessus, pas de
                              saisie libre (un ID tapé à la main ne prouve rien). */}
                          {!hasLink && form.rlPlatform && form.rlPlatform !== 'epic' && form.rlPlatform !== 'steam' && (
                            <div>
                              <label className="t-label block mb-2">
                                {platformMeta?.idLabel ?? 'ID sur la plateforme'} *
                              </label>
                              <input
                                type="text"
                                value={form.rlPlatformId}
                                onChange={e => updateForm({ rlPlatformId: e.target.value })}
                                className="settings-input w-full"
                                placeholder={platformMeta?.idPlaceholder ?? ''}
                              />
                              {platformMeta && (
                                <p className="text-xs mt-1.5" style={{ color: 'var(--s-text-muted)' }}>
                                  {platformMeta.idHelp}
                                </p>
                              )}
                            </div>
                          )}
                          {/* Liens auto-générés depuis la saisie manuelle (plateformes non
                              vérifiables). En compte vérifié, le lien tracker vit dans le badge. */}
                          {!hasLink && (trackerPreview || ballchasingPreview) && (
                            <div
                              className="p-3 space-y-2"
                              style={{
                                background: 'rgba(0,129,255,0.05)',
                                border: '1px solid rgba(0,129,255,0.15)',
                              }}
                            >
                              <p className="t-label" style={{ color: 'var(--s-text-muted)' }}>
                                Liens auto-générés sur ton profil public
                              </p>
                              {trackerPreview && (
                                <div className="flex items-center gap-2 text-xs">
                                  <span style={{ color: 'var(--s-text-dim)', minWidth: 90 }}>tracker.gg →</span>
                                  <a href={trackerPreview} target="_blank" rel="noopener noreferrer"
                                    className="truncate hover:underline" style={{ color: 'var(--s-blue)' }}>
                                    {trackerPreview}
                                  </a>
                                </div>
                              )}
                              {ballchasingPreview && (
                                <div className="flex items-center gap-2 text-xs">
                                  <span style={{ color: 'var(--s-text-dim)', minWidth: 90 }}>Ballchasing →</span>
                                  <a href={ballchasingPreview} target="_blank" rel="noopener noreferrer"
                                    className="truncate hover:underline" style={{ color: 'var(--s-blue)' }}>
                                    {ballchasingPreview}
                                  </a>
                                </div>
                              )}
                            </div>
                          )}
                          {/* ── Rang RL, gateé sur la présence d'un compte vérifié ── */}
                          <div>
                            <label className="t-label block mb-2">Rang RL (auto-déclaré)</label>
                            <select value={form.rlRank}
                              onChange={e => updateForm({ rlRank: e.target.value })}
                              disabled={!hasLink}
                              className="settings-input w-full disabled:opacity-50 disabled:cursor-not-allowed">
                              <option value="">Non renseigné</option>
                              {RL_RANKS.map(r => (
                                <option key={r} value={r}>{r}</option>
                              ))}
                            </select>
                            {hasLink ? (
                              <p className="text-xs mt-1.5" style={{ color: 'var(--s-text-muted)' }}>
                                Le modifier rend ton rang à nouveau signalable.
                              </p>
                            ) : (
                              <p className="text-xs mt-1.5" style={{ color: '#ff8a8a' }}>
                                Lie d&apos;abord ton compte Rocket League ci-dessus pour qu&apos;un rang soit affichable.
                              </p>
                            )}
                          </div>
                        </div>
                      );
                    })()}

                    {form.games.includes('trackmania') && (
                      <div className="p-4 space-y-4 relative overflow-hidden" style={{ background: 'rgba(0,217,54,0.04)', border: '1px solid rgba(0,217,54,0.15)' }}>
                        <div className="flex items-center gap-2">
                          <span className="tag tag-green" style={{ fontSize: '12px' }}>TM</span>
                          <span className="t-label" style={{ color: 'var(--s-green)' }}>Config Trackmania</span>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                          <div>
                            <label className="t-label block mb-2">Pseudo Ubisoft/Nadeo *</label>
                            <input type="text" value={form.pseudoTM}
                              onChange={e => updateForm({ pseudoTM: e.target.value })}
                              className="settings-input w-full" placeholder="Ton pseudo en jeu" />
                          </div>
                          <div>
                            <label className="t-label block mb-2">Login TM (optionnel)</label>
                            <input type="text" value={form.loginTM}
                              onChange={e => updateForm({ loginTM: e.target.value })}
                              className="settings-input w-full" placeholder="Identifiant Ubisoft/Nadeo" />
                          </div>
                        </div>
                        <div>
                          <label className="t-label block mb-2">URL Trackmania.io *</label>
                          <input type="url" value={form.tmIoUrl}
                            onChange={e => updateForm({ tmIoUrl: e.target.value })}
                            className="settings-input w-full" placeholder="https://trackmania.io/#/player/..." />
                        </div>
                        <TrackmaniaSyncBlock hasUrl={!!form.tmIoUrl.trim()} />
                      </div>
                    )}

                    {form.games.includes('valorant') && (
                      <div className="p-4 space-y-4 relative overflow-hidden" style={{ background: 'rgba(255,70,85,0.04)', border: '1px solid rgba(255,70,85,0.15)' }}>
                        <div className="flex items-center gap-2">
                          <span className="tag" style={{ fontSize: '12px', background: 'rgba(255,70,85,0.10)', color: '#FF6B78', borderColor: 'rgba(255,70,85,0.25)' }}>VAL</span>
                          <span className="t-label" style={{ color: '#FF6B78' }}>Config Valorant</span>
                        </div>
                        <ValorantSyncBlock
                          currentRank={form.valorantRank}
                          valorantLinked={valorantLinked}
                        />
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* COMPTES LIÉS, connexions Discord (Twitch, YouTube, Spotify, Epic, Steam, etc.)
                Rendu dans 'profile' (refonte 5→3 sections), comptes liés = info publique */}
            {section === 'profile' && (
              <div className="panel relative animate-fade-in">
                <div className="relative z-[1]">
                  <div className="panel-header">
                    <div className="flex items-center gap-2">
                      <Link2 size={13} style={{ color: 'var(--s-gold)' }} />
                      <span className="t-label" style={{ color: 'var(--s-text)' }}>COMPTES LIÉS VIA DISCORD</span>
                    </div>
                  </div>
                  <div className="p-5 space-y-4">
                    <p className="text-sm" style={{ color: 'var(--s-text-dim)' }}>
                      Synchronisés automatiquement depuis ton Discord à chaque connexion. Active la visibilité de ceux que tu veux afficher sur ton profil public Aedral.
                    </p>

                    {form.connections.length === 0 ? (
                      <div
                        className="p-5 text-center space-y-3"
                        style={{
                          background: 'var(--s-elevated)',
                          border: '1px dashed var(--s-border)',
                        }}
                      >
                        <Link2 size={28} className="mx-auto" style={{ color: 'var(--s-text-muted)' }} />
                        <p className="text-sm font-semibold" style={{ color: 'var(--s-text)' }}>
                          Aucune connexion détectée
                        </p>
                        <p className="text-xs" style={{ color: 'var(--s-text-muted)' }}>
                          Lie tes comptes (Epic, Steam, Twitch, YouTube, Spotify…) dans <strong>Discord → Paramètres → Connexions</strong>, puis re-connecte-toi à Aedral pour les synchroniser.
                        </p>
                        <button
                          type="button"
                          onClick={async () => {
                            await signOut();
                            await signInWithDiscord();
                          }}
                          className="btn-springs btn-secondary bevel-sm inline-flex items-center gap-2 mx-auto"
                        >
                          <RefreshCw size={12} /> Re-connecter à Discord
                        </button>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {form.connections.map(conn => {
                          const meta = getConnectionMeta(conn.type);
                          const url = buildConnectionUrl(conn);
                          const isVisible = conn.visibleOnProfile ?? false;
                          return (
                            <div
                              key={conn.type}
                              className="flex items-center gap-3 p-3"
                              style={{
                                background: isVisible ? 'rgba(255,184,0,0.04)' : 'var(--s-elevated)',
                                border: `1px solid ${isVisible ? 'rgba(255,184,0,0.2)' : 'var(--s-border)'}`,
                              }}
                            >
                              <div
                                className="w-9 h-9 flex-shrink-0 flex items-center justify-center font-display"
                                style={{
                                  background: 'rgba(255,255,255,0.04)',
                                  border: '1px solid var(--s-border)',
                                  color: 'var(--s-text-dim)',
                                  fontSize: 14,
                                }}
                              >
                                {(meta?.label ?? conn.type).charAt(0).toUpperCase()}
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                  <span className="text-sm font-semibold" style={{ color: 'var(--s-text)' }}>
                                    {meta?.label ?? conn.type}
                                  </span>
                                  {conn.verified && (
                                    <CheckCircle size={11} style={{ color: 'var(--s-green)' }} />
                                  )}
                                </div>
                                <div className="flex items-center gap-2 text-xs" style={{ color: 'var(--s-text-dim)' }}>
                                  <span className="truncate">{conn.name}</span>
                                  {url && (
                                    <a
                                      href={url}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      style={{ color: 'var(--s-gold)' }}
                                      className="hover:underline inline-flex items-center gap-1"
                                    >
                                      Voir <ExternalLink size={9} />
                                    </a>
                                  )}
                                </div>
                              </div>
                              <div className="flex items-center gap-2 flex-shrink-0">
                                <span
                                  className="text-xs"
                                  style={{
                                    color: isVisible ? 'var(--s-text)' : 'var(--s-text-muted)',
                                    minWidth: 90,
                                    textAlign: 'right',
                                  }}
                                >
                                  {isVisible ? 'Sur mon profil' : 'Masqué'}
                                </span>
                                <button
                                  type="button"
                                  role="switch"
                                  aria-checked={isVisible}
                                  aria-label={isVisible ? 'Masquer du profil' : 'Afficher sur le profil'}
                                  onClick={() => {
                                    updateForm({
                                      connections: form.connections.map(c =>
                                        c.type === conn.type
                                          ? { ...c, visibleOnProfile: !isVisible }
                                          : c
                                      ),
                                    });
                                  }}
                                  className="relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer items-center transition-colors duration-150"
                                  style={{
                                    background: isVisible ? 'var(--s-gold)' : 'rgba(255,255,255,0.08)',
                                    border: `1px solid ${isVisible ? 'var(--s-gold)' : 'var(--s-border)'}`,
                                    borderRadius: 999,
                                  }}
                                >
                                  <span
                                    className="inline-block h-4 w-4 transform transition-transform duration-150"
                                    style={{
                                      background: '#fff',
                                      borderRadius: '50%',
                                      transform: isVisible ? 'translateX(22px)' : 'translateX(3px)',
                                      boxShadow: '0 1px 3px rgba(0,0,0,0.4)',
                                    }}
                                  />
                                </button>
                              </div>
                            </div>
                          );
                        })}

                        <button
                          type="button"
                          onClick={async () => {
                            await signOut();
                            await signInWithDiscord();
                          }}
                          className="mt-3 inline-flex items-center gap-2 text-xs"
                          style={{ color: 'var(--s-text-muted)' }}
                        >
                          <RefreshCw size={11} /> Re-synchroniser depuis Discord
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* RECRUTEMENT, rendu dans 'profile' (refonte 5→3 sections) */}
            {section === 'profile' && (
              <div className="panel relative animate-fade-in">
                <div className="relative z-[1]">
                  <div className="panel-header">
                    <div className="flex items-center gap-2">
                      <Search size={13} style={{ color: form.isAvailableForRecruitment ? 'var(--s-gold)' : 'var(--s-text-dim)' }} />
                      <span className="t-label" style={{ color: 'var(--s-text)' }}>RECRUTEMENT</span>
                    </div>
                  </div>
                  <div className="p-5 space-y-4">
                    <p className="text-xs" style={{ color: 'var(--s-text-muted)' }}>
                      {isRostered
                        ? 'Tu es titulaire ou remplaçant d\'une équipe — tu n\'es donc pas LFT. Quitte ton équipe pour redevenir disponible.'
                        : 'Tu apparais alors dans le Mercato et peux recevoir des propositions d\'équipes.'}
                    </p>
                    <button type="button"
                      disabled={isRostered}
                      onClick={() => { if (!isRostered) updateForm({ isAvailableForRecruitment: !form.isAvailableForRecruitment }); }}
                      className="w-full p-3.5 flex items-center justify-between transition-all duration-150 disabled:opacity-50"
                      style={{
                        background: form.isAvailableForRecruitment ? 'rgba(255,184,0,0.08)' : 'var(--s-elevated)',
                        border: form.isAvailableForRecruitment ? '1px solid rgba(255,184,0,0.25)' : '1px solid var(--s-border)',
                        cursor: isRostered ? 'not-allowed' : 'pointer',
                      }}>
                      <span className="text-sm font-semibold" style={{ color: form.isAvailableForRecruitment ? 'var(--s-gold)' : 'var(--s-text-dim)' }}>
                        Je suis disponible pour une équipe
                      </span>
                      <div className="w-10 h-[20px] relative" style={{
                        background: form.isAvailableForRecruitment ? 'var(--s-gold)' : 'var(--s-elevated)',
                        border: `1px solid ${form.isAvailableForRecruitment ? 'var(--s-gold)' : 'var(--s-border)'}`,
                      }}>
                        <div className="absolute top-[2px] w-3.5 h-[14px] transition-all duration-200"
                          style={{
                            background: form.isAvailableForRecruitment ? '#000' : 'var(--s-text-muted)',
                            left: form.isAvailableForRecruitment ? '20px' : '2px',
                          }} />
                      </div>
                    </button>

                    {form.isAvailableForRecruitment && (
                      <>
                        <div>
                          <label className="t-label block mb-2">Rôle recherché</label>
                          <div className="flex gap-2 flex-wrap">
                            {['joueur', 'coach', 'manager'].map(role => (
                              <button key={role} type="button"
                                onClick={() => updateForm({ recruitmentRole: role })}
                                className="tag transition-all duration-150"
                                style={{
                                  background: form.recruitmentRole === role ? 'rgba(255,184,0,0.1)' : 'transparent',
                                  color: form.recruitmentRole === role ? 'var(--s-gold)' : 'var(--s-text-dim)',
                                  borderColor: form.recruitmentRole === role ? 'rgba(255,184,0,0.3)' : 'var(--s-border)',
                                  padding: '6px 14px',
                                  fontSize: '12px',
                                  cursor: 'pointer',
                                }}>
                                {role.charAt(0).toUpperCase() + role.slice(1)}
                              </button>
                            ))}
                          </div>
                        </div>

                        <MarkdownEditor
                          label="Message"
                          value={form.recruitmentMessage}
                          onChange={v => updateForm({ recruitmentMessage: v })}
                          placeholder="Dispo le soir, je cherche une équipe RL compétitive..."
                          maxLength={500}
                          rows={4}
                          taRef={recruitRef}
                        />
                      </>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* NOTIFICATIONS, rendu dans 'profile' */}
            {section === 'profile' && (
              <div className="panel relative animate-fade-in">
                <div className="relative z-[1]">
                  <div className="panel-header">
                    <div className="flex items-center gap-2">
                      <Bell size={13} style={{ color: 'var(--s-gold)' }} />
                      <span className="t-label" style={{ color: 'var(--s-text)' }}>NOTIFICATIONS</span>
                    </div>
                  </div>
                  <div className="p-5 space-y-4">
                    <p className="text-xs" style={{ color: 'var(--s-text-muted)' }}>
                      Annonces et relances par DM Discord. Tes DM fonctionnels (exercices, invitations) ne sont jamais concernés.
                    </p>
                    {(() => {
                      const receives = !form.dmAnnouncementsOptOut;
                      return (
                        <button type="button"
                          role="switch"
                          aria-checked={receives}
                          aria-label="Recevoir les annonces et relances par DM"
                          onClick={() => updateForm({ dmAnnouncementsOptOut: receives })}
                          className="w-full p-3.5 flex items-center justify-between transition-all duration-150"
                          style={{
                            background: receives ? 'rgba(255,184,0,0.08)' : 'var(--s-elevated)',
                            border: receives ? '1px solid rgba(255,184,0,0.25)' : '1px solid var(--s-border)',
                            cursor: 'pointer',
                          }}>
                          <span className="text-sm font-semibold" style={{ color: receives ? 'var(--s-gold)' : 'var(--s-text-dim)' }}>
                            Recevoir les annonces et relances par DM
                          </span>
                          <div className="w-10 h-[20px] relative" style={{
                            background: receives ? 'var(--s-gold)' : 'var(--s-elevated)',
                            border: `1px solid ${receives ? 'var(--s-gold)' : 'var(--s-border)'}`,
                          }}>
                            <div className="absolute top-[2px] w-3.5 h-[14px] transition-all duration-200"
                              style={{
                                background: receives ? '#000' : 'var(--s-text-muted)',
                                left: receives ? '20px' : '2px',
                              }} />
                          </div>
                        </button>
                      );
                    })()}
                  </div>
                </div>
              </div>
            )}

            {/* COMPTE */}
            {section === 'account' && (
              <div className="panel relative animate-fade-in">
                <div className="relative z-[1]">
                  <div className="panel-header">
                    <div className="flex items-center gap-2">
                      <UserCircle size={13} style={{ color: 'var(--s-gold)' }} />
                      <span className="t-label" style={{ color: 'var(--s-text)' }}>COMPTE AEDRAL</span>
                    </div>
                    {isAdmin && <span className="tag tag-gold" style={{ fontSize: '12px' }}>ADMIN</span>}
                  </div>
                  <div className="p-5 space-y-5">
                    <div>
                      <label className="t-label block mb-2">Connecté via Discord</label>
                      <div
                        className="flex items-center gap-3 p-3"
                        style={{ background: 'var(--s-elevated)', border: '1px solid var(--s-border)' }}
                      >
                        {user?.discordAvatar && (
                          <Image
                            src={user.discordAvatar}
                            alt={user.displayName}
                            width={40}
                            height={40}
                            className="flex-shrink-0"
                            style={{ border: '1px solid rgba(255,184,0,0.4)' }}
                          />
                        )}
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold" style={{ color: 'var(--s-text)' }}>
                            {user?.discordUsername || user?.displayName || '—'}
                          </p>
                          <p className="text-xs" style={{ color: 'var(--s-text-muted)' }}>
                            ID Discord : {user?.discordId || firebaseUser?.uid?.replace('discord_', '') || '—'}
                          </p>
                        </div>
                      </div>
                      <p className="text-xs mt-2" style={{ color: 'var(--s-text-muted)' }}>
                        Ton compte Aedral est lié à Discord. Pour changer d&apos;identifiant Discord, déconnecte-toi et reconnecte-toi avec un autre compte.
                      </p>
                    </div>

                    <div className="divider" />

                    {/* Synchronisation du serveur Discord communautaire Aedral */}
                    <div>
                      <label className="t-label block mb-2">Serveur Discord Aedral</label>
                      <p className="text-xs mb-2.5" style={{ color: 'var(--s-text-muted)' }}>
                        Si tu as rejoint le serveur communautaire Aedral, ton pseudo y devient
                        « [TAG] Pseudo » et tes rôles (structure, recrutement…) se mettent à jour.
                        C&apos;est fait à chaque connexion, ce bouton force une resynchronisation.
                      </p>
                      <button
                        type="button"
                        onClick={handleDiscordSync}
                        disabled={discordSyncing}
                        className="btn-springs btn-secondary bevel-sm inline-flex items-center gap-2 disabled:opacity-50"
                      >
                        {discordSyncing
                          ? <Loader2 size={12} className="animate-spin" />
                          : <RefreshCw size={12} />}
                        Resynchroniser mon Discord
                      </button>
                      {discordSyncMsg && (
                        <p className="text-xs mt-2" style={{ color: 'var(--s-text-dim)' }}>
                          {discordSyncMsg}
                        </p>
                      )}
                    </div>

                    <div className="divider" />

                    <PublicPreviewFrame
                      href={`/profile/${firebaseUser?.uid}`}
                      helper="Ta carte telle qu'elle apparaît dans l'annuaire des joueurs et les feeds communauté."
                    >
                      <div
                        className="panel bevel-sm relative overflow-hidden"
                        style={{ background: 'var(--s-surface)', border: '1px solid var(--s-border)' }}
                      >
                        {form.isAvailableForRecruitment && (
                          <div
                            className="h-[3px]"
                            style={{ background: 'linear-gradient(90deg, var(--s-green), transparent 80%)' }}
                          />
                        )}
                        <div className="p-4">
                          <div className="flex items-center gap-3 mb-3">
                            <div
                              className="w-12 h-12 relative overflow-hidden flex-shrink-0"
                              style={{ background: 'var(--s-elevated)', border: '1px solid var(--s-border)' }}
                            >
                              {avatarSrc ? (
                                <Image src={avatarSrc} alt="" fill className="object-cover" unoptimized />
                              ) : (
                                <div className="w-full h-full flex items-center justify-center">
                                  <User size={16} style={{ color: 'var(--s-text-muted)' }} />
                                </div>
                              )}
                            </div>
                            <div className="flex-1 min-w-0">
                              <p
                                className="text-sm font-semibold truncate"
                                style={{ color: 'var(--s-text)' }}
                              >
                                {form.displayName || user?.displayName || 'Ton pseudo'}
                              </p>
                              <div className="flex items-center gap-1.5 mt-1">
                                {form.country && (
                                  <Image
                                    src={`https://flagcdn.com/16x12/${form.country.toLowerCase()}.png`}
                                    alt={form.country}
                                    width={14}
                                    height={10}
                                    className="flex-shrink-0"
                                    unoptimized
                                  />
                                )}
                                <div className="flex gap-1">
                                  {(form.games.length ? form.games : ['—']).map((g) =>
                                    g === '—' ? (
                                      <span
                                        key={g}
                                        className="tag tag-neutral"
                                        style={{ fontSize: '12px', padding: '1px 5px' }}
                                      >
                                        Aucun jeu
                                      </span>
                                    ) : (
                                      <GameTag key={g} gameId={g} style={{ padding: '1px 5px' }} />
                                    ),
                                  )}
                                </div>
                              </div>
                            </div>
                          </div>

                          {(form.pseudoTM || form.rlPlatformId) && (
                            <div
                              className="space-y-1.5 pt-3 mt-3"
                              style={{ borderTop: '1px dashed var(--s-border)' }}
                            >
                              {form.rlPlatformId && (
                                <div className="flex items-center gap-2">
                                  <Gamepad2 size={11} style={{ color: 'var(--s-blue)' }} />
                                  <span
                                    className="text-xs truncate"
                                    style={{ color: 'var(--s-text-dim)' }}
                                  >
                                    Profil RL ({form.rlPlatform ? getRLPlatformMeta(form.rlPlatform).label : '?'})
                                  </span>
                                </div>
                              )}
                              {form.pseudoTM && (
                                <div className="flex items-center gap-2">
                                  <Gamepad2 size={11} style={{ color: 'var(--s-green)' }} />
                                  <span
                                    className="text-xs truncate"
                                    style={{ color: 'var(--s-text-dim)' }}
                                  >
                                    {form.pseudoTM}
                                  </span>
                                </div>
                              )}
                            </div>
                          )}

                          {form.isAvailableForRecruitment && (
                            <div
                              className="mt-3 pt-2.5"
                              style={{ borderTop: '1px solid rgba(0,217,54,0.2)' }}
                            >
                              <div className="flex items-center gap-1.5">
                                <Star size={11} style={{ color: '#33ff66', fill: '#33ff66' }} />
                                <span
                                  className="text-xs font-bold"
                                  style={{ color: '#33ff66' }}
                                >
                                  Cherche {RECRUIT_ROLE_LABEL[form.recruitmentRole] || 'équipe'}
                                </span>
                              </div>
                              {form.recruitmentMessage && (
                                <p
                                  className="text-xs mt-1 line-clamp-2"
                                  style={{ color: 'var(--s-text-muted)' }}
                                >
                                  {form.recruitmentMessage}
                                </p>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    </PublicPreviewFrame>

                    <div className="divider" />

                    {/* Vie privée — toggle analytics PostHog (RGPD niveau 3).
                        Le user peut désactiver à tout moment, le choix est
                        persisté en localStorage et respecté au prochain reload. */}
                    <div>
                      <label className="t-label block mb-2">Vie privée</label>
                      <div
                        className="flex items-start gap-3 p-3"
                        style={{ background: 'var(--s-elevated)', border: '1px solid var(--s-border)' }}
                      >
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold mb-1" style={{ color: 'var(--s-text)' }}>
                            Mesure d&apos;usage (PostHog)
                          </p>
                          <p className="text-xs leading-relaxed" style={{ color: 'var(--s-text-muted)' }}>
                            Nous aide à comprendre comment tu utilises Aedral pour l&apos;améliorer.
                            Pas de pub, pas de cookies, hébergé en Europe.{' '}
                            <Link href="/legal/confidentialite" className="hover:underline" style={{ color: 'var(--s-gold)' }}>
                              Détails
                            </Link>
                          </p>
                        </div>
                        <button
                          type="button"
                          role="switch"
                          aria-checked={analyticsEnabled}
                          aria-label="Activer ou désactiver la mesure d'usage"
                          onClick={() => toggleAnalytics(!analyticsEnabled)}
                          className="flex-shrink-0 relative transition-all"
                          style={{
                            width: 38,
                            height: 22,
                            background: analyticsEnabled ? 'var(--s-gold)' : 'var(--s-surface)',
                            border: `1px solid ${analyticsEnabled ? 'var(--s-gold)' : 'var(--s-border)'}`,
                            cursor: 'pointer',
                          }}
                        >
                          <span
                            className="absolute top-1/2 -translate-y-1/2 transition-all"
                            style={{
                              left: analyticsEnabled ? 20 : 2,
                              width: 14,
                              height: 14,
                              background: analyticsEnabled ? '#000' : 'var(--s-text-dim)',
                            }}
                          />
                        </button>
                      </div>
                    </div>

                    <div className="divider" />

                    <div>
                      <label className="t-label block mb-2">Mes données (RGPD)</label>
                      <p className="text-xs mb-3" style={{ color: 'var(--s-text-muted)' }}>
                        Télécharge une copie complète de tes données personnelles au format JSON (profil, appartenances, notifications, équipes, etc.).
                      </p>
                      <button
                        type="button"
                        onClick={handleExport}
                        disabled={exporting}
                        className="flex items-center gap-2 px-3 py-2 text-sm transition-colors duration-150"
                        style={{
                          background: 'var(--s-elevated)',
                          border: '1px solid var(--s-border)',
                          color: 'var(--s-text)',
                          cursor: exporting ? 'wait' : 'pointer',
                          opacity: exporting ? 0.6 : 1,
                        }}
                        onMouseEnter={(e) => { if (!exporting) e.currentTarget.style.background = 'var(--s-hover)'; }}
                        onMouseLeave={(e) => { if (!exporting) e.currentTarget.style.background = 'var(--s-elevated)'; }}
                      >
                        {exporting ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
                        {exporting ? 'Préparation…' : 'Télécharger mes données'}
                      </button>
                    </div>

                    <div className="divider" />

                    <div>
                      <label className="t-label block mb-2" style={{ color: '#ef4444' }}>Zone dangereuse</label>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={signOut}
                          className="flex items-center gap-2 px-3 py-2 text-sm transition-colors duration-150"
                          style={{
                            background: 'rgba(239,68,68,0.08)',
                            border: '1px solid rgba(239,68,68,0.25)',
                            color: '#ef4444',
                            cursor: 'pointer',
                          }}
                          onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(239,68,68,0.15)'; }}
                          onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(239,68,68,0.08)'; }}
                        >
                          <LogOut size={13} />
                          Me déconnecter
                        </button>
                        <button
                          type="button"
                          onClick={() => { setDeleteConfirm(true); setDeleteError(''); setDeleteConfirmText(''); setDeleteBlockingStructures([]); }}
                          className="flex items-center gap-2 px-3 py-2 text-sm transition-colors duration-150"
                          style={{
                            background: 'rgba(239,68,68,0.08)',
                            border: '1px solid rgba(239,68,68,0.4)',
                            color: '#ef4444',
                            cursor: 'pointer',
                          }}
                          onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(239,68,68,0.2)'; }}
                          onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(239,68,68,0.08)'; }}
                        >
                          <Trash2 size={13} />
                          Supprimer mon compte
                        </button>
                      </div>
                      <p className="text-xs mt-3" style={{ color: 'var(--s-text-muted)' }}>
                        La suppression est définitive. Si tu es fondateur(rice) d&apos;une structure, tu dois d&apos;abord en transférer la propriété.
                      </p>
                    </div>

                    {deleteConfirm && (
                      <div
                        className="fixed inset-0 z-[100] flex items-center justify-center p-4"
                        style={{ background: 'rgba(0,0,0,0.7)' }}
                        onClick={() => { if (!deleting) setDeleteConfirm(false); }}
                      >
                        <div
                          className="bevel-sm max-w-md w-full"
                          style={{ background: 'var(--s-surface)', border: '1px solid rgba(239,68,68,0.4)' }}
                          onClick={e => e.stopPropagation()}
                        >
                          <div className="h-[3px]" style={{ background: 'linear-gradient(90deg, #ef4444, rgba(239,68,68,0.3), transparent 70%)' }} />
                          <div className="p-5 space-y-4">
                            <div className="flex items-center gap-2">
                              <Trash2 size={16} style={{ color: '#ef4444' }} />
                              <span className="font-display text-lg" style={{ color: '#ef4444', letterSpacing: '0.04em' }}>
                                SUPPRIMER MON COMPTE
                              </span>
                            </div>
                            <p className="text-sm" style={{ color: 'var(--s-text)' }}>
                              Cette action est <strong>définitive</strong>. Seront supprimés :
                            </p>
                            <ul className="text-xs space-y-1 pl-4" style={{ color: 'var(--s-text-dim)', listStyle: 'disc' }}>
                              <li>Ton profil (pseudo, bio, pays, pseudos RL/TM)</li>
                              <li>Tes appartenances de structures</li>
                              <li>Ton inscription dans les rosters d&apos;équipes</li>
                              <li>Tes notifications et invitations en cours</li>
                              <li>Ton compte Discord lié (au niveau Aedral uniquement)</li>
                            </ul>
                            <p className="text-xs" style={{ color: 'var(--s-text-muted)' }}>
                              Les journaux d&apos;audit mentionnant ton UID sont conservés 3 ans pour des raisons d&apos;intégrité légale (politique de confidentialité).
                            </p>

                            {deleteBlockingStructures.length > 0 && (
                              <div className="p-3" style={{ background: 'rgba(255,184,0,0.08)', border: '1px solid rgba(255,184,0,0.3)' }}>
                                <p className="text-xs font-semibold mb-1" style={{ color: 'var(--s-gold)' }}>
                                  Structures à transférer d&apos;abord :
                                </p>
                                <ul className="text-xs pl-4" style={{ color: 'var(--s-gold)', listStyle: 'disc' }}>
                                  {deleteBlockingStructures.map(s => <li key={s}>{s}</li>)}
                                </ul>
                              </div>
                            )}

                            {deleteError && deleteBlockingStructures.length === 0 && (
                              <div className="p-2 text-xs" style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.3)', color: '#ef4444' }}>
                                {deleteError}
                              </div>
                            )}

                            <div>
                              <label className="t-label block mb-2">
                                Tape <span style={{ color: '#ef4444' }}>SUPPRIMER</span> pour confirmer
                              </label>
                              <input
                                type="text"
                                value={deleteConfirmText}
                                onChange={e => setDeleteConfirmText(e.target.value)}
                                className="settings-input w-full"
                                placeholder="SUPPRIMER"
                                disabled={deleting}
                              />
                            </div>

                            <div className="flex gap-2 justify-end">
                              <button
                                type="button"
                                onClick={() => setDeleteConfirm(false)}
                                disabled={deleting}
                                className="btn-springs btn-secondary bevel-sm"
                                style={{ padding: '8px 14px', fontSize: '12px' }}
                              >
                                Annuler
                              </button>
                              <button
                                type="button"
                                onClick={handleDelete}
                                disabled={deleting || deleteConfirmText !== 'SUPPRIMER'}
                                className="flex items-center gap-2 px-4 py-2 text-sm bevel-sm transition-colors duration-150"
                                style={{
                                  background: deleteConfirmText === 'SUPPRIMER' ? '#ef4444' : 'rgba(239,68,68,0.2)',
                                  color: deleteConfirmText === 'SUPPRIMER' ? '#000' : '#ef4444',
                                  border: '1px solid #ef4444',
                                  cursor: deleting || deleteConfirmText !== 'SUPPRIMER' ? 'not-allowed' : 'pointer',
                                  opacity: deleting || deleteConfirmText !== 'SUPPRIMER' ? 0.6 : 1,
                                  fontWeight: 600,
                                }}
                              >
                                {deleting ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                                {deleting ? 'Suppression…' : 'Supprimer définitivement'}
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

          </div>
        </div>
      </div>

      {/* Le bouton save flottant a été retiré (audit 12/06) : la top bar
          sticky est le seul point de vérité du save — l'auto-save 2s n'a pas
          à s'expliquer et deux indicateurs simultanés se contredisaient. */}
    </div>
  );
}

/**
 * Bloc "Sync rang Valorant via Discord/HenrikDev" affiché dans la section
 * Config Valorant. Appelle POST /api/profile/sync-valorant-rank et affiche
 * le résultat (rang récupéré, ou erreur si pas de Riot lié / unranked / etc.).
 */
function ValorantSyncBlock({
  currentRank,
  valorantLinked,
}: {
  currentRank: string;
  valorantLinked: { puuid: string; riotId: string } | null;
}) {
  const toast = useToast();
  const [syncing, setSyncing] = useState(false);
  const [lastResult, setLastResult] = useState<{ rank: string; rr: number; riotId: string; notRanked?: boolean } | null>(null);

  // NB : on ne lit plus l'état de la connexion Riot dans Discord (Discord a coupé
  // les comptes Riot de son API OAuth en juillet 2026). Le sync s'appuie sur le
  // PUUID vérifié STOCKÉ, indépendant de Discord → il reste dispo pour les liés.

  async function handleSync() {
    setSyncing(true);
    try {
      const res = await api<{ ok: true; rank: string; rr: number; riotId: string; notRanked?: boolean }>(
        '/api/profile/sync-valorant-rank',
        { method: 'POST' }
      );
      setLastResult({ rank: res.rank, rr: res.rr, riotId: res.riotId, notRanked: res.notRanked });
      toast.success(res.notRanked
        ? `Compte ${res.riotId} sync, non classé`
        : `Rang sync : ${res.rank} (${res.rr} RR)`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Erreur réseau');
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div className="space-y-3">
      {valorantLinked ? (
        <>
          {/* Compte Riot vérifié (verrouillé) — miroir du bloc Epic RL */}
          <div className="p-3 space-y-2"
            style={{ background: 'rgba(255,184,0,0.08)', border: '1px solid rgba(255,184,0,0.3)' }}>
            <div className="flex items-center gap-2 flex-wrap">
              <CheckCircle size={14} style={{ color: 'var(--s-gold)' }} />
              <span className="text-sm font-semibold" style={{ color: 'var(--s-text)' }}>
                Compte Riot vérifié
              </span>
            </div>
            {valorantLinked.riotId && (
              <div className="text-xs" style={{ color: 'var(--s-text-dim)' }}>
                <span className="font-semibold" style={{ color: 'var(--s-text)' }}>{valorantLinked.riotId}</span>
              </div>
            )}
            <p className="text-xs" style={{ color: 'var(--s-text-muted)' }}>
              Changer de compte Valorant sera possible avec la connexion Riot directe (à venir).
            </p>
          </div>

          <div>
            <label className="t-label block mb-2">Resynchroniser mon rang</label>
            <div className="flex items-center gap-2 flex-wrap">
              <button
                type="button"
                onClick={handleSync}
                disabled={syncing}
                className="btn-springs bevel-sm flex items-center gap-2 px-4 py-2"
                style={{
                  fontSize: '13px',
                  background: '#FF4655',
                  border: '1px solid #FF4655',
                  color: '#fff',
                  cursor: syncing ? 'wait' : 'pointer',
                  fontWeight: 600,
                }}
              >
                {syncing ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
                {syncing ? 'Synchronisation…' : 'Sync mon rang maintenant'}
              </button>
              {lastResult && (
                <span className="text-xs" style={{ color: 'var(--s-text-dim)' }}>
                  ✓ {lastResult.riotId} · {lastResult.notRanked ? 'Non classé' : `${lastResult.rank} (${lastResult.rr} RR)`}
                </span>
              )}
            </div>
            <p className="text-xs mt-1.5" style={{ color: 'var(--s-text-muted)' }}>
              Ton rang est resynchronisé depuis ton compte Riot vérifié, au clic et chaque nuit en arrière-plan. Pas de saisie manuelle, donc impossible de mentir.
              {currentRank && (
                <span> Rang actuel stocké : <strong style={{ color: 'var(--s-text-dim)' }}>{currentRank}</strong>.</span>
              )}
            </p>
          </div>
        </>
      ) : (
        // Non lié : plus aucune vérif possible via Discord (Riot coupé) → en pause.
        <div className="p-3" style={{ background: 'var(--s-elevated)', border: '1px solid var(--s-border)' }}>
          <p className="text-sm" style={{ color: 'var(--s-text-dim)' }}>
            {VALORANT_VERIFICATION_PAUSED}
          </p>
          {currentRank && (
            <p className="text-xs mt-1.5" style={{ color: 'var(--s-text-muted)' }}>
              Rang précédemment stocké : <strong style={{ color: 'var(--s-text-dim)' }}>{currentRank}</strong>.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Bloc "Sync trophées Trackmania via tm.io" affiché dans la section Config TM.
 * Appelle POST /api/profile/sync-tm-trophies et affiche le résultat
 * (trophées récupérés, ou erreur si pas de URL tm.io / 404 / etc.).
 */
function TrackmaniaSyncBlock({ hasUrl }: { hasUrl: boolean }) {
  const toast = useToast();
  const [syncing, setSyncing] = useState(false);
  const [synced, setSynced] = useState(false);

  async function handleSync() {
    setSyncing(true);
    try {
      await api<{ ok: true }>('/api/profile/sync-tm-trophies', { method: 'POST' });
      setSynced(true);
      toast.success('Trophées Trackmania synchronisés');
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Erreur réseau');
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div>
      <label className="t-label block mb-2">Sync auto via Trackmania.io</label>
      <div className="flex items-center gap-2 flex-wrap">
        <button
          type="button"
          onClick={handleSync}
          disabled={syncing || !hasUrl}
          className="btn-springs bevel-sm flex items-center gap-2 px-4 py-2"
          style={{
            fontSize: '13px',
            background: hasUrl ? 'var(--s-green)' : 'var(--s-elevated)',
            border: `1px solid ${hasUrl ? 'var(--s-green)' : 'var(--s-border)'}`,
            color: hasUrl ? '#000' : 'var(--s-text-muted)',
            cursor: syncing ? 'wait' : (hasUrl ? 'pointer' : 'not-allowed'),
            fontWeight: 600,
            opacity: hasUrl ? 1 : 0.6,
          }}
        >
          {syncing ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
          {syncing ? 'Synchronisation…' : 'Sync mes trophées maintenant'}
        </button>
        {synced && (
          <span className="text-xs" style={{ color: 'var(--s-text-dim)' }}>
            ✓ Trophées + COTD à jour
          </span>
        )}
      </div>
      <p className="text-xs mt-1.5" style={{ color: 'var(--s-text-muted)' }}>
        Récupère tes trophées, échelon et meilleur rang COTD via trackmania.io.
        Aussi synchronisé automatiquement chaque nuit en arrière-plan.
        {!hasUrl && <span> Renseigne d&apos;abord ton URL Trackmania.io ci-dessus.</span>}
      </p>
    </div>
  );
}
