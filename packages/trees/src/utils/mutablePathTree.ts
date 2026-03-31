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
 * Mutable parent-pointer index over file paths.
 *
 * This gives move/rename code an explicit tree with parent/children links so
 * localized updates can touch only affected subtrees instead of repeatedly
 * rescanning the full file list.
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

  /**
   * Replaces the indexed file list while preserving this instance identity.
   * FileTree keeps this object persistent across mutations so callers can reuse
   * the same parent-pointer index between drag/rename operations.
   */
  replaceAll(files: string[]): void {
    this.root.children.clear();
    this.pathToNode.clear();
    this.fileIndexByPath.clear();
    this.files = [];

    for (let index = 0; index < files.length; index += 1) {
      this.addFilePath(files[index]);
    }
  }

  getFiles(): string[] {
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

  getFile(path: string): MutablePathTreeFileNode | undefined {
    const node = this.pathToNode.get(path);
    return node?.kind === 'file' ? node : undefined;
  }

  getFolder(path: string): MutablePathTreeFolderNode | undefined {
    const node = this.pathToNode.get(path);
    return node?.kind === 'folder' ? node : undefined;
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
    if (parent == null) {
      return false;
    }

    if (parent.children.has(baseName)) {
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
    const node = this.getFile(path);
    if (node == null) {
      return false;
    }

    this.removeFileNode(node);
    return true;
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

    descendants.sort((a, b) => b.index - a.index);
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
    descendants.sort((a, b) => a.index - b.index);
    return descendants.map((node) => node.path);
  }

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
   * Moves or renames a node by changing parent/name, then rewrites paths for
   * that node and its subtree in one traversal.
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
      this.reindexFiles(node.index);
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
