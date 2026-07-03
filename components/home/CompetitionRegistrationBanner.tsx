'use client';

// Bannière d'inscription du dashboard connecté (spec Legends §15.5) : pendant
// une fenêtre d'inscription ouverte, ligne fine « Inscriptions ouvertes » avec
// lien vers la fiche de la compétition. Les admins compét et les comptes du
// bac à sable voient aussi les compétitions en brouillon (leur terrain de
// test). Se masque seule quand il n'y a rien à annoncer.

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Trophy, ArrowRight } from 'lucide-react';
import { api } from '@/lib/api-client';
import { useAuth } from '@/context/AuthContext';

interface OpenCompetition {
  id: string;
  name: string;
  game: string;
  closesAt: string | null;
  isDraft: boolean;
}

function fmtDeadline(iso: string | null): string {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' });
  } catch { return ''; }
}

export default function CompetitionRegistrationBanner() {
  const { user } = useAuth();
  const { data } = useQuery({
    queryKey: ['competitions-open', user?.uid],
    queryFn: () => api<{ competitions: OpenCompetition[] }>('/api/competitions/open'),
    enabled: !!user,
    staleTime: 5 * 60_000,
  });

  const competitions = data?.competitions ?? [];
  if (competitions.length === 0) return null;

  return (
    <div className="space-y-2 animate-fade-in">
      {competitions.map(c => (
        <Link
          key={c.id}
          href={`/competitions/${c.id}`}
          className="flex flex-wrap items-center gap-3 px-4 py-3 bevel-sm group transition-colors"
          style={{
            background: 'var(--s-surface)',
            border: '1px solid rgba(255,184,0,0.3)',
          }}
        >
          <Trophy size={15} style={{ color: 'var(--s-gold)', flexShrink: 0 }} />
          <span className="text-sm font-semibold min-w-0 truncate">
            {c.isDraft ? 'Compétition en préparation' : 'Inscriptions ouvertes'} — {c.name}
          </span>
          <span className="text-sm" style={{ color: 'var(--s-text-dim)' }}>
            {c.isDraft
              ? 'visible uniquement par toi, teste l\'inscription'
              : c.closesAt ? `jusqu'au ${fmtDeadline(c.closesAt)}` : ''}
          </span>
          <span className="text-sm ml-auto flex items-center gap-1.5" style={{ color: 'var(--s-gold)' }}>
            Inscrire mon équipe
            <ArrowRight size={13} className="transition-transform group-hover:translate-x-0.5" />
          </span>
        </Link>
      ))}
    </div>
  );
}
