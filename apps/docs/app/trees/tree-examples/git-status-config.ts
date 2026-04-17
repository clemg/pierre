// Per-panel configuration for the Git status homepage demo. Kept in a plain
// module (no 'use client' directive, no server-only APIs) so both the server
// component (`GitStatusSection.tsx`) and the client component
// (`GitStatusSectionClient.tsx`) can import the same values. This keeps the
// SSR declarative shadow DOM produced by `preloadPathStoreFileTree` in
// lock-step with the client `useFileTree` call during hydration.
//
// `.github/` and `config/` are marked expanded even though their flattened
// rows render collapsed in the UI. The path-store's flatten pass only extends
// a chain through a directory that is itself expanded (see
// `getFlattenedChildDirectoryId` in `packages/path-store/src/flatten.ts`), so
// expanding them is what merges `.github/workflows` and `config/project` into
// single segmented rows — same pattern as the Flattening demo.

export const GIT_STATUS_EXPANDED_PATHS: readonly string[] = [
  '.github/',
  'config/',
  'src/',
  'src/components/',
];

export const GIT_STATUS_TREE_ID = 'path-colors-git-status-demo';
