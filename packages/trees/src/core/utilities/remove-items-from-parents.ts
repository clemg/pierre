/* oxlint-disable typescript-eslint/no-unsafe-return */
import type { ItemInstance } from '../types/core';

export const removeItemsFromParents = async <T>(
  movedItems: ItemInstance<T>[],
  onChangeChildren: (
    item: ItemInstance<T>,
    newChildrenIds: string[]
  ) => void | Promise<void>
) => {
  const movedItemsIds = movedItems.map((item) => item.getId());
  const uniqueParents = [
    ...new Set(movedItems.map((item) => item.getParent())),
  ];

  let handledRebuildViaItemUpdater = false;

  for (const parent of uniqueParents) {
    const siblings = parent?.getChildren();
    if (siblings != null && parent != null) {
      const newChildren = siblings
        .filter((sibling) => !movedItemsIds.includes(sibling.getId()))
        .map((i) => i.getId());
      await onChangeChildren(parent, newChildren);

      const maybeAsyncParent = parent as ItemInstance<T> & {
        updateCachedChildrenIds?: (childrenIds: string[]) => void;
      };
      if (typeof maybeAsyncParent.updateCachedChildrenIds === 'function') {
        maybeAsyncParent.updateCachedChildrenIds(newChildren);
        handledRebuildViaItemUpdater = true;
      } else {
        movedItems[0].getTree().markBranchDirty(parent.getId(), 'children');
      }
    }
  }

  if (!handledRebuildViaItemUpdater) {
    movedItems[0].getTree().rebuildTree();
  }
};
