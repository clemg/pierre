import type { PreloadFileOptions } from '@pierre/diffs/ssr';

import { CustomScrollbarCSS } from '@/components/CustomScrollbarCSS';

const options = {
  theme: { dark: 'pierre-dark', light: 'pierre-light' },
  disableFileHeader: true,
  unsafeCSS: CustomScrollbarCSS,
} as const;

export const PATH_STORE_FILE_TREE_OPTIONS_TYPE: PreloadFileOptions<undefined> =
  {
    file: {
      name: 'PathStoreFileTreeOptions.ts',
      contents: `import type {
  PathStoreFileTreeOptions,
  PathStoreTreesSearchMode,
  PathStoreTreesDragAndDropConfig,
  PathStoreTreesRenamingConfig,
  PathStoreTreesCompositionOptions,
} from '@pierre/trees/path-store';
import type { GitStatusEntry, FileTreeIcons } from '@pierre/trees';

interface PathStoreFileTreeOptions {
  // Required: array of file paths (forward slashes). Defines the tree structure.
  paths: readonly string[];

  // Optional: unique id for this instance (DOM ids, SSR). Auto-generated if omitted.
  id?: string;

  // Optional: collapse single-child folder chains into one row. Default: false.
  flattenEmptyDirectories?: boolean;

  // Optional: search behavior mode.
  fileTreeSearchMode?: PathStoreTreesSearchMode;

  // Optional: render the built-in search input. Default: false.
  search?: boolean;

  // Optional: enable drag and drop. true for defaults, or config object.
  dragAndDrop?: boolean | PathStoreTreesDragAndDropConfig;

  // Optional: enable inline renaming. true for defaults, or config object.
  renaming?: boolean | PathStoreTreesRenamingConfig;

  // Optional: Git status entries for file status indicators.
  gitStatus?: readonly GitStatusEntry[];

  // Optional: built-in icon set or custom icon config.
  icons?: FileTreeIcons;

  // Optional: composition slots (header, context menu).
  composition?: PathStoreTreesCompositionOptions;

  // Optional: height of the virtualized viewport in pixels. Default: 320.
  viewportHeight?: number;

  // Optional: height of each tree row in pixels. Default: 28.
  itemHeight?: number;

  // Optional: directory paths to expand on mount.
  initialExpandedPaths?: readonly string[];

  // Optional: callback when selection changes.
  onSelectionChange?: (selectedPaths: readonly string[]) => void;

  // Optional: callback when search value changes.
  onSearchChange?: (value: string | null) => void;
}

// Example usage
const options: PathStoreFileTreeOptions = {
  paths: [
    'README.md',
    'package.json',
    'src/index.ts',
    'src/components/Button.tsx',
  ],
  flattenEmptyDirectories: true,
  fileTreeSearchMode: 'hide-non-matches',
  search: true,
  viewportHeight: 400,
  initialExpandedPaths: ['src/', 'src/components/'],
  onSelectionChange: (paths) => {
    console.log('Selected:', paths);
  },
};`,
    },
    options,
  };

export const PATHS_OPTION_EXAMPLE: PreloadFileOptions<undefined> = {
  file: {
    name: 'paths.ts',
    contents: `const paths = [
  'README.md',
  'package.json',
  'src/index.ts',
  'src/components/Button.tsx',
  'src/utils/helpers.ts',
];`,
  },
  options: {
    theme: { dark: 'pierre-dark', light: 'pierre-light' },
    disableFileHeader: true,
  },
};

export const PATH_STORE_SEARCH_MODE_TYPE: PreloadFileOptions<undefined> = {
  file: {
    name: 'PathStoreTreesSearchMode.ts',
    contents: `import type { PathStoreTreesSearchMode } from '@pierre/trees/path-store';

// PathStoreTreesSearchMode is:
// - 'expand-matches' (default)
// - 'collapse-non-matches'
// - 'hide-non-matches'
// Pass it via fileTreeSearchMode in PathStoreFileTreeOptions.
//
// 'expand-matches' (default): expand nodes that match the search.
// 'collapse-non-matches': hide non-matching branches; only matching
// paths and their parents stay visible.
// 'hide-non-matches': keep branch structure, but hide non-matching rows.

const options = {
  paths: ['src/index.ts', 'src/components/Button.tsx'],
  fileTreeSearchMode: 'collapse-non-matches' as PathStoreTreesSearchMode,
  search: true,
};`,
  },
  options,
};

export const PATH_STORE_ITEM_HANDLE_TYPE: PreloadFileOptions<undefined> = {
  file: {
    name: 'ItemHandles.ts',
    contents: `import { PathStoreFileTree } from '@pierre/trees/path-store';
import type {
  PathStoreTreesItemHandle,
  PathStoreTreesDirectoryHandle,
  PathStoreTreesFileHandle,
} from '@pierre/trees/path-store';

const fileTree = new PathStoreFileTree({
  paths: ['src/index.ts', 'src/components/Button.tsx', 'package.json'],
});

// getItem returns a typed handle for the given path, or null if not found.
const item = fileTree.getItem('src/');

if (item != null) {
  // Common methods on all handles
  item.focus();
  item.select();
  item.deselect();
  item.toggleSelect();
  console.log(item.getPath(), item.isSelected(), item.isFocused());

  // Directory-specific methods
  if (item.isDirectory()) {
    item.expand();
    item.collapse();
    item.toggle();
    console.log(item.isExpanded());
  }
}

// Selection
const selected = fileTree.getSelectedPaths();
console.log('Selected paths:', selected);`,
  },
  options,
};
