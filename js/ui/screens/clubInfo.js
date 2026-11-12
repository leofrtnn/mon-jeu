/**
 * Fiche d'un club : propriétaire, santé financière, ambiance, humeur de la relation
 * avec votre club, rivaux, et vue « Relations » (sans nouvel onglet).
 */
import { clubById, userClub, clubPlayers } from '../../game/state.js';
import { relGet, moodOf, rivalsOf, isDerby } from '../../game/relations.js';
import { finHealth, ownerType } from '../../game/owners.js';
import { DIV_NAMES } from '../../game/season.js';
import { squadStrength } from '../../engine/ratings.js';
import { money } from '../../game/economy.js';
import { esc, crest, gauge, scaleColor, starBar, abilityStars, playerRow, ovrChip, seg } from '../components.js';
import { face } from '../images.js';
import { estimate, rangeLabel, mid } from '../../game/scouting.js';
import { POSITION_GROUP } from '../../data/constants.js';
import { overall } from '../../engine/ratings.js';

const line = (label, v) => `<div style="margin:6px 0"><div class="row between" style="font-size:13px"><span>${label}</span><b style="color:${scaleColor(v)}">${Math.round(v)}</b></div>${gauge(v)}</div>`;

export function showClub(app, clubId) {
  const s = app.state;
  const c = clubById(s, clubId);
  const uc = userClub(s);
  const mine = c.id === uc.id;
  let view = 'squad';
  const html = () => {
    if (view === 'rel') {
      const rows = s.clubs.filter((o) => o.id !== c.id).map((o) => ({ o, v: relGet(s, c.id, o.id) })).filter((x) => Math.abs(x.v) >= 10).sort((a, b) => b.v - a.v);
      const top = [...rows.slice(0, 5), ...rows.slice(-5).filter((x) => !rows.slice(0, 5).includes(x))];
      return `<h2>Relations · ${esc(c.name)}</h2>
        <div class="list">${top.map(({ o, v }) => { const md = moodOf(v); return `<div class="prow" data-act="club" data-id="${o.id}">${crest(o, 'sm')}<div class="pname"><b>${esc(o.name)}</b><small>${md.icon} ${md.label}${isDerby(s, c.id, o.id) ? ' · derby' : ''}</small></div><b class="${md.cls}">${v > 0 ? '+' : ''}${Math.round(v)}</b></div>`; }).join('') || '<p class="muted">Aucune relation marquée.</p>'}</div>
        <p class="muted" style="font-size:12px">Au-dessus de +40 : prêts faciles, prix réduits. Sous -40 : négociations chères ou bloquées, matchs tendus. Sans interaction, les scores reviennent vers 0.</p>
        <button class="btn block" data-act="back">◂ Retour</button>`;
    }
    const r = relGet(s, uc.id, c.id);
    const md = moodOf(r);
    const ot = ownerType(c);
    const head = `<div class="row" style="gap:12px">${crest(c, 'lg')}<div class="grow"><h2 style="margin:0">${esc(c.name)}</h2><small>${DIV_NAMES[c.div]} · réputation ${c.rep} · niveau ${starBar(abilityStars(squadStrength(clubPlayers(s, c))))}</small></div>
        ${mine ? '' : `<span class="tag ${md.cls}" title="Relation avec votre club">${md.icon} ${md.label}</span>`}</div>
      <div style="margin:10px 0">${seg('cview', ['squad', 'main'], view, { squad: `Effectif (${c.playerIds.length})`, main: 'Club' })}</div>`;
    if (view === 'squad') {
      // Effectif : regroupé par ligne, notes estimées par vos recruteurs (exactes pour votre club).
      const order = { G: 0, D: 1, M: 2, A: 3 };
      const groupName = { G: 'Gardiens', D: 'Défenseurs', M: 'Milieux', A: 'Attaquants' };
      const ps = clubPlayers(s, c).map((p) => ({ p, e: estimate(s, p) }))
        .sort((a, b) => (order[POSITION_GROUP[a.p.pos]] ?? 9) - (order[POSITION_GROUP[b.p.pos]] ?? 9) || mid(b.e.ovr) - mid(a.e.ovr));
      let html = head, g = null;
      for (const { p, e } of ps) {
        const gp = POSITION_GROUP[p.pos];
        if (gp !== g) { if (g) html += '</div>'; g = gp; html += `<div class="label">${groupName[gp] || 'Autres'}</div><div class="card list" style="padding:0 10px;margin-top:0">`; }
        html += playerRow(p, { club: c, extra: `· ${esc(p.nat || '')}${p.loanedOut ? ' · prêté' : ''}`, right: `<div class="center" style="min-width:78px">${ovrChip(mid(e.ovr), rangeLabel(e.ovr))}<br><small class="muted">${money(p.value || 0)}</small></div>` });
      }
      if (g) html += '</div>';
      return html + `<p class="muted" style="font-size:12px">${mine ? '' : 'Notes estimées par vos recruteurs : envoyez-les observer un joueur pour une note exacte.'}</p>`;
    }
    const rivals = rivalsOf(s, c).slice(0, 4);
    const coach = (s.managers || {})[c.managerId];
    return `${head}
      ${coach ? `<div class="card row" style="gap:12px;align-items:center">${face({ first: coach.first, last: coach.last, photo: coach.photo }, c)}
        <div class="grow"><small class="muted">Entraîneur</small><br><b>${esc(coach.fullName || coach.name || '')}</b>${coach.nat ? ` <small class="muted">· ${esc(coach.nat)}</small>` : ''}</div></div>` : ''}
      <div class="card"><div class="row between"><span>🏛 Propriétaire</span><b>${esc(c.owner?.name || '—')}</b></div><small class="muted">${ot.label}${c.owner?.group ? ' · groupe multi-clubs' : ''}${c.owner?.since ? ` · depuis ${c.owner.since}` : ''}</small>
        ${line('Santé financière', finHealth(s, c))}${line('Ambiance du stade', c.atmosphere ?? 55)}${line('Image', c.image ?? 50)}
        <div class="row between"><span>Budget</span><b>${money(c.budget)}</b></div>${c.crisis ? '<span class="tag bad">Crise financière</span>' : ''}</div>
      ${rivals.length ? `<div class="label">Rivaux</div><div class="chips">${rivals.map((o) => `<button class="chip" data-act="club" data-id="${o.id}">${esc(o.short)}</button>`).join('')}</div>` : ''}
      <button class="btn block" data-act="rel" style="margin-top:10px">🤝 Relations</button>`;
  };
  const h = app.sheet({
    html,
    actions: {
      rel: () => { view = 'rel'; h.update(html()); },
      cview: (el) => { view = el.dataset.v; h.update(html()); },
      player: (el) => { import('./playerSheet.js').then((mod) => mod.showPlayer(app, +el.dataset.id)); },
      back: () => { view = 'main'; h.update(html()); },
      club: (el) => { h.close(); showClub(app, +el.dataset.id); },
    },
  });
  return h;
}

