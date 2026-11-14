import { Pool } from 'pg';
import { INITIAL_FOLDERS, INITIAL_NOTES, INITIAL_SNIPPETS } from '../src/data/seedData.ts';

declare global {
  var _notecraftPgPool: Pool | undefined;
}

let schemaInitialized = false;
let schemaInitPromise: Promise<void> | null = null;

export function isDatabaseConfigured(): boolean {
  return Boolean(
    process.env.PGHOST &&
      process.env.PGDATABASE &&
      process.env.PGUSER
  );
}

export function getPool(): Pool | null {
  if (!isDatabaseConfigured()) return null;

  if (!global._notecraftPgPool) {
    global._notecraftPgPool = new Pool({
      host: process.env.PGHOST,
      port: Number(process.env.PGPORT || 5432),
      user: process.env.PGUSER,
      password: process.env.PGPASSWORD || '',
      database: process.env.PGDATABASE,
      max: 10,
      connectionTimeoutMillis: 10000,
      ssl: process.env.PGSSL === 'true' ? { rejectUnauthorized: false } : false,
    });

    global._notecraftPgPool.on('error', (err) => {
      console.error('Unexpected PostgreSQL pool error:', err);
    });
  }

  return global._notecraftPgPool;
}

export async function ensureSchema(pool: Pool): Promise<void> {
  if (schemaInitialized) return;
  if (schemaInitPromise) return schemaInitPromise;

  schemaInitPromise = (async () => {
    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS folders (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          created_at BIGINT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS notes (
          id TEXT PRIMARY KEY,
          title TEXT NOT NULL DEFAULT '',
          content TEXT NOT NULL DEFAULT '',
          folder_id TEXT REFERENCES folders(id) ON DELETE SET NULL,
          starred BOOLEAN NOT NULL DEFAULT FALSE,
          created_at BIGINT NOT NULL,
          updated_at BIGINT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS snippets (
          id TEXT PRIMARY KEY,
          title TEXT NOT NULL,
          description TEXT NOT NULL DEFAULT '',
          category TEXT NOT NULL DEFAULT 'General',
          language TEXT NOT NULL DEFAULT 'text',
          content TEXT NOT NULL,
          created_at BIGINT NOT NULL,
          updated_at BIGINT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS note_images (
          id TEXT PRIMARY KEY,
          data_url TEXT NOT NULL,
          mime_type TEXT NOT NULL,
          name TEXT NOT NULL,
          created_at BIGINT NOT NULL
        );
      `);

      const folderCountRes = await pool.query<{ count: number }>(
        'SELECT COUNT(*)::int AS count FROM folders'
      );
      const noteCountRes = await pool.query<{ count: number }>(
        'SELECT COUNT(*)::int AS count FROM notes'
      );

      if (folderCountRes.rows[0]?.count === 0 && noteCountRes.rows[0]?.count === 0) {
        for (const folder of INITIAL_FOLDERS) {
          await pool.query(
            'INSERT INTO folders (id, name, created_at) VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING',
            [folder.id, folder.name, folder.createdAt]
          );
        }

        for (const note of INITIAL_NOTES) {
          await pool.query(
            `INSERT INTO notes (id, title, content, folder_id, starred, created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (id) DO NOTHING`,
            [
              note.id,
              note.title,
              note.content,
              note.folderId,
              note.starred,
              note.createdAt,
              note.updatedAt,
            ]
          );
        }

        for (const snippet of INITIAL_SNIPPETS) {
          await pool.query(
            `INSERT INTO snippets (id, title, description, category, language, content, created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (id) DO NOTHING`,
            [
              snippet.id,
              snippet.title,
              snippet.description,
              snippet.category,
              snippet.language,
              snippet.content,
              snippet.createdAt,
              snippet.updatedAt,
            ]
          );
        }
      }

      schemaInitialized = true;
    } catch (err) {
      schemaInitPromise = null;
      throw err;
    }
  })();

  return schemaInitPromise;
}
