'use client';

import {
  computeWindowRange,
  FILE_TREE_DEFAULT_ITEM_HEIGHT,
  FILE_TREE_DEFAULT_OVERSCAN,
  type FileTreeRange,
} from '@pierre/trees';
import {
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { ExampleCard } from '../_components/ExampleCard';
import { StateLog, useStateLog } from '../_components/StateLog';
import {
  BULK_EXPERIMENT_EXPANSION_OPTIONS,
  BULK_EXPERIMENT_INGEST_OPTIONS,
  BULK_EXPERIMENT_WORKLOAD_OPTIONS,
  type BulkExperimentExpansionMode,
  type BulkExperimentIngestMode,
  type BulkExperimentWorkloadName,
  DEFAULT_BULK_EXPERIMENT_EXPANSION_MODE,
  DEFAULT_BULK_EXPERIMENT_INGEST_MODE,
  DEFAULT_BULK_EXPERIMENT_WORKLOAD_NAME,
  getBulkExperimentAssetUrl,
  getBulkExperimentSeededExpandedPaths,
} from '../_lib/bulkExperimentMeta';
import { BulkExperimentModel } from '../_lib/bulkExperimentModel';
import { BULK_EXPERIMENT_PREVIEW_DATA } from '../_lib/bulkExperimentPreviewData';
import type {
  BulkExperimentInitOptions,
  BulkExperimentSnapshot,
  BulkExperimentVisibleRow,
  BulkExperimentWorkerMessage,
  BulkExperimentWorkerRequest,
} from '../_lib/bulkExperimentProtocol';
import { FILE_TREE_PROOF_VIEWPORT_HEIGHT } from '../_lib/workloadMeta';

const EMPTY_RANGE: FileTreeRange = { start: 0, end: -1 };

interface BulkExperimentAdapter {
  cancelIngest(): Promise<void>;
  collapsePath(path: string): Promise<void>;
  dispose(): void;
  expandPath(path: string): Promise<void>;
  getSnapshot(): BulkExperimentSnapshot;
  getVisibleRows(
    start: number,
    end: number
  ): Promise<readonly BulkExperimentVisibleRow[]>;
  startIngest(): Promise<void>;
  subscribe(listener: (snapshot: BulkExperimentSnapshot) => void): () => void;
}

type BulkExperimentAckRequest =
  | { type: 'cancelIngest' }
  | { path: string; type: 'collapsePath' }
  | { path: string; type: 'expandPath' }
  | { options: BulkExperimentInitOptions; type: 'initialize' }
  | { type: 'startIngest' };

interface LongTaskStats {
  count: number | null;
  longestMs: number | null;
}

interface BulkExperimentSummary {
  applyMs: number;
  expansionMode: BulkExperimentExpansionMode;
  fetchMs: number;
  ingestMode: BulkExperimentIngestMode;
  longTaskCount: number | null;
  longestLongTaskMs: number | null;
  parseMs: number;
  status: BulkExperimentSnapshot['bulkInfo']['status'];
  totalMs: number;
  workerMode: 'main' | 'worker';
  workloadName: BulkExperimentWorkloadName;
}

function roundMetric(value: number | null): number | null {
  return value == null ? null : Number(value.toFixed(1));
}

function formatMetric(value: number | null): string {
  return value == null ? 'n/a' : `${value.toFixed(1)} ms`;
}

function formatProgress(snapshot: BulkExperimentSnapshot): string {
  const { ingestedPathCount, totalPathCount } = snapshot.bulkInfo;
  return totalPathCount == null
    ? ingestedPathCount.toLocaleString()
    : `${ingestedPathCount.toLocaleString()} / ${totalPathCount.toLocaleString()}`;
}

function formatRowLabel(row: BulkExperimentVisibleRow): string {
  const flattenedSegments = row.flattenedSegments;
  if (flattenedSegments == null || flattenedSegments.length === 0) {
    return row.name;
  }

  return flattenedSegments.map((segment) => segment.name).join(' / ');
}

function createLongTaskMonitor(): { stop(): LongTaskStats } | null {
  if (typeof PerformanceObserver === 'undefined') {
    return null;
  }

  let count = 0;
  let longestMs = 0;

  try {
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        count += 1;
        longestMs = Math.max(longestMs, entry.duration);
      }
    });
    observer.observe({ type: 'longtask' as never });

    return {
      stop() {
        observer.disconnect();
        return {
          count,
          longestMs: count === 0 ? 0 : longestMs,
        };
      },
    };
  } catch {
    return null;
  }
}

function createInitialSnapshot(
  options: BulkExperimentInitOptions
): BulkExperimentSnapshot {
  return {
    bulkInfo: {
      ingestedPathCount: options.previewPaths.length,
      status: 'idle',
      totalPathCount: options.totalPathCount,
    },
    expansionMode: options.expansionMode,
    ingestMode: options.ingestMode,
    metrics: null,
    visibleCount: 0,
    workloadName: options.workloadName,
  };
}

function createBulkExperimentOptions(
  workloadName: BulkExperimentWorkloadName,
  ingestMode: BulkExperimentIngestMode,
  expansionMode: BulkExperimentExpansionMode
): BulkExperimentInitOptions {
  const previewData = BULK_EXPERIMENT_PREVIEW_DATA[workloadName];
  return {
    assetUrl: getBulkExperimentAssetUrl(workloadName),
    expansionMode,
    ingestMode,
    previewPaths: previewData.previewPaths,
    seededExpandedPaths: getBulkExperimentSeededExpandedPaths(workloadName),
    totalPathCount: previewData.totalPathCount,
    workloadName,
  };
}

function createLocalAdapter(
  options: BulkExperimentInitOptions
): BulkExperimentAdapter {
  const model = new BulkExperimentModel(options);

  return {
    async cancelIngest() {
      model.cancelIngest();
    },
    async collapsePath(path) {
      model.collapsePath(path);
    },
    dispose() {
      model.destroy();
    },
    async expandPath(path) {
      model.expandPath(path);
    },
    getSnapshot() {
      return model.getSnapshot();
    },
    async getVisibleRows(start, end) {
      return model.getVisibleRows(start, end);
    },
    async startIngest() {
      await model.startIngest();
    },
    subscribe(listener) {
      return model.subscribe(listener);
    },
  };
}

async function createWorkerAdapter(
  options: BulkExperimentInitOptions
): Promise<BulkExperimentAdapter> {
  const worker = new Worker(
    new URL('../_workers/bulkExperiment.worker.ts', import.meta.url),
    { type: 'module' }
  );
  const listeners = new Set<(snapshot: BulkExperimentSnapshot) => void>();
  let nextRequestId = 0;
  let snapshot = createInitialSnapshot(options);
  let resolveFirstSnapshot: (() => void) | null = null;
  const firstSnapshot = new Promise<void>((resolve) => {
    resolveFirstSnapshot = resolve;
  });
  const pending = new Map<
    number,
    | {
        kind: 'ack';
        reject: (error: Error) => void;
        resolve: () => void;
      }
    | {
        kind: 'rows';
        reject: (error: Error) => void;
        resolve: (rows: readonly BulkExperimentVisibleRow[]) => void;
      }
  >();

  const rejectPending = (error: Error): void => {
    for (const entry of pending.values()) {
      entry.reject(error);
    }
    pending.clear();
  };

  const handleMessage = (
    event: MessageEvent<BulkExperimentWorkerMessage>
  ): void => {
    const message = event.data;
    if (message.type === 'snapshot') {
      snapshot = message.snapshot;
      resolveFirstSnapshot?.();
      resolveFirstSnapshot = null;
      listeners.forEach((listener) => {
        listener(snapshot);
      });
      return;
    }

    const pendingRequest = pending.get(message.id);
    if (pendingRequest == null) {
      return;
    }
    pending.delete(message.id);

    if (message.type === 'error') {
      pendingRequest.reject(new Error(message.error));
      return;
    }

    if (pendingRequest.kind === 'ack') {
      if (message.type !== 'ack') {
        pendingRequest.reject(
          new Error(`Expected an ack response but received ${message.type}.`)
        );
        return;
      }
      pendingRequest.resolve();
      return;
    }

    if (message.type !== 'visibleRows') {
      pendingRequest.reject(
        new Error(`Expected visible rows but received ${message.type}.`)
      );
      return;
    }

    pendingRequest.resolve(message.rows);
  };

  const handleError = (event: ErrorEvent): void => {
    rejectPending(
      new Error(
        event.message.length > 0
          ? event.message
          : 'Bulk experiment worker crashed.'
      )
    );
  };

  worker.addEventListener('message', handleMessage);
  worker.addEventListener('error', handleError);

  const requestAck = (request: BulkExperimentAckRequest): Promise<void> => {
    const id = nextRequestId;
    nextRequestId += 1;

    return new Promise<void>((resolve, reject) => {
      pending.set(id, { kind: 'ack', reject, resolve });
      worker.postMessage({
        ...request,
        id,
      } satisfies BulkExperimentWorkerRequest);
    });
  };

  const requestVisibleRows = (
    start: number,
    end: number
  ): Promise<readonly BulkExperimentVisibleRow[]> => {
    const id = nextRequestId;
    nextRequestId += 1;

    return new Promise<readonly BulkExperimentVisibleRow[]>(
      (resolve, reject) => {
        pending.set(id, { kind: 'rows', reject, resolve });
        worker.postMessage({
          end,
          id,
          start,
          type: 'getVisibleRows',
        } satisfies BulkExperimentWorkerRequest);
      }
    );
  };

  await requestAck({ options, type: 'initialize' });
  await firstSnapshot;

  return {
    async cancelIngest() {
      await requestAck({ type: 'cancelIngest' });
    },
    async collapsePath(path) {
      await requestAck({ path, type: 'collapsePath' });
    },
    dispose() {
      worker.removeEventListener('message', handleMessage);
      worker.removeEventListener('error', handleError);
      rejectPending(new Error('Bulk experiment adapter disposed.'));
      listeners.clear();
      worker.terminate();
    },
    async expandPath(path) {
      await requestAck({ path, type: 'expandPath' });
    },
    getSnapshot() {
      return snapshot;
    },
    async getVisibleRows(start, end) {
      return requestVisibleRows(start, end);
    },
    async startIngest() {
      await requestAck({ type: 'startIngest' });
    },
    subscribe(listener) {
      listeners.add(listener);
      listener(snapshot);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

function summarizeSelection(selectedPaths: readonly string[]): string {
  return selectedPaths.length === 0 ? '[]' : `[${selectedPaths.join(', ')}]`;
}

export function BulkIngestDemoClient({ payloadHtml }: { payloadHtml: string }) {
  const [hasHydrated, setHasHydrated] = useState(false);
  const [useWorker, setUseWorker] = useState(true);
  const [workloadName, setWorkloadName] = useState<BulkExperimentWorkloadName>(
    DEFAULT_BULK_EXPERIMENT_WORKLOAD_NAME
  );
  const [ingestMode, setIngestMode] = useState<BulkExperimentIngestMode>(
    DEFAULT_BULK_EXPERIMENT_INGEST_MODE
  );
  const [expansionMode, setExpansionMode] =
    useState<BulkExperimentExpansionMode>(
      DEFAULT_BULK_EXPERIMENT_EXPANSION_MODE
    );
  const [resetToken, setResetToken] = useState(0);

  useEffect(() => {
    setHasHydrated(true);
  }, []);

  return (
    <BulkExperimentSession
      key={`${useWorker ? 'worker' : 'main'}:${workloadName}:${ingestMode}:${expansionMode}:${String(resetToken)}`}
      expansionMode={expansionMode}
      ingestMode={ingestMode}
      onExpansionModeChange={setExpansionMode}
      onIngestModeChange={setIngestMode}
      onReset={() => {
        setResetToken((value) => value + 1);
      }}
      onUseWorkerChange={setUseWorker}
      onWorkloadChange={setWorkloadName}
      payloadHtml={payloadHtml}
      showServerPreview={!hasHydrated}
      useWorker={useWorker}
      workloadName={workloadName}
    />
  );
}

function BulkExperimentSession({
  expansionMode,
  ingestMode,
  onExpansionModeChange,
  onIngestModeChange,
  onReset,
  onUseWorkerChange,
  onWorkloadChange,
  payloadHtml,
  showServerPreview,
  useWorker,
  workloadName,
}: {
  expansionMode: BulkExperimentExpansionMode;
  ingestMode: BulkExperimentIngestMode;
  onExpansionModeChange: (value: BulkExperimentExpansionMode) => void;
  onIngestModeChange: (value: BulkExperimentIngestMode) => void;
  onReset: () => void;
  onUseWorkerChange: (value: boolean) => void;
  onWorkloadChange: (value: BulkExperimentWorkloadName) => void;
  payloadHtml: string;
  showServerPreview: boolean;
  useWorker: boolean;
  workloadName: BulkExperimentWorkloadName;
}) {
  const { addLog, log } = useStateLog();
  const experimentOptions = useMemo(
    () => createBulkExperimentOptions(workloadName, ingestMode, expansionMode),
    [expansionMode, ingestMode, workloadName]
  );
  const previewData = BULK_EXPERIMENT_PREVIEW_DATA[workloadName];
  const workloadOption = useMemo(
    () =>
      BULK_EXPERIMENT_WORKLOAD_OPTIONS.find(
        (option) => option.name === workloadName
      ) ?? BULK_EXPERIMENT_WORKLOAD_OPTIONS[0],
    [workloadName]
  );
  const [adapter, setAdapter] = useState<BulkExperimentAdapter | null>(null);
  const [snapshot, setSnapshot] = useState<BulkExperimentSnapshot>(() =>
    createInitialSnapshot(experimentOptions)
  );
  const [rows, setRows] = useState<readonly BulkExperimentVisibleRow[]>([]);
  const [scrollTop, setScrollTop] = useState(0);
  const [focusedIndex, setFocusedIndex] = useState<number | null>(null);
  const [focusedPath, setFocusedPath] = useState<string | null>(null);
  const [selectedPaths, setSelectedPaths] = useState<readonly string[]>([]);
  const [latestSummary, setLatestSummary] =
    useState<BulkExperimentSummary | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const rowButtonByPathRef = useRef(new Map<string, HTMLButtonElement>());
  const longTaskMonitorRef = useRef<ReturnType<
    typeof createLongTaskMonitor
  > | null>(null);
  const previousBulkInfoKeyRef = useRef<string | null>(null);
  const lastSummaryKeyRef = useRef<string | null>(null);

  useEffect(() => {
    let disposed = false;
    let unsubscribe: (() => void) | null = null;
    let nextAdapter: BulkExperimentAdapter | null = null;

    void (async () => {
      const createdAdapter = useWorker
        ? await createWorkerAdapter(experimentOptions)
        : createLocalAdapter(experimentOptions);
      if (disposed) {
        createdAdapter.dispose();
        return;
      }

      nextAdapter = createdAdapter;
      setAdapter(createdAdapter);
      setSnapshot(createdAdapter.getSnapshot());
      unsubscribe = createdAdapter.subscribe((nextSnapshot) => {
        if (!disposed) {
          setSnapshot(nextSnapshot);
        }
      });
      addLog(
        `mode:${useWorker ? 'worker' : 'main'} workload:${workloadName} expansion:${expansionMode} ingest:${ingestMode}`
      );
    })();

    return () => {
      disposed = true;
      unsubscribe?.();
      nextAdapter?.dispose();
      longTaskMonitorRef.current?.stop();
      longTaskMonitorRef.current = null;
    };
  }, [
    addLog,
    expansionMode,
    experimentOptions,
    ingestMode,
    useWorker,
    workloadName,
  ]);

  useEffect(() => {
    const scrollElement = scrollRef.current;
    if (scrollElement == null) {
      return;
    }

    const maxScrollTop = Math.max(
      0,
      snapshot.visibleCount * FILE_TREE_DEFAULT_ITEM_HEIGHT -
        FILE_TREE_PROOF_VIEWPORT_HEIGHT
    );
    if (scrollElement.scrollTop > maxScrollTop) {
      scrollElement.scrollTop = maxScrollTop;
      setScrollTop(maxScrollTop);
    }
  }, [snapshot.visibleCount]);

  const range = useMemo(
    () =>
      adapter == null
        ? EMPTY_RANGE
        : computeWindowRange({
            itemCount: snapshot.visibleCount,
            itemHeight: FILE_TREE_DEFAULT_ITEM_HEIGHT,
            overscan: FILE_TREE_DEFAULT_OVERSCAN,
            scrollTop,
            viewportHeight: FILE_TREE_PROOF_VIEWPORT_HEIGHT,
          }),
    [adapter, scrollTop, snapshot.visibleCount]
  );

  useEffect(() => {
    let cancelled = false;

    if (adapter == null || range.end < range.start) {
      setRows([]);
      return;
    }

    void adapter.getVisibleRows(range.start, range.end).then((nextRows) => {
      if (!cancelled) {
        setRows(nextRows);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [adapter, range.end, range.start, snapshot.visibleCount]);

  useEffect(() => {
    const bulkInfoKey = `${snapshot.bulkInfo.status}:${snapshot.bulkInfo.ingestedPathCount}:${String(snapshot.bulkInfo.totalPathCount)}:${snapshot.bulkInfo.errorMessage ?? ''}`;
    if (previousBulkInfoKeyRef.current === bulkInfoKey) {
      return;
    }
    previousBulkInfoKeyRef.current = bulkInfoKey;

    addLog(
      `bulk:${snapshot.bulkInfo.status} progress=${formatProgress(snapshot)}${snapshot.bulkInfo.errorMessage == null ? '' : ` error=${snapshot.bulkInfo.errorMessage}`}`
    );
  }, [addLog, snapshot]);

  useEffect(() => {
    if (snapshot.bulkInfo.status === 'ingesting') {
      longTaskMonitorRef.current ??= createLongTaskMonitor();
      return;
    }

    if (
      snapshot.metrics == null ||
      (snapshot.bulkInfo.status !== 'completed' &&
        snapshot.bulkInfo.status !== 'cancelled' &&
        snapshot.bulkInfo.status !== 'failed')
    ) {
      return;
    }

    const longTaskStats = longTaskMonitorRef.current?.stop() ?? {
      count: null,
      longestMs: null,
    };
    longTaskMonitorRef.current = null;

    const summaryKey = JSON.stringify([
      snapshot.bulkInfo.status,
      snapshot.bulkInfo.ingestedPathCount,
      snapshot.metrics.totalMs,
      longTaskStats.count,
      longTaskStats.longestMs,
    ]);
    if (lastSummaryKeyRef.current === summaryKey) {
      return;
    }
    lastSummaryKeyRef.current = summaryKey;

    const summary: BulkExperimentSummary = {
      applyMs: roundMetric(snapshot.metrics.applyMs) ?? 0,
      expansionMode,
      fetchMs: roundMetric(snapshot.metrics.fetchMs) ?? 0,
      ingestMode,
      longTaskCount: longTaskStats.count,
      longestLongTaskMs: roundMetric(longTaskStats.longestMs),
      parseMs: roundMetric(snapshot.metrics.parseMs) ?? 0,
      status: snapshot.bulkInfo.status,
      totalMs: roundMetric(snapshot.metrics.totalMs) ?? 0,
      workerMode: useWorker ? 'worker' : 'main',
      workloadName,
    };

    setLatestSummary(summary);
    console.table([summary]);
  }, [expansionMode, ingestMode, snapshot, useWorker, workloadName]);

  useLayoutEffect(() => {
    if (focusedPath == null) {
      return;
    }

    const target = rowButtonByPathRef.current.get(focusedPath);
    if (target != null && document.activeElement !== target) {
      target.focus({ preventScroll: true });
    }
  }, [focusedPath, rows]);

  const selectedPathSet = useMemo(
    () => new Set(selectedPaths),
    [selectedPaths]
  );

  const ensureIndexVisible = useCallback((index: number) => {
    const scrollElement = scrollRef.current;
    if (scrollElement == null) {
      return;
    }

    const rowTop = index * FILE_TREE_DEFAULT_ITEM_HEIGHT;
    const rowBottom = rowTop + FILE_TREE_DEFAULT_ITEM_HEIGHT;
    if (rowTop < scrollElement.scrollTop) {
      scrollElement.scrollTop = rowTop;
      return;
    }

    const visibleBottom =
      scrollElement.scrollTop + FILE_TREE_PROOF_VIEWPORT_HEIGHT;
    if (rowBottom > visibleBottom) {
      scrollElement.scrollTop = rowBottom - FILE_TREE_PROOF_VIEWPORT_HEIGHT;
    }
  }, []);

  const moveFocus = useCallback(
    async (offset: number) => {
      if (adapter == null || snapshot.visibleCount === 0) {
        return;
      }

      const currentIndex = focusedIndex ?? 0;
      const nextIndex = Math.max(
        0,
        Math.min(snapshot.visibleCount - 1, currentIndex + offset)
      );
      const nextRows = await adapter.getVisibleRows(nextIndex, nextIndex);
      const nextRow = nextRows[0];
      if (nextRow == null) {
        return;
      }

      setFocusedIndex(nextIndex);
      setFocusedPath(nextRow.path);
      ensureIndexVisible(nextIndex);
    },
    [adapter, ensureIndexVisible, focusedIndex, snapshot.visibleCount]
  );

  const setSelectionForRow = useCallback(
    (row: BulkExperimentVisibleRow, additive: boolean) => {
      setFocusedIndex(row.index);
      setFocusedPath(row.path);
      setSelectedPaths((previous) => {
        if (!additive) {
          return [row.path];
        }

        return previous.includes(row.path)
          ? previous.filter((path) => path !== row.path)
          : [...previous, row.path];
      });
    },
    []
  );

  const handleRowClick = useCallback(
    (
      event: ReactMouseEvent<HTMLButtonElement>,
      row: BulkExperimentVisibleRow
    ) => {
      setSelectionForRow(row, event.metaKey || event.ctrlKey);
    },
    [setSelectionForRow]
  );

  const handleRowKeyDown = useCallback(
    async (
      event: ReactKeyboardEvent<HTMLButtonElement>,
      row: BulkExperimentVisibleRow
    ) => {
      switch (event.key) {
        case 'ArrowDown':
          event.preventDefault();
          await moveFocus(1);
          return;
        case 'ArrowUp':
          event.preventDefault();
          await moveFocus(-1);
          return;
        case 'ArrowRight':
          if (row.kind === 'directory' && !row.isExpanded && adapter != null) {
            event.preventDefault();
            await adapter.expandPath(row.path);
            addLog(`expand:${row.path}`);
          }
          return;
        case 'ArrowLeft':
          if (row.kind === 'directory' && row.isExpanded && adapter != null) {
            event.preventDefault();
            await adapter.collapsePath(row.path);
            setFocusedIndex(row.index);
            setFocusedPath(row.path);
            addLog(`collapse:${row.path}`);
          }
          return;
        case 'Enter':
        case ' ':
          event.preventDefault();
          setSelectionForRow(row, event.metaKey || event.ctrlKey);
          return;
        default:
          return;
      }
    },
    [adapter, addLog, moveFocus, setSelectionForRow]
  );

  const totalHeight = snapshot.visibleCount * FILE_TREE_DEFAULT_ITEM_HEIGHT;
  const offsetHeight =
    range.end < range.start ? 0 : range.start * FILE_TREE_DEFAULT_ITEM_HEIGHT;
  const windowHeight =
    range.end < range.start
      ? 0
      : (range.end - range.start + 1) * FILE_TREE_DEFAULT_ITEM_HEIGHT;
  const trailingHeight = Math.max(0, totalHeight - offsetHeight - windowHeight);

  const latestMetricsContent =
    latestSummary == null ? (
      <span className="text-muted-foreground italic">
        Start, cancel, or finish a run to capture experiment metrics.
      </span>
    ) : (
      <div className="text-muted-foreground mt-1 space-y-1">
        <div>
          {latestSummary.workerMode} / {latestSummary.workloadName} /{' '}
          {latestSummary.ingestMode}
        </div>
        <div>
          fetch={formatMetric(latestSummary.fetchMs)} parse=
          {formatMetric(latestSummary.parseMs)}
        </div>
        <div>
          apply={formatMetric(latestSummary.applyMs)} total=
          {formatMetric(latestSummary.totalMs)}
        </div>
        <div>
          longtasks=
          {latestSummary.longTaskCount == null
            ? 'n/a'
            : String(latestSummary.longTaskCount)}
          {' / '}longest={formatMetric(latestSummary.longestLongTaskMs)}
        </div>
      </div>
    );

  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] xl:items-start">
      <ExampleCard
        className="max-w-none"
        title="Bulk ingest worker experiment"
        description={`Previewing ${experimentOptions.previewPaths.length.toLocaleString()} of ${previewData.totalPathCount.toLocaleString()} ${workloadOption.label} paths. The same demo-local model runs either on the main thread or inside a worker so this page can compare responsiveness while holding the renderer and workload constant.`}
      >
        <div className="mb-3 grid gap-3 text-xs md:grid-cols-2 xl:grid-cols-4">
          <label className="flex cursor-pointer items-center gap-2 select-none">
            <input
              checked={useWorker}
              type="checkbox"
              onChange={(event) => {
                onUseWorkerChange(event.target.checked);
              }}
            />
            Use worker
          </label>

          <label className="grid gap-1">
            <span className="font-medium">Workload</span>
            <select
              value={workloadName}
              onChange={(event) => {
                onWorkloadChange(
                  event.target.value as BulkExperimentWorkloadName
                );
              }}
            >
              {BULK_EXPERIMENT_WORKLOAD_OPTIONS.map((option) => (
                <option key={option.name} value={option.name}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <label className="grid gap-1">
            <span className="font-medium">Expansion mode</span>
            <select
              value={expansionMode}
              onChange={(event) => {
                onExpansionModeChange(
                  event.target.value as BulkExperimentExpansionMode
                );
              }}
            >
              {BULK_EXPERIMENT_EXPANSION_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <label className="grid gap-1">
            <span className="font-medium">Ingest mode</span>
            <select
              value={ingestMode}
              onChange={(event) => {
                onIngestModeChange(
                  event.target.value as BulkExperimentIngestMode
                );
              }}
            >
              {BULK_EXPERIMENT_INGEST_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="mb-3 flex flex-wrap gap-2 text-xs">
          <button
            type="button"
            className="rounded-sm border px-2 py-1"
            style={{ borderColor: 'var(--color-border)' }}
            disabled={
              adapter == null || snapshot.bulkInfo.status === 'ingesting'
            }
            onClick={() => {
              void adapter?.startIngest();
            }}
          >
            Start ingest
          </button>
          <button
            type="button"
            className="rounded-sm border px-2 py-1"
            style={{ borderColor: 'var(--color-border)' }}
            disabled={snapshot.bulkInfo.status !== 'ingesting'}
            onClick={() => {
              void adapter?.cancelIngest();
            }}
          >
            Cancel ingest
          </button>
          <button
            type="button"
            className="rounded-sm border px-2 py-1"
            style={{ borderColor: 'var(--color-border)' }}
            onClick={onReset}
          >
            Reset run
          </button>
          <span className="text-muted-foreground self-center">
            progress={formatProgress(snapshot)}
          </span>
        </div>

        {showServerPreview ? (
          <div
            style={{ height: `${String(FILE_TREE_PROOF_VIEWPORT_HEIGHT)}px` }}
            dangerouslySetInnerHTML={{ __html: payloadHtml }}
            suppressHydrationWarning
          />
        ) : adapter == null ? (
          <div
            className="text-muted-foreground flex items-center justify-center rounded border text-xs"
            style={{
              borderColor: 'var(--color-border)',
              height: `${String(FILE_TREE_PROOF_VIEWPORT_HEIGHT)}px`,
            }}
          >
            Preparing {useWorker ? 'worker' : 'main-thread'} experiment…
          </div>
        ) : (
          <div
            ref={scrollRef}
            className="overflow-auto rounded border"
            style={{
              borderColor: 'var(--color-border)',
              height: `${String(FILE_TREE_PROOF_VIEWPORT_HEIGHT)}px`,
            }}
            onScroll={(event) => {
              setScrollTop(event.currentTarget.scrollTop);
            }}
          >
            <div role="tree" aria-label="Bulk ingest experiment tree">
              <div style={{ height: `${offsetHeight}px` }} />
              {rows.length === 0 ? (
                <div className="text-muted-foreground px-3 py-2 text-xs italic">
                  No visible rows for the current expansion state.
                </div>
              ) : (
                rows.map((row) => {
                  const isFocused = focusedPath === row.path;
                  const isSelected = selectedPathSet.has(row.path);
                  const canToggle = row.kind === 'directory' && row.hasChildren;
                  return (
                    <div
                      key={`${row.index}:${row.path}`}
                      className="flex items-center gap-1 px-2"
                      style={{
                        minHeight: `${String(FILE_TREE_DEFAULT_ITEM_HEIGHT)}px`,
                        paddingLeft: `${String(row.level * 14 + 4)}px`,
                      }}
                    >
                      <button
                        type="button"
                        className="text-muted-foreground w-5 shrink-0 text-center"
                        aria-hidden={!canToggle}
                        disabled={!canToggle}
                        onClick={() => {
                          if (!canToggle || adapter == null) {
                            return;
                          }

                          if (row.isExpanded) {
                            void adapter.collapsePath(row.path);
                            addLog(`collapse:${row.path}`);
                          } else {
                            void adapter.expandPath(row.path);
                            addLog(`expand:${row.path}`);
                          }
                          setFocusedIndex(row.index);
                          setFocusedPath(row.path);
                        }}
                      >
                        {canToggle ? (row.isExpanded ? '▾' : '▸') : '·'}
                      </button>
                      <button
                        type="button"
                        ref={(element) => {
                          if (element == null) {
                            rowButtonByPathRef.current.delete(row.path);
                            return;
                          }

                          rowButtonByPathRef.current.set(row.path, element);
                        }}
                        role="treeitem"
                        aria-expanded={
                          row.kind === 'directory' ? row.isExpanded : undefined
                        }
                        aria-level={row.level + 1}
                        aria-posinset={row.posInSet + 1}
                        aria-selected={isSelected}
                        aria-setsize={row.setSize}
                        className="min-w-0 flex-1 rounded-sm px-2 py-1 text-left text-xs"
                        data-row-path={row.path}
                        style={{
                          backgroundColor: isSelected
                            ? 'var(--color-muted)'
                            : 'transparent',
                          outlineColor: isFocused
                            ? 'var(--color-primary)'
                            : undefined,
                        }}
                        tabIndex={isFocused ? 0 : -1}
                        onClick={(event) => {
                          handleRowClick(event, row);
                        }}
                        onFocus={() => {
                          setFocusedIndex(row.index);
                          setFocusedPath(row.path);
                        }}
                        onKeyDown={(event) => {
                          void handleRowKeyDown(event, row);
                        }}
                      >
                        <span className="truncate">{formatRowLabel(row)}</span>
                      </button>
                    </div>
                  );
                })
              )}
              <div style={{ height: `${trailingHeight}px` }} />
            </div>
          </div>
        )}
      </ExampleCard>

      <div className="space-y-6">
        <ExampleCard
          className="max-w-none"
          title="Experiment state"
          description="Status and progress come from the demo-local model boundary. Focus and selection stay on the main thread so the worker can own only the tree model work while the page still handles viewport math and interaction overlays."
        >
          <div className="grid gap-3 text-xs md:grid-cols-2">
            <div
              className="rounded-sm border px-3 py-2"
              style={{ borderColor: 'var(--color-border)' }}
            >
              <strong>Status</strong>
              <div className="text-muted-foreground mt-1">
                {snapshot.bulkInfo.status}
                {snapshot.bulkInfo.errorMessage == null
                  ? ''
                  : ` (${snapshot.bulkInfo.errorMessage})`}
              </div>
            </div>
            <div
              className="rounded-sm border px-3 py-2"
              style={{ borderColor: 'var(--color-border)' }}
            >
              <strong>Progress</strong>
              <div className="text-muted-foreground mt-1">
                {formatProgress(snapshot)}
              </div>
            </div>
            <div
              className="rounded-sm border px-3 py-2"
              style={{ borderColor: 'var(--color-border)' }}
            >
              <strong>Interaction state</strong>
              <div className="text-muted-foreground mt-1">
                focus={focusedPath ?? 'null'}
                <br />
                selection={summarizeSelection(selectedPaths)}
              </div>
            </div>
            <div
              className="rounded-sm border px-3 py-2"
              style={{ borderColor: 'var(--color-border)' }}
            >
              <strong>Latest run summary</strong>
              {latestMetricsContent}
            </div>
          </div>
        </ExampleCard>

        <ExampleCard
          className="max-w-none"
          title="Experiment log"
          description="Each run logs the active mode plus bulk state transitions. When a run completes, cancels, or fails, the page also prints a console.table row with fetch, parse, apply, total, and main-thread long-task metrics."
        >
          <StateLog entries={log} />
        </ExampleCard>
      </div>
    </div>
  );
}
