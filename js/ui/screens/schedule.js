/**
 * Calendrier & classements : championnats, matchs du club, buteurs,
 * coupes (nationales + continentale), sélections nationales.
 */
import { sortedTable, topScorers, CUP_ROUND_NAMES, CONTI_ROUND_NAMES, contiGroupTable, nationRanking, DIVISIONS, DIV_IDS, COUNTRIES, CONTI_NAME } from '../../game/season.js';
import { userClub, clubById } from '../../game/state.js';
import { esc, crest, seg, posBadge } from '../components.js';

export function render(app) {
  const s = app.state;
  const uc = userClub(s);
  const tab = app.ui.schedTab || 'table';
  const div = app.ui.schedDiv || uc.div;
  let body = '';
  if (tab === 'table') body = table(s, div, uc);
  else if (tab === 'fixtures') body = fixtures(s, uc);
  else if (tab === 'scorers') body = scorers(s, div);
  else if (tab === 'cup') body = cups(app, s, uc);
  else body = nations(s, uc);
  return `<div class="chips" style="margin-top:6px">${[['table', 'Classement'], ['fixtures', 'Matchs'], ['scorers', 'Buteurs'], ['cup', 'Coupes'], ['nations', 'Sélections']]
    .map(([k, l]) => `<button class="chip ${tab === k ? 'on' : ''}" data-act="stab" data-v="${k}">${l}</button>`).join('')}</div>
    ${tab === 'table' || tab === 'scorers' ? `<div class="chips" style="margin-top:4px">${DIV_IDS.map((d) => `<button class="chip ${d === div ? 'on' : ''}" data-act="sdiv" data-v="${d}">${COUNTRIES[DIVISIONS[d].country].flag} ${DIVISIONS[d].short}</button>`).join('')}</div>` : ''}
    ${body}`;
}

function table(s, div, uc) {
  const rows = sortedTable(s, div);
  const zone = (i) => (div === 1 ? (i < 4 ? 'zone-eu' : i >= 17 ? 'zone-down' : '') : div === 2 ? (i < 3 ? 'zone-up' : '') : (i < 5 ? 'zone-eu' : ''));
  return `<div class="card" style="padding:6px 8px"><div class="label" style="margin-top:4px">${esc(DIVISIONS[div].name)}</div><table class="tbl">
    <thead><tr><th class="l">#</th><th class="l">Club</th><th>J</th><th>Diff</th><th>Pts</th><th>Forme</th></tr></thead>
    <tbody>${rows.map((r, i) => `<tr class="${r.id === uc.id ? 'me' : ''}">
      <td class="l ${zone(i)}">${i + 1}</td>
      <td class="l"><span class="clubcell">${crest(r.club, 'sm')}${esc(r.club.name)}</span></td>
      <td>${r.p}</td><td>${r.gd > 0 ? '+' : ''}${r.gd}</td><td><b>${r.pts}</b></td>
      <td>${r.form.slice(-3).map((f) => `<span class="dot" style="width:7px;height:7px;margin-left:2px;background:${f === 'V' ? 'var(--good)' : f === 'N' ? '#8b949e' : 'var(--bad)'}"></span>`).join('')}</td>
    </tr>`).join('')}</tbody></table>
    <p class="muted" style="font-size:11px;margin:8px 4px 2px">${div === 1 ? `<span style="color:var(--info)">▌</span> ${CONTI_NAME} · <span style="color:var(--bad)">▌</span> Relégation` : div === 2 ? '<span style="color:var(--good)">▌</span> Promotion' : `<span style="color:var(--info)">▌</span> ${CONTI_NAME}`}</p></div>`;
}

/** Tous les matchs du club de l'utilisateur, toutes compétitions. */
function fixtures(s, uc) {
  const items = s.calendar.map((e, day) => {
    let f = null, label;
    if (e.type === 'league') {
      f = s.fixtures[uc.div][e.round].find((x) => x.h === uc.id || x.a === uc.id);
      label = `J${e.round + 1}`;
    } else if (e.type === 'cup') {
      const cup = s.cups[uc.country];
      const cr = e.round - (5 - cup.nRounds);
      if (cr < 0) return '';
      f = cup.rounds[cr]?.find((x) => x.h === uc.id || x.a === uc.id);
      label = `🏆 ${CUP_ROUND_NAMES[e.round]}`;
      if (!f) return day >= s.day && cup.alive.includes(uc.id) ? line(label, 'Tirage à venir', day === s.day) : '';
    } else if (e.type === 'conti') {
      if (!s.conti.teams.includes(uc.id)) return '';
      f = e.round < 3 ? s.conti.gfix[e.round].find((x) => x.h === uc.id || x.a === uc.id) : s.conti.ko[e.round - 3]?.find((x) => x.h === uc.id || x.a === uc.id);
      label = `⭐ ${CONTI_ROUND_NAMES[e.round]}`;
      if (!f) return day >= s.day && s.conti.alive.includes(uc.id) ? line(label, 'Tirage à venir', day === s.day) : '';
    } else {
      return `<div class="row" style="padding:8px 2px;border-bottom:1px solid var(--line);opacity:.6"><small>🌍 Trêve internationale</small></div>`;
    }
    if (!f) return '';
    const home = f.h === uc.id;
    const opp = clubById(s, home ? f.a : f.h);
    let res = '';
    if (f.s) {
      const my = home ? f.s[0] : f.s[1], th = home ? f.s[1] : f.s[0];
      let r = my > th ? 'V' : my < th ? 'D' : 'N';
      if (r === 'N' && f.pens) r = (home ? f.pens[0] > f.pens[1] : f.pens[1] > f.pens[0]) ? 'V' : 'D';
      if (r === 'N' && f.w) r = f.w === uc.id ? 'V' : 'D';
      res = `<b class="num">${f.s[0]}-${f.s[1]}</b> <span class="pill ${r}">${r}</span>`;
    } else res = `<small>${day === s.day ? '<b style="color:var(--accent)">Prochain</b>' : ''}</small>`;
    return `<div class="row" id="${day === s.day ? 'nextfx' : ''}" style="padding:8px 2px;border-bottom:1px solid var(--line);${day === s.day ? 'background:var(--card2);border-radius:8px' : ''}">
      <small style="width:86px">${label}</small>${crest(opp, 'sm')}
      <span class="grow">${home ? '' : '@ '}${esc(opp.name)}</span>${res}</div>`;
  }).join('');
  return `<div class="card" style="padding:4px 10px">${items}</div>`;
}
function line(label, txt, cur) {
  return `<div class="row" style="padding:10px 2px;border-bottom:1px solid var(--line)" id="${cur ? 'nextfx' : ''}"><small class="grow">${label}</small><small>${txt}</small></div>`;
}

function scorers(s, div) {
  const list = topScorers(s, div, 20);
  if (!list.length) return '<div class="card"><p class="muted">Aucun but marqué pour le moment.</p></div>';
  return `<div class="card list" style="padding:0 10px">${list.map((p, i) => {
    const c = clubById(s, p.clubId);
    return `<div class="prow" data-act="player" data-id="${p.id}"><b style="width:22px">${i + 1}</b>${posBadge(p.pos)}
      <div class="pname"><b>${esc(p.name)}</b><small>${c ? esc(c.name) : ''}</small></div>
      <div class="center"><b style="font-size:18px">${p.stats.lgoals}</b><br><small>${p.stats.assists} pd</small></div></div>`;
  }).join('')}</div>`;
}

function tie(s, t, uc) {
  const h = clubById(s, t.h), a = clubById(s, t.a);
  const me = t.h === uc.id || t.a === uc.id;
  return `<div class="row" style="padding:6px 0;border-bottom:1px solid var(--line);${me ? 'font-weight:700' : ''}">
    <span class="grow" style="text-align:right;${t.w === t.a ? 'opacity:.5' : ''}">${esc(h.name)}</span>
    <b class="num" style="min-width:58px;text-align:center">${t.s ? `${t.s[0]}-${t.s[1]}` : 'vs'}${t.pens ? `<br><small>${t.pens[0]}-${t.pens[1]} tab</small>` : ''}</b>
    <span class="grow" style="${t.w === t.h ? 'opacity:.5' : ''}">${esc(a.name)}</span></div>`;
}

function cups(app, s, uc) {
  const which = app.ui.cupWhich || uc.country;
  const keys = [...Object.keys(s.cups), 'conti'];
  let html = `<div class="chips" style="margin-top:4px">${keys.map((k) => `<button class="chip ${k === which ? 'on' : ''}" data-act="cupw" data-v="${k}">${k === 'conti' ? '⭐ ' + CONTI_NAME : COUNTRIES[k].flag + ' ' + s.cups[k].name}</button>`).join('')}</div>`;
  if (which === 'conti') {
    const c = s.conti;
    html += [0, 1, 2, 3].map((g) => `<div class="label">Groupe ${'ABCD'[g]}</div><div class="card" style="padding:6px 8px;margin-top:0"><table class="tbl"><tbody>
      ${contiGroupTable(s, g).map((r, i) => `<tr class="${r.id === uc.id ? 'me' : ''}"><td class="l ${i < 2 ? 'zone-up' : ''}">${i + 1}</td>
        <td class="l"><span class="clubcell">${crest(r.club, 'sm')}${esc(r.club.name)}</span></td><td>${r.p}</td><td>${r.gd > 0 ? '+' : ''}${r.gd}</td><td><b>${r.pts}</b></td></tr>`).join('')}
      </tbody></table></div>`).join('');
    html += c.ko.map((ties, r) => `<div class="label">${CONTI_ROUND_NAMES[r + 3]}</div><div class="card" style="padding:4px 10px;margin-top:0">${ties.map((t) => tie(s, t, uc)).join('')}</div>`).join('');
    if (c.winner) html += `<div class="card center">⭐ <b>${esc(clubById(s, c.winner).name)}</b> remporte la ${CONTI_NAME}</div>`;
    return html;
  }
  const cup = s.cups[which];
  if (!cup.rounds.length) return html + `<div class="card"><p class="muted">Premier tour après la 6e journée. ${cup.alive.includes(uc.id) ? 'Vous êtes qualifié.' : ''}</p></div>`;
  html += cup.rounds.map((ties, r) => `<div class="label">${CUP_ROUND_NAMES[r + (5 - cup.nRounds)]}</div><div class="card" style="padding:4px 10px;margin-top:0">${ties.map((t) => tie(s, t, uc)).join('')}</div>`).join('');
  if (cup.winner) html += `<div class="card center">🏆 <b>${esc(clubById(s, cup.winner).name)}</b> remporte la ${esc(cup.name)}</div>`;
  return html;
}

function nations(s, uc) {
  const rank = nationRanking(s);
  const mine = new Map();
  for (const id of uc.playerIds) { const p = s.players[id]; if (p?.caps) mine.set(p.nat, (mine.get(p.nat) || []).concat(p.name)); }
  const last = [...s.intl.breaks].reverse().find(Boolean);
  return `${last ? `<div class="label">Derniers matchs internationaux</div><div class="card" style="padding:4px 10px;margin-top:0">${last.map((g) => `<div class="row" style="padding:5px 0;border-bottom:1px solid var(--line)">
      <span class="grow" style="text-align:right">${esc(g.h)}</span><b class="num" style="min-width:50px;text-align:center">${g.s ? `${g.s[0]}-${g.s[1]}` : 'vs'}</b><span class="grow">${esc(g.a)}</span></div>`).join('')}</div>` : '<p class="muted" style="margin:10px 4px">Première trêve internationale après la 9e journée.</p>'}
    <div class="label">Classement mondial (Elo)</div>
    <div class="card" style="padding:6px 8px;margin-top:0"><table class="tbl"><thead><tr><th class="l">#</th><th class="l">Nation</th><th>J</th><th>V-N-D</th><th>Elo</th></tr></thead><tbody>
    ${rank.map((r, i) => `<tr><td class="l">${i + 1}</td><td class="l">${esc(r.name)}${mine.has(r.name) ? ' <small>★</small>' : ''}</td><td>${r.p}</td><td>${r.w}-${r.d}-${r.l}</td><td><b>${r.elo}</b></td></tr>`).join('')}
    </tbody></table><p class="muted" style="font-size:11px;margin:6px 4px 0">★ nation d'au moins un de vos internationaux</p></div>`;
}

export function mount(app, root) {
  if ((app.ui.schedTab || 'table') === 'fixtures') root.querySelector('#nextfx')?.scrollIntoView({ block: 'center' });
}

export const actions = {
  stab(el, app) { app.ui.schedTab = el.dataset.v; app.render(); },
  sdiv(el, app) { app.ui.schedDiv = +el.dataset.v; app.render(); },
  cupw(el, app) { app.ui.cupWhich = el.dataset.v; app.render(); },
  async player(el, app) { (await import('./playerSheet.js')).showPlayer(app, +el.dataset.id); },
};
