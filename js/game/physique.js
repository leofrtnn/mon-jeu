/**
 * MORPHOLOGIE : taille (réelle quand elle est connue) et poids. Les sources publiques utilisées
 * ne donnent pas le poids : il est ESTIMÉ (indice de masse corporelle typique d'un footballeur
 * selon le poste et la puissance physique, plus une part propre à chaque joueur).
 */
import { hashSeed } from '../core/rng.js';

const j = (p, salt) => ((hashSeed(`${salt}-${p.id}`) >>> 0) % 1000) / 1000 - 0.5;

/** Taille (cm) : donnée réelle si présente, sinon estimée d'après le poste et le physique. */
export function heightOf(p) {
  if (p?.height) return p.height;
  const base = { GB: 189, DC: 187, MDC: 181, DG: 177, DD: 177, MC: 179, MO: 176, AG: 175, AD: 175, BU: 183 }[p?.pos] ?? 180;
  return Math.round(base + ((p?.attrs?.phy ?? 65) - 65) * 0.15 + j(p || {}, 'h') * 9);
}

/** Indice de masse corporelle (21 à 25,5 chez les pros). */
export function bmiOf(p) {
  const pos = { DC: 0.7, BU: 0.6, GB: 0.4, MDC: 0.3, MC: 0, DG: -0.2, DD: -0.2, MO: -0.4, AG: -0.6, AD: -0.6 }[p?.pos] ?? 0;
  return Math.max(20.5, Math.min(26, 22.4 + ((p?.attrs?.phy ?? 65) - 65) * 0.05 + pos + j(p || {}, 'w') * 2.2));
}

/** Poids (kg) : réel si présent, sinon estimé. */
export function weightOf(p) {
  if (p?.weight) return p.weight;
  const h = heightOf(p) / 100;
  return Math.round(bmiOf(p) * h * h);
}
