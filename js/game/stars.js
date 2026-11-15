/**
 * ÉTOILES DE GESTES TECHNIQUES ET DE MAUVAIS PIED (1 à 5)
 * ------------------------------------------------------------------
 * Aucune base publique ne les donne pour tous les joueurs : elles sont calculées d'après les
 * vraies qualités (dribble, vitesse, technique, frappe, passe, poste, traits) plus une part
 * propre à chaque joueur (stable). Elles évoluent d'une saison à l'autre, d'une étoile au
 * plus : un joueur qui progresse en débloque, un joueur qui décline en perd.
 *
 * Gestes réservés aux joueurs qui ont assez d'étoiles (voir SKILL_MOVES) ; le mauvais pied
 * règle la qualité des frappes et des passes de son « autre » pied.
 */
import { hashSeed } from '../core/rng.js';

const A = (p, k) => p.attrs?.[k] ?? 50;
const jitter = (p, salt) => ((hashSeed(`${salt}-${p.id}`) >>> 0) % 1000) / 1000 - 0.5; // -0,5 … 0,5

/** Étoiles « idéales » de gestes techniques d'après le profil actuel. */
function skillTarget(p) {
  if (p.pos === 'GB') return 1;
  const tech = A(p, 'dri') * 0.75 + A(p, 'vit') * 0.15 + A(p, 'vis') * 0.1;
  let s = tech < 58 ? 1 : tech < 67 ? 2 : tech < 75 ? 3 : tech < 83 ? 4 : 5;
  if (['DC'].includes(p.pos)) s = Math.min(s, 3);
  if (['MDC', 'DG', 'DD'].includes(p.pos)) s = Math.min(s, 4);
  if (p.traits?.includes('magicien')) s = Math.max(s, 5);
  else if (p.traits?.includes('provocateur')) s = Math.max(s, 4);
  // Un joueur sur quatre environ a un style plus (ou moins) spectaculaire que ses notes.
  const j = jitter(p, 'sm');
  if (j > 0.38) s += 1; else if (j < -0.4) s -= 1;
  return Math.max(1, Math.min(5, s));
}

/** Étoiles « idéales » de mauvais pied. */
function weakTarget(p) {
  const q = A(p, 'tir') * 0.5 + A(p, 'pas') * 0.5;
  const base = 1.6 + (q - 45) / 22 + jitter(p, 'wf') * 2.2; // la plupart entre 2 et 4
  return Math.max(1, Math.min(5, Math.round(base)));
}

/** Première attribution (nouvelle partie, ancienne sauvegarde). */
export function initStars(p) {
  if (p.sm == null) p.sm = skillTarget(p);
  if (p.wf == null) p.wf = weakTarget(p);
}

/**
 * Évolution de fin de saison : une étoile de plus ou de moins au maximum, vers le niveau
 * que justifient les qualités actuelles. Retourne { sm: ±1|0, wf: ±1|0 }.
 */
export function evolveStars(p) {
  initStars(p);
  const out = { sm: 0, wf: 0 };
  const ts = skillTarget(p), tw = weakTarget(p);
  if (ts > p.sm) { p.sm++; out.sm = 1; } else if (ts < p.sm - (p.age >= 30 ? 0 : 1)) { p.sm--; out.sm = -1; } // les jeunes gardent leurs gestes un peu plus longtemps
  if (tw > p.wf && Math.abs(jitter(p, `wfy${p.age}`)) < 0.3) { p.wf++; out.wf = 1; } // travailler son mauvais pied : pas tous les ans
  else if (tw < p.wf - 1) { p.wf--; out.wf = -1; }
  return out;
}

export function assignAllStars(state) {
  for (const p of Object.values(state.players)) initStars(p);
  state.starsV = 1;
}

/**
 * Gestes techniques : étoiles minimum, efficacité (bonus de réussite du dribble), description.
 * `ball` : ce que fait le ballon (pour la physique) ; `beat` : façon d'éliminer le défenseur.
 */
export const SKILL_MOVES = {
  crochet: { name: 'Crochet', stars: 1, bonus: 0.0, desc: 'Changement de direction avec l\'intérieur du pied.' },
  feinte: { name: 'Feinte de corps', stars: 1, bonus: 0.04, desc: 'Le buste part d\'un côté, le ballon de l\'autre.' },
  passement: { name: 'Passement de jambes', stars: 2, bonus: 0.07, desc: 'La jambe enjambe le ballon pour déséquilibrer le défenseur.' },
  jongle: { name: 'Jongle', stars: 2, bonus: 0.03, desc: 'Petit jongle pour contrôler et lever le ballon.' },
  petitpont: { name: 'Petit pont', stars: 3, bonus: 0.1, desc: 'Le ballon passe entre les jambes du défenseur.' },
  talon: { name: 'Talonnade', stars: 3, bonus: 0.08, desc: 'Le ballon repart du talon dans le dos de l\'adversaire.' },
  roulette: { name: 'Roulette', stars: 4, bonus: 0.14, desc: 'Pivot complet sur le ballon (semelle, demi-tour, semelle).' },
  sombrero: { name: 'Sombrero', stars: 4, bonus: 0.13, desc: 'Le ballon passe au-dessus de la tête du défenseur.' },
  virgule: { name: 'Virgule (elastico)', stars: 5, bonus: 0.18, desc: 'L\'extérieur pousse, l\'intérieur ramène : le ballon dessine une virgule.' },
  coupdusombrero: { name: 'Coup du foulard', stars: 5, bonus: 0.12, desc: 'La jambe passe derrière la jambe d\'appui pour frapper ou centrer.' },
};
export const SKILL_KEYS = Object.keys(SKILL_MOVES);

/** Gestes accessibles à un joueur (selon ses étoiles). */
export const movesFor = (p) => SKILL_KEYS.filter((k) => SKILL_MOVES[k].stars <= (p?.sm ?? 2));

/** Étoiles en texte (★★★☆☆). */
export const starsText = (n) => '★'.repeat(Math.max(0, n || 0)) + '☆'.repeat(Math.max(0, 5 - (n || 0)));
