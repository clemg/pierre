// diffshub bench server: a queue of benchmark passes, executed strictly one
// at a time (concurrent runs would contend for CPU/RAM and corrupt each
// other's numbers), with every state change / console line / screencast frame
// broadcast to all connected viewers over SSE — visitors watch runs live.
//
// The benchmarked versions are branches that this server clones, builds and
// serves itself (see versions.ts); a matrix submission re-fetches each
// selected branch so the bench always compares current branch states.

import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { startPatchProxy } from './patchProxy';
import { runPass } from './runner';
import type { PassResult, PassSpec } from './runner';
import { builtSha, prepareVersion, startArm, VERSIONS } from './versions';
import type { RunningArm, Version } from './versions';

const PORT = Number(process.env.PORT ?? 3000);
const DATA_DIR = process.env.DATA_DIR ?? join(import.meta.dir, 'data');
const RESULTS_PATH = join(DATA_DIR, 'results.jsonl');
const PUBLIC_DIR = join(import.meta.dir, 'public');
const MAX_QUEUED_PASSES = 64;
const HISTORY_LIMIT = 1000;
const SSE_PING_INTERVAL_MS = 20_000;

const DIFF_PRESETS = [
  {
    label: 'pierre commit (0.6MB)',
    path: '/pierrecomputer/pierre/commit/0800fb',
    timeoutMs: 3 * 60_000,
  },
  {
    label: 'node PR (11MB)',
    path: '/nodejs/node/pull/59805',
    timeoutMs: 5 * 60_000,
  },
  {
    label: 'ghostty PR (3.4MB)',
    path: '/ghostty-org/ghostty/pull/12291',
    timeoutMs: 5 * 60_000,
  },
  {
    label: 'bun PR (41MB)',
    path: '/oven-sh/bun/pull/30412',
    timeoutMs: 10 * 60_000,
  },
  {
    label: 'bun compare (76MB)',
    path: '/oven-sh/bun/compare/bun-v1.2.15...bun-v1.3.14',
    timeoutMs: 10 * 60_000,
  },
  {
    label: 'linux v6.0..v7.0 (678MB)',
    path: '/torvalds/linux/compare/v6.0...v7.0',
    timeoutMs: 25 * 60_000,
  },
];
const CUSTOM_DIFF_TIMEOUT_MS = 15 * 60_000;

interface QueuedPass extends PassSpec {
  id: number;
}

interface CurrentRun {
  pass: QueuedPass;
  phase: string;
  startedAt: string;
}

let nextPassId = 1;
const queue: QueuedPass[] = [];
let current: CurrentRun | null = null;
let cancelRequested = false;
// Screencast frames are only emitted when the page repaints, so a viewer who
// connects mid-run would see nothing until the next paint — keep the latest
// frame to seed new connections
let lastFrame: string | null = null;
const results: PassResult[] = loadResults();

// ---------------------------------------------------------------- SSE hub

interface SSEClient {
  send(type: string, data: unknown): void;
  ping(): void;
  closed: boolean;
}

const sseClients = new Set<SSEClient>();

function broadcast(type: string, data: unknown): void {
  for (const client of sseClients) {
    if (client.closed) {
      sseClients.delete(client);
    } else {
      client.send(type, data);
    }
  }
}

function log(line: string): void {
  broadcast('log', { line });
}

function publicState() {
  return {
    versions: VERSIONS.map((version) => ({
      key: version.key,
      label: version.label,
      description: version.description,
      builtSha: builtSha(version)?.slice(0, 8),
    })),
    diffs: DIFF_PRESETS.map((diff) => ({ label: diff.label, path: diff.path })),
    queue: queue.map((pass) => ({
      id: pass.id,
      version: pass.version,
      diff: pass.diff,
      passIndex: pass.passIndex,
    })),
    current:
      current == null
        ? null
        : {
            id: current.pass.id,
            version: current.pass.version,
            diff: current.pass.diff,
            passIndex: current.pass.passIndex,
            phase: current.phase,
            startedAt: current.startedAt,
          },
  };
}

function broadcastState(): void {
  broadcast('state', publicState());
}

// ------------------------------------------------------------- the runner

function findVersion(key: string): Version | undefined {
  return VERSIONS.find((version) => version.key === key);
}

function failedResult(pass: QueuedPass, error: string): PassResult {
  return {
    version: pass.version,
    diff: pass.diff,
    passIndex: pass.passIndex,
    startedAt: new Date().toISOString(),
    durationMs: 0,
    ok: false,
    error,
    spans: {},
  };
}

async function runnerLoop(): Promise<void> {
  // The arm (the version's built app server) stays up across consecutive
  // passes of the same version and is stopped when the version changes or
  // the queue drains, so at most one arm consumes RAM at any time
  let arm: RunningArm | null = null;
  let armVersionKey: string | null = null;
  const stopArm = async () => {
    if (arm != null) {
      await arm.stop();
      arm = null;
      armVersionKey = null;
    }
  };

  for (;;) {
    const pass = queue.shift();
    if (pass == null) {
      await stopArm();
      await new Promise((resolve) => setTimeout(resolve, 500));
      continue;
    }
    cancelRequested = false;
    lastFrame = null;
    current = { pass, phase: 'preparing', startedAt: new Date().toISOString() };
    broadcastState();
    log(
      `── run #${pass.id}: ${pass.version} × ${pass.diff} (pass ${pass.passIndex})`
    );

    let result: PassResult;
    try {
      if (armVersionKey !== pass.version) {
        await stopArm();
        const version = findVersion(pass.version)!;
        const prepared = await prepareVersion(version, log);
        if (current != null) {
          current.phase = 'starting server';
          broadcastState();
        }
        arm = await startArm(prepared, log);
        armVersionKey = pass.version;
        broadcastState();
      }
      result = await runPass(
        { ...pass, armUrl: arm!.url },
        {
          log,
          frame: (jpegBase64) => {
            lastFrame = jpegBase64;
            broadcast('frame', { jpeg: jpegBase64 });
          },
          phase: (phase) => {
            if (current != null) {
              current.phase = phase;
              broadcastState();
            }
          },
          isCancelled: () => cancelRequested,
        }
      );
    } catch (error) {
      // Build/start failures land here; the pass fails but the queue lives on
      result = failedResult(
        pass,
        error instanceof Error ? error.message : String(error)
      );
      await stopArm();
    }

    results.push(result);
    if (results.length > HISTORY_LIMIT) {
      results.shift();
    }
    appendFileSync(RESULTS_PATH, JSON.stringify(result) + '\n');
    broadcast('result', result);
    log(
      result.ok
        ? `── run #${pass.id} done in ${Math.round(result.durationMs / 1000)}s`
        : `── run #${pass.id} FAILED: ${result.error}`
    );
    current = null;
    broadcastState();
  }
}

function loadResults(): PassResult[] {
  if (!existsSync(RESULTS_PATH)) {
    return [];
  }
  const lines = readFileSync(RESULTS_PATH, 'utf8').split('\n').filter(Boolean);
  return lines
    .slice(-HISTORY_LIMIT)
    .map((line) => JSON.parse(line) as PassResult)
    .filter((result) => result.version != null);
}

// ------------------------------------------------------------------ HTTP

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

interface BenchRequestBody {
  selections?: { version?: string; diff?: string }[];
  customPath?: string;
  passes?: number;
}

interface BenchCell {
  version: Version;
  diff: { label: string; path: string; timeoutMs: number };
}

async function handleBenchRequest(request: Request): Promise<Response> {
  let body: BenchRequestBody;
  try {
    body = (await request.json()) as BenchRequestBody;
  } catch {
    return json({ error: 'invalid JSON body' }, 400);
  }
  const customPath =
    typeof body.customPath === 'string' && body.customPath.startsWith('/')
      ? body.customPath
      : null;
  const passes = Math.max(1, Math.min(5, Math.floor(body.passes ?? 1)));

  const cells: BenchCell[] = [];
  for (const selection of body.selections ?? []) {
    const version = findVersion(selection.version ?? '');
    if (version == null) {
      continue;
    }
    if (selection.diff === 'custom') {
      if (customPath != null) {
        cells.push({
          version,
          diff: {
            label: `custom ${customPath}`,
            path: customPath,
            timeoutMs: CUSTOM_DIFF_TIMEOUT_MS,
          },
        });
      }
      continue;
    }
    const preset = DIFF_PRESETS.find((diff) => diff.label === selection.diff);
    if (preset != null) {
      cells.push({ version, diff: preset });
    }
  }

  if (cells.length === 0) {
    return json({ error: 'select at least one version × diff cell' }, 400);
  }
  const totalPasses = passes * cells.length;
  if (queue.length + totalPasses > MAX_QUEUED_PASSES) {
    return json(
      {
        error: `queue full (${queue.length} pending, max ${MAX_QUEUED_PASSES})`,
      },
      429
    );
  }
  // Pass-major rounds: every selected cell runs once before any second pass
  // starts, so slow machine drift spreads evenly across versions
  for (let passIndex = 1; passIndex <= passes; passIndex++) {
    for (const cell of cells) {
      queue.push({
        id: nextPassId++,
        version: cell.version.key,
        armUrl: '',
        diff: cell.diff.label,
        diffPath: cell.diff.path,
        passIndex,
        timeoutMs: cell.diff.timeoutMs,
      });
    }
  }
  broadcastState();
  return json({ queued: totalPasses });
}

function handleEvents(): Response {
  let controllerRef: ReadableStreamDefaultController<Uint8Array>;
  let pingTimer: ReturnType<typeof setInterval> | null = null;
  const encoder = new TextEncoder();
  const client: SSEClient = {
    closed: false,
    send(type, data) {
      try {
        controllerRef.enqueue(
          encoder.encode(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`)
        );
      } catch {
        this.closed = true;
      }
    },
    // Comment frames keep proxies (Traefik) from closing the idle stream
    ping() {
      try {
        controllerRef.enqueue(encoder.encode(`: ping\n\n`));
      } catch {
        this.closed = true;
      }
    },
  };
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controllerRef = controller;
      sseClients.add(client);
      pingTimer = setInterval(() => client.ping(), SSE_PING_INTERVAL_MS);
      client.send('hello', {
        ...publicState(),
        results: results.slice(-300),
        lastFrame,
      });
    },
    cancel() {
      client.closed = true;
      sseClients.delete(client);
      if (pingTimer != null) {
        clearInterval(pingTimer);
      }
    },
  });
  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    },
  });
}

async function serveStatic(pathname: string): Promise<Response> {
  const name = pathname === '/' ? 'index.html' : pathname.slice(1);
  if (name.includes('..') || name.includes('/')) {
    return new Response('not found', { status: 404 });
  }
  const file = Bun.file(join(PUBLIC_DIR, name));
  if (!(await file.exists())) {
    return new Response('not found', { status: 404 });
  }
  return new Response(file);
}

mkdirSync(DATA_DIR, { recursive: true });
startPatchProxy(log);

Bun.serve({
  port: PORT,
  idleTimeout: 0,
  async fetch(request) {
    const { pathname } = new URL(request.url);
    if (pathname === '/api/events') {
      return handleEvents();
    }
    if (pathname === '/api/state') {
      return json({ ...publicState(), results: results.slice(-300) });
    }
    if (pathname === '/api/bench' && request.method === 'POST') {
      return handleBenchRequest(request);
    }
    if (pathname === '/api/cancel' && request.method === 'POST') {
      queue.length = 0;
      cancelRequested = true;
      broadcastState();
      return json({ ok: true });
    }
    if (pathname === '/api/results.jsonl') {
      return new Response(
        results.map((result) => JSON.stringify(result)).join('\n'),
        { headers: { 'content-type': 'application/jsonl' } }
      );
    }
    return serveStatic(pathname);
  },
});

void runnerLoop();
console.log(`bench server on :${PORT}`);
