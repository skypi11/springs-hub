import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';
import { NextRequest, NextResponse } from 'next/server';

// Si Upstash n'est pas configuré (dev local sans .env), on désactive proprement
// le rate limit au lieu de crasher. En prod, les variables sont obligatoires.
const hasUpstash = !!(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN);

const redis = hasUpstash
  ? new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL!,
      token: process.env.UPSTASH_REDIS_REST_TOKEN!,
    })
  : null;

// Sliding window — plus juste qu'un fixed window pour les rafales en bord de fenêtre.
// Préfixes distincts pour ne pas mélanger les compteurs entre profils.
function makeLimiter(prefix: string, requests: number, window: `${number} ${'s' | 'm' | 'h' | 'd'}`) {
  if (!redis) return null;
  return new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(requests, window),
    analytics: true,
    prefix: `springs:${prefix}`,
  });
}

// Profils — chacun cible un type d'usage différent
export const limiters = {
  // OAuth callback : très strict (anti-bruteforce + anti-flood comptes)
  oauth: makeLimiter('oauth', 10, '1 m'),
  // Écritures sensibles (création structure, demande, edit profil)
  write: makeLimiter('write', 30, '1 m'),
  // Actions admin (peuvent être nombreuses pendant une session de modération)
  admin: makeLimiter('admin', 120, '1 m'),
  // Lectures coûteuses (listes paginées, stats externes)
  read: makeLimiter('read', 60, '1 m'),
};

// Récupère l'IP du client — Vercel met x-forwarded-for, fallback sur x-real-ip
function getClientIp(req: NextRequest): string {
  const fwd = req.headers.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0]!.trim();
  const real = req.headers.get('x-real-ip');
  if (real) return real;
  return 'unknown';
}

// Identifiant à rate-limiter : userId si dispo (auth), sinon IP.
// On préfixe avec u: ou ip: pour ne pas qu'un user "vole" le quota d'une IP.
export function rateLimitKey(req: NextRequest, userId?: string | null): string {
  if (userId) return `u:${userId}`;
  return `ip:${getClientIp(req)}`;
}

// Helper haut-niveau : si bloqué, renvoie une NextResponse 429 prête à return.
// Sinon renvoie null (le caller continue normalement).
export async function checkRateLimit(
  limiter: Ratelimit | null,
  key: string
): Promise<NextResponse | null> {
  if (!limiter) return null; // dev local sans Upstash → bypass
  const { success, limit, remaining, reset } = await limiter.limit(key);
  if (success) return null;
  const retryAfter = Math.max(1, Math.ceil((reset - Date.now()) / 1000));
  return NextResponse.json(
    { error: 'Trop de requêtes. Réessaye dans quelques instants.' },
    {
      status: 429,
      headers: {
        'Retry-After': String(retryAfter),
        'X-RateLimit-Limit': String(limit),
        'X-RateLimit-Remaining': String(remaining),
        'X-RateLimit-Reset': String(reset),
      },
    }
  );
}
