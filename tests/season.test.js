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
    assert.equal(state.day, state.calendar.length);
    assert.equal(state.calendar.length, 52);
    for (const div of [1, 2, 3, 4]) {
      const tab = sortedTable(state, div);
      assert.equal(tab.length, 20);
      for (const r of tab) assert.equal(r.p, 38);
      const goals = tab.reduce((a, r) => a + r.gf, 0);
      const avg = goals / 380;
      assert.ok(avg > 2 && avg < 3.3, `buts/match div ${div} = ${avg}`);
    }
    for (const c of Object.values(state.cups)) assert.ok(c.winner, `vainqueur ${c.name}`);
    assert.ok(state.conti.winner, 'vainqueur continental');
    assert.ok(Object.values(state.nations).some((n) => n.p >= 3), 'matchs internationaux joués');
    const rep = endSeason(state);
    assert.equal(rep.promoted.length, 3);
    for (const d of [1, 2, 3, 4]) assert.equal(state.clubs.filter((c) => c.div === d).length, 20);
    for (const c of state.clubs) {
      assert.ok(Number.isFinite(c.budget), 'budget fini');
      assert.ok(c.playerIds.length >= 18 && c.playerIds.length <= 34, `effectif ${c.name} ${c.playerIds.length}`);
      for (const id of c.playerIds) assert.ok(state.players[id], 'joueur existe');
    }
  }
  const size = JSON.stringify(state).length;
  console.log(`taille de sauvegarde : ${(size / 1024).toFixed(0)} Ko, budget user ${userClub(state).budget}`);
  assert.ok(size < 4_000_000);
});

test('import / export de noms', async () => {
  const { exportNames, importNames } = await import('../js/game/dataImport.js');
  const state = newGame(99);
  const data = exportNames(state);
  data.clubs[0].name = 'Club Importé';
  data.clubs[0].players[0] = 'Jean Testeur';
  const r = importNames(state, JSON.parse(JSON.stringify(data)));
  assert.ok(r.ok);
  assert.equal(state.clubs[0].name, 'Club Importé');
  assert.equal(state.players[state.clubs[0].playerIds[0]].name, 'J. Testeur');
});

test('effectif : on ne peut pas tout libérer ; moins de 7 joueurs = défaite 3-0', async () => {
  const { releasePlayer } = await import('../js/game/transfers.js');
  const { createMatch, simulateMatch } = await import('../js/engine/match.js');
  const { simulateLive } = await import('../js/engine/live.js');
  const st = newGame(21);
  const uc = st.clubs[2]; startCareer(st, uc.id);
  uc.budget = 1e9;
  for (const id of [...uc.playerIds]) releasePlayer(st, id);
  assert.ok(uc.playerIds.length >= 16, `effectif minimum gardé (${uc.playerIds.length})`);
  uc.playerIds = []; uc.lineup = null; uc.bench = [];
  let g = 0; while (!today(st).userFixture && g++ < 10) completeDay(st);
  const cfg = userMatchCfg(st);
  const us = cfg.home.club.id === uc.id ? 0 : 1;
  for (const m of [simulateMatch(cfg), (() => { const x = createMatch(cfg); simulateLive(x, 0.05); return x; })()]) {
    assert.equal(m.score[us], 0); assert.equal(m.score[1 - us], 3);
  }
});
