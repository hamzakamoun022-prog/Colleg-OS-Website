// Voiceover.
//
// Two sources, because no single one does both jobs:
//
//   'system'  the browser's own speechSynthesis. On a Mac these are the best
//             voices you have access to for free, but Chrome routes them
//             straight to the sound card — they cannot be captured into a
//             MediaRecorder, so they are a monitoring aid only.
//
//   'track'   an audio file you supply. Decoded to an AudioBuffer and played
//             on the score bus, so it is genuinely inside the exported video.
//             Any TTS or a real recording works; macOS `say -o` is one line.
//
// Both read the same timed script, derived from the storyboard, so what you
// hear in preview matches what you bake in.

import { stripMarkup } from './util.js';

/**
 * The words for each shot, with the time they should start.
 *
 * On-screen copy is the spine — it is already written to be said out loud.
 * The kicker is a label, not a sentence, so it only speaks when a shot has no
 * copy of its own and would otherwise pass in silence.
 */
export function voiceScript(board) {
  const lines = [];
  let acc = 0;
  for (const s of board.scenes || []) {
    const said = (s.text || []).map(t => stripMarkup(t.text)).filter(Boolean).join(' ');
    const text = said || (s.kicker ? stripMarkup(s.kicker) : '');
    if (text) lines.push({ at: acc, dur: s.dur, text: text.replace(/\s+/g, ' ').trim() });
    acc += s.dur;
  }
  return lines;
}

/** The script as plain text, for pasting into whatever TTS you prefer. */
export function voiceScriptText(board) {
  const out = ['# College OS — voiceover script', `# ${board.title}`, ''];
  for (const l of voiceScript(board)) {
    out.push(`[${l.at.toFixed(2)}s] ${l.text}`);
  }
  out.push('');
  out.push('# One line per shot, timestamped from the start of the ad.');
  out.push('# macOS: strip the timestamps and run');
  out.push('#   say -v Samantha -r 180 -o voice.aiff -f script.txt');
  out.push('# then load the file back in as the voice track.');
  return new Blob([out.join('\n')], { type: 'text/plain' });
}

/* ------------------------------------------------------------------ */
/* System voice (preview only)                                         */
/* ------------------------------------------------------------------ */

export const speechSupported = () =>
  typeof window !== 'undefined' && 'speechSynthesis' in window;

/**
 * Installed voices, English first.
 *
 * Chrome populates the list asynchronously and fires `voiceschanged` once it
 * has; called too early it returns an empty array and never retries, which is
 * the usual reason a voice picker shows up blank.
 */
export function listVoices() {
  if (!speechSupported()) return Promise.resolve([]);
  const read = () => window.speechSynthesis.getVoices()
    .filter(v => /^en/i.test(v.lang))
    .concat(window.speechSynthesis.getVoices().filter(v => !/^en/i.test(v.lang)));

  const now = read();
  if (now.length) return Promise.resolve(now);
  return new Promise(resolve => {
    const done = () => { window.speechSynthesis.removeEventListener('voiceschanged', done); resolve(read()); };
    window.speechSynthesis.addEventListener('voiceschanged', done);
    setTimeout(done, 1200);
  });
}

export class SystemVoice {
  constructor() {
    this.timers = [];
    this.voiceURI = '';
    this.rate = 1.0;
    this.pitch = 1.0;
    this.volume = 1.0;
  }

  /** Speak `lines` as the preview passes them, starting `offset` seconds in. */
  start(lines, offset = 0) {
    this.stop();
    if (!speechSupported()) return;
    const voice = window.speechSynthesis.getVoices().find(v => v.voiceURI === this.voiceURI);
    for (const l of lines) {
      const delay = (l.at - offset) * 1000;
      // A line the playhead is already past would otherwise all fire at once.
      if (delay < -250) continue;
      this.timers.push(setTimeout(() => {
        const u = new SpeechSynthesisUtterance(l.text);
        if (voice) { u.voice = voice; u.lang = voice.lang; }
        u.rate = this.rate;
        u.pitch = this.pitch;
        u.volume = this.volume;
        window.speechSynthesis.speak(u);
      }, Math.max(0, delay)));
    }
  }

  stop() {
    this.timers.forEach(clearTimeout);
    this.timers = [];
    if (speechSupported()) window.speechSynthesis.cancel();
  }
}

/* ------------------------------------------------------------------ */
/* Voice track (bakes into exports)                                    */
/* ------------------------------------------------------------------ */

/** Decode a user-supplied audio file into an AudioBuffer. */
export async function decodeVoiceTrack(file, ctx) {
  const data = await file.arrayBuffer();
  // decodeAudioData wants its own copy; it detaches the buffer it is given.
  return new Promise((resolve, reject) => {
    ctx.decodeAudioData(data.slice(0), resolve,
      () => reject(new Error('Could not decode that file. Try a WAV, MP3, M4A or AIFF.')));
  });
}

/**
 * Schedule a voice track, ducking whatever else is on `duckTarget`.
 *
 * Speech and a music bed occupy the same midrange, so without ducking the two
 * mask each other and the words stop landing. Pulling the music down ~9 dB for
 * the length of the take is what makes a voiceover read as narration rather
 * than as a second instrument.
 */
export function scheduleVoice(ctx, destination, buffer, o = {}) {
  const t0 = o.t0 ?? 0;
  const at = t0 + (o.at ?? 0);
  const gain = ctx.createGain();
  gain.gain.value = o.volume ?? 1.0;

  // Presence lift — formant TTS and phone recordings both sit better with the
  // low rumble out of the way and a touch of upper mid.
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 90;
  const presence = ctx.createBiquadFilter();
  presence.type = 'peaking';
  presence.frequency.value = 2600;
  presence.Q.value = 0.9;
  presence.gain.value = 3.2;

  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.connect(hp);
  hp.connect(presence);
  presence.connect(gain);
  gain.connect(destination);

  const start = Math.max(at, ctx.currentTime);
  const skip = Math.max(0, start - at);
  if (skip < buffer.duration) src.start(start, skip);

  if (o.duckTarget && (o.duck ?? 0.35) > 0) {
    const d = o.duck ?? 0.35;
    const base = o.duckTarget.gain.value;
    const end = Math.min(at + buffer.duration, at + (o.duration ?? buffer.duration));
    const g = o.duckTarget.gain;
    g.setValueAtTime(base, Math.max(ctx.currentTime, at - 0.25));
    g.linearRampToValueAtTime(base * (1 - d), Math.max(ctx.currentTime, at + 0.12));
    g.setValueAtTime(base * (1 - d), Math.max(ctx.currentTime, end - 0.3));
    g.linearRampToValueAtTime(base, Math.max(ctx.currentTime + 0.01, end + 0.45));
  }

  return { source: src, gain };
}
