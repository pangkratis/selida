// Port of the Claude Design splash export (#export-splash) to Reanimated + SVG.
//
// IMPORTANT DEPARTURE FROM THE ORIGINAL: the HTML animation unfolds the 5
// colored petals from a collapsed "bud" (scale 0.45, rotate 0) over ~1.8s
// before the wordmark appears. That reveal only works in the HTML because
// there is nothing shown before it starts.
//
// In the app, the OS-level native splash (app.json → expo-splash-screen)
// shows the fully-ASSEMBLED static mark before this component ever mounts.
// If this component started from the collapsed bud, the handoff would jump
// backward — assembled logo → collapsed stub → re-unfold — which reads as
// two unrelated splash screens rather than one continuous experience.
//
// So here, every petal renders at its FINAL angle/scale/opacity from frame
// one (visually matching the native splash and assets/images/selida-mark.png
// exactly), and the "life" comes from a single quick arrival pulse on the
// whole mark, not a per-petal unfold. Colors, angles, and the ambient
// shimmer-loop stagger/curve are still taken directly from the original.
import { roundedFont } from '@/constants/theme';
import React, { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
    Easing,
    useAnimatedStyle,
    useSharedValue,
    withDelay,
    withRepeat,
    withSequence,
    withTiming,
} from 'react-native-reanimated';
import Svg, { Polygon } from 'react-native-svg';

// ── Reference geometry (from the 300×180 box in the HTML export) ───────────
const REF_WIDTH = 300;
const REF_PIVOT_Y = 158; // petal top(32) + height(104) + pivot gap(22)
const REF_PETAL_W = 34;
const REF_PETAL_H = 104;
const REF_PIVOT_GAP = 22;

const COLORED_PETALS = [
    { color: '#2D8FD5', angle: -62, shimmerStagger: 0 },
    { color: '#34C759', angle: -31, shimmerStagger: 180 },
    { color: '#F7C81F', angle: 0, shimmerStagger: 360 },
    { color: '#C07ED6', angle: 31, shimmerStagger: 540 },
    { color: '#F25577', angle: 62, shimmerStagger: 720 },
];
const DARK_COLOR = '#3A403C';
const DARK_ANGLES = [-85, 85];

const SHIMMER_EASE = Easing.inOut(Easing.ease); // matches the original sl-traverse ease-in-out
const ARRIVE_OUT = Easing.out(Easing.cubic);
const ARRIVE_SETTLE = Easing.inOut(Easing.quad);
const WORD_EASE = Easing.bezier(0, 0, 0.58, 1); // matches the original sl-word ease-out

// Timeline: arrival pulse (0–480ms) → wordmark fades up (350–800ms) →
// ambient shimmer begins per-petal shortly after (staggered, loops forever).
const ARRIVE_UP_MS = 260;
const ARRIVE_SETTLE_MS = 220;
const WORD_DELAY_MS = 350;
const WORD_DURATION_MS = 450;
const SHIMMER_BASE_DELAY_MS = 950;
export const INTRO_END_MS = WORD_DELAY_MS + WORD_DURATION_MS; // 800ms — full brand beat, no forced long wait

function PetalShape({ color, petalW, petalH }: { color: string; petalW: number; petalH: number }) {
    return (
        <Svg width={petalW} height={petalH} viewBox={`0 0 ${petalW} ${petalH}`}>
            <Polygon points={`0,0 ${petalW},0 ${petalW * 0.7},${petalH} ${petalW * 0.3},${petalH}`} fill={color} />
        </Svg>
    );
}

function Petal({
    color, angle, k, pivotX, pivotY, shimmerStagger,
}: {
    color: string; angle: number; k: number; pivotX: number; pivotY: number; shimmerStagger?: number;
}) {
    const petalW = REF_PETAL_W * k;
    const petalH = REF_PETAL_H * k;
    const radius = (REF_PETAL_H + REF_PIVOT_GAP) * k;

    const wrapperStyle = {
        position: 'absolute' as const,
        left: pivotX - petalW / 2,
        top: pivotY - radius,
        width: petalW,
        height: radius * 2,
        transform: [{ rotate: `${angle}deg` }],
    };

    // Hooks must run unconditionally (same order every render) even though
    // dark petals never actually animate — the shimmer branch below is a
    // no-op for them (shimmerStagger stays undefined for a given instance's
    // whole lifetime, so the effect simply never schedules anything).
    const opacity = useSharedValue(1);

    useEffect(() => {
        if (shimmerStagger === undefined) return;
        opacity.value = withDelay(
            SHIMMER_BASE_DELAY_MS + shimmerStagger,
            withRepeat(
                withSequence(
                    withTiming(0.22, { duration: 484, easing: SHIMMER_EASE }),
                    withTiming(0.22, { duration: 396 }),
                    withTiming(1, { duration: 484, easing: SHIMMER_EASE }),
                    withTiming(1, { duration: 836 }),
                ),
                -1,
                false,
            ),
        );
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const animatedStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));

    return (
        <Animated.View style={[wrapperStyle, animatedStyle]}>
            <PetalShape color={color} petalW={petalW} petalH={petalH} />
        </Animated.View>
    );
}

export default function AnimatedLogo({
    size = 220,
    showWordmark = true,
    wordmarkColor,
    onIntroEnd,
}: {
    size?: number;
    showWordmark?: boolean;
    wordmarkColor?: string;
    onIntroEnd?: () => void;
}) {
    const k = size / REF_WIDTH;
    const boxHeight = 180 * k;
    const pivotX = size / 2;
    const pivotY = REF_PIVOT_Y * k;

    const arriveScale = useSharedValue(1);
    const wordOpacity = useSharedValue(0);
    const wordTranslateY = useSharedValue(8 * k);

    useEffect(() => {
        // A single quick "it just came alive" pulse on the whole assembled
        // mark — no shape change, so it stays visually identical to the
        // native splash's static frame at every instant, just briefly larger.
        arriveScale.value = withSequence(
            withTiming(1.06, { duration: ARRIVE_UP_MS, easing: ARRIVE_OUT }),
            withTiming(1, { duration: ARRIVE_SETTLE_MS, easing: ARRIVE_SETTLE }),
        );
        wordOpacity.value = withDelay(WORD_DELAY_MS, withTiming(1, { duration: WORD_DURATION_MS, easing: WORD_EASE }));
        wordTranslateY.value = withDelay(WORD_DELAY_MS, withTiming(0, { duration: WORD_DURATION_MS, easing: WORD_EASE }));

        if (onIntroEnd) {
            const t = setTimeout(onIntroEnd, INTRO_END_MS);
            return () => clearTimeout(t);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const boxStyle = useAnimatedStyle(() => ({
        width: size,
        height: boxHeight,
        transform: [{ scale: arriveScale.value }],
    }));

    const wordStyle = useAnimatedStyle(() => ({
        opacity: wordOpacity.value,
        transform: [{ translateY: wordTranslateY.value }],
    }));

    return (
        <View style={styles.container}>
            <Animated.View style={boxStyle}>
                {DARK_ANGLES.map((angle) => (
                    <Petal key={`dark-${angle}`} color={DARK_COLOR} angle={angle} k={k} pivotX={pivotX} pivotY={pivotY} />
                ))}
                {COLORED_PETALS.map((p) => (
                    <Petal
                        key={p.color}
                        color={p.color}
                        angle={p.angle}
                        shimmerStagger={p.shimmerStagger}
                        k={k}
                        pivotX={pivotX}
                        pivotY={pivotY}
                    />
                ))}
            </Animated.View>
            {showWordmark && (
                <Animated.Text
                    style={[
                        styles.wordmark,
                        { fontSize: size * 0.3, marginTop: -6 * k, color: wordmarkColor ?? '#2A332C' },
                        wordStyle,
                    ]}
                >
                    selida
                </Animated.Text>
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    container: { alignItems: 'center' },
    wordmark: {
        fontFamily: roundedFont('800'),
        fontWeight: '800',
        letterSpacing: -1,
    },
});
