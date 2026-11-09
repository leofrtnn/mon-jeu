/**
 * PROPRIÉTAIRES (rachats, politique, rencontre avec le nouveau patron)
 * et SANTÉ FINANCIÈRE (crise, soldes, retrait de points, faillite).
 */
import { isHumanClub, humanOfClub, withHuman } from './humans.js';
import { COUNTRIES } from '../data/world.js';
import { clamp, createRng, hashSeed } from '../core/rng.js';
import { BAL } from '../data/balance.js';
import { randomName } from '../data/names.js';
import { userClub, clubById, clubPlayers, pushMessage } from './state.js';
import { wageBill, money, sponsorIncome, matchdayRevenue } from './economy.js';
import { overall } from '../engine/ratings.js';
import { news } from './managers.js';
import { pushDecision, registerDecision } from './inbox.js';
import { relAdd } from './relations.js';
import { windowInfo } from './dates.js';
import { meetingOptions } from './preseason.js';
import { removeFromClubPublic as removeFromClub, addToClubPublic as addToClub } from './transfers.js';

const O = BAL.owners;
const C = BAL.crisis;
const TYPES = Object.keys(O.types);

export const ownerType = (club) => O.types[club.owner?.type] || O.types.manager;

function pickType(rng, rep, avoid = null) {
  const w = TYPES.map((t) => (t === avoid ? 0 : O.types[t].weight * (t === 'ambitious' || t === 'patron' ? 0.6 + rep / 100 : t === 'local' ? 1.6 - rep / 100 : 1)));
  return TYPES[rng.weightedIndex(w)];
}

function makeOwner(state, rng, club, avoid) {
  const { first, last } = randomName(rng, rng.pick(Object.keys(COUNTRIES)));
  const type = pickType(rng, club.rep, avoid);
  let group = null;
  if (rng.chance(O.multiClub) && (type === 'ambitious' || type === 'speculator')) {
    const other = rng.pick(state.clubs.filter((c) => c.id !== club.id && c.owner && c.country !== club.country));
    if (other) { other.owner.group = other.owner.group || `G${other.id}`; group = other.owner.group; }
  }
  return { type, name: `${first} ${last}`, group, since: state.season };
}

export function ensureOwners(state) {
  const rng = createRng(hashSeed(`${state.seed}-owners`));
  for (const c of state.clubs) {
    c.owner ??= makeOwner(state, rng, c);
    c.atmosphere ??= clamp(Math.round(40 + c.rep * 0.35), 30, 85);
    c.image ??= clamp(Math.round(30 + c.rep * 0.4), 25, 80);
    c.ticket ??= 'normal';
  }
}

/* ---------------- Santé financière ---------------- */

const weekly = (state, c) => Math.max(1, wageBill(clubPlayers(state, c)));
/** Santé financière (0-100) : trésorerie en semaines de salaires + équilibre d'exploitation. */
export function finHealth(state, c) {
  const w = weekly(state, c);
  const income = sponsorIncome(c) + matchdayRevenue(c, null, 0.5).revenue * 19 / 52;
  const weeks = clamp(c.budget / w, C.weeksClamp[0], C.weeksClamp[1]);
  const flow = clamp((income - w) / w - C.flowRef, -0.6, 0.6);
  return clamp(Math.round(50 + weeks * C.weeksScale + flow * C.flowWeight), 0, 100);
}

/** Une journée : crises, soldes, retrait de points. */
export function crisisDaily(state, rng) {
  const uc = userClub(state);
  const wi = windowInfo(state);
  for (const c of state.clubs) {
    // Train de vie du propriétaire (clubs IA) : investissements, dividendes…
    if (c.id !== uc.id && c.budget > 0) c.budget -= Math.round(c.budget * (ownerType(c).drain || 0));
    const h = finHealth(state, c);
    const was = !!c.crisis;
    c.crisis = h < C.threshold;
    if (c.crisis && !was) {
      news(state, 'crisis', `${c.name} plonge dans la crise financière.`);
      if (c.id !== uc.id) {
        const deals = clubPlayers(state, c).filter((p) => !p.onLoanFrom).sort((a, b) => overall(b) - overall(a)).slice(0, 3);
        pushMessage(state, { prio: 2, icon: '💸', title: `${c.name} cherche à vendre`, text: `Bonnes affaires : ${deals.map((p) => `${p.name} (${overall(p)})`).join(', ')}.`, action: { type: 'crisis', clubId: c.id } });
      } else {
        pushMessage(state, { prio: 1, icon: '💸', title: 'Votre club est en crise financière', text: 'Les clubs vont tenter d\'acheter vos joueurs au rabais. Le board exige des ventes.' });
        state.board.parts.finances = clamp(state.board.parts.finances - 10, 0, 100);
      }
    }
    if (h < C.bankrupt && c.penalized !== state.season) {
      c.penalized = state.season;
      const row = state.tables?.[c.div]?.[c.id];
      if (row) row.pts -= C.pointsPenalty;
      news(state, 'crisis', `${c.name} en cessation de paiements : ${C.pointsPenalty} points de pénalité.`);
      pushMessage(state, { prio: c.id === uc.id ? 1 : 3, icon: '⚖', title: `${c.name} : -${C.pointsPenalty} points`, text: 'Sanction de la commission de contrôle financier.' });
      if (c.id === uc.id) state.board.parts.results = clamp(state.board.parts.results - 8, 0, 100);
    }
    // Les clubs IA en crise vendent pendant le mercato (davantage le dernier jour).
    if (c.crisis && c.id !== uc.id && wi.open && rng.chance(wi.deadline ? 0.7 : 0.2)) crisisSale(state, c, rng);
  }
}

/** Vente au rabais d'un club IA en crise vers un club IA solvable. */
export function crisisSale(state, c, rng) {
  const p = clubPlayers(state, c).filter((x) => !x.onLoanFrom).sort((a, b) => overall(b) - overall(a))[rng.int(0, 3)];
  if (!p) return null;
  const price = Math.round((p.value || 0) * C.discount / 25000) * 25000;
  const buyers = state.clubs.filter((b) => b.id !== c.id && !isHumanClub(state, b.id) && b.budget > price * 1.3 && b.rep >= c.rep - 10 && b.playerIds.length < 28);
  if (!buyers.length) return null;
  const b = rng.pick(buyers);
  removeFromClub(state, p); addToClub(state, p, b);
  b.budget -= price; c.budget += price;
  relAdd(state, c.id, b.id, 3);
  news(state, 'transfer', `Vente forcée : ${p.first} ${p.last} quitte ${c.name} (en crise) pour ${b.name} · ${money(price)}.`, { pid: p.id });
  return { p, b, price };
}

/* ---------------- Rachats ---------------- */

const PRESS_REACT = {
  ambitious: ['La presse salue « un projet XXL ».', 'Les éditorialistes parlent d\'un « nouveau géant en devenir ».'],
  patron: ['Soulagement général : « enfin un mécène ».', 'La presse évoque « un ange gardien ».'],
  manager: ['La presse attend de voir : « un gestionnaire, pas un rêveur ».', '« Rigueur et prudence », titre la presse locale.'],
  speculator: ['Inquiétude : « ils veulent revendre au plus offrant ».', 'La presse craint un « club-marchandise ».'],
  local: ['Liesse : « un enfant du pays aux commandes ».', 'La presse locale célèbre un rachat « du cœur ».'],
};
const FANS_REACT = { ambitious: 'Les supporters rêvent grand.', patron: 'Les supporters applaudissent.', manager: 'Les supporters restent prudents.', speculator: 'Banderoles hostiles devant le stade.', local: 'Les supporters exultent.' };

/** Fin de saison : quelques clubs changent de mains. Retourne la liste des rachats. */
export function takeovers(state, rng) {
  const out = [];
  for (const c of state.clubs) {
    const distress = finHealth(state, c) < 30;
    if (!rng.chance(O.takeoverRate * (distress ? O.distressMult : 1))) continue;
    const old = c.owner?.type;
    c.owner = makeOwner(state, rng, c, old);
    const t = ownerType(c);
    const ref = Math.pow(c.rep / 10, 2.4) * 100000;
    const inj = Math.round(ref * O.injection * t.budget / 100000) * 100000;
    c.budget += inj;
    c.atmosphere = clamp((c.atmosphere ?? 60) + t.fans, 0, 100);
    c.crisis = false;
    if (c.owner.group) for (const o of state.clubs) if (o !== c && o.owner?.group === c.owner.group) relAdd(state, c.id, o.id, 20);
    if (c.owner.type === 'speculator' && !isHumanClub(state, c.id)) {
      for (const p of clubPlayers(state, c).sort((a, b) => overall(b) - overall(a)).slice(0, 2)) p.listed = true;
    }
    news(state, 'owner', `${c.name} change de propriétaire : ${c.owner.name} (${t.label.toLowerCase()}) rachète le club.`);
    out.push(c.id);
    const hu = humanOfClub(state, c.id);
    if (hu !== undefined) withHuman(state, hu, () => userTakeover(state, rng, inj));
  }
  return out;
}

function userTakeover(state, rng, inj) {
  const c = userClub(state);
  const t = ownerType(c);
  pushMessage(state, { prio: 1, icon: '🏛', title: `Rachat : ${c.owner.name} devient propriétaire`, text: `Profil ${t.label.toLowerCase()} · apport ${money(inj)}. ${FANS_REACT[c.owner.type]} ${rng.pick(PRESS_REACT[c.owner.type])}` });
  const last = state.history?.[state.history.length - 1];
  const missed = last && state.objectives?.league && last.pos > state.objectives.league.target + 2;
  if (state.coach.rep < O.sackRepThreshold && missed && rng.chance(O.sackChance)) {
    state.sacked = { season: state.season, day: state.day, club: c.name, owner: true };
    pushMessage(state, { prio: 1, icon: '🚪', title: 'Le nouveau propriétaire vous remercie', text: `${c.owner.name} veut son propre entraîneur.` });
    return;
  }
  state.life.ownerMeeting = { season: state.season, freeHand: state.coach.rep >= O.freeHandRep };
  pushDecision(state, { kind: 'owner', icon: '🏛', title: `Rencontre avec ${c.owner.name}`, text: state.coach.rep >= O.freeHandRep ? 'Il vous accorde carte blanche… à condition de le convaincre.' : 'Votre avenir dépend de ce premier rendez-vous.',
    choices: [{ key: 'ambition', label: 'Discours ambitieux' }, { key: 'project', label: 'Un projet sur la durée' }], days: 3 });
}

registerDecision('owner', {
  resolve(state, data, key) {
    const b = state.board;
    const opts = meetingOptions(state);
    if (key === 'ambition') {
      b.parts.results = clamp(b.parts.results + 8, 0, 100);
      if (opts.up) state.objectives.league = { ...state.objectives.league, target: opts.up[0], label: opts.up[1] };
      b.transferBudget = Math.round(b.transferBudget * 1.15 / 50000) * 50000;
      return { msg: `Le propriétaire adhère. Nouvel objectif : ${state.objectives.league.label}. Budget transferts +15 %.`, effects: { board: 8 } };
    }
    b.parts.results = clamp(b.parts.results + 3, 0, 100);
    b.patience = (b.patience ?? 1) * 1.15;
    return { msg: 'Le propriétaire apprécie votre vision. Il sera plus patient.', effects: { board: 3 } };
  },
  expire(state) { state.board.parts.results = clamp(state.board.parts.results - 5, 0, 100); return 'Rendez-vous manqué : mauvaise première impression.'; },
});

/** Début de saison : enveloppes et objectifs selon le propriétaire du club de l'utilisateur. */
export function ownerSeasonStart(state) {
  const c = userClub(state);
  const t = ownerType(c);
  const b = state.board;
  b.transferBudget = Math.round(b.transferBudget * t.budget / 50000) * 50000;
  b.wageBudget = Math.round(b.wageBudget * t.wage / 1000) * 1000;
  b.patience = t.patience;
  if (state.life.ownerMeeting?.season === state.season && state.life.ownerMeeting.freeHand) b.transferBudget = Math.round(b.transferBudget * 1.25 / 50000) * 50000;
  if (t.target && state.objectives?.league) {
    const opts = meetingOptions(state);
    const o = t.target < 0 ? opts.up : opts.down;
    if (o) state.objectives.league = { ...state.objectives.league, target: o[0], label: o[1] };
  }
}

/** Spéculateur : il veut vendre la star (une fois par mercato). */
export function speculatorPush(state) {
  const c = userClub(state);
  if (c.owner?.type !== 'speculator') return;
  const star = clubPlayers(state, c).filter((p) => !p.onLoanFrom && !p.listed).sort((a, b) => overall(b) - overall(a))[0];
  if (!star) return;
  pushDecision(state, { kind: 'sellstar', icon: '💰', title: `${c.owner.name} veut vendre ${star.name}`, text: 'Le propriétaire veut encaisser une plus-value ce mercato.',
    data: { pid: star.id }, choices: [{ key: 'ok', label: 'Mettre sur la liste' }, { key: 'no', label: 'Refuser' }], days: 3 });
}

registerDecision('sellstar', {
  resolve(state, { pid }, key) {
    const p = state.players[pid];
    if (key === 'ok' && p) { p.listed = true; state.board.parts.finances = clamp(state.board.parts.finances + 6, 0, 100); return { msg: `${p.name} est placé sur la liste.`, effects: { board: 3 } }; }
    state.board.parts.results = clamp(state.board.parts.results - 6, 0, 100);
    return { msg: 'Le propriétaire n\'apprécie pas d\'être contredit.', effects: { board: -6 } };
  },
  expire(state, { pid }) { const p = state.players[pid]; if (p) p.listed = true; return 'Le propriétaire a tranché : le joueur est sur la liste.'; },
});

/** Budget de référence d'un club IA à l'intersaison (selon son propriétaire, dettes reportées). */
export function aiSeasonBudget(club, lvl1) {
  const base = (lvl1 ? Math.pow(club.rep / 10, 2.6) * 120000 : Math.pow(club.rep / 10, 2.2) * 60000) * ownerType(club).budget;
  const carry = club.budget >= 0 ? club.budget * 0.4 : club.budget * C.negativeCarry;
  return Math.round((carry + base) / 100000) * 100000;
}
