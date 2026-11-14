/**
 * Effectif : liste des joueurs (note, forme, moral, condition, blessure). Fiche en un tap.
 */
import { userClub, clubPlayers } from '../../game/state.js';
import { overall } from '../../engine/ratings.js';
import { wageBill, money } from '../../game/economy.js';
import { POSITIONS, POSITION_GROUP } from '../../data/constants.js';
import { seg, face, posBadge, statusTags, noteChip } from '../components.js';
import { PROMISE_ROLES } from '../../game/transfers.js';
import { captains } from '../../game/captain.js';
import { showPlayer } from './playerSheet.js';
import { cohesionReport, cohMult } from '../../game/cohesion.js';
import { esc } from '../components.js';

const GROUPS = { G: 'Gardiens', D: 'Défenseurs', M: 'Milieux', A: 'Attaquants' };

const VIEWS = {
  gen: { label: 'Général', cols: ['age', 'ovr', 'pot', 'form', 'morale', 'cond', 'status'] },
  phys: { label: 'Condition', cols: ['cond', 'sharp', 'injury', 'form', 'morale'] },
  stats: { label: 'Saison', cols: ['apps', 'goals', 'assists', 'avg', 'mins'] },
  contract: { label: 'Contrats', cols: ['age', 'wage', 'contract', 'value', 'role'] },
};
const COLS = {
  age: { h: 'Âge', v: (p) => p.age, f: (p) => p.age },
  ovr: { h: 'Note', v: (p) => overall(p), f: (p) => noteChip(overall(p)) },
  pot: { h: 'Pot.', v: (p) => p.pot || overall(p), f: (p) => `<small class="muted">${p.pot || '—'}</small>` },
  form: { h: 'Forme', v: (p) => p.form, f: (p) => meter(p.form) },
  morale: { h: 'Moral', v: (p) => p.morale, f: (p) => meter(p.morale) },
  cond: { h: 'Condition', v: (p) => 100 - (p.fatigue || 0), f: (p) => meter(100 - (p.fatigue || 0)) },
  sharp: { h: 'Rythme', v: (p) => p.sharp ?? 80, f: (p) => meter(p.sharp ?? 80) },
  injury: { h: 'Disponibilité', v: (p) => -(p.injury || 0) - (p.suspended || 0) * 0.5, f: (p) => (p.injury > 0 ? `<span class="tag bad">✚ ${p.injury} m.</span>` : p.suspended > 0 ? `<span class="tag bad">🟥 ${p.suspended} m.</span>` : '<span class="tag good">Apte</span>') },
  status: { h: 'Statut', v: (p) => (p.injury > 0 ? 3 : p.suspended > 0 ? 2 : p.listed ? 1 : 0), f: (p) => statusTags(p) || '<small class="muted">—</small>' },
  apps: { h: 'MJ', v: (p) => p.stats.apps, f: (p) => p.stats.apps },
  goals: { h: 'Buts', v: (p) => p.stats.goals, f: (p) => p.stats.goals },
  assists: { h: 'PD', v: (p) => p.stats.assists, f: (p) => p.stats.assists },
  avg: { h: 'Note moy.', v: (p) => (p.stats.apps ? p.stats.ratingSum / p.stats.apps : 0), f: (p) => (p.stats.apps ? (p.stats.ratingSum / p.stats.apps).toFixed(2) : '—') },
  mins: { h: 'Minutes', v: (p) => p.stats.minutes, f: (p) => p.stats.minutes },
  wage: { h: 'Salaire', v: (p) => p.wage, f: (p) => `${money(p.wage)}<small>/sem</small>` },
  contract: { h: 'Contrat', v: (p) => p.contract, f: (p) => `<span class="${p.contract <= 1 ? 'neg-txt' : ''}">${p.contract} an(s)</span>` },
  value: { h: 'Valeur', v: (p) => p.value || 0, f: (p) => money(p.value || 0) },
  role: { h: 'Statut promis', v: (p) => ['star', 'key', 'rotation', 'backup', 'youth'].indexOf(p.promise?.role || 'rotation'), f: (p) => esc(PROMISE_ROLES[p.promise?.role || 'rotation']?.label || '') },
};
const meter = (v) => `<span class="mtr"><i style="width:${Math.max(4, Math.min(100, v))}%;background:${v >= 70 ? 'var(--good)' : v >= 45 ? 'var(--ok)' : 'var(--bad)'}"></i></span>`;
const LINES = { all: 'Tous', G: 'Gardiens', D: 'Défenseurs', M: 'Milieux', A: 'Attaquants' };

export function render(app) {
  const s = app.state;
  const uc = userClub(s);
  const view = app.ui.squadView || 'gen';
  const line = app.ui.squadLine || 'all';
  const sort = app.ui.squadSort2 || null; // { k, dir }
  const players = clubPlayers(s, uc);
  const lineup = new Set(uc.lineup || []);
  const { captain: cap, vice } = captains(s, uc);
  const avgAge = players.reduce((a, p) => a + p.age, 0) / Math.max(1, players.length);
  const xi = (uc.lineup || []).map((id) => s.players[id]).filter(Boolean);
  const xiAvg = xi.length ? Math.round(xi.reduce((a, p) => a + overall(p), 0) / xi.length) : 0;
  const hurt = players.filter((p) => p.injury > 0 || p.suspended > 0).length;
  const ending = players.filter((p) => p.contract <= 1 && !p.onLoanFrom).length;
  let list = players.filter((p) => line === 'all' || POSITION_GROUP[p.pos] === line);
  if (sort) { const c = COLS[sort.k]; list.sort((a, b) => (c.v(a) - c.v(b)) * sort.dir); }
  else list.sort((a, b) => POSITIONS.indexOf(a.pos) - POSITIONS.indexOf(b.pos) || overall(b) - overall(a));
  const cols = VIEWS[view].cols;
  const th = (k) => `<th data-act="ssort" data-v="${k}" class="${sort?.k === k ? 'on' : ''}">${COLS[k].h}${sort?.k === k ? (sort.dir > 0 ? ' ▲' : ' ▼') : ''}</th>`;
  const row = (p) => `<tr data-act="player" data-id="${p.id}" class="${p.injury > 0 || p.suspended > 0 ? 'dim' : ''}">
      <td class="l nm">${face(p, uc, 'sm')}<span><b>${esc(p.name)}</b>${lineup.has(p.id) ? ' <b class="xi-tag">XI</b>' : ''}${p.id === cap ? ' <b class="xi-tag cap">C</b>' : p.id === vice ? ' <b class="xi-tag vc">VC</b>' : ''}<br><small class="muted">${esc(p.nat || '')}${p.onLoanFrom ? ' · prêté' : ''}</small></span></td>
      <td>${posBadge(p.pos)}</td>${cols.map((k) => `<td>${COLS[k].f(p)}</td>`).join('')}</tr>`;
  return `<div class="sq-head">
      <div class="sq-kpi"><b>${players.length}</b><small>joueurs</small></div>
      <div class="sq-kpi"><b>${xiAvg}</b><small>note du XI</small></div>
      <div class="sq-kpi"><b>${avgAge.toFixed(1)}</b><small>âge moyen</small></div>
      <div class="sq-kpi"><b>${money(wageBill(players))}</b><small>salaires /sem</small></div>
      <div class="sq-kpi ${hurt ? 'warn' : ''}"><b>${hurt}</b><small>indisponible(s)</small></div>
      <div class="sq-kpi ${ending ? 'warn' : ''}"><b>${ending}</b><small>fin de contrat</small></div>
    </div>
    ${cohesionCard(s, uc)}
    <div class="sq-bar">${seg('sview', Object.keys(VIEWS), view, Object.fromEntries(Object.entries(VIEWS).map(([k, v]) => [k, v.label])))}
      <div class="chips">${Object.entries(LINES).map(([k, l]) => `<button class="chip ${line === k ? 'on' : ''}" data-act="sline" data-v="${k}">${l}</button>`).join('')}</div></div>
    <div class="card sq-table-wrap"><table class="tbl sq-table"><thead><tr><th class="l">Joueur</th><th data-act="ssort" data-v="pos">Poste</th>${cols.map(th).join('')}</tr></thead>
      <tbody>${list.map(row).join('')}</tbody></table></div>
    <p class="muted" style="font-size:12px;margin:6px 4px">Touchez un en-tête pour trier · touchez un joueur pour sa fiche (contrat, rôle, discussion, vente…).</p>`;
}

/** Cohésion : niveau de l'équipe, duos, tensions, intégration des recrues. */
function cohesionCard(s, uc) {
  const r = cohesionReport(s, uc);
  const col = (v) => (v >= 70 ? 'var(--good)' : v >= 45 ? 'var(--ok)' : 'var(--bad)');
  const word = (v) => (v >= 80 ? 'Soudée' : v >= 65 ? 'Unie' : v >= 50 ? 'Correcte' : v >= 35 ? 'Fragile' : 'Divisée');
  const pct = Math.round((cohMult(r.team) - 1) * 1000) / 10;
  const thisSeason = (uc.arrivals || []).filter((x) => x === s.season).length;
  const nm = (p) => esc(p.name);
  return `<details class="card coh-card" ${s.ui?.cohOpen ? 'open' : ''}><summary><div class="row between" style="width:100%;gap:10px">
      <span>🤝 <b>Cohésion</b> · <b style="color:${col(r.team)}">${word(r.team)}</b> <small class="muted">${r.team}/100 · rendement ${pct >= 0 ? '+' : ''}${pct} %</small></span>
      <span class="gauge" style="width:120px"><i style="width:${r.team}%;background:${col(r.team)}"></i></span></div></summary>
    <div class="coh-grid">
      <div><div class="label" style="margin-top:6px">Vestiaire</div><div class="row between"><span>Cohésion du groupe</span><b>${r.club}/100</b></div>
        <div class="row between"><span>Recrues cette saison</span><b class="${thisSeason >= 6 ? 'neg-txt' : ''}">${thisSeason}</b></div>
        <small class="muted">Chaque recrue fait baisser la cohésion ; elle remonte en jouant ensemble et en gagnant. Changer toute l'équipe en un mercato coûte très cher sur le terrain.</small></div>
      <div><div class="label" style="margin-top:6px">Meilleurs duos</div>${r.duos.slice(0, 4).map((d) => `<div class="row between" style="font-size:13px;padding:2px 0"><span>${nm(d.a)} ↔ ${nm(d.b)}</span><b style="color:${col(d.v)}">${Math.round(d.v)}</b></div>`).join('')}</div>
      <div><div class="label" style="margin-top:6px">À intégrer</div>${r.integ.slice(0, 4).map((x) => `<div class="row between" style="font-size:13px;padding:2px 0"><span>${nm(x.p)}</span><b style="color:${col(x.v)}">${x.v}</b></div>`).join('')}</div>
      ${r.clashes.length ? `<div><div class="label" style="margin-top:6px">⚡ Tensions</div>${r.clashes.map((d) => `<div class="row between" style="font-size:13px;padding:2px 0"><span>${nm(d.a)} ✕ ${nm(d.b)}</span><b class="neg-txt">${Math.round(d.v)}</b></div>`).join('')}</div>` : ''}
    </div></details>`;
}

export const actions = {
  sview(el, app) { app.ui.squadView = el.dataset.v; app.ui.squadSort2 = null; app.render(); },
  sline(el, app) { app.ui.squadLine = el.dataset.v; app.render(); },
  ssort(el, app) {
    const k = el.dataset.v;
    if (k === 'pos') { app.ui.squadSort2 = null; app.render(); return; }
    const cur = app.ui.squadSort2;
    app.ui.squadSort2 = cur?.k === k ? (cur.dir < 0 ? { k, dir: 1 } : null) : { k, dir: -1 };
    app.render();
  },
  player(el, app) { showPlayer(app, +el.dataset.id); },
};
