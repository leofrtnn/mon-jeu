import test from 'node:test';
import assert from 'node:assert/strict';
import { insights, shotProfile, shotList } from '../js/engine/analysis.js';
import { drillEffects, weeklyDrill } from '../js/game/drills.js';
import { debriefPlayer } from '../js/game/debrief.js';

const team = (poss, fouls = 8) => ({ stats: { poss, fouls }, onPitch: [], out: [], bench: [] });
const fake = (shots, score = [0, 0]) => ({ live: true, score, teams: [team(60), team(40)], log: shots.map((s) => ({ type: 'shot', ...s })),
  ana: { rec: [[2, 2, 9], [5, 3, 1]], lane: [[5, 20, 5], [3, 3, 3]] } });

test('analyse : carte des tirs et constats', () => {
  const m = fake([
    { side: 0, xg: 0.5, outcome: 'saved', ax: 0.95, ay: 0.5, minute: 10 },
    { side: 0, xg: 0.45, outcome: 'off', ax: 0.93, ay: 0.45, minute: 30 },
    { side: 0, xg: 0.4, outcome: 'blocked', ax: 0.92, ay: 0.55, minute: 50 },
    { side: 1, xg: 0.05, outcome: 'off', ax: 0.7, ay: 0.5, minute: 60 },
  ]);
  assert.equal(shotList(m).length, 4);
  const p = shotProfile(m, 0);
  assert.equal(p.n, 3); assert.equal(p.big, 3); assert.equal(p.inBox, 3);
  const txt = insights(m, 0, { pressing: 'high' }).map((i) => i.text).join(' | ');
  assert.match(txt, /Gâchis/);
  assert.match(txt, /Pressing payant/);
  assert.match(txt, /dans l'axe/);
});

test('séances collectives : maîtrise et effet lié à la tactique', () => {
  const c = { training: { drill: 'pressing' }, drills: {} };
  for (let i = 0; i < 6; i++) weeklyDrill(c, 1);
  assert.ok(c.drills.pressing > 50, `maîtrise ${c.drills.pressing}`);
  assert.equal(drillEffects(c, { pressing: 'mid' }).perf, 1);
  const fx = drillEffects(c, { pressing: 'high' });
  assert.ok(fx.perf > 1 && fx.fatigue < 1);
  c.training.drill = 'none'; const before = c.drills.pressing; weeklyDrill(c, 1);
  assert.ok(c.drills.pressing < before);
});

test('débrief : recadrer un joueur qui a bien joué le vexe', () => {
  const p = { id: 1, name: 'A B', morale: 60, form: 50, pers: 'loyal' };
  const r = debriefPlayer(p, 'criticize', 7.6);
  assert.ok(r.delta < 0 && p.morale < 60);
  const q = { id: 2, name: 'C D', morale: 60, form: 50, pers: 'loyal' };
  assert.ok(debriefPlayer(q, 'praise', 7.8).delta > 0);
});
