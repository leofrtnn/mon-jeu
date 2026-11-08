/**
 * Négociations : 1) indemnité avec le club vendeur (offres / contre-offres),
 * 2) contrat avec le joueur et son agent (salaire, durée, prime, clause libératoire).
 */
import { gameRng, clubById } from '../../game/state.js';
import { money, playerValue } from '../../game/economy.js';
import { startNegotiation, clubRespond, playerDemands, evaluateContract, completeTransfer, completeRenewal } from '../../game/transfers.js';
import { esc } from '../components.js';

const step25k = (v) => Math.max(0, Math.round(v / 25000) * 25000);

/** Achat : négociation avec le club (si le joueur est sous contrat) puis contrat. */
export function negotiateTransfer(app, pid, onDone) {
  const s = app.state;
  const p = s.players[pid];
  if (!p.clubId) return negotiateContract(app, pid, 0, onDone);
  const neg = startNegotiation(s, pid, gameRng(s));
  let offer = step25k(neg.asking * 0.85);
  let log = [];
  const club = clubById(s, p.clubId);
  const html = () => `<h2>Négociation · ${esc(p.name)}</h2>
    <p class="muted" style="margin-top:0">${esc(club.name)} demande <b>${money(neg.asking)}</b> · patience ${'●'.repeat(Math.max(0, neg.patience))}${'○'.repeat(Math.max(0, 3 - neg.patience))}</p>
    <div class="card" style="margin-top:0">
      <div class="row between"><span>Votre offre</span><b class="big" style="font-size:22px">${money(offer)}</b></div>
      <input type="range" data-act="fee" min="${step25k(neg.asking * 0.5)}" max="${step25k(neg.asking * 1.3)}" step="25000" value="${offer}">
      <div class="btns"><button class="btn sm" data-act="d" data-v="-100000">−100 k</button><button class="btn sm" data-act="d" data-v="-25000">−25 k</button>
        <button class="btn sm" data-act="d" data-v="25000">+25 k</button><button class="btn sm" data-act="d" data-v="100000">+100 k</button></div>
    </div>
    ${log.map((l) => `<div class="msg"><span class="ic">${l.icon}</span><div class="grow">${esc(l.text)}</div></div>`).join('')}
    ${neg.status === 'open' ? `<div class="btns" style="margin-top:10px"><button class="btn" data-act="close">Abandonner</button><button class="btn primary" data-act="send">Faire l'offre</button></div>
      ${neg.counter ? `<button class="btn block" style="margin-top:8px" data-act="takecounter">Accepter la contre-proposition (${money(neg.counter)})</button>` : ''}`
    : neg.status === 'accepted' ? `<button class="btn primary lg block" style="margin-top:10px" data-act="contract">Négocier le contrat ▸</button>`
      : '<button class="btn block" style="margin-top:10px" data-act="close">Fermer</button>'}`;
  const h = app.sheet({
    html,
    actions: {
      fee: (el) => { offer = +el.value; h.update(html()); },
      d: (el) => { offer = step25k(offer + +el.dataset.v); h.update(html()); },
      send: () => {
        const r = clubRespond(neg, offer);
        log.push({ icon: r.kind === 'accept' ? '✅' : r.kind === 'counter' ? '↩' : '❌', text: `${money(offer)} → ${r.msg}` });
        h.update(html());
      },
      takecounter: () => { offer = neg.counter; const r = clubRespond(neg, offer); log.push({ icon: '✅', text: r.msg }); h.update(html()); },
      contract: () => { h.close(); negotiateContract(app, pid, neg.fee, onDone); },
    },
  });
}

/** Contrat (recrue si fee != null, sinon prolongation via renew=true). */
export function negotiateContract(app, pid, fee, onDone, renew = false) {
  const s = app.state;
  const p = s.players[pid];
  const dem = playerDemands(s, p, gameRng(s));
  const offer = { wage: Math.round(dem.wage * 0.9 / 100) * 100, years: p.age >= 30 ? 2 : 3, bonus: 0, clause: 0 };
  let log = [];
  let done = false;
  const val = playerValue(p);
  const html = () => `<h2>${renew ? 'Prolongation' : 'Contrat'} · ${esc(p.name)}</h2>
    <p class="muted" style="margin-top:0">Son agent attend environ <b>${money(dem.wage)}/sem</b>${renew ? '' : ` · commission ${Math.round(dem.agentFeeRate * 100)} %${fee ? ` de l'indemnité (${money(fee)})` : ''}`}.</p>
    <div class="card" style="margin-top:0">
      <div class="formrow"><span>Salaire / sem</span><b>${money(offer.wage)}</b></div>
      <div class="btns"><button class="btn sm" data-act="w" data-v="-1000">−1 k</button><button class="btn sm" data-act="w" data-v="-100">−100</button><button class="btn sm" data-act="w" data-v="100">+100</button><button class="btn sm" data-act="w" data-v="1000">+1 k</button></div>
      <div class="formrow"><span>Durée</span><select data-act="years">${[1, 2, 3, 4, 5].map((y) => `<option value="${y}" ${y === offer.years ? 'selected' : ''}>${y} an(s)</option>`).join('')}</select></div>
      <div class="formrow"><span>Prime à la signature</span><select data-act="bonus">${[0, 10, 20, 40].map((k) => `<option value="${k}" ${offer.bonus === Math.round(dem.wage * k) ? 'selected' : ''}>${k ? money(Math.round(dem.wage * k)) : 'Aucune'}</option>`).join('')}</select></div>
      <div class="formrow"><span>Clause libératoire</span><select data-act="clause">${[0, 1.3, 2, 3].map((k) => `<option value="${k}" ${offer.clause === step25k(val * k) ? 'selected' : ''}>${k ? money(step25k(val * k)) : 'Aucune'}</option>`).join('')}</select></div>
      <p class="muted" style="font-size:12px;margin:6px 0 0">Une prime ou une clause basse permet de baisser le salaire… mais une clause basse peut être levée par un club rival.</p>
    </div>
    ${log.map((l) => `<div class="msg"><span class="ic">${l.icon}</span><div class="grow">${esc(l.text)}</div></div>`).join('')}
    ${done ? '<button class="btn primary block" data-act="close">Terminer</button>'
      : `<div class="btns"><button class="btn" data-act="close">Abandonner</button><button class="btn primary" data-act="propose">Proposer</button></div>`}`;
  const h = app.sheet({
    html,
    actions: {
      w: (el) => { offer.wage = Math.max(500, offer.wage + +el.dataset.v); h.update(html()); },
      years: (el) => { offer.years = +el.value; },
      bonus: (el) => { offer.bonus = Math.round(dem.wage * +el.value); },
      clause: (el) => { offer.clause = step25k(val * +el.value); },
      propose: () => {
        const r = evaluateContract(p, dem, offer);
        if (r.kind === 'accept') {
          const res = renew ? completeRenewal(s, pid, offer) : completeTransfer(s, pid, fee || 0, offer, dem);
          log.push({ icon: res.ok ? '✍' : '⚠', text: res.msg });
          done = true;
          app.toast(res.msg);
          if (res.ok) { app.save(); onDone?.(); app.render(); }
        } else {
          log.push({ icon: r.kind === 'counter' ? '↩' : '❌', text: r.msg });
          if (r.kind === 'end') done = true;
        }
        h.update(html());
      },
    },
  });
}
