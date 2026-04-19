import { describe, expect, test } from 'bun:test';
import { JSDOM } from 'jsdom';

import {
  computeFirstVisibleIndex,
  computeStickyWindowLayout,
  computeWindowRange,
  FILE_TREE_DEFAULT_ITEM_HEIGHT,
  FILE_TREE_DEFAULT_OVERSCAN,
  FILE_TREE_DEFAULT_VIEWPORT_HEIGHT,
} from '../src/index';
import { computeInsetWindowLayout } from '../src/model/virtualization';

function installDom() {
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
    url: 'http://localhost',
  });
  const originalValues = {
    CSSStyleSheet: Reflect.get(globalThis, 'CSSStyleSheet'),
    customElements: Reflect.get(globalThis, 'customElements'),
    document: Reflect.get(globalThis, 'document'),
    Event: Reflect.get(globalThis, 'Event'),
    HTMLElement: Reflect.get(globalThis, 'HTMLElement'),
    HTMLDivElement: Reflect.get(globalThis, 'HTMLDivElement'),
    HTMLStyleElement: Reflect.get(globalThis, 'HTMLStyleElement'),
    HTMLTemplateElement: Reflect.get(globalThis, 'HTMLTemplateElement'),
    MutationObserver: Reflect.get(globalThis, 'MutationObserver'),
    navigator: Reflect.get(globalThis, 'navigator'),
    Node: Reflect.get(globalThis, 'Node'),
    ResizeObserver: Reflect.get(globalThis, 'ResizeObserver'),
    SVGElement: Reflect.get(globalThis, 'SVGElement'),
    ShadowRoot: Reflect.get(globalThis, 'ShadowRoot'),
    window: Reflect.get(globalThis, 'window'),
  };

  class MockStyleSheet {
    replaceSync(_value: string): void {}
  }

  class MockResizeObserver {
    observe(_target: Element): void {}
    disconnect(): void {}
  }

  Object.assign(globalThis, {
    CSSStyleSheet: MockStyleSheet,
    customElements: dom.window.customElements,
    document: dom.window.document,
    Event: dom.window.Event,
    HTMLElement: dom.window.HTMLElement,
    HTMLDivElement: dom.window.HTMLDivElement,
    HTMLStyleElement: dom.window.HTMLStyleElement,
    HTMLTemplateElement: dom.window.HTMLTemplateElement,
    MutationObserver: dom.window.MutationObserver,
    navigator: dom.window.navigator,
    Node: dom.window.Node,
    ResizeObserver: MockResizeObserver,
    SVGElement: dom.window.SVGElement,
    ShadowRoot: dom.window.ShadowRoot,
    window: dom.window,
  });

  return {
    dom,
    cleanup() {
      for (const [key, value] of Object.entries(originalValues)) {
        if (value === undefined) {
          Reflect.deleteProperty(globalThis, key);
        } else {
          Object.assign(globalThis, { [key]: value });
        }
      }
      dom.window.close();
    },
  };
}

async function flushDom(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function getFocusedTreeElement(
  shadowRoot: ShadowRoot | null | undefined,
  dom: JSDOM
): HTMLElement | null {
  const activeElement = shadowRoot?.activeElement ?? null;
  return activeElement instanceof dom.window.HTMLElement ? activeElement : null;
}

function getItemButton(
  shadowRoot: ShadowRoot | null | undefined,
  dom: JSDOM,
  path: string
): HTMLButtonElement {
  const button = shadowRoot?.querySelector(`[data-item-path="${path}"]`);
  if (!(button instanceof dom.window.HTMLButtonElement)) {
    throw new Error(`missing button for ${path}`);
  }

  return button;
}

function getTreeRoot(
  shadowRoot: ShadowRoot | null | undefined,
  dom: JSDOM
): HTMLDivElement {
  const root = shadowRoot?.querySelector(
    '[data-file-tree-virtualized-root="true"]'
  );
  if (!(root instanceof dom.window.HTMLDivElement)) {
    throw new Error('missing tree root');
  }

  return root;
}

function getVirtualList(
  shadowRoot: ShadowRoot | null | undefined,
  dom: JSDOM
): HTMLDivElement {
  const list = shadowRoot?.querySelector(
    '[data-file-tree-virtualized-list="true"]'
  );
  if (!(list instanceof dom.window.HTMLDivElement)) {
    throw new Error('missing virtualized list');
  }

  return list;
}

function getVirtualStickyOffset(
  shadowRoot: ShadowRoot | null | undefined,
  dom: JSDOM
): HTMLDivElement {
  const offset = shadowRoot?.querySelector(
    '[data-file-tree-virtualized-sticky-offset="true"]'
  );
  if (!(offset instanceof dom.window.HTMLDivElement)) {
    throw new Error('missing virtualized sticky offset');
  }

  return offset;
}

function getVirtualStickyWindow(
  shadowRoot: ShadowRoot | null | undefined,
  dom: JSDOM
): HTMLDivElement {
  const windowElement = shadowRoot?.querySelector(
    '[data-file-tree-virtualized-sticky="true"]'
  );
  if (!(windowElement instanceof dom.window.HTMLDivElement)) {
    throw new Error('missing virtualized sticky window');
  }

  return windowElement;
}

function getPixelStyleValue(
  element: HTMLElement,
  property: 'bottom' | 'height' | 'top'
): number {
  const value = element.style.getPropertyValue(property);
  return Number.parseFloat(value === '' ? '0' : value);
}

function clickItem(
  shadowRoot: ShadowRoot | null | undefined,
  dom: JSDOM,
  path: string,
  init: MouseEventInit = {}
): void {
  const buttonElement = getItemButton(shadowRoot, dom, path);
  buttonElement.dispatchEvent(
    new dom.window.MouseEvent('click', { bubbles: true, ...init })
  );
}

function pressKey(
  target: HTMLElement,
  dom: JSDOM,
  key: string,
  init: KeyboardEventInit = {}
): void {
  target.dispatchEvent(
    new dom.window.KeyboardEvent('keydown', {
      bubbles: true,
      key,
      ...init,
    })
  );
}

function getSelectedItemPaths(
  shadowRoot: ShadowRoot | null | undefined,
  dom: JSDOM
): string[] {
  return Array.from(
    shadowRoot?.querySelectorAll('[data-item-selected="true"]') ?? []
  )
    .filter(
      (element): element is HTMLButtonElement =>
        element instanceof dom.window.HTMLButtonElement
    )
    .filter((button) => button.dataset.itemParked !== 'true')
    .map((button) => button.dataset.itemPath)
    .filter((path): path is string => path != null);
}

function getFocusedItemPath(
  shadowRoot: ShadowRoot | null | undefined,
  dom: JSDOM
): string | null {
  const button = shadowRoot?.querySelector(
    'button[data-type="item"][tabindex="0"]'
  );
  return button instanceof dom.window.HTMLButtonElement
    ? (button.dataset.itemPath ?? null)
    : null;
}

function getNormalizedText(element: Element | null | undefined): string {
  return element?.textContent?.replaceAll(/\s+/g, ' ').trim() ?? '';
}

function getStickyRowPaths(
  shadowRoot: ShadowRoot | null | undefined,
  dom: JSDOM
): string[] {
  return Array.from(
    shadowRoot?.querySelectorAll('[data-file-tree-sticky-path]') ?? []
  )
    .filter(
      (element): element is HTMLElement =>
        element instanceof dom.window.HTMLElement
    )
    .map((element) => element.dataset.fileTreeStickyPath)
    .filter((path): path is string => path != null);
}
function getMountedItemPaths(
  shadowRoot: ShadowRoot | null | undefined,
  dom: JSDOM
): string[] {
  return Array.from(shadowRoot?.querySelectorAll('[data-type="item"]') ?? [])
    .filter(
      (element): element is HTMLButtonElement =>
        element instanceof dom.window.HTMLButtonElement
    )
    .filter((button) => button.dataset.itemParked !== 'true')
    .map((button) => button.dataset.itemPath)
    .filter((path): path is string => path != null);
}

function clickStickyRow(
  shadowRoot: ShadowRoot | null | undefined,
  dom: JSDOM,
  path: string
): void {
  const button = shadowRoot?.querySelector(
    `[data-file-tree-sticky-path="${path}"]`
  );
  if (!(button instanceof dom.window.HTMLButtonElement)) {
    throw new Error(`missing sticky row for ${path}`);
  }

  button.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
}
async function loadFileTreeController(): Promise<
  typeof import('../src/index').FileTreeController
> {
  const { FileTreeController } =
    await import('../src/model/FileTreeController');
  return FileTreeController;
}

async function loadFileTree(): Promise<typeof import('../src/index').FileTree> {
  const { FileTree } = await import('../src/render/FileTree');
  return FileTree;
}

async function loadPreloadFileTree(): Promise<
  (
    options: import('../src/index').FileTreeOptions
  ) => import('../src/index').FileTreeSsrPayload
> {
  const { preloadFileTree } = await import('../src/render/FileTree');
  return preloadFileTree;
}

describe('file-tree render + scroll', () => {
  test('controller exposes path-first visible rows without leaking numeric ids', async () => {
    const FileTreeController = await loadFileTreeController();

    const controller = new FileTreeController({
      flattenEmptyDirectories: false,
      initialExpansion: 'open',
      paths: ['z.ts', 'a.ts'],
    });

    const [firstRow] = controller.getVisibleRows(0, 0);

    expect(firstRow?.path).toBe('a.ts');
    expect(Reflect.has(firstRow ?? {}, 'id')).toBe(false);

    controller.destroy();
  });

  test('controller getItem returns minimal file/directory handles with selection + focus state and null on miss', async () => {
    const FileTreeController = await loadFileTreeController();

    const controller = new FileTreeController({
      flattenEmptyDirectories: false,
      initialExpansion: 1,
      paths: ['README.md', 'src/index.ts', 'src/lib/util.ts'],
    });

    const fileItem = controller.getItem('README.md');
    const directoryItem = controller.getItem('src');

    expect(fileItem?.getPath()).toBe('README.md');
    expect(fileItem?.isDirectory()).toBe(false);
    expect(fileItem?.isFocused()).toBe(false);
    expect(fileItem?.isSelected()).toBe(false);
    expect('expand' in (fileItem ?? {})).toBe(false);

    expect(directoryItem?.getPath()).toBe('src/');
    expect(directoryItem?.isDirectory()).toBe(true);
    if (
      directoryItem == null ||
      directoryItem.isDirectory() !== true ||
      !('isExpanded' in directoryItem)
    ) {
      throw new Error('expected directory item');
    }

    expect(directoryItem.isExpanded()).toBe(true);
    expect(directoryItem.isFocused()).toBe(true);
    expect(directoryItem.isSelected()).toBe(false);
    fileItem?.focus();
    expect(fileItem?.isFocused()).toBe(true);
    expect(directoryItem.isFocused()).toBe(false);
    expect(controller.getFocusedPath()).toBe('README.md');

    fileItem?.select();
    expect(fileItem?.isSelected()).toBe(true);
    directoryItem.select();
    expect(controller.getSelectedPaths()).toEqual(['README.md', 'src/']);
    directoryItem.toggleSelect();
    expect(controller.getSelectedPaths()).toEqual(['README.md']);
    fileItem?.deselect();
    expect(controller.getSelectedPaths()).toEqual([]);
    expect(controller.getItem('missing.ts')).toBeNull();

    controller.destroy();
  });

  test('controller initialSelectedPaths drops missing entries, canonicalizes directories, and focuses the last resolved path', async () => {
    const FileTreeController = await loadFileTreeController();

    const controller = new FileTreeController({
      flattenEmptyDirectories: false,
      initialExpansion: 'open',
      initialSelectedPaths: ['missing.ts', 'src/foo'],
      paths: ['README.md', 'src/foo/bar.ts'],
    });

    expect(controller.getSelectedPaths()).toEqual(['src/foo/']);
    expect(controller.getFocusedPath()).toBe('src/foo/');
    expect(controller.getFocusedItem()?.getPath()).toBe('src/foo/');
    expect(controller.getItem('src/foo')?.isSelected()).toBe(true);
    expect(controller.getItem('src/foo')?.isFocused()).toBe(true);

    controller.destroy();

    const invalidOnlyController = new FileTreeController({
      flattenEmptyDirectories: false,
      initialSelectedPaths: ['missing.ts'],
      paths: ['a.ts', 'b.ts'],
    });

    expect(invalidOnlyController.getSelectedPaths()).toEqual([]);
    expect(invalidOnlyController.getFocusedPath()).toBe('a.ts');

    invalidOnlyController.destroy();
  });

  test('controller initialSelectedPaths uses the last resolved path as the focus target and range anchor', async () => {
    const FileTreeController = await loadFileTreeController();

    const controller = new FileTreeController({
      flattenEmptyDirectories: false,
      initialExpansion: 'open',
      initialSelectedPaths: ['a.ts', 'c.ts'],
      paths: ['a.ts', 'b.ts', 'c.ts'],
    });

    expect(controller.getSelectedPaths()).toEqual(['a.ts', 'c.ts']);
    expect(controller.getFocusedPath()).toBe('c.ts');

    controller.selectPathRange('b.ts', false);
    expect(controller.getSelectedPaths()).toEqual(['b.ts', 'c.ts']);

    controller.destroy();
  });

  test('controller focus helpers keep exactly one focused visible item', async () => {
    const FileTreeController = await loadFileTreeController();

    const controller = new FileTreeController({
      flattenEmptyDirectories: false,
      initialExpansion: 'open',
      paths: ['README.md', 'src/index.ts', 'src/lib/util.ts'],
    });

    const getFocusedPaths = () =>
      controller
        .getVisibleRows(0, controller.getVisibleCount() - 1)
        .filter((row) => row.isFocused)
        .map((row) => row.path);

    expect(getFocusedPaths()).toEqual(['src/']);

    controller.focusNextItem();
    expect(controller.getFocusedPath()).toBe('src/lib/');
    expect(getFocusedPaths()).toEqual(['src/lib/']);

    controller.focusLastItem();
    expect(controller.getFocusedPath()).toBe('README.md');
    expect(getFocusedPaths()).toEqual(['README.md']);

    controller.focusPreviousItem();
    expect(controller.getFocusedPath()).toBe('src/index.ts');

    controller.focusPath('src/lib/util.ts');
    expect(controller.getFocusedPath()).toBe('src/lib/util.ts');

    controller.focusParentItem();
    expect(controller.getFocusedPath()).toBe('src/lib/');

    controller.focusFirstItem();
    expect(controller.getFocusedPath()).toBe('src/');
    expect(getFocusedPaths()).toEqual(['src/']);

    controller.destroy();
  });

  test('resetPaths prunes stale selections and resets a hidden range anchor', async () => {
    const FileTreeController = await loadFileTreeController();

    const controller = new FileTreeController({
      flattenEmptyDirectories: false,
      initialExpansion: 'open',
      paths: ['a.ts', 'b.ts', 'c.ts'],
    });

    controller.selectOnlyPath('a.ts');
    controller.selectPathRange('c.ts', false);
    expect(controller.getSelectedPaths()).toEqual(['a.ts', 'b.ts', 'c.ts']);

    controller.resetPaths(['b.ts', 'd.ts']);
    expect(controller.getSelectedPaths()).toEqual(['b.ts']);

    controller.selectPathRange('d.ts', false);
    expect(controller.getSelectedPaths()).toEqual(['d.ts']);

    controller.destroy();
  });

  test('resetPaths canonicalizes selected paths when a file becomes a directory', async () => {
    const FileTreeController = await loadFileTreeController();

    // Start with "src/foo" as a plain file.
    const controller = new FileTreeController({
      flattenEmptyDirectories: false,
      initialExpansion: 'open',
      paths: ['src/foo'],
    });

    controller.selectOnlyPath('src/foo');
    expect(controller.getSelectedPaths()).toEqual(['src/foo']);

    // After a refresh "src/foo" is now a directory ("src/foo/") with a child.
    // The old selected path "src/foo" resolves to the new canonical "src/foo/"
    // via the trailing-slash fallback — resetPaths must store the resolved
    // canonical form so that visible-row selection checks match.
    controller.resetPaths(['src/foo/bar.ts']);
    expect(controller.getSelectedPaths()).toEqual(['src/foo/']);
    expect(controller.getItem('src/foo/')?.isSelected()).toBe(true);

    controller.destroy();
  });

  test('deep initialExpandedPaths expands ancestor directories in handle state and visible rows', async () => {
    const FileTreeController = await loadFileTreeController();

    const controller = new FileTreeController({
      flattenEmptyDirectories: false,
      initialExpandedPaths: ['src/lib'],
      paths: ['README.md', 'src/index.ts', 'src/lib/util.ts'],
    });

    const srcItem = controller.getItem('src');
    const libItem = controller.getItem('src/lib');

    if (
      srcItem == null ||
      srcItem.isDirectory() !== true ||
      !('isExpanded' in srcItem)
    ) {
      throw new Error('expected src directory item');
    }
    if (
      libItem == null ||
      libItem.isDirectory() !== true ||
      !('isExpanded' in libItem)
    ) {
      throw new Error('expected src/lib directory item');
    }

    expect(srcItem.isExpanded()).toBe(true);
    expect(libItem.isExpanded()).toBe(true);
    expect(controller.getVisibleRows(0, 10).map((row) => row.path)).toEqual([
      'src/',
      'src/lib/',
      'src/lib/util.ts',
      'src/index.ts',
      'README.md',
    ]);

    controller.destroy();
  });

  test('collapsing a parent directory preserves descendant expansion when the parent reopens', async () => {
    const FileTreeController = await loadFileTreeController();

    const controller = new FileTreeController({
      flattenEmptyDirectories: false,
      initialExpandedPaths: ['src/components/deep'],
      paths: [
        'README.md',
        'src/index.ts',
        'src/components/Other.tsx',
        'src/components/deep/Button.tsx',
        'src/components/deep/Card.tsx',
      ],
    });

    const componentsItem = controller.getItem('src/components');
    const deepItem = controller.getItem('src/components/deep');

    if (
      componentsItem == null ||
      componentsItem.isDirectory() !== true ||
      !('collapse' in componentsItem) ||
      !('expand' in componentsItem)
    ) {
      throw new Error('expected src/components directory item');
    }
    if (
      deepItem == null ||
      deepItem.isDirectory() !== true ||
      !('isExpanded' in deepItem)
    ) {
      throw new Error('expected src/components/deep directory item');
    }

    expect(deepItem.isExpanded()).toBe(true);
    expect(controller.getVisibleRows(0, 20).map((row) => row.path)).toContain(
      'src/components/deep/Button.tsx'
    );

    componentsItem.collapse();
    expect(deepItem.isExpanded()).toBe(true);
    expect(
      controller.getVisibleRows(0, 20).map((row) => row.path)
    ).not.toContain('src/components/deep/');

    componentsItem.expand();
    expect(deepItem.isExpanded()).toBe(true);
    expect(controller.getVisibleRows(0, 20).map((row) => row.path)).toContain(
      'src/components/deep/Button.tsx'
    );

    controller.destroy();
  });

  test('controller resolves sticky ancestor rows from actual visible rows', async () => {
    const FileTreeController = await loadFileTreeController();

    const controller = new FileTreeController({
      flattenEmptyDirectories: false,
      initialExpandedPaths: ['src/lib/'],
      paths: ['README.md', 'src/index.ts', 'src/lib/util.ts'],
    });

    const utilRow = controller
      .getVisibleRows(0, controller.getVisibleCount() - 1)
      .find((row) => row.path === 'src/lib/util.ts');
    if (utilRow == null) {
      throw new Error('expected src/lib/util.ts row');
    }

    expect(
      controller.getVisibleAncestorRows(utilRow.index).map((row) => row.path)
    ).toEqual(['src/', 'src/lib/']);

    controller.destroy();
  });

  test('controller resolves sticky ancestor rows for flattened rows', async () => {
    const FileTreeController = await loadFileTreeController();

    const controller = new FileTreeController({
      flattenEmptyDirectories: true,
      initialExpandedPaths: ['src/lib/'],
      paths: ['README.md', 'src/lib/util.ts', 'src/lib/helpers.ts'],
    });

    const utilRow = controller
      .getVisibleRows(0, controller.getVisibleCount() - 1)
      .find((row) => row.path === 'src/lib/util.ts');
    if (utilRow == null) {
      throw new Error('expected src/lib/util.ts row');
    }

    const stickyAncestorRows = controller.getVisibleAncestorRows(utilRow.index);
    expect(stickyAncestorRows.map((row) => row.path)).toEqual(['src/lib/']);
    expect(stickyAncestorRows[0]?.isFlattened).toBe(true);

    controller.destroy();
  });

  test('directory row collapses on the first click when initialExpandedPaths uses bare directory paths', async () => {
    const { cleanup, dom } = installDom();
    try {
      const FileTree = await loadFileTree();
      const containerWrapper = dom.window.document.createElement('div');
      dom.window.document.body.appendChild(containerWrapper);

      const fileTree = new FileTree({
        flattenEmptyDirectories: false,
        initialExpandedPaths: ['src'],
        paths: ['README.md', 'src/index.ts', 'src/lib/util.ts'],
        viewportHeight: 120,
      });

      fileTree.render({ containerWrapper });
      const shadowRoot = fileTree.getFileTreeContainer()?.shadowRoot;

      expect(shadowRoot?.innerHTML).toContain('src/index.ts');
      clickItem(shadowRoot, dom, 'src/');
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(shadowRoot?.innerHTML).not.toContain('src/index.ts');

      fileTree.cleanUp();
    } finally {
      cleanup();
    }
  });

  test('modified clicks recreate the baseline selection semantics in spirit', async () => {
    const { cleanup, dom } = installDom();
    try {
      const FileTree = await loadFileTree();
      const containerWrapper = dom.window.document.createElement('div');
      dom.window.document.body.appendChild(containerWrapper);

      const fileTree = new FileTree({
        flattenEmptyDirectories: false,
        paths: ['a.ts', 'b.ts', 'c.ts', 'd.ts'],
        viewportHeight: 120,
      });

      fileTree.render({ containerWrapper });
      const shadowRoot = fileTree.getFileTreeContainer()?.shadowRoot;

      clickItem(shadowRoot, dom, 'b.ts');
      await flushDom();
      expect(getSelectedItemPaths(shadowRoot, dom)).toEqual(['b.ts']);

      clickItem(shadowRoot, dom, 'd.ts', { shiftKey: true });
      await flushDom();
      expect(getSelectedItemPaths(shadowRoot, dom)).toEqual([
        'b.ts',
        'c.ts',
        'd.ts',
      ]);

      clickItem(shadowRoot, dom, 'a.ts', { metaKey: true, shiftKey: true });
      await flushDom();
      expect(getSelectedItemPaths(shadowRoot, dom)).toEqual([
        'a.ts',
        'b.ts',
        'c.ts',
        'd.ts',
      ]);

      clickItem(shadowRoot, dom, 'c.ts', { ctrlKey: true });
      await flushDom();
      expect(getSelectedItemPaths(shadowRoot, dom)).toEqual([
        'a.ts',
        'b.ts',
        'd.ts',
      ]);
      expect(fileTree.getItem('c.ts')?.isFocused()).toBe(true);

      fileTree.cleanUp();
    } finally {
      cleanup();
    }
  });

  test('keyboard selection hotkeys preserve focus continuity', async () => {
    const { cleanup, dom } = installDom();
    try {
      const FileTree = await loadFileTree();
      const containerWrapper = dom.window.document.createElement('div');
      dom.window.document.body.appendChild(containerWrapper);

      const fileTree = new FileTree({
        flattenEmptyDirectories: false,
        paths: ['a.ts', 'b.ts', 'c.ts'],
        viewportHeight: 120,
      });

      fileTree.render({ containerWrapper });
      const shadowRoot = fileTree.getFileTreeContainer()?.shadowRoot;
      const firstButton = getItemButton(shadowRoot, dom, 'a.ts');
      firstButton.focus();
      await flushDom();

      pressKey(firstButton, dom, ' ', { code: 'Space', ctrlKey: true });
      await flushDom();
      expect(getSelectedItemPaths(shadowRoot, dom)).toEqual(['a.ts']);

      pressKey(firstButton, dom, 'ArrowDown', { shiftKey: true });
      await flushDom();
      expect(getSelectedItemPaths(shadowRoot, dom)).toEqual(['a.ts', 'b.ts']);
      expect(fileTree.getItem('b.ts')?.isFocused()).toBe(true);

      pressKey(getItemButton(shadowRoot, dom, 'b.ts'), dom, 'ArrowDown', {
        shiftKey: true,
      });
      await flushDom();
      expect(getSelectedItemPaths(shadowRoot, dom)).toEqual([
        'a.ts',
        'b.ts',
        'c.ts',
      ]);
      expect(fileTree.getItem('c.ts')?.isFocused()).toBe(true);

      pressKey(getItemButton(shadowRoot, dom, 'c.ts'), dom, 'ArrowUp', {
        shiftKey: true,
      });
      await flushDom();
      expect(getSelectedItemPaths(shadowRoot, dom)).toEqual(['a.ts', 'b.ts']);
      expect(fileTree.getItem('b.ts')?.isFocused()).toBe(true);

      pressKey(getItemButton(shadowRoot, dom, 'b.ts'), dom, 'a', {
        ctrlKey: true,
      });
      await flushDom();
      expect(getSelectedItemPaths(shadowRoot, dom)).toEqual([
        'a.ts',
        'b.ts',
        'c.ts',
      ]);

      fileTree.cleanUp();
    } finally {
      cleanup();
    }
  });

  test('Shift+Arrow from an unselected focused row selects only the next row', async () => {
    const { cleanup, dom } = installDom();
    try {
      const FileTree = await loadFileTree();
      const containerWrapper = dom.window.document.createElement('div');
      dom.window.document.body.appendChild(containerWrapper);

      const fileTree = new FileTree({
        flattenEmptyDirectories: false,
        paths: ['a.ts', 'b.ts', 'c.ts'],
        viewportHeight: 120,
      });

      fileTree.render({ containerWrapper });
      const shadowRoot = fileTree.getFileTreeContainer()?.shadowRoot;
      const firstButton = getItemButton(shadowRoot, dom, 'a.ts');
      firstButton.focus();
      await flushDom();

      pressKey(firstButton, dom, 'ArrowDown', { shiftKey: true });
      await flushDom();

      expect(getSelectedItemPaths(shadowRoot, dom)).toEqual(['b.ts']);
      expect(fileTree.getItem('b.ts')?.isFocused()).toBe(true);

      fileTree.cleanUp();
    } finally {
      cleanup();
    }
  });

  test('Ctrl+Space seeds the range anchor for a later Shift-click', async () => {
    const { cleanup, dom } = installDom();
    try {
      const FileTree = await loadFileTree();
      const containerWrapper = dom.window.document.createElement('div');
      dom.window.document.body.appendChild(containerWrapper);

      const fileTree = new FileTree({
        flattenEmptyDirectories: false,
        paths: ['a.ts', 'b.ts', 'c.ts', 'd.ts'],
        viewportHeight: 120,
      });

      fileTree.render({ containerWrapper });
      const shadowRoot = fileTree.getFileTreeContainer()?.shadowRoot;
      const firstButton = getItemButton(shadowRoot, dom, 'a.ts');
      firstButton.focus();
      await flushDom();

      pressKey(firstButton, dom, ' ', { code: 'Space', ctrlKey: true });
      await flushDom();
      expect(getSelectedItemPaths(shadowRoot, dom)).toEqual(['a.ts']);

      clickItem(shadowRoot, dom, 'd.ts', { shiftKey: true });
      await flushDom();
      expect(getSelectedItemPaths(shadowRoot, dom)).toEqual([
        'a.ts',
        'b.ts',
        'c.ts',
        'd.ts',
      ]);

      fileTree.cleanUp();
    } finally {
      cleanup();
    }
  });

  test('Shift-click without an existing anchor falls back to single selection', async () => {
    const { cleanup, dom } = installDom();
    try {
      const FileTree = await loadFileTree();
      const containerWrapper = dom.window.document.createElement('div');
      dom.window.document.body.appendChild(containerWrapper);

      const fileTree = new FileTree({
        flattenEmptyDirectories: false,
        paths: ['a.ts', 'b.ts', 'c.ts'],
        viewportHeight: 120,
      });

      fileTree.render({ containerWrapper });
      const shadowRoot = fileTree.getFileTreeContainer()?.shadowRoot;

      clickItem(shadowRoot, dom, 'c.ts', { shiftKey: true });
      await flushDom();

      expect(getSelectedItemPaths(shadowRoot, dom)).toEqual(['c.ts']);

      fileTree.cleanUp();
    } finally {
      cleanup();
    }
  });

  test('repeated Shift-clicks contract and extend the same anchored range', async () => {
    const { cleanup, dom } = installDom();
    try {
      const FileTree = await loadFileTree();
      const containerWrapper = dom.window.document.createElement('div');
      dom.window.document.body.appendChild(containerWrapper);

      const fileTree = new FileTree({
        flattenEmptyDirectories: false,
        paths: ['a.ts', 'b.ts', 'c.ts', 'd.ts', 'e.ts'],
        viewportHeight: 120,
      });

      fileTree.render({ containerWrapper });
      const shadowRoot = fileTree.getFileTreeContainer()?.shadowRoot;

      clickItem(shadowRoot, dom, 'a.ts');
      await flushDom();
      clickItem(shadowRoot, dom, 'd.ts', { shiftKey: true });
      await flushDom();
      expect(getSelectedItemPaths(shadowRoot, dom)).toEqual([
        'a.ts',
        'b.ts',
        'c.ts',
        'd.ts',
      ]);

      clickItem(shadowRoot, dom, 'b.ts', { shiftKey: true });
      await flushDom();
      expect(getSelectedItemPaths(shadowRoot, dom)).toEqual(['a.ts', 'b.ts']);

      clickItem(shadowRoot, dom, 'e.ts', { shiftKey: true });
      await flushDom();
      expect(getSelectedItemPaths(shadowRoot, dom)).toEqual([
        'a.ts',
        'b.ts',
        'c.ts',
        'd.ts',
        'e.ts',
      ]);

      fileTree.cleanUp();
    } finally {
      cleanup();
    }
  });

  test('reselecting the same selection set does not emit duplicate change callbacks', async () => {
    const { cleanup, dom } = installDom();
    try {
      const FileTree = await loadFileTree();
      const containerWrapper = dom.window.document.createElement('div');
      dom.window.document.body.appendChild(containerWrapper);
      const selectionEvents: string[][] = [];

      const fileTree = new FileTree({
        flattenEmptyDirectories: false,
        onSelectionChange: (selectedPaths) => {
          selectionEvents.push([...selectedPaths]);
        },
        paths: ['a.ts', 'b.ts', 'c.ts'],
        viewportHeight: 120,
      });

      fileTree.render({ containerWrapper });
      const shadowRoot = fileTree.getFileTreeContainer()?.shadowRoot;

      clickItem(shadowRoot, dom, 'b.ts');
      await flushDom();
      clickItem(shadowRoot, dom, 'b.ts');
      await flushDom();

      expect(selectionEvents).toEqual([['b.ts']]);

      fileTree.cleanUp();
    } finally {
      cleanup();
    }
  });

  test('selection change callbacks stay path-first and selection survives collapse/remount with explicit anchor fallback', async () => {
    const { cleanup, dom } = installDom();
    try {
      const FileTree = await loadFileTree();
      const containerWrapper = dom.window.document.createElement('div');
      dom.window.document.body.appendChild(containerWrapper);
      const selectionEvents: string[][] = [];

      const fileTree = new FileTree({
        flattenEmptyDirectories: false,
        initialExpandedPaths: ['src/lib/'],
        onSelectionChange: (items) => {
          selectionEvents.push([...items]);
        },
        paths: ['README.md', 'src/index.ts', 'src/lib/util.ts'],
        viewportHeight: 120,
      });

      fileTree.render({ containerWrapper });
      const shadowRoot = fileTree.getFileTreeContainer()?.shadowRoot;

      clickItem(shadowRoot, dom, 'src/lib/util.ts');
      await flushDom();
      expect(fileTree.getSelectedPaths()).toEqual(['src/lib/util.ts']);
      expect(selectionEvents.at(-1)).toEqual(['src/lib/util.ts']);

      const sourceDirectory = fileTree.getItem('src/lib/');
      if (
        sourceDirectory == null ||
        sourceDirectory.isDirectory() !== true ||
        !('collapse' in sourceDirectory)
      ) {
        throw new Error('missing source directory item');
      }

      sourceDirectory.collapse();
      await flushDom();
      expect(fileTree.getSelectedPaths()).toEqual(['src/lib/util.ts']);
      expect(getSelectedItemPaths(shadowRoot, dom)).toEqual([]);

      sourceDirectory.expand();
      await flushDom();
      expect(
        getItemButton(shadowRoot, dom, 'src/lib/util.ts').dataset.itemSelected
      ).toBe('true');

      sourceDirectory.collapse();
      await flushDom();
      clickItem(shadowRoot, dom, 'README.md', { shiftKey: true });
      await flushDom();
      expect(fileTree.getSelectedPaths()).toEqual(['README.md']);
      expect(selectionEvents.at(-1)).toEqual(['README.md']);

      fileTree.cleanUp();
    } finally {
      cleanup();
    }
  });

  test('Ctrl+A selects only currently visible rows', async () => {
    const { cleanup, dom } = installDom();
    try {
      const FileTree = await loadFileTree();
      const containerWrapper = dom.window.document.createElement('div');
      dom.window.document.body.appendChild(containerWrapper);

      const fileTree = new FileTree({
        flattenEmptyDirectories: false,
        initialExpansion: 0,
        paths: ['README.md', 'src/index.ts', 'src/lib/util.ts'],
        viewportHeight: 120,
      });

      fileTree.render({ containerWrapper });
      const shadowRoot = fileTree.getFileTreeContainer()?.shadowRoot;
      const sourceButton = getItemButton(shadowRoot, dom, 'src/');
      sourceButton.focus();
      await flushDom();

      pressKey(sourceButton, dom, 'a', { ctrlKey: true });
      await flushDom();
      expect(getSelectedItemPaths(shadowRoot, dom)).toEqual([
        'src/',
        'README.md',
      ]);

      fileTree.cleanUp();
    } finally {
      cleanup();
    }
  });

  test('Ctrl+A keeps the focused row as the next Shift-click anchor', async () => {
    const { cleanup, dom } = installDom();
    try {
      const FileTree = await loadFileTree();
      const containerWrapper = dom.window.document.createElement('div');
      dom.window.document.body.appendChild(containerWrapper);

      const fileTree = new FileTree({
        flattenEmptyDirectories: false,
        paths: ['a.ts', 'b.ts', 'c.ts', 'd.ts'],
        viewportHeight: 120,
      });

      fileTree.render({ containerWrapper });
      const shadowRoot = fileTree.getFileTreeContainer()?.shadowRoot;
      const secondButton = getItemButton(shadowRoot, dom, 'b.ts');
      secondButton.focus();
      await flushDom();

      pressKey(secondButton, dom, 'a', { ctrlKey: true });
      await flushDom();
      expect(getSelectedItemPaths(shadowRoot, dom)).toEqual([
        'a.ts',
        'b.ts',
        'c.ts',
        'd.ts',
      ]);

      clickItem(shadowRoot, dom, 'c.ts', { shiftKey: true });
      await flushDom();
      expect(getSelectedItemPaths(shadowRoot, dom)).toEqual(['b.ts', 'c.ts']);

      fileTree.cleanUp();
    } finally {
      cleanup();
    }
  });

  test('selection persists across virtualization and selected markup returns on remount', async () => {
    const { cleanup, dom } = installDom();
    try {
      const FileTree = await loadFileTree();
      const containerWrapper = dom.window.document.createElement('div');
      dom.window.document.body.appendChild(containerWrapper);

      const paths = Array.from(
        { length: 120 },
        (_, index) => `item${String(index).padStart(3, '0')}.ts`
      );
      const fileTree = new FileTree({
        flattenEmptyDirectories: false,
        paths,
        viewportHeight: 120,
      });

      fileTree.render({ containerWrapper });
      const shadowRoot = fileTree.getFileTreeContainer()?.shadowRoot;
      const scrollElement = shadowRoot?.querySelector(
        '[data-file-tree-virtualized-scroll="true"]'
      );
      if (!(scrollElement instanceof dom.window.HTMLElement)) {
        throw new Error('missing scroll element');
      }

      const viewport = scrollElement;
      viewport.scrollTop = 1500;
      viewport.dispatchEvent(new dom.window.Event('scroll'));
      await flushDom();

      clickItem(shadowRoot, dom, 'item050.ts');
      await flushDom();
      expect(fileTree.getSelectedPaths()).toEqual(['item050.ts']);
      expect(
        getItemButton(shadowRoot, dom, 'item050.ts').dataset.itemSelected
      ).toBe('true');

      viewport.scrollTop = 3000;
      viewport.dispatchEvent(new dom.window.Event('scroll'));
      await flushDom();
      await flushDom();

      expect(fileTree.getSelectedPaths()).toEqual(['item050.ts']);
      expect(getSelectedItemPaths(shadowRoot, dom)).toEqual([]);

      viewport.scrollTop = 1500;
      viewport.dispatchEvent(new dom.window.Event('scroll'));
      await flushDom();
      await flushDom();

      expect(
        getItemButton(shadowRoot, dom, 'item050.ts').dataset.itemSelected
      ).toBe('true');

      fileTree.cleanUp();
    } finally {
      cleanup();
    }
  });

  test('computes a stable window range, sticky layout, and inset-reserved layout', () => {
    const initialRange = computeWindowRange({
      itemCount: 200,
      itemHeight: FILE_TREE_DEFAULT_ITEM_HEIGHT,
      overscan: FILE_TREE_DEFAULT_OVERSCAN,
      scrollTop: 0,
      viewportHeight: FILE_TREE_DEFAULT_VIEWPORT_HEIGHT,
    });
    const scrolledRange = computeWindowRange(
      {
        itemCount: 200,
        itemHeight: FILE_TREE_DEFAULT_ITEM_HEIGHT,
        overscan: FILE_TREE_DEFAULT_OVERSCAN,
        scrollTop: 1800,
        viewportHeight: FILE_TREE_DEFAULT_VIEWPORT_HEIGHT,
      },
      initialRange
    );
    const layout = computeStickyWindowLayout({
      itemCount: 200,
      itemHeight: FILE_TREE_DEFAULT_ITEM_HEIGHT,
      range: scrolledRange,
      viewportHeight: FILE_TREE_DEFAULT_VIEWPORT_HEIGHT,
    });
    const insetLayout = computeInsetWindowLayout({
      currentRange: scrolledRange,
      itemCount: 200,
      itemHeight: FILE_TREE_DEFAULT_ITEM_HEIGHT,
      overscan: FILE_TREE_DEFAULT_OVERSCAN,
      scrollTop: 1800,
      topInset: FILE_TREE_DEFAULT_ITEM_HEIGHT * 3,
      viewportHeight: FILE_TREE_DEFAULT_VIEWPORT_HEIGHT,
    });
    const clampedInsetLayout = computeInsetWindowLayout({
      itemCount: 6,
      itemHeight: FILE_TREE_DEFAULT_ITEM_HEIGHT,
      overscan: 0,
      scrollTop: 150,
      topInset: FILE_TREE_DEFAULT_ITEM_HEIGHT * 4,
      viewportHeight: FILE_TREE_DEFAULT_ITEM_HEIGHT,
    });

    expect(initialRange.start).toBe(0);
    expect(scrolledRange.start).toBeGreaterThan(0);
    expect(scrolledRange.end).toBeGreaterThan(scrolledRange.start);
    expect(layout.totalHeight).toBe(200 * FILE_TREE_DEFAULT_ITEM_HEIGHT);
    expect(layout.offsetHeight).toBe(
      scrolledRange.start * FILE_TREE_DEFAULT_ITEM_HEIGHT
    );
    expect(insetLayout.totalHeight).toBe(layout.totalHeight);
    expect(insetLayout.windowRange).toEqual(scrolledRange);
    expect(insetLayout.topInset).toBe(FILE_TREE_DEFAULT_ITEM_HEIGHT * 3);
    expect(insetLayout.offsetHeight).toBe(
      scrolledRange.start * FILE_TREE_DEFAULT_ITEM_HEIGHT +
        FILE_TREE_DEFAULT_ITEM_HEIGHT * 3
    );
    expect(insetLayout.contentHeight).toBe(layout.windowHeight);
    expect(insetLayout.windowHeight + insetLayout.topInset).toBe(
      insetLayout.contentHeight
    );
    expect(insetLayout.stickyInset).toBe(
      Math.min(0, FILE_TREE_DEFAULT_VIEWPORT_HEIGHT - insetLayout.contentHeight)
    );
    expect(clampedInsetLayout.topInset).toBe(0);
  });

  test('computes first visible index with clamping', () => {
    expect(
      computeFirstVisibleIndex({
        itemCount: 0,
        itemHeight: FILE_TREE_DEFAULT_ITEM_HEIGHT,
        scrollTop: 0,
        topInset: 0,
      })
    ).toBe(-1);
    expect(
      computeFirstVisibleIndex({
        itemCount: 10,
        itemHeight: FILE_TREE_DEFAULT_ITEM_HEIGHT,
        scrollTop: -30,
        topInset: 0,
      })
    ).toBe(0);
    expect(
      computeFirstVisibleIndex({
        itemCount: 10,
        itemHeight: FILE_TREE_DEFAULT_ITEM_HEIGHT,
        scrollTop: 89,
        topInset: 0,
      })
    ).toBe(2);
    expect(
      computeFirstVisibleIndex({
        itemCount: 10,
        itemHeight: FILE_TREE_DEFAULT_ITEM_HEIGHT,
        scrollTop: 999,
        topInset: 0,
      })
    ).toBe(9);
    expect(
      computeFirstVisibleIndex({
        itemCount: 3,
        itemHeight: FILE_TREE_DEFAULT_ITEM_HEIGHT,
        scrollTop: 0,
        topInset: 120,
      })
    ).toBe(2);
  });

  test('sticky overlay mirrors visible ancestor rows and respects opt-out', async () => {
    const { cleanup, dom } = installDom();
    try {
      const FileTree = await loadFileTree();
      const containerWrapper = dom.window.document.createElement('div');
      dom.window.document.body.appendChild(containerWrapper);

      const fileTree = new FileTree({
        flattenEmptyDirectories: false,
        initialExpandedPaths: ['src/lib/'],
        paths: ['README.md', 'src/index.ts', 'src/lib/util.ts'],
        viewportHeight: 60,
      });

      fileTree.render({ containerWrapper });
      await flushDom();

      const shadowRoot = fileTree.getFileTreeContainer()?.shadowRoot;
      const scrollElement = shadowRoot?.querySelector(
        '[data-file-tree-virtualized-scroll="true"]'
      );
      if (!(scrollElement instanceof dom.window.HTMLElement)) {
        throw new Error('missing scroll element');
      }

      expect(getStickyRowPaths(shadowRoot, dom)).toEqual([]);

      scrollElement.scrollTop = 60;
      scrollElement.dispatchEvent(new dom.window.Event('scroll'));
      await flushDom();

      expect(getStickyRowPaths(shadowRoot, dom)).toEqual(['src/lib/']);

      fileTree.cleanUp();

      const optOutWrapper = dom.window.document.createElement('div');
      dom.window.document.body.appendChild(optOutWrapper);
      const optOutTree = new FileTree({
        flattenEmptyDirectories: false,
        initialExpandedPaths: ['src/lib/'],
        paths: ['README.md', 'src/index.ts', 'src/lib/util.ts'],
        stickyFolders: false,
        viewportHeight: 60,
      });

      optOutTree.render({ containerWrapper: optOutWrapper });
      await flushDom();
      expect(
        optOutTree
          .getFileTreeContainer()
          ?.shadowRoot?.querySelector('[data-file-tree-sticky-overlay="true"]')
      ).toBeNull();

      optOutTree.cleanUp();
    } finally {
      cleanup();
    }
  });

  test('sticky folders start sticking on partial occlusion instead of waiting for full occlusion', async () => {
    const { cleanup, dom } = installDom();
    try {
      const FileTree = await loadFileTree();
      const containerWrapper = dom.window.document.createElement('div');
      dom.window.document.body.appendChild(containerWrapper);

      const fileTree = new FileTree({
        flattenEmptyDirectories: false,
        initialExpandedPaths: ['src/lib/'],
        paths: ['README.md', 'src/index.ts', 'src/lib/util.ts', 'zzz.ts'],
        viewportHeight: 120,
      });

      fileTree.render({ containerWrapper });
      await flushDom();

      const shadowRoot = fileTree.getFileTreeContainer()?.shadowRoot;
      const scrollElement = shadowRoot?.querySelector(
        '[data-file-tree-virtualized-scroll="true"]'
      );
      if (!(scrollElement instanceof dom.window.HTMLElement)) {
        throw new Error('missing scroll element');
      }

      expect(getStickyRowPaths(shadowRoot, dom)).toEqual([]);

      scrollElement.scrollTop = 1;
      scrollElement.dispatchEvent(new dom.window.Event('scroll'));
      await flushDom();
      expect(getStickyRowPaths(shadowRoot, dom)).toEqual(['src/']);
      expect(getMountedItemPaths(shadowRoot, dom)).not.toContain('src/');

      scrollElement.scrollTop = 30;
      scrollElement.dispatchEvent(new dom.window.Event('scroll'));
      await flushDom();
      expect(getStickyRowPaths(shadowRoot, dom)).toEqual(['src/']);
      expect(getMountedItemPaths(shadowRoot, dom)).not.toContain('src/');

      scrollElement.scrollTop = 31;
      scrollElement.dispatchEvent(new dom.window.Event('scroll'));
      await flushDom();
      expect(getStickyRowPaths(shadowRoot, dom)).toEqual(['src/', 'src/lib/']);
      expect(getMountedItemPaths(shadowRoot, dom)).not.toContain('src/');
      expect(getMountedItemPaths(shadowRoot, dom)).not.toContain('src/lib/');

      fileTree.cleanUp();
    } finally {
      cleanup();
    }
  });

  test('sticky overlay reserves virtual layout space without changing total height or scrollTop', async () => {
    const { cleanup, dom } = installDom();
    try {
      const FileTree = await loadFileTree();
      const FileTreeController = await loadFileTreeController();
      const options = {
        flattenEmptyDirectories: false,
        initialExpandedPaths: ['src/lib/'],
        paths: ['README.md', 'src/index.ts', 'src/lib/util.ts'],
        viewportHeight: 60,
      } as const;
      const expectedController = new FileTreeController(options);
      const expectedTotalHeight =
        expectedController.getVisibleCount() * FILE_TREE_DEFAULT_ITEM_HEIGHT;

      const containerWrapper = dom.window.document.createElement('div');
      dom.window.document.body.appendChild(containerWrapper);
      const fileTree = new FileTree(options);

      fileTree.render({ containerWrapper });
      await flushDom();

      const shadowRoot = fileTree.getFileTreeContainer()?.shadowRoot;
      const scrollElement = shadowRoot?.querySelector(
        '[data-file-tree-virtualized-scroll="true"]'
      );
      if (!(scrollElement instanceof dom.window.HTMLElement)) {
        throw new Error('missing scroll element');
      }

      scrollElement.scrollTop = 60;
      scrollElement.dispatchEvent(new dom.window.Event('scroll'));
      await flushDom();

      const stickyPaths = getStickyRowPaths(shadowRoot, dom);
      const stickyOverlayHeight =
        stickyPaths.length * FILE_TREE_DEFAULT_ITEM_HEIGHT;
      const layout = computeInsetWindowLayout({
        itemCount: expectedController.getVisibleCount(),
        itemHeight: FILE_TREE_DEFAULT_ITEM_HEIGHT,
        overscan: FILE_TREE_DEFAULT_OVERSCAN,
        scrollTop: scrollElement.scrollTop,
        topInset: stickyOverlayHeight,
        viewportHeight: 60,
      });

      expect(scrollElement.scrollTop).toBe(60);
      expect(stickyPaths).toEqual(['src/lib/']);
      expect(layout.firstVisibleIndex).toBe(
        expectedController.getVisibleIndex('src/lib/util.ts')
      );
      expect(
        getPixelStyleValue(getVirtualList(shadowRoot, dom), 'height')
      ).toBe(expectedTotalHeight);
      expect(
        getPixelStyleValue(getVirtualStickyOffset(shadowRoot, dom), 'height')
      ).toBe(layout.offsetHeight);
      expect(
        getPixelStyleValue(getVirtualStickyWindow(shadowRoot, dom), 'height')
      ).toBe(layout.windowHeight);
      expect(
        getPixelStyleValue(getVirtualStickyWindow(shadowRoot, dom), 'top')
      ).toBe(layout.stickyInset);
      expect(
        getPixelStyleValue(getVirtualStickyWindow(shadowRoot, dom), 'bottom')
      ).toBe(layout.stickyInset);

      scrollElement.scrollTop = 30;
      scrollElement.dispatchEvent(new dom.window.Event('scroll'));
      await flushDom();

      expect(scrollElement.scrollTop).toBe(30);
      expect(getStickyRowPaths(shadowRoot, dom)).toEqual(['src/']);
      expect(
        getPixelStyleValue(getVirtualList(shadowRoot, dom), 'height')
      ).toBe(expectedTotalHeight);

      fileTree.cleanUp();
      expectedController.destroy();
    } finally {
      cleanup();
    }
  });

  test('keyboard focus scrolling respects sticky overlay height', async () => {
    const { cleanup, dom } = installDom();
    try {
      const FileTree = await loadFileTree();
      const containerWrapper = dom.window.document.createElement('div');
      dom.window.document.body.appendChild(containerWrapper);

      const fileTree = new FileTree({
        flattenEmptyDirectories: false,
        initialExpandedPaths: ['src/lib/'],
        paths: ['README.md', 'src/index.ts', 'src/lib/util.ts'],
        viewportHeight: 120,
      });

      fileTree.render({ containerWrapper });
      await flushDom();

      const shadowRoot = fileTree.getFileTreeContainer()?.shadowRoot;
      const scrollElement = shadowRoot?.querySelector(
        '[data-file-tree-virtualized-scroll="true"]'
      );
      if (!(scrollElement instanceof dom.window.HTMLElement)) {
        throw new Error('missing scroll element');
      }

      scrollElement.scrollTop = 30;
      scrollElement.dispatchEvent(new dom.window.Event('scroll'));
      await flushDom();
      expect(getStickyRowPaths(shadowRoot, dom)).toEqual(['src/']);

      const fileButton = getItemButton(shadowRoot, dom, 'src/lib/util.ts');
      fileButton.focus();
      await flushDom();

      pressKey(fileButton, dom, 'ArrowUp');
      await flushDom();
      await flushDom();

      expect(fileTree.getItem('src/lib/')?.isFocused()).toBe(true);
      expect(scrollElement.scrollTop).toBe(0);
      expect(getStickyRowPaths(shadowRoot, dom)).toEqual([]);
      expect(getFocusedTreeElement(shadowRoot, dom)?.dataset.itemPath).toBe(
        'src/lib/'
      );

      fileTree.cleanUp();
    } finally {
      cleanup();
    }
  });

  test('sticky row clicks scroll the real row into view, focus it, and preserve selection', async () => {
    const { cleanup, dom } = installDom();
    try {
      const FileTree = await loadFileTree();
      const FileTreeController = await loadFileTreeController();
      const clickOptions = {
        flattenEmptyDirectories: false,
        initialExpandedPaths: ['aaa/', 'bbb/', 'src/lib/'],
        paths: ['aaa/one.ts', 'bbb/two.ts', 'src/index.ts', 'src/lib/util.ts'],
        viewportHeight: 60,
      } as const;
      const expectedController = new FileTreeController(clickOptions);
      expect(
        expectedController.getVisibleIndex('src/lib/')
      ).toBeGreaterThanOrEqual(0);
      expectedController.destroy();

      const containerWrapper = dom.window.document.createElement('div');
      dom.window.document.body.appendChild(containerWrapper);

      const fileTree = new FileTree(clickOptions);

      fileTree.render({ containerWrapper });
      await flushDom();

      const shadowRoot = fileTree.getFileTreeContainer()?.shadowRoot;
      const scrollElement = shadowRoot?.querySelector(
        '[data-file-tree-virtualized-scroll="true"]'
      );
      if (!(scrollElement instanceof dom.window.HTMLElement)) {
        throw new Error('missing scroll element');
      }

      clickItem(shadowRoot, dom, 'src/lib/util.ts');
      await flushDom();
      expect(fileTree.getSelectedPaths()).toEqual(['src/lib/util.ts']);

      scrollElement.scrollTop = 180;
      scrollElement.dispatchEvent(new dom.window.Event('scroll'));
      await flushDom();

      expect(getStickyRowPaths(shadowRoot, dom)).toEqual(['src/lib/']);

      clickStickyRow(shadowRoot, dom, 'src/lib/');
      await flushDom();
      await flushDom();

      expect(scrollElement.scrollTop).toBeLessThan(180);
      expect(getFocusedTreeElement(shadowRoot, dom)?.dataset.itemPath).toBe(
        'src/lib/'
      );
      expect(
        getItemButton(shadowRoot, dom, 'src/lib/').dataset.itemParked
      ).not.toBe('true');
      expect(fileTree.getSelectedPaths()).toEqual(['src/lib/util.ts']);

      fileTree.cleanUp();
    } finally {
      cleanup();
    }
  });

  test('flattened sticky row clicks target the flattened row only', async () => {
    const { cleanup, dom } = installDom();
    try {
      const FileTree = await loadFileTree();
      const FileTreeController = await loadFileTreeController();
      const clickOptions = {
        flattenEmptyDirectories: true,
        initialExpandedPaths: ['aaa/', 'src/lib/'],
        paths: ['aaa/one.ts', 'src/lib/util.ts', 'src/lib/helpers.ts'],
        viewportHeight: 60,
      } as const;
      const expectedController = new FileTreeController(clickOptions);
      const expectedScrollTop = Math.max(
        0,
        expectedController.getVisibleIndex('src/lib/') *
          FILE_TREE_DEFAULT_ITEM_HEIGHT -
          FILE_TREE_DEFAULT_ITEM_HEIGHT
      );
      expectedController.destroy();

      const containerWrapper = dom.window.document.createElement('div');
      dom.window.document.body.appendChild(containerWrapper);

      const fileTree = new FileTree(clickOptions);

      fileTree.render({ containerWrapper });
      await flushDom();

      const shadowRoot = fileTree.getFileTreeContainer()?.shadowRoot;
      const scrollElement = shadowRoot?.querySelector(
        '[data-file-tree-virtualized-scroll="true"]'
      );
      if (!(scrollElement instanceof dom.window.HTMLElement)) {
        throw new Error('missing scroll element');
      }

      clickItem(shadowRoot, dom, 'src/lib/util.ts');
      await flushDom();
      expect(fileTree.getSelectedPaths()).toEqual(['src/lib/util.ts']);

      scrollElement.scrollTop = 90;
      scrollElement.dispatchEvent(new dom.window.Event('scroll'));
      await flushDom();

      expect(getStickyRowPaths(shadowRoot, dom)).toEqual(['src/lib/']);

      clickStickyRow(shadowRoot, dom, 'src/lib/');
      await flushDom();
      await flushDom();

      expect(scrollElement.scrollTop).toBe(expectedScrollTop);
      expect(getFocusedTreeElement(shadowRoot, dom)?.dataset.itemPath).toBe(
        'src/lib/'
      );
      expect(fileTree.getSelectedPaths()).toEqual(['src/lib/util.ts']);

      fileTree.cleanUp();
    } finally {
      cleanup();
    }
  });

  test('sticky overlay mirrors flattened row content', async () => {
    const { cleanup, dom } = installDom();
    try {
      const FileTree = await loadFileTree();
      const containerWrapper = dom.window.document.createElement('div');
      dom.window.document.body.appendChild(containerWrapper);

      const fileTree = new FileTree({
        flattenEmptyDirectories: true,
        initialExpandedPaths: ['src/lib/'],
        paths: ['README.md', 'src/lib/util.ts', 'src/lib/helpers.ts'],
        viewportHeight: 60,
      });

      fileTree.render({ containerWrapper });
      await flushDom();

      const shadowRoot = fileTree.getFileTreeContainer()?.shadowRoot;
      const scrollElement = shadowRoot?.querySelector(
        '[data-file-tree-virtualized-scroll="true"]'
      );
      if (!(scrollElement instanceof dom.window.HTMLElement)) {
        throw new Error('missing scroll element');
      }
      const expectedContentText = getNormalizedText(
        getItemButton(shadowRoot, dom, 'src/lib/').querySelector(
          '[data-item-section="content"]'
        )
      );

      scrollElement.scrollTop = 30;
      scrollElement.dispatchEvent(new dom.window.Event('scroll'));
      await flushDom();

      expect(getStickyRowPaths(shadowRoot, dom)).toEqual(['src/lib/']);
      expect(getMountedItemPaths(shadowRoot, dom)).not.toContain('src/lib/');
      const stickyRow = shadowRoot?.querySelector(
        '[data-file-tree-sticky-path="src/lib/"] [data-item-section="content"]'
      );
      expect(getNormalizedText(stickyRow)).toBe(expectedContentText);

      fileTree.cleanUp();
    } finally {
      cleanup();
    }
  });

  test('sticky overlay stays capped by visible space and still honors maxStickyFolderDepth', async () => {
    const { cleanup, dom } = installDom();
    try {
      const FileTree = await loadFileTree();
      const deepPaths = [
        'a/b/c/d/e/file.ts',
        ...Array.from({ length: 10 }, (_, index) => `z${index}.ts`),
      ];

      const defaultWrapper = dom.window.document.createElement('div');
      dom.window.document.body.appendChild(defaultWrapper);
      const defaultTree = new FileTree({
        flattenEmptyDirectories: false,
        initialExpandedPaths: ['a/b/c/d/e/'],
        paths: deepPaths,
        viewportHeight: 120,
      });

      defaultTree.render({ containerWrapper: defaultWrapper });
      await flushDom();

      const defaultShadowRoot = defaultTree.getFileTreeContainer()?.shadowRoot;
      const defaultScrollElement = defaultShadowRoot?.querySelector(
        '[data-file-tree-virtualized-scroll="true"]'
      );
      if (!(defaultScrollElement instanceof dom.window.HTMLElement)) {
        throw new Error('missing default scroll element');
      }

      defaultScrollElement.scrollTop = 150;
      defaultScrollElement.dispatchEvent(new dom.window.Event('scroll'));
      await flushDom();

      expect(getStickyRowPaths(defaultShadowRoot, dom)).toEqual([
        'a/b/c/',
        'a/b/c/d/',
        'a/b/c/d/e/',
      ]);

      defaultTree.cleanUp();

      const customWrapper = dom.window.document.createElement('div');
      dom.window.document.body.appendChild(customWrapper);
      const customTree = new FileTree({
        flattenEmptyDirectories: false,
        initialExpandedPaths: ['a/b/c/d/e/'],
        maxStickyFolderDepth: 2,
        paths: deepPaths,
        viewportHeight: 120,
      });

      customTree.render({ containerWrapper: customWrapper });
      await flushDom();

      const customShadowRoot = customTree.getFileTreeContainer()?.shadowRoot;
      const customScrollElement = customShadowRoot?.querySelector(
        '[data-file-tree-virtualized-scroll="true"]'
      );
      if (!(customScrollElement instanceof dom.window.HTMLElement)) {
        throw new Error('missing custom scroll element');
      }

      customScrollElement.scrollTop = 150;
      customScrollElement.dispatchEvent(new dom.window.Event('scroll'));
      await flushDom();

      expect(getStickyRowPaths(customShadowRoot, dom)).toEqual([
        'a/b/c/d/',
        'a/b/c/d/e/',
      ]);

      customTree.cleanUp();
    } finally {
      cleanup();
    }
  });

  test('preloadFileTree returns SSR-safe initial html', async () => {
    const preloadFileTree = await loadPreloadFileTree();

    const payload = preloadFileTree({
      flattenEmptyDirectories: true,
      initialExpansion: 'open',
      paths: ['README.md', 'src/index.ts', 'src/lib/utils.ts'],
      viewportHeight: 120,
    });

    expect(payload.html).toContain('<file-tree-container');
    expect(payload.shadowHtml).toContain(
      'data-file-tree-virtualized-root="true"'
    );
    expect(payload.shadowHtml).not.toContain(
      'data-file-tree-sticky-overlay="true"'
    );
    expect(payload.shadowHtml).toContain('README.md');
  });

  test('preloadFileTree includes initial selected row attributes', async () => {
    const preloadFileTree = await loadPreloadFileTree();

    const payload = preloadFileTree({
      flattenEmptyDirectories: true,
      initialExpansion: 'open',
      initialSelectedPaths: ['README.md'],
      paths: ['README.md', 'src/index.ts', 'src/lib/utils.ts'],
      viewportHeight: 120,
    });

    expect(payload.shadowHtml).toMatch(
      /aria-selected="true"[^>]*data-item-path="README\.md"[^>]*data-item-selected="true"/
    );
  });

  test('initialSelectedPaths preserve selected and focused state through preload and hydrate', async () => {
    const { cleanup, dom } = installDom();
    try {
      const preloadFileTree = await loadPreloadFileTree();
      const FileTree = await loadFileTree();
      const options = {
        flattenEmptyDirectories: false,
        id: 'pst-hydrate-initial-selection',
        initialExpansion: 'open',
        initialSelectedPaths: ['a.ts', 'c.ts'],
        paths: ['a.ts', 'b.ts', 'c.ts'],
        viewportHeight: 120,
      } satisfies ConstructorParameters<typeof FileTree>[0];
      const payload = preloadFileTree(options);

      expect(payload.shadowHtml).toMatch(
        /aria-selected="true"[^>]*data-item-path="a\.ts"[^>]*data-item-selected="true"/
      );
      expect(payload.shadowHtml).toMatch(
        /aria-selected="true"[^>]*data-item-path="c\.ts"[^>]*data-item-selected="true"/
      );
      expect(payload.shadowHtml).toMatch(
        /data-item-path="c\.ts"[^>]*tabindex="0"/
      );

      const mount = dom.window.document.createElement('div');
      mount.innerHTML = payload.html;
      dom.window.document.body.appendChild(mount);

      const host = mount.querySelector('file-tree-container');
      if (!(host instanceof dom.window.HTMLElement)) {
        throw new Error('expected SSR host');
      }

      const fileTree = new FileTree(options);
      fileTree.hydrate({ fileTreeContainer: host });
      await flushDom();

      expect(fileTree.getSelectedPaths()).toEqual(['a.ts', 'c.ts']);
      expect(fileTree.getFocusedPath()).toBe('c.ts');
      expect(getSelectedItemPaths(host.shadowRoot, dom)).toEqual([
        'a.ts',
        'c.ts',
      ]);
      expect(getFocusedItemPath(host.shadowRoot, dom)).toBe('c.ts');

      fileTree.cleanUp();
    } finally {
      cleanup();
    }
  });

  test('preloadFileTree sorts unsorted top-level entries before files and keeps root chains flattened', async () => {
    const preloadFileTree = await loadPreloadFileTree();

    const payload = preloadFileTree({
      flattenEmptyDirectories: true,
      paths: [
        'README.md',
        'package.json',
        'assets/images/social/logo.png',
        'assets/images/social/banner.png',
        'docs/guides/getting-started.md',
        'docs/guides/faq.md',
        'src/index.ts',
        'src/lib/utils.ts',
        'src/lib/theme.ts',
        'src/components/Button.tsx',
      ],
      viewportHeight: 460,
    });

    expect(
      Array.from(
        payload.shadowHtml.matchAll(/data-item-path="([^"]+)"/g),
        (match) => match[1] ?? ''
      ).filter((path) => path.length > 0)
    ).toEqual([
      'assets/images/social/',
      'docs/guides/',
      'src/',
      'package.json',
      'README.md',
    ]);
  });

  test('hydration keeps row content aligned with row paths for unsorted raw input', async () => {
    const { cleanup, dom } = installDom();
    try {
      const FileTree = await loadFileTree();
      const preloadFileTree = await loadPreloadFileTree();

      const unsortedPaths = [
        'README.md',
        'package.json',
        'assets/images/social/logo.png',
        'assets/images/social/banner.png',
        'docs/guides/getting-started.md',
        'docs/guides/faq.md',
        'src/index.ts',
        'src/lib/utils.ts',
        'src/lib/theme.ts',
        'src/components/Button.tsx',
      ] as const;
      const options = {
        dragAndDrop: true,
        flattenEmptyDirectories: true,
        id: 'pst-hydrate-shape',
        initialExpandedPaths: [
          'assets/images/social/',
          'docs/guides/',
          'src/',
          'src/lib/',
        ],
        paths: unsortedPaths,
        viewportHeight: 460,
      } satisfies ConstructorParameters<typeof FileTree>[0];
      const payload = preloadFileTree(options);

      const mount = dom.window.document.createElement('div');
      mount.innerHTML = payload.html;
      dom.window.document.body.appendChild(mount);

      const host = mount.querySelector('file-tree-container');
      if (!(host instanceof dom.window.HTMLElement)) {
        throw new Error('expected SSR host');
      }

      const ssrPaths = Array.from(
        payload.shadowHtml.matchAll(/data-item-path="([^"]+)"/g),
        (match) => match[1] ?? ''
      ).filter((path) => path.length > 0);

      const fileTree = new FileTree(options);
      fileTree.hydrate({ fileTreeContainer: host });
      await flushDom();

      const shadowRoot = host.shadowRoot;
      const hydratedPaths = Array.from(
        shadowRoot?.querySelectorAll('button[data-type="item"]') ?? []
      )
        .filter(
          (button): button is HTMLButtonElement =>
            button instanceof dom.window.HTMLButtonElement
        )
        .map((button) => button.dataset.itemPath)
        .filter((path): path is string => path != null);
      const getContentText = (path: string): string =>
        getItemButton(shadowRoot, dom, path)
          .querySelector('[data-item-section="content"]')
          ?.textContent?.replaceAll(/\s+/g, ' ')
          .trim() ?? '';

      expect(hydratedPaths).toEqual(ssrPaths);
      expect(getContentText('README.md')).toContain('README');
      expect(getContentText('README.md')).not.toContain('assets');
      expect(getContentText('package.json')).toContain('package');
      expect(getContentText('package.json')).not.toContain('banner');
      const flattenedAssetsContent = getItemButton(
        shadowRoot,
        dom,
        'assets/images/social/'
      ).querySelector('[data-item-section="content"]');
      expect(getContentText('assets/images/social/')).toContain('assets');
      expect(getContentText('assets/images/social/')).toContain('social');
      expect(
        flattenedAssetsContent?.querySelector('[data-icon-name]')
      ).toBeNull();
      expect(
        getItemButton(shadowRoot, dom, 'README.md').querySelector(
          '[data-item-section="icon"] [data-icon-name]'
        )
      ).not.toBeNull();

      fileTree.cleanUp();
    } finally {
      cleanup();
    }
  });

  test('FileTree renders and updates the visible window on scroll', async () => {
    const { cleanup, dom } = installDom();
    try {
      const FileTree = await loadFileTree();
      const containerWrapper = dom.window.document.createElement('div');
      dom.window.document.body.appendChild(containerWrapper);

      const paths = Array.from(
        { length: 120 },
        (_, index) => `item${String(index).padStart(3, '0')}.ts`
      );
      const fileTree = new FileTree({
        flattenEmptyDirectories: false,
        paths,
        viewportHeight: 120,
      });

      fileTree.render({ containerWrapper });
      const host = fileTree.getFileTreeContainer();
      expect(host).toBeDefined();
      const shadowRoot = host?.shadowRoot;
      const scrollElement = shadowRoot?.querySelector(
        '[data-file-tree-virtualized-scroll="true"]'
      );
      const root = shadowRoot?.querySelector(
        '[data-file-tree-virtualized-root="true"]'
      );

      expect(root).toBeDefined();
      expect(shadowRoot?.innerHTML).toContain('item000.ts');

      if (!(scrollElement instanceof dom.window.HTMLElement)) {
        throw new Error('missing scroll element');
      }

      const viewport = scrollElement;
      viewport.scrollTop = 1500;
      viewport.dispatchEvent(new dom.window.Event('scroll'));
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(shadowRoot?.innerHTML).toContain('item040.ts');
      expect(shadowRoot?.innerHTML).not.toContain('item000.ts');

      fileTree.cleanUp();
    } finally {
      cleanup();
    }
  });

  test('marks the virtualized list as scrolling to suppress hover styles', async () => {
    const { cleanup, dom } = installDom();
    try {
      const FileTree = await loadFileTree();
      const containerWrapper = dom.window.document.createElement('div');
      dom.window.document.body.appendChild(containerWrapper);

      const paths = Array.from(
        { length: 120 },
        (_, index) => `item${String(index).padStart(3, '0')}.ts`
      );
      const fileTree = new FileTree({
        flattenEmptyDirectories: false,
        paths,
        viewportHeight: 120,
      });

      fileTree.render({ containerWrapper });
      const shadowRoot = fileTree.getFileTreeContainer()?.shadowRoot;
      const scrollElement = shadowRoot?.querySelector(
        '[data-file-tree-virtualized-scroll="true"]'
      );
      const listElement = shadowRoot?.querySelector(
        '[data-file-tree-virtualized-list="true"]'
      );

      if (!(scrollElement instanceof dom.window.HTMLElement)) {
        throw new Error('missing scroll element');
      }
      if (!(listElement instanceof dom.window.HTMLDivElement)) {
        throw new Error('missing list element');
      }

      const viewport = scrollElement;
      const list = listElement;

      expect(list.dataset.isScrolling).toBeUndefined();

      viewport.scrollTop = 1500;
      viewport.dispatchEvent(new dom.window.Event('scroll'));
      await flushDom();

      expect(list.dataset.isScrolling).toBe('');

      await new Promise((resolve) => setTimeout(resolve, 60));
      expect(list.dataset.isScrolling).toBeUndefined();

      fileTree.cleanUp();
    } finally {
      cleanup();
    }
  });

  test('renders roving tabindex and baseline accessibility attributes', async () => {
    const { cleanup, dom } = installDom();
    try {
      const FileTree = await loadFileTree();
      const containerWrapper = dom.window.document.createElement('div');
      dom.window.document.body.appendChild(containerWrapper);

      const fileTree = new FileTree({
        flattenEmptyDirectories: false,
        initialExpansion: 1,
        paths: ['README.md', 'src/index.ts', 'src/lib/util.ts'],
        viewportHeight: 120,
      });

      fileTree.render({ containerWrapper });
      const shadowRoot = fileTree.getFileTreeContainer()?.shadowRoot;
      const treeRoot = getTreeRoot(shadowRoot, dom);
      const sourceButton = getItemButton(shadowRoot, dom, 'src/');
      const readmeButton = getItemButton(shadowRoot, dom, 'README.md');

      expect(treeRoot.getAttribute('role')).toBe('tree');
      expect(treeRoot.getAttribute('aria-activedescendant')).toBeNull();
      expect(treeRoot.style.outline).toBe('none');
      expect(sourceButton.getAttribute('role')).toBe('treeitem');
      expect(sourceButton.getAttribute('aria-level')).toBe('1');
      expect(sourceButton.getAttribute('aria-posinset')).toBe('1');
      expect(sourceButton.getAttribute('aria-setsize')).toBe('2');
      expect(sourceButton.getAttribute('aria-expanded')).toBe('true');
      expect(sourceButton.getAttribute('aria-selected')).toBe('false');
      expect(sourceButton.tabIndex).toBe(0);
      expect(sourceButton.dataset.itemFocused).toBeUndefined();
      expect(readmeButton.getAttribute('aria-expanded')).toBeNull();
      expect(readmeButton.tabIndex).toBe(-1);

      // Collapsed directory should render aria-expanded="false"
      const libButton = getItemButton(shadowRoot, dom, 'src/lib/');
      expect(libButton.getAttribute('aria-expanded')).toBe('false');

      sourceButton.focus();
      await flushDom();
      expect(sourceButton.dataset.itemFocused).toBe('true');

      fileTree.cleanUp();
    } finally {
      cleanup();
    }
  });

  test('focused rows keep the matching separator line prominent', async () => {
    const { cleanup, dom } = installDom();
    try {
      const FileTree = await loadFileTree();
      const containerWrapper = dom.window.document.createElement('div');
      dom.window.document.body.appendChild(containerWrapper);

      const fileTree = new FileTree({
        flattenEmptyDirectories: false,
        initialExpandedPaths: ['src/lib/'],
        paths: ['README.md', 'src/index.ts', 'src/lib/util.ts'],
        viewportHeight: 120,
      });

      fileTree.render({ containerWrapper });
      const shadowRoot = fileTree.getFileTreeContainer()?.shadowRoot;
      const fileButton = getItemButton(shadowRoot, dom, 'src/lib/util.ts');

      fileButton.focus();
      await flushDom();

      const guideStyle = shadowRoot?.querySelector(
        '[data-file-tree-guide-style="true"]'
      );
      const spacingItems = fileButton.querySelectorAll(
        '[data-item-section="spacing-item"]'
      );

      expect(spacingItems[0]?.getAttribute('data-ancestor-path')).toBe('src/');
      expect(spacingItems[1]?.getAttribute('data-ancestor-path')).toBe(
        'src/lib/'
      );
      expect(guideStyle?.innerHTML).toContain(
        '[data-item-section="spacing-item"][data-ancestor-path="src/lib/"]'
      );

      fileTree.cleanUp();
    } finally {
      cleanup();
    }
  });

  test('keyboard navigation matches the baseline tree behavior', async () => {
    const { cleanup, dom } = installDom();
    try {
      const FileTree = await loadFileTree();
      const containerWrapper = dom.window.document.createElement('div');
      dom.window.document.body.appendChild(containerWrapper);

      const fileTree = new FileTree({
        flattenEmptyDirectories: false,
        initialExpansion: 1,
        paths: ['README.md', 'src/index.ts', 'src/lib/util.ts'],
        viewportHeight: 120,
      });

      fileTree.render({ containerWrapper });
      const shadowRoot = fileTree.getFileTreeContainer()?.shadowRoot;
      getItemButton(shadowRoot, dom, 'src/').focus();
      await flushDom();

      pressKey(getItemButton(shadowRoot, dom, 'src/'), dom, 'ArrowDown');
      await flushDom();
      expect(fileTree.getItem('src/lib/')?.isFocused()).toBe(true);

      pressKey(getItemButton(shadowRoot, dom, 'src/lib/'), dom, 'ArrowRight');
      await flushDom();
      expect(shadowRoot?.innerHTML).toContain('src/lib/util.ts');
      expect(fileTree.getItem('src/lib/')?.isFocused()).toBe(true);

      pressKey(getItemButton(shadowRoot, dom, 'src/lib/'), dom, 'ArrowRight');
      await flushDom();
      expect(fileTree.getItem('src/lib/util.ts')?.isFocused()).toBe(true);

      pressKey(
        getItemButton(shadowRoot, dom, 'src/lib/util.ts'),
        dom,
        'ArrowLeft'
      );
      await flushDom();
      expect(fileTree.getItem('src/lib/')?.isFocused()).toBe(true);

      pressKey(getItemButton(shadowRoot, dom, 'src/lib/'), dom, 'End');
      await flushDom();
      await flushDom();
      expect(fileTree.getItem('README.md')?.isFocused()).toBe(true);

      pressKey(getTreeRoot(shadowRoot, dom), dom, 'Home');
      await flushDom();
      await flushDom();
      expect(fileTree.getItem('src/')?.isFocused()).toBe(true);

      fileTree.cleanUp();
    } finally {
      cleanup();
    }
  });

  test('ArrowLeft on expanded directory collapses it without moving focus', async () => {
    const { cleanup, dom } = installDom();
    try {
      const FileTree = await loadFileTree();
      const containerWrapper = dom.window.document.createElement('div');
      dom.window.document.body.appendChild(containerWrapper);

      const fileTree = new FileTree({
        flattenEmptyDirectories: false,
        initialExpandedPaths: ['src/lib/'],
        paths: ['README.md', 'src/index.ts', 'src/lib/util.ts'],
        viewportHeight: 120,
      });

      fileTree.render({ containerWrapper });
      const shadowRoot = fileTree.getFileTreeContainer()?.shadowRoot;

      // src/lib/ is expanded — ArrowLeft should collapse it, not move focus
      getItemButton(shadowRoot, dom, 'src/lib/').focus();
      await flushDom();
      expect(shadowRoot?.innerHTML).toContain('src/lib/util.ts');

      pressKey(getItemButton(shadowRoot, dom, 'src/lib/'), dom, 'ArrowLeft');
      await flushDom();
      expect(fileTree.getItem('src/lib/')?.isFocused()).toBe(true);
      expect(shadowRoot?.innerHTML).not.toContain('src/lib/util.ts');

      // Now src/lib/ is collapsed — ArrowLeft should move focus to parent src/
      pressKey(getItemButton(shadowRoot, dom, 'src/lib/'), dom, 'ArrowLeft');
      await flushDom();
      expect(fileTree.getItem('src/')?.isFocused()).toBe(true);

      fileTree.cleanUp();
    } finally {
      cleanup();
    }
  });

  test('ArrowLeft at root level is a no-op and ArrowRight on a leaf moves focus forward', async () => {
    const { cleanup, dom } = installDom();
    try {
      const FileTree = await loadFileTree();
      const containerWrapper = dom.window.document.createElement('div');
      dom.window.document.body.appendChild(containerWrapper);

      const fileTree = new FileTree({
        flattenEmptyDirectories: false,
        initialExpansion: 0,
        paths: ['a.ts', 'b.ts', 'c.ts'],
        viewportHeight: 120,
      });

      fileTree.render({ containerWrapper });
      const shadowRoot = fileTree.getFileTreeContainer()?.shadowRoot;

      // Focus first root-level item — ArrowLeft should be a no-op
      getItemButton(shadowRoot, dom, 'a.ts').focus();
      await flushDom();
      pressKey(getItemButton(shadowRoot, dom, 'a.ts'), dom, 'ArrowLeft');
      await flushDom();
      expect(fileTree.getItem('a.ts')?.isFocused()).toBe(true);

      // ArrowRight on a leaf file should move focus to next item
      pressKey(getItemButton(shadowRoot, dom, 'a.ts'), dom, 'ArrowRight');
      await flushDom();
      expect(fileTree.getItem('b.ts')?.isFocused()).toBe(true);

      fileTree.cleanUp();
    } finally {
      cleanup();
    }
  });

  test('focus stays clamped at first and last visible items', async () => {
    const { cleanup, dom } = installDom();
    try {
      const FileTree = await loadFileTree();
      const containerWrapper = dom.window.document.createElement('div');
      dom.window.document.body.appendChild(containerWrapper);

      const fileTree = new FileTree({
        flattenEmptyDirectories: false,
        paths: ['a.ts', 'b.ts', 'c.ts'],
        viewportHeight: 120,
      });

      fileTree.render({ containerWrapper });
      const shadowRoot = fileTree.getFileTreeContainer()?.shadowRoot;

      // ArrowUp at first item stays put
      getItemButton(shadowRoot, dom, 'a.ts').focus();
      await flushDom();
      pressKey(getItemButton(shadowRoot, dom, 'a.ts'), dom, 'ArrowUp');
      await flushDom();
      expect(fileTree.getItem('a.ts')?.isFocused()).toBe(true);

      // ArrowDown at last item stays put
      pressKey(getItemButton(shadowRoot, dom, 'a.ts'), dom, 'End');
      await flushDom();
      await flushDom();
      expect(fileTree.getItem('c.ts')?.isFocused()).toBe(true);

      pressKey(getItemButton(shadowRoot, dom, 'c.ts'), dom, 'ArrowDown');
      await flushDom();
      expect(fileTree.getItem('c.ts')?.isFocused()).toBe(true);

      fileTree.cleanUp();
    } finally {
      cleanup();
    }
  });

  test('collapse moves focus to the nearest visible ancestor', async () => {
    const { cleanup, dom } = installDom();
    try {
      const FileTree = await loadFileTree();
      const containerWrapper = dom.window.document.createElement('div');
      dom.window.document.body.appendChild(containerWrapper);

      const fileTree = new FileTree({
        flattenEmptyDirectories: false,
        initialExpandedPaths: ['src/lib/'],
        paths: ['README.md', 'src/index.ts', 'src/lib/util.ts'],
        viewportHeight: 120,
      });

      fileTree.render({ containerWrapper });
      const shadowRoot = fileTree.getFileTreeContainer()?.shadowRoot;
      getItemButton(shadowRoot, dom, 'src/lib/util.ts').focus();
      await flushDom();

      const sourceDirectory = fileTree.getItem('src/lib/');
      if (
        sourceDirectory == null ||
        sourceDirectory.isDirectory() !== true ||
        !('collapse' in sourceDirectory)
      ) {
        throw new Error('missing source directory item');
      }

      sourceDirectory.collapse();
      await flushDom();

      expect(fileTree.getItem('src/lib/')?.isFocused()).toBe(true);
      expect(shadowRoot?.innerHTML).not.toContain('src/lib/util.ts');
      expect(getFocusedTreeElement(shadowRoot, dom)?.dataset.itemPath).toBe(
        'src/lib/'
      );

      fileTree.cleanUp();
    } finally {
      cleanup();
    }
  });

  test('keyboard navigation survives virtualization when the focused row unmounts', async () => {
    const { cleanup, dom } = installDom();
    try {
      const FileTree = await loadFileTree();
      const containerWrapper = dom.window.document.createElement('div');
      dom.window.document.body.appendChild(containerWrapper);

      const paths = Array.from(
        { length: 120 },
        (_, index) => `item${String(index).padStart(3, '0')}.ts`
      );
      const fileTree = new FileTree({
        flattenEmptyDirectories: false,
        paths,
        viewportHeight: 120,
      });

      fileTree.render({ containerWrapper });
      const shadowRoot = fileTree.getFileTreeContainer()?.shadowRoot;
      const scrollElement = shadowRoot?.querySelector(
        '[data-file-tree-virtualized-scroll="true"]'
      );
      if (!(scrollElement instanceof dom.window.HTMLElement)) {
        throw new Error('missing scroll element');
      }

      const viewport = scrollElement;
      viewport.scrollTop = 1500;
      viewport.dispatchEvent(new dom.window.Event('scroll'));
      await flushDom();

      getItemButton(shadowRoot, dom, 'item050.ts').focus();
      await flushDom();
      expect(fileTree.getItem('item050.ts')?.isFocused()).toBe(true);

      viewport.scrollTop = 3000;
      viewport.dispatchEvent(new dom.window.Event('scroll'));
      await flushDom();
      await flushDom();

      expect(viewport.scrollTop).toBe(3000);
      expect(shadowRoot?.innerHTML).toContain('item100.ts');
      expect(
        getItemButton(shadowRoot, dom, 'item050.ts').dataset.itemParked
      ).toBe('true');
      expect(getFocusedTreeElement(shadowRoot, dom)?.dataset.itemPath).toBe(
        'item050.ts'
      );

      pressKey(getItemButton(shadowRoot, dom, 'item050.ts'), dom, 'ArrowDown');
      await flushDom();
      await flushDom();

      expect(fileTree.getItem('item051.ts')?.isFocused()).toBe(true);
      expect(viewport.scrollTop).toBe(51 * FILE_TREE_DEFAULT_ITEM_HEIGHT);
      expect(
        getItemButton(shadowRoot, dom, 'item051.ts').dataset.itemFocused
      ).toBe('true');
      expect(getFocusedTreeElement(shadowRoot, dom)?.dataset.itemPath).toBe(
        'item051.ts'
      );

      fileTree.cleanUp();
    } finally {
      cleanup();
    }
  });

  test('flattened rows use terminal-directory keyboard semantics', async () => {
    const { cleanup, dom } = installDom();
    try {
      const FileTree = await loadFileTree();
      const containerWrapper = dom.window.document.createElement('div');
      dom.window.document.body.appendChild(containerWrapper);

      const fileTree = new FileTree({
        flattenEmptyDirectories: true,
        initialExpandedPaths: ['src/'],
        paths: ['src/lib/util.ts'],
        viewportHeight: 120,
      });

      fileTree.render({ containerWrapper });
      const shadowRoot = fileTree.getFileTreeContainer()?.shadowRoot;
      getItemButton(shadowRoot, dom, 'src/lib/').focus();
      await flushDom();

      pressKey(getItemButton(shadowRoot, dom, 'src/lib/'), dom, 'ArrowRight');
      await flushDom();
      expect(shadowRoot?.innerHTML).toContain('util.ts');
      expect(fileTree.getItem('src/lib/')?.isFocused()).toBe(true);

      pressKey(getItemButton(shadowRoot, dom, 'src/lib/'), dom, 'ArrowRight');
      await flushDom();
      expect(fileTree.getItem('src/lib/util.ts')?.isFocused()).toBe(true);

      fileTree.cleanUp();
    } finally {
      cleanup();
    }
  });

  test('flattened row markup does not wrap separators in extra spans', async () => {
    const { cleanup, dom } = installDom();
    try {
      const FileTree = await loadFileTree();
      const containerWrapper = dom.window.document.createElement('div');
      dom.window.document.body.appendChild(containerWrapper);

      const fileTree = new FileTree({
        flattenEmptyDirectories: true,
        initialExpandedPaths: ['src/'],
        paths: ['src/lib/util.ts'],
        viewportHeight: 120,
      });

      fileTree.render({ containerWrapper });
      const shadowRoot = fileTree.getFileTreeContainer()?.shadowRoot;
      const flattenedContainer = shadowRoot?.querySelector(
        '[data-item-flattened-subitems]'
      );

      expect(flattenedContainer?.innerHTML).toContain(' / ');
      expect(
        flattenedContainer?.querySelectorAll(
          ':scope > [data-item-flattened-subitem]'
        ).length
      ).toBe(2);
      expect(
        flattenedContainer?.querySelector(
          ':scope > span:not([data-item-flattened-subitem])'
        )
      ).toBeNull();

      fileTree.cleanUp();
    } finally {
      cleanup();
    }
  });

  test('directory row clicks preserve plain-click toggle behavior while modifier clicks stay selection-only', async () => {
    const { cleanup, dom } = installDom();
    try {
      const FileTree = await loadFileTree();
      const containerWrapper = dom.window.document.createElement('div');
      dom.window.document.body.appendChild(containerWrapper);

      const fileTree = new FileTree({
        flattenEmptyDirectories: false,
        paths: ['README.md', 'src/index.ts', 'src/lib/util.ts'],
        viewportHeight: 120,
      });

      fileTree.render({ containerWrapper });
      const shadowRoot = fileTree.getFileTreeContainer()?.shadowRoot;

      clickItem(shadowRoot, dom, 'README.md');
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(shadowRoot?.innerHTML).not.toContain('src/index.ts');
      expect(getSelectedItemPaths(shadowRoot, dom)).toEqual(['README.md']);

      clickItem(shadowRoot, dom, 'src/');
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(shadowRoot?.innerHTML).toContain('src/index.ts');
      expect(getSelectedItemPaths(shadowRoot, dom)).toEqual(['src/']);

      clickItem(shadowRoot, dom, 'src/', { ctrlKey: true });
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(shadowRoot?.innerHTML).toContain('src/index.ts');
      expect(getSelectedItemPaths(shadowRoot, dom)).toEqual([]);

      clickItem(shadowRoot, dom, 'src/');
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(shadowRoot?.innerHTML).not.toContain('src/index.ts');
      expect(getSelectedItemPaths(shadowRoot, dom)).toEqual(['src/']);

      fileTree.cleanUp();
    } finally {
      cleanup();
    }
  });

  test('flattened rows toggle the terminal directory', async () => {
    const { cleanup, dom } = installDom();
    try {
      const FileTree = await loadFileTree();
      const containerWrapper = dom.window.document.createElement('div');
      dom.window.document.body.appendChild(containerWrapper);

      const fileTree = new FileTree({
        flattenEmptyDirectories: true,
        initialExpandedPaths: ['src/'],
        paths: ['src/lib/util.ts'],
        viewportHeight: 120,
      });

      fileTree.render({ containerWrapper });
      const shadowRoot = fileTree.getFileTreeContainer()?.shadowRoot;

      clickItem(shadowRoot, dom, 'src/lib/');
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(shadowRoot?.innerHTML).toContain('util.ts');

      fileTree.cleanUp();
    } finally {
      cleanup();
    }
  });

  test('flattened row selection targets the terminal directory path', async () => {
    const { cleanup, dom } = installDom();
    try {
      const FileTree = await loadFileTree();
      const containerWrapper = dom.window.document.createElement('div');
      dom.window.document.body.appendChild(containerWrapper);

      const fileTree = new FileTree({
        flattenEmptyDirectories: true,
        initialExpandedPaths: ['src/'],
        paths: ['src/lib/util.ts'],
        viewportHeight: 120,
      });

      fileTree.render({ containerWrapper });
      const shadowRoot = fileTree.getFileTreeContainer()?.shadowRoot;

      clickItem(shadowRoot, dom, 'src/lib/');
      await flushDom();

      expect(fileTree.getSelectedPaths()).toEqual(['src/lib/']);
      expect(
        getItemButton(shadowRoot, dom, 'src/lib/').dataset.itemSelected
      ).toBe('true');

      fileTree.cleanUp();
    } finally {
      cleanup();
    }
  });

  test('Shift-click range selection works when anchor or target is a flattened row', async () => {
    const { cleanup, dom } = installDom();
    try {
      const FileTree = await loadFileTree();
      const containerWrapper = dom.window.document.createElement('div');
      dom.window.document.body.appendChild(containerWrapper);

      const fileTree = new FileTree({
        flattenEmptyDirectories: true,
        initialExpandedPaths: ['src/'],
        paths: ['README.md', 'src/lib/util.ts', 'src/lib/helpers.ts'],
        viewportHeight: 200,
      });

      fileTree.render({ containerWrapper });
      const shadowRoot = fileTree.getFileTreeContainer()?.shadowRoot;

      // Click the flattened row (src / lib) to set it as anchor
      clickItem(shadowRoot, dom, 'src/lib/');
      await flushDom();
      expect(fileTree.getSelectedPaths()).toEqual(['src/lib/']);

      // Shift-click a file below — should produce a range from the flattened
      // row through the target, not fall back to single selection.
      clickItem(shadowRoot, dom, 'src/lib/helpers.ts', { shiftKey: true });
      await flushDom();
      expect(fileTree.getSelectedPaths()).toContain('src/lib/');
      expect(fileTree.getSelectedPaths()).toContain('src/lib/helpers.ts');

      // Now test the reverse: anchor on a regular file, Shift-click the
      // flattened row.
      clickItem(shadowRoot, dom, 'src/lib/helpers.ts');
      await flushDom();

      clickItem(shadowRoot, dom, 'src/lib/', { shiftKey: true });
      await flushDom();
      expect(fileTree.getSelectedPaths()).toContain('src/lib/');
      expect(fileTree.getSelectedPaths()).toContain('src/lib/helpers.ts');

      fileTree.cleanUp();
    } finally {
      cleanup();
    }
  });

  test('expansion between selected items does not corrupt index-based selection', async () => {
    const { cleanup, dom } = installDom();
    try {
      const FileTree = await loadFileTree();
      const containerWrapper = dom.window.document.createElement('div');
      dom.window.document.body.appendChild(containerWrapper);

      const fileTree = new FileTree({
        flattenEmptyDirectories: false,
        initialExpansion: 0,
        paths: ['a.ts', 'src/index.ts', 'src/lib/util.ts', 'z.ts'],
        viewportHeight: 200,
      });

      fileTree.render({ containerWrapper });
      const shadowRoot = fileTree.getFileTreeContainer()?.shadowRoot;

      // Select a.ts, then Shift-click z.ts while the collapsed src/ row sits
      // outside the anchored visible range because directories sort ahead of
      // root files in this lane.
      clickItem(shadowRoot, dom, 'a.ts');
      await flushDom();
      clickItem(shadowRoot, dom, 'z.ts', { shiftKey: true });
      await flushDom();
      expect(fileTree.getSelectedPaths()).toEqual(['a.ts', 'z.ts']);
      expect(getSelectedItemPaths(shadowRoot, dom)).toEqual(['a.ts', 'z.ts']);

      // Expand src/ — new children appear but selection stays path-based
      const srcDir = fileTree.getItem('src/');
      if (srcDir == null || !srcDir.isDirectory() || !('expand' in srcDir)) {
        throw new Error('missing src directory');
      }
      srcDir.expand();
      await flushDom();

      // Only the original selected root-file range should remain selected, not
      // the newly visible children.
      expect(fileTree.getSelectedPaths()).toEqual(['a.ts', 'z.ts']);
      expect(
        getItemButton(shadowRoot, dom, 'src/index.ts').dataset.itemSelected
      ).toBeUndefined();

      fileTree.cleanUp();
    } finally {
      cleanup();
    }
  });

  test('onSelectionChange does not fire on collapse even when selected items become hidden', async () => {
    const { cleanup, dom } = installDom();
    try {
      const FileTree = await loadFileTree();
      const containerWrapper = dom.window.document.createElement('div');
      dom.window.document.body.appendChild(containerWrapper);
      const selectionEvents: string[][] = [];

      const fileTree = new FileTree({
        flattenEmptyDirectories: false,
        initialExpandedPaths: ['src/'],
        onSelectionChange: (items) => {
          selectionEvents.push([...items]);
        },
        paths: ['src/index.ts', 'src/lib/util.ts'],
        viewportHeight: 120,
      });

      fileTree.render({ containerWrapper });
      const shadowRoot = fileTree.getFileTreeContainer()?.shadowRoot;

      clickItem(shadowRoot, dom, 'src/index.ts');
      await flushDom();
      expect(selectionEvents.length).toBe(1);

      // Collapse the parent — selected item disappears from DOM but stays
      // in the selection set, so the callback should NOT fire again.
      const srcDir = fileTree.getItem('src/');
      if (srcDir == null || !srcDir.isDirectory() || !('collapse' in srcDir)) {
        throw new Error('missing src directory');
      }
      srcDir.collapse();
      await flushDom();

      expect(selectionEvents.length).toBe(1);
      expect(fileTree.getSelectedPaths()).toEqual(['src/index.ts']);

      fileTree.cleanUp();
    } finally {
      cleanup();
    }
  });

  test('empty paths array creates a valid tree with no crashes', async () => {
    const FileTreeController = await loadFileTreeController();

    const controller = new FileTreeController({
      flattenEmptyDirectories: false,
      paths: [],
    });

    expect(controller.getVisibleCount()).toBe(0);
    expect(controller.getFocusedPath()).toBeNull();
    expect(controller.getFocusedIndex()).toBe(-1);
    expect(controller.getFocusedItem()).toBeNull();
    expect(controller.getSelectedPaths()).toEqual([]);
    expect(controller.getItem('anything')).toBeNull();

    // Navigation methods should be no-ops, not throw.
    controller.focusNextItem();
    controller.focusPreviousItem();
    controller.focusFirstItem();
    controller.focusLastItem();
    controller.focusParentItem();
    controller.selectAllVisiblePaths();
    controller.extendSelectionFromFocused(1);
    controller.extendSelectionFromFocused(-1);
    controller.selectPathRange('missing.ts', false);
    controller.selectOnlyPath('missing.ts');

    expect(controller.getVisibleCount()).toBe(0);

    controller.destroy();
  });

  test('single item tree handles all navigation and selection gracefully', async () => {
    const { cleanup, dom } = installDom();
    try {
      const FileTree = await loadFileTree();
      const containerWrapper = dom.window.document.createElement('div');
      dom.window.document.body.appendChild(containerWrapper);

      const fileTree = new FileTree({
        flattenEmptyDirectories: false,
        paths: ['only.ts'],
        viewportHeight: 120,
      });

      fileTree.render({ containerWrapper });
      const shadowRoot = fileTree.getFileTreeContainer()?.shadowRoot;
      const button = getItemButton(shadowRoot, dom, 'only.ts');
      button.focus();
      await flushDom();

      // ArrowDown/Up at the only item should stay put
      pressKey(button, dom, 'ArrowDown');
      await flushDom();
      expect(fileTree.getItem('only.ts')?.isFocused()).toBe(true);

      pressKey(button, dom, 'ArrowUp');
      await flushDom();
      expect(fileTree.getItem('only.ts')?.isFocused()).toBe(true);

      // Ctrl+A selects the single item
      pressKey(button, dom, 'a', { ctrlKey: true });
      await flushDom();
      expect(getSelectedItemPaths(shadowRoot, dom)).toEqual(['only.ts']);

      // Shift+ArrowDown at boundary is a no-op
      pressKey(button, dom, 'ArrowDown', { shiftKey: true });
      await flushDom();
      expect(getSelectedItemPaths(shadowRoot, dom)).toEqual(['only.ts']);

      fileTree.cleanUp();
    } finally {
      cleanup();
    }
  });

  test('Ctrl-click deselects the anchor then Shift-click still ranges from it', async () => {
    const { cleanup, dom } = installDom();
    try {
      const FileTree = await loadFileTree();
      const containerWrapper = dom.window.document.createElement('div');
      dom.window.document.body.appendChild(containerWrapper);

      const fileTree = new FileTree({
        flattenEmptyDirectories: false,
        paths: ['a.ts', 'b.ts', 'c.ts', 'd.ts'],
        viewportHeight: 120,
      });

      fileTree.render({ containerWrapper });
      const shadowRoot = fileTree.getFileTreeContainer()?.shadowRoot;

      // Click b.ts to set it as anchor and select it
      clickItem(shadowRoot, dom, 'b.ts');
      await flushDom();
      expect(getSelectedItemPaths(shadowRoot, dom)).toEqual(['b.ts']);

      // Ctrl-click b.ts to deselect it — anchor should remain b.ts
      clickItem(shadowRoot, dom, 'b.ts', { ctrlKey: true });
      await flushDom();
      expect(getSelectedItemPaths(shadowRoot, dom)).toEqual([]);

      // Shift-click d.ts — should range from anchor b.ts to d.ts
      clickItem(shadowRoot, dom, 'd.ts', { shiftKey: true });
      await flushDom();
      expect(getSelectedItemPaths(shadowRoot, dom)).toEqual([
        'b.ts',
        'c.ts',
        'd.ts',
      ]);

      fileTree.cleanUp();
    } finally {
      cleanup();
    }
  });

  test('resetPaths preserves focus on surviving paths and resets focus when focused path is removed', async () => {
    const FileTreeController = await loadFileTreeController();

    const controller = new FileTreeController({
      flattenEmptyDirectories: false,
      initialExpansion: 'open',
      paths: ['a.ts', 'b.ts', 'c.ts'],
    });

    controller.focusPath('b.ts');
    expect(controller.getFocusedPath()).toBe('b.ts');

    // Replace paths keeping b.ts — focus should survive
    controller.resetPaths(['a.ts', 'b.ts', 'd.ts']);
    expect(controller.getFocusedPath()).toBe('b.ts');

    // Replace paths removing b.ts — focus should fall back
    controller.resetPaths(['a.ts', 'd.ts']);
    expect(controller.getFocusedPath()).not.toBe('b.ts');
    expect(controller.getFocusedPath()).not.toBeNull();

    // Replace with empty — focus should be null
    controller.resetPaths([]);
    expect(controller.getFocusedPath()).toBeNull();

    controller.destroy();
  });

  test('controller subscribe fires when resetPaths prunes selected items', async () => {
    const FileTreeController = await loadFileTreeController();

    const controller = new FileTreeController({
      flattenEmptyDirectories: false,
      initialExpansion: 'open',
      paths: ['a.ts', 'b.ts', 'c.ts'],
    });

    controller.selectOnlyPath('a.ts');
    controller.selectPathRange('c.ts', false);
    expect(controller.getSelectedPaths()).toEqual(['a.ts', 'b.ts', 'c.ts']);
    const versionBeforeReplace = controller.getSelectionVersion();

    // Remove b.ts — selection should prune it
    controller.resetPaths(['a.ts', 'c.ts']);
    expect(controller.getSelectedPaths()).toEqual(['a.ts', 'c.ts']);
    expect(controller.getSelectionVersion()).toBeGreaterThan(
      versionBeforeReplace
    );

    // Replace with all new paths — selection fully pruned
    const versionBeforeFullPrune = controller.getSelectionVersion();
    controller.resetPaths(['x.ts', 'y.ts']);
    expect(controller.getSelectedPaths()).toEqual([]);
    expect(controller.getSelectionVersion()).toBeGreaterThan(
      versionBeforeFullPrune
    );

    // Replace that doesn't affect selection — version stays the same
    controller.selectOnlyPath('x.ts');
    const versionBeforeNoOp = controller.getSelectionVersion();
    controller.resetPaths(['x.ts', 'z.ts']);
    expect(controller.getSelectedPaths()).toEqual(['x.ts']);
    expect(controller.getSelectionVersion()).toBe(versionBeforeNoOp);

    controller.destroy();
  });

  test('collapse preserves a coherent virtualized window when affected rows move above and below the fold', async () => {
    const { cleanup, dom } = installDom();
    try {
      const FileTree = await loadFileTree();
      const containerWrapper = dom.window.document.createElement('div');
      dom.window.document.body.appendChild(containerWrapper);

      const topFiles = Array.from(
        { length: 50 },
        (_, index) => `a${String(index).padStart(3, '0')}.ts`
      );
      const sourceFiles = Array.from(
        { length: 80 },
        (_, index) => `src/file${String(index).padStart(3, '0')}.ts`
      );
      const bottomFiles = Array.from(
        { length: 50 },
        (_, index) => `z${String(index).padStart(3, '0')}.ts`
      );
      const fileTree = new FileTree({
        flattenEmptyDirectories: false,
        initialExpandedPaths: ['src/'],
        paths: [...topFiles, ...sourceFiles, ...bottomFiles],
        viewportHeight: 120,
      });

      fileTree.render({ containerWrapper });
      const host = fileTree.getFileTreeContainer();
      const shadowRoot = host?.shadowRoot;
      const scrollElement = shadowRoot?.querySelector(
        '[data-file-tree-virtualized-scroll="true"]'
      );

      if (!(scrollElement instanceof dom.window.HTMLElement)) {
        throw new Error('missing scroll element');
      }

      const viewport = scrollElement;
      viewport.scrollTop = (topFiles.length + 11) * 30;
      viewport.dispatchEvent(new dom.window.Event('scroll'));
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(shadowRoot?.innerHTML).toContain('src/file050.ts');

      const sourceDirectory = fileTree.getItem('src/');
      if (
        sourceDirectory == null ||
        sourceDirectory.isDirectory() !== true ||
        !('collapse' in sourceDirectory)
      ) {
        throw new Error('missing source directory item');
      }

      sourceDirectory.collapse();
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(shadowRoot?.innerHTML).not.toContain('src/file050.ts');
      expect(shadowRoot?.innerHTML).toContain('z010.ts');

      fileTree.cleanUp();
    } finally {
      cleanup();
    }
  });

  test('uses compatible row markup for the implemented focus/navigation and selection pieces', async () => {
    const { cleanup, dom } = installDom();
    try {
      const FileTree = await loadFileTree();
      const containerWrapper = dom.window.document.createElement('div');
      dom.window.document.body.appendChild(containerWrapper);

      const fileTree = new FileTree({
        flattenEmptyDirectories: true,
        initialExpansion: 'open',
        paths: ['src/lib/index.ts', 'src/lib/utils.ts', 'README.md'],
        viewportHeight: 120,
      });

      fileTree.render({ containerWrapper });
      const shadowRoot = fileTree.getFileTreeContainer()?.shadowRoot;
      const focusedRow = shadowRoot?.querySelector(
        '[data-item-focused="true"]'
      );
      const treeRoot = shadowRoot?.querySelector(
        '[data-file-tree-virtualized-root="true"]'
      );

      const flattenedFolderButton = getItemButton(shadowRoot, dom, 'src/lib/');
      const nestedFileButton = getItemButton(
        shadowRoot,
        dom,
        'src/lib/index.ts'
      );
      const rootFileButton = getItemButton(shadowRoot, dom, 'README.md');
      const getSectionOrder = (button: HTMLButtonElement): string[] =>
        Array.from(button.children)
          .map((child) => child.getAttribute('data-item-section'))
          .filter((section): section is string => section != null);

      expect(getSectionOrder(flattenedFolderButton)).toEqual([
        'icon',
        'content',
      ]);
      expect(getSectionOrder(nestedFileButton)).toEqual([
        'spacing',
        'icon',
        'content',
      ]);
      expect(getSectionOrder(rootFileButton)).toEqual(['icon', 'content']);

      expect(
        flattenedFolderButton.querySelector(
          '[data-item-section="icon"] [data-icon-name]'
        )
      ).not.toBeNull();
      expect(
        nestedFileButton.querySelector(
          '[data-item-section="spacing"] [data-item-section="spacing-item"]'
        )
      ).not.toBeNull();
      expect(
        nestedFileButton.querySelector(
          '[data-item-section="icon"] [data-icon-name]'
        )
      ).not.toBeNull();
      expect(
        nestedFileButton.querySelector(
          '[data-item-section="content"] [data-icon-name]'
        )
      ).toBeNull();
      expect(
        nestedFileButton.querySelector(
          '[data-item-section="content"] [data-item-section="spacing-item"]'
        )
      ).toBeNull();
      expect(
        nestedFileButton.querySelector(
          '[data-item-section="content"] [data-truncate-container]'
        )
      ).not.toBeNull();
      expect(focusedRow).toBeNull();
      expect(
        shadowRoot?.querySelector('[data-item-selected="true"]')
      ).toBeNull();
      expect(treeRoot?.getAttribute('role')).toBe('tree');
      expect(treeRoot?.getAttribute('aria-activedescendant')).toBeNull();

      getItemButton(shadowRoot, dom, 'src/lib/').focus();
      await flushDom();

      const focusedButton = getItemButton(shadowRoot, dom, 'src/lib/');
      expect(focusedButton.dataset.itemFocused).toBe('true');
      expect(focusedButton.getAttribute('role')).toBe('treeitem');
      expect(focusedButton.getAttribute('aria-selected')).toBe('false');

      clickItem(shadowRoot, dom, 'README.md');
      await flushDom();

      const selectedButton = getItemButton(shadowRoot, dom, 'README.md');
      expect(selectedButton.dataset.itemSelected).toBe('true');
      expect(selectedButton.getAttribute('aria-selected')).toBe('true');
      expect(
        shadowRoot?.querySelector('[data-item-selected="true"]')
      ).not.toBeNull();

      fileTree.cleanUp();
    } finally {
      cleanup();
    }
  });
});
