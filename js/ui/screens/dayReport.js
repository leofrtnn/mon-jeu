/**
 * "Gestion rapide" après une journée : résultat, autres scores, blessures,
 * finances, offres de transfert en attente.
 */
import { clubById, userClub } from '../../game/state.js';
import { money } from '../../game/economy.js';
import { sellPlayer } from '../../game/transfers.js';
import { overall } from '../../engine/ratings.js';
import { esc, crest , ovrChip } from '../components.js';

export function showDayReport(app, report) {
  const s = app.state;
  const uc = userClub(s);
  const offers = (s.pendingOffers || []).filter((o) => s.players[o.pid]?.clubId === uc.id);
  const res = (r) => {
    if (r.comp === 'intl') return `<div class="row" style="padding:6px 0;border-bottom:1px solid var(--line)"><span class="grow" style="text-align:right">${esc(r.h)}</span><b class="num" style="min-width:50px;text-align:center">${r.s[0]} - ${r.s[1]}</b><span class="grow">${esc(r.a)}</span></div>`;
    const h = clubById(s, r.h), a = clubById(s, r.a);
    const me = r.h === uc.id || r.a === uc.id;
    return `<div class="row" style="padding:6px 0;border-bottom:1px solid var(--line);${me ? 'font-weight:700' : ''}">
      <span class="grow" style="text-align:right">${esc(h.short)}</span>${crest(h, 'sm')}
      <b class="num" style="min-width:50px;text-align:center">${r.s[0]} - ${r.s[1]}</b>
      ${crest(a, 'sm')}<span class="grow">${esc(a.short)}${r.pens ? ` <small>(${r.pens[0]}-${r.pens[1]} tab)</small>` : ''}</span></div>`;
  };
  const results = report.results.filter((r) => (r.comp === 'league' && r.div === uc.div) || (r.comp === 'cup' && r.key === uc.country) || r.comp === 'conti' || r.comp === 'intl');
  const html = () => `<h2>${esc(report.label)}</h2>
    <p class="muted" style="margin-top:0">Gestion rapide</p>
    ${report.injuries.length || report.suspensions.length ? `<div class="card"><h3>Infirmerie & discipline</h3>
      ${report.injuries.map((i) => `<div>✚ <b>${esc(i.name)}</b> <small>${esc(i.what)} · ${i.days} match(s)</small></div>`).join('')}
      ${report.suspensions.map((i) => `<div>🟥 <b>${esc(i.name)}</b> <small>suspendu ${i.games} match(s)</small></div>`).join('')}</div>` : ''}
    <div class="card"><h3>Finances de la journée</h3>
      <div class="row between"><span>Bilan</span><b class="${report.finance >= 0 ? 'pos-txt' : 'neg-txt'}">${report.finance >= 0 ? '+' : ''}${money(report.finance)}</b></div>
      ${report.attendance ? `<small>${report.attendance.toLocaleString('fr-FR')} spectateurs à domicile</small>` : ''}
      <div class="row between" style="margin-top:6px"><span>Budget</span><b>${money(uc.budget)}</b></div></div>
    ${offers.length ? `<div class="card"><h3>Offres reçues</h3>${offers.map((o) => {
      const p = s.players[o.pid]; const c = clubById(s, o.clubId);
      return `<div class="row" style="padding:6px 0"><div class="grow"><b>${esc(p.name)}</b> ${ovrChip(overall(p))}<br><small>${esc(c.name)} · ${money(o.amount)}</small></div>
        <button class="btn sm" data-act="decline" data-id="${p.id}">Refuser</button><button class="btn sm primary" data-act="accept" data-id="${p.id}">Accepter</button></div>`;
    }).join('')}</div>` : ''}
    ${report.callups.length ? `<div class="card"><h3>🌍 Vos internationaux</h3><small>${report.callups.map(esc).join(', ')}</small></div>` : ''}
    <div class="card"><h3>Résultats</h3>${results.map(res).join('')}</div>
    <button class="btn primary lg block" data-act="close">Continuer</button>`;
  const h = app.sheet({
    html,
    actions: {
      accept: (el) => {
        const o = s.pendingOffers.find((x) => x.pid === +el.dataset.id);
        const r = sellPlayer(s, o);
        app.toast(r.msg); app.save(); h.update(html()); app.render();
      },
      decline: (el) => {
        s.pendingOffers = s.pendingOffers.filter((x) => x.pid !== +el.dataset.id);
        app.save(); h.update(html());
      },
    },
  });
}

/** Feuille d'une offre précise (depuis un message). */
export function showOffer(app, pid) {
  const s = app.state;
  const o = (s.pendingOffers || []).find((x) => x.pid === pid);
  const p = s.players[pid];
  if (!o || !p || p.clubId !== s.userClubId) { app.toast('Cette offre a expiré.'); app.render(); return; }
  const c = clubById(s, o.clubId);
  const h = app.sheet({
    html: `<h2>Offre pour ${esc(p.name)}</h2>
      <p>${esc(c.name)} propose <b>${money(o.amount)}</b>.<br><small>Valeur estimée : ${money(p.value)} · Niveau ${ovrChip(overall(p))} · ${p.age} ans</small></p>
      <div class="btns"><button class="btn" data-act="no">Refuser</button><button class="btn" data-act="yeson">Accepter −10 % avec 15 % à la revente</button><button class="btn primary" data-act="yes">Accepter</button></div>`,
    actions: {
      yes: () => { const r = sellPlayer(s, o); app.toast(r.msg); app.save(); h.close(); app.render(); },
      yeson: () => { o.amount = Math.round(o.amount * 0.9 / 25000) * 25000; o.sellOn = 0.15; const r = sellPlayer(s, o); app.toast(r.msg); app.save(); h.close(); app.render(); },
      no: () => { s.pendingOffers = s.pendingOffers.filter((x) => x !== o); app.save(); h.close(); app.render(); },
    },
  });
}
