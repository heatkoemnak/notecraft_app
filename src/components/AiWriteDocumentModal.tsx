import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  AlertCircle,
  Check,
  Code2,
  Copy,
  Eye,
  FileCode2,
  Loader2,
  RotateCw,
  Table2,
  Wand2,
  Workflow,
  X,
} from 'lucide-react';
import {
  GenerateDocLength,
  GenerateDocType,
  GenerateDocumentResult,
  requestAiGenerateDocument,
} from '../utils/aiDocumentClient';
import { MarkdownRenderer } from './MarkdownRenderer';

interface AiWriteDocumentModalProps {
  isOpen: boolean;
  currentTitle: string;
  currentContent: string;
  onClose: () => void;
  onApply: (payload: {
    title?: string;
    content: string;
    mode: 'replace' | 'append';
  }) => void;
}

const DOC_TYPES: Array<{ id: GenerateDocType; label: string }> = [
  { id: 'general', label: 'General Note' },
  { id: 'spec', label: 'Technical Spec' },
  { id: 'runbook', label: 'Runbook / SOP' },
  { id: 'api', label: 'API Docs' },
  { id: 'meeting', label: 'Meeting Notes' },
  { id: 'guide', label: 'Step-by-Step Guide' },
];

const LENGTH_OPTIONS: Array<{ id: GenerateDocLength; label: string }> = [
  { id: 'concise', label: 'Concise' },
  { id: 'standard', label: 'Standard' },
  { id: 'detailed', label: 'Detailed' },
];

const QUICK_PROMPTS: Array<{
  label: string;
  docType: GenerateDocType;
  prompt: string;
  tables: boolean;
  diagrams: boolean;
  code: boolean;
}> = [
  {
    label: 'Auth & JWT API Spec',
    docType: 'api',
    prompt:
      'Write complete REST API documentation for user authentication using JWT access & refresh tokens, including endpoints table, login sequence diagram, error codes, and curl/TypeScript examples.',
    tables: true,
    diagrams: true,
    code: true,
  },
  {
    label: 'Production Deployment Runbook',
    docType: 'runbook',
    prompt:
      'Create a production deployment and rollback runbook covering pre-deployment checklist, database migration steps, health verification, and rollback procedures.',
    tables: true,
    diagrams: false,
    code: true,
  },
  {
    label: 'Sprint Planning Notes',
    docType: 'meeting',
    prompt:
      'Draft structured engineering sprint planning meeting notes with goals, capacity table, key architecture decisions, risks, and action item checklists.',
    tables: true,
    diagrams: false,
    code: false,
  },
];

export function AiWriteDocumentModal({
  isOpen,
  currentTitle,
  currentContent,
  onClose,
  onApply,
}: AiWriteDocumentModalProps) {
  const hasExistingContent = currentContent.trim().length > 0;
  const [prompt, setPrompt] = useState('');
  const [docType, setDocType] = useState<GenerateDocType>('general');
  const [length, setLength] = useState<GenerateDocLength>('standard');
  const [includeTables, setIncludeTables] = useState(true);
  const [includeDiagrams, setIncludeDiagrams] = useState(false);
  const [includeCode, setIncludeCode] = useState(true);
  const [useExistingContext, setUseExistingContext] = useState(false);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<GenerateDocumentResult | null>(null);
  const [draftTitle, setDraftTitle] = useState('');
  const [draftContent, setDraftContent] = useState('');
  const [updateTitle, setUpdateTitle] = useState(true);
  const [previewTab, setPreviewTab] = useState<'rendered' | 'markdown'>('rendered');
  const [copied, setCopied] = useState(false);

  const promptInputRef = useRef<HTMLTextAreaElement>(null);
  const reqSeqRef = useRef(0);

  useEffect(() => {
    if (!isOpen) return;
    setError(null);
    setCopied(false);
    setUseExistingContext(false);
    setUpdateTitle(!currentTitle.trim() || currentTitle.trim().toLowerCase() === 'untitled note');
    window.requestAnimationFrame(() => {
      promptInputRef.current?.focus();
    });
  }, [isOpen, currentTitle]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleGenerate = async () => {
    if (!prompt.trim() || loading) return;
    const seq = ++reqSeqRef.current;
    setLoading(true);
    setError(null);

    try {
      const res = await requestAiGenerateDocument({
        prompt: prompt.trim(),
        docType,
        length,
        includeTables,
        includeDiagrams,
        includeCode,
        existingTitle: useExistingContext ? currentTitle : undefined,
        existingContent: useExistingContext && hasExistingContent ? currentContent : undefined,
      });
      if (reqSeqRef.current !== seq) return;
      setResult(res);
      setDraftTitle(res.title);
      setDraftContent(res.content);
      setPreviewTab('rendered');
    } catch (err) {
      if (reqSeqRef.current !== seq) return;
      setError(err instanceof Error ? err.message : 'Failed to generate document');
    } finally {
      if (reqSeqRef.current === seq) {
        setLoading(false);
      }
    }
  };

  const handleCopy = async () => {
    if (!draftContent) return;
    try {
      const full = draftTitle.trim() ? `# ${draftTitle.trim()}\n\n${draftContent}` : draftContent;
      await navigator.clipboard.writeText(full);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // ignore clipboard errors
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/55 backdrop-blur-xs"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="ai-write-doc-title"
        className="w-full max-w-3xl max-h-[90vh] flex flex-col rounded-2xl border border-neutral-200 dark:border-white/12 bg-white dark:bg-[#17171c] shadow-2xl overflow-hidden"
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-neutral-200 dark:border-white/[0.08] flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-blue-600/12 dark:bg-blue-500/18 text-blue-600 dark:text-blue-400 flex items-center justify-center shrink-0">
              <Wand2 className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <h2
                id="ai-write-doc-title"
                className="text-[15px] font-semibold text-neutral-950 dark:text-white truncate"
              >
                Write Whole Document with Groq AI
              </h2>
              <p className="text-[12px] text-neutral-500 dark:text-neutral-400 truncate">
                Describe what you need and generate a complete structured Markdown note
                {result?.model ? ` · ${result.model}` : ''}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close AI document writer"
            className="p-1.5 rounded-lg text-neutral-500 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-white hover:bg-neutral-100 dark:hover:bg-white/[0.07] transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {/* Prompt Input */}
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <label
                htmlFor="ai-write-prompt"
                className="text-[12.5px] font-medium text-neutral-700 dark:text-neutral-200"
              >
                What document do you want to write?
              </label>
              <span className="text-[11.5px] text-neutral-400 tabular-nums">
                Ctrl+Enter to generate
              </span>
            </div>

            <textarea
              ref={promptInputRef}
              id="ai-write-prompt"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => {
                if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                  e.preventDefault();
                  void handleGenerate();
                }
              }}
              rows={3}
              placeholder="e.g., Write a system architecture spec for a real-time notification service using Redis Pub/Sub and WebSockets, with an architecture diagram and API payload table..."
              className="w-full rounded-xl border border-neutral-200 dark:border-white/[0.1] bg-white dark:bg-[#111115] px-3.5 py-2.5 text-[13.5px] leading-relaxed text-neutral-900 dark:text-neutral-100 placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-blue-500/40 resize-y"
            />

            {!result && (
              <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                <span className="text-[11.5px] text-neutral-500 dark:text-neutral-400 mr-1">
                  Examples:
                </span>
                {QUICK_PROMPTS.map((item) => (
                  <button
                    key={item.label}
                    type="button"
                    onClick={() => {
                      setPrompt(item.prompt);
                      setDocType(item.docType);
                      setIncludeTables(item.tables);
                      setIncludeDiagrams(item.diagrams);
                      setIncludeCode(item.code);
                    }}
                    className="px-2.5 py-1 rounded-lg border border-neutral-200 dark:border-white/[0.09] bg-neutral-50 dark:bg-white/[0.03] hover:bg-neutral-100 dark:hover:bg-white/[0.08] text-[11.5px] font-medium text-neutral-600 dark:text-neutral-300 transition-colors cursor-pointer whitespace-nowrap"
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Configuration Grid */}
          <div className="rounded-xl border border-neutral-200 dark:border-white/[0.08] bg-neutral-50/70 dark:bg-white/[0.02] p-3.5 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="space-y-1">
                <span className="text-[11.5px] font-medium text-neutral-500 dark:text-neutral-400 block">
                  Document Type
                </span>
                <div className="flex flex-wrap gap-1">
                  {DOC_TYPES.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => setDocType(t.id)}
                      className={`px-2.5 py-1 rounded-lg text-[12px] font-medium transition-colors cursor-pointer whitespace-nowrap ${
                        docType === t.id
                          ? 'bg-blue-600 text-white'
                          : 'bg-white dark:bg-white/[0.05] text-neutral-600 dark:text-neutral-300 border border-neutral-200 dark:border-white/[0.08] hover:text-neutral-950 dark:hover:text-white'
                      }`}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-1">
                <span className="text-[11.5px] font-medium text-neutral-500 dark:text-neutral-400 block">
                  Depth
                </span>
                <div className="inline-flex items-center rounded-lg bg-neutral-200/70 dark:bg-white/[0.06] p-0.5">
                  {LENGTH_OPTIONS.map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => setLength(opt.id)}
                      className={`px-2.5 py-1 rounded-md text-[12px] font-medium transition-colors cursor-pointer whitespace-nowrap ${
                        length === opt.id
                          ? 'bg-white dark:bg-[#24242b] text-neutral-950 dark:text-white shadow-xs'
                          : 'text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-white'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="pt-2 border-t border-neutral-200/80 dark:border-white/[0.07] flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <OptionToggle
                  active={includeTables}
                  onClick={() => setIncludeTables((v) => !v)}
                  icon={<Table2 className="w-3.5 h-3.5" />}
                  label="Tables"
                />
                <OptionToggle
                  active={includeDiagrams}
                  onClick={() => setIncludeDiagrams((v) => !v)}
                  icon={<Workflow className="w-3.5 h-3.5" />}
                  label="Flowchart / Diagram"
                />
                <OptionToggle
                  active={includeCode}
                  onClick={() => setIncludeCode((v) => !v)}
                  icon={<Code2 className="w-3.5 h-3.5" />}
                  label="Code blocks"
                />
                {hasExistingContent && (
                  <label className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-neutral-200 dark:border-white/[0.08] bg-white dark:bg-white/[0.04] text-[12px] text-neutral-700 dark:text-neutral-300 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={useExistingContext}
                      onChange={(e) => setUseExistingContext(e.target.checked)}
                      className="h-3.5 w-3.5 rounded accent-blue-600 cursor-pointer"
                    />
                    <span>Use current note as context</span>
                  </label>
                )}
              </div>

              <button
                type="button"
                onClick={() => void handleGenerate()}
                disabled={loading || !prompt.trim()}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-[12.5px] font-medium bg-blue-600 hover:bg-blue-700 disabled:opacity-45 text-white transition-colors cursor-pointer whitespace-nowrap shrink-0"
              >
                {loading ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Writing...</span>
                  </>
                ) : result ? (
                  <>
                    <RotateCw className="w-3.5 h-3.5" />
                    <span>Regenerate</span>
                  </>
                ) : (
                  <>
                    <Wand2 className="w-3.5 h-3.5" />
                    <span>Generate document</span>
                  </>
                )}
              </button>
            </div>
          </div>

          {error && (
            <div className="rounded-xl border border-red-200 dark:border-red-500/30 bg-red-50/80 dark:bg-red-500/10 p-3.5 flex items-start gap-2.5">
              <AlertCircle className="w-4 h-4 text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
              <p className="text-[13px] text-red-800 dark:text-red-200 leading-relaxed">
                {error}
              </p>
            </div>
          )}

          {loading && !result && (
            <div className="py-10 flex flex-col items-center justify-center gap-3 text-neutral-500 dark:text-neutral-400">
              <Loader2 className="w-6 h-6 animate-spin text-blue-600 dark:text-blue-400" />
              <span className="text-[13px] font-medium">
                Drafting your full document with Groq AI...
              </span>
            </div>
          )}

          {result && (
            <div className="space-y-3 pt-1">
              {/* Draft Title + Preview Mode Switch */}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 flex-1 min-w-[220px]">
                  <input
                    type="text"
                    value={draftTitle}
                    onChange={(e) => setDraftTitle(e.target.value)}
                    aria-label="Generated document title"
                    placeholder="Document title"
                    className="flex-1 min-w-0 rounded-lg border border-neutral-200 dark:border-white/[0.1] bg-white dark:bg-[#111115] px-3 py-1.5 text-[13.5px] font-semibold text-neutral-950 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500/40"
                  />
                  <label className="inline-flex items-center gap-1.5 text-[12px] text-neutral-600 dark:text-neutral-300 cursor-pointer whitespace-nowrap select-none">
                    <input
                      type="checkbox"
                      checked={updateTitle}
                      onChange={(e) => setUpdateTitle(e.target.checked)}
                      className="h-3.5 w-3.5 rounded accent-blue-600 cursor-pointer"
                    />
                    <span>Apply title</span>
                  </label>
                </div>

                <div className="inline-flex items-center rounded-lg bg-neutral-100 dark:bg-white/[0.06] p-0.5">
                  <button
                    type="button"
                    onClick={() => setPreviewTab('rendered')}
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[12px] font-medium transition-colors cursor-pointer whitespace-nowrap ${
                      previewTab === 'rendered'
                        ? 'bg-white dark:bg-[#24242b] text-neutral-950 dark:text-white shadow-xs'
                        : 'text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-white'
                    }`}
                  >
                    <Eye className="w-3.5 h-3.5" />
                    <span>Preview</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setPreviewTab('markdown')}
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[12px] font-medium transition-colors cursor-pointer whitespace-nowrap ${
                      previewTab === 'markdown'
                        ? 'bg-white dark:bg-[#24242b] text-neutral-950 dark:text-white shadow-xs'
                        : 'text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-white'
                    }`}
                  >
                    <FileCode2 className="w-3.5 h-3.5" />
                    <span>Edit Markdown</span>
                  </button>
                </div>
              </div>

              {previewTab === 'rendered' ? (
                <div className="max-h-[340px] overflow-y-auto rounded-xl border border-neutral-200 dark:border-white/[0.09] bg-white dark:bg-[#121216] px-5 py-4">
                  <MarkdownRenderer content={draftContent} />
                </div>
              ) : (
                <textarea
                  value={draftContent}
                  onChange={(e) => setDraftContent(e.target.value)}
                  rows={12}
                  aria-label="Generated document Markdown"
                  className="editor-source-font w-full rounded-xl border border-neutral-200 dark:border-white/[0.1] bg-white dark:bg-[#111115] px-3.5 py-2.5 text-[13px] leading-[1.7] text-neutral-900 dark:text-neutral-100 focus:outline-none focus:ring-2 focus:ring-blue-500/40 resize-y"
                />
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3.5 border-t border-neutral-200 dark:border-white/[0.08] bg-neutral-50/70 dark:bg-white/[0.02] flex flex-wrap items-center justify-between gap-3">
          <button
            type="button"
            onClick={handleCopy}
            disabled={!draftContent || loading}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12.5px] font-medium text-neutral-600 dark:text-neutral-300 hover:bg-neutral-200/70 dark:hover:bg-white/[0.07] disabled:opacity-40 transition-colors cursor-pointer whitespace-nowrap"
          >
            {copied ? (
              <>
                <Check className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                <span>Copied</span>
              </>
            ) : (
              <>
                <Copy className="w-3.5 h-3.5" />
                <span>Copy Markdown</span>
              </>
            )}
          </button>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-1.5 rounded-lg text-[12.5px] font-medium text-neutral-600 dark:text-neutral-300 hover:bg-neutral-200/70 dark:hover:bg-white/[0.07] transition-colors cursor-pointer whitespace-nowrap"
            >
              Cancel
            </button>
            {result && hasExistingContent && (
              <button
                type="button"
                disabled={loading || !draftContent.trim()}
                onClick={() => {
                  onApply({
                    title: updateTitle ? draftTitle.trim() : undefined,
                    content: draftContent,
                    mode: 'append',
                  });
                  onClose();
                }}
                className="px-3.5 py-1.5 rounded-lg text-[12.5px] font-medium border border-neutral-200 dark:border-white/12 bg-white dark:bg-white/[0.05] text-neutral-800 dark:text-neutral-100 hover:bg-neutral-100 dark:hover:bg-white/[0.09] disabled:opacity-45 transition-colors cursor-pointer whitespace-nowrap"
              >
                Append to note
              </button>
            )}
            <button
              type="button"
              disabled={loading || !draftContent.trim()}
              onClick={() => {
                onApply({
                  title: updateTitle ? draftTitle.trim() : undefined,
                  content: draftContent,
                  mode: 'replace',
                });
                onClose();
              }}
              className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-[12.5px] font-medium bg-blue-600 hover:bg-blue-700 disabled:opacity-45 disabled:hover:bg-blue-600 text-white transition-colors cursor-pointer whitespace-nowrap"
            >
              <Check className="w-3.5 h-3.5" />
              <span>{hasExistingContent ? 'Replace document' : 'Insert document'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}

function OptionToggle({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[12px] font-medium border transition-colors cursor-pointer whitespace-nowrap ${
        active
          ? 'border-blue-600/40 dark:border-blue-400/40 bg-blue-600/10 dark:bg-blue-500/15 text-blue-700 dark:text-blue-300'
          : 'border-neutral-200 dark:border-white/[0.08] bg-white dark:bg-white/[0.03] text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-white'
      }`}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}
