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
  missionsDaily(state);
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
  // Rumeurs et demandes de départ : gérées par agents.js et people.js (boîte de réception).
  const squad = clubPlayers(state, uc).filter((p) => !p.onLoanFrom);
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

/* ---------------- Missions de recrutement ---------------- */

export const REGIONS = {
  FRA: 'France', IBE: 'Ibérie', ALB: 'Albion', ALL: 'Monde (joueurs libres inclus)',
};
export const MISSION_DAYS = 6;

/** Lance une mission pour un recruteur : région, poste (facultatif), âge maximum (facultatif). */
export function startMission(state, scoutId, { region = 'ALL', pos = null, maxAge = null }) {
  const uc = userClub(state);
  const sc = (uc.staffMembers || []).find((m) => m.id === scoutId && m.role === 'scout');
  if (!sc) return { ok: false, msg: 'Recruteur introuvable.' };
  state.missions = state.missions || {};
  state.missions[scoutId] = { region, pos, maxAge, daysLeft: MISSION_DAYS, found: [] };
  return { ok: true, msg: `${sc.first} ${sc.last} part en mission : ${REGIONS[region]}${pos ? ` · ${pos}` : ''}${maxAge ? ` · ≤ ${maxAge} ans` : ''}.` };
}

/** Note de recommandation : niveau estimé, potentiel des jeunes, âge. */
function recoScore(state, p) {
  const e = estimate(state, p);
  const o = (e.ovr[0] + e.ovr[1]) / 2, pot = (e.pot[0] + e.pot[1]) / 2;
  return o + (p.age <= 23 ? (pot - o) * 0.5 : 0) - Math.max(0, p.age - 29) * 1.5;
}

/** Avancement quotidien des missions (appelé par scoutDaily). */
export function missionsDaily(state) {
  const uc = userClub(state);
  const eff = staffEffects(uc);
  const ms = state.missions || {};
  for (const [sid, mi] of Object.entries(ms)) {
    const sc = (uc.staffMembers || []).find((m) => m.id === sid);
    if (!sc) { delete ms[sid]; continue; }
    // Joueurs ciblés par la mission.
    const pool = [];
    for (const c of state.clubs) {
      if (c.id === uc.id || (mi.region !== 'ALL' && c.country !== mi.region)) continue;
      for (const id of c.playerIds) pool.push(state.players[id]);
    }
    if (mi.region === 'ALL') for (const id of state.freeAgents) pool.push(state.players[id]);
    const cands = pool.filter((p) => p && (!mi.pos || p.pos === mi.pos) && (!mi.maxAge || p.age <= mi.maxAge) && !mi.found.includes(p.id));
    // Le recruteur repère d'abord les profils prometteurs (son flair dépend de sa note).
    cands.sort((a, b) => (overall(b) + (b.pot - overall(b)) * 0.4 + (hashSeed(`${sid}-${b.id}`) % 10) * (20 - sc.rating) / 10)
      - (overall(a) + (a.pot - overall(a)) * 0.4 + (hashSeed(`${sid}-${a.id}`) % 10) * (20 - sc.rating) / 10));
    for (const p of cands.slice(0, 2 + Math.floor(sc.rating / 8))) {
      state.scout[p.id] = clamp(Math.max(state.scout[p.id] || 0, knowledge(state, p)) + eff.scoutGain, 0, 100);
      mi.found.push(p.id);
    }
    mi.daysLeft--;
    if (mi.daysLeft <= 0) {
      const best = mi.found.map((id) => state.players[id]).filter(Boolean)
        .map((p) => ({ pid: p.id, score: Math.round(recoScore(state, p)) })).sort((a, b) => b.score - a.score).slice(0, 6);
      state.scoutReports = [...best.map((r) => ({ ...r, by: `${sc.first} ${sc.last}`, region: mi.region, day: state.day, season: state.season })), ...(state.scoutReports || [])].slice(0, 40);
      pushMessage(state, { prio: 2, icon: '🔭', title: `Mission terminée : ${REGIONS[mi.region]}`, text: `${sc.first} ${sc.last} recommande ${best.length} joueur(s). Voir Club → Mercato → Recrutement.`, action: { type: 'scouting' } });
      delete ms[sid];
    }
  }
}
