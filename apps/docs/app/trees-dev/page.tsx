import { preloadFileTree } from '@pierre/trees/ssr';

import { readSettingsCookies } from './_components/readSettingsCookies';
import {
  sharedDemoFileTreeOptions,
  sharedDemoStateConfig,
  toRuntimeFileTreeOptions,
} from './demo-data';
import { RenderingDemoClient } from './RenderingDemoClient';

export default async function TreesDevIndexPage() {
  const { flattenEmptyDirectories, useLazyDataLoader } =
    await readSettingsCookies();
  const fileTreeOptions = {
    ...sharedDemoFileTreeOptions,
    flattenEmptyDirectories,
    useLazyDataLoader,
  };

  const mainSsr = preloadFileTree(
    toRuntimeFileTreeOptions(fileTreeOptions),
    sharedDemoStateConfig
  );

  return (
    <RenderingDemoClient
      preloadedFileTreeHtml={mainSsr.shadowHtml}
      preloadedFileTreeContainerHtml={mainSsr.html}
    />
  );
}
