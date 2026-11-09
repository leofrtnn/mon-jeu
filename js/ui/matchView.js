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
import { toLocal, localRect } from './viewport.js';
import { createBall, stepBall, solveKick, R as BALL_R, GOAL_HALF } from './ballPhysics.js';
import { LiveSim } from '../engine/live.js';

const DUR = {
  pass: 0.75, longpass: 1.15, dribble: 0.9, tackle: 0.55, interception: 0.55, header: 0.6, cross: 1.0, cornerkick: 1.1,
  clearance: 0.9, offside: 1.3, foul: 1.1, yellow: 1.7, red: 2.3, injury: 2.0, sub: 1.5, corner: 1.3, freekick: 1.3,
  replaystart: 0.5, replayend: 0.4, penalty: 1.9, shot: 0.75, goal: 3.4, var: 2.6, kickoff: 1.3, added: 1.1, ht: 0.6, ft: 0.6, et: 1.2, eht: 1.0,
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
const SKINS = ['#f1c27d', '#e0ac69', '#c68642', '#8d5524', '#ffdbac', '#a0673b', '#5c3a21', '#d9a066'];
const HAIRS = ['#2b1d14', '#120c08', '#5a3a1e', '#b07a3c', '#d9b26b', '#1a1a1a', '#7a4b2a', '#3d2a1a', '#e6d3a3'];
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
    // Ballon physique (mètres) : la vue 2D/3D lit this.ball, recalculé à chaque image.
    this.phys = createBall();
    this.TS = 1.6;          // le match est rejoué légèrement accéléré (×1,6) : ballon et joueurs au même rythme
    this.holder = null;     // joueur qui a le ballon dans les pieds (ou dans les mains : inHands)
    this.inHands = false;
    this.pending = null;    // fin prévue d'une frappe : contrôle, arrêt, contre
    this.physT = 0;
    this.players = new Map(); // id -> {x,y,tx,ty,side,num,gk,alpha}
    this.leaving = [];
    this.period = 1;
    this.cam = { y: 0.5, zoom: 1.04, shake: 0 };
    this.particles = [];
    this.banner = null; // { text, color, t, dur }
    this.tags = []; // étiquettes de noms
    this.flash = 0;
    this.lastTs = 0;
    // Couleurs : éviter que les deux équipes se ressemblent.
    const h = match.teams[0].club, a = match.teams[1].club;
    let ac = a.color;
    if (colorDist(h.color, ac) < 150) ac = colorDist(h.color, a.color2) > 120 ? a.color2 : (luminance(h.color) > 0.5 ? '#1b1f2a' : '#f2f2f2');
    this.colors = [h.color, ac];
    this.textColors = this.colors.map((c) => (luminance(c) > 0.6 ? '#111' : '#fff'));
    this.gkColors = ['#d4e157', '#26c6da'];
    // Shorts : couleur secondaire du club si elle se distingue du maillot.
    this.shorts = [h, a].map((c, i) => (c.color2 && colorDist(c.color2, this.colors[i]) > 90 ? c.color2 : (luminance(this.colors[i]) > 0.5 ? '#1c2230' : '#f1f1f1')));
    this.referee = { x: 0.45, y: 0.3, vx: 0, vy: 0, tx: 0.45, ty: 0.3, face: 0, phase: 0, speed: 0 };
    this.labelMode = opts.labelMode || 'name'; // name | num | none
    this.style = opts.style || 'fm'; // fm : vue 2D épurée façon FM ; anim : silhouettes animées
    this.trail = [];
    this.selected = null;
    this._tap = (e) => {
      const id = this.playerAt(e.clientX, e.clientY);
      this.selected = id === this.selected ? null : id;
      this.opts.onPlayerTap?.(this.selected);
    };
    canvas.addEventListener('pointerup', this._tap);
    // Voile noir pour les transitions (ralenti) : on comprend qu'on change de séquence.
    const par = canvas.parentElement;
    if (par && getComputedStyle(par).position === 'static') par.style.position = 'relative';
    this.veil = document.createElement('div');
    this.veil.style.cssText = 'position:absolute;inset:0;background:#000;opacity:0;pointer-events:none;transition:opacity .35s;z-index:4';
    par?.appendChild(this.veil);
    this.syncPlayers(true);
    // Moteur en direct : les 22 joueurs décident eux-mêmes (voir engine/live.js) ; la vue
    // se contente d'afficher. Sinon (ancien mode), la vue rejoue les événements du moteur.
    if (opts.live) this.live = new LiveSim(match, { players: this.players, ball: this.phys, sync: () => this.syncPlayers(false) });
    this.resize();
    if (this.style === '3d') this.setStyle('3d');
    this._ro = new ResizeObserver(() => this.resize());
    this._ro.observe(canvas.parentElement || canvas);
    this._loop = (ts) => this.frame(ts);
    this.raf = requestAnimationFrame(this._loop);
  }

  /** Vue : 'fm' (2D façon FM), '3d' (stade en 3D), 'anim' (silhouettes animées). */
  setStyle(st) {
    this.style = st; this.pitchCache = null; this.trail = [];
    if (st === '3d' && !this.r3d && !this._loading3d) {
      this._loading3d = true;
      import('./match3d.js').then((mod) => {
        try { this.r3d = new mod.Match3D(this); this.canvas.classList.add('overlay3d'); }
        catch (e) { console.warn('3D indisponible', e); this.style = 'fm'; this.opts.on3DFail?.(); }
      }).catch(() => { this.style = 'fm'; this.opts.on3DFail?.(); }).finally(() => { this._loading3d = false; });
    }
    if (this.r3d) {
      this.r3d.canvas.style.display = st === '3d' ? '' : 'none';
      this.canvas.classList.toggle('overlay3d', st === '3d');
    }
  }

  destroy() {
    this.r3d?.dispose();
    this.canvas.removeEventListener('pointerup', this._tap);
    cancelAnimationFrame(this.raf);
    this._ro.disconnect();
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const parent = this.canvas.parentElement;
    const w = parent.clientWidth;
    const maxH = parent.clientHeight || w * 1.45;
    // Paysage : terrain horizontal ; portrait : terrain vertical. Le ratio 68 x 105 (+ marges) est respecté.
    this.landscape = w > maxH * 1.05;
    const ratio = this.landscape ? (PITCH_W + 6) / (PITCH_L + 8) : (PITCH_L + 8) / (PITCH_W + 6);
    let cw = w, ch = w * ratio;
    if (ch > maxH) { ch = maxH; cw = ch / ratio; }
    this.cssW = cw; this.cssH = ch;
    this.canvas.style.width = cw + 'px';
    this.canvas.style.height = ch + 'px';
    this.canvas.width = Math.round(cw * dpr);
    this.canvas.height = Math.round(ch * dpr);
    this.dpr = dpr;
    this.scale = (cw * dpr) / (this.landscape ? PITCH_L + 8 : PITCH_W + 6); // pixels par mètre
    this.padX = (this.landscape ? 4 : 3) * this.scale; this.padY = (this.landscape ? 3 : 4) * this.scale;
    this.pitchCache = null;
    this.r3d?.resize();
  }

  /**
   * Coordonnées moteur -> pixels canvas. L'équipe de l'utilisateur attaque vers la droite
   * (paysage) ou vers le haut (portrait) en 1re mi-temps.
   */
  toScreen(x, y) {
    const flip = (this.userSide === 1) !== (this.period === 2 || this.period === 4);
    const vx = flip ? 1 - x : x, vy = flip ? 1 - y : y;
    if (this.landscape) return [this.padX + vx * PITCH_L * this.scale, this.padY + vy * PITCH_W * this.scale];
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
          pl = { x: 0.5, y: t.side === 0 ? -0.04 : 1.04, tx: 0.5, ty: 0.5, side: t.side, alpha: reset ? 1 : 0,
            vx: 0, vy: 0, face: t.side === 0 ? 0 : Math.PI, phase: Math.random() * 6, speed: 0, kick: 0, slide: 0, dive: 0, diveDir: 1, jump: 0, celeb: 0,
            skin: SKINS[mp.id % SKINS.length], hair: HAIRS[(mp.id * 7) % HAIRS.length] };
          if (reset) { const p = this.basePos(t, mp, 0.5, 0.5, false, true); pl.x = p.x; pl.y = p.y; }
          this.players.set(mp.id, pl);
        }
        pl.num = mp.number; pl.gk = t.slots[mp.slot].pos === 'GB'; pl.mp = mp; pl.team = t;
        pl.short = (mp.name || '').split(' ').slice(-1)[0];
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
    if (kickoff) {
      // Engagement : chacun dans sa moitié, l'adversaire hors du rond central (9,15 m),
      // le joueur qui engage au point central.
      for (const pl of this.players.values()) {
        const own = pl.team.side === 0;
        pl.tx = own ? Math.min(pl.tx, 0.488) : Math.max(pl.tx, 0.512);
        if (pl.team.side !== ev.side) {
          const dx = (pl.tx - 0.5) * PITCH_L, dy = (pl.ty - 0.5) * PITCH_W, d = Math.hypot(dx, dy);
          if (d < 10) { const k = 10 / Math.max(0.1, d); pl.tx = 0.5 + (dx * k) / PITCH_L; pl.ty = 0.5 + (dy * k) / PITCH_W; if (Math.abs(dx) < 0.5) pl.tx = own ? 0.4 : 0.6; }
        }
      }
      const kicker = this.players.get(ev.carrier) || this.players.get(ev.pid);
      if (kicker) { kicker.tx = kicker.team.side === 0 ? 0.495 : 0.505; kicker.ty = 0.5; }
      return;
    }
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
  play() {
    this.paused = false;
    if (this.live && this.m.phase === 'ht') this.live.resumeHT = true; // reprise de la 2e mi-temps
  }
  pause() { this.paused = true; }

  startEvent(ev) {
    this.cur = ev;
    this.curT = 0;
    this.koWait = null;
    if (ev.period && ev.period !== this.period) {
      this.period = ev.period;
      // Changement de côté : on repositionne et on l'annonce.
      this.syncPlayers(false);
      if (!ev.replay) this.banner = { text: '⇅ Changement de côté', color: null, t: 0, dur: 1.6, small: true };
    }
    if (['sub', 'red', 'injury', 'kickoff'].includes(ev.type)) this.syncPlayers(false);
    this.dur = (DUR[ev.type] ?? 0.8) * (ev.replay && ev.type !== 'replaystart' && ev.type !== 'replayend' ? 2.3 : 1);
    this.replaying = ev.replay && ev.type !== 'replayend';
    if (ev.poss != null && ev.poss >= 0) this.poss = ev.poss;
    if (ev.type === 'goal') this.celebrate(ev);
    else if (['kickoff', 'corner', 'freekick', 'penalty'].includes(ev.type)) this.computeTargets(ev);
    else this.reshape(true);
    if (ev.type === 'replaystart' || ev.type === 'replayend') {
      this.banner = null; this.particles = []; this.cam.shake = 0;
      if (this.veil) { this.veil.style.opacity = '1'; setTimeout(() => { if (this.veil) this.veil.style.opacity = '0'; }, 380); }
    }
    if (ev.snap) {
      // Début du ralenti : tout le monde à sa place, ballon au pied de l'acteur.
      for (const p of this.players.values()) { p.x = p.tx; p.y = p.ty; p.vx = p.vy = 0; }
      const a = this.players.get(ev.pid);
      const f = a ? this.footOf(a) : { x: (ev.x ?? 0.5) * PITCH_L, y: (ev.y ?? 0.5) * PITCH_W };
      this.place(f.x, f.y);
    }
    // Le ballon : frappe calculée physiquement, la durée de l'action suit son trajet.
    // Frappe : si l'acteur n'est pas au ballon, il va d'abord le chercher (pas de téléportation).
    this.approach = null;
    // Le moteur fait agir un coéquipier du porteur (passe, tir, dribble…) : à l'écran, le porteur
    // lui donne d'abord le ballon (passe courte), au lieu de l'attendre sans bouger.
    const hold = this.holder != null ? this.players.get(this.holder) : null;
    const actor0 = this.players.get(ev.pid);
    if (!ev.replay && !ev.synthetic && hold && actor0 && hold !== actor0 && hold.team === actor0.team && !this.inHands && !this.setPiece
      && ['pass', 'longpass', 'cross', 'cornerkick', 'clearance', 'shot', 'dribble'].includes(ev.type) && ev.kind !== 'header'
      && Math.hypot((hold.x - actor0.x) * PITCH_L, (hold.y - actor0.y) * PITCH_W) > 3) {
      this.queue.unshift(ev);
      const relay = { type: 'pass', synthetic: true, side: ev.side, poss: ev.poss, pid: hold.mp.id, pid2: actor0.mp.id, carrier: actor0.mp.id,
        x: actor0.x, y: actor0.y, minute: ev.minute, extra: ev.extra, period: ev.period, score: ev.score };
      return this.startEvent(relay);
    }
    // Coup de pied arrêté : le tireur est placé directement derrière le ballon (comme une
    // coupure de réalisation), au lieu de traverser le terrain.
    const taker = this.players.get(ev.pid);
    if (this.setPiece && taker && ['pass', 'longpass', 'cross', 'cornerkick', 'clearance', 'shot'].includes(ev.type)) {
      const P = this.phys, tx = (ev.x ?? 0.5) * PITCH_L, ty = (ev.y ?? 0.5) * PITCH_W;
      const d = Math.hypot(tx - P.x, ty - P.y) || 1;
      taker.x = (P.x - ((tx - P.x) / d) * 1.2) / PITCH_L; taker.y = (P.y - ((ty - P.y) / d) * 1.2) / PITCH_W;
      taker.vx = taker.vy = 0; this.faceTo(taker, tx / PITCH_L, ty / PITCH_W);
    }
    if (this.setPiece && !['corner', 'freekick', 'penalty'].includes(ev.type)) ev._sp = true; // coup de pied arrêté : pas de conduite
    if (!['corner', 'freekick', 'penalty'].includes(ev.type)) this.setPiece = false;
    this.carry = null;
    if (this.needsApproach(ev)) { this.approach = { ev, t: 0 }; this.dur = 99; }
    else this.resolveEvent(ev);
  }


  /**
   * Annonce de l'action (commentaire, sifflet, cartons, noms) : au moment où elle a
   * VRAIMENT lieu (après la course au contact, ou une fois les joueurs placés à l'engagement).
   */
  announce(ev) {
    if (ev.synthetic) return; // passe de liaison ajoutée par l'affichage : pas de commentaire
    if (ev.type === 'shot' && ev.outcome === 'post') this.cam.shake = 0.4;
    this.animate(ev);
    // Étiquettes de noms sur les actions importantes.
    if (['shot', 'goal', 'yellow', 'red', 'penalty', 'injury', 'dribble', 'sub'].includes(ev.type) && ev.pid) {
      this.tags.push({ id: ev.pid, text: this.nameOf(ev.pid), life: 1.6 });
    }
    if (ev.replay) { this.opts.onEventStart?.(ev); return; }
    if (ev.type === 'yellow' || ev.type === 'red') this.banner = { text: ev.type === 'yellow' ? '🟨' : '🟥', color: null, t: 0, dur: 1.4, small: true };
    if (ev.type === 'var') this.banner = { text: ev.outcome === 'cancelled' ? 'VAR · REFUSÉ' : 'VAR · VALIDÉ', color: '#3a86ff', t: 0, dur: 2.2, small: true };
    if (ev.type === 'penalty') this.banner = { text: 'PENALTY', color: '#ffb703', t: 0, dur: 1.6, small: true };
    this.opts.onEventStart?.(ev);
  }

  /** Gestes des joueurs : frappe, tacle, plongeon, saut, conduite de balle. */
  animate(ev) {
    const actor = this.players.get(ev.pid);
    const other = this.players.get(ev.pid2);
    const b = this.ball;

    if (ev.type === 'header' && actor) actor.jump = 0.45;
    if (ev.type === 'shot' && ev.kind === 'header' && actor) actor.jump = 0.45;

    if (ev.type === 'goal') {
      for (const p of this.players.values()) if (p.team.side === ev.side && !p.gk) p.celeb = p.mp.id === ev.pid ? 3.2 : 2.6;
    }
  }

  faceTo(p, x, y) {
    p.face = Math.atan2((y - p.y) * PITCH_W, (x - p.x) * PITCH_L);
  }

  /** Joueur sous un point écran (pour le toucher). */
  playerAt(cx, cy) {
    if (this.style === '3d' && this.r3d) return this.r3d.pick(cx, cy);
    const rect = localRect(this.canvas);
    ({ x: cx, y: cy } = toLocal(cx, cy));
    const sx = (cx - rect.left) * this.dpr, sy = (cy - rect.top) * this.dpr;
    const T = this.view || { z: 1, tx: 0, ty: 0 };
    const wx = (sx - T.tx) / T.z, wy = (sy - T.ty) / T.z;
    let best = null, bd = (2.6 * this.scale) ** 2 * 4;
    for (const [id, p] of this.players) {
      const [x, y] = this.toScreen(p.x, p.y);
      const d = (x - wx) ** 2 + (y - wy) ** 2;
      if (d < bd) { bd = d; best = id; }
    }
    return best;
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
    this.lastDt = dt;
    // Le ralenti garde une vitesse lisible même en x4.
    if (!this.paused) this.update(dt * (this.cur?.replay ? Math.min(this.speed, 1.5) : this.speed), dt);
    else this.updateIdle(dt);
    this.draw();
    this.raf = requestAnimationFrame(this._loop);
  }

  update(dt, realDt) {
    if (this.live) { this.updateLive(dt, realDt); return; }
    if (!this.cur) {
      if (this.queue.length) this.startEvent(this.queue.shift());
      else { this.opts.onIdle?.(); if (this.queue.length) this.startEvent(this.queue.shift()); }
    }
    if (this.approach) this.updateApproach(dt);
    if (this.carry) this.updateCarry(dt);
    // Les 22 joueurs se replacent en continu selon la position réelle du ballon.
    this.reshapeT = (this.reshapeT || 0) + dt;
    if (this.reshapeT > 0.25 && !this.cur?.replay && !['corner', 'freekick', 'penalty', 'kickoff', 'goal'].includes(this.cur?.type)) this.reshape();
    if (this.cur && this.koWait != null) {
      // Engagement : on attend que les 22 joueurs soient revenus dans leur moitié.
      this.koWait += dt;
      const off = [...this.players.values()].some((p) => Math.hypot((p.tx - p.x) * PITCH_L, (p.ty - p.y) * PITCH_W) > 2.5);
      if (off && this.koWait < 6) { this.movePlayers(dt * this.TS); this.updateFx(realDt); return; }
      if (off) for (const p of this.players.values()) { p.x = p.tx; p.y = p.ty; p.vx = p.vy = 0; }
      this.koWait = null;
      this.curT = 0;
      this.announce(this.cur);
    }
    if (this.cur) {
      this.curT += dt / this.dur;
      // L'action suivante attend que le receveur ait le ballon (au plus 2,5 s).
      const waiting = this.curT >= 1 && this.pending?.kind === 'receive' && (this.waitT = (this.waitT || 0) + dt) < 2.5;
      if (this.curT >= 1 && !waiting) {
        this.waitT = 0;
        const ev = this.cur;
        this.cur = null;
        this.opts.onEventEnd?.(ev);
      }
    }
    const pdt = dt * this.TS * (this.replaying ? 0.45 : 1);
    this.movePlayers(pdt);
    this.stepPhysics(pdt);
    this.updateFx(realDt);
  }

  /* ---------------- Moteur en direct ---------------- */

  /** Fait avancer la simulation en direct et affiche ses événements. */
  updateLive(dt, realDt) {
    // Événements venus de l'écran (remplacement manuel) : annoncés, joueurs resynchronisés.
    if (this.queue.length) {
      const evs = this.queue.splice(0).filter((e) => !e.replay);
      this.live.handle(evs, []);
      for (const ev of evs) this.liveEvent(ev);
    }
    let left = dt * this.TS;
    while (left > 1e-6) {
      const h = Math.min(0.05, left);
      left -= h;
      for (const ev of this.live.step(h)) this.liveEvent(ev);
      if (this.paused) break; // mi-temps / fin : l'écran a mis en pause
    }
    this.holder = this.live.holder ? this.live.holder.mp.id : null;
    this.inHands = this.live.inHands;
    const b = this.ball, P = this.phys;
    b.x = P.x / PITCH_L; b.y = P.y / PITCH_W; b.h = Math.max(0, P.z - BALL_R) / 26;
    this.updateFx(realDt);
  }

  /** Effets visuels et annonce d'un événement du moteur en direct. */
  liveEvent(ev) {
    if (ev.period && ev.period !== this.period) {
      this.period = ev.period;
      this.banner = { text: '⇅ Changement de côté', color: null, t: 0, dur: 1.6, small: true };
    }
    if (ev.type === 'goal') {
      this.banner = { text: 'BUT !', color: this.colors[ev.side], t: 0, dur: 2.8 };
      this.cam.shake = 1; this.flash = 1;
      const [sx, sy] = this.toScreen(ev.side === 0 ? 1 : 0, 0.5);
      for (let i = 0; i < 70; i++) {
        this.particles.push({ x: sx, y: sy, vx: (Math.random() - 0.5) * 9, vy: (Math.random() - 0.5) * 9,
          life: 1.5 + Math.random(), c: Math.random() < 0.6 ? this.colors[ev.side] : '#ffffff', s: 2 + Math.random() * 3 });
      }
      if (navigator.vibrate) try { navigator.vibrate([60, 40, 120]); } catch { /* ignore */ }
    }
    if (ev.type === 'shot' && ev.outcome === 'post') this.cam.shake = 0.4;
    this.cur = ev; // pour les étiquettes et la caméra
    this.announce(ev);
  }

  /* ---------------- Ballon physique ---------------- */

  /** Nombre pseudo-aléatoire stable pour un événement (le ralenti rejoue la même frappe). */
  rnd(ev, k = 0) {
    const v = Math.sin(((ev.minute || 0) * 97 + (ev.pid || 0) * 31 + k * 17.3 + (ev.extra || 0) * 7 + (ev.x || 0) * 53) * 12.9898) * 43758.5453;
    return v - Math.floor(v);
  }
  /** Pied du joueur (en mètres), devant lui. */
  footOf(p, d = 0.6) { return { x: p.x * PITCH_L + Math.cos(p.face) * d, y: p.y * PITCH_W + Math.sin(p.face) * d }; }
  place(x, y) {
    Object.assign(this.phys, { x, y, z: BALL_R, vx: 0, vy: 0, vz: 0, spin: 0, top: 0, inGoal: 0, hitPost: false });
    this.pending = null;
    this.setPiece = true;
  }

  /**
   * Faut-il que l'acteur aille d'abord au ballon ? Une frappe, une tête, un tacle, une
   * interception ou une faute n'ont lieu qu'au contact : sinon, il court jusqu'au ballon.
   */
  needsApproach(ev) {
    const a = this.players.get(ev.pid), P = this.phys;
    if (!a || this.inHands || P.inGoal || P.x < 0 || P.x > PITCH_L || P.y < 0 || P.y > PITCH_W) return false;
    const f = this.footOf(a), d = Math.hypot(f.x - P.x, f.y - P.y);
    const head = ev.type === 'header' || (ev.type === 'shot' && ev.kind === 'header');
    if (head) return d > 2.2;
    if (['tackle', 'interception', 'foul'].includes(ev.type)) return d > 1.2;
    if (ev.type === 'dribble') return this.holder !== ev.pid && d > 1.2;
    if (!['pass', 'longpass', 'cross', 'cornerkick', 'clearance', 'shot'].includes(ev.type)) return false;
    if (this.holder === ev.pid && d < 1.2) return false;
    return d > 1.3 && P.z < 1.5;
  }

  /** L'acteur court au ballon (derrière lui et face à la cible pour une frappe), puis agit. */
  updateApproach(dt) {
    const ap = this.approach, ev = ap.ev, a = this.players.get(ev.pid), P = this.phys;
    ap.t += dt;
    const duel = ['tackle', 'interception', 'foul', 'header', 'dribble'].includes(ev.type) || ev.kind === 'header';
    if (a) {
      if (duel) {
        // Il va au ballon (en anticipant sa course s'il roule ou s'il est conduit).
        const lead = 0.35;
        a.tx = Math.max(0, Math.min(1, (P.x + P.vx * lead) / PITCH_L)); a.ty = Math.max(0, Math.min(1, (P.y + P.vy * lead) / PITCH_W));
        // Le porteur pris au marquage ralentit (il protège le ballon) : le duel a bien lieu.
        const vic = this.players.get(ev.pid2);
        if (vic && ['tackle', 'foul'].includes(ev.type)) { vic.tx = vic.x + (vic.vx || 0) * 0.15 / PITCH_L; vic.ty = vic.y + (vic.vy || 0) * 0.15 / PITCH_W; }
      } else {
        const tx = (ev.x ?? 0.5) * PITCH_L, ty = (ev.y ?? 0.5) * PITCH_W;
        const d = Math.hypot(tx - P.x, ty - P.y) || 1;
        a.tx = (P.x - ((tx - P.x) / d) * 0.6) / PITCH_L; a.ty = (P.y - ((ty - P.y) / d) * 0.6) / PITCH_W;
      }
    }
    if (!a || !this.needsApproach(ev) || ap.t > (duel ? 5.5 : 3)) {
      this.approach = null;
      this.curT = 0;
      this.dur = DUR[ev.type] ?? 0.8;
      this.resolveEvent(ev);
    }
  }

  /** Exécute l'événement une fois les joueurs au contact. */
  resolveEvent(ev) {
    if (['tackle', 'interception', 'foul'].includes(ev.type)) this.duel(ev);
    else {
      // Avant de frapper, le porteur conduit le ballon (vers l'espace, la zone de tir, l'aile).
      if (!ev._carried && this.startCarry(ev)) return;
      this.doKick(ev);
    }
    // Engagement : annoncé quand tout le monde est dans sa moitié (voir update).
    if (ev.type === 'kickoff' && !ev.replay) { this.koWait = 0; return; }
    this.announce(ev);
  }

  /**
   * Conduite de balle avant l'action : passe (s'il a de l'espace devant lui), tir (jusqu'à
   * une zone de frappe réaliste), centre (débordement sur l'aile).
   */
  startCarry(ev) {
    const a = this.players.get(ev.pid);
    if (!a || a.gk || this.holder !== ev.pid || this.inHands || ev._sp || ev.replay) return false;
    const P = this.phys, dir = a.team.side === 0 ? 1 : -1, goalX = a.team.side === 0 ? PITCH_L : 0;
    const dri = a.mp?.p?.attrs?.dri ?? 60;
    let tx, ty, max;
    if (ev.type === 'shot' && ev.kind !== 'header' && ev.kind !== 'penalty' && ev.kind !== 'freekick') {
      // Zone de frappe : 14-18 m (occasion franche) ou 20-26 m (frappe lointaine).
      const dist = ev.zone >= 3 ? 14 + this.rnd(ev, 7) * 4 : 20 + this.rnd(ev, 7) * 6;
      const lat = Math.max(-13, Math.min(13, ((ev.y ?? 0.5) - 0.5) * PITCH_W * 0.7));
      if (Math.hypot(goalX - P.x, PITCH_W / 2 - P.y) <= dist + 2) return false;
      tx = goalX - dir * dist; ty = PITCH_W / 2 + lat; max = 6;
    } else if (ev.type === 'cross') {
      const flank = P.y < PITCH_W / 2 ? 5 : PITCH_W - 5;
      tx = goalX - dir * (9 + this.rnd(ev, 8) * 8); ty = flank; max = 5;
      if (Math.hypot(tx - P.x, ty - P.y) < 4) return false;
    } else if (ev.type === 'pass' || ev.type === 'longpass') {
      // Il avance balle au pied s'il n'est pas pressé (plus longtemps s'il dribble bien).
      if (this.pressedAhead(a, 5)) return false;
      const len = 5 + (dri / 100) * 9 * this.rnd(ev, 9);
      tx = Math.max(2, Math.min(PITCH_L - 2, P.x + dir * len)); ty = P.y + (this.rnd(ev, 10) - 0.5) * 6; max = 0.6 + (dri / 100) * 1.2;
    } else return false;
    this.carry = { ev, t: 0, max, tx: Math.max(1, Math.min(PITCH_L - 1, tx)) / PITCH_L, ty: Math.max(1, Math.min(PITCH_W - 1, ty)) / PITCH_W };
    this.dur = 99;
    return true;
  }

  /** Un adversaire est-il devant le joueur, à moins de r mètres ? */
  pressedAhead(a, r) {
    const dir = a.team.side === 0 ? 1 : -1;
    for (const p of this.players.values()) {
      if (p.team === a.team) continue;
      const dx = (p.x - a.x) * PITCH_L * dir, dy = (p.y - a.y) * PITCH_W;
      if (dx > -0.5 && Math.hypot(dx, dy) < r) return true;
    }
    return false;
  }

  updateCarry(dt) {
    const c = this.carry, a = this.players.get(c.ev.pid);
    c.t += dt;
    if (a) { a.tx = c.tx; a.ty = c.ty; }
    const arrived = !a || Math.hypot((a.x - c.tx) * PITCH_L, (a.y - c.ty) * PITCH_W) < 1.5;
    const lost = this.holder !== c.ev.pid;
    // Il frappe / passe quand il est arrivé, s'il est pressé (passe ou centre), ou au bout du temps.
    const pressed = a && c.ev.type !== 'shot' && c.t > 0.3 && this.pressedAhead(a, 2.2);
    if (arrived || lost || pressed || c.t > c.max) {
      this.carry = null;
      c.ev._carried = true;
      this.curT = 0;
      this.dur = DUR[c.ev.type] ?? 0.8;
      this.resolveEvent(c.ev);
    }
  }

  /** Duel : tacle / interception (le défenseur repart avec le ballon) ou faute (jeu arrêté). */
  duel(ev) {
    const a = this.players.get(ev.pid), v = this.players.get(ev.pid2), P = this.phys;
    this.pending = null;
    if (a) this.faceTo(a, P.x / PITCH_L, P.y / PITCH_W);
    if (ev.type === 'foul') {
      if (a) a.slide = 0.55;
      if (v) v.fall = 1.1;
      this.holder = null;
      P.vx *= 0.1; P.vy *= 0.1; P.vz = Math.min(0, P.vz); P.spin = 0;
      this.foulAt = { x: P.x, y: P.y };
      return;
    }
    if (ev.type === 'tackle' && a) a.slide = 0.55;
    if (ev.type === 'tackle' && v) v.fall = 0.6;
    if (ev.type === 'interception' && a) a.touch = 0.2;
    if (a) { this.holder = ev.pid; this.inHands = false; }
  }

  /**
   * Placement continu des 22 joueurs selon la position RÉELLE du ballon : bloc équipe,
   * pressing du défenseur le plus proche (côté but), couverture du deuxième.
   * Les joueurs qui ont un rôle dans l'action (porteur, receveur, acteur) ne sont pas touchés.
   */
  reshape(force = false) {
    const P = this.phys;
    const bx = Math.max(0, Math.min(1, P.x / PITCH_L)), by = Math.max(0, Math.min(1, P.y / PITCH_W));
    const busy = new Set([this.holder, this.pending?.who, this.approach?.ev?.pid, this.carry?.ev?.pid].filter((x) => x != null));
    const poss = this.poss ?? 0;
    for (const [id, pl] of this.players) {
      if (busy.has(id) || pl.celeb > 0 || pl.dive > 0) continue;
      const p = this.basePos(pl.team, pl.mp, bx, by, poss === pl.team.side, false);
      const j = Math.sin(id * 12.9898) * 0.01;
      pl.tx = p.x + j; pl.ty = p.y + Math.cos(id * 4.1) * 0.01;
    }
    // Pressing : le défenseur le plus proche va au porteur (en se plaçant entre lui et son but),
    // le deuxième couvre derrière.
    const defs = [...this.players.values()].filter((p) => p.team.side !== poss && !p.gk && !busy.has(p.mp.id))
      .map((p) => ({ p, d: Math.hypot((p.x - bx) * PITCH_L, (p.y - by) * PITCH_W) })).sort((a, b) => a.d - b.d);
    const ownGoal = poss === 0 ? 1 : 0; // but défendu par l'équipe qui n'a pas le ballon
    const gx = ownGoal * PITCH_L, gy = PITCH_W / 2;
    const toGoal = Math.hypot(gx - P.x, gy - P.y) || 1;
    const ux = (gx - P.x) / toGoal, uy = (gy - P.y) / toGoal;
    defs.slice(0, 2).forEach(({ p, d }, i) => {
      if (d > 28) return;
      const off = i === 0 ? 1.2 : 5;
      p.tx = (P.x + ux * off) / PITCH_L; p.ty = (P.y + uy * off) / PITCH_W;
    });
    // Porteur sans consigne : il avance dans l'espace (ou protège le ballon s'il est pressé),
    // au lieu de rester planté.
    const hd = this.holder != null ? this.players.get(this.holder) : null;
    if (hd && !this.inHands && !this.carry && this.approach?.ev?.pid !== this.holder && !hd.gk) {
      const dir = hd.team.side === 0 ? 1 : -1;
      if (this.pressedAhead(hd, 3)) { hd.tx = hd.x - (dir * 1.5) / PITCH_L; hd.ty = hd.y + (hd.y < 0.5 ? 2 : -2) / PITCH_W; }
      else { hd.tx = Math.max(0.03, Math.min(0.97, hd.x + (dir * 7) / PITCH_L)); hd.ty = hd.y + (0.5 - hd.y) * 0.08; }
    }
    // Soutien : les deux coéquipiers les plus proches du porteur se démarquent (une solution
    // courte de chaque côté, légèrement devant), l'attaquant le plus avancé prend la profondeur.
    const h = this.holder != null ? this.players.get(this.holder) : null;
    if (h && !this.inHands) {
      const dir = h.team.side === 0 ? 1 : -1;
      const mates = [...this.players.values()].filter((p) => p.team === h.team && p !== h && !p.gk && !busy.has(p.mp.id))
        .map((p) => ({ p, d: Math.hypot((p.x - h.x) * PITCH_L, (p.y - h.y) * PITCH_W) })).sort((a, b) => a.d - b.d);
      mates.slice(0, 2).forEach(({ p }, i) => {
        const side = i === 0 ? (p.y < h.y ? -1 : 1) : (p.y < h.y ? -1 : 1) * -1 || 1;
        p.tx = Math.max(0.03, Math.min(0.97, h.x + (dir * 9) / PITCH_L));
        p.ty = Math.max(0.05, Math.min(0.95, h.y + (side * 12) / PITCH_W));
      });
      const fwd = mates.map((m) => m.p).filter((p) => ['BU', 'AG', 'AD'].includes(p.team.slots[p.mp.slot].pos))
        .sort((a, b) => (b.x - a.x) * dir)[0];
      const lastDef = [...this.players.values()].filter((p) => p.team !== h.team && !p.gk).map((p) => p.x * dir).sort((a, b) => b - a)[0];
      if (fwd && lastDef != null && (h.x * dir) > (dir > 0 ? 0.35 : -0.65)) {
        // Appel en profondeur : à la limite du hors-jeu, dans le dos de la défense.
        fwd.tx = Math.max(0.03, Math.min(0.97, (lastDef - 0.01) * dir));
      }
    }
    this.reshapeT = 0;
  }

  doKick(ev) {
    const T = this.kick(ev);
    if (T != null) this.dur = Math.max(0.4, T / (this.TS * (this.replaying ? 0.45 : 1)) + 0.15);
  }

  /** Règle la frappe correspondant à l'événement. Retourne la durée du trajet (s), ou null. */
  kick(ev) {
    const P = this.phys;
    const actor = this.players.get(ev.pid);
    const recv = this.players.get(ev.pid2) || this.players.get(ev.carrier);
    const tx = (ev.x ?? 0.5) * PITCH_L, ty = (ev.y ?? 0.5) * PITCH_W;
    const goalX = ev.side === 0 ? PITCH_L : 0, gdir = ev.side === 0 ? 1 : -1;
    const r1 = this.rnd(ev, 1), r2 = this.rnd(ev, 2), r3 = this.rnd(ev, 3);
    const out = P.x < -0.3 || P.x > PITCH_L + 0.3 || P.y < -0.3 || P.y > PITCH_W + 0.3 || P.inGoal;
    // Coups de pied arrêtés : le ballon est posé.
    if (ev.type === 'kickoff') { this.holder = null; this.inHands = false; this.place(PITCH_L / 2, PITCH_W / 2); return null; }
    if (ev.type === 'corner') { this.holder = null; this.inHands = false; this.place(goalX - gdir * 0.4, ty < PITCH_W / 2 ? 0.4 : PITCH_W - 0.4); return null; }
    if (ev.type === 'penalty') { this.holder = null; this.inHands = false; this.place(goalX - gdir * 11, PITCH_W / 2); return null; }
    if (ev.type === 'freekick') {
      // Coup franc à l'endroit de la faute (vue), pas à un point théorique.
      const at = this.foulAt || { x: tx, y: ty };
      this.foulAt = null;
      this.holder = null; this.inHands = false; this.place(at.x, at.y); return null;
    }
    const kicks = ['pass', 'longpass', 'cross', 'cornerkick', 'clearance', 'header', 'shot', 'dribble'];
    if (!kicks.includes(ev.type)) {
      // Faute, carton, hors-jeu… : jeu arrêté, le ballon finit sa course sans être relancé.
      if (['foul', 'offside', 'yellow', 'red', 'injury'].includes(ev.type)) { this.holder = null; this.pending = null; P.vx *= 0.1; P.vy *= 0.1; P.vz = Math.min(P.vz, 0); P.spin = 0; }
      return null;
    }
    // Le ballon part du pied de l'acteur (s'il était sorti, ou un peu loin : remise en jeu, il est replacé).
    // Ballon sorti (remise en jeu) ou dans les mains du gardien : il repart de l'acteur.
    if (actor && (out || this.inHands)) {
      const f = this.footOf(actor);
      Object.assign(P, { x: f.x, y: f.y, z: this.inHands && actor.gk ? 1.0 : BALL_R, vx: 0, vy: 0, vz: 0, inGoal: 0 });
    }
    this.inHands = false;
    this.holder = null;
    if (ev.type !== 'shot') this.shotOutcome = null;
    const head = ev.type === 'header' || (ev.type === 'shot' && ev.kind === 'header');
    // Tête : le joueur saute vers le ballon (on ne déplace pas le ballon vers lui).
    if (head && actor) { actor.jump = 0.45; actor.tx = P.x / PITCH_L; actor.ty = P.y / PITCH_W; }
    const dist = Math.hypot(tx - P.x, ty - P.y);
    if (actor) { actor.kick = 0.32; actor.kickPow = ev.type === 'shot' ? 1 : ev.type === 'pass' ? 0.45 : 0.75; this.faceTo(actor, tx / PITCH_L, ty / PITCH_W); }
    // Passe vers un coéquipier : on vise là où il est réellement (et où il se dirige), pas un point théorique.
    let tx2 = tx, ty2 = ty;
    if (recv && recv !== actor && ['pass', 'longpass', 'cross', 'cornerkick', 'header'].includes(ev.type)) {
      const lead = Math.min(1.2, Math.hypot(recv.x * PITCH_L - P.x, recv.y * PITCH_W - P.y) / 18);
      tx2 = Math.max(1, Math.min(PITCH_L - 1, recv.x * PITCH_L + (recv.vx || 0) * lead * 0.6));
      ty2 = Math.max(1, Math.min(PITCH_W - 1, recv.y * PITCH_W + (recv.vy || 0) * lead * 0.6));
    }
    const receive = (T) => { if (recv) { this.pending = { at: this.physT + T, kind: 'receive', who: recv.mp.id }; recv.tx = tx2 / PITCH_L; recv.ty = ty2 / PITCH_W; } return T; };
    switch (ev.type) {
      case 'dribble':
        this.holder = ev.pid; if (actor) { actor.tx = tx / PITCH_L; actor.ty = ty / PITCH_W; }
        return null;
      case 'pass':
        return receive(solveKick(P, { x: tx2, y: ty2 }, { mode: 'ground', arrive: Math.min(12, 6 + dist * 0.16) }));
      case 'longpass':
        return receive(solveKick(P, { x: tx2, y: ty2, z: 0.3 + r1 * 1.3 }, { T: 1.0 + dist / 30, spin: (r2 - 0.5) * 8, top: 2 }));
      case 'cross': case 'cornerkick': {
        // Centre rentrant ou sortant : l'effet fait tourner le ballon vers le but (ou l'en écarte).
        const vy = ty - P.y, swing = r2 < 0.65 ? 1 : -1;
        const spin = -Math.sign(vy || 1) * gdir * swing * (7 + r3 * 5);
        return receive(solveKick(P, { x: tx2, y: ty2, z: 1.7 + r1 * 0.6 }, { T: (ev.type === 'cornerkick' ? 1.15 : 0.9) + dist / 32, spin }));
      }
      case 'clearance':
        return receive(solveKick(P, { x: tx, y: ty, z: BALL_R }, { T: 1.6 + dist / 38, spin: (r1 - 0.5) * 6, top: 1.5 }));
      case 'header':
        return receive(solveKick(P, { x: tx2, y: ty2, z: 0.4 + r1 * 0.8 }, { T: 0.45 + dist / 22 }));
      case 'shot': return this.shot(ev, actor, r1, r2, r3, goalX, gdir);
    }
    return null;
  }

  /** Tir : la cible dépend de l'issue décidée par le moteur (but, arrêt, poteau, à côté, contré). */
  shot(ev, actor, r1, r2, r3, goalX, gdir) {
    const P = this.phys, cy = PITCH_W / 2;
    const kind = ev.kind;
    const ySide = Math.max(-1, Math.min(1, ((ev.y ?? 0.5) - 0.5) * 68 / GOAL_HALF)) || (r2 < 0.5 ? -0.6 : 0.6);
    let tgt, speed = kind === 'penalty' ? 24 : kind === 'header' ? 13 : kind === 'freekick' ? 23 : 25 + r1 * 7;
    let spin = 0, top = 0;
    if (kind === 'freekick') { spin = (r2 < 0.5 ? 1 : -1) * (8 + r3 * 4); top = -3; }
    else if (kind !== 'penalty' && kind !== 'header') { spin = (r3 - 0.5) * 7; top = r2 < 0.35 ? -3 : 0; }
    const gk = [...this.players.values()].find((p) => p.gk && p.team.side !== ev.side);
    const o = ev.outcome;
    if (o === 'goal') tgt = { x: goalX + gdir * 0.9, y: cy + ySide * (GOAL_HALF - 0.45), z: 0.2 + r1 * 1.95 };
    else if (o === 'saved') tgt = { x: goalX - gdir * 0.7, y: cy + ySide * (GOAL_HALF - 1.2) * (0.3 + r3 * 0.7), z: 0.25 + r1 * 1.6 };
    else if (o === 'post') tgt = r1 < 0.3 ? { x: goalX, y: cy + ySide * 2.5, z: 2.5 } : { x: goalX, y: cy + Math.sign(ySide || 1) * (GOAL_HALF + 0.12), z: 0.4 + r2 * 1.6 };
    else if (o === 'blocked') tgt = { x: (ev.x ?? 0.84) * PITCH_L, y: (ev.y ?? 0.5) * PITCH_W, z: 0.3 + r1 * 0.6 };
    else {
      const yAbs = ((ev.y ?? 0.5) - 0.5) * PITCH_W;
      tgt = Math.abs(yAbs) < GOAL_HALF + 0.5 ? { x: goalX + gdir * 0.6, y: cy + yAbs, z: 2.9 + r2 * 1.5 } : { x: goalX + gdir * 0.6, y: cy + yAbs, z: 0.3 + r2 * 1.4 };
    }
    const d = Math.hypot(tgt.x - P.x, tgt.y - P.y, (tgt.z ?? 0) - P.z);
    const T = solveKick(P, tgt, { T: Math.max(0.25, d / speed), spin, top });
    this.shotOutcome = o; // un tir non marqué ne doit jamais finir au fond des filets
    if (o === 'saved' && gk) {
      const catchIt = speed < 27 && r2 < 0.55 && Math.abs(tgt.y - cy) < 2.2;
      this.pending = { at: this.physT + T, kind: 'save', who: gk.mp.id, catch: catchIt, r: r3 };
    } else if (o === 'blocked') {
      this.pending = { at: this.physT + T, kind: 'block', r: r3 };
    }
    // Le gardien se place sur la trajectoire et plonge au bon moment (trop tard s'il y a but).
    if (gk && o !== 'blocked') {
      const reach = o === 'goal' ? 0.55 : 1;
      gk.tx = (goalX - gdir * 0.8) / PITCH_L;
      gk.ty = (cy + (tgt.y - cy) * (o === 'saved' ? 0.55 : 0.15)) / PITCH_W;
      gk.diveIn = Math.max(0, T / this.TS - 0.32);
      gk.diveDir = 0; gk.diveTo = { x: tgt.x, y: tgt.y, z: tgt.z, reach };
    }
    return T;
  }

  /** Avance le ballon : touches de balle du porteur, physique, contrôles et arrêts. */
  stepPhysics(dt) {
    const P = this.phys;
    this.physT += dt;
    const h = this.holder != null ? this.players.get(this.holder) : null;
    let glued = false;
    if (h && this.inHands) {
      glued = true;
      const f = this.footOf(h, 0.35);
      Object.assign(P, { x: f.x, y: f.y, z: 1.05, vx: 0, vy: 0, vz: 0 });
    } else if (h) {
      // Conduite : le ballon reste au pied du porteur ; à chaque foulée, une touche le pousse
      // un peu devant puis il revient (il ne part jamais seul).
      const sp = h.speed || 0;
      const f0 = this.footOf(h, 0.5);
      const near = P.z < 0.6 && Math.hypot(f0.x - P.x, f0.y - P.y) < (h.hasBall ? 1.6 : 1.0);
      h.hasBall = near;
      if (near) {
        glued = true;
        h.dribT = (h.dribT || 0) + dt;
        const per = 0.55;
        const cyc = sp > 1.4 ? (h.dribT % per) / per : 0;
        if (sp > 1.4 && cyc < (h.lastCyc ?? 0)) h.touch = 0.16;
        h.lastCyc = cyc;
        const f = this.footOf(h, 0.45 + (sp > 1.4 ? Math.min(1.1, sp * 0.13) * Math.sin(cyc * Math.PI) : 0));
        const k = Math.min(1, dt * 14);
        const nx = P.x + (f.x - P.x) * k, ny = P.y + (f.y - P.y) * k;
        P.vx = (nx - P.x) / Math.max(dt, 1e-4); P.vy = (ny - P.y) / Math.max(dt, 1e-4);
        P.x = nx; P.y = ny; P.z = BALL_R; P.vz = 0; P.spin = 0; P.top = 0;
        P.rot.a += (Math.hypot(P.vx, P.vy) / BALL_R) * dt; P.rot.b = Math.atan2(P.vy, P.vx);
      } else {
        // Le ballon lui a échappé : il court le récupérer.
        h.tx = P.x / PITCH_L; h.ty = P.y / PITCH_W;
      }
    }
    if (!glued) stepBall(P, dt); // ballon libre : physique ; au pied ou dans les mains : il suit le joueur
    // Garde-fou : si le moteur n'a pas accordé le but (arrêt, poteau, à côté, contre), le
    // ballon ne franchit pas la ligne : il est repoussé (sur la ligne, par le gardien ou le montant).
    if (P.inGoal && this.shotOutcome !== 'goal') {
      const gx = P.inGoal > 0 ? PITCH_L : 0, d = P.inGoal > 0 ? -1 : 1;
      P.x = gx + d * 0.3; P.vx = d * Math.max(3, Math.abs(P.vx) * 0.3); P.vy *= 0.5; P.vz = Math.max(P.vz, 1.5); P.inGoal = 0; P.spin = 0;
    }
    if (P.hitPost && !this._postShake) { this.cam.shake = 0.5; this._postShake = true; }
    if (!P.hitPost) this._postShake = false;
    // Fin de trajectoire prévue : contrôle, arrêt ou contre.
    const pd = this.pending;
    if (pd && this.physT >= pd.at) {
      this.pending = null;
      if (pd.kind === 'receive') {
        // Le receveur poursuit le ballon jusqu'au contrôle (voir plus bas).
        this.pending = { ...pd, kind: 'chase' };
      } else if (pd.kind === 'save') {
        const g = this.players.get(pd.who);
        // Il ne capte que s'il est vraiment au ballon (sinon le ballon « sauterait » dans ses mains).
        const gf = g ? this.footOf(g, 0.3) : null;
        const reach = gf ? Math.hypot(gf.x - P.x, gf.y - P.y) : 99;
        if (pd.catch && reach < 1.8) { this.holder = pd.who; this.inHands = true; P.vx = P.vy = P.vz = 0; P.spin = 0; }
        else {
          // Parade : le ballon est repoussé sur le côté.
          const sx = Math.sign(P.y - PITCH_W / 2) || 1;
          P.vx = -P.vx * 0.25; P.vy = sx * (5 + pd.r * 6); P.vz = 2 + pd.r * 4; P.spin = 0; P.top = 0;
        }
        if (g) g.saveFx = 0.4;
      } else if (pd.kind === 'block') {
        P.vx = -P.vx * 0.25; P.vy += (pd.r - 0.5) * 9; P.vz = 1.2 + pd.r * 2; P.spin = 0;
      }
    }
    // Ballon libre qui roule sans destinataire (dégagement, parade, contre) : le joueur désigné
    // par le moteur, sinon le plus proche du point d'arrêt, va le chercher.
    if (!this.holder && !this.pending && !this.approach && !P.inGoal && Math.hypot(P.vx, P.vy) > 0.5
      && P.x > 0 && P.x < PITCH_L && P.y > 0 && P.y < PITCH_W && this.cur?.type !== 'shot' && this.cur?.type !== 'goal') {
      const stopT = Math.min(2, Math.hypot(P.vx, P.vy) / 3);
      const sx = P.x + P.vx * stopT * 0.6, sy = P.y + P.vy * stopT * 0.6;
      let who = this.players.get(this.cur?.carrier);
      if (!who) {
        let bd = Infinity;
        for (const p of this.players.values()) {
          if (p.gk && Math.hypot(p.x * PITCH_L - sx, p.y * PITCH_W - sy) > 12) continue;
          const d = Math.hypot(p.x * PITCH_L - sx, p.y * PITCH_W - sy);
          if (d < bd) { bd = d; who = p; }
        }
      }
      if (who) this.pending = { kind: 'chase', who: who.mp.id };
    }
    // Ballon à récupérer : le receveur court dessus et le contrôle dès qu'il l'atteint.
    const pc = this.pending;
    if (pc && (pc.kind === 'chase' || pc.kind === 'receive')) {
      const r = this.players.get(pc.who);
      if (!r) this.pending = null;
      else {
        const f = this.footOf(r, 0.5);
        const d = Math.hypot(f.x - P.x, f.y - P.y);
        if (P.z < 1.3 && d < (pc.kind === 'chase' ? 1.3 : 0.9)) {
          // Contrôle : le ballon est amorti.
          P.vx *= 0.2; P.vy *= 0.2; P.vz = Math.min(0, P.vz) * 0.2; P.spin = 0;
          this.holder = pc.who; r.touch = 0.2; this.pending = null;
        } else if (pc.kind === 'chase') {
          // Il vise l'endroit où le ballon va s'arrêter (ou le ballon lui-même s'il est lent).
          const sp = Math.hypot(P.vx, P.vy);
          const ahead = Math.min(1.2, sp / 6);
          r.tx = Math.max(0, Math.min(1, (P.x + P.vx * ahead) / PITCH_L)); r.ty = Math.max(0, Math.min(1, (P.y + P.vy * ahead) / PITCH_W));
        }
      }
    }
    // Lecture par les rendus 2D / 3D.
    const b = this.ball;
    b.x = P.x / PITCH_L; b.y = P.y / PITCH_W; b.h = Math.max(0, P.z - BALL_R) / 26;
  }

  updateIdle(dt) {
    if (this.live) { this.updateFx(dt); return; }
    this.movePlayers(dt * 0.6);
    this.updateFx(dt);
  }

  /**
   * Déplacements "physiques" : accélération limitée, vitesse max selon la vitesse
   * du joueur et sa fatigue, freinage à l'approche de la cible.
   */
  movePlayers(dt) {
    const L = PITCH_L, W = PITCH_W;
    const step = (p, maxSp) => {
      const dx = (p.tx - p.x) * L, dy = (p.ty - p.y) * W;
      const dist = Math.hypot(dx, dy);
      // Vitesse voulue : freinage naturel à l'approche (v = √(2·a·d)), plafonnée par la pointe.
      const want = dist < 0.15 ? 0 : Math.min(maxSp, Math.sqrt(2 * 6 * dist));
      const dvx = dist > 0.01 ? (dx / dist) * want : 0, dvy = dist > 0.01 ? (dy / dist) * want : 0;
      // Accélération limitée (≈ 5 m/s² pour partir, 8 m/s² pour freiner) : pas de démarrage instantané.
      const ax = dvx - p.vx, ay = dvy - p.vy, am = Math.hypot(ax, ay);
      const lim = (want > (p.speed || 0) ? 5.2 : 8.5) * dt;
      const before = p.speed || 0;
      if (am > lim) { p.vx += (ax / am) * lim; p.vy += (ay / am) * lim; } else { p.vx = dvx; p.vy = dvy; }
      p.x += (p.vx * dt) / L; p.y += (p.vy * dt) / W;
      p.speed = Math.hypot(p.vx, p.vy);
      p.acc = dt > 0 ? (p.speed - before) / dt : 0;
      // Orientation : vers où il court, sinon vers le ballon.
      const target = p.speed > 1.2 ? Math.atan2(p.vy, p.vx) : Math.atan2((this.ball.y - p.y) * W, (this.ball.x - p.x) * L);
      let d = target - p.face;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      p.face += d * Math.min(1, dt * 7);
      // Foulée : plus ample (moins de pas par mètre) quand il sprinte.
      p.phase += p.speed * dt * (2.3 + 1.6 * (1 - Math.min(1, p.speed / 8)));
    };
    for (const p of this.players.values()) {
      const vit = p.mp?.p?.attrs?.vit ?? 60, en = p.mp?.energy ?? 100;
      // Pointe de vitesse réelle : 7,9 à 9,6 m/s selon l'attribut, moins en fin de match.
      step(p, (6.6 + vit * 0.033) * (0.8 + 0.2 * en / 100) * (p.celeb > 0 ? 0.8 : 1));
      p.alpha = Math.min(1, (p.alpha ?? 1) + dt * 2);
      // Les gestes durent un temps « d'affichage » (indépendant de l'accéléré).
      const gd = dt / this.TS;
      if (p.diveIn != null) { p.diveIn -= gd; if (p.diveIn <= 0) { p.diveIn = null; this.startDive(p); } }
      for (const k of ['kick', 'slide', 'dive', 'jump', 'celeb', 'touch', 'saveFx', 'fall', 'block']) if (p[k] > 0) p[k] = Math.max(0, p[k] - gd);
    }
    // Contacts : deux joueurs ne se traversent pas (ils se repoussent à moins de 1,1 m),
    // sauf le tacleur qui va au duel.
    const arr = [...this.players.values()];
    for (let i = 0; i < arr.length; i++) {
      for (let j = i + 1; j < arr.length; j++) {
        const a = arr[i], c = arr[j];
        if (a.slide > 0 || c.slide > 0 || a.celeb > 0 || c.celeb > 0) continue;
        const dx = (c.x - a.x) * L, dy = (c.y - a.y) * W, d = Math.hypot(dx, dy);
        if (d > 1.1 || d < 1e-4) continue;
        const push = (1.1 - d) * 0.5, ux = dx / d, uy = dy / d;
        a.x -= (ux * push) / L; a.y -= (uy * push) / W;
        c.x += (ux * push) / L; c.y += (uy * push) / W;
      }
    }
    for (const p of this.leaving) { step(p, 3); p.life -= dt / this.TS; }
    this.leaving = this.leaving.filter((p) => p.life > 0);
    // Arbitre : suit le jeu en diagonale, à distance.
    const r = this.referee, b = this.ball;
    r.tx = Math.max(0.08, Math.min(0.92, b.x - 0.1)); r.ty = Math.max(0.1, Math.min(0.9, b.y + (b.y < 0.5 ? 0.18 : -0.18)));
    step(r, 7.5);
  }

  /** Plongeon du gardien vers le ballon (direction et hauteur selon la frappe). */
  startDive(gk) {
    const t = gk.diveTo;
    if (!t) return;
    const lateral = (t.y - gk.y * PITCH_W);
    if (Math.abs(lateral) < 0.9 && t.z < 1.6) { gk.dive = 0; gk.block = 0.5; return; } // ballon sur lui : il se couche / bloque
    gk.diveDir = Math.sign(lateral) || 1;
    gk.diveH = Math.min(1, t.z / 2.2);
    gk.dive = 0.75;
    // Il se projette : déplacement latéral pendant le plongeon (moins s'il est battu).
    gk.ty = (gk.y * PITCH_W + lateral * t.reach * 0.9) / PITCH_W;
  }

  updateFx(dt) {
    // Caméra : suit le ballon dans l'axe du terrain, légère.
    const [bx0, by] = this.toScreen(this.ball.x, this.ball.y);
    const target = this.landscape ? bx0 / (this.canvas.width || 1) : by / (this.canvas.height || 1);
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
    if (this.landscape) {
      // On dessine le terrain en portrait puis on le fait pivoter (le terrain est symétrique, sans texte).
      const p = this.drawPortraitPitch(this.canvas.height, this.canvas.width, this.padY, this.padX);
      const c = document.createElement('canvas');
      c.width = this.canvas.width; c.height = this.canvas.height;
      const g = c.getContext('2d');
      g.setTransform(0, 1, -1, 0, c.width, 0);
      g.drawImage(p, 0, 0);
      this.pitchCache = c;
      return;
    }
    this.pitchCache = this.drawPortraitPitch(this.canvas.width, this.canvas.height, this.padX, this.padY);
  }

  drawPortraitPitch(width, height, padX, padY) {
    const c = document.createElement('canvas');
    c.width = width; c.height = height;
    const g = c.getContext('2d');
    const s = this.scale;
    this._px = padX; this._py = padY;
    const fm = this.style === 'fm';
    // Fond et bandes de tonte (plus sobres en vue 2D).
    g.fillStyle = fm ? '#2a7444' : '#1f6b3a';
    g.fillRect(0, 0, c.width, c.height);
    const stripes = 12;
    for (let i = 0; i < stripes; i++) {
      g.fillStyle = fm ? (i % 2 ? '#2f7d4a' : '#2b7646') : i % 2 ? '#237a42' : '#1f703d';
      g.fillRect(padX, padY + (i * PITCH_L * s) / stripes, PITCH_W * s, (PITCH_L * s) / stripes + 1);
    }
    g.strokeStyle = 'rgba(255,255,255,0.82)';
    g.lineWidth = Math.max(1, 0.18 * s);
    const X = (m) => padX + m * s, Y = (m) => padY + m * s;
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
    return c;
  }

  draw() {
    if (this.style === '3d' && this.r3d) return this.draw3D();
    if (this.style === 'fm' || this.style === '3d') return this.drawFM();
    const g = this.ctx, W = this.canvas.width, H = this.canvas.height;
    if (!this.pitchCache) this.drawPitch();
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = '#1f6b3a';
    g.fillRect(0, 0, W, H);
    // Caméra : léger zoom centré sur le ballon (vertical), tremblement au but.
    const z = this.cam.zoom;
    const sh = this.cam.shake * 7 * this.dpr;
    const ox = (Math.random() - 0.5) * sh, oy = (Math.random() - 0.5) * sh;
    if (this.landscape) {
      const cx = Math.max(W / (2 * z), Math.min(W - W / (2 * z), this.cam.y * W));
      g.setTransform(z, 0, 0, z, W / 2 - cx * z + ox, H / 2 - (H / 2) * z + oy);
    } else {
      const cy = Math.max(H / (2 * z), Math.min(H - H / (2 * z), this.cam.y * H));
      g.setTransform(z, 0, 0, z, W / 2 - (W / 2) * z + ox, H / 2 - cy * z + oy);
    }
    g.drawImage(this.pitchCache, 0, 0);

    const r = (this.landscape ? 2.15 : 2) * this.scale; // rayon d'un joueur : agrandi pour la lisibilité
    const T = g.getTransform();
    this.view = { z: T.a, tx: T.e, ty: T.f };
    // Joueurs sortants, arbitre, puis les 22 joueurs.
    for (const p of this.leaving) this.drawPlayer(g, p, r, Math.max(0, p.life / 1.6));
    this.drawPlayer(g, { ...this.referee, ref: true, side: 0 }, r * 0.85, 0.95, false);
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
    this.drawLabels(g, r);
    // Étiquettes d'action (au-dessus).
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
    if (this.replaying) {
      // Effet ralenti : bandes et pastille "RALENTI".
      g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(0, 0, W, H * 0.05); g.fillRect(0, H * 0.95, W, H * 0.05);
      g.fillStyle = '#e63946'; g.beginPath(); g.arc(W * 0.07, H * 0.025, H * 0.009, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#fff'; g.font = `700 ${Math.round(H * 0.024)}px system-ui, sans-serif`; g.textAlign = 'left'; g.textBaseline = 'middle';
      g.fillText('RALENTI', W * 0.1, H * 0.026); g.textBaseline = 'alphabetic';
    }
  }

  /**
   * Vue 2D façon Football Manager : terrain entier fixe, joueurs en pastilles
   * numérotées, ballon avec traînée, seuls les noms utiles affichés.
   */
  drawFM() {
    const g = this.ctx, W = this.canvas.width, H = this.canvas.height;
    if (!this.pitchCache) this.drawPitch();
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = '#2a7444';
    g.fillRect(0, 0, W, H);
    g.drawImage(this.pitchCache, 0, 0);
    this.view = { z: 1, tx: 0, ty: 0 };
    const r = (this.landscape ? 2.05 : 1.9) * this.scale;
    // Traînée du ballon.
    const [bx, by] = this.toScreen(this.ball.x, this.ball.y);
    this.trail.push([bx, by]);
    if (this.trail.length > 12) this.trail.shift();
    g.lineCap = 'round';
    for (let i = 1; i < this.trail.length; i++) {
      g.strokeStyle = `rgba(255,255,255,${(i / this.trail.length) * 0.35})`;
      g.lineWidth = r * 0.35 * (i / this.trail.length);
      g.beginPath(); g.moveTo(...this.trail[i - 1]); g.lineTo(...this.trail[i]); g.stroke();
    }
    const carrierId = this.cur ? this.cur.carrier : null;
    for (const p of this.leaving) this.drawDisc(g, p, r, Math.max(0, p.life / 1.6), false, false);
    for (const [id, p] of this.players) this.drawDisc(g, p, r, p.alpha ?? 1, id === carrierId, this.selected === id);
    // Ballon.
    const lift = this.ball.h * 40 * this.scale;
    g.fillStyle = 'rgba(0,0,0,0.3)';
    g.beginPath(); g.arc(bx + lift * 0.25, by + lift * 0.15, r * 0.38, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#fff';
    g.beginPath(); g.arc(bx, by - lift, r * (0.42 + this.ball.h), 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#111'; g.lineWidth = r * 0.1; g.stroke();
    // Noms : tous (petits), ou seulement le porteur du ballon et le joueur touché.
    this.drawFMLabels(g, r, carrierId);
    if (this.banner) this.drawBanner(g, W, H);
    if (this.replaying) {
      g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(0, 0, W, H * 0.05); g.fillRect(0, H * 0.95, W, H * 0.05);
      g.fillStyle = '#fff'; g.font = `700 ${Math.round(H * 0.024)}px system-ui, sans-serif`; g.textAlign = 'left'; g.textBaseline = 'middle';
      g.fillText('● RALENTI', W * 0.03, H * 0.026); g.textBaseline = 'alphabetic';
    }
  }

  /** Vue 3D : rendu WebGL, puis bandeaux (BUT, cartons, ralenti) sur le canevas 2D transparent posé dessus. */
  draw3D() {
    this.r3d.render(this.lastDt || 0.016);
    const g = this.ctx, W = this.canvas.width, H = this.canvas.height;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, W, H);
    if (this.banner) this.drawBanner(g, W, H);
    if (this.replaying) {
      g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(0, 0, W, H * 0.05); g.fillRect(0, H * 0.95, W, H * 0.05);
      g.fillStyle = '#fff'; g.font = `700 ${Math.round(H * 0.024)}px system-ui, sans-serif`; g.textAlign = 'left'; g.textBaseline = 'middle';
      g.fillText('● RALENTI', W * 0.03, H * 0.026); g.textBaseline = 'alphabetic';
    }
  }

  /** Pastille de joueur (vue 2D). */
  drawDisc(g, p, r, alpha, isCarrier, selected) {
    const [x, y] = this.toScreen(p.x, p.y);
    const fill = p.gk ? this.gkColors[p.side] : this.colors[p.side];
    g.globalAlpha = alpha;
    g.fillStyle = 'rgba(0,0,0,0.25)';
    g.beginPath(); g.arc(x + r * 0.12, y + r * 0.18, r, 0, Math.PI * 2); g.fill();
    if (isCarrier || selected) {
      g.strokeStyle = selected ? '#ffd166' : 'rgba(255,255,255,0.95)';
      g.lineWidth = r * 0.22;
      g.beginPath(); g.arc(x, y, r * 1.38, 0, Math.PI * 2); g.stroke();
    }
    g.fillStyle = fill;
    g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
    g.strokeStyle = luminance(fill) > 0.6 ? 'rgba(0,0,0,0.65)' : 'rgba(255,255,255,0.85)';
    g.lineWidth = r * 0.14; g.stroke();
    g.fillStyle = p.gk ? '#111' : this.textColors[p.side];
    g.font = `800 ${Math.round(r * 1.05)}px "Barlow Condensed", system-ui, sans-serif`;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(String(p.num ?? ''), x, y + r * 0.05);
    g.textBaseline = 'alphabetic';
    g.globalAlpha = 1;
  }

  drawFMLabels(g, r, carrierId) {
    if (this.labelMode === 'none') return;
    const fs = Math.max(9 * this.dpr, Math.round(r * 0.9));
    g.font = `700 ${fs}px "Barlow Condensed", system-ui, sans-serif`;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    const boxes = [];
    const all = this.labelMode === 'name';
    const list = [...this.players.entries()].sort((a, b) => (b[0] === carrierId) - (a[0] === carrierId) || (b[0] === this.selected) - (a[0] === this.selected));
    for (const [id, p] of list) {
      const hl = id === carrierId || id === this.selected;
      if (!all && !hl) continue;
      const [x, y] = this.toScreen(p.x, p.y);
      const text = p.short;
      const w = g.measureText(text).width + fs * 0.7, h = fs * 1.3;
      const box = { x: x - w / 2, y: y + r * 1.25, w, h };
      if (!hl && boxes.some((o) => box.x < o.x + o.w && box.x + box.w > o.x && box.y < o.y + o.h && box.y + box.h > o.y)) continue;
      boxes.push(box);
      g.fillStyle = hl ? 'rgba(10,14,20,0.9)' : 'rgba(10,14,20,0.55)';
      g.beginPath(); g.roundRect ? g.roundRect(box.x, box.y, w, h, h / 2) : g.rect(box.x, box.y, w, h); g.fill();
      g.fillStyle = hl ? '#ffd166' : 'rgba(255,255,255,0.85)';
      g.fillText(text, x, box.y + h / 2 + fs * 0.04);
    }
    g.textBaseline = 'alphabetic';
  }

  /** Angle écran correspondant à une orientation terrain (radians, en mètres). */
  screenAngle(p) {
    const [x1, y1] = this.toScreen(p.x, p.y);
    const [x2, y2] = this.toScreen(p.x + Math.cos(p.face) * 0.8 / PITCH_L, p.y + Math.sin(p.face) * 0.8 / PITCH_W);
    return Math.atan2(y2 - y1, x2 - x1);
  }

  /** Silhouette vue de dessus : jambes et bras animés, maillot, short, tête, numéro dans le dos. */
  drawPlayer(g, p, r, alpha, isCarrier) {
    const [x, y] = this.toScreen(p.x, p.y);
    const ang = this.screenAngle(p);
    const shirt = p.ref ? '#14171c' : p.gk ? this.gkColors[p.side] : this.colors[p.side];
    const shorts = p.ref ? '#14171c' : p.gk ? '#20242c' : this.shorts[p.side];
    const run = Math.min(1, (p.speed || 0) / 7);
    const swing = Math.sin(p.phase || 0) * r * 0.55 * run;
    const jump = p.jump > 0 ? 1 + Math.sin((p.jump / 0.45) * Math.PI) * 0.28 : 1;
    g.globalAlpha = alpha;
    // Ombre (décalée quand le joueur saute).
    g.fillStyle = 'rgba(0,0,0,0.28)';
    g.beginPath(); g.ellipse(x + r * 0.2 * jump, y + r * 0.3 * jump, r * 0.95, r * 0.7, 0, 0, Math.PI * 2); g.fill();
    if (isCarrier || this.selected === p.mp?.id) {
      g.strokeStyle = this.selected === p.mp?.id ? '#ffd166' : 'rgba(255,255,255,0.85)';
      g.lineWidth = r * 0.16;
      g.beginPath(); g.arc(x, y, r * 1.55, 0, Math.PI * 2); g.stroke();
    }
    g.save();
    g.translate(x, y);
    g.rotate(ang);
    g.scale(jump, jump);
    const sock = shorts;
    if (p.dive > 0) {
      // Plongeon du gardien : corps allongé sur le côté.
      const k = Math.sin((p.dive / 0.75) * Math.PI);
      g.rotate(p.diveDir * k * 1.2);
      g.fillStyle = shirt;
      g.beginPath(); g.ellipse(0, 0, r * 0.55, r * (0.8 + k * 0.9), 0, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#f5f5f5';
      g.beginPath(); g.arc(0, -p.diveDir * r * (1.35 + k * 0.5), r * 0.26, 0, Math.PI * 2); g.fill();
      g.beginPath(); g.arc(0, p.diveDir * -r * (1.0 + k * 0.4) + r * 0.3, r * 0.22, 0, Math.PI * 2); g.fill();
    } else {
      const slide = p.slide > 0 ? Math.sin((p.slide / 0.55) * Math.PI) : 0;
      const kick = p.kick > 0 ? Math.sin((p.kick / 0.32) * Math.PI) : 0;
      const stride = swing * 1.5;
      // Pieds : dépassent du torse pendant la course, la frappe ou le tacle.
      const feet = [[stride + slide * r * 1.2, r * 0.36], [-stride + kick * r * 1.15 + slide * r * 0.8, -r * 0.36]];
      g.fillStyle = sock;
      for (const [fx, fy] of feet) { g.beginPath(); g.ellipse(fx, fy, r * 0.3, r * 0.19, 0, 0, Math.PI * 2); g.fill(); }
      g.fillStyle = '#111';
      for (const [fx, fy] of feet) { g.beginPath(); g.ellipse(fx + r * 0.18, fy, r * 0.13, r * 0.13, 0, 0, Math.PI * 2); g.fill(); }
      // Bras : opposés aux jambes, levés pendant la célébration.
      const up = p.celeb > 0 ? 1 : 0;
      for (const sgn of [1, -1]) {
        const ax = up ? r * 0.55 : -swing * 0.9 * sgn;
        const ay = sgn * r * (up ? 0.95 : 0.74);
        g.fillStyle = shirt;
        g.beginPath(); g.arc(ax, ay, r * 0.22, 0, Math.PI * 2); g.fill();
        g.fillStyle = p.skin || '#c68642';
        g.beginPath(); g.arc(ax + (up ? r * 0.28 : r * 0.12), ay * (up ? 1.08 : 1), r * 0.14, 0, Math.PI * 2); g.fill();
      }
      // Torse rond (porte le numéro) + liseré.
      g.fillStyle = shirt;
      g.beginPath(); g.arc(slide * r * 0.25, 0, r * 0.72, 0, Math.PI * 2); g.fill();
      g.strokeStyle = p.side === 0 ? 'rgba(255,255,255,0.9)' : 'rgba(10,10,10,0.8)';
      g.lineWidth = r * 0.11; g.stroke();
      // Tête à l'avant : indique l'orientation.
      g.fillStyle = p.skin || '#c68642';
      g.beginPath(); g.arc(r * 0.66 + slide * r * 0.3, 0, r * 0.27, 0, Math.PI * 2); g.fill();
      g.fillStyle = p.hair || '#2b1d14';
      g.beginPath(); g.arc(r * 0.62 + slide * r * 0.3, 0, r * 0.26, Math.PI * 0.5, Math.PI * 1.5); g.fill();
    }
    g.restore();
    // Numéro sur le torse (toujours à l'endroit).
    if (!p.ref && p.dive <= 0 && r > 4) {
      const bx = x - Math.cos(ang) * r * 0.06 * jump, by = y - Math.sin(ang) * r * 0.06 * jump;
      g.fillStyle = p.gk ? '#111' : this.textColors[p.side];
      g.font = `800 ${Math.round(r * 0.92)}px "Barlow Condensed", system-ui, sans-serif`;
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(String(p.num ?? ''), bx, by + r * 0.04);
      g.textBaseline = 'alphabetic';
    }
    g.globalAlpha = 1;
  }

  /** Étiquettes sous les joueurs (nom ou numéro), en évitant les chevauchements. */
  drawLabels(g, r) {
    if (this.labelMode === 'none') return;
    const fs = Math.max(9 * this.dpr, Math.round(r * 0.85));
    g.font = `700 ${fs}px "Barlow Condensed", system-ui, sans-serif`;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    const boxes = [];
    const carrierId = this.cur ? this.cur.carrier : null;
    const list = [...this.players.entries()].sort((a, b) => (b[0] === carrierId) - (a[0] === carrierId));
    for (const [id, p] of list) {
      const [x, y] = this.toScreen(p.x, p.y);
      const text = this.labelMode === 'num' ? String(p.num ?? '') : p.short;
      const w = g.measureText(text).width + fs * 0.6, h = fs * 1.25;
      let ly = y + r * 1.2 + h / 2;
      let box = { x: x - w / 2, y: ly - h / 2, w, h };
      const hit = (b) => boxes.some((o) => b.x < o.x + o.w && b.x + b.w > o.x && b.y < o.y + o.h && b.y + b.h > o.y);
      if (hit(box)) { ly = y - r * 1.5 - h / 2; box = { x: x - w / 2, y: ly - h / 2, w, h }; }
      if (hit(box) && id !== carrierId && this.selected !== id) continue;
      boxes.push(box);
      const hl = id === carrierId || this.selected === id;
      g.globalAlpha = hl ? 1 : 0.82;
      g.fillStyle = hl ? this.colors[p.side] : 'rgba(6,12,9,0.72)';
      g.beginPath(); g.roundRect ? g.roundRect(box.x, box.y, w, h, h / 2) : g.rect(box.x, box.y, w, h); g.fill();
      g.fillStyle = hl ? this.textColors[p.side] : '#fff';
      g.fillText(text, x, ly + fs * 0.04);
    }
    g.globalAlpha = 1;
    g.textBaseline = 'alphabetic';
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
