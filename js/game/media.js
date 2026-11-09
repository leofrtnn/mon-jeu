/**
 * VIE DU CLUB : conférences de presse et discussions individuelles avec les joueurs.
 */
import { clamp } from '../core/rng.js';
import { userClub, clubById, gameRng, pushMessage } from './state.js';
import { overall, squadStrength } from '../engine/ratings.js';
import { clubPlayers } from './state.js';
import { PROMISE_ROLES, ambition } from './transfers.js';

/**
 * Question de conférence de presse selon le contexte du match.
 * Chaque réponse : { text, me (motivation de mon équipe), opp (motivation adverse), fans }.
 */
export function pressQuestion(state, oppId) {
  const uc = userClub(state);
  const opp = clubById(state, oppId);
  const row = state.tables[uc.div]?.[uc.id];
  const form = row?.form || [];
  const losses = form.slice(-3).filter((r) => r === 'D').length;
  const wins = form.slice(-3).filter((r) => r === 'V').length;
  const diff = squadStrength(clubPlayers(state, uc)) - squadStrength(clubPlayers(state, opp));
  if (losses >= 2) return { q: `Trois matchs compliqués… Votre poste est-il menacé avant d'affronter ${opp.name} ?`, a: [
    { text: 'Je fais entièrement confiance au groupe.', me: 3, opp: 0, fans: 1 },
    { text: 'Les joueurs doivent se réveiller, et vite.', me: 'risk', opp: 0, fans: 0 },
    { text: 'Je ne parlerai que du match de demain.', me: 1, opp: 0, fans: -1 }] };
  if (wins >= 3) return { q: 'Votre équipe enchaîne les victoires. Jusqu\'où peut-elle aller ?', a: [
    { text: 'On reste humbles, match après match.', me: 2, opp: -1, fans: 0 },
    { text: 'On vise le titre, clairement.', me: 4, opp: 2, fans: 3 },
    { text: 'Personne ne peut nous arrêter.', me: 3, opp: 4, fans: 2 }] };
  if (diff > 3) return { q: `Vous êtes favoris face à ${opp.name}. La victoire est-elle obligatoire ?`, a: [
    { text: 'Oui, on joue pour gagner.', me: 2, opp: 1, fans: 1 },
    { text: 'Beaucoup de respect pour cet adversaire.', me: 1, opp: -2, fans: 0 },
    { text: 'Ils n\'ont aucune chance.', me: 3, opp: 5, fans: 2 }] };
  if (diff < -3) return { q: `Personne ne vous voit gagner contre ${opp.name}. Votre réaction ?`, a: [
    { text: 'On n\'a rien à perdre, on va jouer libérés.', me: 3, opp: 0, fans: 1 },
    { text: 'Ce sera très compliqué, soyons honnêtes.', me: -2, opp: -1, fans: -2 },
    { text: 'On va les surprendre.', me: 2, opp: 2, fans: 2 }] };
  return { q: `Comment abordez-vous le match contre ${opp.name} ?`, a: [
    { text: 'Avec beaucoup d\'ambition.', me: 2, opp: 1, fans: 1 },
    { text: 'Avec prudence, c\'est un match piège.', me: 1, opp: -1, fans: 0 },
    { text: 'Je ne commente pas l\'adversaire.', me: 0, opp: 0, fans: -1 }] };
}

/** Applique une réponse. Retourne { me, opp, text } (bonus de motivation pour le match). */
export function pressAnswer(state, answer) {
  const rng = gameRng(state);
  let me = answer.me;
  if (me === 'risk') me = rng.chance(0.55) ? 5 : -4;
  state.board.fans = clamp((state.board.fans ?? 60) + answer.fans, 0, 100);
  const text = me >= 3 ? 'Le vestiaire a apprécié votre discours.' : me <= -1 ? 'Vos mots ont refroidi le vestiaire.' : 'Réponse bien accueillie.';
  return { me, opp: answer.opp, text: answer.opp >= 3 ? `${text} Mais l'adversaire s'en sert comme motivation !` : text };
}

/* ---------------- Discussions avec les joueurs ---------------- */

export const TALKS = {
  praise: 'Le féliciter',
  criticize: 'Recadrer ses performances',
  reassure: 'Le rassurer sur son avenir',
  promise: 'Lui promettre plus de temps de jeu',
};

export function playerTalk(state, pid, kind) {
  const p = state.players[pid];
  if (p.talkDay != null && state.day - p.talkDay < 5 && p.talkSeason === state.season) return { ok: false, msg: `Vous lui avez déjà parlé récemment (encore ${5 - (state.day - p.talkDay)} journée(s)).` };
  p.talkDay = state.day; p.talkSeason = state.season;
  const amb = ambition(p);
  let msg;
  switch (kind) {
    case 'praise':
      if (p.form >= 58) { p.morale = clamp(p.morale + 6, 5, 99); msg = `${p.name} est ravi de votre confiance.`; }
      else { p.morale = clamp(p.morale - 3, 5, 99); msg = `${p.name} ne comprend pas : il sait qu'il traverse une mauvaise passe.`; }
      break;
    case 'criticize':
      if (p.form <= 48) { p.form = clamp(p.form + 6, 5, 95); p.morale = clamp(p.morale - (amb >= 14 ? 6 : 2), 5, 99); msg = `${p.name} accepte la critique et promet de réagir.`; }
      else { p.morale = clamp(p.morale - 9, 5, 99); msg = `${p.name} trouve la critique injuste et le prend très mal.`; }
      break;
    case 'reassure':
      p.morale = clamp(p.morale + (p.morale < 50 ? 6 : 1), 5, 99);
      msg = p.morale < 50 ? `${p.name} est rassuré.` : `${p.name} vous remercie, mais n'était pas inquiet.`;
      break;
    case 'promise': {
      const order = ['youth', 'backup', 'rotation', 'key', 'star'];
      const cur = p.promise?.role || 'rotation';
      const next = order[Math.min(order.length - 1, order.indexOf(cur) + 1)];
      p.promise = { role: next, season: state.season, strikes: 0 };
      p.morale = clamp(p.morale + 8, 5, 99);
      if (p.requested && p.morale > 55) { p.requested = false; p.listed = false; }
      msg = `${p.name} attend désormais un statut « ${PROMISE_ROLES[next].label} ». Tenez parole !`;
      break;
    }
    default: return { ok: false, msg: '?' };
  }
  return { ok: true, msg };
}

export { pushMessage, overall };
