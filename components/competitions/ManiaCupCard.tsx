'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, CalendarDays, MapPin } from 'lucide-react';
import { apiPublic } from '@/lib/api-client';
import GameTag from '@/components/games/GameTag';
import { MANIA_CUP } from '@/lib/mania-cup';

// La Springs Mania Cup dans la liste des compétitions.
//
// Elle n'est ni un circuit natif Aedral, ni une compétition historique de
// l'ancien site : elle a son propre module, avec son inscription et sa
// billetterie. D'où une carte à part.
//
// La visibilité ne se décide pas ici : on interroge l'API publique des
// inscrits, qui répond 404 tant que l'événement n'est pas publié. Un seul appel
// donne donc à la fois le droit d'afficher et les places restantes — et le jour
// où l'événement est publié, cette carte apparaît sans qu'on y touche.

interface Counts {
  confirmed: number;
  pending: number;
  max: number;
  seatsLeft: number;
}

export default function ManiaCupCard() {
  const [counts, setCounts] = useState<Counts | null>(null);

  useEffect(() => {
    let alive = true;
    apiPublic<{ counts: Counts }>('/api/mania-cup/participants')
      .then((d) => {
        if (alive) setCounts(d.counts);
      })
      .catch(() => {
        // 404 = événement non publié. Rien à afficher, rien à signaler.
      });
    return () => {
      alive = false;
    };
  }, []);

  // Tant que l'événement n'est pas publié, la section entière n'existe pas —
  // titre compris, sinon la page afficherait un intertitre suivi de rien.
  if (!counts) return null;

  const full = counts.seatsLeft <= 0;

  return (
    <section className="space-y-4">
      <p className="t-label" style={{ color: 'var(--s-text-muted)' }}>
        Sur place
      </p>

      <Link
        href="/mania-cup"
        className="panel bevel group block transition-colors hover:bg-[var(--s-elevated)]"
      >
        <div className="panel-body flex flex-wrap items-center gap-x-5 gap-y-3">
          <GameTag gameId="trackmania" size="sm" />

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold group-hover:underline">{MANIA_CUP.name}</span>
              <span className={full ? 'tag tag-neutral' : 'tag tag-green'}>
                {full ? 'Complet' : 'Inscriptions ouvertes'}
              </span>
            </div>
            <p
              className="t-body mt-1 flex flex-wrap items-center gap-x-4 gap-y-1"
              style={{ color: 'var(--s-text-muted)' }}
            >
              <span className="inline-flex items-center gap-1.5">
                <CalendarDays size={13} aria-hidden /> 3 &amp; 4 octobre 2026
              </span>
              <span className="inline-flex items-center gap-1.5">
                <MapPin size={13} aria-hidden /> {MANIA_CUP.city}
              </span>
              <span>LAN · {MANIA_CUP.maxPlayers} joueurs</span>
            </p>
          </div>

          {/* La donnée qui décide de cliquer : combien de places il reste. */}
          {!full && (
            <div className="text-right">
              <div className="font-display text-2xl" style={{ color: 'var(--s-green)' }}>
                {counts.seatsLeft}
              </div>
              <div className="t-label-soft">
                place{counts.seatsLeft > 1 ? 's' : ''} restante
                {counts.seatsLeft > 1 ? 's' : ''}
              </div>
            </div>
          )}

          <ArrowRight
            size={16}
            className="shrink-0 transition-transform group-hover:translate-x-0.5"
            style={{ color: 'var(--s-text-dim)' }}
            aria-hidden
          />
        </div>
      </Link>
    </section>
  );
}
