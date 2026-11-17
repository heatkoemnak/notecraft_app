import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import ReactMarkdown, { defaultUrlTransform } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Check, Copy, ImageOff, Maximize2 } from 'lucide-react';
import { slugifyHeading, tokenizeCodeLine, TokenType } from '../utils/markdown';
import {
  getCachedImageDataUrl,
  getImageDataUrl,
  IMAGE_REF_PREFIX,
} from '../utils/imageStore';
import { FILE_REF_PREFIX } from '../utils/fileStore';
import { isDiagramLanguage } from '../utils/mermaidRenderer';
import { DiagramBlock } from './DiagramBlock';
import { FileAttachmentCard } from './FileAttachmentCard';
import { ImageLightbox, LightboxImageItem } from './ImageLightbox';
import { getTableTheme, TableThemeConfig } from '../utils/tableThemes';

interface MarkdownRendererProps {
  content: string;
  onToggleCheckbox?: (checkboxIndex: number) => void;
}

const GalleryContext = createContext(false);
const LightboxTriggerContext = createContext<((src: string, alt: string) => void) | null>(null);
const TableThemeContext = createContext<TableThemeConfig>(getTableTheme('default'));
const InTheadContext = createContext(false);

interface SimpleMdastNode {
  type: string;
  value?: string;
  url?: string;
  alt?: string | null;
  children?: SimpleMdastNode[];
  data?: Record<string, unknown>;
}

function extractImageNodesFromParagraph(node: SimpleMdastNode): SimpleMdastNode[] | null {
  if (node.type !== 'paragraph' || !node.children || node.children.length === 0) {
    return null;
  }
  const images: SimpleMdastNode[] = [];
  for (const child of node.children) {
    if (child.type === 'image') {
      images.push(child);
    } else if (child.type === 'break') {
      continue;
    } else if (child.type === 'text' && !(child.value || '').trim()) {
      continue;
    } else {
      return null;
    }
  }
  return images.length > 0 ? images : null;
}

function remarkGroupImages() {
  return (tree: SimpleMdastNode) => {
    if (!tree.children || !Array.isArray(tree.children)) return;
    const nextChildren: SimpleMdastNode[] = [];
    let i = 0;

    while (i < tree.children.length) {
      const current = tree.children[i];
      const firstImages = extractImageNodesFromParagraph(current);
      if (!firstImages) {
        nextChildren.push(current);
        i += 1;
        continue;
      }

      const collectedImages: SimpleMdastNode[] = [...firstImages];
      let endIdx = i;
      while (endIdx + 1 < tree.children.length) {
        const nextImgs = extractImageNodesFromParagraph(tree.children[endIdx + 1]);
        if (!nextImgs) break;
        collectedImages.push(...nextImgs);
        endIdx += 1;
      }

      if (collectedImages.length > 1) {
        nextChildren.push({
          type: 'imageGallery',
          data: {
            hName: 'div',
            hProperties: {
              'data-image-gallery': 'true',
              'data-count': String(collectedImages.length),
            },
          },
          children: collectedImages,
        });
      } else {
        nextChildren.push(current);
      }

      i = endIdx + 1;
    }

    tree.children = nextChildren;
  };
}

function remarkTableMetadata() {
  const widthRegex = /^\s*<!--\s*table-widths:\s*([0-9,\s]+)\s*-->\s*$/;
  const themeRegex = /^\s*<!--\s*table-theme:\s*([a-zA-Z0-9_-]+)\s*-->\s*$/;

  return (tree: SimpleMdastNode) => {
    if (!tree.children || !Array.isArray(tree.children)) return;
    const nextChildren: SimpleMdastNode[] = [];
    let i = 0;

    while (i < tree.children.length) {
      const current = tree.children[i];
      if (
        current.type === 'html' &&
        typeof current.value === 'string' &&
        (widthRegex.test(current.value) || themeRegex.test(current.value))
      ) {
        let scanIdx = i;
        let colWidths: string | null = null;
        let tableTheme: string | null = null;

        while (scanIdx < tree.children.length) {
          const candidate = tree.children[scanIdx];
          if (candidate.type !== 'html' || typeof candidate.value !== 'string') break;
          const wm = widthRegex.exec(candidate.value);
          if (wm) {
            colWidths = wm[1].replace(/\s+/g, '');
            scanIdx += 1;
            continue;
          }
          const tm = themeRegex.exec(candidate.value);
          if (tm) {
            tableTheme = tm[1].trim().toLowerCase();
            scanIdx += 1;
            continue;
          }
          break;
        }

        const nextNode = tree.children[scanIdx];
        if (nextNode && nextNode.type === 'table') {
          nextNode.data = {
            ...(nextNode.data || {}),
            hProperties: {
              ...((nextNode.data?.hProperties as Record<string, unknown>) || {}),
              ...(colWidths ? { 'data-col-widths': colWidths } : {}),
              ...(tableTheme ? { 'data-table-theme': tableTheme } : {}),
            },
          };
          nextChildren.push(nextNode);
          i = scanIdx + 1;
          continue;
        }
      }

      nextChildren.push(current);
      i += 1;
    }

    tree.children = nextChildren;
  };
}

function extractDocumentImages(markdown: string): LightboxImageItem[] {
  const items: LightboxImageItem[] = [];
  const regex = /!\[([^\]]*)\]\(([^)\s]+)\)/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(markdown)) !== null) {
    items.push({ alt: match[1] || '', src: match[2].trim() });
  }
  return items;
}

const TOKEN_CLASSES: Record<TokenType, string> = {
  comment: 'text-neutral-500 dark:text-neutral-500 italic',
  string: 'text-emerald-700 dark:text-emerald-400',
  keyword: 'text-blue-700 dark:text-sky-400 font-medium',
  number: 'text-amber-700 dark:text-amber-300',
  function: 'text-indigo-700 dark:text-indigo-300',
  property: 'text-cyan-700 dark:text-cyan-300',
  plain: 'text-neutral-800 dark:text-neutral-200',
};

function CodeBlock({ language, code }: { language: string; code: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard fallback ignored if blocked
    }
  };

  const lines = useMemo(() => code.replace(/\n$/, '').split('\n'), [code]);

  return (
    <div className="my-5 overflow-hidden rounded-xl border border-neutral-200 dark:border-white/[0.08] bg-neutral-50 dark:bg-[#19191d]">
      <div className="flex items-center justify-between px-4 py-2 border-b border-neutral-200/80 dark:border-white/[0.06] bg-neutral-100/80 dark:bg-white/[0.02]">
        <span className="text-xs font-mono-code text-neutral-500 dark:text-neutral-400 select-none">
          {language || 'text'}
        </span>
        <button
          type="button"
          onClick={handleCopy}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-neutral-600 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100 transition-colors px-2 py-1 rounded-md hover:bg-neutral-200/60 dark:hover:bg-white/[0.06] whitespace-nowrap shrink-0 cursor-pointer"
          aria-label="Copy code snippet"
        >
          {copied ? (
            <>
              <Check className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
              <span className="text-emerald-700 dark:text-emerald-400">Copied</span>
            </>
          ) : (
            <>
              <Copy className="w-3.5 h-3.5" />
              <span>Copy</span>
            </>
          )}
        </button>
      </div>
      <div className="overflow-x-auto p-4 text-[13.5px] leading-[1.65] font-mono-code">
        <pre className="m-0">
          <code>
            {lines.map((line, lineIdx) => {
              const tokens = tokenizeCodeLine(line, language);
              return (
                <div key={lineIdx} className="min-h-[1.65em]">
                  {tokens.map((tok, tokIdx) => (
                    <span key={tokIdx} className={TOKEN_CLASSES[tok.type]}>
                      {tok.value}
                    </span>
                  ))}
                </div>
              );
            })}
          </code>
        </pre>
      </div>
    </div>
  );
}

function MarkdownImage({ src, alt }: { src?: string; alt?: string }) {
  const isCompact = useContext(GalleryContext);
  const openLightbox = useContext(LightboxTriggerContext);
  const initialCached = src?.startsWith(IMAGE_REF_PREFIX) ? getCachedImageDataUrl(src) : src ?? null;
  const [resolvedSrc, setResolvedSrc] = useState<string | null>(initialCached);
  const [loading, setLoading] = useState<boolean>(
    Boolean(src?.startsWith(IMAGE_REF_PREFIX) && !initialCached)
  );
  const [failed, setFailed] = useState<boolean>(!src);

  useEffect(() => {
    let active = true;
    if (!src) {
      setFailed(true);
      setLoading(false);
      return;
    }

    if (!src.startsWith(IMAGE_REF_PREFIX)) {
      setResolvedSrc(src);
      setFailed(false);
      setLoading(false);
      return;
    }

    const cached = getCachedImageDataUrl(src);
    if (cached) {
      setResolvedSrc(cached);
      setFailed(false);
      setLoading(false);
      return;
    }

    setLoading(true);
    setFailed(false);
    getImageDataUrl(src).then((dataUrl) => {
      if (!active) return;
      if (dataUrl) {
        setResolvedSrc(dataUrl);
        setFailed(false);
      } else {
        setFailed(true);
      }
      setLoading(false);
    });

    return () => {
      active = false;
    };
  }, [src]);

  const handleOpen = () => {
    if (src && openLightbox) {
      openLightbox(src, alt || '');
    }
  };

  return (
    <figure className={isCompact ? 'flex flex-col' : 'my-5'}>
      {loading ? (
        <div
          className={`w-full rounded-xl border border-neutral-200 dark:border-white/[0.08] bg-neutral-100 dark:bg-[#19191d] animate-pulse ${
            isCompact ? 'h-52' : 'h-48'
          }`}
        />
      ) : failed || !resolvedSrc ? (
        <div
          className={`flex flex-col items-center justify-center gap-2 px-4 rounded-xl border border-neutral-200 dark:border-white/[0.08] bg-neutral-50 dark:bg-[#19191d] text-neutral-500 dark:text-neutral-400 ${
            isCompact ? 'h-52' : 'py-8'
          }`}
        >
          <ImageOff className="w-6 h-6" />
          <span className="text-[13px] text-center truncate max-w-full">
            {alt ? `Image unavailable: ${alt}` : 'Image unavailable'}
          </span>
        </div>
      ) : (
        <div
          className={`group relative overflow-hidden rounded-xl border border-neutral-200 dark:border-white/[0.08] bg-neutral-50 dark:bg-[#19191d] ${
            isCompact ? 'h-52 flex items-center justify-center' : ''
          }`}
        >
          <img
            src={resolvedSrc}
            alt={alt || 'Embedded note image'}
            referrerPolicy="no-referrer"
            onError={() => setFailed(true)}
            onClick={handleOpen}
            className={
              isCompact
                ? 'max-w-full max-h-full object-contain cursor-zoom-in block'
                : 'w-full max-h-[520px] object-contain mx-auto cursor-zoom-in block'
            }
          />
          <button
            type="button"
            onClick={handleOpen}
            aria-label="Expand image"
            title="Expand image"
            className="absolute top-2.5 right-2.5 p-1.5 rounded-lg bg-black/60 text-white opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
          >
            <Maximize2 className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
      {alt && !failed && (
        <figcaption className="mt-1.5 text-center text-[12.5px] text-neutral-500 dark:text-neutral-400 truncate">
          {alt}
        </figcaption>
      )}
    </figure>
  );
}

function getNodeText(node: React.ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(getNodeText).join('');
  if (React.isValidElement<{ children?: React.ReactNode }>(node)) {
    return getNodeText(node.props.children);
  }
  return '';
}

export function MarkdownRenderer({ content, onToggleCheckbox }: MarkdownRendererProps) {
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const documentImages = useMemo(() => extractDocumentImages(content), [content]);

  const seenHeadingIds = new Map<string, number>();
  let checkboxCounter = 0;

  const getUniqueHeadingId = (children: React.ReactNode) => {
    const raw = getNodeText(children);
    const base = slugifyHeading(raw) || 'section';
    const count = seenHeadingIds.get(base) ?? 0;
    seenHeadingIds.set(base, count + 1);
    return count === 0 ? base : `${base}-${count}`;
  };

  const handleOpenLightbox = (src: string, alt: string) => {
    let idx = documentImages.findIndex((item) => item.src === src && item.alt === alt);
    if (idx < 0) {
      idx = documentImages.findIndex((item) => item.src === src);
    }
    if (idx >= 0) {
      setLightboxIndex(idx);
    }
  };

  return (
    <LightboxTriggerContext.Provider value={handleOpenLightbox}>
      <div className="editor-prose-font text-[15.5px] leading-[1.82] text-neutral-800 dark:text-[#e4e4ea] break-words">
        <ReactMarkdown
          remarkPlugins={[remarkGfm, remarkGroupImages, remarkTableMetadata]}
          urlTransform={(url) => {
            if (
              url.startsWith(IMAGE_REF_PREFIX) ||
              url.startsWith(FILE_REF_PREFIX) ||
              url.startsWith('data:image/')
            ) {
              return url;
            }
            return defaultUrlTransform(url);
          }}
          components={{
            div: (props) => {
              const record = props as Record<string, unknown>;
              if (record['data-image-gallery'] === 'true') {
                const count = Number(record['data-count'] || 2);
                const gridColsClass =
                  count === 2 || count === 4
                    ? 'grid-cols-1 sm:grid-cols-2'
                    : 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3';
                return (
                  <GalleryContext.Provider value={true}>
                    <div className={`my-5 grid gap-3.5 ${gridColsClass}`}>
                      {props.children}
                    </div>
                  </GalleryContext.Provider>
                );
              }
              return <div {...props} />;
            },
          h1: ({ children }) => {
            const id = getUniqueHeadingId(children);
            return (
              <h1
                id={id}
                className="scroll-mt-20 text-[28px] font-semibold text-neutral-950 dark:text-white mt-8 mb-4 first:mt-0 leading-[1.45]"
              >
                {children}
              </h1>
            );
          },
          h2: ({ children }) => {
            const id = getUniqueHeadingId(children);
            return (
              <h2
                id={id}
                className="scroll-mt-20 text-[21px] font-semibold text-neutral-950 dark:text-white mt-8 mb-3 first:mt-0 pb-1.5 border-b border-neutral-200/80 dark:border-white/[0.07] leading-[1.45]"
              >
                {children}
              </h2>
            );
          },
          h3: ({ children }) => {
            const id = getUniqueHeadingId(children);
            return (
              <h3
                id={id}
                className="scroll-mt-20 text-[17px] font-semibold text-neutral-900 dark:text-neutral-100 mt-6 mb-2.5 leading-[1.5]"
              >
                {children}
              </h3>
            );
          },
          h4: ({ children }) => (
            <h4 className="text-[15px] font-semibold text-neutral-900 dark:text-neutral-100 mt-5 mb-2 leading-[1.55]">
              {children}
            </h4>
          ),
          p: ({ node, children }) => {
            const firstChild = node?.children?.[0];
            const hasOnlyImage =
              node?.children?.length === 1 &&
              firstChild?.type === 'element' &&
              firstChild.tagName === 'img';
            const hasOnlyFileLink =
              node?.children?.length === 1 &&
              firstChild?.type === 'element' &&
              firstChild.tagName === 'a' &&
              typeof firstChild.properties?.href === 'string' &&
              firstChild.properties.href.startsWith(FILE_REF_PREFIX);
            if (hasOnlyImage || hasOnlyFileLink) {
              return <>{children}</>;
            }
            return (
              <p className="my-3.5 text-neutral-800 dark:text-[#dcdce4] leading-[1.82]">{children}</p>
            );
          },
          img: ({ src, alt }) => <MarkdownImage src={src} alt={alt} />,
          strong: ({ children }) => (
            <strong className="font-semibold text-neutral-950 dark:text-white">{children}</strong>
          ),
          em: ({ children }) => <em className="italic text-neutral-700 dark:text-neutral-300">{children}</em>,
          del: ({ children }) => (
            <del className="line-through text-neutral-500 dark:text-neutral-400">{children}</del>
          ),
          a: ({ href, children }) => {
            if (href && href.startsWith(FILE_REF_PREFIX)) {
              return <FileAttachmentCard src={href} label={getNodeText(children)} />;
            }
            return (
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-600 dark:text-blue-400 underline underline-offset-2 decoration-blue-600/40 dark:decoration-blue-400/40 hover:decoration-blue-600 dark:hover:decoration-blue-400 transition-colors"
              >
                {children}
              </a>
            );
          },
          ul: ({ children, className }) => {
            const isTaskList = className?.includes('contains-task-list');
            return (
              <ul
                className={`my-3.5 space-y-1.5 ${
                  isTaskList ? 'list-none pl-0' : 'list-disc pl-6 marker:text-neutral-400 dark:marker:text-neutral-500'
                }`}
              >
                {children}
              </ul>
            );
          },
          ol: ({ children }) => (
            <ol className="my-3.5 list-decimal pl-6 space-y-1.5 marker:text-neutral-500 dark:marker:text-neutral-400 tabular-nums">
              {children}
            </ol>
          ),
          li: ({ children, className }) => {
            const isTask = className?.includes('task-list-item');
            return (
              <li className={isTask ? 'flex items-start gap-2.5 leading-[1.78]' : 'leading-[1.8]'}>
                {children}
              </li>
            );
          },
          input: ({ type, checked }) => {
            if (type !== 'checkbox') {
              return <input type={type} defaultChecked={checked} />;
            }
            const currentIdx = checkboxCounter++;
            return (
              <input
                type="checkbox"
                checked={Boolean(checked)}
                onChange={() => onToggleCheckbox?.(currentIdx)}
                className="mt-1.5 h-4 w-4 rounded border-neutral-300 dark:border-white/25 bg-white dark:bg-neutral-900 accent-blue-600 cursor-pointer shrink-0"
                aria-label="Toggle task item"
              />
            );
          },
          blockquote: ({ children }) => (
            <blockquote className="my-5 rounded-xl border border-neutral-200 dark:border-white/[0.09] bg-neutral-50/80 dark:bg-white/[0.03] px-4 py-3 text-[14.5px] text-neutral-700 dark:text-neutral-300 [&>p]:my-1">
              {children}
            </blockquote>
          ),
          hr: () => <hr className="my-7 border-neutral-200 dark:border-white/[0.08]" />,
          table: ({ children, ...props }) => {
            const rawWidths = (props as Record<string, unknown>)['data-col-widths'];
            const rawTheme = (props as Record<string, unknown>)['data-table-theme'];
            const theme = getTableTheme(
              typeof rawTheme === 'string' ? rawTheme : 'default'
            );
            const colWidths =
              typeof rawWidths === 'string' && rawWidths.trim()
                ? rawWidths
                    .split(',')
                    .map((n) => Math.max(72, Math.min(800, Number(n.trim()) || 140)))
                : null;
            const totalWidth = colWidths ? colWidths.reduce((sum, w) => sum + w, 0) : null;
            return (
              <TableThemeContext.Provider value={theme}>
                <div className={`my-5 overflow-x-auto ${theme.wrapperClass}`}>
                  <table
                    style={
                      totalWidth
                        ? { width: `${totalWidth}px`, minWidth: '100%' }
                        : undefined
                    }
                    className={`${
                      colWidths ? 'table-fixed' : 'w-full'
                    } border-collapse text-left text-[14px] tabular-nums ${theme.cellDividersClass}`}
                  >
                    {colWidths && (
                      <colgroup>
                        {colWidths.map((w, idx) => (
                          <col key={idx} style={{ width: `${w}px` }} />
                        ))}
                      </colgroup>
                    )}
                    {children}
                  </table>
                </div>
              </TableThemeContext.Provider>
            );
          },
          thead: ({ children }) => {
            const theme = useContext(TableThemeContext);
            return (
              <InTheadContext.Provider value={true}>
                <thead className={theme.theadClass}>{children}</thead>
              </InTheadContext.Provider>
            );
          },
          tr: ({ children }) => {
            const theme = useContext(TableThemeContext);
            const inThead = useContext(InTheadContext);
            return <tr className={inThead ? undefined : theme.trClass}>{children}</tr>;
          },
          th: ({ children }) => {
            const theme = useContext(TableThemeContext);
            return (
              <th
                className={`px-4 py-2.5 text-[12.5px] font-semibold whitespace-nowrap ${theme.thClass}`}
              >
                {children}
              </th>
            );
          },
          td: ({ children }) => {
            const theme = useContext(TableThemeContext);
            return (
              <td className={`px-4 py-2.5 align-top ${theme.tdClass}`}>
                {children}
              </td>
            );
          },
          pre: ({ children }) => <>{children}</>,
          code: ({ className, children }) => {
            const match = /language-([a-zA-Z0-9_-]+)/.exec(className || '');
            const lang = match?.[1] || '';
            const text = String(children).replace(/\n$/, '');
            if (isDiagramLanguage(lang)) {
              return <DiagramBlock language={lang} code={text} />;
            }
            const isBlock = Boolean(match) || text.includes('\n');
            if (isBlock) {
              return <CodeBlock language={lang || 'text'} code={text} />;
            }
            return (
              <code className="font-mono-code text-[13px] px-1.5 py-[1px] rounded-md bg-neutral-100 dark:bg-white/[0.09] text-neutral-900 dark:text-neutral-100 border border-neutral-200/80 dark:border-white/[0.09]">
                {children}
              </code>
            );
          },
        }}
      >
        {content}
      </ReactMarkdown>

      {lightboxIndex !== null && documentImages.length > 0 && (
        <ImageLightbox
          items={documentImages}
          initialIndex={lightboxIndex}
          onClose={() => setLightboxIndex(null)}
        />
      )}
    </div>
    </LightboxTriggerContext.Provider>
  );
}
