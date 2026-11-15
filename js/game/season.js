/**
 * SAISON : calendrier (3 championnats, coupes nationales, coupe continentale,
 * trêves internationales), journées, classements, objectifs du board,
 * fin de saison (promotions/relégations, palmarès, évolution).
 */
import { createRng, hashSeed, clamp } from '../core/rng.js';
import { createWorld, createYouth, getNextId, setNextId, assignNumbers } from '../data/generator.js';
import { createRealWorld } from '../data/realWorld.js';
import { applyTop100 } from './ratingsImport.js';
import { DIVISIONS, DIV_IDS, COUNTRIES, CONTI_SLOTS, CONTI_NAME, DIV_NAMES, applyWorld, CONTI_COMPS, superCupName, cupPrizes, LEAGUE_WEALTH } from '../data/world.js';
import { NATION_COLORS } from '../data/names.js';
import { autoLineup, isAvailable, overall, squadStrength, ratingAt } from '../engine/ratings.js';
import { aiPrepare } from '../engine/ai.js';
import { simulateMatch, summarize, penaltyShootout, tieLevel, allPlayers, createMatch, restoreMatch } from '../engine/match.js';
import { wageBill, matchdayRevenue, sponsorIncome, prizeMoney, money, playerValue } from './economy.js';
import { weeklyTraining, seasonDevelopment, shouldRetire, resetSeasonStats } from './progression.js';
import { aiTransferActivity, userTransferOffers, salesDaily, fillSquad, logFinance, checkPromises } from './transfers.js';
import { forEachHuman, withHuman, humanOfClub, isHumanClub, curHuman, humanIds, switchTo } from './humans.js';
import { gameRng, matchSeed, clubById, userClub, clubPlayers, pushMessage, SAVE_VERSION } from './state.js';
import { initClubExtras, newCoach, coachRep, coachAfterMatch, staffEffects, staffWages, trainingParams, dailyFacilities, checkJobOffers, jobCandidates, ensureStaff, resetClubStaff, refreshStaffPool, STAFF_ROLES, staffWageFor } from './career.js';
import { scoutDaily, marketEvents, seeInMatch } from './scouting.js';
import { coachMods, ensureCoachProfile, grantSeasonPoints } from './coach.js';
import { ensureManagers, managerStyle, managersAfterRound, managersEndSeason, onUserLeaves, onUserArrives, news } from './managers.js';
import { assignDates, windowInfo, fmtDate } from './dates.js';
import { startPreseason } from './preseason.js';
import { ensureBoard, setBoardSeason, updateBoardParts, checkMidSeasonSack, recordUserMatch, IDENTITIES } from './board.js';
import { slotsOf } from '../data/constants.js';
import { ensureLife, lifeWorldDaily, lifeUserDaily, lifeAfterFixture, lifeAfterUserMatch, lifeNextDay, lifeEndSeasonWorld, lifeEndSeasonUser, lifeSeasonStart } from './life.js';
import { digestMatch, matchMods } from './press.js';
import { homeAdvantage, gateMult, userSponsorIncome } from './fans.js';
import { tension } from './relations.js';
import { injuryLength, noteInjury, logInjury, SEVERE_NAMES } from './injuries.js';
import { runSummerTournaments, breakLabel } from './international.js';
import { dealsDaily } from './deals.js';
import { retire } from './afterlife.js';
import { assignAllTraits, updateTraits, TRAITS } from './traits.js';
import { cohesionDaily, cohesionAfterUserMatch, linksWeekly, teamCohesion, cohMult, clubCoh } from './cohesion.js';
import { aiSeasonBudget, finHealth } from './owners.js';
import { BAL } from '../data/balance.js';
import { captainCfg } from './captain.js';
import { chatDaily } from './chat.js';
import { opt, optInfo } from './options.js';
import { matchConditions } from './weather.js';

export const CUP_ROUND_NAMES = ['16es de finale', '8es de finale', 'Quarts de finale', 'Demi-finales', 'Finale'];
/** Anciennes sauvegardes (16 clubs, 3 journées de groupes) : noms des 6 tours. */
export const CONTI_ROUND_NAMES = ['Groupes · J1', 'Groupes · J2', 'Groupes · J3', 'Quarts de finale', 'Demi-finales', 'Finale'];
const CUP_AFTER = [5, 12, 20, 28, 34];
/**
 * Coupes continentales (format 2024+) : 17 créneaux dans la saison.
 * Phase de ligue (36 clubs, 8 matchs) : créneaux 0-7 ; puis en aller-retour : barrages 8-9,
 * huitièmes 10-11, quarts 12-13, demies 14-15 ; finale sur un match (16).
 * Format à groupes (16 clubs, 4 groupes aller-retour) : créneaux 0-5, puis quarts, demies, finale.
 */
const CONTI_AFTER = [2, 4, 6, 9, 11, 13, 16, 19, 21, 23, 25, 26, 29, 31, 33, 35, 37];
const LP_DAYS = 8;
const STAGES = {
  league: [{ n: 'Barrages', k: [8, 9] }, { n: 'Huitièmes de finale', k: [10, 11] }, { n: 'Quarts de finale', k: [12, 13] }, { n: 'Demi-finales', k: [14, 15] }, { n: 'Finale', k: [16] }],
  groups: [{ n: 'Quarts de finale', k: [12, 13] }, { n: 'Demi-finales', k: [14, 15] }, { n: 'Finale', k: [16] }],
};
// Saisons commencées avec la version à 13 créneaux (un seul match par tour).
const STAGES_V2 = {
  league: [{ n: 'Barrages', k: [8] }, { n: 'Huitièmes de finale', k: [9] }, { n: 'Quarts de finale', k: [10] }, { n: 'Demi-finales', k: [11] }, { n: 'Finale', k: [12] }],
  groups: [{ n: 'Quarts de finale', k: [10] }, { n: 'Demi-finales', k: [11] }, { n: 'Finale', k: [12] }],
};
const BRACKET = [0, 7, 3, 4, 1, 6, 2, 5]; // ordre des têtes de série dans le tableau (1 et 2 ne se croisent qu'en finale)
const INTL_AFTER = [8, 18, 27];
const DEFAULT_PRIZE = { part: 3_000_000, win: 900_000, draw: 300_000, po: 500_000, r16: 4_000_000, qf: 6_000_000, sf: 9_000_000, final: 12_000_000, champ: 8_000_000 };
const prizeOf = (id) => CONTI_COMPS[id]?.prize || DEFAULT_PRIZE;

/** Verse une prime à un club (et l'inscrit dans les finances de son manager s'il est humain). */
function payPrize(state, clubId, amount, label) {
  if (!amount) return;
  const c = clubById(state, clubId);
  if (!c) return;
  c.budget += amount;
  const hu = humanOfClub(state, clubId);
  if (hu !== undefined) withHuman(state, hu, () => logFinance(state, amount, label));
}

/** Palmarès d'un club (titres gagnés pendant la partie). */
function addHonour(state, clubId, name, kind) {
  const c = clubById(state, clubId);
  if (c) (c.honours ||= []).push({ name, kind, season: state.season });
}

/** Coupes continentales de la saison (migration des anciennes sauvegardes à une seule coupe). */
export function ensureContis(state) {
  if (state.contis) return state.contis;
  state.contis = {};
  if (state.conti) {
    const id = Object.keys(CONTI_COMPS)[0] || 'star';
    state.contis[id] = { ...state.conti, id, name: CONTI_COMPS[id]?.name || state.conti.name };
    delete state.conti;
  }
  return state.contis;
}
/** Coupe continentale du club de l'utilisateur (ou null). */
export function userConti(state, clubId = state.userClubId) {
  return Object.values(ensureContis(state)).find((c) => c.teams.includes(clubId)) || null;
}
/** Zones de qualification continentale d'un championnat : [{ id, name, short, color, from, to }]. */
export function contiZones(div) {
  return Object.values(CONTI_COMPS).filter((c) => c.byDiv[div]).map((c) => ({ id: c.id, name: c.name, short: c.short, color: c.color, from: c.byDiv[div].from, to: c.byDiv[div].from + c.byDiv[div].n }))
    .sort((a, b) => a.from - b.from);
}

/* ---------------- Création ---------------- */

/** Nouveau monde (avant le choix du club). */
export function newGame(seed = (Date.now() >>> 0), { real = null } = {}) {
  const rng = createRng(seed);
  // Monde réel : seulement les championnats présents dans les données.
  const divs = real ? REAL_DIVS(real) : null;
  applyWorld(real ? 'real' : 'fictional', divs);
  const world = real ? createRealWorld(rng, real) : createWorld(rng);
  if (real) setNextId(world.nextId);
  world.clubs.forEach(initClubExtras);
  const state = {
    version: SAVE_VERSION, seed, season: 2026, day: 0, userClubId: null, rngState: rng.getState(),
    clubs: world.clubs, players: world.players, freeAgents: world.freeAgents, nextId: getNextId(),
    messages: [], pendingOffers: [], history: [], settings: { var: true, speed: 1, replays: false, audio: false, v2: 1 },
    board: { confidence: 60 }, lastResult: null, seasonOver: false,
    coach: null, scout: {}, scoutQueue: [], nations: {}, lastFinal: null, friends: { teams: [] }, news: [],
    world: real ? 'real' : 'fictional', worldDivs: divs, dataSeason: real?.season || null,
  };
  ensureManagers(state);
  // Monde réel : les vrais entraîneurs prennent place sur les bancs.
  for (const co of world.coaches || []) {
    const m = state.managers[clubById(state, co.clubId)?.managerId];
    if (!m || !co.name) continue;
    const parts = co.name.split(' ');
    m.first = parts.length > 1 ? parts[0] : ''; m.last = parts.length > 1 ? parts.slice(1).join(' ') : parts[0];
    m.name = m.first ? `${m.first[0]}. ${m.last}` : m.last; m.fullName = co.name;
    if (co.nat) m.nat = co.nat;
    if (co.age) m.age = co.age;
    if (co.ph) m.photo = co.ph;
  }
  applyTop100(state);   // notes du top 100 intégré (monde réel)
  assignAllTraits(state); // traits (Magicien, Maestro…) d'après les vraies qualités
  return state;
}

/** Le joueur choisit son club : on prépare la saison. */
export function startCareer(state, clubId, coach = null) {
  state.userClubId = clubId;
  const club = userClub(state);
  initClubExtras(club);
  // Carrière réaliste : le coach déjà créé (réputation, parcours) arrive au club qui l'a choisi.
  state.coach = ensureCoachProfile(coach ? { ...newCoach(club), ...coach, clubs: [club.name] } : newCoach(club));
  onUserArrives(state, club);
  // Effectif incomplet (sources réelles insuffisantes) : il faudra recruter.
  if (club.playerIds.length < 20) pushMessage(state, { prio: 1, icon: '⚠', title: `Effectif incomplet : ${club.playerIds.length} joueurs`, text: 'Les sources réelles ne listent pas assez de joueurs pour ce club. Recrutez au mercato (joueurs libres, prêts, transferts) pour atteindre au moins 20 joueurs dont 2 gardiens.', action: { type: 'scouting' } });
  // Centre de formation : une première génération de jeunes (16-18 ans) attend le nouveau coach.
  if (!(club.youthIds || []).length) {
    const yr = createRng(hashSeed(`centre-${state.seed}-${club.id}`));
    club.youthIds = club.youthIds || [];
    for (let i = 0; i < 3 + (club.academy >= 4 ? 1 : 0); i++) { const y = intakeYouth(yr, club); state.players[y.id] = y; club.youthIds.push(y.id); }
  }
  ensureStaff(state);
  ensureBoard(state);
  ensureLife(state);
  const squad = clubPlayers(state, club);
  const best = aiPrepare(squad, squad, true, null);
  club.tactics = { ...best.tactics, mentality: 'balanced', pressing: 'mid' };
  club.lineup = best.lineup; club.bench = best.bench;
  createSeason(state);
  pushMessage(state, { prio: 1, icon: '👋', title: `Bienvenue à ${club.name} !`, text: `Objectif du board : ${state.objectives.league.label}.` });
}

/**
 * Carrière réaliste : clubs qui proposent un poste à un coach débutant, selon sa réputation.
 * Un club recrute un entraîneur dont la réputation correspond à son standing (rép. ≈ 25 + rép. du club / 4).
 */
export function startingOffers(state, coach, n = 5) {
  const rng = createRng(hashSeed(`offres-${state.seed}-${coach.firstName}-${coach.lastName}`));
  const cap = (coach.rep - 25) / 0.25 + 8;
  let pool = state.clubs.filter((c) => c.rep <= cap && c.rep >= cap - 20);
  if (pool.length < n) pool = state.clubs.slice().sort((a, b) => a.rep - b.rep).slice(0, 40);
  const natOf = (c) => COUNTRIES[c.country]?.name;
  const w = (c) => (natOf(c) === coach.nationality ? 4 : 1) * (0.5 + (c.rep - (cap - 20)) / 20);
  const out = [], seen = new Set();
  for (let guard = 0; out.length < n && guard < 400; guard++) {
    const c = pool[rng.weightedIndex(pool.map(w))];
    if (!c || out.includes(c) || (seen.has(c.country) && guard < 200)) continue;
    seen.add(c.country); out.push(c);
  }
  return out.map((c) => ({ id: c.id, wage: Math.round((3000 + c.rep * c.rep * 6) / 1000) * 1000 }));
}

/** Calendrier aller-retour (méthode du cercle). */
export function roundRobin(ids, rng) {
  const teams = rng.shuffle(ids.slice());
  const n = teams.length;
  const rounds = [];
  for (let r = 0; r < n - 1; r++) {
    const round = [];
    for (let i = 0; i < n / 2; i++) {
      const a = teams[i], b = teams[n - 1 - i];
      round.push(r % 2 === 0 ? { h: a, a: b, s: null } : { h: b, a: a, s: null });
    }
    rounds.push(round);
    teams.splice(1, 0, teams.pop());
  }
  const back = rounds.map((rd) => rd.map((f) => ({ h: f.a, a: f.h, s: null })));
  return [...rounds, ...back];
}

/** Divisions du monde réel couvertes par les données (identifiants de championnat → divisions). */
const REAL_SOURCES = { ENG1: 1, ESP1: 2, ITA1: 3, GER1: 4, FRA1: 5, POR1: 6, NED1: 7, BEL1: 8, TUR1: 9, CZE1: 10,
  GRE1: 11, NOR1: 12, POL1: 13, DEN1: 14, AUT1: 15, SUI1: 16, SCO1: 17, SWE1: 18, CRO1: 19, SRB1: 20,
  BRA1: 21, KSA1: 22, MEX1: 23, JPN1: 24, RUS1: 25, UKR1: 26, ROU1: 27, HUN1: 28, CYP1: 29, ISR1: 30,
  ENG2: 31, ESP2: 32, ITA2: 33, GER2: 34, FRA2: 35,
  KOR1: 36, CHN1: 37, AUS1: 38, UAE1: 39, QAT1: 40, MAR1: 41, PER1: 42, CHI1: 43, COL1: 44, URU1: 45,
  USA1: 46, ARG1: 47, EGY1: 48, ECU1: 49, RSA1: 50,
  SVK1: 51, BUL1: 52, ALG1: 53, TUN1: 54, PAR1: 55 };
const REAL_DIVS = (data) => [...new Set(data.clubs.map((c) => REAL_SOURCES[c.league]).filter(Boolean))].sort((a, b) => a - b);

const clubsOfDiv = (state, div) => state.clubs.filter((c) => c.div === div);

/**
 * Journée de championnat jouée par une division au créneau r (0-37) du calendrier.
 * Les championnats à 18 clubs (34 journées) sautent 4 créneaux, répartis sur la saison.
 */
let SLOTS = 38; // créneaux de championnat de la saison (46 avec le Championship : matchs en semaine)
/** Nombre de créneaux de championnat de la saison en cours (à appeler avec l'état chargé). */
export function syncLeagueSlots(state) { SLOTS = state?.leagueSlots || 38; return SLOTS; }
export function leagueRoundOf(nRounds, r) {
  if (nRounds >= SLOTS) return r < nRounds ? r : null;
  const idx = Math.floor(r * nRounds / SLOTS);
  const prev = r > 0 ? Math.floor((r - 1) * nRounds / SLOTS) : -1;
  return idx !== prev ? idx : null;
}

export function createSeason(state) {
  const rng = gameRng(state);
  state.fixtures = {};
  state.tables = {};
  for (const div of DIV_IDS) {
    const ids = clubsOfDiv(state, div).map((c) => c.id);
    // Petits championnats : 3 ou 4 confrontations par saison, comme en vrai (Écosse 33 journées, Croatie 36).
    const cycles = ids.length <= 10 ? 4 : ids.length <= 12 ? 3 : 2;
    let fx = roundRobin(ids, rng);
    // Très grands championnats (MLS, Argentine : 30 clubs) : une seule confrontation (29 journées).
    if (ids.length >= 26) fx = fx.slice(0, ids.length - 1);
    if (cycles > 2) fx = fx.concat(roundRobin(ids, rng).slice(0, (cycles - 2) * (ids.length - 1)));
    state.fixtures[div] = fx;
    state.tables[div] = {};
    for (const id of ids) state.tables[div][id] = { p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, pts: 0, form: [] };
  }
  // Calendrier : créneaux de championnat (38, ou plus si un championnat en compte davantage :
  // 46 journées en Championship, jouées en partie en semaine) + coupes + coupe continentale + trêves.
  const L = Math.max(38, ...DIV_IDS.map((d) => state.fixtures[d].length));
  state.leagueSlots = L;
  syncLeagueSlots(state);
  const at = (r38) => Math.round(r38 * L / 38);
  const mid = new Set(Array.from({ length: L - 38 }, (_, k) => Math.round((k + 1) * L / (L - 38 + 1))));
  state.calendar = [];
  createSupers(state);
  if (Object.keys(state.supers).length) state.calendar.push({ type: 'super', round: 0, lr: 0 });
  for (let r = 0; r < L; r++) {
    state.calendar.push({ type: 'league', round: r, lr: r, mid: mid.has(r), wb: r === at(18) });
    const k = CUP_AFTER.findIndex((x) => at(x) === r);
    if (k >= 0) state.calendar.push({ type: 'cup', round: k, lr: r + 1 });
    const c = CONTI_AFTER.findIndex((x) => at(x) === r);
    if (c >= 0) state.calendar.push({ type: 'conti', round: c, lr: r + 1 });
    const i = INTL_AFTER.findIndex((x) => at(x) === r);
    if (i >= 0) state.calendar.push({ type: 'intl', round: i, lr: r + 1 });
  }
  // Coupes nationales : France 32 clubs (5 tours), Ibérie et Albion 16 clubs (4 tours).
  state.cups = {};
  for (const country of Object.keys(COUNTRIES)) {
    const clubs = state.clubs.filter((c) => c.country === country).sort((a, b) => (DIVISIONS[a.div].level - DIVISIONS[b.div].level) || b.rep - a.rep);
    const n = Math.min(32, Math.pow(2, Math.floor(Math.log2(Math.max(2, clubs.length))))); // 32 ou 16 clubs selon le pays
    state.cups[country] = { name: COUNTRIES[country].cup, alive: clubs.slice(0, n).map((c) => c.id), rounds: [], nRounds: Math.log2(n), winner: null };
  }
  createContis(state, rng);
  state.intl = { breaks: [] };
  assignDates(state.calendar, state.season);
  state.day = 0;
  state.seasonOver = false;
  state.lastResult = null;
  forEachHuman(state, () => {
    if (!state.userClubId) return;
    setObjectives(state);
    startPreseason(state);
    if (state.coach) lifeSeasonStart(state);
  });
}

/** Supercoupes : champion contre vainqueur de la coupe (ou dauphin) de la saison précédente. */
function createSupers(state) {
  const prev = state.supers || {};
  state.supers = {};
  for (const country of Object.keys(COUNTRIES)) {
    const name = superCupName(country);
    const div = DIV_IDS.find((d) => DIVISIONS[d].country === country && DIVISIONS[d].level === 1);
    if (!name || !div) continue;
    const order = state.lastFinal?.[div]?.filter((id) => clubById(state, id)?.div === div)
      || clubsOfDiv(state, div).sort((a, b) => b.rep - a.rep).map((c) => c.id);
    const champ = order[0];
    let other = state.cups?.[country]?.winner;
    if (!other || other === champ || !clubById(state, other)) other = order[1];
    if (!champ || !other) continue;
    state.supers[country] = { name, h: champ, a: other, s: null, prev: prev[country]?.w || null };
  }
}

/**
 * Phase de ligue : chaque club affronte 2 adversaires de chacun des 4 chapeaux (1 à domicile,
 * 1 à l'extérieur), jamais un club de son pays si possible, réparti sur 8 journées.
 * Retourne 8 listes de matchs.
 */
function leaguePhaseDraw(state, ids, rng) {
  const N = ids.length, n = N / 4;
  const seeded = ids.map((id) => clubById(state, id)).sort((x, y) => y.rep - x.rep).map((c) => c.id);
  const ctry = (id) => clubById(state, id)?.country;
  const build = () => {
    const pots = [0, 1, 2, 3].map((k) => rng.shuffle(seeded.slice(k * n, k * n + n)));
    const E = [];
    for (let i = 0; i < 4; i++) {
      const P = pots[i];
      for (let k = 0; k < n; k++) E.push([P[k], P[(k + 1) % n]]);
      for (let j = i + 1; j < 4; j++) {
        const Q = rng.shuffle(pots[j]);
        for (let k = 0; k < n; k++) { E.push([P[k], Q[k]]); E.push([Q[(k + 1) % n], P[k]]); }
      }
    }
    return E;
  };
  // Coloration des matchs en journées (chaque club joue une fois par journée), heuristique « DSatur ».
  const color = (E) => {
    const used = new Map(ids.map((id) => [id, 0]));
    const days = Array.from({ length: LP_DAYS }, () => []);
    const rem = E.slice();
    const free = (x, y) => ~(used.get(x) | used.get(y)) & ((1 << LP_DAYS) - 1);
    const bits = (m) => { let c = 0; for (; m; m &= m - 1) c++; return c; };
    while (rem.length) {
      let best = -1, bs = 99;
      for (let i = 0; i < rem.length; i++) {
        const c = bits(free(rem[i][0], rem[i][1]));
        if (c < bs || (c === bs && rng.next() < 0.3)) { bs = c; best = i; }
      }
      if (!bs) return null;
      const [h, a] = rem[best], m = free(h, a);
      const opts = []; for (let d = 0; d < LP_DAYS; d++) if (m & (1 << d)) opts.push(d);
      const d = rng.pick(opts);
      used.set(h, used.get(h) | (1 << d)); used.set(a, used.get(a) | (1 << d));
      days[d].push({ h, a, s: null, g: 0 });
      rem.splice(best, 1);
    }
    return days;
  };
  for (let t = 0; t < 600; t++) {
    const E = build();
    if (t < 400 && E.some(([x, y]) => ctry(x) === ctry(y))) continue;
    for (let k = 0; k < 6; k++) { const d = color(E); if (d) return d; }
  }
  // Repli (très improbable) : 8 tours d'un championnat à la ronde.
  const L = rng.shuffle(ids.slice()), days = [];
  for (let r = 0; r < LP_DAYS; r++) {
    const ds = [];
    for (let i = 0; i < N / 2; i++) { const x = i === 0 ? L[0] : L[1 + ((r + i - 1) % (N - 1))], y = L[1 + ((r + N - 1 - i - 1) % (N - 1))]; ds.push(r % 2 ? { h: y, a: x, s: null, g: 0 } : { h: x, a: y, s: null, g: 0 }); }
    days.push(ds);
  }
  return days;
}

const GROUP_PAIRS6 = [[[0, 1], [2, 3]], [[0, 2], [1, 3]], [[0, 3], [1, 2]], [[1, 0], [3, 2]], [[2, 0], [3, 1]], [[3, 0], [2, 1]]];

/**
 * Coupes continentales : qualification (classement final précédent ou réputation), tirage,
 * prime de participation. Format 2024 (phase de ligue à 36) dès que la coupe compte au moins
 * 24 clubs ; sinon 4 groupes de 4 en aller-retour. Les deux finissent par des matchs secs.
 */
function createContis(state, rng) {
  delete state.conti;
  state.contis = {};
  for (const def of Object.values(CONTI_COMPS)) {
    const teams = [];
    for (const [div, { from, n }] of Object.entries(def.byDiv)) {
      if (!DIV_IDS.includes(+div)) continue;
      const order = state.lastFinal?.[div]?.filter((id) => clubById(state, id)?.div === +div)
        || clubsOfDiv(state, +div).sort((a, b) => b.rep - a.rep).map((c) => c.id);
      teams.push(...order.slice(from, from + n));
    }
    const uniq = [...new Set(teams)];
    if (uniq.length < 16) continue;
    const league = uniq.length >= 24;
    const size = league ? Math.min(36, uniq.length - (uniq.length % 4)) : 16;
    const ts = uniq.slice(0, size);
    const table = {};
    const rounds = Array(17).fill(null);
    let groups;
    if (league) {
      groups = [ts.slice()];
      leaguePhaseDraw(state, ts, rng).forEach((d, i) => { rounds[i] = d; });
      for (const id of ts) table[id] = { p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, pts: 0, g: 0 };
    } else {
      const seeded = ts.map((id) => clubById(state, id)).sort((a, b) => b.rep - a.rep).map((c) => c.id);
      const pots = [0, 1, 2, 3].map((k) => rng.shuffle(seeded.slice(k * 4, k * 4 + 4)));
      groups = [0, 1, 2, 3].map((g) => pots.map((p) => p[g]));
      GROUP_PAIRS6.forEach((pairs, r) => { rounds[r] = groups.flatMap((g, gi) => pairs.map(([x, y]) => ({ h: g[x], a: g[y], s: null, g: gi }))); });
      groups.forEach((g, gi) => g.forEach((id) => { table[id] = { p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, pts: 0, g: gi }; }));
    }
    state.contis[def.id] = { v: 3, fmt: league ? 'league' : 'groups', id: def.id, name: def.name, teams: ts, groups, rounds, table, ko: [], alive: ts.slice(), winner: null };
    for (const id of ts) payPrize(state, id, def.prize.part, `${def.name} · participation`);
  }
}

/** Tours à élimination directe d'une coupe (format 2024) : [{ n, k: [aller, retour] | [finale] }]. */
const stagesOf = (c) => (c.v === 2 ? STAGES_V2 : STAGES)[c.fmt === 'league' ? 'league' : 'groups'];
const stageAt = (c, k) => { const st = stagesOf(c); const i = st.findIndex((x) => x.k.includes(k)); return i < 0 ? null : { i, st: st[i], leg: st[i].k.length === 2 ? st[i].k.indexOf(k) + 1 : 0, all: st }; };
const koSlots = (c) => stagesOf(c).flatMap((x) => x.k);
/** Nom du tour joué au créneau k (calendrier de la saison). */
export function contiRoundName(c, k) {
  if (!c?.v) return CONTI_ROUND_NAMES[k] || '';
  const sa = stageAt(c, k);
  if (sa) return sa.leg ? `${sa.st.n} · ${sa.leg === 1 ? 'aller' : 'retour'}` : sa.st.n;
  if (c.fmt === 'league') return k < LP_DAYS ? `Phase de ligue · J${k + 1}` : '';
  return k < 6 ? `Groupes · J${k + 1}` : '';
}
/** Matchs (références) d'une coupe au créneau k, ou [] (pas de match pour cette coupe ce jour-là). */
export function contiFixturesAt(c, k) {
  if (!c?.v) return (k < 3 ? c.gfix[k] : c.ko[k - 3]) || [];
  return c.rounds[k] || [];
}
/** Tours à élimination directe déjà tirés : [{ name, ties }] (aller-retour : score cumulé). */
export function contiKnockouts(c) {
  if (!c?.v) return c.ko.map((ties, r) => ({ name: CONTI_ROUND_NAMES[r + 3], ties }));
  return stagesOf(c).filter((x) => c.rounds[x.k[0]]).map((x) => {
    if (x.k.length === 1) return { name: x.n, ties: c.rounds[x.k[0]] };
    const l1 = c.rounds[x.k[0]], l2 = c.rounds[x.k[1]] || [];
    return { name: `${x.n} (aller-retour)`, ties: l1.map((f, i) => {
      const r = l2[i];
      const s = f.s && r?.s ? [f.s[0] + r.s[1], f.s[1] + r.s[0]] : null;
      return { h: f.h, a: f.a, s, w: r?.w, pens: r?.pens ? [r.pens[1], r.pens[0]] : null, sub: [f.s && `${f.s[0]}-${f.s[1]}`, r?.s && `${r.s[1]}-${r.s[0]}`].filter(Boolean).join(' · ') };
    }) };
  });
}
/** Nombre de clubs qualifiés par groupe / zones de la phase de ligue (pour l'affichage). */
export function contiZonesOf(c) {
  if (c?.fmt === 'league') return { direct: 8, playoff: Math.min(24, c.teams.length) };
  return { direct: 2, playoff: 2 };
}

export function contiGroupTable(state, g, id = null) {
  const cs = ensureContis(state);
  const c = cs[id] || userConti(state) || Object.values(cs)[0];
  return c.groups[g].map((id) => ({ id, club: clubById(state, id), ...c.table[id], gd: c.table[id].gf - c.table[id].ga }))
    .sort((a, b) => b.pts - a.pts || b.gd - a.gd || b.gf - a.gf || (b.w - a.w) || ((clubById(state, b.id)?.rep || 0) - (clubById(state, a.id)?.rep || 0)));
}

/* ---------------- Objectifs du board ---------------- */

export function setObjectives(state) {
  const club = userClub(state);
  const level = DIVISIONS[club.div].level;
  const divClubs = clubsOfDiv(state, club.div)
    .map((c) => ({ c, s: squadStrength(clubPlayers(state, c)) })).sort((a, b) => b.s - a.s);
  const expected = divClubs.findIndex((x) => x.c.id === club.id) + 1;
  const nDown = DIVISIONS[club.div].down || 0;
  const hasRelegation = nDown > 0;
  const nClubs = divClubs.length;
  let target, label;
  if (level === 1) {
    if (expected <= 2) { target = 1; label = 'Être champion'; }
    else if (expected <= 5) { target = 4; label = 'Finir dans le top 4'; }
    else if (expected <= 10) { target = 10; label = 'Finir dans la 1re moitié'; }
    else { target = hasRelegation ? nClubs - nDown : Math.min(15, nClubs - 2); label = hasRelegation ? 'Assurer le maintien' : `Finir dans le top ${Math.min(15, nClubs - 2)}`; }
  } else {
    if (expected <= 4) { target = DIVISIONS[club.div].up || 3; label = `Monter en ${DIVISIONS[DIVISIONS[club.div].upper]?.name || 'Division 1'}`; }
    else if (expected <= 10) { target = 8; label = 'Finir dans le top 8'; }
    else { target = 15; label = 'Finir dans le top 15'; }
  }
  const cup = state.cups[club.country];
  const inCup = cup.alive.includes(club.id);
  const cupTarget = !inCup ? null : expected <= 3 && level === 1 ? cup.nRounds - 2 : level === 1 ? 1 : 0;
  const myConti = userConti(state, club.id);
  state.objectives = {
    league: { target, label, expected },
    cup: cupTarget == null ? null : { target: cupTarget, label: `${cup.name} : passer ${cupTarget + 1} tour(s)` },
    conti: myConti ? { target: expected <= 2 ? 4 : 3, label: `${myConti.name} : ${expected <= 2 ? 'atteindre les demies' : myConti.fmt === 'league' ? 'sortir de la phase de ligue' : 'sortir des poules'}`, id: myConti.id } : null,
    finance: { label: 'Respecter la masse salariale et garder un budget positif' },
  };
  setBoardSeason(state, true);
  state.objectives.identity = { label: `Identité : ${IDENTITIES[state.board.identity].label}`, key: state.board.identity };
  state.objectives.youth = { label: `Jeunes (≤ 21 ans) : ${state.board.youthTarget} % du temps de jeu`, target: state.board.youthTarget };
}

/* ---------------- Classements ---------------- */

export function sortedTable(state, div) {
  return Object.entries(state.tables[div])
    .map(([id, r]) => ({ id: +id, club: clubById(state, +id), ...r, gd: r.gf - r.ga }))
    .sort((a, b) => b.pts - a.pts || b.gd - a.gd || b.gf - a.gf || a.club.name.localeCompare(b.club.name));
}

export function tablePosition(state, clubId) {
  const club = clubById(state, clubId);
  return sortedTable(state, club.div).findIndex((r) => r.id === clubId) + 1;
}

/** Meilleurs buteurs (championnat) d'une division. */
export function topScorers(state, div, n = 15) {
  const ids = clubsOfDiv(state, div).flatMap((c) => c.playerIds);
  return ids.map((id) => state.players[id]).filter((p) => p && p.stats.lgoals > 0)
    .sort((a, b) => b.stats.lgoals - a.stats.lgoals || b.stats.assists - a.stats.assists).slice(0, n);
}

/* ---------------- Sélections nationales ---------------- */

/** Joueurs sélectionnables par nation (joueurs sous contrat). */
const POOL_CACHE = new WeakMap();
export function nationPools(state) {
  // Mis en cache par journée (l'écran Sélections l'appelait des dizaines de fois : très lent).
  const key = `${state.season}-${state.day}-${state.preseason?.date || ''}-${state.freeAgents?.length || 0}`;
  const hit = POOL_CACHE.get(state);
  if (hit && hit.key === key) return hit.pools;
  const pools = computePools(state);
  POOL_CACHE.set(state, { key, pools });
  return pools;
}
function computePools(state) {
  const pools = {};
  for (const c of state.clubs) for (const id of c.playerIds) {
    const p = state.players[id];
    if (!p?.nat) continue;
    (pools[p.nat] = pools[p.nat] || []).push(p);
  }
  for (const n in pools) pools[n].sort((a, b) => overall(b) - overall(a));
  return pools;
}

export function eligibleNations(state) {
  const pools = nationPools(state);
  return Object.keys(pools).filter((n) => pools[n].length >= 16 && pools[n].filter((p) => p.pos === 'GB').length >= 1);
}

export function nationRow(state, n) {
  return (state.nations[n] = state.nations[n] || { elo: 1500, p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0 });
}

export function nationRanking(state) {
  // Elo de départ selon la force réelle de l'effectif (11 meilleurs joueurs).
  const pools = nationPools(state);
  for (const n of eligibleNations(state)) {
    if (state.nations[n]) continue;
    const xi = pools[n].slice(0, 11).map(overall);
    nationRow(state, n).elo = Math.round(1500 + (xi.reduce((a, b) => a + b, 0) / 11 - 70) * 22);
  }
  return Object.entries(state.nations).map(([name, r]) => ({ name, ...r })).sort((a, b) => b.elo - a.elo);
}

/** Sélection : les 23 meilleurs (aptes) de la nation. */
export function nationSquad(state, nation) {
  return (nationPools(state)[nation] || []).filter(isAvailable).slice(0, 23);
}

export function nationClub(nation) {
  const [color, color2] = NATION_COLORS[nation] || ['#888888', '#ffffff'];
  return { id: `N:${nation}`, name: nation, short: nation.normalize('NFD').replace(/[^A-Za-z]/g, '').slice(0, 3).toUpperCase(), color, color2, rep: 80 };
}

function ensureIntlDraw(state, k) {
  if (state.intl.breaks[k]) return;
  const rng = gameRng(state);
  const elig = new Set(eligibleNations(state));
  const ranked = nationRanking(state).filter((r) => elig.has(r.name)).map((r) => r.name);
  // Appariements entre nations de niveau proche (blocs de 4 mélangés).
  const order = [];
  for (let i = 0; i < ranked.length; i += 4) order.push(...rng.shuffle(ranked.slice(i, i + 4)));
  const games = [];
  for (let i = 0; i + 1 < order.length; i += 2) games.push(rng.chance(0.5) ? { h: order[i], a: order[i + 1], s: null } : { h: order[i + 1], a: order[i], s: null });
  state.intl.breaks[k] = games;
}

/* ---------------- Journée ---------------- */

function ensureCupDraw(state, key, round) {
  const cup = state.cups[key];
  if (cup.rounds[round]) return;
  const rng = gameRng(state);
  const ids = rng.shuffle(cup.alive.slice());
  const ties = [];
  for (let i = 0; i + 1 < ids.length; i += 2) ties.push({ h: ids[i], a: ids[i + 1], s: null, neutral: round === cup.nRounds - 1 });
  cup.rounds[round] = ties;
}

/** Vainqueurs d'un tour (dans l'ordre du tableau). */
const stageWinners = (c, st) => (c.rounds[st.k[st.k.length - 1]] || []).map((f) => f.w);

/** Tirage d'un tour à élimination directe (format 2024), dès que le tour précédent est joué. */
function ensureContiKO(state, k, c) {
  if (c.rounds[k]) return;
  const sa = stageAt(c, k);
  if (!sa) return;
  if (sa.leg === 2) {
    // Match retour : on inverse le terrain.
    const l1 = c.rounds[sa.st.k[0]];
    if (l1) c.rounds[k] = l1.map((f) => ({ h: f.a, a: f.h, s: null, leg: 2 }));
    return;
  }
  const legKey = sa.leg === 1 ? { leg: 1 } : {};
  let pairs;
  if (c.fmt === 'league' && sa.i === 0) {
    // Barrages : 9e contre 24e, 10e contre 23e… (le mieux classé reçoit au retour).
    const tab = contiGroupTable(state, 0, c.id);
    pairs = Array.from({ length: 8 }, (_, i) => [tab[23 - i].id, tab[8 + i].id]);
  } else if (c.fmt === 'league' && sa.i === 1) {
    // Huitièmes : les 8 premiers contre les vainqueurs des barrages (le 1er contre le vainqueur de 16e-17e…).
    const tab = contiGroupTable(state, 0, c.id);
    const po = stageWinners(c, sa.all[0]);
    pairs = BRACKET.map((i) => [po[7 - i], tab[i].id]);
  } else if (c.fmt !== 'league' && sa.i === 0) {
    const t = [0, 1, 2, 3].map((g) => contiGroupTable(state, g, c.id));
    c.alive = t.flatMap((g) => [g[0].id, g[1].id]);
    pairs = [[0, 1], [2, 3], [1, 0], [3, 2]].map(([a, b]) => [t[b][1].id, t[a][0].id]);
  } else {
    // Tableau : les vainqueurs de deux confrontations voisines se rencontrent.
    const prev = stageWinners(c, sa.all[sa.i - 1]);
    pairs = [];
    for (let i = 0; i + 1 < prev.length; i += 2) pairs.push([prev[i], prev[i + 1]]);
  }
  const final = sa.i === sa.all.length - 1;
  // Aller-retour : le mieux classé reçoit au retour (il est donc à l'extérieur à l'aller).
  c.rounds[k] = pairs.map(([x, y]) => ({ h: x, a: y, s: null, ...legKey, ...(final ? { neutral: true } : {}) }));
}

function ensureContiDraw(state, k, c) {
  const r = k - 3;
  if (c.ko[r]) return;
  const rng = gameRng(state);
  if (r === 0) {
    const t = [0, 1, 2, 3].map((g) => contiGroupTable(state, g, c.id));
    c.alive = t.flatMap((g) => [g[0].id, g[1].id]);
    c.ko[0] = [[0, 1], [1, 0], [2, 3], [3, 2]].map(([a, b]) => ({ h: t[a][0].id, a: t[b][1].id, s: null }));
  } else {
    const ids = rng.shuffle(c.ko[r - 1].map((x) => x.w));
    c.ko[r] = [];
    for (let i = 0; i + 1 < ids.length; i += 2) c.ko[r].push({ h: ids[i], a: ids[i + 1], s: null, neutral: r === 2 });
  }
}

/** Description de la journée courante et du match de l'utilisateur. */
export function today(state) {
  syncLeagueSlots(state);
  const entry = state.calendar[state.day];
  if (!entry) return null;
  let fixtures = [], label;
  if (entry.type === 'league') {
    for (const div of DIV_IDS) {
      const rr = leagueRoundOf(state.fixtures[div].length, entry.round);
      if (rr != null) fixtures.push(...state.fixtures[div][rr].map((f) => ({ h: f.h, a: f.a, s: f.s, comp: 'league', div, ref: f })));
    }
    const uc0 = state.userClubId ? userClub(state) : null;
    const ur = uc0 ? leagueRoundOf(state.fixtures[uc0.div].length, entry.round) : entry.round;
    label = ur != null ? `Journée ${ur + 1}` : 'Championnat (semaine)';
  } else if (entry.type === 'cup') {
    for (const key of Object.keys(state.cups)) {
      const cup = state.cups[key];
      const cr = entry.round - (5 - cup.nRounds);
      if (cr < 0 || cup.alive.length < 2) continue;
      ensureCupDraw(state, key, cr);
      fixtures.push(...cup.rounds[cr].map((f) => ({ h: f.h, a: f.a, s: f.s, comp: 'cup', key, round: cr, neutral: f.neutral, ref: f })));
    }
    label = `Coupes · ${CUP_ROUND_NAMES[entry.round]}`;
    const uc = userClub(state);
    const ucup = state.cups[uc.country];
    const ucr = entry.round - (5 - ucup.nRounds);
    if (ucr >= 0) label = `${ucup.name} · ${CUP_ROUND_NAMES[ucr + (5 - ucup.nRounds)]}`;
  } else if (entry.type === 'conti') {
    for (const c of Object.values(ensureContis(state))) {
      if (c.v) {
        const k = entry.round;
        const ko = koSlots(c).includes(k);
        if (ko) ensureContiKO(state, k, c);
        const sa = ko ? stageAt(c, k) : null;
        const first = sa?.leg === 2 ? c.rounds[sa.st.k[0]] : null;
        fixtures.push(...(c.rounds[k] || []).map((f, i) => ({ h: f.h, a: f.a, s: f.s, comp: 'conti', key: c.id, group: !ko, ko, neutral: f.neutral, ref: f,
          ...(sa?.leg ? { leg: sa.leg } : {}), ...(first?.[i]?.s ? { agg: [first[i].s[1], first[i].s[0]] } : {}) })));
      } else if (entry.round < 3) fixtures.push(...c.gfix[entry.round].map((f) => ({ h: f.h, a: f.a, s: f.s, comp: 'conti', key: c.id, group: true, ref: f })));
      else {
        ensureContiDraw(state, entry.round, c);
        fixtures.push(...(c.ko[entry.round - 3] || []).map((f) => ({ h: f.h, a: f.a, s: f.s, comp: 'conti', key: c.id, ko: true, neutral: f.neutral, ref: f })));
      }
    }
    const uco = state.userClubId ? userConti(state) : null;
    const lc = uco || Object.values(ensureContis(state)).find((c) => contiFixturesAt(c, entry.round).length);
    label = `${uco ? uco.name : 'Coupes continentales'} · ${contiRoundName(lc, entry.round) || 'Journée continentale'}`;
  } else if (entry.type === 'super') {
    for (const [key, sc] of Object.entries(state.supers || {})) fixtures.push({ h: sc.h, a: sc.a, s: sc.s, comp: 'super', key, neutral: true, ref: sc });
    const us = state.userClubId ? state.supers?.[userClub(state).country] : null;
    label = us ? us.name : 'Supercoupes';
  } else {
    ensureIntlDraw(state, entry.round);
    fixtures = state.intl.breaks[entry.round].map((f) => ({ h: f.h, a: f.a, s: f.s, comp: 'intl', ref: f }));
    label = `${breakLabel(state)} · trêve ${entry.round + 1}/3`;
  }
  const uf = fixtures.find((f) => f.comp !== 'intl' && (f.h === state.userClubId || f.a === state.userClubId)) || null;
  return { entry, fixtures, label, userFixture: uf };
}

/** Maîtrise tactique (0-100) → rendement : 0,97 (plan tout neuf) à 1,01 (automatismes). */
export const familiarityMult = (club) => 0.97 + 0.04 * ((club.fam ?? 60) / 100);

/** Configuration d'équipe pour le moteur. */
export function teamCfg(state, club, opponent, isHome, isUser) {
  const players = clubPlayers(state, club);
  if (isUser) {
    validateUserLineup(state);
    return { club, players, lineup: club.lineup.slice(), bench: club.bench.slice(), tactics: { ...club.tactics }, isAI: false, talk: matchMods(state)?.me || 0,
      roles: (club.roles || []).slice(), setPieces: { ...(club.setPieces || {}) }, pi: (club.pi || []).map((x) => ({ ...x })), injuryMod: staffEffects(club).injuryMod,
      coachMods: (() => { const cm = coachMods(state.coach); return { ...cm, perf: cm.perf * staffEffects(club).perf * familiarityMult(club) * cohMult(teamCohesion(state, club, club.lineup)) * (club.training?.oppPrep ? 1.008 : 1) * (optInfo(state, 'difficulty').perf || 1) }; })(), ...captainCfg(state, club) };
  }
  const rng = createRng(hashSeed(`${state.seed}-${state.season}-${state.day}-${club.id}`));
  const style = managerStyle(state, club);
  const prep = aiPrepare(players, opponent ? clubPlayers(state, opponent) : players, isHome, rng, style);
  return { club, players, lineup: prep.lineup, bench: prep.bench, tactics: prep.tactics, isAI: true,
    talk: opponent && opponent.id === state.userClubId ? (matchMods(state)?.opp || 0) : 0,
    coachMods: { perf: (style ? style.perf : 1) * cohMult(clubCoh(club)), talk: 1, cards: 1, fatigue: 1 }, ...captainCfg(state, club) };
}

function nationCfg(state, nation, oppSquad, isHome) {
  const players = nationSquad(state, nation);
  const rng = createRng(hashSeed(`${state.seed}-${state.season}-${state.day}-${nation}`));
  const prep = aiPrepare(players, oppSquad, isHome, rng);
  return { club: nationClub(nation), players, lineup: prep.lineup, bench: prep.bench, tactics: prep.tactics, isAI: true };
}

/** Configuration moteur d'une rencontre (championnat, coupe, continentale, sélection). */
export function matchCfgFor(state, f) {
  const entry = state.calendar?.[state.day];
  const hostCountry = f.comp === 'intl' ? 'FRA' : clubById(state, f.h)?.country || 'FRA';
  const weather = matchConditions({ seed: state.seed + state.season * 7, country: hostCountry, date: entry?.date, comp: f.comp, midweek: !!entry?.mid || (entry && entry.type !== 'league'), h: f.h, a: f.a });
  const base = { seed: matchSeed(state, f.h, f.a), varEnabled: state.settings.var, neutral: !!f.neutral, weather };
  if (f.comp === 'intl') {
    const hs = nationSquad(state, f.h), as = nationSquad(state, f.a);
    return { ...base, home: nationCfg(state, f.h, as, true), away: nationCfg(state, f.a, hs, false), profile: {} };
  }
  const h = clubById(state, f.h), a = clubById(state, f.a);
  const uid = state.userClubId;
  const knockout = f.comp === 'cup' || f.comp === 'super' || (f.comp === 'conti' && f.ko && f.leg !== 1);
  const prof = { ...(f.comp === 'league' ? DIVISIONS[f.div].profile : f.comp === 'cup' || f.comp === 'super' ? DIVISIONS[h.div].profile : {}) };
  const tens = tension(state, h.id, a.id);
  if (tens > 1) { prof.fouls = (prof.fouls ?? 1) * tens; prof.cards = (prof.cards ?? 1) * tens; }
  const cfg = {
    ...base, cup: knockout, extraTime: knockout, ...(f.agg ? { agg: f.agg } : {}), homeAdv: f.neutral ? 1 : homeAdvantage(h),
    profile: prof,
    home: sideCfg(state, h, a, true, uid),
    away: sideCfg(state, a, h, false, uid),
  };
  // Paramètre de partie : fréquence des blessures (les deux équipes).
  const im = optInfo(state, 'injuries').mult || 1;
  if (im !== 1) for (const sd of [cfg.home, cfg.away]) sd.injuryMod = (sd.injuryMod ?? 1) * im;
  return cfg;
}

/** Équipe d'une rencontre : un club d'un manager humain (en ligne) garde SA compo et SA tactique. */
function sideCfg(state, club, opp, isHome, uid) {
  const hu = humanOfClub(state, club.id);
  // L'autre manager n'est pas là pendant ce match : son équipe garde sa compo et sa tactique,
  // et son adjoint (l'IA) gère les changements.
  if (state.online && hu !== undefined && hu !== state.online.cur) return { ...withHuman(state, hu, () => teamCfg(state, club, opp, isHome, true)), isAI: true };
  return teamCfg(state, club, opp, isHome, club.id === uid);
}

/**
 * Match joué en direct par un manager (en ligne) → match officiel : reconstruit à partir
 * de la configuration figée et de l'instantané de fin, rattaché aux joueurs et clubs de l'état.
 */
function playedToMatch(state, played) {
  let m;
  if (played.cfg) {
    m = createMatch(played.cfg);
    if (!restoreMatch(m, played.snap)) return null;
    for (const t of m.teams) {
      t.club = clubById(state, t.club.id) || t.club;
      for (const mp of [...t.onPitch, ...t.bench, ...t.out]) if (mp && state.players[mp.id]) mp.p = state.players[mp.id];
    }
  } else {
    return null;
  }
  return ['ft', 'done'].includes(m.phase) ? m : null;
}

/**
 * En ligne : le manager doit-il jouer son match en direct avant d'être « Prêt » ?
 * (Un match entre deux managers humains est calculé par l'hôte.)
 */
export function onlineMustPlay(state) {
  if (!state.online || state.preseason?.active || state.seasonOver) return false;
  const f = today(state)?.userFixture;
  if (!f || f.comp === 'intl') return false;
  // Match entre deux managers : c'est le manager qui reçoit qui le joue en direct.
  if (humanOfClub(state, f.h) !== undefined && humanOfClub(state, f.a) !== undefined && state.userClubId !== f.h) return false;
  return state.playedMatch?.key !== fixtureKey(state, f);
}

/** Clé d'une rencontre (pour retrouver le match joué en direct par un manager en ligne). */
export const fixtureKey = (state, f) => `${state.season}-${state.day}-${f.comp}-${f.h}-${f.a}`;

/*
 * MULTIPLEX : les autres matchs de la compétition du manager sont simulés dès le coup d'envoi
 * (mêmes graines que la fin de journée) ; leurs buts sont dévoilés minute par minute pendant
 * son match, et la fin de journée reprend exactement ces résultats (classement en direct = final).
 */
const PRESIM = new WeakMap();
export function presimDay(state) {
  const t = today(state), uf = t?.userFixture;
  if (!uf) return [];
  const dayKey = `${state.season}-${state.day}`;
  let e = PRESIM.get(state);
  if (!e || e.key !== dayKey) { e = { key: dayKey, map: new Map() }; PRESIM.set(state, e); }
  const country = (id) => clubById(state, id)?.country;
  const same = (f) => f.comp === uf.comp && (f.comp === 'league' ? f.div === uf.div : f.comp === 'conti' ? f.key === uf.key && (!uf.group || clubById(state, f.h) && ensureContis(state)[f.key]?.table[f.h]?.g === ensureContis(state)[f.key]?.table[uf.h]?.g) : f.comp === 'cup' ? country(f.h) === country(uf.h) : false);
  const out = [];
  for (const f of t.fixtures) {
    if ((f.h === uf.h && f.a === uf.a) || !same(f)) continue;
    if (humanOfClub(state, f.h) !== undefined || humanOfClub(state, f.a) !== undefined) continue;
    const k = fixtureKey(state, f);
    let m = e.map.get(k);
    if (!m) { m = simulateMatch(matchCfgFor(state, f)); e.map.set(k, m); }
    out.push({ f, m });
  }
  return out;
}
/** Classement en direct : table de la compétition + scores en cours (buts jusqu'à `minute`). */
export function liveTable(state, userScore, minute, ended = false) {
  const t = today(state), uf = t?.userFixture;
  if (!uf) return null;
  let base;
  if (uf.comp === 'league') base = state.tables[uf.div];
  else if (uf.comp === 'conti' && uf.group) {
    const C = ensureContis(state)[uf.key], g = C?.table[uf.h]?.g;
    base = Object.fromEntries(Object.entries(C?.table || {}).filter(([, r]) => r.g === g));
  } else return null;
  const rows = Object.fromEntries(Object.entries(base).map(([id, r]) => [id, { id: +id, p: r.p, pts: r.pts, gf: r.gf, ga: r.ga }]));
  const before = Object.values(rows).map((r) => ({ ...r })).sort((a, b) => b.pts - a.pts || (b.gf - b.ga) - (a.gf - a.ga) || b.gf - a.gf);
  const apply = (h, a, sc) => {
    for (const [id, gf, ga] of [[h, sc[0], sc[1]], [a, sc[1], sc[0]]]) {
      const r = rows[id]; if (!r) continue;
      r.p++; r.gf += gf; r.ga += ga; r.pts += gf > ga ? 3 : gf === ga ? 1 : 0; r.live = true;
    }
  };
  const games = [];
  for (const { f, m } of presimDay(state)) {
    const sc = [0, 0];
    for (const g of m.goals) if (ended || g.minute + (g.extra || 0) / 100 <= minute) sc[g.side]++;
    apply(f.h, f.a, sc); games.push({ h: f.h, a: f.a, s: sc });
  }
  apply(uf.h, uf.a, userScore);
  const sorted = Object.values(rows).sort((a, b) => b.pts - a.pts || (b.gf - b.ga) - (a.gf - a.ga) || b.gf - a.gf);
  const pos0 = Object.fromEntries(before.map((r, i) => [r.id, i]));
  return { rows: sorted.map((r, i) => ({ ...r, club: clubById(state, r.id), move: (pos0[r.id] ?? i) - i })), games };
}

/** S'assure que la compo de l'utilisateur est valide (blessés, suspendus, départs). */
export function validateUserLineup(state) {
  const club = userClub(state);
  const players = clubPlayers(state, club);
  const byId = new Map(players.map((p) => [p.id, p]));
  const slots = slotsOf(club.tactics);
  if (!club.lineup || club.lineup.length !== slots.length) {
    const lu = autoLineup(players, slots);
    club.lineup = lu.lineup; club.bench = lu.bench;
    return [];
  }
  const fixed = [];
  const used = new Set();
  club.lineup = club.lineup.map((id) => {
    const p = byId.get(id);
    if (p && isAvailable(p) && !used.has(id)) { used.add(id); return id; }
    return null;
  });
  club.lineup.forEach((id, i) => {
    if (id) return;
    const cand = players.filter((p) => isAvailable(p) && !used.has(p.id))
      .sort((a, b) => scoreAt(b, slots[i].pos) - scoreAt(a, slots[i].pos))[0];
    if (cand) { club.lineup[i] = cand.id; used.add(cand.id); fixed.push(cand); }
  });
  club.bench = (club.bench || []).filter((id) => byId.has(id) && isAvailable(byId.get(id)) && !used.has(id));
  const rest = players.filter((p) => isAvailable(p) && !used.has(p.id) && !club.bench.includes(p.id)).sort((a, b) => overall(b) - overall(a));
  while (club.bench.length < 9 && rest.length) club.bench.push(rest.shift().id);
  return fixed;
}
const scoreAt = (p, pos) => ratingAt(p, pos) * (1 - (p.fatigue || 0) / 400);

/** Configuration complète du match de l'utilisateur. */
export function userMatchCfg(state) {
  const t = today(state);
  if (!t || !t.userFixture) return null;
  return matchCfgFor(state, t.userFixture);
}

/**
 * Termine la journée : simule les autres matchs, applique tous les résultats,
 * met à jour joueurs, finances, IA, messages. Retourne un rapport.
 */
export function completeDay(state, userMatch = null) {
  // La saison démarre : fin de la préparation (réunion acceptée par défaut), pour chaque manager.
  forEachHuman(state, () => {
    if (state.preseason?.active) { if (!state.preseason.meeting) state.preseason.meeting = true; state.preseason.active = false; }
    ensureLife(state);
  });
  const rng = gameRng(state);
  const t = today(state);
  const cur = curHuman(state);
  const report = { label: t.label, type: t.entry.type, results: [], injuries: [], suspensions: [], callups: [], finance: 0, userSummary: null, cupOut: false };
  const played = new Set();
  const ctx = { newlyHurt: new Set(), newlySusp: new Set(), report, rng, cur };
  const budgetBefore = {};
  if (state.online) state.online.replays = {}; // les différés de la veille ne servent plus
  forEachHuman(state, (h) => { budgetBefore[h] = userClub(state).budget; });

  for (const f of t.fixtures) {
    const hh = f.comp === 'intl' ? [] : [humanOfClub(state, f.h), humanOfClub(state, f.a)].filter((h) => h !== undefined);
    let m;
    if (userMatch && hh.includes(cur)) m = userMatch;
    else {
      // En ligne : un manager a joué ce match en direct sur son appareil → on reprend son match.
      const key = fixtureKey(state, f);
      // Le match est joué par le manager concerné (entre deux managers : celui qui reçoit).
      const owner = hh.length === 1 ? hh[0] : hh.length === 2 ? humanOfClub(state, f.h) : undefined;
      const played = owner !== undefined ? withHuman(state, owner, () => (state.playedMatch?.key === key ? state.playedMatch : null)) : null;
      m = played ? playedToMatch(state, played) : null;
      // Multiplex : on reprend le match déjà simulé pendant celui du manager (même résultat).
      if (!m) { const e = PRESIM.get(state); if (e?.key === `${state.season}-${state.day}`) m = e.map.get(key) || null; }
      if (!m) m = simulateMatch(matchCfgFor(state, f));
      else if (state.online) {
        // Différé pour les autres managers : configuration figée + journal des décisions.
        state.online.replays = state.online.replays || {};
        state.online.replays[key] = { key, h: f.h, a: f.a, label: t.label, cfg: played.cfg, journal: played.journal || [], score: m.score.slice(), by: owner };
      }
      for (const h of hh) withHuman(state, h, () => { if (state.playedMatch?.key === key) state.playedMatch = null; });
    }
    if ((f.comp === 'cup' || f.comp === 'super' || (f.ko && f.leg !== 1)) && tieLevel(m) && !m.shootout) penaltyShootout(m);
    const sum = summarize(m);
    applyResult(state, f, sum, m, ctx);
    lifeAfterFixture(state, f, sum);
    if (f.comp !== 'intl') { played.add(f.h); played.add(f.a); }
    report.results.push({ h: f.h, a: f.a, s: sum.score, pens: sum.shootout ? sum.shootout.score : null, div: f.div, comp: f.comp, key: f.key });
    // Match d'un manager humain (les deux, s'ils s'affrontent).
    for (const h of hh) withHuman(state, h, () => {
      const uc = userClub(state);
      if (h === cur) report.userSummary = sum;
      const side = f.h === uc.id ? 0 : 1;
      coachAfterMatch(state, sum.score[side], sum.score[1 - side], clubById(state, side === 0 ? f.a : f.h));
      ensureBoard(state);
      recordUserMatch(state, sum, side, m);
      cohesionAfterUserMatch(state, m, side, sum.score[side] > sum.score[1 - side]);
      seeInMatch(state, m, 1 - side);
      lifeAfterUserMatch(state, digestMatch(state, sum, m, side, f), rng, f, t.entry);
      { // Le journal raconte le match du manager.
        const hc = clubById(state, f.h), ac = clubById(state, f.a), sc = sum.goals.map((g) => g.name).filter(Boolean);
        const best = sum.motm?.name;
        news(state, 'match', `${hc.name} ${sum.score[0]}-${sum.score[1]} ${ac.name}${sc.length ? ` : ${[...new Set(sc)].slice(0, 4).join(', ')} ${sc.length > 1 ? 'ont marqué' : 'a marqué'}` : ''}${best ? `. Homme du match : ${best}` : ''}.`, { clubId: uc.id, pid: sum.motm?.id || null });
      }
      state.lastResult = { day: state.day, h: f.h, a: f.a, s: sum.score, pens: sum.shootout ? sum.shootout.score : null, label: t.label,
        scorers: sum.goals.map((g) => ({ side: g.side, name: g.name, minute: g.minute, pen: g.pen })), motm: sum.motm?.name };
    });
  }

  cohesionDaily(state, report.results);
  if (t.entry.type === 'cup') finishCupRound(state, t, report);
  if (t.entry.type === 'conti') finishContiRound(state, t, report);
  if (t.entry.type === 'super') finishSupers(state, t, report);

  // Mise à jour quotidienne des joueurs (blessures, suspensions, récupération, entraînement).
  for (const c of state.clubs) {
    const hu = humanOfClub(state, c.id);
    const isUser = hu !== undefined;
    let tp, eff = null, cmod = null;
    if (isUser) withHuman(state, hu, () => { eff = staffEffects(c); cmod = coachMods(state.coach); tp = trainingParams(c, true); tp.youthMult = cmod.youth; tp.gkMult = eff.gkMult; });
    else tp = trainingParams(c, false);
    tp = { ...tp, mult: tp.mult * (optInfo(state, 'progression').mult || 1) };
    for (const id of c.playerIds) {
      const p = state.players[id];
      if (!p) continue;
      if (p.injury > 0 && !ctx.newlyHurt.has(p.id)) p.injury--;
      if (p.suspended > 0 && played.has(c.id) && !ctx.newlySusp.has(p.id)) p.suspended--;
      p.fatigue = clamp((p.fatigue || 0) - (20 + p.attrs.phy * 0.08 + (isUser ? eff.recovery + cmod.recovery : 0)) + tp.fatigue, 0, 90);
      if (tp.morale) p.morale = clamp(p.morale + tp.morale, 5, 99);
      if (tp.form) p.form = clamp(p.form + tp.form, 5, 95);
      // Gestion de la charge : un joueur épuisé est mis au repos (récupération, pas de progression).
      const rested = isUser && tp.autoRest && (p.fatigue || 0) > 60;
      if (rested) p.fatigue = clamp(p.fatigue - 12, 0, 90);
      const tev = rested ? null : weeklyTraining(p, rng, p._mins || 0, tp);
      if (tev && isUser) { const tr = updateTraits(p); for (const k of tr.gained) withHuman(state, hu, () => pushMessage(state, { prio: 2, icon: TRAITS[k].icon, title: `${p.name} débloque un trait : ${TRAITS[k].name}`, text: TRAITS[k].desc, action: { type: 'player', pid: p.id } })); for (const k of tr.lost) withHuman(state, hu, () => pushMessage(state, { prio: 3, icon: '📉', title: `${p.name} perd le trait ${TRAITS[k].name}`, text: 'Son niveau ne suffit plus.', action: { type: 'player', pid: p.id } })); }
      if (tev && isUser) { const g = ((c.trainSeason ||= {})[p.id] ||= { up: 0, down: 0 }); if (tev.down) g.down++; else if (!tev.learned) g.up++; }
      if (tev && isUser) (c.trainLog ||= []).unshift({ pid: p.id, day: state.day, ...tev });
      if (tp.injury && p.injury === 0 && rng.chance(tp.injury)) {
        p.injury = rng.int(1, 3); p.injuryName = 'Blessure à l\'entraînement';
        logInjury(state, p, 'Entraînement');
        withHuman(state, hu, () => pushMessage(state, { prio: 2, icon: '✚', title: `${p.name} blessé à l'entraînement`, text: `${p.injury} match(s). Entraînement intense…` }));
      }
      // Rythme de match : il se gagne en jouant, se perd sur le banc ou à l'infirmerie.
      if (p.sharp != null) p.sharp = clamp(p.sharp + (p._mins ? (p._mins / 90) * 7 : p.injury > 0 ? -3 : -1.2), 40, 100);
      p._mins = 0;
    }
    if (isUser) {
      // Jeunes du centre : entraînement hebdomadaire (meilleur centre = progrès plus rapides), tuteur.
      for (const id of c.youthIds || []) {
        const y = state.players[id];
        if (!y) continue;
        const mentor = y.mentor && c.playerIds.includes(y.mentor) ? state.players[y.mentor] : null;
        const ev = weeklyTraining(y, rng, 60, { ...tp, individual: true, mult: tp.mult * (0.85 + (c.academy || 1) * 0.08) * (mentor ? 1.15 : 1) });
        if (mentor) y.morale = clamp(y.morale + 0.4, 5, 99);
        if (ev) (c.trainLog ||= []).unshift({ pid: y.id, day: state.day, youth: true, ...ev });
      }
      // Rapport d'entraînement (40 dernières progressions) et postes appris.
      if (c.trainLog?.length > 40) c.trainLog.length = 40;
      for (const ev of (c.trainLog || []).filter((x) => x.day === state.day && x.learned)) {
        const p = state.players[ev.pid];
        if (p) withHuman(state, hu, () => pushMessage(state, { prio: 2, icon: '🎓', title: `${p.name} maîtrise un nouveau poste`, text: `Il peut désormais jouer ${ev.learned} sans pénalité.` }));
      }
      // Maîtrise tactique : progresse chaque semaine (plus vite avec un thème tactique et un bon adjoint).
      c.fam = clamp((c.fam ?? 60) + (2.5 + (tp.focus === 'tactical' ? 2.5 : 0)) * (eff?.progression || 1), 0, 100);
    }
  }

  applyDayFinances(state, t, report);

  // Monde : mercato de l'IA, entraîneurs, relations, finances des clubs…
  aiTransferActivity(state, rng);
  if (t.entry.type === 'league') managersAfterRound(state, t.entry.round, (id) => tablePosition(state, id));
  lifeWorldDaily(state, rng, t);

  // Chaque manager humain : son club, son vestiaire, son board, ses messages.
  forEachHuman(state, (h) => {
    const uc = userClub(state);
    dailyFacilities(state);
    userTransferOffers(state, rng);
    marketEvents(state, rng);
    scoutDaily(state);
    salesDaily(state, rng);
    // Offres non traitées : elles expirent au bout de 4 jours (les dossiers en cours continuent).
    state.pendingOffers = (state.pendingOffers || []).filter((o) => (o.stage && o.stage !== 'offer') || state.day - o.day <= 3)
      .filter((o) => state.players[o.pid]?.clubId === uc.id);
    if (t.entry.type === 'league' && t.entry.round >= 6 && t.entry.round % 4 === 0) checkPromises(state);
    if (t.entry.type === 'league' && t.entry.round === 19) {
      const y = intakeYouth(rng, uc);
      y.pot = clamp(Math.round(y.pot + coachMods(state.coach).youthPot + staffEffects(uc).youthPot), overall(y) + 3, 95);
      state.players[y.id] = y;
      uc.youthIds.push(y.id);
      pushMessage(state, { prio: 2, icon: '🌱', title: `Un jeune prometteur : ${y.name}`, text: `${y.pos}, ${y.age} ans. Voir le centre de formation.` });
      y.homegrown = true;
    }
    if (t.entry.type === 'league' && t.entry.round === 27) {
      const ending = clubPlayers(state, uc).filter((p) => p.contract <= 1 && !p.onLoanFrom);
      if (ending.length) pushMessage(state, { prio: 1, icon: '✎', title: `${ending.length} contrat(s) expirent en fin de saison`, text: ending.slice(0, 3).map((p) => p.name).join(', ') + (ending.length > 3 ? '…' : '') });
    }
    const callups = report.callupsBy?.[uc.id] || [];
    if (callups.length) pushMessage(state, { prio: 2, icon: '🌍', title: `${callups.length} joueur(s) en sélection`, text: callups.slice(0, 4).join(', ') });
    if (uc.budget < 0 && budgetBefore[h] >= 0) pushMessage(state, { prio: 1, icon: '⚠', title: 'Budget dans le rouge', text: 'Le board demande de vendre ou de réduire la masse salariale.' });
    if (h === cur) report.finance = uc.budget - budgetBefore[h];
    for (const [a, b] of linksWeekly(state, uc, rng)) pushMessage(state, { prio: 2, icon: '⚡', title: `Tension entre ${a.name} et ${b.name}`, text: 'Accrochage à l\'entraînement : les deux joueurs ne s\'entendent pas. Évitez de les associer, ou parlez-leur.', action: { type: 'player', pid: a.id } });
    lifeUserDaily(state, rng, t);
    chatDaily(state, rng);
    updateBoard(state, t, report);
  });
  state.day++;
  // Dossiers de transfert : les réponses arrivent avec les jours qui passent.
  forEachHuman(state, () => dealsDaily(state, rng));
  if (state.day >= state.calendar.length) state.seasonOver = true;
  else {
    const wi = windowInfo(state);
    forEachHuman(state, () => {
      if (wi.deadline) pushMessage(state, { prio: 1, icon: '⏰', title: 'Dernier jour du mercato !', text: `Clôture le ${fmtDate(wi.closes, false)} : jouez le deadline day en direct depuis l'Accueil.` });
      lifeNextDay(state, rng);
    });
  }
  return report;
}


/** Finances d'une journée : salaires (+ staff), sponsors, billetterie (ambiance du stade). */
export function applyDayFinances(state, t, report = {}) {
  const cur = curHuman(state);
  for (const c of state.clubs) {
    const hu = humanOfClub(state, c.id);
    if (hu === undefined) { c.budget += sponsorIncome(c) - wageBill(clubPlayers(state, c)); continue; }
    withHuman(state, hu, () => {
      const wages = wageBill(clubPlayers(state, c)) + staffWages(c);
      const sponsor = userSponsorIncome(state);
      c.budget += sponsor - wages;
      logFinance(state, -wages, 'Salaires'); logFinance(state, sponsor, 'Sponsors');
    });
  }
  for (const f of t.fixtures) {
    if (f.neutral || f.comp === 'intl') continue;
    const h = clubById(state, f.h), a = clubById(state, f.a);
    const formRow = state.tables[h.div]?.[h.id];
    const formPts = formRow && formRow.form.length ? formRow.form.reduce((s, r) => s + (r === 'V' ? 1 : r === 'N' ? 0.4 : 0), 0) / formRow.form.length : 0.5;
    const { attendance, revenue } = matchdayRevenue(h, a, formPts, f.comp !== 'league');
    const bonus = f.comp === 'conti' ? 1.6 : 1;
    const fansK = gateMult(h); // ambiance du stade et politique tarifaire
    h.budget += Math.round(revenue * bonus * fansK);
    const hs = (h.sst ||= emptyClubStats()); hs.att += attendance; hs.attN++;
    const hu = humanOfClub(state, h.id);
    if (hu !== undefined) withHuman(state, hu, () => { logFinance(state, Math.round(revenue * bonus * fansK), `Billetterie (${attendance.toLocaleString('fr-FR')} spect.)`); if (hu === cur) report.attendance = attendance; });
  }

}

function finishCupRound(state, t, report) {
  const uc = userClub(state);
  for (const key of Object.keys(state.cups)) {
    const cup = state.cups[key];
    const cr = t.entry.round - (5 - cup.nRounds);
    if (cr < 0 || !cup.rounds[cr] || cup.winner) continue;
    const winners = cup.rounds[cr].map((f) => f.w);
    const prize = cupPrizes(key)[cr + (5 - cup.nRounds)];
    if (cup.alive.includes(uc.id) && !winners.includes(uc.id)) {
      report.cupOut = true;
      pushMessage(state, { prio: 2, icon: '🏆', title: `Élimination en ${cup.name}`, text: CUP_ROUND_NAMES[cr + (5 - cup.nRounds)] });
    }
    for (const w of winners) payPrize(state, w, prize, `${cup.name} · ${cr === cup.nRounds - 1 ? 'vainqueur' : CUP_ROUND_NAMES[cr + (5 - cup.nRounds)]}`);
    cup.alive = winners;
    if (cr === cup.nRounds - 1) {
      cup.winner = winners[0];
      addHonour(state, winners[0], cup.name, 'cup');
      const wc = clubById(state, winners[0]);
      if (wc.id === uc.id) { state.coach.trophies.push(`${cup.name} ${state.season}`); coachRep(state, 6, `Victoire en ${cup.name}`); }
      pushMessage(state, { prio: wc.id === uc.id ? 1 : 3, icon: '🏆', title: `${wc.name} remporte la ${cup.name} !`, text: '' });
    }
  }
}

/** Fin d'un créneau continental (format 2024) : qualifications, primes, éliminations, titre. */
function finishContiV2(state, c, k) {
  const uc = userClub(state);
  const P = prizeOf(c.id);
  const tier = CONTI_COMPS[c.id]?.tier || 1;
  const mine = c.teams.includes(uc.id);
  const lastPhase = c.fmt === 'league' ? LP_DAYS - 1 : 5;
  if (k === lastPhase) {
    if (c.fmt === 'league') {
      const tab = contiGroupTable(state, 0, c.id);
      tab.slice(0, 8).forEach((x) => payPrize(state, x.id, P.r16 ?? P.qf, `${c.name} · qualification directe pour les 8es`));
      tab.slice(8, 24).forEach((x) => payPrize(state, x.id, P.po ?? 0, `${c.name} · barrages`));
      c.alive = tab.slice(0, 24).map((x) => x.id);
      if (mine) {
        const pos = tab.findIndex((x) => x.id === uc.id) + 1;
        pushMessage(state, { prio: 1, icon: '⭐', title: pos <= 8 ? `Qualifié directement pour les 8es de la ${c.name} !` : pos <= 24 ? `${c.name} : direction les barrages` : `Éliminé en phase de ligue (${c.name})`, text: `${pos}e sur ${tab.length} de la phase de ligue` });
        if (pos <= 8) coachRep(state, tier === 1 ? 2 : 1);
      }
    } else {
      const tabs = [0, 1, 2, 3].map((g) => contiGroupTable(state, g, c.id));
      for (const g of tabs) for (const x of g.slice(0, 2)) payPrize(state, x.id, P.qf, `${c.name} · qualification pour les quarts`);
      c.alive = tabs.flatMap((g) => [g[0].id, g[1].id]);
      if (mine) {
        const g = c.table[uc.id].g;
        const pos = tabs[g].findIndex((x) => x.id === uc.id) + 1;
        pushMessage(state, { prio: 1, icon: '⭐', title: pos <= 2 ? `Qualifié pour les quarts de la ${c.name} !` : `Éliminé en phase de groupes (${c.name})`, text: `${pos}e du groupe ${'ABCD'[g]}` });
        if (pos <= 2) coachRep(state, tier === 1 ? 2 : 1);
      }
    }
    return;
  }
  const sa = stageAt(c, k);
  if (!sa || !c.rounds[k] || sa.leg === 1) return; // rien à régler après un match aller
  const winners = c.rounds[k].map((f) => f.w);
  const names = sa.all.map((x) => x.n);
  const nextName = names[sa.i + 1];
  const prizeKey = { 'Huitièmes de finale': 'r16', 'Quarts de finale': 'qf', 'Demi-finales': 'sf', Finale: 'final' }[nextName] || 'champ';
  const prize = prizeKey === 'r16' ? (P.r16 ?? P.qf) : P[prizeKey];
  for (const w of winners) payPrize(state, w, prize, `${c.name} · ${nextName ? `accès : ${nextName.toLowerCase()}` : 'vainqueur'}`);
  const played = c.rounds[k].some((f) => f.h === uc.id || f.a === uc.id);
  if (played && !winners.includes(uc.id)) pushMessage(state, { prio: 2, icon: '⭐', title: `Élimination en ${c.name}`, text: sa.st.n });
  c.alive = c.fmt === 'league' && sa.i === 0 ? [...contiGroupTable(state, 0, c.id).slice(0, 8).map((x) => x.id), ...winners] : winners;
  const isFinal = sa.i === sa.all.length - 1;
  if (isFinal) {
    c.winner = winners[0];
    addHonour(state, c.winner, c.name, 'conti');
    const wc = clubById(state, c.winner);
    wc.rep = clamp(wc.rep + (tier === 1 ? 3 : tier === 2 ? 2 : 1), 30, 95);
    if (wc.id === uc.id) { state.coach.trophies.push(`${c.name} ${state.season}`); coachRep(state, tier === 1 ? 12 : tier === 2 ? 7 : 5, `Victoire en ${c.name} !`); }
    pushMessage(state, { prio: wc.id === uc.id ? 1 : 2, icon: '⭐', title: `${wc.name} remporte la ${c.name} !`, text: '' });
  }
}

function finishContiRound(state, t, report) {
  const uc = userClub(state);
  const r = t.entry.round;
  for (const c of Object.values(ensureContis(state))) {
    if (c.v) { finishContiV2(state, c, r); continue; }
    const P = prizeOf(c.id);
    const tier = CONTI_COMPS[c.id]?.tier || 1;
    const mine = c.teams.includes(uc.id);
    if (r < 3) {
      if (r !== 2) continue;
      const tabs = [0, 1, 2, 3].map((g) => contiGroupTable(state, g, c.id));
      for (const g of tabs) for (const x of g.slice(0, 2)) payPrize(state, x.id, P.qf, `${c.name} · qualification pour les quarts`);
      if (mine) {
        const g = c.table[uc.id].g;
        const pos = tabs[g].findIndex((x) => x.id === uc.id) + 1;
        pushMessage(state, { prio: 1, icon: '⭐', title: pos <= 2 ? `Qualifié pour les quarts de la ${c.name} !` : `Éliminé en phase de groupes (${c.name})`, text: `${pos}e du groupe ${'ABCD'[g]}${pos <= 2 ? ` · prime de ${money(P.qf)}` : ''}` });
        if (pos <= 2) coachRep(state, tier === 1 ? 2 : 1);
      }
      continue;
    }
    const k = r - 3;
    if (!c.ko[k]) continue;
    const winners = c.ko[k].map((f) => f.w);
    const prize = [P.sf, P.final, P.champ][k];
    for (const w of winners) payPrize(state, w, prize, `${c.name} · ${['accès aux demies', 'accès à la finale', 'vainqueur'][k]}`);
    if (c.alive.includes(uc.id) && !winners.includes(uc.id)) pushMessage(state, { prio: 2, icon: '⭐', title: `Élimination en ${c.name}`, text: CONTI_ROUND_NAMES[r] });
    c.alive = winners;
    if (k === 2) {
      c.winner = winners[0];
      addHonour(state, c.winner, c.name, 'conti');
      const wc = clubById(state, c.winner);
      wc.rep = clamp(wc.rep + (tier === 1 ? 3 : tier === 2 ? 2 : 1), 30, 95);
      if (wc.id === uc.id) { state.coach.trophies.push(`${c.name} ${state.season}`); coachRep(state, tier === 1 ? 12 : tier === 2 ? 7 : 5, `Victoire en ${c.name} !`); }
      pushMessage(state, { prio: wc.id === uc.id ? 1 : 2, icon: '⭐', title: `${wc.name} remporte la ${c.name} !`, text: '' });
    }
  }
}

/** Supercoupes : trophée, prime, réputation. */
function finishSupers(state, t, report) {
  const uc = userClub(state);
  for (const [country, sc] of Object.entries(state.supers || {})) {
    if (!sc.w) continue;
    addHonour(state, sc.w, sc.name, 'super');
    payPrize(state, sc.w, Math.round((1_000_000 * (LEAGUE_WEALTH[country] ?? 0.4)) / 50_000) * 50_000, `${sc.name} · vainqueur`);
    const wc = clubById(state, sc.w);
    if (sc.h === uc.id || sc.a === uc.id) {
      if (wc.id === uc.id) { state.coach.trophies.push(`${sc.name} ${state.season}`); coachRep(state, 2, `${sc.name} remporté`); }
      pushMessage(state, { prio: 1, icon: '🏆', title: wc.id === uc.id ? `${sc.name} remporté !` : `${sc.name} perdu`, text: `${clubById(state, sc.h).name} ${sc.s[0]}-${sc.s[1]} ${clubById(state, sc.a).name}${sc.pens ? ` (${sc.pens[0]}-${sc.pens[1]} t.a.b.)` : ''}` });
    }
  }
}

/** Jeune du centre : le réseau de recrutement des jeunes élève le potentiel et attire des talents étrangers. */
function intakeYouth(rng, c) {
  const rec = c.youthRecruit ?? 2;
  const foreign = rec >= 3 && rng.chance(0.08 + 0.06 * rec);
  const y = createYouth(rng, foreign ? { ...c, country: rng.pick(['BRA', 'ESP', 'POR', 'ITA', 'ENG', 'GER', 'FRA', 'NED']) } : c);
  y.clubId = c.id;
  y.pot = clamp(Math.round(y.pot + (rec - 2) * 3), overall(y) + 3, 95);
  y.homegrown = true;
  return y;
}

/** Statistiques de saison d'un club (toutes compétitions) + journal des matchs des managers. */
export const emptyClubStats = () => ({ m: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, xg: 0, xga: 0, shots: 0, shotsA: 0, onT: 0, poss: 0, passes: 0, passOk: 0,
  fouls: 0, corners: 0, yel: 0, red: 0, cs: 0, hw: 0, hd: 0, hl: 0, aw: 0, ad: 0, al: 0, big: null, worst: null, att: 0, attN: 0 });
function recordClubStats(state, f, sum, m) {
  for (const side of [0, 1]) {
    const c = clubById(state, side ? f.a : f.h);
    if (!c) continue;
    const st = (c.sst ||= emptyClubStats());
    const me = sum.stats[side], th = sum.stats[1 - side];
    const gf = sum.score[side], ga = sum.score[1 - side];
    const r = gf > ga ? 'w' : gf === ga ? 'd' : 'l';
    st.m++; st[r]++; st[(side === 0 && !f.neutral ? 'h' : 'a') + r]++;
    st.gf += gf; st.ga += ga; st.xg = +(st.xg + me.xg).toFixed(2); st.xga = +(st.xga + th.xg).toFixed(2);
    st.shots += me.shots; st.shotsA += th.shots; st.onT += me.onTarget; st.poss += sum.possession[side];
    st.passes += me.passes; st.passOk += me.passesOk; st.fouls += me.fouls; st.corners += me.corners;
    st.yel += me.yellows; st.red += me.reds; if (ga === 0) st.cs++;
    const opp = clubById(state, side ? f.h : f.a)?.short || '';
    if (gf - ga > 0 && (!st.big || gf - ga > st.big.d || (gf - ga === st.big.d && gf > st.big.gf))) st.big = { d: gf - ga, gf, ga, opp };
    if (ga - gf > 0 && (!st.worst || ga - gf > st.worst.d)) st.worst = { d: ga - gf, gf, ga, opp };
    const hu = humanOfClub(state, c.id);
    if (hu !== undefined) withHuman(state, hu, () => {
      const log = (state.matchLog ||= []);
      log.push({ season: state.season, day: state.day, comp: f.comp, div: f.div, key: f.key, h: f.h, a: f.a, s: sum.score.slice(), pens: sum.shootout ? sum.shootout.score : null,
        poss: sum.possession.slice(), st: sum.stats.map((x) => ({ shots: x.shots, onT: x.onTarget, xg: x.xg, passes: x.passes, passOk: x.passesOk, fouls: x.fouls, corners: x.corners, yel: x.yellows, red: x.reds, off: x.offsides, saves: x.saves, tackles: x.tackles })),
        goals: sum.goals.map((g) => ({ side: g.side, name: g.name, min: g.minute, ex: g.extra || 0, pen: g.pen, as: g.assist })),
        motm: sum.motm ? { name: sum.motm.name, r: +sum.motm.rating.toFixed(1), side: sum.motm.side } : null,
        best: sum.ratings[side].slice(0, 3).map((x) => ({ name: x.name, r: +x.rating.toFixed(1) })) });
      if (log.length > 80) log.splice(0, log.length - 80);
    });
  }
}

/** Applique le résultat d'un match : classements, coupes, stats des joueurs. */
function applyResult(state, f, sum, m, ctx) {
  const [g0, g1] = sum.score;
  const { rng, report } = ctx;
  f.ref.s = [g0, g1];
  const updRow = (T, id, gf, ga) => {
    const r = T[id];
    r.p++; r.gf += gf; r.ga += ga;
    const res = gf > ga ? 'V' : gf === ga ? 'N' : 'D';
    if (res === 'V') { r.w++; r.pts += 3; } else if (res === 'N') { r.d++; r.pts += 1; } else r.l++;
    if (r.form) { r.form.push(res); if (r.form.length > 5) r.form.shift(); }
  };
  if (f.comp === 'league') { updRow(state.tables[f.div], f.h, g0, g1); updRow(state.tables[f.div], f.a, g1, g0); }
  else if (f.comp === 'conti' && f.group) {
    const C = ensureContis(state)[f.key];
    updRow(C.table, f.h, g0, g1); updRow(C.table, f.a, g1, g0);
    const P = prizeOf(f.key);
    for (const [id, gf, ga] of [[f.h, g0, g1], [f.a, g1, g0]]) {
      const prize = gf > ga ? P.win : gf === ga ? P.draw : 0;
      payPrize(state, id, prize, `${C.name} · ${gf > ga ? 'victoire' : 'nul'} en groupe`);
    }
  } else if (f.comp === 'intl') {
    const a = nationRow(state, f.h), b = nationRow(state, f.a);
    const exp = 1 / (1 + Math.pow(10, (b.elo - a.elo) / 400));
    const res = g0 > g1 ? 1 : g0 === g1 ? 0.5 : 0;
    const k = 30 * (1 + Math.min(3, Math.abs(g0 - g1)) * 0.25);
    a.elo = Math.round(a.elo + k * (res - exp)); b.elo = Math.round(b.elo - k * (res - exp));
    for (const [r, gf, ga] of [[a, g0, g1], [b, g1, g0]]) { r.p++; r.gf += gf; r.ga += ga; if (gf > ga) r.w++; else if (gf === ga) r.d++; else r.l++; }
  } else {
    if (sum.shootout) f.ref.pens = sum.shootout.score;
    f.ref.w = sum.winnerSide === 0 ? f.h : f.a;
  }

  const uc = state.userClubId;
  const intl = f.comp === 'intl';
  m.teams.forEach((t, side) => {
    const diff = side === 0 ? g0 - g1 : g1 - g0;
    for (const mp of allPlayers(t)) {
      const p = mp.p;
      if (intl && p.clubId === uc) report.callups.push(p.name);
      if (intl && isHumanClub(state, p.clubId)) ((report.callupsBy ||= {})[p.clubId] ||= []).push(p.name);
      if (mp.minIn == null) continue;
      const mins = Math.max(1, (mp.minOut ?? 90) - mp.minIn);
      p.fatigue = clamp(Math.round(100 - mp.energy), 0, 80);
      if (intl) {
        p.caps = (p.caps || 0) + 1; p.intGoals = (p.intGoals || 0) + mp.goals;
        p.morale = clamp(p.morale + 3, 5, 99);
      } else {
        p.stats.apps++; p.stats.minutes += mins; p._mins = mins;
        p.stats.goals += mp.goals; p.stats.assists += mp.assists; p.stats.ratingSum += mp.rating;
        if (f.comp === 'league') p.stats.lgoals += mp.goals;
        if (sum.motm && sum.motm.id === p.id) p.stats.motm++;
        p.lastRating = Math.round(mp.rating * 10) / 10; p.lastRatingDay = state.day;
        const st = p.stats, pos = t.slots[mp.slot]?.pos || p.pos;
        st.starts = (st.starts || 0) + (mp.minIn === 0 ? 1 : 0);
        st.shots = (st.shots || 0) + mp.shots; st.kp = (st.kp || 0) + mp.keyPasses;
        st.passes = (st.passes || 0) + mp.passes; st.passOk = (st.passOk || 0) + mp.passesOk;
        st.tackles = (st.tackles || 0) + mp.tackles; st.saves = (st.saves || 0) + mp.saves;
        if ((side === 0 ? g1 : g0) === 0 && mins >= 60 && ['GB', 'DC', 'DG', 'DD'].includes(pos)) st.cs = (st.cs || 0) + 1;
        if (pos === 'GB') st.conceded = (st.conceded || 0) + (side === 0 ? g1 : g0);
        p.form = clamp(Math.round(p.form * 0.6 + (50 + (mp.rating - 6.4) * 28) * 0.4), 5, 95);
        p.morale = clamp(p.morale + (diff > 0 ? 4 : diff < 0 ? -4 : 0) + (mp.minIn === 0 ? 1 : 0), 5, 99);
        if (mp.yellow && !mp.red) {
          p.stats.yellows++; p.yellowAcc = (p.yellowAcc || 0) + 1;
          if (p.yellowAcc >= 5) { p.suspended = 1; p.yellowAcc = 0; ctx.newlySusp.add(p.id); }
        }
        if (mp.red) {
          p.stats.reds++;
          p.suspended = mp.yellow >= 2 ? 1 : rng.int(1, 3);
          ctx.newlySusp.add(p.id);
          if (p.clubId === uc) report.suspensions.push({ name: p.name, games: p.suspended });
        }
      }
      if (mp.injured) {
        let days = injuryLength(rng);
        const hu = humanOfClub(state, p.clubId);
        if (hu !== undefined) days = Math.max(1, Math.round(days * staffEffects(clubById(state, p.clubId)).injuryDays));
        p.injury = days;
        p.injuryName = rng.pick(days <= 3 ? ['Contusion', 'Entorse légère', 'Douleur musculaire'] : days <= 8 ? ['Élongation', 'Entorse de la cheville', 'Lésion aux ischios'] : days <= 20 ? ['Déchirure musculaire', 'Fracture du pied', 'Ligaments du genou'] : SEVERE_NAMES);
        ctx.newlyHurt.add(p.id);
        logInjury(state, p, intl ? 'En sélection' : compLabel(state, f));
        if (hu !== undefined) withHuman(state, hu, () => {
          noteInjury(state, p);
          if (p.clubId === uc) report.injuries.push({ name: p.name, days, what: p.injuryName });
          pushMessage(state, { prio: days > 5 ? 1 : 2, icon: '✚', title: `${p.name} blessé${intl ? ' en sélection' : ''}`, text: `${p.injuryName} · ${days} match(s)` });
        });
      }
    }
  });
  if (intl) return;
  recordClubStats(state, f, sum, m);
  // Joueurs du club non convoqués : moral en baisse pour les bons joueurs.
  for (const t of m.teams) {
    const inMatch = new Set(allPlayers(t).map((mp) => mp.id));
    for (const id of t.club.playerIds) {
      if (inMatch.has(id)) continue;
      const p = state.players[id];
      if (p && overall(p) > 68 && isAvailable(p)) p.morale = clamp(p.morale - 2, 5, 99);
    }
  }
}

/** Confiance du board : évolue selon les résultats et la position. */
function updateBoard(state, t, report) {
  const uc = userClub(state);
  let matchDiff = null;
  if (report.userSummary && state.lastResult?.day === state.day && (state.lastResult.h === uc.id || state.lastResult.a === uc.id)) {
    const sd = state.lastResult.h === uc.id ? 0 : 1;
    matchDiff = report.userSummary.score[sd] - report.userSummary.score[1 - sd];
  }
  const league = t.entry.type === 'league';
  updateBoardParts(state, { pos: tablePosition(state, uc.id), target: state.objectives.league.target, matchDiff, leagueRound: league ? t.entry.round : null });
  if (league) { (uc.posHist ||= []).push(tablePosition(state, uc.id)); checkMidSeasonSack(state, t.entry.round); }
}

/* ---------------- Fin de saison ---------------- */

/**
 * Bilan + transition vers la saison suivante.
 * Retourne un rapport pour l'écran de fin de saison.
 */
export function endSeason(state) {
  const rng = gameRng(state);
  const cur = curHuman(state);
  const tables = Object.fromEntries(DIV_IDS.map((d) => [d, sortedTable(state, d)]));
  const relegated = [], promoted = [];
  const R = {}; // bilan de chaque manager humain

  // Bilan de chaque manager : objectifs, board, réputation, staff.
  forEachHuman(state, (h) => {
    const uc = userClub(state);
    const userDiv = uc.div;
    const userPos = tablePosition(state, uc.id);
    const report = R[h] = {
      season: state.season,
      champions: DIV_IDS.map((d) => ({ div: d, name: tables[d][0].club.name })),
      cups: Object.values(state.cups).map((c) => ({ name: c.name, winner: c.winner ? clubById(state, c.winner).name : '—' })),
      conti: Object.values(ensureContis(state)).map((c) => ({ name: c.name, winner: c.winner ? clubById(state, c.winner).name : '—' })),
      supers: Object.values(state.supers || {}).filter((x) => x.w).map((x) => ({ name: x.name, winner: clubById(state, x.w)?.name || '—' })),
      relegated, promoted,
      userDiv, userPos, objective: state.objectives.league, progress: [], retired: [], youth: [], left: [],
      topScorer: topScorers(state, userDiv, 1)[0], prize: 0,
    };
    const target = state.objectives.league.target;
    report.met = userPos <= target;
    state.board.confidence = clamp(state.board.confidence + (report.met ? 15 + (target - userPos) * 2 : -(userPos - target) * 5), 0, 100);
    report.confidence = state.board.confidence;
    report.sacked = !state.online && opt(state, 'sacking') !== 'off' && state.board.confidence < optInfo(state, 'difficulty').sack; // en ligne : pas de renvoi (chacun garde son club)
    coachRep(state, report.met ? 3 : -3);
    if (userPos === 1) { state.coach.trophies.push(`${DIVISIONS[userDiv].name} ${state.season}`); coachRep(state, DIVISIONS[userDiv].level === 1 ? 10 : 5, 'Titre de champion !'); }
    if (report.sacked) coachRep(state, -8, 'Limogeage');
    state.coach.seasons++;
    const trophiesNow = state.coach.trophies.filter((t) => t.endsWith(String(state.season))).length;
    grantSeasonPoints(state.coach, trophiesNow);
    report.coachPoints = 2 + trophiesNow;
    // Staff : fins de contrat (pas de prolongation automatique : c'est à vous de négocier).
    for (const m of (uc.staffMembers || []).slice()) {
      m.contract--; m.age++;
      if (m.contract > 0) {
        if (m.contract === 1) pushMessage(state, { prio: 2, icon: '📝', title: `Contrat : ${m.first} ${m.last}`, text: `Dernière année de contrat (${STAFF_ROLES[m.role].label}). Prolongez-le dans Club → Staff, sinon il partira.` });
        continue;
      }
      uc.staffMembers = uc.staffMembers.filter((x) => x !== m);
      state.staffPool.push({ ...m, contract: rng.int(1, 3), wage: staffWageFor(m.rating), tries: 3 });
      pushMessage(state, { prio: 2, icon: '👋', title: `${m.first} ${m.last} quitte le staff`, text: 'Fin de contrat. Pensez à le remplacer (Club → Staff).' });
    }
  });
  state.lastFinal = Object.fromEntries(DIV_IDS.map((d) => [d, tables[d].map((r) => r.id)]));
  for (const d of DIV_IDS) if (tables[d][0]) addHonour(state, tables[d][0].id, DIVISIONS[d].name, DIVISIONS[d].level === 1 ? 'league' : 'league2');
  refreshStaffPool(state, rng);

  // Carrousel des entraîneurs (avant les montées/descentes).
  managersEndSeason(state, tables);

  // Primes de classement.
  for (const d of DIV_IDS) {
    tables[d].forEach((r, i) => {
      const prize = prizeMoney(DIVISIONS[d].level, i + 1, r.club);
      r.club.budget += prize;
      const hu = humanOfClub(state, r.id);
      if (hu !== undefined) withHuman(state, hu, () => { R[hu].prize = prize; logFinance(state, prize, `Prime de classement (${i + 1}e)`); });
    });
  }
  // Réputation des clubs.
  for (const d of DIV_IDS) {
    const lvl1 = DIVISIONS[d].level === 1;
    const n = tables[d].length;
    tables[d].forEach((r, i) => { r.club.rep = clamp(r.club.rep + (lvl1 ? (i < 4 ? 2 : i >= n - 3 ? -2 : 0) : (i < 3 ? 4 : 0)), 30, 95); });
  }
  // Promotions / relégations (seulement entre divisions liées ; aucune dans le monde réel,
  // dont les données ne contiennent que l'élite). Relégation administrative d'un club en faillite.
  for (const d of DIV_IDS) {
    const D = DIVISIONS[d];
    if (!D.down || !D.lower || !DIV_IDS.includes(D.lower) || !tables[D.lower]) continue;
    const down = tables[d].slice(-D.down);
    for (const r of tables[d].slice(0, -D.down)) {
      if (finHealth(state, r.club) >= BAL.crisis.bankrupt) continue;
      const saved = down.shift();
      down.push(r);
      forEachHuman(state, () => pushMessage(state, { prio: r.id === state.userClubId ? 1 : 2, icon: '⚖', title: `Relégation administrative : ${r.club.name}`, text: `Faute de garanties financières, ${r.club.name} est rétrogradé. ${saved.club.name} est repêché.` }));
      break;
    }
    const up = tables[D.lower].slice(0, DIVISIONS[D.lower].up || D.down);
    relegated.push(...down.map((r) => r.club.name));
    promoted.push(...up.map((r) => r.club.name));
    for (const r of down) { r.club.div = D.lower; r.club.rep = clamp(r.club.rep - 2, 30, 95); }
    for (const r of up) r.club.div = d;
  }
  forEachHuman(state, (h) => {
    const uc = userClub(state), report = R[h];
    report.userNewDiv = uc.div;
    if (report.userNewDiv < report.userDiv) coachRep(state, 5, 'Promotion !');
    if (report.userNewDiv > report.userDiv) coachRep(state, -6, 'Relégation');
    state.history.push({ season: state.season, div: report.userDiv, pos: report.userPos, club: uc.name,
      cup: state.cups[uc.country].winner === uc.id ? 'Coupe' : '', conti: Object.values(ensureContis(state)).find((c) => c.winner === uc.id)?.name || '' });
  });

  // Retour des prêts.
  for (const p of Object.values(state.players)) {
    if (!p.onLoanFrom) continue;
    const owner = clubById(state, p.onLoanFrom);
    const curClub = clubById(state, p.clubId);
    if (curClub) { curClub.playerIds = curClub.playerIds.filter((id) => id !== p.id); if (curClub.lineup) curClub.lineup = curClub.lineup.map((id) => (id === p.id ? null : id)); }
    p.clubId = owner.id; owner.playerIds.push(p.id); p.onLoanFrom = null; p.loanShare = null; p.number = 0;
  }
  forEachHuman(state, () => { userClub(state).loanedOut = []; });

  // Évolution, retraites, contrats.
  for (const c of state.clubs) {
    const hu = humanOfClub(state, c.id);
    const rep = hu !== undefined ? R[hu] : null;
    const mult = trainingParams(c, !!rep).mult * (optInfo(state, 'progression').mult || 1);
    for (const id of c.playerIds.slice()) {
      const p = state.players[id];
      const dev = seasonDevelopment(p, rng, mult);
      // Traits gagnés / perdus avec l'évolution du niveau.
      const tr = updateTraits(p);
      if (rep && (tr.gained.length || tr.lost.length)) (rep.traits ||= []).push({ name: p.name, gained: tr.gained, lost: tr.lost });
      if (rep && dev.after !== dev.before) rep.progress.push({ name: p.name, pos: p.pos, before: dev.before, after: dev.after, age: p.age });
      if (shouldRetire(p, rng)) {
        c.playerIds = c.playerIds.filter((x) => x !== id);
        if (rep) rep.retired.push(p.name);
        retire(state, p, c); // entraîneur, staff, consultant… ou rien
        delete state.players[id];
        continue;
      }
      // Clauses du contrat (votre club) : hausse annuelle, baisse si relégation, prime de fidélité.
      if (rep && !p.onLoanFrom) {
        if (p.relCut && rep.userNewDiv > rep.userDiv) { p.wage = Math.round(p.wage * (1 - p.relCut) / 100) * 100; rep.relCuts = (rep.relCuts || 0) + 1; }
        else if (p.rise && p.contract > 1) p.wage = Math.round(p.wage * (1 + p.rise) / 100) * 100;
        if (p.loyalty && p.contract <= 1) {
          c.budget -= p.loyalty;
          withHuman(state, hu, () => { logFinance(state, -p.loyalty, `Prime de fidélité : ${p.name}`); pushMessage(state, { prio: 3, icon: '💶', title: `Prime de fidélité versée à ${p.name}`, text: money(p.loyalty) }); });
          p.loyalty = 0;
        }
      }
      p.contract--;
      if (p.contract <= 0) {
        const keep = !rep && p.age < 33 && overall(p) >= squadStrength(clubPlayers(state, c)) - 6 && rng.chance(0.75);
        if (keep) p.contract = rng.int(1, 3);
        else {
          c.playerIds = c.playerIds.filter((x) => x !== id);
          p.clubId = null; p.contract = 0; state.freeAgents.push(id);
          if (rep) rep.left.push(p.name);
        }
      }
      resetSeasonStats(p, state.season, c);
      p.injury = 0; p.suspended = 0; p.fatigue = 0;
      p.morale = clamp(Math.round(p.morale * 0.5 + 32), 20, 90);
      p.form = 50;
      p.value = playerValue(p);
    }
    for (const id of c.youthIds || []) { const p = state.players[id]; if (p) { seasonDevelopment(p, rng, mult); resetSeasonStats(p, state.season, c, true); } }
    c.sst = emptyClubStats(); c.posHist = []; c.trainSeason = {};
  }
  state.freeAgents = state.freeAgents.filter((id) => {
    const p = state.players[id];
    if (!p) return false;
    if (shouldRetire(p, rng) || p.age > 35) { delete state.players[id]; return false; }
    resetSeasonStats(p);
    return true;
  }).slice(-100);
  // Nettoyage des connaissances de scouting sur des joueurs disparus.
  forEachHuman(state, () => { for (const id of Object.keys(state.scout || {})) if (!state.players[id]) delete state.scout[id]; });

  // Centre de formation : recrues de l'été.
  for (const c of state.clubs) {
    const hu = humanOfClub(state, c.id);
    const n = hu !== undefined ? 2 + (c.academy >= 4 ? 1 : 0) + ((c.youthRecruit ?? 2) >= 4 ? 1 : 0) : 1;
    for (let i = 0; i < n; i++) {
      const y = hu !== undefined ? intakeYouth(rng, c) : createYouth(rng, c);
      state.players[y.id] = y;
      if (hu !== undefined) withHuman(state, hu, () => { y.pot = clamp(Math.round(y.pot + staffEffects(c).youthPot + coachMods(state.coach).youthPot), overall(y) + 3, 95); c.youthIds.push(y.id); R[hu].youth.push(`${y.name} (${y.pos}, ${y.age} ans)`); });
      else if (c.playerIds.length < 26) c.playerIds.push(y.id);
      else delete state.players[y.id];
    }
    if (hu === undefined) {
      fillSquad(state, c, rng);
      c.budget = aiSeasonBudget(c, DIVISIONS[c.div].level === 1);
    }
    assignNumbers(clubPlayers(state, c));
  }
  forEachHuman(state, (h) => {
    const signed = fillSquad(state, userClub(state), rng, 18);
    if (signed.length) {
      R[h].emergency = signed.map((p) => p.name);
      pushMessage(state, { prio: 1, icon: '⚠', title: `${signed.length} joueur(s) libre(s) signé(s) en urgence`, text: "L'effectif était trop court." });
    }
  });

  // Échéances des transferts payés en plusieurs fois.
  forEachHuman(state, () => {
    const uc = userClub(state);
    const due = (uc.debts || []).filter((d) => d.season <= state.season + 1);
    for (const d of due) {
      uc.budget -= d.amount;
      const to = d.to != null ? clubById(state, d.to) : null;
      if (to) to.budget += d.amount;
      logFinance(state, -d.amount, `Échéance de transfert : ${d.name}`);
    }
    if (due.length) uc.debts = uc.debts.filter((d) => !due.includes(d));
  });
  const summer = state.season + 1;
  state.season++;
  forEachHuman(state, () => {
    state.messages = state.messages.filter((m) => m.prio === 1 && !m.read && m.action?.type !== 'offer').slice(0, 5);
    state.pendingOffers = [];
  });
  // Été : grands tournois internationaux (Coupe du monde, Euro, Copa América, CAN…).
  for (const p of Object.values(state.players)) p.summerLoad = 0;
  const tourns = runSummerTournaments(state, summer);
  forEachHuman(state, (h) => { R[h].tournaments = tourns.map((t) => ({ key: t.key, name: `${t.name} ${t.year}`, icon: t.icon, winner: t.winner, runnerUp: t.runnerUp, final: t.final, top: t.top[0] || null })); });
  lifeEndSeasonWorld(state, rng);
  forEachHuman(state, (h) => lifeEndSeasonUser(state, R[h].met));
  createSeason(state);
  forEachHuman(state, (h) => {
    const report = R[h];
    validateUserLineup(state);
    report.jobs = state.online ? [] : jobCandidates(state, report.sacked).map((c) => c.id);
    pushMessage(state, { prio: 1, icon: '📅', title: `Saison ${state.season}-${state.season + 1}`, text: `Objectif : ${state.objectives.league.label}.` });
    report.nextObjective = state.objectives.league.label;
  });
  if (state.online) state.online.seasonReports = R;
  return R[cur];
}

/** Changement de club (offre acceptée ou limogeage). */
export function changeClub(state, clubId) {
  const old = userClub(state);
  onUserLeaves(state, old);
  state.userClubId = clubId;
  onUserArrives(state, userClub(state));
  resetClubStaff(state, userClub(state));
  ensureStaff(state);
  state.board.confidence = 55;
  const club = initClubExtras(userClub(state));
  state.coach.clubs.push(club.name);
  const squad = clubPlayers(state, club);
  const best = aiPrepare(squad, squad, true, null);
  club.tactics = { ...best.tactics, mentality: 'balanced' };
  club.lineup = best.lineup; club.bench = best.bench;
  state.pendingOffers = [];
  state.messages = state.messages.filter((m) => m.action?.type !== 'offer');
  setObjectives(state);
  pushMessage(state, { prio: 1, icon: '🤝', title: `Nouveau défi : ${club.name}`, text: `Vous quittez ${old.name}. Objectif : ${state.objectives.league.label}.` });
}

/** Nom lisible d'une compétition pour un résultat. */
export function compLabel(state, r) {
  if (r.comp === 'league') return DIVISIONS[r.div].name;
  if (r.comp === 'cup') return state.cups[r.key]?.name || 'Coupe';
  if (r.comp === 'conti') return state.contis?.[r.key]?.name || CONTI_NAME;
  if (r.comp === 'super') return state.supers?.[r.key]?.name || 'Supercoupe';
  return 'Sélections';
}

export { money, DIVISIONS, DIV_IDS, COUNTRIES, CONTI_NAME, DIV_NAMES };
