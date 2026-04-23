import { preloadFile, type PreloadFileOptions } from '@pierre/diffs/ssr';
import {
  IconArrowRight,
  IconBulbFill,
  IconCiWarningFill,
  IconFlagFill,
  IconInfoFill,
} from '@pierre/icons';
import { compileMDX } from 'next-mdx-remote/rsc';
import Link from 'next/link';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ComponentPropsWithoutRef, ComponentType } from 'react';
import remarkGfm from 'remark-gfm';

import { Button } from '../components/ui/button';
import { Notice } from '../components/ui/notice';
import rehypeHierarchicalSlug from './rehype-hierarchical-slug';
import remarkTocIgnore from './remark-toc-ignore';

function MdxLink(props: ComponentPropsWithoutRef<'a'>) {
  const href = props.href;

  if (href?.startsWith('/') === true) {
    return <Link {...props} href={href} />;
  }

  if (href?.startsWith('#') === true) {
    return <a {...props} />;
  }

  return <a target="_blank" rel="noopener noreferrer" {...props} />;
}

// MDX's component slot is intentionally open-ended: each entry can be a
// component with any prop shape. `React.ComponentType<P>` is contravariant in
// `P`, so substituting `unknown` (or any concrete record) here would reject
// well-typed app components like `MultiFileDiff`. The upstream `mdx/types`
// `MDXComponents` alias uses the same `any` for the same reason.
// oxlint-disable-next-line typescript-eslint/no-explicit-any
export type MDXComponents = Record<string, ComponentType<any>>;

/** Components that are universally available in every docs MDX file. */
export const baseMDXComponents = {
  a: MdxLink,
  Link,
  Button,
  Notice,
  IconArrowRight,
  IconCiWarningFill,
  IconInfoFill,
  IconBulbFill,
  IconFlagFill,
} as const;

export interface RenderMDXOptions {
  /**
   * Path to the MDX file relative to the app's `app/` directory. Each app
   * passes its own `appCwd` so the shared renderer can read from the right
   * project root regardless of where the script runs.
   */
  filePath: string;
  /** App-specific MDX components merged on top of {@link baseMDXComponents}. */
  components?: MDXComponents;
  /** Data passed to MDX scope - available as variables in MDX. */
  scope?: Record<string, unknown>;
  /**
   * Project root for the calling app (defaults to `process.cwd()`). Pass an
   * explicit absolute path when invoking from scripts that may run from a
   * different cwd (e.g. the shared llms-txt generator).
   */
  appCwd?: string;
}

/**
 * Render an MDX file with components and scope data.
 * Works in React Server Components with Turbopack.
 */
export async function renderMDX({
  filePath,
  components,
  scope = {},
  appCwd = process.cwd(),
}: RenderMDXOptions) {
  const fullPath = join(appCwd, 'app', filePath);
  const source = await readFile(fullPath, 'utf-8');

  const { content } = await compileMDX({
    source,
    components: { ...baseMDXComponents, ...components },
    options: {
      parseFrontmatter: true,
      blockJS: false,
      mdxOptions: {
        remarkPlugins: [remarkGfm, remarkTocIgnore],
        rehypePlugins: [[rehypeHierarchicalSlug, { levels: [2, 3, 4] }]],
      },
      scope,
    },
  });

  return content;
}

/**
 * Preload every file snippet in parallel via `preloadFile` and expose each
 * preloaded result to the MDX scope under its original export key. Authors can
 * then use `<DocsCodeExample {...foo} />` inside MDX, where `foo` is the name
 * of the exported `PreloadFileOptions` constant in a sibling `constants.ts`.
 */
export async function renderMDXWithPreloadedFiles(
  filePath: string,
  files: Readonly<Record<string, PreloadFileOptions<unknown>>>,
  components?: MDXComponents,
  appCwd?: string
) {
  const entries = Object.entries(files);
  const results = await Promise.all(
    entries.map(([, opts]) => preloadFile(opts))
  );
  const scope: Record<string, unknown> = {};
  for (let i = 0; i < entries.length; i++) {
    scope[entries[i][0]] = results[i];
  }
  return renderMDX({ filePath, scope, components, appCwd });
}

/**
 * Build a thin per-app `renderMDX` wrapper that closes over the app-specific
 * MDX components map (and its `app/` cwd if it differs from `process.cwd()`).
 */
export function createRenderMDX(
  defaultComponents: MDXComponents,
  appCwd?: string
) {
  function appRenderMDX(
    options: Omit<RenderMDXOptions, 'components' | 'appCwd'> & {
      components?: MDXComponents;
    }
  ) {
    return renderMDX({
      ...options,
      components: { ...defaultComponents, ...options.components },
      appCwd,
    });
  }

  function appRenderMDXWithPreloadedFiles(
    filePath: string,
    files: Readonly<Record<string, PreloadFileOptions<unknown>>>,
    components?: MDXComponents
  ) {
    return renderMDXWithPreloadedFiles(
      filePath,
      files,
      { ...defaultComponents, ...components },
      appCwd
    );
  }

  return {
    renderMDX: appRenderMDX,
    renderMDXWithPreloadedFiles: appRenderMDXWithPreloadedFiles,
  };
}
