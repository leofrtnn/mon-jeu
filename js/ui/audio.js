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

  stop() { if (this.ctx) { this.ctx.close(); this.ctx = null; } this.on = false; try { speechSynthesis?.cancel(); } catch { /* */ } }
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

  roar() { this.burst({ gain: 0.2, dur: 5, freq: 1100, q: 0.5, type: 'bandpass' }); this.burst({ gain: 0.08, dur: 3.5, freq: 2400, q: 0.8, type: 'bandpass' }); setTimeout(() => this.chant(6), 3500); }
  ooh() { this.burst({ gain: 0.09, dur: 1.8, freq: 600, q: 1.8, type: 'bandpass' }); }
  /** Déception (tir manqué de peu) : un « ohhh » grave qui retombe. */
  groan() { this.burst({ gain: 0.06, dur: 1.6, freq: 380, q: 1.5, type: 'bandpass' }); }
  /** Sifflets de colère (faute contre l'équipe qui reçoit, décision contestée). */
  boo() { this.burst({ gain: 0.05, dur: 2.2, freq: 260, q: 2.5, type: 'bandpass' }); this.burst({ gain: 0.02, dur: 1.8, freq: 3200, q: 6, type: 'bandpass' }); }

  /** Montée de la foule pendant une action dangereuse (temps fort). */
  swell(on) {
    if (!this.on) return;
    const t = this.ctx.currentTime;
    this.crowdGain.gain.setTargetAtTime(BASE * (on ? 3 : 1), t, on ? 0.6 : 1.2);
    this.crowdFilter.frequency.setTargetAtTime(on ? 2300 : 1300, t, 0.7);
  }

  /** Chant des supporters : syllabes rythmées (voix filtrées), tambour et clappements. */
  chant(beats = 8) {
    if (!this.on) return;
    const ctx = this.ctx, t0 = ctx.currentTime + 0.05, bpm = 118 + Math.random() * 14, beat = 60 / bpm;
    const vowel = [700, 1100, 900, 1200][Math.floor(Math.random() * 4)];
    for (let i = 0; i < beats; i++) {
      const t = t0 + i * beat;
      // Voix (deux syllabes par temps fort : « Al-lez ! »).
      for (const [dt, f, gn] of [[0, vowel, 0.05], [beat * 0.5, vowel * 0.8, i % 2 ? 0.035 : 0.06]]) {
        const src = ctx.createBufferSource(); src.buffer = this.noise;
        const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = f; bp.Q.value = 3;
        const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t + dt); g.gain.exponentialRampToValueAtTime(gn, t + dt + 0.04); g.gain.exponentialRampToValueAtTime(0.0001, t + dt + beat * 0.42);
        src.connect(bp).connect(g).connect(this.master); src.start(t + dt, Math.random() * 2); src.stop(t + dt + beat * 0.5);
      }
      // Tambour des ultras.
      const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(95, t); o.frequency.exponentialRampToValueAtTime(48, t + 0.18);
      const dg = ctx.createGain(); dg.gain.setValueAtTime(0.11, t); dg.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
      o.connect(dg).connect(this.master); o.start(t); o.stop(t + 0.3);
      // Clappements (bruit très court, aigu).
      if (i % 2 === 1) {
        const c = ctx.createBufferSource(); c.buffer = this.noise;
        const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 1800;
        const cg = ctx.createGain(); cg.gain.setValueAtTime(0.05, t + beat * 0.5); cg.gain.exponentialRampToValueAtTime(0.0001, t + beat * 0.5 + 0.08);
        c.connect(hp).connect(cg).connect(this.master); c.start(t + beat * 0.5, Math.random()); c.stop(t + beat * 0.5 + 0.1);
      }
    }
  }

  /** Ballon frappé : un « toc » sourd (cuir + pelouse), plus fort pour une frappe que pour une passe. */
  kick(power = 0.5) {
    if (!this.on) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(150 + power * 60, t); o.frequency.exponentialRampToValueAtTime(55, t + 0.09);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.05 + power * 0.09, t + 0.004); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
    o.connect(g).connect(this.master); o.start(t); o.stop(t + 0.14);
    const c = ctx.createBufferSource(); c.buffer = this.noise;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 900; bp.Q.value = 1.2;
    const cg = ctx.createGain(); cg.gain.setValueAtTime(0.02 + power * 0.04, t); cg.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
    c.connect(bp).connect(cg).connect(this.master); c.start(t, Math.random() * 3); c.stop(t + 0.06);
  }

  /** Applaudissements : des centaines de petits claquements aléatoires (beau geste, arrêt, sortie d'un joueur). */
  applause(dur = 2.6, level = 1) {
    if (!this.on) return;
    const ctx = this.ctx, t0 = ctx.currentTime;
    const n = Math.round(90 * dur * level);
    for (let i = 0; i < n; i++) {
      const t = t0 + Math.random() * dur * (0.4 + 0.6 * Math.random());
      const c = ctx.createBufferSource(); c.buffer = this.noise;
      const hp = ctx.createBiquadFilter(); hp.type = 'bandpass'; hp.frequency.value = 1500 + Math.random() * 1800; hp.Q.value = 1.4;
      const g = ctx.createGain(); g.gain.setValueAtTime(0.012 * level, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.03);
      c.connect(hp).connect(g).connect(this.master); c.start(t, Math.random() * 3); c.stop(t + 0.04);
    }
  }

  /**
   * Commentaire audio (synthèse vocale du navigateur, en français) : seulement les moments
   * forts, jamais deux phrases l'une sur l'autre.
   */
  speak(text, urgent = false) {
    if (!this.on || !this.voiceOn || !text || typeof speechSynthesis === 'undefined') return;
    try {
      if (speechSynthesis.speaking && !urgent) return;
      if (urgent) speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(String(text).replace(/[^\p{L}\p{N} ,.!?'’:;-]/gu, ''));
      u.lang = 'fr-FR'; u.rate = urgent ? 1.12 : 1.04; u.pitch = urgent ? 1.15 : 1; u.volume = 0.9;
      const v = speechSynthesis.getVoices().find((x) => /^fr/i.test(x.lang));
      if (v) u.voice = v;
      speechSynthesis.speak(u);
    } catch { /* synthèse indisponible */ }
  }

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
