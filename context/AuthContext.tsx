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

  // Handle Discord OAuth callback tokens from URL
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const ft = params.get('ft');
    const did = params.get('did');
    const du = params.get('du');
    const da = params.get('da');

    if (ft) {
      signInWithCustomToken(auth, ft).then(async (cred) => {
        if (did && du) {
          await upsertUserProfile(cred.user, { discordId: did, discordUsername: du, discordAvatar: da || '' });
        }
        // Clean URL
        const url = new URL(window.location.href);
        ['ft', 'did', 'du', 'da', 'auth_error'].forEach(p => url.searchParams.delete(p));
        window.history.replaceState({}, '', url.toString());
      }).catch(console.error);
    }
  }, []);

  // Firebase auth state listener
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (fbUser) => {
      setFirebaseUser(fbUser);
      if (fbUser) {
        const profile = await loadUserProfile(fbUser);
        setUser(profile);
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
      if (snap.exists()) {
        return { uid: fbUser.uid, ...snap.data() } as SpringsUser;
      }
      return null;
    } catch {
      return null;
    }
  }

  async function upsertUserProfile(fbUser: User, discordData: { discordId: string; discordUsername: string; discordAvatar: string }) {
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
  }

  function signInWithDiscord() {
    const clientId = process.env.NEXT_PUBLIC_DISCORD_CLIENT_ID;
    const redirectUri = encodeURIComponent(`${window.location.origin}/api/auth/discord/callback`);
    const state = 'hub';
    window.location.href = `https://discord.com/oauth2/authorize?client_id=${clientId}&redirect_uri=${redirectUri}&response_type=code&scope=identify&state=${state}`;
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
