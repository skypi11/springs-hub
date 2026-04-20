import { auth } from './firebase';

// Client API central — attache l'ID token Firebase à chaque requête et
// parse la réponse JSON. Lève une ApiError si le serveur renvoie un statut
// hors 2xx — ça remonte directement dans le `onError` de React Query.
//
// À utiliser via `queryFn` / `mutationFn` dans les hooks useQuery / useMutation.

export class ApiError extends Error {
  status: number;
  payload: unknown;
  constructor(message: string, status: number, payload: unknown) {
    super(message);
    this.status = status;
    this.payload = payload;
  }
}

async function getAuthHeaders(): Promise<Record<string, string>> {
  const token = await auth.currentUser?.getIdToken();
  if (!token) throw new ApiError('Non authentifié', 401, null);
  return { Authorization: `Bearer ${token}` };
}

type JsonBody = Record<string, unknown> | unknown[] | null;

type ApiOptions = {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: JsonBody;
  // signal abort (support du cancel automatique de React Query)
  signal?: AbortSignal;
};

// Requête JSON classique (tout le trafic API de l'app passe par là)
export async function api<T = unknown>(path: string, opts: ApiOptions = {}): Promise<T> {
  const { method = 'GET', body, signal } = opts;
  const headers: Record<string, string> = await getAuthHeaders();
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  const res = await fetch(path, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal,
  });

  let payload: unknown = null;
  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    payload = await res.json().catch(() => null);
  }

  if (!res.ok) {
    const message = (payload as { error?: string } | null)?.error || `HTTP ${res.status}`;
    throw new ApiError(message, res.status, payload);
  }
  return payload as T;
}

// POST multipart (upload de fichiers) — ne force pas Content-Type, le
// navigateur ajoute lui-même le boundary de la FormData.
export async function apiForm<T = unknown>(
  path: string,
  form: FormData,
  opts: { signal?: AbortSignal; onProgress?: (pct: number) => void } = {}
): Promise<T> {
  const headers = await getAuthHeaders();
  if (opts.onProgress) {
    // XHR pour la progression d'upload (fetch ne la donne pas)
    return await new Promise<T>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', path);
      for (const [k, v] of Object.entries(headers)) xhr.setRequestHeader(k, v);
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) opts.onProgress!(Math.round((e.loaded / e.total) * 100));
      };
      xhr.onload = () => {
        let payload: unknown = null;
        try { payload = JSON.parse(xhr.responseText); } catch { /* ignore */ }
        if (xhr.status >= 200 && xhr.status < 300) resolve(payload as T);
        else reject(new ApiError(
          (payload as { error?: string } | null)?.error || `HTTP ${xhr.status}`,
          xhr.status,
          payload,
        ));
      };
      xhr.onerror = () => reject(new ApiError('Erreur réseau', 0, null));
      xhr.onabort = () => reject(new ApiError('Upload annulé', 0, null));
      if (opts.signal) opts.signal.addEventListener('abort', () => xhr.abort());
      xhr.send(form);
    });
  }
  const res = await fetch(path, {
    method: 'POST',
    headers,
    body: form,
    signal: opts.signal,
  });
  const payload = await res.json().catch(() => null);
  if (!res.ok) {
    throw new ApiError(
      (payload as { error?: string } | null)?.error || `HTTP ${res.status}`,
      res.status,
      payload,
    );
  }
  return payload as T;
}

// GET binaire (download d'un doc chiffré qui stream du binaire)
// Retourne soit la réponse JSON, soit le blob selon le Content-Type.
export async function apiDownload(
  path: string,
): Promise<{ kind: 'json'; data: unknown } | { kind: 'blob'; blob: Blob; filename: string | null }> {
  const headers = await getAuthHeaders();
  const res = await fetch(path, { headers });
  if (!res.ok) {
    const payload = await res.json().catch(() => null);
    throw new ApiError(
      (payload as { error?: string } | null)?.error || `HTTP ${res.status}`,
      res.status,
      payload,
    );
  }
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('application/json')) {
    return { kind: 'json', data: await res.json() };
  }
  const disp = res.headers.get('content-disposition') || '';
  const m = disp.match(/filename="?([^";]+)"?/);
  return { kind: 'blob', blob: await res.blob(), filename: m?.[1] ?? null };
}
