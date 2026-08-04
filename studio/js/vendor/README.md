# Vendored dependencies

The studio has no build step and no package manager, so its two third-party
files live here as shipped ES modules.

| File               | Package             | Version | Licence |
| ------------------ | ------------------- | ------- | ------- |
| `webm-muxer.mjs`   | `webm-muxer` (npm)  | 5.1.4   | MIT     |
| `mp4-muxer.mjs`    | `mp4-muxer` (npm)   | 5.2.2   | MIT     |

Both are by Vanilagy. Licence texts are alongside as `LICENSE.*`.

They take the encoded chunks that `VideoEncoder` and `AudioEncoder` (WebCodecs)
produce and write a playable container around them. WebCodecs itself encodes
as fast as the machine manages rather than in real time, which is the whole
reason the studio uses it in preference to `MediaRecorder` — see the comments
at the top of `../export.js`.

To update: `npm pack <name>@<version>`, unpack, and copy `build/<name>.mjs`
plus `LICENSE` here. Nothing else in the studio imports them.
