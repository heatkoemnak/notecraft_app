import { AuthUser, NoteDocument, NoteShareEntry, SharePermission } from '../types/notes';
import { getUserStorageKeys, listLocalUsersPublic, StorageBackendMode } from './authClient';

interface LocalShareRecord {
  id: string;
  noteId: string;
  ownerUserId: string;
  ownerName: string;
  ownerEmail: string;
  recipientEmail: string;
  permission: SharePermission;
  createdAt: number;
}

const LOCAL_SHARES_KEY = 'notecraft.shares.v1';

function readLocalShares(): LocalShareRecord[] {
  try {
    const raw = localStorage.getItem(LOCAL_SHARES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as LocalShareRecord[]) : [];
  } catch {
    return [];
  }
}

function writeLocalShares(shares: LocalShareRecord[]) {
  try {
    localStorage.setItem(LOCAL_SHARES_KEY, JSON.stringify(shares));
  } catch {
    // Ignore storage quota errors
  }
}

function readLocalNotesForUser(userId: string): NoteDocument[] {
  try {
    const keys = getUserStorageKeys(userId);
    const raw = localStorage.getItem(keys.notes);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as NoteDocument[]) : [];
  } catch {
    return [];
  }
}

function writeLocalNotesForUser(userId: string, notes: NoteDocument[]) {
  try {
    const keys = getUserStorageKeys(userId);
    localStorage.setItem(keys.notes, JSON.stringify(notes));
  } catch {
    // Ignore storage quota errors
  }
}

export function hydrateLocalSharing(
  currentUser: AuthUser,
  ownNotes: NoteDocument[]
): { notesWithShares: NoteDocument[]; sharedNotes: NoteDocument[] } {
  const allShares = readLocalShares();
  const users = listLocalUsersPublic();
  const userByEmail = new Map(users.map((u) => [u.email.toLowerCase(), u]));
  const userById = new Map(users.map((u) => [u.id, u]));

  const ownerSharesByNote = new Map<string, NoteShareEntry[]>();
  for (const s of allShares) {
    if (s.ownerUserId !== currentUser.id) continue;
    const recipient = userByEmail.get(s.recipientEmail.toLowerCase());
    const list = ownerSharesByNote.get(s.noteId) ?? [];
    list.push({
      id: s.id,
      noteId: s.noteId,
      recipientEmail: s.recipientEmail,
      recipientName: recipient?.name ?? null,
      recipientUserId: recipient?.id ?? null,
      permission: s.permission === 'edit' ? 'edit' : 'view',
      createdAt: s.createdAt,
    });
    ownerSharesByNote.set(s.noteId, list);
  }

  const notesWithShares = ownNotes.map((note) => ({
    ...note,
    shares: ownerSharesByNote.get(note.id) ?? [],
  }));

  const normalizedEmail = currentUser.email.toLowerCase();
  const incomingShares = allShares.filter(
    (s) => s.recipientEmail.toLowerCase() === normalizedEmail && s.ownerUserId !== currentUser.id
  );

  const notesByOwner = new Map<string, NoteDocument[]>();
  const sharedNotes: NoteDocument[] = [];

  for (const share of incomingShares) {
    let ownerNotes = notesByOwner.get(share.ownerUserId);
    if (!ownerNotes) {
      ownerNotes = readLocalNotesForUser(share.ownerUserId);
      notesByOwner.set(share.ownerUserId, ownerNotes);
    }
    const target = ownerNotes.find((n) => n.id === share.noteId);
    if (!target) continue;
    const ownerUser = userById.get(share.ownerUserId);
    sharedNotes.push({
      ...target,
      folderId: null,
      starred: false,
      isSharedWithMe: true,
      ownerName: ownerUser?.name || share.ownerName,
      ownerEmail: ownerUser?.email || share.ownerEmail,
      sharedPermission: share.permission === 'edit' ? 'edit' : 'view',
    });
  }

  sharedNotes.sort((a, b) => b.updatedAt - a.updatedAt);
  return { notesWithShares, sharedNotes };
}

export async function refreshSharedNotes(
  storage: StorageBackendMode,
  currentUser: AuthUser
): Promise<NoteDocument[]> {
  if (storage === 'postgres') {
    const res = await fetch('/api/shared-notes', { credentials: 'same-origin' });
    if (!res.ok) return [];
    const data = (await res.json()) as { sharedNotes?: NoteDocument[] };
    return Array.isArray(data.sharedNotes) ? data.sharedNotes : [];
  }

  return hydrateLocalSharing(currentUser, []).sharedNotes;
}

export async function shareNoteWithEmail(
  storage: StorageBackendMode,
  currentUser: AuthUser,
  noteId: string,
  recipientEmailInput: string,
  permission: SharePermission
): Promise<NoteShareEntry> {
  const email = recipientEmailInput.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('Please enter a valid recipient email address.');
  }
  if (email === currentUser.email.toLowerCase()) {
    throw new Error('You already own this note.');
  }

  if (storage === 'postgres') {
    const res = await fetch(`/api/notes/${encodeURIComponent(noteId)}/shares`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, permission }),
    });
    const data = (await res.json().catch(() => ({}))) as {
      share?: NoteShareEntry;
      error?: string;
    };
    if (!res.ok || !data.share) {
      throw new Error(data.error || 'Could not share note.');
    }
    return data.share;
  }

  const allShares = readLocalShares();
  const existingIdx = allShares.findIndex(
    (s) => s.noteId === noteId && s.ownerUserId === currentUser.id && s.recipientEmail === email
  );
  const now = Date.now();
  let savedRecord: LocalShareRecord;

  if (existingIdx >= 0) {
    savedRecord = { ...allShares[existingIdx], permission };
    allShares[existingIdx] = savedRecord;
  } else {
    savedRecord = {
      id: `shr-${now.toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
      noteId,
      ownerUserId: currentUser.id,
      ownerName: currentUser.name,
      ownerEmail: currentUser.email,
      recipientEmail: email,
      permission,
      createdAt: now,
    };
    allShares.unshift(savedRecord);
  }
  writeLocalShares(allShares);

  const recipient = listLocalUsersPublic().find((u) => u.email.toLowerCase() === email);
  return {
    id: savedRecord.id,
    noteId,
    recipientEmail: email,
    recipientName: recipient?.name ?? null,
    recipientUserId: recipient?.id ?? null,
    permission,
    createdAt: savedRecord.createdAt,
  };
}

export async function removeNoteShare(
  storage: StorageBackendMode,
  currentUser: AuthUser,
  noteId: string,
  shareId: string
): Promise<void> {
  if (storage === 'postgres') {
    const res = await fetch(
      `/api/notes/${encodeURIComponent(noteId)}/shares/${encodeURIComponent(shareId)}`,
      {
        method: 'DELETE',
        credentials: 'same-origin',
      }
    );
    if (!res.ok) {
      throw new Error('Failed to remove access.');
    }
    return;
  }

  const next = readLocalShares().filter(
    (s) => !(s.id === shareId && s.noteId === noteId && s.ownerUserId === currentUser.id)
  );
  writeLocalShares(next);
}

export function deleteSharesForNoteLocal(noteId: string, ownerUserId: string) {
  const next = readLocalShares().filter(
    (s) => !(s.noteId === noteId && s.ownerUserId === ownerUserId)
  );
  writeLocalShares(next);
}

export function updateSharedNoteLocal(
  ownerEmail: string,
  noteId: string,
  patch: Partial<Pick<NoteDocument, 'title' | 'content'>>,
  updatedAt: number
) {
  const owner = listLocalUsersPublic().find(
    (u) => u.email.toLowerCase() === ownerEmail.toLowerCase()
  );
  if (!owner) return;

  const ownerNotes = readLocalNotesForUser(owner.id);
  const idx = ownerNotes.findIndex((n) => n.id === noteId);
  if (idx < 0) return;

  ownerNotes[idx] = {
    ...ownerNotes[idx],
    ...patch,
    updatedAt,
  };
  writeLocalNotesForUser(owner.id, ownerNotes);
}
