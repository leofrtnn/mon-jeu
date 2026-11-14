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

test('monde réel : 55 championnats (dont 5 deuxièmes divisions), vrais clubs et joueurs, 18 à 38 journées', async () => {
  const { loadRealData } = await import('../js/data/realWorld.js');
  const { DIVISIONS, DIV_IDS, applyWorld } = await import('../js/data/world.js');
  const { leagueRoundOf } = await import('../js/game/season.js');
  const s = newGame(11, { real: await loadRealData() });
  assert.equal(s.world, 'real');
  const sizes = [20, 20, 20, 18, 18, 18, 18, 18, 18, 16, 14, 16, 18, 12, 12, 12, 12, 16, 10, 14, 20, 18, 18, 20, 16, 16, 16, 12, 14, 14, 24, 22, 20, 18, 18,
    12, 16, 12, 14, 12, 16, 18, 16, 20, 16, 30, 30, 20, 16, 16, 12, 16, 16, 16, 12];
  assert.equal(DIV_IDS.length, 55, `${DIV_IDS.length} championnats`);
  assert.deepEqual(DIV_IDS.map((d) => s.clubs.filter((c) => c.div === d).length), sizes.slice(0, DIV_IDS.length));
  const { CONTI_SLOTS } = await import('../js/data/world.js');
  assert.equal(Object.values(CONTI_SLOTS).reduce((a, n) => a + n, 0), 16, '16 qualifiés continentaux');
  assert.ok(['Benfica', 'Ajax', 'Galatasaray', 'Club Brugge', 'Slavia'].every((k) => s.clubs.some((c) => c.name.includes(k))), 'grands clubs des championnats 6 à 10');
  assert.ok(s.clubs.some((c) => c.name === 'Paris Saint-Germain'));
  assert.ok(['Flamengo', 'Al Hilal', 'Zenit', 'Shakhtar', 'Ferencváros'].every((k) => s.clubs.some((c) => c.name.includes(k))), 'grands clubs des championnats 21 à 30');
  assert.ok(Object.values(s.players).some((p) => p.last === 'Mbappé' || p.last === 'Bellingham'));
  assert.ok(['Al-Sadd', 'Wydad', 'Peñarol', 'Millonarios', 'Melbourne City'].every((k) => s.clubs.some((c) => c.name.includes(k))), 'grands clubs des championnats 36 à 45');
  assert.ok(['Inter Miami', 'Boca Juniors', 'River Plate', 'Al Ahly', 'Mamelodi Sundowns', 'LDU Quito'].every((k) => s.clubs.some((c) => c.name.includes(k))), 'grands clubs des championnats 46 à 50');
  assert.ok(['Slovan Bratislava', 'Ludogorets', 'MC Alger', 'ES Tunis', 'Olimpia'].every((k) => s.clubs.some((c) => c.name.includes(k))), 'grands clubs des championnats 51 à 55');
  const { CONTI_COMPS } = await import('../js/data/world.js');
  assert.deepEqual(Object.keys(CONTI_COMPS), ['ucl', 'uel', 'uecl', 'lib', 'acl', 'ccc', 'caf'], 'les 7 coupes continentales');
  const { startCareer } = await import('../js/game/season.js');
  startCareer(s, s.clubs[0].id);
  assert.equal(Object.keys(s.contis).length, 7);
  assert.ok(Object.values(s.contis).every((c) => c.teams.length === 16 && new Set(c.teams).size === 16));
  assert.ok(Object.keys(s.supers).length >= 10, 'supercoupes nationales');
  assert.equal(new Set(s.clubs.map((c) => c.key)).size, s.clubs.length, 'identifiants de clubs uniques (Liverpool, Everton…)');
  // Le Championship (24 clubs) impose 46 créneaux : les championnats à 34 journées en sautent 12.
  const { syncLeagueSlots } = await import('../js/game/season.js');
  syncLeagueSlots({ leagueSlots: 46 });
  let n = 0; for (let r = 0; r < 46; r++) if (leagueRoundOf(34, r) != null) n++;
  assert.equal(n, 34);
  n = 0; for (let r = 0; r < 46; r++) if (leagueRoundOf(46, r) != null) n++;
  assert.equal(n, 46);
  startCareer(s, s.clubs.find((c) => c.div === 5).id);
  s.preseason.active = false;
  for (let i = 0; i < 3; i++) completeDay(s);
  assert.ok(DIVISIONS[5].name === 'Ligue 1');
  applyWorld('fictional');
});

test('messagerie : un joueur écrit, le coach répond (effets), le coach écrit en premier', async () => {
  const { chatDaily, replyChat, writeChat, thread, TOPICS } = await import('../js/game/chat.js');
  const { createRng } = await import('../js/core/rng.js');
  const st = newGame(77);
  startCareer(st, st.clubs[3].id);
  const uc = st.clubs.find((c) => c.id === st.userClubId);
  const p = st.players[uc.playerIds[5]];
  p.lastRating = 8.6; p.lastRatingDay = st.day;
  for (const id of uc.playerIds) if (id !== p.id) st.players[id].chatDay = st.day; // seul p peut écrire
  st.players[p.id].chatDay = null;
  chatDaily(st, createRng(3));
  const t = thread(st, p.id);
  assert.equal(t.pending, 'greatgame', 'le joueur écrit après un grand match');
  assert.ok(st.messages.some((m) => m.action?.type === 'chat' && m.action.pid === p.id), 'notification dans la boîte de réception');
  const before = p.morale;
  replyChat(st, p.id, 'praise');
  assert.ok(p.morale > before, 'le moral monte');
  assert.equal(t.pending, null);
  assert.equal(t.msgs.length, 3);
  const r = writeChat(st, p.id, 'how');
  assert.ok(r.ok && t.msgs.length === 5, 'le joueur répond à « comment tu te sens »');
  assert.ok(Object.keys(TOPICS).length >= 6);
});

test('sélections : Coupe du monde, Euro, Copa, CAN… avec qualifiés par confédération, parcours des joueurs et palmarès', async () => {
  const { loadRealData } = await import('../js/data/realWorld.js');
  const { runSummerTournaments, tournamentsIn } = await import('../js/game/international.js');
  const { confedOf } = await import('../js/data/nations.js');
  const s = newGame(21, { real: await loadRealData() });
  startCareer(s, s.clubs[0].id);
  assert.deepEqual(tournamentsIn(2030), ['wc']);
  assert.deepEqual(tournamentsIn(2028).sort(), ['copa', 'euro']);
  assert.deepEqual(tournamentsIn(2027).sort(), ['afcon', 'asia', 'gold']);
  // Nationalités normalisées en français.
  assert.ok(!Object.values(s.players).some((p) => ['BRAZIL', 'SPAIN', 'SER', 'NGR'].includes(p.nat)), 'nationalités normalisées');
  const t0 = Date.now();
  const [wc] = runSummerTournaments(s, 2030);
  assert.ok(Date.now() - t0 < 3000, 'tournoi rapide');
  assert.equal(wc.size, 48);
  assert.equal(wc.groups.length, 12);
  assert.deepEqual(wc.rounds.map((r) => r.label), ['32es de finale', '8es de finale', 'Quarts de finale', 'Demi-finales', 'Finale']);
  const euro = runSummerTournaments(s, 2028).find((t) => t.key === 'euro');
  assert.ok(euro.groups.every((g) => g.table.every((t) => confedOf(t.n) === 'UEFA')), 'Euro : uniquement des nations européennes');
  const p = Object.values(s.players).find((x) => x.tourns?.length);
  assert.ok(p && p.caps > 0 && p.tourns[0].name, 'parcours en sélection enregistré');
  assert.equal(s.intlT.history.length, 3);
  assert.ok(s.intlT.history.every((h) => h.winner));
});

test('carrière et blessures : historique par saison, historique des blessures, rythme de match', async () => {
  const s = newGame(5);
  startCareer(s, s.clubs[0].id);
  const uc = userClub(s);
  const { logInjury } = await import('../js/game/injuries.js');
  const p = clubPlayers(s, uc)[0];
  p.injury = 4; p.injuryName = 'Élongation';
  logInjury(s, p, 'Ligue 1');
  assert.equal(p.injHist[0].what, 'Élongation');
  while (s.day < s.calendar.length) completeDay(s);
  endSeason(s);
  const q = Object.values(s.players).find((x) => x.hist?.length && x.hist[0].apps > 10);
  assert.ok(q, 'saison écoulée enregistrée dans la carrière');
  assert.ok(q.hist[0].club && q.hist[0].y === 2026);
  // Pré-saison : tests physiques → rythme de match.
  const sharp = clubPlayers(s, userClub(s)).filter((x) => x.sharp != null);
  assert.ok(sharp.length > 10 && sharp.every((x) => x.sharp < 80), 'reprise : joueurs en manque de rythme');
});
