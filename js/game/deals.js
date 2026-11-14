/**
 * DOSSIERS DE TRANSFERT (rien ne se fait en un jour)
 * ------------------------------------------------------------------
 * Achat :   offre au club → réponse sous 1 à 3 jours (accord, contre-offre, refus, rupture)
 *           → conditions personnelles avec le joueur et son agent (réponse sous 1 à 2 jours,
 *           délai de 10 jours pour s'entendre) → visite médicale le lendemain → signature.
 * Prêt :    proposition au club (indemnité, part du salaire payée, option d'achat) → réponse
 *           → accord du joueur (temps de jeu promis) → arrivée.
 * Prolongation : proposition → réponse de l'agent sous 1 à 3 jours (contre-propositions).
 * Pendant ce temps le monde vit : un autre club peut doubler la mise ou signer le joueur,
 * la fenêtre peut fermer (le dernier jour, les réponses arrivent dans la journée).
 *
 * Chaque joueur décide selon SES priorités (ambition, argent, temps de jeu, projet sportif,
 * pays, famille) : playerDecision explique ses raisons et fixe le prix de son accord.
 */
import { clamp } from '../core/rng.js';
import { overall } from '../engine/ratings.js';
import { playerValue, money } from './economy.js';
import { clubById, userClub, clubPlayers, pushMessage, gameRng } from './state.js';
import { currentDate, windowInfo } from './dates.js';
import { DIVISIONS, COUNTRIES } from '../data/world.js';
import { startNegotiation, setSellOn, clubRespond, playerDemands, evaluateContract, completeTransfer, completeRenewal, playerInterest, sellerAccepts,
  roleAcceptable, PROMISE_ROLES, MAX_SQUAD, ambition, logFinance, removeFromClubPublic, addToClubPublic, windowOpen } from './transfers.js';
import { boardAllows, spendTransfer } from './board.js';
import { sellPolicy, loanAllowed, relAdd } from './relations.js';
import { hashSeed } from '../core/rng.js';
import { BAL } from '../data/balance.js';

export const STAGE_LABEL = { club: 'Négociation avec le club', player: 'Conditions personnelles', medical: 'Visite médicale', medfail: 'Visite médicale : réserves', loanplayer: 'Accord du joueur', done: 'Conclu', dead: 'Abandonné' };

export function addDays(iso, n) {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
const today = (state) => currentDate(state);
/** Délai de réponse ; le dernier jour du mercato, tout se règle dans la journée. */
const replyDate = (state, rng, a, b) => (windowInfo(state).deadline ? today(state) : addDays(today(state), rng.int(a, b)));

export const dealsOf = (state) => (state.deals ||= []);
export const activeDeals = (state) => dealsOf(state).filter((d) => d.stage !== 'done' && d.stage !== 'dead');
export const dealFor = (state, pid, kind = null) => activeDeals(state).find((d) => d.pid === pid && (!kind || d.kind === kind));
export const dealById = (state, id) => dealsOf(state).find((d) => d.id === id);

function note(state, d, icon, text) { d.log.push({ d: today(state), icon, text }); }
function tell(state, d, prio, icon, title, text) { pushMessage(state, { prio, icon, title, text, action: { type: 'deal', id: d.id } }); }

/* ---------------- Décision individuelle du joueur ---------------- */

/** Traits stables du joueur (dérivés de son identifiant) : ambition, appât du gain, attachement. */
export function traits(p) {
  const h = hashSeed(`traits-${p.id}`) >>> 0;
  return { amb: ambition(p), money: 1 + (h % 20), loyal: 1 + ((h >> 5) % 20), family: 1 + ((h >> 10) % 20) };
}

/**
 * Le joueur est-il tenté par ce club ? Chaque critère compte selon sa personnalité.
 * Retourne { score (-100..100), ok, reasons: [{ t, v }], wageMult } : en dessous de 0, il refuse
 * de discuter ; entre 0 et 25, il discute mais demandera plus d'argent.
 */
export function playerDecision(state, p, buyer, role = null) {
  const T = traits(p);
  const from = p.clubId ? clubById(state, p.clubId) : null;
  const reasons = [];
  const add = (t, v) => { if (Math.abs(v) >= 1) reasons.push({ t, v: Math.round(v) }); };
  // Prestige du club (pèse selon l'ambition).
  const gap = buyer.rep - (from ? from.rep : Math.max(45, overall(p) - 5));
  add(gap >= 0 ? 'Un club plus prestigieux' : 'Un club moins prestigieux', gap * (0.5 + T.amb / 20));
  // Championnat.
  const lvl = (d) => (DIVISIONS[d]?.level ?? 1);
  const big5 = (c) => ['ENG', 'ESP', 'ITA', 'GER', 'FRA'].includes(c?.country) && lvl(c.div) === 1;
  if (from && big5(from) && !big5(buyer)) add('Quitter un grand championnat', -(6 + T.amb * 0.6));
  if (from && !big5(from) && big5(buyer)) add('Jouer dans un grand championnat', 8 + T.amb * 0.4);
  if (lvl(buyer.div) > 1) add('Deuxième division', -(5 + T.amb * 0.7));
  // Coupe d'Europe (approximation : grands clubs).
  if (buyer.rep >= 80 && (!from || from.rep < 80)) add('Disputer une coupe d\'Europe', 4 + T.amb * 0.3);
  // Temps de jeu attendu.
  const sq = clubPlayers(state, buyer).filter((x) => x.id !== p.id && x.pos === p.pos).map(overall).sort((a, b) => b - a);
  const o = overall(p);
  const need = p.pos === 'GB' ? 1 : ['DC', 'MC', 'BU'].includes(p.pos) ? 2 : 1;
  const starter = sq.length < need || o >= (sq[need - 1] ?? 0) - 1;
  if (starter) add('Une place de titulaire', p.age <= 24 ? 12 : 7);
  else add('Concurrence forte à son poste', -(p.age <= 24 ? 14 : 8) - (o >= 75 ? 6 : 0));
  if (role && PROMISE_ROLES[role]) add(`Statut promis : ${PROMISE_ROLES[role].label}`, { star: 10, key: 6, rotation: 0, backup: -8, youth: -2 }[role] || 0);
  // Pays : rentrer à la maison / s'expatrier.
  const natCountry = Object.entries(COUNTRIES).find(([, c]) => c.name === p.nat)?.[0];
  if (natCountry && natCountry === buyer.country && from && from.country !== buyer.country) add('Revenir jouer dans son pays', 4 + T.family * 0.4);
  if (from && from.country !== buyer.country && natCountry !== buyer.country) add('Changer de pays', -(T.family * 0.35) - (p.age >= 30 ? 3 : 0));
  // Attachement à son club actuel.
  if (from && (p.homegrown || p.joined != null && state.season - p.joined >= 5)) add(`Attaché à ${from.short}`, -(T.loyal * 0.6));
  if (p.requested || p.listed) add('Veut partir de son club', 10);
  // Âge : les anciens pensent au dernier gros contrat.
  if (p.age >= 30) add('Fin de carrière : sécurité financière', T.money * 0.3);
  const score = clamp(reasons.reduce((a, r) => a + r.v, 0), -100, 100);
  // Plus le club est peu attractif, plus il faut payer (selon son appât du gain).
  const wageMult = clamp(1 + (score < 25 ? (25 - score) / 100 * (0.6 + T.money / 25) : -0.03), 0.95, 1.6);
  reasons.sort((a, b) => Math.abs(b.v) - Math.abs(a.v));
  return { score, ok: score > -12 || (state.coach?.rep ?? 0) >= 80 && score > -25, reasons, wageMult, starter };
}

/* ---------------- Ouverture d'un dossier ---------------- */

export function openDeal(state, pid, kind = 'buy') {
  const p = state.players[pid];
  const uc = userClub(state);
  if (!p) return { ok: false, msg: 'Joueur introuvable.' };
  const ex = dealFor(state, pid);
  if (ex) return { ok: true, deal: ex };
  if (kind !== 'renew') {
    if (p.clubId === uc.id) return { ok: false, msg: 'Il est déjà au club.' };
    if (p.clubId && !windowOpen(state)) return { ok: false, msg: 'Le mercato est fermé (seuls les joueurs libres peuvent signer).' };
    if (uc.playerIds.length + activeDeals(state).filter((d) => d.kind !== 'renew').length >= MAX_SQUAD) return { ok: false, msg: `Effectif complet (${MAX_SQUAD} max, dossiers en cours compris).` };
    const dec = playerDecision(state, p, uc);
    if (!dec.ok) return { ok: false, msg: `${p.name} ne souhaite pas venir : ${dec.reasons.filter((r) => r.v < 0).slice(0, 2).map((r) => r.t.toLowerCase()).join(', ')}.`, dec };
    const interest = playerInterest(state, p, uc);
    if (!interest.ok) return { ok: false, msg: interest.reason };
    if (p.clubId) {
      const pol = sellPolicy(state, p, uc);
      if (!pol.ok) return { ok: false, msg: pol.reason, pol };
      if (kind === 'buy' && !sellerAccepts(state, p, uc)) return { ok: false, msg: `${clubById(state, p.clubId).name} refuse de vendre un titulaire à un club moins prestigieux.` };
      if (kind === 'loan' && !loanAllowed(state, clubById(state, p.clubId), uc)) return { ok: false, msg: `${clubById(state, p.clubId).name} refuse de prêter à un club avec qui les relations sont glaciales.` };
      if (kind === 'loan' && loanAsk(state, p).key && overall(p) >= 74) return { ok: false, msg: `${clubById(state, p.clubId).name} ne prête pas un joueur aussi important.` };
    } else if (kind === 'loan') return { ok: false, msg: 'Un joueur libre ne se prête pas : proposez-lui un contrat.' };
  }
  const rng = gameRng(state);
  state.dealSeq = (state.dealSeq || 0) + 1;
  const d = { id: state.dealSeq, kind, pid, from: p.clubId || null, stage: kind === 'renew' || !p.clubId ? 'player' : 'club', pending: false, due: null, log: [], created: today(state), expires: null };
  if (d.stage === 'club' && kind === 'buy') d.neg = startNegotiation(state, pid, rng);
  if (kind === 'loan') d.loanAsk = loanAsk(state, p);
  if (d.stage === 'player') prepareTerms(state, d, rng);
  dealsOf(state).push(d);
  note(state, d, '📂', kind === 'renew' ? 'Discussions de prolongation ouvertes avec l\'agent.' : kind === 'loan' ? `Demande de prêt à ${clubById(state, p.clubId).name}.` : p.clubId ? `Dossier ouvert : ${clubById(state, p.clubId).name} demande environ ${money(d.neg.asking)}.` : 'Joueur libre : discussions directes avec son agent.');
  return { ok: true, deal: d };
}

/** Exigences du joueur (salaire selon l'attrait du club) et délai pour s'entendre. */
function prepareTerms(state, d, rng) {
  const p = state.players[d.pid];
  d.dem = playerDemands(state, p, rng);
  if (d.kind !== 'renew') {
    const dec = playerDecision(state, p, userClub(state));
    d.dem.wage = Math.round(d.dem.wage * dec.wageMult / 100) * 100;
    d.dec = { score: dec.score, reasons: dec.reasons.slice(0, 6) };
  } else {
    // Prolongation : un joueur courtisé ou en fin de contrat est plus exigeant.
    const T = traits(p);
    d.dem.wage = Math.round(d.dem.wage * (1 + (p.contract <= 1 ? 0.06 : 0) + (overall(p) >= 78 ? 0.05 : 0) - T.loyal * 0.004) / 100) * 100;
  }
  d.expires = addDays(today(state), d.kind === 'renew' ? 21 : 10);
}

/* ---------------- Actions du manager ---------------- */

/** Offre d'indemnité (achat). */
export function submitBid(state, id, { fee, sellOn = 0, plan = 'cash' }) {
  const d = dealById(state, id);
  if (!d || d.stage !== 'club' || d.pending) return { ok: false, msg: 'Une réponse est déjà attendue.' };
  const upfront = plan === 'inst' ? Math.round(fee * 0.4 / 25000) * 25000 : fee;
  const chk = boardAllows(state, { fee: upfront });
  if (!chk.ok) return chk;
  setSellOn(d.neg, sellOn);
  if (plan === 'inst') d.neg.min = Math.round(d.neg.min * 1.05 / 25000) * 25000;
  d.bid = { fee, sellOn, plan };
  d.pending = true; d.due = replyDate(state, gameRng(state), 1, 3);
  note(state, d, '📨', `Offre transmise : ${money(fee)}${sellOn ? ` + ${sellOn * 100} % à la revente` : ''}${plan === 'inst' ? ' (paiement échelonné)' : ''}.`);
  return { ok: true, msg: `Offre envoyée. Réponse attendue ${d.due === today(state) ? 'dans la journée' : `vers le ${d.due.slice(8, 10)}/${d.due.slice(5, 7)}`}.` };
}

/** Proposition de prêt. */
export function submitLoan(state, id, { fee, share, option }) {
  const d = dealById(state, id);
  if (!d || d.stage !== 'club' || d.pending) return { ok: false, msg: 'Une réponse est déjà attendue.' };
  const p = state.players[d.pid];
  const chk = boardAllows(state, { fee, addWage: Math.round(p.wage * share) });
  if (!chk.ok) return chk;
  d.loan = { fee, share, option };
  d.pending = true; d.due = replyDate(state, gameRng(state), 1, 3);
  note(state, d, '📨', `Proposition de prêt : ${money(fee)}, ${Math.round(share * 100)} % du salaire pris en charge${option ? `, option d'achat ${money(option)}` : ''}.`);
  return { ok: true, msg: 'Proposition envoyée.' };
}

/** Proposition de contrat (recrue ou prolongation). offer : { wage, years, bonus, clause, goalBonus, role } */
export function submitTerms(state, id, offer) {
  const d = dealById(state, id);
  if (!d || d.pending || !(d.stage === 'player' || d.stage === 'loanplayer')) return { ok: false, msg: 'Une réponse est déjà attendue.' };
  const p = state.players[d.pid];
  const ra = roleAcceptable(state, p, offer.role || 'rotation');
  if (!ra.ok) return ra;
  if (d.kind !== 'loan') {
    const chk = boardAllows(state, { addWage: offer.wage - (d.kind === 'renew' ? p.wage : 0) });
    if (!chk.ok) return chk;
  }
  d.terms = { ...offer };
  d.pending = true; d.due = replyDate(state, gameRng(state), 1, 2);
  note(state, d, '✉', d.kind === 'loan' ? `Statut promis : ${PROMISE_ROLES[offer.role || 'rotation'].label}.` : `Proposition : ${money(offer.wage)}/sem, ${offer.years} an(s), statut ${PROMISE_ROLES[offer.role || 'rotation'].label.toLowerCase()}${offer.bonus ? `, prime ${money(offer.bonus)}` : ''}.`);
  return { ok: true, msg: 'Proposition transmise à l\'agent.' };
}

/** Accepter la contre-proposition du club (la confirmation arrive au prochain jour). */
export function acceptCounter(state, id) {
  const d = dealById(state, id);
  if (!d?.counter) return { ok: false, msg: 'Pas de contre-proposition.' };
  if (d.stage === 'club' && d.kind === 'buy') { const r = submitBid(state, id, { ...(d.bid || {}), fee: d.counter }); if (r.ok) d.bid.agreed = true; return r; }
  if (d.stage === 'club' && d.kind === 'loan') return submitLoan(state, id, d.counterLoan);
  return { ok: false, msg: '—' };
}

export function cancelDeal(state, id, why = 'Vous avez retiré votre offre.') {
  const d = dealById(state, id);
  if (!d || d.stage === 'done' || d.stage === 'dead') return;
  d.stage = 'dead'; d.pending = false; note(state, d, '✖', why);
}

/** Visite médicale ratée : signer quand même (salaire revu à la baisse) ou renoncer. */
export function medicalDecision(state, id, sign) {
  const d = dealById(state, id);
  if (!d || d.stage !== 'medfail') return { ok: false, msg: '—' };
  if (!sign) { cancelDeal(state, id, 'Vous renoncez après la visite médicale.'); return { ok: true, msg: 'Transfert annulé.' }; }
  d.terms.wage = Math.round(d.terms.wage * 0.9 / 100) * 100;
  return finishBuy(state, d);
}

/* ---------------- Réponses (chaque jour) ---------------- */

function loanAsk(state, p) {
  const from = clubById(state, p.clubId);
  const rank = clubPlayers(state, from).map(overall).sort((a, b) => b - a).indexOf(overall(p));
  const key = rank >= 0 && rank < 13;
  return { fee: Math.round(Math.min(6e6, playerValue(p) * (key ? 0.1 : 0.05)) / 25000) * 25000, share: key ? 1 : p.age <= 21 ? 0.6 : 0.8, key };
}

function resolveClubBuy(state, d, rng) {
  const p = state.players[d.pid];
  // Le club tient parole : sa propre contre-proposition acceptée vaut accord.
  if (d.bid.agreed) d.neg.min = Math.min(d.neg.min, d.bid.fee);
  // Concurrence : un autre club s'est manifesté → le vendeur durcit sa position.
  else if (!d.rival && overall(p) >= 70 && rng.chance(0.18)) {
    const rival = rng.pick(state.clubs.filter((c) => c.id !== d.from && c.id !== state.userClubId && c.rep >= userClub(state).rep - 6));
    if (rival) { d.rival = rival.id; d.neg.min = Math.round(d.neg.min * 1.1 / 25000) * 25000; note(state, d, '⚠', `${rival.name} est aussi sur le coup : le prix monte.`); }
  }
  const r = clubRespond(d.neg, d.bid.fee);
  const c = clubById(state, d.from);
  if (r.kind === 'accept') {
    d.fee = d.bid.fee; d.stage = 'player'; d.counter = null;
    prepareTerms(state, d, rng);
    note(state, d, '✅', `${c.name} accepte ${money(d.fee)}. Vous avez jusqu'au ${d.expires.slice(8, 10)}/${d.expires.slice(5, 7)} pour vous entendre avec le joueur.`);
    tell(state, d, 1, '✅', `${c.name} accepte votre offre pour ${p.name}`, `Indemnité ${money(d.fee)}. Négociez maintenant le contrat du joueur.`);
  } else if (r.kind === 'counter') {
    d.counter = r.counter;
    note(state, d, '↩', `${c.name} répond : ${money(r.counter)}.`);
    tell(state, d, 1, '↩', `Contre-proposition pour ${p.name}`, `${c.name} demande ${money(r.counter)}.`);
  } else if (r.kind === 'reject') {
    note(state, d, '❌', `${c.name} juge l'offre insuffisante (${'●'.repeat(Math.max(0, d.neg.patience))} patience restante).`);
    tell(state, d, 2, '❌', `Offre refusée pour ${p.name}`, `${c.name} attend beaucoup plus.`);
  } else {
    d.stage = 'dead';
    note(state, d, '⛔', `${c.name} met fin aux discussions.`);
    tell(state, d, 2, '⛔', `Fin des discussions pour ${p.name}`, `${c.name} ne veut plus entendre parler de vous pour ce joueur.`);
  }
}

function resolveClubLoan(state, d, rng) {
  const p = state.players[d.pid], c = clubById(state, d.from);
  const ask = d.loanAsk, L = d.loan;
  const met = L.fee >= ask.fee && L.share >= ask.share;
  const val = met ? 1 : (L.fee / Math.max(25000, ask.fee)) * 0.45 + (L.share / ask.share) * 0.55 + (L.option ? 0.05 : 0) + (p.age <= 21 ? 0.08 : 0) - (ask.key && overall(p) >= 72 ? 0.15 : 0);
  if (val >= 0.98) {
    d.stage = 'loanplayer'; d.counter = null;
    d.expires = addDays(today(state), 7);
    note(state, d, '✅', `${c.name} accepte le prêt. Reste à convaincre le joueur (temps de jeu).`);
    tell(state, d, 1, '✅', `Prêt accepté par ${c.name}`, `${p.name} : indiquez-lui le temps de jeu promis.`);
  } else if (val >= 0.7) {
    d.counterLoan = { fee: Math.max(L.fee, ask.fee), share: Math.max(L.share, ask.share), option: L.option };
    d.counter = d.counterLoan.fee;
    note(state, d, '↩', `${c.name} veut ${money(d.counterLoan.fee)} et ${Math.round(d.counterLoan.share * 100)} % du salaire pris en charge.`);
    tell(state, d, 1, '↩', `Prêt de ${p.name} : contre-proposition`, `${c.name} pose ses conditions.`);
  } else {
    d.stage = 'dead';
    note(state, d, '⛔', `${c.name} refuse de prêter ${p.name} dans ces conditions.`);
    tell(state, d, 2, '⛔', `Prêt refusé : ${p.name}`, `${c.name} refuse.`);
  }
}

function resolvePlayer(state, d, rng) {
  const p = state.players[d.pid];
  if (d.kind === 'loan') {
    const dec = playerDecision(state, p, userClub(state), d.terms.role);
    const share = PROMISE_ROLES[d.terms.role || 'rotation'].share;
    if (dec.score + share * 40 >= 10) return finishLoan(state, d);
    d.stage = 'dead';
    note(state, d, '⛔', `${p.name} refuse le prêt : ${dec.reasons.filter((r) => r.v < 0).slice(0, 2).map((r) => r.t.toLowerCase()).join(', ') || 'pas assez de garanties'}.`);
    tell(state, d, 2, '⛔', `${p.name} refuse le prêt`, 'Il ne croit pas au projet.');
    return;
  }
  const r = evaluateContract(p, d.dem, d.terms);
  if (r.kind === 'accept') {
    if (d.kind === 'renew') {
      const res = completeRenewal(state, d.pid, d.terms);
      d.stage = res.ok ? 'done' : 'dead';
      note(state, d, res.ok ? '✍' : '⚠', res.msg);
      tell(state, d, 2, res.ok ? '✍' : '⚠', res.ok ? `${p.name} prolonge !` : `Prolongation bloquée : ${p.name}`, res.msg);
      return;
    }
    d.stage = 'medical'; d.pending = true; d.due = windowInfo(state).deadline ? today(state) : addDays(today(state), 1);
    note(state, d, '🤝', `Accord avec ${p.name} et son agent. Visite médicale prévue.`);
    tell(state, d, 2, '🤝', `Accord trouvé avec ${p.name}`, 'Visite médicale demain.');
    return;
  }
  if (r.kind === 'end') {
    d.stage = 'dead';
    note(state, d, '⛔', r.msg);
    tell(state, d, 2, '⛔', `${p.name} met fin aux discussions`, r.msg);
    return;
  }
  d.counter = null;
  note(state, d, r.kind === 'counter' ? '↩' : '❌', r.msg);
  tell(state, d, 1, r.kind === 'counter' ? '↩' : '❌', `Réponse de l'agent de ${p.name}`, r.msg);
}

function resolveMedical(state, d, rng) {
  const p = state.players[d.pid];
  const risk = 0.02 + ((p.injHist?.length || 0) >= 4 ? 0.2 : 0) + (p.injury > 0 ? 0.45 : 0) + (p.age >= 32 ? 0.06 : 0);
  if (rng.chance(risk)) {
    d.stage = 'medfail';
    d.medNote = p.injury > 0 ? `Blessure en cours (${p.injuryName}) : indisponible ${p.injury} match(s).` : (p.injHist?.length || 0) >= 4 ? 'Antécédents de blessures à répétition : fragilité musculaire.' : 'Usure articulaire liée à l\'âge.';
    note(state, d, '🩺', `Réserves médicales : ${d.medNote}`);
    tell(state, d, 1, '🩺', `Visite médicale de ${p.name} : réserves`, `${d.medNote} Signer quand même (salaire revu à la baisse) ou renoncer ?`);
    return;
  }
  note(state, d, '🩺', 'Visite médicale réussie.');
  finishBuy(state, d);
}

function finishBuy(state, d) {
  const p = state.players[d.pid];
  const res = completeTransfer(state, d.pid, d.fee || 0, d.terms, d.dem, d.bid?.sellOn || 0, d.bid?.plan || 'cash');
  d.stage = res.ok ? 'done' : 'dead'; d.pending = false;
  note(state, d, res.ok ? '✍' : '⚠', res.msg);
  if (!res.ok) tell(state, d, 1, '⚠', `Signature impossible : ${p.name}`, res.msg);
  return res;
}

function finishLoan(state, d) {
  const p = state.players[d.pid], uc = userClub(state), from = clubById(state, d.from);
  const L = d.loan;
  if (uc.budget < L.fee) { d.stage = 'dead'; note(state, d, '⚠', 'Budget insuffisant au moment de conclure.'); return; }
  const chk = boardAllows(state, { fee: L.fee, addWage: Math.round(p.wage * L.share) });
  if (!chk.ok) { d.stage = 'dead'; note(state, d, '⚠', chk.msg); return; }
  spendTransfer(state, L.fee);
  from.budget += L.fee; uc.budget -= L.fee;
  removeFromClubPublic(state, p);
  addToClubPublic(state, p, uc);
  p.onLoanFrom = from.id;
  p.loanShare = L.share;
  p.buyOption = L.option || null;
  p.promise = { role: d.terms.role || 'rotation', season: state.season };
  logFinance(state, -L.fee, `Prêt : ${p.name}`);
  relAdd(state, from.id, uc.id, BAL.relations.loan);
  d.stage = 'done';
  note(state, d, '✍', `${p.name} arrive en prêt jusqu'en fin de saison.`);
  tell(state, d, 2, '⇆', `${p.name} arrive en prêt`, `Frais ${money(L.fee)} · ${Math.round(L.share * 100)} % du salaire à votre charge${L.option ? ` · option d'achat ${money(L.option)}` : ''}.`);
}

/** Chaque jour : réponses arrivées, dossiers caducs (joueur parti ailleurs, délai, fenêtre fermée). */
export function dealsDaily(state, rng = gameRng(state)) {
  const now = today(state);
  for (const d of activeDeals(state)) {
    const p = state.players[d.pid];
    if (!p) { d.stage = 'dead'; continue; }
    if (d.kind !== 'renew' && d.from && p.clubId !== d.from) {
      d.stage = 'dead';
      const c = p.clubId ? clubById(state, p.clubId) : null;
      note(state, d, '💨', c ? `${p.name} a signé à ${c.name}.` : `${p.name} n'est plus disponible.`);
      tell(state, d, 2, '💨', `${p.name} vous échappe`, c ? `Il s'est engagé avec ${c.name}.` : 'Dossier clos.');
      continue;
    }
    if (d.kind === 'renew' && p.clubId !== state.userClubId) { d.stage = 'dead'; continue; }
    if (d.pending && d.due <= now) {
      d.pending = false;
      if (d.stage === 'club') (d.kind === 'loan' ? resolveClubLoan : resolveClubBuy)(state, d, rng);
      else if (d.stage === 'player' || d.stage === 'loanplayer') resolvePlayer(state, d, rng);
      else if (d.stage === 'medical') resolveMedical(state, d, rng);
      continue;
    }
    if (!d.pending && d.expires && now > d.expires && (d.stage === 'player' || d.stage === 'loanplayer')) {
      d.stage = 'dead';
      note(state, d, '⌛', 'Délai dépassé : le joueur se tourne vers d\'autres options.');
      tell(state, d, 2, '⌛', `Dossier ${p.name} : délai dépassé`, 'Faute d\'accord, les discussions sont closes.');
    }
  }
  // Mercato fermé : les dossiers avec un club tombent (les joueurs libres et prolongations continuent).
  if (!windowOpen(state)) for (const d of activeDeals(state)) if (d.kind !== 'renew' && d.from) {
    d.stage = 'dead'; d.pending = false;
    note(state, d, '🔒', 'Le mercato a fermé avant la conclusion.');
  }
  // Historique limité.
  const all = dealsOf(state);
  if (all.length > 60) state.deals = all.filter((d) => d.stage !== 'done' && d.stage !== 'dead').concat(all.filter((d) => d.stage === 'done' || d.stage === 'dead').slice(-30));
}
