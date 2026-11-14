/**
 * STATISTIQUES : onglet à part entière.
 *  - Saison : bilan du club (toutes compétitions), domicile/extérieur, xG, possession,
 *    affluence, plus large victoire, évolution du classement, rang dans le championnat ;
 *  - Joueurs : tableau triable de l'effectif (matchs, minutes, buts, passes, note, tirs…) ;
 *  - Championnat : meilleurs buteurs, passeurs, notes, gardiens, et classements des équipes ;
 *  - Matchs : tous nos matchs de la saison, avec la feuille de stats détaillée au toucher.
 */
import { userClub, clubById, clubPlayers } from '../../game/state.js';
import { DIVISIONS, DIV_IDS, COUNTRIES, compLabel, emptyClubStats, sortedTable } from '../../game/season.js';
import { esc, crest, posBadge, cmpBar, ratingChip, face } from '../components.js';
import { captains } from '../../game/captain.js';

const TABS = [['club', 'Saison du club'], ['players', 'Joueurs'], ['league', 'Championnat'], ['matches', 'Matchs']];
const avgR = (p) => (p.stats.apps ? p.stats.ratingSum / p.stats.apps : 0);
const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
const f1 = (v) => (Math.round(v * 10) / 10).toLocaleString('fr-FR');
const f2 = (v) => (Math.round(v * 100) / 100).toLocaleString('fr-FR', { minimumFractionDigits: 2 });

export function render(app) {
  const s = app.state;
  const uc = userClub(s);
  const tab = app.ui.statTab || 'club';
  const body = tab === 'club' ? clubTab(s, uc) : tab === 'players' ? playersTab(app, s, uc) : tab === 'league' ? leagueTab(app, s, uc) : matchesTab(s, uc);
  return `<div class="page-head"><h2>Statistiques</h2><div class="chips sub-tabs">${TABS.map(([k, l]) => `<button class="chip ${tab === k ? 'on' : ''}" data-act="sttab" data-v="${k}">${l}</button>`).join('')}</div></div>${body}`;
}

/* ---------------- Saison du club ---------------- */

function kpi(v, label, sub = '', color = '') {
  return `<div class="kpi"><b ${color ? `style="color:${color}"` : ''}>${v}</b><span>${label}</span>${sub ? `<small>${sub}</small>` : ''}</div>`;
}

/** Rang d'un club dans son championnat pour une statistique (1 = meilleur). */
function rankIn(s, uc, fn, asc = false) {
  const vals = s.clubs.filter((c) => c.div === uc.div).map((c) => ({ id: c.id, v: fn(c.sst || emptyClubStats()) }));
  vals.sort((a, b) => (asc ? a.v - b.v : b.v - a.v));
  return { r: vals.findIndex((x) => x.id === uc.id) + 1, n: vals.length };
}
const rankTag = ({ r, n }) => `<em class="rk ${r <= 3 ? 'top' : r > n - 3 ? 'low' : ''}">${r}<sup>${r === 1 ? 'er' : 'e'}</sup>/${n}</em>`;

function posChart(hist, n) {
  if (!hist || hist.length < 2) return '<p class="muted" style="margin:8px 0">La courbe apparaît après deux journées de championnat.</p>';
  const W = 600, H = 150, pad = 18;
  const x = (i) => pad + (i / (hist.length - 1)) * (W - pad * 2);
  const y = (p) => pad + ((p - 1) / Math.max(1, n - 1)) * (H - pad * 2);
  const pts = hist.map((p, i) => `${x(i).toFixed(1)},${y(p).toFixed(1)}`).join(' ');
  const last = hist[hist.length - 1];
  return `<svg class="poschart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
    ${[1, Math.ceil(n / 2), n].map((p) => `<line x1="${pad}" x2="${W - pad}" y1="${y(p)}" y2="${y(p)}" class="grid"/><text x="2" y="${y(p) + 4}">${p}</text>`).join('')}
    <polyline points="${pts}" class="line"/>
    <circle cx="${x(hist.length - 1)}" cy="${y(last)}" r="5" class="dotc"/></svg>`;
}

function clubTab(s, uc) {
  const st = uc.sst || emptyClubStats();
  const m = st.m || 0;
  const n = s.clubs.filter((c) => c.div === uc.div).length;
  if (!m) return `<div class="card"><p class="muted">Les statistiques de la saison apparaissent après votre premier match officiel.</p></div>`;
  const pos = sortedTable(s, uc.div).findIndex((r) => r.id === uc.id) + 1;
  const pts = st.w * 3 + st.d;
  const att = st.attN ? Math.round(st.att / st.attN) : 0;
  const pass = pct(st.passOk, st.passes);
  const ranks = {
    gf: rankIn(s, uc, (x) => (x.m ? x.gf / x.m : 0)),
    ga: rankIn(s, uc, (x) => (x.m ? x.ga / x.m : 9), true),
    poss: rankIn(s, uc, (x) => (x.m ? x.poss / x.m : 0)),
    xg: rankIn(s, uc, (x) => (x.m ? x.xg / x.m : 0)),
    cs: rankIn(s, uc, (x) => x.cs),
    att: rankIn(s, uc, (x) => (x.attN ? x.att / x.attN : 0)),
  };
  const line = (label, v, rk) => `<div class="srow"><span>${label}</span><b>${v}</b>${rk ? rankTag(rk) : '<em class="rk"></em>'}</div>`;
  return `<div class="stat-hero">
      ${crest(uc, 'lg')}
      <div class="grow"><small>${s.season}-${String(s.season + 1).slice(2)} · toutes compétitions</small><h2>${esc(uc.name)}</h2>
        <div class="wdl"><span class="w">${st.w} V</span><span class="d">${st.d} N</span><span class="l">${st.l} D</span><small>${m} matchs · ${pct(pts, m * 3)} % des points</small></div></div>
      <div class="hero-pos"><b>${pos}<sup>${pos === 1 ? 'er' : 'e'}</sup></b><small>${esc(DIVISIONS[uc.div].name)}</small></div>
    </div>
    <div class="kpis">
      ${kpi(`${st.gf}-${st.ga}`, 'Buts pour / contre', `${f1(st.gf / m)} marqués par match`)}
      ${kpi(`${f1(st.xg)}`, 'xG créés', `${f1(st.xga)} xG concédés`, st.xg >= st.xga ? 'var(--good)' : 'var(--bad)')}
      ${kpi(`${Math.round(st.poss / m)} %`, 'Possession moyenne')}
      ${kpi(st.cs, 'Clean sheets', `${pct(st.cs, m)} % des matchs`)}
      ${kpi(att ? att.toLocaleString('fr-FR') : '—', 'Affluence moyenne', att ? `${pct(att, uc.stadium)} % de remplissage` : '')}
    </div>
    <div class="grid2">
      <div class="card"><h3>Attaque & défense</h3>
        ${line('Buts marqués par match', f1(st.gf / m), ranks.gf)}
        ${line('Buts encaissés par match', f1(st.ga / m), ranks.ga)}
        ${line('xG par match', f2(st.xg / m), ranks.xg)}
        ${line('Tirs par match (cadrés)', `${f1(st.shots / m)} (${f1(st.onT / m)})`)}
        ${line('Tirs concédés par match', f1(st.shotsA / m))}
        ${line('Réalisme (buts / tirs)', `${pct(st.gf, st.shots)} %`)}
        ${line('Clean sheets', st.cs, ranks.cs)}
        <p class="muted" style="font-size:11px;margin:6px 0 0">Classement par rapport aux clubs de votre championnat, toutes compétitions.</p></div>
      <div class="card"><h3>Jeu & discipline</h3>
        ${line('Possession', `${Math.round(st.poss / m)} %`, ranks.poss)}
        ${line('Passes par match', Math.round(st.passes / m))}
        ${line('Passes réussies', `${pass} %`)}
        ${line('Corners par match', f1(st.corners / m))}
        ${line('Fautes par match', f1(st.fouls / m))}
        ${line('Cartons', `🟨 ${st.yel} · 🟥 ${st.red}`)}
        ${line('Affluence moyenne', att ? att.toLocaleString('fr-FR') : '—', att ? ranks.att : null)}</div>
      <div class="card"><h3>Domicile / extérieur</h3>
        <div class="ha"><div><small>🏟️ Domicile</small><b>${st.hw}-${st.hd}-${st.hl}</b><span>${pct(st.hw * 3 + st.hd, (st.hw + st.hd + st.hl) * 3)} % des points</span></div>
          <div><small>🚌 Extérieur</small><b>${st.aw}-${st.ad}-${st.al}</b><span>${pct(st.aw * 3 + st.ad, (st.aw + st.ad + st.al) * 3)} % des points</span></div></div>
        ${line('Plus large victoire', st.big ? `${st.big.gf}-${st.big.ga} contre ${esc(st.big.opp)}` : '—')}
        ${line('Plus lourde défaite', st.worst ? `${st.worst.gf}-${st.worst.ga} contre ${esc(st.worst.opp)}` : '—')}</div>
      <div class="card"><h3>Évolution au classement</h3>${posChart(uc.posHist, n)}</div>
    </div>`;
}

/* ---------------- Joueurs ---------------- */

const PCOLS = [
  ['apps', 'MJ', 'Matchs joués', (p) => p.stats.apps],
  ['min', 'Min', 'Minutes', (p) => p.stats.minutes || 0],
  ['goals', 'B', 'Buts', (p) => p.stats.goals],
  ['assists', 'PD', 'Passes décisives', (p) => p.stats.assists],
  ['rating', 'Note', 'Note moyenne', (p) => avgR(p)],
  ['motm', 'HdM', 'Homme du match', (p) => p.stats.motm || 0],
  ['shots', 'Tirs', 'Tirs', (p) => p.stats.shots || 0],
  ['kp', 'PC', 'Passes clés', (p) => p.stats.kp || 0],
  ['pass', 'Passes', 'Passes réussies (%)', (p) => pct(p.stats.passOk || 0, p.stats.passes || 0)],
  ['tackles', 'Tac', 'Tacles réussis', (p) => p.stats.tackles || 0],
  ['cs', 'CS', 'Clean sheets (gardiens et défenseurs)', (p) => p.stats.cs || 0],
  ['cards', '🟨/🟥', 'Cartons', (p) => (p.stats.yellows || 0) + (p.stats.reds || 0) * 3],
];

function playersTab(app, s, uc) {
  const key = app.ui.pstSort || 'apps';
  const col = PCOLS.find((c) => c[0] === key) || PCOLS[0];
  const { captain } = captains(s, uc);
  const ps = clubPlayers(s, uc).slice().sort((a, b) => col[3](b) - col[3](a) || b.stats.minutes - a.stats.minutes);
  const tot = (fn) => ps.reduce((a, p) => a + fn(p), 0);
  const cell = (c, p) => {
    const v = c[3](p);
    if (c[0] === 'rating') return v ? `<td>${ratingChip(v)}</td>` : '<td class="muted">—</td>';
    if (c[0] === 'pass') return `<td>${p.stats.passes ? v + ' %' : '—'}</td>`;
    if (c[0] === 'cards') return `<td>${p.stats.yellows || 0}/${p.stats.reds || 0}</td>`;
    if (c[0] === 'min') return `<td>${v.toLocaleString('fr-FR')}</td>`;
    return `<td>${v || '<span class="muted">0</span>'}</td>`;
  };
  return `<div class="card" style="padding:4px 6px;overflow-x:auto"><table class="tbl stbl">
    <thead><tr><th class="l">Joueur</th>${PCOLS.map((c) => `<th class="${c[0] === key ? 'on' : ''}" data-act="pst" data-v="${c[0]}" title="${c[2]}">${c[1]}${c[0] === key ? ' ▾' : ''}</th>`).join('')}</tr></thead>
    <tbody>${ps.map((p) => `<tr data-act="player" data-id="${p.id}">
      <td class="l"><span class="clubcell">${posBadge(p.pos)}<span>${esc(p.name)}${p.id === captain ? ' <b class="xi-tag cap">C</b>' : ''}</span></span></td>
      ${PCOLS.map((c) => cell(c, p)).join('')}</tr>`).join('')}</tbody>
    <tfoot><tr><td class="l"><b>Total</b></td><td></td><td></td><td><b>${tot((p) => p.stats.goals)}</b></td><td><b>${tot((p) => p.stats.assists)}</b></td><td colspan="8"></td></tr></tfoot>
    </table><p class="muted" style="font-size:11px;margin:6px 6px 4px">Toutes compétitions de club. Touchez un en-tête pour trier, une ligne pour ouvrir la fiche du joueur.</p></div>`;
}

/* ---------------- Championnat ---------------- */

function leaders(s, ids, title, fn, fmt, filter = () => true, n = 10) {
  const list = ids.map((id) => s.players[id]).filter((p) => p && filter(p) && fn(p) > 0).sort((a, b) => fn(b) - fn(a)).slice(0, n);
  return `<div class="card lead-card"><h3>${title}</h3>${list.map((p, i) => {
    const c = clubById(s, p.clubId);
    return `<div class="lead-row ${p.clubId === s.userClubId ? 'me' : ''}" data-act="player" data-id="${p.id}"><em>${i + 1}</em>${face(p, c)}
      <div class="grow"><b>${esc(p.name)}</b><small>${c ? crest(c, 'xs') + ' ' + esc(c.short) : ''}</small></div><b class="v">${fmt(fn(p), p)}</b></div>`;
  }).join('') || '<p class="muted">Pas encore de données.</p>'}</div>`;
}

function teamRank(s, div, title, fn, fmt, asc = false) {
  const cl = s.clubs.filter((c) => c.div === div && c.sst?.m).map((c) => ({ c, v: fn(c.sst) })).sort((a, b) => (asc ? a.v - b.v : b.v - a.v)).slice(0, 6);
  return `<div class="card lead-card"><h3>${title}</h3>${cl.map(({ c, v }, i) => `<div class="lead-row ${c.id === s.userClubId ? 'me' : ''}" data-act="clubinfo" data-id="${c.id}"><em>${i + 1}</em>${crest(c, 'sm')}<div class="grow"><b>${esc(c.name)}</b></div><b class="v">${fmt(v)}</b></div>`).join('') || '<p class="muted">Pas encore de données.</p>'}</div>`;
}

function leagueTab(app, s, uc) {
  const div = app.ui.stDiv ?? uc.div;
  const ids = s.clubs.filter((c) => c.div === div).flatMap((c) => c.playerIds);
  const minApps = Math.max(3, Math.round((s.tables[div] && Object.values(s.tables[div])[0]?.p || 0) * 0.4));
  return `${divPicker(s, div, uc, 'stdiv')}
    <div class="lead-grid">
      ${leaders(s, ids, '⚽ Buteurs (championnat)', (p) => p.stats.lgoals || 0, (v) => v)}
      ${leaders(s, ids, '🎯 Passeurs', (p) => p.stats.assists, (v) => v)}
      ${leaders(s, ids, '📈 Meilleures notes', avgR, (v) => f2(v), (p) => p.stats.apps >= minApps)}
      ${leaders(s, ids, '🏅 Hommes du match', (p) => p.stats.motm || 0, (v) => v)}
      ${leaders(s, ids, '🧤 Clean sheets (gardiens)', (p) => p.stats.cs || 0, (v) => v, (p) => p.pos === 'GB')}
      ${leaders(s, ids, '🟨 Cartons', (p) => (p.stats.yellows || 0) + (p.stats.reds || 0) * 2, (v, p) => `${p.stats.yellows || 0}/${p.stats.reds || 0}`)}
      ${teamRank(s, div, '🔥 Meilleures attaques', (x) => x.gf / x.m, f1)}
      ${teamRank(s, div, '🛡️ Meilleures défenses', (x) => x.ga / x.m, f1, true)}
      ${teamRank(s, div, '⚙️ Possession', (x) => x.poss / x.m, (v) => Math.round(v) + ' %')}
      ${teamRank(s, div, '📊 xG par match', (x) => x.xg / x.m, f2)}
    </div>
    <p class="muted" style="font-size:11px;margin:4px">Notes : minimum ${minApps} matchs joués. Équipes : toutes compétitions.</p>`;
}

/** Sélecteur de championnat : le nôtre en premier, les autres dans une liste déroulante. */
export function divPicker(s, div, uc, act) {
  const others = DIV_IDS.filter((d) => d !== uc.div);
  return `<div class="div-pick">
    <button class="chip ${div === uc.div ? 'on' : ''}" data-act="${act}" data-v="${uc.div}">${COUNTRIES[DIVISIONS[uc.div].country].flag} ${esc(DIVISIONS[uc.div].name)} <small>· mon championnat</small></button>
    <select data-act="${act}" class="sel">${div === uc.div ? '<option value="" selected>Autres championnats…</option>' : ''}${others.map((d) => `<option value="${d}" ${d === div ? 'selected' : ''}>${COUNTRIES[DIVISIONS[d].country].flag} ${esc(DIVISIONS[d].name)} (${esc(COUNTRIES[DIVISIONS[d].country].name)})</option>`).join('')}</select>
  </div>`;
}

/* ---------------- Matchs ---------------- */

function matchesTab(s, uc) {
  const log = (s.matchLog || []).filter((x) => x.season === s.season).slice().reverse();
  if (!log.length) return '<div class="card"><p class="muted">Aucun match officiel joué cette saison.</p></div>';
  return `<div class="card" style="padding:4px 10px">${log.map((x, i) => {
    const home = x.h === uc.id, opp = clubById(s, home ? x.a : x.h);
    const my = x.s[home ? 0 : 1], th = x.s[home ? 1 : 0];
    let r = my > th ? 'V' : my < th ? 'D' : 'N';
    if (r === 'N' && x.pens) r = x.pens[home ? 0 : 1] > x.pens[home ? 1 : 0] ? 'V' : 'D';
    const idx = (s.matchLog.length - 1) - i;
    return `<div class="cal-row" data-act="mlog" data-v="${idx}"><small class="fx-comp">${esc(compLabel(s, x))}</small>
      <span class="fx-venue ${home ? 'h' : 'a'}">${home ? 'DOM' : 'EXT'}</span>${crest(opp, 'sm')}<span class="grow">${esc(opp?.name || '')}</span>
      <small class="muted">xG ${f1(x.st[home ? 0 : 1].xg)}-${f1(x.st[home ? 1 : 0].xg)} · ${x.poss[home ? 0 : 1]} %</small>
      <b class="num">${x.s[0]}-${x.s[1]}</b>${x.pens ? `<small>(${x.pens[0]}-${x.pens[1]} tab)</small>` : ''}<span class="pill ${r}">${r}</span></div>`;
  }).join('')}</div>`;
}

function matchSheet(app, x) {
  const s = app.state;
  const h = clubById(s, x.h), a = clubById(s, x.a);
  const colors = [h.color || '#7c5cff', a.color || '#4cc9f0'];
  const [A, B] = x.st;
  const goals = x.goals.map((g) => `<div class="gl ${g.side ? 'r' : 'l'}"><b>${g.min}${g.ex ? '+' + g.ex : ''}'</b> ${esc(g.name)}${g.pen ? ' (pén.)' : ''}${g.as ? ` <small>· ${esc(g.as)}</small>` : ''}</div>`).join('');
  const sh = app.sheet({
    html: `<small class="muted">${esc(compLabel(s, x))}</small>
      <div class="ms-head"><div>${crest(h, 'lg')}<b>${esc(h.name)}</b></div><div class="sc">${x.s[0]} - ${x.s[1]}${x.pens ? `<small>${x.pens[0]}-${x.pens[1]} tab</small>` : ''}</div><div>${crest(a, 'lg')}<b>${esc(a.name)}</b></div></div>
      <div class="ms-goals">${goals || '<p class="muted center">Aucun but</p>'}</div>
      ${x.motm ? `<div class="motm"><span style="font-size:22px">🏅</span><div class="grow">Homme du match<br><b>${esc(x.motm.name)}</b></div>${ratingChip(x.motm.r)}</div>` : ''}
      <div class="card">
        ${cmpBar('Possession', x.poss[0], x.poss[1], colors, (v) => v + ' %')}
        ${cmpBar('xG', A.xg, B.xg, colors, (v) => f2(v))}
        ${cmpBar('Tirs', A.shots, B.shots, colors)}
        ${cmpBar('Tirs cadrés', A.onT, B.onT, colors)}
        ${cmpBar('Passes', A.passes, B.passes, colors)}
        ${cmpBar('Passes réussies', pct(A.passOk, A.passes), pct(B.passOk, B.passes), colors, (v) => v + ' %')}
        ${cmpBar('Tacles', A.tackles, B.tackles, colors)}
        ${cmpBar('Arrêts', A.saves, B.saves, colors)}
        ${cmpBar('Corners', A.corners, B.corners, colors)}
        ${cmpBar('Fautes', A.fouls, B.fouls, colors)}
        ${cmpBar('Hors-jeu', A.off, B.off, colors)}
        ${cmpBar('Cartons jaunes', A.yel, B.yel, colors)}
      </div>
      ${x.best?.length ? `<div class="label">Meilleures notes de votre équipe</div><div class="card">${x.best.map((b) => `<div class="row between"><span>${esc(b.name)}</span>${ratingChip(b.r)}</div>`).join('')}</div>` : ''}
      <button class="btn block" data-act="close">Fermer</button>`,
    actions: { close: () => sh.close() },
  });
}

export const actions = {
  sttab(el, app) { app.ui.statTab = el.dataset.v; app.render(); },
  pst(el, app) { app.ui.pstSort = el.dataset.v; app.render(); },
  stdiv(el, app) { if (el.tagName === 'SELECT' && !el.value) return; app.ui.stDiv = +(el.value || el.dataset.v); app.render(); },
  mlog(el, app) { const x = app.state.matchLog[+el.dataset.v]; if (x) matchSheet(app, x); },
  clubinfo(el, app) { import('./clubInfo.js').then((mod) => mod.showClub(app, +el.dataset.id)); },
  async player(el, app) { (await import('./playerSheet.js')).showPlayer(app, +el.dataset.id); },
};
