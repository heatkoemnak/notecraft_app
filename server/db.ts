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
        CREATE TABLE IF NOT EXISTS users (
          id TEXT PRIMARY KEY,
          email TEXT UNIQUE NOT NULL,
          name TEXT NOT NULL,
          password_hash TEXT NOT NULL,
          created_at BIGINT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS sessions (
          token_hash TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          created_at BIGINT NOT NULL,
          expires_at BIGINT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS folders (
          id TEXT PRIMARY KEY,
          user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          created_at BIGINT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS notes (
          id TEXT PRIMARY KEY,
          user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
          title TEXT NOT NULL DEFAULT '',
          content TEXT NOT NULL DEFAULT '',
          folder_id TEXT REFERENCES folders(id) ON DELETE SET NULL,
          starred BOOLEAN NOT NULL DEFAULT FALSE,
          share_token TEXT,
          link_access TEXT NOT NULL DEFAULT 'off',
          created_at BIGINT NOT NULL,
          updated_at BIGINT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS snippets (
          id TEXT PRIMARY KEY,
          user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
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
          user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
          data_url TEXT NOT NULL,
          mime_type TEXT NOT NULL,
          name TEXT NOT NULL,
          created_at BIGINT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS note_files (
          id TEXT PRIMARY KEY,
          user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
          data_url TEXT NOT NULL,
          mime_type TEXT NOT NULL,
          name TEXT NOT NULL,
          size_bytes BIGINT NOT NULL DEFAULT 0,
          created_at BIGINT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS note_shares (
          id TEXT PRIMARY KEY,
          note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
          owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          recipient_email TEXT NOT NULL,
          permission TEXT NOT NULL DEFAULT 'view',
          created_at BIGINT NOT NULL,
          UNIQUE (note_id, recipient_email)
        );

        CREATE TABLE IF NOT EXISTS ssh_profiles (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          label TEXT NOT NULL,
          host TEXT NOT NULL,
          port INTEGER NOT NULL DEFAULT 22,
          username TEXT NOT NULL,
          auth_type TEXT NOT NULL DEFAULT 'password',
          last_connected_at BIGINT,
          created_at BIGINT NOT NULL
        );

        ALTER TABLE folders ADD COLUMN IF NOT EXISTS user_id TEXT REFERENCES users(id) ON DELETE CASCADE;
        ALTER TABLE notes ADD COLUMN IF NOT EXISTS user_id TEXT REFERENCES users(id) ON DELETE CASCADE;
        ALTER TABLE notes ADD COLUMN IF NOT EXISTS share_token TEXT;
        ALTER TABLE notes ADD COLUMN IF NOT EXISTS link_access TEXT NOT NULL DEFAULT 'off';
        ALTER TABLE snippets ADD COLUMN IF NOT EXISTS user_id TEXT REFERENCES users(id) ON DELETE CASCADE;
        ALTER TABLE note_images ADD COLUMN IF NOT EXISTS user_id TEXT REFERENCES users(id) ON DELETE CASCADE;

        CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
        CREATE INDEX IF NOT EXISTS idx_folders_user_id ON folders(user_id);
        CREATE INDEX IF NOT EXISTS idx_notes_user_id ON notes(user_id);
        CREATE UNIQUE INDEX IF NOT EXISTS idx_notes_share_token ON notes(share_token) WHERE share_token IS NOT NULL;
        CREATE INDEX IF NOT EXISTS idx_snippets_user_id ON snippets(user_id);
        CREATE INDEX IF NOT EXISTS idx_note_images_user_id ON note_images(user_id);
        CREATE INDEX IF NOT EXISTS idx_note_files_user_id ON note_files(user_id);
        CREATE INDEX IF NOT EXISTS idx_note_shares_recipient_email ON note_shares(recipient_email);
        CREATE INDEX IF NOT EXISTS idx_note_shares_note_id ON note_shares(note_id);
        CREATE INDEX IF NOT EXISTS idx_ssh_profiles_user_id ON ssh_profiles(user_id);
      `);

      schemaInitialized = true;
    } catch (err) {
      schemaInitPromise = null;
      throw err;
    }
  })();

  return schemaInitPromise;
}

export async function seedUserWorkspace(pool: Pool, userId: string): Promise<void> {
  await ensureSchema(pool);

  // If upgrading from a single-user database with unowned records, claim them for the first user
  const legacyRes = await pool.query<{ count: number }>(
    `SELECT (
       (SELECT COUNT(*)::int FROM folders WHERE user_id IS NULL) +
       (SELECT COUNT(*)::int FROM notes WHERE user_id IS NULL) +
       (SELECT COUNT(*)::int FROM snippets WHERE user_id IS NULL)
     ) AS count`
  );

  if ((legacyRes.rows[0]?.count ?? 0) > 0) {
    await Promise.all([
      pool.query('UPDATE folders SET user_id = $1 WHERE user_id IS NULL', [userId]),
      pool.query('UPDATE notes SET user_id = $1 WHERE user_id IS NULL', [userId]),
      pool.query('UPDATE snippets SET user_id = $1 WHERE user_id IS NULL', [userId]),
      pool.query('UPDATE note_images SET user_id = $1 WHERE user_id IS NULL', [userId]),
      pool.query('UPDATE note_files SET user_id = $1 WHERE user_id IS NULL', [userId]),
    ]);
    return;
  }

  const suffix = userId.replace(/[^a-zA-Z0-9]/g, '').slice(-8);
  const folderIdMap = new Map<string, string>();

  for (const folder of INITIAL_FOLDERS) {
    const scopedFolderId = `${folder.id}-${suffix}`;
    folderIdMap.set(folder.id, scopedFolderId);
    await pool.query(
      'INSERT INTO folders (id, user_id, name, created_at) VALUES ($1, $2, $3, $4) ON CONFLICT (id) DO NOTHING',
      [scopedFolderId, userId, folder.name, folder.createdAt]
    );
  }

  for (const note of INITIAL_NOTES) {
    const scopedNoteId = `${note.id}-${suffix}`;
    const scopedFolderId = note.folderId ? folderIdMap.get(note.folderId) ?? null : null;
    await pool.query(
      `INSERT INTO notes (id, user_id, title, content, folder_id, starred, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (id) DO NOTHING`,
      [
        scopedNoteId,
        userId,
        note.title,
        note.content,
        scopedFolderId,
        note.starred,
        note.createdAt,
        note.updatedAt,
      ]
    );
  }

  for (const snippet of INITIAL_SNIPPETS) {
    const scopedSnippetId = `${snippet.id}-${suffix}`;
    await pool.query(
      `INSERT INTO snippets (id, user_id, title, description, category, language, content, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) ON CONFLICT (id) DO NOTHING`,
      [
        scopedSnippetId,
        userId,
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
