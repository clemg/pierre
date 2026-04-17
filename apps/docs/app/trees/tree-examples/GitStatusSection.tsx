import {
  PATH_STORE_TREES_DEFAULT_ITEM_HEIGHT,
  preloadPathStoreFileTree,
} from '@pierre/trees/path-store';

import { GIT_STATUSES_A, gitStatusPathStoreOptions } from './demo-data';
import {
  GIT_STATUS_EXPANDED_PATHS,
  GIT_STATUS_TREE_ID,
} from './git-status-config';
import { GitStatusSectionClient } from './GitStatusSectionClient';

// Baseline row count for the unfiltered demo state (Git status on, Show
// unmodified on). Sized to comfortably fit the initial projection so the SSR
// declarative shadow DOM renders at the same height the hydrated client will
// snap to on first paint; the client then takes over with a fully dynamic
// height keyed on `model.getVisibleRowCount()`.
const INITIAL_ROW_COUNT = 22;

const preloaded = preloadPathStoreFileTree({
  ...gitStatusPathStoreOptions(undefined, GIT_STATUSES_A),
  id: GIT_STATUS_TREE_ID,
  initialExpandedPaths: GIT_STATUS_EXPANDED_PATHS,
  viewportHeight: INITIAL_ROW_COUNT * PATH_STORE_TREES_DEFAULT_ITEM_HEIGHT,
});

export function GitStatusSection() {
  return <GitStatusSectionClient preloaded={preloaded} />;
}
