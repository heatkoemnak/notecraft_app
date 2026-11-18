import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  BookmarkPlus,
  Braces,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  Database,
  Eye,
  EyeOff,
  FilePlus2,
  FolderOpen,
  KeyRound,
  Loader2,
  PanelLeftOpen,
  Play,
  Plug,
  PlugZap,
  RefreshCw,
  Search,
  Table2,
  Trash2,
  Wand2,
} from 'lucide-react';
import {
  AuthUser,
  DatabaseEngine,
  DatabaseProfile,
  DatabaseQueryResult,
  DatabaseTableInfo,
  Folder,
  Snippet,
} from '../types/notes';
import { StorageBackendMode } from '../utils/authClient';
import {
  connectAndIntrospectDatabase,
  DatabaseIntrospectionResponse,
  deleteDatabaseProfile,
  fetchDatabaseProfiles,
  formatDatabaseUrlPreview,
  formatQueryResultAsMarkdown,
  formatSchemaAsMarkdown,
  parseDatabaseUrl,
  runDatabaseQuery,
  saveDatabaseProfile,
} from '../utils/databaseClient';
import { formatRelativeDate } from '../utils/markdown';

interface DatabaseExplorerViewProps {
  storageMode: StorageBackendMode;
  currentUser: AuthUser;
  folders: Folder[];
  defaultFolderId?: string | null;
  snippets: Snippet[];
  sidebarOpen: boolean;
  onOpenSidebar: () => void;
  onConnectionStateChange?: (connected: boolean) => void;
  onSaveToNote: (
    title: string,
    markdownContent: string,
    options?: { folderId?: string | null; openAiAfterSave?: boolean }
  ) => void;
}

type DbStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

function quoteIdentifier(engine: DatabaseEngine, schema: string, table: string): string {
  if (engine === 'mysql') {
    return `\`${table.replace(/`/g, '``')}\``;
  }
  const safeSchema = `"${schema.replace(/"/g, '""')}"`;
  const safeTable = `"${table.replace(/"/g, '""')}"`;
  return schema === 'public' ? safeTable : `${safeSchema}.${safeTable}`;
}

export function DatabaseExplorerView({
  storageMode,
  currentUser,
  folders,
  defaultFolderId = null,
  snippets,
  sidebarOpen,
  onOpenSidebar,
  onConnectionStateChange,
  onSaveToNote,
}: DatabaseExplorerViewProps) {
  const [profiles, setProfiles] = useState<DatabaseProfile[]>([]);
  const [loadingProfiles, setLoadingProfiles] = useState(true);
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(true);
  const [targetFolderId, setTargetFolderId] = useState<string>(
    defaultFolderId ?? folders[0]?.id ?? ''
  );

  // Connection form
  const [urlInput, setUrlInput] = useState('');
  const [engine, setEngine] = useState<DatabaseEngine>('postgres');
  const [host, setHost] = useState('');
  const [port, setPort] = useState('5432');
  const [database, setDatabase] = useState('');
  const [username, setUsername] = useState('postgres');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [ssl, setSsl] = useState(false);
  const [label, setLabel] = useState('');

  // Live session state
  const [status, setStatus] = useState<DbStatus>('disconnected');
  const [statusMessage, setStatusMessage] = useState('Enter database credentials to connect');
  const [schemaInfo, setSchemaInfo] = useState<DatabaseIntrospectionResponse | null>(null);
  const [tableFilter, setTableFilter] = useState('');
  const [expandedTables, setExpandedTables] = useState<Set<string>>(new Set());
  const [tablesGroupOpen, setTablesGroupOpen] = useState(true);
  const [collapsedSchemas, setCollapsedSchemas] = useState<Set<string>>(new Set());

  // Query editor & results
  const [sql, setSql] = useState('SELECT 1 AS status;');
  const [runningQuery, setRunningQuery] = useState(false);
  const [queryError, setQueryError] = useState<string | null>(null);
  const [queryResult, setQueryResult] = useState<DatabaseQueryResult | null>(null);

  // Feedback notices
  const [savingProfile, setSavingProfile] = useState(false);
  const [savedProfileNotice, setSavedProfileNotice] = useState(false);
  const [savedNoteNotice, setSavedNoteNotice] = useState(false);
  const [copiedCsv, setCopiedCsv] = useState(false);
  const [snippetMenuOpen, setSnippetMenuOpen] = useState(false);

  const snippetMenuRef = useRef<HTMLDivElement>(null);
  const passwordInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    onConnectionStateChange?.(status === 'connected');
  }, [status, onConnectionStateChange]);

  useEffect(() => {
    let cancelled = false;
    setLoadingProfiles(true);
    fetchDatabaseProfiles(storageMode, currentUser.id)
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

  useEffect(() => {
    if (!snippetMenuOpen) return;
    const handlePointerDown = (e: PointerEvent) => {
      if (snippetMenuRef.current && !snippetMenuRef.current.contains(e.target as Node)) {
        setSnippetMenuOpen(false);
      }
    };
    window.addEventListener('pointerdown', handlePointerDown);
    return () => window.removeEventListener('pointerdown', handlePointerDown);
  }, [snippetMenuOpen]);

  const syncUrlPreview = (
    nextEngine: DatabaseEngine,
    nextUser: string,
    nextHost: string,
    nextPort: string,
    nextDb: string,
    nextSsl: boolean
  ) => {
    if (!nextHost.trim()) return;
    setUrlInput(
      formatDatabaseUrlPreview({
        engine: nextEngine,
        username: nextUser,
        host: nextHost,
        port: Number(nextPort) || (nextEngine === 'mysql' ? 3306 : 5432),
        database: nextDb,
        ssl: nextSsl,
      })
    );
  };

  const handleUrlInputChange = (raw: string) => {
    setUrlInput(raw);
    const parsed = parseDatabaseUrl(raw);
    if (!parsed) return;
    if (parsed.engine) setEngine(parsed.engine);
    if (parsed.host !== undefined) setHost(parsed.host);
    if (parsed.port !== undefined) setPort(String(parsed.port));
    if (parsed.database !== undefined) setDatabase(parsed.database);
    if (parsed.username !== undefined) setUsername(parsed.username);
    if (parsed.password !== undefined) setPassword(parsed.password);
    if (parsed.ssl !== undefined) setSsl(parsed.ssl);
  };

  const handleEngineChange = (nextEngine: DatabaseEngine) => {
    setEngine(nextEngine);
    const currentPort = port.trim();
    const nextPort =
      nextEngine === 'mysql' && (!currentPort || currentPort === '5432')
        ? '3306'
        : nextEngine === 'postgres' && (!currentPort || currentPort === '3306')
        ? '5432'
        : currentPort;
    setPort(nextPort);
    if (nextEngine === 'mysql' && username === 'postgres') {
      setUsername('root');
    } else if (nextEngine === 'postgres' && username === 'root') {
      setUsername('postgres');
    }
    syncUrlPreview(nextEngine, username, host, nextPort, database, ssl);
  };

  const getConnectionPayload = () => {
    const parsed = urlInput.trim() ? parseDatabaseUrl(urlInput) : null;
    const resolvedEngine = parsed?.engine ?? engine;
    const defaultPort = resolvedEngine === 'mysql' ? 3306 : 5432;
    return {
      engine: resolvedEngine,
      host: (host.trim() || parsed?.host || '').trim(),
      port: Math.max(1, Math.min(65535, Math.round(Number(port || parsed?.port || defaultPort)))),
      database: (database.trim() || parsed?.database || '').trim(),
      username: (username.trim() || parsed?.username || '').trim(),
      password: password || parsed?.password || '',
      ssl,
    };
  };

  const handleConnect = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const payload = getConnectionPayload();

    if (!payload.host || !payload.database || !payload.username) {
      setStatus('error');
      setStatusMessage('Enter host, database name, and username to connect.');
      return;
    }

    setStatus('connecting');
    setStatusMessage(`Connecting to ${payload.database}@${payload.host}:${payload.port}...`);
    setQueryError(null);

    try {
      const info = await connectAndIntrospectDatabase(payload);
      setSchemaInfo(info);
      setStatus('connected');
      setStatusMessage(`${info.version} · ${info.tables.length} tables`);

      setTablesGroupOpen(true);
      setCollapsedSchemas(new Set());
      if (info.tables.length > 0) {
        const first = info.tables[0];
        const firstKey = `${first.schema}.${first.name}`;
        setExpandedTables(new Set([firstKey]));
        if (sql.trim() === 'SELECT 1 AS status;') {
          const quoted = quoteIdentifier(info.engine, first.schema, first.name);
          setSql(`SELECT * FROM ${quoted} LIMIT 50;`);
        }
      }

      if (selectedProfileId) {
        const existing = profiles.find((p) => p.id === selectedProfileId);
        if (existing) {
          void saveDatabaseProfile(storageMode, currentUser.id, {
            ...existing,
            lastConnectedAt: Date.now(),
          }).then((updated) => {
            setProfiles((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
          });
        }
      }
    } catch (err) {
      setStatus('error');
      setSchemaInfo(null);
      setStatusMessage(
        err instanceof Error ? err.message : 'Failed to connect to database.'
      );
    }
  };

  const handleDisconnect = () => {
    setStatus('disconnected');
    setStatusMessage('Disconnected');
    setSchemaInfo(null);
    setQueryResult(null);
    setQueryError(null);
  };

  const handleSaveProfile = async () => {
    const payload = getConnectionPayload();
    if (!payload.host || !payload.database || !payload.username) {
      setStatus('error');
      setStatusMessage('Enter host, database name, and username before saving.');
      return;
    }
    setSavingProfile(true);
    try {
      const saved = await saveDatabaseProfile(storageMode, currentUser.id, {
        id: selectedProfileId ?? undefined,
        label: label.trim() || `${payload.database}@${payload.host}`,
        engine: payload.engine,
        host: payload.host,
        port: payload.port,
        database: payload.database,
        username: payload.username,
        ssl: payload.ssl,
      });
      setSelectedProfileId(saved.id);
      setProfiles((prev) => [saved, ...prev.filter((p) => p.id !== saved.id)]);
      setSavedProfileNotice(true);
      window.setTimeout(() => setSavedProfileNotice(false), 1800);
    } catch (err) {
      setStatus('error');
      setStatusMessage(
        err instanceof Error ? err.message : 'Failed to save database connection.'
      );
    } finally {
      setSavingProfile(false);
    }
  };

  const handleSelectProfile = (profile: DatabaseProfile) => {
    setSelectedProfileId(profile.id);
    setLabel(profile.label);
    setEngine(profile.engine);
    setHost(profile.host);
    setPort(String(profile.port));
    setDatabase(profile.database);
    setUsername(profile.username);
    setSsl(profile.ssl);
    setUrlInput(
      formatDatabaseUrlPreview({
        engine: profile.engine,
        username: profile.username,
        host: profile.host,
        port: profile.port,
        database: profile.database,
        ssl: profile.ssl,
      })
    );
    window.requestAnimationFrame(() => passwordInputRef.current?.focus());
  };

  const handleDeleteProfile = async (profileId: string) => {
    try {
      await deleteDatabaseProfile(storageMode, currentUser.id, profileId);
      setProfiles((prev) => prev.filter((p) => p.id !== profileId));
      if (selectedProfileId === profileId) {
        setSelectedProfileId(null);
      }
    } catch {
      // ignore
    }
  };

  const handleRunQuery = async (sqlOverride?: string) => {
    const queryText = (sqlOverride ?? sql).trim();
    if (!queryText || runningQuery) return;
    if (status !== 'connected') {
      setQueryError('Connect to a database first before running queries.');
      return;
    }

    setRunningQuery(true);
    setQueryError(null);
    try {
      const payload = getConnectionPayload();
      const res = await runDatabaseQuery(payload, queryText);
      setQueryResult(res);
    } catch (err) {
      setQueryError(err instanceof Error ? err.message : 'Failed to run SQL query.');
    } finally {
      setRunningQuery(false);
    }
  };

  const handlePreviewTable = (tbl: DatabaseTableInfo) => {
    const activeEngine = schemaInfo?.engine ?? engine;
    const quoted = quoteIdentifier(activeEngine, tbl.schema, tbl.name);
    const previewSql = `SELECT * FROM ${quoted} LIMIT 50;`;
    setSql(previewSql);
    void handleRunQuery(previewSql);
  };

  const handleCopyCsv = async () => {
    if (!queryResult || queryResult.columns.length === 0) return;
    const escapeCsv = (val: unknown) => {
      if (val === null || val === undefined) return '';
      const str = String(val);
      return /[",\n\r]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
    };
    const header = queryResult.columns.map((c) => escapeCsv(c.name)).join(',');
    const body = queryResult.rows.map((row) =>
      queryResult.columns.map((c) => escapeCsv(row[c.name])).join(',')
    );
    try {
      await navigator.clipboard.writeText([header, ...body].join('\n'));
      setCopiedCsv(true);
      window.setTimeout(() => setCopiedCsv(false), 1800);
    } catch {
      // ignore clipboard errors
    }
  };

  const handleSaveSchema = (openAiAfterSave: boolean) => {
    if (!schemaInfo) return;
    const payload = getConnectionPayload();
    const markdown = formatSchemaAsMarkdown(schemaInfo, payload.host, payload.port);
    onSaveToNote(`Database Schema: ${schemaInfo.database}`, markdown, {
      folderId: targetFolderId || null,
      openAiAfterSave,
    });
    setSavedNoteNotice(true);
    window.setTimeout(() => setSavedNoteNotice(false), 1800);
  };

  const handleSaveQueryResult = (openAiAfterSave: boolean) => {
    if (!queryResult) return;
    const payload = getConnectionPayload();
    const markdown = formatQueryResultAsMarkdown(
      {
        engine: schemaInfo?.engine ?? payload.engine,
        database: schemaInfo?.database ?? payload.database,
        host: payload.host,
        port: payload.port,
      },
      sql,
      queryResult
    );
    onSaveToNote(
      `SQL Result: ${schemaInfo?.database || payload.database}`,
      markdown,
      {
        folderId: targetFolderId || null,
        openAiAfterSave,
      }
    );
    setSavedNoteNotice(true);
    window.setTimeout(() => setSavedNoteNotice(false), 1800);
  };

  const filteredTables = useMemo(() => {
    if (!schemaInfo) return [];
    const q = tableFilter.trim().toLowerCase();
    if (!q) return schemaInfo.tables;
    return schemaInfo.tables.filter(
      (t) =>
        t.name.toLowerCase().includes(q) ||
        t.schema.toLowerCase().includes(q) ||
        t.columns.some((c) => c.name.toLowerCase().includes(q))
    );
  }, [schemaInfo, tableFilter]);

  const groupedTablesBySchema = useMemo(() => {
    const groups = new Map<string, DatabaseTableInfo[]>();
    for (const tbl of filteredTables) {
      const schemaName = tbl.schema || 'public';
      const list = groups.get(schemaName) || [];
      list.push(tbl);
      groups.set(schemaName, list);
    }
    return Array.from(groups.entries()).map(([schema, tables]) => ({ schema, tables }));
  }, [filteredTables]);

  const isFilteringTables = tableFilter.trim().length > 0;
  const isTablesGroupExpanded = isFilteringTables || tablesGroupOpen;

  const sqlSnippets = useMemo(
    () => snippets.filter((s) => /sql|postgres|mysql|db|query/i.test(`${s.language} ${s.category} ${s.title}`)),
    [snippets]
  );

  const isConnected = status === 'connected';
  const isConnecting = status === 'connecting';

  return (
    <div className="flex-1 flex flex-col min-w-0 bg-white dark:bg-[#121214]">
      {/* Header */}
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

          <Database className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0" />
          <h1 className="text-[14.5px] font-semibold text-neutral-950 dark:text-white whitespace-nowrap">
            Database Explorer
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
            <span className="truncate">{statusMessage}</span>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => setPanelOpen((prev) => !prev)}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-neutral-200 dark:border-white/10 text-[12.5px] font-medium text-neutral-700 dark:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-white/[0.06] transition-colors cursor-pointer whitespace-nowrap"
          >
            <Table2 className="w-3.5 h-3.5 text-neutral-400" />
            <span className="hidden sm:inline">{panelOpen ? 'Hide explorer' : 'Explorer'}</span>
          </button>

          {folders.length > 0 && isConnected && (
            <div className="hidden xl:flex items-center gap-1.5 px-2 py-1 rounded-lg border border-neutral-200 dark:border-white/10 bg-neutral-50 dark:bg-white/[0.03]">
              <FolderOpen className="w-3.5 h-3.5 text-neutral-400 shrink-0" />
              <select
                value={targetFolderId}
                onChange={(e) => setTargetFolderId(e.target.value)}
                aria-label="Target folder for saved database notes"
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

          {isConnected && schemaInfo && (
            <>
              <button
                type="button"
                onClick={() => handleSaveSchema(false)}
                title="Save full database schema & Mermaid ER diagram to a NoteCraft note"
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-neutral-200 dark:border-white/10 text-[12.5px] font-medium text-neutral-700 dark:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-white/[0.06] transition-colors cursor-pointer whitespace-nowrap"
              >
                {savedNoteNotice ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-emerald-500" />
                    <span>Saved</span>
                  </>
                ) : (
                  <>
                    <FilePlus2 className="w-3.5 h-3.5 text-neutral-400" />
                    <span className="hidden md:inline">Save schema</span>
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={() => handleSaveSchema(true)}
                title="Save database schema to a note and ask AI to explain how the database works"
                className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-blue-500/30 bg-blue-600/10 dark:bg-blue-500/15 text-[12.5px] font-medium text-blue-700 dark:text-blue-300 hover:bg-blue-600/15 dark:hover:bg-blue-500/25 transition-colors cursor-pointer whitespace-nowrap"
              >
                <Wand2 className="w-3.5 h-3.5" />
                <span>Schema & Ask AI</span>
              </button>
            </>
          )}

          {isConnected ? (
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
              disabled={isConnecting}
              onClick={() => void handleConnect()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-[12.5px] font-medium transition-colors cursor-pointer whitespace-nowrap shrink-0"
            >
              {isConnecting ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Plug className="w-3.5 h-3.5" />
              )}
              <span>{isConnecting ? 'Connecting...' : 'Connect'}</span>
            </button>
          )}
        </div>
      </header>

      {/* Main Split Body */}
      <div className="flex-1 min-h-0 flex flex-col lg:flex-row overflow-hidden">
        {/* Left: Connection Form + Saved Profiles + Schema Tree */}
        {panelOpen && (
          <aside className="w-full lg:w-[340px] shrink-0 border-b lg:border-b-0 lg:border-r border-neutral-200 dark:border-white/[0.07] bg-neutral-50/70 dark:bg-[#141418] overflow-y-auto p-4 space-y-5">
            {!isConnected ? (
              <>
                <form onSubmit={(e) => void handleConnect(e)} className="space-y-3">
                  {/* Connection String Quick Paste */}
                  <div className="space-y-1">
                    <label
                      htmlFor="db-url-input"
                      className="block text-[12px] font-medium text-neutral-700 dark:text-neutral-300"
                    >
                      Connection URI
                    </label>
                    <input
                      id="db-url-input"
                      type="text"
                      value={urlInput}
                      onChange={(e) => handleUrlInputChange(e.target.value)}
                      placeholder="postgres://user:pass@host:5432/dbname"
                      className="font-mono-code w-full px-3 py-2 text-[12px] rounded-lg border border-neutral-300 dark:border-white/12 bg-white dark:bg-[#0e0e11] text-neutral-950 dark:text-white placeholder:text-neutral-400 focus:outline-none focus:border-blue-500"
                    />
                    <p className="text-[11px] text-neutral-500 dark:text-neutral-400">
                      Paste a <code className="font-mono-code">postgres://</code> or{' '}
                      <code className="font-mono-code">mysql://</code> URL to auto-fill.
                    </p>
                  </div>

                  {/* Engine Switcher */}
                  <div className="space-y-1">
                    <span className="block text-[12px] font-medium text-neutral-700 dark:text-neutral-300">
                      Database Engine
                    </span>
                    <div className="grid grid-cols-2 rounded-lg bg-neutral-200/70 dark:bg-white/[0.06] p-0.5">
                      <button
                        type="button"
                        onClick={() => handleEngineChange('postgres')}
                        className={`px-2.5 py-1.5 rounded-md text-[12px] font-medium transition-colors cursor-pointer whitespace-nowrap ${
                          engine === 'postgres'
                            ? 'bg-white dark:bg-[#24242b] text-neutral-950 dark:text-white shadow-xs'
                            : 'text-neutral-600 dark:text-neutral-400'
                        }`}
                      >
                        PostgreSQL
                      </button>
                      <button
                        type="button"
                        onClick={() => handleEngineChange('mysql')}
                        className={`px-2.5 py-1.5 rounded-md text-[12px] font-medium transition-colors cursor-pointer whitespace-nowrap ${
                          engine === 'mysql'
                            ? 'bg-white dark:bg-[#24242b] text-neutral-950 dark:text-white shadow-xs'
                            : 'text-neutral-600 dark:text-neutral-400'
                        }`}
                      >
                        MySQL / MariaDB
                      </button>
                    </div>
                  </div>

                  {/* Host + Port */}
                  <div className="grid grid-cols-[1fr_82px] gap-2">
                    <div className="space-y-1">
                      <label
                        htmlFor="db-host-input"
                        className="block text-[12px] font-medium text-neutral-700 dark:text-neutral-300"
                      >
                        Host
                      </label>
                      <input
                        id="db-host-input"
                        type="text"
                        value={host}
                        onChange={(e) => {
                          setHost(e.target.value);
                          syncUrlPreview(engine, username, e.target.value, port, database, ssl);
                        }}
                        placeholder="localhost"
                        className="w-full px-3 py-1.5 text-[13px] rounded-lg border border-neutral-300 dark:border-white/12 bg-white dark:bg-[#0e0e11] text-neutral-950 dark:text-white placeholder:text-neutral-400 focus:outline-none focus:border-blue-500"
                      />
                    </div>
                    <div className="space-y-1">
                      <label
                        htmlFor="db-port-input"
                        className="block text-[12px] font-medium text-neutral-700 dark:text-neutral-300"
                      >
                        Port
                      </label>
                      <input
                        id="db-port-input"
                        type="number"
                        min={1}
                        max={65535}
                        value={port}
                        onChange={(e) => {
                          setPort(e.target.value);
                          syncUrlPreview(engine, username, host, e.target.value, database, ssl);
                        }}
                        className="w-full px-2.5 py-1.5 text-[13px] tabular-nums rounded-lg border border-neutral-300 dark:border-white/12 bg-white dark:bg-[#0e0e11] text-neutral-950 dark:text-white focus:outline-none focus:border-blue-500"
                      />
                    </div>
                  </div>

                  {/* Database Name + Label */}
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <label
                        htmlFor="db-name-input"
                        className="block text-[12px] font-medium text-neutral-700 dark:text-neutral-300"
                      >
                        Database
                      </label>
                      <input
                        id="db-name-input"
                        type="text"
                        value={database}
                        onChange={(e) => {
                          setDatabase(e.target.value);
                          syncUrlPreview(engine, username, host, port, e.target.value, ssl);
                        }}
                        placeholder="postgres"
                        className="w-full px-3 py-1.5 text-[13px] rounded-lg border border-neutral-300 dark:border-white/12 bg-white dark:bg-[#0e0e11] text-neutral-950 dark:text-white placeholder:text-neutral-400 focus:outline-none focus:border-blue-500"
                      />
                    </div>
                    <div className="space-y-1">
                      <label
                        htmlFor="db-label-input"
                        className="block text-[12px] font-medium text-neutral-700 dark:text-neutral-300"
                      >
                        Label
                      </label>
                      <input
                        id="db-label-input"
                        type="text"
                        value={label}
                        onChange={(e) => setLabel(e.target.value)}
                        placeholder="Production DB"
                        className="w-full px-3 py-1.5 text-[13px] rounded-lg border border-neutral-300 dark:border-white/12 bg-white dark:bg-[#0e0e11] text-neutral-950 dark:text-white placeholder:text-neutral-400 focus:outline-none focus:border-blue-500"
                      />
                    </div>
                  </div>

                  {/* Username + Password */}
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <label
                        htmlFor="db-user-input"
                        className="block text-[12px] font-medium text-neutral-700 dark:text-neutral-300"
                      >
                        Username
                      </label>
                      <input
                        id="db-user-input"
                        type="text"
                        value={username}
                        onChange={(e) => {
                          setUsername(e.target.value);
                          syncUrlPreview(engine, e.target.value, host, port, database, ssl);
                        }}
                        placeholder={engine === 'mysql' ? 'root' : 'postgres'}
                        className="w-full px-3 py-1.5 text-[13px] rounded-lg border border-neutral-300 dark:border-white/12 bg-white dark:bg-[#0e0e11] text-neutral-950 dark:text-white placeholder:text-neutral-400 focus:outline-none focus:border-blue-500"
                      />
                    </div>

                    <div className="space-y-1">
                      <label
                        htmlFor="db-pass-input"
                        className="block text-[12px] font-medium text-neutral-700 dark:text-neutral-300"
                      >
                        Password
                      </label>
                      <div className="relative">
                        <input
                          ref={passwordInputRef}
                          id="db-pass-input"
                          type={showPassword ? 'text' : 'password'}
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          placeholder="••••••"
                          autoComplete="off"
                          className="w-full pl-3 pr-8 py-1.5 text-[13px] rounded-lg border border-neutral-300 dark:border-white/12 bg-white dark:bg-[#0e0e11] text-neutral-950 dark:text-white placeholder:text-neutral-400 focus:outline-none focus:border-blue-500"
                        />
                        <button
                          type="button"
                          onClick={() => setShowPassword((p) => !p)}
                          aria-label={showPassword ? 'Hide password' : 'Show password'}
                          className="absolute right-1.5 top-1/2 -translate-y-1/2 p-1 text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200 cursor-pointer"
                        >
                          {showPassword ? (
                            <EyeOff className="w-3.5 h-3.5" />
                          ) : (
                            <Eye className="w-3.5 h-3.5" />
                          )}
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* SSL Toggle */}
                  <label className="inline-flex items-center gap-2 text-[12px] text-neutral-700 dark:text-neutral-300 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={ssl}
                      onChange={(e) => {
                        setSsl(e.target.checked);
                        syncUrlPreview(engine, username, host, port, database, e.target.checked);
                      }}
                      className="h-3.5 w-3.5 rounded accent-blue-600 cursor-pointer"
                    />
                    <span>Use SSL / TLS encrypted connection</span>
                  </label>

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
                          <span>Connect Database</span>
                        </>
                      )}
                    </button>

                    <button
                      type="button"
                      disabled={savingProfile}
                      onClick={() => void handleSaveProfile()}
                      title="Save database host & details (passwords are never stored)"
                      className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border border-neutral-200 dark:border-white/12 bg-white dark:bg-white/[0.04] hover:bg-neutral-100 dark:hover:bg-white/[0.08] text-[12.5px] font-medium text-neutral-700 dark:text-neutral-200 transition-colors cursor-pointer whitespace-nowrap shrink-0"
                    >
                      {savedProfileNotice ? (
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

                {/* Saved Databases */}
                <div className="pt-4 border-t border-neutral-200 dark:border-white/[0.08] space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[12px] font-medium text-neutral-500 dark:text-neutral-400">
                      Saved databases
                    </span>
                    <span className="text-[11.5px] text-neutral-400 tabular-nums">
                      {profiles.length}
                    </span>
                  </div>

                  {loadingProfiles ? (
                    <div className="py-2 text-[12px] text-neutral-500">Loading...</div>
                  ) : profiles.length === 0 ? (
                    <p className="text-[12px] text-neutral-500 dark:text-neutral-500 py-1">
                      No saved databases yet. Save a connection above for quick access.
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
                                <Database className="w-3.5 h-3.5 text-neutral-400 shrink-0" />
                                <span className="text-[12.5px] font-medium text-neutral-900 dark:text-neutral-100 truncate">
                                  {profile.label}
                                </span>
                              </div>
                              <div className="pl-5 text-[11px] font-mono-code text-neutral-500 dark:text-neutral-400 truncate">
                                {profile.engine === 'mysql' ? 'mysql' : 'pg'} · {profile.host}:
                                {profile.port}/{profile.database}
                                {profile.lastConnectedAt
                                  ? ` · ${formatRelativeDate(profile.lastConnectedAt)}`
                                  : ''}
                              </div>
                            </button>

                            <button
                              type="button"
                              onClick={() => void handleDeleteProfile(profile.id)}
                              title="Remove saved database"
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
              </>
            ) : (
              /* Connected: Schema & Tables Explorer */
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-[13px] font-semibold text-neutral-950 dark:text-white truncate">
                      {schemaInfo?.database}
                    </div>
                    <div className="text-[11.5px] text-neutral-500 dark:text-neutral-400 truncate">
                      {schemaInfo?.version} · {schemaInfo?.tables.length ?? 0} tables
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => void handleConnect()}
                    disabled={isConnecting}
                    title="Refresh tables and columns"
                    className="p-1.5 rounded-lg border border-neutral-200 dark:border-white/10 text-neutral-600 dark:text-neutral-300 hover:bg-neutral-200/70 dark:hover:bg-white/[0.07] transition-colors cursor-pointer shrink-0"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${isConnecting ? 'animate-spin' : ''}`} />
                  </button>
                </div>

                <div className="relative">
                  <Search className="w-3.5 h-3.5 text-neutral-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    type="text"
                    value={tableFilter}
                    onChange={(e) => setTableFilter(e.target.value)}
                    placeholder="Filter tables or columns..."
                    className="w-full pl-8 pr-3 py-1.5 text-[12.5px] rounded-lg border border-neutral-200 dark:border-white/10 bg-white dark:bg-[#0e0e11] text-neutral-900 dark:text-neutral-100 placeholder:text-neutral-400 focus:outline-none focus:border-blue-500"
                  />
                </div>

                {filteredTables.length === 0 ? (
                  <p className="text-[12.5px] text-neutral-500 dark:text-neutral-400 py-4 text-center">
                    No matching tables found.
                  </p>
                ) : (
                  <div className="rounded-xl border border-neutral-200/90 dark:border-white/[0.08] bg-white/70 dark:bg-[#101014] overflow-hidden">
                    {/* Tables Group Header */}
                    <button
                      type="button"
                      onClick={() => setTablesGroupOpen((prev) => !prev)}
                      className="w-full flex items-center justify-between gap-2 px-3 py-2 bg-neutral-100/70 dark:bg-white/[0.03] hover:bg-neutral-100 dark:hover:bg-white/[0.06] transition-colors cursor-pointer"
                    >
                      <span className="flex items-center gap-1.5 min-w-0">
                        {isTablesGroupExpanded ? (
                          <ChevronDown className="w-3.5 h-3.5 text-neutral-500 shrink-0" />
                        ) : (
                          <ChevronRight className="w-3.5 h-3.5 text-neutral-500 shrink-0" />
                        )}
                        <FolderOpen className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400 shrink-0" />
                        <span className="text-[12.5px] font-semibold text-neutral-900 dark:text-neutral-100">
                          Tables
                        </span>
                      </span>
                      <span className="text-[11px] font-medium text-neutral-500 dark:text-neutral-400 tabular-nums shrink-0">
                        {filteredTables.length}
                      </span>
                    </button>

                    {isTablesGroupExpanded && (
                      <div className="border-t border-neutral-200/80 dark:border-white/[0.06] p-2 space-y-2">
                        {groupedTablesBySchema.map((group) => {
                          const showSchemaGroup = groupedTablesBySchema.length > 1;
                          const schemaExpanded =
                            isFilteringTables || !collapsedSchemas.has(group.schema);

                          const renderTableList = (items: DatabaseTableInfo[]) => (
                            <div className="space-y-1">
                              {items.map((tbl) => {
                                const key = `${tbl.schema}.${tbl.name}`;
                                const expanded = expandedTables.has(key);
                                return (
                                  <div
                                    key={key}
                                    className="rounded-lg border border-neutral-200/80 dark:border-white/[0.07] bg-white dark:bg-[#15151a] overflow-hidden"
                                  >
                                    <div className="flex items-center justify-between gap-1 px-2.5 py-2 hover:bg-neutral-50 dark:hover:bg-white/[0.03] transition-colors">
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setExpandedTables((prev) => {
                                            const next = new Set(prev);
                                            if (next.has(key)) next.delete(key);
                                            else next.add(key);
                                            return next;
                                          });
                                        }}
                                        className="flex-1 min-w-0 flex items-center gap-1.5 text-left cursor-pointer"
                                      >
                                        {expanded ? (
                                          <ChevronDown className="w-3.5 h-3.5 text-neutral-400 shrink-0" />
                                        ) : (
                                          <ChevronRight className="w-3.5 h-3.5 text-neutral-400 shrink-0" />
                                        )}
                                        <Table2 className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400 shrink-0" />
                                        <span className="text-[12.5px] font-medium text-neutral-900 dark:text-neutral-100 truncate">
                                          {tbl.name}
                                        </span>
                                      </button>

                                      <div className="flex items-center gap-2 shrink-0">
                                        {tbl.estimatedRows !== null && (
                                          <span className="text-[11px] text-neutral-400 tabular-nums">
                                            ~{tbl.estimatedRows.toLocaleString()}
                                          </span>
                                        )}
                                        <button
                                          type="button"
                                          onClick={() => handlePreviewTable(tbl)}
                                          title={`Preview 50 rows from ${tbl.name}`}
                                          className="px-1.5 py-0.5 rounded text-[11px] font-medium text-blue-600 dark:text-blue-400 hover:bg-blue-600/10 cursor-pointer whitespace-nowrap"
                                        >
                                          Query
                                        </button>
                                      </div>
                                    </div>

                                    {expanded && tbl.columns.length > 0 && (
                                      <div className="border-t border-neutral-100 dark:border-white/[0.06] px-2.5 py-1.5 space-y-1 bg-neutral-50/60 dark:bg-black/20">
                                        {tbl.columns.map((col) => (
                                          <div
                                            key={col.name}
                                            className="flex items-center justify-between gap-2 text-[11.5px] py-0.5"
                                          >
                                            <span className="flex items-center gap-1.5 min-w-0 font-mono-code text-neutral-800 dark:text-neutral-200 truncate">
                                              {col.isPrimaryKey && (
                                                <KeyRound className="w-3 h-3 text-amber-500 shrink-0" />
                                              )}
                                              <span className="truncate">{col.name}</span>
                                            </span>
                                            <span className="font-mono-code text-[11px] text-neutral-500 dark:text-neutral-400 shrink-0">
                                              {col.type}
                                              {col.foreignKey ? ` · FK` : ''}
                                            </span>
                                          </div>
                                        ))}
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          );

                          if (!showSchemaGroup) {
                            return <div key={group.schema}>{renderTableList(group.tables)}</div>;
                          }

                          return (
                            <div key={group.schema} className="space-y-1">
                              <button
                                type="button"
                                onClick={() => {
                                  setCollapsedSchemas((prev) => {
                                    const next = new Set(prev);
                                    if (next.has(group.schema)) next.delete(group.schema);
                                    else next.add(group.schema);
                                    return next;
                                  });
                                }}
                                className="w-full flex items-center justify-between gap-2 px-2 py-1 rounded-md text-[11.5px] font-medium text-neutral-600 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-white/[0.05] transition-colors cursor-pointer"
                              >
                                <span className="flex items-center gap-1.5 min-w-0 truncate">
                                  {schemaExpanded ? (
                                    <ChevronDown className="w-3 h-3 text-neutral-400 shrink-0" />
                                  ) : (
                                    <ChevronRight className="w-3 h-3 text-neutral-400 shrink-0" />
                                  )}
                                  <span className="font-mono-code truncate">{group.schema}</span>
                                </span>
                                <span className="text-[11px] text-neutral-400 tabular-nums shrink-0">
                                  {group.tables.length}
                                </span>
                              </button>

                              {schemaExpanded && (
                                <div className="pl-2">{renderTableList(group.tables)}</div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </aside>
        )}

        {/* Right: SQL Query Editor + Results Grid */}
        <div className="flex-1 min-w-0 min-h-0 flex flex-col bg-white dark:bg-[#121214]">
          {/* SQL Editor Area */}
          <div className="shrink-0 border-b border-neutral-200 dark:border-white/[0.07] p-3.5 sm:p-4 space-y-2.5 bg-neutral-50/40 dark:bg-[#141418]">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-[12px] text-neutral-500 dark:text-neutral-400">
                <span className="font-medium text-neutral-800 dark:text-neutral-200">
                  SQL Query
                </span>
                <span aria-hidden="true">·</span>
                <span>Ctrl+Enter to run</span>
              </div>

              <div className="flex flex-wrap items-center gap-1.5">
                {sqlSnippets.length > 0 && (
                  <div className="relative" ref={snippetMenuRef}>
                    <button
                      type="button"
                      onClick={() => setSnippetMenuOpen((p) => !p)}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-neutral-200 dark:border-white/10 bg-white dark:bg-white/[0.04] text-[12px] font-medium text-neutral-700 dark:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-white/[0.08] transition-colors cursor-pointer whitespace-nowrap"
                    >
                      <Braces className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                      <span>SQL Snippets</span>
                      <ChevronDown className="w-3 h-3" />
                    </button>

                    {snippetMenuOpen && (
                      <div className="absolute right-0 mt-1.5 w-72 max-h-60 overflow-y-auto rounded-xl border border-neutral-200 dark:border-white/12 bg-white dark:bg-[#18181d] shadow-xl py-1 z-30">
                        {sqlSnippets.map((snippet) => (
                          <button
                            key={snippet.id}
                            type="button"
                            onClick={() => {
                              setSnippetMenuOpen(false);
                              const cleaned = snippet.content
                                .replace(/^```[^\n]*\n?/m, '')
                                .replace(/\n?```\s*$/m, '')
                                .trim();
                              if (cleaned) setSql(cleaned);
                            }}
                            className="w-full px-3 py-2 text-left hover:bg-neutral-100 dark:hover:bg-white/[0.07] transition-colors cursor-pointer"
                          >
                            <div className="text-[12.5px] font-medium text-neutral-900 dark:text-white truncate">
                              {snippet.title}
                            </div>
                            <div className="text-[11px] font-mono-code text-neutral-500 dark:text-neutral-400 truncate">
                              {snippet.category}
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                <button
                  type="button"
                  disabled={!isConnected || runningQuery || !sql.trim()}
                  onClick={() => void handleRunQuery()}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-45 text-white text-[12.5px] font-medium transition-colors cursor-pointer whitespace-nowrap"
                >
                  {runningQuery ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>Running...</span>
                    </>
                  ) : (
                    <>
                      <Play className="w-3.5 h-3.5" />
                      <span>Run Query</span>
                    </>
                  )}
                </button>
              </div>
            </div>

            <textarea
              value={sql}
              onChange={(e) => setSql(e.target.value)}
              onKeyDown={(e) => {
                if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                  e.preventDefault();
                  void handleRunQuery();
                }
              }}
              rows={5}
              placeholder="SELECT * FROM users LIMIT 50;"
              aria-label="SQL query editor"
              className="font-mono-code w-full rounded-xl border border-neutral-200 dark:border-white/10 bg-white dark:bg-[#0e0e11] px-3.5 py-2.5 text-[13px] leading-relaxed text-neutral-900 dark:text-neutral-100 placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-blue-500/40 resize-y"
            />
          </div>

          {/* Results Area */}
          <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
            {queryError && (
              <div className="m-4 rounded-xl border border-red-200 dark:border-red-500/30 bg-red-50/80 dark:bg-red-500/10 p-3.5 flex items-start gap-2.5">
                <AlertCircle className="w-4 h-4 text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
                <p className="text-[13px] text-red-800 dark:text-red-200 leading-relaxed">
                  {queryError}
                </p>
              </div>
            )}

            {!queryResult && !queryError && !runningQuery && (
              <div className="flex-1 flex items-center justify-center p-8 text-center">
                <div className="max-w-md space-y-2.5">
                  <h2 className="text-[16px] font-semibold text-neutral-900 dark:text-white">
                    {isConnected
                      ? 'Ready to query your database'
                      : 'Connect to PostgreSQL or MySQL'}
                  </h2>
                  <p className="text-[13.5px] text-neutral-500 dark:text-neutral-400 leading-relaxed">
                    {isConnected
                      ? 'Select any table on the left to inspect columns or click Query, or write custom SQL above and press Ctrl+Enter.'
                      : 'Enter your host, port, database, and credentials on the left (or paste a connection URI) to browse tables, run SQL, and save schemas or query outputs to your notes.'}
                  </p>
                </div>
              </div>
            )}

            {runningQuery && (
              <div className="flex-1 flex items-center justify-center gap-2.5 text-neutral-500 dark:text-neutral-400">
                <Loader2 className="w-5 h-5 animate-spin text-blue-600 dark:text-blue-400" />
                <span className="text-[13px] font-medium">Executing query...</span>
              </div>
            )}

            {queryResult && !runningQuery && (
              <>
                <div className="shrink-0 px-4 py-2.5 border-b border-neutral-200 dark:border-white/[0.07] flex flex-wrap items-center justify-between gap-2 bg-white dark:bg-[#121214]">
                  <div className="flex items-center gap-2 text-[12px] text-neutral-500 dark:text-neutral-400 tabular-nums">
                    <span className="font-medium text-neutral-900 dark:text-neutral-200">
                      {queryResult.rowCount.toLocaleString()}{' '}
                      {queryResult.rowCount === 1 ? 'row' : 'rows'}
                    </span>
                    {queryResult.truncated && (
                      <span>(showing first 200)</span>
                    )}
                    <span aria-hidden="true">·</span>
                    <span className="font-mono-code">{queryResult.durationMs} ms</span>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    {queryResult.columns.length > 0 && (
                      <button
                        type="button"
                        onClick={() => void handleCopyCsv()}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-neutral-200 dark:border-white/10 text-[12px] font-medium text-neutral-700 dark:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-white/[0.06] transition-colors cursor-pointer whitespace-nowrap"
                      >
                        {copiedCsv ? (
                          <>
                            <Check className="w-3.5 h-3.5 text-emerald-500" />
                            <span>Copied CSV</span>
                          </>
                        ) : (
                          <>
                            <Copy className="w-3.5 h-3.5 text-neutral-400" />
                            <span>Copy CSV</span>
                          </>
                        )}
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => handleSaveQueryResult(false)}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-neutral-200 dark:border-white/10 text-[12px] font-medium text-neutral-700 dark:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-white/[0.06] transition-colors cursor-pointer whitespace-nowrap"
                    >
                      <FilePlus2 className="w-3.5 h-3.5 text-neutral-400" />
                      <span>Save result to note</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => handleSaveQueryResult(true)}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-blue-500/30 bg-blue-600/10 dark:bg-blue-500/15 text-[12px] font-medium text-blue-700 dark:text-blue-300 hover:bg-blue-600/15 dark:hover:bg-blue-500/25 transition-colors cursor-pointer whitespace-nowrap"
                    >
                      <Wand2 className="w-3.5 h-3.5" />
                      <span>Save & Ask AI</span>
                    </button>
                  </div>
                </div>

                {queryResult.columns.length === 0 ? (
                  <div className="p-6 text-[13px] text-neutral-600 dark:text-neutral-300">
                    Statement completed successfully ({queryResult.rowCount} rows affected in{' '}
                    <span className="font-mono-code tabular-nums">{queryResult.durationMs} ms</span>).
                  </div>
                ) : (
                  <div className="flex-1 min-h-0 overflow-auto">
                    <table className="w-full border-collapse text-left text-[12.5px]">
                      <thead className="sticky top-0 z-10 bg-neutral-100 dark:bg-[#19191e] border-b border-neutral-200 dark:border-white/[0.08]">
                        <tr>
                          <th className="px-3 py-2 font-mono-code text-[11px] font-medium text-neutral-400 w-10 text-right border-r border-neutral-200/70 dark:border-white/[0.06]">
                            #
                          </th>
                          {queryResult.columns.map((col) => (
                            <th
                              key={col.name}
                              className="px-3 py-2 font-semibold text-neutral-800 dark:text-neutral-200 whitespace-nowrap border-r border-neutral-200/70 dark:border-white/[0.06] last:border-r-0"
                            >
                              {col.name}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-neutral-200/70 dark:divide-white/[0.06]">
                        {queryResult.rows.map((row, idx) => (
                          <tr
                            key={idx}
                            className="hover:bg-neutral-50 dark:hover:bg-white/[0.025] transition-colors"
                          >
                            <td className="px-3 py-2 font-mono-code text-[11px] text-neutral-400 text-right tabular-nums border-r border-neutral-200/70 dark:border-white/[0.06]">
                              {idx + 1}
                            </td>
                            {queryResult.columns.map((col) => {
                              const val = row[col.name];
                              const isNull = val === null || val === undefined;
                              const isNum = typeof val === 'number';
                              return (
                                <td
                                  key={col.name}
                                  className={`px-3 py-2 max-w-[320px] truncate border-r border-neutral-200/70 dark:border-white/[0.06] last:border-r-0 font-mono-code text-[12px] ${
                                    isNull
                                      ? 'text-neutral-400 dark:text-neutral-600 italic'
                                      : isNum
                                      ? 'tabular-nums text-neutral-900 dark:text-neutral-100'
                                      : 'text-neutral-800 dark:text-neutral-200'
                                  }`}
                                  title={isNull ? 'NULL' : String(val)}
                                >
                                  {isNull ? 'NULL' : String(val)}
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
