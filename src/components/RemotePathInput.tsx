import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Folder } from 'lucide-react';
import type { RemoteDirEntry } from './ProjectTreeView';

interface RemotePathInputProps {
  value: string;
  onChange: (nextValue: string) => void;
  onSyncDirectory: (dirPath: string) => void;
  dirCache: Record<string, RemoteDirEntry[]>;
  fetchDirEntries?: (dirPath: string) => Promise<{ path: string; entries: RemoteDirEntry[] }>;
  currentRemotePath?: string;
  disabled?: boolean;
  placeholder?: string;
  ariaLabel?: string;
  inputClassName?: string;
}

function splitInputPath(
  rawValue: string,
  currentRemotePath?: string
): { parentDir: string; prefix: string; endsWithSlash: boolean } {
  const trimmed = rawValue.trimStart();
  if (!trimmed) {
    const base = currentRemotePath?.trim() || '/';
    return { parentDir: base, prefix: '', endsWithSlash: true };
  }

  const endsWithSlash = trimmed.endsWith('/');
  if (endsWithSlash) {
    const cleanDir = trimmed === '/' ? '/' : trimmed.replace(/\/+$/, '');
    return { parentDir: cleanDir || '/', prefix: '', endsWithSlash: true };
  }

  const lastSlash = trimmed.lastIndexOf('/');
  if (lastSlash === -1) {
    if (trimmed === '~') {
      return { parentDir: '~', prefix: '', endsWithSlash: false };
    }
    const base = currentRemotePath?.trim() || '~';
    return { parentDir: base, prefix: trimmed, endsWithSlash: false };
  }

  const rawParent = trimmed.slice(0, lastSlash);
  const parentDir = rawParent === '' ? '/' : rawParent;
  const prefix = trimmed.slice(lastSlash + 1);
  return { parentDir, prefix, endsWithSlash: false };
}

function findLongestCommonPrefix(strings: string[]): string {
  if (strings.length === 0) return '';
  let prefix = strings[0];
  for (let i = 1; i < strings.length; i += 1) {
    const cur = strings[i];
    let j = 0;
    while (j < prefix.length && j < cur.length && prefix[j] === cur[j]) {
      j += 1;
    }
    prefix = prefix.slice(0, j);
    if (!prefix) break;
  }
  return prefix;
}

function joinDirAndChild(resolvedParent: string, childName: string, trailingSlash = true): string {
  const cleanParent = resolvedParent === '/' ? '' : resolvedParent.replace(/\/+$/, '');
  return `${cleanParent}/${childName}${trailingSlash ? '/' : ''}`;
}

export function RemotePathInput({
  value,
  onChange,
  onSyncDirectory,
  dirCache,
  fetchDirEntries,
  currentRemotePath,
  disabled = false,
  placeholder = '/home/user/project',
  ariaLabel = 'Remote project directory path',
  inputClassName,
}: RemotePathInputProps) {
  const [focused, setFocused] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [highlightIdx, setHighlightIdx] = useState<number>(-1);
  const [localEntriesMap, setLocalEntriesMap] = useState<
    Record<string, { resolvedPath: string; entries: RemoteDirEntry[] }>
  >({});

  const wrapperRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const inflightRef = useRef<Set<string>>(new Set());

  const parsed = useMemo(
    () => splitInputPath(value, currentRemotePath),
    [value, currentRemotePath]
  );

  const lookupCachedParent = useCallback(
    (rawParent: string): { resolvedPath: string; entries: RemoteDirEntry[] } | null => {
      const clean = rawParent === '/' ? '/' : rawParent.replace(/\/+$/, '');
      if (dirCache[clean]) {
        return { resolvedPath: clean, entries: dirCache[clean] };
      }
      if (dirCache[rawParent]) {
        return { resolvedPath: rawParent, entries: dirCache[rawParent] };
      }
      if (localEntriesMap[clean]) {
        return localEntriesMap[clean];
      }
      if (localEntriesMap[rawParent]) {
        return localEntriesMap[rawParent];
      }
      return null;
    },
    [dirCache, localEntriesMap]
  );

  const loadParentQuietly = useCallback(
    async (
      rawParent: string
    ): Promise<{ resolvedPath: string; entries: RemoteDirEntry[] } | null> => {
      const existing = lookupCachedParent(rawParent);
      if (existing) return existing;
      if (!fetchDirEntries) return null;

      const key = rawParent === '/' ? '/' : rawParent.replace(/\/+$/, '');
      if (inflightRef.current.has(key)) return null;
      inflightRef.current.add(key);

      try {
        const res = await fetchDirEntries(key || '/');
        const record = { resolvedPath: res.path, entries: res.entries };
        setLocalEntriesMap((prev) => ({
          ...prev,
          [key]: record,
          [res.path]: record,
        }));
        return record;
      } catch {
        return null;
      } finally {
        inflightRef.current.delete(key);
      }
    },
    [lookupCachedParent, fetchDirEntries]
  );

  // Quietly prefetch directory entries as user types a parent folder
  useEffect(() => {
    if (!focused || disabled || !fetchDirEntries) return;
    if (!value.includes('/') && !value.startsWith('~')) return;
    const timer = window.setTimeout(() => {
      void loadParentQuietly(parsed.parentDir);
    }, 110);
    return () => window.clearTimeout(timer);
  }, [focused, disabled, fetchDirEntries, value, parsed.parentDir, loadParentQuietly]);

  // Close dropdown on outside pointerdown
  useEffect(() => {
    if (!dropdownOpen) return;
    const handlePointerDown = (e: PointerEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
        setHighlightIdx(-1);
      }
    };
    window.addEventListener('pointerdown', handlePointerDown);
    return () => window.removeEventListener('pointerdown', handlePointerDown);
  }, [dropdownOpen]);

  const parentRecord = useMemo(
    () => lookupCachedParent(parsed.parentDir),
    [lookupCachedParent, parsed.parentDir]
  );

  const matchingFolders = useMemo(() => {
    if (!parentRecord) return [];
    const dirs = parentRecord.entries.filter((entry) => entry.isDirectory);
    if (!parsed.prefix) return dirs.slice(0, 25);
    const exact = dirs.filter((d) => d.name.startsWith(parsed.prefix));
    if (exact.length > 0) return exact.slice(0, 25);
    const lowerPrefix = parsed.prefix.toLowerCase();
    return dirs.filter((d) => d.name.toLowerCase().startsWith(lowerPrefix)).slice(0, 25);
  }, [parentRecord, parsed.prefix]);

  const applyCompletedDirectory = useCallback(
    (resolvedParentPath: string, folderName: string) => {
      const completedPath = joinDirAndChild(resolvedParentPath, folderName, true);
      const syncTarget = completedPath === '/' ? '/' : completedPath.replace(/\/+$/, '');
      onChange(completedPath);
      onSyncDirectory(syncTarget);
      setHighlightIdx(-1);
      setDropdownOpen(true);
      // Pre-load contents of newly completed directory so subsequent Tab works right away
      void loadParentQuietly(syncTarget);
    },
    [onChange, onSyncDirectory, loadParentQuietly]
  );

  const handleTabComplete = async () => {
    if (disabled) return;

    const record = await loadParentQuietly(parsed.parentDir);
    if (!record) return;

    const dirs = record.entries.filter((entry) => entry.isDirectory);
    if (dirs.length === 0) return;

    const prefix = parsed.prefix;
    let matches = prefix ? dirs.filter((d) => d.name.startsWith(prefix)) : dirs;
    if (matches.length === 0 && prefix) {
      const low = prefix.toLowerCase();
      matches = dirs.filter((d) => d.name.toLowerCase().startsWith(low));
    }
    if (matches.length === 0) return;

    // If dropdown has an actively highlighted suggestion, pick it
    if (dropdownOpen && highlightIdx >= 0 && highlightIdx < matches.length) {
      applyCompletedDirectory(record.resolvedPath, matches[highlightIdx].name);
      return;
    }

    // If exactly 1 match or exact folder match typed without trailing slash
    const exactSingle = matches.find((m) => m.name === prefix);
    if (matches.length === 1) {
      applyCompletedDirectory(record.resolvedPath, matches[0].name);
      return;
    }

    if (exactSingle) {
      applyCompletedDirectory(record.resolvedPath, exactSingle.name);
      return;
    }

    // Multiple matches: extend to longest common prefix if longer than typed prefix
    const common = findLongestCommonPrefix(matches.map((m) => m.name));
    if (common.length > prefix.length) {
      const nextVal = joinDirAndChild(record.resolvedPath, common, false);
      onChange(nextVal);
      setDropdownOpen(true);
      setHighlightIdx(0);
      return;
    }

    // Otherwise open suggestions & cycle highlight / fill first if already open
    if (!dropdownOpen) {
      setDropdownOpen(true);
      setHighlightIdx(0);
    } else {
      const nextIdx = (highlightIdx + 1) % matches.length;
      setHighlightIdx(nextIdx);
      const picked = matches[nextIdx];
      if (picked) {
        applyCompletedDirectory(record.resolvedPath, picked.name);
      }
    }
  };

  return (
    <div ref={wrapperRef} className="relative flex-1 min-w-0">
      <input
        ref={inputRef}
        type="text"
        disabled={disabled}
        value={value}
        onFocus={() => {
          setFocused(true);
          if (fetchDirEntries) {
            void loadParentQuietly(parsed.parentDir);
          }
        }}
        onBlur={() => setFocused(false)}
        onChange={(e) => {
          onChange(e.target.value);
          setHighlightIdx(-1);
          setDropdownOpen(true);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Tab') {
            e.preventDefault();
            void handleTabComplete();
            return;
          }
          if (e.key === 'ArrowDown' && matchingFolders.length > 0) {
            e.preventDefault();
            setDropdownOpen(true);
            setHighlightIdx((prev) => (prev + 1) % matchingFolders.length);
            return;
          }
          if (e.key === 'ArrowUp' && matchingFolders.length > 0 && dropdownOpen) {
            e.preventDefault();
            setHighlightIdx((prev) =>
              prev <= 0 ? matchingFolders.length - 1 : prev - 1
            );
            return;
          }
          if (e.key === 'Escape' && dropdownOpen) {
            e.stopPropagation();
            setDropdownOpen(false);
            setHighlightIdx(-1);
            return;
          }
          if (
            e.key === 'Enter' &&
            dropdownOpen &&
            highlightIdx >= 0 &&
            highlightIdx < matchingFolders.length
          ) {
            e.preventDefault();
            const picked = matchingFolders[highlightIdx];
            if (parentRecord && picked) {
              applyCompletedDirectory(parentRecord.resolvedPath, picked.name);
            }
          }
        }}
        placeholder={placeholder}
        aria-label={ariaLabel}
        title="Type folder name and press Tab to autocomplete and switch directory"
        className={
          inputClassName ||
          'font-mono-code w-full min-w-0 px-2.5 py-1 text-[12px] rounded-md border border-white/12 bg-[#0c0c0f] text-neutral-100 placeholder:text-neutral-500 focus:outline-none focus:border-blue-500'
        }
      />

      {dropdownOpen && focused && matchingFolders.length > 0 && parentRecord && (
        <div className="absolute left-0 right-0 top-full mt-1 z-40 max-h-52 overflow-y-auto rounded-lg border border-white/15 bg-[#16161e] shadow-2xl py-1">
          <div className="px-2.5 py-1 border-b border-white/[0.06] flex items-center justify-between text-[10px] text-neutral-500">
            <span className="truncate font-mono-code">{parentRecord.resolvedPath}</span>
            <span className="shrink-0 ml-2">Tab to complete</span>
          </div>
          {matchingFolders.map((folder, idx) => {
            const active = idx === highlightIdx;
            return (
              <button
                key={folder.path}
                type="button"
                onMouseDown={(e) => {
                  // Prevent blur before click applies
                  e.preventDefault();
                  applyCompletedDirectory(parentRecord.resolvedPath, folder.name);
                  inputRef.current?.focus();
                }}
                className={`w-full px-2.5 py-1.5 flex items-center gap-2 text-left text-[11.5px] font-mono-code cursor-pointer transition-colors ${
                  active
                    ? 'bg-blue-600/25 text-white'
                    : 'text-neutral-200 hover:bg-white/[0.07]'
                }`}
              >
                <Folder className="w-3.5 h-3.5 text-blue-400 shrink-0" />
                <span className="truncate">{folder.name}/</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
