import { describe, expect, it } from 'bun:test';

import { createTree } from '../../src/core/create-tree';
import type { TreeInstance } from '../../src/core/types/core';
import type { TreeDataRef } from '../../src/features/main/types';
import { syncDataLoaderFeature } from '../../src/features/sync-data-loader/feature';

interface MutableItemData {
  id: string;
  name: string;
  isFolder: boolean;
}

interface MutableTreeFixture {
  tree: TreeInstance<MutableItemData>;
  items: Record<string, MutableItemData>;
  children: Record<string, string[]>;
  childCalls: string[];
}

function createMutableFixture(): MutableTreeFixture {
  const items: Record<string, MutableItemData> = {
    root: { id: 'root', name: 'root', isFolder: true },
    a: { id: 'a', name: 'a', isFolder: true },
    a1: { id: 'a1', name: 'a1', isFolder: false },
    a2: { id: 'a2', name: 'a2', isFolder: true },
    a2x: { id: 'a2x', name: 'a2x', isFolder: false },
    a2y: { id: 'a2y', name: 'a2y', isFolder: false },
    a3: { id: 'a3', name: 'a3', isFolder: false },
    b: { id: 'b', name: 'b', isFolder: true },
    b1: { id: 'b1', name: 'b1', isFolder: false },
    c: { id: 'c', name: 'c', isFolder: false },
  };

  const children: Record<string, string[]> = {
    root: ['a', 'b', 'c'],
    a: ['a1', 'a2', 'a3'],
    a2: ['a2x', 'a2y'],
    b: ['b1'],
  };

  const childCalls: string[] = [];

  const tree = createTree<MutableItemData>({
    rootItemId: 'root',
    dataLoader: {
      getItem: (id) =>
        items[id] ?? {
          id,
          name: id,
          isFolder: false,
        },
      getChildren: (id) => {
        childCalls.push(id);
        return children[id] ?? [];
      },
    },
    getItemName: (item) => item.getItemData().name,
    isItemFolder: (item) => item.getItemData().isFolder,
    features: [syncDataLoaderFeature],
    initialState: {
      expandedItems: ['a', 'a2', 'b'],
    },
  });

  tree.setMounted(true);
  tree.rebuildTree();

  return {
    tree,
    items,
    children,
    childCalls,
  };
}

function getVisibleIds(tree: TreeInstance<MutableItemData>): string[] {
  return tree.getItems().map((item) => item.getId());
}

function assertVisibleInvariants(tree: TreeInstance<MutableItemData>) {
  const visibleItems = tree.getItems();
  const visibleIds = visibleItems.map((item) => item.getId());
  const uniqueVisibleIds = new Set(visibleIds);
  expect(uniqueVisibleIds.size).toBe(visibleIds.length);

  const visibleIndexById = new Map<string, number>();
  for (let index = 0; index < visibleIds.length; index++) {
    visibleIndexById.set(visibleIds[index], index);
  }

  for (let index = 0; index < visibleItems.length; index++) {
    const item = visibleItems[index];
    const meta = item.getItemMeta();

    expect(meta.index).toBe(index);

    if (meta.parentId == null) {
      continue;
    }

    const parent = tree.getItemInstance(meta.parentId);
    const siblings = parent.getChildren();
    expect(meta.setSize).toBe(siblings.length);
    expect(siblings[meta.posInSet]?.getId()).toBe(item.getId());
    expect(meta.level).toBe(parent.getItemMeta().level + 1);

    const parentVisibleIndex = visibleIndexById.get(meta.parentId);
    if (parentVisibleIndex != null) {
      expect(parentVisibleIndex).toBeLessThan(meta.index);
    }

    const visitedAncestors = new Set<string>([item.getId()]);
    let ancestorCursor = parent;
    while (ancestorCursor.getItemMeta().parentId != null) {
      const ancestorId = ancestorCursor.getId();
      expect(visitedAncestors.has(ancestorId)).toBe(false);
      visitedAncestors.add(ancestorId);

      const nextParent = ancestorCursor.getParent();
      if (nextParent == null) {
        break;
      }
      ancestorCursor = nextParent;
    }
  }
}

describe('core/incremental-tree-index', () => {
  it('builds initial visible order and metadata from the incremental index', () => {
    const { tree } = createMutableFixture();

    expect(getVisibleIds(tree)).toEqual([
      'a',
      'a1',
      'a2',
      'a2x',
      'a2y',
      'a3',
      'b',
      'b1',
      'c',
    ]);

    expect(tree.getItemInstance('a2y').getItemMeta()).toEqual({
      itemId: 'a2y',
      parentId: 'a2',
      level: 2,
      index: 4,
      posInSet: 1,
      setSize: 2,
    });

    assertVisibleInvariants(tree);
  });

  it('updates visibility incrementally when collapsing/expanding a branch', () => {
    const { tree, childCalls } = createMutableFixture();

    childCalls.length = 0;
    tree.getItemInstance('a').collapse();
    expect(getVisibleIds(tree)).toEqual(['a', 'b', 'b1', 'c']);
    expect(childCalls).toEqual([]);

    childCalls.length = 0;
    tree.getItemInstance('a').expand();
    expect(getVisibleIds(tree)).toEqual([
      'a',
      'a1',
      'a2',
      'a2x',
      'a2y',
      'a3',
      'b',
      'b1',
      'c',
    ]);
    expect(childCalls).toEqual(['a', 'a2']);

    assertVisibleInvariants(tree);
  });

  it('applies insert/delete/reorder with branch-local dirty rebuilds', () => {
    const { tree, items, children, childCalls } = createMutableFixture();

    items['a-new'] = { id: 'a-new', name: 'a-new', isFolder: false };
    children.a = ['a1', 'a-new', 'a2', 'a3'];

    childCalls.length = 0;
    tree.markBranchDirty('a', 'children');
    tree.rebuildTree();

    expect(getVisibleIds(tree)).toEqual([
      'a',
      'a1',
      'a-new',
      'a2',
      'a2x',
      'a2y',
      'a3',
      'b',
      'b1',
      'c',
    ]);
    expect(childCalls).toEqual(['a', 'a2']);

    children.a = ['a1', 'a-new', 'a3'];
    tree.markBranchDirty('a', 'children');
    tree.rebuildTree();
    expect(getVisibleIds(tree)).toEqual([
      'a',
      'a1',
      'a-new',
      'a3',
      'b',
      'b1',
      'c',
    ]);

    children.a = ['a3', 'a1', 'a-new'];
    tree.markBranchDirty('a', 'children');
    tree.rebuildTree();
    expect(getVisibleIds(tree)).toEqual([
      'a',
      'a3',
      'a1',
      'a-new',
      'b',
      'b1',
      'c',
    ]);

    assertVisibleInvariants(tree);
  });

  it('moves a subtree across parents without rebuilding unrelated branches', () => {
    const { tree, children, childCalls } = createMutableFixture();

    children.a = ['a1', 'a3'];
    children.b = ['b1', 'a2'];

    childCalls.length = 0;
    tree.markBranchDirty('a', 'children');
    tree.markBranchDirty('b', 'children');
    tree.rebuildTree();

    expect(getVisibleIds(tree)).toEqual([
      'a',
      'a1',
      'a3',
      'b',
      'b1',
      'a2',
      'a2x',
      'a2y',
      'c',
    ]);
    expect(tree.getItemInstance('a2').getItemMeta()).toEqual({
      itemId: 'a2',
      parentId: 'b',
      level: 1,
      index: 5,
      posInSet: 1,
      setSize: 2,
    });

    expect(childCalls.includes('root')).toBe(false);
    expect(childCalls.includes('a')).toBe(true);
    expect(childCalls.includes('b')).toBe(true);

    assertVisibleInvariants(tree);
  });

  it('treats metadata-only rebuilds as structural no-ops', () => {
    const { tree, items, childCalls } = createMutableFixture();
    const before = getVisibleIds(tree);

    items.a1.name = 'A1 renamed';
    childCalls.length = 0;
    tree.rebuildTree();

    expect(getVisibleIds(tree)).toEqual(before);
    expect(tree.getItemInstance('a1').getItemName()).toBe('A1 renamed');
    expect(childCalls).toEqual([]);

    assertVisibleInvariants(tree);
  });

  it('supports late child insertion for an already-expanded branch', () => {
    const items: Record<string, MutableItemData> = {
      root: { id: 'root', name: 'root', isFolder: true },
      lazy: { id: 'lazy', name: 'lazy', isFolder: true },
    };
    const children: Record<string, string[]> = {
      root: ['lazy'],
      lazy: [],
    };

    const tree = createTree<MutableItemData>({
      rootItemId: 'root',
      dataLoader: {
        getItem: (id) =>
          items[id] ?? {
            id,
            name: id,
            isFolder: false,
          },
        getChildren: (id) => children[id] ?? [],
      },
      getItemName: (item) => item.getItemData().name,
      isItemFolder: (item) => item.getItemData().isFolder,
      features: [syncDataLoaderFeature],
      initialState: {
        expandedItems: ['lazy'],
      },
    });

    tree.setMounted(true);
    tree.rebuildTree();
    expect(getVisibleIds(tree)).toEqual(['lazy']);

    items['lazy-child'] = {
      id: 'lazy-child',
      name: 'lazy-child',
      isFolder: false,
    };
    children.lazy = ['lazy-child'];

    tree.markBranchDirty('lazy', 'invalidated');
    tree.rebuildTree();

    expect(getVisibleIds(tree)).toEqual(['lazy', 'lazy-child']);
    assertVisibleInvariants(tree);
  });

  it('records metadata-only rename rebuilds as non-full', () => {
    const { tree, items } = createMutableFixture();
    const dataRef = tree.getDataRef<TreeDataRef>();
    const fullBefore = dataRef.current.rebuildModeCounts?.full ?? 0;

    items.a1.name = 'A1 renamed via metadata only';
    tree.rebuildTree();

    expect(dataRef.current.lastRebuildMode).not.toBe('full');
    expect(dataRef.current.rebuildModeCounts?.full ?? 0).toBe(fullBefore);
  });

  it('records dataLoader replacement rebuilds as full', () => {
    const { tree, items, children } = createMutableFixture();
    const dataRef = tree.getDataRef<TreeDataRef>();
    const fullBefore = dataRef.current.rebuildModeCounts?.full ?? 0;

    tree.setConfig((previousConfig) => ({
      ...previousConfig,
      dataLoader: {
        getItem: (id: string) =>
          items[id] ?? {
            id,
            name: id,
            isFolder: false,
          },
        getChildren: (id: string) => children[id] ?? [],
      },
    }));
    tree.rebuildTree();

    expect(dataRef.current.lastRebuildMode).toBe('full');
    expect(dataRef.current.rebuildModeCounts?.full ?? 0).toBeGreaterThan(
      fullBefore
    );
  });
});
