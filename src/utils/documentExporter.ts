import { NoteDocument } from '../types/notes';
import { formatRelativeDate, tokenizeCodeLine, TokenType } from './markdown';
import { DocBlock, parseMarkdownToBlocks } from './markdownBlocks';
import {
  getImageDataUrl,
  IMAGE_REF_PREFIX,
  resolveMarkdownImagesForExport,
} from './imageStore';
import { isDiagramLanguage, renderMermaidSvg } from './mermaidRenderer';
import { getTableTheme } from './tableThemes';

function slugifyTitle(title: string): string {
  return (
    (title || 'note')
      .toLowerCase()
      .replace(/[^a-z0-9\u1780-\u17FF]+/gi, '-')
      .replace(/^-|-$/g, '') || 'notecraft-document'
  );
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeXml(text: string): string {
  // Strip XML 1.0 disallowed control chars
  const clean = text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
  return clean
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

interface InlineRun {
  text: string;
  bold?: boolean;
  italic?: boolean;
  strike?: boolean;
  code?: boolean;
  linkUrl?: string;
}

function parseInlineRuns(markdown: string): InlineRun[] {
  if (!markdown) return [{ text: '' }];

  const runs: InlineRun[] = [];
  const tokenRegex =
    /`([^`\n]+)`|\[([^\]]+)\]\(([^)\s]+)\)|\*\*\*([^*\n]+?)\*\*\*|\*\*([^*\n]+?)\*\*|__([^_\n]+?)__|~~([^~\n]+?)~~|\*([^*\n]+?)\*/g;

  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = tokenRegex.exec(markdown)) !== null) {
    if (match.index > lastIndex) {
      runs.push({ text: markdown.slice(lastIndex, match.index) });
    }

    if (match[1] !== undefined) {
      runs.push({ text: match[1], code: true });
    } else if (match[2] !== undefined && match[3] !== undefined) {
      runs.push({ text: match[2], linkUrl: match[3] });
    } else if (match[4] !== undefined) {
      runs.push({ text: match[4], bold: true, italic: true });
    } else if (match[5] !== undefined) {
      runs.push({ text: match[5], bold: true });
    } else if (match[6] !== undefined) {
      runs.push({ text: match[6], bold: true });
    } else if (match[7] !== undefined) {
      runs.push({ text: match[7], strike: true });
    } else if (match[8] !== undefined) {
      runs.push({ text: match[8], italic: true });
    }

    lastIndex = tokenRegex.lastIndex;
  }

  if (lastIndex < markdown.length) {
    runs.push({ text: markdown.slice(lastIndex) });
  }

  return runs.length > 0 ? runs : [{ text: '' }];
}

async function resolveImageAsDataUrl(src: string): Promise<string | null> {
  if (!src) return null;
  if (src.startsWith(IMAGE_REF_PREFIX)) {
    return getImageDataUrl(src);
  }
  if (src.startsWith('data:image/')) {
    return src;
  }
  try {
    const resp = await fetch(src);
    if (!resp.ok) return null;
    const blob = await resp.blob();
    return await new Promise<string | null>((resolve) => {
      const reader = new FileReader();
      reader.onload = () =>
        resolve(typeof reader.result === 'string' ? reader.result : null);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

async function svgMarkupToPngDataUrl(
  svgMarkup: string
): Promise<{ dataUrl: string; width: number; height: number } | null> {
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(svgMarkup, 'image/svg+xml');
    const svgEl = doc.querySelector('svg');
    if (!svgEl) return null;

    let width = 640;
    let height = 360;

    const viewBox = svgEl.getAttribute('viewBox');
    if (viewBox) {
      const parts = viewBox.trim().split(/[\s,]+/).map(Number);
      if (parts.length === 4 && parts[2] > 0 && parts[3] > 0) {
        width = parts[2];
        height = parts[3];
      }
    } else {
      const wAttr = parseFloat(svgEl.getAttribute('width') || '');
      const hAttr = parseFloat(svgEl.getAttribute('height') || '');
      if (wAttr > 0 && hAttr > 0) {
        width = wAttr;
        height = hAttr;
      }
    }

    svgEl.setAttribute('width', String(Math.ceil(width)));
    svgEl.setAttribute('height', String(Math.ceil(height)));
    if (!svgEl.getAttribute('xmlns')) {
      svgEl.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    }

    const serialized = new XMLSerializer().serializeToString(svgEl);
    const svgUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(serialized)}`;

    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('SVG load error'));
      img.src = svgUrl;
    });

    const scale = 2;
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.scale(scale, scale);
    ctx.drawImage(img, 0, 0, width, height);

    const dataUrl = canvas.toDataURL('image/png');
    return { dataUrl, width, height };
  } catch {
    return null;
  }
}

function dataUrlToBytes(
  dataUrl: string
): { bytes: Uint8Array; mime: string; ext: string } | null {
  const match = /^data:([^;]+);base64,(.+)$/i.exec(dataUrl.trim());
  if (!match) return null;
  const mime = match[1].toLowerCase();
  const base64 = match[2];
  try {
    const bin = atob(base64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) {
      bytes[i] = bin.charCodeAt(i);
    }
    const ext = mime.includes('png')
      ? 'png'
      : mime.includes('webp')
      ? 'webp'
      : mime.includes('gif')
      ? 'gif'
      : 'jpg';
    return { bytes, mime, ext };
  } catch {
    return null;
  }
}

async function getImageDimensions(
  dataUrl: string
): Promise<{ width: number; height: number }> {
  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('Image dimension probe failed'));
      img.src = dataUrl;
    });
    if (img.naturalWidth > 0 && img.naturalHeight > 0) {
      return { width: img.naturalWidth, height: img.naturalHeight };
    }
  } catch {
    // fallback below
  }
  return { width: 640, height: 360 };
}

// ============================================================================
// 1. Markdown (.md) Export
// ============================================================================
export async function exportNoteAsMarkdown(note: NoteDocument): Promise<void> {
  const rawDoc = `# ${note.title || 'Untitled Note'}\n\n${note.content}`;
  const resolvedDoc = await resolveMarkdownImagesForExport(rawDoc);
  const blob = new Blob([resolvedDoc], { type: 'text/markdown;charset=utf-8' });
  triggerDownload(blob, `${slugifyTitle(note.title)}.md`);
}

// ============================================================================
// 2. Word (.docx) Export — Pure Browser OpenXML + Store ZIP
// ============================================================================
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i += 1) {
    crc = CRC_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

interface ZipInputEntry {
  path: string;
  data: Uint8Array;
}

function buildZipArchive(entries: ZipInputEntry[]): Uint8Array {
  const encoder = new TextEncoder();
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBytes = encoder.encode(entry.path);
    const checksum = crc32(entry.data);
    const size = entry.data.length;

    const localHeader = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(localHeader.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, 0x0800, true); // UTF-8 filename flag
    lv.setUint16(8, 0, true); // STORE method
    lv.setUint16(10, 0, true);
    lv.setUint16(12, 0x5421, true);
    lv.setUint32(14, checksum, true);
    lv.setUint32(18, size, true);
    lv.setUint32(22, size, true);
    lv.setUint16(26, nameBytes.length, true);
    lv.setUint16(28, 0, true);
    localHeader.set(nameBytes, 30);

    localParts.push(localHeader, entry.data);

    const centralHeader = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(centralHeader.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x0800, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(12, 0, true);
    cv.setUint16(14, 0x5421, true);
    cv.setUint32(16, checksum, true);
    cv.setUint32(20, size, true);
    cv.setUint32(24, size, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint16(30, 0, true);
    cv.setUint16(32, 0, true);
    cv.setUint16(34, 0, true);
    cv.setUint16(36, 0, true);
    cv.setUint32(38, 0, true);
    cv.setUint32(42, offset, true);
    centralHeader.set(nameBytes, 46);

    centralParts.push(centralHeader);
    offset += localHeader.length + size;
  }

  let centralSize = 0;
  for (const c of centralParts) centralSize += c.length;

  const endRecord = new Uint8Array(22);
  const ev = new DataView(endRecord.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(4, 0, true);
  ev.setUint16(6, 0, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);
  ev.setUint16(20, 0, true);

  const totalLength = offset + centralSize + endRecord.length;
  const output = new Uint8Array(totalLength);
  let cursor = 0;
  for (const part of localParts) {
    output.set(part, cursor);
    cursor += part.length;
  }
  for (const part of centralParts) {
    output.set(part, cursor);
    cursor += part.length;
  }
  output.set(endRecord, cursor);
  return output;
}

function renderRunsXml(runs: InlineRun[], defaultOpts?: { bold?: boolean; sizeHalfPt?: number; color?: string }): string {
  return runs
    .map((run) => {
      const parts = run.text.split('\n');
      return parts
        .map((lineText, idx) => {
          const rPrParts: string[] = [];
          if (run.bold || defaultOpts?.bold) rPrParts.push('<w:b/>');
          if (run.italic) rPrParts.push('<w:i/>');
          if (run.strike) rPrParts.push('<w:strike/>');
          if (run.code) {
            rPrParts.push(
              '<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:cs="Kantumruy Pro"/>',
              '<w:shd w:val="clear" w:color="auto" w:fill="F3F4F6"/>'
            );
          } else {
            rPrParts.push(
              '<w:rFonts w:ascii="Kantumruy Pro" w:hAnsi="Kantumruy Pro" w:cs="Kantumruy Pro"/>'
            );
          }
          if (run.linkUrl) {
            rPrParts.push('<w:color w:val="2563EB"/><w:u w:val="single"/>');
          } else if (defaultOpts?.color) {
            rPrParts.push(`<w:color w:val="${defaultOpts.color}"/>`);
          }
          if (defaultOpts?.sizeHalfPt) {
            rPrParts.push(`<w:sz w:val="${defaultOpts.sizeHalfPt}"/><w:szCs w:val="${defaultOpts.sizeHalfPt}"/>`);
          }

          const rPr = rPrParts.length ? `<w:rPr>${rPrParts.join('')}</w:rPr>` : '';
          const br = idx > 0 ? '<w:br/>' : '';
          return `<w:r>${rPr}${br}<w:t xml:space="preserve">${escapeXml(lineText)}</w:t></w:r>`;
        })
        .join('');
    })
    .join('');
}

function buildImageDrawingXml(
  relId: string,
  docPrId: number,
  widthPx: number,
  heightPx: number,
  alt: string
): string {
  const maxWidthEmu = 5669280; // ~6.2 inches
  const pxToEmu = 9525;
  let cx = Math.max(914400, Math.round(widthPx * pxToEmu));
  let cy = Math.max(457200, Math.round(heightPx * pxToEmu));
  if (cx > maxWidthEmu) {
    const ratio = maxWidthEmu / cx;
    cx = maxWidthEmu;
    cy = Math.max(300000, Math.round(cy * ratio));
  }
  const safeAlt = escapeXml(alt || 'Embedded image');
  return `<w:p><w:pPr><w:spacing w:before="120" w:after="120"/></w:pPr><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${docPrId}" name="${safeAlt}"/><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="${docPrId}" name="${safeAlt}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${relId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`;
}

export async function exportNoteAsDocx(note: NoteDocument): Promise<void> {
  const blocks = parseMarkdownToBlocks(note.content);
  const mediaEntries: Array<{
    relId: string;
    filename: string;
    mime: string;
    ext: string;
    bytes: Uint8Array;
  }> = [];
  let mediaSeq = 0;
  let docPrSeq = 0;

  const registerMedia = (dataUrl: string) => {
    const parsed = dataUrlToBytes(dataUrl);
    if (!parsed) return null;
    mediaSeq += 1;
    const relId = `rIdImg${mediaSeq}`;
    const filename = `image${mediaSeq}.${parsed.ext}`;
    mediaEntries.push({
      relId,
      filename,
      mime: parsed.mime,
      ext: parsed.ext,
      bytes: parsed.bytes,
    });
    return relId;
  };

  const bodyParts: string[] = [];

  // Title + Metadata
  bodyParts.push(
    `<w:p><w:pPr><w:spacing w:before="0" w:after="100"/></w:pPr>${renderRunsXml(
      [{ text: note.title || 'Untitled Note', bold: true }],
      { bold: true, sizeHalfPt: 44, color: '111827' }
    )}</w:p>`
  );
  bodyParts.push(
    `<w:p><w:pPr><w:spacing w:before="0" w:after="240"/></w:pPr>${renderRunsXml(
      [{ text: `Updated ${formatRelativeDate(note.updatedAt)}` }],
      { sizeHalfPt: 19, color: '6B7280' }
    )}</w:p>`
  );

  let orderedNum = 0;
  for (const block of blocks) {
    if (block.type === 'ordered-item') {
      orderedNum += 1;
    } else {
      orderedNum = 0;
    }

    switch (block.type) {
      case 'heading': {
        const sizeMap: Record<1 | 2 | 3 | 4, number> = {
          1: 36,
          2: 28,
          3: 24,
          4: 22,
        };
        bodyParts.push(
          `<w:p><w:pPr><w:spacing w:before="220" w:after="100"/></w:pPr>${renderRunsXml(
            parseInlineRuns(block.text),
            { bold: true, sizeHalfPt: sizeMap[block.level], color: '111827' }
          )}</w:p>`
        );
        break;
      }

      case 'paragraph': {
        if (!block.text.trim()) {
          bodyParts.push('<w:p/>');
        } else {
          bodyParts.push(
            `<w:p><w:pPr><w:spacing w:before="60" w:after="140" w:line="312" w:lineRule="auto"/></w:pPr>${renderRunsXml(
              parseInlineRuns(block.text),
              { sizeHalfPt: 22, color: '1F2937' }
            )}</w:p>`
          );
        }
        break;
      }

      case 'bullet-item': {
        bodyParts.push(
          `<w:p><w:pPr><w:ind w:left="420" w:hanging="220"/><w:spacing w:before="40" w:after="80"/></w:pPr>${renderRunsXml(
            [{ text: '•  ' }, ...parseInlineRuns(block.text)],
            { sizeHalfPt: 22, color: '1F2937' }
          )}</w:p>`
        );
        break;
      }

      case 'ordered-item': {
        bodyParts.push(
          `<w:p><w:pPr><w:ind w:left="420" w:hanging="260"/><w:spacing w:before="40" w:after="80"/></w:pPr>${renderRunsXml(
            [{ text: `${orderedNum}.  ` }, ...parseInlineRuns(block.text)],
            { sizeHalfPt: 22, color: '1F2937' }
          )}</w:p>`
        );
        break;
      }

      case 'task-item': {
        const mark = block.checked ? '☑  ' : '☐  ';
        bodyParts.push(
          `<w:p><w:pPr><w:ind w:left="360" w:hanging="240"/><w:spacing w:before="40" w:after="80"/></w:pPr>${renderRunsXml(
            [{ text: mark }, ...parseInlineRuns(block.text)],
            { sizeHalfPt: 22, color: block.checked ? '6B7280' : '1F2937' }
          )}</w:p>`
        );
        break;
      }

      case 'blockquote': {
        bodyParts.push(
          `<w:p><w:pPr><w:ind w:left="360" w:right="180"/><w:shd w:val="clear" w:color="auto" w:fill="F4F4F5"/><w:spacing w:before="120" w:after="140"/></w:pPr>${renderRunsXml(
            parseInlineRuns(block.text),
            { sizeHalfPt: 21, color: '374151' }
          )}</w:p>`
        );
        break;
      }

      case 'code': {
        if (isDiagramLanguage(block.language)) {
          try {
            const { svg } = await renderMermaidSvg(block.code, false, {
              htmlLabels: false,
            });
            const raster = await svgMarkupToPngDataUrl(svg);
            if (raster) {
              const relId = registerMedia(raster.dataUrl);
              if (relId) {
                docPrSeq += 1;
                bodyParts.push(
                  buildImageDrawingXml(
                    relId,
                    docPrSeq,
                    raster.width,
                    raster.height,
                    'Diagram'
                  )
                );
                break;
              }
            }
          } catch {
            // Fallback to source code block below
          }
        }

        const codeLines = block.code.split('\n');
        const codeRuns = codeLines
          .map((line, i) => {
            const br = i > 0 ? '<w:br/>' : '';
            return `<w:r><w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:cs="Kantumruy Pro"/><w:sz w:val="19"/><w:szCs w:val="19"/><w:color w:val="111827"/></w:rPr>${br}<w:t xml:space="preserve">${escapeXml(
              line || ' '
            )}</w:t></w:r>`;
          })
          .join('');
        bodyParts.push(
          `<w:p><w:pPr><w:ind w:left="160" w:right="160"/><w:shd w:val="clear" w:color="auto" w:fill="F3F4F6"/><w:spacing w:before="120" w:after="140"/></w:pPr>${codeRuns}</w:p>`
        );
        break;
      }

      case 'table': {
        const theme = getTableTheme(block.theme);
        const colCount = Math.max(1, block.headers.length);
        const totalTwips = 9000;
        const widthsTwips =
          block.colWidths && block.colWidths.length === colCount
            ? (() => {
                const sumPx = block.colWidths.reduce((s, w) => s + w, 0) || 1;
                return block.colWidths.map((w) =>
                  Math.max(800, Math.round((w / sumPx) * totalTwips))
                );
              })()
            : Array.from({ length: colCount }, () => Math.round(totalTwips / colCount));

        const gridCols = widthsTwips.map((w) => `<w:gridCol w:w="${w}"/>`).join('');

        const renderCell = (
          text: string,
          widthTwips: number,
          isHeader: boolean,
          rowIndex: number
        ) => {
          const fillHex = isHeader
            ? theme.docx.headerFill
            : rowIndex % 2 === 1 && theme.docx.stripeFill
            ? theme.docx.stripeFill
            : '';
          const shd =
            fillHex && fillHex !== 'FFFFFF'
              ? `<w:shd w:val="clear" w:color="auto" w:fill="${fillHex}"/>`
              : '';
          return `<w:tc><w:tcPr><w:tcW w:w="${widthTwips}" w:type="dxa"/>${shd}</w:tcPr><w:p><w:pPr><w:spacing w:before="40" w:after="40"/></w:pPr>${renderRunsXml(
            parseInlineRuns(text),
            {
              bold: isHeader,
              sizeHalfPt: 20,
              color: isHeader ? theme.docx.headerTextColor : '1F2937',
            }
          )}</w:p></w:tc>`;
        };

        const headerRowXml = `<w:tr>${block.headers
          .map((h, idx) => renderCell(h, widthsTwips[idx], true, 0))
          .join('')}</w:tr>`;
        const bodyRowsXml = block.rows
          .map(
            (row, rowIdx) =>
              `<w:tr>${block.headers
                .map((_, idx) => renderCell(row[idx] || '', widthsTwips[idx], false, rowIdx))
                .join('')}</w:tr>`
          )
          .join('');

        const outerBorderXml =
          theme.id === 'minimal'
            ? '<w:top w:val="none"/><w:left w:val="none"/><w:bottom w:val="single" w:sz="4" w:space="0" w:color="D1D5DB"/><w:right w:val="none"/>'
            : `<w:top w:val="single" w:sz="4" w:space="0" w:color="${theme.docx.outerBorderColor}"/><w:left w:val="single" w:sz="4" w:space="0" w:color="${theme.docx.outerBorderColor}"/><w:bottom w:val="single" w:sz="4" w:space="0" w:color="${theme.docx.outerBorderColor}"/><w:right w:val="single" w:sz="4" w:space="0" w:color="${theme.docx.outerBorderColor}"/>`;
        const insideVXml = theme.docx.insideVColor
          ? `<w:insideV w:val="single" w:sz="4" w:space="0" w:color="${theme.docx.insideVColor}"/>`
          : '<w:insideV w:val="none"/>';

        bodyParts.push(
          `<w:tbl><w:tblPr><w:tblW w:w="${totalTwips}" w:type="dxa"/><w:tblBorders>${outerBorderXml}<w:insideH w:val="single" w:sz="4" w:space="0" w:color="${theme.docx.insideHColor}"/>${insideVXml}</w:tblBorders><w:tblCellMar><w:top w:w="90" w:type="dxa"/><w:left w:w="130" w:type="dxa"/><w:bottom w:w="90" w:type="dxa"/><w:right w:w="130" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid>${gridCols}</w:tblGrid>${headerRowXml}${bodyRowsXml}</w:tbl>`
        );
        bodyParts.push('<w:p><w:pPr><w:spacing w:before="40" w:after="80"/></w:pPr></w:p>');
        break;
      }

      case 'image': {
        const dataUrl = await resolveImageAsDataUrl(block.src);
        if (dataUrl) {
          const relId = registerMedia(dataUrl);
          if (relId) {
            const dims = await getImageDimensions(dataUrl);
            docPrSeq += 1;
            bodyParts.push(
              buildImageDrawingXml(relId, docPrSeq, dims.width, dims.height, block.alt)
            );
            if (block.alt) {
              bodyParts.push(
                `<w:p><w:pPr><w:jc w:val="center"/><w:spacing w:before="20" w:after="120"/></w:pPr>${renderRunsXml(
                  [{ text: block.alt, italic: true }],
                  { sizeHalfPt: 18, color: '6B7280' }
                )}</w:p>`
              );
            }
            break;
          }
        }
        bodyParts.push(
          `<w:p>${renderRunsXml([{ text: `[Image: ${block.alt || block.src}]` }], {
            sizeHalfPt: 20,
            color: '6B7280',
          })}</w:p>`
        );
        break;
      }

      case 'file': {
        bodyParts.push(
          `<w:p><w:pPr><w:shd w:val="clear" w:color="auto" w:fill="F3F4F6"/><w:spacing w:before="80" w:after="100"/></w:pPr>${renderRunsXml(
            [{ text: `Attachment: ${block.label}` }],
            { bold: true, sizeHalfPt: 20, color: '1F2937' }
          )}</w:p>`
        );
        break;
      }

      case 'hr': {
        bodyParts.push(
          '<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="D1D5DB"/></w:pBdr><w:spacing w:before="140" w:after="140"/></w:pPr></w:p>'
        );
        break;
      }
    }
  }

  const uniqueExtensions = Array.from(new Set(mediaEntries.map((m) => m.ext)));
  const extDefaults = uniqueExtensions
    .map((ext) => {
      const mime =
        ext === 'png'
          ? 'image/png'
          : ext === 'gif'
          ? 'image/gif'
          : ext === 'webp'
          ? 'image/webp'
          : 'image/jpeg';
      return `<Default Extension="${ext}" ContentType="${mime}"/>`;
    })
    .join('');

  const contentTypesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  ${extDefaults}
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;

  const rootRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

  const docRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  ${mediaEntries
    .map(
      (m) =>
        `<Relationship Id="${m.relId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${m.filename}"/>`
    )
    .join('\n  ')}
</Relationships>`;

  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing">
  <w:body>
    ${bodyParts.join('\n    ')}
    <w:sectPr>
      <w:pgSz w:w="12240" w:h="15840"/>
      <w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/>
    </w:sectPr>
  </w:body>
</w:document>`;

  const enc = new TextEncoder();
  const entries: ZipInputEntry[] = [
    { path: '[Content_Types].xml', data: enc.encode(contentTypesXml) },
    { path: '_rels/.rels', data: enc.encode(rootRelsXml) },
    { path: 'word/_rels/document.xml.rels', data: enc.encode(docRelsXml) },
    { path: 'word/document.xml', data: enc.encode(documentXml) },
    ...mediaEntries.map((m) => ({
      path: `word/media/${m.filename}`,
      data: m.bytes,
    })),
  ];

  const zipBytes = buildZipArchive(entries);
  const blob = new Blob([new Uint8Array(zipBytes)], {
    type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  });
  triggerDownload(blob, `${slugifyTitle(note.title)}.docx`);
}

// ============================================================================
// 3. Print-Ready Vector PDF Export (hidden same-origin iframe -> print dialog)
// ============================================================================
const PRINT_TOKEN_COLORS: Record<TokenType, string> = {
  comment: '#6b7280;font-style:italic',
  string: '#047857',
  keyword: '#1d4ed8;font-weight:500',
  number: '#b45309',
  function: '#4338ca',
  property: '#0e7490',
  plain: '#1f2937',
};

function runsToHtml(runs: InlineRun[]): string {
  return runs
    .map((run) => {
      let html = escapeHtml(run.text).replace(/\n/g, '<br/>');
      if (run.code) {
        return `<code>${html}</code>`;
      }
      if (run.strike) html = `<del>${html}</del>`;
      if (run.italic) html = `<em>${html}</em>`;
      if (run.bold) html = `<strong>${html}</strong>`;
      if (run.linkUrl) {
        const safeHref = /^(https?:|mailto:|\/|#)/i.test(run.linkUrl.trim())
          ? escapeHtml(run.linkUrl.trim())
          : '#';
        html = `<a href="${safeHref}">${html}</a>`;
      }
      return html;
    })
    .join('');
}

async function renderBlockToPrintHtml(
  block: DocBlock,
  orderedCounter: number
): Promise<string> {
  switch (block.type) {
    case 'heading': {
      const tag = `h${block.level}`;
      return `<${tag}>${runsToHtml(parseInlineRuns(block.text))}</${tag}>`;
    }
    case 'paragraph': {
      if (!block.text.trim()) return '';
      return `<p>${runsToHtml(parseInlineRuns(block.text))}</p>`;
    }
    case 'blockquote':
      return `<blockquote>${runsToHtml(parseInlineRuns(block.text))}</blockquote>`;
    case 'task-item':
      return `<div class="list-row task-row"><span class="marker">${
        block.checked ? '&#9745;' : '&#9744;'
      }</span><span class="${block.checked ? 'checked' : ''}">${runsToHtml(
        parseInlineRuns(block.text)
      )}</span></div>`;
    case 'bullet-item':
      return `<div class="list-row"><span class="marker">&bull;</span><span>${runsToHtml(
        parseInlineRuns(block.text)
      )}</span></div>`;
    case 'ordered-item':
      return `<div class="list-row"><span class="marker num">${orderedCounter}.</span><span>${runsToHtml(
        parseInlineRuns(block.text)
      )}</span></div>`;
    case 'code': {
      if (isDiagramLanguage(block.language)) {
        try {
          const { svg } = await renderMermaidSvg(block.code, false);
          return `<div class="diagram-box">${svg}</div>`;
        } catch {
          // Fall through to code box if diagram has syntax error
        }
      }
      const linesHtml = block.code
        .split('\n')
        .map((line) => {
          const tokens = tokenizeCodeLine(line, block.language || 'text');
          const spans = tokens
            .map(
              (tok) =>
                `<span style="color:${PRINT_TOKEN_COLORS[tok.type]}">${escapeHtml(
                  tok.value
                )}</span>`
            )
            .join('');
          return `<div>${spans || '&nbsp;'}</div>`;
        })
        .join('');
      return `<div class="code-box"><div class="code-lang">${escapeHtml(
        block.language || 'text'
      )}</div><pre><code>${linesHtml}</code></pre></div>`;
    }
    case 'table': {
      const theme = getTableTheme(block.theme);
      const colCount = Math.max(1, block.headers.length);
      const hasWidths = block.colWidths && block.colWidths.length === colCount;
      const totalPx = hasWidths
        ? block.colWidths!.reduce((s, w) => s + w, 0) || 1
        : 0;
      const colgroup = hasWidths
        ? `<colgroup>${block.colWidths!
            .map((w) => `<col style="width:${((w / totalPx) * 100).toFixed(2)}%"/>`)
            .join('')}</colgroup>`
        : '';
      const thStyle = `background:${theme.pdf.headerBg};color:${theme.pdf.headerColor};border-bottom:${theme.pdf.headerBottomBorder};`;
      const headersHtml = block.headers
        .map(
          (h, idx) =>
            `<th style="${thStyle}${
              idx > 0 ? `border-left:${theme.pdf.verticalBorder};` : ''
            }">${runsToHtml(parseInlineRuns(h))}</th>`
        )
        .join('');
      const rowsHtml = block.rows
        .map((row, rowIdx) => {
          const rowBg = rowIdx % 2 === 1 ? theme.pdf.stripeBg : 'transparent';
          return `<tr style="background:${rowBg};">${block.headers
            .map(
              (_, idx) =>
                `<td style="border-top:${theme.pdf.rowTopBorder};${
                  idx > 0 ? `border-left:${theme.pdf.verticalBorder};` : ''
                }">${runsToHtml(parseInlineRuns(row[idx] || ''))}</td>`
            )
            .join('')}</tr>`;
        })
        .join('');
      const wrapStyle =
        theme.id === 'minimal'
          ? 'border:0;border-radius:0;'
          : `border:${theme.pdf.wrapperBorder};`;
      return `<div class="table-wrap" style="${wrapStyle}"><table class="${
        hasWidths ? 'fixed' : ''
      }">${colgroup}<thead><tr>${headersHtml}</tr></thead><tbody>${rowsHtml}</tbody></table></div>`;
    }
    case 'image': {
      const dataUrl = await resolveImageAsDataUrl(block.src);
      if (!dataUrl) {
        return `<p class="muted">[Image: ${escapeHtml(block.alt || block.src)}]</p>`;
      }
      const caption = block.alt
        ? `<figcaption>${escapeHtml(block.alt)}</figcaption>`
        : '';
      return `<figure><img src="${escapeHtml(dataUrl)}" alt="${escapeHtml(
        block.alt || 'Note image'
      )}"/>${caption}</figure>`;
    }
    case 'file':
      return `<div class="file-box">Attachment: ${escapeHtml(block.label)}</div>`;
    case 'hr':
      return '<hr/>';
  }
}

export type PdfSlotPlacement = 'header' | 'footer' | 'hidden';

export interface PdfExportOptions {
  showHeader: boolean;
  showFooter: boolean;
  titlePlacement: PdfSlotPlacement;
  pageNumberPlacement: PdfSlotPlacement;
  datePlacement: PdfSlotPlacement;
  timePlacement: PdfSlotPlacement;
}

export const DEFAULT_PDF_EXPORT_OPTIONS: PdfExportOptions = {
  showHeader: true,
  showFooter: true,
  titlePlacement: 'header',
  datePlacement: 'header',
  timePlacement: 'hidden',
  pageNumberPlacement: 'footer',
};

export interface PdfRegionSlots {
  left: string;
  center: string;
  right: string;
  hasContent: boolean;
}

function escapeCssContent(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/[\r\n]+/g, ' ')
    .trim();
}

export function formatPdfTimestampParts(now: Date = new Date()): {
  dateStr: string;
  timeStr: string;
} {
  return {
    dateStr: now.toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    }),
    timeStr: now.toLocaleTimeString(undefined, {
      hour: '2-digit',
      minute: '2-digit',
    }),
  };
}

export function getPdfRegionPreviewSlots(
  region: 'header' | 'footer',
  noteTitle: string,
  options: PdfExportOptions,
  now: Date = new Date()
): PdfRegionSlots {
  const regionEnabled =
    region === 'header' ? options.showHeader : options.showFooter;
  if (!regionEnabled) {
    return { left: '', center: '', right: '', hasContent: false };
  }

  const hasTitle = options.titlePlacement === region;
  const hasPage = options.pageNumberPlacement === region;
  const hasDate = options.datePlacement === region;
  const hasTime = options.timePlacement === region;

  const { dateStr, timeStr } = formatPdfTimestampParts(now);
  const dateTimeText =
    hasDate && hasTime
      ? `${dateStr} · ${timeStr}`
      : hasDate
      ? dateStr
      : hasTime
      ? timeStr
      : '';
  const pageText = hasPage ? 'Page 1 of 3' : '';
  const cleanTitle = (noteTitle || 'Untitled Note').trim();

  let left = '';
  let center = '';
  let right = '';

  if (hasTitle) {
    left = cleanTitle;
    if (dateTimeText && pageText) {
      center = dateTimeText;
      right = pageText;
    } else if (dateTimeText) {
      right = dateTimeText;
    } else if (pageText) {
      right = pageText;
    }
  } else if (dateTimeText && pageText) {
    left = dateTimeText;
    right = pageText;
  } else if (dateTimeText) {
    right = dateTimeText;
  } else if (pageText) {
    right = pageText;
  }

  return {
    left,
    center,
    right,
    hasContent: Boolean(left || center || right),
  };
}

function buildMarginBoxCss(
  region: 'header' | 'footer',
  noteTitle: string,
  options: PdfExportOptions,
  now: Date
): { css: string; hasContent: boolean } {
  const regionEnabled =
    region === 'header' ? options.showHeader : options.showFooter;
  const hasTitle = regionEnabled && options.titlePlacement === region;
  const hasPage = regionEnabled && options.pageNumberPlacement === region;
  const hasDate = regionEnabled && options.datePlacement === region;
  const hasTime = regionEnabled && options.timePlacement === region;

  const { dateStr, timeStr } = formatPdfTimestampParts(now);
  const dateTimeText =
    hasDate && hasTime
      ? `${dateStr} · ${timeStr}`
      : hasDate
      ? dateStr
      : hasTime
      ? timeStr
      : '';

  const titleExpr = hasTitle ? `"${escapeCssContent(noteTitle || 'Untitled Note')}"` : '';
  const dateTimeExpr = dateTimeText ? `"${escapeCssContent(dateTimeText)}"` : '';
  const pageExpr = hasPage ? '"Page " counter(page) " of " counter(pages)' : '';

  let leftExpr = '""';
  let centerExpr = '""';
  let rightExpr = '""';

  if (titleExpr) {
    leftExpr = titleExpr;
    if (dateTimeExpr && pageExpr) {
      centerExpr = dateTimeExpr;
      rightExpr = pageExpr;
    } else if (dateTimeExpr) {
      rightExpr = dateTimeExpr;
    } else if (pageExpr) {
      rightExpr = pageExpr;
    }
  } else if (dateTimeExpr && pageExpr) {
    leftExpr = dateTimeExpr;
    rightExpr = pageExpr;
  } else if (dateTimeExpr) {
    rightExpr = dateTimeExpr;
  } else if (pageExpr) {
    rightExpr = pageExpr;
  }

  const hasContent = Boolean(titleExpr || dateTimeExpr || pageExpr);
  const prefix = region === 'header' ? 'top' : 'bottom';
  const alignRule =
    region === 'header'
      ? 'vertical-align: bottom; padding-bottom: 4.5mm;'
      : 'vertical-align: top; padding-top: 4.5mm;';

  const sharedStyle = `
      font-family: 'Kantumruy Pro', 'Noto Sans Khmer', 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, sans-serif;
      font-size: 8.5pt;
      font-weight: 400;
      color: #6b7280;
      white-space: nowrap;
      ${alignRule}`;

  const css = `
      @${prefix}-left {
        content: ${leftExpr};
        ${leftExpr !== '""' ? sharedStyle : ''}
      }
      @${prefix}-center {
        content: ${centerExpr};
        ${centerExpr !== '""' ? sharedStyle : ''}
      }
      @${prefix}-right {
        content: ${rightExpr};
        ${rightExpr !== '""' ? sharedStyle : ''}
      }`;

  return { css, hasContent };
}

export async function exportNoteAsPdf(
  note: NoteDocument,
  customOptions?: Partial<PdfExportOptions>
): Promise<void> {
  const options: PdfExportOptions = {
    ...DEFAULT_PDF_EXPORT_OPTIONS,
    ...customOptions,
  };
  const now = new Date();

  const blocks = parseMarkdownToBlocks(note.content);
  const renderedParts: string[] = [];
  let orderedCounter = 0;

  for (const block of blocks) {
    if (block.type === 'ordered-item') {
      orderedCounter += 1;
    } else {
      orderedCounter = 0;
    }
    const html = await renderBlockToPrintHtml(block, orderedCounter);
    if (html) renderedParts.push(html);
  }

  const rawTitle = note.title || 'Untitled Note';
  const title = escapeHtml(rawTitle);
  const updatedText = escapeHtml(`Updated ${formatRelativeDate(note.updatedAt)}`);

  const headerMargin = buildMarginBoxCss('header', rawTitle, options, now);
  const footerMargin = buildMarginBoxCss('footer', rawTitle, options, now);
  const topMarginMm = headerMargin.hasContent ? 21 : 15;
  const bottomMarginMm = footerMargin.hasContent ? 21 : 15;

  const htmlDoc = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>${title}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500&family=Kantumruy+Pro:wght@400;500;600;700&family=Noto+Sans+Khmer:wght@400;500;600;700&family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap" rel="stylesheet" />
  <style>
    @page {
      size: auto;
      margin: ${topMarginMm}mm 16mm ${bottomMarginMm}mm 16mm;${headerMargin.css}${footerMargin.css}
    }
    * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    body {
      margin: 0;
      padding: 0;
      color: #111827;
      background: #ffffff;
      font-family: 'Kantumruy Pro', 'Noto Sans Khmer', 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, sans-serif;
      font-size: 13.5px;
      line-height: 1.78;
    }
    .doc-title {
      font-size: 26px;
      font-weight: 700;
      line-height: 1.4;
      margin: 0 0 6px 0;
      color: #030712;
    }
    .doc-meta {
      font-size: 12px;
      color: #6b7280;
      margin: 0 0 22px 0;
      padding-bottom: 12px;
      border-bottom: 1px solid #e5e7eb;
    }
    h1 { font-size: 22px; font-weight: 700; margin: 24px 0 10px; line-height: 1.42; page-break-after: avoid; }
    h2 { font-size: 18px; font-weight: 600; margin: 22px 0 8px; padding-bottom: 4px; border-bottom: 1px solid #e5e7eb; line-height: 1.45; page-break-after: avoid; }
    h3 { font-size: 15.5px; font-weight: 600; margin: 18px 0 6px; line-height: 1.5; page-break-after: avoid; }
    h4 { font-size: 14px; font-weight: 600; margin: 14px 0 6px; line-height: 1.5; page-break-after: avoid; }
    p { margin: 10px 0; }
    code {
      font-family: 'JetBrains Mono', 'Kantumruy Pro', monospace;
      font-size: 12px;
      background: #f3f4f6;
      border: 1px solid #e5e7eb;
      border-radius: 4px;
      padding: 1px 5px;
    }
    a { color: #2563eb; text-decoration: underline; }
    blockquote {
      margin: 14px 0;
      padding: 10px 14px;
      border: 1px solid #e5e7eb;
      border-radius: 8px;
      background: #f9fafb;
      color: #374151;
    }
    .list-row { display: flex; gap: 8px; align-items: flex-start; margin: 5px 0 5px 8px; }
    .list-row .marker { color: #6b7280; min-width: 16px; flex-shrink: 0; }
    .list-row .marker.num { font-variant-numeric: tabular-nums; }
    .list-row .checked { text-decoration: line-through; color: #9ca3af; }
    .code-box {
      margin: 14px 0;
      border: 1px solid #e5e7eb;
      border-radius: 8px;
      background: #f9fafb;
      overflow: hidden;
      page-break-inside: avoid;
    }
    .code-lang {
      font-family: 'JetBrains Mono', monospace;
      font-size: 11px;
      color: #6b7280;
      padding: 6px 12px;
      border-bottom: 1px solid #e5e7eb;
      background: #f3f4f6;
    }
    .code-box pre {
      margin: 0;
      padding: 12px;
      font-family: 'JetBrains Mono', 'Kantumruy Pro', monospace;
      font-size: 12px;
      line-height: 1.65;
      white-space: pre-wrap;
      word-break: break-word;
    }
    .code-box code { background: transparent; border: 0; padding: 0; font-size: inherit; }
    .diagram-box {
      margin: 16px 0;
      padding: 14px;
      border: 1px solid #e5e7eb;
      border-radius: 8px;
      background: #fafafa;
      display: flex;
      justify-content: center;
      page-break-inside: avoid;
    }
    .diagram-box svg { max-width: 100%; height: auto; }
    .table-wrap {
      margin: 14px 0;
      border: 1px solid #e5e7eb;
      border-radius: 8px;
      overflow: hidden;
      page-break-inside: avoid;
    }
    table { width: 100%; border-collapse: collapse; font-size: 12.5px; text-align: left; }
    table.fixed { table-layout: fixed; }
    th {
      background: #f3f4f6;
      font-weight: 600;
      padding: 8px 12px;
      border-bottom: 1px solid #e5e7eb;
    }
    td {
      padding: 8px 12px;
      border-top: 1px solid #f3f4f6;
      vertical-align: top;
      word-break: break-word;
    }
    th + th, td + td { border-left: 1px solid #e5e7eb; }
    figure { margin: 16px 0; text-align: center; page-break-inside: avoid; }
    figure img { max-width: 100%; max-height: 440px; border-radius: 8px; border: 1px solid #e5e7eb; }
    figcaption { margin-top: 6px; font-size: 11.5px; color: #6b7280; }
    .file-box {
      margin: 12px 0;
      padding: 10px 14px;
      border: 1px solid #e5e7eb;
      border-radius: 8px;
      background: #f9fafb;
      font-size: 12.5px;
      font-weight: 500;
    }
    hr { border: 0; border-top: 1px solid #e5e7eb; margin: 20px 0; }
    .muted { color: #6b7280; font-size: 12.5px; }
  </style>
</head>
<body>
  <h1 class="doc-title">${title}</h1>
  <div class="doc-meta">${updatedText}</div>
  ${renderedParts.join('\n  ')}
</body>
</html>`;

  const iframe = document.createElement('iframe');
  iframe.setAttribute('aria-hidden', 'true');
  iframe.style.position = 'fixed';
  iframe.style.right = '0';
  iframe.style.bottom = '0';
  iframe.style.width = '0';
  iframe.style.height = '0';
  iframe.style.border = '0';
  iframe.style.opacity = '0';
  iframe.style.pointerEvents = 'none';

  document.body.appendChild(iframe);

  const cleanup = () => {
    window.setTimeout(() => {
      iframe.remove();
    }, 500);
  };

  try {
    const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
    if (!iframeDoc || !iframe.contentWindow) {
      cleanup();
      throw new Error('Print frame unavailable');
    }

    iframeDoc.open();
    iframeDoc.write(htmlDoc);
    iframeDoc.close();

    // Wait briefly for fonts + embedded images to settle
    await Promise.race([
      (async () => {
        if (iframeDoc.fonts?.ready) {
          await iframeDoc.fonts.ready;
        }
        const imgs = Array.from(iframeDoc.images || []);
        await Promise.all(
          imgs.map((img) =>
            img.complete
              ? Promise.resolve()
              : new Promise<void>((resolve) => {
                  img.onload = () => resolve();
                  img.onerror = () => resolve();
                })
          )
        );
      })(),
      new Promise<void>((resolve) => window.setTimeout(resolve, 1800)),
    ]);

    const win = iframe.contentWindow;
    win.addEventListener('afterprint', cleanup, { once: true });
    win.focus();
    win.print();
    window.setTimeout(cleanup, 60000);
  } catch (err) {
    cleanup();
    throw err;
  }
}
