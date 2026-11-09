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

/** 30 championnats : les 20 premiers européens et 10 autres (Europe de l'Est, Brésil, Arabie saoudite, Mexique, Japon) (seules les élites sont dans les données : pas de relégation). */
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
    GRE: { name: 'Grèce', flag: '🇬🇷', cup: 'Coupe de Grèce' },
    NOR: { name: 'Norvège', flag: '🇳🇴', cup: 'Coupe de Norvège' },
    POL: { name: 'Pologne', flag: '🇵🇱', cup: 'Coupe de Pologne' },
    DEN: { name: 'Danemark', flag: '🇩🇰', cup: 'Coupe du Danemark' },
    AUT: { name: 'Autriche', flag: '🇦🇹', cup: 'Coupe d\'Autriche' },
    SUI: { name: 'Suisse', flag: '🇨🇭', cup: 'Coupe de Suisse' },
    SCO: { name: 'Écosse', flag: '🏴󠁧󠁢󠁳󠁣󠁴󠁿', cup: 'Scottish Cup' },
    SWE: { name: 'Suède', flag: '🇸🇪', cup: 'Coupe de Suède' },
    CRO: { name: 'Croatie', flag: '🇭🇷', cup: 'Coupe de Croatie' },
    SRB: { name: 'Serbie', flag: '🇷🇸', cup: 'Coupe de Serbie' },
    BRA: { name: 'Brésil', flag: '🇧🇷', cup: 'Copa do Brasil' },
    KSA: { name: 'Arabie saoudite', flag: '🇸🇦', cup: 'King\'s Cup' },
    MEX: { name: 'Mexique', flag: '🇲🇽', cup: 'Copa MX' },
    JPN: { name: 'Japon', flag: '🇯🇵', cup: 'Coupe de l\'Empereur' },
    RUS: { name: 'Russie', flag: '🇷🇺', cup: 'Coupe de Russie' },
    UKR: { name: 'Ukraine', flag: '🇺🇦', cup: 'Coupe d\'Ukraine' },
    ROU: { name: 'Roumanie', flag: '🇷🇴', cup: 'Coupe de Roumanie' },
    HUN: { name: 'Hongrie', flag: '🇭🇺', cup: 'Coupe de Hongrie' },
    CYP: { name: 'Chypre', flag: '🇨🇾', cup: 'Coupe de Chypre' },
    ISR: { name: 'Israël', flag: '🇮🇱', cup: 'Coupe d\'Israël' },
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
    11: { name: 'Super League', short: 'GR', country: 'GRE', level: 1, source: 'GRE1', profile: { goals: 0.95, fouls: 1.1, cards: 1.2 } },
    12: { name: 'Eliteserien', short: 'NO', country: 'NOR', level: 1, source: 'NOR1', profile: { goals: 1.1, fouls: 0.9, cards: 0.85 } },
    13: { name: 'Ekstraklasa', short: 'PL', country: 'POL', level: 1, source: 'POL1', profile: { goals: 1, fouls: 1.05, cards: 1.1 } },
    14: { name: 'Superliga', short: 'DK', country: 'DEN', level: 1, source: 'DEN1', profile: { goals: 1.05, fouls: 0.9, cards: 0.9 } },
    15: { name: 'Bundesliga (AUT)', short: 'AT', country: 'AUT', level: 1, source: 'AUT1', profile: { goals: 1.1, fouls: 0.95, cards: 0.95 } },
    16: { name: 'Super League (SUI)', short: 'CH', country: 'SUI', level: 1, source: 'SUI1', profile: { goals: 1.08, fouls: 0.95, cards: 0.9 } },
    17: { name: 'Premiership', short: 'SC', country: 'SCO', level: 1, source: 'SCO1', profile: { goals: 1, fouls: 0.95, cards: 0.9 } },
    18: { name: 'Allsvenskan', short: 'SE', country: 'SWE', level: 1, source: 'SWE1', profile: { goals: 1.05, fouls: 0.9, cards: 0.85 } },
    19: { name: 'HNL', short: 'HR', country: 'CRO', level: 1, source: 'CRO1', profile: { goals: 0.98, fouls: 1.05, cards: 1.15 } },
    20: { name: 'SuperLiga', short: 'RS', country: 'SRB', level: 1, source: 'SRB1', profile: { goals: 0.98, fouls: 1.1, cards: 1.2 } },
    21: { name: 'Brasileirão', short: 'BR', country: 'BRA', level: 1, source: 'BRA1', profile: { goals: 0.95, fouls: 1.15, cards: 1.25 } },
    22: { name: 'Saudi Pro League', short: 'SPL', country: 'KSA', level: 1, source: 'KSA1', profile: { goals: 1.1, fouls: 1, cards: 1.05 } },
    23: { name: 'Liga MX', short: 'MX', country: 'MEX', level: 1, source: 'MEX1', profile: { goals: 1.02, fouls: 1.05, cards: 1.1 } },
    24: { name: 'J1 League', short: 'J1', country: 'JPN', level: 1, source: 'JPN1', profile: { goals: 1, fouls: 0.75, cards: 0.6 } },
    25: { name: 'Premier League (RUS)', short: 'RU', country: 'RUS', level: 1, source: 'RUS1', profile: { goals: 0.95, fouls: 1.05, cards: 1.1 } },
    26: { name: 'Premier League (UKR)', short: 'UA', country: 'UKR', level: 1, source: 'UKR1', profile: { goals: 0.98, fouls: 1.05, cards: 1.1 } },
    27: { name: 'SuperLiga (ROU)', short: 'RO', country: 'ROU', level: 1, source: 'ROU1', profile: { goals: 0.95, fouls: 1.1, cards: 1.2 } },
    28: { name: 'NB I', short: 'HU', country: 'HUN', level: 1, source: 'HUN1', profile: { goals: 1.05, fouls: 1, cards: 1.05 } },
    29: { name: 'First Division', short: 'CY', country: 'CYP', level: 1, source: 'CYP1', profile: { goals: 1, fouls: 1.05, cards: 1.15 } },
    30: { name: 'Ligat HaAl', short: 'IL', country: 'ISR', level: 1, source: 'ISR1', profile: { goals: 1.02, fouls: 1, cards: 1.05 } },
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
