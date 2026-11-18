import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FitAddon } from '@xterm/addon-fit';
import { Terminal as XTerm } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import {
  AlertCircle,
  BookmarkPlus,
  Braces,
  Check,
  ChevronDown,
  ChevronRight,
  Eraser,
  Eye,
  EyeOff,
  FilePlus2,
  FolderOpen,
  FolderTree,
  KeyRound,
  Loader2,
  Lock,
  PanelLeftOpen,
  Plug,
  PlugZap,
  Server,
  Terminal,
  Trash2,
  Upload,
  Wand2,
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
  storageMode: StorageBackendMode;
  currentUser: AuthUser;
  folders: Folder[];
  defaultFolderId?: string | null;
  snippets: Snippet[];
  sidebarOpen: boolean;
  onOpenSidebar: () => void;
  onSaveTranscriptToNote: (
    serverLabel: string,
    transcript: string,
    options?: { folderId?: string | null; openAiAfterSave?: boolean }
  ) => void;
}

type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

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
  storageMode,
  currentUser,
  folders,
  defaultFolderId = null,
  snippets,
  sidebarOpen,
  onOpenSidebar,
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

  const terminalContainerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<XTerm | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const keyFileInputRef = useRef<HTMLInputElement>(null);
  const passwordInputRef = useRef<HTMLInputElement>(null);
  const snippetMenuRef = useRef<HTMLDivElement>(null);
  const selectedProfileIdRef = useRef<string | null>(null);
  selectedProfileIdRef.current = selectedProfileId;
  const profilesRef = useRef<SshProfile[]>(profiles);
  profilesRef.current = profiles;

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

  // Close snippet dropdown on outside click
  useEffect(() => {
    if (!snippetPickerOpen) return;
    const handlePointerDown = (e: PointerEvent) => {
      if (snippetMenuRef.current && !snippetMenuRef.current.contains(e.target as Node)) {
        setSnippetPickerOpen(false);
      }
    };
    window.addEventListener('pointerdown', handlePointerDown);
    return () => window.removeEventListener('pointerdown', handlePointerDown);
  }, [snippetPickerOpen]);

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

    const resizeObserver = new ResizeObserver(() => {
      safeFit();
    });
    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
      inputDisposable.dispose();
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

  // Re-fit terminal when connection panel collapses/expands
  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        fitAddonRef.current?.fit();
        const term = termRef.current;
        const ws = wsRef.current;
        if (term && ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
        }
      } catch {
        // ignore
      }
    }, 80);
    return () => window.clearTimeout(timer);
  }, [panelOpen, sidebarOpen]);

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

  const handleScanProject = () => {
    if (status !== 'connected') return;
    // Read-only POSIX inspection of current directory structure & key manifest files
    const scanCmd = [
      'echo "=== PWD ===" && pwd',
      'echo "=== FOLDER STRUCTURE ===" && find . -maxdepth 4 \\( -name node_modules -o -name .git -o -name dist -o -name build -o -name .next -o -name __pycache__ -o -name .venv -o -name venv \\) -prune -o -print | sort | head -n 250',
      'for f in package.json docker-compose.yml docker-compose.yaml Dockerfile pyproject.toml requirements.txt go.mod Cargo.toml tsconfig.json README.md; do if [ -f "$f" ]; then echo "=== FILE: $f ==="; head -n 120 "$f"; fi; done',
    ].join('; ');
    sendRawInput(`${scanCmd}\n`);
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

            <div className="flex items-center gap-1.5 shrink-0">
              <button
                type="button"
                disabled={!isConnected}
                onClick={handleScanProject}
                title="Run a read-only project folder tree & manifest scan in the current directory"
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-white/10 text-[11.5px] font-medium text-neutral-200 hover:bg-white/10 disabled:opacity-35 transition-colors cursor-pointer whitespace-nowrap"
              >
                <FolderTree className="w-3 h-3 text-emerald-400" />
                <span>Scan project</span>
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

          {/* xterm.js Canvas */}
          <div className="flex-1 min-h-0 p-3">
            <div ref={terminalContainerRef} className="w-full h-full" />
          </div>
        </div>
      </div>
    </div>
  );
}
