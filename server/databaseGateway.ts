import { Client as PgClient } from 'pg';
import mysql from 'mysql2/promise';
import type {
  DatabaseEngine,
  DatabaseQueryResult,
  DatabaseTableColumn,
  DatabaseTableInfo,
} from '../src/types/notes.ts';

export interface DatabaseConnectionInput {
  engine: DatabaseEngine;
  host: string;
  port: number;
  database: string;
  username: string;
  password?: string;
  ssl?: boolean;
}

export class DatabaseGatewayError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

function isValidHost(host: string): boolean {
  if (!host || host.length > 253) return false;
  if (/[\s\r\n\0'"`;|&$<>\\]/.test(host)) return false;
  return /^[a-zA-Z0-9._:[\]-]+$/.test(host);
}

export function normalizeDatabaseConnection(raw: unknown): DatabaseConnectionInput {
  if (!raw || typeof raw !== 'object') {
    throw new DatabaseGatewayError('Missing database connection details.');
  }
  const input = raw as Record<string, unknown>;
  const engine: DatabaseEngine = input.engine === 'mysql' ? 'mysql' : 'postgres';
  const host = typeof input.host === 'string' ? input.host.trim() : '';
  const database = typeof input.database === 'string' ? input.database.trim() : '';
  const username = typeof input.username === 'string' ? input.username.trim() : '';
  const password = typeof input.password === 'string' ? input.password : '';
  const ssl = Boolean(input.ssl);

  const defaultPort = engine === 'mysql' ? 3306 : 5432;
  const rawPort = Number(input.port || defaultPort);
  const port = Number.isFinite(rawPort)
    ? Math.max(1, Math.min(65535, Math.round(rawPort)))
    : defaultPort;

  if (!isValidHost(host)) {
    throw new DatabaseGatewayError('Please enter a valid database hostname or IP address.');
  }
  if (!database || database.length > 128) {
    throw new DatabaseGatewayError('Please enter a valid database name.');
  }
  if (!username || username.length > 128) {
    throw new DatabaseGatewayError('Please enter a valid database username.');
  }

  return {
    engine,
    host,
    port,
    database,
    username,
    password,
    ssl,
  };
}

function serializeCellValue(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (Buffer.isBuffer(value)) {
    const preview = value.subarray(0, 64).toString('hex');
    return value.length > 64 ? `<Buffer 0x${preview}... (${value.length} bytes)>` : `0x${preview}`;
  }
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return value;
}

function formatPgErrorMessage(err: unknown): string {
  if (!(err instanceof Error)) return 'Failed to connect to PostgreSQL database.';
  const e = err as Error & { code?: string };
  if (e.code === 'ECONNREFUSED') {
    return `Connection refused by PostgreSQL server (${e.message}). Check host, port, and firewall.`;
  }
  if (e.code === 'ENOTFOUND') {
    return 'Database hostname could not be resolved.';
  }
  if (e.code === '28P01' || e.code === '28000') {
    return 'PostgreSQL authentication failed. Check username and password.';
  }
  if (e.code === '3D000') {
    return 'Target PostgreSQL database does not exist.';
  }
  return e.message;
}

function formatMysqlErrorMessage(err: unknown): string {
  if (!(err instanceof Error)) return 'Failed to connect to MySQL database.';
  const e = err as Error & { code?: string };
  if (e.code === 'ECONNREFUSED') {
    return `Connection refused by MySQL server (${e.message}). Check host, port, and firewall.`;
  }
  if (e.code === 'ENOTFOUND') {
    return 'Database hostname could not be resolved.';
  }
  if (e.code === 'ER_ACCESS_DENIED_ERROR') {
    return 'MySQL authentication failed. Check username and password.';
  }
  if (e.code === 'ER_BAD_DB_ERROR') {
    return 'Target MySQL database does not exist.';
  }
  return e.message;
}

async function createPgClient(cfg: DatabaseConnectionInput): Promise<PgClient> {
  const client = new PgClient({
    host: cfg.host,
    port: cfg.port,
    database: cfg.database,
    user: cfg.username,
    password: cfg.password ?? '',
    ssl: cfg.ssl ? { rejectUnauthorized: false } : false,
    connectionTimeoutMillis: 10000,
    query_timeout: 15000,
  });
  try {
    await client.connect();
    return client;
  } catch (err) {
    await client.end().catch(() => {});
    throw new DatabaseGatewayError(formatPgErrorMessage(err), 400);
  }
}

async function createMysqlConnection(cfg: DatabaseConnectionInput) {
  try {
    const conn = await mysql.createConnection({
      host: cfg.host,
      port: cfg.port,
      database: cfg.database,
      user: cfg.username,
      password: cfg.password ?? '',
      ssl: cfg.ssl ? { rejectUnauthorized: false } : undefined,
      connectTimeout: 10000,
      multipleStatements: false,
    });
    return conn;
  } catch (err) {
    throw new DatabaseGatewayError(formatMysqlErrorMessage(err), 400);
  }
}

export async function testAndIntrospectDatabase(
  cfg: DatabaseConnectionInput
): Promise<{
  engine: DatabaseEngine;
  database: string;
  version: string;
  tables: DatabaseTableInfo[];
}> {
  if (cfg.engine === 'postgres') {
    const client = await createPgClient(cfg);
    try {
      const versionRes = await client.query<{ version: string }>('SELECT version() AS version');
      const rawVersion = versionRes.rows[0]?.version || 'PostgreSQL';
      const versionMatch = /PostgreSQL\s+([^\s,]+)/i.exec(rawVersion);
      const version = versionMatch ? `PostgreSQL ${versionMatch[1]}` : rawVersion.slice(0, 60);

      const tablesRes = await client.query<{
        table_schema: string;
        table_name: string;
        estimated_rows: string | number | null;
      }>(
        `SELECT t.table_schema,
                t.table_name,
                GREATEST(COALESCE(c.reltuples, 0), 0)::bigint AS estimated_rows
         FROM information_schema.tables t
         LEFT JOIN pg_namespace n ON n.nspname = t.table_schema
         LEFT JOIN pg_class c ON c.relname = t.table_name AND c.relnamespace = n.oid
         WHERE t.table_type = 'BASE TABLE'
           AND t.table_schema NOT IN ('pg_catalog', 'information_schema')
         ORDER BY t.table_schema, t.table_name
         LIMIT 200`
      );

      const colsRes = await client.query<{
        table_schema: string;
        table_name: string;
        column_name: string;
        data_type: string;
        is_nullable: string;
      }>(
        `SELECT table_schema, table_name, column_name, data_type, is_nullable
         FROM information_schema.columns
         WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
         ORDER BY table_schema, table_name, ordinal_position`
      );

      const pkRes = await client.query<{
        table_schema: string;
        table_name: string;
        column_name: string;
      }>(
        `SELECT tc.table_schema, tc.table_name, kcu.column_name
         FROM information_schema.table_constraints tc
         JOIN information_schema.key_column_usage kcu
           ON tc.constraint_name = kcu.constraint_name
          AND tc.table_schema = kcu.table_schema
         WHERE tc.constraint_type = 'PRIMARY KEY'
           AND tc.table_schema NOT IN ('pg_catalog', 'information_schema')`
      );

      const fkRes = await client.query<{
        table_schema: string;
        table_name: string;
        column_name: string;
        foreign_table_name: string;
        foreign_column_name: string;
      }>(
        `SELECT tc.table_schema,
                tc.table_name,
                kcu.column_name,
                ccu.table_name AS foreign_table_name,
                ccu.column_name AS foreign_column_name
         FROM information_schema.table_constraints tc
         JOIN information_schema.key_column_usage kcu
           ON tc.constraint_name = kcu.constraint_name
          AND tc.table_schema = kcu.table_schema
         JOIN information_schema.constraint_column_usage ccu
           ON ccu.constraint_name = tc.constraint_name
          AND ccu.table_schema = tc.table_schema
         WHERE tc.constraint_type = 'FOREIGN KEY'
           AND tc.table_schema NOT IN ('pg_catalog', 'information_schema')`
      );

      const pkSet = new Set(
        pkRes.rows.map((r) => `${r.table_schema}.${r.table_name}.${r.column_name}`)
      );
      const fkMap = new Map(
        fkRes.rows.map((r) => [
          `${r.table_schema}.${r.table_name}.${r.column_name}`,
          `${r.foreign_table_name}.${r.foreign_column_name}`,
        ])
      );

      const colsByTable = new Map<string, DatabaseTableColumn[]>();
      for (const col of colsRes.rows) {
        const key = `${col.table_schema}.${col.table_name}`;
        const list = colsByTable.get(key) || [];
        const colKey = `${key}.${col.column_name}`;
        list.push({
          name: col.column_name,
          type: col.data_type,
          nullable: col.is_nullable === 'YES',
          isPrimaryKey: pkSet.has(colKey),
          foreignKey: fkMap.get(colKey) ?? null,
        });
        colsByTable.set(key, list);
      }

      const tables: DatabaseTableInfo[] = tablesRes.rows.map((t) => ({
        schema: t.table_schema,
        name: t.table_name,
        estimatedRows:
          t.estimated_rows !== null && t.estimated_rows !== undefined
            ? Number(t.estimated_rows)
            : null,
        columns: colsByTable.get(`${t.table_schema}.${t.table_name}`) || [],
      }));

      return {
        engine: 'postgres',
        database: cfg.database,
        version,
        tables,
      };
    } catch (err) {
      if (err instanceof DatabaseGatewayError) throw err;
      throw new DatabaseGatewayError(formatPgErrorMessage(err), 400);
    } finally {
      await client.end().catch(() => {});
    }
  }

  // MySQL / MariaDB introspection
  const conn = await createMysqlConnection(cfg);
  try {
    const [verRows] = await conn.query('SELECT VERSION() AS version');
    const verList = Array.isArray(verRows) ? (verRows as Array<{ version?: string }>) : [];
    const version = verList[0]?.version ? `MySQL ${verList[0].version}` : 'MySQL';

    const [tblRows] = await conn.query(
      `SELECT TABLE_SCHEMA AS table_schema,
              TABLE_NAME AS table_name,
              TABLE_ROWS AS estimated_rows
       FROM information_schema.TABLES
       WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE'
       ORDER BY TABLE_NAME
       LIMIT 200`,
      [cfg.database]
    );

    const [colRows] = await conn.query(
      `SELECT TABLE_SCHEMA AS table_schema,
              TABLE_NAME AS table_name,
              COLUMN_NAME AS column_name,
              COLUMN_TYPE AS data_type,
              IS_NULLABLE AS is_nullable,
              COLUMN_KEY AS column_key
       FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = ?
       ORDER BY TABLE_NAME, ORDINAL_POSITION`,
      [cfg.database]
    );

    const [fkRows] = await conn.query(
      `SELECT TABLE_NAME AS table_name,
              COLUMN_NAME AS column_name,
              REFERENCED_TABLE_NAME AS foreign_table_name,
              REFERENCED_COLUMN_NAME AS foreign_column_name
       FROM information_schema.KEY_COLUMN_USAGE
       WHERE TABLE_SCHEMA = ? AND REFERENCED_TABLE_NAME IS NOT NULL`,
      [cfg.database]
    );

    const fkMap = new Map<string, string>();
    if (Array.isArray(fkRows)) {
      for (const row of fkRows as Array<{
        table_name: string;
        column_name: string;
        foreign_table_name: string;
        foreign_column_name: string;
      }>) {
        fkMap.set(
          `${row.table_name}.${row.column_name}`,
          `${row.foreign_table_name}.${row.foreign_column_name}`
        );
      }
    }

    const colsByTable = new Map<string, DatabaseTableColumn[]>();
    if (Array.isArray(colRows)) {
      for (const col of colRows as Array<{
        table_name: string;
        column_name: string;
        data_type: string;
        is_nullable: string;
        column_key: string;
      }>) {
        const list = colsByTable.get(col.table_name) || [];
        list.push({
          name: col.column_name,
          type: col.data_type,
          nullable: col.is_nullable === 'YES',
          isPrimaryKey: col.column_key === 'PRI',
          foreignKey: fkMap.get(`${col.table_name}.${col.column_name}`) ?? null,
        });
        colsByTable.set(col.table_name, list);
      }
    }

    const tables: DatabaseTableInfo[] = Array.isArray(tblRows)
      ? (
          tblRows as Array<{
            table_schema: string;
            table_name: string;
            estimated_rows: number | null;
          }>
        ).map((t) => ({
          schema: t.table_schema,
          name: t.table_name,
          estimatedRows:
            t.estimated_rows !== null && t.estimated_rows !== undefined
              ? Number(t.estimated_rows)
              : null,
          columns: colsByTable.get(t.table_name) || [],
        }))
      : [];

    return {
      engine: 'mysql',
      database: cfg.database,
      version,
      tables,
    };
  } catch (err) {
    if (err instanceof DatabaseGatewayError) throw err;
    throw new DatabaseGatewayError(formatMysqlErrorMessage(err), 400);
  } finally {
    await conn.end().catch(() => {});
  }
}

export async function executeDatabaseQuery(
  cfg: DatabaseConnectionInput,
  sql: string,
  maxRows = 200
): Promise<DatabaseQueryResult> {
  const cleanSql = sql.trim();
  if (!cleanSql) {
    throw new DatabaseGatewayError('Enter a SQL query to run.');
  }
  if (cleanSql.length > 25000) {
    throw new DatabaseGatewayError('SQL query exceeds the 25,000 character limit.');
  }

  const startedAt = Date.now();

  if (cfg.engine === 'postgres') {
    const client = await createPgClient(cfg);
    try {
      const rawRes = await client.query(cleanSql);
      const durationMs = Date.now() - startedAt;
      const finalRes = (Array.isArray(rawRes) ? rawRes[rawRes.length - 1] : rawRes) as {
        fields?: Array<{ name: string }>;
        rows?: Array<Record<string, unknown>>;
        rowCount?: number | null;
        command?: string;
      };

      const columns = (finalRes.fields || []).map((f) => ({
        name: f.name,
      }));
      const allRows = Array.isArray(finalRes.rows) ? finalRes.rows : [];
      const truncated = allRows.length > maxRows;
      const slicedRows = allRows.slice(0, maxRows).map((row) => {
        const out: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(row)) {
          out[k] = serializeCellValue(v);
        }
        return out;
      });

      return {
        columns,
        rows: slicedRows,
        rowCount:
          typeof finalRes.rowCount === 'number' ? finalRes.rowCount : allRows.length,
        truncated,
        durationMs,
        command: finalRes.command || undefined,
      };
    } catch (err) {
      if (err instanceof DatabaseGatewayError) throw err;
      throw new DatabaseGatewayError(formatPgErrorMessage(err), 400);
    } finally {
      await client.end().catch(() => {});
    }
  }

  const conn = await createMysqlConnection(cfg);
  try {
    const [rawRows, fields] = await conn.query({ sql: cleanSql, timeout: 15000 });
    const durationMs = Date.now() - startedAt;

    if (Array.isArray(rawRows)) {
      const list = rawRows as Array<Record<string, unknown>>;
      const truncated = list.length > maxRows;
      const columns = Array.isArray(fields)
        ? fields.map((f) => ({ name: f.name }))
        : list[0]
        ? Object.keys(list[0]).map((name) => ({ name }))
        : [];
      const rows = list.slice(0, maxRows).map((row) => {
        const out: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(row)) {
          out[k] = serializeCellValue(v);
        }
        return out;
      });

      return {
        columns,
        rows,
        rowCount: list.length,
        truncated,
        durationMs,
        command: 'SELECT',
      };
    }

    const header = rawRows as { affectedRows?: number };
    return {
      columns: [],
      rows: [],
      rowCount: Number(header?.affectedRows ?? 0),
      truncated: false,
      durationMs,
      command: 'QUERY',
    };
  } catch (err) {
    if (err instanceof DatabaseGatewayError) throw err;
    throw new DatabaseGatewayError(formatMysqlErrorMessage(err), 400);
  } finally {
    await conn.end().catch(() => {});
  }
}
