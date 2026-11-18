import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  AlertCircle,
  Bot,
  Check,
  ChevronDown,
  ChevronRight,
  Code2,
  Copy,
  Eye,
  FileCode2,
  FilePlus2,
  Loader2,
  RotateCcw,
  Send,
  Sparkles,
  Trash2,
  Undo2,
  Wrench,
  X,
} from 'lucide-react';
import {
  buildLoadedProjectTreeSummary,
  CodeAgentEditHunk,
  CodeAgentMessage,
  CodeAgentModelOption,
  CodeAgentTargetAction,
  CodeAgentTaskMode,
  FALLBACK_CODE_AGENT_MODELS,
  fetchCodeAgentModels,
  loadSavedCodeAgentModel,
  requestCodeAgent,
  savePreferredCodeAgentModel,
} from '../utils/codeAgentClient';
import { highlightCodeToHtml } from '../utils/codeHighlight';
import type { RemoteDirEntry, RemoteFilePreview } from './ProjectTreeView';

interface ChatTurn {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  taskMode?: CodeAgentTaskMode;
  summary?: string;
  edits?: CodeAgentEditHunk[];
  proposedCode?: string | null;
  targetAction?: CodeAgentTargetAction;
  suggestedFileName?: string | null;
  model?: string;
  provider?: 'gemini' | 'groq';
  fileNameHint?: string;
}

export interface StagedDiffPayload {
  edits?: CodeAgentEditHunk[];
  proposedCode?: string | null;
  targetAction: CodeAgentTargetAction;
  summary?: string;
  turnId: string;
}

export interface CodeAgentPanelProps {
  width: number;
  file: RemoteFilePreview | null;
  draft: string;
  languageLabel: string;
  isEditable: boolean;
  cursorLine: number;
  selectedText: string;
  selectionRangeLabel: string | null;
  currentRemotePath: string;
  dirCache: Record<string, RemoteDirEntry[]>;
  expandedDirs: Record<string, boolean>;
  canUndo: boolean;
  pendingHunkCount: number;
  activeReviewTurnId: string | null;
  onStageInlineDiff: (payload: StagedDiffPayload) => void;
  onAcceptAllPendingDiffs: () => void;
  onRejectAllPendingDiffs: () => void;
  onFocusDiffReview: () => void;
  onApplyCode: (
    nextCode: string,
    mode: 'replace-file' | 'replace-selection' | 'insert-at-cursor'
  ) => void;
  onCreateFileWithCode: (fullPath: string, content: string) => void;
  onUndoLastEdit: () => void;
  onCopyText: (text: string) => Promise<boolean>;
  onClose: () => void;
}

const FILE_QUICK_ACTIONS: Array<{
  id: CodeAgentTaskMode;
  label: string;
  prompt: string;
}> = [
  {
    id: 'explain',
    label: 'Explain',
    prompt: 'Explain clearly what this code does, its control flow, and any subtle details.',
  },
  {
    id: 'fix',
    label: 'Find Bugs',
    prompt:
      'Find any bugs, edge cases, error-handling gaps, or race conditions and provide targeted edits for only the lines that need fixing.',
  },
  {
    id: 'refactor',
    label: 'Refactor',
    prompt:
      'Refactor this code to be cleaner and more maintainable using targeted edits without rewriting unchanged parts.',
  },
  {
    id: 'types',
    label: 'Add Types',
    prompt:
      'Add strict type annotations and concise doc comments using targeted edits where helpful.',
  },
  {
    id: 'tests',
    label: 'Write Tests',
    prompt: 'Write comprehensive unit tests covering normal behavior and edge cases for this code.',
  },
];

const WORKSPACE_QUICK_ACTIONS: Array<{
  id: CodeAgentTaskMode;
  label: string;
  prompt: string;
}> = [
  {
    id: 'explain',
    label: 'Explain Project',
    prompt:
      'Analyze the loaded project directory tree and explain the architecture, main folders, and how files fit together.',
  },
  {
    id: 'implement',
    label: 'New Script / Utility',
    prompt:
      'Create a useful helper script or module suited to this project structure and explain how to run it.',
  },
];

function joinRemotePath(baseDir: string, childName: string): string {
  const cleanChild = childName.trim().replace(/^\/+/, '');
  if (!cleanChild) return '';
  if (childName.trim().startsWith('/')) return childName.trim();
  const cleanBase = baseDir.replace(/\/+$/, '') || '/';
  return cleanBase === '/' ? `/${cleanChild}` : `${cleanBase}/${cleanChild}`;
}

function EditHunksSummaryCard({
  turnId,
  edits,
  summary,
  isEditable,
  isReviewingThisTurn,
  pendingHunkCount,
  onReviewInEditor,
  onAcceptAll,
  onRejectAll,
}: {
  turnId: string;
  edits: CodeAgentEditHunk[];
  summary?: string;
  isEditable: boolean;
  isReviewingThisTurn: boolean;
  pendingHunkCount: number;
  onReviewInEditor: () => void;
  onAcceptAll: () => void;
  onRejectAll: () => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const isActivePending = isReviewingThisTurn && pendingHunkCount > 0;

  return (
    <div className="mt-2.5 rounded-lg border border-white/12 bg-[#0b0b0f] overflow-hidden">
      <div className="px-2.5 py-1.5 bg-[#16161e] border-b border-white/[0.08] flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => setExpanded((p) => !p)}
          className="min-w-0 flex items-center gap-1.5 text-left text-[11.5px] font-medium text-neutral-200 hover:text-white cursor-pointer"
        >
          {expanded ? (
            <ChevronDown className="w-3.5 h-3.5 text-neutral-400 shrink-0" />
          ) : (
            <ChevronRight className="w-3.5 h-3.5 text-neutral-400 shrink-0" />
          )}
          <FileCode2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
          <span className="truncate">{summary || 'Targeted code changes'}</span>
          <span className="text-[10.5px] text-neutral-500 tabular-nums shrink-0">
            · {edits.length} {edits.length === 1 ? 'block' : 'blocks'}
          </span>
        </button>
      </div>

      {expanded && (
        <div className="max-h-56 overflow-auto divide-y divide-white/[0.06] font-mono-code text-[11px] leading-[17px]">
          {edits.map((edit, idx) => (
            <div key={`${turnId}-e-${idx}`} className="py-1.5">
              {edit.description && (
                <div className="px-2.5 pb-1 text-[10.5px] font-sans text-neutral-400">
                  {edit.description}
                </div>
              )}
              {edit.oldCode && (
                <pre className="m-0 px-2.5 py-0.5 bg-red-500/12 border-l-2 border-red-400/80 text-red-200/90 whitespace-pre-wrap break-words">
                  {edit.oldCode}
                </pre>
              )}
              <pre className="m-0 px-2.5 py-0.5 bg-emerald-500/14 border-l-2 border-emerald-400 text-emerald-200 whitespace-pre-wrap break-words">
                {edit.newCode}
              </pre>
            </div>
          ))}
        </div>
      )}

      {isEditable && (
        <div className="px-2.5 py-1.5 border-t border-white/[0.08] bg-[#13131a] flex flex-wrap items-center gap-1.5">
          {isActivePending ? (
            <>
              <button
                type="button"
                onClick={onAcceptAll}
                className="inline-flex items-center gap-1 px-2 py-1 rounded bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-medium cursor-pointer"
              >
                <Check className="w-3 h-3" />
                <span>Accept All ({pendingHunkCount})</span>
              </button>
              <button
                type="button"
                onClick={onRejectAll}
                className="inline-flex items-center gap-1 px-2 py-1 rounded border border-white/12 bg-white/5 hover:bg-white/10 text-neutral-200 text-[11px] font-medium cursor-pointer"
              >
                <X className="w-3 h-3" />
                <span>Reject</span>
              </button>
              <button
                type="button"
                onClick={onReviewInEditor}
                className="ml-auto inline-flex items-center gap-1 text-[11px] text-blue-300 hover:text-white cursor-pointer"
              >
                <Eye className="w-3 h-3" />
                <span>Highlighted in Editor</span>
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={onReviewInEditor}
              className="inline-flex items-center gap-1 px-2 py-1 rounded border border-blue-500/40 bg-blue-500/15 hover:bg-blue-500/25 text-blue-200 text-[11px] font-medium cursor-pointer"
            >
              <Eye className="w-3 h-3" />
              <span>Show Inline Diff Again</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function ProposedCodeCard({
  turnId,
  code,
  summary,
  targetAction,
  suggestedFileName,
  fallbackFileName,
  hasOpenFile,
  isEditable,
  hasSelection,
  currentRemotePath,
  isApplied,
  canUndo,
  onReviewDiff,
  onApplyCode,
  onCreateFileWithCode,
  onUndoLastEdit,
  onCopyText,
}: {
  turnId: string;
  code: string;
  summary?: string;
  targetAction: CodeAgentTargetAction;
  suggestedFileName?: string | null;
  fallbackFileName: string;
  hasOpenFile: boolean;
  isEditable: boolean;
  hasSelection: boolean;
  currentRemotePath: string;
  isApplied: boolean;
  canUndo: boolean;
  onReviewDiff: () => void;
  onApplyCode: (
    nextCode: string,
    mode: 'replace-file' | 'replace-selection' | 'insert-at-cursor',
    turnId: string
  ) => void;
  onCreateFileWithCode: (fullPath: string, content: string) => void;
  onUndoLastEdit: () => void;
  onCopyText: (text: string) => Promise<boolean>;
}) {
  const [expanded, setExpanded] = useState(true);
  const [copied, setCopied] = useState(false);
  const lineCount = useMemo(() => code.split('\n').length, [code]);
  const highlightName = suggestedFileName || fallbackFileName || 'code.ts';
  const highlightedHtml = useMemo(
    () => highlightCodeToHtml(code, highlightName),
    [code, highlightName]
  );

  const createTargetPath = useMemo(() => {
    const candidateName = suggestedFileName?.trim() || fallbackFileName || 'generated.ts';
    return joinRemotePath(currentRemotePath || '/', candidateName);
  }, [suggestedFileName, fallbackFileName, currentRemotePath]);

  return (
    <div className="mt-2.5 rounded-lg border border-white/12 bg-[#0b0b0f] overflow-hidden">
      <div className="px-2.5 py-1.5 bg-[#16161e] border-b border-white/[0.08] flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => setExpanded((p) => !p)}
          className="min-w-0 flex items-center gap-1.5 text-left text-[11.5px] font-medium text-neutral-200 hover:text-white cursor-pointer"
        >
          {expanded ? (
            <ChevronDown className="w-3.5 h-3.5 text-neutral-400 shrink-0" />
          ) : (
            <ChevronRight className="w-3.5 h-3.5 text-neutral-400 shrink-0" />
          )}
          <FileCode2 className="w-3.5 h-3.5 text-blue-400 shrink-0" />
          <span className="truncate">{summary || 'Proposed code'}</span>
          <span className="text-[10.5px] text-neutral-500 tabular-nums shrink-0">
            · {lineCount} lines
          </span>
        </button>

        <button
          type="button"
          onClick={async () => {
            const ok = await onCopyText(code);
            if (ok) {
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1500);
            }
          }}
          title="Copy proposed code"
          className="p-1 rounded text-neutral-400 hover:text-white hover:bg-white/10 cursor-pointer shrink-0"
        >
          {copied ? (
            <Check className="w-3.5 h-3.5 text-emerald-400" />
          ) : (
            <Copy className="w-3.5 h-3.5" />
          )}
        </button>
      </div>

      {expanded && (
        <pre
          style={{ tabSize: 2 }}
          className="code-highlight-layer m-0 p-2.5 max-h-56 overflow-auto text-[11.5px] leading-[18px] font-mono-code whitespace-pre bg-[#0b0b0f]"
          dangerouslySetInnerHTML={{ __html: highlightedHtml }}
        />
      )}

      <div className="px-2.5 py-1.5 border-t border-white/[0.08] bg-[#13131a] flex flex-wrap items-center gap-1.5">
        {hasOpenFile && isEditable && targetAction !== 'create-file' && (
          <>
            <button
              type="button"
              onClick={onReviewDiff}
              className="inline-flex items-center gap-1 px-2 py-1 rounded bg-blue-600 hover:bg-blue-700 text-white text-[11px] font-medium cursor-pointer"
            >
              <Eye className="w-3 h-3" />
              <span>Review in Editor</span>
            </button>

            {hasSelection && (
              <button
                type="button"
                onClick={() => onApplyCode(code, 'replace-selection', turnId)}
                className="px-2 py-1 rounded border border-white/12 bg-white/5 hover:bg-white/10 text-neutral-200 text-[11px] font-medium cursor-pointer"
              >
                Replace Selection
              </button>
            )}

            <button
              type="button"
              onClick={() => onApplyCode(code, 'insert-at-cursor', turnId)}
              className="px-2 py-1 rounded border border-white/12 bg-white/5 hover:bg-white/10 text-neutral-200 text-[11px] font-medium cursor-pointer"
            >
              Insert at Cursor
            </button>
          </>
        )}

        {(targetAction === 'create-file' || !hasOpenFile || suggestedFileName) &&
          createTargetPath && (
            <button
              type="button"
              onClick={() => onCreateFileWithCode(createTargetPath, code)}
              title={`Create ${createTargetPath} with this code`}
              className={`inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium cursor-pointer ${
                !hasOpenFile || targetAction === 'create-file'
                  ? 'bg-blue-600 hover:bg-blue-700 text-white'
                  : 'border border-white/12 bg-white/5 hover:bg-white/10 text-neutral-200'
              }`}
            >
              <FilePlus2 className="w-3 h-3" />
              <span className="truncate max-w-[160px]">
                Create {suggestedFileName || 'File'}
              </span>
            </button>
          )}

        {isApplied && (
          <div className="ml-auto flex items-center gap-1.5">
            <span className="inline-flex items-center gap-1 text-[11px] text-emerald-400 font-medium">
              <Sparkles className="w-3 h-3" />
              <span>Applied</span>
            </span>
            {canUndo && (
              <button
                type="button"
                onClick={onUndoLastEdit}
                title="Undo applied edit (Ctrl+Z)"
                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-white/15 text-neutral-200 hover:bg-white/10 text-[11px] cursor-pointer"
              >
                <Undo2 className="w-3 h-3" />
                <span>Undo</span>
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export function CodeAgentPanel({
  width,
  file,
  draft,
  languageLabel,
  isEditable,
  cursorLine,
  selectedText,
  selectionRangeLabel,
  currentRemotePath,
  dirCache,
  expandedDirs,
  canUndo,
  pendingHunkCount,
  activeReviewTurnId,
  onStageInlineDiff,
  onAcceptAllPendingDiffs,
  onRejectAllPendingDiffs,
  onFocusDiffReview,
  onApplyCode,
  onCreateFileWithCode,
  onUndoLastEdit,
  onCopyText,
  onClose,
}: CodeAgentPanelProps) {
  const [models, setModels] = useState<CodeAgentModelOption[]>(FALLBACK_CODE_AGENT_MODELS.models);
  const [selectedModel, setSelectedModel] = useState<string>(() => loadSavedCodeAgentModel());
  const [messages, setMessages] = useState<ChatTurn[]>([]);
  const [promptInput, setPromptInput] = useState('');
  const [scopeToSelection, setScopeToSelection] = useState(true);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [lastAppliedTurnId, setLastAppliedTurnId] = useState<string | null>(null);

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const promptInputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    let active = true;
    fetchCodeAgentModels().then((catalog) => {
      if (!active) return;
      setModels(catalog.models);
      setSelectedModel((cur) => {
        const currentMatch = catalog.models.find((m) => m.id === cur);
        if (currentMatch && currentMatch.available) return cur;
        return catalog.defaultModel || cur;
      });
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = scrollContainerRef.current.scrollHeight;
    }
  }, [messages, loading]);

  const projectTreeSummary = useMemo(
    () =>
      buildLoadedProjectTreeSummary(
        currentRemotePath || (file ? file.path.split('/').slice(0, -1).join('/') || '/' : '/'),
        dirCache,
        expandedDirs
      ),
    [currentRemotePath, file, dirCache, expandedDirs]
  );

  const handleSend = useCallback(
    async (overridePrompt?: string, taskMode: CodeAgentTaskMode = 'chat') => {
      const text = (overridePrompt ?? promptInput).trim();
      if (!text || loading) return;

      const userTurnId = `u-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const historyPayload: CodeAgentMessage[] = messages.slice(-10).map((m) => ({
        role: m.role,
        content: m.content,
      }));

      setErrorMsg(null);
      setMessages((prev) => [
        ...prev,
        {
          id: userTurnId,
          role: 'user',
          content: text,
          taskMode,
        },
      ]);
      if (!overridePrompt) {
        setPromptInput('');
      }
      setLoading(true);

      try {
        const activeSelection =
          scopeToSelection && selectedText.trim().length > 0 ? selectedText : undefined;

        const res = await requestCodeAgent({
          prompt: text,
          model: selectedModel,
          taskMode,
          filePath: file?.path,
          fileName: file?.name,
          language: file ? languageLabel : undefined,
          fileContent: file && !file.isBinary ? draft : undefined,
          selectedCode: activeSelection,
          selectionLineRange: activeSelection ? selectionRangeLabel || undefined : undefined,
          cursorLine: file ? cursorLine : undefined,
          rootPath: currentRemotePath || undefined,
          projectTree: projectTreeSummary || undefined,
          history: historyPayload,
        });

        const turnId = `a-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        const assistantTurn: ChatTurn = {
          id: turnId,
          role: 'assistant',
          content: res.reply,
          taskMode,
          summary: res.summary,
          edits: res.edits,
          proposedCode: res.proposedCode,
          targetAction: res.targetAction,
          suggestedFileName: res.suggestedFileName,
          model: res.model,
          provider: res.provider,
          fileNameHint: file?.name,
        };
        setMessages((prev) => [...prev, assistantTurn]);

        // Automatically stage targeted diff hunks or file edits into inline diff review
        const hasEdits = Boolean(res.edits && res.edits.length > 0);
        const isExistingFileEdit =
          file &&
          isEditable &&
          res.targetAction !== 'create-file' &&
          res.targetAction !== 'none' &&
          (hasEdits || Boolean(res.proposedCode));

        if (isExistingFileEdit) {
          onStageInlineDiff({
            edits: res.edits,
            proposedCode: res.proposedCode,
            targetAction: res.targetAction,
            summary: res.summary,
            turnId,
          });
        }
      } catch (err) {
        setErrorMsg(err instanceof Error ? err.message : 'AI Code Agent failed to respond.');
      } finally {
        setLoading(false);
      }
    },
    [
      promptInput,
      loading,
      messages,
      scopeToSelection,
      selectedText,
      selectedModel,
      file,
      isEditable,
      languageLabel,
      draft,
      selectionRangeLabel,
      cursorLine,
      currentRemotePath,
      projectTreeSummary,
      onStageInlineDiff,
    ]
  );

  const quickActions = file && !file.isBinary ? FILE_QUICK_ACTIONS : WORKSPACE_QUICK_ACTIONS;

  return (
    <aside
      data-code-agent-panel="true"
      style={{ width: `${width}px` }}
      className="shrink-0 border-l border-white/[0.08] bg-[#121217] flex flex-col min-h-0"
    >
      {/* Header */}
      <div className="shrink-0 px-3 py-2 border-b border-white/[0.08] flex items-center justify-between gap-2 bg-[#14141b]">
        <div className="flex items-center gap-1.5 min-w-0">
          <Bot className="w-4 h-4 text-blue-400 shrink-0" />
          <span className="text-[12.5px] font-semibold text-white truncate">AI Code Agent</span>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          {messages.length > 0 && (
            <button
              type="button"
              onClick={() => {
                setMessages([]);
                setErrorMsg(null);
                setLastAppliedTurnId(null);
              }}
              title="Clear conversation"
              className="p-1 rounded text-neutral-400 hover:text-white hover:bg-white/10 cursor-pointer"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            title="Hide AI Code Agent"
            className="p-1 rounded text-neutral-400 hover:text-white hover:bg-white/10 cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Model & Active Context Bar */}
      <div className="shrink-0 px-3 py-2 border-b border-white/[0.08] bg-[#111116] space-y-1.5">
        <div className="flex items-center gap-1.5">
          <label htmlFor="code-agent-model" className="text-[11px] text-neutral-400 shrink-0">
            Model:
          </label>
          <select
            id="code-agent-model"
            value={selectedModel}
            onChange={(e) => {
              const next = e.target.value;
              setSelectedModel(next);
              savePreferredCodeAgentModel(next);
            }}
            className="flex-1 min-w-0 px-2 py-1 rounded border border-white/12 bg-[#0c0c10] text-[11.5px] text-neutral-100 focus:outline-none focus:border-blue-500 cursor-pointer"
          >
            {models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
                {!m.available ? ' (Server key not set)' : ''}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center justify-between gap-2 text-[11px] text-neutral-400">
          <span className="font-mono-code truncate">
            {file
              ? `Context: ${file.name} · Ln ${cursorLine}`
              : `Context: ${currentRemotePath || 'Workspace'}`}
          </span>
          {selectedText.trim().length > 0 && (
            <label className="inline-flex items-center gap-1 text-blue-300 cursor-pointer shrink-0">
              <input
                type="checkbox"
                checked={scopeToSelection}
                onChange={(e) => setScopeToSelection(e.target.checked)}
                className="accent-blue-500 rounded"
              />
              <span>{selectionRangeLabel || 'Selection'}</span>
            </label>
          )}
        </div>
      </div>

      {/* Scrollable Chat History */}
      <div ref={scrollContainerRef} className="flex-1 min-h-0 overflow-y-auto px-3 py-3 space-y-3">
        {messages.length === 0 ? (
          <div className="rounded-xl border border-white/[0.08] bg-[#16161d] p-3.5 space-y-2.5">
            <div className="flex items-center gap-2 text-[12.5px] font-medium text-white">
              <Wrench className="w-4 h-4 text-blue-400 shrink-0" />
              <span>Code Development Assistant</span>
            </div>
            <p className="text-[12px] text-neutral-400 leading-relaxed">
              Ask questions about{' '}
              <span className="font-mono-code text-neutral-200">
                {file ? file.name : currentRemotePath || 'this workspace'}
              </span>
              . When updating code, the agent highlights only the changed lines directly under the
              old code so you can click to accept each line or block.
            </p>
          </div>
        ) : (
          messages.map((msg) =>
            msg.role === 'user' ? (
              <div key={msg.id} className="flex justify-end">
                <div className="max-w-[90%] rounded-xl rounded-tr-sm bg-blue-600/20 border border-blue-500/30 px-3 py-2 text-[12.5px] text-neutral-100 whitespace-pre-wrap leading-relaxed">
                  {msg.content}
                </div>
              </div>
            ) : (
              <div
                key={msg.id}
                className="rounded-xl border border-white/[0.08] bg-[#16161d] p-3 text-[12.5px] text-neutral-200"
              >
                <div className="flex items-center justify-between gap-2 mb-1.5 text-[11px] text-neutral-400">
                  <span className="inline-flex items-center gap-1 font-medium text-blue-300">
                    <Bot className="w-3.5 h-3.5" />
                    <span>Agent</span>
                  </span>
                  {msg.model && (
                    <span className="font-mono-code truncate max-w-[160px]">{msg.model}</span>
                  )}
                </div>

                <div className="space-y-2 leading-relaxed break-words">
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    components={{
                      p: ({ children }) => <p className="my-1.5 first:mt-0 last:mb-0">{children}</p>,
                      ul: ({ children }) => (
                        <ul className="my-1.5 pl-4 list-disc space-y-1">{children}</ul>
                      ),
                      ol: ({ children }) => (
                        <ol className="my-1.5 pl-4 list-decimal space-y-1">{children}</ol>
                      ),
                      h1: ({ children }) => (
                        <h3 className="text-[13.5px] font-semibold text-white mt-2 mb-1">
                          {children}
                        </h3>
                      ),
                      h2: ({ children }) => (
                        <h3 className="text-[13px] font-semibold text-white mt-2 mb-1">
                          {children}
                        </h3>
                      ),
                      h3: ({ children }) => (
                        <h4 className="text-[12.5px] font-semibold text-white mt-1.5 mb-0.5">
                          {children}
                        </h4>
                      ),
                      code: ({ className, children }) => {
                        const isBlock = Boolean(className && className.includes('language-'));
                        if (isBlock) {
                          return (
                            <code className="block font-mono-code text-[11.5px] text-neutral-100">
                              {children}
                            </code>
                          );
                        }
                        return (
                          <code className="font-mono-code text-[11.5px] px-1 py-0.5 rounded bg-white/10 text-blue-200">
                            {children}
                          </code>
                        );
                      },
                      pre: ({ children }) => (
                        <pre className="my-2 p-2.5 rounded-lg bg-[#0b0b0f] border border-white/10 overflow-x-auto text-[11.5px] font-mono-code">
                          {children}
                        </pre>
                      ),
                    }}
                  >
                    {msg.content}
                  </ReactMarkdown>
                </div>

                {msg.edits && msg.edits.length > 0 && (
                  <EditHunksSummaryCard
                    turnId={msg.id}
                    edits={msg.edits}
                    summary={msg.summary}
                    isEditable={isEditable}
                    isReviewingThisTurn={activeReviewTurnId === msg.id}
                    pendingHunkCount={pendingHunkCount}
                    onReviewInEditor={() => {
                      if (activeReviewTurnId === msg.id && pendingHunkCount > 0) {
                        onFocusDiffReview();
                      } else {
                        onStageInlineDiff({
                          edits: msg.edits,
                          proposedCode: msg.proposedCode,
                          targetAction: msg.targetAction || 'edit-hunks',
                          summary: msg.summary,
                          turnId: msg.id,
                        });
                      }
                    }}
                    onAcceptAll={onAcceptAllPendingDiffs}
                    onRejectAll={onRejectAllPendingDiffs}
                  />
                )}

                {msg.proposedCode && (!msg.edits || msg.edits.length === 0) && (
                  <ProposedCodeCard
                    turnId={msg.id}
                    code={msg.proposedCode}
                    summary={msg.summary}
                    targetAction={msg.targetAction || 'replace-file'}
                    suggestedFileName={msg.suggestedFileName}
                    fallbackFileName={msg.fileNameHint || file?.name || 'snippet.ts'}
                    hasOpenFile={Boolean(file && !file.isBinary)}
                    isEditable={isEditable}
                    hasSelection={selectedText.trim().length > 0}
                    currentRemotePath={currentRemotePath}
                    isApplied={lastAppliedTurnId === msg.id}
                    canUndo={canUndo}
                    onReviewDiff={() =>
                      onStageInlineDiff({
                        edits: msg.edits,
                        proposedCode: msg.proposedCode,
                        targetAction: msg.targetAction || 'replace-file',
                        summary: msg.summary,
                        turnId: msg.id,
                      })
                    }
                    onApplyCode={(nextCode, mode, tid) => {
                      setLastAppliedTurnId(tid);
                      onApplyCode(nextCode, mode);
                    }}
                    onCreateFileWithCode={onCreateFileWithCode}
                    onUndoLastEdit={onUndoLastEdit}
                    onCopyText={onCopyText}
                  />
                )}
              </div>
            )
          )
        )}

        {loading && (
          <div className="rounded-xl border border-white/[0.08] bg-[#16161d] px-3 py-2.5 flex items-center gap-2 text-[12px] text-neutral-300">
            <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-400 shrink-0" />
            <span>Analyzing code and preparing updates...</span>
          </div>
        )}

        {errorMsg && (
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-[12px] text-red-200 flex items-start gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-red-400" />
            <div className="flex-1 min-w-0 space-y-1">
              <div className="break-words">{errorMsg}</div>
              {messages.length > 0 && messages[messages.length - 1]?.role === 'user' && (
                <button
                  type="button"
                  onClick={() => {
                    const lastUser = [...messages].reverse().find((m) => m.role === 'user');
                    if (lastUser) {
                      void handleSend(lastUser.content, lastUser.taskMode || 'chat');
                    }
                  }}
                  className="inline-flex items-center gap-1 text-[11px] text-blue-300 hover:text-white cursor-pointer"
                >
                  <RotateCcw className="w-3 h-3" />
                  <span>Retry</span>
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Quick Dev Actions & Prompt Composer */}
      <div className="shrink-0 p-2.5 border-t border-white/[0.08] bg-[#14141b] space-y-2">
        <div className="flex items-center gap-1 overflow-x-auto pb-0.5">
          {quickActions.map((act) => (
            <button
              key={act.id}
              type="button"
              disabled={loading}
              onClick={() => void handleSend(act.prompt, act.id)}
              className="inline-flex items-center gap-1 px-2 py-1 rounded border border-white/10 bg-[#1a1a23] hover:bg-white/10 hover:border-blue-500/40 disabled:opacity-45 text-[11px] text-neutral-200 whitespace-nowrap cursor-pointer shrink-0 transition-colors"
            >
              <Code2 className="w-3 h-3 text-blue-400" />
              <span>{act.label}</span>
            </button>
          ))}
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            void handleSend(undefined, 'chat');
          }}
          className="rounded-lg border border-white/12 bg-[#0c0c10] focus-within:border-blue-500 transition-colors p-2 space-y-1.5"
        >
          <textarea
            ref={promptInputRef}
            rows={3}
            value={promptInput}
            onChange={(e) => setPromptInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void handleSend(undefined, 'chat');
              }
            }}
            placeholder={
              file
                ? `Ask AI to edit, debug, or explain ${file.name}...`
                : 'Ask AI about this project or generate a new file...'
            }
            aria-label="AI Code Agent prompt"
            className="w-full resize-none bg-transparent text-[12.5px] text-neutral-100 placeholder:text-neutral-500 focus:outline-none leading-relaxed"
          />
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10.5px] text-neutral-500">
              Enter to send · Shift+Enter newline
            </span>
            <button
              type="submit"
              disabled={loading || !promptInput.trim()}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white text-[11.5px] font-medium cursor-pointer"
            >
              {loading ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Send className="w-3.5 h-3.5" />
              )}
              <span>Ask Agent</span>
            </button>
          </div>
        </form>
      </div>
    </aside>
  );
}
