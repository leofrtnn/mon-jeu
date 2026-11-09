/**
 * Bilan de fin de saison : palmarès, place finale vs objectif, promotions/relégations,
 * évolution des joueurs, réputation du coach, offres d'emploi (ou limogeage).
 */
import { endSeason, changeClub, DIV_NAMES, CONTI_NAME } from '../../game/season.js';
import { clubById } from '../../game/state.js';
import { money } from '../../game/economy.js';
import { esc, crest, scaleColor, gauge , starBar, abilityStars } from '../components.js';

/** report : bilan déjà calculé (carrière en ligne : c'est l'hôte qui l'a calculé). */
export function showEndSeason(app, report = null) {
  const s = app.state;
  const r = report || endSeason(s);
  app.save(true);
  const prog = r.progress.slice().sort((a, b) => Math.abs(b.after - b.before) - Math.abs(a.after - a.before)).slice(0, 10);
  const jobs = (r.jobs || []).map((id) => clubById(s, id));
  const h = app.sheet({
    full: true, dismissable: false,
    html: `<div class="hero" style="padding-top:20px"><small>Saison ${r.season}-${r.season + 1}</small><h1 style="font-size:26px">Bilan de saison</h1></div>
      <div class="card center"><h3>Votre classement</h3>
        <div class="big">${r.userPos}<small style="font-size:14px">e</small></div><small>${DIV_NAMES[r.userDiv]}</small>
        <p>Objectif : ${esc(r.objective.label)} → <b class="${r.met ? 'pos-txt' : 'neg-txt'}">${r.met ? 'atteint ✔' : 'manqué ✘'}</b></p>
        ${r.userNewDiv !== r.userDiv ? `<p style="font-size:18px"><b>${r.userNewDiv < r.userDiv ? '⬆ Promotion en Division 1 !' : '⬇ Relégation en Division 2'}</b></p>` : ''}
        <small>Prime de classement : ${money(r.prize)}</small></div>
      <div class="card"><h3>Palmarès</h3>
        ${r.champions.map((c) => `<div class="row between"><span>🏆 ${esc(DIV_NAMES[c.div])}</span><b>${esc(c.name)}</b></div>`).join('')}
        ${r.cups.map((c) => `<div class="row between"><span>🏆 ${esc(c.name)}</span><b>${esc(c.winner)}</b></div>`).join('')}
        <div class="row between"><span>⭐ ${CONTI_NAME}</span><b>${esc(r.conti)}</b></div>
        ${r.topScorer ? `<div class="row between"><span>⚽ Meilleur buteur</span><b>${esc(r.topScorer.name)}</b></div>` : ''}
        <div style="margin-top:8px;font-size:13px"><span class="pos-txt">⬆</span> ${r.promoted.map(esc).join(', ')}<br><span class="neg-txt">⬇</span> ${r.relegated.map(esc).join(', ')}</div></div>
      <div class="card"><h3>Évolution des joueurs</h3>
        ${prog.map((p) => `<div class="row between" style="padding:3px 0"><span>${esc(p.name)} <small>${p.age} ans</small></span>
          <span>${starBar(abilityStars(p.before))} → <b style="color:${p.after > p.before ? 'var(--good)' : 'var(--bad)'}">${p.after > p.before ? '▲' : '▼'}</b> ${starBar(abilityStars(p.after))}</span></div>`).join('') || '<p class="muted">Pas de changement notable.</p>'}
        ${r.retired.length ? `<p style="margin-bottom:0"><small>Retraites : ${r.retired.map(esc).join(', ')}</small></p>` : ''}
        ${r.left.length ? `<p style="margin-bottom:0"><small>Fins de contrat : ${r.left.map(esc).join(', ')}</small></p>` : ''}
        ${r.youth.length ? `<p style="margin-bottom:0"><small>🌱 Nouveaux jeunes : ${r.youth.map(esc).join(', ')}</small></p>` : ''}</div>
      <div class="card"><h3>Confiance du board · réputation</h3>
        <div class="row between"><b style="color:${scaleColor(r.confidence)}">${Math.round(r.confidence)}%</b><small>${r.sacked ? 'Vous êtes limogé…' : 'Vous êtes maintenu en poste.'}</small></div>
        ${gauge(r.confidence)}
        <div class="row between" style="margin-top:10px"><span>Réputation du coach</span><b>${Math.round(s.coach.rep)}</b></div>${gauge(s.coach.rep)}</div>
      ${jobs.length ? `<div class="card"><h3>${r.sacked ? "Offres d'emploi" : 'Des clubs vous sollicitent'}</h3>${jobs.map((c) => `<div class="prow" data-act="job" data-id="${c.id}">${crest(c)}<div class="pname"><b>${esc(c.name)}</b><small>${DIV_NAMES[c.div]} · réputation ${c.rep}</small></div><span class="btn sm">Signer</span></div>`).join('')}</div>` : ''}
      ${r.sacked && !jobs.length ? '<p class="center">Aucune offre… vous retrouvez un banc modeste.</p>' : ''}
      ${!r.sacked ? `<p class="center muted">Nouvel objectif : <b>${esc(r.nextObjective)}</b></p><button class="btn primary lg block" data-act="close">${jobs.length ? 'Rester au club' : 'Saison suivante'} ▸</button>` : ''}
      ${r.sacked && !jobs.length ? '<button class="btn primary lg block" data-act="anyjob">Chercher un club</button>' : ''}`,
    onClose: () => app.render(),
    actions: {
      job: (el) => { changeClub(s, +el.dataset.id); app.save(true); h.close(); app.go('home'); },
      anyjob: () => {
        const c = s.clubs.filter((x) => x.id !== s.userClubId).sort((a, b) => a.rep - b.rep)[0];
        changeClub(s, c.id); app.save(true); h.close(); app.go('home');
      },
    },
  });
}
