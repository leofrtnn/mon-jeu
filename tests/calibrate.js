/**
 * Calibration du moteur : simule N matchs et affiche les distributions.
 * Usage : node tests/calibrate.js [N]
 */
import { simulateMatch, summarize } from '../js/engine/match.js';
import { squadStrength } from '../js/engine/ratings.js';
import { makeWorld, matchCfg } from './helpers.js';
import { createRng } from '../js/core/rng.js';

const N = +process.argv[2] || 1000;
const world = makeWorld(7);
const rng = createRng(99);
const div1 = world.clubs.filter((c) => c.div === 1);
const acc = { goals: 0, shots: 0, onT: 0, xg: 0, fouls: 0, yel: 0, red: 0, corn: 0, off: 0, pass: 0, passOk: 0,
  hw: 0, d: 0, aw: 0, possH: 0, strongerWins: 0, upsets: 0, inj: 0, pens: 0, subs: 0, possMin: 100, possMax: 0 };
const dist = {};
const t0 = Date.now();
for (let i = 0; i < N; i++) {
  const h = rng.pick(div1); let a = rng.pick(div1); while (a === h) a = rng.pick(div1);
  const m = simulateMatch(matchCfg(world, h, a, 1000 + i));
  const s = summarize(m);
  const [g0, g1] = s.score;
  acc.goals += g0 + g1;
  dist[g0 + g1] = (dist[g0 + g1] || 0) + 1;
  for (const st of s.stats) {
    acc.shots += st.shots; acc.onT += st.onTarget; acc.xg += st.xg; acc.fouls += st.fouls;
    acc.yel += st.yellows; acc.red += st.reds; acc.corn += st.corners; acc.off += st.offsides;
    acc.pass += st.passes; acc.passOk += st.passesOk;
  }
  acc.possH += s.possession[0];
  acc.possMin = Math.min(acc.possMin, s.possession[0]); acc.possMax = Math.max(acc.possMax, s.possession[0]);
  if (g0 > g1) acc.hw++; else if (g0 === g1) acc.d++; else acc.aw++;
  const sh = squadStrength(h.playerIds.map((id) => world.players[id]));
  const sa = squadStrength(a.playerIds.map((id) => world.players[id]));
  if (Math.abs(sh - sa) > 4 && g0 !== g1) {
    if ((sh > sa) === (g0 > g1)) acc.strongerWins++; else acc.upsets++;
  }
  acc.inj += m.log.filter((e) => e.type === 'injury').length;
  acc.pens += m.log.filter((e) => e.type === 'penalty').length;
  acc.subs += m.log.filter((e) => e.type === 'sub').length;
}
const f = (v) => (v / N).toFixed(2);
console.log(`${N} matchs en ${Date.now() - t0} ms`);
console.log(`Buts/match ${f(acc.goals)} | Tirs ${f(acc.shots)} | Cadrés ${f(acc.onT)} | xG ${f(acc.xg)}`);
console.log(`Fautes ${f(acc.fouls)} | Jaunes ${f(acc.yel)} | Rouges ${f(acc.red)} | Corners ${f(acc.corn)} | Hors-jeu ${f(acc.off)}`);
console.log(`Passes ${f(acc.pass)} (${(acc.passOk / acc.pass * 100).toFixed(1)}%) | Pénaltys ${f(acc.pens)} | Blessures ${f(acc.inj)} | Remplacements ${f(acc.subs)}`);
console.log(`Dom ${(acc.hw / N * 100).toFixed(1)}% Nul ${(acc.d / N * 100).toFixed(1)}% Ext ${(acc.aw / N * 100).toFixed(1)}% | Possession dom moy ${f(acc.possH)}% (min ${acc.possMin}, max ${acc.possMax})`);
console.log(`Plus fort gagne (écart>4) ${(acc.strongerWins / (acc.strongerWins + acc.upsets) * 100).toFixed(1)}% (surprises ${acc.upsets})`);
console.log('Distribution buts :', Object.keys(dist).sort((a, b) => a - b).map((k) => `${k}:${dist[k]}`).join(' '));
