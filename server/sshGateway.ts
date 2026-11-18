import type { IncomingMessage, Server as HttpServer } from 'node:http';
import path from 'node:path';
import type { Duplex } from 'node:stream';
import type { Pool } from 'pg';
import {
  Client as SshClient,
  type ClientChannel,
  type ConnectConfig,
  type SFTPWrapper,
} from 'ssh2';
import { WebSocket, WebSocketServer } from 'ws';
import { hashSessionToken, parseCookies, SESSION_COOKIE_NAME } from './auth.ts';
import { ensureSchema } from './db.ts';

type ClientMessage =
  | {
      type: 'connect';
      host?: unknown;
      port?: unknown;
      username?: unknown;
      authType?: unknown;
      password?: unknown;
      privateKey?: unknown;
      passphrase?: unknown;
      cols?: unknown;
      rows?: unknown;
    }
  | {
      type: 'input';
      data?: unknown;
    }
  | {
      type: 'resize';
      cols?: unknown;
      rows?: unknown;
    }
  | {
      type: 'listDir';
      requestId?: unknown;
      path?: unknown;
    }
  | {
      type: 'readFile';
      requestId?: unknown;
      path?: unknown;
    }
  | {
      type: 'disconnect';
    }
  | {
      type: 'ping';
    };

function sendJson(ws: WebSocket, payload: Record<string, unknown>) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

function clampDim(value: unknown, fallback: number, min: number, max: number): number {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(min, Math.min(max, Math.round(num)));
}

function isValidHost(host: string): boolean {
  if (!host || host.length > 253) return false;
  if (/[\s\r\n\0'"`;|&$<>\\]/.test(host)) return false;
  return /^[a-zA-Z0-9._:[\]-]+$/.test(host);
}

async function authorizeUpgradeRequest(
  req: IncomingMessage,
  getPool: () => Pool | null
): Promise<boolean> {
  const pool = getPool();
  if (!pool) {
    // Local fallback mode without PostgreSQL configured
    return true;
  }

  try {
    await ensureSchema(pool);
    const cookies = parseCookies(req.headers.cookie);
    const rawToken = cookies[SESSION_COOKIE_NAME];
    if (!rawToken) return false;

    const tokenHash = hashSessionToken(rawToken);
    const result = await pool.query<{ id: string }>(
      `SELECT u.id
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = $1 AND s.expires_at > $2`,
      [tokenHash, Date.now()]
    );
    return result.rows.length > 0;
  } catch (err) {
    const code = (err as { code?: string })?.code;
    if (
      code === 'ECONNREFUSED' ||
      code === 'ENOTFOUND' ||
      code === 'ETIMEDOUT' ||
      code === 'EHOSTUNREACH'
    ) {
      return true;
    }
    return false;
  }
}

export function attachSshWebSocketServer(
  httpServer: HttpServer,
  getPool: () => Pool | null
) {
  const wss = new WebSocketServer({ noServer: true });

  httpServer.on('upgrade', async (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const rawUrl = req.url || '/';
    let pathname = '/';
    try {
      pathname = new URL(rawUrl, 'http://localhost').pathname;
    } catch {
      pathname = rawUrl.split('?')[0] || '/';
    }

    if (pathname !== '/ws/ssh') {
      return;
    }

    const authorized = await authorizeUpgradeRequest(req, getPool);
    if (!authorized) {
      socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req);
    });
  });

  wss.on('connection', (ws: WebSocket) => {
    let sshClient: SshClient | null = null;
    let shellStream: ClientChannel | null = null;
    let sftpSession: SFTPWrapper | null = null;
    let sftpInitPromise: Promise<SFTPWrapper> | null = null;
    let currentCols = 100;
    let currentRows = 30;
    let manualDisconnect = false;

    const cleanupSsh = (reason?: string, notifyDisconnect = false) => {
      sftpInitPromise = null;
      if (sftpSession) {
        try {
          sftpSession.end();
        } catch {
          // ignore sftp cleanup errors
        }
        sftpSession = null;
      }
      if (shellStream) {
        try {
          shellStream.removeAllListeners();
          shellStream.close();
        } catch {
          // ignore stream cleanup errors
        }
        shellStream = null;
      }
      if (sshClient) {
        try {
          sshClient.removeAllListeners();
          sshClient.end();
        } catch {
          // ignore client cleanup errors
        }
        sshClient = null;
      }
      if (notifyDisconnect) {
        sendJson(ws, {
          type: 'status',
          status: 'disconnected',
          message: reason || 'SSH session closed.',
        });
      }
    };

    const getSftp = (): Promise<SFTPWrapper> => {
      if (!sshClient) {
        return Promise.reject(new Error('SSH is not connected.'));
      }
      if (sftpSession) {
        return Promise.resolve(sftpSession);
      }
      if (sftpInitPromise) {
        return sftpInitPromise;
      }
      const clientRef = sshClient;
      sftpInitPromise = new Promise<SFTPWrapper>((resolve, reject) => {
        clientRef.sftp((err, sftp) => {
          if (err || !sftp) {
            sftpInitPromise = null;
            reject(err || new Error('SFTP subsystem unavailable on remote server.'));
            return;
          }
          if (sshClient !== clientRef) {
            try {
              sftp.end();
            } catch {
              // ignore
            }
            sftpInitPromise = null;
            reject(new Error('SSH session changed.'));
            return;
          }
          sftpSession = sftp;
          sftp.on('end', () => {
            if (sftpSession === sftp) sftpSession = null;
          });
          sftp.on('close', () => {
            if (sftpSession === sftp) sftpSession = null;
          });
          resolve(sftp);
        });
      });
      return sftpInitPromise;
    };

    const resolveSftpPath = (sftp: SFTPWrapper, rawPath?: string): Promise<string> =>
      new Promise((resolve, reject) => {
        const trimmed = (rawPath || '').trim();
        if (!trimmed || trimmed === '~') {
          sftp.realpath('.', (err, absPath) => {
            if (err || !absPath) reject(err || new Error('Unable to resolve home directory.'));
            else resolve(absPath);
          });
          return;
        }
        if (trimmed.startsWith('~/')) {
          sftp.realpath('.', (homeErr, homePath) => {
            if (homeErr || !homePath) {
              reject(homeErr || new Error('Unable to resolve home directory.'));
              return;
            }
            const joined = path.posix.join(homePath, trimmed.slice(2));
            sftp.realpath(joined, (err, absPath) => {
              if (err || !absPath) reject(err || new Error(`Directory not found: ${trimmed}`));
              else resolve(absPath);
            });
          });
          return;
        }
        sftp.realpath(trimmed, (err, absPath) => {
          if (err || !absPath) reject(err || new Error(`Path not found: ${trimmed}`));
          else resolve(absPath);
        });
      });

    ws.on('message', (raw) => {
      let msg: ClientMessage;
      try {
        msg = JSON.parse(raw.toString()) as ClientMessage;
      } catch {
        return;
      }

      if (msg.type === 'ping') {
        sendJson(ws, { type: 'pong' });
        return;
      }

      if (msg.type === 'disconnect') {
        manualDisconnect = true;
        cleanupSsh('Disconnected by user.', true);
        return;
      }

      if (msg.type === 'resize') {
        currentCols = clampDim(msg.cols, currentCols, 20, 400);
        currentRows = clampDim(msg.rows, currentRows, 5, 200);
        if (shellStream) {
          try {
            shellStream.setWindow(currentRows, currentCols, 0, 0);
          } catch {
            // ignore resize errors
          }
        }
        return;
      }

      if (msg.type === 'input') {
        if (shellStream && typeof msg.data === 'string') {
          shellStream.write(msg.data);
        }
        return;
      }

      if (msg.type === 'listDir') {
        const requestId = typeof msg.requestId === 'string' ? msg.requestId : '';
        const requestedPath = typeof msg.path === 'string' ? msg.path : '';
        void (async () => {
          try {
            const sftp = await getSftp();
            const resolvedPath = await resolveSftpPath(sftp, requestedPath);
            const rawEntries = await new Promise<
              Array<{
                filename: string;
                longname: string;
                attrs: { mode: number; size: number; mtime: number };
              }>
            >((resolve, reject) => {
              sftp.readdir(resolvedPath, (err, list) => {
                if (err || !list) reject(err || new Error('Failed to list directory.'));
                else resolve(list);
              });
            });

            const filtered = rawEntries.filter(
              (item) => item.filename !== '.' && item.filename !== '..'
            );

            const resolvedEntries = await Promise.all(
              filtered.slice(0, 400).map(async (item) => {
                const fullPath = path.posix.join(resolvedPath, item.filename);
                const mode = item.attrs?.mode ?? 0;
                const isSymlink =
                  (mode & 0o170000) === 0o120000 || Boolean(item.longname?.startsWith('l'));
                let isDirectory =
                  (mode & 0o170000) === 0o040000 || Boolean(item.longname?.startsWith('d'));
                if (isSymlink) {
                  isDirectory = await new Promise<boolean>((res) => {
                    sftp.stat(fullPath, (statErr, stats) => {
                      if (statErr || !stats) res(false);
                      else res((stats.mode & 0o170000) === 0o040000);
                    });
                  });
                }
                return {
                  name: item.filename,
                  path: fullPath,
                  isDirectory,
                  size: Number(item.attrs?.size ?? 0),
                  modifiedAt: item.attrs?.mtime ? Number(item.attrs.mtime) * 1000 : null,
                };
              })
            );

            resolvedEntries.sort((a, b) => {
              if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
              return a.name.localeCompare(b.name);
            });

            sendJson(ws, {
              type: 'dirListing',
              requestId,
              path: resolvedPath,
              entries: resolvedEntries.slice(0, 300),
              truncated: filtered.length > 300,
            });
          } catch (err) {
            sendJson(ws, {
              type: 'dirError',
              requestId,
              error: err instanceof Error ? err.message : 'Unable to open directory.',
            });
          }
        })();
        return;
      }

      if (msg.type === 'readFile') {
        const requestId = typeof msg.requestId === 'string' ? msg.requestId : '';
        const requestedPath = typeof msg.path === 'string' ? msg.path : '';
        void (async () => {
          try {
            if (!requestedPath.trim()) {
              throw new Error('Missing file path.');
            }
            const sftp = await getSftp();
            const resolvedPath = await resolveSftpPath(sftp, requestedPath);
            const stats = await new Promise<{ size: number; mode: number }>((resolve, reject) => {
              sftp.stat(resolvedPath, (err, st) => {
                if (err || !st) reject(err || new Error('Unable to read file metadata.'));
                else resolve({ size: st.size, mode: st.mode });
              });
            });
            if ((stats.mode & 0o170000) === 0o040000) {
              throw new Error('Selected path is a directory.');
            }

            if (stats.size === 0) {
              sendJson(ws, {
                type: 'fileContent',
                requestId,
                path: resolvedPath,
                name: path.posix.basename(resolvedPath),
                size: 0,
                truncated: false,
                isBinary: false,
                content: '',
              });
              return;
            }

            const MAX_BYTES = 65536;
            const buffer = await new Promise<Buffer>((resolve, reject) => {
              const chunks: Buffer[] = [];
              let total = 0;
              const stream = sftp.createReadStream(resolvedPath, {
                start: 0,
                end: Math.min(stats.size, MAX_BYTES) - 1,
              });
              stream.on('data', (chunk: Buffer) => {
                chunks.push(chunk);
                total += chunk.length;
              });
              stream.on('error', (err: Error) => reject(err));
              stream.on('end', () => resolve(Buffer.concat(chunks, total)));
            });

            const isBinary = buffer.subarray(0, 1024).includes(0);
            sendJson(ws, {
              type: 'fileContent',
              requestId,
              path: resolvedPath,
              name: path.posix.basename(resolvedPath),
              size: stats.size,
              truncated: stats.size > MAX_BYTES,
              isBinary,
              content: isBinary ? '' : buffer.toString('utf8'),
            });
          } catch (err) {
            sendJson(ws, {
              type: 'fileError',
              requestId,
              error: err instanceof Error ? err.message : 'Unable to read file.',
            });
          }
        })();
        return;
      }

      if (msg.type === 'connect') {
        cleanupSsh(undefined, false);
        manualDisconnect = false;

        const host = typeof msg.host === 'string' ? msg.host.trim() : '';
        const username = typeof msg.username === 'string' ? msg.username.trim() : '';
        const port = clampDim(msg.port, 22, 1, 65535);
        const authType = msg.authType === 'privateKey' ? 'privateKey' : 'password';
        const password = typeof msg.password === 'string' ? msg.password : '';
        const privateKey = typeof msg.privateKey === 'string' ? msg.privateKey.trim() : '';
        const passphrase = typeof msg.passphrase === 'string' ? msg.passphrase : undefined;

        currentCols = clampDim(msg.cols, 100, 20, 400);
        currentRows = clampDim(msg.rows, 30, 5, 200);

        if (!isValidHost(host)) {
          sendJson(ws, {
            type: 'status',
            status: 'error',
            message: 'Please enter a valid server hostname or IP address.',
          });
          return;
        }
        if (!username || username.length > 128) {
          sendJson(ws, {
            type: 'status',
            status: 'error',
            message: 'Please enter a valid SSH username.',
          });
          return;
        }
        if (authType === 'privateKey' && !privateKey) {
          sendJson(ws, {
            type: 'status',
            status: 'error',
            message: 'Please paste or upload a private key to authenticate.',
          });
          return;
        }
        if (authType === 'password' && !password) {
          sendJson(ws, {
            type: 'status',
            status: 'error',
            message: 'Please enter an SSH password or switch to Private Key auth.',
          });
          return;
        }

        sendJson(ws, {
          type: 'status',
          status: 'connecting',
          host,
          port,
          username,
          message: `Connecting to ${username}@${host}:${port}...`,
        });

        const client = new SshClient();
        sshClient = client;

        const config: ConnectConfig = {
          host,
          port,
          username,
          readyTimeout: 15000,
          keepaliveInterval: 15000,
          keepaliveCountMax: 3,
          tryKeyboard: authType === 'password',
        };

        if (authType === 'privateKey') {
          config.privateKey = privateKey;
          if (passphrase) {
            config.passphrase = passphrase;
          }
        } else {
          config.password = password;
        }

        client.on('keyboard-interactive', (_name, _instructions, _lang, prompts, finish) => {
          if (authType === 'password' && prompts.length > 0) {
            finish(prompts.map(() => password));
          } else {
            finish([]);
          }
        });

        client.on('ready', () => {
          if (sshClient !== client) return;
          client.shell(
            {
              term: 'xterm-256color',
              cols: currentCols,
              rows: currentRows,
            },
            (err, stream) => {
              if (err) {
                sendJson(ws, {
                  type: 'status',
                  status: 'error',
                  message: `Connected to ${host}, but failed to open shell: ${err.message}`,
                });
                cleanupSsh();
                return;
              }

              shellStream = stream;
              sendJson(ws, {
                type: 'status',
                status: 'connected',
                host,
                port,
                username,
                message: `Connected to ${username}@${host}:${port}`,
              });

              stream.on('data', (chunk: Buffer) => {
                sendJson(ws, {
                  type: 'data',
                  data: chunk.toString('utf8'),
                });
              });

              stream.stderr?.on('data', (chunk: Buffer) => {
                sendJson(ws, {
                  type: 'data',
                  data: chunk.toString('utf8'),
                });
              });

              stream.on('close', () => {
                if (shellStream === stream) {
                  cleanupSsh(
                    manualDisconnect ? 'Disconnected by user.' : `Remote session on ${host} closed.`,
                    true
                  );
                }
              });
            }
          );
        });

        client.on('error', (err: Error & { level?: string }) => {
          if (sshClient !== client) return;
          const hint =
            err.level === 'client-authentication'
              ? 'Authentication failed. Check your username, password, or private key.'
              : err.message;
          sendJson(ws, {
            type: 'status',
            status: 'error',
            message: hint,
          });
          cleanupSsh();
        });

        (client as unknown as NodeJS.EventEmitter).on('close', (hadError?: boolean) => {
          if (sshClient === client) {
            cleanupSsh(
              hadError
                ? 'Connection closed due to a network error.'
                : manualDisconnect
                ? 'Disconnected by user.'
                : 'SSH connection closed.',
              true
            );
          }
        });

        try {
          client.connect(config);
        } catch (err) {
          sendJson(ws, {
            type: 'status',
            status: 'error',
            message: err instanceof Error ? err.message : 'Failed to initiate SSH connection.',
          });
          cleanupSsh();
        }
      }
    });

    ws.on('close', () => {
      manualDisconnect = true;
      cleanupSsh();
    });
  });

  return wss;
}
