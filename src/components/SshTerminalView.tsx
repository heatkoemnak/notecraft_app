import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FitAddon } from '@xterm/addon-fit';
import { Terminal as XTerm } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import {
  AlertCircle,
  ArrowLeft,
  ArrowUp,
  BookmarkPlus,
  Braces,
  Check,
  ChevronDown,
  ChevronRight,
  ClipboardPaste,
  Copy,
  Eraser,
  Eye,
  EyeOff,
  FilePlus2,
  FileText,
  Folder as FolderIcon,
  FolderOpen,
  FolderTree,
  Home,
  KeyRound,
  Loader2,
  Lock,
  PanelLeftOpen,
  Plug,
  PlugZap,
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

interface RemoteDirEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  size: number;
  modifiedAt: number | null;
}

interface RemoteFilePreview {
  path: string;
  name: string;
  content: string;
  size: number;
  truncated: boolean;
  isBinary: boolean;
}

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
  const [port, setPort] = useState<string>('22');
  const [username, setUsername] = useState('root');
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
  const [snippetPickerOpen, setSnippetPickerOpen] = useState(false);
  const [quickCommand, setQuickCommand] = useState('');

  // Clipboard & terminal context menu state
  const [hasSelection, setHasSelection] = useState(false);
  const [copiedSelectionNotice, setCopiedSelectionNotice] = useState(false);
  const [clipboardNotice, setClipboardNotice] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);

  // Remote Project Directory browser state
  const [dirBrowserOpen, setDirBrowserOpen] = useState(false);
  const [currentRemotePath, setCurrentRemotePath] = useState('');
  const [pathInput, setPathInput] = useState('');
  const [dirEntries, setDirEntries] = useState<RemoteDirEntry[]>([]);
  const [dirLoading, setDirLoading] = useState(false);
  const [dirError, setDirError] = useState<string | null>(null);
  const [dirTruncated, setDirTruncated] = useState(false);
  const [previewFile, setPreviewFile] = useState<RemoteFilePreview | null>(null);
  const [fileLoading, setFileLoading] = useState(false);

  const terminalContainerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<XTerm | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const keyFileInputRef = useRef<HTMLInputElement>(null);
  const passwordInputRef = useRef<HTMLInputElement>(null);
  const snippetMenuRef = useRef<HTMLDivElement>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const dirReqIdRef = useRef<string>('');
  const fileReqIdRef = useRef<string>('');
  const selectedProfileIdRef = useRef<string | null>(null);
  selectedProfileIdRef.current = selectedProfileId;
  const profilesRef = useRef<SshProfile[]>(profiles);
  profilesRef.current = profiles;
  const isActiveRef = useRef<boolean>(isActive);
  isActiveRef.current = isActive;
  const copySelectionRef = useRef<() => Promise<boolean>>(async () => false);
  const pasteClipboardRef = useRef<() => Promise<void>>(async () => {});

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

  // Close snippet dropdown and terminal context menu on outside click
  useEffect(() => {
    if (!snippetPickerOpen && !contextMenu) return;
    const handlePointerDown = (e: PointerEvent) => {
      if (
        snippetPickerOpen &&
        snippetMenuRef.current &&
        !snippetMenuRef.current.contains(e.target as Node)
      ) {
        setSnippetPickerOpen(false);
      }
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
        setSnippetPickerOpen(false);
      }
    };
    window.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('keydown', handleKey);
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('keydown', handleKey);
    };
  }, [snippetPickerOpen, contextMenu]);

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
  }, [isActive, panelOpen, sidebarOpen, dirBrowserOpen, status]);

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
    }
  };

  const closeSocket = useCallback((sendDisconnectMsg = true) => {
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
  }, []);

  const handleDisconnect = () => {
    closeSocket(true);
    setStatus('disconnected');
    setStatusMessage('Disconnected');
    setConnectedTarget(null);
    setDirBrowserOpen(false);
    setCurrentRemotePath('');
    setPathInput('');
    setDirEntries([]);
    setPreviewFile(null);
    setDirError(null);
  };

  const requestListDir = useCallback((targetPath?: string) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const reqId = `dir-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    dirReqIdRef.current = reqId;
    setDirLoading(true);
    setDirError(null);
    setPreviewFile(null);
    ws.send(
      JSON.stringify({
        type: 'listDir',
        requestId: reqId,
        path: targetPath ?? '',
      })
    );
  }, []);

  const requestReadFile = useCallback((filePath: string) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const reqId = `file-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    fileReqIdRef.current = reqId;
    setFileLoading(true);
    setDirError(null);
    ws.send(
      JSON.stringify({
        type: 'readFile',
        requestId: reqId,
        path: filePath,
      })
    );
  }, []);

  const handleToggleDirBrowser = () => {
    if (status !== 'connected') return;
    const nextOpen = !dirBrowserOpen;
    setDirBrowserOpen(nextOpen);
    if (nextOpen && !currentRemotePath && dirEntries.length === 0) {
      requestListDir('');
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
    setDirEntries([]);
    setPreviewFile(null);
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
        if (msg.requestId && msg.requestId !== dirReqIdRef.current) return;
        setDirLoading(false);
        setDirError(null);
        setCurrentRemotePath(msg.path || '/');
        setPathInput(msg.path || '/');
        setDirEntries(Array.isArray(msg.entries) ? msg.entries : []);
        setDirTruncated(Boolean(msg.truncated));
        return;
      }

      if (msg.type === 'dirError') {
        if (msg.requestId && msg.requestId !== dirReqIdRef.current) return;
        setDirLoading(false);
        setDirError(msg.error || 'Unable to list remote directory.');
        return;
      }

      if (msg.type === 'fileContent') {
        if (msg.requestId && msg.requestId !== fileReqIdRef.current) return;
        setFileLoading(false);
        setPreviewFile({
          path: msg.path || '',
          name: msg.name || 'file',
          content: msg.content || '',
          size: Number(msg.size || 0),
          truncated: Boolean(msg.truncated),
          isBinary: Boolean(msg.isBinary),
        });
        return;
      }

      if (msg.type === 'fileError') {
        if (msg.requestId && msg.requestId !== fileReqIdRef.current) return;
        setFileLoading(false);
        setDirError(msg.error || 'Unable to read remote file.');
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
          termRef.current?.focus();

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
          setConnectedTarget(null);
          if (msg.message) {
            termRef.current?.writeln(`\x1b[31m✖ ${msg.message}\x1b[0m`);
          }
        } else if (msg.status === 'disconnected') {
          setConnectedTarget(null);
          setDirBrowserOpen(false);
          if (msg.message) {
            termRef.current?.writeln(`\r\n\x1b[90m[${msg.message}]\x1b[0m`);
          }
        }
      }
    };

    ws.onerror = () => {
      if (wsRef.current !== ws) return;
      setStatus('error');
      setStatusMessage('WebSocket connection to SSH gateway failed.');
      setConnectedTarget(null);
    };

    ws.onclose = () => {
      if (wsRef.current !== ws) return;
      wsRef.current = null;
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

  const handleSendQuickCommand = (e: React.FormEvent) => {
    e.preventDefault();
    if (!quickCommand.trim() || status !== 'connected') return;
    sendRawInput(`${quickCommand.trim()}\n`);
    setQuickCommand('');
  };

  const handleScanProject = (targetDir?: string) => {
    if (status !== 'connected') return;
    // Read-only POSIX inspection of directory structure & key manifest files
    const cdPrefix = targetDir ? `cd ${quotePosixPath(targetDir)}` : '';
    const scanParts = [
      ...(cdPrefix ? [cdPrefix] : []),
      'echo "=== PWD ===" && pwd',
      'echo "=== FOLDER STRUCTURE ===" && find . -maxdepth 4 \\( -name node_modules -o -name .git -o -name dist -o -name build -o -name .next -o -name __pycache__ -o -name .venv -o -name venv \\) -prune -o -print | sort | head -n 250',
      'for f in package.json docker-compose.yml docker-compose.yaml Dockerfile pyproject.toml requirements.txt go.mod Cargo.toml tsconfig.json README.md; do if [ -f "$f" ]; then echo "=== FILE: $f ==="; head -n 120 "$f"; fi; done',
    ];
    sendRawInput(`${scanParts.join('; ')}\n`);
  };

  const handleOpenDirectoryInTerminal = (dirPath: string) => {
    if (status !== 'connected' || !dirPath.trim()) return;
    sendRawInput(`cd ${quotePosixPath(dirPath.trim())} && ls -la\n`);
  };

  const handleSaveRemoteFileToNote = (file: RemoteFilePreview) => {
    const ext = file.name.includes('.') ? file.name.split('.').pop()?.toLowerCase() || '' : '';
    const lang = /^[a-z0-9]+$/i.test(ext) ? ext : '';
    const content = `## ${file.name}\n\n- **Path**: \`${file.path}\`\n- **Size**: ${formatBytes(file.size)}${
      file.truncated ? ' (first 64 KB)' : ''
    }\n\n\`\`\`${lang}\n${file.content}\n\`\`\`\n`;
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
                    className="w-full px-2.5 py-1.5 text-[13px] tabular-nums rounded-lg border border-neutral-300 dark:border-white/12 bg-white dark:bg-[#0e0e11] text-neutral-950 dark:text-white focus:outline-none focus:border-blue-500"
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
          {/* Quick Command & Snippet Runner Strip */}
          <div className="shrink-0 px-3 sm:px-4 py-2 border-b border-white/[0.08] bg-[#141418] flex flex-wrap items-center gap-2">
            <form onSubmit={handleSendQuickCommand} className="flex-1 min-w-[200px] flex items-center gap-2">
              <span className="text-[12px] font-mono-code text-blue-400 select-none">$</span>
              <input
                type="text"
                disabled={!isConnected}
                value={quickCommand}
                onChange={(e) => setQuickCommand(e.target.value)}
                placeholder={
                  isConnected
                    ? 'Type command to execute on remote server and press Enter...'
                    : 'Connect to a server to run commands interactively'
                }
                className="font-mono-code flex-1 min-w-0 bg-transparent text-[12.5px] text-neutral-100 placeholder:text-neutral-500 focus:outline-none disabled:opacity-50"
              />
              <button
                type="submit"
                disabled={!isConnected || !quickCommand.trim()}
                className="px-2.5 py-1 rounded-md bg-white/10 hover:bg-white/15 disabled:opacity-35 text-[11.5px] font-medium text-neutral-100 transition-colors cursor-pointer whitespace-nowrap"
              >
                Run
              </button>
            </form>

            <div className="flex items-center gap-1.5 shrink-0 flex-wrap">
              <button
                type="button"
                disabled={!isConnected}
                onClick={handleToggleDirBrowser}
                title="Open remote project directory browser"
                className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-md border text-[11.5px] font-medium transition-colors cursor-pointer whitespace-nowrap disabled:opacity-35 ${
                  dirBrowserOpen
                    ? 'border-blue-500/50 bg-blue-500/15 text-blue-300'
                    : 'border-white/10 text-neutral-200 hover:bg-white/10'
                }`}
              >
                <FolderOpen className="w-3 h-3 text-blue-400" />
                <span>Open Directory</span>
              </button>

              <button
                type="button"
                disabled={!isConnected}
                onClick={() => handleScanProject()}
                title="Run a read-only project folder tree & manifest scan in the current directory"
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-white/10 text-[11.5px] font-medium text-neutral-200 hover:bg-white/10 disabled:opacity-35 transition-colors cursor-pointer whitespace-nowrap"
              >
                <FolderTree className="w-3 h-3 text-emerald-400" />
                <span>Scan project</span>
              </button>

              <button
                type="button"
                disabled={!hasSelection}
                onClick={() => void handleCopySelection()}
                title="Copy selected terminal text (Ctrl+Shift+C or Ctrl+C when selected)"
                className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-white/10 text-[11.5px] font-medium text-neutral-200 hover:bg-white/10 disabled:opacity-35 transition-colors cursor-pointer whitespace-nowrap"
              >
                {copiedSelectionNotice ? (
                  <>
                    <Check className="w-3 h-3 text-emerald-400" />
                    <span>Copied</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3 h-3 text-neutral-300" />
                    <span>Copy</span>
                  </>
                )}
              </button>

              <button
                type="button"
                disabled={!isConnected}
                onClick={() => void handlePasteToTerminal()}
                title="Paste from clipboard into terminal (Ctrl+V / Ctrl+Shift+V)"
                className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-white/10 text-[11.5px] font-medium text-neutral-200 hover:bg-white/10 disabled:opacity-35 transition-colors cursor-pointer whitespace-nowrap"
              >
                <ClipboardPaste className="w-3 h-3 text-neutral-300" />
                <span>Paste</span>
              </button>

              <button
                type="button"
                disabled={!isConnected}
                onClick={() => sendRawInput('\x03')}
                title="Send Ctrl+C interrupt signal"
                className="px-2 py-1 rounded-md border border-white/10 text-[11.5px] font-mono-code text-neutral-300 hover:bg-white/10 disabled:opacity-35 transition-colors cursor-pointer whitespace-nowrap"
              >
                Ctrl+C
              </button>

              <div className="relative" ref={snippetMenuRef}>
                <button
                  type="button"
                  disabled={!isConnected || shellSnippets.length === 0}
                  onClick={() => setSnippetPickerOpen((prev) => !prev)}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-white/10 text-[11.5px] font-medium text-neutral-200 hover:bg-white/10 disabled:opacity-35 transition-colors cursor-pointer whitespace-nowrap"
                >
                  <Braces className="w-3 h-3 text-blue-400" />
                  <span>Snippets</span>
                  {snippetPickerOpen ? (
                    <ChevronDown className="w-3 h-3" />
                  ) : (
                    <ChevronRight className="w-3 h-3" />
                  )}
                </button>

                {snippetPickerOpen && (
                  <div className="absolute right-0 mt-1.5 w-72 max-h-64 overflow-y-auto rounded-xl border border-white/12 bg-[#18181d] shadow-xl py-1 z-30">
                    {shellSnippets.map((snippet) => (
                      <button
                        key={snippet.id}
                        type="button"
                        onClick={() => {
                          setSnippetPickerOpen(false);
                          const cleaned = snippet.content
                            .replace(/^```[^\n]*\n?/m, '')
                            .replace(/\n?```\s*$/m, '')
                            .trim();
                          if (cleaned) {
                            sendRawInput(`${cleaned}\n`);
                          }
                        }}
                        className="w-full px-3 py-2 text-left hover:bg-white/[0.07] transition-colors cursor-pointer"
                      >
                        <div className="text-[12.5px] font-medium text-white truncate">
                          {snippet.title}
                        </div>
                        <div className="text-[11px] font-mono-code text-neutral-400 truncate">
                          {snippet.language} · {snippet.category}
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

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
              <aside className="w-full lg:w-[330px] h-[270px] lg:h-auto shrink-0 border-t lg:border-t-0 lg:border-l border-white/[0.08] bg-[#141418] flex flex-col min-h-0">
                <div className="shrink-0 px-3 py-2 border-b border-white/[0.08] flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <FolderOpen className="w-3.5 h-3.5 text-blue-400 shrink-0" />
                    <span className="text-[12.5px] font-semibold text-white truncate">
                      Project Directory
                    </span>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={() => requestListDir(currentRemotePath || '')}
                      disabled={dirLoading}
                      title="Refresh directory"
                      className="p-1 rounded text-neutral-400 hover:text-white hover:bg-white/10 cursor-pointer"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${dirLoading ? 'animate-spin' : ''}`} />
                    </button>
                    <button
                      type="button"
                      onClick={() => setDirBrowserOpen(false)}
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
                    requestListDir(pathInput);
                  }}
                  className="shrink-0 p-2.5 border-b border-white/[0.08] space-y-2"
                >
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => requestListDir(getParentPosixPath(currentRemotePath || '/'))}
                      disabled={dirLoading || currentRemotePath === '/'}
                      title="Parent directory"
                      className="p-1.5 rounded-md border border-white/10 text-neutral-300 hover:bg-white/10 disabled:opacity-35 cursor-pointer shrink-0"
                    >
                      <ArrowUp className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => requestListDir('~')}
                      disabled={dirLoading}
                      title="Home directory (~)"
                      className="p-1.5 rounded-md border border-white/10 text-neutral-300 hover:bg-white/10 disabled:opacity-35 cursor-pointer shrink-0"
                    >
                      <Home className="w-3.5 h-3.5" />
                    </button>
                    <input
                      type="text"
                      value={pathInput}
                      onChange={(e) => setPathInput(e.target.value)}
                      placeholder="/var/www/project"
                      aria-label="Remote project directory path"
                      className="font-mono-code flex-1 min-w-0 px-2.5 py-1 text-[12px] rounded-md border border-white/12 bg-[#0c0c0f] text-neutral-100 placeholder:text-neutral-500 focus:outline-none focus:border-blue-500"
                    />
                    <button
                      type="submit"
                      disabled={dirLoading}
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

                      <button
                        type="button"
                        onClick={() => handleScanProject(currentRemotePath)}
                        title="Scan project folder structure & manifests in this directory"
                        className="inline-flex items-center justify-center gap-1 px-2.5 py-1 rounded-md border border-white/10 hover:bg-white/10 text-[11.5px] font-medium text-neutral-200 transition-colors cursor-pointer whitespace-nowrap"
                      >
                        <FolderTree className="w-3 h-3 text-emerald-400" />
                        <span>Scan</span>
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

                {/* File Preview OR Directory Entries */}
                {previewFile ? (
                  <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
                    <div className="shrink-0 px-2.5 py-2 border-b border-white/[0.08] flex items-center justify-between gap-2 bg-[#111115]">
                      <button
                        type="button"
                        onClick={() => setPreviewFile(null)}
                        className="inline-flex items-center gap-1 text-[11.5px] font-medium text-neutral-300 hover:text-white cursor-pointer whitespace-nowrap"
                      >
                        <ArrowLeft className="w-3.5 h-3.5" />
                        <span>Back</span>
                      </button>
                      <span className="font-mono-code text-[11.5px] text-neutral-200 truncate">
                        {previewFile.name}
                      </span>
                      <div className="flex items-center gap-1 shrink-0">
                        {!previewFile.isBinary && (
                          <>
                            <button
                              type="button"
                              onClick={() => void copyTextToClipboard(previewFile.content)}
                              title="Copy file content"
                              className="p-1 rounded text-neutral-400 hover:text-white hover:bg-white/10 cursor-pointer"
                            >
                              <Copy className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleSaveRemoteFileToNote(previewFile)}
                              title="Save file to NoteCraft note"
                              className="p-1 rounded text-neutral-400 hover:text-white hover:bg-white/10 cursor-pointer"
                            >
                              <FilePlus2 className="w-3.5 h-3.5" />
                            </button>
                          </>
                        )}
                      </div>
                    </div>

                    <div className="flex-1 min-h-0 overflow-auto p-2.5 bg-[#0c0c0f]">
                      {previewFile.isBinary ? (
                        <p className="text-[12px] text-neutral-400 p-2">
                          Binary file ({formatBytes(previewFile.size)}). Preview unavailable.
                        </p>
                      ) : (
                        <>
                          {previewFile.truncated && (
                            <p className="text-[11px] text-amber-300 mb-2">
                              Showing first 64 KB of {formatBytes(previewFile.size)}.
                            </p>
                          )}
                          <pre className="font-mono-code text-[11.5px] leading-relaxed text-neutral-200 whitespace-pre-wrap break-all">
                            {previewFile.content}
                          </pre>
                        </>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="flex-1 min-h-0 overflow-y-auto p-2 space-y-0.5">
                    {(dirLoading || fileLoading) && (
                      <div className="flex items-center gap-2 px-2 py-2 text-[12px] text-neutral-400">
                        <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-400" />
                        <span>{fileLoading ? 'Opening file...' : 'Loading directory...'}</span>
                      </div>
                    )}

                    {!dirLoading && dirEntries.length === 0 && !dirError && (
                      <p className="text-[12px] text-neutral-500 px-2 py-4 text-center">
                        Directory is empty.
                      </p>
                    )}

                    {dirEntries.map((entry) => (
                      <div
                        key={entry.path}
                        className="group flex items-center justify-between gap-1 rounded-md hover:bg-white/[0.06] px-2 py-1.5 transition-colors"
                      >
                        <button
                          type="button"
                          onClick={() => {
                            if (entry.isDirectory) {
                              requestListDir(entry.path);
                            } else {
                              requestReadFile(entry.path);
                            }
                          }}
                          className="flex-1 min-w-0 flex items-center gap-2 text-left cursor-pointer"
                        >
                          {entry.isDirectory ? (
                            <FolderIcon className="w-3.5 h-3.5 text-blue-400 shrink-0" />
                          ) : (
                            <FileText className="w-3.5 h-3.5 text-neutral-400 shrink-0" />
                          )}
                          <span className="font-mono-code text-[12px] text-neutral-200 truncate">
                            {entry.name}
                          </span>
                        </button>

                        {entry.isDirectory ? (
                          <button
                            type="button"
                            onClick={() => handleOpenDirectoryInTerminal(entry.path)}
                            title={`cd ${entry.path}`}
                            className="opacity-0 group-hover:opacity-100 px-1.5 py-0.5 rounded text-[10.5px] font-mono-code text-blue-300 hover:bg-blue-500/20 transition-opacity cursor-pointer shrink-0"
                          >
                            cd
                          </button>
                        ) : (
                          <span className="text-[10.5px] font-mono-code text-neutral-500 tabular-nums shrink-0">
                            {formatBytes(entry.size)}
                          </span>
                        )}
                      </div>
                    ))}

                    {dirTruncated && (
                      <p className="text-[11px] text-neutral-500 px-2 pt-2">
                        Showing first 300 entries.
                      </p>
                    )}
                  </div>
                )}
              </aside>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
