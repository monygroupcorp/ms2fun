# Brand assets

Announcement stills and the motion piece, rendered from the app's own design tokens
(`app/src/styles/noesis/theme.css`) rather than from an approximation of them: Syne display,
Archivo body, IBM Plex Mono, pure monochrome, and chromatic aberration as the single sanctioned
exception at ±2px (medium) or ±3px (strong).

## Rendering

```sh
node tools/brand/render.mjs
ffmpeg -y -framerate 30 -i tools/brand/out/frames/%04d.png \
  -c:v libx264 -preset slow -crf 17 -pix_fmt yuv420p -movflags +faststart \
  tools/brand/out/noesis-mainliner.mp4
```

Needs `@playwright/test` (already an app dependency). If the installed browser revision does not
match the pinned playwright, point `PLAYWRIGHT_CHROMIUM` at a Chromium binary rather than
installing a second one.

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
