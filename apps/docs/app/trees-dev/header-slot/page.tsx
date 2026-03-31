import { preloadFileTree } from '@pierre/trees/ssr';

import { readSettingsCookies } from '../_components/readSettingsCookies';
import {
  sharedDemoFileTreeOptions,
  sharedDemoStateConfig,
  toRuntimeFileTreeOptions,
} from '../demo-data';
import { HeaderSlotDemoClient } from './HeaderSlotDemoClient';

export default async function HeaderSlotPage() {
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
    <HeaderSlotDemoClient
      preloadedFileTreeHtml={mainSsr.shadowHtml}
      preloadedFileTreeContainerHtml={mainSsr.html}
    />
  );
}
