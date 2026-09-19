import { AccentPalette, Colors, mixHex } from '@/constants/theme';
import React from 'react';
import { StyleSheet, View } from 'react-native';

type Circle = { size: number; top?: number; bottom?: number; left?: number; right?: number; accentIndex: number };

// Positions/sizes adapted from the auth screens mock — purely decorative, clipped to the screen.
const CIRCLES: Circle[] = [
    { top: -100, right: -80, size: 250, accentIndex: 1 },
    { top: 96, left: -96, size: 190, accentIndex: 2 },
    { top: 32, left: 74, size: 74, accentIndex: 0 },
    { top: 250, right: -42, size: 120, accentIndex: 3 },
    { bottom: 96, left: -58, size: 150, accentIndex: 0 },
    { bottom: -52, right: -46, size: 180, accentIndex: 1 },
    { bottom: 186, right: 52, size: 46, accentIndex: 2 },
    { top: 186, left: 26, size: 26, accentIndex: 3 },
];

export default function AuthBackgroundCircles({ theme }: { theme: typeof Colors.light }) {
    return (
        <View pointerEvents="none" style={StyleSheet.absoluteFillObject}>
            {CIRCLES.map((c, i) => (
                <View
                    key={i}
                    style={{
                        position: 'absolute',
                        top: c.top,
                        bottom: c.bottom,
                        left: c.left,
                        right: c.right,
                        width: c.size,
                        height: c.size,
                        borderRadius: c.size / 2,
                        backgroundColor: mixHex(theme.background, AccentPalette[c.accentIndex], 0.4),
                    }}
                />
            ))}
        </View>
    );
}
