import type { TreeThemeStyles } from '@pierre/trees';
import { preloadFileTree } from '@pierre/trees/ssr';

import { baseTreeOptions, GIT_STATUSES_A, toReactTreeProps } from './demo-data';
import { ThemingSectionClient } from './ThemingSectionClient';

const { model: themingModel, options: themingReactOptions } = toReactTreeProps({
  ...baseTreeOptions,
  id: 'shiki-themes-tree',
  gitStatus: GIT_STATUSES_A,
});

const prerenderedHTML = preloadFileTree(
  {
    model: themingModel,
    ...themingReactOptions,
  },
  {
    initialExpandedItems: ['src', 'src/components'],
    initialSelectedItems: ['package.json'],
  }
).shadowHtml;

const initialThemeStyles: TreeThemeStyles = {
  colorScheme: 'light',
};

export function ThemingSection() {
  return (
    <ThemingSectionClient
      prerenderedHTML={prerenderedHTML}
      initialThemeStyles={initialThemeStyles}
    />
  );
}
