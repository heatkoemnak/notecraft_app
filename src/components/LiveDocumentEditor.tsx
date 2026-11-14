import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Check,
  Copy,
  ImageOff,
  Maximize2,
  Plus,
  Trash2,
  X,
} from 'lucide-react';
import { NoteUpdateMeta } from '../hooks/useNoteHistory';
import {
  getCachedImageDataUrl,
  getImageDataUrl,
  IMAGE_REF_PREFIX,
} from '../utils/imageStore';
import { slugifyHeading, tokenizeCodeLine, TokenType } from '../utils/markdown';
import {
  createBlockId,
  DocBlock,
  htmlToInlineMarkdown,
  inlineMarkdownToHtml,
  parseMarkdownToBlocks,
  serializeBlocksToMarkdown,
} from '../utils/markdownBlocks';

export interface LiveDocumentEditorHandle {
  applyInlineFormat: (format: 'bold' | 'italic' | 'code') => void;
  toggleOrInsertBlock: (
    kind: 'h2' | 'h3' | 'paragraph' | 'blockquote' | 'task-item' | 'bullet-item' | 'ordered-item'
  ) => void;
  insertCodeBlock: (language?: string, code?: string) => void;
  insertTableBlock: () => void;
  insertDividerBlock: () => void;
  insertMarkdownContent: (markdown: string) => void;
  getSelectedText: () => string;
}

interface LiveDocumentEditorProps {
  noteId: string;
  content: string;
  onChangeContent: (nextMarkdown: string, meta?: NoteUpdateMeta) => void;
  onPasteImageFiles?: (files: File[]) => void;
  onSelectionStateChange?: (hasSelection: boolean) => void;
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

function placeCaretAtStart(el: HTMLElement) {
  el.focus();
  const range = document.createRange();
  range.selectNodeContents(el);
  range.collapse(true);
  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(range);
}

function placeCaretAtEnd(el: HTMLElement) {
  el.focus();
  const range = document.createRange();
  range.selectNodeContents(el);
  range.collapse(false);
  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(range);
}

function isCaretAtStart(el: HTMLElement): boolean {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || !sel.isCollapsed) return false;
  const range = sel.getRangeAt(0);
  if (!el.contains(range.startContainer)) return false;
  const preRange = range.cloneRange();
  preRange.selectNodeContents(el);
  preRange.setEnd(range.startContainer, range.startOffset);
  return preRange.toString().length === 0;
}

function isCaretAtEnd(el: HTMLElement): boolean {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || !sel.isCollapsed) return false;
  const range = sel.getRangeAt(0);
  if (!el.contains(range.startContainer)) return false;
  const postRange = range.cloneRange();
  postRange.selectNodeContents(el);
  postRange.setStart(range.endContainer, range.endOffset);
  return postRange.toString().length === 0;
}

function splitMarkdownAtCaret(el: HTMLElement): { before: string; after: string } | null {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return null;
  const range = sel.getRangeAt(0);
  if (!el.contains(range.startContainer)) return null;

  const beforeRange = document.createRange();
  beforeRange.selectNodeContents(el);
  beforeRange.setEnd(range.startContainer, range.startOffset);
  const beforeWrapper = document.createElement('div');
  beforeWrapper.appendChild(beforeRange.cloneContents());

  const afterRange = document.createRange();
  afterRange.selectNodeContents(el);
  afterRange.setStart(range.endContainer, range.endOffset);
  const afterWrapper = document.createElement('div');
  afterWrapper.appendChild(afterRange.cloneContents());

  return {
    before: htmlToInlineMarkdown(beforeWrapper),
    after: htmlToInlineMarkdown(afterWrapper),
  };
}

function toggleInlineCodeSelection(el: HTMLElement): boolean {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return false;
  const range = sel.getRangeAt(0);
  if (!el.contains(range.commonAncestorContainer)) return false;

  // Check if already inside a <code> element
  let node: Node | null = range.startContainer;
  while (node && node !== el) {
    if (node.nodeType === Node.ELEMENT_NODE && (node as HTMLElement).tagName === 'CODE') {
      const codeEl = node as HTMLElement;
      const textNode = document.createTextNode(codeEl.textContent || '');
      codeEl.parentNode?.replaceChild(textNode, codeEl);
      const nextRange = document.createRange();
      nextRange.selectNodeContents(textNode);
      sel.removeAllRanges();
      sel.addRange(nextRange);
      return true;
    }
    node = node.parentNode;
  }

  if (range.collapsed) return false;

  const selectedText = range.toString();
  if (!selectedText) return false;
  const codeEl = document.createElement('code');
  codeEl.setAttribute('data-inline-code', 'true');
  codeEl.textContent = selectedText;
  range.deleteContents();
  range.insertNode(codeEl);

  const nextRange = document.createRange();
  nextRange.selectNodeContents(codeEl);
  sel.removeAllRanges();
  sel.addRange(nextRange);
  return true;
}

interface RichInlineFieldProps {
  markdown: string;
  externalSyncSeq: number;
  className: string;
  placeholder?: string;
  headingId?: string;
  ariaLabel: string;
  registerRef?: (el: HTMLElement | null) => void;
  onFocusBlock: () => void;
  onChangeMarkdown: (nextMarkdown: string) => void;
  onKeyDown?: (e: React.KeyboardEvent<HTMLElement>, el: HTMLElement) => void;
  onPasteImages?: (files: File[]) => void;
}

function RichInlineField({
  markdown,
  externalSyncSeq,
  className,
  placeholder,
  headingId,
  ariaLabel,
  registerRef,
  onFocusBlock,
  onChangeMarkdown,
  onKeyDown,
  onPasteImages,
}: RichInlineFieldProps) {
  const elRef = useRef<HTMLDivElement>(null);
  const lastEmittedRef = useRef<string>(markdown);
  const lastSyncSeqRef = useRef<number>(-1);

  useEffect(() => {
    registerRef?.(elRef.current);
    return () => registerRef?.(null);
  }, [registerRef]);

  useEffect(() => {
    const el = elRef.current;
    if (!el) return;
    const isFocused = document.activeElement === el;
    const isExternalSync = lastSyncSeqRef.current !== externalSyncSeq;

    if (isExternalSync || (!isFocused && markdown !== lastEmittedRef.current) || lastSyncSeqRef.current === -1) {
      el.innerHTML = inlineMarkdownToHtml(markdown);
      lastEmittedRef.current = markdown;
      lastSyncSeqRef.current = externalSyncSeq;
    }
  }, [markdown, externalSyncSeq]);

  const emitFromDom = () => {
    const el = elRef.current;
    if (!el) return;
    const nextMd = htmlToInlineMarkdown(el);
    lastEmittedRef.current = nextMd;
    if (nextMd !== markdown) {
      onChangeMarkdown(nextMd);
    }
  };

  return (
    <div
      ref={elRef}
      id={headingId}
      contentEditable
      suppressContentEditableWarning
      role="textbox"
      aria-label={ariaLabel}
      data-placeholder={placeholder}
      onFocus={onFocusBlock}
      onInput={emitFromDom}
      onKeyDown={(e) => {
        if (!elRef.current) return;
        const mod = (e.ctrlKey || e.metaKey) && !e.altKey;
        if (mod && e.key.toLowerCase() === 'b') {
          e.preventDefault();
          document.execCommand('bold');
          emitFromDom();
          return;
        }
        if (mod && e.key.toLowerCase() === 'i') {
          e.preventDefault();
          document.execCommand('italic');
          emitFromDom();
          return;
        }
        onKeyDown?.(e, elRef.current);
      }}
      onPaste={(e) => {
        const items = Array.from(e.clipboardData?.items || []);
        const imageItems = items.filter((item) => item.type.startsWith('image/'));
        if (imageItems.length > 0 && onPasteImages) {
          e.preventDefault();
          const files: File[] = [];
          for (const item of imageItems) {
            const f = item.getAsFile();
            if (f) files.push(f);
          }
          if (files.length > 0) onPasteImages(files);
          return;
        }

        const plain = e.clipboardData?.getData('text/plain');
        if (plain !== undefined) {
          e.preventDefault();
          document.execCommand('insertText', false, plain);
          emitFromDom();
        }
      }}
      className={`live-editable outline-none break-words [&_strong]:font-semibold [&_strong]:text-neutral-950 dark:[&_strong]:text-white [&_em]:italic [&_code]:font-mono-code [&_code]:text-[13px] [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:rounded-md [&_code]:bg-neutral-100 dark:[&_code]:bg-white/[0.08] [&_code]:text-neutral-900 dark:[&_code]:text-neutral-100 [&_code]:border [&_code]:border-neutral-200/70 dark:[&_code]:border-white/[0.06] [&_a]:text-blue-600 dark:[&_a]:text-blue-400 [&_a]:underline [&_a]:underline-offset-2 ${className}`}
    />
  );
}

function EditableCodeBlock({
  language,
  code,
  registerRef,
  onFocus,
  onChangeLanguage,
  onChangeCode,
  onDelete,
}: {
  language: string;
  code: string;
  registerRef: (el: HTMLElement | null) => void;
  onFocus: () => void;
  onChangeLanguage: (lang: string) => void;
  onChangeCode: (nextCode: string) => void;
  onDelete: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const preRef = useRef<HTMLPreElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    registerRef(textareaRef.current);
    return () => registerRef(null);
  }, [registerRef]);

  const lines = useMemo(() => code.split('\n'), [code]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      // Ignore clipboard failure
    }
  };

  return (
    <div className="group my-5 overflow-hidden rounded-xl border border-neutral-200 dark:border-white/[0.08] bg-neutral-50 dark:bg-[#19191d]">
      <div className="flex items-center justify-between px-4 py-2 border-b border-neutral-200/80 dark:border-white/[0.06] bg-neutral-100/80 dark:bg-white/[0.02]">
        <input
          type="text"
          value={language}
          onFocus={onFocus}
          onChange={(e) => onChangeLanguage(e.target.value)}
          placeholder="text"
          aria-label="Code block language"
          className="w-28 bg-transparent text-xs font-mono-code text-neutral-500 dark:text-neutral-400 hover:text-neutral-800 dark:hover:text-neutral-200 focus:text-neutral-900 dark:focus:text-white focus:outline-none"
        />
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onDelete}
            title="Remove code block"
            aria-label="Remove code block"
            className="opacity-0 group-hover:opacity-100 focus:opacity-100 p-1 rounded-md text-neutral-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-neutral-200/60 dark:hover:bg-white/[0.06] transition-all cursor-pointer"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
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
      </div>

      <div className="relative overflow-hidden">
        <pre
          ref={preRef}
          aria-hidden="true"
          className="m-0 p-4 overflow-x-auto text-[13.5px] leading-[1.65] font-mono-code pointer-events-none select-none whitespace-pre"
        >
          <code>
            {lines.map((line, lineIdx) => {
              const tokens = tokenizeCodeLine(line, language || 'text');
              return (
                <div key={lineIdx} className="min-h-[1.65em]">
                  {tokens.map((tok, tokIdx) => (
                    <span key={tokIdx} className={TOKEN_CLASSES[tok.type]}>
                      {tok.value}
                    </span>
                  ))}
                  {line === '' ? ' ' : ''}
                </div>
              );
            })}
          </code>
        </pre>

        <textarea
          ref={textareaRef}
          value={code}
          rows={Math.max(1, lines.length)}
          spellCheck={false}
          aria-label="Editable code block"
          onFocus={onFocus}
          onChange={(e) => onChangeCode(e.target.value)}
          onScroll={(e) => {
            if (preRef.current) {
              preRef.current.scrollLeft = e.currentTarget.scrollLeft;
            }
          }}
          onKeyDown={(e) => {
            if (e.key === 'Tab') {
              e.preventDefault();
              const t = e.currentTarget;
              const start = t.selectionStart;
              const end = t.selectionEnd;
              const next = code.slice(0, start) + '  ' + code.slice(end);
              onChangeCode(next);
              window.requestAnimationFrame(() => {
                t.setSelectionRange(start + 2, start + 2);
              });
            }
          }}
          className="absolute inset-0 w-full h-full m-0 p-4 bg-transparent text-transparent caret-neutral-900 dark:caret-white text-[13.5px] leading-[1.65] font-mono-code resize-none overflow-x-auto overflow-y-hidden whitespace-pre focus:outline-none selection:bg-blue-500/25"
        />
      </div>
    </div>
  );
}

function EditableImageBlock({
  src,
  alt,
  onChangeAlt,
  onDelete,
}: {
  src: string;
  alt: string;
  onChangeAlt: (nextAlt: string) => void;
  onDelete: () => void;
}) {
  const initialCached = src.startsWith(IMAGE_REF_PREFIX) ? getCachedImageDataUrl(src) : src;
  const [resolvedSrc, setResolvedSrc] = useState<string | null>(initialCached);
  const [loading, setLoading] = useState<boolean>(
    Boolean(src.startsWith(IMAGE_REF_PREFIX) && !initialCached)
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
      <figure className="group my-5">
        {loading ? (
          <div className="h-48 w-full rounded-xl border border-neutral-200 dark:border-white/[0.08] bg-neutral-100 dark:bg-[#19191d] animate-pulse" />
        ) : failed || !resolvedSrc ? (
          <div className="relative flex flex-col items-center justify-center gap-2 py-8 px-4 rounded-xl border border-neutral-200 dark:border-white/[0.08] bg-neutral-50 dark:bg-[#19191d] text-neutral-500 dark:text-neutral-400">
            <ImageOff className="w-6 h-6" />
            <span className="text-[13px]">
              {alt ? `Image unavailable: ${alt}` : 'Image unavailable'}
            </span>
            <button
              type="button"
              onClick={onDelete}
              aria-label="Remove image"
              className="absolute top-2.5 right-2.5 p-1.5 rounded-lg bg-black/50 text-white hover:bg-red-600 transition-colors cursor-pointer"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        ) : (
          <div className="relative overflow-hidden rounded-xl border border-neutral-200 dark:border-white/[0.08] bg-neutral-50 dark:bg-[#19191d]">
            <img
              src={resolvedSrc}
              alt={alt || 'Embedded note image'}
              referrerPolicy="no-referrer"
              onError={() => setFailed(true)}
              onClick={() => setLightboxOpen(true)}
              className="w-full max-h-[520px] object-contain mx-auto cursor-zoom-in block"
            />
            <div className="absolute top-2.5 right-2.5 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
              <button
                type="button"
                onClick={() => setLightboxOpen(true)}
                aria-label="Expand image"
                title="Expand image"
                className="p-1.5 rounded-lg bg-black/60 hover:bg-black/80 text-white cursor-pointer"
              >
                <Maximize2 className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={onDelete}
                aria-label="Remove image"
                title="Remove image"
                className="p-1.5 rounded-lg bg-black/60 hover:bg-red-600 text-white cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}
        <figcaption className="mt-2 flex justify-center">
          <input
            type="text"
            value={alt}
            onChange={(e) => onChangeAlt(e.target.value)}
            placeholder="Add image caption..."
            aria-label="Image caption"
            className="w-full max-w-md text-center bg-transparent text-[12.5px] text-neutral-500 dark:text-neutral-400 placeholder:text-neutral-400/60 focus:text-neutral-800 dark:focus:text-neutral-200 focus:outline-none"
          />
        </figcaption>
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

export const LiveDocumentEditor = forwardRef<LiveDocumentEditorHandle, LiveDocumentEditorProps>(
  function LiveDocumentEditor(
    { noteId, content, onChangeContent, onPasteImageFiles, onSelectionStateChange },
    ref
  ) {
    const [blocks, setBlocks] = useState<DocBlock[]>(() => parseMarkdownToBlocks(content));
    const [externalSyncSeq, setExternalSyncSeq] = useState(0);
    const [focusedBlockId, setFocusedBlockId] = useState<string | null>(null);

    const blocksRef = useRef<DocBlock[]>(blocks);
    blocksRef.current = blocks;
    const focusedBlockIdRef = useRef<string | null>(null);
    focusedBlockIdRef.current = focusedBlockId;
    const lastEmittedMarkdownRef = useRef<string>(content);
    const lastNoteIdRef = useRef<string>(noteId);
    const blockElRefs = useRef<Map<string, HTMLElement>>(new Map());

    const registerBlockRef = useCallback((blockId: string, el: HTMLElement | null) => {
      if (el) {
        blockElRefs.current.set(blockId, el);
      } else {
        blockElRefs.current.delete(blockId);
      }
    }, []);

    // Track selection changes inside live editor for "Save selection as snippet"
    useEffect(() => {
      const handleSelChange = () => {
        const sel = window.getSelection();
        if (!sel || sel.isCollapsed) {
          onSelectionStateChange?.(false);
          return;
        }
        const anchor = sel.anchorNode;
        const insideLive = Array.from(blockElRefs.current.values()).some((el) =>
          anchor ? el.contains(anchor) : false
        );
        onSelectionStateChange?.(insideLive && sel.toString().trim().length > 0);
      };
      document.addEventListener('selectionchange', handleSelChange);
      return () => document.removeEventListener('selectionchange', handleSelChange);
    }, [onSelectionStateChange]);

    // Sync external content changes (note switch, Undo/Redo, snippet insert, Split/Write edits)
    useEffect(() => {
      const noteSwitched = lastNoteIdRef.current !== noteId;
      if (!noteSwitched && content === lastEmittedMarkdownRef.current) {
        return;
      }

      const prevFocusIdx = blocksRef.current.findIndex((b) => b.id === focusedBlockIdRef.current);
      lastNoteIdRef.current = noteId;
      lastEmittedMarkdownRef.current = content;
      const parsed = parseMarkdownToBlocks(content);
      blocksRef.current = parsed;
      setBlocks(parsed);
      setExternalSyncSeq((s) => s + 1);

      if (noteSwitched) {
        setFocusedBlockId(null);
      } else if (prevFocusIdx >= 0 && parsed.length > 0) {
        const targetBlock = parsed[Math.min(prevFocusIdx, parsed.length - 1)];
        window.requestAnimationFrame(() => {
          const el = blockElRefs.current.get(targetBlock.id);
          if (el && el.isContentEditable) {
            placeCaretAtEnd(el);
          }
        });
      }
    }, [noteId, content]);

    const commitBlocks = useCallback(
      (
        nextBlocks: DocBlock[],
        source: 'typing' | 'discrete',
        focusTarget?: { id: string; position: 'start' | 'end' }
      ) => {
        const normalized =
          nextBlocks.length > 0
            ? nextBlocks
            : [{ id: createBlockId(), type: 'paragraph' as const, text: '' }];
        blocksRef.current = normalized;
        setBlocks(normalized);

        const serialized = serializeBlocksToMarkdown(normalized);
        lastEmittedMarkdownRef.current = serialized;
        onChangeContent(serialized, { source, field: 'content' });

        if (focusTarget) {
          setFocusedBlockId(focusTarget.id);
          window.requestAnimationFrame(() => {
            const el = blockElRefs.current.get(focusTarget.id);
            if (!el) return;
            if (el.isContentEditable) {
              if (focusTarget.position === 'start') {
                placeCaretAtStart(el);
              } else {
                placeCaretAtEnd(el);
              }
            } else {
              el.focus();
            }
          });
        }
      },
      [onChangeContent]
    );

    const getInsertionIndex = (): number => {
      const list = blocksRef.current;
      const idx = list.findIndex((b) => b.id === focusedBlockIdRef.current);
      return idx >= 0 ? idx + 1 : list.length;
    };

    useImperativeHandle(
      ref,
      () => ({
        applyInlineFormat(format) {
          const targetId = focusedBlockIdRef.current;
          if (!targetId) return;
          const el = blockElRefs.current.get(targetId);
          if (!el || !el.isContentEditable) return;

          el.focus();
          if (format === 'bold') {
            document.execCommand('bold');
          } else if (format === 'italic') {
            document.execCommand('italic');
          } else {
            toggleInlineCodeSelection(el);
          }

          const nextText = htmlToInlineMarkdown(el);
          const nextBlocks = blocksRef.current.map((b) =>
            b.id === targetId && 'text' in b ? { ...b, text: nextText } : b
          );
          commitBlocks(nextBlocks, 'discrete');
        },

        toggleOrInsertBlock(kind) {
          const list = blocksRef.current;
          const idx = list.findIndex((b) => b.id === focusedBlockIdRef.current);

          const makeBlock = (text = ''): DocBlock => {
            const id = createBlockId();
            switch (kind) {
              case 'h2':
                return { id, type: 'heading', level: 2, text };
              case 'h3':
                return { id, type: 'heading', level: 3, text };
              case 'blockquote':
                return { id, type: 'blockquote', text };
              case 'task-item':
                return { id, type: 'task-item', checked: false, text };
              case 'bullet-item':
                return { id, type: 'bullet-item', text };
              case 'ordered-item':
                return { id, type: 'ordered-item', text };
              default:
                return { id, type: 'paragraph', text };
            }
          };

          if (idx >= 0) {
            const current = list[idx];
            if ('text' in current) {
              const converted = makeBlock(current.text);
              const nextBlocks = list.map((b, i) => (i === idx ? converted : b));
              commitBlocks(nextBlocks, 'discrete', { id: converted.id, position: 'end' });
              return;
            }
          }

          const created = makeBlock('');
          const insertAt = getInsertionIndex();
          const nextBlocks = [...list.slice(0, insertAt), created, ...list.slice(insertAt)];
          commitBlocks(nextBlocks, 'discrete', { id: created.id, position: 'end' });
        },

        insertCodeBlock(language = 'bash', code = '') {
          const list = blocksRef.current;
          const insertAt = getInsertionIndex();
          const created: DocBlock = {
            id: createBlockId(),
            type: 'code',
            language,
            code,
          };
          const nextBlocks = [...list.slice(0, insertAt), created, ...list.slice(insertAt)];
          commitBlocks(nextBlocks, 'discrete', { id: created.id, position: 'start' });
        },

        insertTableBlock() {
          const list = blocksRef.current;
          const insertAt = getInsertionIndex();
          const created: DocBlock = {
            id: createBlockId(),
            type: 'table',
            headers: ['Column A', 'Column B'],
            alignments: ['left', 'left'],
            rows: [['Value 1', 'Value 2']],
          };
          const nextBlocks = [...list.slice(0, insertAt), created, ...list.slice(insertAt)];
          commitBlocks(nextBlocks, 'discrete');
        },

        insertDividerBlock() {
          const list = blocksRef.current;
          const insertAt = getInsertionIndex();
          const hrBlock: DocBlock = { id: createBlockId(), type: 'hr' };
          const paraAfter: DocBlock = { id: createBlockId(), type: 'paragraph', text: '' };
          const nextBlocks = [
            ...list.slice(0, insertAt),
            hrBlock,
            paraAfter,
            ...list.slice(insertAt),
          ];
          commitBlocks(nextBlocks, 'discrete', { id: paraAfter.id, position: 'start' });
        },

        insertMarkdownContent(markdown: string) {
          const parsed = parseMarkdownToBlocks(markdown);
          const list = blocksRef.current;
          const idx = list.findIndex((b) => b.id === focusedBlockIdRef.current);

          let nextBlocks: DocBlock[];
          if (idx >= 0 && list[idx].type === 'paragraph' && !list[idx].text.trim()) {
            nextBlocks = [...list.slice(0, idx), ...parsed, ...list.slice(idx + 1)];
          } else {
            const insertAt = idx >= 0 ? idx + 1 : list.length;
            nextBlocks = [...list.slice(0, insertAt), ...parsed, ...list.slice(insertAt)];
          }
          const lastInserted = parsed[parsed.length - 1];
          commitBlocks(nextBlocks, 'discrete', { id: lastInserted.id, position: 'end' });
        },

        getSelectedText() {
          return window.getSelection()?.toString().trim() || '';
        },
      }),
      [commitBlocks]
    );

    const handleInlineChange = (blockId: string, nextText: string) => {
      const list = blocksRef.current;
      const idx = list.findIndex((b) => b.id === blockId);
      if (idx < 0) return;
      const block = list[idx];

      // Auto-convert markdown shortcuts when typing at the start of a paragraph
      if (block.type === 'paragraph') {
        const headingShortcut = /^(#{1,4})\s(.*)$/.exec(nextText);
        if (headingShortcut && !block.text.startsWith('# ')) {
          const created: DocBlock = {
            id: createBlockId(),
            type: 'heading',
            level: headingShortcut[1].length as 1 | 2 | 3 | 4,
            text: headingShortcut[2],
          };
          const nextBlocks = list.map((b, i) => (i === idx ? created : b));
          commitBlocks(nextBlocks, 'discrete', { id: created.id, position: 'end' });
          return;
        }

        const taskShortcut = /^(?:-\s+)?\[([ xX])\]\s(.*)$/.exec(nextText);
        if (taskShortcut) {
          const created: DocBlock = {
            id: createBlockId(),
            type: 'task-item',
            checked: taskShortcut[1].toLowerCase() === 'x',
            text: taskShortcut[2],
          };
          const nextBlocks = list.map((b, i) => (i === idx ? created : b));
          commitBlocks(nextBlocks, 'discrete', { id: created.id, position: 'end' });
          return;
        }

        const bulletShortcut = /^[-*+]\s(.*)$/.exec(nextText);
        if (bulletShortcut) {
          const created: DocBlock = {
            id: createBlockId(),
            type: 'bullet-item',
            text: bulletShortcut[1],
          };
          const nextBlocks = list.map((b, i) => (i === idx ? created : b));
          commitBlocks(nextBlocks, 'discrete', { id: created.id, position: 'end' });
          return;
        }

        const orderedShortcut = /^1\.\s(.*)$/.exec(nextText);
        if (orderedShortcut) {
          const created: DocBlock = {
            id: createBlockId(),
            type: 'ordered-item',
            text: orderedShortcut[1],
          };
          const nextBlocks = list.map((b, i) => (i === idx ? created : b));
          commitBlocks(nextBlocks, 'discrete', { id: created.id, position: 'end' });
          return;
        }

        const quoteShortcut = /^>\s(.*)$/.exec(nextText);
        if (quoteShortcut) {
          const created: DocBlock = {
            id: createBlockId(),
            type: 'blockquote',
            text: quoteShortcut[1],
          };
          const nextBlocks = list.map((b, i) => (i === idx ? created : b));
          commitBlocks(nextBlocks, 'discrete', { id: created.id, position: 'end' });
          return;
        }

        const fenceShortcut = /^```([a-zA-Z0-9_-]*)\s$/.exec(nextText);
        if (fenceShortcut) {
          const created: DocBlock = {
            id: createBlockId(),
            type: 'code',
            language: fenceShortcut[1] || 'bash',
            code: '',
          };
          const nextBlocks = list.map((b, i) => (i === idx ? created : b));
          commitBlocks(nextBlocks, 'discrete', { id: created.id, position: 'start' });
          return;
        }
      }

      const nextBlocks = list.map((b) =>
        b.id === blockId && 'text' in b ? { ...b, text: nextText } : b
      );
      commitBlocks(nextBlocks, 'typing');
    };

    const handleBlockKeyDown = (
      e: React.KeyboardEvent<HTMLElement>,
      block: DocBlock,
      el: HTMLElement
    ) => {
      const list = blocksRef.current;
      const idx = list.findIndex((b) => b.id === block.id);
      if (idx < 0) return;

      if (e.key === 'Enter' && !e.shiftKey && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();

        // Check `---` divider shortcut
        if (block.type === 'paragraph' && block.text.trim() === '---') {
          const hrBlock: DocBlock = { id: createBlockId(), type: 'hr' };
          const paraAfter: DocBlock = { id: createBlockId(), type: 'paragraph', text: '' };
          const nextBlocks = [...list.slice(0, idx), hrBlock, paraAfter, ...list.slice(idx + 1)];
          commitBlocks(nextBlocks, 'discrete', { id: paraAfter.id, position: 'start' });
          return;
        }

        // Check ```lang + Enter shortcut
        if (block.type === 'paragraph') {
          const fenceMatch = /^```([a-zA-Z0-9_-]*)$/.exec(block.text.trim());
          if (fenceMatch) {
            const codeBlock: DocBlock = {
              id: createBlockId(),
              type: 'code',
              language: fenceMatch[1] || 'bash',
              code: '',
            };
            const nextBlocks = list.map((b, i) => (i === idx ? codeBlock : b));
            commitBlocks(nextBlocks, 'discrete', { id: codeBlock.id, position: 'start' });
            return;
          }
        }

        // Exit empty list item or blockquote into a normal paragraph
        if (
          (block.type === 'task-item' ||
            block.type === 'bullet-item' ||
            block.type === 'ordered-item' ||
            block.type === 'blockquote') &&
          !block.text.trim()
        ) {
          const para: DocBlock = { id: createBlockId(), type: 'paragraph', text: '' };
          const nextBlocks = list.map((b, i) => (i === idx ? para : b));
          commitBlocks(nextBlocks, 'discrete', { id: para.id, position: 'start' });
          return;
        }

        const split = splitMarkdownAtCaret(el);
        const beforeText = split ? split.before : 'text' in block ? block.text : '';
        const afterText = split ? split.after : '';

        const updatedCurrent: DocBlock =
          'text' in block ? { ...block, text: beforeText } : block;

        let newBlock: DocBlock;
        if (block.type === 'task-item') {
          newBlock = { id: createBlockId(), type: 'task-item', checked: false, text: afterText };
        } else if (block.type === 'bullet-item') {
          newBlock = { id: createBlockId(), type: 'bullet-item', text: afterText };
        } else if (block.type === 'ordered-item') {
          newBlock = { id: createBlockId(), type: 'ordered-item', text: afterText };
        } else {
          newBlock = { id: createBlockId(), type: 'paragraph', text: afterText };
        }

        const nextBlocks = [
          ...list.slice(0, idx),
          updatedCurrent,
          newBlock,
          ...list.slice(idx + 1),
        ];
        commitBlocks(nextBlocks, 'discrete', { id: newBlock.id, position: 'start' });
        return;
      }

      if (e.key === 'Backspace' && isCaretAtStart(el)) {
        // Convert heading / list item / quote to paragraph when backspacing at start
        if (block.type !== 'paragraph' && 'text' in block) {
          e.preventDefault();
          const para: DocBlock = { id: createBlockId(), type: 'paragraph', text: block.text };
          const nextBlocks = list.map((b, i) => (i === idx ? para : b));
          commitBlocks(nextBlocks, 'discrete', { id: para.id, position: 'start' });
          return;
        }

        if (block.type === 'paragraph' && idx > 0) {
          const prev = list[idx - 1];
          if (!block.text.trim()) {
            e.preventDefault();
            const nextBlocks = [...list.slice(0, idx), ...list.slice(idx + 1)];
            if (prev.type === 'hr' || prev.type === 'image') {
              const targetIdx = Math.max(0, idx - 2);
              const focusId = nextBlocks[targetIdx]?.id;
              commitBlocks(nextBlocks, 'discrete', focusId ? { id: focusId, position: 'end' } : undefined);
            } else {
              commitBlocks(nextBlocks, 'discrete', { id: prev.id, position: 'end' });
            }
            return;
          }

          if ('text' in prev) {
            e.preventDefault();
            const mergedText = prev.text
              ? `${prev.text}${block.text ? ' ' + block.text : ''}`
              : block.text;
            const mergedPrev = { ...prev, text: mergedText } as DocBlock;
            const nextBlocks = [...list.slice(0, idx - 1), mergedPrev, ...list.slice(idx + 1)];
            setExternalSyncSeq((s) => s + 1);
            commitBlocks(nextBlocks, 'discrete', { id: prev.id, position: 'end' });
            return;
          }
        }
      }

      if (e.key === 'ArrowUp' && !e.shiftKey && isCaretAtStart(el) && idx > 0) {
        for (let prevIdx = idx - 1; prevIdx >= 0; prevIdx -= 1) {
          const prevEl = blockElRefs.current.get(list[prevIdx].id);
          if (prevEl) {
            e.preventDefault();
            if (prevEl.isContentEditable) placeCaretAtEnd(prevEl);
            else prevEl.focus();
            setFocusedBlockId(list[prevIdx].id);
            break;
          }
        }
      } else if (e.key === 'ArrowDown' && !e.shiftKey && isCaretAtEnd(el) && idx < list.length - 1) {
        for (let nextIdx = idx + 1; nextIdx < list.length; nextIdx += 1) {
          const nextEl = blockElRefs.current.get(list[nextIdx].id);
          if (nextEl) {
            e.preventDefault();
            if (nextEl.isContentEditable) placeCaretAtStart(nextEl);
            else nextEl.focus();
            setFocusedBlockId(list[nextIdx].id);
            break;
          }
        }
      }
    };

    const headingIds = useMemo(() => {
      const seen = new Map<string, number>();
      const ids = new Map<string, string>();
      for (const b of blocks) {
        if (b.type === 'heading' && b.level <= 3) {
          const base = slugifyHeading(b.text) || 'section';
          const count = seen.get(base) ?? 0;
          seen.set(base, count + 1);
          ids.set(b.id, count === 0 ? base : `${base}-${count}`);
        }
      }
      return ids;
    }, [blocks]);

    // Precompute ordered-list numbering per block
    const orderedNumbers = useMemo(() => {
      const map = new Map<string, number>();
      let count = 0;
      for (const b of blocks) {
        if (b.type === 'ordered-item') {
          count += 1;
          map.set(b.id, count);
        } else {
          count = 0;
        }
      }
      return map;
    }, [blocks]);

    const focusOrAppendBottomParagraph = () => {
      const list = blocksRef.current;
      const last = list[list.length - 1];
      if (last && last.type === 'paragraph') {
        const el = blockElRefs.current.get(last.id);
        if (el) {
          placeCaretAtEnd(el);
          setFocusedBlockId(last.id);
          return;
        }
      }
      const para: DocBlock = { id: createBlockId(), type: 'paragraph', text: '' };
      commitBlocks([...list, para], 'discrete', { id: para.id, position: 'start' });
    };

    return (
      <div
        data-live-editor="true"
        className="text-[15.5px] leading-[1.72] text-neutral-800 dark:text-[#e4e4ea] break-words"
      >
        {blocks.map((block, index) => {
          const prevType = index > 0 ? blocks[index - 1].type : null;
          const nextType = index < blocks.length - 1 ? blocks[index + 1].type : null;

          if (block.type === 'heading') {
            const headingClasses =
              block.level === 1
                ? 'text-[28px] font-semibold tracking-tight text-neutral-950 dark:text-white mt-8 mb-4 first:mt-0 leading-tight'
                : block.level === 2
                ? 'text-[21px] font-semibold tracking-tight text-neutral-950 dark:text-white mt-8 mb-3 first:mt-0 pb-1.5 border-b border-neutral-200/80 dark:border-white/[0.07]'
                : block.level === 3
                ? 'text-[17px] font-semibold text-neutral-900 dark:text-neutral-100 mt-6 mb-2.5'
                : 'text-[15px] font-semibold text-neutral-900 dark:text-neutral-100 mt-5 mb-2';

            return (
              <RichInlineField
                key={block.id}
                headingId={headingIds.get(block.id)}
                markdown={block.text}
                externalSyncSeq={externalSyncSeq}
                placeholder={`Heading ${block.level}`}
                ariaLabel={`Heading level ${block.level}`}
                className={`scroll-mt-20 ${headingClasses}`}
                registerRef={(el) => registerBlockRef(block.id, el)}
                onFocusBlock={() => setFocusedBlockId(block.id)}
                onChangeMarkdown={(val) => handleInlineChange(block.id, val)}
                onKeyDown={(e, el) => handleBlockKeyDown(e, block, el)}
                onPasteImages={onPasteImageFiles}
              />
            );
          }

          if (block.type === 'blockquote') {
            return (
              <div
                key={block.id}
                className="my-5 rounded-xl border border-neutral-200 dark:border-white/[0.09] bg-neutral-50/80 dark:bg-white/[0.03] px-4 py-3 text-[14.5px] text-neutral-700 dark:text-neutral-300"
              >
                <RichInlineField
                  markdown={block.text}
                  externalSyncSeq={externalSyncSeq}
                  placeholder="Write a note or callout..."
                  ariaLabel="Callout quote"
                  className="leading-[1.65]"
                  registerRef={(el) => registerBlockRef(block.id, el)}
                  onFocusBlock={() => setFocusedBlockId(block.id)}
                  onChangeMarkdown={(val) => handleInlineChange(block.id, val)}
                  onKeyDown={(e, el) => handleBlockKeyDown(e, block, el)}
                  onPasteImages={onPasteImageFiles}
                />
              </div>
            );
          }

          if (block.type === 'task-item') {
            const topGap = prevType === 'task-item' ? 'mt-1.5' : 'mt-3.5';
            const bottomGap = nextType === 'task-item' ? '' : 'mb-3.5';
            return (
              <div
                key={block.id}
                className={`flex items-start gap-2.5 leading-[1.65] ${topGap} ${bottomGap}`}
              >
                <input
                  type="checkbox"
                  checked={block.checked}
                  onChange={() => {
                    const nextBlocks = blocksRef.current.map((b) =>
                      b.id === block.id && b.type === 'task-item'
                        ? { ...b, checked: !b.checked }
                        : b
                    );
                    commitBlocks(nextBlocks, 'discrete');
                  }}
                  aria-label="Toggle task item"
                  className="mt-1.5 h-4 w-4 rounded border-neutral-300 dark:border-white/25 bg-white dark:bg-neutral-900 accent-blue-600 cursor-pointer shrink-0"
                />
                <RichInlineField
                  markdown={block.text}
                  externalSyncSeq={externalSyncSeq}
                  placeholder="Task item..."
                  ariaLabel="Task item text"
                  className={`flex-1 min-w-0 leading-[1.65] ${
                    block.checked
                      ? 'line-through text-neutral-400 dark:text-neutral-500'
                      : 'text-neutral-800 dark:text-[#dcdce4]'
                  }`}
                  registerRef={(el) => registerBlockRef(block.id, el)}
                  onFocusBlock={() => setFocusedBlockId(block.id)}
                  onChangeMarkdown={(val) => handleInlineChange(block.id, val)}
                  onKeyDown={(e, el) => handleBlockKeyDown(e, block, el)}
                  onPasteImages={onPasteImageFiles}
                />
              </div>
            );
          }

          if (block.type === 'bullet-item') {
            const topGap = prevType === 'bullet-item' ? 'mt-1.5' : 'mt-3.5';
            const bottomGap = nextType === 'bullet-item' ? '' : 'mb-3.5';
            return (
              <div
                key={block.id}
                className={`flex items-start gap-2.5 pl-2 leading-[1.7] ${topGap} ${bottomGap}`}
              >
                <span
                  aria-hidden="true"
                  className="mt-[0.62em] h-1.5 w-1.5 rounded-full bg-neutral-400 dark:bg-neutral-500 shrink-0"
                />
                <RichInlineField
                  markdown={block.text}
                  externalSyncSeq={externalSyncSeq}
                  placeholder="List item..."
                  ariaLabel="Bullet list item"
                  className="flex-1 min-w-0 leading-[1.7] text-neutral-800 dark:text-[#dcdce4]"
                  registerRef={(el) => registerBlockRef(block.id, el)}
                  onFocusBlock={() => setFocusedBlockId(block.id)}
                  onChangeMarkdown={(val) => handleInlineChange(block.id, val)}
                  onKeyDown={(e, el) => handleBlockKeyDown(e, block, el)}
                  onPasteImages={onPasteImageFiles}
                />
              </div>
            );
          }

          if (block.type === 'ordered-item') {
            const topGap = prevType === 'ordered-item' ? 'mt-1.5' : 'mt-3.5';
            const bottomGap = nextType === 'ordered-item' ? '' : 'mb-3.5';
            const itemNum = orderedNumbers.get(block.id) ?? 1;
            return (
              <div
                key={block.id}
                className={`flex items-start gap-2.5 pl-2 leading-[1.7] ${topGap} ${bottomGap}`}
              >
                <span
                  aria-hidden="true"
                  className="min-w-[1.25rem] text-right text-[14.5px] font-medium text-neutral-500 dark:text-neutral-400 tabular-nums select-none shrink-0"
                >
                  {itemNum}.
                </span>
                <RichInlineField
                  markdown={block.text}
                  externalSyncSeq={externalSyncSeq}
                  placeholder="List item..."
                  ariaLabel="Numbered list item"
                  className="flex-1 min-w-0 leading-[1.7] text-neutral-800 dark:text-[#dcdce4]"
                  registerRef={(el) => registerBlockRef(block.id, el)}
                  onFocusBlock={() => setFocusedBlockId(block.id)}
                  onChangeMarkdown={(val) => handleInlineChange(block.id, val)}
                  onKeyDown={(e, el) => handleBlockKeyDown(e, block, el)}
                  onPasteImages={onPasteImageFiles}
                />
              </div>
            );
          }

          if (block.type === 'code') {
            return (
              <EditableCodeBlock
                key={block.id}
                language={block.language}
                code={block.code}
                registerRef={(el) => registerBlockRef(block.id, el)}
                onFocus={() => setFocusedBlockId(block.id)}
                onChangeLanguage={(nextLang) => {
                  const nextBlocks = blocksRef.current.map((b) =>
                    b.id === block.id && b.type === 'code' ? { ...b, language: nextLang } : b
                  );
                  commitBlocks(nextBlocks, 'typing');
                }}
                onChangeCode={(nextCode) => {
                  const nextBlocks = blocksRef.current.map((b) =>
                    b.id === block.id && b.type === 'code' ? { ...b, code: nextCode } : b
                  );
                  commitBlocks(nextBlocks, 'typing');
                }}
                onDelete={() => {
                  const nextBlocks = blocksRef.current.filter((b) => b.id !== block.id);
                  commitBlocks(nextBlocks, 'discrete');
                }}
              />
            );
          }

          if (block.type === 'table') {
            return (
              <div key={block.id} className="group my-5">
                <div className="overflow-x-auto rounded-xl border border-neutral-200 dark:border-white/[0.08]">
                  <table className="w-full border-collapse text-left text-[14px] tabular-nums">
                    <thead className="bg-neutral-100/80 dark:bg-white/[0.03] border-b border-neutral-200 dark:border-white/[0.08]">
                      <tr>
                        {block.headers.map((header, colIdx) => (
                          <th
                            key={colIdx}
                            className="px-4 py-2.5 text-[12.5px] font-semibold text-neutral-700 dark:text-neutral-200"
                          >
                            <RichInlineField
                              markdown={header}
                              externalSyncSeq={externalSyncSeq}
                              placeholder="Header"
                              ariaLabel={`Table column ${colIdx + 1} header`}
                              className="min-w-[80px]"
                              onFocusBlock={() => setFocusedBlockId(block.id)}
                              onChangeMarkdown={(val) => {
                                const nextBlocks = blocksRef.current.map((b) => {
                                  if (b.id !== block.id || b.type !== 'table') return b;
                                  const headers = b.headers.map((h, i) => (i === colIdx ? val : h));
                                  return { ...b, headers };
                                });
                                commitBlocks(nextBlocks, 'typing');
                              }}
                              onPasteImages={onPasteImageFiles}
                            />
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {block.rows.map((row, rowIdx) => (
                        <tr key={rowIdx}>
                          {block.headers.map((_, colIdx) => (
                            <td
                              key={colIdx}
                              className="px-4 py-2.5 text-neutral-700 dark:text-neutral-300 border-t border-neutral-200/70 dark:border-white/[0.06] align-top"
                            >
                              <RichInlineField
                                markdown={row[colIdx] || ''}
                                externalSyncSeq={externalSyncSeq}
                                placeholder="Cell..."
                                ariaLabel={`Table row ${rowIdx + 1} column ${colIdx + 1}`}
                                className="min-w-[80px]"
                                onFocusBlock={() => setFocusedBlockId(block.id)}
                                onChangeMarkdown={(val) => {
                                  const nextBlocks = blocksRef.current.map((b) => {
                                    if (b.id !== block.id || b.type !== 'table') return b;
                                    const rows = b.rows.map((r, rI) =>
                                      rI === rowIdx
                                        ? r.map((c, cI) => (cI === colIdx ? val : c))
                                        : r
                                    );
                                    return { ...b, rows };
                                  });
                                  commitBlocks(nextBlocks, 'typing');
                                }}
                                onPasteImages={onPasteImageFiles}
                              />
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="mt-1.5 flex items-center justify-end gap-2 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                  <button
                    type="button"
                    onClick={() => {
                      const nextBlocks = blocksRef.current.map((b) =>
                        b.id === block.id && b.type === 'table'
                          ? { ...b, rows: [...b.rows, b.headers.map(() => '')] }
                          : b
                      );
                      commitBlocks(nextBlocks, 'discrete');
                    }}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11.5px] font-medium text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-white hover:bg-neutral-100 dark:hover:bg-white/[0.06] cursor-pointer"
                  >
                    <Plus className="w-3 h-3" />
                    <span>Row</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const nextBlocks = blocksRef.current.map((b) =>
                        b.id === block.id && b.type === 'table'
                          ? {
                              ...b,
                              headers: [...b.headers, `Column ${b.headers.length + 1}`],
                              alignments: [...b.alignments, 'left' as const],
                              rows: b.rows.map((r) => [...r, '']),
                            }
                          : b
                      );
                      commitBlocks(nextBlocks, 'discrete');
                    }}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11.5px] font-medium text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-white hover:bg-neutral-100 dark:hover:bg-white/[0.06] cursor-pointer"
                  >
                    <Plus className="w-3 h-3" />
                    <span>Column</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const nextBlocks = blocksRef.current.filter((b) => b.id !== block.id);
                      commitBlocks(nextBlocks, 'discrete');
                    }}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11.5px] font-medium text-neutral-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-neutral-100 dark:hover:bg-white/[0.06] cursor-pointer"
                  >
                    <Trash2 className="w-3 h-3" />
                    <span>Remove</span>
                  </button>
                </div>
              </div>
            );
          }

          if (block.type === 'image') {
            return (
              <EditableImageBlock
                key={block.id}
                src={block.src}
                alt={block.alt}
                onChangeAlt={(nextAlt) => {
                  const nextBlocks = blocksRef.current.map((b) =>
                    b.id === block.id && b.type === 'image' ? { ...b, alt: nextAlt } : b
                  );
                  commitBlocks(nextBlocks, 'typing');
                }}
                onDelete={() => {
                  const nextBlocks = blocksRef.current.filter((b) => b.id !== block.id);
                  commitBlocks(nextBlocks, 'discrete');
                }}
              />
            );
          }

          if (block.type === 'hr') {
            return (
              <div key={block.id} className="group relative my-7 py-1">
                <hr className="border-neutral-200 dark:border-white/[0.08]" />
                <button
                  type="button"
                  onClick={() => {
                    const nextBlocks = blocksRef.current.filter((b) => b.id !== block.id);
                    commitBlocks(nextBlocks, 'discrete');
                  }}
                  title="Remove divider"
                  aria-label="Remove divider"
                  className="opacity-0 group-hover:opacity-100 absolute right-0 -top-2 p-1 rounded-md bg-white dark:bg-[#19191d] border border-neutral-200 dark:border-white/10 text-neutral-400 hover:text-red-600 dark:hover:text-red-400 transition-opacity cursor-pointer"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            );
          }

          // Paragraph block
          return (
            <RichInlineField
              key={block.id}
              markdown={block.text}
              externalSyncSeq={externalSyncSeq}
              placeholder={
                blocks.length === 1 && !block.text
                  ? 'Start writing directly, paste screenshots, or type / formatting like ##, -, []...'
                  : 'Write here...'
              }
              ariaLabel="Document paragraph"
              className="my-3.5 text-neutral-800 dark:text-[#dcdce4] leading-[1.72] min-h-[1.72em]"
              registerRef={(el) => registerBlockRef(block.id, el)}
              onFocusBlock={() => setFocusedBlockId(block.id)}
              onChangeMarkdown={(val) => handleInlineChange(block.id, val)}
              onKeyDown={(e, el) => handleBlockKeyDown(e, block, el)}
              onPasteImages={onPasteImageFiles}
            />
          );
        })}

        {/* Clickable empty writing area at bottom */}
        <div
          onClick={focusOrAppendBottomParagraph}
          className="min-h-[160px] cursor-text"
          aria-hidden="true"
        />
      </div>
    );
  }
);
