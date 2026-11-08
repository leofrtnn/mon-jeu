/**
 * Multijoueur asynchrone : codes d'équipe et ligue déterministe.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newGame, startCareer, changeClub } from '../js/game/season.js';
import { snapshotTeam, encodeTeam, decodeTeam, computeFriendsLeague, encodeLeague, decodeLeague } from '../js/game/friends.js';

test('code d\'équipe : aller-retour et détection d\'un code abîmé', async () => {
  const s = newGame(7); startCareer(s, s.clubs[3].id);
  const code = await encodeTeam(snapshotTeam(s));
  assert.ok(code.startsWith('CDP1-') && code.length < 3000, `longueur ${code.length}`);
  const t = await decodeTeam(code);
  assert.equal(t.name, s.clubs[3].name);
  assert.equal(t.players.length, 20);
  await assert.rejects(decodeTeam(code.slice(0, -12)));
});

test('ligue entre amis : mêmes codes => mêmes résultats, quel que soit l\'ordre', async () => {
  const s = newGame(11); startCareer(s, s.clubs[0].id);
  const codes = [];
  for (const i of [0, 5, 22, 45]) { changeClub(s, s.clubs[i].id); codes.push(await encodeTeam(snapshotTeam(s))); }
  const teams = await Promise.all(codes.map(decodeTeam));
  const a = computeFriendsLeague(teams);
  const b = computeFriendsLeague(teams.slice().reverse());
  assert.deepEqual(a.table, b.table);
  assert.equal(a.table.reduce((x, r) => x + r.p, 0), 4 * 3 * 2);
  const back = await decodeLeague(await encodeLeague(codes));
  assert.deepEqual(back, codes);
});
