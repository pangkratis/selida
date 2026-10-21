import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSyncExternalStore } from 'react';
import { Appearance, Platform } from 'react-native';
import { logError } from './errorLog';

// 'system' follows the device's light/dark setting.
export type ThemePreference = 'system' | 'light' | 'dark';

const STORAGE_KEY = 'selida.themePreference';

let current: ThemePreference = 'system';
const listeners = new Set<() => void>();

const isPreference = (v: unknown): v is ThemePreference => v === 'system' || v === 'light' || v === 'dark';

// On native, also switch the OS-level scheme for this app so the status bar,
// alerts and the keyboard match; the web only needs our own hook.
const applyToNative = (pref: ThemePreference) => {
  if (Platform.OS !== 'web') Appearance.setColorScheme(pref === 'system' ? null : pref);
};

export const loadThemePreference = async (): Promise<void> => {
  try {
    const stored = await AsyncStorage.getItem(STORAGE_KEY);
    if (isPreference(stored)) current = stored;
  } catch (e) {
    void logError(e, 'theme-preference/load');
  }
  applyToNative(current);
  listeners.forEach(l => l());
};

export const setThemePreference = (pref: ThemePreference): void => {
  current = pref;
  applyToNative(pref);
  listeners.forEach(l => l());
  AsyncStorage.setItem(STORAGE_KEY, pref).catch(e => void logError(e, 'theme-preference/save'));
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};

export const useThemePreference = (): ThemePreference =>
  useSyncExternalStore(subscribe, () => current, () => 'system');
