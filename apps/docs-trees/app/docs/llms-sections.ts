import type { LlmsSiteConfig } from '../../../../scripts/llms-types';

export const llmsSections: LlmsSiteConfig = {
  productId: 'trees',
  docsPrefix: 'docs',
  docsUrl: 'https://trees.software/docs',
  llmsTxtPath: 'public/llms.txt',
  llmsFullTxtPath: 'public/llms-full.txt',
  sections: [
    'Guides/ChooseYourIntegration',
    'Guides/GetStartedWithReact',
    'Guides/GetStartedWithVanilla',
    'Guides/ShapeTreeDataForFastRendering',
    'Guides/NavigateSelectionFocusAndSearch',
    'Guides/RenameDragAndTriggerItemActions',
    'Guides/StyleAndThemeTheTree',
    'Guides/CustomizeIcons',
    'Guides/ShowGitStatusAndRowAnnotations',
    'Guides/HandleLargeTreesEfficiently',
    'Guides/SSR',
    'Reference/SharedConcepts',
    'Reference/ReactAPI',
    'Reference/VanillaAPI',
    'Reference/SSRAPI',
    'Reference/StylingAndTheming',
    'Reference/Icons',
  ],
  sectionDescriptions: {
    'Guides/ChooseYourIntegration':
      'Choosing between React and vanilla, with the shared path-first model',
    'Guides/GetStartedWithReact':
      'React quickstart with useFileTree, FileTree, selectors, and prepared input',
    'Guides/GetStartedWithVanilla':
      'Vanilla quickstart with new FileTree, render, model methods, and prepared input',
    'Guides/ShapeTreeDataForFastRendering':
      'When to use paths, prepared input, and presorted prepared input',
    'Guides/NavigateSelectionFocusAndSearch':
      'Selection, focus, keyboard movement, and fileTreeSearchMode guidance',
    'Guides/RenameDragAndTriggerItemActions':
      'Renaming, drag and drop, and optional context menu workflows',
    'Guides/StyleAndThemeTheTree':
      'Host styling, CSS variables, themeToTreeStyles, and unsafeCSS guidance',
    'Guides/CustomizeIcons':
      'Built-in icon sets, remaps, color mode, and sprite-sheet extension',
    'Guides/ShowGitStatusAndRowAnnotations':
      'Built-in gitStatus signals and custom row decorations',
    'Guides/HandleLargeTreesEfficiently':
      'Prepared input, virtualization settings, and SSR guidance for large trees',
    'Guides/SSR':
      'Server preload, React and vanilla hydration, and opaque SSR handoff guidance',
    'Reference/SharedConcepts':
      'Path-first identity, shared options, search modes, mutation vocabulary, and SSR framing',
    'Reference/ReactAPI':
      'useFileTree, FileTree, selector hooks, and React-specific composition lookup',
    'Reference/VanillaAPI':
      'FileTree construction, lifecycle, imperative methods, and subscriptions',
    'Reference/SSRAPI':
      'preloadFileTree, serializeFileTreeSsrPayload, and hydration handoff rules',
    'Reference/StylingAndTheming':
      'Host styling, CSS variable families, fallback precedence, and theme helpers',
    'Reference/Icons':
      'Icon sets, FileTreeIconConfig, remap precedence, and runtime touchpoints',
  },
  mdxFilenameOverrides: {},
  seeAlso: [
    {
      label: '@pierre/diffs',
      url: 'https://diffs.com/llms.txt',
      description: 'Diff and code rendering library',
    },
    {
      label: 'Full documentation',
      url: 'https://trees.software/llms-full.txt',
      description: 'Complete @pierre/trees docs in a single file',
    },
  ],
};
