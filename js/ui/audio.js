/**
 * Ambiance sonore synthétisée (Web Audio, aucun fichier) :
 * rumeur de la foule modulée par l'intensité, sifflets, clameur au but, "oh !" sur les occasions.
 */
const BASE = 0.022; // volume de la rumeur (discret)

export class MatchAudio {
  constructor() { this.ctx = null; this.on = false; }

  /**
   * À appeler suite à un geste utilisateur (politique d'autoplay).
   * Rumeur de foule : bruit ROSE (plus doux que le bruit brun, qui grondait), filtré dans les
   * médiums (voix lointaines), volume faible, avec de lentes ondulations comme un vrai stade.
   */
  start() {
    if (this.ctx) { this.ctx.resume?.(); this.on = true; this.crowdGain.gain.setTargetAtTime(BASE, this.ctx.currentTime, 0.4); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = this.ctx = new AC();
    const len = ctx.sampleRate * 4;
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      // Bruit rose (filtre de Paul Kellet), stéréo décorrélée : la foule entoure l'auditeur.
      const d = buf.getChannelData(ch);
      let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
      for (let i = 0; i < len; i++) {
        const w = Math.random() * 2 - 1;
        b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852;
        b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
        d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11; b6 = w * 0.115926;
      }
    }
    this.noise = buf;
    const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 220;
    this.crowdFilter = ctx.createBiquadFilter(); this.crowdFilter.type = 'lowpass'; this.crowdFilter.frequency.value = 1400; this.crowdFilter.Q.value = 0.4;
    this.crowdGain = ctx.createGain(); this.crowdGain.gain.value = 0;
    // Ondulation lente du volume (la foule « respire »).
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.07;
    const lfoG = ctx.createGain(); lfoG.gain.value = BASE * 0.35;
    lfo.connect(lfoG).connect(this.crowdGain.gain);
    this.master = ctx.createGain(); this.master.gain.value = 0.9;
    src.connect(hp).connect(this.crowdFilter).connect(this.crowdGain).connect(this.master).connect(ctx.destination);
    src.start(); lfo.start();
    this.crowdGain.gain.setTargetAtTime(BASE, ctx.currentTime, 0.8);
    this.on = true;
  }

  stop() { if (this.ctx) { this.ctx.close(); this.ctx = null; } this.on = false; }
  mute() { if (this.ctx) this.crowdGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.1); this.on = false; }

  /** Intensité 0..1 (ballon proche du but adverse, momentum…). */
  intensity(v) {
    if (!this.on) return;
    const t = this.ctx.currentTime;
    this.crowdGain.gain.setTargetAtTime(BASE * (0.8 + v * 1.4), t, 0.8);
    this.crowdFilter.frequency.setTargetAtTime(1100 + v * 900, t, 0.8);
  }

  burst({ gain = 0.3, dur = 2.5, freq = 1200, q = 0.7, type = 'lowpass' }) {
    if (!this.on) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const src = ctx.createBufferSource(); src.buffer = this.noise;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.45);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t, Math.random()); src.stop(t + dur + 0.1);
  }

  roar() { this.burst({ gain: 0.16, dur: 4, freq: 1100, q: 0.5, type: 'bandpass' }); }
  ooh() { this.burst({ gain: 0.06, dur: 1.5, freq: 600, q: 1.8, type: 'bandpass' }); }

  /** Sifflet de l'arbitre : n coups, long ou court. */
  whistle(n = 1, long = false) {
    if (!this.on) return;
    const ctx = this.ctx;
    for (let i = 0; i < n; i++) {
      const t = ctx.currentTime + i * (long ? 0.7 : 0.25);
      const d = long ? 0.55 : 0.18;
      const o = ctx.createOscillator(); o.frequency.value = 2850;
      const lfo = ctx.createOscillator(); lfo.frequency.value = 32;
      const lg = ctx.createGain(); lg.gain.value = 140;
      lfo.connect(lg).connect(o.frequency);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.035, t + 0.02);
      g.gain.setValueAtTime(0.035, t + d - 0.04); g.gain.exponentialRampToValueAtTime(0.0001, t + d);
      o.connect(g).connect(ctx.destination);
      o.start(t); lfo.start(t); o.stop(t + d + 0.05); lfo.stop(t + d + 0.05);
    }
  }
}
