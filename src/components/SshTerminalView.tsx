import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FitAddon } from '@xterm/addon-fit';
import { Terminal as XTerm } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import {
  AlertCircle,
  ArrowUp,
  BookmarkPlus,
  Braces,
  Check,
  ChevronDown,
  ChevronsDownUp,
  ChevronRight,
  ClipboardPaste,
  Copy,
  Eraser,
  Eye,
  EyeOff,
  FilePlus2,
  FolderOpen,
  GitBranch,
  Home,
  KeyRound,
  Loader2,
  Lock,
  Maximize2,
  PanelLeftOpen,
  Plug,
  PlugZap,
  Plus,
  RefreshCw,
  Server,
  Terminal,
  Trash2,
  Upload,
  Wand2,
  X,
} from 'lucide-react';
import { AuthUser, Folder, Snippet, SshAuthType, SshProfile } from '../types/notes';
import { StorageBackendMode } from '../utils/authClient';
import { formatRelativeDate } from '../utils/markdown';
import {
  buildSshWebSocketUrl,
  deleteSshProfile,
  fetchSshProfiles,
  formatSshCommand,
  parseSshCommand,
  saveSshProfile,
} from '../utils/sshClient';
import {
  getGitBadgeMeta,
  GitCommandAction,
  GitCommandRunner,
  GitStatusSnapshot,
} from '../utils/gitClient';
import { ProjectTreeView } from './ProjectTreeView';
import {
  RemoteCodeEditor,
  RemoteDirEntry,
  RemoteFilePreview,
} from './RemoteCodeEditor';
import { RemotePathInput } from './RemotePathInput';

interface SshTerminalViewProps {
  isActive?: boolean;
  storageMode: StorageBackendMode;
  currentUser: AuthUser;
  folders: Folder[];
  defaultFolderId?: string | null;
  snippets: Snippet[];
  sidebarOpen: boolean;
  onOpenSidebar: () => void;
  onConnectionStateChange?: (state: { connected: boolean; target: string | null }) => void;
  onSaveTranscriptToNote: (
    serverLabel: string,
    transcript: string,
    options?: { folderId?: string | null; openAiAfterSave?: boolean }
  ) => void;
}

type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

function quotePosixPath(p: string): string {
  return `'${p.replace(/'/g, `'"'"'`)}'`;
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

async function copyTextToClipboard(text: string): Promise<boolean> {
  if (!text) return false;
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // fallback below
    }
  }
  try {
    const el = document.createElement('textarea');
    el.value = text;
    el.style.position = 'fixed';
    el.style.left = '-9999px';
    document.body.appendChild(el);
    el.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(el);
    return ok;
  } catch {
    return false;
  }
}

const TERMINAL_THEME = {
  background: '#0c0c0f',
  foreground: '#e4e4e7',
  cursor: '#60a5fa',
  cursorAccent: '#0c0c0f',
  selectionBackground: 'rgba(59, 130, 246, 0.35)',
  black: '#18181b',
  red: '#f87171',
  green: '#4ade80',
  yellow: '#facc15',
  blue: '#60a5fa',
  magenta: '#c084fc',
  cyan: '#22d3ee',
  white: '#e4e4e7',
  brightBlack: '#71717a',
  brightRed: '#fca5a5',
  brightGreen: '#86efac',
  brightYellow: '#fde047',
  brightBlue: '#93c5fd',
  brightMagenta: '#d8b4fe',
  brightCyan: '#67e8f9',
  brightWhite: '#ffffff',
};

export function SshTerminalView({
  isActive = true,
  storageMode,
  currentUser,
  folders,
  defaultFolderId = null,
  snippets,
  sidebarOpen,
  onOpenSidebar,
  onConnectionStateChange,
  onSaveTranscriptToNote,
}: SshTerminalViewProps) {
  const [profiles, setProfiles] = useState<SshProfile[]>([]);
  const [loadingProfiles, setLoadingProfiles] = useState(true);
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(true);
  const [targetFolderId, setTargetFolderId] = useState<string>(
    defaultFolderId ?? folders[0]?.id ?? ''
  );

  const [commandInput, setCommandInput] = useState('');
  const [label, setLabel] = useState('');
  const [host, setHost] = useState('');
  const [port, setPort] = useState<string>('');
  const [username, setUsername] = useState('');
  const [authType, setAuthType] = useState<SshAuthType>('password');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [privateKey, setPrivateKey] = useState('');
  const [passphrase, setPassphrase] = useState('');

  const [status, setStatus] = useState<ConnectionStatus>('disconnected');
  const [statusMessage, setStatusMessage] = useState<string>('Ready to connect');
  const [connectedTarget, setConnectedTarget] = useState<string | null>(null);
  const [savingProfile, setSavingProfile] = useState(false);
  const [savedNotice, setSavedNotice] = useState(false);
  const [capturedNotice, setCapturedNotice] = useState(false);

  // Clipboard & terminal context menu state
  const [hasSelection, setHasSelection] = useState(false);
  const [copiedSelectionNotice, setCopiedSelectionNotice] = useState(false);
  const [clipboardNotice, setClipboardNotice] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);

  // Remote Project Directory browser state
  const [dirBrowserOpen, setDirBrowserOpen] = useState(false);
  const [currentRemotePath, setCurrentRemotePath] = useState('');
  const [pathInput, setPathInput] = useState('');
  const [dirCache, setDirCache] = useState<Record<string, RemoteDirEntry[]>>({});
  const [expandedDirs, setExpandedDirs] = useState<Record<string, boolean>>({});
  const [loadingDirs, setLoadingDirs] = useState<Record<string, boolean>>({});
  const [truncatedDirs, setTruncatedDirs] = useState<Record<string, boolean>>({});
  const [dirError, setDirError] = useState<string | null>(null);
  const [previewFile, setPreviewFile] = useState<RemoteFilePreview | null>(null);
  const [fileLoading, setFileLoading] = useState(false);
  const [editorFullScreen, setEditorFullScreen] = useState(false);
  const [savingFile, setSavingFile] = useState(false);
  const [saveFileError, setSaveFileError] = useState<string | null>(null);
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  const [creatingInDir, setCreatingInDir] = useState<string | null>(null);
  const [openDirPromptOpen, setOpenDirPromptOpen] = useState(false);
  const [openDirPromptInput, setOpenDirPromptInput] = useState('~');
  const [openDirPromptBusy, setOpenDirPromptBusy] = useState(false);
  const [openDirPromptError, setOpenDirPromptError] = useState<string | null>(null);
  const [homeQuickDirs, setHomeQuickDirs] = useState<RemoteDirEntry[]>([]);
  const [gitStatus, setGitStatus] = useState<GitStatusSnapshot | null>(null);
  const [gitLoading, setGitLoading] = useState(false);
  const [gitError, setGitError] = useState<string | null>(null);
  const [requestedIdeTab, setRequestedIdeTab] = useState<{
    tab: 'explorer' | 'git';
    seq: number;
  } | null>(null);
  const [dirDrawerWidth, setDirDrawerWidth] = useState<number>(() => {
    try {
      const saved = Number(window.localStorage.getItem('notecraft.ssh.dirDrawerWidth.v1'));
      if (Number.isFinite(saved) && saved >= 240 && saved <= 620) return saved;
    } catch {
      // ignore storage errors
    }
    return 340;
  });
  const [resizingDirDrawer, setResizingDirDrawer] = useState(false);
  const [isDesktopLg, setIsDesktopLg] = useState<boolean>(() =>
    typeof window !== 'undefined' ? window.innerWidth >= 1024 : true
  );

  const terminalContainerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<XTerm | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const keyFileInputRef = useRef<HTMLInputElement>(null);
  const passwordInputRef = useRef<HTMLInputElement>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const pendingDirReqRef = useRef<
    Map<string, { requestedPath: string; mode: 'root' | 'expand' }>
  >(new Map());
  const pendingAsyncDirReqsRef = useRef<
    Map<
      string,
      {
        resolve: (val: { path: string; entries: RemoteDirEntry[]; truncated: boolean }) => void;
        reject: (err: Error) => void;
        timer: number;
      }
    >
  >(new Map());
  const pendingAsyncFileReqsRef = useRef<
    Map<
      string,
      {
        resolve: (val: RemoteFilePreview) => void;
        reject: (err: Error) => void;
        timer: number;
      }
    >
  >(new Map());
  const pendingAsyncWriteReqsRef = useRef<
    Map<
      string,
      {
        resolve: (val: { path: string; size: number }) => void;
        reject: (err: Error) => void;
        content: string;
        timer: number;
      }
    >
  >(new Map());
  const pendingAsyncMkdirReqsRef = useRef<
    Map<
      string,
      {
        resolve: (val: { path: string }) => void;
        reject: (err: Error) => void;
        timer: number;
      }
    >
  >(new Map());
  const pendingAsyncGitReqsRef = useRef<
    Map<
      string,
      {
        resolve: (val: Record<string, unknown>) => void;
        reject: (err: Error) => void;
        timer: number;
      }
    >
  >(new Map());
  const dirCacheRef = useRef<Record<string, RemoteDirEntry[]>>(dirCache);
  dirCacheRef.current = dirCache;
  const expandedDirsRef = useRef<Record<string, boolean>>(expandedDirs);
  expandedDirsRef.current = expandedDirs;
  const dirBrowserOpenRef = useRef<boolean>(dirBrowserOpen);
  dirBrowserOpenRef.current = dirBrowserOpen;
  const statusRef = useRef<ConnectionStatus>(status);
  statusRef.current = status;
  const fileReqIdRef = useRef<string>('');
  const writeReqIdRef = useRef<string>('');
  const openFullScreenOnLoadRef = useRef<boolean>(false);
  const pendingSaveDraftRef = useRef<{
    path: string;
    content: string;
    isNewFile?: boolean;
  } | null>(null);
  const currentRemotePathRef = useRef<string>('');
  currentRemotePathRef.current = currentRemotePath;
  const selectedProfileIdRef = useRef<string | null>(null);
  selectedProfileIdRef.current = selectedProfileId;
  const profilesRef = useRef<SshProfile[]>(profiles);
  profilesRef.current = profiles;
  const isActiveRef = useRef<boolean>(isActive);
  isActiveRef.current = isActive;
  const copySelectionRef = useRef<() => Promise<boolean>>(async () => false);
  const pasteClipboardRef = useRef<() => Promise<void>>(async () => {});
  const requestListDirRef = useRef<
    (
      targetPath?: string,
      options?: { mode?: 'root' | 'expand'; keepPreview?: boolean; openFullScreen?: boolean }
    ) => void
  >(() => {});

  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)');
    const sync = () => setIsDesktopLg(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);

  useEffect(() => {
    onConnectionStateChange?.({
      connected: status === 'connected',
      target: connectedTarget,
    });
  }, [status, connectedTarget, onConnectionStateChange]);

  // Keep SSH WebSocket warm through reverse proxies while user switches to Database or Notes
  useEffect(() => {
    if (status !== 'connected' && status !== 'connecting') return;
    const timer = window.setInterval(() => {
      const ws = wsRef.current;
      if (ws && ws.readyState === WebSocket.OPEN) {
        try {
          ws.send(JSON.stringify({ type: 'ping' }));
        } catch {
          // ignore
        }
      }
    }, 25000);
    return () => window.clearInterval(timer);
  }, [status]);

  // Load saved server profiles
  useEffect(() => {
    let cancelled = false;
    setLoadingProfiles(true);
    fetchSshProfiles(storageMode, currentUser.id)
      .then((list) => {
        if (cancelled) return;
        setProfiles(list);
        setLoadingProfiles(false);
      })
      .catch(() => {
        if (!cancelled) setLoadingProfiles(false);
      });
    return () => {
      cancelled = true;
    };
  }, [storageMode, currentUser.id]);

  // Close terminal context menu on outside click
  useEffect(() => {
    if (!contextMenu) return;
    const handlePointerDown = (e: PointerEvent) => {
      if (
        contextMenu &&
        contextMenuRef.current &&
        !contextMenuRef.current.contains(e.target as Node)
      ) {
        setContextMenu(null);
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setContextMenu(null);
      }
    };
    window.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('keydown', handleKey);
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('keydown', handleKey);
    };
  }, [contextMenu]);

  const showClipboardHint = useCallback((msg: string) => {
    setClipboardNotice(msg);
    window.setTimeout(() => {
      setClipboardNotice((prev) => (prev === msg ? null : prev));
    }, 3200);
  }, []);

  const handleCopySelection = useCallback(async (): Promise<boolean> => {
    const term = termRef.current;
    if (!term) return false;
    const selected = term.getSelection();
    if (!selected) return false;
    const ok = await copyTextToClipboard(selected);
    if (ok) {
      setCopiedSelectionNotice(true);
      window.setTimeout(() => setCopiedSelectionNotice(false), 1500);
    } else {
      showClipboardHint('Copy failed — use Ctrl+C / Cmd+C with text selected.');
    }
    term.focus();
    return ok;
  }, [showClipboardHint]);

  const handlePasteToTerminal = useCallback(async () => {
    const ws = wsRef.current;
    const term = termRef.current;
    if (!term || !ws || ws.readyState !== WebSocket.OPEN) return;
    if (!navigator.clipboard?.readText) {
      showClipboardHint('Press Ctrl+V (or Cmd+V) inside the terminal to paste.');
      term.focus();
      return;
    }
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        term.paste(text);
      }
    } catch {
      showClipboardHint('Clipboard read blocked — press Ctrl+V (or Cmd+V) inside the terminal.');
    } finally {
      term.focus();
    }
  }, [showClipboardHint]);

  copySelectionRef.current = handleCopySelection;
  pasteClipboardRef.current = handlePasteToTerminal;

  // Initialize xterm.js terminal
  useEffect(() => {
    const container = terminalContainerRef.current;
    if (!container) return;

    const term = new XTerm({
      cursorBlink: true,
      fontFamily:
        "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
      fontSize: 13.5,
      lineHeight: 1.35,
      scrollback: 5000,
      theme: TERMINAL_THEME,
      convertEol: false,
    });
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(container);

    termRef.current = term;
    fitAddonRef.current = fitAddon;

    const safeFit = () => {
      if (!isActiveRef.current) return;
      if (container.clientWidth < 40 || container.clientHeight < 40) return;
      try {
        fitAddon.fit();
        const ws = wsRef.current;
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(
            JSON.stringify({
              type: 'resize',
              cols: term.cols,
              rows: term.rows,
            })
          );
        }
      } catch {
        // Ignore fit errors while container is zero-sized
      }
    };

    window.requestAnimationFrame(safeFit);

    term.writeln('\x1b[1;34mNoteCraft SSH Terminal\x1b[0m');
    term.writeln(
      '\x1b[90mEnter an SSH command (e.g. ssh user@host -p 22) or pick a saved server to begin.\x1b[0m'
    );
    term.writeln('');

    const inputDisposable = term.onData((data) => {
      const ws = wsRef.current;
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'input', data }));
      }
    });

    const selectionDisposable = term.onSelectionChange(() => {
      setHasSelection(term.hasSelection());
    });

    const osc7Disposable = term.parser.registerOscHandler(7, (data) => {
      try {
        const match = /^file:\/\/[^/]*(\/.*)$/i.exec(data.trim());
        if (!match?.[1]) return false;
        const decodedPath = decodeURIComponent(match[1]);
        if (decodedPath && decodedPath.startsWith('/')) {
          setPathInput(decodedPath);
          if (dirBrowserOpenRef.current && decodedPath !== currentRemotePathRef.current) {
            requestListDirRef.current(decodedPath, { mode: 'root', keepPreview: true });
          }
        }
      } catch {
        // ignore malformed OSC-7 URI
      }
      return false;
    });

    term.attachCustomKeyEventHandler((ev) => {
      if (ev.type !== 'keydown') return true;
      const key = ev.key.toLowerCase();

      // Ctrl+Shift+C always copies terminal selection
      if (ev.ctrlKey && ev.shiftKey && !ev.altKey && key === 'c') {
        ev.preventDefault();
        void copySelectionRef.current();
        return false;
      }

      // Cmd+C (macOS) or Ctrl+C when text is selected copies instead of sending SIGINT
      if (
        ((ev.metaKey && !ev.ctrlKey && !ev.altKey) ||
          (ev.ctrlKey && !ev.shiftKey && !ev.altKey && !ev.metaKey)) &&
        key === 'c' &&
        term.hasSelection()
      ) {
        ev.preventDefault();
        void copySelectionRef.current().then((ok) => {
          if (ok) term.clearSelection();
        });
        return false;
      }

      // Ctrl+Insert copies selection
      if (ev.ctrlKey && ev.key === 'Insert' && term.hasSelection()) {
        ev.preventDefault();
        void copySelectionRef.current();
        return false;
      }

      // Ctrl+Shift+V or Shift+Insert pastes via clipboard API
      if (
        (ev.ctrlKey && ev.shiftKey && !ev.altKey && key === 'v') ||
        (ev.shiftKey && ev.key === 'Insert')
      ) {
        ev.preventDefault();
        void pasteClipboardRef.current();
        return false;
      }

      // Ctrl+V / Cmd+V: tell xterm NOT to emit raw 0x16, allowing browser native paste event
      if ((ev.ctrlKey || ev.metaKey) && !ev.shiftKey && !ev.altKey && key === 'v') {
        return false;
      }

      return true;
    });

    const resizeObserver = new ResizeObserver(() => {
      safeFit();
    });
    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
      inputDisposable.dispose();
      selectionDisposable.dispose();
      osc7Disposable.dispose();
      if (wsRef.current) {
        try {
          wsRef.current.close();
        } catch {
          // ignore
        }
        wsRef.current = null;
      }
      term.dispose();
      termRef.current = null;
      fitAddonRef.current = null;
    };
  }, []);

  // Re-fit & refresh terminal when switching back to SSH tab or toggling panels
  useEffect(() => {
    if (!isActive) return;
    const runFit = () => {
      const container = terminalContainerRef.current;
      if (!container || container.clientWidth < 40 || container.clientHeight < 40) return;
      try {
        fitAddonRef.current?.fit();
        const term = termRef.current;
        const ws = wsRef.current;
        if (term) {
          term.refresh(0, Math.max(0, term.rows - 1));
          if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
          }
        }
      } catch {
        // ignore
      }
    };
    const raf = window.requestAnimationFrame(runFit);
    const timer = window.setTimeout(() => {
      runFit();
      if (status === 'connected') {
        termRef.current?.focus();
      }
    }, 80);
    return () => {
      window.cancelAnimationFrame(raf);
      window.clearTimeout(timer);
    };
  }, [isActive, panelOpen, sidebarOpen, dirBrowserOpen, dirDrawerWidth, status]);

  const handleCommandInputChange = (raw: string) => {
    setCommandInput(raw);
    const parsed = parseSshCommand(raw);
    if (!parsed) return;
    if (parsed.host !== undefined) setHost(parsed.host);
    if (parsed.username !== undefined) setUsername(parsed.username);
    if (parsed.port !== undefined) setPort(String(parsed.port));
    if (parsed.keyHint) setAuthType('privateKey');
  };

  const syncCommandPreview = (nextUser: string, nextHost: string, nextPort: string) => {
    const portNum = Number(nextPort) || 22;
    if (nextHost.trim()) {
      setCommandInput(formatSshCommand({ username: nextUser, host: nextHost, port: portNum }));
    } else {
      setCommandInput('');
    }
  };

  const rejectPendingAsyncRequests = useCallback((reason: string) => {
    const err = new Error(reason);
    pendingAsyncDirReqsRef.current.forEach((pending) => {
      window.clearTimeout(pending.timer);
      pending.reject(err);
    });
    pendingAsyncDirReqsRef.current.clear();

    pendingAsyncFileReqsRef.current.forEach((pending) => {
      window.clearTimeout(pending.timer);
      pending.reject(err);
    });
    pendingAsyncFileReqsRef.current.clear();

    pendingAsyncWriteReqsRef.current.forEach((pending) => {
      window.clearTimeout(pending.timer);
      pending.reject(err);
    });
    pendingAsyncWriteReqsRef.current.clear();

    pendingAsyncMkdirReqsRef.current.forEach((pending) => {
      window.clearTimeout(pending.timer);
      pending.reject(err);
    });
    pendingAsyncMkdirReqsRef.current.clear();

    pendingAsyncGitReqsRef.current.forEach((pending) => {
      window.clearTimeout(pending.timer);
      pending.reject(err);
    });
    pendingAsyncGitReqsRef.current.clear();
  }, []);

  const clearConnectionFields = useCallback(() => {
    setSelectedProfileId(null);
    setCommandInput('');
    setLabel('');
    setHost('');
    setPort('');
    setUsername('');
    setAuthType('password');
    setPassword('');
    setShowPassword(false);
    setPrivateKey('');
    setPassphrase('');
  }, []);

  const closeSocket = useCallback(
    (sendDisconnectMsg = true) => {
      rejectPendingAsyncRequests('SSH connection closed.');
      const ws = wsRef.current;
      if (!ws) return;
      try {
        if (sendDisconnectMsg && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'disconnect' }));
        }
        ws.close();
      } catch {
        // ignore
      }
      wsRef.current = null;
    },
    [rejectPendingAsyncRequests]
  );

  const handleDisconnect = () => {
    closeSocket(true);
    clearConnectionFields();
    setStatus('disconnected');
    setStatusMessage('Disconnected');
    setConnectedTarget(null);
    setDirBrowserOpen(false);
    setOpenDirPromptOpen(false);
    setOpenDirPromptError(null);
    setHomeQuickDirs([]);
    setCurrentRemotePath('');
    setPathInput('');
    setDirCache({});
    setExpandedDirs({});
    setLoadingDirs({});
    setTruncatedDirs({});
    pendingDirReqRef.current.clear();
    setPreviewFile(null);
    setEditorFullScreen(false);
    setSavingFile(false);
    setSaveFileError(null);
    setLastSavedAt(null);
    setCreatingInDir(null);
    setGitStatus(null);
    setGitLoading(false);
    setGitError(null);
    pendingSaveDraftRef.current = null;
    openFullScreenOnLoadRef.current = false;
    setDirError(null);
  };

  const requestListDir = useCallback(
    (
      targetPath?: string,
      options?: { mode?: 'root' | 'expand'; keepPreview?: boolean; openFullScreen?: boolean }
    ) => {
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      const mode = options?.mode ?? 'root';
      const cleanReqPath = targetPath ?? '';
      const loadKey = cleanReqPath || '__root__';
      const reqId = `dir-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      pendingDirReqRef.current.set(reqId, { requestedPath: loadKey, mode });
      setLoadingDirs((prev) => ({ ...prev, [loadKey]: true }));
      setDirError(null);
      if (options?.openFullScreen) {
        setPreviewFile(null);
        setCreatingInDir(null);
        setEditorFullScreen(true);
      } else if (mode === 'root' && !options?.keepPreview) {
        setPreviewFile(null);
        setEditorFullScreen(false);
        setCreatingInDir(null);
      }
      ws.send(
        JSON.stringify({
          type: 'listDir',
          requestId: reqId,
          path: cleanReqPath,
        })
      );
    },
    []
  );

  requestListDirRef.current = requestListDir;

  const listRemoteDirAsync = useCallback(
    (dirPath: string): Promise<{ path: string; entries: RemoteDirEntry[]; truncated: boolean }> => {
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        return Promise.reject(new Error('SSH is not connected.'));
      }
      const reqId = `adir-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      return new Promise((resolve, reject) => {
        const timer = window.setTimeout(() => {
          pendingAsyncDirReqsRef.current.delete(reqId);
          reject(new Error(`Timed out listing directory: ${dirPath}`));
        }, 15000);
        pendingAsyncDirReqsRef.current.set(reqId, { resolve, reject, timer });
        ws.send(
          JSON.stringify({
            type: 'listDir',
            requestId: reqId,
            path: dirPath,
          })
        );
      });
    },
    []
  );

  const readRemoteFileAsync = useCallback((filePath: string): Promise<RemoteFilePreview> => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error('SSH is not connected.'));
    }
    const reqId = `afile-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    return new Promise((resolve, reject) => {
      const timer = window.setTimeout(() => {
        pendingAsyncFileReqsRef.current.delete(reqId);
        reject(new Error(`Timed out reading file: ${filePath}`));
      }, 15000);
      pendingAsyncFileReqsRef.current.set(reqId, { resolve, reject, timer });
      ws.send(
        JSON.stringify({
          type: 'readFile',
          requestId: reqId,
          path: filePath,
        })
      );
    });
  }, []);

  const writeRemoteFileAsync = useCallback(
    (filePath: string, nextContent: string): Promise<{ path: string; size: number }> => {
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        return Promise.reject(new Error('SSH is not connected.'));
      }
      const reqId = `awrite-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      return new Promise((resolve, reject) => {
        const timer = window.setTimeout(() => {
          pendingAsyncWriteReqsRef.current.delete(reqId);
          reject(new Error(`Timed out saving file: ${filePath}`));
        }, 20000);
        pendingAsyncWriteReqsRef.current.set(reqId, {
          resolve,
          reject,
          content: nextContent,
          timer,
        });
        ws.send(
          JSON.stringify({
            type: 'writeFile',
            requestId: reqId,
            path: filePath,
            content: nextContent,
          })
        );
      });
    },
    []
  );

  const createRemoteDirAsync = useCallback((dirPath: string): Promise<{ path: string }> => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error('SSH is not connected.'));
    }
    const reqId = `amkdir-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    return new Promise((resolve, reject) => {
      const timer = window.setTimeout(() => {
        pendingAsyncMkdirReqsRef.current.delete(reqId);
        reject(new Error(`Timed out creating directory: ${dirPath}`));
      }, 15000);
      pendingAsyncMkdirReqsRef.current.set(reqId, { resolve, reject, timer });
      ws.send(
        JSON.stringify({
          type: 'createDir',
          requestId: reqId,
          path: dirPath,
        })
      );
    });
  }, []);

  const runGitCommandAsync = useCallback<GitCommandRunner>(
    (action: GitCommandAction, payload?: Record<string, unknown>, cwd?: string) => {
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        return Promise.reject(new Error('SSH is not connected.'));
      }
      const reqId = `git-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const targetCwd = cwd || currentRemotePathRef.current || '~';
      return new Promise((resolve, reject) => {
        const timer = window.setTimeout(() => {
          pendingAsyncGitReqsRef.current.delete(reqId);
          reject(new Error(`Timed out running git ${action}.`));
        }, 45000);
        pendingAsyncGitReqsRef.current.set(reqId, { resolve, reject, timer });
        ws.send(
          JSON.stringify({
            type: 'gitCommand',
            requestId: reqId,
            cwd: targetCwd,
            action,
            payload: payload || {},
          })
        );
      });
    },
    []
  );

  const refreshGitStatus = useCallback(
    async (cwdOverride?: string) => {
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      const targetCwd = cwdOverride || currentRemotePathRef.current;
      if (!targetCwd) return;
      setGitLoading(true);
      setGitError(null);
      try {
        const snapshot = (await runGitCommandAsync(
          'status',
          {},
          targetCwd
        )) as unknown as GitStatusSnapshot;
        setGitStatus(snapshot);
      } catch (err) {
        setGitError(err instanceof Error ? err.message : 'Unable to check Git status.');
      } finally {
        setGitLoading(false);
      }
    },
    [runGitCommandAsync]
  );

  useEffect(() => {
    if (status === 'connected' && currentRemotePath) {
      void refreshGitStatus(currentRemotePath);
    }
  }, [status, currentRemotePath, refreshGitStatus]);

  const handleToggleTreeDir = useCallback(
    (dirPath: string) => {
      const currentlyExpanded = Boolean(expandedDirsRef.current[dirPath]);
      if (currentlyExpanded) {
        setExpandedDirs((prev) => ({ ...prev, [dirPath]: false }));
        return;
      }
      setExpandedDirs((prev) => ({ ...prev, [dirPath]: true }));
      if (!dirCacheRef.current[dirPath]) {
        requestListDir(dirPath, { mode: 'expand', keepPreview: true });
      }
    },
    [requestListDir]
  );

  const handleCollapseAllDirs = useCallback(() => {
    setExpandedDirs({});
    setCreatingInDir(null);
  }, []);

  const handleRefreshExplorer = useCallback(() => {
    const root = currentRemotePathRef.current;
    if (!root) {
      requestListDir('', { mode: 'root', keepPreview: true });
      return;
    }
    requestListDir(root, { mode: 'root', keepPreview: true });
    Object.entries(expandedDirsRef.current).forEach(([dirPath, isOpen]) => {
      if (isOpen && dirPath !== root) {
        requestListDir(dirPath, { mode: 'expand', keepPreview: true });
      }
    });
  }, [requestListDir]);

  const requestReadFile = useCallback(
    (filePath: string, options?: { openFullScreen?: boolean }) => {
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      const reqId = `file-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      fileReqIdRef.current = reqId;
      openFullScreenOnLoadRef.current = Boolean(options?.openFullScreen);
      setFileLoading(true);
      setDirError(null);
      setSaveFileError(null);
      ws.send(
        JSON.stringify({
          type: 'readFile',
          requestId: reqId,
          path: filePath,
        })
      );
    },
    []
  );

  const requestWriteFile = useCallback(
    (filePath: string, nextContent: string, isNewFile = false) => {
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        setSaveFileError('SSH is not connected.');
        return;
      }
      const reqId = `write-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      writeReqIdRef.current = reqId;
      pendingSaveDraftRef.current = { path: filePath, content: nextContent, isNewFile };
      setSavingFile(true);
      setSaveFileError(null);
      ws.send(
        JSON.stringify({
          type: 'writeFile',
          requestId: reqId,
          path: filePath,
          content: nextContent,
        })
      );
    },
    []
  );

  const handleCreateNewRemoteFile = useCallback(
    (fullPath: string, initialContent = '') => {
      requestWriteFile(fullPath, initialContent, true);
    },
    [requestWriteFile]
  );

  const handleStartResizeDirDrawer = useCallback(
    (startEvent: React.MouseEvent) => {
      startEvent.preventDefault();
      const startX = startEvent.clientX;
      const startWidth = dirDrawerWidth;
      let latestWidth = startWidth;
      setResizingDirDrawer(true);

      const prevCursor = document.body.style.cursor;
      const prevSelect = document.body.style.userSelect;
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';

      const handleMouseMove = (moveEvent: MouseEvent) => {
        const delta = startX - moveEvent.clientX;
        const maxWidth = Math.max(300, Math.min(640, Math.floor(window.innerWidth * 0.55)));
        latestWidth = Math.max(240, Math.min(maxWidth, startWidth + delta));
        setDirDrawerWidth(latestWidth);
      };

      const handleMouseUp = () => {
        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('mouseup', handleMouseUp);
        document.body.style.cursor = prevCursor;
        document.body.style.userSelect = prevSelect;
        setResizingDirDrawer(false);
        try {
          window.localStorage.setItem('notecraft.ssh.dirDrawerWidth.v1', String(latestWidth));
        } catch {
          // ignore storage errors
        }
      };

      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    },
    [dirDrawerWidth]
  );

  const handleToggleDirBrowser = () => {
    if (status !== 'connected') return;
    const nextOpen = !dirBrowserOpen;
    setDirBrowserOpen(nextOpen);
    if (nextOpen && !currentRemotePath) {
      requestListDir('', { mode: 'root' });
    }
  };

  const handleConnect = (e?: React.FormEvent) => {
    if (e) e.preventDefault();

    const parsedFromCmd = commandInput.trim() ? parseSshCommand(commandInput) : null;
    const targetHost = (host.trim() || parsedFromCmd?.host || '').trim();
    const targetUser = (username.trim() || parsedFromCmd?.username || 'root').trim();
    const targetPort = Math.max(
      1,
      Math.min(65535, Math.round(Number(port || parsedFromCmd?.port || 22)))
    );

    if (!targetHost) {
      setStatus('error');
      setStatusMessage('Enter a server hostname or IP address.');
      return;
    }
    if (!targetUser) {
      setStatus('error');
      setStatusMessage('Enter an SSH username.');
      return;
    }
    if (authType === 'password' && !password) {
      setStatus('error');
      setStatusMessage('Enter the SSH password (or switch to Private Key).');
      passwordInputRef.current?.focus();
      return;
    }
    if (authType === 'privateKey' && !privateKey.trim()) {
      setStatus('error');
      setStatusMessage('Paste or upload an SSH private key.');
      return;
    }

    closeSocket(false);
    setStatus('connecting');
    setStatusMessage(`Connecting to ${targetUser}@${targetHost}:${targetPort}...`);
    setConnectedTarget(null);
    setCurrentRemotePath('');
    setPathInput('');
    setDirCache({});
    setExpandedDirs({});
    setLoadingDirs({});
    setTruncatedDirs({});
    pendingDirReqRef.current.clear();
    setPreviewFile(null);
    setEditorFullScreen(false);
    setSavingFile(false);
    setSaveFileError(null);
    setLastSavedAt(null);
    setCreatingInDir(null);
    pendingSaveDraftRef.current = null;
    openFullScreenOnLoadRef.current = false;
    setDirError(null);

    const term = termRef.current;
    if (term) {
      term.writeln(`\r\n\x1b[36m→ ssh ${targetUser}@${targetHost} -p ${targetPort}\x1b[0m`);
    }

    const ws = new WebSocket(buildSshWebSocketUrl());
    wsRef.current = ws;

    ws.onopen = () => {
      if (wsRef.current !== ws) return;
      try {
        fitAddonRef.current?.fit();
      } catch {
        // ignore
      }
      const cols = termRef.current?.cols || 100;
      const rows = termRef.current?.rows || 30;
      ws.send(
        JSON.stringify({
          type: 'connect',
          host: targetHost,
          port: targetPort,
          username: targetUser,
          authType,
          password,
          privateKey,
          passphrase: passphrase || undefined,
          cols,
          rows,
        })
      );
    };

    ws.onmessage = (event) => {
      if (wsRef.current !== ws) return;
      let msg: {
        type?: string;
        data?: string;
        status?: ConnectionStatus;
        message?: string;
        host?: string;
        port?: number;
        username?: string;
        requestId?: string;
        path?: string;
        entries?: RemoteDirEntry[];
        truncated?: boolean;
        error?: string;
        name?: string;
        content?: string;
        size?: number;
        isBinary?: boolean;
        savedAt?: number;
        action?: string;
      };
      try {
        msg = JSON.parse(String(event.data));
      } catch {
        return;
      }

      if (msg.type === 'data' && typeof msg.data === 'string') {
        termRef.current?.write(msg.data);
        return;
      }

      if (msg.type === 'dirListing') {
        const asyncPending = msg.requestId
          ? pendingAsyncDirReqsRef.current.get(msg.requestId)
          : undefined;
        const resolvedPath = msg.path || '/';
        const entries = Array.isArray(msg.entries) ? msg.entries : [];

        if (asyncPending && msg.requestId) {
          window.clearTimeout(asyncPending.timer);
          pendingAsyncDirReqsRef.current.delete(msg.requestId);
          setDirCache((prev) => ({ ...prev, [resolvedPath]: entries }));
          setTruncatedDirs((prev) => ({
            ...prev,
            [resolvedPath]: Boolean(msg.truncated),
          }));
          asyncPending.resolve({
            path: resolvedPath,
            entries,
            truncated: Boolean(msg.truncated),
          });
          return;
        }

        const reqInfo = msg.requestId ? pendingDirReqRef.current.get(msg.requestId) : undefined;
        if (msg.requestId) {
          pendingDirReqRef.current.delete(msg.requestId);
        }

        setLoadingDirs((prev) => {
          const next = { ...prev };
          if (reqInfo?.requestedPath) delete next[reqInfo.requestedPath];
          delete next[resolvedPath];
          delete next['__root__'];
          return next;
        });
        setDirError(null);
        setDirCache((prev) => ({ ...prev, [resolvedPath]: entries }));
        setTruncatedDirs((prev) => ({
          ...prev,
          [resolvedPath]: Boolean(msg.truncated),
        }));

        if (!reqInfo || reqInfo.mode === 'root') {
          setCurrentRemotePath(resolvedPath);
          setPathInput(resolvedPath);
        } else {
          setExpandedDirs((prev) => ({ ...prev, [resolvedPath]: true }));
        }
        return;
      }

      if (msg.type === 'dirError') {
        const asyncPending = msg.requestId
          ? pendingAsyncDirReqsRef.current.get(msg.requestId)
          : undefined;
        if (asyncPending && msg.requestId) {
          window.clearTimeout(asyncPending.timer);
          pendingAsyncDirReqsRef.current.delete(msg.requestId);
          asyncPending.reject(new Error(msg.error || 'Unable to list remote directory.'));
          return;
        }

        const reqInfo = msg.requestId ? pendingDirReqRef.current.get(msg.requestId) : undefined;
        if (msg.requestId) {
          pendingDirReqRef.current.delete(msg.requestId);
        }
        setLoadingDirs((prev) => {
          const next = { ...prev };
          if (reqInfo?.requestedPath) delete next[reqInfo.requestedPath];
          delete next['__root__'];
          return next;
        });
        setDirError(msg.error || 'Unable to list remote directory.');
        return;
      }

      if (msg.type === 'fileContent') {
        const asyncPending = msg.requestId
          ? pendingAsyncFileReqsRef.current.get(msg.requestId)
          : undefined;
        const preview: RemoteFilePreview = {
          path: msg.path || '',
          name: msg.name || 'file',
          content: msg.content || '',
          size: Number(msg.size || 0),
          truncated: Boolean(msg.truncated),
          isBinary: Boolean(msg.isBinary),
        };
        if (asyncPending && msg.requestId) {
          window.clearTimeout(asyncPending.timer);
          pendingAsyncFileReqsRef.current.delete(msg.requestId);
          asyncPending.resolve(preview);
          return;
        }

        if (msg.requestId && msg.requestId !== fileReqIdRef.current) return;
        setFileLoading(false);
        setSaveFileError(null);
        setLastSavedAt(null);
        setPreviewFile(preview);
        if (openFullScreenOnLoadRef.current) {
          openFullScreenOnLoadRef.current = false;
          setEditorFullScreen(true);
        }
        return;
      }

      if (msg.type === 'fileError') {
        const asyncPending = msg.requestId
          ? pendingAsyncFileReqsRef.current.get(msg.requestId)
          : undefined;
        if (asyncPending && msg.requestId) {
          window.clearTimeout(asyncPending.timer);
          pendingAsyncFileReqsRef.current.delete(msg.requestId);
          asyncPending.reject(new Error(msg.error || 'Unable to read remote file.'));
          return;
        }

        if (msg.requestId && msg.requestId !== fileReqIdRef.current) return;
        openFullScreenOnLoadRef.current = false;
        setFileLoading(false);
        setDirError(msg.error || 'Unable to read remote file.');
        return;
      }

      if (msg.type === 'writeFileResult') {
        const asyncPending = msg.requestId
          ? pendingAsyncWriteReqsRef.current.get(msg.requestId)
          : undefined;
        if (asyncPending && msg.requestId) {
          window.clearTimeout(asyncPending.timer);
          pendingAsyncWriteReqsRef.current.delete(msg.requestId);
          const savedPath = msg.path || '';
          const savedSize = Number(msg.size ?? new Blob([asyncPending.content]).size);
          setLastSavedAt(Number(msg.savedAt || Date.now()));
          const fileName = savedPath.split('/').pop() || 'file';
          setPreviewFile((prev) => {
            if (prev && prev.path === savedPath) {
              return {
                path: savedPath,
                name: fileName,
                content: asyncPending.content,
                size: savedSize,
                truncated: false,
                isBinary: false,
              };
            }
            return prev;
          });
          const parentDir = savedPath ? getParentPosixPath(savedPath) : '';
          if (
            parentDir &&
            (parentDir === currentRemotePathRef.current || Boolean(dirCacheRef.current[parentDir]))
          ) {
            requestListDir(parentDir, {
              mode: parentDir === currentRemotePathRef.current ? 'root' : 'expand',
              keepPreview: true,
            });
          }
          asyncPending.resolve({ path: savedPath, size: savedSize });
          return;
        }

        if (msg.requestId && msg.requestId !== writeReqIdRef.current) return;
        setSavingFile(false);
        setSaveFileError(null);
        const pending = pendingSaveDraftRef.current;
        pendingSaveDraftRef.current = null;
        const savedPath = msg.path || pending?.path || '';
        const savedContent = pending?.content ?? '';
        const savedSize = Number(msg.size ?? new Blob([savedContent]).size);
        setLastSavedAt(Number(msg.savedAt || Date.now()));

        const fileName = savedPath.split('/').pop() || 'file';
        setPreviewFile((prev) => {
          if (pending?.isNewFile || !prev || prev.path === savedPath) {
            return {
              path: savedPath,
              name: fileName,
              content: savedContent,
              size: savedSize,
              truncated: false,
              isBinary: false,
            };
          }
          return prev;
        });

        const parentDir = savedPath ? getParentPosixPath(savedPath) : currentRemotePathRef.current;
        if (parentDir) {
          const isRoot = parentDir === currentRemotePathRef.current;
          requestListDir(parentDir, {
            mode: isRoot ? 'root' : 'expand',
            keepPreview: true,
          });
        }
        return;
      }

      if (msg.type === 'writeFileError') {
        const asyncPending = msg.requestId
          ? pendingAsyncWriteReqsRef.current.get(msg.requestId)
          : undefined;
        if (asyncPending && msg.requestId) {
          window.clearTimeout(asyncPending.timer);
          pendingAsyncWriteReqsRef.current.delete(msg.requestId);
          asyncPending.reject(new Error(msg.error || 'Unable to save remote file.'));
          return;
        }

        if (msg.requestId && msg.requestId !== writeReqIdRef.current) return;
        setSavingFile(false);
        pendingSaveDraftRef.current = null;
        setSaveFileError(msg.error || 'Unable to save remote file.');
        return;
      }

      if (msg.type === 'createDirResult') {
        const asyncPending = msg.requestId
          ? pendingAsyncMkdirReqsRef.current.get(msg.requestId)
          : undefined;
        const createdDir = msg.path || '';
        if (asyncPending && msg.requestId) {
          window.clearTimeout(asyncPending.timer);
          pendingAsyncMkdirReqsRef.current.delete(msg.requestId);
          const parentDir = createdDir ? getParentPosixPath(createdDir) : '';
          if (
            parentDir &&
            (parentDir === currentRemotePathRef.current || Boolean(dirCacheRef.current[parentDir]))
          ) {
            requestListDir(parentDir, {
              mode: parentDir === currentRemotePathRef.current ? 'root' : 'expand',
              keepPreview: true,
            });
          }
          asyncPending.resolve({ path: createdDir });
        }
        return;
      }

      if (msg.type === 'createDirError') {
        const asyncPending = msg.requestId
          ? pendingAsyncMkdirReqsRef.current.get(msg.requestId)
          : undefined;
        if (asyncPending && msg.requestId) {
          window.clearTimeout(asyncPending.timer);
          pendingAsyncMkdirReqsRef.current.delete(msg.requestId);
          asyncPending.reject(new Error(msg.error || 'Unable to create remote directory.'));
        }
        return;
      }

      if (msg.type === 'gitResult') {
        const asyncPending = msg.requestId
          ? pendingAsyncGitReqsRef.current.get(msg.requestId)
          : undefined;
        if (asyncPending && msg.requestId) {
          window.clearTimeout(asyncPending.timer);
          pendingAsyncGitReqsRef.current.delete(msg.requestId);
          const resultData =
            (msg as unknown as { data?: Record<string, unknown> }).data ?? {};
          asyncPending.resolve(resultData);
        }
        return;
      }

      if (msg.type === 'gitError') {
        const asyncPending = msg.requestId
          ? pendingAsyncGitReqsRef.current.get(msg.requestId)
          : undefined;
        if (asyncPending && msg.requestId) {
          window.clearTimeout(asyncPending.timer);
          pendingAsyncGitReqsRef.current.delete(msg.requestId);
          asyncPending.reject(new Error(msg.error || 'Git command failed.'));
        }
        return;
      }

      if (msg.type === 'status' && msg.status) {
        setStatus(msg.status);
        if (msg.message) setStatusMessage(msg.message);

        if (msg.status === 'connected') {
          const targetLabel = `${msg.username || targetUser}@${msg.host || targetHost}:${
            msg.port || targetPort
          }`;
          setConnectedTarget(targetLabel);
          setOpenDirPromptError(null);
          setOpenDirPromptInput('~');
          setHomeQuickDirs([]);
          setOpenDirPromptOpen(true);

          void listRemoteDirAsync('~')
            .then(({ path: homePath, entries }) => {
              setOpenDirPromptInput((cur) => (!cur || cur === '~' ? homePath : cur));
              setHomeQuickDirs(entries.filter((entry) => entry.isDirectory).slice(0, 8));
            })
            .catch(() => {
              // ignore pre-fetch error; user can type any directory
            });

          // Update lastConnectedAt if a saved profile is active
          const activeId = selectedProfileIdRef.current;
          const existing = activeId
            ? profilesRef.current.find((p) => p.id === activeId)
            : null;
          if (existing) {
            void saveSshProfile(storageMode, currentUser.id, {
              ...existing,
              lastConnectedAt: Date.now(),
            }).then((updated) => {
              setProfiles((prev) =>
                prev.map((p) => (p.id === updated.id ? updated : p))
              );
            });
          }
        } else if (msg.status === 'error') {
          rejectPendingAsyncRequests(msg.message || 'SSH connection error.');
          setConnectedTarget(null);
          setOpenDirPromptOpen(false);
          if (msg.message) {
            termRef.current?.writeln(`\x1b[31m✖ ${msg.message}\x1b[0m`);
          }
        } else if (msg.status === 'disconnected') {
          rejectPendingAsyncRequests(msg.message || 'SSH disconnected.');
          clearConnectionFields();
          setConnectedTarget(null);
          setDirBrowserOpen(false);
          setOpenDirPromptOpen(false);
          setEditorFullScreen(false);
          setPreviewFile(null);
          setGitStatus(null);
          setGitError(null);
          if (msg.message) {
            termRef.current?.writeln(`\r\n\x1b[90m[${msg.message}]\x1b[0m`);
          }
        }
      }
    };

    ws.onerror = () => {
      if (wsRef.current !== ws) return;
      rejectPendingAsyncRequests('WebSocket connection to SSH gateway failed.');
      setStatus('error');
      setStatusMessage('WebSocket connection to SSH gateway failed.');
      setConnectedTarget(null);
    };

    ws.onclose = () => {
      if (wsRef.current !== ws) return;
      const wasConnected = statusRef.current === 'connected';
      rejectPendingAsyncRequests('WebSocket connection closed.');
      wsRef.current = null;
      if (wasConnected) {
        clearConnectionFields();
        setOpenDirPromptOpen(false);
        setDirBrowserOpen(false);
        setEditorFullScreen(false);
        setPreviewFile(null);
        setGitStatus(null);
        setGitError(null);
      }
      setStatus((prev) => (prev === 'error' ? 'error' : 'disconnected'));
      setConnectedTarget(null);
    };
  };

  const handleSaveProfile = async () => {
    const cleanHost = host.trim();
    const cleanUser = username.trim();
    if (!cleanHost || !cleanUser) {
      setStatus('error');
      setStatusMessage('Enter host and username before saving a server profile.');
      return;
    }

    setSavingProfile(true);
    try {
      const saved = await saveSshProfile(storageMode, currentUser.id, {
        id: selectedProfileId ?? undefined,
        label: label.trim() || `${cleanUser}@${cleanHost}`,
        host: cleanHost,
        port: Number(port || 22),
        username: cleanUser,
        authType,
      });
      setSelectedProfileId(saved.id);
      setProfiles((prev) => {
        const filtered = prev.filter((p) => p.id !== saved.id);
        return [saved, ...filtered];
      });
      setSavedNotice(true);
      window.setTimeout(() => setSavedNotice(false), 1800);
    } catch (err) {
      setStatus('error');
      setStatusMessage(
        err instanceof Error ? err.message : 'Failed to save server profile.'
      );
    } finally {
      setSavingProfile(false);
    }
  };

  const handleSelectProfile = (profile: SshProfile) => {
    setSelectedProfileId(profile.id);
    setLabel(profile.label);
    setHost(profile.host);
    setPort(String(profile.port || 22));
    setUsername(profile.username);
    setAuthType(profile.authType);
    setCommandInput(
      formatSshCommand({
        username: profile.username,
        host: profile.host,
        port: profile.port || 22,
      })
    );
    if (profile.authType === 'password') {
      window.requestAnimationFrame(() => passwordInputRef.current?.focus());
    }
  };

  const handleDeleteProfile = async (profileId: string) => {
    try {
      await deleteSshProfile(storageMode, currentUser.id, profileId);
      setProfiles((prev) => prev.filter((p) => p.id !== profileId));
      if (selectedProfileId === profileId) {
        setSelectedProfileId(null);
      }
    } catch {
      // ignore delete error
    }
  };

  const handlePrivateKeyFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setPrivateKey(reader.result);
      }
    };
    reader.readAsText(file);
  };

  const sendRawInput = (data: string) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'input', data }));
      termRef.current?.focus();
    }
  };

  const handleOpenDirectoryInTerminal = (dirPath: string) => {
    if (status !== 'connected' || !dirPath.trim()) return;
    sendRawInput(`cd ${quotePosixPath(dirPath.trim())} && ls -la\n`);
  };

  const handleConfirmInitialDirectory = async (
    targetDir: string,
    options?: { openFullScreen?: boolean }
  ) => {
    const requested = targetDir.trim() || '~';
    setOpenDirPromptBusy(true);
    setOpenDirPromptError(null);
    try {
      const { path: resolvedPath, entries, truncated } = await listRemoteDirAsync(requested);
      setCurrentRemotePath(resolvedPath);
      setPathInput(resolvedPath);
      setDirCache((prev) => ({ ...prev, [resolvedPath]: entries }));
      setTruncatedDirs((prev) => ({ ...prev, [resolvedPath]: truncated }));
      setDirBrowserOpen(true);
      setOpenDirPromptOpen(false);
      if (options?.openFullScreen) {
        setEditorFullScreen(true);
      }
      sendRawInput(`cd ${quotePosixPath(resolvedPath)} && pwd\n`);
      void refreshGitStatus(resolvedPath);
    } catch (err) {
      setOpenDirPromptError(
        err instanceof Error ? err.message : `Unable to open directory: ${requested}`
      );
    } finally {
      setOpenDirPromptBusy(false);
    }
  };

  const handleSaveRemoteFileToNote = (file: RemoteFilePreview, contentOverride?: string) => {
    const bodyContent = contentOverride !== undefined ? contentOverride : file.content;
    const ext = file.name.includes('.') ? file.name.split('.').pop()?.toLowerCase() || '' : '';
    const lang = /^[a-z0-9]+$/i.test(ext) ? ext : '';
    const content = `## ${file.name}\n\n- **Path**: \`${file.path}\`\n- **Size**: ${formatBytes(
      new Blob([bodyContent]).size
    )}${file.truncated && contentOverride === undefined ? ' (first 512 KB)' : ''}\n\n\`\`\`${lang}\n${bodyContent}\n\`\`\`\n`;
    onSaveTranscriptToNote(`${file.name} (${file.path})`, content, {
      folderId: targetFolderId || null,
      openAiAfterSave: false,
    });
    setCapturedNotice(true);
    window.setTimeout(() => setCapturedNotice(false), 1800);
  };

  const handleSaveTranscript = (openAiAfterSave = false) => {
    const term = termRef.current;
    if (!term) return;
    const buffer = term.buffer.active;
    const lines: string[] = [];
    const total = buffer.length;
    const start = Math.max(0, total - 1500);
    for (let i = start; i < total; i += 1) {
      const line = buffer.getLine(i);
      if (line) {
        lines.push(line.translateToString(true));
      }
    }
    while (lines.length > 0 && !lines[lines.length - 1].trim()) {
      lines.pop();
    }
    const transcript = lines.join('\n').trim();
    if (!transcript) return;

    const targetLabel =
      connectedTarget ||
      (host.trim() ? `${username.trim() || 'root'}@${host.trim()}` : 'Remote Server');
    onSaveTranscriptToNote(targetLabel, transcript, {
      folderId: targetFolderId || null,
      openAiAfterSave,
    });
    setCapturedNotice(true);
    window.setTimeout(() => setCapturedNotice(false), 1800);
  };

  const shellSnippets = useMemo(
    () =>
      snippets.filter((s) =>
        /bash|sh|shell|zsh|docker|sql|python|yaml|text/i.test(s.language || 'bash')
      ),
    [snippets]
  );

  const gitTreeStatuses = useMemo(() => {
    const map: Record<string, { letter: string; title: string; className: string }> = {};
    if (!gitStatus?.isRepo) return map;
    for (const change of gitStatus.changes) {
      map[change.fullPath] = getGitBadgeMeta(
        change,
        change.staged && !change.unstaged ? 'staged' : 'unstaged'
      );
    }
    return map;
  }, [gitStatus]);

  const isConnected = status === 'connected';
  const isConnecting = status === 'connecting';

  return (
    <div className="flex-1 flex flex-col min-w-0 bg-white dark:bg-[#121214]">
      {/* Top Bar */}
      <header className="h-[52px] shrink-0 px-4 sm:px-5 border-b border-neutral-200 dark:border-white/[0.07] flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          {!sidebarOpen && (
            <button
              type="button"
              onClick={onOpenSidebar}
              aria-label="Open sidebar"
              className="p-2 -ml-2 rounded-lg text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-white hover:bg-neutral-100 dark:hover:bg-white/[0.06] cursor-pointer shrink-0"
            >
              <PanelLeftOpen className="w-[18px] h-[18px]" />
            </button>
          )}

          <Terminal className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0" />
          <h1 className="text-[14.5px] font-semibold text-neutral-950 dark:text-white whitespace-nowrap">
            SSH Terminal
          </h1>

          <span className="text-neutral-300 dark:text-neutral-700 select-none hidden sm:inline">
            ·
          </span>

          <div className="hidden sm:flex items-center gap-2 min-w-0 text-[12.5px] text-neutral-500 dark:text-neutral-400">
            <span
              className={`w-2 h-2 rounded-full shrink-0 ${
                isConnected
                  ? 'bg-emerald-500'
                  : isConnecting
                  ? 'bg-amber-400 animate-pulse'
                  : status === 'error'
                  ? 'bg-red-500'
                  : 'bg-neutral-400 dark:bg-neutral-600'
              }`}
            />
            <span className="truncate">
              {connectedTarget ? `Connected to ${connectedTarget}` : statusMessage}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => setPanelOpen((prev) => !prev)}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-neutral-200 dark:border-white/10 text-[12.5px] font-medium text-neutral-700 dark:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-white/[0.06] transition-colors cursor-pointer whitespace-nowrap"
          >
            <Server className="w-3.5 h-3.5 text-neutral-400" />
            <span className="hidden sm:inline">{panelOpen ? 'Hide servers' : 'Servers'}</span>
          </button>

          {folders.length > 0 && (
            <div className="hidden xl:flex items-center gap-1.5 px-2 py-1 rounded-lg border border-neutral-200 dark:border-white/10 bg-neutral-50 dark:bg-white/[0.03]">
              <FolderOpen className="w-3.5 h-3.5 text-neutral-400 shrink-0" />
              <select
                value={targetFolderId}
                onChange={(e) => setTargetFolderId(e.target.value)}
                aria-label="Target project folder for saved output"
                title="Target project folder for saved output"
                className="bg-transparent text-[12px] font-medium text-neutral-700 dark:text-neutral-200 focus:outline-none cursor-pointer max-w-[130px]"
              >
                <option value="" className="bg-white dark:bg-[#17171c]">
                  Unfiled
                </option>
                {folders.map((folder) => (
                  <option key={folder.id} value={folder.id} className="bg-white dark:bg-[#17171c]">
                    {folder.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          <button
            type="button"
            onClick={() => handleSaveTranscript(false)}
            title="Save terminal output to a NoteCraft note"
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-neutral-200 dark:border-white/10 text-[12.5px] font-medium text-neutral-700 dark:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-white/[0.06] transition-colors cursor-pointer whitespace-nowrap"
          >
            {capturedNotice ? (
              <>
                <Check className="w-3.5 h-3.5 text-emerald-500" />
                <span>Saved</span>
              </>
            ) : (
              <>
                <FilePlus2 className="w-3.5 h-3.5 text-neutral-400" />
                <span className="hidden sm:inline">Save to note</span>
              </>
            )}
          </button>

          <button
            type="button"
            onClick={() => handleSaveTranscript(true)}
            title="Save terminal output to a note and open AI to explain the project structure and how it works"
            className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-blue-500/30 bg-blue-600/10 dark:bg-blue-500/15 text-[12.5px] font-medium text-blue-700 dark:text-blue-300 hover:bg-blue-600/15 dark:hover:bg-blue-500/25 transition-colors cursor-pointer whitespace-nowrap"
          >
            <Wand2 className="w-3.5 h-3.5" />
            <span>Save & Ask AI</span>
          </button>

          <button
            type="button"
            onClick={() => termRef.current?.clear()}
            title="Clear terminal screen"
            className="p-1.5 rounded-lg border border-neutral-200 dark:border-white/10 text-neutral-600 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-white/[0.06] transition-colors cursor-pointer"
          >
            <Eraser className="w-4 h-4" />
          </button>

          {isConnected || isConnecting ? (
            <button
              type="button"
              onClick={handleDisconnect}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-600 hover:bg-red-700 text-white text-[12.5px] font-medium transition-colors cursor-pointer whitespace-nowrap shrink-0"
            >
              <PlugZap className="w-3.5 h-3.5" />
              <span>Disconnect</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={() => handleConnect()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-[12.5px] font-medium transition-colors cursor-pointer whitespace-nowrap shrink-0"
            >
              <Plug className="w-3.5 h-3.5" />
              <span>Connect</span>
            </button>
          )}
        </div>
      </header>

      {/* Main Split Workspace: Connection Panel + Interactive Terminal */}
      <div className="flex-1 min-h-0 flex flex-col lg:flex-row overflow-hidden">
        {panelOpen && (
          <aside className="w-full lg:w-[340px] shrink-0 border-b lg:border-b-0 lg:border-r border-neutral-200 dark:border-white/[0.07] bg-neutral-50/70 dark:bg-[#141418] overflow-y-auto p-4 space-y-4">
            {/* Quick SSH Command Parser */}
            <form onSubmit={handleConnect} className="space-y-3">
              <div className="space-y-1">
                <label
                  htmlFor="ssh-command-input"
                  className="block text-[12px] font-medium text-neutral-700 dark:text-neutral-300"
                >
                  SSH Command
                </label>
                <input
                  id="ssh-command-input"
                  type="text"
                  value={commandInput}
                  onChange={(e) => handleCommandInputChange(e.target.value)}
                  placeholder="ssh root@192.168.1.50 -p 22"
                  className="font-mono-code w-full px-3 py-2 text-[12.5px] rounded-lg border border-neutral-300 dark:border-white/12 bg-white dark:bg-[#0e0e11] text-neutral-950 dark:text-white placeholder:text-neutral-400 focus:outline-none focus:border-blue-500"
                />
                <p className="text-[11px] text-neutral-500 dark:text-neutral-400">
                  Paste any <code className="font-mono-code">ssh user@host -p port</code> command to auto-fill below.
                </p>
              </div>

              {/* Host + Port */}
              <div className="grid grid-cols-[1fr_78px] gap-2">
                <div className="space-y-1">
                  <label
                    htmlFor="ssh-host-input"
                    className="block text-[12px] font-medium text-neutral-700 dark:text-neutral-300"
                  >
                    Host / IP
                  </label>
                  <input
                    id="ssh-host-input"
                    type="text"
                    value={host}
                    onChange={(e) => {
                      setHost(e.target.value);
                      syncCommandPreview(username, e.target.value, port);
                    }}
                    placeholder="server.example.com"
                    className="w-full px-3 py-1.5 text-[13px] rounded-lg border border-neutral-300 dark:border-white/12 bg-white dark:bg-[#0e0e11] text-neutral-950 dark:text-white placeholder:text-neutral-400 focus:outline-none focus:border-blue-500"
                  />
                </div>

                <div className="space-y-1">
                  <label
                    htmlFor="ssh-port-input"
                    className="block text-[12px] font-medium text-neutral-700 dark:text-neutral-300"
                  >
                    Port
                  </label>
                  <input
                    id="ssh-port-input"
                    type="number"
                    min={1}
                    max={65535}
                    value={port}
                    onChange={(e) => {
                      setPort(e.target.value);
                      syncCommandPreview(username, host, e.target.value);
                    }}
                    placeholder="22"
                    className="w-full px-2.5 py-1.5 text-[13px] tabular-nums rounded-lg border border-neutral-300 dark:border-white/12 bg-white dark:bg-[#0e0e11] text-neutral-950 dark:text-white placeholder:text-neutral-400 focus:outline-none focus:border-blue-500"
                  />
                </div>
              </div>

              {/* Username + Label */}
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <label
                    htmlFor="ssh-user-input"
                    className="block text-[12px] font-medium text-neutral-700 dark:text-neutral-300"
                  >
                    Username
                  </label>
                  <input
                    id="ssh-user-input"
                    type="text"
                    value={username}
                    onChange={(e) => {
                      setUsername(e.target.value);
                      syncCommandPreview(e.target.value, host, port);
                    }}
                    placeholder="root"
                    className="w-full px-3 py-1.5 text-[13px] rounded-lg border border-neutral-300 dark:border-white/12 bg-white dark:bg-[#0e0e11] text-neutral-950 dark:text-white placeholder:text-neutral-400 focus:outline-none focus:border-blue-500"
                  />
                </div>

                <div className="space-y-1">
                  <label
                    htmlFor="ssh-label-input"
                    className="block text-[12px] font-medium text-neutral-700 dark:text-neutral-300"
                  >
                    Server Name
                  </label>
                  <input
                    id="ssh-label-input"
                    type="text"
                    value={label}
                    onChange={(e) => setLabel(e.target.value)}
                    placeholder="Production Web"
                    className="w-full px-3 py-1.5 text-[13px] rounded-lg border border-neutral-300 dark:border-white/12 bg-white dark:bg-[#0e0e11] text-neutral-950 dark:text-white placeholder:text-neutral-400 focus:outline-none focus:border-blue-500"
                  />
                </div>
              </div>

              {/* Auth Mode Toggle */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[12px] font-medium text-neutral-700 dark:text-neutral-300">
                    Authentication
                  </span>
                  <div className="inline-flex rounded-lg bg-neutral-200/70 dark:bg-white/[0.06] p-0.5">
                    <button
                      type="button"
                      onClick={() => setAuthType('password')}
                      className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11.5px] font-medium transition-colors cursor-pointer whitespace-nowrap ${
                        authType === 'password'
                          ? 'bg-white dark:bg-[#24242b] text-neutral-950 dark:text-white shadow-xs'
                          : 'text-neutral-600 dark:text-neutral-400'
                      }`}
                    >
                      <Lock className="w-3 h-3" />
                      <span>Password</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setAuthType('privateKey')}
                      className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11.5px] font-medium transition-colors cursor-pointer whitespace-nowrap ${
                        authType === 'privateKey'
                          ? 'bg-white dark:bg-[#24242b] text-neutral-950 dark:text-white shadow-xs'
                          : 'text-neutral-600 dark:text-neutral-400'
                      }`}
                    >
                      <KeyRound className="w-3 h-3" />
                      <span>Private Key</span>
                    </button>
                  </div>
                </div>

                {authType === 'password' ? (
                  <div className="relative">
                    <input
                      ref={passwordInputRef}
                      type={showPassword ? 'text' : 'password'}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="SSH password"
                      autoComplete="off"
                      className="w-full pl-3 pr-9 py-1.5 text-[13px] rounded-lg border border-neutral-300 dark:border-white/12 bg-white dark:bg-[#0e0e11] text-neutral-950 dark:text-white placeholder:text-neutral-400 focus:outline-none focus:border-blue-500"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((p) => !p)}
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                      className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200 cursor-pointer"
                    >
                      {showPassword ? (
                        <EyeOff className="w-3.5 h-3.5" />
                      ) : (
                        <Eye className="w-3.5 h-3.5" />
                      )}
                    </button>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[11px] text-neutral-500 dark:text-neutral-400">
                        OpenSSH / PEM private key
                      </span>
                      <input
                        ref={keyFileInputRef}
                        type="file"
                        accept=".pem,.key,.ppk,text/plain"
                        className="hidden"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) handlePrivateKeyFile(file);
                          e.target.value = '';
                        }}
                      />
                      <button
                        type="button"
                        onClick={() => keyFileInputRef.current?.click()}
                        className="inline-flex items-center gap-1 text-[11.5px] font-medium text-blue-600 dark:text-blue-400 hover:underline cursor-pointer"
                      >
                        <Upload className="w-3 h-3" />
                        <span>Load key file</span>
                      </button>
                    </div>
                    <textarea
                      rows={3}
                      value={privateKey}
                      onChange={(e) => setPrivateKey(e.target.value)}
                      placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"
                      className="font-mono-code w-full px-2.5 py-2 text-[11.5px] rounded-lg border border-neutral-300 dark:border-white/12 bg-white dark:bg-[#0e0e11] text-neutral-950 dark:text-white placeholder:text-neutral-400 focus:outline-none focus:border-blue-500 resize-y"
                    />
                    <input
                      type="password"
                      value={passphrase}
                      onChange={(e) => setPassphrase(e.target.value)}
                      placeholder="Key passphrase (optional)"
                      autoComplete="off"
                      className="w-full px-3 py-1.5 text-[12.5px] rounded-lg border border-neutral-300 dark:border-white/12 bg-white dark:bg-[#0e0e11] text-neutral-950 dark:text-white placeholder:text-neutral-400 focus:outline-none focus:border-blue-500"
                    />
                  </div>
                )}
              </div>

              {status === 'error' && statusMessage && (
                <div
                  role="alert"
                  className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-[12px] text-red-700 dark:text-red-300 flex items-start gap-2"
                >
                  <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                  <span>{statusMessage}</span>
                </div>
              )}

              <div className="flex items-center gap-2 pt-0.5">
                <button
                  type="submit"
                  disabled={isConnecting}
                  className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-[13px] font-medium transition-colors cursor-pointer whitespace-nowrap"
                >
                  {isConnecting ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>Connecting...</span>
                    </>
                  ) : (
                    <>
                      <Plug className="w-3.5 h-3.5" />
                      <span>{isConnected ? 'Reconnect' : 'Connect SSH'}</span>
                    </>
                  )}
                </button>

                <button
                  type="button"
                  disabled={savingProfile}
                  onClick={handleSaveProfile}
                  title="Save server host & username (credentials are never stored)"
                  className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border border-neutral-200 dark:border-white/12 bg-white dark:bg-white/[0.04] hover:bg-neutral-100 dark:hover:bg-white/[0.08] text-[12.5px] font-medium text-neutral-700 dark:text-neutral-200 transition-colors cursor-pointer whitespace-nowrap shrink-0"
                >
                  {savedNotice ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-emerald-500" />
                      <span>Saved</span>
                    </>
                  ) : (
                    <>
                      <BookmarkPlus className="w-3.5 h-3.5" />
                      <span>Save</span>
                    </>
                  )}
                </button>
              </div>
            </form>

            {/* Saved Servers List */}
            <div className="pt-4 border-t border-neutral-200 dark:border-white/[0.08] space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[12px] font-medium text-neutral-500 dark:text-neutral-400">
                  Saved servers
                </span>
                <span className="text-[11.5px] text-neutral-400 tabular-nums">
                  {profiles.length}
                </span>
              </div>

              {loadingProfiles ? (
                <div className="py-3 text-[12px] text-neutral-500">Loading servers...</div>
              ) : profiles.length === 0 ? (
                <p className="text-[12px] text-neutral-500 dark:text-neutral-500 py-1">
                  No saved servers yet. Save a host above for quick access.
                </p>
              ) : (
                <div className="space-y-1">
                  {profiles.map((profile) => {
                    const active = selectedProfileId === profile.id;
                    return (
                      <div
                        key={profile.id}
                        className={`group flex items-center justify-between gap-2 px-2.5 py-2 rounded-lg border transition-colors ${
                          active
                            ? 'border-blue-500/50 bg-blue-500/[0.07]'
                            : 'border-transparent hover:border-neutral-200 dark:hover:border-white/[0.08] hover:bg-white dark:hover:bg-white/[0.03]'
                        }`}
                      >
                        <button
                          type="button"
                          onClick={() => handleSelectProfile(profile)}
                          className="flex-1 min-w-0 text-left cursor-pointer"
                        >
                          <div className="flex items-center gap-1.5 min-w-0">
                            <Server className="w-3.5 h-3.5 text-neutral-400 shrink-0" />
                            <span className="text-[12.5px] font-medium text-neutral-900 dark:text-neutral-100 truncate">
                              {profile.label}
                            </span>
                          </div>
                          <div className="pl-5 text-[11px] font-mono-code text-neutral-500 dark:text-neutral-400 truncate">
                            {profile.username}@{profile.host}:{profile.port}
                            {profile.lastConnectedAt
                              ? ` · ${formatRelativeDate(profile.lastConnectedAt)}`
                              : ''}
                          </div>
                        </button>

                        <button
                          type="button"
                          onClick={() => handleDeleteProfile(profile.id)}
                          title="Remove saved server"
                          aria-label={`Remove ${profile.label}`}
                          className="p-1 rounded text-neutral-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer shrink-0"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </aside>
        )}

        {/* Right: Interactive Terminal Area */}
        <div className="flex-1 min-w-0 min-h-0 flex flex-col bg-[#0c0c0f]">


          {clipboardNotice && (
            <div className="shrink-0 px-3 sm:px-4 py-1.5 border-b border-amber-500/20 bg-amber-500/10 text-[11.5px] text-amber-200 flex items-center justify-between gap-2">
              <span>{clipboardNotice}</span>
              <button
                type="button"
                onClick={() => setClipboardNotice(null)}
                className="text-amber-300 hover:text-white cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {/* Terminal + Optional Project Directory Split */}
          <div className="flex-1 min-h-0 flex flex-col lg:flex-row overflow-hidden">
            {/* xterm.js Canvas with right-click Copy/Paste context menu */}
            <div
              className="flex-1 min-w-0 min-h-0 p-3 relative"
              onContextMenu={(e) => {
                e.preventDefault();
                setContextMenu({ x: e.clientX, y: e.clientY });
              }}
            >
              <div ref={terminalContainerRef} className="w-full h-full" />

              {/* Initial Remote Directory Prompt on First Connect */}
              {isConnected && openDirPromptOpen && (
                <div className="absolute inset-0 z-30 bg-black/75 backdrop-blur-xs flex items-center justify-center p-4">
                  <div className="w-full max-w-lg rounded-2xl border border-white/12 bg-[#14141b] shadow-2xl p-5 space-y-4 text-neutral-100">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-2.5">
                        <div className="w-9 h-9 rounded-xl bg-blue-500/15 border border-blue-500/30 flex items-center justify-center shrink-0">
                          <FolderOpen className="w-4.5 h-4.5 text-blue-400" />
                        </div>
                        <div>
                          <h2 className="text-[15px] font-semibold text-white">
                            Open Remote Directory
                          </h2>
                          <p className="text-[12px] text-neutral-400">
                            Connected to{' '}
                            <span className="font-mono-code text-neutral-200">
                              {connectedTarget}
                            </span>
                            . Choose your project directory to start the terminal there.
                          </p>
                        </div>
                      </div>
                    </div>

                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        void handleConfirmInitialDirectory(openDirPromptInput);
                      }}
                      className="space-y-3"
                    >
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between text-[11.5px] text-neutral-400">
                          <span>Remote project path</span>
                          <span className="font-mono-code text-[10.5px] text-neutral-500">
                            Press Tab to autocomplete folders
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <RemotePathInput
                            value={openDirPromptInput}
                            onChange={setOpenDirPromptInput}
                            onSyncDirectory={(dirPath) => {
                              setOpenDirPromptInput(dirPath);
                            }}
                            dirCache={dirCache}
                            fetchDirEntries={listRemoteDirAsync}
                            currentRemotePath={currentRemotePath || '~'}
                            placeholder="/home/user/project"
                            ariaLabel="Initial remote directory path"
                            inputClassName="font-mono-code w-full min-w-0 px-3 py-2 text-[13px] rounded-lg border border-white/15 bg-[#0c0c10] text-white placeholder:text-neutral-500 focus:outline-none focus:border-blue-500"
                          />
                        </div>
                      </div>

                      {homeQuickDirs.length > 0 && (
                        <div className="space-y-1.5">
                          <span className="block text-[11px] text-neutral-500">
                            Quick folders in home:
                          </span>
                          <div className="flex flex-wrap gap-1.5">
                            {homeQuickDirs.map((entry) => (
                              <button
                                key={entry.path}
                                type="button"
                                onClick={() => setOpenDirPromptInput(entry.path)}
                                onDoubleClick={() =>
                                  void handleConfirmInitialDirectory(entry.path)
                                }
                                className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-md border text-[11.5px] font-mono-code transition-colors cursor-pointer ${
                                  openDirPromptInput === entry.path
                                    ? 'border-blue-500/60 bg-blue-500/20 text-blue-200'
                                    : 'border-white/10 bg-white/[0.04] hover:bg-white/[0.09] text-neutral-200'
                                }`}
                              >
                                <FolderOpen className="w-3 h-3 text-blue-400" />
                                <span>{entry.name}</span>
                              </button>
                            ))}
                          </div>
                        </div>
                      )}

                      {openDirPromptError && (
                        <div className="rounded-lg border border-red-500/35 bg-red-500/10 px-3 py-2 text-[12px] text-red-300 flex items-start gap-2">
                          <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                          <span>{openDirPromptError}</span>
                        </div>
                      )}

                      <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                        <button
                          type="button"
                          onClick={() => {
                            setOpenDirPromptOpen(false);
                            termRef.current?.focus();
                          }}
                          className="px-2.5 py-1.5 rounded-lg text-[12px] text-neutral-400 hover:text-white cursor-pointer"
                        >
                          Skip (stay in ~)
                        </button>

                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            disabled={openDirPromptBusy}
                            onClick={() =>
                              void handleConfirmInitialDirectory(openDirPromptInput, {
                                openFullScreen: true,
                              })
                            }
                            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-white/15 bg-white/[0.05] hover:bg-white/[0.1] disabled:opacity-45 text-[12px] font-medium text-neutral-100 cursor-pointer"
                          >
                            <Maximize2 className="w-3.5 h-3.5 text-blue-400" />
                            <span>Open Full Screen</span>
                          </button>

                          <button
                            type="submit"
                            disabled={openDirPromptBusy}
                            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-[12.5px] font-medium cursor-pointer"
                          >
                            {openDirPromptBusy ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                              <Terminal className="w-3.5 h-3.5" />
                            )}
                            <span>Open & Start Terminal</span>
                          </button>
                        </div>
                      </div>
                    </form>
                  </div>
                </div>
              )}

              {contextMenu && (
                <div
                  ref={contextMenuRef}
                  style={{
                    position: 'fixed',
                    left: `${Math.min(contextMenu.x, window.innerWidth - 190)}px`,
                    top: `${Math.min(contextMenu.y, window.innerHeight - 170)}px`,
                  }}
                  className="z-50 w-44 rounded-lg border border-white/15 bg-[#1b1b22] shadow-2xl py-1 text-[12px] text-neutral-100"
                >
                  <button
                    type="button"
                    disabled={!hasSelection}
                    onClick={() => {
                      setContextMenu(null);
                      void handleCopySelection();
                    }}
                    className="w-full px-3 py-1.5 flex items-center justify-between gap-2 hover:bg-white/10 disabled:opacity-35 cursor-pointer text-left"
                  >
                    <span className="flex items-center gap-2">
                      <Copy className="w-3.5 h-3.5 text-neutral-400" />
                      <span>Copy</span>
                    </span>
                    <span className="text-[10.5px] text-neutral-500 font-mono-code">Ctrl+C</span>
                  </button>

                  <button
                    type="button"
                    disabled={!isConnected}
                    onClick={() => {
                      setContextMenu(null);
                      void handlePasteToTerminal();
                    }}
                    className="w-full px-3 py-1.5 flex items-center justify-between gap-2 hover:bg-white/10 disabled:opacity-35 cursor-pointer text-left"
                  >
                    <span className="flex items-center gap-2">
                      <ClipboardPaste className="w-3.5 h-3.5 text-neutral-400" />
                      <span>Paste</span>
                    </span>
                    <span className="text-[10.5px] text-neutral-500 font-mono-code">Ctrl+V</span>
                  </button>

                  <div className="my-1 border-t border-white/10" />

                  <button
                    type="button"
                    onClick={() => {
                      setContextMenu(null);
                      termRef.current?.selectAll();
                      setHasSelection(Boolean(termRef.current?.hasSelection()));
                    }}
                    className="w-full px-3 py-1.5 hover:bg-white/10 cursor-pointer text-left"
                  >
                    Select All
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setContextMenu(null);
                      termRef.current?.clear();
                    }}
                    className="w-full px-3 py-1.5 hover:bg-white/10 cursor-pointer text-left"
                  >
                    Clear Terminal
                  </button>
                </div>
              )}
            </div>

            {/* Remote Project Directory Browser */}
            {dirBrowserOpen && isConnected && (
              <>
                <div
                  role="separator"
                  aria-orientation="vertical"
                  aria-label="Resize project directory drawer"
                  title="Drag to resize project directory (double-click to reset)"
                  onMouseDown={handleStartResizeDirDrawer}
                  onDoubleClick={() => {
                    setDirDrawerWidth(340);
                    try {
                      window.localStorage.setItem('notecraft.ssh.dirDrawerWidth.v1', '340');
                    } catch {
                      // ignore
                    }
                  }}
                  className={`hidden lg:flex w-1.5 shrink-0 border-l border-white/[0.08] cursor-col-resize items-center justify-center transition-colors group ${
                    resizingDirDrawer ? 'bg-blue-500/50' : 'hover:bg-blue-500/35'
                  }`}
                >
                  <span className="w-px h-8 rounded-full bg-white/15 group-hover:bg-blue-300/80" />
                </div>

                <aside
                  style={isDesktopLg ? { width: `${dirDrawerWidth}px` } : undefined}
                  className="w-full h-[270px] lg:h-auto shrink-0 border-t lg:border-t-0 bg-[#141418] flex flex-col min-h-0"
                >
                <div className="shrink-0 px-3 py-2 border-b border-white/[0.08] flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <FolderOpen className="w-3.5 h-3.5 text-blue-400 shrink-0" />
                    <span className="text-[12.5px] font-semibold text-white truncate">
                      Project Directory
                    </span>
                  </div>
                  <div className="flex items-center gap-0.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => {
                        if (!currentRemotePath) return;
                        setCreatingInDir((prev) =>
                          prev === currentRemotePath ? null : currentRemotePath
                        );
                      }}
                      disabled={!currentRemotePath || Boolean(previewFile)}
                      title="New file in root directory"
                      className="p-1 rounded text-neutral-400 hover:text-white hover:bg-white/10 disabled:opacity-35 cursor-pointer"
                    >
                      <Plus className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={handleCollapseAllDirs}
                      disabled={!currentRemotePath || Boolean(previewFile)}
                      title="Collapse all expanded folders"
                      className="p-1 rounded text-neutral-400 hover:text-white hover:bg-white/10 disabled:opacity-35 cursor-pointer"
                    >
                      <ChevronsDownUp className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={handleRefreshExplorer}
                      disabled={Boolean(loadingDirs[currentRemotePath || '__root__'])}
                      title="Refresh project tree"
                      className="p-1 rounded text-neutral-400 hover:text-white hover:bg-white/10 cursor-pointer"
                    >
                      <RefreshCw
                        className={`w-3.5 h-3.5 ${
                          loadingDirs[currentRemotePath || '__root__'] ? 'animate-spin' : ''
                        }`}
                      />
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setRequestedIdeTab({ tab: 'git', seq: Date.now() });
                        setEditorFullScreen(true);
                        void refreshGitStatus();
                      }}
                      disabled={!currentRemotePath}
                      title="Open Source Control (Git) in Full Screen"
                      className="inline-flex items-center gap-1 px-1.5 py-1 rounded text-neutral-200 hover:text-white hover:bg-white/10 disabled:opacity-35 cursor-pointer text-[11px] font-medium"
                    >
                      <GitBranch className="w-3.5 h-3.5 text-blue-400" />
                      {gitStatus?.isRepo && gitStatus.changes.length > 0 && (
                        <span className="px-1 rounded-full bg-blue-600/40 text-blue-200 text-[10px] tabular-nums">
                          {gitStatus.changes.length}
                        </span>
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setRequestedIdeTab({ tab: 'explorer', seq: Date.now() });
                        setEditorFullScreen(true);
                      }}
                      disabled={!currentRemotePath}
                      title="Open project explorer & editor in Full Screen"
                      className="p-1 rounded text-blue-300 hover:text-white hover:bg-blue-500/20 disabled:opacity-35 cursor-pointer"
                    >
                      <Maximize2 className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setEditorFullScreen(false);
                        setDirBrowserOpen(false);
                      }}
                      title="Close directory browser"
                      className="p-1 rounded text-neutral-400 hover:text-white hover:bg-white/10 cursor-pointer"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {/* Path navigation bar */}
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    requestListDir(pathInput, { mode: 'root', openFullScreen: true });
                  }}
                  className="shrink-0 p-2.5 border-b border-white/[0.08] space-y-2"
                >
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() =>
                        requestListDir(getParentPosixPath(currentRemotePath || '/'), {
                          mode: 'root',
                        })
                      }
                      disabled={
                        Boolean(loadingDirs[currentRemotePath || '__root__']) ||
                        currentRemotePath === '/'
                      }
                      title="Parent directory"
                      className="p-1.5 rounded-md border border-white/10 text-neutral-300 hover:bg-white/10 disabled:opacity-35 cursor-pointer shrink-0"
                    >
                      <ArrowUp className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => requestListDir('~', { mode: 'root' })}
                      disabled={Boolean(loadingDirs[currentRemotePath || '__root__'])}
                      title="Home directory (~)"
                      className="p-1.5 rounded-md border border-white/10 text-neutral-300 hover:bg-white/10 disabled:opacity-35 cursor-pointer shrink-0"
                    >
                      <Home className="w-3.5 h-3.5" />
                    </button>
                    <RemotePathInput
                      value={pathInput}
                      onChange={setPathInput}
                      onSyncDirectory={(dirPath) =>
                        requestListDir(dirPath, { mode: 'root', keepPreview: true })
                      }
                      dirCache={dirCache}
                      fetchDirEntries={listRemoteDirAsync}
                      currentRemotePath={currentRemotePath}
                      placeholder="/var/www/project"
                      ariaLabel="Remote project directory path"
                      inputClassName="font-mono-code w-full min-w-0 px-2.5 py-1 text-[12px] rounded-md border border-white/12 bg-[#0c0c0f] text-neutral-100 placeholder:text-neutral-500 focus:outline-none focus:border-blue-500"
                    />
                    <button
                      type="submit"
                      disabled={Boolean(loadingDirs[currentRemotePath || '__root__'])}
                      className="px-2.5 py-1 rounded-md bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-[11.5px] font-medium cursor-pointer whitespace-nowrap shrink-0"
                    >
                      Open
                    </button>
                  </div>

                  {currentRemotePath && (
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => handleOpenDirectoryInTerminal(currentRemotePath)}
                        title="Switch terminal working directory to this folder"
                        className="flex-1 inline-flex items-center justify-center gap-1.5 px-2.5 py-1 rounded-md bg-white/10 hover:bg-white/15 text-[11.5px] font-medium text-neutral-100 transition-colors cursor-pointer whitespace-nowrap"
                      >
                        <Terminal className="w-3 h-3 text-blue-400" />
                        <span>Open in Terminal</span>
                      </button>
                    </div>
                  )}
                </form>

                {dirError && (
                  <div className="m-2.5 rounded-lg border border-red-500/30 bg-red-500/10 px-2.5 py-2 text-[11.5px] text-red-300 flex items-start gap-2">
                    <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                    <span>{dirError}</span>
                  </div>
                )}

                {/* Remote Source Code Editor (Inline or Full-Screen) OR Collapsible Project Tree */}
                {previewFile || editorFullScreen ? (
                  <RemoteCodeEditor
                    file={previewFile}
                    fullScreen={editorFullScreen}
                    saving={savingFile}
                    saveError={saveFileError}
                    dirError={dirError}
                    fileLoading={fileLoading}
                    lastSavedAt={lastSavedAt}
                    currentRemotePath={currentRemotePath}
                    dirCache={dirCache}
                    expandedDirs={expandedDirs}
                    loadingDirs={loadingDirs}
                    truncatedDirs={truncatedDirs}
                    onToggleFullScreen={setEditorFullScreen}
                    onCloseFile={() => {
                      setEditorFullScreen(false);
                      setPreviewFile(null);
                      setSaveFileError(null);
                    }}
                    onSaveFile={(filePath, nextContent) => requestWriteFile(filePath, nextContent)}
                    onSaveAsFile={(targetPath, nextContent) =>
                      requestWriteFile(targetPath, nextContent, true)
                    }
                    onReloadFile={(filePath) => requestReadFile(filePath)}
                    onToggleDir={handleToggleTreeDir}
                    onNavigateRootDir={(dirPath) =>
                      requestListDir(dirPath, { mode: 'root', keepPreview: true })
                    }
                    onCollapseAllDirs={handleCollapseAllDirs}
                    onRefreshExplorer={handleRefreshExplorer}
                    onOpenInTerminal={handleOpenDirectoryInTerminal}
                    onOpenFile={(filePath) => requestReadFile(filePath)}
                    onCreateNewFile={handleCreateNewRemoteFile}
                    fetchDirEntries={listRemoteDirAsync}
                    onReadRemoteFile={readRemoteFileAsync}
                    onWriteRemoteFile={writeRemoteFileAsync}
                    onCreateRemoteDir={createRemoteDirAsync}
                    gitStatus={gitStatus}
                    gitLoading={gitLoading}
                    gitError={gitError}
                    onRefreshGit={() => refreshGitStatus()}
                    onRunGit={runGitCommandAsync}
                    requestedSidebarTab={requestedIdeTab}
                    onCopyText={copyTextToClipboard}
                    onSaveToNote={handleSaveRemoteFileToNote}
                  />
                ) : (
                  <div className="flex-1 min-h-0 overflow-y-auto px-1.5 py-1.5">
                    {fileLoading && (
                      <div className="flex items-center gap-2 px-2 py-1.5 text-[12px] text-neutral-400">
                        <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-400" />
                        <span>Opening file...</span>
                      </div>
                    )}

                    <ProjectTreeView
                      rootPath={currentRemotePath}
                      dirCache={dirCache}
                      expandedDirs={expandedDirs}
                      loadingDirs={loadingDirs}
                      truncatedDirs={truncatedDirs}
                      selectedFilePath={null}
                      gitFileStatuses={gitTreeStatuses}
                      creatingInDir={creatingInDir}
                      onToggleDir={handleToggleTreeDir}
                      onSelectFile={(filePath) => requestReadFile(filePath)}
                      onOpenFileFullScreen={(filePath) =>
                        requestReadFile(filePath, { openFullScreen: true })
                      }
                      onOpenInTerminal={handleOpenDirectoryInTerminal}
                      onRequestCreateFile={(dirPath) => {
                        if (!expandedDirs[dirPath]) {
                          handleToggleTreeDir(dirPath);
                        }
                        setCreatingInDir(dirPath);
                      }}
                      onSubmitNewFile={(targetDir, cleanName) => {
                        setCreatingInDir(null);
                        handleCreateNewRemoteFile(`${targetDir.replace(/\/+$/, '')}/${cleanName}`);
                      }}
                      onCancelNewFile={() => setCreatingInDir(null)}
                      showFileSize
                    />
                  </div>
                )}
              </aside>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
