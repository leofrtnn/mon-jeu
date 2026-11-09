/**
 * SCOUTING & VIE DU MERCATO
 * - Brouillard : les attributs des joueurs extérieurs sont connus avec une marge
 *   d'erreur qui dépend du recruteur et des observations.
 * - Rumeurs, demandes de départ (agents), clauses libératoires levées par l'IA.
 */
import { hashSeed, clamp } from '../core/rng.js';
import { overall } from '../engine/ratings.js';
import { ATTRS } from '../data/constants.js';
import { userClub, clubById, clubPlayers, pushMessage } from './state.js';
import { staffEffects } from './career.js';
import { money, playerValue } from './economy.js';
import { windowOpen, logFinance, removeFromClubPublic, addToClubPublic } from './transfers.js';
import { creditSale } from './board.js';

/** Connaissance (0-100) d'un joueur par le club de l'utilisateur. */
export function knowledge(state, p) {
  const uc = userClub(state);
  if (!uc || p.clubId === uc.id || uc.youthIds?.includes(p.id) || p.onLoanFrom === uc.id) return 100;
  const base = staffEffects(uc).scoutBase + (p.clubId && clubById(state, p.clubId)?.div === uc.div ? 10 : 0);
  return clamp(Math.max(base, state.scout?.[p.id] || 0), 0, 100);
}

/** Écart d'estimation (en points) selon la connaissance. */
export const errorFor = (k) => Math.round((100 - k) / 100 * 14);

/** Valeur estimée d'une grandeur : [bas, haut] décalés de façon stable (graine du joueur). */
function est(state, p, key, v, k) {
  const err = errorFor(k);
  if (err <= 1) return [v, v];
  const h = (hashSeed(`${state.seed}-${p.id}-${key}`) % 1000) / 1000 - 0.5;
  const c = Math.round(v + h * err);
  return [clamp(c - Math.ceil(err / 2), 1, 99), clamp(c + Math.ceil(err / 2), 1, 99)];
}

/** Estimation complète : note, attributs, potentiel. */
export function estimate(state, p) {
  const k = knowledge(state, p);
  const o = overall(p);
  const attrs = {};
  for (const a of ATTRS) attrs[a] = est(state, p, a, p.attrs[a], k);
  return { k, ovr: est(state, p, 'ovr', o, k), pot: est(state, p, 'pot', p.pot, Math.max(0, k - 15)), attrs, exact: errorFor(k) <= 1 };
}

/** Affichage "68-74" ou "71". */
export const rangeLabel = ([a, b]) => (a === b ? `${a}` : `${a}-${b}`);
/** Valeur centrale (tri du marché). */
export const mid = ([a, b]) => (a + b) / 2;

/** Ajoute un joueur à la liste d'observation (3 rapports par journée). */
export function observe(state, pid) {
  state.scoutQueue = state.scoutQueue || [];
  if (state.scoutQueue.includes(pid)) return { ok: false, msg: 'Déjà en observation.' };
  if (state.scoutQueue.length >= 6) return { ok: false, msg: 'Liste d\'observation pleine (6).' };
  state.scoutQueue.push(pid);
  return { ok: true, msg: 'Le recruteur part l\'observer : rapport à la prochaine journée.' };
}

export function scoutDaily(state) {
  const uc = userClub(state);
  const eff = staffEffects(uc);
  const q = state.scoutQueue || [];
  const done = q.splice(0, eff.scoutReports || 1);
  for (const pid of done) {
    const p = state.players[pid];
    if (!p) continue;
    state.scout[pid] = clamp(knowledge(state, p) + eff.scoutGain, 0, 100);
    const e = estimate(state, p);
    pushMessage(state, { prio: 3, icon: '🔭', title: `Rapport : ${p.name}`, text: `Note ${rangeLabel(e.ovr)} · potentiel ${rangeLabel(e.pot)} · ${e.k}% connu`, action: { type: 'player', pid } });
  }
}

/** Les adversaires affrontés sont mieux connus. */
export function seeInMatch(state, m, oppSide) {
  for (const mp of [...m.teams[oppSide].onPitch, ...m.teams[oppSide].out]) {
    if (!mp || mp.minIn == null) continue;
    state.scout[mp.id] = clamp(Math.max(state.scout[mp.id] || 0, knowledge(state, mp.p)) + 15, 0, 100);
  }
}

/* ---------------- Vie du mercato ---------------- */

export function marketEvents(state, rng) {
  const uc = userClub(state);
  const open = windowOpen(state);
  // Rumeurs.
  if (rng.chance(open ? 0.45 : 0.15)) {
    const clubs = state.clubs.filter((c) => c.id !== uc.id);
    const from = rng.pick(clubs);
    const star = clubPlayers(state, from).sort((a, b) => overall(b) - overall(a))[rng.int(0, 2)];
    const to = rng.pick(clubs.filter((c) => c.rep > from.rep && c.id !== from.id)) || rng.pick(clubs);
    if (star && to && to.id !== from.id) {
      pushMessage(state, { prio: 3, icon: '🗞', title: 'Rumeur', text: `${star.name} (${from.short}) intéresserait ${to.name}.`, action: { type: 'player', pid: star.id } });
    }
  }
  const squad = clubPlayers(state, uc).filter((p) => !p.onLoanFrom);
  // Agents : un joueur frustré demande à partir.
  for (const p of squad) {
    if (p.requested || p.morale >= 28 || overall(p) < 60) continue;
    if (rng.chance(0.12)) {
      p.requested = true; p.listed = true;
      pushMessage(state, { prio: 1, icon: '🧑‍💼', title: `${p.name} demande à partir`, text: 'Son agent réclame un transfert. Il est placé sur la liste.', action: { type: 'player', pid: p.id } });
    }
  }
  // Clauses libératoires : un club riche peut lever la clause d'un de vos joueurs.
  if (open) {
    for (const p of squad) {
      if (!p.clause) continue;
      const buyers = state.clubs.filter((c) => c.id !== uc.id && c.budget > p.clause && c.rep >= uc.rep - 5);
      if (!buyers.length || p.clause > playerValue(p) * 1.6 || !rng.chance(0.05)) continue;
      const b = rng.pick(buyers);
      removeFromClubPublic(state, p);
      addToClubPublic(state, p, b);
      b.budget -= p.clause; uc.budget += p.clause;
      creditSale(state, p.clause);
      logFinance(state, p.clause, `Clause levée : ${p.name}`);
      pushMessage(state, { prio: 1, icon: '💥', title: `${b.name} lève la clause de ${p.name}`, text: `${money(p.clause)} encaissés. Il part immédiatement.` });
      p.clause = 0;
    }
  }
}
