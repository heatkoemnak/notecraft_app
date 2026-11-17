const DB_NAME = 'notecraft-files-db';
const STORE_NAME = 'files';
const DB_VERSION = 1;

export const FILE_REF_PREFIX = 'notecraft-file://';
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024; // 10 MB

export interface StoredFileRecord {
  id: string;
  dataUrl: string;
  mimeType: string;
  name: string;
  sizeBytes: number;
  createdAt: number;
}

const memoryCache = new Map<string, StoredFileRecord>();
let fileIdSeq = 0;

function openFileDb(): Promise<IDBDatabase> {
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
    request.onerror = () => reject(request.error ?? new Error('Failed to open file store'));
  });
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
}

export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${Math.round(kb)} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(mb >= 10 ? 0 : 1)} MB`;
}

export function extractFileId(refOrId: string): string | null {
  if (!refOrId.startsWith(FILE_REF_PREFIX)) return null;
  return refOrId.slice(FILE_REF_PREFIX.length).trim() || null;
}

export function getCachedAttachmentFile(refOrId: string): StoredFileRecord | null {
  const id = refOrId.startsWith(FILE_REF_PREFIX) ? extractFileId(refOrId) : refOrId;
  if (!id) return null;
  return memoryCache.get(id) ?? null;
}

export function clearFileMemoryCache(): void {
  memoryCache.clear();
}

function getShareTokenQueryParam(): string {
  if (typeof window === 'undefined') return '';
  try {
    const params = new URLSearchParams(window.location.search);
    const token = params.get('share')?.trim();
    if (token) return `?shareToken=${encodeURIComponent(token)}`;
    const match = window.location.pathname.match(/^\/share\/([^/]+)/);
    if (match?.[1]) return `?shareToken=${encodeURIComponent(decodeURIComponent(match[1]))}`;
  } catch {
    // ignore URL parsing errors
  }
  return '';
}

export async function getAttachmentFile(refOrId: string): Promise<StoredFileRecord | null> {
  const id = refOrId.startsWith(FILE_REF_PREFIX) ? extractFileId(refOrId) : refOrId;
  if (!id) return null;

  const cached = memoryCache.get(id);
  if (cached) return cached;

  try {
    const db = await openFileDb();
    const localRecord = await new Promise<StoredFileRecord | null>((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(id);
      req.onsuccess = () => {
        const record = req.result as StoredFileRecord | undefined;
        if (record?.dataUrl) {
          memoryCache.set(id, record);
          resolve(record);
        } else {
          resolve(null);
        }
      };
      req.onerror = () => resolve(null);
    });
    if (localRecord) return localRecord;
  } catch {
    // Fall through to server lookup
  }

  try {
    const res = await fetch(`/api/files/${encodeURIComponent(id)}${getShareTokenQueryParam()}`, {
      credentials: 'same-origin',
    });
    if (res.ok) {
      const json = (await res.json()) as {
        dataUrl?: string;
        mimeType?: string;
        name?: string;
        sizeBytes?: number;
      };
      if (json.dataUrl && json.name) {
        const record: StoredFileRecord = {
          id,
          dataUrl: json.dataUrl,
          mimeType: json.mimeType || 'application/octet-stream',
          name: json.name,
          sizeBytes: Number(json.sizeBytes || 0),
          createdAt: Date.now(),
        };
        memoryCache.set(id, record);
        return record;
      }
    }
  } catch {
    // Ignore when server endpoint is unavailable
  }

  return null;
}

export async function saveAttachmentFile(file: File): Promise<{
  id: string;
  refUrl: string;
  name: string;
  sizeBytes: number;
  label: string;
}> {
  if (file.size > MAX_ATTACHMENT_BYTES) {
    throw new Error(`"${file.name}" exceeds the 10 MB attachment limit.`);
  }

  const dataUrl = await readFileAsDataUrl(file);
  fileIdSeq += 1;
  const id = `file-${Date.now()}-${fileIdSeq}-${Math.random().toString(36).slice(2, 7)}`;
  const createdAt = Date.now();
  const mimeType = file.type || 'application/octet-stream';
  const name = file.name || 'attachment';
  const sizeBytes = file.size || 0;

  const record: StoredFileRecord = {
    id,
    dataUrl,
    mimeType,
    name,
    sizeBytes,
    createdAt,
  };
  memoryCache.set(id, record);

  try {
    const db = await openFileDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.put(record);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch {
    // Keep in-memory entry if IndexedDB fails
  }

  try {
    await fetch('/api/files', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(record),
    });
  } catch {
    // Ignore when backend PostgreSQL is not active
  }

  const safeName = name.replace(/[\[\]]/g, '');
  const label = `${safeName} · ${formatFileSize(sizeBytes)}`;

  return {
    id,
    refUrl: `${FILE_REF_PREFIX}${id}`,
    name,
    sizeBytes,
    label,
  };
}
