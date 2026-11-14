/**
 * IA des entraîneurs : choix de formation/mentalité avant-match,
 * remplacements et ajustements selon le score pendant le match.
 */
import { FORMATION_NAMES, COMMON_FORMATIONS, MAX_SUBS } from '../data/constants.js';
import { autoLineup, lineupStrength, squadStrength } from './ratings.js';

/**
 * Choisit la meilleure formation selon les joueurs disponibles,
 * et une mentalité selon le rapport de force avec l'adversaire.
 */
/** Sous-ensemble de consignes (l'IA garde l'intensité adaptée à l'adversaire). */
const pick = (o, keys) => Object.fromEntries(Object.entries(o || {}).filter(([k]) => keys.includes(k)));

export function aiPrepare(players, opponentPlayers, isHome, rng, pref = null) {
  let best = null;
  const prefOf = pref;
  // Candidats : systèmes standard, celui de l'entraîneur, et trois autres tirés au sort (variété, sans tout évaluer).
  const cand = new Set(['4-4-2', '4-3-3', '4-2-3-1']);
  if (prefOf?.formation && FORMATION_NAMES.includes(prefOf.formation)) cand.add(prefOf.formation);
  for (let i = 0; i < 3; i++) cand.add(rng ? COMMON_FORMATIONS[Math.floor(rng.next() * COMMON_FORMATIONS.length)] : '3-5-2');
  for (const f of cand) {
    const lu = autoLineup(players, f);
    // Petite préférence pour les systèmes "standard" + bruit pour la variété.
    const pref = f === '4-4-2' || f === '4-3-3' || f === '4-2-3-1' ? 0.6 : 0;
    const sc = lineupStrength(players, lu.lineup, f) + pref + (rng ? rng.normal(0, 0.5) : 0) + (prefOf && prefOf.formation === f ? 1.4 : 0);
    if (!best || sc > best.sc) best = { sc, f, lu };
  }
  const diff = squadStrength(players) - squadStrength(opponentPlayers) + (isHome ? 1.5 : -1.5);
  const mentality = diff > 3 ? 'offensive' : diff < -4 ? 'defensive' : 'balanced';
  const pressing = diff > 5 ? 'high' : diff < -5 ? 'low' : 'mid';
  // Style de jeu : les favoris confisquent le ballon, les petits jouent bas et en contre.
  const style = diff > 4 ? { passing: 'short', line: 'high', crossing: 'mid' }
    : diff < -4 ? { passing: 'direct', line: 'low', counter: 'on', tackling: 'hard' } : {};
  return {
    // La philosophie de l'entraîneur prime sur le style par défaut (la mentalité reste adaptée à l'adversaire).
    tactics: { formation: best.f, mentality, pressing, tempo: 'mid', width: 'mid', ...style, ...(pref ? pick(pref.tactics, ['passing', 'width', 'crossing', 'counter', 'line']) : {}) },
    lineup: best.lu.lineup, bench: best.lu.bench,
  };
}

/**
 * Gestion IA pendant le match, appelée chaque minute.
 * - Mentalité selon le score en fin de match.
 * - Remplacements des joueurs fatigués ou en difficulté à partir de 58'.
 */
export function aiManage(m, T, out, { doSub, bestBenchFor }) {
  const diff = m.score[T.side] - m.score[1 - T.side];
  const min = m.minute;
  if (min === 65 || min === 75 || min === 83) {
    if (diff < 0) T.tactics.mentality = 'offensive';
    else if (diff > 0 && min >= 75) T.tactics.mentality = 'defensive';
    if (diff < 0 && min >= 75) T.tactics.pressing = 'high';
  }
  if (((m.period === 2 && [58, 66, 74, 82].includes(min)) || (m.period >= 3 && [95, 106].includes(min))) && m.extra === 0 && T.subsUsed < MAX_SUBS) {
    const cands = T.onPitch
      .filter((mp) => mp && mp.onPitch && !mp.red && !mp.injured && T.slots[mp.slot].pos !== 'GB')
      .map((mp) => ({ mp, need: (80 - mp.energy) / 8 + (6.4 - mp.rating) * 1.2 + (mp.yellow ? 0.6 : 0) + (min >= 74 ? 1 : min >= 66 ? 0.5 : 0) + (diff < 0 && ['BU', 'AG', 'AD', 'MO'].includes(T.slots[mp.slot].pos) ? 0.6 : 0) }))
      .filter((c) => c.need > 0.6)
      .sort((a, b) => b.need - a.need);
    const n = Math.min(cands.length, min >= 74 ? 2 : 1, MAX_SUBS - T.subsUsed);
    for (let i = 0; i < n; i++) {
      const sub = bestBenchFor(T, cands[i].mp.slot);
      if (sub) doSub(m, out, T, cands[i].mp, sub, false);
    }
  }
}
