import {
  Nunito_400Regular,
  Nunito_500Medium,
  Nunito_600SemiBold,
  Nunito_700Bold,
  Nunito_800ExtraBold,
  useFonts,
} from '@expo-google-fonts/nunito';
import SplashOverlay from '@/components/splash-overlay';
import '@/services/i18n';
import { Stack, useRouter, useSegments } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect, useState } from 'react';
import { Platform } from 'react-native';
import 'react-native-reanimated';
import { SessionProvider, useSession } from './ctx';

// Hold the splash screen until fonts are loaded and the app is ready to render.
SplashScreen.preventAutoHideAsync();

if (Platform.OS === 'web') {
  require('react-native-web');
}

export const unstable_settings = {
  // Ensure that reloading on `/modal` keeps a back button present.
  initialRouteName: '(tabs)',
};

function Root() {
  const { session, isLoading, user } = useSession();
  const segments = useSegments();
  const router = useRouter();
  const [overlayHidden, setOverlayHidden] = useState(false);

  // Fonts are already loaded by the time Root mounts (see RootLayout below),
  // so hand off from the native splash to the JS-rendered animated overlay
  // immediately — both share the same background + mark, so there's no flash.
  useEffect(() => {
    SplashScreen.hideAsync();
  }, []);

  useEffect(() => {
    console.log('[Layout] useEffect — isLoading:', isLoading, 'session:', session ?? 'null', 'user:', user?.uid ?? 'null', 'segments:', segments);
    if (isLoading) {
      console.log('[Layout] Still loading storage, waiting...');
      return;
    }

    const inAuthGroup = segments[0] === '(auth)';
    const inOnboarding = segments[0] === 'onboarding';
    // Modal/stack screens that can legitimately sit on top of any page — don't redirect while they are focused.
    const inModal = (['book-details', 'book-list', 'books-grid', 'settings', 'catalog-ingestion'] as string[]).includes(segments[0] as string);

    if (!session) {
      console.log('[Layout] No session → redirecting to login');
      if (!inAuthGroup) router.replace('/(auth)/login');
      return;
    }

    // Wait for user profile to load before making onboarding decisions
    if (!user) {
      console.log('[Layout] Session exists but user doc not yet loaded, waiting...');
      return;
    }

    // undefined (existing users) or true = onboarding done
    const onboardingDone = user.onboardingComplete !== false;
    console.log('[Layout] onboardingDone:', onboardingDone, 'inAuthGroup:', inAuthGroup, 'inOnboarding:', inOnboarding);

    if (inAuthGroup) {
      router.replace(onboardingDone ? '/' : '/onboarding');
      return;
    }

    if (inOnboarding && onboardingDone) {
      router.replace('/');
      return;
    }

    if (!inOnboarding && !inModal && !onboardingDone) {
      router.replace('/onboarding');
    }
  }, [session, isLoading, user, segments, router]);

  return (
    <>
      <Stack>
      <Stack.Screen name="(auth)" options={{ headerShown: false }} />
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="onboarding" options={{ headerShown: false, gestureEnabled: false }} />
      <Stack.Screen name="modal" options={{ presentation: 'modal', title: 'Modal' }} />
      <Stack.Screen
        name="book-details"
        options={{
          presentation: 'formSheet',
          sheetAllowedDetents: [0.72, 1.0],
          sheetGrabberVisible: true,
          sheetCornerRadius: 20,
          sheetExpandsWhenScrolledToEdge: false,
          headerShown: false,
        }}
      />
      <Stack.Screen
        name="book-list"
        options={{
          presentation: 'card',
          headerShown: false,
          gestureEnabled: true,
          fullScreenGestureEnabled: true,
        }}
      />
      <Stack.Screen
        name="books-grid"
        options={{
          presentation: 'card',
          headerShown: false,
          gestureEnabled: true,
          fullScreenGestureEnabled: true,
        }}
      />
      <Stack.Screen
        name="settings"
        options={{
          presentation: 'card',
          headerShown: false,
          gestureEnabled: true,
          fullScreenGestureEnabled: true,
        }}
      />
      <Stack.Screen
        name="catalog-ingestion"
        options={{
          presentation: 'card',
          headerShown: false,
          gestureEnabled: true,
          fullScreenGestureEnabled: true,
        }}
      />
      </Stack>
      {!overlayHidden && (
        <SplashOverlay ready={!isLoading} onHidden={() => setOverlayHidden(true)} />
      )}
    </>
  );
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Nunito_400Regular,
    Nunito_500Medium,
    Nunito_600SemiBold,
    Nunito_700Bold,
    Nunito_800ExtraBold,
  });

  // Keep rendering null (behind the splash screen) until fonts are ready.
  // Splash is then hidden by Root once auth state is also resolved.
  // On iOS this resolves almost instantly since ui-rounded is a system font.
  if (!fontsLoaded && !fontError) return null;

  return (
    <SessionProvider>
      <Root />
    </SessionProvider>
  );
}
