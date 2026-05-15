// Change these two constants to preview a different Pierre theme locally.
// After changing, hard-reload the page (Cmd+Shift+R) to apply the new theme
// to the file tree, diffs, and overall UI color scheme.
//
// Available themes:
//   'pierre-light'         – default light
//   'pierre-light-soft'    – softer light variant
//   'pierre-light-vibrant' – higher-contrast light
//   'pierre-dark'          – default dark
//   'pierre-dark-dim'      – dimmer dark variant
//   'pierre-dark-vibrant'  – higher-contrast dark
export const PREVIEW_THEME = 'pierre-light-soft';

// Set to 'dark' for any pierre-dark-* theme, 'light' for pierre-light-*.
// This controls the app-level color scheme (nav, backgrounds, etc.).
export const PREVIEW_COLOR_SCHEME: 'dark' | 'light' = 'light';

// Narrows the set of valid theme names used throughout the diffshub view.
export type PierreTheme =
  | 'pierre-light'
  | 'pierre-light-soft'
  | 'pierre-light-vibrant'
  | 'pierre-dark'
  | 'pierre-dark-dim'
  | 'pierre-dark-vibrant';
