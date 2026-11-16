import React, { useEffect, useMemo, useState } from 'react';
import { Braces, FileText, Search, X } from 'lucide-react';
import { Folder, NoteDocument, Snippet } from '../types/notes';

interface CommandPaletteProps {
  isOpen: boolean;
  notes: NoteDocument[];
  folders: Folder[];
  snippets: Snippet[];
  onClose: () => void;
  onSelectNote: (noteId: string) => void;
  onInsertSnippet: (snippet: Snippet) => void;
}

type SearchResult =
  | { kind: 'note'; note: NoteDocument; folderName: string }
  | { kind: 'snippet'; snippet: Snippet };

export function CommandPalette({
  isOpen,
  notes,
  folders,
  snippets,
  onClose,
  onSelectNote,
  onInsertSnippet,
}: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setActiveIndex(0);
    }
  }, [isOpen]);

  const results: SearchResult[] = useMemo(() => {
    const q = query.trim().toLowerCase();
    const folderMap = new Map(folders.map((f) => [f.id, f.name]));

    const matchedNotes: SearchResult[] = notes
      .filter(
        (n) =>
          !q ||
          n.title.toLowerCase().includes(q) ||
          n.content.toLowerCase().includes(q) ||
          (n.folderId && (folderMap.get(n.folderId) || '').toLowerCase().includes(q))
      )
      .slice(0, 8)
      .map((note) => ({
        kind: 'note',
        note,
        folderName: note.isSharedWithMe
          ? `Shared by ${note.ownerName || note.ownerEmail || 'Collaborator'}`
          : note.folderId
          ? folderMap.get(note.folderId) || 'Notes'
          : 'Root',
      }));

    const matchedSnippets: SearchResult[] = snippets
      .filter(
        (s) =>
          !q ||
          s.title.toLowerCase().includes(q) ||
          s.category.toLowerCase().includes(q) ||
          s.description.toLowerCase().includes(q) ||
          s.content.toLowerCase().includes(q)
      )
      .slice(0, 6)
      .map((snippet) => ({ kind: 'snippet', snippet }));

    return [...matchedNotes, ...matchedSnippets];
  }, [query, notes, folders, snippets]);

  useEffect(() => {
    if (activeIndex >= results.length) {
      setActiveIndex(0);
    }
  }, [results.length, activeIndex]);

  if (!isOpen) return null;

  const activateResult = (item: SearchResult) => {
    if (item.kind === 'note') {
      onSelectNote(item.note.id);
    } else {
      onInsertSnippet(item.snippet);
    }
    onClose();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((prev) => (results.length ? (prev + 1) % results.length : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((prev) => (results.length ? (prev - 1 + results.length) % results.length : 0));
    } else if (e.key === 'Enter' && results[activeIndex]) {
      e.preventDefault();
      activateResult(results[activeIndex]);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[12vh] bg-black/60 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Search notes and snippets"
    >
      <div
        className="w-full max-w-xl rounded-2xl border border-neutral-200 dark:border-white/10 bg-white dark:bg-[#17171b] shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        <div className="flex items-center gap-3 px-4 py-3.5 border-b border-neutral-200 dark:border-white/[0.08]">
          <Search className="w-4 h-4 text-neutral-400 shrink-0" />
          <input
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActiveIndex(0);
            }}
            placeholder="Search notes, folders, or insert a snippet..."
            autoFocus
            className="flex-1 bg-transparent text-[14.5px] text-neutral-950 dark:text-white placeholder:text-neutral-400 focus:outline-none"
          />
          <button
            type="button"
            onClick={onClose}
            aria-label="Close search"
            className="p-1 rounded-md text-neutral-400 hover:text-neutral-700 dark:hover:text-white cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="max-h-[380px] overflow-y-auto p-2">
          {results.length === 0 ? (
            <div className="py-10 text-center text-[13.5px] text-neutral-500">
              No notes or snippets match "{query}".
            </div>
          ) : (
            <div className="space-y-0.5">
              {results.map((item, idx) => {
                const isSelected = idx === activeIndex;
                if (item.kind === 'note') {
                  return (
                    <button
                      key={`note-${item.note.id}`}
                      type="button"
                      onClick={() => activateResult(item)}
                      onMouseEnter={() => setActiveIndex(idx)}
                      className={`w-full flex items-center justify-between gap-3 px-3 py-2.5 rounded-xl text-left transition-colors cursor-pointer ${
                        isSelected
                          ? 'bg-neutral-100 dark:bg-white/[0.08] text-neutral-950 dark:text-white'
                          : 'text-neutral-700 dark:text-neutral-300'
                      }`}
                    >
                      <span className="flex items-center gap-2.5 min-w-0">
                        <FileText className="w-4 h-4 text-neutral-400 shrink-0" />
                        <span className="truncate text-[13.5px] font-medium">
                          {item.note.title || 'Untitled Note'}
                        </span>
                      </span>
                      <span className="text-[12px] text-neutral-400 dark:text-neutral-500 shrink-0">
                        {item.folderName}
                      </span>
                    </button>
                  );
                }

                return (
                  <button
                    key={`snip-${item.snippet.id}`}
                    type="button"
                    onClick={() => activateResult(item)}
                    onMouseEnter={() => setActiveIndex(idx)}
                    className={`w-full flex items-center justify-between gap-3 px-3 py-2.5 rounded-xl text-left transition-colors cursor-pointer ${
                      isSelected
                        ? 'bg-neutral-100 dark:bg-white/[0.08] text-neutral-950 dark:text-white'
                        : 'text-neutral-700 dark:text-neutral-300'
                    }`}
                  >
                    <span className="flex items-center gap-2.5 min-w-0">
                      <Braces className="w-4 h-4 text-blue-500 shrink-0" />
                      <span className="truncate text-[13.5px] font-medium">
                        {item.snippet.title}
                      </span>
                    </span>
                    <span className="text-[12px] text-neutral-400 dark:text-neutral-500 shrink-0">
                      Insert snippet · {item.snippet.language}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="px-4 py-2 border-t border-neutral-200 dark:border-white/[0.07] bg-neutral-50/70 dark:bg-white/[0.02] flex items-center justify-between text-[11.5px] text-neutral-500">
          <span>Use ↑ ↓ to navigate · Enter to open or insert</span>
          <span>Esc to close</span>
        </div>
      </div>
    </div>
  );
}
