type MutablePathTreeNode = MutablePathTreeFolderNode | MutablePathTreeFileNode;

type MutablePathTreeMoveResult = 'ok' | 'missing' | 'collision' | 'invalid';

interface MutablePathTreeBaseNode {
  kind: 'folder' | 'file';
  name: string;
  path: string;
  parent: MutablePathTreeFolderNode | null;
}

interface MutablePathTreeFolderNode extends MutablePathTreeBaseNode {
  kind: 'folder';
  children: Map<string, MutablePathTreeNode>;
}

interface MutablePathTreeFileNode extends MutablePathTreeBaseNode {
  kind: 'file';
  index: number;
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

function joinPath(parentPath: string, baseName: string): string {
  return parentPath === '' ? baseName : `${parentPath}/${baseName}`;
}

/**
 * Mutable parent-pointer tree for file paths.
 *
 * Move/rename/delete logic can mutate this structure directly instead of
 * repeatedly rescanning and slicing full path arrays.
 */
export class MutablePathTree {
  static fromFiles(files: string[]): MutablePathTree {
    const tree = new MutablePathTree();
    tree.replaceAll(files);
    return tree;
  }

  private readonly root: MutablePathTreeFolderNode = {
    kind: 'folder',
    name: 'root',
    path: '',
    parent: null,
    children: new Map(),
  };

  private readonly pathToNode = new Map<string, MutablePathTreeNode>();
  private readonly fileIndexByPath = new Map<string, number>();
  private files: string[] = [];
  private firstDirtyFileIndex: number | null = null;

  replaceAll(files: string[]): void {
    this.root.children.clear();
    this.pathToNode.clear();
    this.fileIndexByPath.clear();
    this.files.length = 0;
    this.firstDirtyFileIndex = null;

    for (let index = 0; index < files.length; index += 1) {
      this.addFilePath(files[index]);
    }
  }

  getFilesReference(): string[] {
    return this.files;
  }

  cloneFiles(): string[] {
    return this.files.slice();
  }

  hasPath(path: string): boolean {
    return this.pathToNode.has(path);
  }

  hasFile(path: string): boolean {
    return this.getFile(path) != null;
  }

  hasFolder(path: string): boolean {
    return this.getFolder(path) != null;
  }

  getFileIndex(path: string): number | undefined {
    this.ensureFileIndexesUpToDate();
    return this.fileIndexByPath.get(path);
  }

  addFilePath(path: string): boolean {
    if (path.length === 0 || this.fileIndexByPath.has(path)) {
      return false;
    }

    const { parentPath, baseName } = splitPath(path);
    if (baseName.length === 0) {
      return false;
    }

    const parent = this.ensureFolder(parentPath);
    if (parent == null || parent.children.has(baseName)) {
      return false;
    }

    const index = this.files.length;
    const node: MutablePathTreeFileNode = {
      kind: 'file',
      name: baseName,
      path,
      parent,
      index,
    };

    parent.children.set(baseName, node);
    this.pathToNode.set(path, node);
    this.files.push(path);
    this.fileIndexByPath.set(path, index);
    return true;
  }

  deleteFilePath(path: string): boolean {
    this.ensureFileIndexesUpToDate();

    const node = this.getFile(path);
    if (node == null) {
      return false;
    }

    this.removeFileNode(node, false);
    return true;
  }

  deleteFilePaths(paths: readonly string[]): string[] {
    if (paths.length === 0) {
      return [];
    }

    this.ensureFileIndexesUpToDate();

    const nodesToDelete: MutablePathTreeFileNode[] = [];
    const seenPaths = new Set<string>();
    for (let index = 0; index < paths.length; index += 1) {
      const path = paths[index];
      if (seenPaths.has(path)) {
        continue;
      }
      seenPaths.add(path);

      const node = this.getFile(path);
      if (node != null) {
        nodesToDelete.push(node);
      }
    }

    if (nodesToDelete.length === 0) {
      return [];
    }

    nodesToDelete.sort((left, right) => right.index - left.index);

    const deletedPathSet = new Set(nodesToDelete.map((node) => node.path));
    for (let index = 0; index < nodesToDelete.length; index += 1) {
      this.removeFileNode(nodesToDelete[index], false);
    }

    this.ensureFileIndexesUpToDate();

    const deletedPaths: string[] = [];
    const emitted = new Set<string>();
    for (let index = 0; index < paths.length; index += 1) {
      const path = paths[index];
      if (!deletedPathSet.has(path) || emitted.has(path)) {
        continue;
      }
      emitted.add(path);
      deletedPaths.push(path);
    }

    return deletedPaths;
  }

  deleteFolderPath(path: string): boolean {
    const folder = this.getFolder(path);
    if (folder == null) {
      return false;
    }

    this.ensureFileIndexesUpToDate();

    const descendants = this.getDescendantFileNodes(folder);
    if (descendants.length === 0) {
      return false;
    }

    descendants.sort((left, right) => right.index - left.index);
    for (let index = 0; index < descendants.length; index += 1) {
      this.removeFileNode(descendants[index], false);
    }

    this.reindexFiles();
    return true;
  }

  renamePath(
    sourcePath: string,
    destinationPath: string,
    kind: 'file' | 'folder'
  ): MutablePathTreeMoveResult {
    this.ensureFileIndexesUpToDate();

    const node =
      kind === 'file' ? this.getFile(sourcePath) : this.getFolder(sourcePath);

    if (node == null) {
      return 'missing';
    }

    if (sourcePath === destinationPath) {
      return 'ok';
    }

    if (this.pathToNode.has(destinationPath)) {
      return 'collision';
    }

    const { parentPath, baseName } = splitPath(destinationPath);
    const expectedParent = node.parent;
    if (expectedParent == null || expectedParent.path !== parentPath) {
      return 'invalid';
    }

    return this.moveNode(node, expectedParent, baseName);
  }

  movePath(
    sourcePath: string,
    targetFolderPath: string,
    nextBaseName: string,
    kind: 'file' | 'folder'
  ): MutablePathTreeMoveResult {
    this.ensureFileIndexesUpToDate();

    const node =
      kind === 'file' ? this.getFile(sourcePath) : this.getFolder(sourcePath);

    if (node == null) {
      return 'missing';
    }

    if (nextBaseName.length === 0) {
      return 'invalid';
    }

    const normalizedTarget =
      targetFolderPath === 'root' ? '' : targetFolderPath;
    const targetFolder =
      normalizedTarget === ''
        ? this.root
        : (this.getFolder(normalizedTarget) ??
          this.ensureFolder(normalizedTarget));

    if (targetFolder == null) {
      return 'missing';
    }

    return this.moveNode(node, targetFolder, nextBaseName);
  }

  getDescendantFilePaths(folderPath: string): string[] {
    const folder = this.getFolder(folderPath);
    if (folder == null) {
      return [];
    }

    this.ensureFileIndexesUpToDate();

    const descendants = this.getDescendantFileNodes(folder);
    descendants.sort((left, right) => left.index - right.index);
    return descendants.map((node) => node.path);
  }

  getDirectChildCount(folderPath: string): number {
    const normalizedPath = folderPath === 'root' ? '' : folderPath;
    const folder =
      normalizedPath === '' ? this.root : this.getFolder(normalizedPath);
    return folder?.children.size ?? 0;
  }

  /**
   * Returns direct children for a folder path (or root), preserving insertion
   * order so callers can optionally apply custom sorting on top.
   */
  getDirectChildren(
    folderPath: string
  ): Array<{ path: string; kind: 'folder' | 'file' }> {
    const normalizedPath = folderPath === 'root' ? '' : folderPath;
    const folder =
      normalizedPath === '' ? this.root : this.getFolder(normalizedPath);
    if (folder == null) {
      return [];
    }

    const children: Array<{ path: string; kind: 'folder' | 'file' }> = [];
    for (const child of folder.children.values()) {
      children.push({ path: child.path, kind: child.kind });
    }
    return children;
  }

  private getFile(path: string): MutablePathTreeFileNode | undefined {
    const node = this.pathToNode.get(path);
    return node?.kind === 'file' ? node : undefined;
  }

  private getFolder(path: string): MutablePathTreeFolderNode | undefined {
    const node = this.pathToNode.get(path);
    return node?.kind === 'folder' ? node : undefined;
  }

  /**
   * Ensures every segment in a folder path exists as a folder node.
   */
  private ensureFolder(path: string): MutablePathTreeFolderNode | null {
    if (path.length === 0) {
      return this.root;
    }

    const segments = path.split('/');
    let current = this.root;
    let currentPath = '';

    for (let index = 0; index < segments.length; index += 1) {
      const segment = segments[index];
      if (segment.length === 0) {
        return null;
      }

      currentPath = currentPath === '' ? segment : `${currentPath}/${segment}`;
      const existing = current.children.get(segment);

      if (existing == null) {
        const folder: MutablePathTreeFolderNode = {
          kind: 'folder',
          name: segment,
          path: currentPath,
          parent: current,
          children: new Map(),
        };
        current.children.set(segment, folder);
        this.pathToNode.set(currentPath, folder);
        current = folder;
        continue;
      }

      if (existing.kind !== 'folder') {
        return null;
      }

      current = existing;
    }

    return current;
  }

  private markFileIndexesDirty(startIndex: number): void {
    if (
      this.firstDirtyFileIndex == null ||
      startIndex < this.firstDirtyFileIndex
    ) {
      this.firstDirtyFileIndex = startIndex;
    }
  }

  private ensureFileIndexesUpToDate(): void {
    const dirtyStart = this.firstDirtyFileIndex;
    if (dirtyStart == null) {
      return;
    }

    this.reindexFiles(dirtyStart);
    this.firstDirtyFileIndex = null;
  }

  /**
   * Moves/renames a node by rewiring parent links and rewriting subtree paths.
   */
  private moveNode(
    node: MutablePathTreeNode,
    targetFolder: MutablePathTreeFolderNode,
    nextBaseName: string
  ): MutablePathTreeMoveResult {
    if (node.parent == null) {
      return 'invalid';
    }

    if (node.kind === 'folder' && this.isFolderDescendant(targetFolder, node)) {
      return 'invalid';
    }

    const currentParent = node.parent;
    const currentName = node.name;
    if (currentParent === targetFolder && currentName === nextBaseName) {
      return 'ok';
    }

    const existing = targetFolder.children.get(nextBaseName);
    if (existing != null && existing !== node) {
      return 'collision';
    }

    currentParent.children.delete(currentName);
    node.parent = targetFolder;
    node.name = nextBaseName;
    targetFolder.children.set(nextBaseName, node);

    this.rewriteSubtreePaths(node);
    this.pruneEmptyFolders(currentParent);
    return 'ok';
  }

  private isFolderDescendant(
    candidate: MutablePathTreeFolderNode,
    ancestor: MutablePathTreeFolderNode
  ): boolean {
    let current: MutablePathTreeFolderNode | null = candidate;
    while (current != null) {
      if (current === ancestor) {
        return true;
      }
      current = current.parent;
    }
    return false;
  }

  private rewriteSubtreePaths(rootNode: MutablePathTreeNode): void {
    const stack: MutablePathTreeNode[] = [rootNode];

    while (stack.length > 0) {
      const node = stack.pop()!;
      const oldPath = node.path;
      const parentPath = node.parent?.path ?? '';
      const nextPath = joinPath(parentPath, node.name);

      if (oldPath !== nextPath) {
        this.pathToNode.delete(oldPath);
        node.path = nextPath;
        this.pathToNode.set(nextPath, node);

        if (node.kind === 'file') {
          this.files[node.index] = nextPath;
          this.fileIndexByPath.delete(oldPath);
          this.fileIndexByPath.set(nextPath, node.index);
        }
      }

      if (node.kind === 'folder') {
        for (const child of node.children.values()) {
          stack.push(child);
        }
      }
    }
  }

  private getDescendantFileNodes(
    folder: MutablePathTreeFolderNode
  ): MutablePathTreeFileNode[] {
    const files: MutablePathTreeFileNode[] = [];
    const stack: MutablePathTreeFolderNode[] = [folder];

    while (stack.length > 0) {
      const current = stack.pop()!;
      for (const child of current.children.values()) {
        if (child.kind === 'file') {
          files.push(child);
          continue;
        }
        stack.push(child);
      }
    }

    return files;
  }

  private removeFileNode(
    node: MutablePathTreeFileNode,
    reindexImmediately = true
  ): void {
    node.parent?.children.delete(node.name);
    this.pathToNode.delete(node.path);
    this.fileIndexByPath.delete(node.path);
    this.files.splice(node.index, 1);

    if (reindexImmediately) {
      const reindexStart = Math.min(
        node.index,
        this.firstDirtyFileIndex ?? node.index
      );
      this.reindexFiles(reindexStart);
      this.firstDirtyFileIndex = null;
    } else {
      this.markFileIndexesDirty(node.index);
    }

    this.pruneEmptyFolders(node.parent);
  }

  private reindexFiles(startIndex = 0): void {
    for (let index = startIndex; index < this.files.length; index += 1) {
      const path = this.files[index];
      this.fileIndexByPath.set(path, index);
      const node = this.pathToNode.get(path);
      if (node?.kind === 'file') {
        node.index = index;
      }
    }
  }

  private pruneEmptyFolders(folder: MutablePathTreeFolderNode | null): void {
    let current = folder;
    while (
      current != null &&
      current !== this.root &&
      current.children.size === 0
    ) {
      const parent = current.parent;
      if (parent == null) {
        return;
      }
      parent.children.delete(current.name);
      this.pathToNode.delete(current.path);
      current = parent;
    }
  }
}
