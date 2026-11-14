/**
 * HABILLAGE TÉLÉ DU MATCH (incrustations façon retransmission)
 * ------------------------------------------------------------------
 *  - « scorebug » : sigles des clubs, score, chrono (en haut à gauche du terrain) ;
 *  - présentation d'avant-match : les deux onze, entraîneurs, arbitre, météo, affluence ;
 *  - bandeaux bas d'écran : but (buteur, passeur, minute), carton, blessure ;
 *  - panneau du 4e arbitre : changements (▲ entrant / ▼ sortant) et temps additionnel ;
 *  - cartes de mi-temps / fin de match (score et statistiques clés).
 * Tout est en HTML par-dessus le terrain (2D ou 3D) : lisible, net, et sans coût 3D.
 */
import { esc, crest } from './components.js';
import { face } from './images.js';
import { createRng, hashSeed } from '../core/rng.js';
import { randomName } from '../data/names.js';
import { clockLabel, summarize } from '../engine/match.js';

const WEATHER = [
  { k: 'sun', icon: '☀️', label: 'Ensoleillé' }, { k: 'clear', icon: '🌤️', label: 'Ciel dégagé' },
  { k: 'cloud', icon: '☁️', label: 'Nuageux' }, { k: 'rain', icon: '🌧️', label: 'Pluie' },
  { k: 'cold', icon: '🌫️', label: 'Frais et humide' }, { k: 'snow', icon: '🌨️', label: 'Neige fondue' },
];

/** Conditions du jour (stables pour un match donné) : météo, température, arbitre, affluence. */
export function matchDay(m, cfg, date) {
  const rng = createRng(hashSeed(`jour-${cfg.seed}-${cfg.home.club.id}-${cfg.away.club.id}`));
  const month = date ? (typeof date === 'string' ? +date.slice(5, 7) - 1 : date.getMonth()) : 8;
  const winter = [11, 0, 1].includes(month), summer = [5, 6, 7].includes(month);
  const pool = winter ? ['cloud', 'rain', 'cold', 'snow', 'clear'] : summer ? ['sun', 'sun', 'clear', 'cloud'] : ['clear', 'cloud', 'rain', 'sun'];
  const wk = rng.pick(pool);
  const w = WEATHER.find((x) => x.k === wk) || WEATHER[1];
  const temp = Math.round((winter ? 4 : summer ? 25 : 14) + rng.range(-5, 5));
  const ref = randomName(rng, cfg.home.club.country || 'FRA');
  const cap = cfg.home.club.stadium || 20000;
  const fill = Math.min(1, 0.62 + (cfg.home.club.rep || 60) / 260 + (cfg.away.club.rep || 60) / 700 + rng.range(-0.04, 0.04));
  return { weather: w, temp, referee: `${ref.first} ${ref.last}`, attendance: Math.round((cap * (cfg.neutral ? 0.7 : fill)) / 10) * 10, capacity: cap };
}

export class Broadcast {
  /**
   * el : conteneur posé sur le terrain ; ctx : { m, cfg, hc, ac, colors: [c0, c1], nameOf(id), coachOf(side) }
   */
  constructor(el, ctx) {
    this.el = el; this.ctx = ctx;
    el.innerHTML = `<div class="bc-bug" id="bc-bug"></div><div class="bc-lower" id="bc-lower"></div><div class="bc-board" id="bc-board"></div><div class="bc-full" id="bc-full"></div>`;
    this.$ = (id) => el.querySelector('#' + id);
    this.score = [0, 0]; this.clock = '0\'';
    this.bug();
  }

  /** Scorebug : sigles, couleurs, score, chrono. */
  bug(score = this.score, clock = this.clock) {
    this.score = score; this.clock = clock;
    const { hc, ac, colors } = this.ctx;
    this.$('bc-bug').innerHTML = `<span class="t" style="--tc:${colors[0]}">${esc(hc.short)}</span><b>${score[0]}<i>-</i>${score[1]}</b><span class="t" style="--tc:${colors[1]}">${esc(ac.short)}</span><em>${esc(clock)}</em>`;
  }

  pop(el) { el.classList.remove('show'); void el.offsetWidth; el.classList.add('show'); }

  /** Bandeau bas d'écran. */
  lower(html, side, ms = 4200) {
    const el = this.$('bc-lower');
    el.style.setProperty('--tc', side == null ? '#7c5cff' : this.ctx.colors[side]);
    el.innerHTML = html;
    this.pop(el);
    clearTimeout(this._lt);
    this._lt = setTimeout(() => el.classList.remove('show'), ms);
  }

  /** Panneau lumineux du 4e arbitre. */
  board(html, ms = 3200) {
    const el = this.$('bc-board');
    el.innerHTML = html;
    this.pop(el);
    clearTimeout(this._bt);
    this._bt = setTimeout(() => el.classList.remove('show'), ms);
  }

  mpOf(id) {
    for (const t of this.ctx.m.teams) for (const mp of [...t.onPitch, ...t.bench, ...t.out]) if (mp && mp.id === id) return { mp, t };
    return {};
  }

  /** Réagit à un événement du match. */
  event(ev) {
    const { hc, ac } = this.ctx;
    const club = (side) => (side === 0 ? hc : ac);
    if (ev.type === 'goal') {
      const { mp } = this.mpOf(ev.pid), as = ev.pid2 ? this.mpOf(ev.pid2).mp : null;
      this.lower(`<span class="ico">⚽</span>${mp ? face(mp.p, club(ev.side)) : ''}<div class="txt"><small>BUT · ${esc(club(ev.side).name)}</small><b>${esc(mp?.name || '')}</b>
        <span>${clockLabel(ev.minute, ev.extra)}${ev.kind === 'penalty' ? ' · sur penalty' : ev.kind === 'header' ? ' · de la tête' : ev.kind === 'freekick' ? ' · coup franc direct' : ''}${as ? ` · passe de ${esc(as.name)}` : ''}</span></div>
        <b class="sc">${ev.score[0]} - ${ev.score[1]}</b>`, ev.side, 5200);
    } else if (ev.type === 'yellow' || ev.type === 'red') {
      const { mp } = this.mpOf(ev.pid);
      this.lower(`<span class="card ${ev.type}"></span>${mp ? face(mp.p, club(ev.side)) : ''}<div class="txt"><small>${ev.type === 'yellow' ? 'CARTON JAUNE' : 'CARTON ROUGE'} · ${esc(club(ev.side).short)}</small><b>${esc(mp?.name || '')}</b><span>${clockLabel(ev.minute, ev.extra)}${ev.type === 'red' && mp?.yellow >= 2 ? ' · deuxième avertissement' : ''}</span></div>`, ev.side, 3800);
    } else if (ev.type === 'injury') {
      const { mp } = this.mpOf(ev.pid);
      this.lower(`<span class="ico">✚</span><div class="txt"><small>BLESSURE · ${esc(club(ev.side).short)}</small><b>${esc(mp?.name || '')}</b><span>Il ne peut pas continuer</span></div>`, ev.side, 3500);
    } else if (ev.type === 'sub') {
      const inn = this.mpOf(ev.pid).mp, out = this.mpOf(ev.pid2).mp;
      this.board(`<small>${esc(club(ev.side).short)} · REMPLACEMENT</small>
        <div class="row"><span class="up">▲</span><b class="led">${inn?.number ?? ''}</b><span class="nm">${esc(inn?.name || '')}</span></div>
        <div class="row"><span class="down">▼</span><b class="led">${out?.number ?? ''}</b><span class="nm">${esc(out?.name || '')}</span></div>`);
    } else if (ev.type === 'added') {
      this.board(`<small>TEMPS ADDITIONNEL</small><div class="row"><b class="led big">+${ev.value}</b></div>`, 3600);
    }
  }

  /** Carte plein cadre : mi-temps ou fin de match (score + stats clés). */
  fullCard(kind, ms = 2600) {
    const { m, hc, ac, colors } = this.ctx;
    const sum = summarize(m);
    const st = sum.stats;
    const row = (label, a, b, fmt = (x) => x) => `<div class="st"><b>${fmt(a)}</b><span>${label}</span><b>${fmt(b)}</b></div>`;
    const el = this.$('bc-full');
    el.innerHTML = `<div class="box"><small>${kind === 'ht' ? 'MI-TEMPS' : 'FIN DU MATCH'}</small>
      <div class="teams"><div>${crest(hc)}<span style="--tc:${colors[0]}">${esc(hc.name)}</span></div><b>${m.score[0]} - ${m.score[1]}</b><div>${crest(ac)}<span style="--tc:${colors[1]}">${esc(ac.name)}</span></div></div>
      ${row('Possession', sum.possession[0], sum.possession[1], (x) => x + ' %')}${row('Tirs (cadrés)', `${st[0].shots} (${st[0].onTarget})`, `${st[1].shots} (${st[1].onTarget})`)}${row('xG', st[0].xg, st[1].xg, (x) => (typeof x === 'number' ? x.toFixed(2) : x))}</div>`;
    this.pop(el);
    return new Promise((res) => setTimeout(() => { el.classList.remove('show'); res(); }, ms));
  }

  /**
   * Présentation d'avant-match : les deux onze, entraîneurs, arbitre, météo, affluence.
   * Résout la promesse à la fin (ou quand on touche « Passer »).
   */
  intro(day, ms = 7000) {
    const { m, hc, ac, colors, coachOf } = this.ctx;
    const xi = (side) => {
      const t = m.teams[side];
      return t.onPitch.filter(Boolean).map((mp) => `<li>${face(mp.p, side ? ac : hc)}<em>${mp.number ?? ''}</em><span>${esc(mp.name)}${mp.id === t.captain ? ' <b class="xi-tag cap">C</b>' : ''}</span><small>${t.slots[mp.slot].pos}</small></li>`).join('');
    };
    const col = (side) => { const c = side ? ac : hc, t = m.teams[side]; return `<div class="side" style="--tc:${colors[side]}">
      <div class="head">${crest(c)}<div><b>${esc(c.name)}</b><small>${esc(t.tactics.formation || '')}${coachOf(side) ? ` · ${esc(coachOf(side))}` : ''}</small></div></div><ol>${xi(side)}</ol></div>`; };
    const el = this.$('bc-full');
    el.innerHTML = `<div class="intro">${col(0)}<div class="mid"><small>COMPOSITIONS</small>
        <div class="facts"><span>${day.weather.icon} ${day.weather.label} · ${day.temp} °C</span><span>🏟️ ${day.attendance.toLocaleString('fr-FR')} spectateurs</span><span>🧑‍⚖️ Arbitre : ${esc(day.referee)}</span></div>
        <button class="btn sm" data-bc="skip">Passer ▸</button></div>${col(1)}</div>`;
    this.pop(el);
    return new Promise((res) => {
      let done = false;
      const end = () => { if (done) return; done = true; el.classList.remove('show'); res(); };
      el.querySelector('[data-bc=skip]').addEventListener('click', end);
      setTimeout(end, ms);
    });
  }
}
