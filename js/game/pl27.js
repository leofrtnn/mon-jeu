/**
 * PREMIER LEAGUE 2026-27 (fichier de l'utilisateur, voir js/data/pl27.js).
 *
 * Nouvelle partie « monde réel » : les 20 effectifs de Premier League deviennent exactement
 * ceux du fichier (joueurs déplacés depuis leur ancien club, joueurs absents des sources
 * créés, joueurs en trop libérés sur le marché des joueurs libres), avec leurs notes,
 * attributs, numéros, taille, poids, pied fort, étoiles et postes secondaires.
 * Partie déjà commencée (première saison) : seules les notes et les détails sont mis à jour,
 * aucun joueur ne change de club.
 */
import { PL27, PL27_DET } from '../data/pl27.js';
import { createPlayer, fitToLevel, assignNumbers, getNextId } from '../data/generator.js';
import { overall } from '../engine/ratings.js';
import { playerValue, playerWage } from './economy.js';
import { abilityTo100 } from './ratingsImport.js';
import { createRng, hashSeed } from '../core/rng.js';

export const PL27_V = 1;
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
  const words = name.split(' ');
  if (words.length > 1 || !p.last) { p.first = words.length > 1 ? words[0] : (p.first || ''); p.last = words.length > 1 ? words.slice(1).join(' ') : name; }
  p.name = p.first ? `${p.first[0]}. ${p.last}` : p.last;
  if (nat) p.nat = nat;
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
 * Retourne { matched, created, moved, released } ou null.
 */
export function applyPL27(state, { rosters = false } = {}) {
  if (state.world !== 'real' || state.pl27V === PL27_V) return null;
  const byKey = new Map(state.clubs.filter((c) => c.key).map((c) => [c.key, c]));
  if (!byKey.has('arsenal')) return null;
  const clubOf = new Map(state.clubs.map((c) => [c.id, c]));
  const full = new Map();
  for (const p of Object.values(state.players)) {
    const k = fold(`${p.first || ''} ${p.last || ''}`);
    if (!full.has(k)) full.set(k, []);
    full.get(k).push(p);
  }
  const used = new Set();
  const kept = new Map(); // club → Set(ids) (effectifs du fichier)
  const res = { matched: 0, created: 0, moved: 0, released: 0 };
  for (const row of PL27) {
    const club = byKey.get(row[0]);
    if (!club) continue;
    const nf = fold(row[1]);
    const words = nf.split(' ');
    const free = (q) => q && !used.has(q);
    let cands = (full.get(nf) || []).filter(free);
    let p = cands.find((q) => q.clubId === club.id) || (cands.length === 1 ? cands[0] : cands.sort((a, b) => overall(b) - overall(a))[0]) || null;
    if (!p) {
      // Nom seul (« Gomes ») ou prénom différent : par le nom de famille, dans le club.
      const last = words.length === 1 ? nf : words.slice(1).join(' ');
      const inClub = club.playerIds.map((id) => state.players[id]).filter((q) => free(q) && fold(q.last) === last
        && (words.length === 1 || fold(q.first || '').startsWith(words[0][0])));
      if (inClub.length === 1) p = inClub[0];
      else if (inClub.length > 1) p = inClub.find((q) => q.pos === (row[5])) || null;
    }
    if (!p && !rosters) continue;
    if (!p) {
      const rng = createRng(hashSeed(`pl27-${row[1]}-${row[0]}`));
      p = createPlayer(rng, { pos: row[5], level: abilityTo100(row[12]), age: row[4], clubId: club.id, country: 'ENG', noise: 3 });
      p.first = ''; p.last = '';
      state.players[p.id] = p;
      club.playerIds.push(p.id);
      res.created++;
    } else if (rosters && p.clubId !== club.id) {
      const old = clubOf.get(p.clubId);
      if (old) {
        old.playerIds = old.playerIds.filter((id) => id !== p.id);
        old.youthIds = (old.youthIds || []).filter((id) => id !== p.id);
      } else state.freeAgents = (state.freeAgents || []).filter((id) => id !== p.id);
      p.clubId = club.id; p.loanedOut = null; p.onLoanFrom = null; p.listed = false;
      if (!(p.contract > 0)) p.contract = 2 + (p.id % 3);
      club.playerIds.push(p.id);
      res.moved++;
    }
    used.add(p);
    const num = setData(p, row);
    if (rosters) p.number = num || 0;
    if (!kept.has(club)) kept.set(club, new Set());
    kept.get(club).add(p.id);
    res.matched++;
  }
  if (rosters) {
    for (const [club, ids] of kept) {
      // Joueurs absents du fichier : libérés (ils rejoignent le marché des joueurs libres).
      for (const id of club.playerIds) {
        if (ids.has(id)) continue;
        const p = state.players[id];
        p.clubId = null; p.contract = 0; p.number = 0;
        (state.freeAgents ||= []).push(id);
        res.released++;
      }
      club.playerIds = club.playerIds.filter((id) => ids.has(id));
      club.youthIds = (club.youthIds || []).filter((id) => ids.has(id));
      club.lineup = null; club.bench = null;
      club.shortSquad = club.playerIds.length < 18;
      // Numéros en double dans le fichier : le second en reçoit un libre.
      const seen = new Set();
      const ps = club.playerIds.map((id) => state.players[id]);
      for (const p of ps) { if (p.number && seen.has(p.number)) p.number = 0; if (p.number) seen.add(p.number); }
      assignNumbers(ps);
    }
    // Clubs qui ont perdu des joueurs au profit de la Premier League : compo à refaire.
    for (const c of state.clubs) if (!kept.has(c) && c.lineup?.some?.((id) => id && state.players[id]?.clubId !== c.id)) { c.lineup = null; c.bench = null; }
    state.nextId = Math.max(state.nextId || 0, getNextId());
  }
  state.pl27V = PL27_V;
  return res;
}

