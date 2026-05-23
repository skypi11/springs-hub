// Client ballchasing.com — upload + fetch parsed replay data.
//
// Modèle : un seul compte Aedral (clé `BALLCHASING_API_KEY`) qui mutualise les
// uploads de toutes les structures premium. Les replays sont uploadés en
// `visibility=private` pour que seule notre clé puisse les fetch, puis on
// proxie les stats parsées au client via notre propre endpoint.
//
// Quotas (au 2026-05) :
// - Free : 10 uploads/jour
// - Diamond Patreon (€4.50/mois) : 1050 uploads/semaine ≈ 150/jour
//
// Le service est intentionnellement no-op si la clé est absente — on log un
// warning et on n'upload pas. Permet de continuer à shipper sans payer
// l'abonnement Patreon avant d'avoir la traction qui le justifie.

const BALLCHASING_BASE = 'https://ballchasing.com/api';

export interface BallchasingUploadResult {
  id: string;
  location: string;
  duplicate: boolean;
}

export interface BallchasingError {
  status: number;
  message: string;
  duplicateId?: string;
}

export class BallchasingApiError extends Error {
  status: number;
  duplicateId?: string;
  constructor(err: BallchasingError) {
    super(err.message);
    this.name = 'BallchasingApiError';
    this.status = err.status;
    this.duplicateId = err.duplicateId;
  }
}

function getApiKey(): string | null {
  const k = process.env.BALLCHASING_API_KEY;
  return k && k.trim() ? k.trim() : null;
}

export function isBallchasingConfigured(): boolean {
  return getApiKey() !== null;
}

// Ping pour vérifier que la clé est valide. Retourne `null` si OK ou un message
// d'erreur sinon. Utilisé par l'endpoint de diagnostic admin.
export async function pingBallchasing(): Promise<string | null> {
  const key = getApiKey();
  if (!key) return 'BALLCHASING_API_KEY absente';
  try {
    const res = await fetch(`${BALLCHASING_BASE}/`, {
      headers: { Authorization: key },
    });
    if (!res.ok) return `Ballchasing ping HTTP ${res.status}`;
    return null;
  } catch (e) {
    return `Ballchasing ping erreur réseau: ${(e as Error).message}`;
  }
}

// Upload un fichier .replay vers ballchasing. Le replay est mis en `private`
// par défaut (seule notre clé peut le fetch), parfait pour les scrims internes.
export async function uploadReplay(
  buffer: Buffer,
  filename: string,
  opts: { visibility?: 'public' | 'unlisted' | 'private'; groupId?: string } = {},
): Promise<BallchasingUploadResult> {
  const key = getApiKey();
  if (!key) {
    throw new BallchasingApiError({
      status: 0,
      message: 'BALLCHASING_API_KEY absente — upload désactivé',
    });
  }

  const visibility = opts.visibility ?? 'private';
  const params = new URLSearchParams();
  params.set('visibility', visibility);
  if (opts.groupId) params.set('group', opts.groupId);

  // Multipart form-data (ballchasing attend le champ `file`).
  // `new Uint8Array(buffer)` recopie les bytes du Buffer Node dans un
  // Uint8Array "pur" — nécessaire car TS refuse Buffer<ArrayBufferLike>
  // comme BlobPart (à cause du SharedArrayBuffer possible).
  const form = new FormData();
  const blob = new Blob([new Uint8Array(buffer)], { type: 'application/octet-stream' });
  form.append('file', blob, filename);

  const res = await fetch(`${BALLCHASING_BASE}/v2/upload?${params.toString()}`, {
    method: 'POST',
    headers: { Authorization: key },
    body: form,
  });

  // 201 = créé, 409 = doublon (ballchasing renvoie l'id du replay existant)
  if (res.status === 201 || res.status === 409) {
    const json = await res.json().catch(() => ({}));
    const id = typeof json.id === 'string' ? json.id : '';
    if (!id) {
      throw new BallchasingApiError({
        status: res.status,
        message: 'Réponse ballchasing sans id',
      });
    }
    return {
      id,
      location: typeof json.location === 'string' ? json.location : `${BALLCHASING_BASE}/replays/${id}`,
      duplicate: res.status === 409,
    };
  }

  // Erreur — on essaie de récupérer le message
  let message = `Ballchasing HTTP ${res.status}`;
  try {
    const json = await res.json();
    if (typeof json.error === 'string') message = `Ballchasing: ${json.error}`;
    else if (typeof json.chat === 'string') message = `Ballchasing: ${json.chat}`;
  } catch {
    // body pas en JSON
  }
  throw new BallchasingApiError({ status: res.status, message });
}

// Récupère les stats parsées d'un replay (joueurs, scores, durée, map…).
// Peut prendre 5-30s après l'upload pour que ballchasing finisse le parsing —
// le statut passe de "pending" à "ok". Le caller doit gérer le polling.
export interface BallchasingPlayerStats {
  name: string;
  platform: string;
  platformId: string;
  team: 'blue' | 'orange';
  score: number;
  goals: number;
  assists: number;
  saves: number;
  shots: number;
  mvp: boolean;
  mmr?: number;
}

export interface BallchasingReplay {
  id: string;
  status: 'pending' | 'ok' | 'failed';
  mapName: string;
  mapCode: string;
  durationSec: number;
  blueGoals: number;
  orangeGoals: number;
  blueName: string;
  orangeName: string;
  date: string | null;
  players: BallchasingPlayerStats[];
  raw: unknown;
}

function mapPlayer(
  raw: Record<string, unknown>,
  team: 'blue' | 'orange',
): BallchasingPlayerStats {
  const stats = (raw.stats as Record<string, Record<string, unknown>> | undefined) ?? {};
  const core = stats.core ?? {};
  const id = (raw.id as Record<string, unknown> | undefined) ?? {};
  return {
    name: typeof raw.name === 'string' ? raw.name : '',
    platform: typeof id.platform === 'string' ? id.platform : '',
    platformId: typeof id.id === 'string' ? id.id : '',
    team,
    score: typeof core.score === 'number' ? core.score : 0,
    goals: typeof core.goals === 'number' ? core.goals : 0,
    assists: typeof core.assists === 'number' ? core.assists : 0,
    saves: typeof core.saves === 'number' ? core.saves : 0,
    shots: typeof core.shots === 'number' ? core.shots : 0,
    mvp: core.mvp === true,
    mmr: typeof core.mvp_mmr === 'number' ? core.mvp_mmr : undefined,
  };
}

export async function getReplay(replayId: string): Promise<BallchasingReplay> {
  const key = getApiKey();
  if (!key) {
    throw new BallchasingApiError({
      status: 0,
      message: 'BALLCHASING_API_KEY absente — fetch désactivé',
    });
  }

  const res = await fetch(`${BALLCHASING_BASE}/replays/${encodeURIComponent(replayId)}`, {
    headers: { Authorization: key },
  });
  if (!res.ok) {
    throw new BallchasingApiError({
      status: res.status,
      message: `Ballchasing GET replay HTTP ${res.status}`,
    });
  }
  const json = (await res.json()) as Record<string, unknown>;

  const status = typeof json.status === 'string' ? json.status : 'pending';
  const blue = (json.blue as Record<string, unknown> | undefined) ?? {};
  const orange = (json.orange as Record<string, unknown> | undefined) ?? {};
  const bluePlayers = Array.isArray(blue.players) ? blue.players : [];
  const orangePlayers = Array.isArray(orange.players) ? orange.players : [];

  const map = (json.map_code as string | undefined) ?? '';
  const players: BallchasingPlayerStats[] = [
    ...bluePlayers.map(p => mapPlayer(p as Record<string, unknown>, 'blue')),
    ...orangePlayers.map(p => mapPlayer(p as Record<string, unknown>, 'orange')),
  ];

  return {
    id: typeof json.id === 'string' ? json.id : replayId,
    status: (status === 'ok' || status === 'failed' ? status : 'pending') as 'pending' | 'ok' | 'failed',
    mapName: typeof json.map_name === 'string' ? json.map_name : map,
    mapCode: map,
    durationSec: typeof json.duration === 'number' ? json.duration : 0,
    blueGoals: typeof (blue.stats as Record<string, Record<string, unknown>>)?.core?.goals === 'number'
      ? ((blue.stats as Record<string, Record<string, unknown>>).core.goals as number)
      : 0,
    orangeGoals: typeof (orange.stats as Record<string, Record<string, unknown>>)?.core?.goals === 'number'
      ? ((orange.stats as Record<string, Record<string, unknown>>).core.goals as number)
      : 0,
    blueName: typeof blue.name === 'string' ? blue.name : 'Blue',
    orangeName: typeof orange.name === 'string' ? orange.name : 'Orange',
    date: typeof json.date === 'string' ? json.date : null,
    players,
    raw: json,
  };
}

// Supprime un replay (utilisé quand on delete localement). Best effort — on
// loggue mais on ne fait pas planter le delete si ballchasing rate.
export async function deleteReplay(replayId: string): Promise<void> {
  const key = getApiKey();
  if (!key) return;
  await fetch(`${BALLCHASING_BASE}/replays/${encodeURIComponent(replayId)}`, {
    method: 'DELETE',
    headers: { Authorization: key },
  }).catch(() => {
    // best effort
  });
}
