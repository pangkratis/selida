export interface Country {
    code: string;
    name: string;
    flag: string;
}

export const COUNTRIES: Country[] = [
    { code: 'GR', name: 'Greece', flag: '\u{1F1EC}\u{1F1F7}' },
    { code: 'CY', name: 'Cyprus', flag: '\u{1F1E8}\u{1F1FE}' },
    { code: 'US', name: 'United States', flag: '\u{1F1FA}\u{1F1F8}' },
    { code: 'GB', name: 'United Kingdom', flag: '\u{1F1EC}\u{1F1E7}' },
    { code: 'CA', name: 'Canada', flag: '\u{1F1E8}\u{1F1E6}' },
    { code: 'AU', name: 'Australia', flag: '\u{1F1E6}\u{1F1FA}' },
    { code: 'DE', name: 'Germany', flag: '\u{1F1E9}\u{1F1EA}' },
    { code: 'FR', name: 'France', flag: '\u{1F1EB}\u{1F1F7}' },
    { code: 'IT', name: 'Italy', flag: '\u{1F1EE}\u{1F1F9}' },
    { code: 'ES', name: 'Spain', flag: '\u{1F1EA}\u{1F1F8}' },
    { code: 'PT', name: 'Portugal', flag: '\u{1F1F5}\u{1F1F9}' },
    { code: 'NL', name: 'Netherlands', flag: '\u{1F1F3}\u{1F1F1}' },
    { code: 'BE', name: 'Belgium', flag: '\u{1F1E7}\u{1F1EA}' },
    { code: 'AT', name: 'Austria', flag: '\u{1F1E6}\u{1F1F9}' },
    { code: 'CH', name: 'Switzerland', flag: '\u{1F1E8}\u{1F1ED}' },
    { code: 'SE', name: 'Sweden', flag: '\u{1F1F8}\u{1F1EA}' },
    { code: 'NO', name: 'Norway', flag: '\u{1F1F3}\u{1F1F4}' },
    { code: 'DK', name: 'Denmark', flag: '\u{1F1E9}\u{1F1F0}' },
    { code: 'FI', name: 'Finland', flag: '\u{1F1EB}\u{1F1EE}' },
    { code: 'IE', name: 'Ireland', flag: '\u{1F1EE}\u{1F1EA}' },
    { code: 'PL', name: 'Poland', flag: '\u{1F1F5}\u{1F1F1}' },
    { code: 'RO', name: 'Romania', flag: '\u{1F1F7}\u{1F1F4}' },
    { code: 'BG', name: 'Bulgaria', flag: '\u{1F1E7}\u{1F1EC}' },
    { code: 'HR', name: 'Croatia', flag: '\u{1F1ED}\u{1F1F7}' },
    { code: 'RS', name: 'Serbia', flag: '\u{1F1F7}\u{1F1F8}' },
    { code: 'TR', name: 'Turkey', flag: '\u{1F1F9}\u{1F1F7}' },
    { code: 'IN', name: 'India', flag: '\u{1F1EE}\u{1F1F3}' },
    { code: 'JP', name: 'Japan', flag: '\u{1F1EF}\u{1F1F5}' },
    { code: 'BR', name: 'Brazil', flag: '\u{1F1E7}\u{1F1F7}' },
    { code: 'MX', name: 'Mexico', flag: '\u{1F1F2}\u{1F1FD}' },
    { code: 'AR', name: 'Argentina', flag: '\u{1F1E6}\u{1F1F7}' },
    { code: 'ZA', name: 'South Africa', flag: '\u{1F1FF}\u{1F1E6}' },
];

/**
 * Find a country by its code.
 */
export function getCountryByCode(code: string): Country | undefined {
    return COUNTRIES.find(c => c.code === code);
}
