import { MultiFileDiff } from '@pierre/diffs/react';
import { DocsCodeExample } from '@pierre/docs-shared/docs/DocsCodeExample';
import { createRenderMDX } from '@pierre/docs-shared/lib/mdx';

import { CustomHunkSeparators } from '../app/diff-examples/CustomHunkSeparators/CustomHunkSeparators';
import { PackageManagerTabs } from '../app/docs/Installation/PackageManagerTabs';
import { CodeToggle } from '../app/docs/Overview/CodeToggle';
import {
  ComponentTabs,
  SharedPropTabs,
} from '../app/docs/ReactAPI/ComponentTabs';
import { TokenHookTabs } from '../app/docs/TokenHooks/ComponentTabs';
import { AcceptRejectTabs } from '../app/docs/Utilities/AcceptRejectTabs';
import {
  DiffHunksTabs,
  VanillaComponentTabs,
  VanillaPropTabs,
} from '../app/docs/VanillaAPI/ComponentTabs';

const diffsMDXComponents = {
  DocsCodeExample,
  CustomHunkSeparators,
  MultiFileDiff,
  PackageManagerTabs,
  CodeToggle,
  ComponentTabs,
  SharedPropTabs,
  TokenHookTabs,
  AcceptRejectTabs,
  DiffHunksTabs,
  VanillaComponentTabs,
  VanillaPropTabs,
};

export const { renderMDX, renderMDXWithPreloadedFiles } =
  createRenderMDX(diffsMDXComponents);
