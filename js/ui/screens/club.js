/**
 * Club : finances, mercato (acheter, vendre, prêter), centre de formation, objectifs du board.
 */
import { userClub, clubPlayers, clubById } from '../../game/state.js';
import { money, wageBill, sponsorIncome } from '../../game/economy.js';
import { marketList, windowOpen, academyCost, upgradeAcademy, sellPlayer } from '../../game/transfers.js';
import { tablePosition, CUP_ROUND_NAMES, DIV_NAMES } from '../../game/season.js';
import { overall } from '../../engine/ratings.js';
import { POSITIONS } from '../../data/constants.js';
import { esc, seg, playerRow, gauge, stars, potentialStars, scaleColor } from '../components.js';
import { showPlayer } from './playerSheet.js';

export function render(app) {
  const tab = app.ui.clubTab || 'fin';
  const s = app.state;
  let body;
  if (tab === 'fin') body = finances(s);
  else if (tab === 'market') body = market(app);
  else if (tab === 'youth') body = youth(s);
  else body = objectives(s);
  return `<div style="margin-top:6px">${seg('ctab', ['fin', 'market', 'youth', 'obj'], tab, { fin: 'Finances', market: 'Mercato', youth: 'Formation', obj: 'Objectifs' })}</div>${body}`;
}

function finances(s) {
  const uc = userClub(s);
  const wages = wageBill(clubPlayers(s, uc));
  const hist = uc.finances.history.filter((h) => h.season === s.season);
  // Agrégat par journée pour le graphique.
  const byDay = new Map();
  for (const h of hist) byDay.set(h.day, (byDay.get(h.day) || 0) + h.amount);
  const days = [...byDay.entries()].sort((a, b) => a[0] - b[0]).slice(-16);
  const max = Math.max(1, ...days.map((d) => Math.abs(d[1])));
  const sum = (pred) => hist.filter(pred).reduce((a, h) => a + h.amount, 0);
  const cats = [
    ['Billetterie', sum((h) => h.label.startsWith('Billetterie'))],
    ['Sponsors', sum((h) => h.label === 'Sponsors')],
    ['Primes', sum((h) => h.label.startsWith('Prime'))],
    ['Transferts', sum((h) => /Transfert|Vente|Prêt|Indemnité/.test(h.label))],
    ['Salaires', sum((h) => h.label === 'Salaires')],
    ['Infrastructures', sum((h) => h.label === 'Centre de formation')],
  ];
  return `<div class="card center"><h3>Budget</h3><div class="big ${uc.budget < 0 ? 'neg-txt' : ''}">${money(uc.budget)}</div>
    <small>Masse salariale ${money(wages)}/sem · Sponsors ${money(sponsorIncome(uc))}/sem</small></div>
    <div class="card"><h3>Flux par journée</h3>
      ${days.length ? `<div class="bars">${days.map(([, v]) => `<i title="${money(v)}" style="height:${Math.abs(v) / max * 100}%;background:${v >= 0 ? 'var(--good)' : 'var(--bad)'}"></i>`).join('')}</div>` : '<p class="muted">Pas encore de mouvements cette saison.</p>'}
    </div>
    <div class="card"><h3>Saison en cours</h3>
      ${cats.map(([l, v]) => `<div class="row between" style="padding:5px 0"><span>${l}</span><b class="${v >= 0 ? 'pos-txt' : 'neg-txt'}">${v >= 0 ? '+' : ''}${money(v)}</b></div>`).join('')}
    </div>
    <div class="card"><h3>Derniers mouvements</h3>
      ${uc.finances.history.slice(0, 12).map((h) => `<div class="row between" style="padding:4px 0;font-size:13px"><span class="grow">${esc(h.label)}</span><span class="${h.amount >= 0 ? 'pos-txt' : 'neg-txt'}">${h.amount >= 0 ? '+' : ''}${money(h.amount)}</span></div>`).join('') || '<p class="muted">—</p>'}
    </div>`;
}

function market(app) {
  const s = app.state;
  const uc = userClub(s);
  const pos = app.ui.mktPos || null;
  const mode = app.ui.mktMode || 'buy';
  const open = windowOpen(s);
  let html = `<div class="card row between" style="padding:10px 14px">
      <span>${open ? '🟢 Mercato ouvert' : '🔴 Mercato fermé'}</span><small>Budget ${money(uc.budget)}</small></div>
    ${seg('mmode', ['buy', 'loan', 'sell'], mode, { buy: 'Acheter', loan: 'Prêts', sell: 'Mes ventes' })}`;
  if (mode === 'sell') {
    const offers = (s.pendingOffers || []).filter((o) => s.players[o.pid]?.clubId === uc.id);
    const listed = clubPlayers(s, uc).filter((p) => p.listed);
    html += `<div class="label">Offres reçues</div><div class="card" style="margin-top:0">${offers.map((o) => {
      const p = s.players[o.pid]; const c = clubById(s, o.clubId);
      return `<div class="row" style="padding:6px 0"><div class="grow"><b>${esc(p.name)}</b> <small>(${overall(p)})</small><br><small>${esc(c.name)} · ${money(o.amount)}</small></div>
        <button class="btn sm" data-act="decline" data-id="${p.id}">Non</button><button class="btn sm primary" data-act="accept" data-id="${p.id}">Oui</button></div>`;
    }).join('') || '<p class="muted" style="margin:0">Aucune offre. Placez des joueurs sur la liste des transferts pour attirer les clubs.</p>'}</div>
    <div class="label">Sur la liste des transferts</div><div class="card list" style="padding:0 10px;margin-top:0">${listed.map((p) => playerRow(p)).join('') || '<p class="muted">Aucun joueur listé (fiche joueur → « Mettre sur la liste »).</p>'}</div>`;
    return html;
  }
  const list = marketList(s, { pos, youngOnly: mode === 'loan' }).filter((x) => (mode === 'loan' ? !!x.p.clubId : true)).slice(0, 40);
  html += `<div class="chips" style="margin-top:8px"><button class="chip ${!pos ? 'on' : ''}" data-act="mpos" data-v="">Tous</button>
    ${POSITIONS.map((p) => `<button class="chip ${pos === p ? 'on' : ''}" data-act="mpos" data-v="${p}">${p}</button>`).join('')}</div>
    <div class="card list" style="padding:0 10px">${list.map(({ p, price, ovr }) => {
      const c = p.clubId ? clubById(s, p.clubId) : null;
      const affordable = price <= uc.budget;
      return playerRow(p, {
        extra: `· ${c ? esc(c.short) : 'Libre'} · ${stars(potentialStars(p))}`,
        right: `<div class="center" style="min-width:64px"><b style="color:${scaleColor(ovr + 5)}">${ovr}</b><br><small style="color:${affordable ? 'var(--muted)' : 'var(--bad)'}">${mode === 'loan' ? money(Math.round(p.value * 0.08 / 25000) * 25000) : price ? money(price) : 'Libre'}</small></div>`,
      });
    }).join('') || '<p class="muted">Aucun joueur trouvé.</p>'}</div>`;
  return html;
}

function youth(s) {
  const uc = userClub(s);
  const ys = uc.youthIds.map((id) => s.players[id]).filter(Boolean);
  return `<div class="card"><h3>Centre de formation</h3>
      <div class="row between"><div>${stars(uc.academy)}<br><small>Niveau ${uc.academy}/5 · plus le niveau est haut, meilleurs sont les jeunes</small></div></div>
      ${uc.academy < 5 ? `<button class="btn block" style="margin-top:12px" data-act="upgrade">Améliorer · ${money(academyCost(uc))}</button>` : ''}
    </div>
    <div class="label">Jeunes du centre (${ys.length})</div>
    <div class="card list" style="padding:0 10px;margin-top:0">${ys.map((p) => playerRow(p, { extra: `· pot. ${stars(potentialStars(p))}` })).join('') || '<p class="muted">Nouvelle promotion à la mi-saison et chaque été.</p>'}</div>`;
}

function objectives(s) {
  const uc = userClub(s);
  const pos = tablePosition(s, uc.id);
  const o = s.objectives;
  const ok = pos <= o.league.target;
  const cupState = !o.cup ? null : s.cup.alive.includes(uc.id) ? 'En course' : 'Éliminé';
  return `<div class="card"><h3>Confiance du board</h3>
      <div class="row between"><b style="font-size:22px;color:${scaleColor(s.board.confidence)}">${Math.round(s.board.confidence)}%</b>
      <small>${s.board.confidence < 25 ? 'Votre poste est menacé !' : s.board.confidence < 50 ? 'Le board s\'impatiente.' : 'Le board vous soutient.'}</small></div>
      ${gauge(s.board.confidence)}</div>
    <div class="card"><h3>Objectifs ${s.season}-${s.season + 1}</h3>
      <div class="row" style="padding:6px 0"><span class="grow">🏁 ${esc(o.league.label)}</span><span class="tag ${ok ? 'good' : 'bad'}">${pos}e</span></div>
      ${o.cup ? `<div class="row" style="padding:6px 0"><span class="grow">🏆 ${esc(o.cup.label)}</span><span class="tag ${cupState === 'Éliminé' ? 'bad' : 'good'}">${cupState}</span></div>` : ''}
      <div class="row" style="padding:6px 0"><span class="grow">💶 ${esc(o.finance.label)}</span><span class="tag ${uc.budget >= 0 ? 'good' : 'bad'}">${money(uc.budget)}</span></div>
    </div>
    <div class="card"><h3>Palmarès & historique</h3>
      ${s.history.length ? s.history.slice().reverse().map((h) => `<div class="row between" style="padding:4px 0"><span>${h.season}-${h.season + 1}</span><span>${DIV_NAMES[h.div]} · <b>${h.pos}e</b>${h.cup ? ' · 🏆' : ''}</span></div>`).join('') : '<p class="muted">Première saison au club.</p>'}
    </div>
    <div class="card"><h3>Partie</h3>
      <div class="row between"><span>Arbitrage vidéo (VAR)</span><button class="btn sm" data-act="var">${s.settings.var ? 'Activée' : 'Désactivée'}</button></div>
      <button class="btn danger block" style="margin-top:12px" data-act="quit">Quitter vers le menu</button>
    </div>`;
}

export const actions = {
  ctab(el, app) { app.ui.clubTab = el.dataset.v; app.render(); },
  mmode(el, app) { app.ui.mktMode = el.dataset.v; app.render(); },
  mpos(el, app) { app.ui.mktPos = el.dataset.v || null; app.render(); },
  player(el, app) { showPlayer(app, +el.dataset.id); },
  upgrade(el, app) { const r = upgradeAcademy(app.state); app.toast(r.msg); app.save(); app.render(); },
  accept(el, app) {
    const o = app.state.pendingOffers.find((x) => x.pid === +el.dataset.id);
    const r = sellPlayer(app.state, o); app.toast(r.msg); app.save(); app.render();
  },
  decline(el, app) { app.state.pendingOffers = app.state.pendingOffers.filter((x) => x.pid !== +el.dataset.id); app.save(); app.render(); },
  var(el, app) { app.state.settings.var = !app.state.settings.var; app.save(); app.render(); },
  async quit(el, app) {
    if (!(await app.confirm('Quitter ?', 'La partie est sauvegardée automatiquement.', 'Menu principal'))) return;
    app.save(true);
    app.state = null; app.ui.start = { step: 'menu', div: 1 };
    app.render();
  },
};
