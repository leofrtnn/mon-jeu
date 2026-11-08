/**
 * ÉCRAN DE MATCH EN DIRECT
 * Relie le moteur (stepMinute) au rendu canvas (MatchView) :
 * tableau d'affichage, momentum, commentaires, vitesse, résumé rapide,
 * pause (changements, tactique), mi-temps (stats + causerie), fin de match.
 */
import { userMatchCfg, completeDay, today } from '../../game/season.js';
import { createMatch, stepMinute, makeSub, changeFormation, setTactic, teamTalk, summarize, penaltyShootout, clockLabel, activePlayers } from '../../engine/match.js';
import { describe, iconFor } from '../../engine/commentary.js';
import { FORMATION_NAMES, MENTALITIES, MENTALITY_LABELS, LEVELS, PRESSING_LABELS, TEMPO_LABELS, MAX_SUBS, POSITION_GROUP } from '../../data/constants.js';
import { ratingAt } from '../../engine/ratings.js';
import { MatchView } from '../matchView.js';
import { esc, crest, cmpBar, ratingChip, posBadge, seg, scaleColor } from '../components.js';
import { showDayReport } from './dayReport.js';

const SPEEDS = [1, 2, 4];
/** Événements montrés en mode "Résumé rapide". */
const QUICK_KEEP = new Set(['goal', 'red', 'yellow', 'penalty', 'var', 'ht', 'ft', 'injury', 'kickoff', 'freekick']);

export function openMatch(app) {
  const s = app.state;
  const cfg = userMatchCfg(s);
  if (!cfg) { app.toast('Pas de match aujourd\'hui.'); return; }
  const m = createMatch(cfg);
  const userSide = cfg.home.club.id === s.userClubId ? 0 : 1;
  const label = today(s).label;
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
    <div class="pitch-area"><canvas id="pitch"></canvas></div>
    <div class="feed" id="feed"></div>
    <div class="controls">
      <button class="btn" data-c="pause">⏸ Pause</button>
      <button class="btn" data-c="speed">x${SPEEDS[0]}</button>
      <button class="btn" data-c="quick">⚡ Résumé</button>
      <button class="btn" data-c="skip">⏭ Fin</button>
    </div>`;
  app.$overlay.appendChild(root);
  document.body.style.overflow = 'hidden';

  const $ = (id) => root.querySelector('#' + id);
  const ctrl = { speedIdx: Math.max(0, SPEEDS.indexOf(s.settings.speed || 1)), quick: false, finished: false, scorers: [[], []] };
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
    if (ev.type === 'ht') { view.pause(); setTimeout(halfTime, 400); }
    if (ev.type === 'ft') { view.pause(); setTimeout(fullTime, 500); }
  };

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

  const view = new MatchView($('pitch'), m, { userSide, onEventStart, onIdle });
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
      <p class="muted center" style="font-size:12px">Adversaire en ${O.tactics.formation}, mentalité ${MENTALITY_LABELS[O.tactics.mentality].toLowerCase()}.</p>
      <div class="btns"><button class="btn" data-act="back">Retour</button><button class="btn primary lg" data-act="go">Coup d'envoi</button></div>`,
    actions: {
      go: (el, a, h) => { h.close(); view.play(); },
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
          <div class="label">Tempo</div>${seg('tempo', LEVELS, t.tactics.tempo, TEMPO_LABELS)}`}
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
      },
    });
    return h;
  }

  /* ---------- Mi-temps ---------- */
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
        <div class="label">Notes de vos joueurs</div>
        <div class="card list" style="padding:0 10px;margin-top:0">${my.map((r) => `<div class="prow" style="cursor:default">
          <span class="posb pos-${POSITION_GROUP[r.pos]}">${r.pos}</span>
          <div class="pname"><b>${esc(r.name)}</b><small>${r.minutes}' ${r.goals ? '⚽'.repeat(r.goals) : ''}${r.assists ? ' 🅰'.repeat(r.assists) : ''}${r.yellow ? ' 🟨' : ''}${r.red ? ' 🟥' : ''}${r.injured ? ' ✚' : ''}</small></div>
          ${ratingChip(r.rating)}</div>`).join('')}</div>
        <button class="btn primary lg block" data-act="done">Continuer</button>`,
      actions: {
        done: (el, a, h) => {
          h.close();
          const report = completeDay(s, m);
          app.save(true);
          closeScreen();
          app.render();
          showDayReport(app, report);
        },
      },
    });
  }

  function closeScreen() {
    view.destroy();
    root.remove();
    document.body.style.overflow = '';
  }
}

export { activePlayers };
