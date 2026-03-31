import { preloadFileTree } from '@pierre/trees/ssr';

import { readSettingsCookies } from '../_components/readSettingsCookies';
import {
  sharedDemoFileTreeOptions,
  sharedDemoStateConfig,
  toRuntimeFileTreeOptions,
} from '../demo-data';
import { StateDemoClient } from './StateDemoClient';

export default async function StatePage() {
  const { flattenEmptyDirectories, useLazyDataLoader } =
    await readSettingsCookies();
  const fileTreeOptions = {
    ...sharedDemoFileTreeOptions,
    flattenEmptyDirectories,
    useLazyDataLoader,
  };

  const runtimeOptions = toRuntimeFileTreeOptions(fileTreeOptions);
  const mainSsr = preloadFileTree(runtimeOptions, sharedDemoStateConfig);
  const controlledSsr = preloadFileTree(runtimeOptions, {
    ...sharedDemoStateConfig,
    initialSelectedItems: ['Build/assets/images/social/logo.png'],
  });

  return (
    <StateDemoClient
      preloadedFileTreeHtml={mainSsr.shadowHtml}
      preloadedFileTreeContainerHtml={mainSsr.html}
      preloadedControlledFileTreeHtml={controlledSsr.shadowHtml}
    />
  );
}
