// Runs one benchmark pass: launches a fresh Chromium with a throwaway
// profile (the OS peak-memory counter lives and dies with the process, so
// reusing a browser between passes would leak the previous pass's peak),
// loads one diff on one arm, waits for diffshub's own "reading patch stream"
// console span to fire, then samples renderer memory before and after a
// forced GC. Screencast frames and console lines are forwarded live.

import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { CDPConnection } from './cdp';
import { findMainRenderer } from './metrics';

export interface PassSpec {
  version: string;
  armUrl: string;
  diff: string;
  diffPath: string;
  passIndex: number;
  timeoutMs: number;
}

export interface MemorySample {
  rssMB: number;
  swapMB: number;
  peakMB: number;
  jsHeapMB?: number;
  domNodes?: number;
}

export interface PassResult {
  version: string;
  diff: string;
  passIndex: number;
  startedAt: string;
  durationMs: number;
  ok: boolean;
  error?: string;
  parseMs?: number;
  mainThreadMs?: number;
  spans: Record<string, number>;
  settled?: MemorySample;
  afterGC?: MemorySample;
  rendererCount?: number;
}

export interface PassHooks {
  log(line: string): void;
  frame(jpegBase64: string): void;
  phase(phase: string): void;
  isCancelled(): boolean;
}

const PARSE_SPAN_PATTERN = /reading patch stream/i;
const SETTLE_MS = 15_000;
const AFTER_GC_WAIT_MS = 4000;
// At most ~6 screencast frames/s forwarded to viewers
const FRAME_INTERVAL_MS = 160;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function defaultChromeBin(): string {
  if (process.env.CHROME_BIN) {
    return process.env.CHROME_BIN;
  }
  if (process.platform === 'darwin') {
    return '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  }
  // Prefer Google's official build: it is PGO-optimized, distro chromium is
  // not, and that is worth double-digit percent on V8-heavy work
  return existsSync('/usr/bin/google-chrome-stable')
    ? '/usr/bin/google-chrome-stable'
    : 'chromium';
}

export async function runPass(
  spec: PassSpec,
  hooks: PassHooks
): Promise<PassResult> {
  const startedAt = new Date().toISOString();
  const startTime = Date.now();
  const result: PassResult = {
    version: spec.version,
    diff: spec.diff,
    passIndex: spec.passIndex,
    startedAt,
    durationMs: 0,
    ok: false,
    spans: {},
  };

  const profileDir = mkdtempSync(join(tmpdir(), 'bench-profile-'));
  const chromeCommand = [
    defaultChromeBin(),
    '--headless=new',
    '--no-sandbox',
    '--disable-gpu',
    '--disable-dev-shm-usage',
    `--user-data-dir=${profileDir}`,
    '--remote-debugging-port=0',
    // An occluded/backgrounded page gets its timers clamped to ~1Hz, which
    // stalls diffshub's yield-to-browser streaming loop — never throttle
    '--disable-background-timer-throttling',
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
    '--no-first-run',
    '--no-default-browser-check',
    '--mute-audio',
    '--window-size=1440,900',
    // rAF must not wait for the virtual 60Hz vsync: the app's streamed
    // parse yields via requestAnimationFrame between work slices, and at
    // linux-diff scale those waits add tens of seconds of idle wall time
    '--disable-frame-rate-limit',
    '--disable-gpu-vsync',
    'about:blank',
  ];
  // Shield the renderer from neighbor load when we can raise priority
  if (process.platform === 'linux' && process.getuid?.() === 0) {
    chromeCommand.unshift('nice', '-n', '-10');
  }
  const chrome = Bun.spawn(chromeCommand, {
    stderr: 'pipe',
    stdout: 'ignore',
  });

  let browser: CDPConnection | undefined;
  let pendingFrameTimer: ReturnType<typeof setTimeout> | null = null;
  try {
    const wsUrl = await waitForDevtoolsUrl(chrome.stderr, 15_000);
    // Keep draining stderr so Chrome never blocks on a full pipe
    void drainStream(chrome.stderr);
    browser = await CDPConnection.connect(wsUrl);

    const { targetId } = await browser.send('Target.createTarget', {
      url: 'about:blank',
    });
    const { sessionId } = await browser.send('Target.attachToTarget', {
      targetId,
      flatten: true,
    });

    let parseDone = false;
    let crashed = false;
    let lastFrameTime = 0;
    let pendingFrame: string | null = null;
    // Throttles frames to the viewer but always delivers the latest one, so
    // the final paint (the rendered diff) is never dropped
    const forwardFrame = (jpegBase64: string) => {
      const now = Date.now();
      if (now - lastFrameTime >= FRAME_INTERVAL_MS) {
        lastFrameTime = now;
        hooks.frame(jpegBase64);
        return;
      }
      pendingFrame = jpegBase64;
      pendingFrameTimer ??= setTimeout(
        () => {
          pendingFrameTimer = null;
          if (pendingFrame != null) {
            lastFrameTime = Date.now();
            hooks.frame(pendingFrame);
            pendingFrame = null;
          }
        },
        FRAME_INTERVAL_MS - (now - lastFrameTime)
      );
    };
    // Non-streamed (non-git) patches never log the stream span; their
    // pipeline ends with "computing layout" after "reading patch" completed
    let sawNonStreamedRead = false;

    browser.onEvent((event) => {
      if (event.method === 'Inspector.targetCrashed') {
        crashed = true;
        return;
      }
      if (event.sessionId !== sessionId) {
        return;
      }
      if (event.method === 'Page.screencastFrame') {
        const params = event.params as {
          data: string;
          sessionId: number;
        };
        browser!
          .send(
            'Page.screencastFrameAck',
            { sessionId: params.sessionId },
            sessionId
          )
          .catch(() => {});
        forwardFrame(params.data);
      } else if (event.method === 'Runtime.consoleAPICalled') {
        const params = event.params as {
          type: string;
          args: { value?: unknown }[];
        };
        const text = params.args
          .map((argument) =>
            typeof argument.value === 'string'
              ? argument.value
              : JSON.stringify(argument.value)
          )
          .join(' ');
        if (params.type === 'timeEnd') {
          const span = parseTimeEnd(text);
          if (span != null) {
            result.spans[span.label] = span.ms;
            hooks.log(`⏱ ${span.label}: ${formatMs(span.ms)}`);
            if (PARSE_SPAN_PATTERN.test(span.label)) {
              result.parseMs = span.ms;
              parseDone = true;
            } else if (
              span.label.includes('reading patch') &&
              !span.label.includes('stream')
            ) {
              sawNonStreamedRead = true;
            } else if (
              sawNonStreamedRead &&
              span.label.includes('computing layout')
            ) {
              const parseSpan = Object.entries(result.spans).find(([label]) =>
                label.includes('parsing patches')
              );
              result.parseMs = parseSpan?.[1];
              parseDone = true;
            }
          }
        } else if (params.type === 'error') {
          hooks.log(`✗ console.error: ${text.slice(0, 300)}`);
        }
      }
    });

    await browser.send('Page.enable', {}, sessionId);
    await browser.send('Runtime.enable', {}, sessionId);
    await browser.send('Inspector.enable', {}, sessionId);
    await browser.send('Performance.enable', {}, sessionId);
    await browser.send('HeapProfiler.enable', {}, sessionId);
    await browser.send(
      'Page.startScreencast',
      { format: 'jpeg', quality: 60, maxWidth: 1400, maxHeight: 1050 },
      sessionId
    );

    const url = spec.armUrl.replace(/\/$/, '') + spec.diffPath;
    hooks.phase('loading');
    hooks.log(`→ ${url}`);
    const taskDurationBaseline = await readTaskDuration(browser, sessionId);
    const navigation = (await browser.send(
      'Page.navigate',
      { url },
      sessionId
    )) as { errorText?: string };
    if (navigation.errorText != null && navigation.errorText !== '') {
      throw new Error(`navigation failed: ${navigation.errorText}`);
    }

    hooks.phase('parsing');
    const deadline = startTime + spec.timeoutMs;
    while (!parseDone && !crashed && Date.now() < deadline) {
      if (hooks.isCancelled()) {
        throw new Error('cancelled');
      }
      await sleep(500);
    }
    if (crashed) {
      // A renderer OOM-kill is a real benchmark result, not a harness error
      result.error = 'renderer crashed (likely out of memory)';
      hooks.log('✗ renderer crashed');
      return result;
    }
    if (!parseDone) {
      result.error = `timeout: parse span not seen after ${Math.round(spec.timeoutMs / 1000)}s`;
      return result;
    }

    // Wall time above includes the patch download; the CPU cost of parsing
    // is the renderer's main-thread task time over the same window
    const taskDuration = await readTaskDuration(browser, sessionId);
    if (taskDuration != null && taskDurationBaseline != null) {
      result.mainThreadMs = Math.round(
        (taskDuration - taskDurationBaseline) * 1000
      );
      hooks.log(`⏱ main thread (CPU): ${formatMs(result.mainThreadMs)}`);
    }

    hooks.phase('settling');
    await sleep(SETTLE_MS);
    result.settled = await sampleMemory(browser, sessionId, chrome.pid);
    logSample(hooks, 'settled', result.settled);

    hooks.phase('gc');
    for (let i = 0; i < 3; i++) {
      await browser.send('HeapProfiler.collectGarbage', {}, sessionId);
      await sleep(1200);
    }
    await sleep(AFTER_GC_WAIT_MS);
    result.afterGC = await sampleMemory(browser, sessionId, chrome.pid);
    logSample(hooks, 'after GC', result.afterGC);

    const renderer = findMainRenderer(chrome.pid);
    result.rendererCount = renderer?.rendererCount;
    result.ok = result.settled != null && result.afterGC != null;
    if (!result.ok) {
      result.error = 'could not read renderer memory from the OS';
    }
    return result;
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error);
    return result;
  } finally {
    result.durationMs = Date.now() - startTime;
    if (pendingFrameTimer != null) {
      clearTimeout(pendingFrameTimer);
    }
    browser?.close();
    // The next pass must start from a dead browser (its renderers hold the
    // memory being measured), so escalate to SIGKILL if SIGTERM hangs —
    // otherwise one stuck Chromium would block the queue forever
    chrome.kill();
    const exited = await Promise.race([
      chrome.exited.then(() => true),
      sleep(5000).then(() => false),
    ]);
    if (!exited) {
      chrome.kill(9);
      await Promise.race([chrome.exited, sleep(2000)]);
    }
    rmSync(profileDir, { recursive: true, force: true });
  }
}

// Cumulative main-thread task time (seconds) of the page since
// Performance.enable, from the DevTools Performance domain.
async function readTaskDuration(
  browser: CDPConnection,
  sessionId: string
): Promise<number | undefined> {
  try {
    const { metrics } = (await browser.send(
      'Performance.getMetrics',
      {},
      sessionId
    )) as { metrics: { name: string; value: number }[] };
    return metrics.find((entry) => entry.name === 'TaskDuration')?.value;
  } catch {
    return undefined;
  }
}

async function sampleMemory(
  browser: CDPConnection,
  sessionId: string,
  browserPid: number
): Promise<MemorySample | undefined> {
  const renderer = findMainRenderer(browserPid);
  if (renderer == null) {
    return undefined;
  }
  const sample: MemorySample = {
    rssMB: round1(renderer.memory.rssMB),
    swapMB: round1(renderer.memory.swapMB),
    peakMB: round1(renderer.memory.peakMB),
  };
  try {
    const { metrics } = (await browser.send(
      'Performance.getMetrics',
      {},
      sessionId
    )) as { metrics: { name: string; value: number }[] };
    const metric = (name: string) =>
      metrics.find((entry) => entry.name === name)?.value;
    const jsHeap = metric('JSHeapUsedSize');
    if (jsHeap != null) {
      sample.jsHeapMB = round1(jsHeap / 1024 / 1024);
    }
    const nodes = metric('Nodes');
    if (nodes != null) {
      sample.domNodes = nodes;
    }
  } catch {
    // memory sample is still useful without the V8 numbers
  }
  return sample;
}

function logSample(hooks: PassHooks, label: string, sample?: MemorySample) {
  if (sample == null) {
    hooks.log(`✗ ${label}: no renderer memory reading`);
    return;
  }
  hooks.log(
    `▣ ${label}: rss+swap ${Math.round(sample.rssMB + sample.swapMB)}MB, ` +
      `peak ${Math.round(sample.peakMB)}MB` +
      (sample.jsHeapMB != null
        ? `, jsHeap ${Math.round(sample.jsHeapMB)}MB`
        : '')
  );
}

function parseTimeEnd(text: string): { label: string; ms: number } | undefined {
  // Chrome formats console.timeEnd as "label: 1234.56 ms" (or "1.2 s")
  const match = text.match(/^(.*): ([\d.]+)\s*(ms|s)$/);
  if (match == null) {
    return undefined;
  }
  const value = Number(match[2]);
  return {
    label: match[1].trim(),
    ms: match[3] === 's' ? value * 1000 : value,
  };
}

function formatMs(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(2)}s` : `${Math.round(ms)}ms`;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

async function waitForDevtoolsUrl(
  stderr: ReadableStream<Uint8Array>,
  timeoutMs: number
): Promise<string> {
  const decoder = new TextDecoder();
  const reader = stderr.getReader();
  const deadline = Date.now() + timeoutMs;
  let buffer = '';
  try {
    while (Date.now() < deadline) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      const match = buffer.match(/DevTools listening on (ws:\/\/\S+)/);
      if (match != null) {
        return match[1];
      }
    }
  } finally {
    reader.releaseLock();
  }
  throw new Error(
    `chromium did not expose a DevTools endpoint: ${buffer.slice(0, 400)}`
  );
}

async function drainStream(stream: ReadableStream<Uint8Array>): Promise<void> {
  const reader = stream.getReader();
  try {
    while (!(await reader.read()).done) {
      // discard
    }
  } catch {
    // process exited
  }
}
