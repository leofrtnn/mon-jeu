/**
 * INTERFACE : négociations et discussion entre managers (carrière en ligne).
 * Les offres et les messages partent tout de suite aux autres managers connectés (salon
 * temps réel) et voyagent aussi avec « Prêt » (pour ceux qui ne sont pas connectés).
 */
import { makeOffer, respond, mergeDeals, mergeChat, chatSay, deals } from '../../online/mgrTrade.js';
import { clubById, clubPlayers, userClub } from '../../game/state.js';
import { overall } from '../../engine/ratings.js';
import { money } from '../../game/economy.js';
import { windowOpen } from '../../game/transfers.js';
import { esc, crest } from '../components.js';

const nameOf = (s, uid) => s.online?.names?.[uid] || 'Manager';
const pname = (s, pid) => s.players[pid]?.name || '?';

function broadcastDeal(app, d) {
  app.online?.room?.send({ t: 'deal', deal: d });
  app.save(true);
  app.render();
}

/** Message reçu du salon : négociation ou discussion. */
export function onRoomMessage(app, msg) {
  const s = app.state;
  if (!s?.online) return;
  if (msg.t === 'deal' && msg.deal) {
    const [d] = mergeDeals(s, { [msg.deal.id]: msg.deal });
    if (!d) return;
    const me = s.online.cur, other = nameOf(s, d.buyer === me ? d.seller : d.buyer);
    const last = d.log[d.log.length - 1];
    const txt = d.status === 'accepted' ? `✅ ${other} accepte : ${d.name} pour ${money(d.fee)} (officialisé ${windowOpen(s) ? 'à la prochaine journée' : 'à l\'ouverture du mercato'})`
      : d.status === 'refused' ? `❌ ${other} refuse votre offre pour ${d.name}`
        : d.status === 'withdrawn' ? `${other} retire son offre pour ${d.name}`
          : last?.kind === 'counter' ? `↔ ${other} fait une contre-offre pour ${d.name} : ${money(d.fee)}` : `💼 ${other} vous fait une offre pour ${d.name} : ${money(d.fee)}`;
    app.toast(txt, 4500);
    app.save(true);
    if (app.tab === 'home') app.render();
    if (app.ui.dealSheet?.id === d.id) app.ui.dealSheet.refresh();
  }
  if (msg.t === 'chat' && msg.m) {
    const added = mergeChat(s, [msg.m]);
    if (!added.length) return;
    if (app.ui.chat) app.ui.chat.refresh();
    else { app.online.chatUnread = (app.online.chatUnread || 0) + 1; app.toast(`💬 ${msg.m.name} : ${msg.m.text.slice(0, 60)}`, 3500); if (app.tab === 'home') app.render(); }
    app.save();
  }
}

/** Fenêtre d'offre pour le joueur d'un autre manager. */
export function offerSheet(app, pid) {
  const s = app.state, p = s.players[pid];
  const club = clubById(s, p.clubId), uc = userClub(s);
  const mine = clubPlayers(s, uc).filter((q) => !q.onLoanFrom).sort((a, b) => overall(b) - overall(a));
  const h = app.sheet({
    html: `<h2>💼 Offre pour ${esc(p.name)}</h2>
      <div class="row" style="gap:10px;margin-bottom:8px">${crest(club, 'sm')}<div class="grow"><b>${esc(club.name)}</b><br><small>Manager : ${esc(nameOf(s, s.online.clubOf[club.id]))} · valeur estimée ${money(p.value)}</small></div></div>
      <label class="field"><span>Montant proposé (€)</span><input id="mo-fee" type="number" min="0" step="100000" value="${Math.round(p.value / 100000) * 100000}"></label>
      <small class="muted">Votre budget : ${money(uc.budget)}</small>
      <label class="field"><span>Joueur en échange (facultatif)</span><select id="mo-swap"><option value="">— aucun —</option>${mine.map((q) => `<option value="${q.id}">${esc(q.name)} · ${q.pos} · ${overall(q)}</option>`).join('')}</select></label>
      <label class="row" style="gap:8px;margin:8px 0"><input type="checkbox" id="mo-loan"> Prêt (une saison)</label>
      <label class="field"><span>Un mot pour l'autre manager</span><input id="mo-note" maxlength="200" placeholder="Il aura du temps de jeu chez nous…"></label>
      <div class="btns"><button class="btn" data-act="cancel">Annuler</button><button class="btn primary" data-act="send">Envoyer l'offre</button></div>`,
    actions: {
      cancel: () => h.close(),
      send: () => {
        const q = (id) => h.body.querySelector(id);
        const r = makeOffer(s, pid, { fee: +q('#mo-fee').value || 0, swapPid: +q('#mo-swap').value || null, loan: q('#mo-loan').checked, note: q('#mo-note').value });
        app.toast(r.msg, 3500);
        if (!r.ok) return;
        h.close();
        broadcastDeal(app, r.deal);
      },
    },
  });
}

/** Détail d'une négociation : historique et réponses possibles. */
export function dealSheet(app, id) {
  const s = app.state;
  const me = s.online.cur;
  const body = () => {
    const d = s.online.deals[id];
    if (!d) return '<p>Négociation introuvable.</p>';
    const buying = d.buyer === me;
    const other = nameOf(s, buying ? d.seller : d.buyer);
    const swap = d.swapPid ? s.players[d.swapPid] : null;
    const st = { open: d.turn === me ? '⏳ À vous de répondre' : `⏳ En attente de ${esc(other)}`, accepted: `✅ Accord trouvé : officialisé ${windowOpen(s) ? 'à la prochaine journée' : 'à l\'ouverture du mercato'}`, refused: '❌ Refusée', withdrawn: 'Offre retirée', done: '✍ Transfert effectué', failed: `⚠ Annulé : ${esc(d.why || '')}` }[d.status];
    const log = d.log.map((l) => `<div class="msg"><span class="ic">${{ offer: '💼', counter: '↔', accept: '✅', refuse: '❌', withdraw: '↩' }[l.kind] || '•'}</span><div class="grow"><b>${esc(nameOf(s, l.by))}</b> ${
      { offer: 'propose', counter: 'contre-propose', accept: 'accepte', refuse: 'refuse', withdraw: 'retire son offre' }[l.kind] || ''} ${l.fee != null ? `<b>${money(l.fee)}</b>` : ''}${l.swapPid ? ` + ${esc(pname(s, l.swapPid))}` : ''}${l.note ? `<br><small>« ${esc(l.note)} »</small>` : ''}</div></div>`).join('');
    const canAct = d.status === 'open' && d.turn === me;
    return `<h2>${buying ? 'Achat' : 'Vente'} : ${esc(d.name)}</h2>
      <p class="muted">${buying ? 'Vendeur' : 'Acheteur'} : <b>${esc(other)}</b> · ${st}</p>
      <div class="card"><div class="row between"><span>Montant</span><b>${money(d.fee)}</b></div>${swap ? `<div class="row between"><span>En échange</span><b>${esc(swap.name)}</b></div>` : ''}${d.loan ? '<div class="row between"><span>Type</span><b>Prêt (une saison)</b></div>' : ''}</div>
      <div class="list">${log}</div>
      ${canAct ? `<label class="field"><span>Contre-offre (€)</span><input id="dl-fee" type="number" min="0" step="100000" value="${d.fee}"></label>
        <label class="field"><span>Un mot</span><input id="dl-note" maxlength="200"></label>
        <div class="btns"><button class="btn danger" data-act="refuse">Refuser</button><button class="btn" data-act="counter">Contre-offre</button><button class="btn primary" data-act="accept">Accepter</button></div>` : ''}
      ${d.status === 'open' && buying ? '<button class="btn block" data-act="withdraw">Retirer mon offre</button>' : ''}`;
  };
  const act = (action) => {
    const fee = +(h.body.querySelector('#dl-fee')?.value) || undefined;
    const note = h.body.querySelector('#dl-note')?.value || '';
    const r = respond(s, id, action, { fee, note });
    if (!r.ok) { app.toast(r.msg, 3000); return; }
    broadcastDeal(app, r.deal);
    h.update(body());
  };
  const h = app.sheet({
    html: body(),
    onClose: () => { app.ui.dealSheet = null; },
    actions: { accept: () => act('accept'), refuse: () => act('refuse'), counter: () => act('counter'), withdraw: () => act('withdraw') },
  });
  app.ui.dealSheet = { id, refresh: () => h.update(body()) };
}

/** Carte de l'Accueil : négociations en cours avec les autres managers. */
export function dealsCard(app) {
  const s = app.state;
  if (!s.online) return '';
  const me = s.online.cur;
  const list = deals(s).filter((d) => (d.buyer === me || d.seller === me) && (['open', 'accepted'].includes(d.status) || Date.now() - d.at < 2 * 864e5)).slice(0, 8);
  const unread = app.online?.chatUnread || 0;
  return `<div class="card"><div class="row between"><h3 class="ttl" style="margin:0">🤝 Entre managers</h3><button class="btn sm" data-act="mgrchat">💬 Discussion${unread ? ` <b class="nav-badge" style="position:static;display:inline-block">${unread}</b>` : ''}</button></div>
    ${list.length ? list.map((d) => {
      const buying = d.buyer === me;
      const tag = d.status === 'open' ? (d.turn === me ? '<span class="tag warn">À vous</span>' : '<span class="tag">En attente</span>') : d.status === 'accepted' ? '<span class="tag good">Accord</span>' : `<span class="tag">${{ refused: 'Refusée', withdrawn: 'Retirée', done: 'Conclu', failed: 'Annulé' }[d.status] || ''}</span>`;
      return `<div class="prow" data-act="mgrdeal" data-v="${esc(d.id)}"><span class="ic">${buying ? '📥' : '📤'}</span><div class="pname"><b>${esc(d.name)}</b><small>${buying ? 'Achat à' : 'Vente à'} ${esc(nameOf(s, buying ? d.seller : d.buyer))} · ${money(d.fee)}${d.swapPid ? ` + ${esc(pname(s, d.swapPid))}` : ''}</small></div>${tag}</div>`;
    }).join('') : '<p class="muted" style="margin:6px 0 0;font-size:13px">Ouvrez la fiche d\'un joueur d\'un autre manager pour lui faire une offre. Vous pouvez aussi discuter avec tous les managers de la partie.</p>'}
  </div>`;
}

/** Discussion entre tous les managers de la partie. */
export function chatSheet(app) {
  const s = app.state;
  app.online.chatUnread = 0;
  const me = s.online.cur;
  const list = () => (s.online.chat || []).slice(-60).map((m) => `<div class="chat-msg ${m.uid === me ? 'me' : ''}"><small>${esc(m.name)} · ${new Date(m.at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</small><div>${esc(m.text)}</div></div>`).join('') || '<p class="muted">Aucun message pour l\'instant. Lancez la discussion !</p>';
  const html = () => `<h2>💬 Discussion de la partie</h2><div class="chat-list" id="chatlist">${list()}</div>
    <div class="row" style="gap:6px;margin-top:8px"><input id="chatin" class="grow" maxlength="400" placeholder="Votre message…" style="flex:1"><button class="btn primary" data-act="say">Envoyer</button></div>`;
  const scroll = () => { const el = h.body.querySelector('#chatlist'); if (el) el.scrollTop = el.scrollHeight; };
  const say = () => {
    const inp = h.body.querySelector('#chatin');
    const m = chatSay(s, inp.value);
    if (!m) return;
    app.online.room?.send({ t: 'chat', m });
    app.save();
    inp.value = '';
    h.body.querySelector('#chatlist').innerHTML = list(); scroll();
  };
  const h = app.sheet({ html: html(), onClose: () => { app.ui.chat = null; if (app.tab === 'home') app.render(); }, actions: { say } });
  h.body.querySelector('#chatin')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') say(); });
  scroll();
  app.ui.chat = { refresh: () => { const el = h.body.querySelector('#chatlist'); if (el) { el.innerHTML = list(); scroll(); } } };
}
