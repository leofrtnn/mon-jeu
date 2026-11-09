/**
 * Effectif : liste des joueurs (note, forme, moral, condition, blessure). Fiche en un tap.
 */
import { userClub, clubPlayers } from '../../game/state.js';
import { overall } from '../../engine/ratings.js';
import { wageBill, money } from '../../game/economy.js';
import { POSITIONS, POSITION_GROUP } from '../../data/constants.js';
import { playerRow, seg } from '../components.js';
import { showPlayer } from './playerSheet.js';

const GROUPS = { G: 'Gardiens', D: 'Défenseurs', M: 'Milieux', A: 'Attaquants' };

export function render(app) {
  const s = app.state;
  const uc = userClub(s);
  const sort = app.ui.squadSort || 'pos';
  const players = clubPlayers(s, uc);
  const lineup = new Set(uc.lineup || []);
  const avgAge = players.reduce((a, p) => a + p.age, 0) / players.length;
  let list;
  if (sort === 'pos') {
    list = Object.keys(GROUPS).map((g) => {
      const ps = players.filter((p) => POSITION_GROUP[p.pos] === g)
        .sort((a, b) => POSITIONS.indexOf(a.pos) - POSITIONS.indexOf(b.pos) || overall(b) - overall(a));
      return ps.length ? `<div class="label">${GROUPS[g]} · ${ps.length}</div><div class="card list cols2" style="padding:0 10px;margin-top:0">${ps.map((p) => row(p, lineup)).join('')}</div>` : '';
    }).join('');
  } else {
    const key = sort === 'ovr' ? (p) => overall(p) : (p) => p.form;
    list = `<div class="card list cols2" style="padding:0 10px">${players.slice().sort((a, b) => key(b) - key(a)).map((p) => row(p, lineup)).join('')}</div>`;
  }
  return `<div class="row between" style="margin:8px 2px">
      <div><b>${players.length}</b> <small>joueurs · ${avgAge.toFixed(1)} ans de moyenne</small></div>
      <small>${money(wageBill(players))}/sem</small>
    </div>
    ${seg('sort', ['pos', 'ovr', 'form'], sort, { pos: 'Poste', ovr: 'Niveau', form: 'Forme' })}
    <p class="muted" style="font-size:12px;margin:8px 2px 0">● forme · ▲ moral · barre = condition · ★ = titulaire</p>
    ${list}`;
}

function row(p, lineup) {
  return playerRow(p, { extra: lineup.has(p.id) ? '· <span style="color:var(--accent)">★</span>' : '', dim: p.injury > 0 || p.suspended > 0 });
}

export const actions = {
  sort(el, app) { app.ui.squadSort = el.dataset.v; app.render(); },
  player(el, app) { showPlayer(app, +el.dataset.id); },
};
