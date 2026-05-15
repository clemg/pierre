'use client';

import {
  type WorkerInitializationRenderOptions,
  WorkerPoolContextProvider,
  type WorkerPoolOptions,
} from '@pierre/diffs/react';
import type { ReactNode } from 'react';

import { PREVIEW_THEME } from '../../(diffshub)/(view)/_components/themes/previewTheme';
import { registerPierreThemes } from '../../(diffshub)/(view)/_components/themes/registerPierreThemes';

// Register custom Pierre themes before the pool first initialises so that
// resolveThemes() can find them when the pool spins up.
registerPierreThemes();

function isMobileBrowser(): boolean {
  const navigator = global.navigator;
  if (navigator == null) {
    return false;
  }

  return (
    navigator.maxTouchPoints > 0 &&
    global.matchMedia?.('(max-width: 767px), (pointer: coarse)').matches ===
      true
  );
}

function getWorkerResourceLimits(): Pick<
  Required<WorkerPoolOptions>,
  'poolSize' | 'totalASTLRUCacheSize'
> {
  return isMobileBrowser()
    ? { poolSize: 1, totalASTLRUCacheSize: 10 }
    : { poolSize: 3, totalASTLRUCacheSize: 100 };
}

const WorkerResourceLimits = getWorkerResourceLimits();

const PoolOptions: WorkerPoolOptions = {
  // We really shouldn't let the pool get too big...
  poolSize: Math.min(
    Math.max(1, (global.navigator?.hardwareConcurrency ?? 1) - 1),
    WorkerResourceLimits.poolSize
  ),
  totalASTLRUCacheSize: WorkerResourceLimits.totalASTLRUCacheSize,
  workerFactory() {
    return new Worker(
      new URL('@pierre/diffs/worker/worker.js', import.meta.url)
    );
  },
};

const HighlighterOptions: WorkerInitializationRenderOptions = {
  theme: PREVIEW_THEME,
  langs: [
    'cpp',
    'css',
    'go',
    'python',
    'rust',
    'sh',
    'swift',
    'tsx',
    'typescript',
    'zig',
  ],
  preferredHighlighter: 'shiki-wasm',
};

interface WorkerPoolProps {
  children: ReactNode;
  highlighterOptions?: WorkerInitializationRenderOptions;
  poolOptions?: WorkerPoolOptions;
}

export function WorkerPoolContext({
  children,
  highlighterOptions = HighlighterOptions,
  poolOptions = PoolOptions,
}: WorkerPoolProps) {
  return (
    <WorkerPoolContextProvider
      poolOptions={poolOptions}
      highlighterOptions={highlighterOptions}
    >
      {children}
    </WorkerPoolContextProvider>
  );
}
