import type { FileTreeRange, FileTreeViewportMetrics } from './types';

export const FILE_TREE_DEFAULT_ITEM_HEIGHT = 30;
export const FILE_TREE_DEFAULT_OVERSCAN = 10;
export const FILE_TREE_DEFAULT_VIEWPORT_HEIGHT = 420;
export const EMPTY_RANGE: FileTreeRange = { start: 0, end: -1 };

function normalizeRange(
  range: FileTreeRange,
  itemCount: number
): FileTreeRange {
  if (itemCount <= 0 || range.end < range.start) {
    return EMPTY_RANGE;
  }

  const start = Math.max(0, Math.min(range.start, itemCount - 1));
  const end = Math.max(start, Math.min(range.end, itemCount - 1));
  return { end, start };
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
    end: Math.min(itemCount - 1, rawEnd),
    start: Math.max(0, rawStart),
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
      end: range.end + overscan,
      start: range.start - overscan,
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
