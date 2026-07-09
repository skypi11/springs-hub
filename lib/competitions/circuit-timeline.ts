// Dérive l'état de chaque étape d'un circuit (parcours à nœuds) + choisit
// l'étape « focus » pour le héros (prochaine action pour un visiteur). Pur,
// réutilisé par la page circuit (roadmap) ET la liste /competitions (mini-
// timeline + stat-décision). Opère sur une forme minimale d'événement.

export type StageState = 'played' | 'open' | 'live' | 'upcoming';

export interface TimelineEventLike {
  id: string;
  status: string;
  registrationOpen?: boolean;
  startDate?: string | null;
  closesAt?: string | null;
}

/** État d'une étape pour le nœud de la roadmap. */
export function stageState(e: TimelineEventLike): StageState {
  if (e.status === 'finished' || e.status === 'archived') return 'played';
  if (e.registrationOpen) return 'open';
  if (e.status === 'live' || e.status === 'seeding' || e.status === 'validation') return 'live';
  return 'upcoming';
}

export type FocusMode = 'open' | 'live' | 'upcoming' | 'done';

/** L'étape que le héros met en avant : inscription ouverte d'abord, puis en
 *  cours, puis la prochaine à venir (par date), sinon « done » (tout joué →
 *  le héros bascule sur le classement/la LAN). Générique : conserve le type
 *  complet de l'événement passé par l'appelant. */
export function pickFocusEvent<T extends TimelineEventLike>(events: T[]): { event: T | null; mode: FocusMode } {
  const open = events.find(e => stageState(e) === 'open');
  if (open) return { event: open, mode: 'open' };
  const live = events.find(e => stageState(e) === 'live');
  if (live) return { event: live, mode: 'live' };
  const upcoming = events
    .filter(e => stageState(e) === 'upcoming')
    .sort((a, b) => String(a.startDate ?? '').localeCompare(String(b.startDate ?? '')));
  if (upcoming.length) return { event: upcoming[0], mode: 'upcoming' };
  return { event: null, mode: 'done' };
}
