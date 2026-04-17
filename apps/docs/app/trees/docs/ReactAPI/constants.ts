import type { PreloadFileOptions } from '@pierre/diffs/ssr';

import { CustomScrollbarCSS } from '@/components/CustomScrollbarCSS';

const options = {
  theme: { dark: 'pierre-dark', light: 'pierre-light' },
  disableFileHeader: true,
  unsafeCSS: CustomScrollbarCSS,
} as const;

export const REACT_PATH_STORE_USAGE: PreloadFileOptions<undefined> = {
  file: {
    name: 'FileExplorer.tsx',
    contents: `'use client';

import { PathStoreFileTree } from '@pierre/trees/path-store';
import { useEffect, useRef } from 'react';

const files = [
  'src/index.ts',
  'src/components/Button.tsx',
  'src/utils/helpers.ts',
  'package.json',
];

export function FileExplorer() {
  const mountRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const node = mountRef.current;
    if (node == null) return;

    const fileTree = new PathStoreFileTree({
      paths: files,
      flattenEmptyDirectories: true,
      search: true,
      viewportHeight: 400,
      onSelectionChange: (paths) => {
        console.log('Selected:', paths);
      },
    });

    fileTree.render({ containerWrapper: node });

    return () => {
      fileTree.cleanUp();
    };
  }, []);

  return <div ref={mountRef} style={{ height: 400 }} />;
}`,
  },
  options,
};

export const REACT_PATH_STORE_SSR: PreloadFileOptions<undefined> = {
  file: {
    name: 'TreePage.tsx',
    contents: `// Server component (page.tsx)
import {
  type PathStoreFileTreeOptions,
  preloadPathStoreFileTree,
} from '@pierre/trees/path-store';

const sharedOptions: PathStoreFileTreeOptions = {
  paths: ['src/index.ts', 'src/components/Button.tsx', 'package.json'],
  flattenEmptyDirectories: true,
  id: 'my-tree',
  search: true,
  viewportHeight: 400,
};

export default function TreePage() {
  const payload = preloadPathStoreFileTree(sharedOptions);
  return <TreeClient html={payload.html} options={sharedOptions} />;
}

// Client component (TreeClient.tsx)
'use client';

import { PathStoreFileTree } from '@pierre/trees/path-store';
import type { PathStoreFileTreeOptions } from '@pierre/trees/path-store';
import { useEffect, useRef } from 'react';

export function TreeClient({
  html,
  options,
}: {
  html: string;
  options: PathStoreFileTreeOptions;
}) {
  const mountRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const node = mountRef.current;
    if (node == null) return;

    const fileTree = new PathStoreFileTree(options);
    const container = node.querySelector('file-tree-container');

    if (container instanceof HTMLElement) {
      fileTree.hydrate({ fileTreeContainer: container });
    } else {
      node.innerHTML = '';
      fileTree.render({ containerWrapper: node });
    }

    return () => {
      fileTree.cleanUp();
    };
  }, [html, options]);

  return (
    <div
      ref={mountRef}
      style={{ height: options.viewportHeight ?? 400 }}
      dangerouslySetInnerHTML={{ __html: html }}
      suppressHydrationWarning
    />
  );
}`,
  },
  options,
};

export const REACT_LEGACY_FILE_TREE: PreloadFileOptions<undefined> = {
  file: {
    name: 'LegacyFileExplorer.tsx',
    contents: `import { FileTree } from '@pierre/trees/react';

const files = [
  'src/index.ts',
  'src/components/Button.tsx',
  'src/utils/helpers.ts',
  'package.json',
];

export function FileExplorer() {
  return <FileTree options={{}} initialFiles={files} />;
}`,
  },
  options,
};

export const REACT_API_CUSTOM_ICONS_EXAMPLE: PreloadFileOptions<undefined> = {
  file: {
    name: 'custom_icons_file_tree.tsx',
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

export const REACT_API_GIT_STATUS_EXAMPLE: PreloadFileOptions<undefined> = {
  file: {
    name: 'git_status_file_tree.ts',
    contents: `import { PathStoreFileTree } from '@pierre/trees/path-store';
import type { GitStatusEntry } from '@pierre/trees';

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
  { path: 'README.md', status: 'deleted' },
];

const fileTree = new PathStoreFileTree({
  paths: files,
  gitStatus: initialGitStatus,
  search: true,
});

fileTree.render({ containerWrapper: document.getElementById('tree')! });

// Update git status at any time
fileTree.setGitStatus([
  { path: 'src/lib/utils.ts', status: 'modified' },
]);`,
  },
  options,
};
