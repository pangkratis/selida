import { COUNTRIES, Country } from '@/constants/countries';
import { AccentPalette, BorderRadius, Colors, Spacing, roundedFont } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { Ionicons } from '@expo/vector-icons';
import React, { useMemo, useState } from 'react';
import {
    FlatList,
    Modal,
    Platform,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from 'react-native';

interface CountryPickerProps {
    visible: boolean;
    onClose: () => void;
    onSelect: (country: Country) => void;
    selectedCode?: string;
}

export default function CountryPicker({ visible, onClose, onSelect, selectedCode }: CountryPickerProps) {
    const colorScheme = useColorScheme() ?? 'light';
    const theme = Colors[colorScheme];
    const accent = AccentPalette[0];
    const [search, setSearch] = useState('');

    const filtered = useMemo(() => {
        if (!search.trim()) return COUNTRIES;
        const term = search.toLowerCase().trim();
        return COUNTRIES.filter(
            c => c.name.toLowerCase().includes(term) || c.code.toLowerCase().includes(term)
        );
    }, [search]);

    const handleClose = () => {
        setSearch('');
        onClose();
    };

    const handleSelect = (country: Country) => {
        onSelect(country);
        handleClose();
    };

    return (
        <Modal
            visible={visible}
            animationType="slide"
            presentationStyle={Platform.OS === 'ios' ? 'pageSheet' : undefined}
            onRequestClose={handleClose}
        >
            <View style={{ flex: 1, backgroundColor: theme.background }}>
                {/* Header */}
                <View style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    paddingHorizontal: Spacing.lg,
                    paddingTop: Platform.OS === 'ios' ? Spacing.lg : Spacing.xl,
                    paddingBottom: Spacing.md,
                    borderBottomWidth: 1,
                    borderBottomColor: theme.border,
                }}>
                    <Text style={{
                        fontSize: 20,
                        fontWeight: '700',
                        color: theme.text,
                        fontFamily: roundedFont('700'),
                    }}>
                        Select Country
                    </Text>
                    <TouchableOpacity
                        onPress={handleClose}
                        style={{
                            width: 36,
                            height: 36,
                            borderRadius: 18,
                            backgroundColor: theme.surface,
                            alignItems: 'center',
                            justifyContent: 'center',
                        }}
                    >
                        <Ionicons name="close" size={20} color={theme.icon} />
                    </TouchableOpacity>
                </View>

                {/* Search */}
                <View style={{
                    paddingHorizontal: Spacing.lg,
                    paddingVertical: Spacing.md,
                }}>
                    <View style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        backgroundColor: theme.surface,
                        borderRadius: BorderRadius.md,
                        borderWidth: 1,
                        borderColor: theme.border,
                        paddingHorizontal: Spacing.md,
                        height: 44,
                        gap: 8,
                    }}>
                        <Ionicons name="search" size={16} color={theme.secondary} />
                        <TextInput
                            style={{
                                flex: 1,
                                fontSize: 15,
                                color: theme.text,
                                fontFamily: roundedFont('400'),
                            }}
                            placeholder="Search countries..."
                            placeholderTextColor={theme.secondary}
                            value={search}
                            onChangeText={setSearch}
                            autoCorrect={false}
                        />
                        {search.length > 0 && (
                            <TouchableOpacity onPress={() => setSearch('')}>
                                <Ionicons name="close-circle" size={16} color={theme.secondary} />
                            </TouchableOpacity>
                        )}
                    </View>
                </View>

                {/* Country List */}
                <FlatList
                    data={filtered}
                    keyExtractor={(item) => item.code}
                    keyboardShouldPersistTaps="handled"
                    contentContainerStyle={{ paddingBottom: 40 }}
                    renderItem={({ item }) => {
                        const isSelected = item.code === selectedCode;
                        return (
                            <TouchableOpacity
                                style={{
                                    flexDirection: 'row',
                                    alignItems: 'center',
                                    paddingHorizontal: Spacing.lg,
                                    paddingVertical: 14,
                                    backgroundColor: isSelected ? accent + '12' : 'transparent',
                                    gap: 14,
                                }}
                                onPress={() => handleSelect(item)}
                                activeOpacity={0.7}
                            >
                                <Text style={{ fontSize: 24 }}>{item.flag}</Text>
                                <Text style={{
                                    flex: 1,
                                    fontSize: 16,
                                    fontWeight: isSelected ? '700' : '400',
                                    color: isSelected ? accent : theme.text,
                                    fontFamily: roundedFont(isSelected ? '700' : '400'),
                                }}>
                                    {item.name}
                                </Text>
                                <Text style={{
                                    fontSize: 13,
                                    color: theme.secondary,
                                    fontFamily: roundedFont('400'),
                                }}>
                                    {item.code}
                                </Text>
                                {isSelected && (
                                    <Ionicons name="checkmark-circle" size={20} color={accent} />
                                )}
                            </TouchableOpacity>
                        );
                    }}
                    ItemSeparatorComponent={() => (
                        <View style={{
                            height: 1,
                            backgroundColor: theme.border,
                            marginLeft: Spacing.lg + 38,
                        }} />
                    )}
                />
            </View>
        </Modal>
    );
}
