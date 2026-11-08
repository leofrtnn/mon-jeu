/** Outils de test : monde + configuration de match pour deux clubs. */
import { createRng } from '../js/core/rng.js';
import { createWorld } from '../js/data/generator.js';
import { aiPrepare } from '../js/engine/ai.js';

export function makeWorld(seed = 42) {
  return createWorld(createRng(seed));
}

export function matchCfg(world, homeClub, awayClub, seed, extra = {}) {
  const hp = homeClub.playerIds.map((id) => world.players[id]);
  const ap = awayClub.playerIds.map((id) => world.players[id]);
  const rng = createRng(seed ^ 0x9e3779b9);
  const h = aiPrepare(hp, ap, true, rng);
  const a = aiPrepare(ap, hp, false, rng);
  return {
    seed,
    home: { club: homeClub, players: hp, lineup: h.lineup, bench: h.bench, tactics: h.tactics, isAI: true },
    away: { club: awayClub, players: ap, lineup: a.lineup, bench: a.bench, tactics: a.tactics, isAI: true },
    ...extra,
  };
}
