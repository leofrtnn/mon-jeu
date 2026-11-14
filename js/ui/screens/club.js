/**
 * Club : finances, mercato, staff & installations, entraînement, formation,
 * objectifs & carrière, amis (multijoueur), paramètres (sauvegardes, données).
 */
import { budgetSplit, setSplit } from '../../game/board.js';
import { ALLOC, ALLOC_LEVELS, allocUnit, allocWeekly } from '../../game/career.js';
import { COUNTRIES } from '../../data/world.js';
import { activeDeals } from '../../game/deals.js';
import { searchPlayers, filterOptions, DEFAULT_FILTERS } from '../../game/search.js';
import { dealsList } from './deals.js';
import { userClub, clubPlayers, clubById } from '../../game/state.js';
import { money, wageBill, sponsorIncome, prizeMoney } from '../../game/economy.js';
import { DIVISIONS } from '../../data/world.js';
import { marketList, windowOpen, academyCost, upgradeAcademy, sellPlayer, counterIncoming, youthRecruitCost, upgradeYouthRecruit, releaseYouth, promoteYouth } from '../../game/transfers.js';
import { tablePosition, DIV_NAMES, CONTI_NAME } from '../../game/season.js';
import { STAFF_ROLES, staffWages, hireStaff, fireStaff, bestStaff, staffEffects, trainingUpgradeCost, upgradeTraining, STADIUM_OPTIONS, stadiumCost, expandStadium, TRAINING_FOCUS, INTENSITY, staffDemand, staffOffer } from '../../game/career.js';
import { randomLook } from '../../game/coach.js';
import { createRng, hashSeed } from '../../core/rng.js';
import { estimate, rangeLabel, mid, REGIONS, MISSION_DAYS, startMission } from '../../game/scouting.js';
import { gameRng } from '../../game/state.js';
import { overall } from '../../engine/ratings.js';
import { POSITIONS, ATTR_LABELS, POSITION_GROUP } from '../../data/constants.js';
import { posBadge } from '../components.js';
import { esc, seg, playerRow, gauge, stars, scaleColor, ovrChip, noteChip, face } from '../components.js';
import { showPlayer } from './playerSheet.js';
import * as settings from './settings.js';
import { windowInfo } from '../../game/dates.js';
import { ensureBoard, REQUESTS, boardRequest, shiftBudget, wageRoom, youthShare, SALE_SHARE, WAGE_RATE } from '../../game/board.js';
import { avatarSvg, portraitSvg, personLook } from '../avatar.js';
import { COACH_SKILLS, SKILL_KEYS, PHILOSOPHIES, coachName, ensureCoachProfile } from '../../game/coach.js';
import { openCoachEditor } from './coachEditor.js';
import * as friends from './friends.js';
import { TICKETS, SPONSOR_REQS, userSponsorIncome } from '../../game/fans.js';
import { ownerType, finHealth } from '../../game/owners.js';
import { showClub } from './clubInfo.js';

const TAB_LABEL = { fin: 'Finances', board: 'Direction', market: 'Recrutement', staff: 'Staff', train: 'Entraînement', youth: 'Jeunes', obj: 'Carrière', friends: 'Amis', settings: 'Paramètres' };
const PAGE_TITLE = { board: 'Direction du club', youth: 'Centre de formation', obj: 'Ma carrière', friends: 'Entre amis' };
/** Rubriques du menu : les sous-onglets affichés sont ceux de la rubrique en cours. */
const SECTIONS = [{ tabs: ['train', 'youth', 'staff'] }, { tabs: ['board', 'fin', 'obj', 'friends'] }, { tabs: ['market'] }, { tabs: ['settings'] }];

export function render(app) {
  const tab = app.ui.clubTab || 'fin';
  const s = app.state;
  let body;
  if (tab === 'fin') body = finances(s);
  else if (tab === 'board') body = boardView(s);
  else if (tab === 'market') body = market(app);
  else if (tab === 'staff') body = staff(app);
  else if (tab === 'train') body = training(s);
  else if (tab === 'youth') body = youth(s);
  else if (tab === 'friends') body = friends.render(app);
  else if (tab === 'settings') body = settings.render(app);
  else body = career(s);
  // Sous-onglets : seulement ceux de la même rubrique du menu (le reste est dans le menu).
  const group = SECTIONS.find((g) => g.tabs.includes(tab));
  const chips = group && group.tabs.length > 1 ? `<div class="chips sub-tabs">${group.tabs.map((k) => `<button class="chip ${tab === k ? 'on' : ''}" data-act="ctab" data-v="${k}">${TAB_LABEL[k]}</button>`).join('')}</div>` : '';
  return `<div class="page-head"><h2>${PAGE_TITLE[tab] || TAB_LABEL[tab]}</h2>${chips}</div><div class="${tab === 'market' ? '' : 'tab-body'}">${body}</div>`;
}

function finances(s) {
  const uc = userClub(s);
  const wages = wageBill(clubPlayers(s, uc));
  const hist = uc.finances.history.filter((h) => h.season === s.season);
  const byDay = new Map();
  for (const h of hist) byDay.set(h.day, (byDay.get(h.day) || 0) + h.amount);
  const days = [...byDay.entries()].sort((a, b) => a[0] - b[0]).slice(-16);
  const max = Math.max(1, ...days.map((d) => Math.abs(d[1])));
  const sum = (pred) => hist.filter(pred).reduce((a, h) => a + h.amount, 0);
  const cats = [
    ['Billetterie', sum((h) => h.label.startsWith('Billetterie'))],
    ['Sponsors', sum((h) => h.label === 'Sponsors')],
    ['Primes (championnat, coupes)', sum((h) => h.label.startsWith('Prime') || h.label.includes(' · '))],
    ['Transferts', sum((h) => /Transfert|Vente|Prêt|Indemnité|Commission|Clause|Échéance/.test(h.label))],
    ['Salaires', sum((h) => h.label === 'Salaires')],
    ['Staff & infrastructures', sum((h) => /staff|Centre|stade/i.test(h.label))],
  ];
  // Projection : semaines restantes × (sponsors − salaires), billetterie moyenne × matchs à domicile restants, prime de classement.
  const left = Math.max(0, s.calendar.length - s.day);
  const weekly = userSponsorIncome(s) - wages - staffWages(uc);
  const gates = hist.filter((h) => h.label.startsWith('Billetterie'));
  const gateAvg = gates.length ? gates.reduce((a, h) => a + h.amount, 0) / gates.length : 0;
  const leagueLeft = s.calendar.slice(s.day).filter((e) => e.type === 'league').length;
  const homeLeft = Math.round(leagueLeft / 2);
  const pos = tablePosition(s, uc.id);
  const prize = DIVISIONS[uc.div] ? prizeMoney(DIVISIONS[uc.div].level, pos, uc) : 0;
  const owedNow = (uc.debts || []).filter((d) => d.season <= s.season + 1).reduce((a, d) => a + d.amount, 0);
  const proj = uc.budget + weekly * left + gateAvg * homeLeft + prize - owedNow;
  const projRows = [['Budget actuel', uc.budget], [`Sponsors − salaires (${left} sem.)`, weekly * left], [`Billetterie (~${homeLeft} matchs à domicile)`, Math.round(gateAvg * homeLeft)], [`Prime de classement (${pos}e)`, prize], ['Échéances de transferts', -owedNow]];
  return `<div class="card center"><h3>Budget</h3><div class="big ${uc.budget < 0 ? 'neg-txt' : ''}">${money(uc.budget)}</div>
    <small>Joueurs ${money(wages)}/sem · Staff ${money(staffWages(uc))}/sem · Sponsors ${money(userSponsorIncome(s))}/sem · Santé financière ${finHealth(s, uc)}/100</small></div>
    <div class="card"><h3>📈 Projection de fin de saison</h3>
      ${projRows.map(([l, v]) => `<div class="row between" style="padding:4px 0"><span>${l}</span><b class="${v >= 0 ? '' : 'neg-txt'}">${v > 0 && l !== 'Budget actuel' ? '+' : ''}${money(v)}</b></div>`).join('')}
      <div class="row between proj-total"><span>Solde estimé fin mai</span><b class="${proj >= 0 ? 'pos-txt' : 'neg-txt'}">${money(Math.round(proj))}</b></div>
      <small class="muted">Hors transferts à venir et parcours en coupe. ${weekly < 0 ? `La masse salariale coûte ${money(-weekly)} de plus par semaine que les sponsors.` : ''}</small></div>
    ${(uc.debts || []).length ? `<div class="card"><h3>🧾 Échéancier des transferts</h3>${uc.debts.slice().sort((a, b) => a.season - b.season).map((d) => `<div class="row between" style="padding:4px 0"><span>${esc(d.name)} <small class="muted">→ ${esc(clubById(s, d.to)?.short || '')}</small></span><span><small class="muted">fin ${d.season - 1}-${String(d.season).slice(2)}</small> <b class="neg-txt">${money(d.amount)}</b></span></div>`).join('')}</div>` : ''}
    <div class="card"><h3>Billetterie & sponsors</h3>
      <div class="label" style="margin-top:0">Prix des places · ambiance ${Math.round(uc.atmosphere ?? 55)}/100</div>${seg('ticket', Object.keys(TICKETS), uc.ticket || 'normal', TICKETS)}
      <small class="muted">Des places chères rapportent plus mais refroidissent le stade (avantage à domicile, pression sur le board).</small>
      ${(s.sponsorDeals || []).map((d) => `<div class="row between" style="padding:6px 0;border-bottom:1px solid var(--line)"><span class="grow"><b>${esc(d.name)}</b> <small>(${esc(d.kind)})</small><br><small class="muted">${esc(SPONSOR_REQS[d.req])} · ${d.years} an(s) · satisfaction ${Math.round(d.sat)}</small></span><b>${money(d.weekly)}/sem</b></div>`).join('') || '<p class="muted">Aucun sponsor.</p>'}
    </div>
    <div class="card"><h3>Flux par journée</h3>
      ${days.length ? `<div class="bars">${days.map(([, v]) => `<i title="${money(v)}" style="height:${Math.abs(v) / max * 100}%;background:${v >= 0 ? 'var(--good)' : 'var(--bad)'}"></i>`).join('')}</div>` : '<p class="muted">Pas encore de mouvements cette saison.</p>'}
    </div>
    <div class="card"><h3>Saison en cours</h3>
      ${cats.map(([l, v]) => `<div class="row between" style="padding:5px 0"><span>${l}</span><b class="${v >= 0 ? 'pos-txt' : 'neg-txt'}">${v >= 0 ? '+' : ''}${money(v)}</b></div>`).join('')}
    </div>
    <div class="card"><h3>Derniers mouvements</h3>
      ${uc.finances.history.slice(0, 12).map((h) => `<div class="row between" style="padding:4px 0;font-size:13px"><span class="grow">${esc(h.label)}</span><span class="${h.amount >= 0 ? 'pos-txt' : 'neg-txt'}">${h.amount >= 0 ? '+' : ''}${money(h.amount)}</span></div>`).join('') || '<p class="muted">—</p>'}
    </div>`;
}

function boardView(s) {
  const b = ensureBoard(s);
  const uc = userClub(s);
  const bill = wageBill(clubPlayers(s, uc));
  const parts = [['results', 'Résultats', 50], ['finances', 'Finances', 15], ['transfers', 'Mercato', 15], ['youth', 'Jeunes', 10], ['style', 'Style de jeu', 10]];
  const o = s.objectives;
  const st = s.seasonStats || {};
  const styleNow = st.m ? { attack: `${(st.gf / st.m).toFixed(2)} buts/match (objectif ≥ 1,6)`, solid: `${(st.ga / st.m).toFixed(2)} encaissés/match (≤ 1,1)`, possession: `${Math.round(st.poss / st.m)} % de possession (≥ 52 %)`, youth: `${youthShare(s)} % du temps de jeu aux jeunes` }[b.identity] : 'Pas encore de match';
  const ot = ownerType(uc);
  return `<div class="card"><div class="row between"><h3 style="margin:0">🏛 ${esc(uc.owner?.name || 'Propriétaire')}</h3><button class="btn sm" data-act="myclub">Fiche du club</button></div>
      <small class="muted">${ot.label} · budget ×${ot.budget} · patience ×${ot.patience}</small></div>
    <div class="card"><h3>Confiance du CA</h3>
      <div class="row between"><b class="big" style="color:${scaleColor(b.confidence)}">${Math.round(b.confidence)}%</b>
        <small>${b.confidence < 20 ? '⚠ Votre poste est menacé' : b.confidence < 45 ? 'Le CA s\'impatiente' : 'Le CA vous soutient'}</small></div>
      ${parts.map(([k, l, w]) => `<div class="attr"><span>${l} <small>(${w} %)</small></span>${gauge(b.parts[k], scaleColor(b.parts[k]))}<span class="v">${Math.round(b.parts[k])}</span></div>`).join('')}
    </div>
    <div class="card"><h3>Enveloppes</h3>
      <div class="row between"><span>Budget transferts</span><b class="big" style="font-size:24px">${money(b.transferBudget)}</b></div>
      <div class="row between" style="margin-top:6px"><span>Masse salariale</span><b>${money(bill)} / ${money(b.wageBudget)} par sem.</b></div>
      ${gauge(Math.min(100, bill / b.wageBudget * 100), bill > b.wageBudget ? 'var(--bad)' : 'var(--good)')}
      <small class="muted">Marge salariale : ${money(Math.max(0, b.wageBudget - bill))}/sem · ${Math.round(SALE_SHARE * 100)} % des ventes reviennent au budget transferts.</small>
      ${(() => { const sp = budgetSplit(s); return `<div class="label">Répartition transferts ⟷ salaires</div>
        <input type="range" data-act="split" min="0" max="100" step="5" value="${Math.round(sp.pct * 100)}" style="width:100%">
        <div class="row between"><small>💶 Transferts <b>${Math.round(sp.pct * 100)} %</b></small><small>Salaires <b>${100 - Math.round(sp.pct * 100)} %</b> 👕</small></div>
        <small class="muted">Enveloppe totale ${money(sp.total)} (1 € de salaire hebdomadaire ≈ ${WAGE_RATE} € de transferts). Plus de marge salariale = des recrues mieux payées, moins d'indemnités.</small>`; })()}
    </div>
    <div class="card"><h3>Budgets de fonctionnement</h3>
      ${Object.entries(ALLOC).map(([k, a]) => `<div style="padding:6px 0;border-bottom:1px solid var(--line)"><div class="row between"><span>${a.icon} <b>${a.label}</b></span>
        <select data-act="alloc" data-k="${k}">${ALLOC_LEVELS.map((l, i) => `<option value="${i}" ${(uc.alloc?.[k] ?? 1) === i ? 'selected' : ''}>${l}${i !== 1 ? ` (${i > 1 ? '+' : '−'}${money(Math.abs(i - 1) * allocUnit(uc))}/sem)` : ''}</option>`).join('')}</select></div>
        <small class="muted">${a.desc}</small></div>`).join('')}
      <small class="muted">Coût actuel : ${allocWeekly(uc) >= 0 ? '+' : '−'}${money(Math.abs(allocWeekly(uc)))}/sem (versé avec les salaires du staff).</small>
    </div>
    <div class="card"><h3>Attentes du CA</h3>
      <div class="row" style="padding:5px 0"><span class="grow">🏁 ${esc(o.league.label)}</span><span class="tag ${tablePosition(s, uc.id) <= o.league.target ? 'good' : 'bad'}">${tablePosition(s, uc.id)}e</span></div>
      ${o.cup ? `<div class="row" style="padding:5px 0"><span class="grow">🏆 ${esc(o.cup.label)}</span></div>` : ''}
      ${o.conti ? `<div class="row" style="padding:5px 0"><span class="grow">⭐ ${esc(o.conti.label)}</span></div>` : ''}
      <div class="row" style="padding:5px 0"><span class="grow">🎨 ${esc(o.identity?.label || '')}<br><small>${esc(styleNow)}</small></span></div>
      <div class="row" style="padding:5px 0"><span class="grow">🌱 ${esc(o.youth?.label || '')}</span><span class="tag ${youthShare(s) >= b.youthTarget ? 'good' : 'ok'}">${youthShare(s)} %</span></div>
      <div class="row" style="padding:5px 0"><span class="grow">💶 ${esc(o.finance.label)}</span><span class="tag ${uc.budget >= 0 && bill <= b.wageBudget ? 'good' : 'bad'}">${uc.budget >= 0 && bill <= b.wageBudget ? 'OK' : 'Hors cadre'}</span></div>
    </div>
    <div class="card"><h3>Supporters</h3>
      <div class="row between"><span>Humeur</span><b style="color:${scaleColor(b.fans)}">${Math.round(b.fans)}%</b></div>${gauge(b.fans)}
      <small class="muted">Des supporters heureux remplissent le stade (billetterie jusqu'à +10 %).</small></div>
    <div class="card"><h3>Demandes au CA</h3>
      ${Object.entries(REQUESTS).map(([k, r]) => `<div class="row" style="padding:6px 0;border-bottom:1px solid var(--line)"><span class="grow">${r.label}<br><small class="muted">Confiance requise : ${r.min} %</small></span>
        <button class="btn sm" data-act="req" data-v="${k}">Demander</button></div>`).join('')}
    </div>`;
}

function market(app) {
  const s = app.state;
  const uc = userClub(s);
  const pos = app.ui.mktPos || null;
  const mode = app.ui.mktMode || 'buy';
  const open = windowOpen(s);
  let html = `<div class="card row between" style="padding:10px 14px">
      <span>${open ? (windowInfo(s).deadline ? '⏰' : '🟢') : '🔴'} ${esc(windowInfo(s).label)}</span><small>Transferts <b>${money(ensureBoard(s).transferBudget)}</b> · marge salariale <b>${money(Math.max(0, wageRoom(s)))}</b>/sem</small></div>
    ${seg('mmode', ['buy', 'loan', 'deals', 'sell', 'scout'], mode, { buy: 'Rechercher', loan: 'Prêts', deals: `Dossiers${activeDeals(s).length ? ` (${activeDeals(s).length})` : ''}`, sell: 'Ventes', scout: 'Recrutement' })}`;
  if (mode === 'deals') return html + dealsList(s);
  if (mode === 'sell') {
    const offers = (s.pendingOffers || []).filter((o) => s.players[o.pid]?.clubId === uc.id);
    const listed = clubPlayers(s, uc).filter((p) => p.listed);
    html += `<div class="label">Offres reçues</div><div class="card" style="margin-top:0">${offers.map((o) => {
      const p = s.players[o.pid]; const c = clubById(s, o.clubId);
      return `<div style="padding:6px 0;border-bottom:1px solid var(--line)"><b>${esc(p.name)}</b> ${ovrChip(overall(p))} <small>${esc(c.name)} · <b>${money(o.amount)}</b></small>
        <div class="btns" style="margin-top:6px"><button class="btn sm" data-act="decline" data-id="${p.id}">Non</button><button class="btn sm" data-act="counter" data-id="${p.id}">+15 %</button><button class="btn sm primary" data-act="accept" data-id="${p.id}">Oui</button></div></div>`;
    }).join('') || '<p class="muted" style="margin:0">Aucune offre. Placez des joueurs sur la liste des transferts pour attirer les clubs.</p>'}</div>
    <div class="label">Sur la liste des transferts</div><div class="card list" style="padding:0 10px;margin-top:0">${listed.map((p) => playerRow(p)).join('') || '<p class="muted">Aucun joueur listé (fiche joueur → « Mettre sur la liste »).</p>'}</div>`;
    return html;
  }
  if (mode === 'scout') {
    const ids = [...new Set([...(s.scoutQueue || []), ...Object.keys(s.scout || {}).map(Number)])].filter((id) => s.players[id] && s.players[id].clubId !== uc.id);
    const scouts = uc.staffMembers.filter((m) => m.role === 'scout');
    const ms = s.missions || {};
    const reco = (s.scoutReports || []).filter((r) => s.players[r.pid] && s.players[r.pid].clubId !== uc.id).slice(0, 12);
    html += `<div class="card"><h3 style="margin-top:0">🔭 Missions de recrutement</h3>
      ${scouts.map((m) => {
        const mi = ms[m.id];
        return `<div class="row between" style="padding:6px 0;border-bottom:1px solid var(--line)"><div><b>${esc(m.first)} ${esc(m.last)}</b> <small>(${m.rating}/20)</small><br>
          <small class="muted">${mi ? `En mission : ${esc(REGIONS[mi.region])}${mi.pos ? ` · ${mi.pos}` : ''}${mi.maxAge ? ` · ≤ ${mi.maxAge} ans` : ''} · ${mi.found.length} joueur(s) vus · retour dans ${mi.daysLeft} j.` : 'Disponible'}</small></div>
          ${mi ? '' : `<button class="btn sm primary" data-act="mission" data-id="${m.id}">Envoyer</button>`}</div>`;
      }).join('') || '<p class="muted">Aucun recruteur : embauchez-en un dans Club → Staff.</p>'}
      <p class="muted" style="font-size:12px;margin:6px 0 0">Une mission dure ${MISSION_DAYS} journées : le recruteur observe les joueurs ciblés, puis rend ses recommandations.</p></div>
      ${reco.length ? `<div class="label">Recommandations</div><div class="card list" style="padding:0 10px;margin-top:0">${reco.map((r) => marketRow(s, s.players[r.pid])).join('')}</div>` : ''}
      <div class="label">Joueurs observés</div>
      <p class="muted" style="font-size:12px;margin:0 2px 6px">${staffEffects(uc).scoutReports} rapport(s) individuel(s) par journée. Ouvrez une fiche puis « Observer ».</p>
      <div class="card list" style="padding:0 10px">${ids.slice(0, 40).map((id) => marketRow(s, s.players[id])).join('') || '<p class="muted">Aucun joueur observé.</p>'}</div>`;
    return html;
  }
  return html + searchPanel(app, mode);
}

const FILTERS = () => ({ ...DEFAULT_FILTERS, pos: [] });
const POS_CHIPS = ['GB', 'DC', 'DG', 'DD', 'MDC', 'MC', 'MG', 'MD', 'MO', 'AG', 'AD', 'BU'];
const SORTS = { ovr: 'Note', pot: 'Potentiel', value: 'Valeur ↓', cheap: 'Valeur ↑', age: 'Âge', wage: 'Salaire' };
const M = (v) => (v >= 1e6 ? `${Math.round(v / 1e5) / 10} M€` : `${Math.round(v / 1e3)} k€`);

/** Panneau de recherche (filtres façon mode carrière) + résultats. */
function searchPanel(app, mode) {
  const s = app.state;
  const f = (app.ui.mktF ||= FILTERS());
  if (mode === 'loan' && f.status === 'all') f.status = 'loan';
  const opts = (app._fopts ||= filterOptions(s));
  const nOn = ['ageMin', 'ageMax', 'ovrMin', 'potMin', 'valueMax', 'wageMax', 'nat', 'div', 'contract', 'foot', 'budget'].filter((k) => f[k] !== DEFAULT_FILTERS[k]).length + (f.pos.length ? 1 : 0) + (f.status !== DEFAULT_FILTERS.status && mode !== 'loan' ? 1 : 0);
  const sel = (k, list, cur) => `<select data-act="fset" data-k="${k}">${list.map(([v, l]) => `<option value="${esc(v)}" ${String(cur) === String(v) ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
  const range = (k, min, max, st, lbl) => `<label class="fr"><span>${lbl} <b id="fv-${k}">${f[k] ? (k.includes('value') || k.includes('wage') ? M(f[k]) : f[k]) : 'tous'}</b></span><input type="range" data-act="fset" data-k="${k}" min="${min}" max="${max}" step="${st}" value="${f[k]}"></label>`;
  return `<div class="search-box">
    <div class="mkt-tools"><label class="pk-search">🔎<input id="mkt-q" type="search" placeholder="Nom du joueur…" value="${esc(f.q)}" autocomplete="off"></label>
      <select data-act="fset" data-k="sort" title="Trier">${Object.entries(SORTS).map(([k, l]) => `<option value="${k}" ${f.sort === k ? 'selected' : ''}>Tri : ${l}</option>`).join('')}</select></div>
    <div class="chips pos-chips">${['DEF', 'MIL', 'ATT'].map((g) => `<button class="chip ${f.pos.includes(g) ? 'on' : ''}" data-act="fpos" data-v="${g}">${{ DEF: 'Défense', MIL: 'Milieu', ATT: 'Attaque' }[g]}</button>`).join('')}<span class="sep"></span>${POS_CHIPS.map((p) => `<button class="chip ${f.pos.includes(p) ? 'on' : ''}" data-act="fpos" data-v="${p}">${p}</button>`).join('')}</div>
    <details class="card filters" ${app.ui.fOpen ? 'open' : ''}><summary data-act="fopen"><b>⚙ Filtres</b> ${nOn ? `<span class="tag ok">${nOn} actif(s)</span>` : ''}</summary>
      <div class="fgrid">
        <label class="fr"><span>Âge</span><span class="row" style="gap:6px">${sel('ageMin', Array.from({ length: 26 }, (_, i) => [15 + i, `${15 + i} ans`]), f.ageMin)}<small>à</small>${sel('ageMax', Array.from({ length: 26 }, (_, i) => [15 + i, `${15 + i} ans`]), f.ageMax)}</span></label>
        ${range('ovrMin', 0, 90, 1, 'Note min.')}
        ${range('potMin', 0, 95, 1, 'Potentiel min.')}
        ${range('valueMax', 0, 150000000, 250000, 'Prix max.')}
        ${range('wageMax', 0, 400000, 5000, 'Salaire max. /sem')}
        <label class="fr"><span>Nationalité</span>${sel('nat', [['', 'Toutes'], ...opts.nats.map((n) => [n, n])], f.nat)}</label>
        <label class="fr"><span>Championnat</span>${sel('div', [['', 'Tous'], ...opts.divs.map((d) => [d.id, `${COUNTRIES[d.country]?.flag || ''} ${d.name}`])], f.div)}</label>
        <label class="fr"><span>Pied fort</span>${sel('foot', [['', 'Indifférent'], ['D', 'Droit'], ['G', 'Gauche']], f.foot)}</label>
        <label class="fr"><span>Statut</span>${sel('status', [['all', 'Tous'], ['listed', 'Sur la liste / veut partir'], ['free', 'Libres'], ['loan', 'Sous contrat (prêt)']], f.status)}</label>
        <label class="fr chk"><input type="checkbox" data-act="fset" data-k="contract" ${f.contract ? 'checked' : ''}> Contrat expirant (≤ 1 an)</label>
        <label class="fr chk"><input type="checkbox" data-act="fset" data-k="budget" ${f.budget ? 'checked' : ''}> Dans mon budget</label>
      </div>
      <button class="btn sm" data-act="freset">Réinitialiser les filtres</button>
    </details>
    <div id="mkt-list">${marketListHtml(app)}</div></div>`;
}

function marketListHtml(app) {
  const s = app.state;
  const mode = app.ui.mktMode || 'buy';
  const f = app.ui.mktF || FILTERS();
  const { total, rows } = searchPlayers(s, f, app.ui.mktMore ? 150 : 50);
  return `<div class="row between" style="margin:6px 4px"><small class="muted">${total} joueur(s) trouvé(s)${total > rows.length ? ` · ${rows.length} affichés` : ''}</small><small class="muted">${mode === 'loan' ? 'Prix : indemnité de prêt indicative' : 'Prix : demande du club'}</small></div>
    <div class="card list" style="padding:0 10px;margin-top:0">${rows.map(({ p, price }) => marketRow(s, p, mode === 'loan' ? Math.round((p.value || 0) * 0.08 / 25000) * 25000 : price)).join('') || '<p class="muted">Aucun joueur ne correspond à ces critères.</p>'}</div>
    ${total > rows.length && !app.ui.mktMore ? '<button class="btn block" data-act="fmore">Afficher plus de résultats</button>' : ''}`;
}

function marketRow(s, p, price) {
  const uc = userClub(s);
  const c = p.clubId ? clubById(s, p.clubId) : null;
  const e = estimate(s, p);
  return playerRow(p, {
    extra: `· ${c ? esc(c.short) : 'Libre'} · ${esc(p.nat || '')} · pot. ${rangeLabel(e.pot)}`,
    right: `<div class="center" style="min-width:78px">${ovrChip(mid(e.ovr), rangeLabel(e.ovr))}${e.exact ? '' : '<small class="muted" style="font-size:10px"> ≈</small>'}<br><small style="color:${(price ?? 0) <= ensureBoard(s).transferBudget ? 'var(--muted)' : 'var(--bad)'}">${price ? money(price) : c ? '' : 'Libre'}</small></div>`,
  });
}

function staff(app) {
  const s = app.state;
  const uc = userClub(s);
  const fac = uc.facilities;
  const role = app.ui.staffRole || null;
  const pool = (s.staffPool || []).filter((m) => !role || m.role === role).sort((a, b) => b.rating - a.rating);
  const rc = (r) => (r >= 15 ? 'var(--good)' : r >= 10 ? 'var(--ok)' : 'var(--muted)');
  const member = (m, act) => `<div class="prow" style="cursor:default">
      ${portraitSvg(personLook(m.id, m.nat, m.age), 40, '#1c2333')}
      <div class="pname"><b>${esc(m.first)} ${esc(m.last)}</b><small>${STAFF_ROLES[m.role].icon} ${STAFF_ROLES[m.role].label} · ${esc(m.nat)} · ${m.age} ans · ${money(m.wage)}/sem${act === 'fire' ? ` · ${m.contract} an(s)` : ''}</small></div>
      <b style="font-family:var(--display);font-size:22px;color:${rc(m.rating)};min-width:30px;text-align:center">${m.rating}</b>
      <div class="btns" style="flex-direction:column;gap:4px">${act === 'fire' && m.contract <= 1 ? `<button class="btn sm primary" data-act="renewstaff" data-id="${m.id}">Prolonger</button>` : ''}
      <button class="btn sm ${act === 'hire' ? 'primary' : 'danger'}" data-act="${act}staff" data-id="${m.id}">${act === 'hire' ? 'Négocier' : 'Licencier'}</button></div></div>`;
  const byRole = Object.keys(STAFF_ROLES).map((r) => {
    const ms = uc.staffMembers.filter((m) => m.role === r);
    return `${ms.map((m) => member(m, 'fire')).join('')}${ms.length < STAFF_ROLES[r].max ? `<div class="prow" data-act="staffrole" data-v="${r}" style="color:var(--muted)">
      <span class="ic" style="width:40px;text-align:center;font-size:20px">${STAFF_ROLES[r].icon}</span><div class="pname"><b>${STAFF_ROLES[r].label}</b><small>Poste libre${STAFF_ROLES[r].max > 1 ? ` (${ms.length}/${STAFF_ROLES[r].max})` : ''} · ${STAFF_ROLES[r].desc}</small></div><span class="btn sm">Chercher</span></div>` : ''}`;
  }).join('');
  return `<div class="card" style="padding:6px 12px"><div class="row between" style="padding:6px 0"><h3 style="margin:0">Mon staff</h3><small>${money(staffWages(uc))}/sem</small></div>
      <div class="list">${byRole}</div>
      <p class="muted" style="font-size:12px;margin:6px 0">Notes de 1 à 20. Les contrats ne sont pas prolongés automatiquement : « Prolonger » apparaît pendant la dernière année. Licencier coûte 8 semaines de salaire par année de contrat restante.</p></div>
    <div class="card" style="padding:6px 12px"><div class="row between" style="padding:6px 0"><h3 style="margin:0">Marché du staff</h3><small>Prime d'arrivée : 4 semaines</small></div>
      <div class="chips"><button class="chip ${!role ? 'on' : ''}" data-act="staffrole" data-v="">Tous</button>${Object.entries(STAFF_ROLES).map(([k, v]) => `<button class="chip ${role === k ? 'on' : ''}" data-act="staffrole" data-v="${k}">${v.icon} ${v.label}</button>`).join('')}</div>
      <div class="list">${pool.slice(0, 15).map((m) => member(m, 'hire')).join('') || '<p class="muted">Personne de disponible pour ce poste.</p>'}</div></div>
    <div class="card"><h3>Installations</h3>
      <div class="row between"><b>🏋️ Centre d'entraînement</b>${stars(fac.training)}</div>
      <small class="muted">Accélère la progression de tous les joueurs.</small>
      ${fac.training < 5 ? `<button class="btn block" style="margin-top:8px" data-act="trainfac">Améliorer · ${money(trainingUpgradeCost(fac.training))}</button>` : ''}
      <div class="row between" style="margin-top:14px"><b>🏟 Stade</b><b>${uc.stadium.toLocaleString('fr-FR')} places</b></div>
      ${fac.works ? `<p>🚧 Travaux : +${fac.works.seats.toLocaleString('fr-FR')} places, livraison dans ${fac.works.daysLeft} journée(s).</p>`
        : `<small class="muted">Plus de places = plus de recettes, si le public suit.</small>
        <div class="btns" style="margin-top:8px">${STADIUM_OPTIONS.map((o) => `<button class="btn sm" data-act="stadium" data-v="${o.seats}">+${o.seats / 1000}k · ${money(stadiumCost(o.seats))}</button>`).join('')}</div>`}</div>`;
}

function training(s) {
  const uc = userClub(s);
  const t = uc.training;
  return `<div class="card"><h3>Plan hebdomadaire</h3>
      <div class="label" style="margin-top:0">Thème</div>
      <div class="chips" style="flex-wrap:wrap">${Object.entries(TRAINING_FOCUS).map(([k, f]) => `<button class="chip ${t.focus === k ? 'on' : ''}" data-act="tfocus" data-v="${k}">${f.label}</button>`).join('')}</div>
      <p class="muted" style="font-size:13px">${TRAINING_FOCUS[t.focus].desc}</p>
      <div class="label">Intensité</div>${seg('tint', ['low', 'mid', 'high'], t.intensity, INTENSITY)}
      <p class="muted" style="font-size:12px;margin-bottom:0">Intense : progression +45 %, mais fatigue et risque de blessure à l'entraînement. Légère : récupération.</p>
    </div>
    <div class="card"><h3>Effets actuels</h3>
      <div class="row between"><span>Centre d'entraînement</span>${stars(uc.facilities.training)}</div>
      <div class="row between"><span>Entraîneur adjoint</span><b>${bestStaff(uc, 'assistant') || '—'}/20</b></div>
      <div class="row between"><span>Préparateur physique</span><b>${bestStaff(uc, 'fitness') || '—'}/20</b></div>
      <div class="row between"><span>Maîtrise tactique</span><b style="color:${scaleColor(uc.fam ?? 60)}">${Math.round(uc.fam ?? 60)} %</b></div></div>
    ${trainReport(s, uc)}
    ${individualTraining(s, uc)}`;
}

/** Rapport d'entraînement : les dernières progressions (et baisses) observées. */
function trainReport(s, uc) {
  const log = (uc.trainLog || []).filter((x) => s.players[x.pid]).slice(0, 12);
  return `<div class="card"><h3>📋 Rapport d'entraînement</h3>${log.length ? log.map((x) => {
    const p = s.players[x.pid];
    const what = x.learned ? `a appris le poste <b>${x.learned}</b>` : `${x.down ? '<span class="neg-txt">▼</span>' : '<span class="pos-txt">▲</span>'} ${ATTR_LABELS[x.attr] || x.attr} <b>${Math.round((p.attrs[x.attr] || 0) / 5)}</b>/20`;
    return `<div class="row between tr-row" data-act="player" data-id="${p.id}"><span>${posBadge(p.pos)} ${esc(p.name)}</span><span>${what} <small class="muted">· J${x.day + 1}</small></span></div>`;
  }).join('') : '<p class="muted">Les progrès des joueurs s\'afficheront ici au fil des semaines.</p>'}</div>`;
}

/** Entraînement individuel : un attribut à travailler, ou un nouveau poste à apprendre. */
function individualTraining(s, uc) {
  const ps = clubPlayers(s, uc).slice().sort((a, b) => POSITIONS.indexOf(a.pos) - POSITIONS.indexOf(b.pos));
  const opts = (p) => {
    const cur = p.tFocus || '';
    const attrs = Object.keys(ATTR_LABELS).filter((k) => k !== 'arr' || p.pos === 'GB');
    const poss = POSITIONS.filter((x) => x !== p.pos && !(p.pos2 || []).includes(x) && (x === 'GB') === (p.pos === 'GB'));
    return `<option value="" ${!cur ? 'selected' : ''}>Programme collectif</option>
      <optgroup label="Travailler un point">${attrs.map((k) => `<option value="${k}" ${cur === k ? 'selected' : ''}>${ATTR_LABELS[k]}</option>`).join('')}</optgroup>
      ${poss.length ? `<optgroup label="Apprendre un poste">${poss.map((x) => `<option value="pos:${x}" ${cur === 'pos:' + x ? 'selected' : ''}>Poste : ${x}</option>`).join('')}</optgroup>` : ''}`;
  };
  const prog = (p) => {
    if (!p.tFocus?.startsWith('pos:')) return '';
    const v = Math.min(100, Math.round(((p.posXp || {})[p.tFocus.slice(4)] || 0) / 24 * 100));
    return `<span class="mini" title="Apprentissage ${v} %"><i style="width:${v}%;background:var(--info)"></i></span>`;
  };
  return `<div class="card"><h3>🎯 Entraînement individuel</h3>
    <p class="muted" style="font-size:12px;margin-top:0">Chaque joueur peut travailler un point précis (progression ciblée, surtout avant 27 ans) ou apprendre un nouveau poste (environ 20 semaines, plus vite chez les jeunes).</p>
    <div class="ind-list">${ps.map((p) => `<div class="ind-row">${posBadge(p.pos)}<span class="grow">${esc(p.name)} <small class="muted">${p.age} ans${(p.pos2 || []).length ? ` · aussi ${p.pos2.join(', ')}` : ''}</small></span>${prog(p)}
      <select class="sel" data-act="tind" data-id="${p.id}">${opts(p)}</select></div>`).join('')}</div></div>`;
}

/** Avis du responsable des jeunes (potentiel en mots, délai avant d'être prêt). */
function youthVerdict(p, uc) {
  const o = overall(p), pot = p.pot;
  const lvl = pot >= 85 ? 'Pépite : futur joueur de très haut niveau' : pot >= 78 ? 'Futur titulaire en première division' : pot >= 70 ? 'Joueur de rotation en devenir' : pot >= 62 ? 'Joueur de complément' : 'Avenir incertain au plus haut niveau';
  const ready = o >= squadAvg(uc) - 6 ? 'prêt pour l\'équipe première' : `prêt dans ~${Math.max(1, Math.round((squadAvg(uc) - 6 - o) / 3))} an(s)`;
  return `${lvl} · ${ready}`;
}
let _avgCache = null;
function squadAvg(uc) { return _avgCache ?? 65; }

function youth(s) {
  const uc = userClub(s);
  const ys = uc.youthIds.map((id) => s.players[id]).filter(Boolean).sort((a, b) => b.pot - a.pot);
  const seniors = clubPlayers(s, uc).filter((p) => !p.onLoanFrom && p.age >= 27).sort((a, b) => overall(b) - overall(a)).slice(0, 12);
  const xi = clubPlayers(s, uc).map(overall).sort((a, b) => b - a).slice(0, 14);
  _avgCache = xi.reduce((a, v) => a + v, 0) / Math.max(1, xi.length);
  const rec = uc.youthRecruit ?? 2;
  const log = (uc.trainLog || []).filter((x) => x.youth && s.players[x.pid]).slice(0, 6);
  return `<div class="grid2">
    <div class="card"><h3>🏫 Installations du centre</h3>
      <div class="row between"><span>Centre de formation</span>${stars(uc.academy)}</div>
      <small class="muted">Qualité des jeunes formés et vitesse de progression (+${Math.round(((uc.academy || 1) * 0.08 - 0.15) * 100)} % d'entraînement).</small>
      ${uc.academy < 5 ? `<button class="btn block" style="margin-top:8px" data-act="upgrade">Améliorer le centre · ${money(academyCost(uc))}</button>` : ''}
      <div class="row between" style="margin-top:14px"><span>Réseau de recrutement des jeunes</span>${stars(rec)}</div>
      <small class="muted">Potentiel des recrues (${rec >= 3 ? 'talents étrangers repérés' : 'recrutement local'}${rec >= 4 ? ', une recrue de plus par été' : ''}).</small>
      ${rec < 5 ? `<button class="btn block" style="margin-top:8px" data-act="yrec">Développer le réseau · ${money(youthRecruitCost(uc))}</button>` : ''}
    </div>
    <div class="card"><h3>📅 Prochaines fournées</h3>
      <p style="margin:0 0 6px">Une recrue à la mi-saison, ${2 + (uc.academy >= 4 ? 1 : 0) + (rec >= 4 ? 1 : 0)} chaque été.</p>
      <small class="muted">Les jeunes s'entraînent chaque semaine avec le programme du club. Un tuteur expérimenté accélère leur progression (+15 %) et les met en confiance.</small>
      ${log.length ? `<div class="label">Derniers progrès</div>${log.map((x) => `<div class="row between" style="font-size:13px;padding:3px 0"><span>${esc(s.players[x.pid].name)}</span><span class="pos-txt">▲ ${x.attr || x.learned}</span></div>`).join('')}` : ''}
    </div></div>
    <div class="label">Jeunes du centre (${ys.length})</div>
    <div class="youth-grid">${ys.map((p) => `<div class="card ycard">
      <div class="row" style="gap:10px">${face(p, uc, 'md')}<div class="grow"><b data-act="player" data-id="${p.id}" style="cursor:pointer">${esc(p.name)}</b><br><small class="muted">${posBadge(p.pos)} ${p.age} ans · ${esc(p.nat || '')}</small></div>
        <div class="center"><small class="muted">Actuel</small><br>${noteChip(overall(p))}</div><div class="center"><small class="muted">Potentiel</small><br>${noteChip(p.pot)}</div></div>
      <p class="yverdict">${esc(youthVerdict(p, uc))}</p>
      <div class="row" style="gap:6px;flex-wrap:wrap"><select class="sel" data-act="mentor" data-id="${p.id}"><option value="">Sans tuteur</option>${seniors.map((m) => `<option value="${m.id}" ${p.mentor === m.id ? 'selected' : ''}>Tuteur : ${esc(m.name)} (${m.pos})</option>`).join('')}</select>
        <button class="btn sm primary" data-act="ypromote" data-id="${p.id}">Promouvoir</button><button class="btn sm danger" data-act="yrelease" data-id="${p.id}">Libérer</button></div>
    </div>`).join('') || '<p class="muted">Nouvelle promotion à la mi-saison et chaque été.</p>'}</div>`;
}

function career(s) {
  const uc = userClub(s);
  const pos = tablePosition(s, uc.id);
  const o = s.objectives;
  const ok = pos <= o.league.target;
  const cup = s.cups[uc.country];
  const cupState = !o.cup ? null : cup.alive.includes(uc.id) ? 'En course' : 'Éliminé';
  const contiState = !o.conti ? null : (s.contis?.[o.conti.id] || Object.values(s.contis || {}).find((c) => c.teams.includes(uc.id)))?.alive.includes(uc.id) ? 'En course' : 'Éliminé';
  const c = ensureCoachProfile(s.coach);
  return `<div class="card"><h3>Confiance du board</h3>
      <div class="row between"><b style="font-size:22px;color:${scaleColor(s.board.confidence)}">${Math.round(s.board.confidence)}%</b>
      <small>${s.board.confidence < 25 ? 'Votre poste est menacé !' : s.board.confidence < 50 ? 'Le board s\'impatiente.' : 'Le board vous soutient.'}</small></div>
      ${gauge(s.board.confidence)}</div>
    <div class="card"><h3>Objectifs ${s.season}-${s.season + 1}</h3>
      <div class="row" style="padding:6px 0"><span class="grow">🏁 ${esc(o.league.label)}</span><span class="tag ${ok ? 'good' : 'bad'}">${pos}e</span></div>
      ${o.cup ? `<div class="row" style="padding:6px 0"><span class="grow">🏆 ${esc(o.cup.label)}</span><span class="tag ${cupState === 'Éliminé' ? 'bad' : 'good'}">${cupState}</span></div>` : ''}
      ${o.conti ? `<div class="row" style="padding:6px 0"><span class="grow">⭐ ${esc(o.conti.label)}</span><span class="tag ${contiState === 'Éliminé' ? 'bad' : 'good'}">${contiState}</span></div>` : ''}
      <div class="row" style="padding:6px 0"><span class="grow">💶 ${esc(o.finance.label)}</span><span class="tag ${uc.budget >= 0 ? 'good' : 'bad'}">${money(uc.budget)}</span></div>
    </div>
    <div class="card"><h3>Mon coach</h3>
      <div class="row" style="gap:14px">${avatarSvg(c.look, 76)}<div class="grow"><b style="font-family:var(--display);font-size:22px">${esc(coachName(c))}</b><br>
        <small>${esc(c.nationality)} · ${c.age} ans · ${esc(PHILOSOPHIES[c.philosophy].label)} · ${esc(c.formation)}</small></div></div>
      ${SKILL_KEYS.map((k) => `<div class="attr"><span>${COACH_SKILLS[k].label}</span>${gauge(c.skills[k] * 5, scaleColor(c.skills[k] * 5))}<span class="v">${c.skills[k]}</span></div>`).join('')}
      ${c.points ? `<p style="margin:8px 0 0"><span class="tag good">${c.points} point(s) à dépenser</span></p>` : ''}
      <button class="btn block" style="margin-top:10px" data-act="editcoach">✎ Personnaliser mon coach</button></div>
    <div class="card"><h3>Votre carrière</h3>
      <div class="row between"><span>Réputation</span><b style="color:${scaleColor(c.rep)}">${Math.round(c.rep)}/100</b></div>${gauge(c.rep)}
      <div class="row between" style="margin-top:8px"><span>Bilan</span><b>${c.w} V · ${c.d} N · ${c.l} D</b></div>
      <div class="row between"><span>Clubs</span><small>${c.clubs.map(esc).join(' → ')}</small></div>
      <div style="margin-top:8px">${c.trophies.length ? c.trophies.map((t) => `<span class="tag good" style="display:inline-block;margin:2px">🏆 ${esc(t)}</span>`).join('') : '<small class="muted">Pas encore de trophée.</small>'}</div>
      <p class="muted" style="font-size:12px;margin-bottom:0">Une bonne réputation attire les offres de clubs plus prestigieux (en cours de saison et en fin de saison).</p></div>
    <div class="card"><h3>Historique</h3>
      ${s.history.length ? s.history.slice().reverse().map((h) => `<div class="row between" style="padding:4px 0"><span>${h.season}-${h.season + 1} <small>${esc(h.club || '')}</small></span><span>${DIV_NAMES[h.div]} · <b>${h.pos}e</b>${h.cup ? ' · 🏆' : ''}${h.conti ? ' · ⭐' : ''}</span></div>`).join('') : '<p class="muted">Première saison.</p>'}
    </div>`;
}

export function mount(app, root) {
  const qi = root.querySelector('#mkt-q');
  if (qi) {
    let t = 0;
    qi.addEventListener('input', () => {
      clearTimeout(t);
      t = setTimeout(() => { (app.ui.mktF ||= FILTERS()).q = qi.value; const box = root.querySelector('#mkt-list'); if (box) box.innerHTML = marketListHtml(app); }, 180);
    });
    if (app.ui.mktF?.q) { qi.focus(); qi.setSelectionRange(qi.value.length, qi.value.length); }
  }
  if ((app.ui.clubTab || 'fin') === 'friends') return friends.mount?.(app, root);
  if ((app.ui.clubTab || 'fin') === 'settings') return settings.mount?.(app, root);
}

const done = (app, r) => { app.toast(r.msg); if (r.ok) app.save(); app.render(); };

export const actions = {
  ...settings.actions,
  ...friends.actions,
  ctab(el, app) { app.ui.clubTab = el.dataset.v; app.render(); },
  split(el, app) { if (el.tagName !== 'INPUT') return; const r = setSplit(app.state, +el.value / 100); if (r.msg) app.toast(r.ok ? `Enveloppes : ${el.value} % transferts` : r.msg); app.save(); app.render(); },
  alloc(el, app) { if (el.tagName !== 'SELECT') return; const uc = userClub(app.state); (uc.alloc ||= { scout: 1, youth: 1, medical: 1 })[el.dataset.k] = +el.value; app.save(); app.render(); },
  deal(el, app) { import('./deals.js').then((mod) => mod.dealSheet(app, +el.dataset.id, () => app.render())); },
  shift(el, app) { done(app, shiftBudget(app.state, +el.dataset.v)); },
  req(el, app) { const r = boardRequest(app.state, el.dataset.v); app.toast(r.msg, 3500); app.save(); app.render(); },
  editcoach(el, app) { openCoachEditor(app, { mode: 'edit' }); },
  ticket(el, app) { userClub(app.state).ticket = el.dataset.v; app.save(); app.render(); },
  myclub(el, app) { showClub(app, app.state.userClubId); },
  mmode(el, app) { app.ui.mktMode = el.dataset.v; if (app.ui.mktF) app.ui.mktF.status = el.dataset.v === 'loan' ? 'loan' : app.ui.mktF.status === 'loan' ? 'all' : app.ui.mktF.status; app.render(); },
  fset(el, app) {
    if (el.tagName !== 'SELECT' && el.tagName !== 'INPUT') return;
    const f = (app.ui.mktF ||= FILTERS()), k = el.dataset.k;
    f[k] = el.type === 'checkbox' ? el.checked : ['nat', 'div', 'foot', 'status', 'sort'].includes(k) ? el.value : +el.value;
    app.ui.mktMore = false;
    // Curseurs : on met à jour la liste sans redessiner le panneau (le geste continue).
    if (el.type === 'range') {
      const lbl = document.getElementById(`fv-${k}`);
      if (lbl) lbl.textContent = f[k] ? (k.includes('value') || k.includes('wage') ? M(f[k]) : f[k]) : 'tous';
      clearTimeout(app._fT); app._fT = setTimeout(() => { const box = document.getElementById('mkt-list'); if (box) box.innerHTML = marketListHtml(app); }, 220);
      return;
    }
    app.render();
  },
  fpos(el, app) { const f = (app.ui.mktF ||= FILTERS()); const v = el.dataset.v; f.pos = f.pos.includes(v) ? f.pos.filter((x) => x !== v) : [...f.pos, v]; app.render(); },
  freset(el, app) { app.ui.mktF = FILTERS(); app.render(); },
  fopen(el, app) { app.ui.fOpen = !el.closest('details').open; },
  fmore(el, app) { app.ui.mktMore = true; const box = document.getElementById('mkt-list'); if (box) box.innerHTML = marketListHtml(app); },

  mpos(el, app) { app.ui.mktPos = el.dataset.v || null; app.render(); },
  maff(el, app) { app.ui.mktAff = !app.ui.mktAff; app.render(); },
  player(el, app) { showPlayer(app, +el.dataset.id); },
  upgrade(el, app) { done(app, upgradeAcademy(app.state)); },
  yrec(el, app) { done(app, upgradeYouthRecruit(app.state)); },
  mentor(el, app) { if (el.tagName !== 'SELECT') return; const p = app.state.players[+el.dataset.id]; if (p) { p.mentor = el.value ? +el.value : null; app.save(); app.toast(el.value ? `Tuteur assigné à ${p.name}.` : 'Plus de tuteur.'); } },
  ypromote(el, app) { done(app, promoteYouth(app.state, +el.dataset.id)); },
  async yrelease(el, app) { const p = app.state.players[+el.dataset.id]; if (!(await app.confirm('Libérer ce jeune ?', `${p.name} quittera définitivement le centre.`, 'Libérer', true))) return; done(app, releaseYouth(app.state, p.id)); },
  staffrole(el, app) { app.ui.staffRole = el.dataset.v || null; app.render(); },
  hirestaff(el, app) { staffNegotiation(app, el.dataset.id, false); },
  renewstaff(el, app) { staffNegotiation(app, el.dataset.id, true); },
  mission(el, app) { missionSheet(app, el.dataset.id); },
  async firestaff(el, app) {
    const m = userClub(app.state).staffMembers.find((x) => x.id === el.dataset.id);
    if (!(await app.confirm(`Licencier ${m.first} ${m.last} ?`, `Indemnité : ${money(m.wage * 8 * Math.max(1, m.contract))}`, 'Licencier', true))) return;
    done(app, fireStaff(app.state, el.dataset.id));
  },
  trainfac(el, app) { done(app, upgradeTraining(app.state)); },
  async stadium(el, app) {
    const seats = +el.dataset.v;
    if (!(await app.confirm('Agrandir le stade ?', `+${seats.toLocaleString('fr-FR')} places pour ${money(stadiumCost(seats))}.`, 'Lancer les travaux'))) return;
    done(app, expandStadium(app.state, seats));
  },
  tfocus(el, app) { userClub(app.state).training.focus = el.dataset.v; app.save(); app.render(); },
  tint(el, app) { userClub(app.state).training.intensity = el.dataset.v; app.save(); app.render(); },
  tind(el, app) { if (el.tagName !== 'SELECT') return; const p = app.state.players[+el.dataset.id]; if (p) { p.tFocus = el.value || null; app.save(); app.toast(el.value ? `${p.name} : programme individuel enregistré.` : `${p.name} suit le programme collectif.`); } },
  accept(el, app) {
    const o = app.state.pendingOffers.find((x) => x.pid === +el.dataset.id);
    done(app, sellPlayer(app.state, o));
  },
  counter(el, app) {
    const o = app.state.pendingOffers.find((x) => x.pid === +el.dataset.id);
    done(app, { ...counterIncoming(app.state, o, 1.15, gameRng(app.state)), ok: true });
  },
  decline(el, app) { app.state.pendingOffers = app.state.pendingOffers.filter((x) => x.pid !== +el.dataset.id); app.save(); app.render(); },
};

export { CONTI_NAME };

/** Négociation d'un contrat de staff (embauche ou prolongation). */
function staffNegotiation(app, id, renew) {
  const s = app.state;
  const m = renew ? userClub(s).staffMembers.find((x) => x.id === id) : s.staffPool.find((x) => x.id === id);
  if (!m) return;
  const d = staffDemand(s, m, renew);
  const offer = { wage: Math.round(d.wage * 0.9 / 100) * 100, years: d.years };
  const log = [];
  let over = false;
  const html = () => `<h2>${renew ? 'Prolongation' : 'Embauche'} · ${esc(m.first)} ${esc(m.last)}</h2>
    <p class="muted" style="margin-top:0">${STAFF_ROLES[m.role].icon} ${STAFF_ROLES[m.role].label} · note <b>${m.rating}/20</b> · ${m.age} ans${renew ? ` · actuel ${money(m.wage)}/sem` : ''}</p>
    <p class="muted">${d.refuses ? '⚠ Il juge votre club trop modeste pour lui.' : `Il souhaite environ <b>${money(d.wage)}/sem</b> sur <b>${d.years} an(s)</b>.`}${renew ? '' : ` Prime d'arrivée : 4 semaines de salaire.`}</p>
    <div class="card" style="margin-top:0">
      <div class="formrow"><span>Salaire / sem</span><b>${money(offer.wage)}</b></div>
      <div class="btns"><button class="btn sm" data-act="w" data-v="-500">−500</button><button class="btn sm" data-act="w" data-v="-100">−100</button><button class="btn sm" data-act="w" data-v="100">+100</button><button class="btn sm" data-act="w" data-v="500">+500</button></div>
      <div class="formrow"><span>Durée</span><select data-act="years">${[1, 2, 3, 4].map((y) => `<option value="${y}" ${y === offer.years ? 'selected' : ''}>${y} an(s)</option>`).join('')}</select></div>
      <p class="muted" style="font-size:12px;margin:6px 0 0">Chaque année d'écart avec son souhait fait varier le salaire attendu de 4 %. 3 essais avant la rupture.</p>
    </div>
    ${log.map((l) => `<div class="msg"><span class="ic">${l.icon}</span><div class="grow">${esc(l.text)}</div></div>`).join('')}
    ${over ? '<button class="btn primary block" data-act="close">Terminer</button>'
      : '<div class="btns"><button class="btn" data-act="close">Abandonner</button><button class="btn primary" data-act="propose">Proposer</button></div>'}`;
  const h = app.sheet({
    html,
    actions: {
      w: (el) => { offer.wage = Math.max(300, offer.wage + +el.dataset.v); h.update(html()); },
      years: (el) => { offer.years = +el.value; },
      propose: () => {
        const r = staffOffer(s, id, offer, renew);
        log.push({ icon: r.kind === 'accept' ? '✍' : r.kind === 'counter' ? '↩' : '❌', text: r.msg });
        if (r.kind === 'counter') offer.wage = r.counter;
        if (r.kind === 'accept' || r.kind === 'end') over = true;
        if (r.ok) { app.toast(r.msg); app.save(); app.render(); }
        h.update(html());
      },
    },
  });
}

/** Choix de la mission d'un recruteur. */
function missionSheet(app, sid) {
  const s = app.state;
  const sel = { region: 'ALL', pos: '', maxAge: '' };
  const h = app.sheet({
    html: () => `<h2>🔭 Nouvelle mission</h2>
      <div class="card" style="margin-top:0">
        <div class="formrow"><span>Région</span><select data-act="mr">${Object.entries(REGIONS).map(([k, l]) => `<option value="${k}" ${k === sel.region ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
        <div class="formrow"><span>Poste</span><select data-act="mp"><option value="">Tous</option>${POSITIONS.map((p) => `<option value="${p}">${p}</option>`).join('')}</select></div>
        <div class="formrow"><span>Âge maximum</span><select data-act="ma"><option value="">Aucun</option>${[19, 21, 23, 26, 29].map((a) => `<option value="${a}">${a} ans</option>`).join('')}</select></div>
      </div>
      <div class="btns"><button class="btn" data-act="close">Annuler</button><button class="btn primary" data-act="go">Lancer (${MISSION_DAYS} journées)</button></div>`,
    actions: {
      mr: (el) => { sel.region = el.value; },
      mp: (el) => { sel.pos = el.value; },
      ma: (el) => { sel.maxAge = el.value; },
      go: () => {
        const r = startMission(s, sid, { region: sel.region, pos: sel.pos || null, maxAge: sel.maxAge ? +sel.maxAge : null });
        app.toast(r.msg, 3000); if (r.ok) app.save(); h.close(); app.render();
      },
    },
  });
}
