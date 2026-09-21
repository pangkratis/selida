// app/(auth)/login.tsx
import AuthBackgroundCircles from '@/components/auth-background-circles';
import FloatingField from '@/components/floating-field';
import { AccentPalette, BorderRadius, Colors, Spacing, roundedFont } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { logEvent } from '@/services/analytics';
import { supabase } from '@/services/supabaseConfig';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
    Alert,
    KeyboardAvoidingView,
    Modal,
    Platform,
    Pressable,
    ScrollView,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

export default function LoginScreen() {
    const { t } = useTranslation();
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [authError, setAuthError] = useState<string | null>(null);
    const [resetVisible, setResetVisible] = useState(false);
    const [resetEmail, setResetEmail] = useState('');
    const [resetSending, setResetSending] = useState(false);
    const router = useRouter();
    const colorScheme = useColorScheme() ?? 'light';
    const theme = Colors[colorScheme];
    const accent = AccentPalette[1];

    const handleLogin = async () => {
        setAuthError(null);
        if (!email || !password) {
            setAuthError(t('loginMissingMsg'));
            return;
        }
        setIsLoading(true);
        try {
            logEvent('login_started', 'login');
            const { error } = await supabase.auth.signInWithPassword({ email, password });
            if (error) throw error;
            logEvent('login_completed', 'login');
            router.replace('/');
        } catch (error: any) {
            setAuthError(error.message);
            // A cluster of these on one device is someone locked out —
            // a support signal, not just a metric.
            logEvent('login_failed', 'login', { reason: error?.message ?? 'unknown' });
        } finally {
            setIsLoading(false);
        }
    };

    const openReset = () => {
        setResetEmail(email);
        setResetVisible(true);
    };

    const sendResetEmail = async () => {
        if (!resetEmail) {
            Alert.alert(t('loginResetTitle'), t('loginResetMissing'));
            return;
        }
        setResetSending(true);
        try {
            const { error } = await supabase.auth.resetPasswordForEmail(resetEmail);
            if (error) throw error;
            setResetVisible(false);
            Alert.alert(t('loginResetTitle'), t('loginResetSuccess'));
        } catch (error: any) {
            Alert.alert(t('loginFailedTitle'), error.message);
        } finally {
            setResetSending(false);
        }
    };

    return (
        <View style={{ flex: 1, backgroundColor: theme.background }}>
            <AuthBackgroundCircles theme={theme} />
            <SafeAreaView edges={['top', 'bottom']} style={{ flex: 1 }}>
                <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
                    <ScrollView
                        contentContainerStyle={{ flexGrow: 1, padding: Spacing.lg, justifyContent: 'center' }}
                        keyboardShouldPersistTaps="handled"
                    >
                        <View>
                            {/* Wordmark */}
                            <View style={{ alignItems: 'center', marginBottom: Spacing.xl }}>
                                <Image
                                    source={require('../../assets/images/selida-mark.png')}
                                    style={{ width: 76, height: 76 * (600 / 1040) }}
                                    contentFit="contain"
                                />
                                <Text style={{ fontSize: 26, fontWeight: '700', letterSpacing: -0.3, color: theme.text, marginTop: Spacing.sm, fontFamily: roundedFont('700') }}>
                                    Selida
                                </Text>
                            </View>

                            {/* Headline */}
                            <Text style={{ fontSize: 32, fontWeight: '800', lineHeight: 36, color: theme.text, letterSpacing: -0.5, fontFamily: roundedFont('800') }}>
                                {t('loginTitle')}
                            </Text>
                            <Text style={{ fontSize: 14.5, color: theme.secondary, marginTop: Spacing.sm, fontFamily: roundedFont('500') }}>
                                {t('loginTagline')}
                            </Text>

                            {/* Fields */}
                            <View style={{ marginTop: Spacing.xl, gap: 14 }}>
                                <FloatingField
                                    label={t('loginEmail')}
                                    value={email}
                                    onChangeText={(v) => { setEmail(v); setAuthError(null); }}
                                    placeholder="your@email.com"
                                    keyboardType="email-address"
                                    autoCapitalize="none"
                                    autoCorrect={false}
                                    accentColor={accent}
                                />
                                <FloatingField
                                    label={t('loginPassword')}
                                    value={password}
                                    onChangeText={(v) => { setPassword(v); setAuthError(null); }}
                                    placeholder="••••••••"
                                    secureTextEntry
                                    accentColor={accent}
                                />
                            </View>

                            <TouchableOpacity onPress={openReset} style={{ alignSelf: 'flex-end', marginTop: Spacing.sm }}>
                                <Text style={{ fontSize: 12.5, fontWeight: '600', color: theme.secondary, fontFamily: roundedFont('600') }}>
                                    {t('loginForgotPassword')}
                                </Text>
                            </TouchableOpacity>

                            {authError ? (
                                <Text style={{ fontSize: 13, color: theme.error, marginTop: Spacing.md, textAlign: 'center', fontFamily: roundedFont('500') }}>
                                    {authError}
                                </Text>
                            ) : null}

                            <TouchableOpacity
                                style={{
                                    height: 54,
                                    borderRadius: BorderRadius.pill,
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    marginTop: Spacing.lg,
                                    backgroundColor: accent,
                                    shadowColor: accent,
                                    shadowOffset: { width: 0, height: 8 },
                                    shadowOpacity: 0.32,
                                    shadowRadius: 14,
                                    elevation: 5,
                                    opacity: isLoading ? 0.7 : 1,
                                }}
                                onPress={handleLogin}
                                disabled={isLoading}
                                activeOpacity={0.85}
                            >
                                <Text style={{ color: '#fff', fontSize: 16, fontWeight: '700', fontFamily: roundedFont('700') }}>
                                    {isLoading ? t('loginLoading') : t('loginButton')}
                                </Text>
                            </TouchableOpacity>

                            {/* Sign Up Link */}
                            <View style={{ flexDirection: 'row', justifyContent: 'center', alignItems: 'center', marginTop: Spacing.lg }}>
                                <Text style={{ fontSize: 14, color: theme.secondary, fontFamily: roundedFont('500') }}>
                                    {t('loginNoAccount')}{' '}
                                </Text>
                                <TouchableOpacity onPress={() => router.push('/signup')}>
                                    <Text style={{ fontSize: 14, fontWeight: '700', color: accent, fontFamily: roundedFont('700') }}>
                                        {t('loginCreate')}
                                    </Text>
                                </TouchableOpacity>
                            </View>
                        </View>
                    </ScrollView>
                </KeyboardAvoidingView>
            </SafeAreaView>

            {/* ── Reset password modal ─────────────────────────────── */}
            <Modal visible={resetVisible} transparent animationType="fade" onRequestClose={() => setResetVisible(false)}>
                <Pressable
                    style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center', padding: Spacing.xl }}
                    onPress={() => setResetVisible(false)}
                >
                    <Pressable onPress={() => {}} style={{ width: '100%' }}>
                        <View style={{
                            backgroundColor: theme.surface,
                            borderRadius: BorderRadius.lg,
                            padding: Spacing.lg,
                            shadowColor: '#000',
                            shadowOffset: { width: 0, height: 8 },
                            shadowOpacity: 0.18,
                            shadowRadius: 20,
                            elevation: 10,
                        }}>
                            <Text style={{ fontSize: 18, fontWeight: '700', color: theme.text, fontFamily: roundedFont('700') }}>
                                {t('loginResetTitle')}
                            </Text>
                            <Text style={{ fontSize: 13.5, color: theme.secondary, marginTop: 6, marginBottom: Spacing.md, fontFamily: roundedFont('500') }}>
                                {t('loginResetSubtitle')}
                            </Text>
                            <TextInput
                                style={{
                                    height: 48,
                                    borderWidth: 1.5,
                                    borderColor: theme.border,
                                    borderRadius: BorderRadius.md,
                                    paddingHorizontal: Spacing.md,
                                    fontSize: 15,
                                    fontFamily: roundedFont('400'),
                                    backgroundColor: theme.background,
                                    color: theme.text,
                                }}
                                placeholder="your@email.com"
                                placeholderTextColor={theme.secondary}
                                value={resetEmail}
                                onChangeText={setResetEmail}
                                keyboardType="email-address"
                                autoCapitalize="none"
                                autoCorrect={false}
                            />
                            <View style={{ flexDirection: 'row', gap: 10, marginTop: Spacing.lg }}>
                                <TouchableOpacity
                                    onPress={() => setResetVisible(false)}
                                    style={{ flex: 1, height: 48, borderRadius: BorderRadius.pill, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.background }}
                                    activeOpacity={0.8}
                                >
                                    <Text style={{ fontSize: 15, fontWeight: '600', color: theme.secondary, fontFamily: roundedFont('600') }}>
                                        {t('cancel')}
                                    </Text>
                                </TouchableOpacity>
                                <TouchableOpacity
                                    onPress={sendResetEmail}
                                    disabled={resetSending}
                                    style={{ flex: 1, height: 48, borderRadius: BorderRadius.pill, alignItems: 'center', justifyContent: 'center', backgroundColor: accent, opacity: resetSending ? 0.7 : 1 }}
                                    activeOpacity={0.85}
                                >
                                    <Text style={{ fontSize: 15, fontWeight: '700', color: '#fff', fontFamily: roundedFont('700') }}>
                                        {t('loginResetSend')}
                                    </Text>
                                </TouchableOpacity>
                            </View>
                        </View>
                    </Pressable>
                </Pressable>
            </Modal>
        </View>
    );
}
