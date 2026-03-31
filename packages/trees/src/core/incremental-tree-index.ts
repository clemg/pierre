import type { ItemMeta } from '../features/tree/types';

const ORDER_KEY_GAP = 1024;
const VISIBLE_BLOCK_SIZE = 128;

type ChildrenLoadState = 'unknown' | 'loading' | 'loaded' | 'invalidated';

interface InternalTreeNode {
  id: string;
  parentId: string | null;
  children: string[];
  orderKey: number;
  level: number;
  expanded: boolean;
  posInSet: number;
  setSize: number;
  childrenState: ChildrenLoadState;
}

interface VisibleItemMetaRecord {
  parentId: string;
  level: number;
  posInSet: number;
  setSize: number;
}

interface VisibleBlock {
  ids: string[];
  start: number;
}

interface VisibleLocation {
  block: VisibleBlock;
  offset: number;
}

export interface IncrementalTreeIndexAdapter {
  retrieveChildrenIds: (itemId: string) => string[] | undefined;
  getLoadingChildrenIds: () => readonly string[] | undefined;
}

export interface IncrementalTreeRebuildInput {
  rootId: string;
  expandedItems: readonly string[];
  dataLoaderIdentity: unknown;
  forceFull?: boolean;
}

export interface IncrementalTreeRebuildResult {
  mode: 'full' | 'incremental' | 'noop';
  visibleChanged: boolean;
}

function areIdArraysEqual(left: readonly string[], right: readonly string[]) {
  if (left === right) {
    return true;
  }

  if (left.length !== right.length) {
    return false;
  }

  for (let index = 0; index < left.length; index++) {
    if (left[index] !== right[index]) {
      return false;
    }
  }

  return true;
}

function normalizeChildren(
  children: readonly string[],
  parentId: string
): string[] {
  const normalized: string[] = [];
  const seen = new Set<string>();

  for (let index = 0; index < children.length; index++) {
    const childId = children[index];
    if (childId === parentId || seen.has(childId)) {
      continue;
    }
    seen.add(childId);
    normalized.push(childId);
  }

  return normalized;
}

class VisibleBlockIndex {
  private readonly blocks: VisibleBlock[] = [];
  private readonly locationById = new Map<string, VisibleLocation>();
  private readonly blockSize: number;
  private size = 0;

  constructor(blockSize: number) {
    this.blockSize = Math.max(16, blockSize);
  }

  get length() {
    return this.size;
  }

  clear() {
    this.blocks.length = 0;
    this.locationById.clear();
    this.size = 0;
  }

  toArray(): string[] {
    if (this.size === 0) {
      return [];
    }

    const ids = new Array<string>(this.size);
    let nextIndex = 0;

    for (let blockIndex = 0; blockIndex < this.blocks.length; blockIndex++) {
      const block = this.blocks[blockIndex];
      for (let offset = 0; offset < block.ids.length; offset++) {
        ids[nextIndex] = block.ids[offset];
        nextIndex += 1;
      }
    }

    return ids;
  }

  replaceAll(ids: readonly string[]) {
    this.clear();

    if (ids.length === 0) {
      return;
    }

    let start = 0;
    for (let index = 0; index < ids.length; index += this.blockSize) {
      const blockIds = ids.slice(index, index + this.blockSize);
      const block: VisibleBlock = {
        ids: blockIds,
        start,
      };
      this.blocks.push(block);
      this.rebuildLocationsForBlock(block);
      start += blockIds.length;
    }

    this.size = ids.length;
  }

  getIndex(itemId: string): number | undefined {
    const location = this.locationById.get(itemId);
    if (location == null) {
      return undefined;
    }

    return location.block.start + location.offset;
  }

  getIdAt(index: number): string | undefined {
    if (index < 0 || index >= this.size) {
      return undefined;
    }

    let low = 0;
    let high = this.blocks.length - 1;

    while (low <= high) {
      const middle = (low + high) >>> 1;
      const block = this.blocks[middle];
      const blockStart = block.start;
      const blockEnd = blockStart + block.ids.length;

      if (index < blockStart) {
        high = middle - 1;
      } else if (index >= blockEnd) {
        low = middle + 1;
      } else {
        return block.ids[index - blockStart];
      }
    }

    return undefined;
  }

  insertAt(index: number, ids: readonly string[]) {
    if (ids.length === 0) {
      return;
    }

    const normalizedIndex = Math.max(0, Math.min(index, this.size));

    if (this.blocks.length === 0) {
      this.replaceAll(ids);
      return;
    }

    const { blockIndex, offset } = this.findBlockAtIndex(normalizedIndex);
    const initialBlock = this.blocks[blockIndex];
    initialBlock.ids.splice(offset, 0, ...ids);

    const changedBlocks = new Set<number>([blockIndex]);
    this.splitOversizedBlocks(blockIndex, changedBlocks);

    this.size += ids.length;

    const firstChangedIndex = Math.min(...changedBlocks);
    this.recomputeStarts(firstChangedIndex);

    for (const changedBlockIndex of changedBlocks) {
      const block = this.blocks[changedBlockIndex];
      if (block != null) {
        this.rebuildLocationsForBlock(block);
      }
    }
  }

  removeRange(index: number, count: number): string[] {
    if (count <= 0 || this.size === 0) {
      return [];
    }

    const startIndex = Math.max(0, Math.min(index, this.size));
    if (startIndex >= this.size) {
      return [];
    }

    let remaining = Math.min(count, this.size - startIndex);
    const removedIds: string[] = [];
    let firstChangedIndex: number | null = null;

    while (remaining > 0) {
      const { blockIndex, offset } = this.findBlockAtIndex(startIndex);
      const block = this.blocks[blockIndex];
      if (block == null) {
        break;
      }

      const removableCount = Math.min(remaining, block.ids.length - offset);
      const removed = block.ids.splice(offset, removableCount);

      for (
        let removedIndex = 0;
        removedIndex < removed.length;
        removedIndex++
      ) {
        const removedId = removed[removedIndex];
        this.locationById.delete(removedId);
        removedIds.push(removedId);
      }

      if (firstChangedIndex == null || blockIndex < firstChangedIndex) {
        firstChangedIndex = blockIndex;
      }

      if (block.ids.length === 0) {
        this.blocks.splice(blockIndex, 1);
      } else {
        this.rebuildLocationsForBlock(block);
      }

      remaining -= removableCount;
    }

    if (removedIds.length === 0) {
      return removedIds;
    }

    this.size -= removedIds.length;

    if (this.blocks.length === 0) {
      return removedIds;
    }

    const mergeStart = Math.max(0, (firstChangedIndex ?? 0) - 1);
    this.mergeSmallNeighborBlocks(mergeStart);
    this.recomputeStarts(mergeStart);

    return removedIds;
  }

  private findBlockAtIndex(index: number): {
    blockIndex: number;
    offset: number;
  } {
    if (this.blocks.length === 0) {
      return { blockIndex: 0, offset: 0 };
    }

    if (index >= this.size) {
      const lastIndex = this.blocks.length - 1;
      const lastBlock = this.blocks[lastIndex];
      return {
        blockIndex: lastIndex,
        offset: lastBlock.ids.length,
      };
    }

    let low = 0;
    let high = this.blocks.length - 1;

    while (low <= high) {
      const middle = (low + high) >>> 1;
      const block = this.blocks[middle];
      const blockStart = block.start;
      const blockEnd = blockStart + block.ids.length;

      if (index < blockStart) {
        high = middle - 1;
      } else if (index >= blockEnd) {
        low = middle + 1;
      } else {
        return {
          blockIndex: middle,
          offset: index - blockStart,
        };
      }
    }

    const fallbackIndex = Math.max(0, Math.min(low, this.blocks.length - 1));
    return {
      blockIndex: fallbackIndex,
      offset: 0,
    };
  }

  private splitOversizedBlocks(
    startBlockIndex: number,
    changedBlocks: Set<number>
  ) {
    let blockIndex = startBlockIndex;

    while (blockIndex < this.blocks.length) {
      const block = this.blocks[blockIndex];
      if (block == null || block.ids.length <= this.blockSize) {
        break;
      }

      const splitIndex = Math.ceil(block.ids.length / 2);
      const tail = block.ids.splice(splitIndex);
      const nextBlock: VisibleBlock = {
        ids: tail,
        start: 0,
      };

      this.blocks.splice(blockIndex + 1, 0, nextBlock);
      changedBlocks.add(blockIndex);
      changedBlocks.add(blockIndex + 1);

      blockIndex += 1;
    }
  }

  private mergeSmallNeighborBlocks(startBlockIndex: number) {
    let index = startBlockIndex;

    while (index < this.blocks.length - 1) {
      const current = this.blocks[index];
      const next = this.blocks[index + 1];

      if (current.ids.length + next.ids.length > this.blockSize) {
        index += 1;
        continue;
      }

      current.ids.push(...next.ids);
      this.blocks.splice(index + 1, 1);
      this.rebuildLocationsForBlock(current);
    }
  }

  private recomputeStarts(startBlockIndex: number) {
    if (this.blocks.length === 0) {
      return;
    }

    const normalizedStartIndex = Math.max(
      0,
      Math.min(startBlockIndex, this.blocks.length - 1)
    );

    let start =
      normalizedStartIndex === 0
        ? 0
        : this.blocks[normalizedStartIndex - 1].start +
          this.blocks[normalizedStartIndex - 1].ids.length;

    for (
      let blockIndex = normalizedStartIndex;
      blockIndex < this.blocks.length;
      blockIndex++
    ) {
      const block = this.blocks[blockIndex];
      block.start = start;
      start += block.ids.length;
    }
  }

  private rebuildLocationsForBlock(block: VisibleBlock) {
    for (let offset = 0; offset < block.ids.length; offset++) {
      const itemId = block.ids[offset];
      this.locationById.set(itemId, { block, offset });
    }
  }
}

interface VisibleFragment {
  ids: string[];
  meta: VisibleItemMetaRecord[];
}

// Maintains a canonical node store plus a block-based visible-order index so
// local edits can update only the affected visible branch instead of
// recomputing the entire flattened tree.
export class IncrementalTreeIndex {
  private readonly adapter: IncrementalTreeIndexAdapter;

  private readonly nodes = new Map<string, InternalTreeNode>();
  private readonly visible = new VisibleBlockIndex(VISIBLE_BLOCK_SIZE);
  private readonly visibleMetaById = new Map<string, VisibleItemMetaRecord>();
  private readonly dirtyParents = new Set<string>();
  private readonly childrenSnapshotCache = new Map<string, string[]>();

  private expandedItemIds = new Set<string>();
  private rootId: string | null = null;
  private dataLoaderIdentity: unknown = null;

  private visibleIdsCache: string[] | null = null;
  private visibleMetaSnapshotCache: ItemMeta[] | null = null;

  constructor(adapter: IncrementalTreeIndexAdapter) {
    this.adapter = adapter;
  }

  getVisibleItemIds(): string[] {
    this.visibleIdsCache ??= this.visible.toArray();
    return this.visibleIdsCache;
  }

  getVisibleIndex(itemId: string): number | undefined {
    return this.visible.getIndex(itemId);
  }

  getVisibleMeta(itemId: string): VisibleItemMetaRecord | undefined {
    return this.visibleMetaById.get(itemId);
  }

  getVisibleMetaSnapshot(): ItemMeta[] {
    this.visibleMetaSnapshotCache ??= this.buildVisibleMetaSnapshot();
    return this.visibleMetaSnapshotCache;
  }

  markBranchDirty(
    itemId: string,
    reason: 'children' | 'invalidated' = 'children'
  ) {
    const node = this.ensureNode(itemId);
    if (reason === 'invalidated') {
      node.childrenState = 'invalidated';
    }
    this.dirtyParents.add(itemId);
  }

  rebuild(input: IncrementalTreeRebuildInput): IncrementalTreeRebuildResult {
    const nextExpanded = new Set(input.expandedItems);

    this.childrenSnapshotCache.clear();

    const needsFullRebuild =
      input.forceFull === true ||
      this.rootId !== input.rootId ||
      this.dataLoaderIdentity !== input.dataLoaderIdentity ||
      !this.nodes.has(input.rootId);

    if (needsFullRebuild) {
      this.fullRebuild(input.rootId, nextExpanded, input.dataLoaderIdentity);
      return {
        mode: 'full',
        visibleChanged: true,
      };
    }

    let visibleChanged = false;

    const collapsedIds: string[] = [];
    for (const itemId of this.expandedItemIds) {
      if (!nextExpanded.has(itemId)) {
        collapsedIds.push(itemId);
      }
    }

    for (let index = 0; index < collapsedIds.length; index++) {
      const collapsedItemId = collapsedIds[index];
      if (this.collapseVisibleNode(collapsedItemId)) {
        visibleChanged = true;
      }
      const node = this.nodes.get(collapsedItemId);
      if (node != null) {
        node.expanded = false;
      }
    }

    const dirtyRoots = this.getMinimalDirtyParents(input.rootId);
    for (let index = 0; index < dirtyRoots.length; index++) {
      const dirtyRootId = dirtyRoots[index];
      if (this.refreshVisibleBranch(dirtyRootId, nextExpanded, input.rootId)) {
        visibleChanged = true;
      }
    }

    const expandedIds: string[] = [];
    for (const itemId of nextExpanded) {
      if (!this.expandedItemIds.has(itemId)) {
        expandedIds.push(itemId);
      }
    }

    for (let index = 0; index < expandedIds.length; index++) {
      const expandedItemId = expandedIds[index];
      const node = this.ensureNode(expandedItemId);
      node.expanded = true;

      if (this.expandVisibleNode(expandedItemId, nextExpanded)) {
        visibleChanged = true;
      }
    }

    this.expandedItemIds = nextExpanded;
    this.rootId = input.rootId;
    this.dataLoaderIdentity = input.dataLoaderIdentity;
    this.dirtyParents.clear();

    if (visibleChanged) {
      this.invalidateVisibleCaches();
    }

    return {
      mode: visibleChanged ? 'incremental' : 'noop',
      visibleChanged,
    };
  }

  private fullRebuild(
    rootId: string,
    expandedItems: Set<string>,
    dataLoaderIdentity: unknown
  ) {
    this.nodes.clear();
    this.visible.clear();
    this.visibleMetaById.clear();
    this.dirtyParents.clear();

    const rootNode = this.ensureNode(rootId, null, -1);
    rootNode.expanded = true;

    const fragment = this.collectVisibleChildren(
      rootId,
      -1,
      expandedItems,
      false
    );
    this.visible.replaceAll(fragment.ids);

    for (let index = 0; index < fragment.ids.length; index++) {
      const itemId = fragment.ids[index];
      const meta = fragment.meta[index];
      this.visibleMetaById.set(itemId, meta);
    }

    this.expandedItemIds = expandedItems;
    this.rootId = rootId;
    this.dataLoaderIdentity = dataLoaderIdentity;
    this.invalidateVisibleCaches();
  }

  private collapseVisibleNode(itemId: string): boolean {
    const visibleIndex = this.visible.getIndex(itemId);
    const visibleMeta = this.visibleMetaById.get(itemId);

    if (visibleIndex == null || visibleMeta == null) {
      return false;
    }

    const removedIds = this.removeVisibleDescendants(
      visibleIndex,
      visibleMeta.level
    );

    return removedIds.length > 0;
  }

  private expandVisibleNode(
    itemId: string,
    expandedItems: Set<string>
  ): boolean {
    const visibleIndex = this.visible.getIndex(itemId);
    const visibleMeta = this.visibleMetaById.get(itemId);

    if (visibleIndex == null || visibleMeta == null) {
      return false;
    }

    if (this.hasVisibleDescendants(visibleIndex, visibleMeta.level)) {
      return false;
    }

    const fragment = this.collectVisibleChildren(
      itemId,
      visibleMeta.level,
      expandedItems
    );

    if (fragment.ids.length === 0) {
      return false;
    }

    this.visible.insertAt(visibleIndex + 1, fragment.ids);

    for (let index = 0; index < fragment.ids.length; index++) {
      const fragmentId = fragment.ids[index];
      this.visibleMetaById.set(fragmentId, fragment.meta[index]);
    }

    return true;
  }

  private refreshVisibleBranch(
    parentId: string,
    expandedItems: Set<string>,
    rootId: string
  ): boolean {
    const parentNode = this.ensureNode(
      parentId,
      parentId === rootId ? null : undefined,
      parentId === rootId ? -1 : undefined
    );
    parentNode.expanded = parentId === rootId || expandedItems.has(parentId);

    this.readAndSyncChildren(parentId, expandedItems);

    if (parentId === rootId) {
      this.visible.clear();
      this.visibleMetaById.clear();

      const fragment = this.collectVisibleChildren(
        rootId,
        -1,
        expandedItems,
        false
      );
      this.visible.replaceAll(fragment.ids);

      for (let index = 0; index < fragment.ids.length; index++) {
        const fragmentId = fragment.ids[index];
        this.visibleMetaById.set(fragmentId, fragment.meta[index]);
      }

      return true;
    }

    const parentVisibleIndex = this.visible.getIndex(parentId);
    const parentVisibleMeta = this.visibleMetaById.get(parentId);

    if (parentVisibleIndex == null || parentVisibleMeta == null) {
      return false;
    }

    const removedIds = this.removeVisibleDescendants(
      parentVisibleIndex,
      parentVisibleMeta.level
    );

    if (!expandedItems.has(parentId)) {
      return removedIds.length > 0;
    }

    const fragment = this.collectVisibleChildren(
      parentId,
      parentVisibleMeta.level,
      expandedItems
    );

    if (fragment.ids.length > 0) {
      this.visible.insertAt(parentVisibleIndex + 1, fragment.ids);
      for (let index = 0; index < fragment.ids.length; index++) {
        const fragmentId = fragment.ids[index];
        this.visibleMetaById.set(fragmentId, fragment.meta[index]);
      }
    }

    return removedIds.length > 0 || fragment.ids.length > 0;
  }

  private removeVisibleDescendants(
    parentIndex: number,
    parentLevel: number
  ): string[] {
    let nextIndex = parentIndex + 1;
    let removeCount = 0;

    while (nextIndex < this.visible.length) {
      const visibleId = this.visible.getIdAt(nextIndex);
      if (visibleId == null) {
        break;
      }

      const visibleMeta = this.visibleMetaById.get(visibleId);
      if (visibleMeta == null || visibleMeta.level <= parentLevel) {
        break;
      }

      removeCount += 1;
      nextIndex += 1;
    }

    if (removeCount === 0) {
      return [];
    }

    const removedIds = this.visible.removeRange(parentIndex + 1, removeCount);

    for (let index = 0; index < removedIds.length; index++) {
      const removedId = removedIds[index];
      this.visibleMetaById.delete(removedId);
    }

    return removedIds;
  }

  private hasVisibleDescendants(itemIndex: number, itemLevel: number): boolean {
    const nextVisibleId = this.visible.getIdAt(itemIndex + 1);
    if (nextVisibleId == null) {
      return false;
    }

    const nextMeta = this.visibleMetaById.get(nextVisibleId);
    if (nextMeta == null) {
      return false;
    }

    return nextMeta.level > itemLevel;
  }

  private collectVisibleChildren(
    parentId: string,
    parentLevel: number,
    expandedItems = this.expandedItemIds,
    checkExistingVisible = true
  ): VisibleFragment {
    const fragment: VisibleFragment = {
      ids: [],
      meta: [],
    };

    const ancestorSet = new Set<string>([parentId]);
    const fragmentIdSet = new Set<string>();

    this.appendVisibleChildren(
      parentId,
      parentLevel,
      expandedItems,
      ancestorSet,
      fragmentIdSet,
      fragment,
      checkExistingVisible
    );

    return fragment;
  }

  // Traverses a branch in pre-order and appends only the visible nodes for the
  // current expanded-item set. The caller supplies reusable output arrays so we
  // avoid repeated allocations while mutating local branches.
  private appendVisibleChildren(
    parentId: string,
    parentLevel: number,
    expandedItems: Set<string>,
    ancestorSet: Set<string>,
    fragmentIdSet: Set<string>,
    fragment: VisibleFragment,
    checkExistingVisible: boolean
  ) {
    const children = this.readAndSyncChildren(parentId, expandedItems);
    const setSize = children.length;

    for (let childIndex = 0; childIndex < children.length; childIndex++) {
      const childId = children[childIndex];

      if (
        ancestorSet.has(childId) ||
        fragmentIdSet.has(childId) ||
        (checkExistingVisible && this.visible.getIndex(childId) != null)
      ) {
        continue;
      }

      const childLevel = parentLevel + 1;
      const childNode = this.ensureNode(childId, parentId, childLevel);
      childNode.expanded = expandedItems.has(childId);
      childNode.posInSet = childIndex;
      childNode.setSize = setSize;

      fragment.ids.push(childId);
      fragment.meta.push({
        parentId,
        level: childLevel,
        posInSet: childIndex,
        setSize,
      });
      fragmentIdSet.add(childId);

      if (!childNode.expanded) {
        continue;
      }

      ancestorSet.add(childId);
      this.appendVisibleChildren(
        childId,
        childLevel,
        expandedItems,
        ancestorSet,
        fragmentIdSet,
        fragment,
        checkExistingVisible
      );
      ancestorSet.delete(childId);
    }
  }

  private readAndSyncChildren(
    parentId: string,
    expandedItems: Set<string>
  ): string[] {
    const cachedChildren = this.childrenSnapshotCache.get(parentId);
    const children =
      cachedChildren ??
      normalizeChildren(this.safeRetrieveChildren(parentId), parentId);

    if (cachedChildren == null) {
      this.childrenSnapshotCache.set(parentId, children);
    }

    this.syncChildren(parentId, children, expandedItems);
    return this.nodes.get(parentId)?.children ?? [];
  }

  private safeRetrieveChildren(parentId: string): string[] {
    try {
      return this.adapter.retrieveChildrenIds(parentId) ?? [];
    } catch {
      return [];
    }
  }

  private syncChildren(
    parentId: string,
    nextChildrenIds: readonly string[],
    expandedItems: Set<string>
  ) {
    const parentNode = this.ensureNode(parentId);
    const currentChildren = parentNode.children;

    const loadingChildren = this.adapter.getLoadingChildrenIds();
    parentNode.childrenState =
      loadingChildren?.includes(parentId) === true ? 'loading' : 'loaded';

    if (!areIdArraysEqual(currentChildren, nextChildrenIds)) {
      const nextChildrenSet = new Set<string>(nextChildrenIds);
      for (let index = 0; index < currentChildren.length; index++) {
        const previousChildId = currentChildren[index];
        if (!nextChildrenSet.has(previousChildId)) {
          const previousChild = this.nodes.get(previousChildId);
          if (previousChild?.parentId === parentId) {
            previousChild.parentId = null;
          }
        }
      }

      parentNode.children = [...nextChildrenIds];
    }

    const setSize = parentNode.children.length;

    for (
      let childIndex = 0;
      childIndex < parentNode.children.length;
      childIndex++
    ) {
      const childId = parentNode.children[childIndex];
      const childNode = this.ensureNode(
        childId,
        parentId,
        parentNode.level + 1
      );

      childNode.parentId = parentId;
      childNode.level = parentNode.level + 1;
      childNode.orderKey = (childIndex + 1) * ORDER_KEY_GAP;
      childNode.posInSet = childIndex;
      childNode.setSize = setSize;
      childNode.expanded = expandedItems.has(childId);
    }
  }

  private ensureNode(
    itemId: string,
    parentId: string | null | undefined = undefined,
    level: number | undefined = undefined
  ): InternalTreeNode {
    const existingNode = this.nodes.get(itemId);
    if (existingNode != null) {
      if (parentId !== undefined) {
        existingNode.parentId = parentId;
      }
      if (level != null) {
        existingNode.level = level;
      }
      return existingNode;
    }

    const createdNode: InternalTreeNode = {
      id: itemId,
      parentId: parentId ?? null,
      children: [],
      orderKey: 0,
      level: level ?? 0,
      expanded: this.expandedItemIds.has(itemId),
      posInSet: 0,
      setSize: 1,
      childrenState: 'unknown',
    };

    this.nodes.set(itemId, createdNode);
    return createdNode;
  }

  private getMinimalDirtyParents(rootId: string): string[] {
    if (this.dirtyParents.size === 0) {
      return [];
    }

    const dirtyIds = [...this.dirtyParents];
    dirtyIds.sort(
      (leftId, rightId) =>
        this.getNodeLevel(leftId) - this.getNodeLevel(rightId)
    );

    const selectedIds: string[] = [];
    const selectedSet = new Set<string>();

    for (let index = 0; index < dirtyIds.length; index++) {
      const dirtyId = dirtyIds[index];

      if (dirtyId === rootId) {
        return [rootId];
      }

      let ancestorId = this.nodes.get(dirtyId)?.parentId ?? null;
      let shouldSkip = false;

      while (ancestorId != null) {
        if (selectedSet.has(ancestorId)) {
          shouldSkip = true;
          break;
        }
        ancestorId = this.nodes.get(ancestorId)?.parentId ?? null;
      }

      if (shouldSkip) {
        continue;
      }

      selectedSet.add(dirtyId);
      selectedIds.push(dirtyId);
    }

    return selectedIds;
  }

  private getNodeLevel(itemId: string): number {
    const node = this.nodes.get(itemId);
    if (node == null) {
      return Number.MAX_SAFE_INTEGER;
    }

    return node.level;
  }

  private buildVisibleMetaSnapshot(): ItemMeta[] {
    const visibleIds = this.getVisibleItemIds();
    const metaSnapshot = new Array<ItemMeta>(visibleIds.length);

    for (let index = 0; index < visibleIds.length; index++) {
      const itemId = visibleIds[index];
      const visibleMeta = this.visibleMetaById.get(itemId);

      metaSnapshot[index] = {
        itemId,
        parentId: visibleMeta?.parentId ?? null,
        level: visibleMeta?.level ?? -1,
        index,
        posInSet: visibleMeta?.posInSet ?? 0,
        setSize: visibleMeta?.setSize ?? 1,
      };
    }

    return metaSnapshot;
  }

  private invalidateVisibleCaches() {
    this.visibleIdsCache = null;
    this.visibleMetaSnapshotCache = null;
  }
}
