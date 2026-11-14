/**
 * ÉCRAN DE MATCH EN DIRECT
 * Relie le moteur (stepMinute) au rendu canvas (MatchView) :
 * tableau d'affichage, momentum, commentaires, vitesse, résumé rapide,
 * pause (changements, tactique), mi-temps (stats + causerie), fin de match.
 */
import { userMatchCfg, completeDay, today, fixtureKey } from '../../game/season.js';
import { createMatch, stepMinute, makeSub, changeFormation, swapSlots, moveSlot, setRole, setTactic, snapshotMatch, restoreMatch, replayCfg, applyPlan, teamTalk, summarize, penaltyShootout, clockLabel, activePlayers } from '../../engine/match.js';
import { describe, iconFor } from '../../engine/commentary.js';
import { FORMATION_NAMES, FORMATION_GROUPS, ROLES, rolesFor, MENTALITIES, MENTALITY_LABELS, LEVELS, PRESSING_LABELS, TEMPO_LABELS, MAX_SUBS, POSITION_GROUP, TEAM_INSTRUCTIONS, DEFAULT_TACTICS, PLAYER_INSTRUCTIONS, WIDTH_LABELS } from '../../data/constants.js';
import { ratingAt } from '../../engine/ratings.js';
import { MatchView } from '../matchView.js';
import { Broadcast, matchDay } from '../broadcast.js';
import { currentDate } from '../../game/dates.js';
import { coachName } from '../../game/coach.js';
import { esc, crest, cmpBar, ratingChip, posBadge, seg, scaleColor, face } from '../components.js';
import { avatarSvg } from '../avatar.js';
import { MatchAudio } from '../audio.js';
import { xgChart, heatmap } from '../charts.js';
import { userClub } from '../../game/state.js';
import { staffEffects } from '../../game/career.js';
import { managerOf } from '../../game/managers.js';
import { pressQuestion, pressAnswer } from '../../game/media.js';
import { openDecisions } from '../../game/inbox.js';
import { openInterview } from './inboxUI.js';
import { showDayReport } from './dayReport.js';

const SPEEDS = [1, 2, 4];
/** Événements montrés en mode "Résumé rapide". */
const QUICK_KEEP = new Set(['goal', 'red', 'yellow', 'penalty', 'var', 'ht', 'ft', 'injury', 'kickoff', 'freekick']);

/* ---------- Reprise du match après un rechargement (anti-triche) ----------
 * Dès le coup d'envoi, la partie est « verrouillée » sur ce match (state.liveLock) et
 * l'état complet du match est mis de côté toutes les 2 secondes. Si la page est
 * rechargée, le match reprend exactement où il en était, au lieu de recommencer. */
const LIVE_KEY = 'cdp-live';
const liveSig = (s) => `${s.seed}|${s.season}|${s.day}|${s.userClubId}`;
/** Un match officiel est-il en cours (à reprendre) ? */
export const pendingLiveMatch = (s) => !!(s?.liveLock && s.liveLock === liveSig(s));
function readSnap(s) {
  try { const o = JSON.parse(localStorage.getItem(LIVE_KEY) || 'null'); return o && o.sig === liveSig(s) ? o.snap : null; } catch { return null; }
}
function clearSnap() { try { localStorage.removeItem(LIVE_KEY); } catch { /* ignore */ } }

/**
 * opts (facultatif, matchs amicaux) : { cfg, label, userSide, onFinish(summary, m) }.
 * Sans opts : match du jour de l'utilisateur, appliqué à la saison en fin de match.
 */
export function openMatch(app, opts = {}) {
  const s = app.state;
  const cfg = opts.cfg || userMatchCfg(s);
  if (!cfg) { app.toast('Pas de match aujourd\'hui.'); return; }
  const m = createMatch(cfg);
  const userSide = opts.userSide ?? (cfg.home.club.id === s.userClubId ? 0 : 1);
  const label = opts.label || today(s).label;
  const [hc, ac] = [cfg.home.club, cfg.away.club];

  const root = document.createElement('div');
  root.className = 'match-screen';
  root.innerHTML = `
    <div class="scoreboard">
      <div class="sb-main">
        <div class="sb-team">${crest(hc, 'sm')}<span>${esc(hc.short)}</span></div>
        <div><div class="sb-score" id="sb-score">0 - 0</div><div class="sb-clock" id="sb-clock">${esc(label)}</div></div>
        <div class="sb-team away">${crest(ac, 'sm')}<span>${esc(ac.short)}</span></div>
      </div>
      <div class="sb-scorers"><div id="sc-0"></div><div id="sc-1"></div></div>
      <div class="momentum" title="Momentum"><i id="mo-0" style="width:50%;background:${hc.color}"></i><i id="mo-1" style="width:50%;background:${ac.color}"></i></div>
    </div>
    <div class="pitch-area"><canvas id="pitch"></canvas><div class="bcast" id="bcast"></div><div class="tapcard hidden" id="tapcard"></div><div class="pitch-caption hidden" id="caption"></div></div>
    <div class="feed" id="feed"></div>
    <div class="controls">
      <button class="btn primary" data-c="pause" title="Compo, changements, tactique">📋 Compo &amp; tactique</button>
      <button class="btn" data-c="speed">x${SPEEDS[0]}</button>
      <button class="btn" data-c="quick">⚡ Résumé</button>
      <button class="btn" data-c="skip">⏭ Fin</button>
      <button class="btn" data-c="style" style="flex:.6" title="Vue">${{ fm: '2D', '3d': '3D', anim: '🎥' }[s.settings.matchStyle || '3d']}</button>
      <button class="btn" data-c="cam" style="flex:.6" title="Caméra">📹</button>
      <button class="btn" data-c="labels" style="flex:.6" title="Étiquettes">${{ name: 'Aa', num: '#', none: '∅' }[s.settings.labels || 'name']}</button>
      <button class="btn" data-c="audio" style="flex:.6">${s.settings.audio ? '🔊' : '🔇'}</button>
    </div>`;
  app.$overlay.appendChild(root);
  document.body.style.overflow = 'hidden';

  const $ = (id) => root.querySelector('#' + id);
  const ctrl = { speedIdx: Math.max(0, SPEEDS.indexOf(s.settings.speed || 1)), quick: false, finished: false, scorers: [[], []], recent: [] };
  const official = !opts.cfg;
  // Journal des décisions du coach (instant précis = nombre de pas du moteur) : permet de
  // rejouer ce match À L'IDENTIQUE sur un autre appareil (match entre managers, en ligne).
  const replay = opts.replay || null;
  const journal = [];
  let jIdx = 0;
  const rec = (op, a) => { if (!replay) journal.push({ n: view.liveSteps || 0, op, a }); };
  const resuming = official && pendingLiveMatch(s);
  const saveSnap = () => {
    if (!official || !s.liveLock || view.replayLive) return; // pas pendant un ralenti (positions rejouées)
    try { localStorage.setItem(LIVE_KEY, JSON.stringify({ sig: liveSig(s), snap: { m: snapshotMatch(m), live: view.live ? view.live.snapshot() : null } })); } catch { /* stockage plein : tant pis */ }
  };
  const onHide = () => { if (document.visibilityState === 'hidden') saveSnap(); };
  const lockMatch = () => {
    if (!official || s.liveLock) return;
    s.liveLock = liveSig(s); app.save(true);
    saveSnap();
  };
  if (official) {
    ctrl.snapT = setInterval(saveSnap, 2000);
    window.addEventListener('pagehide', saveSnap);
    document.addEventListener('visibilitychange', onHide);
  }
  const audio = new MatchAudio();
  const nameOf = (id) => {
    for (const t of m.teams) for (const mp of [...t.onPitch, ...t.bench, ...t.out]) if (mp && mp.id === id) return mp.name;
    return '';
  };
  const ctx = { name: nameOf, teams: [hc.name, ac.name] };

  /* ---------- Rendu des infos ---------- */
  let bc = null; // habillage télé (créé avec la vue)
  const setScore = (sc, pop) => {
    bc?.bug(sc.slice(), bc.clock);
    const el = $('sb-score');
    el.textContent = `${sc[0]} - ${sc[1]}`;
    if (pop) { el.classList.remove('pop'); void el.offsetWidth; el.classList.add('pop'); }
  };
  const setClock = (min, extra) => { $('sb-clock').textContent = clockLabel(min, extra); bc?.bug(bc.score, clockLabel(min, extra)); };
  const setMomentum = () => {
    const v = 50 + m.momentum / 2;
    $('mo-0').style.width = v + '%'; $('mo-1').style.width = (100 - v) + '%';
  };
  const addLine = (ev, text) => {
    // Bandeau de commentaire sur le terrain (comme FM), le fil ne garde que les temps forts en vue 2D.
    if (!(ev.type === 'kickoff' && ev.minute === 0)) {
      const cap = $('caption');
      cap.innerHTML = `<b>${clockLabel(ev.minute, ev.extra)}</b> ${esc(text)}`;
      cap.className = `pitch-caption ${ev.type === 'goal' ? 'goal' : ev.key ? 'key' : ''}`;
      clearTimeout(ctrl.capT);
      ctrl.capT = setTimeout(() => cap.classList.add('hidden'), 3500);
    }
    if ((s.settings.matchStyle || '3d') !== 'anim' && !ev.key && ev.type !== 'kickoff') return;
    const feed = $('feed');
    const d = document.createElement('div');
    d.className = `ln ${ev.key ? 'key' : ''} ${ev.type === 'goal' ? 'goal' : ''}`;
    if (ev.type === 'goal') d.style.setProperty('--gc', ev.side === 0 ? hc.color : ac.color);
    d.innerHTML = `<span class="mn">${ev.type === 'kickoff' && ev.minute === 0 ? '' : clockLabel(ev.minute, ev.extra)}</span><span>${iconFor(ev)}</span><span class="grow">${esc(text)}</span>`;
    feed.prepend(d);
    while (feed.children.length > 80) feed.lastChild.remove();
  };

  /* ---------- Moteur -> vue ---------- */
  const onEventStart = (ev) => {
    if (ev.replay) return; // ralenti : pas de commentaire ni de score
    ctrl.recent.push(ev);
    if (ctrl.recent.length > 8) ctrl.recent.shift();
    sound(ev);
    if (ev.type !== 'kickoff' || ev.minute > 0) setClock(ev.minute, ev.extra);
    if (ev.type === 'goal') {
      setScore(ev.score, true);
      const nm = nameOf(ev.pid);
      ctrl.scorers[ev.side].push(`${nm} ${clockLabel(ev.minute, ev.extra)}${ev.kind === 'penalty' ? ' (p)' : ''}`);
      $('sc-' + ev.side).textContent = '⚽ ' + ctrl.scorers[ev.side].join(', ');
    }
    if (ev.type === 'var' && ev.outcome === 'cancelled' && ev.reason !== 'penalty') setScore(ev.score);
    if (!ctrl.quick || ['goal', 'red', 'sub', 'added'].includes(ev.type)) bc?.event(ev);
    const text = describe(ev, ctx, Math.random, { verbose: !ctrl.quick });
    if (text) addLine(ev, text);
    setMomentum();
    if (ev.type === 'goal' && s.settings.replays && !view.live) queueReplay();
    if (ev.type === 'ht') {
      view.pause();
      if (replay) { applyJournal(view.liveSteps || 0); app.toast('Mi-temps', 1500); setTimeout(() => { if (!ctrl.finished) view.play(); }, 1800); }
      else bc.fullCard('ht').then(halfTime);
    }
    if (ev.type === 'ft') { view.pause(); bc.fullCard('ft', 2200).then(fullTime); }
  };

  /** Fiche rapide d'un joueur touché sur le terrain. */
  function showTapCard(id) {
    const card = $('tapcard');
    if (!id) { card.classList.add('hidden'); return; }
    let mp = null, t = null;
    for (const tm of m.teams) for (const x of tm.onPitch) if (x && x.id === id) { mp = x; t = tm; }
    if (!mp) { card.classList.add('hidden'); return; }
    const pos = t.slots[mp.slot].pos;
    card.innerHTML = `<div class="row" style="gap:10px">${mp.p.photo ? face(mp.p, t.club) : ''}<span class="tc-num" style="background:${view.colors[t.side]};color:${view.textColors[t.side]}">${mp.number}</span>
      <div class="grow"><b>${esc(mp.p.first || '')} ${esc(mp.p.last || mp.name)}</b><br><small>${pos} · ${esc(t.club.short)}${(t.roles[mp.slot] && t.roles[mp.slot] !== 'std') ? ' · ' + esc(t.roles[mp.slot]) : ''}</small></div>${ratingChip(mp.rating)}</div>
      <div class="row" style="gap:6px;margin-top:6px;font-size:12px"><span style="width:52px">Énergie</span><span class="mini" style="flex:1;width:auto"><i style="width:${mp.energy}%;background:${scaleColor(mp.energy)}"></i></span><b>${Math.round(mp.energy)}</b></div>
      <small>${mp.goals ? `⚽ ${mp.goals} ` : ''}${mp.assists ? `🅰 ${mp.assists} ` : ''}${mp.yellow ? '🟨 ' : ''}Passes ${mp.passesOk}/${mp.passes} · Tirs ${mp.shots} · Tacles ${mp.tackles}</small>`;
    card.classList.remove('hidden');
    clearTimeout(ctrl.tapT);
    ctrl.tapT = setTimeout(() => { card.classList.add('hidden'); view.selected = null; }, 5000);
  }

  /** Indices sonores : sifflets, clameur, "oh !", rumeur selon la zone. */
  function sound(ev) {
    if (!audio.on) return;
    if (ev.type === 'kickoff') audio.whistle(1);
    else if (ev.type === 'foul' || ev.type === 'offside') audio.whistle(1);
    else if (ev.type === 'ht' || ev.type === 'ft' || ev.type === 'et' || ev.type === 'eht') audio.whistle(ev.type === 'ft' ? 3 : 2, true);
    else if (ev.type === 'goal') audio.roar();
    else if (ev.type === 'shot' && ev.outcome !== 'goal' && (ev.xg >= 0.1 || ev.outcome === 'post')) audio.ooh();
    const homeAttack = ev.poss === 0 ? ev.zone ?? 1 : 0;
    audio.intensity(Math.min(1, 0.15 + homeAttack * 0.22 + Math.max(0, m.momentum) / 250));
  }

  /** Ralenti : rejoue les 3 dernières actions avant le but, au ralenti. */
  function queueReplay() {
    const shotIdx = ctrl.recent.length - 2; // l'événement juste avant 'goal' est le tir
    if (shotIdx < 0) return;
    const from = Math.max(0, shotIdx - 3);
    const seq = ctrl.recent.slice(from + 1, shotIdx + 1).map((e) => ({ ...e, replay: true, key: false }));
    const start = ctrl.recent[from];
    view.queue.unshift({ type: 'replaystart', replay: true, snap: true, x: start.x, y: start.y, poss: start.poss, carrier: start.carrier, period: start.period }, ...seq,
      { type: 'replayend', replay: true });
  }

  const onIdle = () => {
    if (m.phase === 'ft' || ctrl.finished) return;
    if (m.phase === 'ht' && !ctrl.htDone) return;
    let guard = 0;
    do {
      const evs = stepMinute(m);
      if (!ctrl.quick) { view.push(evs); break; }
      // Résumé rapide : seulement les temps forts + 2 actions de construction.
      const keep = [];
      evs.forEach((e, i) => {
        const key = QUICK_KEEP.has(e.type) || (e.type === 'shot' && e.outcome !== 'blocked' && e.xg >= 0.08) || (e.type === 'sub' && e.side === userSide);
        if (!key) return;
        for (let k = Math.max(0, i - 2); k < i; k++) if (!keep.includes(evs[k])) keep.push(evs[k]);
        keep.push(e);
      });
      setClock(m.minute, m.extra);
      view.push(keep);
    } while (view.queue.length === 0 && m.phase === 'live' && guard++ < 30);
  };

  const view = new MatchView($('pitch'), m, { userSide, onEventStart, onIdle, live: replay ? true : s.settings.liveEngine !== false,
    beforeStep: replay ? (n) => applyJournal(n) : null, labelMode: s.settings.labels || ((s.settings.matchStyle || '3d') !== 'anim' ? 'num' : 'name'), style: s.settings.matchStyle || '3d', onPlayerTap: showTapCard,
    on3DFail: () => { app.toast('3D indisponible sur cet appareil : vue 2D.', 3500); s.settings.matchStyle = 'fm'; root.querySelector('[data-c=style]').textContent = '2D'; } });
  bc = new Broadcast($('bcast'), { m, cfg, hc, ac, colors: view.colors, nameOf,
    coachOf: (side) => { const c = side === 0 ? hc : ac; if (c.id === s.userClubId && s.coach) return coachName(s.coach); const mg = managerOf(s, c); return mg ? (mg.fullName || mg.name) : ''; },
    coachImg: (side) => { const c = side === 0 ? hc : ac; if (c.id === s.userClubId && s.coach) return avatarSvg(s.coach.look, 40); const mg = managerOf(s, c); return mg?.photo ? face({ first: mg.first, last: mg.last, photo: mg.photo }, c, 'md') : ''; } });
  /** Présentation des équipes (caméra qui survole le stade), puis coup d'envoi. */
  const kickoffShow = () => {
    if (view.r3d) { view.r3d.camMode = 'intro'; view.r3d._introT = 0; }
    return bc.intro(matchDay(m, cfg, currentDate(s))).then(() => { if (view.r3d) view.r3d.camMode = 'tv'; });
  };
  window.__bc = bc; window.__view = view; window.__journal = journal; window.__cfgSnap = () => replayCfg(cfg); // débogage
  view.setSpeed(SPEEDS[ctrl.speedIdx]);
  root.querySelector('[data-c="speed"]').textContent = `x${SPEEDS[ctrl.speedIdx]}`;

  /* ---------- Contrôles ---------- */
  root.querySelector('.controls').addEventListener('click', (e) => {
    const b = e.target.closest('[data-c]');
    if (!b || ctrl.finished) return;
    const c = b.dataset.c;
    if (c === 'pause') { if (replay) { app.toast('Match en différé : pas de changement possible.'); return; } if (m.phase === 'live') { view.pause(); pauseSheet(); } }
    if (c === 'speed') {
      ctrl.speedIdx = (ctrl.speedIdx + 1) % SPEEDS.length;
      view.setSpeed(SPEEDS[ctrl.speedIdx] * (ctrl.quick ? (view.live ? 3 : 1.5) : 1));
      b.textContent = `x${SPEEDS[ctrl.speedIdx]}`;
      s.settings.speed = SPEEDS[ctrl.speedIdx]; app.save();
    }
    if (c === 'quick') {
      ctrl.quick = !ctrl.quick;
      b.classList.toggle('on', ctrl.quick);
      view.setSpeed(SPEEDS[ctrl.speedIdx] * (ctrl.quick ? (view.live ? 3 : 1.5) : 1));
      app.toast(ctrl.quick ? 'Résumé rapide : seulement les temps forts' : 'Match en intégralité');
    }
    if (c === 'skip') { if (replay) { view.setSpeed(12); app.toast('Avance rapide'); } else { rec('skip', {}); skipToEnd(); } }
    if (c === 'style') {
      const st = { '3d': 'fm', fm: 'anim', anim: '3d' }[view.style] || '3d';
      view.setStyle(st);
      s.settings.matchStyle = st; app.save();
      b.textContent = { fm: '2D', '3d': '3D', anim: '🎥' }[st];
      app.toast({ fm: 'Vue 2D (façon FM)', '3d': 'Match en 3D', anim: 'Vue animée' }[st]);
    }
    if (c === 'cam') {
      if (view.style !== '3d' || !view.r3d) { app.toast('Caméras disponibles en vue 3D.'); return; }
      app.toast(view.r3d.cycleCamera());
    }
    if (c === 'labels') {
      const order = ['name', 'num', 'none'];
      view.labelMode = order[(order.indexOf(view.labelMode) + 1) % 3];
      s.settings.labels = view.labelMode; app.save();
      b.textContent = { name: 'Aa', num: '#', none: '∅' }[view.labelMode];
      app.toast({ name: 'Tous les noms', num: view.style === 'fm' ? 'Nom du porteur du ballon' : 'Numéros', none: 'Sans étiquettes' }[view.labelMode]);
    }
    if (c === 'audio') {
      s.settings.audio = !s.settings.audio; app.save();
      if (s.settings.audio) audio.start(); else audio.mute();
      b.textContent = s.settings.audio ? '🔊' : '🔇';
    }
  });

  /** Simule instantanément la fin du match (l'adjoint gère les changements). */
  function skipToEnd() {
    view.pause();
    view.queue = []; view.cur = null;
    m.teams[userSide].isAI = true;
    ctrl.htDone = true;
    let guard = 0;
    while (m.phase !== 'ft' && guard++ < 200) {
      for (const ev of stepMinute(m)) {
        if (ev.type === 'goal') ctrl.scorers[ev.side].push(`${nameOf(ev.pid)} ${clockLabel(ev.minute, ev.extra)}${ev.kind === 'penalty' ? ' (p)' : ''}`);
        if (ev.key && ['goal', 'red', 'ht', 'ft', 'penalty'].includes(ev.type)) { const t = describe(ev, ctx, Math.random); if (t) addLine(ev, t); }
      }
    }
    setScore(m.score);
    setClock(m.minute, m.extra);
    for (const sd of [0, 1]) $('sc-' + sd).textContent = ctrl.scorers[sd].length ? '⚽ ' + ctrl.scorers[sd].join(', ') : '';
    fullTime();
  }

  /** Rapport de l'analyste vidéo : plus il est bon, plus le rapport est détaillé. */
  function scoutReport() {
    const lvl = staffEffects(userClub(s)).analyst;
    const opp = O.onPitch.filter(Boolean);
    const key = opp.slice().sort((a, b) => ratingAt(b.p, O.slots[b.slot].pos) - ratingAt(a.p, O.slots[a.slot].pos))[0];
    const lines = { DEF: [], MID: [], ATT: [] };
    for (const mp of opp) { const g = POSITION_GROUP[O.slots[mp.slot].pos]; const k = g === 'D' || g === 'G' ? 'DEF' : g === 'M' ? 'MID' : 'ATT'; lines[k].push(ratingAt(mp.p, O.slots[mp.slot].pos)); }
    const avg = (a) => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
    const weak = Object.entries(lines).sort((a, b) => avg(a[1]) - avg(b[1]))[0][0];
    const om = managerOf(s, O.club);
    const items = [`Système : <b>${O.tactics.formation}</b>, mentalité ${MENTALITY_LABELS[O.tactics.mentality].toLowerCase()}${om ? ` · coach ${esc(om.first + ' ' + om.last)}` : ''}`];
    if (lvl >= 6 && key) items.push(`Joueur clé : <b>${esc(key.name)}</b> (${O.slots[key.slot].pos})`);
    if (lvl >= 10) items.push(`Point faible : <b>${{ DEF: 'la défense', MID: 'le milieu', ATT: "l'attaque" }[weak]}</b>`);
    if (lvl >= 14) items.push(`Style : passes ${{ short: 'courtes', mixed: 'mixtes', direct: 'directes' }[O.tactics.passing] || 'mixtes'}, ligne ${{ low: 'basse', mid: 'normale', high: 'haute' }[O.tactics.line] || 'normale'}`);
    return `<div class="card" style="margin:6px 0 12px;font-size:13px"><b>🎥 Rapport de l'analyste</b> <small class="muted">(note ${lvl || '—'}/20)</small><br>${items.join('<br>')}</div>`;
  }

  /* ---------- Pré-match ---------- */
  const T = m.teams[userSide], O = m.teams[1 - userSide];
  if (replay) { app.toast('Match en différé', 2000); setTimeout(() => { if (s.settings.audio) audio.start(); view.play(); }, 300); }
  else if (resuming) resumeMatch();
  else app.sheet({
    root,
    dismissable: false,
    html: `<h2>${esc(label)}</h2>
      <div class="row between" style="margin:14px 0">
        <div class="center grow">${crest(hc, 'lg')}<br><b>${esc(hc.name)}</b><br><small>${m.teams[0].tactics.formation}</small></div>
        <b style="font-size:20px">VS</b>
        <div class="center grow">${crest(ac, 'lg')}<br><b>${esc(ac.name)}</b><br><small>${m.teams[1].tactics.formation}</small></div>
      </div>
      ${(() => { const d = matchDay(m, cfg, currentDate(s)); return `<div class="pm-facts"><span>${d.weather.icon} ${d.weather.label} · ${d.temp} °C</span><span>🏟️ ${d.attendance.toLocaleString('fr-FR')} spectateurs attendus</span><span>🧑‍⚖️ ${esc(d.referee)}</span></div>`; })()}
      <div class="pm-xi">${[0, 1].map((sd) => `<ol>${m.teams[sd].onPitch.filter(Boolean).map((mp) => `<li><em>${mp.number ?? ''}</em><span>${esc(mp.name)}</span><small>${m.teams[sd].slots[mp.slot].pos}</small></li>`).join('')}</ol>`).join('')}</div>
      ${scoutReport()}
      <div class="btns"><button class="btn" data-act="back">Retour</button>${!opts.cfg ? '<button class="btn" data-act="press" id="pressbtn">🎤 Conférence de presse</button>' : ''}<button class="btn primary lg" data-act="go">Coup d'envoi</button></div>`,
    actions: {
      go: (el, a, h) => { h.close(); lockMatch(); kickoffShow().then(() => { if (s.settings.audio) audio.start(); view.play(); }); },
      press: (el) => {
        if (ctrl.pressDone) return;
        const conf = openDecisions(s, 'interview')[0];
        if (conf && s.life?.interview?.kind === 'pre') {
          // Gros match : conférence à 2 questions (effets appliqués à la configuration du match).
          const ih = openInterview(app, conf);
          ih.onDone = null;
          const mm = s.life.matchMods;
          const apply = () => {
            if (!mm) return;
            m.teams[userSide].talk = Math.max(-15, Math.min(15, mm.me));
            m.teams[1 - userSide].talk = Math.max(-15, Math.min(15, mm.opp));
          };
          const closeOrig = ih.close;
          ih.close = () => { apply(); closeOrig(); };
          ctrl.pressDone = true; el.disabled = true; el.textContent = '🎙 Conférence faite';
          return;
        }
        const qa = pressQuestion(s, O.club.id);
        const ps = app.sheet({
          root,
          html: `<h2>🎤 Conférence de presse</h2><p style="font-size:16px">« ${esc(qa.q)} »</p>
            <div class="btns" style="flex-direction:column">${qa.a.map((x, i) => `<button class="btn block" data-act="ans" data-v="${i}">${esc(x.text)}</button>`).join('')}</div>`,
          actions: {
            ans: (b) => {
              const r = pressAnswer(s, qa.a[+b.dataset.v]);
              m.teams[userSide].talk = Math.max(-15, Math.min(15, m.teams[userSide].talk + r.me));
              m.teams[1 - userSide].talk = Math.max(-15, Math.min(15, m.teams[1 - userSide].talk + r.opp));
              ctrl.pressDone = true;
              el.disabled = true; el.textContent = '🎤 Conférence faite';
              app.save(); ps.close(); app.toast(r.text, 3500);
            },
          },
        });
      },
      back: (el, a, h) => { h.close(); closeScreen(); },
    },
  });

  /** Différé : applique les décisions du coach enregistrées pour cet instant du match. */
  function applyJournal(n) {
    const list = replay?.journal || [];
    while (jIdx < list.length && list[jIdx].n <= n) {
      const { op, a } = list[jIdx++];
      if (op === 'sub') { const r = makeSub(m, a.side, a.out, a.in); if (r.ok) { view.live?.handle(r.events, []); for (const ev of r.events) view.liveEvent?.(ev); } }
      else if (op === 'form') { changeFormation(m, a.side, a.f); syncPitch(); }
      else if (op === 'swap') { swapSlots(m, a.side, a.x, a.y); syncPitch(); }
      else if (op === 'move') moveSlot(m, a.side, a.slot, a.x, a.y);
      else if (op === 'role') setRole(m, a.side, a.slot, a.role);
      else if (op === 'pi') { const T = m.teams[a.side]; T.pi[a.slot] = { ...(T.pi[a.slot] || {}), [a.k]: a.v }; }
      else if (op === 'ti') setTactic(m, a.side, a.k, a.v);
      else if (op === 'plan') { applyPlan(m, a.side, a.plan); syncPitch(); }
      else if (op === 'talk') teamTalk(m, a.side, a.kind);
      else if (op === 'skip') { skipToEnd(); return; }
    }
  }

  /** Reprise après rechargement : on restaure l'état sauvegardé et on continue. */
  function resumeMatch() {
    const snap = readSnap(s);
    if (snap) {
      restoreMatch(m, snap.m);
      if (view.live && snap.live) view.live.restore(snap.live);
      view.period = m.period;
    }
    setScore(m.score); setClock(m.minute, m.extra); setMomentum();
    for (const g of m.goals) ctrl.scorers[g.side].push(`${g.name} ${clockLabel(g.minute, g.extra)}${g.pen ? ' (p)' : ''}`);
    for (const sd of [0, 1]) $('sc-' + sd).textContent = ctrl.scorers[sd].length ? '⚽ ' + ctrl.scorers[sd].join(', ') : '';
    app.toast(snap ? `Match repris à la ${clockLabel(m.minute, m.extra)}` : 'Match en cours : reprise au coup d\'envoi', 3000);
    if (m.phase === 'ft') { fullTime(); return; }
    if (m.phase === 'ht') { halfTime(); return; }
    if (s.settings.audio) audio.start();
    view.play();
  }

  /* ---------- Pause : composition, changements, tactique ---------- */
  /** Consignes rapides : plusieurs réglages d'un coup, pour réagir vite au score. */
  const QUICK_PLANS = [
    { id: 'allin', icon: '🔥', label: 'Tout pour l\'attaque', tac: { mentality: 'offensive', pressing: 'high', tempo: 'high', line: 'high', passing: 'direct', crossing: 'high', longShots: 'high', overlap: 'join', timeWasting: 'off' } },
    { id: 'press', icon: '⚡', label: 'Pressing tout terrain', tac: { pressing: 'high', line: 'high', tackling: 'hard', marking: 'man' } },
    { id: 'keep', icon: '🔄', label: 'Confisquer le ballon', tac: { passing: 'short', tempo: 'low', mentality: 'balanced', dribbling: 'less', longShots: 'low' } },
    { id: 'counter', icon: '🏃', label: 'Bloc bas et contres', tac: { mentality: 'defensive', pressing: 'low', line: 'low', counter: 'on', passing: 'direct', overlap: 'stay' } },
    { id: 'close', icon: '🔒', label: 'Fermer le match', tac: { mentality: 'defensive', pressing: 'mid', line: 'low', tempo: 'low', timeWasting: 'on', overlap: 'stay', tackling: 'soft' } },
  ];
  const syncPitch = () => { if (view.live) view.live.sync(); else view.syncPlayers(false); };

  function pauseSheet(resumeAfter = true, isHT = false) {
    let sel = null;            // joueur choisi sur le terrain
    let tab = 'compo';
    const t = () => m.teams[userSide];
    const energyBar = (e) => `<span class="mini" style="width:40px"><i style="width:${Math.round(e)}%;background:${scaleColor(e)}"></i></span>`;
    const pitchHtml = () => {
      const T = t();
      const club = userClub(s);
      return `<div class="tpitch mpitch ${sel ? 'moving' : ''}" data-act="moveto" id="mpitch">${T.slots.map((sl, i) => {
        const mp = T.onPitch[i];
        const gone = !mp || !mp.onPitch || mp.red || mp.injured;
        const fitC = mp && !gone ? scaleColor(Math.min(100, ratingAt(mp.p, sl.pos) * 1.2)) : '#555';
        return `<div class="slot ${gone ? 'empty' : ''} ${mp && sel === mp.id ? 'sel' : ''}" data-act="pick" data-id="${gone ? '' : mp.id}" style="--x:${sl.x.toFixed(3)};--y:${sl.y.toFixed(3)}">
          <div class="tok">${gone ? `<span class="shirt">${mp?.red ? '🟥' : '✚'}</span>` : `${face(mp.p, club)}<em class="num">${mp.number || ''}</em><span class="fit" style="background:${fitC}"></span>`}</div>
          <div class="nm">${gone ? '—' : esc(mp.name.split(' ').slice(-1)[0])}${mp?.yellow ? ' 🟨' : ''}${mp?.goals ? ' ⚽' : ''}</div>
          <div class="ps">${sl.pos}${gone ? '' : ` · ${mp.rating.toFixed(1)}`}</div>
          ${gone ? '' : `<div class="en"><i style="width:${Math.round(mp.energy)}%;background:${scaleColor(mp.energy)}"></i></div>`}
        </div>`;
      }).join('')}</div>`;
    };
    const benchHtml = () => {
      const T = t();
      const bench = T.bench.filter((x) => !x.onPitch && x.minOut == null);
      const subsLeft = MAX_SUBS - T.subsUsed;
      const selMp = sel ? T.onPitch.find((x) => x && x.id === sel) : null;
      const pos = selMp ? T.slots[selMp.slot].pos : null;
      return `<div class="label" style="margin-top:0">Banc · ${subsLeft} changement(s) restant(s)</div>
        <div class="list">${bench.map((x) => `<div class="prow ${selMp && subsLeft > 0 ? '' : 'dim'}" data-act="in" data-id="${x.id}">
          ${posBadge(x.pos)}<div class="pname"><b>${esc(x.name)}</b><small>${pos ? `Au poste ${pos} : ${Math.round(ratingAt(x.p, pos))}` : `Note ${Math.round(ratingAt(x.p, x.pos))}`}</small></div>
          ${energyBar(x.energy)}</div>`).join('') || '<p class="muted">Banc vide.</p>'}</div>`;
    };
    const selPanel = () => {
      const T = t();
      const mp = sel ? T.onPitch.find((x) => x && x.id === sel) : null;
      if (!mp) return `<p class="muted mhelp">Touchez un joueur sur le terrain : puis un remplaçant pour le faire entrer, ou un autre joueur pour échanger leurs postes.</p>`;
      const pi = T.pi[mp.slot] = { duty: 'sup', shoot: 'normal', dribble: 'normal', runs: 'normal', ...(T.pi[mp.slot] || {}) };
      return `<div class="card msel"><div class="row between"><b>${esc(mp.name)}</b><small>${T.slots[mp.slot].pos} · énergie ${Math.round(mp.energy)} % · note ${mp.rating.toFixed(1)}</small></div>
        <p class="muted mhelp">Touchez un remplaçant pour le faire entrer, un autre joueur pour échanger leurs postes, ou <b>un endroit libre du terrain pour le déplacer</b> (son poste s'adapte à la zone).</p>
        <div class="mrow"><span>Rôle</span><div class="seg sm wrap">${rolesFor(T.slots[mp.slot].pos).map((r) => `<button data-act="role" data-v="${r}" class="${(T.roles[mp.slot] || 'std') === r ? 'on' : ''}" title="${esc(ROLES[r].desc)}">${ROLES[r].label}</button>`).join('')}</div></div>
        ${PLAYER_INSTRUCTIONS.map((pd) => `<div class="mrow"><span>${pd.label}</span><div class="seg sm">${Object.entries(pd.opts).map(([v, l]) => `<button data-act="pi" data-k="${pd.key}" data-v="${v}" class="${pi[pd.key] === v ? 'on' : ''}">${l}</button>`).join('')}</div></div>`).join('')}</div>`;
    };
    const tacHtml = () => {
      const T = t(), tc = T.tactics;
      const row = (label, key, opts, help) => `<div class="mrow"><span title="${esc(help || '')}">${label}${help ? ' <i class="hint">?</i>' : ''}</span><div class="seg sm">${Object.entries(opts).map(([v, l]) => `<button data-act="ti" data-k="${key}" data-v="${v}" class="${(tc[key] || DEFAULT_TACTICS[key]) === v ? 'on' : ''}">${l}</button>`).join('')}</div></div>`;
      return `<div class="label" style="margin-top:0">Consignes rapides</div>
        <div class="qplans">${QUICK_PLANS.map((q) => `<button class="btn sm" data-act="qplan" data-v="${q.id}">${q.icon} ${q.label}</button>`).join('')}
          ${(userClub(s).presets || []).map((pl, i) => pl ? `<button class="btn sm" data-act="plan" data-v="${i}">📋 Plan ${'ABC'[i]}</button>` : '').join('')}</div>
        <div class="mtac">
          <div><div class="label">Approche</div>
            ${row('Mentalité', 'mentality', Object.fromEntries(MENTALITIES.map((k) => [k, MENTALITY_LABELS[k]])), 'Offensive : plus de joueurs devant, mais plus d\'espaces dans votre dos.')}
            ${row('Pressing', 'pressing', Object.fromEntries(LEVELS.map((k) => [k, PRESSING_LABELS[k]])), 'Haut : on récupère plus haut mais on se fatigue beaucoup plus vite.')}
            ${row('Tempo', 'tempo', Object.fromEntries(LEVELS.map((k) => [k, TEMPO_LABELS[k]])), 'Rapide : on joue vite, plus de pertes de balle, plus de fatigue.')}
            ${row('Largeur', 'width', Object.fromEntries(LEVELS.map((k) => [k, WIDTH_LABELS[k]])), 'Large : on étire la défense adverse sur les côtés.')}
            ${TEAM_INSTRUCTIONS.filter((ti) => ['line', 'offsideTrap', 'marking', 'tackling', 'timeWasting'].includes(ti.key)).map((ti) => row(ti.label, ti.key, ti.opts, ti.help)).join('')}
          </div>
          <div><div class="label">Avec le ballon</div>
            ${TEAM_INSTRUCTIONS.filter((ti) => ['passing', 'focus', 'overlap', 'dribbling', 'crossing', 'longShots', 'counter', 'gkDist'].includes(ti.key)).map((ti) => row(ti.label, ti.key, ti.opts, ti.help)).join('')}
          </div>
        </div>`;
    };
    const html = () => {
      const T = t();
      return `<div class="row between"><h2>${isHT ? 'Vestiaire' : 'Banc de touche'} · ${clockLabel(m.minute, m.extra)}</h2><b class="num" style="font-size:20px">${m.score[0]} - ${m.score[1]}</b></div>
        <div style="margin:8px 0">${seg('ptab', ['compo', 'tac', 'stats'], tab, { compo: `Compo & changements (${MAX_SUBS - T.subsUsed})`, tac: 'Tactique', stats: 'Stats' })}</div>
        ${tab === 'compo' ? `
          <div class="form-groups">${FORMATION_GROUPS.map(([g, fs]) => `<div class="fg"><small>${g}</small><div class="chips wrap">${fs.map((f) => `<button class="chip sm ${T.tactics.formation === f && !T.tactics.custom ? 'on' : ''}" data-act="form" data-v="${f}">${f}</button>`).join('')}</div></div>`).join('')}${T.tactics.custom ? '<span class="tag ok">Système personnalisé</span>' : ''}</div>
          <div class="mlay"><div>${pitchHtml()}</div><div>${selPanel()}${benchHtml()}</div></div>`
        : tab === 'tac' ? tacHtml()
        : `${edgeHtml()}${statsHtml()}${adviceHtml()}`}
        <button class="btn primary lg block" style="margin-top:14px" data-act="close">${isHT ? 'Retour au vestiaire' : '▶ Reprendre le match'}</button>`;
    };
    const h = app.sheet({
      root, html: html(), full: true,
      onClose: () => { if (resumeAfter && !ctrl.finished) view.play(); },
      actions: {
        ptab: (el) => { tab = el.dataset.v; h.update(html()); },
        pick: (el) => {
          const id = +el.dataset.id;
          if (!id) return;
          if (sel && sel !== id) {
            // Deux joueurs du terrain : ils échangent leurs postes.
            if (swapSlots(m, userSide, sel, id)) { rec('swap', { side: userSide, x: sel, y: id }); syncPitch(); app.toast('Postes échangés'); }
            sel = null;
          } else sel = sel === id ? null : id;
          h.update(html());
        },
        in: (el) => {
          if (!sel) { app.toast('Touchez d\'abord le joueur à sortir sur le terrain.'); return; }
          const r = makeSub(m, userSide, sel, +el.dataset.id);
          if (!r.ok) { app.toast(r.error); return; }
          rec('sub', { side: userSide, out: sel, in: +el.dataset.id });
          view.queue.unshift(...r.events);
          sel = null; h.update(html());
        },
        pi: (el) => {
          const T = t(), mp = T.onPitch.find((x) => x && x.id === sel);
          if (!mp) return;
          T.pi[mp.slot] = { ...(T.pi[mp.slot] || {}), [el.dataset.k]: el.dataset.v };
          rec('pi', { side: userSide, slot: mp.slot, k: el.dataset.k, v: el.dataset.v });
          h.update(html());
        },
        moveto: (el, ap, hh, e) => {
          if (!sel || e.target.closest('.slot')) return;
          const T = t(), mp = T.onPitch.find((x) => x && x.id === sel);
          if (!mp) return;
          const q = pitchPoint(root.ownerDocument.getElementById('mpitch'), T, e);
          if (!q) return;
          if (!moveSlot(m, userSide, mp.slot, q.x, q.y)) { app.toast('Le gardien reste dans son but.'); return; }
          rec('move', { side: userSide, slot: mp.slot, x: T.slots[mp.slot].x, y: T.slots[mp.slot].y });
          syncPitch(); app.toast(`${mp.name.split(' ').slice(-1)[0]} : nouveau poste ${T.slots[mp.slot].pos}`); h.update(html());
        },
        role: (el) => {
          const T = t(), mp = T.onPitch.find((x) => x && x.id === sel);
          if (!mp) return;
          setRole(m, userSide, mp.slot, el.dataset.v); rec('role', { side: userSide, slot: mp.slot, role: el.dataset.v });
          h.update(html());
        },
        form: (el) => { changeFormation(m, userSide, el.dataset.v); rec('form', { side: userSide, f: el.dataset.v }); syncPitch(); sel = null; h.update(html()); },
        ti: (el) => { setTactic(m, userSide, el.dataset.k, el.dataset.v); rec('ti', { side: userSide, k: el.dataset.k, v: el.dataset.v }); h.update(html()); },
        qplan: (el) => {
          const q = QUICK_PLANS.find((x) => x.id === el.dataset.v);
          for (const [k, v] of Object.entries(q.tac)) { setTactic(m, userSide, k, v); rec('ti', { side: userSide, k, v }); }
          app.toast(`${q.icon} ${q.label}`); h.update(html());
        },
        plan: (el) => {
          const pl = (userClub(s).presets || [])[+el.dataset.v];
          if (!pl) return;
          applyPlan(m, userSide, pl); rec('plan', { side: userSide, plan: JSON.parse(JSON.stringify(pl)) }); syncPitch();
          app.toast(`Plan ${'ABC'[+el.dataset.v]} appliqué`); h.update(html());
        },
      },
    });
    return h;
  }

  /* ---------- Mi-temps ---------- */
  function chartsHtml() {
    const cols = [hc.color, view.colors[1]];
    return `<div class="label">xG minute par minute</div>${xgChart(m, cols, [hc.short, ac.short])}
      <div class="label">Cartes de chaleur (attaque →)</div>
      <div class="row" style="gap:8px;align-items:flex-start"><div class="grow"><small>${esc(hc.short)}</small>${heatmap(m, 0, cols[0])}</div>
      <div class="grow"><small>${esc(ac.short)}</small>${heatmap(m, 1, cols[1])}</div></div>`;
  }

  /** Duel tactique : ce qui marche / ne marche pas dans notre plan face au leur. */
  function edgeHtml() {
    const T = m.teams[userSide], O = m.teams[1 - userSide];
    const e = T.edge || 0;
    const pct = Math.round(50 + e * 140);
    const verdict = e > 0.08 ? 'Votre plan domine le leur' : e > 0.02 ? 'Léger avantage tactique' : e < -0.08 ? 'Leur plan prend le dessus' : e < -0.02 ? 'Léger désavantage tactique' : 'Duel tactique équilibré';
    const mine = (T.edgeNotes || []).slice(0, 4).map((n) => `<li class="${n.v > 0 ? 'good' : 'bad'}">${n.v > 0 ? '▲' : '▼'} ${esc(n.text)}</li>`).join('');
    const theirs = (O.edgeNotes || []).filter((n) => n.v > 0.02).slice(0, 2).map((n) => `<li class="bad">▼ ${esc(n.text)} <small>(eux)</small></li>`).join('');
    return `<div class="card edgecard"><div class="row between"><b>♟ Duel tactique</b><small>${verdict}</small></div>
      <div class="edgebar"><i style="width:${Math.max(4, Math.min(96, pct))}%"></i></div>
      <ul class="edgelist">${mine}${theirs || ''}${!mine && !theirs ? '<li>Aucun point marquant.</li>' : ''}</ul></div>`;
  }

  /** Conseils de l'adjoint (plus précis avec un adjoint de bon niveau). */
  function adviceHtml() {
    const lvl = Math.max(1, Math.round(staffEffects(userClub(s)).assistant / 4));
    const sum = summarize(m);
    const me = sum.stats[userSide], th = sum.stats[1 - userSide];
    const tips = [];
    const T = m.teams[userSide];
    if (sum.possession[1 - userSide] > 58) tips.push('Ils confisquent le ballon : un pressing plus haut pourrait les gêner.');
    if (th.xg > me.xg + 0.6) tips.push('Ils se créent trop d\'occasions : resserrez les lignes (mentalité défensive).');
    if (me.xg < 0.4 && me.shots < 5) tips.push('Nous manquons de présence offensive : tentez une mentalité offensive ou un tempo rapide.');
    const tired = T.onPitch.filter((mp) => mp && mp.onPitch && mp.energy < 66).map((mp) => mp.name);
    if (tired.length) tips.push(`Fatigue : ${tired.slice(0, 3).join(', ')}. Pensez aux changements.`);
    const booked = T.onPitch.filter((mp) => mp && mp.onPitch && mp.yellow).map((mp) => mp.name);
    if (booked.length && lvl >= 2) tips.push(`Attention, ${booked.join(', ')} ${booked.length > 1 ? 'sont avertis' : 'est averti'}.`);
    if (!tips.length) tips.push('Le plan fonctionne, ne changeons rien.');
    return `<div class="card" style="margin-top:8px"><b>📋 L'adjoint :</b><br><small>${tips.slice(0, Math.max(1, lvl)).map(esc).join('<br>')}</small></div>`;
  }

  function statsHtml() {
    const sum = summarize(m);
    const st = sum.stats, cols = [hc.color, view.colors[1]];
    return `${cmpBar('Possession', sum.possession[0], sum.possession[1], cols, (v) => v + '%')}
      ${cmpBar('Tirs', st[0].shots, st[1].shots, cols)}
      ${cmpBar('Cadrés', st[0].onTarget, st[1].onTarget, cols)}
      ${cmpBar('xG', st[0].xg, st[1].xg, cols, (v) => v.toFixed(2))}
      ${cmpBar('Passes réussies', st[0].passesOk, st[1].passesOk, cols)}
      ${cmpBar('Corners', st[0].corners, st[1].corners, cols)}
      ${cmpBar('Fautes', st[0].fouls, st[1].fouls, cols)}
      ${cmpBar('Cartons', st[0].yellows + st[0].reds, st[1].yellows + st[1].reds, cols)}`;
  }

  function halfTime() {
    if (ctrl.finished) return;
    let talked = null;
    const html = () => `<div class="row between"><h2>Mi-temps</h2><b class="big" style="font-size:22px">${m.score[0]} - ${m.score[1]}</b></div>
      ${edgeHtml()}${statsHtml()}
      ${adviceHtml()}
      <div class="label">Causerie</div>
      ${talked ? `<div class="card" style="margin-top:0">${esc(talked.text)} <small>(moral ${talked.delta >= 0 ? '+' : ''}${talked.delta})</small></div>` : `
        <div class="btns" style="flex-direction:column">
          <button class="btn block" data-act="talk" data-v="calm">😌 Rester calme et confiant</button>
          <button class="btn block" data-act="talk" data-v="encourage">👏 Encourager le groupe</button>
          <button class="btn block" data-act="talk" data-v="demand">😤 Hausser le ton</button>
        </div>`}
      <div class="btns" style="margin-top:12px"><button class="btn" data-act="subs">Changements</button>
        <button class="btn primary" data-act="resume" ${talked ? '' : 'disabled'}>▶ 2e mi-temps</button></div>`;
    const h = app.sheet({
      root, dismissable: false, html,
      actions: {
        talk: (el) => { talked = teamTalk(m, userSide, el.dataset.v); rec('talk', { side: userSide, kind: el.dataset.v }); h.update(html()); },
        subs: () => pauseSheet(false, true),
        resume: () => { ctrl.htDone = true; h.close(); view.play(); },
      },
    });
    ctrl.htDone = false;
  }

  /* ---------- Fin du match ---------- */
  function fullTime() {
    if (ctrl.finished) return;
    ctrl.finished = true;
    view.pause();
    saveSnap();
    if (m.cup && m.score[0] === m.score[1] && !m.shootout) penaltyShootout(m);
    const sum = summarize(m);
    const my = sum.ratings[userSide];
    const res = sum.winnerSide === userSide ? 'Victoire !' : sum.winnerSide === -1 ? 'Match nul' : 'Défaite';
    const motm = sum.motm;
    app.sheet({
      root, dismissable: false,
      html: `<div class="center"><small>${esc(label)}</small><h2 style="font-size:24px;margin:4px 0">${res}</h2>
        <div class="row" style="justify-content:center;gap:14px;margin:10px 0">${crest(hc)}<b class="big">${m.score[0]} - ${m.score[1]}</b>${crest(ac)}</div>
        ${sum.shootout ? `<p style="margin:0">Tirs au but : <b>${sum.shootout.score[0]} - ${sum.shootout.score[1]}</b></p>` : ''}
        <p class="muted" style="font-size:12px;margin:4px 0 12px">${sum.goals.map((g) => `${esc(g.name)} ${clockLabel(g.minute, g.extra)}${g.pen ? ' (p)' : ''}`).join(' · ') || 'Aucun but'}</p></div>
        ${motm ? `<div class="motm"><span style="font-size:26px">🏅</span><div class="grow">Homme du match<br><span style="font-size:17px">${esc(motm.name)}</span></div>${ratingChip(motm.rating)}</div>` : ''}
        <div class="card">${statsHtml()}</div>
        <div class="card">${chartsHtml()}</div>
        <div class="label">Notes de vos joueurs</div>
        <div class="card list" style="padding:0 10px;margin-top:0">${my.map((r) => `<div class="prow" style="cursor:default">
          <span class="posb pos-${POSITION_GROUP[r.pos]}">${r.pos}</span>
          <div class="pname"><b>${esc(r.name)}</b><small>${r.minutes}' ${r.goals ? '⚽'.repeat(r.goals) : ''}${r.assists ? ' 🅰'.repeat(r.assists) : ''}${r.yellow ? ' 🟨' : ''}${r.red ? ' 🟥' : ''}${r.injured ? ' ✚' : ''}</small></div>
          ${ratingChip(r.rating)}</div>`).join('')}</div>
        <button class="btn primary lg block" data-act="done">Continuer</button>`,
      actions: {
        done: (el, a, h) => {
          h.close();
          if (replay) { closeScreen(); return; }
          if (opts.onFinish) { closeScreen(); opts.onFinish(sum, m); return; }
          s.liveLock = null; clearSnap();
          if (s.online) {
            // En ligne : le match joué est envoyé avec « Prêt » ; l'hôte l'intègre à la journée.
            s.playedMatch = { key: fixtureKey(s, today(s).userFixture), snap: snapshotMatch(m), score: m.score.slice(), cfg: replayCfg(cfg), journal };
            app.save(true); closeScreen(); app.render();
            app.toast('Match enregistré : cliquez « Prêt » pour la journée suivante.', 3500);
            return;
          }
          const report = completeDay(s, m);
          app.save(true);
          closeScreen();
          app.render();
          showDayReport(app, report);
          const iv = openDecisions(s, 'interview')[0];
          if (iv && s.life?.interview?.kind === 'post') openInterview(app, iv);
        },
      },
    });
  }

  function closeScreen() {
    clearInterval(ctrl.snapT);
    window.removeEventListener('pagehide', saveSnap);
    document.removeEventListener('visibilitychange', onHide);
    audio.stop();
    view.destroy();
    root.remove();
    document.body.style.overflow = '';
  }
}

export { activePlayers };

/**
 * Point du terrain (x profondeur, y largeur) sous le doigt, quelle que soit l'orientation :
 * on déduit la transformation à partir de la position affichée de trois postes connus.
 */
function pitchPoint(pitch, T, e) {
  if (!pitch) return null;
  const els = [...pitch.querySelectorAll('.slot')];
  const pts = els.map((el, i) => { const r = el.querySelector('.tok').getBoundingClientRect(); return { x: T.slots[i].x, y: T.slots[i].y, X: r.left + r.width / 2, Y: r.top + r.height / 2 }; });
  if (pts.length < 3) return null;
  // Moindres carrés : X = a·x + b·y + c ; Y = d·x + e·y + f.
  const fit = (key) => {
    let sxx = 0, sxy = 0, syy = 0, sx = 0, sy = 0, n = pts.length, sxk = 0, syk = 0, sk = 0;
    for (const p of pts) { sxx += p.x * p.x; sxy += p.x * p.y; syy += p.y * p.y; sx += p.x; sy += p.y; sxk += p.x * p[key]; syk += p.y * p[key]; sk += p[key]; }
    const M = [[sxx, sxy, sx], [sxy, syy, sy], [sx, sy, n]], v = [sxk, syk, sk];
    const det = (A) => A[0][0] * (A[1][1] * A[2][2] - A[1][2] * A[2][1]) - A[0][1] * (A[1][0] * A[2][2] - A[1][2] * A[2][0]) + A[0][2] * (A[1][0] * A[2][1] - A[1][1] * A[2][0]);
    const D = det(M);
    if (Math.abs(D) < 1e-9) return null;
    return [0, 1, 2].map((c) => det(M.map((row, r) => row.map((x, k) => (k === c ? v[r] : x)))) / D);
  };
  const fx = fit('X'), fy = fit('Y');
  if (!fx || !fy) return null;
  const [a, b, c] = fx, [d, f, g] = fy;
  const det = a * f - b * d;
  if (Math.abs(det) < 1e-9) return null;
  const X = e.clientX - c, Y = e.clientY - g;
  return { x: (f * X - b * Y) / det, y: (a * Y - d * X) / det };
}
