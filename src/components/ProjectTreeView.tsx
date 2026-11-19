import React, { useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  FileText,
  Folder as FolderIcon,
  FolderOpen,
  Loader2,
  Maximize2,
  Plus,
  X,
} from 'lucide-react';

export interface RemoteDirEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  size: number;
  modifiedAt: number | null;
}

export interface RemoteFilePreview {
  path: string;
  name: string;
  content: string;
  size: number;
  truncated: boolean;
  isBinary: boolean;
}

export function getFileIconColorClass(filename: string): string {
  const lower = filename.toLowerCase();
  if (lower === 'dockerfile' || lower.startsWith('dockerfile.')) return 'text-sky-400';
  if (lower === '.env' || lower.startsWith('.env.')) return 'text-amber-400';
  const ext = lower.includes('.') ? lower.split('.').pop() || '' : '';
  switch (ext) {
    case 'ts':
    case 'tsx':
      return 'text-blue-400';
    case 'js':
    case 'jsx':
    case 'mjs':
    case 'cjs':
      return 'text-amber-400';
    case 'json':
      return 'text-emerald-400';
    case 'py':
      return 'text-sky-400';
    case 'go':
      return 'text-cyan-400';
    case 'rs':
      return 'text-orange-400';
    case 'sh':
    case 'bash':
    case 'zsh':
      return 'text-green-400';
    case 'yml':
    case 'yaml':
    case 'toml':
      return 'text-purple-400';
    case 'css':
    case 'scss':
      return 'text-pink-400';
    case 'html':
    case 'xml':
    case 'svg':
      return 'text-rose-400';
    case 'sql':
      return 'text-orange-300';
    case 'md':
      return 'text-teal-400';
    default:
      return 'text-neutral-400';
  }
}

function formatBytesCompact(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

interface ProjectTreeViewProps {
  rootPath: string;
  dirCache: Record<string, RemoteDirEntry[]>;
  expandedDirs: Record<string, boolean>;
  loadingDirs: Record<string, boolean>;
  truncatedDirs?: Record<string, boolean>;
  selectedFilePath?: string | null;
  pendingFileStatuses?: Record<string, 'modified' | 'new' | 'accepted'>;
  gitFileStatuses?: Record<string, { letter: string; title: string; className: string }>;
  creatingInDir: string | null;
  onToggleDir: (dirPath: string) => void;
  onSelectFile: (filePath: string) => void;
  onOpenFileFullScreen?: (filePath: string) => void;
  onOpenInTerminal?: (dirPath: string) => void;
  onRequestCreateFile?: (dirPath: string) => void;
  onSubmitNewFile: (dirPath: string, filename: string) => void;
  onCancelNewFile: () => void;
  showFileSize?: boolean;
}

export function ProjectTreeView({
  rootPath,
  dirCache,
  expandedDirs,
  loadingDirs,
  truncatedDirs,
  selectedFilePath,
  pendingFileStatuses,
  gitFileStatuses,
  creatingInDir,
  onToggleDir,
  onSelectFile,
  onOpenFileFullScreen,
  onOpenInTerminal,
  onRequestCreateFile,
  onSubmitNewFile,
  onCancelNewFile,
  showFileSize = false,
}: ProjectTreeViewProps) {
  const [newFileName, setNewFileName] = useState('');

  const renderInlineNewFileInput = (targetDir: string, depth: number) => (
    <form
      key={`new-file-in-${targetDir}`}
      onSubmit={(e) => {
        e.preventDefault();
        const clean = newFileName.trim().replace(/^\/+/, '');
        if (!clean) return;
        setNewFileName('');
        onSubmitNewFile(targetDir, clean);
      }}
      style={{ paddingLeft: `${depth * 14 + 8}px` }}
      className="relative flex items-center gap-1 pr-1.5 py-1 my-0.5"
    >
      {Array.from({ length: depth }, (_, i) => (
        <span
          key={i}
          aria-hidden="true"
          style={{ left: `${i * 14 + 14}px` }}
          className="absolute top-0 bottom-0 border-l border-white/[0.08] pointer-events-none"
        />
      ))}
      <FileText className="w-3.5 h-3.5 text-blue-400 shrink-0 ml-4" />
      <input
        type="text"
        autoFocus
        value={newFileName}
        onChange={(e) => setNewFileName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation();
            setNewFileName('');
            onCancelNewFile();
          }
        }}
        placeholder="filename.ts"
        className="font-mono-code flex-1 min-w-0 px-1.5 py-0.5 text-[11.5px] rounded border border-blue-500/60 bg-[#0c0c10] text-white placeholder:text-neutral-500 focus:outline-none"
      />
      <button
        type="button"
        onClick={() => {
          setNewFileName('');
          onCancelNewFile();
        }}
        title="Cancel"
        className="p-0.5 text-neutral-400 hover:text-white cursor-pointer shrink-0"
      >
        <X className="w-3 h-3" />
      </button>
    </form>
  );

  const renderEntries = (entries: RemoteDirEntry[], depth: number): React.ReactNode =>
    entries.map((entry) => {
      const isExpanded = entry.isDirectory && Boolean(expandedDirs[entry.path]);
      const isLoading = entry.isDirectory && Boolean(loadingDirs[entry.path]);
      const childEntries = entry.isDirectory ? dirCache[entry.path] : undefined;
      const isTruncated = entry.isDirectory && Boolean(truncatedDirs?.[entry.path]);
      const isSelected = !entry.isDirectory && selectedFilePath === entry.path;

      return (
        <React.Fragment key={entry.path}>
          <div
            style={{ paddingLeft: `${depth * 14 + 6}px` }}
            className={`group relative flex items-center justify-between gap-1 pr-1.5 py-[3px] rounded-[5px] transition-colors ${
              isSelected
                ? 'bg-blue-600/20 text-white'
                : 'text-neutral-300 hover:bg-white/[0.06]'
            }`}
          >
            {/* Vertical VS Code / Cursor indent guides */}
            {Array.from({ length: depth }, (_, i) => (
              <span
                key={i}
                aria-hidden="true"
                style={{ left: `${i * 14 + 13}px` }}
                className="absolute top-0 bottom-0 border-l border-white/[0.08] group-hover:border-white/[0.14] pointer-events-none"
              />
            ))}

            <button
              type="button"
              onClick={() => {
                if (entry.isDirectory) {
                  onToggleDir(entry.path);
                } else {
                  onSelectFile(entry.path);
                }
              }}
              className="flex-1 min-w-0 flex items-center gap-1.5 text-left cursor-pointer py-[2px]"
            >
              {entry.isDirectory ? (
                <>
                  {isLoading ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-400 shrink-0" />
                  ) : isExpanded ? (
                    <ChevronDown className="w-3.5 h-3.5 text-neutral-400 shrink-0" />
                  ) : (
                    <ChevronRight className="w-3.5 h-3.5 text-neutral-500 shrink-0" />
                  )}
                  {isExpanded ? (
                    <FolderOpen className="w-3.5 h-3.5 text-blue-400 shrink-0" />
                  ) : (
                    <FolderIcon className="w-3.5 h-3.5 text-blue-400/90 shrink-0" />
                  )}
                </>
              ) : (
                <>
                  <span className="w-3.5 shrink-0" aria-hidden="true" />
                  <FileText
                    className={`w-3.5 h-3.5 shrink-0 ${getFileIconColorClass(entry.name)}`}
                  />
                </>
              )}

              <span
                className={`font-mono-code text-[12px] truncate ${
                  isSelected ? 'text-white font-medium' : 'text-neutral-200'
                }`}
              >
                {entry.name}
              </span>
            </button>

            {entry.isDirectory ? (
              <div className="opacity-0 group-hover:opacity-100 flex items-center gap-0.5 shrink-0 transition-opacity">
                {onRequestCreateFile && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setNewFileName('');
                      onRequestCreateFile(entry.path);
                    }}
                    title={`New file in ${entry.name}`}
                    className="p-0.5 rounded text-neutral-400 hover:text-white hover:bg-white/10 cursor-pointer"
                  >
                    <Plus className="w-3 h-3" />
                  </button>
                )}
                {onOpenInTerminal && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onOpenInTerminal(entry.path);
                    }}
                    title={`cd ${entry.path}`}
                    className="px-1 py-0.5 rounded text-[10px] font-mono-code text-blue-300 hover:bg-blue-500/20 cursor-pointer"
                  >
                    cd
                  </button>
                )}
              </div>
            ) : (
              <div className="flex items-center gap-1 shrink-0">
                {gitFileStatuses?.[entry.path] && !pendingFileStatuses?.[entry.path] && (
                  <span
                    title={`Git: ${gitFileStatuses[entry.path].title}`}
                    className={`font-mono-code text-[10px] font-semibold px-1 rounded ${gitFileStatuses[entry.path].className}`}
                  >
                    {gitFileStatuses[entry.path].letter}
                  </span>
                )}
                {pendingFileStatuses?.[entry.path] && (
                  <span
                    title={
                      pendingFileStatuses[entry.path] === 'new'
                        ? 'Pending AI new file'
                        : pendingFileStatuses[entry.path] === 'accepted'
                        ? 'AI change applied'
                        : 'Pending AI edits'
                    }
                    className={`font-mono-code text-[10px] font-semibold px-1 rounded ${
                      pendingFileStatuses[entry.path] === 'new'
                        ? 'text-emerald-300 bg-emerald-500/15'
                        : pendingFileStatuses[entry.path] === 'accepted'
                        ? 'text-blue-300 bg-blue-500/15'
                        : 'text-amber-300 bg-amber-500/15'
                    }`}
                  >
                    {pendingFileStatuses[entry.path] === 'new'
                      ? 'U'
                      : pendingFileStatuses[entry.path] === 'accepted'
                      ? '✓'
                      : 'M'}
                  </span>
                )}
                {onOpenFileFullScreen && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onOpenFileFullScreen(entry.path);
                    }}
                    title="Open in Full Screen Code Editor"
                    className="opacity-0 group-hover:opacity-100 p-0.5 rounded text-blue-300 hover:text-white hover:bg-blue-500/20 transition-opacity cursor-pointer"
                  >
                    <Maximize2 className="w-3 h-3" />
                  </button>
                )}
                {showFileSize && (
                  <span className="text-[10.5px] font-mono-code text-neutral-500 tabular-nums">
                    {formatBytesCompact(entry.size)}
                  </span>
                )}
              </div>
            )}
          </div>

          {entry.isDirectory && isExpanded && (
            <>
              {creatingInDir === entry.path && renderInlineNewFileInput(entry.path, depth + 1)}

              {isLoading && !childEntries && (
                <div
                  style={{ paddingLeft: `${(depth + 1) * 14 + 24}px` }}
                  className="py-1 text-[11px] text-neutral-500 flex items-center gap-1.5"
                >
                  <span>Loading...</span>
                </div>
              )}

              {childEntries && childEntries.length === 0 && !isLoading && (
                <div
                  style={{ paddingLeft: `${(depth + 1) * 14 + 24}px` }}
                  className="py-0.5 text-[11px] text-neutral-600 font-mono-code"
                >
                  (empty)
                </div>
              )}

              {childEntries && childEntries.length > 0 && renderEntries(childEntries, depth + 1)}

              {isTruncated && (
                <div
                  style={{ paddingLeft: `${(depth + 1) * 14 + 24}px` }}
                  className="py-0.5 text-[10.5px] text-neutral-500"
                >
                  Showing first 300 entries
                </div>
              )}
            </>
          )}
        </React.Fragment>
      );
    });

  const rootEntries = dirCache[rootPath] || [];
  const rootLoading = Boolean(loadingDirs[rootPath]);

  return (
    <div className="space-y-px select-none">
      {creatingInDir === rootPath && renderInlineNewFileInput(rootPath, 0)}

      {rootLoading && rootEntries.length === 0 && (
        <div className="flex items-center gap-2 px-2 py-2 text-[12px] text-neutral-400">
          <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-400" />
          <span>Loading project tree...</span>
        </div>
      )}

      {!rootLoading && rootEntries.length === 0 && rootPath && (
        <p className="text-[12px] text-neutral-500 px-2 py-4 text-center">Directory is empty.</p>
      )}

      {renderEntries(rootEntries, 0)}

      {Boolean(truncatedDirs?.[rootPath]) && (
        <p className="text-[11px] text-neutral-500 px-2 pt-2">Showing first 300 entries.</p>
      )}
    </div>
  );
}
