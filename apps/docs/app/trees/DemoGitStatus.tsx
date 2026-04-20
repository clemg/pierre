'use client';

import { IconColorDark, IconColorLight } from '@pierre/icons';
import {
  FileTree,
  type FileTreePreloadedData,
  useFileTree,
} from '@pierre/trees/react';
import Link from 'next/link';
import type { CSSProperties } from 'react';
import { useEffect, useMemo, useState } from 'react';

import { FeatureHeader } from '../diff-examples/FeatureHeader';
import { sampleFileList } from './demo-data';
import { TREE_NEW_VIEWPORT_HEIGHTS } from './dimensions';
import {
  TREE_NEW_GIT_STATUS_EXPANDED_PATHS,
  TREE_NEW_GIT_STATUSES,
} from './gitStatusDemoData';
import { getDefaultFileTreePanelClass } from './tree-examples/demo-data';
import { TreeExampleSection } from './tree-examples/TreeExampleSection';
import { PRODUCTS } from '@/app/product-config';
import { Button } from '@/components/ui/button';
import { ButtonGroup, ButtonGroupItem } from '@/components/ui/button-group';
import { Switch } from '@/components/ui/switch';
import type { FileTreePathOptions } from '@/lib/fileTreePathOptions';
import type { GitStatusEntry } from '@/lib/treesCompat';

const GIT_STATUS_ROWS = [
  {
    label: 'added',
    indicator: 'A',
    description: 'New file staged or present in the working tree',
  },
  {
    label: 'modified',
    indicator: 'M',
    description: 'Tracked file changed since the last commit',
  },
  {
    label: 'deleted',
    indicator: 'D',
    description: 'Tracked file removed from the working tree',
  },
  {
    label: 'renamed',
    indicator: 'R',
    description: 'Tracked file moved or renamed',
  },
  {
    label: 'untracked',
    indicator: 'U',
    description: 'New file not yet tracked by Git',
  },
  {
    label: 'ignored',
    indicator: null,
    description: 'Ignored by Git rules; rows inherit muted styling',
  },
  {
    label: 'descendant',
    indicator: 'dot',
    description:
      'Folder contains changed descendants even when the folder itself has no direct status',
  },
] as const;

function escapePathForRegex(path: string): string {
  return path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Keep ignored descendants visible when the demo hides unmodified files so the
// inherited ignored styling still has real rows to act on.
function getVisibleGitStatusPaths(
  paths: readonly string[],
  entries: readonly GitStatusEntry[]
): string[] {
  const directPaths = new Set<string>();
  const ignoredDirectoryPaths: string[] = [];

  for (const entry of entries) {
    if (entry.status === 'ignored' && entry.path.endsWith('/')) {
      ignoredDirectoryPaths.push(entry.path);
      continue;
    }

    directPaths.add(entry.path);
  }

  if (ignoredDirectoryPaths.length === 0) {
    return paths.filter((path) => directPaths.has(path));
  }

  const ignoredDirectoryPattern = new RegExp(
    `^(?:${ignoredDirectoryPaths.map(escapePathForRegex).join('|')})`
  );

  return paths.filter(
    (path) => directPaths.has(path) || ignoredDirectoryPattern.test(path)
  );
}

const FILE_TREE_GIT_STATUS_BASE_OPTIONS: Omit<
  FileTreePathOptions,
  'gitStatus' | 'id'
> = {
  flattenEmptyDirectories: true,
  initialExpandedPaths: TREE_NEW_GIT_STATUS_EXPANDED_PATHS,
  paths: sampleFileList,
  search: false,
  initialVisibleRowCount: TREE_NEW_VIEWPORT_HEIGHTS.gitStatusFull / 30,
};

interface DemoGitStatusProps {
  preloadedData: {
    filteredViewport: FileTreePreloadedData;
    fullViewport: FileTreePreloadedData;
  };
}

export function DemoGitStatus({ preloadedData }: DemoGitStatusProps) {
  const [showUnmodified, setShowUnmodified] = useState(true);
  const [colorMode, setColorMode] = useState<'light' | 'dark'>('dark');

  const activeGitStatus = TREE_NEW_GIT_STATUSES;
  const isDark = colorMode === 'dark';
  const panelStyle = useMemo(
    () =>
      ({
        colorScheme: colorMode,
        '--trees-search-bg-override': isDark ? 'oklch(14.5% 0 0)' : '#fff',
      }) as CSSProperties,
    [colorMode, isDark]
  );
  const visiblePaths = useMemo(() => {
    if (showUnmodified) {
      return sampleFileList;
    }

    return getVisibleGitStatusPaths(sampleFileList, activeGitStatus);
  }, [activeGitStatus, showUnmodified]);

  const { model: fullViewportModel } = useFileTree({
    ...FILE_TREE_GIT_STATUS_BASE_OPTIONS,
    gitStatus: TREE_NEW_GIT_STATUSES,
    id: 'file-tree-git-status-demo-full',
  });
  const { model: filteredViewportModel } = useFileTree({
    ...FILE_TREE_GIT_STATUS_BASE_OPTIONS,
    gitStatus: TREE_NEW_GIT_STATUSES,
    id: 'file-tree-git-status-demo-filtered',
    initialVisibleRowCount: TREE_NEW_VIEWPORT_HEIGHTS.gitStatusFiltered / 30,
  });
  const model = showUnmodified ? fullViewportModel : filteredViewportModel;
  const activePreloadedData = showUnmodified
    ? preloadedData.fullViewport
    : preloadedData.filteredViewport;
  const viewportHeight = showUnmodified
    ? TREE_NEW_VIEWPORT_HEIGHTS.gitStatusFull
    : TREE_NEW_VIEWPORT_HEIGHTS.gitStatusFiltered;

  useEffect(() => {
    model.resetPaths(visiblePaths, {
      initialExpandedPaths: TREE_NEW_GIT_STATUS_EXPANDED_PATHS,
    });
    model.setGitStatus(activeGitStatus);
  }, [activeGitStatus, model, visiblePaths]);

  return (
    <TreeExampleSection>
      <FeatureHeader
        id="git-status"
        title="Show Git status on files"
        description={
          <>
            Use the{' '}
            <Link
              href={`${PRODUCTS.trees.docsPath}#show-git-status-and-row-annotations`}
              className="inline-link"
            >
              <code>gitStatus</code>
            </Link>{' '}
            option to show status badges for added, modified, deleted, renamed,
            untracked, and ignored files. Ignored items inherit their styling
            without rendering an indicator while folders with changed
            descendants get a dot indicator automatically.
          </>
        }
      />

      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-4">
          <div className="gridstack">
            <Button
              variant="outline"
              className="w-full justify-between gap-3 pr-11 pl-3 md:w-auto"
              onClick={() => setShowUnmodified((previous) => !previous)}
            >
              Show unmodified
            </Button>
            <Switch
              checked={showUnmodified}
              onCheckedChange={setShowUnmodified}
              onClick={(event) => event.stopPropagation()}
              className="pointer-events-none mr-3 place-self-center justify-self-end"
            />
          </div>

          <ButtonGroup
            value={colorMode}
            onValueChange={(value) => setColorMode(value as 'light' | 'dark')}
            className="md:ml-auto"
          >
            <ButtonGroupItem value="light">
              <IconColorLight className="size-4" />
              Light
            </ButtonGroupItem>
            <ButtonGroupItem value="dark">
              <IconColorDark className="size-4" />
              Dark
            </ButtonGroupItem>
          </ButtonGroup>
        </div>

        <div className="grid grid-cols-1 items-start gap-6 md:grid-cols-2">
          <FileTree
            className={getDefaultFileTreePanelClass(colorMode)}
            model={model}
            preloadedData={activePreloadedData}
            style={{
              ...panelStyle,
              height: `${String(viewportHeight)}px`,
            }}
          />
          <div className="overflow-hidden rounded-lg border border-[var(--color-border)]">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-muted/50 border-b border-[var(--color-border)]">
                  <th className="px-4 py-2.5 text-left font-medium">Status</th>
                  <th className="px-4 py-2.5 text-left font-medium">
                    Indicator
                  </th>
                  <th className="px-4 py-2.5 text-left font-medium">Meaning</th>
                </tr>
              </thead>
              <tbody>
                {GIT_STATUS_ROWS.map(({ label, indicator, description }) => (
                  <tr
                    key={label}
                    className="border-b border-[var(--color-border)] last:border-b-0"
                  >
                    <td className="px-4 py-2 align-top">
                      <code className="bg-muted rounded-sm border border-[var(--color-border)] px-1.5 py-0.5 font-mono text-xs">
                        {label}
                      </code>
                    </td>
                    <td className="px-4 py-2 align-top">
                      {indicator === 'dot' ? (
                        <span
                          aria-label="Dot indicator"
                          className="bg-foreground/60 mt-1 inline-block size-1.5 rounded-full align-top"
                        />
                      ) : indicator == null ? (
                        <span className="text-muted-foreground text-xs">
                          None
                        </span>
                      ) : (
                        <code className="bg-muted rounded-sm border border-[var(--color-border)] px-1.5 py-0.5 font-mono text-xs">
                          {indicator}
                        </code>
                      )}
                    </td>
                    <td className="text-muted-foreground px-4 py-2">
                      {description}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </TreeExampleSection>
  );
}
