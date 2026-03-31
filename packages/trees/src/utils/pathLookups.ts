/**
 * Public `FileTreeHandle.pathToId` contract. This is intentionally a small
 * lookup surface rather than a full `Map`, so callers should only rely on the
 * members declared here.
 */
export interface PathToIdLookup {
  readonly size: number;
  get: (path: string) => string | undefined;
  has: (path: string) => boolean;
  keys: () => IterableIterator<string>;
}

export type IdToPathLookup = Pick<Map<string, string>, 'get' | 'has'>;

/**
 * The sync loader uses literal paths as IDs, so this facade can answer the
 * path->id lookups Root needs without allocating a second full identity Map.
 * It deliberately returns the lightweight `PathToIdLookup` contract above,
 * not a runtime `Map` instance.
 */
export function createIdentityPathToIdLookup(
  tree: ReadonlyMap<string, unknown>
): PathToIdLookup {
  return {
    get size() {
      return tree.size;
    },
    get: (path: string) => (tree.has(path) ? path : undefined),
    has: (path: string) => tree.has(path),
    keys: () => tree.keys(),
  };
}

/**
 * Wraps a mutable path->id Map with the lightweight PathToIdLookup contract.
 * The returned lookup stays up-to-date as the backing Map mutates.
 */
export function createMapPathToIdLookup(
  pathToId: ReadonlyMap<string, string>
): PathToIdLookup {
  return {
    get size() {
      return pathToId.size;
    },
    get: (path: string) => pathToId.get(path),
    has: (path: string) => pathToId.has(path),
    keys: () => pathToId.keys(),
  };
}
