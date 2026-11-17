/**
 * Polyvalence : postes principaux multiples et apprentissage d'un poste en y jouant.
 *  - Au départ, un joueur dont les qualités collent à un poste voisin (latéral rapide qui
 *    sait défendre au centre, milieu capable de jouer en sentinelle…) l'a déjà dans ses postes.
 *  - Chaque minute jouée à un poste qui n'est pas le sien donne de l'expérience : il s'y
 *    sent de mieux en mieux, puis le poste devient secondaire, et enfin un vrai poste principal.
 */
import { POSITIONS, positionFit } from '../data/constants.js';
import { rawRatingAt } from '../engine/ratings.js';
import { hashSeed, clamp } from '../core/rng.js';

/** Expérience (en matchs complets) pour qu'un poste devienne secondaire, puis pleinement maîtrisé. */
export const POS_LEARN = 15, POS_MASTER = 35;

/** Postes multiples d'origine, d'après les qualités (déterministe, une seule fois par joueur). */
export function assignVersatility(p) {
  if (p.versV === 1 || !p.attrs || p.pos === 'GB') { p.versV = 1; return; }
  p.versV = 1;
  const have = new Set(p.pos2 || []);
  if (have.size >= 2) return;
  const base = rawRatingAt(p, p.pos);
  const cands = POSITIONS.filter((x) => x !== p.pos && x !== 'GB' && !have.has(x) && positionFit(p.pos, x) >= 0.84)
    .map((x) => ({ x, d: rawRatingAt(p, x) - base, h: (hashSeed(`vers-${p.id}-${x}`) % 1000) / 1000 }))
    .filter((c) => c.d >= -3.5)
    .sort((a, b) => b.d - a.d);
  for (const c of cands) {
    if (have.size >= 2) break;
    const chance = 0.42 + c.d * 0.06 + ((p.age || 25) >= 27 ? 0.1 : 0);
    if (c.h < chance) have.add(c.x);
  }
  if (have.size) p.pos2 = [...have];
}

export function assignAllVersatility(state) {
  for (const p of Object.values(state.players)) assignVersatility(p);
  state.versV = 1;
}

/** Aisance d'un joueur à un poste grâce à l'expérience (0 → 1 au moment où il l'apprend). */
export const posExp = (p, pos) => (p.posXp?.[pos] || 0);

/**
 * Minutes jouées à un poste. Renvoie le poste appris (ou maîtrisé) s'il franchit un cap.
 */
export function playedAt(p, pos, mins) {
  if (!pos || pos === p.pos || pos === 'GB' || p.pos === 'GB' || mins <= 0) return null;
  p.posXp ||= {};
  const before = p.posXp[pos] || 0;
  if (before >= POS_MASTER) return null;
  const age = p.age || 25;
  const xp = clamp(before + (mins / 90) * (age <= 23 ? 1.25 : age >= 31 ? 0.75 : 1), 0, POS_MASTER);
  p.posXp[pos] = Math.round(xp * 100) / 100;
  if (before < POS_LEARN && xp >= POS_LEARN && !(p.pos2 || []).includes(pos)) { (p.pos2 ||= []).push(pos); return { learned: pos }; }
  if (before < POS_MASTER && xp >= POS_MASTER) return { mastered: pos };
  return null;
}
