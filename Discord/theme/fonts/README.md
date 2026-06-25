# Inter (variable) self-hosting

`gg sans` is proprietary; we ship **Inter Variable** from
[fontsource](https://fontsource.org/) as the free substitute.

## Option A — fetch the woff2 files locally (recommended for prod)

```bash
cd theme/fonts
chmod +x fetch-fonts.sh
./fetch-fonts.sh
```

This drops two files into `theme/fonts/files/`:

- `inter-latin-wght-normal.woff2`
- `inter-latin-wght-italic.woff2`

`inter.css` already references those paths. Import `inter.css` once
from your app entry (e.g. `main.tsx`) and Inter Variable is wired up.

## Option B — use Google Fonts / rsms.me at runtime

If you don't want to self-host, drop this into your HTML `<head>`
instead of importing `inter.css`:

```html
<link rel="stylesheet" href="https://rsms.me/inter/inter.css">
```

The preview page (`theme/preview/index.html`) does exactly this so it
works without running the fetch script.

## Files

| File              | Purpose                                       |
|-------------------|-----------------------------------------------|
| `inter.css`       | `@font-face` declarations (points to files/)  |
| `fetch-fonts.sh`  | Downloads the woff2 files from fontsource CDN |
| `files/`          | Created by the script; ignored by git ideally |
