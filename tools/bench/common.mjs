/**
 * Banc d'essai du moteur de match (outils de mesure, hors du jeu).
 * Construit une partie de référence (monde réel, graine fixe) et des configurations de match
 * reproductibles : même graine → même match.
 */
const R = new URL('../../js/', import.meta.url).href;
if (process.env.T) globalThis.__T = JSON.parse(process.env.T);   // réglages expérimentaux (jamais en jeu)
export const { loadRealData } = await import(R + 'data/realWorld.js');
export const { newGame, matchCfgFor } = await import(R + 'game/season.js');
export const { createMatch, simulateMatch, summarize } = await import(R + 'engine/match.js');
export const { LiveSim } = await import(R + 'engine/live.js');
export const L = 105, W = 68;

let _st = null;
export async function world() {
  if (!_st) _st = newGame(21, { real: await loadRealData() });
  return _st;
}
/** Configuration du match n° i (deux clubs de Ligue 1, IA des deux côtés, graine = i). */
export async function cfgFor(i) {
  const st = await world();
  const l1 = st.clubs.filter((c) => c.div === 5).sort((a, b) => b.rep - a.rep);
  const cfg = matchCfgFor(st, { h: l1[(i * 5) % l1.length].id, a: l1[(i * 11 + 3) % l1.length].id, comp: 'league', div: 5 });
  cfg.seed = i; cfg.home.isAI = cfg.away.isAI = true;
  return cfg;
}
/** Joue un match en direct entier par pas fixes ; onStep(sim, m, evs) à chaque pas. */
export function runLive(cfg, { dt = 1 / 96, onStep, setup } = {}) {
  const m = createMatch(cfg); const sim = new LiveSim(m);
  if (setup) setup(sim, m);
  for (let k = 0; k < 2_000_000 && m.phase !== 'ft'; k++) {
    const evs = sim.step(dt);
    if (m.phase === 'ht') sim.resumeHT = true;
    if (onStep) onStep(sim, m, evs);
  }
  return { m, sim };
}
/** Empreinte (hachage FNV-1a) d'une chaîne. */
export function hash(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, '0');
}
