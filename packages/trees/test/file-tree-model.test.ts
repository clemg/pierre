import { describe, expect, test } from 'bun:test';

import { FileTreeModel } from '../src/model/FileTreeModel';

describe('FileTreeModel', () => {
  test('keeps file IDs stable across same-parent rename', () => {
    const model = FileTreeModel.fromFiles(['src/a.ts', 'src/b.ts'], {
      sortComparator: false,
    });

    const syncIndex = model.getSyncIndex();
    const originalId = syncIndex.pathToId.get('src/a.ts');
    expect(originalId).toBeDefined();
    if (originalId == null) {
      throw new Error('Expected stable ID for src/a.ts');
    }

    const result = model.renamePath({
      sourcePath: 'src/a.ts',
      destinationPath: 'src/a-renamed.ts',
      isFolder: false,
    });
    expect(result.ok).toBe(true);

    const renamedId = syncIndex.pathToId.get('src/a-renamed.ts');
    expect(renamedId).toBe(originalId);
    expect(syncIndex.pathToId.get('src/a.ts')).toBeUndefined();
    expect(syncIndex.tree.get(originalId)?.path).toBe('src/a-renamed.ts');
  });

  test('reuses IDs for unchanged paths during replaceAll', () => {
    const model = FileTreeModel.fromFiles(['src/a.ts', 'src/b.ts'], {
      sortComparator: false,
    });
    const syncIndex = model.getSyncIndex();

    const aIdBefore = syncIndex.pathToId.get('src/a.ts');
    expect(aIdBefore).toBeDefined();

    model.replaceAll(['src/a.ts', 'src/c.ts']);

    expect(syncIndex.pathToId.get('src/a.ts')).toBe(aIdBefore);
    expect(syncIndex.pathToId.get('src/b.ts')).toBeUndefined();
    expect(syncIndex.pathToId.get('src/c.ts')).toBeDefined();
  });

  test('keeps file IDs stable across movePaths file moves', () => {
    const model = FileTreeModel.fromFiles(
      ['src/index.ts', 'docs/guide.md', 'README.md'],
      {
        sortComparator: false,
      }
    );
    const syncIndex = model.getSyncIndex();
    const movedId = syncIndex.pathToId.get('src/index.ts');
    expect(movedId).toBeDefined();
    if (movedId == null) {
      throw new Error('Expected stable ID for src/index.ts');
    }

    const result = model.movePaths({
      draggedPaths: ['src/index.ts'],
      targetPath: 'docs',
    });
    expect(result.ok).toBe(true);

    expect(syncIndex.pathToId.get('docs/index.ts')).toBe(movedId);
    expect(syncIndex.pathToId.get('src/index.ts')).toBeUndefined();
  });

  test('keeps folder and descendant IDs stable across movePaths folder moves', () => {
    const model = FileTreeModel.fromFiles(
      [
        'src/components/Button.tsx',
        'src/components/Card.tsx',
        'docs/readme.md',
      ],
      {
        sortComparator: false,
      }
    );
    const syncIndex = model.getSyncIndex();

    const folderId = syncIndex.pathToId.get('src/components');
    const childId = syncIndex.pathToId.get('src/components/Button.tsx');
    expect(folderId).toBeDefined();
    expect(childId).toBeDefined();
    if (folderId == null || childId == null) {
      throw new Error('Expected stable IDs for moved folder and child.');
    }

    const result = model.movePaths({
      draggedPaths: ['src/components'],
      targetPath: 'docs',
    });
    expect(result.ok).toBe(true);

    expect(syncIndex.pathToId.get('docs/components')).toBe(folderId);
    expect(syncIndex.pathToId.get('docs/components/Button.tsx')).toBe(childId);
    expect(syncIndex.pathToId.get('src/components')).toBeUndefined();
  });
});
