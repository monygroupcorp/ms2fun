# Brand assets

Announcement stills and the motion piece, rendered from the app's own design tokens
(`app/src/styles/noesis/theme.css`) rather than from an approximation of them: Syne display,
Archivo body, IBM Plex Mono, pure monochrome, and chromatic aberration as the single sanctioned
exception at ±2px (medium) or ±3px (strong).

## Rendering

```sh
node tools/brand/render.mjs                       # stills + frames -> tools/brand/out/
ffmpeg -y -framerate 30 -i tools/brand/out/frames/%04d.png \
  -f lavfi -i anullsrc=channel_layout=stereo:sample_rate=44100 \
  -c:v libx264 -profile:v main -level 3.1 -preset slow -crf 18 \
  -pix_fmt yuv420p -color_primaries bt709 -color_trc bt709 -colorspace bt709 \
  -c:a aac -b:a 96k -shortest -movflags +faststart \
  tools/brand/assets/noesis-mainliner.mp4
cp tools/brand/out/noesis-*.png tools/brand/assets/
```

`out/` is scratch and is gitignored repo-wide; `assets/` is what ships and is tracked.

## Why the encode is so conservative

Main profile, level 3.1, `yuv420p`, explicit bt709 tagging, `+faststart`, and **a silent AAC track**.
None of that is for quality — it is the widest profile that uploaders and mobile players all accept.
A video with no audio stream at all is rejected outright by several of them rather than played muted,
which is the kind of thing you discover after you have published the link.

Needs `@playwright/test` (already an app dependency). If the installed browser revision does not
match the pinned playwright, point `PLAYWRIGHT_CHROMIUM` at a Chromium binary rather than
installing a second one.

## Why the finished files are committed

Because an asset nobody can reach is not an asset. The person posting these is usually on a phone,
and a phone can open a URL — it cannot open a file on a laptop, and iOS will not download a `data:`
URI at all, so embedding them in a page does not substitute for this. The set is ~1.5MB and changes
about as often as the brand does. The 372 intermediate frames stay out: those are real build output
and they are 40MB.

## Why the scene is time-driven

`scene.html` exposes `window.setT(seconds)` and does its own interpolation. Nothing animates on a
CSS timeline, because a renderer that screenshots a running animation samples wherever the clock
happened to be — the same input gives different frames. Seeking explicitly makes the render
reproducible and lets a single frame be inspected without scrubbing a video.

## Rules these files encode

- **One chromatic moment per surface**, display type only, never body copy.
- **The wordmark stays clean.** Chroma is for an accent word, not the brand.
- **No accent hue.** Ink is the accent; the art brings the colour.
- Numbers on a card track `RevenueSplitLib` (1/19/80, no setter). If a card and the contract ever
  disagree, the card is wrong.
