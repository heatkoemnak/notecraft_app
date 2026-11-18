export interface EditResult {
  value: string;
  selectionStart: number;
  selectionEnd: number;
}

function getSelectedLineIndices(
  text: string,
  start: number,
  end: number
): { lines: string[]; firstLine: number; lastLine: number; lineStarts: number[] } {
  const lines = text.split('\n');
  const lineStarts: number[] = [];
  let offset = 0;
  for (let i = 0; i < lines.length; i += 1) {
    lineStarts.push(offset);
    offset += lines[i].length + 1;
  }

  const effectiveEnd = end > start && text[end - 1] === '\n' ? end - 1 : end;

  let firstLine = 0;
  let lastLine = 0;
  for (let i = 0; i < lineStarts.length; i += 1) {
    if (lineStarts[i] <= start) firstLine = i;
    if (lineStarts[i] <= effectiveEnd) lastLine = i;
  }

  return { lines, firstLine, lastLine, lineStarts };
}

export function deleteSelectedLines(
  text: string,
  start: number,
  end: number
): EditResult {
  const { lines, firstLine, lastLine, lineStarts } = getSelectedLineIndices(text, start, end);
  if (lines.length <= 1 && firstLine === 0 && lastLine === 0) {
    return { value: '', selectionStart: 0, selectionEnd: 0 };
  }

  const nextLines = [
    ...lines.slice(0, firstLine),
    ...lines.slice(lastLine + 1),
  ];
  const nextValue = nextLines.join('\n');
  const targetLine = Math.min(firstLine, Math.max(0, nextLines.length - 1));

  let cursor = 0;
  for (let i = 0; i < targetLine; i += 1) {
    cursor += nextLines[i].length + 1;
  }
  const col = Math.max(0, start - lineStarts[firstLine]);
  const nextCursor = Math.min(
    nextValue.length,
    cursor + Math.min(col, nextLines[targetLine]?.length ?? 0)
  );

  return {
    value: nextValue,
    selectionStart: nextCursor,
    selectionEnd: nextCursor,
  };
}

export function moveSelectedLines(
  text: string,
  start: number,
  end: number,
  direction: 'up' | 'down'
): EditResult {
  const { lines, firstLine, lastLine } = getSelectedLineIndices(text, start, end);

  if (direction === 'up') {
    if (firstLine === 0) {
      return { value: text, selectionStart: start, selectionEnd: end };
    }
    const swappedLine = lines[firstLine - 1];
    const delta = -(swappedLine.length + 1);
    const nextLines = [
      ...lines.slice(0, firstLine - 1),
      ...lines.slice(firstLine, lastLine + 1),
      swappedLine,
      ...lines.slice(lastLine + 1),
    ];
    return {
      value: nextLines.join('\n'),
      selectionStart: Math.max(0, start + delta),
      selectionEnd: Math.max(0, end + delta),
    };
  }

  if (lastLine >= lines.length - 1) {
    return { value: text, selectionStart: start, selectionEnd: end };
  }
  const swappedLine = lines[lastLine + 1];
  const delta = swappedLine.length + 1;
  const nextLines = [
    ...lines.slice(0, firstLine),
    swappedLine,
    ...lines.slice(firstLine, lastLine + 1),
    ...lines.slice(lastLine + 2),
  ];
  return {
    value: nextLines.join('\n'),
    selectionStart: start + delta,
    selectionEnd: end + delta,
  };
}

export function duplicateSelectedLines(
  text: string,
  start: number,
  end: number,
  direction: 'up' | 'down' = 'down'
): EditResult {
  const { lines, firstLine, lastLine } = getSelectedLineIndices(text, start, end);
  const block = lines.slice(firstLine, lastLine + 1);
  const blockChars = block.join('\n').length + 1;

  const nextLines = [
    ...lines.slice(0, lastLine + 1),
    ...block,
    ...lines.slice(lastLine + 1),
  ];

  const offset = direction === 'down' ? blockChars : 0;
  return {
    value: nextLines.join('\n'),
    selectionStart: start + offset,
    selectionEnd: end + offset,
  };
}

type CommentSyntax =
  | { kind: 'line'; token: string }
  | { kind: 'block'; open: string; close: string };

function getCommentSyntax(filename: string): CommentSyntax {
  const lower = filename.toLowerCase();
  if (
    lower === 'dockerfile' ||
    lower.startsWith('dockerfile.') ||
    lower === '.env' ||
    lower.startsWith('.env.') ||
    lower === 'makefile' ||
    lower === 'gnumakefile' ||
    lower === 'nginx.conf' ||
    lower.endsWith('.nginx')
  ) {
    return { kind: 'line', token: '#' };
  }
  const ext = lower.includes('.') ? lower.split('.').pop() || '' : '';
  if (['py', 'sh', 'bash', 'zsh', 'yml', 'yaml', 'toml', 'ini', 'cfg', 'conf', 'rb'].includes(ext)) {
    return { kind: 'line', token: '#' };
  }
  if (ext === 'sql') {
    return { kind: 'line', token: '--' };
  }
  if (ext === 'css') {
    return { kind: 'block', open: '/*', close: '*/' };
  }
  if (['html', 'htm', 'xml', 'svg', 'md'].includes(ext)) {
    return { kind: 'block', open: '<!--', close: '-->' };
  }
  return { kind: 'line', token: '//' };
}

export function toggleCommentLines(
  text: string,
  start: number,
  end: number,
  filename: string
): EditResult {
  const { lines, firstLine, lastLine, lineStarts } = getSelectedLineIndices(text, start, end);
  const syntax = getCommentSyntax(filename);

  if (syntax.kind === 'block') {
    const selectedSlice = lines.slice(firstLine, lastLine + 1);
    const trimmedLines = selectedSlice.map((ln) => ln.trim());
    const allWrapped =
      trimmedLines.some((t) => t.length > 0) &&
      trimmedLines
        .filter((t) => t.length > 0)
        .every((t) => t.startsWith(syntax.open) && t.endsWith(syntax.close));

    const updated = selectedSlice.map((ln) => {
      if (!ln.trim() && firstLine !== lastLine) return ln;
      const indentMatch = ln.match(/^(\s*)/);
      const indent = indentMatch ? indentMatch[1] : '';
      const body = ln.slice(indent.length);
      if (allWrapped) {
        const inner = body
          .slice(syntax.open.length, body.length - syntax.close.length)
          .replace(/^ /, '')
          .replace(/ $/, '');
        return `${indent}${inner}`;
      }
      return `${indent}${syntax.open} ${body} ${syntax.close}`;
    });

    const nextLines = [
      ...lines.slice(0, firstLine),
      ...updated,
      ...lines.slice(lastLine + 1),
    ];
    const nextValue = nextLines.join('\n');
    const newStart = lineStarts[firstLine];
    const newEnd =
      lineStarts[firstLine] + updated.join('\n').length;
    return { value: nextValue, selectionStart: newStart, selectionEnd: newEnd };
  }

  const token = syntax.token;
  const targetSlice = lines.slice(firstLine, lastLine + 1);
  const nonEmptyIndices: number[] = [];
  targetSlice.forEach((ln, idx) => {
    if (ln.trim().length > 0) nonEmptyIndices.push(idx);
  });

  const activeIndices = nonEmptyIndices.length > 0 ? nonEmptyIndices : [0];
  const allCommented = activeIndices.every((idx) =>
    targetSlice[idx].trimStart().startsWith(token)
  );

  let minIndent = Infinity;
  if (!allCommented) {
    activeIndices.forEach((idx) => {
      const m = targetSlice[idx].match(/^(\s*)/);
      minIndent = Math.min(minIndent, m ? m[1].length : 0);
    });
    if (!Number.isFinite(minIndent)) minIndent = 0;
  }

  let firstDelta = 0;
  let totalDelta = 0;

  const updated = targetSlice.map((ln, idx) => {
    if (!activeIndices.includes(idx)) return ln;
    if (allCommented) {
      const indentMatch = ln.match(/^(\s*)/);
      const indent = indentMatch ? indentMatch[1] : '';
      const afterIndent = ln.slice(indent.length);
      const removeLen = afterIndent.startsWith(`${token} `)
        ? token.length + 1
        : afterIndent.startsWith(token)
        ? token.length
        : 0;
      if (idx === 0) firstDelta = -removeLen;
      totalDelta -= removeLen;
      return `${indent}${afterIndent.slice(removeLen)}`;
    }
    const insert = `${token} `;
    if (idx === 0) firstDelta = insert.length;
    totalDelta += insert.length;
    return `${ln.slice(0, minIndent)}${insert}${ln.slice(minIndent)}`;
  });

  const nextLines = [
    ...lines.slice(0, firstLine),
    ...updated,
    ...lines.slice(lastLine + 1),
  ];
  const nextValue = nextLines.join('\n');
  const nextStart = Math.max(lineStarts[firstLine], start + firstDelta);
  const nextEnd = Math.max(nextStart, end + totalDelta);

  return {
    value: nextValue,
    selectionStart: nextStart,
    selectionEnd: nextEnd,
  };
}

export function smartNewLineIndent(
  text: string,
  start: number,
  end: number
): EditResult {
  const lineStart = text.lastIndexOf('\n', Math.max(0, start - 1)) + 1;
  const lineBeforeCursor = text.slice(lineStart, start);
  const indentMatch = lineBeforeCursor.match(/^([ \t]*)/);
  const baseIndent = indentMatch ? indentMatch[1] : '';
  const trimmedRight = lineBeforeCursor.trimEnd();
  const shouldIncreaseIndent =
    trimmedRight.endsWith('{') ||
    trimmedRight.endsWith('[') ||
    trimmedRight.endsWith('(') ||
    trimmedRight.endsWith(':');

  const nextChar = text[end] ?? '';
  const isSplittingBraces =
    (trimmedRight.endsWith('{') && nextChar === '}') ||
    (trimmedRight.endsWith('[') && nextChar === ']') ||
    (trimmedRight.endsWith('(') && nextChar === ')');

  if (isSplittingBraces) {
    const inner = `\n${baseIndent}  `;
    const closing = `\n${baseIndent}`;
    const nextValue = `${text.slice(0, start)}${inner}${closing}${text.slice(end)}`;
    const cursor = start + inner.length;
    return { value: nextValue, selectionStart: cursor, selectionEnd: cursor };
  }

  const extra = shouldIncreaseIndent ? '  ' : '';
  const insertion = `\n${baseIndent}${extra}`;
  const nextValue = `${text.slice(0, start)}${insertion}${text.slice(end)}`;
  const cursor = start + insertion.length;
  return { value: nextValue, selectionStart: cursor, selectionEnd: cursor };
}

export function indentLines(
  text: string,
  start: number,
  end: number,
  unindent: boolean
): EditResult {
  if (start === end && !unindent) {
    const nextValue = `${text.slice(0, start)}  ${text.slice(end)}`;
    return {
      value: nextValue,
      selectionStart: start + 2,
      selectionEnd: start + 2,
    };
  }

  const effectiveEnd = end > start && text[end - 1] === '\n' ? end - 1 : end;
  const lineStart = text.lastIndexOf('\n', Math.max(0, start - 1)) + 1;
  const lineEndRaw = text.indexOf('\n', effectiveEnd);
  const lineEnd = lineEndRaw === -1 ? text.length : lineEndRaw;
  const block = text.slice(lineStart, lineEnd);
  const lines = block.split('\n');

  let deltaFirst = 0;
  let deltaTotal = 0;
  const updatedLines = lines.map((ln, idx) => {
    if (unindent) {
      if (ln.startsWith('  ')) {
        if (idx === 0) deltaFirst = -2;
        deltaTotal -= 2;
        return ln.slice(2);
      }
      if (ln.startsWith('\t') || ln.startsWith(' ')) {
        if (idx === 0) deltaFirst = -1;
        deltaTotal -= 1;
        return ln.slice(1);
      }
      return ln;
    }
    if (idx === 0) deltaFirst = 2;
    deltaTotal += 2;
    return `  ${ln}`;
  });

  const nextValue = `${text.slice(0, lineStart)}${updatedLines.join('\n')}${text.slice(lineEnd)}`;
  const nextStart = Math.max(lineStart, start + deltaFirst);
  const nextEnd = Math.max(nextStart, end + deltaTotal);

  return {
    value: nextValue,
    selectionStart: nextStart,
    selectionEnd: nextEnd,
  };
}

function formatBraceCode(raw: string): string {
  const normalized = raw.replace(/\r\n/g, '\n');
  const lines = normalized.split('\n');
  const result: string[] = [];
  let depth = 0;
  let inBlockComment = false;
  let blankStreak = 0;

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (!trimmed) {
      blankStreak += 1;
      if (blankStreak <= 1 && result.length > 0) {
        result.push('');
      }
      continue;
    }
    blankStreak = 0;

    // Count net leading closing braces before any code on this line
    let leadingCloses = 0;
    if (!inBlockComment) {
      for (let i = 0; i < trimmed.length; i += 1) {
        const ch = trimmed[i];
        if (ch === '}' || ch === ']' || ch === ')') {
          leadingCloses += 1;
        } else {
          break;
        }
      }
    }

    const lineDepth = Math.max(0, depth - leadingCloses);
    result.push(`${'  '.repeat(lineDepth)}${trimmed}`);

    // Update depth across the line while ignoring strings & comments
    let inSingle = false;
    let inDouble = false;
    let inBacktick = false;
    let escaped = false;

    for (let i = 0; i < trimmed.length; i += 1) {
      const ch = trimmed[i];
      const next = trimmed[i + 1] ?? '';

      if (inBlockComment) {
        if (ch === '*' && next === '/') {
          inBlockComment = false;
          i += 1;
        }
        continue;
      }

      if (escaped) {
        escaped = false;
        continue;
      }

      if ((inSingle || inDouble || inBacktick) && ch === '\\') {
        escaped = true;
        continue;
      }

      if (!inDouble && !inBacktick && ch === "'") {
        inSingle = !inSingle;
        continue;
      }
      if (!inSingle && !inBacktick && ch === '"') {
        inDouble = !inDouble;
        continue;
      }
      if (!inSingle && !inDouble && ch === '`') {
        inBacktick = !inBacktick;
        continue;
      }
      if (inSingle || inDouble || inBacktick) continue;

      if (ch === '/' && next === '/') {
        break;
      }
      if (ch === '/' && next === '*') {
        inBlockComment = true;
        i += 1;
        continue;
      }

      if (ch === '{' || ch === '[' || ch === '(') {
        depth += 1;
      } else if (ch === '}' || ch === ']' || ch === ')') {
        depth = Math.max(0, depth - 1);
      }
    }
  }

  while (result.length > 0 && result[result.length - 1] === '') {
    result.pop();
  }
  return result.length > 0 ? `${result.join('\n')}\n` : '';
}

export function formatSourceDocument(
  text: string,
  filename: string
): { ok: boolean; value: string; notice?: string } {
  const lower = filename.toLowerCase();
  const ext = lower.includes('.') ? lower.split('.').pop() || '' : '';

  if (ext === 'json') {
    try {
      const parsed = JSON.parse(text);
      return { ok: true, value: `${JSON.stringify(parsed, null, 2)}\n` };
    } catch (err) {
      return {
        ok: false,
        value: text,
        notice: err instanceof Error ? `Invalid JSON: ${err.message}` : 'Invalid JSON syntax.',
      };
    }
  }

  if (
    ['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'jsonc', 'css', 'scss', 'go', 'rs', 'c', 'cpp', 'h', 'hpp', 'java'].includes(
      ext
    )
  ) {
    return { ok: true, value: formatBraceCode(text) };
  }

  // Whitespace & newline normalization for Python, YAML, Shell, SQL, Markdown, etc.
  const isMakefile = lower === 'makefile' || lower === 'gnumakefile';
  const normalizedLines = text.replace(/\r\n/g, '\n').split('\n');
  const out: string[] = [];
  let blankStreak = 0;
  for (const rawLine of normalizedLines) {
    const trimmedRight = rawLine.replace(/[ \t]+$/, '');
    const cleaned = isMakefile
      ? trimmedRight
      : trimmedRight.replace(/^(\t+)/, (tabs) => '  '.repeat(tabs.length));
    if (!cleaned) {
      blankStreak += 1;
      if (blankStreak <= 2 && out.length > 0) {
        out.push('');
      }
    } else {
      blankStreak = 0;
      out.push(cleaned);
    }
  }
  while (out.length > 0 && out[out.length - 1] === '') {
    out.pop();
  }
  return { ok: true, value: out.length > 0 ? `${out.join('\n')}\n` : '' };
}

export function getOffsetForLineCol(
  text: string,
  targetLine: number,
  targetCol = 1
): { offset: number; clampedLine: number; clampedCol: number } {
  const lines = text.split('\n');
  const clampedLine = Math.max(1, Math.min(lines.length, Math.floor(targetLine)));
  let offset = 0;
  for (let i = 0; i < clampedLine - 1; i += 1) {
    offset += lines[i].length + 1;
  }
  const lineLen = lines[clampedLine - 1]?.length ?? 0;
  const clampedCol = Math.max(1, Math.min(lineLen + 1, Math.floor(targetCol)));
  return {
    offset: offset + (clampedCol - 1),
    clampedLine,
    clampedCol,
  };
}

export interface TextMatchRange {
  start: number;
  end: number;
}

export function findAllTextMatches(
  text: string,
  query: string,
  caseSensitive: boolean
): TextMatchRange[] {
  if (!query) return [];
  const haystack = caseSensitive ? text : text.toLowerCase();
  const needle = caseSensitive ? query : query.toLowerCase();
  const matches: TextMatchRange[] = [];
  let index = 0;
  while (index <= haystack.length) {
    const found = haystack.indexOf(needle, index);
    if (found === -1) break;
    matches.push({ start: found, end: found + needle.length });
    index = found + Math.max(1, needle.length);
    if (matches.length >= 2000) break;
  }
  return matches;
}
