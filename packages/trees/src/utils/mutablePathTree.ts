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
  /**
   * Stable insertion order token used for relative ordering operations.
   * We never compact this, so deletes do not force index shifts.
   */
  order: number;
  previous: MutablePathTreeFileNode | null;
  next: MutablePathTreeFileNode | null;
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
  private headFile: MutablePathTreeFileNode | null = null;
  private tailFile: MutablePathTreeFileNode | null = null;
  private fileCount = 0;
  private nextFileOrder = 0;
  private readonly filesSnapshot: string[] = [];
  private filesSnapshotDirty = true;

  replaceAll(files: string[]): void {
    this.root.children.clear();
    this.pathToNode.clear();
    this.headFile = null;
    this.tailFile = null;
    this.fileCount = 0;
    this.nextFileOrder = 0;
    this.filesSnapshot.length = 0;
    this.filesSnapshotDirty = true;

    for (let index = 0; index < files.length; index += 1) {
      this.addFilePath(files[index]);
    }
  }

  getFilesReference(): string[] {
    this.ensureFilesSnapshot();
    return this.filesSnapshot;
  }

  cloneFiles(): string[] {
    return this.getFilesReference().slice();
  }

  getFileCount(): number {
    return this.fileCount;
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
    return this.getFile(path)?.order;
  }

  addFilePath(path: string): boolean {
    if (path.length === 0) {
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

    const node: MutablePathTreeFileNode = {
      kind: 'file',
      name: baseName,
      path,
      parent,
      order: this.nextFileOrder,
      previous: this.tailFile,
      next: null,
    };
    this.nextFileOrder += 1;

    parent.children.set(baseName, node);
    this.pathToNode.set(path, node);

    if (this.tailFile == null) {
      this.headFile = node;
    } else {
      this.tailFile.next = node;
    }
    this.tailFile = node;

    this.fileCount += 1;
    this.filesSnapshotDirty = true;
    return true;
  }

  deleteFilePath(path: string): boolean {
    const node = this.getFile(path);
    if (node == null) {
      return false;
    }

    this.removeFileNode(node);
    return true;
  }

  deleteFilePaths(paths: readonly string[]): string[] {
    if (paths.length === 0) {
      return [];
    }

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

    const deletedPathSet = new Set(nodesToDelete.map((node) => node.path));
    for (let index = 0; index < nodesToDelete.length; index += 1) {
      this.removeFileNode(nodesToDelete[index]);
    }

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

    const descendants = this.getDescendantFileNodes(folder);
    if (descendants.length === 0) {
      return false;
    }

    for (let index = 0; index < descendants.length; index += 1) {
      this.removeFileNode(descendants[index]);
    }

    return true;
  }

  renamePath(
    sourcePath: string,
    destinationPath: string,
    kind: 'file' | 'folder'
  ): MutablePathTreeMoveResult {
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

    const descendants = this.getDescendantFileNodes(folder);
    descendants.sort((left, right) => left.order - right.order);
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

  /**
   * Rebuilds the dense files[] snapshot lazily from the linked file order.
   */
  private ensureFilesSnapshot(): void {
    if (!this.filesSnapshotDirty) {
      return;
    }

    this.filesSnapshot.length = 0;
    let current = this.headFile;
    while (current != null) {
      this.filesSnapshot.push(current.path);
      current = current.next;
    }
    this.filesSnapshotDirty = false;
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
          this.filesSnapshotDirty = true;
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

  private removeFileNode(node: MutablePathTreeFileNode): void {
    node.parent?.children.delete(node.name);
    this.pathToNode.delete(node.path);

    const previous = node.previous;
    const next = node.next;
    if (previous != null) {
      previous.next = next;
    } else {
      this.headFile = next;
    }
    if (next != null) {
      next.previous = previous;
    } else {
      this.tailFile = previous;
    }

    node.previous = null;
    node.next = null;

    this.fileCount -= 1;
    this.filesSnapshotDirty = true;
    this.pruneEmptyFolders(node.parent);
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
