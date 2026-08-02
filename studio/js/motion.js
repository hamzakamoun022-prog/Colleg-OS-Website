// Camera motion presets.
//
// Each preset is a pure function of scene progress `p` (0..1) returning a camera
// state. The engine applies that state to the rendered plate, so any preset
// works with any footage layer. `amount` scales the intensity, `n` is a shared
// fbm noise function so handheld drift is deterministic per scene.
//
// Camera state fields:
//   scale   zoom factor (1 = plate exactly fills frame)
//   x, y    translation in fractions of frame width/height
//   rot     roll in radians
//   blur    directional/zoom blur strength, 0..1 (engine decides how to spend it)
//   dir     blur direction in radians (for whips/pans)
//   focus   0 = fully defocused, 1 = sharp
//   chroma  chromatic aberration strength, 0..1

import { ease, lerp, clamp } from './util.js';

const base = () => ({ scale: 1, x: 0, y: 0, rot: 0, blur: 0, dir: 0, focus: 1, chroma: 0 });

export const MOTIONS = {
  static: {
    label: 'Static Hold',
    group: 'Basic',
    hint: 'Locked off with a breath of drift. Lets the copy do the work.',
    fn: (p, a, n) => {
      const c = base();
      c.scale = (1 + lerp(0.010, 0.035, ease.inOutQuad(p)) * a.k) * a.s;
      c.x = n(p * 1.1) * 0.002 * a.k;
      c.y = n(p * 1.1 + 40) * 0.002 * a.k;
      return c;
    },
  },

  pushIn: {
    label: 'Slow Push In',
    group: 'Basic',
    hint: 'Classic creeping dolly. Builds quiet tension under a claim.',
    fn: (p, a, n) => {
      const c = base();
      const e = ease.inOutCubic(p);
      c.scale = (1 + lerp(0.03, 0.23, e) * a.k) * a.s;
      c.y = lerp(0.008, -0.008, e) * a.k;
      c.x = n(p * 0.9) * 0.003 * a.k;
      return c;
    },
  },

  pullOut: {
    label: 'Dolly Out Reveal',
    group: 'Basic',
    hint: 'Starts tight on a detail, opens to reveal the whole system.',
    fn: (p, a) => {
      const c = base();
      const e = ease.outQuart(p);
      c.scale = (1 + lerp(0.55, 0.02, e) * a.k) * a.s;
      c.y = lerp(-0.02, 0, e) * a.k;
      c.blur = (1 - e) * 0.22 * a.k;
      return c;
    },
  },

  crashZoomIn: {
    label: 'Crash Zoom In',
    group: 'Impact',
    hint: 'Violent snap toward the subject. Punctuates a punchline or price.',
    fn: (p, a, n) => {
      const c = base();
      const hit = 0.42;
      if (p < hit) {
        const e = ease.inQuart(p / hit);
        c.scale = (1 + 0.62 * e * a.k) * a.s;
        c.blur = e * 0.85 * a.k;
        c.chroma = e * 0.5 * a.k;
      } else {
        // Overshoot then settle, with the impact ringing out through the frame.
        const e = ease.outElastic(clamp((p - hit) / (1 - hit)));
        c.scale = (1 + lerp(0.62, 0.46, e) * a.k) * a.s;
        const ring = (1 - e) * 0.012 * a.k;
        c.x = n(p * 60) * ring;
        c.y = n(p * 60 + 90) * ring;
        c.rot = n(p * 40 + 12) * ring * 0.5;
        c.blur = (1 - e) * 0.18 * a.k;
      }
      return c;
    },
  },

  crashZoomOut: {
    label: 'Crash Zoom Out',
    group: 'Impact',
    hint: 'Rips backward off the subject. Great before a hard cut.',
    fn: (p, a, n) => {
      const c = base();
      const e = ease.outExpo(p);
      c.scale = (1 + lerp(0.70, 0.02, e) * a.k) * a.s;
      c.blur = (1 - e) * 0.7 * a.k;
      c.chroma = (1 - e) * 0.35 * a.k;
      c.x = n(p * 50) * (1 - e) * 0.008 * a.k;
      return c;
    },
  },

  impactShake: {
    label: 'Impact Shake',
    group: 'Impact',
    hint: 'Hits hard on frame one and rings out. Pairs with a beat drop.',
    fn: (p, a, n) => {
      const c = base();
      const decay = Math.exp(-5.5 * p);
      c.scale = (1 + (0.04 + 0.10 * decay) * a.k) * a.s;
      c.x = n(p * 90) * 0.028 * decay * a.k;
      c.y = n(p * 90 + 55) * 0.028 * decay * a.k;
      c.rot = n(p * 70 + 21) * 0.024 * decay * a.k;
      c.blur = decay * 0.4 * a.k;
      c.chroma = decay * 0.55 * a.k;
      return c;
    },
  },

  handheld: {
    label: 'Handheld',
    group: 'Organic',
    hint: 'Human, unpolished drift. Makes a mockup feel filmed, not rendered.',
    fn: (p, a, n) => {
      const c = base();
      c.scale = (1 + lerp(0.05, 0.09, ease.inOutQuad(p)) * a.k) * a.s;
      c.x = n(p * 2.4) * 0.016 * a.k;
      c.y = n(p * 2.1 + 33) * 0.014 * a.k;
      c.rot = n(p * 1.7 + 77) * 0.012 * a.k;
      return c;
    },
  },

  float: {
    label: 'Float Up',
    group: 'Organic',
    hint: 'Weightless rise. Calm, premium, good under wellbeing copy.',
    fn: (p, a, n) => {
      const c = base();
      c.scale = (1 + lerp(0.10, 0.03, ease.inOutCubic(p)) * a.k) * a.s;
      c.y = lerp(0.05, -0.02, ease.inOutCubic(p)) * a.k;
      c.x = n(p * 0.8) * 0.004 * a.k;
      c.rot = n(p * 0.6 + 5) * 0.004 * a.k;
      return c;
    },
  },

  orbitRight: {
    label: 'Orbit Right',
    group: 'Camera Move',
    hint: 'Arcs around the subject with parallax roll.',
    fn: (p, a) => {
      const c = base();
      const e = ease.inOutCubic(p);
      c.scale = (1 + (0.14 + Math.sin(e * Math.PI) * 0.05) * a.k) * a.s;
      c.x = lerp(0.055, -0.055, e) * a.k;
      c.rot = lerp(-0.024, 0.024, e) * a.k;
      c.y = Math.sin(e * Math.PI) * -0.012 * a.k;
      return c;
    },
  },

  orbitLeft: {
    label: 'Orbit Left',
    group: 'Camera Move',
    hint: 'Mirror of Orbit Right — alternate them so cuts feel choreographed.',
    fn: (p, a) => {
      const c = base();
      const e = ease.inOutCubic(p);
      c.scale = (1 + (0.14 + Math.sin(e * Math.PI) * 0.05) * a.k) * a.s;
      c.x = lerp(-0.055, 0.055, e) * a.k;
      c.rot = lerp(0.024, -0.024, e) * a.k;
      c.y = Math.sin(e * Math.PI) * -0.012 * a.k;
      return c;
    },
  },

  whipPan: {
    label: 'Whip Pan',
    group: 'Camera Move',
    hint: 'Screaming lateral swing. The fastest way to change subject.',
    fn: (p, a, n) => {
      const c = base();
      // Rests, whips through the middle third, rests again.
      const e = ease.inOutQuart(p);
      const speed = Math.sin(Math.PI * clamp((p - 0.12) / 0.66)) ** 1.4;
      c.scale = (1 + (0.12 + speed * 0.10) * a.k) * a.s;
      c.x = lerp(0.16, -0.16, e) * a.k;
      c.blur = speed * 0.95 * a.k;
      c.dir = 0;
      c.chroma = speed * 0.4 * a.k;
      c.rot = n(p * 8) * 0.006 * a.k;
      return c;
    },
  },

  tiltDown: {
    label: 'Tilt Down',
    group: 'Camera Move',
    hint: 'Sweeps down a long page. Sells "there is a lot in here".',
    fn: (p, a) => {
      const c = base();
      const e = ease.inOutCubic(p);
      c.scale = (1 + 0.22 * a.k) * a.s;
      c.y = lerp(-0.10, 0.10, e) * a.k;
      c.blur = Math.sin(e * Math.PI) * 0.14 * a.k;
      return c;
    },
  },

  fpvDrone: {
    label: 'FPV Drone Dive',
    group: 'Camera Move',
    hint: 'Swooping curved approach with roll. High energy opener.',
    fn: (p, a, n) => {
      const c = base();
      const e = ease.inOutCubic(p);
      c.scale = (1 + lerp(0.70, 0.04, ease.outQuart(p)) * a.k) * a.s;
      c.x = Math.sin(e * Math.PI * 0.9) * 0.07 * a.k;
      c.y = lerp(-0.06, 0.01, e) * a.k;
      c.rot = Math.sin(e * Math.PI) * 0.05 * a.k + n(p * 3) * 0.006;
      c.blur = (1 - ease.outQuart(p)) * 0.55 * a.k;
      return c;
    },
  },

  vertigo: {
    label: 'Vertigo (Dolly Zoom)',
    group: 'Signature',
    hint: 'Hitchcock warp — the frame breathes while the subject stays put.',
    fn: (p, a, n) => {
      const c = base();
      const e = ease.inOutQuart(p);
      c.scale = (1 + lerp(0.02, 0.36, e) * a.k) * a.s;
      // Counter-drift plus rising aberration reads as lens distortion.
      c.y = lerp(0, 0.012, e) * a.k;
      c.chroma = e * 0.45 * a.k;
      c.blur = Math.sin(e * Math.PI) * 0.2 * a.k;
      c.rot = n(p * 1.2) * 0.004;
      return c;
    },
  },

  bulletTime: {
    label: 'Bullet Time',
    group: 'Signature',
    hint: 'Frozen moment, camera keeps arcing. Use on a single hero frame.',
    fn: (p, a, n) => {
      const c = base();
      const e = ease.inOutExpo(p);
      c.scale = (1 + (0.20 + Math.sin(e * Math.PI) * 0.06) * a.k) * a.s;
      c.x = lerp(-0.07, 0.07, e) * a.k;
      c.rot = lerp(0.03, -0.03, e) * a.k;
      c.chroma = (0.15 + Math.sin(e * Math.PI) * 0.25) * a.k;
      c.y = n(p * 1.4) * 0.005 * a.k;
      return c;
    },
  },

  focusPull: {
    label: 'Focus Pull',
    group: 'Signature',
    hint: 'Racks from soft to razor sharp as the headline lands.',
    fn: (p, a, n) => {
      const c = base();
      const e = ease.outQuart(clamp(p / 0.55));
      c.scale = (1 + lerp(0.16, 0.06, ease.inOutCubic(p)) * a.k) * a.s;
      c.focus = e;
      c.blur = (1 - e) * 0.8 * a.k;
      c.chroma = (1 - e) * 0.3 * a.k;
      c.x = n(p * 1.3) * 0.004 * a.k;
      return c;
    },
  },

  snapZoomSteps: {
    label: 'Snap Zoom Steps',
    group: 'Signature',
    hint: 'Three ratcheting punches inward. Reads as a list being counted.',
    fn: (p, a, n) => {
      const c = base();
      const steps = 3;
      const idx = Math.min(steps - 1, Math.floor(p * steps));
      const local = ease.outQuint(clamp((p * steps) - idx));
      const from = 1 + idx * 0.11 * a.k;
      const to = 1 + (idx + 1) * 0.11 * a.k;
      c.scale = lerp(from, to, local) * a.s;
      const kick = (1 - local) * 0.008 * a.k;
      c.x = n(p * 55) * kick;
      c.y = n(p * 55 + 30) * kick;
      c.blur = (1 - local) * 0.25 * a.k;
      return c;
    },
  },
};

export const MOTION_KEYS = Object.keys(MOTIONS);

export const MOTION_GROUPS = MOTION_KEYS.reduce((acc, key) => {
  const g = MOTIONS[key].group;
  (acc[g] ||= []).push(key);
  return acc;
}, {});

/**
 * Evaluate a preset.
 * @param {string} key      preset id
 * @param {number} p        0..1 scene progress
 * @param {number} amount   0..2 intensity multiplier
 * @param {function} noise  fbm noise fn
 * @param {number} baseScale extra constant zoom (keeps edges covered)
 */
export function camera(key, p, amount = 1, noise = () => 0, baseScale = 1) {
  const preset = MOTIONS[key] || MOTIONS.static;
  const c = preset.fn(clamp(p), { k: amount, s: baseScale }, noise);
  // Never let a motion expose the plate edge.
  c.scale = Math.max(c.scale, 1.001 + Math.abs(c.x) * 2.2 + Math.abs(c.y) * 2.2 + Math.abs(c.rot) * 2.4);
  return c;
}
