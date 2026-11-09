/**
 * Écran de démarrage : 3 emplacements de sauvegarde (continuer, nouvelle partie,
 * importer, supprimer), puis choix du club.
 */
import { newGame, startCareer } from '../../game/season.js';
import { load, deleteSave, clubPlayers, slotsInfo, SLOTS, setSlot, importFile, legacySave, dropLegacy } from '../../game/state.js';
import { squadStrength } from '../../engine/ratings.js';
import { money } from '../../game/economy.js';
import { esc, crest, stars } from '../components.js';
import { DIVISIONS, DIV_IDS, COUNTRIES } from '../../data/world.js';
import { readFileAsText } from '../files.js';
import { openCoachEditor } from './coachEditor.js';
import { PHILOSOPHIES } from '../../game/coach.js';
import { autoLineup } from '../../engine/ratings.js';
import { userClub } from '../../game/state.js';
import { loadRealData } from '../../data/realWorld.js';
import { busy } from '../sim.js';
import { APP_VERSION } from '../../version.js';

/** Applique la philosophie et la formation préférée du coach à son club. */
export function applyPhilosophy(state) {
  const uc = userClub(state);
  const c = state.coach;
  uc.tactics = { ...uc.tactics, ...PHILOSOPHIES[c.philosophy].tactics, formation: c.formation };
  delete uc.tactics.custom;
  uc.roles = []; uc.pi = [];
  const lu = autoLineup(clubPlayers(state, uc), c.formation);
  uc.lineup = lu.lineup; uc.bench = lu.bench;
}

export function render(app) {
  const ui = app.ui.start || (app.ui.start = { step: 'menu', div: 1 });
  if (ui.step === 'menu' || !app.state) {
    const info = slotsInfo();
    return `<div class="start-layout"><div class="hero">
      <svg class="logo-ball" viewBox="0 0 100 100"><circle cx="50" cy="50" r="46" fill="#e6edf3"/><path d="M50 22l15 11-6 18H41l-6-18z" fill="#0d1117"/><path d="M50 4v18M65 33l26-6M59 51l14 22M41 51 27 73M35 33 9 27" stroke="#0d1117" stroke-width="4"/></svg>
      <h1>Coach<br><em>de Poche</em></h1>
      <p>Le manager de foot qui tient dans une main.</p>
      <p class="muted" style="font-size:11px">Version ${APP_VERSION}</p>
      <p class="muted" style="font-size:12px">Monde réel (5 grands championnats) ou monde fictif · coupes nationales et continentale</p>
    </div><div>
    ${legacySave() ? `<div class="card"><small>Une sauvegarde d'une ancienne version a été trouvée : elle n'est pas compatible avec le nouveau monde (3 pays, 80 clubs).</small>
      <button class="btn sm block" style="margin-top:8px" data-act="droplegacy">Supprimer l'ancienne sauvegarde</button></div>` : ''}
    ${SLOTS.map((n) => {
      const m = info[n];
      return `<div class="card slot-card">
        ${m ? `<span class="crest" style="background:${m.color};color:${m.color2}">${esc(m.short || '')}</span>
          <div class="grow"><b>${esc(m.club)}</b><br><small>Emplacement ${n} · saison ${m.season}-${m.season + 1} · journée ${m.day + 1}<br>${new Date(m.at).toLocaleString('fr-FR')} · ${Math.round(m.size / 1024)} Ko</small></div>
          <div style="display:flex;flex-direction:column;gap:6px"><button class="btn sm primary" data-act="continue" data-v="${n}">Continuer</button>
          <button class="btn sm danger" data-act="delete" data-v="${n}">Effacer</button></div>`
        : `<div class="grow"><b>Emplacement ${n}</b><br><small>Vide</small></div>
          <div style="display:flex;flex-direction:column;gap:6px"><button class="btn sm primary" data-act="new" data-v="${n}">Nouvelle partie</button>
          <label class="btn sm">Importer<input type="file" accept=".json,application/json" data-act="import" data-v="${n}" hidden></label></div>`}
      </div>`;
    }).join('')}
    <p class="muted center" style="font-size:12px">Sauvegarde automatique sur cet appareil</p></div></div>`;
  }
  const clubs = app.state.clubs.filter((c) => c.div === ui.div)
    .map((c) => ({ c, s: squadStrength(clubPlayers(app.state, c)) }))
    .sort((a, b) => b.c.rep - a.c.rep);
  return `<h2 style="margin:16px 4px 10px">Choisissez votre club</h2>
    <div class="chips">${DIV_IDS.map((d) => `<button class="chip ${d === ui.div ? 'on' : ''}" data-act="div" data-v="${d}">${COUNTRIES[DIVISIONS[d].country].flag} ${DIVISIONS[d].name}</button>`).join('')}</div>
    <div class="card list" style="padding:4px 10px">
      ${clubs.map(({ c, s }) => `<div class="prow" data-act="pick" data-id="${c.id}">
        ${crest(c)}
        <div class="pname"><b>${esc(c.name)}</b><small>${stars(Math.max(1, Math.min(5, Math.round((c.rep - 30) / 12))))} · Budget ${money(c.budget)}</small></div>
        <span class="ovr ${s >= 75 ? 't1' : s >= 65 ? 't2' : 't3'}">${Math.round(s)}</span>
      </div>`).join('')}
    </div>
    <button class="btn ghost block" data-act="back">Retour</button>`;
}

function startNew(app, slot, state) {
  app.ui.start.slot = slot;
  app.state = state;
  app.ui.start.step = 'pick';
  app.ui.start.div = DIV_IDS[0];
  app.render();
}

function enter(app, slot, state) {
  setSlot(slot);
  try { localStorage.setItem('cdp-last', String(slot)); } catch { /* ignore */ }
  app.state = state;
  app.tab = 'home';
  app.render();
}

export const actions = {
  async continue(el, app) {
    const n = +el.dataset.v;
    const s = await load(n);
    if (!s) { app.toast('Sauvegarde illisible ou d\'une version incompatible.'); return; }
    enter(app, n, s);
  },
  new(el, app) {
    const slot = +el.dataset.v;
    const h = app.sheet({
      html: `<h2>Quel monde ?</h2>
        <button class="world-btn on" data-act="real"><b>🌍 Monde réel</b><small>Premier League, LaLiga, Serie A, Bundesliga, Ligue 1 : vrais clubs, joueurs et entraîneurs (saison 2026-27)</small></button>
        <button class="world-btn" data-act="fict"><b>✨ Monde fictif</b><small>80 clubs inventés, 3 pays, montées et descentes</small></button>`,
      actions: {
        real: async () => {
          h.close();
          busy(true, 'Chargement des championnats…');
          try {
            const data = await loadRealData();
            startNew(app, slot, newGame((Date.now() ^ (Math.random() * 1e9)) >>> 0, { real: data }));
          } catch (e) { app.toast('Impossible de charger les données réelles (connexion ?).', 4000); }
          finally { busy(false); }
        },
        fict: () => { h.close(); startNew(app, slot, newGame((Date.now() ^ (Math.random() * 1e9)) >>> 0)); },
      },
    });
  },
  async delete(el, app) {
    const n = +el.dataset.v;
    if (!(await app.confirm('Effacer la partie ?', `L'emplacement ${n} sera vidé définitivement.`, 'Effacer', true))) return;
    deleteSave(n); app.render();
  },
  async import(el, app) {
    const f = el.files?.[0];
    if (!f) return;
    try {
      const s = importFile(await readFileAsText(f));
      if (!s) throw new Error('version');
      enter(app, +el.dataset.v, s);
      app.save(true);
      app.toast('Sauvegarde importée !');
    } catch { app.toast('Fichier de sauvegarde invalide ou incompatible.'); }
  },
  droplegacy(el, app) { dropLegacy(); app.render(); },
  div(el, app) { app.ui.start.div = +el.dataset.v; app.render(); },
  back(el, app) { app.ui.start.step = 'menu'; app.state = null; app.render(); },

  async pick(el, app) {
    const c = app.state.clubs.find((x) => x.id === +el.dataset.id);
    if (!(await app.confirm(c.name, `Prendre les rênes de <b>${esc(c.name)}</b> ?`, "C'est parti !"))) return;
    startCareer(app.state, c.id);
    const slot = app.ui.start.slot || 1;
    enter(app, slot, app.state);
    app.save(true);
    openCoachEditor(app, { mode: 'create', onDone: () => applyPhilosophy(app.state) });
  },
};
