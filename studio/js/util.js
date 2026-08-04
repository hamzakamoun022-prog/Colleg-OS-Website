// Math, easing, colour and layout helpers shared by the render engine.

export const clamp = (v, a = 0, b = 1) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const inv = (a, b, v) => (b === a ? 0 : (v - a) / (b - a));
export const remap = (v, a, b, c, d) => lerp(c, d, clamp(inv(a, b, v)));
export const round = (v, n = 0) => Math.round(v * 10 ** n) / 10 ** n;

/** Progress of `t` across a window, clamped to 0..1. */
export const win = (t, start, end) => clamp(inv(start, end, t));

export const ease = {
  linear: t => t,
  inQuad: t => t * t,
  outQuad: t => t * (2 - t),
  inOutQuad: t => (t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t),
  inCubic: t => t * t * t,
  outCubic: t => 1 - (1 - t) ** 3,
  inOutCubic: t => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2),
  inQuart: t => t ** 4,
  outQuart: t => 1 - (1 - t) ** 4,
  inOutQuart: t => (t < 0.5 ? 8 * t ** 4 : 1 - (-2 * t + 2) ** 4 / 2),
  outQuint: t => 1 - (1 - t) ** 5,
  inExpo: t => (t <= 0 ? 0 : 2 ** (10 * t - 10)),
  outExpo: t => (t >= 1 ? 1 : 1 - 2 ** (-10 * t)),
  inOutExpo: t =>
    t <= 0 ? 0 : t >= 1 ? 1 : t < 0.5 ? 2 ** (20 * t - 10) / 2 : (2 - 2 ** (-20 * t + 10)) / 2,
  outBack: t => 1 + 2.70158 * (t - 1) ** 3 + 1.70158 * (t - 1) ** 2,
  outElastic: t =>
    t <= 0 ? 0 : t >= 1 ? 1 : 2 ** (-9 * t) * Math.sin((t * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1,
  /** Snappy settle used for most kinetic type. */
  snap: t => 1 - (1 - t) ** 4.5,
};

/** Deterministic PRNG so a given seed always renders the identical video. */
export function rng(seed = 1) {
  let s = (seed >>> 0) || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

export function hashSeed(str) {
  let h = 2166136261;
  for (let i = 0; i < String(str).length; i++) {
    h ^= String(str).charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Smooth 1-D value noise — the backbone of handheld camera drift. */
export function noise1(seed = 1) {
  const r = rng(seed);
  const table = Array.from({ length: 256 }, () => r() * 2 - 1);
  return x => {
    const i = Math.floor(x);
    const f = x - i;
    const u = f * f * (3 - 2 * f);
    return lerp(table[i & 255], table[(i + 1) & 255], u);
  };
}

/** Layered noise for organic, non-repeating handheld motion. */
export function fbm(seed = 1, octaves = 3) {
  const layers = Array.from({ length: octaves }, (_, i) => noise1(seed + i * 977));
  return x => {
    let sum = 0, amp = 1, freq = 1, norm = 0;
    for (const n of layers) {
      sum += n(x * freq) * amp;
      norm += amp;
      amp *= 0.5;
      freq *= 2.1;
    }
    return sum / norm;
  };
}

export function hexToRgb(hex) {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

export function rgba(hex, a = 1) {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r},${g},${b},${a})`;
}

export function mixHex(a, b, t) {
  const x = hexToRgb(a), y = hexToRgb(b);
  const c = v => Math.round(v).toString(16).padStart(2, '0');
  return `#${c(lerp(x.r, y.r, t))}${c(lerp(x.g, y.g, t))}${c(lerp(x.b, y.b, t))}`;
}

/** Rounded rectangle path (kept explicit — roundRect support varies by engine). */
export function roundRect(ctx, x, y, w, h, r) {
  // Never let a squeezed layout produce a negative radius — canvas throws on it,
  // which would take down the whole frame for one mis-sized box.
  const rad = Math.max(0, Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2));
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.lineTo(x + w - rad, y);
  ctx.arcTo(x + w, y, x + w, y + rad, rad);
  ctx.lineTo(x + w, y + h - rad);
  ctx.arcTo(x + w, y + h, x + w - rad, y + h, rad);
  ctx.lineTo(x + rad, y + h);
  ctx.arcTo(x, y + h, x, y + h - rad, rad);
  ctx.lineTo(x, y + rad);
  ctx.arcTo(x, y, x + rad, y, rad);
  ctx.closePath();
}

export function fillRound(ctx, x, y, w, h, r, fill) {
  roundRect(ctx, x, y, w, h, r);
  ctx.fillStyle = fill;
  ctx.fill();
}

export function strokeRound(ctx, x, y, w, h, r, stroke, lw = 1) {
  roundRect(ctx, x, y, w, h, r);
  ctx.strokeStyle = stroke;
  ctx.lineWidth = lw;
  ctx.stroke();
}

/** Draw a soft drop shadow without bleeding it onto later draws. */
export function withShadow(ctx, color, blur, oy, fn) {
  ctx.save();
  ctx.shadowColor = color;
  ctx.shadowBlur = blur;
  ctx.shadowOffsetY = oy;
  fn();
  ctx.restore();
}

/**
 * Greedy word wrap against a pixel width. Returns an array of lines.
 * `ctx.font` must already be set.
 */
export function wrapText(ctx, text, maxWidth) {
  const words = String(text).split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const lines = [];
  let line = words[0];
  for (let i = 1; i < words.length; i++) {
    const test = `${line} ${words[i]}`;
    if (ctx.measureText(test).width <= maxWidth) line = test;
    else { lines.push(line); line = words[i]; }
  }
  lines.push(line);
  return lines;
}

/** Split text into lines, then each line into words with x offsets, for per-word animation. */
export function layoutWords(ctx, text, maxWidth) {
  const lines = wrapText(ctx, text, maxWidth);
  const space = ctx.measureText(' ').width;
  return lines.map(line => {
    const words = line.split(' ');
    let x = 0;
    const laid = words.map(w => {
      const width = ctx.measureText(w).width;
      const item = { text: w, x, width };
      x += width + space;
      return item;
    });
    return { words: laid, width: x - space };
  });
}

export const fmtTime = s => {
  const m = Math.floor(s / 60);
  const r = s - m * 60;
  return `${m}:${r.toFixed(1).padStart(4, '0')}`;
};

export const uid = () => Math.random().toString(36).slice(2, 9);

export function pick(arr, r = Math.random) {
  return arr[Math.floor(r() * arr.length) % arr.length];
}

/** Fisher–Yates using a supplied PRNG so shuffles stay reproducible. */
export function shuffle(arr, r = Math.random) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Strip the studio's `*highlight*` markup, leaving the words alone. */
export const stripMarkup = s => String(s ?? '').replace(/\*/g, '');
