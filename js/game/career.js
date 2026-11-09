/**
 * CARRIÈRE LONGUE : réputation du coach, offres d'emploi, staff,
 * installations (centre d'entraînement, stade) et plan d'entraînement.
 */
import { COUNTRIES } from '../data/world.js';
import { clamp } from '../core/rng.js';
import { userClub, clubById, pushMessage, gameRng } from './state.js';
import { randomName } from '../data/names.js';
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

/* ---------------- Staff (membres nommés) ---------------- */

export const STAFF_ROLES = {
  assistant: { label: 'Entraîneur adjoint', icon: '📋', max: 1, desc: 'Progression des joueurs, conseils à la mi-temps.' },
  gk: { label: 'Entraîneur des gardiens', icon: '🧤', max: 1, desc: 'Progression des gardiens.' },
  fitness: { label: 'Préparateur physique', icon: '💪', max: 1, desc: 'Récupération, moins de blessures.' },
  physio: { label: 'Médecin / kiné', icon: '✚', max: 1, desc: 'Retours de blessure plus rapides.' },
  scout: { label: 'Recruteur', icon: '🔭', max: 3, desc: 'Connaissance des joueurs, rapports par journée.' },
  youth: { label: 'Responsable formation', icon: '🌱', max: 1, desc: 'Qualité des jeunes du centre.' },
  analyst: { label: 'Analyste vidéo', icon: '🎥', max: 1, desc: "Rapport sur l'adversaire, léger bonus en match." },
};
// Compatibilité : ancien nom utilisé par certains écrans.
export const STAFF = STAFF_ROLES;
export const staffWageFor = (r) => Math.round(600 * Math.pow(1.17, r) / 100) * 100;

let staffSeq = 0;
function makeStaff(rng, role, rating) {
  const { first, last, nat } = randomName(rng, rng.pick(Object.keys(COUNTRIES)));
  const r = clamp(Math.round(rating), 1, 20);
  return { id: `S${Date.now().toString(36)}${(staffSeq++).toString(36)}${rng.int(0, 999)}`, role, first, last, name: `${first[0]}. ${last}`, nat,
    age: rng.int(28, 64), rating: r, wage: staffWageFor(r), contract: rng.int(1, 3) };
}

/** Staff du club de l'utilisateur et marché du staff (rétrocompatible avec les anciens niveaux). */
export function ensureStaff(state) {
  const club = userClub(state);
  if (!club) return;
  const rng = gameRng(state);
  if (!club.staffMembers) {
    const old = club.staff || {};
    const base = clamp(club.rep / 7, 4, 13);
    club.staffMembers = Object.keys(STAFF_ROLES).map((role) => makeStaff(rng, role, old[role] ? old[role] * 3 + 3 : base + rng.normal(-1, 2)));
  }
  if (!state.staffPool || state.staffPool.length < 12) refreshStaffPool(state, rng);
}

export function refreshStaffPool(state, rng = gameRng(state)) {
  const pool = (state.staffPool || []).filter(() => rng.chance(0.5));
  while (pool.length < 28) {
    const role = rng.pick(Object.keys(STAFF_ROLES));
    pool.push(makeStaff(rng, role, clamp(rng.normal(10, 3.5), 2, 20)));
  }
  state.staffPool = pool;
}

/** Le staff change avec le club : nouveau club, nouveau staff (selon sa réputation). */
export function resetClubStaff(state, club) {
  const rng = gameRng(state);
  const base = clamp(club.rep / 7, 4, 13);
  club.staffMembers = Object.keys(STAFF_ROLES).map((role) => makeStaff(rng, role, base + rng.normal(0, 2)));
}

export const staffWages = (club) => (club.staffMembers || []).reduce((a, m) => a + m.wage, 0);
export const bestStaff = (club, role) => Math.max(0, ...(club?.staffMembers || []).filter((m) => m.role === role).map((m) => m.rating));

export function hireStaff(state, id) {
  const club = userClub(state);
  const m = state.staffPool.find((x) => x.id === id);
  if (!m) return { ok: false, msg: 'Ce membre du staff n\'est plus disponible.' };
  const count = club.staffMembers.filter((x) => x.role === m.role).length;
  if (count >= STAFF_ROLES[m.role].max) return { ok: false, msg: `Poste complet (${STAFF_ROLES[m.role].max} max) : libérez d'abord une place.` };
  const fee = m.wage * 4;
  if (club.budget < fee) return { ok: false, msg: `Budget insuffisant (${money(fee)}).` };
  club.budget -= fee;
  club.staffMembers.push({ ...m, contract: Math.max(2, m.contract) });
  state.staffPool = state.staffPool.filter((x) => x.id !== id);
  logFinance(state, -fee, `Prime d'arrivée staff : ${m.name}`);
  return { ok: true, msg: `${m.first} ${m.last} rejoint le staff (${STAFF_ROLES[m.role].label}).` };
}

export function fireStaff(state, id) {
  const club = userClub(state);
  const m = club.staffMembers.find((x) => x.id === id);
  if (!m) return { ok: false, msg: 'Introuvable.' };
  const cost = Math.round(m.wage * 8 * Math.max(1, m.contract));
  if (club.budget < cost) return { ok: false, msg: `Indemnité de départ trop élevée (${money(cost)}).` };
  club.budget -= cost;
  club.staffMembers = club.staffMembers.filter((x) => x.id !== id);
  state.staffPool.push({ ...m, wage: staffWageFor(m.rating) });
  logFinance(state, -cost, `Indemnité staff : ${m.name}`);
  return { ok: true, msg: `${m.first} ${m.last} quitte le club.` };
}

/** Effets du staff utilisés par la saison et le moteur. */
export function staffEffects(club) {
  const ai = !club?.staffMembers;
  const def = clamp((club?.rep ?? 60) / 6, 4, 16);
  const r = (role) => (ai ? def : bestStaff(club, role));
  const scouts = ai ? 1 : club.staffMembers.filter((m) => m.role === 'scout').length;
  return {
    progression: 1 + (Math.max(4, r('assistant')) - 4) * 0.02,
    recovery: r('fitness') * 0.3,
    injuryMod: 1 - r('fitness') * 0.018,
    injuryDays: 1 - r('physio') * 0.025,
    scoutBase: 10 + r('scout') * 2.5,
    scoutGain: 15 + r('scout') * 1.8,
    scoutReports: Math.max(1, scouts),
    youthPot: (r('youth') - 8) * 0.5,
    gkMult: 0.85 + r('gk') * 0.02,
    analyst: r('analyst'),
    perf: 1 + (r('analyst') - 8) * 0.0006,
    assistant: r('assistant'),
  };
}

/* ---------------- Installations ---------------- */

export const trainingUpgradeCost = (lvl) => 6_000_000 * lvl;
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
export const stadiumCost = (seats) => seats * 4500; // ~4 500 € la place (tribune ajoutée)
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
    .filter((c) => c.id !== uc.id && (sacked ? c.rep <= Math.max(45, rep + 15) || c.crisis : c.rep > uc.rep + 2 && c.rep <= rep + 32))
    .sort((a, b) => (sacked ? (b.crisis ? 1 : 0) - (a.crisis ? 1 : 0) : 0) || b.rep - a.rep)
    .slice(0, sacked ? 5 : 3);
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

/* ---------------- Contrats du staff négociés ---------------- */

/**
 * Exigences d'un membre du staff (embauche ou prolongation).
 * Un bon technicien demande plus à un petit club ; les plus âgés veulent de la durée.
 */
export function staffDemand(state, m, renew = false) {
  const club = userClub(state);
  const base = staffWageFor(m.rating);
  const gap = m.rating - club.rep / 6;                       // > 0 : il se sent au-dessus du club
  const factor = clamp(1 + gap * 0.04, 0.85, 1.45) * (renew ? (m.rating >= 12 ? 1.08 : 1.02) : 1);
  const years = m.age >= 55 ? 1 : m.age >= 45 ? 2 : 3;
  const refuses = !renew && gap > 7;
  return { wage: Math.round(base * factor / 100) * 100, years, refuses };
}

/** Évalue une offre { wage, years }. Retourne { kind: 'accept'|'counter'|'reject'|'end', msg }. */
export function staffOffer(state, id, offer, renew = false) {
  const club = userClub(state);
  const m = renew ? club.staffMembers.find((x) => x.id === id) : state.staffPool.find((x) => x.id === id);
  if (!m) return { kind: 'end', msg: 'Plus disponible.' };
  if (m.blockedUntil != null && m.blockedSeason === state.season && state.day < m.blockedUntil) return { kind: 'end', msg: `${m.first} ${m.last} ne veut plus discuter pour le moment.` };
  const d = staffDemand(state, m, renew);
  if (d.refuses) return { kind: 'end', msg: `${m.first} ${m.last} ne se voit pas dans un club de ce niveau.` };
  // La durée compte : chaque année d'écart avec son souhait change le salaire attendu de 4 %.
  const required = Math.round(d.wage * (1 + (d.years - offer.years) * 0.04));
  m.tries = (m.tries ?? 3);
  if (offer.wage >= required) {
    m.tries = 3;
    if (renew) {
      m.wage = offer.wage; m.contract = offer.years;
      return { kind: 'accept', ok: true, msg: `${m.first} ${m.last} prolonge de ${offer.years} an(s) à ${money(offer.wage)}/sem.` };
    }
    const count = club.staffMembers.filter((x) => x.role === m.role).length;
    if (count >= STAFF_ROLES[m.role].max) return { kind: 'end', msg: `Poste complet (${STAFF_ROLES[m.role].max} max) : libérez d'abord une place.` };
    const fee = offer.wage * 4;
    if (club.budget < fee) return { kind: 'end', msg: `Budget insuffisant pour la prime d'arrivée (${money(fee)}).` };
    club.budget -= fee;
    club.staffMembers.push({ ...m, wage: offer.wage, contract: offer.years, tries: 3 });
    state.staffPool = state.staffPool.filter((x) => x.id !== id);
    logFinance(state, -fee, `Prime d'arrivée staff : ${m.name}`);
    return { kind: 'accept', ok: true, msg: `${m.first} ${m.last} signe ${offer.years} an(s) à ${money(offer.wage)}/sem (${STAFF_ROLES[m.role].label}).` };
  }
  m.tries--;
  if (m.tries <= 0) {
    m.blockedUntil = state.day + 8; m.blockedSeason = state.season; m.tries = 3;
    return { kind: 'end', msg: `${m.first} ${m.last} met fin aux discussions${renew ? ' : il partira en fin de contrat si rien ne change' : ''}.` };
  }
  if (offer.wage >= required * 0.85) return { kind: 'counter', counter: required, msg: `Il demande ${money(required)}/sem pour ${offer.years} an(s). (${m.tries} essai(s) restant(s))` };
  return { kind: 'reject', msg: `Offre jugée insultante. (${m.tries} essai(s) restant(s))` };
}
