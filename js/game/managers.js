/**
 * MARCHÉ DES ENTRAÎNEURS
 * - Chaque club IA a un entraîneur nommé (compétences, philosophie, formation préférée).
 * - Les présidents jugent leurs coachs après chaque journée : limogeages en cours de saison.
 * - Postes vacants : l'utilisateur peut postuler (entretien) avant que le club n'embauche.
 * - Pool d'entraîneurs sans club, carrousel de fin de saison, fil d'actualité.
 */
import { COUNTRIES } from '../data/world.js';
import { clamp, createRng, hashSeed } from '../core/rng.js';
import { randomName } from '../data/names.js';
import { FORMATION_NAMES } from '../data/constants.js';
import { squadStrength } from '../engine/ratings.js';
import { SKILL_KEYS, PHILOSOPHIES } from './coach.js';
import { userClub, clubById, clubPlayers, pushMessage, gameRng } from './state.js';

const PHILO_KEYS = Object.keys(PHILOSOPHIES);

/** Ajoute une actualité (transferts, entraîneurs…). */
export function news(state, type, text, extra = {}) {
  state.news = state.news || [];
  state.news.unshift({ season: state.season, day: state.day, type, text, ...extra });
  if (state.news.length > 200) state.news.length = 200;
}

function makeManager(rng, state, rep, country) {
  const { first, last, nat } = randomName(rng, country);
  const lvl = clamp(rep / 5.5, 4, 18);
  const skills = Object.fromEntries(SKILL_KEYS.map((k) => [k, clamp(Math.round(lvl + rng.normal(0, 2.5)), 3, 20)]));
  const id = 'M' + (state.nextManagerId = (state.nextManagerId || 0) + 1);
  return {
    id, first, last, name: `${first[0]}. ${last}`, nat, age: rng.int(36, 66), rep: clamp(Math.round(rep), 15, 95),
    skills, philosophy: rng.pick(PHILO_KEYS), formation: rng.pick(FORMATION_NAMES), clubId: null,
    contract: rng.int(1, 3), history: [], conf: 60, w: 0, d: 0, l: 0,
  };
}

/** Crée les entraîneurs du monde (nouvelle partie ou ancienne sauvegarde). */
export function ensureManagers(state) {
  if (state.managers && Object.keys(state.managers).length) return;
  const rng = createRng(hashSeed(`${state.seed}-managers`));
  state.managers = {};
  for (const c of state.clubs) {
    const m = makeManager(rng, state, c.rep + rng.normal(-4, 5), c.country);
    m.clubId = c.id;
    m.history.push({ club: c.name, from: state.season });
    state.managers[m.id] = m;
    c.managerId = m.id;
  }
  for (let i = 0; i < 24; i++) {
    const m = makeManager(rng, state, rng.range(35, 80), rng.pick(Object.keys(COUNTRIES)));
    state.managers[m.id] = m;
  }
}

/** Entraîneur d'un club (null pour le club de l'utilisateur). */
export const managerOf = (state, club) => (club.id === state.userClubId ? null : state.managers?.[club.managerId] || null);
export const freeManagers = (state) => Object.values(state.managers || {}).filter((m) => !m.clubId);

/** Préférences tactiques de l'entraîneur pour l'IA. */
export function managerStyle(state, club) {
  const m = managerOf(state, club);
  if (!m) return null;
  return { formation: m.formation, tactics: PHILOSOPHIES[m.philosophy]?.tactics || {}, perf: 1 + (m.skills.tactics - 10) * 0.0016 };
}

/** Rang attendu (force de l'effectif) dans la division. */
function expectedRank(state, club) {
  const list = state.clubs.filter((c) => c.div === club.div).map((c) => ({ id: c.id, s: squadStrength(clubPlayers(state, c)) })).sort((a, b) => b.s - a.s);
  return list.findIndex((x) => x.id === club.id) + 1;
}

/**
 * Après une journée de championnat : confiance des présidents, limogeages,
 * embauches sur les postes vacants.
 */
export function managersAfterRound(state, round, tablePos) {
  ensureManagers(state);
  const rng = gameRng(state);
  // 1) Postes vacants : le club embauche après 2 journées si personne ne l'a pris.
  for (const c of state.clubs) {
    if (c.id === state.userClubId || !c.vacantSince) continue;
    if (state.day - c.vacantSince >= 2) hireForClub(state, c, rng);
  }
  if (round < 7) return;
  // 2) Confiance des présidents selon le classement attendu.
  const cache = {};
  for (const c of state.clubs) {
    if (c.id === state.userClubId || c.vacantSince) continue;
    const m = managerOf(state, c);
    if (!m) continue;
    cache[c.div] = cache[c.div] || {};
    const exp = cache[c.div][c.id] ?? (cache[c.div][c.id] = expectedRank(state, c));
    const pos = tablePos(c.id);
    m.conf = clamp(m.conf + clamp((exp - pos) * 0.3, -2.5, 2.5) - 0.15 + rng.normal(0, 0.8), 0, 100);
    if (m.conf < 20 && pos > exp + 3 && rng.chance(0.25)) sack(state, c, m, `après une série décevante (${pos}e)`);
  }
}

export function sack(state, club, m, why) {
  m.clubId = null;
  m.rep = clamp(m.rep - 3, 15, 95);
  m.history[m.history.length - 1].to = state.season;
  club.managerId = null;
  club.vacantSince = state.day;
  news(state, 'manager', `${m.first} ${m.last} limogé par ${club.name} ${why}.`, { clubId: club.id });
  const uc = userClub(state);
  if (state.coach && club.rep >= uc.rep - 10 && club.rep <= state.coach.rep + 30) {
    pushMessage(state, { prio: 2, icon: '🪑', title: `Poste vacant : ${club.name}`, text: 'Vous pouvez postuler (Calendrier → Entraîneurs).', action: { type: 'vacancy', clubId: club.id } });
  }
}

function hireForClub(state, club, rng) {
  const pool = freeManagers(state).filter((m) => m.rep <= club.rep + 12).sort((a, b) => b.rep - a.rep);
  let m = pool[Math.min(pool.length - 1, rng.int(0, 2))];
  if (!m) { m = makeManager(rng, state, club.rep - 5, club.country); state.managers[m.id] = m; }
  m.clubId = club.id; m.conf = 65; m.contract = rng.int(2, 3);
  m.history.push({ club: club.name, from: state.season });
  club.managerId = m.id;
  delete club.vacantSince;
  news(state, 'manager', `${m.first} ${m.last} nommé entraîneur de ${club.name}.`, { clubId: club.id });
}

/** Candidature de l'utilisateur à un poste vacant : entretien. */
export function applyForJob(state, clubId) {
  const club = clubById(state, clubId);
  if (!club?.vacantSince) return { ok: false, msg: 'Ce poste n\'est plus vacant.' };
  const rng = gameRng(state);
  const gap = state.coach.rep - club.rep;
  const p = clamp(0.5 + gap / 40 + ((state.board?.confidence ?? 50) - 50) / 400, 0.05, 0.92);
  if (!rng.chance(p)) {
    club.rejected = state.day;
    return { ok: false, msg: `${club.name} a retenu un autre profil après l'entretien.` };
  }
  return { ok: true, msg: `${club.name} vous propose le poste !` };
}

/** Fin de saison : bilan des entraîneurs, contrats, carrousel. */
export function managersEndSeason(state, tables) {
  ensureManagers(state);
  const rng = gameRng(state);
  for (const c of state.clubs) {
    if (c.id === state.userClubId) continue;
    if (c.vacantSince) { hireForClub(state, c, rng); continue; }
    const m = managerOf(state, c);
    if (!m) { c.vacantSince = state.day; hireForClub(state, c, rng); continue; }
    const pos = tables[c.div].findIndex((r) => r.id === c.id) + 1;
    const exp = expectedRank(state, c);
    m.rep = clamp(m.rep + (exp - pos) * 0.6 + (pos === 1 ? 6 : 0), 15, 95);
    m.age++;
    m.contract--;
    if (pos > exp + 5 && rng.chance(0.6)) { sack(state, c, m, 'au terme d\'une saison ratée'); hireForClub(state, c, rng); continue; }
    if (m.contract <= 0) {
      if (pos <= exp + 1 || rng.chance(0.5)) m.contract = rng.int(1, 3);
      else { sack(state, c, m, '(fin de contrat, non prolongé)'); hireForClub(state, c, rng); continue; }
    }
    // Un coach en vue peut être débauché par un club plus prestigieux.
    m.conf = 60;
  }
  // Retraites et renouvellement du pool.
  for (const m of freeManagers(state)) if (m.age > 68 || rng.chance(0.08)) delete state.managers[m.id];
  while (freeManagers(state).length < 20) {
    const m = makeManager(rng, state, rng.range(35, 75), rng.pick(Object.keys(COUNTRIES)));
    state.managers[m.id] = m;
  }
}

/** Quand l'utilisateur quitte un club : un entraîneur IA reprend le poste. */
export function onUserLeaves(state, club) {
  ensureManagers(state);
  club.vacantSince = state.day;
  hireForClub(state, club, gameRng(state));
}

/** Quand l'utilisateur arrive : l'ancien entraîneur IA part au chômage. */
export function onUserArrives(state, club) {
  ensureManagers(state);
  const m = state.managers[club.managerId];
  if (m && m.clubId === club.id) {
    m.clubId = null;
    news(state, 'manager', `${m.first} ${m.last} quitte ${club.name}.`, { clubId: club.id });
  }
  club.managerId = 'user';
  delete club.vacantSince;
}
