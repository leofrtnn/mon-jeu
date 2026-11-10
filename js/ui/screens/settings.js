/**
 * Réglages : options de match, données (import/export de noms), sauvegardes.
 */
import { exportNames, importNames } from '../../game/dataImport.js';
import { readRatings, applyRatings, storeRatings, storedRatings, clearStoredRatings } from '../../game/ratingsImport.js';
import { esc } from '../components.js';
import { downloadJson, downloadText, readFileAsText } from '../files.js';
import { getSlot, exportFile, importFile, slotsInfo } from '../../game/state.js';
import { displayMode, setDisplayMode } from '../viewport.js';

export function render(app) {
  const st = app.state.settings;
  const tog = (k, label) => `<div class="row between" style="padding:6px 0"><span>${label}</span><button class="btn sm ${st[k] ? 'primary' : ''}" data-act="toggle" data-v="${k}">${st[k] ? 'Activé' : 'Désactivé'}</button></div>`;
  const dm = displayMode();
  return `<div class="card"><h3>Affichage</h3>
      <div class="seg">${[['auto', 'Automatique'], ['pc', 'PC (souris, clavier)'], ['mobile', 'Téléphone']].map(([v, l]) => `<button data-act="display" data-v="${v}" class="${dm === v ? 'on' : ''}">${l}</button>`).join('')}</div>
      <p class="muted" style="font-size:12px;margin-bottom:0">Sur PC : <b>Espace</b> = Continuer / Jouer · <b>1 à 9</b> = menu · <b>Échap</b> = fermer une fenêtre.</p></div>
    <div class="card"><h3>Match</h3>
      <div class="row between" style="padding:6px 0"><span>Moteur de match<br><small class="muted">En direct : les 22 joueurs décident eux-mêmes. Classique : actions tirées au sort.</small></span>
        <button class="btn sm ${st.liveEngine !== false ? 'primary' : ''}" data-act="engine">${st.liveEngine !== false ? 'En direct' : 'Classique'}</button></div>
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
    <div class="card"><h3>Notes des joueurs (import)</h3>
      <p class="muted" style="font-size:13px;margin-top:0">Importez votre propre fichier de notes : liste de joueurs exportée depuis votre jeu de gestion
        (fichier texte avec des « | », CSV ou page HTML). Colonnes reconnues : <b>Nom</b>, <b>Club</b>, <b>CA</b>/<b>PA</b> (sur 200, convertis sur 100),
        <b>Note</b> (sur 100) et les attributs sur 20 (Fin, Pas, Dri, Tac, Vit, For, Vis, Sf, Réf…).</p>
      ${(() => { const st0 = storedRatings(); return st0 ? `<p style="font-size:13px;margin:0 0 8px">✅ Import mémorisé : <b>${st0.length}</b> joueurs (appliqué aussi aux nouvelles parties).</p>` : ''; })()}
      <div class="btns"><label class="btn primary">Importer un fichier de notes<input type="file" accept=".txt,.csv,.tsv,.html,.htm,.rtf,text/*" data-act="importRatings" hidden></label>
        ${storedRatings() ? '<button class="btn" data-act="forgetRatings">Oublier l\'import</button>' : ''}</div>
      ${app.ui.ratingsMissing?.length ? `<details style="margin-top:8px"><summary class="muted" style="font-size:12px">${app.ui.ratingsMissing.length} joueur(s) du fichier non trouvés dans la partie</summary><p class="muted" style="font-size:12px">${app.ui.ratingsMissing.slice(0, 80).map(esc).join(', ')}${app.ui.ratingsMissing.length > 80 ? '…' : ''}</p></details>` : ''}</div>
    <div class="card"><button class="btn danger block" data-act="quit">Quitter vers le menu</button></div>`;
}

export const actions = {
  engine(el, app) { app.state.settings.liveEngine = app.state.settings.liveEngine === false; app.save(); app.render(); },
  display(el, app) { setDisplayMode(el.dataset.v); app.render(); },
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
  async importRatings(el, app) {
    const f = el.files?.[0];
    if (!f) return;
    try {
      const { list, error } = readRatings(await readFileAsText(f));
      if (error || !list.length) { app.toast(error || 'Aucun joueur lisible dans ce fichier.', 4000); return; }
      const r = applyRatings(app.state, list);
      storeRatings(list);
      app.ui.ratingsMissing = r.missing;
      app.save(true); app.render();
      app.toast(`${r.matched} joueur(s) mis à jour sur ${r.total} lus.`, 4000);
    } catch (e) { console.warn(e); app.toast('Fichier illisible.'); }
  },
  forgetRatings(el, app) { clearStoredRatings(); app.ui.ratingsMissing = null; app.render(); app.toast('Import oublié (les notes de la partie en cours restent).'); },
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
    if (app.online) { const m = await import('./online.js'); m.leaveOnline(app); }
    app.state = null; app.ui.start = { step: 'menu', div: 1 };
    app.render();
  },
};
