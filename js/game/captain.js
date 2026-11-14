/**
 * CAPITAINE ET VICE-CAPITAINE
 * ------------------------------------------------------------------
 *  - chaque club a un capitaine et un vice-capitaine (l'IA choisit le joueur le plus influent) ;
 *  - l'utilisateur les nomme depuis la fiche du joueur : le nouveau capitaine gagne du moral,
 *    l'ancien (s'il est influent) le vit mal, et le vestiaire juge le choix ;
 *  - en match, le brassard sur le terrain rassure l'équipe (léger bonus de rendement, surtout
 *    quand on est mené) et calme les esprits (moins de cartons) ; le vice-capitaine prend le
 *    relais si le capitaine sort ;
 *  - après une défaite, c'est le capitaine qui peut prendre la parole dans le vestiaire.
 */
import { clubPlayers, userClub, pushMessage } from './state.js';
import { influence, moodShift } from './people.js';
import { clamp } from '../core/rng.js';

const eligible = (state, club) => clubPlayers(state, club).filter((p) => !p.onLoanFrom && p.clubId === club.id);

/** Leadership d'un joueur (0-100) : influence dans le vestiaire, âge, sang-froid. */
export function leadership(state, p) {
  if (!p) return 0;
  // Leadership connu (base de joueurs) : il pèse lourd ; sinon influence dans le vestiaire et sang-froid.
  if (p.lead != null) return clamp(Math.round(p.lead * 5 * 0.6 + influence(state, p) * 0.4), 0, 100);
  return clamp(Math.round(influence(state, p) * 0.75 + (p.attrs?.sf ?? 60) * 0.25), 0, 100);
}

/** Capitaine et vice-capitaine d'un club (choisis automatiquement s'ils manquent). */
export function captains(state, club) {
  const ps = eligible(state, club);
  const ok = (id) => id && ps.some((p) => p.id === id);
  if (!ok(club.captain) || !ok(club.vice) || club.captain === club.vice) {
    const ranked = ps.map((p) => ({ p, l: leadership(state, p) })).sort((a, b) => b.l - a.l);
    if (!ok(club.captain)) club.captain = ranked.find((x) => x.p.id !== club.vice)?.p.id || null;
    if (!ok(club.vice) || club.vice === club.captain) club.vice = ranked.find((x) => x.p.id !== club.captain)?.p.id || null;
  }
  return { captain: club.captain, vice: club.vice };
}

/** Données du brassard pour le moteur de match. */
export function captainCfg(state, club) {
  const { captain, vice } = captains(state, club);
  const byId = (id) => state.players[id];
  return { captain, vice, capLead: leadership(state, byId(captain)), viceLead: leadership(state, byId(vice)) };
}

/** Nomme le capitaine (ou le vice-capitaine) de l'utilisateur. Retourne un message. */
export function setCaptain(state, pid, vice = false) {
  const uc = userClub(state);
  captains(state, uc);
  const p = state.players[pid];
  if (!p) return '';
  const key = vice ? 'vice' : 'captain';
  const prev = state.players[uc[key]];
  if (prev?.id === pid) return '';
  // Le capitaine devient vice ou l'inverse : on échange.
  const other = vice ? 'captain' : 'vice';
  if (uc[other] === pid) uc[other] = prev?.id || null;
  uc[key] = pid;
  moodShift(p, vice ? 4 : 8);
  let txt = `${p.name} est nommé ${vice ? 'vice-capitaine' : 'capitaine'}.`;
  if (prev && prev.id !== pid && uc[other] !== prev.id) {
    const infl = influence(state, prev);
    moodShift(prev, -(vice ? 3 : infl > 55 ? 10 : 5));
    if (!vice && infl > 55) txt += ` ${prev.name} perd le brassard et le vit mal.`;
  }
  // Le vestiaire juge : nommer un joueur sans légitimité agace les cadres.
  const lead = leadership(state, p);
  const best = Math.max(...eligible(state, uc).map((x) => leadership(state, x)));
  if (!vice) {
    state.coach.dressing = clamp((state.coach.dressing ?? 60) + (lead >= best - 8 ? 2 : lead < best - 25 ? -4 : 0), 0, 100);
    if (lead < best - 25) txt += ' Le vestiaire est surpris par ce choix.';
  }
  pushMessage(state, { prio: 2, icon: '©', title: vice ? 'Nouveau vice-capitaine' : 'Nouveau capitaine', text: txt });
  return txt;
}
