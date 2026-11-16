import { INITIAL_FOLDERS, INITIAL_NOTES, INITIAL_SNIPPETS } from '../data/seedData';
import { AuthUser } from '../types/notes';

export type StorageBackendMode = 'postgres' | 'local';

interface LocalUserRecord extends AuthUser {
  salt: string;
  passwordHash: string;
}

const LOCAL_USERS_KEY = 'notecraft.auth.users.v1';
const LOCAL_SESSION_KEY = 'notecraft.auth.session.v1';

const LEGACY_KEYS = {
  folders: 'notecraft.folders.v1',
  notes: 'notecraft.notes.v1',
  snippets: 'notecraft.snippets.v1',
  activeNoteId: 'notecraft.activeNoteId.v1',
};

export function getUserStorageKeys(userId: string) {
  const safeId = userId.replace(/[^a-zA-Z0-9_-]/g, '');
  return {
    folders: `notecraft.u.${safeId}.folders.v1`,
    notes: `notecraft.u.${safeId}.notes.v1`,
    snippets: `notecraft.u.${safeId}.snippets.v1`,
    activeNoteId: `notecraft.u.${safeId}.activeNoteId.v1`,
  };
}

function generateSalt(): string {
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  }
  return `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`;
}

async function hashLocalPassword(password: string, salt: string): Promise<string> {
  const input = `${salt}:${password}`;
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const encoded = new TextEncoder().encode(input);
    const digest = await crypto.subtle.digest('SHA-256', encoded);
    return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
  }
  // Fallback deterministic mixing when subtle crypto is unavailable on insecure origins
  let h1 = 0xdeadbeef ^ input.length;
  let h2 = 0x41c6ce57 ^ input.length;
  for (let i = 0; i < input.length; i += 1) {
    const ch = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  return (
    (h1 >>> 0).toString(16).padStart(8, '0') +
    (h2 >>> 0).toString(16).padStart(8, '0')
  );
}

function readLocalUsers(): LocalUserRecord[] {
  try {
    const raw = localStorage.getItem(LOCAL_USERS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as LocalUserRecord[]) : [];
  } catch {
    return [];
  }
}

function writeLocalUsers(users: LocalUserRecord[]) {
  try {
    localStorage.setItem(LOCAL_USERS_KEY, JSON.stringify(users));
  } catch {
    // Ignore quota errors
  }
}

function toPublicUser(record: LocalUserRecord): AuthUser {
  return {
    id: record.id,
    name: record.name,
    email: record.email,
    createdAt: record.createdAt,
  };
}

export function listLocalUsersPublic(): AuthUser[] {
  return readLocalUsers().map(toPublicUser);
}

function seedLocalUserWorkspace(userId: string, isFirstUser: boolean) {
  const keys = getUserStorageKeys(userId);
  try {
    if (localStorage.getItem(keys.notes)) return;

    if (isFirstUser) {
      const legacyNotes = localStorage.getItem(LEGACY_KEYS.notes);
      const legacyFolders = localStorage.getItem(LEGACY_KEYS.folders);
      const legacySnippets = localStorage.getItem(LEGACY_KEYS.snippets);
      const legacyActive = localStorage.getItem(LEGACY_KEYS.activeNoteId);

      if (legacyNotes || legacyFolders || legacySnippets) {
        if (legacyFolders) localStorage.setItem(keys.folders, legacyFolders);
        if (legacyNotes) localStorage.setItem(keys.notes, legacyNotes);
        if (legacySnippets) localStorage.setItem(keys.snippets, legacySnippets);
        if (legacyActive) localStorage.setItem(keys.activeNoteId, legacyActive);
        return;
      }
    }

    localStorage.setItem(keys.folders, JSON.stringify(INITIAL_FOLDERS));
    localStorage.setItem(keys.notes, JSON.stringify(INITIAL_NOTES));
    localStorage.setItem(keys.snippets, JSON.stringify(INITIAL_SNIPPETS));
    localStorage.setItem(
      keys.activeNoteId,
      JSON.stringify(INITIAL_NOTES[0]?.id ?? null)
    );
  } catch {
    // Ignore storage errors
  }
}

export async function fetchAuthSession(): Promise<{
  storage: StorageBackendMode;
  user: AuthUser | null;
}> {
  try {
    const res = await fetch('/api/auth/session', { credentials: 'same-origin' });
    if (res.ok) {
      const data = (await res.json()) as {
        storage?: StorageBackendMode;
        user?: AuthUser | null;
      };
      if (data.storage === 'postgres') {
        return { storage: 'postgres', user: data.user ?? null };
      }
    }
  } catch {
    // Fall back to local mode when API is unreachable
  }

  try {
    const sessionUserId = localStorage.getItem(LOCAL_SESSION_KEY);
    if (!sessionUserId) return { storage: 'local', user: null };
    const users = readLocalUsers();
    const matched = users.find((u) => u.id === sessionUserId);
    return {
      storage: 'local',
      user: matched ? toPublicUser(matched) : null,
    };
  } catch {
    return { storage: 'local', user: null };
  }
}

export async function registerAccount(
  storage: StorageBackendMode,
  input: { name: string; email: string; password: string }
): Promise<AuthUser> {
  const name = input.name.trim();
  const email = input.email.trim().toLowerCase();
  const password = input.password;

  if (name.length < 2) {
    throw new Error('Please enter your name (at least 2 characters).');
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('Please enter a valid email address.');
  }
  if (password.length < 6) {
    throw new Error('Password must be at least 6 characters.');
  }

  if (storage === 'postgres') {
    const res = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ name, email, password }),
    });
    const data = (await res.json().catch(() => ({}))) as { user?: AuthUser; error?: string };
    if (!res.ok || !data.user) {
      throw new Error(data.error || 'Could not create account.');
    }
    return data.user;
  }

  const users = readLocalUsers();
  if (users.some((u) => u.email === email)) {
    throw new Error('An account with this email already exists.');
  }

  const now = Date.now();
  const salt = generateSalt();
  const passwordHash = await hashLocalPassword(password, salt);
  const created: LocalUserRecord = {
    id: `usr-${now.toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    name,
    email,
    createdAt: now,
    salt,
    passwordHash,
  };

  const isFirstUser = users.length === 0;
  writeLocalUsers([...users, created]);
  seedLocalUserWorkspace(created.id, isFirstUser);
  localStorage.setItem(LOCAL_SESSION_KEY, created.id);
  return toPublicUser(created);
}

export async function loginAccount(
  storage: StorageBackendMode,
  input: { email: string; password: string }
): Promise<AuthUser> {
  const email = input.email.trim().toLowerCase();
  const password = input.password;

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !password) {
    throw new Error('Please enter your email and password.');
  }

  if (storage === 'postgres') {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ email, password }),
    });
    const data = (await res.json().catch(() => ({}))) as { user?: AuthUser; error?: string };
    if (!res.ok || !data.user) {
      throw new Error(data.error || 'Invalid email or password.');
    }
    return data.user;
  }

  const users = readLocalUsers();
  const found = users.find((u) => u.email === email);
  if (!found) {
    throw new Error('Invalid email or password.');
  }
  const actualHash = await hashLocalPassword(password, found.salt);
  if (actualHash !== found.passwordHash) {
    throw new Error('Invalid email or password.');
  }

  localStorage.setItem(LOCAL_SESSION_KEY, found.id);
  return toPublicUser(found);
}

export async function logoutAccount(storage: StorageBackendMode): Promise<void> {
  if (storage === 'postgres') {
    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'same-origin',
      });
    } catch {
      // Ignore network error on logout
    }
    return;
  }

  try {
    localStorage.removeItem(LOCAL_SESSION_KEY);
  } catch {
    // Ignore
  }
}
