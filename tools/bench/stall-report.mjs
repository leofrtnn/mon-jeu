// Matchs bloqués (diagnostic, étape 5c) : par graine, distance en jeu effectif (joueurs de champ,
// ramenée à 90 min), distance totale des 22 joueurs, temps de ballon figé (en jeu, libre, immobile
// depuis > 5 s, sans remise), temps passé avec `celebrate` < 0 hors VAR (défaut corrigé : après un
// but annulé par la VAR, le compteur n'était pas remis à zéro), temps de jeu effectif `jeu` et durée
// simulée `duree` (min). Observation seulement.
// Usage : node tools/bench/stall-report.mjs [graines, ex. 100-115 ou 100,101,200]
import { cfgFor, createMatch, LiveSim } from './common.mjs';
const arg = process.argv[2] || '100-115';
const seeds = arg.includes('-') ? (([a, b]) => Array.from({ length: b - a + 1 }, (_, i) => a + i))(arg.split('-').map(Number)) : arg.split(',').map(Number);
for (const s of seeds) {
  const m = createMatch(await cfgFor(s)), sim = new LiveSim(m), dt = 1 / 96;
  let live = 0, liveT = 0, all = 0, frozen = 0, still = 0, celebNeg = 0, playT = 0, simT = 0;
  for (let k = 0; k < 2_000_000 && m.phase !== 'ft'; k++) {
    sim.step(dt); if (m.phase === 'ht') sim.resumeHT = true;
    const isLive = m.phase === 'live' && !sim.restart && !(sim.celebrate > 0);
    simT += dt; if (isLive) playT += dt;
    const P = sim.P;
    if (m.phase === 'live' && sim.celebrate < 0 && !(sim.varT > 0)) celebNeg += dt;
    if (isLive && !sim.holder && !sim.pending && Math.hypot(P.vx, P.vy) < 0.05) { still += dt; if (still > 5) frozen += dt; } else still = 0;
    for (const p of sim.players.values()) { const d = (p.speed || 0) * dt; all += d; if (p.gk) continue; if (isLive) { live += d; liveT += dt; } }
  }
  const st = (k) => m.teams.reduce((a, t) => a + (t.stats[k] || 0), 0);
  console.log(JSON.stringify({ s, jeu: +(playT / 60).toFixed(1), duree: +(simT / 60).toFixed(1), live: +(live / liveT * 5400 / 1000).toFixed(2), all: +(all / 1000).toFixed(1), frozen: +frozen.toFixed(0), celebNeg: +celebNeg.toFixed(0), goals: m.score[0] + m.score[1], shots: st('shots'), tackles: st('tackles'), fouls: st('fouls'), offsides: st('offsides'), passes: st('passes') }));
}
process.exit(0);
