/**
 * ARBITRES : chaque match a son arbitre, avec sa personnalité (tirée de son identité, stable).
 *  - sévérité : facilité à sortir les cartons (0,75 = laxiste, 1,35 = très sévère) ;
 *  - tolérance au contact : siffle-t-il chaque contact (1,15) ou laisse-t-il jouer (0,85) ?
 * Le moteur et l'avant-match utilisent le même profil.
 */
import { hashSeed } from '../core/rng.js';

export function refereeProfile(seed) {
  const h = hashSeed(`arbitre-${seed}`) >>> 0;
  const u = (k) => ((h >>> (k * 5)) % 1000) / 1000;
  const strict = +(0.75 + u(0) * 0.6).toFixed(2);
  const whistle = +(0.85 + u(1) * 0.3).toFixed(2);
  const label = strict > 1.18 ? 'sévère' : strict < 0.88 ? 'laxiste' : whistle < 0.93 ? 'laisse jouer' : whistle > 1.08 ? 'pointilleux' : 'équilibré';
  return { strict, whistle, label };
}
