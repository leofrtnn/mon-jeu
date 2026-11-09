/**
 * Fiche joueur (feuille modale) : attributs (avec brouillard pour les joueurs
 * extérieurs), état, stats, sélection, contrat, actions de transfert.
 */
import { ATTRS, ATTR_LABELS, POSITION_LABELS } from '../../data/constants.js';
import { overall } from '../../engine/ratings.js';
import { money } from '../../game/economy.js';
import { clubById, userClub, gameRng } from '../../game/state.js';
import { askingPrice, loanIn, loanOut, findBuyer, sellPlayer, releasePlayer, promoteYouth, windowOpen } from '../../game/transfers.js';
import { estimate, rangeLabel, observe } from '../../game/scouting.js';
import { esc, posBadge, ovrChip, scaleColor, gauge, stars, statusTags } from '../components.js';
import { negotiateTransfer, negotiateContract } from './negotiation.js';
import { TALKS, playerTalk } from '../../game/media.js';
import { PROMISE_ROLES } from '../../game/transfers.js';

/** Jauge d'attribut : valeur exacte ou plage estimée. */
function attrLine(label, [lo, hi]) {
  if (lo === hi) return `<div class="attr"><span>${label}</span>${gauge(lo, scaleColor(lo))}<span class="v">${lo}</span></div>`;
  return `<div class="attr"><span>${label}</span><div class="gauge" style="position:relative"><i style="width:${lo}%;background:${scaleColor(lo)}"></i>
    <i style="position:absolute;left:${lo}%;top:0;width:${hi - lo}%;background:${scaleColor(hi)};opacity:.35"></i></div><span class="v" style="font-size:11px">${lo}-${hi}</span></div>`;
}

export function showPlayer(app, pid, onChange) {
  const s = app.state;
  const render = () => {
    const p = s.players[pid];
    if (!p) return '<p>Joueur introuvable.</p>';
    const uc = userClub(s);
    const mine = p.clubId === uc.id;
    const youth = uc.youthIds.includes(p.id);
    const club = p.clubId ? clubById(s, p.clubId) : null;
    const e = estimate(s, p);
    const attrs = ATTRS.filter((k) => k !== 'arr' || p.pos === 'GB');
    const apps = p.stats.apps;
    const avg = apps ? (p.stats.ratingSum / apps).toFixed(2) : '—';
    const potStars = e.pot.map((v) => Math.max(1, Math.min(5, Math.round((v - 45) / 10))));
    let actions = '';
    if (youth) {
      actions = `<button class="btn primary block" data-act="promote">Promouvoir en équipe première</button>`;
    } else if (mine) {
      actions = `<div class="btns">
        ${!p.onLoanFrom ? `<button class="btn" data-act="talk">💬 Discuter</button><button class="btn" data-act="renew">${p.contract <= 2 ? 'Prolonger' : 'Renégocier'}</button>
        <button class="btn" data-act="sell">Vendre</button>
        <button class="btn" data-act="list">${p.listed ? 'Retirer de la liste' : 'Mettre sur la liste'}</button>
        <button class="btn" data-act="loanout">Prêter</button>
        <button class="btn danger" data-act="release">Libérer</button>` : '<small class="muted">Joueur prêté : il retournera dans son club en fin de saison.</small>'}
      </div>`;
    } else {
      const price = askingPrice(s, p);
      const queued = (s.scoutQueue || []).includes(p.id);
      actions = `<div class="btns">
        <button class="btn primary" data-act="buy" ${windowOpen(s) ? '' : 'disabled'}>${p.clubId ? `Négocier · ${money(price)}` : 'Négocier (libre)'}</button>
        ${p.clubId && p.age <= 23 ? `<button class="btn" data-act="loanin" ${windowOpen(s) ? '' : 'disabled'}>Prêt</button>` : ''}
        ${!e.exact ? `<button class="btn" data-act="observe" ${queued ? 'disabled' : ''}>${queued ? 'En observation…' : '🔭 Observer'}</button>` : ''}
      </div>${windowOpen(s) ? '' : '<p class="muted" style="font-size:12px">Mercato fermé (début de saison et mi-saison).</p>'}`;
    }
    const ovrHtml = e.exact ? ovrChip(overall(p)) : `<span class="ovr t3" style="min-width:56px;font-size:13px">${rangeLabel(e.ovr)}</span>`;
    return `<div class="row" style="gap:12px;margin-bottom:10px">
        <div style="font-size:30px;font-weight:900;color:var(--muted);min-width:44px;text-align:center">${p.number || ''}</div>
        <div class="grow"><h2>${esc(p.first)} ${esc(p.last)}</h2>
          <div class="row" style="gap:6px;flex-wrap:wrap">${posBadge(p.pos)}<small>${POSITION_LABELS[p.pos]} · ${p.age} ans · ${esc(p.nat || '')}</small>${statusTags(p)}</div>
          <small>${club ? esc(club.name) : 'Libre'}${p.onLoanFrom ? ` (prêt de ${esc(clubById(s, p.onLoanFrom).short)})` : ''}</small></div>
        <div class="center">${ovrHtml}<div style="font-size:11px;margin-top:4px">${stars(potStars[1])}</div></div>
      </div>
      ${p.requested ? '<div class="tag ok" style="display:block;margin-bottom:8px">🧑‍💼 Son agent réclame un transfert</div>' : ''}
      ${p.injury > 0 ? `<div class="tag bad" style="display:block;margin-bottom:8px">✚ ${esc(p.injuryName)} — indisponible ${p.injury} match(s)</div>` : ''}
      ${!e.exact ? `<p class="muted" style="font-size:12px;margin:0 2px 6px">🔭 Connaissance : ${e.k}% · les valeurs affichées sont des estimations du recruteur.</p>` : ''}
      <div class="card" style="margin-top:0">${attrs.map((k) => attrLine(ATTR_LABELS[k], e.attrs[k])).join('')}</div>
      ${mine || youth ? `<div class="card">
        <div class="attr"><span>Forme</span>${gauge(p.form)}<span class="v">${p.form}</span></div>
        <div class="attr"><span>Moral</span>${gauge(p.morale)}<span class="v">${p.morale}</span></div>
        <div class="attr"><span>Condition</span>${gauge(100 - p.fatigue)}<span class="v">${100 - Math.round(p.fatigue)}</span></div>
      </div>` : ''}
      <div class="statgrid">
        <div><b>${apps}</b><small>Matchs</small></div><div><b>${p.stats.goals}</b><small>Buts</small></div>
        <div><b>${p.stats.assists}</b><small>Passes D.</small></div><div><b>${avg}</b><small>Note moy.</small></div>
      </div>
      <div class="card">
        <div class="row between"><span>Sélections (${esc(p.nat || '—')})</span><b>${p.caps || 0} · ${p.intGoals || 0} but(s)</b></div>
        ${p.career ? `<div class="row between"><span>Carrière</span><b>${p.career.apps + apps} m · ${p.career.goals + p.stats.goals} b</b></div>` : ''}
        <div class="row between"><span>Valeur</span><b>${money(p.value)}</b></div>
        <div class="row between"><span>Salaire</span><b>${money(p.wage)}/sem</b></div>
        <div class="row between"><span>Contrat</span><b>${p.contract > 0 ? `${p.contract} an(s)` : '—'}</b></div>
        ${mine && p.clause ? `<div class="row between"><span>Clause libératoire</span><b>${money(p.clause)}</b></div>` : ''}
        ${mine && p.promise ? `<div class="row between"><span>Statut promis</span><b>${PROMISE_ROLES[p.promise.role].label}${p.promise.strikes ? ' ⚠' : ''}</b></div>` : ''}
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
      buy: () => { h.close(); negotiateTransfer(app, pid, onChange); },
      loanin: () => done(loanIn(s, pid), true),
      observe: () => done({ ...observe(s, pid), ok: true }),
      renew: () => { h.close(); negotiateContract(app, pid, null, onChange, true); },
      talk: () => {
        const ts = app.sheet({
          html: `<h2>💬 Discussion avec ${esc(s.players[pid].name)}</h2><p class="muted">Forme ${s.players[pid].form} · moral ${s.players[pid].morale}</p>
            <div class="btns" style="flex-direction:column">${Object.entries(TALKS).map(([k, l]) => `<button class="btn block" data-act="say" data-v="${k}">${l}</button>`).join('')}</div>`,
          actions: { say: (b) => { const r = playerTalk(s, pid, b.dataset.v); app.toast(r.msg, 3500); if (r.ok) app.save(); ts.close(); h.update(render()); } },
        });
      },
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
