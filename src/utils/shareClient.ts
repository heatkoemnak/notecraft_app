import {
  AuthUser,
  LinkAccess,
  NoteDocument,
  NoteShareEntry,
  SharedLinkNote,
  SharePermission,
} from '../types/notes';
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
const LOCAL_PUBLIC_LINKS_KEY = 'notecraft.publicLinks.v1';

interface LocalPublicLinkRecord {
  token: string;
  noteId: string;
  ownerUserId: string;
  ownerName: string;
  ownerEmail: string;
  linkAccess: LinkAccess;
  updatedAt: number;
}

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

function readLocalPublicLinks(): LocalPublicLinkRecord[] {
  try {
    const raw = localStorage.getItem(LOCAL_PUBLIC_LINKS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as LocalPublicLinkRecord[]) : [];
  } catch {
    return [];
  }
}

function writeLocalPublicLinks(links: LocalPublicLinkRecord[]) {
  try {
    localStorage.setItem(LOCAL_PUBLIC_LINKS_KEY, JSON.stringify(links));
  } catch {
    // Ignore storage quota errors
  }
}

function generateLocalShareToken(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const bytes = new Uint8Array(12);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  }
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
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

  const publicLinkByNoteId = new Map<string, LocalPublicLinkRecord>();
  for (const link of readLocalPublicLinks()) {
    if (link.ownerUserId === currentUser.id) {
      publicLinkByNoteId.set(link.noteId, link);
    }
  }

  const notesWithShares = ownNotes.map((note) => {
    const linkRecord = publicLinkByNoteId.get(note.id);
    return {
      ...note,
      shareToken: note.shareToken ?? linkRecord?.token ?? null,
      linkAccess: note.linkAccess ?? linkRecord?.linkAccess ?? 'off',
      shares: ownerSharesByNote.get(note.id) ?? [],
    };
  });

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

  const nextLinks = readLocalPublicLinks().filter(
    (l) => !(l.noteId === noteId && l.ownerUserId === ownerUserId)
  );
  writeLocalPublicLinks(nextLinks);
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

export function buildShareUrl(token: string): string {
  if (typeof window === 'undefined') return `/?share=${encodeURIComponent(token)}`;
  return `${window.location.origin}/?share=${encodeURIComponent(token)}`;
}

export async function copyTextToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fallback to textarea selection below (e.g., restricted iframe contexts)
  }

  try {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.top = '-9999px';
    textarea.style.left = '-9999px';
    document.body.appendChild(textarea);
    textarea.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(textarea);
    return ok;
  } catch {
    return false;
  }
}

export async function updateNoteShareLink(
  storage: StorageBackendMode,
  currentUser: AuthUser,
  note: NoteDocument,
  linkAccess: LinkAccess,
  regenerate = false
): Promise<{ shareToken: string; linkAccess: LinkAccess }> {
  if (storage === 'postgres') {
    const res = await fetch(`/api/notes/${encodeURIComponent(note.id)}/share-link`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ linkAccess, regenerate }),
    });
    const data = (await res.json().catch(() => ({}))) as {
      shareToken?: string;
      linkAccess?: LinkAccess;
      error?: string;
    };
    if (!res.ok || !data.shareToken || !data.linkAccess) {
      throw new Error(data.error || 'Could not update share link.');
    }
    return { shareToken: data.shareToken, linkAccess: data.linkAccess };
  }

  const links = readLocalPublicLinks();
  const existingIdx = links.findIndex(
    (l) => l.noteId === note.id && l.ownerUserId === currentUser.id
  );
  const existingToken = existingIdx >= 0 ? links[existingIdx].token : note.shareToken;
  const nextToken = !existingToken || regenerate ? generateLocalShareToken() : existingToken;
  const now = Date.now();

  const record: LocalPublicLinkRecord = {
    token: nextToken,
    noteId: note.id,
    ownerUserId: currentUser.id,
    ownerName: currentUser.name,
    ownerEmail: currentUser.email,
    linkAccess,
    updatedAt: now,
  };

  if (existingIdx >= 0) {
    links[existingIdx] = record;
  } else {
    links.unshift(record);
  }
  writeLocalPublicLinks(links);

  const ownerNotes = readLocalNotesForUser(currentUser.id);
  const updatedOwnerNotes = ownerNotes.map((n) =>
    n.id === note.id ? { ...n, shareToken: nextToken, linkAccess } : n
  );
  writeLocalNotesForUser(currentUser.id, updatedOwnerNotes);

  return { shareToken: nextToken, linkAccess };
}

export async function fetchNoteByShareToken(
  storage: StorageBackendMode,
  token: string
): Promise<SharedLinkNote> {
  const cleanToken = token.trim();
  if (!cleanToken) {
    throw new Error('Invalid share link.');
  }

  if (storage === 'postgres') {
    const res = await fetch(`/api/shared-link/${encodeURIComponent(cleanToken)}`, {
      credentials: 'same-origin',
    });
    const data = (await res.json().catch(() => ({}))) as {
      note?: SharedLinkNote;
      error?: string;
    };
    if (!res.ok || !data.note) {
      throw new Error(
        data.error || 'This share link is invalid or has been disabled by the owner.'
      );
    }
    return data.note;
  }

  const link = readLocalPublicLinks().find((l) => l.token === cleanToken);
  if (!link || link.linkAccess === 'off') {
    throw new Error('This share link is invalid or has been disabled by the owner.');
  }

  const ownerNotes = readLocalNotesForUser(link.ownerUserId);
  const target = ownerNotes.find((n) => n.id === link.noteId);
  if (!target) {
    throw new Error('The shared document could not be found.');
  }

  const ownerUser = listLocalUsersPublic().find((u) => u.id === link.ownerUserId);
  return {
    id: target.id,
    title: target.title,
    content: target.content,
    createdAt: target.createdAt,
    updatedAt: target.updatedAt,
    shareToken: cleanToken,
    linkAccess: link.linkAccess === 'edit' ? 'edit' : 'view',
    ownerName: ownerUser?.name || link.ownerName,
    ownerEmail: ownerUser?.email || link.ownerEmail,
  };
}

export async function updateNoteByShareToken(
  storage: StorageBackendMode,
  token: string,
  patch: Partial<Pick<NoteDocument, 'title' | 'content'>>,
  updatedAt: number
): Promise<void> {
  const cleanToken = token.trim();
  if (!cleanToken) throw new Error('Invalid share link.');

  if (storage === 'postgres') {
    const res = await fetch(`/api/shared-link/${encodeURIComponent(cleanToken)}`, {
      method: 'PATCH',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...patch, updatedAt }),
    });
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(data.error || 'Could not save changes.');
    }
    return;
  }

  const link = readLocalPublicLinks().find((l) => l.token === cleanToken);
  if (!link || link.linkAccess !== 'edit') {
    throw new Error('This link only allows viewing.');
  }

  const ownerNotes = readLocalNotesForUser(link.ownerUserId);
  const idx = ownerNotes.findIndex((n) => n.id === link.noteId);
  if (idx < 0) {
    throw new Error('The shared document could not be found.');
  }

  ownerNotes[idx] = {
    ...ownerNotes[idx],
    ...patch,
    updatedAt,
  };
  writeLocalNotesForUser(link.ownerUserId, ownerNotes);
}
