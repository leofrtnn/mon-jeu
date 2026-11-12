/**
 * MANAGERS HUMAINS (carrière en ligne à plusieurs).
 *
 * Tout le jeu a été écrit pour UN manager : ses données vivent au premier niveau de l'état
 * (state.coach, state.board, state.messages…). Pour jouer à plusieurs sans tout réécrire,
 * chaque humain possède sa « perspective » (les clés ci-dessous), rangée dans
 * state.online.humans[uid]. On bascule d'une perspective à l'autre (simple échange de
 * références) : le code existant fonctionne tel quel pour le manager « courant ».
 *
 * En solo, state.online n'existe pas : tout se comporte comme avant.
 */

/** Données propres à chaque manager humain. */
export const HUMAN_KEYS = ['userClubId', 'coach', 'board', 'life', 'objectives', 'seasonStats', 'sponsorDeals', 'preseason',
  'pendingOffers', 'scout', 'scoutQueue', 'missions', 'scoutReports', 'sacked', 'lastResult', 'history', 'messages', 'mediaV', 'mediaReady',
  'playedMatch'];   // match joué en direct par ce manager (en ligne), avant de cliquer « Prêt »

export const SOLO = '__solo';

export const isOnline = (state) => !!state.online;
export const curHuman = (state) => (state.online ? state.online.cur : SOLO);
export const humanIds = (state) => (state.online ? Object.keys(state.online.humans) : [SOLO]);

/** Identifiant du manager humain d'un club (undefined si le club est géré par l'IA). */
export function humanOfClub(state, clubId) {
  if (!state.online) return clubId != null && clubId === state.userClubId ? SOLO : undefined;
  return state.online.clubOf[clubId];
}
export const isHumanClub = (state, clubId) => humanOfClub(state, clubId) !== undefined;

/** Bascule la perspective courante vers le manager uid. */
export function switchTo(state, uid) {
  const o = state.online;
  if (!o || uid === SOLO || o.cur === uid) return;
  if (!o.humans[uid]) throw new Error(`Manager inconnu : ${uid}`);
  const cur = o.humans[o.cur] || (o.humans[o.cur] = {});
  for (const k of HUMAN_KEYS) cur[k] = state[k];
  const next = o.humans[uid];
  for (const k of HUMAN_KEYS) state[k] = next[k];
  o.cur = uid;
}

/** Exécute fn dans la perspective du manager uid, puis revient à la perspective précédente. */
export function withHuman(state, uid, fn) {
  if (!state.online || uid === SOLO || uid === undefined || uid === state.online.cur) return fn(uid);
  const prev = state.online.cur;
  switchTo(state, uid);
  try { return fn(uid); } finally { switchTo(state, prev); }
}

/** Exécute fn pour chaque manager humain (dans sa perspective). */
export function forEachHuman(state, fn) {
  for (const uid of humanIds(state)) withHuman(state, uid, () => fn(uid));
}

/** Range la perspective courante dans state.online.humans (avant une sauvegarde / un envoi). */
export function stashCurrent(state) {
  const o = state.online;
  if (!o) return;
  const cur = o.humans[o.cur] || (o.humans[o.cur] = {});
  for (const k of HUMAN_KEYS) cur[k] = state[k];
}
