/**
 * Négociations : 1) indemnité avec le club vendeur (offres / contre-offres),
 * 2) contrat avec le joueur et son agent (salaire, durée, prime, clause libératoire).
 */
import { gameRng, clubById } from '../../game/state.js';
import { money, playerValue } from '../../game/economy.js';
import { setSellOn, startNegotiation, clubRespond, playerDemands, evaluateContract, completeTransfer, completeRenewal, playerInterest, sellerAccepts, PROMISE_ROLES, roleAcceptable } from '../../game/transfers.js';
import { userClub } from '../../game/state.js';
import { ensureBoard, wageRoom } from '../../game/board.js';
import { esc } from '../components.js';
import { BAL } from '../../data/balance.js';
import { relAdd, sellPolicy } from '../../game/relations.js';

const step25k = (v) => Math.max(0, Math.round(v / 25000) * 25000);

/** Achat : négociation avec le club (si le joueur est sous contrat) puis contrat. */
export function negotiateTransfer(app, pid, onDone) {
  const s = app.state;
  const p = s.players[pid];
  // Le joueur et son club veulent-ils seulement discuter ?
  const interest = playerInterest(s, p, userClub(s));
  if (!interest.ok) { app.toast(interest.reason, 3500); return; }
  const pol = sellPolicy(s, p, userClub(s));
  if (!pol.ok) return refusalSheet(app, pid, pol, onDone);
  if (!sellerAccepts(s, p, userClub(s))) { app.toast(`${clubById(s, p.clubId).name} refuse de vendre un titulaire à un club moins prestigieux.`, 3500); return; }
  if (pol.reason) app.toast(pol.reason, 4000);
  if (!p.clubId) return negotiateContract(app, pid, 0, onDone);
  const neg = startNegotiation(s, pid, gameRng(s));
  let offer = step25k(neg.asking * 0.85);
  let log = [];
  const club = clubById(s, p.clubId);
  const html = () => `<h2>Négociation · ${esc(p.name)}</h2>
    <p class="muted" style="margin:0 0 4px">Votre budget transferts : <b>${money(ensureBoard(s).transferBudget)}</b></p>
    <p class="muted" style="margin-top:0">${esc(club.name)} demande <b>${money(neg.asking)}</b> · patience ${'●'.repeat(Math.max(0, neg.patience))}${'○'.repeat(Math.max(0, 3 - neg.patience))}</p>
    <div class="card" style="margin-top:0">
      <div class="row between"><span>Votre offre</span><b class="big" style="font-size:22px">${money(offer)}</b></div>
      <input type="range" data-act="fee" min="${step25k(neg.asking * 0.5)}" max="${step25k(neg.asking * 1.3)}" step="25000" value="${offer}">
      <div class="btns"><button class="btn sm" data-act="d" data-v="-100000">−100 k</button><button class="btn sm" data-act="d" data-v="-25000">−25 k</button>
        <button class="btn sm" data-act="d" data-v="25000">+25 k</button><button class="btn sm" data-act="d" data-v="100000">+100 k</button></div>
      <div class="formrow"><span>% à la revente (vendeur)</span><select data-act="sellon">${[0, 0.1, 0.2].map((k) => `<option value="${k}" ${neg.sellOn === k ? 'selected' : ''}>${k ? `${k * 100} % (prix plancher plus bas)` : 'Aucun'}</option>`).join('')}</select></div>
      <div class="formrow"><span>Paiement</span><select data-act="plan"><option value="cash" ${neg.plan !== 'inst' ? 'selected' : ''}>Comptant</option><option value="inst" ${neg.plan === 'inst' ? 'selected' : ''}>Échelonné : 40 % maintenant, 30 % + 30 % les deux saisons suivantes</option></select></div>
      ${neg.plan === 'inst' ? `<small class="muted">Le vendeur réclame environ 5 % de plus pour être payé en plusieurs fois. Versement immédiat : <b>${money(Math.round(offer * 0.4 / 25000) * 25000)}</b>.</small>` : ''}
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
      sellon: (el) => { setSellOn(neg, +el.value); if (neg.plan === 'inst') neg.min = Math.round(neg.min * 1.05 / 25000) * 25000; },
      plan: (el) => { if (el.tagName !== 'SELECT') return; neg.plan = el.value; setSellOn(neg, neg.sellOn); if (neg.plan === 'inst') neg.min = Math.round(neg.min * 1.05 / 25000) * 25000; h.update(html()); },
      d: (el) => { offer = step25k(offer + +el.dataset.v); h.update(html()); },
      send: () => {
        const r = clubRespond(neg, offer);
        log.push({ icon: r.kind === 'accept' ? '✅' : r.kind === 'counter' ? '↩' : '❌', text: `${money(offer)} → ${r.msg}` });
        h.update(html());
      },
      takecounter: () => { offer = neg.counter; const r = clubRespond(neg, offer); log.push({ icon: '✅', text: r.msg }); h.update(html()); },
      contract: () => { h.close(); negotiateContract(app, pid, neg.fee, onDone, false, neg.sellOn, neg.plan); },
    },
  });
}

/** Contrat (recrue si fee != null, sinon prolongation via renew=true). */
export function negotiateContract(app, pid, fee, onDone, renew = false, sellOn = 0, plan = 'cash') {
  const s = app.state;
  const p = s.players[pid];
  const dem = playerDemands(s, p, gameRng(s));
  const offer = { wage: Math.round(dem.wage * 0.9 / 100) * 100, years: p.age >= 30 ? 2 : 3, bonus: 0, clause: 0, goalBonus: 0, role: p.promise?.role || 'rotation' };
  let log = [];
  let done = false;
  const val = playerValue(p);
  const html = () => `<h2>${renew ? 'Prolongation' : 'Contrat'} · ${esc(p.name)}</h2>
    <p class="muted" style="margin:0 0 4px">Marge salariale du CA : <b>${money(Math.max(0, wageRoom(s)))}/sem</b></p>
    ${dem.agent ? `<p class="muted" style="margin:0 0 4px">Agent : <b>${esc(dem.agent.name)}</b> (${dem.agent.label})${dem.minBonus ? ` · exige une prime ≥ ${money(dem.minBonus)}` : ''}</p>` : ''}
    <p class="muted" style="margin-top:0">Son agent attend environ <b>${money(Math.round(dem.wage * PROMISE_ROLES[offer.role].wage / 100) * 100)}/sem</b> pour ce statut${renew ? '' : ` · commission ${Math.round(dem.agentFeeRate * 100)} %${fee ? ` de l'indemnité (${money(fee)})` : ''}`}.</p>
    <div class="card" style="margin-top:0">
      <div class="formrow"><span>Salaire / sem</span><b>${money(offer.wage)}</b></div>
      <div class="btns"><button class="btn sm" data-act="w" data-v="-1000">−1 k</button><button class="btn sm" data-act="w" data-v="-100">−100</button><button class="btn sm" data-act="w" data-v="100">+100</button><button class="btn sm" data-act="w" data-v="1000">+1 k</button></div>
      <div class="formrow"><span>Statut promis</span><select data-act="role">${Object.entries(PROMISE_ROLES).map(([k, r]) => `<option value="${k}" ${k === offer.role ? 'selected' : ''}>${r.label} (${Math.round(r.share * 100)} % du temps de jeu)</option>`).join('')}</select></div>
      <div class="formrow"><span>Durée</span><select data-act="years">${[1, 2, 3, 4, 5].map((y) => `<option value="${y}" ${y === offer.years ? 'selected' : ''}>${y} an(s)</option>`).join('')}</select></div>
      <div class="formrow"><span>Prime à la signature</span><select data-act="bonus">${[0, 10, 20, 40].map((k) => `<option value="${k}" ${offer.bonus === Math.round(dem.wage * k) ? 'selected' : ''}>${k ? money(Math.round(dem.wage * k)) : 'Aucune'}</option>`).join('')}</select></div>
      <div class="formrow"><span>Prime de but</span><select data-act="gbonus">${[0, 2000, 5000, 10000].map((k) => `<option value="${k}" ${offer.goalBonus === k ? 'selected' : ''}>${k ? money(k) : 'Aucune'}</option>`).join('')}</select></div>
      <div class="formrow"><span>Clause libératoire</span><select data-act="clause">${[0, 1.3, 2, 3].map((k) => `<option value="${k}" ${offer.clause === step25k(val * k) ? 'selected' : ''}>${k ? money(step25k(val * k)) : 'Aucune'}</option>`).join('')}</select></div>
      <p class="muted" style="font-size:12px;margin:6px 0 0">Le statut promis vous engage : un joueur qui ne joue pas assez sera mécontent, puis réclamera son départ. Une prime ou une clause basse permet de baisser le salaire.</p>
    </div>
    ${log.map((l) => `<div class="msg"><span class="ic">${l.icon}</span><div class="grow">${esc(l.text)}</div></div>`).join('')}
    ${done ? '<button class="btn primary block" data-act="close">Terminer</button>'
      : `<div class="btns"><button class="btn" data-act="close">Abandonner</button><button class="btn primary" data-act="propose">Proposer</button></div>`}`;
  const h = app.sheet({
    html,
    actions: {
      w: (el) => { offer.wage = Math.max(500, offer.wage + +el.dataset.v); h.update(html()); },
      years: (el) => { offer.years = +el.value; },
      role: (el) => { offer.role = el.value; h.update(html()); },
      bonus: (el) => { offer.bonus = Math.round(dem.wage * +el.value); },
      clause: (el) => { offer.clause = step25k(val * +el.value); },
      gbonus: (el) => { offer.goalBonus = +el.value; },
      propose: () => {
        const ra = roleAcceptable(s, p, offer.role);
        if (!ra.ok) { log.push({ icon: '❌', text: ra.msg }); h.update(html()); return; }
        const r = evaluateContract(p, dem, offer);
        if (r.kind === 'accept') {
          const res = renew ? completeRenewal(s, pid, offer) : completeTransfer(s, pid, fee || 0, offer, dem, sellOn, plan);
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

/** Refus du club vendeur : raison lisible + alternatives (intermédiaire, attendre la fin de contrat). */
function refusalSheet(app, pid, pol, onDone) {
  const s = app.state;
  const p = s.players[pid];
  const from = clubById(s, p.clubId);
  const canMiddle = pol.kind === 'rival' || pol.kind === 'alliance';
  const fee = step25k(playerValue(p) * 1.3 * (1 + BAL.rivals.intermediaryFee));
  const h = app.sheet({
    html: `<h2>❌ Refus de ${esc(from.name)}</h2><p>${esc(pol.reason)}</p>
      ${canMiddle ? `<div class="card"><b>Passer par un club intermédiaire</b><p class="muted" style="margin:4px 0">Un club tiers achète puis vous revend le joueur : ${money(fee)} (commission ${Math.round(BAL.rivals.intermediaryFee * 100)} % incluse). Risque que la manœuvre soit éventée : ${Math.round(BAL.rivals.intermediaryCaught * 100)} %.</p>
        <button class="btn primary block" data-act="middle">Tenter le coup</button></div>` : ''}
      <p class="muted" style="font-size:12px">${p.contract <= 1 ? `Son contrat se termine en fin de saison : il pourrait devenir libre.` : `Contrat jusqu'à dans ${p.contract} an(s). Patience…`}</p>
      <button class="btn block" data-act="close">Fermer</button>`,
    actions: {
      middle: () => {
        h.close();
        if (Math.random() < BAL.rivals.intermediaryCaught) {
          relAdd(s, from.id, userClub(s).id, -20);
          s.coach.media = Math.max(0, (s.coach.media ?? 50) - 3);
          app.save(); app.toast(`La manœuvre est éventée : ${from.name} est furieux.`, 3500); return;
        }
        negotiateContract(app, pid, fee, onDone);
      },
    },
  });
}
