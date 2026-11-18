import { SshAuthType, SshProfile } from '../types/notes';
import { StorageBackendMode } from './authClient';

function getLocalProfilesKey(userId: string): string {
  return `notecraft.sshProfiles.${userId}.v1`;
}

function readLocalProfiles(userId: string): SshProfile[] {
  try {
    const raw = localStorage.getItem(getLocalProfilesKey(userId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as SshProfile[]) : [];
  } catch {
    return [];
  }
}

function writeLocalProfiles(userId: string, profiles: SshProfile[]): void {
  try {
    localStorage.setItem(getLocalProfilesKey(userId), JSON.stringify(profiles));
  } catch {
    // ignore storage quota errors
  }
}

export interface ParsedSshCommand {
  username?: string;
  host?: string;
  port?: number;
  keyHint?: string;
}

/**
 * Parses common SSH command strings such as:
 * - ssh root@192.168.1.10
 * - ssh -p 2222 ubuntu@example.com
 * - ssh -i ~/.ssh/id_ed25519 admin@10.0.0.5 -p 2200
 * - ssh://ubuntu@example.com:2222
 */
export function parseSshCommand(raw: string): ParsedSshCommand | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  if (trimmed.startsWith('ssh://')) {
    try {
      const url = new URL(trimmed);
      return {
        username: url.username ? decodeURIComponent(url.username) : undefined,
        host: url.hostname || undefined,
        port: url.port ? Number(url.port) : 22,
      };
    } catch {
      return null;
    }
  }

  const tokens = trimmed.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return null;

  let idx = tokens[0].toLowerCase() === 'ssh' ? 1 : 0;
  let port: number | undefined;
  let keyHint: string | undefined;
  let targetToken: string | undefined;

  const flagsWithValues = new Set(['-p', '-i', '-l', '-o', '-J', '-F', '-b', '-c', '-D', '-L', '-R', '-W']);
  let explicitUser: string | undefined;

  while (idx < tokens.length) {
    const token = tokens[idx];
    if (token === '-p' && idx + 1 < tokens.length) {
      const parsedPort = Number(tokens[idx + 1]);
      if (Number.isFinite(parsedPort) && parsedPort >= 1 && parsedPort <= 65535) {
        port = Math.round(parsedPort);
      }
      idx += 2;
      continue;
    }
    if (token.startsWith('-p') && token.length > 2) {
      const parsedPort = Number(token.slice(2));
      if (Number.isFinite(parsedPort) && parsedPort >= 1 && parsedPort <= 65535) {
        port = Math.round(parsedPort);
      }
      idx += 1;
      continue;
    }
    if (token === '-l' && idx + 1 < tokens.length) {
      explicitUser = tokens[idx + 1];
      idx += 2;
      continue;
    }
    if (token === '-i' && idx + 1 < tokens.length) {
      keyHint = tokens[idx + 1];
      idx += 2;
      continue;
    }
    if (flagsWithValues.has(token) && idx + 1 < tokens.length) {
      idx += 2;
      continue;
    }
    if (token.startsWith('-')) {
      idx += 1;
      continue;
    }
    if (!targetToken) {
      targetToken = token;
    }
    idx += 1;
  }

  if (!targetToken) {
    return explicitUser || port || keyHint ? { username: explicitUser, port, keyHint } : null;
  }

  let username = explicitUser;
  let hostPart = targetToken;

  const atIndex = targetToken.lastIndexOf('@');
  if (atIndex > 0) {
    username = targetToken.slice(0, atIndex);
    hostPart = targetToken.slice(atIndex + 1);
  }

  // Handle host:port when host is not a raw IPv6 literal
  const colonCount = (hostPart.match(/:/g) || []).length;
  if (colonCount === 1) {
    const [h, p] = hostPart.split(':');
    const parsedPort = Number(p);
    if (h && Number.isFinite(parsedPort) && parsedPort >= 1 && parsedPort <= 65535) {
      hostPart = h;
      port = port ?? Math.round(parsedPort);
    }
  }

  return {
    username,
    host: hostPart || undefined,
    port,
    keyHint,
  };
}

export function formatSshCommand({
  username,
  host,
  port,
}: {
  username: string;
  host: string;
  port: number;
}): string {
  const cleanUser = username.trim() || 'root';
  const cleanHost = host.trim();
  if (!cleanHost) return '';
  const portFlag = port && port !== 22 ? ` -p ${port}` : '';
  return `ssh ${cleanUser}@${cleanHost}${portFlag}`;
}

export function buildSshWebSocketUrl(): string {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}/ws/ssh`;
}

export async function fetchSshProfiles(
  storageMode: StorageBackendMode,
  userId: string
): Promise<SshProfile[]> {
  if (storageMode === 'postgres') {
    const res = await fetch('/api/ssh/profiles', { credentials: 'same-origin' });
    if (!res.ok) return [];
    const data = (await res.json()) as { profiles?: SshProfile[] };
    return Array.isArray(data.profiles) ? data.profiles : [];
  }
  return readLocalProfiles(userId).sort(
    (a, b) => (b.lastConnectedAt || b.createdAt) - (a.lastConnectedAt || a.createdAt)
  );
}

export async function saveSshProfile(
  storageMode: StorageBackendMode,
  userId: string,
  input: {
    id?: string;
    label: string;
    host: string;
    port: number;
    username: string;
    authType: SshAuthType;
    lastConnectedAt?: number | null;
  }
): Promise<SshProfile> {
  const now = Date.now();
  const payload: SshProfile = {
    id: input.id || `ssh-${now}-${Math.random().toString(36).slice(2, 7)}`,
    label: input.label.trim() || `${input.username.trim()}@${input.host.trim()}`,
    host: input.host.trim(),
    port: Math.max(1, Math.min(65535, Math.round(input.port || 22))),
    username: input.username.trim(),
    authType: input.authType,
    lastConnectedAt: input.lastConnectedAt ?? null,
    createdAt: now,
  };

  if (storageMode === 'postgres') {
    const res = await fetch('/api/ssh/profiles', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = (await res.json().catch(() => ({}))) as {
      profile?: SshProfile;
      error?: string;
    };
    if (!res.ok || !data.profile) {
      throw new Error(data.error || 'Could not save SSH server profile.');
    }
    return data.profile;
  }

  const existing = readLocalProfiles(userId);
  const idx = existing.findIndex((p) => p.id === payload.id);
  if (idx >= 0) {
    existing[idx] = {
      ...existing[idx],
      ...payload,
      createdAt: existing[idx].createdAt,
    };
  } else {
    existing.unshift(payload);
  }
  writeLocalProfiles(userId, existing);
  return payload;
}

export async function deleteSshProfile(
  storageMode: StorageBackendMode,
  userId: string,
  profileId: string
): Promise<void> {
  if (storageMode === 'postgres') {
    const res = await fetch(`/api/ssh/profiles/${encodeURIComponent(profileId)}`, {
      method: 'DELETE',
      credentials: 'same-origin',
    });
    if (!res.ok) {
      throw new Error('Could not delete SSH server profile.');
    }
    return;
  }

  const next = readLocalProfiles(userId).filter((p) => p.id !== profileId);
  writeLocalProfiles(userId, next);
}
