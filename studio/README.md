# College OS — Ad Studio

A browser-based generator for College OS video ads. Open `studio/index.html`
(served over HTTP — it uses ES modules) and everything runs client-side: no
build step, no dependencies, no backend.

Live at `getcollegeos.com/studio/`. It's `noindex` and unlinked from the sales
page — it's an internal marketing tool, not part of the product.

## What it does

You write a one-line brief — angle, structure, length, format — and it produces
a shot-by-shot ad you can play, edit, and export. Nothing is pre-rendered: every
frame is drawn live from the storyboard, so any shot stays editable right up to
the moment you export.

The product screens in the ads are **vector recreations** of the real Notion
pages, not screenshots. That means they stay sharp at any resolution and they can
animate — the exam countdown ticks from 15 to 14 on camera, the donut chart draws
itself, a kanban card slides into Done. The four real screenshots pulled from the
landing page are used inside the device mockups, where authenticity matters more
than resolution.

## Making an ad

1. **Brief** — pick an angle (missed deadlines, money stress, app overload,
   burnout, grades, aesthetic), a structure, a length, and an aspect ratio.
   Optionally star the feature screens you want prioritised.
2. **Generate** — you get a complete storyboard. *New copy* rewrites the words
   over the same cut; *New cut* reshoots the whole thing.
3. **Edit** — click any shot in the timeline. Swap the visual, change the camera
   move and its intensity, retime it, change the transition, rewrite the
   on-screen copy. Wrap a word in `*asterisks*` to highlight it in the accent
   colour.
4. **Export** — video, per-shot stills, the score as WAV, the script, or
   WebVTT captions.
5. **Browse** — the strip under the preview has two tabs. *Timeline* is the
   shot list for the ad you're editing; *Library* is everything you've made
   this session. Click a saved cut to reopen it — its format, arc, grade and
   every shot edit come back with it — or click an export to watch it in place
   with sound and re-download it. The library holds the last 24 items and lives
   in memory, so it's gone when you close the tab; anything you want to keep,
   export.

Keyboard: space plays/pauses, arrow keys step a frame (hold shift for a
second), `m` mutes the score, escape closes the video viewer.

## Sound

Every ad has a procedural score, beat-locked to the cuts, chosen with the
*Music* control. The speaker in the transport bar sets the monitoring level —
it never affects the export, so you can work muted and still ship an ad with
music.

Browsers only allow audio to start from a click, so the score begins on the
first play. In a cross-origin frame embedded without the `autoplay` permission
it can't start at all; the studio detects that and says so under the transport
rather than playing silently. The score is still written into every export, and
*Audio .wav* renders it offline regardless.

### Voiceover

The *Voiceover* control has two sources, because no single one does both jobs.

**System voice** speaks the script through the browser's own `speechSynthesis`.
On a Mac those are the best voices you have for free — but Chrome routes them
straight to the sound card, and a page cannot record them. It is for
auditioning the script and its timing; exports stay music-only.

**Voice track** takes an audio file, mixes it in properly — ducking the music
about 9 dB underneath, with a high-pass and a presence lift so the words sit
forward — and writes it into every export. Any source works.

The workflow is: pick an angle, generate, hit *Voiceover script .txt*, and you
get one timestamped line per shot. Feed that to whatever text-to-speech you
prefer and load the audio back in. On macOS that is one command:

```sh
say -v Samantha -r 175 -o voice.aiff -f script.txt
```

Both sources read the same script, derived from each shot's on-screen copy — so
what you audition is what you bake in. *Voice level* and *Duck the music under
it* set the balance.

## Writing copy with Claude

Paste an Anthropic API key into the brief panel and *Write copy with Claude*
replaces the built-in copy banks with fresh writing for your specific brief. The
key is stored in your browser's localStorage and sent only to
`api.anthropic.com` — it never touches this repo or any server of ours.

Without a key everything still works; copy comes from the built-in banks, which
are seeded so each generation is different but reproducible.

## Export notes

Video is **encoded**, not recorded. `VideoEncoder` (WebCodecs) takes
(frame, timestamp) pairs at whatever rate the machine can draw them and writes
exactly the video you asked for, so a slow render produces a slow *export* —
never a slow, stuttering, or stretched *file*. Audio is rendered offline and
encoded the same way, so it cannot drift.

That matters more than it sounds. The old path wired a `MediaRecorder` to a live
canvas stream, which timestamps frames as they arrive. A 1080×1920 frame with
motion blur takes well over 33ms to draw on a machine without a spare GPU, so
most frames arrived late and the only outcomes were a stretched timeline or a
dropped frame. On one test box a 9.4-second ad came out as a 26.5-second file
whose music stopped a third of the way through.

- **You get a real H.264 MP4 wherever the browser can encode one.** The studio
  asks `VideoEncoder.isConfigSupported` for each H.264 profile in turn and only
  claims MP4 when one actually works, falling back to VP9-in-WebM otherwise.
  Nothing is ever labelled `.mp4` unless it really is one.
- **The completion message reports what's really in the file** — codec, whether
  an audio track made it in, and the container. The Export panel says which
  you'll get *before* you render, since it decides where the file can go.
- Browsers without WebCodecs fall back to the `MediaRecorder` path, which is
  still real time. There the studio paces to the wall clock, skips to the frame
  that is due *now* when it falls behind, and probes what the browser actually
  encodes before trusting an `isTypeSupported` answer for MP4. Keep the tab in
  front — background tabs get throttled. If more than about 15% of frames had to
  be dropped it says so; drop to 720p or 30 fps and re-export.

### Where the file goes

Export downloads the file, and nothing else — on a phone that means Files, in
the browser's downloads folder. There is deliberately no share sheet: it is an
extra tap on every export, and on iOS it can only be raised from a gesture that
is still active, which a render outlasts.

**Run it from a real URL.** A sandboxed iframe silently ignores `<a download>`
unless the embedder set `allow-downloads` — no error, no event, the tap simply
does nothing. Any embedded copy of this page is in that position. When the
studio detects it is framed it opens the finished video in a tab of its own
instead, where the browser's normal save UI applies, but that is a workaround.
Served from `getcollegeos.com/studio/` — or any plain URL — the download button
is just a download button.

Photos is a separate matter. iOS only imports **H.264 in an MP4**, so if you
want a clip in the camera roll you need an export this browser could encode as
H.264 — save it to Files first, then add it to Photos from there. The Export
panel says which of the two you will get *before* you render, since some
Chromium builds can only manage VP9. Those files download and play fine, but
several editors and upload forms will refuse them.

The two muxers that turn encoded chunks into a playable file are vendored under
`js/vendor/` — see the README there.

## Layout

```
studio/
  index.html      shell and all styling
  js/
    brand.js      palette, fonts, formats, grades — mirrored from the landing page
    util.js       easing, seeded RNG, noise, colour, text layout
    motion.js     17 camera presets, each a pure function of shot progress
    scenes.js     21 scene painters (product pages, problem shots, device shots)
    engine.js     plate → camera → grade → type → transition, one frame at a time
    director.js   brief → storyboard; copy banks and the optional Claude path
    audio.js      procedural score, beat-locked to the cut, plus WAV render
    voice.js      voiceover: timed script, system speech, voice-track mixing
    export.js     WebCodecs encode (recorder fallback), stills, ZIP, script, captions
    vendor/       webm-muxer + mp4-muxer (MIT), the only third-party code
    app.js        state, playback, timeline, inspector, export wiring
  assets/         real product screenshots, extracted from the landing page
```

## Extending it

**A new product screen** — add a painter to `scenes.js` and register it in
`SCENES`. It receives `(ctx, W, H, p, opts)` where `p` is 0..1 through the shot;
lay out against `pageFrame()` so it inherits the safe bands that keep the kicker
and caption from colliding with it.

**A new camera move** — add an entry to `MOTIONS` in `motion.js`. Express the
framing zoom as `1 + base * a.k` so the intensity slider genuinely scales the
crop, and keep translations in fractions of the frame.

**A new ad structure** — add an arc to `ARCS` in `director.js`: a list of beats
plus relative weights. Durations are distributed by weight and then snapped to
the music grid, so cuts land on the beat.
