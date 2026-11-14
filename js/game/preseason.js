/**
 * PRÉPARATION ESTIVALE (6 semaines, comme dans la réalité)
 *  - reprise : tests physiques (condition et rythme de chaque joueur à la reprise ; les
 *    internationaux qui ont joué un grand tournoi rentrent plus tard, avec moins de vacances) ;
 *  - réunion avec le CA (objectifs, budget, identité) ;
 *  - stage : au centre du club, en altitude, au soleil, ou tournée commerciale en Asie /
 *    aux États-Unis (recette, supporters, mais voyages fatigants) ;
 *  - intensité du travail foncier : plus c'est dur, plus le rythme monte… et plus on se blesse ;
 *  - jusqu'à 6 amicaux (adversaires de niveaux variés, en France ou à l'étranger) : le temps de
 *    jeu donne du rythme de match aux joueurs.
 * Le rythme de match (p.sharp) pèse ensuite sur le rendement (jusqu'à -5 %) et se gagne en jouant.
 */
import { clamp, hashSeed } from '../core/rng.js';
import { DIVISIONS } from '../data/world.js';
import { userClub, clubById, gameRng, pushMessage } from './state.js';
import { matchdayRevenue } from './economy.js';
import { allPlayers } from '../engine/match.js';
import { IDENTITIES } from './board.js';
import { logFinance } from './transfers.js';
import { logInjury } from './injuries.js';
import { money } from './economy.js';

/** Stages de préparation. cost : multiplié par la réputation du club ; fit : rythme ; coh : automatismes. */
export const CAMPS = {
  home: { label: 'Au centre d\'entraînement', icon: '🏟️', desc: 'Gratuit, sans voyage. Travail classique.', cost: 0, fit: 4, coh: 2, inj: 1 },
  alps: { label: 'Stage en altitude (Alpes)', icon: '🏔️', desc: 'Foncier en altitude : gros gain physique, vestiaire soudé.', cost: 6000, fit: 10, coh: 5, inj: 1.1 },
  sun: { label: 'Stage au soleil (Algarve)', icon: '🌴', desc: 'Conditions idéales, ambiance détendue : excellent pour les automatismes.', cost: 9000, fit: 7, coh: 8, inj: 0.9 },
  tour: { label: 'Tournée en Asie / États-Unis', icon: '✈️', desc: 'Grosse recette et nouveaux supporters, deux amicaux de prestige… mais décalage horaire et fatigue.', cost: -1, fit: 1, coh: 3, inj: 1.15 },
};
export const INTENSITY = {
  light: { label: 'Légère', desc: 'Peu de risque, peu de rythme.', fit: 0, inj: 0.4 },
  normal: { label: 'Normale', desc: 'Équilibre entre rythme et fraîcheur.', fit: 6, inj: 1 },
  hard: { label: 'Intense', desc: 'Les joueurs souffrent : rythme élevé, blessures plus fréquentes.', fit: 12, inj: 2 },
};
const TOUR_PLACES = ['Tokyo', 'Singapour', 'Séoul', 'New York', 'Los Angeles', 'Chicago', 'Pékin', 'Hong Kong'];

const LADDERS = { 1: [[1, 'Être champion'], [4, 'Finir dans le top 4'], [10, 'Finir dans la 1re moitié'], [15, 'Finir dans le top 15'], [17, 'Assurer le maintien']],
  2: [[1, 'Être champion de D2'], [3, 'Monter en Division 1'], [8, 'Finir dans le top 8'], [15, 'Finir dans le top 15']] };

/** Ouvre la préparation (début de carrière et chaque été). */
export function startPreseason(state) {
  const rng = gameRng(state);
  const uc = userClub(state);
  const others = state.clubs.filter((c) => c.id !== uc.id);
  const pick = (list, n) => rng.shuffle(list.slice()).slice(0, n);
  const local = others.filter((c) => c.country === uc.country && c.div !== uc.div);
  const weaker = others.filter((c) => c.rep < uc.rep - 5);
  const foreign = others.filter((c) => c.country !== uc.country && Math.abs(c.rep - uc.rep) < 12);
  const big = others.filter((c) => c.rep > uc.rep + 3);
  const sugg = [...new Set([...pick(local, 2), ...pick(weaker, 2), ...pick(foreign, 3), ...pick(big, 3)])].slice(0, 10).map((c) => c.id);
  // Tests physiques de reprise : condition et rythme selon l'été de chacun.
  const tests = [];
  for (const id of uc.playerIds) {
    const p = state.players[id];
    if (!p) continue;
    const load = p.summerLoad || 0;
    const late = load >= 3;                       // grand tournoi jusqu'en juillet : vacances écourtées
    p.sharp = Math.round(clamp(30 + rng.range(0, 14) + (late ? 18 : 0) + (p.attrs?.phy ?? 60) * 0.08, 25, 70));
    p.fatigue = clamp(Math.round(late ? 18 + load * 3 : rng.range(0, 6)), 0, 60);
    if (late) p.lateBack = true; else delete p.lateBack;
    tests.push({ id, sharp: p.sharp, fat: p.fatigue, late });
  }
  state.preseason = { active: true, meeting: false, friendlies: [], suggestions: sugg, camp: null, intensity: 'normal', tests, week: 1 };
  const lates = tests.filter((t) => t.late).map((t) => state.players[t.id].name);
  pushMessage(state, { prio: 2, icon: '🩺', title: 'Reprise : tests physiques', text: `Le préparateur physique a testé le groupe : rythme moyen ${Math.round(tests.reduce((a, t) => a + t.sharp, 0) / Math.max(1, tests.length))}/100.${lates.length ? ` ${lates.slice(0, 5).join(', ')}${lates.length > 5 ? '…' : ''} rentre(nt) plus tard après leur tournoi international : ils manqueront le stage.` : ''} Choisissez un stage, l'intensité du travail et programmez des amicaux.` });
}

/** Coût (ou recette pour une tournée) d'un stage pour ce club. */
export function campMoney(state, key) {
  const uc = userClub(state);
  const c = CAMPS[key];
  if (key === 'tour') return Math.round((uc.rep >= 85 ? 9e6 : uc.rep >= 78 ? 4e6 : uc.rep >= 70 ? 1.2e6 : 3e5) / 50000) * 50000;
  return -Math.round((c.cost * Math.max(20, uc.rep) * (DIVISIONS[uc.div].level === 1 ? 1 : 0.5)) / 10000) * 10000;
}

/** Choix du stage (une fois). Une tournée ajoute deux amicaux de prestige à l'étranger. */
export function chooseCamp(state, key) {
  const ps = state.preseason;
  if (!CAMPS[key] || ps.camp) return { ok: false, msg: 'Stage déjà choisi.' };
  const uc = userClub(state);
  if (key === 'tour' && uc.rep < 62) return { ok: false, msg: 'Votre club n\'est pas assez connu pour une tournée à l\'étranger.' };
  ps.camp = key;
  if (key === 'tour') {
    const rng = gameRng(state);
    const stars = state.clubs.filter((c) => c.id !== uc.id && c.country !== uc.country && c.rep >= Math.min(84, uc.rep + 2)).sort((a, b) => b.rep - a.rep).slice(0, 10);
    ps.friendlies = ps.friendlies.slice(0, 4);
    for (const c of rng.shuffle(stars).slice(0, 2)) if (!ps.friendlies.some((f) => f.oppId === c.id)) ps.friendlies.push({ oppId: c.id, home: false, neutral: true, place: rng.pick(TOUR_PLACES), tour: true, s: null });
  }
  return { ok: true, msg: `${CAMPS[key].icon} ${CAMPS[key].label} : c'est noté.` };
}
export function setIntensity(state, k) { if (INTENSITY[k]) state.preseason.intensity = k; }

/** Échelle d'objectifs du championnat de l'utilisateur. */
function ladder(state) {
  const lvl = DIVISIONS[userClub(state).div].level;
  const D = DIVISIONS[userClub(state).div];
  const L = LADDERS[lvl].slice();
  if (lvl === 2) {
    // Vrais noms : « Être champion de Ligue 2 », « Monter en Ligue 1 ».
    L[0] = [1, `Être champion de ${D.name}`];
    L[1] = [D.up || 3, `Monter en ${DIVISIONS[D.upper]?.name || 'Division 1'}`];
  }
  if (!DIVISIONS[userClub(state).div].down && lvl === 1) L[L.length - 1] = [15, 'Finir dans le top 15'];
  return L;
}

/** Propositions de la réunion : objectif plus ambitieux / plus modeste. */
export function meetingOptions(state) {
  const o = state.objectives.league;
  const L = ladder(state);
  const i = Math.max(0, L.findIndex(([t]) => t >= o.target));
  return { current: o, up: L[i - 1] || null, down: L[i + 1] || null, identities: Object.keys(IDENTITIES) };
}

/**
 * Conclut la réunion. choice : 'accept' | 'up' | 'down' ; identity : clé d'identité (facultatif).
 * Viser plus haut = budget +25 % ; plus bas = budget -25 % et confiance en baisse.
 */
export function concludeMeeting(state, choice, identity) {
  const b = state.board;
  const opts = meetingOptions(state);
  let msg = 'Objectifs acceptés. Le CA compte sur vous.';
  if (choice === 'up' && opts.up) {
    state.objectives.league = { ...state.objectives.league, target: opts.up[0], label: opts.up[1] };
    b.transferBudget = Math.round(b.transferBudget * 1.25 / 50000) * 50000;
    b.parts.results = clamp(b.parts.results + 5, 0, 100);
    msg = `Pari ambitieux : « ${opts.up[1]} ». Budget transferts +25 %.`;
  } else if (choice === 'down' && opts.down) {
    state.objectives.league = { ...state.objectives.league, target: opts.down[0], label: opts.down[1] };
    b.transferBudget = Math.round(b.transferBudget * 0.75 / 50000) * 50000;
    b.parts.results = clamp(b.parts.results - 6, 0, 100);
    msg = `Objectif revu à la baisse : « ${opts.down[1]} ». Budget transferts -25 %.`;
  }
  if (identity && identity !== b.identity) {
    b.identity = identity;
    b.youthTarget = identity === 'youth' ? 15 : 5;
    b.parts.style = clamp(b.parts.style - 3, 0, 100);
    state.objectives.identity = { label: `Identité : ${IDENTITIES[identity].label}`, key: identity };
    state.objectives.youth = { label: `Jeunes (≤ 21 ans) : ${b.youthTarget} % du temps de jeu`, target: b.youthTarget };
    msg += ` Identité redéfinie : ${IDENTITIES[identity].label}.`;
  }
  state.preseason.meeting = true;
  b.confidence = Math.round((b.parts.results * 0.5 + b.parts.finances * 0.15 + b.parts.youth * 0.1 + b.parts.style * 0.1 + b.parts.transfers * 0.15) * 10) / 10;
  return msg;
}

export function addFriendly(state, oppId) {
  const ps = state.preseason;
  if (ps.friendlies.length >= 6) return { ok: false, msg: '6 matchs amicaux maximum.' };
  if (ps.friendlies.some((f) => f.oppId === oppId)) return { ok: false, msg: 'Déjà programmé.' };
  const opp = clubById(state, oppId), uc = userClub(state);
  // Petits clubs : on se déplace chez eux (la fête au village) ; grands clubs : on va chez eux.
  const alt = ps.friendlies.length % 2 === 0;
  const home = opp.rep < uc.rep - 4 ? false : alt;
  ps.friendlies.push({ oppId, home, s: null });
  return { ok: true, msg: `Amical contre ${clubById(state, oppId).name} programmé.` };
}

/** Graine d'un amical. */
export const friendlySeed = (state, oppId) => hashSeed(`${state.seed}-${state.season}-amical-${oppId}`);

/** Effets d'un amical : forme et moral des joueurs utilisés, petite recette à domicile. */
export function applyFriendly(state, oppId, sum, m, userSide) {
  const f = state.preseason.friendlies.find((x) => x.oppId === oppId);
  if (f) f.s = sum.score;
  const diff = sum.score[userSide] - sum.score[1 - userSide];
  for (const mp of allPlayers(m.teams[userSide])) {
    if (mp.minIn == null) continue;
    const p = mp.p;
    p.form = clamp(p.form + (mp.rating >= 6.6 ? 5 : 2), 5, 95);
    p.morale = clamp(p.morale + (diff > 0 ? 3 : diff < 0 ? -1 : 1), 5, 99);
    const mins = Math.max(0, (mp.minOut ?? 90) - mp.minIn);
    p.sharp = clamp(Math.round((p.sharp ?? 50) + (mins / 90) * 9), 20, 92);
    p.fatigue = f?.tour ? 15 : 0;
  }
  if (f?.tour) {
    const uc = userClub(state);
    state.board.fans = clamp((state.board.fans ?? 60) + 1, 0, 100);
  } else if (f?.home) {
    const uc = userClub(state);
    const { revenue } = matchdayRevenue(uc, clubById(state, oppId), 0.5, false);
    const gate = Math.round(revenue * 0.35);
    uc.budget += gate;
    logFinance(state, gate, `Recette match amical`);
  }
}

export function endPreseason(state) {
  const ps = state.preseason;
  ps.active = false;
  const uc = userClub(state);
  const rng = gameRng(state);
  const camp = CAMPS[ps.camp || 'home'], it = INTENSITY[ps.intensity || 'normal'];
  // Bilan financier du stage / de la tournée.
  const cash = campMoney(state, ps.camp || 'home');
  if (cash) { uc.budget += cash; logFinance(state, cash, cash > 0 ? 'Tournée de pré-saison' : `Stage : ${camp.label}`); }
  // Travail foncier : rythme, automatismes, blessures.
  const hurt = [];
  for (const id of uc.playerIds) {
    const p = state.players[id];
    if (!p) continue;
    const share = p.lateBack ? 0.4 : 1; // revenus tard : ils ont manqué le gros du travail
    p.sharp = clamp(Math.round((p.sharp ?? 50) + (camp.fit + it.fit + 8) * share), 20, 95);
    const risk = 0.025 * camp.inj * it.inj * ((p.injHist?.length || 0) >= 4 ? 1.5 : 1) * (p.age >= 31 ? 1.3 : 1);
    if (!p.injury && rng.chance(risk)) {
      p.injury = rng.int(1, it.inj > 1 ? 6 : 3);
      p.injuryName = rng.pick(['Lésion musculaire', 'Contracture', 'Tendinite', 'Entorse légère']);
      logInjury(state, p, 'Préparation');
      hurt.push(`${p.name} (${p.injury} m.)`);
    }
    delete p.lateBack;
  }
  uc.fam = clamp((uc.fam ?? 60) + camp.coh, 0, 100);
  if (ps.camp === 'tour') state.board.fans = clamp((state.board.fans ?? 60) + 3, 0, 100);
  const avg = Math.round(uc.playerIds.reduce((a, id) => a + (state.players[id]?.sharp ?? 60), 0) / Math.max(1, uc.playerIds.length));
  ps.report = { avg, hurt, cash };
  pushMessage(state, { prio: 2, icon: '🏁', title: 'La saison commence !', text: `Préparation terminée (${camp.label}, intensité ${it.label.toLowerCase()}). Rythme moyen du groupe : ${avg}/100${avg < 65 ? ' — l\'équipe manque encore de rythme, les premiers matchs seront difficiles' : avg >= 80 ? ' — l\'équipe est prête' : ''}.${hurt.length ? ` Blessés pendant la préparation : ${hurt.join(', ')}.` : ''}${cash ? ` ${cash > 0 ? 'Recette' : 'Coût'} : ${money(Math.abs(cash))}.` : ''}` });
}
