/**
 * CONVERSATIONS AVEC LES JOUEURS (messagerie privée)
 * ------------------------------------------------------------------
 *  - Chaque joueur de l'effectif a un fil de discussion avec le coach.
 *  - Les joueurs écrivent d'eux-mêmes selon leur situation : grande performance, banc prolongé,
 *    blessure longue, fin de contrat qui approche, envie de brassard, mal du pays, ambition…
 *  - Le coach répond par des réponses à choix ; chaque réponse a des conséquences réelles
 *    (moral, forme, promesse de temps de jeu, liste des transferts, vestiaire).
 *  - Le coach peut aussi écrire le premier (féliciter, recadrer, rassurer, promettre, prendre des nouvelles).
 */
import { clamp } from '../core/rng.js';
import { userClub, clubPlayers, pushMessage } from './state.js';
import { pers, persInfo, influence, minutesShare, expectation } from './people.js';
import { overall } from '../engine/ratings.js';
import { captains } from './captain.js';
import { playerTalk, TALKS } from './media.js';

const pick = (arr, seed) => arr[Math.abs(Math.floor(seed)) % arr.length];
const first = (p) => p.first || (p.name || '').split(' ')[0] || p.name;
const mood = (p, d) => { p.morale = clamp(p.morale + d, 5, 99); };

/**
 * Sujets abordés par les joueurs. when() : le joueur a une raison d'écrire.
 * replies : réponses du coach → effet + réponse du joueur.
 */
export const TOPICS = {
  greatgame: {
    when: (s, p) => p.lastRating >= 8 && p.lastRatingDay === s.day,
    text: (p, s) => pick([`Coach, quel match ! Merci pour la confiance, je me sens vraiment bien en ce moment.`, `Je voulais juste vous dire merci. Ce soir tout m'a réussi, j'espère continuer comme ça.`, `Grosse soirée ! Les gars m'ont dit que vous étiez content, ça me motive encore plus.`], p.id + s.day),
    replies: [
      { key: 'praise', label: 'Bravo, tu mérites ta place. Continue comme ça.', fx: (s, p) => { mood(p, 5); return 'Merci coach, je ne vais pas vous décevoir 💪'; } },
      { key: 'humble', label: 'Bien joué, mais garde les pieds sur terre.', fx: (s, p) => { p.form = clamp(p.form + 3, 5, 95); mood(p, pers(p) === 'ambitious' ? -2 : 1); return pers(p) === 'ambitious' ? 'Compris… même si j\'aurais aimé un peu plus de reconnaissance.' : 'Vous avez raison, on reste concentrés.'; } },
    ],
  },
  bench: {
    when: (s, p, sq) => (s.seasonStats?.m || 0) >= 5 && minutesShare(s, p) < expectation(s, p, sq) * 0.55 && p.age >= 20 && p.morale < 62,
    text: (p, s) => pick([`Coach, je peux vous parler ? Je ne joue presque plus et je ne comprends pas vraiment pourquoi.`, `Je m'entraîne dur tous les jours, mais je ne vois pas le terrain. Qu'est-ce que je dois faire de plus ?`, `Honnêtement, c'est difficile en ce moment. J'ai besoin de jouer.`], p.id + s.day),
    replies: [
      { key: 'chance', label: 'Ta chance va venir, sois prêt. (promesse : plus de temps de jeu)', fx: (s, p) => { p.promise = { role: p.promise?.role === 'key' ? 'star' : p.promise?.role === 'rotation' ? 'key' : 'rotation', season: s.season, strikes: 0 }; mood(p, 7); return 'D\'accord coach, je serai prêt. Je compte sur vous.'; } },
      { key: 'work', label: 'Montre-le-moi à l\'entraînement d\'abord.', fx: (s, p) => { p.form = clamp(p.form + 4, 5, 95); mood(p, pers(p) === 'leader' || pers(p) === 'professional' ? 1 : -4); return pers(p) === 'professional' ? 'Message reçu. Je vais tout donner.' : 'Je travaille déjà beaucoup… mais bon, ok.'; } },
      { key: 'loan', label: 'Un prêt te ferait peut-être du bien. On en parle ?', fx: (s, p) => { p.listed = true; mood(p, p.age <= 23 ? 3 : -5); return p.age <= 23 ? 'Pourquoi pas, si c\'est pour revenir plus fort.' : 'Je ne m\'attendais pas à ça… Je vais réfléchir avec mon agent.'; } },
    ],
  },
  injury: {
    when: (s, p) => p.injury >= 6 && !(p.chatInj === p.injury) && (p.chatInj = p.injury),
    text: (p, s) => pick([`C'est dur, coach. ${p.injury} matchs à l'écart… Je fais tout pour revenir vite.`, `Les médecins disent qu'il faudra du temps. Je suis frustré de ne pas pouvoir aider l'équipe.`], p.id + s.day),
    replies: [
      { key: 'support', label: 'Prends le temps qu\'il faut, on t\'attend.', fx: (s, p) => { mood(p, 6); return 'Merci, ça me fait du bien d\'entendre ça.'; } },
      { key: 'rush', label: 'On a besoin de toi au plus vite.', fx: (s, p) => { mood(p, 1); if (p.injury > 2 && Math.random() < 0.5) p.injury--; p.relapse = { risk: Math.min(0.5, (p.relapse?.risk || 0) + 0.12), matches: 4 }; return 'Je vais pousser pour revenir plus tôt.'; } },
    ],
  },
  future: {
    when: (s, p) => p.contract <= 1 && overall(p) >= 64 && !p.promise?.renewTalk && s.day >= 10,
    text: (p, s) => pick([`Coach, mon contrat se termine bientôt. J'aimerais savoir si le club compte sur moi.`, `Mon agent me parle d'autres clubs… mais je voulais d'abord savoir ce que vous pensez de mon avenir ici.`], p.id + s.day),
    replies: [
      { key: 'renew', label: 'Tu fais partie du projet, on va prolonger.', fx: (s, p) => { (p.promise ||= { role: 'rotation', season: s.season, strikes: 0 }).renewTalk = true; mood(p, 6); return 'Super nouvelle ! Mon agent attend votre proposition.'; }, open: 'renew' },
      { key: 'wait', label: 'On en reparle en fin de saison.', fx: (s, p) => { (p.promise ||= { role: 'rotation', season: s.season, strikes: 0 }).renewTalk = true; mood(p, -3); return 'D\'accord… mais je ne pourrai pas attendre éternellement.'; } },
      { key: 'free', label: 'Je ne pense pas te garder.', fx: (s, p) => { (p.promise ||= { role: 'rotation', season: s.season, strikes: 0 }).renewTalk = true; p.listed = true; mood(p, -10); return 'Je vois. Merci d\'avoir été franc.'; } },
    ],
  },
  armband: {
    when: (s, p) => { const c = captains(s, userClub(s)); return p.id !== c.captain && p.id !== c.vice && pers(p) === 'leader' && influence(s, p) >= 62 && !p.chatArm && (p.chatArm = s.season); },
    text: (p, s) => `Coach, je me sens prêt à prendre plus de responsabilités dans le vestiaire. Le brassard, c'est quelque chose qui me tient à cœur.`,
    replies: [
      { key: 'yes', label: 'Tu as les qualités. Je vais y réfléchir sérieusement.', fx: (s, p) => { mood(p, 5); return 'Merci pour votre confiance, coach.'; } },
      { key: 'no', label: 'Le brassard est déjà en de bonnes mains.', fx: (s, p) => { mood(p, -4); return 'Je comprends. Je montrerai l\'exemple quand même.'; } },
    ],
  },
  homesick: {
    when: (s, p) => p.age <= 22 && p.morale < 48 && p.nat && userClub(s).country && !String(p.nat).toLowerCase().includes(String(userClub(s).country).toLowerCase().slice(0, 3)) && !p.chatHome && (p.chatHome = s.season),
    text: (p) => `Coach, je dois être honnête : ma famille me manque, c'est difficile de m'adapter ici.`,
    replies: [
      { key: 'mentor', label: 'Je vais demander à un cadre de te prendre sous son aile.', fx: (s, p) => { mood(p, 8); return 'Merci beaucoup, ça va m\'aider.'; } },
      { key: 'family', label: 'Fais venir ta famille quelques jours, le club s\'en occupe.', fx: (s, p) => { mood(p, 10); userClub(s).budget -= 15000; return 'C\'est vrai ?! Merci coach, vraiment.'; } },
      { key: 'tough', label: 'C\'est le métier, il faut s\'endurcir.', fx: (s, p) => { mood(p, -5); return '…D\'accord.'; } },
    ],
  },
  ambition: {
    when: (s, p) => pers(p) === 'ambitious' && overall(p) >= userClub(s).rep + 6 && p.morale < 60 && !p.chatAmb && (p.chatAmb = s.season),
    text: (p) => `Coach, je veux jouer les plus grands trophées. Est-ce que le club a vraiment l'ambition de gagner ?`,
    replies: [
      { key: 'project', label: 'On construit pour gagner, et tu es au cœur du projet.', fx: (s, p) => { mood(p, 6); return 'Alors je reste à fond avec vous.'; } },
      { key: 'honest', label: 'On a des limites, mais on va tout donner.', fx: (s, p) => { mood(p, -2); return 'J\'apprécie l\'honnêteté. On verra la suite.'; } },
    ],
  },
};

/** Fil de discussion d'un joueur. */
export function thread(state, pid) {
  const C = (state.chats ||= {});
  return (C[pid] ||= { msgs: [], pending: null, unread: 0 });
}
const add = (state, pid, from, text, extra = {}) => {
  const t = thread(state, pid);
  t.msgs.push({ from, text, day: state.day, season: state.season, ...extra });
  if (t.msgs.length > 40) t.msgs.splice(0, t.msgs.length - 40);
  if (from === 'p') t.unread++;
  t.last = state.day + state.season * 1000;
};

/** Nombre de fils non lus (badge de la messagerie). */
export const unreadChats = (state) => Object.values(state.chats || {}).reduce((a, t) => a + (t.unread ? 1 : 0), 0);

/** Une journée : au plus un joueur écrit au coach (et pas le même trop souvent). */
export function chatDaily(state, rng) {
  const uc = userClub(state);
  if (!uc) return;
  const sq = clubPlayers(state, uc).filter((p) => !p.onLoanFrom);
  const busy = Object.values(state.chats || {}).filter((t) => t.pending).length;
  if (busy >= 3) return;
  for (const p of rng.shuffle(sq.slice())) {
    const t = state.chats?.[p.id];
    if (t?.pending || (p.chatDay != null && state.day - p.chatDay < 7 && p.chatSeason === state.season)) continue;
    const topic = Object.entries(TOPICS).find(([k, T]) => (k === 'greatgame' || rng.chance(0.35 * persInfo(p).req + 0.05)) && T.when(state, p, sq));
    if (!topic) continue;
    const [k, T] = topic;
    p.chatDay = state.day; p.chatSeason = state.season;
    add(state, p.id, 'p', T.text(p, state));
    thread(state, p.id).pending = k;
    pushMessage(state, { prio: 2, icon: '💬', title: `${p.name} vous a écrit`, text: T.text(p, state).slice(0, 90), action: { type: 'chat', pid: p.id } });
    return;
  }
}

/** Le coach répond à un sujet en attente. Retourne { open } si une négociation doit s'ouvrir. */
export function replyChat(state, pid, key) {
  const t = thread(state, pid);
  const T = TOPICS[t.pending];
  const p = state.players[pid];
  if (!T || !p) return {};
  const r = T.replies.find((x) => x.key === key);
  if (!r) return {};
  add(state, pid, 'me', r.label);
  t.pending = null;
  add(state, pid, 'p', r.fx(state, p));
  t.unread = 0;
  return { open: r.open || null };
}

/** Le coach écrit le premier. kind : une des TALKS, ou 'how' (prendre des nouvelles). */
export const WRITE = { how: 'Comment tu te sens en ce moment ?', ...TALKS };
export function writeChat(state, pid, kind) {
  const p = state.players[pid];
  if (!p) return { ok: false };
  if (kind === 'how') {
    add(state, pid, 'me', WRITE.how);
    const ms = minutesShare(state, p), ex = expectation(state, p);
    let txt;
    if (p.injury > 0) txt = `Je suis encore blessé (${p.injury} match(s)), mais je bosse avec les kinés tous les jours.`;
    else if (p.morale >= 72) txt = pick(['Franchement, super bien ! L\'ambiance est top.', 'Je me sens en confiance, prêt pour le prochain match.'], p.id + state.day);
    else if (ms < ex * 0.6 && (state.seasonStats?.m || 0) >= 4) txt = 'Pour être honnête, j\'aimerais jouer davantage.';
    else if (p.form < 42) txt = 'Je traverse une période compliquée, je ne suis pas content de mes performances.';
    else if (p.fatigue > 45) txt = 'Un peu fatigué, les matchs s\'enchaînent.';
    else txt = 'Ça va, coach. Je reste concentré.';
    add(state, pid, 'p', txt);
    thread(state, pid).unread = 0;
    return { ok: true };
  }
  const before = p.morale;
  const r = playerTalk(state, pid, kind);
  if (!r.ok) return r;
  add(state, pid, 'me', WRITE[kind]);
  const d = p.morale - before;
  add(state, pid, 'p', d >= 4 ? pick(['Merci coach, ça compte beaucoup pour moi.', 'Ça me motive à fond !'], p.id) : d <= -4 ? pick(['Je ne suis pas d\'accord, mais bon…', 'Je trouve ça injuste.'], p.id) : pick(['D\'accord, compris.', 'Ok coach.'], p.id), { note: r.msg });
  thread(state, pid).unread = 0;
  return r;
}
