import type {
  FileTreeOptions,
  FileTreeSearchMode,
  GitStatusEntry,
} from '@pierre/trees';
import type { PathStoreFileTreeOptions } from '@pierre/trees/path-store';
import type { CSSProperties } from 'react';

import {
  sampleFileList,
  sharedDemoFileTreeOptions,
} from '../../trees/demo-data';

/** Default panel look for FileTree in docs examples. Apply via className + style on FileTree. */
export const DEFAULT_FILE_TREE_PANEL_CLASS =
  'dark min-h-0 flex-1 overflow-auto rounded-lg p-3 border border-[var(--trees-border-color)]';

export const DEFAULT_FILE_TREE_PANEL_STYLE: CSSProperties = {
  colorScheme: 'dark',
};

export const GIT_STATUSES_A: GitStatusEntry[] = [
  { path: 'src/index.ts', status: 'modified' },
  { path: 'src/components/Button.tsx', status: 'added' },
  { path: '.gitignore', status: 'deleted' },
];

export const GIT_STATUSES_B: GitStatusEntry[] = [
  { path: 'README.md', status: 'modified' },
  { path: 'src/lib/utils.ts', status: 'modified' },
  { path: 'src/utils/worker.ts', status: 'added' },
];

/** Options with flatten empty directories enabled (nested folders collapsed). Pass initialExpandedItems on the component for initial open folders (e.g. ['build']). */
export function flatteningOptions(flatten: boolean): FileTreeOptions {
  return {
    ...sharedDemoFileTreeOptions,
    flattenEmptyDirectories: flatten,
  };
}

/**
 * Path-store flavored flattening options for the new `@pierre/trees/path-store`
 * APIs. Mirrors `flatteningOptions` but uses `paths` (path-store's input key)
 * instead of the legacy `initialFiles`. The returned object is intentionally
 * free of `id` so callers can supply matching server/client ids per panel.
 */
export function flatteningPathStoreOptions(
  flatten: boolean
): Omit<PathStoreFileTreeOptions, 'id'> {
  return {
    flattenEmptyDirectories: flatten,
    paths: sampleFileList,
  };
}

/**
 * Path-store flavored options for the Git status example. Defaults to the
 * shared sample file list and forwards an optional `gitStatus` array; leaving
 * `gitStatus` undefined is how the demo communicates "Git status disabled".
 * The returned object is intentionally free of `id` so callers can supply
 * matching server/client ids.
 */
export function gitStatusPathStoreOptions(
  paths: readonly string[] = sampleFileList,
  gitStatus?: readonly GitStatusEntry[]
): Omit<PathStoreFileTreeOptions, 'id'> {
  return {
    flattenEmptyDirectories: true,
    gitStatus,
    paths,
  };
}

/** Base options for all tree example sections. */
export const baseTreeOptions = sharedDemoFileTreeOptions;

/** Options for drag-and-drop examples. Optional lockedPaths prevents those paths from being dragged. */
export function dragDropOptions(lockedPaths?: string[]): FileTreeOptions {
  return {
    ...baseTreeOptions,
    dragAndDrop: true,
    ...(lockedPaths != null && lockedPaths.length > 0 && { lockedPaths }),
  };
}

/** Options with search mode for the search example. Pass fileTreeSearchMode at top level so the tree applies it. Use stateConfig.initialSearchQuery in the component for prepopulated search. */
export function searchOptions(mode: FileTreeSearchMode): FileTreeOptions {
  return {
    ...sharedDemoFileTreeOptions,
    fileTreeSearchMode: mode,
    search: true,
  };
}
