import React, { useState } from 'react';
import {
  Braces,
  Check,
  ChevronDown,
  ChevronRight,
  FileText,
  Folder as FolderIcon,
  FolderPlus,
  LogOut,
  Moon,
  PanelLeftClose,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Star,
  Sun,
  Trash2,
  Upload,
  Users,
  X,
} from 'lucide-react';
import { AuthUser, Folder, NoteDocument, SidebarFilter } from '../types/notes';
import { UserSettingsModal } from './UserSettingsModal';

interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
  folders: Folder[];
  notes: NoteDocument[];
  sharedNotes: NoteDocument[];
  snippetCount: number;
  activeNoteId: string | null;
  filter: SidebarFilter;
  theme: 'dark' | 'light';
  user: AuthUser;
  onLogout: () => void;
  onToggleTheme: () => void;
  onOpenSearch: () => void;
  onSelectFilter: (filter: SidebarFilter) => void;
  onSelectNote: (noteId: string) => void;
  onRefreshShared: () => void;
  onCreateNote: (folderId?: string | null) => void;
  onDeleteNote: (noteId: string) => void;
  onToggleStar: (noteId: string) => void;
  onCreateFolder: (name: string) => void;
  onRenameFolder: (folderId: string, name: string) => void;
  onDeleteFolder: (folderId: string) => void;
  onOpenImportModal: () => void;
  onDropImportFiles?: (files: File[]) => void;
}

export function Sidebar({
  isOpen,
  onClose,
  folders,
  notes,
  sharedNotes,
  snippetCount,
  activeNoteId,
  filter,
  theme,
  user,
  onLogout,
  onToggleTheme,
  onOpenSearch,
  onSelectFilter,
  onSelectNote,
  onRefreshShared,
  onCreateNote,
  onDeleteNote,
  onToggleStar,
  onCreateFolder,
  onRenameFolder,
  onDeleteFolder,
  onOpenImportModal,
  onDropImportFiles,
}: SidebarProps) {
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [renamingFolderId, setRenamingFolderId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [confirmDeleteNoteId, setConfirmDeleteNoteId] = useState<string | null>(null);
  const [confirmDeleteFolderId, setConfirmDeleteFolderId] = useState<string | null>(null);
  const [sharedExpanded, setSharedExpanded] = useState(true);
  const [isDraggingFiles, setIsDraggingFiles] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const starredCount = notes.filter((n) => n.starred).length;

  const visibleNotes = (() => {
    let list = [...notes];
    if (filter.type === 'starred') {
      list = list.filter((n) => n.starred);
    } else if (filter.type === 'folder') {
      list = list.filter((n) => n.folderId === filter.folderId);
    }
    return list.sort((a, b) => b.updatedAt - a.updatedAt);
  })();

  const handleCreateFolderSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newFolderName.trim();
    if (trimmed) {
      onCreateFolder(trimmed);
      setNewFolderName('');
      setCreatingFolder(false);
    }
  };

  const handleRenameSubmit = (e: React.FormEvent, folderId: string) => {
    e.preventDefault();
    const trimmed = renameDraft.trim();
    if (trimmed) {
      onRenameFolder(folderId, trimmed);
    }
    setRenamingFolderId(null);
  };

  const activeFolderId = filter.type === 'folder' ? filter.folderId : null;

  return (
    <>
      {/* Mobile backdrop */}
      {isOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/50 lg:hidden"
          onClick={onClose}
          aria-hidden="true"
        />
      )}

      <aside
        onDragOver={(e) => {
          if (onDropImportFiles && e.dataTransfer.types.includes('Files')) {
            e.preventDefault();
            setIsDraggingFiles(true);
          }
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node)) {
            setIsDraggingFiles(false);
          }
        }}
        onDrop={(e) => {
          if (onDropImportFiles && e.dataTransfer.files?.length) {
            e.preventDefault();
            setIsDraggingFiles(false);
            onDropImportFiles(Array.from(e.dataTransfer.files));
          }
        }}
        className={`fixed inset-y-0 left-0 z-40 flex w-[264px] shrink-0 flex-col border-r border-neutral-200 dark:border-white/[0.07] bg-[#f4f4f6] dark:bg-[#0b0b0c] text-neutral-800 dark:text-[#ececf1] transition-transform duration-200 ease-out lg:static ${
          isOpen ? 'translate-x-0' : '-translate-x-full lg:hidden'
        } ${isDraggingFiles ? 'ring-2 ring-inset ring-blue-500/70' : ''}`}
        aria-label="Workspace sidebar"
      >
        {/* Top Row: Brand + Search + Collapse */}
        <div className="flex items-center justify-between px-3.5 h-[52px] shrink-0">
          <button
            type="button"
            onClick={() => onSelectFilter({ type: 'all' })}
            className="text-[16px] font-bold tracking-tight text-neutral-950 dark:text-white whitespace-nowrap shrink-0 cursor-pointer px-1.5 py-1 rounded-lg hover:bg-neutral-200/70 dark:hover:bg-white/[0.06] transition-colors"
          >
            NoteCraft
          </button>

          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={onOpenSearch}
              title="Search notes and snippets (Cmd+K)"
              aria-label="Search notes and snippets"
              className="p-2 rounded-lg text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-white hover:bg-neutral-200/70 dark:hover:bg-white/[0.07] transition-colors cursor-pointer"
            >
              <Search className="w-[17px] h-[17px]" />
            </button>
            <button
              type="button"
              onClick={onClose}
              title="Collapse sidebar"
              aria-label="Collapse sidebar"
              className="p-2 rounded-lg text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-white hover:bg-neutral-200/70 dark:hover:bg-white/[0.07] transition-colors cursor-pointer"
            >
              <PanelLeftClose className="w-[17px] h-[17px]" />
            </button>
          </div>
        </div>

        {/* Scrollable Nav Body */}
        <div className="flex-1 overflow-y-auto px-2.5 py-1.5 space-y-5">
          {/* Primary Actions */}
          <div className="space-y-0.5">
            <button
              type="button"
              onClick={() => onCreateNote(activeFolderId)}
              className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-[13.5px] font-medium text-neutral-900 dark:text-neutral-100 hover:bg-neutral-200/70 dark:hover:bg-white/[0.07] transition-colors cursor-pointer whitespace-nowrap"
            >
              <Plus className="w-4 h-4 text-neutral-600 dark:text-neutral-300 shrink-0" />
              <span>New note</span>
            </button>

            <button
              type="button"
              onClick={() => onSelectFilter({ type: 'snippets' })}
              className={`w-full flex items-center justify-between gap-2 px-2.5 py-2 rounded-lg text-[13.5px] transition-colors cursor-pointer whitespace-nowrap ${
                filter.type === 'snippets'
                  ? 'bg-neutral-200/90 dark:bg-[#212125] text-neutral-950 dark:text-white font-medium'
                  : 'text-neutral-700 dark:text-neutral-300 hover:bg-neutral-200/60 dark:hover:bg-white/[0.06]'
              }`}
            >
              <span className="flex items-center gap-2.5 truncate">
                <Braces className="w-4 h-4 text-neutral-500 dark:text-neutral-400 shrink-0" />
                <span className="truncate">Snippet library</span>
              </span>
              <span className="text-[12px] text-neutral-500 dark:text-neutral-500 tabular-nums shrink-0">
                {snippetCount}
              </span>
            </button>

            <button
              type="button"
              onClick={() => onSelectFilter({ type: 'all' })}
              className={`w-full flex items-center justify-between gap-2 px-2.5 py-2 rounded-lg text-[13.5px] transition-colors cursor-pointer whitespace-nowrap ${
                filter.type === 'all'
                  ? 'bg-neutral-200/90 dark:bg-[#212125] text-neutral-950 dark:text-white font-medium'
                  : 'text-neutral-700 dark:text-neutral-300 hover:bg-neutral-200/60 dark:hover:bg-white/[0.06]'
              }`}
            >
              <span className="flex items-center gap-2.5 truncate">
                <FileText className="w-4 h-4 text-neutral-500 dark:text-neutral-400 shrink-0" />
                <span className="truncate">All notes</span>
              </span>
              <span className="text-[12px] text-neutral-500 dark:text-neutral-500 tabular-nums shrink-0">
                {notes.length}
              </span>
            </button>

            <button
              type="button"
              onClick={() => onSelectFilter({ type: 'starred' })}
              className={`w-full flex items-center justify-between gap-2 px-2.5 py-2 rounded-lg text-[13.5px] transition-colors cursor-pointer whitespace-nowrap ${
                filter.type === 'starred'
                  ? 'bg-neutral-200/90 dark:bg-[#212125] text-neutral-950 dark:text-white font-medium'
                  : 'text-neutral-700 dark:text-neutral-300 hover:bg-neutral-200/60 dark:hover:bg-white/[0.06]'
              }`}
            >
              <span className="flex items-center gap-2.5 truncate">
                <Star className="w-4 h-4 text-neutral-500 dark:text-neutral-400 shrink-0" />
                <span className="truncate">Starred</span>
              </span>
              <span className="text-[12px] text-neutral-500 dark:text-neutral-500 tabular-nums shrink-0">
                {starredCount}
              </span>
            </button>
          </div>

          {/* Projects / Folders Section */}
          <div>
            <div className="flex items-center justify-between px-2.5 mb-1.5">
              <span className="text-[12px] font-medium text-neutral-500 dark:text-neutral-400">
                Projects
              </span>
              <button
                type="button"
                onClick={() => {
                  setCreatingFolder((prev) => !prev);
                  setNewFolderName('');
                }}
                title="New project folder"
                aria-label="New project folder"
                className="p-1 rounded-md text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-white hover:bg-neutral-200/70 dark:hover:bg-white/[0.07] transition-colors cursor-pointer"
              >
                <FolderPlus className="w-3.5 h-3.5" />
              </button>
            </div>

            {creatingFolder && (
              <form onSubmit={handleCreateFolderSubmit} className="px-1.5 mb-1.5 flex items-center gap-1">
                <input
                  type="text"
                  value={newFolderName}
                  onChange={(e) => setNewFolderName(e.target.value)}
                  placeholder="Folder name..."
                  autoFocus
                  className="w-full px-2.5 py-1.5 text-[13px] rounded-md border border-neutral-300 dark:border-white/15 bg-white dark:bg-[#16161a] text-neutral-900 dark:text-white focus:outline-none focus:border-blue-500"
                />
                <button
                  type="submit"
                  aria-label="Create folder"
                  className="p-1.5 rounded-md bg-blue-600 text-white hover:bg-blue-700 cursor-pointer shrink-0"
                >
                  <Check className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => setCreatingFolder(false)}
                  aria-label="Cancel new folder"
                  className="p-1.5 rounded-md text-neutral-500 hover:bg-neutral-200 dark:hover:bg-white/10 cursor-pointer shrink-0"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </form>
            )}

            <div className="space-y-0.5">
              {folders.map((folder) => {
                const count = notes.filter((n) => n.folderId === folder.id).length;
                const isSelected = filter.type === 'folder' && filter.folderId === folder.id;

                if (renamingFolderId === folder.id) {
                  return (
                    <form
                      key={folder.id}
                      onSubmit={(e) => handleRenameSubmit(e, folder.id)}
                      className="px-1.5 py-0.5 flex items-center gap-1"
                    >
                      <input
                        type="text"
                        value={renameDraft}
                        onChange={(e) => setRenameDraft(e.target.value)}
                        autoFocus
                        onKeyDown={(e) => {
                          if (e.key === 'Escape') setRenamingFolderId(null);
                        }}
                        className="w-full px-2 py-1 text-[13px] rounded-md border border-blue-500 bg-white dark:bg-[#16161a] text-neutral-900 dark:text-white focus:outline-none"
                      />
                      <button
                        type="submit"
                        aria-label="Save folder name"
                        className="p-1 text-blue-600 dark:text-blue-400 cursor-pointer"
                      >
                        <Check className="w-3.5 h-3.5" />
                      </button>
                    </form>
                  );
                }

                return (
                  <div
                    key={folder.id}
                    className={`group flex items-center justify-between gap-1 px-2.5 py-1.5 rounded-lg text-[13.5px] transition-colors ${
                      isSelected
                        ? 'bg-neutral-200/90 dark:bg-[#212125] text-neutral-950 dark:text-white font-medium'
                        : 'text-neutral-700 dark:text-neutral-300 hover:bg-neutral-200/60 dark:hover:bg-white/[0.06]'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => onSelectFilter({ type: 'folder', folderId: folder.id })}
                      className="flex-1 min-w-0 flex items-center gap-2.5 text-left cursor-pointer py-0.5"
                    >
                      <FolderIcon className="w-4 h-4 text-neutral-500 dark:text-neutral-400 shrink-0" />
                      <span className="truncate">{folder.name}</span>
                    </button>

                    {confirmDeleteFolderId === folder.id ? (
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          type="button"
                          onClick={() => {
                            onDeleteFolder(folder.id);
                            setConfirmDeleteFolderId(null);
                          }}
                          className="text-[11px] font-medium text-red-600 dark:text-red-400 px-1.5 py-0.5 rounded hover:bg-red-500/10 cursor-pointer"
                        >
                          Remove
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteFolderId(null)}
                          className="text-[11px] text-neutral-500 px-1 py-0.5 cursor-pointer"
                        >
                          No
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1 shrink-0">
                        <span className="text-[12px] text-neutral-400 dark:text-neutral-500 tabular-nums group-hover:hidden">
                          {count}
                        </span>
                        <div className="hidden group-hover:flex items-center gap-0.5">
                          <button
                            type="button"
                            onClick={() => {
                              setRenamingFolderId(folder.id);
                              setRenameDraft(folder.name);
                            }}
                            title="Rename folder"
                            aria-label={`Rename ${folder.name}`}
                            className="p-1 rounded text-neutral-500 hover:text-neutral-900 dark:hover:text-white cursor-pointer"
                          >
                            <Pencil className="w-3 h-3" />
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteFolderId(folder.id)}
                            title="Delete folder"
                            aria-label={`Delete ${folder.name}`}
                            className="p-1 rounded text-neutral-500 hover:text-red-500 cursor-pointer"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Shared with Me Collapsible Section */}
          <div>
            <div className="flex items-center justify-between px-2 mb-1">
              <button
                type="button"
                onClick={() => setSharedExpanded((prev) => !prev)}
                aria-expanded={sharedExpanded}
                className="flex items-center gap-1.5 py-1 px-0.5 rounded-md text-[12px] font-medium text-neutral-500 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-white transition-colors cursor-pointer"
              >
                {sharedExpanded ? (
                  <ChevronDown className="w-3.5 h-3.5 shrink-0" />
                ) : (
                  <ChevronRight className="w-3.5 h-3.5 shrink-0" />
                )}
                <span>Shared</span>
              </button>

              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={onRefreshShared}
                  title="Refresh shared notes"
                  aria-label="Refresh shared notes"
                  className="p-1 rounded-md text-neutral-400 hover:text-neutral-900 dark:hover:text-white hover:bg-neutral-200/70 dark:hover:bg-white/[0.07] transition-colors cursor-pointer"
                >
                  <RefreshCw className="w-3 h-3" />
                </button>
                <span className="text-[11px] text-neutral-400 dark:text-neutral-500 tabular-nums pr-0.5">
                  {sharedNotes.length}
                </span>
              </div>
            </div>

            {sharedExpanded && (
              <div className="space-y-0.5">
                {sharedNotes.length === 0 ? (
                  <div className="px-2.5 py-2 text-[12px] text-neutral-500 dark:text-neutral-500">
                    Nothing shared with you yet.
                  </div>
                ) : (
                  sharedNotes.map((sharedNote) => {
                    const isActive =
                      filter.type !== 'snippets' && sharedNote.id === activeNoteId;
                    const senderLabel =
                      sharedNote.ownerName || sharedNote.ownerEmail || 'Collaborator';
                    const permLabel =
                      sharedNote.sharedPermission === 'edit' ? 'Can edit' : 'View only';

                    return (
                      <button
                        key={sharedNote.id}
                        type="button"
                        onClick={() => onSelectNote(sharedNote.id)}
                        title={`${sharedNote.title || 'Untitled Note'} — Shared by ${senderLabel}`}
                        className={`w-full text-left px-2.5 py-1.5 rounded-lg transition-colors cursor-pointer ${
                          isActive
                            ? 'bg-neutral-200/95 dark:bg-[#212125] text-neutral-950 dark:text-white'
                            : 'text-neutral-700 dark:text-neutral-300 hover:bg-neutral-200/60 dark:hover:bg-white/[0.06]'
                        }`}
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <Users className="w-3.5 h-3.5 text-neutral-400 dark:text-neutral-500 shrink-0" />
                          <span
                            className={`text-[13.5px] truncate leading-[1.5] ${
                              isActive ? 'font-medium' : ''
                            }`}
                          >
                            {sharedNote.title || 'Untitled Note'}
                          </span>
                        </div>
                        <div className="pl-5.5 text-[11px] text-neutral-500 dark:text-neutral-400 truncate">
                          {senderLabel} · {permLabel}
                        </div>
                      </button>
                    );
                  })
                )}
              </div>
            )}
          </div>

          {/* Recents / Notes List */}
          <div>
            <div className="flex items-center justify-between px-2.5 mb-1.5">
              <span className="text-[12px] font-medium text-neutral-500 dark:text-neutral-400">
                {filter.type === 'folder'
                  ? folders.find((f) => f.id === filter.folderId)?.name || 'Notes'
                  : filter.type === 'starred'
                  ? 'Starred'
                  : 'Recents'}
              </span>
              <span className="text-[11px] text-neutral-400 dark:text-neutral-500 tabular-nums">
                {visibleNotes.length}
              </span>
            </div>

            {visibleNotes.length === 0 ? (
              <div className="px-2.5 py-4 text-[12.5px] text-neutral-500 dark:text-neutral-500">
                No notes in this view yet.
              </div>
            ) : (
              <div className="space-y-0.5">
                {visibleNotes.map((note) => {
                  const isActive = filter.type !== 'snippets' && note.id === activeNoteId;
                  return (
                    <div
                      key={note.id}
                      className={`group flex items-center justify-between gap-1 px-2.5 py-1.5 rounded-lg text-[13.5px] transition-colors ${
                        isActive
                          ? 'bg-neutral-200/95 dark:bg-[#212125] text-neutral-950 dark:text-white font-medium'
                          : 'text-neutral-700 dark:text-neutral-300 hover:bg-neutral-200/60 dark:hover:bg-white/[0.06]'
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => onSelectNote(note.id)}
                        className="flex-1 min-w-0 text-left truncate py-1 leading-[1.5] cursor-pointer"
                        title={note.title || 'Untitled Note'}
                      >
                        {note.title || 'Untitled Note'}
                      </button>

                      {confirmDeleteNoteId === note.id ? (
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            type="button"
                            onClick={() => {
                              onDeleteNote(note.id);
                              setConfirmDeleteNoteId(null);
                            }}
                            className="text-[11px] font-medium text-red-600 dark:text-red-400 px-1.5 py-0.5 rounded hover:bg-red-500/10 cursor-pointer"
                          >
                            Delete
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteNoteId(null)}
                            className="text-[11px] text-neutral-500 px-1 py-0.5 cursor-pointer"
                          >
                            No
                          </button>
                        </div>
                      ) : (
                        <div
                          className={`flex items-center gap-0.5 shrink-0 ${
                            note.starred ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                          } transition-opacity`}
                        >
                          <button
                            type="button"
                            onClick={() => onToggleStar(note.id)}
                            title={note.starred ? 'Unstar note' : 'Star note'}
                            aria-label={note.starred ? 'Unstar note' : 'Star note'}
                            className={`p-1 rounded cursor-pointer ${
                              note.starred
                                ? 'text-amber-500'
                                : 'text-neutral-400 hover:text-neutral-700 dark:hover:text-white'
                            }`}
                          >
                            <Star className="w-3.5 h-3.5" fill={note.starred ? 'currentColor' : 'none'} />
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteNoteId(note.id)}
                            title="Delete note"
                            aria-label={`Delete ${note.title}`}
                            className="p-1 rounded text-neutral-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Bottom Utility & Account Footer */}
        <div className="border-t border-neutral-200 dark:border-white/[0.07] shrink-0">
          <div className="px-2.5 pt-2.5 pb-1.5 flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={onOpenImportModal}
              className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-[12.5px] font-medium text-neutral-600 hover:text-neutral-950 dark:text-neutral-400 dark:hover:text-white hover:bg-neutral-200/70 dark:hover:bg-white/[0.06] transition-colors cursor-pointer whitespace-nowrap"
            >
              <Upload className="w-3.5 h-3.5 shrink-0" />
              <span>Import file</span>
            </button>

            <button
              type="button"
              onClick={onToggleTheme}
              aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[12.5px] font-medium text-neutral-600 hover:text-neutral-950 dark:text-neutral-400 dark:hover:text-white hover:bg-neutral-200/70 dark:hover:bg-white/[0.06] transition-colors cursor-pointer whitespace-nowrap"
            >
              {theme === 'dark' ? (
                <>
                  <Sun className="w-3.5 h-3.5 shrink-0" />
                  <span>Light</span>
                </>
              ) : (
                <>
                  <Moon className="w-3.5 h-3.5 shrink-0" />
                  <span>Dark</span>
                </>
              )}
            </button>
          </div>

          <div
            onClick={() => setSettingsOpen(true)}
            role="button"
            tabIndex={0}
            title="Open account settings and theme preferences"
            aria-label="Open account settings"
            className="px-3 py-2.5 border-t border-neutral-200/70 dark:border-white/[0.05] flex items-center justify-between gap-2 hover:bg-neutral-200/50 dark:hover:bg-white/[0.04] transition-colors cursor-pointer select-none"
          >
            <div className="flex items-center gap-2.5 min-w-0 pointer-events-none">
              <div className="w-7 h-7 rounded-lg bg-neutral-900 dark:bg-white/10 text-white dark:text-neutral-100 text-[11.5px] font-semibold flex items-center justify-center shrink-0 uppercase">
                {user.name
                  .split(/\s+/)
                  .slice(0, 2)
                  .map((p) => p[0] || '')
                  .join('') || 'U'}
              </div>
              <div className="min-w-0">
                <div className="text-[12.5px] font-medium text-neutral-900 dark:text-neutral-100 truncate leading-tight">
                  {user.name}
                </div>
                <div className="text-[11px] text-neutral-500 dark:text-neutral-400 truncate leading-tight">
                  {user.email}
                </div>
              </div>
            </div>

            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onLogout();
              }}
              title="Sign out"
              aria-label="Sign out"
              className="p-1.5 rounded-lg text-neutral-500 hover:text-neutral-950 dark:text-neutral-400 dark:hover:text-white hover:bg-neutral-200/70 dark:hover:bg-white/[0.06] transition-colors cursor-pointer shrink-0"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>

        <UserSettingsModal
          isOpen={settingsOpen}
          user={user}
          theme={theme}
          onClose={() => setSettingsOpen(false)}
          onToggleTheme={onToggleTheme}
          onLogout={onLogout}
        />
      </aside>
    </>
  );
}
