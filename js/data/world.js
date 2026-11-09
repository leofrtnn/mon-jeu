/**
 * Structure du monde : pays, divisions, profils de championnat, compétitions.
 * Deux mondes : « fictif » (par défaut, 80 clubs inventés) et « réel » (les 5 grands
 * championnats, chargés depuis data/real-world.json). Les objets exportés sont
 * modifiés EN PLACE par applyWorld() : tous les modules qui les importent suivent.
 */

const FICTIONAL = {
  countries: {
    FRA: { name: 'France', flag: '🇫🇷', cup: 'Coupe nationale' },
    IBE: { name: 'Ibérie', flag: '🟥', cup: 'Copa de Ibérie' },
    ALB: { name: 'Albion', flag: '🟦', cup: 'Albion FA Cup' },
  },
  // level 1 = élite ; profile : calibration du moteur ; down/up : relégations / montées.
  divisions: {
    1: { name: 'Division 1', short: 'D1', country: 'FRA', level: 1, profile: { goals: 1, fouls: 1, cards: 1 }, down: 3, lower: 2 },
    2: { name: 'Division 2', short: 'D2', country: 'FRA', level: 2, profile: { goals: 1.02, fouls: 1.08, cards: 1.05 }, up: 3, upper: 1 },
    3: { name: 'Liga Ibérica', short: 'LIB', country: 'IBE', level: 1, profile: { goals: 0.97, fouls: 0.95, cards: 1.25 } },
    4: { name: 'Albion Premier', short: 'ALB', country: 'ALB', level: 1, profile: { goals: 1.0, fouls: 0.85, cards: 0.8 } },
  },
  conti: { 1: 6, 3: 5, 4: 5 },
};

/** Les 5 grands championnats (les seules divisions présentes dans les données : pas de relégation). */
const REAL = {
  countries: {
    ENG: { name: 'Angleterre', flag: '🏴󠁧󠁢󠁥󠁮󠁧󠁿', cup: 'FA Cup' },
    ESP: { name: 'Espagne', flag: '🇪🇸', cup: 'Copa del Rey' },
    ITA: { name: 'Italie', flag: '🇮🇹', cup: 'Coppa Italia' },
    GER: { name: 'Allemagne', flag: '🇩🇪', cup: 'DFB-Pokal' },
    FRA: { name: 'France', flag: '🇫🇷', cup: 'Coupe de France' },
  },
  divisions: {
    1: { name: 'Premier League', short: 'PL', country: 'ENG', level: 1, source: 'ENG1', profile: { goals: 1.0, fouls: 0.85, cards: 0.8 } },
    2: { name: 'LaLiga', short: 'LL', country: 'ESP', level: 1, source: 'ESP1', profile: { goals: 0.97, fouls: 0.95, cards: 1.25 } },
    3: { name: 'Serie A', short: 'SA', country: 'ITA', level: 1, source: 'ITA1', profile: { goals: 0.97, fouls: 1.05, cards: 1.15 } },
    4: { name: 'Bundesliga', short: 'BL', country: 'GER', level: 1, source: 'GER1', profile: { goals: 1.08, fouls: 0.95, cards: 0.9 } },
    5: { name: 'Ligue 1', short: 'L1', country: 'FRA', level: 1, source: 'FRA1', profile: { goals: 1, fouls: 1, cards: 1 } },
  },
  conti: { 1: 4, 2: 4, 3: 3, 4: 3, 5: 2 },
};

export const COUNTRIES = {};
export const DIVISIONS = {};
export const DIV_IDS = [];
export const DIV_NAMES = {};
export const CONTI_SLOTS = {};
export const CONTI_NAME = 'Ligue des Étoiles';
export const WORLD = { kind: 'fictional' };

const replace = (target, src) => { for (const k of Object.keys(target)) delete target[k]; Object.assign(target, JSON.parse(JSON.stringify(src))); };

/** Bascule la structure du monde ('fictional' | 'real'). */
export function applyWorld(kind = 'fictional') {
  const def = kind === 'real' ? REAL : FICTIONAL;
  WORLD.kind = kind === 'real' ? 'real' : 'fictional';
  replace(COUNTRIES, def.countries);
  replace(DIVISIONS, def.divisions);
  replace(CONTI_SLOTS, def.conti);
  DIV_IDS.length = 0;
  DIV_IDS.push(...Object.keys(DIVISIONS).map(Number));
  replace(DIV_NAMES, Object.fromEntries(DIV_IDS.map((d) => [d, DIVISIONS[d].name])));
}
applyWorld('fictional');
