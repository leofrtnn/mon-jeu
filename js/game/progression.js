/**
 * Progression et déclin des joueurs : entraînement hebdomadaire,
 * évolution de fin de saison (âge, potentiel, temps de jeu), retraites.
 */
import { POSITION_WEIGHTS, ATTRS } from '../data/constants.js';
import { overall } from '../engine/ratings.js';
import { playerValue, playerWage } from './economy.js';
import { clamp } from '../core/rng.js';

const FOCUS_ATTRS = { physical: ['vit', 'phy'], technical: ['tir', 'pas', 'dri'], tactical: ['def', 'vis', 'sf'] };

/** Modifie les attributs d'un joueur de `delta` points (surtout ses attributs clés). */
export function shiftAttributes(p, delta, rng) {
  const w = POSITION_WEIGHTS[p.pos];
  for (const k of ATTRS) {
    if (k === 'arr' && p.pos !== 'GB') continue;
    const key = w[k] || 0;
    // Les attributs clés évoluent plus ; la vitesse décline plus vite avec l'âge.
    let d = delta * (key ? 0.6 + key * 1.2 : 0.35);
    if (delta < 0 && (k === 'vit' || k === 'phy')) d *= 1.5;
    if (delta < 0 && (k === 'vis' || k === 'pas' || k === 'sf')) d *= 0.4;
    d += rng.normal(0, Math.abs(delta) * 0.3);
    p.attrs[k] = clamp(Math.round(p.attrs[k] + d), 1, 99);
  }
}

/**
 * Entraînement de la semaine : les jeunes progressent un peu, surtout s'ils jouent.
 * playedMinutes : minutes jouées cette journée.
 */
export function weeklyTraining(p, rng, playedMinutes = 0, tp = null) {
  const o = overall(p);
  const gap = p.pot - o;
  const mult = (tp?.mult ?? 1) * (p.age <= 21 ? tp?.youthMult ?? 1 : 1) * (p.pos === 'GB' ? tp?.gkMult ?? 1 : 1);
  const focus = tp?.focus && FOCUS_ATTRS[tp.focus];
  // Entraînement individuel (clubs des managers) : un attribut ou un nouveau poste.
  const ind = tp?.individual ? p.tFocus : null;
  let ev = null;
  if (ind && ind.startsWith('pos:')) {
    const pos = ind.slice(4);
    if (pos !== p.pos && !(p.pos2 || []).includes(pos)) {
      p.posXp = p.posXp || {};
      p.posXp[pos] = (p.posXp[pos] || 0) + (1 + (playedMinutes > 0 ? 0.3 : 0)) * Math.min(1.6, mult) * (p.age <= 24 ? 1.3 : p.age >= 30 ? 0.7 : 1);
      if (p.posXp[pos] >= 24) { (p.pos2 ||= []).push(pos); delete p.posXp[pos]; p.tFocus = null; ev = { learned: pos }; }
    } else p.tFocus = null;
  }
  const indAttr = ind && !ind.startsWith('pos:') ? ind : null;
  if (p.age <= 26 && gap > 0) {
    const chance = (0.015 + gap * 0.003 + (playedMinutes > 45 ? 0.02 : 0)) * mult;
    if (rng.chance(chance)) {
      const w = POSITION_WEIGHTS[p.pos];
      let keys = Object.keys(w);
      // Le thème d'entraînement oriente la progression ; l'entraînement individuel encore plus.
      if (indAttr && rng.chance(0.6)) keys = [indAttr];
      else if (focus && rng.chance(0.65)) keys = focus.filter((k) => k !== 'arr' || p.pos === 'GB');
      const k = keys[rng.weightedIndex(keys.map((x) => w[x] || 0.15))];
      if (p.attrs[k] < 99) { p.attrs[k] = clamp(p.attrs[k] + 1, 1, 99); ev = ev || { attr: k }; }
    }
  } else if (indAttr && p.age <= 31 && rng.chance(0.012 * mult)) {
    // Un joueur confirmé peut encore travailler un point précis (lentement).
    p.attrs[indAttr] = clamp(p.attrs[indAttr] + 1, 1, 99); ev = { attr: indAttr };
  } else if (p.age >= 32 && rng.chance(indAttr === 'vit' || indAttr === 'phy' ? 0.015 : 0.03)) {
    const k = rng.pick(['vit', 'phy']);
    p.attrs[k] = clamp(p.attrs[k] - 1, 1, 99); ev = { attr: k, down: true };
  }
  return ev;
}

/**
 * Évolution de fin de saison. Retourne { before, after } pour le bilan.
 * apps : matchs joués dans la saison.
 */
export function seasonDevelopment(p, rng, mult = 1) {
  const before = overall(p);
  const apps = p.stats.apps;
  const avgRating = apps ? p.stats.ratingSum / apps : 6;
  const play = clamp(apps / 25, 0, 1.2); // temps de jeu
  let delta;
  if (p.age <= 20) delta = (p.pot - before) * (0.12 + 0.14 * play) + rng.normal(0.5, 1.2);
  else if (p.age <= 24) delta = (p.pot - before) * (0.08 + 0.12 * play) + rng.normal(0.3, 1);
  else if (p.age <= 28) delta = (p.pot - before) * 0.15 * play + rng.normal(0, 0.8);
  else if (p.age <= 30) delta = rng.normal(-0.6, 0.8);
  else if (p.age <= 32) delta = rng.normal(-1.6, 1);
  else delta = rng.normal(-2.8, 1.2);
  // Bonne saison = petit bonus.
  delta += (avgRating - 6.8) * 0.8 * play;
  if (delta > 0) delta *= 0.85 + 0.15 * mult; // installations, staff, intensité
  if (delta > 0 && before >= p.pot) delta *= 0.2;
  shiftAttributes(p, delta, rng);
  p.age++;
  const after = overall(p);
  // Le potentiel se précise : un joueur qui a stagné voit son plafond baisser.
  if (p.age > 24) p.pot = Math.max(after, Math.min(p.pot, after + 3));
  p.pot = Math.max(p.pot, after);
  p.value = playerValue(p);
  return { before, after };
}

/** Le joueur prend-il sa retraite ? */
export function shouldRetire(p, rng) {
  if (p.age >= 38) return true;
  if (p.age >= 35) return rng.chance(0.45 + (p.age - 35) * 0.15);
  if (p.age >= 33 && overall(p) < 55) return rng.chance(0.3);
  return false;
}

/** Remise à zéro des stats saisonnières (on garde un historique de carrière). */
export function resetSeasonStats(p, season = null, club = null, youth = false) {
  p.career = p.career || { apps: 0, goals: 0, assists: 0 };
  // Ligne de carrière de la saison écoulée (fiche du joueur).
  if (season != null && club) {
    const st = p.stats;
    (p.hist ||= []).push({ y: season, club: club.name, cid: club.id, youth: youth || undefined, apps: st.apps, goals: st.goals, assists: st.assists,
      avg: st.apps ? Math.round((st.ratingSum / st.apps) * 100) / 100 : null, min: st.minutes, y1: st.yellows, r: st.reds, motm: st.motm, cs: st.cs || 0, loan: p.onLoanFrom ? 1 : undefined });
    if (p.hist.length > 25) p.hist.shift();
  }
  p.career.apps += p.stats.apps; p.career.goals += p.stats.goals; p.career.assists += p.stats.assists;
  p.stats = { apps: 0, goals: 0, lgoals: 0, assists: 0, ratingSum: 0, yellows: 0, reds: 0, minutes: 0, motm: 0, starts: 0, shots: 0, kp: 0, passes: 0, passOk: 0, tackles: 0, saves: 0, cs: 0, conceded: 0 };
  p.yellowAcc = 0;
}

/** Recalcule valeur et (si besoin) salaire de référence. */
export function refreshEconomics(p) {
  p.value = playerValue(p);
  p.askWage = playerWage(p);
}
