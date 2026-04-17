import { FileTree } from '@pierre/trees/react';
import { preloadFileTree } from '@pierre/trees/ssr';
import Link from 'next/link';
import type { CSSProperties } from 'react';

import { TreeExampleHeading } from '../../components/TreeExampleHeading';
import { FeatureHeader } from '../../diff-examples/FeatureHeader';
import {
  baseTreeOptions,
  DEFAULT_FILE_TREE_PANEL_CLASS,
  DEFAULT_FILE_TREE_PANEL_STYLE,
} from './demo-data';
import { TreeExampleSection } from './TreeExampleSection';

const PRESELECTED_FILE = 'src/components/Button.tsx';

function densityStyle(density: number): CSSProperties {
  return {
    ...DEFAULT_FILE_TREE_PANEL_STYLE,
    ['--trees-density-override' as string]: density,
  };
}

function createPrerenderedHTML(id: string): string {
  return preloadFileTree(
    { ...baseTreeOptions, id },
    { initialSelectedItems: [PRESELECTED_FILE] }
  ).shadowHtml;
}

const tightHTML = createPrerenderedHTML('density-demo-tight');
const defaultHTML = createPrerenderedHTML('density-demo-default');
const relaxedHTML = createPrerenderedHTML('density-demo-relaxed');

export function DensitySection() {
  return (
    <TreeExampleSection>
      <FeatureHeader
        id="density"
        title="Adjustable density"
        description={
          <>
            Control the visual density of the entire tree with a single CSS
            variable. Set <code>--trees-density-override</code> to a unitless
            scale factor and row height, padding, gaps, and indentation all
            adjust together. See the{' '}
            <Link href="/preview/trees/docs#styling" className="inline-link">
              Styling docs
            </Link>{' '}
            for more info.
          </>
        }
      />
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <div>
          <TreeExampleHeading description="--trees-density-override: 0.8">
            Tight
          </TreeExampleHeading>
          <FileTree
            className={DEFAULT_FILE_TREE_PANEL_CLASS}
            prerenderedHTML={tightHTML}
            options={{ ...baseTreeOptions, id: 'density-demo-tight' }}
            initialSelectedItems={[PRESELECTED_FILE]}
            style={densityStyle(0.8)}
          />
        </div>
        <div>
          <TreeExampleHeading description="--trees-density-override: 1 (default)">
            Default
          </TreeExampleHeading>
          <FileTree
            className={DEFAULT_FILE_TREE_PANEL_CLASS}
            prerenderedHTML={defaultHTML}
            options={{ ...baseTreeOptions, id: 'density-demo-default' }}
            initialSelectedItems={[PRESELECTED_FILE]}
            style={densityStyle(1)}
          />
        </div>
        <div>
          <TreeExampleHeading description="--trees-density-override: 1.25">
            Relaxed
          </TreeExampleHeading>
          <FileTree
            className={DEFAULT_FILE_TREE_PANEL_CLASS}
            prerenderedHTML={relaxedHTML}
            options={{ ...baseTreeOptions, id: 'density-demo-relaxed' }}
            initialSelectedItems={[PRESELECTED_FILE]}
            style={densityStyle(1.25)}
          />
        </div>
      </div>
    </TreeExampleSection>
  );
}
