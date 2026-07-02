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
  // La date réelle vit dans user_secrets (server-only) : le doc users ne porte
  // que le flag hasDateOfBirth. On garde le fallback dateOfBirth pour les
  // profils pas encore migrés (backfill) et le retour owner de GET /api/profile.
  if (!u.hasDateOfBirth && !u.dateOfBirth?.trim()) missing.push('date de naissance');
  if (!u.games || u.games.length === 0) {
    missing.push('jeu pratiqué');
  } else {
    if (u.games.includes('rocket_league')) {
      // Nouveau modèle (rlPlatform + rlPlatformId) avec fallback sur les champs legacy
      const hasNewPlatform = !!u.rlPlatform && !!u.rlPlatformId?.trim();
      const hasLegacyEpic = !!u.epicAccountId?.trim() || !!u.epicDisplayName?.trim();
      if (!hasNewPlatform && !hasLegacyEpic) {
        missing.push('plateforme RL + identifiant');
      }
    }
    if (u.games.includes('trackmania')) {
      if (!u.pseudoTM?.trim()) missing.push('pseudo Ubisoft/Nadeo');
      if (!u.tmIoUrl?.trim()) missing.push('URL Trackmania.io');
    }
  }
  return { complete: missing.length === 0, missing };
}
