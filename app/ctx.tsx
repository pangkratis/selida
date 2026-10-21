import { logError } from '@/services/errorLog';
import i18n, { resolveLanguage } from '@/services/i18n';
import { supabase } from '@/services/supabaseConfig';
import { Session } from '@supabase/supabase-js';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

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

const toAppUser = (data: any): AppUser => ({
  uid: data.id,
  email: data.email ?? '',
  displayName: data.displayName ?? '',
  language: data.language ?? 'en',
  country: data.country ?? 'GR',
  catalogPreference: data.catalogPreference ?? 'international',
  preferredSubcategories: data.preferredSubcategories ?? [],
  onboardingComplete: data.onboardingComplete ?? false,
  isAdmin: data.isAdmin ?? false,
});

export function SessionProvider(props: React.PropsWithChildren) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<AppUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  // The user whose profile we should be showing; lets a slow fetch for a
  // previous user (or after sign-out) be thrown away instead of applied.
  const activeUserId = useRef<string | null>(null);
  const failsafeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchUserProfile = useCallback(async (userId: string, retries = 3): Promise<boolean> => {
    const { data, error } = await supabase.from('users').select('*').eq('id', userId).single();
    if (activeUserId.current !== userId) return false;
    if (error || !data) {
      if (retries > 0) {
        await new Promise(res => setTimeout(res, 1500));
        return fetchUserProfile(userId, retries - 1);
      }
      void logError(error ?? new Error('user profile row not found'), 'auth/fetchUserProfile');
      return false;
    }
    const profile = toAppUser(data);
    setUser(profile);
    i18n.changeLanguage(resolveLanguage(profile.language));
    return true;
  }, []);

  const loadProfile = useCallback(async (userId: string) => {
    const loaded = await fetchUserProfile(userId);
    if (activeUserId.current !== userId) return;
    if (failsafeTimer.current) clearTimeout(failsafeTimer.current);
    setIsLoading(false);
    if (loaded) {
      supabase.from('users').update({ lastLoginAt: new Date().toISOString() }).eq('id', userId).then(() => {});
    }
  }, [fetchUserProfile]);

  useEffect(() => {
    // Session restoration relies SOLELY on onAuthStateChange, which fires its
    // own INITIAL_SESSION event with the restored session immediately on
    // registration (confirmed in @supabase/auth-js's GoTrueClient source).
    // A separate explicit `getSession()` call used to run alongside this and
    // contended with it on cold start, which could leave the splash stuck.
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

    failsafeTimer.current = failsafe;

    // This callback must stay synchronous and must not await any other
    // Supabase call. The library awaits it while it is still initialising
    // (for example while refreshing an expired token at cold start), and a
    // request made from inside it waits for that same initialisation: a
    // deadlock, after which the profile never loaded and Home showed "Reader"
    // forever. The profile is loaded by the effect below instead.
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, newSession) => {
      if (__DEV__) console.log('[Auth] onAuthStateChange:', _event, 'uid:', newSession?.user?.id ?? 'null');
      setSession(newSession);
      if (!newSession) {
        setUser(null);
        resolved = true;
        clearTimeout(failsafe);
        setIsLoading(false);
      }
    });

    return () => {
      clearTimeout(failsafe);
      subscription.unsubscribe();
    };
  }, []);

  // Load the profile whenever the signed-in user changes (cold start, sign-in,
  // sign-up). Token refreshes keep the same user id and do not reload it.
  const userId = session?.user.id ?? null;
  useEffect(() => {
    activeUserId.current = userId;
    if (!userId) return;
    void loadProfile(userId);
  }, [userId, loadProfile]);

  // A profile that failed to load (no network at launch, say) is retried when
  // the app comes back to the foreground, instead of leaving Home empty.
  const hasProfile = !!user;
  useEffect(() => {
    if (!userId || hasProfile) return;
    const sub = AppState.addEventListener('change', state => {
      if (state === 'active') void loadProfile(userId);
    });
    return () => sub.remove();
  }, [userId, hasProfile, loadProfile]);

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
        const profile = toAppUser(payload.new);
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