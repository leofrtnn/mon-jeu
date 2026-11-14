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
import { CLUB_PROFILES, BUY_APPROACHES, CONTRACT_APPROACHES, swapCandidates, valueBid, valueContract, defaultTerms } from '../../game/negotiate.js';
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
    if (d.stage === 'club' && d.kind === 'buy') form = { fee: step25k(d.bid?.fee || d.neg.asking * 0.85), plan: 'cash', addon: 0, sellOn: 0, swapId: null, ...(d.bid || {}), approach: 'std' };
    else if (d.stage === 'club' && d.kind === 'loan') form = { ...(d.counterLoan || d.loan || { fee: step25k(d.loanAsk.fee * 0.7), share: Math.max(0.5, d.loanAsk.share - 0.2), option: 0 }) };
    else if (d.stage === 'player' && d.dem) form = { ...defaultTerms(p, d.dem, d.kind === 'renew'), ...(d.terms || {}), agreed: undefined, approach: 'std' };
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
      fv: (el) => { if (el.tagName !== 'SELECT' && el.tagName !== 'INPUT') return; const k = el.dataset.k; form[k] = el.dataset.t === 's' ? el.value || null : +el.value; if (k === 'swapId' && !el.value) form.swapId = null; h.update(html()); },
      st: (el) => { const k = el.dataset.k; form[k] = Math.max(0, Math.round((form[k] + +el.dataset.v) / 100) * 100); h.update(html()); },
      appr: (el) => { form.approach = el.dataset.v; h.update(html()); },
      sendbid: () => after(submitBid(s, id, form)),
      sendloan: () => after(submitLoan(s, id, form)),
      sendterms: () => after(submitTerms(s, id, form, form.approach || 'std')),
      takecounter: () => after(acceptCounter(s, id)),
      medyes: () => after(medicalDecision(s, id, true)),
      medno: () => after(medicalDecision(s, id, false)),
      cancel: async () => { if (await app.confirm('Abandonner ?', 'Le dossier sera clos.', 'Abandonner')) { cancelDeal(s, id); after(); } },
    },
  });
  return h;
}

/** Réponse détaillée de l'autre partie (point par point). */
function notesHtml(d) {
  if (!d.lastNotes?.length) return '';
  const ic = (ok) => (ok > 0 ? '✅' : ok < 0 ? '❌' : '➖');
  return `<div class="neg-notes">${d.lastNotes.map((n) => `<div><span>${ic(n.ok)}</span><b>${esc(n.k)}</b><small>${esc(n.t)}</small></div>`).join('')}</div>`;
}
const apprHtml = (list, cur) => `<div class="label">Approche</div><div class="appr">${Object.entries(list).map(([k, a]) => `<button class="${cur === k ? 'on' : ''}" data-act="appr" data-v="${k}"><b>${esc(a.label)}</b><small>${esc(a.desc)}</small></button>`).join('')}</div>`;
const PLAN = { cash: 'Comptant', inst: '40 % puis 2 saisons', inst3: '40 % puis 3 saisons' };

function bidForm(s, d, p) {
  const f = _form, M = money;
  const c = clubById(s, d.from);
  const prof = CLUB_PROFILES[d.profile] || CLUB_PROFILES.sporting;
  const swaps = swapCandidates(s, c);
  const cb = d.counterBid;
  const est = valueBid(s, d, f).v;
  return `<div class="card" style="margin-top:0">
    <div class="neg-prof"><b>${esc(c.name)}</b> · ${esc(prof.label)}<br><small class="muted">${esc(prof.tip)} Prix affiché ~${M(d.neg.asking)} · patience ${'●'.repeat(Math.max(0, d.neg.patience))}${'○'.repeat(Math.max(0, 3 - d.neg.patience))} · budget ${M(ensureBoard(s).transferBudget)}</small></div>
    ${notesHtml(d)}
    ${cb ? `<div class="msg counter"><span class="ic">↩</span><div class="grow"><b>Leur contre-proposition :</b> ${M(cb.fee)} (${PLAN[cb.plan]})${cb.addon ? ` + ${M(cb.addon)} de bonus` : ''}${cb.sellOn ? ` + ${Math.round(cb.sellOn * 100)} % à la revente` : ''}${cb.swapId ? ` + ${esc(s.players[cb.swapId]?.name || '')}` : ''}</div><button class="btn sm primary" data-act="takecounter">Accepter</button></div>` : ''}
    <div class="row between"><span>Indemnité</span><b class="big" style="font-size:22px">${M(f.fee)}</b></div>
    <input type="range" data-act="fv" data-k="fee" min="${step25k(d.neg.asking * 0.3)}" max="${step25k(d.neg.asking * 1.5)}" step="25000" value="${f.fee}">
    <div class="btns"><button class="btn sm" data-act="d" data-v="-1000000">−1 M</button><button class="btn sm" data-act="d" data-v="-100000">−100 k</button><button class="btn sm" data-act="d" data-v="100000">+100 k</button><button class="btn sm" data-act="d" data-v="1000000">+1 M</button></div>
    <div class="neg-grid">
      <label>Paiement<select data-act="fv" data-k="plan" data-t="s">${Object.entries(PLAN).map(([k, l]) => `<option value="${k}" ${f.plan === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <label>Bonus (après 25 matchs)<select data-act="fv" data-k="addon">${[0, 0.05, 0.1, 0.2].map((k) => `<option value="${step25k(f.fee * k)}" ${f.addon === step25k(f.fee * k) && (k || !f.addon) ? 'selected' : ''}>${k ? M(step25k(f.fee * k)) : 'Aucun'}</option>`).join('')}</select></label>
      <label>% à la revente<select data-act="fv" data-k="sellOn">${[0, 0.1, 0.15, 0.2, 0.3].map((k) => `<option value="${k}" ${f.sellOn === k ? 'selected' : ''}>${k ? `${k * 100} %` : 'Aucun'}</option>`).join('')}</select></label>
      <label>Joueur inclus (échange)<select data-act="fv" data-k="swapId" data-t="s"><option value="">Aucun</option>${swaps.map((q) => `<option value="${q.id}" ${String(f.swapId) === String(q.id) ? 'selected' : ''}>${esc(q.name)} (${q.pos}, ${M(playerValue(q))})</option>`).join('')}</select></label>
    </div>
    ${apprHtml(BUY_APPROACHES, f.approach)}
    <p class="muted" style="font-size:12px;margin:6px 0">Valeur de votre paquet aux yeux de ${esc(c.short || c.name)} : <b>≈ ${M(Math.round(est / 25000) * 25000)}</b> · versé à la signature : ${M(f.plan === 'cash' ? f.fee : step25k(f.fee * 0.4))}</p>
    <button class="btn primary block" data-act="sendbid">Envoyer l'offre</button>
    <small class="muted">Le club répond sous 1 à 3 jours (tout de suite pour une offre ferme).</small></div>`;
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
  const f = _form, dem = d.dem, val = playerValue(p), M = money;
  const P = d.prefs || {};
  const ct = d.counterTerms;
  const ev = valueContract(s, d, f);
  const sel = (k, opts, lbl) => `<label>${lbl}<select data-act="fv" data-k="${k}"${k === 'role' ? ' data-t="s"' : ''}>${opts.map(([v, l]) => `<option value="${v}" ${String(f[k]) === String(v) ? 'selected' : ''}>${l}</option>`).join('')}</select></label>`;
  const stepper = (k, lbl, steps) => `<div class="neg-step"><span>${lbl}</span><b>${M(f[k])}</b>${steps.map((x) => `<button class="btn sm" data-act="st" data-k="${k}" data-v="${x}">${x > 0 ? '+' : '−'}${M(Math.abs(x))}</button>`).join('')}</div>`;
  const W = Math.max(1000, Math.round(dem.wage / 20 / 500) * 500);
  return `<div class="card" style="margin-top:0">
    <div class="neg-prof">${dem.agent ? `Agent : <b>${esc(dem.agent.name)}</b> (${dem.agent.label})` : 'Pas d\'agent'} · ${d.tries ?? dem.tries} essai(s) restant(s)<br>
      <small class="muted">Priorités : ${P.money >= 1.15 ? 'l\'argent avant tout' : P.money <= 0.8 ? 'peu attaché à l\'argent' : 'un bon salaire'} · ${P.security >= 1.15 ? 'cherche la sécurité' : 'durée souhaitée'} ${P.wantYears} ans · ${P.greedAgent >= 1.3 ? 'agent gourmand' : P.greedAgent <= 0.7 ? 'agent conciliant' : 'agent classique'}${dem.minBonus ? ` · prime exigée ≥ ${M(dem.minBonus)}` : ''}</small></div>
    ${notesHtml(d)}
    ${ct ? `<div class="msg counter"><span class="ic">↩</span><div class="grow"><b>Demande de l'agent :</b> ${M(ct.wage)}/sem, ${ct.years} ans, commission ${M(ct.agentFee)}${ct.bonus ? `, prime ${M(ct.bonus)}` : ''}</div><button class="btn sm primary" data-act="takecounter">Accepter</button></div>` : ''}
    ${stepper('wage', 'Salaire /sem', [-W * 5, -W, W, W * 5])}
    <div class="neg-grid">
      ${sel('years', [1, 2, 3, 4, 5].map((y) => [y, `${y} an(s)`]), 'Durée')}
      ${sel('role', Object.entries(PROMISE_ROLES).map(([k, r]) => [k, `${r.label} (${Math.round(r.share * 100)} %)`]), 'Statut promis')}
      ${sel('bonus', [0, 10, 20, 40].map((k) => [Math.round(dem.wage * k / 1000) * 1000, k ? M(Math.round(dem.wage * k / 1000) * 1000) : 'Aucune']), 'Prime à la signature')}
      ${sel('loyalty', [0, 15, 30, 60].map((k) => [Math.round(dem.wage * k / 1000) * 1000, k ? M(Math.round(dem.wage * k / 1000) * 1000) : 'Aucune']), 'Prime de fidélité (fin de contrat)')}
      ${sel('appFee', [0, 0.05, 0.1, 0.2].map((k) => [Math.round(dem.wage * k / 100) * 100, k ? `${M(Math.round(dem.wage * k / 100) * 100)} / match` : 'Aucune']), 'Prime de match')}
      ${sel('goalBonus', [0, 2000, 5000, 10000, 25000].map((k) => [k, k ? M(k) : 'Aucune']), 'Prime de but')}
      ${sel('csBonus', [0, 2000, 5000, 10000].map((k) => [k, k ? M(k) : 'Aucune']), 'Prime d\'invincibilité')}
      ${sel('rise', [0, 0.03, 0.05, 0.1].map((k) => [k, k ? `+${k * 100} % par an` : 'Aucune']), 'Hausse annuelle')}
      ${sel('clause', [0, 1.3, 2, 3].map((k) => [k ? step25k(val * k) : 0, k ? M(step25k(val * k)) : 'Aucune']), 'Clause libératoire')}
      ${sel('relCut', [0, 0.2, 0.35].map((k) => [k, k ? `−${k * 100} % si relégation` : 'Non']), 'Clause de relégation')}
    </div>
    ${stepper('agentFee', 'Commission de l\'agent', [-25000, -5000, 5000, 25000])}
    ${apprHtml(CONTRACT_APPROACHES, f.approach)}
    <p class="muted" style="font-size:12px;margin:6px 0">Estimation de votre recruteur : ${ev.ratio >= 1 ? '<b class="pos-txt">devrait convenir</b>' : ev.ratio >= 0.93 ? '<b>proche de ses attentes</b>' : '<b class="neg-txt">insuffisant</b>'} · coût annuel ≈ ${M((f.wage * 52) + (f.appFee || 0) * 40)} + ${M((f.bonus || 0) + (f.agentFee || 0))} à la signature</p>
    <button class="btn primary block" data-act="sendterms">Envoyer la proposition</button>
    <small class="muted">L'agent répond sous 1 à 2 jours (tout de suite pour une dernière offre).</small></div>`;
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
