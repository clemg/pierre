import {
  FileTreeModel,
  type FileTreeOptions,
  type FileTreeSelectionItem,
  type FileTreeStateConfig,
} from '@pierre/trees';

export const sampleFileList: string[] = [
  'README.md',
  'package.json',
  'build/index.mjs',
  'build/scripts.js',
  'build/assets/images/social/logo.png',
  'config/project/app.config.json',
  'src/components/Button.tsx',
  'src/components/Card.tsx',
  'src/components/Header.tsx',
  'src/components/Sidebar.tsx',
  'src/lib/mdx.tsx',
  'src/lib/utils.ts',
  'src/utils/stream.ts',
  'src/utils/worker.ts',
  'src/utils/worker/index.ts',
  'src/utils/worker/deprecrated/old-worker.ts',
  'src/index.ts',
  '.gitignore',
];

export type TreesDocsFileTreeOptions = Omit<FileTreeOptions, 'model'> & {
  initialFiles: string[];
};

export const sharedDemoFileTreeOptions: TreesDocsFileTreeOptions = {
  flattenEmptyDirectories: true,
  initialFiles: sampleFileList,
};

export function toRuntimeFileTreeOptions(
  options: TreesDocsFileTreeOptions
): FileTreeOptions {
  const { initialFiles, sort, ...rest } = options;
  const sortComparator =
    sort === false
      ? false
      : sort != null && typeof sort === 'object'
        ? sort.comparator
        : undefined;

  return {
    ...rest,
    sort,
    model: FileTreeModel.fromFiles(initialFiles, { sortComparator }),
  };
}

export const sharedDemoStateConfig: FileTreeStateConfig = {
  initialExpandedItems: ['Build/assets/images/social'],
  onSelection: (selection: FileTreeSelectionItem[]) => {
    console.log('selection', selection);
  },
};
