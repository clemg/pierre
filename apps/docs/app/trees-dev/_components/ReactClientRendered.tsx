'use client';

import type { FileTreeStateConfig } from '@pierre/trees';
import { FileTree as FileTreeReact } from '@pierre/trees/react';

import {
  toRuntimeFileTreeOptions,
  type TreesDevFileTreeOptions,
} from '../demo-data';

/**
 * React FileTree - Client-Side Rendered
 * No prerendered HTML, renders entirely on client
 */
export function ReactClientRendered({
  options,
  initialFiles,
  stateConfig,
}: {
  options: Omit<TreesDevFileTreeOptions, 'initialFiles'>;
  initialFiles?: string[];
  stateConfig?: FileTreeStateConfig;
}) {
  const runtimeOptions = toRuntimeFileTreeOptions({
    ...options,
    initialFiles: initialFiles ?? [],
  });
  const { model, ...reactOptions } = runtimeOptions;

  return (
    <FileTreeReact
      model={model}
      options={reactOptions}
      initialExpandedItems={stateConfig?.initialExpandedItems}
      initialSelectedItems={stateConfig?.initialSelectedItems}
      onSelection={stateConfig?.onSelection}
    />
  );
}
