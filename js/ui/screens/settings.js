/**
 * Réglages : options de match, données (import/export de noms), sauvegardes.
 */
import { exportNames, importNames } from '../../game/dataImport.js';
import { esc } from '../components.js';
import { downloadJson, readFileAsText } from '../files.js';

export function render(app) {
  const st = app.state.settings;
  const tog = (k, label) => `<div class="row between" style="padding:6px 0"><span>${label}</span><button class="btn sm ${st[k] ? 'primary' : ''}" data-act="toggle" data-v="${k}">${st[k] ? 'Activé' : 'Désactivé'}</button></div>`;
  return `<div class="card"><h3>Match</h3>
      ${tog('var', 'Arbitrage vidéo (VAR)')}${tog('replays', 'Ralentis des buts')}${tog('audio', 'Ambiance sonore')}</div>
    <div class="card"><h3>Données · noms</h3>
      <p class="muted" style="font-size:13px;margin-top:0">Le jeu n'utilise que des noms fictifs. Vous pouvez exporter le fichier de noms, le modifier (par exemple avec de vrais noms), puis le réimporter.</p>
      <div class="btns"><button class="btn" data-act="exportNames">Exporter les noms</button>
        <label class="btn">Importer des noms<input type="file" accept=".json,application/json" data-act="importNames" hidden></label></div>
    </div>
    <div id="saves-panel"></div>
    <div class="card"><button class="btn danger block" data-act="quit">Quitter vers le menu</button></div>`;
}

export const actions = {
  toggle(el, app) { const k = el.dataset.v; app.state.settings[k] = !app.state.settings[k]; app.save(); app.render(); },
  exportNames(el, app) { downloadJson(exportNames(app.state), 'coach-de-poche-noms.json'); },
  async importNames(el, app) {
    const f = el.files?.[0];
    if (!f) return;
    try {
      const r = importNames(app.state, JSON.parse(await readFileAsText(f)));
      app.toast(r.ok ? `${r.clubs} club(s) et ${r.players} joueur(s) renommés.` : `Import impossible : ${r.errors[0] || 'fichier vide'}`, 3500);
      if (r.ok) { app.save(); app.render(); }
    } catch (e) { app.toast('Fichier JSON invalide.'); }
  },
  async quit(el, app) {
    if (!(await app.confirm('Quitter ?', 'La partie est sauvegardée automatiquement.', 'Menu principal'))) return;
    app.save(true);
    app.state = null; app.ui.start = { step: 'menu', div: 1 };
    app.render();
  },
};
