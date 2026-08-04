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

## Writing copy with Claude

Paste an Anthropic API key into the brief panel and *Write copy with Claude*
replaces the built-in copy banks with fresh writing for your specific brief. The
key is stored in your browser's localStorage and sent only to
`api.anthropic.com` — it never touches this repo or any server of ours.

Without a key everything still works; copy comes from the built-in banks, which
are seeded so each generation is different but reproducible.

## Export notes

Video is captured by pushing exactly one frame per output frame through
`canvas.captureStream(0)`, paced against the wall clock. That avoids the dropped
and duplicated frames you get from a naive realtime capture, and keeps the
procedural score in sync.

The recorder timestamps frames as they arrive, so the file's length is wall
time — not frame count. If a frame comes due late the studio skips to the frame
that is due *now* rather than rendering every frame however long it takes. A
dropped frame costs some smoothness; falling behind would stretch the video past
the end of the music, which costs the whole edit. Before recording starts it
times three real frames and drops motion-blur sampling up front if the machine
can't sustain the frame rate.

Three things worth knowing:

- **Keep the tab in front while exporting.** Background tabs get throttled and
  the capture stretches.
- **You may get a `.webm`, not an `.mp4`.** Some Chromium builds report
  `video/mp4;codecs=avc1,mp4a` as supported and then encode VP9 video and Opus
  audio into the MP4 container. That file has a real audio track but QuickTime,
  iOS and most editors either refuse it or play it silently. The studio records
  a fraction of a second first, reads what actually came out, and falls back to
  a correctly named WebM when the MP4 is a lie. WebM with VP9 and Opus plays
  properly, with sound. Re-encode to H.264 if an ad platform insists on MP4.
- **The completion message reports what's really in the file** — the video
  codec, whether an audio track made it in, and the container.

If more than about 15% of frames had to be dropped, the studio says so. Drop to
720p or 30 fps and re-export.

## Layout

```
studio/
  index.html      shell and all styling
  js/
    brand.js      palette, fonts, formats, grades — mirrored from the landing page
    util.js       easing, seeded RNG, noise, colour, text layout
    motion.js     17 camera presets, each a pure function of shot progress
    scenes.js     19 scene painters (product pages, problem shots, offer cards)
    engine.js     plate → camera → grade → type → transition, one frame at a time
    director.js   brief → storyboard; copy banks and the optional Claude path
    audio.js      procedural score, beat-locked to the cut, plus WAV render
    export.js     frame-paced capture, stills, ZIP, script, captions
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
