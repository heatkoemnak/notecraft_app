import React, { useEffect, useRef, useState } from 'react';
import { ImagePlus, Link as LinkIcon, Upload, X } from 'lucide-react';
import { saveImageFile } from '../utils/imageStore';

interface ImageInsertModalProps {
  isOpen: boolean;
  onClose: () => void;
  onInsert: (markdownImage: string) => void;
}

export function ImageInsertModal({ isOpen, onClose, onInsert }: ImageInsertModalProps) {
  const [tab, setTab] = useState<'upload' | 'url'>('upload');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [imageUrl, setImageUrl] = useState('');
  const [altText, setAltText] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isOpen) {
      setSelectedFile(null);
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      setPreviewUrl(null);
      setImageUrl('');
      setAltText('');
      setErrorMsg(null);
      setSubmitting(false);
      setTab('upload');
    }
  }, [isOpen]);

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  if (!isOpen) return null;

  const handleFilePick = (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setErrorMsg('Please choose a valid image file (PNG, JPG, WebP, GIF, or SVG).');
      return;
    }
    setErrorMsg(null);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    const nextPreview = URL.createObjectURL(file);
    setSelectedFile(file);
    setPreviewUrl(nextPreview);
    if (!altText.trim()) {
      const cleanName = file.name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').trim();
      setAltText(cleanName || 'Screenshot');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    if (tab === 'upload') {
      if (!selectedFile) {
        setErrorMsg('Select or drop an image file first.');
        return;
      }
      setSubmitting(true);
      try {
        const saved = await saveImageFile(selectedFile, altText);
        const safeAlt = saved.alt.replace(/[\[\]]/g, '');
        onInsert(`![${safeAlt}](${saved.refUrl})`);
        onClose();
      } catch {
        setErrorMsg('Could not process this image file.');
        setSubmitting(false);
      }
      return;
    }

    const trimmedUrl = imageUrl.trim();
    if (!trimmedUrl) {
      setErrorMsg('Enter an image URL.');
      return;
    }
    const safeAlt = (altText.trim() || 'Image').replace(/[\[\]]/g, '');
    onInsert(`![${safeAlt}](${trimmedUrl})`);
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="image-insert-modal-title"
    >
      <div
        className="w-full max-w-lg rounded-2xl border border-neutral-200 dark:border-white/10 bg-white dark:bg-[#17171b] shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-neutral-200 dark:border-white/[0.08]">
          <h2 id="image-insert-modal-title" className="text-[15.5px] font-semibold text-neutral-950 dark:text-white">
            Insert image
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close insert image modal"
            className="p-1.5 rounded-lg text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-white hover:bg-neutral-100 dark:hover:bg-white/[0.06] cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
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
              <span>Upload file</span>
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
              <span>Image URL</span>
            </button>
          </div>

          {tab === 'upload' ? (
            <div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => handleFilePick(e.target.files?.[0])}
              />
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setIsDragging(true);
                }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setIsDragging(false);
                  handleFilePick(e.dataTransfer.files?.[0]);
                }}
                onClick={() => fileInputRef.current?.click()}
                className={`rounded-xl border border-dashed p-5 text-center transition-colors cursor-pointer ${
                  isDragging
                    ? 'border-blue-500 bg-blue-500/5'
                    : 'border-neutral-300 dark:border-white/15 bg-neutral-50/70 dark:bg-[#121215] hover:border-neutral-400 dark:hover:border-white/25'
                }`}
              >
                {previewUrl ? (
                  <div className="space-y-3">
                    <img
                      src={previewUrl}
                      alt={altText || 'Selected image preview'}
                      className="max-h-52 mx-auto rounded-lg border border-neutral-200 dark:border-white/10 object-contain"
                    />
                    <p className="text-[12.5px] text-neutral-500 dark:text-neutral-400 truncate">
                      {selectedFile?.name} · Click or drop to replace
                    </p>
                  </div>
                ) : (
                  <div className="py-5 space-y-2">
                    <ImagePlus className="w-7 h-7 mx-auto text-neutral-400 dark:text-neutral-500" />
                    <p className="text-[13.5px] font-medium text-neutral-800 dark:text-neutral-200">
                      Click to upload or drag &amp; drop an image
                    </p>
                    <p className="text-[12px] text-neutral-500 dark:text-neutral-400">
                      PNG, JPG, WebP, GIF, or SVG · You can also paste screenshots directly in the editor
                    </p>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div>
                <label className="block text-[12.5px] font-medium text-neutral-600 dark:text-neutral-400 mb-1.5">
                  Image URL or path
                </label>
                <input
                  type="text"
                  value={imageUrl}
                  onChange={(e) => setImageUrl(e.target.value)}
                  placeholder="https://example.com/diagram.png or /assets/diagram.png"
                  autoFocus
                  className="w-full px-3 py-2 text-[13.5px] rounded-lg border border-neutral-300 dark:border-white/12 bg-white dark:bg-[#111114] text-neutral-950 dark:text-white focus:outline-none focus:border-blue-500"
                />
              </div>
              {imageUrl.trim() && (
                <div className="rounded-xl border border-neutral-200 dark:border-white/10 bg-neutral-50 dark:bg-[#121215] p-3">
                  <img
                    src={imageUrl.trim()}
                    alt={altText || 'URL preview'}
                    referrerPolicy="no-referrer"
                    className="max-h-44 mx-auto rounded-lg object-contain"
                  />
                </div>
              )}
            </div>
          )}

          <div>
            <label className="block text-[12.5px] font-medium text-neutral-600 dark:text-neutral-400 mb-1.5">
              Caption / Alt text
            </label>
            <input
              type="text"
              value={altText}
              onChange={(e) => setAltText(e.target.value)}
              placeholder="e.g. Portainer cluster dashboard overview"
              className="w-full px-3 py-2 text-[13.5px] rounded-lg border border-neutral-300 dark:border-white/12 bg-white dark:bg-[#111114] text-neutral-950 dark:text-white focus:outline-none focus:border-blue-500"
            />
          </div>

          {errorMsg && (
            <p className="text-[12.5px] text-red-600 dark:text-red-400">{errorMsg}</p>
          )}

          <div className="flex items-center justify-end gap-2.5 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg text-[13.5px] font-medium text-neutral-600 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-white/[0.06] transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-4 py-2 rounded-lg text-[13.5px] font-medium bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white transition-colors cursor-pointer"
            >
              {submitting ? 'Adding...' : 'Insert image'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
