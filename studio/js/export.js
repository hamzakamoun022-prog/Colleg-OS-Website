// Export.
//
// Video capture uses `canvas.captureStream(0)` and pushes exactly one frame per
// output frame via `requestFrame()`, paced against the wall clock. That gives a
// deterministic frame sequence — no duplicated or dropped frames when rendering
// runs faster than real time — while still letting the audio track ride along in
// sync, which is what a plain realtime capture cannot guarantee.

import { totalDuration } from './engine.js';
import { renderScoreToWav, renderScoreToBuffer } from './audio.js';
import { fmtTime, stripMarkup } from './util.js';
import { Muxer as WebMMuxer, ArrayBufferTarget as WebMTarget } from './vendor/webm-muxer.mjs';
import { Muxer as MP4Muxer, ArrayBufferTarget as MP4Target } from './vendor/mp4-muxer.mjs';

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

/* ------------------------------------------------------------------ */
/* WebCodecs export                                                    */
/*                                                                     */
/* MediaRecorder records; WebCodecs encodes. The difference decides     */
/* everything about a canvas export.                                    */
/*                                                                     */
/* A recorder is wired to a live stream, so a frame that takes 120ms to */
/* draw is a frame that arrives late, and the only two outcomes are a   */
/* stretched timeline or a dropped frame. On a laptop with a busy GPU   */
/* — or any machine rendering 1080×1920 with motion blur — that is most */
/* frames. An encoder takes (frame, timestamp) pairs at whatever rate   */
/* you can produce them and writes exactly the video you asked for.     */
/*                                                                     */
/* It also encodes the audio from an offline render rather than playing */
/* it, and reports its real codec, so the container can never disagree  */
/* with its contents.                                                   */
/* ------------------------------------------------------------------ */

export const webcodecsSupported = () =>
  typeof window !== 'undefined' && 'VideoEncoder' in window && 'AudioEncoder' in window;

const H264_CANDIDATES = ['avc1.640033', 'avc1.640028', 'avc1.4d0028', 'avc1.42001f'];

/**
 * The best (codec, container) pair this browser can actually encode.
 *
 * H.264 in MP4 is what ad platforms and editors want, so it's tried first and
 * verified with `isConfigSupported` rather than assumed.
 */
export async function pickEncoding(width, height, fps) {
  if (!webcodecsSupported()) return null;
  // VP9 buys roughly a third off H.264 at the same perceived quality, so it
  // does not need the same budget.
  const rate = k => Math.round(width * height * fps * k);
  const base = { width, height, framerate: fps, bitrate: rate(0.11) };

  for (const codec of H264_CANDIDATES) {
    try {
      const s = await VideoEncoder.isConfigSupported({ ...base, codec, avc: { format: 'avc' } });
      if (s.supported) {
        const aac = await AudioEncoder.isConfigSupported({
          codec: 'mp4a.40.2', sampleRate: 48000, numberOfChannels: 2, bitrate: 160000,
        }).catch(() => ({ supported: false }));
        return {
          container: 'mp4', video: codec, audio: aac.supported ? 'mp4a.40.2' : 'opus',
          label: 'H.264', ok: true, extra: { avc: { format: 'avc' } }, bitrate: rate(0.11),
        };
      }
    } catch { /* try the next profile */ }
  }

  for (const [codec, label] of [['vp09.00.10.08', 'VP9'], ['vp8', 'VP8']]) {
    try {
      const s = await VideoEncoder.isConfigSupported({ ...base, codec });
      if (s.supported) {
        return { container: 'webm', video: codec, audio: 'opus', label, ok: false,
                 extra: {}, bitrate: rate(codec === 'vp8' ? 0.10 : 0.07) };
      }
    } catch { /* keep looking */ }
  }
  return null;
}

/**
 * Render a storyboard to a video Blob with WebCodecs. Not real time — this
 * runs as fast as the machine can draw, and the output frame rate is exact
 * either way.
 */
export async function exportVideoFast(o) {
  const {
    canvas, renderer, board, assets, fps = 30, audio,
    onProgress = () => {}, signal,
  } = o;

  const ctx = canvas.getContext('2d');
  const duration = totalDuration(board);
  const frames = Math.max(1, Math.round(duration * fps));
  const enc = await pickEncoding(canvas.width, canvas.height, fps);
  if (!enc) throw new Error('This browser cannot encode video with WebCodecs.');

  // Audio first: it is quick, and a failure here should not waste a render.
  let audioBuffer = null;
  if (audio && (audio.style !== 'none' || audio.voice?.buffer)) {
    audioBuffer = await renderScoreToBuffer({ ...audio, duration, cuts: cutTimes(board) });
  }
  // The offline render leaves 1.2s of tail for reverb and release. Encoding all
  // of it makes the file outlast its own last frame, which reads as a hang at
  // the end of the ad. Keep a short tail and fade it out.
  const audioFrames = audioBuffer
    ? Math.min(audioBuffer.length, Math.ceil((duration + 0.25) * audioBuffer.sampleRate))
    : 0;

  const target = enc.container === 'mp4' ? new MP4Target() : new WebMTarget();
  const Muxer = enc.container === 'mp4' ? MP4Muxer : WebMMuxer;
  const muxer = new Muxer({
    target,
    video: {
      codec: enc.container === 'mp4' ? 'avc' : (enc.video.startsWith('vp09') ? 'V_VP9' : 'V_VP8'),
      width: canvas.width, height: canvas.height, frameRate: fps,
    },
    audio: audioBuffer ? {
      codec: enc.audio === 'mp4a.40.2' ? 'aac' : (enc.container === 'mp4' ? 'opus' : 'A_OPUS'),
      numberOfChannels: 2, sampleRate: audioBuffer.sampleRate,
    } : undefined,
    fastStart: enc.container === 'mp4' ? 'in-memory' : undefined,
  });

  const errors = [];
  const videoEncoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: e => errors.push(e),
  });
  videoEncoder.configure({
    codec: enc.video, width: canvas.width, height: canvas.height,
    framerate: fps, bitrate: enc.bitrate,
    ...enc.extra,
  });

  const frameUs = 1e6 / fps;
  for (let i = 0; i < frames; i++) {
    if (signal?.aborted) break;
    renderer.render(ctx, board, i / fps, { assets, quality: 'hd' });
    const frame = new VideoFrame(canvas, { timestamp: Math.round(i * frameUs), duration: Math.round(frameUs) });
    // A keyframe every two seconds keeps scrubbing responsive without
    // inflating the file the way an all-intra stream would.
    videoEncoder.encode(frame, { keyFrame: i % (fps * 2) === 0 });
    frame.close();

    // The encoder queue is where memory goes if the renderer outruns it.
    if (videoEncoder.encodeQueueSize > 12) {
      while (videoEncoder.encodeQueueSize > 6) await sleep(4);
    }
    if (i % 4 === 0) { await nextFrame(); onProgress(i / frames, { frame: i, frames, stage: 'video' }); }
  }
  await videoEncoder.flush();
  videoEncoder.close();

  if (audioBuffer) {
    const audioEncoder = new AudioEncoder({
      output: (chunk, meta) => muxer.addAudioChunk(chunk, meta),
      error: e => errors.push(e),
    });
    audioEncoder.configure({
      codec: enc.audio, sampleRate: audioBuffer.sampleRate, numberOfChannels: 2, bitrate: 160000,
    });

    // AudioData wants interleaved or planar frames; planar f32 matches what an
    // AudioBuffer already holds, so no conversion beyond the copy.
    const sr = audioBuffer.sampleRate;
    const chunkFrames = 4096;
    const left = audioBuffer.getChannelData(0);
    const right = audioBuffer.numberOfChannels > 1 ? audioBuffer.getChannelData(1) : left;
    const fade = Math.round(0.12 * sr);
    for (let off = 0; off < audioFrames; off += chunkFrames) {
      const n = Math.min(chunkFrames, audioFrames - off);
      const data = new Float32Array(n * 2);
      data.set(left.subarray(off, off + n), 0);
      data.set(right.subarray(off, off + n), n);
      for (let i = 0; i < n; i++) {
        const left2end = audioFrames - (off + i);
        if (left2end >= fade) break;
        const g = left2end / fade;
        data[i] *= g;
        data[n + i] *= g;
      }
      const ad = new AudioData({
        format: 'f32-planar', sampleRate: sr, numberOfFrames: n, numberOfChannels: 2,
        timestamp: Math.round((off / sr) * 1e6), data,
      });
      audioEncoder.encode(ad);
      ad.close();
      if (audioEncoder.encodeQueueSize > 20) {
        while (audioEncoder.encodeQueueSize > 8) await sleep(2);
      }
    }
    await audioEncoder.flush();
    audioEncoder.close();
  }

  muxer.finalize();
  if (errors.length) throw errors[0];

  const mime = enc.container === 'mp4' ? 'video/mp4' : 'video/webm';
  const blob = new Blob([target.buffer], { type: mime });
  onProgress(1, { frame: frames, frames, stage: 'done' });
  return {
    blob, mime, frames, slowFrames: 0, dropped: 0, stretch: 1, remuxed: null, encoder: 'webcodecs',
    codec: { codec: enc.video, label: enc.label, ok: enc.ok, audio: !!audioBuffer },
  };
}

/**
 * Render a storyboard to a video Blob.
 *
 * @param {object} o
 *   canvas, renderer, board, assets, fps, bitrate, player (ScorePlayer),
 *   audio {style,bpm,seed,volume}, onProgress(0..1, stats), signal
 */
export async function exportVideo(o) {
  // WebCodecs is strictly better where it exists; MediaRecorder is the
  // fallback for browsers that don't have it yet.
  if (webcodecsSupported() && o.encoder !== 'recorder') {
    try {
      return await exportVideoFast(o);
    } catch (err) {
      if (o.onNotice) o.onNotice(`WebCodecs export failed (${err.message || err}) — falling back to the recorder.`);
    }
  }
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

/** True when this page is inside a frame, including a cross-origin one. */
export function inFrame() {
  try { return window.self !== window.top; } catch { return true; }
}

/**
 * Hand the file to the browser.
 *
 * `<a download>` is silently ignored inside a sandboxed iframe unless the
 * embedder set `allow-downloads` — no error, no event, the tap just does
 * nothing, which is precisely what "the download button doesn't work" looks
 * like. Any embedded copy of this page is in that position.
 *
 * Opening the blob in a tab of its own is the way out: the file is then a
 * normal document and the browser's own save UI takes over. On iOS that means
 * the video plays with the share button available; on desktop the tab offers a
 * download. Where the page is not framed, the anchor is still the better
 * experience, because it keeps the filename.
 *
 * @returns {'downloaded'|'opened'|'blocked'}
 */
export function download(blob, filename) {
  const url = URL.createObjectURL(blob);

  if (inFrame()) {
    const w = window.open(url, '_blank');
    if (w) {
      // The tab is reading from this URL — revoking it now would blank it.
      setTimeout(() => URL.revokeObjectURL(url), 10 * 60 * 1000);
      return 'opened';
    }
    // Popups blocked too. Nothing left that a framed page is allowed to do.
    URL.revokeObjectURL(url);
    return 'blocked';
  }

  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  return 'downloaded';
}

/**
 * Whether a file is one every phone, editor and ad platform will take.
 *
 * H.264 in an MP4 is the only universally safe answer. A VP9 WebM downloads
 * and plays in a browser, but iOS Photos will not import it and most upload
 * forms reject it, so it is worth knowing which one you have.
 */
export const universallyPlayable = codec =>
  !!codec && (codec.codec === 'h264' || codec.codec === 'hevc');

export const slug = s =>
  String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48);
