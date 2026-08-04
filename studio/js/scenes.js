// Footage layers.
//
// Every scene paints into a "plate" canvas at render resolution. Because they're
// drawn as vectors rather than sampled from a screenshot, they stay sharp under
// any amount of camera zoom and — more importantly — they can animate, so the
// product appears to be in use rather than sitting still.
//
// Signature: paint(ctx, W, H, p, o) where p is 0..1 scene progress and `o` carries
// { assets, seed, noise, accent, text overrides }.

import { P, BRAND, font } from './brand.js';
import {
  clamp, lerp, ease, win, rgba, roundRect, fillRound, strokeRound, withShadow,
  wrapText, rng, mixHex,
} from './util.js';

/** Local progress for the i-th item of a staggered group. */
export function stagger(p, i, count, span = 0.55, start = 0.05) {
  const step = count > 1 ? span / count : 0;
  const s = start + step * i;
  return clamp((p - s) / Math.max(0.0001, span / Math.max(count, 1) + 0.18));
}

/* ------------------------------------------------------------------ */
/* Shared primitives                                                   */
/* ------------------------------------------------------------------ */

/** Brand backdrop: cream paper with a warm corner bloom and paper fibre. */
export function backdrop(ctx, W, H, o = {}) {
  const tone = o.tone || 'cream';
  const bg = tone === 'dark' ? P.ink : tone === 'white' ? P.white : P.cream;
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  const g = ctx.createRadialGradient(W * 0.85, H * 0.12, 0, W * 0.85, H * 0.12, W * 0.95);
  g.addColorStop(0, rgba(tone === 'dark' ? P.brown : P.warmTan, tone === 'dark' ? 0.30 : 0.34));
  g.addColorStop(1, rgba(P.warmTan, 0));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  const g2 = ctx.createRadialGradient(W * 0.1, H * 0.92, 0, W * 0.1, H * 0.92, W * 0.8);
  g2.addColorStop(0, rgba(tone === 'dark' ? P.darkBrown : P.beige, 0.5));
  g2.addColorStop(1, rgba(P.beige, 0));
  ctx.fillStyle = g2;
  ctx.fillRect(0, 0, W, H);
}

/**
 * A floating Notion window: rounded white card with title bar. Returns the inner
 * content rect so callers can lay out inside it.
 */
export function window_(ctx, x, y, w, h, o = {}) {
  const r = w * 0.028;
  withShadow(ctx, rgba(P.darkBrown, 0.28), h * 0.09, h * 0.035, () => {
    fillRound(ctx, x, y, w, h, r, o.dark ? '#241a0e' : P.white);
  });
  strokeRound(ctx, x, y, w, h, r, rgba(P.brown, 0.18), Math.max(1, w * 0.0016));

  const barH = h * 0.075;
  ctx.save();
  roundRect(ctx, x, y, w, h, r);
  ctx.clip();
  ctx.fillStyle = o.dark ? '#2e2213' : '#F4EFE7';
  ctx.fillRect(x, y, w, barH);
  ctx.fillStyle = rgba(P.brown, 0.16);
  ctx.fillRect(x, y + barH - Math.max(1, h * 0.0012), w, Math.max(1, h * 0.0012));
  ctx.restore();

  // Traffic lights
  const dot = barH * 0.19;
  ['#E0705E', '#E3B357', '#7FB08A'].forEach((c, i) => {
    ctx.beginPath();
    ctx.arc(x + barH * 0.55 + i * dot * 2.9, y + barH / 2, dot, 0, Math.PI * 2);
    ctx.fillStyle = c;
    ctx.fill();
  });

  if (o.title) {
    ctx.font = font(500, barH * 0.42);
    ctx.fillStyle = rgba(P.textLight, 0.85);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(o.title, x + w / 2, y + barH / 2);
    ctx.textAlign = 'left';
  }

  const pad = w * 0.055;
  return { x: x + pad, y: y + barH + pad * 0.75, w: w - pad * 2, h: h - barH - pad * 1.5 };
}

/**
 * Fit a window into the frame with sensible margins for the aspect ratio.
 * On vertical formats it sits slightly above centre, leaving a clean band at the
 * bottom for the caption and a kicker pill up top.
 */
export function pageFrame(ctx, W, H, o = {}) {
  // The kicker pill and the bottom caption are drawn by the engine in frame
  // space, but this window lives in the plate and therefore grows with the
  // camera. Sizing it to a band that already excludes both zones — with headroom
  // for the zoom — is what keeps a push-in from shoving the window chrome under
  // the kicker.
  const ratio = H / W;
  const shape = ratio > 1.1 ? 'tall' : ratio > 0.9 ? 'square' : 'wide';
  const spec = {
    tall:   { w: 0.82, maxH: 0.53, aspect: 1.25, top: 0.155, bottom: 0.760 },
    square: { w: 0.80, maxH: 0.60, aspect: 0.82, top: 0.200, bottom: 0.700 },
    wide:   { w: 0.66, maxH: 0.62, aspect: 0.62, top: 0.190, bottom: 0.700 },
  }[shape];

  const w = W * spec.w;
  const bandTop = H * spec.top;
  const bandBottom = H * spec.bottom;
  const h = Math.min(H * spec.maxH, w * spec.aspect, bandBottom - bandTop);
  const x = (W - w) / 2;
  const y = bandTop + (bandBottom - bandTop - h) / 2 + ((o.offsetY ?? 0) * H);
  return window_(ctx, x, y, w, h, o);
}

/** Notion-style page heading: emoji + serif title + faint divider. */
function pageTitle(ctx, r, text, emoji, reveal = 1) {
  const size = r.w * 0.062;
  ctx.save();
  ctx.globalAlpha = reveal;
  ctx.textBaseline = 'alphabetic';
  let x = r.x;
  if (emoji) {
    ctx.font = font(400, size * 0.95);
    ctx.fillText(emoji, x, r.y + size);
    x += size * 1.25;
  }
  ctx.font = font(600, size, 'display');
  ctx.fillStyle = P.text;
  ctx.fillText(text, x, r.y + size);
  ctx.restore();
  return r.y + size * 1.55;
}

/** Coloured Notion tag pill. */
function tag(ctx, x, y, text, color, h) {
  ctx.font = font(500, h * 0.55);
  const w = ctx.measureText(text).width + h * 0.7;
  fillRound(ctx, x, y, w, h, h * 0.32, rgba(color, 0.16));
  ctx.fillStyle = mixHex(color, P.text, 0.25);
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x + h * 0.35, y + h * 0.53);
  return w;
}

function checkbox(ctx, x, y, s, checked, t = 1) {
  const done = checked ? ease.outBack(clamp(t)) : 0;
  strokeRound(ctx, x, y, s, s, s * 0.22, rgba(P.textLight, 0.55), Math.max(1, s * 0.075));
  if (done > 0.01) {
    ctx.save();
    ctx.globalAlpha = clamp(done * 1.4);
    fillRound(ctx, x, y, s, s, s * 0.22, P.green);
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = s * 0.14;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const seg = clamp(done * 1.3);
    ctx.beginPath();
    ctx.moveTo(x + s * 0.24, y + s * 0.52);
    const midX = x + s * 0.44, midY = y + s * 0.71;
    if (seg < 0.5) {
      const k = seg / 0.5;
      ctx.lineTo(lerp(x + s * 0.24, midX, k), lerp(y + s * 0.52, midY, k));
    } else {
      ctx.lineTo(midX, midY);
      const k = (seg - 0.5) / 0.5;
      ctx.lineTo(lerp(midX, x + s * 0.78, k), lerp(midY, y + s * 0.29, k));
    }
    ctx.stroke();
    ctx.restore();
  }
}

/* ------------------------------------------------------------------ */
/* Product scenes                                                      */
/* ------------------------------------------------------------------ */

/** Assignment Tracker — kanban board with a card completing mid-scene. */
function assignmentBoard(ctx, W, H, p, o) {
  backdrop(ctx, W, H, o);
  const r = pageFrame(ctx, W, H, { title: 'Assignment Tracker — College OS' });
  let y = pageTitle(ctx, r, 'Assignment Tracker', '📚', clamp(p * 8));

  // View switcher
  const chipH = r.h * 0.062;
  let cx = r.x;
  ['⊞ Table', '▤ Board', '▦ Calendar'].forEach((label, i) => {
    const active = i === 1;
    ctx.font = font(active ? 500 : 400, chipH * 0.48);
    const w = ctx.measureText(label).width + chipH * 0.8;
    if (active) fillRound(ctx, cx, y, w, chipH, chipH * 0.28, rgba(P.brown, 0.13));
    ctx.fillStyle = active ? P.darkBrown : rgba(P.textLight, 0.8);
    ctx.textBaseline = 'middle';
    ctx.fillText(label, cx + chipH * 0.4, y + chipH * 0.54);
    cx += w + chipH * 0.35;
  });
  y += chipH * 1.7;

  const cols = [
    { name: 'Not started', color: P.red, cards: ['Lab report', 'Math problem set', 'Reading ch. 3'] },
    { name: 'In progress', color: P.amber, cards: ['Essay draft'] },
    { name: 'Done', color: P.green, cards: ['Quiz prep'] },
  ];
  const gap = r.w * 0.028;
  const colW = (r.w - gap * 2) / 3;
  const colH = r.y + r.h - y;

  // Around 55% through, a card flies from "In progress" to "Done".
  const moveP = ease.inOutCubic(win(p, 0.5, 0.82));

  cols.forEach((col, ci) => {
    const x = r.x + ci * (colW + gap);
    fillRound(ctx, x, y, colW, colH, colW * 0.06, rgba(col.color, 0.07));

    const hH = colH * 0.11;
    ctx.beginPath();
    ctx.arc(x + colW * 0.06, y + hH * 0.55, hH * 0.14, 0, Math.PI * 2);
    ctx.fillStyle = col.color;
    ctx.fill();
    const hs = Math.min(hH * 0.42, colW * 0.115);
    ctx.font = font(500, hs);
    ctx.fillStyle = mixHex(col.color, P.text, 0.3);
    ctx.textBaseline = 'middle';
    ctx.fillText(col.name, x + colW * 0.12, y + hH * 0.57);

    let count = col.cards.length;
    if (ci === 1) count = Math.round(lerp(1, 0, moveP));
    if (ci === 2) count = Math.round(lerp(1, 2, moveP));
    ctx.font = font(400, hs * 0.95);
    ctx.fillStyle = rgba(P.textLight, 0.75);
    ctx.textAlign = 'right';
    ctx.fillText(String(count), x + colW * 0.92, y + hH * 0.57);
    ctx.textAlign = 'left';

    const cardH = colH * 0.155;
    col.cards.forEach((label, i) => {
      const a = stagger(p, ci * 2 + i, 6, 0.4, 0.02);
      if (a <= 0) return;
      let px = x + colW * 0.06;
      let py = y + hH + i * (cardH + colH * 0.03);
      let alpha = ease.outCubic(a);
      let scale = lerp(0.94, 1, ease.outBack(a));

      // The travelling card.
      const isMover = ci === 1 && i === 0;
      if (isMover && moveP > 0) {
        const destX = r.x + 2 * (colW + gap) + colW * 0.06;
        const destY = y + hH + 1 * (cardH + colH * 0.03);
        px = lerp(px, destX, moveP);
        py = lerp(py, destY, moveP);
        scale *= 1 + Math.sin(moveP * Math.PI) * 0.06;
      }

      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(px + (colW * 0.88) / 2, py + cardH / 2);
      ctx.scale(scale, scale);
      ctx.translate(-(colW * 0.88) / 2, -cardH / 2);
      withShadow(ctx, rgba(P.darkBrown, isMover && moveP > 0 && moveP < 1 ? 0.28 : 0.1), cardH * (isMover ? 0.5 : 0.25), cardH * 0.08, () => {
        fillRound(ctx, 0, 0, colW * 0.88, cardH, cardH * 0.16, P.white);
      });
      strokeRound(ctx, 0, 0, colW * 0.88, cardH, cardH * 0.16, rgba(P.brown, 0.14), 1);
      const cts = Math.min(cardH * 0.3, colW * 0.115);
      ctx.font = font(400, cts);
      ctx.fillStyle = P.text;
      ctx.textBaseline = 'middle';
      ctx.fillText(`📄 ${label}`, cardH * 0.22, cardH * 0.45);
      const done = isMover && moveP > 0.9;
      ctx.font = font(400, cts * 0.78);
      ctx.fillStyle = done ? P.green : rgba(P.textLight, 0.8);
      ctx.fillText(done ? '✓ Completed' : 'Due in 3 days', cardH * 0.22, cardH * 0.78);
      ctx.restore();
    });
  });
}

/** Today's Tasks — checklist ticking itself off. */
function todoChecklist(ctx, W, H, p, o) {
  backdrop(ctx, W, H, o);
  const r = pageFrame(ctx, W, H, { title: 'Today — College OS' });
  let y = pageTitle(ctx, r, "Today's Tasks", '✅', clamp(p * 8));

  const items = o.items || [
    'Review lecture notes',
    'Email professor',
    'Complete reading ch. 3',
    'Submit assignment on portal',
    'Prepare for tomorrow class',
  ];
  const rowH = (r.y + r.h - y) / (items.length + 0.6);
  const box = Math.min(rowH * 0.42, r.w * 0.05);
  const ts = Math.min(rowH * 0.36, r.w * 0.044);

  fillRound(ctx, r.x - r.w * 0.02, y - rowH * 0.25, r.w * 1.04, rowH * (items.length + 0.4), rowH * 0.2, rgba(P.beige, 0.75));

  items.forEach((it, i) => {
    const t = stagger(p, i, items.length, 0.62, 0.12);
    const appear = ease.outCubic(clamp(t * 2.2));
    const ticked = clamp((t - 0.35) / 0.5);
    const ry = y + i * rowH;
    ctx.save();
    ctx.globalAlpha = appear;
    checkbox(ctx, r.x, ry + (rowH - box) / 2 - rowH * 0.04, box, true, ticked);
    ctx.font = font(400, ts);
    ctx.fillStyle = ticked > 0.6 ? rgba(P.textLight, 0.6) : P.text;
    ctx.textBaseline = 'middle';
    const tx = r.x + box * 1.7;
    ctx.fillText(it, tx, ry + rowH * 0.46);
    if (ticked > 0.55) {
      const strike = ease.outQuart(clamp((ticked - 0.55) / 0.45));
      const wdt = ctx.measureText(it).width;
      ctx.strokeStyle = rgba(P.textLight, 0.6);
      ctx.lineWidth = Math.max(1, rowH * 0.03);
      ctx.beginPath();
      ctx.moveTo(tx, ry + rowH * 0.47);
      ctx.lineTo(tx + wdt * strike, ry + rowH * 0.47);
      ctx.stroke();
    }
    ctx.restore();
  });
}

/** Exam Countdown — the auto-calculating formula, ticking down on camera. */
function examCountdown(ctx, W, H, p, o) {
  backdrop(ctx, W, H, o);
  const r = pageFrame(ctx, W, H, { title: 'Exam Countdown — College OS' });
  let y = pageTitle(ctx, r, 'Exam Countdown', '⏳', clamp(p * 8));

  // On a wide window the numeral and the exam list sit side by side; stacking
  // them would shrink the hero number to nothing and squash the rows flat.
  const avail = r.y + r.h - y;
  const wide = r.w / avail > 1.5;
  const numCol = wide ? r.w * 0.44 : r.w;
  const listX = wide ? r.x + r.w * 0.50 : r.x;
  const listW = wide ? r.w * 0.50 : r.w;

  // Hero number flips 15 → 14 to prove the formula updates itself.
  const flip = win(p, 0.45, 0.62);
  const numSize = Math.min(numCol * (wide ? 0.62 : 0.30), avail * (wide ? 0.66 : 0.42));
  const cxp = r.x + numCol / 2;
  const numY = wide ? y + avail * 0.52 : y + numSize * 0.82;

  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  const drawNum = (val, shift, alpha, scale) => {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(cxp, numY + shift);
    ctx.scale(scale, scale);
    ctx.font = font(300, numSize, 'display');
    ctx.fillStyle = P.darkBrown;
    ctx.fillText(val, 0, 0);
    ctx.restore();
  };
  if (flip <= 0) {
    drawNum('15', 0, ease.outCubic(clamp(p * 6)), lerp(0.9, 1, ease.outBack(clamp(p * 5))));
  } else if (flip >= 1) {
    drawNum('14', 0, 1, 1 + Math.sin(clamp((p - 0.62) / 0.12) * Math.PI) * 0.05);
  } else {
    const e = ease.inOutQuart(flip);
    drawNum('15', -numSize * 0.55 * e, 1 - e, 1);
    drawNum('14', numSize * 0.55 * (1 - e), e, 1);
  }
  const labelSize = Math.min(numCol * 0.052, avail * 0.075);
  ctx.font = font(500, labelSize);
  ctx.fillStyle = P.brown;
  ctx.letterSpacing = `${labelSize * 0.16}px`;
  ctx.fillText('DAYS UNTIL BIOLOGY FINAL', cxp, numY + numSize * 0.30);
  ctx.letterSpacing = '0px';
  ctx.restore();

  // Upcoming exams — beside the numeral when wide, beneath it when tall.
  let ry = wide ? y : numY + numSize * 0.52;
  const rows = [
    ['Biology Final', '14 days', P.red],
    ['Statistics Midterm', '21 days', P.amber],
    ['History Essay Exam', '30 days', P.green],
  ];
  const rowH = Math.min((r.y + r.h - ry) / 3.4, listW * 0.16);
  const rs = Math.min(rowH * 0.36, listW * 0.06);
  if (wide) ry += ((r.y + r.h - ry) - rowH * 3.3) / 2;
  rows.forEach((row, i) => {
    const a = ease.outCubic(stagger(p, i, 3, 0.4, 0.25));
    if (a <= 0) return;
    ctx.save();
    ctx.globalAlpha = a;
    ctx.translate(0, lerp(rowH * 0.4, 0, a));
    fillRound(ctx, listX, ry + i * rowH * 1.15, listW, rowH, rowH * 0.22, rgba(P.beige, 0.8));
    ctx.font = font(400, rs);
    ctx.fillStyle = P.text;
    ctx.textBaseline = 'middle';
    ctx.fillText(row[0], listX + rowH * 0.4, ry + i * rowH * 1.15 + rowH * 0.5);
    const th = Math.min(rowH * 0.52, rs * 1.55);
    ctx.textAlign = 'left';
    ctx.font = font(500, th * 0.55);
    const tw = ctx.measureText(row[1]).width;
    tag(ctx, listX + listW - tw - th * 1.1, ry + i * rowH * 1.15 + (rowH - th) / 2, row[1], row[2], th);
    ctx.restore();
  });
}

/** Finance Tracker — donut chart drawing itself with a live balance. */
function financeDonut(ctx, W, H, p, o) {
  backdrop(ctx, W, H, o);
  const r = pageFrame(ctx, W, H, { title: 'Finance Tracker — College OS' });
  let y = pageTitle(ctx, r, 'My Finances', '💰', clamp(p * 8));

  const cats = [
    { name: 'Groceries', v: 145.5, c: P.amber },
    { name: 'Transport', v: 60, c: P.blue },
    { name: 'Social', v: 85, c: P.red },
    { name: 'Subscriptions', v: 31, c: P.violet },
    { name: 'Education', v: 48, c: P.green },
  ];
  const total = cats.reduce((s, c) => s + c.v, 0);

  const vertical = H / W > 1.1;
  const donutR = Math.min(r.w * (vertical ? 0.30 : 0.22), (r.y + r.h - y) * 0.42);
  const dcx = vertical ? r.x + r.w * 0.32 : r.x + r.w * 0.22;
  const dcy = y + donutR * 1.15;
  const thick = donutR * 0.34;

  const draw = ease.outCubic(win(p, 0.05, 0.72));
  let a0 = -Math.PI / 2;
  ctx.lineCap = 'butt';
  cats.forEach(c => {
    const sweep = (c.v / total) * Math.PI * 2 * draw;
    ctx.beginPath();
    ctx.arc(dcx, dcy, donutR - thick / 2, a0, a0 + sweep);
    ctx.strokeStyle = c.c;
    ctx.lineWidth = thick;
    ctx.stroke();
    a0 += (c.v / total) * Math.PI * 2 * draw;
  });
  // Track behind
  ctx.beginPath();
  ctx.arc(dcx, dcy, donutR - thick / 2, 0, Math.PI * 2);
  ctx.strokeStyle = rgba(P.warmTan, 0.18);
  ctx.lineWidth = thick * 0.999;
  ctx.globalCompositeOperation = 'destination-over';
  ctx.stroke();
  ctx.globalCompositeOperation = 'source-over';

  // Counting centre value
  const spent = total * draw;
  ctx.textAlign = 'center';
  ctx.font = font(400, donutR * 0.42, 'display');
  ctx.fillStyle = P.darkBrown;
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(`$${spent.toFixed(0)}`, dcx, dcy + donutR * 0.06);
  ctx.font = font(400, donutR * 0.15);
  ctx.fillStyle = rgba(P.textLight, 0.9);
  ctx.fillText('spent this month', dcx, dcy + donutR * 0.28);
  ctx.textAlign = 'left';

  // Legend
  const lx = vertical ? r.x + r.w * 0.57 : r.x + r.w * 0.44;
  const lw = r.x + r.w - lx;
  const lh = Math.min((donutR * 2) / cats.length, r.h * 0.09);
  const ls = Math.min(lh * 0.36, lw * 0.115);
  cats.forEach((c, i) => {
    const a = ease.outCubic(stagger(p, i, cats.length, 0.5, 0.15));
    if (a <= 0) return;
    ctx.save();
    ctx.globalAlpha = a;
    const ly = dcy - donutR + i * lh * 1.12;
    fillRound(ctx, lx, ly + lh * 0.18, lh * 0.28, lh * 0.28, lh * 0.09, c.c);
    ctx.font = font(400, ls);
    ctx.fillStyle = P.text;
    ctx.textBaseline = 'middle';
    ctx.fillText(c.name, lx + lh * 0.5, ly + lh * 0.33);
    ctx.textAlign = 'right';
    ctx.font = font(500, ls);
    ctx.fillStyle = P.darkBrown;
    ctx.fillText(`$${c.v.toFixed(2)}`, lx + lw, ly + lh * 0.33);
    ctx.textAlign = 'left';
    ctx.restore();
  });

  // Remaining balance strip
  const by = dcy + donutR * 1.25;
  if (by + r.h * 0.11 < r.y + r.h) {
    const bh = Math.min(r.h * 0.13, r.y + r.h - by);
    fillRound(ctx, r.x, by, r.w, bh, bh * 0.22, rgba(P.green, 0.12));
    ctx.font = font(400, bh * 0.3);
    ctx.fillStyle = P.text;
    ctx.textBaseline = 'middle';
    ctx.fillText('💵 Remaining this month', r.x + bh * 0.35, by + bh * 0.5);
    ctx.textAlign = 'right';
    ctx.font = font(500, bh * 0.4);
    ctx.fillStyle = mixHex(P.green, P.text, 0.2);
    ctx.fillText(`$${(800 - spent).toFixed(2)}`, r.x + r.w - bh * 0.35, by + bh * 0.5);
    ctx.textAlign = 'left';
  }
}

/** Expense table — rows landing one by one like a live log. */
function expenseTable(ctx, W, H, p, o) {
  backdrop(ctx, W, H, o);
  const r = pageFrame(ctx, W, H, { title: 'Expenses — College OS' });
  let y = pageTitle(ctx, r, 'Expenses', '💸', clamp(p * 8));

  const rows = [
    ['Monthly Salary', '$800.00', 'Education', P.green, 'Income'],
    ['Dinner with friends', '$25.00', 'Social', P.red, 'Expense'],
    ['Bus Pass', '$30.00', 'Transport', P.blue, 'Expense'],
    ['Netflix', '$15.99', 'Subscriptions', P.violet, 'Expense'],
    ['Grocery Run', '$45.50', 'Groceries', P.amber, 'Expense'],
  ];
  const rowH = (r.y + r.h - y) / (rows.length + 1.2);
  // Type is sized against the narrowest column, not the row height — a tall
  // window would otherwise inflate the text until columns collided.
  const ts = Math.min(rowH * 0.33, r.w * 0.036);

  ctx.font = font(500, ts * 0.85);
  ctx.fillStyle = rgba(P.textLight, 0.85);
  ctx.textBaseline = 'middle';
  const cols = [0, 0.42, 0.62, 0.86];
  ['Expense', 'Amount', 'Category', 'Type'].forEach((h, i) => {
    ctx.fillText(h, r.x + r.w * cols[i], y + rowH * 0.4);
  });
  ctx.textBaseline = 'middle';
  ctx.strokeStyle = rgba(P.brown, 0.18);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(r.x, y + rowH * 0.78);
  ctx.lineTo(r.x + r.w, y + rowH * 0.78);
  ctx.stroke();

  rows.forEach((row, i) => {
    const a = ease.outCubic(stagger(p, i, rows.length, 0.62, 0.08));
    if (a <= 0) return;
    const ry = y + rowH * (1 + i);
    ctx.save();
    ctx.globalAlpha = a;
    ctx.translate(lerp(r.w * 0.05, 0, a), 0);
    ctx.font = font(400, ts);
    ctx.fillStyle = P.text;
    ctx.fillText(`📄 ${row[0]}`, r.x, ry + rowH * 0.5);
    ctx.font = font(500, ts);
    ctx.fillStyle = row[4] === 'Income' ? mixHex(P.green, P.text, 0.2) : P.text;
    ctx.fillText(row[1], r.x + r.w * cols[1], ry + rowH * 0.5);
    const th = ts * 1.5;
    tag(ctx, r.x + r.w * cols[2], ry + (rowH - th) / 2, row[2], row[3], th);
    tag(ctx, r.x + r.w * cols[3], ry + (rowH - th) / 2, row[4], row[4] === 'Income' ? P.green : P.red, th);
    ctx.strokeStyle = rgba(P.brown, 0.09);
    ctx.beginPath();
    ctx.moveTo(r.x, ry + rowH);
    ctx.lineTo(r.x + r.w, ry + rowH);
    ctx.stroke();
    ctx.restore();
  });
}

/** Weekly Schedule — class blocks dropping into a grid. */
function weekSchedule(ctx, W, H, p, o) {
  backdrop(ctx, W, H, o);
  const r = pageFrame(ctx, W, H, { title: 'Weekly Schedule — College OS' });
  let y = pageTitle(ctx, r, 'Weekly Schedule', '🗓️', clamp(p * 8));

  const days = ['MON', 'TUE', 'WED', 'THU', 'FRI'];
  const gap = r.w * 0.012;
  const colW = (r.w - gap * 4) / 5;
  const gridH = r.y + r.h - y;
  const headH = gridH * 0.09;

  days.forEach((d, i) => {
    ctx.font = font(500, headH * 0.5);
    ctx.fillStyle = rgba(P.textLight, 0.9);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(d, r.x + i * (colW + gap) + colW / 2, y + headH * 0.45);
  });
  ctx.textAlign = 'left';

  const blocks = [
    [0, 0.00, 0.20, 'Biology', P.green],
    [0, 0.26, 0.16, 'Lab', P.blue],
    [1, 0.10, 0.24, 'Statistics', P.amber],
    [2, 0.00, 0.16, 'History', P.red],
    [2, 0.42, 0.22, 'Study Block', P.violet],
    [3, 0.18, 0.20, 'Biology', P.green],
    [4, 0.05, 0.18, 'Seminar', P.blue],
    [4, 0.55, 0.16, 'Gym', P.amber],
  ];
  const bodyY = y + headH;
  const bodyH = gridH - headH;

  // Column tracks
  days.forEach((_, i) => {
    fillRound(ctx, r.x + i * (colW + gap), bodyY, colW, bodyH, colW * 0.06, rgba(P.beige, 0.55));
  });

  blocks.forEach((b, i) => {
    const a = ease.outBack(stagger(p, i, blocks.length, 0.6, 0.06));
    if (a <= 0) return;
    const bx = r.x + b[0] * (colW + gap);
    const by = bodyY + b[1] * bodyH;
    const bh = b[2] * bodyH;
    ctx.save();
    ctx.globalAlpha = clamp(a * 1.6);
    ctx.translate(bx + colW / 2, by + bh / 2);
    ctx.scale(lerp(0.8, 1, a), lerp(0.8, 1, a));
    ctx.translate(-colW / 2, -bh / 2);
    fillRound(ctx, 0, 0, colW, bh, colW * 0.08, rgba(b[4], 0.2));
    ctx.fillStyle = b[4];
    fillRound(ctx, 0, 0, colW * 0.045, bh, colW * 0.02, b[4]);
    ctx.font = font(500, Math.min(bh * 0.3, colW * 0.17));
    ctx.fillStyle = mixHex(b[4], P.text, 0.35);
    ctx.textBaseline = 'top';
    ctx.fillText(b[3], colW * 0.12, bh * 0.16);
    ctx.restore();
  });
}

/** Wellbeing check-in — mood selector and habit dots filling in. */
function wellbeing(ctx, W, H, p, o) {
  backdrop(ctx, W, H, o);
  const r = pageFrame(ctx, W, H, { title: 'Wellbeing — College OS' });
  let y = pageTitle(ctx, r, 'Wellbeing Check-in', '🌱', clamp(p * 8));

  const moods = ['😞', '😕', '😐', '🙂', '😄'];
  const size = Math.min(r.w * 0.13, (r.y + r.h - y) * 0.22);
  const totalW = moods.length * size * 1.25 - size * 0.25;
  const sx = r.x + (r.w - totalW) / 2;
  const chosen = 3;
  moods.forEach((m, i) => {
    const a = ease.outBack(stagger(p, i, moods.length, 0.32, 0.05));
    if (a <= 0) return;
    const isChosen = i === chosen;
    const sel = isChosen ? ease.outBack(win(p, 0.45, 0.62)) : 0;
    ctx.save();
    ctx.globalAlpha = clamp(a * 1.5);
    const cx = sx + i * size * 1.25;
    ctx.translate(cx + size / 2, y + size / 2);
    ctx.scale(lerp(0.7, 1, a) * (1 + sel * 0.18), lerp(0.7, 1, a) * (1 + sel * 0.18));
    ctx.translate(-size / 2, -size / 2);
    fillRound(ctx, 0, 0, size, size, size * 0.28, sel > 0.1 ? rgba(P.green, 0.18 * sel + 0.06) : rgba(P.beige, 0.85));
    if (sel > 0.1) strokeRound(ctx, 0, 0, size, size, size * 0.28, rgba(P.green, sel), Math.max(1, size * 0.03));
    ctx.font = font(400, size * 0.52);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(m, size / 2, size * 0.55);
    ctx.restore();
  });
  ctx.textAlign = 'left';
  y += size * 1.5;

  ctx.font = font(500, r.w * 0.032);
  ctx.fillStyle = rgba(P.textLight, 0.9);
  ctx.textBaseline = 'top';
  ctx.fillText('DAILY HABITS', r.x, y);
  y += r.w * 0.06;

  const habits = ['Sleep 7h', 'Water', 'Movement', 'No doomscroll'];
  const rowH = Math.min((r.y + r.h - y) / habits.length, r.h * 0.12);
  const dots = 7;
  habits.forEach((h, i) => {
    const a = ease.outCubic(stagger(p, i, habits.length, 0.45, 0.35));
    if (a <= 0) return;
    ctx.save();
    ctx.globalAlpha = a;
    ctx.font = font(400, rowH * 0.34);
    ctx.fillStyle = P.text;
    ctx.textBaseline = 'middle';
    ctx.fillText(h, r.x, y + i * rowH + rowH * 0.5);
    const dR = rowH * 0.17;
    const startX = r.x + r.w * 0.52;
    const stepX = (r.w * 0.48 - dR * 2) / (dots - 1);
    for (let d = 0; d < dots; d++) {
      const fill = clamp((a - d * 0.08) * 3) * (d < 5 ? 1 : 0);
      ctx.beginPath();
      ctx.arc(startX + d * stepX + dR, y + i * rowH + rowH * 0.5, dR, 0, Math.PI * 2);
      ctx.fillStyle = fill > 0.1 ? mixHex(P.beige, P.green, fill) : rgba(P.warmTan, 0.3);
      ctx.fill();
    }
    ctx.restore();
  });
}

/** Dashboard hub — the "everything in one place" money shot. */
function dashboardHub(ctx, W, H, p, o) {
  backdrop(ctx, W, H, o);
  const r = pageFrame(ctx, W, H, { title: 'College OS — Home' });
  let y = pageTitle(ctx, r, 'College OS', '🎓', clamp(p * 8));

  ctx.font = font(400, r.w * 0.032);
  ctx.fillStyle = rgba(P.textLight, 0.95);
  ctx.textBaseline = 'top';
  ctx.globalAlpha = ease.outCubic(win(p, 0.05, 0.25));
  ctx.fillText('Everything for this semester, in one workspace.', r.x, y);
  ctx.globalAlpha = 1;
  y += r.w * 0.075;

  const tiles = [
    ['📚', 'Assignments', '8 due', P.red],
    ['⏳', 'Exams', '14 days', P.amber],
    ['💰', 'Finances', '$539 left', P.green],
    ['🗓️', 'Schedule', '5 classes', P.blue],
    ['📝', 'Notes', '6 subjects', P.violet],
    ['🌱', 'Wellbeing', 'Day 12', P.brown],
  ];
  const gapX = r.w * 0.03;
  const availH = r.y + r.h - y;
  // Three across on a wide window, two on a tall one — otherwise the tiles end
  // up as long thin slabs with the label stranded in a sea of white.
  const cols = r.w / availH > 1.5 ? 3 : 2;
  const rows = Math.ceil(tiles.length / cols);
  const tw = (r.w - gapX * (cols - 1)) / cols;
  const th = Math.min(availH / rows - gapX * 0.7, tw * 0.62);

  tiles.forEach((t, i) => {
    const a = ease.outBack(stagger(p, i, tiles.length, 0.6, 0.12));
    if (a <= 0) return;
    const col = i % cols, row = Math.floor(i / cols);
    const x = r.x + col * (tw + gapX);
    const ty = y + row * (th + gapX * 0.7);
    ctx.save();
    ctx.globalAlpha = clamp(a * 1.5);
    ctx.translate(x + tw / 2, ty + th / 2);
    const s = lerp(0.88, 1, a);
    ctx.scale(s, s);
    ctx.translate(-tw / 2, -th / 2);
    withShadow(ctx, rgba(P.darkBrown, 0.12), th * 0.22, th * 0.06, () => {
      fillRound(ctx, 0, 0, tw, th, th * 0.16, P.white);
    });
    strokeRound(ctx, 0, 0, tw, th, th * 0.16, rgba(P.brown, 0.14), 1);
    ctx.font = font(400, th * 0.28);
    ctx.textBaseline = 'top';
    ctx.fillText(t[0], th * 0.16, th * 0.14);
    ctx.font = font(500, th * 0.19);
    ctx.fillStyle = P.darkBrown;
    ctx.fillText(t[1], th * 0.16, th * 0.5);
    ctx.font = font(400, th * 0.155);
    ctx.fillStyle = mixHex(t[3], P.text, 0.25);
    ctx.fillText(t[2], th * 0.16, th * 0.72);
    ctx.restore();
  });
}

/* ------------------------------------------------------------------ */
/* Desk / hardware                                                     */
/* ------------------------------------------------------------------ */

/**
 * A MacBook, drawn to the real machine's proportions.
 *
 * The lid is 1.55:1 including bezels (16:10 display inside), and the deck is
 * foreshortened into a trapezoid because we're looking slightly down at it —
 * that shallow angle is most of what separates "a laptop" from "a rectangle".
 *
 * @param {number} lw  lid width; everything else derives from it
 * @returns {{screen:{x,y,w,h}, bottom:number}}
 */
/** Warm desk surface with softly blurred props, used behind the machine. */
function deskScene(ctx, W, H, p, o = {}) {
  const horizon = H * (o.horizon ?? 0.42);

  // Wall
  const wall = ctx.createLinearGradient(0, 0, 0, horizon);
  wall.addColorStop(0, mixHex(P.beige, P.white, 0.35));
  wall.addColorStop(1, P.beige);
  ctx.fillStyle = wall;
  ctx.fillRect(0, 0, W, horizon);

  // Desk
  const desk = ctx.createLinearGradient(0, horizon, 0, H);
  desk.addColorStop(0, mixHex(P.warmTan, P.brown, 0.35));
  desk.addColorStop(0.25, P.warmTan);
  desk.addColorStop(1, mixHex(P.warmTan, P.beige, 0.55));
  ctx.fillStyle = desk;
  ctx.fillRect(0, horizon, W, H - horizon);

  // Contact shadow along the wall/desk join
  const join = ctx.createLinearGradient(0, horizon, 0, horizon + H * 0.05);
  join.addColorStop(0, rgba(P.darkBrown, 0.28));
  join.addColorStop(1, rgba(P.darkBrown, 0));
  ctx.fillStyle = join;
  ctx.fillRect(0, horizon, W, H * 0.05);

  // Window light falling across the desk from the upper left
  const light = ctx.createLinearGradient(0, 0, W * 0.9, H);
  light.addColorStop(0, rgba('#FFE9C0', 0.42));
  light.addColorStop(0.45, rgba('#FFE9C0', 0.06));
  light.addColorStop(1, rgba('#FFE9C0', 0));
  ctx.fillStyle = light;
  ctx.fillRect(0, 0, W, H);

  // Props sit behind the machine and stay defocused, which is what sells the
  // depth — a sharp coffee cup reads as a sticker.
  const S = Math.min(W, H);
  const vertical = H / W > 1.1;
  ctx.save();
  if (ctx.filter !== undefined) ctx.filter = `blur(${S * 0.008}px)`;
  ctx.globalAlpha = 0.9;

  // Mug, left. On a vertical crop the props move down into the near foreground
  // and grow, so the lower third isn't bare desk.
  const mx = W * (vertical ? 0.135 : 0.13);
  const my = horizon + H * (vertical ? 0.30 : 0.055);
  const mr = S * (vertical ? 0.062 : 0.055);
  fillRound(ctx, mx - mr * 0.75, my - mr, mr * 1.5, mr * 1.5, mr * 0.16, P.white);
  ctx.beginPath();
  ctx.ellipse(mx + mr * 0.95, my - mr * 0.35, mr * 0.34, mr * 0.34, 0, -Math.PI / 2, Math.PI / 2);
  ctx.strokeStyle = P.white;
  ctx.lineWidth = mr * 0.17;
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(mx, my - mr, mr * 0.75, mr * 0.2, 0, 0, Math.PI * 2);
  ctx.fillStyle = mixHex(P.brown, P.darkBrown, 0.5);
  ctx.fill();

  // Notebook + pen, right
  const nx = W * (vertical ? 0.865 : 0.84);
  const ny = horizon + H * (vertical ? 0.34 : 0.10);
  ctx.save();
  ctx.translate(nx, ny);
  ctx.rotate(-0.12);
  const nS = vertical ? 1.05 : 1;
  fillRound(ctx, -S * 0.10 * nS, -S * 0.06 * nS, S * 0.20 * nS, S * 0.13 * nS, S * 0.008, mixHex(P.cream, P.white, 0.4));
  fillRound(ctx, -S * 0.10 * nS, -S * 0.06 * nS, S * 0.016 * nS, S * 0.13 * nS, S * 0.008, P.red);
  ctx.restore();
  ctx.save();
  ctx.translate(nx - S * 0.02, ny + S * 0.085);
  ctx.rotate(0.22);
  fillRound(ctx, -S * 0.07, 0, S * 0.14, S * 0.011, S * 0.006, P.darkBrown);
  ctx.restore();

  // Framed print on the wall. Without it the upper third of a vertical crop is
  // an empty beige field, which reads as an unfinished render rather than a room.
  const fw = S * (vertical ? 0.30 : 0.20);
  const fh = fw * 1.28;
  const fx = W * (vertical ? 0.64 : 0.74);
  const fy = horizon - fh - S * (vertical ? 0.09 : 0.05);
  if (fy > S * 0.03) {
    ctx.save();
    ctx.translate(fx, fy);
    fillRound(ctx, -fw * 0.5 + S * 0.006, S * 0.008, fw, fh, S * 0.004, rgba(P.darkBrown, 0.13));
    fillRound(ctx, -fw * 0.5, 0, fw, fh, S * 0.004, mixHex(P.cream, P.white, 0.55));
    fillRound(ctx, -fw * 0.5 + fw * 0.10, fh * 0.09, fw * 0.80, fh * 0.82, S * 0.002, mixHex(P.beige, P.warmTan, 0.30));
    fillRound(ctx, -fw * 0.5 + fw * 0.20, fh * 0.34, fw * 0.60, fh * 0.34, S * 0.002, mixHex(P.warmTan, P.brown, 0.28));
    ctx.restore();
  }

  // Plant, far left on the wall line
  const px = W * 0.05, py = horizon - S * 0.01;
  fillRound(ctx, px - S * 0.035, py - S * 0.05, S * 0.07, S * 0.06, S * 0.01, mixHex(P.brown, P.warmTan, 0.4));
  for (let i = 0; i < 6; i++) {
    const a = -Math.PI / 2 + (i - 2.5) * 0.32;
    ctx.save();
    ctx.translate(px, py - S * 0.05);
    ctx.rotate(a);
    ctx.beginPath();
    ctx.ellipse(0, -S * 0.045, S * 0.014, S * 0.045, 0, 0, Math.PI * 2);
    ctx.fillStyle = mixHex('#6E7F6A', P.green, 0.4 + i * 0.06);
    ctx.fill();
    ctx.restore();
  }
  ctx.restore();
}

/**
 * The template as it looks on a phone.
 *
 * Drawn rather than scaled down from the desktop screenshot: a 900px-wide page
 * shrunk into a phone is an unreadable grey smear, and cropping it leaves an
 * obviously desktop layout in a portrait frame. The card thumbnails are real
 * though — sampled straight out of the product screenshot's gallery, which is
 * what stops the whole thing looking like a wireframe.
 */
function phoneScreen(ctx, x, y, w, h, o = {}) {
  const img = o.img;
  const scroll = (o.scroll ?? 0) * h * 0.085;
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.fillStyle = P.white;
  ctx.fillRect(x, y, w, h);

  const pad = w * 0.075;
  const cw = w - pad * 2;

  // The page scrolls; the status bar does not. Letting it scroll drags the
  // title up under the dynamic island, which no phone has ever done.
  ctx.save();
  ctx.translate(0, -scroll);
  let cy = y + h * 0.115;

  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  ctx.fillStyle = P.darkBrown;
  ctx.font = `600 ${w * 0.098}px ${BRAND.display}`;
  ctx.fillText('College OS', x + pad + w * 0.105, cy + h * 0.045);
  ctx.font = `400 ${w * 0.082}px ${BRAND.body}`;
  ctx.fillText('\u{1F393}', x + pad, cy + h * 0.045);
  cy += h * 0.078;

  // Greeting field
  fillRound(ctx, x + pad, cy, cw, h * 0.048, w * 0.022, mixHex(P.red, P.white, 0.90));
  ctx.fillStyle = rgba(P.darkBrown, 0.62);
  ctx.font = `400 ${w * 0.048}px ${BRAND.body}`;
  ctx.fillText("What's your focus today?", x + pad + w * 0.045, cy + h * 0.032);
  cy += h * 0.070;

  // Quick links
  ctx.fillStyle = P.brown;
  ctx.font = `600 ${w * 0.052}px ${BRAND.display}`;
  ctx.fillText('Quick Links', x + pad, cy);
  cy += h * 0.022;
  for (const label of ['Learning Management System', 'Gmail', 'My University Portal']) {
    fillRound(ctx, x + pad, cy, cw, h * 0.042, w * 0.020, mixHex(P.cream, P.white, 0.30));
    ctx.fillStyle = rgba(P.darkBrown, 0.78);
    ctx.font = `400 ${w * 0.044}px ${BRAND.body}`;
    ctx.fillText(label, x + pad + w * 0.045, cy + h * 0.028);
    fillRound(ctx, x + pad + w * 0.020, cy + h * 0.017, w * 0.014, w * 0.014, w * 0.007,
      rgba(P.brown, 0.55));
    cy += h * 0.052;
  }
  cy += h * 0.016;

  // Gallery — two columns, real thumbnails cropped from the product screenshot
  ctx.fillStyle = P.brown;
  ctx.font = `600 ${w * 0.048}px ${BRAND.display}`;
  ctx.fillText('Gallery view', x + pad, cy);
  cy += h * 0.020;

  const labels = ['Study Notes', 'Assignment Tracker', 'Finance Tracker', 'Weekly schedule',
    'Exam Countdown', 'Wellbeing', 'Resource Library', 'AI Prompts'];
  const gap = w * 0.040;
  const tw = (cw - gap) / 2;
  const th = tw * 0.74;
  for (let i = 0; i < 8; i++) {
    const col = i % 2, row = (i / 2) | 0;
    const tx = x + pad + col * (tw + gap);
    const ty = cy + row * (th + h * 0.030);
    if (ty > y + h + scroll) break;
    fillRound(ctx, tx, ty, tw, th, w * 0.022, mixHex(P.cream, P.white, 0.5));
    ctx.save();
    roundRect(ctx, tx, ty, tw, th * 0.70, w * 0.022);
    ctx.clip();
    if (img) {
      // Measured off the 900×559 product screenshot: the gallery photos start
      // at (285, 288), 128×69 each, 139 across and 132 down.
      const c = i % 4, rr = (i / 4) | 0;
      ctx.drawImage(img,
        img.width * (0.3167 + c * 0.15444), img.height * (0.5152 + rr * 0.2361),
        img.width * 0.14222, img.height * 0.12343,
        tx, ty, tw, th * 0.70);
    } else {
      ctx.fillStyle = mixHex(P.warmTan, P.cream, 0.4 + (i % 3) * 0.15);
      ctx.fillRect(tx, ty, tw, th * 0.70);
    }
    ctx.restore();
    ctx.fillStyle = rgba(P.darkBrown, 0.82);
    ctx.font = `400 ${w * 0.038}px ${BRAND.body}`;
    ctx.fillText(labels[i], tx + w * 0.022, ty + th * 0.87);
  }

  ctx.restore();   // scroll

  // Status bar, pinned. Time to the left of the island, radios to the right.
  ctx.fillStyle = rgba(P.darkBrown, 0.88);
  ctx.font = `600 ${w * 0.042}px ${BRAND.body}`;
  ctx.textAlign = 'left';
  ctx.fillText('9:41', x + pad, y + h * 0.036);
  for (let i = 0; i < 4; i++) {
    const bh2 = w * (0.011 + i * 0.006);
    fillRound(ctx, x + w - pad - w * 0.150 + i * w * 0.018, y + h * 0.030 - bh2,
      w * 0.012, bh2, w * 0.004, rgba(P.darkBrown, 0.82));
  }
  fillRound(ctx, x + w - pad - w * 0.052, y + h * 0.030 - w * 0.024, w * 0.052, w * 0.024,
    w * 0.008, rgba(P.darkBrown, 0.30));
  fillRound(ctx, x + w - pad - w * 0.049, y + h * 0.030 - w * 0.021, w * 0.038, w * 0.018,
    w * 0.006, rgba(P.darkBrown, 0.82));

  ctx.restore();   // clip
}

/**
 * A phone. Deliberately the device this studio renders rather than a laptop:
 * a slab with a black bezel and one screen has no hinge, no foreshortened
 * deck and no keyboard, which is where a vector laptop always falls apart —
 * and it is the screen these ads are watched on anyway.
 */
function phone(ctx, cx, topY, pw, o = {}) {
  const ph = pw * 2.03;                 // ~19.5:9
  const px = cx - pw / 2;
  const rad = pw * 0.135;
  const band = pw * 0.026;              // polished steel edge
  const bez = pw * 0.030;

  withShadow(ctx, rgba('#000000', 0.38), ph * 0.10, ph * 0.035, () => {
    fillRound(ctx, px, topY, pw, ph, rad, '#2A2C31');
  });

  // Edge band, brightest where the window light hits it
  const edge = ctx.createLinearGradient(px, 0, px + pw, 0);
  edge.addColorStop(0, '#8E9299');
  edge.addColorStop(0.12, '#E8EAEC');
  edge.addColorStop(0.35, '#9DA1A8');
  edge.addColorStop(0.85, '#C3C7CC');
  edge.addColorStop(1, '#75787E');
  ctx.save();
  roundRect(ctx, px, topY, pw, ph, rad);
  ctx.clip();
  ctx.fillStyle = edge;
  ctx.fillRect(px, topY, pw, ph);
  ctx.restore();

  // Black front glass
  fillRound(ctx, px + band, topY + band, pw - band * 2, ph - band * 2, rad - band * 0.7, '#08090B');

  const sx = px + band + bez;
  const sy = topY + band + bez;
  const sw = pw - (band + bez) * 2;
  const sh = ph - (band + bez) * 2;

  ctx.save();
  roundRect(ctx, sx, sy, sw, sh, rad - band - bez * 0.5);
  ctx.clip();
  phoneScreen(ctx, sx, sy, sw, sh, o);

  // Dynamic island
  const iw = sw * 0.30, ih = sw * 0.085;
  fillRound(ctx, sx + sw / 2 - iw / 2, sy + sh * 0.014, iw, ih, ih / 2, '#08090B');

  // Glass: one soft diagonal sweep, not a hard streak
  const gl = ctx.createLinearGradient(sx, sy, sx + sw * 1.1, sy + sh * 0.75);
  gl.addColorStop(0, 'rgba(255,255,255,0.17)');
  gl.addColorStop(0.32, 'rgba(255,255,255,0.03)');
  gl.addColorStop(0.5, 'rgba(255,255,255,0)');
  ctx.fillStyle = gl;
  ctx.fillRect(sx, sy, sw, sh);
  ctx.restore();

  return { screen: { x: sx, y: sy, w: sw, h: sh }, bottom: topY + ph };
}

/** The phone standing on the warm desk — the "in use" hero shot. */
function phoneDesk(ctx, W, H, p, o) {
  const vertical = H / W > 1.1;
  deskScene(ctx, W, H, p, { horizon: vertical ? 0.30 : 0.36, ...o });
  const pw = W * (vertical ? 0.46 : 0.21);
  const topY = H * (vertical ? 0.175 : 0.105);
  const img = o.assets?.[o.shot || 'homepage'];

  const a = ease.outQuart(clamp(p * 2.4));
  ctx.save();
  ctx.globalAlpha = a;
  ctx.translate(0, lerp(H * 0.022, 0, a));
  const m = phone(ctx, W * 0.5, topY, pw, {
    img,
    scroll: ease.inOutCubic(clamp(p)) * (o.scroll ?? 0.55),
  });

  // Contact shadow where it meets the desk, and the screen's spill in front
  const sh = ctx.createRadialGradient(W * 0.5, m.bottom, pw * 0.02, W * 0.5, m.bottom, pw * 0.78);
  sh.addColorStop(0, rgba(P.darkBrown, 0.42));
  sh.addColorStop(1, rgba(P.darkBrown, 0));
  ctx.fillStyle = sh;
  ctx.beginPath();
  ctx.ellipse(W * 0.5, m.bottom + pw * 0.015, pw * 0.78, pw * 0.13, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

/** Studio product shot: the phone alone on brand colour, slowly turning. */
function phoneHero(ctx, W, H, p, o) {
  backdrop(ctx, W, H, o);
  const vertical = H / W > 1.1;
  const pw = W * (vertical ? 0.50 : 0.24);
  const img = o.assets?.[o.shot || 'homepage'];
  const S = Math.min(W, H);

  // Pool of light behind the device
  const pool = ctx.createRadialGradient(W * 0.5, H * 0.46, S * 0.05, W * 0.5, H * 0.46, S * 0.62);
  pool.addColorStop(0, rgba('#FFFFFF', 0.20));
  pool.addColorStop(1, rgba('#FFFFFF', 0));
  ctx.fillStyle = pool;
  ctx.fillRect(0, 0, W, H);

  const a = ease.outQuart(clamp(p * 2.2));
  const ph = pw * 2.03;
  ctx.save();
  ctx.globalAlpha = a;
  ctx.translate(W * 0.5, H * 0.5);
  // A few degrees of sway, so a static product shot still breathes.
  ctx.rotate(Math.sin(p * Math.PI * 2 - 0.6) * 0.022);
  ctx.scale(lerp(0.97, 1, a), lerp(0.97, 1, a));
  phone(ctx, 0, -ph / 2, pw, {
    img,
    scroll: ease.inOutCubic(clamp(p)) * (o.scroll ?? 1),
  });
  ctx.restore();
}


/* ------------------------------------------------------------------ */
/* Problem / emotion scenes                                            */
/* ------------------------------------------------------------------ */

/** The pain shot: ten apps flying apart, unreadable and overwhelming. */
function chaosApps(ctx, W, H, p, o) {
  backdrop(ctx, W, H, { tone: 'cream' });
  const r = rng(o.seed || 7);
  const apps = [
    ['📝', 'Notes'], ['📅', 'Calendar'], ['⏰', 'Reminders'], ['💬', 'Group chat'],
    ['📧', 'Email'], ['📊', 'Sheets'], ['🗒️', 'Sticky notes'], ['🎧', 'Study playlist'],
    ['💸', 'Banking'], ['📸', 'Camera roll'], ['📌', 'Pinned tabs'], ['🔔', 'Alerts'],
  ];
  const spread = ease.outCubic(p);
  const size = Math.min(W, H) * 0.19;

  apps.forEach((a, i) => {
    const ang = (i / apps.length) * Math.PI * 2 + r() * 0.7;
    // Drift outward but stay inside the frame — icons that leave the edge just
    // empty the shot out rather than reading as overload.
    const dist = (0.15 + r() * 0.30) * Math.min(W, H) * (0.55 + spread * 0.6);
    const x = W / 2 + Math.cos(ang) * dist * 1.05;
    const y = H / 2 + Math.sin(ang) * dist * (H > W ? 1.5 : 0.9);
    const rot = (r() - 0.5) * 0.8 * (0.4 + spread);
    const sc = 0.75 + r() * 0.55;
    ctx.save();
    ctx.globalAlpha = clamp(0.45 + spread * 0.55);
    ctx.translate(x, y);
    ctx.rotate(rot);
    ctx.scale(sc, sc);
    withShadow(ctx, rgba(P.darkBrown, 0.18), size * 0.35, size * 0.08, () => {
      fillRound(ctx, -size / 2, -size / 2, size, size * 0.78, size * 0.2, P.white);
    });
    ctx.font = font(400, size * 0.3);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(a[0], 0, -size * 0.07);
    ctx.font = font(400, size * 0.13);
    ctx.fillStyle = rgba(P.textLight, 0.9);
    ctx.fillText(a[1], 0, size * 0.19);
    ctx.restore();
  });
  ctx.textAlign = 'left';

  // Everything drains toward a stressed centre.
  const g = ctx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, Math.min(W, H) * 0.42);
  g.addColorStop(0, rgba(P.cream, 0.55));
  g.addColorStop(1, rgba(P.cream, 0));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
}

/** Panic notifications stacking up faster than you can read them. */
function notifPanic(ctx, W, H, p, o) {
  backdrop(ctx, W, H, { tone: 'cream' });
  const notes = o.notes || [
    ['⚠️', 'Essay due', 'in 2 hours'],
    ['📉', 'Quiz grade posted', 'you missed it'],
    ['💳', 'Low balance', '$12.40 left'],
    ['📚', 'Reading overdue', '3 chapters behind'],
    ['🔔', 'Lab report', 'due tomorrow 9am'],
    ['📅', 'You missed', 'Statistics tutorial'],
  ];
  const w = Math.min(W * 0.8, H * 0.62);
  const h = w * 0.19;
  const cx = W / 2 - w / 2;
  const startY = H / 2 - (notes.length * h * 0.72) / 2;

  notes.forEach((n, i) => {
    const a = ease.outQuart(stagger(p, i, notes.length, 0.7, 0.02));
    if (a <= 0) return;
    const y = startY + i * h * 0.72;
    ctx.save();
    ctx.globalAlpha = clamp(a * 1.4);
    ctx.translate(cx + w / 2, y + h / 2);
    ctx.rotate(lerp(0.06 * (i % 2 ? 1 : -1), 0, a));
    ctx.scale(lerp(1.08, 1, a), lerp(1.08, 1, a));
    ctx.translate(-w / 2, -h / 2);
    withShadow(ctx, rgba(P.darkBrown, 0.22), h * 0.4, h * 0.12, () => {
      fillRound(ctx, 0, 0, w, h, h * 0.26, P.white);
    });
    ctx.font = font(400, h * 0.38);
    ctx.textBaseline = 'middle';
    ctx.fillText(n[0], h * 0.28, h * 0.5);
    ctx.font = font(500, h * 0.29);
    ctx.fillStyle = P.text;
    ctx.fillText(n[1], h * 0.85, h * 0.36);
    ctx.font = font(400, h * 0.25);
    ctx.fillStyle = P.red;
    ctx.fillText(n[2], h * 0.85, h * 0.68);
    ctx.restore();
  });
}

/** Scratch canvas so half-frame composites can be painted at full size first. */
let scratch = null;
function scratchCtx(w, h) {
  if (!scratch) scratch = document.createElement('canvas');
  if (scratch.width !== w || scratch.height !== h) { scratch.width = w; scratch.height = h; }
  const c = scratch.getContext('2d');
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.clearRect(0, 0, w, h);
  return c;
}

/**
 * Before / after split — chaos on one side, College OS on the other.
 * Each half is painted as a complete composition at half-frame dimensions and
 * then placed, so neither side shows a scene sliced through the middle.
 */
function beforeAfter(ctx, W, H, p, o) {
  const vertical = H / W > 1.1;
  const hw = vertical ? W : W / 2;
  const hh = vertical ? H / 2 : H;

  // Top / left: chaos
  const sc = scratchCtx(Math.round(hw), Math.round(hh));
  chaosApps(sc, hw, hh, clamp(p * 1.2), o);
  sc.fillStyle = rgba(P.textLight, 0.14);
  sc.fillRect(0, 0, hw, hh);
  ctx.drawImage(scratch, 0, 0);

  // Bottom / right: the calm side, wiping in
  const wipe = ease.inOutQuart(win(p, 0.12, 0.68));
  const sc2 = scratchCtx(Math.round(hw), Math.round(hh));
  dashboardHub(sc2, hw, hh, clamp((p - 0.1) * 1.5), o);
  ctx.save();
  ctx.beginPath();
  if (vertical) ctx.rect(0, H / 2, W, hh * wipe);
  else ctx.rect(W / 2, 0, hw * wipe, H);
  ctx.clip();
  ctx.drawImage(scratch, vertical ? 0 : W / 2, vertical ? H / 2 : 0);
  ctx.restore();

  // Divider
  ctx.strokeStyle = rgba(P.darkBrown, 0.35);
  ctx.lineWidth = Math.max(2, W * 0.004);
  ctx.beginPath();
  if (vertical) { ctx.moveTo(0, H / 2); ctx.lineTo(W, H / 2); }
  else { ctx.moveTo(W / 2, 0); ctx.lineTo(W / 2, H); }
  ctx.stroke();

  // Labels
  const ls = Math.min(W, H) * 0.045;
  ctx.font = font(500, ls);
  ctx.letterSpacing = `${ls * 0.14}px`;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  const lab = (text, x, y, color) => {
    const w = ctx.measureText(text).width + ls * 1.4;
    fillRound(ctx, x - w / 2, y - ls * 0.85, w, ls * 1.7, ls * 0.85, rgba(color, 0.92));
    ctx.fillStyle = P.cream;
    ctx.fillText(text, x, y);
  };
  ctx.globalAlpha = ease.outCubic(win(p, 0.1, 0.35));
  if (vertical) {
    lab('BEFORE', W / 2, H * 0.09, P.red);
    lab('AFTER', W / 2, H * 0.91, P.green);
  } else {
    lab('BEFORE', W * 0.25, H * 0.1, P.red);
    lab('AFTER', W * 0.75, H * 0.1, P.green);
  }
  ctx.globalAlpha = 1;
  ctx.letterSpacing = '0px';
  ctx.textAlign = 'left';
}

/* ------------------------------------------------------------------ */
/* Offer scenes                                                        */
/* ------------------------------------------------------------------ */

/** Price card — $19, one-time, with the deliverables checklist. */
function priceCard(ctx, W, H, p, o) {
  backdrop(ctx, W, H, o);
  const vertical = H / W > 1.1;
  const w = Math.min(W * 0.82, H * 0.62);
  const h = Math.min(H * 0.7, w * (vertical ? 1.25 : 0.95));
  const x = (W - w) / 2, y = (H - h) / 2;

  const rise = ease.outQuart(clamp(p * 3));
  ctx.save();
  ctx.globalAlpha = rise;
  ctx.translate(0, lerp(h * 0.08, 0, rise));
  withShadow(ctx, rgba(P.darkBrown, 0.3), h * 0.12, h * 0.04, () => {
    fillRound(ctx, x, y, w, h, w * 0.06, P.white);
  });
  strokeRound(ctx, x, y, w, h, w * 0.06, rgba(P.brown, 0.2), 1.5);

  const pad = w * 0.09;
  let cy = y + pad;

  ctx.textAlign = 'center';
  ctx.font = font(500, w * 0.032);
  ctx.fillStyle = P.brown;
  ctx.letterSpacing = `${w * 0.005}px`;
  ctx.textBaseline = 'top';
  ctx.fillText('COLLEGE OS — COMPLETE SYSTEM', x + w / 2, cy);
  ctx.letterSpacing = '0px';
  cy += w * 0.09;

  // Price with a counting reveal. Baseline must be explicit here — the kicker
  // above draws with 'top', and a top-aligned numeral this large would run
  // straight through the line beneath it.
  const priceP = ease.outQuint(win(p, 0.12, 0.5));
  const val = Math.round(lerp(0, 19, priceP));
  ctx.font = font(300, w * 0.26, 'display');
  ctx.fillStyle = P.darkBrown;
  ctx.textBaseline = 'alphabetic';
  const pop = 1 + Math.sin(clamp(win(p, 0.45, 0.62)) * Math.PI) * 0.06;
  ctx.save();
  ctx.translate(x + w / 2, cy + w * 0.21);
  ctx.scale(pop, pop);
  ctx.fillText(`$${val}`, 0, 0);
  ctx.restore();
  cy += w * 0.29;

  ctx.font = font(400, w * 0.042);
  ctx.fillStyle = P.textLight;
  ctx.textBaseline = 'top';
  ctx.fillText('Instant delivery · Works on the free Notion plan', x + w / 2, cy);
  cy += w * 0.10;
  ctx.textAlign = 'left';

  const items = (o.items || BRAND.deliverables).slice(0, vertical ? 7 : 5);
  const rowH = Math.min((y + h - pad * 1.2 - cy) / items.length, w * 0.085);
  items.forEach((it, i) => {
    const a = ease.outCubic(stagger(p, i, items.length, 0.5, 0.3));
    if (a <= 0) return;
    ctx.save();
    ctx.globalAlpha = a;
    const ry = cy + i * rowH;
    const bs = rowH * 0.42;
    checkbox(ctx, x + pad, ry + (rowH - bs) / 2, bs, true, clamp((a - 0.2) / 0.6));
    ctx.font = font(400, rowH * 0.4);
    ctx.fillStyle = P.text;
    ctx.textBaseline = 'middle';
    ctx.fillText(it, x + pad + bs * 1.7, ry + rowH * 0.52);
    ctx.restore();
  });
  ctx.restore();
}

/** End card — wordmark, CTA button, domain. */
function endCard(ctx, W, H, p, o) {
  backdrop(ctx, W, H, o);
  const cx = W / 2;
  const S = Math.min(W, H);

  const a1 = ease.outQuart(clamp(p * 3.2));
  ctx.save();
  ctx.textAlign = 'center';
  ctx.globalAlpha = a1;
  ctx.translate(0, lerp(S * 0.04, 0, a1));

  ctx.font = font(400, S * 0.14);
  ctx.textBaseline = 'alphabetic';
  ctx.fillText('🎓', cx, H * 0.36);

  ctx.font = font(400, S * 0.13, 'display');
  ctx.fillStyle = P.darkBrown;
  ctx.fillText('College OS', cx, H * 0.48);

  ctx.font = font(300, S * 0.042);
  ctx.fillStyle = P.textLight;
  ctx.fillText(o.tagline || 'Your entire college life. One workspace.', cx, H * 0.545);
  ctx.restore();

  // CTA button
  const a2 = ease.outBack(win(p, 0.25, 0.6));
  if (a2 > 0) {
    const bw = S * 0.62, bh = S * 0.115;
    const bx = cx - bw / 2, by = H * 0.62;
    const pulse = 1 + Math.sin(p * Math.PI * 4) * 0.012 * clamp((p - 0.55) * 4);
    ctx.save();
    ctx.globalAlpha = clamp(a2 * 1.4);
    ctx.translate(cx, by + bh / 2);
    ctx.scale(lerp(0.85, 1, a2) * pulse, lerp(0.85, 1, a2) * pulse);
    ctx.translate(-cx, -(by + bh / 2));
    withShadow(ctx, rgba(P.darkBrown, 0.35), bh * 0.6, bh * 0.18, () => {
      fillRound(ctx, bx, by, bw, bh, bh / 2, P.darkBrown);
    });
    ctx.font = font(500, bh * 0.36);
    ctx.fillStyle = P.cream;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(o.cta || `Get College OS — ${BRAND.price}`, cx, by + bh * 0.53);
    ctx.restore();
  }

  const a3 = ease.outCubic(win(p, 0.45, 0.75));
  ctx.save();
  ctx.globalAlpha = a3;
  ctx.textAlign = 'center';
  ctx.font = font(500, S * 0.038);
  ctx.fillStyle = P.brown;
  ctx.letterSpacing = `${S * 0.006}px`;
  ctx.textBaseline = 'middle';
  ctx.fillText(BRAND.domain, cx, H * 0.775);
  ctx.letterSpacing = '0px';

  const marks = o.guarantees || BRAND.guarantees;
  ctx.font = font(400, S * 0.03);
  ctx.fillStyle = rgba(P.textLight, 0.95);
  const line = marks.join('   •   ');
  ctx.fillText(line, cx, H * 0.83);
  ctx.restore();
  ctx.textAlign = 'left';
}

/** Testimonial card with stars. */
function testimonial(ctx, W, H, p, o) {
  backdrop(ctx, W, H, o);
  const t = o.proof || BRAND.proof[0];
  const S = Math.min(W, H);
  const w = Math.min(W * 0.84, H * 0.7);
  const h = w * 0.72;
  const x = (W - w) / 2, y = (H - h) / 2;

  const a = ease.outQuart(clamp(p * 3));
  ctx.save();
  ctx.globalAlpha = a;
  ctx.translate(0, lerp(h * 0.06, 0, a));
  withShadow(ctx, rgba(P.darkBrown, 0.22), h * 0.14, h * 0.05, () => {
    fillRound(ctx, x, y, w, h, w * 0.06, P.white);
  });
  strokeRound(ctx, x, y, w, h, w * 0.06, rgba(P.brown, 0.16), 1.5);

  const pad = w * 0.1;
  ctx.font = font(400, w * 0.075);
  ctx.fillStyle = P.brown;
  ctx.textBaseline = 'top';
  const stars = '★★★★★';
  const shown = Math.min(5, Math.floor(win(p, 0.05, 0.4) * 5.99));
  ctx.fillText(stars.slice(0, shown), x + pad, y + pad);

  ctx.font = font(400, w * 0.062, 'display');
  ctx.fillStyle = P.text;
  const lines = wrapText(ctx, `“${t.quote}”`, w - pad * 2);
  lines.forEach((ln, i) => {
    const la = ease.outCubic(stagger(p, i, lines.length, 0.45, 0.18));
    ctx.save();
    ctx.globalAlpha = la;
    ctx.translate(0, lerp(w * 0.02, 0, la));
    ctx.fillText(ln, x + pad, y + pad + w * 0.13 + i * w * 0.082);
    ctx.restore();
  });

  const by = y + h - pad * 0.9;
  ctx.font = font(500, w * 0.042);
  ctx.fillStyle = P.darkBrown;
  ctx.textBaseline = 'bottom';
  ctx.globalAlpha = a * ease.outCubic(win(p, 0.45, 0.7));
  ctx.fillText(t.who, x + pad, by - w * 0.05);
  ctx.font = font(400, w * 0.034);
  ctx.fillStyle = P.textLight;
  ctx.fillText(t.role, x + pad, by);
  ctx.restore();
}

/** Big statement stat, e.g. "10 apps → 1". */
function statBurst(ctx, W, H, p, o) {
  backdrop(ctx, W, H, o);
  const S = Math.min(W, H);
  const cx = W / 2;
  const from = o.statFrom || '10';
  const to = o.statTo || '1';

  const a = ease.outQuint(clamp(p * 2.4));
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  ctx.globalAlpha = a * (1 - ease.inQuad(win(p, 0.55, 0.85)) * 0.75);
  ctx.font = font(300, S * 0.42, 'display');
  ctx.fillStyle = rgba(P.textLight, 0.55);
  ctx.save();
  const shift = lerp(0, -S * 0.22, ease.inOutQuart(win(p, 0.42, 0.8)));
  ctx.translate(cx + shift, H * 0.46);
  ctx.scale(lerp(0.85, 1, a), lerp(0.85, 1, a));
  ctx.fillText(from, 0, 0);
  ctx.restore();

  const b = ease.outBack(win(p, 0.45, 0.85));
  if (b > 0) {
    ctx.globalAlpha = clamp(b * 1.3);
    ctx.font = font(300, S * 0.55, 'display');
    ctx.fillStyle = P.darkBrown;
    ctx.save();
    ctx.translate(cx + S * 0.16, H * 0.46);
    ctx.scale(lerp(0.4, 1, b), lerp(0.4, 1, b));
    ctx.fillText(to, 0, 0);
    ctx.restore();

    ctx.globalAlpha = clamp(b * 1.2);
    ctx.font = font(400, S * 0.1);
    ctx.fillStyle = P.brown;
    ctx.fillText('→', cx - S * 0.02, H * 0.46);
  }

  ctx.globalAlpha = ease.outCubic(win(p, 0.6, 0.9));
  ctx.font = font(400, S * 0.048);
  ctx.fillStyle = P.textLight;
  ctx.fillText(o.statLabel || 'apps replaced by one system', cx, H * 0.66);
  ctx.restore();
  ctx.textAlign = 'left';
}

/* ------------------------------------------------------------------ */
/* Real screenshot layers                                              */
/* ------------------------------------------------------------------ */

/** Draw a bitmap "cover" style inside a rect. */
function coverImage(ctx, img, x, y, w, h, anchorTop = true) {
  const ir = img.width / img.height;
  const rr = w / h;
  let sw, sh, sx, sy;
  if (ir > rr) { sh = img.height; sw = sh * rr; sx = (img.width - sw) / 2; sy = 0; }
  else { sw = img.width; sh = sw / rr; sx = 0; sy = anchorTop ? 0 : (img.height - sh) / 2; }
  ctx.drawImage(img, sx, sy, sw, sh, x, y, w, h);
}

/** Real product screenshot inside a laptop shell. */
function laptopShot(ctx, W, H, p, o) {
  backdrop(ctx, W, H, o);
  const img = o.assets?.[o.shot || 'homepage'];
  const vertical = H / W > 1.1;
  const bw = W * (vertical ? 0.94 : 0.72);
  const bh = bw * 0.63;
  const bx = (W - bw) / 2;
  const by = (H - bh) / 2;

  const a = ease.outQuart(clamp(p * 2.6));
  ctx.save();
  ctx.globalAlpha = a;
  ctx.translate(W / 2, H / 2);
  ctx.scale(lerp(0.96, 1, a), lerp(0.96, 1, a));
  ctx.translate(-W / 2, -H / 2);

  // Lid
  withShadow(ctx, rgba(P.darkBrown, 0.34), bh * 0.16, bh * 0.06, () => {
    fillRound(ctx, bx, by, bw, bh, bw * 0.022, '#3B2E1D');
  });
  const inset = bw * 0.016;
  const sx = bx + inset, sy = by + inset * 1.6;
  const sw = bw - inset * 2, sh = bh - inset * 3.4;
  ctx.save();
  roundRect(ctx, sx, sy, sw, sh, bw * 0.008);
  ctx.clip();
  ctx.fillStyle = P.white;
  ctx.fillRect(sx, sy, sw, sh);
  if (img) {
    // Slow scroll inside the screen so the page feels alive.
    const scroll = ease.inOutCubic(clamp(p)) * (o.scroll ?? 0.12);
    const ir = img.width / img.height;
    const dw = sw, dh = dw / ir;
    ctx.drawImage(img, sx, sy - scroll * Math.max(0, dh - sh) - (dh > sh ? 0 : 0), dw, dh);
  }
  // Screen sheen
  const g = ctx.createLinearGradient(sx, sy, sx + sw * 0.7, sy + sh);
  g.addColorStop(0, 'rgba(255,255,255,0.14)');
  g.addColorStop(0.45, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(sx, sy, sw, sh);
  ctx.restore();

  // Base
  const kw = bw * 1.1, kh = bh * 0.045;
  fillRound(ctx, W / 2 - kw / 2, by + bh, kw, kh, kh * 0.5, '#4A3A26');
  fillRound(ctx, W / 2 - kw * 0.09, by + bh, kw * 0.18, kh * 0.55, kh * 0.3, '#5C4A32');
  ctx.restore();
}

/** Real product screenshot inside a phone shell. */
function phoneShot(ctx, W, H, p, o) {
  backdrop(ctx, W, H, o);
  const img = o.assets?.[o.shot || 'assignments'];
  const ph = Math.min(H * 0.78, W * 1.55);
  const pw = ph * 0.485;
  const px = (W - pw) / 2, py = (H - ph) / 2;

  const a = ease.outQuart(clamp(p * 2.4));
  ctx.save();
  ctx.globalAlpha = a;
  ctx.translate(W / 2, H / 2);
  ctx.rotate(lerp(0.03, 0, a));
  ctx.scale(lerp(0.94, 1, a), lerp(0.94, 1, a));
  ctx.translate(-W / 2, -H / 2);

  withShadow(ctx, rgba(P.darkBrown, 0.36), ph * 0.09, ph * 0.03, () => {
    fillRound(ctx, px, py, pw, ph, pw * 0.12, '#33281a');
  });
  const b = pw * 0.022;
  ctx.save();
  roundRect(ctx, px + b, py + b, pw - b * 2, ph - b * 2, pw * 0.105);
  ctx.clip();
  ctx.fillStyle = P.white;
  ctx.fillRect(px, py, pw, ph);
  if (img) {
    const zoom = o.zoom ?? 1.9;
    const dw = (pw - b * 2) * zoom;
    const dh = dw * (img.height / img.width);
    const scroll = ease.inOutCubic(clamp(p)) * Math.max(0, dh - (ph - b * 2)) * (o.scroll ?? 0.55);
    ctx.drawImage(img, px + b - (dw - (pw - b * 2)) / 2, py + b - scroll, dw, dh);
  }
  ctx.restore();

  // Notch + sheen
  const nw = pw * 0.3, nh = pw * 0.055;
  fillRound(ctx, px + pw / 2 - nw / 2, py + b * 1.4, nw, nh, nh / 2, '#33281a');
  ctx.save();
  roundRect(ctx, px + b, py + b, pw - b * 2, ph - b * 2, pw * 0.105);
  ctx.clip();
  const g = ctx.createLinearGradient(px, py, px + pw, py + ph * 0.6);
  g.addColorStop(0, 'rgba(255,255,255,0.16)');
  g.addColorStop(0.5, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(px, py, pw, ph);
  ctx.restore();
  ctx.restore();
}

/**
 * Screenshot filling the frame edge to edge with a slow drift.
 *
 * The source captures are wide, so on a vertical format a true cover crop would
 * mean a 3× blow-up of a 900px image. Instead the shot is fitted to the frame
 * width and the remaining space is closed with the brand backdrop — a deliberate
 * wide-crop look that stays sharp.
 */
function fullShot(ctx, W, H, p, o) {
  const img = o.assets?.[o.shot || 'homepage'];
  backdrop(ctx, W, H, o);
  if (!img) return;

  const ir = img.width / img.height;
  const frameRatio = W / H;
  const drift = ease.inOutQuad(p);
  let dw, dh, dx, dy;

  if (ir <= frameRatio * 1.02) {
    // Image is as wide as the frame or wider in relative terms — cover it.
    dh = H * 1.08; dw = dh * ir;
    if (dw < W * 1.02) { dw = W * 1.08; dh = dw / ir; }
    dx = (W - dw) / 2 + lerp(-1, 1, drift) * Math.min(Math.abs(dw - W) / 2, W * 0.04);
    dy = (H - dh) / 2 + lerp(-1, 1, drift) * Math.min(Math.abs(dh - H) / 2, H * 0.05);
  } else {
    // Wide capture in a tall frame: fit to width, drift vertically.
    dw = W * 1.02;
    dh = dw / ir;
    dx = (W - dw) / 2;
    const room = Math.max(0, H - dh);
    dy = room / 2 + lerp(-1, 1, drift) * Math.min(room / 2, H * 0.03);
  }

  withShadow(ctx, rgba(P.darkBrown, 0.25), H * 0.05, H * 0.012, () => {
    ctx.fillStyle = P.white;
    ctx.fillRect(dx, dy, dw, dh);
  });
  ctx.save();
  ctx.beginPath();
  ctx.rect(dx, dy, dw, dh);
  ctx.clip();
  ctx.drawImage(img, dx, dy, dw, dh);
  ctx.restore();
}

/** Plain brand backdrop for pure typography moments. */
function typePlate(ctx, W, H, p, o) {
  backdrop(ctx, W, H, o);
  if (o.tone === 'dark') return;
  // A drifting paper texture keeps flat frames from looking dead.
  const r = rng(o.seed || 3);
  ctx.save();
  ctx.globalAlpha = 0.05;
  for (let i = 0; i < 26; i++) {
    const rad = (0.06 + r() * 0.22) * Math.min(W, H);
    const x = r() * W + Math.sin(p * Math.PI * 2 + i) * W * 0.01;
    const y = r() * H + Math.cos(p * Math.PI * 2 + i) * H * 0.01;
    const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
    g.addColorStop(0, rgba(P.warmTan, 0.5));
    g.addColorStop(1, rgba(P.warmTan, 0));
    ctx.fillStyle = g;
    ctx.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
  ctx.restore();
}

/* ------------------------------------------------------------------ */

export const SCENES = {
  dashboardHub:     { label: 'Dashboard Hub',       group: 'Product', paint: dashboardHub },
  assignmentBoard:  { label: 'Assignment Board',    group: 'Product', paint: assignmentBoard },
  todoChecklist:    { label: "Today's Tasks",       group: 'Product', paint: todoChecklist },
  examCountdown:    { label: 'Exam Countdown',      group: 'Product', paint: examCountdown },
  financeDonut:     { label: 'Finance Donut',       group: 'Product', paint: financeDonut },
  expenseTable:     { label: 'Expense Log',         group: 'Product', paint: expenseTable },
  weekSchedule:     { label: 'Weekly Schedule',     group: 'Product', paint: weekSchedule },
  wellbeing:        { label: 'Wellbeing Check-in',  group: 'Product', paint: wellbeing },
  chaosApps:        { label: 'App Chaos',           group: 'Problem', paint: chaosApps },
  notifPanic:       { label: 'Panic Notifications', group: 'Problem', paint: notifPanic },
  beforeAfter:      { label: 'Before / After',      group: 'Problem', paint: beforeAfter },
  statBurst:        { label: 'Stat Burst',          group: 'Offer',   paint: statBurst },
  testimonial:      { label: 'Testimonial',         group: 'Offer',   paint: testimonial },
  priceCard:        { label: 'Price Card',          group: 'Offer',   paint: priceCard },
  endCard:          { label: 'End Card / CTA',      group: 'Offer',   paint: endCard },
  phoneDesk:        { label: 'Phone on Desk',       group: 'Footage', paint: phoneDesk },
  phoneHero:        { label: 'Phone Product Shot',  group: 'Footage', paint: phoneHero },
  laptopShot:       { label: 'Laptop Mockup',       group: 'Footage', paint: laptopShot },
  phoneShot:        { label: 'Phone Mockup',        group: 'Footage', paint: phoneShot },
  fullShot:         { label: 'Full-bleed Screen',   group: 'Footage', paint: fullShot },
  typePlate:        { label: 'Type Plate',          group: 'Footage', paint: typePlate },
};

export const SCENE_KEYS = Object.keys(SCENES);

export const SCENE_GROUPS = SCENE_KEYS.reduce((acc, k) => {
  (acc[SCENES[k].group] ||= []).push(k);
  return acc;
}, {});

export function paintScene(key, ctx, W, H, p, o = {}) {
  const s = SCENES[key] || SCENES.typePlate;
  ctx.save();
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = P.text;
  s.paint(ctx, W, H, clamp(p), o);
  ctx.restore();
}
