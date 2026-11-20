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

function expandSingleLineBraces(raw: string): string {
  // If a brace-based snippet has multiple statements on one line (e.g. `function f(){a();b();}`),
  // expand braces/semicolons cleanly while respecting strings and comments.
  const lines = raw.replace(/\r\n/g, '\n').split('\n');
  const out: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      out.push('');
      continue;
    }

    // Only expand a line when it clearly packs multiple blocks/statements onto one line
    const hasPackedBlock =
      (trimmed.includes('{') && trimmed.includes('}') && trimmed.indexOf('{') < trimmed.lastIndexOf('}')) ||
      (trimmed.includes('{') && trimmed.includes(';') && !trimmed.startsWith('for') && !trimmed.endsWith('{'));

    if (!hasPackedBlock) {
      out.push(trimmed);
      continue;
    }

    let current = '';
    let inSingle = false;
    let inDouble = false;
    let inBacktick = false;
    let escaped = false;
    let parenDepth = 0;

    for (let i = 0; i < trimmed.length; i += 1) {
      const ch = trimmed[i];
      const next = trimmed[i + 1] ?? '';

      if (escaped) {
        current += ch;
        escaped = false;
        continue;
      }
      if ((inSingle || inDouble || inBacktick) && ch === '\\') {
        current += ch;
        escaped = true;
        continue;
      }
      if (!inDouble && !inBacktick && ch === "'") {
        inSingle = !inSingle;
        current += ch;
        continue;
      }
      if (!inSingle && !inBacktick && ch === '"') {
        inDouble = !inDouble;
        current += ch;
        continue;
      }
      if (!inSingle && !inDouble && ch === '`') {
        inBacktick = !inBacktick;
        current += ch;
        continue;
      }
      if (inSingle || inDouble || inBacktick) {
        current += ch;
        continue;
      }
      if (ch === '/' && next === '/') {
        current += trimmed.slice(i);
        break;
      }

      if (ch === '(') parenDepth += 1;
      else if (ch === ')') parenDepth = Math.max(0, parenDepth - 1);

      if (ch === '{') {
        current += '{';
        if (next !== '}') {
          out.push(current.trim());
          current = '';
        }
        continue;
      }
      if (ch === '}') {
        if (current.trim()) {
          out.push(current.trim());
          current = '';
        }
        current = '}';
        if (next !== ';' && next !== ',' && next !== ')') {
          out.push(current);
          current = '';
        }
        continue;
      }
      if (ch === ';' && parenDepth === 0) {
        current += ';';
        out.push(current.trim());
        current = '';
        continue;
      }
      current += ch;
    }
    if (current.trim()) {
      out.push(current.trim());
    }
  }

  return out.join('\n');
}

function formatBraceCode(raw: string): string {
  const expanded = expandSingleLineBraces(raw);
  const lines = expanded.split('\n');
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

function formatXmlOrHtmlFallback(raw: string): string {
  const normalized = raw
    .replace(/\r\n/g, '\n')
    .replace(/>\s*</g, '>\n<')
    .split('\n');
  const out: string[] = [];
  let depth = 0;

  for (const rawLine of normalized) {
    const trimmed = rawLine.trim();
    if (!trimmed) continue;

    const isClosing = /^<\//.test(trimmed);
    const isSelfClosing =
      /\/>$/.test(trimmed) ||
      /^<(!DOCTYPE|meta|link|br|hr|img|input|source|track|wbr|\?)/i.test(trimmed);
    const isSameLineClosed = /^<([a-zA-Z0-9:-]+)[^>]*>.*<\/\1>$/.test(trimmed);
    const isOpening = /^<[a-zA-Z]/.test(trimmed) && !isClosing && !isSelfClosing && !isSameLineClosed;

    if (isClosing) {
      depth = Math.max(0, depth - 1);
    }
    out.push(`${'  '.repeat(depth)}${trimmed}`);
    if (isOpening) {
      depth += 1;
    }
  }
  return out.length > 0 ? `${out.join('\n')}\n` : '';
}

function formatWhitespaceFallback(text: string, filename: string): string {
  const lower = filename.toLowerCase();
  const isMakefile = lower === 'makefile' || lower === 'gnumakefile';
  const isPython = lower.endsWith('.py');
  const normalizedLines = text.replace(/\r\n/g, '\n').split('\n');
  const out: string[] = [];
  let blankStreak = 0;

  for (const rawLine of normalizedLines) {
    const trimmedRight = rawLine.replace(/[ \t]+$/, '');
    const cleaned = isMakefile
      ? trimmedRight
      : trimmedRight.replace(/^(\t+)/, (tabs) => (isPython ? '    ' : '  ').repeat(tabs.length));
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
  return out.length > 0 ? `${out.join('\n')}\n` : '';
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

  if (['html', 'htm', 'xml', 'svg'].includes(ext)) {
    return { ok: true, value: formatXmlOrHtmlFallback(text) };
  }

  if (
    [
      'ts',
      'tsx',
      'mts',
      'cts',
      'js',
      'jsx',
      'mjs',
      'cjs',
      'jsonc',
      'json5',
      'css',
      'scss',
      'less',
      'go',
      'rs',
      'c',
      'cpp',
      'h',
      'hpp',
      'java',
      'php',
      'dart',
      'swift',
      'kt',
    ].includes(ext)
  ) {
    return { ok: true, value: formatBraceCode(text) };
  }

  return { ok: true, value: formatWhitespaceFallback(text, filename) };
}

async function formatWithPrettier(
  text: string,
  filename: string,
  range?: { rangeStart: number; rangeEnd: number }
): Promise<{ handled: boolean; formatted?: string; error?: string }> {
  const lower = filename.toLowerCase();
  const ext = lower.includes('.') ? lower.split('.').pop() || '' : '';

  let parser: string | null = null;
  if (['js', 'jsx', 'mjs', 'cjs'].includes(ext)) parser = 'babel';
  else if (['ts', 'tsx', 'mts', 'cts'].includes(ext)) parser = 'typescript';
  else if (ext === 'json') parser = 'json';
  else if (ext === 'jsonc') parser = 'jsonc';
  else if (ext === 'json5') parser = 'json5';
  else if (ext === 'css') parser = 'css';
  else if (ext === 'scss') parser = 'scss';
  else if (ext === 'less') parser = 'less';
  else if (['html', 'htm', 'vue'].includes(ext)) parser = ext === 'vue' ? 'vue' : 'html';
  else if (['yml', 'yaml'].includes(ext)) parser = 'yaml';
  else if (['md', 'mdx'].includes(ext)) parser = ext === 'mdx' ? 'mdx' : 'markdown';

  if (!parser) {
    return { handled: false };
  }

  try {
    const prettier = await import('prettier/standalone');
    const plugins: unknown[] = [];

    if (parser === 'babel' || parser === 'json' || parser === 'jsonc' || parser === 'json5') {
      const [babelPlugin, estreePlugin] = await Promise.all([
        import('prettier/plugins/babel'),
        import('prettier/plugins/estree'),
      ]);
      plugins.push(babelPlugin.default ?? babelPlugin, estreePlugin.default ?? estreePlugin);
    } else if (parser === 'typescript') {
      const [tsPlugin, estreePlugin] = await Promise.all([
        import('prettier/plugins/typescript'),
        import('prettier/plugins/estree'),
      ]);
      plugins.push(tsPlugin.default ?? tsPlugin, estreePlugin.default ?? estreePlugin);
    } else if (parser === 'css' || parser === 'scss' || parser === 'less') {
      const postcssPlugin = await import('prettier/plugins/postcss');
      plugins.push(postcssPlugin.default ?? postcssPlugin);
    } else if (parser === 'html' || parser === 'vue') {
      const htmlPlugin = await import('prettier/plugins/html');
      plugins.push(htmlPlugin.default ?? htmlPlugin);
    } else if (parser === 'yaml') {
      const yamlPlugin = await import('prettier/plugins/yaml');
      plugins.push(yamlPlugin.default ?? yamlPlugin);
    } else if (parser === 'markdown' || parser === 'mdx') {
      const mdPlugin = await import('prettier/plugins/markdown');
      plugins.push(mdPlugin.default ?? mdPlugin);
    }

    const formatted = await prettier.format(text, {
      parser,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      plugins: plugins as any[],
      tabWidth: 2,
      useTabs: false,
      semi: true,
      singleQuote: true,
      printWidth: 100,
      ...(range ? { rangeStart: range.rangeStart, rangeEnd: range.rangeEnd } : {}),
    });

    return { handled: true, formatted };
  } catch (err) {
    return {
      handled: true,
      error: err instanceof Error ? err.message.split('\n')[0] : 'Syntax error while formatting.',
    };
  }
}

export async function formatSourceDocumentAsync(
  text: string,
  filename: string
): Promise<{ ok: boolean; value: string; notice?: string }> {
  const lower = filename.toLowerCase();
  const ext = lower.includes('.') ? lower.split('.').pop() || '' : '';

  const prettierRes = await formatWithPrettier(text, filename);
  if (prettierRes.handled) {
    if (typeof prettierRes.formatted === 'string') {
      return { ok: true, value: prettierRes.formatted };
    }
    if (ext === 'json') {
      return {
        ok: false,
        value: text,
        notice: prettierRes.error ? `Invalid JSON: ${prettierRes.error}` : 'Invalid JSON syntax.',
      };
    }
    // Fallback to structural formatter when partial/template syntax prevents full AST parse
    const fallback = formatSourceDocument(text, filename);
    if (fallback.value !== text) {
      return { ok: true, value: fallback.value };
    }
    return {
      ok: false,
      value: text,
      notice: prettierRes.error || 'Could not format due to syntax error.',
    };
  }

  return formatSourceDocument(text, filename);
}

export async function formatSelectionRangeAsync(
  text: string,
  filename: string,
  start: number,
  end: number
): Promise<{ ok: boolean; edit?: EditResult; notice?: string }> {
  if (end <= start) {
    const docRes = await formatSourceDocumentAsync(text, filename);
    return {
      ok: docRes.ok,
      edit: { value: docRes.value, selectionStart: start, selectionEnd: start },
      notice: docRes.notice,
    };
  }

  const { lines, firstLine, lastLine, lineStarts } = getSelectedLineIndices(text, start, end);
  const lineStartOffset = lineStarts[firstLine] ?? 0;
  const lineEndOffset =
    lastLine < lines.length - 1
      ? (lineStarts[lastLine + 1] ?? text.length) - 1
      : text.length;

  // 1. Try Prettier range formatting first when supported
  const prettierRange = await formatWithPrettier(text, filename, {
    rangeStart: lineStartOffset,
    rangeEnd: lineEndOffset,
  });

  if (prettierRange.handled && typeof prettierRange.formatted === 'string') {
    const formattedText = prettierRange.formatted;
    const lengthDelta = formattedText.length - text.length;
    const nextEnd = Math.max(lineStartOffset, Math.min(formattedText.length, lineEndOffset + lengthDelta));
    return {
      ok: true,
      edit: {
        value: formattedText,
        selectionStart: lineStartOffset,
        selectionEnd: nextEnd,
      },
    };
  }

  // 2. Standalone selection block formatting preserving base indentation
  const selectedLines = lines.slice(firstLine, lastLine + 1);
  let minIndent = Infinity;
  for (const ln of selectedLines) {
    if (!ln.trim()) continue;
    const m = ln.match(/^([ \t]*)/);
    minIndent = Math.min(minIndent, m ? m[1].length : 0);
  }
  const baseIndentLen = Number.isFinite(minIndent) ? minIndent : 0;
  const baseIndentStr =
    selectedLines.find((ln) => ln.trim())?.slice(0, baseIndentLen) ?? '';

  const dedentedBlock = selectedLines
    .map((ln) => (ln.length >= baseIndentLen ? ln.slice(baseIndentLen) : ln.trimStart()))
    .join('\n');

  const blockPrettier = await formatWithPrettier(dedentedBlock, filename);
  let formattedBlock =
    blockPrettier.handled && typeof blockPrettier.formatted === 'string'
      ? blockPrettier.formatted
      : formatSourceDocument(dedentedBlock, filename).value;

  formattedBlock = formattedBlock.replace(/\n$/, '');
  const reindentedBlock = formattedBlock
    .split('\n')
    .map((ln) => (ln.trim() ? `${baseIndentStr}${ln}` : ''))
    .join('\n');

  const nextValue = `${text.slice(0, lineStartOffset)}${reindentedBlock}${text.slice(lineEndOffset)}`;
  return {
    ok: true,
    edit: {
      value: nextValue,
      selectionStart: lineStartOffset,
      selectionEnd: lineStartOffset + reindentedBlock.length,
    },
  };
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

export function expandWordAtOffset(
  text: string,
  offset: number
): { start: number; end: number; text: string } | null {
  if (!text) return null;
  const isWordChar = (ch: string) => /[A-Za-z0-9_$-]/.test(ch);
  let pos = Math.max(0, Math.min(text.length, offset));
  if (pos === text.length || !isWordChar(text[pos] ?? '')) {
    if (pos > 0 && isWordChar(text[pos - 1] ?? '')) {
      pos -= 1;
    } else {
      return null;
    }
  }
  let start = pos;
  let end = pos + 1;
  while (start > 0 && isWordChar(text[start - 1] ?? '')) {
    start -= 1;
  }
  while (end < text.length && isWordChar(text[end] ?? '')) {
    end += 1;
  }
  const word = text.slice(start, end);
  return word ? { start, end, text: word } : null;
}

export function applyMultiRangeEdit(
  prevText: string,
  nextText: string,
  newCursor: number,
  ranges: TextMatchRange[],
  primaryIndex: number
): { value: string; ranges: TextMatchRange[]; primaryIndex: number } | null {
  if (ranges.length === 0) return null;
  const safePrimaryIdx = Math.max(0, Math.min(ranges.length - 1, primaryIndex));
  const primary = ranges[safePrimaryIdx];

  let editStart: number;
  let prevEditEnd: number;
  let inserted: string;

  if (primary.end > primary.start) {
    // Active selection in primary range was replaced or deleted
    editStart = primary.start;
    prevEditEnd = primary.end;
    const clampedCursor = Math.max(editStart, Math.min(nextText.length, newCursor));
    inserted = nextText.slice(editStart, clampedCursor);
  } else if (newCursor < primary.start) {
    // Backspace before collapsed caret
    editStart = Math.max(0, newCursor);
    prevEditEnd = primary.start;
    inserted = '';
  } else if (newCursor === primary.start && nextText.length < prevText.length) {
    // Forward Delete at collapsed caret
    const deletedLen = prevText.length - nextText.length;
    editStart = primary.start;
    prevEditEnd = Math.min(prevText.length, primary.start + deletedLen);
    inserted = '';
  } else {
    // Character input or paste at collapsed caret
    editStart = primary.start;
    prevEditEnd = primary.start;
    const clampedCursor = Math.max(editStart, Math.min(nextText.length, newCursor));
    inserted = nextText.slice(editStart, clampedCursor);
  }

  const relStart = editStart - primary.start;
  const relEnd = prevEditEnd - primary.end;

  let out = '';
  let prevCursor = 0;
  const nextRanges: TextMatchRange[] = [];

  for (let i = 0; i < ranges.length; i += 1) {
    const r = ranges[i];
    const targetStart = Math.max(prevCursor, Math.min(prevText.length, r.start + relStart));
    const targetEnd = Math.max(targetStart, Math.min(prevText.length, r.end + relEnd));
    out += prevText.slice(prevCursor, targetStart);
    const nextPos = out.length + inserted.length;
    out += inserted;
    prevCursor = targetEnd;
    nextRanges.push({ start: nextPos, end: nextPos });
  }
  out += prevText.slice(prevCursor);

  return {
    value: out,
    ranges: nextRanges,
    primaryIndex: safePrimaryIdx,
  };
}

interface ParsedTagToken {
  kind: 'open' | 'close' | 'self';
  name: string;
  nameStart: number;
  nameEnd: number;
  tagStart: number;
  tagEnd: number;
}

const AUTO_RENAME_EXTENSIONS = new Set([
  'html',
  'htm',
  'xml',
  'svg',
  'xhtml',
  'jsx',
  'tsx',
  'js',
  'mjs',
  'cjs',
  'vue',
  'svelte',
  'php',
  'astro',
  'erb',
  'ejs',
  'hbs',
]);

const HTML_VOID_TAGS = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr',
]);

function scanMarkupTags(text: string, filename: string): ParsedTagToken[] {
  const lower = filename.toLowerCase();
  const ext = lower.includes('.') ? lower.split('.').pop() || '' : '';
  const isHtmlLike = ['html', 'htm', 'php', 'erb', 'ejs', 'hbs'].includes(ext);
  const trackJsxBraces = ['jsx', 'tsx', 'js', 'mjs', 'cjs', 'svelte', 'astro'].includes(ext);
  const tokens: ParsedTagToken[] = [];
  const len = text.length;
  let i = 0;

  while (i < len) {
    if (text[i] !== '<') {
      i += 1;
      continue;
    }

    // HTML comment <!-- ... -->
    if (text.startsWith('<!--', i)) {
      const closeComment = text.indexOf('-->', i + 4);
      i = closeComment === -1 ? len : closeComment + 3;
      continue;
    }

    // Doctype / declaration <!...> or processing instruction <?...>
    const nextCh = text[i + 1] ?? '';
    if (nextCh === '!' || nextCh === '?') {
      const gt = text.indexOf('>', i + 2);
      i = gt === -1 ? len : gt + 1;
      continue;
    }

    // Closing tag </name> (supports empty </> during live editing)
    if (nextCh === '/') {
      const nameStart = i + 2;
      let j = nameStart;
      while (j < len && /[A-Za-z0-9._:-]/.test(text[j] ?? '')) {
        j += 1;
      }
      const nameEnd = j;
      while (j < len && (text[j] === ' ' || text[j] === '\t')) {
        j += 1;
      }
      if (j < len && text[j] === '>') {
        tokens.push({
          kind: 'close',
          name: text.slice(nameStart, nameEnd),
          nameStart,
          nameEnd,
          tagStart: i,
          tagEnd: j + 1,
        });
        i = j + 1;
        continue;
      }
      i += 2;
      continue;
    }

    // Opening or self-closing tag <name ...> (supports empty <> during live editing)
    const isEmptyTagCandidate = nextCh === '>';
    const isValidStart = isEmptyTagCandidate || /[A-Za-z_]/.test(nextCh);
    if (!isValidStart) {
      i += 1;
      continue;
    }

    const nameStart = i + 1;
    let j = nameStart;
    while (j < len && /[A-Za-z0-9._:-]/.test(text[j] ?? '')) {
      j += 1;
    }
    const nameEnd = j;
    const afterName = text[j] ?? '';
    if (
      afterName !== '>' &&
      afterName !== '/' &&
      afterName !== ' ' &&
      afterName !== '\t' &&
      afterName !== '\n' &&
      afterName !== '\r'
    ) {
      i += 1;
      continue;
    }

    let inSingle = false;
    let inDouble = false;
    let inBacktick = false;
    let escaped = false;
    let braceDepth = 0;
    let foundGt = -1;

    while (j < len) {
      const ch = text[j];
      if (escaped) {
        escaped = false;
        j += 1;
        continue;
      }
      if ((inSingle || inDouble || inBacktick) && ch === '\\') {
        escaped = true;
        j += 1;
        continue;
      }
      if (!inDouble && !inBacktick && ch === "'") {
        inSingle = !inSingle;
        j += 1;
        continue;
      }
      if (!inSingle && !inBacktick && ch === '"') {
        inDouble = !inDouble;
        j += 1;
        continue;
      }
      if (trackJsxBraces && !inSingle && !inDouble && ch === '`') {
        inBacktick = !inBacktick;
        j += 1;
        continue;
      }
      if (inSingle || inDouble || inBacktick) {
        j += 1;
        continue;
      }
      if (trackJsxBraces) {
        if (ch === '{') {
          braceDepth += 1;
          j += 1;
          continue;
        }
        if (ch === '}') {
          braceDepth = Math.max(0, braceDepth - 1);
          j += 1;
          continue;
        }
      }
      if (ch === '>' && braceDepth === 0) {
        foundGt = j;
        break;
      }
      // Bail if we hit an unquoted '<' before '>' unless inside JSX braces (means unclosed comparison like a<b)
      if (ch === '<' && braceDepth === 0) {
        break;
      }
      j += 1;
    }

    if (foundGt === -1) {
      i += 1;
      continue;
    }

    const name = text.slice(nameStart, nameEnd);
    let checkIdx = foundGt - 1;
    while (checkIdx >= nameEnd && /\s/.test(text[checkIdx] ?? '')) {
      checkIdx -= 1;
    }
    const hasTrailingSlash = checkIdx >= nameEnd && text[checkIdx] === '/';
    const isVoid = isHtmlLike && name.length > 0 && HTML_VOID_TAGS.has(name.toLowerCase());

    tokens.push({
      kind: hasTrailingSlash || isVoid ? 'self' : 'open',
      name,
      nameStart,
      nameEnd,
      tagStart: i,
      tagEnd: foundGt + 1,
    });
    i = foundGt + 1;
  }

  return tokens;
}

export function applyAutoRenameTag(
  prevText: string,
  nextText: string,
  newCursor: number,
  filename: string
): EditResult | null {
  if (prevText === nextText || prevText.length > 250_000) return null;
  const lower = filename.toLowerCase();
  const ext = lower.includes('.') ? lower.split('.').pop() || '' : '';
  if (!AUTO_RENAME_EXTENSIONS.has(ext)) return null;

  // Locate single changed span between prevText and nextText
  let editStart = 0;
  const minLen = Math.min(prevText.length, nextText.length);
  while (editStart < minLen && prevText[editStart] === nextText[editStart]) {
    editStart += 1;
  }

  let prevEditEnd = prevText.length;
  let nextEditEnd = nextText.length;
  while (
    prevEditEnd > editStart &&
    nextEditEnd > editStart &&
    prevText[prevEditEnd - 1] === nextText[nextEditEnd - 1]
  ) {
    prevEditEnd -= 1;
    nextEditEnd -= 1;
  }

  const inserted = nextText.slice(editStart, nextEditEnd);
  if (/[\s<>/]/.test(inserted)) return null;

  const tags = scanMarkupTags(prevText, filename);
  if (tags.length < 2) return null;

  const editedIdx = tags.findIndex(
    (t) => t.kind !== 'self' && editStart >= t.nameStart && prevEditEnd <= t.nameEnd
  );
  if (editedIdx === -1) return null;

  const editedTag = tags[editedIdx];
  const oldName = editedTag.name;
  const delta = nextText.length - prevText.length;
  const newNameEnd = editedTag.nameEnd + delta;
  if (newNameEnd < editedTag.nameStart) return null;

  const newName = nextText.slice(editedTag.nameStart, newNameEnd);
  if (newName === oldName || !/^[A-Za-z0-9._:-]*$/.test(newName)) {
    return null;
  }

  let partnerTag: ParsedTagToken | null = null;
  if (editedTag.kind === 'open') {
    let depth = 0;
    for (let k = editedIdx + 1; k < tags.length; k += 1) {
      const candidate = tags[k];
      if (candidate.name !== oldName) continue;
      if (candidate.kind === 'open') {
        depth += 1;
      } else if (candidate.kind === 'close') {
        if (depth === 0) {
          partnerTag = candidate;
          break;
        }
        depth -= 1;
      }
    }
  } else {
    const openStack: ParsedTagToken[] = [];
    for (let k = 0; k < editedIdx; k += 1) {
      const candidate = tags[k];
      if (candidate.name !== oldName) continue;
      if (candidate.kind === 'open') {
        openStack.push(candidate);
      } else if (candidate.kind === 'close' && openStack.length > 0) {
        openStack.pop();
      }
    }
    if (openStack.length > 0) {
      partnerTag = openStack[openStack.length - 1];
    }
  }

  if (!partnerTag) return null;

  const partnerBeforeEdited = partnerTag.nameStart < editedTag.nameStart;
  const partnerStartInNext = partnerBeforeEdited
    ? partnerTag.nameStart
    : partnerTag.nameStart + delta;
  const partnerEndInNext = partnerBeforeEdited
    ? partnerTag.nameEnd
    : partnerTag.nameEnd + delta;

  if (nextText.slice(partnerStartInNext, partnerEndInNext) !== oldName) {
    return null;
  }

  const updated = `${nextText.slice(0, partnerStartInNext)}${newName}${nextText.slice(
    partnerEndInNext
  )}`;
  const cursorShift = partnerBeforeEdited ? newName.length - oldName.length : 0;
  const shiftedCursor = Math.max(0, Math.min(updated.length, newCursor + cursorShift));

  return {
    value: updated,
    selectionStart: shiftedCursor,
    selectionEnd: shiftedCursor,
  };
}
