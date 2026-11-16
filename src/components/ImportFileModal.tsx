import React, { useEffect, useRef, useState } from 'react';
import { FilePlus2, FileUp, Folder as FolderIcon, Plus, Trash2, Upload, X } from 'lucide-react';
import { Folder } from '../types/notes';
import { describeImportFile } from '../utils/fileImporter';
import { formatFileSize } from '../utils/fileStore';

export type ImportDestinationMode = 'new-notes' | 'insert-current';

interface ImportFileModalProps {
  isOpen: boolean;
  folders: Folder[];
  defaultFolderId: string | null;
  canInsertIntoCurrent: boolean;
  currentNoteTitle: string | null;
  onClose: () => void;
  onImport: (options: {
    files: File[];
    mode: ImportDestinationMode;
    folderId: string | null;
  }) => Promise<void>;
}

interface QueuedImportFile {
  id: string;
  file: File;
  kindLabel: string;
}

let importQueueSeq = 0;

export function ImportFileModal({
  isOpen,
  folders,
  defaultFolderId,
  canInsertIntoCurrent,
  currentNoteTitle,
  onClose,
  onImport,
}: ImportFileModalProps) {
  const [queuedFiles, setQueuedFiles] = useState<QueuedImportFile[]>([]);
  const [mode, setMode] = useState<ImportDestinationMode>('new-notes');
  const [folderId, setFolderId] = useState<string | null>(defaultFolderId);
  const [isDragging, setIsDragging] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setFolderId(defaultFolderId);
      if (!canInsertIntoCurrent) {
        setMode('new-notes');
      }
    } else {
      setQueuedFiles([]);
      setErrorMsg(null);
      setSubmitting(false);
      setIsDragging(false);
      setMode('new-notes');
    }
  }, [isOpen, defaultFolderId, canInsertIntoCurrent]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !submitting) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, submitting, onClose]);

  if (!isOpen) return null;

  const appendFiles = (incoming: FileList | File[]) => {
    const list = Array.from(incoming);
    if (list.length === 0) return;
    setErrorMsg(null);

    const added: QueuedImportFile[] = list.map((file) => {
      importQueueSeq += 1;
      return {
        id: `imp-${Date.now()}-${importQueueSeq}`,
        file,
        kindLabel: describeImportFile(file),
      };
    });
    setQueuedFiles((prev) => [...prev, ...added]);
  };

  const removeFile = (id: string) => {
    setQueuedFiles((prev) => prev.filter((item) => item.id !== id));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (queuedFiles.length === 0) {
      setErrorMsg('Choose or drop one or more files to import.');
      return;
    }

    setErrorMsg(null);
    setSubmitting(true);
    try {
      await onImport({
        files: queuedFiles.map((q) => q.file),
        mode: canInsertIntoCurrent ? mode : 'new-notes',
        folderId,
      });
      onClose();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Could not import selected file(s).';
      setErrorMsg(msg);
      setSubmitting(false);
    }
  };

  const fileCount = queuedFiles.length;
  const submitLabel = submitting
    ? `Importing ${fileCount} ${fileCount === 1 ? 'file' : 'files'}...`
    : mode === 'insert-current' && canInsertIntoCurrent
    ? fileCount > 1
      ? `Insert ${fileCount} files`
      : 'Insert into note'
    : fileCount > 1
    ? `Import ${fileCount} files`
    : 'Import file';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={() => !submitting && onClose()}
      role="dialog"
      aria-modal="true"
      aria-labelledby="import-file-modal-title"
    >
      <div
        className="w-full max-w-xl rounded-2xl border border-neutral-200 dark:border-white/10 bg-white dark:bg-[#17171b] shadow-2xl overflow-hidden flex flex-col max-h-[88vh]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-neutral-200 dark:border-white/[0.08] shrink-0">
          <div className="min-w-0">
            <h2
              id="import-file-modal-title"
              className="text-[15.5px] font-semibold text-neutral-950 dark:text-white"
            >
              Import files
            </h2>
            <p className="text-[12px] text-neutral-500 dark:text-neutral-400 mt-0.5">
              Markdown, text, Word (.docx), CSV tables, HTML, JSON, code, images, or PDFs
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            aria-label="Close import modal"
            className="p-1.5 rounded-lg text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-white hover:bg-neutral-100 dark:hover:bg-white/[0.06] cursor-pointer disabled:opacity-50"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4 overflow-y-auto">
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => {
              if (e.target.files) appendFiles(e.target.files);
              e.target.value = '';
            }}
          />

          <div
            onDragOver={(e) => {
              e.preventDefault();
              setIsDragging(true);
            }}
            onDragLeave={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                setIsDragging(false);
              }
            }}
            onDrop={(e) => {
              e.preventDefault();
              setIsDragging(false);
              if (e.dataTransfer.files?.length) {
                appendFiles(e.dataTransfer.files);
              }
            }}
            onClick={() => fileInputRef.current?.click()}
            className={`rounded-xl border border-dashed text-center transition-colors cursor-pointer ${
              fileCount > 0 ? 'px-4 py-3.5' : 'p-6'
            } ${
              isDragging
                ? 'border-blue-500 bg-blue-500/5'
                : 'border-neutral-300 dark:border-white/15 bg-neutral-50/70 dark:bg-[#121215] hover:border-neutral-400 dark:hover:border-white/25'
            }`}
          >
            {fileCount > 0 ? (
              <div className="flex items-center justify-center gap-2 text-[13px] font-medium text-neutral-700 dark:text-neutral-200">
                <Plus className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0" />
                <span>Add more files or drop them here</span>
              </div>
            ) : (
              <div className="py-4 space-y-2">
                <Upload className="w-7 h-7 mx-auto text-neutral-400 dark:text-neutral-500" />
                <p className="text-[13.5px] font-medium text-neutral-800 dark:text-neutral-200">
                  Click to choose files or drag &amp; drop them here
                </p>
                <p className="text-[12px] text-neutral-500 dark:text-neutral-400">
                  Supports .md, .txt, .docx, .csv, .html, .json, source code, images, and .pdf attachments
                </p>
              </div>
            )}
          </div>

          {fileCount > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-[12px] text-neutral-500 dark:text-neutral-400 tabular-nums">
                <span>
                  {fileCount} {fileCount === 1 ? 'file selected' : 'files selected'}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setQueuedFiles([]);
                    setErrorMsg(null);
                  }}
                  className="text-neutral-500 hover:text-red-600 dark:hover:text-red-400 transition-colors cursor-pointer"
                >
                  Clear all
                </button>
              </div>

              <div className="max-h-48 overflow-y-auto divide-y divide-neutral-200 dark:divide-white/[0.07] rounded-xl border border-neutral-200 dark:border-white/10 bg-neutral-50/60 dark:bg-[#121215]">
                {queuedFiles.map((item) => (
                  <div
                    key={item.id}
                    className="flex items-center justify-between gap-3 px-3.5 py-2.5"
                  >
                    <div className="min-w-0">
                      <div className="text-[13px] font-medium text-neutral-900 dark:text-neutral-100 truncate">
                        {item.file.name}
                      </div>
                      <div className="text-[11.5px] text-neutral-500 dark:text-neutral-400 tabular-nums">
                        {item.kindLabel} · {formatFileSize(item.file.size)}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => removeFile(item.id)}
                      aria-label={`Remove ${item.file.name}`}
                      className="p-1.5 rounded-md text-neutral-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-neutral-200/60 dark:hover:bg-white/[0.06] transition-colors cursor-pointer shrink-0"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Destination Mode */}
          <div className="space-y-3 pt-1">
            {canInsertIntoCurrent && (
              <div className="flex items-center gap-1 p-1 rounded-lg bg-neutral-100 dark:bg-white/[0.05] border border-neutral-200/70 dark:border-white/[0.07]">
                <button
                  type="button"
                  onClick={() => setMode('new-notes')}
                  className={`flex-1 inline-flex items-center justify-center gap-1.5 py-1.5 px-3 rounded-md text-[12.5px] font-medium transition-colors cursor-pointer whitespace-nowrap ${
                    mode === 'new-notes'
                      ? 'bg-white dark:bg-[#27272c] text-neutral-950 dark:text-white shadow-xs'
                      : 'text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-white'
                  }`}
                >
                  <FilePlus2 className="w-3.5 h-3.5" />
                  <span>Create new note(s)</span>
                </button>
                <button
                  type="button"
                  onClick={() => setMode('insert-current')}
                  className={`flex-1 inline-flex items-center justify-center gap-1.5 py-1.5 px-3 rounded-md text-[12.5px] font-medium transition-colors cursor-pointer whitespace-nowrap truncate ${
                    mode === 'insert-current'
                      ? 'bg-white dark:bg-[#27272c] text-neutral-950 dark:text-white shadow-xs'
                      : 'text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-white'
                  }`}
                >
                  <FileUp className="w-3.5 h-3.5 shrink-0" />
                  <span className="truncate">
                    Insert into "{currentNoteTitle || 'Untitled Note'}"
                  </span>
                </button>
              </div>
            )}

            {(mode === 'new-notes' || !canInsertIntoCurrent) && (
              <div>
                <label className="block text-[12.5px] font-medium text-neutral-600 dark:text-neutral-400 mb-1.5">
                  Save to project folder
                </label>
                <div className="relative flex items-center">
                  <FolderIcon className="w-4 h-4 text-neutral-400 pointer-events-none absolute left-3" />
                  <select
                    value={folderId || ''}
                    onChange={(e) => setFolderId(e.target.value ? e.target.value : null)}
                    aria-label="Target project folder"
                    className="w-full pl-9 pr-3 py-2 text-[13px] rounded-lg border border-neutral-300 dark:border-white/12 bg-white dark:bg-[#111114] text-neutral-950 dark:text-white focus:outline-none focus:border-blue-500 cursor-pointer"
                  >
                    <option value="" className="bg-white dark:bg-[#1a1a1e]">
                      Unfiled
                    </option>
                    {folders.map((folder) => (
                      <option
                        key={folder.id}
                        value={folder.id}
                        className="bg-white dark:bg-[#1a1a1e]"
                      >
                        {folder.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            )}
          </div>

          {errorMsg && (
            <p className="text-[12.5px] text-red-600 dark:text-red-400">{errorMsg}</p>
          )}

          <div className="flex items-center justify-end gap-2.5 pt-1">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="px-4 py-2 rounded-lg text-[13.5px] font-medium text-neutral-600 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-white/[0.06] transition-colors cursor-pointer disabled:opacity-50 whitespace-nowrap shrink-0"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting || fileCount === 0}
              className="px-4 py-2 rounded-lg text-[13.5px] font-medium bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white transition-colors cursor-pointer whitespace-nowrap shrink-0 tabular-nums"
            >
              {submitLabel}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
