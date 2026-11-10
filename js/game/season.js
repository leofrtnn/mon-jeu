/**
 * SAISON : calendrier (3 championnats, coupes nationales, coupe continentale,
 * trêves internationales), journées, classements, objectifs du board,
 * fin de saison (promotions/relégations, palmarès, évolution).
 */
import { createRng, hashSeed, clamp } from '../core/rng.js';
import { createWorld, createYouth, getNextId, setNextId, assignNumbers } from '../data/generator.js';
import { createRealWorld } from '../data/realWorld.js';
import { applyTop100 } from './ratingsImport.js';
import { DIVISIONS, DIV_IDS, COUNTRIES, CONTI_SLOTS, CONTI_NAME, DIV_NAMES, applyWorld } from '../data/world.js';
import { NATION_COLORS } from '../data/names.js';
import { autoLineup, isAvailable, overall, squadStrength, ratingAt } from '../engine/ratings.js';
import { aiPrepare } from '../engine/ai.js';
import { simulateMatch, summarize, penaltyShootout, allPlayers } from '../engine/match.js';
import { wageBill, matchdayRevenue, sponsorIncome, prizeMoney, CUP_PRIZES, money, playerValue } from './economy.js';
import { weeklyTraining, seasonDevelopment, shouldRetire, resetSeasonStats } from './progression.js';
import { aiTransferActivity, userTransferOffers, fillSquad, logFinance, checkPromises } from './transfers.js';
import { forEachHuman, withHuman, humanOfClub, isHumanClub, curHuman, humanIds, switchTo } from './humans.js';
import { gameRng, matchSeed, clubById, userClub, clubPlayers, pushMessage, SAVE_VERSION } from './state.js';
import { initClubExtras, newCoach, coachRep, coachAfterMatch, staffEffects, staffWages, trainingParams, dailyFacilities, checkJobOffers, jobCandidates, ensureStaff, resetClubStaff, refreshStaffPool, STAFF_ROLES, staffWageFor } from './career.js';
import { scoutDaily, marketEvents, seeInMatch } from './scouting.js';
import { coachMods, ensureCoachProfile, grantSeasonPoints } from './coach.js';
import { ensureManagers, managerStyle, managersAfterRound, managersEndSeason, onUserLeaves, onUserArrives } from './managers.js';
import { assignDates, windowInfo, fmtDate } from './dates.js';
import { startPreseason } from './preseason.js';
import { ensureBoard, setBoardSeason, updateBoardParts, checkMidSeasonSack, recordUserMatch, IDENTITIES } from './board.js';
import { slotsOf } from '../data/constants.js';
import { ensureLife, lifeWorldDaily, lifeUserDaily, lifeAfterFixture, lifeAfterUserMatch, lifeNextDay, lifeEndSeasonWorld, lifeEndSeasonUser, lifeSeasonStart } from './life.js';
import { digestMatch, matchMods } from './press.js';
import { homeAdvantage, gateMult, userSponsorIncome } from './fans.js';
import { tension } from './relations.js';
import { injuryLength, noteInjury, SEVERE_NAMES } from './injuries.js';
import { aiSeasonBudget, finHealth } from './owners.js';
import { BAL } from '../data/balance.js';

export const CUP_ROUND_NAMES = ['16es de finale', '8es de finale', 'Quarts de finale', 'Demi-finales', 'Finale'];
export const CONTI_ROUND_NAMES = ['Groupes · J1', 'Groupes · J2', 'Groupes · J3', 'Quarts de finale', 'Demi-finales', 'Finale'];
const CUP_AFTER = [5, 12, 20, 28, 34];
const CONTI_AFTER = [3, 9, 15, 23, 30, 36];
const INTL_AFTER = [8, 18, 27];
const CONTI_GROUP_PAIRS = [[[0, 1], [2, 3]], [[0, 2], [1, 3]], [[0, 3], [1, 2]]];
const CONTI_PRIZES = { win: 2_800_000, draw: 900_000, ko: [9_000_000, 12_000_000, 20_000_000] };

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
  }
  applyTop100(state);   // notes du top 100 intégré (monde réel)
  return state;
}

/** Le joueur choisit son club : on prépare la saison. */
export function startCareer(state, clubId) {
  state.userClubId = clubId;
  const club = userClub(state);
  initClubExtras(club);
  state.coach = ensureCoachProfile(newCoach(club));
  onUserArrives(state, club);
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
  KOR1: 36, CHN1: 37, AUS1: 38, UAE1: 39, QAT1: 40, MAR1: 41, PER1: 42, CHI1: 43, COL1: 44, URU1: 45 };
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
  createConti(state, rng);
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

/** Coupe continentale : qualification (classement final précédent ou réputation), tirage des groupes. */
function createConti(state, rng) {
  const teams = [];
  for (const [div, n] of Object.entries(CONTI_SLOTS)) {
    const order = state.lastFinal?.[div]?.filter((id) => clubById(state, id)?.div === +div)
      || clubsOfDiv(state, +div).sort((a, b) => b.rep - a.rep).map((c) => c.id);
    teams.push(...order.slice(0, n));
  }
  const seeded = teams.map((id) => clubById(state, id)).sort((a, b) => b.rep - a.rep).map((c) => c.id);
  const pots = [0, 1, 2, 3].map((k) => rng.shuffle(seeded.slice(k * 4, k * 4 + 4)));
  const groups = [0, 1, 2, 3].map((g) => pots.map((p) => p[g]));
  const gfix = CONTI_GROUP_PAIRS.map((pairs) => groups.flatMap((g, gi) => pairs.map(([a, b]) => ({ h: g[a], a: g[b], s: null, g: gi }))));
  const table = {};
  groups.forEach((g, gi) => g.forEach((id) => { table[id] = { p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, pts: 0, g: gi }; }));
  state.conti = { name: CONTI_NAME, teams, groups, gfix, table, ko: [], alive: teams.slice(), winner: null };
}

export function contiGroupTable(state, g) {
  const c = state.conti;
  return c.groups[g].map((id) => ({ id, club: clubById(state, id), ...c.table[id], gd: c.table[id].gf - c.table[id].ga }))
    .sort((a, b) => b.pts - a.pts || b.gd - a.gd || b.gf - a.gf);
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
  const inConti = state.conti.teams.includes(club.id);
  state.objectives = {
    league: { target, label, expected },
    cup: cupTarget == null ? null : { target: cupTarget, label: `${cup.name} : passer ${cupTarget + 1} tour(s)` },
    conti: inConti ? { target: expected <= 2 ? 4 : 3, label: `${CONTI_NAME} : ${expected <= 2 ? 'atteindre les demies' : 'sortir des poules'}` } : null,
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
export function nationPools(state) {
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

function nationRow(state, n) {
  return (state.nations[n] = state.nations[n] || { elo: 1500, p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0 });
}

export function nationRanking(state) {
  for (const n of eligibleNations(state)) nationRow(state, n);
  return Object.entries(state.nations).map(([name, r]) => ({ name, ...r })).sort((a, b) => b.elo - a.elo);
}

/** Sélection : les 23 meilleurs (aptes) de la nation. */
export function nationSquad(state, nation) {
  return (nationPools(state)[nation] || []).filter(isAvailable).slice(0, 23);
}

function nationClub(nation) {
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

function ensureContiDraw(state, k) {
  const c = state.conti;
  const r = k - 3;
  if (c.ko[r]) return;
  const rng = gameRng(state);
  if (r === 0) {
    const t = [0, 1, 2, 3].map((g) => contiGroupTable(state, g));
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
    if (entry.round < 3) fixtures = state.conti.gfix[entry.round].map((f) => ({ h: f.h, a: f.a, s: f.s, comp: 'conti', group: true, ref: f }));
    else {
      ensureContiDraw(state, entry.round);
      fixtures = state.conti.ko[entry.round - 3].map((f) => ({ h: f.h, a: f.a, s: f.s, comp: 'conti', ko: true, neutral: f.neutral, ref: f }));
    }
    label = `${CONTI_NAME} · ${CONTI_ROUND_NAMES[entry.round]}`;
  } else {
    ensureIntlDraw(state, entry.round);
    fixtures = state.intl.breaks[entry.round].map((f) => ({ h: f.h, a: f.a, s: f.s, comp: 'intl', ref: f }));
    label = `Trêve internationale ${entry.round + 1}/3`;
  }
  const uf = fixtures.find((f) => f.comp !== 'intl' && (f.h === state.userClubId || f.a === state.userClubId)) || null;
  return { entry, fixtures, label, userFixture: uf };
}

/** Configuration d'équipe pour le moteur. */
export function teamCfg(state, club, opponent, isHome, isUser) {
  const players = clubPlayers(state, club);
  if (isUser) {
    validateUserLineup(state);
    return { club, players, lineup: club.lineup.slice(), bench: club.bench.slice(), tactics: { ...club.tactics }, isAI: false, talk: matchMods(state)?.me || 0,
      roles: (club.roles || []).slice(), setPieces: { ...(club.setPieces || {}) }, pi: (club.pi || []).map((x) => ({ ...x })), injuryMod: staffEffects(club).injuryMod,
      coachMods: (() => { const cm = coachMods(state.coach); return { ...cm, perf: cm.perf * staffEffects(club).perf }; })() };
  }
  const rng = createRng(hashSeed(`${state.seed}-${state.season}-${state.day}-${club.id}`));
  const style = managerStyle(state, club);
  const prep = aiPrepare(players, opponent ? clubPlayers(state, opponent) : players, isHome, rng, style);
  return { club, players, lineup: prep.lineup, bench: prep.bench, tactics: prep.tactics, isAI: true,
    talk: opponent && opponent.id === state.userClubId ? (matchMods(state)?.opp || 0) : 0,
    coachMods: style ? { perf: style.perf, talk: 1, cards: 1, fatigue: 1 } : null };
}

function nationCfg(state, nation, oppSquad, isHome) {
  const players = nationSquad(state, nation);
  const rng = createRng(hashSeed(`${state.seed}-${state.season}-${state.day}-${nation}`));
  const prep = aiPrepare(players, oppSquad, isHome, rng);
  return { club: nationClub(nation), players, lineup: prep.lineup, bench: prep.bench, tactics: prep.tactics, isAI: true };
}

/** Configuration moteur d'une rencontre (championnat, coupe, continentale, sélection). */
export function matchCfgFor(state, f) {
  const base = { seed: matchSeed(state, f.h, f.a), varEnabled: state.settings.var, neutral: !!f.neutral };
  if (f.comp === 'intl') {
    const hs = nationSquad(state, f.h), as = nationSquad(state, f.a);
    return { ...base, home: nationCfg(state, f.h, as, true), away: nationCfg(state, f.a, hs, false), profile: {} };
  }
  const h = clubById(state, f.h), a = clubById(state, f.a);
  const uid = state.userClubId;
  const knockout = f.comp === 'cup' || (f.comp === 'conti' && f.ko);
  const prof = { ...(f.comp === 'league' ? DIVISIONS[f.div].profile : f.comp === 'cup' ? DIVISIONS[h.div].profile : {}) };
  const tens = tension(state, h.id, a.id);
  if (tens > 1) { prof.fouls = (prof.fouls ?? 1) * tens; prof.cards = (prof.cards ?? 1) * tens; }
  return {
    ...base, cup: knockout, extraTime: knockout, homeAdv: f.neutral ? 1 : homeAdvantage(h),
    profile: prof,
    home: teamCfg(state, h, a, true, h.id === uid),
    away: teamCfg(state, a, h, false, a.id === uid),
  };
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
  forEachHuman(state, (h) => { budgetBefore[h] = userClub(state).budget; });

  for (const f of t.fixtures) {
    const hh = f.comp === 'intl' ? [] : [humanOfClub(state, f.h), humanOfClub(state, f.a)].filter((h) => h !== undefined);
    let m;
    if (userMatch && hh.includes(cur)) m = userMatch;
    else m = simulateMatch(matchCfgFor(state, f));
    if ((f.comp === 'cup' || f.ko) && m.score[0] === m.score[1] && !m.shootout) penaltyShootout(m);
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
      seeInMatch(state, m, 1 - side);
      lifeAfterUserMatch(state, digestMatch(state, sum, m, side, f), rng, f, t.entry);
      state.lastResult = { h: f.h, a: f.a, s: sum.score, pens: sum.shootout ? sum.shootout.score : null, label: t.label,
        scorers: sum.goals.map((g) => ({ side: g.side, name: g.name, minute: g.minute, pen: g.pen })), motm: sum.motm?.name };
    });
  }

  if (t.entry.type === 'cup') finishCupRound(state, t, report);
  if (t.entry.type === 'conti') finishContiRound(state, t, report);

  // Mise à jour quotidienne des joueurs (blessures, suspensions, récupération, entraînement).
  for (const c of state.clubs) {
    const hu = humanOfClub(state, c.id);
    const isUser = hu !== undefined;
    let tp, eff = null, cmod = null;
    if (isUser) withHuman(state, hu, () => { eff = staffEffects(c); cmod = coachMods(state.coach); tp = trainingParams(c, true); tp.youthMult = cmod.youth; tp.gkMult = eff.gkMult; });
    else tp = trainingParams(c, false);
    for (const id of c.playerIds) {
      const p = state.players[id];
      if (!p) continue;
      if (p.injury > 0 && !ctx.newlyHurt.has(p.id)) p.injury--;
      if (p.suspended > 0 && played.has(c.id) && !ctx.newlySusp.has(p.id)) p.suspended--;
      p.fatigue = clamp((p.fatigue || 0) - (20 + p.attrs.phy * 0.08 + (isUser ? eff.recovery + cmod.recovery : 0)) + tp.fatigue, 0, 90);
      if (tp.morale) p.morale = clamp(p.morale + tp.morale, 5, 99);
      if (tp.form) p.form = clamp(p.form + tp.form, 5, 95);
      weeklyTraining(p, rng, p._mins || 0, tp);
      if (tp.injury && p.injury === 0 && rng.chance(tp.injury)) {
        p.injury = rng.int(1, 3); p.injuryName = 'Blessure à l\'entraînement';
        withHuman(state, hu, () => pushMessage(state, { prio: 2, icon: '✚', title: `${p.name} blessé à l'entraînement`, text: `${p.injury} match(s). Entraînement intense…` }));
      }
      p._mins = 0;
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
    state.pendingOffers = (state.pendingOffers || []).filter((o) => state.day - o.day <= 3 && state.players[o.pid]?.clubId === uc.id);
    if (t.entry.type === 'league' && t.entry.round >= 6 && t.entry.round % 4 === 0) checkPromises(state);
    if (t.entry.type === 'league' && t.entry.round === 19) {
      const y = createYouth(rng, uc);
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
    lifeUserDaily(state, rng, t);
    updateBoard(state, t, report);
  });
  state.day++;
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
    const prize = CUP_PRIZES[cr + (5 - cup.nRounds)];
    if (cup.alive.includes(uc.id) && !winners.includes(uc.id)) {
      report.cupOut = true;
      pushMessage(state, { prio: 2, icon: '🏆', title: `Élimination en ${cup.name}`, text: CUP_ROUND_NAMES[cr + (5 - cup.nRounds)] });
    }
    for (const w of winners) {
      clubById(state, w).budget += prize;
      if (w === uc.id) logFinance(state, prize, `Prime de coupe (${CUP_ROUND_NAMES[cr + (5 - cup.nRounds)]})`);
    }
    cup.alive = winners;
    if (cr === cup.nRounds - 1) {
      cup.winner = winners[0];
      const wc = clubById(state, winners[0]);
      if (wc.id === uc.id) { state.coach.trophies.push(`${cup.name} ${state.season}`); coachRep(state, 6, `Victoire en ${cup.name}`); }
      pushMessage(state, { prio: wc.id === uc.id ? 1 : 3, icon: '🏆', title: `${wc.name} remporte la ${cup.name} !`, text: '' });
    }
  }
}

function finishContiRound(state, t, report) {
  const c = state.conti;
  const uc = userClub(state);
  const r = t.entry.round;
  if (r < 3) {
    if (r === 2 && c.teams.includes(uc.id)) {
      const g = c.table[uc.id].g;
      const pos = contiGroupTable(state, g).findIndex((x) => x.id === uc.id) + 1;
      pushMessage(state, { prio: 1, icon: '⭐', title: pos <= 2 ? `Qualifié pour les quarts de la ${CONTI_NAME} !` : `Éliminé en phase de groupes`, text: `${pos}e du groupe ${'ABCD'[g]}` });
      if (pos <= 2) coachRep(state, 2);
    }
    return;
  }
  const k = r - 3;
  const winners = c.ko[k].map((f) => f.w);
  for (const w of winners) {
    clubById(state, w).budget += CONTI_PRIZES.ko[k];
    if (w === uc.id) logFinance(state, CONTI_PRIZES.ko[k], `Prime ${CONTI_NAME}`);
  }
  if (c.alive.includes(uc.id) && !winners.includes(uc.id)) pushMessage(state, { prio: 2, icon: '⭐', title: `Élimination en ${CONTI_NAME}`, text: CONTI_ROUND_NAMES[r] });
  c.alive = winners;
  if (k === 2) {
    c.winner = winners[0];
    const wc = clubById(state, c.winner);
    wc.rep = clamp(wc.rep + 3, 30, 95);
    if (wc.id === uc.id) { state.coach.trophies.push(`${CONTI_NAME} ${state.season}`); coachRep(state, 12, `Victoire en ${CONTI_NAME} !`); }
    pushMessage(state, { prio: wc.id === uc.id ? 1 : 2, icon: '⭐', title: `${wc.name} remporte la ${CONTI_NAME} !`, text: '' });
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
    updRow(state.conti.table, f.h, g0, g1); updRow(state.conti.table, f.a, g1, g0);
    for (const [id, gf, ga] of [[f.h, g0, g1], [f.a, g1, g0]]) {
      const prize = gf > ga ? CONTI_PRIZES.win : gf === ga ? CONTI_PRIZES.draw : 0;
      clubById(state, id).budget += prize;
      if (id === state.userClubId && prize) logFinance(state, prize, `Prime ${CONTI_NAME}`);
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
        if (hu !== undefined) withHuman(state, hu, () => {
          noteInjury(state, p);
          if (p.clubId === uc) report.injuries.push({ name: p.name, days, what: p.injuryName });
          pushMessage(state, { prio: days > 5 ? 1 : 2, icon: '✚', title: `${p.name} blessé${intl ? ' en sélection' : ''}`, text: `${p.injuryName} · ${days} match(s)` });
        });
      }
    }
  });
  if (intl) return;
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
  if (report.userSummary) {
    const sd = state.lastResult.h === uc.id ? 0 : 1;
    matchDiff = report.userSummary.score[sd] - report.userSummary.score[1 - sd];
  }
  const league = t.entry.type === 'league';
  updateBoardParts(state, { pos: tablePosition(state, uc.id), target: state.objectives.league.target, matchDiff, leagueRound: league ? t.entry.round : null });
  if (league) checkMidSeasonSack(state, t.entry.round);
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
      conti: state.conti.winner ? clubById(state, state.conti.winner).name : '—',
      relegated, promoted,
      userDiv, userPos, objective: state.objectives.league, progress: [], retired: [], youth: [], left: [],
      topScorer: topScorers(state, userDiv, 1)[0], prize: 0,
    };
    const target = state.objectives.league.target;
    report.met = userPos <= target;
    state.board.confidence = clamp(state.board.confidence + (report.met ? 15 + (target - userPos) * 2 : -(userPos - target) * 5), 0, 100);
    report.confidence = state.board.confidence;
    report.sacked = !state.online && state.board.confidence < 15; // en ligne : pas de renvoi (chacun garde son club)
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
      cup: state.cups[uc.country].winner === uc.id ? 'Coupe' : '', conti: state.conti.winner === uc.id ? CONTI_NAME : '' });
  });

  // Retour des prêts.
  for (const p of Object.values(state.players)) {
    if (!p.onLoanFrom) continue;
    const owner = clubById(state, p.onLoanFrom);
    const curClub = clubById(state, p.clubId);
    if (curClub) { curClub.playerIds = curClub.playerIds.filter((id) => id !== p.id); if (curClub.lineup) curClub.lineup = curClub.lineup.map((id) => (id === p.id ? null : id)); }
    p.clubId = owner.id; owner.playerIds.push(p.id); p.onLoanFrom = null; p.number = 0;
  }
  forEachHuman(state, () => { userClub(state).loanedOut = []; });

  // Évolution, retraites, contrats.
  for (const c of state.clubs) {
    const hu = humanOfClub(state, c.id);
    const rep = hu !== undefined ? R[hu] : null;
    const mult = trainingParams(c, !!rep).mult;
    for (const id of c.playerIds.slice()) {
      const p = state.players[id];
      const dev = seasonDevelopment(p, rng, mult);
      if (rep && dev.after !== dev.before) rep.progress.push({ name: p.name, pos: p.pos, before: dev.before, after: dev.after, age: p.age });
      if (shouldRetire(p, rng)) {
        c.playerIds = c.playerIds.filter((x) => x !== id);
        if (rep) rep.retired.push(p.name);
        delete state.players[id];
        continue;
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
      resetSeasonStats(p);
      p.injury = 0; p.suspended = 0; p.fatigue = 0;
      p.morale = clamp(Math.round(p.morale * 0.5 + 32), 20, 90);
      p.form = 50;
      p.value = playerValue(p);
    }
    for (const id of c.youthIds || []) { const p = state.players[id]; if (p) { seasonDevelopment(p, rng, mult); resetSeasonStats(p); } }
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
    const n = hu !== undefined ? 2 + (c.academy >= 4 ? 1 : 0) : 1;
    for (let i = 0; i < n; i++) {
      const y = createYouth(rng, c);
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

  state.season++;
  forEachHuman(state, () => {
    state.messages = state.messages.filter((m) => m.prio === 1 && !m.read && m.action?.type !== 'offer').slice(0, 5);
    state.pendingOffers = [];
  });
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
  if (r.comp === 'conti') return CONTI_NAME;
  return 'Sélections';
}

export { money, DIVISIONS, DIV_IDS, COUNTRIES, CONTI_NAME, DIV_NAMES };
