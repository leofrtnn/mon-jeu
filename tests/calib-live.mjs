// Calibrage du moteur en direct : moyennes sur N matchs de Ligue 1 (node tests/calib-live.mjs [N]).
import { loadRealData } from '../js/data/realWorld.js';
import { newGame, matchCfgFor } from '../js/game/season.js';
import { createMatch } from '../js/engine/match.js';
import { simulateLive } from '../js/engine/live.js';
const N = +(process.argv[2] || 8);
const st = newGame(21, { real: await loadRealData() });
const l1 = st.clubs.filter((c) => c.div === 5).sort((a, b) => b.rep - a.rep);
const tot = { goals: 0, shots: 0, onT: 0, fouls: 0, corners: 0, passes: 0, yellows: 0, throws: 0 };
for (let i = 0; i < N; i++) {
  const cfg = matchCfgFor(st, { h: l1[(i * 5) % l1.length].id, a: l1[(i * 11 + 3) % l1.length].id, comp: 'league', div: 5 });
  cfg.seed = 100 + i; cfg.home.isAI = true; cfg.away.isAI = true;
  const m = createMatch(cfg); simulateLive(m, 0.05);
  tot.goals += m.score[0] + m.score[1];
  for (const t of m.teams) { tot.shots += t.stats.shots; tot.onT += t.stats.onTarget; tot.fouls += t.stats.fouls; tot.corners += t.stats.corners; tot.passes += t.stats.passes; tot.yellows += t.stats.yellows; }
}
console.log(Object.fromEntries(Object.entries(tot).map(([k, v]) => [k, +(v / N).toFixed(1)])));
