import type { PreloadFileOptions } from '@pierre/diffs/ssr';

import { CustomScrollbarCSS } from '@/components/CustomScrollbarCSS';

const options = {
  theme: { dark: 'pierre-dark', light: 'pierre-light' },
  disableFileHeader: true,
  unsafeCSS: CustomScrollbarCSS,
} as const;

export const DND_CONFIG_EXAMPLE: PreloadFileOptions<undefined> = {
  file: {
    name: 'PathStoreTreesDragAndDropConfig.ts',
    contents: `import type {
  PathStoreTreesDragAndDropConfig,
  PathStoreTreesDropContext,
  PathStoreTreesDropResult,
} from '@pierre/trees/path-store';

const dragAndDrop: PathStoreTreesDragAndDropConfig = {
  // Prevent specific paths from being dragged
  canDrag: (paths) => {
    return !paths.includes('package.json');
  },

  // Prevent drops onto specific targets
  canDrop: (event: PathStoreTreesDropContext) => {
    return event.target.directoryPath !== 'node_modules/';
  },

  // Called after a successful drop
  onDropComplete: (event: PathStoreTreesDropResult) => {
    const target = event.target.kind === 'root'
      ? 'root'
      : event.target.directoryPath;
    console.log(\`Dropped \${event.draggedPaths.join(', ')} into \${target}\`);
  },

  // Called when a drop fails
  onDropError: (error, event) => {
    console.error('Drop failed:', error);
  },

  // Auto-open collapsed folders on hover (ms)
  openOnDropDelay: 800,
};`,
  },
  options,
};

export const DND_USAGE_EXAMPLE: PreloadFileOptions<undefined> = {
  file: {
    name: 'drag-and-drop.ts',
    contents: `import { PathStoreFileTree } from '@pierre/trees/path-store';

const fileTree = new PathStoreFileTree({
  paths: [
    'src/index.ts',
    'src/components/Button.tsx',
    'src/lib/utils.ts',
    'package.json',
  ],
  flattenEmptyDirectories: true,
  dragAndDrop: {
    canDrag: (paths) => !paths.includes('package.json'),
    onDropComplete: (event) => {
      console.log('Dropped:', event.draggedPaths, '->', event.target);
    },
  },
});

fileTree.render({ containerWrapper: document.getElementById('tree')! });

// Listen for the resulting mutation events
fileTree.onMutation('move', (event) => {
  console.log('Moved:', event.from, '->', event.to);
});`,
  },
  options,
};
