// Tracker.gg — résolution Epic Games
// L'API publique accepte aussi bien un display name qu'un Epic Account ID.
// On l'appelle avec ce que l'utilisateur a tapé pour récupérer le `platformUserId`
// (l'ID Epic permanent qui ne change jamais), puis on le stocke en base.

const TRN_BASE = 'https://public-api.tracker.gg/v2/rocket-league/standard/profile';

export interface EpicResolved {
  // ID Epic permanent (UUID, stable même si le pseudo change)
  id: string;
  // Pseudo Epic actuel renvoyé par Tracker.gg
  displayName: string;
}

// Renvoie null si la résolution échoue (joueur introuvable, API down, clé manquante).
// L'appelant doit décider du fallback (par défaut : conserver la saisie utilisateur).
export async function resolveEpicAccount(input: string): Promise<EpicResolved | null> {
  const apiKey = process.env.TRN_API_KEY;
  if (!apiKey) return null;

  const trimmed = input.trim();
  if (!trimmed) return null;

  try {
    const res = await fetch(`${TRN_BASE}/epic/${encodeURIComponent(trimmed)}`, {
      headers: { 'TRN-Api-Key': apiKey },
      // Pas de cache — on veut une résolution fraîche au moment de la sauvegarde
      cache: 'no-store',
    });
    if (!res.ok) return null;

    const data = await res.json();
    const platformInfo = data?.data?.platformInfo as
      | { platformUserId?: string; platformUserHandle?: string; platformUserIdentifier?: string }
      | undefined;

    const id = platformInfo?.platformUserId;
    const displayName =
      platformInfo?.platformUserHandle || platformInfo?.platformUserIdentifier || trimmed;

    if (!id) return null;
    return { id, displayName };
  } catch {
    return null;
  }
}
