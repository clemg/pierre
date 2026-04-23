#!/usr/bin/env bun

import { execSync, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';

// `--diff-filter=d` excludes deletions, including the old-path side of
// renames. Without this, renaming a workspace dir (e.g. `apps/diffs-docs`
// -> `apps/docs-diffs`) makes `--name-only` emit both paths and we'd try
// to run tsc inside the now-nonexistent old directory.
const stagedFiles = execSync('git diff --cached --name-only --diff-filter=d', {
  encoding: 'utf8',
})
  .split('\n')
  .map((line) => line.trim())
  .filter(Boolean);

const workspaceDirs = new Set<string>();

for (const file of stagedFiles) {
  const parts = file.split('/');
  if (parts.length >= 2 && (parts[0] === 'apps' || parts[0] === 'packages')) {
    const workspace = `${parts[0]}/${parts[1]}`;
    // Defensive: skip workspaces that no longer exist on disk (e.g. a stash
    // or partial revert that re-stages a deleted directory).
    if (existsSync(workspace)) {
      workspaceDirs.add(workspace);
    }
  }
}

if (workspaceDirs.size === 0) {
  console.log('[precommit-tsc] no workspace changes detected');
  process.exit(0);
}

for (const workspace of workspaceDirs) {
  console.log(`[precommit-tsc][${workspace}] running tsc`);
  const result = spawnSync('bun', ['run', 'tsc'], {
    cwd: workspace,
    stdio: 'inherit',
    env: { ...process.env, FORCE_COLOR: '1' },
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}
