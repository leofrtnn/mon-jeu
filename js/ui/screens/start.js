/**
 * Écran de démarrage : continuer / nouvelle partie, puis choix du club.
 */
import { newGame, startCareer } from '../../game/season.js';
import { hasSave, load, deleteSave, clubPlayers } from '../../game/state.js';
import { squadStrength } from '../../engine/ratings.js';
import { money } from '../../game/economy.js';
import { esc, crest, stars, seg } from '../components.js';

export function render(app) {
  const ui = app.ui.start || (app.ui.start = { step: 'menu', div: 1 });
  if (ui.step === 'menu' || !app.state) {
    const saved = hasSave();
    return `<div class="hero">
      <svg class="logo-ball" viewBox="0 0 100 100"><circle cx="50" cy="50" r="46" fill="#e6edf3"/><path d="M50 22l15 11-6 18H41l-6-18z" fill="#0d1117"/><path d="M50 4v18M65 33l26-6M59 51l14 22M41 51 27 73M35 33 9 27" stroke="#0d1117" stroke-width="4"/></svg>
      <h1>Coach de Poche</h1>
      <p>Le manager de foot qui tient dans une main.</p>
    </div>
    <div class="card">
      ${saved ? '<button class="btn primary lg block" data-act="continue">Continuer la partie</button><div style="height:10px"></div>' : ''}
      <button class="btn ${saved ? '' : 'primary'} lg block" data-act="new">Nouvelle partie</button>
    </div>
    <p class="muted center" style="font-size:12px">40 clubs fictifs · 2 divisions · 1 coupe<br>Sauvegarde automatique sur cet appareil</p>`;
  }
  const clubs = app.state.clubs.filter((c) => c.div === ui.div)
    .map((c) => ({ c, s: squadStrength(clubPlayers(app.state, c)) }))
    .sort((a, b) => b.c.rep - a.c.rep);
  return `<h2 style="margin:16px 4px 10px">Choisissez votre club</h2>
    ${seg('div', [1, 2], ui.div, { 1: 'Division 1', 2: 'Division 2' })}
    <div class="card list" style="padding:4px 10px">
      ${clubs.map(({ c, s }) => `<div class="prow" data-act="pick" data-id="${c.id}">
        ${crest(c)}
        <div class="pname"><b>${esc(c.name)}</b><small>${stars(Math.max(1, Math.min(5, Math.round((c.rep - 30) / 12))))} · Budget ${money(c.budget)}</small></div>
        <span class="ovr ${s >= 75 ? 't1' : s >= 65 ? 't2' : 't3'}">${Math.round(s)}</span>
      </div>`).join('')}
    </div>
    <button class="btn ghost block" data-act="back">Retour</button>`;
}

export const actions = {
  continue(el, app) {
    const s = load();
    if (!s) { app.toast('Sauvegarde illisible, nouvelle partie nécessaire.'); return; }
    app.state = s;
    app.tab = 'home';
    app.render();
  },
  async new(el, app) {
    if (hasSave() && !(await app.confirm('Nouvelle partie ?', 'La partie en cours sera effacée.', 'Effacer et recommencer', true))) return;
    deleteSave();
    app.state = newGame((Date.now() ^ (Math.random() * 1e9)) >>> 0);
    app.ui.start.step = 'pick';
    app.render();
  },
  div(el, app) { app.ui.start.div = +el.dataset.v; app.render(); },
  back(el, app) { app.ui.start.step = 'menu'; app.state = null; app.render(); },
  async pick(el, app) {
    const c = app.state.clubs.find((x) => x.id === +el.dataset.id);
    if (!(await app.confirm(c.name, `Prendre les rênes de <b>${esc(c.name)}</b> ?`, "C'est parti !"))) return;
    startCareer(app.state, c.id);
    app.save(true);
    app.tab = 'home';
    app.render();
  },
};
