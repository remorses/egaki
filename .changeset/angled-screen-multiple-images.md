---
'@egaki/angled-screen': minor
---

Render several screenshots on one tilted plane: `angled-screen home.png download.png --content-width 1.7`. Screens sit in a row with `--gap` between them, and a `--content-width` above 1 grows the plane past the frame, so the camera can sit further back and thin sites still fill the image. `renderImage` now takes `images: [...]` instead of `image`. The package also ships an `angled-screen` agent skill with tested settings.
