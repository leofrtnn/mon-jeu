/**
 * Tests de la boucle de saison : 2 saisons complètes simulées automatiquement.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newGame, startCareer, completeDay, endSeason, sortedTable, today, userMatchCfg } from '../js/game/season.js';
import { userClub } from '../js/game/state.js';
import { createMatch, stepMinute } from '../js/engine/match.js';

test('deux saisons complètes sans erreur', () => {
  const state = newGame(12345);
  startCareer(state, state.clubs[8].id);
  for (let season = 0; season < 2; season++) {
    let guard = 0;
    while (!state.seasonOver && guard++ < 60) {
      const t = today(state);
      let m = null;
      if (t.userFixture && state.day % 3 === 0) {
        // De temps en temps, on "joue" le match de l'utilisateur pas à pas.
        m = createMatch(userMatchCfg(state));
        while (m.phase !== 'ft') stepMinute(m);
      }
      completeDay(state, m);
    }
    assert.equal(state.day, 43);
    for (const div of [1, 2]) {
      const tab = sortedTable(state, div);
      assert.equal(tab.length, 20);
      for (const r of tab) assert.equal(r.p, 38);
      const goals = tab.reduce((a, r) => a + r.gf, 0);
      const avg = goals / 380;
      assert.ok(avg > 2 && avg < 3.3, `buts/match div ${div} = ${avg}`);
    }
    assert.ok(state.cup.winner, 'vainqueur de coupe');
    const rep = endSeason(state);
    assert.equal(rep.promoted.length, 3);
    assert.equal(state.clubs.filter((c) => c.div === 1).length, 20);
    for (const c of state.clubs) {
      assert.ok(Number.isFinite(c.budget), 'budget fini');
      assert.ok(c.playerIds.length >= 18 && c.playerIds.length <= 34, `effectif ${c.name} ${c.playerIds.length}`);
      for (const id of c.playerIds) assert.ok(state.players[id], 'joueur existe');
    }
  }
  const size = JSON.stringify(state).length;
  console.log(`taille de sauvegarde : ${(size / 1024).toFixed(0)} Ko, budget user ${userClub(state).budget}`);
  assert.ok(size < 2_500_000);
});
