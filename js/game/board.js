/**
 * CONSEIL D'ADMINISTRATION (CA)
 * - Enveloppes séparées : budget transferts et masse salariale (rééquilibrables).
 * - Identité de club et objectifs multiples (classement, coupe, finances, jeunes, style).
 * - Confiance détaillée (résultats, finances, jeunes, style, mercato) et supporters.
 * - Demandes au CA (budget, salaires, installations, stade, formation).
 * - Limogeage possible en cours de saison.
 */
import { clamp } from '../core/rng.js';
import { userClub, clubPlayers, pushMessage, gameRng } from './state.js';
import { wageBill, money } from './economy.js';
import { trainingUpgradeCost, stadiumCost } from './career.js';
import { academyCost } from './transfers.js';

export const IDENTITIES = {
  attack: { label: 'Jeu offensif', desc: 'Marquer beaucoup de buts.' },
  youth: { label: 'Faire confiance aux jeunes', desc: 'Donner du temps de jeu aux moins de 21 ans.' },
  solid: { label: 'Solidité défensive', desc: 'Encaisser peu de buts.' },
  possession: { label: 'Jeu de possession', desc: 'Avoir le ballon.' },
};
export const SALE_SHARE = 0.6; // part des ventes reversée au budget transferts
export const WAGE_RATE = 40;   // 1 € de salaire hebdo ≈ 40 € de budget transferts

const W = { results: 0.5, finances: 0.15, youth: 0.1, style: 0.1, transfers: 0.15 };

export function ensureBoard(state) {
  const b = state.board = state.board || { confidence: 60 };
  b.parts = b.parts || { results: b.confidence ?? 60, finances: 70, youth: 60, style: 60, transfers: 60 };
  b.req = b.req || {};
  b.fans = b.fans ?? 60;
  if (b.transferBudget == null) setBoardSeason(state, false);
  state.seasonStats = state.seasonStats || { m: 0, gf: 0, ga: 0, poss: 0, u21: 0, mins: 0 };
  return b;
}

/** Début de saison (ou nouveau club) : enveloppes, identité, objectifs complémentaires. */
export function setBoardSeason(state, fresh = true) {
  const b = state.board = state.board || { confidence: 60 };
  const uc = userClub(state);
  const bill = wageBill(clubPlayers(state, uc));
  b.wageBudget = Math.round(bill * (1.04 + uc.rep / 1000) / 1000) * 1000;
  b.transferBudget = Math.max(0, Math.round(Math.max(0, uc.budget) * (0.35 + uc.rep / 400) / 50000) * 50000);
  const rng = gameRng(state);
  if (fresh || !b.identity) b.identity = uc.academy >= 4 && rng.chance(0.6) ? 'youth' : uc.rep >= 75 ? rng.pick(['attack', 'possession']) : uc.rep < 55 ? 'solid' : rng.pick(Object.keys(IDENTITIES));
  b.youthTarget = b.identity === 'youth' ? 15 : 5;
  if (fresh) { b.parts = { results: 60, finances: 70, youth: 60, style: 60, transfers: 60 }; b.req = {}; }
  state.seasonStats = { m: 0, gf: 0, ga: 0, poss: 0, u21: 0, mins: 0 };
  b.parts = b.parts || { results: 60, finances: 70, youth: 60, style: 60, transfers: 60 };
  b.req = b.req || {};
  b.fans = b.fans ?? 60;
}

/** Enregistre un match de l'utilisateur pour le style et les jeunes. */
export function recordUserMatch(state, sum, side, m) {
  const st = state.seasonStats || (state.seasonStats = { m: 0, gf: 0, ga: 0, poss: 0, u21: 0, mins: 0 });
  st.m++; st.gf += sum.score[side]; st.ga += sum.score[1 - side]; st.poss += sum.possession[side];
  for (const mp of [...m.teams[side].onPitch, ...m.teams[side].out]) {
    if (!mp || mp.minIn == null) continue;
    const mins = Math.max(0, (mp.minOut ?? 90) - mp.minIn);
    st.mins += mins;
    if (mp.p.age <= 21) st.u21 += mins;
  }
  const b = state.board;
  const diff = sum.score[side] - sum.score[1 - side];
  b.fans = clamp(b.fans + (diff > 0 ? 2.5 : diff < 0 ? -3 : 0) + (sum.score[side] >= 3 ? 1 : 0), 0, 100);
}

export const youthShare = (state) => {
  const st = state.seasonStats || {};
  return st.mins ? Math.round((st.u21 / st.mins) * 100) : 0;
};

/** Mise à jour quotidienne de la confiance (pos = classement, target = objectif). */
export function updateBoardParts(state, { pos, target, matchDiff, leagueRound }) {
  const b = ensureBoard(state);
  const uc = userClub(state);
  const P = b.parts;
  if (matchDiff != null) P.results += matchDiff > 0 ? 3 : matchDiff < 0 ? -3.5 : 0;
  if (leagueRound != null && leagueRound >= 5) P.results += pos <= target ? 0.8 : -Math.min(3, (pos - target) * 0.35);
  const bill = wageBill(clubPlayers(state, uc));
  P.finances += (uc.budget < 0 ? -3 : 0.6) + (bill > b.wageBudget * 1.02 ? -2 : 0.4);
  const st = state.seasonStats;
  if (st.m >= 4) {
    const ys = youthShare(state);
    P.youth += ys >= b.youthTarget ? 0.8 : -Math.min(2, (b.youthTarget - ys) * 0.15) * (b.identity === 'youth' ? 2 : 0.6);
    const gf = st.gf / st.m, ga = st.ga / st.m, poss = st.poss / st.m;
    const ok = { attack: gf >= 1.6, solid: ga <= 1.1, possession: poss >= 52, youth: ys >= b.youthTarget }[b.identity];
    P.style += ok ? 0.8 : -1;
  }
  for (const k of Object.keys(P)) P[k] = clamp(P[k], 0, 100);
  b.confidence = Math.round(Object.keys(W).reduce((a, k) => a + P[k] * W[k], 0) * 10) / 10;
  return b.confidence;
}

/** Limogeage en cours de saison si la confiance s'effondre. */
export function checkMidSeasonSack(state, leagueRound) {
  const b = state.board;
  if (state.online) return false; // carrière en ligne : chaque manager garde son club
  if (state.sacked || leagueRound < 10 || b.confidence >= 14 / (b.patience ?? 1)) return false;
  const rng = gameRng(state);
  if (!rng.chance(b.confidence < 8 ? 0.6 : 0.25)) return false;
  state.sacked = { season: state.season, day: state.day, club: userClub(state).name };
  pushMessage(state, { prio: 1, icon: '🚪', title: 'Vous êtes limogé', text: 'Le conseil d\'administration a perdu confiance. Trouvez un nouveau club.' });
  return true;
}

/* ---------------- Enveloppes ---------------- */

export const wageRoom = (state) => {
  const b = ensureBoard(state);
  return b.wageBudget - wageBill(clubPlayers(state, userClub(state)));
};

/** Bascule entre budget transferts et masse salariale (amount en € de transferts, + vers salaires). */
export function shiftBudget(state, amount) {
  const b = ensureBoard(state);
  if (amount > 0) {
    if (b.transferBudget < amount) return { ok: false, msg: 'Budget transferts insuffisant.' };
    b.transferBudget -= amount; b.wageBudget += Math.round(amount / WAGE_RATE / 100) * 100;
  } else {
    const weekly = Math.round(-amount / WAGE_RATE / 100) * 100;
    if (wageRoom(state) < weekly) return { ok: false, msg: 'Pas assez de marge sur la masse salariale.' };
    b.wageBudget -= weekly; b.transferBudget += -amount;
  }
  return { ok: true, msg: 'Enveloppes ajustées.' };
}

/** Le CA valide-t-il une dépense de transfert et un nouveau salaire ? */
export function boardAllows(state, { fee = 0, addWage = 0 }) {
  const b = ensureBoard(state);
  if (fee > b.transferBudget) return { ok: false, msg: `Le CA refuse : budget transferts insuffisant (${money(b.transferBudget)} disponibles).` };
  if (addWage > 0 && addWage > wageRoom(state)) return { ok: false, msg: `Le CA refuse : masse salariale dépassée (marge ${money(Math.max(0, wageRoom(state)))}/sem).` };
  return { ok: true };
}

export function spendTransfer(state, amount) { ensureBoard(state).transferBudget = Math.max(0, state.board.transferBudget - amount); }
export function creditSale(state, amount) { ensureBoard(state).transferBudget += Math.round(amount * SALE_SHARE / 1000) * 1000; }

/* ---------------- Demandes au CA ---------------- */

export const REQUESTS = {
  transfer: { label: 'Rallonge du budget transferts', min: 55 },
  wage: { label: 'Hausse de la masse salariale', min: 60 },
  training: { label: 'Financer le centre d\'entraînement', min: 70 },
  academy: { label: 'Financer le centre de formation', min: 65 },
  stadium: { label: 'Agrandir le stade (+5 000 places)', min: 78 },
};

export function boardRequest(state, type) {
  const b = ensureBoard(state);
  const uc = userClub(state);
  const last = b.req[type];
  if (last != null && state.day - last < 8 && last <= state.day) return { ok: false, msg: `Le CA a déjà statué récemment (réessayez dans ${8 - (state.day - last)} journée(s)).` };
  b.req[type] = state.day;
  const conf = b.confidence;
  const rich = uc.budget;
  const refuse = (why) => { if (conf < 45) b.parts.transfers = clamp(b.parts.transfers - 2, 0, 100); return { ok: false, msg: `Refusé : ${why}` }; };
  if (conf < REQUESTS[type].min) return refuse(`la confiance du CA est insuffisante (${Math.round(conf)} %, il faut ${REQUESTS[type].min} %).`);
  switch (type) {
    case 'transfer': {
      const extra = Math.round(Math.max(0, rich - b.transferBudget) * 0.15 / 50000) * 50000;
      if (extra < 250000) return refuse('les finances ne le permettent pas.');
      b.transferBudget += extra;
      return { ok: true, msg: `Accordé : +${money(extra)} de budget transferts.` };
    }
    case 'wage': {
      if (rich < 0) return refuse('le club est dans le rouge.');
      const extra = Math.round(b.wageBudget * 0.08 / 1000) * 1000;
      b.wageBudget += extra;
      return { ok: true, msg: `Accordé : masse salariale +${money(extra)}/sem.` };
    }
    case 'training': {
      const lvl = uc.facilities.training;
      if (lvl >= 5) return refuse('le centre est déjà au maximum.');
      const cost = trainingUpgradeCost(lvl);
      if (rich < cost * 3) return refuse('le club ne peut pas se le permettre.');
      uc.budget -= cost; uc.facilities.training++;
      return { ok: true, msg: `Accordé : centre d'entraînement niveau ${uc.facilities.training} (financé par le club).` };
    }
    case 'academy': {
      if (uc.academy >= 5) return refuse('le centre de formation est déjà au maximum.');
      const cost = academyCost(uc);
      if (rich < cost * 3) return refuse('le club ne peut pas se le permettre.');
      uc.budget -= cost; uc.academy++;
      return { ok: true, msg: `Accordé : centre de formation niveau ${uc.academy}.` };
    }
    case 'stadium': {
      if (uc.facilities.works) return refuse('des travaux sont déjà en cours.');
      const cost = stadiumCost(5000);
      if (rich < cost * 2.5) return refuse('le projet est trop coûteux pour le moment.');
      uc.budget -= cost; uc.facilities.works = { seats: 5000, daysLeft: 9 };
      return { ok: true, msg: 'Accordé : +5 000 places, travaux lancés.' };
    }
    default: return { ok: false, msg: '?' };
  }
}
