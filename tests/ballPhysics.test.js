import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBall, solveKick, stepBall, predict, R } from '../js/ui/ballPhysics.js';

test('passe au sol : arrive au receveur à la vitesse voulue, en un temps réaliste', () => {
  const b = createBall(40, 34);
  const T = solveKick(b, { x: 60, y: 34 }, { mode: 'ground', arrive: 7 });
  assert.ok(T > 1.3 && T < 2.6, `durée ${T}`);
  const c = predict(b, T);
  assert.ok(Math.abs(c.x - 60) < 0.5, `arrivée x=${c.x}`);
  assert.ok(Math.abs(Math.hypot(c.vx, c.vy) - 7) < 0.6);
  assert.equal(c.z, R);
});

test('centre enroulé : passe par le point visé, à hauteur de tête', () => {
  const b = createBall(95, 5);
  const T = solveKick(b, { x: 96, y: 33, z: 2 }, { T: 1.25, spin: 9 });
  const c = createBall(); Object.assign(c, b, { rot: { a: 0, b: 0 } });
  stepBall(c, T);
  assert.ok(Math.hypot(c.x - 96, c.y - 33, c.z - 2) < 0.3);
});

test('frappe cadrée : le ballon entre dans le but et reste dans les filets', () => {
  const b = createBall(85, 30);
  solveKick(b, { x: 105.6, y: 36.8, z: 2.1 }, { T: 0.85, spin: -6, top: -4 });
  stepBall(b, 4);
  assert.equal(b.inGoal, 1);
  assert.ok(b.x > 105 && b.x < 107.2);
});

test('poteau : le ballon rebondit sur le montant', () => {
  const b = createBall(90, 34);
  solveKick(b, { x: 105, y: 34 + 3.61, z: 1 }, { T: 0.6 });
  stepBall(b, 1.5);
  assert.ok(b.hitPost);
  assert.ok(b.x < 105);
});

test('le ballon finit par s\'arrêter (rebonds puis roulement)', () => {
  const b = createBall(10, 34);
  solveKick(b, { x: 60, y: 30, z: R }, { T: 3 });
  stepBall(b, 15);
  assert.equal(Math.hypot(b.vx, b.vy, b.vz), 0);
  assert.equal(b.z, R);
});
