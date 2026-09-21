import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

/**
 * A stable, anonymous id for this install, used to follow the signup funnel
 * before there is any account to attribute events to.
 *
 * Deliberately NOT a device fingerprint: it's a random UUID we generate
 * ourselves, it identifies an install rather than a person or a piece of
 * hardware, and it disappears when the app is uninstalled (or browser storage
 * is cleared). Nothing about the device is read to produce it.
 */

const DEVICE_ID_KEY = 'selida.deviceId';

// Cached after the first read so the common case costs nothing. The promise
// itself is cached, not just the value, so concurrent callers during startup
// can't race and generate two different ids.
let cached: Promise<string | null> | null = null;

const readStored = async (): Promise<string | null> => {
  if (Platform.OS === 'web') {
    if (typeof localStorage === 'undefined') return null;
    return localStorage.getItem(DEVICE_ID_KEY);
  }
  return SecureStore.getItemAsync(DEVICE_ID_KEY);
};

const writeStored = async (value: string): Promise<void> => {
  if (Platform.OS === 'web') {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(DEVICE_ID_KEY, value);
    return;
  }
  await SecureStore.setItemAsync(DEVICE_ID_KEY, value);
};

const resolve = async (): Promise<string | null> => {
  try {
    const existing = await readStored();
    if (existing) return existing;

    const generated = Crypto.randomUUID();
    await writeStored(generated);
    return generated;
  } catch {
    // Storage can be unavailable (private browsing, a locked keychain).
    // Analytics must never be the reason the app misbehaves, so callers get
    // null and simply skip the event.
    return null;
  }
};

/** Resolves the install's anonymous id, generating and persisting one on first call. */
export const getDeviceId = (): Promise<string | null> => {
  if (!cached) cached = resolve();
  return cached;
};
