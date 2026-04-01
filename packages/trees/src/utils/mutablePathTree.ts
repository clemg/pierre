type MutablePathTreeNode = MutablePathTreeFolderNode | MutablePathTreeFileNode;

type MutablePathTreeMoveResult = 'ok' | 'missing' | 'collision' | 'invalid';

interface MutablePathTreeBaseNode {
  kind: 'folder' | 'file';
  name: string;
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

/**
 * Mutable parent-pointer tree for file paths.
 *
 * Paths are derived lazily from parent/name pointers instead of being eagerly
 * rewritten through the full descendant subtree on every folder move/rename.
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
    parent: null,
    children: new Map(),
  };

  private headFile: MutablePathTreeFileNode | null = null;
  private tailFile: MutablePathTreeFileNode | null = null;
  private fileCount = 0;
  private nextFileOrder = 0;
  private readonly filesSnapshot: string[] = [];
  private filesSnapshotDirty = true;

  replaceAll(files: string[]): void {
    this.root.children.clear();
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
    return this.getNodeByPath(path) != null;
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
      parent,
      order: this.nextFileOrder,
      previous: this.tailFile,
      next: null,
    };
    this.nextFileOrder += 1;

    parent.children.set(baseName, node);

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

    const seenPaths = new Set<string>();
    const filesToDelete: Array<{
      path: string;
      node: MutablePathTreeFileNode;
    }> = [];

    for (let index = 0; index < paths.length; index += 1) {
      const path = paths[index];
      if (seenPaths.has(path)) {
        continue;
      }
      seenPaths.add(path);

      const node = this.getFile(path);
      if (node != null) {
        filesToDelete.push({ path, node });
      }
    }

    if (filesToDelete.length === 0) {
      return [];
    }

    for (let index = 0; index < filesToDelete.length; index += 1) {
      this.removeFileNode(filesToDelete[index].node);
    }

    return filesToDelete.map((entry) => entry.path);
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

    if (this.getNodeByPath(destinationPath) != null) {
      return 'collision';
    }

    const { parentPath, baseName } = splitPath(destinationPath);
    const expectedParent = node.parent;
    if (
      expectedParent == null ||
      this.getNodePath(expectedParent) !== parentPath
    ) {
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

    const folderPathCache = new Map<MutablePathTreeFolderNode, string>([
      [this.root, ''],
    ]);
    const paths = new Array<string>(descendants.length);
    for (let index = 0; index < descendants.length; index += 1) {
      paths[index] = this.getFilePathCached(
        descendants[index],
        folderPathCache
      );
    }
    return paths;
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
      children.push({ path: this.getNodePath(child), kind: child.kind });
    }
    return children;
  }

  private getNodeByPath(path: string): MutablePathTreeNode | undefined {
    if (path.length === 0) {
      return this.root;
    }

    const segments = path.split('/');
    let current: MutablePathTreeFolderNode = this.root;

    for (let index = 0; index < segments.length; index += 1) {
      const segment = segments[index];
      if (segment.length === 0) {
        return undefined;
      }

      const child = current.children.get(segment);
      if (child == null) {
        return undefined;
      }

      if (index === segments.length - 1) {
        return child;
      }

      if (child.kind !== 'folder') {
        return undefined;
      }

      current = child;
    }

    return undefined;
  }

  private getFile(path: string): MutablePathTreeFileNode | undefined {
    const node = this.getNodeByPath(path);
    return node?.kind === 'file' ? node : undefined;
  }

  private getFolder(path: string): MutablePathTreeFolderNode | undefined {
    if (path.length === 0) {
      return this.root;
    }

    const node = this.getNodeByPath(path);
    return node?.kind === 'folder' ? node : undefined;
  }

  private getNodePath(
    node: MutablePathTreeNode | MutablePathTreeFolderNode
  ): string {
    if (node.parent == null) {
      return '';
    }

    const segments: string[] = [];
    let current: MutablePathTreeNode | MutablePathTreeFolderNode | null = node;

    while (current != null && current.parent != null) {
      segments.push(current.name);
      current = current.parent;
    }

    segments.reverse();
    return segments.join('/');
  }

  private getFolderPathCached(
    folder: MutablePathTreeFolderNode,
    folderPathCache: Map<MutablePathTreeFolderNode, string>
  ): string {
    const cachedPath = folderPathCache.get(folder);
    if (cachedPath != null) {
      return cachedPath;
    }

    const parent = folder.parent;
    if (parent == null) {
      folderPathCache.set(folder, '');
      return '';
    }

    const parentPath = this.getFolderPathCached(parent, folderPathCache);
    const path =
      parentPath === '' ? folder.name : `${parentPath}/${folder.name}`;
    folderPathCache.set(folder, path);
    return path;
  }

  private getFilePathCached(
    file: MutablePathTreeFileNode,
    folderPathCache: Map<MutablePathTreeFolderNode, string>
  ): string {
    const parentPath = this.getFolderPathCached(file.parent!, folderPathCache);
    return parentPath === '' ? file.name : `${parentPath}/${file.name}`;
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

    for (let index = 0; index < segments.length; index += 1) {
      const segment = segments[index];
      if (segment.length === 0) {
        return null;
      }

      const existing = current.children.get(segment);

      if (existing == null) {
        const folder: MutablePathTreeFolderNode = {
          kind: 'folder',
          name: segment,
          parent: current,
          children: new Map(),
        };
        current.children.set(segment, folder);
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
    const folderPathCache = new Map<MutablePathTreeFolderNode, string>([
      [this.root, ''],
    ]);

    let current = this.headFile;
    while (current != null) {
      this.filesSnapshot.push(this.getFilePathCached(current, folderPathCache));
      current = current.next;
    }
    this.filesSnapshotDirty = false;
  }

  /**
   * Moves/renames a node by rewiring parent links only.
   *
   * Descendant paths are derived lazily from parent pointers, so large folder
   * moves avoid eager subtree path rewrites.
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

    this.filesSnapshotDirty = true;
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
      current = parent;
    }
  }
}
