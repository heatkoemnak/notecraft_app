import React, { useEffect, useState } from 'react';
import {
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  Download,
  FileCode2,
  FileText,
  Globe,
  Link2,
  Lock,
  Mail,
  Printer,
  RotateCcw,
  Trash2,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import { AuthUser, LinkAccess, NoteDocument, SharePermission } from '../types/notes';
import {
  DEFAULT_PDF_EXPORT_OPTIONS,
  exportNoteAsDocx,
  exportNoteAsMarkdown,
  exportNoteAsPdf,
  getPdfRegionPreviewSlots,
  PdfExportOptions,
  PdfSlotPlacement,
} from '../utils/documentExporter';
import { buildShareUrl, copyTextToClipboard } from '../utils/shareClient';

interface ShareNoteModalProps {
  isOpen: boolean;
  note: NoteDocument | null;
  currentUser: AuthUser;
  onClose: () => void;
  onShare: (noteId: string, email: string, permission: SharePermission) => Promise<void>;
  onRevoke: (noteId: string, shareId: string) => Promise<void>;
  onUpdateShareLink: (
    noteId: string,
    linkAccess: LinkAccess,
    regenerate?: boolean
  ) => Promise<{ shareToken: string; linkAccess: LinkAccess }>;
}

type ExportFormat = 'pdf' | 'doc' | 'md';

const PDF_OPTIONS_STORAGE_KEY = 'notecraft-pdf-export-options';

function loadSavedPdfOptions(): PdfExportOptions {
  try {
    const raw = window.localStorage.getItem(PDF_OPTIONS_STORAGE_KEY);
    if (!raw) return DEFAULT_PDF_EXPORT_OPTIONS;
    const parsed = JSON.parse(raw) as Partial<PdfExportOptions>;
    const validPlacement = (v: unknown, fallback: PdfSlotPlacement): PdfSlotPlacement =>
      v === 'header' || v === 'footer' || v === 'hidden' ? v : fallback;
    return {
      showHeader:
        typeof parsed.showHeader === 'boolean'
          ? parsed.showHeader
          : DEFAULT_PDF_EXPORT_OPTIONS.showHeader,
      showFooter:
        typeof parsed.showFooter === 'boolean'
          ? parsed.showFooter
          : DEFAULT_PDF_EXPORT_OPTIONS.showFooter,
      titlePlacement: validPlacement(
        parsed.titlePlacement,
        DEFAULT_PDF_EXPORT_OPTIONS.titlePlacement
      ),
      pageNumberPlacement: validPlacement(
        parsed.pageNumberPlacement,
        DEFAULT_PDF_EXPORT_OPTIONS.pageNumberPlacement
      ),
      datePlacement: validPlacement(
        parsed.datePlacement,
        DEFAULT_PDF_EXPORT_OPTIONS.datePlacement
      ),
      timePlacement: validPlacement(
        parsed.timePlacement,
        DEFAULT_PDF_EXPORT_OPTIONS.timePlacement
      ),
    };
  } catch {
    return DEFAULT_PDF_EXPORT_OPTIONS;
  }
}

export function ShareNoteModal({
  isOpen,
  note,
  currentUser,
  onClose,
  onShare,
  onRevoke,
  onUpdateShareLink,
}: ShareNoteModalProps) {
  const [email, setEmail] = useState('');
  const [permission, setPermission] = useState<SharePermission>('view');
  const [submitting, setSubmitting] = useState(false);
  const [busyShareId, setBusyShareId] = useState<string | null>(null);
  const [linkUpdating, setLinkUpdating] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [exportingFormat, setExportingFormat] = useState<ExportFormat | null>(null);
  const [showPdfOptions, setShowPdfOptions] = useState(false);
  const [pdfOptions, setPdfOptions] = useState<PdfExportOptions>(loadSavedPdfOptions);
  const [error, setError] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setEmail('');
    setPermission('view');
    setError(null);
    setLinkError(null);
    setExportError(null);
    setSubmitting(false);
    setBusyShareId(null);
    setLinkUpdating(false);
    setLinkCopied(false);
    setExportingFormat(null);
    setShowPdfOptions(false);
  }, [isOpen, note?.id]);

  useEffect(() => {
    try {
      window.localStorage.setItem(PDF_OPTIONS_STORAGE_KEY, JSON.stringify(pdfOptions));
    } catch {
      // ignore storage errors
    }
  }, [pdfOptions]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen || !note) return null;

  const isSharedWithMe = Boolean(note.isSharedWithMe);
  const shares = note.shares ?? [];

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await onShare(note.id, email, permission);
      setEmail('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not share note.');
    } finally {
      setSubmitting(false);
    }
  };

  const handlePermissionChange = async (recipientEmail: string, nextPerm: SharePermission) => {
    setError(null);
    try {
      await onShare(note.id, recipientEmail, nextPerm);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update permission.');
    }
  };

  const currentLinkAccess: LinkAccess =
    note.linkAccess === 'view' || note.linkAccess === 'edit' ? note.linkAccess : 'off';
  const currentShareUrl = note.shareToken ? buildShareUrl(note.shareToken) : '';

  const handleLinkAccessChange = async (nextAccess: LinkAccess) => {
    setLinkError(null);
    setLinkUpdating(true);
    try {
      await onUpdateShareLink(note.id, nextAccess, false);
    } catch (err) {
      setLinkError(err instanceof Error ? err.message : 'Could not update link access.');
    } finally {
      setLinkUpdating(false);
    }
  };

  const handleCopyShareLink = async () => {
    setLinkError(null);
    setLinkUpdating(true);
    try {
      let token = note.shareToken ?? null;
      if (currentLinkAccess === 'off' || !token) {
        const nextAccess: LinkAccess = currentLinkAccess === 'off' ? 'view' : currentLinkAccess;
        const result = await onUpdateShareLink(note.id, nextAccess, false);
        token = result.shareToken;
      }
      const url = buildShareUrl(token);
      const copied = await copyTextToClipboard(url);
      if (!copied) {
        setLinkError('Copy failed. Select the link above to copy manually.');
        return;
      }
      setLinkCopied(true);
      window.setTimeout(() => setLinkCopied(false), 2200);
    } catch (err) {
      setLinkError(err instanceof Error ? err.message : 'Could not copy share link.');
    } finally {
      setLinkUpdating(false);
    }
  };

  const handleRegenerateLink = async () => {
    setLinkError(null);
    setLinkUpdating(true);
    try {
      const targetAccess: LinkAccess = currentLinkAccess === 'off' ? 'view' : currentLinkAccess;
      const result = await onUpdateShareLink(note.id, targetAccess, true);
      const copied = await copyTextToClipboard(buildShareUrl(result.shareToken));
      if (copied) {
        setLinkCopied(true);
        window.setTimeout(() => setLinkCopied(false), 2200);
      }
    } catch (err) {
      setLinkError(err instanceof Error ? err.message : 'Could not reset share link.');
    } finally {
      setLinkUpdating(false);
    }
  };

  const handleRemove = async (shareId: string) => {
    setError(null);
    setBusyShareId(shareId);
    try {
      await onRevoke(note.id, shareId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not remove access.');
    } finally {
      setBusyShareId(null);
    }
  };

  const handleExport = async (format: ExportFormat) => {
    setExportError(null);
    setExportingFormat(format);
    try {
      if (format === 'pdf') {
        await exportNoteAsPdf(note, pdfOptions);
      } else if (format === 'doc') {
        await exportNoteAsDocx(note);
      } else {
        await exportNoteAsMarkdown(note);
      }
    } catch (err) {
      setExportError(
        err instanceof Error ? err.message : `Could not export as ${format.toUpperCase()}.`
      );
    } finally {
      setExportingFormat(null);
    }
  };

  const updatePlacement = (
    field: 'titlePlacement' | 'pageNumberPlacement' | 'datePlacement' | 'timePlacement',
    placement: PdfSlotPlacement
  ) => {
    setPdfOptions((prev) => ({
      ...prev,
      [field]: placement,
      showHeader: placement === 'header' ? true : prev.showHeader,
      showFooter: placement === 'footer' ? true : prev.showFooter,
    }));
  };

  const headerPreview = getPdfRegionPreviewSlots(
    'header',
    note.title || 'Untitled Note',
    pdfOptions
  );
  const footerPreview = getPdfRegionPreviewSlots(
    'footer',
    note.title || 'Untitled Note',
    pdfOptions
  );

  const placementRows: Array<{
    key: 'titlePlacement' | 'pageNumberPlacement' | 'datePlacement' | 'timePlacement';
    label: string;
  }> = [
    { key: 'titlePlacement', label: 'Document title' },
    { key: 'pageNumberPlacement', label: 'Page number' },
    { key: 'datePlacement', label: 'Current date' },
    { key: 'timePlacement', label: 'Current time' },
  ];

  const isDefaultPdfOptions =
    pdfOptions.showHeader === DEFAULT_PDF_EXPORT_OPTIONS.showHeader &&
    pdfOptions.showFooter === DEFAULT_PDF_EXPORT_OPTIONS.showFooter &&
    pdfOptions.titlePlacement === DEFAULT_PDF_EXPORT_OPTIONS.titlePlacement &&
    pdfOptions.pageNumberPlacement === DEFAULT_PDF_EXPORT_OPTIONS.pageNumberPlacement &&
    pdfOptions.datePlacement === DEFAULT_PDF_EXPORT_OPTIONS.datePlacement &&
    pdfOptions.timePlacement === DEFAULT_PDF_EXPORT_OPTIONS.timePlacement;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="share-note-title"
    >
      <div
        className="w-full max-w-lg rounded-2xl border border-neutral-200 dark:border-white/10 bg-white dark:bg-[#17171b] shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 px-6 py-4 border-b border-neutral-200 dark:border-white/[0.08]">
          <div className="min-w-0">
            <h2
              id="share-note-title"
              className="editor-prose-font text-[16px] font-semibold text-neutral-950 dark:text-white truncate leading-[1.45]"
            >
              Share &amp; export &ldquo;{note.title || 'Untitled Note'}&rdquo;
            </h2>
            <p className="mt-0.5 text-[12.5px] text-neutral-500 dark:text-neutral-400">
              {isSharedWithMe
                ? `Shared by ${note.ownerName || note.ownerEmail} · Export a copy below.`
                : 'Copy a shareable link, invite teammates by email, or export this document.'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close share dialog"
            className="p-1.5 rounded-lg text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-white hover:bg-neutral-100 dark:hover:bg-white/[0.06] cursor-pointer shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6 space-y-5 max-h-[82vh] overflow-y-auto">
          {/* Export Document Section (PDF / DOC / MD) */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="inline-flex items-center gap-1.5 text-[12.5px] font-medium text-neutral-700 dark:text-neutral-300">
                <Download className="w-3.5 h-3.5 text-neutral-400" />
                <span>Export document</span>
              </span>
              <span className="text-[11.5px] text-neutral-400 dark:text-neutral-500">
                Choose format
              </span>
            </div>

            <div className="grid grid-cols-3 gap-2.5">
              <button
                type="button"
                disabled={exportingFormat !== null}
                onClick={() => setShowPdfOptions((prev) => !prev)}
                aria-expanded={showPdfOptions}
                className={`flex flex-col items-start gap-1 rounded-xl border px-3.5 py-2.5 text-left transition-colors cursor-pointer disabled:opacity-55 ${
                  showPdfOptions
                    ? 'border-blue-500 bg-blue-500/[0.07]'
                    : 'border-neutral-200 dark:border-white/10 bg-neutral-50/70 dark:bg-white/[0.02] hover:border-blue-500/60 hover:bg-blue-500/[0.05]'
                }`}
              >
                <div className="flex items-center justify-between w-full">
                  <Printer className="w-4 h-4 text-red-500 dark:text-red-400" />
                  <span className="inline-flex items-center gap-0.5 text-[11px] font-mono-code font-semibold text-neutral-500 dark:text-neutral-400">
                    <span>.pdf</span>
                    {showPdfOptions ? (
                      <ChevronUp className="w-3 h-3" />
                    ) : (
                      <ChevronDown className="w-3 h-3" />
                    )}
                  </span>
                </div>
                <span className="text-[13px] font-semibold text-neutral-900 dark:text-white whitespace-nowrap">
                  {exportingFormat === 'pdf' ? 'Preparing...' : 'PDF'}
                </span>
                <span className="text-[11px] text-neutral-500 dark:text-neutral-400 truncate w-full">
                  Header &amp; footer
                </span>
              </button>

              <button
                type="button"
                disabled={exportingFormat !== null}
                onClick={() => handleExport('doc')}
                className="flex flex-col items-start gap-1 rounded-xl border border-neutral-200 dark:border-white/10 bg-neutral-50/70 dark:bg-white/[0.02] hover:border-blue-500/60 hover:bg-blue-500/[0.05] disabled:opacity-55 px-3.5 py-2.5 text-left transition-colors cursor-pointer"
              >
                <div className="flex items-center justify-between w-full">
                  <FileText className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                  <span className="text-[11px] font-mono-code font-semibold text-neutral-500 dark:text-neutral-400">
                    .docx
                  </span>
                </div>
                <span className="text-[13px] font-semibold text-neutral-900 dark:text-white whitespace-nowrap">
                  {exportingFormat === 'doc' ? 'Building...' : 'DOC'}
                </span>
                <span className="text-[11px] text-neutral-500 dark:text-neutral-400 truncate w-full">
                  Word document
                </span>
              </button>

              <button
                type="button"
                disabled={exportingFormat !== null}
                onClick={() => handleExport('md')}
                className="flex flex-col items-start gap-1 rounded-xl border border-neutral-200 dark:border-white/10 bg-neutral-50/70 dark:bg-white/[0.02] hover:border-blue-500/60 hover:bg-blue-500/[0.05] disabled:opacity-55 px-3.5 py-2.5 text-left transition-colors cursor-pointer"
              >
                <div className="flex items-center justify-between w-full">
                  <FileCode2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                  <span className="text-[11px] font-mono-code font-semibold text-neutral-500 dark:text-neutral-400">
                    .md
                  </span>
                </div>
                <span className="text-[13px] font-semibold text-neutral-900 dark:text-white whitespace-nowrap">
                  {exportingFormat === 'md' ? 'Saving...' : 'Markdown'}
                </span>
                <span className="text-[11px] text-neutral-500 dark:text-neutral-400 truncate w-full">
                  Markdown source
                </span>
              </button>
            </div>

            {/* PDF Header & Footer Customization Panel */}
            {showPdfOptions && (
              <div className="rounded-xl border border-neutral-200 dark:border-white/10 bg-neutral-50/80 dark:bg-[#111115] p-4 space-y-3.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-[12.5px] font-semibold text-neutral-900 dark:text-neutral-100">
                    PDF header &amp; footer
                  </span>

                  <div className="flex items-center gap-3">
                    <label className="inline-flex items-center gap-1.5 text-[12px] text-neutral-700 dark:text-neutral-300 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={pdfOptions.showHeader}
                        onChange={(e) =>
                          setPdfOptions((prev) => ({
                            ...prev,
                            showHeader: e.target.checked,
                          }))
                        }
                        className="rounded border-neutral-300 dark:border-white/20 text-blue-600 focus:ring-blue-500 cursor-pointer"
                      />
                      <span>Header</span>
                    </label>

                    <label className="inline-flex items-center gap-1.5 text-[12px] text-neutral-700 dark:text-neutral-300 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={pdfOptions.showFooter}
                        onChange={(e) =>
                          setPdfOptions((prev) => ({
                            ...prev,
                            showFooter: e.target.checked,
                          }))
                        }
                        className="rounded border-neutral-300 dark:border-white/20 text-blue-600 focus:ring-blue-500 cursor-pointer"
                      />
                      <span>Footer</span>
                    </label>

                    {!isDefaultPdfOptions && (
                      <button
                        type="button"
                        onClick={() => setPdfOptions(DEFAULT_PDF_EXPORT_OPTIONS)}
                        title="Reset to default header & footer"
                        className="inline-flex items-center gap-1 text-[11.5px] text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-white cursor-pointer"
                      >
                        <RotateCcw className="w-3 h-3" />
                        <span>Reset</span>
                      </button>
                    )}
                  </div>
                </div>

                {/* Live Page Margin Preview */}
                <div className="rounded-lg border border-neutral-200 dark:border-white/10 bg-white px-3.5 py-2.5 text-[10.5px] text-neutral-500 shadow-xs">
                  <div className="flex items-center justify-between gap-2 min-h-[16px] pb-1.5 border-b border-neutral-100">
                    {headerPreview.hasContent ? (
                      <>
                        <span className="truncate max-w-[44%] text-neutral-600">
                          {headerPreview.left}
                        </span>
                        <span className="truncate text-neutral-500 tabular-nums">
                          {headerPreview.center}
                        </span>
                        <span className="truncate text-right text-neutral-600 tabular-nums">
                          {headerPreview.right}
                        </span>
                      </>
                    ) : (
                      <span className="text-neutral-400 italic">Header hidden</span>
                    )}
                  </div>

                  <div className="py-2 space-y-1.5 opacity-60">
                    <div className="h-1.5 w-2/5 rounded bg-neutral-200" />
                    <div className="h-1.5 w-4/5 rounded bg-neutral-100" />
                  </div>

                  <div className="flex items-center justify-between gap-2 min-h-[16px] pt-1.5 border-t border-neutral-100">
                    {footerPreview.hasContent ? (
                      <>
                        <span className="truncate max-w-[44%] text-neutral-600">
                          {footerPreview.left}
                        </span>
                        <span className="truncate text-neutral-500 tabular-nums">
                          {footerPreview.center}
                        </span>
                        <span className="truncate text-right text-neutral-600 tabular-nums">
                          {footerPreview.right}
                        </span>
                      </>
                    ) : (
                      <span className="text-neutral-400 italic">Footer hidden</span>
                    )}
                  </div>
                </div>

                {/* Field Placement Controls */}
                <div className="divide-y divide-neutral-200/70 dark:divide-white/[0.06] rounded-lg border border-neutral-200 dark:border-white/10 bg-white dark:bg-[#16161b]">
                  {placementRows.map((row) => {
                    const value = pdfOptions[row.key];
                    return (
                      <div
                        key={row.key}
                        className="flex items-center justify-between gap-3 px-3 py-2"
                      >
                        <span className="text-[12.5px] font-medium text-neutral-800 dark:text-neutral-200">
                          {row.label}
                        </span>

                        <div
                          role="group"
                          aria-label={`${row.label} placement`}
                          className="inline-flex rounded-md border border-neutral-200 dark:border-white/10 bg-neutral-100/80 dark:bg-white/[0.04] p-0.5"
                        >
                          {(['header', 'footer', 'hidden'] as PdfSlotPlacement[]).map(
                            (slot) => {
                              const isSelected = value === slot;
                              const isRegionDisabled =
                                (slot === 'header' && !pdfOptions.showHeader) ||
                                (slot === 'footer' && !pdfOptions.showFooter);
                              const slotLabel =
                                slot === 'header'
                                  ? 'Header'
                                  : slot === 'footer'
                                  ? 'Footer'
                                  : 'Hide';

                              return (
                                <button
                                  key={slot}
                                  type="button"
                                  onClick={() => updatePlacement(row.key, slot)}
                                  className={`px-2.5 py-1 text-[11.5px] font-medium rounded transition-colors cursor-pointer whitespace-nowrap ${
                                    isSelected
                                      ? isRegionDisabled
                                        ? 'bg-white/70 dark:bg-white/10 text-neutral-400 dark:text-neutral-500 line-through'
                                        : 'bg-white dark:bg-[#23232a] text-neutral-950 dark:text-white shadow-xs'
                                      : 'text-neutral-500 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-200'
                                  }`}
                                >
                                  {slotLabel}
                                </button>
                              );
                            }
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="flex items-center justify-between gap-3 pt-0.5">
                  <span className="text-[11.5px] text-neutral-500 dark:text-neutral-400">
                    Applied to every page when printing PDF
                  </span>
                  <button
                    type="button"
                    disabled={exportingFormat !== null}
                    onClick={() => handleExport('pdf')}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-[12.5px] font-medium bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white transition-colors cursor-pointer whitespace-nowrap shrink-0"
                  >
                    <Printer className="w-3.5 h-3.5" />
                    <span>{exportingFormat === 'pdf' ? 'Preparing PDF...' : 'Export PDF'}</span>
                  </button>
                </div>
              </div>
            )}

            {exportError && (
              <div
                role="alert"
                className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-[12.5px] text-red-700 dark:text-red-300"
              >
                {exportError}
              </div>
            )}
          </div>

          {!isSharedWithMe && (
            <>
              {/* Share by link */}
              <div className="pt-4 border-t border-neutral-200 dark:border-white/[0.08] space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="inline-flex items-center gap-1.5 text-[12.5px] font-medium text-neutral-700 dark:text-neutral-300">
                    <Link2 className="w-3.5 h-3.5 text-neutral-400" />
                    <span>Share by link</span>
                  </span>

                  <div className="inline-flex items-center gap-1.5">
                    {currentLinkAccess === 'off' ? (
                      <Lock className="w-3.5 h-3.5 text-neutral-400" />
                    ) : (
                      <Globe className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                    )}
                    <select
                      value={currentLinkAccess}
                      disabled={linkUpdating}
                      onChange={(e) => handleLinkAccessChange(e.target.value as LinkAccess)}
                      aria-label="Link sharing access"
                      className="px-2.5 py-1.5 text-[12.5px] rounded-lg border border-neutral-300 dark:border-white/12 bg-white dark:bg-[#111114] text-neutral-900 dark:text-neutral-100 focus:outline-none focus:border-blue-500 cursor-pointer disabled:opacity-60"
                    >
                      <option value="off">Restricted · Invited only</option>
                      <option value="view">Anyone with link · Can view</option>
                      <option value="edit">Anyone with link · Can edit</option>
                    </select>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {currentLinkAccess !== 'off' && currentShareUrl ? (
                    <input
                      type="text"
                      readOnly
                      value={currentShareUrl}
                      onFocus={(e) => e.currentTarget.select()}
                      onClick={(e) => e.currentTarget.select()}
                      aria-label="Shareable document URL"
                      className="flex-1 min-w-0 px-3 py-2 text-[12.5px] font-mono-code rounded-lg border border-neutral-200 dark:border-white/10 bg-neutral-50 dark:bg-[#111114] text-neutral-700 dark:text-neutral-200 focus:outline-none focus:border-blue-500"
                    />
                  ) : (
                    <div className="flex-1 min-w-0 px-3 py-2 text-[12.5px] rounded-lg border border-dashed border-neutral-300 dark:border-white/12 bg-neutral-50/70 dark:bg-white/[0.02] text-neutral-500 dark:text-neutral-400 truncate">
                      Click Copy link to create a view-only link
                    </div>
                  )}

                  {currentLinkAccess !== 'off' && note.shareToken && (
                    <button
                      type="button"
                      disabled={linkUpdating}
                      onClick={handleRegenerateLink}
                      title="Generate a new link and invalidate the old one"
                      aria-label="Reset share link"
                      className="p-2 rounded-lg border border-neutral-200 dark:border-white/10 text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-white hover:bg-neutral-100 dark:hover:bg-white/[0.06] disabled:opacity-50 transition-colors cursor-pointer shrink-0"
                    >
                      <RotateCcw className="w-4 h-4" />
                    </button>
                  )}

                  <button
                    type="button"
                    disabled={linkUpdating}
                    onClick={handleCopyShareLink}
                    className={`inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-lg text-[13px] font-medium transition-colors cursor-pointer whitespace-nowrap shrink-0 disabled:opacity-60 ${
                      linkCopied
                        ? 'bg-emerald-600 hover:bg-emerald-700 text-white'
                        : 'bg-blue-600 hover:bg-blue-700 text-white'
                    }`}
                  >
                    {linkCopied ? (
                      <>
                        <Check className="w-3.5 h-3.5" />
                        <span>Copied</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5" />
                        <span>Copy link</span>
                      </>
                    )}
                  </button>
                </div>

                {linkError && (
                  <div
                    role="alert"
                    className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-[12.5px] text-red-700 dark:text-red-300"
                  >
                    {linkError}
                  </div>
                )}
              </div>

              <form
                onSubmit={handleSubmit}
                className="pt-4 border-t border-neutral-200 dark:border-white/[0.08] space-y-3"
              >
                <label
                  htmlFor="share-recipient-email"
                  className="block text-[12.5px] font-medium text-neutral-700 dark:text-neutral-300"
                >
                  Share with teammate by email
                </label>
                <div className="flex flex-col sm:flex-row gap-2">
                  <div className="relative flex-1 min-w-0">
                    <Mail className="w-4 h-4 text-neutral-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <input
                      id="share-recipient-email"
                      type="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="colleague@example.com"
                      className="w-full pl-9 pr-3 py-2 text-[13.5px] rounded-lg border border-neutral-300 dark:border-white/12 bg-white dark:bg-[#111114] text-neutral-950 dark:text-white placeholder:text-neutral-400 focus:outline-none focus:border-blue-500"
                    />
                  </div>

                  <select
                    value={permission}
                    onChange={(e) => setPermission(e.target.value as SharePermission)}
                    aria-label="Access permission"
                    className="px-3 py-2 text-[13px] rounded-lg border border-neutral-300 dark:border-white/12 bg-white dark:bg-[#111114] text-neutral-900 dark:text-neutral-100 focus:outline-none focus:border-blue-500 cursor-pointer shrink-0"
                  >
                    <option value="view">Can view</option>
                    <option value="edit">Can edit</option>
                  </select>

                  <button
                    type="submit"
                    disabled={submitting}
                    className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg text-[13px] font-medium bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white transition-colors cursor-pointer whitespace-nowrap shrink-0"
                  >
                    <UserPlus className="w-3.5 h-3.5" />
                    <span>{submitting ? 'Sharing...' : 'Share'}</span>
                  </button>
                </div>

                {error && (
                  <div
                    role="alert"
                    className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-[12.5px] text-red-700 dark:text-red-300"
                  >
                    {error}
                  </div>
                )}
              </form>

              {/* People with access */}
              <div className="pt-4 border-t border-neutral-200 dark:border-white/[0.08] space-y-3">
                <div className="flex items-center justify-between">
                  <span className="inline-flex items-center gap-1.5 text-[12.5px] font-medium text-neutral-600 dark:text-neutral-300">
                    <Users className="w-3.5 h-3.5 text-neutral-400" />
                    <span>People with access</span>
                  </span>
                  <span className="text-[12px] text-neutral-400 dark:text-neutral-500 tabular-nums">
                    {shares.length + 1}
                  </span>
                </div>

                <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                  {/* Owner */}
                  <div className="flex items-center justify-between gap-3 py-1.5">
                    <div className="min-w-0">
                      <div className="text-[13px] font-medium text-neutral-900 dark:text-neutral-100 truncate">
                        {currentUser.name} (you)
                      </div>
                      <div className="text-[12px] text-neutral-500 dark:text-neutral-400 truncate">
                        {currentUser.email}
                      </div>
                    </div>
                    <span className="text-[12px] text-neutral-500 dark:text-neutral-400 shrink-0">
                      Owner
                    </span>
                  </div>

                  {/* Shared Recipients */}
                  {shares.length === 0 ? (
                    <p className="text-[12.5px] text-neutral-400 dark:text-neutral-500 py-1">
                      Only you have access to this note.
                    </p>
                  ) : (
                    shares.map((share) => (
                      <div
                        key={share.id}
                        className="flex items-center justify-between gap-3 py-1.5 border-t border-neutral-200/60 dark:border-white/[0.05]"
                      >
                        <div className="min-w-0">
                          <div className="text-[13px] font-medium text-neutral-900 dark:text-neutral-100 truncate">
                            {share.recipientName || share.recipientEmail}
                          </div>
                          <div className="text-[12px] text-neutral-500 dark:text-neutral-400 truncate">
                            {share.recipientName
                              ? `${share.recipientEmail} · Active user`
                              : 'Pending sign-in · Access ready when registered'}
                          </div>
                        </div>

                        <div className="flex items-center gap-1.5 shrink-0">
                          <select
                            value={share.permission}
                            onChange={(e) =>
                              handlePermissionChange(
                                share.recipientEmail,
                                e.target.value as SharePermission
                              )
                            }
                            aria-label={`Permission for ${share.recipientEmail}`}
                            className="px-2 py-1 text-[12px] rounded-md border border-neutral-200 dark:border-white/10 bg-neutral-50 dark:bg-[#111114] text-neutral-700 dark:text-neutral-200 focus:outline-none focus:border-blue-500 cursor-pointer"
                          >
                            <option value="view">Can view</option>
                            <option value="edit">Can edit</option>
                          </select>

                          <button
                            type="button"
                            disabled={busyShareId === share.id}
                            onClick={() => handleRemove(share.id)}
                            title="Remove access"
                            aria-label={`Remove access for ${share.recipientEmail}`}
                            className="p-1.5 rounded-md text-neutral-400 hover:text-red-500 hover:bg-red-500/10 disabled:opacity-50 transition-colors cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
