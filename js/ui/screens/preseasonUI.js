/**
 * Écrans de la préparation estivale : carte d'accueil, réunion avec le CA, amicaux.
 */
import { userClub, clubById } from '../../game/state.js';
import { money } from '../../game/economy.js';
import { meetingOptions, concludeMeeting, addFriendly, friendlySeed, applyFriendly, endPreseason } from '../../game/preseason.js';
import { IDENTITIES } from '../../game/board.js';
import { teamCfg, DIVISIONS } from '../../game/season.js';
import { simulateMatch, summarize } from '../../engine/match.js';
import { esc, crest } from '../components.js';
import { openMatch } from './match.js';

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
    <div class="card"><h3>Matchs amicaux (${ps.friendlies.length}/3)</h3>
      ${ps.friendlies.map((f) => { const c = clubById(s, f.oppId); return `<div class="row" style="padding:6px 0;border-bottom:1px solid var(--line)">${crest(c, 'sm')}
        <span class="grow">${f.home ? '' : '@ '}${esc(c.name)}</span>${f.s ? res(f) : `<button class="btn sm" data-act="pssim" data-id="${c.id}">Simuler</button><button class="btn sm primary" data-act="psplay" data-id="${c.id}">Jouer</button>`}</div>`; }).join('') || '<p class="muted" style="margin:0">Aucun amical programmé : ils améliorent la forme et le moral, et permettent de tester vos tactiques.</p>'}
      ${ps.friendlies.length < 3 ? `<div class="label">Adversaires proposés</div><div class="chips" style="flex-wrap:wrap">${ps.suggestions.filter((id) => !ps.friendlies.some((f) => f.oppId === id)).map((id) => { const c = clubById(s, id); return `<button class="chip" data-act="psadd" data-id="${id}">${esc(c.name)} <small>(${DIVISIONS[c.div].short})</small></button>`; }).join('')}</div>` : ''}
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
  return { cfg: { seed: friendlySeed(s, oppId), varEnabled: s.settings.var, profile: {},
    home: teamCfg(s, h, a, true, h.id === uc.id), away: teamCfg(s, a, h, false, a.id === uc.id) }, userSide: f.home ? 0 : 1 };
}

export const preseasonActions = {
  psmeeting(el, app) { meetingSheet(app); },
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
  psstart(el, app) { endPreseason(app.state); app.save(true); app.render(); },
};
