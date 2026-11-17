import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  AlertCircle,
  ArrowRight,
  Check,
  Copy,
  Loader2,
  RotateCw,
  Sparkles,
  X,
} from 'lucide-react';
import {
  ProofreadMode,
  ProofreadResult,
  requestAiProofread,
} from '../utils/aiProofreadClient';

interface AiProofreadModalProps {
  isOpen: boolean;
  documentTitle: string;
  fullText: string;
  selectedText?: string;
  onClose: () => void;
  onApply: (correctedText: string, scope: 'document' | 'selection') => void;
}

const MODE_OPTIONS: Array<{ id: ProofreadMode; label: string; hint: string }> = [
  {
    id: 'proofread',
    label: 'Spelling & Grammar',
    hint: 'Fix typos, spelling, punctuation, and grammar while keeping your exact voice.',
  },
  {
    id: 'spelling',
    label: 'Spelling Only',
    hint: 'Fix misspelled words and typos without altering sentence structure.',
  },
  {
    id: 'clarity',
    label: 'Clarity & Flow',
    hint: 'Fix spelling and grammar and lightly polish awkward technical phrasing.',
  },
];

export function AiProofreadModal({
  isOpen,
  documentTitle,
  fullText,
  selectedText = '',
  onClose,
  onApply,
}: AiProofreadModalProps) {
  const hasSelection = selectedText.trim().length > 0;
  const [scope, setScope] = useState<'document' | 'selection'>(
    hasSelection ? 'selection' : 'document'
  );
  const [mode, setMode] = useState<ProofreadMode>('proofread');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ProofreadResult | null>(null);
  const [editedText, setEditedText] = useState('');
  const [copied, setCopied] = useState(false);
  const requestSeqRef = useRef(0);

  const sourceText = scope === 'selection' && hasSelection ? selectedText : fullText;

  const runProofread = useCallback(
    async (targetText: string, targetMode: ProofreadMode) => {
      const seq = ++requestSeqRef.current;
      if (!targetText.trim()) {
        setResult({
          correctedText: targetText,
          summary: 'Nothing to proofread yet — add some text first.',
          changes: [],
          model: 'groq',
        });
        setEditedText(targetText);
        setError(null);
        setLoading(false);
        return;
      }

      setLoading(true);
      setError(null);
      try {
        const res = await requestAiProofread(targetText, targetMode);
        if (requestSeqRef.current !== seq) return;
        setResult(res);
        setEditedText(res.correctedText);
      } catch (err) {
        if (requestSeqRef.current !== seq) return;
        setError(err instanceof Error ? err.message : 'Failed to proofread with Groq AI');
        setResult(null);
      } finally {
        if (requestSeqRef.current === seq) {
          setLoading(false);
        }
      }
    },
    []
  );

  useEffect(() => {
    if (!isOpen) return;
    const initialScope = selectedText.trim().length > 0 ? 'selection' : 'document';
    setScope(initialScope);
    setCopied(false);
    const target = initialScope === 'selection' ? selectedText : fullText;
    void runProofread(target, mode);
    // Only trigger automatic initial run when modal opens
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

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

  const handleModeChange = (nextMode: ProofreadMode) => {
    setMode(nextMode);
    void runProofread(sourceText, nextMode);
  };

  const handleScopeChange = (nextScope: 'document' | 'selection') => {
    setScope(nextScope);
    const target = nextScope === 'selection' && hasSelection ? selectedText : fullText;
    void runProofread(target, mode);
  };

  const handleCopy = async () => {
    if (!editedText) return;
    try {
      await navigator.clipboard.writeText(editedText);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // ignore clipboard errors
    }
  };

  const hasTextChanges = Boolean(result && editedText !== sourceText);

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
        aria-labelledby="ai-proofread-title"
        className="w-full max-w-2xl max-h-[88vh] flex flex-col rounded-2xl border border-neutral-200 dark:border-white/12 bg-white dark:bg-[#17171c] shadow-2xl overflow-hidden"
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-neutral-200 dark:border-white/[0.08] flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-blue-600/12 dark:bg-blue-500/18 text-blue-600 dark:text-blue-400 flex items-center justify-center shrink-0">
              <Sparkles className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <h2
                id="ai-proofread-title"
                className="text-[15px] font-semibold text-neutral-950 dark:text-white truncate"
              >
                Groq AI Spelling &amp; Grammar
              </h2>
              <p className="text-[12px] text-neutral-500 dark:text-neutral-400 truncate">
                {documentTitle || 'Untitled Note'}
                {result?.model ? ` · ${result.model}` : ''}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close AI proofreader"
            className="p-1.5 rounded-lg text-neutral-500 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-white hover:bg-neutral-100 dark:hover:bg-white/[0.07] transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Mode & Scope Controls */}
        <div className="px-5 py-3 border-b border-neutral-200 dark:border-white/[0.07] bg-neutral-50/70 dark:bg-white/[0.02] flex flex-wrap items-center justify-between gap-3">
          <div className="inline-flex items-center rounded-lg bg-neutral-200/70 dark:bg-white/[0.06] p-0.5">
            {MODE_OPTIONS.map((opt) => {
              const active = mode === opt.id;
              return (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => handleModeChange(opt.id)}
                  className={`px-2.5 py-1 rounded-md text-[12px] font-medium transition-colors cursor-pointer whitespace-nowrap ${
                    active
                      ? 'bg-white dark:bg-[#24242b] text-neutral-950 dark:text-white shadow-xs'
                      : 'text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-white'
                  }`}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>

          <div className="flex items-center gap-2">
            {hasSelection && (
              <div className="inline-flex items-center rounded-lg bg-neutral-200/70 dark:bg-white/[0.06] p-0.5">
                <button
                  type="button"
                  onClick={() => handleScopeChange('selection')}
                  className={`px-2.5 py-1 rounded-md text-[12px] font-medium transition-colors cursor-pointer whitespace-nowrap ${
                    scope === 'selection'
                      ? 'bg-white dark:bg-[#24242b] text-neutral-950 dark:text-white shadow-xs'
                      : 'text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-white'
                  }`}
                >
                  Selection
                </button>
                <button
                  type="button"
                  onClick={() => handleScopeChange('document')}
                  className={`px-2.5 py-1 rounded-md text-[12px] font-medium transition-colors cursor-pointer whitespace-nowrap ${
                    scope === 'document'
                      ? 'bg-white dark:bg-[#24242b] text-neutral-950 dark:text-white shadow-xs'
                      : 'text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-white'
                  }`}
                >
                  Full note
                </button>
              </div>
            )}

            <button
              type="button"
              onClick={() => void runProofread(sourceText, mode)}
              disabled={loading}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[12px] font-medium text-neutral-600 dark:text-neutral-300 hover:bg-neutral-200/70 dark:hover:bg-white/[0.07] disabled:opacity-50 transition-colors cursor-pointer whitespace-nowrap"
            >
              <RotateCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              <span>Re-check</span>
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          <p className="text-[12.5px] text-neutral-500 dark:text-neutral-400">
            {MODE_OPTIONS.find((m) => m.id === mode)?.hint} Code blocks, diagrams, and links stay untouched.
          </p>

          {loading ? (
            <div className="py-12 flex flex-col items-center justify-center gap-3 text-neutral-500 dark:text-neutral-400">
              <Loader2 className="w-6 h-6 animate-spin text-blue-600 dark:text-blue-400" />
              <span className="text-[13px] font-medium">
                Checking spelling &amp; grammar with Groq AI...
              </span>
            </div>
          ) : error ? (
            <div className="rounded-xl border border-red-200 dark:border-red-500/30 bg-red-50/80 dark:bg-red-500/10 p-4 flex items-start gap-3">
              <AlertCircle className="w-4 h-4 text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0 space-y-2">
                <p className="text-[13px] text-red-800 dark:text-red-200 leading-relaxed">
                  {error}
                </p>
                <button
                  type="button"
                  onClick={() => void runProofread(sourceText, mode)}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[12px] font-medium bg-red-600 hover:bg-red-700 text-white transition-colors cursor-pointer"
                >
                  <RotateCw className="w-3 h-3" />
                  <span>Try again</span>
                </button>
              </div>
            </div>
          ) : result ? (
            <>
              <div
                className={`rounded-xl border px-3.5 py-2.5 flex items-center justify-between gap-2 text-[13px] ${
                  hasTextChanges
                    ? 'border-blue-200 dark:border-blue-500/25 bg-blue-50/70 dark:bg-blue-500/10 text-blue-900 dark:text-blue-100'
                    : 'border-emerald-200 dark:border-emerald-500/25 bg-emerald-50/70 dark:bg-emerald-500/10 text-emerald-900 dark:text-emerald-100'
                }`}
              >
                <span className="font-medium">{result.summary}</span>
                {result.changes.length > 0 && (
                  <span className="text-[12px] opacity-80 tabular-nums shrink-0">
                    {result.changes.length}{' '}
                    {result.changes.length === 1 ? 'edit' : 'edits'}
                  </span>
                )}
              </div>

              {result.changes.length > 0 && (
                <div className="space-y-1.5">
                  <div className="text-[12px] font-medium text-neutral-500 dark:text-neutral-400">
                    Detected corrections
                  </div>
                  <div className="max-h-40 overflow-y-auto rounded-xl border border-neutral-200 dark:border-white/[0.08] divide-y divide-neutral-200/70 dark:divide-white/[0.06] bg-neutral-50/50 dark:bg-white/[0.02]">
                    {result.changes.map((c, idx) => (
                      <div
                        key={idx}
                        className="px-3 py-2 flex items-center justify-between gap-3 text-[12.5px]"
                      >
                        <div className="flex items-center gap-2 flex-wrap min-w-0">
                          <span className="line-through text-red-600 dark:text-red-400 break-words">
                            {c.original}
                          </span>
                          <ArrowRight className="w-3 h-3 text-neutral-400 shrink-0" />
                          <span className="font-medium text-emerald-700 dark:text-emerald-400 break-words">
                            {c.corrected}
                          </span>
                        </div>
                        <span className="text-[11.5px] text-neutral-500 dark:text-neutral-400 shrink-0">
                          {c.reason}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label
                    htmlFor="ai-proofread-output"
                    className="text-[12px] font-medium text-neutral-500 dark:text-neutral-400"
                  >
                    Corrected text (editable before applying)
                  </label>
                </div>
                <textarea
                  id="ai-proofread-output"
                  value={editedText}
                  onChange={(e) => setEditedText(e.target.value)}
                  rows={8}
                  className="editor-source-font w-full rounded-xl border border-neutral-200 dark:border-white/[0.1] bg-white dark:bg-[#111115] px-3.5 py-2.5 text-[13px] leading-[1.7] text-neutral-900 dark:text-neutral-100 focus:outline-none focus:ring-2 focus:ring-blue-500/40 resize-y"
                />
              </div>
            </>
          ) : null}
        </div>

        {/* Footer */}
        <div className="px-5 py-3.5 border-t border-neutral-200 dark:border-white/[0.08] bg-neutral-50/70 dark:bg-white/[0.02] flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={handleCopy}
            disabled={!editedText || loading}
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
                <span>Copy text</span>
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
            <button
              type="button"
              disabled={loading || !result || !hasTextChanges}
              onClick={() => {
                onApply(editedText, scope);
                onClose();
              }}
              className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-[12.5px] font-medium bg-blue-600 hover:bg-blue-700 disabled:opacity-45 disabled:hover:bg-blue-600 text-white transition-colors cursor-pointer whitespace-nowrap"
            >
              <Check className="w-3.5 h-3.5" />
              <span>{scope === 'selection' ? 'Replace selection' : 'Apply to document'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
