import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { supabase } from './supabaseConfig';

/**
 * Self-hosted error reporting — writes to the `errorLogs` table in our own
 * Supabase project rather than a third-party crash reporter, so the privacy
 * policy's "no crash-reporting trackers" promise stays accurate.
 *
 * Every function here is best-effort and must NEVER throw: an error in the
 * error reporter that propagates would take down whatever it was reporting on.
 */

// Matches the check constraints in migration_15. Truncating here keeps a long
// stack from being rejected outright by the database and lost entirely.
const MAX_MESSAGE = 2000;
const MAX_STACK = 10000;
const MAX_CONTEXT = 200;

// A render-loop error can fire continuously. Without throttling, one broken
// screen could write thousands of near-identical rows (and burn quota) before
// the user even closes the app.
const DEDUPE_WINDOW_MS = 60_000;
const MAX_REPORTS_PER_LAUNCH = 25;

const recentlySent = new Map<string, number>();
let reportsThisLaunch = 0;

const truncate = (value: string, max: number) =>
  value.length > max ? `${value.slice(0, max - 1)}…` : value;

/** Pulls a readable message + stack out of whatever was thrown. */
const describe = (error: unknown): { message: string; stack: string | null } => {
  if (error instanceof Error) {
    return { message: error.message || error.name || 'Unknown error', stack: error.stack ?? null };
  }
  if (typeof error === 'string') return { message: error, stack: null };
  try {
    return { message: JSON.stringify(error) ?? 'Unknown error', stack: null };
  } catch {
    return { message: String(error), stack: null };
  }
};

type LogErrorOptions = {
  /** true when the error crashed a React subtree (ErrorBoundary), rather than being caught and handled. */
  fatal?: boolean;
};

/**
 * Report an error for later triage. Safe to call from anywhere, including
 * inside a `catch` — it resolves rather than rejects on failure.
 *
 * @param error   the thrown value
 * @param context where it happened, e.g. 'ErrorBoundary' or 'services/recommendations'
 */
export const logError = async (
  error: unknown,
  context: string,
  options: LogErrorOptions = {}
): Promise<void> => {
  try {
    const { message, stack } = describe(error);

    // Surface it locally too — in development this is still the fastest
    // feedback loop; in a release build it's a no-op that costs nothing.
    if (__DEV__) console.error(`[${context}]`, error);

    if (reportsThisLaunch >= MAX_REPORTS_PER_LAUNCH) return;

    const key = `${context}:${message}`;
    const now = Date.now();
    const lastSent = recentlySent.get(key);
    if (lastSent !== undefined && now - lastSent < DEDUPE_WINDOW_MS) return;
    recentlySent.set(key, now);
    reportsThisLaunch += 1;

    // Read from the locally cached session rather than getUser(), which
    // would make a network call — pointless overhead when reporting an error
    // that may itself be a network failure.
    const { data } = await supabase.auth.getSession();
    const userId = data.session?.user?.id ?? null;

    await supabase.from('errorLogs').insert({
      userId,
      message: truncate(message, MAX_MESSAGE),
      stack: stack ? truncate(stack, MAX_STACK) : null,
      context: truncate(context, MAX_CONTEXT),
      fatal: options.fatal ?? false,
      platform: Platform.OS,
      appVersion: Constants.expoConfig?.version ?? null,
      createdAt: new Date().toISOString(),
    });
  } catch {
    // Deliberately silent. If reporting fails there is nowhere left to
    // report it to, and throwing here would mask the original error.
  }
};

/**
 * Fire-and-forget wrapper for use at call sites that aren't async, e.g.
 * `doThing().catch(reportError('services/foo'))`.
 */
export const reportError = (context: string, options?: LogErrorOptions) => (error: unknown) => {
  void logError(error, context, options);
};
