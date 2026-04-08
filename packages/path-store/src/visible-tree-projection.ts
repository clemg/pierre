import type {
  PathStoreVisibleRow,
  PathStoreVisibleTreeProjection,
} from './public-types';

const ROOT_PARENT_KEY = '$root';

/**
 * Builds path-first tree metadata from visible rows using only visible depths,
 * so callers can derive ARIA sibling info without reparsing every row path.
 */
export function createVisibleTreeProjection(
  rows: readonly Pick<PathStoreVisibleRow, 'depth' | 'path'>[]
): PathStoreVisibleTreeProjection {
  const visibleIndexByPath = new Map<string, number>();
  const parentPathByPath = new Map<string, string | null>();
  const setSizeByParentKey = new Map<string, number>();
  const pathAtDepth: string[] = [];

  for (const [index, row] of rows.entries()) {
    while (pathAtDepth.length > row.depth) {
      pathAtDepth.pop();
    }

    const parentPath = pathAtDepth[row.depth - 1] ?? null;
    const parentKey = parentPath ?? ROOT_PARENT_KEY;

    visibleIndexByPath.set(row.path, index);
    parentPathByPath.set(row.path, parentPath);
    setSizeByParentKey.set(
      parentKey,
      (setSizeByParentKey.get(parentKey) ?? 0) + 1
    );
    pathAtDepth[row.depth] = row.path;
    pathAtDepth.length = row.depth + 1;
  }

  const nextPosInSetByParentKey = new Map<string, number>();
  const projectionRows = rows.map((row, index) => {
    const parentPath = parentPathByPath.get(row.path) ?? null;
    const parentKey = parentPath ?? ROOT_PARENT_KEY;
    const posInSet = nextPosInSetByParentKey.get(parentKey) ?? 0;
    nextPosInSetByParentKey.set(parentKey, posInSet + 1);

    return {
      index,
      parentPath,
      path: row.path,
      posInSet,
      setSize: setSizeByParentKey.get(parentKey) ?? 1,
    };
  });

  return {
    rows: projectionRows,
    visibleIndexByPath,
  };
}
