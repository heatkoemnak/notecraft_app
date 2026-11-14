import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { ensureSchema, getPool } from './server/db.ts';

const PORT = Number(process.env.PORT || 3000);
const isProduction = process.env.NODE_ENV === 'production';

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

  // Load full workspace
  app.get('/api/workspace', async (_req, res) => {
    const pool = getPool();
    if (!pool) {
      return res.status(503).json({ error: 'PostgreSQL not configured' });
    }
    try {
      await ensureSchema(pool);
      const [foldersRes, notesRes, snippetsRes] = await Promise.all([
        pool.query('SELECT id, name, created_at FROM folders ORDER BY created_at ASC'),
        pool.query(
          'SELECT id, title, content, folder_id, starred, created_at, updated_at FROM notes ORDER BY updated_at DESC'
        ),
        pool.query(
          'SELECT id, title, description, category, language, content, created_at, updated_at FROM snippets ORDER BY updated_at DESC'
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
    const pool = getPool();
    if (!pool) return res.status(503).json({ error: 'PostgreSQL not configured' });
    const { id, name, createdAt } = req.body || {};
    if (!id || !name) return res.status(400).json({ error: 'Missing folder fields' });

    try {
      await ensureSchema(pool);
      await pool.query(
        'INSERT INTO folders (id, name, created_at) VALUES ($1, $2, $3) ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name',
        [id, name, Number(createdAt || Date.now())]
      );
      return res.status(201).json({ ok: true });
    } catch (err) {
      console.error('Failed to create folder:', err);
      return res.status(500).json({ error: 'Failed to save folder' });
    }
  });

  app.patch('/api/folders/:id', async (req, res) => {
    const pool = getPool();
    if (!pool) return res.status(503).json({ error: 'PostgreSQL not configured' });
    const { name } = req.body || {};
    if (!name) return res.status(400).json({ error: 'Missing folder name' });

    try {
      await ensureSchema(pool);
      await pool.query('UPDATE folders SET name = $1 WHERE id = $2', [name, req.params.id]);
      return res.json({ ok: true });
    } catch (err) {
      console.error('Failed to rename folder:', err);
      return res.status(500).json({ error: 'Failed to rename folder' });
    }
  });

  app.delete('/api/folders/:id', async (req, res) => {
    const pool = getPool();
    if (!pool) return res.status(503).json({ error: 'PostgreSQL not configured' });

    try {
      await ensureSchema(pool);
      await pool.query('DELETE FROM folders WHERE id = $1', [req.params.id]);
      return res.json({ ok: true });
    } catch (err) {
      console.error('Failed to delete folder:', err);
      return res.status(500).json({ error: 'Failed to delete folder' });
    }
  });

  // Notes CRUD
  app.post('/api/notes', async (req, res) => {
    const pool = getPool();
    if (!pool) return res.status(503).json({ error: 'PostgreSQL not configured' });
    const { id, title, content, folderId, starred, createdAt, updatedAt } = req.body || {};
    if (!id) return res.status(400).json({ error: 'Missing note id' });

    try {
      await ensureSchema(pool);
      await pool.query(
        `INSERT INTO notes (id, title, content, folder_id, starred, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (id) DO UPDATE SET
           title = EXCLUDED.title,
           content = EXCLUDED.content,
           folder_id = EXCLUDED.folder_id,
           starred = EXCLUDED.starred,
           updated_at = EXCLUDED.updated_at`,
        [
          id,
          title ?? '',
          content ?? '',
          folderId ?? null,
          Boolean(starred),
          Number(createdAt || Date.now()),
          Number(updatedAt || Date.now()),
        ]
      );
      return res.status(201).json({ ok: true });
    } catch (err) {
      console.error('Failed to save note:', err);
      return res.status(500).json({ error: 'Failed to save note' });
    }
  });

  app.patch('/api/notes/:id', async (req, res) => {
    const pool = getPool();
    if (!pool) return res.status(503).json({ error: 'PostgreSQL not configured' });
    const { title, content, folderId, starred, updatedAt } = req.body || {};

    try {
      await ensureSchema(pool);
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
      await pool.query(
        `UPDATE notes SET ${sets.join(', ')} WHERE id = $${values.length}`,
        values
      );
      return res.json({ ok: true });
    } catch (err) {
      console.error('Failed to update note:', err);
      return res.status(500).json({ error: 'Failed to update note' });
    }
  });

  app.delete('/api/notes/:id', async (req, res) => {
    const pool = getPool();
    if (!pool) return res.status(503).json({ error: 'PostgreSQL not configured' });

    try {
      await ensureSchema(pool);
      await pool.query('DELETE FROM notes WHERE id = $1', [req.params.id]);
      return res.json({ ok: true });
    } catch (err) {
      console.error('Failed to delete note:', err);
      return res.status(500).json({ error: 'Failed to delete note' });
    }
  });

  // Snippets CRUD
  app.post('/api/snippets', async (req, res) => {
    const pool = getPool();
    if (!pool) return res.status(503).json({ error: 'PostgreSQL not configured' });
    const { id, title, description, category, language, content, createdAt, updatedAt } =
      req.body || {};
    if (!id || !title) return res.status(400).json({ error: 'Missing snippet fields' });

    try {
      await ensureSchema(pool);
      await pool.query(
        `INSERT INTO snippets (id, title, description, category, language, content, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (id) DO UPDATE SET
           title = EXCLUDED.title,
           description = EXCLUDED.description,
           category = EXCLUDED.category,
           language = EXCLUDED.language,
           content = EXCLUDED.content,
           updated_at = EXCLUDED.updated_at`,
        [
          id,
          title,
          description ?? '',
          category ?? 'General',
          language ?? 'text',
          content ?? '',
          Number(createdAt || Date.now()),
          Number(updatedAt || Date.now()),
        ]
      );
      return res.status(201).json({ ok: true });
    } catch (err) {
      console.error('Failed to save snippet:', err);
      return res.status(500).json({ error: 'Failed to save snippet' });
    }
  });

  app.delete('/api/snippets/:id', async (req, res) => {
    const pool = getPool();
    if (!pool) return res.status(503).json({ error: 'PostgreSQL not configured' });

    try {
      await ensureSchema(pool);
      await pool.query('DELETE FROM snippets WHERE id = $1', [req.params.id]);
      return res.json({ ok: true });
    } catch (err) {
      console.error('Failed to delete snippet:', err);
      return res.status(500).json({ error: 'Failed to delete snippet' });
    }
  });

  // Images storage
  app.post('/api/images', async (req, res) => {
    const pool = getPool();
    if (!pool) return res.status(503).json({ error: 'PostgreSQL not configured' });
    const { id, dataUrl, mimeType, name, createdAt } = req.body || {};
    if (!id || !dataUrl) return res.status(400).json({ error: 'Missing image payload' });

    try {
      await ensureSchema(pool);
      await pool.query(
        `INSERT INTO note_images (id, data_url, mime_type, name, created_at)
         VALUES ($1, $2, $3, $4, $5) ON CONFLICT (id) DO NOTHING`,
        [id, dataUrl, mimeType ?? 'image/png', name ?? 'image.png', Number(createdAt || Date.now())]
      );
      return res.status(201).json({ ok: true });
    } catch (err) {
      console.error('Failed to store image in PostgreSQL:', err);
      return res.status(500).json({ error: 'Failed to save image' });
    }
  });

  app.get('/api/images/:id', async (req, res) => {
    const pool = getPool();
    if (!pool) return res.status(503).json({ error: 'PostgreSQL not configured' });

    try {
      await ensureSchema(pool);
      const result = await pool.query<{ data_url: string }>(
        'SELECT data_url FROM note_images WHERE id = $1',
        [req.params.id]
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
