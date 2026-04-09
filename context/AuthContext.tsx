'use client';

import React, { createContext, useContext, useEffect, useState } from 'react';
import { onAuthStateChanged, signInWithCustomToken, signOut as firebaseSignOut, User } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { auth, db } from '@/lib/firebase';
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
      // displayName et photoURL sont mis à jour côté serveur à chaque connexion
      setUser({
        uid: fbUser.uid,
        discordId: fbUser.uid.replace('discord_', ''),
        discordUsername: fbUser.displayName ?? '',
        discordAvatar: fbUser.photoURL ?? '',
        displayName: fbUser.displayName ?? '',
      });
      setLoading(false);

      // Enrichissement depuis Firestore en arrière-plan (bio, games, rang, etc.)
      try {
        await fbUser.getIdToken();
        const [snap, adminSnap] = await Promise.all([
          getDoc(doc(db, 'users', fbUser.uid)),
          getDoc(doc(db, 'admins', fbUser.uid)),
        ]);
        if (snap.exists()) {
          setUser({ uid: fbUser.uid, ...snap.data() } as SpringsUser);
        }
        setIsAdmin(adminSnap.exists());
      } catch (err) {
        console.error('[Auth] Firestore read error:', err);
        // L'utilisateur reste connecté grâce aux données Firebase Auth ci-dessus
      }
    });
  }, []);

  function signInWithDiscord() {
    const clientId = '1483592495215673407';
    const redirectUri = encodeURIComponent(`${window.location.origin}/api/auth/discord/callback`);
    window.location.href = `https://discord.com/oauth2/authorize?client_id=${clientId}&redirect_uri=${redirectUri}&response_type=code&scope=identify&state=hub`;
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
