'use client';

import React, { createContext, useContext, useEffect, useState } from 'react';
import { onAuthStateChanged, signInWithCustomToken, signOut as firebaseSignOut, User } from 'firebase/auth';
import { auth } from '@/lib/firebase';
import type { SpringsUser } from '@/types';

interface AuthContextType {
  user: SpringsUser | null;
  firebaseUser: User | null;
  loading: boolean;
  profileEnriched: boolean;
  isAdmin: boolean;
  signInWithDiscord: (next?: string) => void;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  firebaseUser: null,
  loading: true,
  profileEnriched: false,
  isAdmin: false,
  signInWithDiscord: () => {},
  signOut: async () => {},
  refreshProfile: async () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [user, setUser] = useState<SpringsUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [profileEnriched, setProfileEnriched] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);

  // Handle Discord OAuth callback. Le callback ne met plus le custom token
  // dans l'URL, il le pose dans un cookie httpOnly. On le consomme via
  // GET /api/auth/discord/session. signInWithCustomToken déclenche onAuthStateChanged.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('auth') !== '1') return;

    function cleanUrl() {
      const url = new URL(window.location.href);
      ['auth', 'auth_error'].forEach(p => url.searchParams.delete(p));
      window.history.replaceState({}, '', url.toString());
    }

    fetch('/api/auth/discord/session')
      .then(r => (r.ok ? r.json() : null))
      .then((data: { ft?: string; did?: string; du?: string; da?: string } | null) => {
        if (!data?.ft) {
          cleanUrl();
          return;
        }
        // Affichage optimiste immédiat pendant que signInWithCustomToken s'exécute
        if (data.du && data.did) {
          setUser({
            uid: `discord_${data.did}`,
            discordId: data.did,
            discordUsername: data.du,
            discordAvatar: data.da ?? '',
            displayName: data.du,
          });
        }
        return signInWithCustomToken(auth, data.ft).then(cleanUrl);
      })
      .catch(err => {
        console.error('[Auth] session consume FAILED:', err);
        cleanUrl();
      });
  }, []);

  async function enrichFromApi(fbUser: User) {
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
    } finally {
      setProfileEnriched(true);
    }
  }

  async function refreshProfile() {
    if (!firebaseUser) return;
    await enrichFromApi(firebaseUser);
  }

  useEffect(() => {
    return onAuthStateChanged(auth, async (fbUser) => {
      setFirebaseUser(fbUser);

      if (!fbUser) {
        setUser(null);
        setIsAdmin(false);
        setProfileEnriched(false);
        setLoading(false);
        return;
      }

      // Affichage immédiat depuis Firebase Auth, fonctionne même sans Firestore
      setUser({
        uid: fbUser.uid,
        discordId: fbUser.uid.replace('discord_', ''),
        discordUsername: fbUser.displayName ?? '',
        discordAvatar: fbUser.photoURL ?? '',
        displayName: fbUser.displayName ?? '',
      });
      setProfileEnriched(false);
      setLoading(false);

      await enrichFromApi(fbUser);
    });
  }, []);

  function signInWithDiscord(next?: string) {
    // Le serveur génère le state CSRF et pose le cookie httpOnly avant la
    // redirection vers Discord. Le param `next` (optionnel) sert à préserver
    // la page d'origine : par défaut on capture l'URL courante (pathname +
    // search), nettoyée des query params d'auth pour éviter qu'on retombe
    // sur "?auth_error=..." après login.
    let target: string;
    if (typeof next === 'string') {
      target = next;
    } else if (typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      ['auth', 'auth_error'].forEach(p => url.searchParams.delete(p));
      target = url.pathname + url.search + url.hash;
    } else {
      target = '/';
    }
    const qs = `?next=${encodeURIComponent(target)}`;
    window.location.href = `/api/auth/discord/start${qs}`;
  }

  async function signOut() {
    await firebaseSignOut(auth);
    setUser(null);
    setIsAdmin(false);
  }

  return (
    <AuthContext.Provider value={{ user, firebaseUser, loading, profileEnriched, isAdmin, signInWithDiscord, signOut, refreshProfile }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
