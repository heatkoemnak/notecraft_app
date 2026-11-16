import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  Check,
  Code2,
  Copy,
  Download,
  Maximize2,
  Pencil,
  Trash2,
  Workflow,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { detectDiagramLabel, renderMermaidSvg } from '../utils/mermaidRenderer';

interface DiagramBlockProps {
  code: string;
  language?: string;
  editable?: boolean;
  onEditVisual?: () => void;
  onChangeCode?: (nextCode: string) => void;
  onDelete?: () => void;
}

function useDocumentDarkMode(): boolean {
  const [isDark, setIsDark] = useState<boolean>(() =>
    typeof document !== 'undefined'
      ? document.documentElement.classList.contains('dark')
      : true
  );

  useEffect(() => {
    const root = document.documentElement;
    const sync = () => setIsDark(root.classList.contains('dark'));
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(root, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);

  return isDark;
}

function downloadSvgMarkup(svg: string, title: string) {
  const slug =
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'notecraft-diagram';
  const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${slug}.svg`;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function DiagramBlock({
  code,
  editable = false,
  onEditVisual,
  onChangeCode,
  onDelete,
}: DiagramBlockProps) {
  const isDark = useDocumentDarkMode();
  const [viewTab, setViewTab] = useState<'diagram' | 'code'>('diagram');
  const [svgMarkup, setSvgMarkup] = useState<string>('');
  const [renderError, setRenderError] = useState<string | null>(null);
  const [rendering, setRendering] = useState<boolean>(true);
  const [copied, setCopied] = useState<boolean>(false);
  const [zoomOpen, setZoomOpen] = useState<boolean>(false);
  const [zoomScale, setZoomScale] = useState<number>(1);
  const containerRef = useRef<HTMLDivElement>(null);

  const diagramLabel = useMemo(() => detectDiagramLabel(code), [code]);

  useEffect(() => {
    let active = true;
    const trimmed = code.trim();
    if (!trimmed) {
      setSvgMarkup('');
      setRenderError('Diagram source is empty.');
      setRendering(false);
      return;
    }

    setRendering(true);
    renderMermaidSvg(trimmed, isDark)
      .then(({ svg, bindFunctions }) => {
        if (!active) return;
        setSvgMarkup(svg);
        setRenderError(null);
        setRendering(false);
        if (bindFunctions && containerRef.current) {
          window.requestAnimationFrame(() => {
            if (containerRef.current) {
              bindFunctions(containerRef.current);
            }
          });
        }
      })
      .catch((err: unknown) => {
        if (!active) return;
        const msg =
          err instanceof Error && err.message
            ? err.message.split('\n')[0]
            : 'Unable to parse diagram syntax.';
        setRenderError(msg);
        setRendering(false);
      });

    return () => {
      active = false;
    };
  }, [code, isDark]);

  useEffect(() => {
    if (!zoomOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setZoomOpen(false);
      } else if (e.key === '+' || e.key === '=') {
        setZoomScale((s) => Math.min(2.5, Number((s + 0.25).toFixed(2))));
      } else if (e.key === '-') {
        setZoomScale((s) => Math.max(0.5, Number((s - 0.25).toFixed(2))));
      } else if (e.key === '0') {
        setZoomScale(1);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [zoomOpen]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard blocked
    }
  };

  const lineCount = useMemo(() => Math.max(4, code.split('\n').length), [code]);

  return (
    <>
      <div className="group my-5 overflow-hidden rounded-xl border border-neutral-200 dark:border-white/[0.08] bg-neutral-50 dark:bg-[#19191d]">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-2 px-3.5 py-2 border-b border-neutral-200/80 dark:border-white/[0.06] bg-neutral-100/80 dark:bg-white/[0.02]">
          <div className="flex items-center gap-2 min-w-0">
            <Workflow className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400 shrink-0" />
            <span className="text-[12.5px] font-medium text-neutral-700 dark:text-neutral-200 truncate">
              {diagramLabel}
            </span>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            {/* Segmented Diagram | Code toggle */}
            <div
              className="flex items-center p-0.5 rounded-md bg-neutral-200/70 dark:bg-white/[0.05] border border-neutral-200 dark:border-white/[0.07]"
              role="tablist"
              aria-label="Diagram view"
            >
              <button
                type="button"
                role="tab"
                aria-selected={viewTab === 'diagram'}
                onClick={() => setViewTab('diagram')}
                className={`px-2 py-0.5 rounded text-[11.5px] font-medium transition-colors cursor-pointer whitespace-nowrap ${
                  viewTab === 'diagram'
                    ? 'bg-white dark:bg-[#27272c] text-neutral-950 dark:text-white shadow-xs'
                    : 'text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-white'
                }`}
              >
                Diagram
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={viewTab === 'code'}
                onClick={() => setViewTab('code')}
                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11.5px] font-medium transition-colors cursor-pointer whitespace-nowrap ${
                  viewTab === 'code'
                    ? 'bg-white dark:bg-[#27272c] text-neutral-950 dark:text-white shadow-xs'
                    : 'text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-white'
                }`}
              >
                <Code2 className="w-3 h-3" />
                <span>Code</span>
              </button>
            </div>

            {editable && onEditVisual && (
              <button
                type="button"
                onClick={onEditVisual}
                title="Edit diagram visually or in code"
                aria-label="Edit diagram"
                className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[12px] font-medium text-blue-600 dark:text-blue-400 hover:bg-blue-500/10 transition-colors cursor-pointer whitespace-nowrap"
              >
                <Pencil className="w-3 h-3" />
                <span>Edit</span>
              </button>
            )}

            {svgMarkup && !renderError && (
              <button
                type="button"
                onClick={() => {
                  setZoomScale(1);
                  setZoomOpen(true);
                }}
                title="Expand diagram"
                aria-label="Expand diagram"
                className="p-1.5 rounded-md text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-white hover:bg-neutral-200/60 dark:hover:bg-white/[0.06] transition-colors cursor-pointer"
              >
                <Maximize2 className="w-3.5 h-3.5" />
              </button>
            )}

            <button
              type="button"
              onClick={handleCopy}
              title="Copy Mermaid source"
              aria-label="Copy Mermaid source"
              className="inline-flex items-center gap-1 text-[12px] font-medium text-neutral-600 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100 transition-colors px-2 py-1 rounded-md hover:bg-neutral-200/60 dark:hover:bg-white/[0.06] whitespace-nowrap shrink-0 cursor-pointer"
            >
              {copied ? (
                <>
                  <Check className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                  <span className="text-emerald-700 dark:text-emerald-400">Copied</span>
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Copy</span>
                </>
              )}
            </button>

            {editable && onDelete && (
              <button
                type="button"
                onClick={onDelete}
                title="Remove diagram"
                aria-label="Remove diagram"
                className="opacity-0 group-hover:opacity-100 focus:opacity-100 p-1.5 rounded-md text-neutral-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-neutral-200/60 dark:hover:bg-white/[0.06] transition-all cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>

        {/* Body */}
        {viewTab === 'diagram' ? (
          <div className="p-4 sm:p-5 overflow-x-auto flex items-center justify-center min-h-[160px]">
            {rendering && !svgMarkup ? (
              <div className="w-full h-40 rounded-lg bg-neutral-200/50 dark:bg-white/[0.03] animate-pulse" />
            ) : renderError ? (
              <div className="w-full max-w-lg py-4 px-4 rounded-lg border border-red-200 dark:border-red-500/25 bg-red-50/70 dark:bg-red-500/10 text-left space-y-2">
                <div className="flex items-center gap-2 text-[13px] font-medium text-red-700 dark:text-red-300">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>Diagram syntax error</span>
                </div>
                <p className="text-[12.5px] font-mono-code text-red-600/90 dark:text-red-300/80 break-words">
                  {renderError}
                </p>
                <div className="flex items-center gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => setViewTab('code')}
                    className="px-2.5 py-1 rounded-md text-[12px] font-medium bg-white dark:bg-[#232329] border border-red-200 dark:border-red-500/30 text-neutral-800 dark:text-neutral-200 hover:bg-neutral-50 dark:hover:bg-[#2b2b33] cursor-pointer"
                  >
                    Inspect source
                  </button>
                  {editable && onEditVisual && (
                    <button
                      type="button"
                      onClick={onEditVisual}
                      className="px-2.5 py-1 rounded-md text-[12px] font-medium bg-blue-600 text-white hover:bg-blue-700 cursor-pointer"
                    >
                      Open diagram editor
                    </button>
                  )}
                </div>
              </div>
            ) : (
              <div
                ref={containerRef}
                onClick={() => {
                  setZoomScale(1);
                  setZoomOpen(true);
                }}
                title="Click to expand diagram"
                className="w-full flex justify-center cursor-zoom-in [&>svg]:max-w-full [&>svg]:h-auto [&>svg]:select-none"
                dangerouslySetInnerHTML={{ __html: svgMarkup }}
              />
            )}
          </div>
        ) : editable && onChangeCode ? (
          <div className="p-3.5 space-y-2">
            <textarea
              value={code}
              rows={Math.min(18, lineCount)}
              spellCheck={false}
              aria-label="Mermaid diagram source"
              onChange={(e) => onChangeCode(e.target.value)}
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
              className="editor-source-font w-full rounded-lg border border-neutral-200 dark:border-white/[0.08] bg-white dark:bg-[#131316] p-3 text-[13px] leading-[1.65] text-neutral-900 dark:text-neutral-100 focus:outline-none focus:ring-2 focus:ring-blue-500/40 resize-y"
            />
            {renderError && (
              <div className="flex items-center gap-1.5 text-[12px] text-amber-700 dark:text-amber-300">
                <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                <span className="truncate">{renderError}</span>
              </div>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto p-4 text-[13px] leading-[1.65] font-mono-code text-neutral-800 dark:text-neutral-200">
            <pre className="m-0 whitespace-pre">{code}</pre>
          </div>
        )}
      </div>

      {/* Fullscreen Zoom Modal */}
      {zoomOpen && svgMarkup && (
        <div
          className="fixed inset-0 z-50 flex flex-col bg-black/80 backdrop-blur-xs p-4 sm:p-6"
          onClick={() => setZoomOpen(false)}
          role="dialog"
          aria-modal="true"
          aria-label="Expanded diagram viewer"
        >
          <div
            className="flex items-center justify-between gap-3 px-4 py-2.5 rounded-xl bg-white dark:bg-[#18181c] border border-neutral-200 dark:border-white/10 shadow-xl mb-3 shrink-0"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2 min-w-0">
              <Workflow className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0" />
              <span className="text-[13.5px] font-semibold text-neutral-900 dark:text-white truncate">
                {diagramLabel}
              </span>
            </div>

            <div className="flex items-center gap-1.5 shrink-0">
              <button
                type="button"
                onClick={() =>
                  setZoomScale((s) => Math.max(0.5, Number((s - 0.25).toFixed(2))))
                }
                aria-label="Zoom out"
                title="Zoom out (-)"
                className="p-1.5 rounded-lg text-neutral-600 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-white/[0.08] cursor-pointer"
              >
                <ZoomOut className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => setZoomScale(1)}
                title="Reset zoom (0)"
                className="px-2 py-1 rounded-md text-[12px] font-medium text-neutral-700 dark:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-white/[0.08] tabular-nums cursor-pointer"
              >
                {Math.round(zoomScale * 100)}%
              </button>
              <button
                type="button"
                onClick={() =>
                  setZoomScale((s) => Math.min(2.5, Number((s + 0.25).toFixed(2))))
                }
                aria-label="Zoom in"
                title="Zoom in (+)"
                className="p-1.5 rounded-lg text-neutral-600 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-white/[0.08] cursor-pointer"
              >
                <ZoomIn className="w-4 h-4" />
              </button>

              <div className="w-px h-4 bg-neutral-200 dark:bg-white/10 mx-1" />

              <button
                type="button"
                onClick={() => downloadSvgMarkup(svgMarkup, diagramLabel)}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[12px] font-medium border border-neutral-200 dark:border-white/12 text-neutral-700 dark:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-white/[0.06] cursor-pointer whitespace-nowrap"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Download SVG</span>
              </button>

              {editable && onEditVisual && (
                <button
                  type="button"
                  onClick={() => {
                    setZoomOpen(false);
                    onEditVisual();
                  }}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[12px] font-medium bg-blue-600 hover:bg-blue-700 text-white cursor-pointer whitespace-nowrap"
                >
                  <Pencil className="w-3.5 h-3.5" />
                  <span>Edit</span>
                </button>
              )}

              <button
                type="button"
                onClick={() => setZoomOpen(false)}
                aria-label="Close diagram viewer"
                className="p-1.5 rounded-lg text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-white hover:bg-neutral-100 dark:hover:bg-white/[0.08] cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          <div
            className="flex-1 min-h-0 overflow-auto rounded-2xl border border-neutral-200 dark:border-white/10 bg-neutral-50 dark:bg-[#19191d] p-6 sm:p-10 flex items-center justify-center"
            onClick={(e) => e.stopPropagation()}
          >
            <div
              style={{
                transform: `scale(${zoomScale})`,
                transformOrigin: 'center center',
              }}
              className="transition-transform duration-150 [&>svg]:max-w-none"
              dangerouslySetInnerHTML={{ __html: svgMarkup }}
            />
          </div>
        </div>
      )}
    </>
  );
}
