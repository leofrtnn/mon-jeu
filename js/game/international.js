/**
 * TOURNOIS INTERNATIONAUX (été, après la saison des clubs)
 * ------------------------------------------------------------------
 * Calendrier réel :
 *  - Coupe du monde : 2030, 2034… (48 équipes : 12 groupes, 32es de finale) ;
 *  - Euro (24 équipes) et Copa América (16) : 2028, 2032… ;
 *  - CAN (24), Coupe d'Asie (24), Gold Cup (16) : années impaires (Coupe d'Asie : 2027, 2031…).
 * Qualification : places par confédération, attribuées selon le classement Elo (les trêves
 * internationales de la saison servent d'éliminatoires et font bouger ce classement), le pays
 * hôte est qualifié d'office. Chaque match est simulé par le moteur avec les 23 meilleurs
 * joueurs aptes de la nation. Sélections, buts, parcours et blessures sont enregistrés sur
 * chaque joueur ; vos joueurs convoqués vous écrivent.
 */
import { createRng, hashSeed, clamp } from '../core/rng.js';
import { overall } from '../engine/ratings.js';
import { nationPools, nationRow } from './season.js';
import { confedOf, nationFlag, NATION_COUNTRY } from '../data/nations.js';
import { matchConditions, weatherMods } from './weather.js';
import { injuryLength, logInjury } from './injuries.js';
import { pushMessage } from './state.js';
import { forEachHuman } from './humans.js';

export const TOURNAMENTS = {
  wc: { name: 'Coupe du monde', short: 'Mondial', size: 48, quotas: { UEFA: 16, CAF: 9, AFC: 8, CONMEBOL: 6, CONCACAF: 6, OFC: 1 }, hosts: { 2030: 'Espagne', 2034: 'Arabie saoudite', 2038: 'Brésil' }, every: (y) => y % 4 === 2, icon: '🌍' },
  euro: { name: 'Euro', short: 'Euro', size: 24, quotas: { UEFA: 24 }, hosts: { 2028: 'Angleterre', 2032: 'Italie' }, every: (y) => y % 4 === 0, icon: '🇪🇺' },
  copa: { name: 'Copa América', short: 'Copa', size: 16, quotas: { CONMEBOL: 10, CONCACAF: 6 }, hosts: { 2028: 'États-Unis' }, every: (y) => y % 4 === 0, icon: '🌎' },
  afcon: { name: "Coupe d'Afrique des nations", short: 'CAN', size: 24, quotas: { CAF: 24 }, hosts: { 2027: 'Kenya', 2029: 'Maroc' }, every: (y) => y % 2 === 1, icon: '🌍' },
  asia: { name: "Coupe d'Asie", short: 'Coupe d\'Asie', size: 24, quotas: { AFC: 24 }, hosts: { 2027: 'Arabie saoudite', 2031: 'Qatar' }, every: (y) => y % 4 === 3, icon: '🌏' },
  gold: { name: 'Gold Cup', short: 'Gold Cup', size: 16, quotas: { CONCACAF: 16 }, hosts: { 2027: 'États-Unis', 2029: 'Mexique' }, every: (y) => y % 2 === 1, icon: '🌎' },
};

/** Année de l'été qui suit la saison en cours. */
export const summerYear = (state) => state.season + 1;

/** Tournois prévus un été donné. */
export const tournamentsIn = (year) => Object.keys(TOURNAMENTS).filter((k) => TOURNAMENTS[k].every(year));

/** Prochain grand tournoi d'une nation (pour nommer les éliminatoires). */
export function nextTournamentFor(state, nation) {
  for (let y = summerYear(state); y < summerYear(state) + 4; y++) {
    const k = tournamentsIn(y).find((key) => TOURNAMENTS[key].quotas[confedOf(nation)]);
    if (k) return { key: k, year: y, name: `${TOURNAMENTS[k].name} ${y}` };
  }
  return null;
}
/** Libellé d'une trêve : éliminatoires du prochain Mondial ou Euro. */
export function breakLabel(state) {
  for (let y = summerYear(state); y < summerYear(state) + 4; y++) {
    const k = tournamentsIn(y).find((x) => x === 'wc' || x === 'euro');
    if (k) return `Éliminatoires ${TOURNAMENTS[k].short} ${y}`;
  }
  return 'Matchs internationaux';
}

const STAGES = { 32: '32es de finale', 16: '8es de finale', 8: 'Quarts de finale', 4: 'Demi-finales', 2: 'Finale' };

const POS_W = { BU: 1, AG: 0.62, AD: 0.62, MO: 0.55, MC: 0.28, MG: 0.4, MD: 0.4, MDC: 0.12, DC: 0.1, DG: 0.08, DD: 0.08, GB: 0 };

/** Effectif d'une nation pour le tournoi : ses 23 meilleurs joueurs aptes, complétés par des joueurs du championnat local. */
function squadOf(state, T, nation) {
  if (T.squads[nation]) return T.squads[nation];
  const real = (T.pools[nation] || []).filter((p) => !(p.injury > 0)).slice(0, 23);
  const xi = real.slice(0, 11);
  const ovr = xi.map(overall);
  // Joueurs « locaux » (hors des championnats du jeu) : niveau selon la profondeur de la sélection.
  const filler = clamp(Math.round((ovr.length ? Math.min(...ovr) : 58) - 6), 46, 68);
  while (ovr.length < 11) ovr.push(filler);
  const str = ovr.reduce((a, b) => a + b, 0) / 11;
  return (T.squads[nation] = { real, xi, str, filler: 11 - xi.length });
}

/** Force d'une nation : effectif (surtout) et dynamique récente (Elo). */
function power(state, T, n) {
  const sq = squadOf(state, T, n);
  return 1500 + (sq.str - 70) * 28 + (nationRow(state, n).elo - 1500) * 0.35;
}

function poisson(rng, l) {
  const L = Math.exp(-l); let k = 0, p = 1;
  do { k++; p *= rng.next(); } while (p > L && k < 12);
  return k - 1;
}

/** Un match du tournoi (modèle rapide fondé sur la force des effectifs) ; met à jour Elo, sélections, buts, blessures. */
function play(state, T, h, a, ko, rng, rec) {
  const date = `${T.year}-${ko ? '07' : '06'}-${String(10 + (T.played++ % 20)).padStart(2, '0')}`;
  const w = matchConditions({ seed: state.seed + T.year, country: T.country, date, comp: 'intl', h, a });
  const wx = weatherMods(w);
  const dr = (power(state, T, h) - power(state, T, a) + (h === T.host ? 60 : a === T.host ? -60 : 0)) / 400;
  const base = 1.22 * (wx.aim || 1);
  const lh = clamp(base * Math.exp(dr * 1.15), 0.15, 4.5), la = clamp(base * Math.exp(-dr * 1.15), 0.15, 4.5);
  let g0 = poisson(rng, lh), g1 = poisson(rng, la), et = false, pens = null;
  if (ko && g0 === g1) {
    et = true; g0 += poisson(rng, lh / 3); g1 += poisson(rng, la / 3);
    if (g0 === g1) {
      let p0 = 0, p1 = 0;
      for (let k = 0; k < 5 || p0 === p1; k++) { if (rng.chance(0.76)) p0++; if (rng.chance(0.76)) p1++; if (k > 15) { p0++; break; } }
      pens = [p0, p1];
    }
  }
  // Elo (coefficient fort en phase finale de grand tournoi).
  const A = nationRow(state, h), B = nationRow(state, a);
  const exp = 1 / (1 + Math.pow(10, (B.elo - A.elo) / 400));
  const res = g0 > g1 ? 1 : g0 === g1 ? 0.5 : 0;
  const k = (T.key === 'wc' ? 60 : 50) * (1 + Math.min(3, Math.abs(g0 - g1)) * 0.25);
  A.elo = Math.round(A.elo + k * (res - exp)); B.elo = Math.round(B.elo - k * (res - exp));
  for (const [r, gf, ga] of [[A, g0, g1], [B, g1, g0]]) { r.p++; r.gf += gf; r.ga += ga; if (gf > ga) r.w++; else if (gf === ga) r.d++; else r.l++; }
  // Joueurs : titulaires (les 11 meilleurs), 3 entrants ; buteurs selon le poste et la finition.
  for (const [n, gf, ga] of [[h, g0, g1], [a, g1, g0]]) {
    const sq = squadOf(state, T, n);
    const bench = rng.shuffle(sq.real.slice(11)).slice(0, 3);
    const used = [...sq.xi, ...bench];
    const wts = used.map((p, i) => (POS_W[p.pos] ?? 0.2) * ((p.attrs?.tir ?? 60) / 70) ** 1.5 * (i >= 11 ? 0.35 : 1));
    const fillW = sq.filler * 0.3;
    const tot = wts.reduce((x, y) => x + y, 0) + fillW;
    const goals = new Map();
    for (let g = 0; g < gf; g++) {
      let r = rng.next() * tot;
      const idx = wts.findIndex((x) => (r -= x) < 0);
      if (idx >= 0) goals.set(used[idx], (goals.get(used[idx]) || 0) + 1);
    }
    const assists = new Map();
    for (const [, c] of goals) for (let i = 0; i < c; i++) if (rng.chance(0.7)) { const p = rng.pick(used); assists.set(p, (assists.get(p) || 0) + 1); }
    for (const p of used) {
      const tr = (rec[p.id] ||= { nation: n, apps: 0, goals: 0, assists: 0, rs: 0 });
      const gl = goals.get(p) || 0;
      tr.apps++; tr.goals += gl; tr.assists += assists.get(p) || 0;
      tr.rs += clamp(6.4 + (gf > ga ? 0.4 : gf < ga ? -0.4 : 0) + gl * 0.9 + (assists.get(p) || 0) * 0.5 - (p.pos === 'GB' || ['DC', 'DG', 'DD'].includes(p.pos) ? ga * 0.25 : 0) + rng.normal(0, 0.45), 4, 10);
      p.caps = (p.caps || 0) + 1; p.intGoals = (p.intGoals || 0) + gl;
      p.summerLoad = (p.summerLoad || 0) + 1;
      if (gl) T.scorers[p.id] = (T.scorers[p.id] || 0) + gl;
      if (!p.injury && rng.chance(0.012 * (wx.injury || 1))) {
        p.injury = rng.int(1, 9);
        p.injuryName = rng.pick(['Élongation', 'Entorse de la cheville', 'Lésion aux ischios', 'Déchirure musculaire', 'Contusion']);
        logInjury(state, p, `${T.name} ${T.year}`, date);
        delete T.squads[n]; // l'effectif est recomposé pour le match suivant
      }
    }
  }
  const win = ko ? (pens ? (pens[0] > pens[1] ? h : a) : g0 > g1 ? h : a) : null;
  return { h, a, s: [g0, g1], et: et || undefined, pens, w: win, wx: w.icon };
}

/** Nations engagées : toutes celles qui ont des joueurs dans le jeu (complétées par des joueurs locaux). */
function contenders(state, T) {
  return Object.keys(T.pools).filter((n) => T.pools[n].length >= 3);
}

/** Sélection des qualifiés : quotas par confédération selon la force et l'Elo (hôte qualifié d'office). */
function qualify(state, T, def, host, rng) {
  const all = contenders(state, T);
  const rank = all.map((n) => ({ n, v: power(state, T, n) + rng.normal(0, 45) })).sort((x, y) => y.v - x.v);
  const out = host && all.includes(host) ? [host] : [];
  for (const [conf, q] of Object.entries(def.quotas)) {
    const have = out.filter((x) => confedOf(x) === conf).length;
    out.push(...rank.filter((r) => confedOf(r.n) === conf && !out.includes(r.n)).slice(0, Math.max(0, q - have)).map((r) => r.n));
  }
  // Places restantes (Mondial : barrages intercontinentaux) : meilleures nations des confédérations concernées.
  const confs = Object.keys(def.quotas);
  for (const r of rank) { if (out.length >= def.size) break; if (!out.includes(r.n) && confs.includes(confedOf(r.n))) out.push(r.n); }
  return out.slice(0, def.size);
}

/** Joue un tournoi complet. */
export function runTournament(state, key, year) {
  const def = TOURNAMENTS[key];
  const rng = createRng(hashSeed(`${state.seed}-tournoi-${key}-${year}`));
  const confNations = (n) => Object.keys(def.quotas).includes(confedOf(n));
  const T = { key, year, name: def.name, host: null, country: 'FRA', played: 0, scorers: {}, pools: nationPools(state), squads: {} };
  let host = def.hosts[year] || null;
  const elig = contenders(state, T);
  if (!host || !elig.includes(host)) host = rng.pick(elig.filter(confNations).map((n) => ({ n, v: power(state, T, n) })).sort((x, y) => y.v - x.v).slice(0, 12).map((x) => x.n)) || null;
  T.host = host; T.country = NATION_COUNTRY[host] || 'FRA';
  let teams = qualify(state, T, def, host, rng);
  // Format : groupes de 4 (12, 8, 6, 4, 3 ou 2 groupes) ; 2 premiers + meilleurs 3es.
  const G = [12, 8, 6, 4, 3, 2].find((g) => g * 4 <= teams.length);
  if (!G) return null;
  teams = teams.slice(0, G * 4);
  const Q = 2 ** Math.floor(Math.log2(3 * G));
  const rec = {};
  // Tirage par chapeaux (Elo).
  const elo = (n) => power(state, T, n);
  const sorted = teams.slice().sort((x, y) => (x === host ? -1 : y === host ? 1 : elo(y) - elo(x)));
  const groups = Array.from({ length: G }, () => []);
  for (let pot = 0; pot < 4; pot++) {
    const potT = rng.shuffle(sorted.slice(pot * G, pot * G + G));
    if (pot === 0 && potT.includes(host)) { potT.splice(potT.indexOf(host), 1); potT.unshift(host); }
    potT.forEach((n, i) => groups[i].push(n));
  }
  const gRes = groups.map((g, gi) => {
    const tab = Object.fromEntries(g.map((n) => [n, { n, p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, pts: 0 }]));
    const games = [];
    for (const [i, j] of [[0, 1], [2, 3], [0, 2], [1, 3], [3, 0], [1, 2]]) {
      const r = play(state, T, g[i], g[j], false, rng, rec);
      games.push(r);
      for (const [n, gf, ga] of [[r.h, r.s[0], r.s[1]], [r.a, r.s[1], r.s[0]]]) {
        const t = tab[n]; t.p++; t.gf += gf; t.ga += ga;
        if (gf > ga) { t.w++; t.pts += 3; } else if (gf === ga) { t.d++; t.pts++; } else t.l++;
      }
    }
    const table = Object.values(tab).sort((x, y) => y.pts - x.pts || (y.gf - y.ga) - (x.gf - x.ga) || y.gf - x.gf || elo(y.n) - elo(x.n));
    return { name: String.fromCharCode(65 + gi), table, games };
  });
  const cmp = (x, y) => y.pts - x.pts || (y.gf - y.ga) - (x.gf - x.ga) || y.gf - x.gf;
  const firsts = gRes.map((g) => g.table[0]).sort(cmp), seconds = gRes.map((g) => g.table[1]).sort(cmp);
  const thirds = gRes.map((g) => g.table[2]).sort(cmp).slice(0, Math.max(0, Q - 2 * G));
  const quals = [...firsts, ...seconds, ...thirds].slice(0, Q).map((t) => t.n);
  // Tableau : 1er contre dernier qualifié, etc. (ordre de tableau classique).
  const order = (n) => (n === 1 ? [0] : order(n / 2).flatMap((i) => [i, n - 1 - i]));
  let alive = order(Q).map((i) => quals[i]);
  const rounds = [];
  const elim = {};
  for (const n of teams) elim[n] = quals.includes(n) ? null : 'Phase de groupes';
  while (alive.length > 1) {
    const label = STAGES[alive.length] || `Tour à ${alive.length}`;
    const games = [];
    for (let i = 0; i < alive.length; i += 2) {
      const r = play(state, T, alive[i], alive[i + 1], true, rng, rec);
      games.push(r);
      elim[r.w === r.h ? r.a : r.h] = label;
    }
    rounds.push({ label, games });
    alive = games.map((g) => g.w);
  }
  const winner = alive[0];
  const final = rounds[rounds.length - 1].games[0];
  elim[winner] = 'Vainqueur';
  if (final) elim[final.w === final.h ? final.a : final.h] = 'Finaliste';
  const top = Object.entries(T.scorers).sort((x, y) => y[1] - x[1]).slice(0, 6).map(([id, g]) => ({ id: +id, name: state.players[id]?.name || '?', nation: rec[id]?.nation, g }));
  // Parcours des joueurs.
  for (const [id, r] of Object.entries(rec)) {
    const p = state.players[id];
    if (!p) continue;
    (p.tourns ||= []).push({ y: year, k: key, name: `${def.name} ${year}`, nation: r.nation, apps: r.apps, goals: r.goals, assists: r.assists, avg: r.apps ? Math.round((r.rs / r.apps) * 10) / 10 : null, stage: elim[r.nation] || '—' });
    if (elim[r.nation] === 'Vainqueur') { (p.honoursInt ||= []).push(`${def.name} ${year}`); p.morale = clamp((p.morale ?? 60) + 10, 5, 99); }
  }
  const res = { key, year, name: def.name, icon: def.icon, host, winner, runnerUp: final ? (final.w === final.h ? final.a : final.h) : null, final, groups: gRes, rounds, elim, top, size: teams.length };
  // Messages : joueurs de chaque manager convoqués.
  forEachHuman(state, () => {
    const ucId = state.userClubId;
    const mine = Object.entries(rec).map(([id, r]) => ({ p: state.players[id], r })).filter((x) => x.p?.clubId === ucId && x.r.apps > 0);
    if (mine.length) {
      pushMessage(state, { prio: 2, icon: def.icon, title: `${def.name} ${year} : vos internationaux`,
        text: mine.slice(0, 8).map((x) => `${nationFlag(x.r.nation)} ${x.p.name} — ${x.r.apps} match(s), ${x.r.goals} but(s) · ${elim[x.r.nation] || ''}`).join('\n') + (mine.some((x) => x.p.summerLoad >= 5) ? '\nCertains reviendront tard et fatigués : ménagez-les en préparation.' : '') });
    }
    pushMessage(state, { prio: 3, icon: '🏆', title: `${nationFlag(winner)} ${winner} remporte ${def.name === 'Euro' ? "l'" : 'la '}${def.name} ${year}`,
      text: final ? `Finale : ${final.h} ${final.s[0]}-${final.s[1]}${final.pens ? ` (${final.pens[0]}-${final.pens[1]} t.a.b.)` : ''} ${final.a}. Meilleur buteur : ${top[0] ? `${top[0].name} (${top[0].g})` : '—'}.` : '' });
  });
  return res;
}

/** Tous les tournois de l'été (appelé en fin de saison, avant le vieillissement). */
export function runSummerTournaments(state, year = summerYear(state)) {
  const out = [];
  for (const key of tournamentsIn(year)) {
    const r = runTournament(state, key, year);
    if (!r) continue;
    out.push(r);
  }
  if (!out.length) return out;
  state.intlT ||= { last: {}, history: [] };
  for (const r of out) {
    state.intlT.last[r.key] = r; // détail complet du dernier tournoi de chaque type
    state.intlT.history.unshift({ key: r.key, year: r.year, name: r.name, host: r.host, winner: r.winner, runnerUp: r.runnerUp, final: r.final ? { s: r.final.s, pens: r.final.pens } : null, top: r.top[0] || null });
  }
  state.intlT.history = state.intlT.history.slice(0, 80);
  return out;
}

/** Palmarès d'une nation (titres du jeu). */
export const nationTitles = (state, n) => (state.intlT?.history || []).filter((h) => h.winner === n);
