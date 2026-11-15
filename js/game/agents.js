/**
 * AGENTS, RUMEURS ET CLAUSES
 * - Agents à profil (gourmand, loyal, agressif) pour les joueurs importants.
 * - Rumeurs : 70 % vraies (suivies d'une offre), 30 % fausses, parfois lancées par un agent.
 * - Clauses : pourcentage à la revente, option d'achat (prêts), prime de but.
 */
import { clamp, hashSeed } from '../core/rng.js';
import { BAL } from '../data/balance.js';
import { userClub, clubById, clubPlayers, pushMessage } from './state.js';
import { money, playerValue } from './economy.js';
import { overall } from '../engine/ratings.js';
import { pers, moodShift } from './people.js';
import { news } from './managers.js';
import { windowInfo } from './dates.js';

const A = BAL.agents;
const RU = BAL.rumours;
const AGENT_NAMES = ['M. Okafor', 'L. Benedetti', 'J. Marchal', 'S. Ruiz', 'T. Hammond', 'K. Diallo', 'R. Costa', 'É. Laurent', 'D. Price', 'N. Haddad'];

/** Agent d'un joueur important (stable, déterministe). null sinon. */
export function agentOf(p) {
  if ((p.value ?? playerValue(p)) < A.minValue && overall(p) < 66) return null;
  if (!p.agent) {
    const h = hashSeed(`agent-${p.id}`);
    const keys = Object.keys(A.types);
    let x = (h % 1000) / 1000, type = keys[0];
    for (const k of keys) { x -= A.types[k].weight; if (x < 0) { type = k; break; } }
    p.agent = { type, name: AGENT_NAMES[h % AGENT_NAMES.length] };
  }
  return p.agent;
}
export const agentInfo = (p) => { const a = agentOf(p); return a ? { ...A.types[a.type], ...a } : null; };

/** Ajuste les exigences d'un joueur selon son agent. */
export function agentDemands(p, dem) {
  const a = agentInfo(p);
  if (!a) return dem;
  dem.wage = Math.round(dem.wage * a.wage / 100) * 100;
  dem.agentFeeRate = a.fee;
  dem.minBonus = Math.round(dem.wage * a.bonusWeeks / 1000) * 1000;
  dem.agent = a;
  return dem;
}

/* ---------------- Rumeurs ---------------- */

export function rumoursDaily(state, rng) {
  const L = state.life;
  L.rumours = (L.rumours || []).filter((r) => state.day - r.day <= 6 && r.season === state.season);
  const open = windowInfo(state).open;
  if (!rng.chance(open ? RU.daily : RU.closedDaily)) return;
  const uc = userClub(state);
  const clubs = state.clubs.filter((c) => c.id !== uc.id);
  // Un tiers des rumeurs concerne un joueur de l'utilisateur.
  const mine = rng.chance(0.33);
  const from = mine ? uc : rng.pick(clubs);
  const pool = clubPlayers(state, from).filter((p) => !p.onLoanFrom).sort((a, b) => overall(b) - overall(a)).slice(0, 6);
  const p = rng.pick(pool);
  if (!p) return;
  const to = rng.pick(clubs.filter((c) => c.id !== from.id && c.rep >= from.rep - 5)) || rng.pick(clubs);
  if (!to || to.id === from.id) return;
  const real = rng.chance(RU.trueRate);
  const ag = agentOf(p);
  const byAgent = !real && ag && rng.chance(RU.agentShare / (1 - RU.trueRate));
  L.rumours.push({ pid: p.id, from: from.id, to: to.id, real, byAgent, day: state.day, season: state.season });
  if (byAgent) p.hype = { until: state.day + RU.hypeWeeks, season: state.season };
  if (from.id === uc.id) {
    const unsettled = ['mercenary', 'ambitious', 'sensitive'].includes(pers(p));
    if (unsettled) { p.form = clamp(p.form - RU.destabilize, 5, 95); moodShift(p, pers(p) === 'mercenary' ? 3 : -3); }
    pushMessage(state, { prio: 2, icon: '🗞', title: `Rumeur : ${p.name} vers ${to.short} ?`, text: `${byAgent ? `L'agent du joueur (${ag.name}) alimenterait la rumeur. ` : ''}${unsettled ? 'Le joueur semble perturbé.' : 'Le joueur reste concentré.'}`, action: { type: 'player', pid: p.id } });
  } else {
    pushMessage(state, { prio: 3, icon: '🗞', title: 'Rumeur', text: `${p.name} (${from.short}) intéresserait ${to.name}.`, action: { type: 'player', pid: p.id } });
  }
}

/** Les rumeurs vraies se concrétisent (offre pour un joueur de l'utilisateur). */
/**
 * Agents qui démarchent : pendant le mercato (ou à tout moment pour un joueur libre), un agent
 * propose de lui-même un joueur qui serait heureux de rejoindre votre club. Pour faciliter
 * l'affaire, son client accepte un salaire plus bas (10 à 20 %) pendant une dizaine de jours.
 */
export function agentPitches(state, rng) {
  if (!state.userClubId || rng.next() > 0.12) return;
  const uc = clubById(state, state.userClubId);
  if (!uc) return;
  const open = windowInfo(state).open;
  const squad = uc.playerIds.map((id) => state.players[id]).filter(Boolean);
  if (!squad.length) return;
  const lvl = squad.map(overall).sort((a, b) => b - a).slice(0, 14);
  const avg = lvl.reduce((a, b) => a + b, 0) / lvl.length;
  const cands = [];
  const consider = (p) => {
    if (!p || p.clubId === uc.id || p.onLoanFrom || p.pitch) return;
    if (p.clubId && (!open || p.joinedAt != null && (state.season * 400 + state.day) - p.joinedAt < 32)) return;
    const o = overall(p);
    if (o < avg - 6 || o > avg + 5) return;
    cands.push(p);
  };
  for (const id of state.freeAgents || []) consider(state.players[id]);
  if (open) for (let k = 0; k < 400; k++) { const c = state.clubs[Math.floor(rng.next() * state.clubs.length)]; if (c.id !== uc.id) consider(state.players[c.playerIds[Math.floor(rng.next() * c.playerIds.length)]]); }
  if (!cands.length) return;
  // Le joueur doit vraiment vouloir venir (ses priorités : temps de jeu, prestige, pays…).
  const p = cands.sort((a, b) => overall(b) - overall(a)).slice(0, 8).find((x) => { try { return pitchDecision(state, x, uc) > 8; } catch { return false; } });
  if (!p) return;
  const mult = Math.round((0.8 + rng.next() * 0.1) * 100) / 100;
  p.pitch = { club: uc.id, mult, until: state.day + 10 };
  pushMessage(state, { prio: 2, icon: '📞', title: `L'agent de ${p.name} vous le propose`, text: `${p.age} ans · ${p.pos} · ${overall(p)}. Son client rêve de venir et accepterait un salaire ${Math.round((1 - mult) * 100)} % plus bas (offre valable 10 jours).${p.clubId ? '' : ' Libre de tout contrat.'}`, action: { type: 'player', pid: p.id } });
}
let pitchDecision = () => 0;
export const setPitchDecision = (fn) => { pitchDecision = fn; };

export function rumourOffers(state, rng) {
  const uc = userClub(state);
  if (!windowInfo(state).open) return;
  for (const r of state.life.rumours || []) {
    if (!r.real || r.done || state.day - r.day < 1) continue;
    const p = state.players[r.pid];
    const to = clubById(state, r.to);
    if (!p || !to) { r.done = true; continue; }
    if (p.clubId === uc.id && rng.chance(0.5)) {
      r.done = true;
      const amount = Math.round(p.value * rng.range(0.95, 1.25) / 25000) * 25000;
      if (to.budget < amount || (state.pendingOffers || []).some((o) => o.pid === p.id)) continue;
      state.pendingOffers = state.pendingOffers || [];
      state.pendingOffers.push({ pid: p.id, clubId: to.id, amount, day: state.day });
      pushMessage(state, { prio: 1, icon: '€', title: `La rumeur se confirme : offre pour ${p.name}`, text: `${to.name} propose ${money(amount)}.`, action: { type: 'offer', pid: p.id } });
    }
  }
}

/** Prix demandé majoré si un agent fait monter les enchères. */
export const hypeMult = (state, p) => (p.hype && p.hype.season === state.season && state.day <= p.hype.until ? RU.hype : 1);

/* ---------------- Clauses ---------------- */

/** Pourcentage à la revente : verse sa part à l'ancien club lors d'un transfert payant. */
export function paySellOn(state, p, seller, fee) {
  if (!p.sellOn || !fee) return 0;
  const ben = clubById(state, p.sellOn.clubId);
  const part = Math.round(fee * p.sellOn.pct / 1000) * 1000;
  p.sellOn = null;
  if (!ben || !seller || ben.id === seller.id) return 0;
  seller.budget -= part; ben.budget += part;
  if (ben.id === state.userClubId) pushMessage(state, { prio: 2, icon: '💶', title: `Clause de revente : +${money(part)}`, text: `${p.name} a été revendu par ${seller.name}.` });
  if (seller.id === state.userClubId) pushMessage(state, { prio: 3, icon: '💶', title: `Clause de revente : -${money(part)}`, text: `Reversés à ${ben.name}.` });
  return part;
}

/** Primes de match, d'invincibilité et bonus de transfert (après N matchs) des joueurs de l'utilisateur. */
export function matchBonuses(state, d) {
  let total = 0;
  const lines = [];
  for (const id of d.played || []) {
    const p = state.players[id];
    if (!p) continue;
    if (p.appFee) total += p.appFee;
    if (p.csBonus && d.ga === 0) total += p.csBonus;
    if (p.addOn) {
      p.addOn.n++;
      if (p.addOn.n >= p.addOn.apps) {
        const to = clubById(state, p.addOn.to);
        if (to) to.budget += p.addOn.amount;
        lines.push({ amount: p.addOn.amount, text: `Bonus de transfert : ${p.name} (${p.addOn.apps} matchs) → ${to?.name || ''}` });
        p.addOn = null;
      }
    }
  }
  return { total, lines };
}

/** Primes de but des joueurs de l'utilisateur. */
export function goalBonuses(state, d) {
  let total = 0;
  for (const [id, g] of Object.entries(d.goalsBy || {})) {
    const p = state.players[id];
    if (p?.goalBonus) total += p.goalBonus * g;
  }
  return total;
}

/** Lever l'option d'achat d'un joueur prêté. */
export function exerciseOption(state, pid) {
  const p = state.players[pid];
  const uc = userClub(state);
  if (!p || p.clubId !== uc.id || !p.onLoanFrom || !p.buyOption) return { ok: false, msg: 'Pas d\'option d\'achat.' };
  if (uc.budget < p.buyOption || (state.board?.transferBudget ?? 0) < p.buyOption) return { ok: false, msg: `Budget insuffisant (${money(p.buyOption)}).` };
  const from = clubById(state, p.onLoanFrom);
  uc.budget -= p.buyOption; from.budget += p.buyOption;
  state.board.transferBudget -= p.buyOption;
  news(state, 'transfer', `${uc.name} lève l'option d'achat de ${p.first} ${p.last} (${money(p.buyOption)}).`, { pid: p.id });
  const price = p.buyOption;
  p.onLoanFrom = null; p.loanShare = null; p.buyOption = 0; p.contract = Math.max(p.contract, 3); p.joined = state.season;
  return { ok: true, msg: `${p.name} signe définitivement (${money(price)}).` };
}
