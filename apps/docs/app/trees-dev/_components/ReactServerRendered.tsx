'use client';

import type { FileTreeStateConfig } from '@pierre/trees';
import { FileTree as FileTreeReact } from '@pierre/trees/react';

import {
  toRuntimeFileTreeOptions,
  type TreesDevFileTreeOptions,
} from '../demo-data';

/**
 * React FileTree - Server-Side Rendered
 * Uses prerendered HTML for SSR, hydrates on client
 */
export function ReactServerRendered({
  options,
  initialFiles,
  stateConfig,
  prerenderedHTML,
}: {
  options: Omit<TreesDevFileTreeOptions, 'initialFiles'>;
  initialFiles?: string[];
  stateConfig?: FileTreeStateConfig;
  prerenderedHTML: string;
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
      prerenderedHTML={prerenderedHTML}
      initialExpandedItems={stateConfig?.initialExpandedItems}
      initialSelectedItems={stateConfig?.initialSelectedItems}
      onSelection={stateConfig?.onSelection}
    />
  );
}
