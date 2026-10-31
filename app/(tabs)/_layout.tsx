import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { Tabs } from 'expo-router';
import React from 'react';
import { useTranslation } from 'react-i18next';
import { useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { HapticTab } from '@/components/haptic-tab';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { getTabBarIslandWidth, TAB_BAR_ISLAND_GAP, TAB_BAR_ISLAND_HEIGHT } from '@/constants/tab-bar';
import { AccentPalette, Colors, mixHex } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

/**
 * Every tab always shows its own accent color, so the bar stays readable in
 * dark mode (the old grey inactive icons nearly vanished on the dark surface).
 * The focused tab is a solid accent circle with a white filled glyph; the
 * others show their outline glyph in a slightly muted version of their color.
 * A plain background + borderRadius renders the same on iOS and Android (the
 * old iOS-only inset `boxShadow` capsule was what Android drew as a square).
 */
function TabIcon({ name, filledName, focused, accent }: {
  name: React.ComponentProps<typeof IconSymbol>['name'];
  filledName: React.ComponentProps<typeof IconSymbol>['name'];
  focused: boolean;
  accent: string;
}) {
  const colorScheme = useColorScheme() ?? 'light';
  const theme = Colors[colorScheme];
  const muted = mixHex(theme.surface, accent, colorScheme === 'dark' ? 0.78 : 0.7);

  return (
    <View style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}>
      {/* Mounted only while focused: on Android, switching an existing view's
          background from transparent to a color dropped its borderRadius and
          drew a square. A freshly mounted circle always keeps its rounding. */}
      {focused && (
        <View style={{ position: 'absolute', width: 44, height: 44, borderRadius: 22, backgroundColor: accent }} />
      )}
      <IconSymbol size={focused ? 22 : 24} name={focused ? filledName : name} color={focused ? '#fff' : muted} />
    </View>
  );
}

/**
 * Custom tab bar renderer instead of a `tabBarStyle` override.
 *
 * react-navigation's own absolute-positioning of `tabBarStyle` doesn't
 * reliably center a fixed-width bar (tried `left:'50%'` + negative margin,
 * then + `transform`, then a pixel `left` computed from screen width — all
 * rendered pinned near the left edge instead of centered). Rendering our own
 * full-width wrapper with `alignItems: 'center'` sidesteps the issue
 * entirely: flexbox centers the fixed-width pill correctly regardless of
 * whatever width react-navigation's container actually resolves to.
 */
function FloatingTabBar({ state, descriptors, navigation }: BottomTabBarProps) {
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme ?? 'light'];
  const insets = useSafeAreaInsets();
  const { width: screenWidth } = useWindowDimensions();
  const islandWidth = getTabBarIslandWidth(screenWidth);

  return (
    <View
      pointerEvents="box-none"
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: insets.bottom + TAB_BAR_ISLAND_GAP,
        alignItems: 'center',
      }}>
      <View
        style={{
          flexDirection: 'row',
          width: islandWidth,
          height: TAB_BAR_ISLAND_HEIGHT,
          borderRadius: TAB_BAR_ISLAND_HEIGHT / 2,
          backgroundColor: theme.surface,
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 6 },
          shadowOpacity: 0.18,
          shadowRadius: 16,
          elevation: 10,
        }}>
        {state.routes.map((route, index) => {
          const { options } = descriptors[route.key];
          const isFocused = state.index === index;
          const activeColor = options.tabBarActiveTintColor ?? theme.tint;
          const inactiveColor = options.tabBarInactiveTintColor ?? theme.tabIconDefault;

          const onPress = () => {
            const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
            if (!isFocused && !event.defaultPrevented) {
              navigation.navigate(route.name, route.params);
            }
          };

          const onLongPress = () => {
            navigation.emit({ type: 'tabLongPress', target: route.key });
          };

          return (
            <HapticTab
              key={route.key}
              accessibilityRole="button"
              accessibilityState={isFocused ? { selected: true } : {}}
              accessibilityLabel={options.tabBarAccessibilityLabel}
              testID={options.tabBarButtonTestID}
              onPress={onPress}
              onLongPress={onLongPress}
              style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
              {options.tabBarIcon?.({ focused: isFocused, color: isFocused ? activeColor : inactiveColor, size: 24 })}
            </HapticTab>
          );
        })}
      </View>
    </View>
  );
}

export default function TabLayout() {
  const { t } = useTranslation();
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme ?? 'light'];

  return (
    <Tabs
      tabBar={(props) => <FloatingTabBar {...props} />}
      screenOptions={{
        tabBarActiveTintColor: theme.tint,
        tabBarInactiveTintColor: theme.tabIconDefault,
        headerShown: false,
      }}>
      <Tabs.Screen
        name="index"
        options={{
          title: t('tabHome'),
          tabBarActiveTintColor: AccentPalette[1],
          tabBarIcon: ({ focused }) => (
            <TabIcon name="house" filledName="house.fill" focused={focused} accent={AccentPalette[1]} />
          ),
        }}
      />
      <Tabs.Screen
        name="explore"
        options={{
          title: t('tabExplore'),
          tabBarActiveTintColor: AccentPalette[4],
          tabBarIcon: ({ focused }) => (
            <TabIcon name="safari" filledName="safari.fill" focused={focused} accent={AccentPalette[4]} />
          ),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: t('tabProfile'),
          tabBarActiveTintColor: AccentPalette[3],
          tabBarIcon: ({ focused }) => (
            <TabIcon name="person" filledName="person.fill" focused={focused} accent={AccentPalette[3]} />
          ),
        }}
      />
    </Tabs>
  );
}
