import i18n, { resolveLanguage } from '@/services/i18n';
import { supabase } from '@/services/supabaseConfig';
import { Session } from '@supabase/supabase-js';
import React, { useEffect, useState } from 'react';

interface AppUser {
  uid: string;
  email: string;
  displayName: string;
  language: string;
  country: string;
  catalogPreference?: string;
  preferredSubcategories?: string[];
  onboardingComplete?: boolean;
  isAdmin?: boolean;
}

const AuthContext = React.createContext<{
  signIn: () => void;
  signOut: () => void;
  user: AppUser | null;
  session: Session | null;
  isLoading: boolean;
}>({
  signIn: () => null,
  signOut: () => null,
  user: null,
  session: null,
  isLoading: false,
});

export function useSession() {
  const value = React.useContext(AuthContext);
  if (process.env.NODE_ENV !== 'production') {
    if (!value) throw new Error('useSession must be wrapped in a <SessionProvider />');
  }
  return value;
}

export function SessionProvider(props: React.PropsWithChildren) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<AppUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const fetchUserProfile = async (userId: string, retries = 3): Promise<void> => {
    const { data, error } = await supabase.from('users').select('*').eq('id', userId).single();
    if (error || !data) {
      if (retries > 0) {
        await new Promise(res => setTimeout(res, 1500));
        return fetchUserProfile(userId, retries - 1);
      }
      if (__DEV__) console.log('[Auth] User profile not found in DB for uid:', userId);
      setUser(null);
      return;
    }
    if (data) {
      const profile: AppUser = {
        uid: data.id,
        email: data.email ?? '',
        displayName: data.displayName ?? '',
        language: data.language ?? 'en',
        country: data.country ?? 'GR',
        catalogPreference: data.catalogPreference ?? 'international',
        preferredSubcategories: data.preferredSubcategories ?? [],
        onboardingComplete: data.onboardingComplete ?? false,
        isAdmin: data.isAdmin ?? false,
      };
      setUser(profile);
      i18n.changeLanguage(resolveLanguage(profile.language));
    }
  };

  useEffect(() => {
    // Session restoration relies SOLELY on onAuthStateChange, which fires its
    // own INITIAL_SESSION event with the restored session immediately on
    // registration (confirmed in @supabase/auth-js's GoTrueClient source).
    // A separate explicit `getSession()` call used to run alongside this —
    // removed because both routes internally through the exact same
    // `_acquireLock` mutex, so the two calls contended for one lock on every
    // cold start. That contention, with no timeout anywhere in this chain,
    // could leave `isLoading` stuck `true` forever on first launch — the
    // splash screen (gated on `!isLoading`) would then never dismiss, and
    // only a full app restart (fresh JS engine, fresh lock state) recovered.
    // It also meant fetchUserProfile() and the lastLoginAt update both ran
    // twice on every cold start, once from each path.
    let resolved = false;

    // Safety net independent of the root cause above: guarantees the splash
    // can never hang forever even if some other awaited call stalls.
    const failsafe = setTimeout(() => {
      if (!resolved) {
        if (__DEV__) console.log('[Auth] Timed out waiting for auth to resolve — unblocking splash anyway');
        resolved = true;
        setIsLoading(false);
      }
    }, 8000);

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, newSession) => {
      if (__DEV__) console.log('[Auth] onAuthStateChange:', _event, 'uid:', newSession?.user?.id ?? 'null');
      setSession(newSession);
      if (newSession) {
        await fetchUserProfile(newSession.user.id);
        supabase.from('users').update({ lastLoginAt: new Date().toISOString() }).eq('id', newSession.user.id).then(() => {});
      } else {
        setUser(null);
      }
      resolved = true;
      clearTimeout(failsafe);
      setIsLoading(false);
    });

    return () => {
      clearTimeout(failsafe);
      subscription.unsubscribe();
    };
  }, []);

  // Real-time user profile updates
  useEffect(() => {
    if (!session?.user.id) return;
    const userId = session.user.id;

    const channel = supabase
      .channel(`user-profile-${userId}-${Date.now()}`)
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'users',
        filter: `id=eq.${userId}`,
      }, (payload) => {
        const data = payload.new as any;
        const profile: AppUser = {
          uid: data.id,
          email: data.email ?? '',
          displayName: data.displayName ?? '',
          language: data.language ?? 'en',
          country: data.country ?? 'GR',
          catalogPreference: data.catalogPreference ?? 'international',
          preferredSubcategories: data.preferredSubcategories ?? [],
          onboardingComplete: data.onboardingComplete ?? false,
          isAdmin: data.isAdmin ?? false,
        };
        setUser(profile);
        i18n.changeLanguage(resolveLanguage(profile.language));
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [session?.user.id]);

  return (
    <AuthContext.Provider value={{
      signIn: () => {},
      signOut: async () => {
        await supabase.auth.signOut();
        setSession(null);
        setUser(null);
      },
      session,
      user,
      isLoading,
    }}>
      {props.children}
    </AuthContext.Provider>
  );
}