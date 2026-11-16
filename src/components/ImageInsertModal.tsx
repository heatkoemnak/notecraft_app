import React, { useEffect, useRef, useState } from 'react';
import { ImagePlus, Link as LinkIcon, Plus, Trash2, Upload, X } from 'lucide-react';
import { isImageFile, saveImageFile } from '../utils/imageStore';

interface ImageInsertModalProps {
  isOpen: boolean;
  onClose: () => void;
  onInsert: (markdownImage: string) => void;
}

interface QueuedFileItem {
  id: string;
  file: File;
  previewUrl: string;
  alt: string;
}

interface QueuedUrlItem {
  id: string;
  url: string;
  alt: string;
}

let queueSeq = 0;

function defaultCaptionFromFile(file: File): string {
  const cleanName = file.name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').trim();
  return cleanName || 'Screenshot';
}

function defaultCaptionFromUrl(url: string): string {
  try {
    const parsed = new URL(url, window.location.origin);
    const segment = parsed.pathname.split('/').filter(Boolean).pop() || '';
    const clean = segment.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').trim();
    return clean || 'Image';
  } catch {
    return 'Image';
  }
}

export function ImageInsertModal({ isOpen, onClose, onInsert }: ImageInsertModalProps) {
  const [tab, setTab] = useState<'upload' | 'url'>('upload');
  const [queuedFiles, setQueuedFiles] = useState<QueuedFileItem[]>([]);
  const [queuedUrls, setQueuedUrls] = useState<QueuedUrlItem[]>([]);
  const [imageUrl, setImageUrl] = useState('');
  const [urlAlt, setUrlAlt] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const queuedFilesRef = useRef<QueuedFileItem[]>([]);
  queuedFilesRef.current = queuedFiles;

  useEffect(() => {
    if (!isOpen) {
      for (const item of queuedFilesRef.current) {
        URL.revokeObjectURL(item.previewUrl);
      }
      setQueuedFiles([]);
      setQueuedUrls([]);
      setImageUrl('');
      setUrlAlt('');
      setErrorMsg(null);
      setSubmitting(false);
      setIsDragging(false);
      setTab('upload');
    }
  }, [isOpen]);

  useEffect(() => {
    return () => {
      for (const item of queuedFilesRef.current) {
        URL.revokeObjectURL(item.previewUrl);
      }
    };
  }, []);

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

    const validImages = list.filter(isImageFile);
    if (validImages.length === 0) {
      setErrorMsg('Please choose valid image files (PNG, JPG, WebP, GIF, or SVG).');
      return;
    }

    if (validImages.length < list.length) {
      setErrorMsg('Some non-image files were skipped.');
    } else {
      setErrorMsg(null);
    }

    const nextItems: QueuedFileItem[] = validImages.map((file) => {
      queueSeq += 1;
      return {
        id: `qfile-${Date.now()}-${queueSeq}`,
        file,
        previewUrl: URL.createObjectURL(file),
        alt: defaultCaptionFromFile(file),
      };
    });

    setQueuedFiles((prev) => [...prev, ...nextItems]);
    setTab('upload');
  };

  const removeQueuedFile = (id: string) => {
    setQueuedFiles((prev) => {
      const target = prev.find((item) => item.id === id);
      if (target) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((item) => item.id !== id);
    });
  };

  const clearQueuedFiles = () => {
    for (const item of queuedFiles) {
      URL.revokeObjectURL(item.previewUrl);
    }
    setQueuedFiles([]);
    setErrorMsg(null);
  };

  const handleAddCurrentUrl = () => {
    const raw = imageUrl.trim();
    if (!raw) {
      setErrorMsg('Enter an image URL first.');
      return;
    }
    const lines = raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    const added: QueuedUrlItem[] = lines.map((line, index) => {
      queueSeq += 1;
      const caption =
        lines.length === 1 && urlAlt.trim()
          ? urlAlt.trim()
          : defaultCaptionFromUrl(line);
      return {
        id: `qurl-${Date.now()}-${queueSeq}-${index}`,
        url: line,
        alt: caption,
      };
    });

    setQueuedUrls((prev) => [...prev, ...added]);
    setImageUrl('');
    setUrlAlt('');
    setErrorMsg(null);
  };

  const removeQueuedUrl = (id: string) => {
    setQueuedUrls((prev) => prev.filter((item) => item.id !== id));
  };

  const handleModalPaste = (e: React.ClipboardEvent) => {
    const items = Array.from(e.clipboardData?.items || []);
    const pastedFiles: File[] = [];
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        const f = item.getAsFile();
        if (f) pastedFiles.push(f);
      }
    }
    if (pastedFiles.length > 0) {
      e.preventDefault();
      appendFiles(pastedFiles);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    if (tab === 'upload') {
      if (queuedFiles.length === 0) {
        setErrorMsg('Select, drop, or paste one or more image files first.');
        return;
      }
      setSubmitting(true);
      try {
        const savedList = await Promise.all(
          queuedFiles.map((item) => saveImageFile(item.file, item.alt))
        );
        const markdownBlocks = savedList.map((saved) => {
          const safeAlt = saved.alt.replace(/[\[\]]/g, '');
          return `![${safeAlt}](${saved.refUrl})`;
        });
        onInsert(markdownBlocks.join('\n\n'));
        onClose();
      } catch {
        setErrorMsg('Could not process one or more image files.');
        setSubmitting(false);
      }
      return;
    }

    const pendingUrlLines = imageUrl
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    const allUrls: QueuedUrlItem[] = [
      ...queuedUrls,
      ...pendingUrlLines.map((line, index) => {
        queueSeq += 1;
        return {
          id: `qurl-submit-${Date.now()}-${queueSeq}-${index}`,
          url: line,
          alt:
            pendingUrlLines.length === 1 && urlAlt.trim()
              ? urlAlt.trim()
              : defaultCaptionFromUrl(line),
        };
      }),
    ];

    if (allUrls.length === 0) {
      setErrorMsg('Enter or add at least one image URL.');
      return;
    }

    const markdownBlocks = allUrls.map((item) => {
      const safeAlt = (item.alt.trim() || 'Image').replace(/[\[\]]/g, '');
      return `![${safeAlt}](${item.url})`;
    });
    onInsert(markdownBlocks.join('\n\n'));
    onClose();
  };

  const pendingUrlCount =
    queuedUrls.length +
    imageUrl
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean).length;
  const activeCount = tab === 'upload' ? queuedFiles.length : pendingUrlCount;

  const submitLabel = submitting
    ? `Adding ${queuedFiles.length} ${queuedFiles.length === 1 ? 'image' : 'images'}...`
    : activeCount > 1
    ? `Insert ${activeCount} images`
    : 'Insert image';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={() => !submitting && onClose()}
      onPaste={handleModalPaste}
      role="dialog"
      aria-modal="true"
      aria-labelledby="image-insert-modal-title"
    >
      <div
        className="w-full max-w-2xl rounded-2xl border border-neutral-200 dark:border-white/10 bg-white dark:bg-[#17171b] shadow-2xl overflow-hidden flex flex-col max-h-[88vh]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-neutral-200 dark:border-white/[0.08] shrink-0">
          <div className="min-w-0">
            <h2
              id="image-insert-modal-title"
              className="text-[15.5px] font-semibold text-neutral-950 dark:text-white"
            >
              Insert images
            </h2>
            <p className="text-[12px] text-neutral-500 dark:text-neutral-400 mt-0.5">
              Select, drop, or paste one or multiple images into your document
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            aria-label="Close insert images modal"
            className="p-1.5 rounded-lg text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-white hover:bg-neutral-100 dark:hover:bg-white/[0.06] cursor-pointer disabled:opacity-50"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4 overflow-y-auto">
          {/* Mode Tabs */}
          <div className="flex items-center gap-1 p-1 rounded-lg bg-neutral-100 dark:bg-white/[0.05] border border-neutral-200/70 dark:border-white/[0.07]">
            <button
              type="button"
              onClick={() => {
                setTab('upload');
                setErrorMsg(null);
              }}
              className={`flex-1 inline-flex items-center justify-center gap-1.5 py-1.5 px-3 rounded-md text-[13px] font-medium transition-colors cursor-pointer whitespace-nowrap ${
                tab === 'upload'
                  ? 'bg-white dark:bg-[#27272c] text-neutral-950 dark:text-white shadow-xs'
                  : 'text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-white'
              }`}
            >
              <Upload className="w-3.5 h-3.5" />
              <span className="tabular-nums">
                {queuedFiles.length > 0 ? `Upload files (${queuedFiles.length})` : 'Upload files'}
              </span>
            </button>
            <button
              type="button"
              onClick={() => {
                setTab('url');
                setErrorMsg(null);
              }}
              className={`flex-1 inline-flex items-center justify-center gap-1.5 py-1.5 px-3 rounded-md text-[13px] font-medium transition-colors cursor-pointer whitespace-nowrap ${
                tab === 'url'
                  ? 'bg-white dark:bg-[#27272c] text-neutral-950 dark:text-white shadow-xs'
                  : 'text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-white'
              }`}
            >
              <LinkIcon className="w-3.5 h-3.5" />
              <span className="tabular-nums">
                {queuedUrls.length > 0 ? `Image URLs (${queuedUrls.length})` : 'Image URLs'}
              </span>
            </button>
          </div>

          {tab === 'upload' ? (
            <div className="space-y-3">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
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
                  queuedFiles.length > 0 ? 'px-4 py-3.5' : 'p-6'
                } ${
                  isDragging
                    ? 'border-blue-500 bg-blue-500/5'
                    : 'border-neutral-300 dark:border-white/15 bg-neutral-50/70 dark:bg-[#121215] hover:border-neutral-400 dark:hover:border-white/25'
                }`}
              >
                {queuedFiles.length > 0 ? (
                  <div className="flex items-center justify-center gap-2 text-[13px] font-medium text-neutral-700 dark:text-neutral-200">
                    <Plus className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0" />
                    <span>Add more images, drop files here, or paste from clipboard</span>
                  </div>
                ) : (
                  <div className="py-4 space-y-2">
                    <ImagePlus className="w-7 h-7 mx-auto text-neutral-400 dark:text-neutral-500" />
                    <p className="text-[13.5px] font-medium text-neutral-800 dark:text-neutral-200">
                      Click to choose multiple images or drag &amp; drop them here
                    </p>
                    <p className="text-[12px] text-neutral-500 dark:text-neutral-400">
                      PNG, JPG, WebP, GIF, or SVG · Paste screenshots directly anytime
                    </p>
                  </div>
                )}
              </div>

              {queuedFiles.length > 0 && (
                <div className="space-y-2.5">
                  <div className="flex items-center justify-between text-[12px] text-neutral-500 dark:text-neutral-400 tabular-nums">
                    <span>
                      {queuedFiles.length}{' '}
                      {queuedFiles.length === 1 ? 'image ready' : 'images ready'}
                    </span>
                    <button
                      type="button"
                      onClick={clearQueuedFiles}
                      className="text-neutral-500 hover:text-red-600 dark:hover:text-red-400 transition-colors cursor-pointer"
                    >
                      Clear all
                    </button>
                  </div>

                  <div
                    className={`grid gap-3 ${
                      queuedFiles.length === 1
                        ? 'grid-cols-1'
                        : 'grid-cols-1 sm:grid-cols-2'
                    }`}
                  >
                    {queuedFiles.map((item) => (
                      <div
                        key={item.id}
                        className="rounded-xl border border-neutral-200 dark:border-white/10 bg-neutral-50/70 dark:bg-[#121215] p-2.5 space-y-2"
                      >
                        <div className="relative h-36 rounded-lg overflow-hidden bg-white dark:bg-[#19191d] border border-neutral-200/70 dark:border-white/[0.06] flex items-center justify-center">
                          <img
                            src={item.previewUrl}
                            alt={item.alt || item.file.name}
                            className="max-w-full max-h-full object-contain"
                          />
                          <button
                            type="button"
                            onClick={() => removeQueuedFile(item.id)}
                            aria-label={`Remove ${item.file.name}`}
                            title="Remove image"
                            className="absolute top-1.5 right-1.5 p-1 rounded-md bg-black/65 hover:bg-red-600 text-white transition-colors cursor-pointer"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                        <div className="space-y-1">
                          <input
                            type="text"
                            value={item.alt}
                            onChange={(e) => {
                              const nextAlt = e.target.value;
                              setQueuedFiles((prev) =>
                                prev.map((q) => (q.id === item.id ? { ...q, alt: nextAlt } : q))
                              );
                            }}
                            placeholder="Caption / Alt text..."
                            aria-label={`Caption for ${item.file.name}`}
                            className="w-full px-2.5 py-1.5 text-[12.5px] rounded-md border border-neutral-200 dark:border-white/10 bg-white dark:bg-[#17171b] text-neutral-900 dark:text-neutral-100 focus:outline-none focus:border-blue-500"
                          />
                          <div className="px-0.5 text-[11px] text-neutral-400 dark:text-neutral-500 truncate tabular-nums">
                            {item.file.name} · {Math.max(1, Math.round(item.file.size / 1024))} KB
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              <div>
                <label className="block text-[12.5px] font-medium text-neutral-600 dark:text-neutral-400 mb-1.5">
                  Image URLs (one or multiple lines)
                </label>
                <textarea
                  rows={2}
                  value={imageUrl}
                  onChange={(e) => setImageUrl(e.target.value)}
                  placeholder="https://example.com/diagram.png&#10;https://example.com/screenshot-2.png"
                  autoFocus
                  className="w-full px-3 py-2 text-[13.5px] rounded-lg border border-neutral-300 dark:border-white/12 bg-white dark:bg-[#111114] text-neutral-950 dark:text-white focus:outline-none focus:border-blue-500 resize-y"
                />
              </div>

              <div className="flex flex-col sm:flex-row gap-2">
                <input
                  type="text"
                  value={urlAlt}
                  onChange={(e) => setUrlAlt(e.target.value)}
                  placeholder="Optional caption / alt text"
                  className="flex-1 px-3 py-2 text-[13px] rounded-lg border border-neutral-300 dark:border-white/12 bg-white dark:bg-[#111114] text-neutral-950 dark:text-white focus:outline-none focus:border-blue-500"
                />
                <button
                  type="button"
                  onClick={handleAddCurrentUrl}
                  className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-lg text-[13px] font-medium border border-neutral-300 dark:border-white/15 text-neutral-700 dark:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-white/[0.06] transition-colors cursor-pointer whitespace-nowrap shrink-0"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Add to queue</span>
                </button>
              </div>

              {queuedUrls.length > 0 && (
                <div className="space-y-2 pt-1">
                  <div className="text-[12px] text-neutral-500 dark:text-neutral-400 tabular-nums">
                    Queued URLs ({queuedUrls.length})
                  </div>
                  <div className="space-y-1.5 max-h-48 overflow-y-auto">
                    {queuedUrls.map((item) => (
                      <div
                        key={item.id}
                        className="flex items-center gap-2.5 p-2 rounded-lg border border-neutral-200 dark:border-white/10 bg-neutral-50/70 dark:bg-[#121215]"
                      >
                        <img
                          src={item.url}
                          alt={item.alt}
                          referrerPolicy="no-referrer"
                          className="w-10 h-10 rounded object-cover bg-neutral-200 dark:bg-[#1e1e24] shrink-0"
                        />
                        <div className="min-w-0 flex-1 space-y-1">
                          <input
                            type="text"
                            value={item.alt}
                            onChange={(e) => {
                              const nextAlt = e.target.value;
                              setQueuedUrls((prev) =>
                                prev.map((q) => (q.id === item.id ? { ...q, alt: nextAlt } : q))
                              );
                            }}
                            aria-label="Caption for image URL"
                            className="w-full px-2 py-0.5 text-[12.5px] rounded border border-neutral-200 dark:border-white/10 bg-white dark:bg-[#17171b] text-neutral-900 dark:text-neutral-100 focus:outline-none focus:border-blue-500"
                          />
                          <div className="text-[11px] text-neutral-400 truncate">{item.url}</div>
                        </div>
                        <button
                          type="button"
                          onClick={() => removeQueuedUrl(item.id)}
                          aria-label="Remove queued URL"
                          className="p-1.5 rounded-md text-neutral-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-neutral-200/60 dark:hover:bg-white/[0.06] cursor-pointer shrink-0"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

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
              disabled={submitting || activeCount === 0}
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
