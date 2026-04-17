import type { PreloadFileOptions } from '@pierre/diffs/ssr';

import { CustomScrollbarCSS } from '@/components/CustomScrollbarCSS';

const options = {
  theme: { dark: 'pierre-dark', light: 'pierre-light' },
  disableFileHeader: true,
  unsafeCSS: CustomScrollbarCSS,
} as const;

export const COMPOSITION_HEADER_EXAMPLE: PreloadFileOptions<undefined> = {
  file: {
    name: 'header-slot.ts',
    contents: `import { PathStoreFileTree } from '@pierre/trees/path-store';

// Static HTML header
const fileTree = new PathStoreFileTree({
  paths: ['src/index.ts', 'src/lib/utils.ts', 'package.json'],
  composition: {
    header: {
      html: '<div style="padding: 8px 12px; font-weight: bold;">Explorer</div>',
    },
  },
});

fileTree.render({ containerWrapper: document.getElementById('tree')! });

// Or use a render function for dynamic content
const fileTree2 = new PathStoreFileTree({
  paths: ['src/index.ts', 'package.json'],
  composition: {
    header: {
      render: () => {
        const el = document.createElement('div');
        el.style.padding = '8px 12px';
        el.textContent = 'My Project';
        return el;
      },
    },
  },
});`,
  },
  options,
};

export const COMPOSITION_CONTEXT_MENU_EXAMPLE: PreloadFileOptions<undefined> = {
  file: {
    name: 'context-menu.ts',
    contents: `import { PathStoreFileTree } from '@pierre/trees/path-store';
import type {
  PathStoreTreesContextMenuItem,
  PathStoreTreesContextMenuOpenContext,
} from '@pierre/trees/path-store';

const fileTree = new PathStoreFileTree({
  paths: ['src/index.ts', 'src/lib/utils.ts', 'package.json'],
  renaming: true,
  composition: {
    contextMenu: {
      enabled: true,
      onOpen: (item: PathStoreTreesContextMenuItem, context: PathStoreTreesContextMenuOpenContext) => {
        console.log('Context menu opened for:', item.path);
        console.log('Anchor rect:', context.anchorRect);

        // Build your own menu UI using the anchor position.
        // Call context.close() when the menu should dismiss.
      },
      onClose: () => {
        console.log('Context menu closed');
      },
    },
  },
});

fileTree.render({ containerWrapper: document.getElementById('tree')! });`,
  },
  options,
};
