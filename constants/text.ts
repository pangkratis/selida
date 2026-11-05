// Uppercase without accents: Greek capitals drop the tonos (ΒΗΜΑ, not ΒΉΜΑ),
// which textTransform: 'uppercase' and toUpperCase() don't do. Use this for
// any label shown in capitals.
export const caps = (text: string) =>
    text.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
