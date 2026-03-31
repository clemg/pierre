import { preloadFileTree } from '@pierre/trees/ssr';

import { dragDropOptions, toReactTreeProps } from './demo-data';
import { DragDropSectionClient } from './DragDropSectionClient';

const { model: dragDropModel, options: dragDropReactOptions } =
  toReactTreeProps({
    ...dragDropOptions(['package.json']),
    id: 'drag-drop-demo-locked',
  });

const prerenderedHTML = preloadFileTree({
  model: dragDropModel,
  ...dragDropReactOptions,
}).shadowHtml;

export function DragDropSection() {
  return <DragDropSectionClient prerenderedHTML={prerenderedHTML} />;
}
