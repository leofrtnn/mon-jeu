/**
 * Accueil : prochain match, forme de l'équipe, messages importants (3 max).
 */
import { today, completeDay, tablePosition, DIV_NAMES } from '../../game/season.js';
import { userClub, clubById, clubPlayers, topMessages } from '../../game/state.js';
import { isAvailable } from '../../engine/ratings.js';
import { esc, crest, formPills, gauge, scaleColor } from '../components.js';
import { openMatch } from './match.js';
import { showDayReport, showOffer } from './dayReport.js';
import { showEndSeason } from './endSeason.js';

export function render(app) {
  const s = app.state;
  const uc = userClub(s);
  const t = today(s);
  let html = '';

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
  } else if (t) {
    html += `<div class="card nextmatch"><h3>${esc(t.label)}</h3>
      <p class="muted">Votre équipe ne joue pas cette journée.</p>
      <button class="btn primary lg block" data-act="simulate">Journée suivante ▸</button></div>`;
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
  html += `<div class="card">
    <h3>Forme de l'équipe</h3>
    <div class="row between" style="margin-bottom:12px">
      <div>${row.form.length ? formPills(row.form) : '<small>Aucun match joué</small>'}</div>
      <div class="center"><div class="big" style="font-size:22px">${pos}<small style="font-size:12px">e</small></div><small>${row.pts} pts</small></div>
    </div>
    ${line('Condition', cond)}${line('Moral', morale)}${line('Forme', form)}${line('Confiance du board', s.board.confidence)}
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
  html += `<div class="card"><div class="row between"><h3 style="margin:0">Messages</h3>
    <button class="btn sm ghost" data-act="allmsgs">Tout voir</button></div>
    ${msgs.length ? msgs.map((m) => `<div class="msg p${m.prio}" data-act="msg" data-id="${m.id}">
      <span class="ic">${m.icon}</span><div class="grow"><b>${esc(m.title)}</b><br><small>${esc(m.text)}</small></div></div>`).join('')
    : '<p class="muted" style="margin:8px 0 0">Rien de neuf, coach.</p>'}
  </div>`;
  return html;
}

function line(label, v) {
  return `<div style="margin:8px 0"><div class="row between" style="font-size:13px;margin-bottom:4px"><span>${label}</span><b style="color:${scaleColor(v)}">${Math.round(v)}</b></div>${gauge(v)}</div>`;
}

export const actions = {
  play(el, app) { openMatch(app); },
  tactics(el, app) { app.go('tactics'); },
  simulate(el, app) {
    const report = completeDay(app.state, null);
    app.save();
    app.render();
    showDayReport(app, report);
  },
  endseason(el, app) { showEndSeason(app); },
  msg(el, app) {
    const m = app.state.messages.find((x) => String(x.id) === el.dataset.id);
    if (!m) return;
    m.read = true;
    app.save();
    if (m.action?.type === 'offer') showOffer(app, m.action.pid);
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
