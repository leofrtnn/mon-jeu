/**
 * MONDE RÉEL : construit les clubs, joueurs et entraîneurs des 5 grands championnats
 * à partir de data/real-world.json (généré par scripts/foot/build_game_world.py).
 *
 * Les données réelles fournissent noms, postes, âges, nationalités, numéros, sélections.
 * Les notes (attributs) sont estimées par le jeu : niveau du club (réputation) +
 * statut international, âge et place dans l'effectif. Tout est déterministe (graine).
 */
import { fixNat } from './nations.js';
import { createPlayer, setNextId, getNextId, assignNumbers, fitToLevel } from './generator.js';
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

/**
 * Profil d'attributs tiré des données réelles : taille (physique, vitesse, dribble), âge
 * (vitesse en baisse, vision et sang-froid en hausse) et ratio de buts en carrière (tir).
 */
function profile(p, rp, age) {
  const a = p.attrs;
  const h = rp.h || 0;
  if (h >= 190) { a.phy += 6; a.vit -= 4; a.dri -= 3; } else if (h >= 185) { a.phy += 3; a.vit -= 1; } else if (h && h <= 172) { a.phy -= 5; a.dri += 3; a.vit += 3; }
  if (age >= 31) { a.vit -= (age - 30) * 2.2; a.vis += 3; a.sf += 3; } else if (age <= 21) { a.vit += 2; a.sf -= 4; a.vis -= 3; }
  if (rp.gr != null && ['BU', 'AG', 'AD', 'MO'].includes(p.pos)) {
    const base = p.pos === 'BU' ? 0.32 : 0.16;
    a.tir += Math.max(-7, Math.min(9, (rp.gr - base) * 28));
  }
  // Attributs hors rôle bas, comme dans FM (un avant-centre ne sait pas tacler).
  if (['BU', 'AG', 'AD', 'MO'].includes(p.pos)) a.def -= p.pos === 'MO' ? 12 : 20;
  if (p.pos === 'DC' || p.pos === 'MDC') { a.tir -= 14; a.dri -= p.pos === 'DC' ? 10 : 4; }
  if (p.pos === 'DC') a.vis -= 6;
  for (const k in a) a[k] = Math.max(1, Math.min(97, Math.round(a[k])));
}

/**
 * Étire le haut de l'échelle (notes sur 100, lecture « à la FM ») : les cadres des grands
 * clubs passent de 82-86 à 85-90 et les tout meilleurs approchent 92, au lieu d'être tassés.
 */
function stretchTop(lv) {
  if (lv <= 72) return lv;
  let v = lv + (lv - 72) * 0.42;
  if (v > 88) v = 88 + (v - 88) * 0.55;
  return Math.round(Math.min(94, v));
}

/** Graine stable tirée d'un texte (le même joueur a les mêmes notes dans toutes les parties). */
function hashSeed(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

/** Budget de départ d'un club : réputation × richesse du championnat (arrondi à 100 000 €). */
export function clubBudget(rep, country, level = 1) {
  // Trésorerie de départ : ~10 M€ pour un club moyen de Ligue 1, ~300 M€ pour les géants.
  const v = 11e6 * Math.pow(1.105, rep - 63) * (LEAGUE_WEALTH[country] ?? 0.5) * (level === 2 ? 0.45 : 1);
  return Math.round(v / 100000) * 100000;
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
      budget: clubBudget(rep, DIVISIONS[div].country, DIVISIONS[div].level),
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
    const level = stretchTop(rp.lv || realLevel(club, rp, prng));
    const age = rp.age || prng.int(20, 30);
    const p = createPlayer(prng, { pos: rp.pos, level, age, clubId: club.id, country: club.country, noise: 3.5 });
    if (rp.p2?.length) p.pos2 = rp.p2.slice();
    profile(p, rp, age);
    fitToLevel(p, level);
    p.first = rp.f; p.last = rp.l;
    p.name = rp.f ? `${rp.f[0]}. ${rp.l}` : rp.l;
    p.nat = fixNat(rp.nat) || p.nat;
    // Parcours avant la partie (clubs, matchs, buts) : « années|club|matchs|buts ».
    if (rp.cr?.length) p.careerHist = rp.cr.map((x) => { const [y, c, a, g] = String(x).split('|'); return { y, club: String(c).replace(/\(loan\)/i, '(prêt)'), apps: +a || 0, goals: +g || 0 }; });
    p.caps = rp.caps || 0; p.intGoals = rp.ig || 0;
    p.number = rp.num || 0;
    p.real = true;
    if (rp.ph) p.photo = rp.ph;
    if (rp.h) p.height = rp.h;            // taille réelle (cm), pour le rendu 3D
    if (rp.apps >= 150) p.homegrown = rp.apps >= 200;           // figures historiques du club
    // Potentiel des jeunes : plus élevé dans les grands clubs.
    const o = overall(p);
    if (age <= 23) p.pot = clamp(Math.round(o + (24 - age) * 1.6 + (club.rep - 70) / 6 + prng.range(0, 6)), o, 95);
    p.wage = playerWage(p); p.value = playerValue(p);
    players[p.id] = p;
    club.playerIds.push(p.id);
  }
  // Aucun joueur inventé : les effectifs viennent des sources réelles (Wikipédia, Wikidata).
  // Les clubs aux effectifs pléthoriques (prêtés, réservistes) libèrent leurs joueurs en trop :
  // ces VRAIS joueurs forment le marché des joueurs libres, où les clubs incomplets se servent.
  const freeAgents = [];
  for (const c of clubs) {
    if (c.playerIds.length <= 30) continue;
    const sorted = c.playerIds.map((id) => players[id]).sort((a, b) => overall(b) - overall(a));
    const gks = sorted.filter((p) => p.pos === 'GB');
    const keep = new Set([...sorted.slice(0, 28), ...gks.slice(0, 3)].map((p) => p.id));
    for (const p of sorted) if (!keep.has(p.id)) { p.clubId = null; p.contract = 0; p.number = 0; freeAgents.push(p.id); }
    c.playerIds = c.playerIds.filter((id) => keep.has(id));
  }
  // Les clubs incomplets complètent avec ces joueurs libres (ils devront recruter au mercato sinon).
  const pool = freeAgents.map((id) => players[id]).sort((a, b) => overall(b) - overall(a));
  for (const c of clubs.slice().sort((a, b) => b.rep - a.rep)) {
    for (const need of ['GB', 'GB', 'DC', 'DC', 'DC', 'DG', 'DD', 'MDC', 'MC', 'MC', 'MO', 'AG', 'AD', 'BU', 'BU', 'DC', 'MC', 'BU', 'DG', 'DD']) {
      if (c.playerIds.length >= 22) break;
      const have = c.playerIds.filter((id) => players[id].pos === need).length;
      const want = { GB: 2, DC: 4, MC: 3, BU: 3 }[need] || 1;
      if (have >= want) continue;
      const i = pool.findIndex((p) => p.pos === need && Math.abs(overall(p) - (40 + c.rep * 0.4)) < 14);
      if (i < 0) continue;
      const p = pool.splice(i, 1)[0];
      p.clubId = c.id; p.contract = 1 + (p.id % 2); c.playerIds.push(p.id);
      freeAgents.splice(freeAgents.indexOf(p.id), 1);
    }
    if (c.playerIds.length < 18) c.shortSquad = true;
  }
  for (const c of clubs) assignNumbers(c.playerIds.map((id) => players[id]));
  const coaches = (data.coaches || []).filter((c) => byKey[c.club]).map((c) => ({ clubId: byKey[c.club].id, name: c.name, nat: fixNat(c.nat), age: c.age, ph: c.ph || null }));
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
export const MEDIA_V = 3;
export function enrichRealSave(state, data) {
  if (state.world !== 'real' || state.mediaV === MEDIA_V) return 0;
  let n = 0;
  const byKey = Object.fromEntries(state.clubs.filter((c) => c.key).map((c) => [c.key, c]));
  for (const c of data.clubs) if (byKey[c.id]) { byKey[c.id].logo = c.logo || null; n++; }
  const idx = {};
  for (const p of Object.values(state.players)) if (p.real) idx[`${p.first} ${p.last}`] = p;
  for (const rp of data.players) {
    const p = idx[`${rp.f} ${rp.l}`];
    if (!p) continue;
    if (rp.ph && !p.photo) { p.photo = rp.ph; n++; }
    if (rp.h && !p.height) p.height = rp.h;
  }
  // Photos des entraîneurs (bancs des clubs IA).
  for (const co of data.coaches || []) {
    const club = byKey[co.club];
    const m = club && state.managers?.[club.managerId];
    if (m && co.ph && !m.photo && co.name && (m.fullName === co.name || co.name.endsWith(m.last || '§'))) { m.photo = co.ph; n++; }
  }
  state.mediaReady = true;
  state.mediaV = MEDIA_V;
  return n || 1;
}
