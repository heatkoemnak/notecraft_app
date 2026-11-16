import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Bold,
  Braces,
  Check,
  CheckSquare,
  ChevronDown,
  Code,
  Columns2,
  Copy,
  FileCode2,
  FileText,
  FileUp,
  Heading2,
  Heading3,
  ImagePlus,
  Italic,
  ListTree,
  Minus,
  PanelLeftOpen,
  Plus,
  Quote,
  Redo2,
  Search,
  Share2,
  Star,
  Table,
  Type,
  Undo2,
  Workflow,
} from 'lucide-react';
import { NoteSelection, NoteUpdateMeta } from '../hooks/useNoteHistory';
import { Folder, NoteDocument, Snippet, ViewMode } from '../types/notes';
import {
  extractHeadings,
  formatRelativeDate,
  getDocumentStats,
  toggleTaskCheckbox,
} from '../utils/markdown';
import { importSingleFile } from '../utils/fileImporter';
import { isImageFile, saveImageFile } from '../utils/imageStore';
import { DiagramBuilderModal } from './DiagramBuilderModal';
import { ImageInsertModal } from './ImageInsertModal';
import { LiveDocumentEditor, LiveDocumentEditorHandle } from './LiveDocumentEditor';
import { MarkdownRenderer } from './MarkdownRenderer';

interface DocumentWorkspaceProps {
  note: NoteDocument | null;
  folders: Folder[];
  snippets: Snippet[];
  viewMode: ViewMode;
  sidebarOpen: boolean;
  outlineOpen: boolean;
  canUndo: boolean;
  canRedo: boolean;
  pendingSelection: {
    noteId: string;
    selection: NoteSelection;
    seq: number;
  } | null;
  selectionReaderRef: React.MutableRefObject<() => NoteSelection | null>;
  onUndo: () => void;
  onRedo: () => void;
  onOpenSidebar: () => void;
  onToggleOutline: () => void;
  onChangeViewMode: (mode: ViewMode) => void;
  onUpdateNote: (
    noteId: string,
    patch: Partial<Pick<NoteDocument, 'title' | 'content' | 'folderId' | 'starred'>>,
    meta?: NoteUpdateMeta
  ) => void;
  onCreateNote: () => void;
  onDuplicateSharedNote: (note: NoteDocument) => void;
  onOpenShareModal: () => void;
  onOpenImportModal: () => void;
  onOpenSnippetModal: (prefillContent?: string) => void;
  onOpenSnippetsLibrary: () => void;
}

type EditorFontId = 'kantumruy' | 'noto-khmer' | 'battambang' | 'plus-jakarta';

const EDITOR_FONT_STORAGE_KEY = 'notecraft.editorFont.v1';

const EDITOR_FONTS: { id: EditorFontId; label: string }[] = [
  { id: 'kantumruy', label: 'Kantumruy Pro' },
  { id: 'noto-khmer', label: 'Noto Sans Khmer' },
  { id: 'battambang', label: 'Battambang' },
  { id: 'plus-jakarta', label: 'Plus Jakarta' },
];

export function DocumentWorkspace({
  note,
  folders,
  snippets,
  viewMode,
  sidebarOpen,
  outlineOpen,
  canUndo,
  canRedo,
  pendingSelection,
  selectionReaderRef,
  onUndo,
  onRedo,
  onOpenSidebar,
  onToggleOutline,
  onChangeViewMode,
  onUpdateNote,
  onCreateNote,
  onDuplicateSharedNote,
  onOpenShareModal,
  onOpenImportModal,
  onOpenSnippetModal,
  onOpenSnippetsLibrary,
}: DocumentWorkspaceProps) {
  const titleInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const liveEditorRef = useRef<LiveDocumentEditorHandle>(null);
  const lastTextareaSelectionRef = useRef<{ start: number; end: number }>({ start: 0, end: 0 });
  const lastTitleSelectionRef = useRef<{ start: number; end: number }>({ start: 0, end: 0 });
  const snippetMenuRef = useRef<HTMLDivElement>(null);
  const [copiedDoc, setCopiedDoc] = useState(false);
  const [snippetMenuOpen, setSnippetMenuOpen] = useState(false);
  const [snippetQuery, setSnippetQuery] = useState('');
  const [hasSelection, setHasSelection] = useState(false);
  const [imageModalOpen, setImageModalOpen] = useState(false);
  const [diagramModalState, setDiagramModalState] = useState<{
    open: boolean;
    mode: 'insert' | 'edit';
    blockId?: string;
    initialCode?: string;
  }>({ open: false, mode: 'insert' });
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const [uploadingImagesCount, setUploadingImagesCount] = useState(0);
  const [editorFont, setEditorFont] = useState<EditorFontId>(() => {
    try {
      const saved = localStorage.getItem(EDITOR_FONT_STORAGE_KEY);
      if (
        saved === 'kantumruy' ||
        saved === 'noto-khmer' ||
        saved === 'battambang' ||
        saved === 'plus-jakarta'
      ) {
        return saved;
      }
    } catch {
      // ignore storage errors
    }
    return 'kantumruy';
  });

  useEffect(() => {
    try {
      localStorage.setItem(EDITOR_FONT_STORAGE_KEY, editorFont);
    } catch {
      // ignore storage errors
    }
  }, [editorFont]);

  const syncTextareaSelection = (el: HTMLTextAreaElement) => {
    const start = el.selectionStart ?? 0;
    const end = el.selectionEnd ?? start;
    lastTextareaSelectionRef.current = { start, end };
    setHasSelection(end > start);
  };

  const syncTitleSelection = (el: HTMLInputElement) => {
    const start = el.selectionStart ?? 0;
    const end = el.selectionEnd ?? start;
    lastTitleSelectionRef.current = { start, end };
  };

  useEffect(() => {
    selectionReaderRef.current = () => {
      const activeEl = document.activeElement;
      if (titleInputRef.current && activeEl === titleInputRef.current) {
        return {
          target: 'title',
          start: titleInputRef.current.selectionStart ?? 0,
          end: titleInputRef.current.selectionEnd ?? 0,
        };
      }
      if (textareaRef.current && activeEl === textareaRef.current) {
        return {
          target: 'content',
          start: textareaRef.current.selectionStart ?? 0,
          end: textareaRef.current.selectionEnd ?? 0,
        };
      }
      if (textareaRef.current) {
        return {
          target: 'content',
          start: lastTextareaSelectionRef.current.start,
          end: lastTextareaSelectionRef.current.end,
        };
      }
      return null;
    };
  }, [selectionReaderRef]);

  useEffect(() => {
    lastTextareaSelectionRef.current = { start: 0, end: 0 };
    lastTitleSelectionRef.current = { start: 0, end: 0 };
    setHasSelection(false);
  }, [note?.id]);

  useEffect(() => {
    if (!pendingSelection || !note || pendingSelection.noteId !== note.id) return;
    const { target, start, end } = pendingSelection.selection;

    window.requestAnimationFrame(() => {
      if (target === 'title' && titleInputRef.current) {
        const input = titleInputRef.current;
        const clampedStart = Math.min(start, input.value.length);
        const clampedEnd = Math.min(end, input.value.length);
        if (document.activeElement !== input) {
          input.focus();
        }
        input.setSelectionRange(clampedStart, clampedEnd);
        lastTitleSelectionRef.current = { start: clampedStart, end: clampedEnd };
      } else if (target === 'content' && textareaRef.current) {
        const textarea = textareaRef.current;
        const scrollTop = textarea.scrollTop;
        const clampedStart = Math.min(start, textarea.value.length);
        const clampedEnd = Math.min(end, textarea.value.length);
        if (document.activeElement !== textarea) {
          textarea.focus();
        }
        textarea.scrollTop = scrollTop;
        textarea.setSelectionRange(clampedStart, clampedEnd);
        lastTextareaSelectionRef.current = { start: clampedStart, end: clampedEnd };
        setHasSelection(clampedEnd > clampedStart);
      }
    });
  }, [pendingSelection, note?.id]);

  const headings = useMemo(() => (note ? extractHeadings(note.content) : []), [note]);
  const stats = useMemo(() => (note ? getDocumentStats(note.content) : null), [note]);

  const filteredSnippets = useMemo(() => {
    const q = snippetQuery.trim().toLowerCase();
    return snippets.filter(
      (s) =>
        !q ||
        s.title.toLowerCase().includes(q) ||
        s.category.toLowerCase().includes(q) ||
        s.language.toLowerCase().includes(q)
    );
  }, [snippets, snippetQuery]);

  // Close snippet popover on outside click
  useEffect(() => {
    if (!snippetMenuOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (snippetMenuRef.current && !snippetMenuRef.current.contains(e.target as Node)) {
        setSnippetMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [snippetMenuOpen]);

  const folderName = useMemo(() => {
    if (!note?.folderId) return 'Unfiled';
    return folders.find((f) => f.id === note.folderId)?.name || 'Unfiled';
  }, [note, folders]);

  const insertAtCursor = (
    textToInsert: string,
    selectStartOffset?: number,
    selectEndOffset?: number
  ) => {
    if (!note) return;
    const textarea = textareaRef.current;

    if (!textarea) {
      const separator = note.content.trimEnd() ? '\n\n' : '';
      onUpdateNote(
        note.id,
        { content: `${note.content.trimEnd()}${separator}${textToInsert}\n` },
        { source: 'discrete', field: 'content' }
      );
      return;
    }

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const scrollTop = textarea.scrollTop;
    const before = note.content.slice(0, start);
    const after = note.content.slice(end);
    const nextContent = `${before}${textToInsert}${after}`;
    const nextSelStart =
      selectStartOffset !== undefined ? start + selectStartOffset : start + textToInsert.length;
    const nextSelEnd =
      selectEndOffset !== undefined ? start + selectEndOffset : nextSelStart;

    lastTextareaSelectionRef.current = { start: nextSelStart, end: nextSelEnd };
    onUpdateNote(
      note.id,
      { content: nextContent },
      {
        source: 'discrete',
        field: 'content',
        prevSelection: { target: 'content', start, end },
        nextSelection: { target: 'content', start: nextSelStart, end: nextSelEnd },
      }
    );

    window.requestAnimationFrame(() => {
      textarea.focus();
      textarea.scrollTop = scrollTop;
      textarea.setSelectionRange(nextSelStart, nextSelEnd);
      setHasSelection(nextSelEnd > nextSelStart);
    });
  };

  const wrapSelection = (prefix: string, suffix: string, placeholder: string) => {
    if (!note) return;
    const textarea = textareaRef.current;
    if (!textarea) return;

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selected = note.content.slice(start, end) || placeholder;
    const replacement = `${prefix}${selected}${suffix}`;
    const scrollTop = textarea.scrollTop;
    const nextSelStart = start + prefix.length;
    const nextSelEnd = nextSelStart + selected.length;

    const nextContent = note.content.slice(0, start) + replacement + note.content.slice(end);
    lastTextareaSelectionRef.current = { start: nextSelStart, end: nextSelEnd };
    onUpdateNote(
      note.id,
      { content: nextContent },
      {
        source: 'discrete',
        field: 'content',
        prevSelection: { target: 'content', start, end },
        nextSelection: { target: 'content', start: nextSelStart, end: nextSelEnd },
      }
    );

    window.requestAnimationFrame(() => {
      textarea.focus();
      textarea.scrollTop = scrollTop;
      textarea.setSelectionRange(nextSelStart, nextSelEnd);
      setHasSelection(nextSelEnd > nextSelStart);
    });
  };

  const handleInsertSnippet = (snippet: Snippet) => {
    if (!note) return;
    if (viewMode === 'read' && liveEditorRef.current) {
      liveEditorRef.current.insertMarkdownContent(snippet.content);
    } else {
      const textarea = textareaRef.current;
      if (textarea) {
        const start = textarea.selectionStart;
        const needsLeadingNewline = start > 0 && note.content[start - 1] !== '\n';
        const prefix = needsLeadingNewline ? '\n\n' : '';
        insertAtCursor(`${prefix}${snippet.content}\n`);
      } else {
        const separator = note.content.trimEnd() ? '\n\n' : '';
        onUpdateNote(
          note.id,
          { content: `${note.content.trimEnd()}${separator}${snippet.content}\n` },
          { source: 'discrete', field: 'content' }
        );
      }
    }
    setSnippetMenuOpen(false);
    setSnippetQuery('');
  };

  const handleSaveSelectionAsSnippet = () => {
    if (!note) return;
    if (viewMode === 'read' && liveEditorRef.current) {
      const selected = liveEditorRef.current.getSelectedText();
      onOpenSnippetModal(selected || undefined);
      return;
    }
    const textarea = textareaRef.current;
    if (textarea) {
      const selected = note.content.slice(textarea.selectionStart, textarea.selectionEnd).trim();
      onOpenSnippetModal(selected || undefined);
    } else {
      onOpenSnippetModal();
    }
  };

  const handleInsertImageMarkdown = (markdownImage: string) => {
    if (!note) return;
    if (viewMode === 'read' && liveEditorRef.current) {
      liveEditorRef.current.insertMarkdownContent(markdownImage);
      return;
    }
    const textarea = textareaRef.current;
    if (textarea && viewMode !== 'read') {
      const start = textarea.selectionStart;
      const needsLeadingNewline = start > 0 && note.content[start - 1] !== '\n';
      const prefix = needsLeadingNewline ? '\n\n' : '';
      insertAtCursor(`${prefix}${markdownImage}\n`);
    } else {
      const separator = note.content.trimEnd() ? '\n\n' : '';
      onUpdateNote(
        note.id,
        { content: `${note.content.trimEnd()}${separator}${markdownImage}\n` },
        { source: 'discrete', field: 'content' }
      );
    }
  };

  const handleImageFiles = async (files: FileList | File[]) => {
    if (!note || isReadOnly) return;
    const imageFiles = Array.from(files).filter(isImageFile);
    if (imageFiles.length === 0) return;

    setUploadingImagesCount((c) => c + imageFiles.length);
    try {
      const savedList = await Promise.all(imageFiles.map((file) => saveImageFile(file)));
      const blocks = savedList.map((saved) => {
        const safeAlt = saved.alt.replace(/[\[\]]/g, '');
        return `![${safeAlt}](${saved.refUrl})`;
      });
      handleInsertImageMarkdown(blocks.join('\n\n'));
    } finally {
      setUploadingImagesCount((c) => Math.max(0, c - imageFiles.length));
    }
  };

  const handleDroppedFiles = async (files: FileList | File[]) => {
    if (!note || isReadOnly) return;
    const list = Array.from(files);
    if (list.length === 0) return;

    if (list.every(isImageFile)) {
      await handleImageFiles(list);
      return;
    }

    setUploadingImagesCount((c) => c + list.length);
    try {
      const resultGroups = await Promise.all(list.map((file) => importSingleFile(file)));
      const combined = resultGroups
        .flat()
        .map((item) => item.content.trimEnd())
        .filter(Boolean)
        .join('\n\n');
      if (combined) {
        handleInsertImageMarkdown(combined);
      }
    } finally {
      setUploadingImagesCount((c) => Math.max(0, c - list.length));
    }
  };

  const handleEditorPaste = async (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = Array.from(e.clipboardData?.items || []);
    const imageItems = items.filter((item) => item.type.startsWith('image/'));
    if (imageItems.length === 0) return;

    e.preventDefault();
    const files: File[] = [];
    for (const item of imageItems) {
      const file = item.getAsFile();
      if (file) files.push(file);
    }
    if (files.length > 0) {
      await handleImageFiles(files);
    }
  };

  const handleEditorKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (!note) return;
    const textarea = e.currentTarget;
    syncTextareaSelection(textarea);

    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'b') {
      e.preventDefault();
      wrapSelection('**', '**', 'bold text');
      return;
    }

    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'i') {
      e.preventDefault();
      wrapSelection('*', '*', 'italic text');
      return;
    }

    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      wrapSelection('[', '](https://)', 'link text');
      return;
    }

    if (e.key === 'Tab') {
      e.preventDefault();
      insertAtCursor('  ');
      return;
    }

    if (e.key === 'Enter' && !e.shiftKey && !e.metaKey && !e.ctrlKey) {
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const lineStart = note.content.lastIndexOf('\n', start - 1) + 1;
      const currentLine = note.content.slice(lineStart, start);

      const clearEmptyListPrefix = () => {
        const nextContent = note.content.slice(0, lineStart) + note.content.slice(start);
        lastTextareaSelectionRef.current = { start: lineStart, end: lineStart };
        onUpdateNote(
          note.id,
          { content: nextContent },
          {
            source: 'discrete',
            field: 'content',
            prevSelection: { target: 'content', start, end },
            nextSelection: { target: 'content', start: lineStart, end: lineStart },
          }
        );
        window.requestAnimationFrame(() => textarea.setSelectionRange(lineStart, lineStart));
      };

      const taskMatch = /^(\s*(?:[-*+])\s+\[[ xX]\]\s+)(.*)$/.exec(currentLine);
      if (taskMatch) {
        e.preventDefault();
        if (!taskMatch[2].trim()) {
          clearEmptyListPrefix();
        } else {
          const indent = /^(\s*)/.exec(currentLine)?.[1] || '';
          insertAtCursor(`\n${indent}- [ ] `);
        }
        return;
      }

      const bulletMatch = /^(\s*[-*+]\s+)(.*)$/.exec(currentLine);
      if (bulletMatch) {
        e.preventDefault();
        if (!bulletMatch[2].trim()) {
          clearEmptyListPrefix();
        } else {
          insertAtCursor(`\n${bulletMatch[1]}`);
        }
        return;
      }

      const orderedMatch = /^(\s*)(\d+)(\.\s+)(.*)$/.exec(currentLine);
      if (orderedMatch) {
        e.preventDefault();
        if (!orderedMatch[4].trim()) {
          clearEmptyListPrefix();
        } else {
          const nextNum = Number(orderedMatch[2]) + 1;
          insertAtCursor(`\n${orderedMatch[1]}${nextNum}${orderedMatch[3]}`);
        }
      }
    }
  };

  const handleCopyDocument = async () => {
    if (!note) return;
    const fullDoc = `# ${note.title || 'Untitled Note'}\n\n${note.content}`;
    try {
      await navigator.clipboard.writeText(fullDoc);
      setCopiedDoc(true);
      window.setTimeout(() => setCopiedDoc(false), 1600);
    } catch {
      // Clipboard blocked
    }
  };

  const scrollToHeading = (headingId: string) => {
    if (viewMode === 'write') {
      onChangeViewMode('split');
      window.setTimeout(() => {
        document.getElementById(headingId)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 60);
      return;
    }
    document.getElementById(headingId)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  if (!note) {
    return (
      <div className="flex-1 flex flex-col min-w-0 bg-white dark:bg-[#121214]">
        <header className="h-[52px] shrink-0 px-5 border-b border-neutral-200 dark:border-white/[0.07] flex items-center gap-3">
          {!sidebarOpen && (
            <button
              type="button"
              onClick={onOpenSidebar}
              aria-label="Open sidebar"
              className="p-2 -ml-2 rounded-lg text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-white hover:bg-neutral-100 dark:hover:bg-white/[0.06] cursor-pointer"
            >
              <PanelLeftOpen className="w-[18px] h-[18px]" />
            </button>
          )}
          <span className="text-[14px] font-medium text-neutral-500 dark:text-neutral-400">
            NoteCraft Workspace
          </span>
        </header>

        <div className="flex-1 flex items-center justify-center p-8">
          <div className="max-w-md text-center space-y-4">
            <h2 className="text-[22px] font-semibold tracking-tight text-neutral-950 dark:text-white">
              Select or create a technical note
            </h2>
            <p className="text-[14px] text-neutral-600 dark:text-neutral-400 leading-relaxed">
              Write structured Markdown documentation, organize project folders, and insert reusable code or command snippets.
            </p>
            <div className="flex flex-wrap items-center justify-center gap-2.5 pt-2">
              <button
                type="button"
                onClick={onCreateNote}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-[13.5px] font-medium bg-blue-600 hover:bg-blue-700 text-white transition-colors cursor-pointer whitespace-nowrap"
              >
                <Plus className="w-4 h-4" />
                <span>New note</span>
              </button>
              <button
                type="button"
                onClick={onOpenImportModal}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-[13.5px] font-medium border border-neutral-200 dark:border-white/12 text-neutral-700 dark:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-white/[0.06] transition-colors cursor-pointer whitespace-nowrap"
              >
                <FileUp className="w-4 h-4" />
                <span>Import file</span>
              </button>
              <button
                type="button"
                onClick={onOpenSnippetsLibrary}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-[13.5px] font-medium border border-neutral-200 dark:border-white/12 text-neutral-700 dark:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-white/[0.06] transition-colors cursor-pointer whitespace-nowrap"
              >
                <Braces className="w-4 h-4" />
                <span>Browse snippets</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const isSharedWithMe = Boolean(note.isSharedWithMe);
  const isReadOnly = Boolean(isSharedWithMe && note.sharedPermission !== 'edit');
  const shareCount = note.shares?.length ?? 0;

  return (
    <div
      data-document-workspace="true"
      data-editor-font={editorFont}
      className="flex-1 flex flex-col min-w-0 bg-white dark:bg-[#121214]"
    >
      {/* Top Document Bar */}
      <header className="h-[52px] shrink-0 px-4 sm:px-5 border-b border-neutral-200 dark:border-white/[0.07] flex items-center justify-between gap-3">
        {/* Left: Sidebar toggle + Note breadcrumb & folder selector */}
        <div className="flex items-center gap-2 min-w-0">
          {!sidebarOpen && (
            <button
              type="button"
              onClick={onOpenSidebar}
              aria-label="Open sidebar"
              title="Open sidebar"
              className="p-2 -ml-1 rounded-lg text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-white hover:bg-neutral-100 dark:hover:bg-white/[0.06] cursor-pointer shrink-0"
            >
              <PanelLeftOpen className="w-[18px] h-[18px]" />
            </button>
          )}

          <div className="flex items-center gap-1.5 min-w-0">
            <span className="text-[14px] font-medium text-neutral-900 dark:text-neutral-100 truncate max-w-[160px] sm:max-w-[260px]">
              {note.title || 'Untitled Note'}
            </span>

            <span className="text-neutral-300 dark:text-neutral-700 shrink-0">/</span>

            {isSharedWithMe ? (
              <span className="text-[12.5px] text-neutral-500 dark:text-neutral-400 truncate max-w-[220px] hidden sm:inline">
                Shared by {note.ownerName || note.ownerEmail} · {isReadOnly ? 'View only' : 'Can edit'}
              </span>
            ) : (
              <>
                <div className="relative flex items-center shrink-0">
                  <select
                    value={note.folderId || ''}
                    onChange={(e) =>
                      onUpdateNote(
                        note.id,
                        { folderId: e.target.value ? e.target.value : null },
                        { source: 'discrete', field: 'folderId' }
                      )
                    }
                    aria-label="Move note to project folder"
                    className="appearance-none bg-transparent pr-5 pl-1.5 py-1 rounded-md text-[13px] text-neutral-500 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-white/[0.06] focus:outline-none cursor-pointer"
                  >
                    <option value="" className="bg-white dark:bg-[#1a1a1e]">
                      Unfiled
                    </option>
                    {folders.map((folder) => (
                      <option key={folder.id} value={folder.id} className="bg-white dark:bg-[#1a1a1e]">
                        {folder.name}
                      </option>
                    ))}
                  </select>
                  <ChevronDown className="w-3.5 h-3.5 text-neutral-400 pointer-events-none absolute right-1" />
                </div>

                <button
                  type="button"
                  onClick={() =>
                    onUpdateNote(
                      note.id,
                      { starred: !note.starred },
                      { source: 'discrete', field: 'starred' }
                    )
                  }
                  aria-label={note.starred ? 'Remove star' : 'Star note'}
                  title={note.starred ? 'Starred' : 'Star this note'}
                  className={`p-1.5 rounded-lg transition-colors cursor-pointer shrink-0 ${
                    note.starred
                      ? 'text-amber-500 hover:bg-amber-500/10'
                      : 'text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-white/[0.06]'
                  }`}
                >
                  <Star className="w-3.5 h-3.5" fill={note.starred ? 'currentColor' : 'none'} />
                </button>
              </>
            )}
          </div>
        </div>

        {/* Right: Mode Switch + Actions */}
        <div className="flex items-center gap-2 shrink-0">
          {/* Segmented View Mode Switch */}
          <div
            className="flex items-center p-0.5 rounded-lg bg-neutral-100 dark:bg-white/[0.05] border border-neutral-200/80 dark:border-white/[0.07]"
            role="tablist"
            aria-label="Document view mode"
          >
            <button
              type="button"
              role="tab"
              aria-selected={viewMode === 'read'}
              onClick={() => onChangeViewMode('read')}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[12.5px] font-medium transition-colors cursor-pointer whitespace-nowrap ${
                viewMode === 'read'
                  ? 'bg-white dark:bg-[#27272c] text-neutral-950 dark:text-white shadow-xs'
                  : 'text-neutral-600 dark:text-neutral-400 hover:text-neutral-950 dark:hover:text-white'
              }`}
            >
              <FileText className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Document</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={viewMode === 'split'}
              onClick={() => onChangeViewMode('split')}
              className={`hidden md:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[12.5px] font-medium transition-colors cursor-pointer whitespace-nowrap ${
                viewMode === 'split'
                  ? 'bg-white dark:bg-[#27272c] text-neutral-950 dark:text-white shadow-xs'
                  : 'text-neutral-600 dark:text-neutral-400 hover:text-neutral-950 dark:hover:text-white'
              }`}
            >
              <Columns2 className="w-3.5 h-3.5" />
              <span>Split</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={viewMode === 'write'}
              onClick={() => onChangeViewMode('write')}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[12.5px] font-medium transition-colors cursor-pointer whitespace-nowrap ${
                viewMode === 'write'
                  ? 'bg-white dark:bg-[#27272c] text-neutral-950 dark:text-white shadow-xs'
                  : 'text-neutral-600 dark:text-neutral-400 hover:text-neutral-950 dark:hover:text-white'
              }`}
            >
              <FileCode2 className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Markdown</span>
            </button>
          </div>

          <button
            type="button"
            onClick={onToggleOutline}
            aria-label="Toggle document outline"
            title="Document outline"
            className={`hidden xl:inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[12.5px] font-medium transition-colors cursor-pointer whitespace-nowrap ${
              outlineOpen
                ? 'bg-neutral-100 dark:bg-white/[0.08] text-neutral-950 dark:text-white'
                : 'text-neutral-500 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-white hover:bg-neutral-100 dark:hover:bg-white/[0.06]'
            }`}
          >
            <ListTree className="w-3.5 h-3.5" />
            <span>Outline</span>
          </button>

          <button
            type="button"
            onClick={handleCopyDocument}
            title="Copy Markdown to clipboard"
            aria-label="Copy Markdown"
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[12.5px] font-medium text-neutral-600 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-white/[0.06] transition-colors cursor-pointer whitespace-nowrap"
          >
            {copiedDoc ? (
              <>
                <Check className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                <span className="hidden sm:inline text-emerald-700 dark:text-emerald-400">Copied</span>
              </>
            ) : (
              <>
                <Copy className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Copy</span>
              </>
            )}
          </button>

          <button
            type="button"
            onClick={onOpenShareModal}
            title="Share by email or export PDF / DOC / MD"
            aria-label="Share and export note"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12.5px] font-medium bg-blue-600 hover:bg-blue-700 text-white transition-colors cursor-pointer whitespace-nowrap tabular-nums"
          >
            <Share2 className="w-3.5 h-3.5" />
            <span>{!isSharedWithMe && shareCount > 0 ? `Share · ${shareCount}` : 'Share'}</span>
          </button>
        </div>
      </header>

      {/* Formatting & Snippet Toolbar */}
      <div className="shrink-0 px-4 sm:px-5 py-2 border-b border-neutral-200 dark:border-white/[0.07] bg-neutral-50/70 dark:bg-[#151518] flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-0.5 flex-wrap">
          {!isReadOnly && (
            <>
              <ToolbarButton
                label="Undo (Ctrl+Z)"
                onClick={onUndo}
                disabled={!canUndo}
                icon={<Undo2 className="w-4 h-4" />}
              />
              <ToolbarButton
                label="Redo (Ctrl+Y)"
                onClick={onRedo}
                disabled={!canRedo}
                icon={<Redo2 className="w-4 h-4" />}
              />
              <div className="w-px h-4 bg-neutral-200 dark:bg-white/10 mx-1" />
              <ToolbarButton
                label="Heading 2"
                onClick={() =>
                  viewMode === 'read'
                    ? liveEditorRef.current?.toggleOrInsertBlock('h2')
                    : insertAtCursor('## ', 3, 3)
                }
                icon={<Heading2 className="w-4 h-4" />}
              />
              <ToolbarButton
                label="Heading 3"
                onClick={() =>
                  viewMode === 'read'
                    ? liveEditorRef.current?.toggleOrInsertBlock('h3')
                    : insertAtCursor('### ', 4, 4)
                }
                icon={<Heading3 className="w-4 h-4" />}
              />
              <div className="w-px h-4 bg-neutral-200 dark:bg-white/10 mx-1" />
              <ToolbarButton
                label="Bold (Ctrl+B)"
                onClick={() =>
                  viewMode === 'read'
                    ? liveEditorRef.current?.applyInlineFormat('bold')
                    : wrapSelection('**', '**', 'bold text')
                }
                icon={<Bold className="w-4 h-4" />}
              />
              <ToolbarButton
                label="Italic (Ctrl+I)"
                onClick={() =>
                  viewMode === 'read'
                    ? liveEditorRef.current?.applyInlineFormat('italic')
                    : wrapSelection('*', '*', 'italic text')
                }
                icon={<Italic className="w-4 h-4" />}
              />
              <ToolbarButton
                label="Inline code"
                onClick={() =>
                  viewMode === 'read'
                    ? liveEditorRef.current?.applyInlineFormat('code')
                    : wrapSelection('`', '`', 'code')
                }
                icon={<Code className="w-4 h-4" />}
              />
              <div className="w-px h-4 bg-neutral-200 dark:bg-white/10 mx-1" />
              <ToolbarButton
                label="Code block"
                onClick={() =>
                  viewMode === 'read'
                    ? liveEditorRef.current?.insertCodeBlock('bash', '')
                    : insertAtCursor('```bash\n\n```\n', 8, 8)
                }
                icon={<FileCode2 className="w-4 h-4" />}
              />
              <ToolbarButton
                label="Insert images"
                onClick={() => setImageModalOpen(true)}
                icon={<ImagePlus className="w-4 h-4" />}
              />
              <ToolbarButton
                label="Import file"
                onClick={onOpenImportModal}
                icon={<FileUp className="w-4 h-4" />}
              />
              <ToolbarButton
                label="Table"
                onClick={() =>
                  viewMode === 'read'
                    ? liveEditorRef.current?.insertTableBlock()
                    : insertAtCursor(
                        '| Column A | Column B |\n| :--- | :--- |\n| Value 1 | Value 2 |\n'
                      )
                }
                icon={<Table className="w-4 h-4" />}
              />
              <ToolbarButton
                label="Insert diagram or flowchart"
                onClick={() =>
                  setDiagramModalState({ open: true, mode: 'insert' })
                }
                icon={<Workflow className="w-4 h-4" />}
              />
              <ToolbarButton
                label="Checklist"
                onClick={() =>
                  viewMode === 'read'
                    ? liveEditorRef.current?.toggleOrInsertBlock('task-item')
                    : insertAtCursor('- [ ] Task item\n')
                }
                icon={<CheckSquare className="w-4 h-4" />}
              />
              <ToolbarButton
                label="Callout quote"
                onClick={() =>
                  viewMode === 'read'
                    ? liveEditorRef.current?.toggleOrInsertBlock('blockquote')
                    : insertAtCursor('> Note: ')
                }
                icon={<Quote className="w-4 h-4" />}
              />
              <ToolbarButton
                label="Horizontal rule"
                onClick={() =>
                  viewMode === 'read'
                    ? liveEditorRef.current?.insertDividerBlock()
                    : insertAtCursor('\n---\n\n')
                }
                icon={<Minus className="w-4 h-4" />}
              />
              <div className="w-px h-4 bg-neutral-200 dark:bg-white/10 mx-1" />
            </>
          )}
          <div className="relative flex items-center shrink-0">
            <Type className="w-3.5 h-3.5 text-neutral-400 pointer-events-none absolute left-2" />
            <select
              value={editorFont}
              onChange={(e) => setEditorFont(e.target.value as EditorFontId)}
              aria-label="Editor font"
              title="Editor font"
              className="appearance-none bg-transparent pl-7 pr-6 py-1 rounded-md text-[12px] font-medium text-neutral-600 dark:text-neutral-300 hover:text-neutral-950 dark:hover:text-white hover:bg-neutral-200/70 dark:hover:bg-white/[0.07] focus:outline-none cursor-pointer"
            >
              {EDITOR_FONTS.map((font) => (
                <option key={font.id} value={font.id} className="bg-white dark:bg-[#1a1a1e]">
                  {font.label}
                </option>
              ))}
            </select>
            <ChevronDown className="w-3 h-3 text-neutral-400 pointer-events-none absolute right-1.5" />
          </div>
          {uploadingImagesCount > 0 && (
            <span className="text-[12px] text-blue-600 dark:text-blue-400 ml-2 tabular-nums">
              Processing {uploadingImagesCount}{' '}
              {uploadingImagesCount === 1 ? 'file' : 'files'}...
            </span>
          )}
          {isReadOnly && (
            <span className="text-[12px] text-neutral-500 dark:text-neutral-400 ml-2">
              View-only shared document
            </span>
          )}
        </div>

          <div className="flex items-center gap-2 shrink-0">
            {isReadOnly ? (
              <button
                type="button"
                onClick={() => onDuplicateSharedNote(note)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12.5px] font-medium bg-blue-600 hover:bg-blue-700 text-white transition-colors cursor-pointer whitespace-nowrap"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Save a copy to my notes</span>
              </button>
            ) : (
              <>
            <button
              type="button"
              onClick={handleSaveSelectionAsSnippet}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[12.5px] font-medium text-neutral-600 dark:text-neutral-300 hover:bg-neutral-200/70 dark:hover:bg-white/[0.07] transition-colors cursor-pointer whitespace-nowrap"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>{hasSelection ? 'Save selection as snippet' : 'New snippet'}</span>
            </button>

            <div className="relative" ref={snippetMenuRef}>
              <button
                type="button"
                onClick={() => setSnippetMenuOpen((prev) => !prev)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12.5px] font-medium bg-blue-600 hover:bg-blue-700 text-white transition-colors cursor-pointer whitespace-nowrap"
              >
                <Braces className="w-3.5 h-3.5" />
                <span>Insert snippet</span>
                <ChevronDown className="w-3.5 h-3.5" />
              </button>

              {snippetMenuOpen && (
                <div className="absolute right-0 mt-2 w-80 rounded-xl border border-neutral-200 dark:border-white/12 bg-white dark:bg-[#19191e] shadow-2xl z-30 overflow-hidden">
                  <div className="p-2.5 border-b border-neutral-200 dark:border-white/[0.07] flex items-center gap-2">
                    <Search className="w-3.5 h-3.5 text-neutral-400 shrink-0" />
                    <input
                      type="text"
                      value={snippetQuery}
                      onChange={(e) => setSnippetQuery(e.target.value)}
                      placeholder="Filter saved snippets..."
                      autoFocus
                      className="w-full bg-transparent text-[13px] text-neutral-900 dark:text-white placeholder:text-neutral-400 focus:outline-none"
                    />
                  </div>
                  <div className="max-h-72 overflow-y-auto p-1.5 space-y-0.5">
                    {filteredSnippets.length === 0 ? (
                      <div className="py-6 text-center text-[12.5px] text-neutral-500">
                        No snippets match "{snippetQuery}".
                      </div>
                    ) : (
                      filteredSnippets.map((snippet) => (
                        <button
                          key={snippet.id}
                          type="button"
                          onClick={() => handleInsertSnippet(snippet)}
                          className="w-full text-left px-3 py-2 rounded-lg hover:bg-neutral-100 dark:hover:bg-white/[0.06] transition-colors cursor-pointer"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-[13px] font-medium text-neutral-900 dark:text-white truncate">
                              {snippet.title}
                            </span>
                            <span className="text-[11px] font-mono-code text-neutral-400 shrink-0">
                              {snippet.language}
                            </span>
                          </div>
                          <div className="text-[11.5px] text-neutral-500 dark:text-neutral-400 truncate mt-0.5">
                            {snippet.category}
                            {snippet.description ? ` · ${snippet.description}` : ''}
                          </div>
                        </button>
                      ))
                    )}
                  </div>
                  <div className="p-2 border-t border-neutral-200 dark:border-white/[0.07] bg-neutral-50 dark:bg-white/[0.02] flex justify-between items-center">
                    <button
                      type="button"
                      onClick={() => {
                        setSnippetMenuOpen(false);
                        onOpenSnippetsLibrary();
                      }}
                      className="text-[12px] font-medium text-blue-600 dark:text-blue-400 hover:underline px-1.5 py-0.5 cursor-pointer"
                    >
                      Manage snippet library
                    </button>
                  </div>
                </div>
              )}
            </div>
              </>
            )}
          </div>
        </div>

      {/* Main Document Area + Optional Outline Rail */}
      <div className="flex-1 flex min-h-0 overflow-hidden">
        {viewMode === 'split' ? (
          <div className="flex-1 grid grid-cols-1 md:grid-cols-2 min-h-0 divide-y md:divide-y-0 md:divide-x divide-neutral-200 dark:divide-white/[0.07]">
            {/* Left Pane: Markdown Source */}
            <div className="flex flex-col min-h-0 overflow-y-auto px-6 py-6">
              <input
                ref={titleInputRef}
                data-note-field="title"
                type="text"
                readOnly={isReadOnly}
                value={note.title}
                onFocus={(e) => syncTitleSelection(e.currentTarget)}
                onSelect={(e) => syncTitleSelection(e.currentTarget)}
                onKeyDown={(e) => syncTitleSelection(e.currentTarget)}
                onMouseUp={(e) => syncTitleSelection(e.currentTarget)}
                onPaste={(e) => syncTitleSelection(e.currentTarget)}
                onCut={(e) => syncTitleSelection(e.currentTarget)}
                onChange={(e) => {
                  if (isReadOnly) return;
                  const nextStart = e.target.selectionStart ?? e.target.value.length;
                  const nextEnd = e.target.selectionEnd ?? nextStart;
                  const prevSel = lastTitleSelectionRef.current;
                  lastTitleSelectionRef.current = { start: nextStart, end: nextEnd };
                  onUpdateNote(
                    note.id,
                    { title: e.target.value },
                    {
                      source: 'typing',
                      field: 'title',
                      prevSelection: { target: 'title', ...prevSel },
                      nextSelection: { target: 'title', start: nextStart, end: nextEnd },
                    }
                  );
                }}
                placeholder="Document title..."
                aria-label="Document title"
                className="editor-prose-font w-full bg-transparent text-[26px] font-bold leading-[1.5] py-1 text-neutral-950 dark:text-white placeholder:text-neutral-400 focus:outline-none mb-2"
              />
              <div className="flex items-center gap-2 text-[12.5px] text-neutral-500 dark:text-neutral-400 mb-5 tabular-nums">
                <span>
                  {isSharedWithMe
                    ? `Shared by ${note.ownerName || note.ownerEmail}`
                    : folderName}
                </span>
                <span aria-hidden="true">·</span>
                <span>Updated {formatRelativeDate(note.updatedAt)}</span>
                {stats && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span>{stats.words} words</span>
                  </>
                )}
              </div>
              <textarea
                ref={textareaRef}
                data-note-field="content"
                readOnly={isReadOnly}
                value={note.content}
                onFocus={(e) => syncTextareaSelection(e.currentTarget)}
                onMouseUp={(e) => syncTextareaSelection(e.currentTarget)}
                onKeyUp={(e) => syncTextareaSelection(e.currentTarget)}
                onCut={(e) => syncTextareaSelection(e.currentTarget)}
                onChange={(e) => {
                  if (isReadOnly) return;
                  const nextStart = e.target.selectionStart ?? e.target.value.length;
                  const nextEnd = e.target.selectionEnd ?? nextStart;
                  const prevSel = lastTextareaSelectionRef.current;
                  lastTextareaSelectionRef.current = { start: nextStart, end: nextEnd };
                  setHasSelection(nextEnd > nextStart);
                  onUpdateNote(
                    note.id,
                    { content: e.target.value },
                    {
                      source: 'typing',
                      field: 'content',
                      prevSelection: { target: 'content', ...prevSel },
                      nextSelection: { target: 'content', start: nextStart, end: nextEnd },
                    }
                  );
                }}
                onKeyDown={(e) => {
                  if (!isReadOnly) handleEditorKeyDown(e);
                }}
                onPaste={async (e) => {
                  if (isReadOnly) return;
                  syncTextareaSelection(e.currentTarget);
                  await handleEditorPaste(e);
                }}
                onDragOver={(e) => {
                  if (!isReadOnly && e.dataTransfer.types.includes('Files')) {
                    e.preventDefault();
                    setIsDraggingOver(true);
                  }
                }}
                onDragLeave={(e) => {
                  if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                    setIsDraggingOver(false);
                  }
                }}
                onDrop={async (e) => {
                  if (!isReadOnly && e.dataTransfer.files?.length) {
                    e.preventDefault();
                    setIsDraggingOver(false);
                    await handleDroppedFiles(e.dataTransfer.files);
                  }
                }}
                onSelect={(e) => syncTextareaSelection(e.currentTarget)}
                placeholder="Write Markdown notes, paste screenshots, or press Insert snippet above..."
                aria-label="Markdown document editor"
                className={`editor-source-font flex-1 w-full min-h-[420px] bg-transparent text-[14px] leading-[1.8] text-neutral-800 dark:text-neutral-200 placeholder:text-neutral-400 focus:outline-none resize-none rounded-lg transition-colors ${
                  isDraggingOver ? 'ring-2 ring-blue-500/60 bg-blue-500/5' : ''
                }`}
              />
            </div>

            {/* Right Pane: Live Document Preview */}
            <div className="overflow-y-auto px-6 sm:px-8 py-6">
              <div className="max-w-[720px] mx-auto">
                <h1 className="editor-prose-font text-[28px] font-bold text-neutral-950 dark:text-white mb-2 leading-[1.45]">
                  {note.title || 'Untitled Note'}
                </h1>
                <div className="flex items-center gap-2 text-[12.5px] text-neutral-500 dark:text-neutral-400 mb-7 tabular-nums">
                  <span>
                    {isSharedWithMe
                      ? `Shared by ${note.ownerName || note.ownerEmail}`
                      : folderName}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span>{stats?.readMinutes ?? 1} min read</span>
                </div>
                <MarkdownRenderer
                  content={note.content || '*Start typing in the editor to preview your Markdown document.*'}
                  onToggleCheckbox={
                    isReadOnly
                      ? undefined
                      : (idx) =>
                          onUpdateNote(
                            note.id,
                            { content: toggleTaskCheckbox(note.content, idx) },
                            { source: 'discrete', field: 'content' }
                          )
                  }
                />
              </div>
            </div>
          </div>
        ) : viewMode === 'write' ? (
          <div className="flex-1 overflow-y-auto px-6 sm:px-10 py-8">
            <div className="max-w-[780px] mx-auto flex flex-col min-h-full">
              <input
                ref={titleInputRef}
                data-note-field="title"
                type="text"
                readOnly={isReadOnly}
                value={note.title}
                onFocus={(e) => syncTitleSelection(e.currentTarget)}
                onSelect={(e) => syncTitleSelection(e.currentTarget)}
                onKeyDown={(e) => syncTitleSelection(e.currentTarget)}
                onMouseUp={(e) => syncTitleSelection(e.currentTarget)}
                onPaste={(e) => syncTitleSelection(e.currentTarget)}
                onCut={(e) => syncTitleSelection(e.currentTarget)}
                onChange={(e) => {
                  if (isReadOnly) return;
                  const nextStart = e.target.selectionStart ?? e.target.value.length;
                  const nextEnd = e.target.selectionEnd ?? nextStart;
                  const prevSel = lastTitleSelectionRef.current;
                  lastTitleSelectionRef.current = { start: nextStart, end: nextEnd };
                  onUpdateNote(
                    note.id,
                    { title: e.target.value },
                    {
                      source: 'typing',
                      field: 'title',
                      prevSelection: { target: 'title', ...prevSel },
                      nextSelection: { target: 'title', start: nextStart, end: nextEnd },
                    }
                  );
                }}
                placeholder="Document title..."
                aria-label="Document title"
                className="editor-prose-font w-full bg-transparent text-[30px] font-bold leading-[1.5] py-1 text-neutral-950 dark:text-white placeholder:text-neutral-400 focus:outline-none mb-2"
              />
              <div className="flex items-center gap-2 text-[12.5px] text-neutral-500 dark:text-neutral-400 mb-6 tabular-nums">
                <span>
                  {isSharedWithMe
                    ? `Shared by ${note.ownerName || note.ownerEmail}`
                    : folderName}
                </span>
                <span aria-hidden="true">·</span>
                <span>Updated {formatRelativeDate(note.updatedAt)}</span>
                {stats && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span>{stats.words} words</span>
                    <span aria-hidden="true">·</span>
                    <span>{stats.lines} lines</span>
                  </>
                )}
              </div>
              <textarea
                ref={textareaRef}
                data-note-field="content"
                readOnly={isReadOnly}
                value={note.content}
                onFocus={(e) => syncTextareaSelection(e.currentTarget)}
                onMouseUp={(e) => syncTextareaSelection(e.currentTarget)}
                onKeyUp={(e) => syncTextareaSelection(e.currentTarget)}
                onCut={(e) => syncTextareaSelection(e.currentTarget)}
                onChange={(e) => {
                  if (isReadOnly) return;
                  const nextStart = e.target.selectionStart ?? e.target.value.length;
                  const nextEnd = e.target.selectionEnd ?? nextStart;
                  const prevSel = lastTextareaSelectionRef.current;
                  lastTextareaSelectionRef.current = { start: nextStart, end: nextEnd };
                  setHasSelection(nextEnd > nextStart);
                  onUpdateNote(
                    note.id,
                    { content: e.target.value },
                    {
                      source: 'typing',
                      field: 'content',
                      prevSelection: { target: 'content', ...prevSel },
                      nextSelection: { target: 'content', start: nextStart, end: nextEnd },
                    }
                  );
                }}
                onKeyDown={(e) => {
                  if (!isReadOnly) handleEditorKeyDown(e);
                }}
                onPaste={async (e) => {
                  if (isReadOnly) return;
                  syncTextareaSelection(e.currentTarget);
                  await handleEditorPaste(e);
                }}
                onDragOver={(e) => {
                  if (!isReadOnly && e.dataTransfer.types.includes('Files')) {
                    e.preventDefault();
                    setIsDraggingOver(true);
                  }
                }}
                onDragLeave={(e) => {
                  if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                    setIsDraggingOver(false);
                  }
                }}
                onDrop={async (e) => {
                  if (!isReadOnly && e.dataTransfer.files?.length) {
                    e.preventDefault();
                    setIsDraggingOver(false);
                    await handleDroppedFiles(e.dataTransfer.files);
                  }
                }}
                onSelect={(e) => syncTextareaSelection(e.currentTarget)}
                placeholder="Write technical notes in Markdown, paste screenshots, or insert organized snippets..."
                aria-label="Markdown document editor"
                className={`editor-source-font flex-1 w-full min-h-[540px] bg-transparent text-[14.5px] leading-[1.8] text-neutral-800 dark:text-neutral-200 placeholder:text-neutral-400 focus:outline-none resize-none rounded-lg transition-colors ${
                  isDraggingOver ? 'ring-2 ring-blue-500/60 bg-blue-500/5' : ''
                }`}
              />
            </div>
          </div>
        ) : (
          /* Document Mode — Direct in-place editable rich document (or read-only for view-only shares) */
          <div
            className={`flex-1 overflow-y-auto px-6 sm:px-10 py-8 sm:py-10 transition-colors ${
              isDraggingOver ? 'bg-blue-500/[0.04]' : ''
            }`}
            onDragOver={(e) => {
              if (!isReadOnly && e.dataTransfer.types.includes('Files')) {
                e.preventDefault();
                setIsDraggingOver(true);
              }
            }}
            onDragLeave={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                setIsDraggingOver(false);
              }
            }}
            onDrop={async (e) => {
              if (!isReadOnly && e.dataTransfer.files?.length) {
                e.preventDefault();
                setIsDraggingOver(false);
                await handleDroppedFiles(e.dataTransfer.files);
              }
            }}
          >
            <article className="max-w-[760px] mx-auto pb-16">
              <div className="mb-7">
                {isReadOnly ? (
                  <h1 className="editor-prose-font text-[30px] sm:text-[32px] font-bold text-neutral-950 dark:text-white leading-[1.48] py-1">
                    {note.title || 'Untitled Note'}
                  </h1>
                ) : (
                  <input
                    ref={titleInputRef}
                    data-note-field="title"
                    type="text"
                    value={note.title}
                    onFocus={(e) => syncTitleSelection(e.currentTarget)}
                    onSelect={(e) => syncTitleSelection(e.currentTarget)}
                    onKeyDown={(e) => syncTitleSelection(e.currentTarget)}
                    onMouseUp={(e) => syncTitleSelection(e.currentTarget)}
                    onPaste={(e) => syncTitleSelection(e.currentTarget)}
                    onCut={(e) => syncTitleSelection(e.currentTarget)}
                    onChange={(e) => {
                      const nextStart = e.target.selectionStart ?? e.target.value.length;
                      const nextEnd = e.target.selectionEnd ?? nextStart;
                      const prevSel = lastTitleSelectionRef.current;
                      lastTitleSelectionRef.current = { start: nextStart, end: nextEnd };
                      onUpdateNote(
                        note.id,
                        { title: e.target.value },
                        {
                          source: 'typing',
                          field: 'title',
                          prevSelection: { target: 'title', ...prevSel },
                          nextSelection: { target: 'title', start: nextStart, end: nextEnd },
                        }
                      );
                    }}
                    placeholder="Untitled Note"
                    aria-label="Document title"
                    className="editor-prose-font w-full bg-transparent text-[30px] sm:text-[32px] font-bold text-neutral-950 dark:text-white placeholder:text-neutral-400 focus:outline-none leading-[1.48] py-1"
                  />
                )}

                <div className="mt-2.5 flex flex-wrap items-center gap-2 text-[12.5px] text-neutral-500 dark:text-neutral-400 tabular-nums">
                  <span>
                    {isSharedWithMe
                      ? `Shared by ${note.ownerName || note.ownerEmail}`
                      : folderName}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span>Updated {formatRelativeDate(note.updatedAt)}</span>
                  {stats && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span>{stats.words} words</span>
                      <span aria-hidden="true">·</span>
                      <span>{stats.readMinutes} min read</span>
                    </>
                  )}
                </div>
              </div>

              {isReadOnly ? (
                <MarkdownRenderer content={note.content || '*This note has no content yet.*'} />
              ) : (
                <LiveDocumentEditor
                  ref={liveEditorRef}
                  noteId={note.id}
                  content={note.content}
                  onChangeContent={(nextMarkdown, meta) =>
                    onUpdateNote(note.id, { content: nextMarkdown }, meta)
                  }
                  onPasteImageFiles={handleImageFiles}
                  onSelectionStateChange={setHasSelection}
                  onEditDiagram={(blockId, currentCode) =>
                    setDiagramModalState({
                      open: true,
                      mode: 'edit',
                      blockId,
                      initialCode: currentCode,
                    })
                  }
                />
              )}
            </article>
          </div>
        )}

        {/* Right Collapsible Document Outline Rail */}
        {outlineOpen && (
          <aside
            className="hidden xl:flex w-[240px] shrink-0 flex-col border-l border-neutral-200 dark:border-white/[0.07] bg-neutral-50/40 dark:bg-[#101012] p-4 overflow-y-auto"
            aria-label="Document outline"
          >
            <div className="text-[12px] font-semibold text-neutral-500 dark:text-neutral-400 mb-3">
              On this document
            </div>

            {headings.length === 0 ? (
              <p className="text-[12.5px] text-neutral-400 dark:text-neutral-500 leading-relaxed">
                Add Markdown headings (<code className="font-mono-code">## Section</code>) to build an automatic outline.
              </p>
            ) : (
              <nav className="space-y-1">
                {headings.map((h) => (
                  <button
                    key={h.id}
                    type="button"
                    onClick={() => scrollToHeading(h.id)}
                    style={{ paddingLeft: `${(h.level - 1) * 10 + 8}px` }}
                    className="editor-prose-font w-full text-left py-1.5 pr-2 rounded-md text-[12.5px] leading-[1.55] text-neutral-600 dark:text-neutral-400 hover:text-neutral-950 dark:hover:text-white hover:bg-neutral-200/60 dark:hover:bg-white/[0.05] transition-colors truncate cursor-pointer"
                    title={h.text}
                  >
                    {h.text}
                  </button>
                ))}
              </nav>
            )}

            {stats && (
              <div className="mt-auto pt-5 border-t border-neutral-200 dark:border-white/[0.07] space-y-2 text-[12px] text-neutral-500 dark:text-neutral-400 tabular-nums">
                <div className="flex items-center justify-between">
                  <span>Words</span>
                  <span className="font-mono-code text-neutral-700 dark:text-neutral-300">
                    {stats.words}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Lines</span>
                  <span className="font-mono-code text-neutral-700 dark:text-neutral-300">
                    {stats.lines}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Code snippets</span>
                  <span className="font-mono-code text-neutral-700 dark:text-neutral-300">
                    {stats.codeBlocks}
                  </span>
                </div>
              </div>
            )}
          </aside>
        )}
      </div>

      <ImageInsertModal
        isOpen={imageModalOpen}
        onClose={() => setImageModalOpen(false)}
        onInsert={handleInsertImageMarkdown}
      />

      <DiagramBuilderModal
        isOpen={diagramModalState.open}
        mode={diagramModalState.mode}
        initialCode={diagramModalState.initialCode}
        onClose={() => setDiagramModalState({ open: false, mode: 'insert' })}
        onSave={(mermaidCode) => {
          if (diagramModalState.mode === 'edit' && diagramModalState.blockId) {
            liveEditorRef.current?.updateCodeBlock(diagramModalState.blockId, mermaidCode);
          } else {
            handleInsertImageMarkdown(`\`\`\`mermaid\n${mermaidCode.trimEnd()}\n\`\`\``);
          }
        }}
      />
    </div>
  );
}

function ToolbarButton({
  label,
  icon,
  onClick,
  disabled = false,
}: {
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className={`p-1.5 rounded-md transition-colors ${
        disabled
          ? 'text-neutral-300 dark:text-neutral-600 cursor-not-allowed'
          : 'text-neutral-600 hover:text-neutral-950 dark:text-neutral-400 dark:hover:text-white hover:bg-neutral-200/70 dark:hover:bg-white/[0.07] cursor-pointer'
      }`}
    >
      {icon}
    </button>
  );
}
