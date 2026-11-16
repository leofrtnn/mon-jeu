/**
 * Tactique : formation, consignes, compo en glisser-déposer (ou tap-tap), compo auto.
 */
import { userClub, clubPlayers } from '../../game/state.js';
import { FORMATIONS, FORMATION_NAMES, FORMATION_GROUPS, MENTALITIES, MENTALITY_LABELS, LEVELS, PRESSING_LABELS, TEMPO_LABELS, WIDTH_LABELS, positionFit, playerFit, BENCH_SIZE, ROLES, roleFx, rolesFor, DEFAULT_TACTICS, TEAM_INSTRUCTIONS, PLAYER_INSTRUCTIONS, slotsOf, posFromXY } from '../../data/constants.js';
import { autoLineup, ratingAt, isAvailable, overall, lineupStrength } from '../../engine/ratings.js';
import { esc, playerRow, seg, posBadge } from '../components.js';
import { face } from '../images.js';
import { toLocal, localRect, scrollTop } from '../viewport.js';
import { captains } from '../../game/captain.js';
import { today, matchCfgFor } from '../../game/season.js';
import { createMatch } from '../../engine/match.js';
import { tacticalEdge } from '../../engine/tacticalEdge.js';
import { clubById } from '../../game/state.js';
import { crest, gauge, scaleColor } from '../components.js';
import { CORNER_AIMS, FK_AIMS, FK_DIRECT, MARKING, setPlanOf, setPieceEdge, counterRisk } from '../../engine/setPlays.js';
import { bestStaff } from '../../game/career.js';
const stars = (r) => `${Math.round(r)}`;
/** Abréviation du rôle sous le joueur (terrain de la compo). */
const roleShort = (r) => (r && ROLES[r] && r !== 'std' ? ROLES[r].label.replace(/^(Défenseur|Attaquant|Milieu|Latéral|Ailier|Gardien) /, '').replace(/^de l'/, '').replace(/^./, (c) => c.toUpperCase()) : 'Standard');

const TABS = [['team', 'Équipe'], ['analysis', 'Analyse'], ['players', 'Joueurs'], ['squad', 'Compo'], ['sp', 'CPA']];

/** Copie profonde d'un plan tactique. */
const clonePlan = (uc) => JSON.parse(JSON.stringify({ tactics: uc.tactics, roles: uc.roles || [], pi: uc.pi || [], setPieces: uc.setPieces || {}, setPlan: uc.setPlan || null }));

export function render(app) {
  const s = app.state;
  const uc = userClub(s);
  const t = uc.tactics = { ...DEFAULT_TACTICS, ...uc.tactics };
  const players = clubPlayers(s, uc);
  const byId = new Map(players.map((p) => [p.id, p]));
  const slots = slotsOf(t);
  if (!uc.lineup || uc.lineup.length !== 11) { const lu = autoLineup(players, slots); uc.lineup = lu.lineup; uc.bench = lu.bench; }
  const edit = !!app.ui.tEdit;
  const { captain: capId } = captains(s, uc);
  const pitch = slots.map((sl, i) => {
    const p = byId.get(uc.lineup[i]);
    const fit = p ? playerFit(p, sl.pos) : 0;
    const fc = fit >= 1 ? 'var(--good)' : fit >= 0.85 ? 'var(--ok)' : 'var(--bad)';
    return `<div class="slot ${p ? '' : 'empty'} ${edit && sl.pos !== 'GB' ? 'editable' : ''}" data-drag="slot" data-drop="slot" data-v="${i}"
      style="--x:${sl.x.toFixed(3)};--y:${sl.y.toFixed(3)}">
      <div class="tok">${edit ? `<span class="shirt"><small>${sl.pos}</small></span>` : p ? `${face(p, uc)}<em class="num">${p.number}</em><span class="fit" style="background:${fc}"></span>${p.id === capId ? '<span class="armband" title="Capitaine">C</span>' : ''}` : '<span class="shirt">+</span>'}</div>
      <div class="nm">${p ? esc(p.last) : '—'}${p && (!isAvailable(p)) ? ' ✚' : ''}</div>
      <div class="ps">${sl.pos}${p ? ' · ' + stars(ratingAt(p, sl.pos)) : ''}</div>
      ${sl.pos !== 'GB' ? `<div class="rl">${esc(roleShort((uc.roles || [])[i]))}</div>` : ''}
    </div>`;
  }).join('');
  // Terrain entier à l'horizontale (façon FM) : tracés + flèches de mouvement des rôles.
  const PX = (x) => 105 * (0.03 + x * 0.86), PY = (y) => 68 * (0.07 + y * 0.86);
  const arrows = slots.map((sl, i) => {
    const fx = roleFx((uc.roles || [])[i]);
    const dx = (fx.dIn || 0) * 120 + (fx.run ? 5 * fx.run : 0), dy = (0.5 - sl.y) * 68 * (fx.narrow || 0) * 0.9;
    if (Math.hypot(dx, dy) < 3) return '';
    const x0 = PX(sl.x), y0 = PY(sl.y);
    return `<line x1="${x0.toFixed(1)}" y1="${y0.toFixed(1)}" x2="${(x0 + dx).toFixed(1)}" y2="${(y0 + dy).toFixed(1)}" class="${fx.run ? 'run' : ''}" marker-end="url(#tarr)"/>`;
  }).join('');
  const lines = `<svg class="tp-lines" viewBox="0 0 105 68" preserveAspectRatio="none" aria-hidden="true">
    <defs><marker id="tarr" viewBox="0 0 6 6" refX="5" refY="3" markerWidth="4" markerHeight="4" orient="auto"><path d="M0,0 L6,3 L0,6 z" fill="#ffe66b"/></marker></defs>
    <g class="mk"><rect x="1.5" y="1.5" width="102" height="65"/><line x1="52.5" y1="1.5" x2="52.5" y2="66.5"/><circle cx="52.5" cy="34" r="9.15"/><circle cx="52.5" cy="34" r=".6" class="dot"/>
      <rect x="1.5" y="13.85" width="16.5" height="40.3"/><rect x="1.5" y="24.85" width="5.5" height="18.3"/><rect x="87" y="13.85" width="16.5" height="40.3"/><rect x="98" y="24.85" width="5.5" height="18.3"/>
      <circle cx="12.5" cy="34" r=".6" class="dot"/><circle cx="92.5" cy="34" r=".6" class="dot"/>
      <path d="M18 26.7 A9.15 9.15 0 0 1 18 41.3"/><path d="M87 26.7 A9.15 9.15 0 0 0 87 41.3"/></g>
    <g class="arr">${arrows}</g></svg>`;
  const benchIds = (uc.bench || []).slice(0, BENCH_SIZE);
  const benchStrip = Array.from({ length: BENCH_SIZE }, (_, i) => {
    const p = byId.get(benchIds[i]);
    return p ? `<div class="btok ${isAvailable(p) ? '' : 'dim'}" data-drag="bench" data-drop="bench" data-v="${i}">${face(p, uc)}<em class="num">${p.number}</em><small>${esc(p.last)}</small><b>${p.pos}</b></div>`
      : `<div class="btok empty" data-drop="bench" data-v="${i}"><span class="face"></span><small>Libre</small></div>`;
  }).join('');
  const strength = lineupStrength(players, uc.lineup, slots);
  const tab = app.ui.tacTab || 'team';
  let side = '';
  if (tab === 'team') side = teamTab(app, uc, t);
  else if (tab === 'players') side = playersTab(uc, slots, byId);
  else if (tab === 'squad') side = squadTab(uc, players, byId);
  else if (tab === 'analysis') side = analysisTab(app, uc);
  else side = setPiecesTab(uc, byId);
  return `
    <div class="tac-layout"><div class="tac-main">
    <div class="form-pick"><button class="btn sm" data-act="formpick">Système : <b>${t.custom ? 'Perso' : esc(t.formation)}</b> ▾</button>
      <div class="chips">${['4-4-2', '4-3-3', '4-2-3-1', '3-5-2', '4-1-4-1', '3-4-3', '5-3-2'].map((f) => `<button class="chip sm ${f === t.formation && !t.custom ? 'on' : ''}" data-act="formation" data-v="${f}">${f}</button>`).join('')}</div></div>
    <div class="row between" style="margin:8px 2px">
      <small>Force du onze : <b style="color:var(--text)">${strength.toFixed(1)}</b></small>
      <small class="fam" title="Les automatismes se construisent semaine après semaine (plus vite avec un entraînement tactique). Changer de système les fait chuter.">Maîtrise tactique <b style="color:${scaleColor(uc.fam ?? 60)}">${Math.round(uc.fam ?? 60)} %</b></small>
      <button class="btn sm ${edit ? 'primary' : ''}" data-act="editpos" title="Déplacer les postes">✥ ${edit ? 'Terminer' : 'Postes'}</button>
      <button class="btn sm primary" data-act="auto">⚡ Auto</button>
    </div>
    <div class="tpitch ${edit ? 'editing' : ''}" id="tpitch">${lines}${pitch}</div>
    ${edit ? '' : `<div class="bench-strip"><span class="bs-l">Banc</span>${benchStrip}</div>`}
    <p class="muted tac-help">${edit ? 'Mode postes : glissez un joueur pour déplacer son poste (le poste s\'adapte à la zone).' + (t.custom ? ' <a href="#" data-act="resetpos">Revenir à la formation de base</a>' : '') : 'Glissez un joueur sur un autre pour les échanger (terrain, banc, réserve). Touchez un joueur pour voir sa fiche.'}</p>
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

const grip = '<span class="grip" aria-hidden="true">⠿</span>';
function squadTab(uc, players, byId) {
  const benchIds = (uc.bench || []).slice(0, BENCH_SIZE);
  const used = new Set([...uc.lineup, ...benchIds]);
  const reserve = players.filter((p) => !used.has(p.id)).sort((a, b) => overall(b) - overall(a));
  const benchRows = [];
  for (let i = 0; i < BENCH_SIZE; i++) {
    const p = byId.get(benchIds[i]);
    benchRows.push(p
      ? `<div data-drag="bench" data-drop="bench" data-v="${i}" class="benchrow dragrow">${grip}${playerRow(p, { act: '', dim: !isAvailable(p), club: uc })}</div>`
      : `<div data-drop="bench" data-v="${i}" class="prow benchrow" style="justify-content:center;color:var(--muted)">Place libre</div>`);
  }
  return `<div class="label">Remplaçants (${BENCH_SIZE})</div>
    <div class="card list" style="padding:0 10px;margin-top:0">${benchRows.join('')}</div>
    <div class="label">Réserve</div>
    <div class="card list" style="padding:0 10px;margin-top:0">${reserve.map((p) => `<div data-drag="res" data-drop="res" data-v="${p.id}" class="dragrow">${grip}${playerRow(p, { act: '', dim: !isAvailable(p), club: uc })}</div>`).join('') || '<p class="muted">Personne en réserve.</p>'}</div>`;
}

/** Boutons segmentés d'un réglage du plan de CPA (clé « corner.box » …). */
const sseg = (key, opts, cur) => `<div class="seg">${opts.map(([v, l]) => `<button data-act="spp" data-v="${key}:${v}" class="${String(v) === String(cur) ? 'on' : ''}">${esc(l)}</button>`).join('')}</div>`;
const ssel = (key, dict, cur) => `<select data-act="spp" data-v="${key}">${Object.entries(dict).map(([k, v]) => `<option value="${k}" ${k === cur ? 'selected' : ''}>${esc(typeof v === 'string' ? v : v.label)}</option>`).join('')}</select>`;

/** Schéma de la surface : où se placent nos joueurs sur corner, et l'organisation défensive. */
function cpaDiagram(plan) {
  const W = 300, H = 170, gx = W - 14, sx = 6.2, cy = H / 2, sy = 3.0; // mètres -> px (vue de dessus, but à droite)
  const P = (a, b) => [gx - a * sx, cy + b * sy];
  const shift = { near: [0, -3], far: [0, 3], centre: [3, 0] }[plan.corner.aim] || [0, 0];
  const atk = [[6, -3], [8, 3], [11, 0], [5, 6], [13, -6], [9, -7]].slice(0, plan.corner.box).map(([a, b]) => P(a + shift[0], b + shift[1]));
  const dot = ([x, y], c, t = '') => `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="6" fill="${c}" stroke="#fff" stroke-width="1.5"/>${t ? `<text x="${x.toFixed(1)}" y="${(y + 3.5).toFixed(1)}" font-size="8" text-anchor="middle" fill="#fff" font-weight="700">${t}</text>` : ''}`;
  const zones = [[5.5, 0], [5.5, -3.5], [5.5, 3.5], [8.5, -1.5], [8.5, 2.5], [11, 0], [13, -4], [13, 4]];
  const nZone = plan.def.marking === 'zonal' ? 6 : plan.def.marking === 'man' ? 0 : 3;
  const defs = zones.slice(0, nZone).map(([a, b]) => P(a, b));
  const posts = [P(0.6, -3.4), P(0.6, 3.4)].slice(0, plan.def.posts);
  const box = (a, b) => { const [x0, y0] = P(a, -b), [x1, y1] = P(0, b); return `<rect x="${x0}" y="${y0}" width="${x1 - x0}" height="${y1 - y0}" fill="none" stroke="rgba(255,255,255,.55)"/>`; };
  return `<div class="row" style="gap:8px;flex-wrap:wrap">
    <svg viewBox="0 0 ${W} ${H}" style="flex:1 1 260px;max-width:420px;background:#2f6b33;border-radius:10px">
      ${box(16.5, 20.16)}${box(5.5, 9.16)}<line x1="${gx}" y1="0" x2="${gx}" y2="${H}" stroke="rgba(255,255,255,.7)"/>
      <rect x="${gx}" y="${cy - 3.66 * sy}" width="6" height="${7.32 * sy}" fill="rgba(255,255,255,.85)"/>
      <circle cx="${P(11, 0)[0]}" cy="${cy}" r="1.6" fill="#fff"/>
      ${plan.corner.aim === 'short' ? dot(P(2, -24), '#e8b100', 'C') : ''}${plan.corner.lurker || plan.corner.aim === 'low' ? dot(P(19, 4), '#e8b100', 'R') : ''}
      ${atk.map((p) => dot(p, '#d33', '')).join('')}${dot(P(0, -26), '#e8b100', 'T')}
      <text x="8" y="14" font-size="9" fill="#fff">● nos joueurs · T tireur · R rôdeur · C joué à deux</text>
    </svg>
    <svg viewBox="0 0 ${W} ${H}" style="flex:1 1 260px;max-width:420px;background:#2f6b33;border-radius:10px">
      ${box(16.5, 20.16)}${box(5.5, 9.16)}<line x1="${gx}" y1="0" x2="${gx}" y2="${H}" stroke="rgba(255,255,255,.7)"/>
      <rect x="${gx}" y="${cy - 3.66 * sy}" width="6" height="${7.32 * sy}" fill="rgba(255,255,255,.85)"/>
      ${defs.map((p) => dot(p, '#2a6fd6', 'Z')).join('')}${posts.map((p) => dot(p, '#2a6fd6', 'P')).join('')}
      ${Array.from({ length: Math.max(0, 9 - plan.def.up - plan.def.posts - nZone) }, (_, i) => dot(P(7 + (i % 3) * 3, -5 + Math.floor(i / 3) * 6 + (i % 2) * 2), '#6a9de8', 'M')).join('')}
      <text x="8" y="14" font-size="9" fill="#fff">En défense · Z zone · M individuel · P poteau${plan.def.up ? ` · ${plan.def.up} resté(s) devant` : ''}</text>
    </svg></div>`;
}

function setPiecesTab(uc, byId) {
  const xi = uc.lineup.map((id) => byId.get(id)).filter((p) => p && p.pos !== 'GB');
  const plan = setPlanOf(uc.setPlan), cpa = bestStaff(uc, 'setpiece');
  const aerial = (p) => Math.round(p.attrs.phy * 0.6 + p.attrs.tir * 0.2 + p.attrs.def * 0.2);
  const pct = (e) => `${e >= 0 ? '+' : ''}${Math.round(e * 22)} %`;
  const aimNow = plan.corner.aim === 'auto' ? 'centre' : plan.corner.aim;
  const edgeVs = Object.fromEntries(Object.keys(MARKING).map((mk) => [mk, setPieceEdge(plan, setPlanOf({ def: { marking: mk } }), aimNow, cpa)]));
  const planHtml = `<div class="card" style="margin-top:8px">
    <h3>🚩 Entraîneur des CPA</h3>
    <p class="muted" style="margin:0">${cpa ? `Note <b>${cpa}/20</b> : ${cpa >= 14 ? 'routines très travaillées' : cpa >= 10 ? 'routines solides' : 'routines basiques'}.` : 'Aucun : vos coups de pied arrêtés sont moins travaillés. Recrutez-en un dans Club › Staff.'}</p>
  </div>
  <div class="card"><h3>Corners offensifs</h3>
    <div class="formrow"><span>Combinaison</span>${ssel('corner.aim', CORNER_AIMS, plan.corner.aim)}</div>
    <p class="muted" style="font-size:12px;margin:2px 0 8px">${esc(CORNER_AIMS[plan.corner.aim].desc)}</p>
    <div class="label">Joueurs dans la surface</div>${sseg('corner.box', [[3, '3'], [4, '4'], [5, '5'], [6, '6']], plan.corner.box)}
    <div class="label">Rôdeur à l'entrée de la surface (seconds ballons)</div>${sseg('corner.lurker', [[true, 'Oui'], [false, 'Non']], plan.corner.lurker)}
    <p class="muted" style="font-size:12px;margin:6px 0">Restent derrière pour couvrir : <b>${plan.corner.back}</b> joueur(s) · risque de contre ${Math.round(counterRisk(plan, setPlanOf()) * 100)} %.</p>
    <div class="label">Menaces aériennes (visées en priorité, 3 max)</div>
    <div class="chips">${xi.slice().sort((a, b) => aerial(b) - aerial(a)).map((p) => `<button class="chip ${(plan.corner.threats || []).includes(p.id) ? 'on' : ''}" data-act="spthreat" data-v="${p.id}">${esc(p.name)} · ${aerial(p)}</button>`).join('')}</div>
    <p class="muted" style="font-size:12px;margin:8px 0 0">Efficacité de la combinaison face à un marquage ${Object.entries(edgeVs).map(([k, e]) => `${MARKING[k].label.toLowerCase()} <b style="color:${e >= 0 ? 'var(--ok, #2a9d4b)' : 'var(--bad, #d33)'}">${pct(e)}</b>`).join(' · ')}</p>
  </div>
  <div class="card"><h3>Coups francs</h3>
    <div class="formrow"><span>Centre vers</span>${ssel('fk.aim', FK_AIMS, plan.fk.aim)}</div>
    <div class="formrow"><span>Tir direct</span>${ssel('fk.direct', FK_DIRECT, plan.fk.direct)}</div>
  </div>
  <div class="card"><h3>Défense sur CPA</h3>
    <div class="label">Marquage</div>${sseg('def.marking', Object.entries(MARKING).map(([k, v]) => [k, v.label]), plan.def.marking)}
    <p class="muted" style="font-size:12px;margin:4px 0 6px">${esc(MARKING[plan.def.marking].desc)}</p>
    <div class="label">Joueurs aux poteaux</div>${sseg('def.posts', [[0, 'Aucun'], [1, '1'], [2, '2']], plan.def.posts)}
    <div class="label">Laissés devant pour le contre</div>${sseg('def.up', [[0, 'Aucun'], [1, '1'], [2, '2']], plan.def.up)}
  </div>
  <div class="card"><h3>Schéma</h3>${cpaDiagram(plan)}</div>`;
  return planHtml + setPiecesTakers(uc, xi);
}

function setPiecesTakers(uc, xi) {
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
  const desc = (el) => ({ kind: el.dataset.drag || el.dataset.drop, v: +el.dataset.v });
  const landscape = () => document.documentElement.classList.contains('land');
  /** Coordonnées terrain (x profondeur, y latéral) depuis un point écran, selon l'orientation. */
  const toPitch = (cx, cy) => {
    const r = localRect(root.querySelector('#tpitch'));
    ({ x: cx, y: cy } = toLocal(cx, cy));
    const px = ((cx - r.left) / r.width) * 100, py = ((cy - r.top) / r.height) * 100;
    if (landscape()) return { x: (px - 3) / 86, y: (py - 7) / 86 };
    return { x: (94 - py) / 105, y: (px - 8) / 84 };
  };
  const dropAt = (x, y) => {
    if (drag?.ghost) drag.ghost.style.display = 'none';
    const t = document.elementFromPoint(x, y)?.closest('[data-drop]');
    if (drag?.ghost) drag.ghost.style.display = '';
    return t;
  };
  const end = () => {
    if (!drag) return;
    drag.ghost?.remove();
    drag.over?.classList.remove('drop-hover');
    drag.el.classList.remove('dragging');
    drag = null;
  };
  const onDown = (e) => {
    const el = e.target.closest('[data-drag]');
    if (!el || e.button > 0 || drag) return;
    // Listes : au doigt, on saisit le joueur par sa poignée (le reste de la ligne fait défiler la liste).
    if (el.classList.contains('dragrow') && e.pointerType !== 'mouse' && !e.target.closest('.grip, .face, .posb')) return;
    if (app.ui.tEdit) {
      if (el.dataset.drag !== 'slot' || !el.classList.contains('editable')) return;
      e.preventDefault();
      drag = { el, edit: true, i: +el.dataset.v };
      return;
    }
    e.preventDefault();
    drag = { el, src: desc(el), x: e.clientX, y: e.clientY, moved: false, ghost: null, over: null, id: e.pointerId };
  };
  const onMove = (e) => {
    if (!drag || (drag.id != null && e.pointerId !== drag.id)) return;
    if (drag.edit) {
      e.preventDefault();
      const q = toPitch(e.clientX, e.clientY);
      drag.x = Math.max(0.12, Math.min(0.86, q.x)); drag.y = Math.max(0.04, Math.min(0.96, q.y));
      drag.el.style.setProperty('--x', drag.x.toFixed(3)); drag.el.style.setProperty('--y', drag.y.toFixed(3));
      drag.el.querySelector('.shirt small').textContent = posFromXY(drag.x, drag.y, false);
      return;
    }
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (!drag.moved && Math.hypot(dx, dy) > 6) {
      drag.moved = true;
      const src = drag.el.querySelector('.face') || drag.el.querySelector('.shirt') || drag.el;
      const g = src.cloneNode(true);
      g.classList.add('drag-ghost');
      document.body.appendChild(g);
      drag.ghost = g;
      drag.el.classList.add('dragging');
    }
    if (drag.moved) {
      e.preventDefault();
      const q = toLocal(e.clientX, e.clientY); // le jeu peut être pivoté
      drag.ghost.style.left = q.x + 'px';
      drag.ghost.style.top = q.y + 'px';
      const t = dropAt(e.clientX, e.clientY);
      if (drag.over && drag.over !== t) drag.over.classList.remove('drop-hover');
      if (t && t !== drag.el) { t.classList.add('drop-hover'); drag.over = t; } else drag.over = null;
    }
  };
  const onUp = (e) => {
    if (!drag || (drag.id != null && e.pointerId !== drag.id)) return;
    const d = drag;
    if (d.edit) {
      drag = null;
      if (d.x == null) return;
      const uc = userClub(app.state);
      const slots = slotsOf(uc.tactics).map((sl) => ({ ...sl }));
      slots[d.i] = { pos: posFromXY(d.x, d.y, false), x: +d.x.toFixed(3), y: +d.y.toFixed(3) };
      uc.tactics.custom = slots;
      app.save(); app.render();
      return;
    }
    const t = d.moved ? dropAt(e.clientX, e.clientY) : null;
    end();
    if (d.moved) {
      if (t && t !== d.el) { swap(app, d.src, desc(t)); app.render(); }
      return;
    }
    // Simple toucher : fiche du joueur.
    const uc = userClub(app.state);
    const id = getId(uc, d.src);
    if (id != null) import('./playerSheet.js').then((m) => m.showPlayer(app, id));
  };
  const block = (e) => { if (drag) e.preventDefault(); };
  root.addEventListener('pointerdown', onDown);
  window.addEventListener('pointermove', onMove, { passive: false });
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', end);
  window.addEventListener('touchmove', block, { passive: false });
  // Démontage appelé par app.render() au prochain rendu.
  return () => {
    end();
    root.removeEventListener('pointerdown', onDown);
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', end);
    window.removeEventListener('touchmove', block);
  };
}

export const actions = {
  formation(el, app) {
    const uc = userClub(app.state);
    if (uc.tactics.formation !== el.dataset.v || uc.tactics.custom) {
      const before = Math.round(uc.fam ?? 60);
      uc.fam = Math.round(before * 0.55);
      app.toast(`Nouveau système : maîtrise tactique ${before} % → ${uc.fam} %. Les automatismes reviendront avec l'entraînement.`, 3500);
    }
    uc.tactics.formation = el.dataset.v;
    delete uc.tactics.custom;
    uc.roles = []; uc.pi = [];
    const lu = autoLineup(clubPlayers(app.state, uc), slotsOf(uc.tactics));
    uc.lineup = lu.lineup; uc.bench = lu.bench;
    app.save(); app.render();
  },
  noop() {},
  /** Tous les systèmes, par famille, avec un aperçu du placement. */
  formpick(el, app) {
    const uc = userClub(app.state);
    const mini = (f) => `<svg viewBox="0 0 100 64" class="fmini"><rect x="1" y="1" width="98" height="62" rx="4"/>${FORMATIONS[f].map((sl) => `<circle cx="${(4 + sl.x * 92).toFixed(1)}" cy="${(4 + sl.y * 56).toFixed(1)}" r="3.6" class="${sl.pos === 'GB' ? 'gk' : ''}"/>`).join('')}</svg>`;
    const h = app.sheet({
      html: `<h2>Choisir un système</h2>${FORMATION_GROUPS.map(([g, fs]) => `<div class="label">${g}</div><div class="fgrid">${fs.map((f) => `<button class="fcard ${uc.tactics.formation === f && !uc.tactics.custom ? 'on' : ''}" data-act="pickf" data-v="${f}">${mini(f)}<b>${f}</b></button>`).join('')}</div>`).join('')}`,
      actions: { pickf: (b) => { h.close(); actions.formation(b, app); } },
    });
  },
  auto(el, app) {
    const uc = userClub(app.state);
    const lu = autoLineup(clubPlayers(app.state, uc), slotsOf(uc.tactics));
    uc.lineup = lu.lineup; uc.bench = lu.bench;
    app.save(); app.render(); app.toast('Meilleur onze sélectionné.');
  },
  editpos(el, app) { app.ui.tEdit = !app.ui.tEdit; app.render(); },
  resetpos(el, app) { delete userClub(app.state).tactics.custom; app.save(); app.render(); app.toast('Formation de base rétablie.'); },
  ttab(el, app) { app.ui.tacTab = el.dataset.v; app.render(); scrollTop(true); },   // nouvel onglet : on repart du haut
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
  spp(el, app) {
    const uc = userClub(app.state);
    let key, val;
    if (el.tagName === 'SELECT') { key = el.dataset.v; val = el.value; } else [key, val] = el.dataset.v.split(':');
    if (val === 'true' || val === 'false') val = val === 'true'; else if (/^\d+$/.test(val)) val = +val;
    const [g, k] = key.split('.');
    uc.setPlan = uc.setPlan || {}; uc.setPlan[g] = { ...(uc.setPlan[g] || {}), [k]: val };
    app.save(); app.render();
  },
  spthreat(el, app) {
    const uc = userClub(app.state), id = +el.dataset.v;
    uc.setPlan = uc.setPlan || {}; uc.setPlan.corner = { ...(uc.setPlan.corner || {}) };
    const t = (uc.setPlan.corner.threats || []).filter((x) => x !== id);
    if (t.length === (uc.setPlan.corner.threats || []).length) { if (t.length >= 3) { app.toast('3 menaces aériennes maximum'); return; } t.push(id); }
    uc.setPlan.corner.threats = t;
    app.save(); app.render();
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
function setT(app, k, v) {
  const uc = userClub(app.state);
  if (uc.tactics[k] !== v && ['mentality', 'pressing', 'line', 'passing', 'tempo', 'width'].includes(k)) uc.fam = Math.max(0, (uc.fam ?? 60) - 2);
  uc.tactics[k] = v; app.save(); app.render();
}

/**
 * Analyse du prochain match : duel tactique (notre plan contre le plan probable de l'adversaire),
 * points forts / faibles détaillés, et conseils.
 */
function analysisTab(app, uc) {
  const s = app.state;
  const t = today(s);
  const f = t?.userFixture;
  if (!f || f.comp === 'intl') return '<div class="card"><p class="muted">Pas de match officiel à analyser pour le moment.</p></div>';
  let duel;
  try {
    const cfg = matchCfgFor(s, f);
    const m = createMatch(cfg);
    const me = f.h === uc.id ? 0 : 1;
    const a = tacticalEdge(m.teams[me], m.teams[1 - me]), b = tacticalEdge(m.teams[1 - me], m.teams[me]);
    duel = { a, b, opp: m.teams[1 - me], mine: m.teams[me] };
  } catch { return '<div class="card"><p class="muted">Analyse indisponible.</p></div>'; }
  const opp = clubById(s, f.h === uc.id ? f.a : f.h);
  const net = duel.a.edge - duel.b.edge * 0.5;
  const pct = Math.max(0, Math.min(100, 50 + net * 140));
  const verdict = net > 0.06 ? 'Notre plan prend le dessus' : net < -0.06 ? 'Leur plan nous pose problème' : 'Duel tactique équilibré';
  const ot = duel.opp.tactics;
  const notes = (arr, sign) => arr.filter((n) => Math.sign(n.v) === sign).slice(0, 4).map((n) => `<li>${esc(n.text)}</li>`).join('');
  // Notes vues de l'adversaire : on retourne le point de vue (nous ↔ eux).
  const flip = (t) => {
    const W = [['Nous ', '§Ils '], ['Ils ', '§Nous '], ['Notre ', '§Leur '], ['Nos ', '§Leurs '], ['Leur ', '§Notre '], ['Leurs ', '§Nos '], [' notre ', ' §leur '], [' nos ', ' §leurs '], [' leur ', ' §notre '], [' leurs ', ' §nos '], ['les frustre', '§nous frustre'], ['trouvent', '§trouvons']];
    for (const [a, b] of W) t = t.split(a).join(b);
    return t.replace(/§/g, '').replace(/^Nous trouvent/, 'Nous trouvons');
  };
  const theirs = (sign) => duel.b.notes.filter((n) => Math.sign(n.v) === sign).slice(0, 2).map((n) => `<li><small class="muted">Chez eux :</small> ${esc(flip(n.text))}</li>`).join('');
  const good = notes(duel.a.notes, 1) + theirs(-1);
  const bad = notes(duel.a.notes, -1) + theirs(1);
  return `<div class="card"><div class="row" style="gap:10px">${crest(opp, 'sm')}<b class="grow">Prochain adversaire : ${esc(opp.name)}</b></div>
      <small class="muted">Plan probable : ${esc(ot.formation || '')} · ${MENTALITY_LABELS[ot.mentality] || ''} · pressing ${PRESSING_LABELS[ot.pressing] || ''}</small>
      <div class="duel"><span>Nous</span><div class="duel-bar"><i style="width:${pct}%"></i></div><span>Eux</span></div>
      <b style="color:${net > 0.06 ? 'var(--good)' : net < -0.06 ? 'var(--bad)' : 'var(--ok)'}">${verdict}</b></div>
    <div class="card"><h3 style="color:var(--good)">✔ Ce qui joue pour nous</h3><ul class="notes">${good || '<li class="muted">Rien de marquant.</li>'}</ul></div>
    <div class="card"><h3 style="color:var(--bad)">✖ Points de vigilance</h3><ul class="notes">${bad || '<li class="muted">Rien de marquant.</li>'}</ul></div>
    <div class="card"><h3>Automatismes</h3><div class="attr"><span>Maîtrise tactique</span>${gauge(uc.fam ?? 60)}<span class="v">${Math.round(uc.fam ?? 60)}</span></div>
      <small class="muted">De −3 % (système tout neuf) à +1 % de rendement collectif. Un entraînement « Tactique » et un bon adjoint accélèrent la progression.</small></div>`;
}
