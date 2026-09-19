import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { Tabs } from 'expo-router';
import React from 'react';
import { useTranslation } from 'react-i18next';
import { Platform, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { HapticTab } from '@/components/haptic-tab';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { getTabBarIslandWidth, TAB_BAR_ISLAND_GAP, TAB_BAR_ISLAND_HEIGHT } from '@/constants/tab-bar';
import { AccentPalette, Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

/**
 * Capsule rendered behind the focused tab's icon. iOS: a neutral dark-grey
 * "pressed in" fill plus a real INSET shadow via `boxShadow` — the icon
 * glyph itself already carries the accent color, so the capsule doesn't
 * need to. Android: no capsule at all, just the accent-colored icon —
 * Android's `boxShadow`/`inset` rendering has known bugs where it ignores
 * the view's `borderRadius` regardless of `overflow:'hidden'` (the shadow
 * paints as part of the view's own border/background layer, not clippable
 * child content — see react-native-screens#2669 and react-native#48874),
 * rendering as a visible square. Rather than fight that, Android drops the
 * capsule background entirely per explicit request, instead of shipping a
 * broken-looking shadow.
 */
function TabIcon({ name, filledName, focused, color }: {
  name: React.ComponentProps<typeof IconSymbol>['name'];
  filledName: React.ComponentProps<typeof IconSymbol>['name'];
  focused: boolean;
  color: string;
}) {
  const colorScheme = useColorScheme();
  const pressedBackground = colorScheme === 'dark' ? 'rgba(0,0,0,0.32)' : 'rgba(0,0,0,0.09)';
  const pressedShadowColor = colorScheme === 'dark' ? 'rgba(0,0,0,0.55)' : 'rgba(0,0,0,0.3)';
  const pressedHighlightColor = colorScheme === 'dark' ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.6)';

  return (
    <View style={{
      width: 44,
      height: 44,
      borderRadius: 22,
      overflow: 'hidden',
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: focused && Platform.OS === 'ios' ? pressedBackground : 'transparent',
      ...(focused && Platform.OS === 'ios' && {
        boxShadow: [
          { offsetX: 0, offsetY: 2, blurRadius: 5, color: pressedShadowColor, inset: true },
          { offsetX: 0, offsetY: -1, blurRadius: 1.5, color: pressedHighlightColor, inset: true },
        ],
      }),
    }}>
      <IconSymbol size={24} name={focused ? filledName : name} color={color} />
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
            <TabIcon name="house" filledName="house.fill" focused={focused} color={focused ? AccentPalette[1] : theme.tabIconDefault} />
          ),
        }}
      />
      <Tabs.Screen
        name="explore"
        options={{
          title: t('tabExplore'),
          tabBarActiveTintColor: AccentPalette[4],
          tabBarIcon: ({ focused }) => (
            <TabIcon name="safari" filledName="safari.fill" focused={focused} color={focused ? AccentPalette[4] : theme.tabIconDefault} />
          ),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: t('tabProfile'),
          tabBarActiveTintColor: AccentPalette[3],
          tabBarIcon: ({ focused }) => (
            <TabIcon name="person" filledName="person.fill" focused={focused} color={focused ? AccentPalette[3] : theme.tabIconDefault} />
          ),
        }}
      />
    </Tabs>
  );
}
