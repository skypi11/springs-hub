'use client';

import { useState, useEffect, useCallback } from 'react';
import { Send, Loader2, X, Shield } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/components/ui/Toast';
import Portal from '@/components/ui/Portal';

type EligibleStructure = {
  id: string;
  name: string;
  tag: string;
  games: string[];
  recruiting: { active: boolean; positions: { game: string; role: string }[] };
};

type Props = {
  targetUserId: string;
  targetDisplayName: string;
  targetGames: string[];
  isAvailableForRecruitment: boolean;
  className?: string;
  compact?: boolean;
};

const GAME_LABELS: Record<string, string> = {
  rocket_league: 'Rocket League',
  trackmania: 'Trackmania',
};

const ROLE_OPTIONS = [
  { value: 'joueur', label: 'Joueur' },
  { value: 'titulaire', label: 'Titulaire' },
  { value: 'sub', label: 'Remplaçant' },
  { value: 'coach', label: 'Coach' },
  { value: 'manager', label: 'Manager' },
];

export default function InviteToStructureButton({
  targetUserId,
  targetDisplayName,
  targetGames,
  isAvailableForRecruitment,
  className = '',
  compact = false,
}: Props) {
  const { firebaseUser } = useAuth();
  const toast = useToast();
  const [eligible, setEligible] = useState<EligibleStructure[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [visible, setVisible] = useState(false);
  const [selectedStructureId, setSelectedStructureId] = useState('');
  const [game, setGame] = useState('');
  const [role, setRole] = useState('joueur');
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Charge les structures où l'user est dirigeant dès qu'il est connecté — permet de cacher
  // le bouton s'il n'a pas d'accès
  useEffect(() => {
    if (!firebaseUser) {
      setEligible([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const idToken = await firebaseUser.getIdToken();
        const res = await fetch('/api/structures/my', {
          headers: { 'Authorization': `Bearer ${idToken}` },
        });
        if (!res.ok) {
          if (!cancelled) setEligible([]);
          return;
        }
        const data = await res.json();
        const structures: EligibleStructure[] = (data.structures || [])
          .filter((s: { accessLevel?: string; status?: string }) =>
            s.accessLevel === 'dirigeant' && s.status === 'active'
          )
          .map((s: EligibleStructure) => ({
            id: s.id,
            name: s.name,
            tag: s.tag,
            games: s.games || [],
            recruiting: s.recruiting || { active: false, positions: [] },
          }));
        if (!cancelled) setEligible(structures);
      } catch {
        if (!cancelled) setEligible([]);
      }
    })();
    return () => { cancelled = true; };
  }, [firebaseUser]);

  const openModal = useCallback(() => {
    if (!eligible || eligible.length === 0) return;
    // Présélection : première structure qui a un jeu en commun
    const firstMatch = eligible.find(s => s.games.some(g => targetGames.includes(g))) || eligible[0];
    setSelectedStructureId(firstMatch.id);
    const sharedGame = firstMatch.games.find(g => targetGames.includes(g)) || firstMatch.games[0] || '';
    setGame(sharedGame);
    setRole('joueur');
    setMessage('');
    setOpen(true);
    setTimeout(() => setVisible(true), 10);
  }, [eligible, targetGames]);

  const closeModal = useCallback(() => {
    setVisible(false);
    setTimeout(() => setOpen(false), 200);
  }, []);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeModal();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, closeModal]);

  async function submit() {
    if (!firebaseUser || !selectedStructureId || !game) return;
    setSubmitting(true);
    try {
      const idToken = await firebaseUser.getIdToken();
      const res = await fetch('/api/structures/invitations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${idToken}` },
        body: JSON.stringify({
          action: 'direct_invite',
          structureId: selectedStructureId,
          targetUserId,
          game,
          role,
          message,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        toast.success(`Invitation envoyée à ${targetDisplayName}`);
        closeModal();
      } else {
        toast.error(data.error || 'Erreur');
      }
    } catch {
      toast.error('Erreur réseau');
    }
    setSubmitting(false);
  }

  // Ne rien afficher si pas connecté, pas dirigeant, ou cible pas dispo recrutement
  if (!firebaseUser || !isAvailableForRecruitment) return null;
  if (eligible === null) {
    return (
      <button disabled className={`btn-springs btn-ghost bevel-sm flex items-center gap-2 ${className}`} style={{ opacity: 0.5 }}>
        <Loader2 size={12} className="animate-spin" /> Chargement
      </button>
    );
  }
  if (eligible.length === 0) return null;
  // La cible ne joue pas aux jeux de ta/tes structure(s)
  const hasAnyMatch = eligible.some(s => s.games.some(g => targetGames.includes(g)));
  if (!hasAnyMatch) return null;

  const selectedStructure = eligible.find(s => s.id === selectedStructureId);
  const availableGames = selectedStructure
    ? selectedStructure.games.filter(g => targetGames.includes(g))
    : [];

  return (
    <>
      <button
        onClick={openModal}
        disabled={loading}
        className={`btn-springs btn-primary bevel-sm flex items-center gap-2 ${compact ? 'text-xs' : ''} ${className}`}
      >
        <Send size={compact ? 11 : 13} /> Inviter
      </button>

      {open && (
        <Portal>
          <div
            role="dialog"
            aria-modal="true"
            style={{
              position: 'fixed',
              inset: 0,
              zIndex: 10000,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: visible ? 'rgba(4,4,8,0.78)' : 'rgba(4,4,8,0)',
              transition: 'background 0.2s ease',
              padding: 24,
            }}
            onClick={closeModal}
          >
            <div
              onClick={e => e.stopPropagation()}
              className="bevel"
              style={{
                maxWidth: 520,
                width: '100%',
                background: 'var(--s-surface)',
                border: '1px solid var(--s-border)',
                borderTop: '3px solid var(--s-gold)',
                padding: '24px 28px 22px',
                transform: visible ? 'scale(1)' : 'scale(0.96)',
                opacity: visible ? 1 : 0,
                transition: 'transform 0.2s ease, opacity 0.2s ease',
                boxShadow: '0 24px 64px rgba(0,0,0,0.6)',
              }}
            >
              <div className="flex items-start justify-between mb-4">
                <div>
                  <h2 className="font-display text-2xl tracking-wider" style={{ color: 'var(--s-text)' }}>
                    INVITER {targetDisplayName.toUpperCase()}
                  </h2>
                  <p className="text-sm mt-1" style={{ color: 'var(--s-text-dim)' }}>
                    Envoie une invitation directe à rejoindre ta structure.
                  </p>
                </div>
                <button onClick={closeModal} className="p-1 hover:opacity-70" aria-label="Fermer">
                  <X size={18} style={{ color: 'var(--s-text-muted)' }} />
                </button>
              </div>

              <div className="space-y-4">
                {eligible.length > 1 && (
                  <div>
                    <label className="t-label block mb-1.5">Structure *</label>
                    <select
                      className="settings-input w-full"
                      value={selectedStructureId}
                      onChange={e => {
                        const id = e.target.value;
                        setSelectedStructureId(id);
                        const s = eligible.find(x => x.id === id);
                        const shared = s?.games.find(g => targetGames.includes(g)) || s?.games[0] || '';
                        setGame(shared);
                      }}
                    >
                      {eligible.map(s => (
                        <option key={s.id} value={s.id}>
                          {s.name} {s.tag && `[${s.tag}]`}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                {eligible.length === 1 && selectedStructure && (
                  <div className="flex items-center gap-2 p-3 bevel-sm" style={{ background: 'var(--s-elevated)', border: '1px solid var(--s-border)' }}>
                    <Shield size={14} style={{ color: 'var(--s-gold)' }} />
                    <span className="text-sm font-semibold">{selectedStructure.name}</span>
                    {selectedStructure.tag && <span className="tag tag-gold" style={{ fontSize: '9px' }}>{selectedStructure.tag}</span>}
                  </div>
                )}

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="t-label block mb-1.5">Jeu *</label>
                    <select className="settings-input w-full" value={game} onChange={e => setGame(e.target.value)}>
                      {availableGames.length === 0 && <option value="">Aucun jeu commun</option>}
                      {availableGames.map(g => (
                        <option key={g} value={g}>{GAME_LABELS[g] || g}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="t-label block mb-1.5">Rôle *</label>
                    <select className="settings-input w-full" value={role} onChange={e => setRole(e.target.value)}>
                      {ROLE_OPTIONS.map(r => (
                        <option key={r.value} value={r.value}>{r.label}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div>
                  <label className="t-label block mb-1.5">Message (optionnel)</label>
                  <textarea
                    className="settings-input w-full"
                    rows={3}
                    maxLength={500}
                    placeholder="Un mot pour convaincre le joueur de rejoindre..."
                    value={message}
                    onChange={e => setMessage(e.target.value)}
                  />
                  <p className="text-xs mt-1" style={{ color: 'var(--s-text-muted)' }}>{message.length}/500</p>
                </div>
              </div>

              <div className="flex gap-3 justify-end mt-6">
                <button onClick={closeModal} className="btn-springs btn-secondary bevel-sm text-xs">
                  Annuler
                </button>
                <button
                  onClick={submit}
                  disabled={submitting || !game || !selectedStructureId}
                  className="btn-springs btn-primary bevel-sm flex items-center gap-2 text-xs"
                >
                  {submitting ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
                  Envoyer l&apos;invitation
                </button>
              </div>
            </div>
          </div>
        </Portal>
      )}
    </>
  );
}
