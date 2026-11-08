/**
 * Calendrier & classement : tableau, résultats/prochains matchs, buteurs, coupe.
 */
import { sortedTable, topScorers, CUP_ROUND_NAMES, DIV_NAMES } from '../../game/season.js';
import { userClub, clubById } from '../../game/state.js';
import { esc, crest, formPills, seg, posBadge } from '../components.js';

export function render(app) {
  const s = app.state;
  const uc = userClub(s);
  const tab = app.ui.schedTab || 'table';
  const div = app.ui.schedDiv || uc.div;
  let body = '';
  if (tab === 'table') body = table(s, div, uc);
  else if (tab === 'fixtures') body = fixtures(s, uc);
  else if (tab === 'scorers') body = scorers(s, div);
  else body = cup(s, uc);
  return `<div style="margin-top:6px">${seg('stab', ['table', 'fixtures', 'scorers', 'cup'], tab, { table: 'Classement', fixtures: 'Matchs', scorers: 'Buteurs', cup: 'Coupe' })}</div>
    ${tab === 'table' || tab === 'scorers' ? `<div class="chips" style="margin-top:8px">${[1, 2].map((d) => `<button class="chip ${d === div ? 'on' : ''}" data-act="sdiv" data-v="${d}">${DIV_NAMES[d]}</button>`).join('')}</div>` : ''}
    ${body}`;
}

function table(s, div, uc) {
  const rows = sortedTable(s, div);
  const zone = (i) => (div === 1 ? (i < 4 ? 'zone-eu' : i >= 17 ? 'zone-down' : '') : (i < 3 ? 'zone-up' : ''));
  return `<div class="card" style="padding:6px 8px"><table class="tbl">
    <thead><tr><th class="l">#</th><th class="l">Club</th><th>J</th><th>Diff</th><th>Pts</th><th>Forme</th></tr></thead>
    <tbody>${rows.map((r, i) => `<tr class="${r.id === uc.id ? 'me' : ''}">
      <td class="l ${zone(i)}">${i + 1}</td>
      <td class="l"><span class="clubcell">${crest(r.club, 'sm')}${esc(r.club.name)}</span></td>
      <td>${r.p}</td><td>${r.gd > 0 ? '+' : ''}${r.gd}</td><td><b>${r.pts}</b></td>
      <td>${r.form.slice(-3).map((f) => `<span class="dot" style="width:7px;height:7px;margin-left:2px;background:${f === 'V' ? 'var(--good)' : f === 'N' ? '#8b949e' : 'var(--bad)'}"></span>`).join('')}</td>
    </tr>`).join('')}</tbody></table>
    <p class="muted" style="font-size:11px;margin:8px 4px 2px">${div === 1 ? '<span style="color:var(--info)">▌</span> Top 4 · <span style="color:var(--bad)">▌</span> Relégation' : '<span style="color:var(--good)">▌</span> Promotion'}</p></div>`;
}

function fixtures(s, uc) {
  const items = s.calendar.map((e, day) => {
    let f, label;
    if (e.type === 'league') {
      f = s.fixtures[uc.div][e.round].find((x) => x.h === uc.id || x.a === uc.id);
      label = `J${e.round + 1}`;
    } else {
      f = s.cup.rounds[e.round]?.find((x) => x.h === uc.id || x.a === uc.id);
      label = `Coupe · ${CUP_ROUND_NAMES[e.round]}`;
      if (!f) return day >= s.day && s.cup.alive.includes(uc.id) ? `<div class="row" style="padding:10px 2px;border-bottom:1px solid var(--line)"><small class="grow">${label}</small><small>Tirage à venir</small></div>` : '';
    }
    if (!f) return '';
    const home = f.h === uc.id;
    const opp = clubById(s, home ? f.a : f.h);
    let res = '';
    if (f.s) {
      const my = home ? f.s[0] : f.s[1], th = home ? f.s[1] : f.s[0];
      let r = my > th ? 'V' : my < th ? 'D' : 'N';
      if (r === 'N' && f.pens) r = (home ? f.pens[0] > f.pens[1] : f.pens[1] > f.pens[0]) ? 'V' : 'D';
      res = `<b class="num">${f.s[0]}-${f.s[1]}</b> <span class="pill ${r}">${r}</span>`;
    } else res = `<small>${day === s.day ? '<b style="color:var(--accent)">Prochain</b>' : ''}</small>`;
    return `<div class="row" id="${day === s.day ? 'nextfx' : ''}" style="padding:8px 2px;border-bottom:1px solid var(--line);${day === s.day ? 'background:var(--card2);border-radius:8px' : ''}">
      <small style="width:62px">${label}</small>${crest(opp, 'sm')}
      <span class="grow">${home ? '' : '@ '}${esc(opp.name)}</span>${res}</div>`;
  }).join('');
  return `<div class="card" style="padding:4px 10px">${items}</div>`;
}

function scorers(s, div) {
  const list = topScorers(s, div, 20);
  if (!list.length) return '<div class="card"><p class="muted">Aucun but marqué pour le moment.</p></div>';
  return `<div class="card list" style="padding:0 10px">${list.map((p, i) => {
    const c = clubById(s, p.clubId);
    return `<div class="prow" style="cursor:default"><b style="width:22px">${i + 1}</b>${posBadge(p.pos)}
      <div class="pname"><b>${esc(p.name)}</b><small>${c ? esc(c.name) : ''}</small></div>
      <div class="center"><b style="font-size:18px">${p.stats.lgoals}</b><br><small>${p.stats.assists} pd</small></div></div>`;
  }).join('')}</div>`;
}

function cup(s, uc) {
  if (!s.cup.rounds.length) return `<div class="card"><p class="muted">Premier tour après la 6e journée. ${s.cup.alive.includes(uc.id) ? 'Vous êtes qualifié.' : "Votre club n'est pas engagé cette saison."}</p></div>`;
  return s.cup.rounds.map((ties, r) => `<div class="label">${CUP_ROUND_NAMES[r]}</div><div class="card" style="padding:4px 10px;margin-top:0">
    ${ties.map((t) => {
      const h = clubById(s, t.h), a = clubById(s, t.a);
      const me = t.h === uc.id || t.a === uc.id;
      const w = t.w;
      return `<div class="row" style="padding:6px 0;border-bottom:1px solid var(--line);${me ? 'font-weight:700' : ''}">
        <span class="grow" style="text-align:right;${w === t.a ? 'opacity:.5' : ''}">${esc(h.name)}</span>
        <b class="num" style="min-width:58px;text-align:center">${t.s ? `${t.s[0]}-${t.s[1]}` : 'vs'}${t.pens ? `<br><small>${t.pens[0]}-${t.pens[1]} tab</small>` : ''}</b>
        <span class="grow" style="${w === t.h ? 'opacity:.5' : ''}">${esc(a.name)}</span></div>`;
    }).join('')}</div>`).join('') + (s.cup.winner ? `<div class="card center">🏆 <b>${esc(clubById(s, s.cup.winner).name)}</b> remporte la coupe</div>` : '');
}

export function mount(app, root) {
  if ((app.ui.schedTab || 'table') === 'fixtures') root.querySelector('#nextfx')?.scrollIntoView({ block: 'center' });
}

export const actions = {
  stab(el, app) { app.ui.schedTab = el.dataset.v; app.render(); },
  sdiv(el, app) { app.ui.schedDiv = +el.dataset.v; app.render(); },
};
