// Shared Playwright configuration factory for both docs apps. Returns a
// `PlaywrightTestConfig` (typed via `import type` so docs-shared does not
// need a runtime dep on `@playwright/test`); each app passes the result to
// `defineConfig` from its own `@playwright/test`.
import type { PlaywrightTestConfig } from '@playwright/test';
import { devices } from '@playwright/test';

export interface CreateDocsPlaywrightConfigArgs {
  /** Final port the docs app's `bun run start` will bind to. */
  port: number;
  /**
   * Slug used to derive the per-app `/tmp/<slug>-playwright-results` output
   * directory. Pass e.g. `'pierre-docs-diffs'`.
   */
  slug: string;
  /**
   * Optional port offset (typically `Number(process.env.PIERRE_PORT_OFFSET ??
   * 0)`). When non-zero the offset is appended to the output directory so
   * concurrent worktrees do not race on the same `/tmp` dir.
   */
  portOffset?: number;
  /** Path the webServer health-check should hit. Defaults to `'/'`. */
  startPath?: string;
}

export function createDocsPlaywrightConfig({
  port,
  slug,
  portOffset = 0,
  startPath = '/',
}: CreateDocsPlaywrightConfigArgs): PlaywrightTestConfig {
  const baseUrl = `http://127.0.0.1:${port}`;
  const outputDir = `/tmp/${slug}-playwright-results${portOffset > 0 ? `-${portOffset}` : ''}`;

  return {
    testDir: '.',
    testMatch: ['**/*.pw.ts'],
    outputDir,
    fullyParallel: true,
    reporter: 'list',
    timeout: 30_000,
    expect: {
      timeout: 5_000,
    },
    use: {
      baseURL: baseUrl,
      headless: true,
      viewport: { width: 1400, height: 1000 },
    },
    webServer: {
      command: `PORT=${port} bun run start`,
      url: `${baseUrl}${startPath}`,
      reuseExistingServer: false,
      timeout: 60_000,
    },
    projects: [
      {
        name: 'chromium',
        use: { ...devices['Desktop Chrome'] },
      },
    ],
  };
}
