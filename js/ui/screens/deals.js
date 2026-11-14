/**
 * Écran d'un dossier de transfert : étapes (club → joueur → visite médicale → signature),
 * historique daté, formulaire de l'étape en cours ; une réponse se fait attendre.
 */
import { money, playerValue } from '../../game/economy.js';
import { clubById, userClub } from '../../game/state.js';
import { ensureBoard, wageRoom } from '../../game/board.js';
import { overall } from '../../engine/ratings.js';
import { PROMISE_ROLES } from '../../game/transfers.js';
import { openDeal, dealById, submitBid, submitLoan, submitTerms, acceptCounter, cancelDeal, medicalDecision, STAGE_LABEL, activeDeals, playerDecision } from '../../game/deals.js';
import { currentDate } from '../../game/dates.js';
import { esc, face, posBadge } from '../components.js';

const step25k = (v) => Math.max(0, Math.round(v / 25000) * 25000);
const dd = (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : '');

/** Ouvre (ou reprend) un dossier pour ce joueur. kind : buy | loan | renew */
export function openDealFlow(app, pid, kind = 'buy', onDone) {
  const r = openDeal(app.state, pid, kind);
  if (!r.ok) {
    const p = app.state.players[pid];
    if (r.dec) return refusalReasons(app, p, r);
    app.toast(r.msg, 4000); return;
  }
  app.save();
  dealSheet(app, r.deal.id, onDone);
}

function refusalReasons(app, p, r) {
  app.sheet({
    html: `<h2>❌ ${esc(p.name)} ne viendra pas</h2><p class="muted">Ses raisons, d'après son agent :</p>
      <div class="card">${r.dec.reasons.map((x) => `<div class="row between" style="padding:4px 0"><span>${esc(x.t)}</span><b class="${x.v >= 0 ? 'pos-txt' : 'neg-txt'}">${x.v > 0 ? '+' : ''}${x.v}</b></div>`).join('')}</div>
      <button class="btn block" data-act="close">Fermer</button>`,
    actions: {},
  });
}

const STEPS = { buy: ['club', 'player', 'medical', 'done'], loan: ['club', 'loanplayer', 'done'], renew: ['player', 'done'] };
const STEP_SHORT = { club: 'Club', player: 'Joueur', loanplayer: 'Joueur', medical: 'Médical', done: 'Signé' };

export function dealSheet(app, id, onDone) {
  const s = app.state;
  let form = null; // valeurs du formulaire de l'étape en cours
  const init = () => {
    const d = dealById(s, id), p = s.players[d.pid];
    if (d.stage === 'club' && d.kind === 'buy') form = { fee: step25k(d.counter || d.bid?.fee || d.neg.asking * 0.85), sellOn: d.bid?.sellOn || 0, plan: d.bid?.plan || 'cash' };
    else if (d.stage === 'club' && d.kind === 'loan') form = { ...(d.counterLoan || d.loan || { fee: step25k(d.loanAsk.fee * 0.7), share: Math.max(0.5, d.loanAsk.share - 0.2), option: 0 }) };
    else if (d.stage === 'player' && d.dem) form = d.terms ? { ...d.terms } : { wage: Math.round(d.dem.wage * 0.9 / 100) * 100, years: p.age >= 30 ? 2 : d.kind === 'renew' ? 3 : 4, bonus: 0, clause: 0, goalBonus: 0, role: p.promise?.role || 'rotation' };
    else if (d.stage === 'loanplayer') form = { role: 'rotation' };
    else form = null;
    _form = form;
  };
  init();
  const html = () => {
    const d = dealById(s, id), p = s.players[d.pid];
    const from = d.from ? clubById(s, d.from) : null;
    const steps = STEPS[d.kind];
    const cur = d.stage === 'medfail' ? 'medical' : d.stage;
    const ci = steps.indexOf(cur);
    const stepper = `<div class="deal-steps">${steps.map((st, i) => `<span class="ds ${d.stage === 'dead' ? (i <= Math.max(0, ci) ? 'x' : '') : i < ci || d.stage === 'done' ? 'ok' : i === ci ? 'on' : ''}">${STEP_SHORT[st]}</span>`).join('<i></i>')}</div>`;
    const head = `<div class="row" style="gap:10px;margin-bottom:6px">${face(p, from, 'md')}<div class="grow"><h2 style="margin:0">${d.kind === 'renew' ? 'Prolongation' : d.kind === 'loan' ? 'Prêt' : 'Transfert'} · ${esc(p.name)}</h2>
      <small class="muted">${posBadge(p.pos)} ${p.age} ans · ${esc(p.nat || '')} · ${from && d.kind !== 'renew' ? esc(from.name) : d.kind === 'renew' ? `contrat : ${p.contract} an(s)` : 'Libre'} · valeur ${money(playerValue(p))}</small></div></div>`;
    const log = `<div class="deal-log">${d.log.slice().reverse().map((l) => `<div class="dl"><small>${dd(l.d)}</small><span>${l.icon}</span><span class="grow">${esc(l.text)}</span></div>`).join('')}</div>`;
    let body = '';
    if (d.pending) body = `<div class="card deal-wait"><div class="spin">⏳</div><div><b>${d.stage === 'medical' ? 'Visite médicale en cours' : 'En attente de réponse'}</b><br><small class="muted">Réponse attendue ${d.due === currentDate(s) ? 'aujourd\'hui (en fin de journée)' : `vers le ${dd(d.due)}`}. Continuez à jouer : vous serez prévenu dans vos messages.</small></div></div>`;
    else if (d.stage === 'club' && d.kind === 'buy') body = bidForm(s, d, p);
    else if (d.stage === 'club' && d.kind === 'loan') body = loanForm(s, d, p);
    else if (d.stage === 'player') body = termsForm(s, d, p);
    else if (d.stage === 'loanplayer') body = loanPlayerForm(s, d, p);
    else if (d.stage === 'medfail') body = `<div class="card"><b>🩺 ${esc(d.medNote)}</b><p class="muted" style="margin:6px 0">Vous pouvez signer quand même (son agent accepte un salaire réduit de 10 %) ou renoncer.</p>
      <div class="btns"><button class="btn" data-act="medno">Renoncer</button><button class="btn primary" data-act="medyes">Signer quand même</button></div></div>`;
    else if (d.stage === 'done') body = '<div class="card center"><b>✍ Dossier conclu.</b></div>';
    else body = '<div class="card center muted">Dossier clos.</div>';
    const decision = d.dec && d.stage !== 'done' && d.stage !== 'dead' ? `<details class="card"><summary><b>🧠 Ce qui compte pour lui</b> <small class="muted">attrait du projet ${d.dec.score > 0 ? '+' : ''}${d.dec.score}</small></summary>
      ${d.dec.reasons.map((x) => `<div class="row between" style="padding:3px 0;font-size:13px"><span>${esc(x.t)}</span><b class="${x.v >= 0 ? 'pos-txt' : 'neg-txt'}">${x.v > 0 ? '+' : ''}${x.v}</b></div>`).join('')}
      <small class="muted">Un projet peu attractif se paie : son agent demande davantage.</small></details>` : '';
    return `${head}${stepper}<p class="muted" style="margin:4px 2px 8px">${esc(STAGE_LABEL[d.stage])}${d.expires && (d.stage === 'player' || d.stage === 'loanplayer') ? ` · accord à trouver avant le ${dd(d.expires)}` : ''}</p>
      ${body}${decision}<div class="label">Historique</div>${log}
      <div class="btns" style="margin-top:10px">${d.stage !== 'done' && d.stage !== 'dead' ? '<button class="btn danger" data-act="cancel">Abandonner le dossier</button>' : ''}<button class="btn" data-act="close">Fermer</button></div>`;
  };
  const after = (r) => { if (r?.msg) app.toast(r.msg, 3500); app.save(); init(); h.update(html()); onDone?.(); };
  const h = app.sheet({
    html,
    actions: {
      fee: (el) => { form.fee = +el.value; h.update(html()); },
      d: (el) => { form.fee = step25k(form.fee + +el.dataset.v); h.update(html()); },
      sellon: (el) => { if (el.tagName === 'SELECT') form.sellOn = +el.value; },
      plan: (el) => { if (el.tagName === 'SELECT') { form.plan = el.value; h.update(html()); } },
      share: (el) => { form.share = +el.value / 100; h.update(html()); },
      option: (el) => { if (el.tagName === 'SELECT') form.option = +el.value; },
      lfee: (el) => { form.fee = +el.value; h.update(html()); },
      w: (el) => { form.wage = Math.max(500, form.wage + +el.dataset.v); h.update(html()); },
      years: (el) => { if (el.tagName === 'SELECT') form.years = +el.value; },
      role: (el) => { if (el.tagName === 'SELECT') { form.role = el.value; h.update(html()); } },
      bonus: (el) => { if (el.tagName === 'SELECT') form.bonus = +el.value; },
      clause: (el) => { if (el.tagName === 'SELECT') form.clause = +el.value; },
      gbonus: (el) => { if (el.tagName === 'SELECT') form.goalBonus = +el.value; },
      sendbid: () => after(submitBid(s, id, form)),
      sendloan: () => after(submitLoan(s, id, form)),
      sendterms: () => after(submitTerms(s, id, form)),
      takecounter: () => after(acceptCounter(s, id)),
      medyes: () => after(medicalDecision(s, id, true)),
      medno: () => after(medicalDecision(s, id, false)),
      cancel: async () => { if (await app.confirm('Abandonner ?', 'Le dossier sera clos.', 'Abandonner')) { cancelDeal(s, id); after(); } },
    },
  });
  return h;
}

function bidForm(s, d, p) {
  const f = (v) => money(v);
  const c = clubById(s, d.from);
  return `<div class="card" style="margin-top:0">
    <p class="muted" style="margin:0 0 6px">${esc(c.name)} demande environ <b>${f(d.neg.asking)}</b> · patience ${'●'.repeat(Math.max(0, d.neg.patience))}${'○'.repeat(Math.max(0, 3 - d.neg.patience))} · budget transferts ${f(ensureBoard(s).transferBudget)}</p>
    ${d.counter ? `<div class="msg"><span class="ic">↩</span><div class="grow">Contre-proposition : <b>${f(d.counter)}</b></div><button class="btn sm primary" data-act="takecounter">Accepter</button></div>` : ''}
    <div class="row between"><span>Votre offre</span><b class="big" style="font-size:22px">${f(dealForm(d).fee)}</b></div>
    <input type="range" data-act="fee" min="${step25k(d.neg.asking * 0.4)}" max="${step25k(d.neg.asking * 1.4)}" step="25000" value="${dealForm(d).fee}">
    <div class="btns"><button class="btn sm" data-act="d" data-v="-500000">−500 k</button><button class="btn sm" data-act="d" data-v="-100000">−100 k</button><button class="btn sm" data-act="d" data-v="100000">+100 k</button><button class="btn sm" data-act="d" data-v="500000">+500 k</button></div>
    <div class="formrow"><span>% à la revente (vendeur)</span><select data-act="sellon">${[0, 0.1, 0.2].map((k) => `<option value="${k}" ${dealForm(d).sellOn === k ? 'selected' : ''}>${k ? `${k * 100} %` : 'Aucun'}</option>`).join('')}</select></div>
    <div class="formrow"><span>Paiement</span><select data-act="plan"><option value="cash" ${dealForm(d).plan !== 'inst' ? 'selected' : ''}>Comptant</option><option value="inst" ${dealForm(d).plan === 'inst' ? 'selected' : ''}>Échelonné (40 % / 30 % / 30 %)</option></select></div>
    <button class="btn primary block" style="margin-top:8px" data-act="sendbid">Envoyer l'offre au club</button>
    <small class="muted">Le club répond sous 1 à 3 jours. Une offre trop basse use sa patience.</small></div>`;
}

let _form = null;
const dealForm = () => _form;

function loanForm(s, d, p) {
  const f = _form;
  return `<div class="card" style="margin-top:0">
    <p class="muted" style="margin:0 0 6px">Salaire du joueur : ${money(p.wage)}/sem · marge salariale ${money(Math.max(0, wageRoom(s)))}/sem${d.loanAsk.key ? ' · <b>joueur important pour son club</b>' : ''}</p>
    ${d.counterLoan ? `<div class="msg"><span class="ic">↩</span><div class="grow">Le club veut ${money(d.counterLoan.fee)} et ${Math.round(d.counterLoan.share * 100)} % du salaire.</div><button class="btn sm primary" data-act="takecounter">Accepter</button></div>` : ''}
    <div class="row between"><span>Indemnité de prêt</span><b>${money(f.fee)}</b></div>
    <input type="range" data-act="lfee" min="0" max="${step25k(playerValue(p) * 0.25)}" step="25000" value="${f.fee}">
    <div class="row between"><span>Salaire pris en charge</span><b>${Math.round(f.share * 100)} % · ${money(Math.round(p.wage * f.share))}/sem</b></div>
    <input type="range" data-act="share" min="20" max="100" step="10" value="${Math.round(f.share * 100)}">
    <div class="formrow"><span>Option d'achat</span><select data-act="option">${[0, 1, 1.2, 1.5].map((k) => `<option value="${k ? step25k(playerValue(p) * k) : 0}" ${f.option === (k ? step25k(playerValue(p) * k) : 0) ? 'selected' : ''}>${k ? money(step25k(playerValue(p) * k)) : 'Aucune'}</option>`).join('')}</select></div>
    <button class="btn primary block" style="margin-top:8px" data-act="sendloan">Proposer le prêt</button></div>`;
}

function termsForm(s, d, p) {
  const f = _form, dem = d.dem, val = playerValue(p);
  return `<div class="card" style="margin-top:0">
    <p class="muted" style="margin:0 0 6px">${dem.agent ? `Agent : <b>${esc(dem.agent.name)}</b> (${dem.agent.label}) · ` : ''}attentes ≈ <b>${money(Math.round(dem.wage * PROMISE_ROLES[f.role].wage / 100) * 100)}/sem</b> pour ce statut · marge salariale ${money(Math.max(0, wageRoom(s) + (d.kind === 'renew' ? p.wage : 0)))}/sem${d.kind === 'renew' ? ` · actuel ${money(p.wage)}/sem` : ''}</p>
    <div class="formrow"><span>Salaire / sem</span><b>${money(f.wage)}</b></div>
    <div class="btns"><button class="btn sm" data-act="w" data-v="-5000">−5 k</button><button class="btn sm" data-act="w" data-v="-1000">−1 k</button><button class="btn sm" data-act="w" data-v="1000">+1 k</button><button class="btn sm" data-act="w" data-v="5000">+5 k</button></div>
    <div class="formrow"><span>Statut promis</span><select data-act="role">${Object.entries(PROMISE_ROLES).map(([k, r]) => `<option value="${k}" ${k === f.role ? 'selected' : ''}>${r.label} (${Math.round(r.share * 100)} % du temps de jeu)</option>`).join('')}</select></div>
    <div class="formrow"><span>Durée</span><select data-act="years">${[1, 2, 3, 4, 5].map((y) => `<option value="${y}" ${y === f.years ? 'selected' : ''}>${y} an(s)</option>`).join('')}</select></div>
    <div class="formrow"><span>Prime à la signature</span><select data-act="bonus">${[0, 10, 20, 40].map((k) => `<option value="${Math.round(dem.wage * k)}" ${f.bonus === Math.round(dem.wage * k) ? 'selected' : ''}>${k ? money(Math.round(dem.wage * k)) : 'Aucune'}</option>`).join('')}</select></div>
    <div class="formrow"><span>Prime de but</span><select data-act="gbonus">${[0, 2000, 5000, 10000].map((k) => `<option value="${k}" ${f.goalBonus === k ? 'selected' : ''}>${k ? money(k) : 'Aucune'}</option>`).join('')}</select></div>
    <div class="formrow"><span>Clause libératoire</span><select data-act="clause">${[0, 1.3, 2, 3].map((k) => `<option value="${k ? step25k(val * k) : 0}" ${f.clause === (k ? step25k(val * k) : 0) ? 'selected' : ''}>${k ? money(step25k(val * k)) : 'Aucune'}</option>`).join('')}</select></div>
    <button class="btn primary block" style="margin-top:8px" data-act="sendterms">Envoyer la proposition</button>
    <small class="muted">L'agent répond sous 1 à 2 jours. ${dem.tries} tentative(s) avant qu'il ne claque la porte.</small></div>`;
}

function loanPlayerForm(s, d, p) {
  return `<div class="card" style="margin-top:0"><p class="muted" style="margin:0 0 6px">${esc(p.name)} veut savoir combien il jouera.</p>
    <div class="formrow"><span>Temps de jeu promis</span><select data-act="role">${Object.entries(PROMISE_ROLES).map(([k, r]) => `<option value="${k}" ${k === _form.role ? 'selected' : ''}>${r.label} (${Math.round(r.share * 100)} %)</option>`).join('')}</select></div>
    <button class="btn primary block" style="margin-top:8px" data-act="sendterms">Lui présenter le projet</button></div>`;
}

/** Liste des dossiers (onglet mercato). */
export function dealsList(s) {
  const list = activeDeals(s);
  const done = (s.deals || []).filter((d) => d.stage === 'done' || d.stage === 'dead').slice(-8).reverse();
  const row = (d) => {
    const p = s.players[d.pid];
    if (!p) return '';
    return `<div class="row deal-row" data-act="deal" data-id="${d.id}">${face(p, d.from ? clubById(s, d.from) : null, 'sm')}<span class="grow"><b>${esc(p.name)}</b> <small class="muted">${d.kind === 'renew' ? 'prolongation' : d.kind === 'loan' ? 'prêt' : 'transfert'}</small><br>
      <small class="muted">${esc(STAGE_LABEL[d.stage])}${d.pending ? ` · réponse ~${dd(d.due)}` : d.stage === 'done' || d.stage === 'dead' ? '' : ' · <b style="color:var(--accent)">à vous de jouer</b>'}</small></span><small class="muted">${esc(d.log[d.log.length - 1]?.icon || '')}</small></div>`;
  };
  return `<div class="card list" style="padding:0 10px;margin-top:0">${list.map(row).join('') || '<p class="muted">Aucun dossier en cours. Ouvrez la fiche d\'un joueur puis « Faire une offre ».</p>'}</div>
    ${done.length ? `<div class="label">Récemment clos</div><div class="card list" style="padding:0 10px;margin-top:0;opacity:.75">${done.map(row).join('')}</div>` : ''}`;
}

// Le formulaire courant est partagé par les fonctions de rendu ci-dessus.
export function _bindForm(f) { _form = f; }
