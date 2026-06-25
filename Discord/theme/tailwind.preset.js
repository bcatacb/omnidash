/**
 * Discord-language Tailwind preset.
 *
 * Consume from your app's tailwind.config.js:
 *
 *   module.exports = {
 *     presets: [require('../theme/tailwind.preset.js')],
 *     content: ['./src/**\/*.{ts,tsx,html}'],
 *   };
 *
 * The colors map maps 1:1 to the CSS vars in `tokens.css`,
 * so utilities like `bg-bg-primary` or `text-brand` resolve
 * to `var(--bg-primary)` / `var(--brand)` and automatically
 * flip when the `.light` class is applied to <html>.
 */

/** @type {import('tailwindcss').Config} */
module.exports = {
  theme: {
    extend: {
      colors: {
        bg: {
          floating:      'var(--bg-floating)',
          tertiary:      'var(--bg-tertiary)',
          secondary:     'var(--bg-secondary)',
          primary:       'var(--bg-primary)',
          'message-hover': 'var(--bg-message-hover)',
        },
        brand: {
          DEFAULT: 'var(--brand)',
          hover:   'var(--brand-hover)',
        },
        green:  { DEFAULT: 'var(--green)' },
        yellow: { DEFAULT: 'var(--yellow)' },
        red:    { DEFAULT: 'var(--red)' },
        text: {
          normal: 'var(--text-normal)',
          muted:  'var(--text-muted)',
          link:   'var(--text-link)',
        },
      },
      fontFamily: {
        sans: [
          'Inter var',
          'Inter',
          'system-ui',
          '-apple-system',
          'Segoe UI',
          'Roboto',
          'Helvetica Neue',
          'Arial',
          'sans-serif',
        ],
      },
      borderRadius: {
        chip:  '4px',
        card:  '8px',
        modal: '16px',
      },
      transitionDuration: {
        100: '100ms', // hover
        150: '150ms', // press
      },
      transitionTimingFunction: {
        'out-discord': 'cubic-bezier(0.16, 1, 0.3, 1)',
      },
    },
  },
  plugins: [],
};
