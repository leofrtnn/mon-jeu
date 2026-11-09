/**
 * Carrière en ligne (interface) : liste des parties, création, code d'invitation, salon
 * (choix des clubs), puis en jeu : bouton « Prêt », attente des autres managers,
 * calcul de la journée par l'hôte et réception des nouvelles versions.
 */
import { esc, crest } from '../components.js';
import { packState, unpackState, setSlot, clubById } from '../../game/state.js';
import { loadRealData } from '../../data/realWorld.js';
import { createOnlineCareer, adoptOnline, makeSlice, hostAdvance } from '../../online/multi.js';
import { DIVISIONS } from '../../data/world.js';
import { busy } from '../sim.js';

const LEAGUE_NAMES = { ENG1: 'Premier League', ESP1: 'LaLiga', ITA1: 'Serie A', GER1: 'Bundesliga', FRA1: 'Ligue 1', POR1: 'Liga Portugal', NED1: 'Eredivisie', BEL1: 'Pro League', TUR1: 'Süper Lig', CZE1: 'Chance Liga',
  GRE1: 'Super League', NOR1: 'Eliteserien', POL1: 'Ekstraklasa', DEN1: 'Superliga', AUT1: 'Bundesliga (AUT)', SUI1: 'Super League (SUI)', SCO1: 'Premiership', SWE1: 'Allsvenskan', CRO1: 'HNL', SRB1: 'SuperLiga',
  BRA1: 'Brasileirão', KSA1: 'Saudi Pro League', MEX1: 'Liga MX', JPN1: 'J1 League', RUS1: 'Premier League (RUS)', UKR1: 'Premier League (UKR)', ROU1: 'SuperLiga (ROU)', HUN1: 'NB I', CYP1: 'First Division', ISR1: 'Ligat HaAl',
  ENG2: 'Championship', ESP2: 'LaLiga 2', ITA2: 'Serie B', GER2: '2. Bundesliga', FRA2: 'Ligue 2' };

/* ---------------- Menu (écran d'accueil) ---------------- */

export function onlineSection(app) {
  const ui = app.ui.start;
  const available = app.backend?.kind === 'supabase' || app.allowLocalOnline; // (allowLocalOnline : tests automatiques)
  const games = ui.games || [];
  return `<div class="card online-card">
    <div class="row between"><h3 style="margin:0">🌐 Carrière en ligne</h3><small class="muted">2 à 8 managers · comme FM</small></div>
    ${!available ? '<p class="muted" style="font-size:12px;margin:8px 0 0">Indisponible : le serveur en ligne n\'est pas encore configuré.</p>' : `
    ${games.length ? games.map((g) => `<div class="prow" data-act="ogame" data-id="${g.id}"><span class="tag">${esc(g.code)}</span><div class="pname"><b>${esc(g.name)}</b><small>${g.status === 'lobby' ? 'Salon d\'attente' : `En cours · version ${g.version}`}</small></div><span class="btn sm primary">${g.status === 'lobby' ? 'Salon' : 'Reprendre'}</span></div>`).join('') : '<p class="muted" style="font-size:13px;margin:8px 0">Aucune partie en ligne pour le moment.</p>'}
    <div class="btns" style="margin-top:8px"><button class="btn primary" data-act="ocreate">Créer une partie</button><button class="btn" data-act="ojoin">Rejoindre avec un code</button></div>`}
  </div>`;
}

export async function refreshGames(app) {
  if (app.backend?.kind !== 'supabase' && !app.allowLocalOnline) return;
  try { app.ui.start.games = await app.backend.myGames(); } catch (e) { app.ui.start.games = []; }
  if (app.ui.start.step === 'menu' && !app.state) app.render();
}

/* ---------------- Salon ---------------- */

let realCache = null;
const realData = async () => (realCache ||= await loadRealData());

export function lobbyHtml(app) {
  const L = app.ui.lobby;
  if (!L?.game) return '<p class="muted">Chargement…</p>';
  const { game, players = [], clubs = [] } = L;
  const me = players.find((p) => p.user_id === app.user.id);
  const host = game.host === app.user.id;
  const taken = new Map(players.filter((p) => p.club_id != null).map((p) => [p.club_id, p.username]));
  const league = L.league || 'ENG1';
  const list = clubs.filter((c) => c.league === league).sort((a, b) => b.rep - a.rep);
  const canStart = host && players.length >= 2 && players.every((p) => p.club_id != null);
  return `<div class="row between" style="margin:12px 4px"><h2 style="margin:0">${esc(game.name)}</h2><button class="btn sm" data-act="olobbyback">◂ Menu</button></div>
    <div class="layout-2"><div class="col">
      <div class="card center"><small class="muted">Code d'invitation à donner à vos amis</small><div class="big lobby-code">${esc(game.code)}</div>
        <button class="btn sm" data-act="ocopy">Copier le code</button></div>
      <div class="card"><h3>Managers (${players.length}/${game.max_players})</h3>
        ${players.map((p) => { const c = clubs.find((x) => x.gameId === p.club_id); return `<div class="row between" style="padding:6px 0;border-bottom:1px solid var(--line)"><span>${p.user_id === game.host ? '👑 ' : ''}<b>${esc(p.username)}</b>${p.user_id === app.user.id ? ' <small>(vous)</small>' : ''}</span><small>${c ? esc(c.name) : '<span class="muted">choisit son club…</span>'}</small></div>`; }).join('')}
        ${host ? `<button class="btn primary lg block" data-act="ostart" ${canStart ? '' : 'disabled'} style="margin-top:10px">Lancer la partie ▸</button>
          <small class="muted">${canStart ? 'Tout le monde a choisi son club.' : 'Il faut au moins 2 managers, chacun avec un club.'}</small>`
          : '<p class="muted" style="margin:10px 0 0">En attente du lancement par l\'hôte 👑.</p>'}
      </div>
    </div><div class="col">
      <div class="card"><h3>Votre club ${me?.club_id ? `: ${esc(clubs.find((x) => x.gameId === me.club_id)?.name || '')}` : ''}</h3>
        <div class="chips">${[...new Set(clubs.map((c) => c.league))].map((lg) => `<button class="chip ${lg === league ? 'on' : ''}" data-act="oleague" data-v="${lg}">${esc(LEAGUE_NAMES[lg] || lg)}</button>`).join('')}</div>
        <div class="list">${list.map((c) => { const t = taken.get(c.gameId); const mine = me?.club_id === c.gameId; return `<div class="prow ${t && !mine ? 'dim' : ''}" ${t && !mine ? '' : `data-act="opick" data-id="${c.gameId}"`}>${crest({ color: c.colors[0], color2: c.colors[1], short: c.short, logo: c.logo })}<div class="pname"><b>${esc(c.name)}</b><small>${mine ? '✔ votre club' : t ? `pris par ${esc(t)}` : `réputation ${c.rep}`}</small></div></div>`; }).join('')}</div>
      </div>
    </div></div>`;
}

async function openLobby(app, game) {
  const data = await realData();
  app.ui.start.step = 'lobby';
  app.ui.lobby = { game, players: await app.backend.players(game.id), clubs: data.clubs.map((c, i) => ({ ...c, gameId: i + 1 })), league: app.ui.lobby?.league };
  app.ui.lobby.unsub?.();
  app.ui.lobby.unsub = app.backend.subscribe(game.id, async () => {
    const g = await app.backend.getGame(game.id);
    if (!g) return;
    if (g.status === 'running') { app.ui.lobby.unsub?.(); return enterOnline(app, g); }
    if (app.ui.start.step !== 'lobby') return;
    app.ui.lobby.game = g;
    app.ui.lobby.players = await app.backend.players(game.id);
    app.render();
  });
  app.render();
}

/* ---------------- En jeu ---------------- */

/** Charge la dernière version de la partie et entre dans le jeu. */
export async function enterOnline(app, game) {
  if (app._enteringOnline || (app.online && app.online.game.id === game.id && app.state?.online)) return; // déjà en cours / déjà dedans
  app._enteringOnline = true;
  app.ui.lobby?.unsub?.();
  busy(true, 'Chargement de la partie…');
  try {
    const st = await app.backend.loadState(game.id);
    const state = adoptOnline(await unpackState(st.data), app.user.id);
    app.online?.unsub?.();
    app.online = { game, uid: app.user.id, isHost: game.host === app.user.id, blob: st.data, players: await app.backend.players(game.id), seenSeason: state.season };
    app.state = state;
    app.tab = 'home';
    app.ui.start = { step: 'menu', div: 1 };
    app.online.unsub = app.backend.subscribe(game.id, () => onRemoteChange(app));
    app.save(true);
    app.render();
    if (!state.coach?.created) import('./coachEditor.js').then((m) => m.openCoachEditor(app, { mode: 'create' }));
  } catch (e) {
    app.toast(`Impossible de charger la partie : ${e.message}`, 4000);
  } finally { busy(false); app._enteringOnline = false; }
}

export function leaveOnline(app) {
  app.online?.unsub?.();
  app.online = null;
}

async function onRemoteChange(app) {
  const o = app.online;
  if (!o) return;
  if (o.busy || o.checking) { o.recheck = true; return; } // une vérification à la fois
  o.checking = true;
  try { await checkRemote(app); } finally {
    o.checking = false;
    if (o.recheck) { o.recheck = false; setTimeout(() => onRemoteChange(app), 50); }
  }
}

async function checkRemote(app) {
  const o = app.online;
  const g = await app.backend.getGame(o.game.id);
  if (!g || !app.online) return;
  o.game = g;
  if (g.version > app.state.online.version) {
    // Nouvelle journée publiée par l'hôte.
    o.busy = true;
    try {
      const st = await app.backend.loadState(g.id);
      const prevSeason = app.state.season;
      const state = adoptOnline(await unpackState(st.data), o.uid);
      o.blob = st.data; app.state = state;
      app.closeSheets?.();
      app.save(true);
      app.render();
      if (state.season > prevSeason && state.online.seasonReports?.[o.uid]) {
        import('./endSeason.js').then((m) => m.showEndSeason(app, state.online.seasonReports[o.uid]));
      } else app.toast(`📅 ${state.lastResult ? 'Journée jouée' : 'Nouvelle journée'} — à vous de jouer !`, 3000);
    } finally { o.busy = false; }
    return;
  }
  o.players = await app.backend.players(g.id);
  if (o.isHost) await hostTryAdvance(app);
  if (app.tab === 'home') app.render();
}

/** L'hôte calcule la journée quand tout le monde est prêt. */
async function hostTryAdvance(app) {
  const o = app.online;
  const v = app.state.online.version;
  if (o.advancing || !o.players.length || !o.players.every((p) => p.ready && p.version === v)) return;
  o.advancing = true;
  busy(true, 'Tous prêts : calcul de la journée…');
  try {
    const slices = [];
    for (const p of o.players) if (p.user_id !== o.uid && p.slice) slices.push(await unpackState(p.slice));
    const { report, conflicts } = hostAdvance(app.state, slices);
    const blob = await packState(app.state);
    await app.backend.publishState(o.game.id, app.state.online.version, blob);
    o.blob = blob; o.ready = false;
    app.save(true);
    app.render();
    if (report.endSeason) import('./endSeason.js').then((m) => m.showEndSeason(app, report.endSeason));
    else import('./dayReport.js').then((m) => m.showDayReport(app, report));
    if (conflicts.length) app.toast(`${conflicts.length} transfert(s) en conflit annulé(s).`, 3500);
  } catch (e) {
    app.toast(`Erreur pendant le calcul : ${e.message}`, 5000);
  } finally { o.advancing = false; busy(false); }
}

/** Carte de l'Accueil en carrière en ligne. */
export function onlineCard(app) {
  const o = app.online;
  if (!o) return '';
  const v = app.state.online.version;
  const ps = o.players || [];
  const me = ps.find((p) => p.user_id === o.uid);
  const ready = me?.ready && me.version === v;
  const n = ps.filter((p) => p.ready && p.version === v).length;
  const name = (p) => app.state.online.names[p.user_id] || p.username;
  const clubOf = (p) => clubById(app.state, p.club_id);
  return `<div class="card online-ready ${ready ? 'is-ready' : ''}">
    <div class="row between"><b>🌐 ${esc(o.game.name)} · ${esc(o.game.code)}</b><small>${n}/${ps.length} prêts</small></div>
    <div class="ready-list">${ps.map((p) => `<span class="tag ${p.ready && p.version === v ? 'good' : ''}">${p.ready && p.version === v ? '✔' : '…'} ${esc(name(p))}${clubOf(p) ? ` · ${esc(clubOf(p).short)}` : ''}${p.user_id === o.game.host ? ' 👑' : ''}</span>`).join('')}</div>
    ${ready ? `<p class="muted" style="margin:8px 0">En attente des autres managers… ${o.isHost ? 'Vous êtes l\'hôte : la journée sera calculée ici dès que tout le monde sera prêt (gardez le jeu ouvert).' : 'L\'hôte calculera la journée dès que tout le monde sera prêt.'}</p>
      <button class="btn block" data-act="ounready">Annuler « Prêt »</button>`
    : `<button class="btn primary lg block" data-act="oready">✅ Prêt ${app.state.seasonOver ? '(fin de saison)' : app.state.preseason?.active ? '(lancer la saison)' : 'pour la journée suivante'}</button>
      <small class="muted">Réglez votre équipe, puis cliquez « Prêt ». La journée est jouée quand tous les managers sont prêts.</small>`}
  </div>`;
}

export async function setMeReady(app) {
  const o = app.online;
  busy(true, 'Envoi…');
  try {
    let slice = null;
    if (!o.isHost) {
      const base = adoptOnline(await unpackState(o.blob), o.uid);
      slice = await packState(makeSlice(app.state, base));
    }
    await app.backend.setReady(o.game.id, app.state.online.version, slice);
    o.players = await app.backend.players(o.game.id);
    app.render();
    if (o.isHost) await hostTryAdvance(app);
  } catch (e) { app.toast(`Envoi impossible : ${e.message}`, 4000); }
  finally { busy(false); }
}

export const onlineActions = {
  ocreate(el, app) {
    const h = app.sheet({
      html: `<h2>Nouvelle partie en ligne</h2>
        <label class="field"><span>Nom de la partie</span><input id="ogname" maxlength="40" value="Carrière de ${esc(app.user.username)}"></label>
        <label class="field"><span>Managers maximum</span><select id="ogmax">${[2, 3, 4, 5, 6, 7, 8].map((n) => `<option ${n === 4 ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
        <p class="muted" style="font-size:12px">Vous serez l'hôte 👑 : c'est votre téléphone qui calculera les journées, gardez le jeu ouvert pendant la partie.</p>
        <button class="btn primary lg block" data-act="go">Créer</button>`,
      actions: {
        go: async () => {
          const name = document.getElementById('ogname').value.trim() || 'Partie';
          const max = +document.getElementById('ogmax').value;
          try { const g = await app.backend.createGame(name, max); h.close(); await openLobby(app, g); } catch (e) { app.toast(e.message, 4000); }
        },
      },
    });
  },
  ojoin(el, app) {
    const h = app.sheet({
      html: `<h2>Rejoindre une partie</h2>
        <label class="field"><span>Code (6 caractères)</span><input id="ogcode" maxlength="6" autocapitalize="characters" style="text-transform:uppercase;letter-spacing:.2em;font-size:22px"></label>
        <button class="btn primary lg block" data-act="go">Rejoindre</button>`,
      actions: {
        go: async () => {
          try { const g = await app.backend.joinGame(document.getElementById('ogcode').value); h.close(); await openLobby(app, g); } catch (e) { app.toast(e.message, 4000); }
        },
      },
    });
  },
  async ogame(el, app) {
    const g = (app.ui.start.games || []).find((x) => x.id === el.dataset.id) || await app.backend.getGame(el.dataset.id);
    if (!g) return;
    if (g.status === 'lobby') return openLobby(app, g);
    return enterOnline(app, g);
  },
  olobbyback(el, app) { app.ui.lobby?.unsub?.(); app.ui.lobby = null; app.ui.start.step = 'menu'; app.render(); refreshGames(app); },
  oleague(el, app) { app.ui.lobby.league = el.dataset.v; app.render(); },
  async opick(el, app) {
    try { await app.backend.chooseClub(app.ui.lobby.game.id, +el.dataset.id); app.ui.lobby.players = await app.backend.players(app.ui.lobby.game.id); app.render(); }
    catch (e) { app.toast(e.message, 3500); }
  },
  ocopy(el, app) { try { navigator.clipboard?.writeText(app.ui.lobby.game.code); app.toast('Code copié !'); } catch { app.toast(app.ui.lobby.game.code); } },
  async ostart(el, app) {
    const L = app.ui.lobby;
    busy(true, 'Création du monde…');
    try {
      const players = (await app.backend.players(L.game.id)).sort((a, b) => (a.user_id === L.game.host ? -1 : b.user_id === L.game.host ? 1 : 0));
      if (players.length < 2 || players.some((p) => p.club_id == null)) throw new Error('Chaque manager doit choisir un club.');
      const state = createOnlineCareer(await realData(), (Date.now() ^ (Math.random() * 1e9)) >>> 0, players, L.game.id);
      await app.backend.startGame(L.game.id, await packState(state));
      L.unsub?.();
      await enterOnline(app, { ...L.game, status: 'running', version: 1 });
    } catch (e) { app.toast(e.message, 4000); }
    finally { busy(false); }
  },
  oready(el, app) { return setMeReady(app); },
  async ounready(el, app) {
    try { await app.backend.cancelReady(app.online.game.id); app.online.players = await app.backend.players(app.online.game.id); app.render(); }
    catch (e) { app.toast(e.message, 3500); }
  },
};

export { setSlot, DIVISIONS };
