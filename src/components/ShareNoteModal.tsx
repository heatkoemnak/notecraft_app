import React, { useEffect, useState } from 'react';
import {
  Download,
  FileCode2,
  FileText,
  Mail,
  Printer,
  Trash2,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import { AuthUser, NoteDocument, SharePermission } from '../types/notes';
import {
  exportNoteAsDocx,
  exportNoteAsMarkdown,
  exportNoteAsPdf,
} from '../utils/documentExporter';

interface ShareNoteModalProps {
  isOpen: boolean;
  note: NoteDocument | null;
  currentUser: AuthUser;
  onClose: () => void;
  onShare: (noteId: string, email: string, permission: SharePermission) => Promise<void>;
  onRevoke: (noteId: string, shareId: string) => Promise<void>;
}

type ExportFormat = 'pdf' | 'doc' | 'md';

export function ShareNoteModal({
  isOpen,
  note,
  currentUser,
  onClose,
  onShare,
  onRevoke,
}: ShareNoteModalProps) {
  const [email, setEmail] = useState('');
  const [permission, setPermission] = useState<SharePermission>('view');
  const [submitting, setSubmitting] = useState(false);
  const [busyShareId, setBusyShareId] = useState<string | null>(null);
  const [exportingFormat, setExportingFormat] = useState<ExportFormat | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setEmail('');
    setPermission('view');
    setError(null);
    setExportError(null);
    setSubmitting(false);
    setBusyShareId(null);
    setExportingFormat(null);
  }, [isOpen, note?.id]);

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
        await exportNoteAsPdf(note);
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
                : 'Invite NoteCraft users by email or export this document as PDF, Word, or Markdown.'}
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
          <div className="space-y-2.5">
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
                onClick={() => handleExport('pdf')}
                className="flex flex-col items-start gap-1 rounded-xl border border-neutral-200 dark:border-white/10 bg-neutral-50/70 dark:bg-white/[0.02] hover:border-blue-500/60 hover:bg-blue-500/[0.05] disabled:opacity-55 px-3.5 py-2.5 text-left transition-colors cursor-pointer"
              >
                <div className="flex items-center justify-between w-full">
                  <Printer className="w-4 h-4 text-red-500 dark:text-red-400" />
                  <span className="text-[11px] font-mono-code font-semibold text-neutral-500 dark:text-neutral-400">
                    .pdf
                  </span>
                </div>
                <span className="text-[13px] font-semibold text-neutral-900 dark:text-white whitespace-nowrap">
                  {exportingFormat === 'pdf' ? 'Preparing...' : 'PDF'}
                </span>
                <span className="text-[11px] text-neutral-500 dark:text-neutral-400 truncate w-full">
                  Print / Save PDF
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
