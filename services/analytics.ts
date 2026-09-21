import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { getDeviceId } from './deviceId';
import { supabase } from './supabaseConfig';

/**
 * App-level (non-book) event logging → the `appEvents` table.
 *
 * First-party only, no analytics SDK — same reasoning as services/errorLog.ts.
 * Book-attached events live in services/userActivity.ts instead; this file
 * deliberately handles the events that must work with NO signed-in user, so
 * the pre-signup funnel is visible.
 *
 * Every function is best-effort and never throws.
 */

export type AppEvent =
  // Lifecycle
  | 'app_open'
  | 'screen_view'
  // Pre-auth funnel — these fire with userId null
  | 'signup_started'
  | 'signup_completed'
  | 'signup_failed'
  | 'login_started'
  | 'login_completed'
  | 'login_failed'
  // Onboarding funnel
  | 'onboarding_started'
  | 'onboarding_gate_reached'
  | 'onboarding_complete'
  // Discovery
  | 'search_performed';

/**
 * Record an app-level event.
 *
 * `userId` is resolved from the cached session rather than passed in, so a
 * caller can never accidentally attribute an event to the wrong user, and
 * pre-auth events correctly record null instead of being dropped.
 */
export const logEvent = async (
  event: AppEvent,
  context?: string,
  metadata?: Record<string, unknown>
): Promise<void> => {
  try {
    const deviceId = await getDeviceId();
    // No device id means storage is unavailable; the row would fail the
    // not-null constraint anyway, so skip rather than throw.
    if (!deviceId) return;

    const { data } = await supabase.auth.getSession();

    await supabase.from('appEvents').insert({
      deviceId,
      userId: data.session?.user?.id ?? null,
      event,
      context: context ?? null,
      metadata: metadata ?? null,
      platform: Platform.OS,
      appVersion: Constants.expoConfig?.version ?? null,
      createdAt: new Date().toISOString(),
    });
  } catch {
    // Analytics must never break the flow it is measuring.
  }
};

/**
 * Records a search and how many results came back. Zero-result searches are
 * the highest-value signal here — they name the books people want that the
 * catalog doesn't have yet.
 */
export const logSearch = (query: string, resultCount: number): Promise<void> => {
  const trimmed = query.trim();
  if (!trimmed) return Promise.resolve();
  return logEvent('search_performed', 'search', {
    // Capped so a pathological paste can't write an unbounded string.
    query: trimmed.slice(0, 200),
    resultCount,
  });
};

// Consecutive duplicates are dropped: expo-router re-reports the same path on
// param changes and re-renders, which would otherwise inflate screen counts.
let lastScreen: string | null = null;

/** Records a screen view, ignoring a repeat of the screen already recorded. */
export const logScreenView = (path: string): Promise<void> => {
  if (!path || path === lastScreen) return Promise.resolve();
  lastScreen = path;
  return logEvent('screen_view', path.slice(0, 200));
};
