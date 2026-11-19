// Protection des PASSES LEVÉES (étape 5-0) : non-régression du dosage (correction 4e : la
// difficulté d'une passe levée n'est comptée qu'une fois), de la trajectoire physique et du
// comportement en match (passes longues qui sortent sans être touchées).
import test from 'node:test';
import assert from 'node:assert/strict';
import { passError } from '../js/engine/contact.js';
import { createBall, cloneBall, stepBall, solveKick, R as BR } from '../js/ui/ballPhysics.js';

const LENS = [30, 40, 50];
const sig = (o) => passError({ vis: o.pas, sf: o.pas, ...o });

test('passe levée : difficulté comptée une seule fois (σ dosage levée = 1,45 × σ au sol, à 30, 40 et 50 m)', () => {
  for (const len of LENS) for (const pas of [50, 65, 85]) {
    const lo = sig({ pas, len, lofted: true }), gr = sig({ pas, len });
    assert.ok(Math.abs(lo.sLen / gr.sLen - 1.45) < 1e-9, `len ${len} pas ${pas} : rapport ${lo.sLen / gr.sLen}`);
    assert.ok(Math.abs(lo.sAng / gr.sAng - 1.45) < 1e-9);
  }
});

test('passe levée : écart type du dosage borné (mètres) et cohérent avec la technique et la distance', () => {
  // Bornes = valeurs validées en 4e + 10 % (sans pression) : 30 m ≤ 3,4 m · 40 m ≤ 5,2 m · 50 m ≤ 6,5 m (passeur à 50).
  const max = { 30: 3.4, 40: 5.2, 50: 6.5 };
  for (const len of LENS) {
    const m = (pas) => sig({ pas, len, lofted: true }).sLen * len;
    assert.ok(m(50) <= max[len], `len ${len} : ${m(50).toFixed(2)} m`);
    assert.ok(m(85) < m(65) && m(65) < m(50), 'meilleur passeur = plus précis');
  }
  assert.ok(sig({ pas: 65, len: 50, lofted: true }).sLen * 50 > sig({ pas: 65, len: 30, lofted: true }).sLen * 30, 'plus loin = écart plus grand');
  assert.ok(sig({ pas: 65, len: 40, lofted: true, pressure: 1 }).sLen > sig({ pas: 65, len: 40, lofted: true }).sLen, 'pression');
});

/** Frappe levée identique à kickBall (T = 0,9 + d/30, rétro 2,2), sans erreur d'exécution. */
function lob(len, z, spin) {
  const b = createBall(20, 34);
  const T = solveKick(b, { x: 20 + len, y: 34, z }, { T: 0.9 + len / 30, spin, top: 2.2 });
  const c = cloneBall(b); let t = 0, atT = null, land = null;
  while (t < 6 && !(atT && land)) { stepBall(c, 0.005); t += 0.005; if (!atT && t >= T) atT = { x: c.x, y: c.y, z: c.z }; if (!land && t > 0.3 && c.z < BR + 0.02 && c.vz <= 0) land = { x: c.x, y: c.y }; }
  return { atT, land };
}

test('passe levée : sans erreur, le ballon passe au point visé à l\'instant prévu (30, 40, 50 m, avec et sans effet)', () => {
  for (const len of LENS) for (const z of [0.4, 1.5]) for (const spin of [0, 3.5]) {
    const { atT } = lob(len, z, spin);
    assert.ok(Math.hypot(atT.x - 20 - len, atT.y - 34, atT.z - z) < 0.15, `len ${len} z ${z} effet ${spin}`);
  }
});

test('passe levée : premier rebond au-delà de la cible, sans aggravation (anomalie documentée : rétro qui fait planer)', () => {
  // Mesure de référence (étape 5-0) : rebond 8 à 14 m après la cible. Garde-fou : ni court, ni pire que 16 m.
  for (const len of LENS) for (const z of [0.4, 1.5]) {
    const { land } = lob(len, z, 0);
    const over = land.x - 20 - len;
    assert.ok(over > 0 && over < 16, `len ${len} z ${z} : rebond ${over.toFixed(1)} m après la cible`);
  }
});

test('passe levée en match : peu de passes longues sortent sans être touchées (matchs de référence)', async () => {
  const { cfgFor, runLive } = await import('../tools/bench/common.mjs');
  let n = 0, out = 0, cur = null, lastRs = null;
  for (const seed of [100, 101]) runLive(await cfgFor(seed), { dt: 0.05, setup(sim) {
    const dp = sim.doPass.bind(sim); sim.doPass = (h, o, ev) => { const r = dp(h, o, ev); if (o.lofted && sim.pending?.kind === 'pass') { n++; cur = { touched: false }; } return r; };
    for (const k of ['controlTouch', 'header', 'gkTouch', 'gkCatch']) { const f = sim[k].bind(sim); sim[k] = (...a) => { if (cur) cur.touched = true; return f(...a); }; }
  }, onStep(sim) {
    const rs = sim.restart;
    if (cur && rs && rs !== lastRs && !cur.touched && ['throw', 'goalkick', 'corner'].includes(rs.kind)) { out++; cur = null; }
    if (rs) lastRs = rs; if (cur?.touched) cur = null;
  } });
  // Référence 5-0 : 8,4 % sur 4 matchs (12 % au-delà de 45 m). Garde-fou : moins de 15 %.
  assert.ok(n > 60, `${n} passes longues`);
  console.log(`# passes longues : ${n}, sorties sans contact : ${(100 * out / n).toFixed(1)} %`);
  assert.ok(out / n < 0.15, `${(100 * out / n).toFixed(1)} % sorties sans contact`);
});
