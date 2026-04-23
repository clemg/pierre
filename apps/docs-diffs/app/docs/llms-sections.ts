import type { LlmsSiteConfig } from '../../../../scripts/llms-types';

export const llmsSections: LlmsSiteConfig = {
  productId: 'diffs',
  docsPrefix: 'docs',
  docsUrl: 'https://diffs.com/docs',
  llmsTxtPath: 'public/llms.txt',
  llmsFullTxtPath: 'public/llms-full.txt',
  sections: [
    'Overview',
    'Installation',
    'CoreTypes',
    'ReactAPI',
    'VanillaAPI',
    'Virtualization',
    'CustomHunkSeparators',
    'Utilities',
    'Styling',
    'Theming',
    'WorkerPool',
    'SSR',
  ],
  sectionDescriptions: {
    Overview: 'What diffs is, architecture, and getting started',
    Installation: 'Package installation and entry points',
    CoreTypes:
      'FileContents, FileDiffMetadata, and creating diffs from files or patches',
    ReactAPI:
      'MultiFileDiff, PatchDiff, FileDiff, File components and shared props',
    VanillaAPI:
      'FileDiff and File classes, props, deprecated vanilla custom hunk separators, and low-level renderers',
    Virtualization: 'Virtual scrolling for large diffs and files',
    CustomHunkSeparators:
      'Built-in separator presets, CSS customization hooks, and the discouraged vanilla escape hatch',
    Utilities:
      'parseDiffFromFile, parsePatchFiles, highlighter management, accept/reject hunks',
    Styling: 'CSS variables, inline styles, and unsafe CSS injection',
    Theming:
      'Pierre Light/Dark themes, custom theme creation, and registration',
    WorkerPool:
      'Off-main-thread syntax highlighting with configurable worker pools',
    SSR: 'Server-side rendering with preload functions for instant first paint',
  },
  mdxFilenameOverrides: {
    'docs/Theming': 'docs-content.mdx',
  },
  seeAlso: [
    {
      label: '@pierre/trees',
      url: 'https://trees.software/llms.txt',
      description: 'File tree rendering library',
    },
    {
      label: 'Full documentation',
      url: 'https://diffs.com/llms-full.txt',
      description: 'Complete @pierre/diffs docs in a single file',
    },
  ],
};
