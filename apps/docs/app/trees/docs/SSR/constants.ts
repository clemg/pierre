import type { PreloadFileOptions } from '@pierre/diffs/ssr';

import { CustomScrollbarCSS } from '@/components/CustomScrollbarCSS';

const options = {
  theme: { dark: 'pierre-dark', light: 'pierre-light' },
  disableFileHeader: true,
  unsafeCSS: CustomScrollbarCSS,
} as const;

export const SSR_PRELOAD_PATH_STORE_FILE_TREE: PreloadFileOptions<undefined> = {
  file: {
    name: 'preloadPathStoreFileTree.tsx',
    contents: `import {
  type PathStoreFileTreeOptions,
  preloadPathStoreFileTree,
} from '@pierre/trees/path-store';

// Server (e.g. Next.js app router server component)
const sharedOptions: PathStoreFileTreeOptions = {
  paths: ['README.md', 'src/index.ts', 'src/utils/helper.ts'],
  flattenEmptyDirectories: true,
  id: 'my-tree',
  initialExpandedPaths: ['src/'],
  viewportHeight: 400,
  search: true,
};

export default function TreePage() {
  const payload = preloadPathStoreFileTree(sharedOptions);

  return (
    <div
      dangerouslySetInnerHTML={{ __html: payload.html }}
      style={{ height: sharedOptions.viewportHeight }}
      suppressHydrationWarning
    />
  );
}`,
  },
  options,
};

export const SSR_HYDRATION_EXAMPLE: PreloadFileOptions<undefined> = {
  file: {
    name: 'hydrate_path_store.ts',
    contents: `import { PathStoreFileTree } from '@pierre/trees/path-store';

const fileTree = new PathStoreFileTree({
  paths: ['README.md', 'src/index.ts', 'src/utils/helper.ts'],
  flattenEmptyDirectories: true,
  id: 'my-tree',
  initialExpandedPaths: ['src/'],
  viewportHeight: 400,
  search: true,
});

const container = document.querySelector('file-tree-container');
if (container instanceof HTMLElement) {
  fileTree.hydrate({ fileTreeContainer: container });
}`,
  },
  options,
};
