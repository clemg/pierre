import { IconCollapsedRow, IconEyeSlash, IconFolderOpen } from '@pierre/icons';
import { FileTree } from '@pierre/trees/react';
import { preloadFileTree } from '@pierre/trees/ssr';
import Link from 'next/link';
import type { CSSProperties } from 'react';

import { TreeExampleHeading } from '../../components/TreeExampleHeading';
import { FeatureHeader } from '../../diff-examples/FeatureHeader';
import {
  DEFAULT_FILE_TREE_PANEL_CLASS,
  searchOptions,
  toReactTreeProps,
} from './demo-data';
import { TreeExampleSection } from './TreeExampleSection';

const PREPOPULATED_SEARCH = 'tsx';
const PRESELECTED_FILE = 'src/components/Button.tsx';

const searchModeStyle = {
  colorScheme: 'dark',
  '--trees-search-bg-override': 'light-dark(#fff, oklch(14.5% 0 0))',
} as CSSProperties;

function createSearchTreeProps(
  mode: 'hide-non-matches' | 'collapse-non-matches' | 'expand-matches',
  id: string
) {
  const { model, options } = toReactTreeProps({
    ...searchOptions(mode),
    id,
  });

  const prerenderedHTML = preloadFileTree(
    {
      model,
      ...options,
    },
    {
      initialSearchQuery: PREPOPULATED_SEARCH,
      initialSelectedItems: [PRESELECTED_FILE],
    }
  ).shadowHtml;

  return { model, options, prerenderedHTML };
}

const hideNonMatchesTree = createSearchTreeProps(
  'hide-non-matches',
  'search-demo-hide-non-matches'
);
const collapseNonMatchesTree = createSearchTreeProps(
  'collapse-non-matches',
  'search-demo-collapse-non-matches'
);
const expandMatchesTree = createSearchTreeProps(
  'expand-matches',
  'search-demo-expand-matches'
);

export function SearchSection() {
  return (
    <TreeExampleSection>
      <FeatureHeader
        id="search"
        title="Search and filter by name"
        description={
          <>
            Filter the tree by typing in the search field. Search across file
            paths and names. Trees includes three{' '}
            <Link
              href="/preview/trees/docs#core-types-filetreesearchmode"
              className="inline-link"
            >
              <code>fileTreeSearchMode</code>
            </Link>{' '}
            options to control how non-matching items are shown. All three demos
            below start with search prepopulated to show the different modes.
          </>
        }
      />
      <div className="space-y-4">
        <div className="grid min-h-[934px] grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <TreeExampleHeading
              icon={<IconEyeSlash />}
              description="Hides files and folders without any matches"
            >
              <code>hide-non-matches</code>
            </TreeExampleHeading>
            <FileTree
              model={hideNonMatchesTree.model}
              className={DEFAULT_FILE_TREE_PANEL_CLASS}
              prerenderedHTML={hideNonMatchesTree.prerenderedHTML}
              options={hideNonMatchesTree.options}
              initialSearchQuery={PREPOPULATED_SEARCH}
              initialSelectedItems={[PRESELECTED_FILE]}
              style={searchModeStyle}
            />
          </div>
          <div>
            <TreeExampleHeading
              icon={<IconCollapsedRow />}
              description="Collapses folders without any matches"
            >
              <code>collapse-non-matches</code>
            </TreeExampleHeading>
            <FileTree
              model={collapseNonMatchesTree.model}
              className={DEFAULT_FILE_TREE_PANEL_CLASS}
              prerenderedHTML={collapseNonMatchesTree.prerenderedHTML}
              options={collapseNonMatchesTree.options}
              initialSearchQuery={PREPOPULATED_SEARCH}
              initialSelectedItems={[PRESELECTED_FILE]}
              style={searchModeStyle}
            />
          </div>
          <div>
            <TreeExampleHeading
              icon={<IconFolderOpen />}
              description="Keeps all items visible and expand folders with matches"
            >
              <code>expand-matches</code>
            </TreeExampleHeading>
            <FileTree
              model={expandMatchesTree.model}
              className={DEFAULT_FILE_TREE_PANEL_CLASS}
              prerenderedHTML={expandMatchesTree.prerenderedHTML}
              options={expandMatchesTree.options}
              initialSearchQuery={PREPOPULATED_SEARCH}
              initialSelectedItems={[PRESELECTED_FILE]}
              style={searchModeStyle}
            />
          </div>
        </div>
      </div>
    </TreeExampleSection>
  );
}
