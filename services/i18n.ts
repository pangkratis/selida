import { getLocales } from 'expo-localization';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import el from '@/locales/el';
import en from '@/locales/en';

const SUPPORTED = ['en', 'el'] as const;
type SupportedLang = (typeof SUPPORTED)[number];

const deviceLocale = getLocales()[0]?.languageCode ?? 'en';
const deviceLang: SupportedLang = (SUPPORTED as readonly string[]).includes(deviceLocale)
    ? (deviceLocale as SupportedLang)
    : 'en';

/** Resolves a stored preference ('en' | 'el' | 'device') to an actual language code. */
export function resolveLanguage(pref: string | undefined | null): SupportedLang {
    if (!pref || pref === 'device') return deviceLang;
    return (SUPPORTED as readonly string[]).includes(pref) ? (pref as SupportedLang) : 'en';
}

i18n.use(initReactI18next).init({
    resources: {
        en: { translation: en },
        el: { translation: el },
    },
    lng: deviceLang,
    fallbackLng: 'en',
    interpolation: { escapeValue: false },
});

export default i18n;
