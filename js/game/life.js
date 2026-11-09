/**
 * VIE DU CLUB — chef d'orchestre des systèmes (presse, vestiaire, demandes,
 * propriétaires, relations, finances, supporters, sponsors, blessures, agents,
 * offres d'emploi). La saison n'appelle que ces quelques points d'entrée.
 */
import { clamp } from '../core/rng.js';
import { BAL } from '../data/balance.js';
import { userClub, clubById, pushMessage } from './state.js';
import { logFinance } from './transfers.js';
import { expireDecisions, pushDecision, registerDecision, openDecisions } from './inbox.js';
import { dressingDaily, dressingEvents, requestsDaily, checkPersonalPromises, joined } from './people.js';
import { createInterview, checkConsistency, viralsDaily, createConference } from './press.js';
import { initRelations, relationsDaily, relationsAfterMatch, hostileNoise } from './relations.js';
import { ensureOwners, crisisDaily, takeovers, ownerSeasonStart, speculatorPush } from './owners.js';
import { atmosphereAfterMatch, standsEvents, ensureSponsors, sponsorsAfterMatch, sponsorsCheck, sponsorsEndSeason } from './fans.js';
import { injuriesDaily, relapseCheck, injuriesEndSeason } from './injuries.js';
import { rumoursDaily, rumourOffers, goalBonuses } from './agents.js';
import { jobCandidates } from './career.js';
import { changeClub, tablePosition, today } from './season.js';
import { bigMatchReason } from './press.js';

export const LIFE_VERSION = 1;

/** Initialise / migre les données des systèmes (idempotent). */
export function ensureLife(state) {
  const L = state.life = state.life || {};
  L.streak ??= []; L.callbacks ??= []; L.virals ??= []; L.rumours ??= [];
  L.v ??= LIFE_VERSION;
  const c = state.coach;
  if (c) { c.media ??= 50; c.dressing ??= 60; c.statements ??= []; }
  if (!state.ownersReady) { ensureOwners(state); initRelations(state); state.ownersReady = true; }
  if (state.userClubId && state.board) ensureSponsors(state);
  return L;
}

/** Fin de chaque journée (avant la mise à jour du board). */
export function lifeDaily(state, rng, t) {
  ensureLife(state);
  const league = t.entry.type === 'league';
  dressingDaily(state);
  requestsDaily(state, rng);
  checkPersonalPromises(state);
  viralsDaily(state);
  relationsDaily(state, rng);
  hostileNoise(state, rng);
  crisisDaily(state, rng);
  rumoursDaily(state, rng);
  rumourOffers(state, rng);
  injuriesDaily(state);
  if (league && t.entry.round % 3 === 2) sponsorsCheck(state, rng);
  if (league && (t.entry.round === 0 || t.entry.round === 19)) speculatorPush(state);
  if (league && t.entry.round >= BAL.jobs.every && t.entry.round % BAL.jobs.every === 0) jobOffers(state, rng);
  const b = state.board;
  const P = BAL.press;
  state.coach.media += (50 - state.coach.media) * P.mediaRevert;
  b.fans = clamp(b.fans + (55 - b.fans) * P.fansRevert, 0, 100);
  if (state.coach.dressing < 30) b.parts.results = clamp(b.parts.results - 0.4, 0, 100);
  expireDecisions(state);
}

/** Après chaque rencontre (tous les clubs). */
export function lifeAfterFixture(state, f, sum) {
  if (f.comp === 'intl') return;
  relationsAfterMatch(state, f, sum);
  if (!f.neutral) atmosphereAfterMatch(state, clubById(state, f.h), sum.score[0], sum.score[1]);
}

/** Après un match de l'utilisateur (d = digestMatch). */
export function lifeAfterUserMatch(state, d, rng, f, entry) {
  const L = ensureLife(state);
  const res = d.gf > d.ga ? 'W' : d.gf < d.ga ? 'L' : 'D';
  L.streak.push(res); if (L.streak.length > 10) L.streak.shift();
  checkConsistency(state, d);
  dressingEvents(state, rng, res === 'L');
  relapseCheck(state, d, rng);
  const uc = userClub(state);
  const big = !!bigMatchReason(state, f, entry);
  const bonus = sponsorsAfterMatch(state, d, big);
  if (bonus) { uc.budget += bonus; logFinance(state, bonus, 'Primes de sponsors'); }
  const gb = goalBonuses(state, d);
  if (gb) { uc.budget -= gb; logFinance(state, -gb, 'Primes de but'); }
  if (f.h === uc.id && !f.neutral) standsEvents(state, rng, d.gf, d.ga);
  createInterview(state, d, rng);
}

/** Après le passage au jour suivant : conférence la veille d'un gros match. */
export function lifeNextDay(state, rng) {
  if (state.seasonOver || state.sacked) return;
  const t = today(state);
  if (t?.userFixture) createConference(state, t.userFixture, t.entry, rng);
}

/** Fin de saison (après la création de la nouvelle saison). */
export function lifeEndSeason(state, rng, goodSeason) {
  ensureLife(state);
  injuriesEndSeason(state);
  const bought = takeovers(state, rng);
  sponsorsEndSeason(state, goodSeason);
  state.life.streak = [];
  state.life.callbacks = [];
  for (const c of state.clubs) c.penalized = null;
  return bought;
}

/** Début de saison du club de l'utilisateur (enveloppes selon le propriétaire). */
export function lifeSeasonStart(state) {
  ensureLife(state);
  ownerSeasonStart(state);
}

/* ---------------- 15. Offres d'emploi pour l'entraîneur ---------------- */

function jobOffers(state, rng) {
  if (openDecisions(state, 'job').length || state.sacked) return;
  const uc = userClub(state);
  const pos = tablePosition(state, uc.id);
  const good = pos <= (state.objectives?.league?.target ?? 10);
  const cands = jobCandidates(state);
  if (!cands.length || !good) return;
  if (!rng.chance(clamp((state.coach.rep - 35) / 90 + (state.coach.media - 50) / 300, 0.03, 0.6))) return;
  const c = rng.pick(cands);
  pushDecision(state, { kind: 'job', icon: '💼', title: `${c.name} veut vous recruter`, text: `Réputation du club : ${c.rep} (vous : ${uc.rep}). Partir en cours de saison vous coûtera en réputation et auprès des supporters.`,
    data: { clubId: c.id }, choices: [{ key: 'accept', label: 'Accepter' }, { key: 'refuse', label: 'Refuser' }], days: 2 });
}

registerDecision('job', {
  resolve(state, { clubId }, key) {
    const J = BAL.jobs;
    const c = clubById(state, clubId);
    if (key === 'accept') {
      const mid = !state.seasonOver && !state.preseason?.active;
      if (mid) state.coach.rep = clamp(state.coach.rep + J.leaveRep, 1, 100);
      changeClub(state, clubId);
      state.board.fans = mid ? J.leaveFans : 55;
      state.coach.dressing = 55;
      return { msg: `Bienvenue à ${c.name} !${mid ? ' Votre départ en pleine saison fait jaser.' : ''}`, open: { type: 'home' } };
    }
    const b = state.board;
    b.parts.results = clamp(b.parts.results + J.refuseBoard, 0, 100);
    b.fans = clamp(b.fans + J.refuseFans, 0, 100);
    state.coach.dressing = clamp(state.coach.dressing + J.refuseDressing, 0, 100);
    pushMessage(state, { prio: 3, icon: '❤', title: 'Fidélité saluée', text: `Votre refus de ${c.name} a fuité : supporters et dirigeants apprécient.` });
    return { msg: 'Offre déclinée. Le club apprécie votre fidélité.', effects: { board: J.refuseBoard, fans: J.refuseFans } };
  },
});

export { joined };
