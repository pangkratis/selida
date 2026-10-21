import { useThemePreference } from '@/services/theme-preference';
import { useEffect, useState } from 'react';
import { useColorScheme as useRNColorScheme } from 'react-native';

/**
 * To support static rendering, this value needs to be re-calculated on the client side for web
 */
export function useColorScheme() {
  const [hasHydrated, setHasHydrated] = useState(false);

  useEffect(() => {
    setHasHydrated(true);
  }, []);

  const system = useRNColorScheme();
  const preference = useThemePreference();

  if (!hasHydrated) return 'light';
  return preference === 'system' ? system : preference;
}
