/**
 * Connexion au serveur Supabase (comptes, sauvegardes en ligne, carrière à plusieurs).
 * Ces deux valeurs sont PUBLIQUES (la sécurité repose sur les règles RLS de
 * supabase/schema.sql) : Supabase → Project Settings → API.
 * Tant qu'elles sont vides, le jeu utilise des comptes locaux (sur l'appareil) et la
 * carrière en ligne est indisponible.
 */
export const SUPABASE_URL = '';
export const SUPABASE_ANON_KEY = '';
