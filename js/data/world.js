/**
 * Structure du monde : pays, divisions, profils de championnat, compétitions.
 */
export const COUNTRIES = {
  FRA: { name: 'France', flag: '🇫🇷', cup: 'Coupe nationale' },
  IBE: { name: 'Ibérie', flag: '🟥', cup: 'Copa de Ibérie' },
  ALB: { name: 'Albion', flag: '🟦', cup: 'Albion FA Cup' },
};

/**
 * Divisions. level 1 = élite. profile : calibration du moteur propre au championnat
 * (style plus technique en Ibérie, plus physique en Albion).
 */
export const DIVISIONS = {
  1: { name: 'Division 1', short: 'D1', country: 'FRA', level: 1, profile: { goals: 1, fouls: 1, cards: 1 } },
  2: { name: 'Division 2', short: 'D2', country: 'FRA', level: 2, profile: { goals: 1.02, fouls: 1.08, cards: 1.05 } },
  3: { name: 'Liga Ibérica', short: 'LIB', country: 'IBE', level: 1, profile: { goals: 0.97, fouls: 0.95, cards: 1.25 } },
  4: { name: 'Albion Premier', short: 'ALB', country: 'ALB', level: 1, profile: { goals: 1.08, fouls: 0.85, cards: 0.8 } },
};
export const DIV_IDS = Object.keys(DIVISIONS).map(Number);

export const CONTI_NAME = 'Ligue des Étoiles';
/** Places qualificatives pour la coupe continentale (16 clubs). */
export const CONTI_SLOTS = { 1: 6, 3: 5, 4: 5 };
