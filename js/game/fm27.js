/**
 * NOTES 2026-27 FOURNIES PAR L'UTILISATEUR, par championnat (js/data/fm27_*.js) :
 * Premier League, Championship, LaLiga, Serie A, Ligue 1, Liga Portugal, Eredivisie, Pro League.
 *
 * Nouvelle partie « monde réel » :
 *  - le CLUB de chaque joueur vient des sources réelles à jour (Wikipédia 2026-27) : si le
 *    fichier place un joueur dans un club qu'il a quitté (Martinelli, Trossard…), il reste
 *    dans son vrai club, mais reçoit les notes du fichier ;
 *  - les joueurs du fichier absents des sources (jeunes du centre, U18…) sont créés dans
 *    leur club ; un joueur sans club dans les sources rejoint le club du fichier ;
 *  - notes, attributs, taille, poids, pied fort, étoiles et postes secondaires du fichier.
 * Partie déjà commencée : rien n'est modifié (les notes et transferts de la partie sont conservés).
 */
import { DET as PL27_DET, FM27_ENG } from '../data/fm27_eng.js';
import { FM27_FRA } from '../data/fm27_fra.js';
import { FM27_ENG2 } from '../data/fm27_eng2.js';
import { FM27_BEL } from '../data/fm27_bel.js';
import { FM27_NED } from '../data/fm27_ned.js';
import { FM27_POR } from '../data/fm27_por.js';
import { FM27_ITA } from '../data/fm27_ita.js';
import { FM27_ESP } from '../data/fm27_esp.js';
import { fixNat } from '../data/nations.js';
import { createPlayer, fitToLevel, assignNumbers, getNextId } from '../data/generator.js';
import { overall } from '../engine/ratings.js';
import { playerValue, playerWage } from './economy.js';
import { abilityTo100 } from './ratingsImport.js';
import { createRng, hashSeed } from '../core/rng.js';

/** Championnats importés et version de chaque fichier (une nouvelle version réapplique). */
export const FM27_LEAGUES = {
  ENG1: { v: 2, rows: FM27_ENG }, FRA1: { v: 2, rows: FM27_FRA }, ENG2: { v: 1, rows: FM27_ENG2 }, ESP1: { v: 1, rows: FM27_ESP },
  ITA1: { v: 1, rows: FM27_ITA }, POR1: { v: 1, rows: FM27_POR }, NED1: { v: 1, rows: FM27_NED }, BEL1: { v: 1, rows: FM27_BEL },
};
/** Toutes les versions appliquées ? (sinon applyFM27 a du travail). */
export const fm27Pending = (state) => state.world === 'real' && Object.entries(FM27_LEAGUES).some(([k, l]) => (state.fm27?.[k] || 0) < l.v);
export { PL27_DET };
const fold = (t) => String(t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();

/** Attribut détaillé (sur 20) d'un joueur issu du fichier, par son nom (« Corners »…), ou null. */
export function detAttr(p, name) {
  const i = PL27_DET.indexOf(name);
  if (!p?.det || i < 0) return null;
  const v = parseInt(p.det[i], 21);
  return Number.isFinite(v) && v > 0 ? v : null;
}

function setData(p, row) {
  const [, name, num, nat, age, pos, p2, foot, wf, sm, h, w, ca, pa, attrs, cons, lead, det] = row;
  // Nom : celui des sources réelles est gardé ; seul un joueur créé prend celui du fichier.
  if (!p.last) {
    const words = name.split(' ');
    p.first = words.length > 1 ? words[0] : ''; p.last = words.length > 1 ? words.slice(1).join(' ') : name;
    p.name = p.first ? `${p.first[0]}. ${p.last}` : p.last;
  }
  if (nat) p.nat = fixNat(nat);
  if (age) p.age = age;
  p.pos = pos;
  p.pos2 = p2.slice();
  p.foot = foot; p.wf = wf; p.sm = sm;
  if (h) p.height = h;
  if (w) p.weight = w;
  p.attrs = { ...p.attrs, ...attrs };
  if (pos === 'GB') p.attrs.arr = attrs.arr ?? p.attrs.arr ?? 60;
  fitToLevel(p, abilityTo100(ca));
  const o = overall(p);
  p.pot = Math.max(o, abilityTo100(Math.max(ca, pa)));
  p.cons = cons; p.lead = lead; p.det = det;
  p.wage = Math.max(p.wage || 0, playerWage(p));
  p.value = playerValue(p);
  p.imported = true; p.real = true;
  return num;
}

/**
 * Applique le fichier. `rosters` : true pour une nouvelle partie (effectifs remplacés).
 * Retourne { matched, created, moved, kept } ou null.
 */
export function applyFM27(state, { rosters = false } = {}) {
  if (state.world !== 'real') return null;
  // Anciennes sauvegardes : la Premier League avait déjà été appliquée (version 1).
  if (state.pl27V && !state.fm27) { state.fm27 = { ENG1: state.pl27V }; delete state.pl27V; }
  state.fm27 ||= {};
  const total = { matched: 0, created: 0, moved: 0, kept: 0 };
  for (const [lg, l] of Object.entries(FM27_LEAGUES)) {
    if ((state.fm27[lg] || 0) >= l.v) continue;
    const r = applyLeague(state, l.rows, rosters);
    for (const k in total) total[k] += r[k];
    state.fm27[lg] = l.v;
  }
  return total;
}

/** Partie en cours : on ne touche ni aux notes ni aux effectifs, on note seulement que c'est à jour. */
export function markFM27(state) { state.fm27 = Object.fromEntries(Object.entries(FM27_LEAGUES).map(([k, l]) => [k, l.v])); delete state.pl27V; }

function applyLeague(state, ROWS, rosters) {
  const byKey = new Map(state.clubs.filter((c) => c.key).map((c) => [c.key, c]));
  const full = new Map();
  for (const p of Object.values(state.players)) {
    const k = fold(`${p.first || ''} ${p.last || ''}`);
    if (!full.has(k)) full.set(k, []);
    full.get(k).push(p);
  }
  const used = new Set();
  const touched = new Set();
  const res = { matched: 0, created: 0, moved: 0, kept: 0 };
  for (const row of ROWS) {
    const club = byKey.get(row[0]);
    if (!club) continue;
    const nf = fold(row[1]);
    const words = nf.split(' ');
    const free = (q) => q && !used.has(q);
    // Même nom ailleurs : c'est le même joueur si l'âge concorde (sinon un homonyme).
    const cands = (full.get(nf) || []).filter((q) => free(q) && (q.clubId === club.id || !row[4] || !q.age || Math.abs(q.age - row[4]) <= 1));
    let p = cands.find((q) => q.clubId === club.id) || cands.sort((a, b) => overall(b) - overall(a))[0] || null;
    if (!p) {
      // Nom seul (« Gomes ») ou prénom écrit autrement (« Kostas » / « Christos ») : nom de famille, dans le club.
      const last = words.length === 1 ? nf : words.slice(1).join(' ');
      const inClub = club.playerIds.map((id) => state.players[id]).filter((q) => free(q) && fold(q.last) === last);
      if (inClub.length === 1) p = inClub[0];
      else if (inClub.length > 1) p = inClub.find((q) => q.pos === row[5] && (words.length === 1 || fold(q.first || '').startsWith(words[0][0]))) || null;
    }
    if (!p && !rosters) continue;
    if (!p) {
      const rng = createRng(hashSeed(`fm27-${row[1]}-${row[0]}`));
      p = createPlayer(rng, { pos: row[5], level: abilityTo100(row[12]), age: row[4], clubId: club.id, country: 'ENG', noise: 3 });
      p.first = ''; p.last = '';
      p.contract = 1 + (p.id % 4);
      state.players[p.id] = p;
      club.playerIds.push(p.id);
      res.created++;
      touched.add(club);
    } else if (rosters && p.clubId == null) {
      // Joueur sans club dans les sources (écarté d'un effectif trop fourni) : il rejoint le club du fichier.
      state.freeAgents = (state.freeAgents || []).filter((id) => id !== p.id);
      p.clubId = club.id; p.contract = 1 + (p.id % 3);
      club.playerIds.push(p.id);
      res.moved++;
      touched.add(club);
    } else if (p.clubId !== club.id) {
      res.kept++; // il a changé de club depuis : on garde son vrai club
      // Déjà noté par le fichier du championnat où il joue vraiment : ce fichier-là l'emporte.
      if (p.det && p.detLg === p.clubId) { used.add(p); continue; }
    }
    used.add(p);
    const num = setData(p, row);
    if (p.clubId === club.id) p.detLg = club.id;
    if (rosters && p.clubId === club.id && num) p.number = num;
    res.matched++;
  }
  if (rosters) {
    for (const club of new Set([...touched, ...[...byKey.values()].filter((c) => ROWS.some((r) => r[0] === c.key))])) {
      // Effectif trop fourni après les ajouts : les plus faibles absents du fichier partent (joueurs libres).
      const ps = club.playerIds.map((id) => state.players[id]).filter(Boolean);
      if (ps.length > 32) {
        const out = ps.filter((p) => !p.det).sort((a, b) => overall(a) - overall(b)).slice(0, ps.length - 32);
        for (const p of out) { p.clubId = null; p.contract = 0; p.number = 0; (state.freeAgents ||= []).push(p.id); }
        const gone = new Set(out.map((p) => p.id));
        club.playerIds = club.playerIds.filter((id) => !gone.has(id));
      }
      club.lineup = null; club.bench = null;
      club.shortSquad = club.playerIds.length < 18;
      // Numéros en double : le second en reçoit un libre.
      const seen = new Set();
      const list = club.playerIds.map((id) => state.players[id]);
      for (const p of list) { if (p.number && seen.has(p.number)) p.number = 0; if (p.number) seen.add(p.number); }
      assignNumbers(list);
    }
    state.nextId = Math.max(state.nextId || 0, getNextId());
  }
  return res;
}
