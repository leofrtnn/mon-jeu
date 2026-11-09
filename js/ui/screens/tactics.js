/**
 * Tactique : formation, consignes, compo en glisser-déposer (ou tap-tap), compo auto.
 */
import { userClub, clubPlayers } from '../../game/state.js';
import { FORMATIONS, FORMATION_NAMES, MENTALITIES, MENTALITY_LABELS, LEVELS, PRESSING_LABELS, TEMPO_LABELS, WIDTH_LABELS, positionFit, BENCH_SIZE, ROLES, rolesFor, DEFAULT_TACTICS, TEAM_INSTRUCTIONS, PLAYER_INSTRUCTIONS, slotsOf, posFromXY } from '../../data/constants.js';
import { autoLineup, ratingAt, isAvailable, overall, lineupStrength } from '../../engine/ratings.js';
import { esc, playerRow, seg, posBadge } from '../components.js';

const TABS = [['team', 'Équipe'], ['players', 'Joueurs'], ['squad', 'Compo'], ['sp', 'Coups francs']];

/** Copie profonde d'un plan tactique. */
const clonePlan = (uc) => JSON.parse(JSON.stringify({ tactics: uc.tactics, roles: uc.roles || [], pi: uc.pi || [], setPieces: uc.setPieces || {} }));

export function render(app) {
  const s = app.state;
  const uc = userClub(s);
  const t = uc.tactics = { ...DEFAULT_TACTICS, ...uc.tactics };
  const players = clubPlayers(s, uc);
  const byId = new Map(players.map((p) => [p.id, p]));
  const slots = slotsOf(t);
  if (!uc.lineup || uc.lineup.length !== 11) { const lu = autoLineup(players, slots); uc.lineup = lu.lineup; uc.bench = lu.bench; }
  const sel = app.ui.tsel;
  const edit = !!app.ui.tEdit;
  const isSel = (k, v) => sel && sel.kind === k && sel.v === v;
  const pitch = slots.map((sl, i) => {
    const p = byId.get(uc.lineup[i]);
    const fit = p ? positionFit(p.pos, sl.pos) : 0;
    const fc = fit >= 1 ? 'var(--good)' : fit >= 0.85 ? 'var(--ok)' : 'var(--bad)';
    return `<div class="slot ${p ? '' : 'empty'} ${isSel('slot', i) ? 'sel' : ''} ${edit && sl.pos !== 'GB' ? 'editable' : ''}" data-drag="slot" data-drop="slot" data-v="${i}"
      style="--x:${sl.x.toFixed(3)};--y:${sl.y.toFixed(3)}">
      <div class="shirt">${edit ? `<small>${sl.pos}</small>` : p ? p.number : '+'}${p && !edit ? `<span class="fit" style="background:${fc}"></span>` : ''}</div>
      <div class="nm">${p ? esc(p.last) : '—'}${p && (!isAvailable(p)) ? ' ✚' : ''}</div>
      <div class="ps">${sl.pos}${p ? ' · ' + Math.round(ratingAt(p, sl.pos)) : ''}</div>
    </div>`;
  }).join('');
  const strength = lineupStrength(players, uc.lineup, slots);
  const tab = app.ui.tacTab || 'team';
  let side = '';
  if (tab === 'team') side = teamTab(app, uc, t);
  else if (tab === 'players') side = playersTab(uc, slots, byId);
  else if (tab === 'squad') side = squadTab(uc, players, byId, isSel);
  else side = setPiecesTab(uc, byId);
  return `
    <div class="tac-layout"><div class="tac-main">
    <div class="chips" style="margin-top:6px">${FORMATION_NAMES.map((f) => `<button class="chip ${f === t.formation && !t.custom ? 'on' : ''}" data-act="formation" data-v="${f}">${f}</button>`).join('')}
      ${t.custom ? '<button class="chip on" data-act="noop">Perso</button>' : ''}</div>
    <div class="row between" style="margin:8px 2px">
      <small>Force du onze : <b style="color:var(--text)">${strength.toFixed(1)}</b></small>
      <button class="btn sm ${edit ? 'primary' : ''}" data-act="editpos" title="Déplacer les postes">✥ ${edit ? 'Terminer' : 'Postes'}</button>
      <button class="btn sm primary" data-act="auto">⚡ Auto</button>
    </div>
    <div class="tpitch ${edit ? 'editing' : ''}" id="tpitch">${pitch}</div>
    <p class="muted" style="font-size:12px;margin:6px 2px">${edit ? 'Mode postes : glissez un joueur pour déplacer son poste (le poste s\'adapte à la zone).' + (t.custom ? ' <a href="#" data-act="resetpos">Revenir à la formation de base</a>' : '') : 'Glissez un joueur sur un autre pour les échanger (ou touchez-en deux).'}</p>
    </div><div class="tac-side">
      <div class="chips">${TABS.map(([k, l]) => `<button class="chip ${tab === k ? 'on' : ''}" data-act="ttab" data-v="${k}">${l}</button>`).join('')}</div>
      ${side}
    </div></div>`;
}

function teamTab(app, uc, t) {
  const presets = uc.presets || [null, null, null];
  const cur = app.ui.preset ?? 0;
  return `<div class="card" style="margin-top:8px"><h3>Plans tactiques</h3>
      <div class="row" style="gap:6px">${['A', 'B', 'C'].map((l, i) => `<button class="chip ${cur === i ? 'on' : ''}" data-act="preset" data-v="${i}">Plan ${l}${presets[i] ? ' ●' : ''}</button>`).join('')}</div>
      <div class="btns" style="margin-top:8px"><button class="btn sm" data-act="savepreset">Enregistrer ici</button>
        <button class="btn sm" data-act="loadpreset" ${presets[cur] ? '' : 'disabled'}>Charger</button></div>
      ${presets[cur] ? `<small class="muted">${esc(presets[cur].tactics.custom ? 'Formation perso' : presets[cur].tactics.formation)} · ${MENTALITY_LABELS[presets[cur].tactics.mentality]}</small>` : '<small class="muted">Emplacement vide : enregistrez la tactique actuelle (aussi chargeable pendant les matchs).</small>'}
    </div>
    <div class="label">Mentalité</div>${seg('ment', MENTALITIES, t.mentality, MENTALITY_LABELS)}
    <div class="label">Pressing</div>${seg('press', LEVELS, t.pressing, PRESSING_LABELS)}
    <div class="label">Tempo</div>${seg('tempo', LEVELS, t.tempo, TEMPO_LABELS)}
    <div class="label">Largeur</div>${seg('width', LEVELS, t.width, WIDTH_LABELS)}
    ${TEAM_INSTRUCTIONS.map((ti) => `<div class="label">${ti.label}</div>
      <div class="seg">${Object.entries(ti.opts).map(([v, l]) => `<button data-act="ti" data-k="${ti.key}" data-v="${v}" class="${t[ti.key] === v ? 'on' : ''}">${l}</button>`).join('')}</div>
      ${ti.help ? `<small class="muted" style="display:block;margin:4px 2px 0;font-size:11.5px">${ti.help}</small>` : ''}`).join('')}`;
}

function playersTab(uc, slots, byId) {
  return `<p class="muted" style="font-size:12px;margin:8px 2px">Rôle, mission et consignes de chaque titulaire.</p>
    ${slots.map((sl, i) => {
      const p = byId.get(uc.lineup[i]);
      if (!p) return '';
      const pi = (uc.pi || [])[i] || {};
      const roleSel = sl.pos === 'GB' ? '' : `<select data-act="role" data-v="${i}">${rolesFor(sl.pos).map((r) => `<option value="${r}" ${r === ((uc.roles || [])[i] || 'std') ? 'selected' : ''}>${ROLES[r].label}</option>`).join('')}</select>`;
      return `<div class="card pi-card" style="margin:8px 0;padding:10px 12px">
        <div class="row" style="gap:8px">${posBadge(sl.pos)}<b class="grow">${p.number}. ${esc(p.name)}</b>${roleSel}</div>
        ${sl.pos === 'GB' ? '' : `<div class="pi-grid">${PLAYER_INSTRUCTIONS.map((ins) => `<label><small>${ins.label}</small>
          <select data-act="pi" data-s="${i}" data-k="${ins.key}">${Object.entries(ins.opts).map(([v, l]) => `<option value="${v}" ${(pi[ins.key] || ins.def) === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>`).join('')}</div>`}
      </div>`;
    }).join('')}
    <p class="muted" style="font-size:11.5px;margin:6px 2px">${Object.keys(ROLES).filter((r) => r !== 'std').map((r) => `<b>${ROLES[r].label}</b> : ${ROLES[r].desc}`).join('<br>')}</p>`;
}

function squadTab(uc, players, byId, isSel) {
  const benchIds = (uc.bench || []).slice(0, BENCH_SIZE);
  const used = new Set([...uc.lineup, ...benchIds]);
  const reserve = players.filter((p) => !used.has(p.id)).sort((a, b) => overall(b) - overall(a));
  const benchRows = [];
  for (let i = 0; i < BENCH_SIZE; i++) {
    const p = byId.get(benchIds[i]);
    benchRows.push(p
      ? `<div data-drag="bench" data-drop="bench" data-v="${i}" class="benchrow ${isSel('bench', i) ? 'sel' : ''}">${playerRow(p, { act: '', dim: !isAvailable(p) })}</div>`
      : `<div data-drop="bench" data-v="${i}" class="prow benchrow" style="justify-content:center;color:var(--muted)">Place libre</div>`);
  }
  return `<div class="label">Remplaçants (${BENCH_SIZE})</div>
    <div class="card list" style="padding:0 10px;margin-top:0">${benchRows.join('')}</div>
    <div class="label">Réserve</div>
    <div class="card list" style="padding:0 10px;margin-top:0">${reserve.map((p) => `<div data-drag="res" data-drop="res" data-v="${p.id}" class="${isSel('res', p.id) ? 'sel' : ''}">${playerRow(p, { act: '', dim: !isAvailable(p) })}</div>`).join('') || '<p class="muted">Personne en réserve.</p>'}</div>`;
}

function setPiecesTab(uc, byId) {
  const xi = uc.lineup.map((id) => byId.get(id)).filter((p) => p && p.pos !== 'GB');
  return `<div class="card" style="margin-top:8px"><h3>Tireurs désignés</h3>${[['corner', 'Corners', (p) => p.attrs.pas], ['fk', 'Coups francs', (p) => Math.round((p.attrs.tir + p.attrs.sf) / 2)], ['pen', 'Penaltys', (p) => Math.round((p.attrs.tir + p.attrs.sf) / 2)]].map(([k, l, sc]) => {
    const cur = (uc.setPieces || {})[k];
    return `<div class="formrow"><span>${l}</span><select data-act="setpiece" data-v="${k}">
      <option value="">Automatique</option>${xi.slice().sort((a, b) => sc(b) - sc(a)).map((p) => `<option value="${p.id}" ${p.id === cur ? 'selected' : ''}>${esc(p.name)} (${sc(p)})</option>`).join('')}</select></div>`;
  }).join('')}</div>`;
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
  const landscape = () => window.matchMedia('(orientation: landscape) and (min-width: 640px)').matches;
  /** Coordonnées terrain (x profondeur, y latéral) depuis un point écran, selon l'orientation. */
  const toPitch = (cx, cy) => {
    const r = root.querySelector('#tpitch').getBoundingClientRect();
    const px = ((cx - r.left) / r.width) * 100, py = ((cy - r.top) / r.height) * 100;
    if (landscape()) return { x: (px - 5) / 104, y: (py - 6) / 88 };
    return { x: (94 - py) / 105, y: (px - 8) / 84 };
  };
  const onDown = (e) => {
    const el = e.target.closest('[data-drag]');
    if (!el || e.button > 0) return;
    if (app.ui.tEdit) {
      if (el.dataset.drag !== 'slot' || !el.classList.contains('editable')) return;
      e.preventDefault();
      drag = { el, edit: true, i: +el.dataset.v };
      return;
    }
    drag = { el, src: desc(el), x: e.clientX, y: e.clientY, moved: false, ghost: null, over: null };
  };
  const onMove = (e) => {
    if (!drag) return;
    if (drag.edit) {
      e.preventDefault();
      const q = toPitch(e.clientX, e.clientY);
      drag.x = Math.max(0.12, Math.min(0.86, q.x)); drag.y = Math.max(0.04, Math.min(0.96, q.y));
      drag.el.style.setProperty('--x', drag.x.toFixed(3)); drag.el.style.setProperty('--y', drag.y.toFixed(3));
      drag.el.querySelector('.shirt small').textContent = posFromXY(drag.x, drag.y, false);
      return;
    }
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
    if (d.edit) {
      if (d.x == null) return;
      const uc = userClub(app.state);
      const slots = slotsOf(uc.tactics).map((sl) => ({ ...sl }));
      slots[d.i] = { pos: posFromXY(d.x, d.y, false), x: +d.x.toFixed(3), y: +d.y.toFixed(3) };
      uc.tactics.custom = slots;
      app.save(); app.render();
      return;
    }
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
    delete uc.tactics.custom;
    uc.roles = []; uc.pi = [];
    const lu = autoLineup(clubPlayers(app.state, uc), slotsOf(uc.tactics));
    uc.lineup = lu.lineup; uc.bench = lu.bench;
    app.save(); app.render();
  },
  noop() {},
  auto(el, app) {
    const uc = userClub(app.state);
    const lu = autoLineup(clubPlayers(app.state, uc), slotsOf(uc.tactics));
    uc.lineup = lu.lineup; uc.bench = lu.bench;
    app.ui.tsel = null;
    app.save(); app.render(); app.toast('Meilleur onze sélectionné.');
  },
  editpos(el, app) { app.ui.tEdit = !app.ui.tEdit; app.ui.tsel = null; app.render(); },
  resetpos(el, app) { delete userClub(app.state).tactics.custom; app.save(); app.render(); app.toast('Formation de base rétablie.'); },
  ttab(el, app) { app.ui.tacTab = el.dataset.v; app.render(); },
  ti(el, app) { setT(app, el.dataset.k, el.dataset.v); },
  pi(el, app) {
    const uc = userClub(app.state);
    uc.pi = uc.pi || [];
    const i = +el.dataset.s;
    uc.pi[i] = { ...(uc.pi[i] || {}), [el.dataset.k]: el.value };
    app.save();
  },
  preset(el, app) { app.ui.preset = +el.dataset.v; app.render(); },
  savepreset(el, app) {
    const uc = userClub(app.state);
    uc.presets = uc.presets || [null, null, null];
    uc.presets[app.ui.preset ?? 0] = clonePlan(uc);
    app.save(); app.render(); app.toast(`Plan ${'ABC'[app.ui.preset ?? 0]} enregistré.`);
  },
  loadpreset(el, app) {
    const uc = userClub(app.state);
    const pl = (uc.presets || [])[app.ui.preset ?? 0];
    if (!pl) return;
    const before = JSON.stringify(slotsOf(uc.tactics).map((x) => x.pos));
    Object.assign(uc, JSON.parse(JSON.stringify(pl)));
    if (JSON.stringify(slotsOf(uc.tactics).map((x) => x.pos)) !== before) {
      const lu = autoLineup(clubPlayers(app.state, uc), slotsOf(uc.tactics));
      uc.lineup = lu.lineup; uc.bench = lu.bench;
    }
    app.save(); app.render(); app.toast(`Plan ${'ABC'[app.ui.preset ?? 0]} chargé.`);
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
