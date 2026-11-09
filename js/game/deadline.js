/**
 * DEADLINE DAY : événements de dernière minute, joués en direct depuis l'Accueil
 * (compte à rebours de 2 minutes). Toute la logique est ici, l'écran ne fait qu'afficher.
 */
import { clamp, createRng, hashSeed } from '../core/rng.js';
import { BAL } from '../data/balance.js';
import { userClub, clubById, clubPlayers, pushMessage } from './state.js';
import { money, playerValue, playerWage } from './economy.js';
import { overall, squadStrength } from '../engine/ratings.js';
import { removeFromClubPublic as removeFromClub, addToClubPublic as addToClub, logFinance, MAX_SQUAD } from './transfers.js';
import { boardAllows, spendTransfer, creditSale } from './board.js';
import { relAdd } from './relations.js';
import { paySellOn } from './agents.js';
import { news } from './managers.js';
import { finHealth } from './owners.js';

const D = BAL.deadline;

export function deadlineRng(state, n) { return createRng(hashSeed(`${state.seed}-${state.season}-${state.day}-dl-${n}`)); }

/** Génère l'événement n° n. Retourne { type, text, … } ou null. */
export function deadlineEvent(state, n) {
  const rng = deadlineRng(state, n);
  const uc = userClub(state);
  const others = state.clubs.filter((c) => c.id !== uc.id);
  const r = rng.next();
  if (r < D.surpriseIn) {
    // Offre surprise pour un de vos joueurs.
    const p = rng.pick(clubPlayers(state, uc).filter((x) => !x.onLoanFrom).sort((a, b) => overall(b) - overall(a)).slice(0, 10));
    const buyer = rng.pick(others.filter((c) => c.budget > (p?.value || 0) && c.rep >= uc.rep - 10));
    if (!p || !buyer) return null;
    const amount = Math.round(p.value * rng.range(1.0, 1.5) / 25000) * 25000;
    return { type: 'offer', pid: p.id, clubId: buyer.id, amount, text: `${buyer.name} dégaine ${money(amount)} pour ${p.name} !` };
  }
  if (r < D.surpriseIn + D.bargain) {
    // Bonne affaire : un club en crise brade ou libère un joueur.
    const crisis = others.filter((c) => c.crisis || finHealth(state, c) < 35);
    const c = rng.pick(crisis.length ? crisis : others);
    const p = rng.pick(clubPlayers(state, c).filter((x) => !x.onLoanFrom).sort((a, b) => overall(b) - overall(a)).slice(0, 6));
    if (!p) return null;
    const free = c.crisis && rng.chance(0.3);
    const price = free ? 0 : Math.round(p.value * (c.crisis ? BAL.crisis.deadlineDiscount : 0.85) / 25000) * 25000;
    return { type: 'bargain', pid: p.id, clubId: c.id, price, free, text: free ? `${c.name}, étranglé par les dettes, libère ${p.name} (${overall(p)}) !` : `${c.name} brade ${p.name} (${overall(p)}) : ${money(price)}.` };
  }
  if (r < D.surpriseIn + D.bargain + D.lateRefusal) {
    const c = rng.pick(others);
    const p = rng.pick(clubPlayers(state, c));
    if (!p) return null;
    return { type: 'news', text: rng.pick([`Coup de théâtre : le transfert de ${p.name} vers ${rng.pick(others).short} capote à la dernière seconde.`, `${c.name} refuse finalement de lâcher ${p.name}.`, `Fax envoyé trop tard : ${p.name} reste à ${c.short}.`]) };
  }
  const a = rng.pick(others), b = rng.pick(others);
  const p = rng.pick(clubPlayers(state, a));
  if (!p || a === b) return null;
  return { type: 'news', text: `Officiel : ${p.name} file de ${a.short} à ${b.short} sur le gong.` };
}

/** Accepter une offre surprise. */
export function acceptDeadlineOffer(state, ev) {
  const p = state.players[ev.pid];
  const uc = userClub(state);
  const buyer = clubById(state, ev.clubId);
  if (!p || p.clubId !== uc.id) return { ok: false, msg: 'Trop tard.' };
  if (uc.playerIds.length <= 16) return { ok: false, msg: 'Effectif trop réduit.' };
  removeFromClub(state, p); addToClub(state, p, buyer);
  buyer.budget -= ev.amount; uc.budget += ev.amount;
  paySellOn(state, p, uc, ev.amount);
  creditSale(state, ev.amount);
  relAdd(state, uc.id, buyer.id, BAL.relations.fairSale);
  logFinance(state, ev.amount, `Vente (deadline) : ${p.name}`);
  news(state, 'transfer', `${p.first} ${p.last} quitte ${uc.name} pour ${buyer.name} · ${money(ev.amount)} (deadline day).`, { pid: p.id });
  return { ok: true, msg: `${p.name} vendu ${money(ev.amount)} !` };
}

/** Signer une bonne affaire (contrat aux conditions du joueur). */
export function signBargain(state, ev, rng = deadlineRng(state, 999)) {
  const p = state.players[ev.pid];
  const uc = userClub(state);
  const from = clubById(state, ev.clubId);
  if (!p || p.clubId !== from.id) return { ok: false, msg: 'Déjà parti.' };
  if (uc.playerIds.length >= MAX_SQUAD) return { ok: false, msg: 'Effectif complet.' };
  if (rng.chance(D.lateRefusal * 0.6)) return { ok: false, msg: `Refus de dernière seconde : ${p.name} préfère une autre destination.` };
  const wage = Math.round(Math.max(p.wage, playerWage(p)) * 1.05 / 100) * 100;
  const chk = boardAllows(state, { fee: ev.price, addWage: wage });
  if (!chk.ok) return chk;
  if (uc.budget < ev.price) return { ok: false, msg: 'Budget insuffisant.' };
  spendTransfer(state, ev.price);
  removeFromClub(state, p); addToClub(state, p, uc);
  uc.budget -= ev.price; from.budget += ev.price;
  paySellOn(state, p, from, ev.price);
  Object.assign(p, { wage, contract: 2, joined: state.season });
  p.morale = clamp(p.morale + 8, 5, 99);
  if (ev.price) logFinance(state, -ev.price, `Transfert (deadline) : ${p.name}`);
  news(state, 'transfer', `${p.first} ${p.last} rejoint ${uc.name} sur le gong${ev.price ? ` · ${money(ev.price)}` : ' (libéré)'}.`, { pid: p.id });
  pushMessage(state, { prio: 2, icon: '✍', title: `${p.name} signe sur le gong`, text: `${ev.price ? money(ev.price) : 'Libre'} · ${money(wage)}/sem.` });
  return { ok: true, msg: `${p.name} signe !` };
}

export const DEADLINE_SECONDS = D.seconds;
export const DEADLINE_EVERY = D.every;
export { squadStrength, playerValue };
