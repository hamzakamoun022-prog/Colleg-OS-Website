// Render engine.
//
// One frame = paint the scene into an oversized "plate", push that plate through
// the camera (zoom/pan/roll + motion blur + focus + aberration), grade it, lay
// kinetic type over the top, then apply the shot transition. Everything is a pure
// function of time, so a given storyboard + seed always renders identically —
// which is what makes frame-accurate export possible.

import { P, GRADES, font, BRAND } from './brand.js';
import { paintScene } from './scenes.js';
import { camera } from './motion.js';
import {
  clamp, lerp, ease, win, rgba, fbm, hashSeed, layoutWords, wrapText, rng,
  fillRound, roundRect, mixHex,
} from './util.js';

const PLATE_OVERSCAN = 1.28; // extra plate resolution so zooms stay sharp

/* ------------------------------------------------------------------ */
/* Text                                                                */
/* ------------------------------------------------------------------ */

/**
 * Copy markup: *word* renders in the accent colour with a highlighter sweep.
 * Returns plain text plus the ranges to emphasise.
 */
function parseMarkup(text) {
  const parts = String(text ?? '').split(/(\*[^*]+\*)/g).filter(s => s !== '');
  let plain = '';
  const marks = [];
  for (const part of parts) {
    if (part.startsWith('*') && part.endsWith('*') && part.length > 2) {
      const body = part.slice(1, -1);
      marks.push([plain.length, plain.length + body.length]);
      plain += body;
    } else plain += part;
  }
  return { plain, marks };
}

/** Shrink until the copy fits the box, so long AI lines never overflow. */
function fitText(ctx, text, maxWidth, maxLines, start, min, weight, family) {
  let size = start;
  while (size > min) {
    ctx.font = font(weight, size, family);
    const lines = wrapText(ctx, text, maxWidth);
    if (lines.length <= maxLines) return { size, lines };
    size *= 0.94;
  }
  ctx.font = font(weight, min, family);
  return { size: min, lines: wrapText(ctx, text, maxWidth) };
}

/** Is character index `i` inside an emphasised range? */
const isMarked = (marks, i) => marks.some(([a, b]) => i >= a && i < b);

/**
 * Draw one animated text block.
 * anim: stagger | mask | pop | type | slam
 */
function drawTextBlock(ctx, W, H, block, p, o) {
  const { plain, marks } = parseMarkup(block.text);
  if (!plain.trim()) return 0;

  const S = Math.min(W, H);
  const accent = block.accent || o.accent || P.brown;
  const color = block.color || (o.tone === 'dark' ? P.cream : P.darkBrown);
  const family = block.family || 'display';
  const weight = block.weight ?? (family === 'display' ? 400 : 500);
  const maxWidth = W * (block.maxWidth ?? 0.84);

  const { size, lines } = fitText(
    ctx, plain, maxWidth, block.maxLines ?? 3,
    S * (block.size ?? 0.085), S * 0.028, weight, family,
  );
  ctx.font = font(weight, size, family);

  const lineH = size * (family === 'display' ? 1.06 : 1.24);
  const totalH = lines.length * lineH;
  const anim = block.anim || 'stagger';
  const inP = clamp((p - (block.at ?? 0)) / (block.dur ?? 0.35));
  const outP = block.out === false ? 0 : clamp((p - (block.outAt ?? 0.88)) / 0.12);

  // Where the block sits vertically.
  let top;
  const pos = block.pos || 'center';
  if (pos === 'top') top = H * 0.13;
  else if (pos === 'lower') top = H * 0.72 - totalH / 2;
  else if (pos === 'bottom') top = H * 0.86 - totalH;
  else if (typeof pos === 'number') top = H * pos - totalH / 2;
  else top = H * 0.5 - totalH / 2;
  top += (block.offsetY || 0) * H;

  // Scrim keeps copy legible over busy footage. Held flat across the text band
  // and feathered only at the edges, so the copy never sits on a gradient.
  if (block.scrim) {
    const pad = size * 1.5;
    const a = block.scrim === true ? 0.9 : block.scrim;
    const c = o.tone === 'dark' ? P.ink : P.cream;
    const g = ctx.createLinearGradient(0, top - pad, 0, top + totalH + pad);
    g.addColorStop(0, rgba(c, 0));
    g.addColorStop(0.22, rgba(c, a));
    g.addColorStop(0.78, rgba(c, a));
    g.addColorStop(1, rgba(c, 0));
    ctx.save();
    ctx.globalAlpha = clamp(inP * 2);
    ctx.fillStyle = g;
    ctx.fillRect(0, top - pad, W, totalH + pad * 2);
    ctx.restore();
  }

  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';

  let charCursor = 0;
  lines.forEach((line, li) => {
    const lw = ctx.measureText(line).width;
    const align = block.align || 'center';
    const x0 = align === 'left' ? W * 0.08 : align === 'right' ? W - W * 0.08 - lw : (W - lw) / 2;
    const y = top + li * lineH + size * 0.82;

    // Per-line entrance progress
    const lineDelay = anim === 'mask' || anim === 'pop' ? li * 0.16 : 0;
    const lp = clamp((inP - lineDelay) / (1 - Math.min(0.7, lineDelay)));
    if (lp <= 0) { charCursor += line.length + 1; return; }

    ctx.save();
    ctx.globalAlpha = clamp(lp * 1.4) * (1 - outP);

    if (anim === 'mask') {
      // Wipe up from a clipped band.
      const e = ease.snap(lp);
      ctx.beginPath();
      ctx.rect(x0 - size * 0.2, y - size * 1.02, lw + size * 0.4, size * 1.35);
      ctx.clip();
      ctx.translate(0, lerp(size * 1.15, 0, e));
    } else if (anim === 'pop') {
      const e = ease.outBack(lp);
      ctx.translate(x0 + lw / 2, y - size * 0.32);
      ctx.scale(lerp(0.7, 1, e), lerp(0.7, 1, e));
      ctx.translate(-(x0 + lw / 2), -(y - size * 0.32));
    } else if (anim === 'slam') {
      const e = ease.outQuint(lp);
      ctx.translate(x0 + lw / 2, y - size * 0.32);
      const s = lerp(1.9, 1, e);
      ctx.scale(s, s);
      ctx.globalAlpha *= ease.outQuad(clamp(lp * 2));
      ctx.translate(-(x0 + lw / 2), -(y - size * 0.32));
    }

    // Highlight sweep behind emphasised words.
    if (marks.length && block.highlight !== false) {
      let cx = x0, ci = charCursor;
      for (const word of line.split(' ')) {
        const ww = ctx.measureText(word).width;
        if (isMarked(marks, ci)) {
          const hp = ease.outQuart(clamp((lp - 0.25) / 0.5));
          if (hp > 0) {
            ctx.save();
            ctx.globalAlpha *= 0.24;
            fillRound(ctx, cx - size * 0.08, y - size * 0.66, (ww + size * 0.16) * hp, size * 0.84, size * 0.12, accent);
            ctx.restore();
          }
        }
        cx += ww + ctx.measureText(' ').width;
        ci += word.length + 1;
      }
    }

    if (anim === 'stagger' || anim === 'type') {
      // Word-by-word (or character-by-character) reveal.
      let cx = x0, ci = charCursor;
      const words = line.split(' ');
      words.forEach((word, wi) => {
        const ww = ctx.measureText(word).width;
        const wp = anim === 'type'
          ? clamp((lp * (line.length + 4) - ci + charCursor) / 2)
          : ease.snap(clamp((lp - wi * (0.5 / Math.max(1, words.length))) / 0.55));
        if (wp > 0.001) {
          ctx.save();
          ctx.globalAlpha *= clamp(wp * 1.6);
          ctx.translate(0, lerp(size * 0.35, 0, ease.outQuart(wp)));
          ctx.fillStyle = isMarked(marks, ci) ? accent : color;
          if (block.shadow !== false) {
            ctx.shadowColor = rgba(o.tone === 'dark' ? '#000000' : P.darkBrown, 0.18);
            ctx.shadowBlur = size * 0.28;
            ctx.shadowOffsetY = size * 0.04;
          }
          ctx.fillText(word, cx, y);
          ctx.restore();
        }
        cx += ww + ctx.measureText(' ').width;
        ci += word.length + 1;
      });
    } else {
      // Whole-line draw, with per-word colouring for emphasis.
      let cx = x0, ci = charCursor;
      if (block.shadow !== false) {
        ctx.shadowColor = rgba(o.tone === 'dark' ? '#000000' : P.darkBrown, 0.18);
        ctx.shadowBlur = size * 0.28;
        ctx.shadowOffsetY = size * 0.04;
      }
      for (const word of line.split(' ')) {
        ctx.fillStyle = isMarked(marks, ci) ? accent : color;
        ctx.fillText(word, cx, y);
        cx += ctx.measureText(word).width + ctx.measureText(' ').width;
        ci += word.length + 1;
      }
    }
    ctx.restore();
    charCursor += line.length + 1;
  });

  return totalH;
}

/** Small uppercase kicker above a headline. */
function drawKicker(ctx, W, H, text, p, o, block = {}) {
  if (!text) return;
  const S = Math.min(W, H);
  const size = S * (block.size ?? 0.032);
  const inP = ease.outQuart(clamp((p - (block.at ?? 0)) / 0.3));
  if (inP <= 0) return;
  ctx.save();
  ctx.font = font(500, size);
  ctx.letterSpacing = `${size * 0.16}px`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const label = String(text).toUpperCase();
  const w = ctx.measureText(label).width;
  const y = H * (block.y ?? 0.115);
  ctx.globalAlpha = inP * (1 - clamp((p - 0.9) / 0.1));
  const pillW = (w + size * 2.2) * lerp(0.7, 1, inP);
  fillRound(ctx, W / 2 - pillW / 2, y - size * 1.05, pillW, size * 2.1, size * 1.05,
    rgba(o.accent || P.brown, 0.14));
  ctx.strokeStyle = rgba(o.accent || P.brown, 0.3);
  ctx.lineWidth = Math.max(1, size * 0.05);
  roundRect(ctx, W / 2 - pillW / 2, y - size * 1.05, pillW, size * 2.1, size * 1.05);
  ctx.stroke();
  ctx.fillStyle = o.accent || P.brown;
  ctx.globalAlpha = inP;
  ctx.fillText(label, W / 2 + size * 0.08, y);
  ctx.restore();
}

/** Persistent bottom CTA bar used on the closing shots. */
function drawCtaBar(ctx, W, H, text, p, o) {
  if (!text) return;
  const S = Math.min(W, H);
  const h = S * 0.098;
  const inP = ease.outBack(clamp(p / 0.35));
  if (inP <= 0) return;
  ctx.save();
  ctx.font = font(500, h * 0.34);
  const w = Math.min(W * 0.86, ctx.measureText(text).width + h * 1.6);
  const x = (W - w) / 2;
  const y = H * 0.865 - h / 2;
  ctx.globalAlpha = clamp(inP * 1.3);
  ctx.translate(W / 2, y + h / 2);
  ctx.scale(lerp(0.9, 1, inP), lerp(0.9, 1, inP));
  ctx.translate(-W / 2, -(y + h / 2));
  ctx.shadowColor = rgba(P.darkBrown, 0.32);
  ctx.shadowBlur = h * 0.6;
  ctx.shadowOffsetY = h * 0.16;
  fillRound(ctx, x, y, w, h, h / 2, P.darkBrown);
  ctx.shadowColor = 'transparent';
  ctx.fillStyle = P.cream;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, W / 2, y + h * 0.53);
  ctx.restore();
}

/* ------------------------------------------------------------------ */
/* Renderer                                                            */
/* ------------------------------------------------------------------ */

export class Renderer {
  constructor() {
    this.plate = document.createElement('canvas');
    this.pctx = this.plate.getContext('2d');
    this.tmp = document.createElement('canvas');
    this.tctx = this.tmp.getContext('2d');
    this.grainTile = null;
    this.W = 0; this.H = 0;
  }

  setSize(W, H) {
    if (this.W === W && this.H === H) return;
    this.W = W; this.H = H;
    this.plate.width = Math.round(W * PLATE_OVERSCAN);
    this.plate.height = Math.round(H * PLATE_OVERSCAN);
    this.tmp.width = W; this.tmp.height = H;
    this.grainTile = null;
  }

  /** Monochrome noise tile, generated once and tiled per frame. */
  getGrain() {
    if (this.grainTile) return this.grainTile;
    const n = 256;
    const c = document.createElement('canvas');
    c.width = c.height = n;
    const g = c.getContext('2d');
    const img = g.createImageData(n, n);
    const r = rng(1337);
    for (let i = 0; i < n * n; i++) {
      const v = 110 + r() * 90;
      img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v;
      img.data[i * 4 + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    this.grainTile = c;
    return c;
  }

  /**
   * Draw the plate through the camera onto ctx, including blur / focus /
   * chromatic aberration.
   */
  drawPlate(ctx, cam, quality) {
    const { W, H } = this;
    const pw = this.plate.width, ph = this.plate.height;
    const samples = cam.blur > 0.03
      ? (quality === 'preview' ? 3 : quality === 'fast' ? 4 : 7)
      : 1;

    // The plate is rendered at PLATE_OVERSCAN times the frame size purely for
    // supersampling — it still maps 1:1 onto the frame at scale 1, so a preset
    // that says "no zoom" really shows the whole composition.
    const put = (target, scaleMul, dx, dy, alpha) => {
      const s = cam.scale * scaleMul;
      const dw = W * s;
      const dh = H * s;
      target.save();
      target.globalAlpha = alpha;
      target.translate(W / 2 + cam.x * W + dx, H / 2 + cam.y * H + dy);
      target.rotate(cam.rot);
      target.drawImage(this.plate, -dw / 2, -dh / 2, dw, dh);
      target.restore();
    };

    const softBlur = (1 - clamp(cam.focus)) * 0.055 * Math.min(W, H);
    const drawStack = target => {
      if (softBlur > 0.4) target.filter = `blur(${softBlur.toFixed(2)}px)`;
      if (samples === 1) {
        put(target, 1, 0, 0, 1);
      } else {
        // Motion blur: a fan of samples along the motion, plus a zoom smear.
        const a = 1 / samples;
        const dirX = Math.cos(cam.dir), dirY = Math.sin(cam.dir);
        const reach = cam.blur;
        for (let i = 0; i < samples; i++) {
          const k = i / (samples - 1) - 0.5;
          const zoom = 1 + k * reach * 0.16;
          const off = k * reach * W * 0.05;
          put(target, zoom, dirX * off, dirY * off, a);
        }
      }
      target.filter = 'none';
    };

    if (cam.chroma > 0.05 && quality !== 'fast') {
      // True RGB channel split: rebuild the frame from three offset channels.
      const d = cam.chroma * Math.min(W, H) * 0.012;
      const chans = [
        ['#ff0000', d],
        ['#00ff00', 0],
        ['#0000ff', -d],
      ];
      ctx.save();
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, W, H);
      ctx.globalCompositeOperation = 'lighter';
      for (const [tint, off] of chans) {
        this.tctx.save();
        this.tctx.setTransform(1, 0, 0, 1, 0, 0);
        this.tctx.clearRect(0, 0, W, H);
        this.tctx.translate(off, 0);
        drawStack(this.tctx);
        this.tctx.setTransform(1, 0, 0, 1, 0, 0);
        this.tctx.globalCompositeOperation = 'multiply';
        this.tctx.fillStyle = tint;
        this.tctx.fillRect(0, 0, W, H);
        this.tctx.restore();
        ctx.drawImage(this.tmp, 0, 0);
      }
      ctx.restore();
    } else {
      drawStack(ctx);
    }
  }

  /** Colour grade + vignette + bloom + grain. */
  applyLook(ctx, look, t, frameIdx) {
    const { W, H } = this;
    const grade = GRADES[look.grade] || GRADES.warm;

    if (grade.lift.alpha > 0) {
      ctx.save();
      ctx.globalCompositeOperation = grade.lift.op;
      ctx.globalAlpha = grade.lift.alpha;
      ctx.fillStyle = grade.lift.color;
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
    }
    if (grade.tint.alpha > 0) {
      ctx.save();
      ctx.globalCompositeOperation = grade.tint.op;
      ctx.globalAlpha = grade.tint.alpha;
      ctx.fillStyle = grade.tint.color;
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
    }

    if (look.bloom > 0) {
      ctx.save();
      ctx.globalCompositeOperation = 'soft-light';
      ctx.globalAlpha = look.bloom * 0.5;
      ctx.fillStyle = '#FFF3DC';
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
    }

    if (look.leak > 0) {
      // Slow warm light leak drifting across the frame.
      const x = W * (0.5 + Math.sin(t * 0.35) * 0.6);
      const g = ctx.createRadialGradient(x, H * 0.2, 0, x, H * 0.2, W * 0.85);
      g.addColorStop(0, rgba('#FFCE8A', 0.5 * look.leak));
      g.addColorStop(0.5, rgba('#E8A15C', 0.16 * look.leak));
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.save();
      ctx.globalCompositeOperation = 'screen';
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
    }

    if (look.vignette > 0) {
      const g = ctx.createRadialGradient(W / 2, H * 0.48, Math.min(W, H) * 0.28, W / 2, H * 0.5, Math.max(W, H) * 0.78);
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(1, rgba(P.ink, 0.55 * look.vignette));
      ctx.save();
      ctx.globalCompositeOperation = 'multiply';
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
    }

    if (look.grain > 0) {
      const tile = this.getGrain();
      const r = rng(frameIdx * 7919 + 13);
      ctx.save();
      ctx.globalCompositeOperation = 'overlay';
      ctx.globalAlpha = look.grain * 0.5;
      const pat = ctx.createPattern(tile, 'repeat');
      ctx.translate(-Math.floor(r() * 256), -Math.floor(r() * 256));
      ctx.fillStyle = pat;
      ctx.fillRect(0, 0, W + 256, H + 256);
      ctx.restore();
    }

    if (look.letterbox > 0) {
      const bh = H * 0.055 * look.letterbox;
      ctx.fillStyle = P.ink;
      ctx.fillRect(0, 0, W, bh);
      ctx.fillRect(0, H - bh, W, bh);
    }
  }

  /** Snapshot of the current frame, reused across frames rather than reallocated. */
  snapshot(ctx) {
    const { W, H } = this;
    if (!this.snap) {
      this.snap = document.createElement('canvas');
      this.snapCtx = this.snap.getContext('2d');
    }
    if (this.snap.width !== W || this.snap.height !== H) {
      this.snap.width = W; this.snap.height = H;
    }
    this.snapCtx.setTransform(1, 0, 0, 1, 0, 0);
    this.snapCtx.clearRect(0, 0, W, H);
    this.snapCtx.drawImage(ctx.canvas, 0, 0);
    return this.snap;
  }

  /** Shot transitions, drawn over the finished frame of the incoming scene. */
  applyTransition(ctx, kind, k, seed) {
    // k: 0 → just cut, 1 → fully resolved
    const { W, H } = this;
    if (!kind || kind === 'cut' || k >= 1) return;
    const e = clamp(k);

    if (kind === 'flash') {
      ctx.save();
      ctx.globalAlpha = (1 - e) ** 1.6;
      ctx.fillStyle = P.white;
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
    } else if (kind === 'dip') {
      ctx.save();
      ctx.globalAlpha = (1 - e) ** 1.2;
      ctx.fillStyle = P.cream;
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
    } else if (kind === 'burn') {
      ctx.save();
      ctx.globalCompositeOperation = 'screen';
      ctx.globalAlpha = (1 - e) ** 1.4;
      const g = ctx.createRadialGradient(W * 0.5, H * 0.45, 0, W * 0.5, H * 0.45, Math.max(W, H) * 0.7);
      g.addColorStop(0, '#FFD9A0');
      g.addColorStop(0.6, '#C97A3C');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
    } else if (kind === 'glitch') {
      // Horizontal slice displacement with an RGB fringe.
      const r = rng(seed + Math.floor(k * 60));
      const strength = (1 - e) ** 1.5;
      const slices = 14;
      const snap = this.snapshot(ctx);
      ctx.save();
      for (let i = 0; i < slices; i++) {
        if (r() > 0.55) continue;
        const sy = (i / slices) * H;
        const sh = H / slices;
        const dx = (r() - 0.5) * W * 0.14 * strength;
        ctx.clearRect(0, sy, W, sh);
        ctx.drawImage(snap, 0, sy, W, sh, dx, sy, W, sh);
      }
      ctx.globalCompositeOperation = 'screen';
      ctx.globalAlpha = strength * 0.35;
      ctx.drawImage(snap, W * 0.006 * strength, 0);
      ctx.fillStyle = rgba('#FF4D3D', 0.12 * strength);
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
    } else if (kind === 'whip') {
      // Directional smear that resolves — reads as a camera whip into the shot.
      const strength = (1 - e) ** 1.6;
      const snap = this.snapshot(ctx);
      ctx.save();
      ctx.globalAlpha = 1;
      for (let i = 1; i <= 6; i++) {
        ctx.globalAlpha = 0.22 * strength;
        ctx.drawImage(snap, -i * W * 0.05 * strength, 0);
        ctx.drawImage(snap, i * W * 0.05 * strength, 0);
      }
      ctx.restore();
    } else if (kind === 'zoomBlur') {
      const strength = (1 - e) ** 1.5;
      const snap = this.snapshot(ctx);
      ctx.save();
      for (let i = 1; i <= 7; i++) {
        const s = 1 + i * 0.035 * strength;
        ctx.globalAlpha = 0.16 * strength;
        ctx.drawImage(snap, W / 2 - (W * s) / 2, H / 2 - (H * s) / 2, W * s, H * s);
      }
      ctx.restore();
    } else if (kind === 'wipe') {
      ctx.save();
      const x = W * (1 - e);
      ctx.fillStyle = P.beige;
      ctx.fillRect(x, 0, W - x + 2, H);
      ctx.fillStyle = P.darkBrown;
      ctx.fillRect(x - W * 0.006, 0, W * 0.006, H);
      ctx.restore();
    }
  }

  /**
   * Render a single frame of a storyboard at time t (seconds).
   * @returns {number} index of the active scene
   */
  render(ctx, board, t, opts = {}) {
    const { W, H } = this;
    const quality = opts.quality || 'hd';
    const look = { grain: 0.35, vignette: 0.5, bloom: 0.2, leak: 0.25, letterbox: 0, ...(board.look || {}) };
    const scenes = board.scenes;
    if (!scenes?.length) {
      ctx.fillStyle = P.cream;
      ctx.fillRect(0, 0, W, H);
      return -1;
    }

    // Locate the active scene.
    let acc = 0, idx = 0, local = 0;
    for (let i = 0; i < scenes.length; i++) {
      const d = scenes[i].dur;
      if (t < acc + d || i === scenes.length - 1) { idx = i; local = clamp((t - acc) / d); break; }
      acc += d;
    }
    const scene = scenes[idx];
    const sceneStart = acc;
    const p = local;
    const seed = hashSeed(`${board.seed || 1}:${scene.id || idx}`);
    const noise = fbm(seed, 3);

    // --- plate ---
    const pw = this.plate.width, ph = this.plate.height;
    this.pctx.setTransform(1, 0, 0, 1, 0, 0);
    this.pctx.clearRect(0, 0, pw, ph);
    paintScene(scene.layer, this.pctx, pw, ph, p, {
      ...scene.layerOpts,
      assets: opts.assets,
      seed,
      accent: scene.accent,
      tone: scene.tone,
    });

    // --- camera ---
    const cam = camera(scene.motion, p, scene.motionAmount ?? 1, noise, 1);
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = scene.tone === 'dark' ? P.ink : P.cream;
    ctx.fillRect(0, 0, W, H);
    this.drawPlate(ctx, cam, quality);
    ctx.restore();

    // --- look ---
    this.applyLook(ctx, look, t, Math.round(t * 60));

    // --- legibility wash ---
    // Busy footage under a big headline reads as noise. A flat veil in the
    // background colour pushes the footage back to texture without hiding it.
    if (scene.wash > 0) {
      ctx.save();
      ctx.globalAlpha = clamp(scene.wash);
      ctx.fillStyle = scene.tone === 'dark' ? P.ink : P.cream;
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
    }

    // --- type ---
    const tOpts = { accent: scene.accent || P.brown, tone: scene.tone };
    if (scene.kicker) drawKicker(ctx, W, H, scene.kicker, p, tOpts, scene.kickerOpts || {});
    for (const block of scene.text || []) {
      drawTextBlock(ctx, W, H, block, p, tOpts);
    }
    if (scene.cta) drawCtaBar(ctx, W, H, scene.cta, p, tOpts);

    // --- transition into this scene ---
    const trans = scene.transition || 'cut';
    const tDur = scene.transitionDur ?? 0.34;
    if (idx > 0 && t - sceneStart < tDur) {
      this.applyTransition(ctx, trans, (t - sceneStart) / tDur, seed);
    }

    // Tail fade only — social video should never fade in, it wastes the hook.
    const total = board.scenes.reduce((s, x) => s + x.dur, 0);
    const fade = clamp((total - t) / 0.3);
    if (fade < 1) {
      ctx.save();
      ctx.globalAlpha = 1 - fade;
      ctx.fillStyle = P.cream;
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
    }

    return idx;
  }
}

export const totalDuration = board =>
  (board?.scenes || []).reduce((s, x) => s + (x.dur || 0), 0);

/** Safe-area guides drawn only in the editor preview, never in exports. */
export function drawGuides(ctx, W, H) {
  ctx.save();
  ctx.strokeStyle = 'rgba(255,80,80,0.55)';
  ctx.lineWidth = Math.max(1, W * 0.002);
  ctx.setLineDash([W * 0.02, W * 0.02]);
  ctx.strokeRect(W * 0.06, H * 0.08, W * 0.88, H * 0.84);
  ctx.setLineDash([]);
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.fillRect(0, 0, W, H * 0.08);
  ctx.fillRect(0, H * 0.86, W, H * 0.14);
  ctx.font = font(500, W * 0.028);
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  ctx.fillText('UI overlay zone', W * 0.07, H * 0.055);
  ctx.fillText('caption / CTA zone', W * 0.07, H * 0.93);
  ctx.restore();
}
