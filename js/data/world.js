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

/** 45 championnats : 20 européens, 10 autres (Europe de l'Est, Brésil, Arabie saoudite, Mexique, Japon…), 5 deuxièmes divisions et 10 d'Asie, d'Océanie, du Golfe, du Maroc et d'Amérique du Sud. */
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
    KOR: { name: 'Corée du Sud', flag: '🇰🇷', cup: 'Coupe de Corée' },
    CHN: { name: 'Chine', flag: '🇨🇳', cup: 'Coupe de Chine' },
    AUS: { name: 'Australie', flag: '🇦🇺', cup: 'Australia Cup' },
    UAE: { name: 'Émirats arabes unis', flag: '🇦🇪', cup: 'Coupe du Président' },
    QAT: { name: 'Qatar', flag: '🇶🇦', cup: 'Coupe de l\'Émir' },
    MAR: { name: 'Maroc', flag: '🇲🇦', cup: 'Coupe du Trône' },
    PER: { name: 'Pérou', flag: '🇵🇪', cup: 'Copa Bicentenario' },
    CHI: { name: 'Chili', flag: '🇨🇱', cup: 'Copa Chile' },
    COL: { name: 'Colombie', flag: '🇨🇴', cup: 'Copa Colombia' },
    URU: { name: 'Uruguay', flag: '🇺🇾', cup: 'Copa AUF Uruguay' },
    USA: { name: 'États-Unis', flag: '🇺🇸', cup: 'U.S. Open Cup' },
    ARG: { name: 'Argentine', flag: '🇦🇷', cup: 'Copa Argentina' },
    EGY: { name: 'Égypte', flag: '🇪🇬', cup: 'Coupe d\'Égypte' },
    ECU: { name: 'Équateur', flag: '🇪🇨', cup: 'Copa Ecuador' },
    RSA: { name: 'Afrique du Sud', flag: '🇿🇦', cup: 'Nedbank Cup' },
    SVK: { name: 'Slovaquie', flag: '🇸🇰', cup: 'Coupe de Slovaquie' },
    BUL: { name: 'Bulgarie', flag: '🇧🇬', cup: 'Coupe de Bulgarie' },
    ALG: { name: 'Algérie', flag: '🇩🇿', cup: 'Coupe d\'Algérie' },
    TUN: { name: 'Tunisie', flag: '🇹🇳', cup: 'Coupe de Tunisie' },
    PAR: { name: 'Paraguay', flag: '🇵🇾', cup: 'Copa Paraguay' },
  },
  divisions: {
    1: { name: 'Premier League', short: 'PL', country: 'ENG', level: 1, source: 'ENG1', profile: { goals: 1.0, fouls: 0.85, cards: 0.8 }, down: 3, lower: 31 },
    2: { name: 'LaLiga', short: 'LL', country: 'ESP', level: 1, source: 'ESP1', profile: { goals: 0.97, fouls: 0.95, cards: 1.25 }, down: 3, lower: 32 },
    3: { name: 'Serie A', short: 'SA', country: 'ITA', level: 1, source: 'ITA1', profile: { goals: 0.97, fouls: 1.05, cards: 1.15 }, down: 3, lower: 33 },
    4: { name: 'Bundesliga', short: 'BL', country: 'GER', level: 1, source: 'GER1', profile: { goals: 1.08, fouls: 0.95, cards: 0.9 }, down: 2, lower: 34 },
    5: { name: 'Ligue 1', short: 'L1', country: 'FRA', level: 1, source: 'FRA1', profile: { goals: 1, fouls: 1, cards: 1 }, down: 2, lower: 35 },
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
    // Deuxièmes divisions (montées / descentes avec l'élite du pays).
    31: { name: 'Championship', short: 'CH', country: 'ENG', level: 2, source: 'ENG2', profile: { goals: 0.98, fouls: 1.05, cards: 0.95 }, up: 3, upper: 1 },
    32: { name: 'LaLiga 2', short: 'LL2', country: 'ESP', level: 2, source: 'ESP2', profile: { goals: 0.9, fouls: 1.05, cards: 1.3 }, up: 3, upper: 2 },
    33: { name: 'Serie B', short: 'SB', country: 'ITA', level: 2, source: 'ITA2', profile: { goals: 0.92, fouls: 1.1, cards: 1.2 }, up: 3, upper: 3 },
    34: { name: '2. Bundesliga', short: 'BL2', country: 'GER', level: 2, source: 'GER2', profile: { goals: 1.05, fouls: 1, cards: 0.95 }, up: 2, upper: 4 },
    35: { name: 'Ligue 2', short: 'L2', country: 'FRA', level: 2, source: 'FRA2', profile: { goals: 0.92, fouls: 1.05, cards: 1.05 }, up: 2, upper: 5 },
    // Asie, Océanie, Golfe, Afrique du Nord, Amérique du Sud (élites seules).
    36: { name: 'K League 1', short: 'KL', country: 'KOR', level: 1, source: 'KOR1', profile: { goals: 0.98, fouls: 0.9, cards: 0.85 } },
    37: { name: 'Super League (CHN)', short: 'CSL', country: 'CHN', level: 1, source: 'CHN1', profile: { goals: 1.05, fouls: 1, cards: 1.05 } },
    38: { name: 'A-League', short: 'AL', country: 'AUS', level: 1, source: 'AUS1', profile: { goals: 1.12, fouls: 0.9, cards: 0.9 } },
    39: { name: 'UAE Pro League', short: 'UAE', country: 'UAE', level: 1, source: 'UAE1', profile: { goals: 1.1, fouls: 0.95, cards: 1 } },
    40: { name: 'Stars League', short: 'QSL', country: 'QAT', level: 1, source: 'QAT1', profile: { goals: 1.12, fouls: 0.95, cards: 0.95 } },
    41: { name: 'Botola Pro', short: 'BP', country: 'MAR', level: 1, source: 'MAR1', profile: { goals: 0.85, fouls: 1.1, cards: 1.1 } },
    42: { name: 'Liga 1 (PER)', short: 'PE', country: 'PER', level: 1, source: 'PER1', profile: { goals: 0.98, fouls: 1.15, cards: 1.25 } },
    43: { name: 'Primera División (CHI)', short: 'CL', country: 'CHI', level: 1, source: 'CHI1', profile: { goals: 1.02, fouls: 1.1, cards: 1.2 } },
    44: { name: 'Primera A', short: 'CO', country: 'COL', level: 1, source: 'COL1', profile: { goals: 0.92, fouls: 1.15, cards: 1.25 } },
    45: { name: 'Primera División (URU)', short: 'UY', country: 'URU', level: 1, source: 'URU1', profile: { goals: 0.95, fouls: 1.15, cards: 1.3 } },
    // Championnats 46 à 50.
    46: { name: 'Major League Soccer', short: 'MLS', country: 'USA', level: 1, source: 'USA1', profile: { goals: 1.12, fouls: 0.9, cards: 0.9 } },
    47: { name: 'Liga Profesional', short: 'LPF', country: 'ARG', level: 1, source: 'ARG1', profile: { goals: 0.88, fouls: 1.2, cards: 1.35 } },
    48: { name: 'Egyptian Premier League', short: 'EPL', country: 'EGY', level: 1, source: 'EGY1', profile: { goals: 0.85, fouls: 1.05, cards: 1.05 } },
    49: { name: 'LigaPro', short: 'EC', country: 'ECU', level: 1, source: 'ECU1', profile: { goals: 1, fouls: 1.1, cards: 1.2 } },
    50: { name: 'Premiership (RSA)', short: 'PSL', country: 'RSA', level: 1, source: 'RSA1', profile: { goals: 0.9, fouls: 1, cards: 1 } },
    // Championnats 51 à 55.
    51: { name: 'Niké liga', short: 'SK', country: 'SVK', level: 1, source: 'SVK1', profile: { goals: 1.02, fouls: 1, cards: 1.05 } },
    52: { name: 'efbet Liga', short: 'BG', country: 'BUL', level: 1, source: 'BUL1', profile: { goals: 0.95, fouls: 1.08, cards: 1.15 } },
    53: { name: 'Ligue 1 (ALG)', short: 'ALG', country: 'ALG', level: 1, source: 'ALG1', profile: { goals: 0.82, fouls: 1.1, cards: 1.15 } },
    54: { name: 'Ligue 1 (TUN)', short: 'TUN', country: 'TUN', level: 1, source: 'TUN1', profile: { goals: 0.85, fouls: 1.08, cards: 1.12 } },
    55: { name: 'Primera División (PAR)', short: 'PY', country: 'PAR', level: 1, source: 'PAR1', profile: { goals: 0.98, fouls: 1.12, cards: 1.25 } },
  },
  conti: { 1: 3, 2: 2, 3: 2, 4: 2, 5: 2, 6: 1, 7: 1, 8: 1, 9: 1, 10: 1 },
};

/* ------------------------------------------------------------------ */
/* Compétitions réelles : continentales, supercoupes, dotations         */
/* ------------------------------------------------------------------ */

/**
 * Coupes continentales (format du jeu : 16 clubs, 4 groupes de 4, puis quarts, demies, finale).
 * slots : places par pays (clubs de l'élite, dans l'ordre du classement final précédent) ;
 * les compétitions d'un même continent se partagent les places (la C1 prend les premiers, la C3 les suivants…).
 * prize (€) : participation, victoire / nul en groupe, accès aux quarts, demies, finale, titre
 * (ordres de grandeur des dotations réelles 2024-2025, ramenés au format du jeu).
 */
export const CONTI_DEFS = [
  { id: 'ucl', name: 'Ligue des champions', short: 'LDC', org: 'UEFA', icon: '⭐', tier: 1, trophy: 'ears', color: '#1d3fbb', nick: 'la coupe aux grandes oreilles',
    slots: { ENG: 3, ESP: 3, ITA: 2, GER: 2, FRA: 2, POR: 1, NED: 1, BEL: 1, TUR: 1 },
    prize: { part: 18_600_000, win: 2_100_000, draw: 700_000, qf: 23_500_000, sf: 15_000_000, final: 18_500_000, champ: 6_500_000 } },
  { id: 'uel', name: 'Ligue Europa', short: 'C3', org: 'UEFA', icon: '🟠', tier: 2, trophy: 'vase', color: '#f26a1b', nick: 'la coupe UEFA',
    slots: { ENG: 2, ESP: 2, ITA: 2, GER: 2, FRA: 1, POR: 1, NED: 1, BEL: 1, TUR: 1, SCO: 1, AUT: 1, CZE: 1 },
    prize: { part: 4_300_000, win: 450_000, draw: 150_000, qf: 4_250_000, sf: 2_800_000, final: 4_000_000, champ: 6_000_000 } },
  { id: 'uecl', name: 'Ligue Europa Conférence', short: 'C4', org: 'UEFA', icon: '🟢', tier: 3, trophy: 'cup', color: '#1fbf72', nick: '',
    slots: { ENG: 1, ESP: 1, ITA: 1, GER: 1, FRA: 1, POR: 1, NED: 1, BEL: 1, TUR: 1, GRE: 1, NOR: 1, POL: 1, DEN: 1, SUI: 1, SVK: 1, BUL: 1 },
    prize: { part: 3_200_000, win: 400_000, draw: 133_000, qf: 2_100_000, sf: 2_000_000, final: 3_000_000, champ: 2_000_000 } },
  { id: 'lib', name: 'Copa Libertadores', short: 'LIB', org: 'CONMEBOL', icon: '🏆', tier: 1, trophy: 'lib', color: '#c9a227', nick: 'la Gloria Eterna',
    slots: { BRA: 4, ARG: 4, COL: 2, CHI: 1, ECU: 2, URU: 1, PER: 1, PAR: 1 },
    prize: { part: 2_800_000, win: 300_000, draw: 0, qf: 2_700_000, sf: 2_100_000, final: 6_500_000, champ: 16_000_000 } },
  { id: 'acl', name: 'Ligue des champions de l\'AFC', short: 'ACL', org: 'AFC', icon: '🌏', tier: 1, trophy: 'cup', color: '#0d7c66', nick: '',
    slots: { KSA: 3, JPN: 3, KOR: 2, CHN: 2, UAE: 2, QAT: 2, AUS: 2 },
    prize: { part: 800_000, win: 100_000, draw: 50_000, qf: 1_300_000, sf: 1_800_000, final: 3_700_000, champ: 5_500_000 } },
  { id: 'ccc', name: 'Coupe des champions de la CONCACAF', short: 'CCC', org: 'CONCACAF', icon: '🌎', tier: 1, trophy: 'cup', color: '#2b6cb0', nick: '',
    slots: { MEX: 8, USA: 8 },
    prize: { part: 250_000, win: 50_000, draw: 25_000, qf: 500_000, sf: 750_000, final: 1_000_000, champ: 3_000_000 } },
  { id: 'caf', name: 'Ligue des champions de la CAF', short: 'CAF', org: 'CAF', icon: '🌍', tier: 1, trophy: 'cup', color: '#2f855a', nick: '',
    slots: { EGY: 4, MAR: 3, RSA: 3, TUN: 3, ALG: 3 },
    prize: { part: 650_000, win: 50_000, draw: 25_000, qf: 250_000, sf: 300_000, final: 800_000, champ: 2_000_000 } },
];
/** Compétitions continentales actives (selon les championnats présents). Remplie par applyWorld. */
export const CONTI_COMPS = {};

/** Supercoupes nationales (champion contre vainqueur de la coupe, en août, terrain neutre). */
export const SUPER_CUPS = {
  ENG: 'Community Shield', ESP: 'Supercopa de España', ITA: 'Supercoppa italiana', GER: 'DFL-Supercup', FRA: 'Trophée des Champions',
  POR: 'Supertaça Cândido de Oliveira', NED: 'Johan Cruijff Schaal', BEL: 'Supercoupe de Belgique', TUR: 'Süper Kupa', SCO: '',
  BRA: 'Supercopa do Brasil', ARG: 'Supercopa Argentina', MEX: 'Campeón de Campeones', KSA: 'Supercoupe d\'Arabie saoudite',
  JPN: 'Supercoupe du Japon', USA: '', AUS: '', EGY: 'Supercoupe d\'Égypte', MAR: '', RSA: '',
};
export const superCupName = (country) => (SUPER_CUPS[country] === '' ? null : SUPER_CUPS[country] || `Supercoupe (${COUNTRIES[country]?.name || country})`);

/**
 * Dotation des coupes nationales (€ par tour gagné ; le dernier = vainqueur de la finale).
 * Ordres de grandeur réels ; les autres pays suivent la richesse de leur championnat.
 */
export const CUP_PRIZE_TABLE = {
  ENG: [140_000, 260_000, 530_000, 1_200_000, 2_350_000],
  GER: [420_000, 840_000, 1_670_000, 3_350_000, 4_320_000],
  ITA: [250_000, 500_000, 1_000_000, 2_000_000, 4_500_000],
  ESP: [80_000, 160_000, 320_000, 650_000, 1_500_000],
  FRA: [60_000, 120_000, 250_000, 500_000, 1_500_000],
};
export function cupPrizes(country) {
  if (CUP_PRIZE_TABLE[country]) return CUP_PRIZE_TABLE[country];
  const w = LEAGUE_WEALTH[country] ?? 0.4;
  return [40_000, 80_000, 160_000, 320_000, 800_000].map((v) => Math.round(v * w * 2 / 10_000) * 10_000);
}

/**
 * Richesse des championnats (droits TV, sponsors) : à réputation égale, un club anglais
 * ou saoudien a bien plus d'argent qu'un club suisse.
 */
export const LEAGUE_WEALTH = {
  ENG: 1.45, ESP: 1.3, ITA: 1.05, GER: 1.15, FRA: 0.9, KSA: 1.45, POR: 0.6, NED: 0.62, BEL: 0.55, TUR: 0.7,
  BRA: 0.62, MEX: 0.55, JPN: 0.5, RUS: 0.62, USA: 0.7, SCO: 0.45, AUT: 0.5, SUI: 0.5, DEN: 0.45, GRE: 0.45,
  CZE: 0.38, POL: 0.42, NOR: 0.4, SWE: 0.4, CRO: 0.35, SRB: 0.33, UKR: 0.4, ROU: 0.35, HUN: 0.38, CYP: 0.38, ISR: 0.38,
  KOR: 0.45, CHN: 0.55, AUS: 0.4, UAE: 0.6, QAT: 0.65, MAR: 0.3, PER: 0.25, CHI: 0.3, COL: 0.3, URU: 0.25,
  ARG: 0.42, EGY: 0.3, ECU: 0.25, RSA: 0.3, SVK: 0.32, BUL: 0.3, ALG: 0.28, TUN: 0.27, PAR: 0.26,
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
  // Compétitions continentales réelles : seulement si au moins 16 clubs peuvent y prendre part.
  const comps = {};
  if (kind === 'real') {
    const used = {}; // places déjà prises par pays (C1 avant C3…)
    const eliteOf = (c) => Object.entries(keep).find(([, d]) => d.country === c && d.level === 1);
    for (const def of CONTI_DEFS) {
      const slots = {};
      for (const [c, n] of Object.entries(def.slots)) if (eliteOf(c)) slots[c] = n;
      // Places des pays absents : redistribuées aux pays présents, dans l'ordre.
      let missing = 16 - Object.values(slots).reduce((a, n) => a + n, 0);
      const order = Object.keys(slots);
      for (let i = 0; missing > 0 && order.length && i < 64; i++) { const c = order[i % order.length]; if (slots[c] < 8) { slots[c]++; missing--; } }
      if (Object.values(slots).reduce((a, n) => a + n, 0) < 16) continue;
      const byDiv = {};
      for (const c of Object.keys(slots)) { byDiv[+eliteOf(c)[0]] = { from: used[c] || 0, n: slots[c] }; used[c] = (used[c] || 0) + slots[c]; }
      comps[def.id] = { ...def, slots, byDiv };
    }
  } else {
    // Monde fictif : une seule coupe continentale.
    comps.star = { ...CONTI_DEFS[0], id: 'star', name: CONTI_NAME, short: 'LDE', nick: '', byDiv: Object.fromEntries(Object.entries(conti).map(([d, n]) => [+d, { from: 0, n }])) };
  }
  replace(CONTI_COMPS, comps);
  DIV_IDS.length = 0;
  DIV_IDS.push(...Object.keys(DIVISIONS).map(Number));
  replace(DIV_NAMES, Object.fromEntries(DIV_IDS.map((d) => [d, DIVISIONS[d].name])));
}
applyWorld('fictional');
