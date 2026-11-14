/**
 * COHÉSION
 * ------------------------------------------------------------------
 * 1) Cohésion d'équipe (club.coh, 0-100, tous les clubs) : elle chute à chaque arrivée
 *    (−3,5 par recrue, davantage si l'équipe est déjà bouleversée) et au départ des cadres,
 *    puis remonte avec le temps passé ensemble et les victoires. Changer toute l'équipe en un
 *    mercato la fait plonger : l'équipe joue alors nettement en dessous de son niveau.
 * 2) Liens entre joueurs (votre club) : chaque paire a une affinité (0-100) qui se renforce en
 *    jouant ensemble (surtout aux postes voisins), en gagnant, entre compatriotes ; elle se
 *    dégrade quand l'un des deux est malheureux ; certaines personnalités ne s'entendent pas.
 * Effet en match : rendement × (0,94 + 0,08 × cohésion / 100), soit de −6 % à +2 %.
 */
import { clamp, hashSeed } from '../core/rng.js';
import { allPlayers } from '../engine/match.js';

export const clubCoh = (club) => club.coh ?? 72;
export const cohMult = (c) => 0.94 + 0.08 * clamp(c, 0, 100) / 100;

/** Arrivée d'un joueur : la cohésion baisse (d'autant plus que l'effectif change beaucoup). */
export function cohOnArrival(state, club, p) {
  const recent = (club.arrivals || []).filter((s) => s === state.season).length;
  club.coh = clamp(clubCoh(club) - 3.5 - Math.min(3, recent * 0.4), 10, 100);
  (club.arrivals ||= []).push(state.season);
  if (club.arrivals.length > 30) club.arrivals = club.arrivals.slice(-30);
  p.arrivedDay = `${state.season}-${state.day}`;
}

/** Départ : perdre un cadre installé depuis longtemps déstabilise le vestiaire. */
export function cohOnDeparture(state, club, p) {
  const years = p.joined != null ? state.season - p.joined : 4;
  if (years >= 3 || p.homegrown) club.coh = clamp(clubCoh(club) - 1.5, 10, 100);
  if (p.links) delete p.links;
}

/** Une journée : la cohésion remonte doucement pour les clubs qui ont joué (résultat compris). */
export function cohesionDaily(state, results) {
  for (const r of results || []) {
    if (r.comp === 'intl') continue;
    for (const [id, gf, ga] of [[r.h, r.s[0], r.s[1]], [r.a, r.s[1], r.s[0]]]) {
      const c = state.clubs.find((x) => x.id === id);
      if (!c) continue;
      c.coh = clamp(clubCoh(c) + (88 - clubCoh(c)) * 0.025 + (gf > ga ? 0.6 : gf < ga ? -0.35 : 0.1), 10, 100);
    }
  }
}

/* ---------------- Liens entre joueurs (club de l'utilisateur) ---------------- */

const pairHash = (a, b) => hashSeed(`lien-${Math.min(a, b)}-${Math.max(a, b)}`) >>> 0;
/** Personnalités incompatibles (environ 6 % des paires). */
export const clash = (a, b) => pairHash(a.id, b.id) % 100 < 6;

function initLink(state, a, b) {
  const h = pairHash(a.id, b.id);
  const veteran = (p) => p.joined == null || p.joined < state.season || !p.arrivedDay;
  let v = veteran(a) && veteran(b) ? 48 + (h % 30) : 12 + (h % 12);
  if (a.nat && a.nat === b.nat) v += 12;
  if (clash(a, b)) v = Math.min(v, 25);
  return clamp(v, 0, 100);
}

export function link(state, a, b) {
  if (!a || !b || a.id === b.id) return 0;
  const la = (a.links ||= {});
  if (la[b.id] == null) { const v = initLink(state, a, b); la[b.id] = v; (b.links ||= {})[a.id] = v; }
  return la[b.id];
}
function bump(state, a, b, dv) {
  const cap = clash(a, b) ? 45 : 100;
  const v = clamp(link(state, a, b) + dv, 0, cap);
  a.links[b.id] = v; b.links[a.id] = v;
}

const LINE = (pos) => (pos === 'GB' ? 0 : ['DC', 'DG', 'DD'].includes(pos) ? 1 : ['MDC', 'MC', 'MG', 'MD', 'MO'].includes(pos) ? 2 : 3);

/** Après un match du club de l'utilisateur : ceux qui ont joué ensemble se rapprochent. */
export function cohesionAfterUserMatch(state, m, side, won) {
  const ps = allPlayers(m.teams[side]).filter((mp) => mp.minIn != null && ((mp.minOut ?? 90) - mp.minIn) >= 25).map((mp) => state.players[mp.id]).filter(Boolean);
  for (let i = 0; i < ps.length; i++) for (let j = i + 1; j < ps.length; j++) {
    const a = ps[i], b = ps[j];
    const near = Math.abs(LINE(a.pos) - LINE(b.pos)) <= 1;
    bump(state, a, b, (near ? 2.6 : 1.4) + (won ? 0.8 : 0) - (clash(a, b) ? 1.8 : 0));
  }
}

/** Chaque semaine : un joueur malheureux abîme ses relations ; les incompatibles se frottent. */
export function linksWeekly(state, club, rng) {
  const ps = club.playerIds.map((id) => state.players[id]).filter(Boolean);
  const events = [];
  for (const a of ps) {
    if ((a.morale ?? 60) < 32) for (const b of ps) if (b !== a && rng.chance(0.25)) bump(state, a, b, -1.5);
  }
  for (let i = 0; i < ps.length; i++) for (let j = i + 1; j < ps.length; j++) {
    const a = ps[i], b = ps[j];
    if (clash(a, b) && rng.chance(0.02)) { bump(state, a, b, -8); events.push([a, b]); }
  }
  return events;
}

/** Cohésion utilisée en match (0-100) : club (vestiaire) + liens entre les titulaires (votre club). */
export function teamCohesion(state, club, lineupIds = null) {
  const base = clubCoh(club);
  if (!club.staffMembers) return base; // clubs de l'IA : cohésion de club seulement
  const ids = (lineupIds || club.lineup || []).filter(Boolean).slice(0, 11);
  const ps = ids.map((id) => state.players[id]).filter(Boolean);
  if (ps.length < 2) return base;
  let sum = 0, n = 0;
  for (let i = 0; i < ps.length; i++) for (let j = i + 1; j < ps.length; j++) { sum += link(state, ps[i], ps[j]); n++; }
  return Math.round(base * 0.5 + (sum / n) * 0.5);
}

/** Rapport pour l'écran Cohésion : niveau, duos, tensions, intégration des recrues. */
export function cohesionReport(state, club) {
  const ps = club.playerIds.map((id) => state.players[id]).filter(Boolean);
  const pairs = [];
  for (let i = 0; i < ps.length; i++) for (let j = i + 1; j < ps.length; j++) pairs.push({ a: ps[i], b: ps[j], v: link(state, ps[i], ps[j]), clash: clash(ps[i], ps[j]) });
  pairs.sort((x, y) => y.v - x.v);
  const integ = ps.map((p) => ({ p, v: Math.round(ps.filter((q) => q !== p).reduce((a, q) => a + link(state, p, q), 0) / Math.max(1, ps.length - 1)) })).sort((x, y) => x.v - y.v);
  return { club: Math.round(clubCoh(club)), team: teamCohesion(state, club), duos: pairs.slice(0, 6), clashes: pairs.filter((x) => x.clash && x.v < 35).slice(0, 5), integ };
}

/** Affinités d'un joueur (fiche joueur). */
export function playerLinks(state, p, club) {
  return club.playerIds.filter((id) => id !== p.id).map((id) => state.players[id]).filter(Boolean)
    .map((q) => ({ q, v: link(state, p, q), clash: clash(p, q) })).sort((x, y) => y.v - x.v);
}
