import type { PreloadFileOptions } from '@pierre/diffs/ssr';

import { CustomScrollbarCSS } from '@/components/CustomScrollbarCSS';

const options = {
  theme: { dark: 'pierre-dark', light: 'pierre-light' },
  disableFileHeader: true,
  unsafeCSS: CustomScrollbarCSS,
} as const;

export const REACT_API_FILE_TREE: PreloadFileOptions<undefined> = {
  file: {
    name: 'FileExplorer.tsx',
    contents: `import { FileTreeModel } from '@pierre/trees';
import { FileTree } from '@pierre/trees/react';

const files = [
  'src/index.ts',
  'src/components/Button.tsx',
  'src/utils/helpers.ts',
  'package.json',
];

const model = FileTreeModel.fromFiles(files);

export function FileExplorer() {
  return <FileTree model={model} options={{}} />;
}`,
  },
  options,
};

export const REACT_API_FILE_TREE_PROPS: PreloadFileOptions<undefined> = {
  file: {
    name: 'file_tree_props.tsx',
    contents: `import { FileTreeModel } from '@pierre/trees';
import { FileTree } from '@pierre/trees/react';

// FileTree accepts these props:
const model = FileTreeModel.fromFiles(['src/index.ts', 'package.json']);

<FileTree
  // Required: model + options
  model={model}
  options={{
    flattenEmptyDirectories: true,
    fileTreeSearchMode: 'expand-matches',
    search: true,
    unsafeCSS: \`
      [data-item-section='icon'] {
        color: oklch(67% 0.2 25);
      }
    \`,
  }}

  // Optional: uncontrolled state defaults
  initialExpandedItems={['src']}
  initialSelectedItems={['package.json']}
  initialSearchQuery="Button"

  // Optional: controlled state (overrides internal state each render)
  // expandedItems={controlledExpanded}
  // selectedItems={controlledSelected}

  // Optional: state change callbacks
  onSelection={(items) => console.log(items)}
  onExpandedItemsChange={(items) => console.log('expanded', items)}
  onSelectedItemsChange={(items) => console.log('selected', items)}
  onModelChange={(changeSet, { getFiles }) => {
    console.log(changeSet.kind, getFiles());
  }}

  // Optional: git status
  gitStatus={gitStatusEntries}

  // Optional: CSS class name and inline styles
  className="my-file-tree"
  style={{ maxHeight: 400 }}

  // Optional: pre-rendered HTML for SSR hydration
  prerenderedHTML={htmlFromServer}
/>`,
  },
  options,
};

export const REACT_API_CUSTOM_ICONS_EXAMPLE: PreloadFileOptions<undefined> = {
  file: {
    name: 'custom_icons_file_tree.tsx',
    contents: `import { FileTreeModel } from '@pierre/trees';
import { FileTree } from '@pierre/trees/react';

const model = FileTreeModel.fromFiles([
  'src/index.ts',
  'src/components/Button.tsx',
  'package.json',
]);

const customSpriteSheet = \`
  <svg data-icon-sprite aria-hidden="true" width="0" height="0">
    <symbol id="my-file" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" stroke-width="2">
      <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/>
      <path d="M14 2v4a2 2 0 0 0 2 2h4"/>
    </symbol>
  </svg>
\`;

export function CustomIconsTree() {
  return (
    <FileTree
      model={model}
      options={{
        id: 'custom-icons-tree',
        icons: {
          spriteSheet: customSpriteSheet,
          remap: {
            'file-tree-icon-file': 'my-file',
          },
        },
      }}
      initialExpandedItems={['src', 'src/components']}
    />
  );
}`,
  },
  options,
};

export const REACT_API_GIT_STATUS_EXAMPLE: PreloadFileOptions<undefined> = {
  file: {
    name: 'git_status_file_tree.tsx',
    contents: `import { useEffect, useState } from 'react';
import { FileTreeModel, type GitStatusEntry } from '@pierre/trees';
import { FileTree } from '@pierre/trees/react';

const files = [
  'README.md',
  'package.json',
  'src/index.ts',
  'src/components/Button.tsx',
  'src/lib/utils.ts',
];

const model = FileTreeModel.fromFiles(files);

export function GitAwareTree() {
  const [gitStatus, setGitStatus] = useState<GitStatusEntry[] | undefined>();

  useEffect(() => {
    // Replace this with your VCS/remote status source.
    setGitStatus([
      { path: 'src/index.ts', status: 'modified' },
      { path: 'src/components/Button.tsx', status: 'added' },
      { path: 'README.md', status: 'deleted' },
    ]);
  }, []);

  return (
    <FileTree
      model={model}
      options={{ id: 'git-aware-tree' }}
      initialExpandedItems={['src', 'src/components']}
      gitStatus={gitStatus}
    />
  );
}`,
  },
  options,
};
