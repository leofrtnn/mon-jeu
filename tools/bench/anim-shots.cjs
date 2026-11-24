/**
 * Captures avant / après (étape 6b) : au même instant de jeu (image du contact physique d'un geste
 * migré), le même joueur filmé de près, une fois avec l'ancien rendu (anciens indicateurs, même
 * différé) et une fois avec le contrat (gestes synchronisés + cinématique inverse au contact).
 * Usage : node tools/bench/anim-shots.cjs [dossier=./captures-6b] [paires=6]
 *   RES=1 : cas résiduels défavorables classés par la sonde (une image au contact, contrat seulement) ;
 *   AIR=1 : gestes aériens (6c-A) — avec RES : cas classés par la sonde aérienne (tête, tête perdue,
 *           contrôles hauts, cas défavorables), avant / après ; avec SEQ : séquence autour d'un coup de tête ;
 *   SEQ=1 : séquences autour du contact (−0,24 s à +0,24 s, toutes les 0,04 s) des gestes avec pivot
 *           d'affichage, caméra fixe de côté puis caméra de jeu (télé).
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium, devices } = require('playwright');

const ROOT = path.join(__dirname, '..', '..');
const OUT = path.resolve(process.argv[2] || 'captures-6b'), PAIRS = +(process.argv[3] || 6);
fs.mkdirSync(OUT, { recursive: true });
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png' };
const serve = () => new Promise((resolve) => {
  const srv = http.createServer((req, res) => {
    const url = decodeURIComponent(req.url.split('?')[0]);
    const file = path.join(ROOT, url === '/' ? 'index.html' : url);
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  srv.listen(0, () => resolve(srv));
});

(async () => {
  const srv = await serve();
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ ...devices['Desktop Chrome'], viewport: { width: 1280, height: 720 }, deviceScaleFactor: 2 });
  await ctx.addInitScript(() => { try { localStorage.setItem('cdp-tuto', JSON.stringify({ done: true })); } catch {} });
  await ctx.route(/wikipedia\.org|wikimedia\.org|flagcdn/, (r) => r.abort());
  // SEED=n : Math.random de la page fixé (création de la partie, choix d'affichage) — le même match est
  // rejoué à chaque passe, pour comparer les MÊMES gestes avant / après une correction de rendu.
  if (process.env.SEED) await ctx.addInitScript((seed) => { const realNow = Date.now.bind(Date); window.__freezeNow = true; Date.now = () => (window.__freezeNow ? 1767225600000 + seed * 1000 : realNow()); let a = seed >>> 0; Math.random = () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }, +process.env.SEED);
  const page = await ctx.newPage();
  try {
    await page.goto(`http://localhost:${srv.address().port}/?backend=local`);
    await page.click('[data-act=amode][data-v=signup]');
    await page.fill('input[name=username]', 'Sonde'); await page.fill('input[name=email]', 'sonde@exemple.fr'); await page.fill('input[name=password]', 'motdepasse');
    await page.click('[data-act=asubmit]');
    await page.click('[data-act=new][data-v="1"]');
    await page.waitForSelector('.sheet [data-act=go]', { timeout: 60000 }); await page.click('.sheet [data-act=go]');
    await page.waitForSelector('[data-act=div][data-v="5"]'); await page.click('[data-act=div][data-v="5"]');
    await page.click('.club-card >> nth=3'); await page.click('.sheet [data-act=take]');
    await page.waitForSelector('.sheet #c-fn'); await page.fill('.sheet #c-fn', 'Coach'); await page.fill('.sheet #c-ln', 'Sonde');
    for (let i = 0; i < 8 && !(await page.isVisible('.sheet [data-act=ok]')); i++) await page.click('.sheet [data-act=next]');
    await page.click('.sheet [data-act=ok]');
    await page.waitForSelector('[data-act=psmeeting]'); await page.click('[data-act=psmeeting]');
    await page.click('.sheet [data-act=ch][data-v=accept]'); await page.click('.sheet [data-act=ok]');
    await page.click('[data-act=pscamp][data-v=alps]'); await page.click('[data-act=psint][data-v=hard]');
    for (let i = 0; i < 12 && !(await page.isEnabled('[data-act=psstart]')); i++) await page.click('[data-act=psday][data-v="3"]');
    await page.click('[data-act=psstart]');
    await page.waitForSelector('[data-act=play], [data-act=simulate]');
    if (!(await page.$('[data-act=play]'))) { await page.click('[data-act=simulate] >> nth=0'); await page.waitForSelector('.sheet [data-act=close]', { timeout: 30000 }); await page.click('.sheet [data-act=close]'); }
    await page.waitForSelector('[data-act=play]'); await page.click('[data-act=play]'); await page.click('[data-act=go]');
    await page.waitForFunction(() => window.__view?.live?.m?.phase === 'live', null, { timeout: 60000 });
    await page.evaluate(() => { window.__view.hlWant = () => true; });
    await page.waitForTimeout(4000);   // chargement terminé, jeu lancé
    if (process.env.SEED) await page.evaluate(() => { window.__freezeNow = false; });
    await page.evaluate(() => { window.__view.disp6.extra = 1.4; });
    await page.waitForTimeout(8000);
    const want = ['touche de conduite', 'contrôle', 'passe', 'passe levée', 'centre', 'frappe', 'dégagement', 'subi'];
    const done = new Map(); let shots = 0;
    const RES = !!(process.env.RES || process.env.SEQ), SEQ = !!process.env.SEQ, GK = !!process.env.GK, AIR = !!process.env.AIR || GK;   // GK=1 : gestes du gardien (6c-B) ; OFFS=0,0.4 : instants capturés autour du contact (s)
    if (AIR) await page.evaluate((k) => { const v = window.__view; v.TS = k ? 20 : 6; v.opts.replays = false; v.replayPlan = null; }, !!process.env.KEYS);   // (gestes aériens rares : jeu accéléré entre deux captures)
    if (RES) await page.evaluate((x) => { window.__view.disp6.extra = x; }, process.env.KEYS ? 32 : AIR ? 5 : 1.4);
    for (let tries = 0; tries < (process.env.TRIES ? +process.env.TRIES : AIR ? 600 : RES ? 200 : 80) && shots < PAIRS; tries++) {
      await page.waitForTimeout(1200);
      const pick = await page.evaluate((args) => {
        const [want, done, RES, SEQ, AIR] = args, v = window.__view, G = v.live.gest, now = v.live.now;
        let g = null, why = null;
        if (args[6]) {
          // Gardien (6c-B) : gestes du gardien, classés par famille et résultat ; KEYS=pid:T pour des gestes précis.
          v.TS = 20;
          const pr = v.r3d.probeGK('contrat', Math.max(v._airT || 0, now - 30), now - 1.2); v._airT = now - 1.2;
          const cat = (x) => /dégagement|passe/.test(x.kind) ? 'relance_' + x.kind.replace(/ \(réflexe\)/, '').replace(/ /g, '_') : (x.kind.startsWith('plongeon') ? 'plongeon' : x.kind.startsWith('saut') ? 'sortie' : 'mains') + '_' + (x.contact ? (x.res || '?') : 'sans_contact');
          const KEYS = (args[5] || '').split(',').filter(Boolean).map((k) => k.split(':').map(Number));
          v._keysDone ||= new Set();
          const r = KEYS.length ? pr.find((x) => KEYS.some(([pid, T]) => x.pid === pid && Math.abs(x.T - T) < 0.01) && !v._keysDone.has(x.gid) && (v._keysDone.add(x.gid), true)) : pr.find((x) => (done[cat(x)] || 0) < 2 && !v._keysDone.has(x.gid) && (v._keysDone.add(x.gid), true));
          if (r) { g = G.gestures.find((x) => x.id === r.gid); g._T = r.T; why = cat(r) + ` (gants ${r.dAtC != null ? (r.dAtC * 100).toFixed(1) + ' cm' : '—'}, approche min ${r.minAll != null ? (r.minAll * 100).toFixed(1) + ' cm' : '—'}, pid ${r.pid}, T ${r.T.toFixed(3)})`; g._cat = cat(r); }
        } else if (AIR) {
          v.TS = args[5] ? 20 : 6;
          const pr = v.r3d.probeAir('contrat', Math.max(v._airT || 0, now - (args[5] ? 30 : 4)), now - 0.6); v._airT = now - 0.6;   // (gestes ciblés : jeu accéléré, fenêtre de 30 s)
          const cat = (x) => x.contact ? (x.dAtC > 0.03 ? 'aerien_trop_eloigne' : x.dAtC < -0.01 ? 'aerien_penetration' : x.kind.startsWith('contrôle') ? 'controle_' + (x.part || '') : 'tete_' + (x.kind.includes('réflexe') ? ((x.lean || 0) > 0.25 ? 'reflexe_pose' : 'reflexe') : 'saut')) : (x.minAll < 0.1 || x.avoid > 0.005 ? 'tete_perdue_ballon_proche' : 'tete_perdue');
          const KEYS = (args[5] || '').split(',').filter(Boolean).map((k) => k.split(':').map(Number));   // KEYS=pid:T,… : gestes précis
          if (KEYS.length) v._keysDone ||= new Set();
          const r = KEYS.length ? pr.find((x) => KEYS.some(([pid, T]) => x.pid === pid && Math.abs(x.T - T) < 0.01) && !v._keysDone.has(x.gid) && (v._keysDone.add(x.gid), true)) : pr.find((x) => (SEQ ? x.contact && x.kind.startsWith(process.env.SEQKIND || 'saut de tête') && x.dAtC <= 0.03 && (!process.env.SEQKIND || (x.lean || 0) > 0.25) : (done[cat(x)] || 0) < 1) && !(v._usedG ||= new Set()).has(x.gid));
          if (r) { (v._usedG ||= new Set()).add(r.gid); g = G.gestures.find((x) => x.id === r.gid); why = cat(r) + (r.contact ? ` (d ${(r.dAtC * 100).toFixed(1)} cm, buste ${r.lean} rad, menton ${r.nod} rad, poitrine ${r.otherC ? (r.otherC.d * 100).toFixed(1) + ' cm' : 'dégagée'}, ballon à ${r.h} m de haut, à ${r.dh} m, amplitude du saut ${r.amp}, ${r.reach})` : ` (distance minimale ${(r.minAll * 100).toFixed(1)} cm, ${r.minAllPart}, écartement ${(r.avoid * 100).toFixed(0)} cm, ${r.src})`); if (g) g._T = r.T; }
        } else if (RES) {
          // Cas résiduels : la sonde du rendu classe les gestes récents ; on garde les cas défavorables.
          const pr = v.r3d.probe6('contrat', now - 1.1, now - 0.45);
          const cat = (x) => x.reach === 'hors de portée' ? 'hors_de_portee' : x.reach === 'ballon haut' ? 'ballon_haut' : x.maxPen > 0.02 ? 'penetration_hors_contact' : x.cross != null && x.cross < -0.1 ? 'jambes_croisees' : x.dAtC > 0.03 ? 'trop_eloigne' : x.dAtC < -0.01 ? 'penetration_au_contact' : x.yaw > 0.5 ? 'pivot_vers_le_ballon' : x.reach === 'corps' ? 'controle_du_corps' : null;
          const r = pr.find((x) => (SEQ ? x.yaw > 0.5 && x.dAtC <= 0.03 : cat(x) && (done[cat(x)] || 0) < 2) && !(v._usedG ||= new Set()).has(x.gid));
          if (r) v._usedG.add(r.gid);
          if (r) { g = G.gestures.find((x) => x.id === r.gid); why = cat(r) + ` (d ${(r.dAtC * 100).toFixed(1)} cm, pénétration hors contact ${(r.maxPen * 100).toFixed(1)} cm${r.penT != null ? ' à ' + Math.round(r.penT * 1000) + ' ms' : ''}, ballon à ${r.dh} m, hauteur ${r.h} m)`; }
        } else g = [...G.gestures].reverse().find((x) => want.includes(x.kind) && x.tContact != null && x.tContact > now - 1.1 && x.tContact < now - 0.45 && (done[x.kind] || 0) < 1);
        if (!g) return null;
        const e = v.r3d.players.get(g.pid); if (!e) return null;
        v.TS0 = AIR ? (args[5] ? 20 : 6) : v.TS; v.TS = 0; v._shotAir = AIR; v._shotGK = !!args[6];   // simulation figée
        v._cam0 = v.r3d.updateCamera; v._samp0 = v.sampleDisplay;
        // Caméra de côté : perpendiculaire à l'axe joueur → ballon, du côté opposé au joueur le plus proche (pas d'occultation).
        v.r3d.updateCamera = function () {
          const q = e.p3.root.position, B = v.dispBall || v.ball, [bx, bz] = this.toWorld(B.x, B.y);
          const mx = (q.x + bx) / 2, mz = (q.z + bz) / 2; let nx = -(bz - q.z), nz = bx - q.x; const nl = Math.hypot(nx, nz) || 1; nx /= nl; nz /= nl;
          let side = 1, best = Infinity;
          for (const [id2, e2] of this.players) { if (e2 === e) continue; const r = e2.p3.root.position, d = Math.hypot(r.x - mx, r.z - mz); if (d < best) { best = d; side = ((r.x - mx) * nx + (r.z - mz) * nz) > 0 ? -1 : 1; } }
          if (v._shotGK) { const by = 0.11 + (B.h || 0) * 26; this.camera.position.set(bx + nx * side * 2.2 - (q.x - bx) * 0.35, by + 2.6, bz + nz * side * 2.2 - (q.z - bz) * 0.35); this.camera.lookAt((bx * 2 + q.x) / 3, Math.max(0.3, by * 0.8), (bz * 2 + q.z) / 3); this.camera.fov = 40; this.camera.updateProjectionMatrix(); return; }   // (gardien : vue plongeante centrée sur le ballon)
          const hi = v._shotAir ? 1 : 0; this.camera.position.set(mx + nx * side * (2.8 + hi), 1.1 + 0.6 * hi, mz + nz * side * (2.8 + hi)); this.camera.lookAt(mx, 0.45 + 1.0 * hi, mz); this.camera.fov = 34; this.camera.updateProjectionMatrix();
        };
        v._shot = { tC: (g._T ?? g.tContact) + (why && /penetration_hors/.test(why) ? +(why.match(/à (-?\d+) ms/) || [0, 0])[1] / 1000 : 0), kind: g.kind + (g.reflex && ['passe', 'passe levée', 'centre', 'frappe', 'dégagement'].includes(g.kind) ? ' sans armé' : ''), id: g.id, why, cat: why ? why.split(' ')[0] : null };
        return v._shot;
      }, [want, Object.fromEntries(done), RES, SEQ, AIR, process.env.KEYS || '', GK]);
      if (!pick) continue;
      if (SEQ) {
        // Séquence : même geste, instants successifs ; caméra de côté figée sur sa position au contact, puis caméra de jeu.
        for (const cam of ['cote', 'tele']) {
          const frames = [];
          for (let k = -6; k <= 6; k++) {
            await page.evaluate(([off, cam]) => { const v = window.__view, tC = v._shot.tC0 ??= v._shot.tC; v._shot.tC = tC + off;
              v.sampleDisplay = function () { const ok = this.disp6.sample('contrat', this._shot.tC); if (!ok) return; this.dispPlayers = this.disp6.disp; this.dispPhys = this.disp6.ball; this.dispBall = this.disp6.ballN; this.dispHolder = this.disp6.holder; this.dispInHands = this.disp6.inHands; }; v.liveAcc = 0;
              if (cam === 'tele') { v.r3d.updateCamera = v._cam0; v.r3d.snapCam = true; }
              else if (!v._camSide) { const f = v.r3d.updateCamera; v.r3d.updateCamera = function (dt) { if (!v._camSide) { f.call(this, dt); v._camSide = { p: this.camera.position.clone(), q: this.camera.quaternion.clone() }; } this.camera.position.copy(v._camSide.p); this.camera.quaternion.copy(v._camSide.q); }; }
            }, [k * 0.04, cam]);
            await page.waitForTimeout(450);
            const f = path.join(OUT, `seq${String(shots + 1).padStart(2, '0')}-${cam}-${String(k + 6).padStart(2, '0')}.png`);
            await page.screenshot({ path: f, clip: { x: 0, y: 0, width: 1280 * 0.7, height: 720 } }); frames.push(f);
          }
          console.log(`séquence ${shots + 1} (${cam}) : ${pick.why} — ${frames.length} images, −240 à +240 ms`);
        }
        await page.evaluate(() => { const v = window.__view; v.TS = v.TS0; v.r3d.updateCamera = v._cam0; v.sampleDisplay = v._samp0; v._camSide = null; });
        shots++; continue;
      }
      const OFFS = (process.env.OFFS || '0').split(',').map(Number);
      for (const off of OFFS) {
      await page.evaluate((o) => { const v = window.__view; v._shot.tC0 ??= v._shot.tC; v._shot.tC = v._shot.tC0 + o; }, off);
      for (const mode of (RES && !AIR) || process.env.KEYS ? ['contrat'] : ['ancien', 'contrat']) {
        await page.evaluate((m) => { const v = window.__view; v.sampleDisplay = function () { const ok = this.disp6.sample(m, this._shot.tC); if (!ok) return; this.dispPlayers = this.disp6.disp; this.dispPhys = this.disp6.ball; this.dispBall = this.disp6.ballN; this.dispHolder = this.disp6.holder; this.dispInHands = this.disp6.inHands; }; v.liveAcc = 0; }, mode);
        await page.waitForTimeout(700);
        const f = path.join(OUT, `${String(shots + 1).padStart(2, '0')}-${pick.kind.replace(/ /g, '_')}-${AIR ? pick.cat + "-" + mode : pick.cat || mode}${OFFS.length > 1 ? '-' + (off >= 0 ? '+' : '') + Math.round(off * 1000) + 'ms' : ''}.png`);
        await page.screenshot({ path: f, clip: { x: 0, y: 0, width: 1280 * 0.7, height: 720 } });
        console.log(f + (pick.why ? ' — ' + pick.why : ''));
      }
      }
      await page.evaluate(() => { const v = window.__view; v.TS = v.TS0; v.r3d.updateCamera = v._cam0; v.sampleDisplay = v._samp0; });
      const key = pick.cat || pick.kind.split(' sans')[0]; done.set(key, (done.get(key) || 0) + 1); shots++;
    }
  } catch (e) { console.error('Échec :', e.message); process.exitCode = 1; }
  await browser.close(); srv.close();
})();
