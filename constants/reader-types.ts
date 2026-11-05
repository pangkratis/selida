// Reader types for the Profile tab.
//
// A reader type is built from the user's two strongest genres
// (get_reader_profile, migration 39): the noun comes from the top genre and the
// "of …" phrase from the second, e.g. "Detective of Distant Galaxies" /
// "Ντετέκτιβ των μακρινών γαλαξιών". With a single genre, its own phrase is used.
//
// Greek: nouns are deliberately gender-neutral (ο/η φιλόσοφος, ντετέκτιβ,
// γκουρού…) or have a fixed grammatical gender (Καρδιά, Ξωτικό…), and the second
// half is a genitive phrase, so nothing has to agree with the reader's gender.

import { Ionicons } from '@expo/vector-icons';

type IconName = React.ComponentProps<typeof Ionicons>['name'];
type Lang = { en: string; el: string };

export type ReaderArchetype = {
    noun: Lang;
    of: Lang;
    tagline: Lang;
    icon: IconName;
};

export const READER_ARCHETYPES: Record<string, ReaderArchetype> = {
    literature: {
        noun: { en: 'Bookworm', el: 'Βιβλιοφάγος' },
        of: { en: 'of Great Novels', el: 'των μεγάλων μυθιστορημάτων' },
        tagline: { en: 'A good story is all you need.', el: 'Μια καλή ιστορία σού αρκεί.' },
        icon: 'book',
    },
    'crime-thriller': {
        noun: { en: 'Detective', el: 'Ντετέκτιβ' },
        of: { en: 'of Dark Alleys', el: 'των σκοτεινών σοκακιών' },
        tagline: { en: 'You always find out who did it.', el: 'Πάντα βρίσκεις ποιος το έκανε.' },
        icon: 'search',
    },
    'science-fiction': {
        noun: { en: 'Starchild', el: 'Αστρόπαιδο' },
        of: { en: 'of Distant Galaxies', el: 'των μακρινών γαλαξιών' },
        tagline: { en: 'Your head is in the future.', el: 'Το μυαλό σου είναι στο μέλλον.' },
        icon: 'planet',
    },
    fantasy: {
        noun: { en: 'Elf', el: 'Ξωτικό' },
        of: { en: 'of Enchanted Kingdoms', el: 'των μαγεμένων βασιλείων' },
        tagline: { en: 'Dragons over daily news, any day.', el: 'Δράκοι αντί για ειδήσεις, κάθε μέρα.' },
        icon: 'sparkles',
    },
    horror: {
        noun: { en: 'Night Owl', el: 'Νυχτοπούλι' },
        of: { en: 'of Haunted Houses', el: 'των στοιχειωμένων σπιτιών' },
        tagline: { en: 'You read with the lights on.', el: 'Διαβάζεις με αναμμένα φώτα.' },
        icon: 'moon',
    },
    romance: {
        noun: { en: 'Heart', el: 'Καρδιά' },
        of: { en: 'of Great Loves', el: 'των μεγάλων ερώτων' },
        tagline: { en: 'Here for the happy ending.', el: 'Εδώ για το happy end.' },
        icon: 'heart',
    },
    'historical-fiction': {
        noun: { en: 'Chronicler', el: 'Χρονογράφος' },
        of: { en: 'of Bygone Eras', el: 'των περασμένων εποχών' },
        tagline: { en: 'Born in the wrong century.', el: 'Γεννήθηκες σε λάθος αιώνα.' },
        icon: 'hourglass',
    },
    poetry: {
        noun: { en: 'Dreamer', el: 'Ονειροπόλος' },
        of: { en: 'of Verses', el: 'των στίχων' },
        tagline: { en: 'Few words, big feelings.', el: 'Λίγες λέξεις, μεγάλα συναισθήματα.' },
        icon: 'pencil',
    },
    drama: {
        noun: { en: 'Muse', el: 'Μούσα' },
        of: { en: 'of the Stage', el: 'της σκηνής' },
        tagline: { en: 'All the world’s a stage.', el: 'Όλος ο κόσμος μια σκηνή.' },
        icon: 'happy',
    },
    comics: {
        noun: { en: 'Superkid', el: 'Σουπερπαιδί' },
        of: { en: 'of Colourful Panels', el: 'των πολύχρωμων καρέ' },
        tagline: { en: 'Pictures speak louder.', el: 'Οι εικόνες μιλούν πιο δυνατά.' },
        icon: 'flash',
    },
    childrens: {
        noun: { en: 'Fairy', el: 'Νεράιδα' },
        of: { en: 'of Fairy Tales', el: 'των παραμυθιών' },
        tagline: { en: 'Once upon a time, every time.', el: 'Μια φορά κι έναν καιρό, κάθε φορά.' },
        icon: 'balloon',
    },
    'young-adult': {
        noun: { en: 'Wild Spirit', el: 'Ατίθασο Πνεύμα' },
        of: { en: 'of Coming of Age', el: 'της ενηλικίωσης' },
        tagline: { en: 'Every page is a first time.', el: 'Κάθε σελίδα, μια πρώτη φορά.' },
        icon: 'flame',
    },
    'biography-memoir': {
        noun: { en: 'Witness', el: 'Μάρτυρας' },
        of: { en: 'of Real Lives', el: 'των αληθινών ζωών' },
        tagline: { en: 'Real lives beat fiction.', el: 'Οι αληθινές ζωές ξεπερνούν τη μυθοπλασία.' },
        icon: 'person',
    },
    history: {
        noun: { en: 'Historian', el: 'Ιστορικός' },
        of: { en: 'of Ancient Empires', el: 'των αρχαίων αυτοκρατοριών' },
        tagline: { en: 'The past is your playground.', el: 'Το παρελθόν είναι η παιδική σου χαρά.' },
        icon: 'library',
    },
    philosophy: {
        noun: { en: 'Philosopher', el: 'Φιλόσοφος' },
        of: { en: 'of Big Questions', el: 'των μεγάλων ερωτημάτων' },
        tagline: { en: 'Why? is your favourite word.', el: 'Το «γιατί;» είναι η αγαπημένη σου λέξη.' },
        icon: 'bulb',
    },
    'psychology-self-help': {
        noun: { en: 'Curious Mind', el: 'Ανήσυχο Μυαλό' },
        of: { en: 'of Inner Worlds', el: 'των εσωτερικών κόσμων' },
        tagline: { en: 'Always working on yourself.', el: 'Πάντα δουλεύεις τον εαυτό σου.' },
        icon: 'infinite',
    },
    'religion-spirituality': {
        noun: { en: 'Old Soul', el: 'Αρχαία Ψυχή' },
        of: { en: 'of Quiet Wisdom', el: 'της ήσυχης σοφίας' },
        tagline: { en: 'You read slowly and deeply.', el: 'Διαβάζεις αργά και βαθιά.' },
        icon: 'leaf',
    },
    'science-nature': {
        noun: { en: 'Naturalist', el: 'Φυσιοδίφης' },
        of: { en: 'of Wild Nature', el: 'της άγριας φύσης' },
        tagline: { en: 'Curious about how everything works.', el: 'Θες να ξέρεις πώς δουλεύουν όλα.' },
        icon: 'flask',
    },
    technology: {
        noun: { en: 'Robot', el: 'Ρομπότ' },
        of: { en: 'of the Future', el: 'του μέλλοντος' },
        tagline: { en: 'Beep boop, one more chapter.', el: 'Μπιπ μπουπ, ένα κεφάλαιο ακόμα.' },
        icon: 'hardware-chip',
    },
    'business-economics': {
        noun: { en: 'Strategist', el: 'Στρατηγός' },
        of: { en: 'of Bold Ideas', el: 'των τολμηρών ιδεών' },
        tagline: { en: 'Every book is an investment.', el: 'Κάθε βιβλίο είναι μια επένδυση.' },
        icon: 'trending-up',
    },
    'politics-society': {
        noun: { en: 'Citizen', el: 'Πολίτης' },
        of: { en: 'of the World', el: 'του κόσμου' },
        tagline: { en: 'Reading to change the world.', el: 'Διαβάζεις για να αλλάξεις τον κόσμο.' },
        icon: 'globe',
    },
    'health-wellbeing': {
        noun: { en: 'Guru', el: 'Γκουρού' },
        of: { en: 'of Good Vibes', el: 'της καλής ενέργειας' },
        tagline: { en: 'Body, mind and a good book.', el: 'Σώμα, μυαλό κι ένα καλό βιβλίο.' },
        icon: 'fitness',
    },
    'art-culture': {
        noun: { en: 'Aesthete', el: 'Εστέτ' },
        of: { en: 'of Beautiful Things', el: 'των ωραίων πραγμάτων' },
        tagline: { en: 'Life is too short for ugly books.', el: 'Η ζωή είναι μικρή για άσχημα βιβλία.' },
        icon: 'color-palette',
    },
    'food-travel': {
        noun: { en: 'Nomad', el: 'Νομάς' },
        of: { en: 'of Faraway Places', el: 'των μακρινών τόπων' },
        tagline: { en: 'Your passport is a library card.', el: 'Το διαβατήριό σου είναι τα βιβλία.' },
        icon: 'airplane',
    },
    sports: {
        noun: { en: 'Team Spirit', el: 'Ομαδικό Πνεύμα' },
        of: { en: 'of the Finish Line', el: 'του τερματισμού' },
        tagline: { en: 'Reading marathons only.', el: 'Μόνο μαραθώνιοι ανάγνωσης.' },
        icon: 'trophy',
    },
};

export type ReaderType = {
    title: string;
    tagline: string;
    icon: IconName;
    topSlug: string;
};

/** Builds the reader type from genre slugs ordered strongest first. */
export function buildReaderType(slugs: string[], isGreek: boolean): ReaderType | null {
    const known = slugs.filter(s => READER_ARCHETYPES[s]);
    if (known.length === 0) return null;
    const lang = isGreek ? 'el' : 'en';
    const top = READER_ARCHETYPES[known[0]];
    const second = READER_ARCHETYPES[known[1] ?? known[0]];
    return {
        title: `${top.noun[lang]} ${second.of[lang]}`,
        tagline: top.tagline[lang],
        icon: top.icon,
        topSlug: known[0],
    };
}
