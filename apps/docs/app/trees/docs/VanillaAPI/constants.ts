import type { PreloadFileOptions } from '@pierre/diffs/ssr';

import { CustomScrollbarCSS } from '@/components/CustomScrollbarCSS';

const options = {
  theme: { dark: 'pierre-dark', light: 'pierre-light' },
  disableFileHeader: true,
  unsafeCSS: CustomScrollbarCSS,
} as const;

export const PATH_STORE_API_BASIC_EXAMPLE: PreloadFileOptions<undefined> = {
  file: {
    name: 'file_tree_example.ts',
    contents: `import { PathStoreFileTree } from '@pierre/trees/path-store';

const files = [
  'src/index.ts',
  'src/components/Button.tsx',
  'src/utils/helpers.ts',
  'package.json',
];

const fileTree = new PathStoreFileTree({ paths: files });
fileTree.render({ containerWrapper: document.getElementById('tree-root')! });

// Clean up when done
// fileTree.cleanUp();`,
  },
  options,
};

export const PATH_STORE_API_FULL_EXAMPLE: PreloadFileOptions<undefined> = {
  file: {
    name: 'path_store_file_tree.ts',
    contents: `import { PathStoreFileTree } from '@pierre/trees/path-store';

const fileTree = new PathStoreFileTree({
  paths: ['src/index.ts', 'src/components/Button.tsx', 'package.json'],
  id: 'my-tree',
  flattenEmptyDirectories: true,
  fileTreeSearchMode: 'hide-non-matches',
  search: true,
  viewportHeight: 400,
  initialExpandedPaths: ['src/', 'src/components/'],
  onSelectionChange: (paths) => console.log('Selected:', paths),
  onSearchChange: (value) => console.log('Search:', value),
});

// Render into the DOM
fileTree.render({ containerWrapper: document.getElementById('tree')! });

// Mutations
fileTree.add('src/lib/theme.ts');
fileTree.remove('src/utils/helpers.ts');
fileTree.move('src/components/Button.tsx', 'src/ui/Button.tsx');

// Batch multiple operations atomically
fileTree.batch([
  { type: 'add', path: 'docs/README.md' },
  { type: 'remove', path: 'package.json' },
]);

// Replace the entire file list
fileTree.resetPaths([
  'src/index.ts',
  'src/ui/Button.tsx',
  'src/lib/theme.ts',
  'docs/README.md',
]);

// Item handles
const item = fileTree.getItem('src/');
if (item?.isDirectory()) {
  item.toggle();
  console.log('Expanded:', item.isExpanded());
}

// Search
fileTree.openSearch('Button');
console.log(fileTree.getSearchMatchingPaths());
fileTree.closeSearch();

// Listen for mutations
const unsubscribe = fileTree.onMutation('*', (event) => {
  console.log(event.operation, event);
});

// Cleanup
// unsubscribe();
// fileTree.cleanUp();`,
  },
  options,
};

export const VANILLA_LEGACY_EXAMPLE: PreloadFileOptions<undefined> = {
  file: {
    name: 'legacy_file_tree.ts',
    contents: `import { FileTree } from '@pierre/trees';

const fileTree = new FileTree({
  initialFiles: ['src/index.ts', 'src/components/Button.tsx', 'package.json'],
});

fileTree.render({ containerWrapper: document.getElementById('tree')! });

// Legacy imperative methods
fileTree.setFiles(['src/index.ts', 'src/new-file.ts', 'package.json']);
fileTree.expandItem('src');
fileTree.collapseItem('src');
console.log(fileTree.getFiles(), fileTree.getExpandedItems());

fileTree.cleanUp();`,
  },
  options,
};

export const VANILLA_API_CUSTOM_ICONS_EXAMPLE: PreloadFileOptions<undefined> = {
  file: {
    name: 'custom_icons_file_tree.ts',
    contents: `import { PathStoreFileTree } from '@pierre/trees/path-store';

const fileTree = new PathStoreFileTree({
  paths: [
    'src/index.ts',
    'src/components/Button.tsx',
    'package.json',
  ],
  icons: {
    set: 'standard',
    colored: true,
  },
});

fileTree.render({ containerWrapper: document.getElementById('tree')! });

// Update icons at any time
fileTree.setIcons({ set: 'complete', colored: true });`,
  },
  options,
};

export const VANILLA_API_GIT_STATUS_EXAMPLE: PreloadFileOptions<undefined> = {
  file: {
    name: 'git_status_file_tree.ts',
    contents: `import type { GitStatusEntry } from '@pierre/trees';
import { PathStoreFileTree } from '@pierre/trees/path-store';

const files = [
  'README.md',
  'package.json',
  'src/index.ts',
  'src/components/Button.tsx',
  'src/lib/utils.ts',
];

const initialGitStatus: GitStatusEntry[] = [
  { path: 'src/index.ts', status: 'modified' },
  { path: 'src/components/Button.tsx', status: 'added' },
];

const fileTree = new PathStoreFileTree({
  paths: files,
  gitStatus: initialGitStatus,
});

fileTree.render({ containerWrapper: document.getElementById('tree')! });

// Update status at any time
fileTree.setGitStatus([
  { path: 'src/lib/utils.ts', status: 'modified' },
  { path: 'README.md', status: 'deleted' },
]);`,
  },
  options,
};
