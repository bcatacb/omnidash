# Discord-language design token pack

A portable, build-free theme pack that gives any React+Vite+Radix+Tailwind
app a Discord-style look and feel. Tokens are CSS variables; the Tailwind
preset maps utilities onto them so light/dark flips for free.

> Legal: this pack ships **only** color tokens, layout patterns and
> Radix-based component recipes. No Discord logo, wordmark, or
> brand-resource assets are included.

## What's in the box

```
theme/
├── README.md                   # you are here
├── tokens.css                  # all CSS vars (dark default + .light variant)
├── tailwind.preset.js          # Tailwind v3+ preset (colors, fonts, radii, motion)
├── fonts/
│   ├── inter.css               # @font-face for Inter Variable (self-hosted)
│   ├── fetch-fonts.sh          # one-liner: download woff2 from fontsource
│   └── README.md
├── components/
│   ├── Button.tsx              # primary / secondary / danger / ghost
│   ├── Dialog.tsx              # Radix Dialog wrapper
│   ├── Input.tsx               # text input
│   ├── Tabs.tsx                # Radix Tabs wrapper
│   └── Toast.tsx               # Radix Toast wrapper
└── preview/
    ├── index.html              # open in a browser to see the theme
    └── README.md
```

## Token surface

| Layer            | Token                  | Value     |
|------------------|------------------------|-----------|
| Background       | `--bg-floating`        | `#111214` |
|                  | `--bg-tertiary`        | `#1E1F22` |
|                  | `--bg-secondary`       | `#2B2D31` |
|                  | `--bg-primary`         | `#313338` |
|                  | `--bg-message-hover`   | `#2E3035` |
| Brand            | `--brand`              | `#5865F2` |
|                  | `--brand-hover`        | `#4752C4` |
| Status           | `--green` / `--yellow` / `--red` | online / idle / danger |
| Text             | `--text-normal`        | `#DBDEE1` |
|                  | `--text-muted`         | `#949BA4` |
|                  | `--text-link`          | `#00A8FC` |
| Radius           | `--radius-chip` / `--radius-card` / `--radius-modal` | 4 / 8 / 16 px |
| Motion           | `--motion-hover` / `--motion-press` | 100ms / 150ms |

## Integrate into an existing Vite + Tailwind app

1. **Copy or symlink** this `theme/` folder next to your `app/` (recommended:
   keep it as a sibling so updates stay decoupled). Then:

   ```bash
   # in app/
   ln -s ../theme/tokens.css     src/styles/tokens.css
   ln -s ../theme/fonts/inter.css src/styles/inter.css
   ```

   or just `cp` if you'd rather vendor it.

2. **Import once** from your entry (e.g. `src/main.tsx`):

   ```ts
   import './styles/inter.css';
   import './styles/tokens.css';
   ```

3. **Wire the Tailwind preset** in `app/tailwind.config.js`:

   ```js
   module.exports = {
     presets: [require('../theme/tailwind.preset.js')],
     content: ['./index.html', './src/**/*.{ts,tsx}'],
   };
   ```

4. **Use the utilities**:

   ```tsx
   <button className="bg-brand hover:bg-brand-hover text-white rounded-card
                      h-9 px-4 duration-100 ease-out-discord">
     Save
   </button>
   ```

5. **Self-host Inter** (optional but recommended for prod):

   ```bash
   cd theme/fonts && ./fetch-fonts.sh
   ```

   See `fonts/README.md` for the no-build fallback (`rsms.me/inter`).

## Components

Each file in `components/` is a small, framework-agnostic Radix wrapper.
They depend on `@radix-ui/react-*` packages and the Tailwind preset above
being active; nothing else. Drop them into `app/src/components/ui/` and
import as needed. Every file is under 80 lines on purpose.

## Preview

Open `preview/index.html` in a browser to verify the look. No build needed.

## Light mode

Add the class `light` to your `<html>` (or `<body>`) and every token flips
to its light-surface counterpart. The Tailwind utilities don't need to
change — they resolve via the same CSS vars.
