// Studio application: state, preview playback, timeline, inspector, export.

import { BRAND, FORMATS, GRADES, QUALITY } from './brand.js';
import { loadAssets } from './assets.js';
import { Renderer, totalDuration, drawGuides } from './engine.js';
import { MOTIONS, MOTION_GROUPS } from './motion.js';
import { SCENES, SCENE_GROUPS } from './scenes.js';
import {
  ANGLES, ARCS, FEATURE_LIST, generateStoryboard, generateWithClaude, rerollCopy,
} from './director.js';
import { STYLES, ScorePlayer } from './audio.js';
import {
  exportVideo, exportStills, exportScript, exportCaptions, exportAudio,
  download, slug, extForMime, pickMimeType, cutTimes,
} from './export.js';
import { clamp, fmtTime, uid } from './util.js';

/* ------------------------------------------------------------------ */
/* State                                                               */
/* ------------------------------------------------------------------ */

const state = {
  assets: null,
  board: null,
  selected: -1,
  playing: false,
  time: 0,
  playStartWall: 0,
  playStartTime: 0,
  exporting: false,
  quality: 'hd',
  fps: 30,
  brief: {
    angle: 'chaos',
    arc: 'problemSolution',
    duration: 22,
    format: '9:16',
    grade: 'warm',
    music: 'lofi',
    bpm: 96,
    grain: 0.35,
    vignette: 0.5,
    leak: 0.22,
    letterbox: false,
    features: [],
    notes: '',
  },
};

const renderer = new Renderer();
const thumbRenderer = new Renderer();
const player = new ScorePlayer();

const $ = id => document.getElementById(id);
const el = (tag, props = {}, ...kids) => {
  const n = document.createElement(tag);
  Object.entries(props).forEach(([k, v]) => {
    if (k === 'class') n.className = v;
    else if (k === 'html') n.innerHTML = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2).toLowerCase(), v);
    else if (v !== undefined && v !== null) n.setAttribute(k, v);
  });
  kids.flat().forEach(k => n.appendChild(typeof k === 'string' ? document.createTextNode(k) : k));
  return n;
};

function toast(msg, kind = '') {
  const t = el('div', { class: `toast ${kind}` }, msg);
  $('toasts').appendChild(t);
  setTimeout(() => {
    t.style.transition = 'opacity .3s'; t.style.opacity = '0';
    setTimeout(() => t.remove(), 320);
  }, kind === 'err' ? 6500 : 3200);
}

const PREFS_KEY = 'collegeos-adstudio-prefs';
const KEY_KEY = 'collegeos-adstudio-key';

function savePrefs() {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify({ ...state.brief, quality: state.quality, fps: state.fps }));
  } catch { /* storage disabled */ }
}
function loadPrefs() {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (raw) {
      const p = JSON.parse(raw);
      Object.assign(state.brief, p);
      if (p.quality) state.quality = p.quality;
      if (p.fps) state.fps = p.fps;
    }
  } catch { /* ignore malformed prefs */ }
}

/* ------------------------------------------------------------------ */
/* Control building                                                    */
/* ------------------------------------------------------------------ */

function fillSelect(node, entries, value) {
  node.innerHTML = '';
  entries.forEach(([v, label]) => node.appendChild(el('option', { value: v }, label)));
  node.value = value;
}

function fillGroupedSelect(node, groups, labelFor, value) {
  node.innerHTML = '';
  Object.entries(groups).forEach(([group, keys]) => {
    const og = el('optgroup', { label: group });
    keys.forEach(k => og.appendChild(el('option', { value: k }, labelFor(k))));
    node.appendChild(og);
  });
  node.value = value;
}

function buildSeg(node, entries, current, onPick) {
  node.innerHTML = '';
  entries.forEach(([v, label, title]) => {
    node.appendChild(el('button', {
      type: 'button', 'aria-pressed': String(v === current), title: title || label,
      onclick: () => {
        [...node.children].forEach(c => c.setAttribute('aria-pressed', 'false'));
        node.querySelector(`[data-v="${CSS.escape(String(v))}"]`)?.setAttribute('aria-pressed', 'true');
        onPick(v);
      },
      'data-v': v,
    }, label));
  });
}

function buildControls() {
  fillSelect($('angle'), Object.entries(ANGLES).map(([k, v]) => [k, v.label]), state.brief.angle);
  fillSelect($('arc'), Object.entries(ARCS).map(([k, v]) => [k, v.label]), state.brief.arc);
  fillSelect($('grade'), Object.entries(GRADES).map(([k, v]) => [k, v.label]), state.brief.grade);
  fillSelect($('music'), Object.entries(STYLES).map(([k, v]) => [k, v.label]), state.brief.music);
  $('arcHint').textContent = ARCS[state.brief.arc].hint;
  $('musicHint').textContent = STYLES[state.brief.music].hint;

  buildSeg($('formatSeg'),
    Object.entries(FORMATS).map(([k, v]) => [k, k, v.label]),
    state.brief.format,
    v => { state.brief.format = v; onFormatChange(); savePrefs(); });

  buildSeg($('qualitySeg'),
    Object.entries(QUALITY).map(([k, v]) => [k, v.label]),
    state.quality,
    v => { state.quality = v; savePrefs(); });

  buildSeg($('fpsSeg'), [[30, '30 fps'], [60, '60 fps']], state.fps,
    v => { state.fps = Number(v); savePrefs(); });

  const chips = $('featureChips');
  chips.innerHTML = '';
  FEATURE_LIST.forEach(f => {
    const on = state.brief.features.includes(f.key);
    chips.appendChild(el('button', {
      type: 'button', class: 'chip', 'aria-pressed': String(on), 'data-k': f.key,
      onclick: e => {
        const i = state.brief.features.indexOf(f.key);
        if (i >= 0) state.brief.features.splice(i, 1); else state.brief.features.push(f.key);
        e.currentTarget.setAttribute('aria-pressed', String(i < 0));
        savePrefs();
      },
    }, f.label));
  });

  // Sliders
  const sliders = [
    ['duration', v => `${v}s`, v => { state.brief.duration = +v; }],
    ['bpm', v => `${v} BPM`, v => { state.brief.bpm = +v; }],
    ['grain', v => (+v).toFixed(2), v => { state.brief.grain = +v; applyLook(); }],
    ['vignette', v => (+v).toFixed(2), v => { state.brief.vignette = +v; applyLook(); }],
    ['leak', v => (+v).toFixed(2), v => { state.brief.leak = +v; applyLook(); }],
  ];
  sliders.forEach(([id, fmt, set]) => {
    const input = $(id);
    input.value = state.brief[id];
    $(`${id}Val`).textContent = fmt(input.value);
    input.addEventListener('input', () => {
      $(`${id}Val`).textContent = fmt(input.value);
      set(input.value);
      savePrefs();
      if (!state.playing) renderPreview();
    });
  });

  $('letterbox').checked = !!state.brief.letterbox;
  $('letterbox').addEventListener('change', e => {
    state.brief.letterbox = e.target.checked; applyLook(); savePrefs();
  });

  $('angle').addEventListener('change', e => { state.brief.angle = e.target.value; savePrefs(); });
  $('arc').addEventListener('change', e => {
    state.brief.arc = e.target.value;
    $('arcHint').textContent = ARCS[state.brief.arc].hint;
    savePrefs();
  });
  $('grade').addEventListener('change', e => { state.brief.grade = e.target.value; applyLook(); savePrefs(); });
  $('music').addEventListener('change', e => {
    state.brief.music = e.target.value;
    $('musicHint').textContent = STYLES[state.brief.music].hint;
    savePrefs();
  });
  $('notes').addEventListener('input', e => { state.brief.notes = e.target.value; });
  $('notes').value = state.brief.notes || '';

  const key = localStorage.getItem(KEY_KEY) || '';
  $('apiKey').value = key;
  $('btnClaude').disabled = !key;
  $('apiKey').addEventListener('input', e => {
    const v = e.target.value.trim();
    try { localStorage.setItem(KEY_KEY, v); } catch { /* storage disabled */ }
    $('btnClaude').disabled = !v;
  });

  // Collapsible panels
  document.querySelectorAll('[data-toggle]').forEach(h => {
    h.addEventListener('click', () => h.parentElement.classList.toggle('collapsed'));
  });
}

function applyLook() {
  if (!state.board) return;
  state.board.look = {
    ...state.board.look,
    grade: state.brief.grade,
    grain: state.brief.grain,
    vignette: state.brief.vignette,
    leak: state.brief.leak,
    letterbox: state.brief.letterbox ? 1 : 0,
  };
  if (!state.playing) renderPreview();
  renderTimeline();
}

/* ------------------------------------------------------------------ */
/* Preview                                                             */
/* ------------------------------------------------------------------ */

function previewSize() {
  const f = FORMATS[state.brief.format];
  // Half-resolution preview keeps the loop smooth at 60fps on a laptop.
  return { w: Math.round(f.w * 0.5), h: Math.round(f.h * 0.5) };
}

function onFormatChange() {
  const canvas = $('preview');
  const { w, h } = previewSize();
  canvas.width = w; canvas.height = h;
  $('badgeFormat').textContent = `${state.brief.format} · ${FORMATS[state.brief.format].w}×${FORMATS[state.brief.format].h}`;
  fitCanvas();
  if (state.board) {
    state.board.format = state.brief.format;
    renderPreview();
    renderTimeline();
  }
}

function fitCanvas() {
  const wrap = $('canvasWrap');
  const vp = $('viewport');
  const canvas = $('preview');
  const pad = 44;
  const availW = vp.clientWidth - pad;
  const availH = vp.clientHeight - pad;
  const ratio = canvas.width / canvas.height;
  let w = availW, h = w / ratio;
  if (h > availH) { h = availH; w = h * ratio; }
  wrap.style.width = `${Math.max(120, Math.floor(w))}px`;
  wrap.style.height = `${Math.max(120, Math.floor(h))}px`;
  canvas.style.width = '100%';
  canvas.style.height = '100%';
}

function renderPreview() {
  if (!state.board) return;
  const canvas = $('preview');
  const ctx = canvas.getContext('2d');
  renderer.setSize(canvas.width, canvas.height);
  renderer.render(ctx, state.board, state.time, { assets: state.assets, quality: 'preview' });
  if ($('guides').checked) drawGuides(ctx, canvas.width, canvas.height);
  updateTransport();
}

function updateTransport() {
  const total = state.board ? totalDuration(state.board) : 0;
  $('tcNow').textContent = fmtTime(state.time);
  $('tcTotal').textContent = fmtTime(total);
  if (document.activeElement !== $('scrub')) {
    $('scrub').value = total > 0 ? Math.round((state.time / total) * 1000) : 0;
  }
}

let rafId = 0;
function loop(now) {
  rafId = requestAnimationFrame(loop);
  if (!state.playing || !state.board) return;
  const total = totalDuration(state.board);
  state.time = state.playStartTime + (now - state.playStartWall) / 1000;
  if (state.time >= total) {
    state.time = total;
    setPlaying(false);
  }
  renderPreview();
}

function setPlaying(on) {
  if (!state.board) return;
  const total = totalDuration(state.board);
  if (on && state.time >= total - 0.02) state.time = 0;
  state.playing = on;
  $('btnPlay').textContent = on ? '❚❚' : '▶';
  if (on) {
    state.playStartWall = performance.now();
    state.playStartTime = state.time;
    player.play({
      style: state.brief.music, bpm: state.brief.bpm, seed: state.board.seed,
      duration: total, cuts: cutTimes(state.board),
    }, state.time, false);
  } else {
    player.stop();
    renderPreview();
  }
}

/* ------------------------------------------------------------------ */
/* Timeline                                                            */
/* ------------------------------------------------------------------ */

function renderTimeline() {
  const track = $('track');
  track.innerHTML = '';
  if (!state.board) return;
  const f = FORMATS[state.brief.format];
  const tw = 104;
  const th = Math.round(tw / (f.w / f.h));
  thumbRenderer.setSize(tw * 2, th * 2);

  let acc = 0;
  state.board.scenes.forEach((s, i) => {
    const c = el('canvas', { width: tw * 2, height: th * 2 });
    c.style.height = `${th}px`;
    thumbRenderer.render(c.getContext('2d'), state.board, acc + s.dur * 0.7, {
      assets: state.assets, quality: 'preview',
    });
    acc += s.dur;

    const card = el('div', {
      class: 'shot', 'aria-selected': String(i === state.selected), 'data-i': i,
      onclick: () => selectShot(i),
      ondblclick: () => { state.time = sceneStart(i) + 0.05; renderPreview(); },
    },
      el('span', { class: 'idx' }, String(i + 1)),
      c,
      el('div', { class: 'meta' },
        el('div', { class: 'b' }, s.beat),
        el('div', { class: 'd' }, `${s.dur.toFixed(2)}s · ${MOTIONS[s.motion]?.label || s.motion}`),
      ),
    );
    track.appendChild(card);
  });

  track.appendChild(el('button', {
    class: 'add-shot', title: 'Duplicate the last shot', onclick: () => {
      const last = state.board.scenes[state.board.scenes.length - 1];
      if (!last) return;
      state.board.scenes.push({ ...structuredClone(last), id: uid() });
      renderTimeline(); renderPreview(); updateTopStat();
    },
  }, '+'));

  $('shotCount').textContent = `${state.board.scenes.length} shots · ${totalDuration(state.board).toFixed(1)}s`;
}

const sceneStart = i => state.board.scenes.slice(0, i).reduce((a, s) => a + s.dur, 0);

function selectShot(i) {
  state.selected = i;
  document.querySelectorAll('.shot').forEach(n => {
    n.setAttribute('aria-selected', String(Number(n.dataset.i) === i));
  });
  renderInspector();
}

/* ------------------------------------------------------------------ */
/* Inspector                                                           */
/* ------------------------------------------------------------------ */

function renderInspector() {
  const host = $('inspector');
  host.innerHTML = '';
  const s = state.board?.scenes[state.selected];
  if (!s) {
    host.appendChild(el('div', { class: 'empty-note' },
      'Generate an ad, then select a shot in the timeline to retime it, swap the camera move, change the on-screen copy, or replace the visual.'));
    return;
  }

  const commit = (rerenderTimeline = true) => {
    if (rerenderTimeline) renderTimeline();
    if (!state.playing) renderPreview();
    updateTopStat();
  };

  const field = (labelText, control, hint) => {
    const f = el('div', { class: 'field' }, el('label', {}, labelText), control);
    if (hint) f.appendChild(el('div', { class: 'hint' }, hint));
    return f;
  };

  // --- visual ---
  const sceneSel = el('select');
  fillGroupedSelect(sceneSel, SCENE_GROUPS, k => SCENES[k].label, s.layer);
  sceneSel.addEventListener('change', () => { s.layer = sceneSel.value; commit(); });
  host.appendChild(field('Visual', sceneSel));

  // Screenshot picker for the mockup scenes.
  if (['laptopShot', 'phoneShot', 'fullShot'].includes(s.layer)) {
    const shotSel = el('select');
    fillSelect(shotSel, [
      ['homepage', 'Homepage'], ['assignments', 'Assignment Tracker'],
      ['exams', 'Exam Countdown'], ['finance', 'Finance Tracker'],
    ], s.layerOpts?.shot || 'homepage');
    shotSel.addEventListener('change', () => {
      s.layerOpts = { ...s.layerOpts, shot: shotSel.value }; commit();
    });
    host.appendChild(field('Screenshot', shotSel, 'Real captures from the live template.'));
  }

  // --- camera ---
  const motionSel = el('select');
  fillGroupedSelect(motionSel, MOTION_GROUPS, k => MOTIONS[k].label, s.motion);
  motionSel.addEventListener('change', () => {
    s.motion = motionSel.value;
    motionHint.textContent = MOTIONS[s.motion].hint;
    commit();
  });
  const motionHint = el('div', { class: 'hint' }, MOTIONS[s.motion]?.hint || '');
  host.appendChild(el('div', { class: 'field' }, el('label', {}, 'Camera move'), motionSel, motionHint));

  const amt = el('input', { type: 'range', min: '0.2', max: '2', step: '0.05', value: String(s.motionAmount ?? 1) });
  const amtLabel = el('label', {}, 'Intensity ', el('b', {}, (s.motionAmount ?? 1).toFixed(2)));
  amt.addEventListener('input', () => {
    s.motionAmount = +amt.value;
    amtLabel.querySelector('b').textContent = (+amt.value).toFixed(2);
    if (!state.playing) renderPreview();
  });
  amt.addEventListener('change', () => commit());
  host.appendChild(el('div', { class: 'field' }, amtLabel, amt));

  // --- timing ---
  const dur = el('input', { type: 'range', min: '0.6', max: '10', step: '0.05', value: String(s.dur) });
  const durLabel = el('label', {}, 'Duration ', el('b', {}, `${s.dur.toFixed(2)}s`));
  dur.addEventListener('input', () => {
    s.dur = +dur.value;
    durLabel.querySelector('b').textContent = `${s.dur.toFixed(2)}s`;
    updateTransport();
  });
  dur.addEventListener('change', () => { state.time = Math.min(state.time, totalDuration(state.board)); commit(); });
  host.appendChild(el('div', { class: 'field' }, durLabel, dur));

  const transSel = el('select');
  fillSelect(transSel, [
    ['cut', 'Hard cut'], ['whip', 'Whip smear'], ['glitch', 'Glitch'],
    ['zoomBlur', 'Zoom blur'], ['flash', 'Flash'], ['dip', 'Dip to cream'],
    ['burn', 'Film burn'], ['wipe', 'Wipe'],
  ], s.transition || 'cut');
  transSel.addEventListener('change', () => { s.transition = transSel.value; commit(false); });
  host.appendChild(field('Cut into this shot', transSel));

  host.appendChild(el('div', { class: 'divider' }));

  // --- copy ---
  const kick = el('input', { type: 'text', value: s.kicker || '', placeholder: 'e.g. Exam Countdown' });
  kick.addEventListener('input', () => { s.kicker = kick.value || undefined; if (!state.playing) renderPreview(); });
  kick.addEventListener('change', () => commit(false));
  host.appendChild(field('Kicker label', kick, 'Small pill above the headline. Leave blank to hide.'));

  (s.text || []).forEach((block, bi) => {
    const ta = el('textarea', { placeholder: 'On-screen copy' });
    ta.value = block.text || '';
    ta.addEventListener('input', () => { block.text = ta.value; if (!state.playing) renderPreview(); });
    ta.addEventListener('change', () => commit(false));
    host.appendChild(field(bi === 0 ? 'On-screen copy' : `Copy line ${bi + 1}`, ta,
      bi === 0 ? 'Wrap a word in *asterisks* to highlight it in the accent colour.' : undefined));

    const row = el('div', { class: 'btn-row' });
    const posSel = el('select');
    fillSelect(posSel, [['center', 'Centre'], ['top', 'Top third'], ['lower', 'Lower third'], ['bottom', 'Bottom']],
      typeof block.pos === 'string' ? block.pos : 'center');
    posSel.addEventListener('change', () => { block.pos = posSel.value; commit(false); });

    const animSel = el('select');
    fillSelect(animSel, [
      ['stagger', 'Word stagger'], ['mask', 'Mask wipe'], ['pop', 'Pop'],
      ['slam', 'Slam'], ['type', 'Typewriter'],
    ], block.anim || 'stagger');
    animSel.addEventListener('change', () => { block.anim = animSel.value; commit(false); });

    row.appendChild(posSel); row.appendChild(animSel);
    host.appendChild(row);

    const size = el('input', { type: 'range', min: '0.03', max: '0.14', step: '0.004', value: String(block.size ?? 0.08) });
    const sizeLabel = el('label', {}, 'Type size ', el('b', {}, (block.size ?? 0.08).toFixed(3)));
    size.addEventListener('input', () => {
      block.size = +size.value;
      sizeLabel.querySelector('b').textContent = (+size.value).toFixed(3);
      if (!state.playing) renderPreview();
    });
    host.appendChild(el('div', { class: 'field' }, sizeLabel, size));
  });

  if (!(s.text || []).length) {
    host.appendChild(el('button', {
      class: 'btn sm', onclick: () => {
        s.text = [{ text: 'New line', pos: 'lower', size: 0.062, anim: 'stagger', scrim: 0.8 }];
        renderInspector(); commit(false);
      },
    }, '+ Add on-screen copy'));
  }

  if (s.layer === 'endCard') {
    const cta = el('input', { type: 'text', value: s.layerOpts?.cta || `Get College OS — ${BRAND.price}` });
    cta.addEventListener('input', () => {
      s.layerOpts = { ...s.layerOpts, cta: cta.value }; if (!state.playing) renderPreview();
    });
    host.appendChild(field('CTA button', cta));
  }

  host.appendChild(el('div', { class: 'divider' }));

  const nav = el('div', { class: 'btn-row' },
    el('button', {
      class: 'btn sm', title: 'Move earlier',
      onclick: () => moveShot(state.selected, -1),
    }, '←'),
    el('button', {
      class: 'btn sm', title: 'Move later',
      onclick: () => moveShot(state.selected, 1),
    }, '→'),
    el('button', {
      class: 'btn sm', title: 'Duplicate',
      onclick: () => {
        const copy = { ...structuredClone(s), id: uid() };
        state.board.scenes.splice(state.selected + 1, 0, copy);
        selectShot(state.selected + 1); commit();
      },
    }, '⧉'),
    el('button', {
      class: 'btn sm', title: 'Delete shot',
      onclick: () => {
        if (state.board.scenes.length <= 1) return toast('An ad needs at least one shot.', 'err');
        state.board.scenes.splice(state.selected, 1);
        state.selected = Math.max(0, state.selected - 1);
        state.time = Math.min(state.time, totalDuration(state.board));
        renderInspector(); commit();
      },
    }, '🗑'),
  );
  host.appendChild(nav);
}

function moveShot(i, dir) {
  const j = i + dir;
  const arr = state.board.scenes;
  if (j < 0 || j >= arr.length) return;
  [arr[i], arr[j]] = [arr[j], arr[i]];
  selectShot(j);
  renderTimeline();
  if (!state.playing) renderPreview();
}

/* ------------------------------------------------------------------ */
/* Generation                                                          */
/* ------------------------------------------------------------------ */

function adoptBoard(board) {
  state.board = board;
  state.time = 0;
  state.selected = 0;
  applyLook();
  $('stageEmpty').hidden = true;
  $('canvasWrap').hidden = false;
  onFormatChange();
  renderTimeline();
  renderInspector();
  renderPreview();
  ['btnReroll', 'btnVariant', 'btnExportVideo', 'btnStills', 'btnAudio', 'btnScript', 'btnCaptions']
    .forEach(id => { $(id).disabled = false; });
  updateTopStat();
}

function updateTopStat() {
  if (!state.board) return;
  const f = FORMATS[state.brief.format];
  const scale = QUALITY[state.quality].scale;
  $('topStat').innerHTML =
    `<b>${state.board.title}</b> · ${state.board.scenes.length} shots · ` +
    `${totalDuration(state.board).toFixed(1)}s · ` +
    `${Math.round(f.w * scale)}×${Math.round(f.h * scale)} @ ${state.fps}fps`;
}

function briefForDirector(seed) {
  return { ...state.brief, seed, format: state.brief.format };
}

function doGenerate() {
  setPlaying(false);
  const board = generateStoryboard(briefForDirector(Math.floor(Math.random() * 1e9)));
  adoptBoard(board);
  toast('Ad generated. Scrub the timeline or hit play.', 'ok');
}

async function doClaude() {
  const apiKey = $('apiKey').value.trim();
  if (!apiKey) return toast('Add your Claude API key first.', 'err');
  setPlaying(false);
  const btn = $('btnClaude');
  btn.disabled = true;
  btn.textContent = '✦ Claude is writing…';
  try {
    const board = await generateWithClaude({
      apiKey,
      brief: { ...briefForDirector(Math.floor(Math.random() * 1e9)), notes: state.brief.notes },
    });
    adoptBoard(board);
    toast('Copy written by Claude.', 'ok');
  } catch (err) {
    console.error(err);
    toast(String(err.message || err), 'err');
  } finally {
    btn.disabled = false;
    btn.textContent = '✦ Write copy with Claude';
  }
}

/* ------------------------------------------------------------------ */
/* Export                                                              */
/* ------------------------------------------------------------------ */

function exportCanvas() {
  const f = FORMATS[state.brief.format];
  const scale = QUALITY[state.quality].scale;
  const c = document.createElement('canvas');
  c.width = Math.round(f.w * scale / 2) * 2;
  c.height = Math.round(f.h * scale / 2) * 2;
  return c;
}

async function doExportVideo() {
  if (!state.board || state.exporting) return;
  setPlaying(false);
  state.exporting = true;
  const btn = $('btnExportVideo');
  btn.disabled = true;
  btn.textContent = 'Rendering…';

  const canvas = exportCanvas();
  const exportRenderer = new Renderer();
  exportRenderer.setSize(canvas.width, canvas.height);

  try {
    const { blob, mime, slowFrames, frames, codec } = await exportVideo({
      canvas,
      renderer: exportRenderer,
      board: state.board,
      assets: state.assets,
      fps: state.fps,
      player,
      audio: {
        style: state.brief.music, bpm: state.brief.bpm, seed: state.board.seed,
      },
      onProgress: (p, stats) => {
        $('exportBar').style.width = `${(p * 100).toFixed(1)}%`;
        $('exportMsg').textContent = `Frame ${stats.frame} of ${stats.frames}`;
      },
    });

    const name = `collegeos-${slug(state.board.title)}-${state.brief.format.replace(':', 'x')}.${extForMime(mime)}`;
    download(blob, name);
    const mb = (blob.size / 1048576).toFixed(1);
    $('exportMsg').textContent = `Done — ${mb} MB, ${codec.label} in ${extForMime(mime).toUpperCase()}`;
    if (slowFrames > frames * 0.1) {
      toast(`Exported, but ${slowFrames} frames rendered slower than real time. Drop to 30 fps or 1080p for a cleaner file.`, 'err');
    } else if (!codec.ok) {
      toast(`Exported ${name} (${mb} MB). Your browser encoded ${codec.label}, not H.264 — most platforms accept it, but re-encode before handing it to an editor.`, 'err');
    } else {
      toast(`Exported ${name} — ${mb} MB, ${codec.label}.`, 'ok');
    }
  } catch (err) {
    console.error(err);
    toast(`Export failed: ${err.message || err}`, 'err');
    $('exportMsg').textContent = 'Export failed.';
  } finally {
    state.exporting = false;
    btn.disabled = false;
    btn.textContent = '⬇ Export video';
    $('exportBar').style.width = '0%';
  }
}

async function doExportStills() {
  if (!state.board) return;
  setPlaying(false);
  const btn = $('btnStills');
  btn.disabled = true; btn.textContent = '…';
  try {
    const canvas = exportCanvas();
    const r = new Renderer();
    r.setSize(canvas.width, canvas.height);
    const zip = await exportStills({
      canvas, renderer: r, board: state.board, assets: state.assets,
      onProgress: p => { $('exportBar').style.width = `${(p * 100).toFixed(0)}%`; },
    });
    download(zip, `collegeos-${slug(state.board.title)}-stills.zip`);
    toast(`${state.board.scenes.length} stills exported.`, 'ok');
  } catch (err) {
    toast(`Stills failed: ${err.message || err}`, 'err');
  } finally {
    btn.disabled = false; btn.textContent = 'Stills .zip';
    $('exportBar').style.width = '0%';
  }
}

async function doExportAudio() {
  if (!state.board) return;
  const btn = $('btnAudio');
  btn.disabled = true; btn.textContent = '…';
  try {
    const wav = await exportAudio(state.board, {
      style: state.brief.music, bpm: state.brief.bpm, seed: state.board.seed,
    });
    download(wav, `collegeos-${slug(state.board.title)}-score.wav`);
    toast('Score exported as WAV.', 'ok');
  } catch (err) {
    toast(`Audio export failed: ${err.message || err}`, 'err');
  } finally {
    btn.disabled = false; btn.textContent = 'Audio .wav';
  }
}

/* ------------------------------------------------------------------ */
/* Boot                                                                */
/* ------------------------------------------------------------------ */

async function boot() {
  loadPrefs();
  buildControls();

  try {
    state.assets = await loadAssets((p, what) => {
      $('loadBar').style.width = `${(p * 100).toFixed(0)}%`;
      $('loadMsg').textContent = `Loading ${what}…`;
    });
  } catch (err) {
    state.assets = {};
    console.warn(err);
  }

  const mime = pickMimeType();
  $('exportMsg').textContent = mime
    ? `Renders in real time to ${extForMime(mime).toUpperCase()} — keep this tab in front.`
    : 'This browser cannot record video. Stills and script export still work.';
  if (!mime) $('btnExportVideo').disabled = true;

  onFormatChange();
  $('loading').classList.add('done');
  setTimeout(() => $('loading').remove(), 500);

  // Wiring
  $('btnGenerate').addEventListener('click', doGenerate);
  $('btnClaude').addEventListener('click', doClaude);
  $('btnReroll').addEventListener('click', () => {
    if (!state.board) return;
    rerollCopy(state.board);
    renderTimeline(); renderInspector(); renderPreview();
    toast('New copy, same cut.');
  });
  $('btnVariant').addEventListener('click', () => {
    if (!state.board) return;
    setPlaying(false);
    adoptBoard(generateStoryboard(briefForDirector(Math.floor(Math.random() * 1e9))));
    toast('New cut generated.');
  });
  $('btnPlay').addEventListener('click', () => setPlaying(!state.playing));
  $('scrub').addEventListener('input', e => {
    if (!state.board) return;
    const wasPlaying = state.playing;
    if (wasPlaying) setPlaying(false);
    state.time = (e.target.value / 1000) * totalDuration(state.board);
    renderPreview();
  });
  $('guides').addEventListener('change', () => renderPreview());
  $('btnExportVideo').addEventListener('click', doExportVideo);
  $('btnStills').addEventListener('click', doExportStills);
  $('btnAudio').addEventListener('click', doExportAudio);
  $('btnScript').addEventListener('click', () => {
    download(exportScript(state.board), `collegeos-${slug(state.board.title)}-script.txt`);
  });
  $('btnCaptions').addEventListener('click', () => {
    download(exportCaptions(state.board), `collegeos-${slug(state.board.title)}.vtt`);
  });

  window.addEventListener('resize', () => { fitCanvas(); if (!state.playing) renderPreview(); });
  window.addEventListener('keydown', e => {
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;
    if (e.code === 'Space') { e.preventDefault(); setPlaying(!state.playing); }
    if (e.code === 'ArrowLeft' && state.board) {
      state.time = clamp(state.time - (e.shiftKey ? 1 : 1 / 30), 0, totalDuration(state.board));
      setPlaying(false); renderPreview();
    }
    if (e.code === 'ArrowRight' && state.board) {
      state.time = clamp(state.time + (e.shiftKey ? 1 : 1 / 30), 0, totalDuration(state.board));
      setPlaying(false); renderPreview();
    }
  });

  rafId = requestAnimationFrame(loop);
}

boot();
