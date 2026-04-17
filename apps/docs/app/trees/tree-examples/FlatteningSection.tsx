import { preloadPathStoreFileTree } from '@pierre/trees/path-store';
import Link from 'next/link';

import { FeatureHeader } from '../../diff-examples/FeatureHeader';
import { flatteningPathStoreOptions } from './demo-data';
import {
  FLATTENED_EXPANDED_PATHS,
  FLATTENED_VIEWPORT_HEIGHT,
  HIERARCHICAL_EXPANDED_PATHS,
  HIERARCHICAL_VIEWPORT_HEIGHT,
} from './flattening-config';
import { FlatteningSectionClient } from './FlatteningSectionClient';
import { TreeExampleSection } from './TreeExampleSection';

const hierarchicalPreloaded = preloadPathStoreFileTree({
  ...flatteningPathStoreOptions(false),
  id: 'flatten-demo-hierarchical',
  initialExpandedPaths: HIERARCHICAL_EXPANDED_PATHS,
  viewportHeight: HIERARCHICAL_VIEWPORT_HEIGHT,
});

const flattenedPreloaded = preloadPathStoreFileTree({
  ...flatteningPathStoreOptions(true),
  id: 'flatten-demo-flattened',
  initialExpandedPaths: FLATTENED_EXPANDED_PATHS,
  viewportHeight: FLATTENED_VIEWPORT_HEIGHT,
});

export function FlatteningSection() {
  return (
    <TreeExampleSection>
      <FeatureHeader
        id="flatten"
        title="Flatten empty directories"
        description={
          <>
            Enable the <code>flattenEmptyDirectories</code> boolean option in{' '}
            <code>FileTreeOptions</code> to collapse single-child folder chains
            into one row for a more compact tree.{' '}
            <Link
              href="/preview/trees/docs#core-types-filetreeoptions"
              className="inline-link"
            >
              More about FileTreeOptions…
            </Link>
          </>
        }
      />

      <FlatteningSectionClient
        hierarchicalPreloaded={hierarchicalPreloaded}
        flattenedPreloaded={flattenedPreloaded}
      />
    </TreeExampleSection>
  );
}
