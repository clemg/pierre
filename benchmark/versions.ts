// Builds and serves the benchmarked branches inside this container. The
// bench keeps one git clone under DATA_DIR, adds the upstream remote, and
// for each requested version checks the branch head out into a per-version
// worktree, installs and builds it, then runs its `next start` on a local
// port for the duration of the runs that need it. Builds are cached by
// commit sha in the volume, and the branch is re-fetched on every matrix
// submission, so a version is rebuilt exactly when its branch moved.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { PATCH_PROXY_PORT } from './patchProxy';

export interface Version {
  key: string;
  label: string;
  remote: 'origin' | 'upstream';
  ref: string;
  description: string;
}

export const VERSIONS: Version[] = [
  {
    key: 'main',
    label: 'main (baseline)',
    remote: 'upstream',
    ref: 'main',
    description: 'pierrecomputer/pierre main — what production diffshub runs',
  },
  {
    key: 'beta-1.3',
    label: 'beta-1.3',
    remote: 'upstream',
    ref: 'beta-1.3',
    description: 'pierrecomputer/pierre beta-1.3',
  },
  {
    key: 'byte-arena-parsing',
    label: 'byte arena + parser (PR #775)',
    remote: 'origin',
    ref: 'clemg/byte-arena-parsing',
    description:
      'per-file UTF-8 byte arena plus byte-level patch parsing and streaming (clemg/byte-arena-parsing)',
  },
];

const ORIGIN_URL =
  process.env.ORIGIN_URL ?? 'https://github.com/clemg/pierre.git';
const UPSTREAM_URL =
  process.env.UPSTREAM_URL ?? 'https://github.com/pierrecomputer/pierre.git';
const ARM_PORT = Number(process.env.ARM_PORT ?? 4600);
// Bump when the build recipe changes (toolchain, route rewrite…): cached
// builds from an older recipe are then rebuilt instead of reused
const BUILD_RECIPE = 'node22-patchcache-v1';
const BUILD_TIMEOUT_MS = 30 * 60_000;
const START_TIMEOUT_MS = 90_000;

export type LogHook = (line: string) => void;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function dataDir(): string {
  return process.env.DATA_DIR ?? join(import.meta.dir, 'data');
}

function repoDir(): string {
  return join(dataDir(), 'repo');
}

function buildDir(version: Version): string {
  return join(dataDir(), 'builds', version.key);
}

// Runs a command, streaming a light tail of its output to the live log so
// visitors can watch clones/installs/builds progress. Throws on failure.
async function run(
  command: string[],
  options: { cwd: string; env?: Record<string, string>; log: LogHook },
  timeoutMs = BUILD_TIMEOUT_MS
): Promise<void> {
  options.log(`$ ${command.join(' ')}`);
  const child = Bun.spawn(command, {
    cwd: options.cwd,
    env: { ...process.env, ...options.env },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  let lastLines: string[] = [];
  let lastEmit = 0;
  const tail = async (stream: ReadableStream<Uint8Array>) => {
    const decoder = new TextDecoder();
    let buffer = '';
    for await (const chunk of stream) {
      buffer += decoder.decode(chunk, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop()!;
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed === '') {
          continue;
        }
        lastLines.push(trimmed);
        if (lastLines.length > 25) {
          lastLines.shift();
        }
        // At most one log line per second per stream to keep the feed sane
        const now = Date.now();
        if (now - lastEmit >= 1000) {
          lastEmit = now;
          options.log(`  ${trimmed.slice(0, 200)}`);
        }
      }
    }
  };
  const tails = Promise.all([tail(child.stdout), tail(child.stderr)]);
  const timeout = setTimeout(() => child.kill(9), timeoutMs);
  const exitCode = await child.exited;
  clearTimeout(timeout);
  await tails.catch(() => {});
  if (exitCode !== 0) {
    const detail = lastLines.join(' | ').slice(0, 1500);
    throw new Error(
      `${command.slice(0, 2).join(' ')} failed (${exitCode}): ${detail}`
    );
  }
}

async function ensureRepo(log: LogHook): Promise<void> {
  mkdirSync(dataDir(), { recursive: true });
  if (!existsSync(join(repoDir(), '.git'))) {
    log(`cloning ${ORIGIN_URL}…`);
    await run(['git', 'clone', ORIGIN_URL, repoDir()], {
      cwd: dataDir(),
      log,
    });
    await run(['git', 'remote', 'add', 'upstream', UPSTREAM_URL], {
      cwd: repoDir(),
      log,
    });
  }
}

// Fetches the version's branch and returns its current commit sha.
export async function resolveSha(
  version: Version,
  log: LogHook
): Promise<string> {
  await ensureRepo(log);
  await run(['git', 'fetch', version.remote, version.ref], {
    cwd: repoDir(),
    log,
  });
  const result = Bun.spawnSync(['git', 'rev-parse', 'FETCH_HEAD'], {
    cwd: repoDir(),
  });
  const sha = result.stdout.toString().trim();
  if (result.exitCode !== 0 || sha === '') {
    throw new Error(`could not resolve ${version.remote}/${version.ref}`);
  }
  return sha;
}

export interface PreparedVersion {
  sha: string;
  appDir: string;
  nextBin: string;
}

// The diffshub app moved from apps/docs (NEXT_PUBLIC_SITE=diffshub) to a
// dedicated apps/diffshub along the way; prefer the dedicated app when the
// branch has one so each version is benchmarked as it actually ships.
function findAppDir(root: string): string {
  return existsSync(join(root, 'apps/diffshub'))
    ? join(root, 'apps/diffshub')
    : join(root, 'apps/docs');
}

function markerPath(version: Version): string {
  return join(buildDir(version), '.bench-built-sha');
}

function builtMarker(version: Version): string | undefined {
  try {
    return readFileSync(markerPath(version), 'utf8').trim();
  } catch {
    return undefined;
  }
}

export function builtSha(version: Version): string | undefined {
  const marker = builtMarker(version);
  if (marker == null) {
    return undefined;
  }
  return marker.includes(':') ? marker.split(':')[1] : undefined;
}

// Checks out the branch head into the version's worktree and builds it
// (workspace packages first, then the Next app). No-op when the cached
// build already matches the branch head.
export async function prepareVersion(
  version: Version,
  log: LogHook
): Promise<PreparedVersion> {
  const sha = await resolveSha(version, log);
  const root = buildDir(version);
  if (builtMarker(version) === `${BUILD_RECIPE}:${sha}`) {
    log(`${version.key}: build cache hit (${sha.slice(0, 8)})`);
    const appDir = findAppDir(root);
    return { sha, appDir, nextBin: nextBin(root, appDir) };
  }

  log(
    `${version.key}: building ${sha.slice(0, 8)} (first build takes a few minutes)`
  );
  if (!existsSync(join(root, '.git'))) {
    mkdirSync(join(dataDir(), 'builds'), { recursive: true });
    await run(['git', 'worktree', 'add', '--detach', root, sha], {
      cwd: repoDir(),
      log,
    });
  } else {
    await run(['git', 'checkout', '--force', '--detach', sha], {
      cwd: root,
      log,
    });
  }

  await run(['bun', 'install'], { cwd: root, log });

  // The monorepo builds its libraries with tsdown, driven by moon (the
  // `tsdown` task tag runs `tsdown --clean`); there are no package.json
  // `build` scripts to call here — moon owns building. The bench runs Next
  // directly without moon, so it must replicate that one build step itself,
  // otherwise no `dist/` is emitted and the Next app fails to resolve every
  // `@pierre/*` workspace dependency (module-not-found at build time). So
  // build every package that ships a tsdown config. tsdown emits isolated
  // declarations, so one package's build never needs another's dist; we
  // still build the ones with no workspace deps first to mirror moon's
  // `^:build` dependency ordering.
  const packagesDir = join(root, 'packages');
  if (existsSync(packagesDir)) {
    const tsdownPackages: { dir: string; workspaceDepCount: number }[] = [];
    for (const entry of new Bun.Glob('*/package.json').scanSync(packagesDir)) {
      const packageRoot = join(packagesDir, entry, '..');
      if (!existsSync(join(packageRoot, 'tsdown.config.ts'))) {
        continue;
      }
      const manifest = JSON.parse(
        readFileSync(join(packagesDir, entry), 'utf8')
      ) as { dependencies?: Record<string, string> };
      const workspaceDepCount = Object.keys(manifest.dependencies ?? {}).filter(
        (name) => name.startsWith('@pierre/')
      ).length;
      tsdownPackages.push({ dir: packageRoot, workspaceDepCount });
    }
    tsdownPackages.sort((a, b) => a.workspaceDepCount - b.workspaceDepCount);
    for (const pkg of tsdownPackages) {
      await run(['bun', 'x', 'tsdown', '--clean'], { cwd: pkg.dir, log });
    }
  }

  const appDir = findAppDir(root);
  rewriteRouteForPatchCache(appDir, log);
  // Next must run under real node: under bun (no node in PATH), Turbopack
  // builds fail to emit the metadata routes' app-paths-manifest.json
  await run(['node', nextBin(root, appDir), 'build'], {
    cwd: appDir,
    env: { NEXT_PUBLIC_SITE: 'diffshub' },
    log,
  });

  writeFileSync(markerPath(version), `${BUILD_RECIPE}:${sha}`);
  log(`${version.key}: build done`);
  return { sha, appDir, nextBin: nextBin(root, appDir) };
}

// Path of the version's Next CLI entrypoint; run with `node` explicitly so
// the build never silently falls back to bun's node shim.
function nextBin(root: string, appDir: string): string {
  const local = join(appDir, 'node_modules/next/dist/bin/next');
  return existsSync(local)
    ? local
    : join(root, 'node_modules/next/dist/bin/next');
}

// Rewrites the version's diff API route so its single patch fetch goes
// through the bench's local caching proxy: a patch is downloaded from the
// real upstream once and then served from disk for every later run. The
// rewrite is identical for every version, so it cannot bias the comparison.
function rewriteRouteForPatchCache(appDir: string, log: LogHook): void {
  const routePath = join(appDir, 'app/api/diff/route.ts');
  if (!existsSync(routePath)) {
    log(
      'warning: diff route not found, patch caching disabled for this version'
    );
    return;
  }
  let source = readFileSync(routePath, 'utf8');
  if (source.includes('benchCacheFetch')) {
    return;
  }
  const fetchSite = 'await fetch(patchURL, {';
  if (!source.includes(fetchSite)) {
    log(
      'warning: unexpected diff route shape, patch caching disabled for this version'
    );
    return;
  }
  source = source.replace(fetchSite, 'await benchCacheFetch(patchURL, {');
  source += `
// bench harness: patch downloads go through the local caching proxy so a
// patch is fetched from the real upstream exactly once across all runs.
function benchCacheFetch(input: string | URL, init?: RequestInit) {
  return fetch(
    \`http://127.0.0.1:${PATCH_PROXY_PORT}/proxy?url=\${encodeURIComponent(String(input))}\`,
    init
  );
}
`;
  writeFileSync(routePath, source);
  log('patch fetches routed through the local patch cache');
}

export interface RunningArm {
  url: string;
  stop(): Promise<void>;
}

// Starts the built app on the internal arm port and waits until it serves.
export async function startArm(
  prepared: PreparedVersion,
  log: LogHook
): Promise<RunningArm> {
  const url = `http://127.0.0.1:${ARM_PORT}`;
  log(`starting server on :${ARM_PORT}…`);
  const child = Bun.spawn(
    ['node', prepared.nextBin, 'start', '-p', String(ARM_PORT)],
    {
      cwd: prepared.appDir,
      env: { ...process.env, NEXT_PUBLIC_SITE: 'diffshub' },
      stdout: 'ignore',
      stderr: 'ignore',
    }
  );
  const deadline = Date.now() + START_TIMEOUT_MS;
  for (;;) {
    if (Date.now() > deadline) {
      child.kill(9);
      throw new Error('arm server did not come up in time');
    }
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2000) });
      if (response.ok) {
        break;
      }
    } catch {
      // not up yet
    }
    await sleep(500);
  }
  return {
    url,
    async stop() {
      child.kill();
      const exited = await Promise.race([
        child.exited.then(() => true),
        sleep(5000).then(() => false),
      ]);
      if (!exited) {
        child.kill(9);
        await Promise.race([child.exited, sleep(2000)]);
      }
    },
  };
}
