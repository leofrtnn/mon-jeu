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
import { loadMH, buildMHPlayer, addMHPart, setMHSkin, clothMaterial, tickCloth } from './mhPlayer.js';
import { GAITS, GAIT_KEYS } from './mocapData.js';

const L = 105, W = 68;
// Échelle RÉELLE face aux cages (7,32 × 2,44 m) : joueurs à leur taille, ballon de 22 cm.
// Sur téléphone, très léger grossissement pour rester lisible sur un petit écran.
const COARSE = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
const K = COARSE ? 1.14 : 1.07; // (léger grossissement de lisibilité, comme dans les jeux de foot télévisés)
const GK_ARM_Z = 0.45;   // bras du gardien en attente : mains basses, devant lui
const BALL_R = 0.11 * (COARSE ? 1.45 : 1.15);
/** Rotation d'affichage vers un ballon touché derrière (étape 6b) : seulement au-delà de cette distance horizontale (m). */
const TURN_R = 0.35;
/**
 * Saut (étape 6c-A, étalonnage `calib6`) : au coup de tête (phase 0,5), le bassin est monté d'environ
 * 0,67 m, le front est à 1,95 m + cette montée et la poitrine 0,58 m plus bas. L'amplitude du saut affiché est réglée pour que le front
 * arrive à la hauteur réelle du ballon ; au-delà de ×1,35, le ballon est trop haut pour la tête.
 */
const JUMP_BASE = 1.95, JUMP_BOB = 0.67, JUMP_AMP_MAX = 1.35, JUMP_CHEST = 0.58;
/** Frappe : position latérale minimale du ballon du côté du pied de frappe, dans le repère du joueur (m). */
const SIDE_OK = 0.04;

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
  const PAD = 5, S = 20; // pixels par mètre
  const tex = canvasTex((L + PAD * 2) * S, (W + PAD * 2) * S, (g, cw, ch) => {
    // Pelouse hybride d'un grand stade : vert vif et jaune au soleil, tondue en bandes fines.
    g.fillStyle = '#5f8f33'; g.fillRect(0, 0, cw, ch);
    let seed0 = 11;
    const r0 = () => ((seed0 = (seed0 * 16807) % 2147483647) / 2147483647);
    // Grandes nuances (l'herbe n'est jamais d'un vert uniforme).
    for (let i = 0; i < 160; i++) {
      const x = r0() * cw, y = r0() * ch, rad = (6 + r0() * 16) * S;
      const rg = g.createRadialGradient(x, y, 0, x, y, rad);
      const c = r0() < 0.5 ? '128,150,58' : '52,92,36';
      rg.addColorStop(0, `rgba(${c},.16)`); rg.addColorStop(1, `rgba(${c},0)`);
      g.fillStyle = rg; g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
    }
    // Bandes de tonte (12 de chaque côté du rond central, comme sur les pelouses de Ligue 1).
    const n = 24;
    for (let i = 0; i < n; i++) { g.fillStyle = i % 2 ? 'rgba(255,250,200,.038)' : 'rgba(0,30,0,.038)'; g.fillRect(PAD * S + (i * L * S) / n, PAD * S, (L * S) / n + 1, W * S); }
    const X = (m) => (PAD + m) * S, Y = (m) => (PAD + m) * S;
    g.strokeStyle = 'rgba(250,252,246,.9)'; g.lineWidth = 0.12 * S; g.fillStyle = 'rgba(250,252,246,.9)';
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
    for (let i = 0; i < 30000; i++) {
      const x = rnd() * cw, y = rnd() * ch;
      g.strokeStyle = rnd() < 0.5 ? 'rgba(220,255,160,.05)' : 'rgba(0,20,0,.07)';
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + (rnd() - 0.5) * 3, y - 2 - rnd() * 3); g.stroke();
    }
    // Usure : surface de but (gardiens), point de penalty et rond central plus fatigués.
    const wear = (x, y, rad, a) => {
      const rg = g.createRadialGradient(X(x), Y(y), 0, X(x), Y(y), rad * S);
      rg.addColorStop(0, `rgba(150,130,70,${a})`); rg.addColorStop(1, 'rgba(150,130,70,0)');
      g.fillStyle = rg; g.fillRect(X(x) - rad * S, Y(y) - rad * S, rad * 2 * S, rad * 2 * S);
    };
    for (const gx of [3, L - 3]) { wear(gx, W / 2, 6, 0.2); wear(gx, W / 2 - 2.5, 2.5, 0.12); wear(gx, W / 2 + 2.5, 2.5, 0.12); }
    wear(11, W / 2, 1.6, 0.18); wear(L - 11, W / 2, 1.6, 0.18); wear(L / 2, W / 2, 3, 0.08);
  });
  tex.anisotropy = maxAniso;
  return { tex, w: L + PAD * 2, h: W + PAD * 2 };
}

/**
 * Grain de l'herbe vu de près (texture répétée tous les ~1,5 m) : multiplié à la texture du
 * terrain dans le shader, il évite l'aspect « moquette lisse » quand la caméra s'approche.
 */
function grassDetailTexture() {
  const t = canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = '#808080'; g.fillRect(0, 0, w, h);
    let seed = 3;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 9000; i++) {
      const x = rnd() * w, y = rnd() * h, v = 90 + rnd() * 80 | 0;
      g.strokeStyle = `rgb(${v},${v},${v})`; g.lineWidth = 1;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + (rnd() - 0.5) * 2, y - 2 - rnd() * 4); g.stroke();
    }
  });
  t.colorSpace = THREE.NoColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
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

/**
 * Panneaux LED (marques fictives) : fond sombre ou dégradé, pastille-logo et texte lumineux,
 * comme les bandeaux d'un stade moderne. Pas d'effet de tonalité : ils restent éclatants.
 */
function boardsTexture(names, clubCols = []) {
  const brands = ['COACH DE POCHE', ...SPONSORS.slice(0, 9), ...names, 'FAIR PLAY'];
  const styles = [
    { bg: ['#0b1e4d', '#123a8a'], fg: '#ffffff', ac: '#ffcc33' },
    { bg: ['#1a0b33', '#3b1670'], fg: '#ffffff', ac: '#ff4fa8' },
    { bg: ['#06232a', '#0b5160'], fg: '#e9fffb', ac: '#2ee6c5' },
    { bg: ['#2a0707', '#8a1414'], fg: '#ffffff', ac: '#ffd166' },
    { bg: ['#101418', '#20262e'], fg: '#ffffff', ac: '#9be15d' },
    { bg: ['#f5f7fa', '#dfe5ec'], fg: '#0b1e4d', ac: '#e63946' },
  ];
  if (clubCols[0]) styles.push({ bg: [clubCols[0], clubCols[0]], fg: clubCols[1] || '#fff', ac: clubCols[1] || '#fff' });
  const t = canvasTex(4096, 96, (g, w, h) => {
    const seg = 300;
    for (let x = 0, i = 0; x < w; x += seg, i++) {
      const st = styles[(i * 5) % styles.length], word = brands[(i * 7) % brands.length].toUpperCase().slice(0, 16);
      const gr = g.createLinearGradient(x, 0, x + seg, h); gr.addColorStop(0, st.bg[0]); gr.addColorStop(1, st.bg[1]);
      g.fillStyle = gr; g.fillRect(x, 0, seg, h);
      // Pastille-logo (forme géométrique simple) puis le nom.
      g.fillStyle = st.ac;
      const lx = x + 34, ly = h / 2;
      if (i % 3 === 0) { g.beginPath(); g.arc(lx, ly, 17, 0, Math.PI * 2); g.fill(); }
      else if (i % 3 === 1) { g.beginPath(); g.moveTo(lx - 18, ly + 15); g.lineTo(lx, ly - 18); g.lineTo(lx + 18, ly + 15); g.closePath(); g.fill(); }
      else g.fillRect(lx - 16, ly - 16, 32, 32);
      g.fillStyle = st.fg; g.font = `900 ${word.length > 12 ? 28 : 36}px system-ui, "Arial Black", sans-serif`; g.textAlign = 'left'; g.textBaseline = 'middle';
      g.fillText(word, x + 62, h / 2 + 2, seg - 74);
      // Lignes de pixels LED (très légères) et liseré.
      g.fillStyle = 'rgba(0,0,0,.10)'; for (let y = 0; y < h; y += 3) g.fillRect(x, y, seg, 1);
      g.fillStyle = 'rgba(255,255,255,.18)'; g.fillRect(x, 0, seg, 2);
    }
  });
  t.wrapS = THREE.RepeatWrapping;
  return t;
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
        // Bords fondus : le visage se fond dans le crâne (coque enroulée autour de la tête).
        g.globalCompositeOperation = 'destination-in';
        const grd = g.createRadialGradient(64, 62, 40, 64, 64, 64);
        grd.addColorStop(0, 'rgba(0,0,0,1)'); grd.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = grd; g.fillRect(0, 0, 128, 128);
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

/**
 * Proportions du squelette (mètres, joueur de 1,80 m) : celles du corps humain réaliste
 * (data/mh, MakeHuman) — hanche à 0,96 m, genou à 0,52 m, cheville à 7 cm, épaules à 1,44 m.
 * Le modèle simplifié (joueurs éloignés) et le modèle réaliste partagent ces os.
 */
const RIG = { hip: [-0.005, 0.959, 0.113], thigh: 0.44, shin: 0.451, sh: [0.021, 1.439, 0.194], upperArm: 0.262, kneel: 0.5 };
/**
 * Foulée issue de vraies captures de mouvement (base CMU) : marche, footing, course, mélangés
 * selon la vitesse ; au-delà de la course enregistrée, l'amplitude augmente (sprint).
 * ph : phase de la foulée (2π = deux pas). Retourne les angles (voir mocapData.js).
 */
const GI = Object.fromEntries(GAIT_KEYS.map((k, i) => [k, i]));
const GL = ['walk', 'jog', 'run'].map((n) => GAITS[n]).filter(Boolean);
const _gA = new Float32Array(GAIT_KEYS.length), _gB = new Float32Array(GAIT_KEYS.length);
function sampleCycle(c, u, out) {
  const n = c.length, x = u * n, i0 = Math.floor(x) % n, i1 = (i0 + 1) % n, f = x - Math.floor(x);
  for (let k = 0; k < out.length; k++) out[k] = c[i0][k] + (c[i1][k] - c[i0][k]) * f;
  return out;
}
function gaitAt(sp, ph) {
  const u = ((((ph - Math.PI / 2) / (2 * Math.PI)) % 1) + 1) % 1;
  if (!GL.length) return null;
  let a = GL[0], b = GL[0], t = 0;
  for (let i = 0; i < GL.length - 1; i++) if (sp > GL[i].v) { a = GL[i]; b = GL[i + 1]; t = Math.min(1, (sp - GL[i].v) / (GL[i + 1].v - GL[i].v)); }
  sampleCycle(a.cycle, u, _gA); sampleCycle(b.cycle, u, _gB);
  for (let k = 0; k < _gA.length; k++) _gA[k] += (_gB[k] - _gA[k]) * t;
  const top = GL[GL.length - 1].v;
  if (sp > top) {   // sprint : foulée plus ample, buste plus penché
    const amp = 1 + Math.min(0.4, (sp - top) * 0.11);
    for (const key of ['hzL', 'hzR', 'kzL', 'kzR', 'szL', 'szR', 'twist']) _gA[GI[key]] *= amp;
    _gA[GI.lean] += Math.min(0.12, (sp - top) * 0.03);
  }
  return _gA;
}
/** Frappe issue de capture (base CMU) à l'instant t (0 → 1, contact à 0,55) ; null si absente. */
const KICKS = GAITS.kicks || [];
const JUMPS = GAITS.jumps || [];
const _sA = new Float32Array(GAIT_KEYS.length);
/** Échantillon d'une séquence capturée (t de 0 à 1). */
function sampleSeq(c, t) {
  const x = Math.max(0, Math.min(1, t)) * (c.length - 1), i0 = Math.floor(x), i1 = Math.min(c.length - 1, i0 + 1), f = x - i0;
  for (let k = 0; k < _sA.length; k++) _sA[k] = c[i0][k] + (c[i1][k] - c[i0][k]) * f;
  return _sA;
}
const _kA = new Float32Array(GAIT_KEYS.length);
function kickAt(i, t) {
  const c = KICKS[i % Math.max(1, KICKS.length)];
  if (!c) return null;
  const x = Math.max(0, Math.min(1, t)) * (c.length - 1), i0 = Math.floor(x), i1 = Math.min(c.length - 1, i0 + 1), f = x - i0;
  for (let k = 0; k < _kA.length; k++) _kA[k] = c[i0][k] + (c[i1][k] - c[i0][k]) * f;
  return _kA;
}
const GEO = {};
function geo() {
  if (GEO.torso) return GEO;
  const cap = (r, l, rs = 10) => new THREE.CapsuleGeometry(r, l, 4, rs);
  // Profils anatomiques (tour de révolution) : rayon selon la hauteur.
  const lathe = (pts, seg = 16) => new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), seg);
  // Maillot : bas qui flotte un peu par-dessus le short, taille, poitrine, épaules arrondies.
  GEO.torsoA = lathe([[0.155, -0.07], [0.15, -0.03], [0.14, 0.04], [0.142, 0.1], [0.148, 0.18], [0.162, 0.3], [0.171, 0.4], [0.176, 0.46], [0.17, 0.52], [0.148, 0.57], [0.108, 0.605], [0.05, 0.625], [0.001, 0.63]], 24);
  // Coordonnées de texture selon la HAUTEUR (le motif et le sponsor ne sont pas déformés).
  { const pos = GEO.torsoA.attributes.position, uv = GEO.torsoA.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setY(i, (pos.getY(i) + 0.07) / 0.702); }
  // Jambe de short : tube évasé qui suit la cuisse (attaché à la hanche).
  // (tubes ouverts : points du bas vers le haut, pour que l'extérieur soit la face visible)
  GEO.shortLegA = lathe([[0.113, -0.222], [0.118, -0.215], [0.116, -0.17], [0.112, -0.08], [0.108, 0.0], [0.104, 0.05], [0.001, 0.06]], 16);
  // Manche courte : large à l'épaule, ourlet à mi-bras.
  GEO.sleeveA = lathe([[0.058, -0.165], [0.061, -0.16], [0.062, -0.12], [0.065, -0.05], [0.064, -0.01], [0.05, 0.022], [0.025, 0.032], [0.001, 0.034]], 14);
  // Visage : coque qui épouse l'avant du crâne (la photo ou le visage dessiné s'y enroule).
  GEO.faceShell = new THREE.SphereGeometry(0.1215, 28, 18, Math.PI - 1.05, 2.1, 0.5, 1.62);
  // Coiffures : arrière long, chignon, crête, tresses.
  GEO.hairBack = lathe([[0.001, -0.175], [0.09, -0.17], [0.112, -0.13], [0.118, -0.06], [0.11, 0.0]], 14);
  GEO.bun = new THREE.SphereGeometry(0.05, 10, 8);
  GEO.mohawk = new THREE.BoxGeometry(0.2, 0.05, 0.035);
  GEO.dread = new THREE.CylinderGeometry(0.012, 0.009, 0.16, 5);
  // Cuisse : elle se prolonge dans le genou (pas de jointure visible entre cuisse et tibia).
  GEO.thighA = lathe([[0.001, 0], [0.084, -0.01], [0.09, -0.08], [0.083, -0.2], [0.07, -0.33], [0.061, -0.41], [0.057, -0.45], [0.042, -0.48], [0.001, -0.485]]);
  GEO.shinA = lathe([[0.001, 0.02], [0.056, 0.0], [0.064, -0.09], [0.066, -0.15], [0.052, -0.27], [0.038, -0.37], [0.036, -0.41], [0.001, -0.42]]);
  GEO.shortsA = lathe([[0.001, 0.02], [0.112, 0.02], [0.118, -0.08], [0.122, -0.19], [0.001, -0.19]]);
  GEO.upperA = lathe([[0.001, 0.02], [0.054, 0.0], [0.056, -0.07], [0.047, -0.2], [0.042, -0.27], [0.036, -0.3], [0.001, -0.31]], 12);
  // Avant-bras : il commence dans le prolongement du bras (coude sans « boule »).
  GEO.foreA = lathe([[0.001, 0.035], [0.03, 0.03], [0.04, -0.01], [0.045, -0.06], [0.034, -0.2], [0.028, -0.25], [0.001, -0.26]], 12);
  // Genou (peau) : de la cuisse jusqu'au haut de la chaussette.
  GEO.kneeA = lathe([[0.001, 0.04], [0.05, 0.035], [0.06, 0.0], [0.058, -0.05], [0.05, -0.075], [0.001, -0.08]], 14);
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
  GEO.head = new THREE.SphereGeometry(0.118, 24, 18);
  // Crâne → mâchoire : sous les pommettes la tête s'affine vers le menton, la nuque rentre
  // (une vraie tête, pas une boule). Même déformation pour la coque du visage.
  const jaw = (g, r) => {
    const pa = g.attributes.position;
    for (let i = 0; i < pa.count; i++) {
      const x = pa.getX(i), y = pa.getY(i), z = pa.getZ(i);
      const t = Math.max(0, Math.min(1, (-y / r - 0.05) / 0.95));
      pa.setZ(i, z * (1 - 0.3 * t) * 0.95);
      pa.setX(i, x > 0 ? x * (1 - 0.06 * t) : x * (1 - 0.5 * t));
      if (y < -0.5 * r && x > 0) pa.setY(i, y - 0.012 * t);   // menton marqué
    }
    g.computeVertexNormals();
  };
  jaw(GEO.head, 0.118);
  GEO.jaw = jaw;
  GEO.hair = new THREE.SphereGeometry(0.1235, 22, 14, 0, Math.PI * 2, 0, Math.PI * 0.5);
  // Ligne des cheveux : le bord avant remonte en arc sur le front, les côtés descendent
  // vers les tempes (au lieu d'une frange coupée au bol).
  { const pa = GEO.hair.attributes.position; for (let i = 0; i < pa.count; i++) { const x = pa.getX(i), y = pa.getY(i), f = Math.max(0, x / 0.1235); if (y < 0.06) pa.setY(i, y + f * f * (0.06 - y) * 0.75); } GEO.hair.computeVertexNormals(); }
  GEO.ear = new THREE.SphereGeometry(0.03, 8, 6);
  GEO.face = new THREE.CircleGeometry(0.088, 24);
  GEO.neck = new THREE.CylinderGeometry(0.057, 0.068, 0.13, 12);
  GEO.jaw(GEO.faceShell, 0.1215);
  GEO.back = new THREE.PlaneGeometry(0.24, 0.28);
  GEO.front = new THREE.PlaneGeometry(0.1, 0.1);
  GEO.shadow = new THREE.CircleGeometry(0.55, 20);
  GEO.footShadow = new THREE.CircleGeometry(0.16, 14);
  GEO.ring = new THREE.RingGeometry(0.62, 0.78, 28);
  return GEO;
}

/**
 * Ombre de contact : tache douce (dégradé radial) sous le corps et sous chaque pied. Elle
 * « pose » le joueur sur la pelouse, en plus de l'ombre portée du soleil (occlusion au sol).
 */
let CONTACT_TEX = null;
function contactShadowMat(opacity) {
  if (!CONTACT_TEX) {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const g = c.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(0,0,0,1)'); gr.addColorStop(0.45, 'rgba(0,0,0,0.6)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    CONTACT_TEX = new THREE.CanvasTexture(c);
  }
  return new THREE.MeshBasicMaterial({ color: '#000', map: CONTACT_TEX, transparent: true, opacity, depthWrite: false });
}
const _footV = new THREE.Vector3();

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
    // Relevé : il se tourne sur un genou (main au sol), puis pousse sur ses jambes.
    { t: 0.68, bz: 0.25, by: -0.42, hL: 0.25, hR: 1.45, kL: -2.4, kR: -1.7, aZ: -0.5, aX: 0.45, e: 0.3, uz: -0.35 },
    { t: 0.8, bz: -0.12, by: -0.3, hL: 0.35, hR: 1.35, kL: -2.2, kR: -1.5, aZ: 0.2, aX: 0.3, e: 0.6, uz: -0.3 },
    { t: 0.9, bz: -0.18, by: -0.1, hL: 0.7, hR: 0.6, kL: -1.2, kR: -1.0, aZ: 0.35, aX: 0.15, e: 0.7, uz: -0.2 },
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
    this.photo = photo;
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
    for (const z of [-0.19, 0.19]) { const dl = limb(this.body, G.delt, mats.sleeve || mats.shirt, 1.43); dl.position.z = z; dl.scale.set(0.9, 0.8, 0.92); }
    const collar = limb(this.body, G.collar, mats.trim || mats.shorts, 1.535); collar.rotation.x = Math.PI / 2; collar.scale.set(1.15, 1.25, 1);
    const shorts = limb(this.body, G.shortsA, mats.shorts, 0.97); shorts.scale.set(0.74, 1, 1.22);
    limb(this.body, G.neck, skinM, 1.56);
    const head = limb(this.body, G.head, skinM, 1.7);
    head.scale.set(0.96, 1.1, 0.9);
    const hairMesh = this.hairMesh = limb(this.body, G.hair, hairM, 1.72);
    // Calotte inclinée vers l'arrière : le front dégagé, la nuque couverte.
    // (ajustée au crâne : même proportions que la tête, pas un casque posé dessus)
    hairMesh.position.set(-0.012, 1.708, 0); hairMesh.scale.set(0.97, 1.1, 0.92); hairMesh.rotation.z = 0.26;
    for (const z of [-0.105, 0.105]) { const e = limb(this.body, G.ear, skinM, 1.69); e.position.z = z; e.scale.set(0.6, 1, 0.5); }
    // Visage : photo du joueur (Wikimedia) si disponible, sinon visage dessiné (yeux, nez, bouche…).
    // Le visage s'enroule autour de l'avant du crâne (coque ajustée à la tête) : relief des
    // joues, du front et du menton, au lieu d'un disque plaqué.
    const addFace = (tex) => {
      const face = new THREE.Mesh(G.faceShell, new THREE.MeshStandardMaterial({ map: tex, transparent: true, roughness: 0.68, polygonOffset: true, polygonOffsetFactor: -2, depthWrite: false }));
      face.renderOrder = 2;
      head.add(face);
      this.faceMesh = face;
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
    this.numBack = back;
    const front = new THREE.Mesh(G.front, new THREE.MeshLambertMaterial({ map: numTex, transparent: true }));
    front.position.set(0.142, 1.36, 0.07); front.rotation.y = Math.PI / 2;
    this.body.add(front);
    this.numFront = front;
    // Jambes : hanche → (short, cuisse) → genou → (chaussette) → crampon.
    this.legs = [-1, 1].map((sgn) => {
      const hip = new THREE.Group(); hip.position.set(RIG.hip[0], RIG.hip[1], sgn * RIG.hip[2]); this.body.add(hip);
      limb(hip, G.thighA, skinM, 0).scale.set(1.1, 1, 1.05);
      // Jambe du short : elle suit la cuisse (un vrai short, pas une culotte collée au bassin).
      const sl = limb(hip, G.shortLegA, mats.shorts, 0); sl.scale.set(1, 1, 1.02);
      const knee = new THREE.Group(); knee.position.y = -RIG.thigh; hip.add(knee);
      limb(knee, G.kneeA, skinM, 0);                                 // genou nu, fondu dans la cuisse
      const sock = limb(knee, G.shinA, mats.socks, -0.07); sock.scale.set(1.1, 0.84, 1.1);   // chaussette sous le genou (protège-tibia)
      limb(knee, G.sockBand, mats.trim || mats.shorts, -0.1).scale.set(1.1, 1, 1.1);
      const ankle = new THREE.Group(); ankle.position.y = -RIG.shin; knee.add(ankle);
      const boot = limb(ankle, G.boot, mats.boot, -0.02);
      boot.rotation.z = Math.PI / 2; boot.position.x = 0.055; boot.scale.set(1, 1, 0.92);
      const sole = limb(ankle, G.sole, mats.sole || mats.boot, -0.06); sole.position.x = 0.055;
      return { hip, knee, ankle };
    });
    // Bras : épaule → (manche, bras) → coude → avant-bras → main.
    this.arms = [-1, 1].map((sgn) => {
      const sh = new THREE.Group(); sh.position.set(RIG.sh[0], RIG.sh[1], sgn * RIG.sh[2]); this.body.add(sh);
      limb(sh, G.sleeveA, mats.sleeve || mats.shirt, 0);
      const cuff = limb(sh, G.cuff, mats.trim || mats.shorts, -0.158); cuff.rotation.x = Math.PI / 2; cuff.scale.set(1.13, 1.13, 1);
      limb(sh, G.upperA, skinM, -0.01);
      const el = new THREE.Group(); el.position.y = -RIG.upperArm; sh.add(el);
      limb(el, G.foreA, skinM, 0);
      // Gardien : maillot à manches longues.
      if (opts.gk) limb(el, G.foreA, mats.sleeve || mats.shirt, 0.01).scale.set(1.22, 0.92, 1.22);
      const hand = limb(el, G.hand, skinM, -0.29);
      hand.scale.set(0.7, 1.05, 0.5);
      return { sh, el, sgn, hand };
    });
    this.shadow = new THREE.Mesh(G.shadow, mats.shadow);
    this.shadow.rotation.x = -Math.PI / 2; this.shadow.position.y = 0.02;
    this.root.add(this.shadow);
    // Ombres de contact sous les pieds : elles suivent les chevilles et s'effacent quand le pied se lève.
    this.footShadows = [0, 1].map(() => {
      const f = new THREE.Mesh(G.footShadow, mats.shadow);
      f.rotation.x = -Math.PI / 2; f.position.y = 0.021; f.scale.set(1.6, 1, 1); f.renderOrder = 1;
      this.root.add(f);
      return f;
    });
    this.ring = new THREE.Mesh(G.ring, mats.ring);
    this.ring.rotation.x = -Math.PI / 2; this.ring.position.y = 0.03; this.ring.visible = false;
    this.root.add(this.ring);
    // Tête articulée (crâne, cheveux, oreilles, visage) : elle suit le ballon des yeux.
    this.headPivot = new THREE.Group(); this.headPivot.position.y = 1.6; this.body.add(this.headPivot);
    for (const c of this.body.children.slice()) if (c !== this.headPivot && c.position.y >= 1.64 && c.position.y < 2.2) { this.body.remove(c); c.position.y -= 1.6; this.headPivot.add(c); }
    this.headPivot.position.y = 1.583; // cou plus court : la tête repose sur les trapèzes, pas sur une tige
    // Haut du corps (buste, bras, tête) : il pivote en sens inverse des hanches pendant la course.
    this.upper = new THREE.Group(); this.upper.position.y = 0.95; this.body.add(this.upper);
    for (const c of this.body.children.slice()) if (c !== this.upper && c.position.y >= 1.0) { this.body.remove(c); c.position.y -= 0.95; this.upper.add(c); }
    // Membres d'un seul tenant (peau déformée par le squelette) à la place des segments rigides.
    try { this.buildSkin(skinM, mats); } catch (e) { console.warn('corps 3D', e); }
    // Petites pièces (col, poignets, bandes des chaussettes, semelles, oreilles, numéro avant) :
    // invisibles de loin ; on ne les dessine pas (et elles ne projettent pas d'ombre).
    const small = new Set([G.collar, G.cuff, G.sockBand, G.sole, G.ear, G.front, G.kneeA]);
    this.lodMeshes = [];
    this.root.traverse((o) => {
      if (!o.isMesh || o === this.shadow || o === this.ring) return;
      if (this.footShadows.includes(o)) { this.lodMeshes.push(o); return; }
      if (small.has(o.geometry)) { this.lodMeshes.push(o); o.castShadow = false; } else o.castShadow = true;
    });
    this.detail = true;
    this._sm = null; // poses lissées (pas d'à-coups entre deux gestes)
  }

  /** Lissage des articulations : la pose calculée devient une cible vers laquelle on glisse. */
  /**
   * Cinématique inverse de la jambe (étape 6b) : amène le bout du pied `leg` (0 gauche, 1 droite) sur
   * `target` (position monde) avec le poids `w` (0-1), en ajustant flexion / écartement de la hanche
   * et flexion du genou (moindres carrés amortis sur le vrai squelette), à partir de la pose animée.
   * Utilisé seulement autour d'un contact physique (le geste touche le ballon là où il est).
   */
  ikLeg(leg, target, w) {
    if (!(w > 0)) return;
    const Lg = this.legs[leg], V = (this._ikV ||= new THREE.Vector3()), toe = () => { this.root.updateMatrixWorld(true); return Lg.ankle.localToWorld(V.set(0.1, -0.05, 0)).clone(); };
    const q0 = [Lg.hip.rotation.x, Lg.hip.rotation.z, Lg.knee.rotation.z];
    const q = q0.slice(), set = (v) => { Lg.hip.rotation.x = v[0]; Lg.hip.rotation.z = v[1]; Lg.knee.rotation.z = v[2]; };
    const lim = [[-0.9, 0.9], [-1.6, 1.9], [-2.4, 0]];
    for (let it = 0; it < 8; it++) {
      set(q); const p0 = toe(), e = [target.x - p0.x, target.y - p0.y, target.z - p0.z];
      if (Math.hypot(...e) < 0.005) break;
      const J = [];
      for (let k = 0; k < 3; k++) { const qq = q.slice(); qq[k] += 0.01; set(qq); const p1 = toe(); J.push([(p1.x - p0.x) / 0.01, (p1.y - p0.y) / 0.01, (p1.z - p0.z) / 0.01]); }
      // dq = Jᵀ (J Jᵀ + λ²I)⁻¹ e (moindres carrés amortis), en 3×3.
      const A = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
      for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) { let sum = 0; for (let k = 0; k < 3; k++) sum += J[k][r] * J[k][c]; A[r][c] = sum + (r === c ? 0.0025 : 0); }
      const det = A[0][0] * (A[1][1] * A[2][2] - A[1][2] * A[2][1]) - A[0][1] * (A[1][0] * A[2][2] - A[1][2] * A[2][0]) + A[0][2] * (A[1][0] * A[2][1] - A[1][1] * A[2][0]);
      if (!(Math.abs(det) > 1e-12)) break;
      const inv = [[(A[1][1] * A[2][2] - A[1][2] * A[2][1]) / det, (A[0][2] * A[2][1] - A[0][1] * A[2][2]) / det, (A[0][1] * A[1][2] - A[0][2] * A[1][1]) / det],
        [(A[1][2] * A[2][0] - A[1][0] * A[2][2]) / det, (A[0][0] * A[2][2] - A[0][2] * A[2][0]) / det, (A[0][2] * A[1][0] - A[0][0] * A[1][2]) / det],
        [(A[1][0] * A[2][1] - A[1][1] * A[2][0]) / det, (A[0][1] * A[2][0] - A[0][0] * A[2][1]) / det, (A[0][0] * A[1][1] - A[0][1] * A[1][0]) / det]];
      const y = [0, 1, 2].map((r) => inv[r][0] * e[0] + inv[r][1] * e[1] + inv[r][2] * e[2]);
      for (let k = 0; k < 3; k++) { let d = J[k][0] * y[0] + J[k][1] * y[1] + J[k][2] * y[2]; d = Math.max(-0.35, Math.min(0.35, d)); q[k] = Math.max(lim[k][0], Math.min(lim[k][1], q[k] + d)); }
    }
    set(q0.map((a, k) => a + (q[k] - a) * w));
    this.root.updateMatrixWorld(true);
  }

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
    const G = geo(), M = this.hairM, hp = this.headPivot;
    const add = (g, x, y, z) => { const o = new THREE.Mesh(g, M); o.position.set(x, y, z); o.castShadow = true; hp.add(o); return o; };
    if (style === 'bald') { h.visible = false; return; }
    if (style === 'buzz' || style === 'receding') { h.scale.set(0.95, 0.99, 0.93); if (style === 'receding') h.rotation.z = 0.42; }
    else if (style === 'afro') { h.scale.set(1.2, 1.3, 1.18); h.rotation.z = 0.1; }
    else if (style === 'curly') { h.scale.set(1.1, 1.2, 1.08); }
    else if (style === 'long') { h.scale.set(1.04, 1.12, 1.0); add(G.hairBack, -0.04, 0.1, 0).scale.set(0.95, 1, 1.05); }      // cheveux aux épaules
    else if (style === 'bun') { h.scale.set(1.0, 1.08, 0.96); add(G.bun, -0.08, 0.2, 0); }                                    // chignon
    else if (style === 'dreads') { h.scale.set(1.06, 1.14, 1.02); for (let i = 0; i < 9; i++) { const a = -1.2 + i * 0.3; add(G.dread, -0.05 - Math.abs(Math.sin(a)) * 0.02, 0.0, Math.sin(a) * 0.11).rotation.x = Math.sin(a) * 0.25; } }
    else if (style === 'mohawk') { h.scale.set(0.93, 0.98, 0.88); add(G.mohawk, -0.01, 0.235, 0); }                         // crête
    else if (style === 'quiff') { h.scale.set(0.99, 1.2, 0.93); h.rotation.z = 0.28; }                                        // houppe
  }
  /**
   * CORPS « SKINNÉ » : chaque jambe et chaque bras est un tube continu dont les sommets sont
   * rattachés (avec des poids qui se fondent aux articulations) aux os existants — hanche,
   * genou, cheville ; épaule, coude. Les animations restent les mêmes (elles tournent les os),
   * mais le genou et le coude plient sans jointure ni « boule » : une vraie peau.
   * Matériaux par zone : cuisse, genou, chaussette (jambe) ; bras, avant-bras (bras).
   */
  buildSkin(skinM, mats) {
    const body = this.body;
    this.root.updateMatrixWorld(true);
    const at = (o) => body.worldToLocal(o.getWorldPosition(new THREE.Vector3()));
    const SEG = 18;
    // Tube le long d'une chaîne d'os (verticale au repos) : rings = [{ y, r, w: [w0, w1, w2], z }] du haut vers le bas.
    const tube = (cx, cz, rings, flatX = 1, flatZ = 1.04) => {
      const pos = [], nor = [], idx = [], si = [], sw = [];
      rings.forEach((rg, j) => {
        for (let i = 0; i <= SEG; i++) {
          const a = (i / SEG) * Math.PI * 2, c = Math.cos(a), sn = Math.sin(a);
          pos.push(cx + c * rg.r * flatX + (rg.dx || 0), rg.y, cz + sn * rg.r * flatZ);
          nor.push(c, 0, sn);
          si.push(0, 1, 2, 0); sw.push(rg.w[0], rg.w[1], rg.w[2] || 0, 0);
        }
      });
      for (let j = 0; j < rings.length - 1; j++) for (let i = 0; i < SEG; i++) {
        const a = j * (SEG + 1) + i, b = a + SEG + 1;
        idx.push(a, a + 1, b, a + 1, b + 1, b);
      }
      // Bouts fermés (hanche, cheville) : éventail vers le centre.
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
      g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
      g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
      g.setIndex(idx);
      return g;
    };
    const blend = (y, yJ, half) => Math.max(0, Math.min(1, (yJ + half - y) / (2 * half))); // 0 au-dessus de l'articulation → 1 en dessous
    const skinned = (geo, matsArr, bones) => {
      const m = new THREE.SkinnedMesh(geo, matsArr);
      body.add(m);
      m.updateMatrixWorld(true);
      m.bind(new THREE.Skeleton(bones), m.matrixWorld);
      m.frustumCulled = false; m.castShadow = true;
      return m;
    };
    // ---- Jambes : hanche → genou → cheville.
    this.legSkins = this.legs.map((l) => {
      const H = at(l.hip), Kn = at(l.knee), A = at(l.ankle);
      const prof = [ // [hauteur relative depuis la hanche (0) vers la cheville (1), rayon]
        [0.0, 0.088], [0.12, 0.09], [0.3, 0.084], [0.45, 0.072], [0.5, 0.064], [0.52, 0.061], [0.55, 0.06],
        [0.62, 0.062], [0.7, 0.066], [0.78, 0.058], [0.88, 0.044], [0.96, 0.037], [1.02, 0.036]];
      const len = H.y - A.y;
      const rings = prof.map(([t, r]) => {
        const y = H.y + 0.05 - t * (len + 0.05);
        const wk = blend(y, Kn.y, 0.07), wa = blend(y, A.y + 0.02, 0.04);
        return { y, r, w: [1 - wk, wk * (1 - wa), wk * wa] };
      });
      const g = tube(H.x, H.z, rings, 1.0, 1.05);
      // Zones de matière : cuisse (peau), genou (peau), chaussette (sous le genou).
      const kneeRing = rings.findIndex((rg) => rg.y < Kn.y - 0.075);
      const n = SEG * 6;
      // (Cuisse et genou : une seule matière, donc un seul appel de dessin.)
      g.addGroup(0, n * kneeRing, 0); g.addGroup(n * kneeRing, n * (rings.length - 1 - kneeRing), 1);
      g.computeVertexNormals();
      const mesh = skinned(g, [skinM, mats.socks], [l.hip, l.knee, l.ankle]);
      // Les anciens segments rigides (cuisse, genou, tibia) ne servent plus.
      for (const o of [...l.hip.children, ...l.knee.children]) if (o.isMesh && [GEO.thighA, GEO.kneeA, GEO.shinA].includes(o.geometry)) o.parent.remove(o);
      l.skin = mesh;
      return mesh;
    });
    // ---- Bras : épaule → coude → poignet.
    this.armSkins = this.arms.map((a) => {
      const S = at(a.sh), E = at(a.el);
      const len = S.y - E.y;
      const prof = [[-0.02, 0.05], [0.15, 0.055], [0.45, 0.047], [0.75, 0.041], [0.92, 0.037], [1.0, 0.036], [1.08, 0.04],
        [1.25, 0.044], [1.5, 0.038], [1.75, 0.03], [1.9, 0.027]];
      const rings = prof.map(([t, r]) => {
        const y = S.y - t * len;
        const we = blend(y, E.y, 0.05);
        return { y, r, w: [1 - we, we, 0] };
      });
      const g = tube(S.x, S.z, rings, 0.95, 1.0);
      g.computeVertexNormals();
      // Manche longue rigide (gardien) : remplacée par le tube lui-même, habillé de la manche.
      const longSleeve = a.el.children.find((o) => o.isMesh && o.geometry === GEO.foreA && o.material !== skinM);
      const mesh = skinned(g, longSleeve ? longSleeve.material : skinM, [a.sh, a.el, a.el]);
      for (const o of [...a.sh.children, ...a.el.children]) if (o.isMesh && (o.material === skinM || o === longSleeve) && [GEO.upperA, GEO.foreA, GEO.elbow].includes(o.geometry)) o.parent.remove(o);
      a.skin = mesh;
      return mesh;
    });
  }
  /** Habillage des membres (pantalon et manches longues du coach, par exemple). */
  setLimbMaterials({ thigh, knee, sock, upper, fore } = {}) {
    // Une matière par zone fusionnée : jambe (cuisse + genou), chaussette, bras entier.
    for (const m of this.legSkins || []) { const ms = m.material; if (thigh || knee) ms[0] = thigh || knee; if (sock) ms[1] = sock; }
    for (const m of this.armSkins || []) if (upper || fore) m.material = upper || fore;
  }
  /** Niveau de détail : plein (proche de la caméra) ou allégé (loin). */
  setDetail(on) {
    if (on === this.detail) return;
    this.detail = on;
    if (this.mhGroup) { this.showMH(on); return; }
    for (const o of this.lodMeshes) o.visible = on;
    if (this.faceMesh) this.faceMesh.visible = on;
  }
  /**
   * Corps réaliste (data/mh) : de près il remplace le modèle simplifié (mêmes os, mêmes
   * animations) ; de loin on garde le modèle simplifié, bien moins coûteux.
   */
  attachMH(mh, opts) {
    if (this.mhGroup || !mh) return;
    try { this.mhGroup = buildMHPlayer(mh, this, opts); } catch (e) { console.warn('joueur réaliste', e); return; }
    // Numéro et nom dans le dos : posés sur le maillot réaliste.
    const mk = mh.meta.marks, up = this.upper;
    for (const [src, x, y, z, ry] of opts.printed ? [] : [[this.numBack, mk.backX, mk.backY, 0, -Math.PI / 2]]) {
      if (!src) continue;
      const pl = new THREE.Mesh(src.geometry, src.material);
      pl.position.set(x, y - up.position.y, z); pl.rotation.y = ry;
      up.add(pl); pl.userData.mh = true; this.mhGroup.userData.extra = (this.mhGroup.userData.extra || []).concat(pl);
    }
    // Photo du joueur : posée sur son visage réaliste (décalque aux bords fondus), teint accordé.
    if (this.photo) loadFace(this.photo).then((f) => {
      if (!f || !this.mhGroup) return;
      setMHSkin(mh, this, f.skin);
      const d = addMHPart(mh, this, 'faceDecal', new THREE.MeshStandardMaterial({ map: f.tex, transparent: true, depthWrite: false, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -2 }));
      if (d) d.visible = this.mhGroup.visible;
    }).catch((e) => console.warn('photo 3D', e));
    this.detail = !this.detail; this.setDetail(!this.detail);
  }
  /**
   * Surface du corps (étape 6c-A) : échantillon de sommets du modèle VISIBLE (réaliste de près, simplifié de
   * loin) attachés à la tête, au buste et aux genoux, exprimés dans le repère de leur os. Le contact visuel se
   * mesure et se vise sur ce point de surface le plus proche du ballon, pas sur un point fixe intérieur.
   */
  surfBones() { return { head: this.headPivot, headFront: this.headPivot, chest: this.upper, knee0: this.legs[0].knee, knee1: this.legs[1].knee, hand0: this.arms[0].el, hand1: this.arms[1].el }; }
  surfSamples(which) {
    const key = this.mhGroup && this.mhGroup.visible ? 'mh' : 'simple';
    const S = (this._surf ||= {});
    if (!S[key]) { try { S[key] = key === 'mh' ? this._sampleMH() : this._sampleSimple(); } catch (e) { S[key] = {}; } }
    if (which === 'headFront' && !S[key].headFront && S[key].head?.length) {
      // Front et visage (moitié avant de la tête, au-dessus du menton) : la partie qui frappe un ballon venant de devant.
      const h = S[key].head, c = new THREE.Vector3(); for (const q of h) c.add(q); c.multiplyScalar(1 / h.length);
      const f = h.filter((q) => q.x - c.x > 0.03 && q.y - c.y > -0.04); S[key].headFront = f.length > 10 ? f : h;
    }
    if ((which === 'hand0' || which === 'hand1') && S[key][which] && !S[key][which]._hand) {
      // (6c-B) Main (gant) : extrémité de l'avant-bras, au-delà du poignet (9 cm depuis le bout des doigts).
      const a = S[key][which], yMin = Math.min(...a.map((q) => q.y)), f = a.filter((q) => q.y < yMin + 0.09);
      S[key][which] = f.length > 8 ? f : a; S[key][which]._hand = true;
    }
    return S[key][which] || null;
  }
  _sampleSimple() {
    const B = this.surfBones(), out = {}, rig = new Set([this.body, this.upper, this.headPivot, ...this.legs.flatMap((l) => [l.hip, l.knee, l.ankle]), ...this.arms.flatMap((a) => [a.sh, a.el])]);
    this.root.updateMatrixWorld(true);
    for (const [k, bone] of Object.entries(B)) {
      const inv = new THREE.Matrix4().copy(bone.matrixWorld).invert(), pts = [], V = new THREE.Vector3();
      const walk = (o) => { for (const c of o.children) { if (rig.has(c) || c.userData?.mh) continue; if (c.isMesh && !c.isSkinnedMesh && c.geometry?.attributes?.position) { const pos = c.geometry.attributes.position, M = new THREE.Matrix4().multiplyMatrices(inv, c.matrixWorld), st = Math.max(1, Math.floor(pos.count / 300)); for (let i = 0; i < pos.count; i += st) pts.push(V.fromBufferAttribute(pos, i).applyMatrix4(M).clone()); } walk(c); } };
      walk(bone); out[k] = pts;
    }
    return out;
  }
  _sampleMH() {
    const B = this.surfBones(), idxOf = { head: 2, chest: 1, knee0: 4, knee1: 7, hand0: 10, hand1: 12 }, raw = { head: [], chest: [], knee0: [], knee1: [], hand0: [], hand1: [] }, V = new THREE.Vector3();
    this.mhGroup.traverse((m) => {
      if (!m.isSkinnedMesh || !/^(body|shirt|hair|beard|gloves)/.test(m.userData.mhPart || '')) return;
      const g = m.geometry, pos = g.attributes.position, si = g.attributes.skinIndex, sw = g.attributes.skinWeight; if (!pos || !si || !sw) return;
      for (let i = 0; i < pos.count; i++) {
        let bi = -1, bw = 0; for (let c = 0; c < 4; c++) { const w = sw.getComponent(i, c); if (w > bw) { bw = w; bi = si.getComponent(i, c); } }
        if (bw < 0.6) continue;
        const k = Object.keys(idxOf).find((x) => idxOf[x] === bi); if (!k) continue;
        raw[k].push(V.fromBufferAttribute(pos, i).applyMatrix4(m.bindMatrix).applyMatrix4(m.skeleton.boneInverses[bi]).clone());
      }
    });
    const out = {}; for (const k of Object.keys(raw)) { const a = raw[k], st = Math.max(1, Math.floor(a.length / 400)); out[k] = a.filter((_, i) => i % st === 0); }
    return out;
  }
  /** Centre (repère monde) de l'échantillon de surface de la partie `which` ; null sans échantillon. */
  surfCenter(which) {
    const pts = this.surfSamples(which); if (!pts || !pts.length) return null;
    if (!pts._c) { const c = new THREE.Vector3(); for (const q of pts) c.add(q); pts._c = c.multiplyScalar(1 / pts.length); }
    return pts._c.clone().applyMatrix4(this.surfBones()[which].matrixWorld);
  }
  /** Point de surface (repère monde) de la partie `which` le plus proche de C ; null sans échantillon. */
  surfNearest(which, C) {
    const pts = this.surfSamples(which); if (!pts || !pts.length) return null;
    const M = this.surfBones()[which].matrixWorld, V = (this._snV ||= new THREE.Vector3());
    let best = null, bd = Infinity;
    for (const q of pts) { V.copy(q).applyMatrix4(M); const d = V.distanceToSquared(C); if (d < bd) { bd = d; best = (best || new THREE.Vector3()).copy(V); } }
    return best;
  }
  showMH(on) {
    const mhSet = new Set();
    this.mhGroup.traverse((o) => mhSet.add(o));
    for (const o of this.mhGroup.userData.extra || []) { mhSet.add(o); o.visible = on; }
    this.mhGroup.visible = on;
    const lod = new Set(this.lodMeshes);
    this.root.traverse((o) => {
      if (!o.isMesh || mhSet.has(o) || o === this.shadow || o === this.ring || this.footShadows?.includes(o) || o.userData.keep) return;
      o.visible = !on && !lod.has(o) && o !== this.faceMesh;
    });
    for (const f of this.footShadows || []) f.visible = on;
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
    // Sens réel du déplacement par rapport au corps : vers l'avant, à reculons, ou en pas chassés.
    // (Avant : la foulée « avant » jouait même quand le joueur reculait → effet moonwalk.)
    let rel = Math.atan2(p.vy || 0, p.vx || 0) - (p.face || 0);
    rel = Math.atan2(Math.sin(rel), Math.cos(rel));
    const pb = !!p.back || (sp > 0.3 && Math.cos(rel) < -0.35);
    const side = !pb && sp > 0.3 && Math.abs(Math.sin(rel)) > 0.72 ? Math.sign(Math.sin(rel)) : 0;
    // À reculons (face au jeu) : la foulée s'inverse et le buste se redresse.
    const sw = Math.sin(ph) * amp * jog * (pb ? -0.7 : side ? 0.45 : 1);
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
      // Bras le long du corps à l'arrêt (légèrement écartés), coude qui se plie avec l'allure.
      a.sh.rotation.x = -a.sgn * (0.06 + 0.08 * jog);
      a.el.rotation.z = 0.12 + 0.12 * jog + 1.1 * run * run;
    }
    const lean = pb ? -0.08 : Math.max(-0.25, Math.min(0.32, 0.05 + 0.2 * run + (p.acc || 0) * 0.025));
    // Jeu de corps : on se penche en avant pour démarrer, on se redresse et on « s'assoit » pour freiner.
    this._acc = (this._acc || 0) + (((p.acc || 0)) - (this._acc || 0)) * Math.min(1, (ctx.dt || 0.016) * 8);
    const accLean = pb ? 0 : Math.max(-0.3, Math.min(0.22, this._acc * 0.04));
    const brake = pb ? 0 : Math.max(0, Math.min(1, (-this._acc - 1.5) / 5)) * Math.min(1, sp / 2.5);
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
    // Foulée réelle (capture de mouvement) dès que le joueur se déplace vers l'avant.
    // Pivot sur place : de petits pas (au lieu de tourner comme sur une plaque) ; marche lente :
    // vraie foulée de marche à amplitude réduite (au lieu de glisser jambes immobiles).
    const turning = sp < 0.8 && Math.abs(this._turn || 0) > 1.2 && !(p.kick > 0) && !(p.celeb > 0) && !(p.fall > 0) && !(p.slide > 0) && !(p.dive > 0);
    if (turning) this._tph = (this._tph || 0) + dtp * Math.min(9, Math.abs(this._turn) * 2.4);
    const G2 = (sp >= 0.15 || turning) && !pb ? gaitAt(Math.max(sp, turning ? 1 : 0), turning ? this._tph : ph) : null;
    if (G2 && (turning || sp < 0.8 || side)) {
      const amp = turning ? 0.55 : side ? 0.5 : Math.max(0.35, sp / 0.8);
      for (const key of ['hzL', 'hzR', 'kzL', 'kzR', 'szL', 'szR', 'twist', 'azL', 'azR', 'bob']) G2[GI[key]] *= amp;
    }
    if (G2) {
      const g = (k) => G2[GI[k]];
      lL.hip.rotation.set(g('hxL'), 0, g('hzL')); lR.hip.rotation.set(-g('hxR'), 0, g('hzR'));
      lL.knee.rotation.z = g('kzL'); lR.knee.rotation.z = g('kzR');
      lL.ankle.rotation.set(0, 0, g('azL')); lR.ankle.rotation.set(0, 0, g('azR'));
      const [aL, aR] = this.arms;
      aL.sh.rotation.set(-aL.sgn * g('sxL'), 0, g('szL')); aR.sh.rotation.set(-aR.sgn * g('sxR'), 0, g('szR'));
      aL.el.rotation.z = g('ezL'); aR.el.rotation.z = g('ezR');
      this.upper.rotation.set(0, g('twist'), -Math.max(0, g('lean')) * 0.6 - accLean * 0.4);
      this.body.rotation.set(bank, 0, -Math.max(0, g('lean')) * 0.4 - accLean);
      // Marche (et pas chassés) : bras relâchés le long du corps, coude à peine plié, petit balancier ;
      // la tenue « bras de course » (coudes à 90°) n'apparaît qu'en trottinant puis en courant.
      const walkK = Math.max(0, Math.min(1, (3.4 - sp) / 2.2));
      if (walkK > 0) {
        aL.el.rotation.z += (0.22 - aL.el.rotation.z) * walkK; aR.el.rotation.z += (0.22 - aR.el.rotation.z) * walkK;
        aL.sh.rotation.x += (-aL.sgn * 0.07 - aL.sh.rotation.x) * walkK; aR.sh.rotation.x += (-aR.sgn * 0.07 - aR.sh.rotation.x) * walkK;
        aL.sh.rotation.z *= 1 - 0.45 * walkK; aR.sh.rotation.z *= 1 - 0.45 * walkK;
      }
      // Freinage : appui planté, genoux fléchis, bassin qui descend (on « s'assoit » pour s'arrêter).
      if (brake > 0) { lL.knee.rotation.z -= 0.3 * brake; lR.knee.rotation.z -= 0.3 * brake; lL.hip.rotation.z += 0.18 * brake; lR.hip.rotation.z += 0.18 * brake; this.body.position.y -= 0.05 * brake; }
      // Pas chassés : les jambes s'écartent et se rejoignent sur le côté (hanches en abduction).
      if (side) { const ab = Math.sin(ph) * 0.22; lL.hip.rotation.x += ab * side; lR.hip.rotation.x += ab * side; }
      // Pied d'appui au sol (la jambe fléchie abaisse le bassin), petite phase de vol en course.
      this.body.position.y = 0; this.groundContact();
      this.body.position.y += Math.max(0, g('bob')) * K * 0.5;
    }
    // À l'arrêt : genoux souples ; le gardien se met en position d'attente quand le jeu approche.
    if (sp < 0.8 && !G2) {
      const ready = p.gk && ctx.ballNear ? 1 : 0.25;
      // Gardien en attente : appuis écartés, genoux bien fléchis, buste penché, mains basses et
      // ouvertes devant les cuisses, coudes pliés (et non bras tendus à l'horizontale).
      lL.knee.rotation.z = lR.knee.rotation.z = -0.55 * ready - 0.08;
      lL.hip.rotation.z = lR.hip.rotation.z = 0.32 * ready;
      lL.hip.rotation.x = 0.12 * ready; lR.hip.rotation.x = -0.12 * ready;
      this.body.rotation.z = -0.2 * ready;
      this.body.position.y = -0.1 * ready;
      if (p.gk && ctx.ballNear) for (const a of this.arms) { a.sh.rotation.x = -a.sgn * 0.32; a.sh.rotation.z = GK_ARM_Z; a.el.rotation.z = 1.05; }
      // Vie à l'arrêt : respiration (plus ample quand il est fatigué), transfert d'appui d'une
      // jambe sur l'autre, tête qui balaie le jeu ; près du ballon, en alerte sur la pointe des pieds.
      if (!(p.kick > 0) && !(p.celeb > 0) && !(p.fall > 0) && !(p.slide > 0) && !(p.hurt > 0)) {
        const t = performance.now() / 1000 + (p.id ?? 0) * 1.37;
        const tired = Math.max(0, Math.min(1, (70 - (p.mp?.energy ?? p.energy ?? 90)) / 40));
        const br = Math.sin(t * (1.5 + tired * 1.6));
        this.upper.rotation.z += br * (0.014 + tired * 0.03);
        for (const a of this.arms) a.sh.rotation.z += br * 0.025;
        const ws = Math.sin(t * 0.42);
        this.body.rotation.x += ws * 0.035;
        (ws > 0 ? lL : lR).knee.rotation.z -= Math.abs(ws) * 0.12;
        if (ctx.ballAng == null) this.headPivot.rotation.y = Math.sin(t * 0.33) * 0.5;
        if (ctx.alert && !p.gk) {
          lL.knee.rotation.z = lR.knee.rotation.z = -0.32; lL.hip.rotation.z = lR.hip.rotation.z = 0.2;
          this.body.rotation.z = -0.14;
          this.body.position.y = -0.05 + Math.abs(Math.sin(t * 6.5)) * 0.018;
          for (const a of this.arms) { a.sh.rotation.x = -a.sgn * 0.22; a.el.rotation.z = 0.55; }
        }
      }
    }
    // Conduite de balle : la jambe qui est devant dans la foulée va chercher le ballon (intérieur,
    // extérieur ou cou-de-pied), pointe du pied vers le bas, puis repart dans la course.
    if (p.touch > 0) {
      const tm = p.touchMax || 0.18;
      const u = Math.max(0, Math.min(1, 1 - p.touch / tm));
      const k = Math.sin(u * Math.PI);
      const leg = p.touchFoot === 'L' ? lL : lR, other = leg === lL ? lR : lL, sg = leg === lL ? 1 : -1;
      leg.hip.rotation.z = Math.max(leg.hip.rotation.z, 0.15 + 0.5 * k);
      leg.knee.rotation.z = -0.15 - 0.35 * (1 - k);
      leg.ankle.rotation.z = -0.35 * k;
      leg.hip.rotation.y = (p.touchIn ? -0.55 : 0.35) * sg * -1 * k;   // intérieur : pied ouvert ; extérieur : pied fermé
      other.knee.rotation.z = Math.min(other.knee.rotation.z, -0.25 * k);          // appui fléchi
      this.body.rotation.z += -0.06 * k;                                             // buste au-dessus du ballon
      this.headPivot.rotation.z = -0.25 * k;                                         // coup d'œil au ballon
    }
    // Frappe / passe : course d'élan, pied d'appui planté à côté du ballon, armé (talon vers les
    // fesses), fouetté de la jambe (cou-de-pied pour la frappe, intérieur pour la passe, sous le
    // ballon pour un ballon aérien), accompagnement, bras opposé en balancier. Pied fort du joueur.
    if (p.kick > 0) {
      if (!(this._kMax > 0) || p.kick > this._kPrev + 0.01) this._kMax = p.kickMax || Math.max(0.24, p.kick);
      this._kPrev = p.kick;
      const pow = p.kickPow ?? 0.8;
      const t = Math.max(0, Math.min(1, 1 - p.kick / this._kMax));
      const kl = p.kickFoot === 'L' ? lL : lR, pl = kl === lL ? lR : lL, sg = kl === lL ? 1 : -1;
      const ease3 = (x) => x * x * (3 - 2 * x);
      // Geste réel (capture de mouvement) : la plus puissante pour les frappes, les autres pour les
      // passes ; en miroir pour le pied gauche ; amplitude réduite pour une passe douce.
      const KD = kickAt(pow > 0.85 ? 2 : (p.id ?? 0) % 2, t);
      if (KD) {
        const mir = p.kickFoot === 'L';
        const g = (k) => KD[GI[mir ? k.slice(0, -1) + (k.endsWith('L') ? 'R' : 'L') : k]];
        const a = 0.55 + 0.45 * Math.min(1, pow);
        lL.hip.rotation.set(g('hxL'), 0, g('hzL') * a); lR.hip.rotation.set(-g('hxR'), 0, g('hzR') * a);
        lL.knee.rotation.z = g('kzL') * a; lR.knee.rotation.z = g('kzR') * a;
        lL.ankle.rotation.set(0, 0, g('azL')); lR.ankle.rotation.set(0, 0, g('azR'));
        const [aL, aR] = this.arms;
        aL.sh.rotation.set(-aL.sgn * g('sxL'), 0, g('szL')); aR.sh.rotation.set(-aR.sgn * g('sxR'), 0, g('szR'));
        aL.el.rotation.z = g('ezL'); aR.el.rotation.z = g('ezR');
        this.upper.rotation.set(0, KD[GI.twist] * (mir ? -1 : 1) * a, 0);
        this.body.rotation.set(0, 0, -KD[GI.lean] * 0.8 + (p.kickLoft ? 0.08 : 0));
        if (p.kickSide) { kl.hip.rotation.y = 0.8 * sg * Math.sin(Math.min(1, t * 1.6) * Math.PI / 2); kl.hip.rotation.x = 0.16 * sg * -1; }
        if (p.kickOut > 0) { kl.hip.rotation.y = -0.6 * sg * Math.sin(Math.min(1, t * 1.6) * Math.PI / 2); kl.hip.rotation.x = 0.22 * sg; kl.ankle.rotation.y = -0.5 * sg; }
        this.body.position.y = 0; this.groundContact();
      }
      let hip, knee, ankle;
      if (KD) { /* geste capturé appliqué */ } else if (t < 0.38) {                       // armé : la jambe part en arrière, genou plié
        const u = ease3(t / 0.38);
        hip = -0.15 - 0.5 * pow * u; knee = -(0.5 + 1.15 * pow) * u; ankle = -0.2 * u;
      } else if (t < 0.55) {                // fouetté jusqu'au contact (jambe tendue au contact)
        const u = (t - 0.38) / 0.17;
        hip = -0.15 - 0.5 * pow + (0.65 * pow + 0.15 + 0.75 * pow) * u; knee = -(0.5 + 1.15 * pow) * (1 - u) - 0.04; ankle = p.kickSide ? 0 : -0.6;
      } else {                              // accompagnement, plus haut pour une frappe ou un ballon levé
        const u = (t - 0.55) / 0.45;
        const top = (p.kickSide ? 0.55 : 0.9) * pow + (p.kickLoft ? 0.35 : 0);
        hip = (0.75 * pow) + (top - 0.75 * pow) * Math.sin(Math.min(1, u * 1.4) * Math.PI / 2) * (1 - u * 0.6);
        knee = -0.08 - 0.35 * u; ankle = (p.kickSide ? 0 : -0.5) * (1 - u);
      }
      if (!KD) {   // (repli : geste animé par le code)
      kl.hip.rotation.z = hip; kl.knee.rotation.z = knee; kl.ankle.rotation.z = ankle;
      // Plat du pied : pied ouvert vers l'extérieur (rotation de la hanche), geste plus court.
      if (p.kickSide) { kl.hip.rotation.y = 0.8 * sg * Math.sin(Math.min(1, t * 1.6) * Math.PI / 2); kl.hip.rotation.x = 0.16 * sg * -1; }
      // Extérieur du pied (trivela) : pied tourné vers l'intérieur.
      if (p.kickOut > 0) { kl.hip.rotation.y = -0.6 * sg * Math.sin(Math.min(1, t * 1.6) * Math.PI / 2); kl.hip.rotation.x = 0.22 * sg; kl.ankle.rotation.y = -0.5 * sg; }
      // Pied d'appui planté, genou fléchi qui absorbe ; buste au-dessus du ballon (frappe basse)
      // ou en arrière (ballon levé).
      pl.hip.rotation.z = 0.1 - 0.05 * t; pl.knee.rotation.z = -0.3 - 0.22 * pow * Math.sin(Math.min(1, t * 1.8) * Math.PI);
      pl.ankle.rotation.z = 0;
      const lean = p.kickLoft ? 0.16 : -0.14;
      this.body.rotation.z = (lean - 0.12 * pow) * Math.sin(t * Math.PI);
      this.body.rotation.x = 0.12 * pow * sg * -1 * Math.sin(t * Math.PI);       // le corps s'enroule autour de l'appui
      this.upper.rotation.y = 0.35 * pow * sg * Math.sin(Math.min(1, t * 1.3) * Math.PI);   // les épaules contre-tournent
      // Bras : celui du côté opposé à la jambe de frappe s'ouvre en balancier, l'autre recule.
      const ao = kl === lR ? this.arms[0] : this.arms[1], as = ao === this.arms[0] ? this.arms[1] : this.arms[0];
      const kk = Math.sin(Math.min(1, t * 1.4) * Math.PI);
      ao.sh.rotation.x = -ao.sgn * (0.5 + 0.7 * pow) * kk; ao.sh.rotation.z = 0.35 * kk; ao.el.rotation.z = 0.5;
      as.sh.rotation.x = -as.sgn * 0.25 * kk; as.sh.rotation.z = -0.45 * pow * kk; as.el.rotation.z = 0.6;
      }
    } else this._kMax = 0;
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
      // (bras tourné vers l'intérieur : le coude part sur le côté et la main se pose sur la hanche)
      for (const a of this.arms) { a.sh.rotation.x = -a.sgn * 0.55; a.sh.rotation.y = a.sgn * 1.3; a.sh.rotation.z = -0.35; a.el.rotation.z = 1.75; }
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
      // (6c-B) Côté du plongeon dans le repère du gardien : lu sur son déplacement réel (contrat, `diveSide`) ; à
      // défaut, côté le long de la ligne de but ramené à son orientation. (Vue retournée à la mi-temps : simple
      // rotation de 180°, sans effet sur ce côté.)
      const dir = p.diveSide ?? (p.diveDir || 1) * (Math.cos(p.face || 0) < 0 ? -1 : 1);
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
    const JD = p.jump > 0 && JUMPS.length ? sampleSeq(JUMPS[(p.id ?? 0) % JUMPS.length], 1 - p.jump / 0.45) : null;
    if (JD) {
      // Saut réel (capture de mouvement) : impulsion bras, détente, réception.
      const g = (k) => JD[GI[k]];
      lL.hip.rotation.set(g('hxL'), 0, g('hzL')); lR.hip.rotation.set(-g('hxR'), 0, g('hzR'));
      lL.knee.rotation.z = g('kzL'); lR.knee.rotation.z = g('kzR');
      lL.ankle.rotation.set(0, 0, g('azL')); lR.ankle.rotation.set(0, 0, g('azR'));
      // Joueur de tête : bras écartés et levés, coudes pliés (équilibre, protéger son espace),
      // tête qui part en arrière à l'impulsion puis vient frapper le ballon au sommet du saut.
      const tj = Math.max(0, Math.min(1, 1 - p.jump / 0.45)), kA = Math.sin(tj * Math.PI);
      if (p.gk || p.claimHigh > 0) for (const a of this.arms) { a.sh.rotation.set(-a.sgn * 0.25 * kA, 0, 2.85 * kA); a.el.rotation.z = 0.25; }   // gardien : bras tendus pour capter haut
      else for (const a of this.arms) { a.sh.rotation.set(-a.sgn * 1.15 * kA, 0, 0.45 * kA); a.el.rotation.z = 0.4 + 1.0 * kA; }
      this.headPivot.rotation.z = tj < 0.45 ? 0.35 * Math.sin((tj / 0.45) * Math.PI / 2) : 0.35 - 0.8 * Math.sin(Math.min(1, (tj - 0.45) / 0.2) * Math.PI / 2) * (tj < 0.8 ? 1 : 1 - (tj - 0.8) / 0.2);
      this.upper.rotation.set(0, g('twist') * 0.5, 0);
      this.body.rotation.z = -g('lean') * 0.8;
      this.body.position.y = Math.max(0, g('bob')) * K * 1.15;
    } else if (p.jump > 0) {
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
      const [cL, cR] = this.arms;
      // Bras : sz = vers l'avant, sx = sur le côté, e = coude, y = rotation interne (comme le coach).
      const arms = (szL, sxL, eL, szR, sxR, eR, yL = 0, yR = 0) => {
        cL.sh.rotation.set(-cL.sgn * sxL, cL.sgn * yL, szL); cL.el.rotation.set(0, 0, eL);
        cR.sh.rotation.set(-cR.sgn * sxR, cR.sgn * yR, szR); cR.el.rotation.set(0, 0, eR);
      };
      const kneel = () => { this.body.position.y = -RIG.kneel; lL.hip.rotation.z = lR.hip.rotation.z = 0.1; lL.knee.rotation.z = lR.knee.rotation.z = -1.9; };
      if (p.celebType === 'slide' && sp > 2 && p.celeb < 2.4) {   // glissade à genoux, buste en arrière
        kneel(); this.body.rotation.z = -0.35; arms(0.3, 1.5, 0.1, 0.3, 1.5, 0.1); this.headPivot.rotation.z = 0.3;
      } else if (sp > 2) for (const a of this.arms) { a.sh.rotation.x = -a.sgn * 1.45; a.sh.rotation.z = 0; a.el.rotation.z = 0.05; }
      else if (p.celebType === 'slide') { kneel(); this.body.rotation.z = -0.2; arms(0.3, 2.6, 0.15, 0.3, 2.6, 0.15); }
      else if (p.celebType === 'salute') {          // salut militaire, droit comme un i
        arms(0.05, 0.08, 0.1, 0.8, 1.3, 2.75, 0, -0.75); this.headPivot.rotation.z = 0.08;
      } else if (p.celebType === 'flex') {          // biceps gonflés face aux supporters
        arms(0.3, 1.4, 2.2, 0.3, 1.4, 2.2, -1.4, -1.4); this.headPivot.rotation.z = 0.15;
      } else if (p.celebType === 'ear') {           // main derrière l'oreille : « on ne vous entend pas ! »
        arms(0.2, 0.25, 0.4, 0.4, 1.45, 2.7, 0, -1.0); this.body.rotation.x = 0.12; this.headPivot.rotation.x = 0.25;
      } else if (p.celebType === 'shush') {         // index sur la bouche, face aux tribunes adverses
        arms(0.1, 0.12, 0.2, 1.25, 0.05, 2.45, 0, 0.95); this.body.rotation.z = -0.08;
      } else if (p.celebType === 'heart') {         // cœur avec les mains
        arms(0.8, 0.05, 1.85, 0.8, 0.05, 1.85, 1.1, 1.1);
      } else if (p.celebType === 'cool') {          // bras croisés, menton levé
        arms(0.55, 0.05, 1.85, 0.45, 0.05, 1.95, 1.15, 1.05); this.headPivot.rotation.z = 0.18;
      } else if (p.celebType === 'hug') {           // coéquipier : il serre le buteur dans ses bras
        arms(1.45, 0.75, 0.75, 1.45, 0.75, 0.75, 0.25, 0.25); this.body.rotation.z = -0.12;
        this.body.position.y += Math.abs(Math.sin(p.celeb * 6)) * 0.05;
      } else if (p.celebType === 'badge') {         // il embrasse l'écusson
        arms(0.15, 0.2, 0.3, 0.7, 0.05, 2.2, 0, 1.3); this.headPivot.rotation.z = -0.5; this.upper.rotation.z = -0.08;
      } else if (p.celebType === 'knees') {           // à genoux, bras au ciel
        this.body.position.y = -RIG.kneel; this.body.rotation.z = 0.25;
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
    this.updateFootShadows();
  }

  /** Les ombres de contact suivent les chevilles (position de l'image précédente : imperceptible). */
  updateFootShadows() {
    if (!this.detail || !this.footShadows) return;
    for (let i = 0; i < 2; i++) {
      const f = this.footShadows[i];
      this.legs[i].ankle.getWorldPosition(_footV);
      this.root.worldToLocal(_footV);
      const s = this.root.scale.x || 1, hgt = Math.max(0, _footV.y * s - 0.09);
      f.visible = hgt < 0.35;
      if (!f.visible) continue;
      // Le joueur regarde vers +x (repère local) : la tache s'allonge dans l'axe du pied.
      f.position.x = _footV.x + 0.05; f.position.z = _footV.z;
      const k = 1 - hgt * 2.2;
      f.scale.set(1.6 * k, k, 1);
    }
  }
}

/* ---------------- Scène ---------------- */

/* ---------------- Maillots réalistes ---------------- */

/** Motif du maillot domicile des clubs connus (rayures, cerceaux, demi, écharpe, bande…). */
const KIT_PATTERNS = [
  [/juventus|newcastle|atl[eé]tico|athletic|inter\b|internazionale|\bmilan|barcelona|brentford|sunderland|stoke|sheffield united|west brom|crystal palace|bournemouth|brighton|atalanta|bologna|udinese|club brugge|olympiacos|partizan|estudiantes|botafogo|gr[eê]mio|racing club|real sociedad|betis|espanyol|vitesse|feyenoord|lens|nice|stade rennais/i, 'stripes'],
  [/celtic|sporting|queens park|flamengo|shamrock/i, 'hoops'],
  [/river plate|vasco|rayo vallecano/i, 'sash'],
  [/boca juniors|bordeaux/i, 'band'],
  [/ajax|paris saint|psg/i, 'centre'],
  [/blackburn|genoa|basel|monaco/i, 'halves'],
];
export function kitPattern(club) {
  const n = club?.name || '';
  for (const [re, k] of KIT_PATTERNS) if (re.test(n)) return k;
  return 'plain';
}
const KIT_TEX = new Map();
/**
 * Texture du maillot (enroulée autour du buste) : couleur et motif, col et bas de maillot
 * contrastés, coutures, plis du tissu, écusson sur le cœur.
 */
/** Short : bande latérale (couleur du liseré) et ourlet ; u = 0 et u = 0,5 = côtés de la jambe. */
const SHORTS_TEX = new Map();
export function shortsTexture(c, trim) {
  const key = `${c}|${trim}`;
  if (SHORTS_TEX.has(key)) return SHORTS_TEX.get(key);
  const tex = canvasTex(128, 64, (g, w, h) => {
    g.fillStyle = c; g.fillRect(0, 0, w, h);
    g.fillStyle = trim;
    for (const u of [0, 0.5, 1]) g.fillRect(u * w - 4, 0, 8, h);
    g.fillStyle = 'rgba(0,0,0,0.18)'; g.fillRect(0, 0, w, 5);               // ourlet du bas (tube : v = 0 en bas)
    for (const u of [0.25, 0.75]) { const gr = g.createLinearGradient(u * w - 14, 0, u * w + 14, 0); gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.5, 'rgba(255,255,255,0.06)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(u * w - 14, 0, 28, h); }
  });
  tex.wrapS = THREE.RepeatWrapping;
  SHORTS_TEX.set(key, tex);
  return tex;
}
/** Sponsors maillot (marques imaginaires) : un par club, stable. */
const SPONSORS = ['NOVAMAX', 'ATLAS AIR', 'VELTA', 'ORIONBANK', 'KAIRO', 'LUMEN', 'TERRA', 'HELIX', 'ZENKO', 'MERIDIA', 'AURORA', 'POLARIS', 'VEXA', 'SOLARA', 'KESTREL', 'NORDIX', 'QUANTA', 'ALTIS', 'BRAVA', 'CIRRUS'];
export const sponsorOf = (club) => SPONSORS[Math.abs(((club?.id ?? 7) * 2654435761) | 0) % SPONSORS.length];
export function kitTexture(c1, c2, pattern, sponsor = '', sleeve = false) {
  const key = `${c1}|${c2}|${pattern}|${sponsor}|${sleeve}`;
  if (KIT_TEX.has(key)) return KIT_TEX.get(key);
  const tex = canvasTex(512, 256, (g, w, h) => {
    g.fillStyle = c1; g.fillRect(0, 0, w, h);
    g.fillStyle = c2;
    if (pattern === 'stripes') for (let i = 0; i < 12; i++) if (i % 2) g.fillRect((i / 12) * w, 0, w / 12, h);
    if (pattern === 'hoops') for (let i = 0; i < 8; i++) if (i % 2) g.fillRect(0, (i / 8) * h, w, h / 8);
    if (pattern === 'halves') g.fillRect(0.25 * w, 0, 0.5 * w, h);
    if (pattern === 'centre') g.fillRect(0.2 * w, 0, 0.1 * w, h);                           // bande verticale au centre
    if (pattern === 'band') g.fillRect(0, 0.42 * h, w, 0.18 * h);                            // bande horizontale
    if (pattern === 'sash') { g.save(); g.translate(0.25 * w, 0.5 * h); g.rotate(-0.5); g.fillRect(-0.12 * w, -h, 0.07 * w, 2 * h); g.restore(); }
    // Col et bas du maillot (liserés contrastés), coutures latérales.
    g.fillStyle = c2; g.fillRect(0, 0, w, 0.06 * h); g.fillRect(0, 0.97 * h, w, 0.03 * h);
    g.fillStyle = 'rgba(0,0,0,0.18)'; for (const u of [0, 0.5]) g.fillRect(u * w - 1, 0, 2, h);
    // Plis du tissu : légères ombres verticales et reflets.
    for (let i = 0; i < 26; i++) {
      const x = ((i * 97) % 512), a = 0.025 + ((i * 37) % 7) / 220;
      const gr = g.createLinearGradient(x - 9, 0, x + 9, 0);
      gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(0.5, i % 3 ? `rgba(0,0,0,${a})` : `rgba(255,255,255,${a})`); gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gr; g.fillRect(x - 9, 0.06 * h, 18, 0.9 * h);
    }
    if (sleeve) return; // manches : motif et tissu seulement
    // Écusson sur le cœur (côté gauche du joueur, à l'avant).
    const bx = 0.3 * w, by = 0.26 * h;
    g.fillStyle = c2; g.beginPath(); g.moveTo(bx - 9, by - 10); g.lineTo(bx + 9, by - 10); g.lineTo(bx + 9, by + 3); g.quadraticCurveTo(bx, by + 13, bx - 9, by + 3); g.closePath(); g.fill();
    g.fillStyle = c1; g.beginPath(); g.arc(bx, by - 2, 4.5, 0, Math.PI * 2); g.fill();
    // Petit logo d'équipementier (générique) à l'opposé.
    g.strokeStyle = c2; g.lineWidth = 2.5; g.beginPath(); g.moveTo(0.2 * w - 7, by - 2); g.quadraticCurveTo(0.2 * w, by + 6, 0.2 * w + 8, by - 6); g.stroke();
    // Sponsor sur la poitrine (marque imaginaire), à l'encre du maillot.
    if (sponsor) {
      g.save(); g.fillStyle = c2; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.font = `900 ${sponsor.length > 8 ? 17 : 21}px "Barlow Condensed", system-ui, sans-serif`;
      g.fillText(sponsor, 0.25 * w, 0.43 * h, 0.17 * w);
      g.restore();
    }
    // Ombre douce sous les bras et sur les flancs (volume du buste).
    for (const u of [0, 0.5, 1]) {
      const gr = g.createLinearGradient(u * w - 40, 0, u * w + 40, 0);
      gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(0.5, 'rgba(0,0,0,0.13)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gr; g.fillRect(u * w - 40, 0, 80, h);
    }
  });
  tex.wrapS = THREE.RepeatWrapping;
  KIT_TEX.set(key, tex);
  return tex;
}

/**
 * MAILLOT DÉTAILLÉ (joueurs réalistes) : une texture par joueur, à l'échelle du corps
 * (≈ 1 px par mm : le tour du buste fait ~1 m, la hauteur du maillot ~0,45 m).
 *  - devant (u = 0,25) : écusson du club (côté cœur), équipementier, sponsor ;
 *  - dos (u = 0,75) : NOM (lettres de ~6 cm) et NUMÉRO (~25 cm) imprimés dans le tissu ;
 *  - col et bas contrastés, panneaux latéraux, trame du tissu, plis.
 * Manches : liseré et écusson de compétition sur l'extérieur du bras.
 * (marques et écussons génériques : initiales du club, aucun logo réel)
 */
const PRO_KIT = new Map();
export function proKitTexture({ c1, c2, ink, pattern = 'plain', sponsor = '', num = '', name = '', crest = '', sleeve = false, hi = true }) {
  const key = JSON.stringify(arguments[0]);
  if (PRO_KIT.has(key)) return PRO_KIT.get(key);
  const W2 = hi ? 1024 : 512, H2 = W2 / 2, k = W2 / 1024;
  const tex = canvasTex(W2, H2, (g, w, h) => {
    const V = (v) => (1 - v) * h;            // v (0 en bas, 1 en haut) -> y du canvas
    g.fillStyle = c1; g.fillRect(0, 0, w, h);
    g.fillStyle = c2;
    if (pattern === 'stripes') for (let i = 0; i < 16; i++) if (i % 2) g.fillRect((i / 16) * w, 0, w / 16, h);
    if (pattern === 'hoops') for (let i = 0; i < 9; i++) if (i % 2) g.fillRect(0, (i / 9) * h, w, h / 9);
    if (pattern === 'halves') g.fillRect(0.25 * w, 0, 0.5 * w, h);
    if (pattern === 'centre') g.fillRect(0.22 * w, 0, 0.06 * w, h);
    if (pattern === 'band') g.fillRect(0, V(0.62), w, 0.12 * h);
    if (pattern === 'sash') { g.save(); g.translate(0.25 * w, 0.5 * h); g.rotate(-0.55); g.fillRect(-0.05 * w, -h, 0.06 * w, 2 * h); g.restore(); }
    // Trame du tissu (maille fine) et légères bandes verticales tissées.
    g.globalAlpha = 0.03; g.fillStyle = '#000';
    for (let y = 0; y < h; y += 3 * k) for (let x = (y / (3 * k)) % 2 ? 0 : 1.5 * k; x < w; x += 3 * k) g.fillRect(x, y, 1.2 * k, 1.2 * k);
    g.globalAlpha = 1;
    // Panneaux latéraux (couleur secondaire) et coutures.
    if (pattern === 'plain' || pattern === 'centre') { g.fillStyle = c2; g.globalAlpha = 0.85; for (const u of [0, 0.5, 1]) g.fillRect(u * w - 18 * k, 0, 36 * k, h); g.globalAlpha = 1; }
    g.fillStyle = 'rgba(0,0,0,0.22)'; for (const u of [0, 0.5]) g.fillRect(u * w - 1, 0, 2, h);
    // Col (anneau du haut) et bas du maillot.
    g.fillStyle = c2; g.fillRect(0, 0, w, 0.07 * h); g.fillStyle = 'rgba(255,255,255,.25)'; g.fillRect(0, 0.07 * h - 2 * k, w, 2 * k);
    g.fillStyle = c2; g.fillRect(0, h - 0.025 * h, w, 0.025 * h);
    // Plis : ombres verticales douces.
    for (let i = 0; i < 30; i++) {
      const x = ((i * 157) % 1024) * k, a = 0.02 + ((i * 37) % 7) / 260;
      const gr = g.createLinearGradient(x - 16 * k, 0, x + 16 * k, 0);
      gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(0.5, i % 3 ? `rgba(0,0,0,${a})` : `rgba(255,255,255,${a})`); gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gr; g.fillRect(x - 16 * k, 0.08 * h, 32 * k, 0.9 * h);
    }
    if (sleeve) {
      // Manche : écusson de compétition à l'extérieur (côté droit u = 0 ; côté gauche u = 0,5).
      for (const u of [0.0, 0.5, 1.0]) {
        const cx = u * w, cy = V(0.55), r = 34 * k;
        g.fillStyle = '#f4f4f4'; g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.fill();
        g.strokeStyle = '#1a2a6c'; g.lineWidth = 5 * k; g.beginPath(); g.arc(cx, cy, r - 6 * k, 0, Math.PI * 2); g.stroke();
        g.fillStyle = '#1a2a6c'; g.beginPath(); g.moveTo(cx, cy - 16 * k); g.lineTo(cx + 14 * k, cy + 10 * k); g.lineTo(cx - 14 * k, cy + 10 * k); g.closePath(); g.fill();
      }
      return;
    }
    // Écusson (côté cœur) : bouclier aux initiales du club.
    const bx = 0.305 * w, by = V(0.78), bw = 70 * k, bh = 82 * k;
    g.fillStyle = c2; g.beginPath(); g.moveTo(bx - bw / 2, by - bh / 2); g.lineTo(bx + bw / 2, by - bh / 2); g.lineTo(bx + bw / 2, by + bh * 0.1); g.quadraticCurveTo(bx, by + bh * 0.62, bx - bw / 2, by + bh * 0.1); g.closePath(); g.fill();
    g.strokeStyle = c1; g.lineWidth = 4 * k; g.stroke();
    g.fillStyle = c1; g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = `900 ${26 * k}px "Barlow Condensed", system-ui, sans-serif`;
    g.fillText(String(crest || '').slice(0, 3).toUpperCase(), bx, by - bh * 0.06, bw * 0.86);
    // Équipementier (logo générique) à l'opposé.
    g.strokeStyle = c2; g.lineWidth = 7 * k; g.lineCap = 'round';
    g.beginPath(); g.moveTo(0.195 * w - 22 * k, by - 4 * k); g.quadraticCurveTo(0.195 * w, by + 16 * k, 0.195 * w + 26 * k, by - 18 * k); g.stroke();
    // Sponsor (marque imaginaire) sur la poitrine.
    if (sponsor) {
      g.fillStyle = c2; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.font = `900 ${(sponsor.length > 8 ? 54 : 64) * k}px "Barlow Condensed", system-ui, sans-serif`;
      g.fillText(sponsor, 0.25 * w, V(0.56), 0.2 * w);
    }
    // Dos : nom puis numéro, encre contrastée avec un fin contour.
    g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineJoin = 'round';
    if (name) {
      const nm = String(name).toUpperCase().slice(0, 14);
      g.font = `700 ${(nm.length > 9 ? 40 : 48) * k}px "Barlow Condensed", system-ui, sans-serif`;
      g.fillStyle = ink; g.fillText(nm, 0.75 * w, V(0.76), 0.2 * w);
    }
    if (num !== '' && num != null) {
      g.font = `800 ${232 * k}px "Barlow Condensed", system-ui, sans-serif`;
      g.strokeStyle = c1 === ink ? c2 : c1; g.lineWidth = 10 * k; g.strokeText(String(num), 0.75 * w, V(0.38), 0.24 * w);
      g.fillStyle = ink; g.fillText(String(num), 0.75 * w, V(0.38), 0.24 * w);
    }
  });
  tex.wrapS = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  PRO_KIT.set(key, tex);
  return tex;
}

/** Short détaillé (joueurs réalistes) : liserés latéraux, ceinture, petit numéro sur la cuisse gauche (~10 cm). */
export function proShortsTexture(c, trim, num = '', hi = true) {
  const key = `${c}|${trim}|${num}|${hi}`;
  if (PRO_KIT.has(key)) return PRO_KIT.get(key);
  const W2 = hi ? 512 : 256, H2 = W2 / 2, k = W2 / 512;
  const tex = canvasTex(W2, H2, (g, w, h) => {
    g.fillStyle = c; g.fillRect(0, 0, w, h);
    g.globalAlpha = 0.05; g.fillStyle = '#000';
    for (let y = 0; y < h; y += 3 * k) for (let x = (y / (3 * k)) % 2 ? 0 : 1.5 * k; x < w; x += 3 * k) g.fillRect(x, y, 1.2 * k, 1.2 * k);
    g.globalAlpha = 1;
    g.fillStyle = trim; for (const u of [0, 0.5, 1]) g.fillRect(u * w - 9 * k, 0, 18 * k, h);    // bandes latérales
    g.fillStyle = 'rgba(0,0,0,.25)'; g.fillRect(0, 0, w, 10 * k);                                   // ceinture (haut du tube)
    g.fillStyle = 'rgba(0,0,0,.18)'; g.fillRect(0, h - 6 * k, w, 6 * k);                            // ourlet
    if (num !== '' && num != null) {
      g.fillStyle = trim; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.font = `800 ${46 * k}px "Barlow Condensed", system-ui, sans-serif`;
      g.fillText(String(num), 0.37 * w, (1 - 0.4) * h);   // devant de la cuisse gauche
    }
  });
  tex.wrapS = THREE.RepeatWrapping; tex.anisotropy = 4;
  PRO_KIT.set(key, tex);
  return tex;
}

/** Chaussettes : côtes du tricot, revers (bande) aux couleurs du club en haut. */
export function proSocksTexture(c, band) {
  const key = `socks|${c}|${band}`;
  if (PRO_KIT.has(key)) return PRO_KIT.get(key);
  const tex = canvasTex(128, 128, (g, w, h) => {
    g.fillStyle = c; g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(0,0,0,.07)'; for (let x = 0; x < w; x += 4) g.fillRect(x, 0, 2, h);     // côtes
    g.fillStyle = band; g.fillRect(0, 8, w, 9); g.fillRect(0, 22, w, 4);                       // revers
    g.fillStyle = 'rgba(0,0,0,.18)'; g.fillRect(0, 0, w, 5);                                    // bord roulé
  });
  tex.wrapS = THREE.RepeatWrapping;
  PRO_KIT.set(key, tex);
  return tex;
}

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
      shadow: contactShadowMat(0.5), ring: accent };
    const faceLook = { ...L, glasses: L.glasses === true ? 'square' : L.glasses };
    const p3 = this.p3 = new Player3D(mats, L.skin, L.hairColor, '', L.outfitColor, L.outfitColor, null, { look: faceLook, name: '' });
    this.root = p3.root;
    p3.setHair(L.hairStyle);
    // Pantalon long : cuisses et genoux habillés. Manches longues (sauf polo).
    p3.setLimbMaterials({ thigh: pants, knee: pants });
    if (L.outfit !== 'polo') p3.setLimbMaterials({ upper: outfit, fore: outfit });
    const torsoY = 0.95, body = p3.upper || p3.body;
    const add = (g, m, x, y, z, parent = body) => { const o = new THREE.Mesh(g, m); o.position.set(x, y, z); parent.add(o); o.castShadow = true; o.userData.keep = true; return o; };
    // Corps réaliste (comme les joueurs) : pantalon long, manches longues sauf en polo.
    this.mhOpts = { skin: L.skin, hair: L.hairColor, hairStyle: L.hairStyle, beard: L.beard || '', eyeTex: 'brown', nat: '', trousers: true, longSleeve: L.outfit !== 'polo',
      heavy: L.build === 'heavy' ? 0.8 : 0.25, slim: L.build === 'slim' ? 0.6 : 0, mats: { shirt: outfit, sleeve: outfit, shorts: pants, socks: pants, boot: shoe } };
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
    // Bandeau « nom du joueur » en bas de l'image sur les gros plans (habillage télé).
    this.lower = document.createElement('div');
    this.lower.className = 'lower3';
    parent.appendChild(this.lower);
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
    this.camMode = 'director';   // réalisation télé automatique par défaut
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
    // Contre-jour (comme les projecteurs du côté opposé) : il découpe la silhouette des joueurs
    // sur la pelouse, au lieu de personnages « plats ».
    this.rim = new THREE.DirectionalLight('#d6e4ff', 0.55);
    this.rim.position.set(35, 30, -70);
    this.scene.add(this.rim);
    this.buildStadium();
    // (Captures de test : météo imposée.)
    this.applyConditions(globalThis.__cdpWx ? { ...(view.m.weather || {}), ...globalThis.__cdpWx } : view.m.weather);
    // Match de nuit en Ultra (ordinateur) : halo des projecteurs (post-traitement « bloom »).
    if (this.gfx === 'ultra' && !this.mobile) this.initBloom(!!(globalThis.__cdpWx || view.m.weather)?.night);
    this.buildBall();
    this.players = new Map(); // id -> { p3, label, side }
    // Joueurs réalistes pour les gros plans (chargés en arrière-plan ; pas en mode éco).
    if (this.gfx !== 'eco' && !globalThis.__cdpNoMH) loadMH().then((mh) => {
      if (!mh || this.destroyed) return;
      this.mh = mh;
      for (const e of this.players.values()) if (e.mhOpts) e.p3.attachMH(mh, e.mhOpts);
      // Arbitre : corps réaliste, tenue noire.
      if (this.ref3d && this.refMats) this.ref3d.attachMH(mh, { skin: '#c68642', hair: '#1a120c', hairStyle: 'buzz', eyeTex: 'brown', nat: 'ITA', mats: this.refMats });
      // Entraîneurs : même modèle humain que les joueurs (en tenue de ville / de survêtement).
      for (const c of this.coaches || []) if (c?.mhOpts) { c.p3.attachMH(mh, c.mhOpts); c.p3.detail = false; c.p3.setDetail(true); }
      for (const b of this.benchSubs || []) if (b.mhOpts && !b.p3.mhGroup) { b.p3.attachMH(mh, b.mhOpts); b.p3.detail = false; b.p3.setDetail(true); }
    });
    this.buildCoaches();
    // Arbitre : tenue noire.
    const black = new THREE.MeshLambertMaterial({ color: '#15171c' });
    const refMats = { shirt: black, shorts: black, socks: black, boot: new THREE.MeshLambertMaterial({ color: '#0a0a0a' }),
      shadow: contactShadowMat(0.5), ring: black };
    this.ref3d = new Player3D(refMats, '#c68642', '#1a120c', '', '#15171c', '#15171c');
    this.refMats = refMats;
    this.scene.add(this.ref3d.root);
    this.mats = view.colors.map((c, side) => this.teamMats(side));
    try { this.buildBenchSubs(); } catch (e) { console.warn('banc 3D', e); }
    this.resize();
  }

  teamMats(side) {
    const v = this.v;
    return {
      // Tissus techniques : légèrement satinés (les projecteurs accrochent les plis).
      shirt: (() => {
        // Maillot du club : motif réel (rayures, cerceaux…) quand l'équipe joue en couleurs domicile.
        const club = v.m.teams[side]?.club;
        const home = club?.colors && String(club.colors[0]).toLowerCase() === String(v.colors[side]).toLowerCase();
        const pat = home ? kitPattern(club) : 'plain';
        const c2 = home && club.colors[1] ? club.colors[1] : v.textColors[side];
        return new THREE.MeshStandardMaterial({ color: '#ffffff', map: kitTexture(v.colors[side], c2, pat, sponsorOf(club)), roughness: 0.74, metalness: 0.02 });
      })(),
      sleeve: (() => {
        const club = v.m.teams[side]?.club;
        const home = club?.colors && String(club.colors[0]).toLowerCase() === String(v.colors[side]).toLowerCase();
        return new THREE.MeshStandardMaterial({ color: '#ffffff', map: kitTexture(v.colors[side], home && club.colors[1] ? club.colors[1] : v.textColors[side], home ? kitPattern(club) : 'plain', '', true), roughness: 0.74, metalness: 0.02 });
      })(),
      gkSleeve: new THREE.MeshStandardMaterial({ color: v.gkColors[side], roughness: 0.78 }),
      // Gardien : maillot uni à sa couleur, avec sponsor et écusson.
      gk: new THREE.MeshStandardMaterial({ color: '#ffffff', map: kitTexture(v.gkColors[side], '#111111', 'plain', sponsorOf(v.m.teams[side]?.club)), roughness: 0.78 }),
      shorts: new THREE.MeshStandardMaterial({ color: '#ffffff', map: shortsTexture(v.shorts[side], v.shorts[side].toLowerCase() === String(v.textColors[side]).toLowerCase() ? v.colors[side] : v.textColors[side]), roughness: 0.72 }),
      socks: new THREE.MeshStandardMaterial({ color: v.colors[side], roughness: 0.9 }),
      trim: new THREE.MeshStandardMaterial({ color: v.textColors[side], roughness: 0.7 }),
      sole: new THREE.MeshStandardMaterial({ color: '#e9e9e9', roughness: 0.5 }),
      boot: new THREE.MeshStandardMaterial({ color: '#111111', roughness: 0.35, metalness: 0.1 }),
      shadow: contactShadowMat(0.5),
      ring: new THREE.MeshBasicMaterial({ color: '#ffd166', transparent: true, opacity: 0.95, depthWrite: false, side: THREE.DoubleSide }),
    };
  }

  buildStadium() {
    const s = this.scene;
    const pt = pitchTexture(this.renderer.capabilities.getMaxAnisotropy());
    this.pitchMat = new THREE.MeshLambertMaterial({ map: pt.tex });
    {
      const det = grassDetailTexture(), rep = new THREE.Vector2(pt.w / 1.6, pt.h / 1.6);
      this.pitchMat.onBeforeCompile = (sh) => {
        sh.uniforms.uDetail = { value: det }; sh.uniforms.uRep = { value: rep };
        sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform sampler2D uDetail; uniform vec2 uRep;')
          .replace('#include <map_fragment>', '#include <map_fragment>\n#ifdef USE_MAP\n  diffuseColor.rgb *= 0.72 + 0.56 * texture2D(uDetail, vMapUv * uRep).r;\n#endif');
      };
    }
    const pitch = new THREE.Mesh(new THREE.PlaneGeometry(pt.w, pt.h), this.pitchMat);
    pitch.rotation.x = -Math.PI / 2;
    pitch.receiveShadow = true;
    s.add(pitch);
    const apron = new THREE.Mesh(new THREE.PlaneGeometry(170, 130), new THREE.MeshLambertMaterial({ color: '#4f7c2c' }));
    apron.receiveShadow = true;
    apron.rotation.x = -Math.PI / 2; apron.position.y = -0.02;
    s.add(apron);
    // Panneaux publicitaires.
    const [h, a] = this.v.m.teams.map((t) => t.club);
    const boards = new THREE.MeshBasicMaterial({ map: boardsTexture([h.short || h.name, a.short || a.name], [h.color, h.color2]), toneMapped: false });
    this.boardsMat = boards;
    for (const z of [-W / 2 - 4, W / 2 + 4]) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(L + 6, 1, 0.2), boards);
      b.position.set(0, 0.5, z); s.add(b);
    }
    for (const x of [-L / 2 - 5, L / 2 + 5]) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(0.2, 1, W + 4), boards);
      b.position.set(x, 0.5, 0); s.add(b);
    }
    // Abords du terrain : photographes accroupis derrière les buts, stadiers en chasuble face
    // aux tribunes (silhouettes simples, dessinées en quelques appels).
    {
      const ph = [], st = [];
      for (const sx of [-1, 1]) for (const z of [-26, -20, -14, 14, 19, 24]) ph.push([sx * (L / 2 + 2.6), z, sx]);
      for (const z of [-W / 2 - 6.4]) for (let x = -L / 2 + 6; x < L / 2; x += 15) st.push([x, z, Math.PI]);
      for (const sx of [-1, 1]) for (const z of [-22, 22]) st.push([sx * (L / 2 + 6.6), z, sx > 0 ? -Math.PI / 2 : Math.PI / 2]);
      const n = ph.length + st.length, M4 = new THREE.Matrix4(), Q = new THREE.Quaternion(), Y = new THREE.Vector3(0, 1, 0);
      const torso = new THREE.BoxGeometry(0.42, 0.62, 0.28), legs = new THREE.BoxGeometry(0.36, 0.8, 0.24), head = new THREE.SphereGeometry(0.12, 10, 8), cam = new THREE.CylinderGeometry(0.07, 0.09, 0.45, 10);
      cam.rotateZ(Math.PI / 2);
      const mk = (g, color, cnt) => { const m = new THREE.InstancedMesh(g, new THREE.MeshLambertMaterial({ color }), cnt); m.castShadow = true; s.add(m); return m; };
      const bodyIM = mk(torso, '#ffffff', n), legIM = mk(legs, '#1d2230', n), headIM = mk(head, '#c99a74', n), camIM = mk(cam, '#111317', ph.length);
      const vest = new THREE.Color('#f2c400'), photoC = new THREE.Color('#2c3442');
      const place = (im, i, x, y, z, ry) => { Q.setFromAxisAngle(Y, ry); M4.compose(new THREE.Vector3(x, y, z), Q, new THREE.Vector3(1, 1, 1)); im.setMatrixAt(i, M4); };
      ph.forEach(([x, z, sx], i) => {
        const ry = sx > 0 ? Math.PI : 0;   // tournés vers le terrain
        place(legIM, i, x, 0.22, z, ry); place(bodyIM, i, x, 0.72, z, ry); place(headIM, i, x, 1.14, z, ry);
        place(camIM, i, x - sx * 0.3, 1.08, z, ry);
        bodyIM.setColorAt(i, photoC);
      });
      st.forEach(([x, z, ry], j) => {
        const i = ph.length + j;
        place(legIM, i, x, 0.4, z, ry); place(bodyIM, i, x, 1.1, z, ry); place(headIM, i, x, 1.55, z, ry);
        bodyIM.setColorAt(i, vest);
      });
      for (const im of [bodyIM, legIM, headIM, camIM]) { im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true; }
    }
    // Tribunes : vraie enceinte à deux étages (gradins en marches, sièges, spectateurs 3D).
    const ledMat = new THREE.MeshBasicMaterial({ map: boardsTexture([h.short || h.name, a.short || a.name], [h.color, h.color2]), color: '#ffffff', toneMapped: false });
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
      // Zone technique : rectangle peint devant le banc (l'entraîneur ne doit pas en sortir).
      const lineM = new THREE.MeshBasicMaterial({ color: '#e9eef2' });
      for (const [w2, d2, x2, z2] of [[9, 0.08, 0, 1.0], [9, 0.08, 0, 3.6], [0.08, 2.6, -4.5, 2.3], [0.08, 2.6, 4.5, 2.3]]) {
        const ln = new THREE.Mesh(new THREE.PlaneGeometry(w2, d2), lineM);
        ln.rotation.x = -Math.PI / 2; ln.position.set(sx + x2, 0.012, W / 2 + z2); s.add(ln);
      }
    }
    // Tunnel des joueurs entre les deux bancs : couloir couvert (aux couleurs du club qui reçoit)
    // qui sort de la tribune, bouche sombre côté terrain.
    {
      const tg = new THREE.Group();
      const shell = new THREE.Mesh(new THREE.CylinderGeometry(1.45, 1.45, 4.2, 18, 1, true, -Math.PI / 2, Math.PI), new THREE.MeshStandardMaterial({ color: h.color || '#20263a', roughness: 0.55, side: THREE.DoubleSide }));
      shell.rotation.x = -Math.PI / 2; tg.add(shell);   // demi-cylindre couché, ouvert vers le bas
      const ribM = new THREE.MeshStandardMaterial({ color: h.color2 || '#ffffff', roughness: 0.5 });
      for (const z of [-2.05, 0, 2.05]) { const rib = new THREE.Mesh(new THREE.TorusGeometry(1.47, 0.06, 6, 18, Math.PI), ribM); rib.position.z = z; tg.add(rib); }
      const mouth = new THREE.Mesh(new THREE.CircleGeometry(1.44, 18, 0, Math.PI), new THREE.MeshBasicMaterial({ color: '#07080c' }));
      mouth.position.z = -1.9; mouth.rotation.y = Math.PI; tg.add(mouth);   // bouche tournée vers le terrain
      tg.position.set(0, 0, W / 2 + 8.6); s.add(tg);
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
      // Filets maillés (géométrie subdivisée) : ils se déforment sous le ballon puis ondulent.
      const netMesh = (w, hh, sx, sy, out) => {
        const m = new THREE.Mesh(new THREE.PlaneGeometry(w, hh, sx, sy), netM);
        m.userData.net = { w, h: hh, out, amp: 0, vel: 0, cx: 0, cy: 0, base: Float32Array.from(m.geometry.attributes.position.array) };
        (this.nets ||= []).push(m);
        return m;
      };
      const back = netMesh(gw, gh, 28, 10, sgn); back.rotation.y = Math.PI / 2; back.position.set(x + sgn * gd, gh / 2, 0); g.add(back);
      const top = netMesh(gd, gw, 8, 28, 1); top.rotation.x = -Math.PI / 2; top.position.set(x + sgn * gd / 2, gh, 0); g.add(top);
      for (const z of [-gw / 2, gw / 2]) { const sd = netMesh(gd, gh, 8, 10, Math.sign(z)); sd.position.set(x + sgn * gd / 2, gh / 2, z); g.add(sd); }
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
    const SP = coarse ? 0.95 : 0.66;                 // espacement des sièges (m)
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
    const others = ['#e8e8e8', '#20242c', '#5d6b85', '#8b2d2d', '#2f5d3a', '#c9b38a', '#3b5998', '#b0b7c3', '#f2e8d5', '#7a5c3e', '#4a4f57', '#d9822b', '#6d8fb3', '#9a3b55'].map((c) => new THREE.Color(c));
    const cH = new THREE.Color(h.color), cH2 = new THREE.Color(h.color2 || '#ffffff');
    let cA = new THREE.Color(a.color), cA2 = new THREE.Color(a.color2 || '#ffffff');
    const cdist = (x, y) => Math.abs(x.r - y.r) + Math.abs(x.g - y.g) + Math.abs(x.b - y.b);
    if (cdist(cA, cH) < 0.35 && cdist(cA2, cH) > 0.35) [cA, cA2] = [cA2, cA]; // parcage lisible même si les couleurs se ressemblent
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    // Buste + deux bras (le long du corps ; ils se lèvent sur un but, pendant la ola).
    const bodyG = mergeBoxes([[0.44, 0.62, 0.3, 0, 0.55, 0.05], [0.09, 0.44, 0.1, -0.27, 0.6, 0.05], [0.09, 0.44, 0.1, 0.27, 0.6, 0.05]]);
    const headG = new THREE.BoxGeometry(0.22, 0.24, 0.22); headG.translate(0, 1.0, 0.05);
    // Siège = assise + dossier dans une seule géométrie (un seul appel de dessin).
    const seatG = mergeBoxes([[0.46, 0.1, 0.4, 0, 0.38, 0.05], [0.46, 0.42, 0.06, 0, 0.6, 0.27]]);
    const white = new THREE.MeshLambertMaterial({ color: '#ffffff' });
    // Supporters animés UN PAR UN sur la carte graphique (aucun coût pour le processeur) :
    // léger balancement, à moitié levés sur un temps fort, bonds décalés et bras levés sur un
    // but de LEUR équipe (le parcage visiteur ne saute que sur les buts des visiteurs).
    const U = this.crowdU = { uTime: { value: 0 }, uH: { value: 0 }, uA: { value: 0 }, uT: { value: 0 }, uWave: { value: 0 }, uO: { value: 0 }, uC: { value: 0 } };
    const crowdMat = (head) => {
      const m = new THREE.MeshLambertMaterial({ color: '#ffffff' });
      m.onBeforeCompile = (sh) => {
        Object.assign(sh.uniforms, U);
        sh.vertexShader = sh.vertexShader.replace('#include <common>', `#include <common>
          uniform float uTime, uH, uA, uT, uWave, uO, uC; attribute float aAway;`)
          .replace('#include <begin_vertex>', `#include <begin_vertex>
          #ifdef USE_INSTANCING
            vec3 ip = instanceMatrix[3].xyz;
            float ph = fract(sin(dot(ip.xz, vec2(12.9898, 78.233))) * 43758.5453) * 6.2831;
            float joy = mix(uH, uA, aAway);
            float jump = joy * max(0.0, sin(uTime * (7.0 + fract(ph) * 3.0) + ph)) * 0.34;
            transformed.y += jump + uT * 0.07 * (0.6 + 0.4 * sin(ph)) + 0.025 * sin(uTime * 1.3 + ph);
            // Ola : une vague qui fait le tour du stade (angle autour du centre).
            vec4 wp = modelMatrix * vec4(ip, 1.0);
            float wave = uWave * smoothstep(0.82, 1.0, sin(atan(wp.z, wp.x) * 1.0 - uTime * 2.2));
            transformed.y += wave * 0.42;
            // « Ooh ! » sur une occasion manquée : tout le stade se lève, mains sur la tête.
            // Applaudissements : debout, bras devant qui battent la mesure (chacun son rythme).
            float clapB = 0.5 + 0.5 * sin(uTime * (13.0 + fract(ph * 3.1) * 4.0) + ph * 2.0);
            transformed.y += (uO + uC * 0.7) * 0.09 * (0.7 + 0.3 * fract(ph * 1.7));
            ${head ? '' : `if (abs(position.x) > 0.22) { transformed.y += uO * 0.36 + uC * 0.2; transformed.x *= 1.0 - uO * 0.25 - uC * (0.25 + 0.3 * clapB); transformed.z -= uC * 0.12; }
            if (abs(position.x) > 0.22) transformed.y += max(joy, wave) * (0.5 + 0.08 * sin(uTime * 9.0 + ph));   // bras levés
            else if (position.y > 0.7) transformed.y += joy * (0.18 + 0.1 * sin(uTime * 9.0 + ph));`}
          #endif`);
      };
      return m;
    };
    const crowdBodyMat = crowdMat(false), crowdHeadMat = crowdMat(true);
    // Bandeau du premier rang : même LED, séquence décalée (pas de doublon avec les panneaux).
    const ribbonMat = ledMat.clone(); ribbonMat.map = ledMat.map.clone(); ribbonMat.map.offset.x = 0.41; ribbonMat.map.needsUpdate = true;
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
      // Bandeau LED sur le muret du premier rang (face au terrain).
      const ribbon = new THREE.Mesh(new THREE.PlaneGeometry(len, 0.95), ribbonMat); ribbon.position.set(0, 0.72, dist - 0.62); ribbon.rotation.y = Math.PI; g.add(ribbon);
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
      const awayAttr = new THREE.InstancedBufferAttribute(new Float32Array(fans.map((sl) => (inAway(sl[0], sl[3]) ? 1 : 0))), 1);
      const bG = bodyG.clone(), hG = headG.clone();
      bG.setAttribute('aAway', awayAttr); hG.setAttribute('aAway', awayAttr);
      const bodies = new THREE.InstancedMesh(bG, crowdBodyMat, fans.length), heads = new THREE.InstancedMesh(hG, crowdHeadMat, fans.length);
      const M = new THREE.Matrix4();
      empty.forEach(([x, yy, zz], i) => {
        M.makeTranslation(x, yy, zz); seats.setMatrixAt(i, M);
        seats.setColorAt(i, i >= empty.length - buffer.length ? tarp : (Math.floor((x + len / 2) / 3) + Math.round(yy)) % 7 === 0 ? seatCol2 : seatCol);
      });
      fans.forEach((sl, i) => {
        const [x, yy, zz] = sl;
        const stand = rnd() < (inAway(x, sl[3]) ? 0.7 : 0.18) ? 0.12 : 0; // quelques supporters debout (tout le parcage)
        // Silhouettes variées (gabarit, léger décalage) : la foule ne fait pas « grille ».
        const sc = 0.88 + rnd() * 0.26, jx = (rnd() - 0.5) * 0.12, jz = (rnd() - 0.5) * 0.1;
        M.makeScale(0.9 + rnd() * 0.2, sc, 1).setPosition(x + jx, yy + stand, zz - 0.02 + jz); bodies.setMatrixAt(i, M); heads.setMatrixAt(i, M);
        const away = inAway(x, sl[3]);
        const r = rnd();
        const col = away ? (r < 0.8 ? cA : r < 0.93 ? cA2 : others[(rnd() * others.length) | 0])
          : r < (opts.ultras ? 0.8 : 0.42) ? cH : r < (opts.ultras ? 0.92 : 0.58) ? cH2 : others[(rnd() * others.length) | 0];
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
        // Tifo géant (grands matchs) : une mosaïque qui recouvre le premier étage du virage.
        {
          const t0 = rowsPos.filter((r) => r.tier === 0), a0 = t0[0], a1 = t0[t0.length - 1];
          if (a0 && a1) {
            const ww = len * 0.86, hh = Math.hypot(a1.z - a0.z, a1.y - a0.y) + 1.2;
            const cv = canvasTex(1024, Math.round(1024 * hh / ww), (gg, w2, h2) => {
              const c1 = h.color || '#c00', c2 = h.color2 || '#fff';
              gg.fillStyle = c1; gg.fillRect(0, 0, w2, h2);
              gg.fillStyle = c2; for (let x = -h2; x < w2; x += 90) { gg.beginPath(); gg.moveTo(x, h2); gg.lineTo(x + 40, h2); gg.lineTo(x + 40 + h2, 0); gg.lineTo(x + h2, 0); gg.fill(); }
              gg.fillStyle = c1; gg.fillRect(w2 * 0.12, h2 * 0.18, w2 * 0.76, h2 * 0.64);
              gg.strokeStyle = c2; gg.lineWidth = 10; gg.strokeRect(w2 * 0.12, h2 * 0.18, w2 * 0.76, h2 * 0.64);
              gg.fillStyle = c2; gg.textAlign = 'center'; gg.textBaseline = 'middle';
              const nm = (h.short || h.name || '').toUpperCase();
              gg.font = `900 ${Math.round(h2 * 0.36)}px system-ui, sans-serif`; gg.fillText(nm, w2 / 2, h2 * 0.44, w2 * 0.7);
              gg.font = `800 ${Math.round(h2 * 0.12)}px system-ui, sans-serif`; gg.fillText('★ ENSEMBLE JUSQU\'AU BOUT ★', w2 / 2, h2 * 0.7, w2 * 0.7);
              // grain des cartons brandis
              for (let k = 0; k < 2500; k++) { gg.fillStyle = `rgba(0,0,0,${Math.random() * 0.12})`; gg.fillRect(Math.random() * w2, Math.random() * h2, 6, 5); }
            });
            const geo = new THREE.PlaneGeometry(ww, hh); geo.translate(0, hh / 2, 0); geo.scale(-1, 1, 1);
            const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: cv, color: '#d8d8d8', transparent: true, side: THREE.DoubleSide }));
            const ang = Math.atan2(a1.y - a0.y, a1.z - a0.z);
            mesh.rotation.x = Math.PI / 2 - ang;   // face au terrain (vu de dos : géométrie miroir)
            const y0 = a0.y + 1.25;
            mesh.position.set(0, y0, a0.z - 0.4); mesh.visible = false;
            g.add(mesh);
            this.bigTifo = { mesh, k: 0, y0 };
          }
        }
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
      // Ombres : le toit et la façade ombragent les gradins (et les spectateurs) au soleil.
      g.traverse((o) => { if (o.isMesh) o.receiveShadow = true; });
      for (const o of g.children) if (o.isMesh && (o.material === roofUnder || o.material === concreteD || o.material === steel)) o.castShadow = true;
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
    // Tribune côté caméra (latérale principale, sous la passerelle des caméras télé) : la caméra
    // peut tourner partout sans jamais montrer de vide. Un seul étage, sans toit devant les caméras.
    stand(mainLen, 0, W / 2 + 9, { fill: 0.9, tiers: tiersOf([[14, 0.44]]), roof: 'none' });
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
    if (this.rim) { this.rim.intensity = night ? 0.95 : grey ? 0.35 : 0.55; this.rim.color.set(night ? '#cfe0ff' : '#d6e4ff'); } // projecteurs : contre-jour plus franc la nuit
    if (!night) { this.sun.intensity = grey ? 0.9 : 2.6; this.sun.color.set(grey ? '#e6ebf2' : '#fff1d6'); this.hemi.intensity = grey ? 1.0 : 0.62; if (!grey) this.renderer.toneMappingExposure = 1.0; for (const g of this.glows || []) g.visible = false; }
    // Plein soleil : la tribune derrière la caméra (retirée de l'image, comme à la télé) projette
    // sa grande ombre sur la moitié du terrain ; le soleil vient de derrière elle, un peu de côté.
    if (!night && !grey && this.renderer.shadowMap.enabled) {
      this.sun.position.set(-62, 50, 66);
      Object.assign(this.sun.shadow.camera, { left: -110, right: 110, top: 95, bottom: -95, near: 10, far: 300 });
      this.sun.shadow.camera.updateProjectionMatrix();
      this.sun.shadow.bias = -0.0004;
      const ghostM = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false });
      const ghost = new THREE.Group();
      const body = new THREE.Mesh(new THREE.BoxGeometry(L + 40, 24, 18), ghostM); body.position.set(0, 12, W / 2 + 22);
      const roof = new THREE.Mesh(new THREE.BoxGeometry(L + 40, 1.2, 16), ghostM); roof.position.set(0, 29, W / 2 + 15);
      for (const m of [body, roof]) { m.castShadow = true; ghost.add(m); }
      ghost.rotation.y = 0.1; ghost.position.x = 6; // tribune légèrement en biais : ombre en diagonale
      this.scene.add(ghost);
    }
    else { this.sun.intensity = 1.1; this.hemi.intensity = 1.05; }
    if (['rain', 'storm', 'snow'].includes(w.kind) && this.pitchMat) this.pitchMat.color.set(w.kind === 'snow' ? '#f2f6f8' : '#c4cec6'); // pelouse détrempée / poudrée
    // Pluie : flaques luisantes là où la pelouse souffre (surfaces de but, rond central, couloirs),
    // et gerbes d'eau quand le ballon file au sol ou qu'un joueur glisse.
    if (['rain', 'storm'].includes(w.kind)) {
      const pm = new THREE.MeshPhongMaterial({ color: '#3d5448', shininess: 120, specular: '#c8d8e8', transparent: true, opacity: w.kind === 'storm' ? 0.4 : 0.3, depthWrite: false });
      let sd = 17; const r = () => ((sd = (sd * 16807) % 2147483647) / 2147483647);
      const spots = [[-L / 2 + 4, 0, 5], [L / 2 - 4, 0, 5], [-L / 2 + 11, 0, 2.5], [L / 2 - 11, 0, 2.5], [0, 0, 3]];
      for (let i = 0; i < (w.kind === 'storm' ? 16 : 10); i++) spots.push([(r() - 0.5) * (L - 10), (r() - 0.5) * (W - 8), 1 + r() * 2.2]);
      for (const [x, z, rad] of spots) {
        const pd = new THREE.Mesh(new THREE.CircleGeometry(rad, 20), pm);
        pd.rotation.x = -Math.PI / 2; pd.position.set(x + (r() - 0.5) * 2, 0.012, z + (r() - 0.5) * 3); pd.scale.set(1, 0.55 + r() * 0.6, 1); pd.renderOrder = 1;
        this.scene.add(pd);
      }
      const N = 260, geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3).fill(-50), 3));
      this.spray = new THREE.Points(geo, new THREE.PointsMaterial({ color: '#e8f0f6', size: 0.09, transparent: true, opacity: 0.75, depthWrite: false }));
      this.spray.userData = { v: new Float32Array(N * 3), life: new Float32Array(N), next: 0 };
      this.scene.add(this.spray);
    }
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

  /**
   * Filets : là où le ballon pousse, le filet suit exactement (poche autour du ballon) ; quand il
   * le relâche, la poche revient comme un ressort amorti et le filet ondule un instant.
   */
  stepNets(dt) {
    if (!this.nets || !this.ball) return;
    const bw = this.ball.position, tmp = this._netV ||= new THREE.Vector3();
    for (const m of this.nets) {
      const N = m.userData.net;
      tmp.copy(bw); m.worldToLocal(tmp);
      // Seulement quand le ballon est réellement DANS la cage (entré entre les poteaux) : un ballon
      // qui passe à côté du filet latéral ou au-dessus de la barre ne le fait pas bouger.
      const inCage = !!this.v.phys?.inGoal && Math.sign(bw.x) === Math.sign(m.parent.children[0].position.x || 1);
      const inside = inCage && Math.abs(tmp.x) < N.w / 2 + 0.2 && Math.abs(tmp.y) < N.h / 2 + 0.2;
      const pen0 = inside ? tmp.z * N.out + BALL_R + 0.02 : 0;   // le ballon pousse au-delà du plan du filet
      const pen = pen0 > 1.3 ? 0 : pen0;
      if (pen > 0.005) { N.amp = Math.max(N.amp, pen); N.vel = 0; N.cx = tmp.x; N.cy = tmp.y; N.hold = 0.08; }
      else {
        if ((N.hold -= dt) > 0) continue;
        if (Math.abs(N.amp) < 0.003 && Math.abs(N.vel) < 0.01) { if (N.amp !== 0) { N.amp = 0; N.vel = 0; this.netShape(m, 0); } continue; }
        const a = -140 * N.amp - 5 * N.vel;
        N.vel += a * dt; N.amp += N.vel * dt;
      }
      this.netShape(m, N.amp);
    }
  }

  netShape(m, amp) {
    const N = m.userData.net, pos = m.geometry.attributes.position, arr = pos.array, b = N.base;
    const sig2 = 2 * (0.45 + Math.abs(amp) * 0.6) ** 2;
    for (let i = 0; i < arr.length; i += 3) {
      const dx = b[i] - N.cx, dy = b[i + 1] - N.cy;
      // Bords du filet tenus par les montants : pas de déplacement au bord.
      const ex = 1 - (2 * Math.abs(b[i]) / N.w) ** 6, ey = 1 - (2 * Math.abs(b[i + 1]) / N.h) ** 6;
      arr[i + 2] = b[i + 2] + N.out * amp * Math.exp(-(dx * dx + dy * dy) / sig2) * Math.max(0, ex) * Math.max(0, ey);
    }
    pos.needsUpdate = true;
  }

  /**
   * Diagnostic physique (si actif) : zones d'atteinte du pied des joueurs proches du ballon
   * (cercle = toucher propre, cercle extérieur = en s'étirant), trajectoire prédite du ballon,
   * points d'interception prévus (✕ jaune), contacts réels des 3 dernières secondes
   * (vert = physiquement possible, rouge = impossible). Données : engine/diag.js + contact.js.
   */
  drawDiag() {
    const D = this.v.live?.diag;
    if (!D) { if (this._diagG) this._diagG.visible = false; return; }
    if (!this._diagG) {
      this._diagG = new THREE.Group(); this.scene.add(this._diagG);
      this._diagMat = {
        ring: new THREE.MeshBasicMaterial({ color: '#7fd1ff', transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide }),
        ring2: new THREE.MeshBasicMaterial({ color: '#7fd1ff', transparent: true, opacity: 0.2, depthWrite: false, side: THREE.DoubleSide }),
        path: new THREE.LineBasicMaterial({ color: '#9ad0ff' }), plan: new THREE.LineBasicMaterial({ color: '#ffd166' }),
        ok: new THREE.MeshBasicMaterial({ color: '#3ddc84', transparent: true, opacity: 0.7 }), bad: new THREE.MeshBasicMaterial({ color: '#ef476f', transparent: true, opacity: 0.7 }),
        gkHand: new THREE.MeshBasicMaterial({ color: '#c77dff', transparent: true, opacity: 0.55, depthWrite: false }), gkCross: new THREE.MeshBasicMaterial({ color: '#c77dff', transparent: true, opacity: 0.9 }),
        aim: new THREE.LineBasicMaterial({ color: '#ffffff' }), exec: new THREE.LineBasicMaterial({ color: '#ff9f1c' }), cut: new THREE.LineBasicMaterial({ color: '#ef476f' }),
      };
    }
    const G = this._diagG; G.visible = true;
    while (G.children.length) { const c = G.children.pop(); c.geometry?.dispose?.(); }
    const M = this._diagMat, now = this.v.live.now, P = this.v.phys;
    const W3 = (x, y) => this.toWorld(x / L, y / W);
    // Zones d'atteinte du pied (contact.js : PARTS.foot) des joueurs à moins de 12 m du ballon.
    for (const p of this.v.players.values()) {
      const px = p.x * L, py = p.y * W;
      if (!P || Math.hypot(px - P.x, py - P.y) > 12) continue;
      const cx = px + Math.cos(p.face || 0) * 0.32, cy = py + Math.sin(p.face || 0) * 0.32;
      const [wx, wz] = W3(cx, cy);
      for (const [r0, r1, mat] of [[0.36, 0.38 + 0.11, M.ring], [0.78, 0.8 + 0.11, M.ring2]]) {
        const ring = new THREE.Mesh(new THREE.RingGeometry(r0, r1, 32), mat);
        ring.rotation.x = -Math.PI / 2; ring.position.set(wx, 0.03, wz); G.add(ring);
      }
    }
    // Intentions (étape 5d) : trait du joueur vers sa cible de déplacement, couleur = priorité de
    // l'intention retenue par l'arbitre (blanc P1 placement · bleu P2 soutien · vert P3 mission ·
    // orange P4 urgence · rouge P5 ballon · violet geste en cours P6), petit losange sur la cible.
    {
      const PRI_COL = { 1: [0.92, 0.92, 0.92], 2: [0.3, 0.6, 1], 3: [0.24, 0.86, 0.52], 4: [1, 0.62, 0.1], 5: [0.94, 0.28, 0.44], 6: [0.78, 0.49, 1] };
      const pos = [], col = [];
      for (const p of this.v.players.values()) {
        if (p.tx == null) continue;
        const pri = p._dive || p._tk || p.slide > 0.2 || p.fall > 0.3 ? 6 : p._intent?.pri || 1;
        const c = PRI_COL[pri];
        const [ax, az] = W3(p.x * L, p.y * W), [bx, bz] = W3(p.tx * L, p.ty * W), s = 0.25;
        pos.push(ax, 0.04, az, bx, 0.04, bz, bx - s, 0.04, bz, bx, 0.04, bz - s, bx, 0.04, bz - s, bx + s, 0.04, bz, bx + s, 0.04, bz, bx, 0.04, bz + s, bx, 0.04, bz + s, bx - s, 0.04, bz);
        for (let i = 0; i < 10; i++) col.push(...c);
      }
      if (pos.length) {
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
        G.add(new THREE.LineSegments(g, M.intent ||= new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.85 })));
      }
    }
    // Dernière trajectoire prédite.
    const path = D.paths[D.paths.length - 1];
    if (path && now - path.t < 4) {
      const pts = path.pts.map((q) => { const [x, z] = W3(q.x, q.y); return new THREE.Vector3(x, Math.max(0.05, q.z), z); });
      G.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), M.path));
    }
    for (const pl of D.plans) {
      if (now - pl.t > 3) continue;
      const [x, z] = W3(pl.x, pl.y), s = 0.45;
      // ✕ jaune : point de réception prévu ; ✕ rouge : point de coupe prévu par un défenseur.
      G.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(x - s, 0.05, z - s), new THREE.Vector3(x + s, 0.05, z + s), new THREE.Vector3(x - s, 0.05, z + s), new THREE.Vector3(x + s, 0.05, z - s)]), pl.cut ? M.cut : M.plan));
    }
    // Gardien (étape 4d) : point de passage anticipé sur la ligne (losange violet) et, pendant un
    // plongeon, la zone de ses mains (sphère violette, rayon réel de prise).
    const LV = this.v.live;
    if (LV) for (const g of LV.players.values()) {
      if (!g.gk) continue;
      const th = g._threat;
      if (th) { const own = g.side === 0 ? 0 : L; const [x, z] = W3(own, th.y); const m = new THREE.Mesh(new THREE.OctahedronGeometry(0.18), M.gkCross); m.position.set(x, Math.max(0.15, th.z), z); G.add(m); }
      if (g._dive) {
        const d = g._dive, t = LV.now - d.t0, f = Math.min(1, Math.max(0, (t - 0.1) / 0.4)), ff = f * f * (3 - 2 * f), arm = 0.95 * Math.min(1, 0.45 + t / 0.22);
        const hx = d.x0 + d.ux * (d.S * ff + arm), hy = d.y0 + d.uy * (d.S * ff + arm), hz = 0.9 + (d.h - 0.9) * Math.min(1, 0.25 + ff * 1.3);
        const [x, z] = W3(hx, hy); const m = new THREE.Mesh(new THREE.SphereGeometry(0.3 + 0.11, 12, 10), M.gkHand); m.position.set(x, hz, z); G.add(m);
      }
    }
    // Dernière passe : trait blanc = direction voulue (cible), trait orange = frappe réelle
    // (après l'erreur d'exécution au contact).
    const ps = D.passes?.[D.passes.length - 1];
    if (ps && now - ps.t < 3) {
      const [fx, fz] = W3(ps.from.x, ps.from.y), [ax, az] = W3(ps.aim.x, ps.aim.y), [ex, ez] = W3(ps.exec.x, ps.exec.y);
      G.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(fx, 0.06, fz), new THREE.Vector3(ax, 0.06, az)]), M.aim));
      G.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(fx, 0.08, fz), new THREE.Vector3(ex, 0.08, ez)]), M.exec));
    }
    for (const c of D.contacts) {
      if (now - c.t > 3) continue;
      const [x, z] = W3(c.x, c.y);
      const m = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), c.physical ? M.ok : M.bad);
      m.position.set(x, Math.max(0.16, c.z), z); G.add(m);
    }
  }

  /** Gerbes d'eau sur pelouse détrempée (ballon rapide au sol, joueurs qui glissent). */
  stepSpray(dt) {
    const S = this.spray;
    if (!S) return;
    const a = S.geometry.attributes.position, arr = a.array, U = S.userData, N = U.life.length;
    const emit = (x, y, z, n, spd) => {
      for (let k = 0; k < n; k++) {
        const i = U.next; U.next = (U.next + 1) % N;
        arr[i * 3] = x; arr[i * 3 + 1] = y; arr[i * 3 + 2] = z;
        const an = Math.random() * Math.PI * 2;
        U.v[i * 3] = Math.cos(an) * spd * (0.4 + Math.random()); U.v[i * 3 + 1] = 1.2 + Math.random() * 1.8; U.v[i * 3 + 2] = Math.sin(an) * spd * (0.4 + Math.random());
        U.life[i] = 0.35 + Math.random() * 0.3;
      }
    };
    const b = this.ball?.position, P = this.v.phys;
    if (b && P && P.z < 0.3 && Math.hypot(P.vx, P.vy) > 5 && Math.random() < 0.7) emit(b.x, 0.05, b.z, 2, 1.1);
    for (const [id, e] of this.players) { const p = this.v.players.get(id); if (p && (p.slide > 0 || (p.speed || 0) > 7) && Math.random() < (p.slide > 0 ? 0.9 : 0.08)) { const q = e.p3.root.position; emit(q.x, 0.05, q.z, p.slide > 0 ? 3 : 1, p.slide > 0 ? 1.6 : 0.8); } }
    for (let i = 0; i < N; i++) {
      if (U.life[i] <= 0) { if (arr[i * 3 + 1] > -40) arr[i * 3 + 1] = -50; continue; }
      U.life[i] -= dt; U.v[i * 3 + 1] -= 9.8 * dt;
      arr[i * 3] += U.v[i * 3] * dt; arr[i * 3 + 1] = Math.max(0.01, arr[i * 3 + 1] + U.v[i * 3 + 1] * dt); arr[i * 3 + 2] += U.v[i * 3 + 2] * dt;
    }
    a.needsUpdate = true;
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
    this.ballShadow = new THREE.Mesh(new THREE.CircleGeometry(BALL_R * 1.5, 16), contactShadowMat(0.55));
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
    if (this.composer) { this.composer.setPixelRatio(dpr); this.composer.setSize(v.cssW, v.cssH); }
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
  /** Tissu d'un joueur : vitesse (flottement, traîne) et tirage de maillot par l'adversaire collé à lui. */
  updateCloth(c, p, grab, dt) {
    const sp = Math.min(8, p.speed || 0) / 5;
    c.shirt.uSpeed.value += (sp - c.shirt.uSpeed.value) * Math.min(1, dt * 4);
    c.shorts.uSpeed.value = c.shirt.uSpeed.value;
    if (grab) c.side = grab;
    const t = performance.now() / 1000;
    const want = grab ? 0.1 * (0.75 + 0.25 * Math.sin(t * 9 + (p.id ?? 0))) : 0;
    c.pull += (want - c.pull) * Math.min(1, dt * (grab ? 6 : 3));
    c.shirt.uPullAmt.value = c.pull;
    if (c.pull > 0.001) {
      c.shirt.uPullPos.value.set(-0.11, 1.13, c.side * 0.13);
      c.shirt.uPullDir.value.set(-0.55, -0.12, c.side * 0.83).normalize();
    }
  }

  syncPlayers() {
    const v = this.v;
    const seen = new Set();
    for (const [id, p] of v.players) {
      seen.add(id);
      let e = this.players.get(id);
      if (!e) {
        const side = p.side;
        const base = this.mats[side];
        const mats = p.gk ? { ...base, shirt: base.gk, sleeve: base.gkSleeve, socks: base.gk } : base;
        const shirtHex = p.gk ? v.gkColors[side] : v.colors[side];
        const ink = p.gk ? '#111' : v.textColors[side];
        // Apparence réaliste : teint et cheveux selon la nationalité (stables), coiffure, crampons, gants.
        const lk = personLook(id, p.mp?.p?.nat || '', p.mp?.p?.age || 25);
        const bootC = ['#111111', '#111111', '#f2f2f2', '#d7263d', '#2d7ff9', '#e8ff3a', '#ff8c1a'][id % 7];
        const boot = bootMat(bootC);
        const p3 = new Player3D({ ...mats, boot }, lk.skin, lk.hairColor, p.num, shirtHex, ink, p.mp?.p?.photo || null, { look: lk, name: p.mp?.p?.last || p.short || '', gk: !!p.gk });
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
        // Corps réaliste (gros plans) : mêmes os que le modèle simplifié.
        const eyeC = new THREE.Color(lk.eyes || '#2a1a10'), eyeTex = eyeC.b > eyeC.r * 1.15 ? 'blue' : eyeC.g > eyeC.r * 1.1 ? 'green' : (eyeC.r + eyeC.g + eyeC.b) > 1.2 ? 'grey' : 'brown';
        // Gabarit propre à chaque joueur (poids/taille réels) : plus costaud ou plus sec.
        const heavy = Math.max(0, Math.min(1, (girth - 1) / 0.16)), slim = Math.max(0, Math.min(1, (1 - girth) / 0.12));
        // Maillot détaillé propre au joueur (nom et numéro imprimés dans le dos, écusson, sponsor).
        const club = v.m.teams[side]?.club;
        const home = club?.colors && String(club.colors[0]).toLowerCase() === String(v.colors[side]).toLowerCase();
        const kit = p.gk ? { c1: v.gkColors[side], c2: '#111111', ink: '#111111', pattern: 'plain' }
          : { c1: v.colors[side], c2: home && club.colors[1] ? club.colors[1] : v.textColors[side], ink: v.textColors[side], pattern: home ? kitPattern(club) : 'plain' };
        const hi = this.gfx === 'ultra';
        const kitBase = { ...kit, sponsor: sponsorOf(club), crest: club?.short || '', hi };
        const shirtM = clothMaterial({ color: '#ffffff', map: proKitTexture({ ...kitBase, num: p.num ?? '', name: p.mp?.p?.last || p.short || '' }) }, 'shirt', hi);
        const shC = p.gk ? '#20242c' : v.shorts[side];
        const shortsM = clothMaterial({ color: '#ffffff', map: proShortsTexture(shC, shC.toLowerCase() === String(v.textColors[side]).toLowerCase() ? v.colors[side] : v.textColors[side], p.num ?? '', hi) }, 'shorts', hi);
        e.cloth = { shirt: shirtM.userData.cloth, shorts: shortsM.userData.cloth, pull: 0, side: 1 };
        const sockC = p.gk ? v.gkColors[side] : v.colors[side];
        const socksM = new THREE.MeshStandardMaterial({ color: '#ffffff', map: proSocksTexture(sockC, p.gk ? '#111111' : kit.c2), roughness: 0.85 });
        const sleeveM = (this._sleeveM ||= new Map()).get(JSON.stringify(kit)) || new THREE.MeshStandardMaterial({ color: '#ffffff', map: proKitTexture({ ...kitBase, sleeve: true }), roughness: 0.76 });
        this._sleeveM.set(JSON.stringify(kit), sleeveM);
        e.mhOpts = { skin: lk.skin, hair: lk.hairColor, hairStyle: lk.hairStyle, beard: lk.beard, eyeTex, nat: p.mp?.p?.nat || '', mats: { ...mats, boot, shirt: shirtM, sleeve: sleeveM, shorts: shortsM, socks: socksM }, gk: !!p.gk, heavy, slim, printed: true };
        if (this.mh) e.p3.attachMH(this.mh, e.mhOpts);
        this.players.set(id, e);
      }
    }
    for (const [id, e] of this.players) if (!seen.has(id)) { this.scene.remove(e.p3.root); this.players.delete(id); }
  }

  cycleCamera() {
    const order = ['tv', 'director', 'close', 'pitchside', 'player', 'tribune', 'high', 'goal'];
    this.camMode = order[(order.indexOf(this.camMode) + 1) % order.length];
    return { tv: 'Caméra télé', director: 'Réalisation TV (plans automatiques)', close: 'Caméra rapprochée', pitchside: 'Bord du terrain', player: 'Derrière le porteur', tribune: 'Panoramique (haut de tribune)', high: 'Vue tactique', goal: 'Derrière le but' }[this.camMode];
  }

  /**
   * Sonde de contact VISUEL (étape 6b, outil de mesure) : pour chaque geste migré dont le contact a eu
   * lieu dans [tFrom, tTo], rejoue l'affichage pas à pas (1/96 s) autour du contact avec le même calcul
   * de pose que le rendu (pose + lissage), et mesure la distance entre la partie du corps qui touche
   * (pied de frappe / de touche ; pied, genou, poitrine ou tête pour un contrôle) et la surface du ballon.
   * Renvoie, par geste : distance minimale, instant de ce minimum − instant du contact physique, distance au contact.
   */
  /**
   * Sonde des gestes aériens (étape 6c-A) : saut de tête, tête, saut des joueurs de champ (le saut du
   * gardien, partie « mains », relève de 6c-B). Chaque geste dont l'instant de référence (contact, sinon
   * contact prévu, sinon calage du moteur) est dans [tFrom, tTo] est rejoué pas à pas comme à l'écran.
   * Avec contact : distance de la partie du corps du contact à la surface du ballon (au pas du contact,
   * à ± une image), instant du sommet du saut et du coup de tête. Sans contact : distance minimale de
   * TOUT le corps (front, poitrine, mains, genoux, pieds) au ballon pendant le geste — faux contact
   * visuel si elle est sous 1 cm.
   */
  /**
   * Cinématique inverse d'un bras (6c-B, rendu seulement) : épaule (2 axes) et coude amènent le centre de la
   * main sur T. Descente par coordonnées, bornes articulaires ; renvoie la distance résiduelle (m).
   */
  armSolve(arm, T) {
    const V = (this._asV ||= new THREE.Vector3()), r = arm.sh.rotation, el = arm.el.rotation;
    const f = () => { arm.sh.updateMatrixWorld(true); return arm.hand.getWorldPosition(V).distanceTo(T); };
    const lim = [[-3.3, 3.3], [-1.2, 3.2], [0, 2.5]], get = [() => r.x, () => r.z, () => el.z], set = [(x) => (r.x = x), (x) => (r.z = x), (x) => (el.z = x)];
    let best = f();
    for (const st of [0.5, 0.25, 0.12, 0.06, 0.03, 0.015, 0.008]) {
      for (let pass = 0; pass < 2; pass++) for (let i = 0; i < 3; i++) {
        const x0 = get[i]();
        for (const sg of [1, -1]) { const x = Math.max(lim[i][0], Math.min(lim[i][1], x0 + sg * st)); if (x === x0) continue; set[i](x); const d = f(); if (d < best - 1e-5) { best = d; break; } set[i](x0); }
      }
    }
    arm.sh.updateMatrixWorld(true);
    return best;
  }
  /**
   * Mains du gardien sur des points de la surface du ballon (6c-B) : chaque cible est attribuée à la main la
   * plus proche ; le centre de la main est placé à l'extérieur de la surface (épaisseur du gant), puis la
   * distance réelle gant ↔ ballon (surface du modèle visible) est corrigée d'un pas. Poids w : mélange avec
   * la pose animée. Corps porté vers le ballon si les bras n'y suffisent pas (au plus 0,5 m, poids w).
   */
  gkHands(e, C, targets, w, grounded = false) {
    const P3 = e.p3, arms = P3.arms, R = P3.root, RH = 0.03;
    if (!arms[0]?.hand || !arms[1]?.hand || !(w > 0)) return;
    R.updateMatrixWorld(true);
    const hp = arms.map((a) => a.hand.getWorldPosition(new THREE.Vector3()));
    let pairs;
    if (targets.length === 1) { const i = hp[0].distanceTo(targets[0]) <= hp[1].distanceTo(targets[0]) ? 0 : 1; pairs = [[i, targets[0]]]; }
    else pairs = hp[0].distanceTo(targets[0]) + hp[1].distanceTo(targets[1]) <= hp[0].distanceTo(targets[1]) + hp[1].distanceTo(targets[0]) ? [[0, targets[0]], [1, targets[1]]] : [[0, targets[1]], [1, targets[0]]];
    const save = arms.map((a) => [a.sh.rotation.x, a.sh.rotation.y, a.sh.rotation.z, a.el.rotation.z]);
    const ctr = (S, off = 0) => { const n = S.clone().sub(C).normalize(); return C.clone().addScaledVector(n, BALL_R + RH - off); };
    // Gardien debout : le corps s'oriente vers le ballon (au-delà de 17°, au plus 0,9 rad), comme pour aller le chercher.
    if (!grounded) { const q = R.worldToLocal(C.clone()), a = Math.atan2(q.z, q.x), ex = Math.abs(a) - 0.3; if (ex > 0 && Math.hypot(q.x, q.z) > 0.15) { const th = Math.min(0.9, ex) * w, r0 = R.rotation.y; R.rotation.y += Math.sign(a) * th; R.updateMatrixWorld(true); const q2 = R.worldToLocal(C.clone()); if (Math.abs(Math.atan2(q2.z, q2.x)) > Math.abs(a)) { R.rotation.y = r0 - Math.sign(a) * th; R.updateMatrixWorld(true); } } }
    // Ballon bas (gardien debout) : il fléchit les genoux puis se penche (au plus 0,35 m et 0,7 rad), jamais en
    // enfonçant les jambes dans la pelouse.
    if (!grounded && C.y < 0.8) {
      const c = Math.min(0.35, 0.8 - C.y) * w, th = Math.acos(Math.max(0.3, 1 - c / 0.89));
      for (const L3 of P3.legs) { L3.hip.rotation.z += th; L3.knee.rotation.z -= 2 * th; }
      P3.body.position.y -= c; P3.upper.rotation.z -= Math.min(0.7, Math.max(0, 0.6 - C.y) * 1.6) * w; R.updateMatrixWorld(true);
    }
    let res = 0;
    for (const [i, S] of pairs) res = Math.max(res, this.armSolve(arms[i], ctr(S)));
    if (res > 0.05) {
      // Hors de portée des bras : le corps se porte vers le ballon (affichage seulement, autour du contact) ;
      // horizontalement au plus 0,5 m, vers le haut au plus 0,3 m (petit saut), jamais vers le bas.
      const m = pairs.reduce((acc, [i, S]) => acc.add(ctr(S).sub(arms[i].hand.getWorldPosition(new THREE.Vector3()))), new THREE.Vector3()).multiplyScalar(1 / pairs.length);
      const hl = Math.hypot(m.x, m.z), kH = hl > 0.5 ? 0.5 / hl : 1; m.x *= kH; m.z *= kH; m.y = Math.max(0, Math.min(0.3, m.y));
      R.position.addScaledVector(m, w); R.updateMatrixWorld(true);
      for (const [i, S] of pairs) this.armSolve(arms[i], ctr(S));
    }
    const clear = () => { for (let it = 0; it < 3; it++) {
      let worst = 0, wc = null; for (const [nm, q, c] of this.bodySurf(P3, C)) { if (nm.startsWith('main') || nm.startsWith('pied')) continue; const d = q.distanceTo(C) - BALL_R; if (d < worst) { worst = d; wc = c || q; } }
      if (worst > -0.004) break;
      // (dans la direction ballon → partie du corps, en 3D ; jamais vers le bas)
      const dv = wc.clone().sub(C); dv.y = Math.max(0, dv.y); if (dv.lengthSq() < 1e-6) dv.set(R.position.x - C.x, 0, R.position.z - C.z); dv.normalize();
      R.position.addScaledVector(dv, 0.01 - worst); R.updateMatrixWorld(true);
      for (const [i, S] of pairs) this.armSolve(arms[i], ctr(S, S._off?.v || 0));
    } };
    // Aucune autre partie du corps (tête, poitrine, genoux) dans le ballon : le corps recule de ce qu'il faut.
    clear();
    // Correction sur la surface réelle du gant (modèle visible) : écart visé 2 mm.
    for (let it = 0; it < 3; it++) {
      let ok = true;
      for (const [i, S] of pairs) {
        const q = P3.surfNearest('hand' + i, C); if (!q) continue;
        const d = q.distanceTo(C) - BALL_R; if (Math.abs(d - 0.002) < 0.004) continue; ok = false;
        (S._off ||= { v: 0 }).v += d - 0.002; this.armSolve(arms[i], ctr(S, S._off.v));
      }
      if (ok) break;
    }
    clear();
    if (w < 1) arms.forEach((a, i) => { const s0 = save[i]; a.sh.rotation.set(s0[0] + (a.sh.rotation.x - s0[0]) * w, s0[1], s0[2] + (a.sh.rotation.z - s0[2]) * w); a.el.rotation.z = s0[3] + (a.el.rotation.z - s0[3]) * w; });
    R.updateMatrixWorld(true);
  }
  /**
   * Gardien (6c-B, rendu seulement) : mains au ballon au contact réel, selon le résultat lu dans l'enregistrement
   *  - capté : les deux mains derrière le ballon (paumes face à lui, en « W »), puis ballon ramené contre la poitrine ;
   *  - repoussé : les deux paumes sur la face du ballon qui arrive ;
   *  - dévié : une main (la plus proche) sur le côté du ballon ;
   *  - geste sans contact (plongeon battu, sortie manquée) : les gants restent à distance du ballon.
   * Ballon tenu : il suit le buste (catch → poitrine en 0,35 s) et les mains sont posées de part et d'autre.
   */
  applyGK(e, p, flip, VB, held = false) {
    const P3 = e.p3, k = p._gk;
    if (held) {
      const up = P3.upper, tD = this.v.disp6?.tD ?? 0;
      P3.root.updateMatrixWorld(true);
      if (!e._hold || e._hold.tLast > tD + 1e-6 || tD - e._hold.tLast > 0.5) {
        const [bx, bz] = this.toWorld(VB.x, VB.y, flip), C0 = new THREE.Vector3(bx, BALL_R + VB.h * 26, bz);
        e._hold = { loc0: up.worldToLocal(C0.clone()), t0: tD };
      }
      e._hold.tLast = tD;
      const CH = (this._gkChest ||= new THREE.Vector3(0.12 + BALL_R + 0.05, 0.2, 0)), u = Math.max(0, Math.min(1, (tD - e._hold.t0) / 0.35)), s = u * u * (3 - 2 * u);
      const loc = e._hold.loc0.clone().lerp(CH, s), C = up.localToWorld(loc); C.y = Math.max(BALL_R, C.y);
      // Relance au pied ballon en main : le ballon quitte les mains et descend vers le point de frappe (genou).
      const rel = p._rel; let wH = 1;
      if (rel && tD >= rel.tC - 0.15) {
        const ur = Math.max(0, Math.min(1, (tD - (rel.tC - 0.15)) / 0.15)), [rx, rz] = this.toWorld(rel.at.x / L, rel.at.y / W, flip);
        C.lerp(new THREE.Vector3(rx, rel.at.z, rz), ur * ur); wH = Math.max(0, 1 - ur * 2.5);
        if (wH <= 0) { e._heldPos = C; return; }
      }
      const lat = up.localToWorld(new THREE.Vector3(0, 0, 1)).sub(up.localToWorld(new THREE.Vector3(0, 0, 0))).normalize();
      const fwd = up.localToWorld(new THREE.Vector3(1, 0, 0)).sub(up.localToWorld(new THREE.Vector3(0, 0, 0))).normalize();
      const off = (sg) => C.clone().addScaledVector(lat, sg * BALL_R * 0.92).addScaledVector(fwd, BALL_R * 0.38);
      this.gkHands(e, C, [off(1), off(-1)], wH, true);
      e._heldPos = C; return;
    }
    e._hold = null; e._heldPos = null;
    if (p.dive > 0) {
      // Plongeon : le moteur fait glisser le gardien et place ses mains à 0,95 m au-delà du corps ; la pose couche le
      // corps sur le côté (gants à ~2,3 m de l'origine). Le corps affiché est recalé pour que les gants soient là
      // où le moteur place les mains. Contact connu : le gardien s'oriente pour plonger vers le point de contact
      // (ballon arrivant de face ou de biais), avec le poids de la fenêtre du contact.
      const R = P3.root; R.updateMatrixWorld(true);
      if (k && k.at && k.w > 0) {
        const [cx, cz] = this.toWorld(k.at.x / L, k.at.y / W, flip), q = R.worldToLocal(new THREE.Vector3(cx, 0, cz)), sd = p.diveSide ?? 1;
        const a = Math.atan2(q.z, q.x) - sd * Math.PI / 2, aw = Math.atan2(Math.sin(a), Math.cos(a));
        R.rotation.y += aw * k.w; R.updateMatrixWorld(true);
      }
      const hs = P3.arms.map((a) => R.worldToLocal(a.hand.getWorldPosition(new THREE.Vector3())));
      const hz = (hs[0].z + hs[1].z) / 2, hx = (hs[0].x + hs[1].x) / 2, sd = Math.sign(hz) || 1, reach = 0.95 * Math.min(1, Math.abs(hz) / 0.95);
      const off = new THREE.Vector3(0.1 - hx, 0, sd * reach - hz).applyQuaternion(R.quaternion);
      R.position.add(off); R.updateMatrixWorld(true);
    }
    if (!k) return;
    const [bx, bz] = this.toWorld(VB.x, VB.y, flip), Cb = new THREE.Vector3(bx, BALL_R + VB.h * 26, bz);
    if (k.avoid) {
      // Sans contact : si un gant passe à moins de 3 cm du ballon affiché, le corps s'en écarte (au plus 0,3 m).
      P3.root.updateMatrixWorld(true);
      const dmin = Math.min(...[0, 1].map((i) => { const q = P3.surfNearest('hand' + i, Cb); return q ? q.distanceTo(Cb) - BALL_R : Infinity; }));
      if (dmin < 0.03) { const R = P3.root.position, ax = R.x - Cb.x, az = R.z - Cb.z, l = Math.hypot(ax, az) || 1, push = Math.min(0.3, 0.03 - dmin); R.x += ax / l * push; R.z += az / l * push; P3.root.updateMatrixWorld(true); k.avoidD = push; }
      return;
    }
    if (!(k.w > 0) || !k.at) return;
    const [cx, cz] = this.toWorld(k.at.x / L, k.at.y / W, flip), C = new THREE.Vector3(cx, Math.max(BALL_R, k.at.z), cz);
    // Direction d'arrivée du ballon (repère monde), et axe latéral.
    const fx = flip ? -1 : 1, u = new THREE.Vector3(k.vin.x * fx, k.vin.z, k.vin.y * fx);
    if (u.lengthSq() < 1e-6) { P3.root.updateMatrixWorld(true); u.copy(P3.root.position).sub(C).setY(0); }
    u.normalize();
    const side = new THREE.Vector3().crossVectors(u, new THREE.Vector3(0, 1, 0)); if (side.lengthSq() < 1e-4) side.set(1, 0, 0); side.normalize();
    let T;
    if (k.res === 'capté') T = [C.clone().addScaledVector(u, BALL_R * 0.55).addScaledVector(side, BALL_R * 0.83), C.clone().addScaledVector(u, BALL_R * 0.55).addScaledVector(side, -BALL_R * 0.83)];
    else if (k.res === 'repoussé') T = [C.clone().addScaledVector(u, BALL_R * 0.9).addScaledVector(side, BALL_R * 0.42), C.clone().addScaledVector(u, BALL_R * 0.9).addScaledVector(side, -BALL_R * 0.42)];
    else { P3.root.updateMatrixWorld(true); const hp = P3.arms.map((a) => a.hand.getWorldPosition(new THREE.Vector3())), h = hp[0].distanceTo(C) < hp[1].distanceTo(C) ? hp[0] : hp[1]; T = [C.clone().addScaledVector(h.clone().sub(C).normalize(), BALL_R)]; }
    this.gkHands(e, C, T, k.w, p.dive > 0);
  }
  /** Relance du gardien (6c-B) : juste après la frappe, le ballon affiché part du point de frappe (genou) et rejoint la trajectoire du moteur. */
  puntBlend(C, flip) {
    const D6 = this.v.disp6, r = D6?.rel; if (!r || !C) return C;
    const tD = D6.tD, x = tD - r.tC; if (x < 0 || x > 0.12) return C;
    const [ax, az] = this.toWorld(r.at.x / L, r.at.y / W, flip), [px, pz] = this.toWorld(r.phys.x / L, r.phys.y / W, flip), k = 1 - x / 0.12;
    C.x += (ax - px) * k; C.z += (az - pz) * k; C.y += (r.at.z - r.phys.z) * k; C.y = Math.max(BALL_R, C.y);
    return C;
  }
  /** Ballon tenu à deux mains (gardien, touche) : position monde, d'après la pose réelle des mains ; null sans mains. */
  heldBallPos(e, handP, flip) {
    const hands = e?.p3?.arms?.map((a) => a.hand).filter(Boolean);
    if (hands?.length !== 2) return null;
    e.p3.root.updateMatrixWorld(true);
    const a = hands[0].getWorldPosition(this._hA ||= new THREE.Vector3()), b = hands[1].getWorldPosition(this._hB ||= new THREE.Vector3());
    const pos = a.add(b).multiplyScalar(0.5);
    // un peu devant les paumes (le ballon a un rayon)
    const fa = flip ? handP.face + Math.PI : handP.face;
    pos.x += Math.cos(fa) * BALL_R * 0.8; pos.z += Math.sin(fa) * BALL_R * 0.8;
    pos.y = Math.max(BALL_R, pos.y);
    return pos.clone();
  }
  probeAir(mode, tFrom, tTo) {
    const v = this.v, D6 = v.disp6, G = v.live?.gest; if (!D6 || !G) return [];
    const flip = this.flip(), out = [], step = 1 / 96, V = new THREE.Vector3(), AIRK = new Set(['saut de tête', 'tête', 'saut']);
    for (const g of G.gestures) {
      const aerialCtrl = g.kind === 'contrôle' && ['tête', 'poitrine', 'cuisse'].includes(g.cPart) && g.tContact != null;   // (contrôles hauts : famille aérienne, 6c-A)
      if ((!AIRK.has(g.kind) && !aerialCtrl) || g.part === 'mains') continue;
      const contact = g.tContact != null, T = contact ? g.tContact : (g.tPlan ?? (g.t0re ?? g.t0) + 0.36);
      if (T < tFrom || T > tTo) continue;
      const e = this.players.get(g.pid), lp = v.players.get(g.pid); if (!e || !lp || lp.gk) continue;
      const P3 = e.p3, W3 = (o, x, y) => o.localToWorld(V.set(x, y, 0)).clone();
      // LOD forcé (outil) : 'mh' = modèle réaliste (gros plans), 'simple' = modèle simplifié (vue de jeu).
      const lod0 = P3.mhGroup ? P3.mhGroup.visible : null;
      if (this._probeLOD === 'mh' && !P3.mhGroup) { out.push({ gid: g.id, kind: g.kind, contact, skipped: 'modèle réaliste absent', T, pid: g.pid }); continue; }
      if (this._probeLOD && P3.mhGroup) P3.showMH(this._probeLOD === 'mh');
      const head = () => W3(P3.headPivot, 0.05, 0.1), chest = () => W3(P3.upper, 0.12, 0.25);
      const names = this.bodyPts(P3).map(([n]) => n); let Cb = null; const all = () => this.bodySurf(P3, Cb).map(([, q]) => q);
      const sn = (k, f) => P3.surfNearest(k, Cb) || f();   // (surface du modèle visible la plus proche du ballon)
      const partPts = () => { const c = g.cPart; if (c === 'tête' || !c) return [sn('head', head)]; if (c === 'poitrine') return [sn('chest', chest)]; if (c === 'cuisse') return [sn('knee0', () => W3(P3.legs[0].knee, 0, 0)), sn('knee1', () => W3(P3.legs[1].knee, 0, 0))]; if (c === 'pied') return [W3(P3.legs[0].ankle, 0.1, -0.05), W3(P3.legs[1].ankle, 0.1, -0.05)]; return all(); };
      let minAllPart = null, avoidMax = 0, bumped = false, otherC = null, zone = null, atC = null, dFr = null, best = null, minAll = null, minAllT = null, topY = -1, topT = null, uC = null, geo = null, sawAir = false;
      P3._sm = null;
      for (let t = T - 0.42; t <= T + 0.4; t += step) {
        if (!D6.sample(mode, t)) break;
        const p = D6.disp.get(g.pid); if (!p) break;
        const [x, z] = this.toWorld(p.x, p.y, flip); P3.root.position.set(x, 0, z);
        const B = D6.ballN, ballAng = Math.atan2((B.y - p.y) * W, (B.x - p.x) * L);
        P3.pose(p, flip, { dt: step, ballAng }); P3.smoothPose(step);
        if (p._air) { this.applyAir(e, p, flip, B); sawAir = true; avoidMax = Math.max(avoidMax, p._air.avoid || 0); }
        if ((p.bump || 0) > 0) bumped = true;   // (contact joueur-joueur : bousculade du moteur pendant le geste)
        if (p._ik) this.applyIK(e, p, flip, B); this.antiPen(e, p, flip, B); P3.root.updateMatrixWorld(true);
        const [bx, bz] = this.toWorld(B.x, B.y, flip), by = BALL_R + B.h * 26, dist = (q) => Math.hypot(q.x - bx, q.y - by, q.z - bz) - BALL_R;
        Cb = new THREE.Vector3(bx, by, bz);
        const hY = head().y; if (hY > topY) { topY = hY; topT = t - T; }
        const dl = all().map(dist), dA = Math.min(...dl); if (minAll == null || dA < minAll) { minAll = dA; minAllT = t - T; minAllPart = names[dl.indexOf(dA)]; }
        if (Math.abs(t - T) <= step + 1e-6 && geo == null) { const [rx, rz] = this.toWorld(p.x, p.y, flip); geo = { h: +(B.h * 26).toFixed(2), dh: +Math.hypot(bx - rx, bz - rz).toFixed(2), amp: p._air ? +(p._air.ampWant ?? 1).toFixed(2) : null, why: p._air?.why || null, high: !!p._air?.high, reach: p._ik?.reach || null, lunge: +(p._ik?.lunge || 0).toFixed(2), yaw: +(p._ik?.yaw || 0).toFixed(2), lean: +(p._ik?.lean || 0).toFixed(2), hf: p._ik?.headFront, ikw: p._ik ? +p._ik.w.toFixed(2) : null, yawH: +(p._ik?.yaw || 0).toFixed(2), nod: +(p._ik?.nod || 0).toFixed(2), neck: +P3.headPivot.rotation.z.toFixed(2) }; uC = p._air ? +p._air.u.toFixed(3) : null; }
        if (contact) {
          const d = Math.min(...partPts().map(dist));
          if (!best || d < best.d) best = { d, t };
          if (Math.abs(t - T) <= step + 1e-6 && (atC == null || d < atC)) atC = d;
          if (Math.abs(t - T) <= step + 1e-6 && zone == null && (g.cPart === 'tête' || !g.cPart)) {   // zone de la tête au contact (repère de la tête : x avant, y haut)
            const hq = P3.surfNearest('head', Cb), hc = P3.surfCenter('head');
            if (hq && hc) { const inv = new THREE.Matrix4().copy(P3.headPivot.matrixWorld).invert(), a = hq.clone().applyMatrix4(inv), c = hc.clone().applyMatrix4(inv), dx = a.x - c.x, dy = a.y - c.y, dz = a.z - c.z, h = Math.hypot(dx, dz);
              zone = dy > h * 1.2 ? 'dessus' : dx > Math.abs(dz) * 0.7 ? 'front' : dx < -Math.abs(dz) * 0.7 ? 'arrière' : 'côté'; }
          }
          if (Math.abs(t - T) <= 1 / 60 + 1e-6 && (dFr == null || d < dFr)) dFr = d;
          if (Math.abs(t - T) <= step + 1e-6) {   // autres parties du corps (hors mains, pieds) au contact : pénétration éventuelle
            const cp = g.cPart === 'cuisse' ? 'genou' : g.cPart || 'tête';
            for (const [nm, q] of this.bodySurf(P3, Cb)) { if (nm.startsWith(cp) || nm.startsWith('main') || nm.startsWith('pied')) continue; const dd = dist(q); if (otherC == null || dd < otherC.d) otherC = { d: dd, part: nm }; }
          }
        }
      }
      if (this._probeLOD && P3.mhGroup) P3.showMH(lod0);
      out.push({ gid: g.id, kind: aerialCtrl ? 'contrôle aérien' : g.kind + (g.reflex ? ' (réflexe)' : ''), contact, part: g.cPart || null, outcome: g.outcome, src: g.src, why: g.why, notes: (g.notes || []).map((n) => n.what),
        dAtC: atC == null ? null : +atC.toFixed(3), dFrame: dFr == null ? null : +dFr.toFixed(3), minD: best ? +best.d.toFixed(3) : null, dtMin: best ? +(best.t - T).toFixed(4) : null,
        minAll: minAll == null ? null : +minAll.toFixed(3), minAllPart, bumped, zone, lod: P3.mhGroup && P3.mhGroup.visible ? 'mh' : 'simple', otherC: otherC ? { d: +otherC.d.toFixed(3), part: otherC.part } : null, avoid: +avoidMax.toFixed(2), minAllT: minAllT == null ? null : +minAllT.toFixed(3), topT: topT == null ? null : +topT.toFixed(3), topY: +topY.toFixed(2), uC, sawAir, plan: g.tPlan != null && contact ? +(g.tContact - g.tPlan).toFixed(3) : null, ...(geo || {}), T, pid: g.pid });
    }
    return out;
  }
  /**
   * Sonde du gardien (étape 6c-B, outil) : pour chaque geste du gardien (plongeon, saut « mains », mains
   * debout, prise, relances au pied), distance des GANTS (surface du modèle visible) à la surface du ballon
   * affiché autour du contact ; résultat déduit de l'enregistrement (capté : ballon tenu juste après ; sinon
   * dévié si le ballon garde l'essentiel de sa vitesse et de sa direction, repoussé sinon) ; gestes sans
   * contact (plongeon battu) : approche minimale des mains (faux contact visuel) ; ballon tenu : écart et
   * pénétration des gants, saut du ballon à la prise et au lâcher, glissement (mouvement du ballon dans le
   * repère du buste d'une image à l'autre).
   */
  probeGK(mode, tFrom, tTo) {
    const v = this.v, D6 = v.disp6, G = v.live?.gest; if (!D6 || !G) return [];
    const flip = this.flip(), out = [], step = 1 / 96, KINDS = new Set(['plongeon', 'saut', 'mains', 'dégagement', 'passe', 'passe levée']);
    const sp = (a, b, dt) => (a && b ? Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z) / dt : null);
    for (const g of G.gestures) {
      const lp = v.players.get(g.pid); if (!lp || !lp.gk || !KINDS.has(g.kind)) continue;
      if (g.kind === 'saut' && g.part !== 'mains') continue;
      const contact = g.tContact != null;
      const T = contact ? g.tContact : g.kind === 'plongeon' ? g.t0 + 0.4 : (g.tPlan ?? g.t0 + 0.36);
      if (T < tFrom || T > tTo) continue;
      const e = this.players.get(g.pid); if (!e) continue;
      const P3 = e.p3, kick = ['dégagement', 'passe', 'passe levée'].includes(g.kind);
      const lod0 = P3.mhGroup ? P3.mhGroup.visible : null;
      if (this._probeLOD && P3.mhGroup) P3.showMH(this._probeLOD === 'mh');
      // Résultat déduit de l'enregistrement (l'affichage voit 0,15 s d'avance).
      let res = null, ratio = null, turn = null;
      if (contact && !kick) {
        D6.sample('ancien', T + 0.06);
        if (D6.holder === g.pid && D6.inHands) res = 'capté';
        else {
          const a0 = D6.ballAt(T - 0.03), a1 = D6.ballAt(T - 0.005), b0 = D6.ballAt(T + 0.02), b1 = D6.ballAt(T + 0.05);
          const vin = sp(a0, a1, 0.025), vout = sp(b0, b1, 0.03); ratio = vin ? vout / vin : null;
          const u = { x: a1.x - a0.x, y: a1.y - a0.y, z: a1.z - a0.z }, w = { x: b1.x - b0.x, y: b1.y - b0.y, z: b1.z - b0.z };
          const nu = Math.hypot(u.x, u.y, u.z), nw = Math.hypot(w.x, w.y, w.z);
          turn = nu && nw ? Math.acos(Math.max(-1, Math.min(1, (u.x * w.x + u.y * w.y + u.z * w.z) / (nu * nw)))) * 57.3 : null;
          res = ratio != null && ratio > 0.6 && turn != null && turn < 35 ? 'dévié' : 'repoussé';
        }
      }
      const t0 = g.kind === 'plongeon' ? Math.min(g.t0 - 0.05, T - 0.45) : T - 0.45, t1 = g.kind === 'plongeon' ? Math.max(g.t0 + 1.0, T + 0.3) : T + 0.35;
      let atC = null, dFr = null, best = null, minAll = null, minAllT = null, otherC = null, geo = null, jumpIn = null, jumpOut = null, prevBall = null, prevHeld = false;
      const held = { n: 0, gapMax: 0, penMin: 0, slideMax: 0, both: 0, prevLocal: null, firstT: null };
      P3._sm = null;
      const end = kick ? T + 0.35 : contact && res === 'capté' ? Math.max(t1, T + 1.0) : t1;
      for (let t = t0; t <= end; t += step) {
        if (!D6.sample(mode, t)) break;
        const p = D6.disp.get(g.pid); if (!p) break;
        const [x, z] = this.toWorld(p.x, p.y, flip); P3.root.position.set(x, 0, z);
        const B = D6.ballN, ballAng = Math.atan2((B.y - p.y) * W, (B.x - p.x) * L);
        const isH = D6.holder === g.pid && D6.inHands;
        P3.pose(p, flip, { dt: step, ballAng, ballNear: true, holding: isH }); P3.smoothPose(step);
        if (p._air) this.applyAir(e, p, flip, B); if (p._ik) this.applyIK(e, p, flip, B); this.antiPen(e, p, flip, B);
        if (p.fall > 0 || p.slide > 0 || p.hurt > 0 || p.place > 0 || p.block > 0 || (p.dive > 0 && p.dive < 0.3)) P3.groundContact();
        if (mode === 'contrat') this.applyGK(e, p, flip, B, isH); P3.root.updateMatrixWorld(true);
        let C;
        if (isH) C = (mode === 'contrat' && e._heldPos ? e._heldPos.clone() : this.heldBallPos(e, p, flip)) || null;
        if (!C) { const [bx, bz] = this.toWorld(B.x, B.y, flip); C = new THREE.Vector3(bx, BALL_R + B.h * 26, bz); if (mode === 'contrat') this.puntBlend(C, flip); }
        if (prevBall && isH !== prevHeld) { const j = C.distanceTo(prevBall), r = { d: +j.toFixed(3), at: +(t - T).toFixed(3), to: isH ? 'tenu' : 'lâché' }; if (isH) { if (jumpIn == null || j > jumpIn.d) jumpIn = r; } else if (jumpOut == null || j > jumpOut.d) jumpOut = r; }
        prevBall = C.clone(); prevHeld = isH;
        const hd = [0, 1].map((i) => { const q = P3.surfNearest('hand' + i, C); return q ? q.distanceTo(C) - BALL_R : Infinity; }), dh = Math.min(...hd);
        if (kick && contact) {   // relance au pied : bout du pied le plus proche du ballon (comme la sonde 6b)
          const df = Math.min(...[0, 1].map((i) => P3.legs[i].ankle.localToWorld(new THREE.Vector3(0.1, -0.05, 0)).distanceTo(C) - BALL_R));
          if (Math.abs(t - T) <= step + 1e-6 && (atC == null || df < atC)) { atC = df; geo = { h: +C.y.toFixed(2), dh: +Math.hypot(C.x - x, C.z - z).toFixed(2), heldAtC: isH, holderAtC: D6.holder === g.pid, inHands: !!D6.inHands }; }
          if (!best || df < best.d) best = { d: df, t };
        }
        if (!kick) { if (minAll == null || dh < minAll) { minAll = dh; minAllT = t - T; } }
        if (contact && !kick) {
          if (!best || dh < best.d) best = { d: dh, t };
          if (Math.abs(t - T) <= step + 1e-6 && (atC == null || dh < atC)) atC = dh;
          if (Math.abs(t - T) <= 1 / 60 + 1e-6 && (dFr == null || dh < dFr)) dFr = dh;
          if (Math.abs(t - T) <= step + 1e-6) {
            for (const [nm, q] of this.bodySurf(P3, C)) { if (nm.startsWith('main') || nm.startsWith('pied')) continue; const dd = q.distanceTo(C) - BALL_R; if (otherC == null || dd < otherC.d) otherC = { d: dd, part: nm }; }
            if (geo == null) { const bl = P3.root.worldToLocal(C.clone()), hl = P3.arms.map((a) => P3.root.worldToLocal(a.hand.getWorldPosition(new THREE.Vector3())).toArray().map((v) => +v.toFixed(2))); geo = { h: +(C.y).toFixed(2), dh: +Math.hypot(C.x - x, C.z - z).toFixed(2), dive: +(p.dive || 0).toFixed(2), jump: +(p.jump || 0).toFixed(2), block: +(p.block || 0).toFixed(2), claim: +(p.claimHigh || 0).toFixed(2), face: +(p.face || 0).toFixed(2), diveDir: p.diveDir ?? null, ballLoc: bl.toArray().map((v) => +v.toFixed(2)), handsLoc: hl, gkw: p._gk ? +(p._gk.w || 0).toFixed(2) : null, gkres: p._gk?.res || null, flip }; }
          }
        }
        if (isH && t >= T && !kick && !(mode === 'contrat' && p._rel)) {   // (hors lâcher d'une relance au pied)
          held.n++; held.firstT ??= t - T;
          if (dh > held.gapMax) { held.gapMax = dh; held.gapT = t - T; held.gapRel = !!p._rel; held.gapDive = +(p.dive || 0).toFixed(2); } held.penMin = Math.min(held.penMin, Math.min(...hd));
          if (Math.max(...hd) <= 0.03) held.both++;
          const loc = P3.upper.worldToLocal(C.clone());
          if (held.prevLocal && loc.distanceTo(held.prevLocal) > held.slideMax) { held.slideMax = loc.distanceTo(held.prevLocal); held.slideT = t - T; }
          held.prevLocal = loc;
        }
      }
      if (this._probeLOD && P3.mhGroup) P3.showMH(lod0);
      out.push({ gid: g.id, kind: g.kind + (g.reflex ? ' (réflexe)' : ''), src: g.src, contact, part: g.cPart || g.part, outcome: g.outcome, res, ratio: ratio == null ? null : +ratio.toFixed(2), turn: turn == null ? null : +turn.toFixed(0),
        dAtC: atC == null ? null : +atC.toFixed(3), dFrame: dFr == null ? null : +dFr.toFixed(3), minD: best ? +best.d.toFixed(3) : null, dtMin: best ? +(best.t - T).toFixed(4) : null,
        minAll: minAll == null || !isFinite(minAll) ? null : +minAll.toFixed(3), minAllT: minAllT == null ? null : +minAllT.toFixed(3), otherC: otherC ? { d: +otherC.d.toFixed(3), part: otherC.part } : null, jump: jumpIn, jumpOut,
        held: held.n ? { n: held.n, from: +held.firstT.toFixed(3), gapMax: +held.gapMax.toFixed(3), gapT: held.gapT != null ? +held.gapT.toFixed(3) : null, gapDive: held.gapDive, slideT: held.slideT != null ? +held.slideT.toFixed(3) : null, penMin: +held.penMin.toFixed(3), both: +(held.both / held.n).toFixed(2), slideMax: +held.slideMax.toFixed(3) } : null,
        lod: P3.mhGroup && P3.mhGroup.visible ? 'mh' : 'simple', ...(geo || {}), T, pid: g.pid });
    }
    return out;
  }
  probe6(mode, tFrom, tTo) {
    const v = this.v, D6 = v.disp6, G = v.live?.gest; if (!D6 || !G) return [];
    const flip = this.flip(), out = [], step = 1 / 96, V = new THREE.Vector3();
    const KINDS = new Set(['passe', 'passe levée', 'frappe', 'centre', 'dégagement', 'remise en jeu au pied', 'contrôle', 'subi', 'touche de conduite']);
    for (const g of G.gestures) {
      if (!KINDS.has(g.kind) || g.tContact == null || g.tContact < tFrom || g.tContact > tTo) continue;
      const e = this.players.get(g.pid); if (!e) continue;
      const L3 = e.p3.legs, pts = (p) => {
        const foot = (i) => L3[i].ankle.localToWorld(V.set(0.1, -0.05, 0)).clone(), knee = (i) => L3[i].knee.localToWorld(V.set(0, 0, 0)).clone();
        if (g.kind === 'touche de conduite') return [foot(0), foot(1)];   // (la jambe la plus proche du ballon fait la touche)
        if (!['contrôle', 'subi'].includes(g.kind)) return [foot((g.style?.foot || p.kickFoot) === 'L' ? 0 : 1)];
        const part = g.cPart;
        if (part === 'cuisse') return [knee(0), knee(1)];
        if (part === 'poitrine') return [e.p3.upper.localToWorld(V.set(0.12, 0.25, 0)).clone()];
        if (part === 'tête') return [e.p3.headPivot.localToWorld(V.set(0.05, 0.1, 0)).clone()];
        return [foot(0), foot(1)];
      };
      let best = null, atC = null, first = null, lastT = null, maxPen = 0, geo = null, penT = null, dFr = null, cross = null;
      e.p3._sm = null;   // lissage repris au début de la fenêtre, comme à l'écran
      for (let t = g.tContact - 0.35; t <= g.tContact + 0.3; t += step) {
        if (!D6.sample(mode, t)) break;
        const p = D6.disp.get(g.pid); if (!p) break;
        const [x, z] = this.toWorld(p.x, p.y, flip); e.p3.root.position.set(x, 0, z);
        const B = D6.ballN, ballAng = Math.atan2((B.y - p.y) * W, (B.x - p.x) * L);
        e.p3.pose(p, flip, { dt: step, ballAng }); e.p3.smoothPose(step); if (p._air) this.applyAir(e, p, flip, B); if (p._ik) this.applyIK(e, p, flip, B); this.antiPen(e, p, flip, B); e.p3.root.updateMatrixWorld(true);
        let [bx, bz] = this.toWorld(B.x, B.y, flip), by = BALL_R + B.h * 26;
        if (mode === 'contrat' && D6.rel) { const Cp = this.puntBlend(new THREE.Vector3(bx, by, bz), flip); bx = Cp.x; by = Cp.y; bz = Cp.z; }   // (relance du gardien ballon en main, 6c-B)
        const d = Math.min(...pts(p).map((q) => Math.hypot(q.x - bx, q.y - by, q.z - bz))) - BALL_R;
        if (!best || d < best.d) best = { d, t };
        if (Math.abs(t - g.tContact) <= 1 / 60 + 1e-6 && (dFr == null || d < dFr)) dFr = d;
        if (Math.abs(t - g.tContact) <= step + 1e-6 && p._ik && p._ik.legUsed != null && cross == null) {
          // Jambes croisées : le pied du geste est passé de l'autre côté du pied d'appui (repère du joueur).
          const R = e.p3.root, k = p._ik.legUsed, z = (i) => R.worldToLocal(L3[i].ankle.localToWorld(V.set(0.1, -0.05, 0)).clone()).z;
          cross = +(((k === 1 ? 1 : -1) * (z(k) - z(1 - k)))).toFixed(3);
        }   // (minimum à ± une image de 60 i/s du contact)
        if (Math.abs(t - g.tContact) <= step + 1e-6) {
          if (atC == null || d < atC) atC = d;   // distance au contact : minimum dans ±1 pas
          if (geo == null) { const [rx, rz] = this.toWorld(p.x, p.y, flip); geo = { h: +(B.h * 26).toFixed(2), dh: +Math.hypot(bx - rx, bz - rz).toFixed(2), reach: p._ik?.reach || null, ikg: p._ik ? (p._ik.gid === g.id ? 'même' : 'autre') : 'aucun', yaw: +(p._ik?.yaw || 0).toFixed(2), side: +(p._ik?.side || 0).toFixed(2), lunge: +(p._ik?.lunge || 0).toFixed(2) }; }   // (distance au joueur : position du moteur)
        }
        if (d < -0.005) { const x = t - g.tContact; first = first ?? x; lastT = x; }   // pied DANS le ballon (contact visuel net)
        if (Math.abs(t - g.tContact) > step + 1e-6 && -d > maxPen) { maxPen = -d; penT = t - g.tContact; }   // pénétration hors du pas du contact
        if (this._probeSeries) { const R = e.p3.root.position; (this._probeSeries[g.id] ||= { kind: g.kind, part: g.cPart, rows: [] }).rows.push([+(t - g.tContact).toFixed(3), +d.toFixed(3), +(p._ik?.w || 0).toFixed(2), +Math.hypot(bx - R.x, bz - R.z).toFixed(2), +by.toFixed(2), p._ik?.at ? +Math.hypot(this.toWorld(p._ik.at.x / L, p._ik.at.y / W, flip)[0] - bx, this.toWorld(p._ik.at.x / L, p._ik.at.y / W, flip)[1] - bz).toFixed(3) : null]); }
      }
      if (best) out.push({ gid: g.id, kind: g.kind + (g.reflex && !['contrôle', 'subi', 'touche de conduite'].includes(g.kind) ? ' (sans armé)' : ''), part: g.cPart, minD: +best.d.toFixed(3), dtMin: +(best.t - g.tContact).toFixed(4), dAtC: +(atC ?? best.d).toFixed(3), dFrame: +(dFr ?? best.d).toFixed(3), cross, touchFrom: first, touchTo: lastT, maxPen: +maxPen.toFixed(3), penT: penT == null ? null : +penT.toFixed(3), ...(geo || {}), tC: g.tContact, pid: g.pid });
    }
    return out;
  }

  /**
   * Étalonnage (étape 6b, outil) : pour un joueur immobile, balaye la phase u de chaque animation
   * (frappe : variantes de capture × plat / cou-de-pied ; touche de conduite ; contrôle) et renvoie,
   * pour chaque u, la position du bout du pied concerné dans le repère du joueur (avant, hauteur).
   */
  /**
   * Cinématique inverse autour d'un contact (étape 6b, rendu seulement) :
   *  1. cible = point de la surface du ballon À L'INSTANT DU CONTACT le plus proche du pied animé
   *     (poids k.w, maximal au contact) ; jambe : celle du moteur pour une frappe, la plus proche du
   *     ballon pour une touche ou un contrôle ;
   *  2. ballon hors de portée de la jambe : le corps se fend vers lui à l'affichage (jusqu'à 0,5 m,
   *     même poids, autour du contact seulement) — la position du moteur n'est pas modifiée ;
   *     au-delà, le cas reste « hors de portée » (pas de jambe forcée) ;
   *  3. ballon touché derrière ou sur le côté (touches, contrôles ; ballon à plus de 0,35 m) : le corps
   *     pivote vers lui à l'affichage autour du contact (au-delà de 60°, au plus 75° de pivot) ;
   *  4. frappe du pied décidé par le moteur avec le ballon du côté de l'autre pied : décalage latéral
   *     d'affichage (au plus 0,35 m) plutôt qu'une jambe croisée ; touche et contrôle : jambe choisie une
   *     fois par geste (côté du ballon, ou celle qui l'atteint) ;
   *  5. le ballon n'est pénétré par aucune jambe hors du pas du contact (antiPen).
   */
  /**
   * Saut piloté par le contrat (étape 6c-A, rendu seulement). L'animation capturée a une hauteur fixe ;
   * son amplitude (montée du bassin, repli des jambes) est réglée pour que le front soit à la hauteur
   * du ballon au contact (contrôle de la poitrine : la poitrine). Saut sans contact (duel perdu, saut
   * gêné) : si le ballon passe à portée, le front reste nettement sous le ballon — jamais de contact
   * visuel sans contact physique. Saut sans ballon proche (mur) : amplitude normale.
   */
  applyAir(e, p, flip, VB) {
    const A = p._air, P3 = e.p3; if (!A) return;
    let amp = 1, why = 'normal';
    if (A.at) {
      const [bx, bz] = this.toWorld(A.at.x / L, A.at.y / W, flip), by = BALL_R + Math.max(0, A.at.z - 0.11);
      const R = P3.root.position, dh = Math.hypot(bx - R.x, bz - R.z);
      const partOff = A.part === 'poitrine' ? JUMP_CHEST : 0;   // (poitrine sous le front, à l'étalonnage)
      if (A.contact) { amp = (by + partOff - JUMP_BASE) / JUMP_BOB; why = 'contact'; }
      else if (dh < 1.3) { amp = (by - BALL_R - 0.15 - JUMP_BASE) / JUMP_BOB; why = 'sans contact, ballon proche'; }   // (jusqu'à 1,3 m : à 0,97 m, un saut d'amplitude normale amenait la poitrine au ballon)
      if (A.ctrl && amp < 0.12) amp = 0;   // contrôle haut à hauteur du corps : pas de saut
    }
    A.ampWant = amp; A.high = amp > JUMP_AMP_MAX; amp = Math.max(0, Math.min(JUMP_AMP_MAX, amp)); A.amp = amp; A.why = why;
    if (Math.abs(amp - 1) > 1e-3) {
      const lg = Math.min(1, amp);
      P3.body.position.y *= amp;
      for (const L3 of P3.legs) { L3.hip.rotation.x *= lg; L3.hip.rotation.z *= lg; L3.knee.rotation.z *= lg; L3.ankle.rotation.z *= lg; }
      if (!A.ctrl) P3.body.rotation.z *= Math.max(0.2, lg);   // (inclinaison du corps de l'animation de saut, réduite avec l'amplitude pour les têtes : sinon la tête d'une tête réflexe passe devant le ballon ; un contrôle haut la garde, la poitrine restant offerte au ballon entre deux touchers rapprochés)
      P3.root.updateMatrixWorld(true);
    }
    // Saut sans contact (duel aérien perdu, saut gêné) : aucune partie du corps ne touche le ballon affiché.
    // Si l'une d'elles en approche à moins de 3 cm, le joueur est écarté horizontalement du ballon (au plus 0,35 m).
    A.avoid = 0; A.avoidPart = null;
    if (!A.contact && VB) {
      const [bx, bz] = this.toWorld(VB.x, VB.y, flip), C = new THREE.Vector3(bx, BALL_R + VB.h * 26, bz), V = (this._airV ||= new THREE.Vector3());
      const R = P3.root.position;
      if (Math.hypot(bx - R.x, bz - R.z) < 1.6) {
        for (let pass = 0; pass < 3; pass++) {
          P3.root.updateMatrixWorld(true);
          let worst = 1, part = null, wq = null;
          for (const [nm, q, ctr] of this.bodySurf(P3, C)) { const d = q.distanceTo(C) - BALL_R; if (d < worst) { worst = d; part = nm; wq = ctr || q.clone(); } }
          if (worst >= 0.03) break;
          let ax = wq.x - bx, ay = wq.y - C.y, az = wq.z - bz; if (Math.hypot(ax, ay, az) < 0.01) { ax = R.x - bx; ay = 0; az = R.z - bz; }   // (direction 3D : ballon → partie du corps)
          const al = Math.hypot(ax, ay, az) || 1; ax /= al; ay /= al; az /= al;
          const push = Math.min(0.35 - A.avoid, 0.03 - worst + 0.01); if (push <= 0) break;
          R.x += ax * push; R.y += ay * push; R.z += az * push; A.avoid += push; A.avoidPart = part;
        }
        P3.root.updateMatrixWorld(true);
      }
    }
  }
  /** Points du corps (monde) les plus proches du ballon C : surface de la tête, du buste et des genoux, bouts des pieds, mains. */
  bodySurf(P3, C) {
    P3.root.updateMatrixWorld(true);
    const V = (this._bsV ||= new THREE.Vector3()), out = [];
    for (const [nm, o, x, y] of this.bodyPts(P3)) {
      const key = nm === 'tête' ? 'head' : nm === 'poitrine' ? 'chest' : nm === 'genou G' ? 'knee0' : nm === 'genou D' ? 'knee1' : null;
      const q = key ? P3.surfNearest(key, C) : null;
      out.push([nm, q || o.localToWorld(V.set(x, y, 0)).clone(), q ? P3.surfCenter(key) : null]);
    }
    return out;
  }
  /** Points du corps utilisés pour les contacts visuels (front, poitrine, genoux, bouts des pieds, mains). */
  bodyPts(P3) {
    return [['tête', P3.headPivot, 0.05, 0.1], ['poitrine', P3.upper, 0.12, 0.25], ['genou G', P3.legs[0].knee, 0, 0], ['genou D', P3.legs[1].knee, 0, 0],
      ['pied G', P3.legs[0].ankle, 0.1, -0.05], ['pied D', P3.legs[1].ankle, 0.1, -0.05], ['main G', P3.arms[0].el, 0, -0.25], ['main D', P3.arms[1].el, 0, -0.25]];
  }
  applyIK(e, p, flip, VB) {
    const k = p._ik; if (!k) return;
    const V = (this._ikV2 ||= new THREE.Vector3()), P3 = e.p3;
    const toeOf = (leg) => { P3.root.updateMatrixWorld(true); return P3.legs[leg].ankle.localToWorld(V.set(0.1, -0.05, 0)).clone(); };
    const ballW = (b) => { const [x, z] = this.toWorld(b.x / L, b.y / W, flip); return new THREE.Vector3(x, BALL_R + Math.max(0, b.z - 0.11), z); };
    const Cc = ballW(k.at || { x: VB.x * L, y: VB.y * W, z: 0.11 + VB.h * 26 });
    if (k.part && k.part !== 'pied') {
      // Contrôle de la cuisse, de la poitrine ou de la tête : pas de jambe ; le corps se porte vers le
      // ballon (horizontalement, au plus 0,5 m) pour que cette partie le touche au contact.
      P3.root.updateMatrixWorld(true);
      // (6c-A) Tête, poitrine, cuisse : le corps pivote d'abord vers le ballon (comme une touche) pour que le
      // front, la poitrine ou le genou, et non le dos, aille au ballon ; puis ajustement vertical fin (± 0,15 m) autour du contact.
      k.yaw = 0;
      if (k.turn && k.wy > 0) {
        const R = P3.root, ang = () => { R.updateMatrixWorld(true); const q = R.worldToLocal(V.copy(Cc)); return q.x * q.x + q.z * q.z > 0.0225 ? Math.atan2(q.z, q.x) : 0; };
        const a0 = ang(), ex = Math.abs(a0) - k.turn.free;
        if (ex > 0) { const th = Math.min(ex, k.turn.max - k.turn.free) * k.wy; R.rotation.y += th; if (Math.abs(ang()) > Math.abs(a0)) R.rotation.y -= 2 * th; R.updateMatrixWorld(true); k.yaw = th; }
      }
      P3.root.updateMatrixWorld(true);
      // (6c-A) Tête : pose « tête sans saut ». Sur un ballon bas, le buste se penche juste assez pour baisser la tête
      // (au plus ~50°). Si la poitrine entrait alors dans le ballon, on cherche la plus petite combinaison
      // buste penché + menton rentré (au plus 0,3 rad, cou limité à 0,65 rad au total) qui amène le front au
      // ballon en laissant la poitrine en retrait ; sinon, la moins pénétrante qui garde le front au ballon. Jamais de plongeon.
      // (Essai écarté : fléchir les genoux faisait descendre la poitrine dans le ballon plus souvent.)
      if (k.part === 'tête' && k.w > 0 && !k.ctrlAir) {
        const R = P3.root, up = P3.upper, hp = P3.headPivot, r0 = R.position.clone(), u0 = up.rotation.z, n0 = hp.rotation.z;
        const h0 = P3.surfNearest('head', Cc) || hp.localToWorld(V.set(0.05, 0.1, 0)).clone(), drop = h0.y - Cc.y;
        // Sens : vers l'avant si le ballon est devant le joueur (après le pivot), vers l'arrière (déviation de la
        // nuque, au plus ~26°) s'il est derrière — jamais le dos ou la nuque tendus vers un ballon placé derrière.
        const qb = R.worldToLocal(V.copy(Cc)), fwd = qb.x / (Math.hypot(qb.x, qb.z) || 1), sg = fwd >= -0.2 ? 1 : -1, aMax = sg > 0 ? 0.9 : 0.45;
        // Regard : la pose oriente la tête vers le ballon d'après l'orientation du corps AVANT le pivot ; après le pivot,
        // ces deux rotations s'additionnaient (nuque présentée au ballon). La tête est réorientée vers le ballon depuis
        // l'orientation réelle du corps (au plus 1,1 rad, comme la pose).
        { const yawT = -Math.atan2(qb.z, qb.x), y0 = hp.rotation.y; hp.rotation.y = y0 + (Math.max(-1.1, Math.min(1.1, yawT)) - y0) * Math.max(k.w, k.wy || 0); R.updateMatrixWorld(true); }
        // Ballon bas : la tête descend d'abord par la flexion des genoux (au plus 30 cm), le buste penché ne faisant que
        // le reste — un buste très penché fait passer la tête au-delà du ballon (contact de la nuque).
        const crouch = drop > 0.06 ? Math.min(0.3, drop) : 0;
        if (crouch > 0) { const th = Math.acos(Math.max(0.3, 1 - crouch / 0.89)) * k.w; for (const L3 of P3.legs) { L3.hip.rotation.z += th; L3.knee.rotation.z -= 2 * th; } P3.body.position.y -= crouch * k.w; k.crouch = crouch * k.w; R.updateMatrixWorld(true); }
        const dropL = drop - crouch, aMin = dropL > 0.06 ? Math.min(aMax, Math.acos(Math.max(0.2, 1 - dropL / 0.85))) : 0;
        // Tête : le visage reste presque face au ballon (inclinaison vers le bas au plus 0,25 rad par rapport à
        // l'horizontale) quand le buste se penche — c'est le FRONT, pas le sommet du crâne, qui frappe ; le coup de
        // tête de l'animation est ramené dans cette limite ; le menton rentré s'y ajoute si besoin.
        const set = (a, n) => { up.rotation.z = u0 - sg * a * k.w; const tgt = a > 0.02 ? sg * Math.max(-0.65, Math.min(0.6, a - 0.25 - n)) : n0 - sg * n; hp.rotation.z = Math.max(-0.65, Math.min(0.6, n0 + (tgt - n0) * k.w)); R.position.copy(r0); R.updateMatrixWorld(true); };
        const tryPose = (a, n) => {
          set(a, n);
          const pt = P3.surfNearest(sg > 0 ? 'headFront' : 'head', Cc); if (!pt) return { a, n, cg: 1, hd: 1 };
          const dx = Cc.x - pt.x, dy = Cc.y - pt.y, dz = Cc.z - pt.z, dl = Math.hypot(dx, dy, dz) || 1, f = (dl - BALL_R - 0.002) / dl;
          let sx = dx * f, sy = dy * f, sz = dz * f; const hl = Math.hypot(sx, sz);
          if (hl > 0.5) { sx *= 0.5 / hl; sz *= 0.5 / hl; } sy = Math.max(-0.2, Math.min(0.2, sy));
          R.position.x += sx * k.w; R.position.y += sy * k.w; R.position.z += sz * k.w; R.updateMatrixWorld(true);
          const ch = P3.surfNearest('chest', Cc), hd2 = P3.surfNearest('head', Cc);
          return { a, n, cg: ch ? ch.distanceTo(Cc) - BALL_R : 1, hd: hd2 ? hd2.distanceTo(Cc) - BALL_R : 1 };
        };
        let pick = tryPose(aMin, 0);
        if (pick.cg < -0.005) {
          const cands = [];
          for (let a = aMin; a <= aMax + 1e-6; a += 0.1) for (const n of [0, 0.15, 0.3]) if (a > aMin || n > 0) cands.push([a, n]);
          cands.sort((x, y) => (x[0] + 0.7 * x[1]) - (y[0] + 0.7 * y[1]));
          let best = pick;
          for (const [a, n] of cands) { const r = tryPose(a, n); if (r.cg >= -0.005 && r.hd <= 0.03) { best = r; break; } if (r.cg > best.cg + 0.005 && r.hd <= Math.max(0.03, pick.hd)) best = r; }   // (jamais au prix de la tête : une pose qui éloigne le front du ballon n'est pas retenue)
          pick = best;
        }
        set(pick.a, pick.n); k.lean = sg * pick.a * k.w; k.nod = sg * pick.n * k.w; k.headFront = sg > 0;
      }
      let kneeLeg = 1;
      if (k.part === 'cuisse') {
        // (6c-A) Contrôle de la cuisse : la jambe du côté du ballon (choisie une fois par geste) se lève pour que
        // le genou soit à la hauteur du ballon ; la pose d'origine lève toujours la jambe droite.
        if (e._ikLeg?.gid === k.gid) kneeLeg = e._ikLeg.leg;
        else { kneeLeg = P3.root.worldToLocal(V.copy(Cc)).z >= 0 ? 1 : 0; if (k.gid != null && k.at) e._ikLeg = { gid: k.gid, leg: kneeLeg }; }
        if (kneeLeg === 0) { const [a, b] = P3.legs; for (const r of ['x', 'y', 'z']) { const t = a.hip.rotation[r]; a.hip.rotation[r] = b.hip.rotation[r]; b.hip.rotation[r] = t; } const t = a.knee.rotation.z; a.knee.rotation.z = b.knee.rotation.z; b.knee.rotation.z = t; }
        if (k.w > 0) {
          const Lg = P3.legs[kneeLeg]; P3.root.updateMatrixWorld(true);
          const hp = Lg.hip.getWorldPosition(new THREE.Vector3()), kn = Lg.knee.getWorldPosition(new THREE.Vector3()), th = hp.distanceTo(kn) || 0.44;
          const want = Math.acos(Math.max(-0.2, Math.min(1, (hp.y - Cc.y) / th)));
          Lg.hip.rotation.z += (Math.min(1.75, want) - Lg.hip.rotation.z) * k.w; Lg.knee.rotation.z = Math.min(Lg.knee.rotation.z, -0.9 * k.w);
          P3.root.updateMatrixWorld(true);
        }
      }
      const pt = P3.surfNearest(k.part === 'tête' ? (k.headFront ? 'headFront' : 'head') : k.part === 'poitrine' ? 'chest' : 'knee' + kneeLeg, Cc) || (k.part === 'tête' ? P3.headPivot.localToWorld(V.set(0.05, 0.1, 0)).clone() : k.part === 'poitrine' ? P3.upper.localToWorld(V.set(0.12, 0.25, 0)).clone() : P3.legs[kneeLeg].knee.localToWorld(V.set(0, 0, 0)).clone());   // (point de SURFACE du modèle visible le plus proche du ballon)
      // Cible : la SURFACE du ballon (point le plus proche de la partie du corps), pas son centre ; le corps se
      // porte vers elle (horizontalement au plus 0,5 m ; verticalement ± 0,2 m pour la tête et la poitrine).
      const dx = Cc.x - pt.x, dy = Cc.y - pt.y, dz = Cc.z - pt.z, dl = Math.hypot(dx, dy, dz) || 1, f = (dl - BALL_R - 0.002) / dl;   // (surface du corps sur la surface du ballon, 2 mm d'écart)
      let sx = dx * f, sy = dy * f, sz = dz * f;
      const hl = Math.hypot(sx, sz), capV = k.part === 'tête' || k.part === 'poitrine' ? (k.ctrlAir ? 0.25 : 0.2) : 0;
      k.lunge = 0; k.reach = 'corps';
      if (hl > 0.5) { sx *= 0.5 / hl; sz *= 0.5 / hl; k.reach = 'hors de portée'; }
      if (Math.abs(sy) > capV) { if (Math.abs(sy) > capV + 0.03 && k.reach === 'corps') k.reach = 'ballon haut'; sy = Math.sign(sy) * capV; }
      if (k.w > 0) { const R = P3.root.position; R.x += sx * k.w; R.z += sz * k.w; R.y += sy * k.w; k.lunge = Math.hypot(sx, sz) * k.w; k.dy = sy * k.w; }
      P3.root.updateMatrixWorld(true);
      return;
    }
    // Ballon touché derrière ou sur le côté (le moteur admet un contact dans toutes les directions) : à
    // l'affichage, le corps pivote vers lui autour du contact (écart au-delà de 60°, pivot d'au plus 75°) — crochet
    // ou pivot — puis revient à l'orientation du moteur ; la jambe ne frappe jamais vers l'arrière.
    k.yaw = 0;
    if (k.turn && k.wy > 0) {
      const R = P3.root, ang = () => { R.updateMatrixWorld(true); const q = R.worldToLocal(V.copy(Cc)); return q.x * q.x + q.z * q.z > TURN_R * TURN_R ? Math.atan2(q.z, q.x) : 0; };   // (avant du joueur : +x local ; ballon collé au joueur : pas de pivot)
      const a0 = ang(), ex = Math.abs(a0) - k.turn.free;
      if (ex > 0) {
        const th = Math.min(ex, k.turn.max - k.turn.free) * k.wy;
        R.rotation.y += th; if (Math.abs(ang()) > Math.abs(a0)) R.rotation.y -= 2 * th;   // (sens qui ramène le ballon devant)
        R.updateMatrixWorld(true); k.yaw = th;
      }
    }
    let leg = k.leg;
    if (leg == null) {
      // Touche, contrôle : jambe choisie une fois par geste (pas de changement de jambe en cours de geste) :
      // celle du côté du ballon (repère du joueur) si elle l'atteint, sinon celle qui l'atteint le mieux
      // (essai des deux jambes, pose remise ensuite) — ni jambe croisée, ni jambe tendue vers l'arrière.
      if (e._ikLeg?.gid === k.gid) leg = e._ikLeg.leg;
      else {
        P3.root.updateMatrixWorld(true); const qz = P3.root.worldToLocal(V.copy(Cc)).z;
        const side = Math.abs(qz) > 0.06 ? (qz > 0 ? 1 : 0) : toeOf(0).distanceTo(Cc) < toeOf(1).distanceTo(Cc) ? 0 : 1;
        const err = (lg) => {
          const Lg = P3.legs[lg], s0 = [Lg.hip.rotation.x, Lg.hip.rotation.z, Lg.knee.rotation.z];
          const dir = toeOf(lg).sub(Cc); if (dir.lengthSq() < 1e-8) dir.set(-1, 0, 0);
          P3.ikLeg(lg, Cc.clone().add(dir.normalize().multiplyScalar(BALL_R)), 1);
          const r = Math.abs(toeOf(lg).distanceTo(Cc) - BALL_R);
          Lg.hip.rotation.x = s0[0]; Lg.hip.rotation.z = s0[1]; Lg.knee.rotation.z = s0[2]; P3.root.updateMatrixWorld(true);
          return r;
        };
        const e0 = err(side); leg = side;
        if (e0 > 0.02) { const e1 = err(1 - side); if (e1 < e0 - 0.01) leg = 1 - side; }
        if (k.gid != null) e._ikLeg = { gid: k.gid, leg };
      }
    }
    k.legUsed = leg; k.side = 0;
    if (k.leg != null && k.w > 0) {
      // Frappe du pied décidé par le moteur, ballon du côté de l'autre pied : à l'affichage, le joueur se
      // décale latéralement (au plus 0,35 m) pour que le ballon soit devant le pied de frappe, au lieu de
      // croiser la jambe derrière la jambe d'appui.
      const R = P3.root; R.updateMatrixWorld(true);
      const q = R.worldToLocal(V.copy(Cc)), sg = leg === 1 ? 1 : -1, want = SIDE_OK * sg;
      if (q.x > -0.1 && sg * q.z < SIDE_OK) {
        const del = Math.max(-0.35, Math.min(0.35, q.z - want)) * k.w;
        const ax = R.localToWorld(V.set(0, 0, 1)).sub(R.position); ax.y = 0; ax.normalize();
        R.position.addScaledVector(ax, del); R.updateMatrixWorld(true); k.side = Math.abs(del);
      }
    }
    P3.root.updateMatrixWorld(true);
    if (P3._legLen == null) { const L3 = P3.legs[leg], s0 = L3.hip.rotation.clone(), k0 = L3.knee.rotation.z; L3.hip.rotation.set(0, 0, 0); L3.knee.rotation.z = 0; P3.root.updateMatrixWorld(true); P3._legLen = toeOf(leg).distanceTo(L3.hip.getWorldPosition(new THREE.Vector3())); L3.hip.rotation.copy(s0); L3.knee.rotation.z = k0; P3.root.updateMatrixWorld(true); }
    const tooHigh = Cc.y - BALL_R > 0.75;
    let hip = P3.legs[leg].hip.getWorldPosition(new THREE.Vector3()), need = Cc.distanceTo(hip) - BALL_R - P3._legLen * 0.85;
    k.lunge = 0;
    if (need > 0 && k.w > 0 && !tooHigh) {
      // Fente : le corps se porte vers le ballon (horizontalement), au plus 0,5 m.
      const R = P3.root.position, dx = Cc.x - R.x, dz = Cc.z - R.z, dl = Math.hypot(dx, dz) || 1, sft = Math.min(0.5, need) * k.w;
      R.x += (dx / dl) * sft; R.z += (dz / dl) * sft; k.lunge = sft;
      P3.root.updateMatrixWorld(true); hip = P3.legs[leg].hip.getWorldPosition(new THREE.Vector3());
    }
    const tooFar = Cc.distanceTo(hip) - BALL_R > P3._legLen * 0.97;
    k.reach = tooFar ? 'hors de portée' : tooHigh ? 'ballon haut' : k.lunge > 0.005 ? 'fente' : 'ok';
    if (k.w > 0 && !tooFar && !tooHigh) {
      const t0 = toeOf(leg), dir = t0.clone().sub(Cc); if (dir.lengthSq() < 1e-8) dir.set(-1, 0, 0);
      P3.ikLeg(leg, Cc.clone().add(dir.normalize().multiplyScalar(BALL_R)), k.w);
    }
  }
  /**
   * Anti-pénétration (étape 6b, rendu seulement) : pour un joueur proche du ballon affiché, aucun
   * bout de pied n'entre dans le ballon ; au pas d'un contact physique du joueur (k.dtc ≤ 1 pas), une
   * pénétration de 8 mm est tolérée (contact).
   */
  antiPen(e, p, flip, VB) {
    const [bx, bz] = this.toWorld(VB.x, VB.y, flip), by = BALL_R + VB.h * 26, R = e.p3.root.position;
    // (6c-A) Gestes aériens et contrôles hauts : la tête, la poitrine et les genoux n'entrent pas non plus dans le
    // ballon hors du pas du contact (ballon amorti contre la poitrine, ballon qui repart de la tête) : le corps
    // s'en écarte (au plus 0,3 m, dans la direction ballon → partie du corps).
    if ((p._air || (p._ik && p._ik.part)) && Math.hypot(bx - R.x, bz - R.z) < 1.4) {
      const C = new THREE.Vector3(bx, by, bz), V = (this._apB ||= new THREE.Vector3()), atC = p._ik && Math.abs(p._ik.dtc) <= 1 / 96 + 1e-6;
      const rMin = atC ? BALL_R - 0.008 : BALL_R; let moved = 0;
      for (let pass = 0; pass < 3; pass++) {
        e.p3.root.updateMatrixWorld(true);
        let worst = 0, wq = null;
        // (mains et pieds exclus : seuls le front, la poitrine et les genoux font écarter tout le corps ; les genoux
        // seulement pour un contrôle de la cuisse — sinon un bras levé ou un genou pousserait la tête hors du contact)
        // Pendant la fenêtre du contact (poids de la cinématique inverse > 0), seule la partie du contact compte : la
        // poitrine d'un joueur penché sur un ballon bas ne doit pas repousser la tête au moment du coup de tête.
        const thigh = p._ik?.part === 'cuisse', only = p._ik && p._ik.w > 0 ? ({ 'tête': 'tête', 'poitrine': 'poitrine', 'cuisse': 'genou' })[p._ik.part] : null;
        for (const [nm, q, ctr] of this.bodySurf(e.p3, C)) { if (nm.startsWith('pied') || nm.startsWith('main') || (nm.startsWith('genou') && !thigh) || (only && !nm.startsWith(only))) continue; const d = q.distanceTo(C) - rMin; if (d < worst) { worst = d; wq = ctr || q.clone(); } }
        if (worst >= 0) break;
        // Sortie : dans la direction centre du ballon → centre de la partie qui pénètre, en 3D (robuste même quand
        // le ballon est déjà engagé dans la tête ; un ballon posé sur la tête fait baisser le joueur).
        let ax = wq.x - bx, ay = wq.y - by, az = wq.z - bz; if (Math.hypot(ax, ay, az) < 0.01) { ax = R.x - bx; ay = 0; az = R.z - bz; }
        const al = Math.hypot(ax, ay, az) || 1; ax /= al; ay /= al; az /= al;
        const push = Math.min(0.3 - moved, -worst + 0.004); if (push <= 0) break;
        R.x += ax * push; R.y += ay * push; R.z += az * push; moved += push;
      }
      e.p3.root.updateMatrixWorld(true);
    }
    if (Math.hypot(bx - R.x, bz - R.z) > 1.3 || by > 1.2) return;
    const C = (this._apC ||= new THREE.Vector3()).set(bx, by, bz), V = (this._apV ||= new THREE.Vector3());
    const atContact = p._ik && Math.abs(p._ik.dtc) <= 1 / 96 + 1e-6, rMin = atContact ? BALL_R - 0.008 : BALL_R;
    for (const leg of [0, 1]) for (let pass = 0; pass < 3; pass++) {
      e.p3.root.updateMatrixWorld(true);
      const t = e.p3.legs[leg].ankle.localToWorld(V.set(0.1, -0.05, 0)), r = t.distanceTo(C);
      if (r >= rMin) break;
      // Sortie du ballon : radialement, puis (passes suivantes) en levant le pied au-dessus du ballon.
      const dir = t.clone().sub(C); if (dir.lengthSq() < 1e-8) dir.set(-1, 0, 0);
      if (pass > 0) dir.normalize().add(V.set(0, pass, 0));
      e.p3.ikLeg(leg, C.clone().add(dir.normalize().multiplyScalar(rMin + 0.004)), 1);
    }
  }

  /**
   * Banc d'essai de la tête (outil, étape 6c-A) : un joueur seul, immobile, orienté +x (face 0), ballon placé à
   * l'angle `ang` (0 = devant, π = derrière) et à la hauteur `h` ; contact de la tête au poids maximal. Renvoie
   * la zone de la tête touchée, la distance tête et poitrine ↔ ballon, l'angle entre le regard et le ballon.
   */
  headTest(cases) {
    const e = [...this.players.values()][0]; if (!e) return null;
    const P3 = e.p3, out = [], V = new THREE.Vector3();
    for (const [ang, dist, h, mh, part0] of cases) { const part = part0 || 'tête', ctrl = part !== 'tête';
      if (P3.mhGroup) P3.showMH(!!mh);
      const p = { face: 0, speed: 0, phase: 0, id: 0, x: 0.5, y: 0.5, jump: 0.45 * 0.5 };
      const bx = 52.5 + dist * Math.cos(ang), by = 34 + dist * Math.sin(ang), bz = h;
      p._ik = { w: 1, wy: 1, leg: null, at: { x: bx, y: by, z: bz }, dtc: 0, gid: 9e9 + out.length, part, ctrlAir: ctrl, turn: { rise: 0.22, fall: 0.18, free: Math.PI / 3, max: Math.PI * 0.75 } };
      p._air = { gid: p._ik.gid, u: 0.5, contact: true, part, ctrl, at: { x: bx, y: by, z: bz } };
      const [x, z] = this.toWorld(0.5, 0.5, false); P3.root.position.set(x, 0, z); P3._sm = null;
      const VB = { x: bx / L, y: by / W, h: Math.max(0, bz - 0.11) / 26 };
      P3.pose(p, false, { dt: 0.016, ballAng: Math.atan2(by - 34, bx - 52.5) }); P3._sm = null;
      P3.root.updateMatrixWorld(true); const [cx0, cz0] = this.toWorld(VB.x, VB.y, false); const q0 = P3.root.worldToLocal(new THREE.Vector3(cx0, 1.5, cz0)); const rootPos = P3.root.position.toArray().map((v) => +v.toFixed(2)); const ry0 = +P3.root.rotation.y.toFixed(2);
      this.applyAir(e, p, false, VB); this.applyIK(e, p, false, VB); this.antiPen(e, p, false, VB); P3.root.updateMatrixWorld(true);
      const [cx, cz] = this.toWorld(VB.x, VB.y, false), C = new THREE.Vector3(cx, BALL_R + VB.h * 26, cz);
      const hq = P3.surfNearest('head', C), hc = P3.surfCenter('head'), ch = P3.surfNearest('chest', C);
      const inv = new THREE.Matrix4().copy(P3.headPivot.matrixWorld).invert(), a = hq.clone().applyMatrix4(inv), c = hc.clone().applyMatrix4(inv), dx = a.x - c.x, dy = a.y - c.y, dz = a.z - c.z, hh = Math.hypot(dx, dz);
      const zone = dy > hh * 1.2 ? 'dessus' : dx > Math.abs(dz) * 0.7 ? 'front' : dx < -Math.abs(dz) * 0.7 ? 'arrière' : 'côté';
      const o = P3.headPivot.localToWorld(V.set(0, 0, 0)).clone(), f = P3.headPivot.localToWorld(new THREE.Vector3(1, 0, 0)).sub(o).normalize(), tb = C.clone().sub(o).normalize();
      out.push({ ang: +(ang * 57.3).toFixed(0), h, mh: !!mh, zone, tete: +(hq.distanceTo(C) - BALL_R).toFixed(3), poitrine: +(ch.distanceTo(C) - BALL_R).toFixed(3), regard: +(Math.acos(Math.max(-1, Math.min(1, f.dot(tb)))) * 57.3).toFixed(0), yaw: +(p._ik.yaw || 0).toFixed(2), lean: +(p._ik.lean || 0).toFixed(2), sens: p._ik.headFront ? 'avant' : 'arrière', rootYaw: +P3.root.rotation.y.toFixed(2), q0: [+q0.x.toFixed(2), +q0.z.toFixed(2)], ry0, rootAfter: P3.root.position.toArray().map((v) => +v.toFixed(2)), headC: hc.toArray().map((v) => +v.toFixed(2)), headQ: hq.toArray().map((v) => +v.toFixed(2)), ballW: C.toArray().map((v) => +v.toFixed(2)), crouch: p._ik.crouch, lunge: p._ik.lunge, upZ: +P3.upper.rotation.z.toFixed(2), hpZ: +P3.headPivot.rotation.z.toFixed(2), hpY: +P3.headPivot.rotation.y.toFixed(2), bodyZ: +P3.body.rotation.z.toFixed(2) });
    }
    return out;
  }
  /**
   * Banc d'essai du gardien (6c-B, outil) : gardien seul face à +x ; pour chaque cas [lat (m), haut (m), devant (m),
   * résultat, plongeon 0/1, modèle réaliste 0/1], le ballon arrive de face ; renvoie la distance des gants au ballon
   * au contact, l'écart des deux mains, la pénétration d'une autre partie du corps ; ballon tenu (après 0,5 s).
   */
  /** Banc (outil) : côté des gants dans le repère du gardien pour un plongeon de côté donné, sans cinématique inverse. */
  diveSideTest() {
    const e = [...this.players.values()][0], P3 = e.p3, out = [];
    for (const side of [1, -1]) for (const face of [0, 1.2, Math.PI]) {
      const p = { face, speed: 0, phase: 0, id: 0, x: 0.5, y: 0.5, gk: true, dive: 0.4, diveSide: side, diveH: 0.4 };
      const [x, z] = this.toWorld(0.5, 0.5, false); P3.root.position.set(x, 0, z); P3._sm = null;
      P3.pose(p, false, { dt: 0.016, ballNear: true }); P3.root.updateMatrixWorld(true);
      const hz = P3.arms.map((a) => +P3.root.worldToLocal(a.hand.getWorldPosition(new THREE.Vector3())).z.toFixed(2));
      out.push({ side, face: +face.toFixed(2), handsLocalZ: hz });
    }
    return out;
  }
  gkTest(cases) {
    const e = [...this.players.values()].find((x) => x.p3 && this.v.players.get(x.id)?.gk) || [...this.players.values()][0]; if (!e) return null;
    const P3 = e.p3, out = [];
    for (const [lat, h, fwd0, res, dive, mh, face = 0] of cases) {
      if (P3.mhGroup) P3.showMH(!!mh);
      const fwd = fwd0 * (Math.cos(face) < 0 ? -1 : 1), bx = 52.5 + fwd, by = 34 + lat, VB = { x: bx / L, y: by / W, h: Math.max(0, h - 0.11) / 26 };
      const sg = lat >= 0 ? 1 : -1, py = dive ? (34 + lat - sg * 0.85) / W : 0.5;
      const p = { face, speed: 0, phase: 0, id: 0, x: 0.5, y: py, gk: true, dive: dive ? 0.45 : 0, diveDir: sg, diveH: Math.min(1, h / 2.2) };
      p._gk = { w: 1, dtc: 0, res, vin: { x: -20, y: 0, z: 0 }, at: { x: bx, y: by, z: h }, gid: 1, kind: dive ? 'plongeon' : 'mains' };
      const [x, z] = this.toWorld(0.5, py, false); P3.root.position.set(x, 0, z); P3.root.rotation.y = 0; P3._sm = null; e._hold = null;
      P3.pose(p, false, { dt: 0.016, ballAng: Math.atan2(lat, fwd), ballNear: true }); P3._sm = null;
      if (p.dive > 0 && p.dive < 0.3) P3.groundContact();
      const hands0 = [0, 1].map((i) => { const [cx0, cz0] = this.toWorld(VB.x, VB.y, false), q = P3.surfNearest('hand' + i, new THREE.Vector3(cx0, Math.max(BALL_R, h), cz0)); return q ? +(q.distanceTo(new THREE.Vector3(cx0, Math.max(BALL_R, h), cz0)) - BALL_R).toFixed(2) : null; });
      if (!this._gkNoIK) this.applyGK(e, p, false, VB, false); P3.root.updateMatrixWorld(true);
      const [cx, cz] = this.toWorld(VB.x, VB.y, false), C = new THREE.Vector3(cx, Math.max(BALL_R, h), cz);
      const hd = [0, 1].map((i) => { const q = P3.surfNearest('hand' + i, C); return q ? +(q.distanceTo(C) - BALL_R).toFixed(3) : null; });
      let other = null; for (const [nm, q] of this.bodySurf(P3, C)) { if (nm.startsWith('main') || nm.startsWith('pied')) continue; const dd = q.distanceTo(C) - BALL_R; if (other == null || dd < other.d) other = { d: +dd.toFixed(3), part: nm }; }
      const root = P3.root.position.clone(); root.x -= x; root.z -= z;
      // Ballon tenu : 0,6 s après la prise (ramené contre la poitrine), mains posées de part et d'autre.
      let held = null;
      if (res === 'capté') {
        const D6 = this.v.disp6 || {}, tD0 = D6.tD; e._hold = null;
        const q = { ...p, dive: 0 }; q._gk = null;
        for (const tt of [0, 0.2, 0.6]) { D6.tD = 100 + tt; P3.root.position.set(x, 0, z); P3.pose(q, false, { dt: 0.016, ballAng: 0, ballNear: true, holding: true }); P3._sm = null; this.applyGK(e, q, false, VB, true); }
        D6.tD = tD0; const Ch = e._heldPos; P3.root.updateMatrixWorld(true);
        const hh = [0, 1].map((i) => { const qq = P3.surfNearest('hand' + i, Ch); return qq ? +(qq.distanceTo(Ch) - BALL_R).toFixed(3) : null; });
        let oc = null; for (const [nm, qq] of this.bodySurf(P3, Ch)) { if (nm.startsWith('main') || nm.startsWith('pied')) continue; const dd = qq.distanceTo(Ch) - BALL_R; if (oc == null || dd < oc.d) oc = { d: +dd.toFixed(3), part: nm }; }
        held = { mains: hh, autre: oc, h: +Ch.y.toFixed(2) };
      }
      const dbg = { pid: e.id, sx: P3.legs[0].hip.parent === P3.body ? 1 : 0, bodyRx: +P3.body.rotation.x.toFixed(2), handsLocal: P3.arms.map((a) => P3.root.worldToLocal(a.hand.getWorldPosition(new THREE.Vector3())).toArray().map((v) => +v.toFixed(2))), ballLocal: P3.root.worldToLocal(C.clone()).toArray().map((v) => +v.toFixed(2)) };
      out.push({ lat, h, fwd, res, dive, mh: !!mh, face, dbg, sansIK: hands0, gants: hd, autre: other, corps: root.toArray().map((v) => +v.toFixed(2)), tenu: held });
    }
    return out;
  }
  calib6() {
    const e = [...this.players.values()][0]; if (!e) return null;
    const P3 = e.p3, V = new THREE.Vector3(), out = {};
    const base = { face: 0, speed: 0, phase: 0, id: 0, x: 0.5, y: 0.5 };
    const toe = (leg) => { P3.root.updateMatrixWorld(true); const w = P3.legs[leg].ankle.localToWorld(V.set(0.1, -0.05, 0)); const l = P3.root.worldToLocal(w.clone()); return l; };
    const sweep = (name, mk, leg) => {
      const rows = [];
      P3.root.position.set(0, 0, 0); P3._sm = null;
      for (let u = 0; u <= 1.0001; u += 0.02) { P3.pose({ ...base, ...mk(u) }, false, { dt: 0.016 }); P3._sm = null; const l = toe(leg); rows.push([+u.toFixed(2), +l.x.toFixed(3), +l.y.toFixed(3), +l.z.toFixed(3)]); }
      out[name] = rows;
    };
    for (const [id, pow, side] of [[0, 0.5, true], [1, 0.5, true], [0, 0.85, false], [1, 0.85, false], [0, 1, false]]) sweep(`frappe id${id} puissance${pow}${side ? ' plat' : ''}`, (u) => ({ id, kick: 0.32 * (1 - u) || 1e-6, kickMax: 0.32, kickFoot: 'R', kickPow: pow, kickSide: side }), 1);
    sweep('touche de conduite', (u) => ({ touch: 0.14 * (1 - u) || 1e-6, touchMax: 0.14, touchFoot: 'R', touchIn: true }), 1);
    sweep('contrôle', (u) => ({ ctrl: 0.3 * (1 - u) || 1e-6, ctrlH: 0.11 }), 1);
    // Volumes (étape 6c-A) : boîtes englobantes de la tête (repère de headPivot) et du buste (repère de upper),
    // et des genoux, au repos — pour placer les points de contact sur la SURFACE du corps.
    { P3.root.position.set(0, 0, 0); P3._sm = null; P3.pose({ ...base }, false, { dt: 0.016 }); P3.root.updateMatrixWorld(true);
      const box = (grp, frame) => { const b = new THREE.Box3(), inv = new THREE.Matrix4().copy(frame.matrixWorld).invert(); grp.traverse((o) => { if (o.isMesh && o.geometry) { o.geometry.computeBoundingBox(); const bb = o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld).applyMatrix4(inv); b.union(bb); } }); return [b.min.toArray().map((x) => +x.toFixed(3)), b.max.toArray().map((x) => +x.toFixed(3))]; };
      const headOnly = new THREE.Group(); out['volume tête'] = box(P3.headPivot, P3.headPivot);
      const up = { traverse: (f) => { for (const c of P3.upper.children) if (c !== P3.headPivot && !P3.arms.some((a) => a.sh === c)) c.traverse(f); } };
      out['volume buste'] = box(up, P3.upper);
      out['volume genou'] = box(P3.legs[1].knee, P3.legs[1].knee);
      out['skinné'] = !!P3.skinned || null;
      { const o = P3.root.localToWorld(new THREE.Vector3(0, 0, 0)), f = P3.root.localToWorld(new THREE.Vector3(1, 0, 0)), inv = new THREE.Matrix4().copy(P3.headPivot.matrixWorld).invert();
        const a = o.clone().applyMatrix4(inv), b = f.clone().applyMatrix4(inv); out['avant du joueur dans le repère de la tête'] = [b.x - a.x, b.y - a.y, b.z - a.z].map((x) => +x.toFixed(3));
        const h = P3.surfSamples('head') || []; const c = new THREE.Vector3(); for (const q of h) c.add(q); c.multiplyScalar(1 / Math.max(1, h.length));
        out['tête : centre, étendue x/y/z'] = [c.toArray().map((x) => +x.toFixed(3)), ['x', 'y', 'z'].map((k) => [+Math.min(...h.map((q) => q[k])).toFixed(3), +Math.max(...h.map((q) => q[k])).toFixed(3)])]; }
    }
    // Saut (étape 6c-A) : hauteur et avancée du sommet de la tête, et hauteur du bassin, pour chaque séquence de saut.
    const head = () => { P3.root.updateMatrixWorld(true); const w = P3.headPivot.localToWorld(V.set(0.05, 0.1, 0)); const l = P3.root.worldToLocal(w.clone()); return l; };
    for (let id = 0; id < Math.max(1, JUMPS.length); id++) {
      const rows = []; P3.root.position.set(0, 0, 0); P3._sm = null;
      for (let u = 0; u <= 1.0001; u += 0.02) { P3.pose({ ...base, id, jump: 0.45 * (1 - u) || 1e-6 }, false, { dt: 0.016 }); P3._sm = null; const h = head(); const ch = P3.root.worldToLocal(P3.upper.localToWorld(V.set(0.12, 0.25, 0)).clone()); rows.push([+u.toFixed(2), +h.x.toFixed(3), +h.y.toFixed(3), +P3.headPivot.rotation.z.toFixed(2), +P3.body.position.y.toFixed(3), +ch.y.toFixed(3)]); }
      out[`saut id${id}`] = rows;
    }
    return out;
  }

  updateCamera(dt) {
    const v = this.v, VP = v.dispPlayers || v.players, VB = v.dispBall || v.ball, VH = v.dispPlayers ? v.dispHolder : v.holder;   // (état d'affichage différé, étape 6b)
    // La caméra anticipe : elle regarde là où le ballon va (vitesse × 0,45 s).
    const P = v.dispPhys || v.phys, lead = 0.45;
    const lx = P ? (P.x + P.vx * lead) / L : VB.x, ly = P ? (P.y + P.vy * lead) / W : VB.y;
    const [bx, bz] = this.toWorld(Math.max(-0.02, Math.min(1.02, lx)), Math.max(0, Math.min(1, ly)));
    let mode = this.camMode;
    const celebrating = v.banner && v.banner.text === 'BUT !';
    // Réalisation après un but (comme à la télé) : gros plan sur le buteur qui célèbre, plan sur
    // son entraîneur, plan sur un adversaire abattu ; le ralenti est filmé depuis derrière le but.
    if (this._goalSeq && !v.replaying && this.camMode !== 'intro') { if (this.goalShot(dt)) return; this._goalSeq = false; this._gs = null; this.snapCam = true; }
    if (v.replaying) { this.setLower(null); if (this.replayShot(dt, bx, bz)) return; } else { this._replayCam = false; this._replayKey = null; }
    if (v.replaying || celebrating) mode = 'close';
    const want = new THREE.Vector3(), look = new THREE.Vector3(bx, 0, bz * 0.35);
    if (mode === 'intro') {
      // Avant-match : lent travelling autour du stade, du haut des tribunes vers le terrain.
      const t = (this._introT = (this._introT || 0) + dt);
      const a = -0.9 + t * 0.2;
      want.set(Math.sin(a) * 78, Math.max(14, 34 - t * 2.4), Math.cos(a) * 64); look.set(0, 0, 0); this.camera.fov = 36; this.clampCam(want);
      this.camPos.lerp(want, 1 - Math.exp(-dt * 1.6)); this.camLook.lerp(look, 1 - Math.exp(-dt * 2));
      this.camera.position.copy(this.camPos); this.camera.lookAt(this.camLook); this.camera.updateProjectionMatrix();
      return;
    }
    // Réalisation TV : le réalisateur change de plan selon l'action (plan large, plan serré sur
    // le porteur dans les 30 derniers mètres, derrière le but sur une frappe, bord terrain sur
    // les coups de pied arrêtés), sans couper trop souvent.
    if (mode !== 'director') this.setLower(null);
    if (mode === 'director') {
      // Grosse occasion manquée : gros plan sur le joueur, mains sur la tête.
      if (!v.replaying && v.hl !== 'skip') {
        let miss = null;
        for (const [id, p] of VP) if ((p.headHands || 0) > 1.2) { miss = id; break; }
        if (miss != null && (this._missId !== miss || performance.now() - this._missAt < 1800)) {
          if (this._missId !== miss) { this._missId = miss; this._missAt = performance.now(); }
          const e = this.players.get(miss);
          if (e) { const q = e.p3.root.position; this.placeCam(new THREE.Vector3(q.x + 3.8, 1.7, q.z + 2.6), new THREE.Vector3(q.x, 1.35, q.z), 32, dt, performance.now() - this._missAt < 60); return; }
        }
      }
      // Réalisation : pendant le jeu, on reste sur la caméra principale (elle zoome dans le
      // dernier tiers, sans couper en pleine action). On coupe sur les arrêts de jeu : gros plan
      // sur le joueur fauché (avec son nom), plan derrière le tireur d'un coup franc / penalty,
      // plan surélevé derrière le poteau de corner.
      const L2 = v.live, rs = L2?.restart;
      let want2 = 'tv';
      const nowT = performance.now();
      if (this._victim && nowT - this._victim.at < 1700) want2 = 'victim';
      else if (rs && rs.kind === 'corner') want2 = 'corner';
      else if (rs && rs.kind === 'penalty') want2 = 'pen';
      else if (rs && rs.kind === 'freekick' && Math.hypot((rs.side === 0 ? L : 0) - rs.x, W / 2 - rs.y) < 32) want2 = 'fk';
      const hold = this._dirMode === 'victim' ? 1500 : 1200;
      if (want2 !== this._dirMode && (want2 !== 'tv' || nowT - (this._dirAt || 0) > hold)) { this._dirMode = want2; this._dirAt = nowT; }
      mode = this._dirMode || 'tv';
      this.setLower(mode === 'victim' ? this._victim?.pid : null);
      if (mode === 'victim') {
        const e = this.players.get(this._victim?.pid);
        if (e) { const q = e.p3.root.position; want.set(q.x + 3.2, 1.6, q.z + (q.z > 0 ? -3.2 : 3.2)); look.set(q.x, 0.8, q.z); this.camera.fov = 34; }
        else mode = 'tv';
      } else if (rs && (mode === 'corner' || mode === 'pen' || mode === 'fk')) {
        const [rx, rz] = this.toWorld(rs.x / L, rs.y / W);
        const [gx2, gz2] = this.toWorld(rs.side === 0 ? 1 : 0, 0.5);
        const dx = gx2 - rx, dz = gz2 - rz, dl = Math.hypot(dx, dz) || 1;
        if (mode === 'corner') { want.set(rx - Math.sign(rx) * 3, 10, rz - Math.sign(rz) * -4); look.set(gx2 - Math.sign(gx2) * 9, 0, 0); this.camera.fov = 40; }
        else if (mode === 'pen') { want.set(rx - (dx / dl) * 7, 2.3, rz - (dz / dl) * 7); look.set(gx2, 1.2, gz2); this.camera.fov = 32; }
        else { want.set(rx - (dx / dl) * 10, 4.2, rz - (dz / dl) * 10); look.set(gx2, 1, gz2); this.camera.fov = 36; }
      }
    }
    if (mode === 'tv') {
      // Caméra principale de télévision : en tribune, à hauteur du rond central (elle ne fait
      // presque que pivoter, comme un vrai cadreur), et elle règle son zoom pour cadrer ~38 m de
      // terrain autour du ballon : plus serré dans le dernier tiers, plus large sur un long ballon
      // ou un ballon aérien.
      const bpos = this.ball?.position, bsp = P ? Math.hypot(P.vx, P.vy) : 0;
      const camX = Math.max(-16, Math.min(16, bx * 0.3));
      want.set(camX, 22, 60);
      look.set(bx, Math.min(5, (bpos?.y || 0) * 0.45), bz * 0.8);
      const lastThird = Math.abs(bx) > L / 2 - 33;
      const widthT = (lastThird ? 33 : 40) + Math.min(14, Math.max(0, bsp - 12) * 0.9) + Math.min(10, (bpos?.y || 0) * 1.2);
      this._tvW = (this._tvW ?? widthT) + (widthT - (this._tvW ?? widthT)) * Math.min(1, dt * (widthT > (this._tvW ?? 0) ? 3 : 0.9));
      const dCam = Math.hypot(look.x - want.x, look.y - want.y, look.z - want.z);
      const hf = 2 * Math.atan(this._tvW / 2 / dCam), asp = this.camera.aspect || 16 / 9;
      this.camera.fov = Math.max(12, Math.min(48, THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(hf / 2) / asp))));
      // Sécurité : si le ballon sort du cadre (longue passe, dégagement), le cadreur rattrape plus vite.
      if (bpos) {
        const ndc = bpos.clone().project(this.camera);
        const off = ndc.z > 1 ? 3 : Math.max(Math.abs(ndc.x) / 0.72, Math.abs(ndc.y) / 0.65);
        this._camBoost = off > 1 ? Math.min(12, 3 + (off - 1) * 18) : 0;
      }
    }
    if (mode !== 'tv') this._camBoost = 0;
    if (mode === 'tv') { /* plan télé posé ci-dessus */ }
    else if (mode === 'pitchside') { want.set(Math.max(-48, Math.min(48, bx * 0.85)), 1.7, W / 2 + 3.2); look.set(bx, 1.1, bz); this.camera.fov = 42; }     // caméra à hauteur d'homme, au bord de la ligne
    else if (mode === 'tribune') { want.set(Math.max(-30, Math.min(30, bx * 0.6)), 34, 74); look.set(bx * 0.8, 0, bz * 0.25); this.camera.fov = 34; }  // tout en haut de la tribune principale
    else if (mode === 'player') {
      // Derrière le porteur (ou le ballon), à 9 m, dans le sens de son jeu.
      const hp = VH != null ? VP.get(VH) : null;
      const [hx, hz] = hp ? this.toWorld(hp.x, hp.y) : [bx, bz];
      const ang = hp ? (this.flip() ? hp.face + Math.PI : hp.face) : 0;
      want.set(hx - Math.cos(ang) * 9, 4.2, hz - Math.sin(ang) * 9);
      look.set(hx + Math.cos(ang) * 8, 1, hz + Math.sin(ang) * 8); this.camera.fov = 50;
    }
    else if (mode === 'close') { want.set(bx * 0.9 - 4, 13, bz + 30); look.set(bx, 1, bz); this.camera.fov = 34; }
    else if (mode === 'high') { want.set(bx * 0.4, 95, 52); look.set(bx * 0.4, 0, 0); this.camera.fov = 38; }
    else if (['victim', 'corner', 'pen', 'fk'].includes(mode)) { /* plan déjà posé par la réalisation */ }
    else { const side = bx >= 0 ? 1 : -1; want.set(side * (L / 2 + 22), 12, bz * 0.3); look.set(bx, 0, bz); this.camera.fov = 40; }
    const k = 1 - Math.exp(-dt * ((mode === 'close' ? 3 : 2.2) + (this._camBoost || 0)));
    // Changement de plan = coupe franche (comme en réalisation télé), jamais de glissement d'un
    // plan à l'autre ; à l'intérieur d'un même plan, la caméra suit l'action en douceur.
    if (mode !== this._shotMode) { this._shotMode = mode; this.snapCam = true; if (mode === 'tv') this._tvW = null; }
    const kk = this.snapCam ? 1 : k; this.snapCam = false;
    this.clampCam(want);
    this.camPos.lerp(want, kk);
    this.camLook.lerp(look, kk);
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.camLook);
    this.camera.updateProjectionMatrix();
  }

  /**
   * Halo lumineux de nuit : les projecteurs, les lignes et les maillots clairs « bavent »
   * légèrement dans l'image, comme à la télé. Chargé seulement quand il sert ; abandonné si
   * l'appareil ne suit pas (voir adaptQuality).
   */
  /**
   * Post-traitement (Ultra, ordinateur) : étalonnage « diffusion télé » (un peu plus chaud,
   * saturé et contrasté, léger vignettage) et, la nuit, halo des projecteurs (bloom).
   */
  async initBloom(night = true) {
    try {
      const [{ EffectComposer }, { RenderPass }, { UnrealBloomPass }, { OutputPass }, { ShaderPass }] = await Promise.all([
        import('../vendor/three-post/EffectComposer.js'), import('../vendor/three-post/RenderPass.js'),
        import('../vendor/three-post/UnrealBloomPass.js'), import('../vendor/three-post/OutputPass.js'), import('../vendor/three-post/ShaderPass.js')]);
      if (this.destroyed) return;
      const v = this.v;
      const c = new EffectComposer(this.renderer);
      c.addPass(new RenderPass(this.scene, this.camera));
      if (night) c.addPass(new UnrealBloomPass(new THREE.Vector2(v.cssW, v.cssH), 0.6, 0.55, 0.8));
      c.addPass(new OutputPass());
      c.addPass(new ShaderPass({
        uniforms: { tDiffuse: { value: null }, uSat: { value: night ? 1.05 : 1.1 }, uCon: { value: 1.06 }, uWarm: { value: new THREE.Vector3(...(night ? [0.99, 1, 1.03] : [1.04, 1.01, 0.95])) }, uVig: { value: 0.22 } },
        vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
        fragmentShader: `uniform sampler2D tDiffuse; uniform float uSat, uCon, uVig; uniform vec3 uWarm; varying vec2 vUv;
          void main() {
            vec4 c = texture2D(tDiffuse, vUv);
            vec3 col = c.rgb * uWarm;
            float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
            col = mix(vec3(l), col, uSat);
            col = (col - 0.5) * uCon + 0.5;
            col *= 1.0 - uVig * smoothstep(0.38, 0.9, distance(vUv, vec2(0.5)));
            gl_FragColor = vec4(clamp(col, 0.0, 1.0), c.a);
          }`,
      }));
      c.setPixelRatio(this.renderer.getPixelRatio());
      c.setSize(v.cssW, v.cssH);
      this.composer = c;
    } catch (e) { console.warn('post-traitement indisponible', e); this.composer = null; }
  }
  /** Bandeau du nom (numéro, nom, couleur de l'équipe) ; null pour le masquer. */
  setLower(pid) {
    if (!this.lower || this._lowerPid === pid) return;
    this._lowerPid = pid;
    if (pid == null) { this.lower.classList.remove('on'); return; }
    const p = this.v.players.get(pid), nm = this.v.nameOf?.(pid) || '';
    const col = p ? this.v.colors[p.side] : '#1c2333';
    this.lower.innerHTML = `<span class="n" style="background:${col}">${p?.num ?? ''}</span><b>${String(nm).replace(/[<>&]/g, '')}</b>`;
    this.lower.classList.add('on');
  }

  /**
   * La caméra ne rentre jamais dans les tribunes : devant les virages et la grande tribune, elle
   * reste au bord du terrain ; côté caméras, elle ne passe derrière le premier rang que si elle
   * est assez haute pour voir par-dessus les gradins (passerelle télé).
   */
  clampCam(p) {
    const fx = L / 2 + 8.6, fzFar = W / 2 + 7.8, fzNear = W / 2 + 8.2;
    if (Math.abs(p.x) > fx) p.x = Math.sign(p.x) * fx;
    if (p.z < -fzFar) p.z = -fzFar;
    if (p.z > fzNear) {
      const need = 1.1 + (p.z - fzNear) * 0.56 + 3.5;
      if (p.y < need) p.z = fzNear + Math.max(0, (p.y - 4.6) / 0.56);
    }
    if (p.y < 0.6) p.y = 0.6;
    return p;
  }

  /** Pose la caméra (position, cible, focale) : douce, ou en coupe franche pour un changement de plan. */
  placeCam(pos, look, fov, dt, cut) {
    this.clampCam(pos);
    const k = cut ? 1 : 1 - Math.exp(-dt * 3.5);
    this.camPos.lerp(pos, k); this.camLook.lerp(look, k);
    this.camera.fov = fov;
    this.camera.position.copy(this.camPos); this.camera.lookAt(this.camLook); this.camera.updateProjectionMatrix();
  }
  /** Séquence de plans après un but (retourne false quand elle est finie). */
  goalShot(dt) {
    const v = this.v;
    if (!this._gs) {
      // Buteur : le joueur qui célèbre le plus longtemps (le jeu lui donne la plus longue célébration).
      let best = null, side = 0;
      for (const [id, p] of v.players) if ((p.celeb || 0) > (best?.p.celeb || 0)) { best = { id, p }; side = p.side; }
      if (!best) return false;
      let opp = null;
      for (const [id, p] of v.players) if (p.side !== side && (p.gk || !opp)) opp = { id, p };
      this._gs = { t: 0, t0: performance.now(), scorer: best.id, side, opp: opp?.id, shot: -1, ang: Math.random() * Math.PI * 2 };
    }
    const g = this._gs;
    g.t = Math.max(g.t, (performance.now() - g.t0) / 1000); // temps réel (même si l'image est lente)
    const shot = g.t < 3.4 ? 0 : g.t < 5.4 ? 1 : g.t < 7.0 ? 2 : 3;
    const cut = shot !== g.shot; g.shot = shot;
    const v3 = (x, y, z) => new THREE.Vector3(x, y, z);
    if (shot === 0) {
      const e = this.players.get(g.scorer);
      if (!e) return false;
      const q = e.p3.root.position;
      const a = g.ang + g.t * 0.35;            // travelling circulaire autour du buteur
      this.placeCam(v3(q.x + Math.cos(a) * 5.2, 1.75, q.z + Math.sin(a) * 5.2), v3(q.x, 1.25, q.z), 30, dt, cut);
      return true;
    }
    if (shot === 1) {
      const c = this.coaches?.[g.side];
      if (!c) { g.t0 -= (5.4 - g.t) * 1000; return true; }
      const q = c.root.position;
      this.placeCam(v3(q.x + (g.side === 0 ? 4 : -4), 1.65, q.z - 4.6), v3(q.x, 1.35, q.z), 28, dt, cut);
      return true;
    }
    if (shot === 2) {
      const e = this.players.get(g.opp);
      if (!e) { g.t0 -= (7 - g.t) * 1000; return true; }
      const q = e.p3.root.position;
      this.placeCam(v3(q.x + 3.4, 1.6, q.z + 2.2), v3(q.x, 1.3, q.z), 30, dt, cut);
      return true;
    }
    return false; // retour au plan large
  }
  /** Ralenti : filmé depuis derrière le but attaqué, à hauteur de la barre. */
  /**
   * Plans du ralenti (comme à la télé) : but = 1er passage derrière le but, en hauteur, puis
   * 2e passage au ras du sol, au plus près de l'action ; faute = plan serré au bord du terrain ;
   * occasion = derrière le but. Chaque passage commence par une coupe franche.
   */
  replayShot(dt, bx, bz) {
    const R = this.v.replayLive || {}, kind = R.kind || 'goal', pass = R.pass || 0;
    const key = `${kind}${pass}`;
    const cut = this._replayKey !== key; this._replayKey = key; this._replayCam = true;
    const goalX = bx >= 0 ? L / 2 : -L / 2, sg = Math.sign(goalX) || 1;
    let want, look, fov;
    if (kind === 'foul') {
      want = new THREE.Vector3(bx + 4, 1.5, bz + (bz > 0 ? -9 : 9)); look = new THREE.Vector3(bx, 0.9, bz); fov = 30;
    } else if (kind === 'goal' && pass === 1) {
      // Au ras du sol, à hauteur du ballon, du côté du terrain : on voit le geste et le filet.
      want = new THREE.Vector3(bx - sg * 6, 1.25, bz + (bz > 0 ? -6.5 : 6.5)); look = new THREE.Vector3(bx + sg * 2, 0.9, bz); fov = 34;
    } else {
      want = new THREE.Vector3(goalX + sg * 9, 3.1, bz * 0.4 + 2); look = new THREE.Vector3(bx, 1, bz); fov = 38;
    }
    this.placeCam(want, look, fov, dt, cut);
    return true;
  }

  /** Baisse la résolution si les images mettent trop de temps à venir (PC sans grosse carte graphique), la remonte sinon. */
  adaptQuality() {
    const now = performance.now();
    // Ultra : on ne dégrade jamais l'image (sauf appareil à bout de souffle, < 15 images/s).
    if (this.gfx === 'ultra') {
      if (this._lastT) { this._acc = (this._acc || 0) + Math.min(100, now - this._lastT); this._n = (this._n || 0) + 1; }
      if (this._acc > 2000) {
        const avg = this._acc / this._n;
        // Moins de ~30 images/s : on renonce d'abord au halo de nuit, puis on baisse la résolution.
        if (avg > 34 && this.composer) { this.composer.dispose?.(); this.composer = null; }
        else if (avg > 66 && (this.quality ?? 1) > 0.7) { this.quality = 0.7; this.resize(); }
        this._acc = 0; this._n = 0;
      }
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

  /** Réactions de la foule : « ooh » sur les grosses occasions, applaudissements. */
  crowdEvent(ev) {
    const now = performance.now();
    if (ev.type === 'shot' && ev.outcome !== 'goal' && ((ev.xg || 0) >= 0.15 || ev.outcome === 'post')) { this._oohUntil = now + 2000; this._clapUntil = now + 4200; }
    else if (ev.type === 'shot' && ev.outcome === 'saved') this._clapUntil = now + 2500;
    else if (ev.type === 'skill' || ev.type === 'sub' || (ev.type === 'tackle' && ev.side === 0 && Math.random() < 0.3)) this._clapUntil = now + 2200;
  }

  /** Réactions des coachs aux événements (but, occasion, faute, carton, geste technique). */
  coachEvent(ev) {
    try { this.crowdEvent(ev); } catch { /* ignore */ }
    const C = this.coaches || [];
    const s = ev.side;
    if (s == null || s < 0) return;
    const mine = C[s], other = C[1 - s];
    if (ev.type === 'goal') { mine?.react('celebrate', 4.5); other?.react('despair', 3.5); if (!ev.replay) { this._goalSeq = true; this._gs = null; this._benchT = 6; this._benchSide = s; } }
    else if (ev.type === 'shot' && ev.outcome !== 'goal' && (ev.xg || 0) >= 0.18) { mine?.react('despair', 1.8); other?.react('applaud', 1.4); }
    else if (ev.type === 'foul') { mine?.react('protest', 1.8); other?.react('shout', 1.6); if (!ev.replay && ev.pid2 != null) this._victim = { pid: ev.pid2, at: performance.now() }; }
    else if (ev.type === 'yellow' || ev.type === 'red') mine?.react('protest', 2.6);
    else if (ev.type === 'skill') mine?.react('applaud', 1.6);
  }

  /**
   * Remplaçants assis sur le banc (les vrais joueurs du banc, en tenue) : ils se lèvent et
   * sautent sur un but de leur équipe ; ceux d'en face se prennent la tête dans les mains.
   * Version allégée (pas de petits détails, pas d'ombre) ; aucun sur les appareils « éco ».
   */
  buildBenchSubs() {
    const n = this.gfx === 'eco' ? 0 : this.gfx === 'ultra' ? 5 : 3;
    this.benchSubs = [];
    if (!n) return;
    const v = this.v;
    for (const side of [0, 1]) {
      const team = v.m.teams[side];
      const subs = (team?.bench || []).filter(Boolean).slice(0, n);
      subs.forEach((mp, i) => {
        const lk = personLook(mp.id, mp.p?.nat || '', mp.p?.age || 25);
        const base = this.mats[side];
        const p3 = new Player3D({ ...base, boot: bootMat('#111111') }, lk.skin, lk.hairColor, mp.number ?? '', v.colors[side], v.textColors[side], null, { look: lk, name: '' });
        p3.setHair(lk.hairStyle);
        p3.setDetail(false);
        p3.root.traverse((o) => { if (o.isMesh) o.castShadow = false; });
        p3.shadow.visible = false;
        const x = (side === 0 ? -9 : 9) - 2.6 + i * (5.2 / Math.max(1, n - 1));
        p3.root.position.set(x, 0, W / 2 + 4.95);
        p3.root.scale.setScalar(0.98);
        this.scene.add(p3.root);
        // Corps réaliste : survêtement aux couleurs du club (veste à manches longues, pantalon).
        const jacket = new THREE.MeshStandardMaterial({ color: v.colors[side], roughness: 0.7 });
        const pants = new THREE.MeshStandardMaterial({ color: '#15181f', roughness: 0.8 });
        const mhOpts = { skin: lk.skin, hair: lk.hairColor, hairStyle: lk.hairStyle, beard: lk.beard, eyeTex: 'brown', nat: mp.p?.nat || '', trousers: true, longSleeve: true,
          mats: { shirt: jacket, sleeve: jacket, shorts: pants, socks: pants, boot: bootMat('#111111') } };
        const b = { p3, side, ph: Math.random() * 6, mhOpts };
        if (this.mh) { p3.attachMH(this.mh, mhOpts); p3.detail = false; p3.setDetail(true); }
        this.benchSubs.push(b);
      });
    }
  }
  updateBenchSubs(dt) {
    if (!this.benchSubs?.length) return;
    this._benchT = Math.max(0, (this._benchT || 0) - dt);
    const goal = this._benchT > 0;
    for (const b of this.benchSubs) {
      b.ph += dt;
      if (goal && b.side === this._benchSide) {
        // Debout, bras au ciel, petits bonds.
        b.p3.pose({ id: 0, face: -Math.PI / 2, speed: 0, phase: 0, celeb: 1 + Math.abs(Math.sin(b.ph * 7)), celebType: 'jump' }, false, { dt });
        b.p3.root.rotation.y = Math.PI / 2;
      } else {
        // Assis, face au terrain (penché en avant quand l'adversaire vient de marquer).
        const sad = goal ? 1 : 0;
        b.p3.applyKeys({ bz: -0.05 - 0.25 * sad, by: 0, hL: 1.5, hR: 1.45, kL: -1.55, kR: -1.5, aZ: 0.35 + 2.3 * sad, aX: 0.12 + 0.4 * sad, e: 1.2 + 0.9 * sad, uz: -0.05 - 0.2 * sad });
        b.p3.root.rotation.y = Math.PI / 2;
      }
    }
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
    this.stepSpray(Math.min(0.05, dt || 0.016));
    this.stepNets(Math.min(0.05, dt || 0.016));
    this.drawDiag();
    this.updateCoaches(dt);
    this.updateBenchSubs(Math.min(0.05, dt || 0.016));
    // La foule se lève et saute après un but (la texture des tribunes « vibre »).
    {
      const cheer = (v.banner && v.banner.text === 'BUT !') || !!this._goalSeq;
      const tense = !cheer && v.inHL; // temps fort : la foule se lève à moitié
      this._cheerT = (this._cheerT || 0) + (dt || 0.016);
      const U = this.crowdU;
      if (U) {
        const sideH = this._benchSide ?? 0;
        const k = 1 - Math.exp(-(dt || 0.016) * 4);
        U.uTime.value = this._cheerT;
        U.uH.value += ((cheer && sideH === 0 ? 1 : 0) - U.uH.value) * k;
        U.uA.value += ((cheer && sideH === 1 ? 1 : 0) - U.uA.value) * k;
        U.uT.value += ((tense ? 1 : 0) - U.uT.value) * k;
        const now = performance.now();
        U.uO.value += ((now < (this._oohUntil || 0) ? 1 : 0) - U.uO.value) * (1 - Math.exp(-(dt || 0.016) * 7));
        U.uC.value += ((now < (this._clapUntil || 0) && now >= (this._oohUntil || 0) - 600 ? 1 : 0) - U.uC.value) * k;
        // Tifo géant des grands soirs : déployé avant le coup d'envoi, rangé après quelques minutes.
        if (this.bigTifo) {
          const show = !!v.m?.big && (this.camMode === 'intro' || (v.m.minute ?? 0) < 3) && !(v.m.period > 1);
          const T = this.bigTifo; T.k += ((show ? 1 : 0) - T.k) * (1 - Math.exp(-(dt || 0.016) * (show ? 0.9 : 2.5)));
          T.mesh.visible = T.k > 0.01; T.mesh.scale.set(1, Math.max(0.01, T.k), 1);
          T.mesh.material.opacity = Math.min(1, T.k * 1.4);
          T.mesh.position.y = T.y0 + Math.sin(this._cheerT * 1.7) * 0.05;
        }
        // Ola de temps en temps quand le jeu est calme (une vingtaine de secondes).
        const calm = !cheer && !tense;
        this._waveT = calm ? (this._waveT || 0) + (dt || 0.016) : 0;
        const waving = calm && this._waveT % 95 > 70;
        U.uWave.value += ((waving ? 1 : 0) - U.uWave.value) * k * 0.5;
      }
      for (const c of this.crowdGroups || []) {
        // (les virages des ultras chantent et bougent en continu)
        const target = c.ultras && !cheer ? Math.abs(Math.sin(this._cheerT * 4 + c.ph)) * 0.05 : 0;
        c.g.position.y += (target - c.g.position.y) * 0.3;
      }
      for (const f of this.flags || []) f.pole.rotation.z = Math.sin(this._cheerT * (cheer ? 6 : 2.2) + f.ph) * (cheer ? 0.5 : 0.22);
    }
    if (!document.hidden) this.adaptQuality();
    this.syncPlayers();
    tickCloth(performance.now() / 1000);
    const flip = this.flip();
    // Étape 6b : état d'affichage différé (objets d'affichage du contrat) s'il existe, sinon l'état du moteur.
    const VP = v.dispPlayers || v.players, VB = v.dispBall || v.ball, VPH = v.dispPhys || v.phys;
    const carrier = (v.dispPlayers ? v.dispHolder : v.holder) ?? (v.cur ? v.cur.carrier : null), VIH = v.dispPlayers ? v.dispInHands : v.inHands;
    const camP = this.camera.position;
    // Ultra : corps réalistes jusqu'à 85 m (toute la vue télé) ; Haute : 34 m (gros plans).
    const lodD2 = (this.gfx === 'ultra' ? (this.mh ? 85 : 40) : this.mh ? 34 : 30) ** 2;
    for (const [id, e] of this.players) {
      const p = VP.get(id);
      const [x, z] = this.toWorld(p.x, p.y, flip);
      e.p3.root.position.set(x, 0, z);
      e.p3.setDetail((x - camP.x) ** 2 + (z - camP.z) ** 2 + camP.y ** 2 < lodD2);
      const dB = Math.hypot((p.x - VB.x) * L, (p.y - VB.y) * W);
      const isCar = id === carrier;
      // Adversaire au contact (duel) : de quel côté est-il ?
      let jostle = 0, grab = 0;
      if (dB < 4 && !p.gk) for (const [id2, q] of VP) {
        if (id2 === id || q.side === p.side) continue;
        const dx = (q.x - p.x) * L, dy = (q.y - p.y) * W;
        if (dx * dx + dy * dy < 1.69) { const rel = Math.atan2(dy, dx) - (p.face || 0); jostle = Math.sin(rel) > 0 ? 1 : -1; grab = Math.cos(rel) < 0.35 && (isCar || dB < 2) ? jostle : 0; break; }
      }
      const ballAng = dB < 45 ? Math.atan2((VB.y - p.y) * W, (VB.x - p.x) * L) : null;
      e.p3.pose(p, flip, { dt: dt || 0.016, ballAng, jostle, ballNear: p.gk && dB < 30, alert: dB < 14 && !isCar && !v.restart, restFar: dB > 28 && !isCar, shield: isCar && !VIH && (p.shieldK || 0) > 0, holding: isCar && VIH && p.gk });
      e.p3.smoothPose(dt || 0.016);
      if (p._air) this.applyAir(e, p, flip, VB);   // (étape 6c-A : saut à la hauteur du ballon)
      if (p._ik) this.applyIK(e, p, flip, VB);   // (étape 6b : le pied touche le ballon là où il est, à l'instant du contact)
      if (v.dispPlayers) this.antiPen(e, p, flip, VB);
      if (e.cloth) this.updateCloth(e.cloth, p, grab, dt || 0.016);
      // Gestes au sol : après le lissage, le point le plus bas du corps est reposé sur la pelouse.
      if (p.fall > 0 || p.slide > 0 || p.hurt > 0 || p.place > 0 || p.block > 0 || (p.celeb > 0 && (p.celebType === 'knees' || p.celebType === 'slide') && ((p.speed || 0) <= 2 || (p.celebType === 'slide' && p.celeb < 2.4))) || (p.dive > 0 && p.dive < 0.3)) e.p3.groundContact();
      if (p.gk && v.dispPlayers) this.applyGK(e, p, flip, VB, isCar && VIH);   // (étape 6c-B : mains du gardien au ballon, ballon tenu entre les gants)
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
    let [bx, bz] = this.toWorld(VB.x, VB.y, flip);
    let hgt = VB.h * 26;
    // Ballon dans les mains : gardien (contre la poitrine) ou joueur qui fait la touche (au-dessus de la tête).
    let handId = carrier != null && VIH ? carrier : null;
    if (handId == null) for (const [id, p] of VP) if (p.hold > 0) { handId = id; break; }
    const handP = handId != null ? VP.get(handId) : null;
    let inHandsPos = null;
    if (handP) {
      // Le ballon est DANS les mains : on le place entre les deux mains du modèle (pose réelle :
      // plongeon, ballon serré contre la poitrine, touche au-dessus de la tête), jamais en lévitation.
      const e = this.players.get(handId);
      inHandsPos = handP.gk && e?._heldPos ? e._heldPos.clone() : this.heldBallPos(e, handP, flip);
      if (!inHandsPos) {
        const [hx, hz] = this.toWorld(handP.x, handP.y, flip);
        const fa = flip ? handP.face + Math.PI : handP.face;
        const fwd = handP.hold > 0 ? -0.12 : 0.32;
        bx = hx + Math.cos(fa) * fwd; bz = hz + Math.sin(fa) * fwd;
        hgt = (handP.hold > 0 ? 2.05 : 1.15) * K;
      }
    }
    if (inHandsPos) this.ball.position.copy(inHandsPos);
    else { this.ball.position.set(bx, BALL_R + hgt, bz); if (v.dispPlayers) this.puntBlend(this.ball.position, flip); }
    // Rotation réelle : le ballon roule sur lui-même dans le sens de sa course.
    const P = VPH;
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
    if (this.composer) this.composer.render(dt);
    else this.renderer.render(this.scene, this.camera);
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
    this.destroyed = true;
    this.composer?.dispose?.(); this.composer = null;
    this.renderer.dispose();
    this.canvas.remove();
    this.lower?.remove();
  }
}
