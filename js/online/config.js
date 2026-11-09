/**
 * Connexion au serveur Supabase (comptes, sauvegardes en ligne, carrière à plusieurs).
 * Ces deux valeurs sont PUBLIQUES (la sécurité repose sur les règles RLS de
 * supabase/schema.sql) : Supabase → Project Settings → API.
 * Tant qu'elles sont vides, le jeu utilise des comptes locaux (sur l'appareil) et la
 * carrière en ligne est indisponible.
 */
export const SUPABASE_URL = 'https://qjarmwvpibdfixhpchfr.supabase.co';
export const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFqYXJtd3ZwaWJkZml4aHBjaGZyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQyMzAyMzAsImV4cCI6MjEwOTgwNjIzMH0.d0DIA486IhZItCQN5bn3VonO6mVnJKqqszT0Xp_P9Ho';
