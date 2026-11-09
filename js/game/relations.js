/**
 * RELATIONS ENTRE CLUBS (-100 hostilité … +100 amitié) et RIVAUX.
 * Graphe creux : seules les paires ayant interagi sont stockées ; le score revient
 * lentement vers sa base (derby négatif, même propriétaire positif, sinon 0).
 */
import { clamp, hashSeed } from '../core/rng.js';
import { BAL } from '../data/balance.js';
import { clubById, clubPlayers, pushMessage } from './state.js';
import { overall, squadStrength } from '../engine/ratings.js';
import { news } from './managers.js';
import { windowInfo } from './dates.js';

const R = BAL.relations;
const key = (a, b) => (a < b ? `${a}-${b}` : `${b}-${a}`);
const region = (c) => (c.region ??= hashSeed(`reg-${c.id}`) % 10);

let idCache = { arr: null, map: null };
const byId = (state, id) => {
  if (idCache.arr !== state.clubs || idCache.map.size !== state.clubs.length) idCache = { arr: state.clubs, map: new Map(state.clubs.map((c) => [c.id, c])) };
  return idCache.map.get(id);
};

export const isDerby = (state, a, b) => {
  const A = byId(state, a), B = byId(state, b);
  return !!A && !!B && a !== b && A.country === B.country && region(A) === region(B);
};
const sameOwner = (state, a, b) => {
  const A = byId(state, a)?.owner, B = byId(state, b)?.owner;
  return !!A?.group && A.group === B?.group;
};
export const relBase = (state, a, b) => (isDerby(state, a, b) ? R.derbyBase : sameOwner(state, a, b) ? R.sameOwnerBase : 0);

export function relGet(state, a, b) {
  if (a === b) return 100;
  const v = state.rel?.[key(a, b)];
  return v ?? relBase(state, a, b);
}

export function relAdd(state, a, b, d) {
  if (!a || !b || a === b || !d) return;
  state.rel = state.rel || {};
  const k = key(a, b);
  state.rel[k] = clamp(Math.round(((state.rel[k] ?? relBase(state, a, b)) + d) * 10) / 10, -100, 100);
}

/** Initialisation : derbys tendus, clubs du même groupe proches. */
export function initRelations(state) {
  state.rel = state.rel || {};
  for (const A of state.clubs) for (const B of state.clubs) {
    if (A.id >= B.id) continue;
    if (isDerby(state, A.id, B.id)) state.rel[key(A.id, B.id)] ??= R.derbyInit;
    else if (sameOwner(state, A.id, B.id)) state.rel[key(A.id, B.id)] ??= R.sameOwnerBase + 10;
  }
}

/** Humeur lisible. */
export const moodOf = (v) => (v >= R.friendly ? { label: 'Chaleureux', icon: '🤝', cls: 'ok' } : v <= R.hostile ? { label: 'Froid', icon: '🧊', cls: 'bad' } : { label: 'Neutre', icon: '➖', cls: '' });

/** Match tendu : plus de fautes et de cartons. */
export function tension(state, a, b) {
  const v = Math.min(relGet(state, a, b), isDerby(state, a, b) ? R.hostile : 0);
  if (v > R.hostile) return 1;
  return clamp(1 + ((R.hostile - v) / 60) * (R.tensionMax - 1), 1, R.tensionMax);
}

/** Une journée : retour à la base, petites guerres médiatiques entre clubs IA. */
export function relationsDaily(state, rng) {
  for (const k of Object.keys(state.rel || {})) {
    const [a, b] = k.split('-').map(Number);
    const base = relBase(state, a, b);
    const v = state.rel[k] + (base - state.rel[k]) * R.decay;
    if (Math.abs(v - base) < 0.5) delete state.rel[k]; else state.rel[k] = Math.round(v * 10) / 10;
  }
  if (rng.chance(R.aiClashChance)) {
    const cands = Object.entries(state.rel || {}).filter(([k, v]) => v <= -25 && !k.split('-').map(Number).includes(state.userClubId));
    if (cands.length) {
      const [k] = rng.pick(cands);
      const [a, b] = k.split('-').map(Number);
      relAdd(state, a, b, R.interview);
      news(state, 'clash', `Passe d'armes dans la presse entre ${clubById(state, a).name} et ${clubById(state, b).name}.`);
    }
  }
}

/** Après un match : un résultat serré ou un match à cartons tend la relation. */
export function relationsAfterMatch(state, f, sum) {
  if (f.comp === 'intl') return;
  const diff = Math.abs(sum.score[0] - sum.score[1]);
  const reds = sum.ratings.flat().filter((r) => r.red).length;
  const hot = isDerby(state, f.h, f.a) || relGet(state, f.h, f.a) <= -20;
  if (hot && diff <= 1) relAdd(state, f.h, f.a, R.closeMatch);
  if (reds) relAdd(state, f.h, f.a, R.redMatch * reds);
}

/** Effet d'un transfert sur la relation entre vendeur et acheteur. */
export function relationsAfterTransfer(state, from, to, p, fee) {
  if (!from || !to) return;
  const val = p.value || 1;
  const star = clubPlayers(state, from).every((x) => x === p || overall(x) <= overall(p));
  if (star && to.rep > from.rep + 5) relAdd(state, from.id, to.id, R.stolen);
  else if (fee >= val * 0.9) relAdd(state, from.id, to.id, R.fairSale);
  else relAdd(state, from.id, to.id, -3);
}

/* ---------------- Rivaux ---------------- */

let posCache = { state: null, key: '', map: null };
function tablePos(state, club) {
  const T = state.tables?.[club.div];
  if (!T || !T[club.id]) return null;
  const k = `${state.season}-${state.day}`;
  if (posCache.state !== state || posCache.key !== k) posCache = { state, key: k, map: {} };
  if (!posCache.map[club.div]) {
    const ids = Object.keys(T).sort((a, b) => T[b].pts - T[a].pts || (T[b].gf - T[b].ga) - (T[a].gf - T[a].ga));
    posCache.map[club.div] = Object.fromEntries(ids.map((id, i) => [id, i + 1]));
  }
  return posCache.map[club.div][club.id];
}

/** Concurrent direct : derby, voisin au classement (même division), ou clash récent. */
export function isDirectRival(state, a, b) {
  if (isDerby(state, a, b) || relGet(state, a, b) <= R.hostile) return true;
  const A = clubById(state, a), B = clubById(state, b);
  if (!A || !B || A.div !== B.div) return false;
  const T = state.tables?.[A.div];
  if (!T || (T[A.id]?.p ?? 0) < 5) return false;
  return Math.abs(tablePos(state, A) - tablePos(state, B)) <= BAL.rivals.directGap;
}

export function rivalsOf(state, club) {
  return state.clubs.filter((c) => c.id !== club.id && isDirectRival(state, club.id, c.id)).slice(0, 6);
}

let sqCache = { state: null, key: '', map: null };
/** Notes de l'effectif triées (cache par journée). */
export function squadOveralls(state, c) {
  const k = `${state.season}-${state.day}`;
  if (sqCache.state !== state || sqCache.key !== k) sqCache = { state, key: k, map: {} };
  const e = sqCache.map[c.id];
  if (e && e.n === c.playerIds.length) return e.v;
  const v = clubPlayers(state, c).map(overall).sort((x, y) => y - x);
  sqCache.map[c.id] = { n: c.playerIds.length, v };
  return v;
}

/** Intouchable : la star du club, ou un joueur formé au club de bon niveau. */
export function isUntouchable(state, p) {
  const c = p.clubId ? clubById(state, p.clubId) : null;
  if (!c) return false;
  const sq = squadOveralls(state, c);
  return overall(p) >= sq[0] || (p.homegrown && overall(p) >= (sq[10] ?? 0));
}

let allyCache = { state: null, key: '', map: null };
/** Alliés d'un club (relation ≥ seuil d'alliance), mis en cache par journée. */
export function alliesOf(state, id) {
  const k = `${state.season}-${state.day}-${Object.keys(state.rel || {}).length}`;
  if (allyCache.state !== state || allyCache.key !== k) {
    const map = {};
    for (const [kk, v] of Object.entries(state.rel || {})) {
      if (v < R.ally) continue;
      const [a, b] = kk.split('-').map(Number);
      (map[a] ||= []).push(b); (map[b] ||= []).push(a);
    }
    allyCache = { state, key: k, map };
  }
  return allyCache.map[id] || [];
}

/**
 * Politique de vente d'un club : { ok, mult, reason, kind }.
 * kind : crisis | blocked | alliance | rival | untouchable | friendly | hostile | normal
 */
export function sellPolicy(state, p, buyer) {
  const from = p.clubId ? clubById(state, p.clubId) : null;
  if (!from || !buyer || from.id === buyer.id) return { ok: true, mult: 1, kind: 'normal' };
  const C = BAL.crisis, RV = BAL.rivals;
  if (from.crisis) return { ok: true, mult: windowInfo(state).deadline ? C.deadlineDiscount : C.discount, kind: 'crisis', reason: `${from.name}, en crise financière, brade ses joueurs.` };
  const r = relGet(state, from.id, buyer.id);
  if (r <= R.blocked) return { ok: false, mult: 1, kind: 'blocked', reason: `${from.name} refuse toute discussion : les relations entre les deux clubs sont rompues.` };
  for (const ally of alliesOf(state, from.id)) {
    if (ally !== buyer.id && relGet(state, ally, buyer.id) <= R.hostile) return { ok: false, mult: 1, kind: 'alliance', reason: `${from.name} ne vendra pas : solidarité avec son allié ${clubById(state, ally).name}.` };
  }
  let mult = r >= R.friendly ? R.priceFriendly : r <= R.hostile ? R.priceHostile : 1;
  const sq = squadOveralls(state, from);
  const key = overall(p) >= (sq[10] ?? 0);
  if (isDirectRival(state, from.id, buyer.id) && !p.requested) {
    if (key && !p.listed) return { ok: false, mult, kind: 'rival', reason: `« On ne renforce pas un concurrent. » ${from.name} refuse de vendre ${p.name} à un rival direct.` };
    const gain = overall(p) - squadStrength(clubPlayers(state, buyer));
    mult *= gain > 4 ? RV.priceMult[1] : RV.priceMult[0];
    return { ok: true, mult, kind: 'rival', reason: `${from.name} fait payer le prix fort à un concurrent (×${mult.toFixed(2).replace('.', ',')}).` };
  }
  if (isUntouchable(state, p) && !p.listed && !p.requested) return { ok: true, mult: mult * RV.untouchableMult, kind: 'untouchable', reason: `${p.name} est intouchable à ${from.short} : seule une offre exceptionnelle peut le faire partir.` };
  return { ok: true, mult, kind: r >= R.friendly ? 'friendly' : r <= R.hostile ? 'hostile' : 'normal' };
}

/** Prêt possible entre ces clubs ? */
export const loanAllowed = (state, from, to) => relGet(state, from.id, to.id) > R.hostile;

/** Petite pique d'un président hostile (club de l'utilisateur). */
export function hostileNoise(state, rng) {
  const uid = state.userClubId;
  const hostile = state.clubs.filter((c) => c.id !== uid && relGet(state, uid, c.id) <= R.hostile);
  if (!hostile.length || !rng.chance(0.06)) return;
  const c = rng.pick(hostile);
  pushMessage(state, { prio: 3, icon: '🗯', title: `${c.short} vous tacle`, text: rng.pick([
    `Le président de ${c.name} : « Ce club n'a aucune classe. »`,
    `${c.name} dénonce « les méthodes » de votre direction.`,
    `Ambiance glaciale : ${c.name} refuse de serrer la main de vos dirigeants.`,
    `Le directeur sportif de ${c.name} : « On ne fera jamais affaire avec eux. »`]) });
}
