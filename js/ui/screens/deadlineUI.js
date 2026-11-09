/**
 * Écran « Deadline day » : compte à rebours, offres surprises, bonnes affaires,
 * coups de théâtre. Jouable en moins de 3 minutes.
 */
import { deadlineEvent, acceptDeadlineOffer, signBargain, DEADLINE_SECONDS, DEADLINE_EVERY } from '../../game/deadline.js';
import { clubById } from '../../game/state.js';
import { esc } from '../components.js';

export function openDeadline(app) {
  const s = app.state;
  const L = s.life;
  const key = `${s.season}-${s.day}`;
  if (L.deadlineDone === key) { app.toast('Le mercato a fermé ses portes.'); return; }
  let left = DEADLINE_SECONDS;
  let n = 0;
  let next = DEADLINE_EVERY[0];
  const feed = [];
  const log = (t, cls = '') => { feed.unshift({ t, cls, at: left }); };
  const html = () => {
    const mm = String(Math.floor(left / 60)).padStart(2, '0'), ss = String(left % 60).padStart(2, '0');
    const hot = left <= 20;
    return `<div class="deadline-head ${hot ? 'hot' : ''}"><span>⏰ DEADLINE DAY</span><b id="dlclock">${mm}:${ss}</b></div>
      <div class="dl-feed">${feed.map((f) => `<div class="dl-item ${f.cls}">
        <small>${String(Math.floor(f.at / 60)).padStart(2, '0')}:${String(f.at % 60).padStart(2, '0')}</small> ${esc(f.t)}
        ${f.ev && !f.done ? (f.ev.type === 'offer'
          ? `<div class="btns"><button class="btn sm" data-act="dlno" data-i="${f.id}">Refuser</button><button class="btn sm primary" data-act="dlyes" data-i="${f.id}">Accepter</button></div>`
          : `<div class="btns"><button class="btn sm primary" data-act="dlsign" data-i="${f.id}">Foncer !</button></div>`) : ''}
        ${f.res ? `<div><small class="${f.ok ? 'ok' : 'bad'}">${esc(f.res)}</small></div>` : ''}</div>`).join('') || '<p class="muted">Les téléphones chauffent… restez à l\'écoute.</p>'}</div>
      ${left <= 0 ? '<button class="btn primary block lg" data-act="close">Le mercato est terminé</button>' : '<button class="btn ghost block" data-act="finish">Passer la fin</button>'}`;
  };
  let id = 0;
  const tick = () => {
    left--;
    if (left <= next && left > 0) {
      const ev = deadlineEvent(s, n++);
      next = left - DEADLINE_EVERY[0] - (n % (DEADLINE_EVERY[1] - DEADLINE_EVERY[0] + 1));
      if (ev) feed.unshift({ t: ev.text, ev, id: ++id, at: left, cls: ev.type === 'offer' ? 'in' : ev.type === 'bargain' ? 'deal' : '' });
    }
    if (left <= 0) { clearInterval(timer); L.deadlineDone = key; app.save(); log('Clap de fin : le mercato est fermé !', 'end'); }
    h.update(html());
  };
  const timer = setInterval(tick, 1000);
  const find = (el) => feed.find((f) => f.id === +el.dataset.i);
  const h = app.sheet({
    html, full: true, dismissable: false,
    actions: {
      dlyes: (el) => { const f = find(el); const r = acceptDeadlineOffer(s, f.ev); f.done = true; f.res = r.msg; f.ok = r.ok; app.save(); h.update(html()); },
      dlno: (el) => { const f = find(el); f.done = true; f.res = `Vous refusez l'offre de ${clubById(s, f.ev.clubId).short}.`; h.update(html()); },
      dlsign: (el) => { const f = find(el); const r = signBargain(s, f.ev); f.done = true; f.res = r.msg; f.ok = r.ok; app.save(); h.update(html()); },
      finish: () => { left = 1; tick(); },
    },
    onClose: () => { clearInterval(timer); app.render(); },
  });
  return h;
}
