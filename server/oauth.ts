import type { Express, Request, Response } from 'express';
import type { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import {
  buildSessionCookie,
  generateSessionToken,
  hashPassword,
  hashSessionToken,
  SESSION_TTL_MS,
} from './auth.ts';
import { ensureSchema } from './db.ts';

export function registerOAuthRoutes(
  app: Express,
  getPoolFn: () => Pool | null
) {
  // --- Google OAuth ---
  app.get('/api/auth/google', (req: Request, res: Response) => {
    const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
    if (!clientId) {
      return res.status(503).json({
        error: 'GOOGLE_CLIENT_ID is not configured on the server environment.',
      });
    }
    const hostUrl = process.env.APP_URL || `${req.protocol}://${req.get('host')}`;
    const redirectUri = `${hostUrl}/api/auth/google/callback`;
    const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${encodeURIComponent(
      clientId
    )}&redirect_uri=${encodeURIComponent(
      redirectUri
    )}&response_type=code&scope=openid%20email%20profile`;
    return res.redirect(authUrl);
  });

  app.get('/api/auth/google/callback', async (req: Request, res: Response) => {
    const code = req.query.code as string;
    if (!code) {
      return res.redirect('/?error=google_auth_failed');
    }

    const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
    const hostUrl = process.env.APP_URL || `${req.protocol}://${req.get('host')}`;
    const redirectUri = `${hostUrl}/api/auth/google/callback`;

    if (!clientId || !clientSecret) {
      return res.redirect('/?error=google_not_configured');
    }

    try {
      // 1. Exchange code for token
      const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code,
          client_id: clientId,
          client_secret: clientSecret,
          redirect_uri: redirectUri,
          grant_type: 'authorization_code',
        }),
      });

      const tokenData = (await tokenRes.json()) as { access_token?: string; error?: string };
      if (!tokenRes.ok || !tokenData.access_token) {
        return res.redirect('/?error=google_token_error');
      }

      // 2. Fetch user profile
      const profileRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
        headers: { Authorization: `Bearer ${tokenData.access_token}` },
      });
      const profileData = (await profileRes.json()) as {
        email?: string;
        name?: string;
      };

      if (!profileRes.ok || !profileData.email) {
        return res.redirect('/?error=google_profile_error');
      }

      const email = profileData.email.toLowerCase();
      const name = profileData.name || email.split('@')[0];

      // 3. Provision or login user in DB / session
      await handleOAuthLoginOrRegister(getPoolFn, req, res, { email, name });
    } catch (err) {
      console.error('Google OAuth callback error:', err);
      return res.redirect('/?error=google_exception');
    }
  });

  // --- GitHub OAuth ---
  app.get('/api/auth/github', (req: Request, res: Response) => {
    const clientId = process.env.GITHUB_CLIENT_ID?.trim();
    if (!clientId) {
      return res.status(503).json({
        error: 'GITHUB_CLIENT_ID is not configured on the server environment.',
      });
    }
    const hostUrl = process.env.APP_URL || `${req.protocol}://${req.get('host')}`;
    const redirectUri = `${hostUrl}/api/auth/github/callback`;
    const authUrl = `https://github.com/login/oauth/authorize?client_id=${encodeURIComponent(
      clientId
    )}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=user:email`;
    return res.redirect(authUrl);
  });

  app.get('/api/auth/github/callback', async (req: Request, res: Response) => {
    const code = req.query.code as string;
    if (!code) {
      return res.redirect('/?error=github_auth_failed');
    }

    const clientId = process.env.GITHUB_CLIENT_ID?.trim();
    const clientSecret = process.env.GITHUB_CLIENT_SECRET?.trim();
    const hostUrl = process.env.APP_URL || `${req.protocol}://${req.get('host')}`;
    const redirectUri = `${hostUrl}/api/auth/github/callback`;

    if (!clientId || !clientSecret) {
      return res.redirect('/?error=github_not_configured');
    }

    try {
      // 1. Exchange code for token
      const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          client_id: clientId,
          client_secret: clientSecret,
          code,
          redirect_uri: redirectUri,
        }),
      });

      const tokenData = (await tokenRes.json()) as { access_token?: string; error?: string };
      if (!tokenRes.ok || !tokenData.access_token) {
        return res.redirect('/?error=github_token_error');
      }

      // 2. Fetch GitHub profile
      const profileRes = await fetch('https://api.github.com/user', {
        headers: {
          Authorization: `Bearer ${tokenData.access_token}`,
          'User-Agent': 'NoteCraft-App',
          Accept: 'application/json',
        },
      });
      const profileData = (await profileRes.json()) as {
        id?: number;
        name?: string;
        login?: string;
        email?: string | null;
      };

      if (!profileRes.ok) {
        return res.redirect('/?error=github_profile_error');
      }

      let email = profileData.email ? profileData.email.toLowerCase() : null;

      // If primary email is private, fetch emails list
      if (!email) {
        const emailsRes = await fetch('https://api.github.com/user/emails', {
          headers: {
            Authorization: `Bearer ${tokenData.access_token}`,
            'User-Agent': 'NoteCraft-App',
            Accept: 'application/json',
          },
        });
        if (emailsRes.ok) {
          const emailsList = (await emailsRes.json()) as Array<{
            email: string;
            primary: boolean;
            verified: boolean;
          }>;
          const primary = emailsList.find((e) => e.primary && e.verified);
          if (primary) {
            email = primary.email.toLowerCase();
          } else if (emailsList[0]) {
            email = emailsList[0].email.toLowerCase();
          }
        }
      }

      if (!email) {
        email = `${profileData.login || 'github-user'}@users.noreply.github.com`;
      }

      const name = profileData.name || profileData.login || 'GitHub User';

      // 3. Provision or login user in DB / session
      await handleOAuthLoginOrRegister(getPoolFn, req, res, { email, name });
    } catch (err) {
      console.error('GitHub OAuth callback error:', err);
      return res.redirect('/?error=github_exception');
    }
  });
}

async function handleOAuthLoginOrRegister(
  getPoolFn: () => Pool | null,
  req: Request,
  res: Response,
  profile: { email: string; name: string }
) {
  const pool = getPoolFn();
  const now = Date.now();

  if (pool) {
    try {
      await ensureSchema(pool);
      // Check if user exists
      let userRes = await pool.query<{ id: string; name: string; email: string }>(
        'SELECT id, name, email FROM users WHERE email = $1',
        [profile.email]
      );

      let userId: string;
      if (userRes.rows.length > 0) {
        userId = userRes.rows[0].id;
      } else {
        userId = `usr-oauth-${randomUUID()}`;
        const dummyHash = hashPassword(randomUUID());
        await pool.query(
          'INSERT INTO users (id, email, name, password_hash, created_at) VALUES ($1, $2, $3, $4, $5)',
          [userId, profile.email, profile.name, dummyHash, now]
        );
      }

      const token = generateSessionToken();
      const tokenHash = hashSessionToken(token);
      const expiresAt = now + SESSION_TTL_MS;

      await pool.query(
        'INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES ($1, $2, $3, $4)',
        [tokenHash, userId, now, expiresAt]
      );

      res.setHeader('Set-Cookie', buildSessionCookie(token, req));
      return res.redirect('/');
    } catch (err) {
      console.error('Database error in OAuth login:', err);
      return res.redirect('/?error=db_error');
    }
  }

  // Fallback if Postgres is not configured (mock session redirect)
  return res.redirect('/');
}
