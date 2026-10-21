import { useThemePreference } from '@/services/theme-preference';
import { useColorScheme as useSystemColorScheme } from 'react-native';

// The scheme every screen themes itself with: the user's choice from Settings,
// or the device's setting when that choice is "system".
export function useColorScheme() {
  const system = useSystemColorScheme();
  const preference = useThemePreference();
  return preference === 'system' ? system : preference;
}
