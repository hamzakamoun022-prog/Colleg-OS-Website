// Export.
//
// Video capture uses `canvas.captureStream(0)` and pushes exactly one frame per
// output frame via `requestFrame()`, paced against the wall clock. That gives a
// deterministic frame sequence — no duplicated or dropped frames when rendering
// runs faster than real time — while still letting the audio track ride along in
// sync, which is what a plain realtime capture cannot guarantee.

import { totalDuration } from './engine.js';
import { renderScoreToWav } from './audio.js';
import { fmtTime } from './util.js';

const MP4_CANDIDATES = [
  'video/mp4;codecs=avc1.640033,mp4a.40.2',
  'video/mp4;codecs=avc1.4d002a,mp4a.40.2',
  'video/mp4',
];
const WEBM_CANDIDATES = [
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm',
];

const supported = c => !!window.MediaRecorder?.isTypeSupported?.(c);

/** Prefer MP4/H.264 where the browser can mux it; fall back to WebM. */
export function pickMimeType() {
  for (const c of [...MP4_CANDIDATES, ...WEBM_CANDIDATES]) if (supported(c)) return c;
  return '';
}

let probed = null;

/**
 * Find a mime type the browser will honour — not merely one it claims.
 *
 * `isTypeSupported('video/mp4;codecs=avc1…,mp4a…')` returns true on Chromium
 * builds without the proprietary encoders, which then write VP9 video and Opus
 * audio into an MP4 container. That file has a `.mp4` name and a real audio
 * track, but QuickTime, iOS and most editors either refuse it outright or play
 * it silently — which looks exactly like "the export has no sound".
 *
 * So: record a fraction of a second, read what actually came out, and if the
 * MP4 isn't H.264, record WebM instead. VP9/Opus in a correctly named `.webm`
 * plays everywhere those same tools accept WebM at all, with its audio intact.
 */
export async function resolveMimeType() {
  if (probed) return probed;

  const webm = WEBM_CANDIDATES.find(supported) || '';
  const mp4 = MP4_CANDIDATES.find(supported);
  if (!mp4) return (probed = { mime: webm, honest: true });

  try {
    const probe = document.createElement('canvas');
    probe.width = probe.height = 64;
    const pctx = probe.getContext('2d');
    pctx.fillStyle = '#8B6F47';
    pctx.fillRect(0, 0, 64, 64);
    const stream = probe.captureStream(10);
    const rec = new MediaRecorder(stream, { mimeType: mp4, videoBitsPerSecond: 200000 });
    const chunks = [];
    rec.ondataavailable = e => e.data.size && chunks.push(e.data);
    const done = new Promise(res => { rec.onstop = res; });
    rec.start();
    // Two paints so the encoder has something to commit before we stop it.
    for (let i = 0; i < 12; i++) {
      pctx.fillStyle = i % 2 ? '#8B6F47' : '#2A2118';
      pctx.fillRect(0, 0, 64, 64);
      await sleep(20);
    }
    rec.stop();
    await done;
    stream.getTracks().forEach(t => t.stop());

    const codec = await sniffCodec(new Blob(chunks, { type: mp4 }));
    if (codec.ok) return (probed = { mime: mp4, honest: true });
    // MP4 container, non-H.264 payload. WebM is the container that fits it.
    return (probed = { mime: webm || mp4, honest: !!webm, claimed: mp4, actual: codec.label });
  } catch {
    return (probed = { mime: mp4, honest: true });
  }
}

export const extForMime = m => (m.startsWith('video/mp4') ? 'mp4' : 'webm');

/**
 * Read the codec actually written into the file.
 *
 * `isTypeSupported('video/mp4;codecs=avc1…')` can return true on a build that
 * then encodes VP9 into the MP4 container instead. That file plays in Chrome but
 * is rejected by plenty of editors and ad platforms, so the studio reports what
 * it really got rather than what it asked for.
 */
export async function sniffCodec(blob) {
  const head = new Uint8Array(await blob.slice(0, 65536).arrayBuffer());
  const find = tag => {
    const b = tag.split('').map(c => c.charCodeAt(0));
    outer: for (let i = 0; i < head.length - b.length; i++) {
      for (let j = 0; j < b.length; j++) if (head[i + j] !== b[j]) continue outer;
      return i;
    }
    return -1;
  };
  const has = tag => find(tag) >= 0;
  // Whether a sound track made it into the file at all — the one fact worth
  // reporting plainly, because a silent export is the failure people notice.
  const audio = has('A_OPUS') || has('A_VORBIS') || has('mp4a') || has('Opus');

  if (has('avcC') || has('V_MPEG4/ISO/AVC')) return { codec: 'h264', label: 'H.264', ok: true, audio };
  if (has('hvcC')) return { codec: 'hevc', label: 'HEVC', ok: true, audio };
  if (has('vp09') || has('V_VP9')) return { codec: 'vp9', label: 'VP9', ok: false, audio };
  if (has('V_VP8')) return { codec: 'vp8', label: 'VP8', ok: false, audio };
  if (has('av01') || has('V_AV1')) return { codec: 'av1', label: 'AV1', ok: false, audio };
  if (head[0] === 0x1a && head[1] === 0x45) return { codec: 'webm', label: 'WebM', ok: false, audio };
  return { codec: 'unknown', label: 'unknown', ok: false, audio };
}

const nextFrame = () => new Promise(r => requestAnimationFrame(() => r()));
const sleep = ms => new Promise(r => setTimeout(r, ms));

/**
 * Render a storyboard to a video Blob.
 *
 * @param {object} o
 *   canvas, renderer, board, assets, fps, bitrate, player (ScorePlayer),
 *   audio {style,bpm,seed,volume}, onProgress(0..1, stats), signal
 */
export async function exportVideo(o) {
  const {
    canvas, renderer, board, assets, fps = 30, player, audio,
    onProgress = () => {}, signal,
  } = o;

  const ctx = canvas.getContext('2d');
  const duration = totalDuration(board);
  const frames = Math.max(1, Math.round(duration * fps));
  if (!window.MediaRecorder) throw new Error('This browser cannot record video.');
  const chosen = await resolveMimeType();
  const mime = chosen.mime;

  const stream = canvas.captureStream(0);
  const track = stream.getVideoTracks()[0];

  // Mix in the score, if any.
  let audioTrack = null;
  if (audio && audio.style !== 'none' && player) {
    player.ensureContext();
    audioTrack = player.stream.getAudioTracks()[0];
    if (audioTrack) stream.addTrack(audioTrack);
  }

  const bitrate = o.bitrate || Math.round(canvas.width * canvas.height * fps * 0.13);
  const rec = new MediaRecorder(stream, {
    mimeType: mime || undefined,
    videoBitsPerSecond: bitrate,
    audioBitsPerSecond: 192000,
  });

  const chunks = [];
  rec.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data); };
  const done = new Promise((resolve, reject) => {
    rec.onstop = () => resolve(new Blob(chunks, { type: mime || 'video/webm' }));
    rec.onerror = e => reject(e.error || new Error('Recorder failed.'));
  });

  const frameMs = 1000 / fps;

  // Pre-flight: time a few real frames before the recorder is listening. The
  // score is generated live and in real time, so the video has to keep pace
  // with the wall clock — starting in a mode the machine can't sustain wastes
  // the opening seconds discovering that.
  let quality = 'hd';
  {
    let worst = 0;
    for (const t of [0, duration * 0.45, duration * 0.8]) {
      const s = performance.now();
      renderer.render(ctx, board, t, { assets, quality: 'hd' });
      worst = Math.max(worst, performance.now() - s);
    }
    if (worst > frameMs) quality = 'fast';
  }

  // Warm the first frame before the recorder starts so frame 0 is never blank.
  renderer.render(ctx, board, 0, { assets, quality });
  await nextFrame();

  rec.start();
  if (audioTrack && player) player.play({ ...audio, duration, cuts: cutTimes(board) }, 0, true);

  const startedAt = performance.now();
  let slowFrames = 0;
  let recentSlow = 0;
  let dropped = 0;
  let last = -1;

  // The recorder timestamps each frame at the moment it arrives, so the output
  // length is wall time, not frame count. Rendering every frame however long it
  // takes therefore stretches the video — a 10s ad that renders at a third of
  // real time becomes a 30s file whose music stops a third of the way in. So
  // when a frame comes due late, skip to the frame that is due *now*. A dropped
  // frame costs some smoothness; a stretched timeline costs the whole edit.
  for (;;) {
    if (signal?.aborted) break;
    let i = last + 1;
    if (i >= frames) break;

    const due = Math.floor((performance.now() - startedAt) / frameMs);
    if (due > i) { dropped += Math.min(due, frames - 1) - i; i = Math.min(due, frames - 1); }

    // Ahead of schedule: hold for this frame's slot.
    let wait = startedAt + i * frameMs - performance.now();
    while (wait > 2) {
      await sleep(Math.min(wait, 16));
      wait = startedAt + i * frameMs - performance.now();
    }

    const renderStart = performance.now();
    renderer.render(ctx, board, i / fps, { assets, quality });
    if (performance.now() - renderStart > frameMs) {
      slowFrames++;
      if (++recentSlow >= 8 && quality === 'hd') quality = 'fast';
    } else if (recentSlow > 0) {
      recentSlow--;
    }

    track.requestFrame();
    last = i;
    if (i % 3 === 0) await nextFrame();
    onProgress(i / frames, { frame: i, frames, slowFrames, dropped });
  }

  // Let the last frame land before closing the muxer.
  await sleep(Math.max(120, frameMs * 3));
  rec.stop();
  player?.stop();
  const blob = await done;
  const codec = await sniffCodec(blob);
  const wallSeconds = (performance.now() - startedAt) / 1000;
  onProgress(1, { frame: frames, frames, slowFrames, dropped });
  return {
    blob, mime: mime || 'video/webm', slowFrames, frames, codec, dropped,
    // How far the recording drifted from the storyboard's own length.
    stretch: wallSeconds / duration,
    // Present when the browser lied about MP4 and we fell back to WebM.
    remuxed: chosen.claimed ? { claimed: chosen.claimed, actual: chosen.actual } : null,
  };
}

/** Times (seconds) of every cut, used to place whooshes and impacts. */
export function cutTimes(board) {
  const out = [];
  let acc = 0;
  for (const s of board.scenes) { out.push(acc); acc += s.dur; }
  return out;
}

/* ------------------------------------------------------------------ */
/* Stills                                                              */
/* ------------------------------------------------------------------ */

/**
 * One high-resolution PNG per scene, taken at the scene's most-resolved moment.
 * These double as static ad creative and thumbnails.
 */
export async function exportStills({ canvas, renderer, board, assets, onProgress = () => {} }) {
  const ctx = canvas.getContext('2d');
  const files = [];
  let acc = 0;
  for (let i = 0; i < board.scenes.length; i++) {
    const s = board.scenes[i];
    // 72% through a scene: motion has resolved and the copy is fully on.
    const t = acc + s.dur * 0.72;
    renderer.render(ctx, board, t, { assets, quality: 'hd' });
    const blob = await new Promise(r => canvas.toBlob(r, 'image/png'));
    files.push({
      name: `${String(i + 1).padStart(2, '0')}-${s.beat}.png`,
      data: new Uint8Array(await blob.arrayBuffer()),
    });
    acc += s.dur;
    onProgress((i + 1) / board.scenes.length);
  }
  return zipStore(files);
}

/* ------------------------------------------------------------------ */
/* Script / captions                                                   */
/* ------------------------------------------------------------------ */

const stripMarkup = s => String(s ?? '').replace(/\*/g, '');

export function exportScript(board) {
  const lines = [];
  lines.push(`COLLEGE OS — AD SCRIPT`);
  lines.push(board.title);
  lines.push(`Format ${board.format} · ${totalDuration(board).toFixed(1)}s · ${board.bpm} BPM · seed ${board.seed}`);
  lines.push('='.repeat(58));
  lines.push('');
  let acc = 0;
  board.scenes.forEach((s, i) => {
    const end = acc + s.dur;
    lines.push(`${String(i + 1).padStart(2, '0')}  ${fmtTime(acc)} → ${fmtTime(end)}  (${s.dur.toFixed(2)}s)`);
    lines.push(`    beat     ${s.beat}`);
    lines.push(`    visual   ${s.layer}`);
    lines.push(`    camera   ${s.motion}`);
    if (s.transition && s.transition !== 'cut') lines.push(`    cut in   ${s.transition}`);
    if (s.kicker) lines.push(`    kicker   ${s.kicker.toUpperCase()}`);
    for (const t of s.text || []) lines.push(`    on-screen "${stripMarkup(t.text)}"`);
    if (s.layerOpts?.cta) lines.push(`    button   "${s.layerOpts.cta}"`);
    lines.push('');
    acc = end;
  });
  lines.push('-'.repeat(58));
  lines.push('Voiceover / caption track:');
  acc = 0;
  board.scenes.forEach(s => {
    const said = (s.text || []).map(t => stripMarkup(t.text)).filter(Boolean).join(' ');
    if (said) lines.push(`[${fmtTime(acc)}] ${said}`);
    acc += s.dur;
  });
  return new Blob([lines.join('\n')], { type: 'text/plain' });
}

/** WebVTT captions, for platforms that accept an upload. */
export function exportCaptions(board) {
  const vtt = ['WEBVTT', ''];
  const stamp = s => {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = (s % 60).toFixed(3).padStart(6, '0');
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${sec}`;
  };
  let acc = 0;
  for (const s of board.scenes) {
    const said = (s.text || []).map(t => stripMarkup(t.text)).filter(Boolean).join(' ');
    if (said) {
      vtt.push(`${stamp(acc + 0.1)} --> ${stamp(acc + s.dur - 0.05)}`);
      vtt.push(said);
      vtt.push('');
    }
    acc += s.dur;
  }
  return new Blob([vtt.join('\n')], { type: 'text/vtt' });
}

export async function exportAudio(board, audio) {
  return renderScoreToWav({
    ...audio,
    duration: totalDuration(board),
    cuts: cutTimes(board),
  });
}

/* ------------------------------------------------------------------ */
/* Minimal store-only ZIP writer                                       */
/* ------------------------------------------------------------------ */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Files are stored uncompressed — PNGs are already deflated. */
export function zipStore(files) {
  const enc = new TextEncoder();
  const parts = [];
  const central = [];
  let offset = 0;

  for (const f of files) {
    const nameBytes = enc.encode(f.name);
    const crc = crc32(f.data);
    const local = new Uint8Array(30 + nameBytes.length);
    const dv = new DataView(local.buffer);
    dv.setUint32(0, 0x04034b50, true);
    dv.setUint16(4, 20, true);
    dv.setUint16(6, 0, true);
    dv.setUint16(8, 0, true);          // stored
    dv.setUint16(10, 0, true);
    dv.setUint16(12, 0, true);
    dv.setUint32(14, crc, true);
    dv.setUint32(18, f.data.length, true);
    dv.setUint32(22, f.data.length, true);
    dv.setUint16(26, nameBytes.length, true);
    dv.setUint16(28, 0, true);
    local.set(nameBytes, 30);
    parts.push(local, f.data);

    const cen = new Uint8Array(46 + nameBytes.length);
    const cdv = new DataView(cen.buffer);
    cdv.setUint32(0, 0x02014b50, true);
    cdv.setUint16(4, 20, true);
    cdv.setUint16(6, 20, true);
    cdv.setUint16(8, 0, true);
    cdv.setUint16(10, 0, true);
    cdv.setUint16(12, 0, true);
    cdv.setUint16(14, 0, true);
    cdv.setUint32(16, crc, true);
    cdv.setUint32(20, f.data.length, true);
    cdv.setUint32(24, f.data.length, true);
    cdv.setUint16(28, nameBytes.length, true);
    cdv.setUint32(42, offset, true);
    cen.set(nameBytes, 46);
    central.push(cen);

    offset += local.length + f.data.length;
  }

  const centralSize = central.reduce((s, c) => s + c.length, 0);
  const end = new Uint8Array(22);
  const edv = new DataView(end.buffer);
  edv.setUint32(0, 0x06054b50, true);
  edv.setUint16(8, files.length, true);
  edv.setUint16(10, files.length, true);
  edv.setUint32(12, centralSize, true);
  edv.setUint32(16, offset, true);

  return new Blob([...parts, ...central, end], { type: 'application/zip' });
}

export function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export const slug = s =>
  String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48);
