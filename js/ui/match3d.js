/**
 * MATCH EN 3D (three.js) : stade, tribunes, buts avec filets, joueurs 3D animés
 * (course, frappe, tacle, plongeon, saut, célébration), caméras « télé ».
 *
 * Ce module ne fait QUE le rendu : il lit l'état animé de MatchView (joueurs, ballon,
 * période) — la logique d'animation et le moteur restent communs aux vues 2D et 3D.
 */
import * as THREE from '../vendor/three.module.min.js';

const L = 105, W = 68;
const K = 1.25;              // agrandissement des joueurs (lisibilité sur téléphone)
const BALL_R = 0.11 * 2.2;   // ballon agrandi lui aussi

function canvasTex(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Texture du terrain : bandes de tonte et lignes réglementaires. */
function pitchTexture(maxAniso) {
  const PAD = 5, S = 18; // pixels par mètre
  const tex = canvasTex((L + PAD * 2) * S, (W + PAD * 2) * S, (g, cw, ch) => {
    g.fillStyle = '#2e7d45'; g.fillRect(0, 0, cw, ch);
    const n = 18;
    for (let i = 0; i < n; i++) { g.fillStyle = i % 2 ? '#338a4c' : '#2c7a43'; g.fillRect(PAD * S + (i * L * S) / n, 0, (L * S) / n + 1, ch); }
    const X = (m) => (PAD + m) * S, Y = (m) => (PAD + m) * S;
    g.strokeStyle = 'rgba(255,255,255,.92)'; g.lineWidth = 0.14 * S; g.fillStyle = 'rgba(255,255,255,.92)';
    g.strokeRect(X(0), Y(0), L * S, W * S);
    g.beginPath(); g.moveTo(X(L / 2), Y(0)); g.lineTo(X(L / 2), Y(W)); g.stroke();
    g.beginPath(); g.arc(X(L / 2), Y(W / 2), 9.15 * S, 0, Math.PI * 2); g.stroke();
    const dot = (x, y) => { g.beginPath(); g.arc(X(x), Y(y), 0.3 * S, 0, Math.PI * 2); g.fill(); };
    dot(L / 2, W / 2);
    for (const left of [true, false]) {
      const x0 = left ? 0 : L, d = left ? 1 : -1;
      g.strokeRect(left ? X(0) : X(L - 16.5), Y((W - 40.3) / 2), 16.5 * S, 40.3 * S);
      g.strokeRect(left ? X(0) : X(L - 5.5), Y((W - 18.3) / 2), 5.5 * S, 18.3 * S);
      dot(x0 + d * 11, W / 2);
      const a0 = Math.acos(5.5 / 9.15);
      g.beginPath();
      if (left) g.arc(X(11), Y(W / 2), 9.15 * S, -(Math.PI / 2 - (Math.PI / 2 - a0)), Math.PI / 2 - (Math.PI / 2 - a0));
      else g.arc(X(L - 11), Y(W / 2), 9.15 * S, Math.PI - a0, Math.PI + a0);
      g.stroke();
    }
    for (const [x, y, a] of [[0, 0, 0], [L, 0, Math.PI / 2], [L, W, Math.PI], [0, W, -Math.PI / 2]]) {
      g.beginPath(); g.arc(X(x), Y(y), 1 * S, a, a + Math.PI / 2); g.stroke();
    }
  });
  tex.anisotropy = maxAniso;
  return { tex, w: L + PAD * 2, h: W + PAD * 2 };
}

/** Foule : points colorés (couleurs des deux clubs dominantes). */
function crowdTexture(c1, c2) {
  return canvasTex(512, 256, (g, w, h) => {
    g.fillStyle = '#1b2230'; g.fillRect(0, 0, w, h);
    const cols = [c1, c1, c2, '#d8d8d8', '#2a2f3a', '#8a6a4a', '#f2c9a0', '#3b3f4c'];
    for (let i = 0; i < 5200; i++) {
      g.fillStyle = cols[(Math.random() * cols.length) | 0];
      g.fillRect(Math.random() * w, Math.random() * h, 2.2, 3);
    }
    g.fillStyle = 'rgba(0,0,0,.22)';
    for (let y = 0; y < h; y += 8) g.fillRect(0, y, w, 1.5);
  });
}

function boardsTexture(names) {
  return canvasTex(2048, 64, (g, w, h) => {
    const cols = ['#0b3d91', '#c1121f', '#111', '#f4a261', '#2a9d8f', '#6a4c93'];
    const words = ['COACH DE POCHE', ...names, 'LIGUE DES ÉTOILES'];
    let x = 0, i = 0;
    while (x < w) {
      const t = words[i % words.length];
      g.fillStyle = cols[i % cols.length]; g.fillRect(x, 0, 340, h);
      g.fillStyle = '#fff'; g.font = '800 34px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(t.toUpperCase().slice(0, 18), x + 170, h / 2 + 2);
      x += 340; i++;
    }
  });
}

function netTexture() {
  const t = canvasTex(64, 64, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    g.strokeStyle = 'rgba(255,255,255,.75)'; g.lineWidth = 2;
    for (let i = 0; i <= w; i += 16) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i, h); g.stroke(); g.beginPath(); g.moveTo(0, i); g.lineTo(w, i); g.stroke(); }
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

function textSprite(text, { color = '#fff', bg = 'rgba(8,12,18,.78)', h = 64 } = {}) {
  const c = document.createElement('canvas');
  const g = c.getContext('2d');
  g.font = `700 ${h * 0.62}px "Barlow Condensed", system-ui, sans-serif`;
  const w = Math.ceil(g.measureText(text).width + h * 0.7);
  c.width = w; c.height = h;
  g.font = `700 ${h * 0.62}px "Barlow Condensed", system-ui, sans-serif`;
  g.fillStyle = bg;
  g.beginPath(); g.roundRect ? g.roundRect(0, 0, w, h, h / 2) : g.rect(0, 0, w, h); g.fill();
  g.fillStyle = color; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, w / 2, h / 2 + 2);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  s.scale.set((w / h) * 0.9, 0.9, 1);
  s.renderOrder = 10;
  return s;
}

function numberTexture(num, shirt, ink) {
  return canvasTex(128, 128, (g, w, h) => {
    g.fillStyle = shirt; g.fillRect(0, 0, w, h);
    g.fillStyle = ink; g.font = '800 92px "Barlow Condensed", system-ui, sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(String(num ?? ''), w / 2, h / 2 + 6);
  });
}

/* ---------------- Joueur 3D ---------------- */

const GEO = {};
function geo() {
  if (GEO.torso) return GEO;
  GEO.torso = new THREE.CylinderGeometry(0.21, 0.17, 0.6, 12);
  GEO.shorts = new THREE.CylinderGeometry(0.19, 0.21, 0.26, 12);
  GEO.thigh = new THREE.CylinderGeometry(0.075, 0.062, 0.42, 8);
  GEO.shin = new THREE.CylinderGeometry(0.06, 0.045, 0.42, 8);
  GEO.boot = new THREE.BoxGeometry(0.24, 0.08, 0.1);
  GEO.upper = new THREE.CylinderGeometry(0.058, 0.05, 0.28, 8);
  GEO.fore = new THREE.CylinderGeometry(0.045, 0.036, 0.3, 8);
  GEO.head = new THREE.SphereGeometry(0.12, 14, 12);
  GEO.hair = new THREE.SphereGeometry(0.128, 14, 12, 0, Math.PI * 2, 0, Math.PI * 0.55);
  GEO.neck = new THREE.CylinderGeometry(0.05, 0.055, 0.1, 8);
  GEO.back = new THREE.PlaneGeometry(0.26, 0.3);
  GEO.shadow = new THREE.CircleGeometry(0.55, 20);
  GEO.ring = new THREE.RingGeometry(0.62, 0.78, 28);
  return GEO;
}

function limb(parent, g, mat, y) {
  const m = new THREE.Mesh(g, mat);
  m.position.y = y;
  parent.add(m);
  return m;
}

class Player3D {
  constructor(mats, skin, hair, num, shirtHex, inkHex) {
    const G = geo();
    this.root = new THREE.Group();
    this.body = new THREE.Group();          // inclinaisons (tacle, plongeon)
    this.root.add(this.body);
    this.body.scale.setScalar(K);
    const skinM = new THREE.MeshLambertMaterial({ color: skin });
    const hairM = new THREE.MeshLambertMaterial({ color: hair });
    const torso = limb(this.body, G.torso, mats.shirt, 1.22);
    torso.scale.set(0.78, 1, 1.25);
    limb(this.body, G.shorts, mats.shorts, 0.86).scale.set(0.85, 1, 1.25);
    limb(this.body, G.neck, skinM, 1.56);
    const head = limb(this.body, G.head, skinM, 1.7);
    const hairMesh = limb(this.body, G.hair, hairM, 1.72);
    hairMesh.position.x = -0.015;
    head.scale.set(1, 1.08, 0.95);
    // Numéro dans le dos (le joueur regarde vers +X).
    const back = new THREE.Mesh(G.back, new THREE.MeshLambertMaterial({ map: numberTexture(num, shirtHex, inkHex) }));
    back.position.set(-0.168, 1.24, 0); back.rotation.y = -Math.PI / 2;
    this.body.add(back);
    // Jambes : hanche → genou → pied.
    this.legs = [-1, 1].map((sgn) => {
      const hip = new THREE.Group(); hip.position.set(0, 0.8, sgn * 0.1); this.body.add(hip);
      limb(hip, G.thigh, skinM, -0.21);
      const knee = new THREE.Group(); knee.position.y = -0.42; hip.add(knee);
      limb(knee, G.shin, mats.socks, -0.21);
      const boot = limb(knee, G.boot, mats.boot, -0.43); boot.position.x = 0.05;
      return { hip, knee };
    });
    // Bras : épaule → coude.
    this.arms = [-1, 1].map((sgn) => {
      const sh = new THREE.Group(); sh.position.set(0, 1.47, sgn * 0.27); this.body.add(sh);
      limb(sh, G.upper, mats.shirt, -0.14);
      const el = new THREE.Group(); el.position.y = -0.28; sh.add(el);
      limb(el, G.fore, skinM, -0.15);
      return { sh, el, sgn };
    });
    this.shadow = new THREE.Mesh(G.shadow, mats.shadow);
    this.shadow.rotation.x = -Math.PI / 2; this.shadow.position.y = 0.02;
    this.root.add(this.shadow);
    this.ring = new THREE.Mesh(G.ring, mats.ring);
    this.ring.rotation.x = -Math.PI / 2; this.ring.position.y = 0.03; this.ring.visible = false;
    this.root.add(this.ring);
  }

  /** Pose à partir de l'état animé de MatchView. */
  pose(p, flip) {
    const face = flip ? p.face + Math.PI : p.face;
    this.root.rotation.y = -face;
    const run = Math.min(1, (p.speed || 0) / 7);
    const ph = p.phase || 0;
    const sw = Math.sin(ph) * 0.85 * run;
    const [lL, lR] = this.legs;
    lL.hip.rotation.z = sw; lR.hip.rotation.z = -sw;
    lL.knee.rotation.z = -(0.15 + 0.9 * Math.max(0, Math.sin(ph + 1.6))) * run;
    lR.knee.rotation.z = -(0.15 + 0.9 * Math.max(0, Math.sin(ph + 1.6 + Math.PI))) * run;
    for (const a of this.arms) { a.sh.rotation.set(0, 0, -a.sgn * 0 + (a.sgn < 0 ? -sw : sw) * 0.8); a.el.rotation.z = 0.5 + 0.5 * run; }
    this.body.rotation.set(0, 0, -0.12 * run);
    this.body.position.set(0, Math.abs(Math.sin(ph)) * 0.05 * run, 0);
    // Frappe : armé puis jambe droite fouette vers l'avant.
    if (p.kick > 0) {
      const t = 1 - p.kick / 0.32;
      lR.hip.rotation.z = t < 0.35 ? -0.9 * (t / 0.35) : -0.9 + 2.3 * ((t - 0.35) / 0.65);
      lR.knee.rotation.z = t < 0.35 ? -1.2 * (t / 0.35) : -1.2 * (1 - (t - 0.35) / 0.65);
      lL.hip.rotation.z = 0.15; lL.knee.rotation.z = -0.2;
      this.body.rotation.z = -0.2;
    }
    // Tacle glissé : corps basculé en arrière, jambes devant.
    if (p.slide > 0) {
      const k = Math.sin((p.slide / 0.55) * Math.PI);
      this.body.rotation.z = -1.25 * k;
      this.body.position.y = -0.55 * k * K;
      lL.hip.rotation.z = 1.2 * k; lR.hip.rotation.z = 0.8 * k;
      lL.knee.rotation.z = 0; lR.knee.rotation.z = -0.6 * k;
    }
    // Plongeon du gardien : sur le côté.
    if (p.dive > 0) {
      const k = Math.sin((p.dive / 0.75) * Math.PI);
      this.body.rotation.x = (flip ? -1 : 1) * p.diveDir * 1.35 * k;
      this.body.position.y = 0.35 * k;
      for (const a of this.arms) { a.sh.rotation.x = -a.sgn * 2.6 * k; a.el.rotation.z = 0.1; }
    }
    // Saut (tête).
    if (p.jump > 0) this.body.position.y += Math.sin((p.jump / 0.45) * Math.PI) * 0.7;
    // Célébration : bras levés, petits bonds.
    if (p.celeb > 0) {
      for (const a of this.arms) { a.sh.rotation.x = -a.sgn * 2.5; a.sh.rotation.z = 0.2; a.el.rotation.z = 0.2; }
      this.body.position.y += Math.abs(Math.sin(p.celeb * 7)) * 0.18;
    }
    this.shadow.scale.setScalar(1 - Math.min(0.5, this.body.position.y * 0.4));
  }
}

/* ---------------- Scène ---------------- */

export class Match3D {
  constructor(view) {
    this.v = view;
    const parent = view.canvas.parentElement;
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'pitch3d';
    parent.insertBefore(this.canvas, view.canvas);
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#0b1220');
    this.scene.fog = new THREE.Fog('#0b1220', 140, 260);
    this.camera = new THREE.PerspectiveCamera(30, 1.5, 0.5, 600);
    this.camMode = 'tv';
    this.camPos = new THREE.Vector3(0, 30, 70);
    this.camLook = new THREE.Vector3(0, 0, 0);
    this.scene.add(new THREE.HemisphereLight('#e8f0ff', '#2f4a32', 1.1));
    const sun = new THREE.DirectionalLight('#ffffff', 1.3);
    sun.position.set(-30, 80, 40);
    this.scene.add(sun);
    this.buildStadium();
    this.buildBall();
    this.players = new Map(); // id -> { p3, label, side }
    this.mats = view.colors.map((c, side) => this.teamMats(side));
    this.resize();
  }

  teamMats(side) {
    const v = this.v;
    return {
      shirt: new THREE.MeshLambertMaterial({ color: v.colors[side] }),
      gk: new THREE.MeshLambertMaterial({ color: v.gkColors[side] }),
      shorts: new THREE.MeshLambertMaterial({ color: v.shorts[side] }),
      socks: new THREE.MeshLambertMaterial({ color: v.colors[side] }),
      boot: new THREE.MeshLambertMaterial({ color: '#111111' }),
      shadow: new THREE.MeshBasicMaterial({ color: '#000', transparent: true, opacity: 0.32, depthWrite: false }),
      ring: new THREE.MeshBasicMaterial({ color: '#ffd166', transparent: true, opacity: 0.95, depthWrite: false, side: THREE.DoubleSide }),
    };
  }

  buildStadium() {
    const s = this.scene;
    const pt = pitchTexture(this.renderer.capabilities.getMaxAnisotropy());
    const pitch = new THREE.Mesh(new THREE.PlaneGeometry(pt.w, pt.h), new THREE.MeshLambertMaterial({ map: pt.tex }));
    pitch.rotation.x = -Math.PI / 2;
    s.add(pitch);
    const apron = new THREE.Mesh(new THREE.PlaneGeometry(170, 130), new THREE.MeshLambertMaterial({ color: '#24603a' }));
    apron.rotation.x = -Math.PI / 2; apron.position.y = -0.02;
    s.add(apron);
    // Panneaux publicitaires.
    const [h, a] = this.v.m.teams.map((t) => t.club);
    const boards = new THREE.MeshBasicMaterial({ map: boardsTexture([h.name, a.name]) });
    for (const z of [-W / 2 - 4, W / 2 + 4]) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(L + 6, 1, 0.2), boards);
      b.position.set(0, 0.5, z); s.add(b);
    }
    for (const x of [-L / 2 - 5, L / 2 + 5]) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(0.2, 1, W + 4), boards);
      b.position.set(x, 0.5, 0); s.add(b);
    }
    // Tribunes en gradins (3 étages), toit.
    const crowd = new THREE.MeshLambertMaterial({ map: crowdTexture(h.color, a.color) });
    crowd.map.wrapS = crowd.map.wrapT = THREE.RepeatWrapping;
    const concrete = new THREE.MeshLambertMaterial({ color: '#2a3140' });
    const stand = (len, depthAxis, sign, dist) => {
      for (let k = 0; k < 4; k++) {
        const hgt = 3.2, dep = 6;
        const geom = depthAxis === 'z' ? new THREE.BoxGeometry(len, hgt, dep) : new THREE.BoxGeometry(dep, hgt, len);
        const m = new THREE.Mesh(geom, k === 3 ? concrete : crowd);
        const off = dist + k * dep;
        if (depthAxis === 'z') m.position.set(0, hgt / 2 + k * hgt, sign * off); else m.position.set(sign * off, hgt / 2 + k * hgt, 0);
        s.add(m);
      }
      const roof = new THREE.Mesh(depthAxis === 'z' ? new THREE.BoxGeometry(len, 0.5, 26) : new THREE.BoxGeometry(26, 0.5, len), concrete);
      if (depthAxis === 'z') roof.position.set(0, 15.5, sign * (dist + 11)); else roof.position.set(sign * (dist + 11), 15.5, 0);
      s.add(roof);
    };
    stand(L + 30, 'z', -1, W / 2 + 9);
    // Pas de tribune côté caméra : elle masquerait le terrain (comme à la télé).
    stand(W + 16, 'x', -1, L / 2 + 10);
    stand(W + 16, 'x', 1, L / 2 + 10);
    // Projecteurs.
    const mast = new THREE.MeshLambertMaterial({ color: '#555c69' });
    const lamp = new THREE.MeshBasicMaterial({ color: '#fffbe6' });
    for (const [x, z] of [[-L / 2 - 14, -W / 2 - 14], [L / 2 + 14, -W / 2 - 14], [-L / 2 - 14, W / 2 + 18], [L / 2 + 14, W / 2 + 18]]) {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.6, 34, 8), mast); m.position.set(x, 17, z); s.add(m);
      const l = new THREE.Mesh(new THREE.BoxGeometry(5, 2.5, 1), lamp); l.position.set(x, 34, z); l.lookAt(0, 0, 0); s.add(l);
    }
    // Buts : poteaux, transversale, filets.
    const post = new THREE.MeshLambertMaterial({ color: '#ffffff' });
    const netM = new THREE.MeshBasicMaterial({ map: netTexture(), transparent: true, side: THREE.DoubleSide, depthWrite: false });
    netM.map.repeat.set(8, 3);
    for (const sgn of [-1, 1]) {
      const g = new THREE.Group();
      const x = sgn * L / 2;
      const gw = 7.32, gh = 2.44, gd = 2;
      for (const z of [-gw / 2, gw / 2]) { const p = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, gh, 8), post); p.position.set(x, gh / 2, z); g.add(p); }
      const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, gw, 8), post); bar.rotation.x = Math.PI / 2; bar.position.set(x, gh, 0); g.add(bar);
      const back = new THREE.Mesh(new THREE.PlaneGeometry(gw, gh), netM); back.rotation.y = Math.PI / 2; back.position.set(x + sgn * gd, gh / 2, 0); g.add(back);
      const top = new THREE.Mesh(new THREE.PlaneGeometry(gd, gw), netM); top.rotation.x = -Math.PI / 2; top.position.set(x + sgn * gd / 2, gh, 0); g.add(top);
      for (const z of [-gw / 2, gw / 2]) { const sd = new THREE.Mesh(new THREE.PlaneGeometry(gd, gh), netM); sd.position.set(x + sgn * gd / 2, gh / 2, z); g.add(sd); }
      s.add(g);
    }
    // Drapeaux de corner.
    const flag = new THREE.MeshLambertMaterial({ color: '#ffd166' });
    for (const [x, z] of [[-L / 2, -W / 2], [L / 2, -W / 2], [-L / 2, W / 2], [L / 2, W / 2]]) {
      const p = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.6, 6), post); p.position.set(x, 0.8, z); s.add(p);
      const f = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.3), flag); f.position.set(x + 0.2, 1.45, z); s.add(f);
    }
  }

  buildBall() {
    const tex = canvasTex(128, 64, (g, w, h) => {
      g.fillStyle = '#fff'; g.fillRect(0, 0, w, h);
      g.fillStyle = '#222';
      for (const [x, y] of [[16, 16], [56, 32], [96, 16], [36, 50], [76, 50], [116, 40], [8, 44]]) { g.beginPath(); g.arc(x, y, 7, 0, Math.PI * 2); g.fill(); }
    });
    this.ball = new THREE.Mesh(new THREE.SphereGeometry(BALL_R, 18, 14), new THREE.MeshLambertMaterial({ map: tex }));
    this.scene.add(this.ball);
    this.ballShadow = new THREE.Mesh(new THREE.CircleGeometry(BALL_R * 1.1, 16), new THREE.MeshBasicMaterial({ color: '#000', transparent: true, opacity: 0.35, depthWrite: false }));
    this.ballShadow.rotation.x = -Math.PI / 2;
    this.scene.add(this.ballShadow);
  }

  resize() {
    const v = this.v;
    const dpr = Math.min(window.devicePixelRatio || 1, 1.75);
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(v.cssW, v.cssH, false);
    this.canvas.style.width = v.cssW + 'px';
    this.canvas.style.height = v.cssH + 'px';
    this.camera.aspect = v.cssW / v.cssH;
    this.camera.updateProjectionMatrix();
  }

  flip() { const v = this.v; return (v.userSide === 1) !== (v.period === 2 || v.period === 4); }
  toWorld(x, y, flip = this.flip()) {
    const vx = flip ? 1 - x : x, vy = flip ? 1 - y : y;
    return [(vx - 0.5) * L, (vy - 0.5) * W];
  }

  /** Synchronise les joueurs 3D avec ceux de la vue (entrées, sorties, remplacements). */
  syncPlayers() {
    const v = this.v;
    const seen = new Set();
    for (const [id, p] of v.players) {
      seen.add(id);
      let e = this.players.get(id);
      if (!e) {
        const side = p.side;
        const base = this.mats[side];
        const mats = p.gk ? { ...base, shirt: base.gk, socks: base.gk } : base;
        const shirtHex = p.gk ? v.gkColors[side] : v.colors[side];
        const ink = p.gk ? '#111' : v.textColors[side];
        const p3 = new Player3D(mats, p.skin || '#c68642', p.hair || '#2b1d14', p.num, shirtHex, ink);
        const label = textSprite(p.short || '');
        label.position.y = 2.75 * K;
        p3.root.add(label);
        this.scene.add(p3.root);
        e = { p3, label };
        this.players.set(id, e);
      }
    }
    for (const [id, e] of this.players) if (!seen.has(id)) { this.scene.remove(e.p3.root); this.players.delete(id); }
  }

  cycleCamera() {
    const order = ['tv', 'close', 'high', 'goal'];
    this.camMode = order[(order.indexOf(this.camMode) + 1) % order.length];
    return { tv: 'Caméra télé', close: 'Caméra rapprochée', high: 'Vue d\'ensemble', goal: 'Derrière le but' }[this.camMode];
  }

  updateCamera(dt) {
    const v = this.v;
    const [bx, bz] = this.toWorld(v.ball.x, v.ball.y);
    let mode = this.camMode;
    const celebrating = v.banner && v.banner.text === 'BUT !';
    if (v.replaying || celebrating) mode = 'close';
    const want = new THREE.Vector3(), look = new THREE.Vector3(bx, 0, bz * 0.35);
    if (mode === 'tv') { want.set(Math.max(-36, Math.min(36, bx * 0.9)), 21, 58); look.set(bx * 0.97, 0, bz * 0.35 - 1); this.camera.fov = 30; }
    else if (mode === 'close') { want.set(bx * 0.9 - 4, 13, bz + 30); look.set(bx, 1, bz); this.camera.fov = 34; }
    else if (mode === 'high') { want.set(bx * 0.4, 95, 52); look.set(bx * 0.4, 0, 0); this.camera.fov = 38; }
    else { const side = bx >= 0 ? 1 : -1; want.set(side * (L / 2 + 22), 12, bz * 0.3); look.set(bx, 0, bz); this.camera.fov = 40; }
    const k = 1 - Math.exp(-dt * (mode === 'close' ? 3 : 2.2));
    this.camPos.lerp(want, k);
    this.camLook.lerp(look, k);
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.camLook);
    this.camera.updateProjectionMatrix();
  }

  render(dt) {
    const v = this.v;
    this.syncPlayers();
    const flip = this.flip();
    const carrier = v.cur ? v.cur.carrier : null;
    for (const [id, e] of this.players) {
      const p = v.players.get(id);
      const [x, z] = this.toWorld(p.x, p.y, flip);
      e.p3.root.position.set(x, 0, z);
      e.p3.pose(p, flip);
      const hl = id === carrier || id === v.selected;
      e.p3.ring.visible = hl;
      e.p3.ring.material = this.mats[p.side].ring;
      e.label.visible = v.labelMode === 'name' || (v.labelMode !== 'none' && hl);
    }
    const [bx, bz] = this.toWorld(v.ball.x, v.ball.y, flip);
    const hgt = v.ball.h * 26;
    this.ball.position.set(bx, BALL_R + hgt, bz);
    this.ball.rotation.z -= (v.cur ? 0.25 : 0.02);
    this.ballShadow.position.set(bx + hgt * 0.15, 0.025, bz + hgt * 0.1);
    this.updateCamera(dt);
    this.renderer.render(this.scene, this.camera);
  }

  /** Joueur sous le doigt : le plus proche à l'écran (tête projetée). */
  pick(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    let best = null, bd = 40 * 40;
    const vtx = new THREE.Vector3();
    for (const [id, e] of this.players) {
      vtx.copy(e.p3.root.position); vtx.y = 1.1 * K;
      vtx.project(this.camera);
      const sx = rect.left + (vtx.x + 1) / 2 * rect.width, sy = rect.top + (1 - vtx.y) / 2 * rect.height;
      const d = (sx - clientX) ** 2 + (sy - clientY) ** 2;
      if (d < bd) { bd = d; best = id; }
    }
    return best;
  }

  dispose() {
    this.renderer.dispose();
    this.canvas.remove();
  }
}
