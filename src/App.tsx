import { useEffect, useMemo, useRef, useState } from 'react';
import { CommandPalette } from './components/CommandPalette';
import { DocumentWorkspace } from './components/DocumentWorkspace';
import { Sidebar } from './components/Sidebar';
import { SnippetModal } from './components/SnippetModal';
import { SnippetsView } from './components/SnippetsView';
import { INITIAL_FOLDERS, INITIAL_NOTES, INITIAL_SNIPPETS } from './data/seedData';
import { Folder, NoteDocument, SidebarFilter, Snippet, ViewMode } from './types/notes';

async function syncApi(url: string, method: 'POST' | 'PATCH' | 'DELETE', body?: unknown) {
  try {
    await fetch(url, {
      method,
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    // Ignore transient network errors; local state remains intact
  }
}

const STORAGE_KEYS = {
  folders: 'notecraft.folders.v1',
  notes: 'notecraft.notes.v1',
  snippets: 'notecraft.snippets.v1',
  activeNoteId: 'notecraft.activeNoteId.v1',
  theme: 'notecraft.theme.v1',
};

function readStorage<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export default function App() {
  const [theme, setTheme] = useState<'dark' | 'light'>(() =>
    readStorage<'dark' | 'light'>(STORAGE_KEYS.theme, 'dark')
  );
  const [folders, setFolders] = useState<Folder[]>(() =>
    readStorage<Folder[]>(STORAGE_KEYS.folders, INITIAL_FOLDERS)
  );
  const [notes, setNotes] = useState<NoteDocument[]>(() =>
    readStorage<NoteDocument[]>(STORAGE_KEYS.notes, INITIAL_NOTES)
  );
  const [snippets, setSnippets] = useState<Snippet[]>(() =>
    readStorage<Snippet[]>(STORAGE_KEYS.snippets, INITIAL_SNIPPETS)
  );
  const [activeNoteId, setActiveNoteId] = useState<string | null>(() =>
    readStorage<string | null>(STORAGE_KEYS.activeNoteId, INITIAL_NOTES[0]?.id ?? null)
  );

  const [filter, setFilter] = useState<SidebarFilter>({ type: 'all' });
  const [viewMode, setViewMode] = useState<ViewMode>('read');
  const [sidebarOpen, setSidebarOpen] = useState<boolean>(() =>
    typeof window !== 'undefined' ? window.innerWidth >= 1024 : true
  );
  const [outlineOpen, setOutlineOpen] = useState<boolean>(false);
  const [searchOpen, setSearchOpen] = useState<boolean>(false);
  const [snippetModalState, setSnippetModalState] = useState<{
    open: boolean;
    initial?: Partial<Snippet> | null;
  }>({ open: false });

  const dbEnabledRef = useRef(false);
  const notePatchTimersRef = useRef<Map<string, number>>(new Map());

  // Hydrate from PostgreSQL backend when configured
  useEffect(() => {
    let cancelled = false;
    fetch('/api/workspace')
      .then(async (res) => {
        if (!res.ok) return null;
        return (await res.json()) as {
          folders: Folder[];
          notes: NoteDocument[];
          snippets: Snippet[];
        };
      })
      .then((data) => {
        if (!data || cancelled) return;
        dbEnabledRef.current = true;
        setFolders(data.folders);
        setNotes(data.notes);
        setSnippets(data.snippets);
        setActiveNoteId((prev) =>
          prev && data.notes.some((n) => n.id === prev) ? prev : data.notes[0]?.id ?? null
        );
      })
      .catch(() => {
        // Stay in browser localStorage mode when PostgreSQL is not active
      });

    return () => {
      cancelled = true;
    };
  }, []);

  // Sync theme class on <html>
  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
    try {
      localStorage.setItem(STORAGE_KEYS.theme, JSON.stringify(theme));
    } catch {
      // ignore storage quota errors
    }
  }, [theme]);

  // Persist workspace entities to localStorage
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEYS.folders, JSON.stringify(folders));
    } catch {
      // ignore
    }
  }, [folders]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEYS.notes, JSON.stringify(notes));
    } catch {
      // ignore
    }
  }, [notes]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEYS.snippets, JSON.stringify(snippets));
    } catch {
      // ignore
    }
  }, [snippets]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEYS.activeNoteId, JSON.stringify(activeNoteId));
    } catch {
      // ignore
    }
  }, [activeNoteId]);

  // Global keyboard shortcuts (Cmd/Ctrl+K for search, Cmd/Ctrl+E to toggle edit/read)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        const tag = (e.target as HTMLElement)?.tagName;
        if (tag !== 'TEXTAREA') {
          e.preventDefault();
          setSearchOpen((prev) => !prev);
        }
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'e') {
        e.preventDefault();
        setViewMode((prev) => (prev === 'read' ? 'split' : prev === 'split' ? 'write' : 'read'));
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const activeNote = useMemo(
    () => notes.find((n) => n.id === activeNoteId) ?? null,
    [notes, activeNoteId]
  );

  const snippetCategories = useMemo(
    () => Array.from(new Set(snippets.map((s) => s.category))).sort(),
    [snippets]
  );

  const handleCreateNote = (folderId?: string | null) => {
    const now = Date.now();
    const targetFolder =
      folderId !== undefined
        ? folderId
        : filter.type === 'folder'
        ? filter.folderId
        : 'documents';
    const validFolder = folders.some((f) => f.id === targetFolder) ? targetFolder : null;

    const newNote: NoteDocument = {
      id: `note-${now}-${Math.random().toString(36).slice(2, 6)}`,
      title: 'Untitled Technical Note',
      content: `## Overview\n\nWrite structured technical documentation or insert saved snippets.\n\n### Checklist\n\n- [ ] Add implementation details\n- [ ] Verify commands\n`,
      folderId: validFolder,
      starred: filter.type === 'starred',
      createdAt: now,
      updatedAt: now,
    };

    setNotes((prev) => [newNote, ...prev]);
    setActiveNoteId(newNote.id);
    if (filter.type === 'snippets') {
      setFilter({ type: 'all' });
    }
    setViewMode('split');
    if (window.innerWidth < 1024) setSidebarOpen(false);

    if (dbEnabledRef.current) {
      void syncApi('/api/notes', 'POST', newNote);
    }
  };

  const handleUpdateNote = (
    noteId: string,
    patch: Partial<Pick<NoteDocument, 'title' | 'content' | 'folderId' | 'starred'>>
  ) => {
    const updatedAt = Date.now();
    setNotes((prev) =>
      prev.map((n) => (n.id === noteId ? { ...n, ...patch, updatedAt } : n))
    );

    if (dbEnabledRef.current) {
      const existingTimer = notePatchTimersRef.current.get(noteId);
      if (existingTimer) window.clearTimeout(existingTimer);
      const timer = window.setTimeout(() => {
        notePatchTimersRef.current.delete(noteId);
        void syncApi(`/api/notes/${encodeURIComponent(noteId)}`, 'PATCH', {
          ...patch,
          updatedAt,
        });
      }, 280);
      notePatchTimersRef.current.set(noteId, timer);
    }
  };

  const handleDeleteNote = (noteId: string) => {
    setNotes((prev) => {
      const remaining = prev.filter((n) => n.id !== noteId);
      if (activeNoteId === noteId) {
        setActiveNoteId(remaining[0]?.id ?? null);
      }
      return remaining;
    });

    if (dbEnabledRef.current) {
      void syncApi(`/api/notes/${encodeURIComponent(noteId)}`, 'DELETE');
    }
  };

  const handleToggleStar = (noteId: string) => {
    let nextStarred = false;
    const updatedAt = Date.now();
    setNotes((prev) =>
      prev.map((n) => {
        if (n.id === noteId) {
          nextStarred = !n.starred;
          return { ...n, starred: nextStarred, updatedAt };
        }
        return n;
      })
    );

    if (dbEnabledRef.current) {
      void syncApi(`/api/notes/${encodeURIComponent(noteId)}`, 'PATCH', {
        starred: nextStarred,
        updatedAt,
      });
    }
  };

  const handleCreateFolder = (name: string) => {
    const id = `folder-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`;
    const newFolder: Folder = { id, name, createdAt: Date.now() };
    setFolders((prev) => [...prev, newFolder]);
    setFilter({ type: 'folder', folderId: id });

    if (dbEnabledRef.current) {
      void syncApi('/api/folders', 'POST', newFolder);
    }
  };

  const handleRenameFolder = (folderId: string, name: string) => {
    setFolders((prev) => prev.map((f) => (f.id === folderId ? { ...f, name } : f)));

    if (dbEnabledRef.current) {
      void syncApi(`/api/folders/${encodeURIComponent(folderId)}`, 'PATCH', { name });
    }
  };

  const handleDeleteFolder = (folderId: string) => {
    setFolders((prev) => prev.filter((f) => f.id !== folderId));
    setNotes((prev) =>
      prev.map((n) => (n.folderId === folderId ? { ...n, folderId: null } : n))
    );
    if (filter.type === 'folder' && filter.folderId === folderId) {
      setFilter({ type: 'all' });
    }

    if (dbEnabledRef.current) {
      void syncApi(`/api/folders/${encodeURIComponent(folderId)}`, 'DELETE');
    }
  };

  const handleImportMarkdown = async (file: File) => {
    try {
      const rawText = await file.text();
      const cleanedTitle = file.name.replace(/\.(md|markdown|txt)$/i, '');
      const headingMatch = /^#\s+(.+)\n+/.exec(rawText);
      const title = headingMatch ? headingMatch[1].trim() : cleanedTitle;
      const content = headingMatch ? rawText.slice(headingMatch[0].length) : rawText;

      const now = Date.now();
      const targetFolder = filter.type === 'folder' ? filter.folderId : 'documents';
      const imported: NoteDocument = {
        id: `note-${now}-${Math.random().toString(36).slice(2, 6)}`,
        title,
        content,
        folderId: folders.some((f) => f.id === targetFolder) ? targetFolder : null,
        starred: false,
        createdAt: now,
        updatedAt: now,
      };
      setNotes((prev) => [imported, ...prev]);
      setActiveNoteId(imported.id);
      if (filter.type === 'snippets') setFilter({ type: 'all' });
      setViewMode('read');
      if (window.innerWidth < 1024) setSidebarOpen(false);

      if (dbEnabledRef.current) {
        void syncApi('/api/notes', 'POST', imported);
      }
    } catch {
      // Ignore unreadable files
    }
  };

  const handleSaveSnippet = (data: {
    id?: string;
    title: string;
    description: string;
    category: string;
    language: string;
    content: string;
  }) => {
    const now = Date.now();
    if (data.id) {
      let updatedSnippet: Snippet | null = null;
      setSnippets((prev) =>
        prev.map((s) => {
          if (s.id === data.id) {
            updatedSnippet = {
              ...s,
              title: data.title,
              description: data.description,
              category: data.category,
              language: data.language,
              content: data.content,
              updatedAt: now,
            };
            return updatedSnippet;
          }
          return s;
        })
      );
      if (dbEnabledRef.current && updatedSnippet) {
        void syncApi('/api/snippets', 'POST', updatedSnippet);
      }
    } else {
      const created: Snippet = {
        id: `snip-${now}-${Math.random().toString(36).slice(2, 6)}`,
        title: data.title,
        description: data.description,
        category: data.category,
        language: data.language,
        content: data.content,
        createdAt: now,
        updatedAt: now,
      };
      setSnippets((prev) => [created, ...prev]);
      if (dbEnabledRef.current) {
        void syncApi('/api/snippets', 'POST', created);
      }
    }
  };

  const handleDeleteSnippet = (snippetId: string) => {
    setSnippets((prev) => prev.filter((s) => s.id !== snippetId));
    if (dbEnabledRef.current) {
      void syncApi(`/api/snippets/${encodeURIComponent(snippetId)}`, 'DELETE');
    }
  };

  const handleInsertSnippetIntoActiveNote = (snippet: Snippet) => {
    if (activeNote) {
      const separator = activeNote.content.trimEnd() ? '\n\n' : '';
      handleUpdateNote(activeNote.id, {
        content: `${activeNote.content.trimEnd()}${separator}${snippet.content}\n`,
      });
      setFilter({ type: 'all' });
      setViewMode('split');
    } else {
      const now = Date.now();
      const created: NoteDocument = {
        id: `note-${now}-${Math.random().toString(36).slice(2, 6)}`,
        title: snippet.title,
        content: `${snippet.description ? `${snippet.description}\n\n` : ''}${snippet.content}\n`,
        folderId: folders[0]?.id ?? null,
        starred: false,
        createdAt: now,
        updatedAt: now,
      };
      setNotes((prev) => [created, ...prev]);
      setActiveNoteId(created.id);
      setFilter({ type: 'all' });
      setViewMode('split');

      if (dbEnabledRef.current) {
        void syncApi('/api/notes', 'POST', created);
      }
    }
  };

  return (
    <div className="h-screen w-screen overflow-hidden flex bg-white dark:bg-[#121214] text-neutral-900 dark:text-[#ececf1]">
      <Sidebar
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        folders={folders}
        notes={notes}
        snippetCount={snippets.length}
        activeNoteId={activeNoteId}
        filter={filter}
        theme={theme}
        onToggleTheme={() => setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'))}
        onOpenSearch={() => setSearchOpen(true)}
        onSelectFilter={(nextFilter) => {
          setFilter(nextFilter);
          if (nextFilter.type === 'folder') {
            const firstInFolder = notes.find((n) => n.folderId === nextFilter.folderId);
            if (firstInFolder) setActiveNoteId(firstInFolder.id);
          } else if (nextFilter.type === 'starred') {
            const firstStarred = notes.find((n) => n.starred);
            if (firstStarred) setActiveNoteId(firstStarred.id);
          }
          if (window.innerWidth < 1024 && nextFilter.type === 'snippets') {
            setSidebarOpen(false);
          }
        }}
        onSelectNote={(noteId) => {
          setActiveNoteId(noteId);
          if (filter.type === 'snippets') {
            setFilter({ type: 'all' });
          }
          if (window.innerWidth < 1024) {
            setSidebarOpen(false);
          }
        }}
        onCreateNote={handleCreateNote}
        onDeleteNote={handleDeleteNote}
        onToggleStar={handleToggleStar}
        onCreateFolder={handleCreateFolder}
        onRenameFolder={handleRenameFolder}
        onDeleteFolder={handleDeleteFolder}
        onImportMarkdown={handleImportMarkdown}
      />

      {filter.type === 'snippets' ? (
        <SnippetsView
          snippets={snippets}
          activeNoteTitle={activeNote?.title ?? null}
          sidebarOpen={sidebarOpen}
          onOpenSidebar={() => setSidebarOpen(true)}
          onNewSnippet={() => setSnippetModalState({ open: true, initial: null })}
          onEditSnippet={(snippet) => setSnippetModalState({ open: true, initial: snippet })}
          onDeleteSnippet={handleDeleteSnippet}
          onInsertIntoActiveNote={handleInsertSnippetIntoActiveNote}
        />
      ) : (
        <DocumentWorkspace
          note={activeNote}
          folders={folders}
          snippets={snippets}
          viewMode={viewMode}
          sidebarOpen={sidebarOpen}
          outlineOpen={outlineOpen}
          onOpenSidebar={() => setSidebarOpen(true)}
          onToggleOutline={() => setOutlineOpen((prev) => !prev)}
          onChangeViewMode={setViewMode}
          onUpdateNote={handleUpdateNote}
          onCreateNote={() => handleCreateNote()}
          onOpenSnippetModal={(prefillContent) =>
            setSnippetModalState({
              open: true,
              initial: prefillContent ? { content: prefillContent } : null,
            })
          }
          onOpenSnippetsLibrary={() => setFilter({ type: 'snippets' })}
        />
      )}

      <CommandPalette
        isOpen={searchOpen}
        notes={notes}
        folders={folders}
        snippets={snippets}
        onClose={() => setSearchOpen(false)}
        onSelectNote={(noteId) => {
          setActiveNoteId(noteId);
          if (filter.type === 'snippets') setFilter({ type: 'all' });
        }}
        onInsertSnippet={handleInsertSnippetIntoActiveNote}
      />

      <SnippetModal
        isOpen={snippetModalState.open}
        initialSnippet={snippetModalState.initial}
        categories={snippetCategories}
        onClose={() => setSnippetModalState({ open: false, initial: null })}
        onSave={handleSaveSnippet}
      />
    </div>
  );
}
