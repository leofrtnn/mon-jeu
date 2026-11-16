/**
 * TRANSFERTS ET DISCUSSION ENTRE MANAGERS (carrière en ligne)
 * ------------------------------------------------------------------
 * Un manager fait une offre pour un joueur d'un AUTRE manager humain : montant, joueur en
 * échange éventuel, prêt, petit mot. L'autre accepte, refuse ou fait une contre-offre, et
 * ainsi de suite (en direct si les deux sont connectés), toute l'année. Un accord trouvé est
 * officialisé par l'hôte au passage de la journée suivante (ou à l'ouverture du mercato s'il
 * est fermé, comme un accord anticipé) : le joueur change de club, l'argent aussi.
 *
 * Les négociations vivent dans state.online.deals (partagé) : chaque modification augmente
 * rev ; la version la plus récente l'emporte quand les copies des managers sont fusionnées.
 * La discussion (state.online.chat) est une simple liste de messages.
 * Aucune dépendance au navigateur : testé en Node.
 */
import { clubById, clubPlayers, pushMessage } from '../game/state.js';
import { humanOfClub, withHuman } from '../game/humans.js';
import { windowOpen, canLetGo, addToClub, logFinance } from '../game/transfers.js';
import { spendTransfer, creditSale, ensureBoard } from '../game/board.js';
import { money } from '../game/economy.js';

const now = () => Date.now();
const uidOf = (state) => state.online?.cur;
export const deals = (state) => Object.values(state.online?.deals || {}).sort((a, b) => b.at - a.at);
/** Négociations en cours qui attendent MA réponse. */
export const myTurn = (state) => deals(state).filter((d) => d.turn === uidOf(state) && ['open'].includes(d.status));

/** Offre pour le joueur d'un autre manager. Retourne { ok, msg, deal }. */
export function makeOffer(state, pid, { fee = 0, swapPid = null, loan = false, note = '' } = {}) {
  const p = state.players[pid];
  const me = uidOf(state);
  if (!p || !state.online) return { ok: false, msg: 'Joueur introuvable.' };
  const seller = humanOfClub(state, p.clubId);
  if (seller === undefined || seller === me) return { ok: false, msg: 'Ce joueur n\'appartient pas à un autre manager.' };
  const sellerClub = clubById(state, p.clubId);
  const lg = canLetGo(state, sellerClub, p);
  if (!lg.ok) return { ok: false, msg: lg.msg };
  if (Object.values(state.online.deals || {}).some((d) => d.pid === pid && d.buyer === me && d.status === 'open')) return { ok: false, msg: 'Vous négociez déjà pour ce joueur.' };
  const club = clubById(state, state.userClubId);
  if (fee > club.budget) return { ok: false, msg: `Budget insuffisant (${money(club.budget)}).` };
  const deal = {
    id: `${me}-${pid}-${now()}`, pid, name: p.name, buyer: me, seller, buyerClub: club.id, sellerClub: sellerClub.id,
    fee: Math.max(0, Math.round(fee / 10000) * 10000), swapPid: swapPid || null, loan: !!loan, status: 'open', turn: seller, rev: 1, at: now(),
    log: [{ by: me, kind: 'offer', fee, swapPid: swapPid || null, note: String(note || '').slice(0, 200), at: now() }],
  };
  (state.online.deals ||= {})[deal.id] = deal;
  return { ok: true, deal, msg: `Offre envoyée à ${state.online.names?.[seller] || 'l\'autre manager'}.` };
}

/** Réponse à une négociation : 'accept' | 'refuse' | 'counter' (avec fee, swapPid) | 'withdraw'. */
export function respond(state, id, action, { fee, swapPid, note = '' } = {}) {
  const d = state.online?.deals?.[id];
  const me = uidOf(state);
  if (!d || d.status !== 'open') return { ok: false, msg: 'Cette négociation est terminée.' };
  if (action === 'withdraw') { if (d.buyer !== me) return { ok: false, msg: 'Seul l\'acheteur peut retirer son offre.' }; }
  else if (d.turn !== me) return { ok: false, msg: 'C\'est à l\'autre manager de répondre.' };
  const other = d.buyer === me ? d.seller : d.buyer;
  const entry = { by: me, kind: action, note: String(note || '').slice(0, 200), at: now() };
  if (action === 'accept') {
    d.status = 'accepted'; d.turn = null; // hors mercato : officialisé à son ouverture
  } else if (action === 'refuse') { d.status = 'refused'; d.turn = null; }
  else if (action === 'withdraw') { d.status = 'withdrawn'; d.turn = null; }
  else if (action === 'counter') {
    d.fee = Math.max(0, Math.round((fee ?? d.fee) / 10000) * 10000);
    if (swapPid !== undefined) d.swapPid = swapPid || null;
    entry.fee = d.fee; entry.swapPid = d.swapPid;
    d.turn = other;
  } else return { ok: false, msg: 'Action inconnue.' };
  d.log.push(entry);
  d.rev++; d.at = now();
  return { ok: true, deal: d };
}

/** Fusionne des négociations reçues (la version la plus avancée l'emporte). Retourne les nouveautés. */
export function mergeDeals(state, incoming) {
  const own = (state.online.deals ||= {});
  const changed = [];
  for (const d of Object.values(incoming || {})) {
    const cur = own[d.id];
    if (!cur || d.rev > cur.rev || (d.rev === cur.rev && d.at > cur.at)) { own[d.id] = JSON.parse(JSON.stringify(d)); changed.push(own[d.id]); }
  }
  return changed;
}

/** Discussion : ajoute un message (retourne le message). */
export function chatSay(state, text) {
  const me = uidOf(state);
  const msg = { id: `${me}-${now()}-${Math.floor(Math.random() * 1e6)}`, uid: me, name: state.online.names?.[me] || 'Moi', text: String(text || '').trim().slice(0, 400), at: now() };
  if (!msg.text) return null;
  mergeChat(state, [msg]);
  return msg;
}
export function mergeChat(state, list) {
  const chat = (state.online.chat ||= []);
  const ids = new Set(chat.map((m) => m.id));
  const added = (list || []).filter((m) => m && !ids.has(m.id));
  if (!added.length) return [];
  chat.push(...added);
  chat.sort((a, b) => a.at - b.at);
  if (chat.length > 150) chat.splice(0, chat.length - 150);
  return added;
}

/**
 * Chez l'hôte, au passage de la journée : les accords trouvés deviennent des transferts.
 * Retourne la liste des transferts effectués / échoués.
 */
export function executeDeals(state) {
  const out = [];
  for (const d of Object.values(state.online?.deals || {})) {
    if (d.status !== 'accepted' || !windowOpen(state)) continue; // accord anticipé : attend l'ouverture du mercato
    const p = state.players[d.pid];
    const buyerClub = clubById(state, d.buyerClub), sellerClub = clubById(state, d.sellerClub);
    const swap = d.swapPid ? state.players[d.swapPid] : null;
    const fail = (why) => { d.status = 'failed'; d.why = why; d.rev++; out.push({ d, ok: false, why }); for (const u of [d.buyer, d.seller]) withHuman(state, u, () => pushMessage(state, { prio: 1, icon: '⚠', title: `Transfert annulé : ${d.name}`, text: why })); };
    if (!p || p.clubId !== d.sellerClub) { fail(`${d.name} n'est plus au club vendeur.`); continue; }
    if (d.swapPid && (!swap || swap.clubId !== d.buyerClub)) { fail('Le joueur proposé en échange n\'est plus au club acheteur.'); continue; }
    if (buyerClub.budget < d.fee) { fail(`Le club acheteur n'a plus les fonds (${money(d.fee)}).`); continue; }
    const move = (pl, from, to) => {
      from.playerIds = from.playerIds.filter((x) => x !== pl.id);
      from.youthIds = (from.youthIds || []).filter((x) => x !== pl.id);
      if (from.lineup) from.lineup = from.lineup.map((x) => (x === pl.id ? null : x));
      if (from.bench) from.bench = from.bench.filter((x) => x !== pl.id);
      addToClub(state, pl, to);
      if (d.loan && pl === p) { pl.onLoanFrom = from.id; pl.loanEnds = state.season + 1; }
      pl.contract = Math.max(pl.contract || 0, 2);
    };
    move(p, sellerClub, buyerClub);
    if (swap) move(swap, buyerClub, sellerClub);
    buyerClub.budget -= d.fee; sellerClub.budget += d.fee;
    withHuman(state, d.buyer, () => { ensureBoard(state); spendTransfer(state, d.fee); if (d.fee) logFinance(state, -d.fee, `Achat : ${p.name}`); pushMessage(state, { prio: 1, icon: '✍', title: `${p.name} vous rejoint !`, text: `Transfert conclu avec ${state.online.names?.[d.seller] || 'l\'autre manager'} pour ${money(d.fee)}${swap ? ` + ${swap.name}` : ''}${d.loan ? ' (prêt)' : ''}.` }); });
    withHuman(state, d.seller, () => { ensureBoard(state); creditSale(state, d.fee); if (d.fee) logFinance(state, d.fee, `Vente : ${p.name}`); pushMessage(state, { prio: 1, icon: '💰', title: `${p.name} est parti`, text: `Vendu à ${state.online.names?.[d.buyer] || 'l\'autre manager'} pour ${money(d.fee)}${swap ? `, ${swap.name} arrive en échange` : ''}.` }); });
    d.status = 'done'; d.rev++; d.at = Date.now();
    out.push({ d, ok: true });
  }
  // On oublie les vieilles négociations terminées.
  for (const [id, d] of Object.entries(state.online?.deals || {})) if (d.status !== 'open' && d.status !== 'accepted' && Date.now() - d.at > 14 * 864e5) delete state.online.deals[id];
  return out;
}

export const squadOf = (state, clubId) => clubPlayers(state, clubById(state, clubId));
