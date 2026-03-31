import { describe, expect, test } from 'bun:test';

import { MutablePathTree } from '../src/utils/mutablePathTree';

describe('MutablePathTree', () => {
  test('indexes files and inferred folders', () => {
    const tree = MutablePathTree.fromFiles([
      'src/index.ts',
      'src/utils/helpers.ts',
      'docs/readme.md',
    ]);

    expect(tree.hasFile('src/index.ts')).toBe(true);
    expect(tree.hasFolder('src')).toBe(true);
    expect(tree.hasFolder('src/utils')).toBe(true);
    expect(tree.hasFolder('docs')).toBe(true);
    expect(tree.hasPath('missing')).toBe(false);
  });

  test('renames files in place', () => {
    const tree = MutablePathTree.fromFiles(['src/index.ts', 'docs/readme.md']);

    expect(tree.renamePath('src/index.ts', 'src/main.ts', 'file')).toBe('ok');
    expect(tree.cloneFiles()).toEqual(['src/main.ts', 'docs/readme.md']);
    expect(tree.hasFile('src/index.ts')).toBe(false);
    expect(tree.hasFile('src/main.ts')).toBe(true);
  });

  test('renames folders and rewrites descendant file paths', () => {
    const tree = MutablePathTree.fromFiles([
      'src/index.ts',
      'src/utils/helpers.ts',
      'docs/readme.md',
    ]);

    expect(tree.renamePath('src', 'lib', 'folder')).toBe('ok');
    expect(tree.cloneFiles()).toEqual([
      'lib/index.ts',
      'lib/utils/helpers.ts',
      'docs/readme.md',
    ]);
    expect(tree.hasFolder('lib')).toBe(true);
    expect(tree.hasFolder('src')).toBe(false);
  });

  test('moves a single file between folders', () => {
    const tree = MutablePathTree.fromFiles([
      'src/index.ts',
      'docs/readme.md',
      'package.json',
    ]);

    expect(tree.movePath('src/index.ts', 'docs', 'index.ts', 'file')).toBe(
      'ok'
    );
    expect(tree.cloneFiles()).toEqual([
      'docs/index.ts',
      'docs/readme.md',
      'package.json',
    ]);
  });

  test('moves a folder and all descendants', () => {
    const tree = MutablePathTree.fromFiles([
      'src/utils/a.ts',
      'src/utils/b.ts',
      'docs/readme.md',
    ]);

    expect(tree.movePath('src/utils', 'docs', 'utils', 'folder')).toBe('ok');
    expect(tree.cloneFiles()).toEqual([
      'docs/utils/a.ts',
      'docs/utils/b.ts',
      'docs/readme.md',
    ]);
  });

  test('adds and deletes file paths', () => {
    const tree = MutablePathTree.fromFiles(['src/index.ts']);

    expect(tree.addFilePath('src/utils/helpers.ts')).toBe(true);
    expect(tree.addFilePath('src/utils/helpers.ts')).toBe(false);
    expect(tree.cloneFiles()).toEqual(['src/index.ts', 'src/utils/helpers.ts']);

    expect(tree.deleteFilePath('src/index.ts')).toBe(true);
    expect(tree.deleteFilePath('missing.ts')).toBe(false);
    expect(tree.cloneFiles()).toEqual(['src/utils/helpers.ts']);
  });

  test('deletes folders by removing descendant files', () => {
    const tree = MutablePathTree.fromFiles([
      'src/index.ts',
      'src/utils/helpers.ts',
      'docs/readme.md',
    ]);

    expect(tree.deleteFolderPath('src')).toBe(true);
    expect(tree.cloneFiles()).toEqual(['docs/readme.md']);
    expect(tree.hasFolder('src')).toBe(false);
  });

  test('returns descendant files in source order', () => {
    const tree = MutablePathTree.fromFiles([
      'src/a.ts',
      'src/deep/b.ts',
      'src/deep/c.ts',
      'docs/readme.md',
    ]);

    expect(tree.getDescendantFilePaths('src')).toEqual([
      'src/a.ts',
      'src/deep/b.ts',
      'src/deep/c.ts',
    ]);
  });
});
