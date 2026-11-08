/**
 * Tests du moteur de match : déterminisme et distributions sur 1000 matchs.
 * Lancer : npm test   (ou node --test tests/)
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { simulateMatch, summarize, createMatch, stepMinute, makeSub, changeFormation } from '../js/engine/match.js';
import { squadStrength } from '../js/engine/ratings.js';
import { createRng } from '../js/core/rng.js';
import { makeWorld, matchCfg } from './helpers.js';

const world = makeWorld(2024);
const div1 = world.clubs.filter((c) => c.div === 1);

test('même graine => même match (déterminisme)', () => {
  const a = summarize(simulateMatch(matchCfg(world, div1[0], div1[1], 123)));
  const b = summarize(simulateMatch(matchCfg(world, div1[0], div1[1], 123)));
  assert.deepEqual(a.score, b.score);
  assert.deepEqual(a.stats, b.stats);
  const c = summarize(simulateMatch(matchCfg(world, div1[0], div1[1], 124)));
  assert.notDeepEqual([a.stats[0].passes, a.stats[1].passes], [c.stats[0].passes, c.stats[1].passes]);
});

test('distributions réalistes sur 1000 matchs', () => {
  const rng = createRng(5);
  const N = 1000;
  let goals = 0, yel = 0, red = 0, fouls = 0, corners = 0, shots = 0, possHome = 0, draws = 0, homeWins = 0;
  let stronger = 0, upsets = 0, possDev = 0;
  const totals = {};
  for (let i = 0; i < N; i++) {
    const h = rng.pick(div1); let a = rng.pick(div1); while (a === h) a = rng.pick(div1);
    const s = summarize(simulateMatch(matchCfg(world, h, a, 10000 + i)));
    const g = s.score[0] + s.score[1];
    goals += g; totals[g] = (totals[g] || 0) + 1;
    for (const st of s.stats) { yel += st.yellows; red += st.reds; fouls += st.fouls; corners += st.corners; shots += st.shots; }
    possHome += s.possession[0];
    possDev += Math.abs(s.possession[0] - 50);
    if (s.score[0] === s.score[1]) draws++; else if (s.score[0] > s.score[1]) homeWins++;
    const sh = squadStrength(h.playerIds.map((id) => world.players[id]));
    const sa = squadStrength(a.playerIds.map((id) => world.players[id]));
    if (Math.abs(sh - sa) > 4 && s.score[0] !== s.score[1]) ((sh > sa) === (s.score[0] > s.score[1]) ? stronger++ : upsets++);
  }
  const avg = (v) => v / N;
  console.log(`buts ${avg(goals).toFixed(2)} | jaunes ${avg(yel).toFixed(2)} | rouges ${avg(red).toFixed(2)} | fautes ${avg(fouls).toFixed(1)} | corners ${avg(corners).toFixed(1)} | tirs ${avg(shots).toFixed(1)} | poss dom ${avg(possHome).toFixed(1)}% | nuls ${(draws / N * 100).toFixed(1)}% | dom ${(homeWins / N * 100).toFixed(1)}% | plus fort gagne ${(stronger / (stronger + upsets) * 100).toFixed(1)}%`);
  // Score moyen autour de 2,6 buts.
  assert.ok(avg(goals) > 2.3 && avg(goals) < 2.95, `buts/match = ${avg(goals)}`);
  // Distribution plausible : 0-0 rare mais présent, scores fleuves rares.
  assert.ok(totals[0] > N * 0.04 && totals[0] < N * 0.15, '0-0');
  assert.ok((totals[8] || 0) + (totals[9] || 0) + (totals[10] || 0) < N * 0.02, 'scores fleuves');
  // Possession : moyenne équilibrée mais variable selon les matchs.
  assert.ok(avg(possHome) > 47 && avg(possHome) < 55, 'possession moyenne');
  assert.ok(avg(possDev) > 3, 'la possession varie');
  // Cartons et fautes.
  assert.ok(avg(yel) > 2.5 && avg(yel) < 5, `jaunes = ${avg(yel)}`);
  assert.ok(avg(red) > 0.03 && avg(red) < 0.4, `rouges = ${avg(red)}`);
  assert.ok(avg(fouls) > 14 && avg(fouls) < 30, 'fautes');
  assert.ok(avg(corners) > 6 && avg(corners) < 14, 'corners');
  assert.ok(avg(shots) > 18 && avg(shots) < 32, 'tirs');
  // Résultats : avantage domicile, nuls ~ 20-30 %, le plus fort gagne souvent mais pas toujours.
  assert.ok(draws / N > 0.17 && draws / N < 0.33, 'nuls');
  assert.ok(homeWins / N > 0.38 && homeWins / N < 0.52, 'victoires à domicile');
  const sw = stronger / (stronger + upsets);
  assert.ok(sw > 0.6 && sw < 0.9, `le plus fort gagne ${sw}`);
});

test('match pas à pas : mi-temps, temps additionnel, fin', () => {
  const m = createMatch(matchCfg(world, div1[2], div1[3], 77));
  const types = [];
  let guard = 0;
  while (m.phase !== 'ft' && guard++ < 200) for (const e of stepMinute(m)) types.push(e.type);
  assert.ok(types.includes('ht'));
  assert.ok(types.includes('ft'));
  assert.equal(types.filter((t) => t === 'added').length, 2);
  assert.ok(m.extra >= 3 && m.extra <= 8, 'temps additionnel 2e MT');
});

test('remplacements limités à 5 et changement de formation', () => {
  const cfg = matchCfg(world, div1[4], div1[5], 88);
  cfg.home.isAI = false;
  const m = createMatch(cfg);
  for (let i = 0; i < 30; i++) stepMinute(m);
  const T = m.teams[0];
  let ok = 0;
  for (let i = 0; i < 7; i++) {
    const out = T.onPitch.find((mp) => mp && mp.onPitch && T.slots[mp.slot].pos !== 'GB' && mp.minIn === 0);
    const inn = T.bench.find((b) => !b.onPitch && b.minOut == null);
    if (!out || !inn) break;
    if (makeSub(m, 0, out.id, inn.id).ok) ok++;
  }
  assert.ok(ok <= 5 && T.subsUsed <= 5);
  changeFormation(m, 0, '3-5-2');
  assert.equal(T.slots.length, 11);
  assert.equal(T.tactics.formation, '3-5-2');
  while (m.phase !== 'ft') stepMinute(m);
  assert.equal(m.phase, 'ft');
});

test('la fatigue fait baisser l\'énergie au fil du match', () => {
  const m = createMatch(matchCfg(world, div1[6], div1[7], 99));
  while (m.phase !== 'ft') stepMinute(m);
  const starters = m.teams[0].onPitch.filter((mp) => mp && mp.minIn === 0 && mp.onPitch);
  for (const mp of starters) assert.ok(mp.energy < 95, `énergie ${mp.energy}`);
});
