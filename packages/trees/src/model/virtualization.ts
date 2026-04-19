import type {
  FileTreeRange,
  FileTreeStickyWindowLayout,
  FileTreeViewportMetrics,
} from './types';

export const FILE_TREE_DEFAULT_ITEM_HEIGHT = 30;
export const FILE_TREE_DEFAULT_OVERSCAN = 10;
export const FILE_TREE_DEFAULT_VIEWPORT_HEIGHT = 420;
export const EMPTY_RANGE: FileTreeRange = { start: 0, end: -1 };

export interface FileTreeInsetWindowLayout {
  contentHeight: number;
  firstVisibleIndex: number;
  offsetHeight: number;
  stickyInset: number;
  topInset: number;
  totalHeight: number;
  visiblePaneHeight: number;
  visibleRange: FileTreeRange;
  windowHeight: number;
  windowRange: FileTreeRange;
}

function normalizeRange(
  range: FileTreeRange,
  itemCount: number
): FileTreeRange {
  if (itemCount <= 0 || range.end < range.start) {
    return EMPTY_RANGE;
  }

  const start = Math.max(0, Math.min(range.start, itemCount - 1));
  const end = Math.max(start, Math.min(range.end, itemCount - 1));
  return { start, end };
}

function clampTopInset({
  itemCount,
  itemHeight,
  topInset,
  viewportHeight,
}: Pick<
  FileTreeViewportMetrics,
  'itemCount' | 'itemHeight' | 'viewportHeight'
> & {
  topInset: number;
}): number {
  if (itemCount <= 0 || viewportHeight <= 0) {
    return 0;
  }

  const requestedInset = Math.max(0, topInset);
  const maxInset = Math.max(
    0,
    viewportHeight - Math.min(itemHeight, viewportHeight)
  );

  return Math.min(requestedInset, maxInset);
}

export function rangesEqual(
  left: FileTreeRange,
  right: FileTreeRange
): boolean {
  return left.start === right.start && left.end === right.end;
}

export function computeFirstVisibleIndex({
  itemCount,
  itemHeight,
  scrollTop,
  topInset = 0,
}: Pick<FileTreeViewportMetrics, 'itemCount' | 'itemHeight' | 'scrollTop'> & {
  topInset?: number;
}): number {
  if (itemCount <= 0) {
    return -1;
  }

  const maxItemTop = Math.max(0, itemCount * itemHeight - itemHeight);
  const effectiveScrollTop = Math.max(
    0,
    Math.min(scrollTop + Math.max(0, topInset), maxItemTop)
  );

  return Math.floor(effectiveScrollTop / itemHeight);
}

export function computeVisibleRange({
  itemCount,
  itemHeight,
  scrollTop,
  viewportHeight,
}: FileTreeViewportMetrics): FileTreeRange {
  if (itemCount <= 0) {
    return EMPTY_RANGE;
  }

  const rawStart = Math.floor(scrollTop / itemHeight);
  const rawEnd = Math.ceil((scrollTop + viewportHeight) / itemHeight) - 1;
  if (rawEnd < 0 || rawStart >= itemCount) {
    return EMPTY_RANGE;
  }

  return {
    start: Math.max(0, rawStart),
    end: Math.min(itemCount - 1, rawEnd),
  };
}

function expandRange(
  range: FileTreeRange,
  itemCount: number,
  overscan: number
): FileTreeRange {
  if (range.end < range.start || itemCount <= 0) {
    return EMPTY_RANGE;
  }

  return normalizeRange(
    {
      start: range.start - overscan,
      end: range.end + overscan,
    },
    itemCount
  );
}

export function computeWindowRange(
  metrics: FileTreeViewportMetrics,
  currentRange: FileTreeRange = EMPTY_RANGE
): FileTreeRange {
  const visibleRange = computeVisibleRange(metrics);
  const normalizedCurrent = normalizeRange(currentRange, metrics.itemCount);

  if (
    normalizedCurrent.end >= normalizedCurrent.start &&
    visibleRange.start >= normalizedCurrent.start &&
    visibleRange.end <= normalizedCurrent.end
  ) {
    return normalizedCurrent;
  }

  return expandRange(
    visibleRange,
    metrics.itemCount,
    metrics.overscan ?? FILE_TREE_DEFAULT_OVERSCAN
  );
}

// Reserves sticky-overlay space by moving the same pixels from the window's
// flow height into its top offset, which keeps total scroll height constant.
export function computeInsetWindowLayout({
  currentRange = EMPTY_RANGE,
  itemCount,
  itemHeight,
  overscan,
  scrollTop,
  topInset = 0,
  viewportHeight,
}: FileTreeViewportMetrics & {
  currentRange?: FileTreeRange;
  topInset?: number;
}): FileTreeInsetWindowLayout {
  const resolvedTopInset = clampTopInset({
    itemCount,
    itemHeight,
    topInset,
    viewportHeight,
  });
  const visiblePaneHeight = Math.max(0, viewportHeight - resolvedTopInset);
  const totalHeight = Math.max(0, itemCount * itemHeight);

  if (itemCount <= 0 || visiblePaneHeight <= 0) {
    return {
      contentHeight: 0,
      firstVisibleIndex: -1,
      offsetHeight: 0,
      stickyInset: 0,
      topInset: 0,
      totalHeight,
      visiblePaneHeight,
      visibleRange: EMPTY_RANGE,
      windowHeight: 0,
      windowRange: EMPTY_RANGE,
    };
  }

  const visibleRange = computeVisibleRange({
    itemCount,
    itemHeight,
    overscan,
    scrollTop,
    viewportHeight: visiblePaneHeight,
  });
  const windowRange = computeWindowRange(
    {
      itemCount,
      itemHeight,
      overscan,
      scrollTop,
      viewportHeight: visiblePaneHeight,
    },
    currentRange
  );
  const contentHeight =
    windowRange.end < windowRange.start
      ? 0
      : (windowRange.end - windowRange.start + 1) * itemHeight;

  return {
    contentHeight,
    firstVisibleIndex: visibleRange.start,
    offsetHeight:
      windowRange.end < windowRange.start
        ? 0
        : windowRange.start * itemHeight + resolvedTopInset,
    stickyInset: Math.min(0, viewportHeight - contentHeight),
    topInset: resolvedTopInset,
    totalHeight,
    visiblePaneHeight,
    visibleRange,
    windowHeight: Math.max(0, contentHeight - resolvedTopInset),
    windowRange,
  };
}

export function computeStickyWindowLayout({
  itemCount,
  itemHeight,
  range,
  viewportHeight,
}: {
  itemCount: number;
  itemHeight: number;
  range: FileTreeRange;
  viewportHeight: number;
}): FileTreeStickyWindowLayout {
  const totalHeight = Math.max(0, itemCount * itemHeight);
  if (range.end < range.start) {
    return {
      totalHeight,
      offsetHeight: 0,
      windowHeight: 0,
      stickyInset: 0,
    };
  }

  const offsetHeight = range.start * itemHeight;
  const windowHeight = (range.end - range.start + 1) * itemHeight;

  return {
    totalHeight,
    offsetHeight,
    windowHeight,
    // The sticky window is usually taller than the viewport once overscan is
    // included, so a negative inset keeps the full overscanned slice pinned.
    stickyInset: Math.min(0, viewportHeight - windowHeight),
  };
}
