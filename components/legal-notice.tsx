import { Colors, roundedFont, roundedWeight } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { openBrowserAsync } from 'expo-web-browser';
import React from 'react';
import { useTranslation } from 'react-i18next';
import { Text, type StyleProp, type TextStyle } from 'react-native';

export const TERMS_URL = 'https://selida.me/terms.html';
export const PRIVACY_URL = 'https://selida.me/privacy.html';

/**
 * The small "By continuing, you agree to our Terms of Use and acknowledge our
 * Privacy Policy" line under sign-in buttons. Both names are tappable and open
 * the page in the in-app browser.
 */
export default function LegalNotice({ style }: { style?: StyleProp<TextStyle> }) {
    const { t } = useTranslation();
    const colorScheme = useColorScheme() ?? 'light';
    const theme = Colors[colorScheme];

    const link: TextStyle = {
        color: theme.text,
        fontWeight: roundedWeight('600'),
        fontFamily: roundedFont('600'),
        textDecorationLine: 'underline',
    };

    return (
        <Text
            style={[{
                fontSize: 11.5,
                lineHeight: 17,
                color: theme.secondary,
                textAlign: 'center',
                fontFamily: roundedFont('500'),
            }, style]}
        >
            {t('legalPrefix')}
            <Text style={link} onPress={() => void openBrowserAsync(TERMS_URL)} accessibilityRole="link">
                {t('legalTerms')}
            </Text>
            {t('legalMiddle')}
            <Text style={link} onPress={() => void openBrowserAsync(PRIVACY_URL)} accessibilityRole="link">
                {t('legalPrivacy')}
            </Text>
            {t('legalSuffix')}
        </Text>
    );
}
