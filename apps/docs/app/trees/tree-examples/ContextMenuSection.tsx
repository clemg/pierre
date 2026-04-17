import { preloadFileTree } from '@pierre/trees/ssr';

import { ContextMenuSectionClient } from './ContextMenuSectionClient';
import { baseTreeOptions } from './demo-data';

const DEMO_ID = 'context-menu-demo';

const prerenderedHTML = preloadFileTree(
  {
    ...baseTreeOptions,
    id: DEMO_ID,
  },
  {
    initialExpandedItems: ['src', 'src/components'],
  }
).shadowHtml;

export function ContextMenuSection() {
  return <ContextMenuSectionClient prerenderedHTML={prerenderedHTML} />;
}
