import AnimatedLogo from '@/components/animated-logo';
import { clamp, Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import React, { useCallback, useEffect, useState } from 'react';
import { StyleSheet, useWindowDimensions } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

/**
 * Fullscreen brand intro shown while the native splash hands off to JS.
 * Stays visible until the animated logo's intro has fully played AND `ready`
 * is true (auth/session state resolved) — whichever comes later — then
 * cross-fades out and unmounts. Background matches the native splash config
 * in app.json so the handoff is seamless.
 */
export default function SplashOverlay({ ready, onHidden }: { ready: boolean; onHidden: () => void }) {
    const colorScheme = useColorScheme() ?? 'light';
    const theme = Colors[colorScheme];
    const [introDone, setIntroDone] = useState(false);
    const [visible, setVisible] = useState(true);
    const opacity = useSharedValue(1);
    const { width: screenWidth } = useWindowDimensions();
    // 220 was tuned by eye against a mid/large phone — on an iPhone SE (375pt)
    // that's ~59% of the screen width, too big alongside the wordmark below
    // it. Clamped the same way as the tab bar pill / hero cover.
    const logoSize = clamp(170, screenWidth * 0.52, 220);

    const handleIntroEnd = useCallback(() => setIntroDone(true), []);

    useEffect(() => {
        if (introDone && ready) {
            opacity.value = withTiming(0, { duration: 350 });
            const t = setTimeout(() => {
                setVisible(false);
                onHidden();
            }, 350);
            return () => clearTimeout(t);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [introDone, ready]);

    const style = useAnimatedStyle(() => ({ opacity: opacity.value }));

    if (!visible) return null;

    return (
        <Animated.View
            pointerEvents="none"
            style={[styles.container, { backgroundColor: theme.background }, style]}
        >
            <AnimatedLogo size={logoSize} wordmarkColor={theme.text} onIntroEnd={handleIntroEnd} />
        </Animated.View>
    );
}

const styles = StyleSheet.create({
    container: {
        ...StyleSheet.absoluteFillObject,
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 999,
    },
});
