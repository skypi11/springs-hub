'use client';

import React, { createContext, useContext, useEffect, useState } from 'react';
import { onAuthStateChanged, signInWithCustomToken, signOut as firebaseSignOut, User } from 'firebase/auth';
import { auth } from '@/lib/firebase';
import type { SpringsUser } from '@/types';

interface AuthContextType {
  user: SpringsUser | null;
  firebaseUser: User | null;
  loading: boolean;
  isAdmin: boolean;
  signInWithDiscord: () => void;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  firebaseUser: null,
  loading: true,
  isAdmin: false,
  signInWithDiscord: () => {},
  signOut: async () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [user, setUser] = useState<SpringsUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);

  // Handle Discord OAuth callback — signInWithCustomToken déclenche onAuthStateChanged
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const ft = params.get('ft');
    const did = params.get('did');
    const du = params.get('du');
    const da = params.get('da');

    if (!ft) return;

    // Affichage optimiste immédiat pendant que signInWithCustomToken s'exécute
    if (du && did) {
      setUser({
        uid: `discord_${did}`,
        discordId: did,
        discordUsername: du,
        discordAvatar: da ?? '',
        displayName: du,
      });
    }

    signInWithCustomToken(auth, ft)
      .then(() => {
        const url = new URL(window.location.href);
        ['ft', 'did', 'du', 'da', 'auth_error'].forEach(p => url.searchParams.delete(p));
        window.history.replaceState({}, '', url.toString());
      })
      .catch(err => console.error('[Auth] signInWithCustomToken FAILED:', err.code, err.message));
  }, []);

  useEffect(() => {
    return onAuthStateChanged(auth, async (fbUser) => {
      setFirebaseUser(fbUser);

      if (!fbUser) {
        setUser(null);
        setIsAdmin(false);
        setLoading(false);
        return;
      }

      // Affichage immédiat depuis Firebase Auth — fonctionne même sans Firestore
      setUser({
        uid: fbUser.uid,
        discordId: fbUser.uid.replace('discord_', ''),
        discordUsername: fbUser.displayName ?? '',
        discordAvatar: fbUser.photoURL ?? '',
        displayName: fbUser.displayName ?? '',
      });
      setLoading(false);

      // Enrichissement via API serveur (pas Firestore client — évite les erreurs de permissions)
      try {
        const idToken = await fbUser.getIdToken();
        const res = await fetch('/api/auth/me', {
          headers: { 'Authorization': `Bearer ${idToken}` },
        });

        if (res.ok) {
          const data = await res.json();
          if (data.user) {
            setUser({ uid: fbUser.uid, ...data.user } as SpringsUser);
          }
          setIsAdmin(data.isAdmin ?? false);
        }
      } catch (err) {
        console.error('[Auth] API /auth/me error:', err);
        // L'utilisateur reste connecté grâce aux données Firebase Auth ci-dessus
      }
    });
  }, []);

  function signInWithDiscord() {
    // Le serveur génère le state CSRF et pose le cookie httpOnly avant la redirection vers Discord
    window.location.href = '/api/auth/discord/start';
  }

  async function signOut() {
    await firebaseSignOut(auth);
    setUser(null);
    setIsAdmin(false);
  }

  return (
    <AuthContext.Provider value={{ user, firebaseUser, loading, isAdmin, signInWithDiscord, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
