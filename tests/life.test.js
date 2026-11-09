/**
 * Scénarios ciblés des systèmes « vie du club » (un ou plusieurs tests par système).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRng } from '../js/core/rng.js';
import { newGame, startCareer, completeDay, endSeason } from '../js/game/season.js';
import { userClub, clubPlayers, clubById, adoptState, SAVE_VERSION } from '../js/game/state.js';
import { overall } from '../js/engine/ratings.js';
import { BAL } from '../js/data/balance.js';
import { countTexts } from '../js/data/pressTexts.js';
import { ensureLife } from '../js/game/life.js';
import { openDecisions, resolveDecision, pushDecision, expireDecisions } from '../js/game/inbox.js';
import { createInterview, answerInterview, createConference, answerConference, checkConsistency, matchMods, STYLES } from '../js/game/press.js';
import { core, influence, dressingDaily, requestsDaily, pers } from '../js/game/people.js';
import { finHealth, crisisDaily, takeovers, ownerType } from '../js/game/owners.js';
import { relGet, relAdd, sellPolicy, isDerby, relationsDaily, tension } from '../js/game/relations.js';
import { askingPrice } from '../js/game/transfers.js';
import { homeAdvantage, gateMult } from '../js/game/fans.js';
import { noteInjury, relapseCheck, relapseRisk } from '../js/game/injuries.js';
import { agentOf, paySellOn } from '../js/game/agents.js';
import { deadlineEvent } from '../js/game/deadline.js';

function world(seed = 5) {
  const s = newGame(seed);
  startCareer(s, s.clubs[6].id);
  s.preseason.active = false;
  ensureLife(s);
  return s;
}
const digest = (s, over = {}) => {
  const uc = userClub(s);
  const xi = clubPlayers(s, uc).slice(0, 11);
  return { opp: s.clubs.find((c) => c.id !== uc.id && c.div === uc.div).id, comp: 'league', gf: 0, ga: 2, scorers: [], worst: { id: xi[3].id, rating: 5.1 }, reds: [xi[4].id], young: [], lineup: xi.map((p) => p.id), played: xi.map((p) => p.id), goalsBy: {}, controversy: true, ...over };
};

test('textes de presse : au moins 300 formulations', () => {
  assert.ok(countTexts() >= 300, `${countTexts()} formulations`);
});

test('1. interview : 1 à 3 questions contextuelles, effets après le choix, fatigue médiatique', () => {
  const s = world();
  const rng = createRng(3);
  createInterview(s, digest(s), rng);
  const iv = s.life.interview;
  assert.ok(iv.qs.length >= 1 && iv.qs.length <= 3);
  assert.ok(iv.qs.some((q) => ['loss', 'heavyloss'].includes(q.topic)));
  for (const q of iv.qs) { assert.equal(Object.keys(q.answers).length, 4); assert.ok(!q.text.includes('{')); }
  assert.equal(openDecisions(s, 'interview').length, 1);
  const r = answerInterview(s, 0, 'humble');
  assert.ok(r.effects && typeof r.effects.board === 'number');
  // Fatigue : la même réponse répétée perd de son effet.
  const first = Math.abs(r.effects.media);
  for (let i = 0; i < 5; i++) { createInterview(s, digest(s), createRng(10 + i)); answerInterview(s, 0, 'humble'); }
  createInterview(s, digest(s), createRng(99));
  const last = answerInterview(s, 0, 'humble');
  assert.ok(Math.abs(last.effects.media) < first || last.backfire, 'rendements décroissants');
});

test('1. cohérence : « je fais confiance à X » puis X sur le banc → pénalité et rappel', () => {
  const s = world();
  const p = clubPlayers(s, userClub(s))[2];
  s.coach.statements.push({ day: s.day, season: s.season, style: 'protect', trust: p.id, checks: 0, resolved: false, text: 'x' });
  const mediaBefore = s.coach.media, moraleBefore = p.morale;
  checkConsistency(s, digest(s, { lineup: [] }));
  assert.ok(s.coach.media < mediaBefore);
  assert.ok(p.morale < moraleBefore);
  assert.ok(s.life.callbacks.some((c) => c.type === 'lie' && c.pid === p.id));
  createInterview(s, digest(s), createRng(1));
  assert.equal(s.life.interview.qs[0].topic, 'lie', 'le journaliste ressort la contradiction');
});

test('1. ne pas répondre : coûte un peu de réputation médias', () => {
  const s = world();
  createInterview(s, digest(s), createRng(4));
  const m = openDecisions(s, 'interview')[0];
  const before = s.coach.media;
  resolveDecision(s, m.id, 'skip');
  assert.ok(s.coach.media < before);
});

test('2. conférence d\'avant-match : gros match, motivation adverse et pression', () => {
  const s = world();
  const uc = userClub(s);
  const opp = s.clubs.find((c) => c.id !== uc.id && isDerby(s, uc.id, c.id)) || s.clubs.find((c) => c.id !== uc.id);
  if (!isDerby(s, uc.id, opp.id)) relAdd(s, uc.id, opp.id, -80);
  const ok = createConference(s, { h: uc.id, a: opp.id, comp: 'league' }, { round: 3 }, createRng(2));
  assert.ok(ok, 'conférence créée pour un derby / match tendu');
  assert.equal(s.life.interview.qs.length, 2);
  answerConference(s, 0, 'fighter'); answerConference(s, 1, 'fighter');
  const mm = matchMods(s);
  assert.ok(mm.opp > 0, 'provocation : l\'adversaire est surmotivé');
  assert.ok(Math.abs(mm.me) <= BAL.press.talkClamp);
});

test('3. vestiaire : un leader mécontent contamine, un leader heureux apaise', () => {
  const s = world();
  const uc = userClub(s);
  const sq = clubPlayers(s, uc);
  for (const p of sq) p.morale = 60;
  const leader = core(s)[0].p;
  leader.morale = 10;
  const others = sq.filter((p) => p !== leader);
  const avg0 = others.reduce((a, p) => a + p.morale, 0) / others.length;
  for (let i = 0; i < 4; i++) { leader.morale = 10; dressingDaily(s); }
  const avg1 = others.reduce((a, p) => a + p.morale, 0) / others.length;
  assert.ok(avg1 < avg0 - 1, `contagion ${avg0} → ${avg1}`);
  for (const p of sq) p.morale = 30;
  leader.morale = 95;
  const a0 = others.reduce((a, p) => a + p.morale, 0) / others.length;
  dressingDaily(s);
  const a1 = others.reduce((a, p) => a + p.morale, 0) / others.length;
  assert.ok(a1 > a0, 'apaisement');
  assert.ok(influence(s, leader) >= 0 && influence(s, leader) <= 100);
});

test('4. demande ignorée → sortie publique (board et vestiaire en baisse)', () => {
  const s = world();
  const p = clubPlayers(s, userClub(s))[5];
  pushDecision(s, { kind: 'request', title: 't', data: { pid: p.id, type: 'departure' }, choices: [{ key: 'promise', label: 'x' }], days: 2 });
  const b0 = s.board.parts.results, d0 = s.coach.dressing;
  s.day += 3;
  expireDecisions(s);
  assert.ok(s.board.parts.results < b0);
  assert.ok(s.coach.dressing < d0);
  assert.ok(s.messages.some((m) => m.title.includes('presse')));
});

test('4. promesse mémorisée puis vérifiée', () => {
  const s = world();
  const p = clubPlayers(s, userClub(s))[20];
  s.seasonStats.m = 6;
  pushDecision(s, { kind: 'request', title: 't', data: { pid: p.id, type: 'playtime' }, choices: [{ key: 'promise', label: 'x' }], days: 2 });
  resolveDecision(s, s.messages[0].id, 'promise');
  assert.equal(p.promises.length, 1);
  assert.equal(p.promises[0].kept, undefined);
});

test('5. rachat : nouveau propriétaire, apport, budgets selon le profil', () => {
  const s = world();
  const rng = createRng(1);
  const before = s.clubs.map((c) => c.owner.type);
  const save = BAL.owners.takeoverRate;
  BAL.owners.takeoverRate = 1;
  const ids = takeovers(s, rng);
  BAL.owners.takeoverRate = save;
  assert.equal(ids.length, s.clubs.length);
  assert.ok(s.clubs.every((c, i) => c.owner.type !== before[i]), 'le type de propriétaire change');
  assert.ok(openDecisions(s, 'owner').length + (s.sacked ? 1 : 0) === 1, 'rencontre avec le propriétaire (ou renvoi)');
  for (const c of s.clubs) assert.ok(ownerType(c).budget > 0);
});

test('6. rivaux : refus de vendre un titulaire à un concurrent direct, avec la raison', () => {
  const s = world();
  const uc = userClub(s);
  const rival = s.clubs.find((c) => c.id !== uc.id && isDerby(s, uc.id, c.id)) || s.clubs.find((c) => c.id !== uc.id);
  relAdd(s, uc.id, rival.id, -50);
  const star = clubPlayers(s, rival).sort((a, b) => overall(b) - overall(a))[1];
  const pol = sellPolicy(s, star, uc);
  assert.equal(pol.ok, false);
  assert.match(pol.reason, /concurrent|rompues|solidarité/);
});

test('6. intouchable : prix multiplié, crise : soldes', () => {
  const s = world();
  const uc = userClub(s);
  const c = s.clubs.find((x) => x.id !== uc.id && !isDerby(s, uc.id, x.id) && x.div !== uc.div);
  const star = clubPlayers(s, c).sort((a, b) => overall(b) - overall(a))[0];
  const pol = sellPolicy(s, star, uc);
  assert.equal(pol.kind, 'untouchable');
  assert.ok(pol.mult >= BAL.rivals.untouchableMult);
  const normal = askingPrice(s, star);
  c.crisis = true;
  assert.ok(askingPrice(s, star) < normal, 'un club en crise brade');
});

test('7. relations : amitié = prix réduits, hostilité = match tendu, retour vers la base', () => {
  const s = world();
  const uc = userClub(s);
  const c = s.clubs.find((x) => x.id !== uc.id && !isDerby(s, uc.id, x.id) && x.div !== uc.div);
  const p = clubPlayers(s, c).sort((a, b) => overall(a) - overall(b))[0];
  const p0 = askingPrice(s, p);
  relAdd(s, uc.id, c.id, 60);
  assert.ok(askingPrice(s, p) < p0);
  relAdd(s, uc.id, c.id, -110); // → -50 : hostile mais pas rompu
  assert.ok(askingPrice(s, p) > p0);
  relAdd(s, uc.id, c.id, -40);  // → -90 : relations rompues
  assert.equal(sellPolicy(s, p, uc).ok, false);
  assert.ok(tension(s, uc.id, c.id) > 1);
  const v = relGet(s, uc.id, c.id);
  const rng = createRng(1);
  for (let i = 0; i < 30; i++) relationsDaily(s, rng);
  assert.ok(Math.abs(relGet(s, uc.id, c.id)) < Math.abs(v), 'déclin naturel');
});

test('8. crise financière : détection, message « cherche à vendre », retrait de points', () => {
  const s = world();
  const c = s.clubs.find((x) => x.id !== s.userClubId);
  c.budget = -1e9;
  clubPlayers(s, c)[0].wage = 5e6; // masse salariale intenable
  const pts = s.tables[c.div][c.id].pts;
  crisisDaily(s, createRng(1));
  assert.ok(c.crisis);
  assert.ok(finHealth(s, c) < BAL.crisis.bankrupt);
  assert.equal(s.tables[c.div][c.id].pts, pts - BAL.crisis.pointsPenalty);
  assert.ok(s.messages.some((m) => m.title.includes('cherche à vendre')));
  crisisDaily(s, createRng(2));
  assert.equal(s.tables[c.div][c.id].pts, pts - BAL.crisis.pointsPenalty, 'une seule pénalité par saison');
});

test('10. agents et clauses : agent des joueurs importants, pourcentage à la revente', () => {
  const s = world();
  const best = Object.values(s.players).sort((a, b) => overall(b) - overall(a))[0];
  assert.ok(agentOf(best));
  const uc = userClub(s);
  const seller = s.clubs.find((c) => c.id !== uc.id);
  best.sellOn = { clubId: uc.id, pct: 0.2 };
  const b0 = uc.budget;
  paySellOn(s, best, seller, 10_000_000);
  assert.equal(uc.budget - b0, 2_000_000);
  assert.equal(best.sellOn, null);
});

test('11. deadline day : événements valides et déterministes', () => {
  const s = world();
  let kinds = new Set();
  for (let i = 0; i < 60; i++) {
    const ev = deadlineEvent(s, i);
    if (!ev) continue;
    kinds.add(ev.type);
    assert.ok(ev.text && !ev.text.includes('undefined'));
    assert.deepEqual(ev, deadlineEvent(s, i));
  }
  assert.ok(kinds.has('offer') && kinds.has('bargain') && kinds.has('news'));
});

test('12. supporters : l\'ambiance module l\'avantage du terrain et la billetterie', () => {
  const s = world();
  const c = userClub(s);
  c.atmosphere = 90; const hi = homeAdvantage(c), gh = gateMult(c);
  c.atmosphere = 10; const lo = homeAdvantage(c), gl = gateMult(c);
  assert.ok(hi > lo && hi <= BAL.fans.homeAdv[1] && lo >= BAL.fans.homeAdv[0]);
  assert.ok(gh > gl);
});

test('14. blessure longue : retour anticipé possible, rechute plus longue', () => {
  const s = world();
  const p = clubPlayers(s, userClub(s))[1];
  p.injury = 20; noteInjury(s, p);
  assert.ok(p.injLong);
  p.injury = 3;
  p.relapse = { risk: 1, matches: 3, total: 20 };
  relapseCheck(s, { played: [p.id] }, createRng(1));
  assert.ok(p.injury >= 20, 'rechute plus longue que la blessure initiale');
  p.injury = 5; p.injTotal = 10;
  assert.ok(relapseRisk(s, p) > 0 && relapseRisk(s, p) < 1);
});

test('migration : une sauvegarde v2 est acceptée et migrée en v3', () => {
  const s = world();
  const old = JSON.parse(JSON.stringify(s));
  old.version = 2; delete old.life; delete old.ownersReady;
  for (const c of old.clubs) { delete c.owner; delete c.atmosphere; }
  const m = adoptState(old);
  assert.ok(m);
  assert.equal(m.version, SAVE_VERSION);
  ensureLife(m);
  assert.ok(m.clubs.every((c) => c.owner && c.atmosphere != null));
  assert.ok(m.life.streak && m.coach.media != null);
});

test('intégration : une journée réelle crée l\'interview et fait vivre les systèmes', () => {
  const s = world(8);
  let guard = 0;
  while (!openDecisions(s, 'interview').length && guard++ < 10) completeDay(s);
  assert.ok(openDecisions(s, 'interview').length, 'interview après le match de l\'utilisateur');
  assert.ok(STYLES.every((st) => typeof st === 'string'));
  assert.ok(pers(clubPlayers(s, userClub(s))[0]));
  assert.ok(clubById(s, s.userClubId).owner);
});
