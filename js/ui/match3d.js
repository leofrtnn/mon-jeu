/**
 * MATCH EN 3D (three.js) : stade, tribunes, buts avec filets, joueurs 3D animés
 * (course, frappe, tacle, plongeon, saut, célébration), caméras « télé ».
 *
 * Ce module ne fait QUE le rendu : il lit l'état animé de MatchView (joueurs, ballon,
 * période) — la logique d'animation et le moteur restent communs aux vues 2D et 3D.
 */
import * as THREE from '../vendor/three.module.min.js';
import { toLocal, localRect } from './viewport.js';

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

function numberTexture(num, shirt, ink) {
  return canvasTex(128, 128, (g, w, h) => {
    g.clearRect(0, 0, w, h); // fond transparent : seuls les chiffres sont imprimés sur le maillot
    g.fillStyle = ink; g.font = '800 92px "Barlow Condensed", system-ui, sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(String(num ?? ''), w / 2, h / 2 + 6);
  });
}

/* ---------------- Joueur 3D ---------------- */

const GEO = {};
function geo() {
  if (GEO.torso) return GEO;
  const cap = (r, l, rs = 10) => new THREE.CapsuleGeometry(r, l, 4, rs);
  GEO.torso = cap(0.165, 0.34, 14);                 // buste arrondi (épaules, poitrine)
  GEO.chest = new THREE.SphereGeometry(0.2, 14, 10);
  GEO.pelvis = new THREE.CylinderGeometry(0.17, 0.19, 0.22, 14);
  GEO.shortLeg = new THREE.CylinderGeometry(0.095, 0.11, 0.2, 10);
  GEO.thigh = cap(0.07, 0.3);
  GEO.shin = cap(0.055, 0.32);
  GEO.knee = new THREE.SphereGeometry(0.066, 10, 8);
  GEO.boot = cap(0.052, 0.16, 8);
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

class Player3D {
  constructor(mats, skin, hair, num, shirtHex, inkHex, photo = null) {
    const G = geo();
    this.root = new THREE.Group();
    this.body = new THREE.Group();          // inclinaisons (tacle, plongeon)
    this.root.add(this.body);
    this.body.scale.setScalar(K);
    const skinM = this.skinM = new THREE.MeshLambertMaterial({ color: skin });
    const hairM = this.hairM = new THREE.MeshLambertMaterial({ color: hair });
    // Buste : capsule aplatie + poitrine, aux couleurs du maillot.
    const torso = limb(this.body, G.torso, mats.shirt, 1.2);
    torso.scale.set(0.82, 1, 1.32);
    // Short et bassin.
    limb(this.body, G.pelvis, mats.shorts, 0.86).scale.set(0.85, 1, 1.25);
    limb(this.body, G.neck, skinM, 1.56);
    const head = limb(this.body, G.head, skinM, 1.7);
    head.scale.set(0.96, 1.1, 0.9);
    const hairMesh = limb(this.body, G.hair, hairM, 1.72);
    hairMesh.position.x = -0.012; hairMesh.scale.set(0.98, 1.08, 0.94);
    for (const z of [-0.105, 0.105]) { const e = limb(this.body, G.ear, skinM, 1.69); e.position.z = z; e.scale.set(0.6, 1, 0.5); }
    // Visage : photo du joueur (si disponible), posée face à l'avant (+X).
    if (photo) {
      loadFace(photo).then((f) => {
        if (!f) return;
        skinM.color.set(f.skin);
        if (f.hair) hairM.color.set(f.hair);
        const face = new THREE.Mesh(G.face, new THREE.MeshLambertMaterial({ map: f.tex, transparent: true }));
        face.position.set(0.119, 1.69, 0); face.rotation.y = Math.PI / 2; // juste devant la tête (sinon caché dedans)
        face.scale.set(0.95, 1.12, 1);
        this.body.add(face);
      });
    }
    // Numéros (dos et poitrine).
    const numTex = numberTexture(num, shirtHex, inkHex);
    const back = new THREE.Mesh(G.back, new THREE.MeshLambertMaterial({ map: numTex, transparent: true }));
    back.position.set(-0.137, 1.24, 0); back.rotation.y = -Math.PI / 2;
    this.body.add(back);
    const front = new THREE.Mesh(G.front, new THREE.MeshLambertMaterial({ map: numTex, transparent: true }));
    front.position.set(0.137, 1.36, 0.07); front.rotation.y = Math.PI / 2;
    this.body.add(front);
    // Jambes : hanche → (short, cuisse) → genou → (chaussette) → crampon.
    this.legs = [-1, 1].map((sgn) => {
      const hip = new THREE.Group(); hip.position.set(0, 0.8, sgn * 0.1); this.body.add(hip);
      limb(hip, G.shortLeg, mats.shorts, -0.06);
      limb(hip, G.thigh, skinM, -0.21);
      const knee = new THREE.Group(); knee.position.y = -0.42; hip.add(knee);
      limb(knee, G.knee, mats.socks, 0);
      limb(knee, G.shin, mats.socks, -0.2);
      const boot = limb(knee, G.boot, mats.boot, -0.42);
      boot.rotation.z = Math.PI / 2; boot.position.x = 0.05;
      return { hip, knee };
    });
    // Bras : épaule → (manche, bras) → coude → avant-bras → main.
    this.arms = [-1, 1].map((sgn) => {
      const sh = new THREE.Group(); sh.position.set(0, 1.44, sgn * 0.25); this.body.add(sh);
      limb(sh, G.sleeve, mats.shirt, -0.08);
      limb(sh, G.upper, skinM, -0.15);
      const el = new THREE.Group(); el.position.y = -0.27; sh.add(el);
      limb(el, G.elbow, skinM, 0);
      limb(el, G.fore, skinM, -0.13);
      limb(el, G.hand, skinM, -0.28);
      return { sh, el, sgn };
    });
    this.shadow = new THREE.Mesh(G.shadow, mats.shadow);
    this.shadow.rotation.x = -Math.PI / 2; this.shadow.position.y = 0.02;
    this.root.add(this.shadow);
    this.ring = new THREE.Mesh(G.ring, mats.ring);
    this.ring.rotation.x = -Math.PI / 2; this.ring.position.y = 0.03; this.ring.visible = false;
    this.root.add(this.ring);
  }

  /**
   * Pose à partir de l'état animé de MatchView (vitesse réelle, accélération, gestes).
   * Course : foulée qui s'allonge avec la vitesse, genou qui remonte, bras opposés aux jambes,
   * buste penché selon la vitesse et l'accélération, rebond vertical deux fois par cycle.
   */
  pose(p, flip, ctx = {}) {
    const face = flip ? p.face + Math.PI : p.face;
    this.root.rotation.y = -face;
    const sp = p.speed || 0;
    const run = Math.min(1, sp / 8.5);             // 0 arrêté → 1 sprint
    const jog = Math.min(1, sp / 3);
    const ph = p.phase || 0;
    const amp = 0.25 + 0.75 * run;                  // amplitude de la foulée
    const sw = Math.sin(ph) * amp * jog;
    const [lL, lR] = this.legs;
    lL.hip.rotation.set(0, 0, sw); lR.hip.rotation.set(0, 0, -sw);
    // Genou : plié pendant le retour de la jambe (talon vers les fesses en sprint).
    const kneeMax = 0.35 + 1.35 * run;
    lL.knee.rotation.z = -(0.08 + kneeMax * Math.max(0, Math.sin(ph + 1.7))) * jog;
    lR.knee.rotation.z = -(0.08 + kneeMax * Math.max(0, Math.sin(ph + 1.7 + Math.PI))) * jog;
    for (const a of this.arms) {
      a.sh.rotation.set(0, 0, (a.sgn < 0 ? -sw : sw) * (0.7 + 0.5 * run));
      a.sh.rotation.x = -a.sgn * 0.12;
      a.el.rotation.z = 0.35 + 1.0 * run;
    }
    const lean = Math.max(-0.25, Math.min(0.32, 0.05 + 0.2 * run + (p.acc || 0) * 0.025));
    this.body.rotation.set(0, 0, -lean);
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
      lL.hip.rotation.z = 0.12; lL.knee.rotation.z = -0.25 - 0.15 * pow;
      // Bras opposé écarté pour l'équilibre, buste qui accompagne.
      this.arms[0].sh.rotation.x = 0.9 * pow; this.arms[1].sh.rotation.x = -0.4 * pow;
      this.body.rotation.z = -0.1 - 0.25 * pow * Math.sin(t * Math.PI);
      this.body.rotation.x = 0.12 * pow * Math.sin(t * Math.PI);
    }
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
    // Tacle : glissé (buste en ARRIÈRE, jambe d'attaque tendue devant, appui sur une main)
    // ou debout (jambe tendue vers le ballon, buste droit).
    if (p.slide > 0) {
      const k = Math.sin((p.slide / 0.55) * Math.PI);
      if (p.tk === 'stand') {
        lR.hip.rotation.z = 1.0 * k; lR.knee.rotation.z = -0.1 * k;
        lL.hip.rotation.z = -0.15 * k; lL.knee.rotation.z = -0.45 * k;
        this.body.rotation.z = 0.12 * k;
        this.arms[0].sh.rotation.x = 0.5 * k; this.arms[1].sh.rotation.x = -0.5 * k;
      } else {
        this.body.rotation.z = 1.1 * k;               // couché vers l'arrière
        this.body.position.y = -0.25 * k;             // hanches au ras de la pelouse (glissade)
        lR.hip.rotation.z = 0.35 * k; lR.knee.rotation.z = -0.05 * k; // jambe d'attaque tendue
        lL.hip.rotation.z = -0.25 * k; lL.knee.rotation.z = -1.1 * k;  // jambe repliée dessous
        this.arms[0].sh.rotation.z = -1.1 * k; this.arms[1].sh.rotation.x = -0.6 * k; // une main au sol
      }
    }
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
    // Fauché : il tombe en avant, reste au sol un instant, puis se relève.
    if (p.fall > 0) {
      const dur = p.fall > 0.6 || this._fallDur > 0.6 ? 1.1 : 0.6;
      if (!this._fallDur || p.fall > this._lastFall) this._fallDur = Math.max(p.fall, 0.6);
      this._lastFall = p.fall;
      const t = 1 - p.fall / this._fallDur;
      const k = t < 0.25 ? Math.sin((t / 0.25) * Math.PI / 2) : t > 0.75 ? Math.sin(((1 - t) / 0.25) * Math.PI / 2) : 1;
      this.body.rotation.z = -1.4 * k;
      this.body.position.y = 0.1 * k;
      for (const a of this.arms) { a.sh.rotation.z = 1.6 * k; a.el.rotation.z = 0.4; }
      lL.hip.rotation.z = lR.hip.rotation.z = -0.2 * k;
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
    crowd.map.repeat.set(2.6, 0.5); // sièges d'environ 50 cm, 8 rangées par étage
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
    // Résolution : au plus ~2,2 millions de pixels (grands écrans de PC), puis réglage
    // automatique selon la fluidité mesurée (this.quality, voir adaptQuality).
    const cap = Math.sqrt(2.2e6 / Math.max(1, v.cssW * v.cssH));
    const dpr = Math.max(0.5, Math.min(window.devicePixelRatio || 1, 1.75, cap) * (this.quality ?? 1));
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
        const p3 = new Player3D(mats, p.skin || '#c68642', p.hair || '#2b1d14', p.num, shirtHex, ink, p.mp?.p?.photo || null);
        // Morphologie du vrai joueur : taille (grand défenseur, petit ailier) et carrure (physique).
        const pl = p.mp?.p;
        const hgt = pl ? (pl.height || estHeight(pl)) : 180;
        const hk = Math.max(0.9, Math.min(1.11, hgt / 181));
        const wk = pl ? Math.max(0.9, Math.min(1.13, 0.86 + (pl.attrs?.phy ?? 65) / 420 + (hgt - 181) / 300)) : 1;
        p3.body.scale.set(K * wk, K * hk, K * wk);
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
    this.camPos.lerp(want, k);
    this.camLook.lerp(look, k);
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.camLook);
    this.camera.updateProjectionMatrix();
  }

  /** Baisse la résolution si les images mettent trop de temps à venir (PC sans grosse carte graphique), la remonte sinon. */
  adaptQuality() {
    const now = performance.now();
    if (this._lastT) {
      const ft = Math.min(100, now - this._lastT);
      this._acc = (this._acc || 0) + ft; this._n = (this._n || 0) + 1;
      if (this._acc > 1000) {
        const avg = this._acc / this._n;
        const q = this.quality ?? 1;
        if (avg > 24 && q > 0.55) { this.quality = Math.max(0.55, q - 0.15); this._good = 0; this.resize(); }
        else if (avg < 18.5 && q < 1 && (this._good = (this._good || 0) + 1) >= 3) { this.quality = Math.min(1, q + 0.1); this._good = 0; this.resize(); }
        this._acc = 0; this._n = 0;
      }
    }
    this._lastT = now;
  }

  render(dt) {
    const v = this.v;
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
      e.p3.pose(p, flip, { ballNear: p.gk && dB < 30, restFar: dB > 28 && !isCar, shield: isCar && !v.inHands && (p.shieldK || 0) > 0, holding: isCar && v.inHands && p.gk });
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
