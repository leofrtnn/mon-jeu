/**
 * Écrans de la préparation estivale : carte d'accueil, réunion avec le CA, amicaux.
 */
import { userClub, clubById } from '../../game/state.js';
import { money } from '../../game/economy.js';
import { meetingOptions, concludeMeeting, addFriendly, friendlySeed, applyFriendly, endPreseason, CAMPS, INTENSITY, campMoney, chooseCamp, setIntensity } from '../../game/preseason.js';
import { COUNTRIES } from '../../data/world.js';
import { matchConditions } from '../../game/weather.js';
import { IDENTITIES } from '../../game/board.js';
import { teamCfg, DIVISIONS } from '../../game/season.js';
import { simulateMatch, summarize } from '../../engine/match.js';
import { esc, crest } from '../components.js';
import { openMatch } from './match.js';

/** Date d'un amical : un tous les 4-5 jours à partir de mi-juillet. */
function fDate(s, i) {
  const d = new Date(Date.UTC(s.season, 6, 12 + i * 5));
  return `${d.getUTCDate()}/${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** Tests physiques et rythme de match du groupe. */
function testsCard(s, uc) {
  const ps = s.preseason;
  const ps2 = uc.playerIds.map((id) => s.players[id]).filter(Boolean).sort((a, b) => (a.sharp ?? 60) - (b.sharp ?? 60));
  const avg = Math.round(ps2.reduce((a, p) => a + (p.sharp ?? 60), 0) / Math.max(1, ps2.length));
  const col = (v) => (v >= 75 ? 'var(--good)' : v >= 55 ? 'var(--ok)' : 'var(--bad)');
  const late = ps2.filter((p) => p.lateBack);
  return `<div class="card"><h3>🩺 Condition du groupe</h3>
    <div class="row between"><span>Rythme de match moyen</span><b style="color:${col(avg)}">${avg}/100</b></div>
    <div class="gauge" style="margin:6px 0 8px"><i style="width:${avg}%;background:${col(avg)}"></i></div>
    <small class="muted">Objectif : 75+ pour la reprise. Les amicaux (temps de jeu), le stage et l'intensité font monter le rythme ; un joueur rouillé rend jusqu'à 5 % de moins.</small>
    ${late.length ? `<p style="font-size:13px;margin:8px 0 0">✈️ Retour tardif (tournoi international) : ${late.map((p) => esc(p.name)).join(', ')}</p>` : ''}
    <details style="margin-top:6px"><summary><small>Détail par joueur</small></summary>${ps2.map((p) => `<div class="row" style="gap:8px;padding:3px 0"><span class="grow">${esc(p.name)} <small class="muted">${p.pos}</small></span><span class="gauge" style="width:90px"><i style="width:${p.sharp ?? 60}%;background:${col(p.sharp ?? 60)}"></i></span><small class="num" style="min-width:24px">${p.sharp ?? '—'}</small></div>`).join('')}</details>
  </div>`;
}

export function preseasonCard(app) {
  const s = app.state;
  const ps = s.preseason;
  const uc = userClub(s);
  const res = (f) => {
    if (!f.s) return '';
    const my = f.home ? f.s[0] : f.s[1], th = f.home ? f.s[1] : f.s[0];
    const r = my > th ? 'V' : my < th ? 'D' : 'N';
    return `<b class="num">${f.s[0]}-${f.s[1]}</b> <span class="pill ${r}">${r}</span>`;
  };
  return `<div class="card nextmatch"><h3>☀️ Préparation estivale · saison ${s.season}-${s.season + 1}</h3>
      <p style="margin:6px 0 12px">${ps.meeting ? `✔ Réunion avec le CA faite · objectif : <b>${esc(s.objectives.league.label)}</b>` : 'Le président vous attend pour fixer les objectifs de la saison.'}</p>
      ${ps.meeting ? '' : '<button class="btn primary lg block" data-act="psmeeting">Réunion avec le CA</button>'}
    </div>
    ${testsCard(s, uc)}
    <div class="card"><h3>🏕️ Stage de préparation</h3>
      ${ps.camp ? `<div class="row" style="gap:10px"><span style="font-size:30px">${CAMPS[ps.camp].icon}</span><div class="grow"><b>${esc(CAMPS[ps.camp].label)}</b><br><small class="muted">${esc(CAMPS[ps.camp].desc)}</small></div><small class="num ${campMoney(s, ps.camp) >= 0 ? 'pos-txt' : 'neg-txt'}">${campMoney(s, ps.camp) ? (campMoney(s, ps.camp) > 0 ? '+' : '−') + money(Math.abs(campMoney(s, ps.camp))) : 'gratuit'}</small></div>`
        : `<div class="camp-grid">${Object.entries(CAMPS).map(([k, c]) => { const cash = campMoney(s, k); return `<button class="camp-opt" data-act="pscamp" data-v="${k}" ${k === 'tour' && uc.rep < 62 ? 'disabled' : ''}><span class="ci">${c.icon}</span><b>${esc(c.label)}</b><small>${esc(c.desc)}</small><small class="num ${cash >= 0 ? 'pos-txt' : 'neg-txt'}">${cash ? (cash > 0 ? 'Recette +' : 'Coût ') + money(Math.abs(cash)) : 'Gratuit'} · rythme ${'▲'.repeat(Math.max(1, Math.round(c.fit / 3)))} · automatismes ${'▲'.repeat(Math.max(1, Math.round(c.coh / 3)))}</small></button>`; }).join('')}</div>`}
      <div class="label">Intensité du travail physique</div>
      <div class="chips">${Object.entries(INTENSITY).map(([k, it]) => `<button class="chip ${ps.intensity === k ? 'on' : ''}" data-act="psint" data-v="${k}">${esc(it.label)}</button>`).join('')}</div>
      <small class="muted">${esc(INTENSITY[ps.intensity || 'normal'].desc)}</small>
    </div>
    <div class="card"><h3>Matchs amicaux (${ps.friendlies.length}/6)</h3>
      ${ps.friendlies.map((f, i) => { const c = clubById(s, f.oppId); return `<div class="row" style="padding:6px 0;border-bottom:1px solid var(--line);gap:6px"><small class="muted num" style="min-width:52px">${fDate(s, i)}</small>${crest(c, 'sm')}
        <span class="grow">${f.tour ? `✈️ ${esc(f.place)} · ` : f.home ? '' : '@ '}${esc(c.name)} <small class="muted">${esc(COUNTRIES[c.country]?.flag || '')}</small></span>${f.s ? res(f) : `<button class="btn sm" data-act="pssim" data-id="${c.id}">Simuler</button><button class="btn sm primary" data-act="psplay" data-id="${c.id}">Jouer</button>`}</div>`; }).join('') || '<p class="muted" style="margin:0">Aucun amical programmé. Les amicaux donnent du rythme de match : sans eux, l\'équipe démarrera la saison rouillée.</p>'}
      ${ps.friendlies.length < 6 ? `<div class="label">Adversaires proposés</div><div class="chips" style="flex-wrap:wrap">${ps.suggestions.filter((id) => !ps.friendlies.some((f) => f.oppId === id)).map((id) => { const c = clubById(s, id); return `<button class="chip" data-act="psadd" data-id="${id}">${esc(COUNTRIES[c.country]?.flag || '')} ${esc(c.name)} <small>(${DIVISIONS[c.div].short})</small></button>`; }).join('')}</div>` : ''}
    </div>
    <button class="btn primary lg block" data-act="psstart" ${ps.meeting ? '' : 'disabled'}>Lancer la saison ▸</button>
    ${ps.meeting ? '' : '<p class="muted center" style="font-size:12px">La réunion avec le CA est obligatoire avant de commencer.</p>'}`;
}

function meetingSheet(app) {
  const s = app.state;
  const o = meetingOptions(s);
  const b = s.board;
  let choice = 'accept', ident = b.identity;
  const html = () => `<h2>🏛 Réunion avec le CA</h2>
    <p class="muted" style="margin-top:0">Le président présente ses attentes pour la saison. À vous de négocier.</p>
    <div class="card" style="margin-top:0">
      <div class="row between"><span>Objectif proposé</span><b>${esc(o.current.label)}</b></div>
      <div class="row between"><span>Budget transferts</span><b>${money(b.transferBudget)}</b></div>
      <div class="row between"><span>Masse salariale</span><b>${money(b.wageBudget)}/sem</b></div>
    </div>
    <div class="label">Votre réponse</div>
    <div class="btns" style="flex-direction:column">
      ${o.up ? `<button class="btn block ${choice === 'up' ? 'primary' : ''}" data-act="ch" data-v="up">🚀 Viser plus haut : « ${esc(o.up[1])} » (budget +25 %)</button>` : ''}
      <button class="btn block ${choice === 'accept' ? 'primary' : ''}" data-act="ch" data-v="accept">🤝 Accepter : « ${esc(o.current.label)} »</button>
      ${o.down ? `<button class="btn block ${choice === 'down' ? 'primary' : ''}" data-act="ch" data-v="down">🛟 Revoir à la baisse : « ${esc(o.down[1])} » (budget -25 %)</button>` : ''}
    </div>
    <div class="label">Identité de jeu souhaitée</div>
    <div class="chips" style="flex-wrap:wrap">${o.identities.map((k) => `<button class="chip ${k === ident ? 'on' : ''}" data-act="id" data-v="${k}">${IDENTITIES[k].label}</button>`).join('')}</div>
    <small class="muted">${esc(IDENTITIES[ident].desc)}${ident !== b.identity ? ' · Changer l\'identité voulue par le CA le froisse un peu.' : ''}</small>
    <button class="btn primary lg block" style="margin-top:14px" data-act="ok">Conclure la réunion</button>`;
  const h = app.sheet({
    html,
    actions: {
      ch: (el) => { choice = el.dataset.v; h.update(html()); },
      id: (el) => { ident = el.dataset.v; h.update(html()); },
      ok: () => { const msg = concludeMeeting(s, choice, ident); app.save(); h.close(); app.render(); app.toast(msg, 4000); },
    },
  });
}

function friendlyCfg(s, oppId) {
  const uc = userClub(s);
  const opp = clubById(s, oppId);
  const f = s.preseason.friendlies.find((x) => x.oppId === oppId);
  const [h, a] = f.home ? [uc, opp] : [opp, uc];
  const i = s.preseason.friendlies.indexOf(f);
  const weather = matchConditions({ seed: s.seed + s.season, country: h.country, date: `${s.season}-07-${String(12 + i * 5).padStart(2, '0')}`, comp: 'friendly', h: h.id, a: a.id });
  return { cfg: { seed: friendlySeed(s, oppId), varEnabled: s.settings.var, profile: {}, weather, neutral: !!f.neutral, ...(f.neutral ? { homeAdv: 1 } : {}),
    home: teamCfg(s, h, a, true, h.id === uc.id), away: teamCfg(s, a, h, false, a.id === uc.id) }, userSide: f.home ? 0 : 1 };
}

export const preseasonActions = {
  psmeeting(el, app) { meetingSheet(app); },
  pscamp(el, app) { const r = chooseCamp(app.state, el.dataset.v); app.toast(r.msg); app.save(); app.render(); },
  psint(el, app) { setIntensity(app.state, el.dataset.v); app.save(); app.render(); },
  psadd(el, app) { const r = addFriendly(app.state, +el.dataset.id); app.toast(r.msg); app.save(); app.render(); },
  pssim(el, app) {
    const s = app.state;
    const { cfg, userSide } = friendlyCfg(s, +el.dataset.id);
    const m = simulateMatch(cfg);
    applyFriendly(s, +el.dataset.id, summarize(m), m, userSide);
    app.save(); app.render();
  },
  psplay(el, app) {
    const s = app.state;
    const id = +el.dataset.id;
    const { cfg, userSide } = friendlyCfg(s, id);
    openMatch(app, { cfg, userSide, label: `Amical · ${clubById(s, id).name}`, onFinish: (sum, m) => { applyFriendly(s, id, sum, m, userSide); app.save(); app.render(); } });
  },
  psstart(el, app) {
    if (app.online) return import('./online.js').then((m) => m.setMeReady(app)); // en ligne : la saison démarre quand tout le monde est prêt
    endPreseason(app.state); app.save(true); app.render();
  },
};
