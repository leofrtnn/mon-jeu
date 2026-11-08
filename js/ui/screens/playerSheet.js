/**
 * Fiche joueur (feuille modale) : attributs, état, stats, contrat, actions de transfert.
 */
import { ATTRS, ATTR_LABELS, POSITION_LABELS } from '../../data/constants.js';
import { overall } from '../../engine/ratings.js';
import { money, playerWage } from '../../game/economy.js';
import { clubById, userClub, gameRng } from '../../game/state.js';
import { askingPrice, buyPlayer, loanIn, loanOut, findBuyer, sellPlayer, renewContract, releasePlayer, promoteYouth, windowOpen } from '../../game/transfers.js';
import { esc, posBadge, ovrChip, scaleColor, gauge, stars, potentialStars, statusTags } from '../components.js';

export function showPlayer(app, pid, onChange) {
  const s = app.state;
  const render = () => {
    const p = s.players[pid];
    if (!p) return '<p>Joueur introuvable.</p>';
    const uc = userClub(s);
    const mine = p.clubId === uc.id;
    const youth = uc.youthIds.includes(p.id);
    const club = p.clubId ? clubById(s, p.clubId) : null;
    const o = overall(p);
    const attrs = ATTRS.filter((k) => k !== 'arr' || p.pos === 'GB');
    const apps = p.stats.apps;
    const avg = apps ? (p.stats.ratingSum / apps).toFixed(2) : '—';
    let actions = '';
    if (youth) {
      actions = `<button class="btn primary block" data-act="promote">Promouvoir en équipe première</button>`;
    } else if (mine) {
      actions = `<div class="btns">
        ${p.contract <= 2 && !p.onLoanFrom ? `<button class="btn" data-act="renew">Prolonger (${money(Math.max(p.wage, playerWage(p) * 1.05))}/sem)</button>` : ''}
        ${!p.onLoanFrom ? `<button class="btn" data-act="sell">Vendre</button>
        <button class="btn" data-act="list">${p.listed ? 'Retirer de la liste' : 'Mettre sur la liste'}</button>
        <button class="btn" data-act="loanout">Prêter</button>
        <button class="btn danger" data-act="release">Libérer</button>` : '<small class="muted">Joueur prêté : il retournera dans son club en fin de saison.</small>'}
      </div>`;
    } else {
      const price = askingPrice(s, p);
      actions = `<div class="btns">
        <button class="btn primary" data-act="buy" ${windowOpen(s) ? '' : 'disabled'}>${p.clubId ? `Acheter · ${money(price)}` : 'Signer (libre)'}</button>
        ${p.clubId && p.age <= 23 ? `<button class="btn" data-act="loanin" ${windowOpen(s) ? '' : 'disabled'}>Prêt</button>` : ''}
      </div>${windowOpen(s) ? '' : '<p class="muted" style="font-size:12px">Mercato fermé (journées 1-4 et 21-25 du calendrier).</p>'}`;
    }
    return `<div class="row" style="gap:12px;margin-bottom:10px">
        <div style="font-size:30px;font-weight:900;color:var(--muted);min-width:44px;text-align:center">${p.number || ''}</div>
        <div class="grow"><h2>${esc(p.first)} ${esc(p.last)}</h2>
          <div class="row" style="gap:6px;flex-wrap:wrap">${posBadge(p.pos)}<small>${POSITION_LABELS[p.pos]} · ${p.age} ans</small>${statusTags(p)}</div>
          <small>${club ? esc(club.name) : 'Libre'}${p.onLoanFrom ? ` (prêt de ${esc(clubById(s, p.onLoanFrom).short)})` : ''}</small></div>
        <div class="center">${ovrChip(o)}<div style="font-size:11px;margin-top:4px">${stars(potentialStars(p))}</div></div>
      </div>
      ${p.injury > 0 ? `<div class="tag bad" style="display:block;margin-bottom:8px">✚ ${esc(p.injuryName)} — indisponible ${p.injury} match(s)</div>` : ''}
      <div class="card" style="margin-top:0">
        ${attrs.map((k) => `<div class="attr"><span>${ATTR_LABELS[k]}</span>${gauge(p.attrs[k], scaleColor(p.attrs[k]))}<span class="v">${p.attrs[k]}</span></div>`).join('')}
      </div>
      <div class="card">
        <div class="attr"><span>Forme</span>${gauge(p.form)}<span class="v">${p.form}</span></div>
        <div class="attr"><span>Moral</span>${gauge(p.morale)}<span class="v">${p.morale}</span></div>
        <div class="attr"><span>Condition</span>${gauge(100 - p.fatigue)}<span class="v">${100 - Math.round(p.fatigue)}</span></div>
      </div>
      <div class="statgrid">
        <div><b>${apps}</b><small>Matchs</small></div><div><b>${p.stats.goals}</b><small>Buts</small></div>
        <div><b>${p.stats.assists}</b><small>Passes D.</small></div><div><b>${avg}</b><small>Note moy.</small></div>
      </div>
      <div class="card">
        <div class="row between"><span>Valeur</span><b>${money(p.value)}</b></div>
        <div class="row between"><span>Salaire</span><b>${money(p.wage)}/sem</b></div>
        <div class="row between"><span>Contrat</span><b>${p.contract > 0 ? `${p.contract} an(s)` : '—'}</b></div>
      </div>
      ${actions}`;
  };
  const done = (r, close = false) => {
    app.toast(r.msg);
    if (r.ok) { app.save(); onChange?.(); app.render(); }
    if (r.ok && close) h.close(); else h.update(render());
  };
  const h = app.sheet({
    html: render,
    actions: {
      buy: async () => {
        const p = s.players[pid];
        const price = askingPrice(s, p);
        if (!(await app.confirm(`Recruter ${p.name} ?`, `${p.clubId ? `Indemnité : <b>${money(price)}</b>` : 'Joueur libre : prime à la signature.'}<br>Salaire demandé : ${money(Math.max(p.wage, playerWage(p)) * 1.1)}/sem`, 'Recruter'))) return;
        done(buyPlayer(s, pid), true);
      },
      loanin: () => done(loanIn(s, pid), true),
      renew: () => done(renewContract(s, pid)),
      list: () => { const p = s.players[pid]; p.listed = !p.listed; done({ ok: true, msg: p.listed ? 'Placé sur la liste des transferts.' : 'Retiré de la liste.' }); },
      sell: async () => {
        const p = s.players[pid];
        const offer = findBuyer(s, p, gameRng(s));
        if (!offer) { app.toast('Aucun club intéressé pour le moment.'); return; }
        const c = clubById(s, offer.clubId);
        if (!(await app.confirm('Offre reçue', `${esc(c.name)} propose <b>${money(offer.amount)}</b> pour ${esc(p.name)} (valeur ${money(p.value)}).`, 'Accepter'))) return;
        done(sellPlayer(s, offer), true);
      },
      loanout: async () => {
        if (!(await app.confirm('Prêter ?', 'Le joueur partira jusqu\'à la fin de la saison. Vous payez 30 % de son salaire.', 'Prêter'))) return;
        done(loanOut(s, pid, gameRng(s)), true);
      },
      release: async () => {
        const p = s.players[pid];
        if (!(await app.confirm('Libérer ?', `Indemnité : ${money(p.wage * 10)}.`, 'Libérer', true))) return;
        done(releasePlayer(s, pid), true);
      },
      promote: () => done(promoteYouth(s, pid), true),
    },
  });
  return h;
}
