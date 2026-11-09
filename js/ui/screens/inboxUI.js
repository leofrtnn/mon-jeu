/**
 * Boîte de réception unique (Accueil) : ouverture des messages, décisions à 2-4 choix,
 * interviews et conférences, bonnes affaires des clubs en crise.
 */
import { clubById, userClub, clubPlayers } from '../../game/state.js';
import { resolveDecision, EFFECT_LABELS } from '../../game/inbox.js';
import { answerInterview, answerConference, STYLES, STYLE_LABELS } from '../../game/press.js';
import { BAL } from '../../data/balance.js';
import { overall } from '../../engine/ratings.js';
import { money } from '../../game/economy.js';
import { askingPrice } from '../../game/transfers.js';
import { esc, crest } from '../components.js';

/** Ligne de message (accueil ou « Voir tout »). */
export function msgRow(m) {
  const open = m.decision && !m.decision.done;
  return `<div class="msg p${m.prio}${open ? ' dec' : ''}" data-act="msg" data-id="${m.id}" style="${m.read && !open ? 'opacity:.6' : ''}">
    <span class="ic">${m.icon}</span><div class="grow"><b>${esc(m.title)}</b>${open ? ' <span class="tag ok" style="font-size:10px">À décider</span>' : ''}<br><small>${esc(m.text)}</small></div></div>`;
}

/** Récapitulatif d'effets (affiché seulement APRÈS le choix). */
export function effectsHtml(e) {
  if (!e) return '';
  const rows = Object.entries(e).filter(([k, v]) => v && EFFECT_LABELS[k]).map(([k, v]) => {
    const good = k === 'rival' || k === 'opp' ? v < 0 : v > 0;
    return `<span class="tag ${good ? 'good' : 'bad'}" style="margin:2px">${EFFECT_LABELS[k]} ${v > 0 ? '+' : ''}${Math.round(v * 10) / 10}</span>`;
  });
  return rows.length ? `<div style="display:flex;flex-wrap:wrap;margin-top:8px">${rows.join('')}</div>` : '';
}

/** Ouvre un message. Retourne true si une feuille a été ouverte. */
export function openMessage(app, m, legacy) {
  const s = app.state;
  m.read = true;
  if (m.decision && !m.decision.done) {
    if (m.decision.kind === 'interview') { openInterview(app, m); return; }
    return decisionSheet(app, m);
  }
  if (m.action?.type === 'crisis') return crisisSheet(app, m.action.clubId);
  if (m.action?.type === 'interview') { if (s.life?.interview?.qs.some((q) => !q.done)) return openInterview(app, null); app.toast('Interview terminée.'); return; }
  app.save();
  legacy?.(m);
}

function decisionSheet(app, m) {
  const s = app.state;
  const d = m.decision;
  const h = app.sheet({
    html: `<div class="row" style="gap:10px"><span style="font-size:30px">${m.icon}</span><h2 style="margin:0">${esc(m.title)}</h2></div>
      <p>${esc(m.text)}</p>
      <div class="btns" style="flex-direction:column">${d.choices.map((c) => `<button class="btn block lg" data-act="pick" data-v="${c.key}">${esc(c.label)}</button>`).join('')}</div>
      <p class="muted" style="font-size:12px">Réponse attendue avant la journée ${d.expires + 1}.</p>`,
    actions: {
      pick: (el) => {
        const r = resolveDecision(s, m.id, el.dataset.v);
        app.save();
        if (r.open?.type === 'renew') { h.close(); import('./negotiation.js').then((mod) => mod.negotiateContract(app, r.open.pid, null, () => app.render(), true)); return; }
        if (r.open?.type === 'home') { h.close(); app.go('home'); app.toast(r.msg, 3500); return; }
        h.update(`<h2>${m.icon} ${esc(m.title)}</h2><p>${esc(r.msg)}</p>${effectsHtml(r.effects)}<button class="btn primary block" data-act="close" style="margin-top:12px">OK</button>`);
        app.render();
      },
    },
  });
  return h;
}

/** Interview d'après-match ou conférence : une carte par question, 4 gros boutons. */
export function openInterview(app, m) {
  const s = app.state;
  const iv = s.life?.interview;
  if (!iv) { app.toast('Les journalistes sont partis.'); return; }
  if (m && m.decision && !m.decision.done) { resolveDecision(s, m.id, 'open'); m.action = { type: 'interview' }; }
  const pre = iv.kind === 'pre';
  const opp = clubById(s, iv.opp);
  let qi = iv.qs.findIndex((q) => !q.done);
  let last = null;
  const html = () => {
    if (qi < 0) {
      return `<h2>${pre ? '🎙 Conférence terminée' : '🎤 Interview terminée'}</h2>
        ${iv.qs.map((q) => `<div class="card" style="margin:6px 0"><small class="muted">${esc(q.text)}</small><br><b>${q.done === 'skip' ? 'Sans réponse' : `« ${esc(q.answers[q.done])} »`}</b>${effectsHtml(q.effects)}</div>`).join('')}
        <button class="btn primary block" data-act="close">Terminer</button>`;
    }
    const q = iv.qs[qi];
    if (last) {
      return `<small class="muted">${esc(iv.journalist.name)} · ${esc(iv.journalist.outlet)}</small>
        <h2 style="font-size:17px">« ${esc(q.text)} »</h2>
        <div class="card"><b>${q.done === 'skip' ? 'Pas de réponse.' : `« ${esc(q.answers[q.done])} »`}</b><p style="margin:6px 0 0">${esc(last.text)}</p>${effectsHtml(last.effects)}</div>
        <button class="btn primary block lg" data-act="next">${iv.qs.findIndex((x) => !x.done) < 0 ? 'Terminer' : 'Question suivante ▸'}</button>`;
    }
    return `<div class="row" style="gap:10px">${crest(opp, 'sm')}<small class="muted">${pre ? 'Avant le match contre' : 'Après le match contre'} ${esc(opp.name)} · question ${qi + 1}/${iv.qs.length}<br>${esc(iv.journalist.name)} (${esc(iv.journalist.outlet)}, ${BAL.press.journalists[iv.journalist.type].label})</small></div>
      <h2 style="font-size:18px;margin:10px 0">« ${esc(q.text)} »</h2>
      <div class="press-grid">${STYLES.map((st) => `<button class="btn press-btn" data-act="ans" data-v="${st}"><small>${STYLE_LABELS[st]}</small><br>${esc(q.answers[st])}</button>`).join('')}</div>
      <button class="btn ghost block" data-act="ans" data-v="skip" style="margin-top:8px">Ne pas répondre</button>`;
  };
  const h = app.sheet({
    html,
    actions: {
      ans: (el) => {
        last = (pre ? answerConference : answerInterview)(s, qi, el.dataset.v);
        app.save();
        h.update(html());
      },
      next: () => { last = null; qi = iv.qs.findIndex((q) => !q.done); h.update(html()); if (qi < 0) app.render(); },
    },
    onClose: () => app.render(),
  });
  return h;
}

/** Bonnes affaires d'un club en crise. */
function crisisSheet(app, clubId) {
  const s = app.state;
  const c = clubById(s, clubId);
  const ps = clubPlayers(s, c).filter((p) => !p.onLoanFrom).sort((a, b) => overall(b) - overall(a)).slice(0, 6);
  app.sheet({
    html: `<div class="row" style="gap:10px">${crest(c)}<div><h2 style="margin:0">${esc(c.name)} brade</h2><small class="muted">${c.crisis ? 'Club en crise financière' : 'La crise semble passée'}</small></div></div>
      <div class="list" style="margin-top:8px">${ps.map((p) => `<div class="prow" data-act="pl" data-id="${p.id}"><span class="posb">${p.pos}</span><div class="pname"><b>${esc(p.name)}</b><small>${p.age} ans · note ${overall(p)}</small></div><b>${money(askingPrice(s, p))}</b></div>`).join('')}</div>`,
    actions: { pl: (el) => import('./playerSheet.js').then((mod) => mod.showPlayer(app, +el.dataset.id)) },
  });
}

export { userClub };
