// OS-level memory readings for a Chrome renderer process. In-page APIs can't
// see the real cost (off-heap ArrayBuffers, peak), so we read the OS:
// - linux: /proc/<pid>/status — VmRSS + VmSwap (current), VmHWM (peak RSS)
// - darwin (local dev only): `vmmap --summary` physical footprint + peak

import { readFileSync } from 'node:fs';

export interface ProcessMemory {
  rssMB: number;
  swapMB: number;
  peakMB: number;
}

export function readProcessMemory(pid: number): ProcessMemory | undefined {
  return process.platform === 'linux'
    ? readLinuxStatus(pid)
    : readDarwinVmmap(pid);
}

function readLinuxStatus(pid: number): ProcessMemory | undefined {
  let text: string;
  try {
    text = readFileSync(`/proc/${pid}/status`, 'utf8');
  } catch {
    return undefined;
  }
  const kb = (field: string): number => {
    const match = text.match(new RegExp(`^${field}:\\s+(\\d+) kB`, 'm'));
    return match == null ? 0 : Number(match[1]);
  };
  const rssKB = kb('VmRSS');
  const swapKB = kb('VmSwap');
  const peakKB = kb('VmHWM');
  if (rssKB === 0 && peakKB === 0) {
    return undefined;
  }
  return {
    rssMB: rssKB / 1024,
    swapMB: swapKB / 1024,
    // VmHWM is resident-only; if the process ever swapped, count that too so
    // the peak can't read below the current rss+swap
    peakMB: Math.max(peakKB / 1024, (rssKB + swapKB) / 1024),
  };
}

function readDarwinVmmap(pid: number): ProcessMemory | undefined {
  const result = Bun.spawnSync(['vmmap', '--summary', String(pid)]);
  if (result.exitCode !== 0) {
    return undefined;
  }
  const text = result.stdout.toString();
  const footprint = text.match(/Physical footprint:\s+([\d.]+)([KMG])/);
  const peak = text.match(/Physical footprint \(peak\):\s+([\d.]+)([KMG])/);
  if (footprint == null || peak == null) {
    return undefined;
  }
  const toMB = (value: string, unit: string): number =>
    Number(value) * (unit === 'G' ? 1024 : unit === 'K' ? 1 / 1024 : 1);
  return {
    rssMB: toMB(footprint[1], footprint[2]),
    swapMB: 0,
    peakMB: toMB(peak[1], peak[2]),
  };
}

// All descendant processes of `rootPid` that are Chrome renderers. The bench
// opens a single tab, but Chrome may keep a renderer for about:blank around,
// so callers pick the heaviest one (the diff tab dwarfs everything else).
export function listRendererPids(rootPid: number): number[] {
  const result = Bun.spawnSync(['ps', '-axo', 'pid=,ppid=,command=']);
  if (result.exitCode !== 0) {
    return [];
  }
  const childrenOf = new Map<number, number[]>();
  const commandOf = new Map<number, string>();
  for (const line of result.stdout.toString().split('\n')) {
    const match = line.match(/^\s*(\d+)\s+(\d+)\s+(.*)$/);
    if (match == null) {
      continue;
    }
    const pid = Number(match[1]);
    const ppid = Number(match[2]);
    commandOf.set(pid, match[3]);
    let siblings = childrenOf.get(ppid);
    if (siblings == null) {
      childrenOf.set(ppid, (siblings = []));
    }
    siblings.push(pid);
  }
  const renderers: number[] = [];
  const stack = [rootPid];
  while (stack.length > 0) {
    const pid = stack.pop()!;
    if (
      pid !== rootPid &&
      commandOf.get(pid)?.includes('--type=renderer') === true
    ) {
      renderers.push(pid);
    }
    const children = childrenOf.get(pid);
    if (children != null) {
      stack.push(...children);
    }
  }
  return renderers;
}

// The renderer to measure: the descendant renderer currently using the most
// memory, together with how many renderer candidates were seen.
export function findMainRenderer(
  rootPid: number
): { pid: number; memory: ProcessMemory; rendererCount: number } | undefined {
  const pids = listRendererPids(rootPid);
  let best: { pid: number; memory: ProcessMemory } | undefined;
  for (const pid of pids) {
    const memory = readProcessMemory(pid);
    if (memory != null && (best == null || memory.rssMB > best.memory.rssMB)) {
      best = { pid, memory };
    }
  }
  return best == null ? undefined : { ...best, rendererCount: pids.length };
}
