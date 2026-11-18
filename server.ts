import 'dotenv/config';
import express, { type Request, type Response } from 'express';
import { randomBytes, randomUUID } from 'node:crypto';
import { createServer as createHttpServer } from 'node:http';
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
import {
  GroqProofreadError,
  type ProofreadMode,
  proofreadWithGroq,
} from './server/groqProofread.ts';
import {
  type GenerateDocLength,
  type GenerateDocType,
  generateDocumentWithGroq,
} from './server/groqGenerate.ts';
import { listAvailableGroqModels } from './server/groqModels.ts';
import { registerOAuthRoutes } from './server/oauth.ts';
import { attachSshWebSocketServer } from './server/sshGateway.ts';

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

function isPgConnectionError(err: unknown): boolean {
  const code = (err as { code?: string })?.code;
  return (
    code === 'ECONNREFUSED' ||
    code === 'ENOTFOUND' ||
    code === 'ETIMEDOUT' ||
    code === 'EHOSTUNREACH'
  );
}

async function requireAuth(req: Request, res: Response): Promise<{ pool: Pool; user: SessionUser } | null> {
  const pool = getPool();
  if (!pool) {
    res.status(503).json({ error: 'PostgreSQL not configured' });
    return null;
  }

  try {
    await ensureSchema(pool);
    const user = await resolveSessionUser(pool, req);
    if (!user) {
      res.status(401).json({ error: 'Authentication required' });
      return null;
    }
    return { pool, user };
  } catch (err) {
    if (isPgConnectionError(err)) {
      res.status(503).json({ error: 'PostgreSQL unavailable' });
      return null;
    }
    throw err;
  }
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

  // Mount Google and GitHub OAuth routes
  registerOAuthRoutes(app, getPool);

  // Load authenticated user's workspace (including shares & notes shared with user)
  app.get('/api/workspace', async (req, res) => {
    try {
      const auth = await requireAuth(req, res);
      if (!auth) return;
      const { pool, user } = auth;

      const [foldersRes, notesRes, snippetsRes, ownerSharesRes, sharedWithMeRes] =
        await Promise.all([
          pool.query(
            'SELECT id, name, created_at FROM folders WHERE user_id = $1 ORDER BY created_at ASC',
            [user.id]
          ),
          pool.query(
            'SELECT id, title, content, folder_id, starred, share_token, link_access, created_at, updated_at FROM notes WHERE user_id = $1 ORDER BY updated_at DESC',
            [user.id]
          ),
          pool.query(
            'SELECT id, title, description, category, language, content, created_at, updated_at FROM snippets WHERE user_id = $1 ORDER BY updated_at DESC',
            [user.id]
          ),
          pool.query<{
            id: string;
            note_id: string;
            recipient_email: string;
            permission: string;
            created_at: string | number;
            recipient_name: string | null;
            recipient_user_id: string | null;
          }>(
            `SELECT ns.id, ns.note_id, ns.recipient_email, ns.permission, ns.created_at,
                    u.name AS recipient_name, u.id AS recipient_user_id
             FROM note_shares ns
             LEFT JOIN users u ON LOWER(u.email) = ns.recipient_email
             WHERE ns.owner_user_id = $1
             ORDER BY ns.created_at DESC`,
            [user.id]
          ),
          pool.query<{
            id: string;
            title: string;
            content: string;
            created_at: string | number;
            updated_at: string | number;
            permission: string;
            owner_name: string;
            owner_email: string;
          }>(
            `SELECT n.id, n.title, n.content, n.created_at, n.updated_at,
                    ns.permission, u.name AS owner_name, u.email AS owner_email
             FROM note_shares ns
             JOIN notes n ON n.id = ns.note_id
             JOIN users u ON u.id = ns.owner_user_id
             WHERE ns.recipient_email = $1 AND ns.owner_user_id <> $2
             ORDER BY n.updated_at DESC`,
            [user.email.toLowerCase(), user.id]
          ),
        ]);

      const sharesByNoteId = new Map<
        string,
        Array<{
          id: string;
          noteId: string;
          recipientEmail: string;
          recipientName: string | null;
          recipientUserId: string | null;
          permission: 'view' | 'edit';
          createdAt: number;
        }>
      >();

      for (const s of ownerSharesRes.rows) {
        const list = sharesByNoteId.get(s.note_id) ?? [];
        list.push({
          id: s.id,
          noteId: s.note_id,
          recipientEmail: s.recipient_email,
          recipientName: s.recipient_name,
          recipientUserId: s.recipient_user_id,
          permission: s.permission === 'edit' ? 'edit' : 'view',
          createdAt: Number(s.created_at),
        });
        sharesByNoteId.set(s.note_id, list);
      }

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
          shareToken: r.share_token ?? null,
          linkAccess:
            r.link_access === 'view' || r.link_access === 'edit' ? r.link_access : 'off',
          createdAt: Number(r.created_at),
          updatedAt: Number(r.updated_at),
          shares: sharesByNoteId.get(r.id) ?? [],
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
        sharedNotes: sharedWithMeRes.rows.map((r) => ({
          id: r.id,
          title: r.title,
          content: r.content,
          folderId: null,
          starred: false,
          createdAt: Number(r.created_at),
          updatedAt: Number(r.updated_at),
          isSharedWithMe: true,
          ownerName: r.owner_name,
          ownerEmail: r.owner_email,
          sharedPermission: r.permission === 'edit' ? 'edit' : 'view',
        })),
      });
    } catch (err) {
      console.error('Failed to load workspace from PostgreSQL:', err);
      return res.status(500).json({ error: 'Failed to load workspace' });
    }
  });

  // Refresh notes shared with the signed-in user
  app.get('/api/shared-notes', async (req, res) => {
    try {
      const auth = await requireAuth(req, res);
      if (!auth) return;
      const { pool, user } = auth;

      const sharedWithMeRes = await pool.query<{
        id: string;
        title: string;
        content: string;
        created_at: string | number;
        updated_at: string | number;
        permission: string;
        owner_name: string;
        owner_email: string;
      }>(
        `SELECT n.id, n.title, n.content, n.created_at, n.updated_at,
                ns.permission, u.name AS owner_name, u.email AS owner_email
         FROM note_shares ns
         JOIN notes n ON n.id = ns.note_id
         JOIN users u ON u.id = ns.owner_user_id
         WHERE ns.recipient_email = $1 AND ns.owner_user_id <> $2
         ORDER BY n.updated_at DESC`,
        [user.email.toLowerCase(), user.id]
      );

      return res.json({
        sharedNotes: sharedWithMeRes.rows.map((r) => ({
          id: r.id,
          title: r.title,
          content: r.content,
          folderId: null,
          starred: false,
          createdAt: Number(r.created_at),
          updatedAt: Number(r.updated_at),
          isSharedWithMe: true,
          ownerName: r.owner_name,
          ownerEmail: r.owner_email,
          sharedPermission: r.permission === 'edit' ? 'edit' : 'view',
        })),
      });
    } catch (err) {
      console.error('Failed to load shared notes from PostgreSQL:', err);
      return res.status(500).json({ error: 'Failed to load shared notes' });
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

      const noteCheck = await pool.query<{ user_id: string }>(
        'SELECT user_id FROM notes WHERE id = $1',
        [req.params.id]
      );
      const targetNote = noteCheck.rows[0];
      if (!targetNote) {
        return res.status(404).json({ error: 'Note not found' });
      }

      const isOwner = targetNote.user_id === user.id;
      let canEditShared = false;
      if (!isOwner) {
        const shareCheck = await pool.query<{ permission: string }>(
          'SELECT permission FROM note_shares WHERE note_id = $1 AND recipient_email = $2',
          [req.params.id, user.email.toLowerCase()]
        );
        canEditShared = shareCheck.rows[0]?.permission === 'edit';
      }

      if (!isOwner && !canEditShared) {
        return res.status(403).json({ error: 'Forbidden' });
      }

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
      if (isOwner && folderId !== undefined) {
        values.push(folderId);
        sets.push(`folder_id = $${values.length}`);
      }
      if (isOwner && starred !== undefined) {
        values.push(Boolean(starred));
        sets.push(`starred = $${values.length}`);
      }
      values.push(Number(updatedAt || Date.now()));
      sets.push(`updated_at = $${values.length}`);

      values.push(req.params.id);
      const idIdx = values.length;

      await pool.query(`UPDATE notes SET ${sets.join(', ')} WHERE id = $${idIdx}`, values);
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

  // Note Sharing CRUD (by recipient email)
  app.post('/api/notes/:id/shares', async (req, res) => {
    try {
      const auth = await requireAuth(req, res);
      if (!auth) return;
      const { pool, user } = auth;

      const rawEmail =
        typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
      const permission = req.body?.permission === 'edit' ? 'edit' : 'view';

      if (!isValidEmail(rawEmail)) {
        return res.status(400).json({ error: 'Please enter a valid recipient email address.' });
      }
      if (rawEmail === user.email.toLowerCase()) {
        return res.status(400).json({ error: 'You already own this note.' });
      }

      const ownedNote = await pool.query<{ id: string }>(
        'SELECT id FROM notes WHERE id = $1 AND user_id = $2',
        [req.params.id, user.id]
      );
      if (ownedNote.rows.length === 0) {
        return res.status(404).json({ error: 'Note not found or not owned by you.' });
      }

      const shareId = `shr-${randomUUID()}`;
      const now = Date.now();
      const upsertRes = await pool.query<{ id: string; created_at: string | number }>(
        `INSERT INTO note_shares (id, note_id, owner_user_id, recipient_email, permission, created_at)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (note_id, recipient_email) DO UPDATE SET
           permission = EXCLUDED.permission
         RETURNING id, created_at`,
        [shareId, req.params.id, user.id, rawEmail, permission, now]
      );

      const recipientUser = await pool.query<{ id: string; name: string }>(
        'SELECT id, name FROM users WHERE LOWER(email) = $1',
        [rawEmail]
      );

      return res.status(201).json({
        share: {
          id: upsertRes.rows[0].id,
          noteId: req.params.id,
          recipientEmail: rawEmail,
          recipientName: recipientUser.rows[0]?.name ?? null,
          recipientUserId: recipientUser.rows[0]?.id ?? null,
          permission,
          createdAt: Number(upsertRes.rows[0].created_at),
        },
      });
    } catch (err) {
      console.error('Failed to share note:', err);
      return res.status(500).json({ error: 'Failed to share note.' });
    }
  });

  app.delete('/api/notes/:id/shares/:shareId', async (req, res) => {
    try {
      const auth = await requireAuth(req, res);
      if (!auth) return;
      const { pool, user } = auth;

      await pool.query(
        'DELETE FROM note_shares WHERE id = $1 AND note_id = $2 AND owner_user_id = $3',
        [req.params.shareId, req.params.id, user.id]
      );
      return res.json({ ok: true });
    } catch (err) {
      console.error('Failed to remove note share:', err);
      return res.status(500).json({ error: 'Failed to remove access.' });
    }
  });

  // Manage shareable public link for an owned note
  app.post('/api/notes/:id/share-link', async (req, res) => {
    try {
      const auth = await requireAuth(req, res);
      if (!auth) return;
      const { pool, user } = auth;

      const rawAccess = req.body?.linkAccess;
      const linkAccess: 'off' | 'view' | 'edit' =
        rawAccess === 'off' || rawAccess === 'edit' || rawAccess === 'view'
          ? rawAccess
          : 'view';
      const regenerate = Boolean(req.body?.regenerate);

      const noteRes = await pool.query<{ id: string; share_token: string | null }>(
        'SELECT id, share_token FROM notes WHERE id = $1 AND user_id = $2',
        [req.params.id, user.id]
      );
      const existing = noteRes.rows[0];
      if (!existing) {
        return res.status(404).json({ error: 'Note not found or not owned by you.' });
      }

      const nextToken =
        !existing.share_token || regenerate
          ? randomBytes(12).toString('base64url')
          : existing.share_token;

      await pool.query(
        'UPDATE notes SET share_token = $1, link_access = $2 WHERE id = $3 AND user_id = $4',
        [nextToken, linkAccess, req.params.id, user.id]
      );

      return res.json({
        shareToken: nextToken,
        linkAccess,
      });
    } catch (err) {
      console.error('Failed to update share link:', err);
      return res.status(500).json({ error: 'Failed to update share link.' });
    }
  });

  // Public endpoint: fetch a document via share token
  app.get('/api/shared-link/:token', async (req, res) => {
    const pool = getPool();
    if (!pool) {
      return res.status(503).json({ error: 'PostgreSQL not configured' });
    }

    const token = typeof req.params.token === 'string' ? req.params.token.trim() : '';
    if (!token || token.length > 128) {
      return res.status(400).json({ error: 'Invalid share link.' });
    }

    try {
      await ensureSchema(pool);
      const result = await pool.query<{
        id: string;
        title: string;
        content: string;
        created_at: string | number;
        updated_at: string | number;
        share_token: string;
        link_access: string;
        owner_name: string;
        owner_email: string;
      }>(
        `SELECT n.id, n.title, n.content, n.created_at, n.updated_at,
                n.share_token, n.link_access, u.name AS owner_name, u.email AS owner_email
         FROM notes n
         JOIN users u ON u.id = n.user_id
         WHERE n.share_token = $1 AND n.link_access IN ('view', 'edit')`,
        [token]
      );

      const row = result.rows[0];
      if (!row) {
        return res
          .status(404)
          .json({ error: 'This share link is invalid or has been disabled by the owner.' });
      }

      return res.json({
        note: {
          id: row.id,
          title: row.title,
          content: row.content,
          createdAt: Number(row.created_at),
          updatedAt: Number(row.updated_at),
          shareToken: row.share_token,
          linkAccess: row.link_access === 'edit' ? 'edit' : 'view',
          ownerName: row.owner_name,
          ownerEmail: row.owner_email,
        },
      });
    } catch (err) {
      if (isPgConnectionError(err)) {
        return res.status(503).json({ error: 'PostgreSQL unavailable' });
      }
      console.error('Failed to load shared note by link:', err);
      return res.status(500).json({ error: 'Failed to load shared document.' });
    }
  });

  // Public endpoint: update a document via an editable share token
  app.patch('/api/shared-link/:token', async (req, res) => {
    const pool = getPool();
    if (!pool) {
      return res.status(503).json({ error: 'PostgreSQL not configured' });
    }

    const token = typeof req.params.token === 'string' ? req.params.token.trim() : '';
    if (!token || token.length > 128) {
      return res.status(400).json({ error: 'Invalid share link.' });
    }

    try {
      await ensureSchema(pool);
      const lookup = await pool.query<{ id: string; link_access: string }>(
        `SELECT id, link_access FROM notes WHERE share_token = $1 AND link_access IN ('view', 'edit')`,
        [token]
      );
      const target = lookup.rows[0];
      if (!target) {
        return res
          .status(404)
          .json({ error: 'This share link is invalid or has been disabled by the owner.' });
      }
      if (target.link_access !== 'edit') {
        return res.status(403).json({ error: 'This link only allows viewing.' });
      }

      const { title, content, updatedAt } = req.body || {};
      const sets: string[] = [];
      const values: unknown[] = [];

      if (typeof title === 'string') {
        values.push(title);
        sets.push(`title = $${values.length}`);
      }
      if (typeof content === 'string') {
        values.push(content);
        sets.push(`content = $${values.length}`);
      }

      const nextUpdatedAt = Number(updatedAt || Date.now());
      values.push(nextUpdatedAt);
      sets.push(`updated_at = $${values.length}`);
      values.push(target.id);
      const idIdx = values.length;

      await pool.query(`UPDATE notes SET ${sets.join(', ')} WHERE id = $${idIdx}`, values);
      return res.json({ ok: true, updatedAt: nextUpdatedAt });
    } catch (err) {
      if (isPgConnectionError(err)) {
        return res.status(503).json({ error: 'PostgreSQL unavailable' });
      }
      console.error('Failed to update shared note by link:', err);
      return res.status(500).json({ error: 'Failed to save changes.' });
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
    const pool = getPool();
    if (!pool) {
      return res.status(503).json({ error: 'PostgreSQL not configured' });
    }

    try {
      await ensureSchema(pool);
      const user = await resolveSessionUser(pool, req);
      const rawShareToken =
        typeof req.query?.shareToken === 'string'
          ? req.query.shareToken.trim()
          : typeof req.query?.share === 'string'
          ? req.query.share.trim()
          : '';

      if (!user && !rawShareToken) {
        return res.status(401).json({ error: 'Authentication required' });
      }

      const result = await pool.query<{ data_url: string }>(
        `SELECT ni.data_url
         FROM note_images ni
         WHERE ni.id = $1
           AND (
             ($2::text IS NOT NULL AND ni.user_id = $2)
             OR (
               $3::text IS NOT NULL
               AND EXISTS (
                 SELECT 1
                 FROM note_shares ns
                 JOIN notes n ON n.id = ns.note_id
                 WHERE ns.recipient_email = $3
                   AND n.user_id = ni.user_id
                   AND n.content LIKE '%' || $1 || '%'
               )
             )
             OR (
               $4::text IS NOT NULL
               AND EXISTS (
                 SELECT 1
                 FROM notes n
                 WHERE n.share_token = $4
                   AND n.link_access IN ('view', 'edit')
                   AND n.user_id = ni.user_id
                   AND n.content LIKE '%' || $1 || '%'
               )
             )
           )`,
        [
          req.params.id,
          user?.id ?? null,
          user ? user.email.toLowerCase() : null,
          rawShareToken || null,
        ]
      );
      const row = result.rows[0];
      if (!row) return res.status(404).json({ error: 'Image not found' });
      return res.json({ dataUrl: row.data_url });
    } catch (err) {
      if (isPgConnectionError(err)) {
        return res.status(503).json({ error: 'PostgreSQL unavailable' });
      }
      console.error('Failed to fetch image from PostgreSQL:', err);
      return res.status(500).json({ error: 'Failed to fetch image' });
    }
  });

  // File attachments storage
  app.post('/api/files', async (req, res) => {
    try {
      const auth = await requireAuth(req, res);
      if (!auth) return;
      const { pool, user } = auth;

      const { id, dataUrl, mimeType, name, sizeBytes, createdAt } = req.body || {};
      if (!id || !dataUrl || !name) {
        return res.status(400).json({ error: 'Missing file payload' });
      }

      await pool.query(
        `INSERT INTO note_files (id, user_id, data_url, mime_type, name, size_bytes, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (id) DO NOTHING`,
        [
          id,
          user.id,
          dataUrl,
          mimeType ?? 'application/octet-stream',
          name,
          Number(sizeBytes || 0),
          Number(createdAt || Date.now()),
        ]
      );
      return res.status(201).json({ ok: true });
    } catch (err) {
      console.error('Failed to store file in PostgreSQL:', err);
      return res.status(500).json({ error: 'Failed to save file' });
    }
  });

  app.get('/api/files/:id', async (req, res) => {
    const pool = getPool();
    if (!pool) {
      return res.status(503).json({ error: 'PostgreSQL not configured' });
    }

    try {
      await ensureSchema(pool);
      const user = await resolveSessionUser(pool, req);
      const rawShareToken =
        typeof req.query?.shareToken === 'string'
          ? req.query.shareToken.trim()
          : typeof req.query?.share === 'string'
          ? req.query.share.trim()
          : '';

      if (!user && !rawShareToken) {
        return res.status(401).json({ error: 'Authentication required' });
      }

      const result = await pool.query<{
        data_url: string;
        mime_type: string;
        name: string;
        size_bytes: string | number;
      }>(
        `SELECT nf.data_url, nf.mime_type, nf.name, nf.size_bytes
         FROM note_files nf
         WHERE nf.id = $1
           AND (
             ($2::text IS NOT NULL AND nf.user_id = $2)
             OR (
               $3::text IS NOT NULL
               AND EXISTS (
                 SELECT 1
                 FROM note_shares ns
                 JOIN notes n ON n.id = ns.note_id
                 WHERE ns.recipient_email = $3
                   AND n.user_id = nf.user_id
                   AND n.content LIKE '%' || $1 || '%'
               )
             )
             OR (
               $4::text IS NOT NULL
               AND EXISTS (
                 SELECT 1
                 FROM notes n
                 WHERE n.share_token = $4
                   AND n.link_access IN ('view', 'edit')
                   AND n.user_id = nf.user_id
                   AND n.content LIKE '%' || $1 || '%'
               )
             )
           )`,
        [
          req.params.id,
          user?.id ?? null,
          user ? user.email.toLowerCase() : null,
          rawShareToken || null,
        ]
      );
      const row = result.rows[0];
      if (!row) return res.status(404).json({ error: 'File not found' });
      return res.json({
        dataUrl: row.data_url,
        mimeType: row.mime_type,
        name: row.name,
        sizeBytes: Number(row.size_bytes),
      });
    } catch (err) {
      if (isPgConnectionError(err)) {
        return res.status(503).json({ error: 'PostgreSQL unavailable' });
      }
      console.error('Failed to fetch file from PostgreSQL:', err);
      return res.status(500).json({ error: 'Failed to fetch file' });
    }
  });

  // AI: list available Groq models
  app.get('/api/ai/models', async (_req, res) => {
    try {
      const catalog = await listAvailableGroqModels();
      return res.json(catalog);
    } catch (err) {
      console.error('Failed to list Groq models:', err);
      return res.status(500).json({ error: 'Failed to load AI models' });
    }
  });

  // AI: improve spelling & grammar using Groq AI
  app.post('/api/ai/proofread', async (req, res) => {
    try {
      const { text, mode, model } = (req.body || {}) as {
        text?: unknown;
        mode?: unknown;
        model?: unknown;
      };
      if (typeof text !== 'string' || !text.trim()) {
        return res.status(400).json({ error: 'Text to proofread is required' });
      }
      if (text.length > 30000) {
        return res.status(400).json({
          error: 'Text exceeds the 30,000 character limit. Try proofreading a smaller section.',
        });
      }

      const validMode: ProofreadMode =
        mode === 'spelling' || mode === 'clarity' || mode === 'proofread'
          ? mode
          : 'proofread';

      const result = await proofreadWithGroq({
        text,
        mode: validMode,
        model: typeof model === 'string' ? model : undefined,
      });
      return res.json(result);
    } catch (err) {
      if (err instanceof GroqProofreadError) {
        return res.status(err.status).json({ error: err.message });
      }
      console.error('Groq AI proofread failed:', err);
      return res.status(500).json({ error: 'Failed to proofread text with Groq AI' });
    }
  });

  // AI: write a whole document or explain project context using Groq AI
  app.post('/api/ai/generate-document', async (req, res) => {
    try {
      const {
        prompt,
        model,
        docType,
        length,
        includeTables,
        includeDiagrams,
        includeCode,
        existingTitle,
        existingContent,
        projectFolderName,
        projectNotes,
      } = (req.body || {}) as {
        prompt?: unknown;
        model?: unknown;
        docType?: unknown;
        length?: unknown;
        includeTables?: unknown;
        includeDiagrams?: unknown;
        includeCode?: unknown;
        existingTitle?: unknown;
        existingContent?: unknown;
        projectFolderName?: unknown;
        projectNotes?: unknown;
      };

      if (typeof prompt !== 'string' || !prompt.trim()) {
        return res.status(400).json({ error: 'Describe what document or question you need first' });
      }
      if (prompt.length > 8000) {
        return res.status(400).json({
          error: 'Prompt exceeds the 8,000 character limit.',
        });
      }

      const validDocType: GenerateDocType =
        docType === 'explain' ||
        docType === 'spec' ||
        docType === 'runbook' ||
        docType === 'api' ||
        docType === 'meeting' ||
        docType === 'guide' ||
        docType === 'general'
          ? docType
          : 'general';

      const validLength: GenerateDocLength =
        length === 'concise' || length === 'standard' || length === 'detailed'
          ? length
          : 'standard';

      const sanitizedProjectNotes = Array.isArray(projectNotes)
        ? projectNotes
            .slice(0, 20)
            .filter(
              (item): item is { title?: unknown; folderName?: unknown; content?: unknown } =>
                Boolean(item && typeof item === 'object')
            )
            .map((item) => ({
              title: typeof item.title === 'string' ? item.title.slice(0, 200) : 'Untitled Note',
              folderName:
                typeof item.folderName === 'string' ? item.folderName.slice(0, 120) : undefined,
              content:
                typeof item.content === 'string' ? item.content.slice(0, 12000) : '',
            }))
            .filter((item) => item.content.trim().length > 0)
        : undefined;

      const result = await generateDocumentWithGroq({
        prompt,
        model: typeof model === 'string' ? model : undefined,
        docType: validDocType,
        length: validLength,
        includeTables: Boolean(includeTables),
        includeDiagrams: Boolean(includeDiagrams),
        includeCode: Boolean(includeCode),
        existingTitle: typeof existingTitle === 'string' ? existingTitle : undefined,
        existingContent:
          typeof existingContent === 'string' ? existingContent.slice(0, 30000) : undefined,
        projectFolderName:
          typeof projectFolderName === 'string' ? projectFolderName.slice(0, 120) : undefined,
        projectNotes: sanitizedProjectNotes,
      });
      return res.json(result);
    } catch (err) {
      if (err instanceof GroqProofreadError) {
        return res.status(err.status).json({ error: err.message });
      }
      console.error('Groq AI document generation failed:', err);
      return res.status(500).json({ error: 'Failed to generate document with Groq AI' });
    }
  });

  // SSH saved server profiles CRUD
  app.get('/api/ssh/profiles', async (req, res) => {
    try {
      const auth = await requireAuth(req, res);
      if (!auth) return;
      const { pool, user } = auth;

      const result = await pool.query<{
        id: string;
        label: string;
        host: string;
        port: number;
        username: string;
        auth_type: string;
        last_connected_at: string | number | null;
        created_at: string | number;
      }>(
        `SELECT id, label, host, port, username, auth_type, last_connected_at, created_at
         FROM ssh_profiles
         WHERE user_id = $1
         ORDER BY COALESCE(last_connected_at, created_at) DESC`,
        [user.id]
      );

      return res.json({
        profiles: result.rows.map((r) => ({
          id: r.id,
          label: r.label,
          host: r.host,
          port: Number(r.port || 22),
          username: r.username,
          authType: r.auth_type === 'privateKey' ? 'privateKey' : 'password',
          lastConnectedAt: r.last_connected_at ? Number(r.last_connected_at) : null,
          createdAt: Number(r.created_at),
        })),
      });
    } catch (err) {
      console.error('Failed to load SSH profiles:', err);
      return res.status(500).json({ error: 'Failed to load saved SSH servers' });
    }
  });

  app.post('/api/ssh/profiles', async (req, res) => {
    try {
      const auth = await requireAuth(req, res);
      if (!auth) return;
      const { pool, user } = auth;

      const { id, label, host, port, username, authType, lastConnectedAt, createdAt } =
        req.body || {};
      const cleanHost = typeof host === 'string' ? host.trim() : '';
      const cleanUser = typeof username === 'string' ? username.trim() : '';
      if (!cleanHost || !cleanUser) {
        return res.status(400).json({ error: 'Host and username are required' });
      }
      const cleanPort = Math.max(1, Math.min(65535, Math.round(Number(port || 22))));
      const cleanLabel =
        typeof label === 'string' && label.trim()
          ? label.trim()
          : `${cleanUser}@${cleanHost}`;
      const cleanAuthType = authType === 'privateKey' ? 'privateKey' : 'password';
      const profileId =
        typeof id === 'string' && id.trim() ? id.trim() : `ssh-${randomUUID()}`;
      const now = Date.now();

      await pool.query(
        `INSERT INTO ssh_profiles (id, user_id, label, host, port, username, auth_type, last_connected_at, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (id) DO UPDATE SET
           label = EXCLUDED.label,
           host = EXCLUDED.host,
           port = EXCLUDED.port,
           username = EXCLUDED.username,
           auth_type = EXCLUDED.auth_type,
           last_connected_at = COALESCE(EXCLUDED.last_connected_at, ssh_profiles.last_connected_at)
         WHERE ssh_profiles.user_id = EXCLUDED.user_id`,
        [
          profileId,
          user.id,
          cleanLabel,
          cleanHost,
          cleanPort,
          cleanUser,
          cleanAuthType,
          lastConnectedAt ? Number(lastConnectedAt) : null,
          Number(createdAt || now),
        ]
      );

      return res.status(201).json({
        profile: {
          id: profileId,
          label: cleanLabel,
          host: cleanHost,
          port: cleanPort,
          username: cleanUser,
          authType: cleanAuthType,
          lastConnectedAt: lastConnectedAt ? Number(lastConnectedAt) : null,
          createdAt: Number(createdAt || now),
        },
      });
    } catch (err) {
      console.error('Failed to save SSH profile:', err);
      return res.status(500).json({ error: 'Failed to save SSH server profile' });
    }
  });

  app.delete('/api/ssh/profiles/:id', async (req, res) => {
    try {
      const auth = await requireAuth(req, res);
      if (!auth) return;
      const { pool, user } = auth;

      await pool.query('DELETE FROM ssh_profiles WHERE id = $1 AND user_id = $2', [
        req.params.id,
        user.id,
      ]);
      return res.json({ ok: true });
    } catch (err) {
      console.error('Failed to delete SSH profile:', err);
      return res.status(500).json({ error: 'Failed to delete SSH server profile' });
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

  const httpServer = createHttpServer(app);
  attachSshWebSocketServer(httpServer, getPool);

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`NoteCraft server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer();
