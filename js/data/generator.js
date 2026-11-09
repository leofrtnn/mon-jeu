/**
 * Génération procédurale du monde : joueurs, clubs, divisions.
 */
import { COUNTRIES } from './world.js';
import { POSITION_WEIGHTS, ATTRS, FORMATIONS, DEFAULT_TACTICS } from './constants.js';
import { randomName, CITIES, CITIES_IBE, CITIES_ALB, clubNameFor, CLUB_COLORS } from './names.js';
import { DIVISIONS } from './world.js';
import { overall } from '../engine/ratings.js';
import { playerValue, playerWage } from '../game/economy.js';
import { clamp } from '../core/rng.js';

/** Composition type d'un effectif de 25. */
export const SQUAD_TEMPLATE = ['GB', 'GB', 'GB', 'DC', 'DC', 'DC', 'DC', 'DG', 'DG', 'DD', 'DD', 'MDC', 'MDC',
  'MC', 'MC', 'MC', 'MC', 'MO', 'MO', 'AG', 'AG', 'AD', 'AD', 'BU', 'BU'];

let nextId = 1;
export function setNextId(v) { nextId = v; }
export function getNextId() { return nextId; }

/**
 * Crée un joueur dont la note globale vise `level`.
 * Les attributs clés du poste sont proches de la cible, les autres plus bas.
 */
export function createPlayer(rng, { pos, level, age, clubId = null, country = 'FRA' }) {
  const { first, last, nat } = randomName(rng, country);
  const w = POSITION_WEIGHTS[pos];
  const attrs = {};
  for (const k of ATTRS) {
    if (k === 'arr') attrs[k] = pos === 'GB' ? 0 : rng.int(5, 20);
    else if (w[k]) attrs[k] = level + rng.normal(0, 6) + w[k] * 8;
    else if (pos === 'GB') attrs[k] = level - rng.range(20, 40);
    else attrs[k] = level - rng.range(6, 24);
  }
  if (pos === 'GB') attrs.arr = level + rng.normal(0, 4);
  // Ajustement pour coller à la note visée.
  const tmp = { attrs, pos };
  for (let it = 0; it < 3; it++) {
    const diff = level - overall({ ...tmp, attrs: roundAttrs(attrs) });
    for (const k in w) attrs[k] += diff;
  }
  const a = roundAttrs(attrs);
  age = age ?? rng.int(18, 34);
  const o = overall({ attrs: a, pos });
  const pot = clamp(Math.round(age <= 20 ? o + rng.range(5, 22) : age <= 24 ? o + rng.range(1, 12) : age <= 28 ? o + rng.range(0, 4) : o), o, 95);
  const p = {
    id: nextId++, first, last, name: `${first[0]}. ${last}`, nat, caps: 0, intGoals: 0, age, pos, attrs: a, pot,
    form: rng.int(40, 60), morale: rng.int(55, 75), fatigue: 0, injury: 0, injuryName: '', suspended: 0,
    yellowAcc: 0, contract: rng.int(1, 4), clubId, number: 0, wage: 0, value: 0,
    stats: { apps: 0, goals: 0, lgoals: 0, assists: 0, ratingSum: 0, yellows: 0, reds: 0, minutes: 0, motm: 0 },
    trainingXp: 0, loanedOut: null, onLoanFrom: null, listed: false,
  };
  p.wage = playerWage(p);
  p.value = playerValue(p);
  return p;
}

function roundAttrs(attrs) {
  const out = {};
  for (const k in attrs) out[k] = clamp(Math.round(attrs[k]), 1, 99);
  return out;
}

/** Âge réaliste pour un effectif : surtout 21-31 ans. */
function squadAge(rng, i) {
  if (i >= 22) return rng.int(17, 20); // jeunes
  return clamp(Math.round(rng.normal(26, 4)), 18, 35);
}

/** Crée l'effectif complet d'un club. Le niveau moyen du onze ≈ `level`. */
export function createSquad(rng, club, level) {
  const players = [];
  // Mélange pour que titulaires/remplaçants soient répartis selon les postes.
  const tpl = SQUAD_TEMPLATE.map((pos, i) => ({ pos, i }));
  // Pour chaque poste, le premier joueur est un titulaire probable.
  const seen = {};
  for (const { pos } of tpl) {
    seen[pos] = (seen[pos] || 0) + 1;
    const rank = seen[pos];
    let lv;
    if (pos === 'GB') lv = rank === 1 ? level + 1 : level - 8 - rank * 2;
    else lv = rank <= 2 ? level + rng.normal(1, 3) : level - rng.range(4, 10);
    const young = rng.chance(0.14);
    const age = young ? rng.int(17, 20) : squadAge(rng, 0);
    if (young) lv -= rng.range(4, 9);
    const p = createPlayer(rng, { pos, level: Math.round(lv), age, clubId: club.id, country: club.country });
    players.push(p);
  }
  assignNumbers(players);
  return players;
}

/** Numéros de maillot cohérents (1 gardien, 2-5 défense, etc.). */
export function assignNumbers(players) {
  const pref = { GB: [1, 16, 30], DC: [4, 5, 3, 15, 23], DG: [3, 12, 26], DD: [2, 22, 24], MDC: [6, 18, 28],
    MC: [8, 14, 17, 21], MO: [10, 20, 27], AG: [11, 7, 19], AD: [7, 11, 25], BU: [9, 19, 29] };
  const used = new Set(players.filter((p) => p.number).map((p) => p.number));
  for (const p of players) {
    if (p.number) continue;
    let n = (pref[p.pos] || []).find((x) => !used.has(x));
    if (!n) { n = 2; while (used.has(n)) n++; }
    p.number = n; used.add(n);
  }
}

/**
 * Crée le monde : France (2 divisions), Ibérie et Albion (1 division chacun),
 * 20 clubs fictifs par division, plus des joueurs libres.
 * Retourne { clubs, players, freeAgents }.
 */
export function createWorld(rng) {
  nextId = 1;
  const pools = { FRA: rng.shuffle(CITIES.slice()), IBE: rng.shuffle(CITIES_IBE.slice()), ALB: rng.shuffle(CITIES_ALB.slice()) };
  const colors = rng.shuffle(CLUB_COLORS.slice());
  const clubs = [];
  const players = {};
  const usedShort = new Set();
  let i = 0;
  for (const div of Object.keys(DIVISIONS).map(Number)) {
    const d = DIVISIONS[div];
    for (let k = 0; k < 20; k++, i++) {
      // Réputation décroissante avec du bruit : quelques gros, un ventre mou, des petits.
      const top = d.country === 'ALB' ? 90 : 88;
      const rep = d.level === 1 ? Math.round(top - k * 1.6 + rng.normal(0, 2)) : Math.round(60 - k * 1.1 + rng.normal(0, 2));
      const city = pools[d.country].pop();
      const { name, short: s0 } = clubNameFor(rng, city, d.country);
      let short = s0; let n = 0;
      while (usedShort.has(short)) short = s0.slice(0, 2) + String.fromCharCode(65 + n++);
      usedShort.add(short);
      const pair = colors[i % colors.length];
      const [color, color2] = i >= colors.length ? [pair[0], pair[1]] : pair;
      const club = {
        id: i + 1, name, short, city, country: d.country, color, color2, rep: clamp(rep, 30, 95), div,
        stadium: Math.round((d.level === 1 ? 15000 + rep * 450 : 6000 + rep * 200) / 500) * 500,
        budget: Math.round((d.level === 1 ? Math.pow(rep / 10, 2.6) * 120000 : Math.pow(rep / 10, 2.2) * 60000) / 100000) * 100000,
        academy: clamp(Math.round(rep / 22), 1, 5),
        tactics: { ...DEFAULT_TACTICS },
        playerIds: [], youthIds: [], lineup: null, bench: null,
        finances: { history: [] },
      };
      const level = d.level === 1 ? Math.round(56 + rep * 0.25) : Math.round(50 + rep * 0.29);
      const squad = createSquad(rng, club, level);
      for (const p of squad) { players[p.id] = p; club.playerIds.push(p.id); }
      clubs.push(club);
    }
  }
  // Joueurs libres (agents libres).
  const freeAgents = [];
  for (let k = 0; k < 50; k++) {
    const pos = rng.pick(['GB', 'DC', 'DC', 'DG', 'DD', 'MDC', 'MC', 'MC', 'MO', 'AG', 'AD', 'BU', 'BU']);
    const p = createPlayer(rng, { pos, level: rng.int(50, 68), age: rng.int(19, 34), country: rng.pick(Object.keys(COUNTRIES)) });
    p.contract = 0;
    players[p.id] = p;
    freeAgents.push(p.id);
  }
  return { clubs, players, freeAgents };
}

/** Jeune du centre de formation : potentiel lié au niveau du centre. */
export function createYouth(rng, club) {
  const pos = rng.pick(SQUAD_TEMPLATE.slice(1));
  const p = createPlayer(rng, { pos, level: rng.int(40, 50) + club.academy * 2, age: rng.int(16, 18), clubId: club.id, country: club.country });
  p.pot = clamp(Math.round(55 + club.academy * 5 + rng.normal(0, 8)), overall(p) + 5, 94);
  p.contract = 3;
  p.wage = Math.round(p.wage * 0.5 / 100) * 100;
  return p;
}

export { FORMATIONS };
