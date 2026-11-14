/**
 * Moteur de match en direct (engine/live.js) : matchs complets sans affichage.
 * Vérifie le déroulement (mi-temps, fin), la cohérence du score, des moyennes réalistes
 * et l'influence du niveau des équipes.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadRealData } from '../js/data/realWorld.js';
import { newGame, matchCfgFor } from '../js/game/season.js';
import { createMatch } from '../js/engine/match.js';
import { simulateLive } from '../js/engine/live.js';

const data = await loadRealData();
const st = newGame(21, { real: data });
const l1 = st.clubs.filter((c) => c.div === 5).sort((a, b) => b.rep - a.rep);

function play(h, a, seed) {
  const cfg = matchCfgFor(st, { h: h.id, a: a.id, comp: 'league', div: 5 });
  cfg.seed = seed;
  cfg.home.isAI = true; cfg.away.isAI = true;
  const m = createMatch(cfg);
  simulateLive(m, 0.05);
  return m;
}

test('match complet en direct : mi-temps, fin, score cohérent avec les buteurs', () => {
  const m = play(l1[2], l1[9], 5);
  assert.equal(m.phase, 'ft');
  assert.ok(m.minute >= 90);
  assert.equal(m.goals.length, m.score[0] + m.score[1]);
  for (const g of m.goals) assert.ok(m.teams[g.side].onPitch.concat(m.teams[g.side].out).some((mp) => mp && mp.name === g.name));
  const s = m.teams.map((t) => t.stats);
  assert.ok(s[0].poss + s[1].poss > 0);
  assert.ok(s.every((x) => x.passes > 30 && x.passesOk <= x.passes));
});

test('moyennes réalistes sur 10 matchs (buts, tirs, fautes, corners, cartons)', () => {
  const tot = { goals: 0, shots: 0, fouls: 0, corners: 0, yellows: 0 };
  const N = 10;
  for (let i = 0; i < N; i++) {
    const m = play(l1[(i * 5) % l1.length], l1[(i * 11 + 3) % l1.length], 100 + i);
    tot.goals += m.score[0] + m.score[1];
    for (const t of m.teams) { tot.shots += t.stats.shots; tot.fouls += t.stats.fouls; tot.corners += t.stats.corners; tot.yellows += t.stats.yellows; }
  }
  const avg = Object.fromEntries(Object.entries(tot).map(([k, v]) => [k, v / N]));
  assert.ok(avg.goals > 1.2 && avg.goals < 4.5, `buts ${avg.goals}`);
  assert.ok(avg.shots > 10 && avg.shots < 34, `tirs ${avg.shots}`); // systèmes plus variés (5-4-1, 4-1-4-1…) : un peu moins de tirs
  assert.ok(avg.fouls > 9 && avg.fouls < 32, `fautes ${avg.fouls}`);
  assert.ok(avg.corners > 2.5 && avg.corners < 14, `corners ${avg.corners}`);
  assert.ok(avg.yellows > 1 && avg.yellows < 7, `jaunes ${avg.yellows}`);
});

test('le plus fort domine : le meilleur club de Ligue 1 bat nettement le plus faible', () => {
  let gf = 0, ga = 0, xgf = 0, xga = 0;
  for (let i = 0; i < 6; i++) {
    const m = play(l1[0], l1[l1.length - 1], 300 + i);
    gf += m.score[0]; ga += m.score[1]; xgf += m.teams[0].stats.xg; xga += m.teams[1].stats.xg;
  }
  assert.ok(xgf > xga * 1.5, `xG ${xgf.toFixed(1)} contre ${xga.toFixed(1)}`);
  assert.ok(gf > ga, `buts ${gf} contre ${ga}`);
});
