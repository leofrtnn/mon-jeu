/**
 * MONDE RÉEL : construit les clubs, joueurs et entraîneurs des 5 grands championnats
 * à partir de data/real-world.json (généré par scripts/foot/build_game_world.py).
 *
 * Les données réelles fournissent noms, postes, âges, nationalités, numéros, sélections.
 * Les notes (attributs) sont estimées par le jeu : niveau du club (réputation) +
 * statut international, âge et place dans l'effectif. Tout est déterministe (graine).
 */
import { createPlayer, setNextId, getNextId, assignNumbers } from './generator.js';
import { DIVISIONS, DIV_IDS, LEAGUE_WEALTH } from './world.js';
import { DEFAULT_TACTICS } from './constants.js';
import { clamp, createRng } from '../core/rng.js';
import { overall } from '../engine/ratings.js';
import { playerValue, playerWage } from '../game/economy.js';

/** Niveau visé d'un joueur réel. */
export function realLevel(club, p, rng) {
  const base = 52 + club.rep * 0.27;                          // rep 94 → 77, rep 58 → 67,7
  const caps = p.caps || 0;
  const intl = caps >= 60 ? 5 : caps >= 30 ? 3.5 : caps >= 10 ? 2 : caps >= 1 ? 0.5 : -2.5;
  const age = p.age || 26;
  const ageK = age <= 18 ? -8 : age <= 20 ? -5 : age <= 22 ? -2.5 : age <= 30 ? 0 : age <= 32 ? -1 : age <= 34 ? -2.5 : -4;
  const exp = Math.min(2, (p.apps || 0) / 100);               // cadre du club
  const starBoost = club.rep >= 85 && caps >= 40 ? 1.5 : 0;    // les vedettes des grands clubs
  return clamp(Math.round(base + intl + ageK + exp + starBoost + rng.normal(0, 2.2)), 45, 91);
}

/** Graine stable tirée d'un texte (le même joueur a les mêmes notes dans toutes les parties). */
function hashSeed(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

/** Budget de départ d'un club : réputation × richesse du championnat (arrondi à 100 000 €). */
export function clubBudget(rep, country) {
  return Math.round(Math.pow(rep / 10, 2.6) * 120000 * (LEAGUE_WEALTH[country] ?? 0.5) / 100000) * 100000;
}

/**
 * Crée le monde réel. data = contenu de real-world.json.
 * Retourne { clubs, players, freeAgents, coaches } (coaches : { clubId, name, nat, age }).
 */
export function createRealWorld(rng, data) {
  setNextId(1);
  const divOf = Object.fromEntries(DIV_IDS.map((d) => [DIVISIONS[d].source, d]));
  const clubs = [];
  const players = {};
  const byKey = {};
  data.clubs.forEach((c, i) => {
    const div = divOf[c.league];
    if (!div) return;
    const rep = clamp(c.rep, 30, 95);
    const club = {
      id: i + 1, key: c.id, name: c.name, short: c.short, city: c.name, country: DIVISIONS[div].country,
      color: c.colors[0], color2: c.colors[1], rep, div, logo: c.logo || null,
      stadium: Math.max(8000, Math.round(c.stadium / 500) * 500),
      budget: clubBudget(rep, DIVISIONS[div].country),
      academy: clamp(Math.round(rep / 22), 1, 5),
      tactics: { ...DEFAULT_TACTICS }, playerIds: [], youthIds: [], lineup: null, bench: null, finances: { history: [] },
    };
    clubs.push(club);
    byKey[c.id] = club;
  });
  for (const rp of data.players) {
    const club = byKey[rp.club];
    if (!club) continue;
    // Graine propre au joueur : ses notes ne changent pas d'une partie à l'autre.
    const prng = createRng(hashSeed(`${rp.f} ${rp.l} ${rp.club}`));
    const level = rp.lv || realLevel(club, rp, prng);
    const age = rp.age || prng.int(20, 30);
    const p = createPlayer(prng, { pos: rp.pos, level, age, clubId: club.id, country: club.country });
    p.first = rp.f; p.last = rp.l;
    p.name = rp.f ? `${rp.f[0]}. ${rp.l}` : rp.l;
    p.nat = rp.nat || p.nat;
    p.caps = rp.caps || 0; p.intGoals = rp.ig || 0;
    p.number = rp.num || 0;
    p.real = true;
    if (rp.ph) p.photo = rp.ph;
    if (rp.apps >= 150) p.homegrown = rp.apps >= 200;           // figures historiques du club
    // Potentiel des jeunes : plus élevé dans les grands clubs.
    const o = overall(p);
    if (age <= 23) p.pot = clamp(Math.round(o + (24 - age) * 1.6 + (club.rep - 70) / 6 + prng.range(0, 6)), o, 95);
    p.wage = playerWage(p); p.value = playerValue(p);
    players[p.id] = p;
    club.playerIds.push(p.id);
  }
  // Effectifs incomplets sur Wikipédia : on complète (2 gardiens et 22 joueurs au minimum).
  const NEED = ['GB', 'GB', 'DC', 'DC', 'DC', 'DG', 'DD', 'MDC', 'MC', 'MC', 'MO', 'AG', 'AD', 'BU', 'BU', 'DC', 'DG', 'DD', 'MC', 'MDC', 'AG', 'BU'];
  for (const c of clubs) {
    const have = {};
    for (const id of c.playerIds) have[players[id].pos] = (have[players[id].pos] || 0) + 1;
    const crng = createRng(hashSeed('effectif ' + c.key));
    const used = {};
    for (const pos of NEED) {
      used[pos] = (used[pos] || 0) + 1;
      if ((have[pos] || 0) >= used[pos] && !(c.playerIds.length < 22 && pos !== 'GB' && used[pos] > (have[pos] || 0))) continue;
      if (c.playerIds.length >= 22 && (have[pos] || 0) >= used[pos]) continue;
      const p = createPlayer(crng, { pos, level: Math.round(26 + c.rep * 0.5 + crng.normal(0, 2.5)), age: crng.int(19, 31), clubId: c.id, country: c.country });
      p.wage = playerWage(p); p.value = playerValue(p);
      players[p.id] = p;
      c.playerIds.push(p.id);
      have[pos] = (have[pos] || 0) + 1;
    }
  }
  for (const c of clubs) assignNumbers(c.playerIds.map((id) => players[id]));
  // Joueurs libres (fictifs) : un petit marché d'appoint.
  const freeAgents = [];
  const countries = [...new Set(clubs.map((c) => c.country))];
  for (let k = 0; k < 60; k++) {
    const pos = rng.pick(['GB', 'DC', 'DC', 'DG', 'DD', 'MDC', 'MC', 'MC', 'MO', 'AG', 'AD', 'BU', 'BU']);
    const p = createPlayer(rng, { pos, level: rng.int(52, 70), age: rng.int(20, 34), country: rng.pick(countries) });
    p.contract = 0;
    players[p.id] = p;
    freeAgents.push(p.id);
  }
  const coaches = (data.coaches || []).filter((c) => byKey[c.club]).map((c) => ({ clubId: byKey[c.club].id, name: c.name, nat: c.nat, age: c.age }));
  return { clubs, players, freeAgents, coaches, nextId: getNextId() };
}

/** Charge les données (navigateur : fetch ; Node : lecture du fichier). */
export async function loadRealData() {
  if (typeof fetch !== 'undefined' && typeof window !== 'undefined') {
    const r = await fetch(new URL('../../data/real-world.json', import.meta.url));
    if (!r.ok) throw new Error(`Données introuvables (${r.status})`);
    return r.json();
  }
  const { readFileSync } = await import('node:fs');
  return JSON.parse(readFileSync(new URL('../../data/real-world.json', import.meta.url), 'utf8'));
}

/**
 * Sauvegardes « monde réel » créées avant l'ajout des logos et des photos :
 * on complète les clubs (par identifiant) et les joueurs (par nom, dans le même club).
 */
export function enrichRealSave(state, data) {
  if (state.world !== 'real' || state.mediaV === 2) return 0;
  let n = 0;
  const byKey = Object.fromEntries(state.clubs.filter((c) => c.key).map((c) => [c.key, c]));
  for (const c of data.clubs) if (byKey[c.id]) { byKey[c.id].logo = c.logo || null; n++; }
  const idx = {};
  for (const p of Object.values(state.players)) if (p.real) idx[`${p.first} ${p.last}`] = p;
  for (const rp of data.players) { const p = idx[`${rp.f} ${rp.l}`]; if (p && rp.ph && !p.photo) { p.photo = rp.ph; n++; } }
  state.mediaReady = true;
  state.mediaV = 2;
  return n || 1;
}
