import test from 'node:test';
import assert from 'node:assert/strict';
import { reachAt, sweptReach, interceptPlan, ballPath, touchQuality, firstTouch, partsForHeight, timeToReach, BALL_R } from '../js/engine/contact.js';
import { createBall, predict } from '../js/ui/ballPhysics.js';

const pl = (o = {}) => ({ x: 50, y: 34, face: 0, vx: 0, vy: 0, ...o });   // regarde vers +x
const ball = (o = {}) => ({ x: 50, y: 34, z: BALL_R, vx: 0, vy: 0, vz: 0, ...o });

test('contact : ballon au pied devant le joueur → pied, toucher propre', () => {
  const r = reachAt(pl(), ball({ x: 50.4 }));
  assert.equal(r.part, 'foot');
  assert.equal(r.stretch, 0);
});

test('contact : ballon à 1,9 m → hors d\'atteinte (plus de réception à distance)', () => {
  assert.equal(reachAt(pl(), ball({ x: 51.9 })), null);
  assert.equal(reachAt(pl(), ball({ x: 51.3 })), null);
});

test('contact : en s\'étirant (fente), le pied va jusqu\'à ~1,2 m du corps, avec un toucher dégradé', () => {
  const mid = reachAt(pl(), ball({ x: 50.95 })), far = reachAt(pl(), ball({ x: 51.15 }));
  assert.equal(far.part, 'foot');
  assert.ok(mid.stretch > 0 && far.stretch > mid.stretch && far.stretch <= 1, `étirement ${mid.stretch} → ${far.stretch}`);
});

test('contact : la hauteur du ballon décide de la partie du corps', () => {
  assert.equal(reachAt(pl(), ball({ x: 50.3, z: 1.2 })).part, 'chest');
  assert.equal(reachAt(pl(), ball({ x: 50.3, z: 0.7 })).part, 'thigh');
  assert.equal(reachAt(pl(), ball({ x: 50.15, z: 1.8 })).part, 'head');
  // 2,3 m : seulement en sautant, et seulement si le joueur saute assez haut.
  assert.equal(reachAt(pl(), ball({ x: 50.15, z: 2.3 }), { canJump: false }), null);
  assert.equal(reachAt(pl(), ball({ x: 50.15, z: 2.3 }), { phy: 85 }).part, 'head');
  assert.deepEqual(partsForHeight(3.2, { phy: 99 }), []);
});

test('contact : ballon dans le dos → injouable', () => {
  assert.equal(reachAt(pl(), ball({ x: 49.5 })), null);
});

test('contact : un ballon rapide réduit la zone (temps de réaction)', () => {
  const pos = { x: 50.95 };
  assert.ok(reachAt(pl(), ball({ ...pos, vx: -3 })));
  assert.equal(reachAt(pl(), ball({ ...pos, vx: -25 })), null);
});

test('contact balayé : un ballon rapide qui traverse la zone pendant un grand pas est détecté', () => {
  const p = pl();
  const b0 = ball({ x: 50.4, y: 32, vy: 30 }), b1 = ball({ x: 50.4, y: 36, vy: 30 });
  assert.equal(reachAt(p, b0), null); assert.equal(reachAt(p, b1), null);
  const s = sweptReach(p, p, b0, b1);
  assert.ok(s && s.reach.part === 'foot', 'contact pendant le pas');
});

test('interception : ballon qui roule vers le joueur → point atteignable ; ballon hors de portée → aucun', () => {
  const b = createBall(70, 34); b.vx = -10;
  const path = ballPath(b, predict, { horizon: 3 });
  const plan = interceptPlan(pl({ face: 0 }), path);
  assert.ok(plan && plan.margin >= 0 && plan.part === 'foot');
  const far = createBall(70, 5); far.vx = 25;            // file à l'opposé, loin du joueur
  assert.equal(interceptPlan(pl(), ballPath(far, predict, { horizon: 1.5 })), null);
});

test('déplacement : se retourner coûte du temps', () => {
  assert.ok(timeToReach(pl({ face: Math.PI }), 55, 34) > timeToReach(pl({ face: 0 }), 55, 34));
});

test('qualité du toucher : technique, étirement, vitesse et pression comptent', () => {
  const base = { tech: 60, stretch: 0, rel: 8, part: 'foot', pressure: 10 };
  assert.ok(touchQuality({ ...base, tech: 90 }) > touchQuality(base));
  assert.ok(touchQuality({ ...base, stretch: 1 }) < touchQuality(base));
  assert.ok(touchQuality({ ...base, rel: 20 }) < touchQuality(base));
  assert.ok(touchQuality({ ...base, pressure: 1 }) < touchQuality(base));
  assert.ok(touchQuality({ ...base, part: 'head' }) < touchQuality(base));
});

test('premier toucher : un bon toucher amortit, un mauvais laisse filer ; résultat déterministe', () => {
  const incoming = { vx: -15, vy: 0, vz: 0 };
  const good = firstTouch({ incoming, pl: pl(), dir: 0, push: 1, q: 0.95, rnd: [0.5, 0.3] });
  const bad = firstTouch({ incoming, pl: pl(), dir: 0, push: 1, q: 0.1, rnd: [0.5, 0.3] });
  assert.ok(Math.abs(good.vx - 1) < 1.2, `bon toucher vx=${good.vx}`);
  assert.ok(bad.vx < good.vx - 3, 'le mauvais toucher garde une partie de la vitesse entrante');
  assert.deepEqual(firstTouch({ incoming, pl: pl(), dir: 0.3, push: 2, q: 0.6, rnd: [0.2, 0.7] }), firstTouch({ incoming, pl: pl(), dir: 0.3, push: 2, q: 0.6, rnd: [0.2, 0.7] }));
});
