import { useSession } from '@/app/ctx';
import { AccentPalette, BorderRadius, Colors, Spacing, roundedFont } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { logError } from '@/services/errorLog';
import { supabase } from '@/services/supabaseConfig';
import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useState } from 'react';
import {
    ActivityIndicator,
    Keyboard,
    Modal,
    Platform,
    Text,
    TextInput,
    TouchableOpacity,
    TouchableWithoutFeedback,
    View,
} from 'react-native';
import Animated, {
    FadeInDown,
    FadeInUp,
    useAnimatedStyle,
    useSharedValue,
    withSpring,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export default function FeedbackButton() {
    const { session } = useSession();
    const colorScheme = useColorScheme() ?? 'light';
    const theme = Colors[colorScheme];
    const insets = useSafeAreaInsets();
    const accent = AccentPalette[0];

    const [modalVisible, setModalVisible] = useState(false);
    const [message, setMessage] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [submitted, setSubmitted] = useState(false);

    const checkmarkScale = useSharedValue(0);

    useEffect(() => {
        if (submitted) {
            checkmarkScale.value = withSpring(1, { damping: 5, stiffness: 180 });
        } else {
            checkmarkScale.value = 0;
        }
    }, [submitted]);

    const checkmarkStyle = useAnimatedStyle(() => ({
        transform: [{ scale: checkmarkScale.value }],
    }));

    if (!session) return null;

    const handleSubmit = async () => {
        const trimmed = message.trim();
        if (!trimmed || submitting) return;

        setSubmitting(true);
        try {
            const { error } = await supabase.from('feedback').insert({
                message: trimmed,
                createdAt: new Date().toISOString(),
                platform: Platform.OS,
            });
            if (error) throw error;
            setMessage('');
            setSubmitted(true);
            setTimeout(() => {
                setSubmitted(false);
                setModalVisible(false);
            }, 1800);
        } catch (error) {
            void logError(error, 'feedback-button/submit');
        } finally {
            setSubmitting(false);
        }
    };

    const handleClose = () => {
        if (submitting) return;
        setMessage('');
        setSubmitted(false);
        setModalVisible(false);
    };

    return (
        <>
            {/* Floating button */}
            <TouchableOpacity
                onPress={() => setModalVisible(true)}
                activeOpacity={0.85}
                style={{
                    position: 'absolute',
                    bottom: insets.bottom + 80,
                    right: Spacing.lg,
                    width: 52,
                    height: 52,
                    borderRadius: 26,
                    backgroundColor: accent,
                    alignItems: 'center',
                    justifyContent: 'center',
                    shadowColor: '#000',
                    shadowOffset: { width: 0, height: 4 },
                    shadowOpacity: 0.15,
                    shadowRadius: 10,
                    elevation: 5,
                    zIndex: 9999,
                }}
            >
                <Ionicons name="chatbubble-outline" size={22} color="#fff" />
            </TouchableOpacity>

            {/* Feedback modal */}
            <Modal
                visible={modalVisible}
                animationType="slide"
                presentationStyle={Platform.OS === 'ios' ? 'pageSheet' : undefined}
                onRequestClose={handleClose}
            >
                <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
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
                                Send Feedback
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

                        {submitted ? (
                            /* Thank you state */
                            <Animated.View
                                entering={FadeInUp.duration(250)}
                                style={{
                                    flex: 1,
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    paddingHorizontal: Spacing.xl,
                                }}
                            >
                                <Animated.View style={checkmarkStyle}>
                                    <Ionicons name="checkmark-circle" size={72} color={accent} />
                                </Animated.View>
                                <Text style={{
                                    fontSize: 18,
                                    fontWeight: '700',
                                    color: theme.text,
                                    fontFamily: roundedFont('700'),
                                    marginTop: Spacing.md,
                                }}>
                                    Thank you!
                                </Text>
                                <Text style={{
                                    fontSize: 14,
                                    color: theme.secondary,
                                    fontFamily: roundedFont('400'),
                                    marginTop: Spacing.xs,
                                    textAlign: 'center',
                                }}>
                                    Your feedback helps us improve Selida.
                                </Text>
                            </Animated.View>
                        ) : (
                            /* Form */
                            <Animated.View
                                entering={FadeInDown.duration(200).springify().damping(18)}
                                style={{ padding: Spacing.lg, flex: 1 }}
                            >
                                <Text style={{
                                    fontSize: 14,
                                    color: theme.secondary,
                                    fontFamily: roundedFont('400'),
                                    marginBottom: Spacing.md,
                                }}>
                                    Tell us what you think, report a bug, or suggest an improvement.
                                </Text>

                                <TextInput
                                    style={{
                                        flex: 1,
                                        maxHeight: 200,
                                        backgroundColor: theme.surface,
                                        borderRadius: BorderRadius.md,
                                        borderWidth: 1,
                                        borderColor: theme.border,
                                        padding: Spacing.md,
                                        fontSize: 15,
                                        color: theme.text,
                                        fontFamily: roundedFont('400'),
                                        textAlignVertical: 'top',
                                    }}
                                    placeholder="Your feedback..."
                                    placeholderTextColor={theme.secondary}
                                    value={message}
                                    onChangeText={setMessage}
                                    multiline
                                    autoFocus
                                />

                                <TouchableOpacity
                                    onPress={handleSubmit}
                                    disabled={submitting || !message.trim()}
                                    activeOpacity={0.85}
                                    style={{
                                        backgroundColor: accent,
                                        borderRadius: BorderRadius.pill,
                                        paddingVertical: 14,
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        marginTop: Spacing.lg,
                                        opacity: submitting || !message.trim() ? 0.5 : 1,
                                    }}
                                >
                                    {submitting ? (
                                        <ActivityIndicator color="#fff" size="small" />
                                    ) : (
                                        <Text style={{
                                            fontSize: 16,
                                            fontWeight: '700',
                                            color: '#fff',
                                            fontFamily: roundedFont('700'),
                                        }}>
                                            Submit
                                        </Text>
                                    )}
                                </TouchableOpacity>
                            </Animated.View>
                        )}
                    </View>
                </TouchableWithoutFeedback>
            </Modal>
        </>
    );
}
