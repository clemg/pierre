import { registerNoReactDomServerInAppRoutesTest } from '@pierre/docs-shared/testing/registerNoReactDomServerInAppRoutesTest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const docsRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..'
);
const appRoot = path.join(docsRoot, 'app');

registerNoReactDomServerInAppRoutesTest({ appRoot, docsRoot });
