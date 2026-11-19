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

import { passError, receivePlan, sweptBody, gauss } from '../js/engine/contact.js';

test('passe : l\'erreur d\'exécution dépend de la technique, de la pression, du pied, de l\'équilibre et de la difficulté', () => {
  const base = { pas: 65, vis: 60, sf: 60, len: 15 };
  const s = (o) => passError({ ...base, ...o }).sAng;
  assert.ok(s({ pas: 90, vis: 85, sf: 85 }) < s({}) && s({}) < s({ pas: 40, vis: 40, sf: 40 }), 'technique');
  assert.ok(s({ pressure: 1 }) > s({ pressure: 2.5 }) && s({ pressure: 2.5 }) > s({ pressure: 10 }), 'pression');
  assert.ok(s({ weak: true, wf: 1 }) > s({ weak: true, wf: 4 }) && s({ weak: true, wf: 4 }) > s({}), 'pied faible');
  assert.ok(s({ speed: 6, turn: 2.5 }) > s({ speed: 6, turn: 0 }) && s({ speed: 6, turn: 0 }) > s({}), 'équilibre');
  assert.ok(s({ lofted: true }) > s({}) && s({ through: true }) > s({}), 'difficulté');
  assert.ok(s({ sf: 95, pressure: 1 }) < s({ sf: 30, pressure: 1 }), 'le sang-froid atténue la pression');
});

test('passe : erreur déterministe, centrée, sans résultat choisi d\'avance', () => {
  const a = passError({ rnd: [0.3, 0.7, 0.2, 0.9] }), b = passError({ rnd: [0.3, 0.7, 0.2, 0.9] });
  assert.deepEqual(a, b);
  let m = 0; const n = 2000;
  for (let i = 0; i < n; i++) m += gauss((i + 0.5) / n, ((i * 7919) % n + 0.5) / n);
  assert.ok(Math.abs(m / n) < 0.05, `moyenne ${m / n}`);
});

test('réception : le receveur laisse venir un ballon qui arrive sur lui (il ne court pas devant)', () => {
  const b = createBall(40, 34); b.vx = 9;                       // ballon qui arrive vers un joueur en x = 50
  const path = ballPath(b, predict, { horizon: 3 });
  const plan = receivePlan(pl({ face: Math.PI }), path, { minMargin: 0.3, slack: 0.3 });
  assert.ok(plan && Math.abs(plan.x - 50) < 1.2, `point choisi x=${plan?.x}`);
});

test('corps immobile : un ballon ne touche un joueur qui n\'a pas réagi que s\'il lui arrive dessus', () => {
  const p = { x: 50, y: 34 };
  assert.ok(sweptBody(p, p, ball({ x: 49, y: 34 }), ball({ x: 51, y: 34 })), 'ballon dans les jambes');
  assert.equal(sweptBody(p, p, ball({ x: 49, y: 34.7 }), ball({ x: 51, y: 34.7 })), null, 'à 70 cm : il passe');
  assert.equal(sweptBody(p, p, ball({ x: 49, y: 34, z: 2.3 }), ball({ x: 51, y: 34, z: 2.3 })), null, 'au-dessus de la tête');
});
