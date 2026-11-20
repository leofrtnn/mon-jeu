// Modèle cinématique partagé (étape 5c) : le temps d'arrivée prédit (timeTo, pursue) doit coller au
// mouvement réel (même pas de vitesse que move(), au pas du moteur 1/96 s) à moins de 0,1 s dans des
// scénarios contrôlés (cible fixe ou mobile connue d'avance, aucun changement d'intention en route).
import test from 'node:test';
import assert from 'node:assert/strict';
import { velocityStep, accelOf, topSpeed, timeTo, pursue, BODY } from '../js/engine/body.js';
import { timeToReachOld } from '../js/engine/contact.js';

/** Mouvement « réel » : exactement le pas de move() (vitesse, position, orientation par défaut) à dt = 1/96. */
function real(pl, target, { vmax, acc, brake = 6, radius = BODY.ARRIVE, tMax = 10 }) {
  const dt = 1 / 96, p = { ...pl, speed: Math.hypot(pl.vx, pl.vy) };
  for (let t = 0; t <= tMax; t += dt) {
    const g = target(t), d = Math.hypot(g.x - p.x, g.y - p.y);
    if (d <= radius) return t;
    velocityStep(p, g.x - p.x, g.y - p.y, vmax, brake, acc, dt);
    p.x += p.vx * dt; p.y += p.vy * dt; p.speed = Math.hypot(p.vx, p.vy);
    if (p.speed > 0.6) { let a = Math.atan2(p.vy, p.vx) - p.face; while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; p.face += a * Math.min(1, dt * 7); }
  }
  return Infinity;
}
const PROFILES = [{ vit: 40, energy: 100 }, { vit: 60, energy: 100 }, { vit: 85, energy: 100 }, { vit: 70, energy: 55 }];
const caps = (pr) => ({ vmax: topSpeed(pr), acc: accelOf(pr.vit) });
// Scénarios : départ arrêté (face / dos), sprint court, lancé avec virage 45°/90°/135°/180°, arrivée avec portée.
const SCEN = [];
for (const d of [3, 5, 10, 20, 40]) SCEN.push({ name: `départ arrêté, ${d} m`, pl: { x: 0, y: 0, vx: 0, vy: 0, face: 0 }, x: d, y: 0 });
for (const d of [5, 15]) SCEN.push({ name: `départ arrêté dos au point, ${d} m`, pl: { x: 0, y: 0, vx: 0, vy: 0, face: Math.PI }, x: d, y: 0 });
for (const ang of [45, 90, 135, 180]) for (const d of [6, 15]) { const a = ang * Math.PI / 180; SCEN.push({ name: `lancé à 6 m/s, virage ${ang}°, ${d} m`, pl: { x: 0, y: 0, vx: 6, vy: 0, face: 0 }, x: Math.cos(a) * d, y: Math.sin(a) * d }); }
for (const d of [4, 12]) SCEN.push({ name: `lancé à 4 m/s, arrivée avec portée 0,3 m, ${d} m`, pl: { x: 0, y: 0, vx: 4, vy: 0, face: 0 }, x: d, y: 0, slack: 0.3 });

test('temps d\'arrivée : erreur < 0,1 s entre prédiction et mouvement réel (scénarios contrôlés, 4 profils)', () => {
  let worst = 0, worstOld = 0, wName = '', sum = 0, sumOld = 0, n = 0;
  for (const pr of PROFILES) for (const s of SCEN) {
    const c = caps(pr), radius = Math.max(s.slack || 0, BODY.ARRIVE);
    const tReal = real(s.pl, () => ({ x: s.x, y: s.y }), { ...c, radius });
    const tPred = timeTo(s.pl, s.x, s.y, { ...c, slack: s.slack || 0, tMax: 10 });
    const tOld = timeToReachOld(s.pl, s.x, s.y, { ...c, react: 0, slack: s.slack || 0 });
    const e = Math.abs(tPred - tReal), eo = Math.abs(tOld - tReal);
    sum += e; sumOld += eo; n++;
    if (e > worst) { worst = e; wName = `${s.name} (vitesse ${pr.vit}, énergie ${pr.energy}) : réel ${tReal.toFixed(3)} s, prédit ${tPred.toFixed(3)} s`; }
    worstOld = Math.max(worstOld, eo);
  }
  console.log(`# ${n} cas — erreur moyenne ${(sum / n).toFixed(3)} s, max ${worst.toFixed(3)} s (${wName}) ; ancienne formule : moyenne ${(sumOld / n).toFixed(3)} s, max ${worstOld.toFixed(3)} s`);
  assert.ok(worst < 0.1, wName);
});

test('poursuite d\'une cible mobile (ballon qui roule en ralentissant) : erreur < 0,1 s', () => {
  for (const pr of PROFILES) for (const [bx, bvx, bvy] of [[10, 5, 3], [15, -6, 0], [8, 0, 8]]) {
    const c = caps(pr), sp = Math.hypot(bvx, bvy), stop = sp * sp / (2 * 1.55);
    const ballAt = (t) => { const dd = Math.min(sp * t - 0.78 * t * t, stop); return { x: bx + (bvx / sp) * dd, y: 5 + (bvy / sp) * dd }; };
    const pl = { x: 0, y: 0, vx: 2, vy: 0, face: 0 };
    const tReal = real(pl, ballAt, { ...c, radius: 0.6 }), tPred = pursue(pl, ballAt, { ...c, radius: 0.6, tMax: 10 })?.t ?? Infinity;
    assert.ok(Math.abs(tPred - tReal) < 0.1, `ballon (${bx}, ${bvx}, ${bvy}), vitesse ${pr.vit} : réel ${tReal.toFixed(3)}, prédit ${tPred.toFixed(3)}`);
  }
});

test('cohérence physique : plus rapide, plus frais, de face → arrive plus tôt ; demi-tour lancé coûteux', () => {
  const pl = { x: 0, y: 0, vx: 0, vy: 0, face: 0 };
  assert.ok(timeTo(pl, 20, 0, caps({ vit: 85 })) < timeTo(pl, 20, 0, caps({ vit: 45 })));
  assert.ok(timeTo(pl, 20, 0, caps({ vit: 70, energy: 100 })) < timeTo(pl, 20, 0, caps({ vit: 70, energy: 45 })));
  const run = { x: 0, y: 0, vx: 6.5, vy: 0, face: 0 };
  assert.ok(timeTo(run, -8, 0, caps({ vit: 70 })) > timeTo(run, 8, 0, caps({ vit: 70 })) + 0.8, 'lancé, faire demi-tour coûte du temps');
});

test('borne d\'élagage exacte : un point hors d\'atteinte donne le même résultat avec ou sans simulation', () => {
  const pl = { x: 0, y: 0, vx: 3, vy: 1, face: 0.3 };
  for (const [x, y, T] of [[30, 0, 1], [15, 10, 0.8], [6, -4, 0.5]]) {
    const c = caps({ vit: 80 }), radius = BODY.ARRIVE;
    const sim = pursue(pl, () => ({ x, y }), { ...c, radius, tMax: T });
    const pred = timeTo(pl, x, y, { ...c, tMax: T });
    if (!sim) assert.ok(pred >= T, 'hors horizon');
    else assert.ok(Math.abs(pred - sim.t) < 1e-9);
  }
});
