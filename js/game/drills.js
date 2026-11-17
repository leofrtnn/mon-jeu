/**
 * Séances collectives (« travail tactique » de la semaine) : l'équipe répète un aspect du jeu.
 * Chaque thème a une maîtrise (0-100) qui monte quand on le travaille et s'érode sinon.
 * L'effet en match ne joue que si la tactique utilise vraiment ce qu'on a travaillé.
 */
import { clamp } from '../core/rng.js';

export const DRILLS = {
  none: { label: 'Aucune', icon: '—', desc: 'Pas de séance collective : toute la semaine sert à la progression individuelle.' },
  setpieces: { label: 'Coups de pied arrêtés', icon: '🎯', desc: 'Routines de corners et coups francs, placements défensifs. Effet : vos CPA (attaque et défense) gagnent en efficacité, quelle que soit la tactique.', applies: () => true },
  pressing: { label: 'Pressing', icon: '⚡', desc: 'Déclencheurs de pressing, courses coordonnées. Effet si votre pressing est haut : meilleur rendement et moins de fatigue.', applies: (t) => t.pressing === 'high' },
  possession: { label: 'Conservation', icon: '🔁', desc: 'Jeu de position, passes courtes, circuits. Effet si vous jouez court ou sur un tempo lent.', applies: (t) => t.passing === 'short' || t.tempo === 'low' },
  counter: { label: 'Transitions', icon: '🚀', desc: 'Contre-attaques rapides, appels dans la profondeur. Effet si la contre-attaque est activée ou le tempo rapide.', applies: (t) => t.counter === 'on' || t.tempo === 'high' },
  block: { label: 'Bloc défensif', icon: '🧱', desc: 'Coulissements, distances entre lignes, couverture. Effet si vous défendez bas ou avec une mentalité défensive. Moins de fautes.', applies: (t) => t.line === 'low' || t.mentality === 'defensive' || t.mentality === 'ultradef' },
};

export const drillMastery = (club, k) => Math.round(club.drills?.[k] ?? 0);

/** Semaine d'entraînement : le thème travaillé progresse, les autres s'érodent un peu. */
export function weeklyDrill(club, progression = 1) {
  const sel = club.training?.drill || 'none';
  club.drills = club.drills || {};
  for (const k of Object.keys(DRILLS)) {
    if (k === 'none') continue;
    const v = club.drills[k] ?? 0;
    club.drills[k] = k === sel ? clamp(v + 14 * progression * (1 - v / 130), 0, 100) : clamp(v - 2.5, 0, 100);
  }
}

/** Effets en match de la maîtrise des séances, selon la tactique jouée. */
export function drillEffects(club, tactics) {
  const d = club.drills || {}, t = tactics || club.tactics || {};
  const out = { perf: 1, fatigue: 1, cards: 1, cpa: 0, active: [] };
  out.cpa = 4 * (d.setpieces || 0) / 100;
  if (out.cpa >= 0.5) out.active.push('setpieces');
  for (const k of ['pressing', 'possession', 'counter', 'block']) {
    const m = (d[k] || 0) / 100;
    if (!m || !DRILLS[k].applies(t)) continue;
    out.perf *= 1 + 0.012 * m;
    if (k === 'pressing') out.fatigue *= 1 - 0.08 * m;
    if (k === 'block') out.cards *= 1 - 0.12 * m;
    if (m >= 0.15) out.active.push(k);
  }
  return out;
}
