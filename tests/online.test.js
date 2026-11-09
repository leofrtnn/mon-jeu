/**
 * Carrière en ligne : plusieurs managers humains, tranches, fusion chez l'hôte,
 * conflits de transfert, fin de saison, protocole complet avec le serveur local.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadRealData } from '../js/data/realWorld.js';
import { createOnlineCareer, adoptOnline, makeSlice, applySlice, hostAdvance, managers } from '../js/online/multi.js';
import { userClub, clubPlayers, clubById } from '../js/game/state.js';
import { completeDay } from '../js/game/season.js';
import { LocalBackend } from '../js/online/backend.js';

const data = await loadRealData();
const clone = (o) => JSON.parse(JSON.stringify(o));


test('création : chaque manager a son club, son coach, son board et ses messages', () => {
  const tmp = createOnlineCareer(data, 5, [{ user_id: 'A', username: 'Alice', club_id: 1 }, { user_id: 'B', username: 'Bob', club_id: 2 }], 'g1');
  assert.equal(tmp.online.cur, 'A');
  assert.equal(tmp.userClubId, 1);
  const b = adoptOnline(clone(tmp), 'B');
  assert.equal(b.userClubId, 2);
  assert.ok(b.coach && b.board && b.messages.length >= 1);
  assert.notEqual(b.coach, tmp.coach);
  assert.deepEqual(managers(b).map((m) => m.clubId).sort(), [1, 2]);
});

test('journée : les deux managers jouent, la tranche de B est fusionnée chez l\'hôte', () => {
  const host = createOnlineCareer(data, 7, [{ user_id: 'A', username: 'Alice', club_id: 1 }, { user_id: 'B', username: 'Bob', club_id: 21 }], 'g2');
  const snap = JSON.stringify(host);
  // Client B : sa copie, ses actions.
  const b = adoptOnline(JSON.parse(snap), 'B');
  const baseB = adoptOnline(JSON.parse(snap), 'B');
  const uc = userClub(b);
  uc.tactics.mentality = 'attacking';
  const fa = b.players[b.freeAgents[0]];
  b.freeAgents = b.freeAgents.filter((x) => x !== fa.id);
  fa.clubId = uc.id; uc.playerIds.push(fa.id); uc.budget -= 100000;
  b.messages.unshift({ id: 1, title: 'note de Bob', text: '', prio: 3, read: false });
  const slice = makeSlice(b, baseB);
  assert.equal(slice.moves.length, 1);
  const { report, conflicts } = hostAdvance(host, [slice]);
  assert.equal(conflicts.length, 0);
  assert.equal(host.online.version, 2);
  const after = adoptOnline(JSON.parse(JSON.stringify(host)), 'B');
  const ucB = userClub(after);
  assert.equal(ucB.tactics.mentality, 'attacking');
  assert.ok(ucB.playerIds.includes(fa.id), 'la recrue de B est dans son club');
  assert.ok(!after.freeAgents.includes(fa.id));
  assert.ok(after.messages.some((m) => m.title === 'note de Bob'), 'messages de B conservés');
  assert.ok(report && host.day === 1);
});

test('conflit : deux managers recrutent le même joueur libre → le second est annulé et remboursé', () => {
  const host = createOnlineCareer(data, 9, [{ user_id: 'A', username: 'Alice', club_id: 1 }, { user_id: 'B', username: 'Bob', club_id: 21 }], 'g3');
  const snap = JSON.stringify(host);
  const pid = host.freeAgents[0];
  // L'hôte (A) signe le joueur directement dans l'état officiel.
  const ucA = userClub(host);
  host.freeAgents = host.freeAgents.filter((x) => x !== pid); host.players[pid].clubId = ucA.id; ucA.playerIds.push(pid);
  // B a fait la même chose sur sa copie.
  const b = adoptOnline(JSON.parse(snap), 'B'), baseB = adoptOnline(JSON.parse(snap), 'B');
  const ucB = userClub(b);
  b.freeAgents = b.freeAgents.filter((x) => x !== pid); b.players[pid].clubId = ucB.id; ucB.playerIds.push(pid);
  const { conflicts } = hostAdvance(host, [makeSlice(b, baseB)]);
  assert.equal(conflicts.length, 1);
  assert.equal(host.players[pid].clubId, ucA.id, 'le joueur reste chez A');
  const after = adoptOnline(JSON.parse(JSON.stringify(host)), 'B');
  assert.ok(!userClub(after).playerIds.includes(pid));
  assert.ok(after.messages.some((m) => m.title.startsWith('Transfert annulé')));
});

test('fin de saison à plusieurs : chaque manager reçoit son bilan et garde son club', () => {
  const host = createOnlineCareer(data, 11, [{ user_id: 'A', username: 'Alice', club_id: 1 }, { user_id: 'B', username: 'Bob', club_id: 21 }], 'g4');
  host.day = host.calendar.length; host.seasonOver = true;
  const { report } = hostAdvance(host, []);
  assert.ok(report.endSeason);
  assert.equal(host.season, 2027);
  const R = host.online.seasonReports;
  assert.ok(R.A && R.B && R.A.userPos && R.B.userPos);
  const after = adoptOnline(JSON.parse(JSON.stringify(host)), 'B');
  assert.equal(after.userClubId, 21);
  assert.ok(after.objectives?.league?.label);
});

test('protocole serveur (local) : création, code, choix des clubs, prêts, publication', async () => {
  const db = new Map();
  const alice = new LocalBackend(db, new Map()), bob = new LocalBackend(db, new Map());
  const ua = await alice.signUp('alice@test.fr', 'secret1', 'Alice');
  const ub = await bob.signUp('bob@test.fr', 'secret2', 'Bobby');
  await assert.rejects(() => bob.signUp('x@test.fr', 'secret3', 'alice'), /pseudo/);
  const g = await alice.createGame('Entre amis', 4);
  await bob.joinGame(g.code.toLowerCase());
  await alice.chooseClub(g.id, 1);
  await assert.rejects(() => bob.chooseClub(g.id, 1), /déjà choisi/);
  await bob.chooseClub(g.id, 21);
  let events = 0;
  const off = alice.subscribe(g.id, () => events++);
  const ps = await alice.players(g.id);
  const state = createOnlineCareer(data, 3, ps, g.id);
  await alice.startGame(g.id, JSON.stringify(state));
  assert.equal((await bob.getGame(g.id)).status, 'running');
  const st = await bob.loadState(g.id);
  const mine = adoptOnline(JSON.parse(st.data), ub.id);
  const base = adoptOnline(JSON.parse(st.data), ub.id);
  await bob.setReady(g.id, st.version, JSON.stringify(makeSlice(mine, base)));
  await alice.setReady(g.id, st.version, null);
  const all = await alice.players(g.id);
  assert.ok(all.every((p) => p.ready));
  const hostState = adoptOnline(JSON.parse(st.data), ua.id);
  hostAdvance(hostState, all.filter((p) => p.slice).map((p) => JSON.parse(p.slice)));
  await alice.publishState(g.id, hostState.online.version, JSON.stringify(hostState));
  assert.equal((await bob.loadState(g.id)).version, 2);
  assert.ok((await bob.players(g.id)).every((p) => !p.ready), 'prêts remis à zéro');
  await new Promise((r) => setTimeout(r, 5));
  assert.ok(events > 0, 'notifications en temps réel');
  off();
});
