/**
 * ÉCRAN DE MATCH EN DIRECT
 * Relie le moteur (stepMinute) au rendu canvas (MatchView) :
 * tableau d'affichage, momentum, commentaires, vitesse, résumé rapide,
 * pause (changements, tactique), mi-temps (stats + causerie), fin de match.
 */
import { userMatchCfg, completeDay, today } from '../../game/season.js';
import { createMatch, stepMinute, makeSub, changeFormation, setTactic, applyPlan, teamTalk, summarize, penaltyShootout, clockLabel, activePlayers } from '../../engine/match.js';
import { describe, iconFor } from '../../engine/commentary.js';
import { FORMATION_NAMES, MENTALITIES, MENTALITY_LABELS, LEVELS, PRESSING_LABELS, TEMPO_LABELS, MAX_SUBS, POSITION_GROUP, TEAM_INSTRUCTIONS, DEFAULT_TACTICS } from '../../data/constants.js';
import { ratingAt } from '../../engine/ratings.js';
import { MatchView } from '../matchView.js';
import { esc, crest, cmpBar, ratingChip, posBadge, seg, scaleColor, face } from '../components.js';
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
    <div class="pitch-area"><canvas id="pitch"></canvas><div class="tapcard hidden" id="tapcard"></div><div class="pitch-caption hidden" id="caption"></div></div>
    <div class="feed" id="feed"></div>
    <div class="controls">
      <button class="btn" data-c="pause">⏸ Pause</button>
      <button class="btn" data-c="speed">x${SPEEDS[0]}</button>
      <button class="btn" data-c="quick">⚡ Résumé</button>
      <button class="btn" data-c="skip">⏭ Fin</button>
      <button class="btn" data-c="style" style="flex:.6" title="Vue">${(s.settings.matchStyle || 'fm') === 'fm' ? '2D' : '🎥'}</button>
      <button class="btn" data-c="labels" style="flex:.6" title="Étiquettes">${{ name: 'Aa', num: '#', none: '∅' }[s.settings.labels || 'name']}</button>
      <button class="btn" data-c="audio" style="flex:.6">${s.settings.audio ? '🔊' : '🔇'}</button>
    </div>`;
  app.$overlay.appendChild(root);
  document.body.style.overflow = 'hidden';

  const $ = (id) => root.querySelector('#' + id);
  const ctrl = { speedIdx: Math.max(0, SPEEDS.indexOf(s.settings.speed || 1)), quick: false, finished: false, scorers: [[], []], recent: [] };
  const audio = new MatchAudio();
  const nameOf = (id) => {
    for (const t of m.teams) for (const mp of [...t.onPitch, ...t.bench, ...t.out]) if (mp && mp.id === id) return mp.name;
    return '';
  };
  const ctx = { name: nameOf, teams: [hc.name, ac.name] };

  /* ---------- Rendu des infos ---------- */
  const setScore = (sc, pop) => {
    const el = $('sb-score');
    el.textContent = `${sc[0]} - ${sc[1]}`;
    if (pop) { el.classList.remove('pop'); void el.offsetWidth; el.classList.add('pop'); }
  };
  const setClock = (min, extra) => { $('sb-clock').textContent = clockLabel(min, extra); };
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
    if ((s.settings.matchStyle || 'fm') === 'fm' && !ev.key && ev.type !== 'kickoff') return;
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
    const text = describe(ev, ctx, Math.random, { verbose: !ctrl.quick });
    if (text) addLine(ev, text);
    setMomentum();
    if (ev.type === 'goal' && s.settings.replays) queueReplay();
    if (ev.type === 'ht') { view.pause(); setTimeout(halfTime, 400); }
    if (ev.type === 'ft') { view.pause(); setTimeout(fullTime, 500); }
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

  const view = new MatchView($('pitch'), m, { userSide, onEventStart, onIdle, labelMode: s.settings.labels || ((s.settings.matchStyle || 'fm') === 'fm' ? 'num' : 'name'), style: s.settings.matchStyle || 'fm', onPlayerTap: showTapCard });
  window.__view = view; // débogage
  view.setSpeed(SPEEDS[ctrl.speedIdx]);
  root.querySelector('[data-c="speed"]').textContent = `x${SPEEDS[ctrl.speedIdx]}`;

  /* ---------- Contrôles ---------- */
  root.querySelector('.controls').addEventListener('click', (e) => {
    const b = e.target.closest('[data-c]');
    if (!b || ctrl.finished) return;
    const c = b.dataset.c;
    if (c === 'pause') { if (m.phase === 'live') { view.pause(); pauseSheet(); } }
    if (c === 'speed') {
      ctrl.speedIdx = (ctrl.speedIdx + 1) % SPEEDS.length;
      view.setSpeed(SPEEDS[ctrl.speedIdx] * (ctrl.quick ? 1.5 : 1));
      b.textContent = `x${SPEEDS[ctrl.speedIdx]}`;
      s.settings.speed = SPEEDS[ctrl.speedIdx]; app.save();
    }
    if (c === 'quick') {
      ctrl.quick = !ctrl.quick;
      b.classList.toggle('on', ctrl.quick);
      view.setSpeed(SPEEDS[ctrl.speedIdx] * (ctrl.quick ? 1.5 : 1));
      app.toast(ctrl.quick ? 'Résumé rapide : seulement les temps forts' : 'Match en intégralité');
    }
    if (c === 'skip') skipToEnd();
    if (c === 'style') {
      const st = view.style === 'fm' ? 'anim' : 'fm';
      view.setStyle(st);
      s.settings.matchStyle = st; app.save();
      b.textContent = st === 'fm' ? '2D' : '🎥';
      app.toast(st === 'fm' ? 'Vue 2D (façon FM)' : 'Vue animée');
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
  app.sheet({
    root,
    dismissable: false,
    html: `<h2>${esc(label)}</h2>
      <div class="row between" style="margin:14px 0">
        <div class="center grow">${crest(hc, 'lg')}<br><b>${esc(hc.name)}</b><br><small>${m.teams[0].tactics.formation}</small></div>
        <b style="font-size:20px">VS</b>
        <div class="center grow">${crest(ac, 'lg')}<br><b>${esc(ac.name)}</b><br><small>${m.teams[1].tactics.formation}</small></div>
      </div>
      <p class="muted center" style="margin:0 0 12px">Votre onze : ${T.onPitch.filter(Boolean).map((mp) => esc(mp.name.split(' ').slice(-1)[0])).join(', ')}</p>
      ${scoutReport()}
      <div class="btns"><button class="btn" data-act="back">Retour</button>${!opts.cfg ? '<button class="btn" data-act="press" id="pressbtn">🎤 Conférence de presse</button>' : ''}<button class="btn primary lg" data-act="go">Coup d'envoi</button></div>`,
    actions: {
      go: (el, a, h) => { h.close(); if (s.settings.audio) audio.start(); view.play(); },
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

  /* ---------- Pause : changements + tactique ---------- */
  function pauseSheet(resumeAfter = true, isHT = false) {
    let sel = null;
    let tab = 'subs';
    const html = () => {
      const t = m.teams[userSide];
      const on = t.onPitch.filter((mp) => mp && mp.onPitch && !mp.red && !mp.injured);
      const bench = t.bench.filter((b) => !b.onPitch && b.minOut == null);
      const subsLeft = MAX_SUBS - t.subsUsed;
      return `<div class="row between"><h2>${isHT ? 'Vestiaire' : 'Pause'} · ${clockLabel(m.minute, m.extra)}</h2><b class="num">${m.score[0]} - ${m.score[1]}</b></div>
        <div style="margin:10px 0">${seg('ptab', ['subs', 'tac'], tab, { subs: `Changements (${subsLeft})`, tac: 'Tactique' })}</div>
        ${tab === 'subs' ? `
          <p class="muted" style="font-size:12px;margin:4px 0">${sel ? 'Choisissez le remplaçant.' : 'Touchez le joueur à sortir.'}</p>
          <div class="list">${on.map((mp) => `<div class="prow ${sel === mp.id ? 'sel' : ''}" data-act="out" data-id="${mp.id}">
            ${posBadge(t.slots[mp.slot].pos)}<div class="pname"><b>${esc(mp.name)}</b><small>${mp.yellow ? '🟨 ' : ''}${mp.goals ? '⚽'.repeat(mp.goals) : ''}</small></div>
            <span class="mini" style="width:44px"><i style="width:${mp.energy}%;background:${scaleColor(mp.energy)}"></i></span>${ratingChip(mp.rating)}</div>`).join('')}</div>
          <div class="label">Banc</div>
          <div class="list">${bench.map((b) => `<div class="prow ${sel && subsLeft > 0 ? '' : 'dim'}" data-act="in" data-id="${b.id}">
            ${posBadge(b.pos)}<div class="pname"><b>${esc(b.name)}</b><small>Note ${Math.round(ratingAt(b.p, b.pos))}</small></div></div>`).join('') || '<p class="muted">Banc vide.</p>'}</div>`
        : `<div class="label">Formation</div>
          <div class="chips">${FORMATION_NAMES.map((f) => `<button class="chip ${t.tactics.formation === f ? 'on' : ''}" data-act="form" data-v="${f}">${f}</button>`).join('')}</div>
          <div class="label">Mentalité</div>${seg('ment', MENTALITIES, t.tactics.mentality, MENTALITY_LABELS)}
          <div class="label">Pressing</div>${seg('press', LEVELS, t.tactics.pressing, PRESSING_LABELS)}
          <div class="label">Tempo</div>${seg('tempo', LEVELS, t.tactics.tempo, TEMPO_LABELS)}
          ${TEAM_INSTRUCTIONS.filter((ti) => ['line', 'passing', 'focus', 'counter', 'tackling', 'offsideTrap', 'timeWasting'].includes(ti.key)).map((ti) => `<div class="label">${ti.label}</div>
            <div class="seg">${Object.entries(ti.opts).map(([v, l]) => `<button data-act="ti" data-k="${ti.key}" data-v="${v}" class="${(t.tactics[ti.key] || DEFAULT_TACTICS[ti.key]) === v ? 'on' : ''}">${l}</button>`).join('')}</div>`).join('')}
          ${(userClub(s).presets || []).some(Boolean) ? `<div class="label">Plans enregistrés</div><div class="btns">${(userClub(s).presets || []).map((pl, i) => pl ? `<button class="btn sm" data-act="plan" data-v="${i}">Plan ${'ABC'[i]}</button>` : '').join('')}</div>` : ''}`}
        <button class="btn primary lg block" style="margin-top:14px" data-act="close">${isHT ? 'Retour au vestiaire' : '▶ Reprendre'}</button>`;
    };
    const h = app.sheet({
      root, html,
      onClose: () => { if (resumeAfter && !ctrl.finished) view.play(); },
      actions: {
        ptab: (el) => { tab = el.dataset.v; h.update(html()); },
        out: (el) => { sel = +el.dataset.id; h.update(html()); },
        in: (el) => {
          if (!sel) { app.toast('Choisissez d\'abord le joueur à sortir.'); return; }
          const r = makeSub(m, userSide, sel, +el.dataset.id);
          if (!r.ok) { app.toast(r.error); return; }
          view.queue.unshift(...r.events);
          sel = null; h.update(html());
        },
        form: (el) => { changeFormation(m, userSide, el.dataset.v); view.syncPlayers(false); h.update(html()); },
        ment: (el) => { setTactic(m, userSide, 'mentality', el.dataset.v); h.update(html()); },
        press: (el) => { setTactic(m, userSide, 'pressing', el.dataset.v); h.update(html()); },
        tempo: (el) => { setTactic(m, userSide, 'tempo', el.dataset.v); h.update(html()); },
        ti: (el) => { setTactic(m, userSide, el.dataset.k, el.dataset.v); h.update(html()); },
        plan: (el) => {
          const pl = (userClub(s).presets || [])[+el.dataset.v];
          if (!pl) return;
          applyPlan(m, userSide, pl); view.syncPlayers(false);
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
      ${statsHtml()}
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
        talk: (el) => { talked = teamTalk(m, userSide, el.dataset.v); h.update(html()); },
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
        ${motm ? `<div class="motm"><span style="font-size:26px">★</span><div class="grow">Homme du match<br><span style="font-size:17px">${esc(motm.name)}</span></div>${ratingChip(motm.rating)}</div>` : ''}
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
          if (opts.onFinish) { closeScreen(); opts.onFinish(sum, m); return; }
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
    audio.stop();
    view.destroy();
    root.remove();
    document.body.style.overflow = '';
  }
}

export { activePlayers };
