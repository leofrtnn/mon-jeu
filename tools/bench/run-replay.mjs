// Replay comparatif des appels (étape 5a) : chaque appel (rôle « run ») suivi pas à pas —
// point proposé, intention retenue, cible effective, vitesse, allure, distance à la ligne,
// durée, raison de fin. Usage : node tools/bench/run-replay.mjs [racine=.] [graines=100-103] [exemples=3]
// Observation seulement (aucun hasard consommé).
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const root = resolve(process.argv[2] || '.');
const [s0, s1] = (process.argv[3] || '100-103').split('-').map(Number), NEX = +(process.argv[4] || 3);
const { cfgFor, createMatch, LiveSim, L, W } = await import(pathToFileURL(root + '/tools/bench/common.mjs').href);
const arbEngine = !!LiveSim.prototype.resolveIntents;
// Point proposé : sortie du placement collectif (brouillon après 5a, cible écrite avant 5a).
const pos0 = LiveSim.prototype.positioning;
LiveSim.prototype.positioning = function () {
  pos0.call(this);
  for (const p of this.players.values()) if (p.role === 'run' || p.role === 'hold') p._prop = arbEngine ? { x: p.ptx, y: p.pty } : { x: p.tx, y: p.ty }; else p._prop = null;
};
if (!arbEngine) { const st0 = LiveSim.prototype.steadyTargets; LiveSim.prototype.steadyTargets = function () { for (const p of this.players.values()) if (!p.role) p._raw = { x: p.tx, y: p.ty }; return st0.call(this); }; }
const pace = (v) => (v < 2 ? 'marche' : v < 4 ? 'trot' : v < 5.5 ? 'course' : 'sprint');
const eps = [], ex = [], posts = []; const dt = 1 / 96;
for (let seed = s0; seed <= s1; seed++) {
  const m = createMatch(await cfgFor(seed)); const sim = new LiveSim(m); const open = new Map(), post = new Map();
  for (let k = 0; k < 2_000_000 && m.phase !== 'ft'; k++) {
    const live0 = m.phase === 'live' && !sim.restart;
    sim.step(dt); if (m.phase === 'ht') sim.resumeHT = true;
    const live = m.phase === 'live' && !sim.restart && sim.celebrate <= 0;
    for (const p of sim.players.values()) {
      let e = open.get(p);
      const isRun = live && p.role === 'run' && sim.poss === p.side;
      if (e && !isRun) {
        e.end = !live ? 'arrêt de jeu' : sim.poss !== p.side ? 'perte du ballon' : p === sim.holder ? 'reçoit le ballon (porteur)' : p === sim.pending?.to ? 'destinataire d\'une passe' : p.role === 'hold' ? 'cycle : retour à la limite du hors-jeu' : p.role ? 'nouveau rôle : ' + p.role : 'plus choisi pour l\'appel (formation)';
        e.dur = sim.now - e.t0; eps.push(e); open.delete(p); if (ex.length < NEX && e.frames.length > 40) ex.push(e);
        if (!e.goRun && live && sim.poss === p.side && !p.role) post.set(p, { t0: sim.now, frames: [] });
        e = null;
      }
      const po = post.get(p);
      if (po) {
        if (!live || sim.poss !== p.side || p.role || sim.now - po.t0 > 3) { posts.push(po); post.delete(p); }
        else { const dir = sim.dir(p.side), line = sim.list(1 - p.side).map((q) => sim.X(q) * dir).sort((a, b) => b - a)[1];
          po.frames.push({ t: sim.now - po.t0, tgt: p.tx * L * dir - line, gap: sim.X(p) * dir - line, vfw: (p.vx || 0) * dir, sp: p.speed || 0, prop: arbEngine ? p.ptx * L * dir - line : p._raw ? p._raw.x * L * dir - line : null }); }
      }
      if (!isRun) continue;
      const dir = sim.dir(p.side);
      const defs = sim.list(1 - p.side).map((q) => sim.X(q) * dir).sort((a, b) => b - a), line = defs[1];
      if (!e) { e = { seed, pid: p.mp.id, t0: sim.now, goRun: !!p.goRun, frames: [], line0: line, gap0: sim.X(p) * dir - line, sp0: p.speed || 0 }; open.set(p, e); }
      const t = sim.now - e.t0, sp = p.speed || 0, vfw = (p.vx || 0) * dir;
      const it = arbEngine ? (p._intent ? `P${p._intent.pri} ${p._intent.src}` : '—') : 'tx direct';
      e.frames.push({ t, prop: p._prop ? p._prop.x * L * dir - line : null, tgt: p.tx * L * dir - line, gap: sim.X(p) * dir - line, sp, vfw, it, line: line - e.line0,
        dTgt: Math.hypot((p.tx - p.x) * L, (p.ty - p.y) * W), turn: p.turnGap || 0, face: Math.cos((p.face || 0) - Math.atan2(p.vy || 0, p.vx || 0)), acc: p.acc || 0 });
    }
  }
}
// --- Agrégats ---
const med = (a) => { const s = a.filter((x) => x != null && Number.isFinite(x)).sort((x, y) => x - y); return s.length ? s[s.length >> 1] : NaN; };
const f2 = (x) => (Number.isFinite(x) ? x.toFixed(2) : '—');
const struct = eps.filter((e) => !e.goRun), gr = eps.filter((e) => e.goRun);
console.log(`${root}\n${eps.length} appels (${struct.length} appels collectifs, ${gr.length} une-deux), graines ${s0}-${s1}`);
for (const [name, E] of [['appels collectifs', struct], ['une-deux', gr]]) {
  if (!E.length) continue;
  console.log(`\n== ${name} : durée médiane ${f2(med(E.map((e) => e.dur)))} s · écart à la ligne au départ ${f2(med(E.map((e) => e.gap0)))} m · à la fin ${f2(med(E.map((e) => e.frames.at(-1).gap)))} m · vitesse au départ ${f2(med(E.map((e) => e.sp0)))} m/s`);
  console.log('   progrès vers l\'avant du joueur', f2(med(E.map((e) => e.frames.at(-1).gap - e.gap0 + e.frames.at(-1).line))), 'm · recul de la ligne', f2(med(E.map((e) => -e.frames.at(-1).line))), 'm');
  // Profil temporel.
  console.log('   t (s)     | point proposé | cible | joueur | vitesse | vers l\'avant | écart cible | accél. | allure dominante');
  for (const [a, b] of [[0, 0.25], [0.25, 0.5], [0.5, 1], [1, 1.5], [1.5, 2], [2, 3], [3, 5]]) {
    const F = E.flatMap((e) => e.frames.filter((q) => q.t >= a && q.t < b)); if (!F.length) continue;
    const pc = {}; F.forEach((q) => { pc[pace(q.sp)] = (pc[pace(q.sp)] || 0) + 1; });
    const dom = Object.entries(pc).sort((x, y) => y[1] - x[1]).map(([k, v]) => `${k} ${Math.round(100 * v / F.length)} %`).slice(0, 2).join(', ');
    console.log(`   ${a.toFixed(2)}-${b.toFixed(2)} | ${f2(med(F.map((q) => q.prop))).padStart(13)} | ${f2(med(F.map((q) => q.tgt))).padStart(5)} | ${f2(med(F.map((q) => q.gap))).padStart(6)} | ${f2(med(F.map((q) => q.sp))).padStart(7)} | ${f2(med(F.map((q) => q.vfw))).padStart(12)} | ${f2(med(F.map((q) => q.dTgt))).padStart(11)} | ${f2(med(F.map((q) => q.acc))).padStart(6)} | ${dom}`);
  }
  const its = {}; E.forEach((e) => e.frames.forEach((q) => { its[q.it] = (its[q.it] || 0) + 1; })); const nF = E.reduce((s, e) => s + e.frames.length, 0);
  console.log('   intention retenue :', Object.entries(its).sort((x, y) => y[1] - x[1]).slice(0, 5).map(([k, v]) => `${k} ${(100 * v / nF).toFixed(1)} %`).join(' · '));
  const ends = {}; E.forEach((e) => { ends[e.end] = (ends[e.end] || 0) + 1; });
  console.log('   raison de fin :', Object.entries(ends).sort((x, y) => y[1] - x[1]).map(([k, v]) => `${k} ${(100 * v / E.length).toFixed(0)} %`).join(' · '));
}
console.log(`\n== après un appel collectif (retour en formation, ${posts.length} cas) : place tactique proposée · cible effective · joueur · vitesse vers l'avant ==`);
for (const [a, b] of [[0, 0.1], [0.1, 0.5], [0.5, 1], [1, 1.5], [1.5, 2], [2, 3]]) {
  const F = posts.flatMap((e) => e.frames.filter((q) => q.t >= a && q.t < b)); if (!F.length) continue;
  console.log(`   ${a.toFixed(2)}-${b.toFixed(2)} s | proposée ${f2(med(F.map((q) => q.prop))).padStart(7)} | cible ${f2(med(F.map((q) => q.tgt))).padStart(7)} | joueur ${f2(med(F.map((q) => q.gap))).padStart(7)} | vers l'avant ${f2(med(F.map((q) => q.vfw))).padStart(6)} m/s | vitesse ${f2(med(F.map((q) => q.sp)))} (n=${F.length})`);
}
console.log('\n== exemples (image par image, toutes les 0,1 s ; distances par rapport à l\'avant-dernier défenseur, + = au-delà) ==');
for (const e of ex) {
  console.log(`graine ${e.seed} joueur ${e.pid} à ${e.t0.toFixed(1)} s, ${e.goRun ? 'une-deux' : 'appel collectif'}, durée ${e.dur.toFixed(2)} s, fin : ${e.end}`);
  for (const q of e.frames.filter((_, i) => i % 10 === 0)) console.log(`   t=${q.t.toFixed(2)} proposé ${f2(q.prop).padStart(6)} cible ${f2(q.tgt).padStart(6)} joueur ${f2(q.gap).padStart(6)} v ${q.sp.toFixed(1)} (${pace(q.sp)}) avant ${q.vfw.toFixed(1)} ligne ${q.line >= 0 ? '+' : ''}${q.line.toFixed(1)} | ${q.it}`);
}
