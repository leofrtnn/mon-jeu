/**
 * Graphiques de match en SVG : xG cumulés minute par minute, carte de chaleur.
 */
import { esc } from './components.js';

/** xG cumulés des deux équipes (lignes en escalier), buts marqués d'un rond. */
export function xgChart(m, colors, names) {
  const W = 320, H = 130, P = 22;
  const end = Math.max(90, m.minute + (m.extra || 0));
  const X = (min) => P + (min / end) * (W - P - 6);
  const tl = m.xgTimeline.map((e) => ({ ...e, t: Math.min(end, e.minute + (e.extra || 0) * 0.5) }));
  const tot = [0, 0];
  for (const e of tl) tot[e.side] += e.xg;
  const max = Math.max(1, tot[0], tot[1]) * 1.1;
  const Y = (v) => H - P - (v / max) * (H - P - 8);
  const lines = [0, 1].map((side) => {
    let acc = 0, d = `M${X(0)},${Y(0)}`;
    const dots = [];
    for (const e of tl.filter((x) => x.side === side)) {
      d += ` L${X(e.t)},${Y(acc)}`;
      acc += e.xg;
      d += ` L${X(e.t)},${Y(acc)}`;
      if (e.goal) dots.push(`<circle cx="${X(e.t)}" cy="${Y(acc)}" r="4.5" fill="${colors[side]}" stroke="#fff" stroke-width="1.5"/>`);
    }
    d += ` L${X(end)},${Y(acc)}`;
    return `<path d="${d}" fill="none" stroke="${colors[side]}" stroke-width="2.5" stroke-linejoin="round"/>${dots.join('')}`;
  }).join('');
  const ticks = [0, 15, 30, 45, 60, 75, 90, 105, 120].filter((t) => t <= end)
    .map((t) => `<line x1="${X(t)}" x2="${X(t)}" y1="8" y2="${H - P}" stroke="#2a313c"/><text x="${X(t)}" y="${H - 6}" fill="#8b949e" font-size="9" text-anchor="middle">${t}'</text>`).join('');
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="xG cumulés">
    ${ticks}<text x="4" y="14" fill="#8b949e" font-size="9">xG</text>${lines}</svg>
    <div class="row between" style="font-size:12px"><span style="color:${colors[0]}">● ${esc(names[0])} ${tot[0].toFixed(2)}</span><span style="color:${colors[1]}">${esc(names[1])} ${tot[1].toFixed(2)} ●</span></div>`;
}

/** Carte de chaleur des zones occupées par le ballon quand l'équipe l'a (attaque vers la droite). */
export function heatmap(m, side, color) {
  const cells = m.heat[side];
  const max = Math.max(1, ...cells);
  const W = 156, H = 101;
  let rects = '';
  for (let c = 0; c < 12; c++) for (let r = 0; r < 8; r++) {
    const v = cells[c * 8 + r] / max;
    if (v < 0.04) continue;
    const cc = side === 0 ? c : 11 - c, rr = side === 0 ? r : 7 - r;
    rects += `<rect x="${(cc * W) / 12}" y="${(rr * H) / 8}" width="${W / 12 + 0.5}" height="${H / 8 + 0.5}" fill="${color}" opacity="${(0.15 + v * 0.8).toFixed(2)}"/>`;
  }
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" style="background:#1f6b3a;border-radius:8px">
    ${rects}
    <g fill="none" stroke="rgba(255,255,255,.6)" stroke-width="1"><rect x="1" y="1" width="${W - 2}" height="${H - 2}"/><line x1="${W / 2}" y1="1" x2="${W / 2}" y2="${H - 1}"/>
    <circle cx="${W / 2}" cy="${H / 2}" r="13"/><rect x="1" y="${H / 2 - 30}" width="24" height="60"/><rect x="${W - 25}" y="${H / 2 - 30}" width="24" height="60"/></g>
    <path d="M${W - 18} 8 l10 0 m-4 -4 l4 4 l-4 4" stroke="#fff" fill="none" stroke-width="1.5"/></svg>`;
}
