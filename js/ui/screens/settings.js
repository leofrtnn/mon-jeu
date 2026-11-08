/**
 * Réglages : options de match, données (import/export de noms), sauvegardes.
 */
import { exportNames, importNames } from '../../game/dataImport.js';
import { esc } from '../components.js';
import { downloadJson, downloadText, readFileAsText } from '../files.js';
import { getSlot, exportFile, importFile, slotsInfo } from '../../game/state.js';

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
    <div class="card"><h3>Sauvegarde</h3>
      <p style="margin-top:0"><small>Emplacement ${getSlot()} · ${Math.round((slotsInfo()[getSlot()]?.size || 0) / 1024)} Ko compressés (gzip) · sauvegarde automatique</small></p>
      <div class="btns"><button class="btn" data-act="exportSave">Exporter la partie</button>
        <label class="btn">Importer ici<input type="file" accept=".json,application/json" data-act="importSave" hidden></label></div>
      <p class="muted" style="font-size:12px;margin-bottom:0">L'export produit un fichier .json à conserver ou à transférer sur un autre appareil.</p></div>
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
  exportSave(el, app) {
    app.save(true);
    downloadText(exportFile(app.state), `coach-de-poche-${app.state.season}-j${app.state.day + 1}.json`, 'application/json');
  },
  async importSave(el, app) {
    const f = el.files?.[0];
    if (!f) return;
    try {
      const st = importFile(await readFileAsText(f));
      if (!st) throw new Error('version');
      if (!(await app.confirm('Remplacer la partie ?', `La partie de l'emplacement ${getSlot()} sera remplacée.`, 'Importer', true))) return;
      app.state = st; app.save(true); app.go('home'); app.toast('Partie importée !');
    } catch { app.toast('Fichier invalide ou incompatible.'); }
  },
  async quit(el, app) {
    if (!(await app.confirm('Quitter ?', 'La partie est sauvegardée automatiquement.', 'Menu principal'))) return;
    app.save(true);
    app.state = null; app.ui.start = { step: 'menu', div: 1 };
    app.render();
  },
};
