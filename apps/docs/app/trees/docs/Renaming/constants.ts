import type { PreloadFileOptions } from '@pierre/diffs/ssr';

import { CustomScrollbarCSS } from '@/components/CustomScrollbarCSS';

const options = {
  theme: { dark: 'pierre-dark', light: 'pierre-light' },
  disableFileHeader: true,
  unsafeCSS: CustomScrollbarCSS,
} as const;

export const RENAMING_CONFIG_EXAMPLE: PreloadFileOptions<undefined> = {
  file: {
    name: 'PathStoreTreesRenamingConfig.ts',
    contents: `import type {
  PathStoreTreesRenamingConfig,
  PathStoreTreesRenamingItem,
  PathStoreTreesRenameEvent,
} from '@pierre/trees/path-store';

const renaming: PathStoreTreesRenamingConfig = {
  // Prevent renaming specific items
  canRename: (item: PathStoreTreesRenamingItem) => {
    return item.path !== 'package.json';
  },

  // Called after a successful rename
  onRename: (event: PathStoreTreesRenameEvent) => {
    console.log(
      \`Renamed \${event.sourcePath} -> \${event.destinationPath}\`,
      event.isFolder ? '(folder)' : '(file)'
    );
  },

  // Called when a rename fails
  onError: (error: string) => {
    console.error('Rename failed:', error);
  },
};`,
  },
  options,
};

export const RENAMING_USAGE_EXAMPLE: PreloadFileOptions<undefined> = {
  file: {
    name: 'renaming.ts',
    contents: `import { PathStoreFileTree } from '@pierre/trees/path-store';

const fileTree = new PathStoreFileTree({
  paths: [
    'src/index.ts',
    'src/components/Button.tsx',
    'src/lib/utils.ts',
    'package.json',
  ],
  renaming: {
    canRename: (item) => item.path !== 'package.json',
    onRename: (event) => {
      console.log(\`Renamed: \${event.sourcePath} -> \${event.destinationPath}\`);
    },
  },
});

fileTree.render({ containerWrapper: document.getElementById('tree')! });

// Trigger renaming programmatically (or press F2 on a focused item)
fileTree.startRenaming('src/lib/utils.ts');`,
  },
  options,
};
