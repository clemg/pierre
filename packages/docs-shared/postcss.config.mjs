// Shared PostCSS config for both docs apps. Each app's
// `postcss.config.mjs` re-exports this so the docs site CSS pipeline stays
// consistent without duplicating the plugin set.
const config = {
  plugins: {
    'postcss-import': {},
    '@tailwindcss/postcss': {},
  },
};

export default config;
