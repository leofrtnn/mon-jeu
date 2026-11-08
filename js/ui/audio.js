/**
 * Ambiance sonore synthétisée (Web Audio, aucun fichier) :
 * rumeur de la foule modulée par l'intensité, sifflets, clameur au but, "oh !" sur les occasions.
 */
export class MatchAudio {
  constructor() { this.ctx = null; this.on = false; }

  /** À appeler suite à un geste utilisateur (politique d'autoplay). */
  start() {
    if (this.ctx) { this.ctx.resume?.(); this.on = true; this.crowdGain.gain.setTargetAtTime(0.05, this.ctx.currentTime, 0.3); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = this.ctx = new AC();
    // Bruit brun en boucle = rumeur de la foule.
    const len = ctx.sampleRate * 3;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) { const w = Math.random() * 2 - 1; last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; }
    this.noise = buf;
    const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
    this.crowdFilter = ctx.createBiquadFilter(); this.crowdFilter.type = 'lowpass'; this.crowdFilter.frequency.value = 500;
    this.crowdGain = ctx.createGain(); this.crowdGain.gain.value = 0;
    src.connect(this.crowdFilter).connect(this.crowdGain).connect(ctx.destination);
    src.start();
    this.crowdGain.gain.setTargetAtTime(0.05, ctx.currentTime, 0.5);
    this.on = true;
  }

  stop() { if (this.ctx) { this.ctx.close(); this.ctx = null; } this.on = false; }
  mute() { if (this.ctx) this.crowdGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.1); this.on = false; }

  /** Intensité 0..1 (ballon proche du but adverse, momentum…). */
  intensity(v) {
    if (!this.on) return;
    const t = this.ctx.currentTime;
    this.crowdGain.gain.setTargetAtTime(0.035 + v * 0.11, t, 0.4);
    this.crowdFilter.frequency.setTargetAtTime(380 + v * 900, t, 0.4);
  }

  burst({ gain = 0.3, dur = 2.5, freq = 1200, q = 0.7, type = 'lowpass' }) {
    if (!this.on) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const src = ctx.createBufferSource(); src.buffer = this.noise;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.25);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(ctx.destination);
    src.start(t, Math.random()); src.stop(t + dur + 0.1);
  }

  roar() { this.burst({ gain: 0.45, dur: 3.5, freq: 1500 }); }
  ooh() { this.burst({ gain: 0.18, dur: 1.3, freq: 700, q: 2.5, type: 'bandpass' }); }

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
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.07, t + 0.02);
      g.gain.setValueAtTime(0.07, t + d - 0.04); g.gain.exponentialRampToValueAtTime(0.0001, t + d);
      o.connect(g).connect(ctx.destination);
      o.start(t); lfo.start(t); o.stop(t + d + 0.05); lfo.stop(t + d + 0.05);
    }
  }
}
