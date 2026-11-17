// Géométrie réelle des interactions joueur–ballon (distance pied→ballon au moment du toucher).
// Usage : node contacts.mjs [graine] [minutes]
import { cfgFor, runLive, L, W } from './common.mjs';
const seed = +(process.argv[2] || 77), minutes = +(process.argv[3] || 90);
const S = {}; const add = (k, v) => (S[k] ||= []).push(v);
// Pointe du pied ≈ 35 cm devant le centre du corps, dans l'axe du regard (repère commun de mesure).
const footD = (p, P) => Math.hypot(p.x * L + Math.cos(p.face) * 0.35 - P.x, p.y * W + Math.sin(p.face) * 0.35 - P.y);
let lastH = null;
const cfg = await cfgFor(seed);
runLive(cfg, {
  setup(sim) {
    const oG = sim.gain.bind(sim); sim.gain = (p, out, f) => { add(f ? 'gain après tacle : pied→ballon' : 'récupération ballon libre : pied→ballon', footD(p, sim.P)); return oG(p, out, f); };
    const oR = sim.receive.bind(sim); sim.receive = (r, pd, out) => { add('réception de passe : pied→ballon', footD(r, sim.P)); add('réception : hauteur du ballon', sim.P.z); return oR(r, pd, out); };
    const oK = sim.kickBall.bind(sim); sim.kickBall = (h, tx, ty, lofted, z) => { add('départ passe/frappe : pied→ballon', footD(h, sim.P)); return oK(h, tx, ty, lofted, z); };
    if (sim.controlTouch) { const oC = sim.controlTouch.bind(sim); sim.controlTouch = (...a) => { const r = oC(...a); if (r) add('contrôle physique : pied→ballon', r.d); return r; }; }
  },
  onStep(sim, m) {
    if (m.minute >= minutes) m.phase = 'ft';
    const h = sim.holder;
    if (h && !sim.inHands && h === lastH) add('conduite : pied→ballon', footD(h, sim.P));
    lastH = h;
  },
});
const q = (a, p) => a.slice().sort((x, y) => x - y)[Math.floor(p * (a.length - 1))];
const out = {};
for (const [k, a] of Object.entries(S)) { out[k] = { n: a.length, med: +q(a, 0.5).toFixed(2), p90: +q(a, 0.9).toFixed(2), max: +q(a, 1).toFixed(2) }; console.log(k.padEnd(40), 'n=' + String(a.length).padEnd(7), 'médiane', q(a, 0.5).toFixed(2), ' p90', q(a, 0.9).toFixed(2), ' max', q(a, 1).toFixed(2)); }
if (process.env.JSON) console.log(JSON.stringify(out));
