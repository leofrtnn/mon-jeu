/**
 * MOTEUR DE SIMULATION DE MATCH
 * ------------------------------------------------------------------
 * Simulation minute par minute (90' + temps additionnel). Chaque minute contient
 * 3 à 5 "actions" : le porteur du ballon choisit une action (passe courte, longue,
 * dribble, centre, tir) selon la zone, la tactique et ses attributs ; un défenseur
 * adverse la conteste. Les probabilités dépendent des attributs effectifs
 * (attribut * condition * adaptation au poste * contexte d'équipe).
 *
 * Aucune issue n'est prédéterminée : les statistiques (possession, tirs, xG,
 * fautes, corners, cartons) émergent de la succession d'actions.
 *
 * Conventions :
 *  - side 0 = domicile, side 1 = extérieur.
 *  - zone (du point de vue de l'équipe en possession) : 0 défense, 1 milieu,
 *    2 attaque, 3 surface adverse.
 *  - coordonnées absolues des événements : x ∈ [0,1] (0 = but domicile,
 *    1 = but extérieur), y ∈ [0,1]. Le domicile attaque vers x = 1.
 *
 * API principale :
 *  createMatch(cfg) -> état du match
 *  stepMinute(m)    -> liste des événements de la minute (pour l'affichage)
 *  simulateMatch(cfg) -> état final (simulation rapide complète)
 *  makeSub / changeFormation / setTactic : interventions pendant le match
 *  summarize(m)     -> résumé (score, stats, notes, homme du match)
 */
import { createRng, clamp } from '../core/rng.js';
import { FORMATIONS, MAX_SUBS, positionFit } from '../data/constants.js';
import { conditionFactor, ratingAt } from './ratings.js';
import { aiManage } from './ai.js';

const ZONE_DEPTH = [[0.1, 0.33], [0.33, 0.58], [0.58, 0.8], [0.81, 0.94]];
const ZONE_CENTER = [0.2, 0.45, 0.68, 0.87];
const LVL = { low: -1, mid: 0, high: 1 };
const MENT = { defensive: -1, balanced: 0, offensive: 1 };
const sigmoid = (x) => 1 / (1 + Math.exp(-x));

/* ------------------------------------------------------------------ */
/* Création                                                            */
/* ------------------------------------------------------------------ */

function makeMatchPlayer(p, slot, onPitch) {
  return {
    id: p.id, p, name: p.name, number: p.number, pos: p.pos, slot,
    energy: clamp(100 - (p.fatigue || 0), 35, 100),
    yellow: 0, red: false, injured: false, onPitch,
    rating: 6.0, goals: 0, assists: 0, shots: 0, passes: 0, passesOk: 0,
    tackles: 0, saves: 0, keyPasses: 0, fouls: 0,
    minIn: onPitch ? 0 : null, minOut: null, mult: 1, morale: p.morale ?? 50,
  };
}

function makeTeam(cfg, side) {
  const byId = new Map(cfg.players.map((p) => [p.id, p]));
  const slots = FORMATIONS[cfg.tactics.formation].map((s) => ({ ...s }));
  const onPitch = cfg.lineup.map((id, i) => {
    const p = byId.get(id);
    return p ? makeMatchPlayer(p, i, true) : null;
  });
  const bench = (cfg.bench || []).map((id) => byId.get(id)).filter(Boolean).map((p) => makeMatchPlayer(p, -1, false));
  return {
    side, club: cfg.club, tactics: { ...cfg.tactics }, slots, onPitch, bench, out: [],
    subsUsed: 0, isAI: !!cfg.isAI, talk: 0,
    stats: { poss: 0, shots: 0, onTarget: 0, xg: 0, passes: 0, passesOk: 0, fouls: 0, corners: 0,
      yellows: 0, reds: 0, offsides: 0, saves: 0, tackles: 0, dribbles: 0 },
  };
}

/**
 * cfg : { home, away, seed, neutral, cup, varEnabled }
 * home/away : { club, players[], lineup[11 ids], bench[ids], tactics, isAI }
 */
export function createMatch(cfg) {
  const rng = createRng(cfg.seed ?? 1);
  const m = {
    rng, seed: cfg.seed ?? 1, neutral: !!cfg.neutral, cup: !!cfg.cup, varEnabled: cfg.varEnabled !== false,
    teams: [makeTeam(cfg.home, 0), makeTeam(cfg.away, 1)],
    phase: 'pre', period: 1, minute: 0, extra: 0, added: [0, 0], stoppages: 0,
    score: [0, 0], poss: 0, zone: 1, carrier: null, counter: 0, setPiece: null,
    momentum: 0, momentumHistory: [], log: [], goals: [], lastPasser: null,
    shootout: null,
  };
  return m;
}

/* ------------------------------------------------------------------ */
/* Utilitaires                                                         */
/* ------------------------------------------------------------------ */

export const activePlayers = (t) => t.onPitch.filter((mp) => mp && !mp.red && !mp.injured);

/** Attribut effectif (condition, poste, contexte). */
function eff(mp, attr) {
  return mp.p.attrs[attr] * mp.mult;
}

/** Profondeur d'un slot, ajustée par la mentalité et le pressing de l'équipe. */
function slotDepth(t, mp) {
  const s = t.slots[mp.slot];
  if (s.pos === 'GB') return 0.04;
  return s.x + MENT[t.tactics.mentality] * 0.04 + LVL[t.tactics.pressing] * 0.02;
}

/** Tirage pondéré d'un joueur proche d'une profondeur donnée. */
function pickNear(m, t, depth, exclude, bias) {
  const list = activePlayers(t).filter((mp) => mp !== exclude);
  if (!list.length) return exclude;
  const w = list.map((mp) => {
    const s = t.slots[mp.slot];
    if (s.pos === 'GB') return depth < 0.25 ? 0.12 : 0.0001;
    const d = slotDepth(t, mp) - depth;
    let v = Math.exp(-(d * d) / (2 * 0.13 * 0.13)) + 0.02;
    if (bias) v *= bias(mp, s);
    return v;
  });
  return list[m.rng.weightedIndex(w)];
}

/** Coordonnées absolues pour une profondeur/latéral du point de vue de `side`. */
function abs(side, depth, lat) {
  return side === 0 ? { x: depth, y: lat } : { x: 1 - depth, y: 1 - lat };
}

/** Position du ballon après une action : zone + couloir du joueur concerné. */
function ballPos(m, side, zone, mp) {
  const t = m.teams[side];
  const [a, b] = ZONE_DEPTH[zone];
  const depth = m.rng.range(a, b);
  let lat = mp ? t.slots[mp.slot].y + m.rng.normal(0, 0.07) : m.rng.range(0.2, 0.8);
  if (zone === 3) lat = 0.5 + (lat - 0.5) * 0.55;
  return abs(side, depth, clamp(lat, 0.04, 0.96));
}

function addRating(mp, v) { if (mp) mp.rating = clamp(mp.rating + v, 3, 10); }

/** Multiplicateurs mis à jour chaque minute (fatigue, forme, moral, poste, contexte). */
function refreshMultipliers(m) {
  for (const t of m.teams) {
    const n = activePlayers(t).length;
    const home = !m.neutral && t.side === 0 ? 1.025 : 1;
    const numbers = 1 - 0.055 * (11 - n);
    for (const mp of t.onPitch) {
      if (!mp) continue;
      const fit = positionFit(mp.p.pos, t.slots[mp.slot].pos);
      const pm = { form: mp.p.form, morale: clamp(mp.morale + t.talk, 0, 100) };
      mp.mult = conditionFactor(pm, mp.energy) * fit * home * numbers;
    }
  }
}

/* ------------------------------------------------------------------ */
/* Événements                                                          */
/* ------------------------------------------------------------------ */

const KEY_TYPES = new Set(['goal', 'shot', 'yellow', 'red', 'penalty', 'injury', 'sub', 'var', 'ht', 'ft', 'kickoff', 'added', 'post', 'save', 'freekick']);

function emit(m, out, ev) {
  ev.minute = m.minute; ev.extra = m.extra; ev.period = m.period;
  ev.poss = m.poss; ev.carrier = m.carrier ? m.carrier.id : null;
  ev.score = [m.score[0], m.score[1]];
  ev.key = KEY_TYPES.has(ev.type);
  out.push(ev);
  if (ev.key && ev.type !== 'kickoff') m.log.push(ev);
  return ev;
}

function changePossession(m, side, zone, carrier) {
  m.poss = side; m.zone = zone; m.carrier = carrier;
  m.lastPasser = null;
}

function momentum(m, side, v) {
  m.momentum = clamp(m.momentum + (side === 0 ? v : -v), -100, 100);
}

/* ------------------------------------------------------------------ */
/* Résolution des actions                                              */
/* ------------------------------------------------------------------ */

function chooseAction(m, A, c) {
  const z = m.zone, mv = MENT[A.tactics.mentality], tv = LVL[A.tactics.tempo], wv = LVL[A.tactics.width];
  const s = A.slots[c.slot];
  const wide = s.y < 0.3 || s.y > 0.7;
  const tir = eff(c, 'tir'), dri = eff(c, 'dri');
  const shotK = 0.55 + tir / 110;
  const driK = 0.5 + dri / 100;
  let w;
  if (s.pos === 'GB') return m.rng.chance(0.55 + tv * 0.1) ? 'long' : 'short';
  switch (z) {
    case 0: w = { short: 6, long: 2 + tv * 0.6, dribble: 0.6 * driK, cross: 0, shot: 0 }; break;
    case 1: w = { short: 5.5, long: 1.5 + tv * 0.4, dribble: 1.3 * driK + mv * 0.2, cross: 0, shot: (0.07 + mv * 0.03) * shotK }; break;
    case 2: w = { short: 4, long: 0.5, dribble: (1.9 + mv * 0.3) * driK, cross: (0.8 + wv * 0.35) * (wide ? 1.6 : 0.25), shot: (0.36 + mv * 0.1) * shotK }; break;
    default: w = { short: 2.2, long: 0, dribble: 1.4 * driK, cross: wide ? 0.6 : 0.15, shot: (1.45 + mv * 0.25) * shotK };
  }
  // Fin de match : l'équipe menée prend plus de risques.
  const diff = m.score[A.side] - m.score[1 - A.side];
  if (m.minute > 75 && diff < 0) { w.shot *= 1.25; w.long *= 1.3; w.cross *= 1.2; }
  const keys = Object.keys(w);
  return keys[m.rng.weightedIndex(keys.map((k) => Math.max(0, w[k])))];
}

/** Contexte défensif : bonus selon mentalité et pressing du défenseur. */
function defContext(D, zone) {
  const pv = LVL[D.tactics.pressing], dm = MENT[D.tactics.mentality];
  // zone = zone de l'attaquant. Pressing haut gêne la relance (zones 0/1),
  // bloc bas protège la surface (zones 2/3).
  if (zone <= 1) return pv * 0.22 + dm * 0.1;
  return -pv * 0.06 - dm * 0.18;
}

/** Résout une action ; pousse les événements dans `out`. */
function resolveAction(m, out) {
  const A = m.teams[m.poss], D = m.teams[1 - m.poss];
  let c = m.carrier;
  if (!c || !c.onPitch || c.red || c.injured) {
    c = m.carrier = pickNear(m, A, ZONE_CENTER[m.zone]);
  }
  A.stats.poss++;
  momentum(m, A.side, [0, 0.3, 1.1, 2.4][m.zone]);
  const z = m.zone;
  const act = chooseAction(m, A, c);
  const ctx = defContext(D, z);
  const counter = m.counter > 0 ? 0.45 : 0;
  if (m.counter > 0) m.counter--;
  const def = pickNear(m, D, 1 - ZONE_CENTER[z]);

  if (act === 'shot') return shoot(m, out, A, D, c, z, { type: 'open' });

  if (act === 'short' || act === 'long') {
    const long = act === 'long';
    let nz = z;
    if (long) nz = Math.min(3, z + (m.rng.chance(z === 0 ? 0.55 : 0.35) ? 2 : 1));
    else if (z > 0 && m.rng.chance(0.08)) nz = z - 1;
    else if (z < 3 && m.rng.chance([0.3, 0.27, 0.16][z] + MENT[A.tactics.mentality] * 0.05 + LVL[A.tactics.tempo] * 0.04 + counter * 0.3)) nz = z + 1;
    if (nz === 3 && z < 2) nz = 2;
    const skill = long ? eff(c, 'pas') * 0.55 + eff(c, 'vis') * 0.35 + eff(c, 'phy') * 0.1
      : eff(c, 'pas') * 0.6 + eff(c, 'vis') * 0.25 + eff(c, 'sf') * 0.15;
    const dskill = long ? eff(def, 'phy') * 0.4 + eff(def, 'def') * 0.4 + eff(def, 'vit') * 0.2
      : eff(def, 'def') * 0.5 + eff(def, 'vit') * 0.25 + eff(def, 'vis') * 0.25;
    let base = long ? [0.9, 0.5, 0.2, 0][z] : [2.7, 2.1, 1.45, 0.7][z];
    if (nz > z) base -= long ? 0.2 : 0.55;
    if (nz < z) base += 0.8;
    const p = sigmoid(base + (skill - dskill) / 13 - ctx + counter);
    A.stats.passes++; c.passes++;
    const target = pickNear(m, A, ZONE_CENTER[nz], c);
    if (m.rng.chance(p)) {
      A.stats.passesOk++; c.passesOk++;
      addRating(c, nz > z ? 0.03 : 0.008);
      m.lastPasser = c;
      const pos = ballPos(m, A.side, nz, target);
      m.zone = nz; m.carrier = target;
      if (nz === 3) { c.keyPasses++; addRating(c, 0.04); }
      emit(m, out, { type: long ? 'longpass' : 'pass', side: A.side, pid: c.id, pid2: target.id, ...pos, zone: nz });
      return;
    }
    // Échec : hors-jeu possible sur les ballons en profondeur.
    addRating(c, -0.04);
    if (nz >= 2 && nz > z && m.rng.chance(long ? 0.22 : 0.07)) {
      A.stats.offsides++;
      const pos = ballPos(m, D.side, 0, def);
      changePossession(m, D.side, 0, pickNear(m, D, 0.2));
      emit(m, out, { type: 'offside', side: A.side, pid: target.id, ...pos, zone: 0 });
      return;
    }
    // Faute "tactique" pour casser une relance ou un contre.
    if (z <= 2 && m.rng.chance(0.1 * (1 + LVL[D.tactics.pressing] * 0.3))) return foul(m, out, A, D, target, def, z);
    return turnover(m, out, A, D, c, def, z, long ? 'header' : 'interception');
  }

  if (act === 'dribble') {
    const skill = eff(c, 'dri') * 0.55 + eff(c, 'vit') * 0.3 + eff(c, 'phy') * 0.15;
    const dskill = eff(def, 'def') * 0.55 + eff(def, 'vit') * 0.25 + eff(def, 'phy') * 0.2;
    const base = [0.3, 0.15, -0.15, -0.5][z];
    const p = sigmoid(base + (skill - dskill) / 11 - ctx + counter);
    A.stats.dribbles++;
    if (m.rng.chance(p)) {
      addRating(c, 0.07);
      let nz = z;
      if (z < 3 && m.rng.chance(z === 2 ? 0.42 : 0.55)) nz = z + 1;
      const pos = ballPos(m, A.side, nz, c);
      m.zone = nz;
      emit(m, out, { type: 'dribble', side: A.side, pid: c.id, pid2: def.id, ...pos, zone: nz });
      if (nz === 3 && m.rng.chance(0.25)) return shoot(m, out, A, D, c, 3, { type: 'open', bonus: 1.35 });
      return;
    }
    // Tacle : faute possible.
    const aggr = 1 + LVL[D.tactics.pressing] * 0.18 + (m.minute > 70 ? 0.1 : 0);
    const foulP = (z === 3 ? 0.1 : 0.5) * aggr * (1.25 - eff(def, 'def') / 200);
    if (m.rng.chance(foulP)) return foul(m, out, A, D, c, def, z);
    addRating(c, -0.04);
    return turnover(m, out, A, D, c, def, z, 'tackle');
  }

  if (act === 'cross') return cross(m, out, A, D, c, z, false);
}

/** Récupération du ballon par la défense. */
function turnover(m, out, A, D, c, def, z, how) {
  def.tackles++; D.stats.tackles++;
  addRating(def, 0.06);
  let dz = [2, 1, 0, 0][z];
  if (z === 2 && m.rng.chance(0.4)) dz = 1;
  if (z === 1 && m.rng.chance(0.3)) dz = 0;
  // Contre-attaque si l'adversaire est découvert.
  if (dz >= 1 && (MENT[A.tactics.mentality] > 0 || m.rng.chance(0.15))) m.counter = 2;
  const pos = ballPos(m, D.side, dz, def);
  changePossession(m, D.side, dz, def);
  emit(m, out, { type: how, side: D.side, pid: def.id, pid2: c.id, ...pos, zone: dz, counter: m.counter > 0 });
  momentum(m, D.side, 1);
}

/** Centre (ou corner si corner=true). */
function cross(m, out, A, D, c, z, corner) {
  const target = pickNear(m, A, 0.86, c, (mp, s) => (s.pos === 'BU' ? 2.2 : 1) * (0.5 + eff(mp, 'phy') / 120));
  const marker = pickNear(m, D, 0.14, null, (mp, s) => (s.pos === 'DC' ? 2 : 1));
  const delivery = eff(c, 'pas') * 0.7 + eff(c, 'vis') * 0.3;
  const aerial = eff(target, 'phy') * 0.5 + eff(target, 'tir') * 0.3 + eff(target, 'sf') * 0.2;
  const dAerial = eff(marker, 'phy') * 0.5 + eff(marker, 'def') * 0.5;
  const base = corner ? -1.45 : -1.8;
  const p = sigmoid(base + (delivery - 65) / 30 + (aerial - dAerial) / 14 + defContext(D, 3) * -0.5);
  if (!corner) { A.stats.passes++; c.passes++; }
  const pos = ballPos(m, A.side, 3, target);
  emit(m, out, { type: corner ? 'cornerkick' : 'cross', side: A.side, pid: c.id, pid2: target.id, ...pos, zone: 3 });
  if (m.rng.chance(p)) {
    if (!corner) { A.stats.passesOk++; c.passesOk++; }
    m.lastPasser = c; m.carrier = target; m.zone = 3;
    c.keyPasses++; addRating(c, 0.05);
    return shoot(m, out, A, D, target, 3, { type: 'header' });
  }
  // Dégagé.
  addRating(marker, 0.05);
  if (m.rng.chance(corner ? 0.18 : 0.26)) return awardCorner(m, out, A, marker);
  if (m.rng.chance(0.22)) {
    // Second ballon récupéré par l'attaque.
    const rec = pickNear(m, A, 0.66, null);
    m.carrier = rec; m.zone = 2;
    const p2 = ballPos(m, A.side, 2, rec);
    emit(m, out, { type: 'clearance', side: D.side, pid: marker.id, ...p2, zone: 2, second: true });
    return;
  }
  const dz = m.rng.chance(0.5) ? 0 : 1;
  const rec = pickNear(m, D, ZONE_CENTER[dz]);
  const p3 = ballPos(m, D.side, dz, rec);
  changePossession(m, D.side, dz, rec);
  emit(m, out, { type: 'clearance', side: D.side, pid: marker.id, ...p3, zone: dz });
}

function awardCorner(m, out, A, by) {
  A.stats.corners++;
  momentum(m, A.side, 2);
  const right = m.rng.chance(0.5);
  const pos = abs(A.side, 0.995, right ? 0.99 : 0.01);
  const taker = activePlayers(A).filter((mp) => A.slots[mp.slot].pos !== 'GB')
    .sort((a, b) => eff(b, 'pas') - eff(a, 'pas'))[0];
  m.carrier = taker; m.zone = 3;
  emit(m, out, { type: 'corner', side: A.side, pid: taker.id, pid2: by ? by.id : null, ...pos, zone: 3 });
  m.stoppages += 0.1;
  return cross(m, out, A, D_of(m, A), taker, 3, true);
}
const D_of = (m, A) => m.teams[1 - A.side];

/** Faute : coup franc, penalty, cartons, blessures. */
function foul(m, out, A, D, victim, offender, z) {
  D.stats.fouls++; offender.fouls++;
  addRating(offender, -0.06);
  const pos = ballPos(m, A.side, z, victim);
  emit(m, out, { type: 'foul', side: D.side, pid: offender.id, pid2: victim.id, ...pos, zone: z });
  m.stoppages += 0.15;
  // Cartons.
  let yP = 0.135 + (z === 1 || z === 2 ? 0.05 : 0) + (m.minute > 75 ? 0.04 : 0) + (m.counter ? 0.06 : 0) + (z === 3 ? 0.08 : 0);
  if (offender.yellow) yP *= 0.45; // un joueur averti se retient
  if (m.rng.chance(0.003)) sendOff(m, out, D, offender, 'direct');
  else if (m.rng.chance(yP)) {
    offender.yellow++; D.stats.yellows++;
    addRating(offender, -0.3);
    if (offender.yellow >= 2) sendOff(m, out, D, offender, 'second');
    else emit(m, out, { type: 'yellow', side: D.side, pid: offender.id, ...pos, zone: z });
  }
  // Blessure sur faute.
  if (m.rng.chance(0.012)) injure(m, out, A, victim);
  m.counter = 0;
  m.carrier = victim.onPitch && !victim.injured ? victim : pickNear(m, A, ZONE_CENTER[z]);
  if (z === 3) return penalty(m, out, A, D);
  if (z === 2) {
    const fk = emit(m, out, { type: 'freekick', side: A.side, pid: m.carrier.id, ...pos, zone: 2 });
    if (m.rng.chance(0.15)) {
      const taker = activePlayers(A).filter((mp) => A.slots[mp.slot].pos !== 'GB')
        .sort((a, b) => (eff(b, 'tir') + eff(b, 'sf')) - (eff(a, 'tir') + eff(a, 'sf')))[0];
      fk.pid = taker.id; fk.direct = true;
      return shoot(m, out, A, D, taker, 2, { type: 'freekick' });
    }
    return cross(m, out, A, D, m.carrier, 2, false);
  }
}

function sendOff(m, out, T, mp, kind) {
  mp.red = true; mp.onPitch = false; mp.minOut = m.minute;
  T.stats.reds++;
  addRating(mp, -1.5);
  emit(m, out, { type: 'red', side: T.side, pid: mp.id, kind, x: 0.5, y: 0.5, zone: m.zone });
  if (m.carrier === mp) m.carrier = null;
  m.stoppages += 0.5;
}

function injure(m, out, T, mp) {
  if (mp.injured || !mp.onPitch) return;
  mp.injured = true;
  emit(m, out, { type: 'injury', side: T.side, pid: mp.id, x: 0.5, y: 0.5, zone: m.zone });
  m.stoppages += 0.6;
  // Remplacement automatique si possible.
  const sub = bestBenchFor(T, mp.slot);
  if (sub && T.subsUsed < MAX_SUBS) doSub(m, out, T, mp, sub, true);
  else { mp.onPitch = false; mp.minOut = m.minute; }
  if (m.carrier === mp) m.carrier = null;
}

/** Meilleur remplaçant pour un slot donné. */
export function bestBenchFor(T, slot) {
  const pos = T.slots[slot].pos;
  let best = null, bs = -1;
  for (const b of T.bench) {
    if (b.onPitch || b.minOut != null) continue;
    const sc = ratingAt(b.p, pos) * (0.7 + 0.3 * b.energy / 100);
    if (sc > bs) { bs = sc; best = b; }
  }
  return best;
}

function doSub(m, out, T, outMp, inMp, forced) {
  inMp.slot = outMp.slot; inMp.onPitch = true; inMp.minIn = m.minute;
  outMp.onPitch = false; outMp.minOut = m.minute;
  const idx = T.onPitch.indexOf(outMp);
  T.onPitch[idx] = inMp;
  T.bench = T.bench.filter((b) => b !== inMp);
  T.out.push(outMp);
  T.subsUsed++;
  m.stoppages += 0.25;
  if (m.carrier === outMp) m.carrier = inMp;
  refreshMultipliers(m);
  emit(m, out, { type: 'sub', side: T.side, pid: inMp.id, pid2: outMp.id, forced: !!forced, x: 0.5, y: T.side === 0 ? 0 : 1, zone: m.zone });
}

/** Tir. opts.type : open | header | freekick | penalty | rebound */
function shoot(m, out, A, D, s, z, opts) {
  const gk = activePlayers(D).find((mp) => D.slots[mp.slot].pos === 'GB') || activePlayers(D)[0];
  let xg;
  switch (opts.type) {
    case 'penalty': xg = 0.76; break;
    case 'header': xg = 0.085; break;
    case 'freekick': xg = 0.065; break;
    case 'rebound': xg = 0.3; break;
    default: xg = [0.015, 0.024, 0.05, 0.13][z];
  }
  if (opts.type !== 'penalty') {
    xg *= Math.exp(m.rng.normal(0, 0.55)) * 0.74 * (opts.bonus || 1);
    const q = (eff(s, 'tir') * 0.7 + eff(s, 'sf') * 0.3) / 68;
    xg *= Math.pow(q, 1.3);
    if (z >= 2) xg *= 1 - defContext(D, 3) * 0.6;
    xg = clamp(xg, 0.01, 0.75);
  }
  A.stats.shots++; s.shots++;
  A.stats.xg += xg;
  momentum(m, A.side, 4 + xg * 30);
  const keeper = gk ? eff(gk, 'arr') * 0.85 + eff(gk, 'sf') * 0.15 : 20;
  const kf = clamp(1 + (70 - keeper) / 100 * 0.7, 0.65, 1.3);
  const blockP = opts.type === 'penalty' ? 0 : opts.type === 'header' ? 0.08 : opts.type === 'freekick' ? 0.25 : [0.4, 0.38, 0.32, 0.22][z];
  const goalP = clamp(xg * kf / (1 - blockP), 0, 0.95);
  const goalSide = A.side === 0 ? 1 : 0; // x du but visé
  const ev = { type: 'shot', side: A.side, pid: s.id, xg: +xg.toFixed(2), kind: opts.type, zone: z };

  if (m.rng.chance(blockP)) {
    ev.outcome = 'blocked';
    const blocker = pickNear(m, D, 0.15);
    ev.pid2 = blocker.id;
    Object.assign(ev, abs(A.side, 0.84, m.rng.range(0.35, 0.65)));
    emit(m, out, ev);
    addRating(blocker, 0.08);
    if (m.rng.chance(0.4)) return awardCorner(m, out, A, blocker);
    const rec = m.rng.chance(0.45) ? pickNear(m, A, 0.68) : null;
    if (rec) { m.carrier = rec; m.zone = 2; } else changePossession(m, D.side, 0, blocker);
    return;
  }
  if (m.rng.chance(goalP)) return goal(m, out, A, D, s, ev, gk);
  // Cadré (arrêt) ou non cadré.
  const onP = opts.type === 'penalty' ? 0.7 : clamp(0.3 + (eff(s, 'tir') - 60) / 220 + (z === 3 ? 0.06 : 0), 0.18, 0.55);
  if (m.rng.chance(onP)) {
    ev.outcome = 'saved'; ev.pid2 = gk ? gk.id : null;
    Object.assign(ev, abs(A.side, 0.985, m.rng.range(0.44, 0.56)));
    A.stats.onTarget++; D.stats.saves++;
    addRating(s, 0.08);
    if (gk) { gk.saves++; addRating(gk, 0.2 + xg * 0.8); }
    emit(m, out, ev);
    const r = m.rng.next();
    if (r < 0.1 && opts.type !== 'penalty') {
      const reb = pickNear(m, A, 0.86, null);
      return shoot(m, out, A, D, reb, 3, { type: 'rebound' });
    }
    if (r < 0.38) return awardCorner(m, out, A, gk);
    changePossession(m, D.side, 0, gk);
    return;
  }
  const post = m.rng.chance(0.07);
  ev.outcome = post ? 'post' : 'wide';
  const side = m.rng.chance(0.5) ? 1 : -1;
  Object.assign(ev, abs(A.side, post ? 0.995 : 1.02, 0.5 + side * (post ? 0.06 : m.rng.range(0.09, 0.2))));
  emit(m, out, ev);
  if (post) {
    addRating(s, 0.05);
    if (m.rng.chance(0.25)) {
      const reb = pickNear(m, A, 0.86, null);
      return shoot(m, out, A, D, reb, 3, { type: 'rebound' });
    }
  }
  changePossession(m, D.side, 0, gk);
}

function goal(m, out, A, D, s, ev, gk) {
  ev.outcome = 'goal';
  Object.assign(ev, abs(A.side, 1.0, m.rng.range(0.45, 0.55)));
  A.stats.onTarget++;
  emit(m, out, ev);
  // VAR : vérification occasionnelle (hors-jeu, faute).
  if (m.varEnabled && m.rng.chance(0.05)) {
    const cancelled = m.rng.chance(0.45);
    emit(m, out, { type: 'var', side: A.side, pid: s.id, outcome: cancelled ? 'cancelled' : 'confirmed', reason: m.rng.pick(['offside', 'foul', 'hand']), x: 0.5, y: 0.5, zone: 3 });
    m.stoppages += 1;
    if (cancelled) { changePossession(m, D.side, 0, gk || pickNear(m, D, 0.1)); return; }
  }
  m.score[A.side]++;
  s.goals++; addRating(s, 1.0);
  const assist = m.lastPasser && m.lastPasser !== s && ev.kind !== 'penalty' && ev.kind !== 'freekick' ? m.lastPasser : null;
  if (assist) { assist.assists++; addRating(assist, 0.6); }
  if (gk) addRating(gk, -0.3);
  for (const mp of activePlayers(D)) if (['DC', 'DG', 'DD'].includes(D.slots[mp.slot].pos)) addRating(mp, -0.12);
  momentum(m, A.side, 18);
  m.stoppages += 0.6;
  const g = { side: A.side, pid: s.id, name: s.name, minute: m.minute, extra: m.extra, pen: ev.kind === 'penalty', assist: assist ? assist.name : null };
  m.goals.push(g);
  emit(m, out, { type: 'goal', side: A.side, pid: s.id, pid2: assist ? assist.id : null, kind: ev.kind, x: ev.x, y: ev.y, zone: 3 });
  // Engagement par l'équipe qui encaisse.
  kickoff(m, out, D.side);
}

function penalty(m, out, A, D) {
  const taker = activePlayers(A).filter((mp) => A.slots[mp.slot].pos !== 'GB')
    .sort((a, b) => (eff(b, 'tir') * 0.5 + eff(b, 'sf') * 0.5) - (eff(a, 'tir') * 0.5 + eff(a, 'sf') * 0.5))[0];
  const pos = abs(A.side, 0.895, 0.5);
  emit(m, out, { type: 'penalty', side: A.side, pid: taker.id, ...pos, zone: 3 });
  m.stoppages += 0.8;
  if (m.varEnabled && m.rng.chance(0.12)) {
    const cancelled = m.rng.chance(0.35);
    emit(m, out, { type: 'var', side: A.side, pid: taker.id, outcome: cancelled ? 'cancelled' : 'confirmed', reason: 'penalty', x: 0.5, y: 0.5, zone: 3 });
    if (cancelled) {
      const gk = activePlayers(D).find((mp) => D.slots[mp.slot].pos === 'GB');
      changePossession(m, D.side, 0, gk || pickNear(m, D, 0.1));
      return;
    }
  }
  m.carrier = taker;
  return shoot(m, out, A, D, taker, 3, { type: 'penalty' });
}

function kickoff(m, out, side) {
  const T = m.teams[side];
  const c = pickNear(m, T, 0.7, null, (mp, s) => (s.pos === 'BU' || s.pos === 'MO' || s.pos === 'MC' ? 2 : 0.2));
  changePossession(m, side, 1, c);
  emit(m, out, { type: 'kickoff', side, pid: c.id, x: 0.5, y: 0.5, zone: 1 });
}

/* ------------------------------------------------------------------ */
/* Déroulement minute par minute                                       */
/* ------------------------------------------------------------------ */

function decayEnergy(m) {
  const late = m.minute > 60 ? 1.15 : 1;
  for (const t of m.teams) {
    const pv = LVL[t.tactics.pressing], tv = LVL[t.tactics.tempo];
    for (const mp of activePlayers(t)) {
      let d = 0.42 - mp.p.attrs.phy * 0.0022 + pv * 0.06 + tv * 0.03;
      if (t.slots[mp.slot].pos === 'GB') d *= 0.35;
      mp.energy = clamp(mp.energy - d * late * (1 + (mp.p.age > 31 ? 0.1 : 0)), 5, 100);
      // Blessure "sans contact", plus fréquente quand le joueur est épuisé.
      if (m.rng.chance(0.00005 * (mp.energy < 50 ? 2.5 : 1))) {
        m._pendingInjury = m._pendingInjury || [];
        m._pendingInjury.push([t, mp]);
      }
    }
  }
}

/**
 * Avance le match d'une minute. Retourne les événements de la minute.
 * Gère coup d'envoi, mi-temps, reprise et fin du match.
 */
export function stepMinute(m) {
  const out = [];
  if (m.phase === 'ft' || m.phase === 'done') return out;
  if (m.phase === 'pre') {
    m.phase = 'live';
    refreshMultipliers(m);
    m.kickoffSide = m.rng.chance(0.5) ? 0 : 1;
    kickoff(m, out, m.kickoffSide);
    return out;
  }
  if (m.phase === 'ht') {
    m.phase = 'live'; m.period = 2; m.minute = 45; m.extra = 0; m.stoppages = 0;
    for (const t of m.teams) for (const mp of activePlayers(t)) mp.energy = clamp(mp.energy + 6, 0, 100);
    refreshMultipliers(m);
    kickoff(m, out, 1 - m.kickoffSide);
    return out;
  }

  // Avance l'horloge.
  const regEnd = m.period === 1 ? 45 : 90;
  if (m.minute < regEnd) m.minute++;
  else m.extra++;

  decayEnergy(m);
  refreshMultipliers(m);
  for (const t of m.teams) if (t.isAI) aiManage(m, t, out, { doSub, bestBenchFor });

  const tempo = (LVL[m.teams[0].tactics.tempo] + LVL[m.teams[1].tactics.tempo]) * 0.25;
  const n = clamp(Math.round(4 + tempo + m.rng.normal(0, 0.8) - (m.minute > 80 ? 0.3 : 0)), 2, 6);
  for (let i = 0; i < n; i++) {
    const before = out.length;
    resolveAction(m, out);
    for (let k = before; k < out.length; k++) out[k].t = (i + (k - before) / Math.max(1, out.length - before)) / n;
    if (m._pendingInjury) {
      for (const [t, mp] of m._pendingInjury) injure(m, out, t, mp);
      m._pendingInjury = null;
    }
  }
  m.momentum *= 0.9;
  m.momentumHistory.push(Math.round(m.momentum));

  // Annonce du temps additionnel.
  if (m.minute === regEnd && m.extra === 0) {
    const base = m.period === 1 ? 1 : 3;
    m.added[m.period - 1] = clamp(Math.round(base + m.stoppages * 0.6 + m.rng.range(0, 1.5)), base, m.period === 1 ? 4 : 8);
    emit(m, out, { type: 'added', side: -1, value: m.added[m.period - 1], x: 0.5, y: 0.5, zone: m.zone });
  }
  if (m.minute === regEnd && m.extra >= m.added[m.period - 1]) {
    if (m.period === 1) {
      m.phase = 'ht';
      emit(m, out, { type: 'ht', side: -1, x: 0.5, y: 0.5, zone: 1 });
    } else {
      m.phase = 'ft';
      for (const t of m.teams) for (const mp of activePlayers(t)) mp.minOut = 90 + m.extra;
      emit(m, out, { type: 'ft', side: -1, x: 0.5, y: 0.5, zone: 1 });
      finalizeRatings(m);
    }
  }
  return out;
}

/** Bonus/malus de fin de match selon le résultat. */
function finalizeRatings(m) {
  const [a, b] = m.score;
  for (const t of m.teams) {
    const diff = t.side === 0 ? a - b : b - a;
    const conceded = t.side === 0 ? b : a;
    for (const mp of allPlayers(t)) {
      if (mp.minIn == null) continue;
      addRating(mp, diff > 0 ? 0.3 : diff < 0 ? -0.25 : 0);
      const pos = t.slots[mp.slot]?.pos;
      if (conceded === 0 && (pos === 'GB' || pos === 'DC' || pos === 'DG' || pos === 'DD')) addRating(mp, 0.35);
      mp.rating = Math.round(mp.rating * 10) / 10;
    }
  }
}

export const allPlayers = (t) => [...t.onPitch.filter(Boolean), ...t.out, ...t.bench];

/* ------------------------------------------------------------------ */
/* Interventions (joueur humain ou IA)                                 */
/* ------------------------------------------------------------------ */

/** Remplacement manuel. Retourne { ok, error, events }. */
export function makeSub(m, side, outId, inId) {
  const T = m.teams[side];
  if (T.subsUsed >= MAX_SUBS) return { ok: false, error: 'Plus de changement disponible' };
  const outMp = T.onPitch.find((mp) => mp && mp.id === outId && mp.onPitch);
  const inMp = T.bench.find((mp) => mp.id === inId && !mp.onPitch && mp.minOut == null);
  if (!outMp || !inMp) return { ok: false, error: 'Changement impossible' };
  const events = [];
  doSub(m, events, T, outMp, inMp, false);
  return { ok: true, events };
}

/** Change la formation en réaffectant au mieux les joueurs présents. */
export function changeFormation(m, side, formation) {
  const T = m.teams[side];
  const slots = FORMATIONS[formation].map((s) => ({ ...s }));
  const players = T.onPitch.slice();
  const newOn = new Array(11).fill(null);
  const free = new Set(players.map((_, i) => i));
  // Gardien d'abord, puis gloutonnement par meilleure note au poste.
  const order = slots.map((s, i) => i).sort((a, b) => (slots[a].pos === 'GB' ? -1 : 0) - (slots[b].pos === 'GB' ? -1 : 0));
  for (const si of order) {
    let best = -1, bs = -1;
    for (const pi of free) {
      const mp = players[pi];
      if (!mp) continue;
      const sc = ratingAt(mp.p, slots[si].pos);
      if (sc > bs) { bs = sc; best = pi; }
    }
    if (best >= 0) { newOn[si] = players[best]; players[best].slot = si; free.delete(best); }
  }
  // Joueurs exclus/blessés (null ou inactifs) restent en "trou".
  for (const pi of free) {
    const mp = players[pi];
    const empty = newOn.findIndex((x) => x === null);
    if (empty >= 0) { newOn[empty] = mp; if (mp) mp.slot = empty; }
  }
  T.onPitch = newOn;
  T.slots = slots;
  T.tactics.formation = formation;
  refreshMultipliers(m);
}

export function setTactic(m, side, key, value) {
  m.teams[side].tactics[key] = value;
}

/** Causerie : 'calm' | 'encourage' | 'demand'. Retourne { delta, text }. */
export function teamTalk(m, side, kind) {
  const T = m.teams[side];
  const diff = m.score[side] - m.score[1 - side];
  let delta;
  if (kind === 'calm') delta = diff > 0 ? 6 : diff === 0 ? 3 : -2;
  else if (kind === 'encourage') delta = diff < 0 ? 7 : diff === 0 ? 5 : 2;
  else delta = diff < 0 ? (m.rng.chance(0.6) ? 10 : -6) : diff === 0 ? 3 : -5;
  delta += Math.round(m.rng.normal(0, 2));
  T.talk = clamp(T.talk + delta, -15, 15);
  for (const mp of activePlayers(T)) mp.morale = clamp(mp.morale + delta * 0.5, 0, 100);
  const text = delta >= 7 ? 'Les joueurs sont gonflés à bloc !' : delta >= 3 ? 'Le message est bien passé.'
    : delta >= 0 ? 'Réaction mitigée dans le vestiaire.' : 'Les joueurs semblent contrariés…';
  return { delta, text };
}

/* ------------------------------------------------------------------ */
/* Simulation complète, tirs au but, résumé                            */
/* ------------------------------------------------------------------ */

/** Tirs au but (coupe). Retourne { score:[a,b], winner, kicks:[] }. */
export function penaltyShootout(m) {
  const res = { score: [0, 0], kicks: [] };
  const takers = m.teams.map((t) => activePlayers(t).sort((a, b) => (eff(b, 'tir') + eff(b, 'sf')) - (eff(a, 'tir') + eff(a, 'sf'))));
  const gks = m.teams.map((t) => activePlayers(t).find((mp) => t.slots[mp.slot].pos === 'GB'));
  for (let round = 0; round < 30; round++) {
    for (const side of [0, 1]) {
      const tk = takers[side][round % takers[side].length];
      const gk = gks[1 - side];
      const p = clamp(0.74 + (eff(tk, 'sf') - 65) / 250 + (eff(tk, 'tir') - 65) / 400 - (gk ? (eff(gk, 'arr') - 65) / 350 : -0.1), 0.5, 0.92);
      const scored = m.rng.chance(p);
      if (scored) res.score[side]++;
      res.kicks.push({ side, pid: tk.id, name: tk.name, scored });
    }
    const r = round + 1;
    if (r < 5) {
      const left = 5 - r;
      if (res.score[0] > res.score[1] + left || res.score[1] > res.score[0] + left) break;
    } else if (res.score[0] !== res.score[1]) break;
  }
  res.winner = res.score[0] > res.score[1] ? 0 : 1;
  m.shootout = res;
  return res;
}

/** Simulation complète sans affichage. */
export function simulateMatch(cfg) {
  const m = createMatch(cfg);
  m.teams.forEach((t) => (t.isAI = true));
  let guard = 0;
  while (m.phase !== 'ft' && guard++ < 200) stepMinute(m);
  if (cfg.cup && m.score[0] === m.score[1]) penaltyShootout(m);
  m.phase = 'done';
  return m;
}

/** Résumé : stats, notes, homme du match. */
export function summarize(m) {
  const tot = m.teams[0].stats.poss + m.teams[1].stats.poss || 1;
  const possession = [Math.round(m.teams[0].stats.poss / tot * 100), 0];
  possession[1] = 100 - possession[0];
  const ratings = m.teams.map((t) => allPlayers(t).filter((mp) => mp.minIn != null)
    .map((mp) => ({ id: mp.id, name: mp.name, pos: t.slots[mp.slot]?.pos || mp.pos, rating: mp.rating, goals: mp.goals,
      assists: mp.assists, yellow: mp.yellow, red: mp.red, injured: mp.injured, minutes: (mp.minOut ?? 90) - mp.minIn,
      energy: Math.round(mp.energy), side: t.side, sub: mp.minIn > 0 }))
    .sort((a, b) => b.rating - a.rating));
  const all = [...ratings[0], ...ratings[1]];
  // Homme du match : meilleure note, priorité au vainqueur en cas d'égalité.
  const winner = m.score[0] > m.score[1] ? 0 : m.score[1] > m.score[0] ? 1 : -1;
  const motm = all.slice().sort((a, b) => (b.rating + (b.side === winner ? 0.05 : 0)) - (a.rating + (a.side === winner ? 0.05 : 0)))[0];
  let winnerSide = winner;
  if (winner === -1 && m.shootout) winnerSide = m.shootout.winner;
  return {
    score: m.score.slice(), shootout: m.shootout, goals: m.goals.slice(), possession,
    stats: m.teams.map((t) => ({ ...t.stats, xg: +t.stats.xg.toFixed(2) })),
    ratings, motm, winnerSide, log: m.log,
  };
}

/** Affichage de la minute : 45+2'. */
export function clockLabel(minute, extra) {
  return extra > 0 ? `${minute}+${extra}'` : `${minute}'`;
}
