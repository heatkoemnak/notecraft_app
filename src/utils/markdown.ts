import { HeadingItem } from '../types/notes';

export function slugifyHeading(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[`*_~[\]()]/g, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
}

export function extractHeadings(markdown: string): HeadingItem[] {
  const lines = markdown.split('\n');
  const headings: HeadingItem[] = [];
  let inFence = false;
  const seenIds = new Map<string, number>();

  for (const line of lines) {
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;

    const match = /^(#{1,3})\s+(.+?)\s*$/.exec(line);
    if (match) {
      const level = match[1].length;
      const rawText = match[2].replace(/\s+#+$/, '');
      const baseId = slugifyHeading(rawText) || 'section';
      const count = seenIds.get(baseId) ?? 0;
      seenIds.set(baseId, count + 1);
      const id = count === 0 ? baseId : `${baseId}-${count}`;
      headings.push({ id, text: rawText, level });
    }
  }

  return headings;
}

export function getDocumentStats(markdown: string) {
  const trimmed = markdown.trim();
  const words = trimmed ? trimmed.split(/\s+/).length : 0;
  const lines = markdown ? markdown.split('\n').length : 0;
  const readMinutes = Math.max(1, Math.ceil(words / 220));
  const codeBlockMatches = markdown.match(/```[\s\S]*?```/g);
  const codeBlocks = codeBlockMatches ? codeBlockMatches.length : 0;
  return { words, lines, readMinutes, codeBlocks };
}

export function toggleTaskCheckbox(markdown: string, targetIndex: number): string {
  const lines = markdown.split('\n');
  let inFence = false;
  let currentIndex = 0;

  for (let i = 0; i < lines.length; i++) {
    if (/^\s*```/.test(lines[i])) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;

    const taskMatch = /^(\s*(?:[-*+]|\d+\.)\s+\[)([ xX])(\]\s+.*)$/.exec(lines[i]);
    if (taskMatch) {
      if (currentIndex === targetIndex) {
        const nextMark = taskMatch[2] === ' ' ? 'x' : ' ';
        lines[i] = `${taskMatch[1]}${nextMark}${taskMatch[3]}`;
        return lines.join('\n');
      }
      currentIndex++;
    }
  }

  return markdown;
}

export function formatRelativeDate(timestamp: number): string {
  const diffMs = Date.now() - timestamp;
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return 'Just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays}d ago`;

  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
  }).format(new Date(timestamp));
}

export type TokenType =
  | 'comment'
  | 'string'
  | 'keyword'
  | 'number'
  | 'function'
  | 'property'
  | 'plain';

export interface CodeToken {
  type: TokenType;
  value: string;
}

const KEYWORD_SET = new Set([
  'const',
  'let',
  'var',
  'function',
  'return',
  'if',
  'else',
  'for',
  'while',
  'switch',
  'case',
  'break',
  'continue',
  'import',
  'from',
  'export',
  'default',
  'async',
  'await',
  'try',
  'catch',
  'finally',
  'throw',
  'new',
  'class',
  'extends',
  'interface',
  'type',
  'true',
  'false',
  'null',
  'undefined',
  'def',
  'None',
  'True',
  'False',
  'with',
  'as',
  'in',
  'not',
  'and',
  'or',
  'elif',
  'pass',
  'SELECT',
  'FROM',
  'WHERE',
  'JOIN',
  'LEFT',
  'INNER',
  'ON',
  'GROUP',
  'BY',
  'ORDER',
  'LIMIT',
  'CREATE',
  'INDEX',
  'EXPLAIN',
  'ANALYZE',
  'INSERT',
  'INTO',
  'VALUES',
  'UPDATE',
  'SET',
  'DELETE',
  'declare',
  'namespace',
  'use',
  'public',
  'private',
  'protected',
  'readonly',
  'docker',
  'git',
  'npm',
  'npx',
  'uv',
  'python',
  'pip',
  'composer',
  'sudo',
  'curl',
  'grep',
  'ssh',
]);

export function tokenizeCodeLine(line: string, language: string): CodeToken[] {
  const lang = language.toLowerCase();
  const tokens: CodeToken[] = [];
  let i = 0;

  // Full-line comments for shell/yaml/python/sql/c-like
  const trimmed = line.trimStart();
  const leadingSpaces = line.slice(0, line.length - trimmed.length);

  if (
    (trimmed.startsWith('#') && !['ts', 'tsx', 'js', 'jsx', 'sql'].includes(lang)) ||
    (trimmed.startsWith('//') && ['ts', 'tsx', 'js', 'jsx', 'php', 'jsonc'].includes(lang)) ||
    (trimmed.startsWith('--') && lang === 'sql')
  ) {
    if (leadingSpaces) tokens.push({ type: 'plain', value: leadingSpaces });
    tokens.push({ type: 'comment', value: trimmed });
    return tokens;
  }

  const regex =
    /("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|\b\d+(?:\.\d+)?\b|\b[A-Za-z_][A-Za-z0-9_-]*\b(?=\s*:)|(?:\b[A-Za-z_][A-Za-z0-9_]*\b)|\/\/.*$|#.*$)/g;

  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(line)) !== null) {
    if (match.index > lastIndex) {
      tokens.push({ type: 'plain', value: line.slice(lastIndex, match.index) });
    }

    const val = match[0];
    if (val.startsWith('//') || (val.startsWith('#') && !val.startsWith('#include'))) {
      tokens.push({ type: 'comment', value: val });
    } else if (val.startsWith('"') || val.startsWith("'") || val.startsWith('`')) {
      tokens.push({ type: 'string', value: val });
    } else if (/^\d/.test(val)) {
      tokens.push({ type: 'number', value: val });
    } else if (line[match.index + val.length] === ':' && ['yaml', 'yml', 'json', 'ts', 'tsx'].includes(lang)) {
      tokens.push({ type: 'property', value: val });
    } else if (KEYWORD_SET.has(val)) {
      tokens.push({ type: 'keyword', value: val });
    } else if (line[match.index + val.length] === '(') {
      tokens.push({ type: 'function', value: val });
    } else {
      tokens.push({ type: 'plain', value: val });
    }

    lastIndex = regex.lastIndex;
    i = lastIndex;
  }

  if (i < line.length) {
    tokens.push({ type: 'plain', value: line.slice(i) });
  }

  return tokens.length > 0 ? tokens : [{ type: 'plain', value: line }];
}
