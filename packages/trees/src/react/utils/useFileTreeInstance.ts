import { useCallback, useEffect, useRef } from 'react';

import {
  FileTree,
  type FileTreeOptions,
  type FileTreeSelectionItem,
  type FileTreeStateConfig,
  type GitStatusEntry,
} from '../../FileTree';
import type { FileTreeModel } from '../../model/FileTreeModel';
import type { ContextMenuItem, ContextMenuOpenContext } from '../../types';
import { getGitStatusSignature } from '../../utils/getGitStatusSignature';

interface UseFileTreeInstanceProps {
  model: FileTreeModel;
  options: Omit<FileTreeOptions, 'model'>;

  // State callbacks
  onFilesChange?: (files: string[]) => void;

  // Default (uncontrolled) state
  initialExpandedItems?: string[];
  initialSelectedItems?: string[];
  initialSearchQuery?: string | null;

  // Controlled state
  expandedItems?: string[];
  selectedItems?: string[];
  onExpandedItemsChange?: (items: string[]) => void;
  onSelectedItemsChange?: (items: string[]) => void;
  onSelection?: (items: FileTreeSelectionItem[]) => void;

  // Context menu
  onContextMenuOpen?: (
    item: ContextMenuItem,
    context: ContextMenuOpenContext
  ) => void;
  onContextMenuClose?: () => void;

  // Git status
  gitStatus?: GitStatusEntry[];
}

interface UseFileTreeInstanceReturn {
  ref(node: HTMLElement | null): void | (() => void);
}

export function useFileTreeInstance({
  model,
  options,
  onFilesChange,
  initialExpandedItems,
  initialSelectedItems,
  initialSearchQuery,
  expandedItems,
  selectedItems,
  onExpandedItemsChange,
  onSelectedItemsChange,
  onSelection,
  onContextMenuOpen,
  onContextMenuClose,
  gitStatus,
}: UseFileTreeInstanceProps): UseFileTreeInstanceReturn {
  const containerRef = useRef<HTMLElement | null>(null);
  const instanceRef = useRef<FileTree | null>(null);
  const syncedGitStatusSignatureRef = useRef(getGitStatusSignature(gitStatus));

  // Keep a ref to the latest state-related props so the ref callback can read
  // them at creation time without including them as useMemo deps.
  const statePropsRef = useRef<
    FileTreeStateConfig & {
      gitStatus?: GitStatusEntry[];
      onContextMenuOpen?: (
        item: ContextMenuItem,
        context: ContextMenuOpenContext
      ) => void;
      onContextMenuClose?: () => void;
      model: FileTreeModel;
      onFilesChange?: (files: string[]) => void;
    }
  >({
    model,
    onFilesChange,
    expandedItems,
    selectedItems,
    onExpandedItemsChange,
    onSelectedItemsChange,
    onSelection,
    initialExpandedItems,
    initialSelectedItems,
    gitStatus,
    initialSearchQuery,
    onContextMenuOpen,
    onContextMenuClose,
  });
  statePropsRef.current = {
    model,
    onFilesChange,
    expandedItems,
    selectedItems,
    onExpandedItemsChange,
    onSelectedItemsChange,
    onSelection,
    initialExpandedItems,
    initialSelectedItems,
    gitStatus,
    initialSearchQuery,
    onContextMenuOpen,
    onContextMenuClose,
  };

  // React 19: Return cleanup function, called when ref changes or element unmounts.
  const ref = useCallback(
    (fileTreeContainer: HTMLElement | null) => {
      // Model identity must remain a callback dependency so React can recreate
      // the imperative instance when callers swap models.
      void model;

      if (fileTreeContainer == null) {
        instanceRef.current?.cleanUp();
        instanceRef.current = null;
        containerRef.current = null;
        return;
      }

      const getExistingFileTreeId = (): string | undefined => {
        const children = Array.from(
          fileTreeContainer.shadowRoot?.children ?? []
        );
        const fileTreeElement = children.find(
          (child: Element): child is HTMLElement =>
            child instanceof HTMLElement &&
            child.dataset?.fileTreeId != null &&
            child.dataset.fileTreeId.length > 0
        );
        return fileTreeElement?.dataset?.fileTreeId;
      };

      const clearExistingFileTree = (): void => {
        const children = Array.from(
          fileTreeContainer.shadowRoot?.children ?? []
        );
        const fileTreeElement = children.find(
          (child: Element): child is HTMLElement =>
            child instanceof HTMLElement &&
            child.dataset?.fileTreeId != null &&
            child.dataset.fileTreeId.length > 0
        );
        if (fileTreeElement != null) {
          fileTreeElement.replaceChildren();
        }
      };

      const createInstance = (existingId?: string): FileTree => {
        const sp = statePropsRef.current;
        syncedGitStatusSignatureRef.current = getGitStatusSignature(
          sp.gitStatus
        );
        return new FileTree(
          {
            ...options,
            model: sp.model,
            id: existingId,
            ...(sp.gitStatus != null && { gitStatus: sp.gitStatus }),
          },
          {
            // Controlled values are seeded as initial state once, then synced
            // imperatively by effects below.
            initialExpandedItems: sp.initialExpandedItems ?? sp.expandedItems,
            initialSelectedItems: sp.initialSelectedItems ?? sp.selectedItems,
            initialSearchQuery: sp.initialSearchQuery,
            onExpandedItemsChange: sp.onExpandedItemsChange,
            onSelectedItemsChange: sp.onSelectedItemsChange,
            onSelection: sp.onSelection,
            onFilesChange: sp.onFilesChange,
            onContextMenuOpen: sp.onContextMenuOpen,
            onContextMenuClose: sp.onContextMenuClose,
          }
        );
      };

      const existingFileTreeId = getExistingFileTreeId();

      const isOptionsChange =
        containerRef.current === fileTreeContainer &&
        instanceRef.current != null;

      if (isOptionsChange) {
        instanceRef.current?.cleanUp();
        clearExistingFileTree();
        instanceRef.current = createInstance(existingFileTreeId);
        void instanceRef.current.render({ fileTreeContainer });
      } else {
        containerRef.current = fileTreeContainer;

        const hasPrerenderedContent = existingFileTreeId != null;

        instanceRef.current = createInstance(existingFileTreeId);

        if (hasPrerenderedContent) {
          void instanceRef.current.hydrate({
            fileTreeContainer,
          });
        } else {
          void instanceRef.current.render({ fileTreeContainer });
        }
      }

      return () => {
        instanceRef.current?.cleanUp();
        instanceRef.current = null;
        containerRef.current = null;
      };
    },
    [model, options]
  );

  // Sync controlled expanded items imperatively (no tree recreation)
  useEffect(() => {
    if (expandedItems !== undefined && instanceRef.current != null) {
      instanceRef.current.setExpandedItems(expandedItems);
    }
  }, [expandedItems]);

  // Sync controlled selected items imperatively (no tree recreation)
  useEffect(() => {
    if (selectedItems !== undefined && instanceRef.current != null) {
      instanceRef.current.setSelectedItems(selectedItems);
    }
  }, [selectedItems]);

  const gitStatusSignature = getGitStatusSignature(gitStatus);

  useEffect(() => {
    const instance = instanceRef.current;
    if (instance == null) return;
    if (syncedGitStatusSignatureRef.current === gitStatusSignature) {
      return;
    }
    syncedGitStatusSignatureRef.current = gitStatusSignature;
    instance.setGitStatus(gitStatus);
  }, [gitStatus, gitStatusSignature]);

  useEffect(() => {
    instanceRef.current?.setCallbacks({
      onExpandedItemsChange,
      onSelectedItemsChange,
      onSelection,
      onFilesChange,
      onContextMenuOpen,
      onContextMenuClose,
    });
  }, [
    onExpandedItemsChange,
    onSelectedItemsChange,
    onSelection,
    onFilesChange,
    onContextMenuOpen,
    onContextMenuClose,
  ]);

  return { ref };
}
