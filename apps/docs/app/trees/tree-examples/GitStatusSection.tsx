import { preloadFileTree } from '@pierre/trees/ssr';

import { sampleFileList } from '../../trees/demo-data';
import { baseTreeOptions, GIT_STATUSES_A, toReactTreeProps } from './demo-data';
import { GitStatusSectionClient } from './GitStatusSectionClient';

const { model: gitStatusModel, options: gitStatusOptions } = toReactTreeProps({
  ...baseTreeOptions,
  id: 'path-colors-git-status-demo',
  initialFiles: sampleFileList,
  gitStatus: GIT_STATUSES_A,
});

const prerenderedHTML = preloadFileTree(
  {
    model: gitStatusModel,
    ...gitStatusOptions,
  },
  {
    initialExpandedItems: ['src', 'src/components'],
  }
).shadowHtml;

export function GitStatusSection() {
  return <GitStatusSectionClient prerenderedHTML={prerenderedHTML} />;
}
