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
import { ensureSchema, seedUserWorkspace } from './db.ts';

export function getHostUrl(req: Request): string {
  const forwardedHost = req.headers['x-forwarded-host'];
  const host =
    typeof forwardedHost === 'string'
      ? forwardedHost.split(',')[0].trim()
      : req.get('host');

  const forwardedProto = req.headers['x-forwarded-proto'];
  const proto =
    typeof forwardedProto === 'string'
      ? forwardedProto.split(',')[0].trim()
      : req.secure || (host && !host.includes('localhost'))
      ? 'https'
      : req.protocol || 'http';

  if (host && !host.includes('localhost') && !host.includes('127.0.0.1')) {
    return `${proto}://${host}`.replace(/\/+$/, '');
  }

  const envUrl = process.env.APP_URL?.trim();
  if (
    envUrl &&
    !envUrl.includes('your-app-domain') &&
    !envUrl.includes('example.com') &&
    envUrl.startsWith('http')
  ) {
    return envUrl.replace(/\/+$/, '');
  }

  return `${proto}://${host || 'localhost:3000'}`.replace(/\/+$/, '');
}

export function registerOAuthRoutes(
  app: Express,
  getPoolFn: () => Pool | null
) {
  // --- OAuth Status Endpoint ---
  app.get('/api/auth/oauth-status', (req: Request, res: Response) => {
    const hostUrl = getHostUrl(req);
    const googleClientId = process.env.GOOGLE_CLIENT_ID?.trim();
    const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
    const githubClientId = process.env.GITHUB_CLIENT_ID?.trim();
    const githubClientSecret = process.env.GITHUB_CLIENT_SECRET?.trim();

    const isPlaceholder = (val?: string) =>
      !val ||
      val.includes('your_google_client_id') ||
      val.includes('your_github_client_id') ||
      val.includes('your_google_client_secret') ||
      val.includes('your_github_client_secret');

    const googleValid = Boolean(googleClientId && googleClientSecret && !isPlaceholder(googleClientId));
    const githubValid = Boolean(githubClientId && githubClientSecret && !isPlaceholder(githubClientId));

    res.json({
      googleConfigured: googleValid,
      githubConfigured: githubValid,
      googleClientId: googleValid ? googleClientId : null,
      githubClientId: githubValid ? githubClientId : null,
      appUrl: hostUrl,
      googleCallbackUrl: `${hostUrl}/api/auth/google/callback`,
      githubCallbackUrl: `${hostUrl}/api/auth/github/callback`,
    });
  });

  // --- Google OAuth URL ---
  app.get('/api/auth/google/url', (req: Request, res: Response) => {
    const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
    if (!clientId) {
      return res.status(503).json({
        error: 'GOOGLE_CLIENT_ID is not configured on the server environment.',
      });
    }
    const hostUrl = getHostUrl(req);
    const redirectUri = `${hostUrl}/api/auth/google/callback`;
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'openid email profile',
      prompt: 'select_account',
      access_type: 'offline',
    });
    const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
    return res.json({ url: authUrl, redirectUri });
  });

  // --- Google OAuth Direct Redirect ---
  app.get('/api/auth/google', (req: Request, res: Response) => {
    const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
    if (!clientId) {
      return res.status(503).json({
        error: 'GOOGLE_CLIENT_ID is not configured on the server environment.',
      });
    }
    const hostUrl = getHostUrl(req);
    const redirectUri = `${hostUrl}/api/auth/google/callback`;
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'openid email profile',
      prompt: 'select_account',
      access_type: 'offline',
    });
    return res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`);
  });

  // --- Google OAuth Callback ---
  const handleGoogleCallback = async (req: Request, res: Response) => {
    const errorParam = req.query.error as string;
    if (errorParam) {
      return renderOAuthResult(res, {
        success: false,
        error: `Google sign-in was cancelled or denied: ${errorParam}`,
      });
    }

    const code = req.query.code as string;
    if (!code) {
      return renderOAuthResult(res, {
        success: false,
        error: 'Missing authorization code from Google OAuth.',
      });
    }

    const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
    const hostUrl = getHostUrl(req);
    const redirectUri = `${hostUrl}/api/auth/google/callback`;

    if (!clientId || !clientSecret) {
      return renderOAuthResult(res, {
        success: false,
        error: 'GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET is missing from server environment.',
      });
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

      const tokenData = (await tokenRes.json()) as {
        access_token?: string;
        error?: string;
        error_description?: string;
      };

      if (!tokenRes.ok || !tokenData.access_token) {
        return renderOAuthResult(res, {
          success: false,
          error: `Google token exchange failed: ${tokenData.error_description || tokenData.error || tokenRes.statusText}`,
          hint: `Check that your authorized redirect URI in Google Cloud Console is exactly: ${redirectUri}`,
        });
      }

      // 2. Fetch user profile
      const profileRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
        headers: { Authorization: `Bearer ${tokenData.access_token}` },
      });
      const profileData = (await profileRes.json()) as {
        email?: string;
        name?: string;
        picture?: string;
      };

      if (!profileRes.ok || !profileData.email) {
        return renderOAuthResult(res, {
          success: false,
          error: 'Could not retrieve profile information from Google account.',
        });
      }

      const email = profileData.email.toLowerCase();
      const name = profileData.name || email.split('@')[0];

      // 3. Establish user session
      await handleOAuthLoginOrRegister(getPoolFn, req, res, { email, name });
    } catch (err) {
      console.error('Google OAuth callback error:', err);
      return renderOAuthResult(res, {
        success: false,
        error: err instanceof Error ? err.message : 'Unknown error during Google authentication.',
      });
    }
  };

  app.get('/api/auth/google/callback', handleGoogleCallback);
  app.get('/api/auth/google/callback/', handleGoogleCallback);

  // --- GitHub OAuth URL ---
  app.get('/api/auth/github/url', (req: Request, res: Response) => {
    const clientId = process.env.GITHUB_CLIENT_ID?.trim();
    if (!clientId) {
      return res.status(503).json({
        error: 'GITHUB_CLIENT_ID is not configured on the server environment.',
      });
    }
    const hostUrl = getHostUrl(req);
    const redirectUri = `${hostUrl}/api/auth/github/callback`;
    const params = new URLSearchParams({
      client_id: clientId,
      scope: 'read:user user:email',
      prompt: 'consent',
    });

    // GitHub's OAuth server displays "The redirect_uri is not associated with this application"
    // if redirect_uri does not strictly match the single callback URL registered in the GitHub OAuth app.
    // When redirect_uri is omitted, GitHub defaults to the registered Authorization callback URL.
    const appUrlEnv = process.env.APP_URL?.trim();
    let isAppUrlMatch = false;
    if (appUrlEnv) {
      try {
        isAppUrlMatch = hostUrl.includes(new URL(appUrlEnv).hostname);
      } catch {
        isAppUrlMatch = false;
      }
    }

    if (req.query.include_redirect_uri === 'true' || isAppUrlMatch) {
      params.set('redirect_uri', redirectUri);
    }

    const authUrl = `https://github.com/login/oauth/authorize?${params.toString()}`;
    return res.json({ url: authUrl, redirectUri });
  });

  // --- GitHub OAuth Direct Redirect ---
  app.get('/api/auth/github', (req: Request, res: Response) => {
    const clientId = process.env.GITHUB_CLIENT_ID?.trim();
    if (!clientId) {
      return res.status(503).json({
        error: 'GITHUB_CLIENT_ID is not configured on the server environment.',
      });
    }
    const hostUrl = getHostUrl(req);
    const redirectUri = `${hostUrl}/api/auth/github/callback`;
    const params = new URLSearchParams({
      client_id: clientId,
      scope: 'read:user user:email',
      prompt: 'consent',
    });

    const appUrlEnv = process.env.APP_URL?.trim();
    let isAppUrlMatch = false;
    if (appUrlEnv) {
      try {
        isAppUrlMatch = hostUrl.includes(new URL(appUrlEnv).hostname);
      } catch {
        isAppUrlMatch = false;
      }
    }

    if (req.query.include_redirect_uri === 'true' || isAppUrlMatch) {
      params.set('redirect_uri', redirectUri);
    }

    return res.redirect(`https://github.com/login/oauth/authorize?${params.toString()}`);
  });

  // --- GitHub OAuth Callback ---
  const handleGithubCallback = async (req: Request, res: Response) => {
    const errorParam = req.query.error as string;
    if (errorParam) {
      return renderOAuthResult(res, {
        success: false,
        error: `GitHub sign-in was cancelled or denied: ${errorParam}`,
      });
    }

    const code = req.query.code as string;
    if (!code) {
      return renderOAuthResult(res, {
        success: false,
        error: 'Missing authorization code from GitHub OAuth.',
      });
    }

    const clientId = process.env.GITHUB_CLIENT_ID?.trim();
    const clientSecret = process.env.GITHUB_CLIENT_SECRET?.trim();
    const hostUrl = getHostUrl(req);
    const redirectUri = `${hostUrl}/api/auth/github/callback`;

    if (!clientId || !clientSecret) {
      return renderOAuthResult(res, {
        success: false,
        error: 'GITHUB_CLIENT_ID or GITHUB_CLIENT_SECRET is missing from server environment.',
      });
    }

    try {
      // 1. Exchange code for token
      const tokenBody: Record<string, string> = {
        client_id: clientId,
        client_secret: clientSecret,
        code,
      };

      // Only pass redirect_uri if explicitly requested or on matching host
      const appUrlEnv = process.env.APP_URL?.trim();
      let isAppUrlMatch = false;
      if (appUrlEnv) {
        try {
          isAppUrlMatch = hostUrl.includes(new URL(appUrlEnv).hostname);
        } catch {
          isAppUrlMatch = false;
        }
      }

      if (isAppUrlMatch || req.query.redirect_uri) {
        tokenBody.redirect_uri = (req.query.redirect_uri as string) || redirectUri;
      }

      const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(tokenBody),
      });

      const tokenData = (await tokenRes.json()) as {
        access_token?: string;
        error?: string;
        error_description?: string;
      };

      if (!tokenRes.ok || !tokenData.access_token) {
        return renderOAuthResult(res, {
          success: false,
          error: `GitHub token exchange failed: ${tokenData.error_description || tokenData.error || tokenRes.statusText}`,
          hint: `Ensure the Authorization callback URL in GitHub Developer Settings is: ${redirectUri}`,
        });
      }

      // 2. Fetch GitHub user profile
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
        return renderOAuthResult(res, {
          success: false,
          error: 'Could not fetch profile from GitHub API.',
        });
      }

      let email = profileData.email ? profileData.email.toLowerCase() : null;

      // If primary email is hidden/private, fetch emails list
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

      // 3. Establish user session
      await handleOAuthLoginOrRegister(getPoolFn, req, res, { email, name });
    } catch (err) {
      console.error('GitHub OAuth callback error:', err);
      return renderOAuthResult(res, {
        success: false,
        error: err instanceof Error ? err.message : 'Unknown error during GitHub authentication.',
      });
    }
  };

  app.get('/api/auth/github/callback', handleGithubCallback);
  app.get('/api/auth/github/callback/', handleGithubCallback);
}

async function handleOAuthLoginOrRegister(
  getPoolFn: () => Pool | null,
  req: Request,
  res: Response,
  profile: { email: string; name: string }
) {
  const pool = getPoolFn();
  const now = Date.now();
  let userId: string;

  if (pool) {
    try {
      await ensureSchema(pool);
      // Check if user already exists
      const userRes = await pool.query<{ id: string; name: string; email: string }>(
        'SELECT id, name, email FROM users WHERE email = $1',
        [profile.email]
      );

      if (userRes.rows.length > 0) {
        userId = userRes.rows[0].id;
        // Optionally update name if needed
        await pool.query('UPDATE users SET name = $1 WHERE id = $2', [profile.name, userId]);
      } else {
        userId = `usr-oauth-${randomUUID()}`;
        const dummyHash = hashPassword(randomUUID());
        await pool.query(
          'INSERT INTO users (id, email, name, password_hash, created_at) VALUES ($1, $2, $3, $4, $5)',
          [userId, profile.email, profile.name, dummyHash, now]
        );
        await seedUserWorkspace(pool, userId);
      }

      const token = generateSessionToken();
      const tokenHash = hashSessionToken(token);
      const expiresAt = now + SESSION_TTL_MS;

      await pool.query(
        'INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES ($1, $2, $3, $4)',
        [tokenHash, userId, now, expiresAt]
      );

      res.setHeader('Set-Cookie', buildSessionCookie(token, req));
    } catch (err) {
      console.error('Database error in OAuth login:', err);
      return renderOAuthResult(res, {
        success: false,
        error: 'Database error saving OAuth user session.',
      });
    }
  } else {
    // Standalone or local mode
    userId = `usr-oauth-${randomUUID()}`;
  }

  const authenticatedUser = {
    id: userId,
    name: profile.name,
    email: profile.email,
    createdAt: now,
  };

  return renderOAuthResult(res, {
    success: true,
    user: authenticatedUser,
  });
}

function renderOAuthResult(
  res: Response,
  data:
    | { success: true; user: { id: string; name: string; email: string; createdAt: number } }
    | { success: false; error: string; hint?: string }
) {
  if (data.success) {
    const userJson = JSON.stringify(data.user);
    const html = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>NoteCraft - Signed In</title>
    <style>
      body {
        margin: 0;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        display: flex;
        align-items: center;
        justify-content: center;
        min-height: 100vh;
        background: #121214;
        color: #ffffff;
      }
      .card {
        text-align: center;
        padding: 32px 24px;
        max-width: 360px;
        border-radius: 16px;
        background: #18181c;
        border: 1px solid rgba(255, 255, 255, 0.1);
        box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);
      }
      .spinner {
        width: 36px;
        height: 36px;
        border: 3px solid rgba(255, 255, 255, 0.15);
        border-top-color: #3b82f6;
        border-radius: 50%;
        animation: spin 0.7s linear infinite;
        margin: 0 auto 16px;
      }
      @keyframes spin {
        to { transform: rotate(360deg); }
      }
      h1 { font-size: 16px; font-weight: 600; margin: 0 0 6px; }
      p { font-size: 13px; color: #a1a1aa; margin: 0; }
    </style>
  </head>
  <body>
    <div class="card">
      <div class="spinner"></div>
      <h1>Authentication Successful</h1>
      <p>Returning to your NoteCraft workspace...</p>
    </div>
    <script>
      (function() {
        const user = ${userJson};
        try {
          const LOCAL_USERS_KEY = 'notecraft.auth.users.v1';
          const LOCAL_SESSION_KEY = 'notecraft.auth.session.v1';
          const raw = localStorage.getItem(LOCAL_USERS_KEY);
          const users = raw ? JSON.parse(raw) : [];
          const existing = users.find(function(u) { return u.email === user.email; });
          if (!existing) {
            users.push({
              id: user.id,
              name: user.name,
              email: user.email,
              createdAt: user.createdAt,
              salt: 'oauth',
              passwordHash: 'oauth'
            });
            localStorage.setItem(LOCAL_USERS_KEY, JSON.stringify(users));
          } else {
            user.id = existing.id;
          }
          localStorage.setItem(LOCAL_SESSION_KEY, user.id);
        } catch (e) {
          console.warn('Storage sync failed:', e);
        }

        if (window.opener) {
          try {
            window.opener.postMessage({ type: 'OAUTH_AUTH_SUCCESS', user: user }, '*');
          } catch(e) {}
          setTimeout(function() { window.close(); }, 350);
        } else {
          setTimeout(function() { window.location.href = '/'; }, 300);
        }
      })();
    </script>
  </body>
</html>`;
    return res.status(200).send(html);
  }

  // Failed Authentication Page
  const errHtml = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>NoteCraft - Authentication Error</title>
    <style>
      body {
        margin: 0;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        display: flex;
        align-items: center;
        justify-content: center;
        min-height: 100vh;
        background: #121214;
        color: #ffffff;
      }
      .card {
        text-align: left;
        padding: 32px 28px;
        max-width: 440px;
        border-radius: 16px;
        background: #18181c;
        border: 1px solid rgba(239, 68, 68, 0.3);
        box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);
      }
      h1 { font-size: 17px; font-weight: 600; color: #f87171; margin: 0 0 10px; }
      p { font-size: 13px; color: #d4d4d8; margin: 0 0 12px; line-height: 1.5; }
      .hint { background: rgba(255, 255, 255, 0.05); padding: 10px 12px; border-radius: 8px; font-size: 12px; color: #a1a1aa; margin-bottom: 20px; word-break: break-all; }
      button, a {
        display: inline-block;
        padding: 8px 16px;
        border-radius: 8px;
        background: #27272a;
        color: #fff;
        text-decoration: none;
        font-size: 13px;
        font-weight: 500;
        cursor: pointer;
        border: none;
      }
      button:hover, a:hover { background: #3f3f46; }
    </style>
  </head>
  <body>
    <div class="card">
      <h1>Authentication Notice</h1>
      <p>${escapeHtml(data.error)}</p>
      ${data.hint ? `<div class="hint"><strong>Hint:</strong> ${escapeHtml(data.hint)}</div>` : ''}
      <button onclick="if (window.opener) { window.close(); } else { window.location.href = '/'; }">Return to NoteCraft</button>
    </div>
  </body>
</html>`;
  return res.status(400).send(errHtml);
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
