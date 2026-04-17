// Per-panel configuration for the Flattening homepage demo. Kept in a plain
// module (no 'use client' directive, no server-only APIs) so both the server
// component (`FlatteningSection.tsx`) and the client component
// (`FlatteningSectionClient.tsx`) can import the same values. This keeps the
// SSR declarative shadow DOM produced by `preloadPathStoreFileTree` in
// lock-step with the client `useFileTree` call during hydration.
//
// Viewport heights snap each panel to its visible-row count (item height is
// 30px by default) so neither panel needs an internal scrollbar. The
// hierarchical panel is naturally taller because its deep folder chains show
// as separate rows, which is the whole point of the demo.

export const HIERARCHICAL_EXPANDED_PATHS: readonly string[] = [
  'build/',
  'build/assets/',
  'build/assets/images/',
  'build/assets/images/social/',
];
export const HIERARCHICAL_VIEWPORT_HEIGHT = 570;

// `.github/` and `config/` are marked expanded even though their flattened
// rows should render collapsed in the UI. The path-store's flatten pass only
// extends a chain through a directory that is itself expanded (see
// `getFlattenedChildDirectoryId` in `packages/path-store/src/flatten.ts`), so
// expanding `.github/` is what merges it with `workflows/` into a single
// `.github/workflows` row; same story for `config/` → `config/project`.
export const FLATTENED_EXPANDED_PATHS: readonly string[] = [
  '.github/',
  'build/',
  'build/assets/images/social/',
  'config/',
];
export const FLATTENED_VIEWPORT_HEIGHT = 510;
