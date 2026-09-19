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
      console.log('[Auth] User profile not found in DB for uid:', userId);
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
    // Restore existing session on mount
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      if (session) {
        fetchUserProfile(session.user.id).finally(() => setIsLoading(false));
        supabase.from('users').update({ lastLoginAt: new Date().toISOString() }).eq('id', session.user.id).then(() => {});
      } else {
        setIsLoading(false);
      }
    });

    // Listen for auth state changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, newSession) => {
      console.log('[Auth] onAuthStateChange:', _event, 'uid:', newSession?.user?.id ?? 'null');
      setSession(newSession);
      if (newSession) {
        await fetchUserProfile(newSession.user.id);
        supabase.from('users').update({ lastLoginAt: new Date().toISOString() }).eq('id', newSession.user.id).then(() => {});
      } else {
        setUser(null);
      }
      setIsLoading(false);
    });

    return () => subscription.unsubscribe();
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