'use client';

import React, { createContext, useContext, useEffect, useState } from 'react';
import { onAuthStateChanged, signInWithCustomToken, signOut as firebaseSignOut, User } from 'firebase/auth';
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
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

  // Handle Discord OAuth callback — signInWithCustomToken uniquement
  // Toutes les opérations Firestore sont dans onAuthStateChanged
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const ft = params.get('ft');
    const did = params.get('did');
    const du = params.get('du');
    const da = params.get('da');

    if (ft) {
      // Affichage immédiat pendant que Firebase Auth traite
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
          // Nettoyer l'URL — Firestore sera géré par onAuthStateChanged
          const url = new URL(window.location.href);
          ['ft', 'did', 'du', 'da', 'auth_error'].forEach(p => url.searchParams.delete(p));
          window.history.replaceState({}, '', url.toString());
        })
        .catch(err => console.error('[Auth] signInWithCustomToken FAILED:', err.code, err.message));
    }
  }, []);

  // Toutes les opérations Firestore ici — Firebase garantit que le token est prêt
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (fbUser) => {
      setFirebaseUser(fbUser);

      if (fbUser) {
        // Récupérer les params Discord depuis l'URL si présents (login en cours)
        const params = new URLSearchParams(window.location.search);
        const did = params.get('did');
        const du = params.get('du');
        const da = params.get('da');
        const isFreshLogin = !!params.get('ft');

        if (isFreshLogin && did && du) {
          await upsertUserProfile(fbUser, { discordId: did, discordUsername: du, discordAvatar: da || '' });
        } else {
          const profile = await loadUserProfile(fbUser);
          setUser(profile);
        }

        const adminSnap = await getDoc(doc(db, 'admins', fbUser.uid));
        setIsAdmin(adminSnap.exists());
      } else {
        setUser(null);
        setIsAdmin(false);
      }

      setLoading(false);
    });

    return unsub;
  }, []);

  async function loadUserProfile(fbUser: User): Promise<SpringsUser | null> {
    try {
      const snap = await getDoc(doc(db, 'users', fbUser.uid));
      if (snap.exists()) return { uid: fbUser.uid, ...snap.data() } as SpringsUser;
      return null;
    } catch (err) {
      console.error('[Auth] loadUserProfile error:', err);
      return null;
    }
  }

  async function upsertUserProfile(fbUser: User, discordData: { discordId: string; discordUsername: string; discordAvatar: string }) {
    try {
      const ref = doc(db, 'users', fbUser.uid);
      const snap = await getDoc(ref);
      if (!snap.exists()) {
        await setDoc(ref, {
          discordId: discordData.discordId,
          discordUsername: discordData.discordUsername,
          discordAvatar: discordData.discordAvatar,
          displayName: discordData.discordUsername,
          games: [],
          isFan: false,
          createdAt: serverTimestamp(),
        });
      } else {
        await setDoc(ref, {
          discordId: discordData.discordId,
          discordUsername: discordData.discordUsername,
          discordAvatar: discordData.discordAvatar,
        }, { merge: true });
      }
      const updated = await loadUserProfile(fbUser);
      setUser(updated);
    } catch (err) {
      console.error('[Auth] upsertUserProfile error:', err);
    }
  }

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
