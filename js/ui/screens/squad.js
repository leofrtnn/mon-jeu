/**
 * Effectif : liste des joueurs (note, forme, moral, condition, blessure). Fiche en un tap.
 */
import { userClub, clubPlayers } from '../../game/state.js';
import { overall } from '../../engine/ratings.js';
import { wageBill, money } from '../../game/economy.js';
import { POSITIONS, POSITION_GROUP } from '../../data/constants.js';
import { playerRow, seg } from '../components.js';
import { captains } from '../../game/captain.js';
import { showPlayer } from './playerSheet.js';
import { cohesionReport, cohMult } from '../../game/cohesion.js';
import { esc } from '../components.js';

const GROUPS = { G: 'Gardiens', D: 'Défenseurs', M: 'Milieux', A: 'Attaquants' };

export function render(app) {
  const s = app.state;
  const uc = userClub(s);
  const sort = app.ui.squadSort || 'pos';
  const players = clubPlayers(s, uc);
  const lineup = new Set(uc.lineup || []);
  const { captain: cap, vice } = captains(s, uc);
  const avgAge = players.reduce((a, p) => a + p.age, 0) / players.length;
  let list;
  if (sort === 'pos') {
    list = Object.keys(GROUPS).map((g) => {
      const ps = players.filter((p) => POSITION_GROUP[p.pos] === g)
        .sort((a, b) => POSITIONS.indexOf(a.pos) - POSITIONS.indexOf(b.pos) || overall(b) - overall(a));
      return ps.length ? `<div class="label">${GROUPS[g]} · ${ps.length}</div><div class="card list cols2" style="padding:0 10px;margin-top:0">${ps.map((p) => row(p, lineup, cap, vice)).join('')}</div>` : '';
    }).join('');
  } else {
    const key = sort === 'ovr' ? (p) => overall(p) : (p) => p.form;
    list = `<div class="card list cols2" style="padding:0 10px">${players.slice().sort((a, b) => key(b) - key(a)).map((p) => row(p, lineup, cap, vice)).join('')}</div>`;
  }
  return `<div class="row between" style="margin:8px 2px">
      <div><b>${players.length}</b> <small>joueurs · ${avgAge.toFixed(1)} ans de moyenne</small></div>
      <small>${money(wageBill(players))}/sem</small>
    </div>
    ${cohesionCard(s, uc)}
    ${seg('sort', ['pos', 'ovr', 'form'], sort, { pos: 'Poste', ovr: 'Niveau', form: 'Forme' })}
    <div class="legend"><span><i class="dot" style="background:var(--good)"></i>Forme</span><span><b style="color:var(--good)">▲</b>Moral</span>
      <span><i class="mini"><i style="width:80%;background:var(--good)"></i></i>Condition</span><span><b class="ovr-n" style="--oc:#4cc9f0">75</b>Note /100</span>
      <span><b class="xi-tag">XI</b>Titulaire</span><span><b class="xi-tag cap">C</b>Capitaine</span><span><b class="tag" style="padding:0 5px">Fin</b>Contrat qui se termine</span></div>
    ${list}`;
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

function row(p, lineup, cap, vice) {
  return playerRow(p, { extra: (lineup.has(p.id) ? ' <b class="xi-tag">XI</b>' : '') + (p.id === cap ? ' <b class="xi-tag cap" title="Capitaine">C</b>' : p.id === vice ? ' <b class="xi-tag vc" title="Vice-capitaine">VC</b>' : ''), dim: p.injury > 0 || p.suspended > 0 });
}

export const actions = {
  sort(el, app) { app.ui.squadSort = el.dataset.v; app.render(); },
  player(el, app) { showPlayer(app, +el.dataset.id); },
};
