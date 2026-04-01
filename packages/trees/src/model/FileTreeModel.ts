import { FLATTENED_PREFIX } from '../constants';
import {
  attachBenchmarkInstrumentation,
  type BenchmarkInstrumentation,
  setBenchmarkCounter,
} from '../internal/benchmarkInstrumentation';
import type { FileTreeNode } from '../types';
import {
  buildFileListSyncIndex,
  type FileListSyncIndex,
} from '../utils/fileListToTree';
import { MutablePathTree } from '../utils/mutablePathTree';
import {
  createDynamicPathToIdLookup,
  type IdToPathLookup,
} from '../utils/pathLookups';
import {
  type ChildrenSortOption,
  defaultChildrenComparator,
} from '../utils/sortChildren';

const ROOT_ID = 'root';
const FLATTENED_PREFIX_LENGTH = FLATTENED_PREFIX.length;

function hashPathToStableSuffix(path: string): string {
  let hash = 2166136261;
  for (let index = 0; index < path.length; index += 1) {
    hash ^= path.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function allocateDeterministicNodeId(
  path: string,
  usedIds: Set<string>
): string {
  const baseId = `p_${hashPathToStableSuffix(path)}`;
  if (!usedIds.has(baseId)) {
    usedIds.add(baseId);
    return baseId;
  }

  let suffix = 2;
  let candidate = `${baseId}_${suffix}`;
  while (usedIds.has(candidate)) {
    suffix += 1;
    candidate = `${baseId}_${suffix}`;
  }

  usedIds.add(candidate);
  return candidate;
}

function getParentPath(path: string): string {
  const separatorIndex = path.lastIndexOf('/');
  return separatorIndex < 0 ? ROOT_ID : path.slice(0, separatorIndex);
}

function getLeafName(path: string): string {
  const separatorIndex = path.lastIndexOf('/');
  return separatorIndex < 0 ? path : path.slice(separatorIndex + 1);
}

function remapPathWithPrefix(
  path: string,
  sourcePath: string,
  destinationPath: string
): string | null {
  const isFlattened =
    path.length >= FLATTENED_PREFIX_LENGTH &&
    path.charCodeAt(0) === 102 &&
    path.charCodeAt(1) === 58 &&
    path.charCodeAt(2) === 58;
  const rawPath = isFlattened ? path.slice(FLATTENED_PREFIX_LENGTH) : path;
  if (rawPath !== sourcePath && !rawPath.startsWith(`${sourcePath}/`)) {
    return null;
  }

  const remappedRawPath = `${destinationPath}${rawPath.slice(sourcePath.length)}`;
  return isFlattened
    ? `${FLATTENED_PREFIX}${remappedRawPath}`
    : remappedRawPath;
}

function normalizeTreePath(path: string): string {
  return path.startsWith(FLATTENED_PREFIX)
    ? path.slice(FLATTENED_PREFIX_LENGTH)
    : path;
}

function isPathDescendant(path: string, ancestor: string): boolean {
  return path.startsWith(`${ancestor}/`);
}

function hasSelectedFolderAncestor(
  path: string,
  selectedFolders: Set<string>
): boolean {
  let slash = path.lastIndexOf('/');
  while (slash !== -1) {
    const parent = path.slice(0, slash);
    if (selectedFolders.has(parent)) {
      return true;
    }
    slash = parent.lastIndexOf('/');
  }
  return false;
}

function splitPath(path: string): { parentPath: string; baseName: string } {
  const separatorIndex = path.lastIndexOf('/');
  if (separatorIndex < 0) {
    return { parentPath: '', baseName: path };
  }
  return {
    parentPath: path.slice(0, separatorIndex),
    baseName: path.slice(separatorIndex + 1),
  };
}

function getPathDepth(path: string): number {
  let depth = 1;
  for (let index = 0; index < path.length; index += 1) {
    if (path.charCodeAt(index) === 47) {
      depth += 1;
    }
  }
  return depth;
}

interface PlannedMoveRule {
  sourcePath: string;
  destinationPath: string;
  isFolder: boolean;
}

export interface FileTreeModelRenameRequest {
  sourcePath: string;
  destinationPath: string;
  isFolder?: boolean;
}

export interface FileTreeModelMoveRequest {
  draggedPaths: string[];
  targetPath: string;
  onCollision?: (collision: {
    origin: string | null;
    destination: string;
  }) => boolean;
}

export interface FileTreeModelAddPathsRequest {
  paths: string[];
}

export interface FileTreeModelDeletePathsRequest {
  paths: string[];
}

export type FileTreeModelMutation =
  | {
      kind: 'replace-all';
      version: number;
    }
  | {
      kind: 'rename-path';
      sourcePath: string;
      destinationPath: string;
      isFolder: boolean;
      parentId: string;
      nodeId: string;
      childrenOrderChanged: boolean;
      version: number;
    }
  | {
      kind: 'move-paths';
      movedPaths: ReadonlyArray<{
        sourcePath: string;
        destinationPath: string;
        isFolder: boolean;
      }>;
      affectedParentIds: readonly string[];
      version: number;
    }
  | {
      kind: 'add-paths';
      addedPaths: readonly string[];
      affectedParentIds: readonly string[];
      version: number;
    }
  | {
      kind: 'delete-paths';
      deletedPaths: readonly string[];
      affectedParentIds: readonly string[];
      version: number;
    };

export type FileTreeModelRenameResult =
  | {
      ok: true;
      mutation: Extract<FileTreeModelMutation, { kind: 'rename-path' }> | null;
    }
  | { ok: false; error: string };

export type FileTreeModelMoveResult =
  | {
      ok: true;
      mutation: Extract<FileTreeModelMutation, { kind: 'move-paths' }> | null;
    }
  | { ok: false; error: string };

export type FileTreeModelAddPathsResult =
  | {
      ok: true;
      mutation: Extract<FileTreeModelMutation, { kind: 'add-paths' }> | null;
    }
  | { ok: false; error: string };

export type FileTreeModelDeletePathsResult =
  | {
      ok: true;
      mutation: Extract<FileTreeModelMutation, { kind: 'delete-paths' }> | null;
    }
  | { ok: false; error: string };

export interface FileTreeModelOptions {
  sortComparator?: ChildrenSortOption;
  benchmarkInstrumentation?: BenchmarkInstrumentation | null;
}

interface BuiltStableIndex {
  files: string[];
  pathToIdMap: Map<string, string>;
  idToPathMap: Map<string, string>;
  tree: Map<string, FileTreeNode>;
  nextNodeId: number;
}

function mapPathArrayToStableIds(
  paths: string[],
  pathToIdMap: Map<string, string>
): string[] {
  const mapped = new Array<string>(paths.length);
  for (let index = 0; index < paths.length; index += 1) {
    const stableId = pathToIdMap.get(paths[index]);
    if (stableId == null) {
      throw new Error(
        `FileTreeModel: missing stable ID for path ${paths[index]}`
      );
    }
    mapped[index] = stableId;
  }
  return mapped;
}

function buildStableIndexFromFiles(
  files: string[],
  sortComparator: ChildrenSortOption,
  benchmarkInstrumentation: BenchmarkInstrumentation | null | undefined,
  existingPathToIdMap: Map<string, string> | null,
  startingNodeId: number
): BuiltStableIndex {
  const rawIndex = buildFileListSyncIndex(
    files,
    attachBenchmarkInstrumentation(
      { sortComparator },
      benchmarkInstrumentation ?? null
    )
  );
  const rawTree = rawIndex.tree;

  let nextNodeId = startingNodeId;
  const usedIds = new Set<string>([ROOT_ID]);
  const pathToIdMap = new Map<string, string>();

  for (const path of rawTree.keys()) {
    if (path === ROOT_ID) {
      pathToIdMap.set(path, ROOT_ID);
      continue;
    }

    const reusableId = existingPathToIdMap?.get(path);
    if (
      reusableId != null &&
      reusableId !== ROOT_ID &&
      !usedIds.has(reusableId)
    ) {
      pathToIdMap.set(path, reusableId);
      usedIds.add(reusableId);
      continue;
    }

    const allocatedId = allocateDeterministicNodeId(path, usedIds);
    pathToIdMap.set(path, allocatedId);
  }

  const idToPathMap = new Map<string, string>();
  for (const [path, id] of pathToIdMap) {
    idToPathMap.set(id, path);
  }

  const tree = new Map<string, FileTreeNode>();
  for (const [path, node] of rawTree) {
    const stableId = pathToIdMap.get(path);
    if (stableId == null) {
      throw new Error(`FileTreeModel: failed to allocate ID for ${path}`);
    }

    const directChildren = node.children?.direct;
    const flattenedChildren = node.children?.flattened;
    const flattens = node.flattens;

    const stableNode: FileTreeNode = {
      ...node,
      ...(directChildren != null && {
        children: {
          direct: mapPathArrayToStableIds(directChildren, pathToIdMap),
          ...(flattenedChildren != null && {
            flattened: mapPathArrayToStableIds(flattenedChildren, pathToIdMap),
          }),
        },
      }),
      ...(flattens != null && {
        flattens: mapPathArrayToStableIds(flattens, pathToIdMap),
      }),
    };

    tree.set(stableId, stableNode);
  }

  return {
    files: [...files],
    pathToIdMap,
    idToPathMap,
    tree,
    nextNodeId,
  };
}

/**
 * Mutable tree model with stable node IDs (decoupled from path strings).
 * FileTree instances subscribe to model mutations and rebuild affected branches.
 */
export class FileTreeModel {
  private readonly listeners = new Set<
    (mutation: FileTreeModelMutation) => void
  >();
  private readonly pathToIdMap = new Map<string, string>();
  private readonly idToPathMap = new Map<string, string>();
  private readonly tree = new Map<string, FileTreeNode>();
  private readonly pendingPathPrefixRemaps: Array<{
    sourcePath: string;
    destinationPath: string;
  }> = [];
  private readonly pathToIdLookup = createDynamicPathToIdLookup({
    size: () => this.pathToIdMap.size,
    get: (path) => this.resolveIdForPath(path),
    has: (path) => this.resolveIdForPath(path) != null,
    keys: () => this.getCurrentPathKeys(),
  });
  private readonly idToPathLookup: IdToPathLookup = {
    get: (id: string) => this.getResolvedPathForId(id),
    has: (id: string) => this.idToPathMap.has(id),
  };
  private readonly syncIndex: FileListSyncIndex = {
    pathToId: this.pathToIdLookup,
    tree: this.tree,
    idToPath: this.idToPathLookup,
  };

  private files: string[] = [];
  private filesPendingPathTreeSync = false;
  private readonly fileIndexByPath = new Map<string, number>();
  private readonly pendingFileSnapshotPrefixRemaps: Array<{
    sourcePath: string;
    destinationPath: string;
  }> = [];
  private readonly flattenedRefCountById = new Map<string, number>();
  private readonly flattenedIdsPendingPrune = new Set<string>();
  private readonly directChildIndexByFolderId = new Map<
    string,
    Map<string, number>
  >();
  private readonly benchmarkInstrumentation: BenchmarkInstrumentation | null;
  private pathTree: MutablePathTree | null = null;
  private pathTreeCreationCount = 0;
  private pathPrefixRemapMaterializationCount = 0;
  private fileIndexRebuildCount = 0;
  private version = 0;
  private nextNodeId = 1;
  private sortComparator: ChildrenSortOption;

  static fromFiles(
    files: string[],
    options: FileTreeModelOptions = {}
  ): FileTreeModel {
    return new FileTreeModel(files, options);
  }

  constructor(files: string[], options: FileTreeModelOptions = {}) {
    this.sortComparator = options.sortComparator ?? defaultChildrenComparator;
    this.benchmarkInstrumentation = options.benchmarkInstrumentation ?? null;

    const builtIndex = buildStableIndexFromFiles(
      files,
      this.sortComparator,
      this.benchmarkInstrumentation,
      null,
      this.nextNodeId
    );
    this.applyBuiltIndex(builtIndex);
  }

  private applyBuiltIndex(
    builtIndex: BuiltStableIndex,
    options: { syncPathTree?: boolean } = {}
  ): void {
    this.pathToIdMap.clear();
    for (const [path, id] of builtIndex.pathToIdMap) {
      this.pathToIdMap.set(path, id);
    }

    this.idToPathMap.clear();
    for (const [id, path] of builtIndex.idToPathMap) {
      this.idToPathMap.set(id, path);
    }

    this.tree.clear();
    this.directChildIndexByFolderId.clear();
    for (const [id, node] of builtIndex.tree) {
      this.tree.set(id, node);
      const directChildren = node.children?.direct;
      if (directChildren != null) {
        const directChildIndexMap = new Map<string, number>();
        for (let index = 0; index < directChildren.length; index += 1) {
          directChildIndexMap.set(directChildren[index], index);
        }
        this.directChildIndexByFolderId.set(id, directChildIndexMap);
      }
    }

    this.files = builtIndex.files;
    this.filesPendingPathTreeSync = false;
    this.pendingFileSnapshotPrefixRemaps.length = 0;
    this.pendingPathPrefixRemaps.length = 0;
    this.rebuildFileIndexByPath(this.files);
    this.setModelCounter('model.snapshot.fileCount', this.files.length);
    this.nextNodeId = builtIndex.nextNodeId;

    this.rebuildFlattenedReferenceCounts();

    if (options.syncPathTree !== false && this.pathTree != null) {
      this.pathTree.replaceAll(this.files);
      this.adoptPathTreeFilesReference(this.pathTree);
    }
  }

  private isFlattenedPath(path: string | undefined): boolean {
    return path?.startsWith(FLATTENED_PREFIX) === true;
  }

  private rebuildFlattenedReferenceCounts(): void {
    this.flattenedRefCountById.clear();
    this.flattenedIdsPendingPrune.clear();

    for (const node of this.tree.values()) {
      const flattenedChildren = node.children?.flattened;
      if (flattenedChildren == null) {
        continue;
      }

      for (let index = 0; index < flattenedChildren.length; index += 1) {
        const childId = flattenedChildren[index];
        if (!this.isFlattenedPath(this.idToPathMap.get(childId))) {
          continue;
        }
        this.flattenedRefCountById.set(
          childId,
          (this.flattenedRefCountById.get(childId) ?? 0) + 1
        );
      }
    }
  }

  private incrementFlattenedReference(id: string): void {
    if (!this.isFlattenedPath(this.idToPathMap.get(id))) {
      return;
    }

    this.flattenedRefCountById.set(
      id,
      (this.flattenedRefCountById.get(id) ?? 0) + 1
    );
    this.flattenedIdsPendingPrune.delete(id);
  }

  private decrementFlattenedReference(id: string): void {
    if (!this.isFlattenedPath(this.idToPathMap.get(id))) {
      return;
    }

    const previousCount = this.flattenedRefCountById.get(id);
    if (previousCount == null) {
      return;
    }

    if (previousCount <= 1) {
      this.flattenedRefCountById.delete(id);
      this.flattenedIdsPendingPrune.add(id);
      return;
    }

    this.flattenedRefCountById.set(id, previousCount - 1);
  }

  private prunePendingFlattenedNodes(): void {
    while (this.flattenedIdsPendingPrune.size > 0) {
      const iterator = this.flattenedIdsPendingPrune.values().next();
      if (iterator.done === true) {
        return;
      }

      const flattenedId = iterator.value;
      this.flattenedIdsPendingPrune.delete(flattenedId);

      if (this.flattenedRefCountById.has(flattenedId)) {
        continue;
      }

      const flattenedPath = this.idToPathMap.get(flattenedId);
      if (!this.isFlattenedPath(flattenedPath)) {
        continue;
      }

      this.removePathById(flattenedId);
    }
  }

  private emitMutation(mutation: Omit<FileTreeModelMutation, 'version'>): void {
    this.version += 1;
    const mutationWithVersion = {
      ...mutation,
      version: this.version,
    } as FileTreeModelMutation;
    for (const listener of this.listeners) {
      listener(mutationWithVersion);
    }
  }

  private setModelCounter(name: string, value: number): void {
    setBenchmarkCounter(this.benchmarkInstrumentation, name, value);
  }

  private sortChildren(parentId: string): void {
    const parentNode = this.tree.get(parentId);
    if (parentNode?.children == null || this.sortComparator === false) {
      return;
    }

    const comparator = this.sortComparator ?? defaultChildrenComparator;
    const isFolderPath = (path: string) => {
      const id = this.resolveIdForPath(path);
      return id != null && this.tree.get(id)?.children?.direct != null;
    };
    const compareByPath = (leftId: string, rightId: string) => {
      const leftPath = this.getResolvedPathForId(leftId) ?? leftId;
      const rightPath = this.getResolvedPathForId(rightId) ?? rightId;
      return comparator(leftPath, rightPath, isFolderPath);
    };

    parentNode.children.direct.sort(compareByPath);
    if (parentNode.children.flattened != null) {
      parentNode.children.flattened.sort(compareByPath);
    }
  }

  private captureParentChildrenSnapshot(parentId: string): {
    direct: string[];
    flattened: string[] | null;
  } {
    const parentChildren = this.tree.get(parentId)?.children;
    return {
      direct: parentChildren?.direct.slice() ?? [],
      flattened: parentChildren?.flattened?.slice() ?? null,
    };
  }

  private didParentChildrenOrderChange(
    parentId: string,
    before: { direct: readonly string[]; flattened: readonly string[] | null }
  ): boolean {
    const afterChildren = this.tree.get(parentId)?.children;
    const afterDirect = afterChildren?.direct ?? [];
    const afterFlattened = afterChildren?.flattened ?? null;

    if (!this.areIdArraysEqual(before.direct, afterDirect)) {
      return true;
    }

    if (before.flattened == null || afterFlattened == null) {
      return before.flattened !== afterFlattened;
    }

    return !this.areIdArraysEqual(before.flattened, afterFlattened);
  }

  private remapPathForward(path: string): string {
    let remappedPath = path;

    for (
      let index = 0;
      index < this.pendingPathPrefixRemaps.length;
      index += 1
    ) {
      const rule = this.pendingPathPrefixRemaps[index];
      const nextPath = remapPathWithPrefix(
        remappedPath,
        rule.sourcePath,
        rule.destinationPath
      );
      if (nextPath != null) {
        remappedPath = nextPath;
      }
    }

    return remappedPath;
  }

  private remapPathBackward(path: string): string {
    let canonicalPath = path;

    for (
      let index = this.pendingPathPrefixRemaps.length - 1;
      index >= 0;
      index -= 1
    ) {
      const rule = this.pendingPathPrefixRemaps[index];
      const previousPath = remapPathWithPrefix(
        canonicalPath,
        rule.destinationPath,
        rule.sourcePath
      );
      if (previousPath != null) {
        canonicalPath = previousPath;
      }
    }

    return canonicalPath;
  }

  private getResolvedPathForId(id: string): string | undefined {
    const canonicalPath = this.idToPathMap.get(id);
    if (canonicalPath == null) {
      return undefined;
    }

    return this.remapPathForward(canonicalPath);
  }

  private resolveIdForPath(path: string): string | undefined {
    const canonicalPath = this.remapPathBackward(path);
    const id = this.pathToIdMap.get(canonicalPath);
    if (id == null) {
      return undefined;
    }

    const resolvedPath = this.remapPathForward(canonicalPath);
    return resolvedPath === path ? id : undefined;
  }

  private *getCurrentPathKeys(): IterableIterator<string> {
    for (const canonicalPath of this.pathToIdMap.keys()) {
      yield this.remapPathForward(canonicalPath);
    }
  }

  private queuePathPrefixRemap(
    sourcePath: string,
    destinationPath: string
  ): void {
    this.pendingPathPrefixRemaps.push({ sourcePath, destinationPath });
  }

  private materializePendingPathPrefixRemaps(): void {
    if (this.pendingPathPrefixRemaps.length === 0) {
      return;
    }

    this.pathPrefixRemapMaterializationCount += 1;
    this.setModelCounter(
      'model.pathPrefixRemaps.materializedCount',
      this.pathPrefixRemapMaterializationCount
    );

    const nextPathToId = new Map<string, string>();

    for (const [canonicalPath, id] of this.pathToIdMap) {
      const remappedPath = this.remapPathForward(canonicalPath);
      nextPathToId.set(remappedPath, id);
      this.idToPathMap.set(id, remappedPath);
      const node = this.tree.get(id);
      if (node != null) {
        node.path = remappedPath;
      }
    }

    this.pathToIdMap.clear();
    for (const [path, id] of nextPathToId) {
      this.pathToIdMap.set(path, id);
    }

    this.pendingPathPrefixRemaps.length = 0;
  }

  private resolveAncestorId(path: string): string {
    let candidatePath = path;
    while (true) {
      const candidateId = this.resolveIdForPath(candidatePath);
      if (candidateId != null) {
        return candidateId;
      }
      if (candidatePath === ROOT_ID) {
        return ROOT_ID;
      }
      candidatePath = getParentPath(candidatePath);
    }
  }

  private resolveAncestorIdsForPaths(paths: readonly string[]): string[] {
    const affectedParentIdsSet = new Set<string>();
    for (let index = 0; index < paths.length; index += 1) {
      const path = paths[index];
      affectedParentIdsSet.add(this.resolveAncestorId(getParentPath(path)));
    }
    return [...affectedParentIdsSet];
  }

  private rebuildFileIndexByPath(files: readonly string[]): void {
    this.fileIndexByPath.clear();
    for (let index = 0; index < files.length; index += 1) {
      this.fileIndexByPath.set(files[index], index);
    }

    this.fileIndexRebuildCount += 1;
    this.setModelCounter(
      'model.snapshot.fileIndexRebuildCount',
      this.fileIndexRebuildCount
    );
  }

  private adoptPathTreeFilesReference(pathTree: MutablePathTree): void {
    this.pathTree = pathTree;
    this.filesPendingPathTreeSync = true;
    this.pendingFileSnapshotPrefixRemaps.length = 0;
    this.fileIndexByPath.clear();
  }

  private syncFilesSnapshotFromPathTree(): void {
    if (!this.filesPendingPathTreeSync || this.pathTree == null) {
      return;
    }

    this.files = this.pathTree.getFilesReference();
    this.filesPendingPathTreeSync = false;
    this.pendingFileSnapshotPrefixRemaps.length = 0;
    this.fileIndexByPath.clear();
    this.setModelCounter('model.snapshot.fileCount', this.files.length);
  }

  private getKnownFileCount(): number {
    if (this.pathTree != null) {
      return this.pathTree.getFileCount();
    }

    return this.files.length;
  }

  private getFileIndexFromSnapshot(path: string): number {
    this.applyPendingFileSnapshotPrefixRemaps();

    const knownIndex = this.fileIndexByPath.get(path);
    if (knownIndex != null) {
      return knownIndex;
    }

    this.rebuildFileIndexByPath(this.files);
    return this.fileIndexByPath.get(path) ?? -1;
  }

  private queueFileSnapshotPrefixRemap(
    sourcePath: string,
    destinationPath: string
  ): void {
    this.pendingFileSnapshotPrefixRemaps.push({
      sourcePath,
      destinationPath,
    });
  }

  /**
   * Applies deferred folder-prefix remaps to the dense files[] snapshot.
   *
   * This keeps folder rename/move cheap on the hot path and only pays the
   * O(fileCount) rewrite when a caller asks for a full files[] snapshot.
   */
  private applyPendingFileSnapshotPrefixRemaps(): void {
    const remapRules = this.pendingFileSnapshotPrefixRemaps;
    if (remapRules.length === 0) {
      return;
    }

    const preparedRules = remapRules.map((rule) => ({
      sourcePath: rule.sourcePath,
      sourcePathWithSlash: `${rule.sourcePath}/`,
      sourcePathLength: rule.sourcePath.length,
      destinationPath: rule.destinationPath,
    }));

    const originalPathByTouchedIndex = new Map<number, string>();

    for (let fileIndex = 0; fileIndex < this.files.length; fileIndex += 1) {
      const originalPath = this.files[fileIndex];
      let currentPath = originalPath;

      for (
        let ruleIndex = 0;
        ruleIndex < preparedRules.length;
        ruleIndex += 1
      ) {
        const rule = preparedRules[ruleIndex];
        if (
          currentPath !== rule.sourcePath &&
          !currentPath.startsWith(rule.sourcePathWithSlash)
        ) {
          continue;
        }

        currentPath = `${rule.destinationPath}${currentPath.slice(rule.sourcePathLength)}`;
      }

      if (currentPath !== originalPath) {
        originalPathByTouchedIndex.set(fileIndex, originalPath);
        this.files[fileIndex] = currentPath;
      }
    }

    remapRules.length = 0;

    if (
      originalPathByTouchedIndex.size === 0 ||
      this.fileIndexByPath.size === 0
    ) {
      return;
    }

    if (originalPathByTouchedIndex.size > 4096) {
      this.fileIndexByPath.clear();
      return;
    }

    for (const originalPath of originalPathByTouchedIndex.values()) {
      this.fileIndexByPath.delete(originalPath);
    }
    for (const fileIndex of originalPathByTouchedIndex.keys()) {
      this.fileIndexByPath.set(this.files[fileIndex], fileIndex);
    }
  }

  private getOrCreatePathTree(): MutablePathTree {
    if (this.pathTree == null) {
      this.applyPendingFileSnapshotPrefixRemaps();
      this.pathTree = MutablePathTree.fromFiles(this.files);
      this.filesPendingPathTreeSync = false;
      this.fileIndexByPath.clear();
      this.pathTreeCreationCount += 1;
      this.setModelCounter(
        'model.pathTree.createdCount',
        this.pathTreeCreationCount
      );
    }
    return this.pathTree;
  }

  private areIdArraysEqual(
    left: readonly string[],
    right: readonly string[]
  ): boolean {
    if (left.length !== right.length) {
      return false;
    }

    for (let index = 0; index < left.length; index += 1) {
      if (left[index] !== right[index]) {
        return false;
      }
    }

    return true;
  }

  private setDirectChildIndexCache(
    folderId: string,
    directChildIds: readonly string[]
  ): void {
    const directChildIndexMap = new Map<string, number>();
    for (let index = 0; index < directChildIds.length; index += 1) {
      directChildIndexMap.set(directChildIds[index], index);
    }
    this.directChildIndexByFolderId.set(folderId, directChildIndexMap);
  }

  private getDirectChildIndex(
    folderId: string,
    childId: string,
    directChildIds: readonly string[]
  ): number {
    let directChildIndexMap = this.directChildIndexByFolderId.get(folderId);
    if (directChildIndexMap == null) {
      this.setDirectChildIndexCache(folderId, directChildIds);
      directChildIndexMap = this.directChildIndexByFolderId.get(folderId);
      if (directChildIndexMap == null) {
        return -1;
      }
    }

    return directChildIndexMap.get(childId) ?? -1;
  }

  private allocateStableIdForPath(path: string): string {
    const baseId = `p_${hashPathToStableSuffix(path)}`;
    if (!this.idToPathMap.has(baseId)) {
      return baseId;
    }

    let suffix = 2;
    let candidate = `${baseId}_${suffix}`;
    while (this.idToPathMap.has(candidate)) {
      suffix += 1;
      candidate = `${baseId}_${suffix}`;
    }
    return candidate;
  }

  private ensureStableIdForPath(path: string): string {
    const existingId = this.resolveIdForPath(path);
    if (existingId != null) {
      return existingId;
    }

    const canonicalPath = this.remapPathBackward(path);
    const canonicalExistingId = this.pathToIdMap.get(canonicalPath);
    if (canonicalExistingId != null) {
      return canonicalExistingId;
    }

    const allocatedId = this.allocateStableIdForPath(canonicalPath);
    this.pathToIdMap.set(canonicalPath, allocatedId);
    this.idToPathMap.set(allocatedId, canonicalPath);
    return allocatedId;
  }

  private removePathById(id: string): void {
    const node = this.tree.get(id);
    const flattenedChildren = node?.children?.flattened;
    if (flattenedChildren != null) {
      for (let index = 0; index < flattenedChildren.length; index += 1) {
        this.decrementFlattenedReference(flattenedChildren[index]);
      }
    }

    const path = this.idToPathMap.get(id);
    if (path != null) {
      this.idToPathMap.delete(id);
      this.pathToIdMap.delete(path);
      if (this.isFlattenedPath(path)) {
        this.flattenedRefCountById.delete(id);
        this.flattenedIdsPendingPrune.delete(id);
      }
    }

    this.tree.delete(id);
    this.directChildIndexByFolderId.delete(id);
  }

  /**
   * Removes a node and every descendant reachable via direct/flattened links.
   *
   * The optional predicate lets callers keep nodes that were reparented and
   * still live elsewhere in the current path mapping.
   */
  private removeSubtreeById(
    rootId: string,
    shouldRemovePath?: (path: string) => boolean
  ): void {
    if (rootId === ROOT_ID) {
      return;
    }

    const stack = [rootId];
    const visited = new Set<string>();

    while (stack.length > 0) {
      const id = stack.pop()!;
      if (id === ROOT_ID || visited.has(id)) {
        continue;
      }
      visited.add(id);

      const nodePath = this.getResolvedPathForId(id);
      if (
        shouldRemovePath != null &&
        nodePath != null &&
        !shouldRemovePath(nodePath)
      ) {
        continue;
      }

      const node = this.tree.get(id);
      const directChildren = node?.children?.direct;
      if (directChildren != null) {
        for (let index = 0; index < directChildren.length; index += 1) {
          stack.push(directChildren[index]);
        }
      }

      const flattenedChildren = node?.children?.flattened;
      if (flattenedChildren != null) {
        for (let index = 0; index < flattenedChildren.length; index += 1) {
          stack.push(flattenedChildren[index]);
        }
      }

      this.removePathById(id);
    }
  }

  /**
   * Collects path remaps by traversing only the folder subtree being moved.
   * This avoids scanning unrelated entries in the model-wide path map.
   */
  private collectSubtreePathUpdates(
    sourcePath: string,
    destinationPath: string
  ): {
    updates: Array<{ id: string; oldPath: string; newPath: string }>;
    scannedNodeCount: number;
  } {
    const sourceId = this.resolveIdForPath(sourcePath);
    if (sourceId == null) {
      return { updates: [], scannedNodeCount: 0 };
    }

    const updates: Array<{ id: string; oldPath: string; newPath: string }> = [];
    const updatedIds = new Set<string>();
    const visited = new Set<string>();
    const stack = [sourceId];
    let scannedNodeCount = 0;

    while (stack.length > 0) {
      const id = stack.pop()!;
      if (visited.has(id)) {
        continue;
      }
      visited.add(id);
      scannedNodeCount += 1;

      const node = this.tree.get(id);
      const canonicalPath = this.idToPathMap.get(id);
      const resolvedPath =
        canonicalPath == null
          ? undefined
          : this.remapPathForward(canonicalPath);
      const remappedPath =
        resolvedPath == null
          ? null
          : remapPathWithPrefix(resolvedPath, sourcePath, destinationPath);

      if (
        canonicalPath != null &&
        resolvedPath != null &&
        remappedPath != null &&
        remappedPath !== resolvedPath &&
        !updatedIds.has(id)
      ) {
        updates.push({
          id,
          oldPath: canonicalPath,
          newPath: this.remapPathBackward(remappedPath),
        });
        updatedIds.add(id);
      }

      if (
        canonicalPath != null &&
        resolvedPath != null &&
        remappedPath != null &&
        remappedPath !== resolvedPath &&
        node?.children?.direct != null &&
        !resolvedPath.startsWith(FLATTENED_PREFIX)
      ) {
        const flattenedAliasPath = `${FLATTENED_PREFIX}${resolvedPath}`;
        const flattenedAliasId = this.resolveIdForPath(flattenedAliasPath);
        if (flattenedAliasId != null && !updatedIds.has(flattenedAliasId)) {
          const flattenedAliasCanonicalPath =
            this.idToPathMap.get(flattenedAliasId);
          if (flattenedAliasCanonicalPath != null) {
            updates.push({
              id: flattenedAliasId,
              oldPath: flattenedAliasCanonicalPath,
              newPath: this.remapPathBackward(
                `${FLATTENED_PREFIX}${remappedPath}`
              ),
            });
            updatedIds.add(flattenedAliasId);
            scannedNodeCount += 1;
          }
        }
      }

      const directChildren = node?.children?.direct;
      if (directChildren != null) {
        for (let index = 0; index < directChildren.length; index += 1) {
          stack.push(directChildren[index]);
        }
      }

      const flattenedChildren = node?.children?.flattened;
      if (flattenedChildren != null) {
        for (let index = 0; index < flattenedChildren.length; index += 1) {
          stack.push(flattenedChildren[index]);
        }
      }
    }

    return { updates, scannedNodeCount };
  }

  private applyPathRemapRules(rules: readonly PlannedMoveRule[]): void {
    if (rules.length === 0) {
      return;
    }

    const updates: Array<{ id: string; oldPath: string; newPath: string }> = [];
    const updatedIds = new Set<string>();
    let scannedNodeCount = 0;

    for (let index = 0; index < rules.length; index += 1) {
      const rule = rules[index];

      if (rule.isFolder) {
        const folderUpdates = this.collectSubtreePathUpdates(
          rule.sourcePath,
          rule.destinationPath
        );
        scannedNodeCount += folderUpdates.scannedNodeCount;

        for (
          let updateIndex = 0;
          updateIndex < folderUpdates.updates.length;
          updateIndex += 1
        ) {
          const update = folderUpdates.updates[updateIndex];
          if (updatedIds.has(update.id)) {
            continue;
          }
          updatedIds.add(update.id);
          updates.push(update);
        }
        continue;
      }

      const id = this.resolveIdForPath(rule.sourcePath);
      if (id == null || updatedIds.has(id)) {
        continue;
      }

      const canonicalSourcePath = this.idToPathMap.get(id);
      if (canonicalSourcePath == null) {
        continue;
      }

      scannedNodeCount += 1;
      updatedIds.add(id);
      updates.push({
        id,
        oldPath: canonicalSourcePath,
        newPath: this.remapPathBackward(rule.destinationPath),
      });
    }

    this.setModelCounter('model.move.remapScannedNodes', scannedNodeCount);
    this.setModelCounter('model.move.remapUpdatedNodes', updates.length);

    if (updates.length === 0) {
      return;
    }

    const remappedSourcePaths = new Set(
      updates.map((update) => update.oldPath)
    );
    for (let index = 0; index < updates.length; index += 1) {
      const update = updates[index];
      const existingId = this.pathToIdMap.get(update.newPath);
      if (
        existingId != null &&
        existingId !== update.id &&
        !remappedSourcePaths.has(update.newPath)
      ) {
        this.removePathById(existingId);
      }
    }

    for (let index = 0; index < updates.length; index += 1) {
      this.pathToIdMap.delete(updates[index].oldPath);
    }

    for (let index = 0; index < updates.length; index += 1) {
      const update = updates[index];
      this.pathToIdMap.set(update.newPath, update.id);
      this.idToPathMap.set(update.id, update.newPath);
      const node = this.tree.get(update.id);
      if (node != null) {
        node.path = update.newPath;
      }
    }
  }

  private sortPathTreeChildren(
    children: Array<{ path: string; kind: 'folder' | 'file' }>,
    pathTree: MutablePathTree
  ): void {
    if (this.sortComparator === false) {
      return;
    }

    const comparator = this.sortComparator ?? defaultChildrenComparator;
    children.sort((left, right) =>
      comparator(left.path, right.path, (path) => pathTree.hasFolder(path))
    );
  }

  private getFlattenedEndpoint(
    pathTree: MutablePathTree,
    startPath: string
  ): string | null {
    let current = startPath;
    let endpoint: string | null = null;

    while (true) {
      const directChildren = pathTree.getDirectChildren(current);
      if (directChildren.length !== 1) {
        break;
      }

      const onlyChild = directChildren[0];
      if (onlyChild.kind !== 'folder') {
        break;
      }

      endpoint = onlyChild.path;
      current = onlyChild.path;
    }

    return endpoint;
  }

  private collectFlattenedFolderChain(
    pathTree: MutablePathTree,
    startPath: string,
    endpointPath: string
  ): string[] {
    const folders: string[] = [startPath];
    let current = startPath;

    while (current !== endpointPath) {
      const directChildren = pathTree.getDirectChildren(current);
      if (directChildren.length !== 1 || directChildren[0].kind !== 'folder') {
        break;
      }
      current = directChildren[0].path;
      folders.push(current);
    }

    return folders;
  }

  private buildFlattenedDisplayName(
    startPath: string,
    endpointPath: string
  ): string {
    const startName = getLeafName(startPath);
    const relativeSuffix = endpointPath.slice(startPath.length + 1);
    return relativeSuffix.length > 0
      ? `${startName}/${relativeSuffix}`
      : startName;
  }

  private rebuildFolderNodesFromPathTree(
    pathTree: MutablePathTree,
    folderPaths: ReadonlySet<string>
  ): void {
    this.setModelCounter(
      'model.rebuildFolders.requestedCount',
      folderPaths.size
    );

    const rebuiltFolders = new Set<string>();
    const rebuildingFolders = new Set<string>();
    const flattenedEndpointCache = new Map<string, string | null>();
    const dirtyChildrenByFolderPath = new Map<string, Set<string>>();

    const markDirtyChild = (folderPath: string, childPath: string): void => {
      const normalizedFolderPath =
        folderPath.length === 0 ? ROOT_ID : folderPath;
      const normalizedChildPath = childPath.length === 0 ? ROOT_ID : childPath;
      const existing = dirtyChildrenByFolderPath.get(normalizedFolderPath);
      if (existing != null) {
        existing.add(normalizedChildPath);
        return;
      }
      dirtyChildrenByFolderPath.set(
        normalizedFolderPath,
        new Set([normalizedChildPath])
      );
    };

    for (const folderPath of folderPaths) {
      const normalizedFolderPath =
        folderPath.length === 0 ? ROOT_ID : folderPath;
      if (normalizedFolderPath === ROOT_ID) {
        continue;
      }
      markDirtyChild(getParentPath(normalizedFolderPath), normalizedFolderPath);
    }

    const isLocallyAffectedFolder = (path: string): boolean => {
      let currentPath = path;
      while (currentPath !== ROOT_ID) {
        if (folderPaths.has(currentPath)) {
          return true;
        }
        currentPath = getParentPath(currentPath);
      }
      return false;
    };

    const rebuildFolder = (folderPath: string): void => {
      const normalizedFolderPath =
        folderPath.length === 0 ? ROOT_ID : folderPath;

      if (rebuiltFolders.has(normalizedFolderPath)) {
        return;
      }
      if (rebuildingFolders.has(normalizedFolderPath)) {
        return;
      }

      if (
        normalizedFolderPath !== ROOT_ID &&
        !pathTree.hasFolder(normalizedFolderPath)
      ) {
        let removedFolder = false;
        const missingFolderId = this.resolveIdForPath(normalizedFolderPath);
        if (missingFolderId != null) {
          const subtreePrefix = `${normalizedFolderPath}/`;
          this.removeSubtreeById(missingFolderId, (path) => {
            const rawPath = path.startsWith(FLATTENED_PREFIX)
              ? path.slice(FLATTENED_PREFIX_LENGTH)
              : path;
            return (
              rawPath === normalizedFolderPath ||
              rawPath.startsWith(subtreePrefix)
            );
          });
          removedFolder = true;
        }

        rebuiltFolders.add(normalizedFolderPath);
        if (removedFolder) {
          const parentPath = getParentPath(normalizedFolderPath);
          markDirtyChild(parentPath, normalizedFolderPath);
          rebuildFolder(parentPath);
        }
        return;
      }

      rebuildingFolders.add(normalizedFolderPath);

      const folderId =
        normalizedFolderPath === ROOT_ID
          ? ROOT_ID
          : this.ensureStableIdForPath(normalizedFolderPath);
      const previousNode = this.tree.get(folderId);
      const previousDirectChildren = previousNode?.children?.direct ?? [];
      const previousFlattenedChildren = previousNode?.children?.flattened ?? [];
      const previousHadSingleFolderChild =
        previousDirectChildren.length === 1 &&
        this.tree.get(previousDirectChildren[0])?.children?.direct != null;
      const previousFlattenedByStartId = new Map<string, string>();
      for (
        let index = 0;
        index < previousFlattenedChildren.length;
        index += 1
      ) {
        const previousFlattenedId = previousFlattenedChildren[index];
        const flattenedNode = this.tree.get(previousFlattenedId);
        const flattenedStartId = flattenedNode?.flattens?.[0];
        if (flattenedStartId != null) {
          previousFlattenedByStartId.set(flattenedStartId, previousFlattenedId);
        }
      }

      const dirtyChildPaths =
        dirtyChildrenByFolderPath.get(normalizedFolderPath);

      let directChildren: Array<{
        path: string;
        kind: 'folder' | 'file';
      }> | null = null;
      let directChildIds: string[];

      let canReuseDirectChildren =
        previousNode != null &&
        pathTree.getDirectChildCount(normalizedFolderPath) ===
          previousDirectChildren.length;

      if (canReuseDirectChildren) {
        for (let index = 0; index < previousDirectChildren.length; index += 1) {
          const previousChildId = previousDirectChildren[index];
          const previousChildPath = this.getResolvedPathForId(previousChildId);
          if (
            previousChildPath == null ||
            getParentPath(previousChildPath) !== normalizedFolderPath ||
            !pathTree.hasPath(previousChildPath)
          ) {
            canReuseDirectChildren = false;
            break;
          }
        }
      }

      if (canReuseDirectChildren) {
        directChildIds = previousDirectChildren;
      } else {
        directChildren = pathTree.getDirectChildren(normalizedFolderPath);
        this.sortPathTreeChildren(directChildren, pathTree);

        directChildIds = new Array<string>(directChildren.length);
        for (let index = 0; index < directChildren.length; index += 1) {
          const child = directChildren[index];
          const childId = this.ensureStableIdForPath(child.path);
          directChildIds[index] = childId;

          const existingNode = this.tree.get(childId);
          if (child.kind === 'folder') {
            if (existingNode?.children == null) {
              this.tree.set(childId, {
                name: getLeafName(child.path),
                path: child.path,
                children: { direct: [] },
              });
              this.setDirectChildIndexCache(childId, []);
            } else {
              existingNode.path = child.path;
              existingNode.name = getLeafName(child.path);
            }
          } else {
            this.tree.set(childId, {
              name: getLeafName(child.path),
              path: child.path,
            });
            this.directChildIndexByFolderId.delete(childId);
          }
        }

        if (previousDirectChildren.length > 0) {
          const nextDirectSet = new Set(directChildIds);
          for (
            let index = 0;
            index < previousDirectChildren.length;
            index += 1
          ) {
            const previousChildId = previousDirectChildren[index];
            if (nextDirectSet.has(previousChildId)) {
              continue;
            }

            const previousChildPath =
              this.getResolvedPathForId(previousChildId);
            if (previousChildPath == null) {
              continue;
            }

            if (pathTree.hasPath(previousChildPath)) {
              continue;
            }

            this.removeSubtreeById(previousChildId);
          }
        }
      }

      const resolveEndpoint = (path: string): string | null => {
        if (flattenedEndpointCache.has(path)) {
          return flattenedEndpointCache.get(path) ?? null;
        }

        const endpoint = this.getFlattenedEndpoint(pathTree, path);
        flattenedEndpointCache.set(path, endpoint);
        return endpoint;
      };

      const ensureFlattenedNode = (
        startPath: string,
        endpointPath: string
      ): string => {
        rebuildFolder(endpointPath);

        const flattenedPath = `${FLATTENED_PREFIX}${endpointPath}`;
        const flattenedId = this.ensureStableIdForPath(flattenedPath);

        const endpointId = this.resolveIdForPath(endpointPath);
        const endpointNode =
          endpointId != null ? this.tree.get(endpointId) : undefined;
        const endpointChildren = endpointNode?.children;
        const previousFlattenedChildren =
          this.tree.get(flattenedId)?.children?.flattened?.slice() ?? [];

        const flattenedFolders = this.collectFlattenedFolderChain(
          pathTree,
          startPath,
          endpointPath
        );
        const flattens = new Array<string>(flattenedFolders.length);
        for (let index = 0; index < flattenedFolders.length; index += 1) {
          flattens[index] = this.ensureStableIdForPath(flattenedFolders[index]);
        }

        const nextFlattenedChildren = endpointChildren?.flattened?.slice();
        const flattenedNode: FileTreeNode = {
          name: this.buildFlattenedDisplayName(startPath, endpointPath),
          path: flattenedPath,
          flattens,
          children: {
            direct: endpointChildren?.direct?.slice() ?? [],
            ...(nextFlattenedChildren != null && {
              flattened: nextFlattenedChildren,
            }),
          },
        };

        this.tree.set(flattenedId, flattenedNode);

        const previousFlattenedSet = new Set(previousFlattenedChildren);
        const nextFlattenedSet = new Set(nextFlattenedChildren ?? []);
        for (const childId of previousFlattenedSet) {
          if (!nextFlattenedSet.has(childId)) {
            this.decrementFlattenedReference(childId);
          }
        }
        for (const childId of nextFlattenedSet) {
          if (!previousFlattenedSet.has(childId)) {
            this.incrementFlattenedReference(childId);
          }
        }

        return flattenedId;
      };

      let flattenedChildIds: string[] | undefined;
      if (canReuseDirectChildren) {
        if (previousFlattenedChildren.length > 0) {
          flattenedChildIds = previousFlattenedChildren.slice();
        }

        if (dirtyChildPaths != null && dirtyChildPaths.size > 0) {
          for (const dirtyChildPath of dirtyChildPaths) {
            const dirtyChildId = this.resolveIdForPath(dirtyChildPath);
            if (dirtyChildId == null) {
              continue;
            }

            const childIndex = this.getDirectChildIndex(
              folderId,
              dirtyChildId,
              directChildIds
            );
            if (childIndex < 0) {
              continue;
            }

            let nextChildEntryId = dirtyChildId;
            if (pathTree.hasFolder(dirtyChildPath)) {
              const endpointPath = resolveEndpoint(dirtyChildPath);
              if (endpointPath != null) {
                nextChildEntryId = ensureFlattenedNode(
                  dirtyChildPath,
                  endpointPath
                );
              }
            }

            const currentChildEntryId =
              flattenedChildIds?.[childIndex] ?? directChildIds[childIndex];
            if (nextChildEntryId === currentChildEntryId) {
              continue;
            }

            flattenedChildIds ??= directChildIds.slice();
            flattenedChildIds[childIndex] = nextChildEntryId;
          }
        }
      } else {
        if (directChildren == null) {
          throw new Error(
            'FileTreeModel: expected direct children for non-reused folder rebuild.'
          );
        }

        for (let index = 0; index < directChildren.length; index += 1) {
          const child = directChildren[index];

          if (child.kind === 'folder') {
            const endpointPath = resolveEndpoint(child.path);
            if (endpointPath != null) {
              const childId = directChildIds[index];
              const reusableFlattenedId =
                previousFlattenedByStartId.get(childId) ?? null;

              if (
                reusableFlattenedId != null &&
                !isLocallyAffectedFolder(child.path)
              ) {
                flattenedChildIds ??= directChildIds.slice(0, index);
                flattenedChildIds.push(reusableFlattenedId);
                continue;
              }

              const flattenedId = ensureFlattenedNode(child.path, endpointPath);
              flattenedChildIds ??= directChildIds.slice(0, index);
              flattenedChildIds.push(flattenedId);
              continue;
            }
          }

          if (flattenedChildIds != null) {
            flattenedChildIds.push(directChildIds[index]);
          }
        }
      }

      this.tree.set(folderId, {
        name:
          normalizedFolderPath === ROOT_ID
            ? ROOT_ID
            : getLeafName(normalizedFolderPath),
        path: normalizedFolderPath,
        children: {
          direct: directChildIds,
          ...(flattenedChildIds != null && {
            flattened: flattenedChildIds,
          }),
        },
      });
      this.setDirectChildIndexCache(folderId, directChildIds);

      const previousFlattenedSet = new Set(previousFlattenedChildren);
      const nextFlattenedSet = new Set(flattenedChildIds ?? []);

      for (const flattenedId of previousFlattenedSet) {
        if (!nextFlattenedSet.has(flattenedId)) {
          this.decrementFlattenedReference(flattenedId);
        }
      }
      for (const flattenedId of nextFlattenedSet) {
        if (!previousFlattenedSet.has(flattenedId)) {
          this.incrementFlattenedReference(flattenedId);
        }
      }

      const nextFlattenedChildren = flattenedChildIds ?? [];
      const folderChildrenChanged =
        previousNode == null ||
        !this.areIdArraysEqual(previousDirectChildren, directChildIds) ||
        !this.areIdArraysEqual(
          previousFlattenedChildren,
          nextFlattenedChildren
        );
      let nextHasSingleFolderChild = false;
      if (canReuseDirectChildren) {
        if (directChildIds.length === 1) {
          const onlyChildPath = this.getResolvedPathForId(directChildIds[0]);
          nextHasSingleFolderChild =
            onlyChildPath != null && pathTree.hasFolder(onlyChildPath);
        }
      } else {
        nextHasSingleFolderChild =
          directChildren != null &&
          directChildren.length === 1 &&
          directChildren[0]?.kind === 'folder';
      }
      const shouldPropagateToParent =
        normalizedFolderPath !== ROOT_ID &&
        folderChildrenChanged &&
        (previousNode == null ||
          previousHadSingleFolderChild ||
          nextHasSingleFolderChild);

      rebuildingFolders.delete(normalizedFolderPath);
      rebuiltFolders.add(normalizedFolderPath);

      if (shouldPropagateToParent) {
        const parentPath = getParentPath(normalizedFolderPath);
        markDirtyChild(parentPath, normalizedFolderPath);
        rebuildFolder(parentPath);
      }
    };

    for (const folderPath of folderPaths) {
      rebuildFolder(folderPath);
    }

    this.setModelCounter(
      'model.rebuildFolders.executedCount',
      rebuiltFolders.size
    );
  }

  subscribe(listener: (mutation: FileTreeModelMutation) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  getVersion(): number {
    return this.version;
  }

  /**
   * Prepares mutable indexes used by structural mutations (add/delete/move).
   *
   * This lets callers shift one-time index construction cost out of a hot
   * interaction path (for example: prime during initial mount, then mutate).
   */
  prepareMutationIndexes(): void {
    this.getOrCreatePathTree();
  }

  getFiles(): string[] {
    this.syncFilesSnapshotFromPathTree();
    this.applyPendingFileSnapshotPrefixRemaps();
    return this.files;
  }

  getSyncIndex(): FileListSyncIndex {
    return this.syncIndex;
  }

  getPathForId(id: string): string | undefined {
    return this.getResolvedPathForId(id);
  }

  hasId(id: string): boolean {
    return this.idToPathMap.has(id);
  }

  getIdToPathLookup(): IdToPathLookup {
    return this.idToPathLookup;
  }

  setSortComparator(sortComparator: ChildrenSortOption | undefined): void {
    const nextComparator = sortComparator ?? defaultChildrenComparator;
    if (this.sortComparator === nextComparator) {
      return;
    }
    this.sortComparator = nextComparator;
    this.syncFilesSnapshotFromPathTree();
    this.applyPendingFileSnapshotPrefixRemaps();
    this.replaceAll(this.files);
  }

  replaceAll(files: string[]): void {
    this.materializePendingPathPrefixRemaps();
    const builtIndex = buildStableIndexFromFiles(
      files,
      this.sortComparator,
      null,
      this.pathToIdMap,
      this.nextNodeId
    );
    this.applyBuiltIndex(builtIndex);
    this.emitMutation({ kind: 'replace-all' });
  }

  /**
   * Rebinds a single source path to a destination path while preserving its
   * stable ID. Used for direct file moves where no subtree-wide remap is needed.
   */
  private remapDirectPath(
    sourcePath: string,
    destinationPath: string
  ): boolean {
    const sourceId = this.resolveIdForPath(sourcePath);
    if (sourceId == null) {
      return false;
    }

    const existingDestinationId = this.resolveIdForPath(destinationPath);
    if (existingDestinationId != null && existingDestinationId !== sourceId) {
      return false;
    }

    const canonicalSourcePath = this.remapPathBackward(sourcePath);
    const canonicalDestinationPath = this.remapPathBackward(destinationPath);

    this.pathToIdMap.delete(canonicalSourcePath);
    this.pathToIdMap.set(canonicalDestinationPath, sourceId);
    this.idToPathMap.set(sourceId, canonicalDestinationPath);

    const node = this.tree.get(sourceId);
    if (node != null) {
      node.path = canonicalDestinationPath;
      node.name = getLeafName(destinationPath);
    }

    return true;
  }

  private hasFastMoveCollision(
    pathTree: MutablePathTree,
    fileRules: readonly PlannedMoveRule[],
    folderRules: readonly PlannedMoveRule[]
  ): boolean {
    const sourcePaths = new Set<string>();
    for (let index = 0; index < fileRules.length; index += 1) {
      sourcePaths.add(fileRules[index].sourcePath);
    }
    for (let index = 0; index < folderRules.length; index += 1) {
      sourcePaths.add(folderRules[index].sourcePath);
    }

    const destinationPaths = new Set<string>();
    const allRules = [...fileRules, ...folderRules];

    for (let index = 0; index < allRules.length; index += 1) {
      const rule = allRules[index];
      if (destinationPaths.has(rule.destinationPath)) {
        return true;
      }
      destinationPaths.add(rule.destinationPath);

      if (sourcePaths.has(rule.destinationPath)) {
        return true;
      }

      if (
        pathTree.hasPath(rule.destinationPath) &&
        !sourcePaths.has(rule.destinationPath)
      ) {
        return true;
      }

      const destinationParentPath = getParentPath(rule.destinationPath);
      if (
        destinationParentPath !== ROOT_ID &&
        pathTree.hasFile(destinationParentPath)
      ) {
        return true;
      }
    }

    return false;
  }

  /**
   * Fast-path move application for collision-free operations.
   *
   * This avoids per-descendant remap scans by queuing folder prefix remaps and
   * only rebinding direct file paths that actually moved.
   */
  private tryApplyCollisionFreeMoveRules(
    pathTree: MutablePathTree,
    fileRules: readonly PlannedMoveRule[],
    folderRules: readonly PlannedMoveRule[]
  ): FileTreeModelMoveResult | null {
    if (fileRules.length === 0 && folderRules.length === 0) {
      return { ok: true, mutation: null };
    }

    if (this.hasFastMoveCollision(pathTree, fileRules, folderRules)) {
      return null;
    }

    const movedRules: PlannedMoveRule[] = [];

    for (let index = 0; index < fileRules.length; index += 1) {
      const rule = fileRules[index];
      const { parentPath, baseName } = splitPath(rule.destinationPath);
      const moveResult = pathTree.movePath(
        rule.sourcePath,
        parentPath === '' ? ROOT_ID : parentPath,
        baseName,
        'file'
      );
      if (moveResult !== 'ok') {
        return null;
      }

      if (!this.remapDirectPath(rule.sourcePath, rule.destinationPath)) {
        return null;
      }

      movedRules.push(rule);
    }

    for (let index = 0; index < folderRules.length; index += 1) {
      const rule = folderRules[index];
      const { parentPath, baseName } = splitPath(rule.destinationPath);
      const moveResult = pathTree.movePath(
        rule.sourcePath,
        parentPath === '' ? ROOT_ID : parentPath,
        baseName,
        'folder'
      );
      if (moveResult !== 'ok') {
        return null;
      }

      const folderId = this.resolveIdForPath(rule.sourcePath);
      if (folderId != null) {
        const folderNode = this.tree.get(folderId);
        if (folderNode != null) {
          folderNode.name = getLeafName(rule.destinationPath);
        }
      }

      this.queuePathPrefixRemap(rule.sourcePath, rule.destinationPath);
      movedRules.push(rule);
    }

    if (movedRules.length === 0) {
      return { ok: true, mutation: null };
    }

    this.setModelCounter('model.move.remapScannedNodes', movedRules.length);
    this.setModelCounter('model.move.remapUpdatedNodes', movedRules.length);

    this.adoptPathTreeFilesReference(pathTree);

    const affectedFolderPaths = new Set<string>();
    const affectedParentIdsSet = new Set<string>();

    for (let index = 0; index < movedRules.length; index += 1) {
      const rule = movedRules[index];
      const sourceParentPath = getParentPath(rule.sourcePath);
      const destinationParentPath = getParentPath(rule.destinationPath);

      affectedFolderPaths.add(sourceParentPath);
      affectedFolderPaths.add(destinationParentPath);

      affectedParentIdsSet.add(this.resolveAncestorId(sourceParentPath));
      affectedParentIdsSet.add(this.resolveAncestorId(destinationParentPath));
    }

    if (affectedFolderPaths.size === 0) {
      affectedFolderPaths.add(ROOT_ID);
    }

    this.rebuildFolderNodesFromPathTree(pathTree, affectedFolderPaths);
    this.prunePendingFlattenedNodes();

    const movedPaths = movedRules.map((rule) => ({
      sourcePath: rule.sourcePath,
      destinationPath: rule.destinationPath,
      isFolder: rule.isFolder,
    }));

    const mutation = {
      kind: 'move-paths' as const,
      movedPaths,
      affectedParentIds: [...affectedParentIdsSet],
    };
    this.emitMutation(mutation);

    return {
      ok: true,
      mutation: {
        ...mutation,
        version: this.version,
      },
    };
  }

  movePaths({
    draggedPaths,
    targetPath,
    onCollision,
  }: FileTreeModelMoveRequest): FileTreeModelMoveResult {
    const normalizedTarget = normalizeTreePath(targetPath.trim());
    if (normalizedTarget.length === 0) {
      return { ok: false, error: 'Target path cannot be empty.' };
    }

    const targetPrefix =
      normalizedTarget === ROOT_ID ? '' : `${normalizedTarget}/`;

    if (draggedPaths.length === 0 || this.getKnownFileCount() === 0) {
      return { ok: true, mutation: null };
    }

    const pathTree = this.getOrCreatePathTree();

    const normalizedDragged = [...new Set(draggedPaths.map(normalizeTreePath))]
      .map((path) => path.trim())
      .filter((path) => path.length > 0);
    if (normalizedDragged.length === 0) {
      return { ok: true, mutation: null };
    }

    const orderedDragged = normalizedDragged
      .filter((path) => pathTree.hasPath(path))
      .map((path) => ({
        path,
        kind: pathTree.hasFolder(path) ? 'folder' : 'file',
        depth: getPathDepth(path),
      }))
      .sort((left, right) => left.depth - right.depth);

    if (orderedDragged.length === 0) {
      return { ok: true, mutation: null };
    }

    const selectedFolders = new Set<string>();
    const selectedFiles = new Set<string>();
    for (let index = 0; index < orderedDragged.length; index += 1) {
      const item = orderedDragged[index];
      if (hasSelectedFolderAncestor(item.path, selectedFolders)) {
        continue;
      }

      if (item.kind === 'folder') {
        selectedFolders.add(item.path);
        continue;
      }

      selectedFiles.add(item.path);
    }

    const fileRules: PlannedMoveRule[] = [];
    const folderRules: PlannedMoveRule[] = [];

    for (const selectedFile of selectedFiles) {
      const destinationPath = `${targetPrefix}${getLeafName(selectedFile)}`;
      if (destinationPath === selectedFile) {
        continue;
      }

      fileRules.push({
        sourcePath: selectedFile,
        destinationPath,
        isFolder: false,
      });
    }

    for (const selectedFolder of selectedFolders) {
      if (
        normalizedTarget === selectedFolder ||
        isPathDescendant(normalizedTarget, selectedFolder)
      ) {
        continue;
      }

      const destinationPath = `${targetPrefix}${getLeafName(selectedFolder)}`;
      if (destinationPath === selectedFolder) {
        continue;
      }

      folderRules.push({
        sourcePath: selectedFolder,
        destinationPath,
        isFolder: true,
      });
    }

    const fastPathResult = this.tryApplyCollisionFreeMoveRules(
      pathTree,
      fileRules,
      folderRules
    );
    if (fastPathResult != null) {
      return fastPathResult;
    }

    const plannedActions: Array<{
      originPath: string;
      destinationPath: string;
      sourceIndex: number;
      folderSourcePath: string | null;
    }> = [];
    const plannedOrigins = new Set<string>();

    for (let index = 0; index < fileRules.length; index += 1) {
      const rule = fileRules[index];
      const sourceIndex = pathTree.getFileIndex(rule.sourcePath);
      if (sourceIndex == null) {
        continue;
      }
      plannedActions.push({
        originPath: rule.sourcePath,
        destinationPath: rule.destinationPath,
        sourceIndex,
        folderSourcePath: null,
      });
      plannedOrigins.add(rule.sourcePath);
    }

    for (let index = 0; index < folderRules.length; index += 1) {
      const rule = folderRules[index];
      const descendants = pathTree.getDescendantFilePaths(rule.sourcePath);
      for (
        let descendantIndex = 0;
        descendantIndex < descendants.length;
        descendantIndex += 1
      ) {
        const originPath = descendants[descendantIndex];
        const destinationPath = `${rule.destinationPath}${originPath.slice(rule.sourcePath.length)}`;
        if (destinationPath === originPath || plannedOrigins.has(originPath)) {
          continue;
        }

        const sourceIndex = pathTree.getFileIndex(originPath);
        if (sourceIndex == null) {
          continue;
        }

        plannedActions.push({
          originPath,
          destinationPath,
          sourceIndex,
          folderSourcePath: rule.sourcePath,
        });
        plannedOrigins.add(originPath);
      }
    }

    plannedActions.sort((left, right) => left.sourceIndex - right.sourceIndex);
    if (plannedActions.length === 0) {
      return { ok: true, mutation: null };
    }

    const finalPathByOrigin = new Map<string, string | null>();
    const originByCurrentPath = new Map<string, string>();
    for (let index = 0; index < plannedActions.length; index += 1) {
      const originPath = plannedActions[index].originPath;
      if (finalPathByOrigin.has(originPath)) {
        continue;
      }
      finalPathByOrigin.set(originPath, originPath);
      originByCurrentPath.set(originPath, originPath);
    }

    const removedFilePaths: string[] = [];
    const movedFileDestinationByOrigin = new Map<string, string>();
    const activeFolderSources = new Set<string>();

    for (let index = 0; index < plannedActions.length; index += 1) {
      const action = plannedActions[index];
      const originPath = action.originPath;
      const currentPath = finalPathByOrigin.get(originPath);

      if (currentPath == null || currentPath === action.destinationPath) {
        continue;
      }
      if (!pathTree.hasFile(currentPath)) {
        finalPathByOrigin.set(originPath, null);
        originByCurrentPath.delete(currentPath);
        movedFileDestinationByOrigin.delete(originPath);
        continue;
      }

      if (
        pathTree.hasFile(action.destinationPath) &&
        action.destinationPath !== currentPath
      ) {
        const allowOverwrite =
          onCollision?.({
            origin: originPath,
            destination: action.destinationPath,
          }) === true;
        if (!allowOverwrite) {
          continue;
        }

        pathTree.deleteFilePath(action.destinationPath);

        const removedMovingOrigin = originByCurrentPath.get(
          action.destinationPath
        );
        if (removedMovingOrigin != null) {
          finalPathByOrigin.set(removedMovingOrigin, null);
          movedFileDestinationByOrigin.delete(removedMovingOrigin);
          originByCurrentPath.delete(action.destinationPath);
          removedFilePaths.push(removedMovingOrigin);
        } else {
          removedFilePaths.push(action.destinationPath);
        }
      }

      const { parentPath, baseName } = splitPath(action.destinationPath);
      const moveResult = pathTree.movePath(
        currentPath,
        parentPath === '' ? ROOT_ID : parentPath,
        baseName,
        'file'
      );
      if (moveResult !== 'ok') {
        continue;
      }

      finalPathByOrigin.set(originPath, action.destinationPath);
      movedFileDestinationByOrigin.set(originPath, action.destinationPath);
      originByCurrentPath.delete(currentPath);
      originByCurrentPath.set(action.destinationPath, originPath);
      if (action.folderSourcePath != null) {
        activeFolderSources.add(action.folderSourcePath);
      }
    }

    if (
      movedFileDestinationByOrigin.size === 0 &&
      removedFilePaths.length === 0
    ) {
      return { ok: true, mutation: null };
    }

    const remapRules = [...fileRules, ...folderRules]
      .filter((rule) => {
        if (!rule.isFolder) {
          return (
            movedFileDestinationByOrigin.get(rule.sourcePath) ===
            rule.destinationPath
          );
        }
        return activeFolderSources.has(rule.sourcePath);
      })
      .sort((left, right) => right.sourcePath.length - left.sourcePath.length);

    this.applyPathRemapRules(remapRules);
    this.adoptPathTreeFilesReference(pathTree);

    const affectedFolderPaths = new Set<string>();
    for (let index = 0; index < remapRules.length; index += 1) {
      const rule = remapRules[index];
      affectedFolderPaths.add(getParentPath(rule.sourcePath));
      affectedFolderPaths.add(getParentPath(rule.destinationPath));
    }
    for (let index = 0; index < removedFilePaths.length; index += 1) {
      affectedFolderPaths.add(getParentPath(removedFilePaths[index]));
    }
    if (affectedFolderPaths.size === 0) {
      affectedFolderPaths.add(ROOT_ID);
    }

    this.rebuildFolderNodesFromPathTree(pathTree, affectedFolderPaths);
    this.prunePendingFlattenedNodes();

    const affectedParentIdsSet = new Set<string>();
    for (let index = 0; index < remapRules.length; index += 1) {
      const rule = remapRules[index];
      affectedParentIdsSet.add(
        this.resolveAncestorId(getParentPath(rule.sourcePath))
      );
      affectedParentIdsSet.add(
        this.resolveAncestorId(getParentPath(rule.destinationPath))
      );
    }
    for (let index = 0; index < removedFilePaths.length; index += 1) {
      affectedParentIdsSet.add(
        this.resolveAncestorId(getParentPath(removedFilePaths[index]))
      );
    }

    const movedPaths = remapRules.map((rule) => ({
      sourcePath: rule.sourcePath,
      destinationPath: rule.destinationPath,
      isFolder: rule.isFolder,
    }));

    const mutation = {
      kind: 'move-paths' as const,
      movedPaths,
      affectedParentIds: [...affectedParentIdsSet],
    };
    this.emitMutation(mutation);

    return {
      ok: true,
      mutation: {
        ...mutation,
        version: this.version,
      },
    };
  }

  addPaths({
    paths,
  }: FileTreeModelAddPathsRequest): FileTreeModelAddPathsResult {
    if (paths.length === 0) {
      return { ok: true, mutation: null };
    }

    const normalizedPaths = [...new Set(paths.map(normalizeTreePath))]
      .map((path) => path.trim())
      .filter((path) => path.length > 0);
    if (normalizedPaths.length === 0) {
      return { ok: true, mutation: null };
    }

    const pathTree = this.getOrCreatePathTree();

    const addedPaths: string[] = [];
    for (let index = 0; index < normalizedPaths.length; index += 1) {
      const path = normalizedPaths[index];
      if (pathTree.addFilePath(path)) {
        addedPaths.push(path);
      }
    }

    if (addedPaths.length === 0) {
      return { ok: true, mutation: null };
    }

    this.adoptPathTreeFilesReference(pathTree);

    const affectedFolderPaths = new Set<string>();
    for (let index = 0; index < addedPaths.length; index += 1) {
      affectedFolderPaths.add(getParentPath(addedPaths[index]));
    }
    if (affectedFolderPaths.size === 0) {
      affectedFolderPaths.add(ROOT_ID);
    }

    this.rebuildFolderNodesFromPathTree(pathTree, affectedFolderPaths);
    this.prunePendingFlattenedNodes();

    const mutation = {
      kind: 'add-paths' as const,
      addedPaths,
      affectedParentIds: this.resolveAncestorIdsForPaths(addedPaths),
    };
    this.emitMutation(mutation);

    return {
      ok: true,
      mutation: {
        ...mutation,
        version: this.version,
      },
    };
  }

  deletePaths({
    paths,
  }: FileTreeModelDeletePathsRequest): FileTreeModelDeletePathsResult {
    if (paths.length === 0) {
      return { ok: true, mutation: null };
    }

    const normalizedPaths = [...new Set(paths.map(normalizeTreePath))]
      .map((path) => path.trim())
      .filter((path) => path.length > 0);
    if (normalizedPaths.length === 0) {
      return { ok: true, mutation: null };
    }

    const pathTree = this.getOrCreatePathTree();

    const orderedPaths = normalizedPaths
      .map((path) => ({ path, depth: getPathDepth(path) }))
      .sort((left, right) => left.depth - right.depth);

    const selectedFolders = new Set<string>();
    const selectedFiles: string[] = [];

    for (let index = 0; index < orderedPaths.length; index += 1) {
      const path = orderedPaths[index].path;
      if (hasSelectedFolderAncestor(path, selectedFolders)) {
        continue;
      }

      if (pathTree.hasFolder(path)) {
        selectedFolders.add(path);
        continue;
      }

      if (pathTree.hasFile(path)) {
        selectedFiles.push(path);
      }
    }

    const deletedPaths = pathTree.deleteFilePaths(selectedFiles);

    for (const path of selectedFolders) {
      if (pathTree.deleteFolderPath(path)) {
        deletedPaths.push(path);
      }
    }

    if (deletedPaths.length === 0) {
      return { ok: true, mutation: null };
    }

    this.adoptPathTreeFilesReference(pathTree);

    const affectedFolderPaths = new Set<string>();
    for (let index = 0; index < deletedPaths.length; index += 1) {
      affectedFolderPaths.add(getParentPath(deletedPaths[index]));
    }
    if (affectedFolderPaths.size === 0) {
      affectedFolderPaths.add(ROOT_ID);
    }

    this.rebuildFolderNodesFromPathTree(pathTree, affectedFolderPaths);
    this.prunePendingFlattenedNodes();

    const mutation = {
      kind: 'delete-paths' as const,
      deletedPaths,
      affectedParentIds: this.resolveAncestorIdsForPaths(deletedPaths),
    };
    this.emitMutation(mutation);

    return {
      ok: true,
      mutation: {
        ...mutation,
        version: this.version,
      },
    };
  }

  renamePath({
    sourcePath,
    destinationPath,
    isFolder,
  }: FileTreeModelRenameRequest): FileTreeModelRenameResult {
    const normalizedSourcePath = sourcePath.trim();
    const normalizedDestinationPath = destinationPath.trim();

    if (
      normalizedSourcePath.length === 0 ||
      normalizedDestinationPath.length === 0
    ) {
      return { ok: false, error: 'Path cannot be empty.' };
    }

    if (normalizedSourcePath === normalizedDestinationPath) {
      return { ok: true, mutation: null };
    }

    if (
      getParentPath(normalizedSourcePath) !==
      getParentPath(normalizedDestinationPath)
    ) {
      return {
        ok: false,
        error: 'renamePath currently supports same-parent renames only.',
      };
    }

    const canonicalSourcePath = this.remapPathBackward(normalizedSourcePath);
    const canonicalDestinationPath = this.remapPathBackward(
      normalizedDestinationPath
    );

    const nodeId = this.resolveIdForPath(normalizedSourcePath);
    if (nodeId == null) {
      return {
        ok: false,
        error: 'Could not find the selected path to rename.',
      };
    }

    const existingDestinationId = this.resolveIdForPath(
      normalizedDestinationPath
    );
    if (existingDestinationId != null && existingDestinationId !== nodeId) {
      return {
        ok: false,
        error: `"${normalizedDestinationPath}" already exists.`,
      };
    }

    const node = this.tree.get(nodeId);
    if (node == null) {
      return {
        ok: false,
        error: 'Could not find the selected path to rename.',
      };
    }

    const nodeIsFolder = node.children?.direct != null;
    if (isFolder != null && nodeIsFolder !== isFolder) {
      return {
        ok: false,
        error: 'Rename target type does not match model data.',
      };
    }

    const parentPath = getParentPath(normalizedSourcePath);
    const parentId = this.resolveIdForPath(parentPath) ?? ROOT_ID;
    const parentChildrenBeforeSort =
      this.captureParentChildrenSnapshot(parentId);

    if (!nodeIsFolder) {
      if (this.pathTree != null) {
        const renameResult = this.pathTree.renamePath(
          normalizedSourcePath,
          normalizedDestinationPath,
          'file'
        );
        if (renameResult === 'missing') {
          return {
            ok: false,
            error: 'Could not find the selected file to rename.',
          };
        }
        if (renameResult === 'collision') {
          return {
            ok: false,
            error: `"${normalizedDestinationPath}" already exists.`,
          };
        }
        if (renameResult === 'invalid') {
          return {
            ok: false,
            error: 'Could not rename the selected file.',
          };
        }

        this.adoptPathTreeFilesReference(this.pathTree);
      } else {
        const sourceIndex = this.getFileIndexFromSnapshot(normalizedSourcePath);
        if (sourceIndex < 0) {
          return {
            ok: false,
            error: 'Could not find the selected file to rename.',
          };
        }

        this.files[sourceIndex] = normalizedDestinationPath;
        this.fileIndexByPath.delete(normalizedSourcePath);
        this.fileIndexByPath.set(normalizedDestinationPath, sourceIndex);
      }

      this.pathToIdMap.delete(canonicalSourcePath);
      this.pathToIdMap.set(canonicalDestinationPath, nodeId);
      this.idToPathMap.set(nodeId, canonicalDestinationPath);

      node.path = canonicalDestinationPath;
      node.name = getLeafName(normalizedDestinationPath);

      this.sortChildren(parentId);
      const childrenOrderChanged = this.didParentChildrenOrderChange(
        parentId,
        parentChildrenBeforeSort
      );
      this.setModelCounter('model.rename.file.remapScannedNodes', 1);
      this.setModelCounter('model.rename.file.remapUpdatedNodes', 1);

      const mutation = {
        kind: 'rename-path' as const,
        sourcePath: normalizedSourcePath,
        destinationPath: normalizedDestinationPath,
        isFolder: false,
        parentId,
        nodeId,
        childrenOrderChanged,
      };
      this.emitMutation(mutation);
      return {
        ok: true,
        mutation: { ...mutation, version: this.version },
      };
    }

    if (this.pathTree != null) {
      const folderRenameResult = this.pathTree.renamePath(
        normalizedSourcePath,
        normalizedDestinationPath,
        'folder'
      );
      if (folderRenameResult === 'missing') {
        return {
          ok: false,
          error: 'Could not find the selected folder to rename.',
        };
      }
      if (folderRenameResult === 'collision') {
        return {
          ok: false,
          error: `"${normalizedDestinationPath}" already exists.`,
        };
      }
      if (folderRenameResult === 'invalid') {
        return {
          ok: false,
          error: 'Could not rename the selected folder.',
        };
      }

      this.adoptPathTreeFilesReference(this.pathTree);
    } else {
      this.queueFileSnapshotPrefixRemap(
        normalizedSourcePath,
        normalizedDestinationPath
      );
    }

    this.queuePathPrefixRemap(normalizedSourcePath, normalizedDestinationPath);
    node.name = getLeafName(normalizedDestinationPath);

    this.sortChildren(parentId);
    const childrenOrderChanged = this.didParentChildrenOrderChange(
      parentId,
      parentChildrenBeforeSort
    );
    this.setModelCounter('model.rename.folder.remapScannedNodes', 1);
    this.setModelCounter('model.rename.folder.remapUpdatedNodes', 1);

    const mutation = {
      kind: 'rename-path' as const,
      sourcePath: normalizedSourcePath,
      destinationPath: normalizedDestinationPath,
      isFolder: true,
      parentId,
      nodeId,
      childrenOrderChanged,
    };
    this.emitMutation(mutation);
    return {
      ok: true,
      mutation: { ...mutation, version: this.version },
    };
  }
}
