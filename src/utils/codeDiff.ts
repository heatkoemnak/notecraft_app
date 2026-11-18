export interface CodeAgentEditHunk {
  oldCode: string;
  newCode: string;
  description?: string;
}

export interface PendingDiffHunk {
  id: string;
  startLine: number; // 1-indexed line in current draft
  endLine: number; // 1-indexed inclusive end line; when oldLines is empty, endLine === startLine - 1
  oldLines: string[];
  newLines: string[];
  description?: string;
  sourceTurnId?: string;
}

function makeHunkId(): string {
  return `hunk-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function splitLines(text: string): string[] {
  return text.replace(/\r\n/g, '\n').split('\n');
}

/**
 * Computes tight line-level diff hunks between oldText and newText using LCS
 * with common prefix/suffix trimming so large files stay fast.
 */
export function computeLineDiffHunks(
  oldText: string,
  newText: string,
  baseStartLine = 1,
  description?: string,
  sourceTurnId?: string
): PendingDiffHunk[] {
  const oldAll = splitLines(oldText);
  const newAll = splitLines(newText);

  let prefix = 0;
  while (
    prefix < oldAll.length &&
    prefix < newAll.length &&
    oldAll[prefix] === newAll[prefix]
  ) {
    prefix += 1;
  }

  let suffix = 0;
  while (
    suffix < oldAll.length - prefix &&
    suffix < newAll.length - prefix &&
    oldAll[oldAll.length - 1 - suffix] === newAll[newAll.length - 1 - suffix]
  ) {
    suffix += 1;
  }

  const a = oldAll.slice(prefix, oldAll.length - suffix);
  const b = newAll.slice(prefix, newAll.length - suffix);

  if (a.length === 0 && b.length === 0) {
    return [];
  }

  const startOffset = baseStartLine + prefix;

  // Guard huge matrices: if O(m*n) exceeds ~3.5M cells, collapse middle diff cleanly into one hunk
  if (a.length * b.length > 3_500_000) {
    return [
      {
        id: makeHunkId(),
        startLine: startOffset,
        endLine: startOffset + a.length - 1,
        oldLines: a,
        newLines: b,
        description,
        sourceTurnId,
      },
    ];
  }

  const m = a.length;
  const n = b.length;
  // Use Int32Array flat DP table for speed and low memory
  const stride = n + 1;
  const dp = new Int32Array((m + 1) * stride);

  for (let i = m - 1; i >= 0; i -= 1) {
    const row = i * stride;
    const nextRow = (i + 1) * stride;
    for (let j = n - 1; j >= 0; j -= 1) {
      if (a[i] === b[j]) {
        dp[row + j] = 1 + dp[nextRow + j + 1];
      } else {
        const down = dp[nextRow + j];
        const right = dp[row + j + 1];
        dp[row + j] = down >= right ? down : right;
      }
    }
  }

  type Op = { type: 'eq' | 'del' | 'add'; line: string };
  const ops: Op[] = [];
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (a[i] === b[j]) {
      ops.push({ type: 'eq', line: a[i] });
      i += 1;
      j += 1;
    } else if (dp[(i + 1) * stride + j] >= dp[i * stride + (j + 1)]) {
      ops.push({ type: 'del', line: a[i] });
      i += 1;
    } else {
      ops.push({ type: 'add', line: b[j] });
      j += 1;
    }
  }
  while (i < m) {
    ops.push({ type: 'del', line: a[i] });
    i += 1;
  }
  while (j < n) {
    ops.push({ type: 'add', line: b[j] });
    j += 1;
  }

  // Group contiguous del/add runs into tight hunks (split whenever >= 1 equal line separates them)
  const hunks: PendingDiffHunk[] = [];
  let oldLineNum = startOffset;
  let idx = 0;

  while (idx < ops.length) {
    if (ops[idx].type === 'eq') {
      oldLineNum += 1;
      idx += 1;
      continue;
    }

    const hunkStartLine = oldLineNum;
    const oldLines: string[] = [];
    const newLines: string[] = [];

    while (idx < ops.length && ops[idx].type !== 'eq') {
      if (ops[idx].type === 'del') {
        oldLines.push(ops[idx].line);
        oldLineNum += 1;
      } else {
        newLines.push(ops[idx].line);
      }
      idx += 1;
    }

    hunks.push({
      id: makeHunkId(),
      startLine: hunkStartLine,
      endLine: hunkStartLine + oldLines.length - 1,
      oldLines,
      newLines,
      description,
      sourceTurnId,
    });
  }

  return hunks;
}

function findTrimmedLineBlockMatch(
  draftLines: string[],
  searchLines: string[],
  claimedLines: Set<number>
): number {
  const cleanSearch = [...searchLines];
  while (cleanSearch.length > 0 && cleanSearch[0].trim() === '') cleanSearch.shift();
  while (cleanSearch.length > 0 && cleanSearch[cleanSearch.length - 1].trim() === '') {
    cleanSearch.pop();
  }
  if (cleanSearch.length === 0) return -1;

  for (let start = 0; start <= draftLines.length - cleanSearch.length; start += 1) {
    let conflict = false;
    let matched = true;
    for (let k = 0; k < cleanSearch.length; k += 1) {
      if (claimedLines.has(start + k)) {
        conflict = true;
        break;
      }
      if (draftLines[start + k].trim() !== cleanSearch[k].trim()) {
        matched = false;
        break;
      }
    }
    if (!conflict && matched) {
      return start;
    }
  }
  return -1;
}

/**
 * Resolves targeted AI search/replace edits into sorted non-overlapping PendingDiffHunk[].
 */
export function buildHunksFromSearchReplace(
  draft: string,
  edits: CodeAgentEditHunk[],
  fallbackCursorLine = 1,
  sourceTurnId?: string
): { hunks: PendingDiffHunk[]; unmatchedEdits: CodeAgentEditHunk[] } {
  const normDraft = draft.replace(/\r\n/g, '\n');
  const draftLines = normDraft.split('\n');
  const claimedLines = new Set<number>();
  const hunks: PendingDiffHunk[] = [];
  const unmatchedEdits: CodeAgentEditHunk[] = [];

  for (const edit of edits) {
    const cleanOld = (edit.oldCode ?? '').replace(/\r\n/g, '\n');
    const cleanNew = (edit.newCode ?? '').replace(/\r\n/g, '\n');

    if (!cleanOld.trim() && cleanNew.length > 0) {
      const insertAt = Math.max(1, Math.min(draftLines.length + 1, fallbackCursorLine));
      hunks.push({
        id: makeHunkId(),
        startLine: insertAt,
        endLine: insertAt - 1,
        oldLines: [],
        newLines: cleanNew.split('\n'),
        description: edit.description,
        sourceTurnId,
      });
      continue;
    }

    // 1. Try exact substring match(es) avoiding already-claimed lines
    let searchFrom = 0;
    let matchedStartLine = -1;
    let matchedEndLine = -1;
    let matchedOldSegment = cleanOld;

    while (searchFrom <= normDraft.length) {
      const pos = normDraft.indexOf(cleanOld, searchFrom);
      if (pos === -1) break;
      const startLine = normDraft.slice(0, pos).split('\n').length;
      const spanLines = cleanOld.split('\n').length;
      const endLine = startLine + spanLines - 1;
      let conflict = false;
      for (let ln = startLine - 1; ln < endLine; ln += 1) {
        if (claimedLines.has(ln)) {
          conflict = true;
          break;
        }
      }
      if (!conflict) {
        matchedStartLine = startLine;
        matchedEndLine = endLine;
        matchedOldSegment = draftLines.slice(startLine - 1, endLine).join('\n');
        break;
      }
      searchFrom = pos + 1;
    }

    // 2. Fallback: trimmed line-by-line match
    if (matchedStartLine === -1) {
      const searchLines = cleanOld.split('\n');
      const idx = findTrimmedLineBlockMatch(draftLines, searchLines, claimedLines);
      if (idx >= 0) {
        const cleanLen = searchLines.filter((l, i) => {
          if (i === 0 && l.trim() === '') return false;
          if (i === searchLines.length - 1 && l.trim() === '') return false;
          return true;
        }).length;
        matchedStartLine = idx + 1;
        matchedEndLine = idx + Math.max(1, cleanLen);
        matchedOldSegment = draftLines.slice(matchedStartLine - 1, matchedEndLine).join('\n');
      }
    }

    if (matchedStartLine === -1) {
      unmatchedEdits.push(edit);
      continue;
    }

    for (let ln = matchedStartLine - 1; ln < matchedEndLine; ln += 1) {
      claimedLines.add(ln);
    }

    const subHunks = computeLineDiffHunks(
      matchedOldSegment,
      cleanNew,
      matchedStartLine,
      edit.description,
      sourceTurnId
    );
    hunks.push(...subHunks);
  }

  hunks.sort((a, b) => a.startLine - b.startLine);
  return { hunks, unmatchedEdits };
}

export function applySingleDiffHunk(
  draft: string,
  hunk: PendingDiffHunk
): { nextDraft: string; lineDelta: number; nextCursorOffset: number } {
  const lines = splitLines(draft);
  const startIdx = Math.max(0, Math.min(lines.length, hunk.startLine - 1));
  const deleteCount = Math.max(0, Math.min(lines.length - startIdx, hunk.oldLines.length));

  const nextLines = [
    ...lines.slice(0, startIdx),
    ...hunk.newLines,
    ...lines.slice(startIdx + deleteCount),
  ];

  const nextDraft = nextLines.join('\n');
  const lineDelta = hunk.newLines.length - deleteCount;
  const cursorLineIdx = startIdx + hunk.newLines.length;
  const nextCursorOffset = nextLines
    .slice(0, cursorLineIdx)
    .reduce((acc, l) => acc + l.length + 1, 0);

  return {
    nextDraft,
    lineDelta,
    nextCursorOffset: Math.min(nextDraft.length, nextCursorOffset),
  };
}

/**
 * Accepts a single '+' line (at newLineIdx within hunk.newLines) into draft,
 * updating/splitting any remaining unaccepted lines in that hunk cleanly.
 */
export function acceptSingleLineInHunk(
  draft: string,
  hunk: PendingDiffHunk,
  newLineIdx: number
): {
  nextDraft: string;
  lineDelta: number;
  remainingHunks: PendingDiffHunk[];
  nextCursorOffset: number;
} {
  if (newLineIdx < 0 || newLineIdx >= hunk.newLines.length) {
    return { nextDraft: draft, lineDelta: 0, remainingHunks: [hunk], nextCursorOffset: 0 };
  }

  const lines = splitLines(draft);
  const acceptedLine = hunk.newLines[newLineIdx];
  const hasPairedOldLine = newLineIdx < hunk.oldLines.length;

  let nextLines: string[];
  let lineDelta: number;
  let cursorLineIdx: number;

  if (hasPairedOldLine) {
    const targetIdx = Math.max(0, Math.min(lines.length - 1, hunk.startLine - 1 + newLineIdx));
    nextLines = [...lines.slice(0, targetIdx), acceptedLine, ...lines.slice(targetIdx + 1)];
    lineDelta = 0;
    cursorLineIdx = targetIdx + 1;
  } else {
    const insertIdx = Math.max(
      0,
      Math.min(lines.length, hunk.startLine - 1 + newLineIdx)
    );
    nextLines = [...lines.slice(0, insertIdx), acceptedLine, ...lines.slice(insertIdx)];
    lineDelta = 1;
    cursorLineIdx = insertIdx + 1;
  }

  const remainingHunks: PendingDiffHunk[] = [];

  const beforeOld = hunk.oldLines.slice(0, Math.min(newLineIdx, hunk.oldLines.length));
  const beforeNew = hunk.newLines.slice(0, newLineIdx);
  if (beforeOld.length > 0 || beforeNew.length > 0) {
    remainingHunks.push({
      id: makeHunkId(),
      startLine: hunk.startLine,
      endLine: hunk.startLine + beforeOld.length - 1,
      oldLines: beforeOld,
      newLines: beforeNew,
      description: hunk.description,
      sourceTurnId: hunk.sourceTurnId,
    });
  }

  const afterOld = hunk.oldLines.slice(newLineIdx + 1);
  const afterNew = hunk.newLines.slice(newLineIdx + 1);
  if (afterOld.length > 0 || afterNew.length > 0) {
    const afterStart = hunk.startLine + newLineIdx + 1;
    remainingHunks.push({
      id: makeHunkId(),
      startLine: afterStart,
      endLine: afterStart + afterOld.length - 1,
      oldLines: afterOld,
      newLines: afterNew,
      description: hunk.description,
      sourceTurnId: hunk.sourceTurnId,
    });
  }

  const nextDraft = nextLines.join('\n');
  const nextCursorOffset = nextLines
    .slice(0, cursorLineIdx)
    .reduce((acc, l) => acc + l.length + 1, 0);

  return {
    nextDraft,
    lineDelta,
    remainingHunks,
    nextCursorOffset: Math.min(nextDraft.length, nextCursorOffset),
  };
}

export function applyAllDiffHunks(
  draft: string,
  hunks: PendingDiffHunk[]
): { nextDraft: string; nextCursorOffset: number } {
  const sorted = [...hunks].sort((a, b) => a.startLine - b.startLine);
  let curDraft = draft;
  let cumulativeDelta = 0;
  let lastOffset = 0;

  for (const hunk of sorted) {
    const shifted: PendingDiffHunk = {
      ...hunk,
      startLine: hunk.startLine + cumulativeDelta,
      endLine: hunk.endLine + cumulativeDelta,
    };
    const res = applySingleDiffHunk(curDraft, shifted);
    curDraft = res.nextDraft;
    cumulativeDelta += res.lineDelta;
    lastOffset = res.nextCursorOffset;
  }

  return { nextDraft: curDraft, nextCursorOffset: lastOffset };
}
