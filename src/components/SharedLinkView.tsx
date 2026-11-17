import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  BookmarkPlus,
  Check,
  Copy,
  Download,
  Eye,
  FileCode2,
  FileText,
  Link2Off,
  Loader2,
  Moon,
  Pencil,
  Printer,
  Sun,
} from 'lucide-react';
import { AuthUser, NoteDocument, SharedLinkNote } from '../types/notes';
import { StorageBackendMode } from '../utils/authClient';
import {
  DEFAULT_PDF_EXPORT_OPTIONS,
  exportNoteAsDocx,
  exportNoteAsMarkdown,
  exportNoteAsPdf,
} from '../utils/documentExporter';
import { formatRelativeDate, getDocumentStats, toggleTaskCheckbox } from '../utils/markdown';
import {
  copyTextToClipboard,
  fetchNoteByShareToken,
  updateNoteByShareToken,
} from '../utils/shareClient';
import { LiveDocumentEditor } from './LiveDocumentEditor';
import { MarkdownRenderer } from './MarkdownRenderer';

interface SharedLinkViewProps {
  token: string;
  storageMode: StorageBackendMode;
  theme: 'dark' | 'light';
  currentUser: AuthUser | null;
  onToggleTheme: () => void;
  onExitShareView: () => void;
  onSaveCopy?: (sharedNote: SharedLinkNote) => void;
}

export function SharedLinkView({
  token,
  storageMode,
  theme,
  currentUser,
  onToggleTheme,
  onExitShareView,
  onSaveCopy,
}: SharedLinkViewProps) {
  const [note, setNote] = useState<SharedLinkNote | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [mode, setMode] = useState<'read' | 'edit'>('read');
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [saveError, setSaveError] = useState<string | null>(null);
  const [copiedMarkdown, setCopiedMarkdown] = useState(false);
  const [copiedCopySuccess, setCopiedCopySuccess] = useState(false);
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const [exporting, setExporting] = useState<'pdf' | 'doc' | 'md' | null>(null);

  const exportMenuRef = useRef<HTMLDivElement>(null);
  const saveTimerRef = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    setNote(null);
    setMode('read');

    fetchNoteByShareToken(storageMode, token)
      .then((loaded) => {
        if (cancelled) return;
        setNote(loaded);
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setLoadError(
          err instanceof Error
            ? err.message
            : 'This share link is invalid or has been disabled by the owner.'
        );
        setLoading(false);
      });

    return () => {
      cancelled = true;
      if (saveTimerRef.current) {
        window.clearTimeout(saveTimerRef.current);
      }
    };
  }, [storageMode, token]);

  useEffect(() => {
    if (!exportMenuOpen) return;
    const handlePointerDown = (e: PointerEvent) => {
      if (exportMenuRef.current && !exportMenuRef.current.contains(e.target as Node)) {
        setExportMenuOpen(false);
      }
    };
    window.addEventListener('pointerdown', handlePointerDown);
    return () => window.removeEventListener('pointerdown', handlePointerDown);
  }, [exportMenuOpen]);

  const canEdit = note?.linkAccess === 'edit';

  const stats = useMemo(
    () => getDocumentStats(note?.content ?? ''),
    [note?.content]
  );

  const persistPatch = useCallback(
    (patch: Partial<Pick<NoteDocument, 'title' | 'content'>>) => {
      if (!note || note.linkAccess !== 'edit') return;

      const updatedAt = Date.now();
      setNote((prev) => (prev ? { ...prev, ...patch, updatedAt } : prev));
      setSaveState('saving');
      setSaveError(null);

      if (saveTimerRef.current) {
        window.clearTimeout(saveTimerRef.current);
      }

      saveTimerRef.current = window.setTimeout(async () => {
        saveTimerRef.current = null;
        try {
          await updateNoteByShareToken(storageMode, token, patch, updatedAt);
          setSaveState('saved');
        } catch (err) {
          setSaveState('error');
          setSaveError(err instanceof Error ? err.message : 'Failed to save changes.');
        }
      }, 320);
    },
    [note, storageMode, token]
  );

  const handleToggleCheckbox = (checkboxIndex: number) => {
    if (!note || !canEdit) return;
    const updatedContent = toggleTaskCheckbox(note.content, checkboxIndex);
    if (updatedContent !== note.content) {
      persistPatch({ content: updatedContent });
    }
  };

  const handleCopyMarkdown = async () => {
    if (!note) return;
    const ok = await copyTextToClipboard(note.content);
    if (ok) {
      setCopiedMarkdown(true);
      window.setTimeout(() => setCopiedMarkdown(false), 1800);
    }
  };

  const handleExport = async (format: 'pdf' | 'doc' | 'md') => {
    if (!note) return;
    setExportMenuOpen(false);
    setExporting(format);
    const exportDoc: NoteDocument = {
      id: note.id,
      title: note.title,
      content: note.content,
      folderId: null,
      starred: false,
      createdAt: note.createdAt,
      updatedAt: note.updatedAt,
    };
    try {
      if (format === 'pdf') {
        await exportNoteAsPdf(exportDoc, DEFAULT_PDF_EXPORT_OPTIONS);
      } else if (format === 'doc') {
        await exportNoteAsDocx(exportDoc);
      } else {
        await exportNoteAsMarkdown(exportDoc);
      }
    } finally {
      setExporting(null);
    }
  };

  const handleSaveToWorkspace = () => {
    if (!note || !onSaveCopy) return;
    setCopiedCopySuccess(true);
    onSaveCopy(note);
  };

  return (
    <div className="min-h-screen flex flex-col bg-white dark:bg-[#121214] text-neutral-900 dark:text-[#ececf1]">
      {/* Top Bar */}
      <header className="sticky top-0 z-30 h-14 px-4 sm:px-6 border-b border-neutral-200 dark:border-white/[0.08] bg-white/95 dark:bg-[#121214]/95 backdrop-blur-sm flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <button
            type="button"
            onClick={onExitShareView}
            className="inline-flex items-center gap-2 text-[14px] font-semibold tracking-tight text-neutral-950 dark:text-white hover:text-blue-600 dark:hover:text-blue-400 transition-colors cursor-pointer shrink-0"
          >
            <span className="w-7 h-7 rounded-lg bg-blue-600 text-white flex items-center justify-center shrink-0">
              <FileText className="w-3.5 h-3.5" />
            </span>
            <span className="hidden sm:inline">NoteCraft</span>
          </button>

          {note && (
            <>
              <span className="text-neutral-300 dark:text-neutral-700 select-none">/</span>
              <div className="min-w-0">
                <div className="text-[13.5px] font-medium text-neutral-900 dark:text-neutral-100 truncate">
                  {note.title || 'Untitled Note'}
                </div>
                <div className="text-[11.5px] text-neutral-500 dark:text-neutral-400 truncate">
                  Shared by {note.ownerName || note.ownerEmail} ·{' '}
                  {canEdit ? 'Can edit' : 'Can view'}
                  {saveState === 'saving'
                    ? ' · Saving...'
                    : saveState === 'saved'
                    ? ' · Saved'
                    : ''}
                </div>
              </div>
            </>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {note && canEdit && (
            <div
              role="group"
              aria-label="Document view mode"
              className="inline-flex items-center rounded-lg border border-neutral-200 dark:border-white/10 bg-neutral-100/80 dark:bg-white/[0.04] p-0.5"
            >
              <button
                type="button"
                onClick={() => setMode('read')}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[12px] font-medium transition-colors cursor-pointer whitespace-nowrap ${
                  mode === 'read'
                    ? 'bg-white dark:bg-[#23232a] text-neutral-950 dark:text-white shadow-xs'
                    : 'text-neutral-500 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-200'
                }`}
              >
                <Eye className="w-3.5 h-3.5" />
                <span>Read</span>
              </button>
              <button
                type="button"
                onClick={() => setMode('edit')}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[12px] font-medium transition-colors cursor-pointer whitespace-nowrap ${
                  mode === 'edit'
                    ? 'bg-white dark:bg-[#23232a] text-neutral-950 dark:text-white shadow-xs'
                    : 'text-neutral-500 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-200'
                }`}
              >
                <Pencil className="w-3.5 h-3.5" />
                <span>Edit</span>
              </button>
            </div>
          )}

          {note && (
            <>
              <button
                type="button"
                onClick={handleCopyMarkdown}
                className="hidden md:inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-neutral-200 dark:border-white/10 text-[12.5px] font-medium text-neutral-700 dark:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-white/[0.06] transition-colors cursor-pointer whitespace-nowrap shrink-0"
              >
                {copiedMarkdown ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-emerald-500" />
                    <span>Copied</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5 text-neutral-400" />
                    <span>Copy Markdown</span>
                  </>
                )}
              </button>

              <div className="relative" ref={exportMenuRef}>
                <button
                  type="button"
                  disabled={exporting !== null}
                  onClick={() => setExportMenuOpen((prev) => !prev)}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-neutral-200 dark:border-white/10 text-[12.5px] font-medium text-neutral-700 dark:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-white/[0.06] transition-colors cursor-pointer whitespace-nowrap shrink-0 disabled:opacity-60"
                >
                  <Download className="w-3.5 h-3.5 text-neutral-400" />
                  <span className="hidden sm:inline">
                    {exporting ? `Exporting ${exporting.toUpperCase()}...` : 'Export'}
                  </span>
                </button>

                {exportMenuOpen && (
                  <div className="absolute right-0 mt-1.5 w-44 rounded-xl border border-neutral-200 dark:border-white/10 bg-white dark:bg-[#19191f] shadow-lg py-1 z-40">
                    <button
                      type="button"
                      onClick={() => handleExport('pdf')}
                      className="w-full px-3 py-2 text-left text-[12.5px] text-neutral-800 dark:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-white/[0.06] flex items-center gap-2 cursor-pointer"
                    >
                      <Printer className="w-3.5 h-3.5 text-red-500" />
                      <span>Export PDF</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleExport('doc')}
                      className="w-full px-3 py-2 text-left text-[12.5px] text-neutral-800 dark:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-white/[0.06] flex items-center gap-2 cursor-pointer"
                    >
                      <FileText className="w-3.5 h-3.5 text-blue-500" />
                      <span>Export Word (.docx)</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleExport('md')}
                      className="w-full px-3 py-2 text-left text-[12.5px] text-neutral-800 dark:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-white/[0.06] flex items-center gap-2 cursor-pointer"
                    >
                      <FileCode2 className="w-3.5 h-3.5 text-emerald-500" />
                      <span>Export Markdown (.md)</span>
                    </button>
                  </div>
                )}
              </div>

              {currentUser && onSaveCopy && (
                <button
                  type="button"
                  onClick={handleSaveToWorkspace}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-[12.5px] font-medium transition-colors cursor-pointer whitespace-nowrap shrink-0"
                >
                  {copiedCopySuccess ? (
                    <>
                      <Check className="w-3.5 h-3.5" />
                      <span>Saved</span>
                    </>
                  ) : (
                    <>
                      <BookmarkPlus className="w-3.5 h-3.5" />
                      <span>Save copy</span>
                    </>
                  )}
                </button>
              )}
            </>
          )}

          {!currentUser && (
            <button
              type="button"
              onClick={onExitShareView}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-[12.5px] font-medium transition-colors cursor-pointer whitespace-nowrap shrink-0"
            >
              <span>Open NoteCraft</span>
            </button>
          )}

          <button
            type="button"
            onClick={onToggleTheme}
            aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
            className="p-1.5 rounded-lg border border-neutral-200 dark:border-white/10 text-neutral-600 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-white/[0.06] transition-colors cursor-pointer shrink-0"
          >
            {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto">
        {loading && (
          <div className="min-h-[65vh] flex flex-col items-center justify-center gap-3 px-6 text-neutral-500 dark:text-neutral-400">
            <Loader2 className="w-5 h-5 animate-spin text-blue-500" />
            <span className="text-[13.5px]">Loading shared document...</span>
          </div>
        )}

        {!loading && loadError && (
          <div className="min-h-[65vh] flex items-center justify-center px-6 py-12">
            <div className="max-w-md w-full rounded-2xl border border-neutral-200 dark:border-white/10 bg-neutral-50/70 dark:bg-[#17171b] p-7 text-center space-y-4">
              <div className="w-11 h-11 rounded-xl bg-neutral-200/70 dark:bg-white/[0.06] text-neutral-600 dark:text-neutral-300 flex items-center justify-center mx-auto">
                <Link2Off className="w-5 h-5" />
              </div>
              <div className="space-y-1.5">
                <h1 className="editor-prose-font text-[18px] font-semibold text-neutral-950 dark:text-white">
                  Shared document unavailable
                </h1>
                <p className="text-[13.5px] text-neutral-600 dark:text-neutral-400 leading-relaxed">
                  {loadError}
                </p>
              </div>
              <button
                type="button"
                onClick={onExitShareView}
                className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-[13px] font-medium transition-colors cursor-pointer whitespace-nowrap"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                <span>{currentUser ? 'Back to workspace' : 'Go to NoteCraft'}</span>
              </button>
            </div>
          </div>
        )}

        {!loading && note && (
          <div className="max-w-3xl mx-auto px-5 sm:px-10 py-8 sm:py-12">
            {saveError && (
              <div
                role="alert"
                className="mb-6 rounded-lg border border-red-500/30 bg-red-500/10 px-3.5 py-2.5 text-[12.5px] text-red-700 dark:text-red-300"
              >
                {saveError}
              </div>
            )}

            {mode === 'edit' && canEdit ? (
              <div className="space-y-6">
                <input
                  type="text"
                  value={note.title}
                  onChange={(e) => persistPatch({ title: e.target.value })}
                  placeholder="Untitled Note"
                  className="editor-prose-font w-full bg-transparent text-[28px] sm:text-[32px] font-bold tracking-tight text-neutral-950 dark:text-white placeholder:text-neutral-400 focus:outline-none"
                />
                <div className="text-[12.5px] text-neutral-500 dark:text-neutral-400 pb-4 border-b border-neutral-200 dark:border-white/[0.08]">
                  Shared by {note.ownerName || note.ownerEmail} · Updated{' '}
                  {formatRelativeDate(note.updatedAt)} · {stats.words} words
                </div>
                <LiveDocumentEditor
                  noteId={note.id}
                  content={note.content}
                  onChangeContent={(nextContent) => persistPatch({ content: nextContent })}
                />
              </div>
            ) : (
              <article className="space-y-6">
                <header className="space-y-2 pb-5 border-b border-neutral-200 dark:border-white/[0.08]">
                  <h1 className="editor-prose-font text-[28px] sm:text-[34px] font-bold tracking-tight text-neutral-950 dark:text-white leading-[1.25]">
                    {note.title || 'Untitled Note'}
                  </h1>
                  <div className="text-[12.5px] text-neutral-500 dark:text-neutral-400">
                    {note.ownerName || note.ownerEmail} · Updated{' '}
                    {formatRelativeDate(note.updatedAt)} · {stats.words} words ·{' '}
                    {stats.readMinutes} min read
                  </div>
                </header>

                <div className="editor-prose-font">
                  <MarkdownRenderer
                    content={note.content}
                    onToggleCheckbox={canEdit ? handleToggleCheckbox : undefined}
                  />
                </div>
              </article>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
