/**
 * BANC DE DÉRIVE : simule N saisons des systèmes « vie du club » sur le vrai monde
 * du jeu, avec des résultats de match tirés au sort (loi de Poisson selon la force
 * des effectifs) à la place du moteur minute par minute, trop lent pour 500 saisons.
 * Tout le reste est le vrai code : vestiaire, demandes, presse, propriétaires,
 * relations, finances, supporters, sponsors, blessures, rumeurs, fin de saison.
 *
 * Utilisation : node tests/drift.js 500   (ou via tests/drift.test.js)
 */
import { createRng, clamp } from '../js/core/rng.js';
import { newGame, startCareer, endSeason, today, tablePosition, applyDayFinances, changeClub } from '../js/game/season.js';
import { userClub, clubPlayers, clubById } from '../js/game/state.js';
import { overall, squadStrength } from '../js/engine/ratings.js';
import { lifeDaily, lifeAfterFixture, lifeAfterUserMatch, lifeNextDay, ensureLife } from '../js/game/life.js';
import { answerInterview, answerConference, STYLES } from '../js/game/press.js';
import { openDecisions, autoResolveAll } from '../js/game/inbox.js';
import { updateBoardParts, checkMidSeasonSack, ensureBoard } from '../js/game/board.js';
import { finHealth } from '../js/game/owners.js';
import { relGet } from '../js/game/relations.js';
import { jobCandidates } from '../js/game/career.js';
import { noteInjury } from '../js/game/injuries.js';
import { BAL } from '../js/data/balance.js';
import { windowInfo } from '../js/game/dates.js';

function poisson(rng, l) { let k = 0, p = Math.exp(-l), s = p; const u = rng.next(); while (u > s && k < 9) { k++; p *= l / k; s += p; } return k; }

const upd = (T, id, gf, ga) => {
  const r = T[id]; r.p++; r.gf += gf; r.ga += ga;
  const res = gf > ga ? 'V' : gf === ga ? 'N' : 'D';
  if (res === 'V') { r.w++; r.pts += 3; } else if (res === 'N') { r.d++; r.pts += 1; } else r.l++;
  if (r.form) { r.form.push(res); if (r.form.length > 5) r.form.shift(); }
};

/** Mercato IA simplifié : flux d'argent entre clubs (à somme nulle, comme les vrais transferts). */
function aiMoney(state, rng) {
  const ai = state.clubs.filter((c) => c.id !== state.userClubId);
  for (let i = 0; i < 6; i++) {
    const buyer = rng.pick(ai.filter((c) => c.budget > 5e6));
    const seller = rng.pick(ai);
    if (!buyer || buyer === seller) continue;
    const amount = Math.round(buyer.budget * rng.range(0.03, 0.12));
    buyer.budget -= amount; seller.budget += amount;
    // La recrue arrive avec un salaire, le joueur vendu libère le sien (en partie).
    const bp = rng.pick(clubPlayers(state, buyer)), sp = rng.pick(clubPlayers(state, seller));
    if (bp) bp.wage += Math.round(amount / 220);
    if (sp) sp.wage = Math.max(500, sp.wage - Math.round(amount / 400));
  }
}

export function runDrift(nSeasons = 500, seed = 2024, onSeason = null) {
  const state = newGame(seed);
  startCareer(state, state.clubs[12].id);
  const rng = createRng(seed + 1);
  const out = [];
  for (let s = 0; s < nSeasons; s++) {
    if (state.preseason) state.preseason.active = false;
    ensureLife(state); ensureBoard(state);
    const str = Object.fromEntries(state.clubs.map((c) => [c.id, squadStrength(clubPlayers(state, c))]));
    const m = { takeovers: 0, requests: 0, interviews: 0, virals: 0, longInj: 0, relapses: 0, sacked: 0, moved: 0, maxOpen: 0 };
    const reqSeen = new Set();
    while (state.day < state.calendar.length) {
      const entry = state.calendar[state.day];
      const t = entry.type === 'league' ? today(state) : { entry, fixtures: [] };
      const uc = userClub(state);
      let userDiff = null;
      for (const f of t.fixtures) {
        const dh = (str[f.h] - str[f.a]) / 14;
        const g0 = poisson(rng, clamp(1.45 * Math.exp(dh) * 1.05, 0.2, 4)), g1 = poisson(rng, clamp(1.15 * Math.exp(-dh), 0.2, 4));
        upd(state.tables[f.div], f.h, g0, g1); upd(state.tables[f.div], f.a, g1, g0);
        f.ref.s = [g0, g1];
        const red = rng.chance(0.12);
        const sum = { score: [g0, g1], ratings: [[{ red }], [{ red: false }]] };
        lifeAfterFixture(state, f, sum);
        if (f.h === uc.id || f.a === uc.id) {
          const side = f.h === uc.id ? 0 : 1;
          const [gf, ga] = side ? [g1, g0] : [g0, g1];
          userDiff = gf - ga;
          const sq = clubPlayers(state, uc).filter((p) => !p.injury && !p.suspended && !p.onLoanFrom)
            .sort((a, b) => overall(b) * (0.9 + rng.next() * 0.2) - overall(a) * (0.9 + rng.next() * 0.2));
          const xi = sq.slice(0, 11);
          for (const p of clubPlayers(state, uc)) {
            const on = xi.includes(p);
            if (on) { p.stats.apps++; p.stats.minutes += 90; p.form = clamp(p.form + rng.int(-6, 6), 5, 95); }
            p.morale = clamp(p.morale + (on ? (gf > ga ? 4 : gf < ga ? -4 : 0) : overall(p) > 68 ? -2 : 0), 5, 99);
            if (on && rng.chance(0.012)) { p.injury = rng.chance(0.15) ? rng.int(8, 25) : rng.int(1, 4); noteInjury(state, p); if (p.injLong) m.longInj++; }
          }
          state.board.fans = clamp(state.board.fans + (gf > ga ? 2.5 : gf < ga ? -3 : 0), 0, 100);
          const st = state.seasonStats; st.m++; st.gf += gf; st.ga += ga; st.poss += 50; st.mins += 990;
          const d = { opp: side ? f.h : f.a, comp: 'league', gf, ga, scorers: gf ? [rng.pick(xi).id] : [], worst: { id: rng.pick(xi).id, rating: 5 + rng.next() * 2 },
            reds: red && side === 0 ? [xi[3].id] : [], young: xi.filter((p) => p.age <= 21 && rng.chance(0.3)).map((p) => p.id), lineup: xi.map((p) => p.id), played: xi.map((p) => p.id),
            goalsBy: {}, controversy: rng.chance(0.15) };
          const before = xi.filter((p) => p.relapse).length;
          lifeAfterUserMatch(state, d, rng, f, entry);
          m.relapses += Math.max(0, before - xi.filter((p) => p.relapse).length);
          const iv = state.life.interview;
          if (iv && iv.kind === 'post') { m.interviews++; iv.qs.forEach((q, i) => answerInterview(state, i, rng.chance(0.1) ? 'skip' : rng.pick(STYLES))); }
        }
      }
      applyDayFinances(state, t, {}); // salaires tous les jours, billetterie les jours de match
      if (windowInfo(state).open && entry.type === "league") aiMoney(state, rng);
      for (const c of state.clubs) for (const id of c.playerIds) { const p = state.players[id]; if (p?.injury > 0) p.injury--; }
      lifeDaily(state, rng, t);
      for (const mm of openDecisions(state, 'request')) reqSeen.add(mm.id);
      m.maxOpen = Math.max(m.maxOpen, openDecisions(state, 'request').length);
      // Le « joueur » répond au hasard aux décisions (sauf l'interview, déjà traitée).
      const clubBefore = state.userClubId;
      autoResolveAll(state, rng);
      if (state.userClubId !== clubBefore) m.moved++;
      if (entry.type === 'league') {
        updateBoardParts(state, { pos: tablePosition(state, userClub(state).id), target: state.objectives.league.target, matchDiff: userDiff, leagueRound: entry.round });
        checkMidSeasonSack(state, entry.round);
      }
      if (state.sacked) {
        m.sacked++;
        const c = jobCandidates(state, true)[0] || state.clubs.find((x) => x.id !== state.userClubId);
        changeClub(state, c.id); delete state.sacked;
      }
      state.day++;
      if (state.day < state.calendar.length) {
        lifeNextDay(state, rng);
        const iv = state.life.interview;
        if (iv && iv.kind === 'pre' && iv.day === state.day) iv.qs.forEach((q, i) => answerConference(state, i, rng.pick(STYLES)));
      }
    }
    m.requests = reqSeen.size;
    m.virals = state.life.viralCount || 0; state.life.viralCount = 0;
    // Mesures de fin de saison (avant la transition).
    const uc = userClub(state);
    const sq = clubPlayers(state, uc);
    const all = state.clubs.flatMap((c) => clubPlayers(state, c));
    const rels = Object.values(state.rel || {});
    let hostile = 0, pairs = 0;
    for (const a of state.clubs) for (const b of state.clubs) if (a.id < b.id) { pairs++; if (relGet(state, a.id, b.id) <= BAL.relations.hostile) hostile++; }
    const row = {
      season: state.season,
      userMorale: sq.reduce((a, p) => a + p.morale, 0) / sq.length,
      worldMorale: all.reduce((a, p) => a + p.morale, 0) / all.length,
      dressing: state.coach.dressing, media: state.coach.media, fans: state.board.fans, board: state.board.confidence,
      crisis: state.clubs.filter((c) => c.crisis).length / state.clubs.length,
      bankrupt: state.clubs.filter((c) => finHealth(state, c) < BAL.crisis.bankrupt).length / state.clubs.length,
      meanHealth: state.clubs.reduce((a, c) => a + finHealth(state, c), 0) / state.clubs.length,
      relStored: rels.length, relMean: rels.length ? rels.reduce((a, v) => a + v, 0) / rels.length : 0, hostileShare: hostile / pairs,
      atmosphere: state.clubs.reduce((a, c) => a + (c.atmosphere ?? 55), 0) / state.clubs.length,
      sponsors: (state.sponsorDeals || []).length, messages: state.messages.length, statements: state.coach.statements.length,
      openDecisions: openDecisions(state).length, rumours: state.life.rumours.length,
      ...m,
    };
    const rep = endSeason(state);
    row.takeovers = state.clubs.filter((c) => c.owner?.since === state.season).length;
    row.relegated = rep.relegated.length;
    out.push(row);
    onSeason?.(row, s);
  }
  return { rows: out, state };
}

export const mean = (rows, k) => rows.reduce((a, r) => a + r[k], 0) / rows.length;
export const share = (rows, pred) => rows.filter(pred).length / rows.length;

if (process.argv[1] && process.argv[1].endsWith('drift.js')) {
  const n = +process.argv[2] || 500;
  const t0 = Date.now();
  const { rows } = runDrift(n, 2024, (r, i) => { if (i % 50 === 0) console.log(`saison ${i}`, JSON.stringify(Object.fromEntries(Object.entries(r).map(([k, v]) => [k, typeof v === 'number' ? Math.round(v * 100) / 100 : v])))); });
  const keys = Object.keys(rows[0]).filter((k) => typeof rows[0][k] === 'number');
  console.log(`\n${n} saisons en ${((Date.now() - t0) / 1000).toFixed(1)} s — moyennes :`);
  for (const k of keys) console.log(`  ${k.padEnd(14)} ${mean(rows, k).toFixed(3)}  (min ${Math.min(...rows.map((r) => r[k])).toFixed(2)}, max ${Math.max(...rows.map((r) => r[k])).toFixed(2)})`);
}
