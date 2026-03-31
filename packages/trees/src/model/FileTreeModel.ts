import { FLATTENED_PREFIX } from '../constants';
import {
  attachBenchmarkInstrumentation,
  type BenchmarkInstrumentation,
} from '../internal/benchmarkInstrumentation';
import type { FileTreeNode } from '../types';
import {
  buildFileListSyncIndex,
  type FileListSyncIndex,
} from '../utils/fileListToTree';
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

function buildFolderSet(files: string[]): Set<string> {
  const folders = new Set<string>();
  for (const file of files) {
    let slash = file.lastIndexOf('/');
    while (slash !== -1) {
      folders.add(file.slice(0, slash));
      slash = file.lastIndexOf('/', slash - 1);
    }
  }
  return folders;
}

function getSelectedFolderForFile(
  file: string,
  selectedFolders: Set<string>
): string | undefined {
  let slash = file.lastIndexOf('/');
  while (slash !== -1) {
    const folder = file.slice(0, slash);
    if (selectedFolders.has(folder)) {
      return folder;
    }
    slash = folder.lastIndexOf('/');
  }
  return undefined;
}

interface PlannedMoveRule {
  sourcePath: string;
  destinationPath: string;
  isFolder: boolean;
}

function remapPathWithRules(
  path: string,
  rules: readonly PlannedMoveRule[]
): string | null {
  for (let index = 0; index < rules.length; index += 1) {
    const rule = rules[index];
    if (!rule.isFolder) {
      if (path === rule.sourcePath) {
        return rule.destinationPath;
      }
      if (path === `${FLATTENED_PREFIX}${rule.sourcePath}`) {
        return `${FLATTENED_PREFIX}${rule.destinationPath}`;
      }
      continue;
    }

    const remapped = remapPathWithPrefix(
      path,
      rule.sourcePath,
      rule.destinationPath
    );
    if (remapped != null) {
      return remapped;
    }
  }

  return null;
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
    const builtIndex = buildStableIndexFromFiles(
      files,
      this.sortComparator,
      options.benchmarkInstrumentation,
      null,
      this.nextNodeId
    );
    this.applyBuiltIndex(builtIndex);
  }

  private applyBuiltIndex(builtIndex: BuiltStableIndex): void {
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

    const currentFileSet = new Set(currentFiles);
    const folderSet = buildFolderSet(currentFiles);

    const normalizedDragged = [...new Set(draggedPaths.map(normalizeTreePath))]
      .map((path) => path.trim())
      .filter((path) => path.length > 0);
    if (normalizedDragged.length === 0) {
      return { ok: true, mutation: null };
    }

    const orderedDragged = normalizedDragged
      .map((path) => ({
        path,
        kind: folderSet.has(path) ? 'folder' : 'file',
        depth: path.split('/').length,
      }))
      .sort((left, right) => left.depth - right.depth);

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
      if (currentFileSet.has(item.path)) {
        selectedFiles.add(item.path);
      }
    }

    const moveRules: PlannedMoveRule[] = [];
    const folderDestinations = new Map<string, string>();
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

    const proposedDestinationByOrigin = new Map<string, string>();
    for (let index = 0; index < currentFiles.length; index += 1) {
      const filePath = currentFiles[index];

      if (selectedFiles.has(filePath)) {
        const destinationPath = `${targetPrefix}${getLeafName(filePath)}`;
        if (destinationPath !== filePath) {
          proposedDestinationByOrigin.set(filePath, destinationPath);
          moveRules.push({
            sourcePath: filePath,
            destinationPath,
            isFolder: false,
          });
        }
        continue;
      }

      const selectedFolder = getSelectedFolderForFile(
        filePath,
        selectedFolders
      );
      if (selectedFolder == null) {
        continue;
      }

      if (
        normalizedTarget === selectedFolder ||
        isPathDescendant(normalizedTarget, selectedFolder)
      ) {
        continue;
      }

      const selectedFolderDestination = folderDestinations.get(selectedFolder);
      if (selectedFolderDestination == null) {
        continue;
      }

      const destinationPath = `${selectedFolderDestination}${filePath.slice(selectedFolder.length)}`;
      if (destinationPath !== filePath) {
        proposedDestinationByOrigin.set(filePath, destinationPath);
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
    for (let index = 0; index < currentFiles.length; index += 1) {
      const filePath = currentFiles[index];
      const nextPath = finalPathByOrigin.get(filePath);
      if (nextPath != null) {
        nextFiles.push(nextPath);
      }
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
      if (rule?.isFolder) {
        movedFolderRuleBySource.set(rule.sourcePath, rule);
      }
    }

    const activeFolderSources = new Set<string>();
    if (movedFolderRuleBySource.size > 0) {
      for (const [originPath, nextPath] of finalPathByOrigin) {
        if (nextPath == null) {
          continue;
        }

        const selectedFolder = getSelectedFolderForFile(
          originPath,
          selectedFolders
        );
        if (selectedFolder == null) {
          continue;
        }

        const folderRule = movedFolderRuleBySource.get(selectedFolder);
        if (folderRule == null) {
          continue;
        }

        if (
          nextPath === folderRule.destinationPath ||
          nextPath.startsWith(`${folderRule.destinationPath}/`)
        ) {
          activeFolderSources.add(selectedFolder);
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

    const remappedPathToId = new Map<string, string>();
    for (const [path, id] of this.pathToIdMap) {
      const remappedPath = remapPathWithRules(path, remapRules) ?? path;
      remappedPathToId.set(remappedPath, id);
    }

    const builtIndex = buildStableIndexFromFiles(
      nextFiles,
      this.sortComparator,
      null,
      remappedPathToId,
      this.nextNodeId
    );
    this.applyBuiltIndex(builtIndex);

    const affectedParentIdsSet = new Set<string>();
    const resolveAncestorId = (path: string): string => {
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
    };

    for (let index = 0; index < remapRules.length; index += 1) {
      const rule = remapRules[index];
      affectedParentIdsSet.add(
        resolveAncestorId(getParentPath(rule.sourcePath))
      );
      affectedParentIdsSet.add(
        resolveAncestorId(getParentPath(rule.destinationPath))
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

    if (!nodeIsFolder) {
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

    const pathUpdates: Array<{ id: string; oldPath: string; newPath: string }> =
      [];
    for (const [path, id] of this.pathToIdMap) {
      const remappedPath = remapPathWithPrefix(
        path,
        normalizedSourcePath,
        normalizedDestinationPath
      );
      if (remappedPath == null) {
        continue;
      }
      pathUpdates.push({ id, oldPath: path, newPath: remappedPath });
    }

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
