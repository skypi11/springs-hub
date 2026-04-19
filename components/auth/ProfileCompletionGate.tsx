'use client';

import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { checkProfileCompletion } from '@/lib/profile-completion';

// Routes toujours accessibles même profil incomplet (sinon on bloque la complétion).
const ALLOWED_PATHS = ['/settings', '/api'];

export default function ProfileCompletionGate() {
  const { user, firebaseUser, loading, profileEnriched } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (loading) return;
    if (!firebaseUser || !user) return;
    if (!profileEnriched) return;
    // En dev on ne bloque pas — on teste souvent des comptes seedés sans profil complet
    // (les uids `discord_dev_*` n'ont jamais de pays/date de naissance renseignés).
    if (process.env.NODE_ENV === 'development') return;
    const { complete } = checkProfileCompletion(user);
    if (complete) return;
    if (ALLOWED_PATHS.some(p => pathname === p || pathname.startsWith(p + '/'))) return;
    router.replace('/settings?complete=1');
  }, [firebaseUser, user, loading, profileEnriched, pathname, router]);

  return null;
}
