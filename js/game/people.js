/**
 * HOMMES : personnalités, influence, vestiaire (leaders, contagion, événements)
 * et demandes privées des joueurs (temps de jeu, prolongation, départ).
 */
import { clamp, hashSeed } from '../core/rng.js';
import { BAL } from '../data/balance.js';
import { userClub, clubPlayers, pushMessage } from './state.js';
import { overall } from '../engine/ratings.js';
import { pushDecision, registerDecision, openDecisions } from './inbox.js';
import { PROMISE_ROLES } from './transfers.js';
import { captains, leadership } from './captain.js';

/* ---------------- Profils ---------------- */

const PERS_KEYS = Object.keys(BAL.personalities);
const hashPick = (seed, entries) => {
  let x = (hashSeed(seed) % 10000) / 10000;
  for (const [k, w] of entries) { x -= w; if (x < 0) return k; }
  return entries[entries.length - 1][0];
};

/** Personnalité (stable, déterministe). */
export const pers = (p) => (p.pers ??= hashPick(`pers-${p.id}`, PERS_KEYS.map((k) => [k, BAL.personalities[k].weight])));
export const persInfo = (p) => BAL.personalities[pers(p)];

/** Saison d'arrivée (ancienneté). */
export const joined = (state, p) => (p.joined ??= state.season - (hashSeed(`j-${p.id}`) % Math.max(1, Math.min(8, p.age - 17))));

/** Influence dans le vestiaire (0-100). */
export function influence(state, p) {
  const tenure = state.season - joined(state, p);
  const v = (p.age - 18) * 2 + Math.min(25, (p.caps || 0) * 0.5) + tenure * 4 + (overall(p) - 60) * 0.7 + persInfo(p).infl;
  return clamp(Math.round(v), 0, 100);
}

/** Attente de temps de jeu (part des minutes) selon le rang dans l'effectif. */
export function expectation(state, p, squad = null) {
  const sq = (squad || clubPlayers(state, userClub(state))).map(overall).sort((a, b) => b - a);
  const rank = sq.indexOf(overall(p));
  let e = rank < 11 ? 0.7 : rank < 16 ? 0.35 : 0.12;
  if (pers(p) === 'ambitious' || pers(p) === 'mercenary') e += 0.08;
  if (p.age <= 20) e = Math.min(e, 0.25);
  return e;
}

/** Variation de moral pondérée par la sensibilité. */
export function moodShift(p, delta) {
  p.morale = clamp(p.morale + delta * (delta < 0 ? persInfo(p).sens : 1), BAL.morale.min, BAL.morale.max);
}

/** Moral de tout un groupe. */
export function teamShift(state, delta, club = userClub(state)) {
  for (const p of clubPlayers(state, club)) moodShift(p, delta);
}

/* ---------------- Vestiaire ---------------- */

/** Le noyau : les 3-4 joueurs les plus influents. */
export function core(state, club = userClub(state)) {
  return clubPlayers(state, club).filter((p) => !p.onLoanFrom)
    .map((p) => ({ p, infl: influence(state, p) })).sort((a, b) => b.infl - a.infl).slice(0, BAL.dressing.coreSize);
}

function affinity(state, a, b) {
  const A = BAL.dressing.affinity;
  let v = A.base;
  if (a.nat && a.nat === b.nat) v += A.nat;
  if (Math.abs(a.age - b.age) <= 3) v += A.age;
  if (Math.abs(joined(state, a) - joined(state, b)) <= 1) v += A.tenure;
  return v / (A.base + A.nat + A.age + A.tenure);
}

/** Confiance du vestiaire (moyenne pondérée par l'influence). */
export function dressingTarget(state) {
  const sq = clubPlayers(state, userClub(state));
  let w = 0, s = 0;
  for (const p of sq) { const i = 10 + influence(state, p); w += i; s += i * p.morale; }
  return w ? s / w : 50;
}

/**
 * Une journée de vestiaire : retour progressif à l'équilibre, contagion de l'humeur
 * des leaders mécontents, apaisement par les leaders heureux.
 */
/** Retour progressif du moral à l'équilibre (tous les clubs : évite les dérives du monde). */
export function worldMoraleRevert(state) {
  const B = BAL.morale;
  for (const c of state.clubs) for (const id of c.playerIds) {
    const p = state.players[id];
    if (p) p.morale = Math.round(clamp(p.morale + (B.base - p.morale) * B.revert, B.min, B.max) * 10) / 10;
  }
}

export function dressingDaily(state, withWorld = true) {
  const B = BAL.morale, D = BAL.dressing;
  if (withWorld) worldMoraleRevert(state);
  const uc = userClub(state);
  const sq = clubPlayers(state, uc);
  for (const { p: L, infl } of core(state, uc)) {
    const bad = L.morale < D.unhappy, good = L.morale > D.happy;
    if (!bad && !good) continue;
    for (const p of sq) {
      if (p === L) continue;
      if (good && p.morale >= 50) continue;
      const k = (bad ? D.spread : D.calm) * (infl / 100) * affinity(state, L, p);
      p.morale = clamp(p.morale + (L.morale - p.morale) * k, B.min, B.max);
    }
  }
  const c = state.coach;
  c.dressing = clamp((c.dressing ?? 60) + (dressingTarget(state) - (c.dressing ?? 60)) * D.confSmoothing, 0, 100);
}

/** Événements de vestiaire après un match de l'utilisateur. */
export function dressingEvents(state, rng, lost) {
  const L = state.life;
  const D = BAL.dressing;
  const streak = L.streak.slice(-D.crisisLossStreak);
  if (streak.length === D.crisisLossStreak && streak.every((r) => r === 'D') && !openDecisions(state, 'crisis').length && state.day - (L.lastCrisis ?? -99) > 6) {
    L.lastCrisis = state.day;
    pushDecision(state, { kind: 'crisis', icon: '🚨', title: 'Réunion de crise', text: `${D.crisisLossStreak} défaites d'affilée. Le vestiaire attend une réaction.`,
      choices: [{ key: 'rally', label: 'Discours mobilisateur' }, { key: 'pressure', label: 'Mettre la pression' }, { key: 'leaders', label: 'Laisser parler les cadres' }], days: 2 });
  }
  const capId = captains(state, userClub(state)).captain;
  const cap = state.players[capId];
  if (lost && cap && rng.chance(D.captainChance * 1.6)) {
    const lead = leadership(state, cap);
    if (cap.morale >= 58 && (pers(cap) === 'leader' || lead >= 55)) {
      teamShift(state, 2.5);
      pushMessage(state, { prio: 3, icon: '©', title: `${cap.name} prend la parole`, text: 'Le capitaine a remobilisé le groupe après la défaite.' });
    }
  }
  // Clash entre deux joueurs à fort caractère.
  if (rng.chance(D.clashChance) && !openDecisions(state, 'clash').length) {
    const hot = clubPlayers(state, userClub(state)).filter((p) => ['rebel', 'mercenary', 'ambitious'].includes(pers(p)) && p.morale < 50);
    if (hot.length >= 2) {
      const [a, b] = rng.shuffle(hot.slice()).slice(0, 2);
      pushDecision(state, { kind: 'clash', icon: '🥊', title: `Clash : ${a.name} et ${b.name}`, text: 'Altercation à l\'entraînement. Tout le monde vous regarde.',
        data: { a: a.id, b: b.id },
        choices: [{ key: 'a', label: `Donner raison à ${a.name}` }, { key: 'b', label: `Donner raison à ${b.name}` }, { key: 'fine', label: 'Amende pour les deux' }], days: 2 });
    }
  }
}

registerDecision('crisis', {
  resolve(state, data, key) {
    const c = state.coach;
    const cr = core(state);
    const coreMood = cr.reduce((a, x) => a + x.p.morale, 0) / Math.max(1, cr.length);
    if (key === 'rally') { const ok = c.dressing >= 40; teamShift(state, ok ? 5 : -3); c.dressing += ok ? 3 : -3; return { msg: ok ? 'Le discours a porté.' : 'Le message n\'est pas passé : le vestiaire doute.', effects: { team: ok ? 5 : -3 } }; }
    if (key === 'pressure') { for (const p of clubPlayers(state, userClub(state))) { p.form = clamp(p.form + 4, 5, 95); moodShift(p, -2); } return { msg: 'Les joueurs ont compris le message. Ambiance tendue.', effects: { team: -2 } }; }
    const ok = coreMood >= 50;
    teamShift(state, ok ? 6 : -4); c.dressing += ok ? 4 : -2;
    return { msg: ok ? 'Les cadres ont pris leurs responsabilités.' : 'Les cadres eux-mêmes sont à bout. Réunion houleuse.', effects: { team: ok ? 6 : -4 } };
  },
  expire(state) { teamShift(state, -2); return 'Pas de réunion : le malaise s\'installe.'; },
});

registerDecision('clash', {
  resolve(state, { a, b }, key) {
    const A = state.players[a], B = state.players[b];
    if (!A || !B) return { msg: 'L\'affaire est retombée.' };
    if (key === 'fine') { moodShift(A, -4); moodShift(B, -4); state.coach.dressing += 2; return { msg: 'Autorité respectée. Les deux joueurs font la tête.', effects: { dressing: 2 } }; }
    const [win, lose] = key === 'a' ? [A, B] : [B, A];
    moodShift(win, 6); moodShift(lose, -12);
    state.coach.dressing -= influence(state, lose) > 55 ? 4 : 1;
    return { msg: `${lose.name} se sent désavoué.`, effects: { target: -12 } };
  },
  expire(state, { a, b }) { for (const id of [a, b]) if (state.players[id]) moodShift(state.players[id], -3); return 'Laissé sans suite.'; },
});

/* ---------------- 4. Demandes des joueurs ---------------- */

const REQ_LABEL = { playtime: 'plus de temps de jeu', extension: 'une prolongation', departure: 'un départ' };

/** Part de minutes jouées cette saison. */
export function minutesShare(state, p) {
  const m = state.seasonStats?.m || 0;
  return m ? (p.stats.minutes || 0) / (m * 90) : 1;
}

/** Une journée : certains joueurs envoient une demande privée. */
export function requestsDaily(state, rng) {
  const R = BAL.requests;
  if (openDecisions(state, 'request').length >= R.maxOpen) return;
  const uc = userClub(state);
  const sq = clubPlayers(state, uc).filter((p) => !p.onLoanFrom && !p.injury);
  for (const p of rng.shuffle(sq.slice())) {
    if (p.reqCooldown && state.day < p.reqCooldown && p.reqSeason === state.season) continue;
    const pi = persInfo(p);
    const chance = R.baseChance * pi.req * (p.morale < 45 ? 2.2 : p.morale > 70 ? 0.4 : 1);
    if (!rng.chance(chance)) continue;
    let type = null;
    const exp = expectation(state, p, sq);
    if ((state.seasonStats?.m || 0) >= R.minMatches && minutesShare(state, p) < exp * 0.7) type = 'playtime';
    else if (p.contract <= 1 && overall(p) >= 62) type = 'extension';
    else if (p.morale < 32 || (pers(p) === 'mercenary' && p.morale < 50) || (pers(p) === 'ambitious' && uc.rep < overall(p) - 8)) type = 'departure';
    if (!type) continue;
    p.reqCooldown = state.day + 8; p.reqSeason = state.season;
    const broken = (p.promises || []).filter((x) => x.kept === false).length;
    const choices = [
      type === 'extension' ? { key: 'extend', label: 'Ouvrir les discussions' } : { key: 'promise', label: type === 'departure' ? 'Le convaincre de rester' : 'Promettre du temps de jeu' },
      { key: 'refuse', label: 'Refuser' },
      { key: 'list', label: 'Liste des transferts' },
    ];
    pushDecision(state, { kind: 'request', icon: type === 'departure' ? '🧳' : type === 'extension' ? '✎' : '⏱', title: `${p.name} demande ${REQ_LABEL[type]}`,
      text: `${type === 'playtime' ? `${Math.round(minutesShare(state, p) * 100)} % du temps de jeu, il en attend ${Math.round(exp * 100)} %.` : type === 'extension' ? `Contrat : ${p.contract} an(s) restant(s).` : `Moral ${Math.round(p.morale)}.`}${broken ? ` Il n'a pas oublié vos ${broken} promesse(s) non tenue(s).` : ''} Sans réponse, il parlera à la presse.`,
      data: { pid: p.id, type }, choices, days: rng.int(R.deadline[0], R.deadline[1]) });
    if (openDecisions(state, 'request').length >= R.maxOpen) return;
  }
}

/** Le joueur s'exprime publiquement. */
export function goPublic(state, p, why) {
  const R = BAL.requests;
  state.board.parts.results = clamp(state.board.parts.results + R.publicBoard, 0, 100);
  state.coach.dressing = clamp((state.coach.dressing ?? 60) + R.publicDressing * (influence(state, p) / 60), 0, 100);
  state.coach.media = clamp((state.coach.media ?? 50) + R.publicMedia, 0, 100);
  moodShift(p, -4);
  addStatement(state, { kind: 'public', by: p.id, topic: why, text: `${p.name} se plaint publiquement (${why})` });
  pushMessage(state, { prio: 1, icon: '📰', title: `${p.name} vide son sac dans la presse`, text: `« ${publicLine(p, why)} » Le board et le vestiaire n'apprécient pas.`, action: { type: 'player', pid: p.id } });
}

const PUBLIC_LINES = {
  playtime: ['Je ne suis pas venu ici pour regarder les matchs.', 'Je veux jouer, c\'est tout. On verra cet été.', 'Personne ne m\'explique pourquoi je ne joue pas.'],
  extension: ['Le club ne me montre aucun respect.', 'J\'attends toujours une vraie proposition.', 'Mon avenir ? Demandez à la direction.'],
  departure: ['J\'ai besoin d\'un nouveau défi.', 'Je veux partir, tout le monde le sait.', 'Mon cycle ici est terminé.'],
  promise: ['On m\'avait promis des choses. Rien n\'a été tenu.', 'Les promesses, je n\'y crois plus.'],
};
const publicLine = (p, why) => { const L = PUBLIC_LINES[why] || PUBLIC_LINES.departure; return L[hashSeed(`${p.id}-${why}-${p.morale | 0}`) % L.length]; };

/** Promesse mémorisée (vérifiée plus tard). */
function promise(state, p, kind) {
  p.promises = (p.promises || []).slice(-4);
  p.promises.push({ kind, season: state.season, day: state.day, due: state.day + BAL.requests.promiseCheckDays, mins: p.stats.minutes || 0, m: state.seasonStats?.m || 0 });
  const order = ['youth', 'backup', 'rotation', 'key', 'star'];
  const cur = p.promise?.role || 'rotation';
  p.promise = { role: order[Math.min(order.length - 1, order.indexOf(cur) + 1)], season: state.season, strikes: 0 };
}

registerDecision('request', {
  resolve(state, { pid, type }, key) {
    const p = state.players[pid];
    const R = BAL.requests;
    if (!p || p.clubId !== state.userClubId) return { msg: 'Le joueur n\'est plus au club.' };
    const broken = (p.promises || []).filter((x) => x.kept === false).length;
    if (key === 'promise') {
      if (broken >= 2) { goPublic(state, p, 'promise'); return { msg: `${p.name} ne croit plus à vos promesses.`, effects: { target: -4, board: R.publicBoard } }; }
      promise(state, p, type === 'departure' ? 'stay' : 'playtime');
      moodShift(p, R.promiseMorale);
      if (type === 'departure') { p.requested = false; p.listed = false; }
      return { msg: `Promesse faite à ${p.name}. Il attend des actes (statut « ${PROMISE_ROLES[p.promise.role].label} »).`, effects: { target: R.promiseMorale } };
    }
    if (key === 'extend') { moodShift(p, 3); return { msg: `${p.name} attend votre proposition.`, open: { type: 'renew', pid } }; }
    if (key === 'list') {
      p.listed = true;
      moodShift(p, type === 'departure' ? 4 : -10);
      if (type !== 'departure') state.coach.dressing -= 1;
      return { msg: type === 'departure' ? `${p.name} est placé sur la liste des transferts.` : `${p.name} le prend comme une humiliation.`, effects: { target: type === 'departure' ? 4 : -10 } };
    }
    moodShift(p, R.refuseMorale);
    if ((hashSeed(`leak-${pid}-${state.season}-${state.day}`) % 100) / 100 < persInfo(p).leak) goPublic(state, p, type);
    return { msg: `Refus signifié à ${p.name}.`, effects: { target: R.refuseMorale } };
  },
  expire(state, { pid, type }) {
    const p = state.players[pid];
    if (p && p.clubId === state.userClubId) goPublic(state, p, type);
    return 'Pas de réponse : il s\'est exprimé publiquement.';
  },
});

/** Vérification des promesses arrivées à échéance. */
export function checkPersonalPromises(state) {
  const R = BAL.requests;
  for (const p of clubPlayers(state, userClub(state))) {
    for (const pr of p.promises || []) {
      if (pr.kept != null || pr.season !== state.season || state.day < pr.due) continue;
      const m = (state.seasonStats?.m || 0) - pr.m;
      const share = m > 0 ? ((p.stats.minutes || 0) - pr.mins) / (m * 90) : 1;
      pr.kept = p.injury > 0 || share >= expectation(state, p) * 0.8;
      if (pr.kept) { moodShift(p, R.promiseKept); state.coach.dressing += 1; }
      else {
        moodShift(p, R.promiseBroken);
        state.coach.dressing -= influence(state, p) > 55 ? 4 : 1.5;
        pushMessage(state, { prio: 1, icon: '💢', title: `Promesse non tenue : ${p.name}`, text: `${Math.round(share * 100)} % du temps de jeu depuis votre promesse. Il ne l'oubliera pas.`, action: { type: 'player', pid: p.id } });
      }
    }
  }
}

/* ---------------- Déclarations de l'entraîneur ---------------- */

export function addStatement(state, s) {
  const c = state.coach;
  c.statements = c.statements || [];
  c.statements.push({ day: state.day, season: state.season, ...s });
  if (c.statements.length > BAL.press.statementsKept) c.statements.splice(0, c.statements.length - BAL.press.statementsKept);
}
