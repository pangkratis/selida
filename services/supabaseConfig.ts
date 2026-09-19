import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://rxovzritmmnpodojhfuj.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_0PSwWrB9R7RyU-F8uY90Uw_g4omlZEY';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});