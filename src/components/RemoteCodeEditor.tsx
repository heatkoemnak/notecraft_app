import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Bot,
  Check,
  ChevronDown,
  ChevronsDownUp,
  ChevronUp,
  ClipboardPaste,
  Copy,
  FilePlus2,
  Files,
  FileText,
  FolderOpen,
  GitBranch,
  GitCommitHorizontal,
  Hash,
  Loader2,
  Maximize2,
  MessageSquare,
  Minimize2,
  PanelLeftOpen,
  Plus,
  RefreshCw,
  Replace,
  Save,
  Scissors,
  Search,
  Trash2,
  Wand2,
  X,
} from 'lucide-react';
import {
  CodeAgentFileOperation,
  resolvePosixWorkspacePath,
  TrackedFileChange,
} from '../utils/codeAgentClient';
import {
  acceptSingleLineInHunk,
  applyAllDiffHunks,
  applySingleDiffHunk,
  buildHunksFromSearchReplace,
  computeLineDiffHunks,
  PendingDiffHunk,
} from '../utils/codeDiff';
import {
  applyAutoRenameTag,
  applyMultiRangeEdit,
  deleteSelectedLines,
  duplicateSelectedLines,
  EditResult,
  expandWordAtOffset,
  findAllTextMatches,
  formatSelectionRangeAsync,
  formatSourceDocumentAsync,
  getOffsetForLineCol,
  indentLines,
  moveSelectedLines,
  smartNewLineIndent,
  TextMatchRange,
  toggleCommentLines,
} from '../utils/codeEditing';
import { escapeHtml, highlightCodeToHtml } from '../utils/codeHighlight';
import {
  getGitBadgeMeta,
  GitCommandRunner,
  GitCommitInfo,
  GitFileChange,
  GitStatusSnapshot,
} from '../utils/gitClient';
import { CodeAgentPanel, StagedDiffPayload } from './CodeAgentPanel';
import { GitSourceControlPanel } from './GitSourceControlPanel';
import {
  DraggedRemoteEntry,
  getFileIconColorClass,
  ProjectTreeView,
  REMOTE_ENTRY_DRAG_MIME,
  RemoteDirEntry,
  RemoteFilePreview,
} from './ProjectTreeView';
import { RemotePathInput } from './RemotePathInput';

export type { RemoteDirEntry, RemoteFilePreview };

interface TabPreservedState {
  draft: string;
  savedContent: string;
  history: {
    stack: HistorySnapshot[];
    index: number;
    lastInputAt: number;
  };
  cursorPos: { line: number; col: number };
  selectionRange: { start: number; end: number };
  scrollTop: number;
}

interface HistorySnapshot {
  value: string;
  selectionStart: number;
  selectionEnd: number;
}

interface RemoteCodeEditorProps {
  file: RemoteFilePreview | null;
  openFiles: RemoteFilePreview[];
  fullScreen: boolean;
  saving: boolean;
  saveError: string | null;
  dirError?: string | null;
  fileLoading?: boolean;
  lastSavedAt: number | null;
  currentRemotePath: string;
  dirCache: Record<string, RemoteDirEntry[]>;
  expandedDirs: Record<string, boolean>;
  loadingDirs: Record<string, boolean>;
  truncatedDirs: Record<string, boolean>;
  onToggleFullScreen: (next: boolean) => void;
  onCloseFile: () => void;
  onSelectTab: (path: string) => void;
  onCloseTab: (path: string) => void;
  onSaveFile: (path: string, nextContent: string) => void;
  onSaveAsFile: (targetPath: string, nextContent: string) => void;
  onReloadFile: (path: string) => void;
  onToggleDir: (dirPath: string) => void;
  onNavigateRootDir: (dirPath: string) => void;
  onCollapseAllDirs: () => void;
  onRefreshExplorer: () => void;
  onOpenInTerminal?: (dirPath: string) => void;
  onOpenFile: (path: string) => void;
  onCreateNewFile: (fullPath: string, initialContent?: string) => void;
  fetchDirEntries?: (dirPath: string) => Promise<{ path: string; entries: RemoteDirEntry[] }>;
  onReadRemoteFile?: (filePath: string) => Promise<RemoteFilePreview>;
  onWriteRemoteFile?: (filePath: string, content: string) => Promise<{ path: string; size: number }>;
  onCreateRemoteDir?: (dirPath: string) => Promise<{ path: string }>;
  gitStatus?: GitStatusSnapshot | null;
  gitLoading?: boolean;
  gitError?: string | null;
  onRefreshGit?: () => Promise<void> | void;
  onRunGit?: GitCommandRunner;
  requestedSidebarTab?: { tab: 'explorer' | 'git'; seq: number } | null;
  onCopyText: (text: string) => Promise<boolean>;
  onSaveToNote: (file: RemoteFilePreview, draftContent: string) => void;
}

function getParentPosixPath(p: string): string {
  const cleaned = p.replace(/\/+$/, '');
  if (!cleaned || cleaned === '/') return '/';
  const idx = cleaned.lastIndexOf('/');
  return idx <= 0 ? '/' : cleaned.slice(0, idx);
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function detectLanguageLabel(filename: string): string {
  const lower = filename.toLowerCase();
  if (lower === 'dockerfile' || lower.startsWith('dockerfile.')) return 'Dockerfile';
  if (lower === '.env' || lower.startsWith('.env.')) return 'Env';
  if (lower === 'makefile') return 'Makefile';
  const ext = lower.includes('.') ? lower.split('.').pop() || '' : '';
  const map: Record<string, string> = {
    ts: 'TypeScript',
    tsx: 'TypeScript JSX',
    js: 'JavaScript',
    jsx: 'JavaScript JSX',
    mjs: 'JavaScript',
    cjs: 'JavaScript',
    json: 'JSON',
    py: 'Python',
    go: 'Go',
    rs: 'Rust',
    sh: 'Shell',
    bash: 'Bash',
    zsh: 'Zsh',
    yml: 'YAML',
    yaml: 'YAML',
    toml: 'TOML',
    sql: 'SQL',
    md: 'Markdown',
    css: 'CSS',
    scss: 'SCSS',
    html: 'HTML',
    xml: 'XML',
    conf: 'Config',
    nginx: 'Nginx',
    txt: 'Plain Text',
  };
  return map[ext] || (ext ? ext.toUpperCase() : 'Plain Text');
}

export function RemoteCodeEditor({
  file,
  openFiles,
  fullScreen,
  saving,
  saveError,
  dirError = null,
  fileLoading = false,
  lastSavedAt,
  currentRemotePath,
  dirCache,
  expandedDirs,
  loadingDirs,
  truncatedDirs,
  onToggleFullScreen,
  onCloseFile,
  onSelectTab,
  onCloseTab,
  onSaveFile,
  onSaveAsFile,
  onReloadFile,
  onToggleDir,
  onNavigateRootDir,
  onCollapseAllDirs,
  onRefreshExplorer,
  onOpenInTerminal,
  onOpenFile,
  onCreateNewFile,
  fetchDirEntries,
  onReadRemoteFile,
  onWriteRemoteFile,
  onCreateRemoteDir,
  gitStatus = null,
  gitLoading = false,
  gitError = null,
  onRefreshGit,
  onRunGit,
  requestedSidebarTab = null,
  onCopyText,
  onSaveToNote,
}: RemoteCodeEditorProps) {
  const [draft, setDraft] = useState(file?.content ?? '');
  const [sidebarTab, setSidebarTab] = useState<'explorer' | 'git'>('explorer');
  const wordWrap = false;
  const [savedBannerVisible, setSavedBannerVisible] = useState(false);
  const [actionNotice, setActionNotice] = useState<string | null>(null);
  const [explorerOpen, setExplorerOpen] = useState(true);
  const [explorerWidth, setExplorerWidth] = useState<number>(() => {
    try {
      const saved = Number(window.localStorage.getItem('notecraft.ide.explorerWidth.v1'));
      if (Number.isFinite(saved) && saved >= 180 && saved <= 560) return saved;
    } catch {
      // ignore storage errors
    }
    return 275;
  });
  const [aiAgentOpen, setAiAgentOpen] = useState(false);
  const [agentWidth, setAgentWidth] = useState<number>(() => {
    try {
      const saved = Number(window.localStorage.getItem('notecraft.ide.agentWidth.v1'));
      if (Number.isFinite(saved) && saved >= 280 && saved <= 620) return saved;
    } catch {
      // ignore storage errors
    }
    return 370;
  });
  const [resizingPane, setResizingPane] = useState<'explorer' | 'agent' | null>(null);
  const [explorerPathInput, setExplorerPathInput] = useState(currentRemotePath || '');
  const [creatingInDir, setCreatingInDir] = useState<string | null>(null);
  const [cursorPos, setCursorPos] = useState({ line: 1, col: 1 });
  const [selectionRange, setSelectionRange] = useState({ start: 0, end: 0 });
  const [editorScrollTop, setEditorScrollTop] = useState(0);
  const [formatting, setFormatting] = useState(false);
  const [editorContextMenu, setEditorContextMenu] = useState<{
    x: number;
    y: number;
    selectionStart: number;
    selectionEnd: number;
    lineNumber: number;
    endLineNumber: number;
  } | null>(null);
  const [multiSelection, setMultiSelection] = useState<{
    ranges: TextMatchRange[];
    primaryIndex: number;
    query: string;
  } | null>(null);

  // Undo / Redo history state
  const historyRef = useRef<{
    stack: HistorySnapshot[];
    index: number;
    lastInputAt: number;
  }>({
    stack: [{ value: file?.content ?? '', selectionStart: 0, selectionEnd: 0 }],
    index: 0,
    lastInputAt: 0,
  });
  const [historyMeta, setHistoryMeta] = useState({ canUndo: false, canRedo: false });

  // Find / Replace / Go to Line / Save As UI bars
  const [findOpen, setFindOpen] = useState(false);
  const [replaceOpen, setReplaceOpen] = useState(false);
  const [findQuery, setFindQuery] = useState('');
  const [replaceQuery, setReplaceQuery] = useState('');
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [activeMatchIdx, setActiveMatchIdx] = useState(0);

  const [gotoOpen, setGotoOpen] = useState(false);
  const [gotoInput, setGotoInput] = useState('');

  const [saveAsOpen, setSaveAsOpen] = useState(false);
  const [saveAsPath, setSaveAsPath] = useState(file?.path ?? '');

  const [pendingAction, setPendingAction] = useState<
    | { type: 'switch-file'; path: string }
    | { type: 'close-file' }
    | { type: 'close-tab'; path: string }
    | { type: 'exit-fullscreen' }
    | null
  >(null);

  const [pendingHunks, setPendingHunks] = useState<PendingDiffHunk[]>([]);
  const [trackedChanges, setTrackedChanges] = useState<TrackedFileChange[]>([]);
  const [applyingTrackedChanges, setApplyingTrackedChanges] = useState(false);
  const [previewingNewFile, setPreviewingNewFile] = useState<TrackedFileChange | null>(null);
  const [gitDiffView, setGitDiffView] = useState<
    | {
        kind: 'file';
        change: GitFileChange;
        staged: boolean;
        diffText: string;
        newFilePreview?: string;
      }
    | {
        kind: 'commit';
        commit: GitCommitInfo;
        diffText: string;
      }
    | null
  >(null);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const gutterRef = useRef<HTMLDivElement>(null);
  const preRef = useRef<HTMLPreElement>(null);
  const selectionOverlayRef = useRef<HTMLPreElement>(null);
  const diffScrollRef = useRef<HTMLDivElement>(null);
  const findInputRef = useRef<HTMLInputElement>(null);
  const gotoInputRef = useRef<HTMLInputElement>(null);
  const saveAsInputRef = useRef<HTMLInputElement>(null);
  const trackedChangesRef = useRef<TrackedFileChange[]>(trackedChanges);
  trackedChangesRef.current = trackedChanges;
  const tabStatesRef = useRef<Record<string, TabPreservedState>>({});
  const prevActiveFileRef = useRef<{ path: string; draft: string; content: string } | null>(null);
  const activeDraftRef = useRef(draft);
  activeDraftRef.current = draft;
  const activeCursorRef = useRef(cursorPos);
  activeCursorRef.current = cursorPos;
  const activeSelectionRef = useRef(selectionRange);
  activeSelectionRef.current = selectionRange;
  const activeScrollTopRef = useRef(editorScrollTop);
  activeScrollTopRef.current = editorScrollTop;
  const activeFilePathRef = useRef<string | null>(file?.path ?? null);
  activeFilePathRef.current = file?.path ?? null;
  const contextMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!editorContextMenu) return;
    const closeMenu = (ev?: Event) => {
      if (
        ev &&
        ev.type === 'mousedown' &&
        contextMenuRef.current &&
        ev.target instanceof Node &&
        contextMenuRef.current.contains(ev.target)
      ) {
        return;
      }
      setEditorContextMenu(null);
    };
    const handleResizeOrBlur = () => setEditorContextMenu(null);
    window.addEventListener('mousedown', closeMenu, true);
    window.addEventListener('resize', handleResizeOrBlur);
    window.addEventListener('blur', handleResizeOrBlur);
    return () => {
      window.removeEventListener('mousedown', closeMenu, true);
      window.removeEventListener('resize', handleResizeOrBlur);
      window.removeEventListener('blur', handleResizeOrBlur);
    };
  }, [editorContextMenu]);

  const showNotice = useCallback((msg: string) => {
    setActionNotice(msg);
    window.setTimeout(() => {
      setActionNotice((cur) => (cur === msg ? null : cur));
    }, 2400);
  }, []);

  useEffect(() => {
    setExplorerPathInput(currentRemotePath || '');
  }, [currentRemotePath]);

  useEffect(() => {
    if (!requestedSidebarTab) return;
    setSidebarTab(requestedSidebarTab.tab);
    setExplorerOpen(true);
  }, [requestedSidebarTab]);

  // Prune closed tabs from preserved per-tab state
  useEffect(() => {
    const openSet = new Set(openFiles.map((f) => f.path));
    for (const cachedPath of Object.keys(tabStatesRef.current)) {
      if (!openSet.has(cachedPath)) {
        delete tabStatesRef.current[cachedPath];
      }
    }
  }, [openFiles]);

  // Switch or reload file while preserving unsaved drafts & undo history per open tab
  useEffect(() => {
    const prev = prevActiveFileRef.current;
    if (prev && prev.path !== file?.path && openFiles.some((f) => f.path === prev.path)) {
      tabStatesRef.current[prev.path] = {
        draft: activeDraftRef.current,
        savedContent: prev.content,
        history: {
          stack: [...historyRef.current.stack],
          index: historyRef.current.index,
          lastInputAt: historyRef.current.lastInputAt,
        },
        cursorPos: { ...activeCursorRef.current },
        selectionRange: { ...activeSelectionRef.current },
        scrollTop: activeScrollTopRef.current,
      };
    }

    const nextPath = file?.path ?? null;
    const nextContent = file?.content ?? '';
    const existingTabState = nextPath ? tabStatesRef.current[nextPath] : undefined;
    const sameFileSaved =
      prev &&
      nextPath === prev.path &&
      activeDraftRef.current === nextContent;

    setPendingAction(null);
    setEditorContextMenu(null);
    setMultiSelection(null);
    setPreviewingNewFile(null);
    setGitDiffView(null);
    setSaveAsOpen(false);
    setSaveAsPath(nextPath ?? '');

    const matchingTracked = file
      ? trackedChangesRef.current.find(
          (c) => c.path === file.path && c.status === 'pending' && c.operation === 'edit-file'
        )
      : undefined;
    setPendingHunks(matchingTracked ? matchingTracked.hunks : []);

    if (nextPath && sameFileSaved) {
      // File just saved: keep current draft/cursor/undo history and update saved baseline
      tabStatesRef.current[nextPath] = {
        draft: activeDraftRef.current,
        savedContent: nextContent,
        history: {
          stack: [...historyRef.current.stack],
          index: historyRef.current.index,
          lastInputAt: historyRef.current.lastInputAt,
        },
        cursorPos: { ...activeCursorRef.current },
        selectionRange: { ...activeSelectionRef.current },
        scrollTop: activeScrollTopRef.current,
      };
      prevActiveFileRef.current = file
        ? { path: file.path, draft: activeDraftRef.current, content: file.content }
        : null;
      return;
    }

    if (nextPath && existingTabState && existingTabState.savedContent === nextContent) {
      setDraft(existingTabState.draft);
      setCursorPos(existingTabState.cursorPos);
      setSelectionRange(existingTabState.selectionRange);
      setEditorScrollTop(existingTabState.scrollTop);
      historyRef.current = {
        stack: [...existingTabState.history.stack],
        index: existingTabState.history.index,
        lastInputAt: existingTabState.history.lastInputAt,
      };
      setHistoryMeta({
        canUndo: existingTabState.history.index > 0,
        canRedo: existingTabState.history.index < existingTabState.history.stack.length - 1,
      });
      window.requestAnimationFrame(() => {
        if (textareaRef.current) {
          textareaRef.current.scrollTop = existingTabState.scrollTop;
        }
        if (preRef.current) {
          preRef.current.scrollTop = existingTabState.scrollTop;
        }
        if (selectionOverlayRef.current) {
          selectionOverlayRef.current.scrollTop = existingTabState.scrollTop;
        }
        if (gutterRef.current) {
          gutterRef.current.scrollTop = existingTabState.scrollTop;
        }
      });
    } else {
      setDraft(nextContent);
      setCursorPos({ line: 1, col: 1 });
      setSelectionRange({ start: 0, end: 0 });
      setEditorScrollTop(0);
      historyRef.current = {
        stack: [{ value: nextContent, selectionStart: 0, selectionEnd: 0 }],
        index: 0,
        lastInputAt: 0,
      };
      setHistoryMeta({ canUndo: false, canRedo: false });
      if (nextPath) {
        tabStatesRef.current[nextPath] = {
          draft: nextContent,
          savedContent: nextContent,
          history: {
            stack: [{ value: nextContent, selectionStart: 0, selectionEnd: 0 }],
            index: 0,
            lastInputAt: 0,
          },
          cursorPos: { line: 1, col: 1 },
          selectionRange: { start: 0, end: 0 },
          scrollTop: 0,
        };
      }
      if (textareaRef.current) {
        textareaRef.current.scrollTop = 0;
        textareaRef.current.scrollLeft = 0;
      }
      if (preRef.current) {
        preRef.current.scrollTop = 0;
        preRef.current.scrollLeft = 0;
      }
      if (selectionOverlayRef.current) {
        selectionOverlayRef.current.scrollTop = 0;
        selectionOverlayRef.current.scrollLeft = 0;
      }
      if (gutterRef.current) {
        gutterRef.current.scrollTop = 0;
      }
    }

    prevActiveFileRef.current = file
      ? { path: file.path, draft: existingTabState?.draft ?? nextContent, content: file.content }
      : null;
  }, [file?.path, file?.content]);

  useEffect(() => {
    if (!lastSavedAt) return;
    setSavedBannerVisible(true);
    void onRefreshGit?.();
    const timer = window.setTimeout(() => setSavedBannerVisible(false), 2000);
    return () => window.clearTimeout(timer);
  }, [lastSavedAt, onRefreshGit]);

  const isEditable = Boolean(file && !file.isBinary && !file.truncated);
  const isDirty = Boolean(file && !file.isBinary && !file.truncated && draft !== file.content);
  const lineCount = useMemo(() => Math.max(1, draft.split('\n').length), [draft]);
  const languageLabel = useMemo(
    () => (file ? detectLanguageLabel(file.name) : 'Workspace'),
    [file]
  );
  const highlightedHtml = useMemo(
    () => (!file || file.isBinary ? '' : highlightCodeToHtml(draft, file.name)),
    [draft, file]
  );

  const multiSelectionHtml = useMemo(() => {
    if (!multiSelection || multiSelection.ranges.length === 0 || !file || file.isBinary) {
      return '';
    }
    let html = '';
    let cursor = 0;
    for (let i = 0; i < multiSelection.ranges.length; i += 1) {
      const r = multiSelection.ranges[i];
      const start = Math.max(cursor, Math.min(draft.length, r.start));
      const end = Math.max(start, Math.min(draft.length, r.end));
      if (start > cursor) {
        html += escapeHtml(draft.slice(cursor, start));
      }
      if (end > start) {
        const cls =
          i === multiSelection.primaryIndex
            ? 'bg-blue-500/45 text-transparent rounded-[2px] outline outline-1 outline-blue-300/90'
            : 'bg-blue-500/30 text-transparent rounded-[2px] outline outline-1 outline-blue-400/70';
        html += `<mark class="${cls}">${escapeHtml(draft.slice(start, end))}</mark>`;
      } else {
        html +=
          '<span class="relative inline-block w-0 align-baseline"><span aria-hidden="true" class="absolute left-0 top-[-0.95em] h-[1.2em] w-[1.5px] bg-blue-400"></span></span>';
      }
      cursor = end;
    }
    if (cursor < draft.length) {
      html += escapeHtml(draft.slice(cursor));
    }
    return draft.endsWith('\n') ? `${html} ` : html;
  }, [multiSelection, draft, file]);

  const matches = useMemo(
    () => (findOpen && findQuery ? findAllTextMatches(draft, findQuery, caseSensitive) : []),
    [draft, findOpen, findQuery, caseSensitive]
  );

  useEffect(() => {
    if (matches.length === 0) {
      setActiveMatchIdx(0);
    } else if (activeMatchIdx >= matches.length) {
      setActiveMatchIdx(0);
    }
  }, [matches.length, activeMatchIdx]);

  const selectedText = useMemo(() => {
    if (!file || file.isBinary || selectionRange.end <= selectionRange.start) return '';
    return draft.slice(selectionRange.start, selectionRange.end);
  }, [file, draft, selectionRange]);

  const selectionRangeLabel = useMemo(() => {
    if (!selectedText) return null;
    const startLine = draft.slice(0, selectionRange.start).split('\n').length;
    const endLine = draft.slice(0, selectionRange.end).split('\n').length;
    return startLine === endLine ? `Line ${startLine}` : `Lines ${startLine}–${endLine}`;
  }, [draft, selectedText, selectionRange]);

  const startPaneResize = useCallback(
    (pane: 'explorer' | 'agent', startEvent: React.MouseEvent) => {
      startEvent.preventDefault();
      const startX = startEvent.clientX;
      const startWidth = pane === 'explorer' ? explorerWidth : agentWidth;
      let latestWidth = startWidth;
      setResizingPane(pane);

      const prevCursor = document.body.style.cursor;
      const prevSelect = document.body.style.userSelect;
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';

      const handleMouseMove = (moveEvent: MouseEvent) => {
        const delta = moveEvent.clientX - startX;
        const maxExplorer = Math.max(260, Math.min(560, Math.floor(window.innerWidth * 0.45)));
        const maxAgent = Math.max(320, Math.min(640, Math.floor(window.innerWidth * 0.52)));
        if (pane === 'explorer') {
          latestWidth = Math.max(180, Math.min(maxExplorer, startWidth + delta));
          setExplorerWidth(latestWidth);
        } else {
          latestWidth = Math.max(280, Math.min(maxAgent, startWidth - delta));
          setAgentWidth(latestWidth);
        }
      };

      const handleMouseUp = () => {
        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('mouseup', handleMouseUp);
        document.body.style.cursor = prevCursor;
        document.body.style.userSelect = prevSelect;
        setResizingPane(null);
        try {
          const storageKey =
            pane === 'explorer'
              ? 'notecraft.ide.explorerWidth.v1'
              : 'notecraft.ide.agentWidth.v1';
          window.localStorage.setItem(storageKey, String(latestWidth));
        } catch {
          // ignore storage errors
        }
      };

      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    },
    [explorerWidth, agentWidth]
  );

  const updateCursorStatsFromOffsets = useCallback(
    (text: string, pos: number, endPos = pos) => {
      const before = text.slice(0, pos);
      const lines = before.split('\n');
      setCursorPos({
        line: lines.length,
        col: (lines[lines.length - 1]?.length ?? 0) + 1,
      });
      setSelectionRange({ start: Math.min(pos, endPos), end: Math.max(pos, endPos) });
    },
    []
  );

  const updateCursorStats = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    updateCursorStatsFromOffsets(
      el.value,
      el.selectionStart ?? 0,
      el.selectionEnd ?? el.selectionStart ?? 0
    );
  }, [updateCursorStatsFromOffsets]);

  const scrollLineIntoView = useCallback(
    (lineNumber: number) => {
      const el = textareaRef.current;
      if (!el) return;
      const lineHeight = fullScreen ? 21 : 19;
      const targetTop = Math.max(
        0,
        (lineNumber - 1) * lineHeight - Math.floor(el.clientHeight / 2) + lineHeight
      );
      el.scrollTop = targetTop;
      setEditorScrollTop(targetTop);
      if (preRef.current) preRef.current.scrollTop = targetTop;
      if (selectionOverlayRef.current) selectionOverlayRef.current.scrollTop = targetTop;
      if (gutterRef.current) gutterRef.current.scrollTop = targetTop;
    },
    [fullScreen]
  );

  const pushHistory = useCallback(
    (snap: HistorySnapshot, coalesce = false) => {
      const h = historyRef.current;
      const now = Date.now();
      const base = h.stack.slice(0, h.index + 1);
      const current = base[base.length - 1];
      if (current && current.value === snap.value) return;

      if (coalesce && base.length > 1 && now - h.lastInputAt < 500) {
        base[base.length - 1] = snap;
        h.stack = base;
        h.index = base.length - 1;
      } else {
        base.push(snap);
        if (base.length > 250) {
          base.shift();
        }
        h.stack = base;
        h.index = base.length - 1;
      }
      h.lastInputAt = now;
      setHistoryMeta({
        canUndo: h.index > 0,
        canRedo: h.index < h.stack.length - 1,
      });
    },
    []
  );

  const applyEdit = useCallback(
    (res: EditResult, options?: { coalesce?: boolean; focus?: boolean }) => {
      setMultiSelection(null);
      setDraft(res.value);
      pushHistory(
        {
          value: res.value,
          selectionStart: res.selectionStart,
          selectionEnd: res.selectionEnd,
        },
        Boolean(options?.coalesce)
      );
      updateCursorStatsFromOffsets(res.value, res.selectionStart, res.selectionEnd);
      window.requestAnimationFrame(() => {
        const el = textareaRef.current;
        if (!el) return;
        if (options?.focus !== false) {
          el.focus();
        }
        el.setSelectionRange(res.selectionStart, res.selectionEnd);
      });
    },
    [pushHistory, updateCursorStatsFromOffsets]
  );

  const focusFirstDiffHunk = useCallback((firstHunkId?: string) => {
    window.requestAnimationFrame(() => {
      const container = diffScrollRef.current;
      if (!container) return;
      if (firstHunkId) {
        const el = container.querySelector(
          `[data-diff-hunk-id="${firstHunkId}"]`
        ) as HTMLElement | null;
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          return;
        }
      }
      const firstEl = container.querySelector('[data-diff-hunk-id]') as HTMLElement | null;
      firstEl?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  }, []);

  const pendingFileStatuses = useMemo(() => {
    const map: Record<string, 'modified' | 'new' | 'accepted'> = {};
    for (const item of trackedChanges) {
      if (item.operation === 'create-dir') continue;
      if (item.status === 'pending') {
        map[item.path] = item.operation === 'create-file' ? 'new' : 'modified';
      } else if (item.status === 'accepted') {
        map[item.path] = 'accepted';
      }
    }
    return map;
  }, [trackedChanges]);

  const syncActiveFileHunksToTracked = useCallback(
    (nextHunks: PendingDiffHunk[], resolvedStatus?: 'accepted' | 'rejected') => {
      if (!file) return;
      setTrackedChanges((prev) =>
        prev.map((c) => {
          if (c.path !== file.path || c.operation !== 'edit-file' || c.status !== 'pending') {
            return c;
          }
          if (nextHunks.length === 0) {
            return {
              ...c,
              hunks: [],
              status: resolvedStatus || 'accepted',
            };
          }
          return { ...c, hunks: nextHunks };
        })
      );
    },
    [file]
  );

  const handleStageInlineDiff = useCallback(
    (payload: StagedDiffPayload) => {
      if (!file || !isEditable) return;

      let hunks: PendingDiffHunk[] = [];
      let unmatched = 0;

      if (payload.edits && payload.edits.length > 0) {
        const res = buildHunksFromSearchReplace(
          draft,
          payload.edits,
          cursorPos.line,
          payload.turnId
        );
        hunks = res.hunks;
        unmatched = res.unmatchedEdits.length;
      }

      if (hunks.length === 0 && payload.proposedCode) {
        const cleanProposed = payload.proposedCode.replace(/\r\n/g, '\n');
        if (
          payload.targetAction === 'replace-selection' &&
          selectionRange.end > selectionRange.start
        ) {
          const selStartLine = draft.slice(0, selectionRange.start).split('\n').length;
          const selEndLine = draft.slice(0, selectionRange.end).split('\n').length;
          const draftLines = draft.replace(/\r\n/g, '\n').split('\n');
          const oldBlock = draftLines.slice(selStartLine - 1, selEndLine).join('\n');
          hunks = computeLineDiffHunks(
            oldBlock,
            cleanProposed,
            selStartLine,
            payload.summary,
            payload.turnId
          );
        } else if (payload.targetAction === 'insert-at-cursor') {
          hunks = [
            {
              id: `hunk-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
              startLine: cursorPos.line,
              endLine: cursorPos.line - 1,
              oldLines: [],
              newLines: cleanProposed.split('\n'),
              description: payload.summary,
              sourceTurnId: payload.turnId,
            },
          ];
        } else {
          hunks = computeLineDiffHunks(
            draft,
            cleanProposed,
            1,
            payload.summary,
            payload.turnId
          );
        }
      }

      if (hunks.length === 0) {
        showNotice(
          unmatched > 0
            ? 'Could not match AI edit snippet against current file lines.'
            : 'No code changes to review against the current file.'
        );
        return;
      }

      setPreviewingNewFile(null);
      setPendingHunks(hunks);
      setTrackedChanges((prev) => [
        ...prev.filter((c) => !(c.path === file.path && c.status === 'pending')),
        {
          id: `trk-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          path: file.path,
          operation: 'edit-file',
          description: payload.summary,
          status: 'pending',
          originalContent: draft,
          hunks,
          unmatchedCount: unmatched,
          turnId: payload.turnId,
        },
      ]);
      focusFirstDiffHunk(hunks[0]?.id);
    },
    [file, isEditable, draft, cursorPos.line, selectionRange, showNotice, focusFirstDiffHunk]
  );

  const handleStageFileOperations = useCallback(
    async (operations: CodeAgentFileOperation[], turnId: string, summary?: string) => {
      const root =
        currentRemotePath || (file ? getParentPosixPath(file.path) : '/');
      const nextEntries: TrackedFileChange[] = [];

      for (const op of operations) {
        const absPath = resolvePosixWorkspacePath(root, op.path);
        if (!absPath) continue;

        if (op.operation === 'create-dir') {
          nextEntries.push({
            id: `trk-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            path: absPath,
            operation: 'create-dir',
            description: op.description || summary,
            status: 'pending',
            hunks: [],
            turnId,
          });
          continue;
        }

        if (op.operation === 'create-file') {
          nextEntries.push({
            id: `trk-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            path: absPath,
            operation: 'create-file',
            description: op.description || summary,
            status: 'pending',
            hunks: [],
            newFileContent: op.content ?? '',
            turnId,
          });
          continue;
        }

        // edit-file
        const edits = op.edits || [];
        if (edits.length === 0) continue;

        let baseContent = '';
        let loaded = false;
        if (file && file.path === absPath) {
          baseContent = draft;
          loaded = true;
        } else if (onReadRemoteFile) {
          try {
            const remote = await onReadRemoteFile(absPath);
            if (!remote.isBinary) {
              baseContent = remote.content;
              loaded = true;
            }
          } catch {
            // File might not exist yet; if oldCode is empty, treat as create-file
          }
        }

        if (!loaded && edits.every((e) => !e.oldCode.trim())) {
          nextEntries.push({
            id: `trk-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            path: absPath,
            operation: 'create-file',
            description: op.description || summary,
            status: 'pending',
            hunks: [],
            newFileContent: edits.map((e) => e.newCode).join('\n'),
            turnId,
          });
          continue;
        }

        const { hunks, unmatchedEdits } = buildHunksFromSearchReplace(
          baseContent,
          edits,
          file && file.path === absPath ? cursorPos.line : 1,
          turnId
        );

        nextEntries.push({
          id: `trk-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          path: absPath,
          operation: 'edit-file',
          description: op.description || summary,
          status: hunks.length > 0 ? 'pending' : 'rejected',
          originalContent: baseContent,
          hunks,
          unmatchedCount: unmatchedEdits.length,
          turnId,
        });
      }

      if (nextEntries.length === 0) return;

      setTrackedChanges((prev) => {
        const replacedPaths = new Set(nextEntries.map((e) => e.path));
        const kept = prev.filter((c) => !(c.status === 'pending' && replacedPaths.has(c.path)));
        return [...kept, ...nextEntries];
      });

      // Stage inline diff immediately if active file has edits
      const activeEntry = file
        ? nextEntries.find(
            (e) => e.path === file.path && e.operation === 'edit-file' && e.hunks.length > 0
          )
        : undefined;

      if (activeEntry) {
        setPreviewingNewFile(null);
        setPendingHunks(activeEntry.hunks);
        focusFirstDiffHunk(activeEntry.hunks[0]?.id);
      } else {
        const firstOtherEdit = nextEntries.find(
          (e) => e.operation === 'edit-file' && e.hunks.length > 0
        );
        const firstNewFile = nextEntries.find((e) => e.operation === 'create-file');
        if (!file && firstOtherEdit) {
          onOpenFile(firstOtherEdit.path);
        } else if (!file && firstNewFile) {
          setPreviewingNewFile(firstNewFile);
        }
      }

      const pendingCount = nextEntries.filter((e) => e.status === 'pending').length;
      if (pendingCount > 0) {
        showNotice(
          `Staged ${pendingCount} ${pendingCount === 1 ? 'change' : 'changes'} for review`
        );
      }
    },
    [
      currentRemotePath,
      file,
      draft,
      onReadRemoteFile,
      cursorPos.line,
      focusFirstDiffHunk,
      onOpenFile,
      showNotice,
    ]
  );

  const handleReviewTrackedChange = useCallback(
    (change: TrackedFileChange) => {
      if (change.operation === 'create-dir') return;
      if (change.operation === 'create-file') {
        setPreviewingNewFile(change);
        return;
      }
      setPreviewingNewFile(null);
      if (file && file.path === change.path) {
        setPendingHunks(change.hunks);
        focusFirstDiffHunk(change.hunks[0]?.id);
        return;
      }
      if (isDirty) {
        setPendingAction({ type: 'switch-file', path: change.path });
      } else {
        onOpenFile(change.path);
      }
    },
    [file, isDirty, focusFirstDiffHunk, onOpenFile]
  );

  const handleAcceptTrackedChange = useCallback(
    async (changeId: string) => {
      const target = trackedChangesRef.current.find((c) => c.id === changeId);
      if (!target || target.status !== 'pending') return;

      setApplyingTrackedChanges(true);
      try {
        if (target.operation === 'create-dir') {
          if (!onCreateRemoteDir) {
            throw new Error('Remote directory creation unavailable.');
          }
          await onCreateRemoteDir(target.path);
          onRefreshExplorer();
        } else if (target.operation === 'create-file') {
          if (onWriteRemoteFile) {
            await onWriteRemoteFile(target.path, target.newFileContent ?? '');
            onRefreshExplorer();
          } else {
            onCreateNewFile(target.path, target.newFileContent ?? '');
          }
          if (previewingNewFile?.id === target.id) {
            setPreviewingNewFile(null);
            onOpenFile(target.path);
          }
        } else if (target.operation === 'edit-file') {
          if (file && file.path === target.path) {
            const res = applyAllDiffHunks(draft, target.hunks);
            applyEdit(
              {
                value: res.nextDraft,
                selectionStart: res.nextCursorOffset,
                selectionEnd: res.nextCursorOffset,
              },
              { focus: false }
            );
            setPendingHunks([]);
            if (onWriteRemoteFile) {
              await onWriteRemoteFile(target.path, res.nextDraft);
            } else {
              onSaveFile(target.path, res.nextDraft);
            }
          } else {
            const base =
              typeof target.originalContent === 'string'
                ? target.originalContent
                : onReadRemoteFile
                ? (await onReadRemoteFile(target.path)).content
                : '';
            const res = applyAllDiffHunks(base, target.hunks);
            if (!onWriteRemoteFile) {
              throw new Error('Background multi-file write unavailable.');
            }
            await onWriteRemoteFile(target.path, res.nextDraft);
          }
        }

        setTrackedChanges((prev) =>
          prev.map((c) => (c.id === changeId ? { ...c, status: 'accepted', hunks: [] } : c))
        );
        showNotice(`Accepted & applied ${target.path.split('/').pop() || target.path}`);
      } catch (err) {
        showNotice(
          err instanceof Error ? err.message : `Failed to apply ${target.path}`
        );
      } finally {
        setApplyingTrackedChanges(false);
      }
    },
    [
      onCreateRemoteDir,
      onRefreshExplorer,
      onWriteRemoteFile,
      onCreateNewFile,
      previewingNewFile,
      onOpenFile,
      file,
      draft,
      applyEdit,
      onSaveFile,
      onReadRemoteFile,
      showNotice,
    ]
  );

  const handleRejectTrackedChange = useCallback(
    (changeId: string) => {
      const target = trackedChangesRef.current.find((c) => c.id === changeId);
      if (!target) return;
      if (file && file.path === target.path) {
        setPendingHunks([]);
      }
      if (previewingNewFile?.id === target.id) {
        setPreviewingNewFile(null);
      }
      setTrackedChanges((prev) =>
        prev.map((c) => (c.id === changeId ? { ...c, status: 'rejected' } : c))
      );
    },
    [file, previewingNewFile]
  );

  const handleAcceptAllTrackedChanges = useCallback(async () => {
    const pendingList = trackedChangesRef.current.filter((c) => c.status === 'pending');
    if (pendingList.length === 0) return;

    const ordered = [
      ...pendingList.filter((c) => c.operation === 'create-dir'),
      ...pendingList.filter((c) => c.operation === 'create-file'),
      ...pendingList.filter((c) => c.operation === 'edit-file'),
    ];

    setApplyingTrackedChanges(true);
    let appliedCount = 0;
    try {
      for (const item of ordered) {
        if (item.operation === 'create-dir') {
          if (onCreateRemoteDir) {
            await onCreateRemoteDir(item.path);
          }
        } else if (item.operation === 'create-file') {
          if (onWriteRemoteFile) {
            await onWriteRemoteFile(item.path, item.newFileContent ?? '');
          } else {
            onCreateNewFile(item.path, item.newFileContent ?? '');
          }
        } else if (item.operation === 'edit-file') {
          if (file && file.path === item.path) {
            const res = applyAllDiffHunks(draft, item.hunks);
            applyEdit(
              {
                value: res.nextDraft,
                selectionStart: res.nextCursorOffset,
                selectionEnd: res.nextCursorOffset,
              },
              { focus: false }
            );
            setPendingHunks([]);
            if (onWriteRemoteFile) {
              await onWriteRemoteFile(item.path, res.nextDraft);
            } else {
              onSaveFile(item.path, res.nextDraft);
            }
          } else if (onWriteRemoteFile) {
            const base =
              typeof item.originalContent === 'string'
                ? item.originalContent
                : onReadRemoteFile
                ? (await onReadRemoteFile(item.path)).content
                : '';
            const res = applyAllDiffHunks(base, item.hunks);
            await onWriteRemoteFile(item.path, res.nextDraft);
          }
        }
        appliedCount += 1;
        setTrackedChanges((prev) =>
          prev.map((c) => (c.id === item.id ? { ...c, status: 'accepted', hunks: [] } : c))
        );
      }

      setPreviewingNewFile(null);
      onRefreshExplorer();
      showNotice(`Accepted & saved ${appliedCount} workspace ${appliedCount === 1 ? 'change' : 'changes'}`);
    } catch (err) {
      showNotice(
        err instanceof Error ? err.message : 'Stopped applying changes due to an error.'
      );
    } finally {
      setApplyingTrackedChanges(false);
    }
  }, [
    onCreateRemoteDir,
    onWriteRemoteFile,
    onCreateNewFile,
    file,
    draft,
    applyEdit,
    onSaveFile,
    onReadRemoteFile,
    onRefreshExplorer,
    showNotice,
  ]);

  const handleRejectAllTrackedChanges = useCallback(() => {
    setPendingHunks([]);
    setPreviewingNewFile(null);
    setTrackedChanges([]);
  }, []);

  const handleAcceptHunk = useCallback(
    (hunkId: string) => {
      const target = pendingHunks.find((h) => h.id === hunkId);
      if (!target) return;

      const res = applySingleDiffHunk(draft, target);
      applyEdit(
        {
          value: res.nextDraft,
          selectionStart: res.nextCursorOffset,
          selectionEnd: res.nextCursorOffset,
        },
        { focus: false }
      );

      const nextHunks = pendingHunks
        .filter((h) => h.id !== hunkId)
        .map((h) =>
          h.startLine > target.startLine
            ? {
                ...h,
                startLine: h.startLine + res.lineDelta,
                endLine: h.endLine + res.lineDelta,
              }
            : h
        );
      setPendingHunks(nextHunks);
      syncActiveFileHunksToTracked(nextHunks, 'accepted');
      showNotice('Accepted change (Ctrl+Z to undo, Ctrl+S to save)');
    },
    [pendingHunks, draft, applyEdit, syncActiveFileHunksToTracked, showNotice]
  );

  const handleAcceptSingleLine = useCallback(
    (hunkId: string, newLineIdx: number) => {
      const target = pendingHunks.find((h) => h.id === hunkId);
      if (!target) return;

      const res = acceptSingleLineInHunk(draft, target, newLineIdx);
      applyEdit(
        {
          value: res.nextDraft,
          selectionStart: res.nextCursorOffset,
          selectionEnd: res.nextCursorOffset,
        },
        { focus: false }
      );

      const nextHunks: PendingDiffHunk[] = [];
      for (const h of pendingHunks) {
        if (h.id === hunkId) {
          nextHunks.push(...res.remainingHunks);
        } else if (h.startLine > target.startLine) {
          nextHunks.push({
            ...h,
            startLine: h.startLine + res.lineDelta,
            endLine: h.endLine + res.lineDelta,
          });
        } else {
          nextHunks.push(h);
        }
      }
      setPendingHunks(nextHunks);
      syncActiveFileHunksToTracked(nextHunks, 'accepted');
      showNotice('Accepted line (Ctrl+Z to undo, Ctrl+S to save)');
    },
    [pendingHunks, draft, applyEdit, syncActiveFileHunksToTracked, showNotice]
  );

  const handleRejectHunk = useCallback(
    (hunkId: string) => {
      const nextHunks = pendingHunks.filter((h) => h.id !== hunkId);
      setPendingHunks(nextHunks);
      syncActiveFileHunksToTracked(nextHunks, 'rejected');
    },
    [pendingHunks, syncActiveFileHunksToTracked]
  );

  const handleAcceptAllPendingDiffs = useCallback(() => {
    if (pendingHunks.length === 0) return;
    const res = applyAllDiffHunks(draft, pendingHunks);
    applyEdit(
      {
        value: res.nextDraft,
        selectionStart: res.nextCursorOffset,
        selectionEnd: res.nextCursorOffset,
      },
      { focus: false }
    );
    setPendingHunks([]);
    syncActiveFileHunksToTracked([], 'accepted');
    showNotice('Accepted all changes in file (Ctrl+Z to undo, Ctrl+S to save)');
  }, [pendingHunks, draft, applyEdit, syncActiveFileHunksToTracked, showNotice]);

  const handleRejectAllPendingDiffs = useCallback(() => {
    setPendingHunks([]);
    syncActiveFileHunksToTracked([], 'rejected');
  }, [syncActiveFileHunksToTracked]);

  const handleApplyAgentCode = useCallback(
    (nextCode: string, mode: 'replace-file' | 'replace-selection' | 'insert-at-cursor') => {
      if (!file || !isEditable) return;
      const normalized = nextCode.replace(/\r\n/g, '\n');

      if (mode === 'replace-file') {
        applyEdit(
          { value: normalized, selectionStart: 0, selectionEnd: 0 },
          { focus: false }
        );
        setPendingHunks([]);
        showNotice('AI edit applied to file (Ctrl+Z to undo)');
        return;
      }

      const el = textareaRef.current;
      const selStart = el?.selectionStart ?? selectionRange.start;
      const selEnd = el?.selectionEnd ?? selectionRange.end;

      if (mode === 'replace-selection' && selEnd > selStart) {
        const updated = `${draft.slice(0, selStart)}${normalized}${draft.slice(selEnd)}`;
        applyEdit(
          {
            value: updated,
            selectionStart: selStart,
            selectionEnd: selStart + normalized.length,
          },
          { focus: false }
        );
        setPendingHunks([]);
        showNotice('AI snippet replaced selection (Ctrl+Z to undo)');
        return;
      }

      const insertPos = selStart;
      const updated = `${draft.slice(0, insertPos)}${normalized}${draft.slice(insertPos)}`;
      applyEdit(
        {
          value: updated,
          selectionStart: insertPos + normalized.length,
          selectionEnd: insertPos + normalized.length,
        },
        { focus: false }
      );
      setPendingHunks([]);
      showNotice('AI snippet inserted at cursor (Ctrl+Z to undo)');
    },
    [file, isEditable, draft, selectionRange, applyEdit, showNotice]
  );

  const performUndo = useCallback(() => {
    const h = historyRef.current;
    if (h.index <= 0) return;
    h.index -= 1;
    const snap = h.stack[h.index];
    h.lastInputAt = 0;
    setMultiSelection(null);
    setDraft(snap.value);
    setHistoryMeta({
      canUndo: h.index > 0,
      canRedo: h.index < h.stack.length - 1,
    });
    updateCursorStatsFromOffsets(snap.value, snap.selectionStart);
    window.requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(snap.selectionStart, snap.selectionEnd);
    });
  }, [updateCursorStatsFromOffsets]);

  const performRedo = useCallback(() => {
    const h = historyRef.current;
    if (h.index >= h.stack.length - 1) return;
    h.index += 1;
    const snap = h.stack[h.index];
    h.lastInputAt = 0;
    setMultiSelection(null);
    setDraft(snap.value);
    setHistoryMeta({
      canUndo: h.index > 0,
      canRedo: h.index < h.stack.length - 1,
    });
    updateCursorStatsFromOffsets(snap.value, snap.selectionStart);
    window.requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(snap.selectionStart, snap.selectionEnd);
    });
  }, [updateCursorStatsFromOffsets]);

  const jumpToMatch = useCallback(
    (idx: number, focusEditor = true) => {
      if (matches.length === 0) return;
      const normalized = ((idx % matches.length) + matches.length) % matches.length;
      setActiveMatchIdx(normalized);
      const m = matches[normalized];
      const lineNum = draft.slice(0, m.start).split('\n').length;
      scrollLineIntoView(lineNum);
      if (focusEditor && textareaRef.current) {
        textareaRef.current.focus();
        textareaRef.current.setSelectionRange(m.start, m.end);
        updateCursorStatsFromOffsets(draft, m.start);
      }
    },
    [matches, draft, scrollLineIntoView, updateCursorStatsFromOffsets]
  );

  const openFindBar = useCallback(
    (withReplace: boolean) => {
      if (!file || file.isBinary) return;
      const el = textareaRef.current;
      if (el) {
        const selected = el.value.slice(el.selectionStart ?? 0, el.selectionEnd ?? 0);
        if (selected && !selected.includes('\n') && selected.length <= 80) {
          setFindQuery(selected);
        }
      }
      setGotoOpen(false);
      setSaveAsOpen(false);
      setFindOpen(true);
      setReplaceOpen(withReplace);
      window.requestAnimationFrame(() => {
        findInputRef.current?.focus();
        findInputRef.current?.select();
      });
    },
    [file]
  );

  const openGotoLineBar = useCallback(() => {
    if (!file || file.isBinary) return;
    setFindOpen(false);
    setReplaceOpen(false);
    setSaveAsOpen(false);
    setGotoInput(String(cursorPos.line));
    setGotoOpen(true);
    window.requestAnimationFrame(() => {
      gotoInputRef.current?.focus();
      gotoInputRef.current?.select();
    });
  }, [file, cursorPos.line]);

  const openSaveAsBar = useCallback(() => {
    if (!file || file.isBinary || file.truncated) return;
    setFindOpen(false);
    setReplaceOpen(false);
    setGotoOpen(false);
    setSaveAsPath(file.path);
    setSaveAsOpen(true);
    window.requestAnimationFrame(() => {
      saveAsInputRef.current?.focus();
      const slashIdx = file.path.lastIndexOf('/');
      if (slashIdx >= 0) {
        saveAsInputRef.current?.setSelectionRange(slashIdx + 1, file.path.length);
      } else {
        saveAsInputRef.current?.select();
      }
    });
  }, [file]);

  const handleReplaceOne = useCallback(() => {
    if (!isEditable || matches.length === 0) return;
    const idx = activeMatchIdx % matches.length;
    const m = matches[idx];
    const nextValue = `${draft.slice(0, m.start)}${replaceQuery}${draft.slice(m.end)}`;
    const nextCursor = m.start + replaceQuery.length;
    applyEdit(
      { value: nextValue, selectionStart: nextCursor, selectionEnd: nextCursor },
      { focus: false }
    );
  }, [isEditable, matches, activeMatchIdx, draft, replaceQuery, applyEdit]);

  const handleReplaceAll = useCallback(() => {
    if (!isEditable || matches.length === 0) return;
    let rebuilt = '';
    let cursor = 0;
    for (const m of matches) {
      rebuilt += draft.slice(cursor, m.start) + replaceQuery;
      cursor = m.end;
    }
    rebuilt += draft.slice(cursor);
    const count = matches.length;
    applyEdit({ value: rebuilt, selectionStart: 0, selectionEnd: 0 }, { focus: false });
    showNotice(`Replaced ${count} occurrence${count === 1 ? '' : 's'}`);
  }, [isEditable, matches, draft, replaceQuery, applyEdit, showNotice]);

  const handleFormatDocument = useCallback(async () => {
    if (!file || !isEditable || formatting) return;
    const targetPath = file.path;
    const targetName = file.name;
    const targetDraft = draft;
    setFormatting(true);
    try {
      const formatted = await formatSourceDocumentAsync(targetDraft, targetName);
      if (activeFilePathRef.current !== targetPath || activeDraftRef.current !== targetDraft) {
        return;
      }
      if (!formatted.ok) {
        if (formatted.notice) showNotice(formatted.notice);
        return;
      }
      if (formatted.value === targetDraft) {
        showNotice('Already formatted');
        return;
      }
      const prevPos = Math.min(formatted.value.length, textareaRef.current?.selectionStart ?? 0);
      applyEdit({ value: formatted.value, selectionStart: prevPos, selectionEnd: prevPos });
      showNotice('Document formatted');
    } finally {
      setFormatting(false);
    }
  }, [file, isEditable, formatting, draft, applyEdit, showNotice]);

  const handleFormatSelection = useCallback(
    async (selStart?: number, selEnd?: number) => {
      if (!file || !isEditable || formatting) return;
      const start = selStart ?? selectionRange.start;
      const end = selEnd ?? selectionRange.end;
      if (end <= start) {
        await handleFormatDocument();
        return;
      }
      const targetPath = file.path;
      const targetName = file.name;
      const targetDraft = draft;
      setFormatting(true);
      try {
        const formatted = await formatSelectionRangeAsync(targetDraft, targetName, start, end);
        if (activeFilePathRef.current !== targetPath || activeDraftRef.current !== targetDraft) {
          return;
        }
        if (!formatted.ok || !formatted.edit) {
          if (formatted.notice) showNotice(formatted.notice);
          return;
        }
        if (formatted.edit.value === targetDraft) {
          showNotice('Selection already formatted');
          return;
        }
        applyEdit(formatted.edit);
        showNotice('Selection formatted');
      } finally {
        setFormatting(false);
      }
    },
    [file, isEditable, formatting, draft, selectionRange, applyEdit, handleFormatDocument, showNotice]
  );

  const handleSelectAllOccurrences = useCallback(
    (customStart?: number, customEnd?: number) => {
      if (!file || file.isBinary) return;
      const el = textareaRef.current;
      const rawStart = customStart ?? el?.selectionStart ?? activeSelectionRef.current.start;
      const rawEnd = customEnd ?? el?.selectionEnd ?? activeSelectionRef.current.end;
      const selStart = Math.min(rawStart, rawEnd);
      const selEnd = Math.max(rawStart, rawEnd);

      let needle = '';
      let anchorStart = selStart;
      let anchorEnd = selEnd;

      if (selEnd > selStart) {
        needle = draft.slice(selStart, selEnd);
      } else {
        const expanded = expandWordAtOffset(draft, selStart);
        if (!expanded) {
          showNotice('Select text or place cursor on a word to select all occurrences');
          return;
        }
        needle = expanded.text;
        anchorStart = expanded.start;
        anchorEnd = expanded.end;
      }

      if (!needle) return;
      const ranges = findAllTextMatches(draft, needle, true);
      if (ranges.length === 0) return;

      let primaryIndex = ranges.findIndex(
        (r) => r.start <= anchorStart && anchorEnd <= r.end
      );
      if (primaryIndex === -1) {
        primaryIndex = Math.max(
          0,
          ranges.findIndex((r) => r.start >= anchorStart)
        );
      }
      const primary = ranges[primaryIndex] ?? ranges[0];

      setMultiSelection({
        ranges,
        primaryIndex,
        query: needle,
      });
      updateCursorStatsFromOffsets(draft, primary.start, primary.end);
      window.requestAnimationFrame(() => {
        const area = textareaRef.current;
        if (!area) return;
        area.focus();
        area.setSelectionRange(primary.start, primary.end);
      });
    },
    [file, draft, showNotice, updateCursorStatsFromOffsets]
  );

  // Global keyboard shortcuts when Full-Screen IDE is open
  useEffect(() => {
    if (!fullScreen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();

      if (mod && !e.altKey && e.shiftKey && key === 's') {
        e.preventDefault();
        openSaveAsBar();
        return;
      }
      if (mod && !e.altKey && !e.shiftKey && key === 's') {
        e.preventDefault();
        if (file && isEditable && !saving) {
          onSaveFile(file.path, draft);
        }
        return;
      }
      if (mod && !e.altKey && e.shiftKey && (key === 'l' || e.code === 'KeyL')) {
        e.preventDefault();
        handleSelectAllOccurrences();
        return;
      }
      if (mod && !e.altKey && key === 'f') {
        e.preventDefault();
        openFindBar(false);
        return;
      }
      if (mod && !e.altKey && key === 'h') {
        e.preventDefault();
        openFindBar(true);
        return;
      }
      if (mod && !e.altKey && key === 'g') {
        e.preventDefault();
        openGotoLineBar();
        return;
      }
      if (e.shiftKey && e.altKey && (key === 'f' || e.code === 'KeyF')) {
        e.preventDefault();
        if (activeSelectionRef.current.end > activeSelectionRef.current.start) {
          void handleFormatSelection(
            activeSelectionRef.current.start,
            activeSelectionRef.current.end
          );
        } else {
          void handleFormatDocument();
        }
        return;
      }

      if (e.key === 'Escape') {
        if (editorContextMenu) {
          setEditorContextMenu(null);
          return;
        }
        if (multiSelection) {
          setMultiSelection(null);
          textareaRef.current?.focus();
          return;
        }
        const activeEl = document.activeElement as HTMLElement | null;
        if (activeEl && activeEl.closest('[data-code-agent-panel="true"]')) {
          activeEl.blur();
          return;
        }
        if (findOpen) {
          setFindOpen(false);
          setReplaceOpen(false);
          textareaRef.current?.focus();
          return;
        }
        if (gotoOpen) {
          setGotoOpen(false);
          textareaRef.current?.focus();
          return;
        }
        if (saveAsOpen) {
          setSaveAsOpen(false);
          textareaRef.current?.focus();
          return;
        }
        if (creatingInDir !== null) {
          setCreatingInDir(null);
          return;
        }
        if (pendingAction) {
          setPendingAction(null);
          return;
        }
        if (isDirty) {
          setPendingAction({ type: 'exit-fullscreen' });
        } else {
          onToggleFullScreen(false);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    fullScreen,
    file,
    isEditable,
    draft,
    saving,
    findOpen,
    gotoOpen,
    saveAsOpen,
    creatingInDir,
    pendingAction,
    editorContextMenu,
    multiSelection,
    isDirty,
    onSaveFile,
    onToggleFullScreen,
    openFindBar,
    openGotoLineBar,
    openSaveAsBar,
    handleSelectAllOccurrences,
    handleFormatDocument,
    handleFormatSelection,
  ]);

  const handleEditorKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const mod = e.ctrlKey || e.metaKey;
    const key = e.key.toLowerCase();
    const el = e.currentTarget;
    const start = el.selectionStart ?? 0;
    const end = el.selectionEnd ?? 0;

    // Save & Save As
    if (mod && !e.altKey && e.shiftKey && key === 's') {
      e.preventDefault();
      openSaveAsBar();
      return;
    }
    if (mod && !e.altKey && !e.shiftKey && key === 's') {
      e.preventDefault();
      if (file && isEditable && !saving) {
        onSaveFile(file.path, draft);
      }
      return;
    }

    // Select All Occurrences (Ctrl+Shift+L / Cmd+Shift+L)
    if (mod && !e.altKey && e.shiftKey && (key === 'l' || e.code === 'KeyL')) {
      e.preventDefault();
      handleSelectAllOccurrences(start, end);
      return;
    }

    // Find, Replace, Go to Line
    if (mod && !e.altKey && key === 'f') {
      e.preventDefault();
      openFindBar(false);
      return;
    }
    if (mod && !e.altKey && key === 'h') {
      e.preventDefault();
      openFindBar(true);
      return;
    }
    if (mod && !e.altKey && key === 'g') {
      e.preventDefault();
      openGotoLineBar();
      return;
    }

    if (e.key === 'Escape' && multiSelection) {
      e.preventDefault();
      e.stopPropagation();
      setMultiSelection(null);
      return;
    }

    if (
      multiSelection &&
      [
        'ArrowLeft',
        'ArrowRight',
        'ArrowUp',
        'ArrowDown',
        'Home',
        'End',
        'PageUp',
        'PageDown',
      ].includes(e.key)
    ) {
      setMultiSelection(null);
    }

    if (!isEditable || !file) return;

    // Undo (Ctrl+Z) & Redo (Ctrl+Y / Ctrl+Shift+Z)
    if (mod && !e.altKey && !e.shiftKey && key === 'z') {
      e.preventDefault();
      performUndo();
      return;
    }
    if (mod && !e.altKey && (key === 'y' || (e.shiftKey && key === 'z'))) {
      e.preventDefault();
      performRedo();
      return;
    }

    // Delete Line (Ctrl+Shift+K)
    if (mod && !e.altKey && e.shiftKey && key === 'k') {
      e.preventDefault();
      applyEdit(deleteSelectedLines(draft, start, end));
      return;
    }

    // Comment Line (Ctrl+/)
    if (mod && !e.altKey && (key === '/' || e.code === 'Slash')) {
      e.preventDefault();
      applyEdit(toggleCommentLines(draft, start, end, file.name));
      return;
    }

    // Duplicate Line (Shift+Alt+Down / Shift+Alt+Up)
    if (!mod && e.shiftKey && e.altKey && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      e.preventDefault();
      applyEdit(
        duplicateSelectedLines(draft, start, end, e.key === 'ArrowUp' ? 'up' : 'down')
      );
      return;
    }

    // Move Line Up / Down (Alt+Up / Alt+Down)
    if (!mod && !e.shiftKey && e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault();
      applyEdit(
        moveSelectedLines(draft, start, end, e.key === 'ArrowUp' ? 'up' : 'down')
      );
      return;
    }

    // Format Selection / Document (Shift+Alt+F)
    if (!mod && e.shiftKey && e.altKey && (key === 'f' || e.code === 'KeyF')) {
      e.preventDefault();
      if (end > start) {
        void handleFormatSelection(start, end);
      } else {
        void handleFormatDocument();
      }
      return;
    }

    if (e.key === 'Escape' && editorContextMenu) {
      e.preventDefault();
      e.stopPropagation();
      setEditorContextMenu(null);
      return;
    }

    // Smart Auto-Indent New Line (Enter)
    if (!mod && !e.altKey && e.key === 'Enter') {
      e.preventDefault();
      applyEdit(smartNewLineIndent(draft, start, end));
      return;
    }

    // Tab / Shift+Tab Indent
    if (!mod && !e.altKey && e.key === 'Tab') {
      e.preventDefault();
      applyEdit(indentLines(draft, start, end, e.shiftKey));
    }
  };

  const handleSubmitNewFile = (targetDir: string, cleanName: string) => {
    const full = `${targetDir.replace(/\/+$/, '')}/${cleanName}`;
    setCreatingInDir(null);
    onCreateNewFile(full);
  };

  const isPathDirty = useCallback(
    (targetPath: string): boolean => {
      const target = openFiles.find((f) => f.path === targetPath);
      if (!target || target.isBinary || target.truncated) return false;
      if (file && file.path === targetPath) {
        return draft !== target.content;
      }
      const preserved = tabStatesRef.current[targetPath];
      return Boolean(preserved && preserved.draft !== target.content);
    },
    [openFiles, file, draft]
  );

  const handleAttemptCloseFile = () => {
    if (isDirty) {
      setPendingAction({ type: 'close-file' });
    } else {
      onCloseFile();
    }
  };

  const handleAttemptSelectFile = (targetPath: string) => {
    if (file && targetPath === file.path) return;
    if (openFiles.some((f) => f.path === targetPath)) {
      onSelectTab(targetPath);
    } else {
      onOpenFile(targetPath);
    }
  };

  const handleAttemptCloseTab = (targetPath: string) => {
    if (isPathDirty(targetPath)) {
      if (!file || file.path !== targetPath) {
        onSelectTab(targetPath);
      }
      setPendingAction({ type: 'close-tab', path: targetPath });
      return;
    }
    delete tabStatesRef.current[targetPath];
    onCloseTab(targetPath);
  };

  const handleResolvePending = (decision: 'save' | 'discard' | 'cancel') => {
    const act = pendingAction;
    setPendingAction(null);
    if (!act || decision === 'cancel') return;

    if (decision === 'save' && file) {
      onSaveFile(file.path, draft);
    }

    if (act.type === 'switch-file') {
      onOpenFile(act.path);
    } else if (act.type === 'close-file') {
      onCloseFile();
    } else if (act.type === 'close-tab') {
      delete tabStatesRef.current[act.path];
      onCloseTab(act.path);
    } else if (act.type === 'exit-fullscreen') {
      onToggleFullScreen(false);
    }
  };

  const gitFileStatuses = useMemo(() => {
    const map: Record<string, { letter: string; title: string; className: string }> = {};
    if (!gitStatus?.isRepo) return map;
    for (const change of gitStatus.changes) {
      map[change.fullPath] = getGitBadgeMeta(change, change.staged && !change.unstaged ? 'staged' : 'unstaged');
    }
    return map;
  }, [gitStatus]);

  const handleInspectGitChange = useCallback(
    async (change: GitFileChange, staged: boolean) => {
      if (!onRunGit) return;
      const cwd = gitStatus?.repoRoot || currentRemotePath;
      try {
        const res = await onRunGit(
          'diff',
          { path: change.path, staged, untracked: change.untracked },
          cwd
        );
        setPreviewingNewFile(null);
        setGitDiffView({
          kind: 'file',
          change,
          staged,
          diffText: typeof res.diffText === 'string' ? res.diffText : '',
          newFilePreview:
            typeof res.newFilePreview === 'string' ? res.newFilePreview : undefined,
        });
      } catch (err) {
        showNotice(err instanceof Error ? err.message : 'Unable to load Git diff.');
      }
    },
    [onRunGit, gitStatus?.repoRoot, currentRemotePath, showNotice]
  );

  const handleInspectGitCommit = useCallback(
    async (commit: GitCommitInfo) => {
      if (!onRunGit) return;
      const cwd = gitStatus?.repoRoot || currentRemotePath;
      try {
        const res = await onRunGit('commitDetails', { hash: commit.hash }, cwd);
        setPreviewingNewFile(null);
        setGitDiffView({
          kind: 'commit',
          commit,
          diffText: typeof res.diffText === 'string' ? res.diffText : '',
        });
      } catch (err) {
        showNotice(err instanceof Error ? err.message : 'Unable to load commit diff.');
      }
    },
    [onRunGit, gitStatus?.repoRoot, currentRemotePath, showNotice]
  );

  const renderTabBar = () => {
    if (openFiles.length === 0) return null;
    return (
      <div
        role="tablist"
        aria-label="Open remote files"
        className="shrink-0 h-9 border-b border-white/[0.08] bg-[#111116] flex items-stretch overflow-x-auto"
      >
        {openFiles.map((tab) => {
          const isActiveTab = Boolean(file && file.path === tab.path && !gitDiffView && !previewingNewFile);
          const tabDirty = isPathDirty(tab.path);
          return (
            <div
              key={tab.path}
              role="tab"
              aria-selected={isActiveTab}
              draggable
              onDragStart={(e) => {
                e.stopPropagation();
                const payload: DraggedRemoteEntry = {
                  path: tab.path,
                  name: tab.name,
                  isDirectory: false,
                  size: tab.size,
                };
                e.dataTransfer.setData(REMOTE_ENTRY_DRAG_MIME, JSON.stringify(payload));
                e.dataTransfer.setData('text/plain', tab.path);
                e.dataTransfer.effectAllowed = 'copy';
              }}
              onMouseDown={(e) => {
                if (e.button === 1) {
                  e.preventDefault();
                  handleAttemptCloseTab(tab.path);
                }
              }}
              onClick={() => {
                setGitDiffView(null);
                setPreviewingNewFile(null);
                if (!file || file.path !== tab.path) {
                  onSelectTab(tab.path);
                }
              }}
              title={`${tab.path} (drag to AI Agent or click × to close)`}
              className={`group shrink-0 max-w-[200px] flex items-center gap-1.5 pl-2.5 pr-1.5 border-r select-none cursor-pointer transition-colors ${
                isActiveTab
                  ? 'bg-[#0c0c10] text-white border-t-2 border-t-blue-500 border-r-white/[0.08]'
                  : 'bg-[#14141a] text-neutral-400 hover:text-neutral-200 hover:bg-[#191922] border-t-2 border-t-transparent border-r-white/[0.06]'
              }`}
            >
              <FileText className={`w-3.5 h-3.5 shrink-0 ${getFileIconColorClass(tab.name)}`} />
              <span className="font-mono-code text-[11.5px] truncate">{tab.name}</span>
              {tabDirty && (
                <span
                  title="Unsaved changes"
                  className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0"
                />
              )}
              <button
                type="button"
                aria-label={`Close ${tab.name}`}
                title={`Close ${tab.name}`}
                onClick={(e) => {
                  e.stopPropagation();
                  handleAttemptCloseTab(tab.path);
                }}
                className={`p-0.5 rounded transition-colors cursor-pointer shrink-0 ${
                  isActiveTab
                    ? 'text-neutral-400 hover:text-white hover:bg-white/15'
                    : 'text-neutral-500 hover:text-white hover:bg-white/15'
                }`}
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          );
        })}
      </div>
    );
  };

  const renderCodeArea = (isFull: boolean) => {
    if (gitDiffView) {
      const isCommit = gitDiffView.kind === 'commit';
      const rawLines = (
        gitDiffView.kind === 'file' && gitDiffView.change.untracked
          ? (gitDiffView.newFilePreview || '')
              .split('\n')
              .map((l) => `+${l}`)
          : gitDiffView.diffText.split('\n')
      );

      return (
        <div className="flex-1 min-h-0 flex flex-col overflow-hidden bg-[#0c0c10]">
          <div className="shrink-0 px-3 py-1.5 border-b border-blue-500/25 bg-[#121622] flex flex-wrap items-center justify-between gap-2 text-[12px]">
            <div className="flex items-center gap-2 min-w-0">
              {isCommit ? (
                <GitCommitHorizontal className="w-3.5 h-3.5 text-blue-400 shrink-0" />
              ) : (
                <GitBranch className="w-3.5 h-3.5 text-blue-400 shrink-0" />
              )}
              <span className="font-medium text-neutral-100 truncate">
                {gitDiffView.kind === 'commit'
                  ? `Commit ${gitDiffView.commit.shortHash}: ${gitDiffView.commit.message}`
                  : `${gitDiffView.staged ? 'Staged Diff' : 'Working Tree Diff'}: ${
                      gitDiffView.change.path
                    }`}
              </span>
            </div>

            <div className="flex items-center gap-1.5 shrink-0">
              {gitDiffView.kind === 'file' && (
                <>
                  {onRunGit && (
                    <button
                      type="button"
                      onClick={() => {
                        const target = gitDiffView.change;
                        const wasStaged = gitDiffView.staged;
                        const cwd = gitStatus?.repoRoot || currentRemotePath;
                        void onRunGit(
                          wasStaged ? 'unstage' : 'stage',
                          { paths: [target.path] },
                          cwd
                        ).then(async () => {
                          await onRefreshGit?.();
                          await handleInspectGitChange(target, !wasStaged);
                        });
                      }}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-blue-600 hover:bg-blue-700 text-white text-[11.5px] font-medium cursor-pointer"
                    >
                      <span>{gitDiffView.staged ? 'Unstage File' : 'Stage File'}</span>
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      const targetPath = gitDiffView.change.fullPath;
                      setGitDiffView(null);
                      onOpenFile(targetPath);
                    }}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-white/15 bg-white/5 hover:bg-white/10 text-neutral-100 text-[11.5px] font-medium cursor-pointer"
                  >
                    <FileText className="w-3.5 h-3.5" />
                    <span>Open File</span>
                  </button>
                </>
              )}
              <button
                type="button"
                onClick={() => setGitDiffView(null)}
                className="inline-flex items-center gap-1 px-2 py-1 rounded text-neutral-400 hover:text-white text-[11.5px] cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
                <span>Close Diff</span>
              </button>
            </div>
          </div>

          <div className="flex-1 min-h-0 overflow-auto py-2 font-mono-code text-[12.5px] leading-[20px]">
            {rawLines.length === 0 || (rawLines.length === 1 && rawLines[0] === '') ? (
              <div className="px-4 py-6 text-center text-neutral-500 font-sans text-[13px]">
                No textual differences to display.
              </div>
            ) : (
              rawLines.map((line, idx) => {
                const isAdd = line.startsWith('+') && !line.startsWith('+++');
                const isDel = line.startsWith('-') && !line.startsWith('---');
                const isHunk = line.startsWith('@@');
                const isMeta =
                  line.startsWith('diff ') ||
                  line.startsWith('index ') ||
                  line.startsWith('+++') ||
                  line.startsWith('---') ||
                  line.startsWith('commit ') ||
                  line.startsWith('Author:') ||
                  line.startsWith('Date:');
                return (
                  <div
                    key={idx}
                    className={`flex min-w-max px-3.5 whitespace-pre ${
                      isAdd
                        ? 'bg-emerald-500/16 text-emerald-200 border-l-2 border-emerald-400'
                        : isDel
                        ? 'bg-red-500/16 text-red-200 border-l-2 border-red-400'
                        : isHunk
                        ? 'bg-blue-500/14 text-blue-300 border-l-2 border-blue-400/70'
                        : isMeta
                        ? 'text-neutral-400'
                        : 'text-neutral-200'
                    }`}
                  >
                    {line || ' '}
                  </div>
                );
              })
            )}
          </div>
        </div>
      );
    }

    if (previewingNewFile) {
      const newFileName = previewingNewFile.path.split('/').pop() || 'new-file';
      const newLines = (previewingNewFile.newFileContent ?? '').replace(/\r\n/g, '\n').split('\n');
      const gutterWidthClass = isFull ? 'w-14 pr-3' : 'w-10 pr-2';

      return (
        <div className="flex-1 min-h-0 flex flex-col overflow-hidden bg-[#0c0c10]">
          <div className="shrink-0 px-3 py-1.5 border-b border-emerald-500/25 bg-[#121820] flex flex-wrap items-center justify-between gap-2 text-[12px]">
            <div className="flex items-center gap-2 min-w-0">
              <FilePlus2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
              <span className="font-medium text-neutral-100 truncate">
                New File: {previewingNewFile.path}
              </span>
              <span className="font-mono-code text-[11px] text-emerald-300">
                +{newLines.length} lines
              </span>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <button
                type="button"
                disabled={applyingTrackedChanges}
                onClick={() => void handleAcceptTrackedChange(previewingNewFile.id)}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-emerald-600 hover:bg-emerald-700 disabled:opacity-45 text-white text-[11.5px] font-medium cursor-pointer"
              >
                <Check className="w-3.5 h-3.5" />
                <span>Accept & Create File</span>
              </button>
              <button
                type="button"
                disabled={applyingTrackedChanges}
                onClick={() => handleRejectTrackedChange(previewingNewFile.id)}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-white/15 bg-white/5 hover:bg-white/10 text-neutral-200 text-[11.5px] font-medium cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
                <span>Reject</span>
              </button>
              <button
                type="button"
                onClick={() => setPreviewingNewFile(null)}
                className="px-2 py-1 rounded text-neutral-400 hover:text-white text-[11.5px] cursor-pointer"
              >
                Close Preview
              </button>
            </div>
          </div>

          <div
            className={`flex-1 min-h-0 overflow-auto py-2 font-mono-code ${
              isFull ? 'text-[13px] leading-[21px]' : 'text-[11.5px] leading-[19px]'
            }`}
          >
            {newLines.map((lineText, idx) => (
              <div
                key={idx}
                className="flex min-w-max bg-emerald-500/14 border-l-2 border-emerald-400"
              >
                <div
                  className={`${gutterWidthClass} shrink-0 select-none text-right bg-emerald-950/35 border-r border-emerald-500/20 text-emerald-300 tabular-nums`}
                >
                  + {idx + 1}
                </div>
                <div
                  className="code-highlight-layer flex-1 px-3.5 whitespace-pre"
                  dangerouslySetInnerHTML={{
                    __html: highlightCodeToHtml(lineText || ' ', newFileName),
                  }}
                />
              </div>
            ))}
          </div>
        </div>
      );
    }

    if (!file) {
      return (
        <div className="flex-1 min-w-0 flex flex-col items-center justify-center p-8 text-center bg-[#0c0c10]">
          <FolderOpen className="w-10 h-10 text-blue-400/80 mb-3" />
          <h2 className="text-[15px] font-semibold text-white mb-1">
            {currentRemotePath || 'Project Workspace'}
          </h2>
          <p className="text-[13px] text-neutral-400 max-w-md mb-5">
            Expand any subdirectory in the Explorer on the left and select a source file to view or
            edit with full syntax highlighting.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-2">
            <button
              type="button"
              onClick={() => {
                if (currentRemotePath) setCreatingInDir(currentRemotePath);
                if (!explorerOpen) setExplorerOpen(true);
              }}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-[12.5px] font-medium cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>New File</span>
            </button>
            <button
              type="button"
              onClick={() => setAiAgentOpen(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-blue-500/40 bg-blue-500/15 hover:bg-blue-500/25 text-blue-200 text-[12.5px] font-medium cursor-pointer"
            >
              <Bot className="w-3.5 h-3.5" />
              <span>Ask AI Agent</span>
            </button>
            <button
              type="button"
              onClick={() => onToggleFullScreen(false)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-white/12 text-neutral-200 hover:bg-white/10 text-[12.5px] font-medium cursor-pointer"
            >
              <Minimize2 className="w-3.5 h-3.5" />
              <span>Back to Terminal</span>
            </button>
          </div>
          <div className="mt-6 grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-1.5 text-[11.5px] text-neutral-500 font-mono-code">
            <span>Ctrl+S · Save</span>
            <span>Ctrl+Shift+S · Save As</span>
            <span>Ctrl+F / H · Find & Replace</span>
            <span>Ctrl+Shift+L · Select All Same</span>
            <span>Ctrl+/ · Comment Line</span>
            <span>Shift+Alt+F · Format</span>
          </div>
        </div>
      );
    }

    if (file.isBinary) {
      return (
        <div className="flex-1 flex items-center justify-center p-6 text-center text-[13px] text-neutral-400 bg-[#0c0c10]">
          Binary file ({formatBytes(file.size)}). Source editing is disabled for binary files.
        </div>
      );
    }

    return (
      <div className="flex-1 min-h-0 flex flex-col overflow-hidden bg-[#0c0c10] relative">
        {file.truncated && (
          <div className="shrink-0 px-3 py-1.5 border-b border-amber-500/25 bg-amber-500/10 text-[11.5px] text-amber-200 flex items-center gap-2">
            <AlertCircle className="w-3.5 h-3.5 shrink-0" />
            <span>
              File exceeds 512 KB ({formatBytes(file.size)}). Opened read-only to prevent
              truncation.
            </span>
          </div>
        )}

        {saveError && (
          <div className="shrink-0 px-3 py-1.5 border-b border-red-500/30 bg-red-500/10 text-[11.5px] text-red-300 flex items-center gap-2">
            <AlertCircle className="w-3.5 h-3.5 shrink-0" />
            <span>{saveError}</span>
          </div>
        )}

        {actionNotice && (
          <div className="shrink-0 px-3 py-1 border-b border-blue-500/25 bg-blue-500/10 text-[11.5px] text-blue-200 flex items-center justify-between gap-2">
            <span>{actionNotice}</span>
            <button
              type="button"
              onClick={() => setActionNotice(null)}
              className="text-blue-300 hover:text-white cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {multiSelection && (
          <div className="shrink-0 px-3 py-1 border-b border-blue-500/35 bg-blue-600/15 text-[11.5px] text-blue-100 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <span className="inline-block w-2 h-2 rounded-full bg-blue-400 shrink-0" />
              <span className="font-medium truncate">
                {multiSelection.ranges.length} occurrence
                {multiSelection.ranges.length === 1 ? '' : 's'} selected
              </span>
              {isEditable && (
                <span className="hidden sm:inline text-blue-300/85">
                  · Type to edit all simultaneously · Esc to exit
                </span>
              )}
            </div>
            <button
              type="button"
              onClick={() => {
                setMultiSelection(null);
                textareaRef.current?.focus();
              }}
              className="px-2 py-0.5 rounded border border-blue-400/30 bg-blue-500/20 hover:bg-blue-500/35 text-[10.5px] font-medium text-blue-100 cursor-pointer shrink-0"
            >
              Exit (Esc)
            </button>
          </div>
        )}

        {saveAsOpen && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const clean = saveAsPath.trim();
              if (!clean) return;
              setSaveAsOpen(false);
              onSaveAsFile(clean, draft);
            }}
            className="shrink-0 px-3 py-2 border-b border-white/[0.08] bg-[#14141b] flex flex-wrap items-center gap-2"
          >
            <span className="text-[11.5px] font-medium text-neutral-300 whitespace-nowrap">
              Save As Path:
            </span>
            <input
              ref={saveAsInputRef}
              type="text"
              value={saveAsPath}
              onChange={(e) => setSaveAsPath(e.target.value)}
              placeholder="/path/to/new-file.ts"
              className="font-mono-code flex-1 min-w-[200px] px-2.5 py-1 text-[12px] rounded border border-white/15 bg-[#0c0c10] text-white placeholder:text-neutral-500 focus:outline-none focus:border-blue-500"
            />
            <button
              type="submit"
              disabled={saving || !saveAsPath.trim()}
              className="px-2.5 py-1 rounded bg-blue-600 hover:bg-blue-700 disabled:opacity-45 text-white text-[11.5px] font-medium cursor-pointer whitespace-nowrap"
            >
              Save Copy
            </button>
            <button
              type="button"
              onClick={() => setSaveAsOpen(false)}
              className="p-1 text-neutral-400 hover:text-white cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </form>
        )}

        {gotoOpen && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const [linePart, colPart] = gotoInput.trim().split(':');
              const lineNum = Number(linePart);
              const colNum = colPart ? Number(colPart) : 1;
              if (!Number.isFinite(lineNum) || lineNum < 1) return;
              const { offset, clampedLine } = getOffsetForLineCol(
                draft,
                lineNum,
                Number.isFinite(colNum) ? colNum : 1
              );
              setGotoOpen(false);
              scrollLineIntoView(clampedLine);
              updateCursorStatsFromOffsets(draft, offset);
              window.requestAnimationFrame(() => {
                const el = textareaRef.current;
                if (!el) return;
                el.focus();
                el.setSelectionRange(offset, offset);
              });
            }}
            className="shrink-0 px-3 py-2 border-b border-white/[0.08] bg-[#14141b] flex items-center gap-2"
          >
            <Hash className="w-3.5 h-3.5 text-blue-400 shrink-0" />
            <span className="text-[11.5px] font-medium text-neutral-300 whitespace-nowrap">
              Go to Line (1–{lineCount}):
            </span>
            <input
              ref={gotoInputRef}
              type="text"
              value={gotoInput}
              onChange={(e) => setGotoInput(e.target.value)}
              placeholder="Line or Line:Col"
              className="font-mono-code w-32 px-2.5 py-1 text-[12px] rounded border border-white/15 bg-[#0c0c10] text-white placeholder:text-neutral-500 focus:outline-none focus:border-blue-500"
            />
            <button
              type="submit"
              className="px-2.5 py-1 rounded bg-blue-600 hover:bg-blue-700 text-white text-[11.5px] font-medium cursor-pointer"
            >
              Jump
            </button>
            <button
              type="button"
              onClick={() => setGotoOpen(false)}
              className="p-1 text-neutral-400 hover:text-white cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </form>
        )}

        {findOpen && (
          <div className="shrink-0 px-3 py-2 border-b border-white/[0.08] bg-[#14141b] flex flex-col gap-1.5">
            <div className="flex flex-wrap items-center gap-1.5">
              <Search className="w-3.5 h-3.5 text-neutral-400 shrink-0" />
              <input
                ref={findInputRef}
                type="text"
                value={findQuery}
                onChange={(e) => {
                  setFindQuery(e.target.value);
                  setActiveMatchIdx(0);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    jumpToMatch(e.shiftKey ? activeMatchIdx - 1 : activeMatchIdx + 1, false);
                    findInputRef.current?.focus();
                  }
                }}
                placeholder="Find in file..."
                className="font-mono-code flex-1 min-w-[160px] px-2.5 py-1 text-[12px] rounded border border-white/15 bg-[#0c0c10] text-white placeholder:text-neutral-500 focus:outline-none focus:border-blue-500"
              />
              <button
                type="button"
                onClick={() => setCaseSensitive((p) => !p)}
                title="Match Case"
                className={`px-2 py-1 rounded text-[11px] font-mono-code border cursor-pointer ${
                  caseSensitive
                    ? 'border-blue-500/60 bg-blue-500/20 text-blue-300'
                    : 'border-white/10 text-neutral-400 hover:text-white'
                }`}
              >
                Aa
              </button>
              <span className="text-[11px] text-neutral-400 tabular-nums px-1 min-w-[64px] text-center">
                {findQuery
                  ? matches.length > 0
                    ? `${activeMatchIdx + 1} / ${matches.length}`
                    : '0 matches'
                  : ''}
              </span>
              <button
                type="button"
                disabled={matches.length === 0}
                onClick={() => jumpToMatch(activeMatchIdx - 1, true)}
                title="Previous Match (Shift+Enter)"
                className="p-1 rounded border border-white/10 text-neutral-300 hover:bg-white/10 disabled:opacity-35 cursor-pointer"
              >
                <ChevronUp className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                disabled={matches.length === 0}
                onClick={() => jumpToMatch(activeMatchIdx + 1, true)}
                title="Next Match (Enter)"
                className="p-1 rounded border border-white/10 text-neutral-300 hover:bg-white/10 disabled:opacity-35 cursor-pointer"
              >
                <ChevronDown className="w-3.5 h-3.5" />
              </button>
              {isEditable && (
                <button
                  type="button"
                  onClick={() => setReplaceOpen((p) => !p)}
                  title="Toggle Replace (Ctrl+H)"
                  className={`p-1 rounded border cursor-pointer ${
                    replaceOpen
                      ? 'border-blue-500/50 bg-blue-500/20 text-blue-300'
                      : 'border-white/10 text-neutral-300 hover:bg-white/10'
                  }`}
                >
                  <Replace className="w-3.5 h-3.5" />
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  setFindOpen(false);
                  setReplaceOpen(false);
                }}
                title="Close Find (Esc)"
                className="p-1 text-neutral-400 hover:text-white cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>

            {replaceOpen && isEditable && (
              <div className="flex flex-wrap items-center gap-1.5 pl-5">
                <input
                  type="text"
                  value={replaceQuery}
                  onChange={(e) => setReplaceQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleReplaceOne();
                    }
                  }}
                  placeholder="Replace with..."
                  className="font-mono-code flex-1 min-w-[160px] px-2.5 py-1 text-[12px] rounded border border-white/15 bg-[#0c0c10] text-white placeholder:text-neutral-500 focus:outline-none focus:border-blue-500"
                />
                <button
                  type="button"
                  disabled={matches.length === 0}
                  onClick={handleReplaceOne}
                  className="px-2.5 py-1 rounded border border-white/12 bg-white/5 hover:bg-white/10 disabled:opacity-35 text-[11.5px] font-medium text-neutral-200 cursor-pointer"
                >
                  Replace
                </button>
                <button
                  type="button"
                  disabled={matches.length === 0}
                  onClick={handleReplaceAll}
                  className="px-2.5 py-1 rounded bg-blue-600 hover:bg-blue-700 disabled:opacity-35 text-[11.5px] font-medium text-white cursor-pointer"
                >
                  Replace All
                </button>
              </div>
            )}
          </div>
        )}

        {pendingAction && (
          <div className="shrink-0 px-3 py-2 border-b border-amber-500/30 bg-amber-500/10 text-[12px] text-amber-100 flex flex-wrap items-center justify-between gap-2">
            <span>You have unsaved changes in {file.name}.</span>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => handleResolvePending('save')}
                className="px-2.5 py-1 rounded-md bg-blue-600 hover:bg-blue-700 text-white text-[11.5px] font-medium cursor-pointer"
              >
                Save & Continue
              </button>
              <button
                type="button"
                onClick={() => handleResolvePending('discard')}
                className="px-2.5 py-1 rounded-md border border-white/15 bg-white/5 hover:bg-white/10 text-neutral-200 text-[11.5px] font-medium cursor-pointer"
              >
                Discard
              </button>
              <button
                type="button"
                onClick={() => handleResolvePending('cancel')}
                className="px-2 py-1 rounded-md text-neutral-300 hover:text-white text-[11.5px] cursor-pointer"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {pendingHunks.length > 0 && isEditable ? (
          <>
            <div className="shrink-0 px-3 py-1.5 border-b border-emerald-500/25 bg-[#121820] flex flex-wrap items-center justify-between gap-2 text-[12px]">
              <div className="flex items-center gap-2 min-w-0">
                <Bot className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                <span className="font-medium text-neutral-100">
                  {pendingHunks.length} {pendingHunks.length === 1 ? 'change' : 'changes'} to review
                </span>
                <span className="font-mono-code text-[11px] text-emerald-300">
                  +{pendingHunks.reduce((acc, h) => acc + h.newLines.length, 0)}
                </span>
                <span className="font-mono-code text-[11px] text-red-300">
                  -{pendingHunks.reduce((acc, h) => acc + h.oldLines.length, 0)}
                </span>
                <span className="hidden md:inline text-[11px] text-neutral-400">
                  · Highlighted under old code — click any line or change to accept
                </span>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  type="button"
                  onClick={handleAcceptAllPendingDiffs}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-emerald-600 hover:bg-emerald-700 text-white text-[11.5px] font-medium cursor-pointer"
                >
                  <Check className="w-3.5 h-3.5" />
                  <span>Accept All</span>
                </button>
                <button
                  type="button"
                  onClick={handleRejectAllPendingDiffs}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-white/15 bg-white/5 hover:bg-white/10 text-neutral-200 text-[11.5px] font-medium cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                  <span>Reject All</span>
                </button>
              </div>
            </div>

            <div
              ref={diffScrollRef}
              className={`flex-1 min-h-0 overflow-auto bg-[#0c0c10] py-2 font-mono-code ${
                isFull ? 'text-[13px] leading-[21px]' : 'text-[11.5px] leading-[19px]'
              }`}
            >
              {(() => {
                const draftLines = draft.replace(/\r\n/g, '\n').split('\n');
                const sorted = [...pendingHunks].sort((a, b) => a.startLine - b.startLine);
                const segments: Array<
                  | { kind: 'context'; startLine: number; lines: string[] }
                  | { kind: 'hunk'; hunk: PendingDiffHunk }
                > = [];

                let cursorIdx = 0;
                for (const h of sorted) {
                  const hunkStartIdx = Math.max(
                    cursorIdx,
                    Math.min(draftLines.length, h.startLine - 1)
                  );
                  if (hunkStartIdx > cursorIdx) {
                    segments.push({
                      kind: 'context',
                      startLine: cursorIdx + 1,
                      lines: draftLines.slice(cursorIdx, hunkStartIdx),
                    });
                  }
                  segments.push({ kind: 'hunk', hunk: h });
                  cursorIdx = Math.min(draftLines.length, hunkStartIdx + h.oldLines.length);
                }
                if (cursorIdx < draftLines.length) {
                  segments.push({
                    kind: 'context',
                    startLine: cursorIdx + 1,
                    lines: draftLines.slice(cursorIdx),
                  });
                }

                const gutterWidthClass = isFull ? 'w-14 pr-3' : 'w-10 pr-2';

                return segments.map((seg, sIdx) => {
                  if (seg.kind === 'context') {
                    return (
                      <div key={`ctx-${sIdx}`}>
                        {seg.lines.map((lineText, lIdx) => (
                          <div key={`cl-${seg.startLine + lIdx}`} className="flex min-w-max">
                            <div
                              className={`${gutterWidthClass} shrink-0 select-none text-right bg-[#101016] border-r border-white/[0.06] text-neutral-600 tabular-nums`}
                            >
                              {seg.startLine + lIdx}
                            </div>
                            <div
                              className="code-highlight-layer flex-1 px-3.5 whitespace-pre"
                              dangerouslySetInnerHTML={{
                                __html: highlightCodeToHtml(lineText || ' ', file.name),
                              }}
                            />
                          </div>
                        ))}
                      </div>
                    );
                  }

                  const { hunk } = seg;
                  return (
                    <div
                      key={hunk.id}
                      data-diff-hunk-id={hunk.id}
                      className="my-1 border-y border-white/12 bg-[#10131b]"
                    >
                      {/* Inline Hunk Header Bar */}
                      <div className="px-3 py-1 bg-[#161a24] border-b border-white/[0.08] flex flex-wrap items-center justify-between gap-2 font-sans text-[11px]">
                        <div className="flex items-center gap-2 min-w-0 text-neutral-300">
                          <span className="font-mono-code text-neutral-400">
                            Ln {hunk.startLine}
                          </span>
                          {hunk.description && (
                            <span className="truncate text-neutral-300">{hunk.description}</span>
                          )}
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <button
                            type="button"
                            onClick={() => handleAcceptHunk(hunk.id)}
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-medium cursor-pointer"
                          >
                            <Check className="w-3 h-3" />
                            <span>
                              {hunk.newLines.length === 0 ? 'Accept Delete' : 'Accept Change'}
                            </span>
                          </button>
                          <button
                            type="button"
                            onClick={() => handleRejectHunk(hunk.id)}
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded border border-white/15 bg-white/5 hover:bg-white/10 text-neutral-300 text-[11px] font-medium cursor-pointer"
                          >
                            <X className="w-3 h-3" />
                            <span>Reject</span>
                          </button>
                        </div>
                      </div>

                      {/* Old Code Highlighted Above */}
                      {hunk.oldLines.map((oldLine, oIdx) => (
                        <div
                          key={`${hunk.id}-old-${oIdx}`}
                          className="flex min-w-max bg-red-500/14 border-l-2 border-red-400/85"
                        >
                          <div
                            className={`${gutterWidthClass} shrink-0 select-none text-right bg-red-950/35 border-r border-red-500/20 text-red-300/80 tabular-nums`}
                          >
                            - {hunk.startLine + oIdx}
                          </div>
                          <div className="flex-1 px-3.5 whitespace-pre text-red-200/85">
                            {oldLine || ' '}
                          </div>
                        </div>
                      ))}

                      {/* Updated New Code Highlighted Directly Under Old Code (Click Any Line to Accept) */}
                      {hunk.newLines.map((newLine, nIdx) => (
                        <div
                          key={`${hunk.id}-new-${nIdx}`}
                          className="group flex items-center min-w-max bg-emerald-500/18 hover:bg-emerald-500/26 border-l-2 border-emerald-400 transition-colors"
                        >
                          <div
                            className={`${gutterWidthClass} shrink-0 select-none text-right bg-emerald-950/35 border-r border-emerald-500/25 text-emerald-300 tabular-nums`}
                          >
                            + {hunk.startLine + nIdx}
                          </div>
                          <div
                            className="code-highlight-layer flex-1 px-3.5 whitespace-pre"
                            dangerouslySetInnerHTML={{
                              __html: highlightCodeToHtml(newLine || ' ', file.name),
                            }}
                          />
                          <button
                            type="button"
                            onClick={() => handleAcceptSingleLine(hunk.id, nIdx)}
                            title="Click to accept this changed line"
                            className="sticky right-2 mr-2 ml-3 shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-600/90 hover:bg-emerald-500 text-white font-sans text-[10.5px] font-medium opacity-85 group-hover:opacity-100 cursor-pointer shadow-sm"
                          >
                            <Check className="w-3 h-3" />
                            <span>Accept line</span>
                          </button>
                        </div>
                      ))}
                    </div>
                  );
                });
              })()}
            </div>
          </>
        ) : (
          <div className="flex-1 min-h-0 flex overflow-hidden relative">
            {/* Synchronized Line Numbers Gutter */}
            <div
              ref={gutterRef}
              aria-hidden="true"
              className={`shrink-0 select-none overflow-hidden bg-[#101016] border-r border-white/[0.06] text-right font-mono-code tabular-nums py-3 ${
                isFull ? 'w-14 text-[13px] leading-[21px]' : 'w-10 text-[11.5px] leading-[19px]'
              }`}
            >
              {Array.from({ length: lineCount }, (_, idx) => {
                const isActiveLine = idx + 1 === cursorPos.line;
                return (
                  <div
                    key={idx}
                    className={`${isFull ? 'pr-3' : 'pr-2'} ${
                      isActiveLine ? 'text-blue-400 bg-white/[0.04]' : 'text-neutral-600'
                    }`}
                  >
                    {idx + 1}
                  </div>
                );
              })}
            </div>

            {/* Syntax-Highlighted <pre> Overlay + Editable Transparent <textarea> */}
            <div className="flex-1 min-w-0 min-h-0 relative overflow-hidden bg-[#0c0c10]">
              {!wordWrap && (
                <div
                  aria-hidden="true"
                  className="absolute left-0 right-0 bg-white/[0.035] pointer-events-none"
                  style={{
                    top: `${12 + (cursorPos.line - 1) * (isFull ? 21 : 19) - editorScrollTop}px`,
                    height: `${isFull ? 21 : 19}px`,
                  }}
                />
              )}

              <pre
                ref={preRef}
                aria-hidden="true"
                style={{ tabSize: 2 }}
                className={`code-highlight-layer sync-scroll-ghost absolute inset-0 m-0 py-3 px-3.5 overflow-auto pointer-events-none select-none font-mono-code ${
                  isFull ? 'text-[13px] leading-[21px]' : 'text-[11.5px] leading-[19px]'
                } ${wordWrap ? 'whitespace-pre-wrap break-words' : 'whitespace-pre'}`}
                dangerouslySetInnerHTML={{ __html: highlightedHtml }}
              />

              {multiSelectionHtml && (
                <pre
                  ref={selectionOverlayRef}
                  aria-hidden="true"
                  style={{ tabSize: 2 }}
                  className={`sync-scroll-ghost absolute inset-0 m-0 py-3 px-3.5 overflow-auto pointer-events-none select-none text-transparent font-mono-code ${
                    isFull ? 'text-[13px] leading-[21px]' : 'text-[11.5px] leading-[19px]'
                  } ${wordWrap ? 'whitespace-pre-wrap break-words' : 'whitespace-pre'}`}
                  dangerouslySetInnerHTML={{ __html: multiSelectionHtml }}
                />
              )}

              <textarea
                ref={textareaRef}
                value={draft}
                readOnly={file.truncated}
                spellCheck={false}
                autoCapitalize="off"
                autoComplete="off"
                autoCorrect="off"
                style={{ tabSize: 2, caretColor: '#60a5fa' }}
                onChange={(e) => {
                  const val = e.target.value;
                  const pos = e.target.selectionStart ?? 0;
                  const endPos = e.target.selectionEnd ?? pos;
                  const prevScrollTop = e.currentTarget.scrollTop;
                  const prevScrollLeft = e.currentTarget.scrollLeft;

                  // 1. Live multi-occurrence edit (Ctrl+Shift+L)
                  if (multiSelection && multiSelection.ranges.length > 0 && isEditable) {
                    const multi = applyMultiRangeEdit(
                      draft,
                      val,
                      pos,
                      multiSelection.ranges,
                      multiSelection.primaryIndex
                    );
                    if (multi) {
                      const p = multi.ranges[multi.primaryIndex] ?? { start: pos, end: pos };
                      setDraft(multi.value);
                      setMultiSelection({
                        ...multiSelection,
                        ranges: multi.ranges,
                        primaryIndex: multi.primaryIndex,
                      });
                      pushHistory(
                        { value: multi.value, selectionStart: p.start, selectionEnd: p.end },
                        true
                      );
                      updateCursorStatsFromOffsets(multi.value, p.start, p.end);
                      window.requestAnimationFrame(() => {
                        const area = textareaRef.current;
                        if (!area) return;
                        area.setSelectionRange(p.start, p.end);
                        area.scrollTop = prevScrollTop;
                        area.scrollLeft = prevScrollLeft;
                        if (preRef.current) {
                          preRef.current.scrollTop = prevScrollTop;
                          preRef.current.scrollLeft = prevScrollLeft;
                        }
                        if (selectionOverlayRef.current) {
                          selectionOverlayRef.current.scrollTop = prevScrollTop;
                          selectionOverlayRef.current.scrollLeft = prevScrollLeft;
                        }
                      });
                      return;
                    }
                  }

                  // 2. Auto Rename Tag (HTML / XML / SVG / JSX / TSX / Vue / Svelte)
                  if (isEditable && file) {
                    const renamed = applyAutoRenameTag(draft, val, pos, file.name);
                    if (renamed) {
                      setDraft(renamed.value);
                      pushHistory(
                        {
                          value: renamed.value,
                          selectionStart: renamed.selectionStart,
                          selectionEnd: renamed.selectionEnd,
                        },
                        true
                      );
                      updateCursorStatsFromOffsets(
                        renamed.value,
                        renamed.selectionStart,
                        renamed.selectionEnd
                      );
                      window.requestAnimationFrame(() => {
                        const area = textareaRef.current;
                        if (!area) return;
                        area.setSelectionRange(renamed.selectionStart, renamed.selectionEnd);
                        area.scrollTop = prevScrollTop;
                        area.scrollLeft = prevScrollLeft;
                        if (preRef.current) {
                          preRef.current.scrollTop = prevScrollTop;
                          preRef.current.scrollLeft = prevScrollLeft;
                        }
                      });
                      return;
                    }
                  }

                  // 3. Normal single-cursor edit
                  setDraft(val);
                  const lastChar = val[Math.max(0, pos - 1)] ?? '';
                  const boundaryChar = lastChar === '\n' || lastChar === ' ';
                  pushHistory(
                    { value: val, selectionStart: pos, selectionEnd: endPos },
                    !boundaryChar
                  );
                  updateCursorStatsFromOffsets(val, pos, endPos);
                }}
                onClick={() => {
                  setEditorContextMenu(null);
                  setMultiSelection(null);
                  updateCursorStats();
                }}
                onKeyUp={updateCursorStats}
                onSelect={() => {
                  if (!multiSelection) {
                    updateCursorStats();
                  }
                }}
                onContextMenu={(e) => {
                  if (!file || file.isBinary) return;
                  e.preventDefault();
                  e.stopPropagation();
                  const el = e.currentTarget;
                  const start = el.selectionStart ?? 0;
                  const end = el.selectionEnd ?? start;
                  const selStart = Math.min(start, end);
                  const selEnd = Math.max(start, end);
                  const effectiveEnd =
                    selEnd > selStart && draft[selEnd - 1] === '\n' ? selEnd - 1 : selEnd;
                  const lineNumber = draft.slice(0, selStart).split('\n').length;
                  const endLineNumber = Math.max(
                    lineNumber,
                    draft.slice(0, effectiveEnd).split('\n').length
                  );
                  updateCursorStatsFromOffsets(el.value, selStart, selEnd);
                  setEditorContextMenu({
                    x: e.clientX,
                    y: e.clientY,
                    selectionStart: selStart,
                    selectionEnd: selEnd,
                    lineNumber,
                    endLineNumber,
                  });
                }}
                onScroll={(e) => {
                  const top = e.currentTarget.scrollTop;
                  const left = e.currentTarget.scrollLeft;
                  setEditorScrollTop(top);
                  if (editorContextMenu) {
                    setEditorContextMenu(null);
                  }
                  if (gutterRef.current) {
                    gutterRef.current.scrollTop = top;
                  }
                  if (preRef.current) {
                    preRef.current.scrollTop = top;
                    preRef.current.scrollLeft = left;
                  }
                  if (selectionOverlayRef.current) {
                    selectionOverlayRef.current.scrollTop = top;
                    selectionOverlayRef.current.scrollLeft = left;
                  }
                }}
                onKeyDown={handleEditorKeyDown}
                wrap={wordWrap ? 'soft' : 'off'}
                aria-label={`Source code editor for ${file.name}`}
                className={`relative z-10 block w-full h-full m-0 resize-none overflow-auto bg-transparent text-transparent selection:bg-blue-500/35 font-mono-code focus:outline-none py-3 px-3.5 ${
                  isFull ? 'text-[13px] leading-[21px]' : 'text-[11.5px] leading-[19px]'
                } ${wordWrap ? 'whitespace-pre-wrap break-words' : 'whitespace-pre'}`}
              />
            </div>
          </div>
        )}

        {/* Right-Click Context Menu Popup */}
        {editorContextMenu && file && !file.isBinary && (() => {
          const { x, y, selectionStart, selectionEnd, lineNumber, endLineNumber } =
            editorContextMenu;
          const hasSelection = selectionEnd > selectionStart;
          const menuWidth = 248;
          const estimatedHeight = isEditable ? (hasSelection ? 444 : 408) : 130;
          const left =
            typeof window !== 'undefined'
              ? Math.max(8, Math.min(x, window.innerWidth - menuWidth - 8))
              : x;
          const top =
            typeof window !== 'undefined'
              ? Math.max(8, Math.min(y, window.innerHeight - estimatedHeight - 8))
              : y;
          const lineLabel =
            hasSelection && endLineNumber > lineNumber
              ? `Lines ${lineNumber}–${endLineNumber}`
              : hasSelection
              ? `Selected · Line ${lineNumber}`
              : `Line ${lineNumber}`;

          const getLineBoundsForCursor = () => {
            const ls = draft.lastIndexOf('\n', Math.max(0, selectionStart - 1)) + 1;
            const leRaw = draft.indexOf('\n', selectionStart);
            const le = leRaw === -1 ? draft.length : leRaw;
            return { ls, le };
          };

          return (
            <div
              ref={contextMenuRef}
              role="menu"
              aria-label="Code editor actions"
              style={{ left: `${left}px`, top: `${top}px`, width: `${menuWidth}px` }}
              className="fixed z-[120] rounded-lg border border-white/15 bg-[#181820] shadow-2xl shadow-black/70 py-1 text-[12px] text-neutral-200 select-none backdrop-blur-md"
              onContextMenu={(ev) => ev.preventDefault()}
            >
              <div className="px-3 py-1.5 border-b border-white/[0.08] flex items-center justify-between gap-2 text-[10.5px] text-neutral-400">
                <span className="font-medium text-neutral-300 truncate">{file.name}</span>
                <span className="font-mono-code shrink-0 text-blue-300">{lineLabel}</span>
              </div>

              {isEditable && (
                <>
                  {hasSelection && (
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setEditorContextMenu(null);
                        void handleFormatSelection(selectionStart, selectionEnd);
                      }}
                      className="w-full px-3 py-1.5 flex items-center justify-between gap-2 hover:bg-blue-600/25 hover:text-white text-left cursor-pointer"
                    >
                      <span className="flex items-center gap-2">
                        <Wand2 className="w-3.5 h-3.5 text-blue-400" />
                        <span>Format Selection</span>
                      </span>
                      <span className="font-mono-code text-[10px] text-neutral-500">⇧⌥F</span>
                    </button>
                  )}

                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setEditorContextMenu(null);
                      void handleFormatDocument();
                    }}
                    className="w-full px-3 py-1.5 flex items-center justify-between gap-2 hover:bg-blue-600/25 hover:text-white text-left cursor-pointer"
                  >
                    <span className="flex items-center gap-2">
                      <Wand2 className="w-3.5 h-3.5 text-blue-400" />
                      <span>Format Document</span>
                    </span>
                    <span className="font-mono-code text-[10px] text-neutral-500">
                      {hasSelection ? '' : '⇧⌥F'}
                    </span>
                  </button>

                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setEditorContextMenu(null);
                      handleSelectAllOccurrences(selectionStart, selectionEnd);
                    }}
                    className="w-full px-3 py-1.5 flex items-center justify-between gap-2 hover:bg-blue-600/25 hover:text-white text-left cursor-pointer"
                  >
                    <span className="flex items-center gap-2">
                      <Search className="w-3.5 h-3.5 text-blue-400" />
                      <span>Select All Occurrences</span>
                    </span>
                    <span className="font-mono-code text-[10px] text-neutral-500">Ctrl+⇧L</span>
                  </button>

                  <div className="my-1 border-t border-white/[0.07]" />

                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setEditorContextMenu(null);
                      applyEdit(toggleCommentLines(draft, selectionStart, selectionEnd, file.name));
                    }}
                    className="w-full px-3 py-1.5 flex items-center justify-between gap-2 hover:bg-white/[0.08] hover:text-white text-left cursor-pointer"
                  >
                    <span className="flex items-center gap-2">
                      <Hash className="w-3.5 h-3.5 text-neutral-400" />
                      <span>Toggle Comment</span>
                    </span>
                    <span className="font-mono-code text-[10px] text-neutral-500">Ctrl+/</span>
                  </button>

                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setEditorContextMenu(null);
                      applyEdit(
                        duplicateSelectedLines(draft, selectionStart, selectionEnd, 'down')
                      );
                    }}
                    className="w-full px-3 py-1.5 flex items-center justify-between gap-2 hover:bg-white/[0.08] hover:text-white text-left cursor-pointer"
                  >
                    <span className="flex items-center gap-2">
                      <Files className="w-3.5 h-3.5 text-neutral-400" />
                      <span>Duplicate {hasSelection ? 'Selection' : 'Line'}</span>
                    </span>
                    <span className="font-mono-code text-[10px] text-neutral-500">⇧⌥↓</span>
                  </button>

                  <button
                    type="button"
                    role="menuitem"
                    disabled={lineNumber <= 1}
                    onClick={() => {
                      setEditorContextMenu(null);
                      applyEdit(moveSelectedLines(draft, selectionStart, selectionEnd, 'up'));
                    }}
                    className="w-full px-3 py-1.5 flex items-center justify-between gap-2 hover:bg-white/[0.08] hover:text-white disabled:opacity-35 text-left cursor-pointer"
                  >
                    <span className="flex items-center gap-2">
                      <ArrowUp className="w-3.5 h-3.5 text-neutral-400" />
                      <span>Move Line Up</span>
                    </span>
                    <span className="font-mono-code text-[10px] text-neutral-500">⌥↑</span>
                  </button>

                  <button
                    type="button"
                    role="menuitem"
                    disabled={endLineNumber >= lineCount}
                    onClick={() => {
                      setEditorContextMenu(null);
                      applyEdit(moveSelectedLines(draft, selectionStart, selectionEnd, 'down'));
                    }}
                    className="w-full px-3 py-1.5 flex items-center justify-between gap-2 hover:bg-white/[0.08] hover:text-white disabled:opacity-35 text-left cursor-pointer"
                  >
                    <span className="flex items-center gap-2">
                      <ArrowDown className="w-3.5 h-3.5 text-neutral-400" />
                      <span>Move Line Down</span>
                    </span>
                    <span className="font-mono-code text-[10px] text-neutral-500">⌥↓</span>
                  </button>

                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setEditorContextMenu(null);
                      applyEdit(deleteSelectedLines(draft, selectionStart, selectionEnd));
                    }}
                    className="w-full px-3 py-1.5 flex items-center justify-between gap-2 hover:bg-red-500/20 hover:text-red-200 text-left cursor-pointer"
                  >
                    <span className="flex items-center gap-2">
                      <Trash2 className="w-3.5 h-3.5 text-red-400" />
                      <span>Delete {hasSelection && endLineNumber > lineNumber ? 'Lines' : 'Line'}</span>
                    </span>
                    <span className="font-mono-code text-[10px] text-neutral-500">Ctrl+⇧K</span>
                  </button>

                  <div className="my-1 border-t border-white/[0.07]" />
                </>
              )}

              {isEditable && (
                <button
                  type="button"
                  role="menuitem"
                  onClick={async () => {
                    setEditorContextMenu(null);
                    if (hasSelection) {
                      const snippet = draft.slice(selectionStart, selectionEnd);
                      await onCopyText(snippet);
                      applyEdit({
                        value: `${draft.slice(0, selectionStart)}${draft.slice(selectionEnd)}`,
                        selectionStart,
                        selectionEnd: selectionStart,
                      });
                    } else {
                      const { ls, le } = getLineBoundsForCursor();
                      await onCopyText(draft.slice(ls, le));
                      applyEdit(deleteSelectedLines(draft, selectionStart, selectionEnd));
                    }
                  }}
                  className="w-full px-3 py-1.5 flex items-center justify-between gap-2 hover:bg-white/[0.08] hover:text-white text-left cursor-pointer"
                >
                  <span className="flex items-center gap-2">
                    <Scissors className="w-3.5 h-3.5 text-neutral-400" />
                    <span>Cut</span>
                  </span>
                  <span className="font-mono-code text-[10px] text-neutral-500">Ctrl+X</span>
                </button>
              )}

              <button
                type="button"
                role="menuitem"
                onClick={async () => {
                  setEditorContextMenu(null);
                  const textToCopy = hasSelection
                    ? draft.slice(selectionStart, selectionEnd)
                    : (() => {
                        const { ls, le } = getLineBoundsForCursor();
                        return draft.slice(ls, le);
                      })();
                  const ok = await onCopyText(textToCopy);
                  showNotice(ok ? 'Copied to clipboard' : 'Copy failed');
                }}
                className="w-full px-3 py-1.5 flex items-center justify-between gap-2 hover:bg-white/[0.08] hover:text-white text-left cursor-pointer"
              >
                <span className="flex items-center gap-2">
                  <Copy className="w-3.5 h-3.5 text-neutral-400" />
                  <span>Copy</span>
                </span>
                <span className="font-mono-code text-[10px] text-neutral-500">Ctrl+C</span>
              </button>

              {isEditable && (
                <button
                  type="button"
                  role="menuitem"
                  onClick={async () => {
                    setEditorContextMenu(null);
                    try {
                      const clip = await navigator.clipboard.readText();
                      if (clip === undefined || clip === null) return;
                      const nextValue = `${draft.slice(0, selectionStart)}${clip}${draft.slice(selectionEnd)}`;
                      const nextCursor = selectionStart + clip.length;
                      applyEdit({
                        value: nextValue,
                        selectionStart: nextCursor,
                        selectionEnd: nextCursor,
                      });
                    } catch {
                      showNotice('Clipboard paste blocked by browser — press Ctrl+V');
                    }
                  }}
                  className="w-full px-3 py-1.5 flex items-center justify-between gap-2 hover:bg-white/[0.08] hover:text-white text-left cursor-pointer"
                >
                  <span className="flex items-center gap-2">
                    <ClipboardPaste className="w-3.5 h-3.5 text-neutral-400" />
                    <span>Paste</span>
                  </span>
                  <span className="font-mono-code text-[10px] text-neutral-500">Ctrl+V</span>
                </button>
              )}

              <div className="my-1 border-t border-white/[0.07]" />

              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setEditorContextMenu(null);
                  setAiAgentOpen(true);
                  if (!fullScreen) {
                    onToggleFullScreen(true);
                  }
                  window.requestAnimationFrame(() => {
                    const el = textareaRef.current;
                    if (el) {
                      el.setSelectionRange(selectionStart, selectionEnd);
                    }
                    updateCursorStatsFromOffsets(draft, selectionStart, selectionEnd);
                  });
                }}
                className="w-full px-3 py-1.5 flex items-center justify-between gap-2 hover:bg-blue-600/25 text-blue-200 hover:text-white text-left cursor-pointer"
              >
                <span className="flex items-center gap-2">
                  <MessageSquare className="w-3.5 h-3.5 text-blue-400" />
                  <span>
                    {hasSelection ? 'Ask AI Agent About Selection' : 'Ask AI Agent'}
                  </span>
                </span>
              </button>
            </div>
          );
        })()}
      </div>
    );
  };

  if (!fullScreen) {
    return (
      <div
        data-remote-code-editor="true"
        className="flex-1 min-h-0 flex flex-col overflow-hidden"
      >
        {/* Compact Drawer Editor Toolbar */}
        <div className="shrink-0 px-2.5 py-2 border-b border-white/[0.08] flex items-center justify-between gap-1.5 bg-[#111115]">
          <button
            type="button"
            onClick={handleAttemptCloseFile}
            className="inline-flex items-center gap-1 text-[11.5px] font-medium text-neutral-300 hover:text-white cursor-pointer whitespace-nowrap shrink-0"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Back</span>
          </button>

          <div className="min-w-0 flex items-center gap-1.5">
            <span className="font-mono-code text-[11.5px] text-neutral-100 truncate">
              {file?.name || 'Code Editor'}
            </span>
            {isDirty && (
              <span
                title="Unsaved changes"
                className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0"
              />
            )}
          </div>

          <div className="flex items-center gap-1 shrink-0">
            {file && isEditable && (
              <button
                type="button"
                disabled={formatting}
                onClick={() => {
                  if (selectionRange.end > selectionRange.start) {
                    void handleFormatSelection(selectionRange.start, selectionRange.end);
                  } else {
                    void handleFormatDocument();
                  }
                }}
                title={
                  selectionRange.end > selectionRange.start
                    ? 'Format Selected Lines (Shift+Alt+F)'
                    : 'Format Document (Shift+Alt+F)'
                }
                className="inline-flex items-center gap-1 px-1.5 py-1 rounded border border-white/10 text-[11px] font-medium text-neutral-300 hover:text-white hover:bg-white/10 disabled:opacity-45 transition-colors cursor-pointer whitespace-nowrap"
              >
                {formatting ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : (
                  <Wand2 className="w-3 h-3 text-blue-400" />
                )}
                <span>Format</span>
              </button>
            )}

            {file && isEditable && (
              <button
                type="button"
                disabled={saving || !isDirty}
                onClick={() => onSaveFile(file.path, draft)}
                title="Save changes to remote server (Ctrl+S)"
                className={`inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium transition-colors cursor-pointer whitespace-nowrap ${
                  isDirty
                    ? 'bg-blue-600 hover:bg-blue-700 text-white'
                    : 'text-neutral-500 border border-white/10 opacity-60 cursor-default'
                }`}
              >
                {saving ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : savedBannerVisible && !isDirty ? (
                  <Check className="w-3 h-3 text-emerald-400" />
                ) : (
                  <Save className="w-3 h-3" />
                )}
                <span>{saving ? 'Saving' : savedBannerVisible && !isDirty ? 'Saved' : 'Save'}</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => onToggleFullScreen(true)}
              title="Open in Full Screen Code Editor (Alt+Tab)"
              className="p-1 rounded text-blue-300 hover:text-white hover:bg-blue-500/20 cursor-pointer"
            >
              <Maximize2 className="w-3.5 h-3.5" />
            </button>

            {file && !file.isBinary && (
              <button
                type="button"
                onClick={() => onSaveToNote(file, draft)}
                title="Save file to NoteCraft note"
                className="p-1 rounded text-neutral-400 hover:text-white hover:bg-white/10 cursor-pointer"
              >
                <FilePlus2 className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>

        {renderTabBar()}
        {renderCodeArea(false)}
      </div>
    );
  }

  return (
    <div
      data-remote-code-editor="true"
      className="fixed inset-0 z-50 bg-[#0c0c10] text-neutral-100 flex flex-col"
      role="dialog"
      aria-modal="true"
      aria-label={file ? `Full screen code editor: ${file.name}` : 'Full screen project explorer'}
    >
      {/* Full-Screen Top Toolbar */}
      <header className="h-[52px] shrink-0 px-4 border-b border-white/[0.08] bg-[#14141a] flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <button
            type="button"
            onClick={() => setExplorerOpen((p) => !p)}
            title={explorerOpen ? 'Hide project explorer' : 'Show project explorer'}
            className={`p-1.5 rounded-lg border transition-colors cursor-pointer shrink-0 ${
              explorerOpen
                ? 'border-blue-500/40 bg-blue-500/15 text-blue-300'
                : 'border-white/10 text-neutral-300 hover:bg-white/10'
            }`}
          >
            <PanelLeftOpen className="w-4 h-4" />
          </button>

          {file ? (
            <FileText className={`w-4 h-4 shrink-0 ${getFileIconColorClass(file.name)}`} />
          ) : (
            <FolderOpen className="w-4 h-4 text-blue-400 shrink-0" />
          )}

          <div className="min-w-0 flex items-center gap-2">
            <span className="text-[14px] font-semibold text-white truncate">
              {file ? file.name : currentRemotePath || 'Project Explorer'}
            </span>
            {file && (
              <span className="hidden md:inline font-mono-code text-[12px] text-neutral-500 truncate max-w-[360px]">
                {file.path}
              </span>
            )}
            {isDirty && (
              <span className="text-[12px] font-medium text-amber-400 whitespace-nowrap">
                · Modified
              </span>
            )}
            {savedBannerVisible && !isDirty && (
              <span className="inline-flex items-center gap-1 text-[12px] font-medium text-emerald-400 whitespace-nowrap">
                <Check className="w-3.5 h-3.5" />
                <span>Saved</span>
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {file && (
            <span className="hidden xl:inline text-[12px] text-neutral-400 tabular-nums mr-1.5">
              {languageLabel} · {lineCount.toLocaleString()} lines ·{' '}
              {formatBytes(new Blob([draft]).size)}
            </span>
          )}

          {file && isEditable && (
            <button
              type="button"
              disabled={formatting}
              onClick={() => {
                if (selectionRange.end > selectionRange.start) {
                  void handleFormatSelection(selectionRange.start, selectionRange.end);
                } else {
                  void handleFormatDocument();
                }
              }}
              title={
                selectionRange.end > selectionRange.start
                  ? 'Format Selection (Shift+Alt+F)'
                  : 'Format Document (Shift+Alt+F)'
              }
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-white/10 text-[12px] font-medium text-neutral-200 hover:bg-white/10 disabled:opacity-45 transition-colors cursor-pointer whitespace-nowrap shrink-0"
            >
              {formatting ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-400" />
              ) : (
                <Wand2 className="w-3.5 h-3.5 text-blue-400" />
              )}
              <span>{selectionRange.end > selectionRange.start ? 'Format Selection' : 'Format'}</span>
            </button>
          )}

          {file && isEditable && (
            <button
              type="button"
              disabled={saving || !isDirty}
              onClick={() => onSaveFile(file.path, draft)}
              title="Save changes to remote server (Ctrl+S)"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-45 text-white text-[12.5px] font-medium transition-colors cursor-pointer whitespace-nowrap shrink-0"
            >
              {saving ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Save className="w-3.5 h-3.5" />
              )}
              <span>{saving ? 'Saving...' : 'Save'}</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => {
              setSidebarTab('git');
              setExplorerOpen(true);
            }}
            title="Source Control (Git)"
            className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-[12px] font-medium transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
              explorerOpen && sidebarTab === 'git'
                ? 'border-blue-500/50 bg-blue-500/20 text-blue-200'
                : 'border-white/10 text-neutral-200 hover:bg-white/10'
            }`}
          >
            <GitBranch className="w-3.5 h-3.5 text-blue-400" />
            <span>{gitStatus?.isRepo && gitStatus.branch ? gitStatus.branch : 'Git'}</span>
            {gitStatus?.isRepo && gitStatus.changes.length > 0 && (
              <span className="px-1.5 rounded-full bg-blue-600/35 text-blue-200 text-[10.5px] tabular-nums">
                {gitStatus.changes.length}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => setAiAgentOpen((p) => !p)}
            onDragEnter={(e) => {
              const types = Array.from(e.dataTransfer?.types || []);
              if (
                !aiAgentOpen &&
                (types.includes(REMOTE_ENTRY_DRAG_MIME) ||
                  types.includes('Files') ||
                  types.includes('text/plain'))
              ) {
                setAiAgentOpen(true);
              }
            }}
            onDragOver={(e) => {
              const types = Array.from(e.dataTransfer?.types || []);
              if (
                types.includes(REMOTE_ENTRY_DRAG_MIME) ||
                types.includes('Files') ||
                types.includes('text/plain')
              ) {
                e.preventDefault();
              }
            }}
            title={aiAgentOpen ? 'Hide AI Code Agent' : 'Open AI Code Agent (or drag a file here)'}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-[12px] font-medium transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
              aiAgentOpen
                ? 'border-blue-500/50 bg-blue-500/20 text-blue-200'
                : 'border-white/10 text-neutral-200 hover:bg-white/10'
            }`}
          >
            <Bot className="w-3.5 h-3.5 text-blue-400" />
            <span>AI Agent</span>
          </button>

          <button
            type="button"
            onClick={() => {
              if (isDirty) {
                setPendingAction({ type: 'exit-fullscreen' });
              } else {
                onToggleFullScreen(false);
              }
            }}
            title="Exit Full Screen Editor (Alt+Tab / Esc)"
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-white/10 text-[12px] font-medium text-neutral-200 hover:bg-white/10 transition-colors cursor-pointer whitespace-nowrap shrink-0"
          >
            <Minimize2 className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Exit Full Screen</span>
          </button>
        </div>
      </header>

      {/* Main Split: Resizable VS Code Project Explorer + Code Canvas + Resizable AI Agent */}
      <div className="flex-1 min-h-0 flex overflow-hidden">
        {explorerOpen && (
          <>
            <aside
              style={{ width: `${explorerWidth}px` }}
              className="shrink-0 bg-[#121217] flex flex-col min-h-0"
            >
              {/* Cursor-style Sidebar Activity Switcher: Explorer | Source Control (Git) */}
              <div className="shrink-0 grid grid-cols-2 border-b border-white/[0.08] bg-[#101015]">
                <button
                  type="button"
                  onClick={() => setSidebarTab('explorer')}
                  className={`flex items-center justify-center gap-1.5 py-2 text-[11.5px] font-medium border-b-2 transition-colors cursor-pointer ${
                    sidebarTab === 'explorer'
                      ? 'border-blue-500 text-white bg-white/[0.04]'
                      : 'border-transparent text-neutral-400 hover:text-neutral-200'
                  }`}
                >
                  <Files className="w-3.5 h-3.5" />
                  <span>Explorer</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setSidebarTab('git');
                    void onRefreshGit?.();
                  }}
                  className={`flex items-center justify-center gap-1.5 py-2 text-[11.5px] font-medium border-b-2 transition-colors cursor-pointer ${
                    sidebarTab === 'git'
                      ? 'border-blue-500 text-white bg-white/[0.04]'
                      : 'border-transparent text-neutral-400 hover:text-neutral-200'
                  }`}
                >
                  <GitBranch className="w-3.5 h-3.5" />
                  <span>Source Control</span>
                  {gitStatus?.isRepo && gitStatus.changes.length > 0 && (
                    <span className="px-1.5 py-0.2 rounded-full bg-blue-600/35 text-blue-200 text-[10px] tabular-nums">
                      {gitStatus.changes.length}
                    </span>
                  )}
                </button>
              </div>

              {sidebarTab === 'git' && onRunGit ? (
                <GitSourceControlPanel
                  currentRemotePath={
                    currentRemotePath || (file ? getParentPosixPath(file.path) : '/')
                  }
                  gitStatus={gitStatus ?? null}
                  loading={gitLoading}
                  error={gitError}
                  onRefresh={() => onRefreshGit?.()}
                  onRunGit={onRunGit}
                  onInspectChangeDiff={(change, staged) =>
                    void handleInspectGitChange(change, staged)
                  }
                  onInspectCommit={(commit) => void handleInspectGitCommit(commit)}
                  onOpenFile={(targetPath) => {
                    setGitDiffView(null);
                    handleAttemptSelectFile(targetPath);
                  }}
                  onAfterWorkingTreeMutated={(affectedPaths) => {
                    onRefreshExplorer();
                    if (
                      file &&
                      affectedPaths &&
                      (affectedPaths.length === 0 || affectedPaths.includes(file.path))
                    ) {
                      onReloadFile(file.path);
                    }
                  }}
                />
              ) : (
                <>
                  <div className="shrink-0 px-3 py-2 border-b border-white/[0.08] flex items-center justify-between gap-2">
                    <div
                      className="min-w-0 flex items-center gap-1.5"
                      title={currentRemotePath || (file ? getParentPosixPath(file.path) : '/')}
                    >
                      <FolderOpen className="w-3.5 h-3.5 text-blue-400 shrink-0" />
                      <span className="text-[11.5px] font-semibold uppercase tracking-wider text-neutral-300 truncate">
                        {(currentRemotePath || (file ? getParentPosixPath(file.path) : '/'))
                          .split('/')
                          .filter(Boolean)
                          .pop() || '/'}
                      </span>
                    </div>
                    <div className="flex items-center gap-0.5 shrink-0">
                      <button
                        type="button"
                        onClick={() =>
                          onNavigateRootDir(
                            getParentPosixPath(
                              currentRemotePath || (file ? getParentPosixPath(file.path) : '/')
                            )
                          )
                        }
                        disabled={
                          Boolean(loadingDirs[currentRemotePath]) || currentRemotePath === '/'
                        }
                        title="Open parent folder"
                        className="p-1 rounded text-neutral-400 hover:text-white hover:bg-white/10 disabled:opacity-35 cursor-pointer"
                      >
                        <ArrowUp className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          const base =
                            currentRemotePath || (file ? getParentPosixPath(file.path) : '/');
                          setCreatingInDir((prev) => (prev === base ? null : base));
                        }}
                        title="New file in root folder"
                        className="p-1 rounded text-neutral-400 hover:text-white hover:bg-white/10 cursor-pointer"
                      >
                        <Plus className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={onCollapseAllDirs}
                        title="Collapse all folders"
                        className="p-1 rounded text-neutral-400 hover:text-white hover:bg-white/10 cursor-pointer"
                      >
                        <ChevronsDownUp className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={onRefreshExplorer}
                        title="Refresh explorer"
                        className="p-1 rounded text-neutral-400 hover:text-white hover:bg-white/10 cursor-pointer"
                      >
                        <RefreshCw
                          className={`w-3.5 h-3.5 ${
                            loadingDirs[currentRemotePath] ? 'animate-spin' : ''
                          }`}
                        />
                      </button>
                    </div>
                  </div>

                  {/* Direct Path Jump inside Full Screen Explorer (Tab autocomplete + sync) */}
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (explorerPathInput.trim()) {
                        onNavigateRootDir(explorerPathInput.trim());
                      }
                    }}
                    className="shrink-0 p-2 border-b border-white/[0.08] flex items-center gap-1"
                  >
                    <RemotePathInput
                      value={explorerPathInput}
                      onChange={setExplorerPathInput}
                      onSyncDirectory={(dirPath) => onNavigateRootDir(dirPath)}
                      dirCache={dirCache}
                      fetchDirEntries={fetchDirEntries}
                      currentRemotePath={currentRemotePath}
                      placeholder="/home/user/project"
                      ariaLabel="Open directory path"
                      inputClassName="font-mono-code w-full min-w-0 px-2 py-1 text-[11.5px] rounded border border-white/12 bg-[#0c0c10] text-neutral-100 placeholder:text-neutral-500 focus:outline-none focus:border-blue-500"
                    />
                    <button
                      type="submit"
                      className="px-2 py-1 rounded bg-blue-600 hover:bg-blue-700 text-white text-[11px] font-medium cursor-pointer shrink-0"
                    >
                      Open
                    </button>
                  </form>

                  {dirError && (
                    <div className="m-2 rounded-lg border border-red-500/30 bg-red-500/10 px-2.5 py-2 text-[11.5px] text-red-300 flex items-start gap-2">
                      <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                      <span>{dirError}</span>
                    </div>
                  )}

                  <div className="flex-1 min-h-0 overflow-y-auto px-1.5 py-1.5">
                    {fileLoading && (
                      <div className="flex items-center gap-2 px-2 py-1.5 text-[12px] text-neutral-400">
                        <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-400" />
                        <span>Opening file...</span>
                      </div>
                    )}

                    <ProjectTreeView
                      rootPath={
                        currentRemotePath || (file ? getParentPosixPath(file.path) : '/')
                      }
                      dirCache={dirCache}
                      expandedDirs={expandedDirs}
                      loadingDirs={loadingDirs}
                      truncatedDirs={truncatedDirs}
                      selectedFilePath={file?.path ?? null}
                      pendingFileStatuses={pendingFileStatuses}
                      gitFileStatuses={gitFileStatuses}
                      creatingInDir={creatingInDir}
                      onToggleDir={onToggleDir}
                      onSelectFile={(targetPath) => {
                        setGitDiffView(null);
                        handleAttemptSelectFile(targetPath);
                      }}
                      onOpenInTerminal={onOpenInTerminal}
                      onRequestCreateFile={(dirPath) => {
                        if (!expandedDirs[dirPath]) {
                          onToggleDir(dirPath);
                        }
                        setCreatingInDir(dirPath);
                      }}
                      onSubmitNewFile={handleSubmitNewFile}
                      onCancelNewFile={() => setCreatingInDir(null)}
                    />
                  </div>
                </>
              )}
            </aside>

            {/* Draggable Explorer Resize Handle */}
            <div
              role="separator"
              aria-orientation="vertical"
              aria-label="Resize project explorer"
              title="Drag to resize project explorer (double-click to reset)"
              onMouseDown={(e) => startPaneResize('explorer', e)}
              onDoubleClick={() => {
                setExplorerWidth(275);
                try {
                  window.localStorage.setItem('notecraft.ide.explorerWidth.v1', '275');
                } catch {
                  // ignore
                }
              }}
              className={`w-1.5 shrink-0 border-r border-white/[0.08] cursor-col-resize flex items-center justify-center transition-colors group ${
                resizingPane === 'explorer' ? 'bg-blue-500/50' : 'hover:bg-blue-500/35'
              }`}
            >
              <span className="w-px h-8 rounded-full bg-white/15 group-hover:bg-blue-300/80" />
            </div>
          </>
        )}

        <div className="flex-1 min-w-0 min-h-0 flex flex-col overflow-hidden">
          {renderTabBar()}
          {renderCodeArea(true)}
        </div>

        {aiAgentOpen && (
          <>
            {/* Draggable AI Agent Resize Handle */}
            <div
              role="separator"
              aria-orientation="vertical"
              aria-label="Resize AI Code Agent panel"
              title="Drag to resize AI Code Agent (double-click to reset)"
              onMouseDown={(e) => startPaneResize('agent', e)}
              onDoubleClick={() => {
                setAgentWidth(370);
                try {
                  window.localStorage.setItem('notecraft.ide.agentWidth.v1', '370');
                } catch {
                  // ignore
                }
              }}
              className={`w-1.5 shrink-0 border-l border-white/[0.08] cursor-col-resize flex items-center justify-center transition-colors group ${
                resizingPane === 'agent' ? 'bg-blue-500/50' : 'hover:bg-blue-500/35'
              }`}
            >
              <span className="w-px h-8 rounded-full bg-white/15 group-hover:bg-blue-300/80" />
            </div>

            <CodeAgentPanel
              width={agentWidth}
              file={file}
              draft={draft}
              languageLabel={languageLabel}
              isEditable={isEditable}
              cursorLine={cursorPos.line}
              selectedText={selectedText}
              selectionRangeLabel={selectionRangeLabel}
              currentRemotePath={currentRemotePath}
              dirCache={dirCache}
              expandedDirs={expandedDirs}
              canUndo={historyMeta.canUndo}
              trackedChanges={trackedChanges}
              applyingTrackedChanges={applyingTrackedChanges}
              onReadRemoteFile={onReadRemoteFile}
              onStageFileOperations={handleStageFileOperations}
              onReviewTrackedChange={handleReviewTrackedChange}
              onAcceptTrackedChange={handleAcceptTrackedChange}
              onRejectTrackedChange={handleRejectTrackedChange}
              onAcceptAllTrackedChanges={handleAcceptAllTrackedChanges}
              onRejectAllTrackedChanges={handleRejectAllTrackedChanges}
              onStageInlineDiff={handleStageInlineDiff}
              onApplyCode={handleApplyAgentCode}
              onCreateFileWithCode={(fullPath, content) => onCreateNewFile(fullPath, content)}
              onUndoLastEdit={performUndo}
              onCopyText={onCopyText}
              onClose={() => setAiAgentOpen(false)}
            />
          </>
        )}
      </div>

      {/* Bottom Status Bar */}
      <footer className="h-7 shrink-0 px-4 border-t border-white/[0.08] bg-[#14141a] flex items-center justify-between text-[11px] text-neutral-400 tabular-nums">
        <div className="flex items-center gap-3">
          {file && (
            <span className="font-mono-code">
              Ln {cursorPos.line}, Col {cursorPos.col}
            </span>
          )}
          <span>UTF-8</span>
          <span>{languageLabel}</span>
        </div>
        <div className="hidden sm:block text-neutral-500">
          Ctrl+S Save · Ctrl+F Find · Ctrl+Shift+L Select All · Ctrl+/ Comment · Shift+Alt+F Format · Alt+Tab Full Screen
        </div>
      </footer>
    </div>
  );
}
