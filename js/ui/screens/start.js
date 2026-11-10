/**
 * Écran de démarrage : 3 emplacements de sauvegarde (continuer, nouvelle partie,
 * importer, supprimer), puis choix du club.
 */
import { storedRatings, applyRatings } from '../../game/ratingsImport.js';
import { newGame, startCareer } from '../../game/season.js';
import { load, deleteSave, clubPlayers, slotsInfo, SLOTS, setSlot, importFile, legacySave, dropLegacy, restoreSlot, lastKey } from '../../game/state.js';
import { squadStrength, overall } from '../../engine/ratings.js';
import { money } from '../../game/economy.js';
import { esc, crest, stars, starBar, playerRow } from '../components.js';
import { DIVISIONS, DIV_IDS, COUNTRIES } from '../../data/world.js';
import { readFileAsText } from '../files.js';
import { openCoachEditor } from './coachEditor.js';
import { PHILOSOPHIES } from '../../game/coach.js';
import { autoLineup } from '../../engine/ratings.js';
import { userClub } from '../../game/state.js';
import { loadRealData } from '../../data/realWorld.js';
import { busy } from '../sim.js';
import { onlineSection, lobbyHtml, onlineActions, refreshGames } from './online.js';
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
  if (ui.step === 'lobby') return lobbyHtml(app);
  if (ui.step === 'menu' || !app.state) {
    const info = slotsInfo();
    return `<div class="start-layout"><div class="hero">
      <svg class="logo-ball" viewBox="0 0 100 100"><circle cx="50" cy="50" r="46" fill="#e6edf3"/><path d="M50 22l15 11-6 18H41l-6-18z" fill="#0d1117"/><path d="M50 4v18M65 33l26-6M59 51l14 22M41 51 27 73M35 33 9 27" stroke="#0d1117" stroke-width="4"/></svg>
      <h1>Coach<br><em>de Poche</em></h1>
      <p>Le manager de foot qui tient dans une main.</p>
      <p class="muted" style="font-size:11px">Version ${APP_VERSION}</p>
      <p class="account-line">👤 <b>${esc(app.user?.username || '')}</b> <button class="btn sm ghost" data-act="logout">Se déconnecter</button></p>
      <p class="muted" style="font-size:12px">35 championnats (dont les D2 des 5 grands) · vrais clubs, joueurs et entraîneurs · coupes nationales et continentale</p>
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
          <label class="btn sm">Importer<input type="file" accept=".json,application/json" data-act="import" data-v="${n}" hidden></label>
          ${ui.cloud?.[n] ? `<button class="btn sm" data-act="cloudrestore" data-v="${n}">☁ Récupérer</button>` : ''}</div>`}
      </div>`;
    }).join('')}
    <p class="muted center" style="font-size:12px">Sauvegarde automatique sur cet appareil</p>
    ${onlineSection(app)}</div></div>`;
  }
  return pickerHtml(app, ui);
}

/* ---------------- Choix du club ---------------- */

/** Groupes de championnats affichés dans la colonne de gauche. */
const GROUPS = [
  ['Les 5 grands championnats', (d) => d <= 5],
  ['Deuxièmes divisions', (d) => DIVISIONS[d].level === 2],
  ['Autres championnats européens', (d) => DIVISIONS[d].level === 1 && d > 5 && !['BRA', 'KSA', 'MEX', 'JPN'].includes(DIVISIONS[d].country)],
  ['Reste du monde', (d) => ['BRA', 'KSA', 'MEX', 'JPN'].includes(DIVISIONS[d].country)],
];
const REP_WORD = (r) => (r >= 85 ? 'mondiale' : r >= 75 ? 'continentale' : r >= 62 ? 'nationale' : 'régionale');
const leagueStars = (avg) => Math.max(1, Math.min(5, Math.round((avg - 50) / 7 * 2) / 2));

function pickerHtml(app, ui) {
  const s = app.state;
  const q = (ui.q || '').trim().toLowerCase();
  const byDiv = {};
  for (const c of s.clubs) (byDiv[c.div] ||= []).push(c);
  const leagues = GROUPS.map(([title, f]) => {
    const ids = DIV_IDS.filter(f);
    if (!ids.length) return '';
    return `<div class="lg-group"><div class="label">${title}</div>${ids.map((d) => {
      const cl = byDiv[d] || [];
      const avg = cl.reduce((a, c) => a + c.rep, 0) / Math.max(1, cl.length);
      return `<button class="lg-row ${d === ui.div && !q ? 'on' : ''}" data-act="div" data-v="${d}">
        <span class="flag">${COUNTRIES[DIVISIONS[d].country].flag}</span>
        <span class="grow"><b>${esc(DIVISIONS[d].name)}</b><small>${esc(COUNTRIES[DIVISIONS[d].country].name)} · ${cl.length} clubs</small></span>
        ${starBar(leagueStars(avg), 'sm')}</button>`;
    }).join('')}</div>`;
  }).join('');
  // Clubs : ceux du championnat choisi, ou le résultat de la recherche (tous championnats).
  const list = (q ? s.clubs.filter((c) => c.name.toLowerCase().includes(q) || (c.short || '').toLowerCase() === q).slice(0, 40)
    : (byDiv[ui.div] || [])).slice().sort((a, b) => b.rep - a.rep);
  const strength = new Map(list.map((c) => [c.id, squadStrength(clubPlayers(s, c))]));
  const vals = [...strength.values()];
  const avg = vals.reduce((a, x) => a + x, 0) / Math.max(1, vals.length);
  const D = DIVISIONS[ui.div];
  const head = q ? `<h3 class="pk-title">Recherche : « ${esc(ui.q)} » <small>${list.length} club(s)</small></h3>`
    : `<h3 class="pk-title"><span class="flag">${COUNTRIES[D.country].flag}</span> ${esc(D.name)} <small>${esc(COUNTRIES[D.country].name)}${D.down ? ` · ${D.down} relégués` : ''}${D.up ? ` · ${D.up} promus` : ''}</small></h3>`;
  const cards = list.map((c) => `<button class="club-card ${c.id === ui.sel ? 'on' : ''}" data-act="sel" data-id="${c.id}">
      ${crest(c, 'lg')}
      <b>${esc(c.name)}</b>
      ${starBar(Math.max(0.5, Math.min(5, Math.round((2.5 + (strength.get(c.id) - avg) / 3) * 2) / 2)), 'sm')}
      <small>${q ? `${esc(DIVISIONS[c.div].name)} · ` : ''}${money(c.budget)}</small>
    </button>`).join('') || '<p class="muted" style="padding:20px">Aucun club trouvé.</p>';
  return `<div class="picker">
    <div class="pk-top">
      <button class="btn ghost sm" data-act="back">◂ Retour</button>
      <h2>Choisissez votre club</h2>
      <label class="pk-search">🔎<input type="search" id="pk-q" placeholder="Rechercher un club…" value="${esc(ui.q || '')}" autocomplete="off"></label>
    </div>
    <div class="pk-body">
      <nav class="pk-leagues">${leagues}</nav>
      <section class="pk-clubs">${head}<div class="club-grid">${cards}</div></section>
    </div>
  </div>`;
}

/** Fiche du club choisi : ambition, meilleurs joueurs, bouton pour le prendre. */
function clubSheet(app, id) {
  const s = app.state;
  const c = s.clubs.find((x) => x.id === id);
  const D = DIVISIONS[c.div];
  const players = clubPlayers(s, c).slice().sort((a, b) => overall(b) - overall(a));
  const top = players.slice(0, 5);
  const rank = s.clubs.filter((x) => x.div === c.div).sort((a, b) => b.rep - a.rep).findIndex((x) => x.id === c.id) + 1;
  const n = s.clubs.filter((x) => x.div === c.div).length;
  const ambition = D.level === 2 ? (rank <= 4 ? `Viser la montée en ${DIVISIONS[D.upper]?.name || 'D1'}` : 'Jouer le haut de tableau')
    : rank <= 2 ? 'Jouer le titre' : rank <= 5 ? 'Viser l\'Europe' : rank <= n / 2 ? 'Finir dans la première moitié' : 'Se maintenir';
  const h = app.sheet({
    html: `<div class="row" style="gap:14px">${crest(c, 'lg')}<div class="grow"><h2>${esc(c.name)}</h2>
        <small>${COUNTRIES[D.country].flag} ${esc(D.name)} · réputation ${REP_WORD(c.rep)}</small></div></div>
      <div class="pk-facts">
        <div><small>Budget</small><b>${money(c.budget)}</b></div>
        <div><small>Stade</small><b>${Number(c.stadium).toLocaleString('fr-FR')} places</b></div>
        <div><small>Effectif</small><b>${players.length} joueurs</b></div>
        <div><small>Ambition</small><b>${ambition}</b></div>
      </div>
      <div class="label">Joueurs clés</div>
      <div class="list">${top.map((p) => playerRow(p, { act: '', club: c })).join('')}</div>
      <div class="btns sheet-actions"><button class="btn" data-act="close">Autre club</button>
        <button class="btn primary lg" data-act="take">Prendre ce club ▸</button></div>`,
    actions: { take: () => { h.close(); takeClub(app, c.id); } },
  });
}

function takeClub(app, id) {
  startCareer(app.state, id);
  const slot = app.ui.start.slot || 1;
  enter(app, slot, app.state);
  app.save(true);
  openCoachEditor(app, { mode: 'create', onDone: () => applyPhilosophy(app.state) });
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
  try { localStorage.setItem(lastKey(), String(slot)); } catch { /* ignore */ }
  app.state = state;
  app.tab = 'home';
  app.render();
}

/** Liste des parties en ligne (chargée à l'affichage du menu). */
export function mount(app, root) {
  // Recherche de club : filtre en direct, sans perdre le focus du champ.
  const q = root?.querySelector('#pk-q');
  if (q) {
    q.addEventListener('input', () => {
      app.ui.start.q = q.value;
      const pos = q.selectionStart;
      app.render();
      const n = document.getElementById('pk-q');
      if (n) { n.focus(); try { n.setSelectionRange(pos, pos); } catch { /* ignore */ } }
    });
  }
  if (app.ui.start?.step === 'menu' && !app.state && !app.ui.start.gamesLoaded) {
    app.ui.start.gamesLoaded = true;
    refreshGames(app);
    // Sauvegardes du compte dans le cloud (pour reprendre sur un autre appareil).
    if (app.backend?.kind === 'supabase') app.backend.listSaves().then((rows) => {
      const info = slotsInfo();
      app.ui.start.cloud = Object.fromEntries(rows.filter((r) => !info[r.slot] || new Date(r.updated_at) > new Date(info[r.slot].at + 60000)).map((r) => [r.slot, r]));
      if (Object.keys(app.ui.start.cloud).length && !app.state) app.render();
    }).catch(() => {});
  }
}

export const actions = {
  ...onlineActions,
  async logout(el, app) {
    if (!(await app.confirm('Se déconnecter ?', 'Vos parties restent enregistrées sur votre compte.', 'Se déconnecter'))) return;
    await app.backend.signOut();
    app.user = null; app.state = null; app.ui.start = { step: 'menu', div: 1 };
    app.render();
  },
  async continue(el, app) {
    const n = +el.dataset.v;
    const s = await load(n);
    if (!s) { app.toast('Sauvegarde illisible ou d\'une version incompatible.'); return; }
    enter(app, n, s);
  },
  /** Nouvelle partie : toujours le monde réel (35 championnats). */
  async new(el, app) {
    const slot = +el.dataset.v;
    busy(true, 'Chargement des championnats…');
    try {
      const data = await loadRealData();
      const st = newGame((Date.now() ^ (Math.random() * 1e9)) >>> 0, { real: data });
      // Notes importées par l'utilisateur (Réglages → Notes des joueurs) : appliquées à la nouvelle partie.
      const rl = storedRatings();
      if (rl) applyRatings(st, rl);
      startNew(app, slot, st);
    } catch (e) { app.toast('Impossible de charger les championnats (vérifiez la connexion).', 4000); }
    finally { busy(false); }
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
  async cloudrestore(el, app) {
    const n = +el.dataset.v;
    busy(true, 'Récupération…');
    try {
      const row = await app.backend.getSave(n);
      await restoreSlot(n, row.meta, row.data);
      const s = await load(n);
      if (!s) throw new Error('sauvegarde illisible');
      app.ui.start.cloud = {};
      enter(app, n, s);
      app.toast('Partie récupérée depuis le cloud !');
    } catch (e) { app.toast(`Récupération impossible : ${e.message}`, 4000); } finally { busy(false); }
  },
  div(el, app) { app.ui.start.div = +el.dataset.v; app.ui.start.q = ''; app.render(); },
  sel(el, app) { app.ui.start.sel = +el.dataset.id; clubSheet(app, +el.dataset.id); },
  back(el, app) { app.ui.start.step = 'menu'; app.state = null; app.render(); },

  pick(el, app) { clubSheet(app, +el.dataset.id); },
};
