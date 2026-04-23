// Pre-flight check used by both docs apps' `test:e2e` script: verify the
// Playwright Chromium binary is present locally so the test runner can fall
// through to a `playwright install` command otherwise.
import { chromium } from '@playwright/test';
import { existsSync } from 'node:fs';

export function checkPlaywrightBinary(): void {
  const executablePath = chromium.executablePath();

  if (existsSync(executablePath)) {
    process.exit(0);
  }

  console.error(
    `[docs:e2e] Missing Playwright Chromium binary at: ${executablePath}`
  );
  process.exit(1);
}
