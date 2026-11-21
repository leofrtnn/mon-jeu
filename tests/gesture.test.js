/**
 * Contrat moteur → animation (étape 6a) : le descriptif des gestes est en lecture seule et cohérent.
 * - neutralité : le match est identique avec l'enregistreur réel, un enregistreur muet, ou le diagnostic ;
 * - couverture : chaque contact du diagnostic physique est décrit (même joueur, même pas) ;
 * - identifiants : uniques, croissants ; tout contact rattaché désigne un geste existant ;
 * - temps : contact physique dans le pas où il est constaté ; frappe armée exécutée dans le pas qui suit
 *   l'instant prévu (0 ≤ t_phys − t_plan ≤ dt) ;
 * - gestes terminés : une issue explicite (contact, sans contact, annulé, interrompu, subi) ;
 * - déplacement : lu du modèle 5c (vitesse = norme de la vitesse, mode cohérent avec l'orientation).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { cfgFor, createMatch, LiveSim, hash } from '../tools/bench/common.mjs';
import { Diag } from '../js/engine/diag.js';

const dt = 1 / 96;
function play(seed, setup, minutes = 6) {
  return cfgFor(seed).then((cfg) => {
    const m = createMatch(cfg), sim = new LiveSim(m);
    if (setup) setup(sim);
    const parts = [];
    for (let k = 0; k < 96 * 60 * 30 && m.phase !== 'ft' && m.minute < minutes; k++) {
      const evs = sim.step(dt); if (m.phase === 'ht') sim.resumeHT = true;
      for (const e of evs) parts.push(`${e.type}:${e.pid ?? ''}`);
    }
    for (const p of sim.players.values()) parts.push(`${p.x.toFixed(6)},${p.y.toFixed(6)}`);
    parts.push(`${sim.P.x.toFixed(6)},${sim.P.y.toFixed(6)}`);
    return { m, sim, h: hash(parts.join('|')) };
  });
}
const MUTE = { begin() { return null; }, replan() {}, finish() {}, contact() { return null; }, note() {}, sweep() {} };

test('neutralité : enregistreur réel, enregistreur muet, journal complet et diagnostic donnent le même match', async () => {
  for (const seed of [104, 207]) {
    const a = await play(seed);
    const b = await play(seed, (s) => { s.gest = MUTE; });
    const c = await play(seed, (s) => { s.gest.all = true; s.diag = new Diag(); });
    assert.equal(a.h, b.h, `graine ${seed} : l'enregistreur change le match`);
    assert.equal(a.h, c.h, `graine ${seed} : le journal complet / diagnostic change le match`);
  }
});

test('couverture, identifiants, temps et issues des gestes', async () => {
  const diagC = [];
  const { sim } = await play(103, (s) => {
    s.gest.all = true;
    const D = s.diag = new Diag({ keep: 1 });
    const oc = D.contact.bind(D); D.contact = (now, c) => { diagC.push(c.pid + ':' + s._stepN); return oc(now, c); };
  }, 12);
  const G = sim.gest, ids = new Set(G.gestures.map((g) => g.id));
  assert.ok(G.gestures.length > 300 && G.contacts.length > 600, 'assez de gestes et de contacts');
  // Couverture.
  const have = new Set(G.contacts.map((c) => c.pid + ':' + c.step));
  const miss = diagC.filter((k) => !have.has(k));
  assert.equal(miss.length, 0, `${miss.length} contacts du diagnostic non décrits`);
  // Identifiants.
  for (let i = 1; i < G.gestures.length; i++) assert.ok(G.gestures[i].id > G.gestures[i - 1].id);
  for (let i = 1; i < G.contacts.length; i++) assert.ok(G.contacts[i].id > G.contacts[i - 1].id);
  for (const c of G.contacts) if (c.gid != null) assert.ok(ids.has(c.gid), `contact ${c.id} : geste ${c.gid} inconnu`);
  // Temps : un contact a lieu dans le pas où il est constaté.
  for (const c of G.contacts) assert.ok(c.frac >= 0 && c.frac <= 1);
  // Frappes armées : exécutées dans le pas qui suit l'instant prévu.
  const armed = G.gestures.filter((g) => ['passe', 'passe levée', 'frappe', 'centre', 'dégagement', 'remise en jeu au pied'].includes(g.kind) && !g.reflex && g.tContact != null);
  assert.ok(armed.length > 50);
  for (const g of armed) { const d = g.tContact - g.tPlan; assert.ok(d >= -1e-9 && d <= dt + 1e-9, `${g.kind} #${g.id} : t_phys − t_plan = ${d}`); }
  // Issues explicites.
  for (const g of G.gestures) if (g.end != null) assert.ok(['contact', 'sans contact', 'annulé', 'interrompu', 'subi'].includes(g.outcome), `issue ${g.outcome}`);
  // Un geste avec contact principal a son instant de contact.
  for (const g of G.gestures) if (g.contacts.length) assert.ok(g.tContact != null);
});

test('déplacement : lu du modèle cinématique (vitesse, mode, orientation)', async () => {
  const { sim } = await play(105, null, 3);
  for (const p of sim.players.values()) {
    const lo = p.loco;
    assert.ok(lo, 'descriptif de déplacement présent');
    assert.ok(Math.abs(lo.speed - Math.hypot(lo.vx, lo.vy)) < 1e-6 || lo.ctrl !== 'libre', 'vitesse = norme de la vitesse');
    if (lo.speed >= 0.3) {
      const rel = Math.abs(Math.atan2(Math.sin(Math.atan2(lo.vy, lo.vx) - lo.face), Math.cos(Math.atan2(lo.vy, lo.vx) - lo.face)));
      assert.equal(lo.mode, rel > 2.2 ? 'reculons' : rel > 0.9 ? 'pas chassés' : 'avant');
    } else assert.equal(lo.mode, 'arrêt');
  }
});
