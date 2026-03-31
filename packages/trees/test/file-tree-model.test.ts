import { describe, expect, test } from 'bun:test';

import { FileTreeModel } from '../src/model/FileTreeModel';

function createCounterCollector(): {
  counters: Record<string, number>;
  instrumentation: {
    measurePhase: <TValue>(name: string, fn: () => TValue) => TValue;
    setCounter: (name: string, value: number) => void;
  };
} {
  const counters: Record<string, number> = {};
  return {
    counters,
    instrumentation: {
      measurePhase: (_name, fn) => fn(),
      setCounter: (name, value) => {
        counters[name] = value;
      },
    },
  };
}

function createMutationComplexityFixture(unrelatedFileCount: number): string[] {
  const files = [
    'workspace/src/deep/nested/file-a.ts',
    'workspace/src/deep/nested/file-b.ts',
    'workspace/src/deep/root-file.ts',
    'workspace/target/keep.ts',
  ];

  for (let index = 0; index < unrelatedFileCount; index += 1) {
    files.push(`noise-${index}/file-${index}.ts`);
  }

  return files;
}

function createInstrumentedModel(unrelatedFileCount: number): {
  model: FileTreeModel;
  counters: Record<string, number>;
} {
  const { counters, instrumentation } = createCounterCollector();
  const model = FileTreeModel.fromFiles(
    createMutationComplexityFixture(unrelatedFileCount),
    {
      sortComparator: false,
      benchmarkInstrumentation: instrumentation,
    }
  );

  return { model, counters };
}

function getCounter(counters: Record<string, number>, name: string): number {
  return counters[name] ?? 0;
}

describe('FileTreeModel', () => {
  test('assigns deterministic IDs across independent instances', () => {
    const files = [
      'README.md',
      'src/index.ts',
      'src/components/Button.tsx',
      'docs/guide.md',
    ];

    const modelA = FileTreeModel.fromFiles(files, { sortComparator: false });
    const modelB = FileTreeModel.fromFiles([...files].reverse(), {
      sortComparator: false,
    });

    const indexA = modelA.getSyncIndex();
    const indexB = modelB.getSyncIndex();

    for (let index = 0; index < files.length; index += 1) {
      const path = files[index];
      expect(indexA.pathToId.get(path)).toBe(indexB.pathToId.get(path));
    }
  });

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

  test('handles deep overwrite collisions during folder moves without stale IDs', () => {
    const model = FileTreeModel.fromFiles(
      ['src/nested/file.ts', 'docs/src/nested/file.ts', 'README.md'],
      {
        sortComparator: false,
      }
    );

    const syncIndex = model.getSyncIndex();
    const movedFileId = syncIndex.pathToId.get('src/nested/file.ts');
    const overwrittenFileId = syncIndex.pathToId.get('docs/src/nested/file.ts');
    expect(movedFileId).toBeDefined();
    expect(overwrittenFileId).toBeDefined();
    if (movedFileId == null || overwrittenFileId == null) {
      throw new Error('Expected IDs for move collision test.');
    }

    const result = model.movePaths({
      draggedPaths: ['src'],
      targetPath: 'docs',
      onCollision: () => true,
    });

    expect(result.ok).toBe(true);
    expect(model.getFiles()).toEqual(['docs/src/nested/file.ts', 'README.md']);
    expect(syncIndex.pathToId.get('docs/src/nested/file.ts')).toBe(movedFileId);
    expect(model.hasId(overwrittenFileId)).toBe(false);
  });

  test('adds paths with semantic add-paths mutations', () => {
    const model = FileTreeModel.fromFiles(['src/index.ts'], {
      sortComparator: false,
    });

    const mutations: string[] = [];
    model.subscribe((mutation) => {
      mutations.push(mutation.kind);
    });

    const result = model.addPaths({
      paths: ['src/utils/helpers.ts', 'docs/readme.md', 'src/index.ts'],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error);
    }

    expect(result.mutation?.kind).toBe('add-paths');
    expect(model.getFiles()).toEqual([
      'src/index.ts',
      'src/utils/helpers.ts',
      'docs/readme.md',
    ]);
    expect(mutations).toContain('add-paths');
  });

  test('deletes file and folder paths with semantic delete-paths mutations', () => {
    const model = FileTreeModel.fromFiles(
      [
        'src/index.ts',
        'src/utils/helpers.ts',
        'src/utils/format.ts',
        'docs/readme.md',
      ],
      {
        sortComparator: false,
      }
    );

    const syncIndex = model.getSyncIndex();
    const docsId = syncIndex.pathToId.get('docs/readme.md');
    expect(docsId).toBeDefined();

    const result = model.deletePaths({
      paths: ['src/utils', 'src/index.ts', 'missing/path.ts'],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error);
    }

    expect(result.mutation?.kind).toBe('delete-paths');
    expect(model.getFiles()).toEqual(['docs/readme.md']);
    expect(syncIndex.pathToId.get('docs/readme.md')).toBe(docsId);
    expect(syncIndex.pathToId.get('src/index.ts')).toBeUndefined();
    expect(syncIndex.pathToId.get('src/utils/helpers.ts')).toBeUndefined();
  });

  test('keeps file rename remap work constant with many unrelated files', () => {
    const small = createInstrumentedModel(5);
    const large = createInstrumentedModel(500);

    const renameRequest = {
      sourcePath: 'workspace/src/deep/nested/file-a.ts',
      destinationPath: 'workspace/src/deep/nested/file-a-renamed.ts',
      isFolder: false,
    } as const;

    const smallResult = small.model.renamePath(renameRequest);
    const largeResult = large.model.renamePath(renameRequest);

    expect(smallResult.ok).toBe(true);
    expect(largeResult.ok).toBe(true);
    expect(
      getCounter(small.counters, 'model.rename.file.remapScannedNodes')
    ).toBe(1);
    expect(
      getCounter(large.counters, 'model.rename.file.remapScannedNodes')
    ).toBe(1);
  });

  test('keeps folder rename remap work proportional to moved subtree size', () => {
    const small = createInstrumentedModel(5);
    const large = createInstrumentedModel(500);

    const renameRequest = {
      sourcePath: 'workspace/src/deep',
      destinationPath: 'workspace/src/deep-renamed',
      isFolder: true,
    } as const;

    const smallResult = small.model.renamePath(renameRequest);
    const largeResult = large.model.renamePath(renameRequest);

    expect(smallResult.ok).toBe(true);
    expect(largeResult.ok).toBe(true);
    expect(
      getCounter(small.counters, 'model.rename.folder.remapScannedNodes')
    ).toBe(getCounter(large.counters, 'model.rename.folder.remapScannedNodes'));
    expect(
      getCounter(small.counters, 'model.rename.folder.remapUpdatedNodes')
    ).toBe(getCounter(large.counters, 'model.rename.folder.remapUpdatedNodes'));
  });

  test('keeps file move remap work constant with many unrelated files', () => {
    const small = createInstrumentedModel(5);
    const large = createInstrumentedModel(500);

    const moveRequest = {
      draggedPaths: ['workspace/src/deep/nested/file-a.ts'],
      targetPath: 'workspace/target',
    };

    const smallResult = small.model.movePaths(moveRequest);
    const largeResult = large.model.movePaths(moveRequest);

    expect(smallResult.ok).toBe(true);
    expect(largeResult.ok).toBe(true);
    expect(getCounter(small.counters, 'model.move.remapScannedNodes')).toBe(1);
    expect(getCounter(large.counters, 'model.move.remapScannedNodes')).toBe(1);
  });

  test('keeps folder move remap work proportional to moved subtree size', () => {
    const small = createInstrumentedModel(5);
    const large = createInstrumentedModel(500);

    const moveRequest = {
      draggedPaths: ['workspace/src/deep'],
      targetPath: 'workspace/target',
    };

    const smallResult = small.model.movePaths(moveRequest);
    const largeResult = large.model.movePaths(moveRequest);

    expect(smallResult.ok).toBe(true);
    expect(largeResult.ok).toBe(true);
    expect(getCounter(small.counters, 'model.move.remapScannedNodes')).toBe(
      getCounter(large.counters, 'model.move.remapScannedNodes')
    );
    expect(getCounter(small.counters, 'model.move.remapUpdatedNodes')).toBe(
      getCounter(large.counters, 'model.move.remapUpdatedNodes')
    );
  });

  test('rebuilds only local folders for add/delete regardless of unrelated file volume', () => {
    const smallAdd = createInstrumentedModel(5);
    const largeAdd = createInstrumentedModel(500);

    const addRequest = {
      paths: ['workspace/src/deep/nested/added.ts'],
    };

    expect(smallAdd.model.addPaths(addRequest).ok).toBe(true);
    expect(largeAdd.model.addPaths(addRequest).ok).toBe(true);

    expect(
      getCounter(smallAdd.counters, 'model.rebuildFolders.executedCount')
    ).toBe(getCounter(largeAdd.counters, 'model.rebuildFolders.executedCount'));

    const smallDelete = createInstrumentedModel(5);
    const largeDelete = createInstrumentedModel(500);

    const deleteRequest = {
      paths: ['workspace/src/deep/nested/file-b.ts'],
    };

    expect(smallDelete.model.deletePaths(deleteRequest).ok).toBe(true);
    expect(largeDelete.model.deletePaths(deleteRequest).ok).toBe(true);

    expect(
      getCounter(smallDelete.counters, 'model.rebuildFolders.executedCount')
    ).toBe(
      getCounter(largeDelete.counters, 'model.rebuildFolders.executedCount')
    );
  });
});
