// Rapport de diagnostic physique : part des contacts physiquement impossibles par type, et image
// vue de dessus d'une séquence (trajectoires prédites, points d'interception prévus, contacts).
// Usage : node diag-report.mjs [graine=77] [minuteDébut=10] [durée_s=40] [fichier.svg]
import { writeFileSync } from 'node:fs';
import { cfgFor, runLive, L, W } from './common.mjs';
const { Diag } = await import(new URL('../../js/engine/diag.js', import.meta.url).href);
const seed = +(process.argv[2] || 77), m0 = +(process.argv[3] || 10), dur = +(process.argv[4] || 40), svgOut = process.argv[5] || '';
const diag = new Diag({ keep: 1e9 });
let tStart = null, tEnd = null;
const { sim } = runLive(await cfgFor(seed), {
  setup: (s) => { s.diag = diag; },
  onStep: (s, m) => { if (tStart == null && m.minute >= m0) tStart = s.now; if (tStart != null && tEnd == null && s.now > tStart + dur) tEnd = s.now; if (m.minute >= m0 + 10) m.phase = 'ft'; },
});
const by = {};
for (const c of diag.contacts) { const k = c.kind; (by[k] ||= { n: 0, physique: 0, impossible: 0, dist: [] }); by[k].n++; c.physical ? by[k].physique++ : by[k].impossible++; by[k].dist.push(c.dist); }
const med = (a) => a.slice().sort((x, y) => x - y)[Math.floor(a.length / 2)];
console.log('contacts réellement effectués (10 min de jeu) :');
for (const [k, v] of Object.entries(by)) console.log(' ', k.padEnd(14), 'n=' + String(v.n).padEnd(5), 'physiquement possibles', String(Math.round(100 * v.physique / v.n)).padStart(3) + ' %', '  distance médiane au point de contact', med(v.dist).toFixed(2) + ' m');
console.log('interceptions prévues :', diag.plans.length, ' trajectoires :', diag.paths.length);
if (svgOut) {
  const S = 9, X = (x) => (x * S).toFixed(1), Y = (y) => (y * S).toFixed(1);
  const win = (o) => o.t >= tStart && o.t <= tEnd;
  let g = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-10 -10 ${L * S + 20} ${W * S + 60}" width="${L * S + 20}" style="background:#1f6b3a;font:12px sans-serif">`;
  g += `<rect x="0" y="0" width="${L * S}" height="${W * S}" fill="none" stroke="#fff" stroke-opacity=".6"/><line x1="${L * S / 2}" y1="0" x2="${L * S / 2}" y2="${W * S}" stroke="#fff" stroke-opacity=".6"/>`;
  for (const p of diag.paths.filter(win)) g += `<polyline points="${p.pts.map((q) => X(q.x) + ',' + Y(q.y)).join(' ')}" fill="none" stroke="#9ad0ff" stroke-width="${1.5}" stroke-opacity=".7"/>`;
  for (const p of diag.plans.filter(win)) g += `<g stroke="#ffd166" stroke-width="2"><line x1="${+X(p.x) - 6}" y1="${+Y(p.y) - 6}" x2="${+X(p.x) + 6}" y2="${+Y(p.y) + 6}"/><line x1="${+X(p.x) - 6}" y1="${+Y(p.y) + 6}" x2="${+X(p.x) + 6}" y2="${+Y(p.y) - 6}"/></g>`;
  for (const c of diag.contacts.filter(win)) g += `<circle cx="${X(c.x)}" cy="${Y(c.y)}" r="${Math.max(3, c.dist * S)}" fill="${c.physical ? '#3ddc84' : '#ef476f'}" fill-opacity=".35" stroke="${c.physical ? '#3ddc84' : '#ef476f'}"/>`;
  g += `<text x="0" y="${W * S + 25}" fill="#fff">bleu : trajectoire prédite · jaune ✕ : interception prévue · vert : contact physiquement possible · rouge : contact impossible (rayon = distance au point de contact)</text></svg>`;
  writeFileSync(svgOut, g);
  console.log('image :', svgOut);
}
