'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { checkProfileCompletion } from '@/lib/profile-completion';
import OnboardingWizard, { isOnboardingSkipped } from '@/components/onboarding/OnboardingWizard';

// Routes toujours accessibles même profil incomplet (sinon on bloque la complétion).
const ALLOWED_PATHS = ['/settings', '/api'];

export default function ProfileCompletionGate() {
  const { user, firebaseUser, loading, profileEnriched } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  // Affichage du wizard : décidé en useEffect après check, persistant tant
  // que l'user ne ferme pas ou ne termine pas le flow.
  const [showWizard, setShowWizard] = useState(false);

  useEffect(() => {
    if (loading) return;
    if (!firebaseUser || !user) return;
    if (!profileEnriched) return;
    // En dev on ne bloque pas, on teste souvent des comptes seedés sans profil complet
    // (les uids `discord_dev_*` n'ont jamais de pays/date de naissance renseignés).
    if (process.env.NODE_ENV === 'development') return;
    const { complete } = checkProfileCompletion(user);
    if (complete) {
      setShowWizard(false);
      return;
    }
    // Profil incomplet : on n'interfère pas si l'utilisateur est déjà sur
    // /settings (il sait ce qu'il fait, et le bandeau y indique les champs
    // manquants) ni si l'API est appelée.
    if (ALLOWED_PATHS.some(p => pathname === p || pathname.startsWith(p + '/'))) {
      setShowWizard(false);
      return;
    }
    // Si l'user a explicitement choisi de skipper l'onboarding, on retombe
    // sur l'ancien comportement (redirect vers /settings) pour qu'il puisse
    // compléter à la main sans être harcelé par le wizard.
    if (isOnboardingSkipped()) {
      router.replace('/settings?complete=1');
      return;
    }
    // Affiche le wizard
    setShowWizard(true);
  }, [firebaseUser, user, loading, profileEnriched, pathname, router]);

  if (!showWizard) return null;
  return <OnboardingWizard onClose={() => setShowWizard(false)} />;
}
