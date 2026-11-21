// Occasions de tir du porteur (diagnostic de la baisse des tirs, étape 5c). Observation seulement.
// Usage : node tools/bench/shot-report.mjs [graines, ex. 100-115 ou 100,101] [racine=.]
//   DT=0.05 pour le pas de 0,05 s (défaut 1/96 s, celui du jeu) · X='{"noturn":1}' (copie d'ablation)
//
// À chaque décision du porteur (decide) à moins de 33 m du but adverse, on relève : la zone (surface
// < 16,5 m, 16,5-25 m, 25-33 m), la pression (adversaire le plus proche), l'xG que le moteur calcule
// pour l'option de frappe, et le geste choisi (execute). On compte aussi les tirs par origine (tête,
// pied, coup franc direct, penalty) et les « séquences » du porteur dans la surface (entrées).
import { fork } from 'node:child_process';
import { timeTo, accelOf, topSpeed } from '../../js/engine/body.js';
import { ballPath } from '../../js/engine/contact.js';
import { predict, cloneBall } from '../../js/ui/ballPhysics.js';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const arg = process.argv[2] || '100-115', root = resolve(process.argv[3] || '.');
const seeds = arg.includes('-') ? (([a, b]) => Array.from({ length: b - a + 1 }, (_, i) => a + i))(arg.split('-').map(Number)) : arg.split(',').map(Number);
const L = 105, W = 68;
if (process.env.WORKER) {
  globalThis.__X = JSON.parse(process.env.X || '{}');
  const { cfgFor, runLive } = await import(pathToFileURL(root + '/tools/bench/common.mjs').href);
  const dt = +(process.env.DT || 1 / 96);
  const T = {}; const add = (k, v = 1) => { T[k] = (T[k] || 0) + v; };
  for (const s of process.env.WORKER.split(',').map(Number)) {
    let cur = null, lastHolder = null, inBox = false, prevPd = null, pendBox = null, lastEnd = null;
    runLive(await cfgFor(s), {
      dt,
      setup(sim) {
        const oD = sim.decide.bind(sim);
        sim.decide = (h, out) => {
          const gx = sim.goalX(h.side), d = Math.hypot(gx - sim.X(h), W / 2 - sim.Y(h));
          if (d >= 33 || (gx - sim.X(h)) * sim.dir(h.side) <= 2) return oD(h, out);
          const z = d < 16.5 ? 'surface' : d < 25 ? '16-25 m' : '25-33 m';
          cur = { z, pr: sim.pressure(h), xg: null, pick: null };
          const prep0 = h.prep;
          const r = oD(h, out);
          // Frappe, passe, centre, dégagement : le geste part après l'armé (h.prep) ; sinon, exécuté tout de suite.
          if (!cur.pick && h.prep && h.prep !== prep0) { const k = h.prep.pick; cur.pick = k.k === 'pass' ? (k.lofted ? 'passe levée' : 'passe') : k.k; }
          if (cur.pick) {
            add('décisions · ' + z); add('pression · ' + z, Math.min(cur.pr, 15));
            if (cur.pr < 1.5) add('pression < 1,5 m · ' + z); else if (cur.pr < 3) add('pression 1,5-3 m · ' + z);
            if (cur.xg != null) { add('option de frappe · ' + z); add('xG option · ' + z, cur.xg); }
            add('choix · ' + z + ' · ' + cur.pick);
          }
          cur = null; return r;
        };
        const oX = sim.xg.bind(sim); sim.xg = (h, kind) => { const v = oX(h, kind); if (cur && kind === 'open' && cur.xg == null) cur.xg = v; return v; };
        const oE = sim.execute.bind(sim); sim.execute = (h, pick, out) => { if (cur && !cur.pick) cur.pick = pick.k === 'pass' ? (pick.lofted ? 'passe levée' : 'passe') : pick.k; return oE(h, pick, out); };
      },
      onStep(sim, m, evs) {
        if (m.phase === 'live' && !sim.restart && !(sim.celebrate > 0) && !(sim.varT > 0)) add('jeu effectif (min)', dt / 60);
        for (const e of evs) if (e.type === 'shot') { add('tirs'); add('tirs@' + s); if (e.kind === 'header') add('têtes@' + s); add('tirs · ' + (e.kind === 'header' ? 'tête' : e.kind === 'penalty' ? 'penalty' : e.kind === 'freekick' ? 'coup franc direct' : 'pied')); }
        const h = sim.holder, pd = sim.pending;
        const boxOf = (side, x, y) => Math.abs(x - sim.goalX(side)) < 16.5 && Math.abs(y - W / 2) < 20.16;
        const fresh = h !== lastHolder, before = lastHolder;
        if (prevPd && prevPd !== pd) lastEnd = { pd: prevPd, t: sim.now };
        if (fresh) { lastHolder = h; inBox = false; if (h) add('possessions individuelles'); }
        if (h && !inBox && boxOf(h.side, sim.X(h), sim.Y(h))) {
          inBox = true; add('porteur dans la surface (séquences)');
          // Comment le ballon est arrivé dans la surface : le porteur y est entré en conduite, ou il l'y a reçu.
          let how;
          if (!fresh) how = 'conduite';
          // (le ballon passe souvent par un premier toucher avant la prise de possession : passe terminée depuis < 1 s)
          else if (lastEnd && sim.now - lastEnd.t < 1 && lastEnd.pd.kind === 'pass' && lastEnd.pd.from?.side === h.side) { const q2 = lastEnd.pd; how = q2.cross ? 'centre' : q2.through ? 'passe en profondeur' : q2.lofted ? 'passe levée' : 'passe au sol'; }
          else if (lastEnd && sim.now - lastEnd.t < 1 && lastEnd.pd.from && lastEnd.pd.from.side !== h.side) how = 'interception';
          else how = before && before.side !== h.side ? 'tacle / duel' : 'ballon libre';
          add('entrée · ' + how);
        }
        // Passes vers la surface : tentées (le ballon part d'en dehors vers un point de la surface) et réussies (un partenaire le reçoit).
        if (pendBox && pendBox.pd === pd && pd.plan) { if (pd.plan.late) pendBox.late = true; else pendBox.ok = true; }
        if (pendBox && pendBox.pd !== pd) {
          const t = sim._lastToucher, k = pendBox.k;
          if (t && t !== pendBox.pd.from && t.side === pendBox.side) add('passes vers la surface réussies · ' + k);
          // Issue : premier joueur à toucher le ballon ; destinataire jugé hors de portée pendant tout le trajet ?
          const res = !t || t === pendBox.pd.from ? 'personne' : t.side === pendBox.side ? 'partenaire' : t.gk ? 'gardien' : 'défenseur';
          add('issue · ' + k + ' · ' + res); if (pendBox.reach) { add('portée · ' + pendBox.reach); add('portée · ' + pendBox.reach + ' · ' + res); if (pendBox.late && !pendBox.ok) add('portée · ' + pendBox.reach + ' · jugé hors de portée'); } if (pendBox.late && !pendBox.ok) add('issue · ' + k + ' · destinataire toujours hors de portée');
          pendBox = null;
        }
        if (pd && pd !== prevPd && pd.kind === 'pass' && pd.from && pd.aim && boxOf(pd.from.side, pd.aim.x, pd.aim.y) && !boxOf(pd.from.side, pd.fromX, pd.fromY)) {
          const k = pd.cross ? 'centre' : pd.through ? 'en profondeur' : pd.lofted ? 'levée' : 'au sol';
          add('passes vers la surface · ' + k); pendBox = { pd, k, side: pd.from.side };
          // Portée réelle du destinataire au départ (modèle 5c validé, réaction 0,18 s) : point de la trajectoire au sol
          // atteignable avec 0,3 m de marge (portée « propre », celle des plans) ou seulement jambe tendue (0,8 m).
          if (k === 'en profondeur') {
            const r = pd.to, pm = { x: sim.X(r), y: sim.Y(r), face: r.face || 0, vx: r.vx || 0, vy: r.vy || 0 }, vit = r.mp?.p?.attrs?.vit ?? 60;
            const o = { vmax: topSpeed({ vit, energy: r.mp?.energy ?? 100, weather: m.wx?.speed || 1 }), acc: accelOf(vit), react: 0.18 };
            const path = ballPath(cloneBall(sim.P), predict, { horizon: 3, step: 0.05 }).filter((q) => q.z < 0.6);
            const ok = (sl) => path.some((q) => timeTo(pm, q.x, q.y, { ...o, slack: sl, tMax: q.t + 0.05 }) <= q.t);
            pendBox.reach = ok(0.3) ? 'propre' : ok(0.8) ? 'jambe tendue seulement' : 'hors de portée';
          }
        }
        prevPd = pd;
      },
    });
    add('matchs');
  }
  process.send(T, () => process.exit(0));
} else {
  const P = Math.min(4, seeds.length);
  const groups = [...Array(P)].map((_, i) => seeds.filter((_, j) => j % P === i));
  const parts = await Promise.all(groups.map((g) => new Promise((res) => { const c = fork(new URL(import.meta.url).pathname, process.argv.slice(2), { env: { ...process.env, WORKER: g.join(',') } }); c.on('message', res); })));
  const T = {}; for (const p of parts) for (const [k, v] of Object.entries(p)) T[k] = (T[k] || 0) + v;
  const n = T.matchs, q = (k) => T[k] || 0, pm = (k) => (q(k) / n).toFixed(2);
  console.log(`${n} matchs, ${root}, pas ${(+(process.env.DT || 1 / 96)).toFixed(4)} s${process.env.X ? ', X=' + process.env.X : ''}`);
  console.log(`tirs ${pm('tirs')} / match (${(90 * q('tirs') / q('jeu effectif (min)')).toFixed(1)} / 90 min effectives) : ` + ['pied', 'tête', 'coup franc direct', 'penalty'].map((k) => `${k} ${pm('tirs · ' + k)}`).join(' · '));
  // Dispersion entre matchs (erreur type de la moyenne) : pour juger un écart entre deux versions.
  const se = (pre) => { const v = seeds.map((x) => q(pre + x)), mu = v.reduce((a, b) => a + b, 0) / v.length; return Math.sqrt(v.reduce((a, b) => a + (b - mu) ** 2, 0) / (v.length - 1) / v.length); };
  console.log(`erreur type de la moyenne : tirs ±${se('tirs@').toFixed(2)} · têtes ±${se('têtes@').toFixed(2)} · par graine : ${seeds.map((x) => q('tirs@' + x)).join(' ')}`);
  console.log(`porteur dans la surface ${pm('porteur dans la surface (séquences)')} séquences / match · possessions individuelles ${pm('possessions individuelles')}`);
  console.log('  entrées dans la surface : ' + Object.entries(T).filter(([k]) => k.startsWith('entrée · ')).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k.slice(9)} ${(v / n).toFixed(2)}`).join(' · '));
  console.log('  passes vers la surface (réussies) : ' + ['au sol', 'en profondeur', 'levée', 'centre'].map((k) => `${k} ${pm('passes vers la surface · ' + k)} (${pm('passes vers la surface réussies · ' + k)})`).join(' · '));
  for (const k of ['en profondeur', 'centre']) console.log(`  issue des passes vers la surface (${k}) : ` + ['partenaire', 'défenseur', 'gardien', 'personne'].map((r) => `${r} ${pm('issue · ' + k + ' · ' + r)}`).join(' · ') + ` · destinataire hors de portée pendant tout le trajet ${pm('issue · ' + k + ' · destinataire toujours hors de portée')}`);
  for (const r of ['propre', 'jambe tendue seulement', 'hors de portée']) console.log(`  passes en profondeur, destinataire à portée ${r} au départ : ${pm('portée · ' + r)} → ` + ['partenaire', 'défenseur', 'gardien', 'personne'].map((x) => `${x} ${pm('portée · ' + r + ' · ' + x)}`).join(' · ') + ` · jugé hors de portée par son plan ${pm('portée · ' + r + ' · jugé hors de portée')}`);
  for (const z of ['surface', '16-25 m', '25-33 m']) {
    const dN = q('décisions · ' + z);
    const picks = Object.entries(T).filter(([k]) => k.startsWith('choix · ' + z + ' · ')).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k.split(' · ')[2]} ${(100 * v / dN).toFixed(1)} %`).join(' · ');
    console.log(`${z.padEnd(8)} décisions ${(dN / n).toFixed(1)} / match · pression moyenne ${(q('pression · ' + z) / dN).toFixed(2)} m · < 1,5 m ${(100 * q('pression < 1,5 m · ' + z) / dN).toFixed(1)} % · 1,5-3 m ${(100 * q('pression 1,5-3 m · ' + z) / dN).toFixed(1)} % · xG de l'option de frappe ${(q('xG option · ' + z) / Math.max(1, q('option de frappe · ' + z))).toFixed(3)} (option offerte ${(100 * q('option de frappe · ' + z) / dN).toFixed(0)} %)`);
    console.log(`         choix : ${picks}`);
  }
}
