import React, { useEffect, useState } from 'react';
import { Download, Eye, File as FileIcon, FileText, Trash2, X } from 'lucide-react';
import {
  FILE_REF_PREFIX,
  formatFileSize,
  getAttachmentFile,
  getCachedAttachmentFile,
  StoredFileRecord,
} from '../utils/fileStore';

interface FileAttachmentCardProps {
  src: string;
  label: string;
  onDelete?: () => void;
}

export function FileAttachmentCard({ src, label, onDelete }: FileAttachmentCardProps) {
  const initial = src.startsWith(FILE_REF_PREFIX) ? getCachedAttachmentFile(src) : null;
  const [record, setRecord] = useState<StoredFileRecord | null>(initial);
  const [loading, setLoading] = useState<boolean>(
    Boolean(src.startsWith(FILE_REF_PREFIX) && !initial)
  );
  const [previewOpen, setPreviewOpen] = useState(false);

  useEffect(() => {
    let active = true;
    if (!src.startsWith(FILE_REF_PREFIX)) {
      setLoading(false);
      return;
    }
    const cached = getCachedAttachmentFile(src);
    if (cached) {
      setRecord(cached);
      setLoading(false);
      return;
    }
    setLoading(true);
    getAttachmentFile(src).then((res) => {
      if (!active) return;
      setRecord(res);
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [src]);

  useEffect(() => {
    if (!previewOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPreviewOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [previewOpen]);

  const displayName = record?.name || label.split(' · ')[0] || 'Attached file';
  const sizeLabel = record ? formatFileSize(record.sizeBytes) : label.split(' · ')[1] || '';
  const isPdf =
    record?.mimeType === 'application/pdf' || displayName.toLowerCase().endsWith('.pdf');

  const handleDownload = async () => {
    const resolved = record ?? (await getAttachmentFile(src));
    if (!resolved) return;
    const anchor = document.createElement('a');
    anchor.href = resolved.dataUrl;
    anchor.download = resolved.name || displayName;
    anchor.click();
  };

  return (
    <>
      <div className="group my-4 flex items-center justify-between gap-3 px-4 py-3 rounded-xl border border-neutral-200 dark:border-white/[0.08] bg-neutral-50/80 dark:bg-[#19191d]">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-9 h-9 rounded-lg border border-neutral-200 dark:border-white/[0.08] bg-white dark:bg-[#232329] flex items-center justify-center text-neutral-600 dark:text-neutral-300 shrink-0">
            {isPdf ? <FileText className="w-4 h-4" /> : <FileIcon className="w-4 h-4" />}
          </div>
          <div className="min-w-0">
            <div className="text-[13.5px] font-medium text-neutral-900 dark:text-neutral-100 truncate">
              {displayName}
            </div>
            <div className="text-[12px] text-neutral-500 dark:text-neutral-400 tabular-nums truncate">
              {loading
                ? 'Loading file...'
                : record
                ? `${isPdf ? 'PDF document' : 'Attached file'}${sizeLabel ? ` · ${sizeLabel}` : ''}`
                : 'File unavailable on this device'}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {isPdf && record && (
            <button
              type="button"
              onClick={() => setPreviewOpen(true)}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[12.5px] font-medium text-neutral-700 dark:text-neutral-200 hover:bg-neutral-200/70 dark:hover:bg-white/[0.07] transition-colors cursor-pointer whitespace-nowrap shrink-0"
            >
              <Eye className="w-3.5 h-3.5" />
              <span>Preview</span>
            </button>
          )}
          <button
            type="button"
            onClick={handleDownload}
            disabled={!record && loading}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[12.5px] font-medium bg-neutral-900 text-white hover:bg-neutral-800 dark:bg-white dark:text-neutral-950 dark:hover:bg-neutral-200 disabled:opacity-50 transition-colors cursor-pointer whitespace-nowrap shrink-0"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Download</span>
          </button>
          {onDelete && (
            <button
              type="button"
              onClick={onDelete}
              aria-label="Remove attachment"
              title="Remove attachment"
              className="p-1.5 rounded-lg text-neutral-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-neutral-200/70 dark:hover:bg-white/[0.06] transition-colors cursor-pointer shrink-0"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {previewOpen && record && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 sm:p-8"
          onClick={() => setPreviewOpen(false)}
          role="dialog"
          aria-modal="true"
          aria-label={displayName}
        >
          <div
            className="w-full max-w-4xl h-[85vh] rounded-2xl border border-neutral-200 dark:border-white/10 bg-white dark:bg-[#17171b] shadow-2xl overflow-hidden flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-neutral-200 dark:border-white/[0.08] shrink-0">
              <span className="text-[14px] font-medium text-neutral-950 dark:text-white truncate">
                {displayName}
              </span>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={handleDownload}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12.5px] font-medium bg-blue-600 hover:bg-blue-700 text-white transition-colors cursor-pointer whitespace-nowrap"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Download</span>
                </button>
                <button
                  type="button"
                  onClick={() => setPreviewOpen(false)}
                  aria-label="Close file preview"
                  className="p-1.5 rounded-lg text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-white hover:bg-neutral-100 dark:hover:bg-white/[0.06] cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
            <iframe
              src={record.dataUrl}
              title={displayName}
              className="flex-1 w-full bg-neutral-100 dark:bg-neutral-900"
            />
          </div>
        </div>
      )}
    </>
  );
}
