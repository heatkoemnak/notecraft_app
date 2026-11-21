import React, { useMemo, useState } from 'react';
import {
  AlertCircle,
  BookOpen,
  Check,
  Database,
  Download,
  FileText,
  FolderGit2,
  History,
  Layers,
  Loader2,
  Plus,
  ScanSearch,
  Search,
  ShieldCheck,
  Sparkles,
  Trash2,
  Workflow,
  X,
} from 'lucide-react';
import { buildMaqsuStarterKnowledgeTemplates } from '../data/erpStarterKnowledge';
import {
  ErpWorkspaceScanResult,
  KNOWLEDGE_CATEGORY_META,
  KnowledgeCategory,
  KnowledgeEntry,
  RetrievedKnowledgeItem,
} from '../types/knowledge';
import type { NoteDocument } from '../types/notes';
import type { StorageBackendMode } from '../utils/authClient';
import {
  buildKnowledgeEntriesFromErpScan,
  deleteKnowledgeEntry,
  loadNotesForKnowledgeImport,
  saveKnowledgeEntriesBatch,
  saveKnowledgeEntry,
  testKnowledgeRetrieval,
} from '../utils/knowledgeClient';

interface KnowledgeTrainingModalProps {
  open: boolean;
  storageMode: StorageBackendMode;
  userId: string;
  currentRemotePath: string;
  entries: KnowledgeEntry[];
  onEntriesChanged: (nextEntries: KnowledgeEntry[]) => void;
  onScanErpWorkspace?: (rootPath?: string) => Promise<ErpWorkspaceScanResult>;
  onClose: () => void;
}

const ALL_CATEGORIES: KnowledgeCategory[] = [
  'project_structure',
  'database_structure',
  'business_logic',
  'development_rules',
  'development_history',
];

function getCategoryIcon(category: KnowledgeCategory) {
  switch (category) {
    case 'project_structure':
      return <FolderGit2 className="w-3.5 h-3.5 text-sky-400 shrink-0" />;
    case 'database_structure':
      return <Database className="w-3.5 h-3.5 text-purple-400 shrink-0" />;
    case 'business_logic':
      return <Workflow className="w-3.5 h-3.5 text-emerald-400 shrink-0" />;
    case 'development_rules':
      return <ShieldCheck className="w-3.5 h-3.5 text-amber-400 shrink-0" />;
    case 'development_history':
      return <History className="w-3.5 h-3.5 text-rose-400 shrink-0" />;
  }
}

interface EditorFormState {
  id: string;
  title: string;
  category: KnowledgeCategory;
  systemName: string;
  moduleName: string;
  modelsText: string;
  filePathsText: string;
  tagsText: string;
  summary: string;
  content: string;
  enabled: boolean;
  sourceType: KnowledgeEntry['sourceType'];
  workspaceRoot?: string;
  createdAt: number;
}

function emptyFormState(workspaceRoot?: string): EditorFormState {
  return {
    id: '',
    title: '',
    category: 'business_logic',
    systemName: 'MAQSU ERP',
    moduleName: '',
    modelsText: '',
    filePathsText: '',
    tagsText: '',
    summary: '',
    content: '',
    enabled: true,
    sourceType: 'manual',
    workspaceRoot: workspaceRoot || undefined,
    createdAt: Date.now(),
  };
}

function entryToFormState(entry: KnowledgeEntry): EditorFormState {
  return {
    id: entry.id,
    title: entry.title,
    category: entry.category,
    systemName: entry.systemName || 'MAQSU ERP',
    moduleName: entry.moduleName || '',
    modelsText: (entry.models || []).join(', '),
    filePathsText: (entry.filePaths || []).join(', '),
    tagsText: (entry.tags || []).join(', '),
    summary: entry.summary || '',
    content: entry.content || '',
    enabled: entry.enabled,
    sourceType: entry.sourceType,
    workspaceRoot: entry.workspaceRoot,
    createdAt: entry.createdAt,
  };
}

function splitCommaList(raw: string): string[] {
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export function KnowledgeTrainingModal({
  open,
  storageMode,
  userId,
  currentRemotePath,
  entries,
  onEntriesChanged,
  onScanErpWorkspace,
  onClose,
}: KnowledgeTrainingModalProps) {
  const [selectedCategory, setSelectedCategory] = useState<KnowledgeCategory | 'all'>('all');
  const [filterText, setFilterText] = useState('');
  const [selectedEntryId, setSelectedEntryId] = useState<string | null>(
    entries[0]?.id ?? null
  );
  const [editingForm, setEditingForm] = useState<EditorFormState | null>(null);

  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [statusNotice, setStatusNotice] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Import from Notes state
  const [notesPickerOpen, setNotesPickerOpen] = useState(false);
  const [availableNotes, setAvailableNotes] = useState<NoteDocument[]>([]);
  const [selectedNoteIds, setSelectedNoteIds] = useState<Record<string, boolean>>({});
  const [importCategory, setImportCategory] = useState<KnowledgeCategory>('business_logic');

  // Retrieval testing state
  const [testQuery, setTestQuery] = useState(
    'Add a new field for Vehicle Service in MAQSU ERP'
  );
  const [testResults, setTestResults] = useState<RetrievedKnowledgeItem[] | null>(null);
  const [testingRetrieval, setTestingRetrieval] = useState(false);

  const countsByCategory = useMemo(() => {
    const counts: Record<KnowledgeCategory, number> = {
      project_structure: 0,
      database_structure: 0,
      business_logic: 0,
      development_rules: 0,
      development_history: 0,
    };
    for (const entry of entries) {
      if (counts[entry.category] !== undefined) {
        counts[entry.category] += 1;
      }
    }
    return counts;
  }, [entries]);

  const filteredEntries = useMemo(() => {
    const q = filterText.trim().toLowerCase();
    return entries.filter((entry) => {
      if (selectedCategory !== 'all' && entry.category !== selectedCategory) return false;
      if (!q) return true;
      const hay = [
        entry.title,
        entry.summary,
        entry.moduleName || '',
        ...(entry.models || []),
        ...(entry.tags || []),
        ...(entry.filePaths || []),
        entry.content.slice(0, 600),
      ]
        .join(' ')
        .toLowerCase();
      return hay.includes(q);
    });
  }, [entries, selectedCategory, filterText]);

  const activeEntry = useMemo(
    () =>
      filteredEntries.find((e) => e.id === selectedEntryId) ||
      entries.find((e) => e.id === selectedEntryId) ||
      filteredEntries[0] ||
      null,
    [filteredEntries, entries, selectedEntryId]
  );

  if (!open) return null;

  const mergeUpsertedEntries = (upserted: KnowledgeEntry[]) => {
    const map = new Map<string, KnowledgeEntry>(entries.map((e) => [e.id, e]));
    for (const item of upserted) {
      map.set(item.id, item);
    }
    const next = Array.from(map.values()).sort((a, b) => b.updatedAt - a.updatedAt);
    onEntriesChanged(next);
    if (upserted[0]) {
      setSelectedEntryId(upserted[0].id);
    }
  };

  const handleLoadStarterTemplates = async () => {
    setErrorMsg(null);
    setStatusNotice(null);
    setBusyAction('starters');
    try {
      const templates = buildMaqsuStarterKnowledgeTemplates();
      const saved = await saveKnowledgeEntriesBatch(storageMode, userId, templates);
      mergeUpsertedEntries(saved);
      setStatusNotice(`Loaded ${saved.length} MAQSU ERP starter knowledge blueprints.`);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to load starter templates.');
    } finally {
      setBusyAction(null);
    }
  };

  const handleScanRemoteWorkspace = async () => {
    if (!onScanErpWorkspace) {
      setErrorMsg('Connect to an SSH repository first to run the live ERP workspace scan.');
      return;
    }
    setErrorMsg(null);
    setStatusNotice(null);
    setBusyAction('scan');
    try {
      const scan = await onScanErpWorkspace(currentRemotePath || '~');
      const generated = buildKnowledgeEntriesFromErpScan(scan);
      if (generated.length === 0) {
        setStatusNotice(`Scanned ${scan.rootPath}, but no Python modules or manifests were found.`);
        return;
      }
      const saved = await saveKnowledgeEntriesBatch(storageMode, userId, generated);
      mergeUpsertedEntries(saved);
      setStatusNotice(
        `Scanned ${scan.rootPath}: indexed ${scan.modules.length} modules, ${scan.models.length} ORM models, ${scan.views.length} XML views, ${scan.accessRules.length} ACLs, and ${scan.recentCommits.length} Git commits (${saved.length} knowledge docs saved).`
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Live ERP workspace scan failed.');
    } finally {
      setBusyAction(null);
    }
  };

  const handleOpenNotesPicker = async () => {
    setErrorMsg(null);
    setBusyAction('load-notes');
    try {
      const notes = await loadNotesForKnowledgeImport(storageMode, userId);
      setAvailableNotes(notes);
      setSelectedNoteIds({});
      setNotesPickerOpen(true);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to load NoteCraft notes.');
    } finally {
      setBusyAction(null);
    }
  };

  const handleImportSelectedNotes = async () => {
    const picked = availableNotes.filter((n) => selectedNoteIds[n.id]);
    if (picked.length === 0) return;
    setErrorMsg(null);
    setBusyAction('import-notes');
    try {
      const now = Date.now();
      const newEntries: KnowledgeEntry[] = picked.map((note) => {
        const plainContent = (note.content || '').trim();
        const firstLine =
          plainContent
            .split('\n')
            .map((l) => l.replace(/^#+\s*/, '').trim())
            .find(Boolean) || note.title;
        return {
          id: `note-${note.id}`,
          systemName: 'MAQSU ERP',
          category: importCategory,
          title: note.title || 'Imported Note',
          summary: firstLine.slice(0, 220),
          content: plainContent || note.title,
          tags: ['note-import', KNOWLEDGE_CATEGORY_META[importCategory].shortLabel.toLowerCase()],
          sourceType: 'note-import',
          workspaceRoot: currentRemotePath || undefined,
          enabled: true,
          createdAt: now,
          updatedAt: now,
        };
      });
      const saved = await saveKnowledgeEntriesBatch(storageMode, userId, newEntries);
      mergeUpsertedEntries(saved);
      setNotesPickerOpen(false);
      setStatusNotice(`Imported ${saved.length} note${saved.length === 1 ? '' : 's'} into ${KNOWLEDGE_CATEGORY_META[importCategory].label}.`);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to import notes.');
    } finally {
      setBusyAction(null);
    }
  };

  const handleSaveForm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingForm) return;
    if (!editingForm.title.trim() || !editingForm.content.trim()) {
      setErrorMsg('Title and Knowledge Content are required.');
      return;
    }
    setErrorMsg(null);
    setBusyAction('save-entry');
    try {
      const now = Date.now();
      const payload: KnowledgeEntry = {
        id: editingForm.id || `kb-${now}-${Math.random().toString(36).slice(2, 7)}`,
        systemName: editingForm.systemName.trim() || 'MAQSU ERP',
        category: editingForm.category,
        title: editingForm.title.trim(),
        summary:
          editingForm.summary.trim() ||
          editingForm.content.trim().split('\n')[0].replace(/^#+\s*/, '').slice(0, 220),
        content: editingForm.content.trim(),
        tags: splitCommaList(editingForm.tagsText),
        moduleName: editingForm.moduleName.trim() || undefined,
        models: splitCommaList(editingForm.modelsText),
        filePaths: splitCommaList(editingForm.filePathsText),
        sourceType: editingForm.sourceType || 'manual',
        workspaceRoot: editingForm.workspaceRoot || currentRemotePath || undefined,
        enabled: editingForm.enabled,
        createdAt: editingForm.createdAt || now,
        updatedAt: now,
      };
      const saved = await saveKnowledgeEntry(storageMode, userId, payload);
      mergeUpsertedEntries([saved]);
      setEditingForm(null);
      setStatusNotice(`Saved "${saved.title}".`);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to save entry.');
    } finally {
      setBusyAction(null);
    }
  };

  const handleToggleEnabled = async (entry: KnowledgeEntry) => {
    setErrorMsg(null);
    try {
      const saved = await saveKnowledgeEntry(storageMode, userId, {
        ...entry,
        enabled: !entry.enabled,
        updatedAt: Date.now(),
      });
      mergeUpsertedEntries([saved]);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to update entry status.');
    }
  };

  const handleDeleteEntry = async (entry: KnowledgeEntry) => {
    setErrorMsg(null);
    setBusyAction(`del-${entry.id}`);
    try {
      await deleteKnowledgeEntry(storageMode, userId, entry.id);
      const next = entries.filter((item) => item.id !== entry.id);
      onEntriesChanged(next);
      if (selectedEntryId === entry.id) {
        setSelectedEntryId(next[0]?.id ?? null);
      }
      if (editingForm?.id === entry.id) {
        setEditingForm(null);
      }
      setStatusNotice(`Removed "${entry.title}".`);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to delete entry.');
    } finally {
      setBusyAction(null);
    }
  };

  const handleTestRetrieval = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!testQuery.trim()) return;
    setErrorMsg(null);
    setTestingRetrieval(true);
    try {
      const res = await testKnowledgeRetrieval(
        testQuery.trim(),
        entries.filter((item) => item.enabled),
        currentRemotePath || undefined
      );
      setTestResults(res.retrieved);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Retrieval test failed.');
    } finally {
      setTestingRetrieval(false);
    }
  };

  const enabledCount = entries.filter((e) => e.enabled).length;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="MAQSU ERP AI Knowledge & Training"
      className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-center justify-center p-3 sm:p-5"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-6xl h-[88vh] max-h-[820px] rounded-2xl border border-white/15 bg-[#121218] text-neutral-100 shadow-2xl flex flex-col overflow-hidden">
        {/* Top Header */}
        <div className="shrink-0 px-4 py-3 border-b border-white/[0.08] bg-[#161620] flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-blue-500/15 border border-blue-500/30 flex items-center justify-center shrink-0">
              <BookOpen className="w-4 h-4 text-blue-400" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h2 className="text-[14px] font-semibold text-white truncate">
                  MAQSU ERP Knowledge &amp; AI Training
                </h2>
                <span className="text-[11px] font-mono-code text-neutral-400">
                  {enabledCount}/{entries.length} active
                </span>
              </div>
              <p className="text-[11.5px] text-neutral-400 truncate">
                Structured system memory &amp; retrieval for models, business logic, views, ACLs, rules, and Git history
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              disabled={Boolean(busyAction) || !onScanErpWorkspace}
              onClick={() => void handleScanRemoteWorkspace()}
              title={
                onScanErpWorkspace
                  ? `Scan remote workspace (${currentRemotePath || '~'}) for __manifest__.py, ORM models, XML views, ACLs, and Git log`
                  : 'Connect to SSH workspace to scan live ERP codebase'
              }
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-45 text-white text-[11.5px] font-medium cursor-pointer"
            >
              {busyAction === 'scan' ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <ScanSearch className="w-3.5 h-3.5" />
              )}
              <span>Scan SSH ERP Repo</span>
            </button>

            <button
              type="button"
              disabled={Boolean(busyAction)}
              onClick={() => void handleOpenNotesPicker()}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-white/12 bg-white/[0.04] hover:bg-white/[0.09] disabled:opacity-45 text-neutral-200 text-[11.5px] font-medium cursor-pointer"
            >
              {busyAction === 'load-notes' ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Download className="w-3.5 h-3.5 text-sky-400" />
              )}
              <span>Import Notes</span>
            </button>

            <button
              type="button"
              disabled={Boolean(busyAction)}
              onClick={() => void handleLoadStarterTemplates()}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-white/12 bg-white/[0.04] hover:bg-white/[0.09] disabled:opacity-45 text-neutral-200 text-[11.5px] font-medium cursor-pointer"
            >
              {busyAction === 'starters' ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Sparkles className="w-3.5 h-3.5 text-amber-400" />
              )}
              <span>Load MAQSU Starters</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setEditingForm(emptyFormState(currentRemotePath));
                setNotesPickerOpen(false);
              }}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-[11.5px] font-medium cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Add Knowledge</span>
            </button>

            <button
              type="button"
              onClick={onClose}
              aria-label="Close knowledge modal"
              className="p-1.5 rounded-lg text-neutral-400 hover:text-white hover:bg-white/10 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Status / Error Banner */}
        {(statusNotice || errorMsg) && (
          <div
            className={`shrink-0 px-4 py-2 border-b text-[12px] flex items-center justify-between gap-2 ${
              errorMsg
                ? 'border-red-500/30 bg-red-500/10 text-red-200'
                : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200'
            }`}
          >
            <div className="flex items-center gap-2 min-w-0">
              {errorMsg ? (
                <AlertCircle className="w-4 h-4 shrink-0 text-red-400" />
              ) : (
                <Check className="w-4 h-4 shrink-0 text-emerald-400" />
              )}
              <span className="truncate">{errorMsg || statusNotice}</span>
            </div>
            <button
              type="button"
              onClick={() => {
                setErrorMsg(null);
                setStatusNotice(null);
              }}
              className="p-0.5 rounded hover:bg-white/10 cursor-pointer shrink-0"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Category Filter Tabs + Search */}
        <div className="shrink-0 px-4 py-2.5 border-b border-white/[0.08] bg-[#14141c] flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1 overflow-x-auto pb-0.5">
            <button
              type="button"
              onClick={() => setSelectedCategory('all')}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11.5px] font-medium cursor-pointer shrink-0 ${
                selectedCategory === 'all'
                  ? 'bg-blue-600 text-white'
                  : 'bg-white/[0.04] text-neutral-300 hover:bg-white/[0.08]'
              }`}
            >
              <Layers className="w-3.5 h-3.5" />
              <span>All ({entries.length})</span>
            </button>
            {ALL_CATEGORIES.map((cat) => {
              const meta = KNOWLEDGE_CATEGORY_META[cat];
              const isActive = selectedCategory === cat;
              return (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setSelectedCategory(cat)}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11.5px] font-medium cursor-pointer shrink-0 ${
                    isActive
                      ? 'bg-blue-600 text-white'
                      : 'bg-white/[0.04] text-neutral-300 hover:bg-white/[0.08]'
                  }`}
                >
                  {getCategoryIcon(cat)}
                  <span>{meta.shortLabel}</span>
                  <span className="text-[10.5px] opacity-75">({countsByCategory[cat]})</span>
                </button>
              );
            })}
          </div>

          <div className="relative w-full sm:w-64">
            <Search className="w-3.5 h-3.5 text-neutral-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={filterText}
              onChange={(e) => setFilterText(e.target.value)}
              placeholder="Filter models, modules, rules..."
              className="w-full pl-8 pr-2.5 py-1 rounded-md border border-white/12 bg-[#0c0c10] text-[12px] text-neutral-100 placeholder:text-neutral-500 focus:outline-none focus:border-blue-500"
            />
          </div>
        </div>

        {/* Retrieval Test Bar */}
        <form
          onSubmit={(e) => void handleTestRetrieval(e)}
          className="shrink-0 px-4 py-2 border-b border-white/[0.08] bg-[#101016] flex flex-wrap items-center gap-2"
        >
          <span className="text-[11px] font-semibold uppercase tracking-wider text-neutral-400 shrink-0">
            Test Retrieval:
          </span>
          <input
            type="text"
            value={testQuery}
            onChange={(e) => setTestQuery(e.target.value)}
            placeholder="e.g. Add a new field for Vehicle Service in MAQSU ERP"
            className="flex-1 min-w-[220px] px-2.5 py-1 rounded-md border border-white/12 bg-[#0c0c10] text-[12px] text-neutral-100 focus:outline-none focus:border-blue-500"
          />
          <button
            type="submit"
            disabled={testingRetrieval || !testQuery.trim()}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-blue-500/40 bg-blue-500/15 hover:bg-blue-500/25 disabled:opacity-45 text-blue-200 text-[11.5px] font-medium cursor-pointer"
          >
            {testingRetrieval ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Search className="w-3.5 h-3.5" />
            )}
            <span>Preview Context</span>
          </button>
          {testResults !== null && (
            <button
              type="button"
              onClick={() => setTestResults(null)}
              className="text-[11px] text-neutral-400 hover:text-white cursor-pointer"
            >
              Clear
            </button>
          )}
        </form>

        {testResults !== null && (
          <div className="shrink-0 max-h-40 overflow-y-auto px-4 py-2.5 border-b border-blue-500/25 bg-[#0e131d] space-y-1.5">
            <div className="text-[11px] font-medium text-blue-200">
              Top Retrieved Context ({testResults.length} docs injected for this prompt):
            </div>
            {testResults.length === 0 ? (
              <div className="text-[11.5px] text-neutral-400">
                No active knowledge entries matched. Load MAQSU Starters or Scan your SSH ERP repository first.
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-1.5">
                {testResults.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      setSelectedEntryId(item.id);
                      setEditingForm(null);
                    }}
                    className="text-left px-2.5 py-1.5 rounded-lg border border-white/10 bg-[#141926] hover:border-blue-400/50 cursor-pointer space-y-0.5"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[11.5px] font-medium text-white truncate">
                        {item.title}
                      </span>
                      <span className="text-[10.5px] font-mono-code text-blue-300 shrink-0">
                        score {item.score}
                      </span>
                    </div>
                    <div className="text-[10.5px] text-neutral-400 truncate">
                      {KNOWLEDGE_CATEGORY_META[item.category]?.label} · {item.reasons.join(', ')}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Main Body: Notes Picker OR Split List + Detail/Editor */}
        {notesPickerOpen ? (
          <div className="flex-1 min-h-0 flex flex-col p-4 overflow-hidden space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-[13px] font-semibold text-white">
                  Import Documentation from Your Notes
                </h3>
                <p className="text-[11.5px] text-neutral-400">
                  Select ERP specs, architecture notes, rules, or incident postmortems to train the AI agent.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <label className="text-[11.5px] text-neutral-300">
                  Target Category:
                  <select
                    value={importCategory}
                    onChange={(e) => setImportCategory(e.target.value as KnowledgeCategory)}
                    className="ml-2 px-2 py-1 rounded border border-white/15 bg-[#0c0c10] text-neutral-100 text-[12px]"
                  >
                    {ALL_CATEGORIES.map((cat) => (
                      <option key={cat} value={cat}>
                        {KNOWLEDGE_CATEGORY_META[cat].label}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  type="button"
                  onClick={() => setNotesPickerOpen(false)}
                  className="px-2.5 py-1 rounded border border-white/12 text-[12px] text-neutral-300 hover:bg-white/10 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={
                    busyAction === 'import-notes' ||
                    Object.values(selectedNoteIds).filter(Boolean).length === 0
                  }
                  onClick={() => void handleImportSelectedNotes()}
                  className="inline-flex items-center gap-1 px-3 py-1 rounded bg-blue-600 hover:bg-blue-700 disabled:opacity-45 text-white text-[12px] font-medium cursor-pointer"
                >
                  {busyAction === 'import-notes' && (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  )}
                  <span>
                    Import ({Object.values(selectedNoteIds).filter(Boolean).length})
                  </span>
                </button>
              </div>
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto grid grid-cols-1 md:grid-cols-2 gap-2 pr-1">
              {availableNotes.length === 0 ? (
                <div className="text-[12px] text-neutral-400">No notes found in your workspace.</div>
              ) : (
                availableNotes.map((note) => {
                  const checked = Boolean(selectedNoteIds[note.id]);
                  return (
                    <label
                      key={note.id}
                      className={`p-3 rounded-xl border cursor-pointer flex items-start gap-2.5 transition-colors ${
                        checked
                          ? 'border-blue-500/60 bg-blue-500/10'
                          : 'border-white/10 bg-[#161620] hover:border-white/20'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) =>
                          setSelectedNoteIds((prev) => ({
                            ...prev,
                            [note.id]: e.target.checked,
                          }))
                        }
                        className="mt-1 accent-blue-500"
                      />
                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="text-[12.5px] font-medium text-white truncate">
                          {note.title || 'Untitled Note'}
                        </div>
                        <p className="text-[11px] text-neutral-400 line-clamp-2">
                          {(note.content || '').slice(0, 180)}
                        </p>
                      </div>
                    </label>
                  );
                })
              )}
            </div>
          </div>
        ) : (
          <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-12 overflow-hidden">
            {/* Left List */}
            <div className="lg:col-span-5 border-b lg:border-b-0 lg:border-r border-white/[0.08] min-h-0 overflow-y-auto p-3 space-y-1.5 bg-[#0f0f15]">
              {filteredEntries.length === 0 ? (
                <div className="rounded-xl border border-white/[0.08] bg-[#15151e] p-4 text-center space-y-2.5">
                  <FileText className="w-6 h-6 text-neutral-500 mx-auto" />
                  <div className="text-[12.5px] font-medium text-neutral-200">
                    No MAQSU ERP knowledge entries yet
                  </div>
                  <p className="text-[11.5px] text-neutral-400 leading-relaxed">
                    Click <strong className="text-neutral-200">Scan SSH ERP Repo</strong> to auto-index modules, ORM models, XML views, ACLs &amp; Git history, or load the MAQSU starter blueprints.
                  </p>
                  <button
                    type="button"
                    onClick={() => void handleLoadStarterTemplates()}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-[12px] font-medium cursor-pointer"
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                    <span>Load MAQSU Starters</span>
                  </button>
                </div>
              ) : (
                filteredEntries.map((entry) => {
                  const isSelected = !editingForm && activeEntry?.id === entry.id;
                  const meta = KNOWLEDGE_CATEGORY_META[entry.category];
                  return (
                    <div
                      key={entry.id}
                      onClick={() => {
                        setSelectedEntryId(entry.id);
                        setEditingForm(null);
                      }}
                      className={`p-2.5 rounded-xl border cursor-pointer transition-colors space-y-1 ${
                        isSelected
                          ? 'border-blue-500/60 bg-blue-500/12'
                          : 'border-white/[0.07] bg-[#15151d] hover:border-white/20'
                      } ${!entry.enabled ? 'opacity-60' : ''}`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-1.5 min-w-0">
                          {getCategoryIcon(entry.category)}
                          <span className="text-[12px] font-semibold text-white truncate">
                            {entry.title}
                          </span>
                        </div>
                        <div
                          className="flex items-center gap-1 shrink-0"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <input
                            type="checkbox"
                            checked={entry.enabled}
                            onChange={() => void handleToggleEnabled(entry)}
                            title={entry.enabled ? 'Enabled in AI retrieval' : 'Disabled'}
                            className="accent-emerald-500 cursor-pointer"
                          />
                          <button
                            type="button"
                            disabled={busyAction === `del-${entry.id}`}
                            onClick={() => void handleDeleteEntry(entry)}
                            title="Delete knowledge entry"
                            className="p-0.5 rounded text-neutral-500 hover:text-red-400 cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>

                      <p className="text-[11px] text-neutral-400 line-clamp-2">
                        {entry.summary || entry.content.slice(0, 140)}
                      </p>

                      <div className="flex flex-wrap items-center gap-1.5 text-[10px] text-neutral-400">
                        <span className={`px-1.5 py-px rounded border ${meta.accentClass}`}>
                          {meta.shortLabel}
                        </span>
                        {entry.moduleName && (
                          <span className="font-mono-code text-neutral-300">
                            mod:{entry.moduleName}
                          </span>
                        )}
                        {entry.models && entry.models.length > 0 && (
                          <span className="font-mono-code text-neutral-400 truncate max-w-[180px]">
                            {entry.models.slice(0, 2).join(', ')}
                            {entry.models.length > 2 ? ` +${entry.models.length - 2}` : ''}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* Right Detail or Editor */}
            <div className="lg:col-span-7 min-h-0 overflow-y-auto p-4 bg-[#121218]">
              {editingForm ? (
                <form onSubmit={(e) => void handleSaveForm(e)} className="space-y-3">
                  <div className="flex items-center justify-between gap-2 pb-2 border-b border-white/[0.08]">
                    <h3 className="text-[13px] font-semibold text-white">
                      {editingForm.id ? 'Edit Knowledge Document' : 'New ERP Knowledge Document'}
                    </h3>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setEditingForm(null)}
                        className="px-2.5 py-1 rounded border border-white/12 text-[11.5px] text-neutral-300 hover:bg-white/10 cursor-pointer"
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        disabled={busyAction === 'save-entry'}
                        className="inline-flex items-center gap-1 px-3 py-1 rounded bg-blue-600 hover:bg-blue-700 disabled:opacity-45 text-white text-[11.5px] font-medium cursor-pointer"
                      >
                        {busyAction === 'save-entry' && (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        )}
                        <span>Save Knowledge</span>
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    <label className="space-y-1 text-[11.5px] text-neutral-300">
                      <span>Title *</span>
                      <input
                        type="text"
                        required
                        value={editingForm.title}
                        onChange={(e) =>
                          setEditingForm((f) => (f ? { ...f, title: e.target.value } : f))
                        }
                        placeholder="e.g. Vehicle Service Visit Model & Sales Integration"
                        className="w-full px-2.5 py-1.5 rounded-lg border border-white/12 bg-[#0c0c10] text-neutral-100 text-[12px] focus:outline-none focus:border-blue-500"
                      />
                    </label>

                    <label className="space-y-1 text-[11.5px] text-neutral-300">
                      <span>Category *</span>
                      <select
                        value={editingForm.category}
                        onChange={(e) =>
                          setEditingForm((f) =>
                            f ? { ...f, category: e.target.value as KnowledgeCategory } : f
                          )
                        }
                        className="w-full px-2.5 py-1.5 rounded-lg border border-white/12 bg-[#0c0c10] text-neutral-100 text-[12px] focus:outline-none focus:border-blue-500"
                      >
                        {ALL_CATEGORIES.map((cat) => (
                          <option key={cat} value={cat}>
                            {KNOWLEDGE_CATEGORY_META[cat].label}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    <label className="space-y-1 text-[11.5px] text-neutral-300">
                      <span>Module Name</span>
                      <input
                        type="text"
                        value={editingForm.moduleName}
                        onChange={(e) =>
                          setEditingForm((f) => (f ? { ...f, moduleName: e.target.value } : f))
                        }
                        placeholder="e.g. maqsu_vehicle_service"
                        className="w-full px-2.5 py-1.5 rounded-lg border border-white/12 bg-[#0c0c10] text-neutral-100 font-mono-code text-[12px] focus:outline-none focus:border-blue-500"
                      />
                    </label>

                    <label className="space-y-1 text-[11.5px] text-neutral-300">
                      <span>ERP Models (comma-separated)</span>
                      <input
                        type="text"
                        value={editingForm.modelsText}
                        onChange={(e) =>
                          setEditingForm((f) => (f ? { ...f, modelsText: e.target.value } : f))
                        }
                        placeholder="vehicle.visit, fleet.vehicle, res.partner, sale.order"
                        className="w-full px-2.5 py-1.5 rounded-lg border border-white/12 bg-[#0c0c10] text-neutral-100 font-mono-code text-[12px] focus:outline-none focus:border-blue-500"
                      />
                    </label>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    <label className="space-y-1 text-[11.5px] text-neutral-300">
                      <span>Related File Paths (comma-separated)</span>
                      <input
                        type="text"
                        value={editingForm.filePathsText}
                        onChange={(e) =>
                          setEditingForm((f) => (f ? { ...f, filePathsText: e.target.value } : f))
                        }
                        placeholder="models/vehicle_visit.py, views/vehicle_visit_views.xml"
                        className="w-full px-2.5 py-1.5 rounded-lg border border-white/12 bg-[#0c0c10] text-neutral-100 font-mono-code text-[12px] focus:outline-none focus:border-blue-500"
                      />
                    </label>

                    <label className="space-y-1 text-[11.5px] text-neutral-300">
                      <span>Tags (comma-separated)</span>
                      <input
                        type="text"
                        value={editingForm.tagsText}
                        onChange={(e) =>
                          setEditingForm((f) => (f ? { ...f, tagsText: e.target.value } : f))
                        }
                        placeholder="vehicle service, inventory, sale.order"
                        className="w-full px-2.5 py-1.5 rounded-lg border border-white/12 bg-[#0c0c10] text-neutral-100 text-[12px] focus:outline-none focus:border-blue-500"
                      />
                    </label>
                  </div>

                  <label className="block space-y-1 text-[11.5px] text-neutral-300">
                    <span>One-line Summary</span>
                    <input
                      type="text"
                      value={editingForm.summary}
                      onChange={(e) =>
                        setEditingForm((f) => (f ? { ...f, summary: e.target.value } : f))
                      }
                      placeholder="Short summary for the system knowledge catalog"
                      className="w-full px-2.5 py-1.5 rounded-lg border border-white/12 bg-[#0c0c10] text-neutral-100 text-[12px] focus:outline-none focus:border-blue-500"
                    />
                  </label>

                  <label className="block space-y-1 text-[11.5px] text-neutral-300">
                    <span>Detailed Knowledge (Markdown) *</span>
                    <textarea
                      required
                      rows={11}
                      value={editingForm.content}
                      onChange={(e) =>
                        setEditingForm((f) => (f ? { ...f, content: e.target.value } : f))
                      }
                      placeholder="Document models, fields, business rules, GitLab branches, ACLs, or anti-patterns..."
                      className="w-full px-3 py-2 rounded-lg border border-white/12 bg-[#0c0c10] text-neutral-100 font-mono-code text-[12px] leading-relaxed focus:outline-none focus:border-blue-500"
                    />
                  </label>

                  <label className="inline-flex items-center gap-2 text-[12px] text-neutral-300 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={editingForm.enabled}
                      onChange={(e) =>
                        setEditingForm((f) => (f ? { ...f, enabled: e.target.checked } : f))
                      }
                      className="accent-emerald-500"
                    />
                    <span>Include in AI Agent knowledge retrieval</span>
                  </label>
                </form>
              ) : activeEntry ? (
                <div className="space-y-3">
                  <div className="flex flex-wrap items-start justify-between gap-2 pb-2.5 border-b border-white/[0.08]">
                    <div className="space-y-1 min-w-0">
                      <div className="flex items-center gap-2">
                        {getCategoryIcon(activeEntry.category)}
                        <h3 className="text-[14px] font-semibold text-white">
                          {activeEntry.title}
                        </h3>
                      </div>
                      <div className="flex flex-wrap items-center gap-2 text-[11px] text-neutral-400">
                        <span
                          className={`px-1.5 py-px rounded border ${
                            KNOWLEDGE_CATEGORY_META[activeEntry.category].accentClass
                          }`}
                        >
                          {KNOWLEDGE_CATEGORY_META[activeEntry.category].label}
                        </span>
                        <span>source: {activeEntry.sourceType}</span>
                        {activeEntry.moduleName && (
                          <span className="font-mono-code text-neutral-200">
                            module: {activeEntry.moduleName}
                          </span>
                        )}
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => setEditingForm(entryToFormState(activeEntry))}
                      className="px-2.5 py-1 rounded-lg border border-white/15 bg-white/[0.05] hover:bg-white/[0.1] text-neutral-100 text-[11.5px] font-medium cursor-pointer shrink-0"
                    >
                      Edit Document
                    </button>
                  </div>

                  {activeEntry.models && activeEntry.models.length > 0 && (
                    <div className="text-[11.5px] text-neutral-300">
                      <span className="text-neutral-500 mr-1.5">Models:</span>
                      <span className="font-mono-code text-purple-300">
                        {activeEntry.models.join(', ')}
                      </span>
                    </div>
                  )}

                  {activeEntry.filePaths && activeEntry.filePaths.length > 0 && (
                    <div className="text-[11.5px] text-neutral-300 break-all">
                      <span className="text-neutral-500 mr-1.5">Files:</span>
                      <span className="font-mono-code text-sky-300">
                        {activeEntry.filePaths.join(', ')}
                      </span>
                    </div>
                  )}

                  <pre className="m-0 p-3 rounded-xl border border-white/[0.08] bg-[#0c0c10] text-[12px] font-mono-code text-neutral-200 whitespace-pre-wrap break-words leading-relaxed">
                    {activeEntry.content}
                  </pre>
                </div>
              ) : (
                <div className="h-full flex items-center justify-center text-[12.5px] text-neutral-500">
                  Select a knowledge entry or click Add Knowledge to train the AI agent on MAQSU ERP.
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
