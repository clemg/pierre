import type { PreloadFileOptions } from '@pierre/diffs/ssr';

import { CustomScrollbarCSS } from '@/components/CustomScrollbarCSS';

const options = {
  theme: { dark: 'pierre-dark', light: 'pierre-light' },
  disableFileHeader: true,
  unsafeCSS: CustomScrollbarCSS,
} as const;

export const MUTATIONS_BASIC_EXAMPLE: PreloadFileOptions<undefined> = {
  file: {
    name: 'mutations.ts',
    contents: `import { PathStoreFileTree } from '@pierre/trees/path-store';

const fileTree = new PathStoreFileTree({
  paths: ['src/index.ts', 'src/components/Button.tsx', 'package.json'],
});

fileTree.render({ containerWrapper: document.getElementById('tree')! });

// Add a new file — the tree re-renders automatically
fileTree.add('src/lib/theme.ts');

// Remove a file
fileTree.remove('package.json');

// Move a file to a new path
fileTree.move('src/components/Button.tsx', 'src/ui/Button.tsx');`,
  },
  options,
};

export const MUTATIONS_BATCH_EXAMPLE: PreloadFileOptions<undefined> = {
  file: {
    name: 'batch.ts',
    contents: `import { PathStoreFileTree } from '@pierre/trees/path-store';

const fileTree = new PathStoreFileTree({
  paths: ['src/index.ts', 'src/components/Button.tsx', 'package.json'],
});

fileTree.render({ containerWrapper: document.getElementById('tree')! });

// Apply multiple operations atomically — one re-render
fileTree.batch([
  { type: 'add', path: 'docs/README.md' },
  { type: 'add', path: 'docs/guide.md' },
  { type: 'remove', path: 'package.json' },
  { type: 'move', from: 'src/components/Button.tsx', to: 'src/ui/Button.tsx' },
]);`,
  },
  options,
};

export const MUTATIONS_RESET_EXAMPLE: PreloadFileOptions<undefined> = {
  file: {
    name: 'resetPaths.ts',
    contents: `import { PathStoreFileTree } from '@pierre/trees/path-store';

const fileTree = new PathStoreFileTree({
  paths: ['src/index.ts', 'package.json'],
});

fileTree.render({ containerWrapper: document.getElementById('tree')! });

// Replace the entire file list (e.g. after a branch switch)
fileTree.resetPaths([
  'lib/core.ts',
  'lib/utils.ts',
  'tests/core.test.ts',
  'README.md',
], {
  initialExpandedPaths: ['lib/', 'tests/'],
});`,
  },
  options,
};

export const MUTATIONS_EVENTS_EXAMPLE: PreloadFileOptions<undefined> = {
  file: {
    name: 'onMutation.ts',
    contents: `import { PathStoreFileTree } from '@pierre/trees/path-store';
import type { PathStoreTreesMutationEvent } from '@pierre/trees/path-store';

const fileTree = new PathStoreFileTree({
  paths: ['src/index.ts', 'package.json'],
});

fileTree.render({ containerWrapper: document.getElementById('tree')! });

// Listen for all mutation types
const unsubscribe = fileTree.onMutation('*', (event: PathStoreTreesMutationEvent) => {
  switch (event.operation) {
    case 'add':
      console.log('Added:', event.path);
      break;
    case 'remove':
      console.log('Removed:', event.path);
      break;
    case 'move':
      console.log('Moved:', event.from, '->', event.to);
      break;
    case 'batch':
      console.log('Batch:', event.events.length, 'operations');
      break;
    case 'reset':
      console.log('Reset:', event.pathCountBefore, '->', event.pathCountAfter);
      break;
  }
});

// Or listen for a specific type
const unsubscribeAdd = fileTree.onMutation('add', (event) => {
  console.log('File added:', event.path);
});

// Clean up
// unsubscribe();
// unsubscribeAdd();`,
  },
  options,
};
