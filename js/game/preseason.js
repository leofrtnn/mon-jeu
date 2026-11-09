/**
 * PRÉPARATION ESTIVALE : réunion avec le CA (négociation des objectifs, du budget,
 * de l'identité) et matchs amicaux de préparation.
 */
import { clamp, hashSeed } from '../core/rng.js';
import { DIVISIONS } from '../data/world.js';
import { userClub, clubById, gameRng, pushMessage } from './state.js';
import { matchdayRevenue } from './economy.js';
import { allPlayers } from '../engine/match.js';
import { IDENTITIES } from './board.js';
import { logFinance } from './transfers.js';

const LADDERS = { 1: [[1, 'Être champion'], [4, 'Finir dans le top 4'], [10, 'Finir dans la 1re moitié'], [15, 'Finir dans le top 15'], [17, 'Assurer le maintien']],
  2: [[1, 'Être champion de D2'], [3, 'Monter en Division 1'], [8, 'Finir dans le top 8'], [15, 'Finir dans le top 15']] };

/** Ouvre la préparation (début de carrière et chaque été). */
export function startPreseason(state) {
  const rng = gameRng(state);
  const uc = userClub(state);
  const others = state.clubs.filter((c) => c.id !== uc.id);
  const pick = (list, n) => rng.shuffle(list.slice()).slice(0, n);
  const weaker = others.filter((c) => c.rep < uc.rep - 5);
  const foreign = others.filter((c) => c.country !== uc.country);
  const big = others.filter((c) => c.rep > uc.rep + 5);
  const sugg = [...new Set([...pick(weaker, 2), ...pick(foreign, 2), ...pick(big, 2)])].slice(0, 6).map((c) => c.id);
  state.preseason = { active: true, meeting: false, friendlies: [], suggestions: sugg };
}

/** Échelle d'objectifs du championnat de l'utilisateur. */
function ladder(state) {
  const lvl = DIVISIONS[userClub(state).div].level;
  const L = LADDERS[lvl].slice();
  if (userClub(state).div !== 1 && lvl === 1) L[L.length - 1] = [15, 'Finir dans le top 15'];
  return L;
}

/** Propositions de la réunion : objectif plus ambitieux / plus modeste. */
export function meetingOptions(state) {
  const o = state.objectives.league;
  const L = ladder(state);
  const i = Math.max(0, L.findIndex(([t]) => t >= o.target));
  return { current: o, up: L[i - 1] || null, down: L[i + 1] || null, identities: Object.keys(IDENTITIES) };
}

/**
 * Conclut la réunion. choice : 'accept' | 'up' | 'down' ; identity : clé d'identité (facultatif).
 * Viser plus haut = budget +25 % ; plus bas = budget -25 % et confiance en baisse.
 */
export function concludeMeeting(state, choice, identity) {
  const b = state.board;
  const opts = meetingOptions(state);
  let msg = 'Objectifs acceptés. Le CA compte sur vous.';
  if (choice === 'up' && opts.up) {
    state.objectives.league = { ...state.objectives.league, target: opts.up[0], label: opts.up[1] };
    b.transferBudget = Math.round(b.transferBudget * 1.25 / 50000) * 50000;
    b.parts.results = clamp(b.parts.results + 5, 0, 100);
    msg = `Pari ambitieux : « ${opts.up[1]} ». Budget transferts +25 %.`;
  } else if (choice === 'down' && opts.down) {
    state.objectives.league = { ...state.objectives.league, target: opts.down[0], label: opts.down[1] };
    b.transferBudget = Math.round(b.transferBudget * 0.75 / 50000) * 50000;
    b.parts.results = clamp(b.parts.results - 6, 0, 100);
    msg = `Objectif revu à la baisse : « ${opts.down[1]} ». Budget transferts -25 %.`;
  }
  if (identity && identity !== b.identity) {
    b.identity = identity;
    b.youthTarget = identity === 'youth' ? 15 : 5;
    b.parts.style = clamp(b.parts.style - 3, 0, 100);
    state.objectives.identity = { label: `Identité : ${IDENTITIES[identity].label}`, key: identity };
    state.objectives.youth = { label: `Jeunes (≤ 21 ans) : ${b.youthTarget} % du temps de jeu`, target: b.youthTarget };
    msg += ` Identité redéfinie : ${IDENTITIES[identity].label}.`;
  }
  state.preseason.meeting = true;
  b.confidence = Math.round((b.parts.results * 0.5 + b.parts.finances * 0.15 + b.parts.youth * 0.1 + b.parts.style * 0.1 + b.parts.transfers * 0.15) * 10) / 10;
  return msg;
}

export function addFriendly(state, oppId) {
  const ps = state.preseason;
  if (ps.friendlies.length >= 3) return { ok: false, msg: '3 matchs amicaux maximum.' };
  if (ps.friendlies.some((f) => f.oppId === oppId)) return { ok: false, msg: 'Déjà programmé.' };
  const home = ps.friendlies.length % 2 === 0;
  ps.friendlies.push({ oppId, home, s: null });
  return { ok: true, msg: `Amical contre ${clubById(state, oppId).name} programmé.` };
}

/** Graine d'un amical. */
export const friendlySeed = (state, oppId) => hashSeed(`${state.seed}-${state.season}-amical-${oppId}`);

/** Effets d'un amical : forme et moral des joueurs utilisés, petite recette à domicile. */
export function applyFriendly(state, oppId, sum, m, userSide) {
  const f = state.preseason.friendlies.find((x) => x.oppId === oppId);
  if (f) f.s = sum.score;
  const diff = sum.score[userSide] - sum.score[1 - userSide];
  for (const mp of allPlayers(m.teams[userSide])) {
    if (mp.minIn == null) continue;
    const p = mp.p;
    p.form = clamp(p.form + (mp.rating >= 6.6 ? 5 : 2), 5, 95);
    p.morale = clamp(p.morale + (diff > 0 ? 3 : diff < 0 ? -1 : 1), 5, 99);
    p.fatigue = 0;
  }
  if (f?.home) {
    const uc = userClub(state);
    const { revenue } = matchdayRevenue(uc, clubById(state, oppId), 0.5, false);
    const gate = Math.round(revenue * 0.35);
    uc.budget += gate;
    logFinance(state, gate, `Recette match amical`);
  }
}

export function endPreseason(state) {
  state.preseason.active = false;
  pushMessage(state, { prio: 2, icon: '🏁', title: 'La saison commence !', text: 'Préparation terminée. Bonne chance, coach.' });
}
