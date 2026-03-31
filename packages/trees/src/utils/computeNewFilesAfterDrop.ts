import { FLATTENED_PREFIX } from '../constants';
import { MutablePathTree } from './mutablePathTree';

export interface DropCollision {
  origin: string | null;
  destination: string;
}

export interface ComputeDropOptions {
  onCollision?: (collision: DropCollision) => boolean;
  /** Optional persistent path tree to reuse across drag operations. */
  pathTree?: MutablePathTree;
  /** Mutate the provided path tree in place when true. */
  mutatePathTree?: boolean;
}

const normalizePath = (path: string): string =>
  path.startsWith(FLATTENED_PREFIX)
    ? path.slice(FLATTENED_PREFIX.length)
    : path;

const getBasename = (path: string): string => {
  const lastSlash = path.lastIndexOf('/');
  return lastSlash === -1 ? path : path.slice(lastSlash + 1);
};

const isDescendantOf = (path: string, ancestor: string): boolean =>
  path.startsWith(`${ancestor}/`);

const getPathDepth = (path: string): number => {
  let depth = 1;
  for (let index = 0; index < path.length; index += 1) {
    if (path.charCodeAt(index) === 47) {
      depth += 1;
    }
  }
  return depth;
};

const hasSelectedFolderAncestor = (
  path: string,
  selectedFolders: Set<string>
): boolean => {
  let slash = path.lastIndexOf('/');
  while (slash !== -1) {
    const parent = path.slice(0, slash);
    if (selectedFolders.has(parent)) {
      return true;
    }
    slash = parent.lastIndexOf('/');
  }
  return false;
};

const splitPath = (path: string): { parentPath: string; baseName: string } => {
  const separatorIndex = path.lastIndexOf('/');
  if (separatorIndex < 0) {
    return { parentPath: '', baseName: path };
  }
  return {
    parentPath: path.slice(0, separatorIndex),
    baseName: path.slice(separatorIndex + 1),
  };
};

/**
 * Applies an origin->destination map into a mutable path tree. Returns false
 * if a path inconsistency is detected.
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
      parentPath === '' ? 'root' : parentPath,
      baseName,
      'file'
    );

    if (moveResult !== 'ok') {
      return false;
    }
  }

  return true;
}

/**
 * Computes the next flat file list for a drag-and-drop move.
 */
export function computeNewFilesAfterDrop(
  currentFiles: string[],
  draggedPaths: string[],
  targetFolderPath: string,
  options: ComputeDropOptions = {}
): string[] {
  const normalizedTarget = normalizePath(targetFolderPath);
  const targetPrefix =
    normalizedTarget === 'root' ? '' : `${normalizedTarget}/`;

  const pathTree = options.pathTree ?? MutablePathTree.fromFiles(currentFiles);

  const normalizedDragged = [...new Set(draggedPaths.map(normalizePath))];
  const orderedDragged = normalizedDragged
    .filter((path) => pathTree.hasPath(path))
    .sort((left, right) => getPathDepth(left) - getPathDepth(right));

  const selectedFolders = new Set<string>();
  const selectedFiles: string[] = [];

  for (let index = 0; index < orderedDragged.length; index += 1) {
    const path = orderedDragged[index];
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

  const proposedDestinationByOrigin = new Map<string, string>();

  for (let index = 0; index < selectedFiles.length; index += 1) {
    const filePath = selectedFiles[index];
    const destination = `${targetPrefix}${getBasename(filePath)}`;
    if (destination !== filePath) {
      proposedDestinationByOrigin.set(filePath, destination);
    }
  }

  for (const folderPath of selectedFolders) {
    if (
      normalizedTarget === folderPath ||
      isDescendantOf(normalizedTarget, folderPath)
    ) {
      continue;
    }

    const movedFolderName = getBasename(folderPath);
    const descendantFiles = pathTree.getDescendantFilePaths(folderPath);

    for (let index = 0; index < descendantFiles.length; index += 1) {
      const origin = descendantFiles[index];
      const destination = `${targetPrefix}${movedFolderName}${origin.slice(folderPath.length)}`;
      if (destination !== origin) {
        proposedDestinationByOrigin.set(origin, destination);
      }
    }
  }

  const finalPathByOrigin = new Map<string, string | null>();
  const occupantByDestination = new Map<string, string>();

  for (let index = 0; index < currentFiles.length; index += 1) {
    const file = currentFiles[index];
    finalPathByOrigin.set(file, file);
    occupantByDestination.set(file, file);
  }

  for (let index = 0; index < currentFiles.length; index += 1) {
    const origin = currentFiles[index];
    const destination = proposedDestinationByOrigin.get(origin);
    if (destination == null) {
      continue;
    }

    const currentPath = finalPathByOrigin.get(origin);
    if (currentPath == null || currentPath === destination) {
      continue;
    }

    const existingOccupant = occupantByDestination.get(destination);
    if (existingOccupant != null && existingOccupant !== origin) {
      const allowOverwrite =
        options.onCollision?.({ origin, destination }) === true;
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
    occupantByDestination.set(destination, origin);
    finalPathByOrigin.set(origin, destination);
  }

  const result: string[] = [];
  for (let index = 0; index < currentFiles.length; index += 1) {
    const file = currentFiles[index];
    const next = finalPathByOrigin.get(file);
    if (next != null) {
      result.push(next);
    }
  }

  if (options.mutatePathTree === true && options.pathTree != null) {
    const applied = applyMappedFilesToPathTree(
      options.pathTree,
      currentFiles,
      finalPathByOrigin
    );
    if (!applied) {
      options.pathTree.replaceAll(result);
    }
  }

  return result;
}
