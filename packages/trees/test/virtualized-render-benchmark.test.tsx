import { describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { h } from 'preact';
import { renderToString } from 'preact-render-to-string';

import {
  assertComparableRenderBenchmarkBaseline,
  type BenchmarkConfig,
} from '../scripts/benchmarkVirtualizedFileTreeRender';
import { Root } from '../src/components/Root';

const packageRoot = fileURLToPath(new URL('../', import.meta.url));

function createConfig(
  overrides: Partial<BenchmarkConfig> = {}
): BenchmarkConfig {
  return {
    runs: 1,
    warmupRuns: 0,
    outputJson: true,
    caseFilters: ['tiny-flat'],
    windowStart: 0,
    windowSize: 5,
    itemHeight: 30,
    viewportHeight: 500,
    ...overrides,
  };
}

function createBaseline(configOverrides: Partial<BenchmarkConfig> = {}) {
  return {
    path: '/tmp/baseline.json',
    output: {
      config: createConfig(configOverrides),
    },
  };
}

function createComparison(
  overrides: Partial<{
    unmatchedCurrentCases: string[];
    checksumMismatches: string[];
  }> = {}
) {
  return {
    unmatchedCurrentCases: [],
    checksumMismatches: [],
    ...overrides,
  };
}

describe('virtualized render benchmark helpers', () => {
  test('Root can SSR a deterministic virtualized window', () => {
    const html = renderToString(
      h(Root, {
        fileTreeOptions: {
          id: 'benchmark-ssr-window',
          initialFiles: ['a.ts', 'b.ts', 'c.ts'],
          sort: false,
          virtualize: { threshold: 0 },
        },
        virtualizedRenderWindow: {
          range: { start: 0, end: 1 },
          itemHeight: 30,
          viewportHeight: 60,
        },
      })
    );

    expect(html).toContain('a.ts');
    expect(html).toContain('b.ts');
    expect(html).not.toContain('c.ts');
    expect(html.split('data-type="item"')).toHaveLength(3);
  });

  test('compare validation rejects incompatible virtual window settings', () => {
    expect(() =>
      assertComparableRenderBenchmarkBaseline(
        createBaseline({ windowSize: 10 }),
        createComparison(),
        createConfig()
      )
    ).toThrow('baseline windowSize=10 does not match current windowSize=5');
  });

  test('compare validation rejects HTML mismatches', () => {
    expect(() =>
      assertComparableRenderBenchmarkBaseline(
        createBaseline(),
        createComparison({ checksumMismatches: ['tiny-flat'] }),
        createConfig()
      )
    ).toThrow(
      'baseline HTML output does not match current output for cases: tiny-flat'
    );
  });

  test('CLI compare exits non-zero when the baseline window is incompatible', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'render-benchmark-cli-'));
    const baselinePath = join(tempDir, 'baseline.json');

    try {
      const baselineResult = Bun.spawnSync({
        cmd: [
          'bun',
          'run',
          './scripts/benchmarkVirtualizedFileTreeRender.ts',
          '--case=tiny-flat',
          '--runs=1',
          '--warmup-runs=0',
          '--window-size=5',
          '--json',
        ],
        cwd: packageRoot,
        env: {
          ...process.env,
          AGENT: '1',
        },
        stdout: 'pipe',
        stderr: 'pipe',
      });

      expect(baselineResult.exitCode).toBe(0);
      writeFileSync(baselinePath, baselineResult.stdout);

      const compareResult = Bun.spawnSync({
        cmd: [
          'bun',
          'run',
          './scripts/benchmarkVirtualizedFileTreeRender.ts',
          '--case=tiny-flat',
          '--runs=1',
          '--warmup-runs=0',
          '--window-size=10',
          '--compare',
          baselinePath,
          '--json',
        ],
        cwd: packageRoot,
        env: {
          ...process.env,
          AGENT: '1',
        },
        stdout: 'pipe',
        stderr: 'pipe',
      });

      const compareStderr = new TextDecoder()
        .decode(compareResult.stderr)
        .trim();

      expect(compareResult.exitCode).not.toBe(0);
      expect(compareStderr).toContain(
        'baseline windowSize=5 does not match current windowSize=10'
      );
    } finally {
      rmSync(tempDir, { force: true, recursive: true });
    }
  });
});

// These tests spawn benchmark subprocesses and are meant for local iteration,
// not CI. Run them explicitly with: bun test --test-name-pattern "render benchmark CLI"
describe.skip('render benchmark CLI', () => {
  test('emits JSON for a filtered smoke run', () => {
    const result = Bun.spawnSync({
      cmd: [
        'bun',
        'run',
        './scripts/benchmarkVirtualizedFileTreeRender.ts',
        '--case=tiny-flat',
        '--runs=1',
        '--warmup-runs=0',
        '--window-size=5',
        '--json',
      ],
      cwd: packageRoot,
      env: {
        ...process.env,
        AGENT: '1',
      },
      stdout: 'pipe',
      stderr: 'pipe',
    });

    const stdout = new TextDecoder().decode(result.stdout).trim();
    const stderr = new TextDecoder().decode(result.stderr).trim();

    expect(result.exitCode).toBe(0);
    expect(stderr).toBe('');

    const payload = JSON.parse(stdout) as {
      benchmark: string;
      config: {
        runs: number;
        warmupRuns: number;
        caseFilters: string[];
        windowSize: number;
      };
      cases: Array<{
        name: string;
        fileCount: number;
        renderedItemCount: number;
        htmlChecksum: number;
      }>;
    };

    expect(payload.benchmark).toBe('virtualizedFileTreeRender');
    expect(payload.config.runs).toBe(1);
    expect(payload.config.warmupRuns).toBe(0);
    expect(payload.config.caseFilters).toEqual(['tiny-flat']);
    expect(payload.config.windowSize).toBe(5);
    expect(payload.cases).toHaveLength(1);
    expect(payload.cases[0]).toMatchObject({
      name: 'tiny-flat',
      fileCount: 128,
      renderedItemCount: 5,
    });
    expect(payload.cases[0]?.htmlChecksum).toBeGreaterThan(0);
  });

  test('compares the current run against a saved baseline', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'render-benchmark-compare-'));
    const baselinePath = join(tempDir, 'baseline.json');

    try {
      const baselineResult = Bun.spawnSync({
        cmd: [
          'bun',
          'run',
          './scripts/benchmarkVirtualizedFileTreeRender.ts',
          '--case=tiny-flat',
          '--runs=1',
          '--warmup-runs=0',
          '--window-size=5',
          '--json',
        ],
        cwd: packageRoot,
        env: {
          ...process.env,
          AGENT: '1',
        },
        stdout: 'pipe',
        stderr: 'pipe',
      });

      expect(baselineResult.exitCode).toBe(0);
      expect(new TextDecoder().decode(baselineResult.stderr).trim()).toBe('');
      writeFileSync(baselinePath, baselineResult.stdout);

      const compareResult = Bun.spawnSync({
        cmd: [
          'bun',
          'run',
          './scripts/benchmarkVirtualizedFileTreeRender.ts',
          '--case=tiny-flat',
          '--runs=1',
          '--warmup-runs=0',
          '--window-size=5',
          '--compare',
          baselinePath,
          '--json',
        ],
        cwd: packageRoot,
        env: {
          ...process.env,
          AGENT: '1',
        },
        stdout: 'pipe',
        stderr: 'pipe',
      });

      const compareStdout = new TextDecoder()
        .decode(compareResult.stdout)
        .trim();
      const compareStderr = new TextDecoder()
        .decode(compareResult.stderr)
        .trim();

      expect(compareResult.exitCode).toBe(0);
      expect(compareStderr).toBe('');

      const payload = JSON.parse(compareStdout) as {
        config: { comparePath?: string };
        comparison: {
          baselinePath: string;
          unmatchedCurrentCases: string[];
          unmatchedBaselineCases: string[];
          checksumMismatches: string[];
          cases: Array<{
            name: string;
            htmlChecksumMatches: boolean;
            renderedItemCountMatches: boolean;
            htmlLengthMatches: boolean;
          }>;
        };
      };

      expect(payload.config.comparePath).toBe(baselinePath);
      expect(payload.comparison.baselinePath).toBe(baselinePath);
      expect(payload.comparison.unmatchedCurrentCases).toEqual([]);
      expect(payload.comparison.unmatchedBaselineCases).toEqual([]);
      expect(payload.comparison.checksumMismatches).toEqual([]);
      expect(payload.comparison.cases).toHaveLength(1);
      expect(payload.comparison.cases[0]).toMatchObject({
        name: 'tiny-flat',
        htmlChecksumMatches: true,
        renderedItemCountMatches: true,
        htmlLengthMatches: true,
      });
    } finally {
      rmSync(tempDir, { force: true, recursive: true });
    }
  });
});
