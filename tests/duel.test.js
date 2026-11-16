/**
 * Match entre deux managers en ligne : deux appareils simulent le même match, chacun à son
 * rythme, avec des messages qui arrivent en retard et des décisions prises n'importe quand.
 * Le match doit rester IDENTIQUE sur les deux appareils (score, buteurs, statistiques).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadRealData } from '../js/data/realWorld.js';
import { newGame, matchCfgFor } from '../js/game/season.js';
import { createMatch, replayCfg } from '../js/engine/match.js';
import { MENTALITIES } from '../js/data/constants.js';
import { LiveSim } from '../js/engine/live.js';
import { createRng } from '../js/core/rng.js';
import { DuelSync, execOp, RNG_OPS } from '../js/online/duel.js';

const data = await loadRealData();
const st = newGame(33, { real: data });
const l1 = st.clubs.filter((c) => c.div === 5).sort((a, b) => b.rep - a.rep);
const STEP = 1 / 96;

function runDuel(seed) {
  const cfg = matchCfgFor(st, { h: l1[1].id, a: l1[4].id, comp: 'league', div: 5 });
  cfg.seed = seed; cfg.home.isAI = false; cfg.away.isAI = false;
  const rc = replayCfg(cfg);
  const rnd = createRng(seed * 7 + 1);
  const inbox = [[], []];
  const clients = [0, 1].map((side) => {
    const m = createMatch(JSON.parse(JSON.stringify(rc)));
    const c = { side, m, live: new LiveSim(m), n: 0, d: null, done: false, subs: 0 };
    c.d = new DuelSync(side, (msg) => inbox[1 - side].push({ at: tick + 1 + rnd.int(0, 40), msg }));
    return c;
  });
  let tick = 0;
  const bench = (c) => c.m.teams[c.side].bench.filter(Boolean);
  for (; tick < 2_000_000 && !clients.every((c) => c.done); tick++) {
    for (const c of clients) {
      // Réception (latence variable).
      const box = inbox[c.side];
      for (let i = box.length - 1; i >= 0; i--) if (box[i].at <= tick) { const it = box.splice(i, 1)[0]; c.d.onMessage(it.msg); }
      if (c.done) continue;
      const d = c.d;
      // Pause commune : chacun fait (ou non) ses changements, puis reprise quand les deux ont fini.
      if (d.halt) {
        if (!d.halt.sent) {
          d.halt.sent = true;
          if (rnd.chance(0.7) && bench(c).length && c.subs < 3) {
            const out = c.m.teams[c.side].onPitch.find((mp) => mp && !mp.gk), inn = bench(c)[0];
            const a = { side: c.side, out: out.id, in: inn.id };
            d.record('sub', a); c.subs++;
          }
          if (rnd.chance(0.5)) d.record('talk', { side: c.side, kind: 'calm' }); // à tirage : appliquée à la reprise
          d.finishHalt();
        }
        const r = d.readyToResume();
        if (r) { for (const x of r.peer) execOp(c.m, c.live, x.op, x.a); for (const x of r.deferred) execOp(c.m, c.live, x.op, x.a); d.endHalt(); }
        continue;
      }
      // Chaque appareil avance à son rythme (0 à 30 pas par tour).
      const burst = rnd.int(0, 30);
      for (let k = 0; k < burst; k++) {
        let e;
        while (!d.halt && (e = d.next(c.n))) {
          if (e.op === 'pause') d.startHalt(`p${e.n}-${e.side}-${e.seq}`, c.n, e.side);
          else execOp(c.m, c.live, e.op, e.a);
        }
        if (!d.canStep(c.n)) break;
        c.live.step(STEP); c.n++;
        if (c.m.phase === 'ht') c.live.resumeHT = true;
        d.progress(c.n);
        if (c.m.phase === 'ft') { c.done = true; d.progress(c.n, true); break; }
        // Décisions en cours de jeu : tactique, cris, demande de pause.
        if (rnd.chance(0.0006)) d.schedule('ti', { side: c.side, k: 'mentality', v: MENTALITIES[rnd.int(0, MENTALITIES.length - 1)] }, c.n);
        if (rnd.chance(0.0003)) d.schedule('shout', { side: c.side, kind: 'push' }, c.n);
        if (rnd.chance(0.0002)) d.requestPause(c.n);
      }
    }
  }
  return clients;
}

for (const seed of [11]) {
  test(`match entre managers (graine ${seed}) : identique sur les deux appareils`, () => {
    const [a, b] = runDuel(seed);
    assert.ok(a.done && b.done, 'les deux matchs vont au bout');
    assert.deepEqual(a.m.score, b.m.score);
    assert.deepEqual(a.m.goals.map((g) => [g.name, g.minute]), b.m.goals.map((g) => [g.name, g.minute]));
    assert.deepEqual(a.m.teams.map((t) => [t.stats.shots, t.stats.passes, t.stats.fouls]), b.m.teams.map((t) => [t.stats.shots, t.stats.passes, t.stats.fouls]));
    assert.equal(a.n, b.n, 'même nombre de pas');
    assert.ok(RNG_OPS.has('talk'));
    
  });
}
