import { DocsCodeExample } from '@pierre/docs-shared/docs/DocsCodeExample';
import { createRenderMDX } from '@pierre/docs-shared/lib/mdx';

import { FileTree } from '../features/trees/treesCompatClient';

const treesMDXComponents = {
  DocsCodeExample,
  FileTree,
};

export const { renderMDX, renderMDXWithPreloadedFiles } =
  createRenderMDX(treesMDXComponents);
