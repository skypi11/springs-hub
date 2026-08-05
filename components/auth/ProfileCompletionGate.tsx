'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { checkProfileCompletion } from '@/lib/profile-completion';
import OnboardingWizard, { isOnboardingSkipped } from '@/components/onboarding/OnboardingWizard';

// Routes toujours accessibles même profil incomplet (sinon on bloque la complétion).
//
// `/mania-cup` en fait partie, et c'est une décision, pas un oubli : le lien de
// la LAN circule sur Discord et sur l'affiche. Quelqu'un qui le suit vient
// s'inscrire à un événement, pas remplir un profil de plateforme — lui opposer
// un questionnaire sur les jeux qu'il pratique et sa disponibilité au
// recrutement, c'est le perdre entre le clic et l'inscription. Le formulaire de
// la LAN demande de toute façon tout ce dont on a besoin, et il en reverse le
// pays et la date de naissance dans le profil.
const ALLOWED_PATHS = ['/settings', '/api', '/mania-cup'];

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
      // eslint-disable-next-line react-hooks/set-state-in-effect -- synchronisation volontaire de showWizard depuis l'état auth/profil/route (sources externes) ; cet effet pilote aussi un redirect router, pas dérivable au render
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
