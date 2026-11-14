/**
 * MESSAGERIE : boîte de réception du club + conversations privées avec les joueurs.
 *  - Onglet « Messages » : tous les messages (filtres : non lus, à décider).
 *  - Onglet « Joueurs » : un fil par joueur (bulles), réponses à choix quand un joueur attend
 *    une réponse, et « Écrire à… » pour lancer la discussion soi-même.
 */
import { userClub, clubPlayers } from '../../game/state.js';
import { thread, replyChat, writeChat, WRITE, TOPICS, unreadChats } from '../../game/chat.js';
import { esc, face, posBadge } from '../components.js';
import { msgRow, openMessage } from './inboxUI.js';
import { POSITIONS } from '../../data/constants.js';

export function openMailbox(app, { tab = 'msgs', pid = null, legacy = null } = {}) {
  const s = app.state;
  let cur = { tab, pid, filter: 'all', writing: false };
  const uc = () => userClub(s);
  const html = () => {
    const nChats = unreadChats(s);
    const nMsgs = (s.messages || []).filter((m) => !m.read).length;
    const tabs = `<div class="mb-tabs"><button class="chip ${cur.tab === 'msgs' ? 'on' : ''}" data-act="tab" data-v="msgs">📨 Messages${nMsgs ? ` <em class="nb">${nMsgs}</em>` : ''}</button>
      <button class="chip ${cur.tab === 'chats' ? 'on' : ''}" data-act="tab" data-v="chats">💬 Joueurs${nChats ? ` <em class="nb">${nChats}</em>` : ''}</button></div>`;
    if (cur.tab === 'msgs') {
      const ms = (s.messages || []).filter((m) => cur.filter === 'all' || (cur.filter === 'unread' ? !m.read : m.decision && !m.decision.done)).slice(0, 60);
      return `<h2>Messagerie</h2>${tabs}
        <div class="chips" style="margin:6px 0">${[['all', 'Tous'], ['unread', 'Non lus'], ['dec', 'À décider']].map(([k, l]) => `<button class="chip sm ${cur.filter === k ? 'on' : ''}" data-act="filter" data-v="${k}">${l}</button>`).join('')}</div>
        <div class="mb-list">${ms.map(msgRow).join('') || '<p class="muted">Aucun message.</p>'}</div>
        <button class="btn block" data-act="readall" style="margin-top:12px">Tout marquer comme lu</button>`;
    }
    if (cur.pid) return `<div class="chat-head"><button class="btn sm ghost" data-act="back">◂</button>${chatHead(s, cur.pid)}</div>${chatBody(s, cur.pid, cur.writing)}`;
    // Liste des conversations (fils actifs d'abord), puis tout l'effectif.
    const ps = clubPlayers(s, uc()).filter((p) => !p.onLoanFrom);
    const withT = ps.map((p) => ({ p, t: s.chats?.[p.id] })).sort((a, b) => (b.t?.pending ? 1 : 0) - (a.t?.pending ? 1 : 0) || (b.t?.unread || 0) - (a.t?.unread || 0) || (b.t?.last || -1) - (a.t?.last || -1) || POSITIONS.indexOf(a.p.pos) - POSITIONS.indexOf(b.p.pos));
    return `<h2>Messagerie</h2>${tabs}
      <p class="muted" style="font-size:12px;margin:6px 2px">Les joueurs vous écrivent quand quelque chose les préoccupe. Vous pouvez aussi leur écrire en premier.</p>
      <div class="mb-list">${withT.map(({ p, t }) => {
        const last = t?.msgs[t.msgs.length - 1];
        return `<div class="chat-row ${t?.unread ? 'unread' : ''}" data-act="open" data-id="${p.id}">${face(p, uc())}<div class="grow"><b>${esc(p.name)}</b> ${posBadge(p.pos)}${t?.pending ? ' <span class="tag ok" style="font-size:10px">Attend une réponse</span>' : ''}
          <small>${last ? `${last.from === 'me' ? 'Vous : ' : ''}${esc(last.text.slice(0, 70))}` : '<span class="muted">Écrire…</span>'}</small></div>${t?.unread ? '<em class="nb">●</em>' : ''}</div>`;
      }).join('')}</div>`;
  };
  const h = app.sheet({
    html,
    cls: 'mailbox',
    actions: {
      tab: (el) => { cur = { ...cur, tab: el.dataset.v, pid: null, writing: false }; h.update(html()); },
      filter: (el) => { cur.filter = el.dataset.v; h.update(html()); },
      readall: () => { s.messages.forEach((m) => (m.read = true)); app.save(); h.update(html()); app.render(); },
      msg: (el) => {
        const m = s.messages.find((x) => String(x.id) === el.dataset.id);
        if (!m) return;
        if (m.action?.type === 'chat') { m.read = true; cur = { ...cur, tab: 'chats', pid: m.action.pid }; markRead(); h.update(html()); app.save(); return; }
        h.close(); openMessage(app, m, legacy);
      },
      open: (el) => { cur.pid = +el.dataset.id; cur.writing = false; markRead(); h.update(html()); app.save(); app.render(); },
      back: () => { cur.pid = null; h.update(html()); },
      reply: (el) => {
        const r = replyChat(s, cur.pid, el.dataset.v);
        app.save(); h.update(html()); app.render();
        if (r.open === 'renew') import('./deals.js').then((mod) => mod.openDealFlow(app, cur.pid, 'renew', () => app.render()));
      },
      write: () => { cur.writing = !cur.writing; h.update(html()); },
      say: (el) => {
        const r = writeChat(s, cur.pid, el.dataset.v);
        if (r.ok === false && r.msg) app.toast(r.msg, 3000);
        cur.writing = false; app.save(); h.update(html()); app.render();
      },
      profile: () => import('./playerSheet.js').then((mod) => mod.showPlayer(app, cur.pid)),
    },
    onClose: () => app.render(),
  });
  function markRead() { const t = s.chats?.[cur.pid]; if (t) t.unread = 0; }
  if (pid) markRead();
  return h;
}

function chatHead(s, pid) {
  const p = s.players[pid];
  if (!p) return '';
  const mood = p.morale >= 70 ? '😀' : p.morale >= 50 ? '🙂' : p.morale >= 35 ? '😐' : '😠';
  return `${face(p, userClub(s))}<div class="grow"><b>${esc(p.name)}</b><small>${p.pos} · ${p.age} ans · moral ${mood} ${Math.round(p.morale)}</small></div><button class="btn sm" data-act="profile">Fiche</button>`;
}

function chatBody(s, pid, writing) {
  const t = thread(s, pid);
  const T = TOPICS[t.pending];
  const bubbles = t.msgs.map((m) => `<div class="bub ${m.from === 'me' ? 'me' : 'them'}">${esc(m.text)}${m.note ? `<small class="note">${esc(m.note)}</small>` : ''}<span class="when">J${m.day + 1}</span></div>`).join('');
  const replies = T ? `<div class="quick"><small class="muted">Votre réponse :</small>${T.replies.map((r) => `<button class="btn block" data-act="reply" data-v="${r.key}">${esc(r.label)}</button>`).join('')}</div>` : '';
  const write = !T ? (writing ? `<div class="quick"><small class="muted">Que voulez-vous lui dire ?</small>${Object.entries(WRITE).map(([k, l]) => `<button class="btn block" data-act="say" data-v="${k}">${esc(l)}</button>`).join('')}</div>`
    : '<button class="btn primary block" data-act="write" style="margin-top:10px">✍ Lui écrire</button>') : '';
  return `<div class="chat">${bubbles || '<p class="muted center" style="margin:30px 0">Aucun échange pour l\'instant.</p>'}</div>${replies}${write}`;
}
