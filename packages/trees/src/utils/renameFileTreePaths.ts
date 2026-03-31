import { getSelectionPath } from './getSelectionPath';
import { MutablePathTree } from './mutablePathTree';

export type RenameFileTreePathsResult =
  | {
      nextFiles: string[];
      sourcePath: string;
      destinationPath: string;
      isFolder: boolean;
    }
  | { error: string };

type RenameFileTreePathsParams = {
  files: string[];
  path: string;
  isFolder: boolean;
  nextBasename: string;
  /** Optional persistent tree to reuse during rename computation. */
  pathTree?: MutablePathTree;
  /** Mutate `pathTree` in place when true. */
  mutatePathTree?: boolean;
};

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

export function remapExpandedPathsForFolderRename({
  expandedPaths,
  sourcePath,
  destinationPath,
}: {
  expandedPaths: string[];
  sourcePath: string;
  destinationPath: string;
}): string[] {
  if (expandedPaths.length === 0 || sourcePath === destinationPath) {
    return expandedPaths;
  }

  const sourcePrefix = `${sourcePath}/`;
  const nextExpandedPaths: string[] = [];
  const seen = new Set<string>();
  let changed = false;

  for (let index = 0; index < expandedPaths.length; index++) {
    const path = expandedPaths[index];
    const nextPath =
      path === sourcePath
        ? destinationPath
        : path.startsWith(sourcePrefix)
          ? `${destinationPath}${path.slice(sourcePath.length)}`
          : path;
    if (nextPath !== path) {
      changed = true;
    }
    if (seen.has(nextPath)) {
      changed = true;
      continue;
    }
    seen.add(nextPath);
    nextExpandedPaths.push(nextPath);
  }

  return changed ? nextExpandedPaths : expandedPaths;
}

/**
 * Computes a renamed file list using same-parent basename semantics.
 */
export function renameFileTreePaths({
  files,
  path,
  isFolder,
  nextBasename,
  pathTree,
  mutatePathTree,
}: RenameFileTreePathsParams): RenameFileTreePathsResult {
  const sourcePath = getSelectionPath(path);
  const trimmedBasename = nextBasename.trim();
  if (trimmedBasename.length === 0) {
    return { error: 'Name cannot be empty.' };
  }
  if (trimmedBasename.includes('/')) {
    return { error: 'Name cannot include "/".' };
  }

  const { parentPath, baseName } = splitPath(sourcePath);
  if (trimmedBasename === baseName) {
    return {
      nextFiles: files,
      sourcePath,
      destinationPath: sourcePath,
      isFolder,
    };
  }

  const destinationPath = joinPath(parentPath, trimmedBasename);
  const workingPathTree =
    pathTree != null && mutatePathTree === true
      ? pathTree
      : MutablePathTree.fromFiles(files);

  const renameKind = isFolder ? 'folder' : 'file';
  const renameResult = workingPathTree.renamePath(
    sourcePath,
    destinationPath,
    renameKind
  );

  if (renameResult === 'missing') {
    return {
      error: isFolder
        ? 'Could not find the selected folder to rename.'
        : 'Could not find the selected file to rename.',
    };
  }

  if (renameResult === 'collision') {
    return { error: `"${destinationPath}" already exists.` };
  }

  if (renameResult === 'invalid') {
    return {
      error: 'Could not rename the selected path.',
    };
  }

  return {
    nextFiles: workingPathTree.cloneFiles(),
    sourcePath,
    destinationPath,
    isFolder,
  };
}
