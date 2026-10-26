// Disaster sound effects, synthesised with the Web Audio API (no audio files).
// Browsers only allow audio after a user gesture, so unlock() must be called
// from a click handler (the Trigger button does this).

type Layer = "rumble" | "roar";

const MUTE_KEY = "earthbreaker.muted";
const MASTER_VOLUME = 0.8;

export class SoundBoard {
  private ctx?: AudioContext;
  private master?: GainNode;
  private brown?: AudioBuffer;
  private white?: AudioBuffer;
  private readonly layers = new Map<Layer, { gain: GainNode; source: AudioBufferSourceNode }>();
  private mutedFlag: boolean;

  constructor() {
    let stored = false;
    try {
      stored = localStorage.getItem(MUTE_KEY) === "1";
    } catch {
      // Storage blocked: default to sound on.
    }
    this.mutedFlag = stored;
  }

  get muted() {
    return this.mutedFlag;
  }

  unlock() {
    if (!this.ctx) {
      const ctx = new AudioContext();
      // A compressor on the output keeps a big boom from clipping.
      const limiter = ctx.createDynamicsCompressor();
      limiter.threshold.value = -10;
      limiter.ratio.value = 12;
      limiter.connect(ctx.destination);
      this.master = ctx.createGain();
      this.master.gain.value = this.mutedFlag ? 0 : MASTER_VOLUME;
      this.master.connect(limiter);
      this.white = noiseBuffer(ctx, false);
      this.brown = noiseBuffer(ctx, true);
      this.ctx = ctx;
    }
    if (this.ctx.state === "suspended") void this.ctx.resume();
  }

  setMuted(muted: boolean) {
    this.mutedFlag = muted;
    try {
      localStorage.setItem(MUTE_KEY, muted ? "1" : "0");
    } catch {
      // Not remembered; still applies now.
    }
    if (this.ctx && this.master) this.master.gain.setTargetAtTime(muted ? 0 : MASTER_VOLUME, this.ctx.currentTime, 0.05);
  }

  /** Sets a continuous layer's loudness, 0–1. Changes are smoothed. */
  level(layer: Layer, value: number) {
    const ctx = this.ctx;
    if (!ctx || !this.master || !this.brown) return;
    let entry = this.layers.get(layer);
    if (!entry) {
      if (value <= 0.001) return;
      const source = ctx.createBufferSource();
      source.buffer = this.brown;
      source.loop = true;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      if (layer === "rumble") {
        // Deep ground rumble: only the lowest frequencies.
        const low = ctx.createBiquadFilter();
        low.type = "lowpass";
        low.frequency.value = 110;
        source.connect(low).connect(gain);
      } else {
        // The roar of the jet: a broad band of noise.
        const band = ctx.createBiquadFilter();
        band.type = "bandpass";
        band.frequency.value = 380;
        band.Q.value = 0.4;
        source.connect(band).connect(gain);
      }
      gain.connect(this.master);
      source.start();
      entry = { gain, source };
      this.layers.set(layer, entry);
    }
    const loudness = layer === "rumble" ? 1.4 : 0.9;
    entry.gain.gain.setTargetAtTime(Math.max(0, value) * loudness, ctx.currentTime, 0.25);
  }

  /** A blast: a deep falling thump plus a wall of noise that darkens as it fades. */
  boom(strength = 1) {
    const ctx = this.ctx;
    if (!ctx || !this.master || !this.white) return;
    const t = ctx.currentTime;

    const thump = ctx.createOscillator();
    thump.type = "sine";
    thump.frequency.setValueAtTime(75, t);
    thump.frequency.exponentialRampToValueAtTime(26, t + 1.4);
    const thumpGain = ctx.createGain();
    thumpGain.gain.setValueAtTime(0.0001, t);
    thumpGain.gain.exponentialRampToValueAtTime(1.1 * strength, t + 0.015);
    thumpGain.gain.exponentialRampToValueAtTime(0.0001, t + 2.8);
    thump.connect(thumpGain).connect(this.master);
    thump.start(t);
    thump.stop(t + 3);

    const blast = ctx.createBufferSource();
    blast.buffer = this.white;
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(4000, t);
    filter.frequency.exponentialRampToValueAtTime(90, t + 3);
    const blastGain = ctx.createGain();
    blastGain.gain.setValueAtTime(0.0001, t);
    blastGain.gain.exponentialRampToValueAtTime(1.3 * strength, t + 0.02);
    blastGain.gain.exponentialRampToValueAtTime(0.0001, t + 4.5);
    blast.connect(filter).connect(blastGain).connect(this.master);
    blast.start(t);
    blast.stop(t + 4.6);
  }

  /** Volcanic lightning: a sharp crack, then rolling thunder after a short delay. */
  thunder() {
    const ctx = this.ctx;
    if (!ctx || !this.master || !this.white) return;
    const t = ctx.currentTime;
    const crack = ctx.createBufferSource();
    crack.buffer = this.white;
    const high = ctx.createBiquadFilter();
    high.type = "highpass";
    high.frequency.value = 1800;
    const crackGain = ctx.createGain();
    crackGain.gain.setValueAtTime(0.5, t);
    crackGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
    crack.connect(high).connect(crackGain).connect(this.master);
    crack.start(t, Math.random());
    crack.stop(t + 0.15);

    const delay = 0.25 + Math.random() * 0.9;
    const roll = ctx.createBufferSource();
    roll.buffer = this.white;
    const low = ctx.createBiquadFilter();
    low.type = "lowpass";
    low.frequency.value = 260;
    const rollGain = ctx.createGain();
    rollGain.gain.setValueAtTime(0.0001, t + delay);
    rollGain.gain.exponentialRampToValueAtTime(0.45, t + delay + 0.15);
    rollGain.gain.exponentialRampToValueAtTime(0.0001, t + delay + 2.6);
    roll.connect(low).connect(rollGain).connect(this.master);
    roll.start(t + delay, Math.random());
    roll.stop(t + delay + 2.7);
  }

  pause() {
    if (this.ctx?.state === "running") void this.ctx.suspend();
  }

  resume() {
    if (this.ctx?.state === "suspended") void this.ctx.resume();
  }

  /** Silences and removes the continuous layers. One-shot sounds finish on their own. */
  stop() {
    for (const { gain, source } of this.layers.values()) {
      gain.disconnect();
      source.stop();
    }
    this.layers.clear();
  }
}

/** A few seconds of white noise, or brown noise (deeper: each sample drifts from the last). */
function noiseBuffer(ctx: AudioContext, brown: boolean): AudioBuffer {
  const buffer = ctx.createBuffer(1, ctx.sampleRate * 4, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  let last = 0;
  for (let i = 0; i < data.length; i++) {
    const white = Math.random() * 2 - 1;
    if (brown) {
      last = (last + 0.02 * white) / 1.02;
      data[i] = last * 3.5;
    } else {
      data[i] = white;
    }
  }
  return buffer;
}
