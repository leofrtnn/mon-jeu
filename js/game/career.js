/**
 * CARRIÈRE LONGUE : réputation du coach, offres d'emploi, staff,
 * installations (centre d'entraînement, stade) et plan d'entraînement.
 */
import { clamp } from '../core/rng.js';
import { userClub, clubById, pushMessage } from './state.js';
import { money } from './economy.js';
import { logFinance } from './transfers.js';
import { squadStrength } from '../engine/ratings.js';
import { clubPlayers } from './state.js';

/* ---------------- Initialisation ---------------- */

/** Champs "carrière" d'un club (rétrocompatibles). */
export function initClubExtras(club) {
  club.staff = club.staff || { assistant: 1, scout: 1, fitness: 1 };
  club.facilities = club.facilities || { training: clamp(Math.round(club.rep / 25), 1, 5), works: null };
  club.training = club.training || { focus: 'balanced', intensity: 'mid' };
  club.roles = club.roles || [];
  club.setPieces = club.setPieces || {};
  club.youthIds = club.youthIds || [];
  return club;
}

export function newCoach(club) {
  return { rep: clamp(Math.round(25 + club.rep * 0.25), 20, 60), trophies: [], w: 0, d: 0, l: 0, clubs: [club.name], seasons: 0 };
}

/** Variation de réputation du coach (bornée). */
export function coachRep(state, delta, reason) {
  const c = state.coach;
  c.rep = clamp(Math.round((c.rep + delta) * 10) / 10, 1, 100);
  if (reason && Math.abs(delta) >= 3) pushMessage(state, { prio: 2, icon: delta > 0 ? '📈' : '📉', title: `Réputation ${delta > 0 ? '+' : ''}${Math.round(delta)}`, text: reason });
}

/** Après chaque match de l'utilisateur. */
export function coachAfterMatch(state, myGoals, theirGoals, oppClub) {
  const c = state.coach;
  const uc = userClub(state);
  const diff = myGoals - theirGoals;
  if (diff > 0) c.w++; else if (diff < 0) c.l++; else c.d++;
  // Battre plus fort que soi rapporte plus.
  const gapRep = ((oppClub?.rep ?? uc.rep) - uc.rep) / 20;
  const delta = diff > 0 ? 0.25 + Math.max(0, gapRep) * 0.4 : diff < 0 ? -0.2 + Math.min(0, gapRep) * 0.2 : 0.05 * gapRep;
  coachRep(state, delta);
}

/* ---------------- Staff ---------------- */

export const STAFF = {
  assistant: { label: 'Entraîneur adjoint', icon: '📋', desc: 'Accélère la progression et conseille à la mi-temps.' },
  scout: { label: 'Recruteur', icon: '🔭', desc: 'Révèle les vrais attributs et le potentiel des joueurs.' },
  fitness: { label: 'Préparateur physique', icon: '💪', desc: 'Meilleure récupération, moins de blessures, retours plus rapides.' },
};
export const staffHireCost = (lvl) => 250000 * lvl * lvl;
export const staffWage = (lvl) => 1500 * lvl * lvl;
export const staffWages = (club) => Object.values(club.staff || {}).reduce((a, l) => a + staffWage(l), 0);

export function upgradeStaff(state, role) {
  const club = userClub(state);
  const lvl = club.staff[role];
  if (lvl >= 5) return { ok: false, msg: 'Déjà au niveau maximum.' };
  const cost = staffHireCost(lvl + 1);
  if (club.budget < cost) return { ok: false, msg: `Budget insuffisant (${money(cost)}).` };
  club.budget -= cost;
  club.staff[role] = lvl + 1;
  logFinance(state, -cost, `Recrutement staff (${STAFF[role].label})`);
  return { ok: true, msg: `${STAFF[role].label} niveau ${lvl + 1} recruté !` };
}

/** Effets du staff utilisés par la saison et le moteur. */
export function staffEffects(club) {
  const s = club?.staff || { assistant: 1, scout: 1, fitness: 1 };
  return {
    progression: 1 + 0.08 * s.assistant,
    recovery: 3 * s.fitness,
    injuryMod: 1 - 0.07 * s.fitness,
    injuryDays: 1 - 0.06 * s.fitness,
    scoutBase: 20 + 12 * s.scout,
    scoutGain: 25 + 5 * s.scout,
  };
}

/* ---------------- Installations ---------------- */

export const trainingUpgradeCost = (lvl) => 2_000_000 * lvl;
export function upgradeTraining(state) {
  const club = userClub(state);
  const lvl = club.facilities.training;
  if (lvl >= 5) return { ok: false, msg: 'Centre d\'entraînement au maximum.' };
  const cost = trainingUpgradeCost(lvl);
  if (club.budget < cost) return { ok: false, msg: `Budget insuffisant (${money(cost)}).` };
  club.budget -= cost;
  club.facilities.training++;
  logFinance(state, -cost, 'Centre d\'entraînement');
  return { ok: true, msg: `Centre d'entraînement niveau ${club.facilities.training} !` };
}

export const STADIUM_OPTIONS = [{ seats: 2000, days: 5 }, { seats: 5000, days: 9 }, { seats: 10000, days: 15 }];
export const stadiumCost = (seats) => seats * 1100;
export function expandStadium(state, seats) {
  const club = userClub(state);
  if (club.facilities.works) return { ok: false, msg: 'Des travaux sont déjà en cours.' };
  const opt = STADIUM_OPTIONS.find((o) => o.seats === seats);
  const cost = stadiumCost(seats);
  if (club.budget < cost) return { ok: false, msg: `Budget insuffisant (${money(cost)}).` };
  club.budget -= cost;
  club.facilities.works = { seats, daysLeft: opt.days };
  logFinance(state, -cost, `Agrandissement du stade (+${seats} places)`);
  return { ok: true, msg: `Travaux lancés : +${seats.toLocaleString('fr-FR')} places dans ${opt.days} journées.` };
}

/** Avancement quotidien des travaux. */
export function dailyFacilities(state) {
  const club = userClub(state);
  const w = club.facilities?.works;
  if (!w) return;
  w.daysLeft--;
  if (w.daysLeft <= 0) {
    club.stadium += w.seats;
    club.facilities.works = null;
    pushMessage(state, { prio: 2, icon: '🏟', title: 'Stade agrandi !', text: `Nouvelle capacité : ${club.stadium.toLocaleString('fr-FR')} places.` });
  }
}

/* ---------------- Plan d'entraînement ---------------- */

export const TRAINING_FOCUS = {
  balanced: { label: 'Équilibré', attrs: null, desc: 'Progression sur tous les plans.' },
  physical: { label: 'Physique', attrs: ['vit', 'phy'], desc: 'Vitesse et physique. Fatigue un peu plus.' },
  technical: { label: 'Technique', attrs: ['tir', 'pas', 'dri'], desc: 'Tir, passe et dribble.' },
  tactical: { label: 'Tactique', attrs: ['def', 'vis', 'sf'], desc: 'Placement, vision, sang-froid. Forme +.' },
  rest: { label: 'Récupération', attrs: null, desc: 'Peu de progression, récupération et moral +.' },
};
export const INTENSITY = { low: 'Légère', mid: 'Normale', high: 'Intense' };

/** Paramètres d'entraînement d'un club (l'IA s'entraîne de façon équilibrée). */
export function trainingParams(club, isUser) {
  const fac = club.facilities?.training ?? 3;
  const base = { focus: 'balanced', intensity: 'mid', mult: 0.85 + 0.1 * fac, fatigue: 0, injury: 0, morale: 0, form: 0 };
  if (!isUser) return base;
  const t = club.training || { focus: 'balanced', intensity: 'mid' };
  const imult = { low: 0.6, mid: 1, high: 1.45 }[t.intensity];
  const eff = staffEffects(club);
  return {
    focus: t.focus, intensity: t.intensity,
    mult: base.mult * imult * eff.progression * (t.focus === 'rest' ? 0.3 : 1),
    fatigue: ({ low: -6, mid: 0, high: 7 }[t.intensity]) + (t.focus === 'physical' ? 3 : 0) + (t.focus === 'rest' ? -10 : 0),
    injury: t.intensity === 'high' ? 0.004 : 0,
    morale: t.focus === 'rest' ? 1 : t.intensity === 'high' ? -0.5 : 0,
    form: t.focus === 'tactical' ? 1 : 0,
  };
}

/* ---------------- Offres d'emploi ---------------- */

/** Clubs intéressés par le coach selon sa réputation. */
export function jobCandidates(state, sacked = false) {
  const uc = userClub(state);
  const rep = state.coach.rep;
  return state.clubs
    .filter((c) => c.id !== uc.id && (sacked ? c.rep <= Math.max(45, rep + 15) : c.rep > uc.rep + 2 && c.rep <= rep + 32))
    .sort((a, b) => b.rep - a.rep)
    .slice(0, 3);
}

/** Vérification périodique : un club plus prestigieux fait une offre ? */
export function checkJobOffers(state, rng) {
  const cands = jobCandidates(state);
  if (!cands.length) return;
  if (!rng.chance(clamp((state.coach.rep - 35) / 80, 0.05, 0.7))) return;
  const c = rng.pick(cands);
  pushMessage(state, { prio: 1, icon: '💼', title: `${c.name} veut vous recruter`, text: `Réputation du club : ${c.rep}. Touchez pour répondre.`, action: { type: 'job', clubId: c.id } });
}

export { clubById, squadStrength, clubPlayers };
