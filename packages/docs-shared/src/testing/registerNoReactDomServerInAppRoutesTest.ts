// Structural guard shared by both docs apps. Each app's
// `test/no-react-dom-server-in-app-routes.test.mjs` resolves its own
// `appRoot`/`docsRoot` and calls this helper, which scans every source file
// under `appRoot` and fails if any of them imports `react-dom/server`.
//
// The check exists because Next's App Router server renders pages with the
// streaming React Server Component renderer; pulling in `react-dom/server`
// from a route accidentally inflates the route bundle and can break SSR
// streaming.
import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const SOURCE_FILE_EXTENSIONS = new Set(['.js', '.jsx', '.mjs', '.ts', '.tsx']);
const REACT_DOM_SERVER_PATTERN =
  /(?:from\s+['"]react-dom\/server['"]|import\(\s*['"]react-dom\/server['"]\s*\)|require\(\s*['"]react-dom\/server['"]\s*\))/;

function collectSourceFiles(rootDir: string): string[] {
  const entries = readdirSync(rootDir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const entryPath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectSourceFiles(entryPath));
      continue;
    }
    if (SOURCE_FILE_EXTENSIONS.has(path.extname(entry.name))) {
      files.push(entryPath);
    }
  }

  return files;
}

export interface NoReactDomServerInAppRoutesTestArgs {
  /** Absolute path to the app's `app/` directory (the Next route root). */
  appRoot: string;
  /** Absolute path to the docs app root, used only to relativize offender paths. */
  docsRoot: string;
}

export function registerNoReactDomServerInAppRoutesTest({
  appRoot,
  docsRoot,
}: NoReactDomServerInAppRoutesTestArgs): void {
  describe('docs app route import guard', () => {
    test('app routes do not import react-dom/server', () => {
      const offenders = collectSourceFiles(appRoot)
        .filter((filePath) =>
          REACT_DOM_SERVER_PATTERN.test(readFileSync(filePath, 'utf8'))
        )
        .map((filePath) => path.relative(docsRoot, filePath))
        .sort();

      expect(offenders).toEqual([]);
    });
  });
}
