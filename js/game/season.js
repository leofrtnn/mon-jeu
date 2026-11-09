/**
 * SAISON : calendrier (3 championnats, coupes nationales, coupe continentale,
 * trêves internationales), journées, classements, objectifs du board,
 * fin de saison (promotions/relégations, palmarès, évolution).
 */
import { createRng, hashSeed, clamp } from '../core/rng.js';
import { createWorld, createYouth, getNextId, assignNumbers } from '../data/generator.js';
import { DIVISIONS, DIV_IDS, COUNTRIES, CONTI_SLOTS, CONTI_NAME } from '../data/world.js';
import { NATION_COLORS } from '../data/names.js';
import { autoLineup, isAvailable, overall, squadStrength, ratingAt } from '../engine/ratings.js';
import { aiPrepare } from '../engine/ai.js';
import { simulateMatch, summarize, penaltyShootout, allPlayers } from '../engine/match.js';
import { wageBill, matchdayRevenue, sponsorIncome, prizeMoney, CUP_PRIZES, money, playerValue } from './economy.js';
import { weeklyTraining, seasonDevelopment, shouldRetire, resetSeasonStats } from './progression.js';
import { aiTransferActivity, fillSquad, logFinance } from './transfers.js';
import { gameRng, matchSeed, clubById, userClub, clubPlayers, pushMessage, SAVE_VERSION } from './state.js';
import { initClubExtras, newCoach, coachRep, coachAfterMatch, staffEffects, staffWages, trainingParams, dailyFacilities, checkJobOffers, jobCandidates } from './career.js';
import { scoutDaily, marketEvents, seeInMatch } from './scouting.js';
import { coachMods, ensureCoachProfile, grantSeasonPoints } from './coach.js';
import { slotsOf } from '../data/constants.js';

export const CUP_ROUND_NAMES = ['16es de finale', '8es de finale', 'Quarts de finale', 'Demi-finales', 'Finale'];
export const CONTI_ROUND_NAMES = ['Groupes · J1', 'Groupes · J2', 'Groupes · J3', 'Quarts de finale', 'Demi-finales', 'Finale'];
const CUP_AFTER = [5, 12, 20, 28, 34];
const CONTI_AFTER = [3, 9, 15, 23, 30, 36];
const INTL_AFTER = [8, 18, 27];
export const DIV_NAMES = Object.fromEntries(DIV_IDS.map((d) => [d, DIVISIONS[d].name]));
const CONTI_GROUP_PAIRS = [[[0, 1], [2, 3]], [[0, 2], [1, 3]], [[0, 3], [1, 2]]];
const CONTI_PRIZES = { win: 500000, draw: 250000, ko: [2_000_000, 3_000_000, 6_000_000] };

/* ---------------- Création ---------------- */

/** Nouveau monde (avant le choix du club). */
export function newGame(seed = (Date.now() >>> 0)) {
  const rng = createRng(seed);
  const world = createWorld(rng);
  world.clubs.forEach(initClubExtras);
  return {
    version: SAVE_VERSION, seed, season: 2026, day: 0, userClubId: null, rngState: rng.getState(),
    clubs: world.clubs, players: world.players, freeAgents: world.freeAgents, nextId: getNextId(),
    messages: [], pendingOffers: [], history: [], settings: { var: true, speed: 1, replays: true, audio: true },
    board: { confidence: 60 }, lastResult: null, seasonOver: false,
    coach: null, scout: {}, scoutQueue: [], nations: {}, lastFinal: null, friends: { teams: [] },
  };
}

/** Le joueur choisit son club : on prépare la saison. */
export function startCareer(state, clubId) {
  state.userClubId = clubId;
  const club = userClub(state);
  initClubExtras(club);
  state.coach = ensureCoachProfile(newCoach(club));
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

const clubsOfDiv = (state, div) => state.clubs.filter((c) => c.div === div);

export function createSeason(state) {
  const rng = gameRng(state);
  state.fixtures = {};
  state.tables = {};
  for (const div of DIV_IDS) {
    const ids = clubsOfDiv(state, div).map((c) => c.id);
    state.fixtures[div] = roundRobin(ids, rng);
    state.tables[div] = {};
    for (const id of ids) state.tables[div][id] = { p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, pts: 0, form: [] };
  }
  // Calendrier : 38 journées + coupes + coupe continentale + trêves internationales.
  state.calendar = [];
  for (let r = 0; r < 38; r++) {
    state.calendar.push({ type: 'league', round: r, lr: r });
    const k = CUP_AFTER.indexOf(r);
    if (k >= 0) state.calendar.push({ type: 'cup', round: k, lr: r + 1 });
    const c = CONTI_AFTER.indexOf(r);
    if (c >= 0) state.calendar.push({ type: 'conti', round: c, lr: r + 1 });
    const i = INTL_AFTER.indexOf(r);
    if (i >= 0) state.calendar.push({ type: 'intl', round: i, lr: r + 1 });
  }
  // Coupes nationales : France 32 clubs (5 tours), Ibérie et Albion 16 clubs (4 tours).
  state.cups = {};
  for (const country of Object.keys(COUNTRIES)) {
    const clubs = state.clubs.filter((c) => c.country === country).sort((a, b) => (DIVISIONS[a.div].level - DIVISIONS[b.div].level) || b.rep - a.rep);
    const n = country === 'FRA' ? 32 : 16;
    state.cups[country] = { name: COUNTRIES[country].cup, alive: clubs.slice(0, n).map((c) => c.id), rounds: [], nRounds: Math.log2(n), winner: null };
  }
  createConti(state, rng);
  state.intl = { breaks: [] };
  state.day = 0;
  state.seasonOver = false;
  state.lastResult = null;
  setObjectives(state);
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
  const hasRelegation = club.div === 1;
  let target, label;
  if (level === 1) {
    if (expected <= 2) { target = 1; label = 'Être champion'; }
    else if (expected <= 5) { target = 4; label = 'Finir dans le top 4'; }
    else if (expected <= 10) { target = 10; label = 'Finir dans la 1re moitié'; }
    else { target = hasRelegation ? 17 : 15; label = hasRelegation ? 'Assurer le maintien' : 'Finir dans le top 15'; }
  } else {
    if (expected <= 4) { target = 3; label = 'Monter en Division 1'; }
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
    finance: { label: 'Garder un budget positif' },
  };
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
  const ranked = nationRanking(state).filter((r) => eligibleNations(state).includes(r.name)).map((r) => r.name);
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
  const entry = state.calendar[state.day];
  if (!entry) return null;
  let fixtures = [], label;
  if (entry.type === 'league') {
    for (const div of DIV_IDS) fixtures.push(...state.fixtures[div][entry.round].map((f) => ({ h: f.h, a: f.a, s: f.s, comp: 'league', div, ref: f })));
    label = `Journée ${entry.round + 1}`;
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
    return { club, players, lineup: club.lineup.slice(), bench: club.bench.slice(), tactics: { ...club.tactics }, isAI: false,
      roles: (club.roles || []).slice(), setPieces: { ...(club.setPieces || {}) }, pi: (club.pi || []).map((x) => ({ ...x })), injuryMod: staffEffects(club).injuryMod, coachMods: coachMods(state.coach) };
  }
  const rng = createRng(hashSeed(`${state.seed}-${state.season}-${state.day}-${club.id}`));
  const prep = aiPrepare(players, opponent ? clubPlayers(state, opponent) : players, isHome, rng);
  return { club, players, lineup: prep.lineup, bench: prep.bench, tactics: prep.tactics, isAI: true };
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
  return {
    ...base, cup: knockout, extraTime: knockout,
    profile: f.comp === 'league' ? DIVISIONS[f.div].profile : f.comp === 'cup' ? DIVISIONS[h.div].profile : {},
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
  const rng = gameRng(state);
  const t = today(state);
  const uc = userClub(state);
  const report = { label: t.label, type: t.entry.type, results: [], injuries: [], suspensions: [], callups: [], finance: 0, userSummary: null, cupOut: false };
  const played = new Set();
  const ctx = { newlyHurt: new Set(), newlySusp: new Set(), report, rng };
  const budgetBefore = uc.budget;

  for (const f of t.fixtures) {
    const isUser = f.comp !== 'intl' && (f.h === uc.id || f.a === uc.id);
    let m;
    if (isUser && userMatch) m = userMatch;
    else m = simulateMatch(matchCfgFor(state, f));
    if ((f.comp === 'cup' || f.ko) && m.score[0] === m.score[1] && !m.shootout) penaltyShootout(m);
    const sum = summarize(m);
    applyResult(state, f, sum, m, ctx);
    if (f.comp !== 'intl') { played.add(f.h); played.add(f.a); }
    report.results.push({ h: f.h, a: f.a, s: sum.score, pens: sum.shootout ? sum.shootout.score : null, div: f.div, comp: f.comp, key: f.key });
    if (isUser) {
      report.userSummary = sum;
      const side = f.h === uc.id ? 0 : 1;
      coachAfterMatch(state, sum.score[side], sum.score[1 - side], clubById(state, side === 0 ? f.a : f.h));
      seeInMatch(state, m, 1 - side);
      state.lastResult = { h: f.h, a: f.a, s: sum.score, pens: sum.shootout ? sum.shootout.score : null, label: t.label,
        scorers: sum.goals.map((g) => ({ side: g.side, name: g.name, minute: g.minute, pen: g.pen })), motm: sum.motm?.name };
    }
  }

  if (t.entry.type === 'cup') finishCupRound(state, t, report);
  if (t.entry.type === 'conti') finishContiRound(state, t, report);

  // Mise à jour quotidienne des joueurs (blessures, suspensions, récupération, entraînement).
  const eff = staffEffects(uc);
  const cmod = coachMods(state.coach);
  for (const c of state.clubs) {
    const isUser = c.id === uc.id;
    const tp = trainingParams(c, isUser);
    if (isUser) tp.youthMult = cmod.youth;
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
        pushMessage(state, { prio: 2, icon: '✚', title: `${p.name} blessé à l'entraînement`, text: `${p.injury} match(s). Entraînement intense…` });
      }
      p._mins = 0;
    }
  }

  // Finances : salaires (+ staff), sponsors, billetterie.
  for (const c of state.clubs) {
    const wages = wageBill(clubPlayers(state, c)) + (c.id === uc.id ? staffWages(c) : 0);
    const sponsor = sponsorIncome(c);
    c.budget += sponsor - wages;
    if (c.id === uc.id) { logFinance(state, -wages, 'Salaires'); logFinance(state, sponsor, 'Sponsors'); }
  }
  for (const f of t.fixtures) {
    if (f.neutral || f.comp === 'intl') continue;
    const h = clubById(state, f.h), a = clubById(state, f.a);
    const formRow = state.tables[h.div]?.[h.id];
    const formPts = formRow && formRow.form.length ? formRow.form.reduce((s, r) => s + (r === 'V' ? 1 : r === 'N' ? 0.4 : 0), 0) / formRow.form.length : 0.5;
    const { attendance, revenue } = matchdayRevenue(h, a, formPts, f.comp !== 'league');
    const bonus = f.comp === 'conti' ? 1.6 : 1;
    h.budget += Math.round(revenue * bonus);
    if (h.id === uc.id) { logFinance(state, Math.round(revenue * bonus), `Billetterie (${attendance.toLocaleString('fr-FR')} spect.)`); report.attendance = attendance; }
  }

  dailyFacilities(state);
  aiTransferActivity(state, rng);
  marketEvents(state, rng);
  scoutDaily(state);
  state.pendingOffers = (state.pendingOffers || []).filter((o) => state.day - o.day <= 3 && state.players[o.pid]?.clubId === uc.id);

  if (t.entry.type === 'league' && t.entry.round === 19) {
    const y = createYouth(rng, uc);
    y.pot = clamp(Math.round(y.pot + coachMods(state.coach).youthPot), overall(y) + 3, 95);
    state.players[y.id] = y;
    uc.youthIds.push(y.id);
    pushMessage(state, { prio: 2, icon: '🌱', title: `Un jeune prometteur : ${y.name}`, text: `${y.pos}, ${y.age} ans. Voir le centre de formation.` });
    checkJobOffers(state, rng);
  }
  if (t.entry.type === 'league' && t.entry.round === 27) {
    const ending = clubPlayers(state, uc).filter((p) => p.contract <= 1 && !p.onLoanFrom);
    if (ending.length) pushMessage(state, { prio: 1, icon: '✎', title: `${ending.length} contrat(s) expirent en fin de saison`, text: ending.slice(0, 3).map((p) => p.name).join(', ') + (ending.length > 3 ? '…' : '') });
  }
  if (report.callups.length) pushMessage(state, { prio: 2, icon: '🌍', title: `${report.callups.length} joueur(s) en sélection`, text: report.callups.slice(0, 4).join(', ') });
  if (uc.budget < 0 && budgetBefore >= 0) pushMessage(state, { prio: 1, icon: '⚠', title: 'Budget dans le rouge', text: 'Le board demande de vendre ou de réduire la masse salariale.' });

  report.finance = uc.budget - budgetBefore;
  updateBoard(state, t, report);
  state.day++;
  if (state.day >= state.calendar.length) state.seasonOver = true;
  return report;
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
        let days = rng.chance(0.6) ? rng.int(1, 3) : rng.chance(0.75) ? rng.int(4, 8) : rng.int(9, 20);
        if (p.clubId === uc) days = Math.max(1, Math.round(days * staffEffects(clubById(state, uc)).injuryDays));
        p.injury = days;
        p.injuryName = rng.pick(days <= 3 ? ['Contusion', 'Entorse légère', 'Douleur musculaire'] : days <= 8 ? ['Élongation', 'Entorse de la cheville', 'Lésion aux ischios'] : ['Déchirure musculaire', 'Fracture du pied', 'Ligaments du genou']);
        ctx.newlyHurt.add(p.id);
        if (p.clubId === uc) {
          report.injuries.push({ name: p.name, days, what: p.injuryName });
          pushMessage(state, { prio: days > 5 ? 1 : 2, icon: '✚', title: `${p.name} blessé${intl ? ' en sélection' : ''}`, text: `${p.injuryName} · ${days} match(s)` });
        }
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
  const b = state.board;
  if (report.userSummary) {
    const s = report.userSummary;
    const side = state.lastResult.h === uc.id ? 0 : 1;
    const diff = s.score[side] - s.score[1 - side];
    b.confidence += diff > 0 ? 2 : diff < 0 ? -2 : 0;
  }
  if (t.entry.type === 'league' && t.entry.round >= 5) {
    const pos = tablePosition(state, uc.id);
    const target = state.objectives.league.target;
    b.confidence += pos <= target ? 0.6 : -Math.min(2, (pos - target) * 0.25);
  }
  if (uc.budget < 0) b.confidence -= 1;
  b.confidence = clamp(Math.round(b.confidence * 10) / 10, 0, 100);
}

/* ---------------- Fin de saison ---------------- */

/**
 * Bilan + transition vers la saison suivante.
 * Retourne un rapport pour l'écran de fin de saison.
 */
export function endSeason(state) {
  const rng = gameRng(state);
  const uc = userClub(state);
  const tables = Object.fromEntries(DIV_IDS.map((d) => [d, sortedTable(state, d)]));
  const userDiv = uc.div;
  const userPos = tablePosition(state, uc.id);
  const report = {
    season: state.season,
    champions: DIV_IDS.map((d) => ({ div: d, name: tables[d][0].club.name })),
    cups: Object.values(state.cups).map((c) => ({ name: c.name, winner: c.winner ? clubById(state, c.winner).name : '—' })),
    conti: state.conti.winner ? clubById(state, state.conti.winner).name : '—',
    relegated: tables[1].slice(-3).map((r) => r.club.name), promoted: tables[2].slice(0, 3).map((r) => r.club.name),
    userDiv, userPos, objective: state.objectives.league, progress: [], retired: [], youth: [], left: [],
    topScorer: topScorers(state, userDiv, 1)[0], prize: 0,
  };
  state.lastFinal = Object.fromEntries(DIV_IDS.map((d) => [d, tables[d].map((r) => r.id)]));

  // Objectif du board et réputation du coach.
  const target = state.objectives.league.target;
  report.met = userPos <= target;
  state.board.confidence = clamp(state.board.confidence + (report.met ? 15 + (target - userPos) * 2 : -(userPos - target) * 5), 0, 100);
  report.confidence = state.board.confidence;
  report.sacked = state.board.confidence < 15;
  coachRep(state, report.met ? 3 : -3);
  if (userPos === 1) { state.coach.trophies.push(`${DIVISIONS[userDiv].name} ${state.season}`); coachRep(state, DIVISIONS[userDiv].level === 1 ? 10 : 5, 'Titre de champion !'); }
  if (report.sacked) coachRep(state, -8, 'Limogeage');
  state.coach.seasons++;
  const trophiesNow = state.coach.trophies.filter((t) => t.endsWith(String(state.season))).length;
  grantSeasonPoints(state.coach, trophiesNow);
  report.coachPoints = 2 + trophiesNow;

  // Primes de classement.
  for (const d of DIV_IDS) {
    tables[d].forEach((r, i) => {
      const prize = prizeMoney(DIVISIONS[d].level, i + 1);
      r.club.budget += prize;
      if (r.id === uc.id) { report.prize = prize; logFinance(state, prize, `Prime de classement (${i + 1}e)`); }
    });
  }
  // Réputation des clubs.
  for (const d of DIV_IDS) {
    const lvl1 = DIVISIONS[d].level === 1;
    tables[d].forEach((r, i) => { r.club.rep = clamp(r.club.rep + (lvl1 ? (i < 4 ? 2 : i >= 17 ? -2 : 0) : (i < 3 ? 4 : 0)), 30, 95); });
  }
  // Promotions / relégations (France).
  for (const r of tables[1].slice(-3)) { r.club.div = 2; r.club.rep = clamp(r.club.rep - 2, 30, 95); }
  for (const r of tables[2].slice(0, 3)) r.club.div = 1;
  report.userNewDiv = uc.div;
  if (report.userNewDiv < userDiv) coachRep(state, 5, 'Promotion !');
  if (report.userNewDiv > userDiv) coachRep(state, -6, 'Relégation');

  state.history.push({ season: state.season, div: userDiv, pos: userPos, club: uc.name,
    cup: state.cups[uc.country].winner === uc.id ? 'Coupe' : '', conti: state.conti.winner === uc.id ? CONTI_NAME : '' });

  // Retour des prêts.
  for (const p of Object.values(state.players)) {
    if (!p.onLoanFrom) continue;
    const owner = clubById(state, p.onLoanFrom);
    const cur = clubById(state, p.clubId);
    if (cur) { cur.playerIds = cur.playerIds.filter((id) => id !== p.id); if (cur.lineup) cur.lineup = cur.lineup.map((id) => (id === p.id ? null : id)); }
    p.clubId = owner.id; owner.playerIds.push(p.id); p.onLoanFrom = null; p.number = 0;
  }
  uc.loanedOut = [];

  // Évolution, retraites, contrats.
  for (const c of state.clubs) {
    const mult = trainingParams(c, c.id === uc.id).mult;
    for (const id of c.playerIds.slice()) {
      const p = state.players[id];
      const dev = seasonDevelopment(p, rng, mult);
      if (c.id === uc.id && dev.after !== dev.before) report.progress.push({ name: p.name, pos: p.pos, before: dev.before, after: dev.after, age: p.age });
      if (shouldRetire(p, rng)) {
        c.playerIds = c.playerIds.filter((x) => x !== id);
        if (c.id === uc.id) report.retired.push(p.name);
        delete state.players[id];
        continue;
      }
      p.contract--;
      if (p.contract <= 0) {
        const keep = c.id !== uc.id && p.age < 33 && overall(p) >= squadStrength(clubPlayers(state, c)) - 6 && rng.chance(0.75);
        if (keep) p.contract = rng.int(1, 3);
        else {
          c.playerIds = c.playerIds.filter((x) => x !== id);
          p.clubId = null; p.contract = 0; state.freeAgents.push(id);
          if (c.id === uc.id) report.left.push(p.name);
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
  for (const id of Object.keys(state.scout || {})) if (!state.players[id]) delete state.scout[id];

  // Centre de formation : recrues de l'été.
  for (const c of state.clubs) {
    const n = c.id === uc.id ? 2 + (c.academy >= 4 ? 1 : 0) : 1;
    for (let i = 0; i < n; i++) {
      const y = createYouth(rng, c);
      state.players[y.id] = y;
      if (c.id === uc.id) { c.youthIds.push(y.id); report.youth.push(`${y.name} (${y.pos}, ${y.age} ans)`); }
      else if (c.playerIds.length < 26) c.playerIds.push(y.id);
      else delete state.players[y.id];
    }
    if (c.id !== uc.id) {
      fillSquad(state, c, rng);
      const lvl1 = DIVISIONS[c.div].level === 1;
      const base = lvl1 ? Math.pow(c.rep / 10, 2.6) * 120000 : Math.pow(c.rep / 10, 2.2) * 60000;
      c.budget = Math.round((Math.max(0, c.budget) * 0.4 + base) / 100000) * 100000;
    }
    assignNumbers(clubPlayers(state, c));
  }
  const signed = fillSquad(state, uc, rng, 18);
  if (signed.length) {
    report.emergency = signed.map((p) => p.name);
    pushMessage(state, { prio: 1, icon: '⚠', title: `${signed.length} joueur(s) libre(s) signé(s) en urgence`, text: "L'effectif était trop court." });
  }

  state.season++;
  state.messages = state.messages.filter((m) => m.prio === 1 && !m.read && m.action?.type !== 'offer').slice(0, 5);
  state.pendingOffers = [];
  createSeason(state);
  validateUserLineup(state);
  report.jobs = jobCandidates(state, report.sacked).map((c) => c.id);
  pushMessage(state, { prio: 1, icon: '📅', title: `Saison ${state.season}-${state.season + 1}`, text: `Objectif : ${state.objectives.league.label}.` });
  report.nextObjective = state.objectives.league.label;
  return report;
}

/** Changement de club (offre acceptée ou limogeage). */
export function changeClub(state, clubId) {
  const old = userClub(state);
  state.userClubId = clubId;
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

export { money, DIVISIONS, DIV_IDS, COUNTRIES, CONTI_NAME };
