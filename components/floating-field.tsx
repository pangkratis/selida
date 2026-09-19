import { BorderRadius, Colors, Spacing, roundedFont } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { Ionicons } from '@expo/vector-icons';
import React, { useState } from 'react';
import {
    KeyboardTypeOptions,
    Text,
    TextInput,
    TextInputProps,
    TouchableOpacity,
    View,
} from 'react-native';

/** Bare visual shell (border, radius, focus ring, label) — reused by the country-picker trigger. */
export function FloatingFieldShell({
    label, focused, accentColor, theme, children,
}: {
    label: string;
    focused: boolean;
    accentColor: string;
    theme: typeof Colors.light;
    children: React.ReactNode;
}) {
    return (
        <View style={{
            backgroundColor: theme.surface,
            borderWidth: 1.5,
            borderColor: focused ? accentColor : theme.border,
            borderRadius: BorderRadius.md,
            paddingHorizontal: Spacing.md,
            paddingTop: 10,
            paddingBottom: 11,
            shadowColor: focused ? accentColor : '#000',
            shadowOffset: { width: 0, height: focused ? 0 : 1 },
            shadowOpacity: focused ? 0.16 : 0.03,
            shadowRadius: focused ? 8 : 2,
            elevation: focused ? 2 : 1,
        }}>
            <Text style={{
                fontSize: 10.5,
                fontWeight: '700',
                fontFamily: roundedFont('700'),
                letterSpacing: 1,
                textTransform: 'uppercase',
                color: focused ? accentColor : theme.secondary,
                marginBottom: 3,
            }}>
                {label}
            </Text>
            {children}
        </View>
    );
}

export default function FloatingField({
    label,
    value,
    onChangeText,
    placeholder,
    keyboardType,
    autoCapitalize,
    autoCorrect,
    secureTextEntry,
    accentColor,
    error,
}: {
    label: string;
    value: string;
    onChangeText: (v: string) => void;
    placeholder?: string;
    keyboardType?: KeyboardTypeOptions;
    autoCapitalize?: TextInputProps['autoCapitalize'];
    autoCorrect?: boolean;
    secureTextEntry?: boolean;
    accentColor: string;
    error?: string;
}) {
    const colorScheme = useColorScheme() ?? 'light';
    const theme = Colors[colorScheme];
    const [focused, setFocused] = useState(false);
    const [hidden, setHidden] = useState(!!secureTextEntry);

    return (
        <View>
            <FloatingFieldShell label={label} focused={focused} accentColor={error ? theme.error : accentColor} theme={theme}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <TextInput
                        style={{ flex: 1, fontSize: 15, fontFamily: roundedFont('500'), color: theme.text, padding: 0 }}
                        value={value}
                        onChangeText={onChangeText}
                        placeholder={placeholder}
                        placeholderTextColor={theme.secondary}
                        onFocus={() => setFocused(true)}
                        onBlur={() => setFocused(false)}
                        keyboardType={keyboardType}
                        autoCapitalize={autoCapitalize}
                        autoCorrect={autoCorrect}
                        secureTextEntry={hidden}
                    />
                    {secureTextEntry && (
                        <TouchableOpacity onPress={() => setHidden((h) => !h)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                            <Ionicons name={hidden ? 'eye-outline' : 'eye-off-outline'} size={18} color={theme.secondary} />
                        </TouchableOpacity>
                    )}
                </View>
            </FloatingFieldShell>
            {error ? (
                <Text style={{ fontSize: 12, fontFamily: roundedFont('500'), color: theme.error, marginTop: 5, marginLeft: 4 }}>
                    {error}
                </Text>
            ) : null}
        </View>
    );
}
