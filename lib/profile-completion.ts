import type { SpringsUser } from '@/types';
import { tmAccountIdOf } from './trackmania-identity';

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
      // L'adresse trackmania.io se DÉDUIT de l'identifiant de compte, que la
      // liaison Ubisoft nous donne. La réclamer à quelqu'un qui a déjà lié son
      // compte, c'est lui faire recopier une information qu'on possède — et
      // c'est ce qui bloquait les inscrits de la LAN sur l'accueil.
      if (!tmAccountIdOf(u)) missing.push('compte Ubisoft/Nadeo lié');
    }
  }
  return { complete: missing.length === 0, missing };
}
