import { ThemedText } from '@/components/themed-text';
import { caps } from '@/constants/text';
import { AccentPalette, BorderRadius, Colors, Spacing, mixHex, roundedFont } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { logError } from '@/services/errorLog';
import { ReaderProfile, fetchReaderProfile } from '@/services/reader-profile';
import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

// The reader type itself is chosen and named in the database
// (get_reader_profile, migration 41; names editable in reader_archetypes /
// reader_flavours). This card only shows it.
const MIX_SLICES = 3;

type IconName = React.ComponentProps<typeof Ionicons>['name'];

type Props = {
    /** Changes whenever the reading list reloads, so the card refreshes with it. */
    refreshKey: unknown;
};

export default function ReaderProfileCard({ refreshKey }: Props) {
    const { t, i18n } = useTranslation();
    const colorScheme = useColorScheme() ?? 'light';
    const theme = Colors[colorScheme];
    const isGreek = i18n.language.startsWith('el');
    const [profile, setProfile] = useState<ReaderProfile | null>(null);

    useEffect(() => {
        let cancelled = false;
        fetchReaderProfile()
            .then(p => { if (!cancelled) setProfile(p); })
            .catch(err => void logError(err, 'reader-profile-card/fetch'));
        return () => { cancelled = true; };
    }, [refreshKey]);

    const view = useMemo(() => {
        if (!profile) return null;
        const fromBooks = profile.source !== 'picks';
        const rt = profile.type;
        const type = rt ? {
            title: `${isGreek ? rt.noun_el : rt.noun_en} ${isGreek ? rt.of_el : rt.of_en}`,
            tagline: isGreek ? rt.tagline_el : rt.tagline_en,
            // An icon name edited in the dashboard might not exist — fall back to a book.
            icon: (rt.icon in Ionicons.glyphMap ? rt.icon : 'book') as IconName,
        } : null;
        const moods = (profile.moods ?? []).map(m => isGreek ? m.label_el : m.label_en);

        // Genre mix: top slices + "other", as shares of the total score.
        const total = profile.genres.reduce((sum, g) => sum + (g.score ?? 0), 0);
        const slices = fromBooks && total > 0
            ? profile.genres.slice(0, MIX_SLICES).map((g, i) => ({
                key: g.slug,
                label: isGreek ? g.name_el : g.name_en,
                share: (g.score ?? 0) / total,
                color: AccentPalette[i % AccentPalette.length],
            }))
            : [];
        const other = 1 - slices.reduce((sum, s) => sum + s.share, 0);
        return { fromBooks, type, moods, slices, other };
    }, [profile, isGreek]);

    if (!profile || !view) return null;

    const accent = AccentPalette[1];
    const ink = mixHex(accent, theme.text, colorScheme === 'dark' ? 0.1 : 0.4);
    const track = mixHex(theme.surface, theme.secondary, colorScheme === 'dark' ? 0.3 : 0.18);
    const pct = (share: number) => `${Math.max(1, Math.round(share * 100))}%`;

    return (
        <View style={{ paddingHorizontal: Spacing.xl, marginTop: Spacing.md }}>
            {/* ── Reader type ─────────────────────────────────── */}
            {/* White card with the same soft shadow as the counts card above it. */}
            <View style={{
                backgroundColor: theme.surface,
                borderRadius: BorderRadius.lg,
                padding: 18,
                shadowColor: '#000',
                shadowOffset: { width: 0, height: 1 },
                shadowOpacity: 0.07,
                shadowRadius: 8,
                elevation: 2,
            }}>
                <ThemedText style={{ fontSize: 12, fontWeight: '800', fontFamily: roundedFont('800'), letterSpacing: 1, color: ink }}>
                    {caps(t('readerTypeEyebrow'))}
                </ThemedText>

                {view.type ? (
                    <>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14, marginTop: 10 }}>
                            <View style={{ width: 52, height: 52, borderRadius: 26, backgroundColor: accent, alignItems: 'center', justifyContent: 'center' }}>
                                <Ionicons name={view.type.icon} size={26} color="#fff" />
                            </View>
                            <View style={{ flex: 1 }}>
                                <ThemedText style={{ fontSize: 22, lineHeight: 27, fontWeight: '800', fontFamily: roundedFont('800'), color: theme.text }}>
                                    {view.type.title}
                                </ThemedText>
                                <ThemedText style={{ fontSize: 14, lineHeight: 19, fontWeight: '500', fontFamily: roundedFont('500'), color: theme.secondary, marginTop: 3 }}>
                                    {view.type.tagline}
                                </ThemedText>
                            </View>
                        </View>

                        {view.moods.length > 0 && (
                            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 14 }}>
                                {view.moods.map(mood => (
                                    <View key={mood} style={{ borderRadius: 12, paddingHorizontal: 10, paddingVertical: 4, backgroundColor: mixHex(theme.surface, accent, colorScheme === 'dark' ? 0.22 : 0.1) }}>
                                        <ThemedText style={{ fontSize: 12.5, fontWeight: '600', fontFamily: roundedFont('600'), color: theme.text }}>
                                            {mood}
                                        </ThemedText>
                                    </View>
                                ))}
                            </View>
                        )}

                        {view.slices.length > 0 && (
                            <View style={{ marginTop: 16 }}>
                                <View style={{ flexDirection: 'row', height: 10, borderRadius: 5, overflow: 'hidden', backgroundColor: track, gap: 2 }}>
                                    {view.slices.map(s => (
                                        <View key={s.key} style={{ flex: s.share, backgroundColor: s.color }} />
                                    ))}
                                    {view.other > 0.005 && <View style={{ flex: view.other, backgroundColor: track }} />}
                                </View>
                                <View style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: 14, rowGap: 6, marginTop: 10 }}>
                                    {view.slices.map(s => (
                                        <View key={s.key} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                                            <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: s.color }} />
                                            <ThemedText style={{ fontSize: 12.5, fontWeight: '600', fontFamily: roundedFont('600'), color: theme.text }}>
                                                {s.label} <ThemedText style={{ fontSize: 12.5, fontWeight: '500', fontFamily: roundedFont('500'), color: theme.secondary }}>{pct(s.share)}</ThemedText>
                                            </ThemedText>
                                        </View>
                                    ))}
                                    {view.other > 0.005 && (
                                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                                            <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: track }} />
                                            <ThemedText style={{ fontSize: 12.5, fontWeight: '500', fontFamily: roundedFont('500'), color: theme.secondary }}>
                                                {t('readerOther')} {pct(view.other)}
                                            </ThemedText>
                                        </View>
                                    )}
                                </View>
                            </View>
                        )}

                        {!view.fromBooks && (
                            <ThemedText style={{ fontSize: 12.5, lineHeight: 17, fontWeight: '500', fontFamily: roundedFont('500'), color: theme.secondary, marginTop: 12 }}>
                                {t('readerTypeFromPicks')}
                            </ThemedText>
                        )}
                    </>
                ) : (
                    <ThemedText style={{ fontSize: 14.5, lineHeight: 20, fontWeight: '500', fontFamily: roundedFont('500'), color: theme.secondary, marginTop: 8 }}>
                        {t('readerTypeEmpty')}
                    </ThemedText>
                )}
            </View>

        </View>
    );
}
