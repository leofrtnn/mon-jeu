/**
 * NÉGOCIATIONS (transferts et contrats)
 * ------------------------------------------------------------------
 * On ne propose plus seulement un prix ou un salaire, mais un PAQUET :
 *  - transfert : indemnité, paiement échelonné, bonus (après N matchs), % à la revente,
 *    joueur inclus dans l'échange ;
 *  - contrat : salaire, durée, statut promis, prime à la signature, prime de fidélité
 *    (fin de contrat), prime de match, prime de but, prime d'invincibilité, hausse annuelle,
 *    clause libératoire, baisse de salaire en cas de relégation, commission de l'agent.
 * Chaque club vendeur a un PROFIL (besoin d'argent tout de suite, club formateur qui mise sur
 * la revente, club sportif qui préfère des joueurs…) et chaque joueur/agent des PRIORITÉS
 * (argent, sécurité, temps de jeu, agent gourmand). Le même paquet ne vaut donc pas la même
 * chose pour tout le monde : il faut lire l'adversaire.
 * Une APPROCHE accompagne chaque proposition (standard, offre ferme, jouer la relation,
 * mettre en avant l'envie du joueur / le projet, rencontrer le joueur sans l'agent).
 * La réponse est détaillée point par point, avec la contre-proposition complète de l'autre
 * partie, que l'on peut accepter telle quelle.
 */
import { clamp, hashSeed } from '../core/rng.js';
import { overall } from '../engine/ratings.js';
import { playerValue, money } from './economy.js';
import { clubById, userClub, clubPlayers } from './state.js';
import { relGet } from './relations.js';
import { finHealth } from './owners.js';
import { PROMISE_ROLES, expectedGoals } from './transfers.js';

const r25 = (v) => Math.round(v / 25000) * 25000;
const r100 = (v) => Math.round(v / 100) * 100;

/* ====================== TRANSFERTS ====================== */

export const CLUB_PROFILES = {
  cash: { label: 'Besoin d\'argent frais', tip: 'Il veut le maximum comptant : échelonnement et bonus valent peu à ses yeux.', w: { inst: 0.72, addon: 0.25, sellon: 0.5, swap: 0.6 } },
  seller: { label: 'Club formateur, mise sur la revente', tip: 'Un gros pourcentage à la revente l\'intéresse beaucoup.', w: { inst: 0.88, addon: 0.55, sellon: 1.6, swap: 0.7 } },
  sporting: { label: 'Projet sportif avant tout', tip: 'Un bon joueur inclus dans l\'échange compte autant que l\'argent.', w: { inst: 0.9, addon: 0.6, sellon: 0.8, swap: 1.15 } },
  patient: { label: 'Club riche et patient', tip: 'Il accepte volontiers un paiement étalé et des bonus.', w: { inst: 0.97, addon: 0.75, sellon: 0.7, swap: 0.8 } },
};

/** Profil d'un club vendeur (stable, selon sa santé financière et son statut). */
export function clubProfile(state, club) {
  const h = finHealth(state, club);
  const k = hashSeed(`profil-${club.id}`) >>> 0;
  if (h < 45) return 'cash';
  if (club.rep < 74 && (club.academy ?? 3) >= 3 && k % 3 === 0) return 'seller';
  if (club.rep >= 80 && h >= 60) return 'patient';
  return ['sporting', 'seller', 'cash', 'sporting'][k % 4];
}

export const BUY_APPROACHES = {
  std: { label: 'Offre normale', desc: 'Une proposition classique.' },
  firm: { label: 'Offre ferme et définitive', desc: 'À prendre ou à laisser : le club tranche tout de suite (accord ou fin des discussions), et apprécie peu.' },
  rel: { label: 'Jouer la bonne relation', desc: 'Si les deux clubs s\'entendent bien, le vendeur fait un geste.' },
  wish: { label: 'Le joueur veut venir', desc: 'Si le joueur pousse pour partir, le vendeur est sous pression… sinon cela agace.' },
};

/** Joueurs de votre effectif que le vendeur accepterait dans l'échange. */
export function swapCandidates(state, seller) {
  const uc = userClub(state);
  const theirs = clubPlayers(state, seller).map(overall).sort((a, b) => b - a);
  const bar = theirs[16] ?? 60;
  return clubPlayers(state, uc).filter((p) => !p.onLoanFrom && overall(p) >= bar - 2 && p.age <= 31)
    .sort((a, b) => overall(b) - overall(a)).slice(0, 12);
}

/** Valeur d'une offre pour le vendeur, avec le détail. bid : { fee, plan, addon, sellOn, swapId } */
export function valueBid(state, d, bid) {
  const c = clubById(state, d.from);
  const prof = CLUB_PROFILES[d.profile || (d.profile = clubProfile(state, c))];
  const p = state.players[d.pid];
  const notes = [];
  const instShare = bid.plan === 'inst3' ? 0.6 : bid.plan === 'inst' ? 0.6 : 0;
  const up = bid.fee * (1 - instShare);
  let v = up + bid.fee * instShare * prof.w.inst * (bid.plan === 'inst3' ? 0.95 : 1);
  if (instShare) notes.push({ k: 'Échelonnement', ok: prof.w.inst >= 0.9 ? 1 : prof.w.inst >= 0.8 ? 0 : -1, t: prof.w.inst >= 0.9 ? 'accepté sans problème' : 'il préfère être payé tout de suite' });
  if (bid.addon) { v += bid.addon * prof.w.addon; notes.push({ k: 'Bonus', ok: prof.w.addon >= 0.6 ? 1 : 0, t: prof.w.addon >= 0.6 ? 'apprécié' : 'peu de valeur à ses yeux' }); }
  if (bid.sellOn) {
    const resale = playerValue(p) * (p.age <= 23 ? 1.6 : p.age <= 27 ? 1.0 : 0.4);
    v += resale * bid.sellOn * prof.w.sellon;
    notes.push({ k: 'Revente', ok: prof.w.sellon >= 1 ? 1 : 0, t: prof.w.sellon >= 1 ? 'très intéressé' : 'utile' });
  }
  if (bid.swapId) {
    const q = state.players[bid.swapId];
    if (q) { v += playerValue(q) * prof.w.swap; notes.push({ k: `Échange (${q.name})`, ok: prof.w.swap >= 1 ? 1 : 0, t: prof.w.swap >= 1 ? 'il le veut vraiment' : 'il l\'accepte, sans plus' }); }
  }
  return { v, notes, prof };
}

/** Réponse du vendeur (accept | counter | reject | end) avec contre-paquet. */
export function respondBid(state, d, bid, approach = 'std') {
  const neg = d.neg;
  const c = clubById(state, d.from);
  const p = state.players[d.pid];
  let min = neg.min;
  const extra = [];
  if (approach === 'rel') {
    const rel = relGet(state, c.id, userClub(state).id);
    if (rel > 15) { min *= 0.94; extra.push({ k: 'Relation', ok: 1, t: 'les bons rapports entre les clubs aident' }); }
    else { neg.patience--; extra.push({ k: 'Relation', ok: -1, t: 'les clubs ne sont pas si proches' }); }
  }
  if (approach === 'wish') {
    if (p.requested || p.listed || (d.dec?.score ?? 0) >= 35) { min *= 0.92; extra.push({ k: 'Envie du joueur', ok: 1, t: 'le joueur pousse pour partir : le club cède un peu' }); }
    else { neg.patience--; extra.push({ k: 'Envie du joueur', ok: -1, t: 'le club n\'apprécie pas qu\'on monte son joueur contre lui' }); }
  }
  const { v, notes } = valueBid(state, d, bid);
  const all = [...extra, ...notes];
  neg.history.push(v);
  const ratio = v / min;
  if (ratio >= 1) return { kind: 'accept', notes: all };
  if (approach === 'firm') { neg.status = 'closed'; return { kind: 'end', notes: [...all, { k: 'Offre ferme', ok: -1, t: 'refusée : le club met fin aux discussions' }] }; }
  neg.patience -= ratio < 0.75 ? 2 : 1;
  if (neg.patience <= 0) return { kind: 'end', notes: all };
  // Contre-paquet : on garde la structure de l'offre et on augmente la partie que le club préfère.
  const prof = CLUB_PROFILES[d.profile];
  const gap = (min - v) * 1.03;
  const cp = { ...bid };
  if (prof === CLUB_PROFILES.seller && !bid.sellOn) { cp.sellOn = 0.15; }
  const gapLeft = Math.max(0, min * 1.02 - valueBid(state, d, cp).v);
  cp.fee = r25(bid.fee + (bid.plan ? gapLeft / (0.4 + 0.6 * prof.w.inst) : gapLeft));
  if (prof === CLUB_PROFILES.cash && bid.plan) { cp.plan = 'cash'; cp.fee = r25(Math.max(cp.fee * 0.97, bid.fee + gap)); }
  if (ratio < 0.75) return { kind: 'reject', notes: [...all, { k: 'Montant', ok: -1, t: 'offre jugée très loin du compte' }], counter: cp };
  return { kind: 'counter', notes: [...all, { k: 'Montant', ok: 0, t: `il faut encore environ ${money(r25(gap))}` }], counter: cp };
}

/* ====================== CONTRATS ====================== */

export const CONTRACT_APPROACHES = {
  std: { label: 'Via l\'agent', desc: 'Négociation classique avec son agent.' },
  meet: { label: 'Rencontrer le joueur', desc: 'Vous lui présentez le projet en personne. S\'il a très envie de venir, il pousse son agent à baisser ses exigences (une fois).' },
  firm: { label: 'Dernière offre', desc: 'Pas de contre-proposition possible : il signe ou part.' },
};

/** Priorités du joueur et de son agent (stables). */
export function contractPrefs(p, dem) {
  const h = hashSeed(`prefs-${p.id}`) >>> 0;
  const money_ = 0.6 + (h % 9) / 10;           // 0.6 … 1.4
  const security = p.age >= 30 ? 1.3 : p.age <= 23 ? 0.7 : 0.95 + ((h >> 4) % 5) / 10;
  const greedAgent = dem.agent ? (dem.agent.label === 'agressif' ? 1.5 : dem.agent.label === 'conciliant' ? 0.6 : 1) : 0.8;
  const wantYears = p.age >= 32 ? 2 : p.age >= 29 ? 3 : p.age <= 22 ? 4 : 4 + ((h >> 8) % 2);
  return { money: money_, security, greedAgent, wantYears, ambition: 1 + ((h >> 12) % 5) / 4 };
}

export const defaultTerms = (p, dem, renew) => ({ wage: r100(dem.wage * 0.92), years: renew ? 3 : p.age >= 30 ? 2 : 4, role: p.promise?.role || 'rotation',
  bonus: 0, loyalty: 0, appFee: 0, goalBonus: 0, csBonus: 0, rise: 0, clause: 0, relCut: 0, agentFee: Math.round(dem.wage * 8 / 1000) * 1000 });

/**
 * Évaluation d'un contrat : chaque élément est converti en équivalent « salaire hebdomadaire »
 * selon les priorités du joueur, puis comparé à ses attentes. Retourne aussi le détail.
 */
export function valueContract(state, d, t) {
  const p = state.players[d.pid];
  const dem = d.dem, P = d.prefs || (d.prefs = contractPrefs(p, dem));
  const notes = [];
  const role = PROMISE_ROLES[t.role || 'rotation'];
  const want = dem.wage * role.wage;
  let v = t.wage;
  const wk = 52 * t.years;
  if (t.bonus) v += (t.bonus / wk) * 1.2 * P.money;
  if (t.loyalty) v += (t.loyalty / wk) * 0.7 * P.security;
  if (t.appFee) v += t.appFee * 0.75 * 0.9;                       // ~0,75 match par semaine
  if (t.goalBonus) v += t.goalBonus * expectedGoals(p);
  if (t.csBonus) v += t.csBonus * (['GB', 'DC', 'DG', 'DD'].includes(p.pos) ? 0.25 : 0.05);
  if (t.rise) v += t.wage * t.rise * (t.years - 1) / 2 * P.money;
  if (t.relCut) { v -= t.wage * t.relCut * 0.25; notes.push({ k: 'Baisse en cas de relégation', ok: -1, t: 'il n\'aime pas du tout' }); }
  // Durée.
  const dy = t.years - P.wantYears;
  if (dy) { const k = dy > 0 ? (p.age >= 30 ? 0.04 : -0.02) : -0.035 * P.security; v *= 1 + k * Math.abs(dy); }
  notes.push({ k: 'Durée', ok: dy === 0 ? 1 : Math.abs(dy) === 1 ? 0 : -1, t: dy === 0 ? 'ce qu\'il voulait' : dy > 0 ? (p.age >= 30 ? 'la sécurité lui plaît' : 'un peu long à son goût') : `il voudrait ${P.wantYears} ans` });
  // Clause libératoire : liberté pour les ambitieux.
  const val = playerValue(p);
  if (t.clause) { const low = t.clause < val * 1.6; v *= 1 + (low ? 0.06 : 0.025) * P.ambition; notes.push({ k: 'Clause libératoire', ok: 1, t: low ? 'une porte de sortie appréciée' : 'appréciée' }); }
  // Statut.
  notes.push({ k: 'Statut', ok: ['star', 'key'].includes(t.role) ? 1 : t.role === 'backup' ? -1 : 0, t: role.label });
  // Agent : sa commission.
  const agentWant = dem.wage * 8 * P.greedAgent;
  const agentRatio = (t.agentFee || 0) / Math.max(1, agentWant);
  if (dem.agent || agentWant > 0) {
    if (agentRatio < 0.6) { v *= 0.93; notes.push({ k: 'Commission de l\'agent', ok: -1, t: `l'agent réclame ~${money(Math.round(agentWant / 1000) * 1000)}` }); }
    else if (agentRatio < 0.95) { v *= 0.98; notes.push({ k: 'Commission de l\'agent', ok: 0, t: 'un peu juste pour l\'agent' }); }
    else notes.push({ k: 'Commission de l\'agent', ok: 1, t: 'l\'agent est satisfait' });
  }
  if (dem.minBonus && (t.bonus || 0) < dem.minBonus) { v *= 0.95; notes.push({ k: 'Prime à la signature', ok: -1, t: `exigée : au moins ${money(dem.minBonus)}` }); }
  else if (t.bonus) notes.push({ k: 'Prime à la signature', ok: 1, t: 'appréciée' });
  const ratio = v / want;
  notes.unshift({ k: 'Salaire et primes', ok: ratio >= 1 ? 1 : ratio >= 0.93 ? 0 : -1, t: ratio >= 1 ? 'satisfaisant' : ratio >= 0.93 ? 'un peu juste' : 'loin de ses attentes' });
  return { ratio, notes, want, agentWant };
}

/** Réponse au contrat : accept | counter | reject | end, avec contre-paquet de l'agent. */
export function respondContract(state, d, t, approach = 'std') {
  const p = state.players[d.pid];
  const extra = [];
  if (approach === 'meet') {
    if (d.met) extra.push({ k: 'Rencontre', ok: 0, t: 'vous l\'avez déjà rencontré' });
    else if ((d.dec?.score ?? 20) >= 25 || d.kind === 'renew' && (p.morale ?? 60) >= 60) {
      d.met = true; d.dem.wage = r100(d.dem.wage * 0.94); d.dem.tries++;
      extra.push({ k: 'Rencontre', ok: 1, t: 'il est conquis par le projet et calme son agent' });
    } else { d.met = true; d.dem.tries--; extra.push({ k: 'Rencontre', ok: -1, t: 'l\'agent n\'a pas apprécié d\'être contourné' }); }
  }
  const { ratio, notes, want, agentWant } = valueContract(state, d, t);
  const all = [...extra, ...notes];
  if (ratio >= 1) return { kind: 'accept', notes: all };
  if (approach === 'firm') return { kind: 'end', notes: [...all, { k: 'Dernière offre', ok: -1, t: 'refusée' }] };
  d.dem.tries--;
  if (d.dem.tries <= 0) return { kind: 'end', notes: all };
  // Contre-paquet de l'agent : sa durée, sa commission, puis le salaire nécessaire.
  const P = d.prefs;
  const cp = { ...t, years: P.wantYears, agentFee: Math.max(t.agentFee || 0, Math.round(agentWant / 1000) * 1000), relCut: 0 };
  if (d.dem.minBonus) cp.bonus = Math.max(cp.bonus || 0, d.dem.minBonus);
  for (let i = 0; i < 30 && valueContract(state, d, cp).ratio < 1.005; i++) cp.wage = r100(cp.wage * 1.025 + 100);
  if (ratio < 0.85) return { kind: 'reject', notes: all, counter: cp };
  return { kind: 'counter', notes: all, counter: cp, want };
}
