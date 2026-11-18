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
  CopyPlus,
  FilePlus2,
  FileText,
  FolderOpen,
  Hash,
  Loader2,
  Maximize2,
  Minimize2,
  PanelLeftOpen,
  Plus,
  Redo2,
  RefreshCw,
  Replace,
  RotateCcw,
  Save,
  SaveAll,
  Scissors,
  Search,
  Sparkles,
  Trash2,
  Undo2,
  WrapText,
  X,
} from 'lucide-react';
import {
  deleteSelectedLines,
  duplicateSelectedLines,
  EditResult,
  findAllTextMatches,
  formatSourceDocument,
  getOffsetForLineCol,
  indentLines,
  moveSelectedLines,
  smartNewLineIndent,
  toggleCommentLines,
} from '../utils/codeEditing';
import { highlightCodeToHtml } from '../utils/codeHighlight';
import { CodeAgentPanel } from './CodeAgentPanel';
import {
  getFileIconColorClass,
  ProjectTreeView,
  RemoteDirEntry,
  RemoteFilePreview,
} from './ProjectTreeView';

export type { RemoteDirEntry, RemoteFilePreview };

interface HistorySnapshot {
  value: string;
  selectionStart: number;
  selectionEnd: number;
}

interface RemoteCodeEditorProps {
  file: RemoteFilePreview | null;
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
  onCopyText,
  onSaveToNote,
}: RemoteCodeEditorProps) {
  const [draft, setDraft] = useState(file?.content ?? '');
  const [wordWrap, setWordWrap] = useState(false);
  const [copiedNotice, setCopiedNotice] = useState(false);
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
    | { type: 'exit-fullscreen' }
    | null
  >(null);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const gutterRef = useRef<HTMLDivElement>(null);
  const preRef = useRef<HTMLPreElement>(null);
  const findInputRef = useRef<HTMLInputElement>(null);
  const gotoInputRef = useRef<HTMLInputElement>(null);
  const saveAsInputRef = useRef<HTMLInputElement>(null);

  const showNotice = useCallback((msg: string) => {
    setActionNotice(msg);
    window.setTimeout(() => {
      setActionNotice((cur) => (cur === msg ? null : cur));
    }, 2200);
  }, []);

  useEffect(() => {
    setExplorerPathInput(currentRemotePath || '');
  }, [currentRemotePath]);

  // Reset draft & history when switching files or reloading from server
  useEffect(() => {
    const initial = file?.content ?? '';
    setDraft(initial);
    setPendingAction(null);
    setSaveAsOpen(false);
    setSaveAsPath(file?.path ?? '');
    setCursorPos({ line: 1, col: 1 });
    setSelectionRange({ start: 0, end: 0 });
    setEditorScrollTop(0);
    historyRef.current = {
      stack: [{ value: initial, selectionStart: 0, selectionEnd: 0 }],
      index: 0,
      lastInputAt: 0,
    };
    setHistoryMeta({ canUndo: false, canRedo: false });

    if (textareaRef.current) {
      textareaRef.current.scrollTop = 0;
      textareaRef.current.scrollLeft = 0;
    }
    if (preRef.current) {
      preRef.current.scrollTop = 0;
      preRef.current.scrollLeft = 0;
    }
    if (gutterRef.current) {
      gutterRef.current.scrollTop = 0;
    }
  }, [file?.path, file?.content]);

  useEffect(() => {
    if (!lastSavedAt) return;
    setSavedBannerVisible(true);
    const timer = window.setTimeout(() => setSavedBannerVisible(false), 2000);
    return () => window.clearTimeout(timer);
  }, [lastSavedAt]);

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

  const handleApplyAgentCode = useCallback(
    (nextCode: string, mode: 'replace-file' | 'replace-selection' | 'insert-at-cursor') => {
      if (!file || !isEditable) return;
      const normalized = nextCode.replace(/\r\n/g, '\n');

      if (mode === 'replace-file') {
        applyEdit(
          { value: normalized, selectionStart: 0, selectionEnd: 0 },
          { focus: false }
        );
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

  const handleCopyAction = useCallback(async () => {
    if (!file || file.isBinary) return;
    const el = textareaRef.current;
    const start = el?.selectionStart ?? 0;
    const end = el?.selectionEnd ?? 0;
    const textToCopy = start !== end ? draft.slice(start, end) : draft;
    const ok = await onCopyText(textToCopy);
    if (ok) {
      setCopiedNotice(true);
      window.setTimeout(() => setCopiedNotice(false), 1500);
    }
  }, [file, draft, onCopyText]);

  const handleCutAction = useCallback(async () => {
    if (!isEditable) return;
    const el = textareaRef.current;
    if (!el) return;
    const start = el.selectionStart ?? 0;
    const end = el.selectionEnd ?? 0;
    if (start === end) {
      // Cut current line when no selection (VS Code style!)
      const lineStart = draft.lastIndexOf('\n', Math.max(0, start - 1)) + 1;
      const nl = draft.indexOf('\n', start);
      const lineEnd = nl === -1 ? draft.length : nl + 1;
      await onCopyText(draft.slice(lineStart, lineEnd));
      applyEdit(deleteSelectedLines(draft, start, end));
      return;
    }
    const ok = await onCopyText(draft.slice(start, end));
    if (ok) {
      applyEdit({
        value: `${draft.slice(0, start)}${draft.slice(end)}`,
        selectionStart: start,
        selectionEnd: start,
      });
    }
  }, [isEditable, draft, onCopyText, applyEdit]);

  const handlePasteAction = useCallback(async () => {
    if (!isEditable) return;
    if (!navigator.clipboard?.readText) {
      showNotice('Use Ctrl+V inside editor to paste.');
      textareaRef.current?.focus();
      return;
    }
    try {
      const clipText = await navigator.clipboard.readText();
      if (!clipText) return;
      const el = textareaRef.current;
      const start = el?.selectionStart ?? draft.length;
      const end = el?.selectionEnd ?? draft.length;
      const nextValue = `${draft.slice(0, start)}${clipText}${draft.slice(end)}`;
      const nextPos = start + clipText.length;
      applyEdit({ value: nextValue, selectionStart: nextPos, selectionEnd: nextPos });
    } catch {
      showNotice('Browser blocked clipboard button; press Ctrl+V directly in the code.');
      textareaRef.current?.focus();
    }
  }, [isEditable, draft, applyEdit, showNotice]);

  const handleSelectAll = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(0, el.value.length);
  }, []);

  const handleFormatDocument = useCallback(() => {
    if (!file || !isEditable) return;
    const formatted = formatSourceDocument(draft, file.name);
    if (!formatted.ok) {
      if (formatted.notice) showNotice(formatted.notice);
      return;
    }
    if (formatted.value === draft) {
      showNotice('Already formatted');
      return;
    }
    const prevPos = Math.min(formatted.value.length, textareaRef.current?.selectionStart ?? 0);
    applyEdit({ value: formatted.value, selectionStart: prevPos, selectionEnd: prevPos });
    showNotice('Document formatted');
  }, [file, isEditable, draft, applyEdit, showNotice]);

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
      if (e.shiftKey && e.altKey && key === 'f') {
        e.preventDefault();
        handleFormatDocument();
        return;
      }

      if (e.key === 'Escape') {
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
    isDirty,
    onSaveFile,
    onToggleFullScreen,
    openFindBar,
    openGotoLineBar,
    openSaveAsBar,
    handleFormatDocument,
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

    // Format Document (Shift+Alt+F)
    if (!mod && e.shiftKey && e.altKey && key === 'f') {
      e.preventDefault();
      handleFormatDocument();
      return;
    }

    // Smart Auto-Indent New Line (Enter)
    if (!mod && !e.altKey && e.key === 'Enter') {
      e.preventDefault();
      applyEdit(smartNewLineIndent(draft, start, end));
      return;
    }

    // Tab / Shift+Tab Indent
    if (e.key === 'Tab') {
      e.preventDefault();
      applyEdit(indentLines(draft, start, end, e.shiftKey));
    }
  };

  const handleSubmitNewFile = (targetDir: string, cleanName: string) => {
    const full = `${targetDir.replace(/\/+$/, '')}/${cleanName}`;
    setCreatingInDir(null);
    onCreateNewFile(full);
  };

  const handleAttemptCloseFile = () => {
    if (isDirty) {
      setPendingAction({ type: 'close-file' });
    } else {
      onCloseFile();
    }
  };

  const handleAttemptSelectFile = (targetPath: string) => {
    if (file && targetPath === file.path) return;
    if (isDirty) {
      setPendingAction({ type: 'switch-file', path: targetPath });
    } else {
      onOpenFile(targetPath);
    }
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
    } else if (act.type === 'exit-fullscreen') {
      onToggleFullScreen(false);
    }
  };

  const renderCodeArea = (isFull: boolean) => {
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
            <span>Ctrl+G · Go to Line</span>
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
                setDraft(val);
                const lastChar = val[Math.max(0, pos - 1)] ?? '';
                const boundaryChar = lastChar === '\n' || lastChar === ' ';
                pushHistory(
                  { value: val, selectionStart: pos, selectionEnd: endPos },
                  !boundaryChar
                );
                updateCursorStatsFromOffsets(val, pos, endPos);
              }}
              onClick={updateCursorStats}
              onKeyUp={updateCursorStats}
              onSelect={updateCursorStats}
              onScroll={(e) => {
                const top = e.currentTarget.scrollTop;
                const left = e.currentTarget.scrollLeft;
                setEditorScrollTop(top);
                if (gutterRef.current) {
                  gutterRef.current.scrollTop = top;
                }
                if (preRef.current) {
                  preRef.current.scrollTop = top;
                  preRef.current.scrollLeft = left;
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

            {file && !file.isBinary && (
              <button
                type="button"
                onClick={() => openFindBar(false)}
                title="Find (Ctrl+F)"
                className="p-1 rounded text-neutral-400 hover:text-white hover:bg-white/10 cursor-pointer"
              >
                <Search className="w-3.5 h-3.5" />
              </button>
            )}

            <button
              type="button"
              onClick={() => onToggleFullScreen(true)}
              title="Open in Full Screen Code Editor"
              className="p-1 rounded text-blue-300 hover:text-white hover:bg-blue-500/20 cursor-pointer"
            >
              <Maximize2 className="w-3.5 h-3.5" />
            </button>

            {file && !file.isBinary && (
              <button
                type="button"
                onClick={() => void handleCopyAction()}
                title="Copy code"
                className="p-1 rounded text-neutral-400 hover:text-white hover:bg-white/10 cursor-pointer"
              >
                {copiedNotice ? (
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                ) : (
                  <Copy className="w-3.5 h-3.5" />
                )}
              </button>
            )}

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

          {file && (
            <button
              type="button"
              onClick={() => setWordWrap((p) => !p)}
              title="Toggle word wrap"
              className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border text-[12px] font-medium transition-colors cursor-pointer whitespace-nowrap ${
                wordWrap
                  ? 'border-blue-500/40 bg-blue-500/15 text-blue-300'
                  : 'border-white/10 text-neutral-300 hover:bg-white/10'
              }`}
            >
              <WrapText className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Wrap</span>
            </button>
          )}

          {file && (
            <button
              type="button"
              onClick={() => onReloadFile(file.path)}
              title="Reload latest file from remote server"
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-white/10 text-[12px] font-medium text-neutral-300 hover:bg-white/10 transition-colors cursor-pointer whitespace-nowrap"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span className="hidden md:inline">Reload</span>
            </button>
          )}

          {isDirty && file && (
            <button
              type="button"
              onClick={() =>
                applyEdit({ value: file.content, selectionStart: 0, selectionEnd: 0 })
              }
              title="Discard unsaved changes"
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-white/10 text-[12px] font-medium text-neutral-300 hover:bg-white/10 transition-colors cursor-pointer whitespace-nowrap"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span className="hidden md:inline">Discard</span>
            </button>
          )}

          {file && !file.isBinary && (
            <button
              type="button"
              onClick={() => onSaveToNote(file, draft)}
              title="Save source code snapshot to NoteCraft note"
              className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-white/10 text-[12px] font-medium text-neutral-200 hover:bg-white/10 transition-colors cursor-pointer whitespace-nowrap"
            >
              <FilePlus2 className="w-3.5 h-3.5 text-neutral-400" />
              <span>Save to note</span>
            </button>
          )}

          {file && isEditable && (
            <>
              <button
                type="button"
                onClick={openSaveAsBar}
                title="Save As new path (Ctrl+Shift+S)"
                className="hidden sm:inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-white/10 text-[12px] font-medium text-neutral-200 hover:bg-white/10 transition-colors cursor-pointer whitespace-nowrap"
              >
                <SaveAll className="w-3.5 h-3.5 text-neutral-400" />
                <span>Save As</span>
              </button>

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
            </>
          )}

          <button
            type="button"
            onClick={() => setAiAgentOpen((p) => !p)}
            title={aiAgentOpen ? 'Hide AI Code Agent' : 'Open AI Code Agent'}
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
            title="Exit Full Screen Editor (Esc)"
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-white/10 text-[12px] font-medium text-neutral-200 hover:bg-white/10 transition-colors cursor-pointer whitespace-nowrap shrink-0"
          >
            <Minimize2 className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Exit Full Screen</span>
          </button>
        </div>
      </header>

      {/* Secondary Edit Actions Bar (Full Screen + Active File) */}
      {file && !file.isBinary && (
        <div className="shrink-0 px-3 py-1.5 border-b border-white/[0.07] bg-[#111116] flex items-center gap-1 overflow-x-auto text-[11.5px] text-neutral-300">
          <button
            type="button"
            disabled={!isEditable || !historyMeta.canUndo}
            onClick={performUndo}
            title="Undo (Ctrl+Z)"
            className="inline-flex items-center gap-1 px-2 py-1 rounded hover:bg-white/10 disabled:opacity-35 cursor-pointer whitespace-nowrap"
          >
            <Undo2 className="w-3.5 h-3.5" />
            <span className="hidden md:inline">Undo</span>
          </button>
          <button
            type="button"
            disabled={!isEditable || !historyMeta.canRedo}
            onClick={performRedo}
            title="Redo (Ctrl+Y)"
            className="inline-flex items-center gap-1 px-2 py-1 rounded hover:bg-white/10 disabled:opacity-35 cursor-pointer whitespace-nowrap"
          >
            <Redo2 className="w-3.5 h-3.5" />
            <span className="hidden md:inline">Redo</span>
          </button>

          <span className="h-3.5 w-px bg-white/10 mx-1 shrink-0" />

          <button
            type="button"
            disabled={!isEditable}
            onClick={() => void handleCutAction()}
            title="Cut selection or line (Ctrl+X)"
            className="inline-flex items-center gap-1 px-2 py-1 rounded hover:bg-white/10 disabled:opacity-35 cursor-pointer whitespace-nowrap"
          >
            <Scissors className="w-3.5 h-3.5" />
            <span className="hidden lg:inline">Cut</span>
          </button>
          <button
            type="button"
            onClick={() => void handleCopyAction()}
            title="Copy selection or file (Ctrl+C)"
            className="inline-flex items-center gap-1 px-2 py-1 rounded hover:bg-white/10 cursor-pointer whitespace-nowrap"
          >
            {copiedNotice ? (
              <Check className="w-3.5 h-3.5 text-emerald-400" />
            ) : (
              <Copy className="w-3.5 h-3.5" />
            )}
            <span className="hidden lg:inline">{copiedNotice ? 'Copied' : 'Copy'}</span>
          </button>
          <button
            type="button"
            disabled={!isEditable}
            onClick={() => void handlePasteAction()}
            title="Paste (Ctrl+V)"
            className="inline-flex items-center gap-1 px-2 py-1 rounded hover:bg-white/10 disabled:opacity-35 cursor-pointer whitespace-nowrap"
          >
            <ClipboardPaste className="w-3.5 h-3.5" />
            <span className="hidden lg:inline">Paste</span>
          </button>
          <button
            type="button"
            onClick={handleSelectAll}
            title="Select All (Ctrl+A)"
            className="px-2 py-1 rounded hover:bg-white/10 cursor-pointer whitespace-nowrap"
          >
            Select All
          </button>

          <span className="h-3.5 w-px bg-white/10 mx-1 shrink-0" />

          <button
            type="button"
            onClick={() => openFindBar(false)}
            title="Find (Ctrl+F)"
            className={`inline-flex items-center gap-1 px-2 py-1 rounded cursor-pointer whitespace-nowrap ${
              findOpen && !replaceOpen ? 'bg-blue-500/20 text-blue-300' : 'hover:bg-white/10'
            }`}
          >
            <Search className="w-3.5 h-3.5" />
            <span>Find</span>
          </button>
          <button
            type="button"
            disabled={!isEditable}
            onClick={() => openFindBar(true)}
            title="Find & Replace (Ctrl+H)"
            className={`inline-flex items-center gap-1 px-2 py-1 rounded disabled:opacity-35 cursor-pointer whitespace-nowrap ${
              findOpen && replaceOpen ? 'bg-blue-500/20 text-blue-300' : 'hover:bg-white/10'
            }`}
          >
            <Replace className="w-3.5 h-3.5" />
            <span>Replace</span>
          </button>
          <button
            type="button"
            onClick={openGotoLineBar}
            title="Go to Line (Ctrl+G)"
            className={`inline-flex items-center gap-1 px-2 py-1 rounded cursor-pointer whitespace-nowrap ${
              gotoOpen ? 'bg-blue-500/20 text-blue-300' : 'hover:bg-white/10'
            }`}
          >
            <Hash className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Go to Line</span>
          </button>

          <span className="h-3.5 w-px bg-white/10 mx-1 shrink-0" />

          <button
            type="button"
            disabled={!isEditable}
            onClick={() => {
              const el = textareaRef.current;
              if (!el || !file) return;
              applyEdit(
                toggleCommentLines(draft, el.selectionStart ?? 0, el.selectionEnd ?? 0, file.name)
              );
            }}
            title="Toggle Line Comment (Ctrl+/)"
            className="px-2 py-1 rounded hover:bg-white/10 disabled:opacity-35 font-mono-code cursor-pointer whitespace-nowrap"
          >
            // Comment
          </button>
          <button
            type="button"
            disabled={!isEditable}
            onClick={() => {
              const el = textareaRef.current;
              if (!el) return;
              applyEdit(
                moveSelectedLines(draft, el.selectionStart ?? 0, el.selectionEnd ?? 0, 'up')
              );
            }}
            title="Move Line Up (Alt+↑)"
            className="p-1 rounded hover:bg-white/10 disabled:opacity-35 cursor-pointer shrink-0"
          >
            <ArrowUp className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            disabled={!isEditable}
            onClick={() => {
              const el = textareaRef.current;
              if (!el) return;
              applyEdit(
                moveSelectedLines(draft, el.selectionStart ?? 0, el.selectionEnd ?? 0, 'down')
              );
            }}
            title="Move Line Down (Alt+↓)"
            className="p-1 rounded hover:bg-white/10 disabled:opacity-35 cursor-pointer shrink-0"
          >
            <ArrowDown className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            disabled={!isEditable}
            onClick={() => {
              const el = textareaRef.current;
              if (!el) return;
              applyEdit(
                duplicateSelectedLines(draft, el.selectionStart ?? 0, el.selectionEnd ?? 0, 'down')
              );
            }}
            title="Duplicate Line (Shift+Alt+↓)"
            className="inline-flex items-center gap-1 px-2 py-1 rounded hover:bg-white/10 disabled:opacity-35 cursor-pointer whitespace-nowrap"
          >
            <CopyPlus className="w-3.5 h-3.5" />
            <span className="hidden xl:inline">Duplicate</span>
          </button>
          <button
            type="button"
            disabled={!isEditable}
            onClick={() => {
              const el = textareaRef.current;
              if (!el) return;
              applyEdit(deleteSelectedLines(draft, el.selectionStart ?? 0, el.selectionEnd ?? 0));
            }}
            title="Delete Line (Ctrl+Shift+K)"
            className="inline-flex items-center gap-1 px-2 py-1 rounded hover:bg-white/10 hover:text-red-300 disabled:opacity-35 cursor-pointer whitespace-nowrap"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span className="hidden xl:inline">Delete Line</span>
          </button>
          <button
            type="button"
            disabled={!isEditable}
            onClick={handleFormatDocument}
            title="Format Document (Shift+Alt+F)"
            className="inline-flex items-center gap-1 px-2 py-1 rounded hover:bg-white/10 text-blue-300 disabled:opacity-35 cursor-pointer whitespace-nowrap"
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>Format</span>
          </button>
        </div>
      )}

      {/* Main Split: Resizable VS Code Project Explorer + Code Canvas + Resizable AI Agent */}
      <div className="flex-1 min-h-0 flex overflow-hidden">
        {explorerOpen && (
          <>
            <aside
              style={{ width: `${explorerWidth}px` }}
              className="shrink-0 bg-[#121217] flex flex-col min-h-0"
            >
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

              {/* Direct Path Jump inside Full Screen Explorer */}
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (explorerPathInput.trim()) {
                    onNavigateRootDir(explorerPathInput.trim());
                  }
                }}
                className="shrink-0 p-2 border-b border-white/[0.08] flex items-center gap-1"
              >
                <input
                  type="text"
                  value={explorerPathInput}
                  onChange={(e) => setExplorerPathInput(e.target.value)}
                  placeholder="/home/user/project"
                  aria-label="Open directory path"
                  className="font-mono-code flex-1 min-w-0 px-2 py-1 text-[11.5px] rounded border border-white/12 bg-[#0c0c10] text-neutral-100 placeholder:text-neutral-500 focus:outline-none focus:border-blue-500"
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
                  rootPath={currentRemotePath || (file ? getParentPosixPath(file.path) : '/')}
                  dirCache={dirCache}
                  expandedDirs={expandedDirs}
                  loadingDirs={loadingDirs}
                  truncatedDirs={truncatedDirs}
                  selectedFilePath={file?.path ?? null}
                  creatingInDir={creatingInDir}
                  onToggleDir={onToggleDir}
                  onSelectFile={handleAttemptSelectFile}
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

        {renderCodeArea(true)}

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
          Ctrl+S Save · Ctrl+F Find · Ctrl+H Replace · Ctrl+G Go to Line · Esc Exit Full Screen
        </div>
      </footer>
    </div>
  );
}
