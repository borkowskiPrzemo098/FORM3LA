// Konfiguracja wdrożenia.
// Puste wartości = TRYB DEMO (dane w tej przeglądarce, z kopiami lokalnymi).
// Po założeniu projektu w Supabase wklej tu URL i klucz "anon public" (jest publiczny z założenia,
// bezpieczeństwo zapewniają reguły RLS i funkcje z supabase/schema.sql).
export const SUPABASE_URL = '';
export const SUPABASE_ANON_KEY = '';

export const MODE = SUPABASE_URL && SUPABASE_ANON_KEY ? 'supabase' : 'demo';
