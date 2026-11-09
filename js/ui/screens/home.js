/**
 * Accueil : prochain match, forme de l'équipe, messages importants (3 max).
 */
import { today, completeDay, tablePosition, DIV_NAMES, nationSquad, eligibleNations, changeClub } from '../../game/season.js';
import { userClub, clubById, clubPlayers, topMessages } from '../../game/state.js';
import { isAvailable } from '../../engine/ratings.js';
import { esc, crest, formPills, gauge, scaleColor } from '../components.js';
import { openMatch } from './match.js';
import { showDayReport, showOffer } from './dayReport.js';
import { showEndSeason } from './endSeason.js';
import { simulateDays, busy } from '../sim.js';

export function render(app) {
  const s = app.state;
  const uc = userClub(s);
  const t = today(s);
  let html = ''; let right = '';

  if (s.seasonOver) {
    html += `<div class="card nextmatch"><h3>Saison ${s.season}-${s.season + 1} terminée</h3>
      <p>Classement final : <b>${tablePosition(s, uc.id)}e</b> de ${DIV_NAMES[uc.div]}</p>
      <button class="btn primary lg block" data-act="endseason">Voir le bilan</button></div>`;
  } else if (t && t.userFixture) {
    const f = t.userFixture;
    const h = clubById(s, f.h), a = clubById(s, f.a);
    const opp = h.id === uc.id ? a : h;
    const oppPos = opp.div === uc.div && t.entry.type === 'league' ? `${tablePosition(s, opp.id)}e` : DIV_NAMES[opp.div];
    html += `<div class="card nextmatch">
      <h3>${esc(t.label)} · ${f.neutral ? 'Terrain neutre' : h.id === uc.id ? 'Domicile' : 'Extérieur'}</h3>
      <div class="vs">
        <div class="team">${crest(h, 'lg')}<span>${esc(h.name)}</span></div>
        <div class="mid">VS<br><small>${esc(oppPos)}</small></div>
        <div class="team">${crest(a, 'lg')}<span>${esc(a.name)}</span></div>
      </div>
      <button class="btn primary lg block" data-act="play">▶ Jouer le match</button>
      <div class="btns" style="margin-top:8px">
        <button class="btn sm" data-act="tactics">Tactique</button>
        <button class="btn sm" data-act="simulate">Simuler</button>
      </div>
    </div>`;
  } else if (t && t.entry.type === 'intl') {
    const elig = new Set(eligibleNations(s));
    const called = [];
    for (const n of new Set(clubPlayers(s, uc).map((p) => p.nat))) {
      if (!elig.has(n)) continue;
      for (const p of nationSquad(s, n)) if (p.clubId === uc.id) called.push(`${p.name} <small>(${esc(n)})</small>`);
    }
    html += `<div class="card nextmatch"><h3>🌍 ${esc(t.label)}</h3>
      <p>${called.length ? `Convoqués : ${called.join(', ')}` : '<span class="muted">Aucun de vos joueurs n\'est sélectionné.</span>'}</p>
      <p class="muted" style="font-size:12px">Les internationaux reviennent fatigués, parfois blessés… mais plus confiants.</p>
      <button class="btn primary lg block" data-act="simulate">Journée suivante ▸</button>
      <button class="btn block" style="margin-top:8px" data-act="skipto">⏩ Jusqu'à mon prochain match</button></div>`;
  } else if (t) {
    html += `<div class="card nextmatch"><h3>${esc(t.label)}</h3>
      <p class="muted">Votre équipe ne joue pas cette journée.</p>
      <button class="btn primary lg block" data-act="simulate">Journée suivante ▸</button>
      <button class="btn block" style="margin-top:8px" data-act="skipto">⏩ Jusqu'à mon prochain match</button></div>`;
  }

  // Forme de l'équipe.
  const squad = clubPlayers(s, uc);
  const fit = squad.filter(isAvailable);
  const top = fit.slice().sort((a, b) => b.form - a.form).slice(0, 16);
  const avg = (arr, f) => (arr.length ? arr.reduce((x, p) => x + f(p), 0) / arr.length : 0);
  const cond = avg(top, (p) => 100 - (p.fatigue || 0));
  const morale = avg(squad, (p) => p.morale);
  const form = avg(top, (p) => p.form);
  const row = s.tables[uc.div][uc.id];
  const pos = tablePosition(s, uc.id);
  const unavailable = squad.length - fit.length;
  right += `<div class="card">
    <h3>Forme de l'équipe</h3>
    <div class="row between" style="margin-bottom:12px">
      <div>${row.form.length ? formPills(row.form) : '<small>Aucun match joué</small>'}</div>
      <div class="center"><div class="big" style="font-size:22px">${pos}<small style="font-size:12px">e</small></div><small>${row.pts} pts</small></div>
    </div>
    ${line('Condition', cond)}${line('Moral', morale)}${line('Forme', form)}${line('Confiance du board', s.board.confidence)}${line('Réputation du coach', s.coach.rep)}
    ${unavailable ? `<p style="margin:10px 0 0"><span class="tag bad">${unavailable} indisponible(s)</span> <small>blessés, suspendus ou prêtés</small></p>` : ''}
  </div>`;

  if (s.lastResult) {
    const r = s.lastResult;
    const h = clubById(s, r.h), a = clubById(s, r.a);
    const side = r.h === uc.id ? 0 : 1;
    const diff = r.s[side] - r.s[1 - side] || (r.pens ? r.pens[side] - r.pens[1 - side] : 0);
    const res = diff > 0 ? 'V' : diff < 0 ? 'D' : 'N';
    html += `<div class="card"><h3>Dernier match · ${esc(r.label)}</h3>
      <div class="row"><span class="pill ${res}">${res}</span>
      <div class="grow">${esc(h.short)} <b>${r.s[0]} - ${r.s[1]}</b> ${esc(a.short)} ${r.pens ? `<small>(tab ${r.pens[0]}-${r.pens[1]})</small>` : ''}<br>
      <small>${r.scorers.map((g) => `${esc(g.name)} ${g.minute}'${g.pen ? ' (p)' : ''}`).join(', ') || 'Aucun but'}</small></div></div></div>`;
  }

  const msgs = topMessages(s);
  right += `<div class="card"><div class="row between"><h3 style="margin:0">Messages</h3>
    <button class="btn sm ghost" data-act="allmsgs">Tout voir</button></div>
    ${msgs.length ? msgs.map((m) => `<div class="msg p${m.prio}" data-act="msg" data-id="${m.id}">
      <span class="ic">${m.icon}</span><div class="grow"><b>${esc(m.title)}</b><br><small>${esc(m.text)}</small></div></div>`).join('')
    : '<p class="muted" style="margin:8px 0 0">Rien de neuf, coach.</p>'}
  </div>`;
  return `<div class="layout-2"><div class="col">${html}</div><div class="col">${right}</div></div>`;
}

function line(label, v) {
  return `<div style="margin:8px 0"><div class="row between" style="font-size:13px;margin-bottom:4px"><span>${label}</span><b style="color:${scaleColor(v)}">${Math.round(v)}</b></div>${gauge(v)}</div>`;
}

export const actions = {
  play(el, app) { openMatch(app); },
  tactics(el, app) { app.go('tactics'); },
  async simulate(el, app) { await runSim(app, 1, false); },
  async skipto(el, app) { await runSim(app, 12, true); },
  endseason(el, app) { showEndSeason(app); },
  msg(el, app) {
    const m = app.state.messages.find((x) => String(x.id) === el.dataset.id);
    if (!m) return;
    m.read = true;
    app.save();
    if (m.action?.type === 'offer') showOffer(app, m.action.pid);
    else if (m.action?.type === 'player') import('./playerSheet.js').then((mod) => { app.render(); mod.showPlayer(app, m.action.pid); });
    else if (m.action?.type === 'job') jobSheet(app, m.action.clubId);
    else if (m.action?.type === 'vacancy') { app.ui.schedTab = 'managers'; app.ui.schedDiv = app.state.clubs.find((c) => c.id === m.action.clubId)?.div; app.go('schedule'); }
    else app.render();
  },
  allmsgs(el, app) {
    const ms = app.state.messages.slice(0, 40);
    app.sheet({
      html: `<h2>Messages</h2>${ms.map((m) => `<div class="msg p${m.prio}" style="${m.read ? 'opacity:.6' : ''}"><span class="ic">${m.icon}</span>
        <div class="grow"><b>${esc(m.title)}</b><br><small>${esc(m.text)}</small></div></div>`).join('') || '<p class="muted">Aucun message.</p>'}
        <button class="btn block" data-act="readall" style="margin-top:12px">Tout marquer comme lu</button>`,
      actions: { readall: (e, a, h) => { app.state.messages.forEach((m) => (m.read = true)); app.save(); h.close(); app.render(); } },
    });
  },
};

/** Offre d'emploi reçue d'un autre club. */
function jobSheet(app, clubId) {
  const s = app.state;
  const c = clubById(s, clubId);
  const uc = userClub(s);
  const h = app.sheet({
    html: `<div class="row" style="gap:12px">${crest(c, 'lg')}<div><h2>${esc(c.name)}</h2><small>${DIV_NAMES[c.div]} · réputation ${c.rep} (vous : ${uc.rep})</small></div></div>
      <p>Le président de ${esc(c.name)} vous propose de prendre l'équipe <b>dès maintenant</b>. Vous quitteriez ${esc(uc.name)} en cours de saison.</p>
      <div class="btns"><button class="btn" data-act="no">Décliner</button><button class="btn primary" data-act="yes">Accepter le poste</button></div>`,
    actions: {
      yes: () => { changeClub(s, clubId); app.save(true); h.close(); app.go('home'); app.toast(`Bienvenue à ${c.name} !`); },
      no: () => { h.close(); app.render(); app.toast('Offre déclinée.'); },
    },
  });
}

/** Simulation (Web Worker) puis rapport de la dernière journée. */
async function runSim(app, n, untilMatch) {
  busy(true);
  try {
    const reports = await simulateDays(app, n, untilMatch);
    app.save();
    app.render();
    const last = reports[reports.length - 1];
    if (last) {
      if (reports.length > 1) last.label = `${reports.length} journées simulées · ${last.label}`;
      last.injuries = reports.flatMap((r) => r.injuries);
      showDayReport(app, last);
    }
  } finally { busy(false); }
}
