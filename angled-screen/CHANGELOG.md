# Changelog

## 0.1.0

1. **First release of `@egaki/angled-screen`** — turn screenshots into a tilted 3D screen with depth of field, fog, chromatic aberration and grain, without egaki. It renders in your Chrome through the Playwriter extension and writes PNG, JPG or WebP:

   ```bash
   npx @egaki/angled-screen screenshot.png -o hero.png
   ```

   Web apps can import `renderImage` or `createAngledScreenRenderer` directly.

2. **Several screenshots on one tilted plane** — screens sit in a row with `--gap` between them. A `--content-width` above 1 grows the plane past the frame, so thin sites still fill the image. Empty margins are cropped off each screenshot by default (`--trim-padding`, `--no-trim`, `trimImage()`):

   ```bash
   npx @egaki/angled-screen home.png download.png --content-width 1.7 -o hero.png
   ```

3. **Agent skill included** — the package ships an `angled-screen` skill with tested settings.
