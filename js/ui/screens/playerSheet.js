/**
 * Fiche joueur (feuille modale) : attributs (avec brouillard pour les joueurs
 * extérieurs), état, stats, sélection, contrat, actions de transfert.
 */
import { dealFor, STAGE_LABEL } from '../../game/deals.js';
import { playerLinks } from '../../game/cohesion.js';
import { nationFlag } from '../../data/nations.js';
import { ATTRS, ATTR_LABELS, POSITION_LABELS } from '../../data/constants.js';
import { overall } from '../../engine/ratings.js';
import { money } from '../../game/economy.js';
import { clubById, userClub, gameRng } from '../../game/state.js';
import { askingPrice, loanIn, loanOut, findBuyer, sellPlayer, releasePlayer, promoteYouth, windowOpen } from '../../game/transfers.js';
import { estimate, rangeLabel, observe } from '../../game/scouting.js';
import { esc, posBadge, ovrChip, scaleColor, gauge, stars, statusTags, a20, color20, face, ovrColor } from '../components.js';
import { negotiateTransfer, negotiateContract } from './negotiation.js';
import { TALKS, playerTalk } from '../../game/media.js';
import { windowInfo } from '../../game/dates.js';
import { PROMISE_ROLES } from '../../game/transfers.js';
import { persInfo, influence } from '../../game/people.js';
import { agentInfo, exerciseOption } from '../../game/agents.js';
import { relapseRisk } from '../../game/injuries.js';
import { showClub } from './clubInfo.js';
import { captains, leadership, setCaptain } from '../../game/captain.js';

/** Attribut sur 20 (comme FM) : valeur exacte ou plage estimée par le recruteur. */
function attrLine(label, [lo, hi]) {
  const a = a20(lo), b = a20(hi);
  const v = a === b ? `<b style="color:${color20(a)}">${a}</b>` : `<b style="color:${color20(Math.round((a + b) / 2))};font-size:15px">${a}-${b}</b>`;
  return `<div class="a"><span>${label}</span>${v}</div>`;
}
const GROUPS = [['Technique', ['tir', 'pas', 'dri']], ['Mental', ['vis', 'sf', 'def']], ['Physique', ['vit', 'phy']], ['Gardien', ['arr']]];
const moodWord = (v) => (v >= 85 ? 'Superbe' : v >= 70 ? 'Très bon' : v >= 55 ? 'Bon' : v >= 40 ? 'Correct' : v >= 25 ? 'Faible' : 'Très faible');

const seasonLbl = (y) => `${y}-${String((+y + 1) % 100).padStart(2, '0')}`;

/** Affinités avec les coéquipiers (cohésion). */
function linksHtml(s, p, club) {
  const L = playerLinks(s, p, club);
  if (!L.length) return '';
  const col = (v) => (v >= 70 ? 'var(--good)' : v >= 40 ? 'var(--ok)' : 'var(--bad)');
  const avg = Math.round(L.reduce((a, x) => a + x.v, 0) / L.length);
  const tens = L.filter((x) => x.clash);
  return `<details class="card"><summary><b>🤝 Affinités</b> <small class="muted">intégration ${avg}/100${tens.length ? ` · ⚡ ${tens.length} tension(s)` : ''}</small></summary>
    ${L.slice(0, 5).map((x) => `<div class="row between" style="padding:3px 0;font-size:13px"><span>${esc(x.q.name)} <small class="muted">${x.q.pos}</small></span><b style="color:${col(x.v)}">${Math.round(x.v)}</b></div>`).join('')}
    ${tens.map((x) => `<div class="row between" style="padding:3px 0;font-size:13px"><span>⚡ ${esc(x.q.name)} <small class="muted">ne s'entendent pas</small></span><b class="neg-txt">${Math.round(x.v)}</b></div>`).join('')}
    <small class="muted">Les liens se renforcent en jouant ensemble (surtout aux postes voisins) et en gagnant.</small></details>`;
}

/** Carrière complète : parcours avant la partie, saisons jouées, saison en cours, tournois, blessures. */
function careerHtml(s, p, club) {
  const rows = [];
  for (const c of p.careerHist || []) rows.push(`<tr class="pre"><td class="l">${esc(c.y)}</td><td class="l">${esc(c.club)}</td><td>${c.apps || '—'}</td><td>${c.goals ?? '—'}</td><td>—</td><td>—</td></tr>`);
  for (const h of p.hist || []) rows.push(`<tr><td class="l">${seasonLbl(h.y)}</td><td class="l">${esc(h.club)}${h.youth ? ' <small>(form.)</small>' : ''}${h.loan ? ' <small>(prêt)</small>' : ''}</td><td>${h.apps}</td><td>${h.goals}</td><td>${h.assists}</td><td>${h.avg ? h.avg.toFixed(2) : '—'}</td></tr>`);
  const st = p.stats;
  rows.push(`<tr class="cur"><td class="l">${seasonLbl(s.season)}</td><td class="l">${club ? esc(club.name) : 'Libre'} <small>(en cours)</small></td><td>${st.apps}</td><td>${st.goals}</td><td>${st.assists}</td><td>${st.apps ? (st.ratingSum / st.apps).toFixed(2) : '—'}</td></tr>`);
  const preA = (p.careerHist || []).reduce((a, c) => a + (c.apps || 0), 0), preG = (p.careerHist || []).reduce((a, c) => a + (c.goals || 0), 0);
  const inA = (p.hist || []).reduce((a, h) => a + h.apps, 0) + st.apps, inG = (p.hist || []).reduce((a, h) => a + h.goals, 0) + st.goals, inP = (p.hist || []).reduce((a, h) => a + h.assists, 0) + st.assists;
  const tourns = (p.tourns || []).slice().reverse();
  const inj = p.injHist || [];
  const injDays = inj.reduce((a, x) => a + (x.n || 0), 0);
  return `<details class="card" open><summary><b>📈 Carrière</b> <small class="muted">${preA + inA} matchs · ${preG + inG} buts${inP ? ` · ${inP} passes D. (depuis le début de la partie)` : ''}</small></summary>
      <div style="overflow-x:auto"><table class="tbl car-tbl"><thead><tr><th class="l">Saison</th><th class="l">Club</th><th>MJ</th><th>B</th><th>PD</th><th>Note</th></tr></thead><tbody>${rows.join('')}</tbody></table></div>
      ${p.careerHist?.length ? '<p class="muted" style="font-size:11px;margin:4px 2px 0">Lignes grisées : parcours réel avant le début de la partie (championnat, source Wikipédia).</p>' : ''}
    </details>
    <details class="card" ${tourns.length ? 'open' : ''}><summary><b>🌍 Sélection${p.nat ? ` · ${nationFlag(p.nat)} ${esc(p.nat)}` : ''}</b> <small class="muted">${p.caps || 0} sélection(s) · ${p.intGoals || 0} but(s)</small></summary>
      ${tourns.length ? tourns.map((t) => `<div class="inj-row"><span class="d">${t.y}</span><span class="grow"><b>${esc(t.name)}</b> · ${esc(t.stage)}${(p.honoursInt || []).includes(t.name) ? ' 🏆' : ''}</span><small class="muted num">${t.apps} m · ${t.goals} b · ${t.assists || 0} pd${t.avg ? ` · ${t.avg}` : ''}</small></div>`).join('') : '<p class="muted" style="margin:6px 0 0;font-size:13px">Aucun grand tournoi disputé depuis le début de la partie.</p>'}
    </details>
    <details class="card" ${p.injury > 0 ? 'open' : ''}><summary><b>✚ Historique des blessures</b> <small class="muted">${inj.length ? `${inj.length} blessure(s) · ${injDays} match(s) manqué(s)` : 'aucune'}</small></summary>
      ${inj.length ? inj.map((x) => `<div class="inj-row"><span class="d">${esc(String(x.d).slice(0, 10).split('-').reverse().join('/'))}</span><span class="grow"><b>${esc(x.what)}</b>${x.where ? ` <small class="muted">· ${esc(x.where)}</small>` : ''}</span><small class="num ${x.n >= 10 ? 'neg-txt' : 'muted'}">${x.n} match(s)</small></div>`).join('') : '<p class="muted" style="margin:6px 0 0;font-size:13px">Aucune blessure depuis le début de la partie.</p>'}
      ${inj.length >= 4 ? '<p class="muted" style="font-size:12px;margin:6px 0 0">⚠ Joueur souvent blessé : le staff médical recommande de gérer sa charge.</p>' : ''}
    </details>`;
}

export function showPlayer(app, pid, onChange) {
  const s = app.state;
  const render = () => {
    const p = s.players[pid];
    if (!p) return '<p>Joueur introuvable.</p>';
    const uc = userClub(s);
    const mine = p.clubId === uc.id;
    const youth = uc.youthIds.includes(p.id);
    const club = p.clubId ? clubById(s, p.clubId) : null;
    const e = estimate(s, p);
    const attrs = ATTRS.filter((k) => k !== 'arr' || p.pos === 'GB');
    const apps = p.stats.apps;
    const avg = apps ? (p.stats.ratingSum / apps).toFixed(2) : '—';
    let actions = '';
    const cv = mine && !p.onLoanFrom ? captains(s, uc) : {};
    const capRow = mine && !p.onLoanFrom ? `<div class="cap-box"><span class="xi-tag cap">C</span><div class="grow"><b>${p.id === cv.captain ? 'Capitaine du club' : p.id === cv.vice ? 'Vice-capitaine' : 'Brassard'}</b>
        <small>Leadership ${leadership(s, p)}/100 · un leader calme l'équipe et la relance quand elle est menée</small></div>
        ${p.id !== cv.captain ? `<button class="btn sm" data-act="cap">Nommer capitaine</button>` : ''}${p.id !== cv.vice && p.id !== cv.captain ? `<button class="btn sm" data-act="vice">Vice</button>` : ''}</div>` : '';
    if (youth) {
      actions = `<button class="btn primary block" data-act="promote">Promouvoir en équipe première</button>`;
    } else if (mine) {
      actions = `<div class="btns">
        ${!p.onLoanFrom ? `<button class="btn" data-act="talk">💬 Discuter</button>${dealFor(s, p.id, 'renew') ? '<button class="btn" data-act="opendeal">📂 Prolongation en cours</button>' : `<button class="btn" data-act="renew">${p.contract <= 2 ? 'Prolonger' : 'Renégocier'}</button>`}
        <button class="btn" data-act="sell">Vendre</button>
        <button class="btn" data-act="list">${p.listed ? 'Retirer de la liste' : 'Mettre sur la liste'}</button>
        <button class="btn" data-act="loanout">Prêter</button>
        <button class="btn danger" data-act="release">Libérer</button>` : `<small class="muted">Joueur prêté : il retournera dans son club en fin de saison.</small>${p.buyOption ? `<button class="btn primary" data-act="option">Lever l'option · ${money(p.buyOption)}</button>` : ''}`}
      </div>`;
    } else {
      const price = askingPrice(s, p);
      const queued = (s.scoutQueue || []).includes(p.id);
      actions = `<div class="btns">
        ${dealFor(s, p.id) ? `<button class="btn primary" data-act="opendeal">📂 Dossier en cours · ${esc(STAGE_LABEL[dealFor(s, p.id).stage])}</button>` : `<button class="btn primary" data-act="buy" ${windowOpen(s) || !p.clubId ? '' : 'disabled'}>${p.clubId ? `Faire une offre · ~${money(price)}` : 'Proposer un contrat (libre)'}</button>
        ${p.clubId ? `<button class="btn" data-act="loanin" ${windowOpen(s) ? '' : 'disabled'}>Demander un prêt</button>` : ''}`}
        ${!e.exact ? `<button class="btn" data-act="observe" ${queued ? 'disabled' : ''}>${queued ? 'En observation…' : '🔭 Observer'}</button>` : ''}
      </div>${windowOpen(s) ? '' : `<p class="muted" style="font-size:12px">${esc(windowInfo(s).label)}</p>`}`;
    }
    const ovrHtml = `<div style="text-align:right;font-size:11px;color:var(--muted)">Note /100<br><b class="ovr-n" style="--oc:${ovrColor((e.ovr[0] + e.ovr[1]) / 2)};display:inline-block;margin:2px 0 4px">${rangeLabel(e.ovr)}</b><br>Potentiel<br><b class="ovr-n sm" style="--oc:${ovrColor((e.pot[0] + e.pot[1]) / 2)}">${rangeLabel(e.pot)}</b>${e.exact ? '' : '<br><small>estimation</small>'}</div>`;
    return `<div class="row" style="gap:12px;margin-bottom:10px">
        ${p.photo || p.real ? face(p, club, 'lg') : ''}<div style="font-size:30px;font-weight:900;color:var(--muted);min-width:34px;text-align:center">${p.number || ''}</div>
        <div class="grow"><h2>${esc(p.first)} ${esc(p.last)}</h2>
          <div class="row" style="gap:6px;flex-wrap:wrap">${posBadge(p.pos)}${(p.pos2 || []).map((x) => `<span class="pos2" title="Poste secondaire : ${POSITION_LABELS[x]}">${posBadge(x)}</span>`).join('')}<small>${POSITION_LABELS[p.pos]} · ${p.age} ans · ${esc(p.nat || '')}</small>${statusTags(p)}</div>
          <small>${club ? `<a data-act="club" style="text-decoration:underline;cursor:pointer">${esc(club.name)}</a>` : 'Libre'}${p.onLoanFrom ? ` (prêt de ${esc(clubById(s, p.onLoanFrom).short)})` : ''}</small></div>
        <div class="center">${ovrHtml}</div>
      </div>
      ${p.requested ? '<div class="tag ok" style="display:block;margin-bottom:8px">🧑‍💼 Son agent réclame un transfert</div>' : ''}
      ${p.injury > 0 ? `<div class="tag bad" style="display:block;margin-bottom:8px">✚ ${esc(p.injuryName)} — indisponible ${p.injury} match(s)</div>` : ''}
      ${!e.exact ? `<p class="muted" style="font-size:12px;margin:0 2px 6px">🔭 Connaissance : ${e.k}% · les valeurs affichées sont des estimations du recruteur.</p>` : ''}
      <div class="card attr20" style="margin-top:0">${GROUPS.filter(([, ks]) => ks.some((k) => attrs.includes(k))).map(([g, ks]) => `<div class="attr-group">${g}</div>${ks.filter((k) => attrs.includes(k)).map((k) => attrLine(ATTR_LABELS[k], e.attrs[k])).join('')}`).join('')}</div>
      ${mine || youth ? `<div class="card">
        <div class="attr"><span>Forme</span>${gauge(p.form)}<span class="v" style="min-width:72px">${moodWord(p.form)}</span></div>
        <div class="attr"><span>Moral</span>${gauge(p.morale)}<span class="v" style="min-width:72px">${moodWord(p.morale)}</span></div>
        <div class="attr"><span>Condition</span>${gauge(100 - p.fatigue)}<span class="v" style="min-width:72px">${100 - Math.round(p.fatigue)} %</span></div>
        ${p.sharp != null ? `<div class="attr"><span>Rythme</span>${gauge(p.sharp)}<span class="v" style="min-width:72px">${Math.round(p.sharp)}/100</span></div>` : ''}
      </div>` : ''}
      <div class="statgrid">
        <div><b>${apps}</b><small>Matchs</small></div><div><b>${p.stats.goals}</b><small>Buts</small></div>
        <div><b>${p.stats.assists}</b><small>Passes D.</small></div><div><b>${avg}</b><small>Note moy.</small></div>
      </div>
      <div class="card">
        <div class="row between"><span>Sélections (${esc(p.nat || '—')})</span><b>${p.caps || 0} · ${p.intGoals || 0} but(s)</b></div>
        ${p.career ? `<div class="row between"><span>Carrière</span><b>${p.career.apps + apps} m · ${p.career.goals + p.stats.goals} b</b></div>` : ''}
        <div class="row between"><span>Valeur</span><b>${money(p.value)}</b></div>
        <div class="row between"><span>Salaire</span><b>${money(p.wage)}/sem</b></div>
        <div class="row between"><span>Contrat</span><b>${p.contract > 0 ? `${p.contract} an(s)` : '—'}</b></div>
        ${mine && p.clause ? `<div class="row between"><span>Clause libératoire</span><b>${money(p.clause)}</b></div>` : ''}
        ${mine && p.goalBonus ? `<div class="row between"><span>Prime de but</span><b>${money(p.goalBonus)}</b></div>` : ''}
        ${p.sellOn ? `<div class="row between"><span>Revente</span><b>${Math.round(p.sellOn.pct * 100)} % à ${esc(clubById(s, p.sellOn.clubId)?.short || '?')}</b></div>` : ''}
        ${p.foot ? `<div class="row between"><span>Pied fort</span><b>${p.foot === 'G' ? 'Gauche' : 'Droit'}</b></div>` : ''}
        ${p.cons != null ? `<div class="row between"><span>Régularité</span><b>${p.cons}/20 · ${p.cons >= 15 ? 'très régulier' : p.cons >= 11 ? 'régulier' : 'irrégulier'}</b></div>` : ''}
        <div class="row between"><span>Personnalité</span><b>${persInfo(p).label}${mine ? ` · influence ${influence(s, p)}` : ''}</b></div>
        ${agentInfo(p) ? `<div class="row between"><span>Agent</span><b>${esc(agentInfo(p).name)} (${agentInfo(p).label})</b></div>` : ''}
        ${mine && p.relapse ? `<div class="row between"><span>Risque de rechute</span><b class="bad">${Math.round(p.relapse.risk * 100)} % · ${p.relapse.matches} match(s)</b></div>` : ''}
        ${mine && p.promise ? `<div class="row between"><span>Statut promis</span><b>${PROMISE_ROLES[p.promise.role].label}${p.promise.strikes ? ' ⚠' : ''}</b></div>` : ''}
      </div>
      ${mine && !youth ? linksHtml(s, p, club) : ''}
      ${careerHtml(s, p, club)}
      ${capRow}${actions}`;
  };
  const done = (r, close = false) => {
    app.toast(r.msg);
    if (r.ok) { app.save(); onChange?.(); app.render(); }
    if (r.ok && close) h.close(); else h.update(render());
  };
  const h = app.sheet({
    html: render,
    actions: {
      buy: () => { h.close(); import('./deals.js').then((mod) => mod.openDealFlow(app, pid, 'buy', onChange)); },
      opendeal: () => { h.close(); import('./deals.js').then((mod) => mod.dealSheet(app, dealFor(s, pid).id, onChange)); },
      loanin: () => { h.close(); import('./deals.js').then((mod) => mod.openDealFlow(app, pid, 'loan', onChange)); },
      observe: () => done({ ...observe(s, pid), ok: true }),
      renew: () => { h.close(); import('./deals.js').then((mod) => mod.openDealFlow(app, pid, 'renew', onChange)); },
      talk: () => { import('./mailbox.js').then((mod) => mod.openMailbox(app, { tab: 'chats', pid })); },
      talkOld: () => {
        const ts = app.sheet({
          html: `<h2>💬 Discussion avec ${esc(s.players[pid].name)}</h2><p class="muted">Forme ${s.players[pid].form} · moral ${s.players[pid].morale}</p>
            <div class="btns" style="flex-direction:column">${Object.entries(TALKS).map(([k, l]) => `<button class="btn block" data-act="say" data-v="${k}">${l}</button>`).join('')}</div>`,
          actions: { say: (b) => { const r = playerTalk(s, pid, b.dataset.v); app.toast(r.msg, 3500); if (r.ok) app.save(); ts.close(); h.update(render()); } },
        });
      },
      list: () => { const p = s.players[pid]; p.listed = !p.listed; done({ ok: true, msg: p.listed ? 'Placé sur la liste des transferts.' : 'Retiré de la liste.' }); },
      sell: async () => {
        const p = s.players[pid];
        const offer = findBuyer(s, p, gameRng(s));
        if (!offer) { app.toast('Aucun club intéressé pour le moment.'); return; }
        const c = clubById(s, offer.clubId);
        if (!(await app.confirm('Offre reçue', `${esc(c.name)} propose <b>${money(offer.amount)}</b> pour ${esc(p.name)} (valeur ${money(p.value)}).`, 'Accepter'))) return;
        done(sellPlayer(s, offer), true);
      },
      loanout: async () => {
        if (!(await app.confirm('Prêter ?', 'Le joueur partira jusqu\'à la fin de la saison. Vous payez 30 % de son salaire.', 'Prêter'))) return;
        done(loanOut(s, pid, gameRng(s)), true);
      },
      release: async () => {
        const p = s.players[pid];
        if (!(await app.confirm('Libérer ?', `Indemnité : ${money(p.wage * 10)}.`, 'Libérer', true))) return;
        done(releasePlayer(s, pid), true);
      },
      promote: () => done(promoteYouth(s, pid), true),
      cap: () => done({ ok: true, msg: setCaptain(s, pid) }),
      vice: () => done({ ok: true, msg: setCaptain(s, pid, true) }),
      option: () => done(exerciseOption(s, pid)),
      club: () => { const c = s.players[pid].clubId; if (c) { h.close(); showClub(app, c); } },
    },
  });
  return h;
}
