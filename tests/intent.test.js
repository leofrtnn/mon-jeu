// Arbitrage des intentions de déplacement (étape 5a) : règles déterministes, un seul propriétaire de la cible.
import test from 'node:test';
import assert from 'node:assert/strict';
import { P, ARB, newArbiter, propose, arbitrate, better } from '../js/engine/intent.js';

const prop = (o) => ({ slot: 'placement', id: 'formation', pri: P.PLACEMENT, src: 'formation', x: 10, y: 10, value: 0.5, ...o });
/** Fait avancer l'arbitre de t0 à t1 par pas de dt, en reproposant `props(t)` à chaque pas. */
function run(st, t0, t1, props, dt = 0.05) {
  let r = null;
  for (let t = t0; t <= t1 + 1e-9; t += dt) { for (const p of props(t)) propose(st, t, p); r = arbitrate(st, t, dt); }
  return r;
}

test('intentions : une priorité supérieure préempte immédiatement, puis retour à l\'intention précédente quand elle se termine', () => {
  const st = newArbiter();
  run(st, 0, 1, () => [prop({})]);
  assert.equal(st.cur.id, 'formation');
  propose(st, 1.05, prop({ slot: 'poursuite', id: 'poursuite', pri: P.URGENCE, src: 'poursuite', x: 30, y: 30, ttl: 0.12 }));
  propose(st, 1.05, prop({}));
  const r = arbitrate(st, 1.05, 0.05);
  assert.equal(r.cur.id, 'poursuite'); assert.equal(r.event, 'préemption'); assert.deepEqual([r.x, r.y], [30, 30]);
  // L'urgence n'est plus proposée : elle expire (ttl 0,12 s) et le joueur reprend son placement.
  const back = run(st, 1.1, 1.5, () => [prop({})]);
  assert.equal(back.cur.id, 'formation');
});

test('intentions : expiration selon le temps écoulé depuis la dernière proposition valide ; fin explicite d\'une mission', () => {
  const st = newArbiter();
  propose(st, 0, prop({ pri: P.SOUTIEN, id: 'soutien', src: 'soutien' })); arbitrate(st, 0, 0.05);
  assert.ok(arbitrate(st, ARB.TTL[2] - 0.05, 0.05), 'encore valide');
  assert.equal(arbitrate(st, ARB.TTL[2] + 0.1, 0.05)?.cur ?? null, null, 'expirée (plus reproposée)');
  let done = false;
  const st2 = newArbiter();
  propose(st2, 0, prop({ pri: P.MISSION, id: 'appel@1', src: 'appel', end: () => done }));
  assert.equal(arbitrate(st2, 0, 0.05).cur.id, 'appel@1');
  done = true; propose(st2, 0.05, prop({ pri: P.MISSION, id: 'appel@1', src: 'appel', end: () => done }));
  assert.equal(arbitrate(st2, 0.05, 0.05)?.cur ?? null, null, 'condition de fin : la mission s\'arrête aussitôt');
});

test('intentions : à priorité égale, une proposition concurrente ne remplace l\'intention en cours qu\'après 0,6 s et +25 % de valeur', () => {
  const st = newArbiter();
  const base = prop({ pri: P.SOUTIEN, slot: 'placement', id: 'soutien', src: 'soutien', value: 0.5 });
  const rivalLow = prop({ pri: P.SOUTIEN, slot: 'espacement', id: 'espacement', src: 'espacement', value: 0.55, x: 40 });
  const rivalHigh = { ...rivalLow, value: 0.7 };
  run(st, 0, 0.3, () => [base]);
  assert.equal(run(st, 0.35, 2, () => [base, rivalLow]).cur.id, 'soutien', '+10 % : pas de changement');
  const st2 = newArbiter();
  run(st2, 0, 0.3, () => [base]);
  assert.equal(run(st2, 0.35, 0.5, () => [base, rivalHigh]).cur.id, 'soutien', 'avant 0,6 s : pas de changement');
  const r = run(st2, 0.55, 1.2, () => [base, rivalHigh]);
  assert.equal(r.cur.id, 'espacement', 'après 0,6 s et +40 % : remplacement');
});

test('intentions : dans un même créneau, une révision d\'identifiant à priorité égale attend 0,6 s (pas d\'oscillation de rôle)', () => {
  const st = newArbiter();
  run(st, 0, 0.2, () => [prop({ pri: P.SOUTIEN, id: 'soutien', src: 'soutien' })]);
  let flips = 0, last = st.cur.id;
  for (let t = 0.25; t <= 3; t += 0.05) {
    const flip = Math.floor(t / 0.3) % 2, id = flip ? 'couverture' : 'formation';   // rôle (et priorité) qui change toutes les 0,3 s
    propose(st, t, prop({ pri: flip ? P.SOUTIEN : P.PLACEMENT, id, src: id })); arbitrate(st, t, 0.05);
    if (st.cur.id !== last) { flips++; last = st.cur.id; }
  }
  assert.ok(flips <= 5, `${flips} changements en 2,75 s`);
});

test('intentions : départage fixe (priorité, valeur, rang de source, identifiant)', () => {
  const a = prop({ pri: P.URGENCE, src: 'coupe', id: 'b', value: 0.5 }), b = prop({ pri: P.URGENCE, src: 'poursuite', id: 'a', value: 0.5 });
  assert.ok(better(a, b), 'rang de source');
  assert.ok(better(prop({ id: 'a' }), prop({ id: 'b' })), 'identifiant');
  assert.ok(better(prop({ value: 0.6 }), prop({ value: 0.5, src: 'gardien' })), 'valeur avant rang');
  assert.ok(better(prop({ pri: P.MISSION, value: 0 }), prop({ pri: P.SOUTIEN, value: 1 })), 'priorité avant tout');
});

test('intentions : hystérésis P1 (à sa place, ne repart qu\'au-delà de 3 m, glisse jusqu\'à 1 m, accéléré au-delà de 30 m, jamais de saut) ; P4-P5 immédiats', () => {
  const st = newArbiter();
  run(st, 0, 0.5, () => [prop({ x: 10, y: 10, glide: 2 })]);
  let r = run(st, 0.55, 0.55, () => [prop({ x: 10.6, y: 10, glide: 2 })]);
  assert.deepEqual([r.x, r.y], [10, 10], '0,6 m : immobile');
  r = run(st, 0.6, 0.6, () => [prop({ x: 12, y: 10, glide: 2 })]);
  assert.deepEqual([r.x, r.y], [10, 10], '2 m (< 3 m) : à sa place, il ne repart pas');
  const x0 = r.x;
  r = run(st, 0.65, 0.65, () => [prop({ x: 20, y: 10, glide: 2 })]);
  assert.ok(r.x > x0 && r.x <= x0 + 2 * 0.05 + 1e-9, `10 m : il repart, à l'allure de marche, sans saut (${r.x})`);
  r = run(st, 0.7, 6, () => [prop({ x: 20, y: 10, glide: 2 })]);
  assert.ok(Math.abs(r.x - 20) < 1.01, 'il finit par rejoindre sa place');
  // Grand déplacement du bloc (> 30 m) : rattrapage accéléré, toujours continu.
  const st3 = newArbiter();
  run(st3, 0, 0.5, () => [prop({ x: 10, y: 10, glide: 2 })]);
  r = run(st3, 0.55, 0.55, () => [prop({ x: 60, y: 10, glide: 2 })]);
  assert.ok(r.x > 10 + 2 * 0.05 + 0.5 && r.x < 60, `50 m d'écart : rattrapage accéléré mais continu (${r.x})`);
  const st2 = newArbiter();
  run(st2, 0, 0.2, () => [prop({ slot: 'coupe', id: 'coupe', pri: P.URGENCE, src: 'coupe', x: 10, y: 10, ttl: 0.12 })]);
  r = run(st2, 0.25, 0.25, () => [prop({ slot: 'coupe', id: 'coupe', pri: P.URGENCE, src: 'coupe', x: 10.3, y: 10, ttl: 0.12 })]);
  assert.equal(r.x, 10.3, 'urgence : jamais lissée');
});

test('intentions : déterminisme', () => {
  const go = () => { const st = newArbiter(); const out = []; for (let t = 0; t < 3; t += 0.05) { propose(st, t, prop({ x: 10 + Math.floor(t * 3), id: t > 1.5 ? 'formation2' : 'formation' })); if (t > 1 && t < 1.4) propose(st, t, prop({ slot: 'poursuite', id: 'poursuite', pri: P.URGENCE, src: 'poursuite', x: 50, ttl: 0.12 })); const r = arbitrate(st, t, 0.05); out.push(r && [r.x, r.y, r.cur?.id]); } return JSON.stringify(out); };
  assert.equal(go(), go());
});

test('intentions en match : l\'arbitre est le seul propriétaire de la cible, un seul arbitrage par joueur et par pas', async () => {
  const { cfgFor } = await import('../tools/bench/common.mjs');
  const { createMatch } = await import('../js/engine/match.js');
  const { LiveSim } = await import('../js/engine/live.js');
  globalThis.__STRICT_TARGET = true;   // toute écriture de cible hors arbitre lève une erreur
  try {
    const m = createMatch(await cfgFor(103)); const sim = new LiveSim(m);
    for (let k = 0; k < 96 * 240 && m.phase !== 'ft'; k++) { sim.step(1 / 96); if (m.phase === 'ht') sim.resumeHT = true; }
    assert.equal(sim.targetViolations || 0, 0);
    assert.equal(sim.intentStats.double || 0, 0, 'arbitrages en double');
    assert.ok(sim.intentStats.arbitrations > 0);
    for (const p of sim.players.values()) if (p._intent && !sim.inGesture(p)) assert.ok(Number.isFinite(p.tx) && Number.isFinite(p.ty));
  } finally { globalThis.__STRICT_TARGET = false; }
});

test('intentions : fin d\'une urgence, retour à une intention lissée → la cible glisse depuis le point courant (pas de saut)', () => {
  const st = newArbiter();
  run(st, 0, 0.5, () => [prop({ x: 10, y: 10, glide: 2 })]);
  // Urgence (poursuite) à 30 m : montée immédiate.
  let r = run(st, 0.55, 1.5, () => [prop({ x: 10, y: 10, glide: 2 }), prop({ slot: 'poursuite', id: 'poursuite', pri: P.URGENCE, src: 'poursuite', x: 30, y: 10, ttl: 0.12 })]);
  assert.equal(r.x, 30, 'urgence : saut immédiat');
  // L'urgence expire : retour au placement, la cible repart de 30 m et glisse vers 10 m.
  r = run(st, 1.55, 1.8, () => [prop({ x: 10, y: 10, glide: 2 })]);
  assert.equal(r.cur.id, 'formation');
  assert.ok(r.x > 28 && r.x < 30, `retour sans saut (${r.x})`);
  // Mission → placement (P3 → P1) : même règle.
  const st2 = newArbiter();
  run(st2, 0, 0.5, () => [prop({ slot: 'placement', pri: P.MISSION, id: 'appel', src: 'appel', x: 50, y: 10 })]);
  r = run(st2, 0.55, 0.6, () => [prop({ x: 20, y: 10, glide: 2 })]);
  assert.ok(r.x > 49 && r.x <= 50, `fin d'appel : la cible ne saute pas à la place tactique (${r.x})`);
});

test('intentions : seuils propres à une intention (jump, settle)', () => {
  const st = newArbiter();
  run(st, 0, 0.5, () => [prop({ pri: P.SOUTIEN, id: 'contenir', src: 'contenir', x: 10, y: 10, jump: 3.2, settle: 1 })]);
  const r = run(st, 0.55, 0.6, () => [prop({ pri: P.SOUTIEN, id: 'contenir', src: 'contenir', x: 12.5, y: 10, jump: 3.2, settle: 1 })]);
  assert.equal(r.x, 10, '2,5 m < 3,2 m : à sa place, il ne repart pas (la valeur P2 par défaut serait 1,5 m)');
});

