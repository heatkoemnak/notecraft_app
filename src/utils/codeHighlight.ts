import Prism from 'prismjs';
import 'prismjs/components/prism-c';
import 'prismjs/components/prism-cpp';
import 'prismjs/components/prism-jsx';
import 'prismjs/components/prism-typescript';
import 'prismjs/components/prism-tsx';
import 'prismjs/components/prism-json';
import 'prismjs/components/prism-bash';
import 'prismjs/components/prism-python';
import 'prismjs/components/prism-yaml';
import 'prismjs/components/prism-toml';
import 'prismjs/components/prism-sql';
import 'prismjs/components/prism-scss';
import 'prismjs/components/prism-markdown';
import 'prismjs/components/prism-docker';
import 'prismjs/components/prism-nginx';
import 'prismjs/components/prism-ini';
import 'prismjs/components/prism-go';
import 'prismjs/components/prism-rust';
import 'prismjs/components/prism-diff';

const MAX_HIGHLIGHT_CHARS = 250_000;

export function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export function resolvePrismLanguage(filename: string): string {
  const lower = filename.toLowerCase();
  if (lower === 'dockerfile' || lower.startsWith('dockerfile.')) return 'docker';
  if (lower === 'nginx.conf' || lower.endsWith('.nginx')) return 'nginx';
  if (lower === '.env' || lower.startsWith('.env.')) return 'ini';
  if (lower === 'makefile' || lower === 'gnumakefile') return 'bash';
  if (lower === '.bashrc' || lower === '.zshrc' || lower === '.profile') return 'bash';

  const ext = lower.includes('.') ? lower.split('.').pop() || '' : '';
  const map: Record<string, string> = {
    ts: 'typescript',
    mts: 'typescript',
    cts: 'typescript',
    tsx: 'tsx',
    js: 'javascript',
    mjs: 'javascript',
    cjs: 'javascript',
    jsx: 'jsx',
    json: 'json',
    jsonc: 'json',
    py: 'python',
    go: 'go',
    rs: 'rust',
    sh: 'bash',
    bash: 'bash',
    zsh: 'bash',
    yml: 'yaml',
    yaml: 'yaml',
    toml: 'toml',
    sql: 'sql',
    md: 'markdown',
    mdx: 'markdown',
    css: 'css',
    scss: 'scss',
    html: 'markup',
    htm: 'markup',
    xml: 'markup',
    svg: 'markup',
    vue: 'markup',
    svelte: 'markup',
    ini: 'ini',
    conf: 'nginx',
    cfg: 'ini',
    c: 'c',
    h: 'c',
    cpp: 'cpp',
    cc: 'cpp',
    hpp: 'cpp',
    diff: 'diff',
    patch: 'diff',
  };

  return map[ext] || 'plain';
}

export function highlightCodeToHtml(code: string, filename: string): string {
  if (!code) return '';
  if (code.length > MAX_HIGHLIGHT_CHARS) {
    const escaped = escapeHtml(code);
    return code.endsWith('\n') ? `${escaped} ` : escaped;
  }

  const lang = resolvePrismLanguage(filename);
  const grammar = lang !== 'plain' ? Prism.languages[lang] : undefined;

  let html: string;
  if (grammar) {
    html = Prism.highlight(code, grammar, lang);
  } else {
    html = escapeHtml(code);
  }

  // Ensure a trailing newline renders an extra visual line box matching <textarea>
  return code.endsWith('\n') ? `${html} ` : html;
}
