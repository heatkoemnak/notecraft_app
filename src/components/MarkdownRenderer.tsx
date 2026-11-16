import React, { useEffect, useMemo, useState } from 'react';
import ReactMarkdown, { defaultUrlTransform } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Check, Copy, ImageOff, Maximize2, X } from 'lucide-react';
import { slugifyHeading, tokenizeCodeLine, TokenType } from '../utils/markdown';
import {
  getCachedImageDataUrl,
  getImageDataUrl,
  IMAGE_REF_PREFIX,
} from '../utils/imageStore';

interface MarkdownRendererProps {
  content: string;
  onToggleCheckbox?: (checkboxIndex: number) => void;
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
  const initialCached = src?.startsWith(IMAGE_REF_PREFIX) ? getCachedImageDataUrl(src) : src ?? null;
  const [resolvedSrc, setResolvedSrc] = useState<string | null>(initialCached);
  const [loading, setLoading] = useState<boolean>(
    Boolean(src?.startsWith(IMAGE_REF_PREFIX) && !initialCached)
  );
  const [failed, setFailed] = useState<boolean>(!src);
  const [lightboxOpen, setLightboxOpen] = useState(false);

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

  useEffect(() => {
    if (!lightboxOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setLightboxOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [lightboxOpen]);

  return (
    <>
      <figure className="my-5">
        {loading ? (
          <div className="h-48 w-full rounded-xl border border-neutral-200 dark:border-white/[0.08] bg-neutral-100 dark:bg-[#19191d] animate-pulse" />
        ) : failed || !resolvedSrc ? (
          <div className="flex flex-col items-center justify-center gap-2 py-8 px-4 rounded-xl border border-neutral-200 dark:border-white/[0.08] bg-neutral-50 dark:bg-[#19191d] text-neutral-500 dark:text-neutral-400">
            <ImageOff className="w-6 h-6" />
            <span className="text-[13px]">
              {alt ? `Image unavailable: ${alt}` : 'Image unavailable'}
            </span>
          </div>
        ) : (
          <div className="group relative overflow-hidden rounded-xl border border-neutral-200 dark:border-white/[0.08] bg-neutral-50 dark:bg-[#19191d]">
            <img
              src={resolvedSrc}
              alt={alt || 'Embedded note image'}
              referrerPolicy="no-referrer"
              onError={() => setFailed(true)}
              onClick={() => setLightboxOpen(true)}
              className="w-full max-h-[520px] object-contain mx-auto cursor-zoom-in block"
            />
            <button
              type="button"
              onClick={() => setLightboxOpen(true)}
              aria-label="Expand image"
              title="Expand image"
              className="absolute top-2.5 right-2.5 p-1.5 rounded-lg bg-black/60 text-white opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
            >
              <Maximize2 className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
        {alt && !failed && (
          <figcaption className="mt-2 text-center text-[12.5px] text-neutral-500 dark:text-neutral-400">
            {alt}
          </figcaption>
        )}
      </figure>

      {lightboxOpen && resolvedSrc && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4 sm:p-8"
          onClick={() => setLightboxOpen(false)}
          role="dialog"
          aria-modal="true"
          aria-label={alt || 'Image preview'}
        >
          <button
            type="button"
            onClick={() => setLightboxOpen(false)}
            aria-label="Close image preview"
            className="absolute top-4 right-4 p-2 rounded-lg bg-white/10 hover:bg-white/20 text-white transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
          <img
            src={resolvedSrc}
            alt={alt || 'Embedded note image'}
            referrerPolicy="no-referrer"
            onClick={(e) => e.stopPropagation()}
            className="max-w-full max-h-full rounded-xl object-contain shadow-2xl"
          />
        </div>
      )}
    </>
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
  const seenHeadingIds = new Map<string, number>();
  let checkboxCounter = 0;

  const getUniqueHeadingId = (children: React.ReactNode) => {
    const raw = getNodeText(children);
    const base = slugifyHeading(raw) || 'section';
    const count = seenHeadingIds.get(base) ?? 0;
    seenHeadingIds.set(base, count + 1);
    return count === 0 ? base : `${base}-${count}`;
  };

  return (
    <div className="editor-prose-font text-[15.5px] leading-[1.82] text-neutral-800 dark:text-[#e4e4ea] break-words">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        urlTransform={(url) => {
          if (url.startsWith(IMAGE_REF_PREFIX) || url.startsWith('data:image/')) {
            return url;
          }
          return defaultUrlTransform(url);
        }}
        components={{
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
            const hasOnlyImage =
              node?.children?.length === 1 &&
              node.children[0].type === 'element' &&
              node.children[0].tagName === 'img';
            if (hasOnlyImage) {
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
          a: ({ href, children }) => (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-600 dark:text-blue-400 underline underline-offset-2 decoration-blue-600/40 dark:decoration-blue-400/40 hover:decoration-blue-600 dark:hover:decoration-blue-400 transition-colors"
            >
              {children}
            </a>
          ),
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
          table: ({ children }) => (
            <div className="my-5 overflow-x-auto rounded-xl border border-neutral-200 dark:border-white/[0.08]">
              <table className="w-full border-collapse text-left text-[14px] tabular-nums">
                {children}
              </table>
            </div>
          ),
          thead: ({ children }) => (
            <thead className="bg-neutral-100/80 dark:bg-white/[0.03] border-b border-neutral-200 dark:border-white/[0.08]">
              {children}
            </thead>
          ),
          th: ({ children }) => (
            <th className="px-4 py-2.5 text-[12.5px] font-semibold text-neutral-700 dark:text-neutral-200 whitespace-nowrap">
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className="px-4 py-2.5 text-neutral-700 dark:text-neutral-300 border-t border-neutral-200/70 dark:border-white/[0.06] align-top">
              {children}
            </td>
          ),
          pre: ({ children }) => <>{children}</>,
          code: ({ className, children }) => {
            const match = /language-([a-zA-Z0-9_-]+)/.exec(className || '');
            const text = String(children).replace(/\n$/, '');
            const isBlock = Boolean(match) || text.includes('\n');
            if (isBlock) {
              return <CodeBlock language={match?.[1] || 'text'} code={text} />;
            }
            return (
              <code className="font-mono-code text-[13px] px-1.5 py-0.5 rounded-md bg-neutral-100 dark:bg-white/[0.08] text-neutral-900 dark:text-neutral-100 border border-neutral-200/70 dark:border-white/[0.06]">
                {children}
              </code>
            );
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
