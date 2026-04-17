'use client';

import { IconRefresh } from '@pierre/icons';
import type {
  ContextMenuItem,
  ContextMenuOpenContext,
  GitStatusEntry,
} from '@pierre/trees';
import { FileTree } from '@pierre/trees/react';
import Link from 'next/link';
import type { CSSProperties } from 'react';
import { useCallback, useMemo, useState } from 'react';

import { FeatureHeader } from '../../diff-examples/FeatureHeader';
import { baseTreeOptions, DEFAULT_FILE_TREE_PANEL_CLASS } from './demo-data';
import { TreeExampleSection } from './TreeExampleSection';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
} from '@/components/ui/dropdown-menu';

const DEMO_ID = 'context-menu-demo';

const panelStyle = {
  colorScheme: 'dark',
  '--trees-search-bg-override': 'light-dark(#fff, oklch(14.5% 0 0))',
} as CSSProperties;

const initialFiles = baseTreeOptions.initialFiles;
const initialFilesSet = new Set(initialFiles);

const options = {
  ...baseTreeOptions,
  id: DEMO_ID,
  renaming: true,
};

interface ContextMenuActions {
  onAddFile: (parentPath: string) => void;
  onAddFolder: (parentPath: string) => void;
  onCopyPath: (path: string) => void;
  onDelete: (path: string, isFolder: boolean) => void;
}

export function ContextMenuSectionClient({
  prerenderedHTML,
}: {
  prerenderedHTML: string;
}) {
  const [files, setFiles] = useState(initialFiles);
  const [lastAction, setLastAction] = useState<string | null>(null);
  const [hasChanges, setHasChanges] = useState(false);
  const [resetKey, setResetKey] = useState(0);

  /** Mark any file not in the original set as "added" (directories aren't tracked by git). */
  const gitStatus = useMemo<GitStatusEntry[]>(() => {
    const entries: GitStatusEntry[] = [];
    for (const path of files) {
      if (!initialFilesSet.has(path) && !path.endsWith('/')) {
        entries.push({ path, status: 'added' });
      }
    }
    return entries;
  }, [files]);

  const handleFilesChange = useCallback((nextFiles: string[]) => {
    setFiles(nextFiles);
    setHasChanges(true);
  }, []);

  const handleReset = useCallback(() => {
    setFiles(initialFiles);
    setLastAction(null);
    setHasChanges(false);
    setResetKey((k) => k + 1);
  }, []);

  const actions = useMemo<ContextMenuActions>(
    () => ({
      onAddFile: (parentPath: string) => {
        const name = window.prompt('File name:');
        if (name == null || name.trim() === '') return;
        const newPath = `${parentPath}/${name.trim()}`;
        setFiles((prev) =>
          prev.includes(newPath) ? prev : [...prev, newPath]
        );
        setHasChanges(true);
        setLastAction(`New file → ${newPath}`);
      },
      onAddFolder: (parentPath: string) => {
        const name = window.prompt('Folder name:');
        if (name == null || name.trim() === '') return;
        const newPath = `${parentPath}/${name.trim()}/`;
        setFiles((prev) =>
          prev.includes(newPath) ? prev : [...prev, newPath]
        );
        setHasChanges(true);
        setLastAction(`New folder → ${newPath}`);
      },
      onCopyPath: (path: string) => {
        navigator.clipboard.writeText(path).then(
          () => setLastAction(`Copied → ${path}`),
          () => setLastAction(`Copy failed → ${path}`)
        );
      },
      onDelete: (path: string, isFolder: boolean) => {
        setFiles((prev) => {
          if (isFolder) {
            const prefix = path.endsWith('/') ? path : `${path}/`;
            return prev.filter((f) => f !== path && !f.startsWith(prefix));
          }
          return prev.filter((f) => f !== path);
        });
        setHasChanges(true);
        setLastAction(`Deleted → ${path}`);
      },
    }),
    []
  );

  const renderContextMenu = useCallback(
    (item: ContextMenuItem, context: ContextMenuOpenContext) => {
      return (
        <TreeContextMenu
          item={item}
          context={context}
          actions={actions}
          onAction={setLastAction}
        />
      );
    },
    [actions]
  );

  return (
    <TreeExampleSection>
      <FeatureHeader
        id="context-menu"
        title="Context menu"
        description={
          <>
            Add a custom context menu via the <code>renderContextMenu</code>{' '}
            callback. The tree provides the anchor position, file path, and type
            so you can render any menu component — Radix, headless UI, or plain
            HTML. Click the ellipsis button or press <kbd>Shift+F10</kbd> on a
            focused row.{' '}
            <Link
              href="/preview/trees/docs#core-types-filetreeprops"
              className="inline-link"
            >
              See FileTreeProps…
            </Link>
          </>
        }
      />
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-4">
          <Button
            variant="outline"
            disabled={!hasChanges}
            onClick={handleReset}
          >
            <IconRefresh />
            Reset
          </Button>
        </div>

        <FileTree
          key={resetKey}
          className={DEFAULT_FILE_TREE_PANEL_CLASS}
          prerenderedHTML={prerenderedHTML}
          options={options}
          files={files}
          onFilesChange={handleFilesChange}
          gitStatus={gitStatus}
          initialExpandedItems={['src', 'src/components']}
          style={panelStyle}
          renderContextMenu={renderContextMenu}
        />
        {lastAction != null ? (
          <p className="text-muted-foreground text-sm">
            Last action: <code>{lastAction}</code>
          </p>
        ) : null}
      </div>
    </TreeExampleSection>
  );
}

function TreeContextMenu({
  item,
  context,
  actions,
  onAction,
}: {
  item: ContextMenuItem;
  context: ContextMenuOpenContext;
  actions: ContextMenuActions;
  onAction: (action: string) => void;
}) {
  const fileName = useMemo(() => {
    const segments = item.path.replace(/\/$/, '').split('/');
    return segments[segments.length - 1];
  }, [item.path]);

  const folderPath = useMemo(() => item.path.replace(/\/$/, ''), [item.path]);

  return (
    <DropdownMenu
      open
      onOpenChange={(open) => {
        if (!open) context.close();
      }}
    >
      <DropdownMenuContent
        side="bottom"
        align="end"
        sideOffset={0}
        className="dark w-52"
        onCloseAutoFocus={(e) => e.preventDefault()}
        style={
          {
            position: 'fixed',
            top: context.anchorRect.bottom + 4,
            left: context.anchorRect.right - 208,
          } as CSSProperties
        }
      >
        {item.isFolder ? (
          <>
            <DropdownMenuItem
              onClick={() => {
                context.close();
                actions.onAddFile(folderPath);
              }}
            >
              New file…
              <DropdownMenuShortcut>⌘N</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => {
                context.close();
                actions.onAddFolder(folderPath);
              }}
            >
              New folder…
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        ) : null}
        <DropdownMenuItem
          onClick={() => {
            actions.onCopyPath(item.path);
            context.close();
          }}
        >
          Copy path
          <DropdownMenuShortcut>⌘⇧C</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {context.canRename === true ? (
          <DropdownMenuItem
            onClick={() => {
              onAction(`Rename → ${item.path}`);
              context.startRenaming?.();
            }}
          >
            Rename
            <DropdownMenuShortcut>F2</DropdownMenuShortcut>
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuItem
          variant="danger"
          onClick={() => {
            actions.onDelete(item.path, item.isFolder);
            context.close();
          }}
        >
          Delete {fileName}
          <DropdownMenuShortcut>⌘⌫</DropdownMenuShortcut>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
