import { preloadFileTree } from '@pierre/trees/ssr';

import { BulkIngestDemoClient } from '../_demos/BulkIngestDemoClient';
import { DEFAULT_BULK_EXPERIMENT_WORKLOAD_NAME } from '../_lib/bulkExperimentMeta';
import { BULK_EXPERIMENT_PREVIEW_DATA } from '../_lib/bulkExperimentPreviewData';
import { createPresortedPreparedInput } from '../_lib/createPresortedPreparedInput';
import { FILE_TREE_PROOF_VIEWPORT_HEIGHT } from '../_lib/workloadMeta';

export default function TreesDevBulkPage() {
  const previewData =
    BULK_EXPERIMENT_PREVIEW_DATA[DEFAULT_BULK_EXPERIMENT_WORKLOAD_NAME];
  const payload = preloadFileTree({
    flattenEmptyDirectories: false,
    id: 'trees-dev-bulk-ssr',
    initialExpansion: 'open',
    paths: previewData.previewPaths,
    preparedInput: createPresortedPreparedInput(previewData.previewPaths),
    search: true,
    viewportHeight: FILE_TREE_PROOF_VIEWPORT_HEIGHT,
  });

  return <BulkIngestDemoClient payloadHtml={payload.html} />;
}
