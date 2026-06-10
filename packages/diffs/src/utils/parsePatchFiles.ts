import {
  COMMIT_METADATA_SPLIT,
  GIT_DIFF_FILE_BREAK_REGEX,
  UNIFIED_DIFF_FILE_BREAK_REGEX,
} from '../constants';
import type {
  ChangeContent,
  ContextContent,
  FileContents,
  FileDiffMetadata,
  Hunk,
  HunkLineType,
  ParsedPatch,
} from '../types';
import { cleanLastNewline } from './cleanLastNewline';
import { detachString, releaseStringDetachBuffer } from './detachString';
import {
  EMPTY_DIFF_LINES,
  finishLines,
  isWellFormed,
  releaseLineScratch,
} from './diffLines';
import {
  applyFileHeaderLine,
  createContentGroup,
  maybeDetachOptionalString,
  parseHunkHeader,
  splitWithNewlines,
} from './parsePatchShared';

export function processPatch(
  data: string,
  cacheKeyPrefix?: string,
  throwOnError?: boolean
): ParsedPatch {
  try {
    return _processPatch(data, cacheKeyPrefix, throwOnError);
  } finally {
    releaseStringDetachBuffer();
    releaseLineScratch();
  }
}

function _processPatch(
  data: string,
  cacheKeyPrefix?: string,
  throwOnError = false
): ParsedPatch {
  const isGitDiff = isGitDiffPatch(data);
  const rawFiles = isGitDiff
    ? splitAtLinePrefix(data, 'diff --git')
    : data.split(UNIFIED_DIFF_FILE_BREAK_REGEX);
  let patchMetadata: string | undefined;
  const files: FileDiffMetadata[] = [];
  for (const fileOrPatchMetadata of rawFiles) {
    if (isGitDiff && !GIT_DIFF_FILE_BREAK_REGEX.test(fileOrPatchMetadata)) {
      if (patchMetadata == null) {
        patchMetadata = detachString(fileOrPatchMetadata);
      } else {
        if (throwOnError) {
          throw Error('parsePatchContent: unknown file blob');
        } else {
          console.error(
            'parsePatchContent: unknown file blob:',
            fileOrPatchMetadata
          );
        }
      }
      // If we get in here, it's most likely the introductory metadata from the
      // patch, or something is fucked with the diff format
      continue;
    } else if (
      !isGitDiff &&
      !UNIFIED_DIFF_FILE_BREAK_REGEX.test(fileOrPatchMetadata)
    ) {
      if (patchMetadata == null) {
        patchMetadata = detachString(fileOrPatchMetadata);
      } else {
        if (throwOnError) {
          throw Error('parsePatchContent: unknown file blob');
        } else {
          console.error(
            'parsePatchContent: unknown file blob:',
            fileOrPatchMetadata
          );
        }
      }
      continue;
    }
    const currentFile = _processFile(fileOrPatchMetadata, {
      cacheKey:
        cacheKeyPrefix != null
          ? `${cacheKeyPrefix}-${files.length}`
          : undefined,
      isGitDiff,
      throwOnError,
    });
    if (currentFile != null) {
      files.push(currentFile);
    }
  }
  return { patchMetadata, files };
}

interface ProcessFileOptions {
  cacheKey?: string;
  isGitDiff?: boolean;
  oldFile?: FileContents;
  newFile?: FileContents;
  throwOnError?: boolean;
}

export function processFile(
  fileDiffString: string,
  options?: ProcessFileOptions
): FileDiffMetadata | undefined {
  try {
    return _processFile(fileDiffString, options);
  } finally {
    releaseStringDetachBuffer();
    releaseLineScratch();
  }
}

function _processFile(
  fileDiffString: string,
  {
    cacheKey,
    isGitDiff = GIT_DIFF_FILE_BREAK_REGEX.test(fileDiffString),
    oldFile,
    newFile,
    throwOnError = false,
  }: ProcessFileOptions = {}
): FileDiffMetadata | undefined {
  let lastHunkEnd = 0;
  const hunks = splitAtLinePrefix(fileDiffString, '@@ ');
  let currentFile: FileDiffMetadata | undefined;
  const isPartial = oldFile == null || newFile == null;
  let deletionLineIndex = 0;
  let additionLineIndex = 0;
  let additionLineList: string[] = [];
  let deletionLineList: string[] = [];
  // A lone surrogate can't survive the UTF-8 round-trip; checking the whole file
  // once here lets `finishLines` skip the per-line check on the common path
  const losslessFileDiff = isWellFormed(fileDiffString);
  for (const hunk of hunks) {
    const lines = splitWithNewlines(hunk);
    const firstLine = lines[0];
    if (firstLine == null) {
      if (throwOnError) {
        throw Error('parsePatchContent: invalid hunk');
      } else {
        console.error('parsePatchContent: invalid hunk', hunk);
      }
      continue;
    }
    const fileHeader = parseHunkHeader(firstLine);
    let additionLines = 0;
    let deletionLines = 0;
    // Setup currentFile, this should be the first iteration of our hunks, and
    // technically not a hunk
    if (fileHeader == null || currentFile == null) {
      if (currentFile != null) {
        if (throwOnError) {
          throw Error('parsePatchContent: Invalid hunk');
        } else {
          console.error('parsePatchContent: Invalid hunk', hunk);
        }
        continue;
      }
      additionLineList =
        !isPartial && oldFile != null && newFile != null
          ? splitWithNewlines(newFile.contents)
          : [];
      deletionLineList =
        !isPartial && oldFile != null && newFile != null
          ? splitWithNewlines(oldFile.contents)
          : [];
      // If either file is technically empty, then we should empty the
      // arrays respectively
      if (additionLineList.length === 1 && newFile?.contents === '') {
        additionLineList.length = 0;
      }
      if (deletionLineList.length === 1 && oldFile?.contents === '') {
        deletionLineList.length = 0;
      }
      currentFile = {
        name: '',
        type: 'change',
        hunks: [],
        splitLineCount: 0,
        unifiedLineCount: 0,
        isPartial,
        additionLines: EMPTY_DIFF_LINES,
        deletionLines: EMPTY_DIFF_LINES,
        cacheKey: maybeDetachOptionalString(cacheKey),
      };

      for (const line of lines) {
        applyFileHeaderLine(currentFile, line, isGitDiff, throwOnError);
      }
      continue;
    }

    // Otherwise, time to start parsing out the hunk
    let currentContent: ContextContent | ChangeContent | undefined;
    let lastLineType: 'context' | 'addition' | 'deletion' | undefined;

    // Strip trailing bare newlines (format-patch separators between commits)
    // if needed
    while (
      lines.length > 0 &&
      (lines[lines.length - 1] === '\n' ||
        lines[lines.length - 1] === '\r' ||
        lines[lines.length - 1] === '\r\n' ||
        lines[lines.length - 1] === '')
    ) {
      lines.pop();
    }

    const { additionStart, deletionStart } = fileHeader;
    deletionLineIndex = isPartial ? deletionLineIndex : deletionStart - 1;
    additionLineIndex = isPartial ? additionLineIndex : additionStart - 1;

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
      hunkSpecs: detachString(firstLine),

      noEOFCRAdditions: false,
      noEOFCRDeletions: false,
    };

    // Now we process each line of the hunk
    let parsedAdditionLines = 0;
    let parsedDeletionLines = 0;
    for (let lineIndex = 1; lineIndex < lines.length; lineIndex++) {
      const rawLine = lines[lineIndex];
      if (
        parsedAdditionLines >= hunkData.additionCount &&
        parsedDeletionLines >= hunkData.deletionCount &&
        !rawLine.startsWith('\\')
      ) {
        break;
      }

      const firstChar = rawLine[0];
      // If we can't properly process the line, well, lets just try to salvage
      // things and continue... It's possible an AI generated diff might have
      // some stray blank lines or something in there
      if (
        firstChar !== '+' &&
        firstChar !== '-' &&
        firstChar !== ' ' &&
        firstChar !== '\\'
      ) {
        console.error(
          `parseLineType: Invalid firstChar: "${firstChar}", full line: "${rawLine}"`
        );
        console.error('processFile: invalid rawLine:', rawLine);
        continue;
      }

      const type = parseRawLineType(firstChar);
      if (type === 'addition') {
        const line = getParsedLineContent(rawLine);
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
        if (isPartial) {
          additionLineList.push(line);
        }
        currentContent.additions++;
        additionLines++;
        lastLineType = 'addition';
      } else if (type === 'deletion') {
        const line = getParsedLineContent(rawLine);
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
        if (isPartial) {
          deletionLineList.push(line);
        }
        currentContent.deletions++;
        deletionLines++;
        lastLineType = 'deletion';
      } else if (type === 'context') {
        const line = getParsedLineContent(rawLine);
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
        if (isPartial) {
          deletionLineList.push(line);
          additionLineList.push(line);
        }
        currentContent.lines++;
        lastLineType = 'context';
      } else if (type === 'metadata' && currentContent != null) {
        if (currentContent.type === 'context') {
          hunkData.noEOFCRAdditions = true;
          hunkData.noEOFCRDeletions = true;
        } else if (lastLineType === 'deletion') {
          hunkData.noEOFCRDeletions = true;
        } else if (lastLineType === 'addition') {
          hunkData.noEOFCRAdditions = true;
        }
        // If we're dealing with partial content from a diff, we need to strip
        // newlines manually from the content
        if (
          isPartial &&
          (lastLineType === 'addition' || lastLineType === 'context')
        ) {
          const lastIndex = additionLineList.length - 1;
          if (lastIndex >= 0) {
            additionLineList[lastIndex] = cleanLastNewline(
              additionLineList[lastIndex]
            );
          }
        }
        if (
          isPartial &&
          (lastLineType === 'deletion' || lastLineType === 'context')
        ) {
          const lastIndex = deletionLineList.length - 1;
          if (lastIndex >= 0) {
            deletionLineList[lastIndex] = cleanLastNewline(
              deletionLineList[lastIndex]
            );
          }
        }
      }
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
  if (currentFile == null) {
    return undefined;
  }

  // Account for collapsed lines after the final hunk and increment the
  // split/unified counts properly
  if (
    currentFile.hunks.length > 0 &&
    !isPartial &&
    additionLineList.length > 0 &&
    deletionLineList.length > 0
  ) {
    const lastHunk = currentFile.hunks[currentFile.hunks.length - 1];
    const lastHunkEnd = lastHunk.additionStart + lastHunk.additionCount - 1;
    const totalFileLines = additionLineList.length;
    const collapsedAfter = Math.max(totalFileLines - lastHunkEnd, 0);
    currentFile.splitLineCount += collapsedAfter;
    currentFile.unifiedLineCount += collapsedAfter;
  }

  // If this isn't a git diff style patch, then we'll need to sus out some
  // additional metadata manually
  if (!isGitDiff) {
    if (
      currentFile.prevName != null &&
      currentFile.name !== currentFile.prevName
    ) {
      if (currentFile.hunks.length > 0) {
        currentFile.type = 'rename-changed';
      } else {
        currentFile.type = 'rename-pure';
      }
    }
    // Sort of a hack for detecting deleted/added files...
    else if (
      (oldFile == null || oldFile.contents === '') &&
      newFile != null &&
      newFile.contents !== ''
    ) {
      currentFile.type = 'new';
    } else if (
      oldFile != null &&
      oldFile.contents !== '' &&
      (newFile == null || newFile.contents === '')
    ) {
      currentFile.type = 'deleted';
    }
  }
  if (
    currentFile.type !== 'rename-pure' &&
    currentFile.type !== 'rename-changed'
  ) {
    currentFile.prevName = undefined;
  }
  // Seal each side's lines into one compact byte arena per file. On the
  // partial-patch path every line is a slice of `fileDiffString` so the
  // single surrogate check above lets the seal skip per-line checks; a
  // full-file diff is rarer and falls back to the safe per-line check
  currentFile.additionLines = finishLines(
    additionLineList,
    isPartial && losslessFileDiff
  );
  currentFile.deletionLines = finishLines(
    deletionLineList,
    isPartial && losslessFileDiff
  );
  return currentFile;
}

/**
 * Parses a patch file string into an array of parsed patches.
 *
 * @param data - The raw patch file content (supports multi-commit patches)
 * @param cacheKeyPrefix - Optional prefix for generating cache keys. When provided,
 *   each file in the patch will get a cache key in the format `prefix-patchIndex-fileIndex`.
 *   This enables caching of rendered diff results in the worker pool.
 */
export function parsePatchFiles(
  data: string,
  cacheKeyPrefix?: string,
  throwOnError = false
): ParsedPatch[] {
  // NOTE(amadeus): This function is pretty forgiving in that it can accept a
  // patch file that includes commit metdata, multiple commits, or not
  const patches: ParsedPatch[] = [];
  const rawPatches = hasCommitMetadataBoundary(data)
    ? data.split(COMMIT_METADATA_SPLIT)
    : [data];
  for (const patch of rawPatches) {
    try {
      patches.push(
        processPatch(
          patch,
          cacheKeyPrefix != null
            ? `${cacheKeyPrefix}-${patches.length}`
            : undefined,
          throwOnError
        )
      );
    } catch (error) {
      if (throwOnError) {
        throw error;
      } else {
        console.error(error);
      }
    }
  }
  return patches;
}

function hasCommitMetadataBoundary(data: string): boolean {
  return data.startsWith('From ') || data.includes('\nFrom ');
}

function isGitDiffPatch(data: string): boolean {
  return data.startsWith('diff --git') || data.includes('\ndiff --git');
}

function splitAtLinePrefix(contents: string, prefix: string): string[] {
  if (contents.length === 0) {
    return [''];
  }

  const newlinePrefix = `\n${prefix}`;
  const firstBoundaryIndex = contents.startsWith(prefix)
    ? 0
    : findLinePrefixIndex(contents, newlinePrefix, 0);
  if (firstBoundaryIndex === -1) {
    return [contents];
  }

  const parts: string[] = [];
  if (firstBoundaryIndex > 0) {
    parts.push(contents.slice(0, firstBoundaryIndex));
  }

  let startIndex = firstBoundaryIndex;
  for (;;) {
    const nextBoundaryIndex = findLinePrefixIndex(
      contents,
      newlinePrefix,
      startIndex + 1
    );
    if (nextBoundaryIndex === -1) {
      break;
    }

    parts.push(contents.slice(startIndex, nextBoundaryIndex));
    startIndex = nextBoundaryIndex;
  }
  parts.push(contents.slice(startIndex));
  return parts;
}

function findLinePrefixIndex(
  contents: string,
  newlinePrefix: string,
  fromIndex: number
): number {
  const index = contents.indexOf(newlinePrefix, fromIndex);
  return index === -1 ? -1 : index + 1;
}

function parseRawLineType(
  firstChar: string | undefined
): Exclude<HunkLineType, 'expanded'> {
  return firstChar === ' '
    ? 'context'
    : firstChar === '\\'
      ? 'metadata'
      : firstChar === '+'
        ? 'addition'
        : 'deletion';
}

function getParsedLineContent(rawLine: string): string {
  const processedLine = rawLine.slice(1);
  return processedLine === '' ? '\n' : processedLine;
}
