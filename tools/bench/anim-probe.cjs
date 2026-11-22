/**
 * Contact VISUEL squelette 3D ↔ ballon (étape 6b) : pendant un match en direct, pour chaque geste
 * migré (frappes, passes, centres, dégagements, remises en jeu au pied, contrôles, touches de conduite),
 * la sonde du rendu (Match3D.probe6) rejoue l'affichage pas à pas autour du contact physique avec le
 * même calcul de pose que l'écran, une fois avec le contrat (mode « contrat ») et une fois avec les
 * anciens indicateurs (mode « ancien », même différé) : distance minimale partie du corps ↔ ballon et
 * instant de ce minimum par rapport au contact physique.
 * Usage : node tools/bench/anim-probe.cjs [secondes de jeu=60]
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium, devices } = require('playwright');

const ROOT = path.join(__dirname, '..', '..');
const SECS = +(process.argv[2] || 60);
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
  const ctx = await browser.newContext({ ...devices['Pixel 5 landscape'] });
  await ctx.addInitScript(() => { try { localStorage.setItem('cdp-tuto', JSON.stringify({ done: true })); } catch {} });
  await ctx.route(/wikipedia\.org|wikimedia\.org|flagcdn/, (r) => r.abort());
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
    if (process.env.CALIB) { const c = await page.evaluate(() => window.__view.r3d.calib6()); console.log(JSON.stringify(c)); throw new Error('étalonnage terminé'); }
    await page.evaluate(() => { window.__view.disp6.extra = 1.4; });
    const res = { contrat: [], ancien: [] };
    let last = await page.evaluate(() => window.__view.live.now), start = last;
    while (last - start < SECS) {
      await page.waitForTimeout(2500);
      const r = await page.evaluate(() => {
        const v = window.__view, now = v.live.now, tTo = now - 0.5, tFrom = Math.max(v._probeT || 0, tTo - 1.0);
        if (tTo <= tFrom) return { now, c: [], a: [] };
        v._probeT = tTo;
        const c = v.r3d.probe6('contrat', tFrom, tTo), a = v.r3d.probe6('ancien', tFrom, tTo);
        return { now, c, a };
      });
      res.contrat.push(...r.c); res.ancien.push(...r.a); last = r.now;
    }
    const q = (a, f) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(f * s.length))] : NaN; };
    const dt = 1 / 96, pc = (a, f) => `${(100 * a.filter(f).length / Math.max(1, a.length)).toFixed(0)} %`;
    const kinds = [...new Set([...res.contrat, ...res.ancien].map((x) => x.kind))];
    console.log(`sonde visuelle : ${res.contrat.length} gestes (${(last - start).toFixed(0)} s de jeu). d = distance partie du corps ↔ SURFACE du ballon au contact (minimum dans ±1 pas ; négatif = dans le ballon).`);
    console.log('classes : crédible −1 cm ≤ d ≤ 3 cm · trop éloigné d > 3 cm · pénétration d < −1 cm ; portée : ok / fente (le corps se porte vers le ballon, ≤ 0,5 m) / corps (contrôle poitrine, cuisse, tête) / hors de portée de la jambe / ballon haut (> 0,75 m)');
    for (const k of kinds) for (const mode of ['ancien', 'contrat']) {
      const a = res[mode].filter((x) => x.kind === k); if (!a.length) continue;
      const d = a.map((x) => x.dAtC);
      console.log(`  ${k.padEnd(24)} ${mode.padEnd(8)} n=${String(a.length).padStart(4)} · d médiane ${q(d, 0.5).toFixed(3)} p90 ${q(d, 0.9).toFixed(3)} p95 ${q(d, 0.95).toFixed(3)} · |d| ≤ 1/2/3/4 cm : ${pc(d, (x) => Math.abs(x) <= 0.01)} / ${pc(d, (x) => Math.abs(x) <= 0.02)} / ${pc(d, (x) => Math.abs(x) <= 0.03)} / ${pc(d, (x) => Math.abs(x) <= 0.04)} · crédible ${pc(d, (x) => x >= -0.01 && x <= 0.03)} · trop éloigné ${pc(d, (x) => x > 0.03)} · pénétration ${pc(d, (x) => x < -0.01)}`);
      if (mode === 'contrat') {
        const by = {}; for (const x of a) (by[x.reach || '—'] ||= []).push(x);
        const fr = a.map((x) => x.dFrame);
        console.log(`      à ± une image (60 i/s) du contact : |d| ≤ 1/2/3 cm : ${pc(fr, (x) => Math.abs(x) <= 0.01)} / ${pc(fr, (x) => Math.abs(x) <= 0.02)} / ${pc(fr, (x) => Math.abs(x) <= 0.03)} · d p95 ${q(fr, 0.95).toFixed(3)}`);
        console.log(`      portée : ` + Object.entries(by).map(([r, b]) => `${r} ${b.length} (d médiane ${q(b.map((x) => x.dAtC), 0.5).toFixed(3)}, ballon à ${q(b.map((x) => x.dh), 0.5).toFixed(2)} m du joueur, hauteur ${q(b.map((x) => x.h), 0.5).toFixed(2)} m)`).join(' · '));
        const yw = a.filter((x) => x.yaw > 0.02);
        if (yw.length) console.log(`      pivot d'affichage vers le ballon (ballon derrière ou sur le côté) : ${yw.length} (${pc(a, (x) => x.yaw > 0.02)}) · médiane ${(q(yw.map((x) => x.yaw), 0.5) * 180 / Math.PI).toFixed(0)}°, max ${(Math.max(...yw.map((x) => x.yaw)) * 180 / Math.PI).toFixed(0)}° · d médiane ${q(yw.map((x) => x.dAtC), 0.5).toFixed(3)}`);
        const cr = a.filter((x) => x.cross != null);
        if (cr.length) console.log(`      jambes croisées au contact (pied du geste passé de l'autre côté du pied d'appui) : > 5 cm ${pc(cr, (x) => x.cross < -0.05)} · > 10 cm ${pc(cr, (x) => x.cross < -0.1)} · > 15 cm ${pc(cr, (x) => x.cross < -0.15)}` + (a.some((x) => x.side > 0.02) ? ` · décalage latéral d'affichage : ${a.filter((x) => x.side > 0.02).length} (médiane ${(q(a.filter((x) => x.side > 0.02).map((x) => x.side), 0.5) * 100).toFixed(0)} cm)` : ''));
        const pen = a.filter((x) => x.maxPen > 0.02);
        console.log(`      pénétration > 2 cm hors du contact : ${pen.length} (${pc(a, (x) => x.maxPen > 0.02)}) — ` + pen.map((x) => `${(x.maxPen * 100).toFixed(1)} cm à ${x.penT > 0 ? '+' : ''}${(x.penT * 1000).toFixed(0)} ms, ballon à ${x.dh} m`).join(' ; '));
      }
    }
    console.log(`(ancien = anciens indicateurs, même différé ; « au contact » : minimum dans ±1 pas = ±${(dt * 1000).toFixed(1)} ms)`);
    if (process.env.JSON) require('fs').writeFileSync(process.env.JSON, JSON.stringify(res));
  } catch (e) { console.error('Échec :', e.message); process.exitCode = 1; }
  await browser.close(); srv.close();
})();
