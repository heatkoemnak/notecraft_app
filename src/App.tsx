import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AuthScreen } from './components/AuthScreen';
import { CommandPalette } from './components/CommandPalette';
import { DocumentWorkspace } from './components/DocumentWorkspace';
import { ImportDestinationMode, ImportFileModal } from './components/ImportFileModal';
import { ShareNoteModal } from './components/ShareNoteModal';
import { SharedLinkView } from './components/SharedLinkView';
import { Sidebar } from './components/Sidebar';
import { SnippetModal } from './components/SnippetModal';
import { SnippetsView } from './components/SnippetsView';
import { INITIAL_FOLDERS, INITIAL_NOTES, INITIAL_SNIPPETS } from './data/seedData';
import {
  NoteSelection,
  NoteSnapshot,
  NoteUpdateMeta,
  useNoteHistory,
} from './hooks/useNoteHistory';
import {
  AuthUser,
  Folder,
  LinkAccess,
  NoteDocument,
  SharedLinkNote,
  SharePermission,
  SidebarFilter,
  Snippet,
  ViewMode,
} from './types/notes';
import {
  fetchAuthSession,
  getUserStorageKeys,
  logoutAccount,
  StorageBackendMode,
} from './utils/authClient';
import { importSingleFile } from './utils/fileImporter';
import { clearFileMemoryCache } from './utils/fileStore';
import { clearImageMemoryCache } from './utils/imageStore';
import {
  deleteSharesForNoteLocal,
  hydrateLocalSharing,
  refreshSharedNotes,
  removeNoteShare,
  shareNoteWithEmail,
  updateNoteShareLink,
  updateSharedNoteLocal,
} from './utils/shareClient';

async function syncApi(url: string, method: 'POST' | 'PATCH' | 'DELETE', body?: unknown) {
  try {
    await fetch(url, {
      method,
      credentials: 'same-origin',
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    // Ignore transient network errors; local state remains intact
  }
}

const THEME_STORAGE_KEY = 'notecraft.theme.v1';

function readStorage<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function getShareTokenFromUrl(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const params = new URLSearchParams(window.location.search);
    const queryToken = params.get('share')?.trim();
    if (queryToken) return queryToken;
    const match = window.location.pathname.match(/^\/share\/([^/]+)/);
    return match?.[1] ? decodeURIComponent(match[1]) : null;
  } catch {
    return null;
  }
}

export default function App() {
  const [theme, setTheme] = useState<'dark' | 'light'>(() =>
    readStorage<'dark' | 'light'>(THEME_STORAGE_KEY, 'dark')
  );
  const [activeShareToken, setActiveShareToken] = useState<string | null>(() =>
    getShareTokenFromUrl()
  );
  const [authReady, setAuthReady] = useState(false);
  const [storageMode, setStorageMode] = useState<StorageBackendMode>('local');
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);
  const [workspaceLoaded, setWorkspaceLoaded] = useState(false);

  const [folders, setFolders] = useState<Folder[]>([]);
  const [notes, setNotes] = useState<NoteDocument[]>([]);
  const [sharedNotes, setSharedNotes] = useState<NoteDocument[]>([]);
  const [snippets, setSnippets] = useState<Snippet[]>([]);
  const [activeNoteId, setActiveNoteId] = useState<string | null>(null);

  const [filter, setFilter] = useState<SidebarFilter>({ type: 'all' });
  const [viewMode, setViewMode] = useState<ViewMode>('read');
  const [sidebarOpen, setSidebarOpen] = useState<boolean>(() =>
    typeof window !== 'undefined' ? window.innerWidth >= 1024 : true
  );
  const [outlineOpen, setOutlineOpen] = useState<boolean>(false);
  const [searchOpen, setSearchOpen] = useState<boolean>(false);
  const [shareModalOpen, setShareModalOpen] = useState<boolean>(false);
  const [importModalOpen, setImportModalOpen] = useState<boolean>(false);
  const [snippetModalState, setSnippetModalState] = useState<{
    open: boolean;
    initial?: Partial<Snippet> | null;
  }>({ open: false });

  const dbEnabledRef = useRef(false);
  const notePatchTimersRef = useRef<Map<string, number>>(new Map());
  const notesRef = useRef<NoteDocument[]>(notes);
  notesRef.current = notes;
  const sharedNotesRef = useRef<NoteDocument[]>(sharedNotes);
  sharedNotesRef.current = sharedNotes;
  const activeNoteIdRef = useRef<string | null>(activeNoteId);
  activeNoteIdRef.current = activeNoteId;
  const selectionReaderRef = useRef<() => NoteSelection | null>(() => null);
  const selectionSeqRef = useRef(0);
  const [pendingSelection, setPendingSelection] = useState<{
    noteId: string;
    selection: NoteSelection;
    seq: number;
  } | null>(null);

  const { canUndo, canRedo, recordChange, undo, redo, clearNoteHistory } =
    useNoteHistory(activeNoteId);

  // Resolve authentication session & backend mode on mount
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    if (code && !params.get('error')) {
      window.location.href = `/api/auth/github/callback?code=${encodeURIComponent(code)}`;
      return;
    }

    let cancelled = false;
    fetchAuthSession().then(({ storage, user }) => {
      if (cancelled) return;
      setStorageMode(storage);
      dbEnabledRef.current = storage === 'postgres';
      setCurrentUser(user);
      setAuthReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const handlePopState = () => {
      setActiveShareToken(getShareTokenFromUrl());
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  // Load authenticated user's workspace
  useEffect(() => {
    if (!authReady) return;

    if (!currentUser) {
      for (const timer of notePatchTimersRef.current.values()) {
        window.clearTimeout(timer);
      }
      notePatchTimersRef.current.clear();
      setWorkspaceLoaded(false);
      notesRef.current = [];
      sharedNotesRef.current = [];
      setFolders([]);
      setNotes([]);
      setSharedNotes([]);
      setSnippets([]);
      setActiveNoteId(null);
      return;
    }

    let cancelled = false;
    const userKeys = getUserStorageKeys(currentUser.id);
    setWorkspaceLoaded(false);

    if (storageMode === 'postgres') {
      fetch('/api/workspace', { credentials: 'same-origin' })
        .then(async (res) => {
          if (res.status === 401) {
            if (!cancelled) setCurrentUser(null);
            return null;
          }
          if (!res.ok) return null;
          return (await res.json()) as {
            folders: Folder[];
            notes: NoteDocument[];
            snippets: Snippet[];
            sharedNotes?: NoteDocument[];
          };
        })
        .then((data) => {
          if (!data || cancelled) return;
          const incomingShared = Array.isArray(data.sharedNotes) ? data.sharedNotes : [];
          dbEnabledRef.current = true;
          notesRef.current = data.notes;
          sharedNotesRef.current = incomingShared;
          setFolders(data.folders);
          setNotes(data.notes);
          setSharedNotes(incomingShared);
          setSnippets(data.snippets);
          const storedActive = readStorage<string | null>(userKeys.activeNoteId, null);
          const resolvedActive =
            storedActive &&
            (data.notes.some((n) => n.id === storedActive) ||
              incomingShared.some((n) => n.id === storedActive))
              ? storedActive
              : data.notes[0]?.id ?? incomingShared[0]?.id ?? null;
          setActiveNoteId(resolvedActive);
          setWorkspaceLoaded(true);
        })
        .catch(() => {
          if (!cancelled) setWorkspaceLoaded(true);
        });
    } else {
      const loadedFolders = readStorage<Folder[]>(userKeys.folders, INITIAL_FOLDERS);
      const rawNotes = readStorage<NoteDocument[]>(userKeys.notes, INITIAL_NOTES);
      const { notesWithShares, sharedNotes: loadedShared } = hydrateLocalSharing(
        currentUser,
        rawNotes
      );
      const loadedSnippets = readStorage<Snippet[]>(userKeys.snippets, INITIAL_SNIPPETS);
      const storedActive = readStorage<string | null>(
        userKeys.activeNoteId,
        notesWithShares[0]?.id ?? null
      );
      const resolvedActive =
        storedActive &&
        (notesWithShares.some((n) => n.id === storedActive) ||
          loadedShared.some((n) => n.id === storedActive))
          ? storedActive
          : notesWithShares[0]?.id ?? loadedShared[0]?.id ?? null;

      notesRef.current = notesWithShares;
      sharedNotesRef.current = loadedShared;
      setFolders(loadedFolders);
      setNotes(notesWithShares);
      setSharedNotes(loadedShared);
      setSnippets(loadedSnippets);
      setActiveNoteId(resolvedActive);
      setWorkspaceLoaded(true);
    }

    return () => {
      cancelled = true;
    };
  }, [authReady, currentUser, storageMode]);

  // Sync theme class on <html>
  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
    try {
      localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify(theme));
    } catch {
      // ignore storage quota errors
    }
  }, [theme]);

  // Persist authenticated user's workspace entities to per-user localStorage
  useEffect(() => {
    if (!currentUser || !workspaceLoaded) return;
    try {
      const keys = getUserStorageKeys(currentUser.id);
      localStorage.setItem(keys.folders, JSON.stringify(folders));
    } catch {
      // ignore
    }
  }, [folders, currentUser, workspaceLoaded]);

  useEffect(() => {
    if (!currentUser || !workspaceLoaded) return;
    try {
      const keys = getUserStorageKeys(currentUser.id);
      localStorage.setItem(keys.notes, JSON.stringify(notes));
    } catch {
      // ignore
    }
  }, [notes, currentUser, workspaceLoaded]);

  useEffect(() => {
    if (!currentUser || !workspaceLoaded) return;
    try {
      const keys = getUserStorageKeys(currentUser.id);
      localStorage.setItem(keys.snippets, JSON.stringify(snippets));
    } catch {
      // ignore
    }
  }, [snippets, currentUser, workspaceLoaded]);

  useEffect(() => {
    if (!currentUser || !workspaceLoaded) return;
    try {
      const keys = getUserStorageKeys(currentUser.id);
      localStorage.setItem(keys.activeNoteId, JSON.stringify(activeNoteId));
    } catch {
      // ignore
    }
  }, [activeNoteId, currentUser, workspaceLoaded]);

  const applyHistorySnapshot = useCallback((noteId: string, snapshot: NoteSnapshot) => {
    const updatedAt = Date.now();
    const isOwn = notesRef.current.some((n) => n.id === noteId);

    if (isOwn) {
      const patch = {
        title: snapshot.title,
        content: snapshot.content,
        folderId: snapshot.folderId,
        starred: snapshot.starred,
      };
      const nextNotes = notesRef.current.map((n) =>
        n.id === noteId ? { ...n, ...patch, updatedAt } : n
      );
      notesRef.current = nextNotes;
      setNotes(nextNotes);

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
    } else {
      const sharedTarget = sharedNotesRef.current.find((n) => n.id === noteId);
      if (!sharedTarget || sharedTarget.sharedPermission !== 'edit') return;

      const patch = {
        title: snapshot.title,
        content: snapshot.content,
      };
      const nextShared = sharedNotesRef.current.map((n) =>
        n.id === noteId ? { ...n, ...patch, updatedAt } : n
      );
      sharedNotesRef.current = nextShared;
      setSharedNotes(nextShared);

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
      } else if (sharedTarget.ownerEmail) {
        updateSharedNoteLocal(sharedTarget.ownerEmail, noteId, patch, updatedAt);
      }
    }

    if (snapshot.selection) {
      selectionSeqRef.current += 1;
      setPendingSelection({
        noteId,
        selection: snapshot.selection,
        seq: selectionSeqRef.current,
      });
    }
  }, []);

  const handleUndo = useCallback(() => {
    const current =
      notesRef.current.find((n) => n.id === activeNoteIdRef.current) ??
      sharedNotesRef.current.find((n) => n.id === activeNoteIdRef.current);
    if (!current || (current.isSharedWithMe && current.sharedPermission !== 'edit')) return;
    const currentSelection = selectionReaderRef.current();
    const snapshot = undo(current, currentSelection);
    if (!snapshot) return;
    applyHistorySnapshot(current.id, snapshot);
  }, [applyHistorySnapshot, undo]);

  const handleRedo = useCallback(() => {
    const current =
      notesRef.current.find((n) => n.id === activeNoteIdRef.current) ??
      sharedNotesRef.current.find((n) => n.id === activeNoteIdRef.current);
    if (!current || (current.isSharedWithMe && current.sharedPermission !== 'edit')) return;
    const currentSelection = selectionReaderRef.current();
    const snapshot = redo(current, currentSelection);
    if (!snapshot) return;
    applyHistorySnapshot(current.id, snapshot);
  }, [applyHistorySnapshot, redo]);

  // Global keyboard shortcuts (Cmd/Ctrl+Z undo, Cmd/Ctrl+Y or Cmd/Ctrl+Shift+Z redo, Cmd/Ctrl+K search, Cmd/Ctrl+E view mode)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!currentUser) return;
      const mod = (e.ctrlKey || e.metaKey) && !e.altKey;
      const key = e.key.toLowerCase();

      if (mod && (key === 'z' || (key === 'y' && !e.shiftKey))) {
        if (
          filter.type === 'snippets' ||
          !activeNoteId ||
          searchOpen ||
          shareModalOpen ||
          importModalOpen ||
          snippetModalState.open
        ) {
          return;
        }
        const target = e.target as HTMLElement | null;
        if (target?.closest('[role="dialog"], [aria-modal="true"]')) {
          return;
        }
        const tag = target?.tagName;
        const isEditableElement =
          tag === 'INPUT' || tag === 'TEXTAREA' || Boolean(target?.isContentEditable);
        const isNoteField =
          target?.dataset?.noteField === 'title' ||
          target?.dataset?.noteField === 'content' ||
          Boolean(target?.closest('[data-live-editor="true"]'));

        if (isEditableElement && !isNoteField) {
          return;
        }

        e.preventDefault();
        if (key === 'y' || e.shiftKey) {
          handleRedo();
        } else {
          handleUndo();
        }
        return;
      }

      if (mod && key === 'k') {
        const tag = (e.target as HTMLElement)?.tagName;
        if (tag !== 'TEXTAREA') {
          e.preventDefault();
          setSearchOpen((prev) => !prev);
        }
      } else if (mod && key === 'e') {
        e.preventDefault();
        setViewMode((prev) => (prev === 'read' ? 'split' : prev === 'split' ? 'write' : 'read'));
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    currentUser,
    filter.type,
    activeNoteId,
    searchOpen,
    shareModalOpen,
    importModalOpen,
    snippetModalState.open,
    handleUndo,
    handleRedo,
  ]);

  const activeNote = useMemo(
    () =>
      notes.find((n) => n.id === activeNoteId) ??
      sharedNotes.find((n) => n.id === activeNoteId) ??
      null,
    [notes, sharedNotes, activeNoteId]
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

    const nextNotes = [newNote, ...notesRef.current];
    notesRef.current = nextNotes;
    setNotes(nextNotes);
    setActiveNoteId(newNote.id);
    if (filter.type === 'snippets') {
      setFilter({ type: 'all' });
    }
    setViewMode('read');
    if (window.innerWidth < 1024) setSidebarOpen(false);

    if (dbEnabledRef.current) {
      void syncApi('/api/notes', 'POST', newNote);
    }
  };

  const handleUpdateNote = useCallback(
    (
      noteId: string,
      patch: Partial<Pick<NoteDocument, 'title' | 'content' | 'folderId' | 'starred'>>,
      meta?: NoteUpdateMeta
    ) => {
      const prevOwn = notesRef.current.find((n) => n.id === noteId);
      if (prevOwn) {
        const updatedAt = Date.now();
        const nextNote: NoteDocument = { ...prevOwn, ...patch, updatedAt };
        const changed =
          prevOwn.title !== nextNote.title ||
          prevOwn.content !== nextNote.content ||
          prevOwn.folderId !== nextNote.folderId ||
          prevOwn.starred !== nextNote.starred;

        if (!changed) return;

        recordChange(prevOwn, nextNote, meta);
        const nextNotes = notesRef.current.map((n) => (n.id === noteId ? nextNote : n));
        notesRef.current = nextNotes;
        setNotes(nextNotes);

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
        return;
      }

      const prevShared = sharedNotesRef.current.find((n) => n.id === noteId);
      if (!prevShared || prevShared.sharedPermission !== 'edit') return;

      const sharedPatch: Partial<Pick<NoteDocument, 'title' | 'content'>> = {};
      if (patch.title !== undefined) sharedPatch.title = patch.title;
      if (patch.content !== undefined) sharedPatch.content = patch.content;

      const updatedAt = Date.now();
      const nextSharedNote: NoteDocument = { ...prevShared, ...sharedPatch, updatedAt };
      const changed =
        prevShared.title !== nextSharedNote.title ||
        prevShared.content !== nextSharedNote.content;

      if (!changed) return;

      recordChange(prevShared, nextSharedNote, meta);
      const nextSharedList = sharedNotesRef.current.map((n) =>
        n.id === noteId ? nextSharedNote : n
      );
      sharedNotesRef.current = nextSharedList;
      setSharedNotes(nextSharedList);

      if (dbEnabledRef.current) {
        const existingTimer = notePatchTimersRef.current.get(noteId);
        if (existingTimer) window.clearTimeout(existingTimer);
        const timer = window.setTimeout(() => {
          notePatchTimersRef.current.delete(noteId);
          void syncApi(`/api/notes/${encodeURIComponent(noteId)}`, 'PATCH', {
            ...sharedPatch,
            updatedAt,
          });
        }, 280);
        notePatchTimersRef.current.set(noteId, timer);
      } else if (prevShared.ownerEmail) {
        updateSharedNoteLocal(prevShared.ownerEmail, noteId, sharedPatch, updatedAt);
      }
    },
    [recordChange]
  );

  const handleDeleteNote = (noteId: string) => {
    clearNoteHistory(noteId);
    const remaining = notesRef.current.filter((n) => n.id !== noteId);
    notesRef.current = remaining;
    setNotes(remaining);
    if (activeNoteId === noteId) {
      setActiveNoteId(remaining[0]?.id ?? sharedNotesRef.current[0]?.id ?? null);
    }

    if (dbEnabledRef.current) {
      void syncApi(`/api/notes/${encodeURIComponent(noteId)}`, 'DELETE');
    } else if (currentUser) {
      deleteSharesForNoteLocal(noteId, currentUser.id);
    }
  };

  const handleToggleStar = (noteId: string) => {
    const target = notesRef.current.find((n) => n.id === noteId);
    if (!target) return;
    handleUpdateNote(
      noteId,
      { starred: !target.starred },
      { source: 'discrete', field: 'starred' }
    );
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
    const nextNotes = notesRef.current.map((n) =>
      n.folderId === folderId ? { ...n, folderId: null } : n
    );
    notesRef.current = nextNotes;
    setNotes(nextNotes);
    if (filter.type === 'folder' && filter.folderId === folderId) {
      setFilter({ type: 'all' });
    }

    if (dbEnabledRef.current) {
      void syncApi(`/api/folders/${encodeURIComponent(folderId)}`, 'DELETE');
    }
  };

  const handleImportFiles = async ({
    files,
    mode,
    folderId,
  }: {
    files: File[];
    mode: ImportDestinationMode;
    folderId: string | null;
  }) => {
    if (files.length === 0) return;

    const resultsByFile = await Promise.all(files.map((file) => importSingleFile(file)));
    const importedItems = resultsByFile.flat();
    if (importedItems.length === 0) return;

    const canInsert =
      mode === 'insert-current' &&
      activeNote &&
      (!activeNote.isSharedWithMe || activeNote.sharedPermission === 'edit');

    if (canInsert && activeNote) {
      const combined = importedItems
        .map((item) => item.content.trimEnd())
        .filter(Boolean)
        .join('\n\n');
      if (combined) {
        const prefix = activeNote.content.trimEnd() ? `${activeNote.content.trimEnd()}\n\n` : '';
        handleUpdateNote(
          activeNote.id,
          { content: `${prefix}${combined}\n` },
          { source: 'discrete', field: 'content' }
        );
      }
      if (filter.type === 'snippets') setFilter({ type: 'all' });
      return;
    }

    const baseTime = Date.now();
    const validFolderId =
      folderId && folders.some((f) => f.id === folderId) ? folderId : null;

    const createdNotes: NoteDocument[] = importedItems.map((item, index) => ({
      id: `note-${baseTime + index}-${Math.random().toString(36).slice(2, 6)}`,
      title: item.title,
      content: item.content,
      folderId: validFolderId,
      starred: false,
      createdAt: baseTime + index,
      updatedAt: baseTime + index,
    }));

    const nextNotes = [...createdNotes, ...notesRef.current];
    notesRef.current = nextNotes;
    setNotes(nextNotes);
    setActiveNoteId(createdNotes[0].id);
    if (filter.type === 'snippets') setFilter({ type: 'all' });
    setViewMode('read');
    if (window.innerWidth < 1024) setSidebarOpen(false);

    if (dbEnabledRef.current) {
      for (const created of createdNotes) {
        void syncApi('/api/notes', 'POST', created);
      }
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
      handleUpdateNote(
        activeNote.id,
        { content: `${activeNote.content.trimEnd()}${separator}${snippet.content}\n` },
        { source: 'discrete', field: 'content' }
      );
      setFilter({ type: 'all' });
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
      const nextNotes = [created, ...notesRef.current];
      notesRef.current = nextNotes;
      setNotes(nextNotes);
      setActiveNoteId(created.id);
      setFilter({ type: 'all' });
      setViewMode('read');

      if (dbEnabledRef.current) {
        void syncApi('/api/notes', 'POST', created);
      }
    }
  };

  const handleRefreshShared = async () => {
    if (!currentUser) return;
    try {
      const refreshed = await refreshSharedNotes(storageMode, currentUser);
      sharedNotesRef.current = refreshed;
      setSharedNotes(refreshed);
    } catch {
      // Ignore refresh error
    }
  };

  const handleShareNote = async (
    noteId: string,
    email: string,
    permission: SharePermission
  ) => {
    if (!currentUser) return;
    const savedShare = await shareNoteWithEmail(
      storageMode,
      currentUser,
      noteId,
      email,
      permission
    );
    const nextNotes = notesRef.current.map((n) => {
      if (n.id !== noteId) return n;
      const existing = n.shares ?? [];
      const filtered = existing.filter(
        (s) => s.id !== savedShare.id && s.recipientEmail !== savedShare.recipientEmail
      );
      return {
        ...n,
        shares: [savedShare, ...filtered],
      };
    });
    notesRef.current = nextNotes;
    setNotes(nextNotes);
  };

  const handleRevokeShare = async (noteId: string, shareId: string) => {
    if (!currentUser) return;
    await removeNoteShare(storageMode, currentUser, noteId, shareId);
    const nextNotes = notesRef.current.map((n) => {
      if (n.id !== noteId) return n;
      return {
        ...n,
        shares: (n.shares ?? []).filter((s) => s.id !== shareId),
      };
    });
    notesRef.current = nextNotes;
    setNotes(nextNotes);
  };

  const handleUpdateShareLink = async (
    noteId: string,
    linkAccess: LinkAccess,
    regenerate = false
  ) => {
    if (!currentUser) {
      throw new Error('Authentication required');
    }
    const targetNote = notesRef.current.find((n) => n.id === noteId);
    if (!targetNote) {
      throw new Error('Note not found');
    }
    const result = await updateNoteShareLink(
      storageMode,
      currentUser,
      targetNote,
      linkAccess,
      regenerate
    );
    const nextNotes = notesRef.current.map((n) =>
      n.id === noteId
        ? { ...n, shareToken: result.shareToken, linkAccess: result.linkAccess }
        : n
    );
    notesRef.current = nextNotes;
    setNotes(nextNotes);
    return result;
  };

  const handleDuplicateSharedNote = (sourceNote: NoteDocument) => {
    const now = Date.now();
    const duplicated: NoteDocument = {
      id: `note-${now}-${Math.random().toString(36).slice(2, 6)}`,
      title: sourceNote.title ? `${sourceNote.title} (Copy)` : 'Untitled Note (Copy)',
      content: sourceNote.content,
      folderId: folders[0]?.id ?? null,
      starred: false,
      createdAt: now,
      updatedAt: now,
      shares: [],
    };
    const nextNotes = [duplicated, ...notesRef.current];
    notesRef.current = nextNotes;
    setNotes(nextNotes);
    setActiveNoteId(duplicated.id);
    setFilter({ type: 'all' });
    setViewMode('read');

    if (dbEnabledRef.current) {
      void syncApi('/api/notes', 'POST', duplicated);
    }
  };

  const handleExitShareView = () => {
    setActiveShareToken(null);
    if (typeof window !== 'undefined') {
      window.history.replaceState({}, '', '/');
    }
  };

  const handleSaveCopyFromShareLink = (sharedNote: SharedLinkNote) => {
    const now = Date.now();
    const duplicated: NoteDocument = {
      id: `note-${now}-${Math.random().toString(36).slice(2, 6)}`,
      title: sharedNote.title ? `${sharedNote.title} (Copy)` : 'Untitled Note (Copy)',
      content: sharedNote.content,
      folderId: folders[0]?.id ?? null,
      starred: false,
      createdAt: now,
      updatedAt: now,
      shares: [],
    };
    const nextNotes = [duplicated, ...notesRef.current];
    notesRef.current = nextNotes;
    setNotes(nextNotes);
    setActiveNoteId(duplicated.id);
    setFilter({ type: 'all' });
    setViewMode('read');

    if (dbEnabledRef.current) {
      void syncApi('/api/notes', 'POST', duplicated);
    }
    handleExitShareView();
  };

  const handleLogout = async () => {
    for (const timer of notePatchTimersRef.current.values()) {
      window.clearTimeout(timer);
    }
    notePatchTimersRef.current.clear();
    for (const n of notesRef.current) {
      clearNoteHistory(n.id);
    }
    for (const n of sharedNotesRef.current) {
      clearNoteHistory(n.id);
    }
    clearImageMemoryCache();
    clearFileMemoryCache();
    await logoutAccount(storageMode);
    setFilter({ type: 'all' });
    setSearchOpen(false);
    setShareModalOpen(false);
    setImportModalOpen(false);
    setSnippetModalState({ open: false });
    setCurrentUser(null);
  };

  if (!authReady) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-white dark:bg-[#121214] text-neutral-500 dark:text-neutral-400 text-[13.5px]">
        Loading NoteCraft...
      </div>
    );
  }

  if (activeShareToken) {
    return (
      <SharedLinkView
        token={activeShareToken}
        storageMode={storageMode}
        theme={theme}
        currentUser={currentUser}
        onToggleTheme={() => setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'))}
        onExitShareView={handleExitShareView}
        onSaveCopy={currentUser && workspaceLoaded ? handleSaveCopyFromShareLink : undefined}
      />
    );
  }

  if (!currentUser) {
    return (
      <AuthScreen
        storageMode={storageMode}
        theme={theme}
        onToggleTheme={() => setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'))}
        onAuthenticated={(user) => setCurrentUser(user)}
      />
    );
  }

  return (
    <div className="h-screen w-screen overflow-hidden flex bg-white dark:bg-[#121214] text-neutral-900 dark:text-[#ececf1]">
      <Sidebar
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        folders={folders}
        notes={notes}
        sharedNotes={sharedNotes}
        snippetCount={snippets.length}
        activeNoteId={activeNoteId}
        filter={filter}
        theme={theme}
        user={currentUser}
        onLogout={handleLogout}
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
        onRefreshShared={handleRefreshShared}
        onCreateNote={handleCreateNote}
        onDeleteNote={handleDeleteNote}
        onToggleStar={handleToggleStar}
        onCreateFolder={handleCreateFolder}
        onRenameFolder={handleRenameFolder}
        onDeleteFolder={handleDeleteFolder}
        onOpenImportModal={() => setImportModalOpen(true)}
        onDropImportFiles={(files) => {
          const defaultFolder =
            filter.type === 'folder' ? filter.folderId : folders[0]?.id ?? null;
          void handleImportFiles({ files, mode: 'new-notes', folderId: defaultFolder });
        }}
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
          canUndo={canUndo}
          canRedo={canRedo}
          pendingSelection={pendingSelection}
          selectionReaderRef={selectionReaderRef}
          onUndo={handleUndo}
          onRedo={handleRedo}
          onOpenSidebar={() => setSidebarOpen(true)}
          onToggleOutline={() => setOutlineOpen((prev) => !prev)}
          onChangeViewMode={setViewMode}
          onUpdateNote={handleUpdateNote}
          onCreateNote={() => handleCreateNote()}
          onDuplicateSharedNote={handleDuplicateSharedNote}
          onOpenShareModal={() => setShareModalOpen(true)}
          onOpenImportModal={() => setImportModalOpen(true)}
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
        notes={[...notes, ...sharedNotes]}
        folders={folders}
        snippets={snippets}
        onClose={() => setSearchOpen(false)}
        onSelectNote={(noteId) => {
          setActiveNoteId(noteId);
          if (filter.type === 'snippets') setFilter({ type: 'all' });
        }}
        onInsertSnippet={handleInsertSnippetIntoActiveNote}
      />

      <ShareNoteModal
        isOpen={shareModalOpen}
        note={activeNote}
        currentUser={currentUser}
        onClose={() => setShareModalOpen(false)}
        onShare={handleShareNote}
        onRevoke={handleRevokeShare}
        onUpdateShareLink={handleUpdateShareLink}
      />

      <ImportFileModal
        isOpen={importModalOpen}
        folders={folders}
        defaultFolderId={
          filter.type === 'folder' ? filter.folderId : folders[0]?.id ?? null
        }
        canInsertIntoCurrent={Boolean(
          activeNote && (!activeNote.isSharedWithMe || activeNote.sharedPermission === 'edit')
        )}
        currentNoteTitle={activeNote?.title ?? null}
        onClose={() => setImportModalOpen(false)}
        onImport={handleImportFiles}
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
