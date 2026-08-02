// Procedural score.
//
// The studio has no audio files to ship, so the soundtrack is synthesised. The
// same scheduling code runs against a live AudioContext (preview + recording)
// and an OfflineAudioContext (WAV export), which keeps the exported audio
// sample-identical to what you heard in the editor.
//
// Cuts in the storyboard are passed in so whooshes and impacts land exactly on
// the edit points.

import { rng, hashSeed } from './util.js';

const midi = n => 440 * 2 ** ((n - 69) / 12);

export const STYLES = {
  lofi: { label: 'Lo-fi Study', bpm: 84, hint: 'Warm keys, soft kick, vinyl air. Calm and studious.' },
  uplift: { label: 'Uplift', bpm: 96, hint: 'Piano arp and claps. Optimistic, good for offer beats.' },
  drive: { label: 'Drive', bpm: 104, hint: 'Pulsing bass and tight hats. Punchy, high-energy.' },
  cinematic: { label: 'Cinematic', bpm: 72, hint: 'Sparse pad and low pulse. Serious, premium.' },
  none: { label: 'No music', bpm: 96, hint: 'Silence — for adding your own track later.' },
};

// Chord progressions as semitone offsets from the root, per style.
const PROGRESSIONS = {
  lofi:      [[0, 4, 7, 11], [-3, 2, 5, 9], [-5, 0, 4, 7], [2, 5, 9, 12]],
  uplift:    [[0, 4, 7, 11], [5, 9, 12, 16], [-3, 2, 5, 9], [7, 11, 14, 17]],
  drive:     [[0, 3, 7, 10], [5, 8, 12, 15], [-2, 1, 5, 8], [3, 7, 10, 14]],
  cinematic: [[0, 7, 12, 16], [-4, 3, 8, 12], [-5, 2, 7, 11], [-2, 5, 9, 14]],
};

const ROOT = { lofi: 53, uplift: 55, drive: 45, cinematic: 48 };

/* ------------------------------------------------------------------ */
/* Voices                                                              */
/* ------------------------------------------------------------------ */

function env(ctx, node, t, a, d, s, r, peak = 1, sustain = 0.6) {
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0001, peak), t + a);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0001, peak * sustain), t + a + d);
  g.gain.setValueAtTime(Math.max(0.0001, peak * sustain), t + a + d + s);
  g.gain.exponentialRampToValueAtTime(0.0001, t + a + d + s + r);
  node.connect(g);
  return g;
}

function tone(ctx, out, { freq, t, dur, type = 'sine', gain = 0.2, detune = 0, attack = 0.01, release = 0.3 }) {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  o.detune.setValueAtTime(detune, t);
  const g = env(ctx, o, t, attack, dur * 0.25, dur * 0.5, release, gain, 0.55);
  g.connect(out);
  o.start(t);
  o.stop(t + dur + release + 0.05);
}

function kick(ctx, out, t, gain = 0.9) {
  const o = ctx.createOscillator();
  o.type = 'sine';
  o.frequency.setValueAtTime(150, t);
  o.frequency.exponentialRampToValueAtTime(42, t + 0.11);
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.34);
  o.connect(g); g.connect(out);
  o.start(t); o.stop(t + 0.36);
}

function noiseBuffer(ctx, seconds = 1) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  const r = rng(4242);
  for (let i = 0; i < len; i++) d[i] = r() * 2 - 1;
  return buf;
}

function hat(ctx, out, noise, t, gain = 0.12, dur = 0.045) {
  const s = ctx.createBufferSource();
  s.buffer = noise;
  const f = ctx.createBiquadFilter();
  f.type = 'highpass';
  f.frequency.value = 7200;
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  s.connect(f); f.connect(g); g.connect(out);
  s.start(t); s.stop(t + dur + 0.02);
}

function clap(ctx, out, noise, t, gain = 0.3) {
  for (let i = 0; i < 3; i++) {
    const s = ctx.createBufferSource();
    s.buffer = noise;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 1600;
    f.Q.value = 1.1;
    const g = ctx.createGain();
    const tt = t + i * 0.011;
    g.gain.setValueAtTime(gain * (i === 2 ? 1 : 0.5), tt);
    g.gain.exponentialRampToValueAtTime(0.0001, tt + (i === 2 ? 0.18 : 0.04));
    s.connect(f); f.connect(g); g.connect(out);
    s.start(tt); s.stop(tt + 0.24);
  }
}

/** Rising filtered-noise sweep used on hard cuts. */
function whoosh(ctx, out, noise, t, gain = 0.16, dur = 0.42, reverse = false) {
  const s = ctx.createBufferSource();
  s.buffer = noise;
  const f = ctx.createBiquadFilter();
  f.type = 'bandpass';
  f.Q.value = 0.9;
  f.frequency.setValueAtTime(reverse ? 5200 : 420, t);
  f.frequency.exponentialRampToValueAtTime(reverse ? 420 : 5200, t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + dur * 0.65);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  s.connect(f); f.connect(g); g.connect(out);
  s.start(t); s.stop(t + dur + 0.05);
}

/** Low boom for the opening frame and the price reveal. */
function impact(ctx, out, noise, t, gain = 0.5) {
  const o = ctx.createOscillator();
  o.type = 'sine';
  o.frequency.setValueAtTime(90, t);
  o.frequency.exponentialRampToValueAtTime(34, t + 0.5);
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.75);
  o.connect(g); g.connect(out);
  o.start(t); o.stop(t + 0.8);

  const s = ctx.createBufferSource();
  s.buffer = noise;
  const f = ctx.createBiquadFilter();
  f.type = 'lowpass';
  f.frequency.setValueAtTime(2400, t);
  f.frequency.exponentialRampToValueAtTime(200, t + 0.35);
  const ng = ctx.createGain();
  ng.gain.setValueAtTime(gain * 0.5, t);
  ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);
  s.connect(f); f.connect(ng); ng.connect(out);
  s.start(t); s.stop(t + 0.45);
}

/* ------------------------------------------------------------------ */
/* Arrangement                                                         */
/* ------------------------------------------------------------------ */

/**
 * Schedule a full score into an AudioContext.
 * @param {BaseAudioContext} ctx
 * @param {AudioNode} destination
 * @param {object} o  { style, bpm, duration, seed, cuts:number[], t0 }
 */
export function scheduleScore(ctx, destination, o = {}) {
  const style = STYLES[o.style] ? o.style : 'lofi';
  const duration = o.duration || 20;
  const t0 = o.t0 ?? 0;
  const cuts = o.cuts || [];
  const r = rng(hashSeed(`${o.seed || 1}:${style}`));

  // Master chain: gentle compression-ish shaping via a lowpass + master gain.
  const master = ctx.createGain();
  master.gain.value = o.volume ?? 0.9;
  const warm = ctx.createBiquadFilter();
  warm.type = 'lowpass';
  warm.frequency.value = 12000;
  master.connect(warm);
  warm.connect(destination);

  const noise = noiseBuffer(ctx, 2);

  // Cut sound design runs even with music off, so edits still feel intentional.
  cuts.forEach((c, i) => {
    if (i === 0) return;
    const t = t0 + c;
    if (t > t0 + duration - 0.05) return;
    whoosh(ctx, master, noise, t - 0.22, 0.13 + r() * 0.05, 0.34, r() > 0.6);
    if (r() > 0.55) impact(ctx, master, noise, t, 0.22);
  });
  impact(ctx, master, noise, t0 + 0.02, 0.42);

  if (style === 'none') return master;

  const bpm = o.bpm || STYLES[style].bpm;
  const beat = 60 / bpm;
  const bar = beat * 4;
  const bars = Math.ceil(duration / bar) + 1;
  const prog = PROGRESSIONS[style];
  const root = ROOT[style];

  // Vinyl / air bed
  if (style === 'lofi' || style === 'cinematic') {
    const s = ctx.createBufferSource();
    s.buffer = noise;
    s.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 3000;
    f.Q.value = 0.5;
    const g = ctx.createGain();
    g.gain.value = style === 'lofi' ? 0.012 : 0.008;
    s.connect(f); f.connect(g); g.connect(master);
    s.start(t0); s.stop(t0 + duration + 0.5);
  }

  for (let b = 0; b < bars; b++) {
    const barT = t0 + b * bar;
    if (barT > t0 + duration) break;
    const chord = prog[b % prog.length];

    // Pad / keys
    chord.forEach((semi, ci) => {
      const f = midi(root + semi + (style === 'cinematic' ? 0 : 12));
      const gain = style === 'cinematic' ? 0.055 : 0.045;
      tone(ctx, master, {
        freq: f, t: barT + ci * 0.012, dur: bar * 0.85,
        type: style === 'drive' ? 'sawtooth' : 'triangle',
        gain: gain * (style === 'drive' ? 0.6 : 1),
        attack: style === 'cinematic' ? 0.5 : 0.06,
        release: bar * 0.4,
        detune: (r() - 0.5) * 8,
      });
    });

    // Bass
    tone(ctx, master, {
      freq: midi(root + chord[0] - 12), t: barT, dur: bar * 0.9,
      type: 'sine', gain: 0.19, attack: 0.02, release: 0.3,
    });

    // Rhythm section
    for (let s = 0; s < 8; s++) {
      const t = barT + s * (beat / 2);
      if (t > t0 + duration) break;
      if (style === 'lofi') {
        if (s === 0 || s === 5) kick(ctx, master, t, 0.55);
        if (s % 2 === 1) hat(ctx, master, noise, t, 0.05);
        if (s === 4) clap(ctx, master, noise, t, 0.12);
      } else if (style === 'uplift') {
        if (s === 0 || s === 4) kick(ctx, master, t, 0.6);
        if (s === 4) clap(ctx, master, noise, t, 0.26);
        hat(ctx, master, noise, t, s % 2 ? 0.07 : 0.04);
        // Arp
        const note = chord[(s + b) % chord.length];
        tone(ctx, master, {
          freq: midi(root + note + 24), t, dur: beat * 0.35,
          type: 'triangle', gain: 0.05, attack: 0.005, release: 0.14,
        });
      } else if (style === 'drive') {
        if (s % 2 === 0) kick(ctx, master, t, 0.72);
        hat(ctx, master, noise, t, s % 2 ? 0.1 : 0.05, 0.035);
        if (s === 4) clap(ctx, master, noise, t, 0.22);
        tone(ctx, master, {
          freq: midi(root + chord[0] - 12), t, dur: beat * 0.4,
          type: 'square', gain: 0.06, attack: 0.004, release: 0.08,
        });
      } else if (style === 'cinematic') {
        if (s === 0) kick(ctx, master, t, 0.5);
        if (s === 4 && b % 2 === 1) kick(ctx, master, t, 0.3);
      }
    }
  }

  return master;
}

/* ------------------------------------------------------------------ */
/* Live playback                                                       */
/* ------------------------------------------------------------------ */

export class ScorePlayer {
  constructor() {
    this.ctx = null;
    this.streamDest = null;
    this.startedAt = 0;
  }

  ensureContext() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AC();
      this.streamDest = this.ctx.createMediaStreamDestination();
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    return this.ctx;
  }

  /** Play from `offset` seconds into the score. `toStream` also feeds the recorder. */
  play(opts, offset = 0, toStream = false) {
    const ctx = this.ensureContext();
    this.stop();
    const bus = ctx.createGain();
    bus.connect(ctx.destination);
    if (toStream) bus.connect(this.streamDest);
    this.bus = bus;

    // Schedule the whole score, shifted so `offset` lands at "now".
    const t0 = ctx.currentTime + 0.06 - offset;
    scheduleScore(ctx, bus, { ...opts, t0 });
    this.startedAt = ctx.currentTime;
    // Anything scheduled in the past is simply skipped by the graph.
    if (offset > 0) {
      bus.gain.setValueAtTime(0, ctx.currentTime);
      bus.gain.setValueAtTime(1, ctx.currentTime + 0.02);
    }
    return t0;
  }

  stop() {
    if (this.bus) {
      try { this.bus.disconnect(); } catch { /* already gone */ }
      this.bus = null;
    }
  }

  get stream() {
    this.ensureContext();
    return this.streamDest.stream;
  }
}

/* ------------------------------------------------------------------ */
/* Offline render → WAV                                                */
/* ------------------------------------------------------------------ */

export async function renderScoreToWav(opts) {
  const sampleRate = 48000;
  const duration = (opts.duration || 20) + 1.2;
  const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  const ctx = new OAC(2, Math.ceil(sampleRate * duration), sampleRate);
  scheduleScore(ctx, ctx.destination, { ...opts, t0: 0 });
  const buffer = await ctx.startRendering();
  return encodeWav(buffer);
}

function encodeWav(buffer) {
  const numCh = buffer.numberOfChannels;
  const len = buffer.length;
  const bytesPerSample = 2;
  const blockAlign = numCh * bytesPerSample;
  const dataSize = len * blockAlign;
  const ab = new ArrayBuffer(44 + dataSize);
  const view = new DataView(ab);

  const str = (off, s) => { for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i)); };
  str(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numCh, true);
  view.setUint32(24, buffer.sampleRate, true);
  view.setUint32(28, buffer.sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);
  str(36, 'data');
  view.setUint32(40, dataSize, true);

  const chans = [];
  for (let c = 0; c < numCh; c++) chans.push(buffer.getChannelData(c));
  let off = 44;
  for (let i = 0; i < len; i++) {
    for (let c = 0; c < numCh; c++) {
      const v = Math.max(-1, Math.min(1, chans[c][i]));
      view.setInt16(off, v < 0 ? v * 0x8000 : v * 0x7fff, true);
      off += 2;
    }
  }
  return new Blob([ab], { type: 'audio/wav' });
}
