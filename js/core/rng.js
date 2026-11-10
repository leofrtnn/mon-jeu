/**
 * Générateur pseudo-aléatoire à graine (mulberry32).
 * Toute la simulation passe par ici : même graine => même match, pour déboguer.
 */
export function createRng(seed = 1) {
  let s = (seed >>> 0) || 1;
  const rng = {
    /** État interne (pour sauvegarder / reprendre un match exactement). */
    getState() { return s; },
    setState(v) { s = v >>> 0; },
    /** Flottant dans [0, 1). */
    next() {
      s = (s + 0x6d2b79f5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
    /** Entier dans [a, b] inclus. */
    int(a, b) { return a + Math.floor(rng.next() * (b - a + 1)); },
    /** Flottant dans [a, b). */
    range(a, b) { return a + rng.next() * (b - a); },
    chance(p) { return rng.next() < p; },
    pick(arr) { return arr[Math.floor(rng.next() * arr.length)]; },
    /** Tirage pondéré : weights[i] >= 0. Retourne l'index. */
    weightedIndex(weights) {
      let total = 0;
      for (const w of weights) total += w;
      let r = rng.next() * total;
      for (let i = 0; i < weights.length; i++) {
        r -= weights[i];
        if (r <= 0) return i;
      }
      return weights.length - 1;
    },
    /** Loi normale (Box-Muller). */
    normal(mean = 0, sd = 1) {
      const u = 1 - rng.next(), v = rng.next();
      return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    },
    shuffle(arr) {
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(rng.next() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
      }
      return arr;
    },
    getState() { return s; },
    setState(v) { s = v >>> 0; },
  };
  return rng;
}

/** Hache une chaîne en graine 32 bits. */
export function hashSeed(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
