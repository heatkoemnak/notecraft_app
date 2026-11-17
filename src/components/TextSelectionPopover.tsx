import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  AlertCircle,
  ArrowRight,
  Bold,
  Check,
  CheckSquare,
  ChevronDown,
  Code,
  Heading1,
  Heading2,
  Heading3,
  Italic,
  Link2,
  List,
  ListOrdered,
  Loader2,
  Quote,
  RemoveFormatting,
  Sparkles,
  Strikethrough,
  Type,
  Unlink,
  X,
} from 'lucide-react';
import {
  ProofreadMode,
  ProofreadResult,
  requestAiProofread,
} from '../utils/aiProofreadClient';

export type BlockStyleOption =
  | 'paragraph'
  | 'h1'
  | 'h2'
  | 'h3'
  | 'blockquote'
  | 'bullet-item'
  | 'ordered-item'
  | 'task-item';

export interface SelectionFormatState {
  bold: boolean;
  italic: boolean;
  strike: boolean;
  code: boolean;
  linkHref: string | null;
}

export interface SelectionAnchorRect {
  top: number;
  bottom: number;
  left: number;
  width: number;
}

interface BlockStyleItem {
  id: BlockStyleOption;
  label: string;
  shortLabel: string;
  icon: React.ReactNode;
}

const BLOCK_STYLE_ITEMS: BlockStyleItem[] = [
  { id: 'paragraph', label: 'Text', shortLabel: 'Text', icon: <Type className="w-3.5 h-3.5" /> },
  { id: 'h1', label: 'Heading 1', shortLabel: 'H1', icon: <Heading1 className="w-3.5 h-3.5" /> },
  { id: 'h2', label: 'Heading 2', shortLabel: 'H2', icon: <Heading2 className="w-3.5 h-3.5" /> },
  { id: 'h3', label: 'Heading 3', shortLabel: 'H3', icon: <Heading3 className="w-3.5 h-3.5" /> },
  { id: 'blockquote', label: 'Quote', shortLabel: 'Quote', icon: <Quote className="w-3.5 h-3.5" /> },
  { id: 'bullet-item', label: 'Bullet list', shortLabel: 'Bullet', icon: <List className="w-3.5 h-3.5" /> },
  { id: 'ordered-item', label: 'Numbered list', shortLabel: 'List', icon: <ListOrdered className="w-3.5 h-3.5" /> },
  { id: 'task-item', label: 'Checklist', shortLabel: 'Task', icon: <CheckSquare className="w-3.5 h-3.5" /> },
];

const AI_MODES: Array<{ id: ProofreadMode; label: string }> = [
  { id: 'proofread', label: 'Grammar & Spelling' },
  { id: 'spelling', label: 'Spelling' },
  { id: 'clarity', label: 'Clarity' },
];

interface TextSelectionPopoverProps {
  open: boolean;
  anchorRect: SelectionAnchorRect | null;
  canChangeBlockType: boolean;
  currentBlockType?: BlockStyleOption;
  activeFormats: SelectionFormatState;
  linkEditorOpen: boolean;
  popoverRef: React.RefObject<HTMLDivElement | null>;
  onToggleFormat: (format: 'bold' | 'italic' | 'strike' | 'code') => void;
  onClearFormatting: () => void;
  onChangeBlockType?: (kind: BlockStyleOption) => void;
  onOpenLinkEditor: () => void;
  onCloseLinkEditor: () => void;
  onApplyLink: (url: string) => void;
  onRemoveLink: () => void;
  onGetSelectedText?: () => string;
  onApplyAiText?: (correctedText: string) => void;
  onAiPanelOpenChange?: (isOpen: boolean) => void;
}

export function TextSelectionPopover({
  open,
  anchorRect,
  canChangeBlockType,
  currentBlockType = 'paragraph',
  activeFormats,
  linkEditorOpen,
  popoverRef,
  onToggleFormat,
  onClearFormatting,
  onChangeBlockType,
  onOpenLinkEditor,
  onCloseLinkEditor,
  onApplyLink,
  onRemoveLink,
  onGetSelectedText,
  onApplyAiText,
  onAiPanelOpenChange,
}: TextSelectionPopoverProps) {
  const [styleMenuOpen, setStyleMenuOpen] = useState(false);
  const [draftUrl, setDraftUrl] = useState('');
  const [aiPanelOpen, setAiPanelOpen] = useState(false);
  const [aiMode, setAiMode] = useState<ProofreadMode>('proofread');
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiResult, setAiResult] = useState<ProofreadResult | null>(null);
  const [aiOriginalText, setAiOriginalText] = useState('');
  const [coords, setCoords] = useState<{ left: number; top: number; flipBelow: boolean }>({
    left: -9999,
    top: -9999,
    flipBelow: false,
  });
  const urlInputRef = useRef<HTMLInputElement>(null);
  const aiReqSeqRef = useRef(0);

  useEffect(() => {
    if (!open) {
      setStyleMenuOpen(false);
      setAiPanelOpen(false);
      setAiError(null);
      setAiResult(null);
      onAiPanelOpenChange?.(false);
    }
  }, [open, onAiPanelOpenChange]);

  useEffect(() => {
    if (linkEditorOpen) {
      setStyleMenuOpen(false);
      setAiPanelOpen(false);
      onAiPanelOpenChange?.(false);
      setDraftUrl(activeFormats.linkHref || '');
      window.requestAnimationFrame(() => {
        urlInputRef.current?.focus();
        urlInputRef.current?.select();
      });
    }
  }, [linkEditorOpen, activeFormats.linkHref, onAiPanelOpenChange]);

  useLayoutEffect(() => {
    if (!open || !anchorRect) return;
    const el = popoverRef.current;
    const width =
      el?.offsetWidth ||
      (aiPanelOpen ? 360 : linkEditorOpen ? 330 : canChangeBlockType ? 396 : 308);
    const height = el?.offsetHeight || 40;
    const gap = 10;
    const margin = 12;

    const centerX = anchorRect.left + anchorRect.width / 2;
    const clampedLeft = Math.max(
      margin,
      Math.min(centerX - width / 2, window.innerWidth - width - margin)
    );

    const preferTop = anchorRect.top - height - gap;
    const flipBelow = preferTop < margin;
    const rawTop = flipBelow ? anchorRect.bottom + gap : preferTop;
    const clampedTop = Math.max(
      margin,
      Math.min(rawTop, window.innerHeight - height - margin)
    );

    setCoords({ left: Math.round(clampedLeft), top: Math.round(clampedTop), flipBelow });
  }, [
    open,
    anchorRect,
    linkEditorOpen,
    aiPanelOpen,
    aiLoading,
    aiResult,
    aiError,
    canChangeBlockType,
    styleMenuOpen,
    popoverRef,
  ]);

  if (!open || !anchorRect) return null;

  const activeStyleItem =
    BLOCK_STYLE_ITEMS.find((item) => item.id === currentBlockType) || BLOCK_STYLE_ITEMS[0];

  const handleLinkSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = draftUrl.trim();
    if (!trimmed) {
      if (activeFormats.linkHref) {
        onRemoveLink();
      } else {
        onCloseLinkEditor();
      }
      return;
    }
    onApplyLink(trimmed);
  };

  const runSelectionAiProofread = async (targetText: string, mode: ProofreadMode) => {
    const seq = ++aiReqSeqRef.current;
    setAiLoading(true);
    setAiError(null);
    try {
      const res = await requestAiProofread(targetText, mode);
      if (aiReqSeqRef.current !== seq) return;
      setAiResult(res);
    } catch (err) {
      if (aiReqSeqRef.current !== seq) return;
      setAiError(err instanceof Error ? err.message : 'Groq AI request failed');
      setAiResult(null);
    } finally {
      if (aiReqSeqRef.current === seq) {
        setAiLoading(false);
      }
    }
  };

  const handleOpenAiProofread = () => {
    if (!onGetSelectedText) return;
    const text = onGetSelectedText();
    if (!text.trim()) return;
    setStyleMenuOpen(false);
    setAiOriginalText(text);
    setAiResult(null);
    setAiError(null);
    setAiPanelOpen(true);
    onAiPanelOpenChange?.(true);
    void runSelectionAiProofread(text, aiMode);
  };

  const handleCloseAiPanel = () => {
    aiReqSeqRef.current += 1;
    setAiPanelOpen(false);
    setAiLoading(false);
    setAiError(null);
    setAiResult(null);
    onAiPanelOpenChange?.(false);
  };

  const aiHasChanges = Boolean(
    aiResult && aiResult.correctedText.trim() !== aiOriginalText.trim()
  );

  return createPortal(
    <div
      ref={popoverRef}
      role="toolbar"
      aria-label="Text properties"
      style={{ left: `${coords.left}px`, top: `${coords.top}px` }}
      className="fixed z-[95] select-none"
    >
      <div className="relative rounded-xl border border-neutral-200 dark:border-white/15 bg-white/98 dark:bg-[#1a1a20]/98 backdrop-blur-md shadow-[0_12px_34px_-8px_rgba(0,0,0,0.28)] dark:shadow-[0_16px_40px_-8px_rgba(0,0,0,0.68)] p-1">
        {aiPanelOpen ? (
          <div className="w-[348px] max-w-[calc(100vw-32px)] p-2 space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 text-[12px] font-semibold text-neutral-900 dark:text-white">
                <Sparkles className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                <span>Groq AI</span>
              </div>
              <div className="inline-flex items-center rounded-lg bg-neutral-100 dark:bg-white/[0.06] p-0.5">
                {AI_MODES.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                      setAiMode(m.id);
                      void runSelectionAiProofread(aiOriginalText, m.id);
                    }}
                    className={`px-2 py-0.5 rounded-md text-[11px] font-medium transition-colors cursor-pointer whitespace-nowrap ${
                      aiMode === m.id
                        ? 'bg-white dark:bg-[#272730] text-neutral-950 dark:text-white shadow-xs'
                        : 'text-neutral-500 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-white'
                    }`}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={handleCloseAiPanel}
                aria-label="Close Groq AI suggestion"
                className="w-6 h-6 rounded-md flex items-center justify-center text-neutral-500 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-white/[0.08] cursor-pointer shrink-0"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>

            {aiLoading ? (
              <div className="py-3 flex items-center gap-2 text-[12.5px] text-neutral-500 dark:text-neutral-400">
                <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-600 dark:text-blue-400 shrink-0" />
                <span>Checking spelling &amp; grammar...</span>
              </div>
            ) : aiError ? (
              <div className="space-y-2">
                <div className="rounded-lg border border-red-200 dark:border-red-500/30 bg-red-50/70 dark:bg-red-500/10 p-2 flex items-start gap-2 text-[12px] text-red-700 dark:text-red-300">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                  <span className="leading-snug">{aiError}</span>
                </div>
                <div className="flex justify-end gap-1.5">
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={handleCloseAiPanel}
                    className="px-2.5 py-1 rounded-lg text-[12px] font-medium text-neutral-600 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-white/[0.08] cursor-pointer"
                  >
                    Close
                  </button>
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => void runSelectionAiProofread(aiOriginalText, aiMode)}
                    className="px-2.5 py-1 rounded-lg text-[12px] font-medium bg-blue-600 hover:bg-blue-700 text-white cursor-pointer"
                  >
                    Retry
                  </button>
                </div>
              </div>
            ) : aiResult ? (
              aiHasChanges ? (
                <div className="space-y-2">
                  {aiResult.changes.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {aiResult.changes.slice(0, 3).map((ch, i) => (
                        <div
                          key={i}
                          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-neutral-100 dark:bg-white/[0.06] text-[11px] max-w-full"
                        >
                          <span className="line-through text-red-600 dark:text-red-400 truncate max-w-[110px]">
                            {ch.original}
                          </span>
                          <ArrowRight className="w-2.5 h-2.5 text-neutral-400 shrink-0" />
                          <span className="font-medium text-emerald-700 dark:text-emerald-400 truncate max-w-[120px]">
                            {ch.corrected}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="max-h-28 overflow-y-auto rounded-lg border border-neutral-200 dark:border-white/[0.08] bg-neutral-50/70 dark:bg-white/[0.03] px-2.5 py-2 text-[12.5px] leading-relaxed text-neutral-900 dark:text-neutral-100 whitespace-pre-wrap select-text">
                    {aiResult.correctedText}
                  </div>

                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] text-neutral-500 dark:text-neutral-400 truncate">
                      {aiResult.summary}
                    </span>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={handleCloseAiPanel}
                        className="px-2.5 py-1 rounded-lg text-[12px] font-medium text-neutral-600 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-white/[0.08] cursor-pointer"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => {
                          const corrected = aiResult.correctedText;
                          handleCloseAiPanel();
                          onApplyAiText?.(corrected);
                        }}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[12px] font-medium bg-blue-600 hover:bg-blue-700 text-white cursor-pointer"
                      >
                        <Check className="w-3 h-3" />
                        <span>Replace</span>
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-between gap-2 py-1">
                  <span className="inline-flex items-center gap-1.5 text-[12.5px] text-emerald-700 dark:text-emerald-400">
                    <Check className="w-3.5 h-3.5 shrink-0" />
                    <span>No spelling or grammar issues found.</span>
                  </span>
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={handleCloseAiPanel}
                    className="px-2.5 py-1 rounded-lg text-[12px] font-medium text-neutral-600 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-white/[0.08] cursor-pointer shrink-0"
                  >
                    Done
                  </button>
                </div>
              )
            ) : null}
          </div>
        ) : linkEditorOpen ? (
          <form onSubmit={handleLinkSubmit} className="flex items-center gap-1 px-1 py-0.5">
            <Link2 className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400 shrink-0" />
            <input
              ref={urlInputRef}
              type="text"
              value={draftUrl}
              onChange={(e) => setDraftUrl(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  e.preventDefault();
                  e.stopPropagation();
                  onCloseLinkEditor();
                }
              }}
              placeholder="Paste or type link URL..."
              aria-label="Link URL"
              className="w-52 bg-transparent px-1.5 py-1 text-[12.5px] text-neutral-900 dark:text-white placeholder:text-neutral-400 focus:outline-none"
            />
            <button
              type="submit"
              title="Apply link"
              aria-label="Apply link"
              className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-[12px] font-medium transition-colors cursor-pointer whitespace-nowrap shrink-0"
            >
              <Check className="w-3 h-3" />
              <span>Apply</span>
            </button>
            {activeFormats.linkHref && (
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={onRemoveLink}
                title="Remove link"
                aria-label="Remove link"
                className="w-7 h-7 rounded-lg flex items-center justify-center text-red-600 dark:text-red-400 hover:bg-red-500/10 transition-colors cursor-pointer shrink-0"
              >
                <Unlink className="w-3.5 h-3.5" />
              </button>
            )}
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={onCloseLinkEditor}
              title="Cancel"
              aria-label="Cancel link edit"
              className="w-7 h-7 rounded-lg flex items-center justify-center text-neutral-500 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-white/[0.08] hover:text-neutral-900 dark:hover:text-white transition-colors cursor-pointer shrink-0"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </form>
        ) : (
          <div className="flex items-center gap-0.5">
            {canChangeBlockType && onChangeBlockType && (
              <>
                <div className="relative">
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => setStyleMenuOpen((prev) => !prev)}
                    title="Turn into text style"
                    aria-label="Text style"
                    aria-expanded={styleMenuOpen}
                    className={`h-7 px-2 rounded-lg flex items-center gap-1.5 text-[12px] font-medium transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                      styleMenuOpen
                        ? 'bg-neutral-100 dark:bg-white/[0.1] text-neutral-950 dark:text-white'
                        : 'text-neutral-700 dark:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-white/[0.08] hover:text-neutral-950 dark:hover:text-white'
                    }`}
                  >
                    <span className="text-neutral-500 dark:text-neutral-400">
                      {activeStyleItem.icon}
                    </span>
                    <span>{activeStyleItem.shortLabel}</span>
                    <ChevronDown className="w-3 h-3 text-neutral-400" />
                  </button>

                  {styleMenuOpen && (
                    <div
                      className={`absolute left-0 ${
                        coords.flipBelow ? 'top-full mt-1.5' : 'top-full mt-1.5'
                      } w-44 rounded-xl border border-neutral-200 dark:border-white/15 bg-white dark:bg-[#19191f] shadow-2xl p-1 z-10`}
                    >
                      {BLOCK_STYLE_ITEMS.map((item) => {
                        const isActive = item.id === currentBlockType;
                        return (
                          <button
                            key={item.id}
                            type="button"
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => {
                              setStyleMenuOpen(false);
                              onChangeBlockType(item.id);
                            }}
                            className={`w-full flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg text-[12.5px] transition-colors cursor-pointer whitespace-nowrap ${
                              isActive
                                ? 'bg-blue-600/12 dark:bg-blue-500/20 text-blue-600 dark:text-blue-400 font-medium'
                                : 'text-neutral-700 dark:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-white/[0.07]'
                            }`}
                          >
                            <span className="flex items-center gap-2">
                              {item.icon}
                              <span>{item.label}</span>
                            </span>
                            {isActive && <Check className="w-3.5 h-3.5 shrink-0" />}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
                <div className="w-px h-4 bg-neutral-200 dark:bg-white/10 mx-0.5 shrink-0" />
              </>
            )}

            <FormatButton
              active={activeFormats.bold}
              title="Bold (Ctrl+B)"
              ariaLabel="Bold"
              onClick={() => onToggleFormat('bold')}
              icon={<Bold className="w-3.5 h-3.5" />}
            />
            <FormatButton
              active={activeFormats.italic}
              title="Italic (Ctrl+I)"
              ariaLabel="Italic"
              onClick={() => onToggleFormat('italic')}
              icon={<Italic className="w-3.5 h-3.5" />}
            />
            <FormatButton
              active={activeFormats.strike}
              title="Strikethrough"
              ariaLabel="Strikethrough"
              onClick={() => onToggleFormat('strike')}
              icon={<Strikethrough className="w-3.5 h-3.5" />}
            />
            <FormatButton
              active={activeFormats.code}
              title="Inline code (`code`)"
              ariaLabel="Inline code"
              onClick={() => onToggleFormat('code')}
              icon={<Code className="w-3.5 h-3.5" />}
            />
            <FormatButton
              active={Boolean(activeFormats.linkHref)}
              title={activeFormats.linkHref ? `Edit link (${activeFormats.linkHref})` : 'Add link'}
              ariaLabel="Link"
              onClick={onOpenLinkEditor}
              icon={<Link2 className="w-3.5 h-3.5" />}
            />

            <div className="w-px h-4 bg-neutral-200 dark:bg-white/10 mx-0.5 shrink-0" />

            <FormatButton
              active={false}
              title="Clear formatting"
              ariaLabel="Clear formatting"
              onClick={onClearFormatting}
              icon={<RemoveFormatting className="w-3.5 h-3.5" />}
            />

            {onGetSelectedText && onApplyAiText && (
              <>
                <div className="w-px h-4 bg-neutral-200 dark:bg-white/10 mx-0.5 shrink-0" />
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={handleOpenAiProofread}
                  title="Improve spelling & grammar with Groq AI"
                  aria-label="Fix spelling and grammar with Groq AI"
                  className="h-7 px-2 rounded-lg flex items-center gap-1 text-[12px] font-medium text-blue-600 dark:text-blue-400 hover:bg-blue-600/10 dark:hover:bg-blue-500/15 transition-colors cursor-pointer whitespace-nowrap shrink-0"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>Fix AI</span>
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}

function FormatButton({
  active,
  title,
  ariaLabel,
  icon,
  onClick,
}: {
  active: boolean;
  title: string;
  ariaLabel: string;
  icon: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      title={title}
      aria-label={ariaLabel}
      aria-pressed={active}
      className={`w-7 h-7 rounded-lg flex items-center justify-center transition-colors cursor-pointer shrink-0 ${
        active
          ? 'bg-blue-600/15 dark:bg-blue-500/25 text-blue-600 dark:text-blue-400'
          : 'text-neutral-600 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-white/[0.08] hover:text-neutral-950 dark:hover:text-white'
      }`}
    >
      {icon}
    </button>
  );
}
