'use client';

import { useState } from 'react';
import { signInWithCustomToken } from 'firebase/auth';
import { auth } from '@/lib/firebase';
import { useAuth } from '@/context/AuthContext';
import { FlaskConical, ChevronDown, Database, Trash2, RefreshCw } from 'lucide-react';

// Panneau dev-only — visible uniquement si NODE_ENV === 'development'.
// Permet de se connecter rapidement en tant que faux utilisateur dev pour tester
// les différents rôles (fondateur, co-fondateur, manager, coach, joueur, admin).
// Les comptes dev sont créés via /api/dev/seed et supprimés via /api/dev/cleanup.

type DevAccount = { uid: string; label: string; color: string };

const DEV_GROUPS: { title: string; accounts: DevAccount[] }[] = [
  {
    title: 'Phoenix · Staff structure',
    accounts: [
      { uid: 'discord_dev_founder',         label: 'Matt (Fondateur)',       color: 'var(--s-gold)' },
      { uid: 'discord_dev_cofounder',       label: 'Luca (Co-fondateur)',    color: 'var(--s-gold)' },
      { uid: 'discord_dev_responsable',     label: 'Sofia (Responsable)',    color: 'var(--s-violet-light)' },
      { uid: 'discord_dev_coach_structure', label: 'Elena (Coach structure)', color: '#FFB800' },
    ],
  },
  {
    title: 'Phoenix · Staff équipe',
    accounts: [
      { uid: 'discord_dev_team_manager',    label: "Louis (Manager d'équipe)", color: 'var(--s-violet-light)' },
      { uid: 'discord_dev_team_coach',      label: "Thomas (Coach d'équipe)",  color: '#4da6ff' },
    ],
  },
  {
    title: 'Équipe Main',
    accounts: [
      { uid: 'discord_dev_rl_elite_captain', label: 'Zephyr (Capitaine)',   color: 'var(--s-gold)' },
      { uid: 'discord_dev_rl_elite_p1',      label: 'Kairos',                color: 'var(--s-blue)' },
      { uid: 'discord_dev_rl_elite_p2',      label: 'Vex',                   color: 'var(--s-blue)' },
      { uid: 'discord_dev_rl_elite_sub1',    label: 'Onyx (Sub)',            color: 'var(--s-text-dim)' },
      { uid: 'discord_dev_rl_elite_sub2',    label: 'Blaze (Sub)',           color: 'var(--s-text-dim)' },
    ],
  },
  {
    title: 'Équipe Academy',
    accounts: [
      { uid: 'discord_dev_rl_academy_captain', label: 'Echo (Capitaine)',    color: 'var(--s-gold)' },
      { uid: 'discord_dev_rl_academy_p1',      label: 'Nyx',                 color: 'var(--s-blue)' },
      { uid: 'discord_dev_rl_academy_p2',      label: 'Drift',               color: 'var(--s-blue)' },
      { uid: 'discord_dev_rl_academy_sub',     label: 'Apex (Sub)',          color: 'var(--s-text-dim)' },
    ],
  },
  {
    title: 'Équipe Féminine Main',
    accounts: [
      { uid: 'discord_dev_rl_fem_main_captain', label: 'Aria (Capitaine)',   color: 'var(--s-gold)' },
      { uid: 'discord_dev_rl_fem_main_p1',      label: 'Luna',               color: 'var(--s-blue)' },
      { uid: 'discord_dev_rl_fem_main_p2',      label: 'Vera',               color: 'var(--s-blue)' },
      { uid: 'discord_dev_rl_fem_main_sub',     label: 'Nova (Sub)',         color: 'var(--s-text-dim)' },
    ],
  },
  {
    title: 'Équipe Junior',
    accounts: [
      { uid: 'discord_dev_rl_junior_captain', label: 'Kyro (Capitaine)',     color: 'var(--s-gold)' },
      { uid: 'discord_dev_rl_junior_p1',      label: 'Slick',                color: 'var(--s-blue)' },
      { uid: 'discord_dev_rl_junior_p2',      label: 'Quinn',                color: 'var(--s-blue)' },
    ],
  },
  {
    title: 'Autres',
    accounts: [
      { uid: 'discord_dev_pure_member', label: 'Sam (sans équipe)',     color: 'var(--s-text-dim)' },
      { uid: 'discord_dev_admin',       label: 'Admin Springs',          color: 'var(--s-gold)' },
      { uid: 'discord_dev_recruit1',    label: 'Tempest (libre)',        color: 'var(--s-green)' },
      { uid: 'discord_dev_recruit2',    label: 'Hollow (libre)',         color: 'var(--s-green)' },
      { uid: 'discord_dev_recruit3',    label: 'Breeze (libre)',         color: 'var(--s-green)' },
      { uid: 'discord_dev_recruit4',    label: 'Glimmer (libre)',        color: 'var(--s-green)' },
      { uid: 'discord_dev_recruit5',    label: 'Vortex (libre)',         color: 'var(--s-green)' },
    ],
  },
];

const ALL_DEV_ACCOUNTS: DevAccount[] = DEV_GROUPS.flatMap(g => g.accounts);

export default function DevSwitcher() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  // Cache l'outil en prod. NODE_ENV est inliné au build — safe.
  if (process.env.NODE_ENV !== 'development') return null;

  const currentDevUid = user?.uid?.startsWith('discord_dev_') ? user.uid : null;

  async function impersonate(targetUid: string) {
    setBusy(targetUid);
    setMessage(null);
    try {
      const res = await fetch('/api/dev/impersonate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetUid }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMessage(data.error || 'Erreur impersonate');
        setBusy(null);
        return;
      }
      await signInWithCustomToken(auth, data.token);
      setMessage(null);
      // Force un reload pour que toutes les pages re-fetchent avec le nouveau token
      window.location.reload();
    } catch (err) {
      setMessage((err as Error).message);
      setBusy(null);
    }
  }

  async function seed() {
    setBusy('seed');
    setMessage(null);
    try {
      const res = await fetch('/api/dev/seed', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) setMessage(data.error || 'Erreur seed');
      else setMessage(`Seed OK — ${data.users} users + structure ${data.structure}`);
    } catch (err) {
      setMessage((err as Error).message);
    }
    setBusy(null);
  }

  async function cleanup() {
    if (!confirm('Supprimer TOUS les comptes et données dev ?')) return;
    setBusy('cleanup');
    setMessage(null);
    try {
      const res = await fetch('/api/dev/cleanup', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) setMessage(data.error || 'Erreur cleanup');
      else {
        const total = Object.values(data.deleted as Record<string, number>).reduce((a, b) => a + b, 0);
        setMessage(`Cleanup OK — ${total} docs supprimés`);
      }
    } catch (err) {
      setMessage((err as Error).message);
    }
    setBusy(null);
  }

  return (
    <div
      className="mt-2"
      style={{
        background: 'var(--s-elevated)',
        border: '1px solid rgba(255,184,0,0.25)',
      }}
    >
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center gap-2 px-3 py-2 transition-colors duration-150 hover:bg-[var(--s-hover)]"
        style={{ color: 'var(--s-gold)' }}
      >
        <FlaskConical size={13} />
        <span className="t-label flex-1 text-left" style={{ fontSize: '11px' }}>DEV · VIEW AS</span>
        {currentDevUid && (
          <span
            className="t-label truncate max-w-[90px]"
            style={{ fontSize: '9px', color: 'var(--s-gold)' }}
            title={currentDevUid}
          >
            {ALL_DEV_ACCOUNTS.find(a => a.uid === currentDevUid)?.label ?? 'Dev'}
          </span>
        )}
        <ChevronDown size={12} style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 150ms' }} />
      </button>

      {open && (
        <div className="px-2 pb-2 pt-1 space-y-2 max-h-[70vh] overflow-y-auto">
          {DEV_GROUPS.map(group => (
            <div key={group.title} className="space-y-0.5">
              <div
                className="t-label px-2 pt-1"
                style={{ color: 'var(--s-text-muted)', fontSize: '9px', letterSpacing: '0.08em' }}
              >
                {group.title}
              </div>
              {group.accounts.map(acc => {
                const isCurrent = currentDevUid === acc.uid;
                return (
                  <button
                    key={acc.uid}
                    type="button"
                    disabled={busy !== null}
                    onClick={() => impersonate(acc.uid)}
                    className="w-full flex items-center gap-2 px-2 py-1.5 text-left transition-colors duration-150 hover:bg-[var(--s-hover)] disabled:opacity-50"
                    style={{
                      background: isCurrent ? 'rgba(255,184,0,0.08)' : 'transparent',
                      borderLeft: `2px solid ${isCurrent ? 'var(--s-gold)' : 'transparent'}`,
                    }}
                  >
                    <span className="text-xs font-semibold" style={{ color: acc.color }}>{acc.label}</span>
                    {busy === acc.uid && <RefreshCw size={10} className="animate-spin ml-auto" style={{ color: 'var(--s-text-dim)' }} />}
                  </button>
                );
              })}
            </div>
          ))}

          <div className="pt-1 mt-1 flex gap-1" style={{ borderTop: '1px solid var(--s-border)' }}>
            <button
              type="button"
              disabled={busy !== null}
              onClick={seed}
              className="flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 text-xs transition-colors duration-150 hover:bg-[var(--s-hover)] disabled:opacity-50"
              style={{ background: 'var(--s-surface)', color: 'var(--s-text-dim)', border: '1px solid var(--s-border)' }}
              title="Créer les comptes et la structure de test"
            >
              <Database size={11} />
              Seed
            </button>
            <button
              type="button"
              disabled={busy !== null}
              onClick={cleanup}
              className="flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 text-xs transition-colors duration-150 hover:bg-[var(--s-hover)] disabled:opacity-50"
              style={{ background: 'var(--s-surface)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.25)' }}
              title="Supprimer tous les comptes et données dev"
            >
              <Trash2 size={11} />
              Reset
            </button>
          </div>

          {message && (
            <div
              className="mt-1 px-2 py-1.5 text-xs"
              style={{
                background: 'var(--s-surface)',
                border: '1px solid var(--s-border)',
                color: 'var(--s-text-dim)',
                fontSize: '11px',
              }}
            >
              {message}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
