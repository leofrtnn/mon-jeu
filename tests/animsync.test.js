/**
 * Synchronisation animation ↔ contact (étape 6b) — logique d'affichage, sans navigateur :
 * - la couche d'affichage différé ne modifie pas le match (même empreinte avec ou sans) ;
 * - gestes migrés : le contact animé tombe exactement à l'instant du contact physique
 *   (frappe : phase 0,55 au contact ; touche de conduite / contrôle : sommet 0,5 au contact) ;
 * - l'animation commence AVANT le contact, au plus DELAY avant (anticipation possible grâce au différé) ;
 * - frappes armées (déjà synchronisées en 6a) : le contact animé est désormais exactement au contact
 *   (au lieu de 0 à 1 pas avant) — aucune régression ;
 * - gestes annulés ou interrompus : l'animation s'arrête à la fin du geste (pas de frappe fantôme).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { cfgFor, createMatch, LiveSim, hash } from '../tools/bench/common.mjs';
import { DisplayBuffer, DELAY, kickPhase, peakPhase, jumpPhase, JUMP } from '../js/ui/animSync.js';

const dt = 1 / 96;
async function play(seed, withDisplay, minutes = 5) {
  const m = createMatch(await cfgFor(seed)), sim = new LiveSim(m);
  sim.gest.all = true;
  const view = { live: sim, players: sim.players, phys: sim.P };
  const D = withDisplay ? new DisplayBuffer(view) : null;
  const parts = [];
  for (let k = 0; k < 96 * 60 * 20 && m.phase !== 'ft' && m.minute < minutes; k++) {
    const evs = sim.step(dt); if (m.phase === 'ht') sim.resumeHT = true;
    if (D) { D.record(); if (k % 2 === 0) D.sample('contrat'); }
    for (const e of evs) parts.push(`${e.type}:${e.pid ?? ''}`);
  }
  for (const p of sim.players.values()) parts.push(`${p.x.toFixed(6)},${p.y.toFixed(6)}`);
  return { sim, h: hash(parts.join('|')) };
}

test('la couche d\'affichage différé ne modifie pas le match', async () => {
  for (const seed of [104, 211]) {
    const a = await play(seed, false), b = await play(seed, true);
    assert.equal(a.h, b.h, `graine ${seed}`);
  }
});

test('gestes migrés : contact animé = contact physique, animation commencée avant (≤ DELAY)', async () => {
  const { sim } = await play(103, false, 8);
  const G = sim.gest.gestures.filter((g) => g.tContact != null);
  const kicks = G.filter((g) => ['passe', 'passe levée', 'frappe', 'centre', 'dégagement', 'remise en jeu au pied'].includes(g.kind));
  assert.ok(kicks.length > 40);
  for (const g of kicks) {
    const now = g.tContact + DELAY;   // l'image du contact est affichée DELAY plus tard
    assert.ok(Math.abs(kickPhase(g, g.tContact, now) - 0.55) < 1e-9, `${g.kind} #${g.id} : phase au contact ${kickPhase(g, g.tContact, now)}`);
    const before = kickPhase(g, g.tContact - 0.04, now);
    assert.ok(before != null && before < 0.55, `${g.kind} #${g.id} : geste non commencé avant le contact`);
    // début de l'animation : au plus DELAY avant le contact pour une frappe sans armé
    if (g.reflex) assert.equal(kickPhase(g, g.tContact - DELAY - 1e-3, now), null);
    // frappes armées : l'ancien contact animé était 0 à 1 pas avant le contact ; désormais exact.
    if (!g.reflex) { const old = (g.t0re ?? g.t0) + 0.55 * g.anim.dur; assert.ok(g.tContact - old >= -1e-9 && g.tContact - old <= dt + 1e-9); }
  }
  for (const g of G.filter((x) => ['touche de conduite', 'contrôle'].includes(x.kind)).slice(0, 2000)) {
    const lead = g.kind === 'contrôle' ? 0.12 : 0.112;
    assert.equal(peakPhase(g.tContact, g.tContact, lead, 0.2), 0.5);
    assert.ok(peakPhase(g.tContact, g.tContact - lead / 2, lead, 0.2) > 0 && lead <= DELAY);
  }
  // Annulés / interrompus : plus d'animation après la fin du geste.
  for (const g of sim.gest.gestures.filter((x) => ['annulé', 'interrompu'].includes(x.outcome) && ['passe', 'centre', 'frappe'].includes(x.kind))) {
    assert.equal(kickPhase(g, g.end + 0.01, g.end + 1), null, `#${g.id} : frappe fantôme après ${g.outcome}`);
  }
});

test('gestes aériens (6c-A) : coup de tête animé (phase 0,5) au contact, saut sans contact calé sur le contact prévu', async () => {
  const { sim } = await play(5, false, 25);
  const G = sim.gest.gestures.filter((g) => ['saut de tête', 'tête', 'saut'].includes(g.kind) && g.part !== 'mains');
  assert.ok(G.length >= 5, `assez de gestes aériens (${G.length})`);
  let nC = 0, nN = 0;
  for (const g of G) {
    const end = 99999;
    if (g.tContact != null) {
      nC++;
      const u = jumpPhase(g, g.tContact, end);
      assert.ok(Math.abs(u - JUMP.uc) < 1e-6, `${g.kind} ${g.id} : phase ${u} au contact`);
      // Début du geste affiché : avant le contact, au plus 0,36 s avant (saut préparé) ou 0,15 s (réflexe).
      const lead = g.reflex ? JUMP.lead : JUMP.uc * JUMP.dur;
      assert.equal(jumpPhase(g, g.tContact - lead - 0.01, end), null);
      assert.ok(jumpPhase(g, g.tContact - lead + 0.01, end) != null);
      assert.ok(lead <= DELAY + JUMP.uc * JUMP.dur);
    } else if (!g.reflex) {
      nN++;
      const T = g.tPlan ?? (g.t0re ?? g.t0) + JUMP.uc * JUMP.dur;
      if (g.outcome !== 'interrompu') assert.ok(Math.abs(jumpPhase(g, T, end) - JUMP.uc) < 1e-6, `saut sans contact ${g.id} : sommet au contact prévu`);
    }
  }
  assert.ok(nC > 0 && nN > 0, `gestes avec (${nC}) et sans contact (${nN})`);
});

test('gardien (6c-B) : résultat lu dans l\'enregistrement (capté / repoussé / dévié), fenêtre autour du contact, relance ballon en main', () => {
  // Enregistrement synthétique : ballon qui arrive à 20 m/s sur le gardien (pid 1), contact à t = 1.
  const mk = (after, held) => {
    const view = { live: { now: 2, gest: { gestures: [] } }, players: new Map(), phys: {} };
    const D = new DisplayBuffer(view);
    for (let i = 0; i <= 192; i++) {
      const t = i / 96, x = t <= 1 ? 20 * (1 - t) : after(t - 1);
      D.snaps.push({ t, ps: new Map(), holder: held && t >= 1 ? 1 : null, inHands: held && t >= 1, b: { x: x.x ?? x, y: x.y ?? 0, z: 1, vx: 0, vy: 0, vz: 0 } });
    }
    return D;
  };
  const g = { id: 7, pid: 1, kind: 'mains', tContact: 1, part: 'mains' };
  const caught = mk(() => 0, true).gkContact([g], 0.95, 2);
  assert.equal(caught.res, 'capté');
  const parried = mk((u) => 6 * u, false).gkContact([g], 0.95, 2);       // repart vers le terrain, ralenti
  assert.equal(parried.res, 'repoussé');
  const tipped = mk((u) => ({ x: -18 * u, y: 3 * u }), false).gkContact([g], 0.95, 2);   // garde vitesse et direction
  assert.equal(tipped.res, 'dévié');
  // Hors de la fenêtre (plus de 0,14 s avant le contact) : pas de mains au ballon.
  assert.equal(mk(() => 0, true).gkContact([g], 0.8, 2), null);
  // Geste sans contact (plongeon battu) : jamais de résultat de contact.
  assert.equal(mk(() => 0, false).gkContact([{ ...g, kind: 'plongeon', tContact: null }], 0.95, 2), null);
});

test('tacles (6c-C) : phase des images clés calée sur la cinématique du moteur', async () => {
  const { tacklePhase, TK } = await import('../js/ui/animSync.js');
  // Fente : pied au plus loin (phase 0,5 des images clés) à t1 du moteur ; fin du geste au relevé.
  assert.equal(tacklePhase('stand', -0.01), null);
  assert.equal(tacklePhase('stand', TK.stand.t1), 0.5);
  assert.ok(tacklePhase('stand', TK.stand.dur) > 0.5 && tacklePhase('stand', TK.stand.dur) < 1);
  assert.equal(tacklePhase('stand', TK.stand.dur + TK.stand.up + 0.01), null);
  // Glissé : au sol jambe tendue (0,26) en 0,3 s, tenu jusqu'à la fin du glissé du moteur (0,55), puis relevé.
  assert.ok(Math.abs(tacklePhase('slide', TK.slide.down) - 0.26) < 1e-9);
  assert.ok(Math.abs(tacklePhase('slide', TK.slide.dur - 1e-9) - 0.55) < 1e-6);
  assert.equal(tacklePhase('slide', TK.slide.dur + TK.slide.up + 0.01), null);
  // Monotone (aucun retour en arrière de l'animation).
  let prev = -1; for (let s = 0; s < 1.6; s += 0.01) { const u = tacklePhase('slide', s); if (u == null) break; assert.ok(u >= prev); prev = u; }
});

test('touche (6c-D) : ballon dans les mains jusqu\'à l\'instant réel du lâcher ; sans libération : ballon reposé, aucun lancer', async () => {
  const { TH } = await import('../js/ui/animSync.js');
  const m = createMatch(await cfgFor(21)), sim = new LiveSim(m);
  sim.gest.all = true;
  const view = { live: sim, players: sim.players, phys: sim.P };
  const D = new DisplayBuffer(view);
  let before = 0, after = 0, atRel = 0, held = 0, noRel = 0;
  for (let k = 0; k < 96 * 60 * 9 && m.phase !== 'ft'; k++) {
    sim.step(dt); if (m.phase === 'ht') sim.resumeHT = true;
    D.record(); D.sample('contrat');
    const tD = sim.now - DELAY;
    for (const g of sim.gest.gestures) {
      if (g.kind !== 'touche' || Math.abs(tD - g.t0) > 0.5) continue;
      const d = D.disp.get(g.pid); if (!d) continue;
      assert.ok(!(d.throwIn > 0), 'ancien minuteur de touche coupé');
      if (g.tContact == null) {
        assert.equal(d._th, null, 'aucun lancer sans lâcher');
        // Touche sans libération : le ballon est reposé (dépose de TH.lead avant à TH.drop après le début du geste).
        if (tD >= g.t0 - TH.lead + dt && tD <= g.t0 + TH.drop - dt) { assert.ok(d._thDrop && d._thDrop.u > 0 && d._thDrop.u < 1, 'dépose en cours'); noRel++; }
        if (tD > g.t0 + TH.drop + dt) assert.equal(d._thDrop, null, 'dépose terminée : ballon du moteur');
        continue;
      }
      if (tD >= g.tContact - TH.lead && tD < g.tContact) { assert.ok(d._th && d._thHeld, 'tenu avant le lâcher'); before++; }
      if (tD >= g.tContact && tD <= g.tContact + TH.post) { assert.ok(d._th && !d._thHeld, 'lâché à l\'instant réel'); after++; if (Math.abs(tD - g.tContact) < dt) atRel++; }
      if (tD < g.tContact - TH.lead && d.hold > 0) { assert.ok(d._thHold, 'tenue : prise relevée'); held++; }
    }
  }
  assert.ok(before > 0 && after > 0 && held > 0 && noRel > 0, `touches observées (avant ${before}, après ${after}, tenue ${held}, sans lâcher ${noRel})`);
});
