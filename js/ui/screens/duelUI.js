/**
 * RENDEZ-VOUS DES MATCHS ENTRE MANAGERS (carrière en ligne)
 * ------------------------------------------------------------------
 * Le jour d'un match contre un autre manager humain :
 *  - celui qui reçoit ouvre le salon et invite l'autre ; s'il ne vient pas, il peut jouer
 *    sans lui (l'adjoint de l'autre dirige son équipe, comme avant) ;
 *  - celui qui se déplace rejoint le salon et envoie SA compo et SA tactique du jour ;
 *  - celui qui reçoit fige la configuration du match et l'envoie : les deux écrans de match
 *    démarrent avec exactement la même (voir online/duel.js pour la suite).
 */
import { today, fixtureKey, userMatchCfg } from '../../game/season.js';
import { humanOfClub } from '../../game/humans.js';
import { replayCfg } from '../../engine/match.js';
import { packState, unpackState } from '../../game/state.js';
import { clubById } from '../../game/state.js';
import { esc, crest } from '../components.js';
import { openMatch } from './match.js';

/** Match du jour contre un autre manager humain (ou null). */
export function duelFixture(s) {
  if (!s?.online || s.preseason?.active || s.seasonOver) return null;
  const f = today(s)?.userFixture;
  if (!f || f.comp === 'intl') return null;
  const other = f.h === s.userClubId ? f.a : f.h;
  const peer = humanOfClub(s, other);
  if (peer === undefined || peer === s.online.cur) return null;
  return { f, key: fixtureKey(s, f), home: f.h === s.userClubId, peer, peerName: s.online.names?.[peer] || 'l\'autre manager', other };
}

/** Lien entre l'écran de match et le salon temps réel de la partie. */
function duelLink(app, df) {
  const o = app.online;
  return {
    peerName: df.peerName,
    send: (d) => o.room?.send({ t: 'duel', key: df.key, to: df.peer, d }),
    attach: (fn) => {
      o.duelRecv = (msg) => { if (msg.key === df.key) fn(msg.d); };
      // Messages arrivés avant l'ouverture de l'écran de match : rejoués dans l'ordre.
      const early = (o.duelEarly || []).filter((msg) => msg.key === df.key);
      o.duelEarly = [];
      for (const msg of early) fn(msg.d);
    },
    detach: () => { o.duelRecv = null; o.duelEarly = []; },
  };
}

const fixtureTitle = (s, df) => {
  const h = clubById(s, df.f.h), a = clubById(s, df.f.a);
  return `<div class="row" style="justify-content:center;gap:12px;margin:10px 0">${crest(h)}<b style="font-size:20px">VS</b>${crest(a)}</div>
    <p class="center" style="margin:0"><b>${esc(h.name)}</b> – <b>${esc(a.name)}</b></p>`;
};

/** Celui qui reçoit : invite l'autre manager, puis lance le match à deux (ou sans lui). */
export function hostDuel(app, df = duelFixture(app.state)) {
  const s = app.state, o = app.online;
  if (!df || !o?.room) { openMatch(app); return; }
  let started = false;
  const invite = () => o.room.send({ t: 'duel-invite', key: df.key, to: df.peer });
  invite();
  const timer = setInterval(invite, 2500);
  const stop = () => { clearInterval(timer); o.duelLobby = null; };
  const h = app.sheet({
    dismissable: false,
    html: `<h2>⚔ Match contre ${esc(df.peerName)}</h2>${fixtureTitle(s, df)}
      <p>Vous recevez : le match se joue <b>en direct à deux</b>, chacun dirige son équipe (changements, tactique, causerie).</p>
      <div class="card center" id="duelst">⏳ En attente de <b>${esc(df.peerName)}</b>… (il doit ouvrir le jeu et cliquer « Rejoindre le match »)</div>
      <div class="btns"><button class="btn" data-act="back">Retour</button><button class="btn" data-act="solo">Jouer sans lui</button></div>
      <small class="muted">« Jouer sans lui » : son adjoint dirige son équipe avec sa compo et sa tactique.</small>`,
    actions: {
      back: () => { stop(); h.close(); },
      solo: () => { stop(); h.close(); openMatch(app); },
    },
  });
  o.duelLobby = {
    key: df.key,
    onMsg: async (msg) => {
      if (started) return;
      if (msg.t === 'duel-here') { const el = h.body?.querySelector('#duelst'); if (el) el.innerHTML = `✅ <b>${esc(df.peerName)}</b> est là : préparation du match…`; invite(); }
      if (msg.t !== 'duel-join' || msg.key !== df.key) return;
      started = true; stop();
      // Configuration figée du match : ma compo + celle que l'autre vient d'envoyer.
      const cfg = userMatchCfg(s);
      const side = df.home ? 'away' : 'home';
      Object.assign(cfg[side], msg.setup || {}, { isAI: false });
      cfg.home.isAI = false; cfg.away.isAI = false;
      const rc = replayCfg(cfg);
      o.room.send({ t: 'duel-start', key: df.key, to: df.peer, cfg: await packState(rc), label: today(s).label });
      h.close();
      openMatch(app, { baseCfg: JSON.parse(JSON.stringify(rc)), duel: duelLink(app, df) });
    },
  };
}

/** Celui qui se déplace : rejoint le salon, envoie sa compo, puis joue le match à deux. */
export function joinDuel(app, df = duelFixture(app.state)) {
  const s = app.state, o = app.online;
  if (!df || !o?.room) return;
  const here = () => o.room.send({ t: 'duel-here', key: df.key, to: df.peer });
  here();
  const timer = setInterval(here, 2500);
  let joined = false, started = false;
  const stop = () => { clearInterval(timer); o.duelLobby = null; };
  const h = app.sheet({
    dismissable: false,
    html: `<h2>⚔ Match contre ${esc(df.peerName)}</h2>${fixtureTitle(s, df)}
      <p>Réglez d'abord votre compo et votre tactique : elles sont envoyées au coup d'envoi.</p>
      <div class="card center" id="duelst">⏳ En attente de <b>${esc(df.peerName)}</b> (il reçoit et lance le match)…</div>
      <div class="btns"><button class="btn" data-act="back">Retour</button></div>`,
    actions: { back: () => { stop(); h.close(); } },
  });
  o.duelLobby = {
    key: df.key,
    onMsg: async (msg) => {
      if (msg.key !== df.key || started) return;
      if (msg.t === 'duel-invite' && !joined) {
        joined = true;
        const mine = userMatchCfg(s)[df.home ? 'home' : 'away'];
        const { players, club, ...setup } = mine; // eslint-disable-line no-unused-vars
        o.room.send({ t: 'duel-join', key: df.key, to: df.peer, setup: JSON.parse(JSON.stringify(setup)) });
        const el = h.body?.querySelector('#duelst'); if (el) el.innerHTML = '✅ Connecté : le match va commencer…';
      }
      if (msg.t === 'duel-start') {
        started = true; stop(); h.close();
        const cfg = await unpackState(msg.cfg);
        openMatch(app, {
          cfg, label: msg.label, userSide: df.home ? 0 : 1, duel: duelLink(app, df),
          onFinish: () => {
            s.duelDone = df.key;
            app.save(true); app.render();
            app.toast('Match terminé : le résultat officiel sera intégré à la prochaine journée. Cliquez « Prêt ».', 4000);
          },
        });
      }
    },
  };
}

/** Message du salon concernant les matchs à deux (appelé par online.js). */
export function onDuelMessage(app, msg) {
  const o = app.online;
  if (msg.t === 'duel') { if (o.duelRecv) o.duelRecv(msg); else (o.duelEarly ||= []).push(msg); return; }
  if (o.duelLobby && msg.key === o.duelLobby.key) { o.duelLobby.onMsg(msg); return; }
  // Pas dans le salon : on prévient (l'autre attend pour jouer).
  const df = duelFixture(app.state);
  if (!df || msg.key !== df.key || app.state.duelDone === df.key) return;
  if (msg.t === 'duel-invite' || msg.t === 'duel-here') {
    const fresh = !o.peerWaiting || Date.now() - o.peerWaiting.at > 60000;
    o.peerWaiting = { key: df.key, at: Date.now() };
    if (fresh) { app.toast(`⚔ ${df.peerName} vous attend pour jouer votre match en direct !`, 4500); if (app.tab === 'home') app.render(); }
  }
}
