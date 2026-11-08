/**
 * Transferts simplifiés : acheter, vendre, prêter, prolonger, libérer.
 * + activité de l'IA (achats entre clubs, offres pour vos joueurs).
 */
import { overall, squadStrength } from '../engine/ratings.js';
import { playerValue, playerWage, money } from './economy.js';
import { clubById, userClub, clubPlayers, pushMessage } from './state.js';
import { assignNumbers, createPlayer } from '../data/generator.js';
import { clamp } from '../core/rng.js';

export const MAX_SQUAD = 32;
const MIN_SQUAD = 20;

/** Fenêtre de transferts ouverte ? (début de saison et mi-saison) */
export function windowOpen(state) {
  const e = state.calendar?.[state.day];
  const lr = e ? e.lr : 0;
  return lr <= 3 || (lr >= 19 && lr <= 22);
}

/** Prix demandé pour un joueur. */
export function askingPrice(state, p) {
  if (!p.clubId) return 0;
  const club = clubById(state, p.clubId);
  const squad = clubPlayers(state, club);
  const rank = squad.map(overall).sort((a, b) => b - a).indexOf(overall(p));
  const key = rank >= 0 && rank < 11 ? 1.3 : 1.05;
  return Math.round(playerValue(p) * key * (p.listed ? 0.85 : 1) / 25000) * 25000;
}

/** Liste du marché (hors club de l'utilisateur). */
export function marketList(state, { pos = null, maxPrice = Infinity, youngOnly = false } = {}) {
  const ids = [...state.freeAgents];
  for (const c of state.clubs) if (c.id !== state.userClubId) ids.push(...c.playerIds);
  return ids.map((id) => state.players[id])
    .filter((p) => p && !p.onLoanFrom && (!pos || p.pos === pos) && (!youngOnly || p.age <= 23))
    .map((p) => ({ p, price: askingPrice(state, p), ovr: overall(p) }))
    .filter((x) => x.price <= maxPrice)
    .sort((a, b) => b.ovr - a.ovr);
}

function removeFromClub(state, p) {
  if (p.clubId) {
    const c = clubById(state, p.clubId);
    c.playerIds = c.playerIds.filter((id) => id !== p.id);
    c.youthIds = (c.youthIds || []).filter((id) => id !== p.id);
    if (c.lineup) c.lineup = c.lineup.map((id) => (id === p.id ? null : id));
    if (c.bench) c.bench = c.bench.filter((id) => id !== p.id);
  } else {
    state.freeAgents = state.freeAgents.filter((id) => id !== p.id);
  }
}

function addToClub(state, p, club) {
  p.clubId = club.id;
  club.playerIds.push(p.id);
  p.number = 0;
  assignNumbers(clubPlayers(state, club));
  p.listed = false; p.requested = false; p.clause = 0;
}

/** Achat par l'utilisateur. Retourne { ok, msg }. */
export function buyPlayer(state, pid) {
  const p = state.players[pid];
  const club = userClub(state);
  if (!windowOpen(state)) return { ok: false, msg: 'Le mercato est fermé.' };
  if (club.playerIds.length >= MAX_SQUAD) return { ok: false, msg: `Effectif complet (${MAX_SQUAD} max).` };
  const price = askingPrice(state, p);
  const wage = Math.round(Math.max(p.wage, playerWage(p)) * 1.1 / 100) * 100;
  const bonus = p.clubId ? 0 : wage * 6; // prime à la signature pour un joueur libre
  const cost = price + bonus;
  if (club.budget < cost) return { ok: false, msg: `Budget insuffisant (${money(cost)}).` };
  if (p.clubId) {
    const seller = clubById(state, p.clubId);
    seller.budget += price;
  }
  removeFromClub(state, p);
  addToClub(state, p, club);
  club.budget -= cost;
  p.wage = wage; p.contract = Math.max(p.contract, 3); p.morale = clamp(p.morale + 12, 0, 100);
  logFinance(state, -cost, `Transfert : ${p.name}`);
  pushMessage(state, { prio: 2, icon: '✍', title: `${p.name} signe au club`, text: `Coût ${money(cost)}, salaire ${money(wage)}/sem.` });
  return { ok: true, msg: `${p.name} a signé !` };
}

/** Prêt entrant (jeunes ≤ 23 ans) : frais de 8 % de la valeur. */
export function loanIn(state, pid) {
  const p = state.players[pid];
  const club = userClub(state);
  if (!windowOpen(state)) return { ok: false, msg: 'Le mercato est fermé.' };
  if (!p.clubId || p.age > 23) return { ok: false, msg: 'Prêt impossible.' };
  if (club.playerIds.length >= MAX_SQUAD) return { ok: false, msg: 'Effectif complet.' };
  const fee = Math.round(playerValue(p) * 0.08 / 25000) * 25000;
  if (club.budget < fee) return { ok: false, msg: 'Budget insuffisant.' };
  const from = clubById(state, p.clubId);
  from.budget += fee;
  removeFromClub(state, p);
  addToClub(state, p, club);
  p.onLoanFrom = from.id;
  club.budget -= fee;
  logFinance(state, -fee, `Prêt : ${p.name}`);
  pushMessage(state, { prio: 3, icon: '⇆', title: `${p.name} prêté jusqu'en fin de saison`, text: `Frais ${money(fee)}.` });
  return { ok: true, msg: `${p.name} arrive en prêt.` };
}

/** Une offre d'un club IA pour un joueur de l'utilisateur. */
export function findBuyer(state, p, rng) {
  const value = playerValue(p);
  const cands = state.clubs.filter((c) => c.id !== state.userClubId && c.budget > value * 0.8 && c.playerIds.length < MAX_SQUAD - 2);
  if (!cands.length) return null;
  // Les clubs dont le niveau correspond au joueur sont plus intéressés.
  const o = overall(p);
  const w = cands.map((c) => 1 / (1 + Math.abs(squadStrength(clubPlayers(state, c)) - o)));
  const club = cands[rng.weightedIndex(w)];
  const amount = Math.round(value * rng.range(0.8, 1.15) / 25000) * 25000;
  return { pid: p.id, clubId: club.id, amount: Math.min(amount, club.budget) };
}

/** Exécute la vente vers un club IA. */
export function sellPlayer(state, offer) {
  const p = state.players[offer.pid];
  const buyer = clubById(state, offer.clubId);
  const club = userClub(state);
  if (!p || p.clubId !== club.id) return { ok: false, msg: 'Joueur indisponible.' };
  if (club.playerIds.length <= MIN_SQUAD - 4) return { ok: false, msg: 'Effectif trop réduit.' };
  removeFromClub(state, p);
  addToClub(state, p, buyer);
  buyer.budget -= offer.amount;
  club.budget += offer.amount;
  logFinance(state, offer.amount, `Vente : ${p.name}`);
  state.pendingOffers = (state.pendingOffers || []).filter((o) => o.pid !== p.id);
  pushMessage(state, { prio: 3, icon: '€', title: `${p.name} vendu à ${buyer.name}`, text: money(offer.amount) });
  return { ok: true, msg: `${p.name} vendu ${money(offer.amount)}.` };
}

/** Prêt sortant vers un club plus modeste (le joueur gagne du temps de jeu). */
export function loanOut(state, pid, rng) {
  const p = state.players[pid];
  const club = userClub(state);
  if (!windowOpen(state)) return { ok: false, msg: 'Le mercato est fermé.' };
  if (p.onLoanFrom) return { ok: false, msg: 'Joueur déjà prêté.' };
  const o = overall(p);
  const cands = state.clubs.filter((c) => c.id !== club.id && c.playerIds.length < MAX_SQUAD - 1 && squadStrength(clubPlayers(state, c)) <= o + 2);
  if (!cands.length) return { ok: false, msg: 'Aucun club intéressé.' };
  const dest = rng.pick(cands);
  removeFromClub(state, p);
  addToClub(state, p, dest);
  p.onLoanFrom = club.id;
  club.loanedOut = club.loanedOut || [];
  club.loanedOut.push(p.id);
  pushMessage(state, { prio: 3, icon: '⇆', title: `${p.name} prêté à ${dest.name}`, text: 'Retour en fin de saison. Vous payez 30 % du salaire.' });
  return { ok: true, msg: `${p.name} prêté à ${dest.name}.` };
}

/** Prolongation de contrat (3 ans). */
export function renewContract(state, pid) {
  const p = state.players[pid];
  const club = userClub(state);
  const wage = Math.round(Math.max(p.wage, playerWage(p) * 1.05) / 100) * 100;
  if (p.age >= 34 && overall(p) < 65) return { ok: false, msg: `${p.name} préfère finir sa carrière ailleurs.` };
  p.wage = wage; p.contract = 3; p.morale = clamp(p.morale + 6, 0, 100);
  p.value = playerValue(p);
  void club;
  return { ok: true, msg: `${p.name} prolonge 3 ans (${money(wage)}/sem).` };
}

/** Libération : indemnité de 10 semaines de salaire. */
export function releasePlayer(state, pid) {
  const p = state.players[pid];
  const club = userClub(state);
  const cost = p.wage * 10;
  if (club.budget < cost) return { ok: false, msg: 'Budget insuffisant pour l\'indemnité.' };
  removeFromClub(state, p);
  p.clubId = null; p.contract = 0;
  state.freeAgents.push(p.id);
  club.budget -= cost;
  logFinance(state, -cost, `Indemnité : ${p.name}`);
  return { ok: true, msg: `${p.name} est libéré.` };
}

/** Promotion d'un jeune du centre de formation. */
export function promoteYouth(state, pid) {
  const club = userClub(state);
  if (club.playerIds.length >= MAX_SQUAD) return { ok: false, msg: 'Effectif complet.' };
  club.youthIds = club.youthIds.filter((id) => id !== pid);
  club.playerIds.push(pid);
  const p = state.players[pid];
  p.number = 0;
  assignNumbers(clubPlayers(state, club));
  return { ok: true, msg: `${p.name} intègre l'équipe première !` };
}

export function upgradeAcademy(state) {
  const club = userClub(state);
  if (club.academy >= 5) return { ok: false, msg: 'Centre déjà au niveau maximum.' };
  const cost = academyCost(club);
  if (club.budget < cost) return { ok: false, msg: 'Budget insuffisant.' };
  club.budget -= cost;
  club.academy++;
  logFinance(state, -cost, 'Centre de formation');
  return { ok: true, msg: `Centre de formation niveau ${club.academy} !` };
}
export const academyCost = (club) => 1_500_000 * club.academy;

/** Journal financier du club de l'utilisateur. */
export function logFinance(state, amount, label) {
  const club = userClub(state);
  club.finances.history.unshift({ season: state.season, day: state.day, amount, label });
  if (club.finances.history.length > 80) club.finances.history.length = 80;
}

/* ---------------- IA ---------------- */

/** Activité du mercato pour les clubs IA + offres reçues par l'utilisateur. */
export function aiTransferActivity(state, rng) {
  if (!windowOpen(state)) {
    // Hors fenêtre : les clubs IA complètent seulement leur effectif avec des libres.
    for (const c of state.clubs) if (c.id !== state.userClubId) fillSquad(state, c, rng);
    return;
  }
  for (const c of state.clubs) {
    if (c.id === state.userClubId) continue;
    fillSquad(state, c, rng);
    if (!rng.chance(0.12)) continue;
    // Cherche à renforcer le poste le plus faible.
    const squad = clubPlayers(state, c);
    const strength = squadStrength(squad);
    const byPos = {};
    for (const p of squad) byPos[p.pos] = Math.max(byPos[p.pos] || 0, overall(p));
    const weakest = Object.entries(byPos).sort((a, b) => a[1] - b[1])[0];
    if (!weakest) continue;
    const pos = weakest[0];
    const target = marketList(state, { pos, maxPrice: c.budget * 0.6 })
      .filter((x) => x.p.clubId !== c.id && x.ovr > weakest[1] + 2 && x.ovr <= strength + 8 && x.p.clubId !== state.userClubId)
      .slice(0, 6);
    if (!target.length) continue;
    const pick = rng.pick(target);
    const p = pick.p;
    if (p.clubId) clubById(state, p.clubId).budget += pick.price;
    removeFromClub(state, p);
    addToClub(state, p, c);
    c.budget -= pick.price;
    p.contract = Math.max(p.contract, 2);
    if (c.playerIds.length > 28) releaseWorst(state, c);
  }
  // Offres pour les joueurs de l'utilisateur.
  const uc = userClub(state);
  if (rng.chance(0.3)) {
    const squad = clubPlayers(state, uc).filter((p) => !p.onLoanFrom);
    const listed = squad.filter((p) => p.listed);
    const pool = listed.length && rng.chance(0.7) ? listed : squad.sort((a, b) => overall(b) - overall(a)).slice(0, 12);
    const p = rng.pick(pool);
    if (p && !(state.pendingOffers || []).some((o) => o.pid === p.id)) {
      const offer = findBuyer(state, p, rng);
      if (offer) {
        if (p.listed) offer.amount = Math.round(offer.amount * 1.05 / 25000) * 25000;
        state.pendingOffers = state.pendingOffers || [];
        state.pendingOffers.push({ ...offer, day: state.day });
        const buyer = clubById(state, offer.clubId);
        pushMessage(state, { prio: 1, icon: '€', title: `Offre pour ${p.name}`, text: `${buyer.name} propose ${money(offer.amount)}.`, action: { type: 'offer', pid: p.id } });
      }
    }
  }
}

function releaseWorst(state, c) {
  const squad = clubPlayers(state, c).sort((a, b) => overall(a) - overall(b));
  const p = squad.find((x) => x.pos !== 'GB' && !x.onLoanFrom);
  if (!p) return;
  removeFromClub(state, p);
  p.clubId = null; p.contract = 0;
  state.freeAgents.push(p.id);
}

/** Complète un effectif IA trop court (blessures, ventes, retraites). */
export function fillSquad(state, c, rng, min = 22) {
  let guard = 0;
  const added = [];
  while (c.playerIds.length < min && guard++ < 25) {
    const squad = clubPlayers(state, c);
    const count = (pos) => squad.filter((p) => p.pos === pos).length;
    const need = count('GB') < 2 ? 'GB' : ['DC', 'MC', 'BU', 'DG', 'DD', 'AG', 'AD', 'MDC', 'MO'].sort((a, b) => count(a) - count(b))[0];
    const lvl = squadStrength(squad) - 5;
    let p = state.freeAgents.map((id) => state.players[id]).filter((x) => x.pos === need && overall(x) <= lvl + 6)
      .sort((a, b) => overall(b) - overall(a))[0];
    if (!p) { p = createPlayer(rng, { pos: need, level: Math.round(lvl), age: rng.int(19, 30), country: c.country }); state.players[p.id] = p; }
    else state.freeAgents = state.freeAgents.filter((id) => id !== p.id);
    p.contract = rng.int(1, 3);
    p.wage = Math.round(playerWage(p) / 100) * 100;
    addToClub(state, p, c);
    added.push(p);
  }
  return added;
}

export const removeFromClubPublic = removeFromClub;
export const addToClubPublic = addToClub;

/* ---------------- Négociations ---------------- */

/**
 * Ouvre une négociation d'achat avec le club vendeur.
 * Le prix plancher (caché) dépend de l'importance du joueur et de son envie de partir.
 */
export function startNegotiation(state, pid, rng) {
  const p = state.players[pid];
  const asking = askingPrice(state, p);
  const key = asking > playerValue(p) * 1.2;
  const min = Math.round(asking * (key ? rng.range(0.92, 1.05) : rng.range(0.78, 0.95)) * (p.requested ? 0.85 : 1) / 25000) * 25000;
  return { pid, asking, min, patience: 3, history: [], fee: null, status: 'open' };
}

/** Réponse du club à une offre : accept | counter | reject | end. */
export function clubRespond(neg, offer) {
  neg.history.push(offer);
  if (offer >= neg.min) { neg.status = 'accepted'; neg.fee = offer; return { kind: 'accept', msg: 'Offre acceptée par le club !' }; }
  if (offer < neg.min * 0.75) neg.patience -= 2; else neg.patience--;
  if (neg.patience <= 0) { neg.status = 'closed'; return { kind: 'end', msg: 'Le club met fin aux discussions.' }; }
  if (offer < neg.min * 0.75) return { kind: 'reject', msg: 'Offre jugée insultante.' };
  const counter = Math.round(Math.max(neg.min, (neg.asking + offer) / 2 * 1.02) / 25000) * 25000;
  neg.counter = counter;
  return { kind: 'counter', msg: `Contre-proposition : ${money(counter)}`, counter };
}

/** Exigences du joueur (et de son agent) pour un contrat. */
export function playerDemands(state, p, rng) {
  const base = Math.max(p.wage, playerWage(p));
  const greed = p.agentGreed ?? (p.agentGreed = Math.round(rng.range(0, 0.15) * 100) / 100);
  return { wage: Math.round(base * (1.08 + greed) / 100) * 100, agentFeeRate: 0.04 + greed / 3, tries: 3 };
}

/**
 * Évaluation d'une proposition de contrat.
 * offer : { wage, years, bonus (prime à la signature), clause (0 = aucune) }
 */
export function evaluateContract(p, dem, offer) {
  let v = offer.wage;
  v *= 1 + (offer.bonus || 0) / (Math.max(1, dem.wage) * 40); // prime : vaut ~1/40e par semaine
  if (offer.clause) v *= offer.clause < playerValue(p) * 1.6 ? 1.1 : 1.05; // une clause basse = liberté
  const wantsLong = p.age >= 29;
  if (wantsLong && offer.years >= 3) v *= 1.05;
  if (!wantsLong && p.age <= 24 && offer.years >= 4) v *= 0.97;
  const ratio = v / dem.wage;
  if (ratio >= 1) return { kind: 'accept', msg: 'Le joueur accepte !' };
  dem.tries--;
  if (dem.tries <= 0) return { kind: 'end', msg: 'Le joueur et son agent quittent la table.' };
  if (ratio >= 0.88) return { kind: 'counter', msg: `Son agent réclame ${money(Math.round(dem.wage / (v / offer.wage) / 100) * 100)}/sem pour ces conditions.` };
  return { kind: 'reject', msg: 'Proposition très loin des attentes.' };
}

/** Finalise un transfert négocié (fee = 0 pour un joueur libre). */
export function completeTransfer(state, pid, fee, offer, dem) {
  const p = state.players[pid];
  const club = userClub(state);
  if (!windowOpen(state)) return { ok: false, msg: 'Le mercato est fermé.' };
  if (club.playerIds.length >= MAX_SQUAD) return { ok: false, msg: `Effectif complet (${MAX_SQUAD} max).` };
  const agentFee = Math.round((fee ? fee * dem.agentFeeRate : offer.wage * 4) / 1000) * 1000;
  const cost = fee + (offer.bonus || 0) + agentFee;
  if (club.budget < cost) return { ok: false, msg: `Budget insuffisant (${money(cost)}).` };
  if (p.clubId) clubById(state, p.clubId).budget += fee;
  removeFromClub(state, p);
  addToClub(state, p, club);
  club.budget -= cost;
  Object.assign(p, { wage: offer.wage, contract: offer.years, clause: offer.clause || 0, requested: false });
  p.morale = clamp(p.morale + 12, 0, 100);
  logFinance(state, -fee, `Transfert : ${p.name}`);
  if (offer.bonus) logFinance(state, -offer.bonus, `Prime à la signature : ${p.name}`);
  logFinance(state, -agentFee, `Commission d'agent : ${p.name}`);
  pushMessage(state, { prio: 2, icon: '✍', title: `${p.name} signe au club`, text: `Indemnité ${money(fee)}, ${money(offer.wage)}/sem, ${offer.years} an(s).` });
  return { ok: true, msg: `${p.name} a signé !` };
}

/** Prolongation négociée. */
export function completeRenewal(state, pid, offer) {
  const p = state.players[pid];
  const club = userClub(state);
  if (offer.bonus && club.budget < offer.bonus) return { ok: false, msg: 'Budget insuffisant pour la prime.' };
  club.budget -= offer.bonus || 0;
  if (offer.bonus) logFinance(state, -offer.bonus, `Prime de prolongation : ${p.name}`);
  Object.assign(p, { wage: offer.wage, contract: offer.years, clause: offer.clause || 0, requested: false });
  p.morale = clamp(p.morale + 8, 0, 100);
  p.value = playerValue(p);
  return { ok: true, msg: `${p.name} prolonge ${offer.years} an(s) à ${money(offer.wage)}/sem.` };
}

/** Contre-offre de l'utilisateur sur une offre reçue (+x %). */
export function counterIncoming(state, offer, ratio, rng) {
  const buyer = clubById(state, offer.clubId);
  const asked = Math.round(offer.amount * ratio / 25000) * 25000;
  const accept = buyer.budget >= asked && rng.chance(clamp(1 - (ratio - 1) * 4.5, 0.05, 0.95));
  if (accept) { offer.amount = asked; return { ok: true, msg: `${buyer.name} accepte ${money(asked)} !` }; }
  state.pendingOffers = state.pendingOffers.filter((o) => o !== offer);
  return { ok: false, msg: `${buyer.name} retire son offre.` };
}
