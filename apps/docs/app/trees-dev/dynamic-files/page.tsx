import { preloadFileTree } from '@pierre/trees/ssr';

import { readSettingsCookies } from '../_components/readSettingsCookies';
import {
  sharedDemoFileTreeOptions,
  sharedDemoStateConfig,
  toRuntimeFileTreeOptions,
} from '../demo-data';
import { DynamicFilesDemoClient } from './DynamicFilesDemoClient';

export default async function DynamicFilesPage() {
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

  return <DynamicFilesDemoClient preloadedFileTreeHtml={mainSsr.shadowHtml} />;
}
