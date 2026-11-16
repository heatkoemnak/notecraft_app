import React, { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, ImageOff, X } from 'lucide-react';
import {
  getCachedImageDataUrl,
  getImageDataUrl,
  IMAGE_REF_PREFIX,
} from '../utils/imageStore';

export interface LightboxImageItem {
  src: string;
  alt: string;
}

interface ImageLightboxProps {
  items: LightboxImageItem[];
  initialIndex: number;
  onClose: () => void;
}

export function ImageLightbox({ items, initialIndex, onClose }: ImageLightboxProps) {
  const [index, setIndex] = useState(() =>
    Math.max(0, Math.min(initialIndex, Math.max(0, items.length - 1)))
  );
  const current = items[index] ?? null;

  const initialCached =
    current && current.src.startsWith(IMAGE_REF_PREFIX)
      ? getCachedImageDataUrl(current.src)
      : current?.src ?? null;
  const [resolvedSrc, setResolvedSrc] = useState<string | null>(initialCached);
  const [loading, setLoading] = useState<boolean>(
    Boolean(current && current.src.startsWith(IMAGE_REF_PREFIX) && !initialCached)
  );
  const [failed, setFailed] = useState<boolean>(!current?.src);

  useEffect(() => {
    setIndex(Math.max(0, Math.min(initialIndex, Math.max(0, items.length - 1))));
  }, [initialIndex, items.length]);

  useEffect(() => {
    let active = true;
    if (!current?.src) {
      setResolvedSrc(null);
      setFailed(true);
      setLoading(false);
      return;
    }

    if (!current.src.startsWith(IMAGE_REF_PREFIX)) {
      setResolvedSrc(current.src);
      setFailed(false);
      setLoading(false);
      return;
    }

    const cached = getCachedImageDataUrl(current.src);
    if (cached) {
      setResolvedSrc(cached);
      setFailed(false);
      setLoading(false);
      return;
    }

    setLoading(true);
    setFailed(false);
    getImageDataUrl(current.src).then((dataUrl) => {
      if (!active) return;
      if (dataUrl) {
        setResolvedSrc(dataUrl);
        setFailed(false);
      } else {
        setResolvedSrc(null);
        setFailed(true);
      }
      setLoading(false);
    });

    return () => {
      active = false;
    };
  }, [current?.src]);

  const hasMultiple = items.length > 1;

  const goPrev = () => {
    if (!hasMultiple) return;
    setIndex((prev) => (prev - 1 + items.length) % items.length);
  };

  const goNext = () => {
    if (!hasMultiple) return;
    setIndex((prev) => (prev + 1) % items.length);
  };

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      } else if (e.key === 'ArrowLeft' && hasMultiple) {
        e.preventDefault();
        setIndex((prev) => (prev - 1 + items.length) % items.length);
      } else if (e.key === 'ArrowRight' && hasMultiple) {
        e.preventDefault();
        setIndex((prev) => (prev + 1) % items.length);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [hasMultiple, items.length, onClose]);

  if (!current) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/88 p-4 sm:p-8"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={current.alt || 'Image preview'}
    >
      {hasMultiple && (
        <div
          className="absolute top-4 left-4 px-2.5 py-1 rounded-md bg-white/10 text-white/90 text-[12.5px] font-medium tabular-nums select-none"
          onClick={(e) => e.stopPropagation()}
        >
          {index + 1} / {items.length}
        </div>
      )}

      <button
        type="button"
        onClick={onClose}
        aria-label="Close image preview"
        className="absolute top-4 right-4 p-2 rounded-lg bg-white/10 hover:bg-white/20 text-white transition-colors cursor-pointer"
      >
        <X className="w-5 h-5" />
      </button>

      {hasMultiple && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            goPrev();
          }}
          aria-label="Previous image"
          className="absolute left-3 sm:left-5 top-1/2 -translate-y-1/2 p-2.5 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors cursor-pointer"
        >
          <ChevronLeft className="w-5 h-5" />
        </button>
      )}

      <div
        className="max-w-full max-h-[82vh] flex items-center justify-center"
        onClick={(e) => e.stopPropagation()}
      >
        {loading ? (
          <div className="w-64 h-48 rounded-xl bg-white/10 animate-pulse" />
        ) : failed || !resolvedSrc ? (
          <div className="flex flex-col items-center gap-2 px-6 py-8 rounded-xl bg-white/10 text-white/80">
            <ImageOff className="w-7 h-7" />
            <span className="text-[13px]">Image unavailable</span>
          </div>
        ) : (
          <img
            src={resolvedSrc}
            alt={current.alt || 'Embedded note image'}
            referrerPolicy="no-referrer"
            onError={() => setFailed(true)}
            className="max-w-full max-h-[82vh] rounded-xl object-contain shadow-2xl"
          />
        )}
      </div>

      {hasMultiple && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            goNext();
          }}
          aria-label="Next image"
          className="absolute right-3 sm:right-5 top-1/2 -translate-y-1/2 p-2.5 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors cursor-pointer"
        >
          <ChevronRight className="w-5 h-5" />
        </button>
      )}

      {current.alt && (
        <p
          className="mt-3 text-[13px] text-white/80 text-center max-w-xl truncate px-4"
          onClick={(e) => e.stopPropagation()}
        >
          {current.alt}
        </p>
      )}
    </div>
  );
}
