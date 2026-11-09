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

/** Les 10 premiers championnats européens (seules les élites sont dans les données : pas de relégation). */
const REAL = {
  countries: {
    ENG: { name: 'Angleterre', flag: '🏴󠁧󠁢󠁥󠁮󠁧󠁿', cup: 'FA Cup' },
    ESP: { name: 'Espagne', flag: '🇪🇸', cup: 'Copa del Rey' },
    ITA: { name: 'Italie', flag: '🇮🇹', cup: 'Coppa Italia' },
    GER: { name: 'Allemagne', flag: '🇩🇪', cup: 'DFB-Pokal' },
    FRA: { name: 'France', flag: '🇫🇷', cup: 'Coupe de France' },
    POR: { name: 'Portugal', flag: '🇵🇹', cup: 'Taça de Portugal' },
    NED: { name: 'Pays-Bas', flag: '🇳🇱', cup: 'KNVB Beker' },
    BEL: { name: 'Belgique', flag: '🇧🇪', cup: 'Coupe de Belgique' },
    TUR: { name: 'Turquie', flag: '🇹🇷', cup: 'Coupe de Turquie' },
    CZE: { name: 'Tchéquie', flag: '🇨🇿', cup: 'Coupe de Tchéquie' },
  },
  divisions: {
    1: { name: 'Premier League', short: 'PL', country: 'ENG', level: 1, source: 'ENG1', profile: { goals: 1.0, fouls: 0.85, cards: 0.8 } },
    2: { name: 'LaLiga', short: 'LL', country: 'ESP', level: 1, source: 'ESP1', profile: { goals: 0.97, fouls: 0.95, cards: 1.25 } },
    3: { name: 'Serie A', short: 'SA', country: 'ITA', level: 1, source: 'ITA1', profile: { goals: 0.97, fouls: 1.05, cards: 1.15 } },
    4: { name: 'Bundesliga', short: 'BL', country: 'GER', level: 1, source: 'GER1', profile: { goals: 1.08, fouls: 0.95, cards: 0.9 } },
    5: { name: 'Ligue 1', short: 'L1', country: 'FRA', level: 1, source: 'FRA1', profile: { goals: 1, fouls: 1, cards: 1 } },
    6: { name: 'Liga Portugal', short: 'LP', country: 'POR', level: 1, source: 'POR1', profile: { goals: 0.98, fouls: 1.05, cards: 1.15 } },
    7: { name: 'Eredivisie', short: 'ED', country: 'NED', level: 1, source: 'NED1', profile: { goals: 1.12, fouls: 0.9, cards: 0.85 } },
    8: { name: 'Pro League', short: 'PRO', country: 'BEL', level: 1, source: 'BEL1', profile: { goals: 1.05, fouls: 0.95, cards: 1 } },
    9: { name: 'Süper Lig', short: 'SL', country: 'TUR', level: 1, source: 'TUR1', profile: { goals: 1.02, fouls: 1.1, cards: 1.2 } },
    10: { name: 'Chance Liga', short: 'CL', country: 'CZE', level: 1, source: 'CZE1', profile: { goals: 0.98, fouls: 1, cards: 1 } },
  },
  // 16 qualifiés pour la Ligue des Étoiles.
  conti: { 1: 3, 2: 2, 3: 2, 4: 2, 5: 2, 6: 1, 7: 1, 8: 1, 9: 1, 10: 1 },
};

export const COUNTRIES = {};
export const DIVISIONS = {};
export const DIV_IDS = [];
export const DIV_NAMES = {};
export const CONTI_SLOTS = {};
export const CONTI_NAME = 'Ligue des Étoiles';
export const WORLD = { kind: 'fictional' };

const replace = (target, src) => { for (const k of Object.keys(target)) delete target[k]; Object.assign(target, JSON.parse(JSON.stringify(src))); };

/**
 * Bascule la structure du monde ('fictional' | 'real'). divs : divisions réellement
 * présentes dans les données (les autres sont ignorées ; leurs places continentales
 * reviennent aux championnats les mieux classés).
 */
export function applyWorld(kind = 'fictional', divs = null) {
  const def = kind === 'real' ? REAL : FICTIONAL;
  WORLD.kind = kind === 'real' ? 'real' : 'fictional';
  const keep = divs ? Object.fromEntries(Object.entries(def.divisions).filter(([d]) => divs.includes(+d))) : def.divisions;
  const conti = Object.fromEntries(Object.entries(def.conti).filter(([d]) => keep[d]));
  let missing = 16 - Object.values(conti).reduce((a, n) => a + n, 0);
  for (const d of Object.keys(keep)) { if (missing <= 0) break; conti[d] = (conti[d] || 0) + 1; missing--; }
  replace(COUNTRIES, Object.fromEntries(Object.entries(def.countries).filter(([c]) => Object.values(keep).some((d) => d.country === c))));
  replace(DIVISIONS, keep);
  replace(CONTI_SLOTS, conti);
  DIV_IDS.length = 0;
  DIV_IDS.push(...Object.keys(DIVISIONS).map(Number));
  replace(DIV_NAMES, Object.fromEntries(DIV_IDS.map((d) => [d, DIVISIONS[d].name])));
}
applyWorld('fictional');
