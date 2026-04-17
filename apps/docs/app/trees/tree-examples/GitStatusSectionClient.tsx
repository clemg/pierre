'use client';

import {
  IconColorDark,
  IconColorLight,
  IconSymbolDiffstat,
} from '@pierre/icons';
import { PATH_STORE_TREES_DEFAULT_ITEM_HEIGHT } from '@pierre/trees/path-store';
import {
  FileTree,
  type FileTreePreloadedData,
  useFileTree,
} from '@pierre/trees/path-store/react';
import Link from 'next/link';
import type { CSSProperties } from 'react';
import {
  useLayoutEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from 'react';

import { FeatureHeader } from '../../diff-examples/FeatureHeader';
import { sampleFileList } from '../../trees/demo-data';
import {
  DEFAULT_FILE_TREE_PANEL_CLASS,
  GIT_STATUSES_A,
  GIT_STATUSES_B,
  gitStatusPathStoreOptions,
} from './demo-data';
import { GIT_STATUS_EXPANDED_PATHS } from './git-status-config';
import { TreeExampleSection } from './TreeExampleSection';
import { Button } from '@/components/ui/button';
import { ButtonGroup, ButtonGroupItem } from '@/components/ui/button-group';
import { Switch } from '@/components/ui/switch';

// Initial row count the server preload was sized for. Used only to seed
// `useSyncExternalStore` on the server pass so the first paint does not flash
// through a too-short panel before the client subscription picks up the real
// value from the path-store model.
const INITIAL_ROW_COUNT_FALLBACK = 22;

// Vertical padding baked into `DEFAULT_FILE_TREE_PANEL_CLASS` (`p-3` = 12px
// top and bottom) plus 2px for block borders. We size the outer panel by
// `rowCount * itemHeight + `PANEL_VERTICAL_PADDING_PX` so the path-store's
// `host.clientHeight`-derived viewport matches the row count exactly; otherwise
// the padding eats into the viewport and the last row gets clipped by the host's
// overflow:hidden.
const PANEL_VERTICAL_PADDING_PX = 26;

export function GitStatusSectionClient({
  preloaded,
}: {
  preloaded: FileTreePreloadedData;
}) {
  const [enabled, setEnabled] = useState(true);
  const [showUnmodified, setShowUnmodified] = useState(true);
  const [useSetB, setUseSetB] = useState(false);
  const [colorMode, setColorMode] = useState<'light' | 'dark'>('dark');

  const isDark = colorMode === 'dark';

  const activeGitStatus = useMemo(
    () => (useSetB ? GIT_STATUSES_B : GIT_STATUSES_A),
    [useSetB]
  );

  const gitStatus = useMemo(
    () => (enabled ? activeGitStatus : undefined),
    [activeGitStatus, enabled]
  );

  const visibleFiles = useMemo(() => {
    if (!enabled || showUnmodified) {
      return sampleFileList;
    }
    const changedPaths = new Set(activeGitStatus.map((entry) => entry.path));
    return sampleFileList.filter((path) => changedPaths.has(path));
  }, [activeGitStatus, enabled, showUnmodified]);

  // Instantiate the model with the initial state that matches the server
  // preload (all files + GIT_STATUSES_A + showUnmodified=true + enabled=true).
  // We intentionally do not pass `viewportHeight` here — the model resolves
  // its viewport from `host.clientHeight` at render time, so the CSS `height`
  // we set below via `panelStyle` is what actually drives virtualization. The
  // `ResizeObserver` watcher in `packages/trees/src/path-store/view.tsx`
  // picks up subsequent height changes automatically.
  const { model } = useFileTree({
    ...gitStatusPathStoreOptions(undefined, GIT_STATUSES_A),
    id: preloaded.id,
    initialExpandedPaths: GIT_STATUS_EXPANDED_PATHS,
  });

  // Push the current path set into the controller. This updates the visible
  // row count (notifying `useSyncExternalStore` below) but intentionally does
  // NOT re-invoke `renderPathStoreTreesRoot`; the paired layout effect below
  // is what reconciles the shadow-DOM viewport with the new host size.
  useLayoutEffect(() => {
    model.resetPaths(visibleFiles, {
      initialExpandedPaths: GIT_STATUS_EXPANDED_PATHS,
    });
  }, [model, visibleFiles]);

  // React to the model's visible row count so the outer panel height snaps
  // tightly to what is actually rendered. This is what eliminates dead space
  // when "Show unmodified" is turned off and avoids a scrollbar when the
  // tree is larger than a fixed viewport.
  const rowCount = useSyncExternalStore(
    (listener) => model.subscribe(listener),
    () => model.getVisibleRowCount(),
    () => INITIAL_ROW_COUNT_FALLBACK
  );
  const panelHeight =
    Math.max(rowCount, 1) * PATH_STORE_TREES_DEFAULT_ITEM_HEIGHT +
    PANEL_VERTICAL_PADDING_PX;

  // Apply gitStatus — and, crucially, re-run after any row-count-driven host
  // resize. `setGitStatus` calls `renderPathStoreTreesRoot`, which re-reads
  // `host.clientHeight` to resolve its viewportHeight. Keying this on
  // `rowCount` ensures it runs in the commit phase AFTER the host's inline
  // `height` has been updated to the new `panelHeight`; without that, the
  // path-store would keep virtualizing against the previous (smaller) host
  // size and clip the newly-visible rows.
  useLayoutEffect(() => {
    model.setGitStatus(gitStatus);
  }, [model, gitStatus, rowCount]);

  const panelStyle = {
    colorScheme: colorMode,
    height: `${panelHeight}px`,
    '--trees-search-bg-override': isDark ? 'oklch(14.5% 0 0)' : '#fff',
  } as CSSProperties;

  return (
    <TreeExampleSection>
      <FeatureHeader
        id="git-status"
        title="Show Git status on files"
        description={
          <>
            Use the{' '}
            <Link href="/preview/trees/docs#git-status" className="inline-link">
              <code>gitStatus</code>
            </Link>{' '}
            prop to show indicators on files for added, modified, and deleted
            files. Folders that contain changed descendants automatically
            receive a change hint. Toggle between two datasets to simulate
            different Git statuses.{' '}
          </>
        }
      />
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-4">
          <div className="gridstack">
            <Button
              variant="outline"
              className="w-full justify-between gap-3 pr-11 pl-3 md:w-auto"
              onClick={() => setEnabled((prev) => !prev)}
            >
              <div className="flex items-center gap-2">
                <IconSymbolDiffstat />
                Show Git status
              </div>
            </Button>
            <Switch
              checked={enabled}
              onCheckedChange={setEnabled}
              onClick={(e) => e.stopPropagation()}
              className="pointer-events-none mr-3 place-self-center justify-self-end"
            />
          </div>
          <div className="gridstack">
            <Button
              variant="outline"
              className="w-full justify-between gap-3 pr-11 pl-3 md:w-auto"
              onClick={() => setShowUnmodified((prev) => !prev)}
            >
              Show unmodified
            </Button>
            <Switch
              checked={showUnmodified}
              onCheckedChange={setShowUnmodified}
              onClick={(e) => e.stopPropagation()}
              className="pointer-events-none mr-3 place-self-center justify-self-end"
            />
          </div>
          <ButtonGroup
            value={useSetB ? 'set-b' : 'set-a'}
            onValueChange={(value) => setUseSetB(value === 'set-b')}
          >
            <ButtonGroupItem value="set-a">Changeset A</ButtonGroupItem>
            <ButtonGroupItem value="set-b">Changeset B</ButtonGroupItem>
          </ButtonGroup>
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

        <div className={isDark ? 'dark' : ''}>
          <FileTree
            model={model}
            preloadedData={preloaded}
            className={DEFAULT_FILE_TREE_PANEL_CLASS}
            style={panelStyle}
          />
        </div>
      </div>
    </TreeExampleSection>
  );
}
