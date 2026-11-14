import { useCallback, useRef, useState } from 'react';
import { NoteDocument } from '../types/notes';

export type NoteHistorySource = 'typing' | 'discrete';
export type NoteEditField = 'title' | 'content' | 'folderId' | 'starred';

export interface NoteSelection {
  target: 'title' | 'content';
  start: number;
  end: number;
}

export interface NoteSnapshot {
  title: string;
  content: string;
  folderId: string | null;
  starred: boolean;
  selection: NoteSelection | null;
}

export interface NoteUpdateMeta {
  source?: NoteHistorySource;
  field?: NoteEditField;
  prevSelection?: NoteSelection | null;
  nextSelection?: NoteSelection | null;
}

interface NoteHistoryEntry {
  past: NoteSnapshot[];
  future: NoteSnapshot[];
}

interface TypingBurst {
  noteId: string;
  field: 'title' | 'content';
  timestamp: number;
  lastEnd: number | null;
}

const MAX_HISTORY_PER_NOTE = 100;
const TYPING_BURST_MS = 650;

function countNewlines(text: string): number {
  let count = 0;
  for (let i = 0; i < text.length; i += 1) {
    if (text.charCodeAt(i) === 10) count += 1;
  }
  return count;
}

function toSnapshot(
  note: Pick<NoteDocument, 'title' | 'content' | 'folderId' | 'starred'>,
  selection: NoteSelection | null = null
): NoteSnapshot {
  return {
    title: note.title,
    content: note.content,
    folderId: note.folderId,
    starred: note.starred,
    selection,
  };
}

export function useNoteHistory(activeNoteId: string | null) {
  const historyMapRef = useRef<Map<string, NoteHistoryEntry>>(new Map());
  const burstRef = useRef<TypingBurst | null>(null);
  const [, setVersion] = useState(0);

  const getEntry = (noteId: string): NoteHistoryEntry => {
    let entry = historyMapRef.current.get(noteId);
    if (!entry) {
      entry = { past: [], future: [] };
      historyMapRef.current.set(noteId, entry);
    }
    return entry;
  };

  const recordChange = useCallback(
    (prevNote: NoteDocument, nextNote: NoteDocument, meta?: NoteUpdateMeta) => {
      const changed =
        prevNote.title !== nextNote.title ||
        prevNote.content !== nextNote.content ||
        prevNote.folderId !== nextNote.folderId ||
        prevNote.starred !== nextNote.starred;

      if (!changed) return;

      const entry = getEntry(prevNote.id);
      const now = Date.now();
      const source = meta?.source ?? 'discrete';
      const field = meta?.field;
      const isTextTyping =
        source === 'typing' && (field === 'title' || field === 'content');

      let shouldCoalesce = false;
      if (isTextTyping && burstRef.current) {
        const burst = burstRef.current;
        const withinWindow = now - burst.timestamp < TYPING_BURST_MS;
        const sameTarget = burst.noteId === prevNote.id && burst.field === field;

        const prevText = field === 'title' ? prevNote.title : prevNote.content;
        const nextText = field === 'title' ? nextNote.title : nextNote.content;
        const isSingleStepEdit = Math.abs(nextText.length - prevText.length) <= 1;
        const newlineCrossed =
          field === 'content' && countNewlines(prevText) !== countNewlines(nextText);
        const cursorContinuous =
          burst.lastEnd === null ||
          !meta?.prevSelection ||
          (meta.prevSelection.start === burst.lastEnd &&
            meta.prevSelection.end === burst.lastEnd);

        if (
          withinWindow &&
          sameTarget &&
          isSingleStepEdit &&
          !newlineCrossed &&
          cursorContinuous
        ) {
          shouldCoalesce = true;
        }
      }

      if (!shouldCoalesce) {
        entry.past.push(toSnapshot(prevNote, meta?.prevSelection ?? null));
        if (entry.past.length > MAX_HISTORY_PER_NOTE) {
          entry.past.shift();
        }
      }

      if (isTextTyping && field) {
        burstRef.current = {
          noteId: prevNote.id,
          field,
          timestamp: now,
          lastEnd: meta?.nextSelection?.end ?? null,
        };
      } else {
        burstRef.current = null;
      }

      if (entry.future.length > 0) {
        entry.future = [];
      }

      setVersion((v) => v + 1);
    },
    []
  );

  const undo = useCallback(
    (
      currentNote: NoteDocument,
      currentSelection: NoteSelection | null = null
    ): NoteSnapshot | null => {
      const entry = historyMapRef.current.get(currentNote.id);
      if (!entry || entry.past.length === 0) return null;

      const previous = entry.past.pop()!;
      entry.future.push(toSnapshot(currentNote, currentSelection));
      if (entry.future.length > MAX_HISTORY_PER_NOTE) {
        entry.future.shift();
      }
      burstRef.current = null;
      setVersion((v) => v + 1);
      return previous;
    },
    []
  );

  const redo = useCallback(
    (
      currentNote: NoteDocument,
      currentSelection: NoteSelection | null = null
    ): NoteSnapshot | null => {
      const entry = historyMapRef.current.get(currentNote.id);
      if (!entry || entry.future.length === 0) return null;

      const next = entry.future.pop()!;
      entry.past.push(toSnapshot(currentNote, currentSelection));
      if (entry.past.length > MAX_HISTORY_PER_NOTE) {
        entry.past.shift();
      }
      burstRef.current = null;
      setVersion((v) => v + 1);
      return next;
    },
    []
  );

  const clearNoteHistory = useCallback((noteId: string) => {
    historyMapRef.current.delete(noteId);
    if (burstRef.current?.noteId === noteId) {
      burstRef.current = null;
    }
    setVersion((v) => v + 1);
  }, []);

  const activeEntry = activeNoteId ? historyMapRef.current.get(activeNoteId) : undefined;
  const canUndo = Boolean(activeEntry && activeEntry.past.length > 0);
  const canRedo = Boolean(activeEntry && activeEntry.future.length > 0);

  return {
    canUndo,
    canRedo,
    recordChange,
    undo,
    redo,
    clearNoteHistory,
  };
}
