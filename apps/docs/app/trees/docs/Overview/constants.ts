import type { PreloadFileOptions } from '@pierre/diffs/ssr';
import type { FileTreeOptions } from '@pierre/trees';

import { CustomScrollbarCSS } from '@/components/CustomScrollbarCSS';

/** File list and options for the live FileTree in the Overview section */
export const OVERVIEW_FILE_TREE_OPTIONS: FileTreeOptions = {
  initialFiles: [
    'README.md',
    'package.json',
    'src/index.ts',
    'src/components/Button.tsx',
    'src/components/Header.tsx',
    'src/lib/utils.ts',
    'src/utils/stream.ts',
    '.gitignore',
  ],
  flattenEmptyDirectories: true,
};

const options = {
  theme: { dark: 'pierre-dark', light: 'pierre-light' },
  disableFileHeader: true,
  unsafeCSS: CustomScrollbarCSS,
} as const;

export const PATH_STORE_BASIC_USAGE: PreloadFileOptions<undefined> = {
  file: {
    name: 'file-explorer.ts',
    contents: `import { PathStoreFileTree } from '@pierre/trees/path-store';

const files = [
  'src/index.ts',
  'src/components/Button.tsx',
  'src/utils/helpers.ts',
  'package.json',
];

const fileTree = new PathStoreFileTree({
  paths: files,
  flattenEmptyDirectories: true,
  search: true,
});

fileTree.render({ containerWrapper: document.getElementById('tree-root')! });

// Mutate the tree at any time
fileTree.add('src/lib/theme.ts');
fileTree.remove('src/utils/helpers.ts');

// Clean up when done
// fileTree.cleanUp();`,
  },
  options,
};

export const PATH_STORE_SSR_USAGE: PreloadFileOptions<undefined> = {
  file: {
    name: 'ssr-example.tsx',
    contents: `// Server: pre-render tree HTML
import { preloadPathStoreFileTree } from '@pierre/trees/path-store';

const payload = preloadPathStoreFileTree({
  paths: ['src/index.ts', 'src/components/Button.tsx', 'package.json'],
  flattenEmptyDirectories: true,
  id: 'my-tree',
});

// Render payload.html into the page (e.g. dangerouslySetInnerHTML)

// Client: hydrate the pre-rendered tree
import { PathStoreFileTree } from '@pierre/trees/path-store';

const fileTree = new PathStoreFileTree({
  paths: ['src/index.ts', 'src/components/Button.tsx', 'package.json'],
  flattenEmptyDirectories: true,
  id: 'my-tree',
});

const container = document.querySelector('file-tree-container');
if (container instanceof HTMLElement) {
  fileTree.hydrate({ fileTreeContainer: container });
}`,
  },
  options,
};
