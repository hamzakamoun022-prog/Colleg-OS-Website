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

Keyboard: space plays/pauses, arrow keys step a frame (hold shift for a second).

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

Two things worth knowing:

- **Keep the tab in front while exporting.** Background tabs get throttled and
  the capture stretches.
- **Check the codec in the completion message.** Some Chromium builds accept a
  request for `video/mp4;codecs=avc1` and then encode VP9 into the MP4 container
  anyway. The studio sniffs what was actually written and tells you. VP9-in-MP4
  plays fine in browsers but some editors and ad platforms reject it — re-encode
  if you're handing the file to an editor.

If more than about 10% of frames render slower than real time, the studio says
so. Drop to 30 fps or 1080p and re-export.

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
