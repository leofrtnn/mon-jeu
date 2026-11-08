/**
 * SAISON : calendrier (championnat aller-retour + coupe), journées,
 * classements, objectifs du board, fin de saison (promotions/relégations).
 */
import { createRng, hashSeed, clamp } from '../core/rng.js';
import { createWorld, createYouth, getNextId, assignNumbers } from '../data/generator.js';
import { autoLineup, isAvailable, overall, squadStrength, ratingAt } from '../engine/ratings.js';
import { aiPrepare } from '../engine/ai.js';
import { simulateMatch, summarize, penaltyShootout, allPlayers } from '../engine/match.js';
import { wageBill, matchdayRevenue, sponsorIncome, prizeMoney, CUP_PRIZES, money, playerValue } from './economy.js';
import { weeklyTraining, seasonDevelopment, shouldRetire, resetSeasonStats } from './progression.js';
import { aiTransferActivity, fillSquad, logFinance } from './transfers.js';
import { gameRng, matchSeed, clubById, userClub, clubPlayers, pushMessage, SAVE_VERSION } from './state.js';
import { FORMATIONS } from '../data/constants.js';

export const CUP_ROUND_NAMES = ['16es de finale', '8es de finale', 'Quarts de finale', 'Demi-finales', 'Finale'];
const CUP_AFTER_LEAGUE_ROUND = [5, 12, 20, 28, 34];
export const DIV_NAMES = { 1: 'Division 1', 2: 'Division 2' };

/* ---------------- Création ---------------- */

/** Nouveau monde (avant le choix du club). */
export function newGame(seed = (Date.now() >>> 0)) {
  const rng = createRng(seed);
  const world = createWorld(rng);
  const state = {
    version: SAVE_VERSION, seed, season: 2026, day: 0, userClubId: null, rngState: rng.getState(),
    clubs: world.clubs, players: world.players, freeAgents: world.freeAgents, nextId: getNextId(),
    messages: [], pendingOffers: [], history: [], settings: { var: true, speed: 1 },
    board: { confidence: 60 }, lastResult: null, seasonOver: false,
  };
  return state;
}

/** Le joueur choisit son club : on prépare la saison. */
export function startCareer(state, clubId) {
  state.userClubId = clubId;
  const club = userClub(state);
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
      // Alternance domicile/extérieur.
      round.push(r % 2 === 0 ? { h: a, a: b, s: null } : { h: b, a: a, s: null });
    }
    rounds.push(round);
    teams.splice(1, 0, teams.pop());
  }
  const back = rounds.map((rd) => rd.map((f) => ({ h: f.a, a: f.h, s: null })));
  return [...rounds, ...back];
}

export function createSeason(state) {
  const rng = gameRng(state);
  state.fixtures = {};
  state.tables = {};
  for (const div of [1, 2]) {
    const ids = state.clubs.filter((c) => c.div === div).map((c) => c.id);
    state.fixtures[div] = roundRobin(ids, rng);
    state.tables[div] = {};
    for (const id of ids) state.tables[div][id] = { p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, pts: 0, form: [] };
  }
  // Calendrier : 38 journées de championnat + 5 tours de coupe intercalés.
  state.calendar = [];
  for (let r = 0; r < 38; r++) {
    state.calendar.push({ type: 'league', round: r });
    const k = CUP_AFTER_LEAGUE_ROUND.indexOf(r);
    if (k >= 0) state.calendar.push({ type: 'cup', round: k });
  }
  // Coupe : 20 clubs de D1 + 12 meilleurs de D2.
  const d2 = state.clubs.filter((c) => c.div === 2).sort((a, b) => b.rep - a.rep).slice(0, 12);
  const entrants = [...state.clubs.filter((c) => c.div === 1), ...d2].map((c) => c.id);
  state.cup = { alive: entrants, rounds: [], winner: null };
  state.day = 0;
  state.seasonOver = false;
  state.lastResult = null;
  setObjectives(state);
}

/* ---------------- Objectifs du board ---------------- */

export function setObjectives(state) {
  const club = userClub(state);
  const divClubs = state.clubs.filter((c) => c.div === club.div)
    .map((c) => ({ c, s: squadStrength(clubPlayers(state, c)) })).sort((a, b) => b.s - a.s);
  const expected = divClubs.findIndex((x) => x.c.id === club.id) + 1;
  let target, label;
  if (club.div === 1) {
    if (expected <= 2) { target = 1; label = 'Être champion'; }
    else if (expected <= 5) { target = 4; label = 'Finir dans le top 4'; }
    else if (expected <= 10) { target = 10; label = 'Finir dans la 1re moitié'; }
    else { target = 17; label = 'Assurer le maintien'; }
  } else {
    if (expected <= 4) { target = 3; label = 'Monter en Division 1'; }
    else if (expected <= 10) { target = 8; label = 'Finir dans le top 8'; }
    else { target = 15; label = 'Finir dans le top 15'; }
  }
  const inCup = state.cup.alive.includes(club.id);
  const cupTarget = !inCup ? null : expected <= 3 && club.div === 1 ? 3 : club.div === 1 ? 1 : 0;
  state.objectives = {
    league: { target, label, expected },
    cup: cupTarget == null ? null : { target: cupTarget, label: `Coupe : atteindre les ${CUP_ROUND_NAMES[cupTarget + 1 > 4 ? 4 : cupTarget + 1].toLowerCase()}` },
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
  const ids = state.clubs.filter((c) => c.div === div).flatMap((c) => c.playerIds);
  return ids.map((id) => state.players[id]).filter((p) => p && p.stats.lgoals > 0)
    .sort((a, b) => b.stats.lgoals - a.stats.lgoals || b.stats.assists - a.stats.assists).slice(0, n);
}

/* ---------------- Journée ---------------- */

/** Description de la journée courante et du match de l'utilisateur. */
export function today(state) {
  const entry = state.calendar[state.day];
  if (!entry) return null;
  let fixtures, label;
  if (entry.type === 'league') {
    fixtures = [...state.fixtures[1][entry.round].map((f) => ({ ...f, div: 1 })), ...state.fixtures[2][entry.round].map((f) => ({ ...f, div: 2 }))];
    label = `Journée ${entry.round + 1}`;
  } else {
    ensureCupDraw(state, entry.round);
    fixtures = state.cup.rounds[entry.round].map((f) => ({ ...f, cup: true }));
    label = `Coupe · ${CUP_ROUND_NAMES[entry.round]}`;
  }
  const uf = fixtures.find((f) => f.h === state.userClubId || f.a === state.userClubId) || null;
  return { entry, fixtures, label, userFixture: uf };
}

function ensureCupDraw(state, round) {
  if (state.cup.rounds[round]) return;
  const rng = gameRng(state);
  const ids = rng.shuffle(state.cup.alive.slice());
  const ties = [];
  for (let i = 0; i + 1 < ids.length; i += 2) ties.push({ h: ids[i], a: ids[i + 1], s: null, neutral: round === 4 });
  state.cup.rounds[round] = ties;
}

/** Configuration d'équipe pour le moteur. */
export function teamCfg(state, club, opponent, isHome, isUser) {
  const players = clubPlayers(state, club);
  if (isUser) {
    validateUserLineup(state);
    return { club, players, lineup: club.lineup.slice(), bench: club.bench.slice(), tactics: { ...club.tactics }, isAI: false };
  }
  const rng = createRng(hashSeed(`${state.seed}-${state.season}-${state.day}-${club.id}`));
  const prep = aiPrepare(players, clubPlayers(state, opponent), isHome, rng);
  return { club, players, lineup: prep.lineup, bench: prep.bench, tactics: prep.tactics, isAI: true };
}

/** S'assure que la compo de l'utilisateur est valide (blessés, suspendus, départs). */
export function validateUserLineup(state) {
  const club = userClub(state);
  const players = clubPlayers(state, club);
  const byId = new Map(players.map((p) => [p.id, p]));
  const slots = FORMATIONS[club.tactics.formation];
  if (!club.lineup || club.lineup.length !== slots.length) {
    const lu = autoLineup(players, club.tactics.formation);
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
  // Remplir les trous avec le meilleur disponible au poste.
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
  const f = t.userFixture;
  const h = clubById(state, f.h), a = clubById(state, f.a);
  return {
    seed: matchSeed(state, f.h, f.a),
    home: teamCfg(state, h, a, true, h.id === state.userClubId),
    away: teamCfg(state, a, h, false, a.id === state.userClubId),
    cup: !!f.cup, neutral: !!f.neutral, varEnabled: state.settings.var,
  };
}

/**
 * Termine la journée : simule les autres matchs, applique tous les résultats,
 * met à jour joueurs, finances, IA, messages. Retourne un rapport.
 */
export function completeDay(state, userMatch = null) {
  const rng = gameRng(state);
  const t = today(state);
  const uc = userClub(state);
  const report = { label: t.label, results: [], injuries: [], suspensions: [], finance: 0, userSummary: null, cupOut: false };
  const played = new Set();
  const newlyHurt = new Set();
  const newlySusp = new Set();
  const budgetBefore = uc.budget;

  for (const f of t.fixtures) {
    const h = clubById(state, f.h), a = clubById(state, f.a);
    let m;
    const isUser = userMatch && (f.h === state.userClubId || f.a === state.userClubId);
    if (isUser) {
      m = userMatch;
      if (f.cup && m.score[0] === m.score[1] && !m.shootout) penaltyShootout(m);
    } else {
      m = simulateMatch({
        seed: matchSeed(state, f.h, f.a), home: teamCfg(state, h, a, true, false), away: teamCfg(state, a, h, false, false),
        cup: !!f.cup, neutral: !!f.neutral, varEnabled: state.settings.var,
      });
    }
    const sum = summarize(m);
    applyResult(state, f, t.entry, sum, m, rng, { newlyHurt, newlySusp, report });
    played.add(f.h); played.add(f.a);
    report.results.push({ h: f.h, a: f.a, s: sum.score, pens: sum.shootout ? sum.shootout.score : null, div: f.div, cup: !!f.cup });
    if (isUser || (!userMatch && (f.h === state.userClubId || f.a === state.userClubId))) {
      report.userSummary = sum;
      state.lastResult = { h: f.h, a: f.a, s: sum.score, pens: sum.shootout ? sum.shootout.score : null, label: t.label,
        scorers: sum.goals.map((g) => ({ side: g.side, name: g.name, minute: g.minute, pen: g.pen })), motm: sum.motm?.name };
    }
  }

  // Coupe : qualifiés pour le tour suivant.
  if (t.entry.type === 'cup') {
    const winners = state.cup.rounds[t.entry.round].map((f) => f.w);
    if (state.cup.alive.includes(uc.id) && !winners.includes(uc.id)) {
      report.cupOut = true;
      pushMessage(state, { prio: 2, icon: '🏆', title: 'Élimination en coupe', text: CUP_ROUND_NAMES[t.entry.round] });
    } else if (winners.includes(uc.id)) {
      const prize = CUP_PRIZES[t.entry.round];
      uc.budget += prize; logFinance(state, prize, `Prime de coupe (${CUP_ROUND_NAMES[t.entry.round]})`);
    }
    for (const w of winners) if (w !== uc.id) clubById(state, w).budget += CUP_PRIZES[t.entry.round];
    state.cup.alive = winners;
    if (t.entry.round === 4) {
      state.cup.winner = winners[0];
      const wc = clubById(state, winners[0]);
      pushMessage(state, { prio: winners[0] === uc.id ? 1 : 3, icon: '🏆', title: `${wc.name} remporte la coupe !`, text: '' });
    }
  }

  // Mise à jour quotidienne de tous les joueurs.
  for (const c of state.clubs) {
    for (const id of c.playerIds) {
      const p = state.players[id];
      if (!p) continue;
      if (p.injury > 0 && !newlyHurt.has(p.id)) p.injury--;
      if (p.suspended > 0 && played.has(c.id) && !newlySusp.has(p.id)) p.suspended--;
      p.fatigue = Math.max(0, (p.fatigue || 0) - (20 + p.attrs.phy * 0.08));
      weeklyTraining(p, rng, p._mins || 0);
      p._mins = 0;
    }
  }

  // Finances : salaires (hebdo), sponsors, billetterie.
  for (const c of state.clubs) {
    const wages = wageBill(clubPlayers(state, c));
    const sponsor = sponsorIncome(c);
    c.budget += sponsor - wages;
    if (c.id === uc.id) {
      logFinance(state, -wages, 'Salaires');
      logFinance(state, sponsor, 'Sponsors');
    }
  }
  for (const f of t.fixtures) {
    if (f.neutral) continue;
    const h = clubById(state, f.h), a = clubById(state, f.a);
    const formRow = state.tables[h.div]?.[h.id];
    const formPts = formRow && formRow.form.length ? formRow.form.reduce((s, r) => s + (r === 'V' ? 1 : r === 'N' ? 0.4 : 0), 0) / formRow.form.length : 0.5;
    const { attendance, revenue } = matchdayRevenue(h, a, formPts, !!f.cup);
    h.budget += revenue;
    if (h.id === uc.id) { logFinance(state, revenue, `Billetterie (${attendance.toLocaleString('fr-FR')} spect.)`); report.attendance = attendance; }
  }
  report.finance = uc.budget - budgetBefore;

  // Mercato IA et offres.
  aiTransferActivity(state, rng);
  state.pendingOffers = (state.pendingOffers || []).filter((o) => state.day - o.day <= 3 && state.players[o.pid]?.clubId === uc.id);

  // Centre de formation : une recrue à la mi-saison.
  if (state.day === 21) {
    const y = createYouth(rng, uc);
    state.players[y.id] = y;
    uc.youthIds.push(y.id);
    pushMessage(state, { prio: 2, icon: '🌱', title: `Un jeune prometteur : ${y.name}`, text: `${y.pos}, ${y.age} ans. Voir le centre de formation.` });
  }
  // Contrats en fin de course.
  if (state.day === 30) {
    const ending = clubPlayers(state, uc).filter((p) => p.contract <= 1 && !p.onLoanFrom);
    if (ending.length) pushMessage(state, { prio: 1, icon: '✎', title: `${ending.length} contrat(s) expirent en fin de saison`, text: ending.slice(0, 3).map((p) => p.name).join(', ') + (ending.length > 3 ? '…' : '') });
  }
  if (uc.budget < 0 && budgetBefore >= 0) pushMessage(state, { prio: 1, icon: '⚠', title: 'Budget dans le rouge', text: 'Le board demande de vendre ou de réduire la masse salariale.' });

  updateBoard(state, t, report);

  state.day++;
  if (state.day >= state.calendar.length) state.seasonOver = true;
  return report;
}

/** Applique le résultat d'un match : classement, coupe, stats des joueurs. */
function applyResult(state, f, entry, sum, m, rng, ctx) {
  const [g0, g1] = sum.score;
  if (entry.type === 'league') {
    const fx = state.fixtures[f.div][entry.round].find((x) => x.h === f.h && x.a === f.a);
    fx.s = [g0, g1];
    const T = state.tables[f.div];
    const upd = (id, gf, ga) => {
      const r = T[id];
      r.p++; r.gf += gf; r.ga += ga;
      const res = gf > ga ? 'V' : gf === ga ? 'N' : 'D';
      if (res === 'V') { r.w++; r.pts += 3; } else if (res === 'N') { r.d++; r.pts += 1; } else r.l++;
      r.form.push(res); if (r.form.length > 5) r.form.shift();
    };
    upd(f.h, g0, g1); upd(f.a, g1, g0);
  } else {
    const tie = state.cup.rounds[entry.round].find((x) => x.h === f.h && x.a === f.a);
    tie.s = [g0, g1];
    if (sum.shootout) tie.pens = sum.shootout.score;
    tie.w = sum.winnerSide === 0 ? f.h : f.a;
  }
  const uc = state.userClubId;
  m.teams.forEach((t, side) => {
    const diff = side === 0 ? g0 - g1 : g1 - g0;
    for (const mp of allPlayers(t)) {
      const p = mp.p;
      if (mp.minIn != null) {
        const mins = Math.max(1, (mp.minOut ?? 90) - mp.minIn);
        p.stats.apps++; p.stats.minutes += mins; p._mins = mins;
        p.stats.goals += mp.goals; p.stats.assists += mp.assists; p.stats.ratingSum += mp.rating;
        if (entry.type === 'league') p.stats.lgoals += mp.goals;
        if (sum.motm && sum.motm.id === p.id) p.stats.motm++;
        // Forme : moyenne glissante des notes.
        p.form = clamp(Math.round(p.form * 0.6 + (50 + (mp.rating - 6.4) * 28) * 0.4), 5, 95);
        p.fatigue = clamp(Math.round(100 - mp.energy), 0, 80);
        p.morale = clamp(p.morale + (diff > 0 ? 4 : diff < 0 ? -4 : 0) + (mp.minIn === 0 ? 1 : 0), 5, 99);
        if (mp.yellow && !mp.red) {
          p.stats.yellows++; p.yellowAcc = (p.yellowAcc || 0) + 1;
          if (p.yellowAcc >= 5) { p.suspended = 1; p.yellowAcc = 0; ctx.newlySusp.add(p.id); }
        }
        if (mp.red) {
          p.stats.reds++;
          p.suspended = mp.yellow >= 2 ? 1 : rng.int(1, 3);
          ctx.newlySusp.add(p.id);
          if (p.clubId === uc) ctx.report.suspensions.push({ name: p.name, games: p.suspended });
        }
        if (mp.injured) {
          const days = rng.chance(0.6) ? rng.int(1, 3) : rng.chance(0.75) ? rng.int(4, 8) : rng.int(9, 20);
          p.injury = days;
          p.injuryName = rng.pick(days <= 3 ? ['Contusion', 'Entorse légère', 'Douleur musculaire'] : days <= 8 ? ['Élongation', 'Entorse de la cheville', 'Lésion aux ischios'] : ['Déchirure musculaire', 'Fracture du pied', 'Ligaments du genou']);
          ctx.newlyHurt.add(p.id);
          if (p.clubId === uc) {
            ctx.report.injuries.push({ name: p.name, days, what: p.injuryName });
            pushMessage(state, { prio: days > 5 ? 1 : 2, icon: '✚', title: `${p.name} blessé`, text: `${p.injuryName} · ${days} match(s)` });
          }
        }
      } else if (p.clubId === t.club.id) {
        // Remplaçant non utilisé : moral légèrement en baisse s'il est bon.
        if (overall(p) > 65) p.morale = clamp(p.morale - 1, 5, 99);
      }
    }
  });
  // Joueurs du club non convoqués.
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
  if (!report.userSummary && t.entry.type !== 'league') return;
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
  const t1 = sortedTable(state, 1), t2 = sortedTable(state, 2);
  const userDiv = uc.div;
  const userPos = tablePosition(state, uc.id);
  const report = {
    season: state.season, champion: t1[0].club.name, champion2: t2[0].club.name,
    cupWinner: state.cup.winner ? clubById(state, state.cup.winner).name : '—',
    relegated: t1.slice(-3).map((r) => r.club.name), promoted: t2.slice(0, 3).map((r) => r.club.name),
    userDiv, userPos, objective: state.objectives.league, progress: [], retired: [], youth: [], left: [],
    topScorer: topScorers(state, userDiv, 1)[0], prize: 0,
  };
  // Objectif du board.
  const target = state.objectives.league.target;
  report.met = userPos <= target;
  state.board.confidence = clamp(state.board.confidence + (report.met ? 15 + (target - userPos) * 2 : -(userPos - target) * 5), 0, 100);
  report.confidence = state.board.confidence;
  report.sacked = state.board.confidence < 15;

  // Primes de classement.
  for (const [div, tab] of [[1, t1], [2, t2]]) {
    tab.forEach((r, i) => {
      const prize = prizeMoney(div, i + 1);
      r.club.budget += prize;
      if (r.id === uc.id) { report.prize = prize; logFinance(state, prize, `Prime de classement (${i + 1}e)`); }
    });
  }
  // Réputation.
  t1.forEach((r, i) => { r.club.rep = clamp(r.club.rep + (i < 4 ? 2 : i >= 17 ? -4 : 0), 30, 95); });
  t2.forEach((r, i) => { r.club.rep = clamp(r.club.rep + (i < 3 ? 4 : 0), 30, 95); });
  // Promotions / relégations.
  for (const r of t1.slice(-3)) r.club.div = 2;
  for (const r of t2.slice(0, 3)) r.club.div = 1;
  report.userNewDiv = uc.div;

  state.history.push({ season: state.season, div: userDiv, pos: userPos, cup: state.cup.winner === uc.id ? 'Vainqueur' : '' });

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
    for (const id of c.playerIds.slice()) {
      const p = state.players[id];
      const dev = seasonDevelopment(p, rng);
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
        if (keep) { p.contract = rng.int(1, 3); }
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
    for (const id of c.youthIds || []) { const p = state.players[id]; if (p) { seasonDevelopment(p, rng); resetSeasonStats(p); } }
  }
  // Agents libres trop vieux : retraite ; on limite la taille du vivier.
  state.freeAgents = state.freeAgents.filter((id) => {
    const p = state.players[id];
    if (!p) return false;
    if (shouldRetire(p, rng) || p.age > 35) { delete state.players[id]; return false; }
    resetSeasonStats(p);
    return true;
  }).slice(-80);

  // Centre de formation : recrues de l'été.
  for (const c of state.clubs) {
    const n = c.id === uc.id ? 2 + (c.academy >= 4 ? 1 : 0) : 1;
    for (let i = 0; i < n; i++) {
      const y = createYouth(rng, c);
      state.players[y.id] = y;
      if (c.id === uc.id) { c.youthIds.push(y.id); report.youth.push(`${y.name} (${y.pos}, ${y.age} ans)`); }
      else if (c.playerIds.length < 26) { c.playerIds.push(y.id); }
      else delete state.players[y.id];
    }
    if (c.id !== uc.id) {
      fillSquad(state, c, rng);
      // Budget IA : base selon réputation et division.
      const base = c.div === 1 ? Math.pow(c.rep / 10, 2.6) * 120000 : Math.pow(c.rep / 10, 2.2) * 60000;
      c.budget = Math.round((Math.max(0, c.budget) * 0.4 + base) / 100000) * 100000;
    }
    assignNumbers(clubPlayers(state, c));
  }
  // Filet de sécurité : le board complète un effectif utilisateur trop court.
  const signed = fillSquad(state, uc, rng, 18);
  if (signed.length) {
    report.emergency = signed.map((p) => p.name);
    pushMessage(state, { prio: 1, icon: '⚠', title: `${signed.length} joueur(s) libre(s) signé(s) en urgence`, text: "L'effectif était trop court." });
  }

  state.season++;
  state.messages = state.messages.filter((m) => m.prio === 1 && !m.read).slice(0, 5);
  state.pendingOffers = [];
  createSeason(state);
  validateUserLineup(state);
  pushMessage(state, { prio: 1, icon: '📅', title: `Saison ${state.season}-${state.season + 1}`, text: `Objectif : ${state.objectives.league.label}.` });
  report.nextObjective = state.objectives.league.label;
  return report;
}

/** Offres d'emploi après un limogeage : clubs plus modestes. */
export function jobOffers(state) {
  const uc = userClub(state);
  return state.clubs.filter((c) => c.id !== uc.id && c.rep <= uc.rep - 3).sort((a, b) => b.rep - a.rep).slice(0, 3);
}

export function changeClub(state, clubId) {
  state.userClubId = clubId;
  state.board.confidence = 55;
  const club = userClub(state);
  const squad = clubPlayers(state, club);
  const best = aiPrepare(squad, squad, true, null);
  club.tactics = { ...best.tactics, mentality: 'balanced' };
  club.lineup = best.lineup; club.bench = best.bench;
  club.youthIds = club.youthIds || [];
  setObjectives(state);
  pushMessage(state, { prio: 1, icon: '🤝', title: `Nouveau défi : ${club.name}`, text: `Objectif : ${state.objectives.league.label}.` });
}

export { money };
