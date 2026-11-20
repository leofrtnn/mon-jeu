// Marquage (étape 5a) : continuité des intentions de marquage, interruptions, distance selon le
// temps depuis le début du marquage et selon la vitesse de l'attaquant marqué.
// Usage : node tools/bench/mark-report.mjs [racine=.] [graines=100-103]. Observation seulement.
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const root = resolve(process.argv[2] || '.');
const [s0, s1] = (process.argv[3] || '100-103').split('-').map(Number);
const { cfgFor, createMatch, LiveSim, L, W } = await import(pathToFileURL(root + '/tools/bench/common.mjs').href);
const arbEngine = !!LiveSim.prototype.resolveIntents;
const med = (a) => { const s = a.filter(Number.isFinite).sort((x, y) => x - y); return s.length ? s[s.length >> 1] : NaN; };
const f2 = (x) => (Number.isFinite(x) ? x.toFixed(2) : '—');
const S = { d: [], byT: {}, byV: {}, it: {}, eps: [], tgtA: [], plTgt: [], switchMark: 0, n: 0 }; const dt = 1 / 96;
for (let seed = s0; seed <= s1; seed++) {
  const m = createMatch(await cfgFor(seed)); const sim = new LiveSim(m); const ep = new Map();
  for (let k = 0; k < 2_000_000 && m.phase !== 'ft'; k++) {
    sim.step(dt); if (m.phase === 'ht') sim.resumeHT = true;
    const live = m.phase === 'live' && !sim.restart && sim.celebrate <= 0;
    for (const p of sim.players.values()) {
      let e = ep.get(p);
      const on = live && p.role === 'mark' && p._markOf != null;
      if (e && (!on || p._markOf !== e.of)) { e.dur = sim.now - e.t0; S.eps.push(e); ep.delete(p); e = null; }
      if (!on) continue;
      if (!e) { e = { t0: sim.now, of: p._markOf, ticks: 0, notMark: 0, its: {} }; ep.set(p, e); }
      e.ticks++;
      const it = arbEngine ? (p._intent ? `P${p._intent.pri} ${p._intent.src}` : '—') : 'tx direct';
      if (arbEngine && p._intent?.src !== 'marquage') { e.notMark++; e.its[it] = (e.its[it] || 0) + 1; }
      if (k % 24) continue;
      const a = sim.players.get(p._markOf); if (!a) continue;
      const d = sim.dist(p, sim.X(a), sim.Y(a)), t = sim.now - e.t0, va = a.speed || 0;
      S.d.push(d); S.it[it] = (S.it[it] || 0) + 1; S.n++;
      const tb = t < 0.5 ? '0-0,5 s' : t < 1 ? '0,5-1 s' : t < 2 ? '1-2 s' : t < 4 ? '2-4 s' : '> 4 s'; (S.byT[tb] ||= []).push(d);
      const vb = va < 2 ? 'marche (< 2)' : va < 4 ? 'trot (2-4)' : va < 5.5 ? 'course (4-5,5)' : 'sprint (> 5,5)'; (S.byV[vb] ||= { d: [], lag: [], sp: [] }).d.push(d);
      S.byV[vb].lag.push(Math.hypot((p.tx - p.x) * L, (p.ty - p.y) * W)); S.byV[vb].sp.push((p.speed || 0) - va);
      S.tgtA.push(Math.hypot(p.tx * L - sim.X(a), p.ty * W - sim.Y(a)));
    }
  }
}
console.log(`${root}\nmarquage : distance au joueur marqué ${f2(med(S.d))} m (médiane, n=${S.d.length}) · cible → attaquant ${f2(med(S.tgtA))} m`);
console.log(`épisodes de marquage : ${S.eps.length} · durée médiane ${f2(med(S.eps.map((e) => e.dur)))} s`);
if (arbEngine) {
  const T = S.eps.reduce((s, e) => s + e.ticks, 0), N = S.eps.reduce((s, e) => s + e.notMark, 0), inter = S.eps.filter((e) => e.notMark > 0).length;
  const its = {}; S.eps.forEach((e) => Object.entries(e.its).forEach(([k, v]) => { its[k] = (its[k] || 0) + v; }));
  console.log(`continuité : intention « marquage » retenue ${(100 * (1 - N / T)).toFixed(1)} % du temps de marquage · épisodes interrompus au moins une fois ${(100 * inter / S.eps.length).toFixed(1)} %`);
  console.log('   interruptions par :', Object.entries(its).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, v]) => `${k} ${(100 * v / T).toFixed(2)} %`).join(' · '));
}
console.log('distance selon le temps depuis le début du marquage :', Object.entries(S.byT).map(([k, v]) => `${k} ${f2(med(v))} m (${(100 * v.length / S.d.length).toFixed(0)} %)`).join(' · '));
console.log('selon l\'allure de l\'attaquant marqué : distance · retard du marqueur sur sa cible · vitesse marqueur − attaquant');
for (const k of ['marche (< 2)', 'trot (2-4)', 'course (4-5,5)', 'sprint (> 5,5)']) { const v = S.byV[k]; if (v) console.log(`   ${k.padEnd(15)} ${f2(med(v.d))} m · ${f2(med(v.lag))} m · ${f2(med(v.sp))} m/s (${(100 * v.d.length / S.d.length).toFixed(0)} %)`); }
