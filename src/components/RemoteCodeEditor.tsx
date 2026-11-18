import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  ArrowUp,
  Check,
  Copy,
  FilePlus2,
  FileText,
  Folder as FolderIcon,
  FolderOpen,
  Loader2,
  Maximize2,
  Minimize2,
  PanelLeftOpen,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  WrapText,
  X,
} from 'lucide-react';

export interface RemoteDirEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  size: number;
  modifiedAt: number | null;
}

export interface RemoteFilePreview {
  path: string;
  name: string;
  content: string;
  size: number;
  truncated: boolean;
  isBinary: boolean;
}

interface RemoteCodeEditorProps {
  file: RemoteFilePreview;
  fullScreen: boolean;
  saving: boolean;
  saveError: string | null;
  lastSavedAt: number | null;
  currentRemotePath: string;
  dirEntries: RemoteDirEntry[];
  dirLoading: boolean;
  onToggleFullScreen: (next: boolean) => void;
  onCloseFile: () => void;
  onSaveFile: (path: string, nextContent: string) => void;
  onReloadFile: (path: string) => void;
  onNavigateDir: (path: string) => void;
  onOpenFile: (path: string) => void;
  onCreateNewFile: (fullPath: string) => void;
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
  lastSavedAt,
  currentRemotePath,
  dirEntries,
  dirLoading,
  onToggleFullScreen,
  onCloseFile,
  onSaveFile,
  onReloadFile,
  onNavigateDir,
  onOpenFile,
  onCreateNewFile,
  onCopyText,
  onSaveToNote,
}: RemoteCodeEditorProps) {
  const [draft, setDraft] = useState(file.content);
  const [wordWrap, setWordWrap] = useState(false);
  const [copiedNotice, setCopiedNotice] = useState(false);
  const [savedBannerVisible, setSavedBannerVisible] = useState(false);
  const [explorerOpen, setExplorerOpen] = useState(true);
  const [creatingFile, setCreatingFile] = useState(false);
  const [newFileName, setNewFileName] = useState('');
  const [cursorPos, setCursorPos] = useState({ line: 1, col: 1 });
  const [pendingAction, setPendingAction] = useState<
    | { type: 'switch-file'; path: string }
    | { type: 'close-file' }
    | { type: 'exit-fullscreen' }
    | null
  >(null);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const gutterRef = useRef<HTMLDivElement>(null);

  // Sync draft when switching files or reloading from server
  useEffect(() => {
    setDraft(file.content);
    setPendingAction(null);
    setCursorPos({ line: 1, col: 1 });
  }, [file.path, file.content]);

  useEffect(() => {
    if (!lastSavedAt) return;
    setSavedBannerVisible(true);
    const timer = window.setTimeout(() => setSavedBannerVisible(false), 2000);
    return () => window.clearTimeout(timer);
  }, [lastSavedAt]);

  const isDirty = !file.isBinary && !file.truncated && draft !== file.content;
  const lineCount = useMemo(() => Math.max(1, draft.split('\n').length), [draft]);
  const languageLabel = useMemo(() => detectLanguageLabel(file.name), [file.name]);

  const updateCursorStats = () => {
    const el = textareaRef.current;
    if (!el) return;
    const pos = el.selectionStart ?? 0;
    const before = el.value.slice(0, pos);
    const lines = before.split('\n');
    setCursorPos({
      line: lines.length,
      col: (lines[lines.length - 1]?.length ?? 0) + 1,
    });
  };

  // Global Esc shortcut in full screen mode
  useEffect(() => {
    if (!fullScreen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        if (!file.isBinary && !file.truncated && !saving) {
          onSaveFile(file.path, draft);
        }
        return;
      }
      if (e.key === 'Escape') {
        if (creatingFile) {
          setCreatingFile(false);
          setNewFileName('');
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
    file.isBinary,
    file.truncated,
    file.path,
    draft,
    saving,
    creatingFile,
    pendingAction,
    isDirty,
    onSaveFile,
    onToggleFullScreen,
  ]);

  const handleEditorKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 's') {
      e.preventDefault();
      if (!file.isBinary && !file.truncated && !saving) {
        onSaveFile(file.path, draft);
      }
      return;
    }

    if (e.key === 'Tab') {
      e.preventDefault();
      const el = e.currentTarget;
      const start = el.selectionStart;
      const end = el.selectionEnd;
      const value = el.value;

      if (start === end && !e.shiftKey) {
        const next = `${value.slice(0, start)}  ${value.slice(end)}`;
        setDraft(next);
        window.requestAnimationFrame(() => {
          el.selectionStart = el.selectionEnd = start + 2;
          updateCursorStats();
        });
        return;
      }

      // Multi-line indent / unindent
      const lineStart = value.lastIndexOf('\n', Math.max(0, start - 1)) + 1;
      const lineEndRaw = value.indexOf('\n', end);
      const lineEnd = lineEndRaw === -1 ? value.length : lineEndRaw;
      const block = value.slice(lineStart, lineEnd);
      const lines = block.split('\n');

      let deltaFirst = 0;
      let deltaTotal = 0;
      const updatedLines = lines.map((ln, idx) => {
        if (e.shiftKey) {
          if (ln.startsWith('  ')) {
            if (idx === 0) deltaFirst = -2;
            deltaTotal -= 2;
            return ln.slice(2);
          }
          if (ln.startsWith('\t') || ln.startsWith(' ')) {
            if (idx === 0) deltaFirst = -1;
            deltaTotal -= 1;
            return ln.slice(1);
          }
          return ln;
        }
        if (idx === 0) deltaFirst = 2;
        deltaTotal += 2;
        return `  ${ln}`;
      });

      const next = `${value.slice(0, lineStart)}${updatedLines.join('\n')}${value.slice(lineEnd)}`;
      setDraft(next);
      window.requestAnimationFrame(() => {
        el.selectionStart = Math.max(lineStart, start + deltaFirst);
        el.selectionEnd = Math.max(el.selectionStart, end + deltaTotal);
        updateCursorStats();
      });
    }
  };

  const handleCopy = async () => {
    const ok = await onCopyText(draft);
    if (ok) {
      setCopiedNotice(true);
      window.setTimeout(() => setCopiedNotice(false), 1500);
    }
  };

  const handleCreateFileSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const clean = newFileName.trim().replace(/^\/+/, '');
    if (!clean) return;
    const baseDir = currentRemotePath || getParentPosixPath(file.path);
    const full = `${baseDir.replace(/\/+$/, '')}/${clean}`;
    setCreatingFile(false);
    setNewFileName('');
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
    if (targetPath === file.path) return;
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

    if (decision === 'save') {
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
    if (file.isBinary) {
      return (
        <div className="flex-1 flex items-center justify-center p-6 text-center text-[13px] text-neutral-400">
          Binary file ({formatBytes(file.size)}). Source editing is disabled for binary files.
        </div>
      );
    }

    return (
      <div className="flex-1 min-h-0 flex flex-col overflow-hidden bg-[#0c0c10]">
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
            className={`shrink-0 select-none overflow-hidden bg-[#101016] border-r border-white/[0.06] text-right font-mono-code text-neutral-600 tabular-nums py-3 ${
              isFull ? 'w-14 pr-3 text-[13px] leading-[21px]' : 'w-10 pr-2 text-[11.5px] leading-[19px]'
            }`}
          >
            {Array.from({ length: lineCount }, (_, idx) => (
              <div key={idx}>{idx + 1}</div>
            ))}
          </div>

          <textarea
            ref={textareaRef}
            value={draft}
            readOnly={file.truncated}
            spellCheck={false}
            autoCapitalize="off"
            autoComplete="off"
            autoCorrect="off"
            onChange={(e) => {
              setDraft(e.target.value);
              updateCursorStats();
            }}
            onClick={updateCursorStats}
            onKeyUp={updateCursorStats}
            onScroll={(e) => {
              if (gutterRef.current) {
                gutterRef.current.scrollTop = e.currentTarget.scrollTop;
              }
            }}
            onKeyDown={handleEditorKeyDown}
            wrap={wordWrap ? 'soft' : 'off'}
            aria-label={`Source code editor for ${file.name}`}
            className={`flex-1 min-w-0 min-h-0 resize-none bg-transparent text-neutral-100 font-mono-code focus:outline-none py-3 px-3.5 ${
              isFull ? 'text-[13px] leading-[21px]' : 'text-[11.5px] leading-[19px]'
            } ${wordWrap ? 'whitespace-pre-wrap' : 'whitespace-pre overflow-x-auto'}`}
          />
        </div>
      </div>
    );
  };

  if (!fullScreen) {
    return (
      <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
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
              {file.name}
            </span>
            {isDirty && (
              <span
                title="Unsaved changes"
                className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0"
              />
            )}
          </div>

          <div className="flex items-center gap-1 shrink-0">
            {!file.isBinary && !file.truncated && (
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
              title="Open in Full Screen Code Editor"
              className="p-1 rounded text-blue-300 hover:text-white hover:bg-blue-500/20 cursor-pointer"
            >
              <Maximize2 className="w-3.5 h-3.5" />
            </button>

            {!file.isBinary && (
              <button
                type="button"
                onClick={() => void handleCopy()}
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

            {!file.isBinary && (
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
      className="fixed inset-0 z-50 bg-[#0c0c10] text-neutral-100 flex flex-col"
      role="dialog"
      aria-modal="true"
      aria-label={`Full screen code editor: ${file.name}`}
    >
      {/* Full-Screen Top Toolbar */}
      <header className="h-[52px] shrink-0 px-4 border-b border-white/[0.08] bg-[#14141a] flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <button
            type="button"
            onClick={() => setExplorerOpen((p) => !p)}
            title={explorerOpen ? 'Hide project files' : 'Show project files'}
            className={`p-1.5 rounded-lg border transition-colors cursor-pointer shrink-0 ${
              explorerOpen
                ? 'border-blue-500/40 bg-blue-500/15 text-blue-300'
                : 'border-white/10 text-neutral-300 hover:bg-white/10'
            }`}
          >
            <PanelLeftOpen className="w-4 h-4" />
          </button>

          <FileText className="w-4 h-4 text-blue-400 shrink-0" />
          <div className="min-w-0 flex items-center gap-2">
            <span className="text-[14px] font-semibold text-white truncate">{file.name}</span>
            <span className="hidden md:inline font-mono-code text-[12px] text-neutral-500 truncate max-w-[360px]">
              {file.path}
            </span>
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
          <span className="hidden xl:inline text-[12px] text-neutral-400 tabular-nums mr-1.5">
            {languageLabel} · {lineCount.toLocaleString()} lines ·{' '}
            {formatBytes(new Blob([draft]).size)}
          </span>

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

          <button
            type="button"
            onClick={() => onReloadFile(file.path)}
            title="Reload latest file from remote server"
            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-white/10 text-[12px] font-medium text-neutral-300 hover:bg-white/10 transition-colors cursor-pointer whitespace-nowrap"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span className="hidden md:inline">Reload</span>
          </button>

          {isDirty && (
            <button
              type="button"
              onClick={() => setDraft(file.content)}
              title="Discard unsaved changes"
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-white/10 text-[12px] font-medium text-neutral-300 hover:bg-white/10 transition-colors cursor-pointer whitespace-nowrap"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span className="hidden md:inline">Discard</span>
            </button>
          )}

          {!file.isBinary && (
            <button
              type="button"
              onClick={() => void handleCopy()}
              title="Copy full file content"
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-white/10 text-[12px] font-medium text-neutral-300 hover:bg-white/10 transition-colors cursor-pointer whitespace-nowrap"
            >
              {copiedNotice ? (
                <>
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Copied</span>
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Copy</span>
                </>
              )}
            </button>
          )}

          {!file.isBinary && (
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

          {!file.isBinary && !file.truncated && (
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

      {/* Main Split: Optional Project Explorer Sidebar + Code Canvas */}
      <div className="flex-1 min-h-0 flex overflow-hidden">
        {explorerOpen && (
          <aside className="w-[260px] shrink-0 border-r border-white/[0.08] bg-[#121217] flex flex-col min-h-0">
            <div className="shrink-0 px-3 py-2 border-b border-white/[0.08] flex items-center justify-between gap-2">
              <span className="text-[12px] font-semibold text-neutral-200 truncate flex items-center gap-1.5">
                <FolderOpen className="w-3.5 h-3.5 text-blue-400 shrink-0" />
                <span className="truncate font-mono-code">
                  {currentRemotePath || getParentPosixPath(file.path)}
                </span>
              </span>
              <div className="flex items-center gap-1 shrink-0">
                <button
                  type="button"
                  onClick={() =>
                    onNavigateDir(
                      getParentPosixPath(currentRemotePath || getParentPosixPath(file.path))
                    )
                  }
                  disabled={dirLoading || currentRemotePath === '/'}
                  title="Parent directory"
                  className="p-1 rounded text-neutral-400 hover:text-white hover:bg-white/10 cursor-pointer"
                >
                  <ArrowUp className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => setCreatingFile((p) => !p)}
                  title="New file in current directory"
                  className="p-1 rounded text-neutral-400 hover:text-white hover:bg-white/10 cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {creatingFile && (
              <form
                onSubmit={handleCreateFileSubmit}
                className="shrink-0 p-2 border-b border-white/[0.08] flex items-center gap-1.5"
              >
                <input
                  type="text"
                  autoFocus
                  value={newFileName}
                  onChange={(e) => setNewFileName(e.target.value)}
                  placeholder="filename.ts"
                  className="font-mono-code flex-1 min-w-0 px-2 py-1 text-[12px] rounded border border-white/15 bg-[#0c0c10] text-white placeholder:text-neutral-500 focus:outline-none focus:border-blue-500"
                />
                <button
                  type="submit"
                  className="px-2 py-1 rounded bg-blue-600 hover:bg-blue-700 text-white text-[11px] font-medium cursor-pointer"
                >
                  Create
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setCreatingFile(false);
                    setNewFileName('');
                  }}
                  className="p-1 text-neutral-400 hover:text-white cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </form>
            )}

            <div className="flex-1 min-h-0 overflow-y-auto p-1.5 space-y-0.5">
              {dirLoading && (
                <div className="flex items-center gap-2 px-2 py-2 text-[12px] text-neutral-400">
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-400" />
                  <span>Loading...</span>
                </div>
              )}

              {dirEntries.map((entry) => {
                const isSelected = !entry.isDirectory && entry.path === file.path;
                return (
                  <button
                    key={entry.path}
                    type="button"
                    onClick={() => {
                      if (entry.isDirectory) {
                        onNavigateDir(entry.path);
                      } else {
                        handleAttemptSelectFile(entry.path);
                      }
                    }}
                    className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-left transition-colors cursor-pointer ${
                      isSelected
                        ? 'bg-blue-600/20 text-white font-medium'
                        : 'text-neutral-300 hover:bg-white/[0.06]'
                    }`}
                  >
                    {entry.isDirectory ? (
                      <FolderIcon className="w-3.5 h-3.5 text-blue-400 shrink-0" />
                    ) : (
                      <FileText className="w-3.5 h-3.5 text-neutral-400 shrink-0" />
                    )}
                    <span className="font-mono-code text-[12px] truncate">{entry.name}</span>
                  </button>
                );
              })}
            </div>
          </aside>
        )}

        {renderCodeArea(true)}
      </div>

      {/* Bottom Status Bar */}
      <footer className="h-7 shrink-0 px-4 border-t border-white/[0.08] bg-[#14141a] flex items-center justify-between text-[11px] text-neutral-400 tabular-nums">
        <div className="flex items-center gap-3">
          <span className="font-mono-code">
            Ln {cursorPos.line}, Col {cursorPos.col}
          </span>
          <span>UTF-8</span>
          <span>{languageLabel}</span>
        </div>
        <div className="hidden sm:block text-neutral-500">
          Ctrl+S to save · Tab to indent · Esc to exit full screen
        </div>
      </footer>
    </div>
  );
}
