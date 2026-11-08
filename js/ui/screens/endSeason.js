/**
 * Bilan de fin de saison : champion, place finale vs objectif, promotions/relégations,
 * évolution des joueurs, retraites, jeunes, confiance du board (ou limogeage).
 */
import { endSeason, jobOffers, changeClub, DIV_NAMES } from '../../game/season.js';
import { money } from '../../game/economy.js';
import { esc, crest, scaleColor, gauge } from '../components.js';

export function showEndSeason(app) {
  const s = app.state;
  const r = endSeason(s);
  app.save(true);
  const prog = r.progress.slice().sort((a, b) => Math.abs(b.after - b.before) - Math.abs(a.after - a.before)).slice(0, 10);
  const h = app.sheet({
    full: true, dismissable: false,
    html: `<div class="hero" style="padding-top:20px"><small>Saison ${r.season}-${r.season + 1}</small><h1 style="font-size:26px">Bilan de saison</h1></div>
      <div class="card center"><h3>Votre classement</h3>
        <div class="big">${r.userPos}<small style="font-size:14px">e</small></div><small>${DIV_NAMES[r.userDiv]}</small>
        <p>Objectif : ${esc(r.objective.label)} → <b class="${r.met ? 'pos-txt' : 'neg-txt'}">${r.met ? 'atteint ✔' : 'manqué ✘'}</b></p>
        ${r.userNewDiv !== r.userDiv ? `<p style="font-size:18px"><b>${r.userNewDiv < r.userDiv ? '⬆ Promotion en Division 1 !' : '⬇ Relégation en Division 2'}</b></p>` : ''}
        <small>Prime de classement : ${money(r.prize)}</small></div>
      <div class="card"><h3>Palmarès</h3>
        <div class="row between"><span>🏆 Champion D1</span><b>${esc(r.champion)}</b></div>
        <div class="row between"><span>🥇 Champion D2</span><b>${esc(r.champion2)}</b></div>
        <div class="row between"><span>🏆 Coupe</span><b>${esc(r.cupWinner)}</b></div>
        ${r.topScorer ? `<div class="row between"><span>⚽ Meilleur buteur</span><b>${esc(r.topScorer.name)}</b></div>` : ''}
        <div style="margin-top:8px;font-size:13px"><span class="pos-txt">⬆</span> ${r.promoted.map(esc).join(', ')}<br><span class="neg-txt">⬇</span> ${r.relegated.map(esc).join(', ')}</div></div>
      <div class="card"><h3>Évolution des joueurs</h3>
        ${prog.map((p) => `<div class="row between" style="padding:3px 0"><span>${esc(p.name)} <small>${p.age} ans</small></span>
          <span>${p.before} → <b style="color:${p.after > p.before ? 'var(--good)' : 'var(--bad)'}">${p.after}</b></span></div>`).join('') || '<p class="muted">Pas de changement notable.</p>'}
        ${r.retired.length ? `<p style="margin-bottom:0"><small>Retraites : ${r.retired.map(esc).join(', ')}</small></p>` : ''}
        ${r.left.length ? `<p style="margin-bottom:0"><small>Fins de contrat : ${r.left.map(esc).join(', ')}</small></p>` : ''}
        ${r.youth.length ? `<p style="margin-bottom:0"><small>🌱 Nouveaux jeunes : ${r.youth.map(esc).join(', ')}</small></p>` : ''}</div>
      <div class="card"><h3>Confiance du board</h3>
        <div class="row between"><b style="color:${scaleColor(r.confidence)}">${Math.round(r.confidence)}%</b><small>${r.sacked ? 'Vous êtes limogé…' : 'Vous êtes maintenu en poste.'}</small></div>
        ${gauge(r.confidence)}</div>
      ${r.sacked ? `<div class="card"><h3>Offres d'emploi</h3>${jobOffers(s).map((c) => `<div class="prow" data-act="job" data-id="${c.id}">${crest(c)}<div class="pname"><b>${esc(c.name)}</b><small>${DIV_NAMES[c.div]}</small></div></div>`).join('')}</div>`
        : `<p class="center muted">Nouvel objectif : <b>${esc(r.nextObjective)}</b></p><button class="btn primary lg block" data-act="close">Saison ${s.season}-${s.season + 1} ▸</button>`}`,
    onClose: () => app.render(),
    actions: {
      job: (el) => { changeClub(s, +el.dataset.id); app.save(true); h.close(); app.go('home'); },
    },
  });
}
