/**
 * PRESSE : interviews d'après-match (1 à 3 questions contextuelles) et conférences
 * d'avant-match pour les gros rendez-vous. Journalistes à profils, cohérence des
 * déclarations, clips viraux, fatigue médiatique.
 */
import { clamp, createRng, hashSeed } from '../core/rng.js';
import { BAL } from '../data/balance.js';
import { JOURNALISTS, OPENERS, POST_Q, PRE_Q, ANSWERS, VIRAL, RIVAL_REPLY, STYLE_LABELS, fill } from '../data/pressTexts.js';
import { userClub, clubById, clubPlayers, pushMessage } from './state.js';
import { overall } from '../engine/ratings.js';
import { pushDecision, registerDecision } from './inbox.js';
import { moodShift, teamShift, addStatement, influence, core } from './people.js';
import { relAdd, relGet, isDerby } from './relations.js';
import { managerOf } from './managers.js';

export { STYLE_LABELS };
export const STYLES = ['humble', 'fighter', 'protect', 'evasive'];

const coachNameOf = (state, club) => managerOf(state, club)?.name || `l'entraîneur de ${club.short}`;
const qRng = (state, salt) => createRng(hashSeed(`${state.seed}-${state.season}-${state.day}-press-${salt}`));

/** Résumé exploitable d'un match de l'utilisateur. */
export function digestMatch(state, sum, m, side, f) {
  const mine = sum.ratings[side];
  const opp = clubById(state, side === 0 ? f.a : f.h);
  const ev = sum.log || [];
  return {
    opp: opp.id, comp: f.comp, gf: sum.score[side], ga: sum.score[1 - side],
    scorers: sum.goals.filter((g) => g.side === side).map((g) => g.pid ?? g.id).filter(Boolean),
    worst: mine.filter((r) => r.minutes >= 45).sort((a, b) => a.rating - b.rating)[0] || null,
    reds: mine.filter((r) => r.red).map((r) => r.id),
    young: mine.filter((r) => state.players[r.id]?.age <= 21 && r.rating >= 7.2).map((r) => r.id),
    lineup: (m.teams[side].onPitch || []).concat(m.teams[side].out || []).filter((mp) => mp && mp.minIn === 0).map((mp) => mp.id),
    played: mine.map((r) => r.id),
    goalsBy: Object.fromEntries(mine.filter((r) => r.goals).map((r) => [r.id, r.goals])),
    controversy: ev.some((e) => e.type === 'var' || (e.type === 'penalty' && e.side !== side) || (e.type === 'red')),
  };
}

/* ---------------- Interviews d'après-match ---------------- */

function topicsFor(state, d, rng) {
  const L = state.life;
  const res = d.gf > d.ga ? 'W' : d.gf < d.ga ? 'L' : 'D';
  const streak = L.streak;
  let n = 0; for (let i = streak.length - 1; i >= 0 && streak[i] === res; i--) n++;
  const out = [];
  // Rappels prioritaires : contradiction relevée, ou ancienne déclaration choc.
  const lie = L.callbacks.find((c) => c.type === 'lie');
  if (lie) { out.push({ topic: 'lie', pid: lie.pid }); L.callbacks = L.callbacks.filter((c) => c !== lie); }
  out.push({ topic: res === 'W' ? (d.gf - d.ga >= 3 ? 'bigwin' : 'win') : res === 'L' ? (d.ga - d.gf >= 3 ? 'heavyloss' : 'loss') : 'draw' });
  const extra = [];
  if (n >= 3) extra.push({ topic: res === 'W' ? 'streakWin' : res === 'L' ? 'streakLoss' : null, n });
  if (d.reds.length) extra.push({ topic: 'red', pid: d.reds[0] });
  if (d.worst && d.worst.rating < 5.8 && res !== 'W') extra.push({ topic: 'error', pid: d.worst.id });
  if (d.scorers.length) extra.push({ topic: 'scorer', pid: d.scorers[0] });
  if (d.young.length) extra.push({ topic: 'young', pid: d.young[0] });
  if (d.controversy && res !== 'W') extra.push({ topic: 'referee' });
  const rum = (L.rumours || []).find((r) => state.players[r.pid]?.clubId === state.userClubId && state.day - r.day <= 3);
  if (rum) extra.push({ topic: 'rumour', pid: rum.pid });
  const old = (state.coach.statements || []).filter((s) => s.style === 'fighter' && s.text && state.day - s.day >= 3 && s.season === state.season);
  if (old.length && rng.chance(0.3)) extra.push({ topic: 'callback', said: rng.pick(old).text });
  const k = rng.int(0, 2);
  for (const x of rng.shuffle(extra.filter((x) => x.topic))) { if (out.length >= 1 + k + (lie ? 1 : 0) || out.length >= 3) break; out.push(x); }
  return out.slice(0, 3);
}

/** Crée l'interview d'après-match (dans la boîte de réception). */
export function createInterview(state, d, rng) {
  const j = rng.pick(JOURNALISTS);
  const uc = userClub(state);
  const opp = clubById(state, d.opp);
  const vars = { opp: opp.name, score: `${d.gf}-${d.ga}`, club: uc.name, coach: coachNameOf(state, opp) };
  const mood = d.gf > d.ga ? 'win' : d.gf < d.ga ? 'loss' : 'draw';
  const qs = topicsFor(state, d, rng).map((t) => {
    const p = t.pid ? state.players[t.pid] : null;
    const v = { ...vars, p: p?.name, n: t.n, said: t.said };
    const playerTopic = ['error', 'red', 'scorer', 'young', 'rumour', 'lie'].includes(t.topic);
    const answers = Object.fromEntries(STYLES.map((s) => [s, fill(rng.pick(ANSWERS[s][playerTopic ? 'player' : mood]), v)]));
    return { topic: t.topic, pid: t.pid || null, text: `${rng.pick(OPENERS[j.type])} ${fill(rng.pick(POST_Q[t.topic]), v)}`, answers, done: null, effects: null };
  });
  state.life.interview = { kind: 'post', journalist: j, opp: d.opp, mood, qs, day: state.day, season: state.season };
  pushDecision(state, { kind: 'interview', icon: '🎤', title: `Interview d'après-match · ${j.outlet}`, text: `${j.name} (${BAL.press.journalists[j.type].label}) : ${qs.length} question(s).`,
    choices: [{ key: 'open', label: 'Répondre' }, { key: 'skip', label: 'Ne pas répondre' }], days: 1, prio: 1 });
}

/** Multiplicateur de fatigue médiatique. */
function fatigueMult(state, style) {
  const last = (state.coach.statements || []).filter((s) => s.style).slice(-BAL.press.fatigueWindow);
  return Math.pow(BAL.press.fatigue, last.filter((s) => s.style === style).length);
}

/** Effets d'une réponse (sans les appliquer). */
function computeEffects(state, iv, q, style, rng) {
  const P = BAL.press;
  const j = P.journalists[iv.journalist.type];
  const e = { ...P.styles[style] };
  const ctx = P.context[iv.mood === 'loss' ? 'loss' : iv.mood === 'win' ? 'win' : null]?.[style] || {};
  for (const [k, v] of Object.entries(ctx)) e[k] = (e[k] || 0) + v;
  if (!q.pid) e.target = 0;
  if (q.topic === 'lie' || q.topic === 'callback') { e.media -= 1; e.board -= 0.5; }
  const mult = j.mag * fatigueMult(state, style);
  for (const k of Object.keys(e)) e[k] = Math.round(e[k] * (k === 'rival' ? j.mag : mult) * 10) / 10;
  let backfire = false;
  if ((style === 'fighter' || style === 'evasive') && rng.chance(P.backfire * j.risk)) {
    backfire = true;
    e.team = -Math.abs(e.team) - 1; e.board = -Math.abs(e.board) - 1; e.media = -Math.abs(e.media) - 1.5;
  }
  return { e, backfire };
}

function applyEffects(state, e, pid, oppId) {
  const b = state.board;
  teamShift(state, e.team || 0);
  if (pid && state.players[pid]) moodShift(state.players[pid], e.target || 0);
  b.parts.results = clamp(b.parts.results + (e.board || 0), 0, 100);
  b.fans = clamp((b.fans ?? 60) + (e.fans || 0), 0, 100);
  state.coach.media = clamp((state.coach.media ?? 50) + (e.media || 0), 0, 100);
  if (oppId && e.rival) relAdd(state, state.userClubId, oppId, -e.rival);
  if (e.fans) { const uc = userClub(state); uc.atmosphere = clamp((uc.atmosphere ?? 60) + e.fans * 0.4, 0, 100); }
}

/** Réponse à une question de l'interview en cours (style ou 'skip'). */
export function answerInterview(state, qi, style) {
  const iv = state.life.interview;
  const q = iv?.qs[qi];
  if (!q || q.done) return null;
  const rng = qRng(state, `${qi}-${style}`);
  if (style === 'skip') {
    q.done = 'skip'; q.effects = { media: BAL.press.noAnswerMedia };
    state.coach.media = clamp((state.coach.media ?? 50) + BAL.press.noAnswerMedia, 0, 100);
    return { effects: q.effects, text: 'Vous quittez la salle sans répondre.' };
  }
  const { e, backfire } = computeEffects(state, iv, q, style, rng);
  applyEffects(state, e, q.pid, iv.opp);
  q.done = style; q.effects = e;
  const said = q.answers[style];
  const tags = style === 'protect' && q.pid ? { trust: q.pid } : {};
  addStatement(state, { kind: iv.kind, style, topic: q.topic, pid: q.pid, opp: iv.opp, text: said, ...tags, checks: 0, resolved: false });
  let text = backfire ? 'Mauvaise pioche : la phrase est sortie de son contexte et se retourne contre vous.' : `Réponse « ${STYLE_LABELS[style]} » enregistrée.`;
  const P = BAL.press;
  const viralP = P.viralBase * P.journalists[iv.journalist.type].viral * (style === 'fighter' ? 1 : style === 'protect' ? 0.35 : 0);
  if (viralP && rng.chance(viralP)) text += ' ' + makeViral(state, said, e, iv.opp, rng);
  return { effects: e, text, backfire };
}

/** Un clip viral : effets rejoués pendant 2-3 semaines, réaction possible d'un rival. */
function makeViral(state, said, e, oppId, rng) {
  const P = BAL.press;
  const weeks = rng.int(P.viralWeeks[0], P.viralWeeks[1]);
  state.life.virals.push({ said, weeks, e: { team: e.team, fans: e.fans, media: e.media }, opp: oppId });
  state.life.viralCount = (state.life.viralCount || 0) + 1;
  const uc = userClub(state);
  uc.image = clamp((uc.image ?? 50) + (e.fans > 0 ? 2 : -2), 0, 100);
  pushMessage(state, { prio: 2, icon: '📱', title: 'Votre phrase devient virale', text: fill(rng.pick(VIRAL), { said }) });
  const opp = oppId ? clubById(state, oppId) : null;
  if (opp && rng.chance(P.rivalReply)) {
    relAdd(state, uc.id, opp.id, BAL.relations.viral);
    pushMessage(state, { prio: 2, icon: '🗯', title: `${opp.short} répond`, text: fill(rng.pick(RIVAL_REPLY), { coach: coachNameOf(state, opp), opp: opp.name }) });
    return `${opp.short} a déjà répondu.`;
  }
  return 'Le clip tourne en boucle.';
}

/** Le buzz d'un clip viral se prolonge quelques semaines. */
export function viralsDaily(state) {
  const P = BAL.press;
  for (const v of state.life.virals) {
    const k = P.viralDaily;
    state.board.fans = clamp((state.board.fans ?? 60) + (v.e.fans || 0) * k, 0, 100);
    state.coach.media = clamp((state.coach.media ?? 50) + (v.e.media || 0) * k, 0, 100);
    teamShift(state, (v.e.team || 0) * k * 0.5);
    v.weeks--;
  }
  state.life.virals = state.life.virals.filter((v) => v.weeks > 0);
}

registerDecision('interview', {
  resolve(state, data, key) {
    if (key === 'skip') {
      const iv = state.life.interview;
      for (let i = 0; i < (iv?.qs.length || 0); i++) answerInterview(state, i, 'skip');
      return { msg: 'Pas d\'interview ce soir. Les médias s\'en souviendront.', effects: { media: BAL.press.noAnswerMedia } };
    }
    return { msg: '', open: { type: 'interview' } };
  },
  expire(state) { state.coach.media = clamp((state.coach.media ?? 50) + BAL.press.ignoredMedia, 0, 100); return 'L\'attaché de presse a répondu à votre place.'; },
});

/* ---------------- Cohérence des déclarations ---------------- */

/** Après chaque match : « je fais confiance à X » tenu ou trahi ? */
export function checkConsistency(state, d) {
  const P = BAL.press;
  for (const s of state.coach.statements || []) {
    if (!s.trust || s.resolved || s.season !== state.season) continue;
    const p = state.players[s.trust];
    if (!p || p.clubId !== state.userClubId) { s.resolved = true; continue; }
    if (p.injury > 0 || p.suspended > 0) continue;
    if (!d.lineup.includes(p.id)) {
      s.resolved = true;
      moodShift(p, P.liePenalty.target);
      state.coach.media = clamp(state.coach.media + P.liePenalty.media, 0, 100);
      state.coach.dressing = clamp(state.coach.dressing + P.liePenalty.dressing, 0, 100);
      state.life.callbacks.push({ type: 'lie', pid: p.id });
      pushMessage(state, { prio: 2, icon: '🧐', title: 'La presse a la mémoire longue', text: `Vous aviez défendu ${p.name} publiquement… il n'était pas titulaire.` });
    } else if (++s.checks >= P.trustWindow) {
      s.resolved = true;
      moodShift(p, P.keptBonus.target);
      state.coach.media = clamp(state.coach.media + P.keptBonus.media, 0, 100);
      state.coach.dressing = clamp(state.coach.dressing + P.keptBonus.dressing, 0, 100);
    }
  }
}

/* ---------------- Conférences d'avant-match ---------------- */

/** Est-ce un gros match ? Retourne la raison ou null. */
export function bigMatchReason(state, f, entry) {
  const uc = userClub(state);
  const oppId = f.h === uc.id ? f.a : f.h;
  const opp = clubById(state, oppId);
  if (!opp) return null;
  if (isDerby(state, uc.id, oppId)) return 'derby';
  if (f.comp === 'cup' || f.ko) return 'cup';
  if (relGet(state, uc.id, oppId) <= BAL.relations.hostile) return 'derby';
  if (f.comp === 'league' && entry.round >= 8) {
    const T = state.tables[uc.div];
    const sorted = Object.keys(T).sort((a, b) => T[b].pts - T[a].pts || (T[b].gf - T[b].ga) - (T[a].gf - T[a].ga));
    const pu = sorted.indexOf(String(uc.id)) + 1, po = sorted.indexOf(String(oppId)) + 1;
    if (pu <= 4 && po <= 4) return 'top';
    if (entry.round >= 32 && Math.abs(pu - (state.objectives?.league?.target ?? 10)) <= 2) return 'decisive';
  }
  return null;
}

const REASON_LABEL = { derby: 'Derby', cup: 'Match à élimination', top: 'Choc au sommet', decisive: 'Match décisif' };

/** Crée la conférence d'avant-match (veille d'un gros match). */
export function createConference(state, f, entry, rng) {
  const reason = bigMatchReason(state, f, entry);
  if (!reason) return false;
  const uc = userClub(state);
  const opp = clubById(state, f.h === uc.id ? f.a : f.h);
  const mine = clubPlayers(state, uc).filter((p) => !p.onLoanFrom).sort((a, b) => overall(b) - overall(a));
  const star = mine[0];
  const oppStar = clubPlayers(state, opp).sort((a, b) => overall(b) - overall(a))[0];
  const pool = ['compare', 'rival', 'pressure'];
  if (star && (star.contract <= 2 || (state.life.rumours || []).some((r) => r.pid === star.id))) pool.push('starFuture', 'starFuture');
  const topics = rng.shuffle(pool).filter((t, i, a) => a.indexOf(t) === i).slice(0, 2);
  const j = rng.pick(JOURNALISTS);
  const v = { opp: opp.name, coach: coachNameOf(state, opp), p: star?.name, star: oppStar?.name };
  const qs = topics.map((t) => ({ topic: t, pid: ['compare', 'starFuture'].includes(t) ? star?.id : null,
    text: `${rng.pick(OPENERS[j.type])} ${fill(rng.pick(PRE_Q[t]), v)}`,
    answers: Object.fromEntries(STYLES.map((s) => [s, fill(rng.pick(ANSWERS[s].pre), v)])), done: null, effects: null }));
  state.life.interview = { kind: 'pre', journalist: j, opp: opp.id, mood: 'pre', qs, day: state.day, season: state.season, reason };
  state.life.matchMods = { day: state.day, season: state.season, me: 0, opp: 0 };
  pushDecision(state, { kind: 'interview', icon: '🎙', title: `Conférence d'avant-match · ${REASON_LABEL[reason]}`, text: `${opp.name} : ${j.name} (${j.outlet}) et la presse vous attendent.`,
    choices: [{ key: 'open', label: 'Y aller' }, { key: 'skip', label: 'Envoyer l\'adjoint' }], days: 1, prio: 1 });
  return true;
}

/** Réponse en conférence d'avant-match : motivation des deux équipes, pression. */
export function answerConference(state, qi, style) {
  const iv = state.life.interview;
  const q = iv?.qs[qi];
  if (!q || q.done) return null;
  const P = BAL.press;
  const rng = qRng(state, `pre-${qi}-${style}`);
  const mm = state.life.matchMods;
  if (style === 'skip') { q.done = 'skip'; state.coach.media = clamp(state.coach.media + P.noAnswerMedia, 0, 100); return { effects: { media: P.noAnswerMedia }, text: 'Votre adjoint s\'en charge, sans éclat.' }; }
  const j = P.journalists[iv.journalist.type];
  const e = { pressure: 0, opp: 0, media: 0, target: 0, rival: 0, fans: 0 };
  if (style === 'fighter') { e.opp = P.preMatchOpp * 0.75; e.pressure = state.coach.dressing >= 45 ? 2 : -2; e.fans = 2; e.rival = 6; e.media = -0.5; }
  if (style === 'humble') { e.opp = -1; e.pressure = 1; e.media = 1; e.rival = -2; }
  if (style === 'protect') { e.pressure = 1.5; e.target = 4; e.media = -0.5; }
  if (style === 'evasive') { e.media = -1.5; }
  if (q.topic === 'compare' && style === 'humble') e.target = -6;          // « {star} est meilleur » : votre joueur vexé
  if (q.topic === 'compare' && style === 'fighter') e.opp += 1.5;          // la vedette adverse piquée au vif
  if (q.topic === 'starFuture' && style === 'evasive') e.target = -4;      // la star doute de vous
  if (q.topic === 'pressure' && style === 'fighter') e.pressure -= 1.5;     // promettre la victoire met la pression
  for (const k of Object.keys(e)) if (k !== 'rival') e[k] = Math.round(e[k] * j.mag * fatigueMult(state, style) * 10) / 10;
  mm.me = clamp(mm.me + e.pressure, -P.talkClamp, P.talkClamp);
  mm.opp = clamp(mm.opp + e.opp, -P.talkClamp, P.talkClamp);
  if (q.pid && state.players[q.pid]) moodShift(state.players[q.pid], e.target);
  state.coach.media = clamp(state.coach.media + e.media, 0, 100);
  state.board.fans = clamp(state.board.fans + e.fans, 0, 100);
  if (e.rival) relAdd(state, state.userClubId, iv.opp, -e.rival);
  q.done = style; q.effects = e;
  addStatement(state, { kind: 'pre', style, topic: q.topic, pid: q.pid, opp: iv.opp, text: q.answers[style] });
  let text = e.opp >= 3 ? 'Vos mots seront affichés dans le vestiaire adverse : match de revanche en vue.' : 'Message passé.';
  if (style === 'fighter' && rng.chance(P.viralBase * j.viral)) text += ' ' + makeViral(state, q.answers[style], { team: e.pressure, fans: e.fans, media: e.media }, iv.opp, rng);
  return { effects: e, text };
}

/** Bonus de motivation du jour (lu par la configuration du match). */
export function matchMods(state) {
  const mm = state.life?.matchMods;
  return mm && mm.season === state.season && mm.day >= state.day - 1 ? mm : null;
}

export { influence, core };
