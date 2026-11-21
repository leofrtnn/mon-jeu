/**
 * Règles du jeu sans blocage (correctif avant validation de 5c) :
 * - fin de célébration : compteur remis à 0 dans tous les cas (but validé, but refusé par la VAR,
 *   but sans VAR) ; ensuite, sorties, tacles et contacts du ballon libre fonctionnent ;
 * - lignes : un seul seuil (OUT_M) pour la jouabilité et la sortie — pas de zone morte, pas de
 *   sortie prématurée, remise attribuée selon le dernier toucheur.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { cfgFor, createMatch, LiveSim, L, W } from '../tools/bench/common.mjs';
import { OUT_M } from '../js/engine/live.js';
import { R as BR } from '../js/ui/ballPhysics.js';

const dt = 1 / 96;
/** Un match en cours (jeu effectif, ni remise, ni célébration, ni tir), après une minute de jeu. */
async function liveSim(seed = 103) {
  const m = createMatch(await cfgFor(seed)), sim = new LiveSim(m);
  for (let k = 0; k < 96 * 60 || !(m.phase === 'live' && !sim.restart && !(sim.celebrate > 0) && !sim.shot); k++) sim.step(dt);
  return { m, sim };
}
/** Ballon posé / lancé en (x, y) au sol, libre, dernier toucheur `last`. */
function placeBall(sim, x, y, vx = 0, vy = 0, last = 0) {
  if (sim.holder) sim.releaseBall(sim.holder);
  sim.pending = null; sim.shot = null;
  Object.assign(sim.P, { x, y, z: BR, vx, vy, vz: 0, inGoal: 0 });
  sim.lastTouch = last;
}
/** Joue jusqu'au premier toucher ou à la première remise ; les positions du ballon au coup de sifflet sont relevées. */
function firstOutcome(sim, maxT = 12) {
  const calls = [];
  const orig = sim.setRestart.bind(sim);
  sim.setRestart = (kind, side, ...a) => { calls.push({ kind, side, x: sim.P.x, y: sim.P.y }); return orig(kind, side, ...a); };
  let res = null;
  for (let k = 0; k < maxT / dt && !res; k++) {
    const y0 = sim.P.y, x0 = sim.P.x;
    sim.step(dt);
    if (calls.length) res = { type: 'remise', ...calls[0], prev: { x: x0, y: y0 } };
    else if (sim.holder) res = { type: 'touché', side: sim.holder.side, t: k * dt };
  }
  sim.setRestart = orig;
  return res;
}

test('lignes : ballon arrêté avant, sur, et jusqu\'à OUT_M au-delà de la ligne → jouable (touché, aucune remise)', async () => {
  assert.equal(OUT_M, 0.1);
  for (const [x, y] of [[50, 0.3], [50, 0], [50, -0.05], [50, -0.08], [50, -0.09], [50, -OUT_M], [50, W + 0.09], [L + 0.09, 10], [-0.09, 50]]) {
    const { sim } = await liveSim();
    placeBall(sim, x, y);
    const r = firstOutcome(sim);
    assert.ok(r, `(${x}, ${y}) : ni touché ni sorti en 12 s (zone morte)`);
    assert.equal(r.type, 'touché', `(${x}, ${y}) : sortie prématurée (${JSON.stringify(r)})`);
  }
});

test('lignes : au-delà de OUT_M → sortie immédiate, remise selon le dernier toucheur', async () => {
  const cases = [
    { x: 50, y: -0.11, last: 0, kind: 'throw', side: 1 },
    { x: 50, y: W + 0.11, last: 1, kind: 'throw', side: 0 },
    { x: L + 0.11, y: 10, last: 0, kind: 'goalkick', side: 1 },   // l'attaquant (côté 0 vers x = L) l'a touché en dernier
    { x: L + 0.11, y: 10, last: 1, kind: 'corner', side: 0 },     // le défenseur l'a touché en dernier
    { x: -0.11, y: 10, last: 1, kind: 'goalkick', side: 0 },
    { x: -0.11, y: 58, last: 0, kind: 'corner', side: 1 },
  ];
  for (const c of cases) {
    const { sim } = await liveSim();
    placeBall(sim, c.x, c.y, 0, 0, c.last);
    const r = firstOutcome(sim, 0.1);
    assert.ok(r && r.type === 'remise', `(${c.x}, ${c.y}) : pas de remise`);
    assert.equal(r.kind, c.kind, `(${c.x}, ${c.y}) dernier toucheur ${c.last}`);
    assert.equal(r.side, c.side, `(${c.x}, ${c.y}) dernier toucheur ${c.last}`);
  }
});

test('lignes : ballon qui franchit la ligne à différentes vitesses → sifflé dès qu\'il dépasse OUT_M, jamais avant', async () => {
  for (const vy of [-3, -6, -8, -12, -15, -20]) {
    const { sim } = await liveSim();
    placeBall(sim, 50, 2.5, 0, vy, 0);
    const r = firstOutcome(sim);
    assert.ok(r, `vy ${vy} : ni touché ni sorti`);
    if (r.type === 'touché') continue;   // joué avant la ligne : pas une sortie
    assert.equal(r.kind, 'throw'); assert.equal(r.side, 1);
    assert.ok(r.y < -OUT_M, `vy ${vy} : sifflé avant la sortie (y = ${r.y})`);
    assert.ok(r.prev.y >= -OUT_M, `vy ${vy} : sifflé en retard (déjà sorti au pas précédent, y = ${r.prev.y})`);
  }
});

/** Force un but de l'équipe 0 avec (ou sans) vérification VAR, puis joue jusqu'à la reprise. */
async function goalWithVar(varMode) {
  const { m, sim } = await liveSim();
  m.varEnabled = true;
  const score0 = m.score[0];
  const rand = sim.rand;
  sim.rand = () => 0.01;   // tirages du but : célébration ; VAR déclenchée
  sim.goal([], 0);
  sim.rand = rand;
  if (varMode === 'none') sim.varPending = null;
  else sim.varPending.cancel = varMode === 'cancel';
  assert.equal(sim.celebrate, 4.5);
  let minCel = Infinity;
  for (let k = 0; k < 96 * 15 && (sim.celebrate > 0 || sim.varT > 0 || sim.varPending); k++) { sim.step(dt); minCel = Math.min(minCel, sim.celebrate); }
  return { m, sim, score0, minCel };
}

test('célébration : remise à zéro après un but refusé par la VAR, validé par la VAR, ou sans VAR', async () => {
  for (const mode of ['cancel', 'confirm', 'none']) {
    const { m, sim, score0, minCel } = await goalWithVar(mode);
    assert.equal(sim.celebrate, 0, `${mode} : compteur de célébration ${sim.celebrate}`);
    assert.ok(minCel >= 0, `${mode} : compteur négatif pendant la reprise (${minCel})`);
    assert.ok(!(sim.varT > 0) && !sim.varPending, `${mode} : VAR toujours en cours`);
    assert.equal(m.score[0], mode === 'cancel' ? score0 : score0 + 1, `${mode} : score`);
    if (mode === 'cancel') assert.equal(sim.restart?.kind, 'freekick', 'but refusé : coup franc');
    else assert.equal(sim.restart?.kind, 'kickoff', `${mode} : engagement`);
  }
});

test('célébration : après un but refusé par la VAR, sorties, tacles et contacts du ballon libre fonctionnent (aucun blocage)', async () => {
  const { m, sim } = await goalWithVar('cancel');
  const tk0 = m.teams[0].stats.tackles + m.teams[1].stats.tackles;
  const outs = new Set(); let loose = 0, wasLoose = false, still = 0, maxStill = 0, neg = false;
  const orig = sim.setRestart.bind(sim);
  sim.setRestart = (kind, ...a) => { outs.add(kind); return orig(kind, ...a); };
  for (let k = 0; k < 96 * 600 && m.phase !== 'ft'; k++) {
    sim.step(dt); if (m.phase === 'ht') sim.resumeHT = true;
    if (sim.celebrate < 0) neg = true;
    const free = m.phase === 'live' && !sim.restart && !(sim.celebrate > 0) && !sim.holder && !sim.pending;
    if (free) wasLoose = true; else if (wasLoose && sim.holder && !sim.restart) { loose++; wasLoose = false; } else wasLoose = false;
    if (free && Math.hypot(sim.P.vx, sim.P.vy) < 0.05) { still += dt; maxStill = Math.max(maxStill, still); } else still = 0;
  }
  sim.setRestart = orig;
  assert.ok(!neg, 'compteur de célébration négatif');
  assert.ok(['throw', 'goalkick', 'corner'].some((k) => outs.has(k)), `aucune sortie sifflée (${[...outs]})`);
  assert.ok(m.teams[0].stats.tackles + m.teams[1].stats.tackles > tk0, 'aucun tacle');
  assert.ok(loose > 0, 'aucun contact sur ballon libre');
  assert.ok(maxStill < 5, `ballon libre immobile ${maxStill.toFixed(1)} s`);
});
