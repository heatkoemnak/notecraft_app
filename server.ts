import 'dotenv/config';
import express, { type Request, type Response } from 'express';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type { Pool } from 'pg';
import {
  buildClearSessionCookie,
  buildSessionCookie,
  generateSessionToken,
  hashPassword,
  hashSessionToken,
  parseCookies,
  SESSION_COOKIE_NAME,
  SESSION_TTL_MS,
  verifyPassword,
} from './server/auth.ts';
import { ensureSchema, getPool, seedUserWorkspace } from './server/db.ts';

const PORT = Number(process.env.PORT || 3000);
const isProduction = process.env.NODE_ENV === 'production';

interface SessionUser {
  id: string;
  name: string;
  email: string;
  createdAt: number;
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

async function resolveSessionUser(pool: Pool, req: Request): Promise<SessionUser | null> {
  const cookies = parseCookies(req.headers.cookie);
  const rawToken = cookies[SESSION_COOKIE_NAME];
  if (!rawToken) return null;

  const tokenHash = hashSessionToken(rawToken);
  const now = Date.now();
  const result = await pool.query<{
    id: string;
    name: string;
    email: string;
    created_at: string | number;
  }>(
    `SELECT u.id, u.name, u.email, u.created_at
     FROM sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = $1 AND s.expires_at > $2`,
    [tokenHash, now]
  );

  const row = result.rows[0];
  if (!row) return null;

  return {
    id: row.id,
    name: row.name,
    email: row.email,
    createdAt: Number(row.created_at),
  };
}

async function createSessionForUser(pool: Pool, userId: string, req: Request, res: Response) {
  const token = generateSessionToken();
  const tokenHash = hashSessionToken(token);
  const now = Date.now();
  const expiresAt = now + SESSION_TTL_MS;

  await pool.query(
    'INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES ($1, $2, $3, $4)',
    [tokenHash, userId, now, expiresAt]
  );
  res.setHeader('Set-Cookie', buildSessionCookie(token, req));
}

async function requireAuth(req: Request, res: Response): Promise<{ pool: Pool; user: SessionUser } | null> {
  const pool = getPool();
  if (!pool) {
    res.status(503).json({ error: 'PostgreSQL not configured' });
    return null;
  }

  await ensureSchema(pool);
  const user = await resolveSessionUser(pool, req);
  if (!user) {
    res.status(401).json({ error: 'Authentication required' });
    return null;
  }

  return { pool, user };
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '15mb' }));

  // Health & storage mode check
  app.get('/api/health', async (_req, res) => {
    const pool = getPool();
    if (!pool) {
      return res.json({ ok: true, storage: 'local' });
    }
    try {
      await ensureSchema(pool);
      await pool.query('SELECT 1');
      return res.json({ ok: true, storage: 'postgres' });
    } catch (err) {
      console.error('PostgreSQL healthcheck failed:', err);
      return res.status(503).json({ ok: false, storage: 'unavailable' });
    }
  });

  // Auth: check current session & active storage mode
  app.get('/api/auth/session', async (req, res) => {
    const pool = getPool();
    if (!pool) {
      return res.json({ storage: 'local', user: null });
    }
    try {
      await ensureSchema(pool);
      const user = await resolveSessionUser(pool, req);
      return res.json({ storage: 'postgres', user });
    } catch (err) {
      const code = (err as { code?: string })?.code;
      if (
        code === 'ECONNREFUSED' ||
        code === 'ENOTFOUND' ||
        code === 'ETIMEDOUT' ||
        code === 'EHOSTUNREACH'
      ) {
        return res.json({ storage: 'local', user: null });
      }
      console.error('Failed to resolve session:', err);
      return res.status(500).json({ error: 'Failed to verify session' });
    }
  });

  // Auth: register new user
  app.post('/api/auth/register', async (req, res) => {
    const pool = getPool();
    if (!pool) {
      return res.status(503).json({ error: 'PostgreSQL not configured' });
    }

    const rawName = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
    const rawEmail = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    const password = typeof req.body?.password === 'string' ? req.body.password : '';

    if (!rawName || rawName.length < 2) {
      return res.status(400).json({ error: 'Please enter your name (at least 2 characters).' });
    }
    if (!isValidEmail(rawEmail)) {
      return res.status(400).json({ error: 'Please enter a valid email address.' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters.' });
    }

    try {
      await ensureSchema(pool);
      const existing = await pool.query<{ id: string }>(
        'SELECT id FROM users WHERE email = $1',
        [rawEmail]
      );
      if (existing.rows.length > 0) {
        return res.status(409).json({ error: 'An account with this email already exists.' });
      }

      const userId = `usr-${randomUUID()}`;
      const createdAt = Date.now();
      const passwordHash = hashPassword(password);

      await pool.query(
        'INSERT INTO users (id, email, name, password_hash, created_at) VALUES ($1, $2, $3, $4, $5)',
        [userId, rawEmail, rawName, passwordHash, createdAt]
      );

      await seedUserWorkspace(pool, userId);
      await createSessionForUser(pool, userId, req, res);

      return res.status(201).json({
        user: { id: userId, name: rawName, email: rawEmail, createdAt },
      });
    } catch (err) {
      console.error('Failed to register user:', err);
      return res.status(500).json({ error: 'Could not create account.' });
    }
  });

  // Auth: login existing user
  app.post('/api/auth/login', async (req, res) => {
    const pool = getPool();
    if (!pool) {
      return res.status(503).json({ error: 'PostgreSQL not configured' });
    }

    const rawEmail = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    const password = typeof req.body?.password === 'string' ? req.body.password : '';

    if (!isValidEmail(rawEmail) || !password) {
      return res.status(400).json({ error: 'Please enter your email and password.' });
    }

    try {
      await ensureSchema(pool);
      const result = await pool.query<{
        id: string;
        name: string;
        email: string;
        password_hash: string;
        created_at: string | number;
      }>(
        'SELECT id, name, email, password_hash, created_at FROM users WHERE email = $1',
        [rawEmail]
      );

      const userRow = result.rows[0];
      if (!userRow || !verifyPassword(password, userRow.password_hash)) {
        return res.status(401).json({ error: 'Invalid email or password.' });
      }

      await createSessionForUser(pool, userRow.id, req, res);
      return res.json({
        user: {
          id: userRow.id,
          name: userRow.name,
          email: userRow.email,
          createdAt: Number(userRow.created_at),
        },
      });
    } catch (err) {
      console.error('Failed to log in:', err);
      return res.status(500).json({ error: 'Sign in failed.' });
    }
  });

  // Auth: logout
  app.post('/api/auth/logout', async (req, res) => {
    const pool = getPool();
    const cookies = parseCookies(req.headers.cookie);
    const rawToken = cookies[SESSION_COOKIE_NAME];

    if (pool && rawToken) {
      try {
        await ensureSchema(pool);
        await pool.query('DELETE FROM sessions WHERE token_hash = $1', [
          hashSessionToken(rawToken),
        ]);
      } catch (err) {
        console.error('Failed to delete session:', err);
      }
    }

    res.setHeader('Set-Cookie', buildClearSessionCookie(req));
    return res.json({ ok: true });
  });

  // Load authenticated user's workspace
  app.get('/api/workspace', async (req, res) => {
    try {
      const auth = await requireAuth(req, res);
      if (!auth) return;
      const { pool, user } = auth;

      const [foldersRes, notesRes, snippetsRes] = await Promise.all([
        pool.query(
          'SELECT id, name, created_at FROM folders WHERE user_id = $1 ORDER BY created_at ASC',
          [user.id]
        ),
        pool.query(
          'SELECT id, title, content, folder_id, starred, created_at, updated_at FROM notes WHERE user_id = $1 ORDER BY updated_at DESC',
          [user.id]
        ),
        pool.query(
          'SELECT id, title, description, category, language, content, created_at, updated_at FROM snippets WHERE user_id = $1 ORDER BY updated_at DESC',
          [user.id]
        ),
      ]);

      return res.json({
        folders: foldersRes.rows.map((r) => ({
          id: r.id,
          name: r.name,
          createdAt: Number(r.created_at),
        })),
        notes: notesRes.rows.map((r) => ({
          id: r.id,
          title: r.title,
          content: r.content,
          folderId: r.folder_id,
          starred: Boolean(r.starred),
          createdAt: Number(r.created_at),
          updatedAt: Number(r.updated_at),
        })),
        snippets: snippetsRes.rows.map((r) => ({
          id: r.id,
          title: r.title,
          description: r.description,
          category: r.category,
          language: r.language,
          content: r.content,
          createdAt: Number(r.created_at),
          updatedAt: Number(r.updated_at),
        })),
      });
    } catch (err) {
      console.error('Failed to load workspace from PostgreSQL:', err);
      return res.status(500).json({ error: 'Failed to load workspace' });
    }
  });

  // Folders CRUD
  app.post('/api/folders', async (req, res) => {
    try {
      const auth = await requireAuth(req, res);
      if (!auth) return;
      const { pool, user } = auth;

      const { id, name, createdAt } = req.body || {};
      if (!id || !name) return res.status(400).json({ error: 'Missing folder fields' });

      const result = await pool.query(
        `INSERT INTO folders (id, user_id, name, created_at)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name
         WHERE folders.user_id = EXCLUDED.user_id
         RETURNING id`,
        [id, user.id, name, Number(createdAt || Date.now())]
      );
      if (result.rowCount === 0) return res.status(403).json({ error: 'Forbidden' });
      return res.status(201).json({ ok: true });
    } catch (err) {
      console.error('Failed to create folder:', err);
      return res.status(500).json({ error: 'Failed to save folder' });
    }
  });

  app.patch('/api/folders/:id', async (req, res) => {
    try {
      const auth = await requireAuth(req, res);
      if (!auth) return;
      const { pool, user } = auth;

      const { name } = req.body || {};
      if (!name) return res.status(400).json({ error: 'Missing folder name' });

      await pool.query('UPDATE folders SET name = $1 WHERE id = $2 AND user_id = $3', [
        name,
        req.params.id,
        user.id,
      ]);
      return res.json({ ok: true });
    } catch (err) {
      console.error('Failed to rename folder:', err);
      return res.status(500).json({ error: 'Failed to rename folder' });
    }
  });

  app.delete('/api/folders/:id', async (req, res) => {
    try {
      const auth = await requireAuth(req, res);
      if (!auth) return;
      const { pool, user } = auth;

      await pool.query('DELETE FROM folders WHERE id = $1 AND user_id = $2', [
        req.params.id,
        user.id,
      ]);
      return res.json({ ok: true });
    } catch (err) {
      console.error('Failed to delete folder:', err);
      return res.status(500).json({ error: 'Failed to delete folder' });
    }
  });

  // Notes CRUD
  app.post('/api/notes', async (req, res) => {
    try {
      const auth = await requireAuth(req, res);
      if (!auth) return;
      const { pool, user } = auth;

      const { id, title, content, folderId, starred, createdAt, updatedAt } = req.body || {};
      if (!id) return res.status(400).json({ error: 'Missing note id' });

      const result = await pool.query(
        `INSERT INTO notes (id, user_id, title, content, folder_id, starred, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (id) DO UPDATE SET
           title = EXCLUDED.title,
           content = EXCLUDED.content,
           folder_id = EXCLUDED.folder_id,
           starred = EXCLUDED.starred,
           updated_at = EXCLUDED.updated_at
         WHERE notes.user_id = EXCLUDED.user_id
         RETURNING id`,
        [
          id,
          user.id,
          title ?? '',
          content ?? '',
          folderId ?? null,
          Boolean(starred),
          Number(createdAt || Date.now()),
          Number(updatedAt || Date.now()),
        ]
      );
      if (result.rowCount === 0) return res.status(403).json({ error: 'Forbidden' });
      return res.status(201).json({ ok: true });
    } catch (err) {
      console.error('Failed to save note:', err);
      return res.status(500).json({ error: 'Failed to save note' });
    }
  });

  app.patch('/api/notes/:id', async (req, res) => {
    try {
      const auth = await requireAuth(req, res);
      if (!auth) return;
      const { pool, user } = auth;

      const { title, content, folderId, starred, updatedAt } = req.body || {};
      const sets: string[] = [];
      const values: unknown[] = [];

      if (title !== undefined) {
        values.push(title);
        sets.push(`title = $${values.length}`);
      }
      if (content !== undefined) {
        values.push(content);
        sets.push(`content = $${values.length}`);
      }
      if (folderId !== undefined) {
        values.push(folderId);
        sets.push(`folder_id = $${values.length}`);
      }
      if (starred !== undefined) {
        values.push(Boolean(starred));
        sets.push(`starred = $${values.length}`);
      }
      values.push(Number(updatedAt || Date.now()));
      sets.push(`updated_at = $${values.length}`);

      values.push(req.params.id);
      const idIdx = values.length;
      values.push(user.id);
      const userIdx = values.length;

      await pool.query(
        `UPDATE notes SET ${sets.join(', ')} WHERE id = $${idIdx} AND user_id = $${userIdx}`,
        values
      );
      return res.json({ ok: true });
    } catch (err) {
      console.error('Failed to update note:', err);
      return res.status(500).json({ error: 'Failed to update note' });
    }
  });

  app.delete('/api/notes/:id', async (req, res) => {
    try {
      const auth = await requireAuth(req, res);
      if (!auth) return;
      const { pool, user } = auth;

      await pool.query('DELETE FROM notes WHERE id = $1 AND user_id = $2', [
        req.params.id,
        user.id,
      ]);
      return res.json({ ok: true });
    } catch (err) {
      console.error('Failed to delete note:', err);
      return res.status(500).json({ error: 'Failed to delete note' });
    }
  });

  // Snippets CRUD
  app.post('/api/snippets', async (req, res) => {
    try {
      const auth = await requireAuth(req, res);
      if (!auth) return;
      const { pool, user } = auth;

      const { id, title, description, category, language, content, createdAt, updatedAt } =
        req.body || {};
      if (!id || !title) return res.status(400).json({ error: 'Missing snippet fields' });

      const result = await pool.query(
        `INSERT INTO snippets (id, user_id, title, description, category, language, content, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (id) DO UPDATE SET
           title = EXCLUDED.title,
           description = EXCLUDED.description,
           category = EXCLUDED.category,
           language = EXCLUDED.language,
           content = EXCLUDED.content,
           updated_at = EXCLUDED.updated_at
         WHERE snippets.user_id = EXCLUDED.user_id
         RETURNING id`,
        [
          id,
          user.id,
          title,
          description ?? '',
          category ?? 'General',
          language ?? 'text',
          content ?? '',
          Number(createdAt || Date.now()),
          Number(updatedAt || Date.now()),
        ]
      );
      if (result.rowCount === 0) return res.status(403).json({ error: 'Forbidden' });
      return res.status(201).json({ ok: true });
    } catch (err) {
      console.error('Failed to save snippet:', err);
      return res.status(500).json({ error: 'Failed to save snippet' });
    }
  });

  app.delete('/api/snippets/:id', async (req, res) => {
    try {
      const auth = await requireAuth(req, res);
      if (!auth) return;
      const { pool, user } = auth;

      await pool.query('DELETE FROM snippets WHERE id = $1 AND user_id = $2', [
        req.params.id,
        user.id,
      ]);
      return res.json({ ok: true });
    } catch (err) {
      console.error('Failed to delete snippet:', err);
      return res.status(500).json({ error: 'Failed to delete snippet' });
    }
  });

  // Images storage
  app.post('/api/images', async (req, res) => {
    try {
      const auth = await requireAuth(req, res);
      if (!auth) return;
      const { pool, user } = auth;

      const { id, dataUrl, mimeType, name, createdAt } = req.body || {};
      if (!id || !dataUrl) return res.status(400).json({ error: 'Missing image payload' });

      await pool.query(
        `INSERT INTO note_images (id, user_id, data_url, mime_type, name, created_at)
         VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (id) DO NOTHING`,
        [
          id,
          user.id,
          dataUrl,
          mimeType ?? 'image/png',
          name ?? 'image.png',
          Number(createdAt || Date.now()),
        ]
      );
      return res.status(201).json({ ok: true });
    } catch (err) {
      console.error('Failed to store image in PostgreSQL:', err);
      return res.status(500).json({ error: 'Failed to save image' });
    }
  });

  app.get('/api/images/:id', async (req, res) => {
    try {
      const auth = await requireAuth(req, res);
      if (!auth) return;
      const { pool, user } = auth;

      const result = await pool.query<{ data_url: string }>(
        'SELECT data_url FROM note_images WHERE id = $1 AND user_id = $2',
        [req.params.id, user.id]
      );
      const row = result.rows[0];
      if (!row) return res.status(404).json({ error: 'Image not found' });
      return res.json({ dataUrl: row.data_url });
    } catch (err) {
      console.error('Failed to fetch image from PostgreSQL:', err);
      return res.status(500).json({ error: 'Failed to fetch image' });
    }
  });

  if (!isProduction) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`NoteCraft server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer();
