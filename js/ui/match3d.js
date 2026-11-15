/**
 * MATCH EN 3D (three.js) : stade, tribunes, buts avec filets, joueurs 3D animés
 * (course, frappe, tacle, plongeon, saut, célébration), caméras « télé ».
 *
 * Ce module ne fait QUE le rendu : il lit l'état animé de MatchView (joueurs, ballon,
 * période) — la logique d'animation et le moteur restent communs aux vues 2D et 3D.
 */
import { stadiumFor, STADIUMS } from '../data/stadiums.js';
import { heightOf, bmiOf } from '../game/physique.js';
import * as THREE from '../vendor/three.module.min.js';
export { THREE as THREE_NS };
import { toLocal, localRect } from './viewport.js';
import { personLook, portraitSvg } from './avatar.js';

const L = 105, W = 68;
// Échelle RÉELLE face aux cages (7,32 × 2,44 m) : joueurs à leur taille, ballon de 22 cm.
// Sur téléphone, très léger grossissement pour rester lisible sur un petit écran.
const COARSE = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
const K = COARSE ? 1.08 : 1;
const BALL_R = 0.11 * (COARSE ? 1.45 : 1.15);

function canvasTex(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Fusionne des pavés [largeur, hauteur, profondeur, x, y, z] en une seule géométrie. */
function mergeBoxes(list) {
  const pos = [], nor = [], idx = [];
  for (const [w, h, d, x, y, z] of list) {
    const b = new THREE.BoxGeometry(w, h, d); b.translate(x, y, z);
    const off = pos.length / 3;
    pos.push(...b.attributes.position.array); nor.push(...b.attributes.normal.array);
    idx.push(...Array.from(b.index.array, (i) => i + off));
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setIndex(idx);
  return g;
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
    // Brins d'herbe et usure : petites touches de clair et de foncé, plus marquées devant les buts.
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    g.lineWidth = 1;
    for (let i = 0; i < 26000; i++) {
      const x = rnd() * cw, y = rnd() * ch;
      g.strokeStyle = rnd() < 0.5 ? 'rgba(255,255,255,.045)' : 'rgba(0,0,0,.06)';
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + (rnd() - 0.5) * 3, y - 2 - rnd() * 3); g.stroke();
    }
    for (const gx of [X(5), X(L - 5)]) {
      const rg = g.createRadialGradient(gx, Y(W / 2), 0, gx, Y(W / 2), 9 * S);
      rg.addColorStop(0, 'rgba(120,96,50,.22)'); rg.addColorStop(1, 'rgba(120,96,50,0)');
      g.fillStyle = rg; g.fillRect(gx - 9 * S, Y(W / 2) - 9 * S, 18 * S, 18 * S);
    }
  });
  tex.anisotropy = maxAniso;
  return { tex, w: L + PAD * 2, h: W + PAD * 2 };
}

/** Foule : points colorés (couleurs des deux clubs dominantes). */
/**
 * Tribunes : rangées de sièges et de spectateurs (têtes et maillots, majorité aux couleurs du
 * club qui reçoit), au lieu d'un nuage de pixels aléatoires.
 */
function crowdTexture(c1, c2) {
  return canvasTex(1024, 256, (g, w, h) => {
    const rowH = 16;
    for (let y = 0, r = 0; y < h; y += rowH, r++) {
      // Marche de béton + rangée de sièges.
      g.fillStyle = r % 2 ? '#262c38' : '#2b3240'; g.fillRect(0, y, w, rowH);
      g.fillStyle = 'rgba(0,0,0,.35)'; g.fillRect(0, y + rowH - 3, w, 3);
      for (let x = (r % 2) * 5; x < w; x += 10) {
        const seated = Math.random() < 0.86;
        if (!seated) { g.fillStyle = r % 3 ? c1 : '#3a4252'; g.globalAlpha = 0.55; g.fillRect(x + 1, y + 7, 8, 6); g.globalAlpha = 1; continue; }
        const shirt = Math.random() < 0.62 ? c1 : Math.random() < 0.5 ? c2 : ['#e8e8e8', '#20242c', '#5d6b85', '#8b2d2d'][(Math.random() * 4) | 0];
        g.fillStyle = shirt; g.fillRect(x + 1, y + 7, 8, 7);
        g.fillStyle = ['#f1c9a5', '#d9a77f', '#a8714a', '#6e4429', '#e6bfa0'][(Math.random() * 5) | 0];
        g.beginPath(); g.arc(x + 5, y + 5, 2.6, 0, Math.PI * 2); g.fill();
        if (Math.random() < 0.5) { g.fillStyle = ['#2a1c12', '#5a3a22', '#111', '#c8a060'][(Math.random() * 4) | 0]; g.fillRect(x + 2.6, y + 2, 4.8, 1.8); }
      }
    }
    // Léger dégradé : le haut des tribunes est plus sombre (toit).
    const grd = g.createLinearGradient(0, 0, 0, h);
    grd.addColorStop(0, 'rgba(0,0,0,.35)'); grd.addColorStop(0.5, 'rgba(0,0,0,0)'); grd.addColorStop(1, 'rgba(0,0,0,.1)');
    g.fillStyle = grd; g.fillRect(0, 0, w, h);
  });
}

function boardsTexture(names) {
  return canvasTex(2048, 64, (g, w, h) => {
    const cols = ['#0b3d91', '#c1121f', '#111', '#f4a261', '#2a9d8f', '#6a4c93'];
    const words = ['COACH DE POCHE', ...names, 'FAIR PLAY', 'RESPECT'];
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

function numberTexture(num, shirt, ink, name = '') {
  return canvasTex(128, 128, (g, w, h) => {
    g.clearRect(0, 0, w, h); // fond transparent : seuls les chiffres (et le nom) sont imprimés sur le maillot
    g.fillStyle = ink; g.textAlign = 'center'; g.textBaseline = 'middle';
    if (name) {
      const nm = String(name).toUpperCase().slice(0, 12);
      g.font = `700 ${nm.length > 8 ? 13 : 16}px "Barlow Condensed", system-ui, sans-serif`;
      g.fillText(nm, w / 2, 14);
      g.font = '800 84px "Barlow Condensed", system-ui, sans-serif';
      g.fillText(String(num ?? ''), w / 2, h / 2 + 14);
    } else {
      g.font = '800 92px "Barlow Condensed", system-ui, sans-serif';
      g.fillText(String(num ?? ''), w / 2, h / 2 + 6);
    }
  });
}

/** Visage dessiné (yeux, sourcils, nez, bouche, barbe…) à partir du portrait généré du joueur. */
const DRAWN = new Map();
function drawnFace(look) {
  const key = JSON.stringify(look);
  if (DRAWN.has(key)) return DRAWN.get(key);
  const pr = new Promise((resolve) => {
    try {
      let svg = portraitSvg(look, 200);
      if (!/xmlns=/.test(svg.slice(0, 200))) svg = svg.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"');
      const img = new Image();
      img.onload = () => {
        const c = document.createElement('canvas'); c.width = c.height = 128;
        const g = c.getContext('2d');
        // Le portrait fait 100 × 100 : on garde le visage (front → menton), découpé en ovale.
        g.save(); g.beginPath(); g.ellipse(64, 64, 62, 63, 0, 0, Math.PI * 2); g.clip();
        g.drawImage(img, 30 * 2, 26 * 2, 40 * 2, 46 * 2, 0, 0, 128, 128);
        g.restore();
        const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
        resolve(t);
      };
      img.onerror = () => resolve(null);
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    } catch { resolve(null); }
  });
  DRAWN.set(key, pr);
  return pr;
}

/* ---------------- Joueur 3D ---------------- */

const GEO = {};
function geo() {
  if (GEO.torso) return GEO;
  const cap = (r, l, rs = 10) => new THREE.CapsuleGeometry(r, l, 4, rs);
  // Profils anatomiques (tour de révolution) : rayon selon la hauteur.
  const lathe = (pts, seg = 16) => new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), seg);
  GEO.torsoA = lathe([[0.001, 0], [0.135, 0.005], [0.14, 0.08], [0.15, 0.18], [0.172, 0.3], [0.188, 0.42], [0.19, 0.5], [0.165, 0.57], [0.11, 0.615], [0.05, 0.63], [0.001, 0.632]], 20);
  GEO.thighA = lathe([[0.001, 0], [0.084, -0.01], [0.09, -0.08], [0.083, -0.2], [0.07, -0.33], [0.06, -0.42], [0.001, -0.43]]);
  GEO.shinA = lathe([[0.001, 0.02], [0.056, 0.0], [0.064, -0.09], [0.066, -0.15], [0.052, -0.27], [0.038, -0.37], [0.036, -0.41], [0.001, -0.42]]);
  GEO.shortsA = lathe([[0.001, 0.02], [0.112, 0.02], [0.118, -0.08], [0.122, -0.19], [0.001, -0.19]]);
  GEO.upperA = lathe([[0.001, 0.02], [0.054, 0.0], [0.056, -0.07], [0.047, -0.2], [0.041, -0.27], [0.001, -0.28]], 12);
  GEO.foreA = lathe([[0.001, 0.0], [0.044, -0.01], [0.046, -0.06], [0.034, -0.2], [0.028, -0.25], [0.001, -0.26]], 12);
  GEO.delt = new THREE.SphereGeometry(0.068, 12, 10);
  GEO.glute = new THREE.SphereGeometry(0.11, 12, 10);
  GEO.collar = new THREE.TorusGeometry(0.06, 0.013, 6, 18);
  GEO.cuff = new THREE.TorusGeometry(0.052, 0.008, 5, 14);
  GEO.sole = new THREE.BoxGeometry(0.24, 0.025, 0.09);
  GEO.sockBand = new THREE.CylinderGeometry(0.057, 0.059, 0.035, 12, 1, true);
  GEO.torso = cap(0.165, 0.34, 14);                 // (ancien buste, gardé pour l'arbitre)
  GEO.chest = new THREE.SphereGeometry(0.2, 14, 10);
  GEO.pelvis = new THREE.CylinderGeometry(0.17, 0.19, 0.22, 14);
  GEO.shortLeg = new THREE.CylinderGeometry(0.095, 0.11, 0.2, 10);
  GEO.thigh = cap(0.07, 0.3);
  GEO.shin = cap(0.055, 0.32);
  GEO.knee = new THREE.SphereGeometry(0.066, 10, 8);
  GEO.boot = cap(0.048, 0.17, 10);
  GEO.sleeve = cap(0.058, 0.08);
  GEO.upper = cap(0.05, 0.16);
  GEO.fore = cap(0.043, 0.2);
  GEO.hand = new THREE.SphereGeometry(0.045, 8, 6);
  GEO.elbow = new THREE.SphereGeometry(0.047, 8, 6);
  GEO.head = new THREE.SphereGeometry(0.118, 18, 14);
  GEO.hair = new THREE.SphereGeometry(0.126, 18, 14, 0, Math.PI * 2, 0, Math.PI * 0.52);
  GEO.ear = new THREE.SphereGeometry(0.03, 8, 6);
  GEO.face = new THREE.CircleGeometry(0.088, 24);
  GEO.neck = new THREE.CylinderGeometry(0.05, 0.058, 0.12, 10);
  GEO.back = new THREE.PlaneGeometry(0.24, 0.28);
  GEO.front = new THREE.PlaneGeometry(0.1, 0.1);
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

/**
 * Visages : la photo du joueur (Wikimedia) est posée sur le visage ; la couleur de peau et
 * celle des cheveux sont relevées sur la photo, pour qu'il ressemble au vrai joueur.
 */
const FACE_CACHE = new Map();
function loadFace(file) {
  if (FACE_CACHE.has(file)) return FACE_CACHE.get(file);
  const pr = new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.referrerPolicy = 'no-referrer';
    img.onload = () => {
      try {
        // Recadrage sur le visage (photos de joueurs : visage en haut, au centre).
        const c = document.createElement('canvas'); c.width = 128; c.height = 128;
        const g = c.getContext('2d');
        const sw = img.width * 0.5, sx = img.width * 0.25, sy = img.height * 0.08;
        g.drawImage(img, sx, sy, sw, sw, 0, 0, 128, 128);
        const px = (x, y, w, h) => {
          const d = g.getImageData(x, y, w, h).data;
          let r = 0, gg = 0, b = 0, n = 0;
          for (let i = 0; i < d.length; i += 4) { r += d[i]; gg += d[i + 1]; b += d[i + 2]; n++; }
          return [r / n, gg / n, b / n];
        };
        const skin = px(48, 62, 32, 24), hair = px(44, 4, 40, 12);
        const hex = (c3) => '#' + c3.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');
        const lum = (c3) => 0.3 * c3[0] + 0.59 * c3[1] + 0.11 * c3[2];
        // Bords fondus : le fond de la photo disparaît, le visage se fond dans la tête.
        g.globalCompositeOperation = 'destination-in';
        const grd = g.createRadialGradient(64, 60, 34, 64, 64, 64);
        grd.addColorStop(0, 'rgba(0,0,0,1)'); grd.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = grd; g.fillRect(0, 0, 128, 128);
        const tex = new THREE.CanvasTexture(c);
        tex.colorSpace = THREE.SRGBColorSpace;
        resolve({ tex, skin: hex(skin), hair: lum(hair) < 170 && Math.abs(lum(hair) - lum(skin)) > 12 ? hex(hair) : null });
      } catch { resolve(null); } // image sans autorisation CORS : pas de photo
    };
    img.onerror = () => resolve(null);
    import('./images.js').then((m) => { img.src = m.thumbUrl(file, 120, 'commons'); }).catch(() => resolve(null));
  });
  FACE_CACHE.set(file, pr);
  return pr;
}

const BOOTS = new Map();
const bootMat = (c) => { if (!BOOTS.has(c)) BOOTS.set(c, new THREE.MeshStandardMaterial({ color: c, roughness: 0.3, metalness: 0.15 })); return BOOTS.get(c); };

/*
 * GESTES AU SOL : séquences d'images clés (comme une capture de mouvement simplifiée).
 * Chaque clé : t (0 → 1 sur la durée du geste), bz (bascule du corps autour des pieds, négatif =
 * vers l'avant), by (hauteur du bassin), hL/hR (hanches, positif = cuisse vers l'avant),
 * kL/kR (genoux, négatif = fléchi), aZ/aX (épaules), e (coudes), uz (buste sur les hanches).
 * L'interpolation est lissée (accélérations naturelles, pas de basculement raide).
 */
const KEYS = {
  // Fauché : il trébuche, les mains partent en avant pour amortir, il glisse sur la pelouse,
  // reste au sol, puis se relève en passant par les genoux.
  fall: [
    { t: 0, bz: 0, by: 0, hL: 0, hR: 0, kL: -0.1, kR: -0.1, aZ: 0.2, aX: 0, e: 0.4, uz: 0 },
    { t: 0.1, bz: -0.42, by: -0.12, hL: 0.55, hR: -0.35, kL: -0.55, kR: -1.0, aZ: 0.9, aX: 0.25, e: 0.35, uz: -0.25 },
    { t: 0.24, bz: -1.05, by: -0.08, hL: 0.4, hR: 0.05, kL: -0.75, kR: -0.5, aZ: 1.9, aX: 0.2, e: 0.45, uz: -0.18 },
    { t: 0.36, bz: -1.5, by: 0.13, hL: 0.08, hR: -0.04, kL: -0.4, kR: -0.15, aZ: 2.45, aX: 0.1, e: 1.25, uz: 0.06 },
    { t: 0.5, bz: -1.53, by: 0.14, hL: 0.05, hR: 0.12, kL: -0.25, kR: -0.85, aZ: 2.3, aX: 0.15, e: 1.5, uz: 0.1 },
    { t: 0.64, bz: -1.5, by: 0.13, hL: 0.1, hR: 0.0, kL: -0.6, kR: -0.3, aZ: 2.2, aX: 0.1, e: 1.6, uz: 0.08 },
    { t: 0.76, bz: -0.95, by: -0.55, hL: 1.35, hR: 1.3, kL: -2.25, kR: -2.2, aZ: 1.15, aX: 0.05, e: 0.25, uz: -0.25 },
    { t: 0.88, bz: -0.3, by: -0.36, hL: 1.45, hR: 0.15, kL: -1.55, kR: -1.95, aZ: 0.55, aX: 0.1, e: 0.9, uz: -0.2 },
    { t: 1, bz: 0, by: 0, hL: 0, hR: 0, kL: -0.1, kR: -0.1, aZ: 0.2, aX: 0, e: 0.4, uz: 0 },
  ],
  // Tacle glissé : il se couche sur la hanche, jambe d'attaque tendue au ras du sol, jambe
  // d'appui repliée dessous, une main en arrière qui frotte la pelouse ; puis il se relève.
  slide: [
    { t: 0, bz: 0, by: 0, hL: 0, hR: 0, kL: -0.2, kR: -0.2, aZ: 0.2, aX: 0, e: 0.5, uz: 0 },
    { t: 0.12, bz: 0.4, by: 0, hL: 0.2, hR: 0.75, kL: -1.7, kR: -0.3, aZ: -0.2, aX: 0.35, e: 0.4, uz: -0.2 },
    { t: 0.26, bz: 0.95, by: 0, hL: 0.15, hR: 0.62, kL: -2.45, kR: -0.04, aZ: -0.95, aX: 0.4, e: 0.2, uz: -0.45 },
    { t: 0.55, bz: 0.98, by: 0, hL: 0.12, hR: 0.6, kL: -2.5, kR: -0.04, aZ: -1.0, aX: 0.4, e: 0.2, uz: -0.5 },
    { t: 0.7, bz: 0.55, by: 0, hL: 1.4, hR: 0.5, kL: -2.2, kR: -0.9, aZ: -0.2, aX: 0.3, e: 0.5, uz: -0.55 },
    { t: 0.86, bz: -0.1, by: 0, hL: 1.25, hR: 0.15, kL: -1.6, kR: -1.2, aZ: 0.5, aX: 0.1, e: 0.8, uz: -0.25 },
    { t: 1, bz: 0, by: 0, hL: 0, hR: 0, kL: -0.15, kR: -0.15, aZ: 0.2, aX: 0, e: 0.5, uz: 0 },
  ],
  // Tacle debout : appui fléchi, jambe tendue qui va chercher le ballon, buste au-dessus.
  stand: [
    { t: 0, bz: 0, by: 0, hL: 0, hR: 0, kL: -0.2, kR: -0.2, aZ: 0.2, aX: 0, e: 0.5, uz: 0 },
    { t: 0.3, bz: -0.12, by: -0.16, hL: -0.15, hR: 0.65, kL: -0.75, kR: -0.35, aZ: 0.5, aX: 0.55, e: 0.5, uz: -0.12 },
    { t: 0.5, bz: 0.05, by: -0.2, hL: -0.1, hR: 1.05, kL: -0.85, kR: -0.05, aZ: 0.35, aX: 0.7, e: 0.4, uz: -0.2 },
    { t: 0.75, bz: -0.05, by: -0.1, hL: 0.1, hR: 0.45, kL: -0.5, kR: -0.4, aZ: 0.3, aX: 0.35, e: 0.5, uz: -0.1 },
    { t: 1, bz: 0, by: 0, hL: 0, hR: 0, kL: -0.2, kR: -0.2, aZ: 0.2, aX: 0, e: 0.5, uz: 0 },
  ],
};
// Blessé : allongé sur le dos, une jambe ramenée contre lui, les mains sur le tibia.
KEYS.hurt = [
  { t: 0, bz: 1.5, by: 0, hL: 0.1, hR: 1.6, kL: -0.3, kR: -2.0, aZ: 1.3, aX: 0.1, e: 1.2, uz: 0.15 },
  { t: 0.5, bz: 1.45, by: 0, hL: 0.25, hR: 1.85, kL: -0.6, kR: -2.2, aZ: 1.5, aX: 0.15, e: 1.0, uz: 0.35 },
  { t: 1, bz: 1.5, by: 0, hL: 0.1, hR: 1.6, kL: -0.3, kR: -2.0, aZ: 1.3, aX: 0.1, e: 1.2, uz: 0.15 },
];
const ease = (u) => u * u * (3 - 2 * u);
/** Pose interpolée d'une séquence à l'instant t (0 → 1). */
function keyPose(seq, t) {
  t = Math.max(0, Math.min(1, t));
  let i = 0;
  while (i < seq.length - 2 && seq[i + 1].t < t) i++;
  const a = seq[i], b = seq[i + 1];
  const u = ease((t - a.t) / Math.max(1e-6, b.t - a.t));
  const o = {};
  for (const k in a) if (k !== 't') o[k] = a[k] + (b[k] - a[k]) * u;
  return o;
}

export class Player3D {
  constructor(mats, skin, hair, num, shirtHex, inkHex, photo = null, opts = {}) {
    const G = geo();
    this.root = new THREE.Group();
    this.body = new THREE.Group();          // inclinaisons (tacle, plongeon)
    this.root.add(this.body);
    this.body.scale.setScalar(K);
    // Matériaux physiques : peau satinée, cheveux mats, tissus des maillots.
    const skinM = this.skinM = new THREE.MeshStandardMaterial({ color: skin, roughness: 0.55, metalness: 0, emissive: new THREE.Color(skin).multiplyScalar(0.16) });
    const hairM = this.hairM = new THREE.MeshStandardMaterial({ color: hair, roughness: 0.9, metalness: 0 });
    // Buste en V (poitrine, dos, taille), épaules (deltoïdes), col ; fessiers sous le short.
    const torso = limb(this.body, G.torsoA, mats.shirt, 0.92);
    torso.scale.set(0.74, 1, 1.18);
    for (const z of [-0.205, 0.205]) { const dl = limb(this.body, G.delt, mats.shirt, 1.45); dl.position.z = z; dl.scale.set(0.95, 0.85, 0.9); }
    const collar = limb(this.body, G.collar, mats.trim || mats.shorts, 1.535); collar.rotation.x = Math.PI / 2; collar.scale.set(1.15, 1.25, 1);
    const shorts = limb(this.body, G.shortsA, mats.shorts, 0.97); shorts.scale.set(0.74, 1, 1.22);
    limb(this.body, G.neck, skinM, 1.56);
    const head = limb(this.body, G.head, skinM, 1.7);
    head.scale.set(0.96, 1.1, 0.9);
    const hairMesh = this.hairMesh = limb(this.body, G.hair, hairM, 1.72);
    hairMesh.position.x = -0.012; hairMesh.scale.set(0.98, 1.08, 0.94);
    for (const z of [-0.105, 0.105]) { const e = limb(this.body, G.ear, skinM, 1.69); e.position.z = z; e.scale.set(0.6, 1, 0.5); }
    // Visage : photo du joueur (Wikimedia) si disponible, sinon visage dessiné (yeux, nez, bouche…).
    const addFace = (tex) => {
      const face = new THREE.Mesh(G.face, new THREE.MeshStandardMaterial({ map: tex, transparent: true, roughness: 0.75 }));
      face.position.set(0.119 - 1.6 * 0 , 1.69, 0); face.rotation.y = Math.PI / 2;
      face.scale.set(0.95, 1.12, 1);
      (this.headPivot || this.body).add(face);
      if (this.headPivot) face.position.y -= 1.6;
    };
    if (photo) {
      loadFace(photo).then((f) => {
        if (!f) { if (opts.look) drawnFace(opts.look).then((tex) => tex && addFace(tex)); return; }
        skinM.color.set(f.skin); skinM.emissive.set(f.skin).multiplyScalar(0.16);
        if (f.hair) hairM.color.set(f.hair);
        addFace(f.tex);
      });
    } else if (opts.look) drawnFace(opts.look).then((tex) => tex && addFace(tex));
    // Numéros (dos et poitrine).
    const numTex = numberTexture(num, shirtHex, inkHex, opts.name);
    const back = new THREE.Mesh(G.back, new THREE.MeshLambertMaterial({ map: numTex, transparent: true }));
    back.position.set(-0.142, 1.26, 0); back.rotation.y = -Math.PI / 2;
    this.body.add(back);
    const front = new THREE.Mesh(G.front, new THREE.MeshLambertMaterial({ map: numTex, transparent: true }));
    front.position.set(0.142, 1.36, 0.07); front.rotation.y = Math.PI / 2;
    this.body.add(front);
    // Jambes : hanche → (short, cuisse) → genou → (chaussette) → crampon.
    this.legs = [-1, 1].map((sgn) => {
      const hip = new THREE.Group(); hip.position.set(0, 0.8, sgn * 0.1); this.body.add(hip);
      limb(hip, G.thighA, skinM, 0).scale.set(1.1, 1, 1.05);
      const knee = new THREE.Group(); knee.position.y = -0.42; hip.add(knee);
      limb(knee, G.knee, skinM, 0.0).scale.set(0.82, 0.8, 0.8);
      limb(knee, G.shinA, mats.socks, -0.01);
      limb(knee, G.sockBand, mats.trim || mats.shorts, -0.06);
      const ankle = new THREE.Group(); ankle.position.y = -0.41; knee.add(ankle);
      const boot = limb(ankle, G.boot, mats.boot, -0.02);
      boot.rotation.z = Math.PI / 2; boot.position.x = 0.055; boot.scale.set(1, 1, 0.92);
      const sole = limb(ankle, G.sole, mats.sole || mats.boot, -0.06); sole.position.x = 0.055;
      return { hip, knee, ankle };
    });
    // Bras : épaule → (manche, bras) → coude → avant-bras → main.
    this.arms = [-1, 1].map((sgn) => {
      const sh = new THREE.Group(); sh.position.set(0, 1.44, sgn * 0.25); this.body.add(sh);
      limb(sh, G.sleeve, mats.shirt, -0.07).scale.set(1.05, 1.1, 1.05);
      limb(sh, G.cuff, mats.trim || mats.shorts, -0.15).rotation.x = Math.PI / 2;
      limb(sh, G.upperA, skinM, -0.01);
      const el = new THREE.Group(); el.position.y = -0.27; sh.add(el);
      limb(el, G.elbow, skinM, 0).scale.setScalar(0.78);
      limb(el, G.foreA, skinM, 0);
      const hand = limb(el, G.hand, skinM, -0.29);
      hand.scale.set(0.7, 1.05, 0.5);
      return { sh, el, sgn, hand };
    });
    this.shadow = new THREE.Mesh(G.shadow, mats.shadow);
    this.shadow.rotation.x = -Math.PI / 2; this.shadow.position.y = 0.02;
    this.root.add(this.shadow);
    this.ring = new THREE.Mesh(G.ring, mats.ring);
    this.ring.rotation.x = -Math.PI / 2; this.ring.position.y = 0.03; this.ring.visible = false;
    this.root.add(this.ring);
    // Tête articulée (crâne, cheveux, oreilles, visage) : elle suit le ballon des yeux.
    this.headPivot = new THREE.Group(); this.headPivot.position.y = 1.6; this.body.add(this.headPivot);
    for (const c of this.body.children.slice()) if (c !== this.headPivot && c.position.y >= 1.64 && c.position.y < 2.2) { this.body.remove(c); c.position.y -= 1.6; this.headPivot.add(c); }
    // Haut du corps (buste, bras, tête) : il pivote en sens inverse des hanches pendant la course.
    this.upper = new THREE.Group(); this.upper.position.y = 0.95; this.body.add(this.upper);
    for (const c of this.body.children.slice()) if (c !== this.upper && c.position.y >= 1.0) { this.body.remove(c); c.position.y -= 0.95; this.upper.add(c); }
    // Ombres portées (projecteurs / soleil).
    this.root.traverse((o) => { if (o.isMesh && o !== this.shadow && o !== this.ring) o.castShadow = true; });
    this._sm = null; // poses lissées (pas d'à-coups entre deux gestes)
  }

  /** Lissage des articulations : la pose calculée devient une cible vers laquelle on glisse. */
  smoothPose(dt) {
    const [lL, lR] = this.legs, [aL, aR] = this.arms;
    const objs = [lL.hip.rotation, lR.hip.rotation, lL.knee.rotation, lR.knee.rotation, aL.sh.rotation, aR.sh.rotation, aL.el.rotation, aR.el.rotation, this.body.rotation, this.headPivot.rotation, this.upper.rotation, lL.ankle.rotation, lR.ankle.rotation];
    const cur = [];
    for (const r of objs) cur.push(r.x, r.y, r.z);
    cur.push(this.body.position.y);
    if (!this._sm || !(dt > 0)) { this._sm = cur; return; }
    const a = 1 - Math.exp(-dt * 24);
    const sm = this._sm;
    for (let i = 0; i < cur.length; i++) sm[i] += (cur[i] - sm[i]) * a;
    let k = 0;
    for (const r of objs) { r.set(sm[k], sm[k + 1], sm[k + 2]); k += 3; }
    this.body.position.y = sm[k];
  }

  /**
   * Pose à partir de l'état animé de MatchView (vitesse réelle, accélération, gestes).
   * Course : foulée qui s'allonge avec la vitesse, genou qui remonte, bras opposés aux jambes,
   * buste penché selon la vitesse et l'accélération, rebond vertical deux fois par cycle.
   */
  /** Applique une pose d'images clés (corps entier). */
  applyKeys(o, mirror = false) {
    const [lL, lR] = this.legs;
    const [hL, hR, kL, kR] = mirror ? [o.hR, o.hL, o.kR, o.kL] : [o.hL, o.hR, o.kL, o.kR];
    this.body.rotation.set(0, 0, o.bz);
    this.body.position.y = o.by * K;
    lL.hip.rotation.set(0, 0, hL); lR.hip.rotation.set(0, 0, hR);
    lL.knee.rotation.set(0, 0, kL); lR.knee.rotation.set(0, 0, kR);
    lL.ankle.rotation.set(0, 0, 0); lR.ankle.rotation.set(0, 0, 0);
    this.upper.rotation.set(0, 0, o.uz);
    for (const a of this.arms) { a.sh.rotation.set(-a.sgn * o.aX, 0, o.aZ); a.el.rotation.set(0, 0, o.e); }
    this.groundContact();
  }

  /**
   * Contact au sol : le point le plus bas du corps (crampon, genou, main, tête…) est posé sur la
   * pelouse. Ni joueur qui flotte, ni jambe qui s'enfonce dans le sol pendant une chute.
   */
  groundContact() {
    const pts = this._contacts ||= [
      ...this.legs.flatMap((l) => [l.ankle, l.knee, l.hip]),
      ...this.arms.map((a) => a.hand || a.el),
      this.headPivot, this.upper,
    ];
    this.root.updateMatrixWorld(true);
    const v = this._v ||= new THREE.Vector3();
    let min = Infinity;
    for (const o of pts) { o.getWorldPosition(v); min = Math.min(min, v.y - this.root.position.y); }
    // Rayon des membres (crampon, genou, main) : on garde un peu d'épaisseur au-dessus de l'herbe.
    if (Number.isFinite(min)) this.body.position.y += 0.07 * K - min;
  }

  /** Coiffure : crâne rasé, cheveux courts, afro, mi-longs… */
  setHair(style) {
    const h = this.hairMesh;
    if (!h) return;
    if (style === 'bald') { h.visible = false; return; }
    if (style === 'buzz' || style === 'receding') h.scale.set(0.93, 0.98, 0.9);
    else if (style === 'afro' || style === 'curly') h.scale.set(1.12, 1.22, 1.1);
    else if (style === 'long' || style === 'dreads' || style === 'bun') { h.scale.set(1.05, 1.18, 1.0); h.position.y -= 0.03; }
    else if (style === 'quiff' || style === 'mohawk') h.scale.set(0.98, 1.2, 0.92);
  }
  /** Gants du gardien. */
  setGloves(c) { const m = new THREE.MeshLambertMaterial({ color: c }); for (const a of this.arms) if (a.hand) a.hand.material = m; }

  pose(p, flip, ctx = {}) {
    const face = flip ? p.face + Math.PI : p.face;
    this.root.rotation.y = -face;
    const sp = p.speed || 0;
    const run = Math.min(1, sp / 8.5);             // 0 arrêté → 1 sprint
    const jog = Math.min(1, sp / 3);
    const ph = p.phase || 0;
    const amp = 0.25 + 0.75 * run;                  // amplitude de la foulée
    // À reculons (face au jeu) : la foulée s'inverse et le buste se redresse.
    const sw = Math.sin(ph) * amp * jog * (p.back ? -0.7 : 1);
    const [lL, lR] = this.legs;
    lL.hip.rotation.set(0, 0, sw); lR.hip.rotation.set(0, 0, -sw);
    // Épaules en opposition aux hanches ; cheville : pointe tendue pendant le retour de jambe, pied à plat à l'appui.
    this.upper.rotation.set(0, -sw * (0.22 + 0.25 * run), 0);
    lL.ankle.rotation.set(0, 0, -0.45 * Math.max(0, Math.sin(ph + 1.2)) * jog);
    lR.ankle.rotation.set(0, 0, -0.45 * Math.max(0, Math.sin(ph + 1.2 + Math.PI)) * jog);
    // Genou : plié pendant le retour de la jambe (talon vers les fesses en sprint).
    const kneeMax = 0.35 + 1.35 * run;
    lL.knee.rotation.z = -(0.08 + kneeMax * Math.max(0, Math.sin(ph + 1.7))) * jog;
    lR.knee.rotation.z = -(0.08 + kneeMax * Math.max(0, Math.sin(ph + 1.7 + Math.PI))) * jog;
    for (const a of this.arms) {
      a.sh.rotation.set(0, 0, (a.sgn < 0 ? -sw : sw) * (0.7 + 0.5 * run));
      a.sh.rotation.x = -a.sgn * 0.12;
      a.el.rotation.z = 0.35 + 1.0 * run;
    }
    const lean = p.back ? -0.08 : Math.max(-0.25, Math.min(0.32, 0.05 + 0.2 * run + (p.acc || 0) * 0.025));
    // Virage : le joueur s'incline vers l'intérieur de la courbe, d'autant plus qu'il va vite.
    const dtp = ctx.dt || 0.016;
    let dF = (p.face || 0) - (this._pf ?? p.face ?? 0);
    dF = Math.atan2(Math.sin(dF), Math.cos(dF));
    this._pf = p.face || 0;
    this._turn = (this._turn || 0) * 0.8 + (dF / dtp) * 0.2;
    const bank = Math.max(-0.3, Math.min(0.3, this._turn * run * 0.09));
    this.body.rotation.set(bank, 0, -lean);
    // La tête suit le ballon (dans la limite de ce que permet le cou).
    if (ctx.ballAng != null) { let r = ctx.ballAng - (p.face || 0); r = Math.atan2(Math.sin(r), Math.cos(r)); this.headPivot.rotation.set(0, -Math.max(-1.1, Math.min(1.1, r)), 0); }
    else this.headPivot.rotation.set(0, 0, 0);
    this.body.position.set(0, Math.abs(Math.sin(ph)) * (0.03 + 0.06 * run) * jog, 0);
    // À l'arrêt : genoux souples ; le gardien se met en position d'attente quand le jeu approche.
    if (sp < 0.8) {
      const ready = p.gk && ctx.ballNear ? 1 : 0.25;
      lL.knee.rotation.z = lR.knee.rotation.z = -0.25 * ready - 0.08;
      lL.hip.rotation.z = lR.hip.rotation.z = 0.15 * ready;
      this.body.rotation.z = -0.18 * ready;
      this.body.position.y = -0.06 * ready;
      if (p.gk && ctx.ballNear) for (const a of this.arms) { a.sh.rotation.x = -a.sgn * 0.75; a.sh.rotation.z = -0.3; a.el.rotation.z = 0.5; }
    }
    // Touche de balle (conduite) : petit coup de pied rapide.
    if (p.touch > 0) {
      const k = Math.sin((1 - p.touch / 0.18) * Math.PI);
      lR.hip.rotation.z = -0.15 + 0.55 * k; lR.knee.rotation.z = -0.35 * (1 - k);
    }
    // Frappe : appui de la jambe gauche, armé (talon en arrière), fouetté, accompagnement.
    if (p.kick > 0) {
      const pow = p.kickPow ?? 0.8;
      const t = 1 - p.kick / 0.32;
      let hip, knee;
      if (t < 0.4) { const u = t / 0.4; hip = -0.6 * pow * u; knee = -(0.6 + 1.0 * pow) * u; }
      else if (t < 0.6) { const u = (t - 0.4) / 0.2; hip = -0.6 * pow + (0.6 * pow + 1.1 * pow) * u; knee = -(0.6 + 1.0 * pow) * (1 - u); }
      else { const u = (t - 0.6) / 0.4; hip = 1.1 * pow * (1 - 0.6 * u); knee = -0.1 - 0.3 * u; }
      lR.hip.rotation.z = hip; lR.knee.rotation.z = knee;
      // Plat du pied (passe, frappe placée) : pied ouvert vers l'extérieur, geste plus court.
      if (p.kickSide) { lR.hip.rotation.y = -0.75 * Math.sin(Math.min(1, t * 1.6) * Math.PI / 2); lR.hip.rotation.x = 0.18; }
      // Extérieur du pied (trivela) : pied tourné vers l'intérieur, la jambe fouette de l'intérieur vers l'extérieur.
      if (p.kickOut > 0) { lR.hip.rotation.y = 0.6 * Math.sin(Math.min(1, t * 1.6) * Math.PI / 2); lR.hip.rotation.x = -0.22; lR.ankle.rotation.y = 0.5; }
      lL.hip.rotation.z = 0.12; lL.knee.rotation.z = -0.25 - 0.15 * pow;
      // Bras opposé écarté pour l'équilibre, buste qui accompagne.
      this.arms[0].sh.rotation.x = 0.9 * pow; this.arms[1].sh.rotation.x = -0.4 * pow;
      this.body.rotation.z = -0.1 - 0.25 * pow * Math.sin(t * Math.PI);
      this.body.rotation.x = 0.12 * pow * Math.sin(t * Math.PI);
    }
    // Gestes techniques (seulement les joueurs qui ont les étoiles) : posés sur la course.
    if (p.skillT > 0 && p.skill) {
      if (!(this._skMax > 0) || p.skillT > this._skPrev + 0.01) this._skMax = p.skillMax || p.skillT;
      this._skPrev = p.skillT;
      const t = Math.max(0, Math.min(1, 1 - p.skillT / this._skMax));
      const bell = (a, b) => (t < a || t > b ? 0 : Math.sin(((t - a) / (b - a)) * Math.PI)); // 0 → 1 → 0 entre a et b
      const lo = (k) => { this.body.position.y -= 0.07 * k * K; lL.knee.rotation.z -= 0.35 * k; };   // centre de gravité bas
      switch (p.skill) {
        case 'crochet': {   // l'intérieur du pied ramène le ballon de l'autre côté
          const k = bell(0.1, 0.9);
          lR.hip.rotation.z = 0.35 * k; lR.hip.rotation.y = -0.9 * k; lR.knee.rotation.z = -0.4 * k;
          this.body.rotation.x += 0.22 * k; lo(k);
          break;
        }
        case 'feinte': {    // le buste part d'un côté, puis de l'autre
          const sw2 = Math.sin(t * Math.PI * 2);
          this.body.rotation.x += 0.32 * sw2; this.upper.rotation.y += 0.35 * sw2;
          for (const a of this.arms) { a.sh.rotation.x = -a.sgn * (0.6 + 0.3 * sw2 * a.sgn); }
          lo(Math.abs(sw2));
          break;
        }
        case 'passement': { // la jambe enjambe le ballon par l'extérieur (deux fois, une jambe puis l'autre)
          const leg = t < 0.5 ? lR : lL, u = (t % 0.5) / 0.5, k = Math.sin(u * Math.PI);
          leg.hip.rotation.z = 0.55 * k; leg.knee.rotation.z = -1.0 * k;
          leg.hip.rotation.y = (leg === lR ? 1 : -1) * (0.9 - 1.8 * u) * k;
          this.body.rotation.x += (leg === lR ? -0.18 : 0.18) * k; lo(0.6);
          for (const a of this.arms) a.sh.rotation.x = -a.sgn * 0.55;
          break;
        }
        case 'jongle': {    // petites touches du cou-de-pied, bras écartés pour l'équilibre
          const k = Math.abs(Math.sin(t * Math.PI * 3));
          lR.hip.rotation.z = 0.2 + 0.95 * k; lR.knee.rotation.z = -0.95 * k; lR.ankle.rotation.z = 0.35; lL.hip.rotation.z = 0;
          lL.knee.rotation.z = -0.3;
          for (const a of this.arms) { a.sh.rotation.x = -a.sgn * 0.5; a.el.rotation.z = 0.4; }
          this.headPivot.rotation.z = -0.35;          // regard sur le ballon
          break;
        }
        case 'petitpont': { // pointe ou intérieur, coup sec entre les jambes du défenseur
          const k = bell(0.25, 0.75);
          lR.hip.rotation.z = 0.5 * k; lR.hip.rotation.y = -0.35 * k; lR.knee.rotation.z = -0.25 * (1 - k);
          this.body.rotation.z += -0.12 * k; lo(0.8);
          break;
        }
        case 'talon': {     // talonnade : le talon frappe vers l'arrière
          const k = bell(0.2, 0.8);
          lR.hip.rotation.z = -0.55 * k; lR.knee.rotation.z = -1.1 * k;
          this.body.rotation.z += -0.15 * k;
          break;
        }
        case 'roulette': {  // pivot complet : semelle droite, demi-tour, semelle gauche
          this.root.rotation.y -= Math.PI * 2 * (t * t * (3 - 2 * t));
          const k1 = bell(0.0, 0.55), k2 = bell(0.45, 1);
          lR.hip.rotation.z = 0.35 * k1; lR.knee.rotation.z = -0.3 * k1;
          lL.hip.rotation.z = 0.35 * k2; lL.knee.rotation.z = -0.3 * k2;
          for (const a of this.arms) { a.sh.rotation.x = -a.sgn * 0.75; a.el.rotation.z = 0.5; }
          lo(0.9);
          break;
        }
        case 'sombrero': {  // le ballon coincé entre les pieds, la jambe arrière le lève par-dessus la tête
          const k = bell(0.2, 0.75);
          lR.hip.rotation.z = -0.35 * k; lR.knee.rotation.z = -1.9 * k;
          lL.knee.rotation.z = -0.45 * k;
          this.body.position.y += 0.12 * K * bell(0.35, 0.7);    // petit saut
          this.body.rotation.z += -0.2 * k;
          for (const a of this.arms) { a.sh.rotation.x = -a.sgn * 0.7 * k; }
          break;
        }
        case 'virgule': {   // elastico : l'extérieur pousse, l'intérieur ramène, en un éclair
          const out1 = bell(0.05, 0.5), in1 = bell(0.45, 0.95);
          lR.hip.rotation.z = 0.3 * (out1 + in1);
          lR.hip.rotation.y = 0.75 * out1 - 0.85 * in1;
          lR.knee.rotation.z = -0.35 * (out1 + in1);
          this.body.rotation.x += 0.25 * out1 - 0.3 * in1; lo(0.8);
          for (const a of this.arms) a.sh.rotation.x = -a.sgn * 0.6;
          break;
        }
        case 'coupdusombrero': { // coup du foulard : la jambe passe derrière la jambe d'appui
          const k = bell(0.2, 0.9);
          lR.hip.rotation.x = -0.55 * k; lR.hip.rotation.z = -0.3 + 0.95 * bell(0.45, 0.9);
          lR.knee.rotation.z = -0.9 * bell(0.2, 0.6);
          lL.knee.rotation.z = -0.35 * k;
          this.body.rotation.x += 0.25 * k;
          for (const a of this.arms) a.sh.rotation.x = -a.sgn * 0.65 * k;
          break;
        }
        default: break;
      }
    } else this._skMax = 0;
    // Repos loin du ballon : mains sur les hanches (joueurs de champ) ; porteur arrêté : il
    // protège le ballon, bras écartés et centre de gravité bas.
    if (sp < 0.4 && ctx.restFar && !p.gk && !(p.kick > 0) && !(p.celeb > 0)) {
      for (const a of this.arms) { a.sh.rotation.x = -a.sgn * 0.55; a.sh.rotation.z = -0.35; a.el.rotation.z = 1.75; }
    }
    if (ctx.shield && sp < 2.5 && !(p.kick > 0)) {
      for (const a of this.arms) { a.sh.rotation.x = -a.sgn * 0.75; a.el.rotation.z = 0.45; }
      lL.knee.rotation.z += -0.25; lR.knee.rotation.z += -0.25; this.body.position.y -= 0.05; this.body.rotation.z += -0.1;
    }
    // Contrôle du ballon : amorti du pied, de la cuisse ou de la poitrine selon la hauteur.
    if (p.ctrl > 0) {
      const k = Math.sin((1 - p.ctrl / 0.3) * Math.PI);
      const hgt = p.ctrlH || 0;
      if (hgt > 1.05) {                           // poitrine : buste en arrière, bras ouverts
        this.body.rotation.z += 0.32 * k;
        for (const a of this.arms) { a.sh.rotation.x = -a.sgn * 0.9 * k; a.el.rotation.z = 0.6; }
        lL.knee.rotation.z = lR.knee.rotation.z = -0.35 * k;
      } else if (hgt > 0.45) {                    // cuisse levée
        lR.hip.rotation.z = 1.25 * k; lR.knee.rotation.z = -1.2 * k;
        this.arms[0].sh.rotation.x = 0.6 * k; this.arms[1].sh.rotation.x = -0.6 * k;
      } else {                                    // pied qui accompagne le ballon (amorti)
        lR.hip.rotation.z = 0.45 * k; lR.knee.rotation.z = -0.3 * k; lR.hip.rotation.y = -0.5 * k;
        this.body.rotation.z += -0.1 * k;
      }
    }
    // Touche : ballon tenu à deux mains derrière la tête, puis lancer en fouettant le buste.
    if (p.hold > 0 || p.throwIn > 0) {
      const t = p.throwIn > 0 ? 1 - p.throwIn / 0.6 : 0;
      const k = p.throwIn > 0 ? Math.min(1, t * 2.2) : 0;
      for (const a of this.arms) { a.sh.rotation.x = -a.sgn * 0.2; a.sh.rotation.z = 3.3 - 1.9 * k; a.el.rotation.z = 1.3 * (1 - k) + 0.1; }
      this.body.rotation.z = 0.22 * (1 - k) - 0.3 * k;
      lL.hip.rotation.z = 0.35; lR.hip.rotation.z = -0.25; lL.knee.rotation.z = -0.2; lR.knee.rotation.z = -0.3;
    }
    // Ballon posé (coup franc, corner, six mètres) : il se penche et le place à deux mains.
    if (p.place > 0) {
      const k = Math.sin((1 - p.place / 0.9) * Math.PI);
      // Buste penché en avant, jambes ramenées à la verticale et genoux pliés (accroupi).
      this.body.rotation.z = -0.6 * k; this.body.position.y = -0.3 * k;
      lL.hip.rotation.z = lR.hip.rotation.z = 1.25 * k; lL.knee.rotation.z = lR.knee.rotation.z = -1.3 * k;
      for (const a of this.arms) { a.sh.rotation.z = 0.95 * k; a.sh.rotation.x = a.sgn * 0.15 * k; a.el.rotation.z = 0.15; }
    }
    // Tireur de corner : bras levé pour donner le signal.
    if (p.signal > 0) { const a = this.arms[1]; a.sh.rotation.x = -a.sgn * 2.55; a.sh.rotation.z = 0.25; a.el.rotation.z = 0.1; }
    // Mur : les joueurs se protègent, mains devant eux, coudes serrés.
    if (p.wall && !(p.jump > 0)) {
      for (const a of this.arms) { a.sh.rotation.z = 0.2; a.sh.rotation.x = a.sgn * 0.3; a.el.rotation.z = 0.75; }
    }
    // Gardien ballon en main : bras repliés contre la poitrine.
    if (ctx.holding) {
      for (const a of this.arms) { a.sh.rotation.z = 0.9; a.sh.rotation.x = a.sgn * 0.25; a.el.rotation.z = 1.5; }
    }
    // Tacle (glissé ou debout) : séquence d'images clés, durée réelle du geste.
    if (p.slide > 0) {
      if (!(this._slideMax > 0) || p.slide > this._slidePrev + 0.01) this._slideMax = p.slide;
      this._slidePrev = p.slide;
      const t = 1 - p.slide / this._slideMax;
      this.applyKeys(keyPose(p.tk === 'stand' ? KEYS.stand : KEYS.slide, t), (p.id ?? 0) % 2 === 1);
    } else this._slideMax = 0;
    // Plongeon du gardien : il se projette sur le côté, bras tendus vers le ballon.
    if (p.dive > 0) {
      const t = 1 - p.dive / 0.75;
      const k = t < 0.45 ? Math.sin((t / 0.45) * Math.PI / 2) : 1 - Math.max(0, (t - 0.8) / 0.2) * 0.25;
      const dir = (flip ? -1 : 1) * (p.diveDir || 1);
      const hgt = p.diveH ?? 0.5;
      this.body.rotation.x = dir * 1.45 * k;
      this.body.position.y = (0.25 + 0.9 * hgt) * Math.sin(Math.min(1, t / 0.6) * Math.PI) * K;
      for (const a of this.arms) { a.sh.rotation.x = -dir * 2.9 * k; a.sh.rotation.z = 0.1; a.el.rotation.z = 0.05; }
      lL.hip.rotation.z = 0.2 * k; lR.hip.rotation.z = -0.3 * k;
    }
    // Arbitre : carton brandi bras tendu vers le ciel, bras qui désigne le point de penalty,
    // main à la bouche pour siffler.
    if (p.card > 0) { const a = this.arms[1]; a.sh.rotation.x = -a.sgn * 3.0; a.sh.rotation.z = 0; a.el.rotation.z = 0; }
    if (p.point > 0) { const a = this.arms[0]; a.sh.rotation.z = 1.5; a.el.rotation.z = 0.05; }
    if (p.whistle > 0) { const a = this.arms[1]; a.sh.rotation.z = 0.6; a.el.rotation.z = 2.3; }
    // Contact d'épaule : il est déséquilibré sur le côté, bras écartés, puis se rétablit.
    if (p.bump > 0 && !(p.fall > 0) && !(p.slide > 0)) {
      const k = Math.sin(Math.min(1, p.bump / 0.35) * Math.PI);
      const side = Math.sign(Math.sin((p.bumpDir ?? 0) - (p.face || 0))) || 1;
      this.body.rotation.x += (flip ? -1 : 1) * side * 0.32 * k;
      for (const a of this.arms) { a.sh.rotation.x += a.sgn * 0.6 * k; a.el.rotation.z = Math.max(a.el.rotation.z, 0.4 * k); }
    }
    // Fauché : il trébuche, amortit avec les mains, reste au sol, se relève par les genoux.
    if (p.fall > 0 && !(p.slide > 0)) {
      if (!(this._fallMax > 0) || p.fall > this._fallPrev + 0.01) this._fallMax = p.fall;
      this._fallPrev = p.fall;
      const t = 1 - p.fall / this._fallMax;
      // Chute courte (simple déséquilibre) : on ne joue que le début et la fin de la séquence.
      const tt = this._fallMax < 0.9 ? (t < 0.5 ? t * 0.5 : 0.75 + (t - 0.5) * 0.5) : t;
      this.applyKeys(keyPose(KEYS.fall, tt), (p.id ?? 0) % 2 === 0);
    } else this._fallMax = 0;
    // Blessé : il se tord de douleur au sol (léger balancement), jusqu'à l'arrivée des soigneurs.
    if (p.hurt > 0 && !(p.slide > 0)) this.applyKeys(keyPose(KEYS.hurt, (p.hurt * 0.6) % 1), (p.id ?? 0) % 2 === 1);
    // Fautif : bras écartés, paumes vers le ciel (« je n'ai rien fait ! »).
    if (p.appeal > 0 && !(p.slide > 0) && !(p.fall > 0)) {
      const k = Math.min(1, p.appeal / 0.4, (1.8 - p.appeal) / 0.3);
      for (const a of this.arms) { a.sh.rotation.x = -a.sgn * 1.15 * k; a.sh.rotation.z = 0.3 * k; a.el.rotation.z = 1.35 * k; }
      this.upper.rotation.z = 0.08 * k;
    }
    // Grosse occasion manquée : mains sur la tête, buste qui se cambre.
    if (p.headHands > 0 && !(p.slide > 0) && !(p.fall > 0)) {
      const k = Math.min(1, p.headHands / 0.35, (2.2 - p.headHands) / 0.3);
      for (const a of this.arms) { a.sh.rotation.x = -a.sgn * 0.55 * k; a.sh.rotation.z = 2.7 * k; a.el.rotation.z = 2.1 * k; }
      this.upper.rotation.z = 0.18 * k;
    }
    // Ballon sur lui : il se couche / bloque, mains en avant.
    if (p.block > 0) { for (const a of this.arms) { a.sh.rotation.z = 1.3; a.el.rotation.z = 0.3; } lL.knee.rotation.z = lR.knee.rotation.z = -0.5; }
    // Saut (tête) : impulsion, bras qui montent, coup de tête.
    if (p.jump > 0) {
      const t = 1 - p.jump / 0.45;
      this.body.position.y += Math.sin(t * Math.PI) * 0.75;
      for (const a of this.arms) { a.sh.rotation.z = 1.4 * Math.sin(t * Math.PI); a.el.rotation.z = 0.9; }
      this.body.rotation.z = -0.25 + 0.5 * Math.max(0, Math.sin((t - 0.4) * Math.PI));
      lL.knee.rotation.z = lR.knee.rotation.z = -0.6 * Math.sin(t * Math.PI);
    }
    // Duel au coude-à-coude : épaule contre épaule, bras qui tient l'adversaire à distance.
    if (ctx.jostle && !(p.kick > 0) && !(p.slide > 0) && !(p.fall > 0)) {
      const side = ctx.jostle; // -1 : adversaire à gauche, 1 : à droite
      this.body.rotation.x += side * 0.16;
      const a = side > 0 ? this.arms[1] : this.arms[0];
      a.sh.rotation.x = -a.sgn * 1.05; a.sh.rotation.z = 0.35; a.el.rotation.z = 0.5;
    }
    // Célébration : course bras écartés (« l'avion »), puis bonds bras levés.
    if (p.celeb > 0) {
      if (sp > 2) for (const a of this.arms) { a.sh.rotation.x = -a.sgn * 1.45; a.sh.rotation.z = 0; a.el.rotation.z = 0.05; }
      else if (p.celebType === 'knees') {           // à genoux, bras au ciel
        this.body.position.y = -0.42; this.body.rotation.z = 0.25;
        lL.hip.rotation.z = lR.hip.rotation.z = 0.1; lL.knee.rotation.z = lR.knee.rotation.z = -1.9;
        for (const a of this.arms) { a.sh.rotation.x = -a.sgn * 2.7; a.sh.rotation.z = 0.3; a.el.rotation.z = 0.15; }
      } else if (p.celebType === 'fist') {          // poing rageur, buste penché
        const k = Math.abs(Math.sin(p.celeb * 5));
        this.arms[1].sh.rotation.z = 1.2 + 0.6 * k; this.arms[1].el.rotation.z = 2.0;
        this.arms[0].sh.rotation.x = 0.7; this.body.rotation.z = -0.25; lL.knee.rotation.z = lR.knee.rotation.z = -0.4;
      } else if (p.celebType === 'point') {         // index vers le ciel
        this.arms[0].sh.rotation.x = 2.9; this.arms[0].el.rotation.z = 0.05; this.arms[1].sh.rotation.x = 2.9; this.arms[1].el.rotation.z = 0.05;
        this.body.rotation.z = 0.15;
      } else { for (const a of this.arms) { a.sh.rotation.x = -a.sgn * 2.6; a.sh.rotation.z = 0.2; a.el.rotation.z = 0.2; } this.body.position.y += Math.abs(Math.sin(p.celeb * 7)) * 0.2; }
    }
    this.shadow.scale.setScalar(1 - Math.min(0.5, this.body.position.y * 0.4));
  }
}

/** Taille estimée quand la vraie n'est pas connue (selon le poste et le physique). */
function estHeight(p) {
  const base = { GB: 189, DC: 187, MDC: 181, DG: 177, DD: 177, MC: 179, MO: 176, AG: 175, AD: 175, BU: 183 }[p.pos] ?? 180;
  return base + ((p.attrs?.phy ?? 65) - 65) * 0.15 + ((p.id * 37) % 9) - 4;
}

/* ---------------- Scène ---------------- */

/* ---------------- Coach en 3D (éditeur et bord du terrain) ---------------- */

/** Apparence complète d'un coach (valeurs par défaut pour les anciens profils). */
export function coachLook3D(look = {}) {
  return {
    skin: '#e0ac7e', hairColor: '#3d2a1a', hairStyle: 'short', outfit: 'suit', outfitColor: '#1c2333', height: 180, build: 'athletic',
    trousers: null, accent: '#ffffff', shoes: 'city', stance: 'arms', celeb: 'fist', temper: 'normal', ...look,
  };
}
const BUILD_GIRTH = { slim: 0.9, athletic: 1, stocky: 1.1, heavy: 1.22 };
const IR = 1; // sens de la rotation interne des épaules (vérifié en images)

/**
 * Coach 3D : même squelette articulé que les joueurs, habillé (pantalon long, manches longues,
 * costume avec cravate, manteau long, doudoune, survêtement à bandes…), accessoires (casquette,
 * bonnet, écharpe, oreillette, lunettes, montre), taille et corpulence réglables.
 * update() l'anime : attitude préférée, il suit l'action le long de la ligne, donne des
 * consignes, crie, applaudit, célèbre les buts ou se prend la tête.
 */
export class Coach3D {
  constructor(look) {
    const L = this.look = coachLook3D(look);
    const M = (c, r = 0.8, extra = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: r, ...extra });
    const outfit = M(L.outfitColor, L.outfit === 'puffer' ? 0.45 : 0.75);
    const trousersC = L.trousers || (L.outfit === 'tracksuit' ? L.outfitColor : '#1a1d24');
    const pants = M(trousersC, 0.8);
    const accent = M(L.accent || '#ffffff', 0.6);
    const shoe = M(L.shoes === 'sneakers' ? '#f0f0f0' : L.shoes === 'boots' ? '#3b2a1c' : '#111111', 0.35);
    const mats = { shirt: outfit, shorts: pants, socks: pants, trim: L.outfit === 'suit' || L.outfit === 'coat' ? M('#f4f4f4', 0.6) : accent, boot: shoe, sole: M('#2a2a2a'),
      shadow: new THREE.MeshBasicMaterial({ color: '#000', transparent: true, opacity: 0.3, depthWrite: false }), ring: accent };
    const faceLook = { ...L, glasses: L.glasses === true ? 'square' : L.glasses };
    const p3 = this.p3 = new Player3D(mats, L.skin, L.hairColor, '', L.outfitColor, L.outfitColor, null, { look: faceLook, name: '' });
    this.root = p3.root;
    p3.setHair(L.hairStyle);
    // Pantalon long : cuisses et genoux habillés. Manches longues (sauf polo).
    for (const l of p3.legs) { l.hip.children[0].material = pants; l.knee.children[0].material = pants; }
    if (L.outfit !== 'polo') for (const a of p3.arms) { a.sh.children[2].material = outfit; a.el.children[0].material = outfit; a.el.children[1].material = outfit; }
    const torsoY = 0.95, body = p3.upper || p3.body;
    const add = (g, m, x, y, z, parent = body) => { const o = new THREE.Mesh(g, m); o.position.set(x, y, z); parent.add(o); o.castShadow = true; return o; };
    // Tenues.
    if (L.outfit === 'suit') {
      add(new THREE.BoxGeometry(0.02, 0.36, 0.06), accent, 0.15, 1.27 - torsoY, 0).rotation.z = 0.06;             // cravate
      add(new THREE.BoxGeometry(0.02, 0.1, 0.16), M('#f4f4f4', 0.6), 0.142, 1.47 - torsoY, 0);                   // col de chemise
    }
    if (L.outfit === 'coat') {
      const skirt = add(new THREE.CylinderGeometry(0.2, 0.26, 0.5, 14, 1, true), new THREE.MeshStandardMaterial({ color: L.outfitColor, roughness: 0.8, side: THREE.DoubleSide }), 0, 0.68, 0, p3.body);
      skirt.scale.set(0.95, 1, 1.25);
    }
    if (L.outfit === 'puffer') {
      for (let i = 0; i < 4; i++) { const r = add(new THREE.TorusGeometry(0.2, 0.035, 6, 18), outfit, 0, 1.08 + i * 0.1 - torsoY, 0); r.rotation.x = Math.PI / 2; r.scale.set(0.82, 1.22, 1); }
    }
    if (L.outfit === 'tracksuit') for (const l of p3.legs) add(new THREE.BoxGeometry(0.03, 0.4, 0.02), accent, 0, -0.2, 0.075 * (l === p3.legs[0] ? -1 : 1), l.hip);
    if (L.outfit === 'rollneck') add(new THREE.CylinderGeometry(0.075, 0.085, 0.09, 12), outfit, 0, 1.55 - torsoY, 0);
    // Accessoires (tête : rattachés au pivot de la tête).
    const head = p3.headPivot;
    if (L.acc === 'cap') {
      const cap = M(L.accent || '#1c2333', 0.7);
      add(new THREE.SphereGeometry(0.115, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), cap, -0.01, 0.13, 0, head);
      add(new THREE.BoxGeometry(0.13, 0.012, 0.16), cap, 0.12, 0.135, 0, head).rotation.z = -0.15;
    } else if (L.acc === 'beanie') add(new THREE.SphereGeometry(0.118, 14, 8, 0, Math.PI * 2, 0, Math.PI / 1.8), M(L.accent || '#2b2f36', 0.95), -0.01, 0.11, 0, head);
    else if (L.acc === 'scarf') { const sc = add(new THREE.TorusGeometry(0.085, 0.035, 8, 18), M(L.accent || '#c1121f', 0.9), 0, 1.53 - torsoY, 0); sc.rotation.x = Math.PI / 2; }
    else if (L.acc === 'headset') {
      const hs = add(new THREE.TorusGeometry(0.115, 0.01, 6, 20, Math.PI), M('#111', 0.4), 0, 0.09, 0, head); hs.rotation.y = Math.PI / 2;
      add(new THREE.BoxGeometry(0.11, 0.008, 0.008), M('#111', 0.4), 0.06, 0.0, 0.1, head);
    }
    if (L.glasses && L.glasses !== 'none') {
      const lens = M(L.glasses === 'sun' ? '#0b0b0b' : '#bcd4e6', 0.1, { transparent: L.glasses !== 'sun', opacity: 0.5, metalness: 0.3 });
      const frame = M('#141414', 0.3);
      for (const z of [-0.04, 0.04]) add(L.glasses === 'round' ? new THREE.CylinderGeometry(0.025, 0.025, 0.006, 14) : new THREE.BoxGeometry(0.006, 0.035, 0.05), lens, 0.118, 0.1, z, head).rotation.z = L.glasses === 'round' ? Math.PI / 2 : 0;
      add(new THREE.BoxGeometry(0.004, 0.006, 0.12), frame, 0.12, 0.112, 0, head);
    }
    if (L.watch) add(new THREE.BoxGeometry(0.035, 0.02, 0.04), M('#c9a227', 0.25, { metalness: 0.8 }), 0, -0.24, 0, p3.arms[0].el);
    // Taille et corpulence.
    const hk = Math.max(0.86, Math.min(1.14, (L.height || 180) / 181));
    const g = BUILD_GIRTH[L.build] || 1;
    p3.body.scale.set(K * hk * g, K * hk, K * hk * g);
    this.mood = { kind: L.stance || 'arms', t: 0, until: 0 };
    this.phase = 0; this.x = 0;
  }

  /** Réaction à un événement (but, occasion, faute…). */
  react(kind, dur = 2.5) { this.mood = { kind, t: 0, until: dur }; }

  /**
   * Anime le coach. pos : { x, z } (monde), lookAt : { x, z } (ballon), dt en secondes.
   * Il marche le long de sa zone technique en suivant le jeu.
   */
  update(dt, pos, lookAt) {
    const L = this.look, p3 = this.p3, m = this.mood;
    m.t += dt;
    if (m.until && m.t > m.until) this.mood = { kind: L.stance || 'arms', t: 0, until: 0 };
    // Petits changements d'attitude au fil du match (selon son tempérament).
    if (!this.mood.until && m.t > (L.temper === 'calm' ? 14 : L.temper === 'volcanic' ? 5 : 9) && Math.random() < dt * 0.5) {
      const pool = L.temper === 'calm' ? ['arms', 'pockets', 'note', 'arms'] : L.temper === 'volcanic' ? ['point', 'shout', 'point', 'arms', 'hips'] : ['point', 'arms', 'hips', 'pockets', 'shout'];
      this.react(pool[Math.floor(Math.random() * pool.length)], 2 + Math.random() * 3);
    }
    const tx = pos.x;
    const dx = tx - this.root.position.x;
    const sp = Math.min(1.4, Math.abs(dx) * 1.2);
    this.root.position.x += Math.sign(dx) * Math.min(Math.abs(dx), sp * dt);
    this.root.position.z = pos.z;
    this.phase += dt * sp * 2.6;
    const face = Math.atan2(-(lookAt.z - this.root.position.z), lookAt.x - this.root.position.x);
    p3.pose({ face: 0, speed: sp > 0.15 ? sp : 0, phase: this.phase, id: 0 }, false, { dt });
    this.root.rotation.y = face;
    const [aL, aR] = p3.arms, [lL, lR] = p3.legs, k = Math.min(1, m.t / 0.3);
    // yL / yR : rotation interne de l'épaule (ramène l'avant-bras devant la poitrine).
    const arms = (szL, sxL, eL, szR, sxR, eR, yL = 0, yR = 0) => { aL.sh.rotation.set(-aL.sgn * sxL * k, aL.sgn * yL * k * IR, szL * k); aL.el.rotation.set(0, 0, eL * k); aR.sh.rotation.set(-aR.sgn * sxR * k, aR.sgn * yR * k * IR, szR * k); aR.el.rotation.set(0, 0, eR * k); };
    switch (this.mood.kind) {
      case 'arms': arms(0.55, 0.05, 1.85, 0.45, 0.05, 1.95, 1.15, 1.05); break;          // bras croisés
      case 'pockets': arms(-0.12, 0.22, 0.6, -0.12, 0.22, 0.6); break;                   // mains dans les poches
      case 'hips': arms(-0.35, 0.55, 1.75, -0.35, 0.55, 1.75); break;                    // mains sur les hanches
      case 'note': arms(0.8, 0.05, 1.6, 0.7, 0.05, 1.8, 0.7, 0.6); p3.headPivot.rotation.z = -0.35; break; // carnet de notes
      case 'point': { const w = 0.85 + 0.15 * Math.sin(m.t * 6); arms(0.1, 0.1, 0.3, 1.55 * w, 0.15, 0.05); break; }  // consigne, bras tendu
      case 'shout': arms(1.25, 0.05, 2.35, 1.25, 0.05, 2.35, 0.9, 0.9); p3.upper.rotation.z = -0.12; break;       // mains en porte-voix
      case 'applaud': { const c = Math.abs(Math.sin(m.t * 9)); arms(1.1, 0.05, 1.2, 1.1, 0.05, 1.2, 0.5 + 0.35 * c, 0.5 + 0.35 * c); break; }
      case 'despair': arms(2.7, 0.55, 2.1, 2.7, 0.55, 2.1); p3.upper.rotation.z = 0.15; break;                    // mains sur la tête
      case 'protest': arms(0.45, 1.1, 1.3, 0.45, 1.1, 1.3); break;                                                // bras écartés vers l'arbitre
      case 'celebrate': {
        const c = L.celeb || 'fist';
        if (c === 'fist') { const pump = Math.abs(Math.sin(m.t * 5)); arms(0.1, 0.2, 0.4, 2.2 + 0.5 * pump, 0.1, 1.6 - 1.2 * pump); }
        else if (c === 'arms') arms(2.9, 0.2, 0.1, 2.9, 0.2, 0.1);
        else if (c === 'jump') { arms(2.6, 0.3, 0.3, 2.6, 0.3, 0.3); p3.body.position.y += Math.max(0, Math.sin(m.t * 7)) * 0.35 * K; }
        else if (c === 'clap') { const cc = Math.abs(Math.sin(m.t * 9)); arms(1.3, 0.05, 1.1, 1.3, 0.05, 1.1, 0.5 + 0.35 * cc, 0.5 + 0.35 * cc); }
        else if (c === 'knee') { lL.hip.rotation.z = 1.4; lL.knee.rotation.z = -1.6; lR.hip.rotation.z = -0.1; lR.knee.rotation.z = -1.9; arms(0.2, 0.2, 1.6, 2.2, 0.1, 1.2); p3.groundContact(); }
        else if (c === 'calm') arms(0.9, -0.2, 1.4, 0.9, -0.2, 1.4);
        break;
      }
      default: break;
    }
    p3.smoothPose(dt);
  }
}

export class Match3D {
  constructor(view) {
    this.v = view;
    const parent = view.canvas.parentElement;
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'pitch3d';
    parent.insertBefore(this.canvas, view.canvas);
    // Téléphones / tablettes : pas d'anticrénelage matériel (coûteux), ombres simplifiées, 40 images/s max.
    this.mobile = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
    // Qualité graphique (Paramètres) : ultra (défaut sur PC), high (défaut sur téléphone), eco.
    this.gfx = globalThis.__cdpGfx || (this.mobile ? 'high' : 'ultra');
    const ultra = this.gfx === 'ultra', eco = this.gfx === 'eco';
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: ultra || (!this.mobile && !eco), powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;   // rendu « télé » : contrastes doux, couleurs riches
    this.renderer.toneMappingExposure = 1.15;
    this.scene = new THREE.Scene();
    // Ciel de soirée (dégradé) : match en nocturne sous les projecteurs.
    this.scene.background = canvasTex(4, 256, (g, w, h) => {
      const gr = g.createLinearGradient(0, 0, 0, h);
      gr.addColorStop(0, '#060b1a'); gr.addColorStop(0.55, '#16264a'); gr.addColorStop(0.85, '#3a3f63'); gr.addColorStop(1, '#5b4a5e');
      g.fillStyle = gr; g.fillRect(0, 0, w, h);
    });
    this.scene.fog = new THREE.Fog('#141d33', 150, 280);
    this.camera = new THREE.PerspectiveCamera(30, 1.5, 0.5, 600);
    this.camMode = 'tv';
    this.camPos = new THREE.Vector3(0, 30, 70);
    this.camLook = new THREE.Vector3(0, 0, 0);
    this.hemi = new THREE.HemisphereLight('#e8f0ff', '#2f4a32', 1.1);
    this.scene.add(this.hemi);
    const sun = new THREE.DirectionalLight('#ffffff', 1.3);
    this.sun = sun;
    sun.position.set(-30, 80, 40);
    // Ombres portées des joueurs sur la pelouse (désactivées sur les appareils trop lents).
    const shadows = ultra || (!this.mobile && !eco);
    this.renderer.shadowMap.enabled = shadows;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    sun.castShadow = shadows;
    const sm = ultra ? (this.mobile ? 2048 : 4096) : 1536;
    sun.shadow.mapSize.set(sm, sm);
    sun.shadow.autoUpdate = true;
    Object.assign(sun.shadow.camera, { left: -62, right: 62, top: 42, bottom: -42, near: 10, far: 220 });
    sun.shadow.bias = -0.0005; sun.shadow.normalBias = 0.02;
    this.scene.add(sun);
    this.buildStadium();
    this.applyConditions(view.m.weather);
    this.buildBall();
    this.players = new Map(); // id -> { p3, label, side }
    this.buildCoaches();
    // Arbitre : tenue noire.
    const black = new THREE.MeshLambertMaterial({ color: '#15171c' });
    const refMats = { shirt: black, shorts: black, socks: black, boot: new THREE.MeshLambertMaterial({ color: '#0a0a0a' }),
      shadow: new THREE.MeshBasicMaterial({ color: '#000', transparent: true, opacity: 0.32, depthWrite: false }), ring: black };
    this.ref3d = new Player3D(refMats, '#c68642', '#1a120c', '', '#15171c', '#15171c');
    this.scene.add(this.ref3d.root);
    this.mats = view.colors.map((c, side) => this.teamMats(side));
    this.resize();
  }

  teamMats(side) {
    const v = this.v;
    return {
      // Tissus techniques : légèrement satinés (les projecteurs accrochent les plis).
      shirt: new THREE.MeshStandardMaterial({ color: v.colors[side], roughness: 0.78, metalness: 0.02 }),
      gk: new THREE.MeshStandardMaterial({ color: v.gkColors[side], roughness: 0.78 }),
      shorts: new THREE.MeshStandardMaterial({ color: v.shorts[side], roughness: 0.72 }),
      socks: new THREE.MeshStandardMaterial({ color: v.colors[side], roughness: 0.9 }),
      trim: new THREE.MeshStandardMaterial({ color: v.textColors[side], roughness: 0.7 }),
      sole: new THREE.MeshStandardMaterial({ color: '#e9e9e9', roughness: 0.5 }),
      boot: new THREE.MeshStandardMaterial({ color: '#111111', roughness: 0.35, metalness: 0.1 }),
      shadow: new THREE.MeshBasicMaterial({ color: '#000', transparent: true, opacity: 0.32, depthWrite: false }),
      ring: new THREE.MeshBasicMaterial({ color: '#ffd166', transparent: true, opacity: 0.95, depthWrite: false, side: THREE.DoubleSide }),
    };
  }

  buildStadium() {
    const s = this.scene;
    const pt = pitchTexture(this.renderer.capabilities.getMaxAnisotropy());
    this.pitchMat = new THREE.MeshLambertMaterial({ map: pt.tex });
    const pitch = new THREE.Mesh(new THREE.PlaneGeometry(pt.w, pt.h), this.pitchMat);
    pitch.rotation.x = -Math.PI / 2;
    pitch.receiveShadow = true;
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
    // Tribunes : vraie enceinte à deux étages (gradins en marches, sièges, spectateurs 3D).
    const ledMat = new THREE.MeshBasicMaterial({ map: boardsTexture([h.name, a.name]), color: '#ffffff' });
    this.buildBowl(h, a, ledMat);
    // Bancs de touche (abris transparents) côté caméra, et zone technique.
    const glass = new THREE.MeshLambertMaterial({ color: '#9fc3e6', transparent: true, opacity: 0.35 });
    const seatM = new THREE.MeshLambertMaterial({ color: '#1b2233' });
    for (const sx of [-9, 9]) {
      const g2 = new THREE.Group();
      const roof = new THREE.Mesh(new THREE.BoxGeometry(7, 0.12, 2.2), glass); roof.position.set(0, 2.2, 0); g2.add(roof);
      const back = new THREE.Mesh(new THREE.BoxGeometry(7, 2.2, 0.1), glass); back.position.set(0, 1.1, 1.1); g2.add(back);
      const seat = new THREE.Mesh(new THREE.BoxGeometry(6.6, 0.5, 0.8), seatM); seat.position.set(0, 0.45, 0.6); g2.add(seat);
      g2.position.set(sx, 0, W / 2 + 4.6); s.add(g2);
    }
    // Projecteurs.
    const glowTex = canvasTex(64, 64, (g, w, hh) => { const rg = g.createRadialGradient(w / 2, hh / 2, 0, w / 2, hh / 2, w / 2); rg.addColorStop(0, 'rgba(255,255,255,1)'); rg.addColorStop(0.25, 'rgba(255,240,200,.6)'); rg.addColorStop(1, 'rgba(255,240,200,0)'); g.fillStyle = rg; g.fillRect(0, 0, w, hh); });
    const mast = new THREE.MeshLambertMaterial({ color: '#555c69' });
    const lamp = new THREE.MeshBasicMaterial({ color: '#fffbe6' });
    // Pylônes (vieux stades) ou rampes dans le toit (stades modernes : seul le halo reste visible).
    const towers = this.stadium?.lights === 'towers';
    const TH = towers ? 48 : 34;
    for (const [x0, z0] of [[-L / 2 - 14, -W / 2 - 14], [L / 2 + 14, -W / 2 - 14], [-L / 2 - 14, W / 2 + 18], [L / 2 + 14, W / 2 + 18]]) {
      const x = towers ? x0 * 1.22 : x0, z = towers ? z0 * 1.6 : z0;
      if (towers) {
        const m = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.9, TH, 8), mast); m.position.set(x, TH / 2, z); s.add(m);
        const l = new THREE.Mesh(new THREE.BoxGeometry(8, 4.5, 1), lamp); l.position.set(x, TH, z); l.lookAt(0, 0, 0); s.add(l);
      }
      // Halo des projecteurs (visible dans le ciel du soir).
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: '#fff3c4', transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.85 }));
      glow.scale.set(towers ? 20 : 16, towers ? 20 : 16, 1); glow.position.set(x, TH, z); s.add(glow); (this.glows ||= []).push(glow);
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

  /**
   * ENCEINTE DU STADE
   * Trois tribunes (la 4e, côté caméra, est retirée comme à la télé), chacune avec :
   *  - deux étages de gradins en marches (béton), séparés par une coursive et un ruban LED ;
   *  - des sièges et des spectateurs en 3D (maillots surtout aux couleurs du club qui reçoit,
   *    parcage visiteur dans un coin, quelques sièges vides) ;
   *  - un toit en porte-à-faux avec rampe d'éclairage, une façade, des poteaux ;
   *  - drapeaux et tifo derrière le but des supporters locaux.
   * Sièges et spectateurs sont des InstancedMesh (quelques appels de dessin seulement).
   */
  buildBowl(h, a, ledMat) {
    const s = this.scene;
    const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
    const SP = coarse ? 1.05 : 0.8;                  // espacement des sièges (m)
    const ST = this.stadium = (typeof window !== 'undefined' && window.__stadiumIdx != null && STADIUMS[window.__stadiumIdx]) || stadiumFor(h);
    const concrete = new THREE.MeshLambertMaterial({ color: ST.conc || '#8b9099' });
    const concreteD = new THREE.MeshLambertMaterial({ color: ST.facade || '#4a505b' });
    const steel = new THREE.MeshLambertMaterial({ color: ST.steel || '#2b3038' });
    const roofUnder = ST.roof === 'glass'
      ? new THREE.MeshLambertMaterial({ color: '#cfe0ee', transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false })
      : new THREE.MeshLambertMaterial({ color: '#d9dde3', side: THREE.DoubleSide });
    const roofGlass = new THREE.MeshLambertMaterial({ color: '#b9d3ea', transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false });
    const lightStrip = new THREE.MeshBasicMaterial({ color: '#fff6dc' });
    const darken = (hex, k) => { const c = new THREE.Color(hex); c.multiplyScalar(k); return c; };
    const seatCol = ST.seat ? new THREE.Color(ST.seat) : darken(h.color, 0.55), seatCol2 = new THREE.Color('#3c4350');
    const tarp = new THREE.Color('#14171c'); // bâches de la zone tampon du parcage
    const skins = ['#f1c9a5', '#e0b28a', '#c68f63', '#a0673f', '#6e4429', '#f3d2b5'].map((c) => new THREE.Color(c));
    const others = ['#e8e8e8', '#20242c', '#5d6b85', '#8b2d2d', '#2f5d3a', '#c9b38a'].map((c) => new THREE.Color(c));
    const cH = new THREE.Color(h.color), cH2 = new THREE.Color(h.color2 || '#ffffff');
    let cA = new THREE.Color(a.color), cA2 = new THREE.Color(a.color2 || '#ffffff');
    const cdist = (x, y) => Math.abs(x.r - y.r) + Math.abs(x.g - y.g) + Math.abs(x.b - y.b);
    if (cdist(cA, cH) < 0.35 && cdist(cA2, cH) > 0.35) [cA, cA2] = [cA2, cA]; // parcage lisible même si les couleurs se ressemblent
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const bodyG = new THREE.BoxGeometry(0.46, 0.62, 0.3); bodyG.translate(0, 0.55, 0.05);
    const headG = new THREE.BoxGeometry(0.22, 0.24, 0.22); headG.translate(0, 1.0, 0.05);
    // Siège = assise + dossier dans une seule géométrie (un seul appel de dessin).
    const seatG = mergeBoxes([[0.46, 0.1, 0.4, 0, 0.38, 0.05], [0.46, 0.42, 0.06, 0, 0.6, 0.27]]);
    const white = new THREE.MeshLambertMaterial({ color: '#ffffff' });
    this.crowdGroups = [];
    this.flags = [];
    /** Tiers : [rangs, profondeur, montée] ; le 2e étage commence après la coursive. */
    const tiersOf = (l) => l.map(([rows, rise]) => ({ rows: coarse ? Math.max(5, Math.round(rows * 0.8)) : rows, dep: 0.82, rise }));
    const stand = (len, rotY, dist, opts = {}) => {
      const TIERS = opts.tiers || tiersOf(ST.main);
      const g = new THREE.Group();
      g.rotation.y = rotY;
      if (opts.pos) g.position.set(opts.pos[0], 0, opts.pos[1]);
      // Profil des marches (z vers l'extérieur, y vers le haut).
      const shape = new THREE.Shape();
      const rowsPos = [];
      let z = dist, y = 1.1;
      shape.moveTo(dist - 0.4, 0); shape.lineTo(dist - 0.4, y);
      TIERS.forEach((t, ti) => {
        if (ti === 1) { // coursive + façade du 2e étage (support du ruban LED)
          shape.lineTo(z + 2.4, y); z += 2.4;
          const yTop = y + 3.2;
          const led = new THREE.Mesh(new THREE.PlaneGeometry(len, 1.1), ledMat);
          led.position.set(0, y + 1.9, z - 0.05); led.rotation.y = Math.PI; g.add(led);
          shape.lineTo(z, yTop); y = yTop;
        }
        for (let r = 0; r < t.rows; r++) {
          rowsPos.push({ z: z + t.dep * 0.5, y, tier: ti });
          shape.lineTo(z + t.dep, y); z += t.dep;
          if (r < t.rows - 1) { shape.lineTo(z, y + t.rise); y += t.rise; }
        }
      });
      const zBack = z, yTop = y;
      shape.lineTo(zBack + 1.2, yTop); shape.lineTo(zBack + 1.2, 0); shape.lineTo(dist - 0.4, 0);
      const steps = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: len, bevelEnabled: false }), concrete);
      steps.rotation.y = -Math.PI / 2; steps.position.x = len / 2;
      g.add(steps);
      // Façade arrière et mur d'enceinte.
      const facade = new THREE.Mesh(new THREE.BoxGeometry(len, yTop + 7, 0.6), concreteD);
      facade.position.set(0, (yTop + 7) / 2, zBack + 1.5); g.add(facade);
      for (let x = -len / 2; x <= len / 2 + 0.1; x += 12) {
        const rib = new THREE.Mesh(new THREE.BoxGeometry(0.5, yTop + 7.5, 0.8), steel); rib.position.set(x, (yTop + 7.5) / 2, zBack + 1.9); g.add(rib);
      }
      // Toit (selon le modèle) : porte-à-faux, translucide, haut, vieux toit bas sur poteaux, ou aucun.
      const RT = opts.roof || ST.roof;
      const rLen = zBack - dist + (RT === 'low' ? 2 : 6), rY0 = yTop + (RT === 'tall' ? 10 : RT === 'low' ? 3.2 : 6.5), rY1 = rY0 + (RT === 'low' ? 0.6 : 1.7);
      if (RT === 'low') for (let x = -len / 2 + 6; x < len / 2; x += 14) {
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.3, rY1, 0.3), steel); post.position.set(x, rY1 / 2, dist + 2.6); g.add(post);
      }
      if (RT !== 'none') {
      const roof = new THREE.Mesh(new THREE.PlaneGeometry(len + 2, rLen), roofUnder);
      roof.rotation.x = -Math.PI / 2 + Math.atan2(rY1 - rY0, rLen); roof.position.set(0, (rY0 + rY1) / 2, zBack + 1.5 - rLen / 2); g.add(roof);
      const edge = new THREE.Mesh(new THREE.PlaneGeometry(len + 2, 3.2), roofGlass);
      edge.rotation.x = -Math.PI / 2 + 0.08; edge.position.set(0, rY1 + 0.15, zBack + 1.5 - rLen - 1.5); g.add(edge);
      const strip = new THREE.Mesh(new THREE.BoxGeometry(len, 0.18, 0.3), lightStrip); strip.position.set(0, rY1 - 0.25, zBack + 1.5 - rLen + 0.4); g.add(strip);
      const beam = new THREE.Mesh(new THREE.BoxGeometry(len + 2, 0.7, 0.7), steel); beam.position.set(0, rY0, zBack + 1.4); g.add(beam);
      for (let x = -len / 2; x <= len / 2 + 0.1; x += len / 4) {
        const col = new THREE.Mesh(new THREE.BoxGeometry(0.6, rY0, 0.6), steel); col.position.set(x, rY0 / 2, zBack + 2.2); g.add(col);
        const truss = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.9, rLen), steel);
        truss.position.set(x, (rY0 + rY1) / 2 + 0.5, zBack + 1.5 - rLen / 2); truss.rotation.x = -Math.atan2(rY1 - rY0, rLen); g.add(truss);
      }
      }
      // Muret devant le premier rang + escaliers d'accès (bandes claires).
      const wall = new THREE.Mesh(new THREE.BoxGeometry(len, 1.3, 0.3), concreteD); wall.position.set(0, 0.65, dist - 0.45); g.add(wall);
      // Sièges et spectateurs.
      const nPer = Math.floor(len / SP);
      const slots = [];
      for (const rp of rowsPos) for (let i = 0; i < nPer; i++) {
        const x = -len / 2 + SP * (i + 0.5);
        if (Math.abs(((x + len / 2) % 18) - 9) < SP * 0.6) continue; // allées d'escalier
        slots.push([x + (rp.tier ? 0 : (rnd() - 0.5) * 0.04), rp.y, rp.z, rp]);
      }
      const fill = opts.fill ?? 0.9;
      const AW = opts.away; // { x0, tiers } : parcage pour x > x0 dans ces étages
      const inAway = (x, rp) => AW && AW.tiers.includes(rp.tier) && x > AW.x0;
      const inBuffer = (x, rp) => AW && AW.tiers.includes(rp.tier) && x > AW.x0 - 4.5 && x <= AW.x0;
      const fans = [], empty = [], buffer = [];
      for (const sl of slots) {
        if (inBuffer(sl[0], sl[3])) buffer.push(sl);
        else (rnd() < (inAway(sl[0], sl[3]) ? 0.96 : fill) ? fans : empty).push(sl);
      }
      empty.push(...buffer);
      // Sièges : seuls les sièges vides sont dessinés (les autres sont cachés par les spectateurs).
      const seats = new THREE.InstancedMesh(seatG, white, empty.length);
      const bodies = new THREE.InstancedMesh(bodyG, white, fans.length), heads = new THREE.InstancedMesh(headG, white, fans.length);
      const M = new THREE.Matrix4();
      empty.forEach(([x, yy, zz], i) => {
        M.makeTranslation(x, yy, zz); seats.setMatrixAt(i, M);
        seats.setColorAt(i, i >= empty.length - buffer.length ? tarp : (Math.floor((x + len / 2) / 3) + Math.round(yy)) % 7 === 0 ? seatCol2 : seatCol);
      });
      fans.forEach((sl, i) => {
        const [x, yy, zz] = sl;
        const stand = rnd() < (inAway(x, sl[3]) ? 0.7 : 0.18) ? 0.12 : 0; // quelques supporters debout (tout le parcage)
        M.makeTranslation(x, yy + stand, zz - 0.02); bodies.setMatrixAt(i, M); heads.setMatrixAt(i, M);
        const away = inAway(x, sl[3]);
        const r = rnd();
        const col = away ? (r < 0.8 ? cA : r < 0.93 ? cA2 : others[(rnd() * others.length) | 0])
          : r < (opts.ultras ? 0.8 : 0.55) ? cH : r < (opts.ultras ? 0.92 : 0.7) ? cH2 : others[(rnd() * others.length) | 0];
        bodies.setColorAt(i, col); heads.setColorAt(i, skins[(rnd() * skins.length) | 0]);
      });
      for (const im of [seats, bodies, heads]) { im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true; }
      if (empty.length) g.add(seats);
      // Parcage visiteur bien visible : filet de séparation, stewards en chasuble, banderole.
      if (AW) {
        const rowsA = rowsPos.filter((rp) => AW.tiers.includes(rp.tier));
        if (rowsA.length) {
          const y0 = rowsA[0].y, y1 = rowsA[rowsA.length - 1].y + 2.2, z0 = rowsA[0].z, z1 = rowsA[rowsA.length - 1].z;
          const net = new THREE.Mesh(new THREE.PlaneGeometry(Math.hypot(z1 - z0, y1 - y0) + 1, 2.6), new THREE.MeshBasicMaterial({ color: '#dfe6ee', transparent: true, opacity: 0.42, side: THREE.DoubleSide, depthWrite: false }));
          net.rotation.order = 'YXZ'; net.rotation.y = Math.PI / 2; net.rotation.x = -Math.atan2(y1 - y0, z1 - z0);
          net.position.set(AW.x0 - 2.2, (y0 + y1) / 2 + 1, (z0 + z1) / 2); g.add(net);
          const vest = new THREE.MeshLambertMaterial({ color: '#f4e21b' });
          for (let k = 0; k < rowsA.length; k += 2) {
            const st = new THREE.Mesh(bodyG, vest); st.position.set(AW.x0 - 2.2 + (k % 4 ? 1 : -1), rowsA[k].y + 0.12, rowsA[k].z); g.add(st);
          }
          const bw = Math.min(16, len / 2 - AW.x0 - 1);
          if (bw > 4) {
            const ban = new THREE.Mesh(new THREE.PlaneGeometry(bw, 1.2), new THREE.MeshBasicMaterial({ map: canvasTex(512, 48, (gg, w2, h2) => {
              gg.fillStyle = a.color; gg.fillRect(0, 0, w2, h2); gg.fillStyle = a.color2 || '#fff'; gg.fillRect(0, 0, w2, 4); gg.fillRect(0, h2 - 4, w2, 4);
              gg.font = '900 28px system-ui, sans-serif'; gg.textAlign = 'center'; gg.textBaseline = 'middle'; gg.fillText(`${(a.short || a.name).toUpperCase()} · AWAY`, w2 / 2, h2 / 2 + 1);
            }), side: THREE.DoubleSide }));
            const ry = AW.tiers[0] ? rowsA[0].y - 1.3 : 1.0, rz = AW.tiers[0] ? rowsA[0].z - 0.6 : dist - 0.62;
            ban.position.set(AW.x0 + bw / 2 + 0.5, ry, rz); ban.rotation.y = Math.PI; g.add(ban);
          }
        }
      }
      this.crowdHeads = (this.crowdHeads || []).concat(heads);
      const crowdG = new THREE.Group(); crowdG.add(bodies); crowdG.add(heads); g.add(crowdG);
      this.crowdGroups.push({ g: crowdG, ph: rnd() * 6, ultras: !!opts.ultras });
      // Tifo et drapeaux (virage des supporters locaux).
      if (opts.ultras) {
        const tifo = new THREE.Mesh(new THREE.PlaneGeometry(Math.min(40, len * 0.5), 2.2), new THREE.MeshBasicMaterial({ map: canvasTex(1024, 64, (gg, w2, h2) => {
          gg.fillStyle = h.color; gg.fillRect(0, 0, w2, h2); gg.fillStyle = h.color2 || '#fff'; gg.fillRect(0, 0, w2, 6); gg.fillRect(0, h2 - 6, w2, 6);
          gg.font = '900 40px system-ui, sans-serif'; gg.textAlign = 'center'; gg.textBaseline = 'middle'; gg.fillText(`ALLEZ ${h.short || h.name}`.toUpperCase(), w2 / 2, h2 / 2 + 2);
        }), side: THREE.DoubleSide }));
        tifo.position.set(0, 1.9, dist - 0.65); tifo.rotation.y = Math.PI; g.add(tifo);
        const fm = [h.color, h.color2 || '#ffffff'].map((c) => new THREE.MeshLambertMaterial({ color: c, side: THREE.DoubleSide }));
        for (let k = 0; k < 9; k++) {
          const rp = rowsPos[3 + ((k * 5) % 10)];
          const pole = new THREE.Group();
          pole.position.set(-len * 0.3 + k * len * 0.075, rp.y + 1.2, rp.z);
          const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 2.4, 4), steel); stick.position.y = 1.2; pole.add(stick);
          const fl = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 1.1), fm[k % 2]); fl.position.set(0.9, 1.9, 0); pole.add(fl);
          g.add(pole); this.flags.push({ pole, ph: k * 0.9 });
        }
      }
      s.add(g);
      return g;
    };
    // Parcage visiteur selon le modèle : coin du virage, haut du virage, ou bout de la tribune latérale.
    const endT = tiersOf(ST.ends), mainT = tiersOf(ST.main);
    const endLen = W + 16, mainLen = L + 30;
    const awayEnd = ST.away === 'side' ? null
      : ST.away === 'upper' && endT.length > 1 ? { x0: 2, tiers: [endT.length - 1] } // moitié du dernier étage
        : { x0: endLen / 2 - 22, tiers: endT.map((_, i) => i) };
    stand(mainLen, Math.PI, W / 2 + 9, { fill: 0.9, tiers: mainT, away: ST.away === 'side' ? { x0: mainLen / 2 - 24, tiers: [0] } : null }); // grande tribune, en face
    stand(endLen, Math.PI / 2, L / 2 + 10, { fill: 0.93, ultras: true, tiers: endT });   // virage local
    stand(endLen, -Math.PI / 2, L / 2 + 10, { fill: 0.84, tiers: endT, away: awayEnd }); // virage avec parcage visiteur
    // Coins : angles fermés (tribunes de coin) ou ouverts (blocs d'escaliers) ; écrans géants.
    const screenMat = new THREE.MeshBasicMaterial({ color: '#0b1220' });
    for (const sx of [-1, 1]) {
      if (ST.corners === 'closed') {
        stand(24, sx > 0 ? 3 * Math.PI / 4 : -3 * Math.PI / 4, 1, { pos: [sx * 70, -48], fill: 0.86, tiers: tiersOf([ST.ends[0]]), roof: ST.roof === 'low' ? 'low' : 'cant' });
      } else {
        const blk = new THREE.Mesh(new THREE.BoxGeometry(14, 22, 14), concreteD);
        blk.position.set(sx * (L / 2 + 17), 11, -(W / 2 + 18)); s.add(blk);
      }
      const scr = new THREE.Mesh(new THREE.PlaneGeometry(11, 6), screenMat);
      scr.position.set(sx * (L / 2 + 14), ST.corners === 'closed' ? 24 : 17, -(W / 2 + 10.9)); scr.lookAt(0, 8, 0); s.add(scr);
      (this.screens ||= []).push(scr);
    }
  }

  /**
   * Météo et heure, visibles : jour (soleil, ciel bleu) ou nocturne (projecteurs), ciel gris,
   * pluie ou neige qui tombent (inclinées par le vent), pelouse mouillée, brouillard.
   */
  applyConditions(w) {
    if (!w) return;
    const night = !!w.night, grey = ['cloud', 'rain', 'storm', 'snow', 'fog'].includes(w.kind);
    const sky = night ? (grey ? ['#05070d', '#121a2a', '#2a2f3d', '#3d3d48'] : ['#060b1a', '#16264a', '#3a3f63', '#5b4a5e'])
      : grey ? ['#6d7684', '#8d96a3', '#a9b0ba', '#c3c7cc'] : ['#2f6fd6', '#5d97e6', '#9cc4f0', '#d9e9f7'];
    this.scene.background = canvasTex(4, 256, (g, ww, h) => { const gr = g.createLinearGradient(0, 0, 0, h); [0, 0.55, 0.85, 1].forEach((o, i) => gr.addColorStop(o, sky[i])); g.fillStyle = gr; g.fillRect(0, 0, ww, h); });
    const fogC = night ? '#141d33' : grey ? '#9aa2ad' : '#b9d3ee';
    this.scene.fog = new THREE.Fog(fogC, w.kind === 'fog' ? 45 : w.kind === 'storm' ? 90 : 150, w.kind === 'fog' ? 140 : w.kind === 'storm' ? 200 : 280);
    if (!night) { this.sun.intensity = grey ? 0.9 : 1.9; this.sun.color.set(grey ? '#e6ebf2' : '#fff4dc'); this.hemi.intensity = grey ? 1.0 : 1.25; for (const g of this.glows || []) g.visible = false; }
    else { this.sun.intensity = 1.1; this.hemi.intensity = 1.05; }
    if (['rain', 'storm', 'snow'].includes(w.kind) && this.pitchMat) this.pitchMat.color.set(w.kind === 'snow' ? '#f2f6f8' : '#c4cec6'); // pelouse détrempée / poudrée
    if (['rain', 'storm', 'snow'].includes(w.kind)) {
      const n = w.kind === 'storm' ? 3600 : w.kind === 'rain' ? 1900 : 1500;
      const snow = w.kind === 'snow';
      const pos = new Float32Array(n * (snow ? 3 : 6));
      for (let i = 0; i < n; i++) {
        const x = (Math.random() - 0.5) * 150, y = Math.random() * 45, z = (Math.random() - 0.5) * 110;
        if (snow) pos.set([x, y, z], i * 3); else pos.set([x, y, z, x, y - 0.9, z], i * 6);
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      this.precip = snow ? new THREE.Points(geo, new THREE.PointsMaterial({ color: '#ffffff', size: 0.35, transparent: true, opacity: 0.9, depthWrite: false }))
        : new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: night ? '#cfd8e6' : '#e8eef5', transparent: true, opacity: w.kind === 'storm' ? 0.55 : 0.42, depthWrite: false }));
      this.precip.userData = { snow, speed: snow ? 2.2 : w.kind === 'storm' ? 30 : 22, slant: Math.min(0.6, (w.wind || 10) / 60) };
      this.scene.add(this.precip);
    }
  }

  /** Animation de la pluie / de la neige. */
  stepPrecip(dt) {
    const P = this.precip;
    if (!P) return;
    const a = P.geometry.attributes.position, arr = a.array, { snow, speed, slant } = P.userData;
    const st = snow ? 3 : 6, t = (this._pt = (this._pt || 0) + dt);
    for (let i = 0; i < arr.length; i += st) {
      const dy = speed * dt, dx = slant * dy + (snow ? Math.sin(t * 1.3 + i) * 0.02 : 0);
      arr[i] += dx; arr[i + 1] -= dy;
      if (!snow) { arr[i + 3] += dx; arr[i + 4] -= dy; }
      if (arr[i + 1] < 0) {
        const x = (Math.random() - 0.5) * 150, z = (Math.random() - 0.5) * 110;
        arr[i] = x; arr[i + 1] = 45; arr[i + 2] = z;
        if (!snow) { arr[i + 3] = x - slant * 0.9; arr[i + 4] = 44.1; arr[i + 5] = z; }
      }
    }
    a.needsUpdate = true;
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
    // Résolution : au plus ~2,2 millions de pixels (grands écrans de PC), puis réglage
    // automatique selon la fluidité mesurée (this.quality, voir adaptQuality).
    const ultra = this.gfx === 'ultra', eco = this.gfx === 'eco';
    const cap = Math.sqrt((ultra ? 4.2e6 : eco ? 1.1e6 : 2.2e6) / Math.max(1, v.cssW * v.cssH));
    const dpr = Math.max(0.5, Math.min(window.devicePixelRatio || 1, ultra ? 2 : eco ? 1 : this.mobile ? 1.5 : 1.75, cap) * (this.quality ?? 1));
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
        // Apparence réaliste : teint et cheveux selon la nationalité (stables), coiffure, crampons, gants.
        const lk = personLook(id, p.mp?.p?.nat || '', p.mp?.p?.age || 25);
        const bootC = ['#111111', '#111111', '#f2f2f2', '#d7263d', '#2d7ff9', '#e8ff3a', '#ff8c1a'][id % 7];
        const p3 = new Player3D({ ...mats, boot: bootMat(bootC) }, lk.skin, lk.hairColor, p.num, shirtHex, ink, p.mp?.p?.photo || null, { look: lk, name: p.mp?.p?.last || p.short || '' });
        p3.setHair(lk.hairStyle);
        if (p.gk) p3.setGloves('#c6f432');
        // Morphologie du vrai joueur : taille (grand défenseur, petit ailier) et carrure (physique).
        const pl = p.mp?.p;
        // Taille réelle (cm) et carrure tirée du poids (indice de masse corporelle) : un ailier
        // de 1,68 m / 64 kg et un défenseur de 1,95 m / 92 kg ne se ressemblent pas.
        const hgt = pl ? heightOf(pl) : 180;
        const hk = Math.max(0.86, Math.min(1.14, hgt / 181));
        const girth = pl ? Math.max(0.84, Math.min(1.2, Math.pow(bmiOf(pl) / 22.6, 1.3))) : 1;
        const wk = hk * girth;
        p3.body.scale.set(K * wk, K * hk, K * wk);
        p3.setBuild?.(girth);
        const label = textSprite(p.short || '');
        label.position.y = 2.75 * K * hk;
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
    // La caméra anticipe : elle regarde là où le ballon va (vitesse × 0,45 s).
    const P = v.phys, lead = 0.45;
    const lx = P ? (P.x + P.vx * lead) / L : v.ball.x, ly = P ? (P.y + P.vy * lead) / W : v.ball.y;
    const [bx, bz] = this.toWorld(Math.max(-0.02, Math.min(1.02, lx)), Math.max(0, Math.min(1, ly)));
    let mode = this.camMode;
    const celebrating = v.banner && v.banner.text === 'BUT !';
    if (v.replaying || celebrating) mode = 'close';
    const want = new THREE.Vector3(), look = new THREE.Vector3(bx, 0, bz * 0.35);
    if (mode === 'intro') {
      // Avant-match : lent travelling autour du stade, du haut des tribunes vers le terrain.
      const t = (this._introT = (this._introT || 0) + dt);
      const a = -0.9 + t * 0.2;
      want.set(Math.sin(a) * 78, Math.max(14, 34 - t * 2.4), Math.cos(a) * 64); look.set(0, 0, 0); this.camera.fov = 36;
      this.camPos.lerp(want, 1 - Math.exp(-dt * 1.6)); this.camLook.lerp(look, 1 - Math.exp(-dt * 2));
      this.camera.position.copy(this.camPos); this.camera.lookAt(this.camLook); this.camera.updateProjectionMatrix();
      return;
    }
    if (mode === 'tv') { want.set(Math.max(-36, Math.min(36, bx * 0.9)), 21, 58); look.set(bx * 0.97, 0, bz * 0.35 - 1); this.camera.fov = 30; }
    else if (mode === 'close') { want.set(bx * 0.9 - 4, 13, bz + 30); look.set(bx, 1, bz); this.camera.fov = 34; }
    else if (mode === 'high') { want.set(bx * 0.4, 95, 52); look.set(bx * 0.4, 0, 0); this.camera.fov = 38; }
    else { const side = bx >= 0 ? 1 : -1; want.set(side * (L / 2 + 22), 12, bz * 0.3); look.set(bx, 0, bz); this.camera.fov = 40; }
    const k = 1 - Math.exp(-dt * (mode === 'close' ? 3 : 2.2));
    // Après une coupure (avance rapide), la caméra se place directement sur l'action.
    const kk = this.snapCam ? 1 : k; this.snapCam = false;
    this.camPos.lerp(want, kk);
    this.camLook.lerp(look, kk);
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.camLook);
    this.camera.updateProjectionMatrix();
  }

  /** Baisse la résolution si les images mettent trop de temps à venir (PC sans grosse carte graphique), la remonte sinon. */
  adaptQuality() {
    const now = performance.now();
    // Ultra : on ne dégrade jamais l'image (sauf appareil à bout de souffle, < 15 images/s).
    if (this.gfx === 'ultra') {
      if (this._lastT) { this._acc = (this._acc || 0) + Math.min(100, now - this._lastT); this._n = (this._n || 0) + 1; }
      if (this._acc > 2000) { const avg = this._acc / this._n; if (avg > 66 && (this.quality ?? 1) > 0.7) { this.quality = 0.7; this.resize(); } this._acc = 0; this._n = 0; }
      this._lastT = now;
      return;
    }
    if (this._lastT) {
      const ft = Math.min(100, now - this._lastT);
      this._acc = (this._acc || 0) + ft; this._n = (this._n || 0) + 1;
      if (this._acc > 1000) {
        const avg = this._acc / this._n;
        const q = this.quality ?? 1;
        if (avg > 24 && q > 0.55) { this.quality = Math.max(0.55, q - 0.15); this._good = 0; this.resize(); }
        // Appareil vraiment lent : on allège la foule (têtes masquées : on garde la silhouette des tribunes).
        else if (avg > 30 && q <= 0.55 && this.renderer.shadowMap.enabled) { this.renderer.shadowMap.enabled = false; this.sun.castShadow = false; for (const e of this.players.values()) e.p3.shadow.visible = true; }
        else if (avg > 34 && q <= 0.55 && !this._liteCrowd) { this._liteCrowd = true; for (const hd of this.crowdHeads || []) hd.visible = false; }
        else if (avg < 18.5 && q < 1 && (this._good = (this._good || 0) + 1) >= 3) { this.quality = Math.min(1, q + 0.1); this._good = 0; this.resize(); }
        this._acc = 0; this._n = 0;
      }
    }
    this._lastT = now;
  }

  /** Les deux coachs dans leur zone technique (domicile : banc de gauche). */
  buildCoaches() {
    const looks = globalThis.__cdpCoaches || [];
    this.coaches = [0, 1].map((side) => {
      try {
        const c = new Coach3D(looks[side] || personLook(1000 + side, '', 48));
        c.benchX = side === 0 ? -9 : 9;
        c.root.position.set(c.benchX, 0, W / 2 + 2.3);
        this.scene.add(c.root);
        return c;
      } catch (e) { console.warn('coach 3D', e); return null; }
    });
  }

  /** Réactions des coachs aux événements (but, occasion, faute, carton, geste technique). */
  coachEvent(ev) {
    const C = this.coaches || [];
    const s = ev.side;
    if (s == null || s < 0) return;
    const mine = C[s], other = C[1 - s];
    if (ev.type === 'goal') { mine?.react('celebrate', 4.5); other?.react('despair', 3.5); }
    else if (ev.type === 'shot' && ev.outcome !== 'goal' && (ev.xg || 0) >= 0.18) { mine?.react('despair', 1.8); other?.react('applaud', 1.4); }
    else if (ev.type === 'foul') { mine?.react('protest', 1.8); other?.react('shout', 1.6); }
    else if (ev.type === 'yellow' || ev.type === 'red') mine?.react('protest', 2.6);
    else if (ev.type === 'skill') mine?.react('applaud', 1.6);
  }

  updateCoaches(dt) {
    if (!this.coaches) return;
    const b = this.ball?.position;
    if (!b) return;
    for (const c of this.coaches) {
      if (!c) continue;
      const x = c.benchX + Math.max(-4.5, Math.min(4.5, (b.x - c.benchX) * 0.12));
      c.update(Math.min(0.05, dt || 0.016), { x, z: W / 2 + 2.3 }, { x: b.x, z: b.z });
    }
  }

  render(dt) {
    const v = this.v;
    this.stepPrecip(Math.min(0.05, dt || 0.016));
    this.updateCoaches(dt);
    // La foule se lève et saute après un but (la texture des tribunes « vibre »).
    {
      const cheer = v.banner && v.banner.text === 'BUT !';
      const tense = !cheer && v.inHL; // temps fort : la foule se lève à moitié
      this._cheerT = (this._cheerT || 0) + (dt || 0.016);
      for (const c of this.crowdGroups || []) {
        const target = cheer ? Math.abs(Math.sin(this._cheerT * 8 + c.ph)) * 0.32 : tense ? 0.08 : c.ultras ? Math.abs(Math.sin(this._cheerT * 4 + c.ph)) * 0.05 : 0;
        c.g.position.y += (target - c.g.position.y) * 0.3;
      }
      for (const f of this.flags || []) f.pole.rotation.z = Math.sin(this._cheerT * (cheer ? 6 : 2.2) + f.ph) * (cheer ? 0.5 : 0.22);
    }
    if (!document.hidden) this.adaptQuality();
    this.syncPlayers();
    const flip = this.flip();
    const carrier = v.holder ?? (v.cur ? v.cur.carrier : null);
    for (const [id, e] of this.players) {
      const p = v.players.get(id);
      const [x, z] = this.toWorld(p.x, p.y, flip);
      e.p3.root.position.set(x, 0, z);
      const dB = Math.hypot((p.x - v.ball.x) * L, (p.y - v.ball.y) * W);
      const isCar = id === carrier;
      // Adversaire au contact (duel) : de quel côté est-il ?
      let jostle = 0;
      if (dB < 4 && !p.gk) for (const [id2, q] of v.players) {
        if (id2 === id || q.side === p.side) continue;
        const dx = (q.x - p.x) * L, dy = (q.y - p.y) * W;
        if (dx * dx + dy * dy < 1.69) { const rel = Math.atan2(dy, dx) - (p.face || 0); jostle = Math.sin(rel) > 0 ? 1 : -1; break; }
      }
      const ballAng = dB < 45 ? Math.atan2((v.ball.y - p.y) * W, (v.ball.x - p.x) * L) : null;
      e.p3.pose(p, flip, { dt: dt || 0.016, ballAng, jostle, ballNear: p.gk && dB < 30, restFar: dB > 28 && !isCar, shield: isCar && !v.inHands && (p.shieldK || 0) > 0, holding: isCar && v.inHands && p.gk });
      e.p3.smoothPose(dt || 0.016);
      // Gestes au sol : après le lissage, le point le plus bas du corps est reposé sur la pelouse.
      if (p.fall > 0 || p.slide > 0 || p.hurt > 0 || p.place > 0 || p.block > 0 || (p.celeb > 0 && p.celebType === 'knees' && (p.speed || 0) <= 2) || (p.dive > 0 && p.dive < 0.3)) e.p3.groundContact();
      const hl = id === carrier || id === v.selected;
      e.p3.ring.visible = id === v.selected;   // pas de rond sous le porteur : seulement le joueur touché
      e.p3.ring.material = this.mats[p.side].ring;
      e.label.visible = v.labelMode === 'name' || (v.labelMode !== 'none' && hl);
    }
    // Arbitre.
    if (v.referee) {
      const [rx, rz] = this.toWorld(v.referee.x, v.referee.y, flip);
      this.ref3d.root.position.set(rx, 0, rz);
      this.ref3d.pose(v.referee, flip);
    }
    let [bx, bz] = this.toWorld(v.ball.x, v.ball.y, flip);
    let hgt = v.ball.h * 26;
    // Ballon dans les mains : gardien (contre la poitrine) ou joueur qui fait la touche (au-dessus de la tête).
    const handP = carrier != null && v.inHands ? v.players.get(carrier) : [...v.players.values()].find((p) => p.hold > 0);
    if (handP) {
      const [hx, hz] = this.toWorld(handP.x, handP.y, flip);
      const fa = flip ? handP.face + Math.PI : handP.face;
      const fwd = handP.hold > 0 ? -0.12 : 0.32;
      bx = hx + Math.cos(fa) * fwd; bz = hz + Math.sin(fa) * fwd;
      hgt = (handP.hold > 0 ? 2.05 : 1.15) * K;
    }
    this.ball.position.set(bx, BALL_R + hgt, bz);
    // Rotation réelle : le ballon roule sur lui-même dans le sens de sa course.
    const P = v.phys;
    if (P) {
      const da = P.rot.a - (this._rotA ?? P.rot.a);
      this._rotA = P.rot.a;
      if (da) {
        const fx = flip ? -1 : 1;
        this._axis = this._axis || new THREE.Vector3();
        this._q = this._q || new THREE.Quaternion();
        this._axis.set(Math.sin(P.rot.b) * fx, 0, -Math.cos(P.rot.b) * fx).normalize();
        this._q.setFromAxisAngle(this._axis, -da);
        this.ball.quaternion.premultiply(this._q);
      }
      if (P.spin) { this._q2 = this._q2 || new THREE.Quaternion(); this._q2.setFromAxisAngle(new THREE.Vector3(0, 1, 0), P.spin * 0.016); this.ball.quaternion.premultiply(this._q2); }
    }
    // Ombre au sol, plus petite et plus pâle quand le ballon est haut.
    this.ballShadow.position.set(bx + hgt * 0.12, 0.025, bz + hgt * 0.08);
    this.ballShadow.scale.setScalar(1 + hgt * 0.12);
    this.ballShadow.material.opacity = Math.max(0.08, 0.38 - hgt * 0.05);
    this.updateCamera(dt);
    this.renderer.render(this.scene, this.camera);
  }

  /** Joueur sous le doigt : le plus proche à l'écran (tête projetée). */
  pick(clientX, clientY) {
    const rect = localRect(this.canvas);
    ({ x: clientX, y: clientY } = toLocal(clientX, clientY));
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
