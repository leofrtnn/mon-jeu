/**
 * RENDU DU MATCH (Canvas 2D, vue de dessus, portrait)
 * ------------------------------------------------------------------
 * Le moteur produit des événements (avec position du ballon). Ce module les
 * rejoue en animation : le ballon voyage d'un point à l'autre, les 22 joueurs
 * glissent vers des positions cibles calculées depuis la formation, la phase
 * de jeu (possession ou non) et la position du ballon.
 *
 * Le contrôleur (écran de match) alimente la file d'événements et reçoit
 * des rappels : onEventStart(ev) pour synchroniser score/commentaires,
 * onIdle() quand la file est vide (il faut simuler une minute de plus).
 */

import { formationPos } from '../engine/positions.js';

const DUR = {
  pass: 0.75, longpass: 1.15, dribble: 0.9, tackle: 0.55, interception: 0.55, header: 0.6, cross: 1.0, cornerkick: 1.1,
  clearance: 0.9, offside: 1.3, foul: 1.1, yellow: 1.7, red: 2.3, injury: 2.0, sub: 1.5, corner: 1.3, freekick: 1.3,
  penalty: 1.9, shot: 0.75, goal: 3.4, var: 2.6, kickoff: 1.3, added: 1.1, ht: 0.6, ft: 0.6, et: 1.2, eht: 1.0,
};
const ARC = { longpass: 0.12, cross: 0.1, cornerkick: 0.12, clearance: 0.14, header: 0.04 };
const PITCH_W = 68, PITCH_L = 105;

function hexToRgb(h) {
  const v = parseInt(h.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}
function colorDist(a, b) {
  const x = hexToRgb(a), y = hexToRgb(b);
  return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
}
function luminance(h) {
  const [r, g, b] = hexToRgb(h);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}
const lerp = (a, b, t) => a + (b - a) * t;
const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

export class MatchView {
  /**
   * @param canvas élément <canvas>
   * @param match  état du moteur
   * @param opts   { userSide, onEventStart, onIdle }
   */
  constructor(canvas, match, opts) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.m = match;
    this.opts = opts;
    this.userSide = opts.userSide ?? 0;
    this.speed = 1;
    this.paused = true;
    this.queue = [];
    this.cur = null; // événement en cours
    this.curT = 0;
    this.ball = { x: 0.5, y: 0.5, fx: 0.5, fy: 0.5, tx: 0.5, ty: 0.5, h: 0, arc: 0 };
    this.players = new Map(); // id -> {x,y,tx,ty,side,num,gk,alpha}
    this.leaving = [];
    this.period = 1;
    this.cam = { y: 0.5, zoom: 1.08, shake: 0 };
    this.particles = [];
    this.banner = null; // { text, color, t, dur }
    this.tags = []; // étiquettes de noms
    this.flash = 0;
    this.lastTs = 0;
    // Couleurs : éviter que les deux équipes se ressemblent.
    const h = match.teams[0].club, a = match.teams[1].club;
    let ac = a.color;
    if (colorDist(h.color, ac) < 120) ac = colorDist(h.color, a.color2) > 120 ? a.color2 : (luminance(h.color) > 0.5 ? '#1b1f2a' : '#f2f2f2');
    this.colors = [h.color, ac];
    this.textColors = this.colors.map((c) => (luminance(c) > 0.6 ? '#111' : '#fff'));
    this.gkColors = ['#d4e157', '#26c6da'];
    this.syncPlayers(true);
    this.resize();
    this._ro = new ResizeObserver(() => this.resize());
    this._ro.observe(canvas.parentElement || canvas);
    this._loop = (ts) => this.frame(ts);
    this.raf = requestAnimationFrame(this._loop);
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    this._ro.disconnect();
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const parent = this.canvas.parentElement;
    const w = parent.clientWidth;
    const maxH = parent.clientHeight || w * 1.45;
    // Le terrain fait 68 x 105 + marges : on respecte le ratio.
    const ratio = (PITCH_L + 8) / (PITCH_W + 6);
    let cw = w, ch = w * ratio;
    if (ch > maxH) { ch = maxH; cw = ch / ratio; }
    this.cssW = cw; this.cssH = ch;
    this.canvas.style.width = cw + 'px';
    this.canvas.style.height = ch + 'px';
    this.canvas.width = Math.round(cw * dpr);
    this.canvas.height = Math.round(ch * dpr);
    this.dpr = dpr;
    this.scale = (cw * dpr) / (PITCH_W + 6); // pixels par mètre
    this.padX = 3 * this.scale; this.padY = 4 * this.scale;
    this.pitchCache = null;
  }

  /** Coordonnées moteur -> pixels canvas. Le côté de l'utilisateur attaque vers le haut en 1re MT. */
  toScreen(x, y) {
    const flip = (this.userSide === 1) !== (this.period === 2 || this.period === 4);
    const vx = flip ? 1 - x : x, vy = flip ? 1 - y : y;
    return [this.padX + vy * PITCH_W * this.scale, this.padY + (1 - vx) * PITCH_L * this.scale];
  }

  /* ---------------- Gestion des joueurs ---------------- */

  syncPlayers(reset) {
    const seen = new Set();
    for (const t of this.m.teams) {
      for (const mp of t.onPitch) {
        if (!mp || !mp.onPitch || mp.red || mp.injured) continue;
        seen.add(mp.id);
        let pl = this.players.get(mp.id);
        if (!pl) {
          // Nouvel entrant : arrive depuis la ligne de touche.
          pl = { x: 0.5, y: t.side === 0 ? -0.04 : 1.04, tx: 0.5, ty: 0.5, side: t.side, alpha: reset ? 1 : 0 };
          if (reset) { const p = this.basePos(t, mp, 0.5, 0.5, false, true); pl.x = p.x; pl.y = p.y; }
          this.players.set(mp.id, pl);
        }
        pl.num = mp.number; pl.gk = t.slots[mp.slot].pos === 'GB'; pl.mp = mp; pl.team = t;
      }
    }
    for (const [id, pl] of this.players) {
      if (!seen.has(id)) {
        this.players.delete(id);
        this.leaving.push({ ...pl, tx: pl.x, ty: pl.side === 0 ? -0.06 : 1.06, life: 1.6 });
      }
    }
  }

  /** Position "de base" d'un joueur : même calcul que le moteur (positions continues). */
  basePos(t, mp, bx, by, inPoss, kickoff) {
    return formationPos(t, mp, bx, by, inPoss, kickoff);
  }

  /** Met à jour les cibles de tous les joueurs pour l'événement courant. */
  computeTargets(ev) {
    const bx = ev.x ?? 0.5, by = ev.y ?? 0.5;
    const kickoff = ev.type === 'kickoff';
    for (const [id, pl] of this.players) {
      const t = pl.team;
      const p = this.basePos(t, pl.mp, bx, by, ev.poss === t.side, kickoff);
      // Petite variation individuelle pour éviter l'effet "robot".
      const j = Math.sin(id * 12.9898 + this.m.minute * 0.7) * 0.012;
      pl.tx = p.x + j; pl.ty = p.y + Math.cos(id * 4.1 + this.m.minute) * 0.012;
    }
    if (kickoff) return;
    // Porteur du ballon (après l'action) : va au ballon.
    const carrier = this.players.get(ev.carrier);
    if (carrier && !['goal', 'shot'].includes(ev.type)) { carrier.tx = bx; carrier.ty = by; }
    // Acteur de l'action : reste près du point de départ (passeur) ou suit le ballon (dribble).
    const actor = this.players.get(ev.pid);
    if (actor && ev.type === 'dribble') { actor.tx = bx; actor.ty = by; }
    // Pressing : les 2 défenseurs les plus proches se rapprochent du ballon.
    const defenders = [...this.players.values()].filter((p) => p.team.side !== ev.poss && !p.gk)
      .map((p) => ({ p, d: Math.hypot(p.tx - bx, (p.ty - by) * 0.65) })).sort((a, b) => a.d - b.d);
    const goalX = ev.poss === 0 ? 1 : 0;
    defenders.slice(0, 2).forEach(({ p }, i) => {
      const k = i === 0 ? 0.8 : 0.4;
      p.tx = lerp(p.tx, bx + (goalX - bx) * 0.035, k);
      p.ty = lerp(p.ty, by, k);
    });
    // Corner : attaquants dans la surface.
    if (ev.type === 'corner' || ev.type === 'freekick' || ev.type === 'penalty') {
      const att = ev.side;
      for (const p of this.players.values()) {
        if (p.gk || p === actor) continue;
        const dx = att === 0 ? 1 : 0;
        if (ev.type === 'penalty') {
          // Tout le monde hors de la surface, au niveau de l'arc.
          if (Math.abs(p.tx - dx) < 0.2) p.tx = att === 0 ? 0.79 : 0.21;
        } else if (p.team.side === att ? p.mp.p.attrs.phy > 55 : true) {
          p.tx = lerp(p.tx, att === 0 ? 0.9 : 0.1, 0.75);
          p.ty = lerp(p.ty, 0.5, 0.55);
        }
      }
      if (actor) { actor.tx = bx; actor.ty = by; }
    }
  }

  /* ---------------- File d'événements ---------------- */

  push(events) { this.queue.push(...events); }
  setSpeed(s) { this.speed = s; }
  play() { this.paused = false; }
  pause() { this.paused = true; }

  startEvent(ev) {
    this.cur = ev;
    this.curT = 0;
    if (ev.period && ev.period !== this.period) {
      this.period = ev.period;
      // Changement de côté : on repositionne instantanément.
      this.syncPlayers(false);
    }
    if (['sub', 'red', 'injury', 'kickoff'].includes(ev.type)) this.syncPlayers(false);
    this.dur = DUR[ev.type] ?? 0.8;
    const b = this.ball;
    b.fx = b.x; b.fy = b.y;
    b.tx = ev.x ?? b.x; b.ty = ev.y ?? b.y;
    b.arc = ARC[ev.type] || (ev.type === 'shot' && ev.kind !== 'penalty' ? 0.03 : 0);
    if (ev.type === 'kickoff') { b.fx = b.tx = 0.5; b.fy = b.ty = 0.5; b.x = b.y = 0.5; }
    if (['foul', 'yellow', 'red', 'injury', 'sub', 'var', 'added', 'ht', 'ft', 'offside'].includes(ev.type)) {
      b.tx = b.x; b.ty = b.y; // le ballon ne bouge pas
    }
    if (ev.type === 'goal') this.celebrate(ev);
    else this.computeTargets(ev);
    if (ev.type === 'shot' && ev.outcome === 'post') this.cam.shake = 0.4;
    // Étiquettes de noms sur les actions importantes.
    if (['shot', 'goal', 'yellow', 'red', 'penalty', 'injury', 'dribble', 'sub'].includes(ev.type) && ev.pid) {
      this.tags.push({ id: ev.pid, text: this.nameOf(ev.pid), life: 1.6 });
    }
    if (ev.type === 'yellow' || ev.type === 'red') this.banner = { text: ev.type === 'yellow' ? '🟨' : '🟥', color: null, t: 0, dur: 1.4, small: true };
    if (ev.type === 'var') this.banner = { text: ev.outcome === 'cancelled' ? 'VAR · REFUSÉ' : 'VAR · VALIDÉ', color: '#3a86ff', t: 0, dur: 2.2, small: true };
    if (ev.type === 'penalty') this.banner = { text: 'PENALTY', color: '#ffb703', t: 0, dur: 1.6, small: true };
    this.opts.onEventStart?.(ev);
  }

  nameOf(id) {
    for (const t of this.m.teams) {
      for (const mp of [...t.onPitch, ...t.bench, ...t.out]) if (mp && mp.id === id) return mp.name;
    }
    return '';
  }

  celebrate(ev) {
    const scorer = this.players.get(ev.pid);
    const side = ev.side;
    const cornerX = side === 0 ? 0.97 : 0.03;
    const cornerY = (ev.y ?? 0.5) < 0.5 ? 0.06 : 0.94;
    if (scorer) { scorer.tx = cornerX; scorer.ty = cornerY; }
    for (const p of this.players.values()) {
      if (p === scorer) continue;
      if (p.team.side === side && !p.gk) {
        p.tx = lerp(p.tx, cornerX, 0.75) + (Math.random() - 0.5) * 0.06;
        p.ty = lerp(p.ty, cornerY, 0.75) + (Math.random() - 0.5) * 0.08;
      } else if (p.team.side !== side) {
        p.tx = lerp(p.tx, side === 0 ? 0.6 : 0.4, 0.3);
      }
    }
    this.ball.tx = side === 0 ? 1.012 : -0.012;
    this.banner = { text: 'BUT !', color: this.colors[side], t: 0, dur: 2.8 };
    this.cam.shake = 1;
    this.flash = 1;
    const [sx, sy] = this.toScreen(side === 0 ? 1 : 0, 0.5);
    for (let i = 0; i < 70; i++) {
      this.particles.push({ x: sx, y: sy, vx: (Math.random() - 0.5) * 9, vy: (Math.random() - 0.5) * 9,
        life: 1.5 + Math.random(), c: Math.random() < 0.6 ? this.colors[side] : '#ffffff', s: 2 + Math.random() * 3 });
    }
    if (navigator.vibrate) try { navigator.vibrate([60, 40, 120]); } catch { /* ignore */ }
  }

  /* ---------------- Boucle d'animation ---------------- */

  frame(ts) {
    const dt = Math.min(0.05, (ts - (this.lastTs || ts)) / 1000);
    this.lastTs = ts;
    if (!this.paused) this.update(dt * this.speed, dt);
    else this.updateIdle(dt);
    this.draw();
    this.raf = requestAnimationFrame(this._loop);
  }

  update(dt, realDt) {
    if (!this.cur) {
      if (this.queue.length) this.startEvent(this.queue.shift());
      else { this.opts.onIdle?.(); if (this.queue.length) this.startEvent(this.queue.shift()); }
    }
    if (this.cur) {
      this.curT += dt / this.dur;
      const b = this.ball;
      const k = Math.min(1, this.curT * (this.cur.type === 'goal' ? 3 : 1.25));
      const e = ease(k);
      b.x = lerp(b.fx, b.tx, e); b.y = lerp(b.fy, b.ty, e);
      b.h = b.arc * Math.sin(Math.PI * k);
      if (this.curT >= 1) {
        const ev = this.cur;
        this.cur = null;
        this.opts.onEventEnd?.(ev);
      }
    }
    this.movePlayers(dt);
    this.updateFx(realDt);
  }

  updateIdle(dt) {
    this.movePlayers(dt * 0.6);
    this.updateFx(dt);
  }

  movePlayers(dt) {
    const k = 1 - Math.exp(-dt * 2.6);
    for (const p of this.players.values()) {
      p.x += (p.tx - p.x) * k; p.y += (p.ty - p.y) * k;
      p.alpha = Math.min(1, (p.alpha ?? 1) + dt * 2);
    }
    for (const p of this.leaving) {
      p.x += (p.tx - p.x) * k; p.y += (p.ty - p.y) * k; p.life -= dt;
    }
    this.leaving = this.leaving.filter((p) => p.life > 0);
  }

  updateFx(dt) {
    // Caméra : suit le ballon verticalement, légère.
    const [, by] = this.toScreen(this.ball.x, this.ball.y);
    const target = by / (this.canvas.height || 1);
    this.cam.y += (target - this.cam.y) * (1 - Math.exp(-dt * 1.5));
    this.cam.shake = Math.max(0, this.cam.shake - dt * 1.4);
    this.flash = Math.max(0, this.flash - dt * 1.5);
    for (const p of this.particles) {
      p.x += p.vx * this.dpr; p.y += p.vy * this.dpr; p.vy += 0.12; p.vx *= 0.98; p.life -= dt;
    }
    this.particles = this.particles.filter((p) => p.life > 0);
    for (const t of this.tags) t.life -= dt;
    this.tags = this.tags.filter((t) => t.life > 0);
    if (this.banner) { this.banner.t += dt; if (this.banner.t > this.banner.dur) this.banner = null; }
  }

  /* ---------------- Dessin ---------------- */

  drawPitch() {
    const c = document.createElement('canvas');
    c.width = this.canvas.width; c.height = this.canvas.height;
    const g = c.getContext('2d');
    const s = this.scale;
    // Fond et bandes de tonte.
    g.fillStyle = '#1f6b3a';
    g.fillRect(0, 0, c.width, c.height);
    const stripes = 12;
    for (let i = 0; i < stripes; i++) {
      g.fillStyle = i % 2 ? '#237a42' : '#1f703d';
      g.fillRect(this.padX, this.padY + (i * PITCH_L * s) / stripes, PITCH_W * s, (PITCH_L * s) / stripes + 1);
    }
    g.strokeStyle = 'rgba(255,255,255,0.82)';
    g.lineWidth = Math.max(1, 0.18 * s);
    const X = (m) => this.padX + m * s, Y = (m) => this.padY + m * s;
    g.strokeRect(X(0), Y(0), PITCH_W * s, PITCH_L * s);
    g.beginPath(); g.moveTo(X(0), Y(PITCH_L / 2)); g.lineTo(X(PITCH_W), Y(PITCH_L / 2)); g.stroke();
    g.beginPath(); g.arc(X(PITCH_W / 2), Y(PITCH_L / 2), 9.15 * s, 0, Math.PI * 2); g.stroke();
    g.fillStyle = 'rgba(255,255,255,0.9)';
    const dot = (x, y) => { g.beginPath(); g.arc(X(x), Y(y), 0.35 * s, 0, Math.PI * 2); g.fill(); };
    dot(PITCH_W / 2, PITCH_L / 2);
    for (const top of [true, false]) {
      const y0 = top ? 0 : PITCH_L, dir = top ? 1 : -1;
      // Surface de réparation, surface de but, point, arc.
      g.strokeRect(X((PITCH_W - 40.3) / 2), Y(top ? 0 : PITCH_L - 16.5), 40.3 * s, 16.5 * s);
      g.strokeRect(X((PITCH_W - 18.3) / 2), Y(top ? 0 : PITCH_L - 5.5), 18.3 * s, 5.5 * s);
      dot(PITCH_W / 2, y0 + dir * 11);
      g.beginPath();
      const a0 = Math.acos(5.5 / 9.15);
      if (top) g.arc(X(PITCH_W / 2), Y(11), 9.15 * s, a0, Math.PI - a0);
      else g.arc(X(PITCH_W / 2), Y(PITCH_L - 11), 9.15 * s, Math.PI + a0, 2 * Math.PI - a0);
      g.stroke();
      // But.
      g.fillStyle = 'rgba(255,255,255,0.25)';
      g.fillRect(X((PITCH_W - 7.32) / 2), top ? Y(-2) : Y(PITCH_L), 7.32 * s, 2 * s);
      g.strokeRect(X((PITCH_W - 7.32) / 2), top ? Y(-2) : Y(PITCH_L), 7.32 * s, 2 * s);
      g.fillStyle = 'rgba(255,255,255,0.9)';
    }
    // Quarts de cercle de corner.
    for (const [x, y, a] of [[0, 0, 0], [PITCH_W, 0, Math.PI / 2], [PITCH_W, PITCH_L, Math.PI], [0, PITCH_L, -Math.PI / 2]]) {
      g.beginPath(); g.arc(X(x), Y(y), 1 * s, a, a + Math.PI / 2); g.stroke();
    }
    this.pitchCache = c;
  }

  draw() {
    const g = this.ctx, W = this.canvas.width, H = this.canvas.height;
    if (!this.pitchCache) this.drawPitch();
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = '#1f6b3a';
    g.fillRect(0, 0, W, H);
    // Caméra : léger zoom centré sur le ballon (vertical), tremblement au but.
    const z = this.cam.zoom;
    const cy = Math.max(H / (2 * z), Math.min(H - H / (2 * z), this.cam.y * H));
    const sh = this.cam.shake * 7 * this.dpr;
    const ox = (Math.random() - 0.5) * sh, oy = (Math.random() - 0.5) * sh;
    g.setTransform(z, 0, 0, z, W / 2 - (W / 2) * z + ox, H / 2 - cy * z + oy);
    g.drawImage(this.pitchCache, 0, 0);

    const r = 1.55 * this.scale; // rayon d'un joueur (~1,5 m à l'échelle, lisible)
    // Ombres + joueurs sortants.
    for (const p of this.leaving) this.drawPlayer(g, p, r, Math.max(0, p.life / 1.6));
    const carrierId = this.cur ? this.cur.carrier : null;
    const list = [...this.players.entries()].sort((a, b) => a[1].y - b[1].y);
    for (const [id, p] of list) this.drawPlayer(g, p, r, p.alpha ?? 1, id === carrierId);
    // Ballon : ombre + balle surélevée selon la hauteur.
    const [bx, by] = this.toScreen(this.ball.x, this.ball.y);
    const lift = this.ball.h * 60 * this.scale;
    g.fillStyle = 'rgba(0,0,0,0.35)';
    g.beginPath(); g.ellipse(bx + lift * 0.3, by + lift * 0.2, r * 0.45, r * 0.32, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#fff';
    g.beginPath(); g.arc(bx, by - lift, r * (0.48 + this.ball.h * 1.5), 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#222'; g.lineWidth = r * 0.12; g.stroke();
    // Étiquettes de noms.
    g.font = `600 ${Math.round(r * 1.05)}px system-ui, sans-serif`;
    g.textAlign = 'center';
    for (const t of this.tags) {
      const p = this.players.get(t.id);
      if (!p) continue;
      const [x, y] = this.toScreen(p.x, p.y);
      g.globalAlpha = Math.min(1, t.life * 2);
      const w = g.measureText(t.text).width + r;
      g.fillStyle = 'rgba(10,14,22,0.75)';
      g.fillRect(x - w / 2, y - r * 3.1, w, r * 1.5);
      g.fillStyle = '#fff';
      g.fillText(t.text, x, y - r * 1.95);
      g.globalAlpha = 1;
    }
    // Particules (repère écran non zoomé n'est pas nécessaire : même repère).
    for (const p of this.particles) {
      g.globalAlpha = Math.min(1, p.life);
      g.fillStyle = p.c;
      g.fillRect(p.x, p.y, p.s * this.dpr, p.s * this.dpr);
    }
    g.globalAlpha = 1;
    g.setTransform(1, 0, 0, 1, 0, 0);
    if (this.flash > 0) { g.fillStyle = `rgba(255,255,255,${this.flash * 0.25})`; g.fillRect(0, 0, W, H); }
    if (this.banner) this.drawBanner(g, W, H);
  }

  drawPlayer(g, p, r, alpha, isCarrier) {
    const [x, y] = this.toScreen(p.x, p.y);
    g.globalAlpha = alpha;
    g.fillStyle = 'rgba(0,0,0,0.3)';
    g.beginPath(); g.ellipse(x + r * 0.25, y + r * 0.35, r, r * 0.7, 0, 0, Math.PI * 2); g.fill();
    if (isCarrier) {
      g.strokeStyle = 'rgba(255,255,255,0.9)'; g.lineWidth = r * 0.22;
      g.beginPath(); g.arc(x, y, r * 1.45, 0, Math.PI * 2); g.stroke();
    }
    g.fillStyle = p.gk ? this.gkColors[p.side] : this.colors[p.side];
    g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
    g.strokeStyle = p.side === 0 ? 'rgba(255,255,255,0.95)' : 'rgba(20,20,20,0.9)';
    g.lineWidth = r * 0.18; g.stroke();
    if (r > 5) {
      g.fillStyle = p.gk ? '#111' : this.textColors[p.side];
      g.font = `700 ${Math.round(r * 1.05)}px system-ui, sans-serif`;
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(String(p.num ?? ''), x, y + r * 0.05);
      g.textBaseline = 'alphabetic';
    }
    g.globalAlpha = 1;
  }

  drawBanner(g, W, H) {
    const b = this.banner;
    const k = Math.min(1, b.t / 0.25) * Math.min(1, (b.dur - b.t) / 0.3);
    g.globalAlpha = Math.max(0, k);
    if (b.small) {
      const fs = Math.round(W * 0.07);
      g.font = `800 ${fs}px system-ui, sans-serif`;
      const w = g.measureText(b.text).width + fs;
      g.fillStyle = b.color || 'rgba(10,14,22,0.7)';
      g.fillRect(W / 2 - w / 2, H * 0.44, w, fs * 1.5);
      g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(b.text, W / 2, H * 0.44 + fs * 0.78);
    } else {
      const fs = Math.round(W * 0.2 * (0.8 + 0.2 * Math.min(1, b.t * 3)));
      g.fillStyle = 'rgba(0,0,0,0.35)';
      g.fillRect(0, H * 0.4, W, H * 0.2);
      g.font = `900 italic ${fs}px system-ui, sans-serif`;
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.lineWidth = fs * 0.08; g.strokeStyle = '#fff';
      g.fillStyle = b.color;
      g.strokeText(b.text, W / 2, H / 2);
      g.fillText(b.text, W / 2, H / 2);
    }
    g.textBaseline = 'alphabetic';
    g.globalAlpha = 1;
  }
}
