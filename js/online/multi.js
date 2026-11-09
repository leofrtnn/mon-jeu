/**
 * CARRIÈRE EN LIGNE (2 à 8 managers, un club chacun, l'hôte calcule les journées — comme FM).
 *
 * Déroulement d'une journée :
 *  1. Chaque manager joue sur SA copie de l'état (tactique, mercato, décisions…).
 *  2. Il clique « Prêt » : le jeu envoie une « tranche » = ses données de manager, son club,
 *     ses joueurs, et les effets de ses actions sur le reste du monde (transferts, budgets
 *     des clubs IA, relations, staff), calculés par différence avec l'état de départ.
 *  3. Quand tout le monde est prêt, l'hôte fusionne les tranches dans l'état officiel,
 *     simule la journée (ou la fin de saison) et publie le nouvel état. Tout le monde repart
 *     de cet état.
 * Aucune dépendance au navigateur : testable en Node.
 */
import { newGame, startCareer, completeDay, endSeason } from '../game/season.js';
import { HUMAN_KEYS, switchTo, stashCurrent, humanIds } from '../game/humans.js';
import { clubById } from '../game/state.js';

const freshHuman = () => ({ userClubId: null, coach: null, board: { confidence: 60 }, life: null, objectives: undefined, seasonStats: undefined,
  sponsorDeals: undefined, preseason: undefined, pendingOffers: [], scout: {}, scoutQueue: [], missions: undefined, scoutReports: undefined,
  sacked: undefined, lastResult: null, history: [], messages: [], mediaV: undefined, mediaReady: undefined });

/**
 * Crée l'état d'une carrière en ligne.
 * players : [{ user_id, username, club_id }] (le premier est l'hôte).
 */
export function createOnlineCareer(realData, seed, players, gameId) {
  const state = newGame(seed, { real: realData });
  state.online = { gameId, humans: {}, clubOf: {}, names: {}, cur: players[0].user_id, host: players[0].user_id, version: 1 };
  players.forEach((p, i) => {
    if (i > 0) {
      stashCurrent(state);
      const f = freshHuman();
      for (const k of HUMAN_KEYS) state[k] = f[k];
      state.online.cur = p.user_id;
    }
    state.online.humans[p.user_id] = state.online.humans[p.user_id] || {};
    state.online.clubOf[p.club_id] = p.user_id;
    state.online.names[p.user_id] = p.username;
    startCareer(state, p.club_id);
  });
  stashCurrent(state);
  switchTo(state, players[0].user_id);
  return state;
}

/** Prépare l'état reçu pour le manager uid (sa perspective au premier niveau). */
export function adoptOnline(state, uid) {
  if (!state.online?.humans?.[uid]) throw new Error('Vous ne participez pas à cette partie.');
  switchTo(state, uid);
  return state;
}

const clubIdsOf = (club) => new Set([...(club?.playerIds || []), ...(club?.youthIds || [])]);
const clone = (o) => (o == null ? o : JSON.parse(JSON.stringify(o)));

/**
 * Tranche d'un manager : ce qu'il a changé depuis l'état de départ (base = même version).
 * state et base sont tous deux dans la perspective de ce manager.
 */
export function makeSlice(state, base) {
  const uid = state.online.cur;
  const myId = state.userClubId;
  const club = clubById(state, myId), baseClub = clubById(base, myId);
  const cur = clubIdsOf(club), before = clubIdsOf(baseClub);
  const moves = [];
  for (const pid of cur) if (!before.has(pid)) moves.push({ pid, from: base.players[pid]?.clubId ?? null, to: myId });
  for (const pid of before) if (!cur.has(pid)) moves.push({ pid, from: myId, to: state.players[pid] ? (state.players[pid].clubId ?? null) : 'gone' });
  const players = {};
  for (const pid of cur) players[pid] = state.players[pid];
  for (const m of moves) if (state.players[m.pid]) players[m.pid] = state.players[m.pid];
  const budgets = {};
  for (const c of state.clubs) {
    if (c.id === myId || state.online.clubOf[c.id]) continue;
    const b = base.clubs.find((x) => x.id === c.id);
    if (b && b.budget !== c.budget) budgets[c.id] = c.budget - b.budget;
  }
  const rel = {};
  for (const [k, v] of Object.entries(state.rel || {})) if ((base.rel || {})[k] !== v) rel[k] = v;
  const basePool = new Set((base.staffPool || []).map((m) => m.id)), curPool = new Set((state.staffPool || []).map((m) => m.id));
  const human = {};
  for (const k of HUMAN_KEYS) human[k] = state[k];
  return clone({
    uid, version: state.online.version, human, club, players, moves, budgets, rel,
    staffTaken: [...basePool].filter((id) => !curPool.has(id)),
    staffReturned: (state.staffPool || []).filter((m) => !basePool.has(m.id)),
  });
}

function detach(state, pid) {
  const p = state.players[pid];
  if (p?.clubId != null) {
    const c = clubById(state, p.clubId);
    if (c) {
      c.playerIds = c.playerIds.filter((x) => x !== pid);
      c.youthIds = (c.youthIds || []).filter((x) => x !== pid);
      if (c.lineup) c.lineup = c.lineup.map((x) => (x === pid ? null : x));
      if (c.bench) c.bench = c.bench.filter((x) => x !== pid);
    }
  }
  state.freeAgents = state.freeAgents.filter((x) => x !== pid);
}

/**
 * Fusionne la tranche d'un manager dans l'état officiel (chez l'hôte).
 * Retourne la liste des transferts annulés (conflit : joueur déjà parti ailleurs).
 */
export function applySlice(state, slice) {
  if (slice.version !== state.online.version) return { stale: true, conflicts: [] };
  const myId = slice.club.id;
  const conflicts = [];
  const budgets = { ...slice.budgets };
  // 1. Achats impossibles (le joueur n'est plus là où il était) : annulés et remboursés.
  for (const m of slice.moves.filter((x) => x.to === myId)) {
    const hp = state.players[m.pid];
    const where = hp ? (hp.clubId ?? null) : 'gone';
    const freeOk = m.from === null && state.freeAgents.includes(m.pid);
    if (where === m.from && (m.from !== null || freeOk)) continue;
    conflicts.push(m);
    slice.club.playerIds = slice.club.playerIds.filter((x) => x !== m.pid);
    slice.club.youthIds = (slice.club.youthIds || []).filter((x) => x !== m.pid);
    if (slice.club.lineup) slice.club.lineup = slice.club.lineup.map((x) => (x === m.pid ? null : x));
    if (slice.club.bench) slice.club.bench = slice.club.bench.filter((x) => x !== m.pid);
    if (m.from != null && budgets[m.from]) { slice.club.budget += budgets[m.from]; delete budgets[m.from]; }
    slice.human.messages?.unshift({ id: Date.now() + Math.random(), day: state.day, season: state.season, prio: 1, icon: '⚠',
      title: `Transfert annulé : ${slice.players[m.pid]?.name || 'joueur'}`, text: 'Un autre club l\'a recruté avant vous. Indemnité remboursée.', read: false });
    delete slice.players[m.pid];
  }
  const ok = slice.moves.filter((m) => !conflicts.includes(m));
  // 2. Le club du manager.
  const idx = state.clubs.findIndex((c) => c.id === myId);
  // 3. Mouvements de joueurs.
  for (const m of ok) detach(state, m.pid);
  state.clubs[idx] = slice.club;
  for (const m of ok) {
    if (m.to === myId) { state.players[m.pid] = slice.players[m.pid]; continue; }
    if (m.to === 'gone') { delete state.players[m.pid]; continue; }
    state.players[m.pid] = slice.players[m.pid] || state.players[m.pid];
    if (m.to === null) { if (!state.freeAgents.includes(m.pid)) state.freeAgents.push(m.pid); }
    else { const c = clubById(state, m.to); if (c && !c.playerIds.includes(m.pid)) c.playerIds.push(m.pid); }
  }
  for (const pid of clubIdsOf(slice.club)) if (slice.players[pid]) state.players[pid] = slice.players[pid];
  // 4. Effets sur le reste du monde.
  for (const [id, d] of Object.entries(budgets)) { const c = clubById(state, +id); if (c && !state.online.clubOf[c.id]) c.budget += d; }
  state.rel = state.rel || {};
  for (const [k, v] of Object.entries(slice.rel || {})) state.rel[k] = v;
  const taken = new Set(slice.staffTaken || []);
  state.staffPool = (state.staffPool || []).filter((m) => !taken.has(m.id)).concat(slice.staffReturned || []);
  // 5. Les données du manager.
  if (slice.uid === state.online.cur) { for (const k of HUMAN_KEYS) state[k] = slice.human[k]; }
  else state.online.humans[slice.uid] = slice.human;
  return { stale: false, conflicts };
}

/**
 * Chez l'hôte, quand tout le monde est prêt : fusion des tranches, journée (ou fin de
 * saison), nouvelle version. L'hôte doit être la perspective courante.
 */
export function hostAdvance(state, slices) {
  const conflicts = [];
  for (const s of slices) if (s && s.uid !== state.online.cur) conflicts.push(...applySlice(state, s).conflicts);
  const report = state.seasonOver ? { endSeason: endSeason(state) } : completeDay(state);
  state.online.version++;
  state.online.lastAdvance = new Date().toISOString();
  return { report, conflicts };
}

export const managers = (state) => humanIds(state).map((uid) => ({ uid, name: state.online.names[uid], clubId: state.online.humans[uid]?.userClubId ?? (uid === state.online.cur ? state.userClubId : null) }));
