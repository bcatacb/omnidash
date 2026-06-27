# Preview

Standalone, build-free preview of the Discord-language design tokens.

## Open it

Just open the file in a browser:

```bash
# macOS
open theme/preview/index.html
# Linux
xdg-open theme/preview/index.html
# Or serve it (recommended so relative ../tokens.css resolves cleanly)
python3 -m http.server -d theme 8080
# then visit http://localhost:8080/preview/
```

## What you'll see

A three-pane "Discord-app" mockup:

- **Server gutter** — 72px wide, `--bg-tertiary`
- **Channel list** — 240px wide, `--bg-secondary`
- **Main panel** — flex 1, `--bg-primary`

Inside the main panel: H1/H2/body text, all four button variants
(primary / secondary / danger / ghost), a text input, a tabs strip,
a dialog mockup on `--bg-floating`, three toast variants, and a
swatch grid of every color token.

## How the fonts work here

This page pulls Inter Variable straight from
`https://rsms.me/inter/inter.css` so it works offline-of-your-build.
The real app should self-host via `theme/fonts/fetch-fonts.sh`
and import `theme/fonts/inter.css`.

## Light mode

To preview the light variant, add `class="light"` to the `<html>`
or `<body>` tag in `index.html`. The tokens flip automatically.
