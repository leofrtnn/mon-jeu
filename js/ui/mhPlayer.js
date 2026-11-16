/**
 * JOUEUR RÉALISTE (gros plans)
 * ------------------------------------------------------------------
 * Corps humain réaliste issu des données MakeHuman (licence CC0), « cuit » hors ligne
 * (scripts : corps d'athlète en 3 variantes de peau, tenue taillée dans le corps — maillot,
 * manches, short, chaussettes, crampons —, cheveux, yeux, sourcils) et rattaché à NOTRE
 * squelette (13 os) : il joue exactement les mêmes animations que le modèle simplifié.
 *
 * Fichier data/mh/mhplayer.bin : « MHP1 », longueur de l'en-tête (u32), en-tête JSON
 * (os, articulations, pièces, tableaux), puis les tableaux binaires (positions int16 en 0,1 mm,
 * normales int8, uv int16, os uint8 ×4, poids uint8 ×4, indices uint16).
 *
 * Chargé à la demande (pas dans le cache de démarrage) ; le jeu garde le modèle simplifié
 * pour les joueurs éloignés et tant que ce fichier n'est pas arrivé.
 */
import * as THREE from '../vendor/three.module.min.js';

const BASE = new URL('../../data/mh/', import.meta.url);
let LOADING = null;

/** Coupe du jeu → coiffure réaliste. */
export const HAIR_OF = { short: 'hair_short', sidepart: 'hair_short', slick: 'hair_short', quiff: 'hair_short', receding: 'hair_buzz', buzz: 'hair_buzz', afro: 'hair_afro', curly: 'hair_curly', dreads: 'hair_curly', long: 'hair_long', bun: 'hair_bun', mohawk: 'hair_mohawk', bald: null };

export function loadMH() {
  if (!LOADING) LOADING = (async () => {
    const buf = await (await fetch(new URL('mhplayer.bin', BASE))).arrayBuffer();
    const dv = new DataView(buf);
    if (String.fromCharCode(...new Uint8Array(buf, 0, 4)) !== 'MHP1') throw new Error('mhplayer.bin invalide');
    const hl = dv.getUint32(4, true);
    const meta = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 8, hl)));
    const start = 8 + hl;
    const T = { int16: Int16Array, int8: Int8Array, uint8: Uint8Array, uint16: Uint16Array, uint32: Uint32Array };
    const arr = {};
    for (const a of meta.arrays) arr[a.name] = new T[a.type](buf, start + a.off, a.len);
    const tl = new THREE.TextureLoader();
    const tex = (f, srgb = true) => { const t = tl.load(new URL(f, BASE).href); if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t; };
    const textures = {};
    const getTex = (f) => (textures[f] ||= tex(f));
    return { meta, arr, getTex, geos: new Map() };
  })().catch((e) => { console.warn('joueur réaliste indisponible', e); LOADING = null; return null; });
  return LOADING;
}

/** Géométrie (partagée entre joueurs) d'une pièce pour une variante de peau. */
function geometry(mh, part, eth) {
  const key = `${part}|${eth}`;
  if (mh.geos.has(key)) return mh.geos.get(key);
  const A = mh.arr, p = A[`${part}.pos${eth}`];
  if (!p) return null;
  const pos = new Float32Array(p.length); for (let i = 0; i < p.length; i++) pos[i] = p[i] / 10000;
  const n8 = A[`${part}.nrm${eth}`], nrm = new Float32Array(n8.length); for (let i = 0; i < n8.length; i++) nrm[i] = n8[i] / 127;
  const u16 = A[`${part}.uv`], uv = new Float32Array(u16.length); for (let i = 0; i < u16.length; i++) uv[i] = (u16[i] * 1.5) / 32767;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(Array.from(A[`${part}.si`]), 4));
  g.setAttribute('skinWeight', new THREE.BufferAttribute(new Float32Array(Array.from(A[`${part}.sw`], (x) => x / 255)), 4));
  g.setIndex(new THREE.BufferAttribute(A[`${part}.idx`], 1));
  // Gabarits (costaud, sec) : cibles de morphose relatives, dosées par joueur.
  const mt = ['heavy', 'slim'].map((t) => A[`${part}.${t}`]).filter(Boolean);
  if (mt.length === 2) {
    g.morphAttributes.position = mt.map((d) => { const f = new Float32Array(d.length); for (let i = 0; i < d.length; i++) f[i] = d[i] / 10000; return new THREE.BufferAttribute(f, 3); });
    g.morphTargetsRelative = true;
  }
  g.computeBoundingSphere();
  mh.geos.set(key, g);
  return g;
}

/** Variante de peau selon le teint du joueur (clair, mat/asiatique, foncé). */
export function ethOf(skinHex, nat = '') {
  const c = new THREE.Color(skinHex);
  const l = 0.3 * c.r + 0.59 * c.g + 0.11 * c.b;
  if (l < 0.42) return 1;
  if (/^(JPN|KOR|CHN|PRK|VIE|THA|PHI|IDN|MAS|MYA|CAM|LAO|MNG|TPE|HKG|SGP)$/.test(nat)) return 2;
  return 0;
}

const SKIN_MATS = new Map();
function skinMat(mh, eth, skinHex) {
  const key = `${eth}|${skinHex}`;
  if (SKIN_MATS.has(key)) return SKIN_MATS.get(key);
  const file = ['skin_caucasian.jpg', 'skin_african.jpg', 'skin_asian.jpg'][eth];
  // Teinte : rapproche la texture du teint du joueur (légèrement, la texture garde ses détails).
  const ref = new THREE.Color(['#d8a888', '#7a4a32', '#d9b08c'][eth]), want = new THREE.Color(skinHex);
  const tint = new THREE.Color(Math.min(1.3, want.r / ref.r), Math.min(1.3, want.g / ref.g), Math.min(1.3, want.b / ref.b)).lerp(new THREE.Color(1, 1, 1), 0.45);
  const m = new THREE.MeshStandardMaterial({ map: mh.getTex(file), color: tint, roughness: 0.62, metalness: 0 });
  SKIN_MATS.set(key, m);
  return m;
}

const HAIR_MATS = new Map();
function hairMat(mh, part, hex) {
  const key = `${part}|${hex}`;
  if (HAIR_MATS.has(key)) return HAIR_MATS.get(key);
  const c = new THREE.Color(hex).multiplyScalar(1.7);
  const m = new THREE.MeshStandardMaterial({ map: mh.getTex(`${part}.webp`), color: c, alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.75, metalness: 0 });
  HAIR_MATS.set(key, m);
  return m;
}

/**
 * Construit les pièces réalistes d'un joueur et les rattache à ses os (Player3D).
 * opts : { skin, hair, hairStyle, eyes, nat, mats (maillot, manches, short, chaussettes, crampons) }.
 * Retourne le groupe de maillages (à afficher de près).
 */
export function buildMHPlayer(mh, p3, opts) {
  const eth = ethOf(opts.skin, opts.nat);
  const bones = [p3.body, p3.upper, p3.headPivot, p3.legs[0].hip, p3.legs[0].knee, p3.legs[0].ankle, p3.legs[1].hip, p3.legs[1].knee, p3.legs[1].ankle, p3.arms[0].sh, p3.arms[0].el, p3.arms[1].sh, p3.arms[1].el];
  // Pose de repos pour la liaison : les os reprennent leur position d'origine le temps du calcul.
  const saved = bones.map((b) => [b.quaternion.clone(), b.position.clone()]);
  const rootSaved = [p3.root.position.clone(), p3.root.quaternion.clone()];
  for (const b of bones) b.quaternion.identity();
  p3.body.position.set(0, 0, 0);
  p3.root.position.set(0, 0, 0); p3.root.quaternion.identity();
  p3.root.updateMatrixWorld(true);
  const skeleton = new THREE.Skeleton(bones);
  const M = opts.mats;
  const parts = [
    ['body', skinMat(mh, eth, opts.skin)],
    ['shirt', M.shirt], [opts.gk ? 'sleeveLong' : 'sleeve', M.sleeve || M.shirt], ['shorts', M.shorts], ['socks', M.socks], ['boots', M.boot],
    ['eyes', (() => { const m = new THREE.MeshStandardMaterial({ map: mh.getTex(`eye_${opts.eyeTex || 'brown'}.jpg`), roughness: 0.25 }); return m; })()],
    ['brows', hairMat(mh, 'brows', opts.hair)],
  ];
  if (opts.gk) parts.push(['gloves', new THREE.MeshStandardMaterial({ color: opts.gloves || '#c6f432', roughness: 0.55 })]);   // gants du gardien
  const hp = HAIR_OF[opts.hairStyle] ?? 'hair_short';
  if (hp) parts.push([hp, hairMat(mh, hp, opts.hair)]);
  // Barbe / moustache (selon l'apparence du joueur) ; « barbe de trois jours » plus légère.
  const bd = { full: 'beard_full', long: 'beard_full', chinstrap: 'beard_full', mutton: 'beard_full', stubble: 'beard_full', moustache: 'beard_moustache' }[opts.beard];
  if (bd) {
    let bm = hairMat(mh, bd, opts.hair);
    if (opts.beard === 'stubble') { bm = bm.clone(); bm.transparent = true; bm.opacity = 0.45; bm.alphaTest = 0.2; }
    parts.push([bd, bm]);
  }
  const group = new THREE.Group();
  group.userData.skeleton = skeleton; group.userData.eth = eth;
  p3.body.add(group);   // géométrie exprimée dans le repère du corps (taille et carrure du joueur incluses)
  group.updateMatrixWorld(true);
  for (const [name, mat] of parts) {
    const g = geometry(mh, name, eth);
    if (!g) continue;
    const m = new THREE.SkinnedMesh(g, mat);
    group.add(m); m.updateMatrixWorld(true);
    m.bind(skeleton, m.matrixWorld.clone());
    m.frustumCulled = false; m.castShadow = true; m.receiveShadow = false;
    m.userData.mhPart = name;
    if (m.morphTargetInfluences) { m.morphTargetInfluences[0] = opts.heavy || 0; m.morphTargetInfluences[1] = opts.slim || 0; }
  }
  // On remet la pose courante.
  bones.forEach((b, i) => { b.quaternion.copy(saved[i][0]); b.position.copy(saved[i][1]); });
  p3.root.position.copy(rootSaved[0]); p3.root.quaternion.copy(rootSaved[1]);
  p3.root.updateMatrixWorld(true);
  return group;
}

/**
 * Ajoute une pièce à un joueur réaliste déjà construit (ex. le décalque de la photo du visage).
 * La liaison se fait dans la pose de repos (comme à la construction).
 */
export function addMHPart(mh, p3, name, mat) {
  const group = p3.mhGroup, g = geometry(mh, name, group.userData.eth);
  if (!g) return null;
  const skel = group.userData.skeleton, bones = skel.bones;
  const saved = bones.map((b) => [b.quaternion.clone(), b.position.clone()]);
  const rootSaved = [p3.root.position.clone(), p3.root.quaternion.clone()];
  const bodyPos = p3.body.position.clone();
  for (const b of bones) b.quaternion.identity();
  p3.body.position.set(0, 0, 0); p3.root.position.set(0, 0, 0); p3.root.quaternion.identity();
  p3.root.updateMatrixWorld(true);
  const m = new THREE.SkinnedMesh(g, mat);
  group.add(m); m.updateMatrixWorld(true);
  m.bind(skel, m.matrixWorld.clone());   // os inchangés : mêmes matrices inverses que les autres pièces
  m.frustumCulled = false; m.renderOrder = 2;
  bones.forEach((b, i) => { b.quaternion.copy(saved[i][0]); b.position.copy(saved[i][1]); });
  p3.body.position.copy(bodyPos); p3.root.position.copy(rootSaved[0]); p3.root.quaternion.copy(rootSaved[1]);
  p3.root.updateMatrixWorld(true);
  return m;
}

/** Peau d'un joueur réaliste ajustée à un teint (celui de sa photo). */
export function setMHSkin(mh, p3, skinHex) {
  const m = p3.mhGroup?.children.find((o) => o.userData.mhPart === 'body');
  if (m) m.material = skinMat(mh, p3.mhGroup.userData.eth, skinHex);
}
