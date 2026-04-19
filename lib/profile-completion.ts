import type { SpringsUser } from '@/types';

export interface ProfileCompletionStatus {
  complete: boolean;
  missing: string[];
}

export function checkProfileCompletion(u: SpringsUser | null): ProfileCompletionStatus {
  if (!u) return { complete: false, missing: [] };
  const missing: string[] = [];
  if (!u.displayName?.trim()) missing.push('pseudo');
  if (!u.country?.trim()) missing.push('pays');
  if (!u.dateOfBirth?.trim()) missing.push('date de naissance');
  if (!u.games || u.games.length === 0) {
    missing.push('jeu pratiqué');
  } else {
    if (u.games.includes('rocket_league')) {
      if (!u.epicAccountId?.trim() && !u.epicDisplayName?.trim()) missing.push('pseudo Epic Games');
      if (!u.rlTrackerUrl?.trim()) missing.push('URL RL Tracker');
    }
    if (u.games.includes('trackmania')) {
      if (!u.pseudoTM?.trim()) missing.push('pseudo Ubisoft/Nadeo');
      if (!u.tmIoUrl?.trim()) missing.push('URL Trackmania.io');
    }
  }
  return { complete: missing.length === 0, missing };
}
