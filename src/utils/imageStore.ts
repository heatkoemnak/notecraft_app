const DB_NAME = 'notecraft-images-db';
const STORE_NAME = 'images';
const DB_VERSION = 1;

export const IMAGE_REF_PREFIX = 'notecraft-img://';

interface StoredImageRecord {
  id: string;
  dataUrl: string;
  mimeType: string;
  name: string;
  createdAt: number;
}

const memoryCache = new Map<string, string>();

function openImageDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is unavailable'));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Failed to open image store'));
  });
}

function readFileAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read image file'));
    reader.readAsDataURL(file);
  });
}

async function optimizeImageToDataUrl(file: File): Promise<string> {
  const rawDataUrl = await readFileAsDataUrl(file);
  // Keep SVG and GIF untouched so vector graphics and animations stay intact
  if (file.type === 'image/svg+xml' || file.type === 'image/gif') {
    return rawDataUrl;
  }

  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const maxDim = 1600;
      const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
      if (scale === 1 && file.size <= 450 * 1024) {
        resolve(rawDataUrl);
        return;
      }

      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(img.width * scale));
      canvas.height = Math.max(1, Math.round(img.height * scale));
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve(rawDataUrl);
        return;
      }
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      const outputMime = file.type === 'image/png' ? 'image/png' : 'image/webp';
      const compressed = canvas.toDataURL(outputMime, 0.86);
      resolve(compressed.length < rawDataUrl.length ? compressed : rawDataUrl);
    };
    img.onerror = () => resolve(rawDataUrl);
    img.src = rawDataUrl;
  });
}

export function extractImageId(src: string): string | null {
  if (!src.startsWith(IMAGE_REF_PREFIX)) return null;
  return src.slice(IMAGE_REF_PREFIX.length).trim() || null;
}

export function getCachedImageDataUrl(refOrId: string): string | null {
  const id = refOrId.startsWith(IMAGE_REF_PREFIX) ? extractImageId(refOrId) : refOrId;
  if (!id) return null;
  return memoryCache.get(id) ?? null;
}

export function clearImageMemoryCache(): void {
  memoryCache.clear();
}

export async function getImageDataUrl(refOrId: string): Promise<string | null> {
  const id = refOrId.startsWith(IMAGE_REF_PREFIX) ? extractImageId(refOrId) : refOrId;
  if (!id) return null;

  const cached = memoryCache.get(id);
  if (cached) return cached;

  try {
    const db = await openImageDb();
    const localResult = await new Promise<string | null>((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(id);
      req.onsuccess = () => {
        const record = req.result as StoredImageRecord | undefined;
        if (record?.dataUrl) {
          memoryCache.set(id, record.dataUrl);
          resolve(record.dataUrl);
        } else {
          resolve(null);
        }
      };
      req.onerror = () => resolve(null);
    });
    if (localResult) return localResult;
  } catch {
    // Fall through to server lookup
  }

  try {
    const res = await fetch(`/api/images/${encodeURIComponent(id)}`, {
      credentials: 'same-origin',
    });
    if (res.ok) {
      const json = (await res.json()) as { dataUrl?: string };
      if (json.dataUrl) {
        memoryCache.set(id, json.dataUrl);
        return json.dataUrl;
      }
    }
  } catch {
    // Ignore when server image endpoint is unavailable
  }

  return null;
}

export async function saveImageFile(
  file: File,
  customAlt?: string
): Promise<{ id: string; refUrl: string; alt: string }> {
  const dataUrl = await optimizeImageToDataUrl(file);
  const id = `img-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const cleanName = file.name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').trim();
  const alt = (customAlt || cleanName || 'Screenshot').trim();

  memoryCache.set(id, dataUrl);

  const createdAt = Date.now();
  const mimeType = file.type || 'image/png';
  const name = file.name || 'image.png';

  try {
    const db = await openImageDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const record: StoredImageRecord = {
        id,
        dataUrl,
        mimeType,
        name,
        createdAt,
      };
      const req = store.put(record);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch {
    // Keep memoryCache entry so image still works in current session if IndexedDB fails
  }

  try {
    await fetch('/api/images', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, dataUrl, mimeType, name, createdAt }),
    });
  } catch {
    // Ignore when backend PostgreSQL is not active
  }

  return {
    id,
    refUrl: `${IMAGE_REF_PREFIX}${id}`,
    alt,
  };
}

export async function resolveMarkdownImagesForExport(markdown: string): Promise<string> {
  const matches = Array.from(markdown.matchAll(/notecraft-img:\/\/([A-Za-z0-9_-]+)/g));
  if (matches.length === 0) return markdown;

  let resolved = markdown;
  const uniqueIds = Array.from(new Set(matches.map((m) => m[1])));
  for (const id of uniqueIds) {
    const dataUrl = await getImageDataUrl(id);
    if (dataUrl) {
      resolved = resolved.split(`${IMAGE_REF_PREFIX}${id}`).join(dataUrl);
    }
  }
  return resolved;
}
