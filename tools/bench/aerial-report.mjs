// Ballons aériens dans la surface (diagnostic des tirs de la tête, étape 5c). Observation seulement.
// Usage : node tools/bench/aerial-report.mjs [graines, ex. 100-115 ou 100,101] [racine=.]
//   DT=0.05 pour le pas de 0,05 s (défaut 1/96 s, celui du jeu) · X='{"noturn":1}' (copie d'ablation)
//
// Pour chaque ballon levé (centre, corner, coup franc, passe levée), on prédit sa trajectoire au départ
// (physique réelle du ballon) et on retient les points DANS LA SURFACE adverse à hauteur de tête
// (centre du ballon entre 1,5 m et la hauteur atteinte en sautant). Ce ballon est « jouable ».
// Pour chaque attaquant (joueur de champ du centreur) à moins de 25 m de ces points :
//   - VÉRITÉ PHYSIQUE (mêmes formules pour toutes les versions mesurées) : le modèle cinématique 5c,
//     validé à < 0,08 s contre le mouvement réel, dit s'il peut amener sa tête sur l'un de ces points
//     à temps depuis son état réel au départ du ballon (réaction 0,18 s, portée 0,3 m) ;
//   - ESTIMATION de l'ancienne formule (5b) pour le même point (pour mesurer son optimisme) ;
//   - ce que l'IA a fait : envoyé sur le ballon (destinataire avec un plan à temps, ou « attaque du
//     centre ») ; le ballon a-t-il traversé sa zone de tête ; a-t-il touché le ballon de la tête ;
//     de quelle autre partie du corps.
// Les joueurs sont ensuite classés (voir la sortie). Aucune valeur du moteur n'est modifiée.
import { fork } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { timeTo, accelOf, topSpeed } from '../../js/engine/body.js';
import { timeToReachOld, reachAt, ballPath, jumpGain } from '../../js/engine/contact.js';
import { predict, cloneBall } from '../../js/ui/ballPhysics.js';
const arg = process.argv[2] || '100-115', root = resolve(process.argv[3] || '.');
const seeds = arg.includes('-') ? (([a, b]) => Array.from({ length: b - a + 1 }, (_, i) => a + i))(arg.split('-').map(Number)) : arg.split(',').map(Number);
const L = 105, W = 68;
const TR = (p, k) => !!p?.mp?.p?.traits?.includes(k);
if (process.env.WORKER) {
  globalThis.__X = JSON.parse(process.env.X || '{}');
  const { cfgFor, runLive } = await import(pathToFileURL(root + '/tools/bench/common.mjs').href);
  const dt = +(process.env.DT || 1 / 96);
  const T = {}; const add = (k, v = 1) => { T[k] = (T[k] || 0) + v; };
  for (const s of process.env.WORKER.split(',').map(Number)) {
    let lastRs = null, rsT = -99, rsKind = null, rsEnd = -99, lastPd = null, D = null, heads = [], touches = [], headD = null, headT = -99;
    const posM = (p) => ({ x: p.x * L, y: p.y * W, face: p.face || 0, vx: p.vx || 0, vy: p.vy || 0, speed: Math.hypot(p.vx || 0, p.vy || 0) });
    const close = (sim) => {
      if (!D) return;
      const { A, att } = D;
      add('livraisons'); add('livraisons · ' + D.kind);
      const nTruth = att.filter((a) => a.truth).length, nOld = att.filter((a) => a.old).length;
      add('attaquants en position (vérité)', nTruth); add('attaquants jugés à portée (ancienne formule)', nOld);
      if (nTruth) add('livraisons avec ≥ 1 attaquant en position');
      if (att.some((a) => a.head)) add('livraisons avec tête d\'un attaquant');
      for (const a of att) {
        add('attaquants proches');
        if (a.sent) add('envoyés au ballon (tout geste)');
        if (a.sentHead) add('tentatives de tête (plan de tête)');
        if (a.sentHead && !a.truth) add('tentatives irréalistes (hors de portée physique)');
        if (a.sentHead && !a.truth && a.head) add('  dont tête quand même');
        if (a.sentHead && a.truth) add('tentatives réalistes');
        if (a.sentHead && a.truth && a.head) add('  réalistes → tête');
        if (a.jumped) add('sauts');
        if (a.head) { add('têtes (contact réel)'); add(a.truth ? 'têtes · en position' : 'têtes · hors position au départ'); }
        let c;
        if (a.head) c = 'a joué de la tête';
        else if (a.other) c = 'a joué le ballon d\'une autre partie du corps';
        else if (a.zone) c = a.beaten ? 'ballon dans sa zone de tête, un autre joueur l\'a touché avant' : 'ballon dans sa zone de tête, ne le joue pas (autre action)';
        else if (a.sentHead) c = [...D.touched].some((r) => r !== a.p) ? (a.truth ? 'tête tentée, devancé par un autre joueur (atteignable)' : 'tête tentée, devancé par un autre joueur (inatteignable)') : (a.truth ? 'tête tentée, arrivé trop tard (atteignable)' : 'tête tentée, arrivé trop tard (inatteignable)');
        else if (a.sent) c = a.truth ? 'atteignable, envoyé pour un autre geste (laisser retomber, contrôle)' : 'inatteignable de la tête, envoyé pour un autre geste';
        else if (a.truth) c = a.estOk ? 'atteignable, non envoyé (choix / règles de sélection)' : 'atteignable, mal évalué (estimation de la version : hors de portée)';
        else c = 'inatteignable, non envoyé';
        add('classe · ' + c);
        if (a.truth && !a.head) add('en position sans tête');
      }
      void A; void sim;
      D = null;
    };
    const { m } = runLive(await cfgFor(s), {
      dt,
      setup(sim) {
        const oH = sim.header.bind(sim); sim.header = (r, ...a) => { heads.push(r); return oH(r, ...a); };
        const oC = sim.controlTouch.bind(sim); sim.controlTouch = (r, ...a) => { touches.push(r); return oC(r, ...a); };
        const oG = sim.gkCatch.bind(sim); sim.gkCatch = (r, ...a) => { touches.push(r); return oG(r, ...a); };
        // Fautes (diagnostic) : tentatives de tacle, contacts sur l'homme, vitesse relative et intensité au contact.
        const oS = sim.startTackle.bind(sim); sim.startTackle = (o, kind, ...a) => { add('tacles tentés'); add('tacles tentés · ' + kind); add('vitesse du tacleur à l\'engagement (m/s)', Math.hypot(o.vx || 0, o.vy || 0)); return oS(o, kind, ...a); };
        const oM = sim.tackleMan.bind(sim); sim.tackleMan = (o, k, v, out) => {
          const rel = Math.hypot((o.vx || 0) - (v.vx || 0), (o.vy || 0) - (v.vy || 0)), vs = Math.hypot(v.vx || 0, v.vy || 0);
          const behind = vs > 1.5 && (((sim.X(o) - sim.X(v)) * (v.vx || 0) + (sim.Y(o) - sim.Y(v)) * (v.vy || 0)) / vs) < -0.3;
          const f0 = o.team.stats.fouls; const r = oM(o, k, v, out); const foul = o.team.stats.fouls > f0;
          add('contacts sur l\'homme'); add('contacts sur l\'homme · vitesse relative (m/s)', rel); add('contacts sur l\'homme · vitesse du porteur (m/s)', vs);
          if (behind) add('contacts sur l\'homme · par derrière'); if (k.kind === 'slide') add('contacts sur l\'homme · glissés');
          if (foul) { add('fautes sur tacle'); add('fautes · vitesse relative (m/s)', rel); }
          return r;
        };
      },
      onStep(sim, m2, evs) {
        if (sim.restart && sim.restart !== lastRs) { lastRs = sim.restart; rsKind = sim.restart.kind; rsT = sim.now; rsEnd = -99; if (rsKind === 'corner') add('corners'); }
        // Remise effectivement jouée (fin de la mise en place) : durée de la mise en place d'un corner.
        if (!sim.restart && lastRs && rsEnd < 0) { rsEnd = sim.now; if (rsKind === 'corner') { add('mise en place corner (s)', rsEnd - rsT); add('corners joués'); if (rsEnd - rsT > 8) add('corners joués après 8 s'); } }
        const live = m2.phase === 'live' && !sim.restart && !(sim.celebrate > 0) && !(sim.varT > 0);
        if (live) add('jeu effectif (min)', dt / 60);
        for (const e of evs) {
          if (e.type === 'shot') { add('tirs'); if (e.kind === 'header') { add('tirs de la tête'); if (headD && sim.now - headT < 3) { add('livraisons → tir de la tête'); add('tirs de la tête · ' + headD.kind); headD = null; } } }
          if (e.type === 'cross') add('centres');
        }
        // Contacts de ce pas pour la livraison en cours
        if (D) {
          for (const r of heads) { const a = D.att.find((x) => x.p === r); if (a) { a.head = true; headD = D; headT = sim.now; } else if (r.side !== D.A) D.defHead = true; }
          for (const r of touches) { const a = D.att.find((x) => x.p === r); if (a) a.other = true; }
          for (const r of [...heads, ...touches]) D.touched.add(r);
          const first = heads[0] || touches[0];
          if (first) for (const a of D.att) if (a.p !== first && a.zoneNow) a.beaten = true;
        }
        heads = []; touches = [];
        const pd = sim.pending;
        if (pd !== lastPd) {
          close(sim); lastPd = pd;
          if (pd && (pd.lofted || pd.cross) && pd.from) {
            const A = pd.from.side, gx = sim.goalX(A), P = sim.P;
            const path = ballPath(cloneBall(P), predict, { horizon: 3, step: 0.05 });
            const box = path.filter((q) => Math.abs(q.x - gx) <= 16.5 && Math.abs(q.y - W / 2) <= 20.16 && q.z >= 1.5 && q.z <= 2.75);
            if (box.length) {
              // Origine : la remise qui vient d'être jouée (au moment de la frappe, quelle que soit la durée de mise en place).
              const fromRs = rsEnd >= 0 && sim.now - rsEnd < 1;
              const kind = fromRs && rsKind === 'corner' ? 'corner' : fromRs && rsKind === 'freekick' ? 'coup franc' : pd.cross ? 'centre en jeu' : 'passe levée';
              const att = [];
              for (const p of sim.players.values()) {
                if (p.side !== A || p.gk || p === pd.from) continue;
                const pm = posM(p);
                if (!box.some((q) => Math.hypot(q.x - pm.x, q.y - pm.y) < 25)) continue;
                const vit = p.mp?.p?.attrs?.vit ?? 60, phy = p.mp?.p?.attrs?.phy ?? 60, zTop = 2.05 + jumpGain(phy);
                const vmax = topSpeed({ vit, energy: p.mp?.energy ?? 100, weather: m2.wx?.speed || 1, fusee: TR(p, 'fusee') });
                let truth = false, old = false;
                for (const q of box) {
                  if (q.z > zTop) continue;
                  if (!truth && timeTo(pm, q.x, q.y, { vmax, acc: accelOf(vit), react: 0.18, slack: 0.3, tMax: q.t + 0.05 }) <= q.t) truth = true;
                  if (!old && timeToReachOld(pm, q.x, q.y, { vmax: 6.2 + vit * 0.03, acc: 4.4 + vit * 0.013, react: 0.18, slack: 0.3 }) <= q.t) old = true;
                  if (truth && old) break;
                }
                // Estimation propre à la version mesurée : 5b (et X.oldeta) = ancienne formule, sinon le modèle 5c.
                const estOk = globalThis.__X?.oldeta || root.includes('ref5b') ? old : truth;
                att.push({ p, truth, old, estOk, sent: false, sentHead: false, jumped: false, zone: false, zoneNow: false, head: false, other: false, beaten: false });
              }
              add('ballons levés jouables dans la surface');
              D = { A, kind, att, touched: new Set() };
            } else add('ballons levés non jouables dans la surface');
          }
        }
        if (D && pd) {
          const P = sim.P;
          for (const a of D.att) {
            const p = a.p;
            if (pd.to === p && pd.plan && !pd.plan.late && pd.plan.margin >= 0) { a.sent = true; if (pd.plan.part === 'head') a.sentHead = true; }
            for (const c of pd.cuts || []) if (c.p === p) { a.sent = true; if (c.part === 'head') a.sentHead = true; }
            if ((p.jump || 0) >= 0.45 - dt - 1e-6) a.jumped = true;
            a.zoneNow = false;
            if (P.z >= 1.5) { const r = reachAt(posM(p), P, { phy: p.mp?.p?.attrs?.phy, parts: ['head'] }); if (r) { a.zone = true; a.zoneNow = true; } }
          }
        }
      },
    });
    close();
    for (const t of m.teams) add('fautes', t.stats.fouls);
    add('matchs');
  }
  process.send(T, () => process.exit(0));
} else {
  const P = Math.min(4, seeds.length);
  const groups = [...Array(P)].map((_, i) => seeds.filter((_, j) => j % P === i));
  const parts = await Promise.all(groups.map((g) => new Promise((res) => { const c = fork(new URL(import.meta.url).pathname, process.argv.slice(2), { env: { ...process.env, WORKER: g.join(',') } }); c.on('message', res); })));
  const T = {}; for (const p of parts) for (const [k, v] of Object.entries(p)) T[k] = (T[k] || 0) + v;
  const n = T.matchs, pm = (k) => ((T[k] || 0) / n).toFixed(2);
  console.log(`${n} matchs, ${root}, pas ${(+(process.env.DT || 1 / 96)).toFixed(4)} s${process.env.X ? ', X=' + process.env.X : ''}`);
  console.log(`par match : jeu effectif ${pm('jeu effectif (min)')} min · tirs ${pm('tirs')} · têtes au but ${pm('tirs de la tête')} · centres ${pm('centres')} · corners ${pm('corners')} · fautes ${pm('fautes')}`);
  console.log(`tirs / 90 min de jeu effectif ${(90 * T.tirs / T['jeu effectif (min)']).toFixed(1)} · têtes au but / centre ${(T['tirs de la tête'] / T.centres).toFixed(3)} · têtes au but / ballon jouable ${(T['tirs de la tête'] / T['ballons levés jouables dans la surface']).toFixed(3)}`);
  console.log(`ballons levés jouables dans la surface ${pm('ballons levés jouables dans la surface')} / match (non jouables ${pm('ballons levés non jouables dans la surface')}) : ` + ['corner', 'coup franc', 'centre en jeu', 'passe levée'].map((k) => `${k} ${pm('livraisons · ' + k)}`).join(' · '));
  console.log(`corners joués ${pm('corners joués')} · mise en place moyenne ${(T['mise en place corner (s)'] / T['corners joués']).toFixed(1)} s · joués après 8 s ${(100 * (T['corners joués après 8 s'] || 0) / T['corners joués']).toFixed(0)} % · têtes au but par origine : ` + ['corner', 'coup franc', 'centre en jeu', 'passe levée'].map((k) => `${k} ${pm('tirs de la tête · ' + k)}`).join(' · '));
  console.log(`  avec ≥ 1 attaquant en position ${pm('livraisons avec ≥ 1 attaquant en position')} · avec une tête d'attaquant ${pm('livraisons avec tête d\'un attaquant')} · → tir de la tête ${pm('livraisons → tir de la tête')}`);
  console.log(`attaquants proches (< 25 m) ${pm('attaquants proches')} / match · en position (vérité physique) ${pm('attaquants en position (vérité)')} · jugés à portée par l'ancienne formule ${pm('attaquants jugés à portée (ancienne formule)')}`);
  console.log(`  envoyés au ballon ${pm('envoyés au ballon (tout geste)')} · tentatives de tête ${pm('tentatives de tête (plan de tête)')} : réalistes ${pm('tentatives réalistes')} (→ tête ${pm('  réalistes → tête')}) · irréalistes, hors de portée physique ${pm('tentatives irréalistes (hors de portée physique)')} (→ tête quand même ${pm('  dont tête quand même')}) · sauts ${pm('sauts')}`);
  console.log(`  têtes (contact réel) ${pm('têtes (contact réel)')} : en position au départ ${pm('têtes · en position')} · hors position au départ ${pm('têtes · hors position au départ')}`);
  const q = (k) => T[k] || 0;
  console.log(`fautes : ${pm('fautes')} / match · ${(90 * q('fautes') / q('jeu effectif (min)')).toFixed(1)} / 90 min de jeu effectif · tacles tentés ${pm('tacles tentés')} (glissés ${pm('tacles tentés · slide')}) · vitesse du tacleur ${(q("vitesse du tacleur à l'engagement (m/s)") / q('tacles tentés')).toFixed(2)} m/s`);
  console.log(`  contacts sur l'homme ${pm("contacts sur l'homme")} / match (${(100 * q("contacts sur l'homme") / q('tacles tentés')).toFixed(1)} % des tacles) · sifflés ${(100 * q('fautes sur tacle') / q("contacts sur l'homme")).toFixed(1)} % · vitesse relative ${(q("contacts sur l'homme · vitesse relative (m/s)") / q("contacts sur l'homme")).toFixed(2)} m/s (fautes ${(q('fautes · vitesse relative (m/s)') / q('fautes sur tacle')).toFixed(2)}) · vitesse du porteur ${(q("contacts sur l'homme · vitesse du porteur (m/s)") / q("contacts sur l'homme")).toFixed(2)} m/s · par derrière ${(100 * q("contacts sur l'homme · par derrière") / q("contacts sur l'homme")).toFixed(1)} % · glissés ${(100 * q("contacts sur l'homme · glissés") / q("contacts sur l'homme")).toFixed(1)} %`);
  console.log('classement des attaquants proches (par match) :');
  for (const [k, v] of Object.entries(T).filter(([k]) => k.startsWith('classe · ')).sort((a, b) => b[1] - a[1])) console.log(`  ${(v / n).toFixed(2).padStart(7)}  ${k.slice(9)}`);
}
