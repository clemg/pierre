import type {
  ChangeContent,
  ContextContent,
  FileDiffMetadata,
  Hunk,
} from '../types';
import type { DiffLines } from './diffLines';
import { EMPTY_DIFF_LINES } from './diffLines';
import {
  applyFileHeaderLine,
  createContentGroup,
  maybeDetachOptionalString,
  parseHunkHeader,
  splitWithNewlines,
} from './parsePatchShared';

// Byte-level twin of `processFile` for patch text we still have as UTF-8
// bytes (e.g. a fetch stream). It produces the exact same parsed model, but
// only the small metadata regions (the file header and each `@@` hunk header
// line) ever become JS strings; every content line's bytes are copied
// verbatim into the per-side byte arenas and decoded on demand by `lineAt`,
// so a streamed parse allocates no per-line strings or garbage.
//
// Invalid UTF-8 stays as-is in the arena and decodes to U+FFFD on read — the
// same text the string parser stores when it decodes the stream. A lone
// surrogate can't exist in UTF-8 bytes, so the string parser's
// plain-`string[]` fallback has no equivalent here

const NEWLINE = 10;
const CARRIAGE_RETURN = 13;
const SPACE = 32;
const PLUS = 43;
const MINUS = 45;
const BACKSLASH = 92;
const AT = 64;

// Only metadata slices go through this decoder; `ignoreBOM` keeps a U+FEFF at
// the start of a slice intact, matching how the string parser sees mid-patch
// text (a whole-stream decode only ever strips the stream-leading BOM)
const metadataDecoder = new TextDecoder('utf-8', { ignoreBOM: true });

export interface ProcessFileBytesOptions {
  cacheKey?: string;
  isGitDiff?: boolean;
  throwOnError?: boolean;
}

// Accumulates one side's line content during the parse: content bytes are
// appended into `scratch` and each line's end offset lands in `offsets`
// (entry 0 stays 0), so sealing is a copy of exactly the bytes written plus
// an offsets downcast to the smallest element width that fits
interface SideBuilder {
  scratch: Uint8Array;
  offsets: Uint32Array;
  count: number;
  position: number;
}

function createSideBuilder(byteCapacity: number): SideBuilder {
  return {
    scratch: new Uint8Array(byteCapacity),
    offsets: new Uint32Array(256),
    count: 0,
    position: 0,
  };
}

// Streamed parses call processFileBytes once per file, so we keep the two
// side builders at module scope and reuse them across calls: the typical file
// is a few KB and would otherwise pay a fresh zeroed allocation per side per
// file. Files larger than the cap get a throwaway builder instead, so the
// persistent footprint stays bounded (at most ~2MB across both sides) without
// needing a release hook
const SIDE_SCRATCH_BYTE_CAP = 1 << 20;
const persistentAdditionSide = createSideBuilder(1 << 16);
const persistentDeletionSide = createSideBuilder(1 << 16);

function acquireSideBuilder(
  persistent: SideBuilder,
  byteCapacity: number
): SideBuilder {
  if (byteCapacity > SIDE_SCRATCH_BYTE_CAP) {
    return createSideBuilder(byteCapacity);
  }
  if (persistent.scratch.length < byteCapacity) {
    let capacity = persistent.scratch.length * 2;
    while (capacity < byteCapacity) {
      capacity *= 2;
    }
    persistent.scratch = new Uint8Array(capacity);
  }
  persistent.count = 0;
  persistent.position = 0;
  return persistent;
}

function ensureOffsetCapacity(builder: SideBuilder): void {
  if (builder.count + 2 > builder.offsets.length) {
    const grown = new Uint32Array(builder.offsets.length * 2);
    grown.set(builder.offsets);
    builder.offsets = grown;
  }
}

// Append one line's content bytes. An empty content slice stores a single
// newline, mirroring `getParsedLineContent` returning '\n' for an empty line
function appendLine(
  builder: SideBuilder,
  source: Uint8Array,
  start: number,
  end: number
): void {
  ensureOffsetCapacity(builder);
  const { scratch } = builder;
  let { position } = builder;
  if (start === end) {
    scratch[position++] = NEWLINE;
  } else if (end - start < 64) {
    // Short lines dominate real diffs; a direct loop avoids the subarray
    // allocation and call overhead of `set` for them
    for (let index = start; index < end; index++) {
      scratch[position++] = source[index];
    }
  } else {
    scratch.set(source.subarray(start, end), position);
    position += end - start;
  }
  builder.position = position;
  builder.offsets[++builder.count] = position;
}

// Strip one trailing newline (and a preceding carriage return) from the last
// appended line — the byte equivalent of running `cleanLastNewline` on the
// last entry of the side's line list when a `\ No newline at end of file`
// marker arrives
function trimLastLineNewline(builder: SideBuilder): void {
  if (builder.count === 0) {
    return;
  }
  const lineStart = builder.offsets[builder.count - 1];
  let { position } = builder;
  if (position > lineStart && builder.scratch[position - 1] === NEWLINE) {
    position--;
    if (
      position > lineStart &&
      builder.scratch[position - 1] === CARRIAGE_RETURN
    ) {
      position--;
    }
  }
  builder.position = position;
  builder.offsets[builder.count] = position;
}

function sealSide(builder: SideBuilder): DiffLines {
  const { count, position } = builder;
  // Same width thresholds as `finishLines`, but chosen from the actual byte
  // length instead of its `charTotal * 3` upper bound, so a side never gets a
  // wider table than it needs
  const offsets =
    position < 0x100
      ? new Uint8Array(count + 1)
      : position < 0x10000
        ? new Uint16Array(count + 1)
        : new Uint32Array(count + 1);
  offsets.set(builder.offsets.subarray(0, count + 1));
  return {
    length: count,
    bytes: builder.scratch.slice(0, position),
    offsets,
  };
}

function isHunkLineAt(
  bytes: Uint8Array,
  index: number,
  length: number
): boolean {
  return (
    index + 2 < length &&
    bytes[index] === AT &&
    bytes[index + 1] === AT &&
    bytes[index + 2] === SPACE
  );
}

// End of the line starting at `index`, exclusive and including the newline
function lineEndExclusive(
  bytes: Uint8Array,
  index: number,
  length: number
): number {
  const newlineIndex = bytes.indexOf(NEWLINE, index);
  return newlineIndex === -1 ? length : newlineIndex + 1;
}

// First line at or after `index` (itself a line start) that begins a hunk
// (`@@ `), or `length` when there is none — the byte equivalent of the string
// parser splitting the file at every `@@ `-prefixed line
function findNextHunkLine(
  bytes: Uint8Array,
  index: number,
  length: number
): number {
  let lineStart = index;
  while (lineStart < length) {
    if (isHunkLineAt(bytes, lineStart, length)) {
      return lineStart;
    }
    lineStart = lineEndExclusive(bytes, lineStart, length);
  }
  return length;
}

// A line that is only a line terminator (or empty at EOF). The string parser
// silently drops a run of these at the end of a hunk chunk (format-patch
// separators); anywhere else they fall through to the invalid-line warning
function isBlankLine(bytes: Uint8Array, start: number, end: number): boolean {
  const lineLength = end - start;
  if (lineLength === 1) {
    return bytes[start] === NEWLINE || bytes[start] === CARRIAGE_RETURN;
  }
  if (lineLength === 2) {
    return bytes[start] === CARRIAGE_RETURN && bytes[start + 1] === NEWLINE;
  }
  return lineLength === 0;
}

function restOfChunkIsBlank(
  bytes: Uint8Array,
  index: number,
  length: number
): boolean {
  let lineStart = index;
  while (lineStart < length) {
    if (isHunkLineAt(bytes, lineStart, length)) {
      return true;
    }
    const lineEnd = lineEndExclusive(bytes, lineStart, length);
    if (!isBlankLine(bytes, lineStart, lineEnd)) {
      return false;
    }
    lineStart = lineEnd;
  }
  return true;
}

// Byte equivalent of `isGitDiffPatch`: a `diff --git` at the start or at any
// line start
function isGitDiffBytes(bytes: Uint8Array, length: number): boolean {
  const prefix = 'diff --git';
  let lineStart = 0;
  while (lineStart < length) {
    if (matchesAscii(bytes, lineStart, length, prefix)) {
      return true;
    }
    const newlineIndex = bytes.indexOf(NEWLINE, lineStart);
    if (newlineIndex === -1) {
      return false;
    }
    lineStart = newlineIndex + 1;
  }
  return false;
}

function matchesAscii(
  bytes: Uint8Array,
  index: number,
  length: number,
  text: string
): boolean {
  if (index + text.length > length) {
    return false;
  }
  for (let offset = 0; offset < text.length; offset++) {
    if (bytes[index + offset] !== text.charCodeAt(offset)) {
      return false;
    }
  }
  return true;
}

/**
 * Parse a single file's diff from UTF-8 bytes into the same `FileDiffMetadata`
 * that `processFile` produces for the equivalent string: only header/hunk-header
 * metadata is decoded, content lines go straight into the byte arenas. Meant
 * for streamed patches where the bytes are already at hand; pass `isGitDiff`
 * when known to skip detection
 */
export function processFileBytes(
  fileBytes: Uint8Array,
  options: ProcessFileBytesOptions = {}
): FileDiffMetadata | undefined {
  const { cacheKey, throwOnError = false } = options;
  const length = fileBytes.length;
  const isGitDiff = options.isGitDiff ?? isGitDiffBytes(fileBytes, length);

  // The header region is everything before the first hunk line; when the
  // input itself starts with `@@ `, the string parser consumes that first
  // chunk as the header, so mirror that by ending the region at the SECOND
  // hunk line
  const headerEnd = isHunkLineAt(fileBytes, 0, length)
    ? findNextHunkLine(
        fileBytes,
        lineEndExclusive(fileBytes, 0, length),
        length
      )
    : findNextHunkLine(fileBytes, 0, length);

  const currentFile: FileDiffMetadata = {
    name: '',
    type: 'change',
    hunks: [],
    splitLineCount: 0,
    unifiedLineCount: 0,
    isPartial: true,
    additionLines: EMPTY_DIFF_LINES,
    deletionLines: EMPTY_DIFF_LINES,
    cacheKey: maybeDetachOptionalString(cacheKey),
  };

  const headerText = metadataDecoder.decode(fileBytes.subarray(0, headerEnd));
  for (const line of splitWithNewlines(headerText)) {
    applyFileHeaderLine(currentFile, line, isGitDiff, throwOnError);
  }

  const additionSide = acquireSideBuilder(persistentAdditionSide, length);
  const deletionSide = acquireSideBuilder(persistentDeletionSide, length);
  let lastHunkEnd = 0;
  let position = headerEnd;

  while (position < length) {
    // `position` is always at a `@@ ` line here
    const hunkHeaderEnd = lineEndExclusive(fileBytes, position, length);
    const firstLine = metadataDecoder.decode(
      fileBytes.subarray(position, hunkHeaderEnd)
    );
    const fileHeader = parseHunkHeader(firstLine);
    if (fileHeader == null) {
      // Same handling as the string parser: report the malformed chunk and
      // skip everything up to the next hunk line
      const chunkEnd = findNextHunkLine(fileBytes, hunkHeaderEnd, length);
      if (throwOnError) {
        throw Error('parsePatchContent: Invalid hunk');
      } else {
        console.error(
          'parsePatchContent: Invalid hunk',
          metadataDecoder.decode(fileBytes.subarray(position, chunkEnd))
        );
      }
      position = chunkEnd;
      continue;
    }

    const { additionStart, deletionStart } = fileHeader;
    // On this (always partial) path the running line indexes are exactly the
    // number of lines accumulated on each side so far
    let deletionLineIndex = deletionSide.count;
    let additionLineIndex = additionSide.count;
    let additionLines = 0;
    let deletionLines = 0;

    const hunkData: Hunk = {
      collapsedBefore: 0,

      splitLineCount: 0,
      splitLineStart: 0,

      unifiedLineCount: 0,
      unifiedLineStart: 0,

      additionCount: fileHeader.additionCount,
      additionStart,
      additionLines,

      deletionCount: fileHeader.deletionCount,
      deletionStart,
      deletionLines,

      deletionLineIndex,
      additionLineIndex,

      hunkContent: [],
      hunkContext: maybeDetachOptionalString(fileHeader.hunkContext),
      hunkSpecs: firstLine,

      noEOFCRAdditions: false,
      noEOFCRDeletions: false,
    };

    let currentContent: ContextContent | ChangeContent | undefined;
    let lastLineType: 'context' | 'addition' | 'deletion' | undefined;
    let parsedAdditionLines = 0;
    let parsedDeletionLines = 0;

    position = hunkHeaderEnd;
    while (position < length && !isHunkLineAt(fileBytes, position, length)) {
      const lineEnd = lineEndExclusive(fileBytes, position, length);
      const firstByte = fileBytes[position];
      if (
        parsedAdditionLines >= hunkData.additionCount &&
        parsedDeletionLines >= hunkData.deletionCount &&
        firstByte !== BACKSLASH
      ) {
        // Counts are satisfied: whatever follows inside this chunk is
        // trailer junk (e.g. a format-patch signature) the string parser
        // also stops at
        position = findNextHunkLine(fileBytes, lineEnd, length);
        break;
      }

      if (firstByte === PLUS) {
        if (currentContent == null || currentContent.type !== 'change') {
          currentContent = createContentGroup(
            'change',
            deletionLineIndex,
            additionLineIndex
          );
          hunkData.hunkContent.push(currentContent);
        }
        additionLineIndex++;
        parsedAdditionLines++;
        appendLine(additionSide, fileBytes, position + 1, lineEnd);
        currentContent.additions++;
        additionLines++;
        lastLineType = 'addition';
      } else if (firstByte === MINUS) {
        if (currentContent == null || currentContent.type !== 'change') {
          currentContent = createContentGroup(
            'change',
            deletionLineIndex,
            additionLineIndex
          );
          hunkData.hunkContent.push(currentContent);
        }
        deletionLineIndex++;
        parsedDeletionLines++;
        appendLine(deletionSide, fileBytes, position + 1, lineEnd);
        currentContent.deletions++;
        deletionLines++;
        lastLineType = 'deletion';
      } else if (firstByte === SPACE) {
        if (currentContent == null || currentContent.type !== 'context') {
          currentContent = createContentGroup(
            'context',
            deletionLineIndex,
            additionLineIndex
          );
          hunkData.hunkContent.push(currentContent);
        }
        additionLineIndex++;
        deletionLineIndex++;
        parsedAdditionLines++;
        parsedDeletionLines++;
        appendLine(deletionSide, fileBytes, position + 1, lineEnd);
        appendLine(additionSide, fileBytes, position + 1, lineEnd);
        currentContent.lines++;
        lastLineType = 'context';
      } else if (firstByte === BACKSLASH) {
        if (currentContent != null) {
          if (currentContent.type === 'context') {
            hunkData.noEOFCRAdditions = true;
            hunkData.noEOFCRDeletions = true;
          } else if (lastLineType === 'deletion') {
            hunkData.noEOFCRDeletions = true;
          } else if (lastLineType === 'addition') {
            hunkData.noEOFCRAdditions = true;
          }
          if (lastLineType === 'addition' || lastLineType === 'context') {
            trimLastLineNewline(additionSide);
          }
          if (lastLineType === 'deletion' || lastLineType === 'context') {
            trimLastLineNewline(deletionSide);
          }
        }
      } else if (
        isBlankLine(fileBytes, position, lineEnd) &&
        restOfChunkIsBlank(fileBytes, lineEnd, length)
      ) {
        // Trailing bare newlines at the end of a chunk (format-patch
        // separators between commits) are dropped silently, like the string
        // parser stripping them before its line loop
        position = findNextHunkLine(fileBytes, lineEnd, length);
        break;
      } else {
        // Same salvage behavior as the string parser for stray content
        const rawLine = metadataDecoder.decode(
          fileBytes.subarray(position, lineEnd)
        );
        const firstChar = rawLine[0];
        console.error(
          `parseLineType: Invalid firstChar: "${firstChar}", full line: "${rawLine}"`
        );
        console.error('processFile: invalid rawLine:', rawLine);
      }
      position = lineEnd;
    }

    hunkData.additionLines = additionLines;
    hunkData.deletionLines = deletionLines;

    hunkData.collapsedBefore = Math.max(
      hunkData.additionStart - 1 - lastHunkEnd,
      0
    );
    currentFile.hunks.push(hunkData);
    lastHunkEnd = hunkData.additionStart + hunkData.additionCount - 1;
    for (const content of hunkData.hunkContent) {
      if (content.type === 'context') {
        hunkData.splitLineCount += content.lines;
        hunkData.unifiedLineCount += content.lines;
      } else {
        hunkData.splitLineCount += Math.max(
          content.additions,
          content.deletions
        );
        hunkData.unifiedLineCount += content.deletions + content.additions;
      }
    }
    hunkData.splitLineStart =
      currentFile.splitLineCount + hunkData.collapsedBefore;
    hunkData.unifiedLineStart =
      currentFile.unifiedLineCount + hunkData.collapsedBefore;

    currentFile.splitLineCount +=
      hunkData.collapsedBefore + hunkData.splitLineCount;
    currentFile.unifiedLineCount +=
      hunkData.collapsedBefore + hunkData.unifiedLineCount;
  }

  // Without full file contents there is no collapsed-after accounting, and
  // only the rename normalization from the string parser's tail applies on
  // the non-git path (the new/deleted detection needs oldFile/newFile)
  if (
    !isGitDiff &&
    currentFile.prevName != null &&
    currentFile.name !== currentFile.prevName
  ) {
    currentFile.type =
      currentFile.hunks.length > 0 ? 'rename-changed' : 'rename-pure';
  }
  if (
    currentFile.type !== 'rename-pure' &&
    currentFile.type !== 'rename-changed'
  ) {
    currentFile.prevName = undefined;
  }

  currentFile.additionLines = sealSide(additionSide);
  currentFile.deletionLines = sealSide(deletionSide);
  return currentFile;
}
