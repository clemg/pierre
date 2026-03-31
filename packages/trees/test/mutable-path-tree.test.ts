import { describe, expect, test } from 'bun:test';

import { MutablePathTree } from '../src/utils/mutablePathTree';

describe('MutablePathTree', () => {
  test('indexes descendants by parent pointers', () => {
    const tree = MutablePathTree.fromFiles([
      'src/index.ts',
      'src/utils/a.ts',
      'docs/readme.md',
    ]);

    expect(tree.getDescendantFilePaths('src')).toEqual([
      'src/index.ts',
      'src/utils/a.ts',
    ]);
    expect(tree.getDescendantFilePaths('docs')).toEqual(['docs/readme.md']);
  });

  test('renames a folder subtree in place', () => {
    const tree = MutablePathTree.fromFiles([
      'src/index.ts',
      'src/utils/a.ts',
      'docs/readme.md',
    ]);

    expect(tree.renamePath('src/utils', 'src/lib', 'folder')).toBe('ok');
    expect(tree.cloneFiles()).toEqual([
      'src/index.ts',
      'src/lib/a.ts',
      'docs/readme.md',
    ]);
    expect(tree.hasPath('src/utils')).toBe(false);
    expect(tree.hasPath('src/lib')).toBe(true);
  });

  test('moves a single file to another folder', () => {
    const tree = MutablePathTree.fromFiles([
      'src/index.ts',
      'src/utils/a.ts',
      'docs/readme.md',
    ]);

    expect(tree.movePath('docs/readme.md', 'src', 'readme.md', 'file')).toBe(
      'ok'
    );
    expect(tree.cloneFiles()).toEqual([
      'src/index.ts',
      'src/utils/a.ts',
      'src/readme.md',
    ]);
  });

  test('supports add/delete file mutations for incremental updates', () => {
    const tree = MutablePathTree.fromFiles(['a.ts']);

    expect(tree.addFilePath('src/new.ts')).toBe(true);
    expect(tree.cloneFiles()).toEqual(['a.ts', 'src/new.ts']);

    expect(tree.deleteFilePath('a.ts')).toBe(true);
    expect(tree.cloneFiles()).toEqual(['src/new.ts']);

    expect(tree.deleteFolderPath('src')).toBe(true);
    expect(tree.cloneFiles()).toEqual([]);
    expect(tree.hasFolder('src')).toBe(false);
  });
});
