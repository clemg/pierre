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
  createMapPathToIdLookup,
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

/**
 * Applies a precomputed file origin->destination mapping to a mutable path
 * tree. Returns false if we hit an unexpected inconsistency and need to fall
 * back to rebuilding the tree from a snapshot.
 */
function applyMappedFilesToPathTree(
  pathTree: MutablePathTree,
  currentFiles: string[],
  finalPathByOrigin: Map<string, string | null>
): boolean {
  for (let index = 0; index < currentFiles.length; index += 1) {
    const origin = currentFiles[index];
    if (finalPathByOrigin.get(origin) != null) {
      continue;
    }
    pathTree.deleteFilePath(origin);
  }

  for (let index = 0; index < currentFiles.length; index += 1) {
    const origin = currentFiles[index];
    const destination = finalPathByOrigin.get(origin);
    if (destination == null || destination === origin) {
      continue;
    }

    const { parentPath, baseName } = splitPath(destination);
    const moveResult = pathTree.movePath(
      origin,
      parentPath === '' ? ROOT_ID : parentPath,
      baseName,
      'file'
    );

    if (moveResult !== 'ok') {
      return false;
    }
  }

  return true;
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
  private readonly pathToIdLookup = createMapPathToIdLookup(this.pathToIdMap);
  private readonly idToPathLookup: IdToPathLookup = {
    get: (id: string) => this.idToPathMap.get(id),
    has: (id: string) => this.idToPathMap.has(id),
  };
  private readonly syncIndex: FileListSyncIndex = {
    pathToId: this.pathToIdLookup,
    tree: this.tree,
  };

  private files: string[] = [];
  private readonly fileIndexByPath = new Map<string, number>();
  private readonly flattenedRefCountById = new Map<string, number>();
  private readonly flattenedIdsPendingPrune = new Set<string>();
  private readonly benchmarkInstrumentation: BenchmarkInstrumentation | null;
  private pathTree: MutablePathTree | null = null;
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
    for (const [id, node] of builtIndex.tree) {
      this.tree.set(id, node);
    }

    this.files = builtIndex.files;
    this.fileIndexByPath.clear();
    for (let index = 0; index < this.files.length; index += 1) {
      this.fileIndexByPath.set(this.files[index], index);
    }
    this.nextNodeId = builtIndex.nextNodeId;

    this.rebuildFlattenedReferenceCounts();

    if (options.syncPathTree !== false && this.pathTree != null) {
      this.pathTree.replaceAll(this.files);
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
      const id = this.pathToIdMap.get(path);
      return id != null && this.tree.get(id)?.children?.direct != null;
    };
    const compareByPath = (leftId: string, rightId: string) => {
      const leftPath = this.idToPathMap.get(leftId) ?? leftId;
      const rightPath = this.idToPathMap.get(rightId) ?? rightId;
      return comparator(leftPath, rightPath, isFolderPath);
    };

    parentNode.children.direct.sort(compareByPath);
    if (parentNode.children.flattened != null) {
      parentNode.children.flattened.sort(compareByPath);
    }
  }

  private resolveAncestorId(path: string): string {
    let candidatePath = path;
    while (true) {
      const candidateId = this.pathToIdMap.get(candidatePath);
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

  private getOrCreatePathTree(): MutablePathTree {
    this.pathTree ??= MutablePathTree.fromFiles(this.files);
    return this.pathTree;
  }

  private replaceFilesSnapshot(files: string[]): void {
    this.files = files;
    this.fileIndexByPath.clear();
    for (let index = 0; index < files.length; index += 1) {
      this.fileIndexByPath.set(files[index], index);
    }
    this.setModelCounter('model.snapshot.fileCount', files.length);
  }

  private addAncestorFoldersForPath(path: string, out: Set<string>): void {
    let currentPath = path.length === 0 ? ROOT_ID : path;
    while (true) {
      out.add(currentPath);
      if (currentPath === ROOT_ID) {
        return;
      }
      currentPath = getParentPath(currentPath);
    }
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
    const existingId = this.pathToIdMap.get(path);
    if (existingId != null) {
      return existingId;
    }

    const allocatedId = this.allocateStableIdForPath(path);
    this.pathToIdMap.set(path, allocatedId);
    this.idToPathMap.set(allocatedId, path);
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

      const nodePath = this.idToPathMap.get(id);
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
    const sourceId = this.pathToIdMap.get(sourcePath);
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
      const oldPath = this.idToPathMap.get(id);
      const remappedPath =
        oldPath == null
          ? null
          : remapPathWithPrefix(oldPath, sourcePath, destinationPath);

      if (
        oldPath != null &&
        remappedPath != null &&
        remappedPath !== oldPath &&
        !updatedIds.has(id)
      ) {
        updates.push({ id, oldPath, newPath: remappedPath });
        updatedIds.add(id);
      }

      if (
        oldPath != null &&
        remappedPath != null &&
        remappedPath !== oldPath &&
        node?.children?.direct != null &&
        !oldPath.startsWith(FLATTENED_PREFIX)
      ) {
        const flattenedAliasPath = `${FLATTENED_PREFIX}${oldPath}`;
        const flattenedAliasId = this.pathToIdMap.get(flattenedAliasPath);
        if (flattenedAliasId != null && !updatedIds.has(flattenedAliasId)) {
          updates.push({
            id: flattenedAliasId,
            oldPath: flattenedAliasPath,
            newPath: `${FLATTENED_PREFIX}${remappedPath}`,
          });
          updatedIds.add(flattenedAliasId);
          scannedNodeCount += 1;
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

      const id = this.pathToIdMap.get(rule.sourcePath);
      if (id == null || updatedIds.has(id)) {
        continue;
      }

      scannedNodeCount += 1;
      updatedIds.add(id);
      updates.push({
        id,
        oldPath: rule.sourcePath,
        newPath: rule.destinationPath,
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
        const missingFolderId = this.pathToIdMap.get(normalizedFolderPath);
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
        }
        rebuiltFolders.add(normalizedFolderPath);
        return;
      }

      rebuildingFolders.add(normalizedFolderPath);

      const folderId =
        normalizedFolderPath === ROOT_ID
          ? ROOT_ID
          : this.ensureStableIdForPath(normalizedFolderPath);
      const previousNode = this.tree.get(folderId);
      const previousDirectChildren =
        previousNode?.children?.direct?.slice() ?? [];
      const previousFlattenedChildren =
        previousNode?.children?.flattened?.slice() ?? [];

      const directChildren = pathTree.getDirectChildren(normalizedFolderPath);
      this.sortPathTreeChildren(directChildren, pathTree);

      const directChildIds = new Array<string>(directChildren.length);
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
          } else {
            existingNode.path = child.path;
            existingNode.name = getLeafName(child.path);
          }
        } else {
          this.tree.set(childId, {
            name: getLeafName(child.path),
            path: child.path,
          });
        }
      }

      if (previousDirectChildren.length > 0) {
        const nextDirectSet = new Set(directChildIds);
        for (let index = 0; index < previousDirectChildren.length; index += 1) {
          const previousChildId = previousDirectChildren[index];
          if (nextDirectSet.has(previousChildId)) {
            continue;
          }

          const previousChildPath = this.idToPathMap.get(previousChildId);
          if (previousChildPath == null) {
            continue;
          }

          if (pathTree.hasPath(previousChildPath)) {
            continue;
          }

          this.removeSubtreeById(previousChildId);
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

        const endpointId = this.pathToIdMap.get(endpointPath);
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
      for (let index = 0; index < directChildren.length; index += 1) {
        const child = directChildren[index];

        if (child.kind === 'folder') {
          const endpointPath = resolveEndpoint(child.path);
          if (endpointPath != null) {
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

      rebuildingFolders.delete(normalizedFolderPath);
      rebuiltFolders.add(normalizedFolderPath);
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

  getFiles(): string[] {
    return this.files;
  }

  getSyncIndex(): FileListSyncIndex {
    return this.syncIndex;
  }

  getPathForId(id: string): string | undefined {
    return this.idToPathMap.get(id);
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
    this.replaceAll(this.files);
  }

  replaceAll(files: string[]): void {
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

    const currentFiles = this.files;
    if (draggedPaths.length === 0 || currentFiles.length === 0) {
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

    const moveRules: PlannedMoveRule[] = [];
    const folderDestinations = new Map<string, string>();
    const proposedDestinationByOrigin = new Map<string, string>();

    for (const selectedFile of selectedFiles) {
      const destinationPath = `${targetPrefix}${getLeafName(selectedFile)}`;
      if (destinationPath === selectedFile) {
        continue;
      }

      proposedDestinationByOrigin.set(selectedFile, destinationPath);
      moveRules.push({
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

      folderDestinations.set(selectedFolder, destinationPath);
      moveRules.push({
        sourcePath: selectedFolder,
        destinationPath,
        isFolder: true,
      });
    }

    for (const [
      selectedFolder,
      selectedFolderDestination,
    ] of folderDestinations) {
      const descendantFiles = pathTree.getDescendantFilePaths(selectedFolder);
      for (let index = 0; index < descendantFiles.length; index += 1) {
        const originPath = descendantFiles[index];
        const destinationPath = `${selectedFolderDestination}${originPath.slice(selectedFolder.length)}`;
        if (destinationPath === originPath) {
          continue;
        }
        proposedDestinationByOrigin.set(originPath, destinationPath);
      }
    }

    const finalPathByOrigin = new Map<string, string | null>();
    const occupantByDestination = new Map<string, string>();
    for (let index = 0; index < currentFiles.length; index += 1) {
      const filePath = currentFiles[index];
      finalPathByOrigin.set(filePath, filePath);
      occupantByDestination.set(filePath, filePath);
    }

    for (let index = 0; index < currentFiles.length; index += 1) {
      const originPath = currentFiles[index];
      const destinationPath = proposedDestinationByOrigin.get(originPath);
      if (destinationPath == null) {
        continue;
      }

      const currentPath = finalPathByOrigin.get(originPath);
      if (currentPath == null || currentPath === destinationPath) {
        continue;
      }

      const existingOccupant = occupantByDestination.get(destinationPath);
      if (existingOccupant != null && existingOccupant !== originPath) {
        const allowOverwrite =
          onCollision?.({
            origin: originPath,
            destination: destinationPath,
          }) === true;
        if (!allowOverwrite) {
          continue;
        }

        const existingPath = finalPathByOrigin.get(existingOccupant);
        if (existingPath != null) {
          occupantByDestination.delete(existingPath);
        }
        finalPathByOrigin.set(existingOccupant, null);
      }

      occupantByDestination.delete(currentPath);
      occupantByDestination.set(destinationPath, originPath);
      finalPathByOrigin.set(originPath, destinationPath);
    }

    const nextFiles: string[] = [];
    const removedFilePaths: string[] = [];
    for (let index = 0; index < currentFiles.length; index += 1) {
      const filePath = currentFiles[index];
      const nextPath = finalPathByOrigin.get(filePath);
      if (nextPath != null) {
        nextFiles.push(nextPath);
        continue;
      }
      removedFilePaths.push(filePath);
    }

    if (
      nextFiles.length === currentFiles.length &&
      nextFiles.every((path, index) => path === currentFiles[index])
    ) {
      return { ok: true, mutation: null };
    }

    const movedFolderRuleBySource = new Map<string, PlannedMoveRule>();
    for (let index = 0; index < moveRules.length; index += 1) {
      const rule = moveRules[index];
      if (rule.isFolder) {
        movedFolderRuleBySource.set(rule.sourcePath, rule);
      }
    }

    const activeFolderSources = new Set<string>();
    for (const [sourcePath, rule] of movedFolderRuleBySource) {
      const descendants = pathTree.getDescendantFilePaths(sourcePath);
      for (let index = 0; index < descendants.length; index += 1) {
        const nextPath = finalPathByOrigin.get(descendants[index]);
        if (
          nextPath != null &&
          nextPath.startsWith(`${rule.destinationPath}/`)
        ) {
          activeFolderSources.add(sourcePath);
          break;
        }
      }
    }

    const remapRules = moveRules
      .filter((rule) => {
        if (!rule.isFolder) {
          return (
            finalPathByOrigin.get(rule.sourcePath) === rule.destinationPath
          );
        }
        return activeFolderSources.has(rule.sourcePath);
      })
      .sort((left, right) => right.sourcePath.length - left.sourcePath.length);

    const pathTreeApplied = applyMappedFilesToPathTree(
      pathTree,
      currentFiles,
      finalPathByOrigin
    );
    if (!pathTreeApplied) {
      pathTree.replaceAll(nextFiles);
    }

    this.applyPathRemapRules(remapRules);
    this.replaceFilesSnapshot(nextFiles);

    const affectedFolderPaths = new Set<string>();
    for (let index = 0; index < remapRules.length; index += 1) {
      const rule = remapRules[index];
      this.addAncestorFoldersForPath(
        getParentPath(rule.sourcePath),
        affectedFolderPaths
      );
      this.addAncestorFoldersForPath(
        getParentPath(rule.destinationPath),
        affectedFolderPaths
      );
    }
    for (let index = 0; index < removedFilePaths.length; index += 1) {
      this.addAncestorFoldersForPath(
        getParentPath(removedFilePaths[index]),
        affectedFolderPaths
      );
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

    this.replaceFilesSnapshot(pathTree.cloneFiles());

    const affectedFolderPaths = new Set<string>();
    for (let index = 0; index < addedPaths.length; index += 1) {
      this.addAncestorFoldersForPath(
        getParentPath(addedPaths[index]),
        affectedFolderPaths
      );
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

    const deletedPaths: string[] = [];

    for (let index = 0; index < selectedFiles.length; index += 1) {
      const path = selectedFiles[index];
      if (pathTree.deleteFilePath(path)) {
        deletedPaths.push(path);
      }
    }

    for (const path of selectedFolders) {
      if (pathTree.deleteFolderPath(path)) {
        deletedPaths.push(path);
      }
    }

    if (deletedPaths.length === 0) {
      return { ok: true, mutation: null };
    }

    this.replaceFilesSnapshot(pathTree.cloneFiles());

    const affectedFolderPaths = new Set<string>();
    for (let index = 0; index < deletedPaths.length; index += 1) {
      this.addAncestorFoldersForPath(
        getParentPath(deletedPaths[index]),
        affectedFolderPaths
      );
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

    const nodeId = this.pathToIdMap.get(normalizedSourcePath);
    if (nodeId == null) {
      return {
        ok: false,
        error: 'Could not find the selected path to rename.',
      };
    }

    if (this.pathToIdMap.has(normalizedDestinationPath)) {
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
    const parentId = this.pathToIdMap.get(parentPath) ?? ROOT_ID;
    const pathTree = this.pathTree;

    if (!nodeIsFolder) {
      if (pathTree != null) {
        const renameResult = pathTree.renamePath(
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
      }

      this.pathToIdMap.delete(normalizedSourcePath);
      this.pathToIdMap.set(normalizedDestinationPath, nodeId);
      this.idToPathMap.set(nodeId, normalizedDestinationPath);

      node.path = normalizedDestinationPath;
      node.name = getLeafName(normalizedDestinationPath);

      const sourceIndex = this.fileIndexByPath.get(normalizedSourcePath);
      if (sourceIndex != null) {
        this.files[sourceIndex] = normalizedDestinationPath;
        this.fileIndexByPath.delete(normalizedSourcePath);
        this.fileIndexByPath.set(normalizedDestinationPath, sourceIndex);
      }

      this.sortChildren(parentId);
      this.setModelCounter('model.rename.file.remapScannedNodes', 1);
      this.setModelCounter('model.rename.file.remapUpdatedNodes', 1);

      const mutation = {
        kind: 'rename-path' as const,
        sourcePath: normalizedSourcePath,
        destinationPath: normalizedDestinationPath,
        isFolder: false,
        parentId,
        nodeId,
      };
      this.emitMutation(mutation);
      return {
        ok: true,
        mutation: { ...mutation, version: this.version },
      };
    }

    const {
      updates: pathUpdates,
      scannedNodeCount: folderRenameScannedNodeCount,
    } = this.collectSubtreePathUpdates(
      normalizedSourcePath,
      normalizedDestinationPath
    );
    this.setModelCounter(
      'model.rename.folder.remapScannedNodes',
      folderRenameScannedNodeCount
    );
    this.setModelCounter(
      'model.rename.folder.remapUpdatedNodes',
      pathUpdates.length
    );

    if (pathUpdates.length === 0) {
      return {
        ok: false,
        error: 'Could not find the selected folder to rename.',
      };
    }

    const updatedPathSet = new Set(pathUpdates.map((entry) => entry.oldPath));
    for (const { id, newPath } of pathUpdates) {
      const existingId = this.pathToIdMap.get(newPath);
      if (
        existingId != null &&
        existingId !== id &&
        !updatedPathSet.has(newPath)
      ) {
        return {
          ok: false,
          error: `"${normalizedDestinationPath}" already exists.`,
        };
      }
    }

    if (pathTree != null) {
      const folderRenameResult = pathTree.renamePath(
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
    }

    for (const { oldPath } of pathUpdates) {
      this.pathToIdMap.delete(oldPath);
    }
    for (const { id, newPath } of pathUpdates) {
      this.pathToIdMap.set(newPath, id);
      this.idToPathMap.set(id, newPath);
      const item = this.tree.get(id);
      if (item != null) {
        item.path = newPath;
        if (id === nodeId) {
          item.name = getLeafName(newPath);
        }
      }
    }

    const sourcePrefix = `${normalizedSourcePath}/`;
    const remappedFiles = new Array<string>(this.files.length);
    for (let index = 0; index < this.files.length; index += 1) {
      const filePath = this.files[index];
      remappedFiles[index] =
        filePath === normalizedSourcePath || filePath.startsWith(sourcePrefix)
          ? `${normalizedDestinationPath}${filePath.slice(normalizedSourcePath.length)}`
          : filePath;
    }
    this.files = remappedFiles;
    this.fileIndexByPath.clear();
    for (let index = 0; index < remappedFiles.length; index += 1) {
      this.fileIndexByPath.set(remappedFiles[index], index);
    }

    this.sortChildren(parentId);

    const mutation = {
      kind: 'rename-path' as const,
      sourcePath: normalizedSourcePath,
      destinationPath: normalizedDestinationPath,
      isFolder: true,
      parentId,
      nodeId,
    };
    this.emitMutation(mutation);
    return {
      ok: true,
      mutation: { ...mutation, version: this.version },
    };
  }
}
