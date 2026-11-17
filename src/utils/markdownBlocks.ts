export type DocBlock =
  | { id: string; type: 'heading'; level: 1 | 2 | 3 | 4; text: string }
  | { id: string; type: 'paragraph'; text: string }
  | { id: string; type: 'blockquote'; text: string }
  | { id: string; type: 'task-item'; checked: boolean; text: string }
  | { id: string; type: 'bullet-item'; text: string }
  | { id: string; type: 'ordered-item'; text: string }
  | { id: string; type: 'code'; language: string; code: string }
  | {
      id: string;
      type: 'table';
      headers: string[];
      alignments: ('left' | 'center' | 'right')[];
      rows: string[][];
      colWidths?: number[];
    }
  | { id: string; type: 'image'; alt: string; src: string }
  | { id: string; type: 'file'; label: string; src: string }
  | { id: string; type: 'hr' };

let blockIdCounter = 0;

export function createBlockId(): string {
  blockIdCounter += 1;
  return `blk-${Date.now().toString(36)}-${blockIdCounter}`;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function sanitizeHref(url: string): string {
  const trimmed = url.trim();
  if (/^(https?:|mailto:|notecraft-file:\/\/|\/|#)/i.test(trimmed)) {
    return trimmed.replace(/"/g, '&quot;');
  }
  return '#';
}

function formatInlineSegment(segment: string): string {
  let out = escapeHtml(segment);

  // Links: [label](url)
  out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, label: string, url: string) => {
    const safeUrl = sanitizeHref(url);
    return `<a href="${safeUrl}" target="_blank" rel="noopener noreferrer">${label}</a>`;
  });

  // Bold + Italic: ***text***
  out = out.replace(/\*\*\*([^*\n]+?)\*\*\*/g, '<strong><em>$1</em></strong>');

  // Bold: **text** or __text__
  out = out.replace(/\*\*([^*\n]+?)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/__([^_\n]+?)__/g, '<strong>$1</strong>');

  // Strikethrough: ~~text~~
  out = out.replace(/~~([^~\n]+?)~~/g, '<del>$1</del>');

  // Italic: *text* or _text_
  out = out.replace(/(^|[^*])\*([^*\n]+?)\*(?!\*)/g, '$1<em>$2</em>');
  out = out.replace(/(^|[^_\w])_([^_\n]+?)_(?![_\w])/g, '$1<em>$2</em>');

  // Line breaks
  out = out.replace(/\n/g, '<br>');

  return out;
}

export function inlineMarkdownToHtml(markdown: string): string {
  if (!markdown) return '';
  const cleanMarkdown = markdown.replace(/\u200B/g, '');

  const parts: string[] = [];
  const codeRegex = /`([^`\n]+)`/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = codeRegex.exec(cleanMarkdown)) !== null) {
    if (match.index > lastIndex) {
      parts.push(formatInlineSegment(cleanMarkdown.slice(lastIndex, match.index)));
    }
    parts.push(`<code data-inline-code="true">${escapeHtml(match[1])}</code>`);
    lastIndex = codeRegex.lastIndex;
  }

  if (lastIndex < cleanMarkdown.length) {
    parts.push(formatInlineSegment(cleanMarkdown.slice(lastIndex)));
  }

  return parts.join('');
}

function wrapWithMarker(inner: string, marker: string): string {
  if (!inner) return '';
  const leading = /^\s*/.exec(inner)?.[0] || '';
  const trailing = /\s*$/.exec(inner)?.[0] || '';
  const core = inner.trim();
  if (!core) return inner;
  return `${leading}${marker}${core}${marker}${trailing}`;
}

function serializeChildNodes(parent: Node): string {
  const nodes = Array.from(parent.childNodes);
  let result = '';

  for (let i = 0; i < nodes.length; i += 1) {
    const node = nodes[i];
    if (node.nodeType === Node.TEXT_NODE) {
      result += (node.textContent || '').replace(/\u00A0/g, ' ').replace(/\u200B/g, '');
      continue;
    }

    if (node.nodeType !== Node.ELEMENT_NODE) continue;
    const el = node as HTMLElement;
    const tag = el.tagName.toUpperCase();

    if (tag === 'BR') {
      // Ignore single browser sentinel <br> at the very end of contentEditable
      const isLast = i === nodes.length - 1;
      if (!isLast) {
        result += '\n';
      }
      continue;
    }

    if (tag === 'CODE') {
      const codeText = (el.textContent || '')
        .replace(/\u00A0/g, ' ')
        .replace(/\u200B/g, '')
        .replace(/`/g, '');
      if (codeText) {
        result += `\`${codeText}\``;
      }
      continue;
    }

    if (tag === 'STRONG' || tag === 'B') {
      result += wrapWithMarker(serializeChildNodes(el), '**');
      continue;
    }

    if (tag === 'EM' || tag === 'I') {
      result += wrapWithMarker(serializeChildNodes(el), '*');
      continue;
    }

    if (tag === 'DEL' || tag === 'S' || tag === 'STRIKE') {
      result += wrapWithMarker(serializeChildNodes(el), '~~');
      continue;
    }

    if (tag === 'A') {
      const label = serializeChildNodes(el).trim();
      const href = el.getAttribute('href') || '';
      if (label && href) {
        result += `[${label}](${href})`;
      } else {
        result += label;
      }
      continue;
    }

    if (tag === 'DIV' || tag === 'P') {
      const inner = serializeChildNodes(el);
      if (result && !result.endsWith('\n')) {
        result += '\n';
      }
      result += inner;
      continue;
    }

    result += serializeChildNodes(el);
  }

  return result;
}

export function htmlToInlineMarkdown(container: HTMLElement): string {
  return serializeChildNodes(container).replace(/\n+$/g, '');
}

function parseTableRow(line: string): string[] {
  let trimmed = line.trim();
  if (trimmed.startsWith('|')) trimmed = trimmed.slice(1);
  if (trimmed.endsWith('|')) trimmed = trimmed.slice(0, -1);
  return trimmed.split('|').map((cell) => cell.trim());
}

function isTableSeparatorLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed.includes('-')) return false;
  return /^\|?(\s*:?-+:?\s*\|)+\s*:?-+:?\s*\|?$/.test(trimmed) || /^\|(\s*:?-+:?\s*\|)+$/.test(trimmed);
}

function parseTableAlignments(line: string, columnCount: number): ('left' | 'center' | 'right')[] {
  const cells = parseTableRow(line);
  const alignments: ('left' | 'center' | 'right')[] = [];
  for (let i = 0; i < columnCount; i += 1) {
    const cell = (cells[i] || '').trim();
    if (cell.startsWith(':') && cell.endsWith(':')) {
      alignments.push('center');
    } else if (cell.endsWith(':')) {
      alignments.push('right');
    } else {
      alignments.push('left');
    }
  }
  return alignments;
}

export function parseMarkdownToBlocks(markdown: string): DocBlock[] {
  const normalized = markdown.replace(/\r\n/g, '\n');
  if (!normalized.trim()) {
    return [{ id: createBlockId(), type: 'paragraph', text: '' }];
  }

  const lines = normalized.split('\n');
  const blocks: DocBlock[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Skip blank lines
    if (!line.trim()) {
      i += 1;
      continue;
    }

    // Fenced code block
    const fenceMatch = /^```([a-zA-Z0-9_-]*)\s*$/.exec(line.trim());
    if (fenceMatch) {
      const language = fenceMatch[1] || 'text';
      const codeLines: string[] = [];
      i += 1;
      while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) {
        codeLines.push(lines[i]);
        i += 1;
      }
      if (i < lines.length && /^\s*```\s*$/.test(lines[i])) {
        i += 1;
      }
      blocks.push({
        id: createBlockId(),
        type: 'code',
        language,
        code: codeLines.join('\n'),
      });
      continue;
    }

    // Heading (# .. ####)
    const headingMatch = /^(#{1,4})\s+(.+?)\s*$/.exec(line);
    if (headingMatch) {
      blocks.push({
        id: createBlockId(),
        type: 'heading',
        level: headingMatch[1].length as 1 | 2 | 3 | 4,
        text: headingMatch[2].replace(/\s+#+$/, ''),
      });
      i += 1;
      continue;
    }

    // Horizontal rule
    if (/^\s*(?:---+|===+|\*\*\*+|___+)\s*$/.test(line) && !line.trim().startsWith('=')) {
      blocks.push({ id: createBlockId(), type: 'hr' });
      i += 1;
      continue;
    }

    // Standalone image: ![alt](src)
    const imageMatch = /^\s*!\[([^\]]*)\]\(([^)]+)\)\s*$/.exec(line);
    if (imageMatch) {
      blocks.push({
        id: createBlockId(),
        type: 'image',
        alt: imageMatch[1],
        src: imageMatch[2].trim(),
      });
      i += 1;
      continue;
    }

    // Standalone file attachment: [label](notecraft-file://...)
    const fileMatch = /^\s*\[([^\]]+)\]\((notecraft-file:\/\/[^)\s]+)\)\s*$/.exec(line);
    if (fileMatch) {
      blocks.push({
        id: createBlockId(),
        type: 'file',
        label: fileMatch[1],
        src: fileMatch[2].trim(),
      });
      i += 1;
      continue;
    }

    // Optional table column widths comment right before a GFM table
    let pendingColWidths: number[] | undefined;
    const widthCommentMatch = /^\s*<!--\s*table-widths:\s*([0-9,\s]+)\s*-->\s*$/.exec(line);
    if (widthCommentMatch) {
      let tableStart = i + 1;
      while (tableStart < lines.length && !lines[tableStart].trim()) {
        tableStart += 1;
      }
      if (
        tableStart + 1 < lines.length &&
        lines[tableStart].includes('|') &&
        isTableSeparatorLine(lines[tableStart + 1])
      ) {
        pendingColWidths = widthCommentMatch[1]
          .split(',')
          .map((n) => Math.max(72, Math.min(800, Math.round(Number(n.trim()) || 140))));
        i = tableStart;
      } else {
        i += 1;
        continue;
      }
    }

    const activeLine = lines[i];

    // GFM Table
    if (activeLine.includes('|') && i + 1 < lines.length && isTableSeparatorLine(lines[i + 1])) {
      const headers = parseTableRow(activeLine);
      const alignments = parseTableAlignments(lines[i + 1], headers.length);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && lines[i].trim() && lines[i].includes('|')) {
        const row = parseTableRow(lines[i]);
        while (row.length < headers.length) row.push('');
        rows.push(row.slice(0, headers.length));
        i += 1;
      }
      const normalizedWidths =
        pendingColWidths && pendingColWidths.length === headers.length
          ? pendingColWidths
          : undefined;
      blocks.push({
        id: createBlockId(),
        type: 'table',
        headers,
        alignments,
        rows,
        ...(normalizedWidths ? { colWidths: normalizedWidths } : {}),
      });
      continue;
    }

    // Blockquote (> ...)
    if (/^\s*>\s?/.test(line)) {
      const quoteLines: string[] = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
        quoteLines.push(lines[i].replace(/^\s*>\s?/, ''));
        i += 1;
      }
      blocks.push({
        id: createBlockId(),
        type: 'blockquote',
        text: quoteLines.join('\n'),
      });
      continue;
    }

    // Task checklist item (- [ ] or - [x])
    const taskMatch = /^\s*(?:[-*+])\s+\[([ xX])\]\s+(.*)$/.exec(line);
    if (taskMatch) {
      blocks.push({
        id: createBlockId(),
        type: 'task-item',
        checked: taskMatch[1].toLowerCase() === 'x',
        text: taskMatch[2],
      });
      i += 1;
      continue;
    }

    // Bullet list item
    const bulletMatch = /^\s*[-*+]\s+(.*)$/.exec(line);
    if (bulletMatch) {
      blocks.push({
        id: createBlockId(),
        type: 'bullet-item',
        text: bulletMatch[1],
      });
      i += 1;
      continue;
    }

    // Ordered list item
    const orderedMatch = /^\s*\d+\.\s+(.*)$/.exec(line);
    if (orderedMatch) {
      blocks.push({
        id: createBlockId(),
        type: 'ordered-item',
        text: orderedMatch[1],
      });
      i += 1;
      continue;
    }

    // Paragraph (consume until blank line or block starter)
    const paraLines: string[] = [line];
    i += 1;
    while (i < lines.length) {
      const next = lines[i];
      if (!next.trim()) break;
      if (
        /^```/.test(next.trim()) ||
        /^(#{1,4})\s+/.test(next) ||
        /^\s*(?:---+|\*\*\*+|___+)\s*$/.test(next) ||
        /^\s*!\[[^\]]*\]\([^)]+\)\s*$/.test(next) ||
        /^\s*\[[^\]]+\]\(notecraft-file:\/\/[^)\s]+\)\s*$/.test(next) ||
        /^\s*>\s?/.test(next) ||
        /^\s*(?:[-*+])\s+\[[ xX]\]\s+/.test(next) ||
        /^\s*[-*+]\s+/.test(next) ||
        /^\s*\d+\.\s+/.test(next) ||
        /^\s*<!--\s*table-widths:/.test(next) ||
        (next.includes('|') && i + 1 < lines.length && isTableSeparatorLine(lines[i + 1]))
      ) {
        break;
      }
      paraLines.push(next);
      i += 1;
    }

    blocks.push({
      id: createBlockId(),
      type: 'paragraph',
      text: paraLines.join('\n'),
    });
  }

  return blocks.length > 0 ? blocks : [{ id: createBlockId(), type: 'paragraph', text: '' }];
}

function isListType(type: DocBlock['type']): boolean {
  return type === 'task-item' || type === 'bullet-item' || type === 'ordered-item';
}

export function serializeBlocksToMarkdown(blocks: DocBlock[]): string {
  if (blocks.length === 0) return '';

  const chunks: string[] = [];
  let orderedCounter = 0;

  for (let i = 0; i < blocks.length; i += 1) {
    const block = blocks[i];

    if (block.type === 'ordered-item') {
      orderedCounter += 1;
    } else {
      orderedCounter = 0;
    }

    let serialized = '';
    switch (block.type) {
      case 'heading': {
        const prefix = '#'.repeat(block.level);
        serialized = `${prefix} ${block.text}`;
        break;
      }
      case 'paragraph': {
        serialized = block.text;
        break;
      }
      case 'blockquote': {
        serialized = block.text
          .split('\n')
          .map((l) => `> ${l}`)
          .join('\n');
        break;
      }
      case 'task-item': {
        serialized = `- [${block.checked ? 'x' : ' '}] ${block.text}`;
        break;
      }
      case 'bullet-item': {
        serialized = `- ${block.text}`;
        break;
      }
      case 'ordered-item': {
        serialized = `${orderedCounter}. ${block.text}`;
        break;
      }
      case 'code': {
        const lang = block.language.trim() || 'text';
        serialized = `\`\`\`${lang}\n${block.code}\n\`\`\``;
        break;
      }
      case 'table': {
        const colCount = Math.max(1, block.headers.length);
        const headerLine = `| ${block.headers.map((h) => h.replace(/\|/g, '\\|')).join(' | ')} |`;
        const sepLine = `| ${Array.from({ length: colCount }, (_, idx) => {
          const align = block.alignments[idx] || 'left';
          if (align === 'center') return ':---:';
          if (align === 'right') return '---:';
          return ':---';
        }).join(' | ')} |`;
        const rowLines = block.rows.map(
          (row) =>
            `| ${Array.from({ length: colCount }, (_, idx) =>
              (row[idx] || '').replace(/\|/g, '\\|')
            ).join(' | ')} |`
        );
        const widthComment =
          block.colWidths && block.colWidths.length === colCount
            ? `<!-- table-widths: ${block.colWidths.map((w) => Math.round(w)).join(',')} -->\n`
            : '';
        serialized = `${widthComment}${[headerLine, sepLine, ...rowLines].join('\n')}`;
        break;
      }
      case 'image': {
        serialized = `![${block.alt}](${block.src})`;
        break;
      }
      case 'file': {
        serialized = `[${block.label}](${block.src})`;
        break;
      }
      case 'hr': {
        serialized = '---';
        break;
      }
    }

    if (i === 0) {
      chunks.push(serialized);
    } else {
      const prev = blocks[i - 1];
      const sameListGroup =
        isListType(block.type) &&
        isListType(prev.type) &&
        block.type === prev.type;
      chunks.push((sameListGroup ? '\n' : '\n\n') + serialized);
    }
  }

  return chunks.join('').replace(/\n+$/, '') + '\n';
}
