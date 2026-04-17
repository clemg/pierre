'use client';

import { IconFileTreeFill, IconFolders } from '@pierre/icons';
import {
  FileTree,
  type FileTreePreloadedData,
  useFileTree,
} from '@pierre/trees/path-store/react';
import type { CSSProperties } from 'react';

import { TreeExampleHeading } from '../../components/TreeExampleHeading';
import {
  DEFAULT_FILE_TREE_PANEL_CLASS,
  flatteningPathStoreOptions,
} from './demo-data';
import {
  FLATTENED_EXPANDED_PATHS,
  FLATTENED_VIEWPORT_HEIGHT,
  HIERARCHICAL_EXPANDED_PATHS,
  HIERARCHICAL_VIEWPORT_HEIGHT,
} from './flattening-config';

const flattenStyle = {
  colorScheme: 'dark',
  '--trees-search-bg-override': 'light-dark(#fff, oklch(14.5% 0 0))',
} as CSSProperties;

interface FlatteningSectionClientProps {
  hierarchicalPreloaded: FileTreePreloadedData;
  flattenedPreloaded: FileTreePreloadedData;
}

export function FlatteningSectionClient({
  hierarchicalPreloaded,
  flattenedPreloaded,
}: FlatteningSectionClientProps) {
  const hierarchical = useFileTree({
    ...flatteningPathStoreOptions(false),
    id: hierarchicalPreloaded.id,
    initialExpandedPaths: HIERARCHICAL_EXPANDED_PATHS,
    viewportHeight: HIERARCHICAL_VIEWPORT_HEIGHT,
  });
  const flattened = useFileTree({
    ...flatteningPathStoreOptions(true),
    id: flattenedPreloaded.id,
    initialExpandedPaths: FLATTENED_EXPANDED_PATHS,
    viewportHeight: FLATTENED_VIEWPORT_HEIGHT,
  });

  return (
    <div className="grid grid-cols-1 items-start gap-4 md:grid-cols-2">
      <div>
        <TreeExampleHeading icon={<IconFileTreeFill />}>
          Hierarchical
        </TreeExampleHeading>
        <FileTree
          model={hierarchical.model}
          preloadedData={hierarchicalPreloaded}
          className={DEFAULT_FILE_TREE_PANEL_CLASS}
          style={flattenStyle}
        />
      </div>
      <div>
        <TreeExampleHeading icon={<IconFolders />}>
          Flattened
        </TreeExampleHeading>
        <FileTree
          model={flattened.model}
          preloadedData={flattenedPreloaded}
          className={DEFAULT_FILE_TREE_PANEL_CLASS}
          style={flattenStyle}
        />
      </div>
    </div>
  );
}
