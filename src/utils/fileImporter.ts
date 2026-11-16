import { saveAttachmentFile } from './fileStore';
import { isImageFile, saveImageFile } from './imageStore';

export interface ImportedNoteResult {
  title: string;
  content: string;
  kindLabel: string;
}

const CODE_EXTENSION_MAP: Record<string, string> = {
  ts: 'typescript',
  tsx: 'tsx',
  js: 'javascript',
  jsx: 'jsx',
  mjs: 'javascript',
  cjs: 'javascript',
  py: 'python',
  go: 'go',
  rs: 'rust',
  java: 'java',
  kt: 'kotlin',
  swift: 'swift',
  c: 'c',
  h: 'c',
  cpp: 'cpp',
  hpp: 'cpp',
  cs: 'csharp',
  rb: 'ruby',
  php: 'php',
  sh: 'bash',
  bash: 'bash',
  zsh: 'bash',
  ps1: 'powershell',
  yml: 'yaml',
  yaml: 'yaml',
  toml: 'toml',
  ini: 'ini',
  conf: 'ini',
  env: 'bash',
  sql: 'sql',
  css: 'css',
  scss: 'scss',
  less: 'css',
  xml: 'xml',
  graphql: 'graphql',
  gql: 'graphql',
  tf: 'hcl',
  dockerfile: 'dockerfile',
  makefile: 'makefile',
};

function getFileExtension(name: string): string {
  const base = name.split('/').pop()?.toLowerCase() || '';
  if (base === 'dockerfile' || base === 'makefile' || base === '.gitignore') {
    return base.replace(/^\./, '');
  }
  const idx = base.lastIndexOf('.');
  return idx >= 0 ? base.slice(idx + 1) : '';
}

function cleanTitleFromFilename(filename: string): string {
  const withoutExt = filename.replace(/\.[^.]+$/, '');
  return (withoutExt || filename || 'Imported Note').trim();
}

export function describeImportFile(file: File): string {
  if (isImageFile(file)) return 'Image';
  const ext = getFileExtension(file.name);
  if (ext === 'md' || ext === 'markdown' || ext === 'mdx') return 'Markdown';
  if (ext === 'txt' || ext === 'log' || ext === 'rst' || ext === 'adoc') return 'Text note';
  if (ext === 'html' || ext === 'htm') return 'HTML document';
  if (ext === 'csv' || ext === 'tsv') return 'Table (CSV)';
  if (ext === 'json') return 'JSON';
  if (ext === 'mmd' || ext === 'mermaid') return 'Mermaid diagram';
  if (ext === 'docx') return 'Word document';
  if (ext === 'pdf') return 'PDF attachment';
  if (CODE_EXTENSION_MAP[ext]) return `${CODE_EXTENSION_MAP[ext]} code`;
  return 'File attachment';
}

function parseDelimitedText(text: string, delimiter: ',' | '\t'): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;

  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  for (let i = 0; i < normalized.length; i += 1) {
    const ch = normalized[i];
    if (inQuotes) {
      if (ch === '"') {
        if (normalized[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        cell += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      row.push(cell.trim());
      cell = '';
    } else if (ch === '\n') {
      row.push(cell.trim());
      if (row.some((c) => c.length > 0)) {
        rows.push(row);
      }
      row = [];
      cell = '';
    } else {
      cell += ch;
    }
  }

  if (cell.length > 0 || row.length > 0) {
    row.push(cell.trim());
    if (row.some((c) => c.length > 0)) {
      rows.push(row);
    }
  }

  return rows;
}

function csvToMarkdownTable(text: string, delimiter: ',' | '\t'): string {
  const rows = parseDelimitedText(text, delimiter);
  if (rows.length === 0) return '';

  const colCount = Math.max(...rows.map((r) => r.length));
  const normalizeRow = (r: string[]) =>
    Array.from({ length: colCount }, (_, idx) =>
      (r[idx] || '').replace(/\|/g, '\\|').replace(/\n+/g, ' ')
    );

  const headers = normalizeRow(rows[0]);
  const sep = Array.from({ length: colCount }, () => ':---');
  const bodyRows = rows.slice(1).map(normalizeRow);

  const lines = [
    `| ${headers.join(' | ')} |`,
    `| ${sep.join(' | ')} |`,
    ...bodyRows.map((r) => `| ${r.join(' | ')} |`),
  ];

  return `${lines.join('\n')}\n`;
}

function htmlNodeToMarkdown(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) {
    return (node.textContent || '').replace(/\s+/g, ' ');
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return '';

  const el = node as HTMLElement;
  const tag = el.tagName.toLowerCase();
  if (tag === 'script' || tag === 'style' || tag === 'noscript') return '';

  const childrenMd = () => Array.from(el.childNodes).map(htmlNodeToMarkdown).join('');

  switch (tag) {
    case 'h1':
      return `\n# ${childrenMd().trim()}\n\n`;
    case 'h2':
      return `\n## ${childrenMd().trim()}\n\n`;
    case 'h3':
      return `\n### ${childrenMd().trim()}\n\n`;
    case 'h4':
    case 'h5':
    case 'h6':
      return `\n#### ${childrenMd().trim()}\n\n`;
    case 'p': {
      const inner = childrenMd().trim();
      return inner ? `${inner}\n\n` : '';
    }
    case 'br':
      return '\n';
    case 'hr':
      return '\n---\n\n';
    case 'strong':
    case 'b': {
      const inner = childrenMd().trim();
      return inner ? `**${inner}**` : '';
    }
    case 'em':
    case 'i': {
      const inner = childrenMd().trim();
      return inner ? `*${inner}*` : '';
    }
    case 'code': {
      if (el.parentElement?.tagName.toLowerCase() === 'pre') {
        return el.textContent || '';
      }
      const text = (el.textContent || '').trim();
      return text ? `\`${text.replace(/`/g, '')}\`` : '';
    }
    case 'pre': {
      const codeEl = el.querySelector('code');
      const langClass = codeEl?.className || el.className || '';
      const langMatch = /language-([a-zA-Z0-9_-]+)/.exec(langClass);
      const lang = langMatch?.[1] || 'text';
      const raw = (codeEl?.textContent ?? el.textContent ?? '').replace(/\n$/, '');
      return `\n\`\`\`${lang}\n${raw}\n\`\`\`\n\n`;
    }
    case 'blockquote': {
      const inner = childrenMd().trim();
      if (!inner) return '';
      const quoted = inner
        .split('\n')
        .map((line) => `> ${line}`)
        .join('\n');
      return `\n${quoted}\n\n`;
    }
    case 'a': {
      const label = childrenMd().trim() || el.getAttribute('href') || '';
      const href = el.getAttribute('href') || '';
      return href ? `[${label}](${href})` : label;
    }
    case 'img': {
      const src = el.getAttribute('src') || '';
      const alt = (el.getAttribute('alt') || 'Image').replace(/[\[\]]/g, '');
      return src ? `\n![${alt}](${src})\n\n` : '';
    }
    case 'ul': {
      const items = Array.from(el.children)
        .filter((c) => c.tagName.toLowerCase() === 'li')
        .map((li) => `- ${htmlNodeToMarkdown(li).trim()}`)
        .filter((line) => line !== '-');
      return items.length ? `\n${items.join('\n')}\n\n` : '';
    }
    case 'ol': {
      const items = Array.from(el.children)
        .filter((c) => c.tagName.toLowerCase() === 'li')
        .map((li, idx) => `${idx + 1}. ${htmlNodeToMarkdown(li).trim()}`);
      return items.length ? `\n${items.join('\n')}\n\n` : '';
    }
    case 'table': {
      const trs = Array.from(el.querySelectorAll('tr'));
      if (trs.length === 0) return '';
      const matrix = trs.map((tr) =>
        Array.from(tr.children).map((cell) =>
          (cell.textContent || '').trim().replace(/\|/g, '\\|').replace(/\s+/g, ' ')
        )
      );
      const colCount = Math.max(...matrix.map((r) => r.length));
      if (colCount === 0) return '';
      const pad = (r: string[]) => Array.from({ length: colCount }, (_, i) => r[i] || '');
      const header = pad(matrix[0]);
      const sep = Array.from({ length: colCount }, () => ':---');
      const body = matrix.slice(1).map(pad);
      return `\n${[
        `| ${header.join(' | ')} |`,
        `| ${sep.join(' | ')} |`,
        ...body.map((r) => `| ${r.join(' | ')} |`),
      ].join('\n')}\n\n`;
    }
    default:
      return childrenMd();
  }
}

function htmlToMarkdown(htmlText: string, fallbackTitle: string): { title: string; content: string } {
  const parser = new DOMParser();
  const doc = parser.parseFromString(htmlText, 'text/html');
  const titleText =
    doc.querySelector('title')?.textContent?.trim() ||
    doc.querySelector('h1')?.textContent?.trim() ||
    fallbackTitle;
  const rawMd = htmlNodeToMarkdown(doc.body || doc.documentElement)
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return {
    title: titleText || fallbackTitle,
    content: rawMd ? `${rawMd}\n` : '',
  };
}

async function inflateRawBytes(compressed: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('DecompressionStream is not supported in this browser.');
  }
  const bytes = new Uint8Array(compressed);
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  const buffer = await new Response(stream).arrayBuffer();
  return new Uint8Array(buffer);
}

async function readZipEntries(buffer: ArrayBuffer): Promise<Map<string, Uint8Array>> {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  const decoder = new TextDecoder('utf-8');
  const entries = new Map<string, Uint8Array>();

  // Locate End of Central Directory (0x06054b50)
  let eocdOffset = -1;
  const minOffset = Math.max(0, bytes.length - 65557);
  for (let i = bytes.length - 22; i >= minOffset; i -= 1) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset < 0) {
    throw new Error('Invalid ZIP structure');
  }

  const totalEntries = view.getUint16(eocdOffset + 10, true);
  let cdOffset = view.getUint32(eocdOffset + 16, true);

  for (let idx = 0; idx < totalEntries; idx += 1) {
    if (cdOffset + 46 > bytes.length || view.getUint32(cdOffset, true) !== 0x02014b50) {
      break;
    }
    const compressionMethod = view.getUint16(cdOffset + 10, true);
    const compressedSize = view.getUint32(cdOffset + 20, true);
    const fileNameLen = view.getUint16(cdOffset + 28, true);
    const extraLen = view.getUint16(cdOffset + 30, true);
    const commentLen = view.getUint16(cdOffset + 32, true);
    const localHeaderOffset = view.getUint32(cdOffset + 42, true);

    const fileName = decoder.decode(bytes.subarray(cdOffset + 46, cdOffset + 46 + fileNameLen));
    cdOffset += 46 + fileNameLen + extraLen + commentLen;

    if (
      fileName === 'word/document.xml' ||
      fileName === 'word/_rels/document.xml.rels'
    ) {
      if (localHeaderOffset + 30 > bytes.length) continue;
      if (view.getUint32(localHeaderOffset, true) !== 0x04034b50) continue;
      const localNameLen = view.getUint16(localHeaderOffset + 26, true);
      const localExtraLen = view.getUint16(localHeaderOffset + 28, true);
      const dataStart = localHeaderOffset + 30 + localNameLen + localExtraLen;
      const slice = bytes.subarray(dataStart, dataStart + compressedSize);

      if (compressionMethod === 0) {
        entries.set(fileName, slice);
      } else if (compressionMethod === 8) {
        entries.set(fileName, await inflateRawBytes(slice));
      }
    }
  }

  return entries;
}

function extractDocxParagraphRuns(pEl: Element, rels: Map<string, string>): string {
  const parts: string[] = [];
  for (const child of Array.from(pEl.children)) {
    const local = child.localName;
    if (local === 'r') {
      const rPr = Array.from(child.children).find((c) => c.localName === 'rPr');
      const isBold = Boolean(rPr && Array.from(rPr.children).some((c) => c.localName === 'b'));
      const isItalic = Boolean(rPr && Array.from(rPr.children).some((c) => c.localName === 'i'));

      let runText = '';
      for (const rc of Array.from(child.children)) {
        if (rc.localName === 't') runText += rc.textContent || '';
        else if (rc.localName === 'tab') runText += '  ';
        else if (rc.localName === 'br') runText += '\n';
      }
      if (!runText) continue;
      if (isBold && isItalic) parts.push(`***${runText}***`);
      else if (isBold) parts.push(`**${runText}**`);
      else if (isItalic) parts.push(`*${runText}*`);
      else parts.push(runText);
    } else if (local === 'hyperlink') {
      const rId = child.getAttribute('r:id') || child.getAttribute('id') || '';
      const href = rels.get(rId) || '';
      const linkText = Array.from(child.children)
        .filter((c) => c.localName === 'r')
        .map((r) =>
          Array.from(r.children)
            .filter((t) => t.localName === 't')
            .map((t) => t.textContent || '')
            .join('')
        )
        .join('');
      if (linkText && href) {
        parts.push(`[${linkText}](${href})`);
      } else if (linkText) {
        parts.push(linkText);
      }
    }
  }
  return parts.join('');
}

async function parseDocxToMarkdown(
  file: File
): Promise<{ title: string; content: string } | null> {
  try {
    const buffer = await file.arrayBuffer();
    const entries = await readZipEntries(buffer);
    const docBytes = entries.get('word/document.xml');
    if (!docBytes) return null;

    const decoder = new TextDecoder('utf-8');
    const parser = new DOMParser();

    const rels = new Map<string, string>();
    const relsBytes = entries.get('word/_rels/document.xml.rels');
    if (relsBytes) {
      const relsDoc = parser.parseFromString(decoder.decode(relsBytes), 'application/xml');
      for (const rel of Array.from(relsDoc.getElementsByTagName('Relationship'))) {
        const id = rel.getAttribute('Id');
        const target = rel.getAttribute('Target');
        if (id && target && /^https?:|^mailto:/i.test(target)) {
          rels.set(id, target);
        }
      }
    }

    const xmlDoc = parser.parseFromString(decoder.decode(docBytes), 'application/xml');
    const body = Array.from(xmlDoc.documentElement.children).find(
      (el) => el.localName === 'body'
    );
    if (!body) return null;

    const chunks: string[] = [];
    let extractedTitle = cleanTitleFromFilename(file.name);
    let titleFound = false;

    for (const node of Array.from(body.children)) {
      if (node.localName === 'p') {
        const pPr = Array.from(node.children).find((c) => c.localName === 'pPr');
        const pStyleEl = pPr
          ? Array.from(pPr.children).find((c) => c.localName === 'pStyle')
          : undefined;
        const styleVal = (
          pStyleEl?.getAttribute('w:val') ||
          pStyleEl?.getAttribute('val') ||
          ''
        ).toLowerCase();
        const hasNumPr = Boolean(
          pPr && Array.from(pPr.children).some((c) => c.localName === 'numPr')
        );

        const text = extractDocxParagraphRuns(node, rels).trim();
        if (!text) continue;

        if (styleVal === 'title' || styleVal === 'heading1' || styleVal === 'heading 1') {
          if (!titleFound) {
            extractedTitle = text.replace(/^\*+|\*+$/g, '');
            titleFound = true;
          } else {
            chunks.push(`# ${text}`);
          }
        } else if (styleVal === 'heading2' || styleVal === 'heading 2') {
          chunks.push(`## ${text}`);
        } else if (styleVal === 'heading3' || styleVal === 'heading 3') {
          chunks.push(`### ${text}`);
        } else if (styleVal === 'heading4' || styleVal === 'heading 4') {
          chunks.push(`#### ${text}`);
        } else if (hasNumPr || styleVal.includes('list')) {
          chunks.push(`- ${text}`);
        } else {
          chunks.push(text);
        }
      } else if (node.localName === 'tbl') {
        const rows = Array.from(node.children).filter((c) => c.localName === 'tr');
        const matrix = rows.map((tr) =>
          Array.from(tr.children)
            .filter((c) => c.localName === 'tc')
            .map((tc) =>
              Array.from(tc.children)
                .filter((p) => p.localName === 'p')
                .map((p) => extractDocxParagraphRuns(p, rels).trim())
                .filter(Boolean)
                .join(' ')
                .replace(/\|/g, '\\|')
            )
        );
        if (matrix.length > 0) {
          const colCount = Math.max(...matrix.map((r) => r.length));
          if (colCount > 0) {
            const pad = (r: string[]) =>
              Array.from({ length: colCount }, (_, i) => r[i] || '');
            const header = pad(matrix[0]);
            const sep = Array.from({ length: colCount }, () => ':---');
            const bodyRows = matrix.slice(1).map(pad);
            chunks.push(
              [
                `| ${header.join(' | ')} |`,
                `| ${sep.join(' | ')} |`,
                ...bodyRows.map((r) => `| ${r.join(' | ')} |`),
              ].join('\n')
            );
          }
        }
      }
    }

    return {
      title: extractedTitle,
      content: chunks.length > 0 ? `${chunks.join('\n\n')}\n` : '',
    };
  } catch {
    return null;
  }
}

export async function importSingleFile(file: File): Promise<ImportedNoteResult[]> {
  const baseTitle = cleanTitleFromFilename(file.name);
  const ext = getFileExtension(file.name);

  // 1. Images -> embed directly via imageStore
  if (isImageFile(file)) {
    const saved = await saveImageFile(file);
    const safeAlt = saved.alt.replace(/[\[\]]/g, '');
    return [
      {
        title: saved.alt || baseTitle,
        content: `![${safeAlt}](${saved.refUrl})\n`,
        kindLabel: 'Image',
      },
    ];
  }

  // 2. Markdown & Plain Text
  if (
    ext === 'md' ||
    ext === 'markdown' ||
    ext === 'mdx' ||
    ext === 'txt' ||
    ext === 'log' ||
    ext === 'rst' ||
    ext === 'adoc'
  ) {
    const rawText = await file.text();
    const headingMatch = /^#\s+(.+)\r?\n+/.exec(rawText);
    const title = headingMatch ? headingMatch[1].trim() : baseTitle;
    const content = headingMatch ? rawText.slice(headingMatch[0].length) : rawText;
    return [
      {
        title,
        content: content.endsWith('\n') ? content : `${content}\n`,
        kindLabel: ext === 'txt' || ext === 'log' ? 'Text note' : 'Markdown',
      },
    ];
  }

  // 2b. Mermaid diagram files (.mmd, .mermaid)
  if (ext === 'mmd' || ext === 'mermaid') {
    const rawDiagram = (await file.text()).trimEnd();
    return [
      {
        title: baseTitle,
        content: `\`\`\`mermaid\n${rawDiagram}\n\`\`\`\n`,
        kindLabel: 'Mermaid diagram',
      },
    ];
  }

  // 3. HTML -> clean Markdown
  if (ext === 'html' || ext === 'htm') {
    const htmlText = await file.text();
    const converted = htmlToMarkdown(htmlText, baseTitle);
    return [
      {
        title: converted.title,
        content: converted.content,
        kindLabel: 'HTML document',
      },
    ];
  }

  // 4. CSV / TSV -> Markdown table
  if (ext === 'csv' || ext === 'tsv') {
    const text = await file.text();
    const tableMd = csvToMarkdownTable(text, ext === 'tsv' ? '\t' : ',');
    return [
      {
        title: baseTitle,
        content: tableMd || `\`\`\`text\n${text}\n\`\`\`\n`,
        kindLabel: 'Table (CSV)',
      },
    ];
  }

  // 5. JSON -> NoteCraft note(s) or formatted JSON code block
  if (ext === 'json') {
    const raw = await file.text();
    try {
      const parsed = JSON.parse(raw) as unknown;
      const candidateList: Array<{ title?: unknown; content?: unknown }> = [];
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          if (item && typeof item === 'object' && 'content' in item) {
            candidateList.push(item as { title?: unknown; content?: unknown });
          }
        }
      } else if (parsed && typeof parsed === 'object') {
        const obj = parsed as Record<string, unknown>;
        if (Array.isArray(obj.notes)) {
          for (const item of obj.notes) {
            if (item && typeof item === 'object' && 'content' in item) {
              candidateList.push(item as { title?: unknown; content?: unknown });
            }
          }
        } else if (typeof obj.content === 'string') {
          candidateList.push({ title: obj.title, content: obj.content });
        }
      }

      if (candidateList.length > 0) {
        return candidateList.map((entry, idx) => ({
          title:
            typeof entry.title === 'string' && entry.title.trim()
              ? entry.title.trim()
              : candidateList.length > 1
              ? `${baseTitle} (${idx + 1})`
              : baseTitle,
          content: typeof entry.content === 'string' ? entry.content : '',
          kindLabel: 'JSON Note',
        }));
      }

      const pretty = JSON.stringify(parsed, null, 2);
      return [
        {
          title: baseTitle,
          content: `\`\`\`json\n${pretty}\n\`\`\`\n`,
          kindLabel: 'JSON',
        },
      ];
    } catch {
      return [
        {
          title: baseTitle,
          content: `\`\`\`json\n${raw}\n\`\`\`\n`,
          kindLabel: 'JSON',
        },
      ];
    }
  }

  // 6. Code & Config files
  if (CODE_EXTENSION_MAP[ext]) {
    const codeText = await file.text();
    const lang = CODE_EXTENSION_MAP[ext];
    return [
      {
        title: file.name,
        content: `\`\`\`${lang}\n${codeText.replace(/\n$/, '')}\n\`\`\`\n`,
        kindLabel: `${lang} code`,
      },
    ];
  }

  // 7. Word (.docx) -> extract paragraphs, headings, lists & tables; fallback to attachment if unreadable
  if (ext === 'docx') {
    const parsedDocx = await parseDocxToMarkdown(file);
    if (parsedDocx && parsedDocx.content.trim()) {
      return [
        {
          title: parsedDocx.title,
          content: parsedDocx.content,
          kindLabel: 'Word document',
        },
      ];
    }
  }

  // 8. PDF & any other binary file -> save attachment and embed attachment card link
  const savedFile = await saveAttachmentFile(file);
  return [
    {
      title: baseTitle,
      content: `[${savedFile.label}](${savedFile.refUrl})\n`,
      kindLabel: ext === 'pdf' ? 'PDF attachment' : 'File attachment',
    },
  ];
}
