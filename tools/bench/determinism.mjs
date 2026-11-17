// Déterminisme du moteur EN DIRECT : deux exécutions avec la même graine doivent être identiques
// (journal d'événements, score, positions finales). Une troisième graine doit différer.
import { cfgFor, runLive, hash } from './common.mjs';
const { Diag } = await import(new URL('../../js/engine/diag.js', import.meta.url).href);
const seed = +(process.argv[2] || 5), minutes = +(process.argv[3] || 20);
async function run(s, withDiag = false) {
  const cfg = await cfgFor(s); const parts = [];
  const { m, sim } = runLive(cfg, { setup: (sim2) => { if (withDiag) sim2.diag = new Diag(); }, onStep: (sim2, m2, evs) => { for (const e of evs) parts.push(`${e.type}:${e.pid ?? ''}:${e.minute}`); if (m2.minute >= minutes) m2.phase = 'ft'; } });
  parts.push(m.score.join('-'));
  for (const p of sim.players.values()) parts.push(`${p.x.toFixed(6)},${p.y.toFixed(6)}`);
  parts.push(`${sim.P.x.toFixed(6)},${sim.P.y.toFixed(6)},${sim.P.z.toFixed(6)}`);
  return hash(parts.join('|'));
}
const a = await run(seed), b = await run(seed), c = await run(seed + 1), d = await run(seed, true);
const ok = a === b && a !== c && a === d;
console.log(JSON.stringify({ seed, minutes, run1: a, run2: b, otherSeed: c, withDiag: d, deterministic: a === b, seedMatters: a !== c, diagNeutral: a === d }));
process.exit(ok ? 0 : 1);
