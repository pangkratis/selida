// app/(auth)/signup.tsx
import AuthBackgroundCircles from '@/components/auth-background-circles';
import CountryPicker from '@/components/country-picker';
import FloatingField, { FloatingFieldShell } from '@/components/floating-field';
import { Country, getCountryByCode } from '@/constants/countries';
import { AccentPalette, BorderRadius, Colors, Spacing, roundedFont } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { supabase } from '@/services/supabaseConfig';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

function getPasswordStrength(password: string): { score: number; labelKey: string; color: string } | null {
  if (!password) return null;
  let score = 0;
  if (password.length >= 8) score++;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score++;
  if (/\d/.test(password)) score++;
  if (/[^A-Za-z0-9]/.test(password)) score++;

  if (score <= 1) return { score, labelKey: 'signupPasswordWeak', color: 'error' };
  if (score <= 2) return { score, labelKey: 'signupPasswordMedium', color: 'warning' };
  return { score, labelKey: 'signupPasswordStrong', color: 'success' };
}

export default function SignUpScreen() {
  const { t } = useTranslation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [selectedCountry, setSelectedCountry] = useState('GR');
  const [countryPickerVisible, setCountryPickerVisible] = useState(false);
  const router = useRouter();
  const colorScheme = useColorScheme() ?? 'light';
  const theme = Colors[colorScheme];
  const accent = AccentPalette[1];

  const strength = useMemo(() => getPasswordStrength(password), [password]);
  const strengthColor = strength ? theme[strength.color as 'error' | 'warning' | 'success'] : theme.border;

  const handleSignUp = async () => {
    setAuthError(null);
    if (!email || !password || !displayName) {
      setAuthError(t('signupMissingMsg'));
      return;
    }
    setIsLoading(true);
    try {
      const { data, error } = await supabase.auth.signUp({ email, password });
      if (error) throw error;
      const userId = data.user?.id;
      if (!userId) throw new Error('No user ID returned from signup');

      const { error: profileError } = await supabase.rpc('create_user_profile', {
        p_id: userId,
        p_email: email,
        p_display_name: displayName,
        p_language: selectedCountry === 'GR' ? 'el' : 'en',
        p_country: selectedCountry,
        p_catalog_preference: selectedCountry === 'GR' ? 'greek' : 'international',
      });
      if (profileError) throw profileError;

      router.replace('/onboarding');
    } catch (error: any) {
      setAuthError(error.message);
    } finally {
      setIsLoading(false);
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
            {/* Back button, pinned top-left */}
            <TouchableOpacity
              onPress={() => router.back()}
              activeOpacity={0.7}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: 40, height: 40, borderRadius: 13,
                backgroundColor: theme.surface,
                borderWidth: 1.5, borderColor: theme.border,
                alignItems: 'center', justifyContent: 'center',
                zIndex: 1,
              }}
            >
              <Ionicons name="arrow-back" size={19} color={theme.text} />
            </TouchableOpacity>

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
              <Text style={{ fontSize: 30, fontWeight: '800', lineHeight: 34, color: theme.text, letterSpacing: -0.5, fontFamily: roundedFont('800') }}>
                {t('signupTitle')}
              </Text>
              <Text style={{ fontSize: 14.5, color: theme.secondary, marginTop: Spacing.sm, fontFamily: roundedFont('500') }}>
                {t('signupTagline')}
              </Text>

              {/* Fields */}
              <View style={{ marginTop: Spacing.lg, gap: 12 }}>
                <FloatingField
                  label={t('signupDisplayName')}
                  value={displayName}
                  onChangeText={(v) => { setDisplayName(v); setAuthError(null); }}
                  placeholder={t('signupNamePlaceholder')}
                  autoCapitalize="words"
                  accentColor={accent}
                />
                <FloatingField
                  label={t('signupEmail')}
                  value={email}
                  onChangeText={(v) => { setEmail(v); setAuthError(null); }}
                  placeholder="your@email.com"
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoCorrect={false}
                  accentColor={accent}
                />
                <View>
                  <FloatingField
                    label={t('signupPassword')}
                    value={password}
                    onChangeText={(v) => { setPassword(v); setAuthError(null); }}
                    placeholder="••••••••"
                    secureTextEntry
                    accentColor={accent}
                  />
                  {strength && (
                    <View style={{ marginTop: 8, paddingHorizontal: 2 }}>
                      <View style={{ flexDirection: 'row', gap: 5 }}>
                        {[0, 1, 2, 3].map((i) => (
                          <View
                            key={i}
                            style={{
                              flex: 1,
                              height: 4,
                              borderRadius: 99,
                              backgroundColor: i < strength.score ? strengthColor : theme.border,
                            }}
                          />
                        ))}
                      </View>
                      <Text style={{ fontSize: 11, fontWeight: '600', color: strengthColor, marginTop: 6, fontFamily: roundedFont('600') }}>
                        {t(strength.labelKey)}
                      </Text>
                    </View>
                  )}
                </View>

                <TouchableOpacity onPress={() => setCountryPickerVisible(true)} activeOpacity={0.7}>
                  <FloatingFieldShell label={t('signupCountry')} focused={false} accentColor={accent} theme={theme}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                      <Text style={{ fontSize: 20 }}>{getCountryByCode(selectedCountry)?.flag ?? ''}</Text>
                      <Text style={{ flex: 1, fontSize: 15, color: theme.text, fontFamily: roundedFont('500') }}>
                        {getCountryByCode(selectedCountry)?.name ?? 'Select country'}
                      </Text>
                      <Ionicons name="chevron-down" size={16} color={theme.secondary} />
                    </View>
                  </FloatingFieldShell>
                </TouchableOpacity>
              </View>

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
                onPress={handleSignUp}
                disabled={isLoading}
                activeOpacity={0.85}
              >
                <Text style={{ color: '#fff', fontSize: 16, fontWeight: '700', fontFamily: roundedFont('700') }}>
                  {isLoading ? t('signupLoading') : t('signupButton')}
                </Text>
              </TouchableOpacity>

              <Text style={{ fontSize: 11.5, lineHeight: 17, color: theme.secondary, textAlign: 'center', marginTop: Spacing.md, fontFamily: roundedFont('500') }}>
                {t('signupLegal')}
              </Text>

              {/* Login Link */}
              <View style={{ flexDirection: 'row', justifyContent: 'center', alignItems: 'center', marginTop: Spacing.lg }}>
                <Text style={{ fontSize: 14, color: theme.secondary, fontFamily: roundedFont('500') }}>
                  {t('signupHaveAccount')}{' '}
                </Text>
                <TouchableOpacity onPress={() => router.back()}>
                  <Text style={{ fontSize: 14, fontWeight: '700', color: accent, fontFamily: roundedFont('700') }}>
                    {t('signupLogin')}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>

      <CountryPicker
        visible={countryPickerVisible}
        onClose={() => setCountryPickerVisible(false)}
        onSelect={(country: Country) => setSelectedCountry(country.code)}
        selectedCode={selectedCountry}
      />
    </View>
  );
}
