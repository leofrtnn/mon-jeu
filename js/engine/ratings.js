/**
 * Calculs de notes : note globale par poste, condition du jour, compo automatique.
 * Module pur (pas d'accès au DOM ni à l'état global) : utilisable dans les tests Node.
 */
import { POSITION_WEIGHTS, positionFit, FORMATIONS, BENCH_SIZE } from '../data/constants.js';

/** Note brute d'un joueur à un poste (sans pénalité de placement). */
export function rawRatingAt(p, pos) {
  const w = POSITION_WEIGHTS[pos];
  let r = 0;
  for (const k in w) r += (p.attrs[k] || 0) * w[k];
  return r;
}

/** Note d'un joueur à un poste, avec pénalité s'il n'est pas à son poste naturel. */
export function ratingAt(p, pos) {
  return rawRatingAt(p, pos) * positionFit(p.pos, pos);
}

/** Note globale (poste naturel), arrondie. */
export function overall(p) {
  return Math.round(rawRatingAt(p, p.pos));
}

/** Disponible pour un match ? */
export function isAvailable(p) {
  return !(p.injury > 0) && !(p.suspended > 0) && !p.loanedOut;
}

/**
 * Multiplicateur de forme du jour : forme (0-100, 50 neutre), moral (0-100), énergie (0-100).
 * Une énergie de 100 => 1.0 ; 60 => ~0.89.
 */
export function conditionFactor(p, energy = 100) {
  const e = 0.72 + 0.28 * (energy / 100);
  const f = 1 + ((p.form ?? 50) - 50) / 1250;
  const m = 1 + ((p.morale ?? 50) - 50) / 1700;
  return e * f * m;
}

/** Valeur d'un joueur pour la compo (note au poste * condition). */
function selectionScore(p, pos) {
  const fresh = 100 - (p.fatigue || 0);
  return ratingAt(p, pos) * (0.75 + 0.25 * fresh / 100);
}

/**
 * Compo automatique gloutonne : remplit d'abord les postes les plus "rares".
 * Retourne { lineup: [11 ids dans l'ordre des slots], bench: [ids] }.
 */
export function autoLineup(players, formation) {
  const slots = Array.isArray(formation) ? formation : FORMATIONS[formation];
  const avail = players.filter(isAvailable);
  const used = new Set();
  const lineup = new Array(slots.length).fill(null);
  // Ordre : gardien, puis postes avec le moins de candidats naturels.
  const order = slots.map((s, i) => i).sort((a, b) => {
    const ca = avail.filter((p) => p.pos === slots[a].pos).length + (slots[a].pos === 'GB' ? -100 : 0);
    const cb = avail.filter((p) => p.pos === slots[b].pos).length + (slots[b].pos === 'GB' ? -100 : 0);
    return ca - cb;
  });
  for (const i of order) {
    let best = null, bestS = -1;
    for (const p of avail) {
      if (used.has(p.id)) continue;
      const sc = selectionScore(p, slots[i].pos);
      if (sc > bestS) { bestS = sc; best = p; }
    }
    if (best) { lineup[i] = best.id; used.add(best.id); }
  }
  // Banc : un gardien remplaçant + les meilleurs restants, variés.
  const rest = avail.filter((p) => !used.has(p.id)).sort((a, b) => overall(b) - overall(a));
  const bench = [];
  const gk = rest.find((p) => p.pos === 'GB');
  if (gk) bench.push(gk.id);
  for (const p of rest) {
    if (bench.length >= BENCH_SIZE) break;
    if (!bench.includes(p.id)) bench.push(p.id);
  }
  return { lineup, bench };
}

/** Force moyenne d'un onze (notes au poste). */
export function lineupStrength(players, lineup, formation) {
  const byId = new Map(players.map((p) => [p.id, p]));
  const slots = Array.isArray(formation) ? formation : FORMATIONS[formation];
  let sum = 0, n = 0;
  lineup.forEach((id, i) => {
    const p = byId.get(id);
    if (p) { sum += ratingAt(p, slots[i].pos); n++; }
  });
  return n ? sum / 11 : 0;
}

/** Force globale d'un club (moyenne des 16 meilleurs). */
export function squadStrength(players) {
  const o = players.map(overall).sort((a, b) => b - a).slice(0, 16);
  return o.reduce((a, b) => a + b, 0) / Math.max(1, o.length);
}
