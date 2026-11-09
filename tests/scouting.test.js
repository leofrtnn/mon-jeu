/**
 * Missions de recrutement et contrats du staff négociés.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newGame, startCareer, completeDay } from '../js/game/season.js';
import { userClub } from '../js/game/state.js';
import { startMission, MISSION_DAYS } from '../js/game/scouting.js';
import { staffDemand, staffOffer, STAFF_ROLES } from '../js/game/career.js';

test('mission de recrutement : observations puis recommandations', () => {
  const state = newGame(777);
  startCareer(state, state.clubs[5].id);
  const uc = userClub(state);
  const sc = uc.staffMembers.find((m) => m.role === 'scout');
  const r = startMission(state, sc.id, { region: 'IBE', pos: 'BU', maxAge: 26 });
  assert.ok(r.ok);
  for (let i = 0; i < MISSION_DAYS; i++) completeDay(state);
  assert.ok(!state.missions[sc.id], 'mission terminée');
  const reco = state.scoutReports.filter((x) => x.by.includes(sc.last));
  assert.ok(reco.length > 0, 'recommandations');
  for (const x of reco) {
    const p = state.players[x.pid];
    assert.equal(p.pos, 'BU');
    assert.ok(state.scout[p.id] > 0);
  }
  assert.ok(state.messages.some((m) => m.title.startsWith('Mission terminée')));
});

test('staff : négociation, contre-offre, embauche et prolongation', () => {
  const state = newGame(4242);
  startCareer(state, state.clubs[3].id);
  const uc = userClub(state);
  // Libère un poste d'analyste pour pouvoir embaucher.
  uc.staffMembers = uc.staffMembers.filter((m) => m.role !== 'analyst');
  const cand = state.staffPool.find((m) => m.role === 'analyst' && !staffDemand(state, m).refuses)
    || (() => { const m = { ...state.staffPool[0], role: 'analyst', rating: 8, id: 'Stest' }; state.staffPool.push(m); return m; })();
  const d = staffDemand(state, cand);
  const low = staffOffer(state, cand.id, { wage: Math.round(d.wage * 0.9), years: d.years });
  assert.equal(low.kind, 'counter');
  const ok = staffOffer(state, cand.id, { wage: low.counter, years: d.years });
  assert.equal(ok.kind, 'accept');
  const hired = uc.staffMembers.find((m) => m.id === cand.id);
  assert.ok(hired && hired.contract === d.years);
  // Prolongation.
  const rd = staffDemand(state, hired, true);
  const r = staffOffer(state, hired.id, { wage: rd.wage, years: 2 + 0 }, true);
  assert.ok(['accept', 'counter'].includes(r.kind));
  // Trois refus d'affilée : fin des discussions.
  const other = state.staffPool.find((m) => !staffDemand(state, m).refuses);
  let last;
  for (let i = 0; i < 3; i++) last = staffOffer(state, other.id, { wage: 300, years: 1 });
  assert.equal(last.kind, 'end');
  assert.ok(Object.keys(STAFF_ROLES).includes(other.role));
});
