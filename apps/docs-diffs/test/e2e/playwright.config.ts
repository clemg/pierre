import { createDocsPlaywrightConfig } from '@pierre/docs-shared/testing/createDocsPlaywrightConfig';
import { defineConfig } from '@playwright/test';

import { loadWorktreeEnv } from '../../../../scripts/load-worktree-env.mjs';

// Pull `PIERRE_PORT_OFFSET` from `.env.worktree` when Playwright is launched
// outside a `bun ws` call (e.g. `bunx playwright test` from the package root).
loadWorktreeEnv();

const portOffset = Number(process.env.PIERRE_PORT_OFFSET ?? 0);

export default defineConfig(
  createDocsPlaywrightConfig({
    port: 4174 + portOffset,
    portOffset,
    slug: 'pierre-docs-diffs',
  })
);
