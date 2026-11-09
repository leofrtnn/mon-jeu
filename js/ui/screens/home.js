/**
 * Accueil : prochain match, forme de l'équipe, messages importants (3 max).
 */
import { today, tablePosition, DIV_NAMES, nationSquad, eligibleNations, changeClub, leagueRoundOf } from '../../game/season.js';
import { DIVISIONS, COUNTRIES } from '../../data/world.js';
import { jobCandidates } from '../../game/career.js';
import { preseasonCard, preseasonActions } from './preseasonUI.js';
import { userClub, clubById, clubPlayers, topMessages } from '../../game/state.js';
import { isAvailable } from '../../engine/ratings.js';
import { esc, crest, formPills, gauge, scaleColor } from '../components.js';
import { openMatch } from './match.js';
import { showDayReport, showOffer } from './dayReport.js';
import { showEndSeason } from './endSeason.js';
import { simulateDays, busy } from '../sim.js';
import { msgRow, openMessage } from './inboxUI.js';
import { openDeadline } from './deadlineUI.js';
import { windowInfo, currentDate, longDate, fmtDate } from '../../game/dates.js';
import { onlineCard, onlineActions } from './online.js';

export function render(app) {
  const s = app.state;
  const uc = userClub(s);
  const t = today(s);

  if (s.sacked) {
    const offers = jobCandidates(s, true);
    const vac = s.clubs.filter((c) => c.vacantSince && c.id !== uc.id);
    return `<div class="card nextmatch"><h3>🚪 Limogé par ${esc(s.sacked.club)}</h3>
      <p>Le conseil d'administration a mis fin à votre contrat. Votre réputation : <b>${Math.round(s.coach.rep)}</b>.</p></div>
      <div class="label">Clubs intéressés</div><div class="card" style="margin-top:0">${[...vac, ...offers.filter((c) => !vac.includes(c))].slice(0, 6).map((c) => `<div class="prow" data-act="takejob" data-id="${c.id}">${crest(c)}
        <div class="pname"><b>${esc(c.name)}</b><small>${DIV_NAMES[c.div]} · réputation ${c.rep}${c.vacantSince ? ' · poste vacant' : ''}</small></div><span class="btn sm primary">Signer</span></div>`).join('') || '<p class="muted">Aucune offre pour le moment.</p>'}
      </div>`;
  }
  if (s.preseason?.active) return s.online ? onlineCard(app) + preseasonCard(app) : preseasonCard(app);

  /* ---------- Colonne 1 : le club ---------- */
  const row = s.tables[uc.div][uc.id];
  const pos = tablePosition(s, uc.id);
  const dv = DIVISIONS[uc.div];
  const flag = COUNTRIES[uc.country]?.flag || '';
  const diff = row.gf - row.ga;
  let col1 = `<div class="card club-hero">
    <div class="hero-crest">${crest(uc, 'xl')}</div>
    <h2>${esc(uc.name)}</h2>
    <small>${flag} ${esc(dv.name)}${uc.stadium ? ` · ${Number(uc.stadium).toLocaleString('fr-FR')} places` : ''}</small>
    <div class="hero-stats">
      <div><b>${pos}<sup>e</sup></b><small>Classement</small></div>
      <div><b>${row.pts} pts</b><small>Points</small></div>
      <div><b>${diff > 0 ? '+' : ''}${diff}</b><small>Diff. buts</small></div>
    </div>
    <div class="hero-form">${row.form.length ? formPills(row.form) : '<small>Aucun match joué</small>'}</div>
  </div>`;
  const squad = clubPlayers(s, uc);
  const fit = squad.filter(isAvailable);
  const top = fit.slice().sort((a, b) => b.form - a.form).slice(0, 16);
  const avg = (arr, f) => (arr.length ? arr.reduce((x, p) => x + f(p), 0) / arr.length : 0);
  const unavailable = squad.length - fit.length;
  col1 += `<div class="card"><h3 class="ttl">${ico('pulse')}État de l'équipe</h3>
    <div class="gauges2">${line('Condition', avg(top, (p) => 100 - (p.fatigue || 0)))}${line('Moral', avg(squad, (p) => p.morale))}${line('Forme', avg(top, (p) => p.form))}${line('Vestiaire', s.coach.dressing ?? 60)}${line('Confiance du CA', s.board.confidence)}${line('Supporters', s.board.fans ?? 60)}${line('Médias', s.coach.media ?? 50)}${line('Réputation', s.coach.rep)}</div>
    ${unavailable ? `<p style="margin:8px 0 0"><span class="tag bad">${unavailable} indisponible(s)</span> <small>blessés, suspendus ou prêtés</small></p>` : ''}
  </div>`;

  /* ---------- Colonne 2 : le prochain rendez-vous ---------- */
  let col2 = '';
  if (s.online) col2 += onlineCard(app);
  if (s.seasonOver) {
    col2 += `<div class="card nextmatch"><h3 class="ttl">${ico('trophy')}Saison ${s.season}-${s.season + 1} terminée</h3>
      <p>Classement final : <b>${pos}e</b> de ${esc(DIV_NAMES[uc.div])}</p>
      ${s.online ? '' : '<button class="btn primary lg block" data-act="endseason">Voir le bilan</button>'}</div>`;
  } else if (t && t.userFixture) {
    const f = t.userFixture;
    const h = clubById(s, f.h), a = clubById(s, f.a);
    const opp = h.id === uc.id ? a : h;
    const oppPos = opp.div === uc.div && t.entry.type === 'league' ? `${tablePosition(s, opp.id)}e` : DIV_NAMES[opp.div];
    col2 += `<div class="card nextmatch">
      <h3 class="ttl">${ico('ball')}Prochain match</h3>
      <div class="vs">
        <div class="team">${crest(h, 'lg')}<span>${esc(h.name)}</span></div>
        <div class="mid">VS<small>${esc(oppPos)}</small></div>
        <div class="team">${crest(a, 'lg')}<span>${esc(a.name)}</span></div>
      </div>
      <p class="nm-meta">${esc(t.label)}<br>${esc(longDate(currentDate(s)))} · ${f.neutral ? 'Terrain neutre' : `${esc(h.name)} (${h.id === uc.id ? 'domicile' : 'extérieur'})`}</p>
      ${s.online ? '<button class="btn block" data-act="tactics">Préparer le match →</button>' : `<div class="btns">
        <button class="btn" data-act="tactics">Préparer le match</button>
        <button class="btn primary" data-act="play">▶ Jouer</button>
      </div><button class="btn ghost sm block" data-act="simulate" style="margin-top:4px">Simuler le match</button>`}
    </div>`;
  } else if (t && t.entry.type === 'intl') {
    const elig = new Set(eligibleNations(s));
    const called = [];
    for (const n of new Set(squad.map((p) => p.nat))) {
      if (!elig.has(n)) continue;
      for (const p of nationSquad(s, n)) if (p.clubId === uc.id) called.push(`${p.name} <small>(${esc(n)})</small>`);
    }
    col2 += `<div class="card nextmatch"><h3 class="ttl">${ico('globe')}${esc(t.label)}</h3>
      <p>${called.length ? `Convoqués : ${called.join(', ')}` : '<span class="muted">Aucun de vos joueurs n\'est sélectionné.</span>'}</p>
      <p class="muted" style="font-size:12px">Les internationaux reviennent fatigués, parfois blessés… mais plus confiants.</p>
      ${s.online ? '' : '<div class="btns"><button class="btn primary" data-act="simulate">Journée suivante ▸</button><button class="btn" data-act="skipto">⏩ Mon prochain match</button></div>'}</div>`;
  } else if (t) {
    col2 += `<div class="card nextmatch"><h3 class="ttl">${ico('ball')}${esc(t.label)}</h3>
      <p class="muted">Votre équipe ne joue pas cette journée.</p>
      ${s.online ? '' : '<div class="btns"><button class="btn primary" data-act="simulate">Journée suivante ▸</button><button class="btn" data-act="skipto">⏩ Mon prochain match</button></div>'}</div>`;
  }
  // Deadline day : un direct de 2 minutes, depuis l'Accueil.
  if (windowInfo(s).deadline && s.life && s.life.deadlineDone !== `${s.season}-${s.day}`) {
    col2 += `<div class="card deadline-card"><div class="row between"><div><b>⏰ Deadline day</b><br><small>Dernières heures du mercato : offres surprises et bonnes affaires.</small></div>
      <button class="btn primary" data-act="deadline">En direct ▸</button></div></div>`;
  }
  if (s.lastResult) {
    const r = s.lastResult;
    const h = clubById(s, r.h), a = clubById(s, r.a);
    const side = r.h === uc.id ? 0 : 1;
    const d = r.s[side] - r.s[1 - side] || (r.pens ? r.pens[side] - r.pens[1 - side] : 0);
    const res = d > 0 ? 'V' : d < 0 ? 'D' : 'N';
    col2 += `<div class="card"><h3 class="ttl">${ico('clock')}Dernier match · ${esc(r.label)}</h3>
      <div class="row"><span class="pill ${res}">${res}</span>${crest(h, 'sm')}
      <div class="grow">${esc(h.short)} <b>${r.s[0]} - ${r.s[1]}</b> ${esc(a.short)} ${r.pens ? `<small>(tab ${r.pens[0]}-${r.pens[1]})</small>` : ''}<br>
      <small>${r.scorers.map((g) => `${esc(g.name)} ${g.minute}'${g.pen ? ' (p)' : ''}`).join(', ') || 'Aucun but'}</small></div>${crest(a, 'sm')}</div></div>`;
  }
  const o = s.objectives || {};
  const objs = [[o.league, 'trophy'], [o.cup, 'cup'], [o.conti, 'star'], [!o.cup || !o.conti ? o.youth : null, 'sprout']].filter((x) => x[0]).slice(0, 3);
  if (objs.length) {
    col2 += `<div class="card"><h3 class="ttl">${ico('target')}Objectifs de la saison</h3>
      <div class="objs">${objs.map(([x, i]) => `<div>${ico(i)}<small>${esc(x.label)}</small></div>`).join('')}</div></div>`;
  }

  /* ---------- Colonne 3 : actualités, calendrier, messages ---------- */
  const news = (s.news || []).slice(0, 3);
  let col3 = `<div class="card news-card"><h3 class="ttl">${ico('rss')}Actualités</h3>${news.length ? news.map((n, i) => (i === 0
    ? `<div class="news-top"><b>${esc(n.text)}</b><small>${esc(ago(s, n))}</small></div>`
    : `<div class="news-row"><span class="ic">${NEWS_IC[n.type] || '•'}</span><div class="grow">${esc(n.text)}<small>${esc(ago(s, n))}</small></div></div>`)).join('')
    : '<p class="muted" style="margin:0">Le mercato et les bancs de touche feront bientôt parler d\'eux.</p>'}
    <button class="btn ghost sm block" data-act="allnews">Toutes les actualités →</button></div>`;
  const next = upcoming(s, 3);
  col3 += `<div class="card"><div class="row between"><h3 class="ttl" style="margin:0">${ico('cal')}Calendrier</h3><button class="btn sm ghost" data-act="allfx">Voir tout →</button></div>
    ${next.map((x) => `<div class="fx-row"><span class="fx-d">${esc(x.date)}</span>${crest(x.opp, 'sm')}<span class="grow">${esc(x.home ? `${uc.short} - ${x.opp.short}` : `${x.opp.short} - ${uc.short}`)}</span><small>${esc(x.comp)}</small></div>`).join('') || '<p class="muted" style="margin:8px 0 0">Aucun match programmé.</p>'}</div>`;
  const msgs = topMessages(s);
  col3 += `<div class="card"><div class="row between"><h3 class="ttl" style="margin:0">${ico('mail')}Messages</h3>
    <button class="btn sm ghost" data-act="allmsgs">Voir tout →</button></div>
    ${msgs.length ? msgs.map(msgRow).join('') : '<p class="muted" style="margin:8px 0 0">Rien de neuf, coach.</p>'}
  </div>`;
  return `<div class="dash"><div class="col">${col1}</div><div class="col">${col2}</div><div class="col">${col3}</div></div>`;
}

const NEWS_IC = { manager: '🪑', transfer: '✍', loan: '⇆', crisis: '📉', owner: '🏦', clash: '⚡' };
const ICO = {
  pulse: '<path d="M3 12h4l2-5 4 10 2-5h6"/>',
  trophy: '<path d="M7 4h10v4a5 5 0 0 1-10 0z"/><path d="M7 6H4v1a3 3 0 0 0 3 3M17 6h3v1a3 3 0 0 1-3 3M12 13v4M8 21h8M9 17h6"/>',
  cup: '<path d="M6 3h12l-1.5 8a4.5 4.5 0 0 1-9 0z"/><path d="M12 15.5V19M8 21h8"/>',
  star: '<path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/>',
  sprout: '<path d="M12 21v-9M12 12c0-4 3-7 8-7 0 4-3 7-8 7zM12 14c0-3-2.5-5.5-7-5.5 0 3 2.5 5.5 7 5.5z"/>',
  target: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.5"/>',
  ball: '<circle cx="12" cy="12" r="8.5"/><path d="m12 7.5 3.5 2.5-1.3 4h-4.4L8.5 10z"/>',
  globe: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.5 2.5 3.5 5.3 3.5 8.5s-1 6-3.5 8.5c-2.5-2.5-3.5-5.3-3.5-8.5s1-6 3.5-8.5z"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7v5l3 2"/>',
  rss: '<path d="M5 19h.01M5 12a7 7 0 0 1 7 7M5 5a14 14 0 0 1 14 14"/>',
  cal: '<rect x="3.5" y="5" width="17" height="15.5" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
  mail: '<rect x="3" y="5.5" width="18" height="13" rx="2"/><path d="m3.5 7 8.5 6.5L20.5 7"/>',
};
const ico = (k) => `<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICO[k]}</svg>`;

/** « il y a 2 journées » pour une actualité. */
function ago(s, n) {
  if (n.season !== s.season) return `saison ${n.season}-${String(n.season + 1).slice(2)}`;
  const d = s.day - n.day;
  return d <= 0 ? 'aujourd\'hui' : d === 1 ? 'hier' : `il y a ${d} journées`;
}

/** Prochains matchs de championnat du club (date, adversaire, domicile/extérieur). */
function upcoming(s, n) {
  const out = [];
  const uc = userClub(s);
  const fx = s.fixtures[uc.div];
  for (let d = s.day; d < s.calendar.length && out.length < n; d++) {
    const e = s.calendar[d];
    if (e.type !== 'league') continue;
    const rr = leagueRoundOf(fx.length, e.round);
    if (rr == null) continue;
    const f = fx[rr].find((x) => x.h === uc.id || x.a === uc.id);
    if (!f || f.s) continue;
    const home = f.h === uc.id;
    out.push({ date: fmtDate(e.date, false), opp: clubById(s, home ? f.a : f.h), home, comp: DIVISIONS[uc.div].short });
  }
  return out;
}

/** Action du gros bouton « Continuer » de l'en-tête (comme dans les jeux de gestion). */
export function primaryAction(app) {
  const s = app.state;
  if (!s || s.sacked) return null;
  if (s.preseason?.active) {
    if (!s.preseason.meeting) return { label: 'Réunion du CA', run: () => preseasonActions.psmeeting(null, app) };
    return { label: s.online ? 'Prêt' : 'Lancer la saison', run: () => preseasonActions.psstart(null, app) };
  }
  if (s.online) {
    const o = app.online;
    const me = o?.players?.find((p) => p.user_id === o.uid);
    if (me?.ready && me.version === s.online.version) return null;
    return { label: 'Prêt', run: () => onlineActions.oready(null, app) };
  }
  if (s.seasonOver) return { label: 'Bilan', run: () => showEndSeason(app) };
  const t = today(s);
  if (t?.userFixture) return { label: 'Jouer', run: () => openMatch(app) };
  return { label: 'Continuer', run: () => runSim(app, 1, false) };
}

function line(label, v) {
  return `<div class="g-line"><div class="row between"><span>${label}</span><b style="color:${scaleColor(v)}">${Math.round(v)}</b></div>${gauge(v)}</div>`;
}

export const actions = {
  ...preseasonActions,
  oready: onlineActions.oready,
  ounready: onlineActions.ounready,
  play(el, app) { openMatch(app); },
  tactics(el, app) { app.go('tactics'); },
  async simulate(el, app) { await runSim(app, 1, false); },
  async skipto(el, app) { await runSim(app, 12, true); },
  endseason(el, app) { showEndSeason(app); },
  takejob(el, app) { const c = clubById(app.state, +el.dataset.id); changeClub(app.state, c.id); delete app.state.sacked; app.save(true); app.render(); app.toast(`Nouveau départ à ${c.name} !`); },
  deadline(el, app) { openDeadline(app); },
  allnews(el, app) { app.ui.schedTab = 'news'; app.go('schedule'); },
  allfx(el, app) { app.ui.schedTab = 'fixtures'; app.go('schedule'); },
  msg(el, app) {
    const m = app.state.messages.find((x) => String(x.id) === el.dataset.id);
    if (!m) return;
    openMessage(app, m, (mm) => legacyOpen(app, mm));
  },
  allmsgs(el, app) {
    const ms = app.state.messages.slice(0, 40);
    const h = app.sheet({
      html: `<h2>Boîte de réception</h2>${ms.map(msgRow).join('') || '<p class="muted">Aucun message.</p>'}
        <button class="btn block" data-act="readall" style="margin-top:12px">Tout marquer comme lu</button>`,
      actions: {
        readall: () => { app.state.messages.forEach((m) => (m.read = true)); app.save(); h.close(); app.render(); },
        msg: (e) => { const m = app.state.messages.find((x) => String(x.id) === e.dataset.id); if (!m) return; h.close(); openMessage(app, m, (mm) => legacyOpen(app, mm)); },
      },
    });
  },
};

function legacyOpen(app, m) {
  {
    if (m.action?.type === 'offer') showOffer(app, m.action.pid);
    else if (m.action?.type === 'player') import('./playerSheet.js').then((mod) => { app.render(); mod.showPlayer(app, m.action.pid); });
    else if (m.action?.type === 'job') jobSheet(app, m.action.clubId);
    else if (m.action?.type === 'scouting') { app.ui.clubTab = 'market'; app.ui.mktMode = 'scout'; app.go('club'); }
    else if (m.action?.type === 'vacancy') { app.ui.schedTab = 'managers'; app.ui.schedDiv = app.state.clubs.find((c) => c.id === m.action.clubId)?.div; app.go('schedule'); }
    else app.render();
  }
}

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
