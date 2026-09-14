/**
 * PostCSS config for Tailwind CSS v4.
 *
 * Tailwind 4 moved the PostCSS plugin into `@tailwindcss/postcss`; there is no
 * `tailwind.config.js` any more — the theme lives in CSS (see
 * `@medichain/config/tailwind/theme.css`).
 */
const config = {
  plugins: {
    '@tailwindcss/postcss': {},
  },
};

export default config;
