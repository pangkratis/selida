import { useSession } from '@/app/ctx';
import CountryPicker from '@/components/country-picker';
import { useDialog } from '@/components/app-dialog';
import { ThemedText } from '@/components/themed-text';
import { Country, getCountryByCode } from '@/constants/countries';
import { AccentPalette, Colors, Spacing, mixHex, roundedFont } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { ThemePreference, setThemePreference, useThemePreference } from '@/services/theme-preference';
import i18n, { resolveLanguage } from '@/services/i18n';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { logError } from '@/services/errorLog';
import { supabase } from '@/services/supabaseConfig';
import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
    ActivityIndicator,
    ScrollView,
    StyleSheet,
    TextInput,
    TouchableOpacity,
    View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

/* ── Section wrapper ─────────────────────────────────────────────── */

function Section({ label, children }: { label: string; children: React.ReactNode }) {
    const colorScheme = useColorScheme() ?? 'light';
    const theme = Colors[colorScheme];
    return (
        <View style={{ marginBottom: 28 }}>
            <ThemedText style={{
                fontSize: 11,
                fontWeight: '700',
                letterSpacing: 1.2,
                textTransform: 'uppercase',
                color: theme.secondary,
                fontFamily: roundedFont('700'),
                paddingHorizontal: Spacing.xl,
                marginBottom: 8,
            }}>
                {label}
            </ThemedText>
            <View style={{
                marginHorizontal: Spacing.xl,
                backgroundColor: Colors[colorScheme].surface,
                borderRadius: 20,
                overflow: 'hidden',
                shadowColor: '#000',
                shadowOffset: { width: 0, height: 2 },
                shadowOpacity: 0.05,
                shadowRadius: 8,
                elevation: 2,
            }}>
                {children}
            </View>
        </View>
    );
}

/* ── Row ─────────────────────────────────────────────────────────── */

function Row({
    icon,
    iconColor,
    label,
    value,
    onPress,
    destructive = false,
    last = false,
    rightSlot,
}: {
    icon: keyof typeof Ionicons.glyphMap;
    iconColor: string;
    label: string;
    value?: string;
    onPress?: () => void;
    destructive?: boolean;
    last?: boolean;
    rightSlot?: React.ReactNode;
}) {
    const colorScheme = useColorScheme() ?? 'light';
    const theme = Colors[colorScheme];

    return (
        <TouchableOpacity
            onPress={onPress}
            activeOpacity={onPress ? 0.7 : 1}
            style={{
                flexDirection: 'row',
                alignItems: 'center',
                paddingHorizontal: 18,
                paddingVertical: 15,
                borderBottomWidth: last ? 0 : 1,
                borderBottomColor: theme.border,
                gap: 14,
            }}
        >
            <View style={{
                width: 34,
                height: 34,
                borderRadius: 10,
                backgroundColor: iconColor + '18',
                alignItems: 'center',
                justifyContent: 'center',
            }}>
                <Ionicons name={icon} size={17} color={iconColor} />
            </View>

            <ThemedText style={{
                flex: 1,
                fontSize: 15,
                fontWeight: '600',
                fontFamily: roundedFont('600'),
                color: destructive ? theme.error : theme.text,
            }} numberOfLines={1}>
                {label}
            </ThemedText>

            {rightSlot ?? (
                <>
                    {value && (
                        <ThemedText style={{
                            fontSize: 14,
                            color: theme.secondary,
                            fontFamily: roundedFont('400'),
                            maxWidth: 160,
                        }} numberOfLines={1}>
                            {value}
                        </ThemedText>
                    )}
                    {onPress && !destructive && (
                        <Ionicons name="chevron-forward" size={16} color={theme.secondary} />
                    )}
                </>
            )}
        </TouchableOpacity>
    );
}

/* ── Language Segmented Control ──────────────────────────────────── */

type SegmentOption = {
    value: string;
    label: string;
    emoji?: string;
    icon?: React.ComponentProps<typeof Ionicons>['name'];
};

const LANG_OPTIONS: SegmentOption[] = [
    { value: 'en', label: 'English', emoji: '🇬🇧' },
    { value: 'el', label: 'Ελληνικά', emoji: '🇬🇷' },
];

function SegmentedControl({ options, current, onSelect }: {
    options: SegmentOption[];
    current: string;
    onSelect: (v: string) => void;
}) {
    const colorScheme = useColorScheme() ?? 'light';
    const theme = Colors[colorScheme];
    const accent = AccentPalette[1];

    return (
        <View style={{
            flexDirection: 'row',
            backgroundColor: theme.background,
            borderRadius: 12,
            padding: 3,
            gap: 2,
        }}>
            {options.map(opt => {
                const active = current === opt.value;
                return (
                    <TouchableOpacity
                        key={opt.value}
                        onPress={() => onSelect(opt.value)}
                        activeOpacity={0.75}
                        accessibilityRole="button"
                        accessibilityState={{ selected: active }}
                        style={{
                            flex: 1,
                            flexDirection: 'row',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: 5,
                            paddingHorizontal: 10,
                            paddingVertical: 8,
                            borderRadius: 10,
                            backgroundColor: active ? accent : 'transparent',
                        }}
                    >
                        {opt.emoji && <ThemedText style={{ fontSize: 14 }}>{opt.emoji}</ThemedText>}
                        {opt.icon && <Ionicons name={opt.icon} size={15} color={active ? '#fff' : theme.secondary} />}
                        <ThemedText style={{
                            fontSize: 13,
                            fontWeight: '700',
                            fontFamily: roundedFont('700'),
                            color: active ? '#fff' : theme.secondary,
                        }} numberOfLines={1}>
                            {opt.label}
                        </ThemedText>
                    </TouchableOpacity>
                );
            })}
        </View>
    );
}

// Label on its own line with the control full-width below: the options are
// too wide to share a line with the label without truncating it.
function StackedSetting({ icon, label, divider, children }: {
    icon: React.ComponentProps<typeof Ionicons>['name'];
    label: string;
    divider?: boolean;
    children: React.ReactNode;
}) {
    const colorScheme = useColorScheme() ?? 'light';
    const theme = Colors[colorScheme];
    return (
        <View style={{
            paddingHorizontal: 18,
            paddingVertical: 15,
            ...(divider ? { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.border } : {}),
        }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 12 }}>
                <View style={{
                    width: 34,
                    height: 34,
                    borderRadius: 10,
                    backgroundColor: AccentPalette[1] + '18',
                    alignItems: 'center',
                    justifyContent: 'center',
                }}>
                    <Ionicons name={icon} size={17} color={AccentPalette[1]} />
                </View>
                <ThemedText style={{
                    flex: 1,
                    fontSize: 15,
                    fontWeight: '600',
                    fontFamily: roundedFont('600'),
                    color: theme.text,
                }} numberOfLines={1}>
                    {label}
                </ThemedText>
            </View>
            {children}
        </View>
    );
}

/* ── Main Screen ─────────────────────────────────────────────────── */

export default function SettingsScreen() {
    const { t } = useTranslation();
    const router = useRouter();
    const { user, signOut } = useSession();
    const { confirm, alert } = useDialog();
    const colorScheme = useColorScheme() ?? 'light';
    const theme = Colors[colorScheme];
    const themePreference = useThemePreference();

    const headerTint = mixHex(theme.background, AccentPalette[4], colorScheme === 'dark' ? 0.08 : 0.05);

    // Display name editing
    const [editingName, setEditingName] = useState(false);
    const [nameValue, setNameValue] = useState('');
    const [savingName, setSavingName] = useState(false);
    const nameInputRef = useRef<TextInput>(null);

    // Account deletion
    const [deletingAccount, setDeletingAccount] = useState(false);

    useEffect(() => {
        setNameValue(user?.displayName ?? '');
    }, [user?.displayName]);

    const handleEditName = () => {
        setEditingName(true);
        setTimeout(() => nameInputRef.current?.focus(), 50);
    };

    const handleSaveName = async () => {
        const trimmed = nameValue.trim();
        if (!trimmed || !user?.uid || trimmed === user.displayName) {
            setEditingName(false);
            return;
        }
        setSavingName(true);
        try {
            const { error } = await supabase.from('users').update({ displayName: trimmed }).eq('id', user.uid);
            if (error) throw error;
        } catch (e) {
            void logError(e, 'settings/saveDisplayName');
        } finally {
            setSavingName(false);
            setEditingName(false);
        }
    };

    // Country
    const [countryPickerVisible, setCountryPickerVisible] = useState(false);
    const handleCountryChange = async (country: Country) => {
        if (!user?.uid) return;
        try {
            const { error } = await supabase.from('users').update({ country: country.code, language: country.code === 'GR' ? 'el' : 'en' }).eq('id', user.uid);
            if (error) throw error;
        } catch (e) {
            void logError(e, 'settings/updateCountry');
        }
    };

    // Language
    const currentLang = (user as any)?.language ?? 'device';
    const handleLanguageChange = async (value: string) => {
        if (!user?.uid) return;
        try {
            const { error } = await supabase.from('users').update({ language: value }).eq('id', user.uid);
            if (error) throw error;
            i18n.changeLanguage(resolveLanguage(value));
        } catch (e) {
            void logError(e, 'settings/updateLanguage');
        }
    };

    const countryData = getCountryByCode((user as any)?.country);

    const handleSignOut = async () => {
        const confirmed = await confirm({
            icon: 'log-out-outline',
            title: t('settingsSignOutConfirmTitle'),
            message: t('settingsSignOutConfirmMessage'),
            confirmLabel: t('settingsSignOut'),
            cancelLabel: t('cancel'),
        });
        if (confirmed) void signOut();
    };

    const handleDeleteAccount = async () => {
        const confirmed = await confirm({
            icon: 'trash-outline',
            title: t('settingsDeleteAccountConfirmTitle'),
            message: t('settingsDeleteAccountConfirmMessage'),
            confirmLabel: t('settingsDeleteAccount'),
            cancelLabel: t('cancel'),
            destructive: true,
        });
        if (!confirmed) return;

        setDeletingAccount(true);
        try {
            const { error } = await supabase.functions.invoke('delete-account');
            if (error) throw error;
            await signOut();
        } catch (e) {
            void logError(e, 'settings/deleteAccount');
            setDeletingAccount(false);
            await alert({
                icon: 'alert-circle-outline',
                title: t('settingsDeleteAccountError'),
                okLabel: t('dialogOk'),
            });
        }
    };

    if (!user) return null;

    return (
        <SafeAreaView edges={['top', 'bottom']} style={{ flex: 1, backgroundColor: theme.background }}>

            {/* Header */}
            <View style={{
                backgroundColor: headerTint,
                paddingBottom: 24,
                borderBottomLeftRadius: 28,
                borderBottomRightRadius: 28,
                marginBottom: 28,
            }}>
                <View style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    paddingHorizontal: Spacing.xl,
                    paddingTop: Spacing.lg,
                    gap: 12,
                }}>
                    <TouchableOpacity
                        onPress={() => router.back()}
                        style={{
                            width: 38,
                            height: 38,
                            borderRadius: 19,
                            backgroundColor: theme.surface,
                            alignItems: 'center',
                            justifyContent: 'center',
                            shadowColor: '#000',
                            shadowOffset: { width: 0, height: 2 },
                            shadowOpacity: 0.06,
                            shadowRadius: 6,
                            elevation: 2,
                        }}
                    >
                        <Ionicons name="arrow-back" size={18} color={theme.text} />
                    </TouchableOpacity>
                    <ThemedText style={{
                        fontSize: 22,
                        fontWeight: '800',
                        letterSpacing: -0.5,
                        fontFamily: roundedFont('800'),
                    }}>
                        {t('settingsTitle')}
                    </ThemedText>
                </View>
            </View>

            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 48 }}>

                {/* Account */}
                <Section label={t('settingsAccount')}>
                    {/* Display name */}
                    <Row
                        icon="person-outline"
                        iconColor={AccentPalette[1]}
                        label={t('settingsDisplayName')}
                        onPress={handleEditName}
                        rightSlot={
                            editingName ? (
                                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1, justifyContent: 'flex-end' }}>
                                    <TextInput
                                        ref={nameInputRef}
                                        value={nameValue}
                                        onChangeText={setNameValue}
                                        onSubmitEditing={handleSaveName}
                                        returnKeyType="done"
                                        autoCorrect={false}
                                        style={{
                                            fontSize: 14,
                                            color: theme.text,
                                            fontFamily: roundedFont('500'),
                                            textAlign: 'right',
                                            minWidth: 80,
                                            maxWidth: 140,
                                            borderBottomWidth: 1.5,
                                            borderBottomColor: AccentPalette[1],
                                            paddingBottom: 2,
                                        }}
                                    />
                                    {savingName ? (
                                        <ActivityIndicator size="small" color={AccentPalette[1]} />
                                    ) : (
                                        <TouchableOpacity onPress={handleSaveName}>
                                            <Ionicons name="checkmark-circle" size={22} color={AccentPalette[3]} />
                                        </TouchableOpacity>
                                    )}
                                </View>
                            ) : (
                                <>
                                    <ThemedText style={{ fontSize: 14, color: theme.secondary, fontFamily: roundedFont('400') }}>
                                        {user.displayName ?? '—'}
                                    </ThemedText>
                                    <Ionicons name="chevron-forward" size={16} color={theme.secondary} />
                                </>
                            )
                        }
                    />
                    {/* Email */}
                    <Row
                        icon="mail-outline"
                        iconColor={AccentPalette[0]}
                        label={t('settingsEmail')}
                        value={user.email ?? '—'}
                    />
                    {/* Country */}
                    <Row
                        icon="globe-outline"
                        iconColor={AccentPalette[2]}
                        label={t('settingsCountry')}
                        onPress={() => setCountryPickerVisible(true)}
                        last
                        rightSlot={
                            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                                {countryData && (
                                    <ThemedText style={{ fontSize: 16 }}>{countryData.flag}</ThemedText>
                                )}
                                <ThemedText style={{ fontSize: 14, color: theme.secondary, fontFamily: roundedFont('400') }}>
                                    {countryData?.name ?? (user as any)?.country ?? '—'}
                                </ThemedText>
                                <Ionicons name="chevron-forward" size={16} color={theme.secondary} />
                            </View>
                        }
                    />
                </Section>

                {/* Preferences */}
                <Section label={t('settingsPreferences')}>
                    <StackedSetting icon="language-outline" label={t('settingsLanguage')}>
                        <SegmentedControl
                            options={LANG_OPTIONS}
                            current={currentLang === 'device' ? 'en' : currentLang}
                            onSelect={handleLanguageChange}
                        />
                    </StackedSetting>
                    <StackedSetting icon="contrast-outline" label={t('settingsAppearance')} divider>
                        <SegmentedControl
                            options={[
                                { value: 'system', label: t('settingsThemeSystem'), icon: 'phone-portrait-outline' },
                                { value: 'light', label: t('settingsThemeLight'), icon: 'sunny-outline' },
                                { value: 'dark', label: t('settingsThemeDark'), icon: 'moon-outline' },
                            ]}
                            current={themePreference}
                            onSelect={value => setThemePreference(value as ThemePreference)}
                        />
                    </StackedSetting>
                </Section>

                {/* Admin */}
                {(user as any)?.isAdmin && (
                    <Section label={t('settingsAdmin')}>
                        <Row
                            icon="server-outline"
                            iconColor={AccentPalette[1]}
                            label={t('settingsCatalogIngestion')}
                            onPress={() => router.push('/catalog-ingestion')}
                        />
                        <Row
                            icon="albums-outline"
                            iconColor={AccentPalette[3]}
                            label={t('settingsBookTriage')}
                            onPress={() => router.push('/book-triage')}
                            last
                        />
                    </Section>
                )}

                {/* Session */}
                <Section label={t('settingsSession')}>
                    <Row
                        icon="log-out-outline"
                        iconColor={theme.error}
                        label={t('settingsSignOut')}
                        onPress={handleSignOut}
                        destructive
                    />
                    <Row
                        icon="trash-outline"
                        iconColor={theme.error}
                        label={t('settingsDeleteAccount')}
                        onPress={deletingAccount ? undefined : handleDeleteAccount}
                        rightSlot={deletingAccount ? <ActivityIndicator size="small" color={theme.error} /> : undefined}
                        destructive
                        last
                    />
                </Section>

            </ScrollView>

            <CountryPicker
                visible={countryPickerVisible}
                onClose={() => setCountryPickerVisible(false)}
                onSelect={handleCountryChange}
                selectedCode={(user as any)?.country ?? 'GR'}
            />
        </SafeAreaView>
    );
}
