/**
 * Tactique : formation, consignes, compo en glisser-déposer (ou tap-tap), compo auto.
 */
import { userClub, clubPlayers } from '../../game/state.js';
import { FORMATIONS, FORMATION_NAMES, MENTALITIES, MENTALITY_LABELS, LEVELS, PRESSING_LABELS, TEMPO_LABELS, WIDTH_LABELS, positionFit, BENCH_SIZE, ROLES, rolesFor } from '../../data/constants.js';
import { autoLineup, ratingAt, isAvailable, overall, lineupStrength } from '../../engine/ratings.js';
import { esc, playerRow, seg } from '../components.js';

export function render(app) {
  const s = app.state;
  const uc = userClub(s);
  const t = uc.tactics;
  const players = clubPlayers(s, uc);
  const byId = new Map(players.map((p) => [p.id, p]));
  if (!uc.lineup || uc.lineup.length !== 11) { const lu = autoLineup(players, t.formation); uc.lineup = lu.lineup; uc.bench = lu.bench; }
  const slots = FORMATIONS[t.formation];
  const sel = app.ui.tsel;
  const isSel = (k, v) => sel && sel.kind === k && sel.v === v;
  const pitch = slots.map((sl, i) => {
    const p = byId.get(uc.lineup[i]);
    const fit = p ? positionFit(p.pos, sl.pos) : 0;
    const fc = fit >= 1 ? 'var(--good)' : fit >= 0.85 ? 'var(--ok)' : 'var(--bad)';
    return `<div class="slot ${p ? '' : 'empty'} ${isSel('slot', i) ? 'sel' : ''}" data-drag="slot" data-drop="slot" data-v="${i}"
      style="left:${(sl.y * 84 + 8).toFixed(1)}%;top:${(94 - sl.x * 105).toFixed(1)}%">
      <div class="shirt">${p ? p.number : '+'}${p ? `<span class="fit" style="background:${fc}"></span>` : ''}</div>
      <div class="nm">${p ? esc(p.last) : '—'}${p && (!isAvailable(p)) ? ' ✚' : ''}</div>
      <div class="ps">${sl.pos}${p ? ' · ' + Math.round(ratingAt(p, sl.pos)) : ''}</div>
    </div>`;
  }).join('');
  const benchIds = (uc.bench || []).slice(0, BENCH_SIZE);
  const used = new Set([...uc.lineup, ...benchIds]);
  const reserve = players.filter((p) => !used.has(p.id)).sort((a, b) => overall(b) - overall(a));
  const strength = lineupStrength(players, uc.lineup, t.formation);
  const benchRows = [];
  for (let i = 0; i < BENCH_SIZE; i++) {
    const p = byId.get(benchIds[i]);
    benchRows.push(p
      ? `<div data-drag="bench" data-drop="bench" data-v="${i}" class="benchrow ${isSel('bench', i) ? 'sel' : ''}">${playerRow(p, { act: '', dim: !isAvailable(p) })}</div>`
      : `<div data-drop="bench" data-v="${i}" class="prow benchrow" style="justify-content:center;color:var(--muted)">Place libre</div>`);
  }
  return `
    <div class="chips" style="margin-top:6px">${FORMATION_NAMES.map((f) => `<button class="chip ${f === t.formation ? 'on' : ''}" data-act="formation" data-v="${f}">${f}</button>`).join('')}</div>
    <div class="row between" style="margin:8px 2px">
      <small>Force du onze : <b style="color:var(--text)">${strength.toFixed(1)}</b></small>
      <button class="btn sm primary" data-act="auto">⚡ Compo auto</button>
    </div>
    <div class="tpitch" id="tpitch">${pitch}</div>
    <p class="muted" style="font-size:12px;margin:6px 2px">Glissez un joueur sur un autre pour les échanger (ou touchez-en deux).</p>
    <div class="label">Mentalité</div>${seg('ment', MENTALITIES, t.mentality, MENTALITY_LABELS)}
    <div class="label">Pressing</div>${seg('press', LEVELS, t.pressing, PRESSING_LABELS)}
    <div class="label">Tempo</div>${seg('tempo', LEVELS, t.tempo, TEMPO_LABELS)}
    <div class="label">Largeur</div>${seg('width', LEVELS, t.width, WIDTH_LABELS)}
    <div class="label">Rôles individuels</div>
    <div class="card" style="margin-top:0">${slots.map((sl, i) => {
      const p = byId.get(uc.lineup[i]);
      if (sl.pos === 'GB' || !p) return '';
      const opts = rolesFor(sl.pos);
      const cur = (uc.roles || [])[i] || 'std';
      return `<div class="formrow"><span><b>${sl.pos}</b> ${esc(p.last)}</span>
        <select data-act="role" data-v="${i}">${opts.map((r) => `<option value="${r}" ${r === cur ? 'selected' : ''}>${ROLES[r].label}</option>`).join('')}</select></div>`;
    }).join('')}
      <p class="muted" style="font-size:12px;margin:6px 0 0">${Object.keys(ROLES).filter((r) => r !== 'std').map((r) => `<b>${ROLES[r].label}</b> : ${ROLES[r].desc}`).join('<br>')}</p></div>
    <div class="label">Coups de pied arrêtés</div>
    <div class="card" style="margin-top:0">${[['corner', 'Corners'], ['fk', 'Coups francs'], ['pen', 'Penaltys']].map(([k, l]) => {
      const cur = (uc.setPieces || {})[k];
      const xi = uc.lineup.map((id) => byId.get(id)).filter((p) => p && p.pos !== 'GB');
      return `<div class="formrow"><span>${l}</span><select data-act="setpiece" data-v="${k}">
        <option value="">Automatique</option>${xi.map((p) => `<option value="${p.id}" ${p.id === cur ? 'selected' : ''}>${esc(p.name)} (${k === 'corner' ? p.attrs.pas : k === 'fk' ? Math.round((p.attrs.tir + p.attrs.sf) / 2) : Math.round((p.attrs.tir + p.attrs.sf) / 2)})</option>`).join('')}</select></div>`;
    }).join('')}</div>
    <div class="label">Remplaçants (${BENCH_SIZE})</div>
    <div class="card list" style="padding:0 10px;margin-top:0">${benchRows.join('')}</div>
    <div class="label">Réserve</div>
    <div class="card list" style="padding:0 10px;margin-top:0">${reserve.map((p) => `<div data-drag="res" data-drop="res" data-v="${p.id}" class="${isSel('res', p.id) ? 'sel' : ''}">${playerRow(p, { act: '', dim: !isAvailable(p) })}</div>`).join('') || '<p class="muted">Personne en réserve.</p>'}</div>`;
}

/* ---------- Échanges ---------- */

function getId(uc, d) {
  if (d.kind === 'slot') return uc.lineup[d.v] ?? null;
  if (d.kind === 'bench') return uc.bench[d.v] ?? null;
  return d.v;
}
function setId(uc, d, id) {
  if (d.kind === 'slot') uc.lineup[d.v] = id;
  else if (d.kind === 'bench') {
    if (id == null) uc.bench.splice(d.v, 1);
    else if (d.v >= uc.bench.length) uc.bench.push(id);
    else uc.bench[d.v] = id;
  }
}
function swap(app, a, b) {
  const s = app.state;
  const uc = userClub(s);
  if (a.kind === b.kind && a.v === b.v) return;
  const ia = getId(uc, a), ib = getId(uc, b);
  // Un joueur indisponible ne peut pas entrer dans le onze.
  const pa = ia != null ? s.players[ia] : null, pb = ib != null ? s.players[ib] : null;
  if ((b.kind === 'slot' && pa && !isAvailable(pa)) || (a.kind === 'slot' && pb && !isAvailable(pb))) {
    app.toast('Joueur indisponible (blessé, suspendu ou prêté).');
    return;
  }
  if (a.kind === 'res' && b.kind === 'res') return;
  // Réserve <-> case : le joueur de la case part en réserve.
  if (a.kind === 'res') { setId(uc, b, ia); }
  else if (b.kind === 'res') { setId(uc, a, ib); }
  else { setId(uc, a, ib); setId(uc, b, ia); }
  uc.bench = uc.bench.filter((id, i, arr) => id != null && !uc.lineup.includes(id) && arr.indexOf(id) === i);
  app.save();
}

export function mount(app, root) {
  let drag = null;
  const desc = (el) => ({ kind: el.dataset.drag || el.dataset.drop, v: el.dataset.drag === 'res' || el.dataset.drop === 'res' ? +el.dataset.v : +el.dataset.v });
  const onDown = (e) => {
    const el = e.target.closest('[data-drag]');
    if (!el || e.button > 0) return;
    drag = { el, src: desc(el), x: e.clientX, y: e.clientY, moved: false, ghost: null, over: null };
  };
  const onMove = (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (!drag.moved && Math.hypot(dx, dy) > 10) {
      drag.moved = true;
      const g = (drag.el.querySelector('.shirt') || drag.el.querySelector('.posb') || drag.el).cloneNode(true);
      g.classList.add('drag-ghost');
      document.body.appendChild(g);
      drag.ghost = g;
    }
    if (drag.moved) {
      e.preventDefault();
      drag.ghost.style.left = e.clientX + 'px';
      drag.ghost.style.top = e.clientY + 'px';
      const t = document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-drop]');
      if (drag.over && drag.over !== t) drag.over.classList.remove('drop-hover');
      if (t && t !== drag.el) { t.classList.add('drop-hover'); drag.over = t; }
    }
  };
  const onUp = (e) => {
    if (!drag) return;
    const d = drag; drag = null;
    if (d.ghost) d.ghost.remove();
    if (d.over) d.over.classList.remove('drop-hover');
    if (d.moved) {
      const t = document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-drop]');
      if (t) { swap(app, d.src, desc(t)); app.ui.tsel = null; app.render(); }
      return;
    }
    // Tap : sélection puis échange au deuxième tap.
    const sel = app.ui.tsel;
    if (sel) {
      app.ui.tsel = null;
      if (!(sel.kind === d.src.kind && sel.v === d.src.v)) swap(app, sel, d.src);
    } else app.ui.tsel = d.src;
    app.render();
  };
  // Tap sur une place libre du banc quand un joueur est sélectionné.
  const onClick = (e) => {
    const t = e.target.closest('[data-drop]:not([data-drag])');
    if (t && app.ui.tsel) { swap(app, app.ui.tsel, desc(t)); app.ui.tsel = null; app.render(); }
  };
  root.addEventListener('click', onClick);
  root.addEventListener('pointerdown', onDown);
  window.addEventListener('pointermove', onMove, { passive: false });
  window.addEventListener('pointerup', onUp);
  // Démontage appelé par app.render() au prochain rendu.
  return () => {
    if (drag?.ghost) drag.ghost.remove();
    root.removeEventListener('click', onClick);
    root.removeEventListener('pointerdown', onDown);
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
  };
}

export const actions = {
  formation(el, app) {
    const uc = userClub(app.state);
    uc.tactics.formation = el.dataset.v;
    uc.roles = [];
    const lu = autoLineup(clubPlayers(app.state, uc), uc.tactics.formation);
    uc.lineup = lu.lineup; uc.bench = lu.bench;
    app.save(); app.render();
  },
  auto(el, app) {
    const uc = userClub(app.state);
    const lu = autoLineup(clubPlayers(app.state, uc), uc.tactics.formation);
    uc.lineup = lu.lineup; uc.bench = lu.bench;
    app.ui.tsel = null;
    app.save(); app.render(); app.toast('Meilleur onze sélectionné.');
  },
  role(el, app) {
    const uc = userClub(app.state);
    uc.roles = uc.roles || [];
    uc.roles[+el.dataset.v] = el.value;
    app.save(); app.toast(`Rôle : ${ROLES[el.value].label}`);
  },
  setpiece(el, app) {
    const uc = userClub(app.state);
    uc.setPieces = uc.setPieces || {};
    uc.setPieces[el.dataset.v] = el.value ? +el.value : null;
    app.save(); app.toast('Tireur enregistré');
  },
  ment(el, app) { setT(app, 'mentality', el.dataset.v); },
  press(el, app) { setT(app, 'pressing', el.dataset.v); },
  tempo(el, app) { setT(app, 'tempo', el.dataset.v); },
  width(el, app) { setT(app, 'width', el.dataset.v); },
};
function setT(app, k, v) { userClub(app.state).tactics[k] = v; app.save(); app.render(); }
