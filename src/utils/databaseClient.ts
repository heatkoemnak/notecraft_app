import {
  DatabaseEngine,
  DatabaseProfile,
  DatabaseQueryResult,
  DatabaseTableInfo,
} from '../types/notes';
import { StorageBackendMode } from './authClient';

function getLocalDbProfilesKey(userId: string): string {
  return `notecraft.user.${userId}.dbProfiles.v1`;
}

export interface ParsedDatabaseUrl {
  engine?: DatabaseEngine;
  host?: string;
  port?: number;
  database?: string;
  username?: string;
  password?: string;
  ssl?: boolean;
}

export function parseDatabaseUrl(raw: string): ParsedDatabaseUrl | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const normalized = trimmed.replace(/^postgresql:\/\//i, 'postgres://');
  if (!/^(postgres|mysql):\/\//i.test(normalized)) {
    return null;
  }

  try {
    const url = new URL(normalized);
    const engine: DatabaseEngine = url.protocol.startsWith('mysql') ? 'mysql' : 'postgres';
    const defaultPort = engine === 'mysql' ? 3306 : 5432;
    const port = url.port ? Number(url.port) : defaultPort;
    const sslMode = url.searchParams.get('sslmode')?.toLowerCase();
    const sslParam = url.searchParams.get('ssl')?.toLowerCase();
    const ssl =
      sslParam === 'true' ||
      sslParam === '1' ||
      sslMode === 'require' ||
      sslMode === 'verify-ca' ||
      sslMode === 'verify-full';

    return {
      engine,
      host: url.hostname || undefined,
      port: Number.isFinite(port) && port >= 1 && port <= 65535 ? port : defaultPort,
      database: url.pathname.replace(/^\/+/, '') || undefined,
      username: url.username ? decodeURIComponent(url.username) : undefined,
      password: url.password ? decodeURIComponent(url.password) : undefined,
      ssl,
    };
  } catch {
    return null;
  }
}

export function formatDatabaseUrlPreview({
  engine,
  username,
  host,
  port,
  database,
  ssl,
}: {
  engine: DatabaseEngine;
  username: string;
  host: string;
  port: number;
  database: string;
  ssl: boolean;
}): string {
  const cleanHost = host.trim();
  if (!cleanHost) return '';
  const cleanUser = username.trim() || (engine === 'mysql' ? 'root' : 'postgres');
  const cleanDb = database.trim() || 'postgres';
  const query = ssl ? '?sslmode=require' : '';
  return `${engine}://${cleanUser}@${cleanHost}:${port}/${cleanDb}${query}`;
}

export async function fetchDatabaseProfiles(
  storageMode: StorageBackendMode,
  userId: string
): Promise<DatabaseProfile[]> {
  if (storageMode === 'postgres') {
    try {
      const res = await fetch('/api/database/profiles', { credentials: 'same-origin' });
      if (res.ok) {
        const data = (await res.json()) as { profiles?: DatabaseProfile[] };
        if (Array.isArray(data.profiles)) {
          return data.profiles;
        }
      }
    } catch {
      // fallback below
    }
  }

  try {
    const raw = localStorage.getItem(getLocalDbProfilesKey(userId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as DatabaseProfile[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function saveDatabaseProfile(
  storageMode: StorageBackendMode,
  userId: string,
  profile: Omit<DatabaseProfile, 'id' | 'createdAt'> & { id?: string; createdAt?: number }
): Promise<DatabaseProfile> {
  const now = Date.now();
  const payload: DatabaseProfile = {
    id: profile.id || `db-${now}-${Math.random().toString(36).slice(2, 6)}`,
    label: profile.label.trim() || `${profile.database}@${profile.host}`,
    engine: profile.engine === 'mysql' ? 'mysql' : 'postgres',
    host: profile.host.trim(),
    port: Math.max(1, Math.min(65535, Math.round(Number(profile.port || 5432)))),
    database: profile.database.trim(),
    username: profile.username.trim(),
    ssl: Boolean(profile.ssl),
    lastConnectedAt: profile.lastConnectedAt ?? null,
    createdAt: profile.createdAt ?? now,
  };

  if (storageMode === 'postgres') {
    const res = await fetch('/api/database/profiles', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (res.ok) {
      const data = (await res.json()) as { profile?: DatabaseProfile };
      if (data.profile) return data.profile;
    } else if (res.status !== 503) {
      const err = (await res.json().catch(() => null)) as { error?: string } | null;
      throw new Error(err?.error || 'Failed to save database profile');
    }
  }

  const key = getLocalDbProfilesKey(userId);
  let existing: DatabaseProfile[] = [];
  try {
    const raw = localStorage.getItem(key);
    if (raw) existing = JSON.parse(raw) as DatabaseProfile[];
  } catch {
    existing = [];
  }
  const filtered = existing.filter((p) => p.id !== payload.id);
  const next = [payload, ...filtered];
  localStorage.setItem(key, JSON.stringify(next));
  return payload;
}

export async function deleteDatabaseProfile(
  storageMode: StorageBackendMode,
  userId: string,
  profileId: string
): Promise<void> {
  if (storageMode === 'postgres') {
    try {
      await fetch(`/api/database/profiles/${encodeURIComponent(profileId)}`, {
        method: 'DELETE',
        credentials: 'same-origin',
      });
    } catch {
      // continue local cleanup
    }
  }

  const key = getLocalDbProfilesKey(userId);
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return;
    const list = (JSON.parse(raw) as DatabaseProfile[]).filter((p) => p.id !== profileId);
    localStorage.setItem(key, JSON.stringify(list));
  } catch {
    // ignore
  }
}

export interface DatabaseConnectPayload {
  engine: DatabaseEngine;
  host: string;
  port: number;
  database: string;
  username: string;
  password: string;
  ssl: boolean;
}

export interface DatabaseIntrospectionResponse {
  engine: DatabaseEngine;
  database: string;
  version: string;
  tables: DatabaseTableInfo[];
}

export async function connectAndIntrospectDatabase(
  payload: DatabaseConnectPayload
): Promise<DatabaseIntrospectionResponse> {
  const res = await fetch('/api/database/connect', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = (await res.json().catch(() => null)) as
    | (DatabaseIntrospectionResponse & { error?: string })
    | null;
  if (!res.ok || !data || !Array.isArray(data.tables)) {
    throw new Error(data?.error || `Database connection failed (${res.status}).`);
  }
  return data;
}

export async function runDatabaseQuery(
  payload: DatabaseConnectPayload,
  sql: string
): Promise<DatabaseQueryResult> {
  const res = await fetch('/api/database/query', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...payload, sql }),
  });
  const data = (await res.json().catch(() => null)) as
    | (DatabaseQueryResult & { error?: string })
    | null;
  if (!res.ok || !data || !Array.isArray(data.rows)) {
    throw new Error(data?.error || `Query execution failed (${res.status}).`);
  }
  return data;
}

export function formatSchemaAsMarkdown(
  info: DatabaseIntrospectionResponse,
  host: string,
  port: number
): string {
  const lines: string[] = [
    `## Database Schema — ${info.database}`,
    '',
    `- **Engine**: ${info.version}`,
    `- **Endpoint**: \`${host}:${port}/${info.database}\``,
    `- **Tables**: ${info.tables.length}`,
    '',
  ];

  // Build Mermaid ER diagram when tables have relationships or up to 16 tables
  const erTables = info.tables.slice(0, 16);
  if (erTables.length > 0) {
    lines.push('### Entity Relationship Overview', '', '```mermaid', 'erDiagram');
    const rels: string[] = [];
    for (const tbl of erTables) {
      const safeName = tbl.name.replace(/[^a-zA-Z0-9_]/g, '_');
      lines.push(`  ${safeName} {`);
      for (const col of tbl.columns.slice(0, 12)) {
        const safeType = col.type.replace(/[^a-zA-Z0-9_]/g, '_');
        const safeCol = col.name.replace(/[^a-zA-Z0-9_]/g, '_');
        const keyTag = col.isPrimaryKey ? ' PK' : col.foreignKey ? ' FK' : '';
        lines.push(`    ${safeType} ${safeCol}${keyTag}`);
        if (col.foreignKey) {
          const [refTable] = col.foreignKey.split('.');
          const safeRef = refTable.replace(/[^a-zA-Z0-9_]/g, '_');
          if (safeRef && safeRef !== safeName) {
            rels.push(`  ${safeRef} ||--o{ ${safeName} : "${safeCol}"`);
          }
        }
      }
      lines.push('  }');
    }
    for (const r of Array.from(new Set(rels))) {
      lines.push(r);
    }
    lines.push('```', '');
  }

  lines.push('### Tables & Columns', '');
  for (const tbl of info.tables) {
    const rowText =
      tbl.estimatedRows !== null ? ` (~${tbl.estimatedRows.toLocaleString()} rows)` : '';
    lines.push(`#### \`${tbl.schema}.${tbl.name}\`${rowText}`, '');
    if (tbl.columns.length === 0) {
      lines.push('*No columns found.*', '');
      continue;
    }
    lines.push('| Column | Type | Nullable | Key / Reference |');
    lines.push('| :--- | :--- | :--- | :--- |');
    for (const col of tbl.columns) {
      const keys: string[] = [];
      if (col.isPrimaryKey) keys.push('PK');
      if (col.foreignKey) keys.push(`FK -> ${col.foreignKey}`);
      lines.push(
        `| \`${col.name}\` | \`${col.type}\` | ${col.nullable ? 'YES' : 'NO'} | ${
          keys.join(', ') || '-'
        } |`
      );
    }
    lines.push('');
  }

  return lines.join('\n');
}

export function formatQueryResultAsMarkdown(
  info: { engine: DatabaseEngine; database: string; host: string; port: number },
  sql: string,
  result: DatabaseQueryResult
): string {
  const lines: string[] = [
    `## SQL Query Result — ${info.database}`,
    '',
    `- **Engine**: ${info.engine === 'mysql' ? 'MySQL' : 'PostgreSQL'} (\`${info.host}:${info.port}/${info.database}\`)`,
    `- **Rows**: ${result.rowCount}${result.truncated ? ' (showing first 200)' : ''} · **Duration**: ${result.durationMs} ms`,
    '',
    '### Query',
    '',
    '```sql',
    sql.trim(),
    '```',
    '',
  ];

  if (result.columns.length > 0 && result.rows.length > 0) {
    lines.push('### Output', '');
    lines.push(`| ${result.columns.map((c) => c.name).join(' | ')} |`);
    lines.push(`| ${result.columns.map(() => ':---').join(' | ')} |`);
    for (const row of result.rows.slice(0, 50)) {
      const cells = result.columns.map((c) => {
        const val = row[c.name];
        if (val === null || val === undefined) return '`NULL`';
        return String(val).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ').slice(0, 120);
      });
      lines.push(`| ${cells.join(' | ')} |`);
    }
    lines.push('');
  }

  return lines.join('\n');
}
