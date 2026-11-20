import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  AlertCircle,
  Bot,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronRight,
  Clock,
  Code2,
  Copy,
  Eye,
  FileCode2,
  FilePlus2,
  FolderPlus,
  History,
  ListChecks,
  Loader2,
  Play,
  Plus,
  RotateCcw,
  Send,
  Sparkles,
  Trash2,
  Undo2,
  Wrench,
  X,
  Zap,
} from 'lucide-react';
import {
  buildLoadedProjectTreeSummary,
  CodeAgentChatTurn,
  CodeAgentEditHunk,
  CodeAgentFileOperation,
  CodeAgentHistorySession,
  CodeAgentMessage,
  CodeAgentMode,
  CodeAgentModelOption,
  CodeAgentPlanStep,
  CodeAgentRelatedFile,
  CodeAgentTargetAction,
  CodeAgentTaskMode,
  FALLBACK_CODE_AGENT_MODELS,
  fetchCodeAgentModels,
  findCandidateRelatedFiles,
  loadActiveCodeAgentSessionId,
  loadCodeAgentSessions,
  loadPreferredAgentMode,
  loadSavedCodeAgentModel,
  requestCodeAgent,
  resolvePosixWorkspacePath,
  saveActiveCodeAgentSessionId,
  saveCodeAgentSessions,
  savePreferredAgentMode,
  savePreferredCodeAgentModel,
  TrackedFileChange,
} from '../utils/codeAgentClient';
import { formatRelativeDate } from '../utils/markdown';
import { highlightCodeToHtml } from '../utils/codeHighlight';
import {
  DraggedRemoteEntry,
  getFileIconColorClass,
  REMOTE_ENTRY_DRAG_MIME,
  RemoteDirEntry,
  RemoteFilePreview,
} from './ProjectTreeView';

interface DroppedContextFile {
  id: string;
  path: string;
  name: string;
  isDirectory?: boolean;
  content?: string;
  loading?: boolean;
  error?: string;
  source: 'remote' | 'local';
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
  trackedChanges: TrackedFileChange[];
  applyingTrackedChanges?: boolean;
  onReadRemoteFile?: (filePath: string) => Promise<RemoteFilePreview>;
  onStageFileOperations: (
    operations: CodeAgentFileOperation[],
    turnId: string,
    summary?: string
  ) => Promise<void>;
  onReviewTrackedChange: (change: TrackedFileChange) => void;
  onAcceptTrackedChange: (changeId: string) => Promise<void>;
  onRejectTrackedChange: (changeId: string) => void;
  onAcceptAllTrackedChanges: () => Promise<void>;
  onRejectAllTrackedChanges: () => void;
  onStageInlineDiff: (payload: StagedDiffPayload) => void;
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
      'Find any bugs, edge cases, error-handling gaps, or race conditions across this file and related files and propose targeted fixes.',
  },
  {
    id: 'refactor',
    label: 'Refactor',
    prompt:
      'Refactor this code cleanly without rewriting unchanged lines, updating any related imports or callers if needed.',
  },
  {
    id: 'types',
    label: 'Add Types',
    prompt: 'Add strict type annotations and concise doc comments where helpful.',
  },
  {
    id: 'tests',
    label: 'Write Tests',
    prompt: 'Create practical unit tests in an appropriate test file for this code.',
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
    label: 'Scaffold Feature',
    prompt:
      'Propose any new folders, modules, or helper scripts suited to this project structure.',
  },
];

function createEmptySession(rootPath: string, mode: CodeAgentMode): CodeAgentHistorySession {
  const now = Date.now();
  return {
    id: `sess-${now}-${Math.random().toString(36).slice(2, 7)}`,
    title: 'New Agent Chat',
    rootPath: rootPath || '/',
    mode,
    createdAt: now,
    updatedAt: now,
    messages: [],
  };
}

function summarizeTurnTitle(text: string): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (!clean) return 'Agent Chat';
  return clean.length > 52 ? `${clean.slice(0, 49)}...` : clean;
}

function PlanStepsCard({
  steps,
  summary,
  executed,
  loading,
  onExecutePlan,
}: {
  steps: CodeAgentPlanStep[];
  summary?: string;
  executed?: boolean;
  loading: boolean;
  onExecutePlan: () => void;
}) {
  const [expanded, setExpanded] = useState(true);

  return (
    <div className="mt-2.5 rounded-lg border border-blue-500/30 bg-[#0d111a] overflow-hidden">
      <div className="px-2.5 py-1.5 bg-blue-500/12 border-b border-blue-500/20 flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => setExpanded((p) => !p)}
          className="min-w-0 flex items-center gap-1.5 text-left text-[11.5px] font-semibold text-blue-200 hover:text-white cursor-pointer"
        >
          {expanded ? (
            <ChevronDown className="w-3.5 h-3.5 shrink-0" />
          ) : (
            <ChevronRight className="w-3.5 h-3.5 shrink-0" />
          )}
          <ListChecks className="w-3.5 h-3.5 text-blue-400 shrink-0" />
          <span className="truncate">{summary || 'Implementation Plan'}</span>
          <span className="text-[10.5px] text-blue-300/75 tabular-nums shrink-0">
            · {steps.length} {steps.length === 1 ? 'step' : 'steps'}
          </span>
        </button>
      </div>

      {expanded && (
        <div className="p-2.5 space-y-2 text-[11.5px]">
          {steps.map((step, idx) => (
            <div
              key={idx}
              className="flex items-start gap-2 rounded-md border border-white/[0.06] bg-[#121622] px-2.5 py-1.5"
            >
              <span className="mt-0.5 w-4 h-4 rounded-full bg-blue-500/20 text-blue-300 text-[10px] font-semibold flex items-center justify-center shrink-0 tabular-nums">
                {idx + 1}
              </span>
              <div className="min-w-0 flex-1 space-y-0.5">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="font-medium text-neutral-100">{step.title}</span>
                  <span
                    className={`px-1.5 py-px rounded text-[9.5px] font-mono-code uppercase ${
                      step.action === 'create-dir'
                        ? 'bg-sky-500/15 text-sky-300'
                        : step.action === 'create-file'
                        ? 'bg-emerald-500/15 text-emerald-300'
                        : step.action === 'verify'
                        ? 'bg-purple-500/15 text-purple-300'
                        : 'bg-amber-500/15 text-amber-300'
                    }`}
                  >
                    {step.action}
                  </span>
                </div>
                {step.targetPath && (
                  <div className="font-mono-code text-[10.5px] text-blue-300/90 truncate">
                    {step.targetPath}
                  </div>
                )}
                {step.description && step.description !== step.title && (
                  <p className="text-[11px] text-neutral-400 leading-snug">{step.description}</p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="px-2.5 py-1.5 border-t border-blue-500/20 bg-[#111521] flex items-center justify-between gap-2">
        {executed ? (
          <span className="inline-flex items-center gap-1 text-[11px] text-emerald-400 font-medium">
            <Check className="w-3.5 h-3.5" />
            <span>Plan executed</span>
          </span>
        ) : (
          <span className="text-[10.5px] text-neutral-400">
            Review plan or execute to stage changes
          </span>
        )}
        <button
          type="button"
          disabled={loading}
          onClick={onExecutePlan}
          className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-blue-600 hover:bg-blue-700 disabled:opacity-45 text-white text-[11px] font-medium cursor-pointer shrink-0"
        >
          <Play className="w-3 h-3" />
          <span>{executed ? 'Re-run Plan' : 'Execute Plan'}</span>
        </button>
      </div>
    </div>
  );
}

function MultiFileOperationsCard({
  turnId,
  operations,
  summary,
  rootPath,
  trackedChanges,
  applying,
  onReviewTrackedChange,
  onAcceptTrackedChange,
  onRejectTrackedChange,
  onRestageTurn,
}: {
  turnId: string;
  operations: CodeAgentFileOperation[];
  summary?: string;
  rootPath: string;
  trackedChanges: TrackedFileChange[];
  applying: boolean;
  onReviewTrackedChange: (change: TrackedFileChange) => void;
  onAcceptTrackedChange: (changeId: string) => Promise<void>;
  onRejectTrackedChange: (changeId: string) => void;
  onRestageTurn: () => void;
}) {
  const [expanded, setExpanded] = useState(true);

  const trackedForTurn = useMemo(
    () => trackedChanges.filter((c) => c.turnId === turnId),
    [trackedChanges, turnId]
  );

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
          <span className="truncate">{summary || 'Workspace Changes'}</span>
          <span className="text-[10.5px] text-neutral-500 tabular-nums shrink-0">
            · {operations.length} {operations.length === 1 ? 'item' : 'items'}
          </span>
        </button>

        {trackedForTurn.length === 0 && (
          <button
            type="button"
            onClick={onRestageTurn}
            className="text-[10.5px] text-blue-300 hover:text-white cursor-pointer shrink-0"
          >
            Stage Again
          </button>
        )}
      </div>

      {expanded && (
        <div className="divide-y divide-white/[0.06]">
          {operations.map((op, idx) => {
            const resolvedPath = resolvePosixWorkspacePath(rootPath || '/', op.path);
            const tracked =
              trackedForTurn.find((t) => t.path === resolvedPath) ||
              trackedChanges.find((t) => t.path === resolvedPath && t.turnId === turnId);
            const fileName = op.path.split('/').filter(Boolean).pop() || op.path;

            return (
              <div key={`${turnId}-op-${idx}`} className="px-2.5 py-2 space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0 flex items-center gap-1.5">
                    {op.operation === 'create-dir' ? (
                      <FolderPlus className="w-3.5 h-3.5 text-sky-400 shrink-0" />
                    ) : op.operation === 'create-file' ? (
                      <FilePlus2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                    ) : (
                      <FileCode2 className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                    )}
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono-code text-[11.5px] font-medium text-neutral-100 truncate">
                          {fileName}
                        </span>
                        <span
                          className={`px-1 py-px rounded text-[9.5px] font-mono-code uppercase ${
                            op.operation === 'create-dir'
                              ? 'bg-sky-500/15 text-sky-300'
                              : op.operation === 'create-file'
                              ? 'bg-emerald-500/15 text-emerald-300'
                              : 'bg-amber-500/15 text-amber-300'
                          }`}
                        >
                          {op.operation === 'create-dir'
                            ? 'NEW DIR'
                            : op.operation === 'create-file'
                            ? 'NEW FILE'
                            : `${op.edits?.length || 1} EDIT`}
                        </span>
                      </div>
                      <div className="font-mono-code text-[10px] text-neutral-500 truncate">
                        {resolvedPath || op.path}
                      </div>
                    </div>
                  </div>

                  {tracked && (
                    <div className="flex items-center gap-1 shrink-0">
                      {tracked.status === 'pending' ? (
                        <>
                          {tracked.operation !== 'create-dir' && (
                            <button
                              type="button"
                              onClick={() => onReviewTrackedChange(tracked)}
                              title="Open & review highlighted diff in editor"
                              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-blue-500/40 bg-blue-500/15 hover:bg-blue-500/25 text-blue-200 text-[10.5px] cursor-pointer"
                            >
                              <Eye className="w-3 h-3" />
                              <span>Review</span>
                            </button>
                          )}
                          <button
                            type="button"
                            disabled={applying}
                            onClick={() => void onAcceptTrackedChange(tracked.id)}
                            title="Accept and save this change"
                            className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-emerald-600 hover:bg-emerald-700 disabled:opacity-45 text-white text-[10.5px] font-medium cursor-pointer"
                          >
                            <Check className="w-3 h-3" />
                            <span>Accept</span>
                          </button>
                          <button
                            type="button"
                            disabled={applying}
                            onClick={() => onRejectTrackedChange(tracked.id)}
                            title="Reject this change"
                            className="p-0.5 rounded border border-white/12 text-neutral-400 hover:text-white hover:bg-white/10 cursor-pointer"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </>
                      ) : tracked.status === 'accepted' ? (
                        <span className="inline-flex items-center gap-1 text-[10.5px] text-emerald-400 font-medium">
                          <Check className="w-3 h-3" />
                          <span>Accepted</span>
                        </span>
                      ) : (
                        <span className="text-[10.5px] text-neutral-500">Rejected</span>
                      )}
                    </div>
                  )}
                </div>

                {op.description && (
                  <div className="text-[10.5px] text-neutral-400">{op.description}</div>
                )}

                {op.operation === 'edit-file' && op.edits && op.edits.length > 0 && (
                  <div className="rounded border border-white/[0.06] overflow-hidden font-mono-code text-[10.5px] leading-[16px] max-h-32 overflow-y-auto">
                    {op.edits.slice(0, 2).map((e, eIdx) => (
                      <div key={eIdx}>
                        {e.oldCode && (
                          <pre className="m-0 px-2 py-0.5 bg-red-500/12 border-l-2 border-red-400/80 text-red-200/85 whitespace-pre-wrap break-words">
                            {e.oldCode}
                          </pre>
                        )}
                        <pre className="m-0 px-2 py-0.5 bg-emerald-500/14 border-l-2 border-emerald-400 text-emerald-200 whitespace-pre-wrap break-words">
                          {e.newCode}
                        </pre>
                      </div>
                    ))}
                    {op.edits.length > 2 && (
                      <div className="px-2 py-0.5 text-[10px] font-sans text-neutral-400 bg-[#121218]">
                        +{op.edits.length - 2} more edit blocks (click Review to view all)
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
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
    return resolvePosixWorkspacePath(currentRemotePath || '/', candidateName);
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
  trackedChanges,
  applyingTrackedChanges = false,
  onReadRemoteFile,
  onStageFileOperations,
  onReviewTrackedChange,
  onAcceptTrackedChange,
  onRejectTrackedChange,
  onAcceptAllTrackedChanges,
  onRejectAllTrackedChanges,
  onStageInlineDiff,
  onApplyCode,
  onCreateFileWithCode,
  onUndoLastEdit,
  onCopyText,
  onClose,
}: CodeAgentPanelProps) {
  const [models, setModels] = useState<CodeAgentModelOption[]>(FALLBACK_CODE_AGENT_MODELS.models);
  const [selectedModel, setSelectedModel] = useState<string>(() => loadSavedCodeAgentModel());
  const [agentMode, setAgentMode] = useState<CodeAgentMode>(() => loadPreferredAgentMode());

  // Persistent session history
  const [sessions, setSessions] = useState<CodeAgentHistorySession[]>(() => {
    const loaded = loadCodeAgentSessions();
    if (loaded.length > 0) return loaded;
    return [createEmptySession(currentRemotePath || '/', loadPreferredAgentMode())];
  });
  const [activeSessionId, setActiveSessionId] = useState<string>(() => {
    const savedId = loadActiveCodeAgentSessionId();
    const loaded = loadCodeAgentSessions();
    if (savedId && loaded.some((s) => s.id === savedId)) return savedId;
    if (loaded.length > 0) return loaded[0].id;
    return '';
  });
  const [historyDrawerOpen, setHistoryDrawerOpen] = useState(false);
  const [trackedExpanded, setTrackedExpanded] = useState(true);

  const [promptInput, setPromptInput] = useState('');
  const [scopeToSelection, setScopeToSelection] = useState(true);
  const [loading, setLoading] = useState(false);
  const [loadingStatus, setLoadingStatus] = useState('Analyzing code...');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [lastAppliedTurnId, setLastAppliedTurnId] = useState<string | null>(null);
  const [attachedFiles, setAttachedFiles] = useState<DroppedContextFile[]>([]);
  const [isDragOver, setIsDragOver] = useState(false);

  const dragDepthRef = useRef(0);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const promptInputRef = useRef<HTMLTextAreaElement>(null);

  // Ensure activeSessionId always points to an existing session
  const activeSession = useMemo(() => {
    return sessions.find((s) => s.id === activeSessionId) || sessions[0];
  }, [sessions, activeSessionId]);

  useEffect(() => {
    if (activeSession && activeSession.id !== activeSessionId) {
      setActiveSessionId(activeSession.id);
    }
  }, [activeSession, activeSessionId]);

  useEffect(() => {
    saveCodeAgentSessions(sessions);
  }, [sessions]);

  useEffect(() => {
    if (activeSession?.id) {
      saveActiveCodeAgentSessionId(activeSession.id);
    }
  }, [activeSession?.id]);

  const messages = activeSession?.messages ?? [];

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
  }, [messages.length, loading]);

  const projectTreeSummary = useMemo(
    () =>
      buildLoadedProjectTreeSummary(
        currentRemotePath || (file ? file.path.split('/').slice(0, -1).join('/') || '/' : '/'),
        dirCache,
        expandedDirs
      ),
    [currentRemotePath, file, dirCache, expandedDirs]
  );

  const pendingTracked = useMemo(
    () => trackedChanges.filter((c) => c.status === 'pending'),
    [trackedChanges]
  );

  const updateActiveSession = useCallback(
    (updater: (session: CodeAgentHistorySession) => CodeAgentHistorySession) => {
      const targetId = activeSession?.id;
      setSessions((prev) => {
        const idx = prev.findIndex((s) => s.id === targetId);
        if (idx === -1) {
          const created = updater(createEmptySession(currentRemotePath || '/', agentMode));
          return [created, ...prev];
        }
        const updated = updater(prev[idx]);
        const next = [...prev];
        next[idx] = updated;
        return next;
      });
    },
    [activeSession?.id, currentRemotePath, agentMode]
  );

  const handleNewChat = useCallback(() => {
    const fresh = createEmptySession(currentRemotePath || '/', agentMode);
    setSessions((prev) => [fresh, ...prev.slice(0, 29)]);
    setActiveSessionId(fresh.id);
    setHistoryDrawerOpen(false);
    setErrorMsg(null);
    setLastAppliedTurnId(null);
  }, [currentRemotePath, agentMode]);

  const handleDeleteSession = useCallback(
    (sessionId: string) => {
      setSessions((prev) => {
        const filtered = prev.filter((s) => s.id !== sessionId);
        if (filtered.length === 0) {
          const fresh = createEmptySession(currentRemotePath || '/', agentMode);
          setActiveSessionId(fresh.id);
          return [fresh];
        }
        if (activeSession?.id === sessionId) {
          setActiveSessionId(filtered[0].id);
        }
        return filtered;
      });
    },
    [activeSession?.id, currentRemotePath, agentMode]
  );

  const gatherRelatedFiles = useCallback(
    async (paths: string[], existingMap: Map<string, string>) => {
      if (!onReadRemoteFile || paths.length === 0) return;
      const root = currentRemotePath || (file ? file.path.split('/').slice(0, -1).join('/') || '/' : '/');
      await Promise.all(
        paths.slice(0, 6).map(async (rawPath) => {
          const abs = resolvePosixWorkspacePath(root, rawPath);
          if (!abs || abs === file?.path || existingMap.has(abs)) return;
          try {
            const loaded = await onReadRemoteFile(abs);
            if (!loaded.isBinary && loaded.content) {
              existingMap.set(loaded.path || abs, loaded.content.slice(0, 14000));
            }
          } catch {
            // ignore missing/unreadable optional context file
          }
        })
      );
    },
    [onReadRemoteFile, currentRemotePath, file?.path]
  );

  const handleSend = useCallback(
    async (
      overridePrompt?: string,
      taskMode: CodeAgentTaskMode = 'chat',
      modeOverride?: CodeAgentMode,
      planTurnIdToMark?: string
    ) => {
      const text = (overridePrompt ?? promptInput).trim();
      if (!text || loading) return;

      const validAttached = attachedFiles.filter(
        (item) => !item.error && !item.loading && typeof item.content === 'string'
      );
      const attachedMeta = attachedFiles
        .filter((item) => !item.error)
        .map((item) => ({ name: item.name, path: item.path }));

      const effectiveMode = modeOverride ?? agentMode;
      const userTurnId = `u-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const historyPayload: CodeAgentMessage[] = messages.slice(-12).map((m) => {
        let content = m.content;
        if (m.attachedFiles && m.attachedFiles.length > 0) {
          content = `[Attached files: ${m.attachedFiles.map((f) => f.path).join(', ')}]\n${content}`;
        }
        if (m.role === 'assistant' && m.fileOperations && m.fileOperations.length > 0) {
          const touched = m.fileOperations.map((o) => `${o.operation}:${o.path}`).join(', ');
          content = `${content}\n[Files touched: ${touched}]`;
        }
        return { role: m.role, content };
      });

      setErrorMsg(null);
      updateActiveSession((sess) => {
        const nextTitle =
          sess.messages.length === 0 ? summarizeTurnTitle(text) : sess.title;
        return {
          ...sess,
          title: nextTitle,
          rootPath: currentRemotePath || sess.rootPath,
          mode: effectiveMode,
          updatedAt: Date.now(),
          messages: [
            ...sess.messages.map((m) =>
              planTurnIdToMark && m.id === planTurnIdToMark ? { ...m, planExecuted: true } : m
            ),
            {
              id: userTurnId,
              role: 'user',
              content: text,
              createdAt: Date.now(),
              taskMode,
              agentMode: effectiveMode,
              attachedFiles: attachedMeta.length > 0 ? attachedMeta : undefined,
            },
          ],
        };
      });

      if (!overridePrompt) {
        setPromptInput('');
      }
      if (attachedMeta.length > 0) {
        setAttachedFiles([]);
      }
      setLoading(true);
      setLoadingStatus(
        effectiveMode === 'plan'
          ? 'Drafting workspace implementation plan...'
          : 'Reading related files & preparing changes...'
      );

      try {
        const activeSelection =
          scopeToSelection && selectedText.trim().length > 0 ? selectedText : undefined;

        // 1. Seed related files with explicitly dragged-and-dropped context files, then heuristic candidates
        const relatedMap = new Map<string, string>();
        for (const att of validAttached) {
          if (att.path && att.path !== file?.path && typeof att.content === 'string') {
            relatedMap.set(att.path, att.content.slice(0, 24000));
          }
        }
        const initialCandidates = findCandidateRelatedFiles(
          file?.path,
          file && !file.isBinary ? draft : undefined,
          text,
          dirCache,
          5
        );
        await gatherRelatedFiles(initialCandidates, relatedMap);

        const buildRelatedPayload = (): CodeAgentRelatedFile[] =>
          Array.from(relatedMap.entries()).map(([p, c]) => ({ path: p, content: c }));

        const promptWithAttachments =
          attachedMeta.length > 0
            ? `[User attached context files via drag & drop: ${attachedMeta
                .map((f) => f.path)
                .join(', ')}]\n\n${text}`
            : text;

        let res = await requestCodeAgent({
          prompt: promptWithAttachments,
          model: selectedModel,
          taskMode,
          agentMode: effectiveMode,
          filePath: file?.path,
          fileName: file?.name,
          language: file ? languageLabel : undefined,
          fileContent: file && !file.isBinary ? draft : undefined,
          selectedCode: activeSelection,
          selectionLineRange: activeSelection ? selectionRangeLabel || undefined : undefined,
          cursorLine: file ? cursorLine : undefined,
          rootPath: currentRemotePath || undefined,
          projectTree: projectTreeSummary || undefined,
          relatedFiles: buildRelatedPayload(),
          history: historyPayload,
        });

        // 2. If AI explicitly requests additional project files to inspect, read them via SSH and re-run once
        if (
          res.requestedFiles &&
          res.requestedFiles.length > 0 &&
          onReadRemoteFile &&
          (!res.fileOperations || res.fileOperations.length === 0) &&
          (!res.plan || res.plan.length === 0)
        ) {
          const prevSize = relatedMap.size;
          setLoadingStatus(
            `Reading ${res.requestedFiles.length} related file${
              res.requestedFiles.length === 1 ? '' : 's'
            }...`
          );
          await gatherRelatedFiles(res.requestedFiles, relatedMap);
          if (relatedMap.size > prevSize) {
            setLoadingStatus('Generating targeted updates across files...');
            res = await requestCodeAgent({
              prompt: promptWithAttachments,
              model: selectedModel,
              taskMode,
              agentMode: effectiveMode,
              filePath: file?.path,
              fileName: file?.name,
              language: file ? languageLabel : undefined,
              fileContent: file && !file.isBinary ? draft : undefined,
              selectedCode: activeSelection,
              selectionLineRange: activeSelection ? selectionRangeLabel || undefined : undefined,
              cursorLine: file ? cursorLine : undefined,
              rootPath: currentRemotePath || undefined,
              projectTree: projectTreeSummary || undefined,
              relatedFiles: buildRelatedPayload(),
              history: historyPayload,
            });
          }
        }

        const turnId = `a-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        const fileOps = res.fileOperations ?? [];

        const assistantTurn: CodeAgentChatTurn = {
          id: turnId,
          role: 'assistant',
          content: res.reply,
          createdAt: Date.now(),
          taskMode,
          agentMode: res.mode || effectiveMode,
          summary: res.summary,
          plan: res.plan,
          fileOperations: fileOps,
          edits: res.edits,
          proposedCode: res.proposedCode,
          targetAction: res.targetAction,
          suggestedFileName: res.suggestedFileName,
          model: res.model,
          provider: res.provider,
          fileNameHint: file?.name,
        };

        updateActiveSession((sess) => ({
          ...sess,
          updatedAt: Date.now(),
          messages: [...sess.messages, assistantTurn],
        }));

        // Stage multi-file operations (and/or inline diffs) when in Auto mode
        if (effectiveMode === 'auto') {
          if (fileOps.length > 0) {
            await onStageFileOperations(fileOps, turnId, res.summary);
          } else if (
            file &&
            isEditable &&
            res.targetAction !== 'create-file' &&
            res.targetAction !== 'none' &&
            ((res.edits && res.edits.length > 0) || Boolean(res.proposedCode))
          ) {
            onStageInlineDiff({
              edits: res.edits,
              proposedCode: res.proposedCode,
              targetAction: res.targetAction,
              summary: res.summary,
              turnId,
            });
          }
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
      agentMode,
      messages,
      updateActiveSession,
      currentRemotePath,
      scopeToSelection,
      selectedText,
      file,
      draft,
      dirCache,
      gatherRelatedFiles,
      selectedModel,
      languageLabel,
      selectionRangeLabel,
      cursorLine,
      projectTreeSummary,
      onReadRemoteFile,
      onStageFileOperations,
      isEditable,
      onStageInlineDiff,
      attachedFiles,
    ]
  );

  const attachRemoteEntry = useCallback(
    async (entry: DraggedRemoteEntry) => {
      const cleanPath = entry.path.trim();
      if (!cleanPath) return;
      const chipId = `att-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

      if (entry.isDirectory) {
        const cached = dirCache[cleanPath];
        const summaryContent =
          cached && cached.length > 0
            ? `Directory contents of ${cleanPath}:\n` +
              cached.map((c) => (c.isDirectory ? `${c.name}/` : c.name)).join('\n')
            : `Directory reference: ${cleanPath}`;
        setAttachedFiles((prev) => {
          const withoutDup = prev.filter((item) => item.path !== cleanPath);
          return [
            ...withoutDup,
            {
              id: chipId,
              path: cleanPath,
              name: `${entry.name}/`,
              isDirectory: true,
              content: summaryContent,
              loading: false,
              source: 'remote',
            },
          ];
        });
        return;
      }

      if (file && file.path === cleanPath && !file.isBinary) {
        setAttachedFiles((prev) => {
          const withoutDup = prev.filter((item) => item.path !== cleanPath);
          return [
            ...withoutDup,
            {
              id: chipId,
              path: cleanPath,
              name: entry.name || file.name,
              content: draft.slice(0, 24000),
              loading: false,
              source: 'remote',
            },
          ];
        });
        return;
      }

      setAttachedFiles((prev) => {
        const withoutDup = prev.filter((item) => item.path !== cleanPath);
        return [
          ...withoutDup,
          {
            id: chipId,
            path: cleanPath,
            name: entry.name || cleanPath.split('/').pop() || cleanPath,
            loading: Boolean(onReadRemoteFile),
            source: 'remote',
          },
        ];
      });

      if (!onReadRemoteFile) return;

      try {
        const loaded = await onReadRemoteFile(cleanPath);
        setAttachedFiles((prev) =>
          prev.map((item) =>
            item.id === chipId
              ? loaded.isBinary
                ? { ...item, loading: false, error: 'Binary file cannot be attached as text' }
                : { ...item, loading: false, content: (loaded.content || '').slice(0, 24000) }
              : item
          )
        );
      } catch (err) {
        setAttachedFiles((prev) =>
          prev.map((item) =>
            item.id === chipId
              ? {
                  ...item,
                  loading: false,
                  error: err instanceof Error ? err.message : 'Unable to read dropped file',
                }
              : item
          )
        );
      }
    },
    [dirCache, draft, file, onReadRemoteFile]
  );

  const handlePanelDragEnter = useCallback((e: React.DragEvent) => {
    const types = Array.from(e.dataTransfer?.types || []);
    const supported =
      types.includes(REMOTE_ENTRY_DRAG_MIME) ||
      types.includes('Files') ||
      types.includes('text/plain');
    if (!supported) return;
    e.preventDefault();
    dragDepthRef.current += 1;
    setIsDragOver(true);
  }, []);

  const handlePanelDragOver = useCallback((e: React.DragEvent) => {
    const types = Array.from(e.dataTransfer?.types || []);
    const supported =
      types.includes(REMOTE_ENTRY_DRAG_MIME) ||
      types.includes('Files') ||
      types.includes('text/plain');
    if (!supported) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    if (!isDragOver) setIsDragOver(true);
  }, [isDragOver]);

  const handlePanelDragLeave = useCallback(() => {
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) {
      setIsDragOver(false);
    }
  }, []);

  const handlePanelDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      dragDepthRef.current = 0;
      setIsDragOver(false);

      const rawRemote = e.dataTransfer.getData(REMOTE_ENTRY_DRAG_MIME);
      if (rawRemote) {
        try {
          const parsed = JSON.parse(rawRemote) as DraggedRemoteEntry;
          if (parsed && typeof parsed.path === 'string') {
            await attachRemoteEntry(parsed);
            promptInputRef.current?.focus();
            return;
          }
        } catch {
          // fall through to other drop formats
        }
      }

      const droppedLocalFiles = Array.from(e.dataTransfer.files || []).slice(0, 5);
      if (droppedLocalFiles.length > 0) {
        for (const localFile of droppedLocalFiles) {
          const chipId = `local-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
          if (localFile.size > 524288) {
            setAttachedFiles((prev) => [
              ...prev.filter((item) => item.name !== localFile.name),
              {
                id: chipId,
                path: localFile.name,
                name: localFile.name,
                error: 'File exceeds 512 KB attachment limit',
                source: 'local',
              },
            ]);
            continue;
          }
          try {
            const text = await localFile.text();
            if (text.slice(0, 1024).includes('\0')) {
              setAttachedFiles((prev) => [
                ...prev.filter((item) => item.name !== localFile.name),
                {
                  id: chipId,
                  path: localFile.name,
                  name: localFile.name,
                  error: 'Binary file cannot be attached as text',
                  source: 'local',
                },
              ]);
            } else {
              setAttachedFiles((prev) => [
                ...prev.filter((item) => item.name !== localFile.name),
                {
                  id: chipId,
                  path: localFile.name,
                  name: localFile.name,
                  content: text.slice(0, 24000),
                  source: 'local',
                },
              ]);
            }
          } catch {
            setAttachedFiles((prev) => [
              ...prev.filter((item) => item.name !== localFile.name),
              {
                id: chipId,
                path: localFile.name,
                name: localFile.name,
                error: 'Unable to read local file',
                source: 'local',
              },
            ]);
          }
        }
        promptInputRef.current?.focus();
        return;
      }

      const plainPath = e.dataTransfer.getData('text/plain').trim();
      if (plainPath && (plainPath.startsWith('/') || plainPath.startsWith('~/'))) {
        const name = plainPath.split('/').filter(Boolean).pop() || plainPath;
        await attachRemoteEntry({
          path: plainPath,
          name,
          isDirectory: false,
        });
        promptInputRef.current?.focus();
      }
    },
    [attachRemoteEntry]
  );

  const handleExecutePlan = useCallback(
    (turn: CodeAgentChatTurn) => {
      if (!turn.plan || turn.plan.length === 0) return;
      const stepsSummary = turn.plan
        .map(
          (s, i) =>
            `${i + 1}. [${s.action}] ${s.title}${s.targetPath ? ` (${s.targetPath})` : ''}: ${s.description}`
        )
        .join('\n');
      const execPrompt = `Execute the approved plan below across the workspace. Generate concrete fileOperations (create-dir, create-file, and targeted edit-file hunks for every affected file):\n\n${stepsSummary}`;
      void handleSend(execPrompt, 'implement', 'auto', turn.id);
    },
    [handleSend]
  );

  const quickActions = file && !file.isBinary ? FILE_QUICK_ACTIONS : WORKSPACE_QUICK_ACTIONS;

  return (
    <aside
      data-code-agent-panel="true"
      onDragEnter={handlePanelDragEnter}
      onDragOver={handlePanelDragOver}
      onDragLeave={handlePanelDragLeave}
      onDrop={(e) => void handlePanelDrop(e)}
      style={{ width: `${width}px` }}
      className="shrink-0 border-l border-white/[0.08] bg-[#121217] flex flex-col min-h-0 relative"
    >
      {isDragOver && (
        <div className="absolute inset-2 z-30 rounded-xl border-2 border-dashed border-blue-400/85 bg-blue-950/75 backdrop-blur-[2px] flex flex-col items-center justify-center gap-2 p-4 text-center pointer-events-none">
          <FileCode2 className="w-8 h-8 text-blue-300" />
          <p className="text-[13px] font-semibold text-white">Drop file to attach to AI Agent</p>
          <p className="text-[11.5px] text-blue-200/80">
            The file content will be added as context for your next prompt.
          </p>
        </div>
      )}
      {/* Header */}
      <div className="shrink-0 px-3 py-2 border-b border-white/[0.08] flex items-center justify-between gap-2 bg-[#14141b]">
        <div className="flex items-center gap-1.5 min-w-0">
          <Bot className="w-4 h-4 text-blue-400 shrink-0" />
          <span className="text-[12.5px] font-semibold text-white truncate">AI Code Agent</span>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={handleNewChat}
            title="Start new conversation"
            className="p-1 rounded text-neutral-400 hover:text-white hover:bg-white/10 cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => setHistoryDrawerOpen((p) => !p)}
            title="Conversation history"
            className={`p-1 rounded cursor-pointer ${
              historyDrawerOpen
                ? 'bg-blue-500/20 text-blue-300'
                : 'text-neutral-400 hover:text-white hover:bg-white/10'
            }`}
          >
            <History className="w-3.5 h-3.5" />
          </button>
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

      {/* History Drawer Overlay */}
      {historyDrawerOpen && (
        <div className="shrink-0 max-h-64 overflow-y-auto border-b border-white/12 bg-[#171720] px-2.5 py-2 space-y-1.5">
          <div className="flex items-center justify-between px-1">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-neutral-400">
              Saved Agent History ({sessions.length})
            </span>
            <button
              type="button"
              onClick={handleNewChat}
              className="inline-flex items-center gap-1 text-[11px] text-blue-300 hover:text-white cursor-pointer"
            >
              <Plus className="w-3 h-3" />
              <span>New Chat</span>
            </button>
          </div>
          {sessions.map((sess) => {
            const isActiveSess = sess.id === activeSession?.id;
            return (
              <div
                key={sess.id}
                className={`group flex items-center justify-between gap-2 px-2 py-1.5 rounded-lg border transition-colors ${
                  isActiveSess
                    ? 'border-blue-500/45 bg-blue-500/12'
                    : 'border-transparent hover:border-white/10 hover:bg-white/[0.04]'
                }`}
              >
                <button
                  type="button"
                  onClick={() => {
                    setActiveSessionId(sess.id);
                    setHistoryDrawerOpen(false);
                    setErrorMsg(null);
                  }}
                  className="min-w-0 flex-1 text-left cursor-pointer"
                >
                  <div className="text-[11.5px] font-medium text-neutral-100 truncate">
                    {sess.title}
                  </div>
                  <div className="flex items-center gap-1.5 text-[10px] text-neutral-500">
                    <Clock className="w-2.5 h-2.5 shrink-0" />
                    <span>{formatRelativeDate(sess.updatedAt)}</span>
                    <span>· {sess.messages.length} msgs</span>
                    <span className="uppercase">{sess.mode}</span>
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => handleDeleteSession(sess.id)}
                  title="Delete conversation"
                  className="p-1 rounded text-neutral-500 hover:text-red-400 opacity-0 group-hover:opacity-100 cursor-pointer shrink-0"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* Model & Plan/Auto Mode Context Bar */}
      <div className="shrink-0 px-3 py-2 border-b border-white/[0.08] bg-[#111116] space-y-1.5">
        <div className="flex items-center gap-1.5">
          <select
            id="code-agent-model"
            aria-label="AI model"
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

          {/* Plan vs Auto Segmented Switch */}
          <div
            role="group"
            aria-label="Agent execution mode"
            className="inline-flex rounded-md border border-white/12 bg-[#0c0c10] p-0.5 shrink-0"
          >
            <button
              type="button"
              onClick={() => {
                setAgentMode('plan');
                savePreferredAgentMode('plan');
              }}
              title="Plan mode: outline steps across files/folders before generating edits"
              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium transition-colors cursor-pointer ${
                agentMode === 'plan'
                  ? 'bg-blue-600 text-white'
                  : 'text-neutral-400 hover:text-white'
              }`}
            >
              <ListChecks className="w-3 h-3" />
              <span>Plan</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setAgentMode('auto');
                savePreferredAgentMode('auto');
              }}
              title="Auto mode: immediately generate multi-file changes, folders & new files for review"
              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium transition-colors cursor-pointer ${
                agentMode === 'auto'
                  ? 'bg-emerald-600 text-white'
                  : 'text-neutral-400 hover:text-white'
              }`}
            >
              <Zap className="w-3 h-3" />
              <span>Auto</span>
            </button>
          </div>
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

      {/* Persistent Multi-File Change Tracker Bar */}
      {trackedChanges.length > 0 && (
        <div className="shrink-0 border-b border-emerald-500/25 bg-[#10161d]">
          <div className="px-3 py-1.5 flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => setTrackedExpanded((p) => !p)}
              className="min-w-0 flex items-center gap-1.5 text-[11.5px] font-medium text-neutral-100 cursor-pointer"
            >
              {trackedExpanded ? (
                <ChevronDown className="w-3.5 h-3.5 text-neutral-400 shrink-0" />
              ) : (
                <ChevronRight className="w-3.5 h-3.5 text-neutral-400 shrink-0" />
              )}
              <span className="truncate">
                Tracked Changes ({pendingTracked.length} pending / {trackedChanges.length} total)
              </span>
            </button>

            {pendingTracked.length > 0 && (
              <div className="flex items-center gap-1 shrink-0">
                <button
                  type="button"
                  disabled={applyingTrackedChanges}
                  onClick={() => void onAcceptAllTrackedChanges()}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-600 hover:bg-emerald-700 disabled:opacity-45 text-white text-[10.5px] font-medium cursor-pointer"
                >
                  {applyingTrackedChanges ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : (
                    <CheckCheck className="w-3 h-3" />
                  )}
                  <span>Accept All</span>
                </button>
                <button
                  type="button"
                  disabled={applyingTrackedChanges}
                  onClick={onRejectAllTrackedChanges}
                  className="px-1.5 py-0.5 rounded border border-white/12 text-neutral-300 hover:bg-white/10 text-[10.5px] cursor-pointer"
                >
                  Clear
                </button>
              </div>
            )}
          </div>

          {trackedExpanded && (
            <div className="max-h-36 overflow-y-auto px-2.5 pb-2 space-y-1">
              {trackedChanges.map((item) => {
                const base = item.path.split('/').filter(Boolean).pop() || item.path;
                const isCurrentFile = file?.path === item.path;
                return (
                  <div
                    key={item.id}
                    className={`flex items-center justify-between gap-1.5 px-2 py-1 rounded border text-[11px] ${
                      isCurrentFile
                        ? 'border-blue-500/40 bg-blue-500/10'
                        : 'border-white/[0.06] bg-[#0c0c10]'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        if (item.operation !== 'create-dir') {
                          onReviewTrackedChange(item);
                        }
                      }}
                      title={item.path}
                      className={`min-w-0 flex-1 flex items-center gap-1.5 text-left ${
                        item.operation !== 'create-dir' ? 'cursor-pointer hover:text-white' : ''
                      }`}
                    >
                      {item.operation === 'create-dir' ? (
                        <FolderPlus className="w-3 h-3 text-sky-400 shrink-0" />
                      ) : item.operation === 'create-file' ? (
                        <FilePlus2 className="w-3 h-3 text-emerald-400 shrink-0" />
                      ) : (
                        <FileCode2 className="w-3 h-3 text-amber-400 shrink-0" />
                      )}
                      <span className="font-mono-code truncate text-neutral-200">{base}</span>
                      {item.operation === 'edit-file' && item.status === 'pending' && (
                        <span className="text-[10px] text-neutral-400 tabular-nums shrink-0">
                          ({item.hunks.length} {item.hunks.length === 1 ? 'hunk' : 'hunks'})
                        </span>
                      )}
                    </button>

                    <div className="flex items-center gap-1 shrink-0">
                      {item.status === 'pending' ? (
                        <>
                          {item.operation !== 'create-dir' && (
                            <button
                              type="button"
                              onClick={() => onReviewTrackedChange(item)}
                              title="Review inline diff in editor"
                              className="p-0.5 rounded text-blue-300 hover:bg-blue-500/20 cursor-pointer"
                            >
                              <Eye className="w-3 h-3" />
                            </button>
                          )}
                          <button
                            type="button"
                            disabled={applyingTrackedChanges}
                            onClick={() => void onAcceptTrackedChange(item.id)}
                            title="Accept and apply"
                            className="p-0.5 rounded text-emerald-400 hover:bg-emerald-500/20 cursor-pointer"
                          >
                            <Check className="w-3 h-3" />
                          </button>
                          <button
                            type="button"
                            disabled={applyingTrackedChanges}
                            onClick={() => onRejectTrackedChange(item.id)}
                            title="Reject"
                            className="p-0.5 rounded text-neutral-400 hover:text-red-300 hover:bg-red-500/15 cursor-pointer"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </>
                      ) : item.status === 'accepted' ? (
                        <span className="text-[10px] text-emerald-400 font-medium">Accepted</span>
                      ) : (
                        <span className="text-[10px] text-neutral-500">Rejected</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Scrollable Chat History */}
      <div ref={scrollContainerRef} className="flex-1 min-h-0 overflow-y-auto px-3 py-3 space-y-3">
        {messages.length === 0 ? (
          <div className="rounded-xl border border-white/[0.08] bg-[#16161d] p-3.5 space-y-2.5">
            <div className="flex items-center gap-2 text-[12.5px] font-medium text-white">
              <Wrench className="w-4 h-4 text-blue-400 shrink-0" />
              <span>Multi-File Code Development Agent</span>
            </div>
            <p className="text-[12px] text-neutral-400 leading-relaxed">
              Work across{' '}
              <span className="font-mono-code text-neutral-200">
                {file ? file.name : currentRemotePath || 'this workspace'}
              </span>{' '}
              and related project files. Drag and drop any file here to attach it as context, use{' '}
              <strong className="text-neutral-200">Plan</strong> to review a step-by-step
              architecture plan first, or <strong className="text-neutral-200">Auto</strong> to
              generate multi-file diffs, new folders, and new files directly.
            </p>
          </div>
        ) : (
          messages.map((msg) =>
            msg.role === 'user' ? (
              <div key={msg.id} className="flex justify-end">
                <div className="max-w-[90%] rounded-xl rounded-tr-sm bg-blue-600/20 border border-blue-500/30 px-3 py-2 text-[12.5px] text-neutral-100 whitespace-pre-wrap leading-relaxed space-y-1.5">
                  {msg.attachedFiles && msg.attachedFiles.length > 0 && (
                    <div className="flex flex-wrap gap-1 pb-1 border-b border-blue-400/20">
                      {msg.attachedFiles.map((att) => (
                        <span
                          key={att.path}
                          title={att.path}
                          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-blue-500/20 border border-blue-400/30 font-mono-code text-[10.5px] text-blue-100"
                        >
                          <FileCode2 className="w-3 h-3 text-blue-300 shrink-0" />
                          <span className="truncate max-w-[160px]">{att.name}</span>
                        </span>
                      ))}
                    </div>
                  )}
                  <div>{msg.content}</div>
                </div>
              </div>
            ) : (
              <div
                key={msg.id}
                className="rounded-xl border border-white/[0.08] bg-[#16161d] p-3 text-[12.5px] text-neutral-200"
              >
                <div className="flex items-center justify-between gap-2 mb-1.5 text-[11px] text-neutral-400">
                  <span className="inline-flex items-center gap-1.5 font-medium text-blue-300">
                    <Bot className="w-3.5 h-3.5" />
                    <span>Agent</span>
                    {msg.agentMode && (
                      <span
                        className={`px-1.5 py-px rounded text-[9.5px] uppercase ${
                          msg.agentMode === 'plan'
                            ? 'bg-blue-500/20 text-blue-300'
                            : 'bg-emerald-500/20 text-emerald-300'
                        }`}
                      >
                        {msg.agentMode}
                      </span>
                    )}
                  </span>
                  {msg.model && (
                    <span className="font-mono-code truncate max-w-[150px]">{msg.model}</span>
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

                {msg.plan && msg.plan.length > 0 && (
                  <PlanStepsCard
                    steps={msg.plan}
                    summary={msg.summary}
                    executed={msg.planExecuted}
                    loading={loading}
                    onExecutePlan={() => handleExecutePlan(msg)}
                  />
                )}

                {msg.fileOperations && msg.fileOperations.length > 0 && (
                  <MultiFileOperationsCard
                    turnId={msg.id}
                    operations={msg.fileOperations}
                    summary={msg.summary}
                    rootPath={currentRemotePath || '/'}
                    trackedChanges={trackedChanges}
                    applying={applyingTrackedChanges}
                    onReviewTrackedChange={onReviewTrackedChange}
                    onAcceptTrackedChange={onAcceptTrackedChange}
                    onRejectTrackedChange={onRejectTrackedChange}
                    onRestageTurn={() =>
                      void onStageFileOperations(msg.fileOperations || [], msg.id, msg.summary)
                    }
                  />
                )}

                {msg.proposedCode &&
                  (!msg.fileOperations || msg.fileOperations.length === 0) &&
                  (!msg.edits || msg.edits.length === 0) && (
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
            <span>{loadingStatus}</span>
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
                      void handleSend(
                        lastUser.content,
                        lastUser.taskMode || 'chat',
                        lastUser.agentMode
                      );
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
          {attachedFiles.length > 0 && (
            <div className="flex flex-wrap items-center gap-1 pb-1.5 border-b border-white/[0.08]">
              {attachedFiles.map((att) => (
                <div
                  key={att.id}
                  title={att.error ? `${att.path} — ${att.error}` : att.path}
                  className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md border text-[11px] max-w-full ${
                    att.error
                      ? 'border-red-500/40 bg-red-500/12 text-red-200'
                      : 'border-blue-500/35 bg-blue-500/12 text-blue-100'
                  }`}
                >
                  {att.loading ? (
                    <Loader2 className="w-3 h-3 animate-spin text-blue-300 shrink-0" />
                  ) : att.error ? (
                    <AlertCircle className="w-3 h-3 text-red-400 shrink-0" />
                  ) : (
                    <FileCode2
                      className={`w-3 h-3 shrink-0 ${
                        att.isDirectory ? 'text-sky-400' : getFileIconColorClass(att.name)
                      }`}
                    />
                  )}
                  <span className="font-mono-code truncate max-w-[160px]">{att.name}</span>
                  <button
                    type="button"
                    onClick={() =>
                      setAttachedFiles((prev) => prev.filter((item) => item.id !== att.id))
                    }
                    title={`Remove ${att.name}`}
                    className="p-0.5 rounded text-neutral-400 hover:text-white hover:bg-white/10 cursor-pointer shrink-0"
                  >
                    <X className="w-2.5 h-2.5" />
                  </button>
                </div>
              ))}
            </div>
          )}

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
              agentMode === 'plan'
                ? 'Describe your goal or drop files here — AI will draft a plan first...'
                : file
                ? `Ask AI about ${file.name} or drop files here to attach...`
                : 'Drag & drop files here or ask AI to create folders/files...'
            }
            aria-label="AI Code Agent prompt"
            className="w-full resize-none bg-transparent text-[12.5px] text-neutral-100 placeholder:text-neutral-500 focus:outline-none leading-relaxed"
          />
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10.5px] text-neutral-500">
              {agentMode === 'plan' ? 'Plan mode' : 'Auto mode'} · Drop files or Enter to send
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
              <span>{agentMode === 'plan' ? 'Plan' : 'Send'}</span>
            </button>
          </div>
        </form>
      </div>
    </aside>
  );
}
