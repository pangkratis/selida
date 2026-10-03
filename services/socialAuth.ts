import * as QueryParams from 'expo-auth-session/build/QueryParams';
import * as AuthSession from 'expo-auth-session';
import { getLocales } from 'expo-localization';
import * as WebBrowser from 'expo-web-browser';
import { resolveLanguage } from './i18n';
import { supabase } from './supabaseConfig';

/**
 * Google sign-in via Supabase's OAuth provider, opened in an in-app browser
 * rather than a native Google SDK — no extra native module, works the same
 * in Expo Go and a standalone build.
 *
 * This client is NOT configured with `flowType: 'pkce'` (see
 * supabaseConfig.ts), so it uses Supabase's default implicit flow: the
 * callback URL carries access_token/refresh_token directly in the URL
 * FRAGMENT, not a `?code=` to exchange. That's why this reads params via
 * expo-auth-session's QueryParams (which merges query AND hash params) and
 * calls setSession() directly rather than exchangeCodeForSession().
 */

// Required once per app load on web/Expo Go so a browser tab left open by a
// cancelled sign-in doesn't linger — a no-op on native, where the session
// is a proper modal that always resolves (including on cancel).
WebBrowser.maybeCompleteAuthSession();

export class GoogleSignInCancelledError extends Error {
  constructor() {
    super('Google sign-in was cancelled');
    this.name = 'GoogleSignInCancelledError';
  }
}

/**
 * Opens Google's sign-in flow in an in-app browser and establishes the
 * resulting Supabase session.
 *
 * Throws GoogleSignInCancelledError if the user closes the browser without
 * completing sign-in — callers should treat that as a silent no-op, not an
 * error to surface or log.
 */
export async function signInWithGoogle(): Promise<void> {
  const redirectTo = AuthSession.makeRedirectUri();

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo, skipBrowserRedirect: true },
  });
  if (error) throw error;
  if (!data.url) throw new Error('Supabase did not return an OAuth URL');

  const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
  if (result.type !== 'success') {
    throw new GoogleSignInCancelledError();
  }

  const { params, errorCode } = QueryParams.getQueryParams(result.url);
  if (errorCode) throw new Error(errorCode);

  const { access_token, refresh_token } = params;
  if (!access_token || !refresh_token) {
    throw new Error('OAuth callback did not include a session');
  }

  const { data: sessionData, error: sessionError } = await supabase.auth.setSession({ access_token, refresh_token });
  if (sessionError) throw sessionError;
  if (!sessionData.user) throw new Error('setSession succeeded without returning a user');

  await ensureProfileExists(sessionData.user);
}

/**
 * Email/password signup creates the public.users profile via an explicit
 * create_user_profile RPC call right after supabase.auth.signUp() — Google
 * OAuth has no equivalent step, since Supabase silently creates the
 * auth.users row on first login with no signal to the client that this was
 * a brand-new account rather than a returning one. Without this, a new
 * Google user would authenticate successfully but have no profile row —
 * ctx.tsx's _layout.tsx waits indefinitely for one that would never arrive.
 *
 * Defaults mirror signup.tsx's own fallback logic for consistency (country
 * unknown → 'GR', same greek/international + el/en split). Country comes
 * from the device's region rather than a form field, since OAuth skips the
 * manual signup form entirely.
 */
async function ensureProfileExists(user: { id: string; email?: string; user_metadata?: Record<string, any> }): Promise<void> {
  const { data: existing } = await supabase.from('users').select('id').eq('id', user.id).maybeSingle();
  if (existing) return;

  const country = getLocales()[0]?.regionCode ?? 'GR';
  const displayName =
    user.user_metadata?.full_name ?? user.user_metadata?.name ?? user.email?.split('@')[0] ?? 'User';

  const { error } = await supabase.rpc('create_user_profile', {
    p_id: user.id,
    p_email: user.email ?? '',
    p_display_name: displayName,
    p_language: resolveLanguage('device'),
    p_country: country,
    p_catalog_preference: country === 'GR' ? 'greek' : 'international',
  });
  if (error) throw error;
}
