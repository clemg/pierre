'use client';

import { FileTree } from '@pierre/trees';
import type { FileTreeStateConfig } from '@pierre/trees';
import { FileTree as FileTreeReact } from '@pierre/trees/react';
import React, { useCallback, useMemo } from 'react';

import { ExampleCard } from '../_components/ExampleCard';
import { useTreesDevSettings } from '../_components/TreesDevSettingsProvider';
import {
  customSpriteSheet,
  sharedDemoStateConfig,
  toRuntimeFileTreeOptions,
  type TreesDevFileTreeOptions,
} from '../demo-data';

const CUSTOM_ICONS_REMAP = {
  'file-tree-icon-file': 'custom-hamburger-icon',
  'file-tree-icon-chevron': {
    name: 'custom-chevron-icon',
    width: 16,
    height: 16,
  },
} as const;

interface CustomIconsDemoClientProps {
  preloadedCustomIconsFileTreeHtml: string;
}

export function CustomIconsDemoClient({
  preloadedCustomIconsFileTreeHtml,
}: CustomIconsDemoClientProps) {
  const { fileTreeOptions, reactOptions, reactFiles } = useTreesDevSettings();

  return (
    <>
      <h1 className="mb-4 text-2xl font-bold">Custom Icons</h1>
      <div
        style={
          {
            '--trees-icon-width-override': '16px',
          } as React.CSSProperties
        }
        className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3"
      >
        <VanillaCustomIcons
          options={fileTreeOptions}
          stateConfig={sharedDemoStateConfig}
        />
        <ReactCustomIcons
          options={reactOptions}
          initialFiles={reactFiles}
          stateConfig={sharedDemoStateConfig}
        />
        <ReactSSRCustomIcons
          options={reactOptions}
          initialFiles={reactFiles}
          stateConfig={sharedDemoStateConfig}
          prerenderedHTML={preloadedCustomIconsFileTreeHtml}
        />
      </div>
    </>
  );
}

function VanillaCustomIcons({
  options,
  stateConfig,
}: {
  options: TreesDevFileTreeOptions;
  stateConfig?: FileTreeStateConfig;
}) {
  const ref = useCallback(
    (node: HTMLDivElement | null) => {
      if (node == null) return;
      node.innerHTML = '';
      const fileTree = new FileTree(
        toRuntimeFileTreeOptions({
          ...options,
          icons: { spriteSheet: customSpriteSheet, remap: CUSTOM_ICONS_REMAP },
        }),
        stateConfig
      );
      fileTree.render({ containerWrapper: node });
      return () => {
        fileTree.cleanUp();
      };
    },
    [options, stateConfig]
  );

  return (
    <ExampleCard
      title="Vanilla — Custom Icons"
      description="Vanilla CSR tree with a custom spritesheet replacing the file icon with a custom file icon"
    >
      <div ref={ref} />
    </ExampleCard>
  );
}

function ReactCustomIcons({
  options,
  initialFiles,
  stateConfig,
}: {
  options: Omit<TreesDevFileTreeOptions, 'initialFiles'>;
  initialFiles?: string[];
  stateConfig?: FileTreeStateConfig;
}) {
  const runtimeOptions = useMemo(
    () =>
      toRuntimeFileTreeOptions({
        ...options,
        initialFiles: initialFiles ?? [],
        icons: { spriteSheet: customSpriteSheet, remap: CUSTOM_ICONS_REMAP },
      }),
    [initialFiles, options]
  );
  const { model, ...reactTreeOptions } = runtimeOptions;

  return (
    <ExampleCard
      title="React — Custom Icons"
      description="React CSR tree with a custom spritesheet replacing the file icon with a custom file icon"
    >
      <FileTreeReact
        model={model}
        options={reactTreeOptions}
        initialExpandedItems={stateConfig?.initialExpandedItems}
        onSelection={stateConfig?.onSelection}
      />
    </ExampleCard>
  );
}

function ReactSSRCustomIcons({
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
  const runtimeOptions = useMemo(
    () =>
      toRuntimeFileTreeOptions({
        ...options,
        initialFiles: initialFiles ?? [],
        icons: { spriteSheet: customSpriteSheet, remap: CUSTOM_ICONS_REMAP },
      }),
    [initialFiles, options]
  );
  const { model, ...reactTreeOptions } = runtimeOptions;

  return (
    <ExampleCard
      title="React (SSR) — Custom Icons"
      description="SSR-hydrated React tree with a custom spritesheet replacing the chevron with a folder icon"
    >
      <FileTreeReact
        model={model}
        options={reactTreeOptions}
        prerenderedHTML={prerenderedHTML}
        initialExpandedItems={stateConfig?.initialExpandedItems}
        onSelection={stateConfig?.onSelection}
      />
    </ExampleCard>
  );
}
